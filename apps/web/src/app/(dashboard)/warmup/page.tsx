'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Flame,
  Play,
  Square,
  ChevronDown,
  ChevronUp,
  Activity,
  Calendar,
  Zap,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

// ---- Types ----
interface Instance {
  id: string;
  nome: string;
  telefone: string | null;
  status: string;
  warmup_phase: string;
  warmup_day: number;
  warmup_completed: boolean;
  warmup_started_at: string | null;
  daily_sent: number;
  buddy_sent_today: number;
  health_score: number;
  daily_limit: number;
  cooldown_until: string | null;
}

interface InstancesResponse {
  instances: Instance[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface WarmupLog {
  id: string;
  phase: string;
  day: number;
  msgs_sent: number;
  msgs_limit: number;
  replies: number;
  blocks: number;
  notes: string | null;
  created_at: string;
}

interface WarmupLogsResponse {
  logs: WarmupLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ---- Phase config ----
const PHASE_CONFIG: Record<string, { label: string; color: string; maxMsgs: number; days: number }> = {
  ACTIVATION: { label: 'Ativacao', color: 'bg-blue-500', maxMsgs: 30, days: 2 },
  BUILDING: { label: 'Construcao', color: 'bg-cyan-500', maxMsgs: 100, days: 3 },
  ACCELERATION: { label: 'Aceleracao', color: 'bg-yellow-500', maxMsgs: 300, days: 4 },
  STABILIZATION: { label: 'Estabilizacao', color: 'bg-orange-500', maxMsgs: 800, days: 5 },
  PRODUCTION: { label: 'Producao', color: 'bg-green-500', maxMsgs: 1500, days: 7 },
  FULL_CAPACITY: { label: 'Capacidade Total', color: 'bg-emerald-500', maxMsgs: 2000, days: -1 },
};

const PHASE_BADGE_CLASS: Record<string, string> = {
  ACTIVATION: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  BUILDING: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  ACCELERATION: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  STABILIZATION: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  PRODUCTION: 'bg-green-500/15 text-green-400 border-green-500/30',
  FULL_CAPACITY: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
};

function getHealthColor(score: number) {
  if (score > 70) return 'bg-primary';
  if (score >= 40) return 'bg-warning';
  return 'bg-danger';
}

// ---- Progress Bar ----
function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={`h-1.5 rounded-full bg-muted overflow-hidden ${className ?? ''}`}>
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
      />
    </div>
  );
}

// ---- Main Page ----
export default function WarmupPage() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedLogs, setExpandedLogs] = useState<Record<string, WarmupLog[]>>({});
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchInstances = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get<InstancesResponse>('/instances', {
        params: { limit: '100' },
      });
      setInstances(data.instances);
    } catch {
      toast.error('Erro ao carregar instancias');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  const handleStart = async (instanceId: string) => {
    try {
      setActionLoading(instanceId);
      await api.post(`/warmup/${instanceId}/start`);
      toast.success('Warmup iniciado');
      fetchInstances();
    } catch {
      toast.error('Erro ao iniciar warmup');
    } finally {
      setActionLoading(null);
    }
  };

  const handleStop = async (instanceId: string) => {
    try {
      setActionLoading(instanceId);
      await api.post(`/warmup/${instanceId}/stop`);
      toast.success('Warmup parado');
      fetchInstances();
    } catch {
      toast.error('Erro ao parar warmup');
    } finally {
      setActionLoading(null);
    }
  };

  const toggleLogs = async (instanceId: string) => {
    const newExpanded = new Set(expandedIds);
    if (newExpanded.has(instanceId)) {
      newExpanded.delete(instanceId);
      setExpandedIds(newExpanded);
      return;
    }

    // Fetch logs if not cached
    if (!expandedLogs[instanceId]) {
      try {
        const { data } = await api.get<WarmupLogsResponse>(`/warmup/${instanceId}/logs`, {
          params: { limit: '10' },
        });
        setExpandedLogs((prev) => ({ ...prev, [instanceId]: data.logs }));
      } catch {
        toast.error('Erro ao carregar logs');
        return;
      }
    }

    newExpanded.add(instanceId);
    setExpandedIds(newExpanded);
  };

  // ---- Stats ----
  const stats = {
    total: instances.length,
    warming: instances.filter((i) => !i.warmup_completed && i.status === 'connected').length,
    completed: instances.filter((i) => i.warmup_completed).length,
    avgHealth: instances.length
      ? Math.round(instances.reduce((s, i) => s + i.health_score, 0) / instances.length)
      : 0,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Flame className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold text-text-primary">Aquecimento</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Flame className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Total</p>
              <p className="text-2xl font-bold text-text-primary">{stats.total}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-warning/10 p-2">
              <Zap className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Aquecendo</p>
              <p className="text-2xl font-bold text-text-primary">{stats.warming}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Aquecidos</p>
              <p className="text-2xl font-bold text-text-primary">{stats.completed}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Saude Media</p>
              <p className="text-2xl font-bold text-text-primary">{stats.avgHealth}%</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Instance List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : instances.length === 0 ? (
        <Card>
          <CardContent className="p-12 flex flex-col items-center justify-center text-center">
            <Flame className="h-12 w-12 text-text-secondary mb-4" />
            <h3 className="text-lg font-semibold text-text-primary mb-1">Nenhuma instancia</h3>
            <p className="text-text-secondary">
              Crie instancias na pagina de Instancias para iniciar o aquecimento.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {instances.map((instance) => {
            const phase = PHASE_CONFIG[instance.warmup_phase] ?? {
              label: instance.warmup_phase,
              color: 'bg-zinc-500',
              maxMsgs: 0,
              days: 0,
            };
            const badgeClass = PHASE_BADGE_CLASS[instance.warmup_phase] ?? '';
            const dailyTotal = instance.daily_sent + instance.buddy_sent_today;
            const dailyProgress = phase.maxMsgs > 0 ? (dailyTotal / phase.maxMsgs) * 100 : 0;
            const dayProgress = phase.days > 0 ? (instance.warmup_day / phase.days) * 100 : 100;
            const isExpanded = expandedIds.has(instance.id);
            const isLoading = actionLoading === instance.id;
            const isConnected = instance.status === 'connected';
            const isCooldown = !!(instance.cooldown_until && new Date(instance.cooldown_until) > new Date());

            return (
              <Card key={instance.id} className="hover:border-border/80 transition-colors">
                <CardContent className="p-4 space-y-4">
                  {/* Main row */}
                  <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                    {/* Name + Phone */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-semibold text-text-primary truncate">
                          {instance.nome}
                        </h3>
                        {instance.warmup_completed ? (
                          <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                            Aquecido
                          </Badge>
                        ) : (
                          <Badge className={badgeClass}>{phase.label}</Badge>
                        )}
                        {!isConnected && (
                          <Badge variant="secondary">Desconectado</Badge>
                        )}
                        {isCooldown && (
                          <Badge className="bg-orange-500/15 text-orange-400 border-orange-500/30">
                            Cooldown
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-text-secondary">
                        {instance.telefone ?? 'Sem telefone'}
                      </p>
                    </div>

                    {/* Day counter */}
                    {!instance.warmup_completed && (
                      <div className="w-36">
                        <div className="flex items-center gap-1 mb-1">
                          <Calendar className="h-3 w-3 text-text-secondary" />
                          <span className="text-xs text-text-secondary">
                            Dia {instance.warmup_day}
                            {phase.days > 0 ? ` de ${phase.days}` : ''}
                          </span>
                        </div>
                        <ProgressBar value={dayProgress} />
                      </div>
                    )}

                    {/* Daily progress */}
                    <div className="w-40">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-text-secondary">Envios Hoje</span>
                        <span className="text-xs font-medium text-text-primary">
                          {dailyTotal}/{phase.maxMsgs}
                        </span>
                      </div>
                      <ProgressBar value={dailyProgress} />
                    </div>

                    {/* Health */}
                    <div className="w-28">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-text-secondary">Saude</span>
                        <span className="text-xs font-medium text-text-primary">
                          {instance.health_score}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${getHealthColor(instance.health_score)}`}
                          style={{ width: `${instance.health_score}%` }}
                        />
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      {!instance.warmup_completed && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleStart(instance.id)}
                            disabled={isLoading || !isConnected}
                            title="Iniciar warmup"
                          >
                            <Play className="h-3.5 w-3.5 mr-1" />
                            Iniciar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleStop(instance.id)}
                            disabled={isLoading}
                            title="Parar warmup"
                          >
                            <Square className="h-3.5 w-3.5 mr-1" />
                            Parar
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleLogs(instance.id)}
                        title="Ver logs"
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Phase progression bar */}
                  {!instance.warmup_completed && (
                    <div className="flex gap-1">
                      {Object.entries(PHASE_CONFIG).map(([key, cfg]) => {
                        const isActive = key === instance.warmup_phase;
                        const phaseOrder = Object.keys(PHASE_CONFIG);
                        const currentIdx = phaseOrder.indexOf(instance.warmup_phase);
                        const thisIdx = phaseOrder.indexOf(key);
                        const isPast = thisIdx < currentIdx;

                        return (
                          <div
                            key={key}
                            className="flex-1"
                            title={`${cfg.label}: ${cfg.maxMsgs} msgs/dia`}
                          >
                            <div
                              className={`h-1.5 rounded-full transition-all ${
                                isPast
                                  ? cfg.color
                                  : isActive
                                    ? `${cfg.color} animate-pulse`
                                    : 'bg-muted'
                              }`}
                            />
                            <span className="text-[10px] text-text-secondary mt-0.5 block text-center truncate">
                              {cfg.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Expanded logs */}
                  {isExpanded && (
                    <div className="border-t border-border pt-3">
                      <h4 className="text-sm font-medium text-text-primary mb-2">
                        Historico de Aquecimento
                      </h4>
                      {expandedLogs[instance.id]?.length ? (
                        <div className="space-y-2">
                          {expandedLogs[instance.id].map((log) => (
                            <div
                              key={log.id}
                              className="flex items-center gap-4 text-sm py-1.5 px-3 rounded-lg bg-muted/50 flex-wrap"
                            >
                              <Badge className={PHASE_BADGE_CLASS[log.phase] ?? ''} variant="outline">
                                {PHASE_CONFIG[log.phase]?.label ?? log.phase}
                              </Badge>
                              <span className="text-text-secondary">Dia {log.day}</span>
                              <span className="text-text-primary">
                                {log.msgs_sent}/{log.msgs_limit} msgs
                              </span>
                              {log.replies > 0 && (
                                <span className="text-primary">{log.replies} respostas</span>
                              )}
                              {log.blocks > 0 && (
                                <span className="text-danger">{log.blocks} bloqueios</span>
                              )}
                              {log.notes && (
                                <span className="text-text-secondary italic">{log.notes}</span>
                              )}
                              <span className="ml-auto text-xs text-text-secondary">
                                {new Date(log.created_at).toLocaleDateString('pt-BR')}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-text-secondary">Nenhum log encontrado.</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
