import { z } from 'zod';

export const createCampaignSchema = z.object({
  nome: z
    .string()
    .min(2, 'Nome deve ter pelo menos 2 caracteres')
    .max(200, 'Nome deve ter no maximo 200 caracteres'),
  template_id: z.string().uuid('template_id deve ser um UUID valido').optional(),
  inline_message: z.string().min(1).max(5000).optional(),
  contact_list_id: z.string().uuid('contact_list_id deve ser um UUID valido'),
  instance_ids: z
    .array(z.string().uuid('Cada instance_id deve ser um UUID valido'))
    .min(1, 'Selecione pelo menos uma instancia'),
  delay_min: z
    .number()
    .int()
    .min(5, 'Delay minimo e 5 segundos')
    .default(8),
  delay_max: z
    .number()
    .int()
    .min(8, 'Delay maximo minimo e 8 segundos')
    .default(20),
  scheduled_at: z
    .string()
    .datetime({ offset: true })
    .optional(),
  use_spin: z.boolean().default(true),
  use_composing: z.boolean().default(true),
}).refine(
  (data) => data.template_id || data.inline_message,
  { message: 'Informe um template ou uma mensagem direta', path: ['template_id'] },
);

export type CreateCampaignDto = z.infer<typeof createCampaignSchema>;
