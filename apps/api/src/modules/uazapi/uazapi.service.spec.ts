import { ConfigService } from '@nestjs/config';
import { UazApiService } from './uazapi.service';

/**
 * Resposta real capturada em producao: a UazAPI responde a adicao com o objeto
 * do grupo atualizado, aninhado sob `group` e com chaves em PascalCase.
 */
const REAL_GROUP_RESPONSE = {
  group: {
    JID: '120363041378673958@g.us',
    OwnerJID: '',
    Name: '#SITE GALERIA DE BOLEIRO',
    NameSetAt: '2026-05-05T16:07:30Z',
    Topic: 'Clube Galeria | VIP',
    Participants: [
      { JID: '5511947943404@s.whatsapp.net', IsAdmin: false },
      { JID: '553791338489@s.whatsapp.net', IsAdmin: true },
    ],
  },
};

function mockFetch(status: number, body: unknown): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('UazApiService', () => {
  let service: UazApiService;

  beforeEach(() => {
    const config = {
      get: (_key: string, fallback: string) => fallback,
    } as unknown as ConfigService;
    service = new UazApiService(config);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('addGroupParticipants', () => {
    it('trata a resposta com objeto de grupo em PascalCase como sucesso', async () => {
      mockFetch(200, REAL_GROUP_RESPONSE);

      const result = await service.addGroupParticipants('token', 'g@g.us', [
        '5511947943404',
      ]);

      expect(result.added.map((r) => r.jid)).toContain('5511947943404');
      expect(result.failed).toHaveLength(0);
    });

    it('trata o objeto de grupo na raiz, sem envelope', async () => {
      mockFetch(200, REAL_GROUP_RESPONSE.group);

      const result = await service.addGroupParticipants('token', 'g@g.us', [
        '5511947943404',
      ]);

      expect(result.added).toHaveLength(1);
    });

    it('continua entendendo o formato com listas add/failed', async () => {
      mockFetch(200, {
        added: [{ jid: '5511111111111', status: '200' }],
        failed: [{ jid: '5522222222222', status: '403' }],
      });

      const result = await service.addGroupParticipants('token', 'g@g.us', [
        '5511111111111',
        '5522222222222',
      ]);

      expect(result.added).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
    });

    it('continua entendendo a lista solta de resultados', async () => {
      mockFetch(200, [
        { jid: '5511111111111', status: '200' },
        { jid: '5522222222222', status: '403' },
      ]);

      const result = await service.addGroupParticipants('token', 'g@g.us', [
        '5511111111111',
        '5522222222222',
      ]);

      expect(result.added).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
    });

    it('lanca com o corpo cru quando o formato e realmente desconhecido', async () => {
      mockFetch(200, { totalmente: 'inesperado' });

      await expect(
        service.addGroupParticipants('token', 'g@g.us', ['5511111111111']),
      ).rejects.toThrow(/formato desconhecido/);
    });

    it('lanca quando a API responde erro HTTP', async () => {
      mockFetch(405, { message: 'Method Not Allowed' });

      await expect(
        service.addGroupParticipants('token', 'g@g.us', ['5511111111111']),
      ).rejects.toThrow(/Method Not Allowed/);
    });
  });
});
