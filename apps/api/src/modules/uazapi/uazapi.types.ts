export interface UazApiResponse {
  success: boolean;
  messageId?: string;
  error?: string;
  responseTimeMs: number;
}

export interface UazApiNumberCheck {
  exists: boolean;
  jid?: string;
}

export interface UazApiInstanceStatus {
  state: 'connected' | 'disconnected' | 'connecting';
  qrcode?: string;
  profileName?: string;
  owner?: string;
}

export interface UazApiCreateInstanceResult {
  name: string;
  token: string;
  status: string;
}

export interface UazApiGroup {
  id: string; // JID: 120363...@g.us
  subject: string; // group name
  size: number;
}

export interface UazApiGroupParticipant {
  id: string; // JID: 5511999...@s.whatsapp.net
  admin: string | null;
}

export interface UazApiGroupParticipantsResult {
  participants: UazApiGroupParticipant[];
}

export interface UazApiAddParticipantsResult {
  added: { jid: string; status: string }[];
  failed: { jid: string; status: string }[];
  /**
   * JIDs presentes no grupo depois da escrita, quando a API devolve o grupo
   * atualizado. Vazio quando a resposta nao traz a lista — a confirmacao de
   * entrada entao precisa de outra fonte.
   */
  participants: string[];
}
