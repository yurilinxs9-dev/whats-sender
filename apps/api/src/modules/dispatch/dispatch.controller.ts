import {
  Controller,
  Post,
  Get,
  Param,
  Req,
  HttpCode,
} from '@nestjs/common';
import { DispatchService } from './dispatch.service';
import type { AuthUser } from '../../common/types/auth-user';

@Controller('dispatch')
export class DispatchController {
  constructor(private dispatchService: DispatchService) {}

  @Post('campaigns/:id/start')
  @HttpCode(200)
  async startCampaign(
    @Param('id') id: string,
    @Req() req: Request & { user: AuthUser },
  ) {
    return this.dispatchService.startCampaign(id, req.user.tenantId);
  }

  @Post('campaigns/:id/pause')
  @HttpCode(200)
  async pauseCampaign(
    @Param('id') id: string,
    @Req() req: Request & { user: AuthUser },
  ) {
    await this.dispatchService.pauseCampaign(id, req.user.tenantId);
    return { message: 'Campanha pausada com sucesso' };
  }

  @Post('campaigns/:id/resume')
  @HttpCode(200)
  async resumeCampaign(
    @Param('id') id: string,
    @Req() req: Request & { user: AuthUser },
  ) {
    return this.dispatchService.resumeCampaign(id, req.user.tenantId);
  }

  @Get('campaigns/:id/status')
  async getStatus(
    @Param('id') id: string,
    @Req() req: Request & { user: AuthUser },
  ) {
    return this.dispatchService.getStatus(id, req.user.tenantId);
  }
}
