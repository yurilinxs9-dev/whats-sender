import { z } from 'zod';

export const CreateGroupSyncSchema = z.object({
  nome: z.string().min(1).max(100),
  source_group_jid: z.string().min(10),
  dest_group_jid: z.string().min(10),
  instance_id: z.string().uuid(),
  daily_add_cap: z.number().int().min(1).max(200).optional().default(50),
});

export type CreateGroupSyncDto = z.infer<typeof CreateGroupSyncSchema>;
