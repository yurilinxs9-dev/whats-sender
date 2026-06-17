import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { GroupsService } from './groups.service';
import { CreateGroupSyncSchema } from './dto/create-group-sync.dto';
import type { AuthUser } from '../../common/types/auth-user';
import type { Request } from 'express';

@Controller('group-sync')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get('instances/:instanceId/groups')
  listInstanceGroups(
    @Req() req: Request & { user: AuthUser },
    @Param('instanceId') instanceId: string,
  ) {
    return this.groupsService.listInstanceGroups(req.user.tenantId, instanceId);
  }

  @Post()
  create(@Req() req: Request & { user: AuthUser }, @Body() body: unknown) {
    const parsed = CreateGroupSyncSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.groupsService.create(req.user.tenantId, parsed.data);
  }

  @Get()
  findAll(@Req() req: Request & { user: AuthUser }) {
    return this.groupsService.findAll(req.user.tenantId);
  }

  @Get(':id')
  findOne(@Req() req: Request & { user: AuthUser }, @Param('id') id: string) {
    return this.groupsService.findOne(req.user.tenantId, id);
  }

  @Post(':id/extract')
  @HttpCode(HttpStatus.OK)
  extract(@Req() req: Request & { user: AuthUser }, @Param('id') id: string) {
    return this.groupsService.extract(req.user.tenantId, id);
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  start(@Req() req: Request & { user: AuthUser }, @Param('id') id: string) {
    return this.groupsService.start(req.user.tenantId, id);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  pause(@Req() req: Request & { user: AuthUser }, @Param('id') id: string) {
    return this.groupsService.pause(req.user.tenantId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Req() req: Request & { user: AuthUser }, @Param('id') id: string) {
    return this.groupsService.remove(req.user.tenantId, id);
  }
}
