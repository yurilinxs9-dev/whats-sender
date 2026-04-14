import { Global, Module } from '@nestjs/common';
import { HealthMonitorService } from './health-monitor.service';
import { DailyResetService } from './daily-reset.service';

@Global()
@Module({
  providers: [HealthMonitorService, DailyResetService],
  exports: [HealthMonitorService],
})
export class HealthMonitorModule {}
