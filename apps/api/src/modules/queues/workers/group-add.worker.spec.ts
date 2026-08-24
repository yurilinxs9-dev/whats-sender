import { GroupAddWorker } from './group-add.worker';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { UazApiService } from '../../uazapi/uazapi.service';
import { SenderGateway } from '../../websocket/websocket.gateway';
import { Job } from 'bullmq';

const JOB_ID = 'job-1';
const TARGET_ID = 'target-1';
const PHONE = '5511947943404';
const GROUP = '120363041378673958@g.us';

function makeAddJob(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    status: 'RUNNING',
    dest_group_jid: GROUP,
    dest_instance: { config: { uazapi_token: 'tok' } },
    daily_add_cap: 50,
    added_today: 0,
    last_reset_at: new Date(),
    send_invite_on_fail: false,
    invite_link: null,
    invite_message: 'entra: {link}',
    added_count: 0,
    failed_count: 0,
    skipped_count: 0,
    ...overrides,
  };
}

function makePrisma(addJob: Record<string, unknown>) {
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
      count: jest.fn().mockResolvedValue(1),
    },
    tenantSettings: { findUnique: jest.fn().mockResolvedValue(null) },
  };
}

function makeWorker(
  prisma: ReturnType<typeof makePrisma>,
  uazapi: Partial<UazApiService>,
) {
  const gateway = {
    emitAddJobProgress: jest.fn(),
    emitAddJobCompleted: jest.fn(),
  };
  const worker = new GroupAddWorker(
    prisma as unknown as PrismaService,
    uazapi as UazApiService,
    gateway as unknown as SenderGateway,
  );
  return { worker, gateway };
}

const JOB = {
  data: { jobId: JOB_ID, targetId: TARGET_ID, tenantId: 't1' },
} as Job<{ jobId: string; targetId: string; tenantId: string }>;

function statusOf(prisma: ReturnType<typeof makePrisma>): string | undefined {
  const calls = prisma.addTarget.update.mock.calls as {
    data: { status?: string };
  }[][];
  const statuses = calls
    .map((c) => c[0].data.status)
    .filter((s): s is string => !!s);
  return statuses[statuses.length - 1];
}

describe('GroupAddWorker — confirmação de entrada', () => {
  const realService = new UazApiService({
    get: (_k: string, fallback: string) => fallback,
  } as never);
  const isMemberInList = realService.isMemberInList.bind(realService);

  it('marca DONE quando o membro aparece na lista devolvida pela adição', async () => {
    const prisma = makePrisma(makeAddJob());
    const { worker } = makeWorker(prisma, {
      addGroupParticipants: jest.fn().mockResolvedValue({
        added: [{ jid: PHONE, status: '200' }],
        failed: [],
        participants: [`${PHONE}@s.whatsapp.net`],
      }),
      isMemberInList,
    });

    await worker.process(JOB);

    expect(statusOf(prisma)).toBe('DONE');
  });

  it('marca NOT_JOINED quando a lista existe e o membro não está nela', async () => {
    const prisma = makePrisma(makeAddJob());
    const { worker } = makeWorker(prisma, {
      addGroupParticipants: jest.fn().mockResolvedValue({
        added: [{ jid: PHONE, status: '200' }],
        failed: [],
        participants: ['5599999999999@s.whatsapp.net'],
      }),
      isMemberInList,
    });

    await worker.process(JOB);

    expect(statusOf(prisma)).toBe('NOT_JOINED');
  });

  it('consulta a lista do grupo quando a resposta não traz participantes', async () => {
    const prisma = makePrisma(makeAddJob());
    const getGroupParticipants = jest.fn().mockResolvedValue({
      participants: [{ id: `${PHONE}@s.whatsapp.net`, admin: null }],
    });
    const { worker } = makeWorker(prisma, {
      addGroupParticipants: jest.fn().mockResolvedValue({
        added: [{ jid: PHONE, status: '200' }],
        failed: [],
        participants: [],
      }),
      getGroupParticipants,
      isMemberInList,
    });

    await worker.process(JOB);

    expect(getGroupParticipants).toHaveBeenCalled();
    expect(statusOf(prisma)).toBe('DONE');
  });

  it('mantém DONE quando não dá para confirmar — não inventa NOT_JOINED', async () => {
    const prisma = makePrisma(makeAddJob());
    const { worker } = makeWorker(prisma, {
      addGroupParticipants: jest.fn().mockResolvedValue({
        added: [{ jid: PHONE, status: '200' }],
        failed: [],
        participants: [],
      }),
      getGroupParticipants: jest.fn().mockRejectedValue(new Error('timeout')),
      isMemberInList,
    });

    await worker.process(JOB);

    expect(statusOf(prisma)).toBe('DONE');
  });

  it('não chama a lista de reserva quando a resposta já trouxe participantes', async () => {
    const prisma = makePrisma(makeAddJob());
    const getGroupParticipants = jest.fn();
    const { worker } = makeWorker(prisma, {
      addGroupParticipants: jest.fn().mockResolvedValue({
        added: [{ jid: PHONE, status: '200' }],
        failed: [],
        participants: [`${PHONE}@s.whatsapp.net`],
      }),
      getGroupParticipants,
      isMemberInList,
    });

    await worker.process(JOB);

    expect(getGroupParticipants).not.toHaveBeenCalled();
  });

  it('envia convite quando não entrou e o convite automático está ligado', async () => {
    const prisma = makePrisma(
      makeAddJob({
        send_invite_on_fail: true,
        invite_link: 'https://chat.whatsapp.com/abc',
      }),
    );
    const sendText = jest.fn().mockResolvedValue({});
    const { worker } = makeWorker(prisma, {
      addGroupParticipants: jest.fn().mockResolvedValue({
        added: [{ jid: PHONE, status: '200' }],
        failed: [],
        participants: ['5599999999999@s.whatsapp.net'],
      }),
      sendText,
      isMemberInList,
    });

    await worker.process(JOB);

    expect(sendText).toHaveBeenCalled();
    const [, to, text] = sendText.mock.calls[0] as [string, string, string];
    expect(to).toBe(PHONE);
    expect(text).toContain('https://chat.whatsapp.com/abc');
  });
});
