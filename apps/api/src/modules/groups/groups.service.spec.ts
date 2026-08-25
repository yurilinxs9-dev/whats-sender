import { NotFoundException } from '@nestjs/common';
import { GroupsService } from './groups.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UazApiService } from '../uazapi/uazapi.service';
import { ProviderResolver } from '../whatsapp/provider-resolver.service';
import { SenderGateway } from '../websocket/websocket.gateway';
import { Queue } from 'bullmq';
import { GroupAddJobData } from '../queues/workers/group-add.worker';

const JOB = { id: 'job-1', tenant_id: 't1', nome: 'Teste' };

type PrismaStub = {
  groupAddJob: { findFirst: jest.Mock; update?: jest.Mock };
  addTarget: { groupBy: jest.Mock; findMany: jest.Mock; count: jest.Mock };
  instance?: { findFirst: jest.Mock };
};

function makeService(prisma: PrismaStub) {
  return new GroupsService(
    prisma as unknown as PrismaService,
    {} as UazApiService,
    {
      resolve: (config: unknown) =>
        config && (config as { uazapi_token?: string }).uazapi_token
          ? { provider: {}, credential: 'tok' }
          : null,
    } as unknown as ProviderResolver,
    {} as SenderGateway,
    {} as Queue<GroupAddJobData>,
  );
}

function makePrisma(overrides: Partial<PrismaStub> = {}): PrismaStub {
  return {
    groupAddJob: { findFirst: jest.fn().mockResolvedValue(JOB) },
    addTarget: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    ...overrides,
  };
}

const CONNECTED = {
  id: '11111111-1111-1111-1111-111111111111',
  status: 'connected',
  config: { uazapi_token: 'tok' },
};

function makeUpdatePrisma(
  job: Record<string, unknown>,
  instance: Record<string, unknown> | null,
) {
  return {
    groupAddJob: {
      findFirst: jest.fn().mockResolvedValue(job),
      update: jest.fn().mockResolvedValue(job),
    },
    addTarget: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    instance: { findFirst: jest.fn().mockResolvedValue(instance) },
  } as unknown as PrismaStub;
}

describe('GroupsService', () => {
  describe('updateAddJob — troca de instância', () => {
    const JOB_IDLE = {
      ...JOB,
      status: 'IDLE',
      dest_instance_id: '22222222-2222-2222-2222-222222222222',
    };

    it('troca a instância quando o job está parado e a nova está conectada', async () => {
      const prisma = makeUpdatePrisma(JOB_IDLE, CONNECTED);

      await makeService(prisma).updateAddJob('t1', 'job-1', {
        dest_instance_id: CONNECTED.id,
      });

      const data = (prisma.groupAddJob.update as unknown as jest.Mock).mock
        .calls[0][0].data as Record<string, unknown>;
      expect(data.dest_instance_id).toBe(CONNECTED.id);
    });

    it('recusa trocar com o job rodando', async () => {
      const prisma = makeUpdatePrisma(
        { ...JOB_IDLE, status: 'RUNNING' },
        CONNECTED,
      );

      await expect(
        makeService(prisma).updateAddJob('t1', 'job-1', {
          dest_instance_id: CONNECTED.id,
        }),
      ).rejects.toThrow(/Pause o job/);
    });

    it('recusa instância desconectada', async () => {
      const prisma = makeUpdatePrisma(JOB_IDLE, {
        ...CONNECTED,
        status: 'disconnected',
      });

      await expect(
        makeService(prisma).updateAddJob('t1', 'job-1', {
          dest_instance_id: CONNECTED.id,
        }),
      ).rejects.toThrow(/conectada/);
    });

    it('recusa instância de outro tenant', async () => {
      const prisma = makeUpdatePrisma(JOB_IDLE, null);

      await expect(
        makeService(prisma).updateAddJob('t1', 'job-1', {
          dest_instance_id: CONNECTED.id,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('não checa instância quando o job só muda o ritmo', async () => {
      const prisma = makeUpdatePrisma({ ...JOB_IDLE, status: 'RUNNING' }, null);

      await makeService(prisma).updateAddJob('t1', 'job-1', {
        per_run_limit: 10,
      });

      expect(
        (prisma.instance as unknown as { findFirst: jest.Mock }).findFirst,
      ).not.toHaveBeenCalled();
    });
  });

  describe('updateAddJob — instância evolution', () => {
    it('aceita trocar para uma instância do Evolution, que não tem token', async () => {
      const prisma = makeUpdatePrisma(
        {
          ...JOB,
          status: 'IDLE',
          dest_instance_id: '22222222-2222-2222-2222-222222222222',
        },
        {
          id: '11111111-1111-1111-1111-111111111111',
          status: 'connected',
          config: { provider: 'evolution', evolution_instance: 'grupos-01' },
        },
      );
      const service = new GroupsService(
        prisma as unknown as PrismaService,
        {} as UazApiService,
        {
          resolve: (config: unknown) => {
            const c = config as Record<string, unknown> | null;
            if (c?.provider === 'evolution')
              return { provider: {}, credential: c.evolution_instance };
            if (c?.uazapi_token) return { provider: {}, credential: 'tok' };
            return null;
          },
        } as unknown as ProviderResolver,
        {} as SenderGateway,
        {} as Queue<GroupAddJobData>,
      );

      await service.updateAddJob('t1', 'job-1', {
        dest_instance_id: '11111111-1111-1111-1111-111111111111',
      });

      const data = (prisma.groupAddJob.update as unknown as jest.Mock).mock
        .calls[0][0].data as Record<string, unknown>;
      expect(data.dest_instance_id).toBe(
        '11111111-1111-1111-1111-111111111111',
      );
    });
  });

  describe('getAddJob', () => {
    it('não carrega a lista de alvos no detalhe do job', async () => {
      const prisma = makePrisma();
      const job = await makeService(prisma).getAddJob('t1', 'job-1');

      expect(job).not.toHaveProperty('targets');
      const args = prisma.groupAddJob.findFirst.mock.calls[0][0] as {
        include: Record<string, unknown>;
      };
      expect(args.include).not.toHaveProperty('targets');
    });

    it('devolve a contagem por status agregada no banco', async () => {
      const prisma = makePrisma();
      prisma.addTarget.groupBy
        .mockResolvedValueOnce([
          { status: 'DONE', _count: { _all: 12 } },
          { status: 'FAILED', _count: { _all: 3 } },
        ])
        .mockResolvedValueOnce([]);

      const job = (await makeService(prisma).getAddJob('t1', 'job-1')) as {
        counts: Record<string, number>;
      };

      expect(job.counts.DONE).toBe(12);
      expect(job.counts.FAILED).toBe(3);
      expect(prisma.addTarget.groupBy).toHaveBeenCalled();
    });

    it('devolve os motivos de falha agregados, sem trazer os alvos', async () => {
      const prisma = makePrisma();
      prisma.addTarget.groupBy
        .mockResolvedValueOnce([{ status: 'FAILED', _count: { _all: 2 } }])
        .mockResolvedValueOnce([
          { error: 'privacidade bloqueia', _count: { _all: 2 } },
        ]);

      const job = (await makeService(prisma).getAddJob('t1', 'job-1')) as {
        failure_reasons: { reason: string; count: number }[];
      };

      expect(job.failure_reasons).toEqual([
        { reason: 'privacidade bloqueia', count: 2 },
      ]);
    });

    it('falha quando o job não é do tenant', async () => {
      const prisma = makePrisma();
      prisma.groupAddJob.findFirst.mockResolvedValue(null);

      await expect(
        makeService(prisma).getAddJob('outro-tenant', 'job-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listAddTargets', () => {
    it('devolve uma página de alvos com o total', async () => {
      const prisma = makePrisma();
      prisma.addTarget.findMany.mockResolvedValue([
        { id: 'a', phone: '5511999999999', status: 'DONE' },
      ]);
      prisma.addTarget.count.mockResolvedValue(857);

      const page = await makeService(prisma).listAddTargets('t1', 'job-1', {
        page: 1,
        page_size: 50,
      });

      expect(page.total).toBe(857);
      expect(page.items).toHaveLength(1);
      expect(page.page).toBe(1);
    });

    it('limita a consulta ao tamanho da página pedido', async () => {
      const prisma = makePrisma();

      await makeService(prisma).listAddTargets('t1', 'job-1', {
        page: 3,
        page_size: 25,
      });

      const args = prisma.addTarget.findMany.mock.calls[0][0] as {
        take: number;
        skip: number;
      };
      expect(args.take).toBe(25);
      expect(args.skip).toBe(50);
    });

    it('filtra por status quando pedido', async () => {
      const prisma = makePrisma();

      await makeService(prisma).listAddTargets('t1', 'job-1', {
        page: 1,
        page_size: 50,
        status: 'FAILED',
      });

      const args = prisma.addTarget.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(args.where.status).toBe('FAILED');
    });

    it('aceita filtrar por quem não entrou no grupo', async () => {
      const prisma = makePrisma();

      await makeService(prisma).listAddTargets('t1', 'job-1', {
        page: 1,
        page_size: 50,
        status: 'NOT_JOINED',
      });

      const args = prisma.addTarget.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(args.where.status).toBe('NOT_JOINED');
    });

    it('falha quando o job não é do tenant', async () => {
      const prisma = makePrisma();
      prisma.groupAddJob.findFirst.mockResolvedValue(null);

      await expect(
        makeService(prisma).listAddTargets('outro-tenant', 'job-1', {
          page: 1,
          page_size: 50,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
