import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_GROUP_ADD } from '../queue-constants';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { UazApiService } from '../../uazapi/uazapi.service';
import { SenderGateway } from '../../websocket/websocket.gateway';

export interface GroupAddJobData {
  jobId: string;
  targetId: string;
  tenantId: string;
  // 'invite' = envio manual de convite disparado pelo painel.
  // Ausente = adicao normal (compatibilidade com jobs ja enfileirados).
  mode?: 'add' | 'invite';
}

const DAILY_RESET_HOUR = 0;

function extractToken(config: unknown): string | null {
  if (config && typeof config === 'object' && !Array.isArray(config)) {
    const c = config as Record<string, unknown>;
    if (typeof c.uazapi_token === 'string' && c.uazapi_token.length > 0) {
      return c.uazapi_token;
    }
  }
  return null;
}

@Processor(QUEUE_GROUP_ADD, {
  limiter: { max: 3, duration: 60_000 },
})
export class GroupAddWorker extends WorkerHost {
  private readonly logger = new Logger(GroupAddWorker.name);

  constructor(
    private prisma: PrismaService,
    private uazapi: UazApiService,
    private gateway: SenderGateway,
  ) {
    super();
  }

  async process(job: Job<GroupAddJobData>): Promise<void> {
    const { jobId, targetId, tenantId, mode } = job.data;

    const addJob = await this.prisma.groupAddJob.findUnique({
      where: { id: jobId },
      include: { dest_instance: true },
    });

    if (mode === 'invite') {
      if (!addJob) return;
      const inviteToken = extractToken(addJob.dest_instance?.config);
      if (!inviteToken) {
        await this.markTarget(
          targetId,
          'FAILED',
          'instância destino sem token UazAPI',
        );
        return;
      }
      const inviteTarget = await this.prisma.addTarget.findUnique({
        where: { id: targetId },
      });
      if (!inviteTarget) return;
      await this.sendInvite(
        addJob,
        inviteToken,
        inviteTarget.id,
        inviteTarget.phone || inviteTarget.member_jid,
      );
      await this.emitAndMaybeComplete(jobId, tenantId);
      return;
    }
    if (
      !addJob ||
      addJob.status === 'PAUSED' ||
      addJob.status === 'FAILED' ||
      addJob.status === 'COMPLETED'
    ) {
      await this.markTarget(targetId, 'SKIPPED');
      return;
    }

    await this.resetDailyCountIfNeeded(jobId);

    const fresh = await this.prisma.groupAddJob.findUnique({
      where: { id: jobId },
    });
    if (fresh && fresh.added_today >= fresh.daily_add_cap) {
      this.logger.warn(
        `AddJob ${jobId} atingiu cap diário (${fresh.daily_add_cap}). Re-enfileira p/ amanhã.`,
      );
      await this.markTarget(targetId, 'PENDING');
      const msUntilMidnight = this.msUntilHour(DAILY_RESET_HOUR + 1);
      await this.markStopped(
        jobId,
        tenantId,
        'DAILY_CAP',
        new Date(Date.now() + msUntilMidnight),
      );
      throw Object.assign(new Error('daily_cap_reached'), {
        delay: msUntilMidnight,
      });
    }

    const settings = await this.prisma.tenantSettings.findUnique({
      where: { tenant_id: tenantId },
    });
    if (
      settings &&
      !this.isWithinSendWindow(
        settings.send_window_start,
        settings.send_window_end,
      )
    ) {
      this.logger.log(`AddJob ${jobId} fora da janela de envio. Re-enfileira.`);
      await this.markTarget(targetId, 'PENDING');
      const msUntilWindow = this.msUntilWindowOpen(settings.send_window_start);
      await this.markStopped(
        jobId,
        tenantId,
        'OUTSIDE_WINDOW',
        new Date(Date.now() + msUntilWindow),
      );
      throw Object.assign(new Error('outside_send_window'), {
        delay: msUntilWindow,
      });
    }

    const token = extractToken(addJob.dest_instance?.config);
    if (!token) {
      await this.markTarget(
        targetId,
        'FAILED',
        'instância destino sem token UazAPI',
      );
      await this.prisma.groupAddJob.update({
        where: { id: jobId },
        data: { failed_count: { increment: 1 } },
      });
      return;
    }

    const target = await this.prisma.addTarget.findUnique({
      where: { id: targetId },
    });
    if (!target) return;

    await this.prisma.addTarget.update({
      where: { id: targetId },
      data: { status: 'PROCESSING', attempts: { increment: 1 } },
    });
    // Voltou a andar: o motivo da parada anterior nao vale mais.
    if (addJob.stop_reason) {
      await this.prisma.groupAddJob.update({
        where: { id: jobId },
        data: { stop_reason: null, resume_at: null },
      });
    }

    try {
      const memberId = target.phone || target.member_jid;
      const result = await this.uazapi.addGroupParticipants(
        token,
        addJob.dest_group_jid,
        [memberId],
      );

      const succeeded = result.added.some(
        (r) => r.status === '200' || r.status === 'success',
      );
      const errorStatus = result.failed[0]?.status;

      if (succeeded) {
        // Escrita aceita nao e o mesmo que membro dentro do grupo: a
        // privacidade do WhatsApp bloqueia adicao direta sem devolver erro.
        const joined = await this.confirmJoined(
          token,
          addJob.dest_group_jid,
          memberId,
          result.participants,
        );

        if (joined === false) {
          await this.markTarget(
            targetId,
            'NOT_JOINED',
            'nao entrou no grupo (privacidade bloqueia adicao direta)',
          );
          await this.prisma.groupAddJob.update({
            where: { id: jobId },
            data: { not_joined_count: { increment: 1 } },
          });
          if (addJob.send_invite_on_fail && addJob.invite_link) {
            await this.sendInvite(
              addJob,
              token,
              targetId,
              memberId,
              'nao entrou no grupo (privacidade bloqueia adicao direta)',
            );
          }
          await this.emitAndMaybeComplete(jobId, tenantId);
          return;
        }

        await this.prisma.addTarget.update({
          where: { id: targetId },
          data: { status: 'DONE', added_at: new Date() },
        });
        await this.prisma.groupAddJob.update({
          where: { id: jobId },
          data: {
            added_count: { increment: 1 },
            added_today: { increment: 1 },
          },
        });
      } else {
        const reason = errorStatus ?? 'falha desconhecida';
        await this.markTarget(targetId, 'FAILED', reason);
        await this.prisma.groupAddJob.update({
          where: { id: jobId },
          data: { failed_count: { increment: 1 } },
        });
        // Fallback automatico: so quando o toggle esta ligado E existe link cadastrado.
        if (addJob.send_invite_on_fail && addJob.invite_link) {
          await this.sendInvite(addJob, token, targetId, memberId, reason);
        }
      }

      await this.emitAndMaybeComplete(jobId, tenantId);
    } catch (error) {
      this.logger.error(
        `GroupAddWorker erro target ${targetId}: ${(error as Error).message}`,
      );
      await this.markTarget(targetId, 'FAILED', (error as Error).message);
      await this.prisma.groupAddJob.update({
        where: { id: jobId },
        data: { failed_count: { increment: 1 } },
      });
      await this.emitAndMaybeComplete(jobId, tenantId);
    }
  }

  /**
   * O membro esta mesmo no grupo depois da escrita?
   *
   * `true`  — apareceu na lista de participantes.
   * `false` — a lista existe e ele nao esta nela.
   * `null`  — nao deu para saber (a resposta nao trouxe lista e a leitura de
   *           reserva falhou). Nesse caso quem chama mantem o desfecho otimista:
   *           inventar "nao entrou" mandaria convite para quem ja esta dentro.
   *
   * A leitura de reserva e cara — baixa todos os grupos da instancia com os
   * participantes — entao so roda quando a resposta da adicao veio sem lista.
   */
  private async confirmJoined(
    token: string,
    groupJid: string,
    member: string,
    participantsFromResponse: string[],
  ): Promise<boolean | null> {
    if (participantsFromResponse.length > 0) {
      return this.uazapi.isMemberInList(participantsFromResponse, member);
    }
    try {
      const { participants } = await this.uazapi.getGroupParticipants(
        token,
        groupJid,
      );
      const jids = participants.map((p) => p.id).filter(Boolean);
      if (jids.length === 0) return null;
      return this.uazapi.isMemberInList(jids, member);
    } catch (error) {
      this.logger.warn(
        `Nao foi possivel confirmar entrada de ${member} em ${groupJid}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Manda o link de convite no privado e marca o alvo como INVITED.
   * Mantem o motivo original da falha no campo `error` — o relatorio precisa
   * mostrar POR QUE a adicao direta nao funcionou, nao so que houve convite.
   */
  private async sendInvite(
    addJob: { id: string; invite_link: string | null; invite_message: string },
    token: string,
    targetId: string,
    phone: string,
    addFailureReason?: string,
  ): Promise<void> {
    if (!addJob.invite_link) return;
    const text = addJob.invite_message.replace(/\{link\}/g, addJob.invite_link);
    try {
      const res = await this.uazapi.sendText(token, phone, text);
      if (!res.success) throw new Error(res.error ?? 'falha ao enviar convite');
      await this.prisma.addTarget.update({
        where: { id: targetId },
        data: {
          status: 'INVITED',
          invited_at: new Date(),
          ...(addFailureReason && {
            error: `${addFailureReason} — convite enviado`,
          }),
        },
      });
      await this.prisma.groupAddJob.update({
        where: { id: addJob.id },
        data: { invited_count: { increment: 1 } },
      });
    } catch (error) {
      const msg = (error as Error).message;
      this.logger.warn(`Convite falhou para ${phone}: ${msg}`);
      await this.markTarget(
        targetId,
        'FAILED',
        addFailureReason
          ? `${addFailureReason} — convite tambem falhou: ${msg}`
          : `convite falhou: ${msg}`,
      );
    }
  }

  private async emitAndMaybeComplete(jobId: string, tenantId: string) {
    const updated = await this.prisma.groupAddJob.findUnique({
      where: { id: jobId },
    });
    if (!updated) return;
    this.gateway.emitAddJobProgress(
      jobId,
      {
        added: updated.added_count,
        failed: updated.failed_count,
        skipped: updated.skipped_count,
        added_today: updated.added_today,
      },
      tenantId,
    );
    const pending = await this.prisma.addTarget.count({
      where: { job_id: jobId, status: { in: ['PENDING', 'PROCESSING'] } },
    });
    if (pending === 0) {
      await this.prisma.groupAddJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          last_run_at: new Date(),
          stop_reason: null,
          resume_at: null,
          run_remaining: 0,
        },
      });
      this.gateway.emitAddJobCompleted(jobId, tenantId);
      return;
    }

    // Sobrou alvo mas a rodada esgotou o lote: parou por decisao do operador,
    // nao por bloqueio. Retomar e um clique em "Rodar lote" — e a tela precisa
    // dizer isso, senao parece que o job travou.
    const remaining = Math.max(0, (updated.run_remaining ?? 0) - 1);
    await this.prisma.groupAddJob.update({
      where: { id: jobId },
      data: {
        run_remaining: remaining,
        ...(remaining === 0 && {
          status: 'IDLE',
          stop_reason: 'ROUND_DONE',
          resume_at: null,
          last_run_at: new Date(),
        }),
      },
    });
    if (remaining === 0) {
      this.gateway.emitAddJobProgress(
        jobId,
        { status: 'IDLE', stop_reason: 'ROUND_DONE' },
        tenantId,
      );
    }
  }

  /**
   * Registra por que o job parou e quando volta sozinho. O status continua
   * RUNNING nos casos automaticos: a fila ja tem o alvo reagendado, so quem
   * olha a tela e que precisa saber o motivo da espera.
   */
  private async markStopped(
    jobId: string,
    tenantId: string,
    reason: 'DAILY_CAP' | 'OUTSIDE_WINDOW',
    resumeAt: Date,
  ) {
    await this.prisma.groupAddJob.update({
      where: { id: jobId },
      data: { stop_reason: reason, resume_at: resumeAt },
    });
    this.gateway.emitAddJobProgress(
      jobId,
      { stop_reason: reason, resume_at: resumeAt.toISOString() },
      tenantId,
    );
  }

  private async markTarget(id: string, status: string, error?: string) {
    await this.prisma.addTarget.update({
      where: { id },
      data: {
        status: status as
          | 'PENDING'
          | 'PROCESSING'
          | 'DONE'
          | 'FAILED'
          | 'NOT_JOINED'
          | 'SKIPPED'
          | 'INVITED',
        ...(error && { error }),
      },
    });
  }

  private async resetDailyCountIfNeeded(jobId: string) {
    const job = await this.prisma.groupAddJob.findUnique({
      where: { id: jobId },
    });
    if (!job) return;
    const lastReset = job.last_reset_at;
    const now = new Date();
    const sameDay =
      lastReset.getFullYear() === now.getFullYear() &&
      lastReset.getMonth() === now.getMonth() &&
      lastReset.getDate() === now.getDate();
    if (!sameDay) {
      await this.prisma.groupAddJob.update({
        where: { id: jobId },
        data: { added_today: 0, last_reset_at: now },
      });
    }
  }

  private isWithinSendWindow(start: string, end: string): boolean {
    const now = new Date();
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;
    return nowMins >= startMins && nowMins < endMins;
  }

  private msUntilWindowOpen(start: string): number {
    const now = new Date();
    const [sh, sm] = start.split(':').map(Number);
    const open = new Date(now);
    open.setHours(sh, sm, 0, 0);
    if (open <= now) open.setDate(open.getDate() + 1);
    return open.getTime() - now.getTime();
  }

  private msUntilHour(hour: number): number {
    const now = new Date();
    const target = new Date(now);
    target.setHours(hour, 0, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
  }
}
