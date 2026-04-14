import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SenderGateway } from '../websocket/websocket.gateway';
import { UazApiService } from '../uazapi/uazapi.service';
import type { CreateInstanceDto } from './dto/create-instance.dto';
import type { UpdateInstanceDto } from './dto/update-instance.dto';

interface InstanceConfig {
  uazapi_token?: string;
  uazapi_instance_name?: string;
  [key: string]: unknown;
}

interface ListParams {
  tenantId: string;
  page: number;
  limit: number;
  search?: string;
  status?: string;
}

@Injectable()
export class InstancesService {
  private readonly logger = new Logger(InstancesService.name);

  constructor(
    private prisma: PrismaService,
    private gateway: SenderGateway,
    private uazApi: UazApiService,
  ) {}

  async list({ tenantId, page, limit, search, status }: ListParams) {
    const where: Record<string, unknown> = { tenant_id: tenantId };

    if (search) {
      where.nome = { contains: search, mode: 'insensitive' };
    }
    if (status) {
      where.status = status;
    }

    const [instances, total] = await Promise.all([
      this.prisma.instance.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.instance.count({ where }),
    ]);

    return { instances, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string) {
    const instance = await this.prisma.instance.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        health_logs: {
          orderBy: { created_at: 'desc' },
          take: 10,
        },
      },
    });

    if (!instance) throw new NotFoundException('Instancia nao encontrada');
    return instance;
  }

  async create(data: CreateInstanceDto, tenantId: string) {
    const existing = await this.prisma.instance.findUnique({
      where: { nome: data.nome },
    });
    if (existing) throw new ConflictException('Ja existe uma instancia com este nome');

    // Create instance on UazAPI
    const uazResult = await this.uazApi.createInstance(data.nome);
    this.logger.log(`UazAPI instance created: ${uazResult.name} token=${uazResult.token.slice(0, 8)}...`);

    const instance = await this.prisma.instance.create({
      data: {
        nome: data.nome,
        telefone: data.telefone,
        config: {
          uazapi_token: uazResult.token,
          uazapi_instance_name: uazResult.name,
        },
        tenant_id: tenantId,
      },
    });

    this.gateway.emitInstanceStatusChanged(instance.nome, instance.status, tenantId);
    return instance;
  }

  async update(id: string, data: UpdateInstanceDto, tenantId: string) {
    const instance = await this.prisma.instance.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!instance) throw new NotFoundException('Instancia nao encontrada');

    if (data.nome && data.nome !== instance.nome) {
      const existing = await this.prisma.instance.findUnique({
        where: { nome: data.nome },
      });
      if (existing) throw new ConflictException('Ja existe uma instancia com este nome');
    }

    const updated = await this.prisma.instance.update({
      where: { id },
      data: {
        ...(data.nome !== undefined && { nome: data.nome }),
        ...(data.telefone !== undefined && { telefone: data.telefone }),
        ...(data.daily_limit !== undefined && { daily_limit: data.daily_limit }),
        ...(data.config !== undefined && { config: data.config }),
      },
    });

    this.gateway.emitInstanceStatusChanged(updated.nome, updated.status, tenantId);
    return updated;
  }

  async remove(id: string, tenantId: string) {
    const instance = await this.prisma.instance.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!instance) throw new NotFoundException('Instancia nao encontrada');

    // Delete from UazAPI if we have a token
    const config = (instance.config as InstanceConfig) || {};
    if (config.uazapi_token) {
      try {
        await this.uazApi.deleteInstance(config.uazapi_token);
      } catch (err) {
        this.logger.warn(`Failed to delete UazAPI instance: ${(err as Error).message}`);
      }
    }

    await this.prisma.instance.delete({ where: { id } });
    this.gateway.emitInstanceStatusChanged(instance.nome, 'deleted', tenantId);
    return { message: 'Instancia removida com sucesso' };
  }

  async connect(id: string, tenantId: string) {
    const instance = await this.prisma.instance.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!instance) throw new NotFoundException('Instancia nao encontrada');

    const config = (instance.config as InstanceConfig) || {};
    if (!config.uazapi_token) {
      throw new NotFoundException('Instancia sem token UazAPI. Recrie a instancia.');
    }

    // Call UazAPI connect to get QR code
    const result = await this.uazApi.connectInstance(config.uazapi_token);

    await this.prisma.instance.update({
      where: { id },
      data: { status: result.state },
    });

    this.gateway.emitInstanceStatusChanged(instance.nome, result.state, tenantId);

    return {
      id: instance.id,
      nome: instance.nome,
      status: result.state,
      qrcode: result.qrcode || null,
      profileName: result.profileName || null,
      owner: result.owner || null,
    };
  }

  async getQrCode(id: string, tenantId: string) {
    const instance = await this.prisma.instance.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!instance) throw new NotFoundException('Instancia nao encontrada');

    const config = (instance.config as InstanceConfig) || {};
    if (!config.uazapi_token) {
      throw new NotFoundException('Instancia sem token UazAPI.');
    }

    const result = await this.uazApi.getInstanceStatus(config.uazapi_token);

    // Update local status
    if (result.state !== instance.status) {
      await this.prisma.instance.update({
        where: { id },
        data: {
          status: result.state,
          ...(result.owner && { telefone: result.owner }),
        },
      });
      this.gateway.emitInstanceStatusChanged(instance.nome, result.state, tenantId);
    }

    return {
      id: instance.id,
      nome: instance.nome,
      status: result.state,
      qrcode: result.qrcode || null,
      profileName: result.profileName || null,
      owner: result.owner || null,
    };
  }

  async disconnect(id: string, tenantId: string) {
    const instance = await this.prisma.instance.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!instance) throw new NotFoundException('Instancia nao encontrada');

    const updated = await this.prisma.instance.update({
      where: { id },
      data: { status: 'disconnected' },
    });

    this.gateway.emitInstanceStatusChanged(updated.nome, 'disconnected', tenantId);
    return updated;
  }

  getUazApiToken(instance: { config: unknown }): string | null {
    const config = (instance.config as InstanceConfig) || {};
    return config.uazapi_token || null;
  }
}
