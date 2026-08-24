import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  UazApiResponse,
  UazApiNumberCheck,
  UazApiInstanceStatus,
  UazApiCreateInstanceResult,
  UazApiGroup,
  UazApiGroupParticipantsResult,
  UazApiAddParticipantsResult,
} from './uazapi.types';

const DEFAULT_TIMEOUT_MS = 15_000;

@Injectable()
export class UazApiService {
  private readonly baseUrl: string;
  private readonly adminToken: string;
  private readonly logger = new Logger(UazApiService.name);

  constructor(private config: ConfigService) {
    this.baseUrl = this.config
      .get<string>('UAZAPI_URL', 'http://localhost:8080')
      .replace(/\/+$/, '');
    this.adminToken = this.config.get<string>('UAZAPI_GLOBAL_TOKEN', '');
  }

  /* ------------------------------------------------------------------ */
  /*  Instance management (admin token)                                  */
  /* ------------------------------------------------------------------ */

  async createInstance(name: string): Promise<UazApiCreateInstanceResult> {
    const res = await this.request('/instance/create', {
      method: 'POST',
      tokenType: 'admin',
      body: { name },
    });

    const data = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      const msg =
        typeof data.message === 'string' ? data.message : `HTTP ${res.status}`;
      throw new Error(`UazAPI createInstance failed: ${msg}`);
    }

    const instance = data.instance as Record<string, unknown> | undefined;
    return {
      name: (data.name as string) || name,
      token: (data.token as string) || (instance?.token as string) || '',
      status: (instance?.status as string) || 'disconnected',
    };
  }

  async listInstances(): Promise<Record<string, unknown>[]> {
    const res = await this.request('/instance/all', {
      method: 'GET',
      tokenType: 'admin',
    });
    const data = await res.json();
    return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  }

  /* ------------------------------------------------------------------ */
  /*  Instance connection (instance token)                               */
  /* ------------------------------------------------------------------ */

  async connectInstance(instanceToken: string): Promise<UazApiInstanceStatus> {
    const res = await this.request('/instance/connect', {
      method: 'POST',
      tokenType: 'instance',
      token: instanceToken,
      body: {},
    });

    const data = (await res.json()) as Record<string, unknown>;
    const instance = (data.instance as Record<string, unknown>) || {};

    return {
      state: this.parseState(instance.status as string),
      qrcode:
        typeof instance.qrcode === 'string' && instance.qrcode.length > 10
          ? instance.qrcode
          : undefined,
      profileName:
        typeof instance.profileName === 'string'
          ? instance.profileName
          : undefined,
      owner: typeof instance.owner === 'string' ? instance.owner : undefined,
    };
  }

  async getInstanceStatus(
    instanceToken: string,
  ): Promise<UazApiInstanceStatus> {
    const res = await this.request('/instance/status', {
      method: 'GET',
      tokenType: 'instance',
      token: instanceToken,
    });

    const data = (await res.json()) as Record<string, unknown>;
    const instance = (data.instance as Record<string, unknown>) || {};
    const status = (data.status as Record<string, unknown>) || {};

    return {
      state:
        status.connected === true
          ? 'connected'
          : this.parseState(instance.status as string),
      qrcode:
        typeof instance.qrcode === 'string' && instance.qrcode.length > 10
          ? instance.qrcode
          : undefined,
      profileName:
        typeof instance.profileName === 'string'
          ? instance.profileName
          : undefined,
      owner: typeof instance.owner === 'string' ? instance.owner : undefined,
    };
  }

  async logoutInstance(instanceToken: string): Promise<void> {
    try {
      await this.request('/instance/logout', {
        method: 'DELETE',
        tokenType: 'instance',
        token: instanceToken,
      });
    } catch (err) {
      this.logger.warn(
        `UazAPI logout failed (ignored): ${(err as Error).message}`,
      );
    }
  }

  async connectWithPairingCode(
    instanceToken: string,
    phoneNumber: string,
  ): Promise<{ pairingCode: string; state: string }> {
    const res = await this.request('/instance/pairingcode', {
      method: 'POST',
      tokenType: 'instance',
      token: instanceToken,
      body: { number: phoneNumber },
    });

    const data = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      const msg =
        typeof data.message === 'string' ? data.message : `HTTP ${res.status}`;
      throw new Error(`UazAPI pairingCode failed: ${msg}`);
    }

    return {
      pairingCode: (data.pairingCode as string) || (data.code as string) || '',
      state: (data.state as string) || 'connecting',
    };
  }

  async deleteInstance(instanceToken: string): Promise<void> {
    await this.request('/instance', {
      method: 'DELETE',
      tokenType: 'instance',
      token: instanceToken,
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Chat endpoints (instance token)                                    */
  /* ------------------------------------------------------------------ */

  async sendText(
    instanceToken: string,
    to: string,
    text: string,
  ): Promise<UazApiResponse> {
    return this.postChat(instanceToken, '/send/text', { number: to, text });
  }

  async sendImage(
    instanceToken: string,
    to: string,
    imageUrl: string,
    caption?: string,
  ): Promise<UazApiResponse> {
    return this.postChat(instanceToken, '/send/image', {
      number: to,
      image: { url: imageUrl },
      ...(caption && { caption }),
    });
  }

  async sendVideo(
    instanceToken: string,
    to: string,
    videoUrl: string,
    caption?: string,
  ): Promise<UazApiResponse> {
    return this.postChat(instanceToken, '/send/video', {
      number: to,
      video: { url: videoUrl },
      ...(caption && { caption }),
    });
  }

  async sendAudio(
    instanceToken: string,
    to: string,
    audioUrl: string,
  ): Promise<UazApiResponse> {
    return this.postChat(instanceToken, '/send/audio', {
      number: to,
      audio: { url: audioUrl },
    });
  }

  async sendDocument(
    instanceToken: string,
    to: string,
    documentUrl: string,
    fileName?: string,
  ): Promise<UazApiResponse> {
    return this.postChat(instanceToken, '/send/document', {
      number: to,
      document: { url: documentUrl },
      ...(fileName && { fileName }),
    });
  }

  async checkNumber(
    instanceToken: string,
    number: string,
  ): Promise<UazApiNumberCheck> {
    try {
      const res = await this.request('/chat/check-number', {
        method: 'POST',
        tokenType: 'instance',
        token: instanceToken,
        body: { number },
      });
      const data = (await res.json()) as Record<string, unknown>;
      return {
        exists: !!data.exists,
        jid: typeof data.jid === 'string' ? data.jid : undefined,
      };
    } catch (error) {
      this.logger.error(
        `checkNumber failed for ${number}: ${(error as Error).message}`,
      );
      return { exists: false };
    }
  }

  async setPresence(
    instanceToken: string,
    to: string,
    presence: 'composing' | 'recording' | 'available',
  ): Promise<void> {
    try {
      await this.request('/chat/presence', {
        method: 'POST',
        tokenType: 'instance',
        token: instanceToken,
        body: { number: to, presence },
      });
    } catch (error) {
      this.logger.error(`setPresence failed: ${(error as Error).message}`);
    }
  }

  async setWebhook(instanceToken: string, url: string): Promise<void> {
    await this.request('/webhook', {
      method: 'POST',
      tokenType: 'instance',
      token: instanceToken,
      body: {
        url,
        events: ['messages', 'connection', 'messages_update'],
        excludeMessages: ['wasSentByApi'],
        enabled: true,
      },
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Group endpoints (instance token)                                  */
  /* ------------------------------------------------------------------ */

  // UazAPI: GET /group/list — returns all groups the instance participates in
  async listGroups(instanceToken: string): Promise<UazApiGroup[]> {
    const res = await this.request('/group/list', {
      method: 'GET',
      tokenType: 'instance',
      token: instanceToken,
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const msg =
        typeof data.message === 'string' ? data.message : `HTTP ${res.status}`;
      throw new Error(`UazAPI listGroups failed: ${msg}`);
    }
    const raw = Array.isArray(data)
      ? data
      : Array.isArray(data.groups)
        ? data.groups
        : [];
    // UazAPI retorna PascalCase: JID, Name, Participants[]. ParticipantCount vem 0
    // (não confiável) → contar pelo array Participants. Mantém fallbacks p/ outras versões.
    return (raw as Record<string, unknown>[]).map((g) => {
      const participants = Array.isArray(g.Participants) ? g.Participants : [];
      const size =
        participants.length ||
        (typeof g.ParticipantCount === 'number' ? g.ParticipantCount : 0) ||
        (typeof g.size === 'number' ? g.size : 0);
      return {
        id: (g.JID ?? g.id ?? '') as string,
        subject: (g.Name ?? g.subject ?? g.name ?? g.title ?? '') as string,
        size,
      };
    });
  }

  // Não existe /group/participants nesta UazAPI (404). /group/list?force=true
  // retorna TODOS os grupos com Participants[] completos (testado p/ grupos de 1800+).
  async getGroupParticipants(
    instanceToken: string,
    groupJid: string,
  ): Promise<UazApiGroupParticipantsResult> {
    const res = await this.request('/group/list?force=true', {
      method: 'GET',
      tokenType: 'instance',
      token: instanceToken,
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const msg =
        typeof data.message === 'string' ? data.message : `HTTP ${res.status}`;
      throw new Error(`UazAPI getGroupParticipants failed: ${msg}`);
    }
    const groups = (
      Array.isArray(data) ? data : Array.isArray(data.groups) ? data.groups : []
    ) as Record<string, unknown>[];
    const group = groups.find((g) => (g.JID ?? g.id) === groupJid);
    if (!group) {
      throw new Error(`Grupo ${groupJid} não encontrado na lista da instância`);
    }
    const raw = Array.isArray(group.Participants) ? group.Participants : [];
    return {
      participants: (raw as Record<string, unknown>[]).map((p) => {
        const phone =
          typeof p.PhoneNumber === 'string'
            ? p.PhoneNumber.replace(/@.*$/, '')
            : '';
        const id = (phone || p.JID || p.LID || p.id || '') as string;
        const admin = p.IsSuperAdmin
          ? 'superadmin'
          : p.IsAdmin
            ? 'admin'
            : typeof p.admin === 'string'
              ? p.admin
              : null;
        return { id, admin };
      }),
    };
  }

  // UazAPI: POST /group/updateParticipants (case-sensitive).
  // /group/participants so aceita GET — era ele que devolvia 405.
  // Rotas confirmadas por OPTIONS neste host: updateParticipants, join,
  // create, list, info, inviteInfo, leave, updateName.
  async addGroupParticipants(
    instanceToken: string,
    groupJid: string,
    participantJids: string[],
  ): Promise<UazApiAddParticipantsResult> {
    const res = await this.request('/group/updateParticipants', {
      method: 'POST',
      tokenType: 'instance',
      token: instanceToken,
      body: {
        groupjid: groupJid,
        action: 'add',
        participants: participantJids,
      },
    });
    const raw = await res.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      data = {};
    }
    if (!res.ok) {
      // Corpo cru no erro: o formato exato do payload ainda nao foi validado
      // contra uma adicao real, e a mensagem da API e quem diz o que falta.
      const msg =
        typeof data.message === 'string' ? data.message : `HTTP ${res.status}`;
      throw new Error(
        `UazAPI addGroupParticipants failed: ${msg} — resposta: ${raw.slice(0, 300)}`,
      );
    }
    // A resposta varia por versao: {add,failed}, {added,failed} ou uma lista
    // solta de resultados. Normaliza as tres antes de decidir sucesso.
    const pick = (...keys: string[]): Record<string, unknown>[] => {
      for (const k of keys) {
        if (Array.isArray(data[k])) return data[k] as Record<string, unknown>[];
      }
      return [];
    };
    const norm = (r: Record<string, unknown>) => ({
      jid: (r.jid ?? r.id ?? r.participant ?? '') as string,
      status: String(r.status ?? r.code ?? ''),
    });

    let added = pick('add', 'added', 'participants').map(norm);
    let failed = pick('failed', 'errors').map(norm);

    // Lista solta: separa pelo status de cada item.
    if (added.length === 0 && failed.length === 0 && Array.isArray(data)) {
      const all = (data as Record<string, unknown>[]).map(norm);
      added = all.filter((r) => r.status === '200' || r.status === 'success');
      failed = all.filter(
        (r) => !(r.status === '200' || r.status === 'success'),
      );
    }

    // Formato observado em producao: a API devolve o grupo atualizado, aninhado
    // sob `group` e em PascalCase (mesmo shape de /group/list). Receber o grupo
    // de volta e a confirmacao de que a escrita foi aceita.
    if (added.length === 0 && failed.length === 0) {
      const group = this.isGroupObject(data.group) ? data.group : data;
      if (this.isGroupObject(group)) {
        added = participantJids.map((jid) => ({ jid, status: '200' }));
      }
    }

    if (added.length === 0 && failed.length === 0) {
      // Nao reconhecido: falhar alto com o corpo cru e melhor que reportar
      // sucesso falso — o alvo pode ser re-tentado pelo painel.
      throw new Error(
        `UazAPI addGroupParticipants: resposta em formato desconhecido — ${raw.slice(0, 300)}`,
      );
    }
    return { added, failed };
  }

  /* ------------------------------------------------------------------ */
  /*  Internal helpers                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Um objeto de grupo da UazAPI: PascalCase, identificado por JID e com a
   * lista de participantes junto. Exigir os dois evita confundir com um
   * envelope de erro que por acaso tenha uma dessas chaves.
   */
  private isGroupObject(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false;
    const g = value as Record<string, unknown>;
    return typeof g.JID === 'string' && Array.isArray(g.Participants);
  }

  private parseState(raw: string | undefined): UazApiInstanceStatus['state'] {
    if (raw === 'connected' || raw === 'open') return 'connected';
    if (raw === 'connecting') return 'connecting';
    return 'disconnected';
  }

  private async postChat(
    instanceToken: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<UazApiResponse> {
    const start = Date.now();
    try {
      const res = await this.request(path, {
        method: 'POST',
        tokenType: 'instance',
        token: instanceToken,
        body,
      });
      const data = (await res.json()) as Record<string, unknown>;
      const responseTimeMs = Date.now() - start;

      if (!res.ok) {
        return {
          success: false,
          error:
            typeof data.message === 'string'
              ? data.message
              : `HTTP ${res.status}`,
          responseTimeMs,
        };
      }
      return {
        success: true,
        messageId:
          typeof data.messageId === 'string' ? data.messageId : undefined,
        responseTimeMs,
      };
    } catch (error) {
      const responseTimeMs = Date.now() - start;
      return {
        success: false,
        error: (error as Error).message,
        responseTimeMs,
      };
    }
  }

  private async request(
    path: string,
    opts: {
      method: 'GET' | 'POST' | 'PUT' | 'DELETE';
      tokenType: 'admin' | 'instance';
      token?: string;
      body?: Record<string, unknown>;
    },
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (opts.tokenType === 'admin') {
      headers['admintoken'] = this.adminToken;
    } else {
      headers['token'] = opts.token || this.adminToken;
    }

    try {
      return await fetch(url, {
        method: opts.method,
        headers,
        ...(opts.body && { body: JSON.stringify(opts.body) }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
