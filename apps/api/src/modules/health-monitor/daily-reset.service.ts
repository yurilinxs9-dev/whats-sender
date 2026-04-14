import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class DailyResetService {
  private readonly logger = new Logger(DailyResetService.name);

  constructor(private prisma: PrismaService) {}

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
    this.logger.log('Daily counters reset complete.');
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
