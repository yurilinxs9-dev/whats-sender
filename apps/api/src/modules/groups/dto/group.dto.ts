import { z } from 'zod';

// ── Extração ──────────────────────────────────────────
export const CreateExtractionSchema = z.object({
  nome: z.string().min(1).max(100),
  instance_id: z.string().uuid(),
  source_group_jid: z.string().min(10),
  source_group_name: z.string().optional().default(''),
});
export type CreateExtractionDto = z.infer<typeof CreateExtractionSchema>;

// ── Job de adição ─────────────────────────────────────
export const CreateAddJobSchema = z
  .object({
    nome: z.string().min(1).max(100),
    extraction_id: z.string().uuid(),
    dest_instance_id: z.string().uuid(),
    dest_group_jid: z.string().min(10),
    dest_group_name: z.string().optional().default(''),
    per_run_limit: z.number().int().min(1).max(500).optional().default(50),
    daily_add_cap: z.number().int().min(1).max(500).optional().default(50),
    delay_min_s: z.number().int().min(5).max(600).optional().default(30),
    delay_max_s: z.number().int().min(5).max(600).optional().default(90),
    send_invite_on_fail: z.boolean().optional().default(false),
    // O job pode nascer no modo convite: mesma extracao, sem adicao direta.
    strategy: z.enum(['ADD', 'INVITE']).optional().default('ADD'),
    invite_instance_id: z.string().uuid().optional().nullable(),
    invite_link: z.string().url().max(300).optional().nullable(),
    invite_message: z.string().min(1).max(1000).optional(),
  })
  .refine((d) => d.delay_max_s >= d.delay_min_s, {
    message: 'delay_max_s deve ser >= delay_min_s',
    path: ['delay_max_s'],
  })
  .refine(
    (d) =>
      d.invite_message === undefined || d.invite_message.includes('{link}'),
    {
      message: 'A mensagem precisa conter {link}',
      path: ['invite_message'],
    },
  );
export type CreateAddJobDto = z.infer<typeof CreateAddJobSchema>;

// Disparar uma rodada de adição (respeita per_run_limit do job ou override)
export const RunAddJobSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
});
export type RunAddJobDto = z.infer<typeof RunAddJobSchema>;

// Editar configuracoes do job depois de criado (toggle de convite, mensagem, ritmo)
export const UpdateAddJobSchema = z
  .object({
    nome: z.string().min(1).max(100).optional(),
    // Trocar a instancia de origem e permitido: o numero pode cair ou ser
    // substituido no meio de um job. O grupo de destino nao muda — alvos ja
    // processados fizeram parte de outro destino.
    dest_instance_id: z.string().uuid().optional(),
    per_run_limit: z.number().int().min(1).max(500).optional(),
    daily_add_cap: z.number().int().min(1).max(500).optional(),
    delay_min_s: z.number().int().min(5).max(600).optional(),
    delay_max_s: z.number().int().min(5).max(600).optional(),
    send_invite_on_fail: z.boolean().optional(),
    auto_chain: z.boolean().optional(),
    strategy: z.enum(['ADD', 'INVITE']).optional(),
    // Null volta a mandar convites pela dest_instance.
    invite_instance_id: z.string().uuid().nullable().optional(),
    invite_link: z.string().url().max(300).nullable().optional(),
    invite_message: z.string().min(1).max(1000).optional(),
  })
  .refine(
    (d) =>
      d.delay_min_s === undefined ||
      d.delay_max_s === undefined ||
      d.delay_max_s >= d.delay_min_s,
    {
      message: 'delay_max_s deve ser >= delay_min_s',
      path: ['delay_max_s'],
    },
  )
  .refine(
    (d) =>
      d.invite_message === undefined || d.invite_message.includes('{link}'),
    {
      message: 'A mensagem precisa conter {link}',
      path: ['invite_message'],
    },
  )
  .refine((d) => d.strategy !== 'INVITE' || d.invite_link !== null, {
    message: 'Modo convite exige o link do grupo',
    path: ['invite_link'],
  });
export type UpdateAddJobDto = z.infer<typeof UpdateAddJobSchema>;

// Enviar convite manualmente. Sem target_ids = todos os alvos que falharam.
export const SendInviteSchema = z.object({
  target_ids: z.array(z.string().uuid()).min(1).max(500).optional(),
});
export type SendInviteDto = z.infer<typeof SendInviteSchema>;

// Paginacao dos alvos de um job. O detalhe do job nao traz mais a lista:
// jobs reais tem centenas de alvos e a tela faz polling.
export const ListAddTargetsSchema = z.object({
  status: z
    .enum([
      'PENDING',
      'PROCESSING',
      'DONE',
      'FAILED',
      'NOT_JOINED',
      'SKIPPED',
      'INVITED',
    ])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  // 'last' limita aos alvos tocados desde o ultimo "Rodar lote" manual.
  round: z.enum(['last']).optional(),
});
export type ListAddTargetsDto = z.infer<typeof ListAddTargetsSchema>;
