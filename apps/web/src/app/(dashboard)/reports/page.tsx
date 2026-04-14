'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  BarChart3,
  Mail,
  CheckCircle2,
  Eye,
  MessageSquare,
  ShieldAlert,
  UserX,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

// ─── Types ──────────────────────────────────────────
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
  created_at: string;
}

interface CampaignsResponse {
  campaigns: Campaign[];
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
  purple: '#a855f7',
  orange: '#f97316',
};

const ENGAGEMENT_COLORS: Record<string, string> = {
  Desconhecido: '#71717a',
  Frio: '#3b82f6',
  Morno: '#f59e0b',
  Quente: '#ef4444',
  Bloqueado: '#52525b',
};

type DateRange = '7d' | '30d' | 'all';
type SortKey = 'nome' | 'total_sent' | 'total_delivered' | 'total_read' | 'total_replied' | 'delivery_rate';
type SortDir = 'asc' | 'desc';

// ─── Custom Tooltip ─────────────────────────────────
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 shadow-lg">
      <p className="text-xs text-text-secondary mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-sm text-text-primary">
          <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: entry.color }} />
          {entry.name}: {entry.value.toLocaleString('pt-BR')}
        </p>
      ))}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────
function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  RUNNING: 'Executando',
  COMPLETED: 'Concluida',
  FAILED: 'Falha',
  CANCELLED: 'Cancelada',
  PAUSED: 'Pausada',
  SCHEDULED: 'Agendada',
  VALIDATING: 'Validando',
};

// ─── Main Page ──────────────────────────────────────
export default function ReportsPage() {
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [sortKey, setSortKey] = useState<SortKey>('total_sent');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const fetchCampaigns = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get<CampaignsResponse>('/campaigns', { params: { limit: '200' } });
      setCampaigns(data.campaigns);
    } catch {
      toast.error('Erro ao carregar campanhas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  // ─── Filter by date range ─────────────────────
  const filtered = useMemo(() => {
    if (dateRange === 'all') return campaigns;
    const now = new Date();
    const days = dateRange === '7d' ? 7 : 30;
    const cutoff = new Date(now.getTime() - days * 86400000);
    return campaigns.filter((c) => new Date(c.created_at) >= cutoff);
  }, [campaigns, dateRange]);

  // ─── Aggregate Stats ──────────────────────────
  const totals = useMemo(() => {
    const agg = { sent: 0, delivered: 0, read: 0, replied: 0, blocked: 0, optout: 0, failed: 0 };
    filtered.forEach((c) => {
      agg.sent += c.total_sent;
      agg.delivered += c.total_delivered;
      agg.read += c.total_read;
      agg.replied += c.total_replied;
      agg.blocked += c.total_blocked;
      agg.optout += c.total_optout;
      agg.failed += c.total_failed;
    });
    return agg;
  }, [filtered]);

  // ─── Bar Chart: Performance per Campaign ──────
  const barData = useMemo(() => {
    return filtered
      .filter((c) => c.total_sent > 0)
      .slice(0, 10)
      .map((c) => ({
        nome: c.nome.length > 15 ? c.nome.substring(0, 15) + '...' : c.nome,
        Enviados: c.total_sent,
        Entregues: c.total_delivered,
        Lidos: c.total_read,
        Respondidos: c.total_replied,
      }));
  }, [filtered]);

  // ─── Line Chart: Cumulative Sends ─────────────
  const lineData = useMemo(() => {
    const sorted = [...filtered]
      .filter((c) => c.started_at)
      .sort((a, b) => new Date(a.started_at!).getTime() - new Date(b.started_at!).getTime());

    let cumulative = 0;
    return sorted.map((c) => {
      cumulative += c.total_sent;
      return {
        name: new Date(c.started_at!).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        total: cumulative,
      };
    });
  }, [filtered]);

  // ─── Pie Chart: Engagement ────────────────────
  const engagementData = useMemo(() => {
    // Estimate engagement from campaign metrics
    const replied = totals.replied;
    const readOnly = totals.read - totals.replied;
    const deliveredOnly = totals.delivered - totals.read;
    const unknown = totals.sent - totals.delivered;
    const blocked = totals.blocked;

    const data = [
      { name: 'Quente', value: replied, color: ENGAGEMENT_COLORS['Quente'] },
      { name: 'Morno', value: Math.max(0, readOnly), color: ENGAGEMENT_COLORS['Morno'] },
      { name: 'Frio', value: Math.max(0, deliveredOnly), color: ENGAGEMENT_COLORS['Frio'] },
      { name: 'Desconhecido', value: Math.max(0, unknown), color: ENGAGEMENT_COLORS['Desconhecido'] },
      { name: 'Bloqueado', value: blocked, color: ENGAGEMENT_COLORS['Bloqueado'] },
    ].filter((d) => d.value > 0);

    return data;
  }, [totals]);

  // ─── Sorted Table Data ────────────────────────
  const tableData = useMemo(() => {
    const withRate = filtered.map((c) => ({
      ...c,
      delivery_rate: pct(c.total_delivered, c.total_sent),
    }));

    return [...withRate].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDir === 'asc' ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
    });
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />;
    return sortDir === 'asc'
      ? <ArrowUp className="h-3 w-3 ml-1" />
      : <ArrowDown className="h-3 w-3 ml-1" />;
  }

  // ─── Stat Cards Config ────────────────────────
  const statCards = [
    { label: 'Total Enviadas', value: totals.sent, icon: Mail, iconColor: 'text-primary' },
    { label: 'Taxa de Entrega', value: `${pct(totals.delivered, totals.sent)}%`, icon: CheckCircle2, iconColor: 'text-emerald-400' },
    { label: 'Taxa de Leitura', value: `${pct(totals.read, totals.sent)}%`, icon: Eye, iconColor: 'text-blue-400' },
    { label: 'Taxa de Resposta', value: `${pct(totals.replied, totals.sent)}%`, icon: MessageSquare, iconColor: 'text-purple-400' },
    { label: 'Taxa de Bloqueio', value: `${pct(totals.blocked, totals.sent)}%`, icon: ShieldAlert, iconColor: 'text-red-400' },
    { label: 'Taxa de Opt-out', value: `${pct(totals.optout, totals.sent)}%`, icon: UserX, iconColor: 'text-orange-400' },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-blue-400" />
          <h1 className="text-2xl font-bold text-text-primary">Relatorios</h1>
        </div>
        <div className="flex items-center gap-2">
          {(['7d', '30d', 'all'] as DateRange[]).map((range) => (
            <Button
              key={range}
              variant={dateRange === range ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDateRange(range)}
            >
              {range === '7d' ? '7 dias' : range === '30d' ? '30 dias' : 'Tudo'}
            </Button>
          ))}
        </div>
      </div>

      {/* Overview Stats */}
      {loading ? (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-4 w-20 mb-3" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {statCards.map((card) => {
            const Icon = card.icon;
            return (
              <Card key={card.label}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-text-secondary">{card.label}</span>
                    <Icon className={`h-4 w-4 ${card.iconColor}`} />
                  </div>
                  <p className="text-2xl font-bold text-text-primary">
                    {typeof card.value === 'number' ? card.value.toLocaleString('pt-BR') : card.value}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Bar Chart: Performance per Campaign */}
        <Card>
          <CardHeader>
            <CardTitle className="text-text-primary text-base">Performance por Campanha</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : barData.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center">
                <p className="text-text-secondary text-sm">Sem dados para exibir</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={barData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.muted} />
                  <XAxis dataKey="nome" stroke={CHART_COLORS.text} tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={60} />
                  <YAxis stroke={CHART_COLORS.text} tick={{ fontSize: 12 }} />
                  <RechartsTooltip content={<ChartTooltip />} />
                  <Bar dataKey="Enviados" fill={CHART_COLORS.primary} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Entregues" fill={CHART_COLORS.secondary} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Lidos" fill={CHART_COLORS.warning} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Respondidos" fill={CHART_COLORS.purple} radius={[2, 2, 0, 0]} />
                  <Legend
                    formatter={(value: string) => (
                      <span className="text-xs text-text-secondary">{value}</span>
                    )}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Line Chart: Cumulative Sends */}
        <Card>
          <CardHeader>
            <CardTitle className="text-text-primary text-base">Envios ao Longo do Tempo</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : lineData.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center">
                <p className="text-text-secondary text-sm">Sem dados para exibir</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={lineData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.muted} />
                  <XAxis dataKey="name" stroke={CHART_COLORS.text} tick={{ fontSize: 12 }} />
                  <YAxis stroke={CHART_COLORS.text} tick={{ fontSize: 12 }} />
                  <RechartsTooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="rounded-lg border border-border bg-surface px-3 py-2 shadow-lg">
                          <p className="text-xs text-text-secondary mb-1">{label}</p>
                          <p className="text-sm font-medium text-text-primary">
                            Total: {Number(payload[0].value).toLocaleString('pt-BR')}
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="total"
                    name="Total Acumulado"
                    stroke={CHART_COLORS.primary}
                    strokeWidth={2}
                    dot={{ r: 3, fill: CHART_COLORS.primary }}
                    activeDot={{ r: 5, fill: CHART_COLORS.primary }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Engagement Pie */}
      <Card>
        <CardHeader>
          <CardTitle className="text-text-primary text-base">Engajamento dos Contatos</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[250px] w-full" />
          ) : engagementData.length === 0 ? (
            <div className="h-[250px] flex items-center justify-center">
              <p className="text-text-secondary text-sm">Sem dados de engajamento</p>
            </div>
          ) : (
            <div className="flex flex-col lg:flex-row items-center gap-8">
              <div className="w-full lg:w-1/2">
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={engagementData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {engagementData.map((entry, index) => (
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
              </div>
              <div className="w-full lg:w-1/2 space-y-3">
                {engagementData.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                    <span className="text-sm text-text-secondary flex-1">{entry.name}</span>
                    <span className="text-sm font-medium text-text-primary">{entry.value.toLocaleString('pt-BR')}</span>
                    <span className="text-xs text-text-secondary w-12 text-right">
                      {pct(entry.value, totals.sent)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Campaign Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-text-primary text-base">Campanhas</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {[
                      { key: 'nome' as SortKey, label: 'Nome' },
                      { key: 'total_sent' as SortKey, label: 'Enviadas' },
                      { key: 'total_delivered' as SortKey, label: 'Entregues' },
                      { key: 'total_read' as SortKey, label: 'Lidas' },
                      { key: 'total_replied' as SortKey, label: 'Respostas' },
                      { key: 'delivery_rate' as SortKey, label: 'Entrega %' },
                    ].map(({ key, label }) => (
                      <th
                        key={key}
                        className="text-left py-3 px-2 text-text-secondary font-medium cursor-pointer hover:text-text-primary transition-colors"
                        onClick={() => toggleSort(key)}
                      >
                        <span className="inline-flex items-center">
                          {label}
                          <SortIcon column={key} />
                        </span>
                      </th>
                    ))}
                    <th className="text-left py-3 px-2 text-text-secondary font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((c) => (
                    <tr key={c.id} className="border-b border-border/50 hover:bg-surface/50 transition-colors">
                      <td className="py-3 px-2 text-text-primary font-medium max-w-[200px] truncate">{c.nome}</td>
                      <td className="py-3 px-2 text-text-primary">{c.total_sent.toLocaleString('pt-BR')}</td>
                      <td className="py-3 px-2 text-text-primary">{c.total_delivered.toLocaleString('pt-BR')}</td>
                      <td className="py-3 px-2 text-text-primary">{c.total_read.toLocaleString('pt-BR')}</td>
                      <td className="py-3 px-2 text-text-primary">{c.total_replied.toLocaleString('pt-BR')}</td>
                      <td className="py-3 px-2 text-text-primary">{c.delivery_rate}%</td>
                      <td className="py-3 px-2">
                        <Badge variant="outline" className="text-xs">
                          {STATUS_LABELS[c.status] ?? c.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {tableData.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-text-secondary">
                        Nenhuma campanha encontrada
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
