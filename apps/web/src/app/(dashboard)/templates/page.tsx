'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  FileText,
  Plus,
  Search,
  Pencil,
  Trash2,
  Eye,
  Shuffle,
  ShieldOff,
  ImageIcon,
  Video,
  Headphones,
  File,
  Type,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
type MessageType = 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT';

interface Template {
  id: string;
  nome: string;
  type: MessageType;
  content: string;
  media_url: string | null;
  media_name: string | null;
  has_spin: boolean;
  has_optout: boolean;
  tenant_id: string;
  created_at: string;
  updated_at: string;
}

interface TemplatesResponse {
  templates: Template[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─── Type Badge Helpers ─────────────────────────────
const TYPE_CONFIG: Record<MessageType, { label: string; icon: typeof Type; className: string }> = {
  TEXT: { label: 'Texto', icon: Type, className: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20' },
  IMAGE: { label: 'Imagem', icon: ImageIcon, className: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
  VIDEO: { label: 'Video', icon: Video, className: 'bg-purple-500/10 text-purple-500 border-purple-500/20' },
  AUDIO: { label: 'Audio', icon: Headphones, className: 'bg-orange-500/10 text-orange-500 border-orange-500/20' },
  DOCUMENT: { label: 'Documento', icon: File, className: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
};

// ─── Spin Preview ───────────────────────────────────
function resolveSpinPreview(content: string): string {
  let resolved = content.replace(/\{([^{}]+)\}/g, (_, group: string) => {
    const options = group.split('|');
    return options[Math.floor(Math.random() * options.length)];
  });
  resolved = resolved.replace(/\{\{nome\}\}/g, 'Joao');
  resolved = resolved.replace(/\{\{telefone\}\}/g, '5531999999999');
  return resolved;
}

function detectSpin(content: string): boolean {
  return /\{[^{}]+\|[^{}]+\}/.test(content);
}

// ─── Main Page ──────────────────────────────────────
export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(1);

  // Dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  // Form
  const [formNome, setFormNome] = useState('');
  const [formType, setFormType] = useState<MessageType>('TEXT');
  const [formContent, setFormContent] = useState('');
  const [formMediaUrl, setFormMediaUrl] = useState('');
  const [formHasOptout, setFormHasOptout] = useState(false);
  const [formPreview, setFormPreview] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ─── Fetch ──────────────────────────────────────
  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = { page: String(page), limit: '20' };
      if (search) params.search = search;
      if (typeFilter !== 'all') params.type = typeFilter;

      const { data } = await api.get<TemplatesResponse>('/templates', { params });
      setTemplates(data.templates);
      setTotal(data.total);
    } catch {
      toast.error('Erro ao carregar templates');
    } finally {
      setLoading(false);
    }
  }, [page, search, typeFilter]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // ─── Stats ──────────────────────────────────────
  const stats = {
    total,
    withSpin: templates.filter((t) => t.has_spin).length,
    withOptout: templates.filter((t) => t.has_optout).length,
  };

  // ─── Preview ──────────────────────────────────────
  const generatePreview = () => {
    if (!formContent.trim()) {
      setFormPreview('');
      return;
    }
    setFormPreview(resolveSpinPreview(formContent));
  };

  // ─── Create ─────────────────────────────────────
  const handleCreate = async () => {
    try {
      setSubmitting(true);
      await api.post('/templates', {
        nome: formNome,
        type: formType,
        content: formContent,
        media_url: formMediaUrl || undefined,
        has_optout: formHasOptout,
      });
      toast.success('Template criado com sucesso');
      setCreateOpen(false);
      resetForm();
      fetchTemplates();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message ?? 'Erro ao criar template');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Edit ───────────────────────────────────────
  const openEdit = (template: Template) => {
    setSelectedTemplate(template);
    setFormNome(template.nome);
    setFormType(template.type);
    setFormContent(template.content);
    setFormMediaUrl(template.media_url ?? '');
    setFormHasOptout(template.has_optout);
    setFormPreview(resolveSpinPreview(template.content));
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!selectedTemplate) return;
    try {
      setSubmitting(true);
      await api.patch(`/templates/${selectedTemplate.id}`, {
        nome: formNome,
        type: formType,
        content: formContent,
        media_url: formMediaUrl || null,
        has_optout: formHasOptout,
      });
      toast.success('Template atualizado');
      setEditOpen(false);
      resetForm();
      fetchTemplates();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message ?? 'Erro ao atualizar template');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Delete ─────────────────────────────────────
  const openDelete = (template: Template) => {
    setSelectedTemplate(template);
    setDeleteOpen(true);
  };

  const handleDelete = async () => {
    if (!selectedTemplate) return;
    try {
      setSubmitting(true);
      await api.delete(`/templates/${selectedTemplate.id}`);
      toast.success('Template removido');
      setDeleteOpen(false);
      setSelectedTemplate(null);
      fetchTemplates();
    } catch {
      toast.error('Erro ao remover template');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormNome('');
    setFormType('TEXT');
    setFormContent('');
    setFormMediaUrl('');
    setFormHasOptout(false);
    setFormPreview('');
    setSelectedTemplate(null);
  };

  const showMediaField = formType !== 'TEXT';

  // ─── Render ─────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-text-primary">Templates</h1>
        </div>
        <Button onClick={() => { resetForm(); setCreateOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" />
          Novo Template
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <FileText className="h-5 w-5 text-primary" />
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
              <Shuffle className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Com Spin</p>
              <p className="text-2xl font-bold text-text-primary">{stats.withSpin}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-danger/10 p-2">
              <ShieldOff className="h-5 w-5 text-danger" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Com Opt-out</p>
              <p className="text-2xl font-bold text-text-primary">{stats.withOptout}</p>
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
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Filtrar tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="TEXT">Texto</SelectItem>
            <SelectItem value="IMAGE">Imagem</SelectItem>
            <SelectItem value="VIDEO">Video</SelectItem>
            <SelectItem value="AUDIO">Audio</SelectItem>
            <SelectItem value="DOCUMENT">Documento</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Template List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="p-12 flex flex-col items-center justify-center text-center">
            <FileText className="h-12 w-12 text-text-secondary mb-4" />
            <h3 className="text-lg font-semibold text-text-primary mb-1">Nenhum template</h3>
            <p className="text-text-secondary mb-4">
              Crie seu primeiro template para usar nos disparos de mensagens.
            </p>
            <Button onClick={() => { resetForm(); setCreateOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" />
              Novo Template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {templates.map((template) => {
            const typeCfg = TYPE_CONFIG[template.type];
            const TypeIcon = typeCfg.icon;
            return (
              <Card key={template.id} className="hover:border-border/80 transition-colors">
                <CardContent className="p-4">
                  <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                    {/* Name & Type */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-text-primary truncate">
                          {template.nome}
                        </h3>
                        <Badge variant="outline" className={typeCfg.className}>
                          <TypeIcon className="mr-1 h-3 w-3" />
                          {typeCfg.label}
                        </Badge>
                        {template.has_spin && (
                          <Badge variant="warning" className="text-xs">
                            <Shuffle className="mr-1 h-3 w-3" />
                            Spin
                          </Badge>
                        )}
                        {template.has_optout && (
                          <Badge variant="outline" className="text-xs border-danger/30 text-danger">
                            <ShieldOff className="mr-1 h-3 w-3" />
                            Opt-out
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-text-secondary line-clamp-2">
                        {template.content.length > 100
                          ? `${template.content.substring(0, 100)}...`
                          : template.content}
                      </p>
                    </div>

                    {/* Created */}
                    <div className="text-center shrink-0">
                      <span className="text-xs text-text-secondary block mb-1">Criado em</span>
                      <span className="text-sm text-text-primary">
                        {new Date(template.created_at).toLocaleDateString('pt-BR')}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(template)}
                        title="Editar"
                      >
                        <Pencil className="h-4 w-4 text-text-secondary" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openDelete(template)}
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
      {!loading && templates.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-text-secondary">
            {total} template{total !== 1 ? 's' : ''} encontrado{total !== 1 ? 's' : ''}
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
              disabled={templates.length < 20}
              onClick={() => setPage((p) => p + 1)}
            >
              Proxima
            </Button>
          </div>
        </div>
      )}

      {/* ─── Create Dialog ───────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo Template</DialogTitle>
            <DialogDescription>
              Crie um novo template de mensagem para seus disparos.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="create-nome">Nome *</Label>
              <Input
                id="create-nome"
                placeholder="Ex: Boas-vindas V1"
                value={formNome}
                onChange={(e) => setFormNome(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-type">Tipo</Label>
              <Select value={formType} onValueChange={(v) => setFormType(v as MessageType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TEXT">Texto</SelectItem>
                  <SelectItem value="IMAGE">Imagem</SelectItem>
                  <SelectItem value="VIDEO">Video</SelectItem>
                  <SelectItem value="AUDIO">Audio</SelectItem>
                  <SelectItem value="DOCUMENT">Documento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-content">Conteudo *</Label>
              <Textarea
                id="create-content"
                placeholder="Digite o conteudo do template..."
                className="min-h-[120px]"
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
              />
              <p className="text-xs text-text-secondary">
                Use {'{opcao1|opcao2|opcao3}'} para variacoes e {'{{nome}}'} para variaveis
              </p>
            </div>
            {showMediaField && (
              <div className="space-y-2">
                <Label htmlFor="create-media">URL da Midia</Label>
                <Input
                  id="create-media"
                  placeholder="https://exemplo.com/imagem.jpg"
                  value={formMediaUrl}
                  onChange={(e) => setFormMediaUrl(e.target.value)}
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                role="checkbox"
                aria-checked={formHasOptout}
                onClick={() => setFormHasOptout(!formHasOptout)}
                className={`h-4 w-4 shrink-0 rounded border border-border transition-colors ${
                  formHasOptout ? 'bg-primary border-primary' : 'bg-surface'
                }`}
              >
                {formHasOptout && (
                  <svg className="h-4 w-4 text-zinc-950" viewBox="0 0 16 16" fill="none">
                    <path d="M4 8l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
              <Label className="cursor-pointer" onClick={() => setFormHasOptout(!formHasOptout)}>
                Incluir opt-out (descadastramento)
              </Label>
            </div>

            {/* Preview */}
            {formContent.trim() && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5">
                    <Eye className="h-3.5 w-3.5" />
                    Preview
                  </Label>
                  <Button variant="outline" size="sm" onClick={generatePreview}>
                    <RefreshCw className="mr-1.5 h-3 w-3" />
                    Gerar Preview
                  </Button>
                </div>
                {detectSpin(formContent) && (
                  <p className="text-xs text-warning">Spin detectado - cada preview gera uma variacao</p>
                )}
                <div className="rounded-lg border border-border bg-surface/50 p-3">
                  <p className="text-sm text-text-primary whitespace-pre-wrap">
                    {formPreview || resolveSpinPreview(formContent)}
                  </p>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={submitting || !formNome.trim() || !formContent.trim()}>
              {submitting ? 'Criando...' : 'Criar Template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Edit Dialog ─────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Template</DialogTitle>
            <DialogDescription>
              Atualize as configuracoes do template.
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
              <Label htmlFor="edit-type">Tipo</Label>
              <Select value={formType} onValueChange={(v) => setFormType(v as MessageType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TEXT">Texto</SelectItem>
                  <SelectItem value="IMAGE">Imagem</SelectItem>
                  <SelectItem value="VIDEO">Video</SelectItem>
                  <SelectItem value="AUDIO">Audio</SelectItem>
                  <SelectItem value="DOCUMENT">Documento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-content">Conteudo *</Label>
              <Textarea
                id="edit-content"
                className="min-h-[120px]"
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
              />
              <p className="text-xs text-text-secondary">
                Use {'{opcao1|opcao2|opcao3}'} para variacoes e {'{{nome}}'} para variaveis
              </p>
            </div>
            {showMediaField && (
              <div className="space-y-2">
                <Label htmlFor="edit-media">URL da Midia</Label>
                <Input
                  id="edit-media"
                  placeholder="https://exemplo.com/imagem.jpg"
                  value={formMediaUrl}
                  onChange={(e) => setFormMediaUrl(e.target.value)}
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                role="checkbox"
                aria-checked={formHasOptout}
                onClick={() => setFormHasOptout(!formHasOptout)}
                className={`h-4 w-4 shrink-0 rounded border border-border transition-colors ${
                  formHasOptout ? 'bg-primary border-primary' : 'bg-surface'
                }`}
              >
                {formHasOptout && (
                  <svg className="h-4 w-4 text-zinc-950" viewBox="0 0 16 16" fill="none">
                    <path d="M4 8l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
              <Label className="cursor-pointer" onClick={() => setFormHasOptout(!formHasOptout)}>
                Incluir opt-out (descadastramento)
              </Label>
            </div>

            {/* Preview */}
            {formContent.trim() && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5">
                    <Eye className="h-3.5 w-3.5" />
                    Preview
                  </Label>
                  <Button variant="outline" size="sm" onClick={generatePreview}>
                    <RefreshCw className="mr-1.5 h-3 w-3" />
                    Gerar Preview
                  </Button>
                </div>
                {detectSpin(formContent) && (
                  <p className="text-xs text-warning">Spin detectado - cada preview gera uma variacao</p>
                )}
                <div className="rounded-lg border border-border bg-surface/50 p-3">
                  <p className="text-sm text-text-primary whitespace-pre-wrap">
                    {formPreview || resolveSpinPreview(formContent)}
                  </p>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleEdit} disabled={submitting || !formNome.trim() || !formContent.trim()}>
              {submitting ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Dialog ───────────────────────── */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir Template</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir o template{' '}
              <strong>{selectedTemplate?.nome}</strong>? Esta acao nao pode ser desfeita.
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
