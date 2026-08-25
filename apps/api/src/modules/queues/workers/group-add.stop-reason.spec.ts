import { GroupAddWorker, GroupAddJobData } from './group-add.worker';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { UazApiService } from '../../uazapi/uazapi.service';
import { SenderGateway } from '../../websocket/websocket.gateway';
import { ProviderResolver } from '../../whatsapp/provider-resolver.service';
import { Job, Queue } from 'bullmq';

const JOB_ID = 'job-1';
const TARGET_ID = 'target-1';
const PHONE = '5511947943404';

const JOB = {
  data: { jobId: JOB_ID, targetId: TARGET_ID, tenantId: 't1' },
} as Job<{ jobId: string; targetId: string; tenantId: string }>;

function makeAddJob(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    status: 'RUNNING',
    dest_group_jid: 'g@g.us',
    dest_instance: { config: { uazapi_token: 'tok' } },
    daily_add_cap: 10,
    added_today: 0,
    last_reset_at: new Date(),
    run_remaining: 5,
    send_invite_on_fail: false,
    invite_link: null,
    invite_message: 'entra: {link}',
    added_count: 0,
    failed_count: 0,
    skipped_count: 0,
    ...overrides,
  };
}

function makePrisma(
  addJob: Record<string, unknown>,
  opts: { settings?: unknown; pending?: number } = {},
) {
  return {
    groupAddJob: {
      findUnique: jest.fn().mockResolvedValue(addJob),
      update: jest.fn().mockResolvedValue(addJob),
    },
    addTarget: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: TARGET_ID, phone: PHONE, member_jid: '' }),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(opts.pending ?? 1),
      findMany: jest.fn().mockResolvedValue(
        Array.from({ length: opts.pending ?? 1 }, (_, i) => ({
          id: 'next-' + i,
        })),
      ),
    },
    tenantSettings: {
      findUnique: jest.fn().mockResolvedValue(opts.settings ?? null),
    },
  };
}

function makeWorker(prisma: ReturnType<typeof makePrisma>) {
  const queue = { add: jest.fn() };
  const real = new UazApiService({
    get: (_k: string, fallback: string) => fallback,
  } as never);
  const gateway = {
    emitAddJobProgress: jest.fn(),
    emitAddJobCompleted: jest.fn(),
  };
  const provider = {
    addGroupParticipants: jest.fn().mockResolvedValue({
      added: [{ jid: PHONE, status: '200' }],
      failed: [],
      participants: [`${PHONE}@s.whatsapp.net`],
    }),
    isMemberInList: real.isMemberInList.bind(real),
  };
  const worker = new GroupAddWorker(
    prisma as unknown as PrismaService,
    provider as unknown as UazApiService,
    gateway as unknown as SenderGateway,
    {
      resolve: (config: unknown) =>
        config && (config as { uazapi_token?: string }).uazapi_token
          ? { provider, credential: 'tok' }
          : null,
    } as unknown as ProviderResolver,
    queue as unknown as Queue<GroupAddJobData>,
  );
  return { worker, gateway, queue };
}

/** Junta o que foi gravado no job ao longo do processamento. */
function jobWrites(prisma: ReturnType<typeof makePrisma>) {
  return (prisma.groupAddJob.update.mock.calls as { data: unknown }[][]).map(
    (c) => c[0].data as Record<string, unknown>,
  );
}

describe('GroupAddWorker — por que o job parou', () => {
  it('marca DAILY_CAP com horário de retomada quando bate o teto do dia', async () => {
    const prisma = makePrisma(makeAddJob({ added_today: 10 }));
    const { worker } = makeWorker(prisma);

    await expect(worker.process(JOB)).rejects.toThrow('daily_cap_reached');

    const stop = jobWrites(prisma).find((d) => d.stop_reason === 'DAILY_CAP');
    expect(stop).toBeDefined();
    expect(stop?.resume_at).toBeInstanceOf(Date);
  });

  it('marca OUTSIDE_WINDOW com horário de retomada fora da janela', async () => {
    const now = new Date();
    const closed = `${String((now.getHours() + 2) % 24).padStart(2, '0')}:00`;
    const closedEnd = `${String((now.getHours() + 3) % 24).padStart(2, '0')}:00`;
    const prisma = makePrisma(makeAddJob(), {
      settings: { send_window_start: closed, send_window_end: closedEnd },
    });
    const { worker } = makeWorker(prisma);

    await expect(worker.process(JOB)).rejects.toThrow('outside_send_window');

    const stop = jobWrites(prisma).find(
      (d) => d.stop_reason === 'OUTSIDE_WINDOW',
    );
    expect(stop).toBeDefined();
    expect(stop?.resume_at).toBeInstanceOf(Date);
  });

  it('marca ROUND_DONE quando a rodada acaba e ainda há pendentes', async () => {
    const prisma = makePrisma(makeAddJob({ run_remaining: 1 }), { pending: 3 });
    const { worker } = makeWorker(prisma);

    await worker.process(JOB);

    const stop = jobWrites(prisma).find((d) => d.stop_reason === 'ROUND_DONE');
    expect(stop).toBeDefined();
    expect(stop?.status).toBe('IDLE');
    expect(stop?.resume_at).toBeNull();
  });

  it('não marca ROUND_DONE enquanto a rodada tem alvos pela frente', async () => {
    const prisma = makePrisma(makeAddJob({ run_remaining: 4 }), { pending: 3 });
    const { worker } = makeWorker(prisma);

    await worker.process(JOB);

    expect(
      jobWrites(prisma).find((d) => d.stop_reason === 'ROUND_DONE'),
    ).toBeUndefined();
  });

  it('conclui o job em vez de marcar rodada quando não sobra pendente', async () => {
    const prisma = makePrisma(makeAddJob({ run_remaining: 1 }), { pending: 0 });
    const { worker, gateway } = makeWorker(prisma);

    await worker.process(JOB);

    expect(
      jobWrites(prisma).find((d) => d.status === 'COMPLETED'),
    ).toBeDefined();
    expect(gateway.emitAddJobCompleted).toHaveBeenCalled();
  });

  it('encadeia a próxima rodada sozinho quando o cap do dia ainda cabe', async () => {
    const prisma = makePrisma(
      makeAddJob({ auto_chain: true, run_remaining: 1, added_today: 2 }),
      { pending: 5 },
    );
    const { worker, queue } = makeWorker(prisma);

    await worker.process(JOB);

    expect(queue.add).toHaveBeenCalled();
    expect(
      jobWrites(prisma).find((d) => d.stop_reason === 'ROUND_DONE'),
    ).toBeUndefined();
    const run = jobWrites(prisma).find((d) => d.status === 'RUNNING');
    expect(run).toBeDefined();
  });

  it('não encadeia além do cap: marca DAILY_CAP em vez de enfileirar', async () => {
    // Entra na rodada com espaco para um alvo; ao terminar, o cap ja fechou.
    const prisma = makePrisma(
      makeAddJob({ auto_chain: true, run_remaining: 1, added_today: 9 }),
      { pending: 5 },
    );
    // process() consulta o job varias vezes antes de terminar o alvo; so na
    // ultima — ja dentro do encadeamento — o cap aparece fechado.
    const comEspaco = makeAddJob({
      auto_chain: true,
      run_remaining: 1,
      added_today: 9,
    });
    prisma.groupAddJob.findUnique
      .mockResolvedValueOnce(comEspaco)
      .mockResolvedValueOnce(comEspaco)
      .mockResolvedValueOnce(comEspaco)
      .mockResolvedValueOnce(comEspaco)
      .mockResolvedValue(
        makeAddJob({ auto_chain: true, run_remaining: 1, added_today: 10 }),
      );
    const { worker, queue } = makeWorker(prisma);

    await worker.process(JOB);

    expect(queue.add).not.toHaveBeenCalled();
    expect(
      jobWrites(prisma).find((d) => d.stop_reason === 'DAILY_CAP'),
    ).toBeDefined();
  });

  it('com encadeamento desligado, para e espera o clique', async () => {
    const prisma = makePrisma(
      makeAddJob({ auto_chain: false, run_remaining: 1 }),
      { pending: 5 },
    );
    const { worker, queue } = makeWorker(prisma);

    await worker.process(JOB);

    expect(queue.add).not.toHaveBeenCalled();
    expect(
      jobWrites(prisma).find((d) => d.stop_reason === 'ROUND_DONE'),
    ).toBeDefined();
  });

  it('não encadeia um job pausado', async () => {
    const prisma = makePrisma(
      makeAddJob({ auto_chain: true, run_remaining: 1, status: 'PAUSED' }),
      { pending: 5 },
    );
    const { worker, queue } = makeWorker(prisma);

    await worker.process(JOB);

    expect(queue.add).not.toHaveBeenCalled();
  });

  it('limpa o motivo anterior ao processar um alvo', async () => {
    const prisma = makePrisma(
      makeAddJob({ stop_reason: 'DAILY_CAP', run_remaining: 4 }),
    );
    const { worker } = makeWorker(prisma);

    await worker.process(JOB);

    expect(
      jobWrites(prisma).find(
        (d) => d.stop_reason === null && d.resume_at === null,
      ),
    ).toBeDefined();
  });
});
