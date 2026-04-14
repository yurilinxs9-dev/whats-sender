import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Req,
  HttpCode,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { WarmupService } from './warmup.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QUEUE_WARMUP } from '../queues/queue-constants';
import type { AuthUser } from '../../common/types/auth-user';

@Controller('warmup')
export class WarmupController {
  constructor(
    private warmupService: WarmupService,
    private prisma: PrismaService,
    @InjectQueue(QUEUE_WARMUP) private warmupQueue: Queue,
  ) {}

  private async verifyInstanceOwnership(instanceId: string, tenantId: string) {
    const instance = await this.prisma.instance.findUnique({
      where: { id: instanceId },
      select: { id: true, tenant_id: true },
    });

    if (!instance) throw new NotFoundException('Instancia nao encontrada');
    if (instance.tenant_id !== tenantId) throw new ForbiddenException('Acesso negado');

    return instance;
  }

  @Post(':instanceId/start')
  @HttpCode(200)
  async start(
    @Param('instanceId') instanceId: string,
    @Req() req: Request & { user: AuthUser },
  ) {
    await this.verifyInstanceOwnership(instanceId, req.user.tenantId);
    await this.warmupService.startWarmup(instanceId, this.warmupQueue);
    return { message: 'Warmup iniciado' };
  }

  @Post(':instanceId/stop')
  @HttpCode(200)
  async stop(
    @Param('instanceId') instanceId: string,
    @Req() req: Request & { user: AuthUser },
  ) {
    await this.verifyInstanceOwnership(instanceId, req.user.tenantId);
    await this.warmupService.stopWarmup(instanceId, this.warmupQueue);
    return { message: 'Warmup parado' };
  }

  @Get(':instanceId/status')
  async status(
    @Param('instanceId') instanceId: string,
    @Req() req: Request & { user: AuthUser },
  ) {
    await this.verifyInstanceOwnership(instanceId, req.user.tenantId);
    const data = await this.warmupService.getStatus(instanceId);
    if (!data) throw new NotFoundException('Instancia nao encontrada');
    return data;
  }

  @Get(':instanceId/logs')
  async logs(
    @Param('instanceId') instanceId: string,
    @Req() req: Request & { user: AuthUser },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    await this.verifyInstanceOwnership(instanceId, req.user.tenantId);
    return this.warmupService.getLogs(
      instanceId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }
}
