import { ConfigService } from '@nestjs/config';
import { UazApiService } from './uazapi.service';

function mockFetch(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

describe('UazApiService — confirmação de entrada', () => {
  let service: UazApiService;

  beforeEach(() => {
    service = new UazApiService({
      get: (_k: string, fallback: string) => fallback,
    } as unknown as ConfigService);
  });

  it('devolve os participantes que vieram na resposta da adição', async () => {
    mockFetch(200, {
      group: {
        JID: 'g@g.us',
        Participants: [
          { JID: '5511947943404@s.whatsapp.net' },
          { JID: '553791338489@s.whatsapp.net' },
        ],
      },
    });

    const result = await service.addGroupParticipants('t', 'g@g.us', [
      '5511947943404',
    ]);

    expect(result.participants).toEqual([
      '5511947943404@s.whatsapp.net',
      '553791338489@s.whatsapp.net',
    ]);
  });

  it('devolve lista vazia quando a resposta não traz participantes', async () => {
    mockFetch(200, {
      added: [{ jid: '5511947943404', status: '200' }],
    });

    const result = await service.addGroupParticipants('t', 'g@g.us', [
      '5511947943404',
    ]);

    expect(result.participants).toEqual([]);
  });

  describe('isMemberInList', () => {
    const list = ['5511947943404@s.whatsapp.net', '553791338489@lid'];

    it('reconhece o membro pelo telefone puro', () => {
      expect(service.isMemberInList(list, '5511947943404')).toBe(true);
    });

    it('reconhece o membro pelo jid completo', () => {
      expect(service.isMemberInList(list, '5511947943404@s.whatsapp.net')).toBe(
        true,
      );
    });

    it('não reconhece quem não está na lista', () => {
      expect(service.isMemberInList(list, '5599999999999')).toBe(false);
    });

    it('não reconhece nada em lista vazia', () => {
      expect(service.isMemberInList([], '5511947943404')).toBe(false);
    });
  });
});
