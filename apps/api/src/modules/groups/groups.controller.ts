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
import {
  CreateExtractionSchema,
  CreateAddJobSchema,
  RunAddJobSchema,
} from './dto/group.dto';
import type { AuthUser } from '../../common/types/auth-user';
import type { Request } from 'express';

type Req = Request & { user: AuthUser };

@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  // Lista grupos do WhatsApp de uma instância (UazAPI)
  @Get('instances/:instanceId/groups')
  listInstanceGroups(@Req() req: Req, @Param('instanceId') instanceId: string) {
    return this.groupsService.listInstanceGroups(req.user.tenantId, instanceId);
  }

  /* ── Extrações ── */

  @Post('extractions')
  createExtraction(@Req() req: Req, @Body() body: unknown) {
    const parsed = CreateExtractionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.groupsService.createExtraction(req.user.tenantId, parsed.data);
  }

  @Get('extractions')
  listExtractions(@Req() req: Req) {
    return this.groupsService.listExtractions(req.user.tenantId);
  }

  @Get('extractions/:id')
  getExtraction(@Req() req: Req, @Param('id') id: string) {
    return this.groupsService.getExtraction(req.user.tenantId, id);
  }

  @Post('extractions/:id/re-extract')
  @HttpCode(HttpStatus.OK)
  reExtract(@Req() req: Req, @Param('id') id: string) {
    return this.groupsService.runExtraction(req.user.tenantId, id);
  }

  @Delete('extractions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeExtraction(@Req() req: Req, @Param('id') id: string) {
    return this.groupsService.removeExtraction(req.user.tenantId, id);
  }

  /* ── Jobs de adição ── */

  @Post('add-jobs')
  createAddJob(@Req() req: Req, @Body() body: unknown) {
    const parsed = CreateAddJobSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.groupsService.createAddJob(req.user.tenantId, parsed.data);
  }

  @Get('add-jobs')
  listAddJobs(@Req() req: Req) {
    return this.groupsService.listAddJobs(req.user.tenantId);
  }

  @Get('add-jobs/:id')
  getAddJob(@Req() req: Req, @Param('id') id: string) {
    return this.groupsService.getAddJob(req.user.tenantId, id);
  }

  @Post('add-jobs/:id/run')
  @HttpCode(HttpStatus.OK)
  runAddJob(@Req() req: Req, @Param('id') id: string, @Body() body: unknown) {
    const parsed = RunAddJobSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.groupsService.runAddJob(req.user.tenantId, id, parsed.data.limit);
  }

  @Post('add-jobs/:id/pause')
  @HttpCode(HttpStatus.OK)
  pauseAddJob(@Req() req: Req, @Param('id') id: string) {
    return this.groupsService.pauseAddJob(req.user.tenantId, id);
  }

  @Delete('add-jobs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAddJob(@Req() req: Req, @Param('id') id: string) {
    return this.groupsService.removeAddJob(req.user.tenantId, id);
  }
}
