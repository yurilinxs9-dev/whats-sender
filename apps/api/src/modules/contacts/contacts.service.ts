import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { CreateContactDto } from './dto/create-contact.dto';
import type { UpdateContactDto } from './dto/update-contact.dto';
import type { ImportContactsDto } from './dto/import-contacts.dto';
import type { CreateListDto } from './dto/create-list.dto';
import type { UpdateListDto } from './dto/update-list.dto';
import type { ContactEngagement } from '@prisma/client';

interface ListContactsParams {
  tenantId: string;
  page: number;
  limit: number;
  search?: string;
  engagement?: string;
  listId?: string;
}

@Injectable()
export class ContactsService {
  constructor(private prisma: PrismaService) {}

  // ─── Contacts ───────────────────────────────────────

  async listContacts({ tenantId, page, limit, search, engagement, listId }: ListContactsParams) {
    const where: Record<string, unknown> = { tenant_id: tenantId };

    if (search) {
      where.OR = [
        { nome: { contains: search, mode: 'insensitive' } },
        { telefone: { contains: search } },
      ];
    }
    if (engagement) {
      where.engagement = engagement;
    }
    if (listId) {
      where.list_contacts = { some: { contact_list_id: listId } };
    }

    const [contacts, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.contact.count({ where }),
    ]);

    return { contacts, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOneContact(id: string, tenantId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        dispatches: {
          orderBy: { created_at: 'desc' },
          take: 20,
        },
        list_contacts: {
          include: { contact_list: true },
        },
      },
    });

    if (!contact) throw new NotFoundException('Contato nao encontrado');
    return contact;
  }

  async createContact(data: CreateContactDto, tenantId: string) {
    const existing = await this.prisma.contact.findUnique({
      where: { telefone_tenant_id: { telefone: data.telefone, tenant_id: tenantId } },
    });
    if (existing) throw new ConflictException('Ja existe um contato com este telefone');

    return this.prisma.contact.create({
      data: {
        telefone: data.telefone,
        nome: data.nome ?? undefined,
        tags: data.tags ?? [],
        tenant_id: tenantId,
      },
    });
  }

  async importContacts(data: ImportContactsDto, tenantId: string) {
    const results = await this.prisma.contact.createMany({
      data: data.contacts.map((c) => ({
        telefone: c.telefone,
        nome: c.nome ?? null,
        tenant_id: tenantId,
      })),
      skipDuplicates: true,
    });

    return { imported: results.count, total: data.contacts.length, skipped: data.contacts.length - results.count };
  }

  /**
   * Import numbers from raw text (one per line) and create a list with them.
   * Accepts formats: 5531999999999, +5531999999999, 55 31 99999-9999, etc.
   */
  async importFromText(rawText: string, listName: string, tenantId: string) {
    // Parse numbers — strip everything except digits
    const lines = rawText.split(/[\r\n,;]+/).map((l) => l.trim()).filter(Boolean);
    const phones: string[] = [];

    for (const line of lines) {
      const digits = line.replace(/\D/g, '');
      if (digits.length >= 10 && digits.length <= 15) {
        // Ensure starts with country code (55 for Brazil)
        const normalized = digits.startsWith('55') ? digits : `55${digits}`;
        if (!phones.includes(normalized)) {
          phones.push(normalized);
        }
      }
    }

    if (phones.length === 0) {
      throw new BadRequestException(
        'Nenhum numero valido encontrado. Formato esperado: 5531999999999 (um por linha)',
      );
    }

    // Create contacts (skip duplicates)
    await this.prisma.contact.createMany({
      data: phones.map((telefone) => ({
        telefone,
        tenant_id: tenantId,
      })),
      skipDuplicates: true,
    });

    // Get all contact IDs for these phones
    const contacts = await this.prisma.contact.findMany({
      where: { telefone: { in: phones }, tenant_id: tenantId },
      select: { id: true },
    });

    // Create list
    const list = await this.prisma.contactList.create({
      data: {
        nome: listName,
        tenant_id: tenantId,
        total_count: contacts.length,
      },
    });

    // Add contacts to list
    await this.prisma.listContact.createMany({
      data: contacts.map((c) => ({
        contact_list_id: list.id,
        contact_id: c.id,
      })),
      skipDuplicates: true,
    });

    return {
      list,
      imported: contacts.length,
      total_lines: lines.length,
      invalid: lines.length - phones.length,
    };
  }

  async updateContact(id: string, data: UpdateContactDto, tenantId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!contact) throw new NotFoundException('Contato nao encontrado');

    if (data.telefone && data.telefone !== contact.telefone) {
      const existing = await this.prisma.contact.findUnique({
        where: { telefone_tenant_id: { telefone: data.telefone, tenant_id: tenantId } },
      });
      if (existing) throw new ConflictException('Ja existe um contato com este telefone');
    }

    return this.prisma.contact.update({
      where: { id },
      data: {
        ...(data.nome !== undefined && { nome: data.nome }),
        ...(data.telefone !== undefined && { telefone: data.telefone }),
        ...(data.tags !== undefined && { tags: data.tags }),
      },
    });
  }

  async removeContact(id: string, tenantId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!contact) throw new NotFoundException('Contato nao encontrado');

    await this.prisma.contact.delete({ where: { id } });
    return { message: 'Contato removido com sucesso' };
  }

  async getContactStats(tenantId: string) {
    const [total, whatsappValid, warm, hot, blocked] = await Promise.all([
      this.prisma.contact.count({ where: { tenant_id: tenantId } }),
      this.prisma.contact.count({ where: { tenant_id: tenantId, whatsapp_valid: true } }),
      this.prisma.contact.count({ where: { tenant_id: tenantId, engagement: 'WARM' as ContactEngagement } }),
      this.prisma.contact.count({ where: { tenant_id: tenantId, engagement: 'HOT' as ContactEngagement } }),
      this.prisma.contact.count({ where: { tenant_id: tenantId, engagement: 'BLOCKED' as ContactEngagement } }),
    ]);

    return { total, whatsappValid, engaged: warm + hot, blocked };
  }

  // ─── Contact Lists ──────────────────────────────────

  async listContactLists(tenantId: string) {
    return this.prisma.contactList.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
    });
  }

  async createContactList(data: CreateListDto, tenantId: string) {
    return this.prisma.contactList.create({
      data: {
        nome: data.nome,
        descricao: data.descricao ?? undefined,
        tenant_id: tenantId,
      },
    });
  }

  async updateContactList(id: string, data: UpdateListDto, tenantId: string) {
    const list = await this.prisma.contactList.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!list) throw new NotFoundException('Lista nao encontrada');

    return this.prisma.contactList.update({
      where: { id },
      data: {
        ...(data.nome !== undefined && { nome: data.nome }),
        ...(data.descricao !== undefined && { descricao: data.descricao }),
      },
    });
  }

  async removeContactList(id: string, tenantId: string) {
    const list = await this.prisma.contactList.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!list) throw new NotFoundException('Lista nao encontrada');

    await this.prisma.contactList.delete({ where: { id } });
    return { message: 'Lista removida com sucesso' };
  }

  async addContactsToList(listId: string, contactIds: string[], tenantId: string) {
    const list = await this.prisma.contactList.findFirst({
      where: { id: listId, tenant_id: tenantId },
    });
    if (!list) throw new NotFoundException('Lista nao encontrada');

    // Verify all contacts belong to tenant
    const contacts = await this.prisma.contact.findMany({
      where: { id: { in: contactIds }, tenant_id: tenantId },
      select: { id: true },
    });

    const validIds = contacts.map((c) => c.id);

    const result = await this.prisma.listContact.createMany({
      data: validIds.map((contactId) => ({
        contact_list_id: listId,
        contact_id: contactId,
      })),
      skipDuplicates: true,
    });

    // Update total_count
    const totalCount = await this.prisma.listContact.count({
      where: { contact_list_id: listId },
    });
    await this.prisma.contactList.update({
      where: { id: listId },
      data: { total_count: totalCount },
    });

    return { added: result.count, total: totalCount };
  }

  async removeContactsFromList(listId: string, contactIds: string[], tenantId: string) {
    const list = await this.prisma.contactList.findFirst({
      where: { id: listId, tenant_id: tenantId },
    });
    if (!list) throw new NotFoundException('Lista nao encontrada');

    await this.prisma.listContact.deleteMany({
      where: {
        contact_list_id: listId,
        contact_id: { in: contactIds },
      },
    });

    // Update total_count
    const totalCount = await this.prisma.listContact.count({
      where: { contact_list_id: listId },
    });
    await this.prisma.contactList.update({
      where: { id: listId },
      data: { total_count: totalCount },
    });

    return { removed: contactIds.length, total: totalCount };
  }

  async getListContacts(listId: string, tenantId: string, page: number, limit: number) {
    const list = await this.prisma.contactList.findFirst({
      where: { id: listId, tenant_id: tenantId },
    });
    if (!list) throw new NotFoundException('Lista nao encontrada');

    const where = { contact_list_id: listId };

    const [listContacts, total] = await Promise.all([
      this.prisma.listContact.findMany({
        where,
        include: { contact: true },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.listContact.count({ where }),
    ]);

    const contacts = listContacts.map((lc) => lc.contact);
    return { contacts, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
