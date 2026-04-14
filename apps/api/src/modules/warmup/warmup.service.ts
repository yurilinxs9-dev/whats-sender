import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UazApiService } from '../uazapi/uazapi.service';
import { SpinService } from '../spin/spin.service';
import { SenderGateway } from '../websocket/websocket.gateway';
import type { WarmupPhase } from '@prisma/client';

interface PhaseConfig {
  maxMsgsPerDay: number;
  daysInPhase: number;
}

@Injectable()
export class WarmupService {
  private readonly logger = new Logger(WarmupService.name);

  private readonly PHASE_CONFIG: Record<string, PhaseConfig> = {
    ACTIVATION: { maxMsgsPerDay: 30, daysInPhase: 2 },
    BUILDING: { maxMsgsPerDay: 100, daysInPhase: 3 },
    ACCELERATION: { maxMsgsPerDay: 300, daysInPhase: 4 },
    STABILIZATION: { maxMsgsPerDay: 800, daysInPhase: 5 },
    PRODUCTION: { maxMsgsPerDay: 1500, daysInPhase: 7 },
    FULL_CAPACITY: { maxMsgsPerDay: 2000, daysInPhase: -1 },
  };

  private readonly PHASES: WarmupPhase[] = [
    'ACTIVATION',
    'BUILDING',
    'ACCELERATION',
    'STABILIZATION',
    'PRODUCTION',
    'FULL_CAPACITY',
  ];

  private readonly GREETINGS = [
    '{Bom dia|Boa tarde|E ai|Opa|Fala}! {Tudo bem|Tudo certo|Como vai|Blz}?',
    '{Oi|Ola|Hey}, {como esta|como vai voce|tudo tranquilo}?',
    '{To passando pra|Vim so pra|Queria} {dar um oi|falar contigo|mandar um salve}!',
    'E ai, {novidades|como ta a semana|tudo bem por ai}?',
    '{Lembrei de voce|Pensei em voce|Tava pensando}, {tudo bem|como ta}?',
  ];

  constructor(
    private prisma: PrismaService,
    private uazApi: UazApiService,
    private spin: SpinService,
    private gateway: SenderGateway,
  ) {}

  /**
   * Execute a warmup cycle for an instance.
   * Called by the warmup worker on schedule.
   */
  async executeWarmupCycle(instanceId: string): Promise<void> {
    const instance = await this.prisma.instance.findUnique({
      where: { id: instanceId },
    });

    if (!instance || instance.warmup_completed || instance.status !== 'connected') return;
    if (instance.cooldown_until && instance.cooldown_until > new Date()) return;

    const config = this.PHASE_CONFIG[instance.warmup_phase];
    if (!config) return;

    // Check if should promote to next phase
    if (this.shouldPromotePhase(instance)) {
      await this.promotePhase(instance);
      return; // will be picked up in next cycle
    }

    // Calculate how many msgs to send this cycle
    const remaining = config.maxMsgsPerDay - instance.daily_sent - instance.buddy_sent_today;
    if (remaining <= 0) return; // daily limit reached

    // Send buddy messages (organic activity)
    const buddyCount = Math.min(Math.ceil(remaining * 0.5), 5); // 50% buddy, max 5 per cycle
    await this.sendBuddyMessages(instance, buddyCount);
  }

  /**
   * Send buddy pool messages to simulate organic activity.
   */
  private async sendBuddyMessages(
    instance: { id: string; config: unknown; tenant_id: string; nome: string },
    count: number,
  ): Promise<void> {
    let buddies = await this.prisma.buddyPair.findMany({
      where: { instance_id: instance.id, active: true },
      take: 5,
    });

    if (buddies.length === 0) {
      // Find other instances in same tenant to pair with
      const otherInstances = await this.prisma.instance.findMany({
        where: {
          tenant_id: instance.tenant_id,
          id: { not: instance.id },
          status: 'connected',
        },
        take: 5,
        select: { id: true },
      });

      for (const other of otherInstances) {
        await this.prisma.buddyPair.upsert({
          where: {
            instance_id_buddy_id: {
              instance_id: instance.id,
              buddy_id: other.id,
            },
          },
          create: {
            instance_id: instance.id,
            buddy_id: other.id,
            tenant_id: instance.tenant_id,
          },
          update: {},
        });
      }

      buddies = await this.prisma.buddyPair.findMany({
        where: { instance_id: instance.id, active: true },
        take: 5,
      });
    }

    if (buddies.length === 0) return;

    const token = (instance.config as Record<string, string> | null)?.uazapi_token ?? '';
    let sent = 0;

    for (const buddy of buddies) {
      if (sent >= count) break;

      const buddyInstance = await this.prisma.instance.findUnique({
        where: { id: buddy.buddy_id },
        select: { telefone: true },
      });
      if (!buddyInstance?.telefone) continue;

      // Generate organic message via spin engine
      const template = this.GREETINGS[Math.floor(Math.random() * this.GREETINGS.length)];
      const message = this.spin.processMessage(template, {});

      try {
        // Simulate composing
        await this.uazApi.setPresence(token, buddyInstance.telefone, 'composing');
        // Wait typing time (1-3s)
        await this.delay(1000 + Math.random() * 2000);
        // Send
        await this.uazApi.sendText(token, buddyInstance.telefone, message);

        // Record buddy message
        await this.prisma.buddyMessage.create({
          data: {
            pair_id: buddy.id,
            direction: 'outgoing',
            content: message,
            type: 'TEXT',
          },
        });

        // Update counters
        await this.prisma.buddyPair.update({
          where: { id: buddy.id },
          data: { msgs_today: { increment: 1 }, last_msg_at: new Date() },
        });

        await this.prisma.instance.update({
          where: { id: instance.id },
          data: { buddy_sent_today: { increment: 1 } },
        });

        sent++;
      } catch (error) {
        this.logger.warn(
          `Buddy msg failed for ${instance.nome}: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }

      // Delay between buddy messages (5-15s)
      await this.delay(5000 + Math.random() * 10000);
    }
  }

  /**
   * Check if instance should be promoted to next warmup phase.
   */
  private shouldPromotePhase(instance: {
    warmup_phase: string;
    warmup_day: number;
    health_score: number;
  }): boolean {
    const config = this.PHASE_CONFIG[instance.warmup_phase];
    if (!config || config.daysInPhase === -1) return false;
    if (instance.warmup_day < config.daysInPhase) return false;
    if (instance.health_score < 70) return false;
    return true;
  }

  /**
   * Promote instance to next warmup phase.
   */
  private async promotePhase(instance: {
    id: string;
    warmup_phase: string;
    warmup_day: number;
    nome: string;
    tenant_id: string;
  }): Promise<void> {
    const currentIndex = this.PHASES.indexOf(instance.warmup_phase as WarmupPhase);
    if (currentIndex === -1 || currentIndex >= this.PHASES.length - 1) {
      // Already at FULL_CAPACITY -- mark completed
      await this.prisma.instance.update({
        where: { id: instance.id },
        data: { warmup_completed: true },
      });
      return;
    }

    const nextPhase = this.PHASES[currentIndex + 1];

    await this.prisma.instance.update({
      where: { id: instance.id },
      data: {
        warmup_phase: nextPhase,
        warmup_day: 1,
        warmup_completed: nextPhase === 'FULL_CAPACITY',
      },
    });

    // Log promotion
    await this.prisma.warmupLog.create({
      data: {
        instance_id: instance.id,
        phase: nextPhase,
        day: 1,
        msgs_sent: 0,
        msgs_limit: this.PHASE_CONFIG[nextPhase].maxMsgsPerDay,
        replies: 0,
        blocks: 0,
        notes: `Promoted from ${instance.warmup_phase}`,
      },
    });

    this.gateway.emitInstanceStatusChanged(
      instance.nome,
      `warmup:${nextPhase}`,
      instance.tenant_id,
    );
  }

  /**
   * Increment warmup day for all active instances (called daily by cron).
   */
  async incrementWarmupDays(): Promise<void> {
    await this.prisma.instance.updateMany({
      where: { warmup_completed: false, status: 'connected' },
      data: { warmup_day: { increment: 1 } },
    });
  }

  /**
   * Start warmup for an instance -- add repeatable job to warmup queue.
   */
  async startWarmup(instanceId: string, warmupQueue: Queue): Promise<void> {
    await warmupQueue.add(
      'warmup-cycle',
      { instanceId },
      {
        repeat: { every: 300000 }, // every 5 minutes
        jobId: `warmup-${instanceId}`,
        removeOnComplete: 5,
        removeOnFail: 20,
      },
    );

    await this.prisma.instance.update({
      where: { id: instanceId },
      data: { warmup_started_at: new Date() },
    });
  }

  /**
   * Stop warmup for an instance.
   */
  async stopWarmup(instanceId: string, warmupQueue: Queue): Promise<void> {
    const repeatableJobs = await warmupQueue.getRepeatableJobs();
    const job = repeatableJobs.find((j) => j.id === `warmup-${instanceId}`);
    if (job) {
      await warmupQueue.removeRepeatableByKey(job.key);
    }
  }

  /**
   * Get warmup status for an instance.
   */
  async getStatus(instanceId: string) {
    const instance = await this.prisma.instance.findUnique({
      where: { id: instanceId },
      select: {
        id: true,
        nome: true,
        telefone: true,
        status: true,
        warmup_phase: true,
        warmup_day: true,
        warmup_completed: true,
        warmup_started_at: true,
        daily_sent: true,
        buddy_sent_today: true,
        health_score: true,
        daily_limit: true,
        cooldown_until: true,
      },
    });

    if (!instance) return null;

    const config = this.PHASE_CONFIG[instance.warmup_phase];
    return {
      ...instance,
      phase_limit: config?.maxMsgsPerDay ?? 0,
      phase_days: config?.daysInPhase ?? 0,
    };
  }

  /**
   * Get warmup logs for an instance (paginated).
   */
  async getLogs(instanceId: string, page: number, limit: number) {
    const [logs, total] = await Promise.all([
      this.prisma.warmupLog.findMany({
        where: { instance_id: instanceId },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.warmupLog.count({
        where: { instance_id: instanceId },
      }),
    ]);

    return {
      logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
