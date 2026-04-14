import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_VALIDATE } from '../queue-constants';

interface ValidateJobData {
  contactId: string;
  instanceId: string;
}

@Processor(QUEUE_VALIDATE)
export class ValidateWorker extends WorkerHost {
  private readonly logger = new Logger(ValidateWorker.name);

  async process(job: Job<ValidateJobData>): Promise<void> {
    this.logger.log(
      `Processing validate job ${job.id}: contact=${job.data.contactId}`,
    );
    // TODO: Implement in Phase 4
  }
}
