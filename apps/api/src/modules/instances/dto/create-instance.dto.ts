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
  // Onde a instancia vai viver. Sem escolha explicita, UazAPI — que e o que
  // toda instancia existente e.
  provider: z.enum(['uazapi', 'evolution']).default('uazapi'),
  config: z
    .object({
      uazapi_token: z.string().min(1, 'Token UazAPI e obrigatorio').optional(),
    })
    .optional(),
});

export type CreateInstanceDto = z.infer<typeof createInstanceSchema>;
