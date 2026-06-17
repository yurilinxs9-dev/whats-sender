import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HealthWorker } from './workers/health.worker';
import { GroupAddWorker } from './workers/group-add.worker';
import { QUEUE_HEALTH, QUEUE_GROUP_ADD } from './queue-constants';

export {
  QUEUE_DISPATCH,
  QUEUE_WARMUP,
  QUEUE_HEALTH,
  QUEUE_VALIDATE,
  QUEUE_GROUP_ADD,
} from './queue-constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_HEALTH }),
    BullModule.registerQueue({ name: QUEUE_GROUP_ADD }),
  ],
  providers: [HealthWorker, GroupAddWorker],
  exports: [BullModule],
})
export class QueuesModule {}
