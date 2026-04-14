import { z } from 'zod';

export const listContactsBodySchema = z.object({
  contactIds: z
    .array(z.string().uuid('ID de contato invalido'))
    .min(1, 'Pelo menos 1 contato e necessario')
    .max(5000, 'Maximo de 5000 contatos por operacao'),
});

export type ListContactsBodyDto = z.infer<typeof listContactsBodySchema>;
