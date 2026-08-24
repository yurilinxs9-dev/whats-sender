import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UazApiService } from '../uazapi/uazapi.service';
import { SenderGateway } from '../websocket/websocket.gateway';
import { QUEUE_GROUP_ADD } from '../queues/queue-constants';
import {
  CreateExtractionDto,
  CreateAddJobDto,
  UpdateAddJobDto,
  SendInviteDto,
  ListAddTargetsDto,
} from './dto/group.dto';
import type { GroupAddJobData } from '../queues/workers/group-add.worker';

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(
    private prisma: PrismaService,
    private uazapi: UazApiService,
    private gateway: SenderGateway,
    @InjectQueue(QUEUE_GROUP_ADD) private groupAddQueue: Queue<GroupAddJobData>,
  ) {}

  /* ──────────────────────────────────────────────────
   *  Extrações
   * ────────────────────────────────────────────────── */

  async createExtraction(tenantId: string, dto: CreateExtractionDto) {
    const instance = await this.prisma.instance.findFirst({
      where: { id: dto.instance_id, tenant_id: tenantId },
    });
    if (!instance) throw new NotFoundException('Instância não encontrada');
    if (instance.status !== 'connected')
      throw new BadRequestException('Instância precisa estar conectada');

    const extraction = await this.prisma.groupExtraction.create({
      data: {
        nome: dto.nome,
        instance_id: dto.instance_id,
        tenant_id: tenantId,
        source_group_jid: dto.source_group_jid,
        source_group_name: dto.source_group_name ?? '',
        status: 'PENDING',
      },
    });
    // Dispara extração em background e retorna já (grupos grandes demoram)
    return this.triggerExtraction(tenantId, extraction.id);
  }

  // Marca EXTRACTING e roda em background — não bloqueia o request HTTP.
  async triggerExtraction(tenantId: string, id: string) {
    const extraction = await this.assertExtraction(tenantId, id);
    if (extraction.status === 'EXTRACTING') {
      throw new BadRequestException('Extração já está em andamento');
    }
    const updated = await this.prisma.groupExtraction.update({
      where: { id },
      data: { status: 'EXTRACTING', error: null },
    });
    this.gateway.emitExtractionProgress(id, { status: 'EXTRACTING' }, tenantId);
    void this.runExtraction(tenantId, id).catch(async (error) => {
      this.logger.error(`Extração ${id} falhou: ${(error as Error).message}`);
      await this.prisma.groupExtraction
        .update({
          where: { id },
          data: { status: 'FAILED', error: (error as Error).message },
        })
        .catch(() => undefined);
      this.gateway.emitExtractionProgress(id, { status: 'FAILED' }, tenantId);
    });
    return updated;
  }

  private async runExtraction(tenantId: string, id: string) {
    const extraction = await this.prisma.groupExtraction.findUnique({
      where: { id },
    });
    if (!extraction) return;

    const instance = await this.prisma.instance.findUnique({
      where: { id: extraction.instance_id },
    });
    const token = this.extractToken(instance?.config);
    if (!token) throw new Error('Instância sem token UazAPI. Reconecte.');

    const result = await this.uazapi.getGroupParticipants(
      token,
      extraction.source_group_jid,
    );

    // Refresh total: limpa e recria (1 query, sem estourar pool com 1000+ upserts)
    await this.prisma.extractedMember.deleteMany({
      where: { extraction_id: id },
    });
    await this.prisma.extractedMember.createMany({
      data: result.participants
        .filter((p) => p.id)
        .map((p) => ({
          extraction_id: id,
          jid: p.id,
          phone: p.id.replace(/@.*$/, ''),
          is_admin: p.admin === 'admin' || p.admin === 'superadmin',
        })),
      skipDuplicates: true,
    });

    const total = await this.prisma.extractedMember.count({
      where: { extraction_id: id },
    });
    await this.prisma.groupExtraction.update({
      where: { id },
      data: { status: 'DONE', total_members: total, extracted_at: new Date() },
    });
    this.gateway.emitExtractionProgress(
      id,
      { status: 'DONE', total },
      tenantId,
    );
    this.logger.log(`Extração ${id}: ${total} membros`);
  }

  listExtractions(tenantId: string) {
    return this.prisma.groupExtraction.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
      include: {
        instance: { select: { nome: true, status: true } },
        _count: { select: { members: true, add_jobs: true } },
      },
    });
  }

  async getExtraction(tenantId: string, id: string) {
    const extraction = await this.prisma.groupExtraction.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        instance: { select: { nome: true, status: true } },
        members: { orderBy: { created_at: 'asc' } },
      },
    });
    if (!extraction) throw new NotFoundException('Extração não encontrada');
    return extraction;
  }

  async removeExtraction(tenantId: string, id: string) {
    await this.assertExtraction(tenantId, id);
    await this.prisma.groupExtraction.delete({ where: { id } });
  }

  /* ──────────────────────────────────────────────────
   *  Jobs de adição
   * ────────────────────────────────────────────────── */

  async createAddJob(tenantId: string, dto: CreateAddJobDto) {
    const extraction = await this.prisma.groupExtraction.findFirst({
      where: { id: dto.extraction_id, tenant_id: tenantId },
      include: { members: { select: { jid: true, phone: true } } },
    });
    if (!extraction) throw new NotFoundException('Extração não encontrada');
    if (extraction.status !== 'DONE' || extraction.members.length === 0) {
      throw new BadRequestException(
        'Extração ainda não tem membros. Extraia primeiro.',
      );
    }

    const destInstance = await this.prisma.instance.findFirst({
      where: { id: dto.dest_instance_id, tenant_id: tenantId },
    });
    if (!destInstance)
      throw new NotFoundException('Instância destino não encontrada');
    if (destInstance.status !== 'connected')
      throw new BadRequestException(
        'Instância destino precisa estar conectada',
      );

    const job = await this.prisma.groupAddJob.create({
      data: {
        nome: dto.nome,
        tenant_id: tenantId,
        extraction_id: dto.extraction_id,
        dest_instance_id: dto.dest_instance_id,
        dest_group_jid: dto.dest_group_jid,
        dest_group_name: dto.dest_group_name ?? '',
        per_run_limit: dto.per_run_limit,
        daily_add_cap: dto.daily_add_cap,
        delay_min_s: dto.delay_min_s,
        delay_max_s: dto.delay_max_s,
        send_invite_on_fail: dto.send_invite_on_fail,
        invite_link: dto.invite_link ?? null,
        ...(dto.invite_message && { invite_message: dto.invite_message }),
        status: 'IDLE',
      },
    });

    // Snapshot dos alvos a partir dos membros da extração (dedupe por unique job+member_jid)
    await this.prisma.addTarget.createMany({
      data: extraction.members.map((m) => ({
        job_id: job.id,
        member_jid: m.jid,
        phone: m.phone,
      })),
      skipDuplicates: true,
    });

    return this.getAddJob(tenantId, job.id);
  }

  listAddJobs(tenantId: string) {
    return this.prisma.groupAddJob.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
      include: {
        dest_instance: { select: { nome: true, status: true } },
        extraction: { select: { nome: true, source_group_name: true } },
        _count: { select: { targets: true } },
      },
    });
  }

  /**
   * Detalhe do job SEM a lista de alvos: um job real tem centenas deles e esta
   * rota e refeita a cada ciclo de polling. O que a tela precisa e agregado —
   * contagem por status e motivos de falha — e sai do banco, nao da memoria.
   * Os alvos em si vem paginados por `listAddTargets`.
   */
  async getAddJob(tenantId: string, id: string) {
    const job = await this.prisma.groupAddJob.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        dest_instance: { select: { nome: true, status: true } },
        extraction: { select: { nome: true, source_group_name: true } },
      },
    });
    if (!job) throw new NotFoundException('Job de adição não encontrado');

    const [byStatus, byReason] = await Promise.all([
      this.prisma.addTarget.groupBy({
        by: ['status'],
        where: { job_id: id },
        _count: { _all: true },
      }),
      this.prisma.addTarget.groupBy({
        by: ['error'],
        where: { job_id: id, status: 'FAILED' },
        _count: { _all: true },
      }),
    ]);

    const counts: Record<string, number> = {};
    for (const row of byStatus) counts[row.status] = row._count._all;

    const failure_reasons = byReason
      .map((row) => ({
        reason: row.error ?? 'desconhecido',
        count: row._count._all,
      }))
      .sort((a, b) => b.count - a.count);

    return { ...job, counts, failure_reasons };
  }

  /**
   * Uma pagina de alvos do job, opcionalmente filtrada por status.
   */
  async listAddTargets(
    tenantId: string,
    id: string,
    query: ListAddTargetsDto,
  ): Promise<{
    items: unknown[];
    total: number;
    page: number;
    page_size: number;
  }> {
    await this.assertAddJob(tenantId, id);

    const where = {
      job_id: id,
      ...(query.status && { status: query.status }),
    };

    const [items, total] = await Promise.all([
      this.prisma.addTarget.findMany({
        where,
        orderBy: { created_at: 'asc' },
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      }),
      this.prisma.addTarget.count({ where }),
    ]);

    return { items, total, page: query.page, page_size: query.page_size };
  }

  async runAddJob(tenantId: string, id: string, limitOverride?: number) {
    const job = await this.assertAddJob(tenantId, id);
    if (job.status === 'RUNNING')
      throw new BadRequestException('Job já está rodando');

    const destInstance = await this.prisma.instance.findUnique({
      where: { id: job.dest_instance_id },
    });
    if (!this.extractToken(destInstance?.config)) {
      throw new BadRequestException(
        'Instância destino sem token UazAPI. Reconecte.',
      );
    }

    const limit = Math.max(
      1,
      Math.min(limitOverride ?? job.per_run_limit, 500),
    );
    const pending = await this.prisma.addTarget.findMany({
      where: { job_id: id, status: 'PENDING' },
      select: { id: true },
      take: limit,
    });
    if (pending.length === 0)
      throw new BadRequestException('Nenhum alvo pendente para adicionar');

    // `run_remaining` e o tamanho declarado da rodada: o worker decrementa a
    // cada alvo e, ao zerar com pendentes sobrando, marca ROUND_DONE.
    await this.prisma.groupAddJob.update({
      where: { id },
      data: {
        status: 'RUNNING',
        run_remaining: pending.length,
        stop_reason: null,
        resume_at: null,
      },
    });

    // Espaça as adições: delay cumulativo com jitter entre delay_min_s e delay_max_s
    let cumMs = 0;
    for (const target of pending) {
      const gapS =
        job.delay_min_s +
        Math.random() * Math.max(0, job.delay_max_s - job.delay_min_s);
      cumMs += Math.round(gapS * 1000);
      await this.groupAddQueue.add(
        'add-target',
        { jobId: id, targetId: target.id, tenantId },
        {
          delay: cumMs,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 500 },
        },
      );
    }

    this.gateway.emitAddJobProgress(
      id,
      { status: 'RUNNING', queued: pending.length },
      tenantId,
    );
    this.logger.log(
      `AddJob ${id}: ${pending.length} alvos enfileirados (limite ${limit})`,
    );
    return { queued: pending.length };
  }

  async updateAddJob(tenantId: string, id: string, dto: UpdateAddJobDto) {
    await this.assertAddJob(tenantId, id);
    await this.prisma.groupAddJob.update({
      where: { id },
      data: {
        ...(dto.nome !== undefined && { nome: dto.nome }),
        ...(dto.per_run_limit !== undefined && {
          per_run_limit: dto.per_run_limit,
        }),
        ...(dto.daily_add_cap !== undefined && {
          daily_add_cap: dto.daily_add_cap,
        }),
        ...(dto.delay_min_s !== undefined && { delay_min_s: dto.delay_min_s }),
        ...(dto.delay_max_s !== undefined && { delay_max_s: dto.delay_max_s }),
        ...(dto.send_invite_on_fail !== undefined && {
          send_invite_on_fail: dto.send_invite_on_fail,
        }),
        ...(dto.invite_link !== undefined && { invite_link: dto.invite_link }),
        ...(dto.invite_message !== undefined && {
          invite_message: dto.invite_message,
        }),
      },
    });
    return this.getAddJob(tenantId, id);
  }

  /**
   * Envia o link de convite por mensagem privada.
   * Sem target_ids envia para todos os alvos FAILED (envio em massa).
   * Espacado com o mesmo delay do job — convite tambem e disparo, tambem queima numero.
   */
  async sendInvites(tenantId: string, id: string, dto: SendInviteDto) {
    const job = await this.assertAddJob(tenantId, id);
    if (!job.invite_link) {
      throw new BadRequestException(
        'Job sem link de convite. Cole o link do grupo nas configuracoes.',
      );
    }

    const targets = await this.prisma.addTarget.findMany({
      where: {
        job_id: id,
        // Sem alvos explicitos: convida quem nao entrou por qualquer motivo —
        // falha de envio E "a API aceitou mas o membro nao apareceu no grupo".
        ...(dto.target_ids
          ? { id: { in: dto.target_ids } }
          : { status: { in: ['FAILED', 'NOT_JOINED'] } }),
      },
      select: { id: true },
    });
    if (targets.length === 0)
      throw new BadRequestException('Nenhum alvo para convidar');

    let cumMs = 0;
    for (const target of targets) {
      const gapS =
        job.delay_min_s +
        Math.random() * Math.max(0, job.delay_max_s - job.delay_min_s);
      cumMs += Math.round(gapS * 1000);
      await this.groupAddQueue.add(
        'invite-target',
        { jobId: id, targetId: target.id, tenantId, mode: 'invite' },
        {
          delay: cumMs,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 500 },
        },
      );
    }

    this.gateway.emitAddJobProgress(
      id,
      { invites_queued: targets.length },
      tenantId,
    );
    this.logger.log(`AddJob ${id}: ${targets.length} convites enfileirados`);
    return { queued: targets.length };
  }

  // Devolve alvos FAILED para PENDING (ex.: falha por bug de integracao, nao por bloqueio).
  async retryFailedTargets(tenantId: string, id: string) {
    const job = await this.assertAddJob(tenantId, id);
    if (job.status === 'RUNNING')
      throw new BadRequestException('Pause o job antes de re-tentar');

    // Conta antes de mexer: os dois desfechos voltam para a fila, mas cada um
    // desconta do seu proprio contador.
    const [failed, notJoined] = await Promise.all([
      this.prisma.addTarget.count({
        where: { job_id: id, status: 'FAILED' },
      }),
      this.prisma.addTarget.count({
        where: { job_id: id, status: 'NOT_JOINED' },
      }),
    ]);

    const { count } = await this.prisma.addTarget.updateMany({
      where: { job_id: id, status: { in: ['FAILED', 'NOT_JOINED'] } },
      data: { status: 'PENDING', attempts: 0, error: null },
    });
    if (count === 0)
      throw new BadRequestException('Nenhum alvo falhado para re-tentar');

    await this.prisma.groupAddJob.update({
      where: { id },
      data: {
        failed_count: Math.max(0, job.failed_count - failed),
        not_joined_count: Math.max(0, job.not_joined_count - notJoined),
        status: 'IDLE',
      },
    });
    this.gateway.emitAddJobProgress(
      id,
      { status: 'IDLE', retried: count },
      tenantId,
    );
    return { retried: count };
  }

  async pauseAddJob(tenantId: string, id: string) {
    await this.assertAddJob(tenantId, id);
    const updated = await this.prisma.groupAddJob.update({
      where: { id },
      data: { status: 'PAUSED' },
    });
    this.gateway.emitAddJobProgress(id, { status: 'PAUSED' }, tenantId);
    return updated;
  }

  async removeAddJob(tenantId: string, id: string) {
    await this.assertAddJob(tenantId, id);
    await this.prisma.groupAddJob.delete({ where: { id } });
  }

  /* ──────────────────────────────────────────────────
   *  Comum
   * ────────────────────────────────────────────────── */

  async listInstanceGroups(tenantId: string, instanceId: string) {
    const instance = await this.prisma.instance.findFirst({
      where: { id: instanceId, tenant_id: tenantId },
    });
    if (!instance) throw new NotFoundException('Instância não encontrada');
    const token = this.extractToken(instance.config);
    if (!token)
      throw new BadRequestException('Instância sem token UazAPI. Reconecte.');
    return this.uazapi.listGroups(token);
  }

  private async assertExtraction(tenantId: string, id: string) {
    const e = await this.prisma.groupExtraction.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!e) throw new NotFoundException('Extração não encontrada');
    return e;
  }

  private async assertAddJob(tenantId: string, id: string) {
    const j = await this.prisma.groupAddJob.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!j) throw new NotFoundException('Job de adição não encontrado');
    return j;
  }

  private extractToken(config: unknown): string | null {
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      const c = config as Record<string, unknown>;
      if (typeof c.uazapi_token === 'string' && c.uazapi_token.length > 0) {
        return c.uazapi_token;
      }
    }
    return null;
  }
}
