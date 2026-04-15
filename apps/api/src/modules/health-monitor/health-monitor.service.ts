import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UazApiService } from '../uazapi/uazapi.service';
import { SenderGateway } from '../websocket/websocket.gateway';

interface CircuitAction {
  level: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'CRITICAL';
  cooldownUntil: Date | null;
  alert: boolean;
  message: string;
}

interface HealthAlertPayload {
  instanceId: string;
  instanceName: string;
  healthScore: number;
  level: string;
  message: string;
  [key: string]: unknown;
}

@Injectable()
export class HealthMonitorService {
  private readonly logger = new Logger(HealthMonitorService.name);

  constructor(
    private prisma: PrismaService,
    private uazApi: UazApiService,
    private gateway: SenderGateway,
  ) {}

  /**
   * Check health of a single instance by pinging UazAPI.
   * Never throws — all errors are handled and logged.
   */
  async checkInstance(instanceId: string): Promise<void> {
    const instance = await this.prisma.instance.findUnique({
      where: { id: instanceId },
    });
    if (!instance) {
      this.logger.warn(`Instance ${instanceId} not found, skipping health check`);
      return;
    }

    const token =
      (instance.config as Record<string, string> | null)?.uazapi_token ?? '';

    // Cooldown recovery: if in cooldown and score < 70, add +2
    if (instance.cooldown_until && instance.cooldown_until > new Date()) {
      const recoveredScore = Math.min(70, instance.health_score + 2);
      if (recoveredScore !== instance.health_score) {
        this.logger.debug(
          `Instance ${instance.nome} in cooldown — recovering score ${instance.health_score} -> ${recoveredScore}`,
        );
        await this.prisma.instance.update({
          where: { id: instanceId },
          data: { health_score: recoveredScore },
        });
        await this.prisma.instanceHealthLog.create({
          data: {
            instance_id: instanceId,
            health_score: recoveredScore,
            event: 'cooldown_recovery',
            details: { previousScore: instance.health_score },
          },
        });
      }
      return;
    }

    try {
      const status = await this.uazApi.getInstanceStatus(token);
      const mappedStatus = this.mapStatus(status.state);

      let scoreChange = 0;
      let event = 'heartbeat';

      if (mappedStatus === 'connected') {
        scoreChange = +1;
        event = 'heartbeat';
      } else if (mappedStatus === 'disconnected') {
        scoreChange = -25;
        event = 'disconnect';
      } else if (mappedStatus === 'connecting') {
        scoreChange = 0;
        event = 'connecting';
      }

      const newScore = this.clampScore(instance.health_score + scoreChange);
      const circuitAction = this.getCircuitAction(newScore, instance.health_score);

      this.logger.debug(
        `Instance ${instance.nome}: state=${status.state} mapped=${mappedStatus} score=${instance.health_score}->${newScore} circuit=${circuitAction.level}`,
      );

      await this.prisma.instance.update({
        where: { id: instanceId },
        data: {
          health_score: newScore,
          ...(mappedStatus !== instance.status && { status: mappedStatus }),
          consecutive_fails:
            mappedStatus === 'connected' ? 0 : instance.consecutive_fails + 1,
          last_error:
            mappedStatus !== 'connected' ? `Status: ${status.state}` : null,
          cooldown_until: circuitAction.cooldownUntil,
        },
      });

      await this.prisma.instanceHealthLog.create({
        data: {
          instance_id: instanceId,
          health_score: newScore,
          event,
          details: {
            previousScore: instance.health_score,
            statusResponse: status.state,
            circuitAction: circuitAction.level,
          },
        },
      });

      if (mappedStatus !== instance.status) {
        this.gateway.emitInstanceStatusChanged(
          instance.nome,
          mappedStatus,
          instance.tenant_id,
        );
      }

      if (circuitAction.alert) {
        const alertPayload: HealthAlertPayload = {
          instanceId,
          instanceName: instance.nome,
          healthScore: newScore,
          level: circuitAction.level,
          message: circuitAction.message,
        };
        this.gateway.emitHealthAlert(alertPayload, instance.tenant_id);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Connection failed';
      this.logger.error(
        `Health check failed for instance ${instance.nome}: ${errorMessage}`,
      );

      const newScore = this.clampScore(instance.health_score - 25);
      const circuitAction = this.getCircuitAction(newScore, instance.health_score);

      await this.prisma.instance.update({
        where: { id: instanceId },
        data: {
          health_score: newScore,
          consecutive_fails: instance.consecutive_fails + 1,
          last_error: errorMessage,
          cooldown_until: circuitAction.cooldownUntil,
        },
      });

      await this.prisma.instanceHealthLog.create({
        data: {
          instance_id: instanceId,
          health_score: newScore,
          event: 'connection_error',
          details: { error: errorMessage },
        },
      });

      if (circuitAction.alert) {
        const alertPayload: HealthAlertPayload = {
          instanceId,
          instanceName: instance.nome,
          healthScore: newScore,
          level: circuitAction.level,
          message: circuitAction.message,
        };
        this.gateway.emitHealthAlert(alertPayload, instance.tenant_id);
      }
    }
  }

  /**
   * Record a send event (called by dispatch worker).
   * Never throws — all errors are handled internally.
   */
  async recordSendResult(
    instanceId: string,
    success: boolean,
    responseTimeMs?: number,
  ): Promise<void> {
    const instance = await this.prisma.instance.findUnique({
      where: { id: instanceId },
    });
    if (!instance) {
      this.logger.warn(
        `Instance ${instanceId} not found, skipping send result recording`,
      );
      return;
    }

    let scoreChange: number;
    let event: string;

    if (success) {
      scoreChange = +1;
      event = 'send_ok';
    } else {
      scoreChange = -5;
      event = 'send_fail';
    }

    // Rate limit detection via slow response
    if (responseTimeMs && responseTimeMs > 3000) {
      scoreChange = -15;
      event = 'rate_limit';
    }

    const newScore = this.clampScore(instance.health_score + scoreChange);

    this.logger.debug(
      `Instance ${instance.nome}: send ${success ? 'ok' : 'fail'} responseMs=${responseTimeMs ?? 'N/A'} score=${instance.health_score}->${newScore}`,
    );

    await this.prisma.instance.update({
      where: { id: instanceId },
      data: {
        health_score: newScore,
        consecutive_fails: success ? 0 : instance.consecutive_fails + 1,
        last_error: success ? null : 'Send failed',
        avg_response_ms: responseTimeMs ?? instance.avg_response_ms,
        daily_sent: { increment: success ? 1 : 0 },
        total_sent_lifetime: { increment: success ? 1 : 0 },
        total_failed: { increment: success ? 0 : 1 },
        ...(success && { last_sent_at: new Date() }),
      },
    });

    await this.prisma.instanceHealthLog.create({
      data: {
        instance_id: instanceId,
        health_score: newScore,
        event,
        details: { responseTimeMs, success },
      },
    });
  }

  /**
   * Schedule repeating health checks for all active instances.
   */
  async scheduleAllHealthChecks(healthQueue: Queue): Promise<void> {
    const instances = await this.prisma.instance.findMany({
      where: { status: { in: ['connected', 'connecting', 'cooldown'] } },
      select: { id: true, nome: true },
    });

    this.logger.log(
      `Scheduling health checks for ${instances.length} active instances`,
    );

    for (const instance of instances) {
      await healthQueue.add(
        'check-instance',
        { instanceId: instance.id },
        {
          repeat: { every: 60000 },
          jobId: `health-${instance.id}`,
          removeOnComplete: 10,
          removeOnFail: 50,
        },
      );
      this.logger.debug(`Scheduled health check for ${instance.nome}`);
    }
  }

  /**
   * Circuit breaker logic:
   * GREEN  >70  — normal
   * YELLOW 40-70 — reduce speed 50%, alert on transition
   * ORANGE 20-40 — pause 30min
   * RED    1-20  — circuit break 2h
   * CRITICAL =0  — possibly banned
   */
  private getCircuitAction(
    newScore: number,
    previousScore: number,
  ): CircuitAction {
    if (newScore > 70) {
      return { level: 'GREEN', cooldownUntil: null, alert: false, message: '' };
    }

    if (newScore > 40) {
      return {
        level: 'YELLOW',
        cooldownUntil: null,
        alert: previousScore > 70,
        message: 'Saude da instancia degradando — velocidade reduzida 50%',
      };
    }

    if (newScore > 20) {
      const cooldown = new Date(Date.now() + 30 * 60 * 1000);
      return {
        level: 'ORANGE',
        cooldownUntil: cooldown,
        alert: true,
        message: 'Instancia em pausa por 30 minutos — saude critica',
      };
    }

    if (newScore > 0) {
      const cooldown = new Date(Date.now() + 2 * 60 * 60 * 1000);
      return {
        level: 'RED',
        cooldownUntil: cooldown,
        alert: true,
        message: 'Circuit breaker ativado — pausa de 2 horas',
      };
    }

    return {
      level: 'CRITICAL',
      cooldownUntil: null,
      alert: true,
      message: 'Instancia possivelmente banida — removida da rotacao',
    };
  }

  private mapStatus(state: string): string {
    switch (state) {
      case 'open':
      case 'connected':
        return 'connected';
      case 'close':
      case 'disconnected':
        return 'disconnected';
      case 'connecting':
        return 'connecting';
      default:
        this.logger.warn(`Unknown UazAPI state: "${state}" — treating as disconnected`);
        return 'disconnected';
    }
  }

  private clampScore(score: number): number {
    return Math.max(0, Math.min(100, score));
  }
}
