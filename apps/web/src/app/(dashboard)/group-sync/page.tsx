'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Plus,
  Trash2,
  Play,
  Pause,
  Download,
  UsersRound,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
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
  status: string;
}

interface GroupSync {
  id: string;
  nome: string;
  source_group_jid: string;
  dest_group_jid: string;
  instance_id: string;
  instance: { nome: string; status: string };
  status: string;
  extracted_count: number;
  added_count: number;
  failed_count: number;
  daily_add_cap: number;
  added_today: number;
  created_at: string;
}

// ─── Status config ───────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  IDLE:        { label: 'Aguardando',  className: 'bg-zinc-800 text-zinc-300' },
  EXTRACTING:  { label: 'Extraindo',   className: 'bg-warning/20 text-warning' },
  ADDING:      { label: 'Adicionando', className: 'bg-primary/20 text-primary' },
  COMPLETED:   { label: 'Concluído',   className: 'bg-green-900/30 text-green-400' },
  FAILED:      { label: 'Erro',        className: 'bg-danger/20 text-danger' },
  PAUSED:      { label: 'Pausado',     className: 'bg-zinc-700 text-zinc-400' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, className: 'bg-zinc-800 text-zinc-300' };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.className}`}>{cfg.label}</span>;
}

function ProgressBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max === 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div className={`h-1.5 w-full rounded-full bg-zinc-800 ${className}`}>
      <div className="h-1.5 rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────
export default function GroupSyncPage() {
  const [syncs, setSyncs] = useState<GroupSync[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [form, setForm] = useState({
    nome: '',
    source_group_jid: '',
    dest_group_jid: '',
    instance_id: '',
    daily_add_cap: '50',
  });

  const fetchSyncs = useCallback(async () => {
    try {
      const { data } = await api.get<GroupSync[]>('/group-sync');
      setSyncs(data);
    } catch {
      toast.error('Erro ao carregar sincronizações');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchInstances = useCallback(async () => {
    try {
      const { data } = await api.get<{ instances: Instance[] }>('/instances');
      setInstances(data.instances ?? data as unknown as Instance[]);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchSyncs();
    fetchInstances();
  }, [fetchSyncs, fetchInstances]);

  async function handleCreate() {
    if (!form.nome || !form.source_group_jid || !form.dest_group_jid || !form.instance_id) {
      toast.error('Preencha todos os campos obrigatórios');
      return;
    }
    setCreating(true);
    try {
      await api.post('/group-sync', {
        ...form,
        daily_add_cap: Number(form.daily_add_cap),
      });
      toast.success('Sincronização criada');
      setShowCreate(false);
      setForm({ nome: '', source_group_jid: '', dest_group_jid: '', instance_id: '', daily_add_cap: '50' });
      fetchSyncs();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Erro ao criar sincronização');
    } finally {
      setCreating(false);
    }
  }

  async function handleExtract(id: string) {
    setActionLoading(id + ':extract');
    try {
      await api.post(`/group-sync/${id}/extract`);
      toast.success('Extração iniciada');
      fetchSyncs();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Erro ao extrair participantes');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleStart(id: string) {
    setActionLoading(id + ':start');
    try {
      const { data } = await api.post<{ queued: number }>(`/group-sync/${id}/start`);
      toast.success(`${data.queued} adições enfileiradas`);
      fetchSyncs();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Erro ao iniciar adição');
    } finally {
      setActionLoading(null);
    }
  }

  async function handlePause(id: string) {
    setActionLoading(id + ':pause');
    try {
      await api.post(`/group-sync/${id}/pause`);
      toast.success('Pausado');
      fetchSyncs();
    } catch {
      toast.error('Erro ao pausar');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(id: string, nome: string) {
    if (!confirm(`Deletar "${nome}"?`)) return;
    try {
      await api.delete(`/group-sync/${id}`);
      toast.success('Deletado');
      setSyncs((prev) => prev.filter((s) => s.id !== id));
    } catch {
      toast.error('Erro ao deletar');
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Grupos</h1>
          <p className="text-sm text-text-secondary mt-0.5">Extraia e adicione participantes entre grupos do WhatsApp</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Nova sincronização
        </Button>
      </div>

      {/* List */}
      {loading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-36 w-full rounded-xl" />)}
        </div>
      ) : syncs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-text-secondary gap-3">
          <UsersRound className="h-10 w-10 opacity-30" />
          <p className="text-sm">Nenhuma sincronização criada</p>
          <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>Criar primeira</Button>
        </div>
      ) : (
        <div className="grid gap-4">
          {syncs.map((sync) => {
            const isExtracting = actionLoading === sync.id + ':extract';
            const isStarting   = actionLoading === sync.id + ':start';
            const isPausing    = actionLoading === sync.id + ':pause';
            const isRunning    = sync.status === 'ADDING';
            const canExtract   = sync.status !== 'ADDING' && sync.status !== 'EXTRACTING';
            const canStart     = sync.extracted_count > 0 && sync.status !== 'ADDING' && sync.status !== 'EXTRACTING';
            const canPause     = sync.status === 'ADDING';

            return (
              <Card key={sync.id} className="bg-surface border-border">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    {/* Left info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-text-primary truncate">{sync.nome}</span>
                        <StatusBadge status={sync.status} />
                        <span className="text-xs text-text-secondary">{sync.instance.nome}</span>
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-text-secondary">
                        <span className="truncate">Origem: <span className="font-mono text-zinc-400">{sync.source_group_jid}</span></span>
                        <span className="truncate">Destino: <span className="font-mono text-zinc-400">{sync.dest_group_jid}</span></span>
                      </div>

                      {/* Progress */}
                      {sync.extracted_count > 0 && (
                        <div className="mt-3 space-y-1">
                          <div className="flex justify-between text-xs text-text-secondary">
                            <span>{sync.added_count} adicionados de {sync.extracted_count}</span>
                            <span className="text-danger">{sync.failed_count} falhas</span>
                          </div>
                          <ProgressBar value={sync.added_count} max={sync.extracted_count} />
                        </div>
                      )}

                      <div className="mt-2 flex gap-4 text-xs text-text-secondary">
                        <span>Cap diário: {sync.daily_add_cap}</span>
                        <span>Hoje: {sync.added_today}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {canExtract && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleExtract(sync.id)}
                          disabled={isExtracting}
                          className="gap-1.5"
                        >
                          {isExtracting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                          Extrair
                        </Button>
                      )}
                      {canStart && (
                        <Button
                          size="sm"
                          onClick={() => handleStart(sync.id)}
                          disabled={isStarting}
                          className="gap-1.5"
                        >
                          {isStarting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                          Iniciar
                        </Button>
                      )}
                      {canPause && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handlePause(sync.id)}
                          disabled={isPausing}
                          className="gap-1.5"
                        >
                          {isPausing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pause className="h-3 w-3" />}
                          Pausar
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(sync.id, sync.nome)}
                        className="text-danger hover:text-danger hover:bg-danger/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md bg-surface border-border">
          <DialogHeader>
            <DialogTitle>Nova sincronização de grupo</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                placeholder="Ex: Clientes → VIP"
                value={form.nome}
                onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Instância</Label>
              <Select value={form.instance_id} onValueChange={(v) => setForm((f) => ({ ...f, instance_id: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma instância conectada" />
                </SelectTrigger>
                <SelectContent>
                  {instances.filter((i) => i.status === 'connected').map((i) => (
                    <SelectItem key={i.id} value={i.id}>{i.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>JID do grupo origem</Label>
              <Input
                placeholder="120363000000000000@g.us"
                value={form.source_group_jid}
                onChange={(e) => setForm((f) => ({ ...f, source_group_jid: e.target.value }))}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label>JID do grupo destino</Label>
              <Input
                placeholder="120363999999999999@g.us"
                value={form.dest_group_jid}
                onChange={(e) => setForm((f) => ({ ...f, dest_group_jid: e.target.value }))}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Cap diário de adições <span className="text-text-secondary">(máx. recomendado: 50)</span></Label>
              <Input
                type="number"
                min={1}
                max={200}
                value={form.daily_add_cap}
                onChange={(e) => setForm((f) => ({ ...f, daily_add_cap: e.target.value }))}
              />
            </div>

            <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 flex gap-2">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-text-secondary">
                As adições são feitas com delay de 30–90s entre cada membro e respeitam a janela horária configurada nas Configurações. Manter o cap diário em ≤50 reduz risco de ban.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
