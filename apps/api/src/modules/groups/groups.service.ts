import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UazApiService } from '../uazapi/uazapi.service';
import { SenderGateway } from '../websocket/websocket.gateway';
import { QUEUE_GROUP_ADD } from '../queues/queue-constants';
import { CreateGroupSyncDto } from './dto/create-group-sync.dto';
import type { GroupAddJobData } from '../queues/workers/group-add.worker';

const BATCH_SIZE = 5;
const BASE_DELAY_MS = 30_000;
const JITTER_MS = 60_000;

function randomDelay(): number {
  return BASE_DELAY_MS + Math.floor(Math.random() * JITTER_MS);
}

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(
    private prisma: PrismaService,
    private uazapi: UazApiService,
    private gateway: SenderGateway,
    @InjectQueue(QUEUE_GROUP_ADD) private groupAddQueue: Queue<GroupAddJobData>,
  ) {}

  async create(tenantId: string, dto: CreateGroupSyncDto) {
    const instance = await this.prisma.instance.findFirst({
      where: { id: dto.instance_id, tenant_id: tenantId },
    });
    if (!instance) throw new NotFoundException('Instance not found');
    if (instance.status !== 'connected') {
      throw new BadRequestException('Instance must be connected');
    }

    return this.prisma.groupSync.create({
      data: {
        nome: dto.nome,
        source_group_jid: dto.source_group_jid,
        dest_group_jid: dto.dest_group_jid,
        instance_id: dto.instance_id,
        tenant_id: tenantId,
        daily_add_cap: dto.daily_add_cap,
      },
    });
  }

  findAll(tenantId: string) {
    return this.prisma.groupSync.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
      include: { instance: { select: { nome: true, status: true } } },
    });
  }

  async findOne(tenantId: string, id: string) {
    const sync = await this.prisma.groupSync.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        instance: { select: { nome: true, status: true } },
        participants: { orderBy: { created_at: 'desc' } },
      },
    });
    if (!sync) throw new NotFoundException('GroupSync not found');
    return sync;
  }

  async extract(tenantId: string, id: string) {
    const sync = await this.assertOwner(tenantId, id);
    if (sync.status === 'ADDING') {
      throw new BadRequestException('Cannot re-extract while adding is in progress');
    }

    const instance = await this.prisma.instance.findUnique({ where: { id: sync.instance_id } });
    const instanceToken = this.extractToken(instance?.config);
    if (!instanceToken) throw new BadRequestException('Instance has no UazAPI token. Reconnect it.');

    await this.prisma.groupSync.update({
      where: { id },
      data: { status: 'EXTRACTING' },
    });
    this.gateway.emitGroupSyncProgress(id, { status: 'EXTRACTING' }, tenantId);

    try {
      const result = await this.uazapi.getGroupParticipants(
        instanceToken,
        sync.source_group_jid,
      );

      const jids = result.participants.map((p) => p.id);

      // Upsert to avoid duplicates on re-extract
      await Promise.all(
        jids.map((jid) =>
          this.prisma.groupSyncParticipant.upsert({
            where: { sync_id_jid: { sync_id: id, jid } },
            create: {
              sync_id: id,
              jid,
              phone: jid.replace('@s.whatsapp.net', '').replace('@c.us', ''),
              status: 'PENDING',
            },
            update: {}, // keep existing status if re-extracting
          }),
        ),
      );

      const updated = await this.prisma.groupSync.update({
        where: { id },
        data: { status: 'IDLE', extracted_count: jids.length },
      });

      this.gateway.emitGroupSyncProgress(id, { status: 'IDLE', extracted: jids.length }, tenantId);
      this.logger.log(`GroupSync ${id}: extracted ${jids.length} participants`);
      return updated;
    } catch (error) {
      await this.prisma.groupSync.update({ where: { id }, data: { status: 'FAILED' } });
      this.gateway.emitGroupSyncProgress(id, { status: 'FAILED' }, tenantId);
      throw error;
    }
  }

  async start(tenantId: string, id: string) {
    const sync = await this.assertOwner(tenantId, id);
    if (sync.status === 'ADDING') throw new BadRequestException('Already running');
    if (sync.extracted_count === 0) throw new BadRequestException('Extract participants first');

    const instance = await this.prisma.instance.findUnique({ where: { id: sync.instance_id } });
    const instanceToken = this.extractToken(instance?.config);
    if (!instanceToken) throw new BadRequestException('Instance has no UazAPI token. Reconnect it.');

    const pending = await this.prisma.groupSyncParticipant.findMany({
      where: { sync_id: id, status: 'PENDING' },
      select: { id: true },
    });

    if (pending.length === 0) throw new BadRequestException('No pending participants to add');

    await this.prisma.groupSync.update({ where: { id }, data: { status: 'ADDING' } });

    // Enqueue in batches — each job gets a growing delay for anti-ban jitter
    let jobIndex = 0;
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      for (const participant of batch) {
        const delay = randomDelay() * Math.ceil((jobIndex + 1) / BATCH_SIZE);
        await this.groupAddQueue.add(
          'add-participant',
          {
            syncId: id,
            participantId: participant.id,
            groupJid: sync.dest_group_jid,
            instanceToken,
            tenantId,
          },
          {
            delay,
            attempts: 3,
            backoff: { type: 'exponential', delay: 60_000 },
            removeOnComplete: { count: 500 },
            removeOnFail: { count: 200 },
          },
        );
        jobIndex++;
      }
    }

    this.gateway.emitGroupSyncProgress(id, { status: 'ADDING', queued: pending.length }, tenantId);
    this.logger.log(`GroupSync ${id}: enqueued ${pending.length} jobs`);
    return { queued: pending.length };
  }

  async pause(tenantId: string, id: string) {
    await this.assertOwner(tenantId, id);
    const updated = await this.prisma.groupSync.update({
      where: { id },
      data: { status: 'PAUSED' },
    });
    this.gateway.emitGroupSyncProgress(id, { status: 'PAUSED' }, tenantId);
    return updated;
  }

  async remove(tenantId: string, id: string) {
    await this.assertOwner(tenantId, id);
    await this.prisma.groupSync.delete({ where: { id } });
  }

  private async assertOwner(tenantId: string, id: string) {
    const sync = await this.prisma.groupSync.findFirst({ where: { id, tenant_id: tenantId } });
    if (!sync) throw new NotFoundException('GroupSync not found');
    return sync;
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
