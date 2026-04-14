import type { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  nome: string;
  email: string;
  role: Role;
  tenantId: string;
}
