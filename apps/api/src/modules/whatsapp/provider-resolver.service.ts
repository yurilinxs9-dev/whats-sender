import { Injectable } from '@nestjs/common';
import { UazApiService } from '../uazapi/uazapi.service';
import { EvolutionService } from './evolution.service';
import { WhatsAppProvider } from './whatsapp-provider';

export interface ResolvedProvider {
  provider: WhatsAppProvider;
  credential: string;
}

/**
 * Diz por qual provedor uma instancia fala e com que credencial.
 *
 * A escolha vive no `config` da propria instancia, entao instancias novas
 * podem nascer no Evolution enquanto as antigas seguem na UazAPI — a migracao
 * acontece uma instancia por vez, sem janela de virada.
 */
@Injectable()
export class ProviderResolver {
  constructor(
    private uazapi: UazApiService,
    private evolution: EvolutionService,
  ) {}

  resolve(config: unknown): ResolvedProvider | null {
    if (!config || typeof config !== 'object' || Array.isArray(config))
      return null;
    const c = config as Record<string, unknown>;

    if (c.provider === 'evolution') {
      const name = c.evolution_instance;
      if (typeof name !== 'string' || name.length === 0) return null;
      return { provider: this.evolution, credential: name };
    }

    // Sem marca de provedor a instancia e da UazAPI: e o que todas eram antes
    // desta escolha existir.
    const token = c.uazapi_token;
    if (typeof token !== 'string' || token.length === 0) return null;
    return {
      provider: this.uazapi as unknown as WhatsAppProvider,
      credential: token,
    };
  }
}
