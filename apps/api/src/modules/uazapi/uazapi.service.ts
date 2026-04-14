import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  UazApiResponse,
  UazApiNumberCheck,
  UazApiInstanceStatus,
  UazApiCreateInstanceResult,
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
      const msg = typeof data.message === 'string' ? data.message : `HTTP ${res.status}`;
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
    return Array.isArray(data) ? data as Record<string, unknown>[] : [];
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
      qrcode: typeof instance.qrcode === 'string' && instance.qrcode.length > 10
        ? instance.qrcode
        : undefined,
      profileName: typeof instance.profileName === 'string' ? instance.profileName : undefined,
      owner: typeof instance.owner === 'string' ? instance.owner : undefined,
    };
  }

  async getInstanceStatus(instanceToken: string): Promise<UazApiInstanceStatus> {
    const res = await this.request('/instance/status', {
      method: 'GET',
      tokenType: 'instance',
      token: instanceToken,
    });

    const data = (await res.json()) as Record<string, unknown>;
    const instance = (data.instance as Record<string, unknown>) || {};
    const status = (data.status as Record<string, unknown>) || {};

    return {
      state: status.connected === true ? 'connected' : this.parseState(instance.status as string),
      qrcode: typeof instance.qrcode === 'string' && instance.qrcode.length > 10
        ? instance.qrcode
        : undefined,
      profileName: typeof instance.profileName === 'string' ? instance.profileName : undefined,
      owner: typeof instance.owner === 'string' ? instance.owner : undefined,
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
      return { exists: !!data.exists, jid: typeof data.jid === 'string' ? data.jid : undefined };
    } catch (error) {
      this.logger.error(`checkNumber failed for ${number}: ${(error as Error).message}`);
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
  /*  Internal helpers                                                   */
  /* ------------------------------------------------------------------ */

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
          error: typeof data.message === 'string' ? data.message : `HTTP ${res.status}`,
          responseTimeMs,
        };
      }
      return {
        success: true,
        messageId: typeof data.messageId === 'string' ? data.messageId : undefined,
        responseTimeMs,
      };
    } catch (error) {
      const responseTimeMs = Date.now() - start;
      return { success: false, error: (error as Error).message, responseTimeMs };
    }
  }

  private async request(
    path: string,
    opts: {
      method: 'GET' | 'POST' | 'DELETE';
      tokenType: 'admin' | 'instance';
      token?: string;
      body?: Record<string, unknown>;
    },
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
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
