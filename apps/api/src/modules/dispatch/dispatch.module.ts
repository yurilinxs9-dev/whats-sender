import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DispatchService } from './dispatch.service';
import { DispatchController } from './dispatch.controller';
import { DispatchWorker } from '../queues/workers/dispatch.worker';
import { ValidateWorker } from '../queues/workers/validate.worker';
import { QUEUE_DISPATCH, QUEUE_VALIDATE } from '../queues/queue-constants';

@Global()
@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_DISPATCH },
      { name: QUEUE_VALIDATE },
    ),
  ],
  controllers: [DispatchController],
  providers: [DispatchService, DispatchWorker, ValidateWorker],
  exports: [DispatchService],
})
export class DispatchModule {}
