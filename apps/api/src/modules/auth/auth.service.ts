import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async login(email: string, senha: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Credenciais invalidas');

    const valid = await bcrypt.compare(senha, user.senha_hash);
    if (!valid) throw new UnauthorizedException('Credenciais invalidas');

    const tokens = this.generateTokens(user);
    return { ...tokens, user };
  }

  generateTokens(user: { id: string; email: string; role: string; tenant_id: string }) {
    const payload = { sub: user.id, email: user.email, role: user.role, tenantId: user.tenant_id };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get('JWT_REFRESH_EXPIRY', '7d'),
    });

    return { accessToken, refreshToken };
  }

  async refreshToken(token: string) {
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      }) as { sub: string; email: string; role: string; tenantId: string };
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) throw new UnauthorizedException();
      return this.generateTokens(user);
    } catch {
      throw new UnauthorizedException('Refresh token invalido');
    }
  }

  async createUser(data: { nome: string; email: string; senha: string; workspace_name?: string }) {
    const exists = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (exists) throw new ConflictException('Email ja cadastrado');

    const senha_hash = await bcrypt.hash(data.senha, 12);
    const workspaceName = data.workspace_name ?? `${data.nome}'s workspace`;

    return this.prisma.$transaction(async (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => {
      const tenant = await tx.tenant.create({
        data: { nome: workspaceName },
      });

      const user = await tx.user.create({
        data: {
          nome: data.nome,
          email: data.email,
          senha_hash,
          role: 'ADMIN',
          tenant_id: tenant.id,
        },
        select: { id: true, nome: true, email: true, role: true, tenant_id: true, created_at: true },
      });

      await tx.tenantSettings.create({
        data: { tenant_id: tenant.id },
      });

      return user;
    });
  }
}
