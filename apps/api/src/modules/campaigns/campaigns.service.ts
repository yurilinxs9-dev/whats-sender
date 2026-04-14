import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SenderGateway } from '../websocket/websocket.gateway';
import type { CreateCampaignDto } from './dto/create-campaign.dto';
import type { UpdateCampaignDto } from './dto/update-campaign.dto';
import type { CampaignStatus } from '@prisma/client';

interface ListParams {
  tenantId: string;
  page: number;
  limit: number;
  search?: string;
  status?: string;
}

@Injectable()
export class CampaignsService {
  constructor(
    private prisma: PrismaService,
    private gateway: SenderGateway,
  ) {}

  async list({ tenantId, page, limit, search, status }: ListParams) {
    const where: Record<string, unknown> = { tenant_id: tenantId };

    if (search) {
      where.nome = { contains: search, mode: 'insensitive' };
    }
    if (status) {
      where.status = status as CampaignStatus;
    }

    const [campaigns, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          template: { select: { id: true, nome: true, type: true } },
          contact_list: { select: { id: true, nome: true, total_count: true } },
          instances: {
            include: {
              instance: { select: { id: true, nome: true, status: true, health_score: true } },
            },
          },
        },
      }),
      this.prisma.campaign.count({ where }),
    ]);

    return { campaigns, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        template: { select: { id: true, nome: true, type: true, content: true } },
        contact_list: { select: { id: true, nome: true, total_count: true, valid_count: true } },
        instances: {
          include: {
            instance: { select: { id: true, nome: true, status: true, health_score: true } },
          },
        },
      },
    });

    if (!campaign) throw new NotFoundException('Campanha nao encontrada');
    return campaign;
  }

  async create(data: CreateCampaignDto, tenantId: string) {
    // Validate template belongs to tenant (only if provided)
    if (data.template_id) {
      const template = await this.prisma.template.findFirst({
        where: { id: data.template_id, tenant_id: tenantId },
      });
      if (!template) throw new BadRequestException('Template nao encontrado');
    }
    if (!data.template_id && !data.inline_message) {
      throw new BadRequestException('Informe um template ou uma mensagem direta');
    }

    // Validate contact list belongs to tenant
    const contactList = await this.prisma.contactList.findFirst({
      where: { id: data.contact_list_id, tenant_id: tenantId },
    });
    if (!contactList) throw new BadRequestException('Lista de contatos nao encontrada ou nao pertence ao tenant');

    // Validate all instances belong to tenant
    const instances = await this.prisma.instance.findMany({
      where: { id: { in: data.instance_ids }, tenant_id: tenantId },
      select: { id: true },
    });
    if (instances.length !== data.instance_ids.length) {
      throw new BadRequestException('Uma ou mais instancias nao foram encontradas ou nao pertencem ao tenant');
    }

    // Create campaign + campaign instances in a transaction
    const campaign = await this.prisma.$transaction(async (tx) => {
      const created = await tx.campaign.create({
        data: {
          nome: data.nome,
          template_id: data.template_id ?? undefined,
          inline_message: data.inline_message ?? undefined,
          contact_list_id: data.contact_list_id,
          tenant_id: tenantId,
          delay_min: data.delay_min,
          delay_max: data.delay_max,
          scheduled_at: data.scheduled_at ? new Date(data.scheduled_at) : undefined,
          use_spin: data.use_spin,
          use_composing: data.use_composing,
          total_contacts: contactList.total_count,
          total_valid: contactList.valid_count,
        },
      });

      // Create CampaignInstance records
      await tx.campaignInstance.createMany({
        data: data.instance_ids.map((instanceId) => ({
          campaign_id: created.id,
          instance_id: instanceId,
        })),
      });

      return created;
    });

    // Re-fetch with includes
    const full = await this.findOne(campaign.id, tenantId);

    this.gateway.emitCampaignProgress(
      campaign.id,
      { status: 'DRAFT', nome: campaign.nome },
      tenantId,
    );

    return full;
  }

  async update(id: string, data: UpdateCampaignDto, tenantId: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!campaign) throw new NotFoundException('Campanha nao encontrada');

    if (campaign.status !== 'DRAFT') {
      throw new BadRequestException('Somente campanhas em rascunho podem ser editadas');
    }

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: {
        ...(data.nome !== undefined && { nome: data.nome }),
        ...(data.delay_min !== undefined && { delay_min: data.delay_min }),
        ...(data.delay_max !== undefined && { delay_max: data.delay_max }),
        ...(data.use_spin !== undefined && { use_spin: data.use_spin }),
        ...(data.use_composing !== undefined && { use_composing: data.use_composing }),
      },
      include: {
        template: { select: { id: true, nome: true, type: true } },
        contact_list: { select: { id: true, nome: true, total_count: true } },
        instances: {
          include: {
            instance: { select: { id: true, nome: true, status: true, health_score: true } },
          },
        },
      },
    });

    return updated;
  }

  async remove(id: string, tenantId: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!campaign) throw new NotFoundException('Campanha nao encontrada');

    const deletableStatuses: CampaignStatus[] = ['DRAFT', 'CANCELLED', 'COMPLETED'];
    if (!deletableStatuses.includes(campaign.status)) {
      throw new BadRequestException('Somente campanhas em rascunho, canceladas ou concluidas podem ser excluidas');
    }

    await this.prisma.campaign.delete({ where: { id } });

    return { message: 'Campanha removida com sucesso' };
  }

  async cancel(id: string, tenantId: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!campaign) throw new NotFoundException('Campanha nao encontrada');

    const cancellableStatuses: CampaignStatus[] = ['DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED'];
    if (!cancellableStatuses.includes(campaign.status)) {
      throw new BadRequestException('Esta campanha nao pode ser cancelada no status atual');
    }

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    this.gateway.emitCampaignProgress(
      id,
      { status: 'CANCELLED', nome: updated.nome },
      tenantId,
    );

    return updated;
  }
}
