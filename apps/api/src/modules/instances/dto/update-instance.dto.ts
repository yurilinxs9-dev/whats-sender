import { z } from 'zod';

export const updateInstanceSchema = z.object({
  nome: z
    .string()
    .min(2, 'Nome deve ter pelo menos 2 caracteres')
    .max(100, 'Nome deve ter no maximo 100 caracteres')
    .optional(),
  telefone: z
    .string()
    .min(10, 'Telefone invalido')
    .max(20, 'Telefone invalido')
    .optional()
    .nullable(),
  daily_limit: z
    .number()
    .int()
    .min(1, 'Limite diario minimo e 1')
    .max(10000, 'Limite diario maximo e 10000')
    .optional(),
  config: z
    .object({
      uazapi_token: z.string().min(1).optional(),
    })
    .optional(),
});

export type UpdateInstanceDto = z.infer<typeof updateInstanceSchema>;
