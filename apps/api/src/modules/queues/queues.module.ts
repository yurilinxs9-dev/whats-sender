import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HealthWorker } from './workers/health.worker';
import { QUEUE_HEALTH } from './queue-constants';

export {
  QUEUE_DISPATCH,
  QUEUE_WARMUP,
  QUEUE_HEALTH,
  QUEUE_VALIDATE,
} from './queue-constants';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_HEALTH })],
  providers: [HealthWorker],
  exports: [BullModule],
})
export class QueuesModule {}
