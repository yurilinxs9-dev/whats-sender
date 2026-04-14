import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WarmupService } from './warmup.service';
import { WarmupController } from './warmup.controller';
import { WarmupWorker } from '../queues/workers/warmup.worker';
import { QUEUE_WARMUP } from '../queues/queue-constants';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_WARMUP })],
  providers: [WarmupService, WarmupWorker],
  controllers: [WarmupController],
  exports: [WarmupService],
})
export class WarmupModule {}
