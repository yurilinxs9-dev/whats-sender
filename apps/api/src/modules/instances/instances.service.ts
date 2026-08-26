import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SenderGateway } from '../websocket/websocket.gateway';
import { UazApiService } from '../uazapi/uazapi.service';
import { EvolutionService } from '../whatsapp/evolution.service';
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
    private evolution: EvolutionService,
  ) {}

  async list({ tenantId, page, limit, search, status }: ListParams) {
    const where: Record<string, unknown> = { tenant_id: tenantId };

    if (search) {
      where.nome = { contains: search, mode: 'insensitive' };
    }
    if (status) {
      where.status = status;
    }

    const [stored, total] = await Promise.all([
      this.prisma.instance.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.instance.count({ where }),
    ]);

    const instances = await this.syncEvolutionStatuses(stored, tenantId);

    return {
      instances,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * O banco so sabe o status de quando alguem conectou pela ultima vez; o
   * Evolution derruba sessao sem avisar. Como a credencial e a chave global,
   * da para conferir o estado real de toda a pagina em paralelo — a lista
   * passa a mostrar a verdade em vez do ultimo clique.
   */
  private async syncEvolutionStatuses<
    T extends { id: string; nome: string; status: string; config: unknown },
  >(instances: T[], tenantId: string): Promise<T[]> {
    const evo = instances.filter(
      (i) =>
        (i.config as InstanceConfig | null)?.provider === 'evolution' &&
        i.status !== 'banned',
    );
    if (evo.length === 0) return instances;

    const fresh = new Map<string, string>();
    await Promise.all(
      evo.map(async (i) => {
        const name =
          ((i.config as InstanceConfig).evolution_instance as string) ?? i.nome;
        try {
          fresh.set(i.id, await this.evolution.getConnectionState(name));
        } catch {
          // Evolution fora do ar: fica o status que o banco tem.
        }
      }),
    );

    for (const i of evo) {
      const state = fresh.get(i.id);
      if (!state || state === i.status) continue;
      await this.prisma.instance.update({
        where: { id: i.id },
        data: { status: state },
      });
      this.gateway.emitInstanceStatusChanged(i.nome, state, tenantId);
    }

    return instances.map((i) =>
      fresh.has(i.id) ? { ...i, status: fresh.get(i.id) as string } : i,
    );
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
    if (existing)
      throw new ConflictException('Ja existe uma instancia com este nome');

    // O provedor escolhido decide onde a sessao vive e o que guardamos como
    // credencial: token por instancia na UazAPI, nome da instancia no
    // Evolution.
    let config: Record<string, string>;
    if (data.provider === 'evolution') {
      await this.evolution.createInstance(data.nome);
      this.logger.log(`Evolution instance created: ${data.nome}`);
      config = { provider: 'evolution', evolution_instance: data.nome };
    } else {
      const uazResult = await this.uazApi.createInstance(data.nome);
      this.logger.log(
        `UazAPI instance created: ${uazResult.name} token=${uazResult.token.slice(0, 8)}...`,
      );
      config = {
        uazapi_token: uazResult.token,
        uazapi_instance_name: uazResult.name,
      };
    }

    const instance = await this.prisma.instance.create({
      data: {
        nome: data.nome,
        telefone: data.telefone,
        config,
        tenant_id: tenantId,
      },
    });

    this.gateway.emitInstanceStatusChanged(
      instance.nome,
      instance.status,
      tenantId,
    );
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
      if (existing)
        throw new ConflictException('Ja existe uma instancia com este nome');
    }

    const updated = await this.prisma.instance.update({
      where: { id },
      data: {
        ...(data.nome !== undefined && { nome: data.nome }),
        ...(data.telefone !== undefined && { telefone: data.telefone }),
        ...(data.daily_limit !== undefined && {
          daily_limit: data.daily_limit,
        }),
        ...(data.config !== undefined && { config: data.config }),
      },
    });

    this.gateway.emitInstanceStatusChanged(
      updated.nome,
      updated.status,
      tenantId,
    );
    return updated;
  }

  async remove(id: string, tenantId: string) {
    const instance = await this.prisma.instance.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!instance) throw new NotFoundException('Instancia nao encontrada');

    // Delete from UazAPI if we have a token
    const config = (instance.config as InstanceConfig) || {};
    const evolutionName = (config as { evolution_instance?: string })
      .evolution_instance;
    if (evolutionName) {
      await this.evolution.deleteInstance(evolutionName);
    } else if (config.uazapi_token) {
      try {
        await this.uazApi.deleteInstance(config.uazapi_token);
      } catch (err) {
        this.logger.warn(
          `Failed to delete UazAPI instance: ${(err as Error).message}`,
        );
      }
    }

    // Jobs de adicao apontam para a instancia sem cascade — apagar levaria
    // junto o progresso deles. Recusar com o motivo e melhor que devolver a
    // violacao de chave estrangeira crua, e a saida existe: trocar a
    // instancia do job em Config.
    const jobs = await this.prisma.groupAddJob.findMany({
      where: { dest_instance_id: id },
      select: { nome: true },
    });
    if (jobs.length > 0) {
      const nomes = jobs.map((j) => j.nome).join(', ');
      throw new BadRequestException(
        `Instância usada por ${jobs.length} job(s) de adição (${nomes}). ` +
          'Troque a instância desses jobs em Config antes de remover.',
      );
    }

    // Clean up related records that don't have onDelete: Cascade
    await this.prisma.$transaction([
      this.prisma.dispatch.updateMany({
        where: { instance_id: id },
        data: { instance_id: null },
      }),
      this.prisma.campaignInstance.deleteMany({
        where: { instance_id: id },
      }),
      this.prisma.buddyPair.deleteMany({
        where: { OR: [{ instance_id: id }, { buddy_id: id }] },
      }),
      this.prisma.instance.delete({ where: { id } }),
    ]);

    this.gateway.emitInstanceStatusChanged(instance.nome, 'deleted', tenantId);
    return { message: 'Instancia removida com sucesso' };
  }

  async connect(id: string, tenantId: string) {
    const instance = await this.prisma.instance.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!instance) throw new NotFoundException('Instancia nao encontrada');

    const config = (instance.config as InstanceConfig) || {};

    if ((config as { provider?: string }).provider === 'evolution') {
      const name =
        (config as { evolution_instance?: string }).evolution_instance ??
        instance.nome;
      const { qrcode, pairingCode } =
        await this.evolution.connectInstance(name);
      const state = await this.evolution.getConnectionState(name);
      await this.prisma.instance.update({
        where: { id },
        data: { status: state },
      });
      this.gateway.emitInstanceStatusChanged(instance.nome, state, tenantId);
      return {
        id: instance.id,
        nome: instance.nome,
        status: state,
        qrcode,
        pairingCode,
        profileName: null,
        owner: null,
      };
    }

    if (!config.uazapi_token) {
      throw new NotFoundException(
        'Instancia sem token UazAPI. Recrie a instancia.',
      );
    }

    // Call UazAPI connect to get QR code
    const result = await this.uazApi.connectInstance(config.uazapi_token);

    await this.prisma.instance.update({
      where: { id },
      data: { status: result.state },
    });

    this.gateway.emitInstanceStatusChanged(
      instance.nome,
      result.state,
      tenantId,
    );

    return {
      id: instance.id,
      nome: instance.nome,
      status: result.state,
      qrcode: result.qrcode || null,
      profileName: result.profileName || null,
      owner: result.owner || null,
    };
  }

  async connectByPhone(id: string, phoneNumber: string, tenantId: string) {
    const instance = await this.prisma.instance.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!instance) throw new NotFoundException('Instancia nao encontrada');

    const config = (instance.config as InstanceConfig) || {};
    if (!config.uazapi_token) {
      throw new NotFoundException(
        'Instancia sem token UazAPI. Recrie a instancia.',
      );
    }

    const result = await this.uazApi.connectWithPairingCode(
      config.uazapi_token,
      phoneNumber,
    );

    await this.prisma.instance.update({
      where: { id },
      data: { status: 'connecting' },
    });

    this.gateway.emitInstanceStatusChanged(
      instance.nome,
      'connecting',
      tenantId,
    );

    return {
      id: instance.id,
      nome: instance.nome,
      status: 'connecting',
      pairingCode: result.pairingCode,
    };
  }

  async getQrCode(id: string, tenantId: string) {
    const instance = await this.prisma.instance.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!instance) throw new NotFoundException('Instancia nao encontrada');

    const config = (instance.config as InstanceConfig) || {};

    if ((config as { provider?: string }).provider === 'evolution') {
      const name =
        ((config as { evolution_instance?: string }).evolution_instance as
          string | undefined) ?? instance.nome;
      const state = await this.evolution.getConnectionState(name);
      let qrcode: string | null = null;
      // Enquanto nao conectou, o Evolution gira o QR — busca um novo para a
      // tela nao ficar com codigo vencido.
      if (state !== 'connected') {
        try {
          qrcode = (await this.evolution.connectInstance(name)).qrcode;
        } catch {
          // QR indisponivel neste instante; o polling tenta de novo.
        }
      }
      if (state !== instance.status) {
        await this.prisma.instance.update({
          where: { id },
          data: { status: state },
        });
        this.gateway.emitInstanceStatusChanged(instance.nome, state, tenantId);
      }
      return {
        id: instance.id,
        nome: instance.nome,
        status: state,
        qrcode,
        profileName: null,
        owner: null,
      };
    }

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
      this.gateway.emitInstanceStatusChanged(
        instance.nome,
        result.state,
        tenantId,
      );
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

    const config = (instance.config as InstanceConfig) || {};
    if (config.uazapi_token) {
      await this.uazApi.logoutInstance(config.uazapi_token);
    }

    const updated = await this.prisma.instance.update({
      where: { id },
      data: { status: 'disconnected' },
    });

    this.gateway.emitInstanceStatusChanged(
      updated.nome,
      'disconnected',
      tenantId,
    );
    return updated;
  }

  async importByToken(
    data: { nome: string; uazapi_token: string; telefone?: string },
    tenantId: string,
  ) {
    const existing = await this.prisma.instance.findUnique({
      where: { nome: data.nome },
    });
    if (existing)
      throw new ConflictException('Ja existe uma instancia com este nome');

    // Validate token by checking status on UazAPI
    const status = await this.uazApi.getInstanceStatus(data.uazapi_token);

    const instance = await this.prisma.instance.create({
      data: {
        nome: data.nome,
        telefone: data.telefone || status.owner || null,
        status: status.state || 'disconnected',
        config: {
          uazapi_token: data.uazapi_token,
          uazapi_instance_name: data.nome,
        },
        tenant_id: tenantId,
      },
    });

    this.gateway.emitInstanceStatusChanged(
      instance.nome,
      instance.status,
      tenantId,
    );
    return instance;
  }

  getUazApiToken(instance: { config: unknown }): string | null {
    const config = (instance.config as InstanceConfig) || {};
    return config.uazapi_token || null;
  }
}
