import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UazApiService } from '../uazapi/uazapi.service';
import { SpinService } from '../spin/spin.service';
import { HealthMonitorService } from '../health-monitor/health-monitor.service';
import { SenderGateway } from '../websocket/websocket.gateway';
import { QUEUE_DISPATCH, QUEUE_VALIDATE } from '../queues/queue-constants';

interface DispatchJobData {
  dispatchId: string;
  campaignId: string;
  contactId: string;
  instanceId: string;
  templateId: string | null;
  tenantId: string;
}

interface SelectableInstance {
  id: string;
  nome: string;
  health_score: number;
  daily_sent: number;
  daily_limit: number;
}

@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private prisma: PrismaService,
    private uazApi: UazApiService,
    private spin: SpinService,
    private healthMonitor: HealthMonitorService,
    private gateway: SenderGateway,
    @InjectQueue(QUEUE_DISPATCH) private dispatchQueue: Queue,
    @InjectQueue(QUEUE_VALIDATE) private validateQueue: Queue,
  ) {}

  /**
   * Start a campaign -- the main entry point.
   * 1. Validate campaign is DRAFT/SCHEDULED
   * 2. Check send window (block 22h-7h)
   * 3. Create Dispatch records for all contacts in the list
   * 4. Filter out blacklisted contacts
   * 5. Filter out contacts contacted within frequency_cap_days
   * 6. Add dispatch jobs to BullMQ queue
   * 7. Update campaign status to RUNNING
   */
  async startCampaign(
    campaignId: string,
    tenantId: string,
  ): Promise<{ dispatched: number; skipped: number }> {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, tenant_id: tenantId },
      include: {
        template: true,
        contact_list: {
          include: { contacts: { include: { contact: true } } },
        },
        instances: { include: { instance: true } },
      },
    });

    if (!campaign) throw new NotFoundException('Campanha nao encontrada');
    if (!['DRAFT', 'SCHEDULED'].includes(campaign.status)) {
      throw new BadRequestException(
        'Campanha nao esta em status valido para iniciar',
      );
    }

    const settings = await this.prisma.tenantSettings.findUnique({
      where: { tenant_id: tenantId },
    });
    if (!this.isWithinSendWindow(settings)) {
      throw new BadRequestException(
        'Fora da janela de envio. Envios bloqueados entre 22h e 7h.',
      );
    }

    const activeInstances = campaign.instances
      .filter(
        (ci) =>
          ci.instance.status === 'connected' &&
          ci.instance.health_score > 20,
      )
      .map((ci) => ci.instance);

    if (activeInstances.length === 0) {
      throw new BadRequestException(
        'Nenhuma instancia ativa disponivel para esta campanha',
      );
    }

    const blacklist = await this.prisma.blacklist.findMany({
      where: { tenant_id: tenantId },
      select: { telefone: true },
    });
    const blacklistedSet = new Set(blacklist.map((b) => b.telefone));

    const freqCapDays = settings?.frequency_cap_days ?? 7;
    const freqCapDate = new Date(
      Date.now() - freqCapDays * 24 * 60 * 60 * 1000,
    );

    let dispatched = 0;
    let skipped = 0;
    const contacts = campaign.contact_list.contacts.map((lc) => lc.contact);

    for (const contact of contacts) {
      // Validate phone format — must be 12-13 digits starting with 55
      const phone = contact.telefone.replace(/\D/g, '');
      if (phone.length < 12 || phone.length > 13 || !phone.startsWith('55')) {
        skipped++;
        continue;
      }

      // Skip blacklisted
      if (blacklistedSet.has(contact.telefone)) {
        skipped++;
        continue;
      }

      // Skip blocked contacts
      if (contact.engagement === 'BLOCKED') {
        skipped++;
        continue;
      }

      // Skip frequency cap (contacted within X days)
      if (contact.last_contacted && contact.last_contacted > freqCapDate) {
        skipped++;
        continue;
      }

      // Smart rotation: pick instance with best weight
      const instance = this.selectInstance(activeInstances);

      const dispatch = await this.prisma.dispatch.create({
        data: {
          campaign_id: campaignId,
          contact_id: contact.id,
          instance_id: instance.id,
          instance_name: instance.nome,
          status: 'QUEUED',
        },
      });

      // Gaussian delay with staggering -- min 5s between messages (CLAUDE.md rule)
      const delayMin = Math.max(campaign.delay_min, 5) * 1000;
      const delayMax = campaign.delay_max * 1000;
      const delay = this.gaussianDelay(delayMin, delayMax) * dispatched;

      await this.dispatchQueue.add(
        'send-message',
        {
          dispatchId: dispatch.id,
          campaignId,
          contactId: contact.id,
          instanceId: instance.id,
          templateId: campaign.template_id,
          tenantId,
        } satisfies DispatchJobData,
        {
          delay,
          attempts: 2,
          backoff: { type: 'exponential', delay: 30000 },
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      );

      dispatched++;
    }

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: 'RUNNING',
        started_at: new Date(),
        total_contacts: dispatched + skipped,
      },
    });

    this.gateway.emitCampaignProgress(
      campaignId,
      {
        status: 'RUNNING',
        totalContacts: dispatched + skipped,
        dispatched,
        skipped,
      },
      tenantId,
    );

    this.logger.log(
      `Campaign ${campaignId} started: dispatched=${dispatched} skipped=${skipped}`,
    );

    return { dispatched, skipped };
  }

  /**
   * Pause a running campaign.
   */
  async pauseCampaign(
    campaignId: string,
    tenantId: string,
  ): Promise<void> {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, tenant_id: tenantId },
    });
    if (!campaign) throw new NotFoundException('Campanha nao encontrada');
    if (campaign.status !== 'RUNNING') {
      throw new BadRequestException('Campanha nao esta em execucao');
    }

    await this.prisma.dispatch.updateMany({
      where: {
        campaign_id: campaignId,
        status: { in: ['PENDING', 'QUEUED'] },
      },
      data: { status: 'SKIPPED' },
    });

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'PAUSED', paused_at: new Date() },
    });

    this.gateway.emitCampaignProgress(
      campaignId,
      { status: 'PAUSED' },
      tenantId,
    );

    this.logger.log(`Campaign ${campaignId} paused`);
  }

  /**
   * Resume a paused campaign -- re-queue skipped dispatches.
   */
  async resumeCampaign(
    campaignId: string,
    tenantId: string,
  ): Promise<{ requeued: number }> {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, tenant_id: tenantId },
      include: { instances: { include: { instance: true } } },
    });
    if (!campaign) throw new NotFoundException('Campanha nao encontrada');
    if (campaign.status !== 'PAUSED') {
      throw new BadRequestException('Campanha nao esta pausada');
    }

    const settings = await this.prisma.tenantSettings.findUnique({
      where: { tenant_id: tenantId },
    });
    if (!this.isWithinSendWindow(settings)) {
      throw new BadRequestException(
        'Fora da janela de envio. Envios bloqueados entre 22h e 7h.',
      );
    }

    const activeInstances = campaign.instances
      .filter(
        (ci) =>
          ci.instance.status === 'connected' &&
          ci.instance.health_score > 20,
      )
      .map((ci) => ci.instance);

    if (activeInstances.length === 0) {
      throw new BadRequestException(
        'Nenhuma instancia ativa disponivel para esta campanha',
      );
    }

    const skippedDispatches = await this.prisma.dispatch.findMany({
      where: { campaign_id: campaignId, status: 'SKIPPED' },
    });

    let requeued = 0;
    for (const dispatch of skippedDispatches) {
      const instance = this.selectInstance(activeInstances);

      await this.prisma.dispatch.update({
        where: { id: dispatch.id },
        data: {
          status: 'QUEUED',
          instance_id: instance.id,
          instance_name: instance.nome,
        },
      });

      const delayMin = Math.max(campaign.delay_min, 5) * 1000;
      const delayMax = campaign.delay_max * 1000;
      const delay = this.gaussianDelay(delayMin, delayMax) * requeued;

      await this.dispatchQueue.add(
        'send-message',
        {
          dispatchId: dispatch.id,
          campaignId,
          contactId: dispatch.contact_id,
          instanceId: instance.id,
          templateId: campaign.template_id,
          tenantId,
        } satisfies DispatchJobData,
        {
          delay,
          attempts: 2,
          backoff: { type: 'exponential', delay: 30000 },
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      );

      requeued++;
    }

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'RUNNING' },
    });

    this.gateway.emitCampaignProgress(
      campaignId,
      { status: 'RUNNING', requeued },
      tenantId,
    );

    this.logger.log(`Campaign ${campaignId} resumed: requeued=${requeued}`);

    return { requeued };
  }

  /**
   * Get dispatch progress for a campaign.
   */
  async getStatus(campaignId: string, tenantId: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, tenant_id: tenantId },
      select: {
        id: true,
        nome: true,
        status: true,
        total_contacts: true,
        total_sent: true,
        total_delivered: true,
        total_read: true,
        total_replied: true,
        total_failed: true,
        total_blocked: true,
        total_optout: true,
        started_at: true,
        finished_at: true,
      },
    });
    if (!campaign) throw new NotFoundException('Campanha nao encontrada');

    const statusCounts = await this.prisma.dispatch.groupBy({
      by: ['status'],
      where: { campaign_id: campaignId },
      _count: { status: true },
    });

    const byStatus: Record<string, number> = {};
    for (const row of statusCounts) {
      byStatus[row.status] = row._count.status;
    }

    return { campaign, byStatus };
  }

  /**
   * Process a single dispatch job -- called by the dispatch worker.
   * Never throws -- all errors are caught and handled.
   */
  async processDispatch(data: DispatchJobData): Promise<void> {
    const {
      dispatchId,
      campaignId,
      contactId,
      instanceId,
      templateId,
      tenantId,
    } = data;

    try {
      const [dispatch, campaign, contact, instance, template, settings] =
        await Promise.all([
          this.prisma.dispatch.findUnique({ where: { id: dispatchId } }),
          this.prisma.campaign.findUnique({ where: { id: campaignId } }),
          this.prisma.contact.findUnique({ where: { id: contactId } }),
          this.prisma.instance.findUnique({ where: { id: instanceId } }),
          templateId ? this.prisma.template.findUnique({ where: { id: templateId } }) : Promise.resolve(null),
          this.prisma.tenantSettings.findUnique({
            where: { tenant_id: tenantId },
          }),
        ]);

      if (!dispatch || !campaign || !contact || !instance) {
        this.logger.warn(
          `Dispatch ${dispatchId}: missing entity, marking FAILED`,
        );
        await this.markDispatch(dispatchId, 'FAILED');
        return;
      }

      // Get message content from template or inline
      const messageContent_raw = template?.content ?? campaign.inline_message ?? '';
      if (!messageContent_raw) {
        this.logger.warn(`Dispatch ${dispatchId}: no message content, marking FAILED`);
        await this.markDispatch(dispatchId, 'FAILED');
        return;
      }

      // Campaign cancelled/paused/completed check
      if (['CANCELLED', 'PAUSED', 'COMPLETED'].includes(campaign.status)) {
        this.logger.debug(
          `Dispatch ${dispatchId}: campaign ${campaign.status}, skipping`,
        );
        await this.markDispatch(dispatchId, 'SKIPPED');
        return;
      }

      // Send window check
      if (!this.isWithinSendWindow(settings)) {
        this.logger.debug(
          `Dispatch ${dispatchId}: outside send window, re-queuing in 1h`,
        );
        await this.dispatchQueue.add('send-message', data, {
          delay: 3600000,
        });
        return;
      }

      // Instance health check
      if (instance.health_score < 20 || instance.status !== 'connected') {
        this.logger.warn(
          `Dispatch ${dispatchId}: instance ${instance.nome} unhealthy (score=${instance.health_score} status=${instance.status})`,
        );
        await this.markDispatch(dispatchId, 'FAILED');
        return;
      }

      // Cooldown check
      if (instance.cooldown_until && instance.cooldown_until > new Date()) {
        this.logger.debug(
          `Dispatch ${dispatchId}: instance ${instance.nome} in cooldown, re-queuing in 1min`,
        );
        await this.dispatchQueue.add('send-message', data, { delay: 60000 });
        return;
      }

      // Daily limit check
      if (instance.daily_sent >= instance.daily_limit) {
        this.logger.warn(
          `Dispatch ${dispatchId}: instance ${instance.nome} daily limit reached (${instance.daily_sent}/${instance.daily_limit})`,
        );
        await this.markDispatch(dispatchId, 'SKIPPED');
        return;
      }

      const token =
        (instance.config as Record<string, string> | null)?.uazapi_token ?? '';

      // Update dispatch status to SENDING
      await this.markDispatch(dispatchId, 'SENDING');

      // L09: Composing Presence Simulator
      if (campaign.use_composing) {
        try {
          const typingTime = Math.max(
            1500,
            Math.min(5000, messageContent_raw.length * 50),
          );
          const jitter = -500 + Math.random() * 1000;
          const presence =
            (template?.type ?? 'TEXT') === 'AUDIO' ? 'recording' : 'composing';
          await this.uazApi.setPresence(token, contact.telefone, presence);
          await this.delay(typingTime + jitter);
        } catch (presenceError) {
          this.logger.warn(
            `Dispatch ${dispatchId}: presence simulation failed, continuing`,
          );
        }
      }

      // L05: Content Spin Engine
      const variables: Record<string, string> = {
        nome: contact.nome ?? '',
        telefone: contact.telefone,
      };

      let messageContent = messageContent_raw;
      if (campaign.use_spin && template?.has_spin) {
        messageContent = this.spin.processMessage(messageContent, variables);
      } else {
        messageContent = this.spin.resolveVariables(
          messageContent,
          variables,
        );
        messageContent = this.spin.addZeroWidthFingerprint(messageContent);
      }

      // Add opt-out if template has it
      if (template?.has_optout) {
        messageContent +=
          '\n\nResponda SAIR para nao receber mais mensagens.';
      }

      // Send based on type
      let result;
      switch (template?.type ?? 'TEXT') {
        case 'IMAGE':
          result = await this.uazApi.sendImage(
            token,
            contact.telefone,
            template!.media_url!,
            messageContent,
          );
          break;
        case 'VIDEO':
          result = await this.uazApi.sendVideo(
            token,
            contact.telefone,
            template!.media_url!,
            messageContent,
          );
          break;
        case 'AUDIO':
          result = await this.uazApi.sendAudio(
            token,
            contact.telefone,
            template!.media_url!,
          );
          break;
        case 'DOCUMENT':
          result = await this.uazApi.sendDocument(
            token,
            contact.telefone,
            template!.media_url!,
            template!.media_name ?? undefined,
          );
          break;
        default:
          result = await this.uazApi.sendText(
            token,
            contact.telefone,
            messageContent,
          );
      }

      if (result.success) {
        await this.prisma.dispatch.update({
          where: { id: dispatchId },
          data: {
            status: 'SENT',
            sent_at: new Date(),
            whatsapp_msg_id: result.messageId ?? null,
            spun_content: messageContent,
          },
        });

        await this.prisma.campaign.update({
          where: { id: campaignId },
          data: { total_sent: { increment: 1 } },
        });

        await this.prisma.contact.update({
          where: { id: contactId },
          data: {
            last_contacted: new Date(),
            times_contacted: { increment: 1 },
            ...(contact.engagement === 'UNKNOWN' && {
              engagement: 'COLD',
            }),
          },
        });

        await this.prisma.campaignInstance.updateMany({
          where: { campaign_id: campaignId, instance_id: instanceId },
          data: { msgs_sent: { increment: 1 } },
        });

        await this.healthMonitor.recordSendResult(
          instanceId,
          true,
          result.responseTimeMs,
        );

        // Emit progress
        const updatedCampaign = await this.prisma.campaign.findUnique({
          where: { id: campaignId },
          select: {
            total_sent: true,
            total_contacts: true,
            total_delivered: true,
            total_failed: true,
          },
        });
        if (updatedCampaign) {
          this.gateway.emitCampaignProgress(
            campaignId,
            {
              totalSent: updatedCampaign.total_sent,
              totalContacts: updatedCampaign.total_contacts,
              totalDelivered: updatedCampaign.total_delivered,
              totalFailed: updatedCampaign.total_failed,
            },
            tenantId,
          );
        }

        // Check if campaign complete
        await this.checkCampaignCompletion(campaignId, tenantId);

        this.logger.debug(
          `Dispatch ${dispatchId}: SENT to ${contact.telefone} via ${instance.nome}`,
        );
      } else {
        await this.prisma.dispatch.update({
          where: { id: dispatchId },
          data: { status: 'FAILED', error: result.error ?? 'Send failed' },
        });
        await this.prisma.campaign.update({
          where: { id: campaignId },
          data: { total_failed: { increment: 1 } },
        });
        await this.healthMonitor.recordSendResult(
          instanceId,
          false,
          result.responseTimeMs,
        );
        this.logger.warn(
          `Dispatch ${dispatchId}: FAILED - ${result.error ?? 'unknown error'}`,
        );
      }
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`Dispatch ${dispatchId} failed: ${errorMsg}`);

      try {
        await this.prisma.dispatch.update({
          where: { id: dispatchId },
          data: { status: 'FAILED', error: errorMsg },
        });
        await this.prisma.campaign.update({
          where: { id: campaignId },
          data: { total_failed: { increment: 1 } },
        });
        await this.healthMonitor.recordSendResult(instanceId, false);
      } catch (cleanupError) {
        this.logger.error(
          `Dispatch ${dispatchId}: cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : 'unknown'}`,
        );
      }
    }
  }

  // ---- Helper Methods ----

  private async markDispatch(id: string, status: string): Promise<void> {
    await this.prisma.dispatch.update({
      where: { id },
      data: { status: status as never },
    });
  }

  private async checkCampaignCompletion(
    campaignId: string,
    tenantId: string,
  ): Promise<void> {
    const pending = await this.prisma.dispatch.count({
      where: {
        campaign_id: campaignId,
        status: { in: ['PENDING', 'QUEUED', 'SENDING', 'VALIDATING'] },
      },
    });
    if (pending === 0) {
      await this.prisma.campaign.update({
        where: { id: campaignId },
        data: { status: 'COMPLETED', finished_at: new Date() },
      });
      this.gateway.emitCampaignCompleted(campaignId, tenantId);
      this.logger.log(`Campaign ${campaignId} completed`);
    }
  }

  /**
   * L01: Human Behavior Simulator -- Gaussian delay distribution (Box-Muller).
   */
  private gaussianDelay(min: number, max: number): number {
    const mean = (min + max) / 2;
    const stddev = (max - min) / 6;
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    const value = mean + z * stddev;
    return Math.max(min * 0.8, Math.min(max * 1.5, value));
  }

  /**
   * L04: Smart Rotation -- Weighted Round-Robin based on health and capacity.
   */
  private selectInstance(instances: SelectableInstance[]): SelectableInstance {
    const weights = instances.map((inst) => {
      const capacityRatio =
        1 - inst.daily_sent / Math.max(inst.daily_limit, 1);
      return {
        instance: inst,
        weight: inst.health_score * Math.max(capacityRatio, 0),
      };
    });

    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    if (totalWeight === 0) return instances[0];

    let random = Math.random() * totalWeight;
    for (const w of weights) {
      random -= w.weight;
      if (random <= 0) return w.instance;
    }
    return instances[0];
  }

  /**
   * Send window check -- block between 22h-7h (CLAUDE.md rule).
   */
  private isWithinSendWindow(
    settings: {
      send_window_start?: string;
      send_window_end?: string;
    } | null,
  ): boolean {
    // No settings = allow (dev/testing)
    if (!settings) return true;

    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const currentTime = hour * 60 + minute;

    const startStr = settings.send_window_start ?? '07:00';
    const endStr = settings.send_window_end ?? '22:00';

    const [startH, startM] = startStr.split(':').map(Number);
    const [endH, endM] = endStr.split(':').map(Number);

    const start = startH * 60 + startM;
    const end = endH * 60 + endM;

    return currentTime >= start && currentTime <= end;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
