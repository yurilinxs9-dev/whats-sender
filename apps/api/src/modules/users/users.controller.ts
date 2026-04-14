import { Controller, Get, Req } from '@nestjs/common';
import { UsersService } from './users.service';
import { Request } from 'express';
import type { AuthUser } from '../../common/types/auth-user';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  async findAll(@Req() req: Request & { user: AuthUser }) {
    return this.usersService.findByTenant(req.user.tenantId);
  }
}
