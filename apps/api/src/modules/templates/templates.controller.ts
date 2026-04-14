import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  HttpCode,
} from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { createTemplateSchema } from './dto/create-template.dto';
import { updateTemplateSchema } from './dto/update-template.dto';
import type { AuthUser } from '../../common/types/auth-user';

@Controller('templates')
export class TemplatesController {
  constructor(private templatesService: TemplatesService) {}

  @Get()
  async list(
    @Req() req: Request & { user: AuthUser },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('type') type?: string,
  ) {
    return this.templatesService.list({
      tenantId: req.user.tenantId,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      search: search || undefined,
      type: type || undefined,
    });
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() req: Request & { user: AuthUser },
  ) {
    return this.templatesService.findOne(id, req.user.tenantId);
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body() body: unknown,
    @Req() req: Request & { user: AuthUser },
  ) {
    const data = createTemplateSchema.parse(body);
    return this.templatesService.create(data, req.user.tenantId);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request & { user: AuthUser },
  ) {
    const data = updateTemplateSchema.parse(body);
    return this.templatesService.update(id, data, req.user.tenantId);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Req() req: Request & { user: AuthUser },
  ) {
    return this.templatesService.remove(id, req.user.tenantId);
  }

  @Post(':id/preview')
  @HttpCode(200)
  async preview(
    @Param('id') id: string,
    @Req() req: Request & { user: AuthUser },
  ) {
    return this.templatesService.preview(id, req.user.tenantId);
  }
}
