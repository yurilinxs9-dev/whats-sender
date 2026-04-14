'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Send,
  Users,
  Smartphone,
  Flame,
  CheckCircle2,
  TrendingUp,
  Activity,
  Signal,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

// ─── Types ──────────────────────────────────────────
interface Instance {
  id: string;
  nome: string;
  status: string;
  health_score: number;
  warmup_completed: boolean;
  warmup_phase: string;
  warmup_day: number;
  daily_sent: number;
  daily_limit: number;
}

interface InstancesResponse {
  instances: Instance[];
  total: number;
}

interface Campaign {
  id: string;
  nome: string;
  status: string;
  total_contacts: number;
  total_sent: number;
  total_delivered: number;
  total_read: number;
  total_replied: number;
  total_failed: number;
  total_blocked: number;
  total_optout: number;
  started_at: string | null;
  finished_at: string | null;
}

interface CampaignsResponse {
  campaigns: Campaign[];
  total: number;
}

interface ContactsResponse {
  total: number;
}

// ─── Chart Colors ───────────────────────────────────
const CHART_COLORS = {
  primary: '#22c55e',
  secondary: '#3b82f6',
  warning: '#f59e0b',
  danger: '#ef4444',
  muted: '#27272a',
  text: '#a1a1aa',
  background: '#18181b',
};

const PIE_COLORS: Record<string, string> = {
  DRAFT: '#71717a',
  RUNNING: '#22c55e',
  COMPLETED: '#10b981',
  FAILED: '#ef4444',
  CANCELLED: '#52525b',
  PAUSED: '#f59e0b',
  SCHEDULED: '#3b82f6',
  VALIDATING: '#f59e0b',
};

const PIE_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  RUNNING: 'Executando',
  COMPLETED: 'Concluida',
  FAILED: 'Falha',
  CANCELLED: 'Cancelada',
  PAUSED: 'Pausada',
  SCHEDULED: 'Agendada',
  VALIDATING: 'Validando',
};

// ─── Status Helpers ─────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'warning'; className?: string }> = {
  connected: { label: 'Conectado', variant: 'default' },
  disconnected: { label: 'Desconectado', variant: 'secondary' },
  connecting: { label: 'Conectando', variant: 'warning' },
  banned: { label: 'Banido', variant: 'destructive' },
  cooldown: { label: 'Cooldown', variant: 'warning', className: 'bg-orange-500 text-zinc-950 border-transparent' },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? { label: status, variant: 'outline' as const };
}

function getHealthColor(score: number) {
  if (score > 70) return 'bg-primary';
  if (score >= 40) return 'bg-warning';
  return 'bg-danger';
}

// ─── Custom Tooltip ─────────────────────────────────
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 shadow-lg">
      <p className="text-xs text-text-secondary mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-sm font-medium text-text-primary">
          {entry.name}: {entry.value.toLocaleString('pt-BR')}
        </p>
      ))}
    </div>
  );
}

// ─── Animation Variants ─────────────────────────────
const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.4, ease: 'easeOut' as const },
  }),
};

// ─── Main Page ──────────────────────────────────────
export default function DashboardPage() {
  const { user } = useAuthStore();

  const [loading, setLoading] = useState(true);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [totalInstances, setTotalInstances] = useState(0);
  const [totalContacts, setTotalContacts] = useState(0);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [activeCampaigns, setActiveCampaigns] = useState<Campaign[]>([]);

  // ─── Fetch Data ─────────────────────────────────
  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);

      const [instancesRes, contactsRes, campaignsRes, runningRes] = await Promise.allSettled([
        api.get<InstancesResponse>('/instances', { params: { limit: '100' } }),
        api.get<ContactsResponse>('/contacts', { params: { limit: '1' } }),
        api.get<CampaignsResponse>('/campaigns', { params: { limit: '100' } }),
        api.get<CampaignsResponse>('/campaigns', { params: { status: 'RUNNING', limit: '10' } }),
      ]);

      if (instancesRes.status === 'fulfilled') {
        setInstances(instancesRes.value.data.instances);
        setTotalInstances(instancesRes.value.data.total);
      }
      if (contactsRes.status === 'fulfilled') {
        setTotalContacts(contactsRes.value.data.total);
      }
      if (campaignsRes.status === 'fulfilled') {
        setCampaigns(campaignsRes.value.data.campaigns);
      }
      if (runningRes.status === 'fulfilled') {
        setActiveCampaigns(runningRes.value.data.campaigns);
      }
    } catch {
      toast.error('Erro ao carregar dados do dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  // ─── Computed Stats ─────────────────────────────
  const connectedInstances = instances.filter((i) => i.status === 'connected').length;
  const warmingInstances = instances.filter((i) => !i.warmup_completed).length;
  const completedCampaigns = campaigns.filter((c) => c.status === 'COMPLETED');
  const runningCount = campaigns.filter((c) => c.status === 'RUNNING').length;
  const completedCount = completedCampaigns.length;

  const avgDeliveryRate = completedCampaigns.length > 0
    ? Math.round(
        completedCampaigns.reduce((sum, c) => {
          const rate = c.total_sent > 0 ? (c.total_delivered / c.total_sent) * 100 : 0;
          return sum + rate;
        }, 0) / completedCampaigns.length,
      )
    : 0;

  // ─── Chart Data: Last 7 Days Sends ─────────────
  const last7DaysData = (() => {
    const days: { name: string; envios: number }[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dayLabel = date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' });
      // Estimate daily sends from campaign data (no daily stats endpoint yet)
      const daySends = campaigns.reduce((sum, c) => {
        if (!c.started_at) return sum;
        const started = new Date(c.started_at);
        const finished = c.finished_at ? new Date(c.finished_at) : now;
        if (date >= started && date <= finished) {
          const campaignDays = Math.max(1, Math.ceil((finished.getTime() - started.getTime()) / 86400000));
          return sum + Math.round(c.total_sent / campaignDays);
        }
        return sum;
      }, 0);
      days.push({ name: dayLabel, envios: daySends });
    }
    return days;
  })();

  // ─── Chart Data: Campaign Status Pie ───────────
  const campaignStatusData = (() => {
    const counts: Record<string, number> = {};
    campaigns.forEach((c) => {
      counts[c.status] = (counts[c.status] || 0) + 1;
    });
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([status, count]) => ({
        name: PIE_LABELS[status] ?? status,
        value: count,
        color: PIE_COLORS[status] ?? '#71717a',
      }));
  })();

  // ─── Stat Cards Config ────────────────────────
  const statCards = [
    {
      label: 'Total Instancias',
      value: totalInstances,
      sub: `${connectedInstances} conectada${connectedInstances !== 1 ? 's' : ''}`,
      icon: Smartphone,
      iconBg: 'bg-primary/10',
      iconColor: 'text-primary',
    },
    {
      label: 'Aquecendo',
      value: warmingInstances,
      sub: 'instancias em warmup',
      icon: Flame,
      iconBg: 'bg-warning/10',
      iconColor: 'text-warning',
    },
    {
      label: 'Total Contatos',
      value: totalContacts,
      sub: 'contatos importados',
      icon: Users,
      iconBg: 'bg-blue-500/10',
      iconColor: 'text-blue-400',
    },
    {
      label: 'Campanhas Ativas',
      value: runningCount,
      sub: 'em execucao agora',
      icon: Send,
      iconBg: 'bg-primary/10',
      iconColor: 'text-primary',
    },
    {
      label: 'Concluidas',
      value: completedCount,
      sub: 'campanhas finalizadas',
      icon: CheckCircle2,
      iconBg: 'bg-emerald-500/10',
      iconColor: 'text-emerald-400',
    },
    {
      label: 'Taxa de Entrega',
      value: `${avgDeliveryRate}%`,
      sub: 'media das concluidas',
      icon: TrendingUp,
      iconBg: 'bg-primary/10',
      iconColor: 'text-primary',
    },
  ];

  // ─── Render ───────────────────────────────────
  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">
          Bem-vindo, {user?.nome ?? 'Usuario'}
        </h1>
        <p className="text-text-secondary mt-1">
          Gerencie seus disparos de WhatsApp com inteligencia stealth
        </p>
      </div>

      {/* Row 1: Stat Cards */}
      {loading ? (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-5 w-20 mb-3" />
                <Skeleton className="h-8 w-16 mb-1" />
                <Skeleton className="h-3 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {statCards.map((card, i) => {
            const Icon = card.icon;
            return (
              <motion.div
                key={card.label}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
              >
                <Card className="hover:border-border/80 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm text-text-secondary">{card.label}</span>
                      <div className={`rounded-lg ${card.iconBg} p-1.5`}>
                        <Icon className={`h-4 w-4 ${card.iconColor}`} />
                      </div>
                    </div>
                    <p className="text-2xl font-bold text-text-primary">
                      {typeof card.value === 'number' ? card.value.toLocaleString('pt-BR') : card.value}
                    </p>
                    <p className="text-xs text-text-secondary mt-1">{card.sub}</p>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Row 2: Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Area Chart: Sends Last 7 Days */}
        <Card>
          <CardHeader>
            <CardTitle className="text-text-primary text-base">Envios dos Ultimos 7 Dias</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[250px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={last7DaysData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorEnvios" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.muted} />
                  <XAxis dataKey="name" stroke={CHART_COLORS.text} tick={{ fontSize: 12 }} />
                  <YAxis stroke={CHART_COLORS.text} tick={{ fontSize: 12 }} />
                  <RechartsTooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="envios"
                    name="Envios"
                    stroke={CHART_COLORS.primary}
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorEnvios)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Pie Chart: Campaign Status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-text-primary text-base">Status das Campanhas</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[250px] w-full" />
            ) : campaignStatusData.length === 0 ? (
              <div className="h-[250px] flex items-center justify-center">
                <p className="text-text-secondary text-sm">Nenhuma campanha encontrada</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={campaignStatusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {campaignStatusData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} stroke="transparent" />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const data = payload[0];
                      return (
                        <div className="rounded-lg border border-border bg-surface px-3 py-2 shadow-lg">
                          <p className="text-sm font-medium text-text-primary">
                            {data.name}: {Number(data.value).toLocaleString('pt-BR')}
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Legend
                    formatter={(value: string) => (
                      <span className="text-xs text-text-secondary">{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Active Campaigns + Instance Health */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Active Campaigns */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-text-primary text-base">Campanhas Ativas</CardTitle>
            <a href="/campaigns" className="text-xs text-primary hover:underline flex items-center gap-1">
              Ver todas <ChevronRight className="h-3 w-3" />
            </a>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-2 w-full rounded-full" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))
            ) : activeCampaigns.length === 0 ? (
              <div className="py-8 text-center">
                <Send className="h-8 w-8 text-text-secondary mx-auto mb-2" />
                <p className="text-sm text-text-secondary">Nenhuma campanha ativa</p>
              </div>
            ) : (
              activeCampaigns.map((campaign) => {
                const progress = campaign.total_contacts > 0
                  ? Math.round((campaign.total_sent / campaign.total_contacts) * 100)
                  : 0;
                const deliveryRate = campaign.total_sent > 0
                  ? Math.round((campaign.total_delivered / campaign.total_sent) * 100)
                  : 0;
                return (
                  <a key={campaign.id} href="/campaigns" className="block group">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-text-primary group-hover:text-primary transition-colors truncate">
                        {campaign.nome}
                      </span>
                      <span className="text-xs text-text-secondary ml-2 shrink-0">
                        {campaign.total_sent}/{campaign.total_contacts}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-text-secondary">{progress}% enviado</span>
                      <span className="text-xs text-text-secondary">Entrega: {deliveryRate}%</span>
                    </div>
                  </a>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Instance Health */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-text-primary text-base">Saude das Instancias</CardTitle>
            <a href="/instances" className="text-xs text-primary hover:underline flex items-center gap-1">
              Ver todas <ChevronRight className="h-3 w-3" />
            </a>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-md" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>
              ))
            ) : instances.length === 0 ? (
              <div className="py-8 text-center">
                <Smartphone className="h-8 w-8 text-text-secondary mx-auto mb-2" />
                <p className="text-sm text-text-secondary">Nenhuma instancia encontrada</p>
              </div>
            ) : (
              instances.slice(0, 6).map((instance) => {
                const statusCfg = getStatusConfig(instance.status);
                return (
                  <a key={instance.id} href="/instances" className="flex items-center gap-3 group">
                    <div className="rounded-lg bg-surface p-2">
                      {instance.status === 'connected' ? (
                        <Signal className="h-4 w-4 text-primary" />
                      ) : (
                        <Activity className="h-4 w-4 text-text-secondary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary group-hover:text-primary transition-colors truncate">
                        {instance.nome}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${getHealthColor(instance.health_score)}`}
                            style={{ width: `${instance.health_score}%` }}
                          />
                        </div>
                        <span className="text-xs text-text-secondary shrink-0">{instance.health_score}%</span>
                      </div>
                    </div>
                    <Badge variant={statusCfg.variant} className={statusCfg.className}>
                      {statusCfg.label}
                    </Badge>
                  </a>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
