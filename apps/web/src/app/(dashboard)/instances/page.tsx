'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Smartphone,
  Plus,
  Search,
  Wifi,
  WifiOff,
  Pencil,
  Trash2,
  Activity,
  Signal,
  Flame,
  BarChart3,
  QrCode,
  Loader2,
  CheckCircle2,
  Phone,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ─── Types ──────────────────────────────────────────
interface Instance {
  id: string;
  nome: string;
  telefone: string | null;
  status: string;
  config: Record<string, string> | null;
  tenant_id: string;
  created_at: string;
  updated_at: string;
  daily_limit: number;
  daily_sent: number;
  health_score: number;
  warmup_phase: string;
  warmup_day: number;
  warmup_completed: boolean;
  consecutive_fails: number;
  last_error: string | null;
  cooldown_until: string | null;
  total_sent_lifetime: number;
  total_delivered: number;
  total_failed: number;
}

interface InstancesResponse {
  instances: Instance[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface QrCodeResponse {
  id: string;
  nome: string;
  status: string;
  qrcode: string | null;
  profileName: string | null;
  owner: string | null;
}

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

function getWarmupLabel(phase: string) {
  const labels: Record<string, string> = {
    ACTIVATION: 'Ativacao',
    BUILDING: 'Construcao',
    ACCELERATION: 'Aceleracao',
    STABILIZATION: 'Estabilizacao',
    PRODUCTION: 'Producao',
    FULL_CAPACITY: 'Capacidade Total',
  };
  return labels[phase] ?? phase;
}

// ─── Main Page ──────────────────────────────────────
export default function InstancesPage() {
  const { accessToken } = useAuthStore();

  const [instances, setInstances] = useState<Instance[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);

  // Dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null);

  // QR Code state
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<string>('connecting');
  const [qrLoading, setQrLoading] = useState(false);
  const qrPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pairing code state
  const [connectMode, setConnectMode] = useState<'qr' | 'phone'>('qr');
  const [pairingPhone, setPairingPhone] = useState('');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);

  // Form
  const [formNome, setFormNome] = useState('');
  const [formTelefone, setFormTelefone] = useState('');
  const [formDailyLimit, setFormDailyLimit] = useState('1000');
  const [submitting, setSubmitting] = useState(false);

  // ─── Fetch ──────────────────────────────────────
  const fetchInstances = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = { page: String(page), limit: '20' };
      if (search) params.search = search;
      if (statusFilter !== 'all') params.status = statusFilter;

      const { data } = await api.get<InstancesResponse>('/instances', { params });
      setInstances(data.instances);
      setTotal(data.total);
    } catch {
      toast.error('Erro ao carregar instancias');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  // ─── WebSocket ──────────────────────────────────
  useEffect(() => {
    if (!accessToken) return;
    const socket = getSocket(accessToken);

    const handler = (data: { instanceName: string; status: string }) => {
      setInstances((prev) =>
        prev.map((inst) =>
          inst.nome === data.instanceName ? { ...inst, status: data.status } : inst,
        ),
      );
      if (data.status === 'deleted') {
        fetchInstances();
      }
    };

    socket.on('instance:status-changed', handler);
    return () => {
      socket.off('instance:status-changed', handler);
    };
  }, [accessToken, fetchInstances]);

  // ─── QR Code Polling Cleanup ────────────────────
  useEffect(() => {
    return () => {
      if (qrPollingRef.current) clearInterval(qrPollingRef.current);
    };
  }, []);

  // ─── Stats ──────────────────────────────────────
  const stats = {
    total,
    connected: instances.filter((i) => i.status === 'connected').length,
    warmingUp: instances.filter((i) => !i.warmup_completed).length,
    avgHealth: instances.length
      ? Math.round(instances.reduce((sum, i) => sum + i.health_score, 0) / instances.length)
      : 0,
  };

  // ─── Create (creates on UazAPI + opens QR) ─────
  const handleCreate = async () => {
    try {
      setSubmitting(true);
      const { data } = await api.post('/instances', {
        nome: formNome,
        telefone: formTelefone || undefined,
      });
      toast.success('Instancia criada! Escaneie o QR Code para conectar.');
      setCreateOpen(false);
      resetForm();
      fetchInstances();
      // Auto-open QR code dialog
      openQrDialog(data);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message ?? 'Erro ao criar instancia');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── QR Code Dialog ─────────────────────────────
  const openQrDialog = async (instance: Instance) => {
    setSelectedInstance(instance);
    setQrCode(null);
    setQrStatus('connecting');
    setQrLoading(true);
    setQrOpen(true);

    try {
      // Trigger connect to get QR
      const { data } = await api.post<QrCodeResponse>(`/instances/${instance.id}/connect`);
      setQrCode(data.qrcode);
      setQrStatus(data.status);

      if (data.status === 'connected') {
        toast.success(`${instance.nome} ja esta conectada!`);
        fetchInstances();
        return;
      }

      // Start polling for status updates
      startQrPolling(instance.id);
    } catch {
      toast.error('Erro ao gerar QR Code');
    } finally {
      setQrLoading(false);
    }
  };

  const startQrPolling = (instanceId: string) => {
    if (qrPollingRef.current) clearInterval(qrPollingRef.current);

    qrPollingRef.current = setInterval(async () => {
      try {
        const { data } = await api.get<QrCodeResponse>(`/instances/${instanceId}/qrcode`);

        if (data.status === 'connected') {
          setQrStatus('connected');
          setQrCode(null);
          if (qrPollingRef.current) clearInterval(qrPollingRef.current);
          toast.success('WhatsApp conectado com sucesso!');
          fetchInstances();
          return;
        }

        // Update QR if changed
        if (data.qrcode) {
          setQrCode(data.qrcode);
        }
        setQrStatus(data.status);
      } catch {
        // Silently retry
      }
    }, 3000);
  };

  // ─── Pairing Code (connect via phone number) ───
  const handleConnectByPhone = async () => {
    if (!selectedInstance || !pairingPhone.trim()) return;
    try {
      setPairingLoading(true);
      setPairingCode(null);
      const { data } = await api.post<{ pairingCode: string; status: string }>(
        `/instances/${selectedInstance.id}/connect-phone`,
        { phoneNumber: pairingPhone.replace(/\D/g, '') },
      );
      setPairingCode(data.pairingCode);
      setQrStatus('connecting');
      // Start polling to detect when connected
      startQrPolling(selectedInstance.id);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message ?? 'Erro ao gerar codigo de pareamento');
    } finally {
      setPairingLoading(false);
    }
  };

  const closeQrDialog = () => {
    setQrOpen(false);
    if (qrPollingRef.current) {
      clearInterval(qrPollingRef.current);
      qrPollingRef.current = null;
    }
    setQrCode(null);
    setPairingCode(null);
    setPairingPhone('');
    setConnectMode('qr');
    setSelectedInstance(null);
  };

  // ─── Connect (existing instance) ───────────────
  const handleConnect = (instance: Instance) => {
    openQrDialog(instance);
  };

  // ─── Edit ───────────────────────────────────────
  const openEdit = (instance: Instance) => {
    setSelectedInstance(instance);
    setFormNome(instance.nome);
    setFormTelefone(instance.telefone ?? '');
    setFormDailyLimit(String(instance.daily_limit));
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!selectedInstance) return;
    try {
      setSubmitting(true);
      await api.patch(`/instances/${selectedInstance.id}`, {
        nome: formNome,
        telefone: formTelefone || null,
        daily_limit: parseInt(formDailyLimit, 10),
      });
      toast.success('Instancia atualizada');
      setEditOpen(false);
      resetForm();
      fetchInstances();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message ?? 'Erro ao atualizar instancia');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Delete ─────────────────────────────────────
  const openDelete = (instance: Instance) => {
    setSelectedInstance(instance);
    setDeleteOpen(true);
  };

  const handleDelete = async () => {
    if (!selectedInstance) return;
    try {
      setSubmitting(true);
      await api.delete(`/instances/${selectedInstance.id}`);
      toast.success('Instancia removida');
      setDeleteOpen(false);
      setSelectedInstance(null);
      fetchInstances();
    } catch {
      toast.error('Erro ao remover instancia');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Disconnect ─────────────────────────────────
  const handleDisconnect = async (instance: Instance) => {
    try {
      await api.post(`/instances/${instance.id}/disconnect`);
      toast.success(`${instance.nome} desconectada`);
    } catch {
      toast.error('Erro ao desconectar instancia');
    }
  };

  const resetForm = () => {
    setFormNome('');
    setFormTelefone('');
    setFormDailyLimit('1000');
    setSelectedInstance(null);
  };

  // ─── Render ─────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Smartphone className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-text-primary">Instancias WhatsApp</h1>
        </div>
        <Button onClick={() => { resetForm(); setCreateOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" />
          Nova Instancia
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Smartphone className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Total</p>
              <p className="text-2xl font-bold text-text-primary">{stats.total}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Signal className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Conectadas</p>
              <p className="text-2xl font-bold text-text-primary">{stats.connected}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-warning/10 p-2">
              <Flame className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Aquecendo</p>
              <p className="text-2xl font-bold text-text-primary">{stats.warmingUp}</p>
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

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary" />
          <Input
            placeholder="Buscar por nome..."
            className="pl-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Filtrar status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="connected">Conectado</SelectItem>
            <SelectItem value="disconnected">Desconectado</SelectItem>
            <SelectItem value="connecting">Conectando</SelectItem>
            <SelectItem value="banned">Banido</SelectItem>
            <SelectItem value="cooldown">Cooldown</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Instance List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : instances.length === 0 ? (
        <Card>
          <CardContent className="p-12 flex flex-col items-center justify-center text-center">
            <Smartphone className="h-12 w-12 text-text-secondary mb-4" />
            <h3 className="text-lg font-semibold text-text-primary mb-1">Nenhuma instancia</h3>
            <p className="text-text-secondary mb-4">
              Crie sua primeira instancia WhatsApp para comecar a enviar mensagens.
            </p>
            <Button onClick={() => { resetForm(); setCreateOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" />
              Nova Instancia
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {instances.map((instance) => {
            const statusCfg = getStatusConfig(instance.status);
            return (
              <Card key={instance.id} className="hover:border-border/80 transition-colors">
                <CardContent className="p-4">
                  <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                    {/* Name & Phone */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-text-primary truncate">
                          {instance.nome}
                        </h3>
                        <Badge variant={statusCfg.variant} className={statusCfg.className}>
                          {statusCfg.label}
                        </Badge>
                      </div>
                      <p className="text-sm text-text-secondary">
                        {instance.telefone ?? 'Sem telefone'}
                      </p>
                    </div>

                    {/* Health */}
                    <div className="w-32">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-text-secondary">Saude</span>
                        <span className="text-xs font-medium text-text-primary">
                          {instance.health_score}%
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${getHealthColor(instance.health_score)}`}
                          style={{ width: `${instance.health_score}%` }}
                        />
                      </div>
                    </div>

                    {/* Warmup */}
                    <div className="text-center">
                      <span className="text-xs text-text-secondary block mb-1">Warmup</span>
                      <Badge variant="outline" className="text-xs">
                        {instance.warmup_completed
                          ? 'Completo'
                          : `${getWarmupLabel(instance.warmup_phase)} (D${instance.warmup_day})`}
                      </Badge>
                    </div>

                    {/* Daily */}
                    <div className="text-center">
                      <span className="text-xs text-text-secondary block mb-1">Envios Hoje</span>
                      <div className="flex items-center gap-1">
                        <BarChart3 className="h-3 w-3 text-text-secondary" />
                        <span className="text-sm font-medium text-text-primary">
                          {instance.daily_sent}/{instance.daily_limit}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      {instance.status === 'connected' ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDisconnect(instance)}
                          title="Desconectar"
                        >
                          <WifiOff className="h-4 w-4 text-text-secondary" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleConnect(instance)}
                          title="Conectar"
                          disabled={instance.status === 'banned'}
                        >
                          <Wifi className="h-4 w-4 text-text-secondary" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(instance)}
                        title="Editar"
                      >
                        <Pencil className="h-4 w-4 text-text-secondary" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openDelete(instance)}
                        title="Excluir"
                      >
                        <Trash2 className="h-4 w-4 text-danger" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!loading && instances.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-text-secondary">
            {total} instancia{total !== 1 ? 's' : ''} encontrada{total !== 1 ? 's' : ''}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </Button>
            <span className="text-sm text-text-secondary">Pagina {page}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={instances.length < 20}
              onClick={() => setPage((p) => p + 1)}
            >
              Proxima
            </Button>
          </div>
        </div>
      )}

      {/* ─── Create Dialog (simplified - just name) ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Instancia</DialogTitle>
            <DialogDescription>
              Defina um nome para a instancia. Apos criar, escaneie o QR Code com seu WhatsApp.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="create-nome">Nome da Instancia *</Label>
              <Input
                id="create-nome"
                placeholder="Ex: Vendas-01"
                value={formNome}
                onChange={(e) => setFormNome(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && formNome.trim() && handleCreate()}
              />
              <p className="text-xs text-text-secondary">
                Use um nome unico sem espacos (ex: vendas-01, suporte-principal)
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={submitting || !formNome.trim()}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Criando...
                </>
              ) : (
                <>
                  <QrCode className="mr-2 h-4 w-4" />
                  Criar e Conectar
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── QR Code / Pairing Code Dialog ─────── */}
      <Dialog open={qrOpen} onOpenChange={(open) => { if (!open) closeQrDialog(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {qrStatus === 'connected' ? (
                <CheckCircle2 className="h-5 w-5 text-primary" />
              ) : connectMode === 'qr' ? (
                <QrCode className="h-5 w-5 text-primary" />
              ) : (
                <Phone className="h-5 w-5 text-primary" />
              )}
              {selectedInstance?.nome}
            </DialogTitle>
            <DialogDescription>
              {qrStatus === 'connected'
                ? 'WhatsApp conectado com sucesso!'
                : connectMode === 'qr'
                  ? 'Abra o WhatsApp no celular > Aparelhos conectados > Conectar um aparelho'
                  : 'Conecte usando o codigo de pareamento digitado no WhatsApp'}
            </DialogDescription>
          </DialogHeader>

          {/* Mode Switcher (hidden when connected) */}
          {qrStatus !== 'connected' && (
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                type="button"
                className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-sm font-medium transition-colors ${
                  connectMode === 'qr'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-transparent text-text-secondary hover:bg-muted'
                }`}
                onClick={() => {
                  setConnectMode('qr');
                  setPairingCode(null);
                  if (selectedInstance && !qrCode && !qrLoading) {
                    openQrDialog(selectedInstance);
                  }
                }}
              >
                <QrCode className="h-4 w-4" />
                QR Code
              </button>
              <button
                type="button"
                className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-sm font-medium transition-colors ${
                  connectMode === 'phone'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-transparent text-text-secondary hover:bg-muted'
                }`}
                onClick={() => {
                  setConnectMode('phone');
                  if (qrPollingRef.current) {
                    clearInterval(qrPollingRef.current);
                    qrPollingRef.current = null;
                  }
                }}
              >
                <Phone className="h-4 w-4" />
                Numero de Telefone
              </button>
            </div>
          )}

          <div className="flex flex-col items-center justify-center py-4">
            {qrStatus === 'connected' ? (
              <div className="flex flex-col items-center gap-4">
                <div className="rounded-full bg-primary/10 p-6">
                  <CheckCircle2 className="h-16 w-16 text-primary" />
                </div>
                <p className="text-lg font-semibold text-text-primary">Conectado!</p>
                <p className="text-sm text-text-secondary text-center">
                  Sua instancia esta pronta para enviar mensagens.
                </p>
              </div>
            ) : connectMode === 'qr' ? (
              /* ─── QR Code Mode ─── */
              qrLoading ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-text-secondary">Gerando QR Code...</p>
                </div>
              ) : qrCode ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="rounded-2xl bg-white p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={qrCode}
                      alt="QR Code WhatsApp"
                      className="w-64 h-64"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-text-secondary" />
                    <p className="text-sm text-text-secondary">
                      Aguardando leitura do QR Code...
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <QrCode className="h-16 w-16 text-text-secondary/30" />
                  <p className="text-sm text-text-secondary">
                    QR Code nao disponivel. Tente novamente.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => selectedInstance && openQrDialog(selectedInstance)}
                  >
                    Tentar Novamente
                  </Button>
                </div>
              )
            ) : (
              /* ─── Phone Number / Pairing Code Mode ─── */
              <div className="flex flex-col items-center gap-4 w-full">
                {!pairingCode ? (
                  <>
                    <div className="w-full space-y-2">
                      <Label htmlFor="pairing-phone">Numero do WhatsApp (com DDD e DDI)</Label>
                      <Input
                        id="pairing-phone"
                        placeholder="Ex: 5537999999999"
                        value={pairingPhone}
                        onChange={(e) => setPairingPhone(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && pairingPhone.trim() && handleConnectByPhone()}
                      />
                      <p className="text-xs text-text-secondary">
                        Digite o numero completo com codigo do pais (55 para Brasil)
                      </p>
                    </div>
                    <Button
                      className="w-full"
                      onClick={handleConnectByPhone}
                      disabled={pairingLoading || !pairingPhone.trim()}
                    >
                      {pairingLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Gerando codigo...
                        </>
                      ) : (
                        <>
                          <Phone className="mr-2 h-4 w-4" />
                          Gerar Codigo de Pareamento
                        </>
                      )}
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="rounded-2xl bg-surface border border-border p-6 text-center">
                      <p className="text-xs text-text-secondary mb-2">Codigo de Pareamento</p>
                      <p className="text-4xl font-mono font-bold tracking-[0.3em] text-primary">
                        {pairingCode.replace(/(.{4})/g, '$1-').replace(/-$/, '')}
                      </p>
                    </div>
                    <div className="text-center space-y-2">
                      <p className="text-sm text-text-secondary">
                        No celular, abra o WhatsApp &gt; Aparelhos conectados &gt; Conectar um aparelho &gt;
                        <strong className="text-text-primary"> Entrar com numero de telefone</strong>
                      </p>
                      <p className="text-sm text-text-secondary">
                        Digite o codigo acima no WhatsApp para conectar.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-text-secondary" />
                      <p className="text-sm text-text-secondary">
                        Aguardando pareamento...
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setPairingCode(null); setPairingPhone(''); }}
                    >
                      Gerar Novo Codigo
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant={qrStatus === 'connected' ? 'default' : 'outline'}
              onClick={closeQrDialog}
            >
              {qrStatus === 'connected' ? 'Concluir' : 'Fechar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Edit Dialog ─────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Instancia</DialogTitle>
            <DialogDescription>
              Atualize as configuracoes da instancia.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-nome">Nome *</Label>
              <Input
                id="edit-nome"
                value={formNome}
                onChange={(e) => setFormNome(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-telefone">Telefone</Label>
              <Input
                id="edit-telefone"
                value={formTelefone}
                onChange={(e) => setFormTelefone(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-limit">Limite Diario</Label>
              <Input
                id="edit-limit"
                type="number"
                min="1"
                max="10000"
                value={formDailyLimit}
                onChange={(e) => setFormDailyLimit(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleEdit} disabled={submitting || !formNome.trim()}>
              {submitting ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Dialog ───────────────────────── */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir Instancia</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir a instancia{' '}
              <strong>{selectedInstance?.nome}</strong>? Esta acao nao pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={submitting}>
              {submitting ? 'Excluindo...' : 'Excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
