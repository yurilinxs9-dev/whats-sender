import { z } from 'zod';

export const updateListSchema = z.object({
  nome: z
    .string()
    .min(1, 'Nome e obrigatorio')
    .max(200, 'Nome deve ter no maximo 200 caracteres')
    .optional(),
  descricao: z
    .string()
    .max(500, 'Descricao deve ter no maximo 500 caracteres')
    .optional()
    .nullable(),
});

export type UpdateListDto = z.infer<typeof updateListSchema>;
