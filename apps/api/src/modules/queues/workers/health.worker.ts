import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_HEALTH } from '../queue-constants';
import { HealthMonitorService } from '../../health-monitor/health-monitor.service';

interface HealthJobData {
  instanceId: string;
}

@Processor(QUEUE_HEALTH)
export class HealthWorker extends WorkerHost {
  private readonly logger = new Logger(HealthWorker.name);

  constructor(private healthMonitor: HealthMonitorService) {
    super();
  }

  async process(job: Job<HealthJobData>): Promise<void> {
    const { instanceId } = job.data;
    this.logger.debug(
      `Processing health job ${job.id}: instance=${instanceId}`,
    );

    try {
      await this.healthMonitor.checkInstance(instanceId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Health check failed for instance ${instanceId}: ${message}`,
      );
      // Do not rethrow — health checks should never block the queue
    }
  }
}
