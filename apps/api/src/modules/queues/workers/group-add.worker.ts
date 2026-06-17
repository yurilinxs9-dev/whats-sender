import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_GROUP_ADD } from '../queue-constants';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { UazApiService } from '../../uazapi/uazapi.service';
import { SenderGateway } from '../../websocket/websocket.gateway';

export interface GroupAddJobData {
  syncId: string;
  participantId: string;
  groupJid: string;
  instanceToken: string;
  tenantId: string;
}

const DAILY_RESET_HOUR = 0;

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
    const { syncId, participantId, groupJid, instanceToken, tenantId } = job.data;

    const sync = await this.prisma.groupSync.findUnique({ where: { id: syncId } });
    if (!sync || sync.status === 'PAUSED' || sync.status === 'FAILED') {
      await this.markParticipant(participantId, 'SKIPPED');
      return;
    }

    await this.resetDailyCountIfNeeded(syncId);

    const freshSync = await this.prisma.groupSync.findUnique({ where: { id: syncId } });
    if (freshSync && freshSync.added_today >= freshSync.daily_add_cap) {
      this.logger.warn(`GroupSync ${syncId} hit daily cap (${freshSync.daily_add_cap}). Re-queuing for tomorrow.`);
      await this.markParticipant(participantId, 'PENDING');
      // Delay until next midnight
      const msUntilMidnight = this.msUntilHour(DAILY_RESET_HOUR + 1);
      throw Object.assign(new Error('daily_cap_reached'), { delay: msUntilMidnight });
    }

    const settings = await this.prisma.tenantSettings.findUnique({ where: { tenant_id: tenantId } });
    if (settings && !this.isWithinSendWindow(settings.send_window_start, settings.send_window_end)) {
      this.logger.log(`GroupSync ${syncId} outside send window. Re-queuing.`);
      await this.markParticipant(participantId, 'PENDING');
      const msUntilWindow = this.msUntilWindowOpen(settings.send_window_start);
      throw Object.assign(new Error('outside_send_window'), { delay: msUntilWindow });
    }

    await this.prisma.groupSyncParticipant.update({
      where: { id: participantId },
      data: { status: 'PROCESSING', attempts: { increment: 1 } },
    });

    try {
      const result = await this.uazapi.addGroupParticipants(instanceToken, groupJid, [
        (await this.prisma.groupSyncParticipant.findUnique({ where: { id: participantId } }))!.jid,
      ]);

      const succeeded = result.added.some((r) => r.status === '200' || r.status === 'success');
      const errorStatus = result.failed[0]?.status;

      if (succeeded) {
        await this.prisma.groupSyncParticipant.update({
          where: { id: participantId },
          data: { status: 'DONE', added_at: new Date() },
        });
        await this.prisma.groupSync.update({
          where: { id: syncId },
          data: { added_count: { increment: 1 }, added_today: { increment: 1 } },
        });
      } else {
        await this.markParticipant(participantId, 'FAILED', errorStatus ?? 'unknown error');
        await this.prisma.groupSync.update({
          where: { id: syncId },
          data: { failed_count: { increment: 1 } },
        });
      }

      const updated = await this.prisma.groupSync.findUnique({ where: { id: syncId } });
      if (updated) {
        this.gateway.emitGroupSyncProgress(syncId, {
          added: updated.added_count,
          failed: updated.failed_count,
          extracted: updated.extracted_count,
        }, tenantId);

        const pending = await this.prisma.groupSyncParticipant.count({
          where: { sync_id: syncId, status: { in: ['PENDING', 'PROCESSING'] } },
        });
        if (pending === 0) {
          await this.prisma.groupSync.update({
            where: { id: syncId },
            data: { status: 'COMPLETED', last_run_at: new Date() },
          });
          this.gateway.emitGroupSyncCompleted(syncId, tenantId);
        }
      }
    } catch (error) {
      this.logger.error(`GroupAddWorker error for participant ${participantId}: ${(error as Error).message}`);
      await this.markParticipant(participantId, 'FAILED', (error as Error).message);
      await this.prisma.groupSync.update({
        where: { id: syncId },
        data: { failed_count: { increment: 1 } },
      });
    }
  }

  private async markParticipant(id: string, status: string, error?: string) {
    await this.prisma.groupSyncParticipant.update({
      where: { id },
      data: { status: status as 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED' | 'SKIPPED', ...(error && { error }) },
    });
  }

  private async resetDailyCountIfNeeded(syncId: string) {
    const sync = await this.prisma.groupSync.findUnique({ where: { id: syncId } });
    if (!sync) return;
    const lastReset = sync.last_reset_at;
    const now = new Date();
    const sameDay =
      lastReset.getFullYear() === now.getFullYear() &&
      lastReset.getMonth() === now.getMonth() &&
      lastReset.getDate() === now.getDate();
    if (!sameDay) {
      await this.prisma.groupSync.update({
        where: { id: syncId },
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
