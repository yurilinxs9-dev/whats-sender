import {
  UazApiGroup,
  UazApiGroupParticipantsResult,
} from '../uazapi/uazapi.types';

/**
 * O que o modulo de grupos precisa de um provedor de WhatsApp, sem assumir
 * qual e. UazAPI e Evolution expoem as mesmas capacidades com nomes, formatos
 * e credenciais diferentes; o resto do sistema fala com esta porta.
 *
 * `credential` e o que identifica a conta no provedor: token da instancia na
 * UazAPI, nome da instancia no Evolution.
 */
export interface WhatsAppProvider {
  readonly name: 'uazapi' | 'evolution';

  listGroups(credential: string): Promise<UazApiGroup[]>;

  getGroupParticipants(
    credential: string,
    groupJid: string,
  ): Promise<UazApiGroupParticipantsResult>;

  addGroupParticipants(
    credential: string,
    groupJid: string,
    participants: string[],
  ): Promise<AddParticipantsResult>;

  sendText(
    credential: string,
    to: string,
    text: string,
  ): Promise<{ success: boolean; error?: string }>;

  getConnectionState(
    credential: string,
  ): Promise<'connected' | 'connecting' | 'disconnected'>;

  /** Link de convite do grupo, quando o provedor souber obte-lo sozinho. */
  getInviteLink?(credential: string, groupJid: string): Promise<string | null>;

  /**
   * Um membro esta na lista? Cada provedor identifica participante a sua
   * maneira — telefone, JID, LID — e so ele sabe comparar as suas formas.
   */
  isMemberInList(participants: string[], member: string): boolean;
}

export interface AddParticipantsResult {
  added: { jid: string; status: string }[];
  failed: { jid: string; status: string }[];
  /** Quem esta no grupo depois da escrita, vazio quando o provedor nao diz. */
  participants: string[];
}
