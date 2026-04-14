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
import { CampaignsService } from './campaigns.service';
import { createCampaignSchema } from './dto/create-campaign.dto';
import { updateCampaignSchema } from './dto/update-campaign.dto';
import type { AuthUser } from '../../common/types/auth-user';

@Controller('campaigns')
export class CampaignsController {
  constructor(private campaignsService: CampaignsService) {}

  @Get()
  async list(
    @Req() req: Request & { user: AuthUser },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.campaignsService.list({
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
    return this.campaignsService.findOne(id, req.user.tenantId);
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body() body: unknown,
    @Req() req: Request & { user: AuthUser },
  ) {
    const data = createCampaignSchema.parse(body);
    return this.campaignsService.create(data, req.user.tenantId);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request & { user: AuthUser },
  ) {
    const data = updateCampaignSchema.parse(body);
    return this.campaignsService.update(id, data, req.user.tenantId);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Req() req: Request & { user: AuthUser },
  ) {
    return this.campaignsService.remove(id, req.user.tenantId);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @Param('id') id: string,
    @Req() req: Request & { user: AuthUser },
  ) {
    return this.campaignsService.cancel(id, req.user.tenantId);
  }
}
