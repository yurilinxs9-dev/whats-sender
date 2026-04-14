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
