'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Send,
  Plus,
  Search,
  Pencil,
  Trash2,
  XCircle,
  Eye,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Ban,
  AlertTriangle,
  Users,
  BarChart3,
  Mail,
  MessageSquare,
  ShieldAlert,
  UserX,
  Play,
  Pause,
  RotateCcw,
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
interface TemplateRef {
  id: string;
  nome: string;
  type: string;
  content?: string;
}

interface ContactListRef {
  id: string;
  nome: string;
  total_count: number;
  valid_count?: number;
}

interface InstanceRef {
  id: string;
  nome: string;
  status: string;
  health_score: number;
}

interface CampaignInstanceRef {
  id: string;
  campaign_id: string;
  instance_id: string;
  instance: InstanceRef;
}

interface Campaign {
  id: string;
  nome: string;
  status: string;
  contact_list_id: string;
  template_id: string;
  delay_min: number;
  delay_max: number;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  paused_at: string | null;
  tenant_id: string;
  created_at: string;
  use_spin: boolean;
  use_composing: boolean;
  skip_invalid: boolean;
  skip_blocked: boolean;
  skip_recent: boolean;
  total_contacts: number;
  total_valid: number;
  total_sent: number;
  total_delivered: number;
  total_read: number;
  total_replied: number;
  total_failed: number;
  total_blocked: number;
  total_optout: number;
  template: TemplateRef;
  contact_list: ContactListRef;
  instances: CampaignInstanceRef[];
}

interface CampaignsResponse {
  campaigns: Campaign[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─── Status Helpers ─────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'warning'; className?: string }> = {
  DRAFT: { label: 'Rascunho', variant: 'secondary' },
  VALIDATING: { label: 'Validando', variant: 'warning' },
  SCHEDULED: { label: 'Agendada', variant: 'outline', className: 'border-blue-500 text-blue-400' },
  RUNNING: { label: 'Em Execucao', variant: 'default', className: 'animate-pulse' },
  PAUSED: { label: 'Pausada', variant: 'warning', className: 'bg-orange-500 text-zinc-950 border-transparent' },
  COMPLETED: { label: 'Concluida', variant: 'default' },
  CANCELLED: { label: 'Cancelada', variant: 'secondary', className: 'bg-zinc-600 text-zinc-200 border-transparent' },
  FAILED: { label: 'Falhou', variant: 'destructive' },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? { label: status, variant: 'outline' as const };
}

function pct(part: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

// ─── Main Page ──────────────────────────────────────
export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);

  // Detail view
  const [detailCampaign, setDetailCampaign] = useState<Campaign | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);

  // Create form
  const [formNome, setFormNome] = useState('');
  const [formTemplateId, setFormTemplateId] = useState('');
  const [formContactListId, setFormContactListId] = useState('');
  const [formInstanceIds, setFormInstanceIds] = useState<string[]>([]);
  const [formDelayMin, setFormDelayMin] = useState('8');
  const [formDelayMax, setFormDelayMax] = useState('20');
  const [formScheduledAt, setFormScheduledAt] = useState('');
  const [formUseSpin, setFormUseSpin] = useState(true);
  const [formUseComposing, setFormUseComposing] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Message mode
  const [messageMode, setMessageMode] = useState<'template' | 'inline'>('template');
  const [formInlineMessage, setFormInlineMessage] = useState('');

  // TXT import mode
  const [contactMode, setContactMode] = useState<'list' | 'txt'>('list');
  const [txtNumbers, setTxtNumbers] = useState('');
  const [txtListName, setTxtListName] = useState('');
  const [txtImporting, setTxtImporting] = useState(false);

  // Edit form
  const [editNome, setEditNome] = useState('');
  const [editDelayMin, setEditDelayMin] = useState('8');
  const [editDelayMax, setEditDelayMax] = useState('20');
  const [editUseSpin, setEditUseSpin] = useState(true);
  const [editUseComposing, setEditUseComposing] = useState(true);

  // Dropdowns data
  const [templates, setTemplates] = useState<TemplateRef[]>([]);
  const [contactLists, setContactLists] = useState<ContactListRef[]>([]);
  const [instances, setInstances] = useState<InstanceRef[]>([]);

  // ─── Fetch Campaigns ─────────────────────────────
  const fetchCampaigns = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = { page: String(page), limit: '20' };
      if (search) params.search = search;
      if (statusFilter !== 'all') params.status = statusFilter;

      const { data } = await api.get<CampaignsResponse>('/campaigns', { params });
      setCampaigns(data.campaigns);
      setTotal(data.total);
    } catch {
      toast.error('Erro ao carregar campanhas');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  // ─── Fetch dropdown data ─────────────────────────
  const fetchDropdownData = useCallback(async () => {
    try {
      const [tplRes, clRes, instRes] = await Promise.all([
        api.get<{ templates: TemplateRef[] }>('/templates', { params: { limit: '100' } }),
        api.get<ContactListRef[]>('/contacts/lists'),
        api.get<{ instances: InstanceRef[] }>('/instances', { params: { limit: '100' } }),
      ]);
      setTemplates(tplRes.data.templates ?? []);
      setContactLists(Array.isArray(clRes.data) ? clRes.data : []);
      setInstances(instRes.data.instances ?? []);
    } catch {
      // Silently fail - dropdowns will be empty
    }
  }, []);

  // ─── Fetch detail ────────────────────────────────
  const openDetail = async (campaign: Campaign) => {
    try {
      setDetailLoading(true);
      setDetailCampaign(campaign);
      const { data } = await api.get<Campaign>(`/campaigns/${campaign.id}`);
      setDetailCampaign(data);
    } catch {
      toast.error('Erro ao carregar detalhes da campanha');
    } finally {
      setDetailLoading(false);
    }
  };

  // ─── Stats ────────────────────────────────────────
  const stats = {
    total,
    draft: campaigns.filter((c) => c.status === 'DRAFT').length,
    running: campaigns.filter((c) => c.status === 'RUNNING').length,
    completed: campaigns.filter((c) => c.status === 'COMPLETED').length,
  };

  // ─── Create ───────────────────────────────────────
  const handleOpenCreate = () => {
    resetCreateForm();
    fetchDropdownData();
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    try {
      setSubmitting(true);

      let listId = formContactListId;

      // If TXT mode, import first and get the list ID
      if (contactMode === 'txt') {
        if (!txtNumbers.trim() || !txtListName.trim()) {
          toast.error('Preencha o nome da lista e cole os numeros');
          setSubmitting(false);
          return;
        }
        setTxtImporting(true);
        const { data: importResult } = await api.post<{
          list: { id: string };
          imported: number;
          invalid: number;
        }>('/contacts/import-txt', {
          text: txtNumbers,
          list_name: txtListName,
        });
        listId = importResult.list.id;
        toast.success(`${importResult.imported} numeros importados${importResult.invalid > 0 ? ` (${importResult.invalid} invalidos ignorados)` : ''}`);
        setTxtImporting(false);
      }

      if (!listId) {
        toast.error('Selecione ou importe uma lista de contatos');
        setSubmitting(false);
        return;
      }

      const { data: created } = await api.post<Campaign>('/campaigns', {
        nome: formNome,
        ...(messageMode === 'template' ? { template_id: formTemplateId } : { inline_message: formInlineMessage }),
        contact_list_id: listId,
        instance_ids: formInstanceIds,
        delay_min: parseInt(formDelayMin, 10),
        delay_max: parseInt(formDelayMax, 10),
        scheduled_at: formScheduledAt ? new Date(formScheduledAt).toISOString() : undefined,
        use_spin: formUseSpin,
        use_composing: formUseComposing,
      });

      // Auto-start dispatch immediately (unless scheduled for later)
      if (!formScheduledAt) {
        try {
          const { data: startResult } = await api.post<{ dispatched: number; skipped: number }>(
            `/dispatch/campaigns/${created.id}/start`,
          );
          toast.success(
            `Campanha iniciada! ${startResult.dispatched} mensagens na fila${startResult.skipped > 0 ? ` (${startResult.skipped} ignorados)` : ''}`,
          );
        } catch (startErr: unknown) {
          const startError = startErr as { response?: { data?: { message?: string } } };
          toast.error(startError.response?.data?.message ?? 'Campanha criada mas falhou ao iniciar disparo');
        }
      } else {
        toast.success('Campanha agendada com sucesso');
      }

      setCreateOpen(false);
      resetCreateForm();
      fetchCampaigns();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message ?? 'Erro ao criar campanha');
      setTxtImporting(false);
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Edit ─────────────────────────────────────────
  const openEdit = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setEditNome(campaign.nome);
    setEditDelayMin(String(campaign.delay_min));
    setEditDelayMax(String(campaign.delay_max));
    setEditUseSpin(campaign.use_spin);
    setEditUseComposing(campaign.use_composing);
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!selectedCampaign) return;
    try {
      setSubmitting(true);
      await api.patch(`/campaigns/${selectedCampaign.id}`, {
        nome: editNome,
        delay_min: parseInt(editDelayMin, 10),
        delay_max: parseInt(editDelayMax, 10),
        use_spin: editUseSpin,
        use_composing: editUseComposing,
      });
      toast.success('Campanha atualizada');
      setEditOpen(false);
      setSelectedCampaign(null);
      fetchCampaigns();
      if (detailCampaign?.id === selectedCampaign.id) {
        openDetail(selectedCampaign);
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message ?? 'Erro ao atualizar campanha');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Delete ───────────────────────────────────────
  const openDeleteDialog = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setDeleteOpen(true);
  };

  const handleDelete = async () => {
    if (!selectedCampaign) return;
    try {
      setSubmitting(true);
      await api.delete(`/campaigns/${selectedCampaign.id}`);
      toast.success('Campanha removida');
      setDeleteOpen(false);
      setSelectedCampaign(null);
      if (detailCampaign?.id === selectedCampaign.id) {
        setDetailCampaign(null);
      }
      fetchCampaigns();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message ?? 'Erro ao remover campanha');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Cancel Campaign ─────────────────────────────
  const openCancelDialog = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setCancelOpen(true);
  };

  const handleCancel = async () => {
    if (!selectedCampaign) return;
    try {
      setSubmitting(true);
      await api.post(`/campaigns/${selectedCampaign.id}/cancel`);
      toast.success('Campanha cancelada');
      setCancelOpen(false);
      setSelectedCampaign(null);
      fetchCampaigns();
      if (detailCampaign?.id === selectedCampaign.id) {
        openDetail(selectedCampaign);
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message ?? 'Erro ao cancelar campanha');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleInstanceId = (id: string) => {
    setFormInstanceIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  };

  const resetCreateForm = () => {
    setFormNome('');
    setFormTemplateId('');
    setFormContactListId('');
    setFormInstanceIds([]);
    setFormDelayMin('8');
    setFormDelayMax('20');
    setFormScheduledAt('');
    setFormUseSpin(true);
    setFormUseComposing(true);
    setMessageMode('template');
    setFormInlineMessage('');
    setContactMode('list');
    setTxtNumbers('');
    setTxtListName('');
    setTxtImporting(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === 'string') {
        setTxtNumbers(text);
        if (!txtListName) {
          setTxtListName(file.name.replace(/\.(txt|csv)$/i, ''));
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const canEdit = (status: string) => status === 'DRAFT';
  const canStart = (status: string) => status === 'DRAFT';
  const canPause = (status: string) => status === 'RUNNING';
  const canResume = (status: string) => status === 'PAUSED';
  const canCancel = (status: string) => ['DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED'].includes(status);
  const canDelete = (status: string) => ['DRAFT', 'CANCELLED', 'COMPLETED'].includes(status);

  const handleStartCampaign = async (campaign: Campaign) => {
    try {
      const { data } = await api.post<{ dispatched: number; skipped: number }>(
        `/dispatch/campaigns/${campaign.id}/start`,
      );
      toast.success(
        `Disparando! ${data.dispatched} mensagens na fila${data.skipped > 0 ? ` (${data.skipped} ignorados)` : ''}`,
      );
      fetchCampaigns();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message ?? 'Erro ao iniciar disparo');
    }
  };

  const handlePauseCampaign = async (campaign: Campaign) => {
    try {
      await api.post(`/dispatch/campaigns/${campaign.id}/pause`);
      toast.success('Campanha pausada');
      fetchCampaigns();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message ?? 'Erro ao pausar');
    }
  };

  const handleResumeCampaign = async (campaign: Campaign) => {
    try {
      const { data } = await api.post<{ requeued: number }>(
        `/dispatch/campaigns/${campaign.id}/resume`,
      );
      toast.success(`Campanha retomada! ${data.requeued} mensagens reenfileiradas`);
      fetchCampaigns();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message ?? 'Erro ao retomar');
    }
  };

  // ─── Detail View ──────────────────────────────────
  if (detailCampaign) {
    const c = detailCampaign;
    const statusCfg = getStatusConfig(c.status);
    const sentPct = c.total_contacts > 0 ? Math.round((c.total_sent / c.total_contacts) * 100) : 0;

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setDetailCampaign(null)}>
            <ArrowLeft className="h-5 w-5 text-text-secondary" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-text-primary">{c.nome}</h1>
              <Badge variant={statusCfg.variant} className={statusCfg.className}>
                {statusCfg.label}
              </Badge>
            </div>
            <p className="text-sm text-text-secondary mt-1">
              Criada em {new Date(c.created_at).toLocaleDateString('pt-BR')}
              {c.scheduled_at && ` | Agendada para ${new Date(c.scheduled_at).toLocaleString('pt-BR')}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canEdit(c.status) && (
              <Button variant="outline" size="sm" onClick={() => openEdit(c)}>
                <Pencil className="mr-2 h-4 w-4" />
                Editar
              </Button>
            )}
            {canCancel(c.status) && (
              <Button variant="outline" size="sm" onClick={() => openCancelDialog(c)}>
                <XCircle className="mr-2 h-4 w-4" />
                Cancelar
              </Button>
            )}
            {canDelete(c.status) && (
              <Button variant="destructive" size="sm" onClick={() => openDeleteDialog(c)}>
                <Trash2 className="mr-2 h-4 w-4" />
                Excluir
              </Button>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-text-secondary">Progresso de envio</span>
              <span className="text-sm font-medium text-text-primary">
                {c.total_sent}/{c.total_contacts} ({sentPct}%)
              </span>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${sentPct}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Metrics */}
        {detailLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard icon={Users} label="Total Contatos" value={c.total_contacts} color="text-primary" />
            <MetricCard icon={Mail} label="Enviados" value={c.total_sent} color="text-primary" />
            <MetricCard icon={CheckCircle2} label="Entregues" value={c.total_delivered} color="text-primary" subtitle={pct(c.total_delivered, c.total_sent)} />
            <MetricCard icon={Eye} label="Lidos" value={c.total_read} color="text-blue-400" subtitle={pct(c.total_read, c.total_sent)} />
            <MetricCard icon={MessageSquare} label="Respondidos" value={c.total_replied} color="text-emerald-400" subtitle={pct(c.total_replied, c.total_sent)} />
            <MetricCard icon={AlertTriangle} label="Falharam" value={c.total_failed} color="text-danger" />
            <MetricCard icon={ShieldAlert} label="Bloqueados" value={c.total_blocked} color="text-orange-400" />
            <MetricCard icon={UserX} label="Opt-out" value={c.total_optout} color="text-zinc-400" />
          </div>
        )}

        {/* Info Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <h3 className="font-semibold text-text-primary">Mensagem</h3>
              <div>
                <p className="text-sm text-text-primary">{c.template?.nome ?? 'Mensagem direta'}</p>
                <Badge variant="outline" className="mt-1 text-xs">{c.template?.type ?? 'INLINE'}</Badge>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 space-y-3">
              <h3 className="font-semibold text-text-primary">Lista de Contatos</h3>
              <div>
                <p className="text-sm text-text-primary">{c.contact_list.nome}</p>
                <p className="text-xs text-text-secondary">{c.contact_list.total_count} contatos</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Stealth Config */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <h3 className="font-semibold text-text-primary">Configuracao Stealth</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-text-secondary block">Delay</span>
                <span className="text-text-primary">{c.delay_min}s - {c.delay_max}s</span>
              </div>
              <div>
                <span className="text-text-secondary block">Content Spin</span>
                <span className="text-text-primary">{c.use_spin ? 'Ativo' : 'Inativo'}</span>
              </div>
              <div>
                <span className="text-text-secondary block">Composing</span>
                <span className="text-text-primary">{c.use_composing ? 'Ativo' : 'Inativo'}</span>
              </div>
              <div>
                <span className="text-text-secondary block">Pular invalidos</span>
                <span className="text-text-primary">{c.skip_invalid ? 'Sim' : 'Nao'}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Instances */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <h3 className="font-semibold text-text-primary">
              Instancias ({c.instances.length})
            </h3>
            <div className="space-y-2">
              {c.instances.map((ci) => (
                <div key={ci.id} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-primary">{ci.instance.nome}</span>
                    <Badge variant={ci.instance.status === 'connected' ? 'default' : 'secondary'} className="text-xs">
                      {ci.instance.status}
                    </Badge>
                  </div>
                  <span className="text-xs text-text-secondary">
                    Saude: {ci.instance.health_score}%
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Shared dialogs rendered below */}
        {renderDialogs()}
      </div>
    );
  }

  // ─── List View Render ─────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Send className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-text-primary">Campanhas</h1>
        </div>
        <Button onClick={handleOpenCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Nova Campanha
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Send className="h-5 w-5 text-primary" />
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
              <Clock className="h-5 w-5 text-text-secondary" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Rascunho</p>
              <p className="text-2xl font-bold text-text-primary">{stats.draft}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <BarChart3 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Em Execucao</p>
              <p className="text-2xl font-bold text-text-primary">{stats.running}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Concluidas</p>
              <p className="text-2xl font-bold text-text-primary">{stats.completed}</p>
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
            <SelectItem value="DRAFT">Rascunho</SelectItem>
            <SelectItem value="VALIDATING">Validando</SelectItem>
            <SelectItem value="SCHEDULED">Agendada</SelectItem>
            <SelectItem value="RUNNING">Em Execucao</SelectItem>
            <SelectItem value="PAUSED">Pausada</SelectItem>
            <SelectItem value="COMPLETED">Concluida</SelectItem>
            <SelectItem value="CANCELLED">Cancelada</SelectItem>
            <SelectItem value="FAILED">Falhou</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Campaign List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <Card>
          <CardContent className="p-12 flex flex-col items-center justify-center text-center">
            <Send className="h-12 w-12 text-text-secondary mb-4" />
            <h3 className="text-lg font-semibold text-text-primary mb-1">Nenhuma campanha</h3>
            <p className="text-text-secondary mb-4">
              Crie sua primeira campanha de disparo.
            </p>
            <Button onClick={handleOpenCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Nova Campanha
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {campaigns.map((campaign) => {
            const statusCfg = getStatusConfig(campaign.status);
            const sentPctVal = campaign.total_contacts > 0
              ? Math.round((campaign.total_sent / campaign.total_contacts) * 100)
              : 0;

            return (
              <Card key={campaign.id} className="hover:border-border/80 transition-colors">
                <CardContent className="p-4">
                  <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                    {/* Name & Status */}
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openDetail(campaign)}>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-text-primary truncate">
                          {campaign.nome}
                        </h3>
                        <Badge variant={statusCfg.variant} className={statusCfg.className}>
                          {statusCfg.label}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-text-secondary">
                        <span>{campaign.template?.nome ?? 'Msg direta'}</span>
                        <span>|</span>
                        <span>{campaign.contact_list?.nome ?? '—'} ({campaign.contact_list?.total_count ?? 0})</span>
                      </div>
                    </div>

                    {/* Metrics bar */}
                    <div className="w-48">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-text-secondary">Envio</span>
                        <span className="text-xs font-medium text-text-primary">
                          {campaign.total_sent}/{campaign.total_contacts}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${sentPctVal}%` }}
                        />
                      </div>
                      <div className="flex gap-3 mt-1 text-xs text-text-secondary">
                        <span>E {pct(campaign.total_delivered, campaign.total_sent)}</span>
                        <span>L {pct(campaign.total_read, campaign.total_sent)}</span>
                        <span>R {pct(campaign.total_replied, campaign.total_sent)}</span>
                      </div>
                    </div>

                    {/* Instances */}
                    <div className="text-center">
                      <Badge variant="outline" className="text-xs">
                        {campaign.instances.length} instancia{campaign.instances.length !== 1 ? 's' : ''}
                      </Badge>
                    </div>

                    {/* Date */}
                    <div className="text-center">
                      <span className="text-xs text-text-secondary">
                        {new Date(campaign.created_at).toLocaleDateString('pt-BR')}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      {canStart(campaign.status) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleStartCampaign(campaign)}
                          title="Iniciar disparo"
                        >
                          <Play className="h-4 w-4 text-green-500" />
                        </Button>
                      )}
                      {canPause(campaign.status) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handlePauseCampaign(campaign)}
                          title="Pausar"
                        >
                          <Pause className="h-4 w-4 text-orange-400" />
                        </Button>
                      )}
                      {canResume(campaign.status) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleResumeCampaign(campaign)}
                          title="Retomar"
                        >
                          <RotateCcw className="h-4 w-4 text-blue-400" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openDetail(campaign)}
                        title="Ver detalhes"
                      >
                        <Eye className="h-4 w-4 text-text-secondary" />
                      </Button>
                      {canEdit(campaign.status) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(campaign)}
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4 text-text-secondary" />
                        </Button>
                      )}
                      {canCancel(campaign.status) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openCancelDialog(campaign)}
                          title="Cancelar campanha"
                        >
                          <Ban className="h-4 w-4 text-text-secondary" />
                        </Button>
                      )}
                      {canDelete(campaign.status) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openDeleteDialog(campaign)}
                          title="Excluir"
                        >
                          <Trash2 className="h-4 w-4 text-danger" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!loading && campaigns.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-text-secondary">
            {total} campanha{total !== 1 ? 's' : ''} encontrada{total !== 1 ? 's' : ''}
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
              disabled={campaigns.length < 20}
              onClick={() => setPage((p) => p + 1)}
            >
              Proxima
            </Button>
          </div>
        </div>
      )}

      {renderDialogs()}
    </div>
  );

  // ─── Shared Dialogs ──────────────────────────────
  function renderDialogs() {
    return (
      <>
        {/* ─── Create Dialog ───────────────────────── */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nova Campanha</DialogTitle>
              <DialogDescription>
                Crie e dispare uma campanha de mensagens.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {/* Nome */}
              <div className="space-y-2">
                <Label htmlFor="create-nome">Nome *</Label>
                <Input
                  id="create-nome"
                  placeholder="Ex: Black Friday 2024"
                  value={formNome}
                  onChange={(e) => setFormNome(e.target.value)}
                />
              </div>

              {/* Mensagem */}
              <div className="space-y-2">
                <Label>Mensagem *</Label>
                <div className="flex gap-2 mb-2">
                  <Button
                    type="button"
                    variant={messageMode === 'template' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setMessageMode('template')}
                  >
                    Template Pronto
                  </Button>
                  <Button
                    type="button"
                    variant={messageMode === 'inline' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setMessageMode('inline')}
                  >
                    Digitar Mensagem
                  </Button>
                </div>

                {messageMode === 'template' ? (
                  <Select value={formTemplateId} onValueChange={setFormTemplateId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.nome} ({t.type})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="space-y-1">
                    <textarea
                      className="w-full h-32 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
                      placeholder={'Digite sua mensagem aqui...\n\nUse {nome} para personalizar com o nome do contato.'}
                      value={formInlineMessage}
                      onChange={(e) => setFormInlineMessage(e.target.value)}
                    />
                    <p className="text-xs text-text-secondary">
                      Variaveis: <code className="text-primary">{'{nome}'}</code>, <code className="text-primary">{'{telefone}'}</code>
                    </p>
                  </div>
                )}
              </div>

              {/* Contact List — select existing OR import TXT */}
              <div className="space-y-2">
                <Label>Lista de Contatos *</Label>
                <div className="flex gap-2 mb-2">
                  <Button
                    type="button"
                    variant={contactMode === 'list' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setContactMode('list')}
                  >
                    Lista Existente
                  </Button>
                  <Button
                    type="button"
                    variant={contactMode === 'txt' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setContactMode('txt')}
                  >
                    Importar TXT / Colar Numeros
                  </Button>
                </div>

                {contactMode === 'list' ? (
                  <Select value={formContactListId} onValueChange={setFormContactListId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione uma lista" />
                    </SelectTrigger>
                    <SelectContent>
                      {contactLists.length === 0 ? (
                        <SelectItem value="__empty" disabled>Nenhuma lista criada</SelectItem>
                      ) : (
                        contactLists.map((cl) => (
                          <SelectItem key={cl.id} value={cl.id}>
                            {cl.nome} ({cl.total_count} contatos)
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor="txt-list-name">Nome da Lista *</Label>
                      <Input
                        id="txt-list-name"
                        placeholder="Ex: Lista Black Friday"
                        value={txtListName}
                        onChange={(e) => setTxtListName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="txt-numbers">Numeros (um por linha)</Label>
                        <label className="text-xs text-primary cursor-pointer hover:underline">
                          <input
                            type="file"
                            accept=".txt,.csv"
                            className="hidden"
                            onChange={handleFileUpload}
                          />
                          Carregar arquivo .txt
                        </label>
                      </div>
                      <textarea
                        id="txt-numbers"
                        className="w-full h-32 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y font-mono"
                        placeholder={"5531999999999\n5521988887777\n5511977776666"}
                        value={txtNumbers}
                        onChange={(e) => setTxtNumbers(e.target.value)}
                      />
                      <p className="text-xs text-text-secondary">
                        Formatos aceitos: <code className="text-primary">5531999999999</code>,{' '}
                        <code className="text-primary">+55 31 99999-9999</code>,{' '}
                        <code className="text-primary">31999999999</code>.
                        O sistema adiciona o 55 automaticamente se necessario.
                      </p>
                      {txtNumbers.trim() && (
                        <p className="text-xs text-text-secondary">
                          {txtNumbers.split(/[\r\n,;]+/).filter((l) => l.trim()).length} linhas detectadas
                        </p>
                      )}
                    </div>
                    {txtImporting && (
                      <p className="text-xs text-primary flex items-center gap-1">
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        Importando numeros e criando lista...
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Instance Multi-Select */}
              <div className="space-y-2">
                <Label>Instancias * ({formInstanceIds.length} selecionada{formInstanceIds.length !== 1 ? 's' : ''})</Label>
                <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-surface p-2 space-y-1">
                  {instances.length === 0 ? (
                    <p className="text-sm text-text-secondary p-2">Nenhuma instancia disponivel</p>
                  ) : (
                    instances.map((inst) => (
                      <label
                        key={inst.id}
                        className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={formInstanceIds.includes(inst.id)}
                          onChange={() => toggleInstanceId(inst.id)}
                          className="h-4 w-4 rounded border-border bg-surface text-primary accent-[#22c55e]"
                        />
                        <div className="flex-1 flex items-center gap-2">
                          <span className="text-sm text-text-primary">{inst.nome}</span>
                          <Badge
                            variant={inst.status === 'connected' ? 'default' : 'secondary'}
                            className="text-xs"
                          >
                            {inst.status}
                          </Badge>
                        </div>
                        <span className="text-xs text-text-secondary">
                          Saude: {inst.health_score}%
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              {/* Delay Settings */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="create-delay-min">Delay Minimo (s)</Label>
                  <Input
                    id="create-delay-min"
                    type="number"
                    min="5"
                    value={formDelayMin}
                    onChange={(e) => setFormDelayMin(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="create-delay-max">Delay Maximo (s)</Label>
                  <Input
                    id="create-delay-max"
                    type="number"
                    min="8"
                    value={formDelayMax}
                    onChange={(e) => setFormDelayMax(e.target.value)}
                  />
                </div>
              </div>

              {/* Toggles */}
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formUseSpin}
                    onChange={(e) => setFormUseSpin(e.target.checked)}
                    className="h-4 w-4 rounded border-border bg-surface accent-[#22c55e]"
                  />
                  <span className="text-sm text-text-primary">Content Spin</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formUseComposing}
                    onChange={(e) => setFormUseComposing(e.target.checked)}
                    className="h-4 w-4 rounded border-border bg-surface accent-[#22c55e]"
                  />
                  <span className="text-sm text-text-primary">Composing</span>
                </label>
              </div>

              {/* Scheduled At */}
              <div className="space-y-2">
                <Label htmlFor="create-scheduled">Agendar para (opcional)</Label>
                <Input
                  id="create-scheduled"
                  type="datetime-local"
                  value={formScheduledAt}
                  onChange={(e) => setFormScheduledAt(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={submitting}>
                Cancelar
              </Button>
              <Button
                onClick={handleCreate}
                disabled={
                  submitting ||
                  !formNome.trim() ||
                  (messageMode === 'template' ? !formTemplateId : !formInlineMessage.trim()) ||
                  (contactMode === 'list' ? !formContactListId : (!txtNumbers.trim() || !txtListName.trim())) ||
                  formInstanceIds.length === 0
                }
              >
                {submitting ? 'Criando...' : 'Criar Campanha'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ─── Edit Dialog ─────────────────────────── */}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Editar Campanha</DialogTitle>
              <DialogDescription>
                Atualize as configuracoes da campanha (somente rascunhos).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-nome">Nome</Label>
                <Input
                  id="edit-nome"
                  value={editNome}
                  onChange={(e) => setEditNome(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-delay-min">Delay Minimo (s)</Label>
                  <Input
                    id="edit-delay-min"
                    type="number"
                    min="5"
                    value={editDelayMin}
                    onChange={(e) => setEditDelayMin(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-delay-max">Delay Maximo (s)</Label>
                  <Input
                    id="edit-delay-max"
                    type="number"
                    min="8"
                    value={editDelayMax}
                    onChange={(e) => setEditDelayMax(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editUseSpin}
                    onChange={(e) => setEditUseSpin(e.target.checked)}
                    className="h-4 w-4 rounded border-border bg-surface accent-[#22c55e]"
                  />
                  <span className="text-sm text-text-primary">Content Spin</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editUseComposing}
                    onChange={(e) => setEditUseComposing(e.target.checked)}
                    className="h-4 w-4 rounded border-border bg-surface accent-[#22c55e]"
                  />
                  <span className="text-sm text-text-primary">Composing</span>
                </label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)} disabled={submitting}>
                Cancelar
              </Button>
              <Button onClick={handleEdit} disabled={submitting || !editNome.trim()}>
                {submitting ? 'Salvando...' : 'Salvar'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ─── Delete Dialog ───────────────────────── */}
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Excluir Campanha</DialogTitle>
              <DialogDescription>
                Tem certeza que deseja excluir a campanha{' '}
                <strong>{selectedCampaign?.nome}</strong>? Esta acao nao pode ser desfeita.
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

        {/* ─── Cancel Dialog ───────────────────────── */}
        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancelar Campanha</DialogTitle>
              <DialogDescription>
                Tem certeza que deseja cancelar a campanha{' '}
                <strong>{selectedCampaign?.nome}</strong>?
                {selectedCampaign?.status === 'RUNNING' && ' Os envios em andamento serao interrompidos.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={submitting}>
                Voltar
              </Button>
              <Button variant="destructive" onClick={handleCancel} disabled={submitting}>
                {submitting ? 'Cancelando...' : 'Confirmar Cancelamento'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }
}

// ─── Metric Card Component ──────────────────────────
function MetricCard({
  icon: Icon,
  label,
  value,
  color,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
  subtitle?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="rounded-lg bg-muted p-2">
          <Icon className={`h-5 w-5 ${color}`} />
        </div>
        <div>
          <p className="text-sm text-text-secondary">{label}</p>
          <div className="flex items-baseline gap-1">
            <p className="text-2xl font-bold text-text-primary">{value.toLocaleString('pt-BR')}</p>
            {subtitle && <span className="text-xs text-text-secondary">{subtitle}</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
