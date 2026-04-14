import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_WARMUP } from '../queue-constants';
import { WarmupService } from '../../warmup/warmup.service';

interface WarmupJobData {
  instanceId: string;
}

@Processor(QUEUE_WARMUP)
export class WarmupWorker extends WorkerHost {
  private readonly logger = new Logger(WarmupWorker.name);

  constructor(private warmupService: WarmupService) {
    super();
  }

  async process(job: Job<WarmupJobData>): Promise<void> {
    this.logger.log(`Warmup cycle for instance ${job.data.instanceId}`);
    try {
      await this.warmupService.executeWarmupCycle(job.data.instanceId);
    } catch (error) {
      this.logger.error(
        `Warmup cycle failed for ${job.data.instanceId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      throw error;
    }
  }
}
