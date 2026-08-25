import { BadRequestException } from '@nestjs/common';
import { InstancesService } from './instances.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UazApiService } from '../uazapi/uazapi.service';
import { SenderGateway } from '../websocket/websocket.gateway';

const INSTANCE = { id: 'i1', nome: 'rafhtest1', tenant_id: 't1', config: {} };

function makeService(jobs: { nome: string }[]) {
  const prisma = {
    instance: {
      findFirst: jest.fn().mockResolvedValue(INSTANCE),
      delete: jest.fn().mockResolvedValue(INSTANCE),
    },
    groupAddJob: { findMany: jest.fn().mockResolvedValue(jobs) },
    dispatch: { updateMany: jest.fn() },
    campaignInstance: { deleteMany: jest.fn() },
    buddyPair: { deleteMany: jest.fn() },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const service = new InstancesService(
    prisma as unknown as PrismaService,
    { emitInstanceStatusChanged: jest.fn() } as unknown as SenderGateway,
    {} as UazApiService,
  );
  return { service, prisma };
}

describe('InstancesService.remove', () => {
  it('recusa remover instância usada por jobs de adição, dizendo quais', async () => {
    const { service, prisma } = makeService([
      { nome: 'Teste novo2408' },
      { nome: 'Teste24082' },
    ]);

    await expect(service.remove('i1', 't1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.remove('i1', 't1')).rejects.toThrow(
      /Teste novo2408.*Teste24082/,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('remove quando nenhum job usa a instância', async () => {
    const { service, prisma } = makeService([]);

    await service.remove('i1', 't1');

    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
