import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { CreateTemplateDto } from './dto/create-template.dto';
import type { UpdateTemplateDto } from './dto/update-template.dto';

interface ListParams {
  tenantId: string;
  page: number;
  limit: number;
  search?: string;
  type?: string;
}

function detectSpin(content: string): boolean {
  return /\{[^{}]+\|[^{}]+\}/.test(content);
}

function resolveSpin(content: string): string {
  return content.replace(/\{([^{}]+)\}/g, (_, group: string) => {
    const options = group.split('|');
    return options[Math.floor(Math.random() * options.length)];
  });
}

@Injectable()
export class TemplatesService {
  constructor(private prisma: PrismaService) {}

  async list({ tenantId, page, limit, search, type }: ListParams) {
    const where: Record<string, unknown> = { tenant_id: tenantId };

    if (search) {
      where.nome = { contains: search, mode: 'insensitive' };
    }
    if (type) {
      where.type = type;
    }

    const [templates, total] = await Promise.all([
      this.prisma.template.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.template.count({ where }),
    ]);

    return { templates, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string) {
    const template = await this.prisma.template.findFirst({
      where: { id, tenant_id: tenantId },
    });

    if (!template) throw new NotFoundException('Template nao encontrado');
    return template;
  }

  async create(data: CreateTemplateDto, tenantId: string) {
    const template = await this.prisma.template.create({
      data: {
        nome: data.nome,
        type: data.type ?? 'TEXT',
        content: data.content,
        media_url: data.media_url ?? undefined,
        has_spin: detectSpin(data.content),
        has_optout: data.has_optout ?? false,
        tenant_id: tenantId,
      },
    });

    return template;
  }

  async update(id: string, data: UpdateTemplateDto, tenantId: string) {
    const template = await this.prisma.template.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!template) throw new NotFoundException('Template nao encontrado');

    const updated = await this.prisma.template.update({
      where: { id },
      data: {
        ...(data.nome !== undefined && { nome: data.nome }),
        ...(data.type !== undefined && { type: data.type }),
        ...(data.content !== undefined && {
          content: data.content,
          has_spin: detectSpin(data.content),
        }),
        ...(data.media_url !== undefined && { media_url: data.media_url }),
        ...(data.has_optout !== undefined && { has_optout: data.has_optout }),
      },
    });

    return updated;
  }

  async remove(id: string, tenantId: string) {
    const template = await this.prisma.template.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!template) throw new NotFoundException('Template nao encontrado');

    await this.prisma.template.delete({ where: { id } });
    return { message: 'Template removido com sucesso' };
  }

  async preview(id: string, tenantId: string) {
    const template = await this.prisma.template.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!template) throw new NotFoundException('Template nao encontrado');

    let resolved = resolveSpin(template.content);
    resolved = resolved.replace(/\{\{nome\}\}/g, 'Joao');
    resolved = resolved.replace(/\{\{telefone\}\}/g, '5531999999999');

    return { original: template.content, resolved };
  }
}
