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
import { InstancesService } from './instances.service';
import { createInstanceSchema } from './dto/create-instance.dto';
import { updateInstanceSchema } from './dto/update-instance.dto';
import type { AuthUser } from '../../common/types/auth-user';

@Controller('instances')
export class InstancesController {
  constructor(private instancesService: InstancesService) {}

  @Get()
  async list(
    @Req() req: Request & { user: AuthUser },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.instancesService.list({
      tenantId: req.user.tenantId,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      search: search || undefined,
      status: status || undefined,
    });
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() req: Request & { user: AuthUser },
  ) {
    return this.instancesService.findOne(id, req.user.tenantId);
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body() body: unknown,
    @Req() req: Request & { user: AuthUser },
  ) {
    const data = createInstanceSchema.parse(body);
    return this.instancesService.create(data, req.user.tenantId);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request & { user: AuthUser },
  ) {
    const data = updateInstanceSchema.parse(body);
    return this.instancesService.update(id, data, req.user.tenantId);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Req() req: Request & { user: AuthUser },
  ) {
    return this.instancesService.remove(id, req.user.tenantId);
  }

  @Post(':id/connect')
  @HttpCode(200)
  async connect(
    @Param('id') id: string,
    @Req() req: Request & { user: AuthUser },
  ) {
    return this.instancesService.connect(id, req.user.tenantId);
  }

  @Get(':id/qrcode')
  async getQrCode(
    @Param('id') id: string,
    @Req() req: Request & { user: AuthUser },
  ) {
    return this.instancesService.getQrCode(id, req.user.tenantId);
  }

  @Post(':id/disconnect')
  @HttpCode(200)
  async disconnect(
    @Param('id') id: string,
    @Req() req: Request & { user: AuthUser },
  ) {
    return this.instancesService.disconnect(id, req.user.tenantId);
  }
}
