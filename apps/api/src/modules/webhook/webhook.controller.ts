import { Controller, Post, Body, HttpCode, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SenderGateway } from '../websocket/websocket.gateway';
import { Public } from '../../common/decorators/public.decorator';
import type { UazApiWebhookPayload } from './webhook.types';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private prisma: PrismaService,
    private gateway: SenderGateway,
  ) {}

  @Public()
  @Post('uazapi')
  @HttpCode(200)
  async handleUazApiWebhook(
    @Body() body: UazApiWebhookPayload,
  ): Promise<{ received: boolean }> {
    this.logger.debug(`Webhook received: event=${body.event} messageId=${body.messageId ?? 'N/A'}`);

    try {
      switch (body.event) {
        case 'message.delivery':
          await this.handleDelivery(body);
          break;
        case 'message.read':
          await this.handleRead(body);
          break;
        case 'message.reply':
          await this.handleReply(body);
          break;
        case 'message.blocked':
          await this.handleBlock(body);
          break;
        case 'instance.status':
          await this.handleInstanceStatus(body);
          break;
        default:
          this.logger.warn(`Unknown webhook event: ${body.event}`);
      }
    } catch (error) {
      this.logger.error(
        `Webhook processing error: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }

    return { received: true };
  }

  private async handleDelivery(body: UazApiWebhookPayload): Promise<void> {
    if (!body.messageId) return;

    const dispatch = await this.prisma.dispatch.findUnique({
      where: { whatsapp_msg_id: body.messageId },
    });
    if (!dispatch) {
      this.logger.debug(`Delivery webhook: dispatch not found for messageId=${body.messageId}`);
      return;
    }

    await this.prisma.dispatch.update({
      where: { id: dispatch.id },
      data: { status: 'DELIVERED', delivered_at: new Date() },
    });

    await this.prisma.campaign.update({
      where: { id: dispatch.campaign_id },
      data: { total_delivered: { increment: 1 } },
    });

    if (dispatch.instance_id) {
      await this.prisma.instance.update({
        where: { id: dispatch.instance_id },
        data: { total_delivered: { increment: 1 } },
      });
    }

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: dispatch.campaign_id },
      select: { tenant_id: true, total_sent: true, total_contacts: true, total_delivered: true, total_failed: true },
    });
    if (campaign) {
      this.gateway.emitCampaignProgress(
        dispatch.campaign_id,
        {
          totalSent: campaign.total_sent,
          totalContacts: campaign.total_contacts,
          totalDelivered: campaign.total_delivered,
          totalFailed: campaign.total_failed,
        },
        campaign.tenant_id,
      );
    }

    this.logger.debug(`Delivery confirmed: dispatch=${dispatch.id}`);
  }

  private async handleRead(body: UazApiWebhookPayload): Promise<void> {
    if (!body.messageId) return;

    const dispatch = await this.prisma.dispatch.findUnique({
      where: { whatsapp_msg_id: body.messageId },
    });
    if (!dispatch) return;

    await this.prisma.dispatch.update({
      where: { id: dispatch.id },
      data: { status: 'READ', read_at: new Date() },
    });

    await this.prisma.campaign.update({
      where: { id: dispatch.campaign_id },
      data: { total_read: { increment: 1 } },
    });

    if (dispatch.instance_id) {
      await this.prisma.instance.update({
        where: { id: dispatch.instance_id },
        data: { total_read: { increment: 1 } },
      });
    }

    this.logger.debug(`Read confirmed: dispatch=${dispatch.id}`);
  }

  private async handleReply(body: UazApiWebhookPayload): Promise<void> {
    if (!body.messageId) return;

    const dispatch = await this.prisma.dispatch.findUnique({
      where: { whatsapp_msg_id: body.messageId },
      include: { contact: true },
    });
    if (!dispatch) return;

    await this.prisma.dispatch.update({
      where: { id: dispatch.id },
      data: { status: 'REPLIED', replied_at: new Date() },
    });

    await this.prisma.campaign.update({
      where: { id: dispatch.campaign_id },
      data: { total_replied: { increment: 1 } },
    });

    // Upgrade contact engagement
    const newEngagement =
      dispatch.contact.times_replied >= 2 ? 'HOT' : 'WARM';
    await this.prisma.contact.update({
      where: { id: dispatch.contact_id },
      data: {
        engagement: newEngagement,
        times_replied: { increment: 1 },
      },
    });

    // Check for opt-out keywords
    const optoutKeywords = ['sair', 'parar', 'cancelar', 'stop', 'remover'];
    if (
      body.replyContent &&
      optoutKeywords.some((kw) =>
        body.replyContent!.toLowerCase().trim().includes(kw),
      )
    ) {
      await this.handleOptout(dispatch.campaign_id, dispatch.contact_id, dispatch.contact.telefone);
    }

    this.logger.debug(`Reply received: dispatch=${dispatch.id}`);
  }

  private async handleBlock(body: UazApiWebhookPayload): Promise<void> {
    if (!body.messageId) return;

    const dispatch = await this.prisma.dispatch.findUnique({
      where: { whatsapp_msg_id: body.messageId },
      include: { campaign: true },
    });
    if (!dispatch) return;

    await this.prisma.dispatch.update({
      where: { id: dispatch.id },
      data: { status: 'BLOCKED', blocked_at: new Date() },
    });

    await this.prisma.campaign.update({
      where: { id: dispatch.campaign_id },
      data: { total_blocked: { increment: 1 } },
    });

    // Add to blacklist
    const contact = await this.prisma.contact.findUnique({
      where: { id: dispatch.contact_id },
    });
    if (contact) {
      await this.prisma.blacklist.upsert({
        where: {
          telefone_tenant_id: {
            telefone: contact.telefone,
            tenant_id: dispatch.campaign.tenant_id,
          },
        },
        update: {},
        create: {
          telefone: contact.telefone,
          reason: 'Blocked by contact',
          tenant_id: dispatch.campaign.tenant_id,
        },
      });

      await this.prisma.contact.update({
        where: { id: dispatch.contact_id },
        data: {
          engagement: 'BLOCKED',
          times_blocked: { increment: 1 },
        },
      });
    }

    if (dispatch.instance_id) {
      await this.prisma.instance.update({
        where: { id: dispatch.instance_id },
        data: { total_blocked: { increment: 1 } },
      });
    }

    // Check block rate -- if exceeds threshold, pause campaign
    await this.checkBlockRate(
      dispatch.campaign_id,
      dispatch.campaign.tenant_id,
    );

    this.logger.warn(`Block received: dispatch=${dispatch.id}`);
  }

  private async handleInstanceStatus(
    body: UazApiWebhookPayload,
  ): Promise<void> {
    if (!body.instanceName || !body.state) return;

    const statusMap: Record<string, string> = {
      open: 'connected',
      close: 'disconnected',
      connecting: 'connecting',
    };
    const mappedStatus = statusMap[body.state] ?? 'disconnected';

    const instance = await this.prisma.instance.findUnique({
      where: { nome: body.instanceName },
    });
    if (!instance) return;

    await this.prisma.instance.update({
      where: { id: instance.id },
      data: { status: mappedStatus },
    });

    this.gateway.emitInstanceStatusChanged(
      body.instanceName,
      mappedStatus,
      instance.tenant_id,
    );

    this.logger.log(
      `Instance status changed: ${body.instanceName} -> ${mappedStatus}`,
    );
  }

  private async handleOptout(
    campaignId: string,
    contactId: string,
    telefone: string,
  ): Promise<void> {
    await this.prisma.dispatch.updateMany({
      where: { campaign_id: campaignId, contact_id: contactId },
      data: { status: 'OPTOUT' },
    });

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { total_optout: { increment: 1 } },
    });

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { tenant_id: true },
    });

    if (campaign) {
      await this.prisma.blacklist.upsert({
        where: {
          telefone_tenant_id: {
            telefone,
            tenant_id: campaign.tenant_id,
          },
        },
        update: {},
        create: {
          telefone,
          reason: 'Opt-out by contact',
          tenant_id: campaign.tenant_id,
        },
      });
    }

    this.logger.log(`Opt-out processed: contact=${contactId} campaign=${campaignId}`);
  }

  private async checkBlockRate(
    campaignId: string,
    tenantId: string,
  ): Promise<void> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { total_sent: true, total_blocked: true, status: true },
    });
    if (!campaign || campaign.status !== 'RUNNING') return;
    if (campaign.total_sent < 10) return; // Too few messages to judge

    const settings = await this.prisma.tenantSettings.findUnique({
      where: { tenant_id: tenantId },
    });
    const threshold = settings?.block_rate_threshold ?? 0.02;

    const blockRate = campaign.total_blocked / campaign.total_sent;
    if (blockRate > threshold) {
      await this.prisma.campaign.update({
        where: { id: campaignId },
        data: { status: 'PAUSED', paused_at: new Date() },
      });

      this.gateway.emitCampaignProgress(
        campaignId,
        {
          status: 'PAUSED',
          reason: `Taxa de bloqueio (${(blockRate * 100).toFixed(1)}%) excedeu limite (${(threshold * 100).toFixed(1)}%)`,
        },
        tenantId,
      );

      this.logger.warn(
        `Campaign ${campaignId} auto-paused: block rate ${(blockRate * 100).toFixed(1)}% > ${(threshold * 100).toFixed(1)}%`,
      );
    }
  }
}
