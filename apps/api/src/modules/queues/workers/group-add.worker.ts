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
    const { jobId, targetId, tenantId } = job.data;

    const addJob = await this.prisma.groupAddJob.findUnique({
      where: { id: jobId },
      include: { dest_instance: true },
    });
    if (!addJob || addJob.status === 'PAUSED' || addJob.status === 'FAILED' || addJob.status === 'COMPLETED') {
      await this.markTarget(targetId, 'SKIPPED');
      return;
    }

    await this.resetDailyCountIfNeeded(jobId);

    const fresh = await this.prisma.groupAddJob.findUnique({ where: { id: jobId } });
    if (fresh && fresh.added_today >= fresh.daily_add_cap) {
      this.logger.warn(`AddJob ${jobId} atingiu cap diário (${fresh.daily_add_cap}). Re-enfileira p/ amanhã.`);
      await this.markTarget(targetId, 'PENDING');
      const msUntilMidnight = this.msUntilHour(DAILY_RESET_HOUR + 1);
      throw Object.assign(new Error('daily_cap_reached'), { delay: msUntilMidnight });
    }

    const settings = await this.prisma.tenantSettings.findUnique({ where: { tenant_id: tenantId } });
    if (settings && !this.isWithinSendWindow(settings.send_window_start, settings.send_window_end)) {
      this.logger.log(`AddJob ${jobId} fora da janela de envio. Re-enfileira.`);
      await this.markTarget(targetId, 'PENDING');
      const msUntilWindow = this.msUntilWindowOpen(settings.send_window_start);
      throw Object.assign(new Error('outside_send_window'), { delay: msUntilWindow });
    }

    const token = extractToken(addJob.dest_instance?.config);
    if (!token) {
      await this.markTarget(targetId, 'FAILED', 'instância destino sem token UazAPI');
      await this.prisma.groupAddJob.update({ where: { id: jobId }, data: { failed_count: { increment: 1 } } });
      return;
    }

    const target = await this.prisma.addTarget.findUnique({ where: { id: targetId } });
    if (!target) return;

    await this.prisma.addTarget.update({
      where: { id: targetId },
      data: { status: 'PROCESSING', attempts: { increment: 1 } },
    });

    try {
      const memberId = target.phone || target.member_jid;
      const result = await this.uazapi.addGroupParticipants(token, addJob.dest_group_jid, [memberId]);

      const succeeded = result.added.some((r) => r.status === '200' || r.status === 'success');
      const errorStatus = result.failed[0]?.status;

      if (succeeded) {
        await this.prisma.addTarget.update({
          where: { id: targetId },
          data: { status: 'DONE', added_at: new Date() },
        });
        await this.prisma.groupAddJob.update({
          where: { id: jobId },
          data: { added_count: { increment: 1 }, added_today: { increment: 1 } },
        });
      } else {
        // send_invite_on_fail: toggle existe mas convite está em STANDBY (fase 2).
        // Por ora só registra o motivo da falha.
        await this.markTarget(targetId, 'FAILED', errorStatus ?? 'falha desconhecida');
        await this.prisma.groupAddJob.update({
          where: { id: jobId },
          data: { failed_count: { increment: 1 } },
        });
      }

      await this.emitAndMaybeComplete(jobId, tenantId);
    } catch (error) {
      this.logger.error(`GroupAddWorker erro target ${targetId}: ${(error as Error).message}`);
      await this.markTarget(targetId, 'FAILED', (error as Error).message);
      await this.prisma.groupAddJob.update({
        where: { id: jobId },
        data: { failed_count: { increment: 1 } },
      });
      await this.emitAndMaybeComplete(jobId, tenantId);
    }
  }

  private async emitAndMaybeComplete(jobId: string, tenantId: string) {
    const updated = await this.prisma.groupAddJob.findUnique({ where: { id: jobId } });
    if (!updated) return;
    this.gateway.emitAddJobProgress(
      jobId,
      { added: updated.added_count, failed: updated.failed_count, skipped: updated.skipped_count, added_today: updated.added_today },
      tenantId,
    );
    const pending = await this.prisma.addTarget.count({
      where: { job_id: jobId, status: { in: ['PENDING', 'PROCESSING'] } },
    });
    if (pending === 0) {
      await this.prisma.groupAddJob.update({
        where: { id: jobId },
        data: { status: 'COMPLETED', last_run_at: new Date() },
      });
      this.gateway.emitAddJobCompleted(jobId, tenantId);
    }
  }

  private async markTarget(id: string, status: string, error?: string) {
    await this.prisma.addTarget.update({
      where: { id },
      data: {
        status: status as 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED' | 'SKIPPED' | 'INVITED',
        ...(error && { error }),
      },
    });
  }

  private async resetDailyCountIfNeeded(jobId: string) {
    const job = await this.prisma.groupAddJob.findUnique({ where: { id: jobId } });
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
