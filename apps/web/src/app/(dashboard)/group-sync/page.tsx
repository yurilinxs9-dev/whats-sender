'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Plus,
  Trash2,
  Play,
  Pause,
  Download,
  UsersRound,
  Loader2,
  AlertTriangle,
  RefreshCw,
  FileBarChart,
  CheckCircle2,
  XCircle,
  Clock,
  Send,
  Settings2,
  Link2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
interface Instance { id: string; nome: string; status: string }
interface WaGroup { id: string; subject: string; size: number }

interface Extraction {
  id: string;
  nome: string;
  source_group_jid: string;
  source_group_name: string;
  total_members: number;
  status: string;
  error?: string | null;
  extracted_at?: string | null;
  created_at: string;
  instance: { nome: string; status: string };
  _count?: { members: number; add_jobs: number };
}
interface ExtractedMember { id: string; jid: string; phone: string; display_name?: string | null; is_admin: boolean }
interface ExtractionDetail extends Extraction { members: ExtractedMember[] }

interface AddJob {
  id: string;
  nome: string;
  dest_group_jid: string;
  dest_group_name: string;
  per_run_limit: number;
  daily_add_cap: number;
  delay_min_s: number;
  delay_max_s: number;
  send_invite_on_fail: boolean;
  invite_link: string | null;
  invite_message: string;
  invited_count: number;
  added_count: number;
  failed_count: number;
  skipped_count: number;
  added_today: number;
  status: string;
  created_at: string;
  dest_instance: { nome: string; status: string };
  extraction: { nome: string; source_group_name: string };
  _count?: { targets: number };
}
interface AddTarget { id: string; member_jid: string; phone: string; status: string; attempts: number; error?: string | null; added_at?: string | null; invited_at?: string | null }
interface AddJobDetail extends AddJob { targets: AddTarget[] }

// ─── Status config ───────────────────────────────────
const EXTRACTION_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING:    { label: 'Aguardando', cls: 'bg-zinc-800 text-zinc-300' },
  EXTRACTING: { label: 'Extraindo',  cls: 'bg-warning/20 text-warning' },
  DONE:       { label: 'Pronta',     cls: 'bg-green-900/30 text-green-400' },
  FAILED:     { label: 'Erro',       cls: 'bg-danger/20 text-danger' },
};
const JOB_STATUS: Record<string, { label: string; cls: string }> = {
  IDLE:      { label: 'Aguardando',  cls: 'bg-zinc-800 text-zinc-300' },
  RUNNING:   { label: 'Adicionando', cls: 'bg-primary/20 text-primary' },
  PAUSED:    { label: 'Pausado',     cls: 'bg-zinc-700 text-zinc-400' },
  COMPLETED: { label: 'Concluído',   cls: 'bg-green-900/30 text-green-400' },
  FAILED:    { label: 'Erro',        cls: 'bg-danger/20 text-danger' },
};
const DEFAULT_INVITE_MSG =
  'Oi! Nao consegui te adicionar direto no grupo (sua privacidade do WhatsApp bloqueia). Entra por aqui: {link}';

const TARGET_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING:    { label: 'Pendente',  cls: 'text-zinc-400' },
  PROCESSING: { label: 'Em curso',  cls: 'text-warning' },
  DONE:       { label: 'Adicionado', cls: 'text-green-400' },
  FAILED:     { label: 'Falhou',    cls: 'text-danger' },
  SKIPPED:    { label: 'Pulado',    cls: 'text-zinc-500' },
  INVITED:    { label: 'Convidado', cls: 'text-blue-400' },
};

function Badge({ map, status }: { map: Record<string, { label: string; cls: string }>; status: string }) {
  const cfg = map[status] ?? { label: status, cls: 'bg-zinc-800 text-zinc-300' };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.cls}`}>{cfg.label}</span>;
}
function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max === 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="h-1.5 w-full rounded-full bg-zinc-800">
      <div className="h-1.5 rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}
function errMsg(e: unknown, fallback: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}
function GroupSelect({ label, value, onChange, groups, loading }: {
  label: string; value: string; onChange: (v: string) => void; groups: WaGroup[]; loading: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {loading ? <Skeleton className="h-10 w-full" />
        : groups.length === 0 ? <p className="text-xs text-text-secondary py-2">Selecione uma instância primeiro</p>
        : (
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger><SelectValue placeholder="Selecione um grupo" /></SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.subject || '(sem nome)'} <span className="text-xs text-zinc-500 ml-1">({g.size} membros)</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
export default function GroupsPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Grupos</h1>
        <p className="text-sm text-text-secondary mt-0.5">Extraia membros uma vez e reaproveite em várias adições</p>
      </div>
      <Tabs defaultValue="extractions">
        <TabsList>
          <TabsTrigger value="extractions">Extrações</TabsTrigger>
          <TabsTrigger value="addjobs">Adições</TabsTrigger>
        </TabsList>
        <TabsContent value="extractions"><ExtractionsTab /></TabsContent>
        <TabsContent value="addjobs"><AddJobsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── helper: carregar instâncias + grupos ────────────
function useInstancesAndGroups() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [waGroups, setWaGroups] = useState<WaGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);

  const fetchInstances = useCallback(async () => {
    try {
      const { data } = await api.get<{ instances: Instance[] }>('/instances?limit=100');
      setInstances(data.instances ?? []);
    } catch { /* silent */ }
  }, []);
  useEffect(() => { fetchInstances(); }, [fetchInstances]);

  const loadGroups = useCallback(async (instanceId: string) => {
    setWaGroups([]);
    if (!instanceId) return;
    setGroupsLoading(true);
    try {
      const { data } = await api.get<WaGroup[]>(`/groups/instances/${instanceId}/groups`);
      setWaGroups(data);
      if (data.length === 0) toast.warning('Nenhum grupo encontrado para esta instância');
    } catch {
      toast.error('Erro ao buscar grupos — verifique se a instância está conectada');
    } finally { setGroupsLoading(false); }
  }, []);

  return { instances, waGroups, groupsLoading, loadGroups, setWaGroups };
}

// ═══════════════ Aba EXTRAÇÕES ═══════════════
function ExtractionsTab() {
  const [items, setItems] = useState<Extraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<ExtractionDetail | null>(null);
  const { instances, waGroups, groupsLoading, loadGroups, setWaGroups } = useInstancesAndGroups();
  const [form, setForm] = useState({ nome: '', instance_id: '', source_group_jid: '' });

  const fetchItems = useCallback(async () => {
    try { const { data } = await api.get<Extraction[]>('/groups/extractions'); setItems(data); }
    catch { toast.error('Erro ao carregar extrações'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchItems(); }, [fetchItems]);

  // Poll enquanto houver extração em andamento (atualiza status/contagem)
  useEffect(() => {
    const running = items.some((e) => e.status === 'EXTRACTING' || e.status === 'PENDING');
    if (!running) return;
    const t = setTimeout(() => { fetchItems(); }, 3000);
    return () => clearTimeout(t);
  }, [items, fetchItems]);

  async function onInstance(id: string) {
    setForm((f) => ({ ...f, instance_id: id, source_group_jid: '' }));
    await loadGroups(id);
  }
  async function create() {
    if (!form.nome || !form.instance_id || !form.source_group_jid) { toast.error('Preencha todos os campos'); return; }
    const g = waGroups.find((x) => x.id === form.source_group_jid);
    setCreating(true);
    try {
      await api.post('/groups/extractions', {
        nome: form.nome,
        instance_id: form.instance_id,
        source_group_jid: form.source_group_jid,
        source_group_name: g?.subject ?? '',
      });
      toast.success('Extração iniciada — acompanhe o progresso');
      setShow(false);
      setForm({ nome: '', instance_id: '', source_group_jid: '' });
      setWaGroups([]);
      fetchItems();
    } catch (e) { toast.error(errMsg(e, 'Erro ao extrair')); }
    finally { setCreating(false); }
  }
  async function reExtract(id: string) {
    setBusy(id + ':re');
    try { await api.post(`/groups/extractions/${id}/re-extract`); toast.success('Re-extraído'); fetchItems(); }
    catch (e) { toast.error(errMsg(e, 'Erro ao re-extrair')); }
    finally { setBusy(null); }
  }
  async function del(id: string, nome: string) {
    if (!confirm(`Deletar extração "${nome}"? Jobs de adição que a usam ficam órfãos.`)) return;
    try { await api.delete(`/groups/extractions/${id}`); toast.success('Deletada'); setItems((p) => p.filter((x) => x.id !== id)); }
    catch (e) { toast.error(errMsg(e, 'Erro ao deletar')); }
  }
  async function openReport(id: string) {
    try { const { data } = await api.get<ExtractionDetail>(`/groups/extractions/${id}`); setReport(data); }
    catch { toast.error('Erro ao carregar relatório'); }
  }
  function exportCsv(d: ExtractionDetail) {
    const rows = [['phone', 'jid', 'admin'], ...d.members.map((m) => [m.phone, m.jid, m.is_admin ? 'sim' : 'nao'])];
    downloadCsv(rows, `extracao-${d.nome}.csv`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setShow(true)} className="gap-2"><Plus className="h-4 w-4" />Nova extração</Button>
      </div>

      {loading ? <div className="grid gap-4">{[1, 2].map((i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}</div>
        : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-secondary gap-3">
            <UsersRound className="h-10 w-10 opacity-30" />
            <p className="text-sm">Nenhuma extração ainda</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {items.map((e) => (
              <Card key={e.id} className="bg-surface border-border">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-text-primary truncate">{e.nome}</span>
                        <Badge map={EXTRACTION_STATUS} status={e.status} />
                        {(e.status === 'EXTRACTING' || e.status === 'PENDING') && <Loader2 className="h-3.5 w-3.5 animate-spin text-warning" />}
                        <span className="text-xs text-text-secondary">{e.instance.nome}</span>
                      </div>
                      <p className="text-xs text-text-secondary mt-1 truncate">
                        Origem: {e.source_group_name || e.source_group_jid}
                      </p>
                      <div className="mt-2 flex gap-4 text-xs text-text-secondary">
                        <span className="text-text-primary font-medium">{e.total_members} membros</span>
                        {e._count && <span>{e._count.add_jobs} job(s) usando</span>}
                        {e.extracted_at && <span>em {new Date(e.extracted_at).toLocaleString('pt-BR')}</span>}
                      </div>
                      {e.status === 'FAILED' && e.error && <p className="text-xs text-danger mt-1">{e.error}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => openReport(e.id)} className="gap-1.5" disabled={e.total_members === 0}>
                        <FileBarChart className="h-3 w-3" />Relatório
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => reExtract(e.id)} disabled={busy === e.id + ':re'} className="gap-1.5">
                        {busy === e.id + ':re' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}Re-extrair
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => del(e.id, e.nome)} className="text-danger hover:text-danger hover:bg-danger/10">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

      {/* Dialog criar extração */}
      <Dialog open={show} onOpenChange={(o) => { setShow(o); if (!o) { setWaGroups([]); setForm({ nome: '', instance_id: '', source_group_jid: '' }); } }}>
        <DialogContent className="sm:max-w-lg bg-surface border-border">
          <DialogHeader><DialogTitle>Nova extração</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input placeholder="Ex: Grupo Distribuidora — base" value={form.nome} onChange={(ev) => setForm((f) => ({ ...f, nome: ev.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Instância</Label>
              <Select value={form.instance_id} onValueChange={onInstance}>
                <SelectTrigger><SelectValue placeholder="Selecione uma instância" /></SelectTrigger>
                <SelectContent>
                  {instances.length === 0 && <SelectItem value="_none" disabled>Nenhuma instância</SelectItem>}
                  {instances.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.nome}<span className={`ml-2 text-xs ${i.status === 'connected' ? 'text-primary' : 'text-zinc-500'}`}>{i.status === 'connected' ? '● conectada' : '○ desconectada'}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.instance_id && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary">{waGroups.length} grupos encontrados</span>
                <Button variant="ghost" size="sm" onClick={() => loadGroups(form.instance_id)} disabled={groupsLoading} className="gap-1.5 h-7 text-xs">
                  <RefreshCw className={`h-3 w-3 ${groupsLoading ? 'animate-spin' : ''}`} />Atualizar lista
                </Button>
              </div>
            )}
            <GroupSelect label="Grupo origem (de onde extrair)" value={form.source_group_jid} onChange={(v) => setForm((f) => ({ ...f, source_group_jid: v }))} groups={waGroups} loading={groupsLoading} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShow(false)}>Cancelar</Button>
            <Button onClick={create} disabled={creating || !form.source_group_jid}>
              {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Extrair
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog relatório extração */}
      <Dialog open={!!report} onOpenChange={(o) => !o && setReport(null)}>
        <DialogContent className="sm:max-w-2xl bg-surface border-border">
          <DialogHeader><DialogTitle>Relatório — {report?.nome}</DialogTitle></DialogHeader>
          {report && (
            <div className="space-y-3">
              <div className="flex gap-4 text-sm">
                <span className="text-text-primary font-medium">{report.total_members} membros</span>
                <span className="text-text-secondary">{report.members.filter((m) => m.is_admin).length} admins</span>
                <Button size="sm" variant="outline" className="gap-1.5 ml-auto" onClick={() => exportCsv(report)}><Download className="h-3 w-3" />CSV</Button>
              </div>
              <div className="max-h-80 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {report.members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                    <span className="text-text-primary">{m.phone || m.jid}</span>
                    {m.is_admin && <span className="text-warning">admin</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════ Aba ADIÇÕES ═══════════════
function AddJobsTab() {
  const [items, setItems] = useState<AddJob[]>([]);
  const [extractions, setExtractions] = useState<Extraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<AddJobDetail | null>(null);
  const { instances, waGroups, groupsLoading, loadGroups, setWaGroups } = useInstancesAndGroups();
  const [form, setForm] = useState({
    nome: '', extraction_id: '', dest_instance_id: '', dest_group_jid: '',
    per_run_limit: '50', daily_add_cap: '50', delay_min_s: '30', delay_max_s: '90', send_invite_on_fail: false,
    invite_link: '', invite_message: DEFAULT_INVITE_MSG,
  });

  const fetchItems = useCallback(async () => {
    try { const { data } = await api.get<AddJob[]>('/groups/add-jobs'); setItems(data); }
    catch { toast.error('Erro ao carregar adições'); }
    finally { setLoading(false); }
  }, []);
  const fetchExtractions = useCallback(async () => {
    try { const { data } = await api.get<Extraction[]>('/groups/extractions'); setExtractions(data.filter((e) => e.status === 'DONE' && e.total_members > 0)); }
    catch { /* silent */ }
  }, []);
  useEffect(() => { fetchItems(); fetchExtractions(); }, [fetchItems, fetchExtractions]);

  // Poll enquanto houver job rodando (progresso ao vivo)
  useEffect(() => {
    const running = items.some((j) => j.status === 'RUNNING');
    if (!running) return;
    const t = setTimeout(() => { fetchItems(); }, 4000);
    return () => clearTimeout(t);
  }, [items, fetchItems]);

  async function onDestInstance(id: string) {
    setForm((f) => ({ ...f, dest_instance_id: id, dest_group_jid: '' }));
    await loadGroups(id);
  }
  async function create() {
    if (!form.nome || !form.extraction_id || !form.dest_instance_id || !form.dest_group_jid) { toast.error('Preencha todos os campos'); return; }
    const g = waGroups.find((x) => x.id === form.dest_group_jid);
    setCreating(true);
    try {
      await api.post('/groups/add-jobs', {
        nome: form.nome,
        extraction_id: form.extraction_id,
        dest_instance_id: form.dest_instance_id,
        dest_group_jid: form.dest_group_jid,
        dest_group_name: g?.subject ?? '',
        per_run_limit: Number(form.per_run_limit),
        daily_add_cap: Number(form.daily_add_cap),
        delay_min_s: Number(form.delay_min_s),
        delay_max_s: Number(form.delay_max_s),
        send_invite_on_fail: form.send_invite_on_fail,
        invite_link: form.invite_link.trim() || null,
        invite_message: form.invite_message,
      });
      toast.success('Job de adição criado');
      setShow(false);
      setForm({ nome: '', extraction_id: '', dest_instance_id: '', dest_group_jid: '', per_run_limit: '50', daily_add_cap: '50', delay_min_s: '30', delay_max_s: '90', send_invite_on_fail: false, invite_link: '', invite_message: DEFAULT_INVITE_MSG });
      setWaGroups([]);
      fetchItems();
    } catch (e) { toast.error(errMsg(e, 'Erro ao criar job')); }
    finally { setCreating(false); }
  }
  async function run(id: string) {
    setBusy(id + ':run');
    try { const { data } = await api.post<{ queued: number }>(`/groups/add-jobs/${id}/run`, {}); toast.success(`${data.queued} adições enfileiradas`); fetchItems(); }
    catch (e) { toast.error(errMsg(e, 'Erro ao rodar')); }
    finally { setBusy(null); }
  }
  const [settings, setSettings] = useState<AddJob | null>(null);

  async function retryFailed(id: string) {
    setBusy(id + ':retry');
    try {
      const { data } = await api.post<{ retried: number }>(`/groups/add-jobs/${id}/retry-failed`, {});
      toast.success(`${data.retried} alvos voltaram para a fila`);
      fetchItems();
    }
    catch (e) { toast.error(errMsg(e, 'Erro ao re-tentar')); }
    finally { setBusy(null); }
  }
  async function pause(id: string) {
    setBusy(id + ':pause');
    try { await api.post(`/groups/add-jobs/${id}/pause`); toast.success('Pausado'); fetchItems(); }
    catch (e) { toast.error(errMsg(e, 'Erro ao pausar')); }
    finally { setBusy(null); }
  }
  async function del(id: string, nome: string) {
    if (!confirm(`Deletar job "${nome}"?`)) return;
    try { await api.delete(`/groups/add-jobs/${id}`); toast.success('Deletado'); setItems((p) => p.filter((x) => x.id !== id)); }
    catch (e) { toast.error(errMsg(e, 'Erro ao deletar')); }
  }
  async function openReport(id: string) {
    try { const { data } = await api.get<AddJobDetail>(`/groups/add-jobs/${id}`); setReport(data); }
    catch { toast.error('Erro ao carregar relatório'); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setShow(true)} className="gap-2"><Plus className="h-4 w-4" />Novo job de adição</Button>
      </div>

      {loading ? <div className="grid gap-4">{[1, 2].map((i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}</div>
        : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-secondary gap-3">
            <UsersRound className="h-10 w-10 opacity-30" />
            <p className="text-sm">Nenhum job de adição. Crie uma extração primeiro.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {items.map((j) => {
              const total = j._count?.targets ?? 0;
              const done = j.added_count + j.failed_count + j.skipped_count;
              const canRun = j.status !== 'RUNNING';
              const canPause = j.status === 'RUNNING';
              return (
                <Card key={j.id} className="bg-surface border-border">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-text-primary truncate">{j.nome}</span>
                          <Badge map={JOB_STATUS} status={j.status} />
                          <span className="text-xs text-text-secondary">{j.dest_instance.nome}</span>
                        </div>
                        <p className="text-xs text-text-secondary mt-1 truncate">
                          {j.extraction.nome} → {j.dest_group_name || j.dest_group_jid}
                        </p>
                        <div className="mt-3 space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-green-400">{j.added_count} adicionados</span>
                            <span className="text-danger">{j.failed_count} falhas</span>
                            <span className="text-text-secondary">{total - done} pendentes</span>
                          </div>
                          <ProgressBar value={done} max={total} />
                        </div>
                        <div className="mt-2 flex gap-4 text-xs text-text-secondary">
                          <span>Lote: {j.per_run_limit}</span>
                          <span>Cap diário: {j.daily_add_cap} (hoje {j.added_today})</span>
                          <span>Delay {j.delay_min_s}-{j.delay_max_s}s</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button size="sm" variant="outline" onClick={() => setSettings(j)} className="gap-1.5"><Settings2 className="h-3 w-3" />Config</Button>
                        <Button size="sm" variant="outline" onClick={() => openReport(j.id)} className="gap-1.5"><FileBarChart className="h-3 w-3" />Relatório</Button>
                        {canRun && <Button size="sm" onClick={() => run(j.id)} disabled={busy === j.id + ':run'} className="gap-1.5">{busy === j.id + ':run' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}Rodar lote</Button>}
                        {j.failed_count > 0 && j.status !== 'RUNNING' && <Button size="sm" variant="outline" onClick={() => retryFailed(j.id)} disabled={busy === j.id + ':retry'} className="gap-1.5">{busy === j.id + ':retry' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}Re-tentar falhas</Button>}
                        {canPause && <Button size="sm" variant="outline" onClick={() => pause(j.id)} disabled={busy === j.id + ':pause'} className="gap-1.5">{busy === j.id + ':pause' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pause className="h-3 w-3" />}Pausar</Button>}
                        <Button size="sm" variant="ghost" onClick={() => del(j.id, j.nome)} className="text-danger hover:text-danger hover:bg-danger/10"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

      {/* Dialog criar job */}
      <Dialog open={show} onOpenChange={(o) => { setShow(o); if (!o) setWaGroups([]); }}>
        <DialogContent className="sm:max-w-lg bg-surface border-border max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Novo job de adição</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input placeholder="Ex: Distribuidora → VIP (lote 1)" value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Extração (fonte dos membros)</Label>
              <Select value={form.extraction_id} onValueChange={(v) => setForm((f) => ({ ...f, extraction_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione uma extração" /></SelectTrigger>
                <SelectContent>
                  {extractions.length === 0 && <SelectItem value="_none" disabled>Nenhuma extração pronta</SelectItem>}
                  {extractions.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.nome} <span className="text-xs text-zinc-500 ml-1">({e.total_members} membros)</span></SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Instância destino (quem adiciona)</Label>
              <Select value={form.dest_instance_id} onValueChange={onDestInstance}>
                <SelectTrigger><SelectValue placeholder="Selecione uma instância" /></SelectTrigger>
                <SelectContent>
                  {instances.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.nome}<span className={`ml-2 text-xs ${i.status === 'connected' ? 'text-primary' : 'text-zinc-500'}`}>{i.status === 'connected' ? '● conectada' : '○ desconectada'}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.dest_instance_id && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary">{waGroups.length} grupos encontrados</span>
                <Button variant="ghost" size="sm" onClick={() => loadGroups(form.dest_instance_id)} disabled={groupsLoading} className="gap-1.5 h-7 text-xs">
                  <RefreshCw className={`h-3 w-3 ${groupsLoading ? 'animate-spin' : ''}`} />Atualizar lista
                </Button>
              </div>
            )}
            <GroupSelect label="Grupo destino (para onde adicionar)" value={form.dest_group_jid} onChange={(v) => setForm((f) => ({ ...f, dest_group_jid: v }))} groups={waGroups} loading={groupsLoading} />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Limite por rodada</Label>
                <Input type="number" min={1} max={500} value={form.per_run_limit} onChange={(e) => setForm((f) => ({ ...f, per_run_limit: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Cap diário</Label>
                <Input type="number" min={1} max={500} value={form.daily_add_cap} onChange={(e) => setForm((f) => ({ ...f, daily_add_cap: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Delay mín (s)</Label>
                <Input type="number" min={5} max={600} value={form.delay_min_s} onChange={(e) => setForm((f) => ({ ...f, delay_min_s: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Delay máx (s)</Label>
                <Input type="number" min={5} max={600} value={form.delay_max_s} onChange={(e) => setForm((f) => ({ ...f, delay_max_s: e.target.value }))} />
              </div>
            </div>

            <InviteFields
              enabled={form.send_invite_on_fail}
              link={form.invite_link}
              message={form.invite_message}
              onToggle={() => setForm((f) => ({ ...f, send_invite_on_fail: !f.send_invite_on_fail }))}
              onLink={(v) => setForm((f) => ({ ...f, invite_link: v }))}
              onMessage={(v) => setForm((f) => ({ ...f, invite_message: v }))}
            />

            <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 flex gap-2">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-text-secondary">Adições com delay e cap diário reduzem risco de ban. Recomendado ≤50/dia por instância. Falha por privacidade do contato é normal.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShow(false)}>Cancelar</Button>
            <Button onClick={create} disabled={creating || !form.dest_group_jid || !form.extraction_id}>
              {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {settings && (
        <AddJobSettings
          job={settings}
          onClose={() => setSettings(null)}
          onSaved={() => { setSettings(null); fetchItems(); }}
        />
      )}

      {/* Dialog relatório job */}
      <Dialog open={!!report} onOpenChange={(o) => !o && setReport(null)}>
        <DialogContent className="sm:max-w-2xl bg-surface border-border">
          <DialogHeader><DialogTitle>Relatório — {report?.nome}</DialogTitle></DialogHeader>
          {report && <AddJobReport job={report} onChanged={() => { openReport(report.id); fetchItems(); }} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddJobReport({ job, onChanged }: { job: AddJobDetail; onChanged: () => void }) {
  const [sending, setSending] = useState<string | null>(null);
  const counts = job.targets.reduce<Record<string, number>>((acc, t) => { acc[t.status] = (acc[t.status] ?? 0) + 1; return acc; }, {});
  const failed = job.targets.filter((t) => t.status === 'FAILED');
  const canInvite = !!job.invite_link;

  async function invite(targetIds?: string[]) {
    if (!canInvite) { toast.error('Cadastre o link de convite em Config antes de convidar'); return; }
    setSending(targetIds?.length === 1 ? targetIds[0] : 'bulk');
    try {
      const { data } = await api.post<{ queued: number }>(
        `/groups/add-jobs/${job.id}/invite`,
        targetIds ? { target_ids: targetIds } : {},
      );
      toast.success(`${data.queued} convite(s) na fila`);
      onChanged();
    } catch (e) { toast.error(errMsg(e, 'Erro ao enviar convite')); }
    finally { setSending(null); }
  }
  // motivos agrupados
  const reasons = failed.reduce<Record<string, number>>((acc, t) => { const r = t.error ?? 'desconhecido'; acc[r] = (acc[r] ?? 0) + 1; return acc; }, {});
  function exportCsv() {
    const rows = [['phone', 'status', 'tentativas', 'erro', 'adicionado_em', 'convidado_em'],
      ...job.targets.map((t) => [t.phone, t.status, String(t.attempts), t.error ?? '', t.added_at ?? '', t.invited_at ?? ''])];
    downloadCsv(rows, `adicao-${job.nome}.csv`);
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <Stat icon={<CheckCircle2 className="h-4 w-4 text-green-400" />} label="Adicionados" value={counts.DONE ?? 0} />
        <Stat icon={<Send className="h-4 w-4 text-blue-400" />} label="Convidados" value={counts.INVITED ?? 0} />
        <Stat icon={<XCircle className="h-4 w-4 text-danger" />} label="Falhas" value={counts.FAILED ?? 0} />
        <Stat icon={<Clock className="h-4 w-4 text-zinc-400" />} label="Pendentes" value={(counts.PENDING ?? 0) + (counts.PROCESSING ?? 0)} />
      </div>
      {Object.keys(reasons).length > 0 && (
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs font-medium text-text-primary mb-2">Motivos de falha</p>
          <div className="space-y-1">
            {Object.entries(reasons).map(([r, n]) => (
              <div key={r} className="flex justify-between text-xs"><span className="text-text-secondary truncate mr-2">{r}</span><span className="text-danger shrink-0">{n}</span></div>
            ))}
          </div>
        </div>
      )}
      {failed.length > 0 && (
        <div className="rounded-lg border border-border p-3 flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-text-primary">{failed.length} números não entraram</p>
            <p className="text-xs text-text-secondary">
              {canInvite
                ? 'Mande o link de convite no privado para todos de uma vez.'
                : 'Cadastre o link de convite em Config para liberar o envio.'}
            </p>
          </div>
          <Button size="sm" className="gap-1.5 ml-auto shrink-0" disabled={!canInvite || sending === 'bulk'}
            onClick={() => invite()}>
            {sending === 'bulk' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            Convidar todos
          </Button>
        </div>
      )}

      <div className="flex justify-end">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={exportCsv}><Download className="h-3 w-3" />Exportar CSV</Button>
      </div>
      <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
        {job.targets.map((t) => (
          <div key={t.id} className="flex items-center justify-between px-3 py-1.5 text-xs gap-2">
            <span className="text-text-primary shrink-0">{t.phone || t.member_jid}</span>
            <span className={`${TARGET_STATUS[t.status]?.cls ?? 'text-zinc-400'} shrink-0`}>{TARGET_STATUS[t.status]?.label ?? t.status}</span>
            {t.error && <span className="text-text-secondary truncate">{t.error}</span>}
            {t.status === 'FAILED' && (
              <Button size="sm" variant="ghost" className="h-6 gap-1 ml-auto shrink-0 text-xs"
                disabled={!canInvite || sending === t.id} onClick={() => invite([t.id])}
                title={canInvite ? 'Enviar link de convite no privado' : 'Cadastre o link em Config'}>
                {sending === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                Convidar
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Configuracoes do job depois de criado: liga/desliga convite, edita link,
// mensagem e ritmo sem precisar recriar o job (e perder o progresso).
function AddJobSettings({ job, onClose, onSaved }: { job: AddJob; onClose: () => void; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(job.send_invite_on_fail);
  const [link, setLink] = useState(job.invite_link ?? '');
  const [message, setMessage] = useState(job.invite_message || DEFAULT_INVITE_MSG);
  const [perRun, setPerRun] = useState(String(job.per_run_limit));
  const [cap, setCap] = useState(String(job.daily_add_cap));
  const [dMin, setDMin] = useState(String(job.delay_min_s));
  const [dMax, setDMax] = useState(String(job.delay_max_s));
  const [saving, setSaving] = useState(false);

  async function save() {
    if (enabled && !link.trim()) { toast.error('Cole o link de convite ou desligue o fallback'); return; }
    if (enabled && !message.includes('{link}')) { toast.error('A mensagem precisa conter {link}'); return; }
    setSaving(true);
    try {
      await api.patch(`/groups/add-jobs/${job.id}`, {
        per_run_limit: Number(perRun) || job.per_run_limit,
        daily_add_cap: Number(cap) || job.daily_add_cap,
        delay_min_s: Number(dMin) || job.delay_min_s,
        delay_max_s: Number(dMax) || job.delay_max_s,
        send_invite_on_fail: enabled,
        invite_link: link.trim() || null,
        invite_message: message,
      });
      toast.success('Configurações salvas');
      onSaved();
    } catch (e) { toast.error(errMsg(e, 'Erro ao salvar')); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg bg-surface border-border">
        <DialogHeader><DialogTitle>Configurações — {job.nome}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label className="text-xs">Limite por rodada</Label><Input value={perRun} onChange={(e) => setPerRun(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Cap diário</Label><Input value={cap} onChange={(e) => setCap(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Delay mín (s)</Label><Input value={dMin} onChange={(e) => setDMin(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Delay máx (s)</Label><Input value={dMax} onChange={(e) => setDMax(e.target.value)} /></div>
          </div>
          <InviteFields
            enabled={enabled} link={link} message={message}
            onToggle={() => setEnabled((v) => !v)} onLink={setLink} onMessage={setMessage}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Bloco de convite reutilizado na criacao e nas configuracoes do job.
 * O link e colado a mao: a UazAPI desta build ainda nao tem endpoint de
 * invite-link confirmado, e colar funciona hoje sem depender disso.
 */
function InviteFields({
  enabled, link, message, onToggle, onLink, onMessage,
}: {
  enabled: boolean; link: string; message: string;
  onToggle: () => void; onLink: (v: string) => void; onMessage: (v: string) => void;
}) {
  const missingPlaceholder = !message.includes('{link}');
  return (
    <div className="space-y-2">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2.5 text-left">
        <div>
          <p className="text-sm text-text-primary">Enviar convite por DM se a adição falhar</p>
          <p className="text-xs text-text-secondary">Fallback automático quando a privacidade do contato bloqueia a adição</p>
        </div>
        <span className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${enabled ? 'bg-primary' : 'bg-zinc-700'}`}>
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </span>
      </button>

      {enabled && (
        <div className="space-y-2 rounded-lg border border-border bg-background/40 p-3">
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1.5"><Link2 className="h-3 w-3" />Link de convite do grupo</Label>
            <Input value={link} onChange={(e) => onLink(e.target.value)}
              placeholder="https://chat.whatsapp.com/..." className="text-sm" />
            <p className="text-xs text-text-secondary">WhatsApp → grupo → Convidar via link → Copiar link</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Mensagem do convite</Label>
            <Textarea value={message} onChange={(e) => onMessage(e.target.value)} rows={3} className="text-sm" />
            <p className={`text-xs ${missingPlaceholder ? 'text-danger' : 'text-text-secondary'}`}>
              {missingPlaceholder ? 'A mensagem precisa conter {link}' : '{link} é trocado pelo link do grupo no envio'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5">{icon}<span className="text-xs text-text-secondary">{label}</span></div>
      <span className="text-lg font-bold text-text-primary">{value}</span>
    </div>
  );
}

function downloadCsv(rows: string[][], filename: string) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
