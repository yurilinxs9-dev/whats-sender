import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_DISPATCH } from '../queue-constants';
import { DispatchService } from '../../dispatch/dispatch.service';

interface DispatchJobData {
  dispatchId: string;
  campaignId: string;
  contactId: string;
  instanceId: string;
  templateId: string;
  tenantId: string;
}

@Processor(QUEUE_DISPATCH)
export class DispatchWorker extends WorkerHost {
  private readonly logger = new Logger(DispatchWorker.name);

  constructor(private dispatchService: DispatchService) {
    super();
  }

  async process(job: Job<DispatchJobData>): Promise<void> {
    this.logger.log(
      `Processing dispatch job ${job.id}: dispatch=${job.data.dispatchId} campaign=${job.data.campaignId}`,
    );
    try {
      await this.dispatchService.processDispatch(job.data);
    } catch (error) {
      this.logger.error(
        `Dispatch worker error for job ${job.id}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      // Do not re-throw -- the dispatch service handles its own error recording.
      // Re-throwing would cause BullMQ to retry, but we already handle retries internally.
    }
  }
}
