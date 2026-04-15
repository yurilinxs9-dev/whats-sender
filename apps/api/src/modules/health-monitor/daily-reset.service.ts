import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WarmupService } from '../warmup/warmup.service';
import { HealthMonitorService } from './health-monitor.service';

@Injectable()
export class DailyResetService {
  private readonly logger = new Logger(DailyResetService.name);

  constructor(
    private prisma: PrismaService,
    private warmupService: WarmupService,
    private healthMonitor: HealthMonitorService,
  ) {}

  /**
   * Check health of all connected instances every 2 minutes.
   */
  @Cron('*/2 * * * *')
  async checkAllInstancesHealth(): Promise<void> {
    const instances = await this.prisma.instance.findMany({
      where: { status: { in: ['connected', 'connecting'] } },
      select: { id: true },
    });

    for (const inst of instances) {
      try {
        await this.healthMonitor.checkInstance(inst.id);
      } catch (error) {
        this.logger.warn(`Health check failed for ${inst.id}: ${error instanceof Error ? error.message : 'unknown'}`);
      }
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async resetDailyCounters(): Promise<void> {
    this.logger.log('Resetting daily counters for all instances...');
    await this.prisma.instance.updateMany({
      data: {
        daily_sent: 0,
        buddy_sent_today: 0,
        last_daily_reset: new Date(),
      },
    });

    // Also reset buddy pair daily counters
    await this.prisma.buddyPair.updateMany({
      data: { msgs_today: 0 },
    });

    // Increment warmup days for active instances
    await this.warmupService.incrementWarmupDays();
    this.logger.log('Daily counters reset + warmup days incremented.');
  }

  @Cron('0 0 * * 1') // Every Monday at midnight
  async resetWeeklyCounters(): Promise<void> {
    this.logger.log('Resetting weekly counters...');
    await this.prisma.instance.updateMany({
      data: {
        weekly_sent: 0,
        last_weekly_reset: new Date(),
      },
    });
    this.logger.log('Weekly counters reset complete.');
  }
}
