import { ConfigService } from '@nestjs/config';
import { EvolutionService } from './evolution.service';

function mockFetch(status: number, body: unknown): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('EvolutionService', () => {
  let service: EvolutionService;

  beforeEach(() => {
    service = new EvolutionService({
      get: (_k: string, fallback: string) => fallback,
    } as unknown as ConfigService);
  });

  describe('getGroupParticipants', () => {
    it('usa o telefone como identidade, não o @lid', async () => {
      // Formato real do Evolution v2: id vem como @lid e o telefone fica em
      // phoneNumber. Guardar o @lid faria a conferência de entrada falhar,
      // como já aconteceu com o outro provedor.
      mockFetch(200, {
        participants: [
          {
            id: '50947019505814@lid',
            phoneNumber: '557799629204@s.whatsapp.net',
            admin: null,
          },
          {
            id: '60340683448572@lid',
            phoneNumber: '556599904955@s.whatsapp.net',
            admin: 'admin',
          },
        ],
      });

      const { participants } = await service.getGroupParticipants(
        'inst',
        'g@g.us',
      );

      expect(participants.map((p) => p.id)).toEqual([
        '557799629204',
        '556599904955',
      ]);
      expect(participants[1].admin).toBe('admin');
    });
  });

  describe('addGroupParticipants', () => {
    it('separa quem entrou de quem foi barrado pelo status de cada um', async () => {
      mockFetch(200, {
        updateParticipants: [
          { jid: '5511999999999@s.whatsapp.net', status: '200' },
          { jid: '5511888888888@s.whatsapp.net', status: '403' },
        ],
      });

      const r = await service.addGroupParticipants('inst', 'g@g.us', [
        '5511999999999',
        '5511888888888',
      ]);

      expect(r.added.map((a) => a.jid)).toEqual(['5511999999999']);
      expect(r.failed.map((f) => f.jid)).toEqual(['5511888888888']);
    });

    it('trata "já estava no grupo" como sucesso, não como falha', async () => {
      mockFetch(200, {
        updateParticipants: [
          { jid: '5511999999999@s.whatsapp.net', status: '409' },
        ],
      });

      const r = await service.addGroupParticipants('inst', 'g@g.us', [
        '5511999999999',
      ]);

      expect(r.added).toHaveLength(1);
      expect(r.failed).toHaveLength(0);
    });

    it('sem lista por participante, assume que o pedido aceito valeu', async () => {
      mockFetch(200, { message: 'ok' });

      const r = await service.addGroupParticipants('inst', 'g@g.us', ['5511']);

      expect(r.added).toHaveLength(1);
    });

    it('erro HTTP vira exceção com a mensagem do provedor', async () => {
      mockFetch(400, { message: 'group not found' });

      await expect(
        service.addGroupParticipants('inst', 'g@g.us', ['5511']),
      ).rejects.toThrow(/group not found/);
    });
  });

  describe('isMemberInList', () => {
    it('casa telefone com jid completo', () => {
      expect(
        service.isMemberInList(['557799629204@s.whatsapp.net'], '557799629204'),
      ).toBe(true);
    });

    it('não casa quem não está', () => {
      expect(service.isMemberInList(['557799629204'], '5511999999999')).toBe(
        false,
      );
    });
  });

  describe('getConnectionState', () => {
    it('traduz open para connected', async () => {
      mockFetch(200, { instance: { state: 'open' } });
      expect(await service.getConnectionState('inst')).toBe('connected');
    });

    it('instância inexistente vira disconnected em vez de estourar', async () => {
      mockFetch(404, { message: 'not found' });
      expect(await service.getConnectionState('inst')).toBe('disconnected');
    });
  });

  describe('getInviteLink', () => {
    it('devolve o link do grupo', async () => {
      mockFetch(200, {
        inviteUrl: 'https://chat.whatsapp.com/HdFtWJNEIqSEvufPyUeB2x',
        inviteCode: 'HdFtWJNEIqSEvufPyUeB2x',
      });

      expect(await service.getInviteLink('inst', 'g@g.us')).toBe(
        'https://chat.whatsapp.com/HdFtWJNEIqSEvufPyUeB2x',
      );
    });

    it('devolve null quando o provedor recusa, sem derrubar o fluxo', async () => {
      mockFetch(403, { message: 'not admin' });
      expect(await service.getInviteLink('inst', 'g@g.us')).toBeNull();
    });
  });
});
