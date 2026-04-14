'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Settings,
  User,
  Clock,
  Shield,
  Wifi,
  WifiOff,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Timer,
  CalendarClock,
  Zap,
  BarChart3,
  ShieldAlert,
  MessageSquare,
  Flame,
  Server,
  Database,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';

// ─── Types ──────────────────────────────────────────
interface TenantSettings {
  delay_min: number;
  delay_max: number;
  daily_limit_default: number;
  send_window_start: string;
  send_window_end: string;
  lunch_break_start: string;
  lunch_break_end: string;
  max_parallel_campaigns: number;
  frequency_cap_days: number;
  block_rate_threshold: number;
  reply_rate_alert: number;
  warmup_enabled: boolean;
}

interface HealthResponse {
  status: string;
  uptime?: number;
  timestamp?: string;
}

interface ConnectionStatus {
  api: 'connected' | 'disconnected' | 'checking';
  redis: 'connected' | 'disconnected' | 'checking';
  supabase: 'connected' | 'disconnected' | 'checking';
}

// ─── Setting Display Helper ─────────────────────────
function SettingRow({ icon: Icon, label, value, iconColor = 'text-text-secondary' }: {
  icon: React.ElementType;
  label: string;
  value: string | number | boolean;
  iconColor?: string;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex items-center gap-3">
        <Icon className={`h-4 w-4 ${iconColor}`} />
        <span className="text-sm text-text-secondary">{label}</span>
      </div>
      <span className="text-sm font-medium text-text-primary">
        {typeof value === 'boolean' ? (
          <Badge variant={value ? 'default' : 'secondary'}>
            {value ? 'Ativado' : 'Desativado'}
          </Badge>
        ) : (
          value
        )}
      </span>
    </div>
  );
}

// ─── Connection Badge ───────────────────────────────
function ConnectionBadge({ status }: { status: 'connected' | 'disconnected' | 'checking' }) {
  if (status === 'checking') {
    return (
      <Badge variant="outline" className="animate-pulse">
        <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
        Verificando
      </Badge>
    );
  }
  if (status === 'connected') {
    return (
      <Badge variant="default">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Conectado
      </Badge>
    );
  }
  return (
    <Badge variant="destructive">
      <XCircle className="h-3 w-3 mr-1" />
      Desconectado
    </Badge>
  );
}

// ─── Main Page ──────────────────────────────────────
export default function SettingsPage() {
  const { user } = useAuthStore();

  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [connections, setConnections] = useState<ConnectionStatus>({
    api: 'disconnected',
    redis: 'disconnected',
    supabase: 'disconnected',
  });
  const [checkingConnections, setCheckingConnections] = useState(false);

  // ─── Fetch Settings ───────────────────────────
  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      // Try to get tenant settings from auth/me or a settings endpoint
      const { data } = await api.get<{ user: { tenant?: { settings?: TenantSettings } } }>('/auth/me');
      const tenantSettings = data.user?.tenant?.settings;
      if (tenantSettings) {
        setSettings(tenantSettings);
      } else {
        // Fallback: use default values if settings endpoint doesn't return them
        setSettings({
          delay_min: 5,
          delay_max: 15,
          daily_limit_default: 1000,
          send_window_start: '08:00',
          send_window_end: '22:00',
          lunch_break_start: '12:00',
          lunch_break_end: '13:30',
          max_parallel_campaigns: 3,
          frequency_cap_days: 7,
          block_rate_threshold: 5,
          reply_rate_alert: 2,
          warmup_enabled: true,
        });
      }
    } catch {
      // Use default values on error
      setSettings({
        delay_min: 5,
        delay_max: 15,
        daily_limit_default: 1000,
        send_window_start: '08:00',
        send_window_end: '22:00',
        lunch_break_start: '12:00',
        lunch_break_end: '13:30',
        max_parallel_campaigns: 3,
        frequency_cap_days: 7,
        block_rate_threshold: 5,
        reply_rate_alert: 2,
        warmup_enabled: true,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // ─── Check Connections ────────────────────────
  const checkConnections = useCallback(async () => {
    setCheckingConnections(true);
    setConnections({ api: 'checking', redis: 'checking', supabase: 'checking' });

    // Check API health
    try {
      await api.get<HealthResponse>('/health');
      setConnections((prev) => ({ ...prev, api: 'connected', supabase: 'connected' }));
    } catch {
      setConnections((prev) => ({ ...prev, api: 'disconnected', supabase: 'disconnected' }));
    }

    // Check Redis health
    try {
      await api.get<HealthResponse>('/health/redis');
      setConnections((prev) => ({ ...prev, redis: 'connected' }));
    } catch {
      setConnections((prev) => ({ ...prev, redis: 'disconnected' }));
    }

    setCheckingConnections(false);
    toast.success('Verificacao de conexoes concluida');
  }, []);

  // ─── Role Badge ───────────────────────────────
  const getRoleBadge = (role: string) => {
    const map: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      OWNER: { label: 'Proprietario', variant: 'default' },
      ADMIN: { label: 'Administrador', variant: 'default' },
      OPERATOR: { label: 'Operador', variant: 'secondary' },
      VIEWER: { label: 'Visualizador', variant: 'outline' },
    };
    const cfg = map[role] ?? { label: role, variant: 'outline' as const };
    return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-text-secondary" />
        <h1 className="text-2xl font-bold text-text-primary">Configuracoes</h1>
      </div>

      {/* Section 1: Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="text-text-primary text-base flex items-center gap-2">
            <User className="h-4 w-4" />
            Perfil
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!user ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-6 w-24" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-lg font-bold text-primary">
                    {user.nome.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-text-primary">{user.nome}</h3>
                  <p className="text-sm text-text-secondary">{user.email}</p>
                </div>
                <div className="ml-auto">
                  {getRoleBadge(user.role)}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 2: Send Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-text-primary text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Configuracoes de Envio
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading || !settings ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <div className="divide-y divide-border">
              <SettingRow
                icon={Timer}
                label="Delay Minimo"
                value={`${settings.delay_min}s`}
                iconColor="text-primary"
              />
              <SettingRow
                icon={Timer}
                label="Delay Maximo"
                value={`${settings.delay_max}s`}
                iconColor="text-primary"
              />
              <SettingRow
                icon={BarChart3}
                label="Limite Diario Padrao"
                value={settings.daily_limit_default.toLocaleString('pt-BR')}
                iconColor="text-blue-400"
              />
              <SettingRow
                icon={CalendarClock}
                label="Janela de Envio"
                value={`${settings.send_window_start} - ${settings.send_window_end}`}
                iconColor="text-emerald-400"
              />
              <SettingRow
                icon={CalendarClock}
                label="Pausa do Almoco"
                value={`${settings.lunch_break_start} - ${settings.lunch_break_end}`}
                iconColor="text-orange-400"
              />
              <SettingRow
                icon={Zap}
                label="Max Campanhas Paralelas"
                value={settings.max_parallel_campaigns}
                iconColor="text-yellow-400"
              />
              <SettingRow
                icon={Clock}
                label="Frequency Cap"
                value={`${settings.frequency_cap_days} dias`}
                iconColor="text-purple-400"
              />

              <Separator className="my-2" />

              <SettingRow
                icon={ShieldAlert}
                label="Threshold de Bloqueio"
                value={`${settings.block_rate_threshold}%`}
                iconColor="text-red-400"
              />
              <SettingRow
                icon={MessageSquare}
                label="Alerta de Taxa de Resposta"
                value={`${settings.reply_rate_alert}%`}
                iconColor="text-blue-400"
              />
              <SettingRow
                icon={Flame}
                label="Warmup Habilitado"
                value={settings.warmup_enabled}
                iconColor="text-orange-400"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 3: API & Integrations */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-text-primary text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />
            API &amp; Integracoes
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={checkConnections}
            disabled={checkingConnections}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${checkingConnections ? 'animate-spin' : ''}`} />
            Verificar Conexoes
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <Server className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-text-primary">UazAPI</p>
                  <p className="text-xs text-text-secondary">Servico de envio WhatsApp</p>
                </div>
              </div>
              <ConnectionBadge status={connections.api} />
            </div>

            <Separator />

            <div className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-blue-500/10 p-2">
                  <Database className="h-4 w-4 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-text-primary">Supabase</p>
                  <p className="text-xs text-text-secondary">Banco de dados PostgreSQL</p>
                </div>
              </div>
              <ConnectionBadge status={connections.supabase} />
            </div>

            <Separator />

            <div className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-red-500/10 p-2">
                  {connections.redis === 'connected' ? (
                    <Wifi className="h-4 w-4 text-red-400" />
                  ) : (
                    <WifiOff className="h-4 w-4 text-red-400" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-text-primary">Redis (Upstash)</p>
                  <p className="text-xs text-text-secondary">Cache e filas BullMQ</p>
                </div>
              </div>
              <ConnectionBadge status={connections.redis} />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
