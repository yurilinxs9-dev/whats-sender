'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Users,
  Plus,
  Search,
  Upload,
  Pencil,
  Trash2,
  Phone,
  CheckCircle2,
  Flame,
  Ban,
  List,
  UserPlus,
  UserMinus,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
interface Contact {
  id: string;
  nome: string | null;
  telefone: string;
  tags: string[];
  engagement: string;
  whatsapp_valid: boolean | null;
  last_contacted: string | null;
  times_contacted: number;
  times_replied: number;
  times_blocked: number;
  created_at: string;
}

interface ContactsResponse {
  contacts: Contact[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface ContactStats {
  total: number;
  whatsappValid: number;
  engaged: number;
  blocked: number;
}

interface ContactList {
  id: string;
  nome: string;
  descricao: string | null;
  total_count: number;
  valid_count: number;
  created_at: string;
}

// ─── Engagement Helpers ─────────────────────────────
const ENGAGEMENT_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'warning'; className?: string }> = {
  UNKNOWN: { label: 'Desconhecido', variant: 'secondary' },
  COLD: { label: 'Frio', variant: 'outline', className: 'border-blue-500 text-blue-400' },
  WARM: { label: 'Morno', variant: 'warning' },
  HOT: { label: 'Quente', variant: 'default' },
  BLOCKED: { label: 'Bloqueado', variant: 'destructive' },
};

function getEngagementConfig(engagement: string) {
  return ENGAGEMENT_CONFIG[engagement] ?? { label: engagement, variant: 'outline' as const };
}

// ─── Main Page ──────────────────────────────────────
export default function ContactsPage() {
  // ─── Contacts State ───────────────────────────────
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [engagementFilter, setEngagementFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState<ContactStats>({ total: 0, whatsappValid: 0, engaged: 0, blocked: 0 });

  // ─── Lists State ──────────────────────────────────
  const [lists, setLists] = useState<ContactList[]>([]);
  const [listsLoading, setListsLoading] = useState(true);
  const [selectedList, setSelectedList] = useState<ContactList | null>(null);
  const [listContacts, setListContacts] = useState<Contact[]>([]);
  const [listContactsTotal, setListContactsTotal] = useState(0);
  const [listContactsPage, setListContactsPage] = useState(1);
  const [listContactsLoading, setListContactsLoading] = useState(false);

  // ─── Dialogs ──────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [createListOpen, setCreateListOpen] = useState(false);
  const [editListOpen, setEditListOpen] = useState(false);
  const [deleteListOpen, setDeleteListOpen] = useState(false);
  const [listDetailOpen, setListDetailOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [editingList, setEditingList] = useState<ContactList | null>(null);

  // ─── Form State ───────────────────────────────────
  const [formNome, setFormNome] = useState('');
  const [formTelefone, setFormTelefone] = useState('');
  const [formTags, setFormTags] = useState('');
  const [formListNome, setFormListNome] = useState('');
  const [formListDescricao, setFormListDescricao] = useState('');
  const [importText, setImportText] = useState('');
  const [importPreview, setImportPreview] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // ─── Fetch Contacts ───────────────────────────────
  const fetchContacts = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = { page: String(page), limit: '20' };
      if (search) params.search = search;
      if (engagementFilter !== 'all') params.engagement = engagementFilter;

      const { data } = await api.get<ContactsResponse>('/contacts', { params });
      setContacts(data.contacts);
      setTotal(data.total);
    } catch {
      toast.error('Erro ao carregar contatos');
    } finally {
      setLoading(false);
    }
  }, [page, search, engagementFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const { data } = await api.get<ContactStats>('/contacts/stats');
      setStats(data);
    } catch {
      // silent
    }
  }, []);

  const fetchLists = useCallback(async () => {
    try {
      setListsLoading(true);
      const { data } = await api.get<ContactList[]>('/contacts/lists');
      setLists(data);
    } catch {
      toast.error('Erro ao carregar listas');
    } finally {
      setListsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContacts();
    fetchStats();
  }, [fetchContacts, fetchStats]);

  useEffect(() => {
    fetchLists();
  }, [fetchLists]);

  // ─── Fetch List Contacts ──────────────────────────
  const fetchListContacts = useCallback(async (listId: string, pg: number) => {
    try {
      setListContactsLoading(true);
      const { data } = await api.get<ContactsResponse>(`/contacts/lists/${listId}/contacts`, {
        params: { page: String(pg), limit: '20' },
      });
      setListContacts(data.contacts);
      setListContactsTotal(data.total);
    } catch {
      toast.error('Erro ao carregar contatos da lista');
    } finally {
      setListContactsLoading(false);
    }
  }, []);

  // ─── Create Contact ───────────────────────────────
  const handleCreate = async () => {
    try {
      setSubmitting(true);
      await api.post('/contacts', {
        telefone: formTelefone,
        nome: formNome || undefined,
        tags: formTags ? formTags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      });
      toast.success('Contato criado com sucesso');
      setCreateOpen(false);
      resetContactForm();
      fetchContacts();
      fetchStats();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message ?? 'Erro ao criar contato');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Edit Contact ─────────────────────────────────
  const openEdit = (contact: Contact) => {
    setSelectedContact(contact);
    setFormNome(contact.nome ?? '');
    setFormTelefone(contact.telefone);
    setFormTags(contact.tags.join(', '));
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!selectedContact) return;
    try {
      setSubmitting(true);
      await api.patch(`/contacts/${selectedContact.id}`, {
        nome: formNome || null,
        telefone: formTelefone,
        tags: formTags ? formTags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      });
      toast.success('Contato atualizado');
      setEditOpen(false);
      resetContactForm();
      fetchContacts();
      fetchStats();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message ?? 'Erro ao atualizar contato');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Delete Contact ───────────────────────────────
  const openDelete = (contact: Contact) => {
    setSelectedContact(contact);
    setDeleteOpen(true);
  };

  const handleDelete = async () => {
    if (!selectedContact) return;
    try {
      setSubmitting(true);
      await api.delete(`/contacts/${selectedContact.id}`);
      toast.success('Contato removido');
      setDeleteOpen(false);
      setSelectedContact(null);
      fetchContacts();
      fetchStats();
    } catch {
      toast.error('Erro ao remover contato');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Import Contacts ──────────────────────────────
  const handleImportTextChange = (text: string) => {
    setImportText(text);
    const lines = text.split('\n').filter((l) => l.trim());
    setImportPreview(lines.length);
  };

  const handleImport = async () => {
    try {
      setSubmitting(true);
      const lines = importText.split('\n').filter((l) => l.trim());
      const contactsToImport = lines.map((line) => {
        const parts = line.split(',').map((p) => p.trim());
        return {
          telefone: parts[0],
          ...(parts[1] ? { nome: parts[1] } : {}),
        };
      });

      const { data } = await api.post<{ imported: number; total: number; skipped: number }>('/contacts/import', {
        contacts: contactsToImport,
      });

      toast.success(`${data.imported} contatos importados, ${data.skipped} duplicados ignorados`);
      setImportOpen(false);
      setImportText('');
      setImportPreview(0);
      fetchContacts();
      fetchStats();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message ?? 'Erro ao importar contatos');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Create List ──────────────────────────────────
  const handleCreateList = async () => {
    try {
      setSubmitting(true);
      await api.post('/contacts/lists', {
        nome: formListNome,
        descricao: formListDescricao || undefined,
      });
      toast.success('Lista criada com sucesso');
      setCreateListOpen(false);
      resetListForm();
      fetchLists();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message ?? 'Erro ao criar lista');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Edit List ────────────────────────────────────
  const openEditList = (list: ContactList) => {
    setEditingList(list);
    setFormListNome(list.nome);
    setFormListDescricao(list.descricao ?? '');
    setEditListOpen(true);
  };

  const handleEditList = async () => {
    if (!editingList) return;
    try {
      setSubmitting(true);
      await api.patch(`/contacts/lists/${editingList.id}`, {
        nome: formListNome,
        descricao: formListDescricao || null,
      });
      toast.success('Lista atualizada');
      setEditListOpen(false);
      resetListForm();
      fetchLists();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message ?? 'Erro ao atualizar lista');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Delete List ──────────────────────────────────
  const openDeleteList = (list: ContactList) => {
    setEditingList(list);
    setDeleteListOpen(true);
  };

  const handleDeleteList = async () => {
    if (!editingList) return;
    try {
      setSubmitting(true);
      await api.delete(`/contacts/lists/${editingList.id}`);
      toast.success('Lista removida');
      setDeleteListOpen(false);
      setEditingList(null);
      fetchLists();
    } catch {
      toast.error('Erro ao remover lista');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── View List Contacts ───────────────────────────
  const openListDetail = (list: ContactList) => {
    setSelectedList(list);
    setListContactsPage(1);
    fetchListContacts(list.id, 1);
    setListDetailOpen(true);
  };

  const handleRemoveFromList = async (contactId: string) => {
    if (!selectedList) return;
    try {
      await api.delete(`/contacts/lists/${selectedList.id}/contacts`, {
        data: { contactIds: [contactId] },
      });
      toast.success('Contato removido da lista');
      fetchListContacts(selectedList.id, listContactsPage);
      fetchLists();
    } catch {
      toast.error('Erro ao remover contato da lista');
    }
  };

  // ─── Form Reset ───────────────────────────────────
  const resetContactForm = () => {
    setFormNome('');
    setFormTelefone('');
    setFormTags('');
    setSelectedContact(null);
  };

  const resetListForm = () => {
    setFormListNome('');
    setFormListDescricao('');
    setEditingList(null);
  };

  // ─── Render ───────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-text-primary">Contatos</h1>
        </div>
      </div>

      <Tabs defaultValue="contatos">
        <TabsList>
          <TabsTrigger value="contatos">Contatos</TabsTrigger>
          <TabsTrigger value="listas">Listas</TabsTrigger>
        </TabsList>

        {/* ══════════════════════════════════════════════ */}
        {/* TAB: Contatos                                  */}
        {/* ══════════════════════════════════════════════ */}
        <TabsContent value="contatos" className="space-y-6">
          {/* Actions */}
          <div className="flex items-center gap-2 justify-end">
            <Button variant="outline" onClick={() => { setImportText(''); setImportPreview(0); setImportOpen(true); }}>
              <Upload className="mr-2 h-4 w-4" />
              Importar
            </Button>
            <Button onClick={() => { resetContactForm(); setCreateOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" />
              Novo Contato
            </Button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <Users className="h-5 w-5 text-primary" />
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
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-text-secondary">Validos WhatsApp</p>
                  <p className="text-2xl font-bold text-text-primary">{stats.whatsappValid}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-lg bg-warning/10 p-2">
                  <Flame className="h-5 w-5 text-warning" />
                </div>
                <div>
                  <p className="text-sm text-text-secondary">Engajados</p>
                  <p className="text-2xl font-bold text-text-primary">{stats.engaged}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-lg bg-danger/10 p-2">
                  <Ban className="h-5 w-5 text-danger" />
                </div>
                <div>
                  <p className="text-sm text-text-secondary">Bloqueados</p>
                  <p className="text-2xl font-bold text-text-primary">{stats.blocked}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary" />
              <Input
                placeholder="Buscar por nome ou telefone..."
                className="pl-9"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <Select value={engagementFilter} onValueChange={(v) => { setEngagementFilter(v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Filtrar engajamento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="UNKNOWN">Desconhecido</SelectItem>
                <SelectItem value="COLD">Frio</SelectItem>
                <SelectItem value="WARM">Morno</SelectItem>
                <SelectItem value="HOT">Quente</SelectItem>
                <SelectItem value="BLOCKED">Bloqueado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Contact List */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : contacts.length === 0 ? (
            <Card>
              <CardContent className="p-12 flex flex-col items-center justify-center text-center">
                <Users className="h-12 w-12 text-text-secondary mb-4" />
                <h3 className="text-lg font-semibold text-text-primary mb-1">Nenhum contato</h3>
                <p className="text-text-secondary mb-4">
                  Adicione ou importe contatos para comecar.
                </p>
                <Button onClick={() => { resetContactForm(); setCreateOpen(true); }}>
                  <Plus className="mr-2 h-4 w-4" />
                  Novo Contato
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {/* Table Header */}
              <div className="hidden lg:grid lg:grid-cols-[1fr_150px_120px_150px_100px_100px_80px] gap-4 px-4 py-2 text-xs font-medium text-text-secondary uppercase">
                <span>Nome / Telefone</span>
                <span>Engajamento</span>
                <span>Tags</span>
                <span>Ultimo Contato</span>
                <span>Enviados</span>
                <span>Respostas</span>
                <span>Acoes</span>
              </div>

              {contacts.map((contact) => {
                const engCfg = getEngagementConfig(contact.engagement);
                return (
                  <Card key={contact.id} className="hover:border-border/80 transition-colors">
                    <CardContent className="p-4">
                      <div className="flex flex-col lg:grid lg:grid-cols-[1fr_150px_120px_150px_100px_100px_80px] gap-4 lg:items-center">
                        {/* Name & Phone */}
                        <div className="min-w-0">
                          <h3 className="font-semibold text-text-primary truncate">
                            {contact.nome ?? 'Sem nome'}
                          </h3>
                          <div className="flex items-center gap-1 text-sm text-text-secondary">
                            <Phone className="h-3 w-3" />
                            {contact.telefone}
                          </div>
                        </div>

                        {/* Engagement */}
                        <div>
                          <Badge variant={engCfg.variant} className={engCfg.className}>
                            {engCfg.label}
                          </Badge>
                        </div>

                        {/* Tags */}
                        <div className="flex flex-wrap gap-1">
                          {contact.tags.slice(0, 2).map((tag) => (
                            <Badge key={tag} variant="outline" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                          {contact.tags.length > 2 && (
                            <Badge variant="outline" className="text-xs">
                              +{contact.tags.length - 2}
                            </Badge>
                          )}
                        </div>

                        {/* Last Contacted */}
                        <div className="text-sm text-text-secondary">
                          {contact.last_contacted
                            ? new Date(contact.last_contacted).toLocaleDateString('pt-BR')
                            : 'Nunca'}
                        </div>

                        {/* Times Contacted */}
                        <div className="text-sm text-text-primary font-medium">
                          {contact.times_contacted}
                        </div>

                        {/* Times Replied */}
                        <div className="text-sm text-text-primary font-medium">
                          {contact.times_replied}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(contact)}
                            title="Editar"
                          >
                            <Pencil className="h-4 w-4 text-text-secondary" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openDelete(contact)}
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
          {!loading && contacts.length > 0 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-text-secondary">
                {total} contato{total !== 1 ? 's' : ''} encontrado{total !== 1 ? 's' : ''}
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
                  disabled={contacts.length < 20}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Proxima
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ══════════════════════════════════════════════ */}
        {/* TAB: Listas                                    */}
        {/* ══════════════════════════════════════════════ */}
        <TabsContent value="listas" className="space-y-6">
          {/* Actions */}
          <div className="flex items-center justify-end">
            <Button onClick={() => { resetListForm(); setCreateListOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" />
              Nova Lista
            </Button>
          </div>

          {/* Lists */}
          {listsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full rounded-xl" />
              ))}
            </div>
          ) : lists.length === 0 ? (
            <Card>
              <CardContent className="p-12 flex flex-col items-center justify-center text-center">
                <List className="h-12 w-12 text-text-secondary mb-4" />
                <h3 className="text-lg font-semibold text-text-primary mb-1">Nenhuma lista</h3>
                <p className="text-text-secondary mb-4">
                  Crie listas para organizar seus contatos.
                </p>
                <Button onClick={() => { resetListForm(); setCreateListOpen(true); }}>
                  <Plus className="mr-2 h-4 w-4" />
                  Nova Lista
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {lists.map((list) => (
                <Card
                  key={list.id}
                  className="hover:border-border/80 transition-colors cursor-pointer"
                  onClick={() => openListDetail(list)}
                >
                  <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <List className="h-4 w-4 text-primary" />
                          <h3 className="font-semibold text-text-primary truncate">
                            {list.nome}
                          </h3>
                        </div>
                        {list.descricao && (
                          <p className="text-sm text-text-secondary truncate">{list.descricao}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-6">
                        <div className="text-center">
                          <p className="text-xs text-text-secondary">Total</p>
                          <p className="text-lg font-bold text-text-primary">{list.total_count}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-text-secondary">Validos</p>
                          <p className="text-lg font-bold text-primary">{list.valid_count}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditList(list)}
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4 text-text-secondary" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openDeleteList(list)}
                          title="Excluir"
                        >
                          <Trash2 className="h-4 w-4 text-danger" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ─── Create Contact Dialog ──────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Contato</DialogTitle>
            <DialogDescription>
              Adicione um novo contato ao sistema.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="create-telefone">Telefone *</Label>
              <Input
                id="create-telefone"
                placeholder="Ex: 5531999999999"
                value={formTelefone}
                onChange={(e) => setFormTelefone(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-nome">Nome</Label>
              <Input
                id="create-nome"
                placeholder="Nome do contato"
                value={formNome}
                onChange={(e) => setFormNome(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-tags">Tags (separadas por virgula)</Label>
              <Input
                id="create-tags"
                placeholder="Ex: cliente, vip"
                value={formTags}
                onChange={(e) => setFormTags(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={submitting || !formTelefone.trim()}>
              {submitting ? 'Criando...' : 'Criar Contato'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Edit Contact Dialog ────────────────────── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Contato</DialogTitle>
            <DialogDescription>
              Atualize as informacoes do contato.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-telefone">Telefone *</Label>
              <Input
                id="edit-telefone"
                value={formTelefone}
                onChange={(e) => setFormTelefone(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-nome">Nome</Label>
              <Input
                id="edit-nome"
                value={formNome}
                onChange={(e) => setFormNome(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-tags">Tags (separadas por virgula)</Label>
              <Input
                id="edit-tags"
                value={formTags}
                onChange={(e) => setFormTags(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleEdit} disabled={submitting || !formTelefone.trim()}>
              {submitting ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Contact Dialog ──────────────────── */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir Contato</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir o contato{' '}
              <strong>{selectedContact?.nome ?? selectedContact?.telefone}</strong>? Esta acao nao pode ser desfeita.
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

      {/* ─── Import Dialog ──────────────────────────── */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Importar Contatos</DialogTitle>
            <DialogDescription>
              Cole os contatos no formato: telefone,nome (um por linha). O nome e opcional.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              placeholder={`5531999999999,Joao Silva\n5531888888888,Maria\n5531777777777`}
              rows={10}
              value={importText}
              onChange={(e) => handleImportTextChange(e.target.value)}
            />
            {importPreview > 0 && (
              <p className="text-sm text-text-secondary">
                <UserPlus className="inline h-4 w-4 mr-1" />
                {importPreview} contato{importPreview !== 1 ? 's' : ''} para importar
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleImport} disabled={submitting || importPreview === 0}>
              {submitting ? 'Importando...' : `Importar ${importPreview} contatos`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Create List Dialog ─────────────────────── */}
      <Dialog open={createListOpen} onOpenChange={setCreateListOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Lista</DialogTitle>
            <DialogDescription>
              Crie uma nova lista de contatos.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="create-list-nome">Nome *</Label>
              <Input
                id="create-list-nome"
                placeholder="Ex: Leads Dezembro"
                value={formListNome}
                onChange={(e) => setFormListNome(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-list-desc">Descricao</Label>
              <Input
                id="create-list-desc"
                placeholder="Descricao da lista"
                value={formListDescricao}
                onChange={(e) => setFormListDescricao(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateListOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleCreateList} disabled={submitting || !formListNome.trim()}>
              {submitting ? 'Criando...' : 'Criar Lista'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Edit List Dialog ───────────────────────── */}
      <Dialog open={editListOpen} onOpenChange={setEditListOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Lista</DialogTitle>
            <DialogDescription>
              Atualize as informacoes da lista.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-list-nome">Nome *</Label>
              <Input
                id="edit-list-nome"
                value={formListNome}
                onChange={(e) => setFormListNome(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-list-desc">Descricao</Label>
              <Input
                id="edit-list-desc"
                value={formListDescricao}
                onChange={(e) => setFormListDescricao(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditListOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleEditList} disabled={submitting || !formListNome.trim()}>
              {submitting ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete List Dialog ─────────────────────── */}
      <Dialog open={deleteListOpen} onOpenChange={setDeleteListOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir Lista</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir a lista{' '}
              <strong>{editingList?.nome}</strong>? Os contatos nao serao removidos, apenas a associacao com a lista.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteListOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDeleteList} disabled={submitting}>
              {submitting ? 'Excluindo...' : 'Excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── List Detail Dialog ─────────────────────── */}
      <Dialog open={listDetailOpen} onOpenChange={setListDetailOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedList?.nome}</DialogTitle>
            <DialogDescription>
              {selectedList?.descricao ?? 'Contatos desta lista'}
              {' — '}
              {listContactsTotal} contato{listContactsTotal !== 1 ? 's' : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto space-y-2">
            {listContactsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : listContacts.length === 0 ? (
              <p className="text-center text-text-secondary py-8">Nenhum contato nesta lista</p>
            ) : (
              listContacts.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-border"
                >
                  <div>
                    <p className="font-medium text-text-primary">
                      {contact.nome ?? 'Sem nome'}
                    </p>
                    <p className="text-sm text-text-secondary">{contact.telefone}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveFromList(contact.id)}
                    title="Remover da lista"
                  >
                    <UserMinus className="h-4 w-4 text-danger" />
                  </Button>
                </div>
              ))
            )}
          </div>
          {!listContactsLoading && listContacts.length > 0 && (
            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={listContactsPage <= 1}
                onClick={() => {
                  const newPage = listContactsPage - 1;
                  setListContactsPage(newPage);
                  if (selectedList) fetchListContacts(selectedList.id, newPage);
                }}
              >
                Anterior
              </Button>
              <span className="text-sm text-text-secondary">Pagina {listContactsPage}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={listContacts.length < 20}
                onClick={() => {
                  const newPage = listContactsPage + 1;
                  setListContactsPage(newPage);
                  if (selectedList) fetchListContacts(selectedList.id, newPage);
                }}
              >
                Proxima
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
