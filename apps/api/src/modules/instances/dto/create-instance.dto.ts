import { z } from 'zod';

export const createInstanceSchema = z.object({
  nome: z
    .string()
    .min(2, 'Nome deve ter pelo menos 2 caracteres')
    .max(100, 'Nome deve ter no maximo 100 caracteres'),
  telefone: z
    .string()
    .min(10, 'Telefone invalido')
    .max(20, 'Telefone invalido')
    .optional(),
  config: z
    .object({
      uazapi_token: z.string().min(1, 'Token UazAPI e obrigatorio').optional(),
    })
    .optional(),
});

export type CreateInstanceDto = z.infer<typeof createInstanceSchema>;
