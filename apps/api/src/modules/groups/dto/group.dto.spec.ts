import { ListAddTargetsSchema } from './group.dto';

describe('ListAddTargetsSchema', () => {
  it('aceita todos os desfechos que o relatório oferece como filtro', () => {
    for (const status of [
      'PENDING',
      'PROCESSING',
      'DONE',
      'FAILED',
      'NOT_JOINED',
      'SKIPPED',
      'INVITED',
    ]) {
      expect(ListAddTargetsSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('recusa status inventado', () => {
    expect(ListAddTargetsSchema.safeParse({ status: 'BANANA' }).success).toBe(
      false,
    );
  });

  it('assume a primeira página quando nada é informado', () => {
    const parsed = ListAddTargetsSchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.page_size).toBe(50);
  });
});
