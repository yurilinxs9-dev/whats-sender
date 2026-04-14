import { z } from 'zod';

export const createContactSchema = z.object({
  telefone: z
    .string()
    .min(10, 'Telefone invalido')
    .max(20, 'Telefone invalido'),
  nome: z
    .string()
    .max(200, 'Nome deve ter no maximo 200 caracteres')
    .optional(),
  tags: z
    .array(z.string().max(50, 'Tag deve ter no maximo 50 caracteres'))
    .max(20, 'Maximo de 20 tags')
    .optional(),
});

export type CreateContactDto = z.infer<typeof createContactSchema>;
