import { z } from 'zod';

export const updateCampaignSchema = z.object({
  nome: z
    .string()
    .min(2, 'Nome deve ter pelo menos 2 caracteres')
    .max(200, 'Nome deve ter no maximo 200 caracteres')
    .optional(),
  delay_min: z
    .number()
    .int()
    .min(5, 'Delay minimo e 5 segundos')
    .optional(),
  delay_max: z
    .number()
    .int()
    .min(8, 'Delay maximo minimo e 8 segundos')
    .optional(),
  use_spin: z.boolean().optional(),
  use_composing: z.boolean().optional(),
});

export type UpdateCampaignDto = z.infer<typeof updateCampaignSchema>;
