import { z } from 'zod';

export const createTemplateSchema = z.object({
  nome: z
    .string()
    .min(2, 'Nome deve ter pelo menos 2 caracteres')
    .max(100, 'Nome deve ter no maximo 100 caracteres'),
  type: z.enum(['TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT']).default('TEXT'),
  content: z
    .string()
    .min(1, 'Conteudo e obrigatorio')
    .max(5000, 'Conteudo deve ter no maximo 5000 caracteres'),
  media_url: z.string().url('URL de midia invalida').optional(),
  has_optout: z.boolean().optional(),
});

export type CreateTemplateDto = z.infer<typeof createTemplateSchema>;
