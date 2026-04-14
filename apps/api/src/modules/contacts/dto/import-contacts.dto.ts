import { z } from 'zod';

export const importContactsSchema = z.object({
  contacts: z
    .array(
      z.object({
        telefone: z
          .string()
          .min(10, 'Telefone invalido')
          .max(20, 'Telefone invalido'),
        nome: z
          .string()
          .max(200, 'Nome deve ter no maximo 200 caracteres')
          .optional(),
      }),
    )
    .min(1, 'Pelo menos 1 contato e necessario')
    .max(5000, 'Maximo de 5000 contatos por importacao'),
});

export type ImportContactsDto = z.infer<typeof importContactsSchema>;
