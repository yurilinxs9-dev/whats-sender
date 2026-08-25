import { InstancesService } from './instances.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UazApiService } from '../uazapi/uazapi.service';
import { EvolutionService } from '../whatsapp/evolution.service';
import { SenderGateway } from '../websocket/websocket.gateway';

function makeService() {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    instance: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn(),
      create: jest.fn().mockImplementation((args: { data: unknown }) => {
        created.push(args.data as Record<string, unknown>);
        return Promise.resolve({ ...(args.data as object), id: 'i1' });
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const uazapi = {
    createInstance: jest
      .fn()
      .mockResolvedValue({ name: 'x', token: 'tok-uaz-123456', status: 'x' }),
    connectInstance: jest
      .fn()
      .mockResolvedValue({ state: 'connecting', qrcode: 'data:image/uaz' }),
  };
  const evolution = {
    createInstance: jest.fn().mockResolvedValue({ name: 'grupos-01' }),
    connectInstance: jest
      .fn()
      .mockResolvedValue({ qrcode: 'data:image/evo', pairingCode: null }),
    getConnectionState: jest.fn().mockResolvedValue('connecting'),
  };
  const service = new InstancesService(
    prisma as unknown as PrismaService,
    { emitInstanceStatusChanged: jest.fn() } as unknown as SenderGateway,
    uazapi as unknown as UazApiService,
    evolution as unknown as EvolutionService,
  );
  return { service, prisma, uazapi, evolution, created };
}

describe('InstancesService — escolha de provedor', () => {
  it('sem escolha, cria na UazAPI e guarda o token', async () => {
    const { service, uazapi, evolution, created } = makeService();

    await service.create({ nome: 'antiga', provider: 'uazapi' }, 't1');

    expect(uazapi.createInstance).toHaveBeenCalled();
    expect(evolution.createInstance).not.toHaveBeenCalled();
    expect(created[0].config).toEqual({
      uazapi_token: 'tok-uaz-123456',
      uazapi_instance_name: 'x',
    });
  });

  it('escolhendo evolution, cria lá e guarda o nome como credencial', async () => {
    const { service, uazapi, evolution, created } = makeService();

    await service.create({ nome: 'grupos-01', provider: 'evolution' }, 't1');

    expect(evolution.createInstance).toHaveBeenCalledWith('grupos-01');
    expect(uazapi.createInstance).not.toHaveBeenCalled();
    expect(created[0].config).toEqual({
      provider: 'evolution',
      evolution_instance: 'grupos-01',
    });
  });

  it('conectar instância evolution pede o QR ao Evolution', async () => {
    const { service, prisma, evolution, uazapi } = makeService();
    prisma.instance.findFirst.mockResolvedValue({
      id: 'i1',
      nome: 'grupos-01',
      config: { provider: 'evolution', evolution_instance: 'grupos-01' },
    });

    const r = (await service.connect('i1', 't1')) as { qrcode: string };

    expect(evolution.connectInstance).toHaveBeenCalledWith('grupos-01');
    expect(uazapi.connectInstance).not.toHaveBeenCalled();
    expect(r.qrcode).toBe('data:image/evo');
  });

  it('conectar instância antiga continua indo à UazAPI', async () => {
    const { service, prisma, evolution, uazapi } = makeService();
    prisma.instance.findFirst.mockResolvedValue({
      id: 'i1',
      nome: 'antiga',
      config: { uazapi_token: 'tok' },
    });

    await service.connect('i1', 't1');

    expect(uazapi.connectInstance).toHaveBeenCalledWith('tok');
    expect(evolution.connectInstance).not.toHaveBeenCalled();
  });
});
