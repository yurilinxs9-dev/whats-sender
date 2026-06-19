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
  })
  .refine((d) => d.delay_max_s >= d.delay_min_s, {
    message: 'delay_max_s deve ser >= delay_min_s',
    path: ['delay_max_s'],
  });
export type CreateAddJobDto = z.infer<typeof CreateAddJobSchema>;

// Disparar uma rodada de adição (respeita per_run_limit do job ou override)
export const RunAddJobSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
});
export type RunAddJobDto = z.infer<typeof RunAddJobSchema>;
