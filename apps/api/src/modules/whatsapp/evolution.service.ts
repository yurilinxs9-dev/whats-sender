import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  UazApiGroup,
  UazApiGroupParticipantsResult,
} from '../uazapi/uazapi.types';
import { AddParticipantsResult, WhatsAppProvider } from './whatsapp-provider';

const TIMEOUT_MS = 20_000;

/**
 * Evolution API v2. Roda na nossa propria VPS, entao instancia nao some sem
 * aviso — foi o que motivou existir uma alternativa ao provedor de terceiro.
 *
 * A credencial aqui e o NOME da instancia: a autenticacao e uma chave global
 * no header, e a instancia vai no caminho da URL.
 */
@Injectable()
export class EvolutionService implements WhatsAppProvider {
  readonly name = 'evolution' as const;
  private readonly logger = new Logger(EvolutionService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: ConfigService) {
    this.baseUrl = config
      .get<string>('EVOLUTION_URL', 'http://evolution-api:8080')
      .replace(/\/+$/, '');
    this.apiKey = config.get<string>('EVOLUTION_API_KEY', '');
  }

  async listGroups(instance: string): Promise<UazApiGroup[]> {
    const data = await this.get<unknown>(
      `/group/fetchAllGroups/${encodeURIComponent(instance)}?getParticipants=false`,
    );
    const raw = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    return raw.map((g) => ({
      id: (g.id as string) ?? '',
      subject: (g.subject as string) ?? '',
      size: typeof g.size === 'number' ? g.size : 0,
    }));
  }

  async getGroupParticipants(
    instance: string,
    groupJid: string,
  ): Promise<UazApiGroupParticipantsResult> {
    const data = await this.get<{ participants?: unknown }>(
      `/group/participants/${encodeURIComponent(instance)}?groupJid=${encodeURIComponent(groupJid)}`,
    );
    const raw = Array.isArray(data.participants)
      ? (data.participants as Record<string, unknown>[])
      : [];
    return {
      participants: raw.map((p) => ({
        // O telefone e a identidade que o resto do sistema usa; `id` costuma
        // vir como @lid e nao casa com o alvo guardado como numero.
        id: this.localPart((p.phoneNumber as string) || (p.id as string) || ''),
        admin: typeof p.admin === 'string' ? p.admin : null,
      })),
    };
  }

  async addGroupParticipants(
    instance: string,
    groupJid: string,
    participants: string[],
  ): Promise<AddParticipantsResult> {
    const body = { action: 'add', participants };
    const data = await this.post<Record<string, unknown>>(
      `/group/updateParticipant/${encodeURIComponent(instance)}?groupJid=${encodeURIComponent(groupJid)}`,
      body,
    );

    // A resposta lista um resultado por participante, com o status HTTP do
    // WhatsApp em cada um: 200 entrou, 403 privacidade bloqueou, 409 ja estava.
    const rows = Array.isArray(data.updateParticipants)
      ? (data.updateParticipants as Record<string, unknown>[])
      : Array.isArray(data)
        ? (data as unknown as Record<string, unknown>[])
        : [];

    const added: { jid: string; status: string }[] = [];
    const failed: { jid: string; status: string }[] = [];
    for (const row of rows) {
      const jid = this.localPart((row.jid as string) ?? '');
      const status = String(row.status ?? '');
      if (status === '200' || status === '409') added.push({ jid, status });
      else failed.push({ jid, status });
    }

    // Sem lista por participante, o proprio pedido ter sido aceito e o unico
    // sinal disponivel — a confirmacao real fica com a leitura do grupo.
    if (added.length === 0 && failed.length === 0) {
      for (const jid of participants) added.push({ jid, status: '200' });
    }

    return { added, failed, participants: [] };
  }

  async sendText(
    instance: string,
    to: string,
    text: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.post(`/message/sendText/${encodeURIComponent(instance)}`, {
        number: to,
        text,
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async getConnectionState(
    instance: string,
  ): Promise<'connected' | 'connecting' | 'disconnected'> {
    try {
      const data = await this.get<{ instance?: { state?: string } }>(
        `/instance/connectionState/${encodeURIComponent(instance)}`,
      );
      const state = data.instance?.state;
      if (state === 'open') return 'connected';
      if (state === 'connecting') return 'connecting';
      return 'disconnected';
    } catch {
      return 'disconnected';
    }
  }

  async getInviteLink(
    instance: string,
    groupJid: string,
  ): Promise<string | null> {
    try {
      const data = await this.get<{ inviteUrl?: string }>(
        `/group/inviteCode/${encodeURIComponent(instance)}?groupJid=${encodeURIComponent(groupJid)}`,
      );
      return data.inviteUrl ?? null;
    } catch (error) {
      this.logger.warn(
        `Evolution nao devolveu link de convite: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Cria a instancia no Evolution. O nome e a identidade: nao ha token por
   * instancia, a autenticacao e a chave global.
   */
  async createInstance(name: string): Promise<{ name: string }> {
    await this.post('/instance/create', {
      instanceName: name,
      qrcode: false,
      integration: 'WHATSAPP-BAILEYS',
    });
    return { name };
  }

  /**
   * Pede o QR. O Evolution devolve `base64` ja com o prefixo data:image, e
   * `pairingCode` quando o pareamento e por codigo.
   */
  async connectInstance(
    name: string,
  ): Promise<{ qrcode: string | null; pairingCode: string | null }> {
    const data = await this.get<{
      base64?: string;
      code?: string;
      pairingCode?: string;
    }>(`/instance/connect/${encodeURIComponent(name)}`);
    return {
      qrcode: data.base64 ?? null,
      pairingCode: data.pairingCode ?? null,
    };
  }

  async logoutInstance(name: string): Promise<void> {
    try {
      await this.request(
        `/instance/logout/${encodeURIComponent(name)}`,
        'DELETE',
      );
    } catch (error) {
      this.logger.warn(`Evolution logout falhou: ${(error as Error).message}`);
    }
  }

  async deleteInstance(name: string): Promise<void> {
    try {
      await this.request(
        `/instance/delete/${encodeURIComponent(name)}`,
        'DELETE',
      );
    } catch (error) {
      this.logger.warn(`Evolution delete falhou: ${(error as Error).message}`);
    }
  }

  isMemberInList(participants: string[], member: string): boolean {
    const target = this.localPart(member);
    if (!target) return false;
    return participants.some((p) => this.localPart(p) === target);
  }

  /* ------------------------------------------------------------------ */

  private localPart(value: string): string {
    return value.replace(/@.*$/, '').replace(/\D/g, '');
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(path, 'GET');
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, 'POST', body);
  }

  private async request<T>(
    path: string,
    method: 'GET' | 'POST' | 'DELETE',
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { apikey: this.apiKey, 'Content-Type': 'application/json' },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      const raw = await res.text();
      let data: unknown = {};
      try {
        data = JSON.parse(raw) as unknown;
      } catch {
        data = {};
      }
      if (!res.ok) {
        const msg =
          (data as { message?: unknown }).message ?? `HTTP ${res.status}`;
        throw new Error(
          `Evolution ${method} ${path} falhou: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`,
        );
      }
      return data as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
