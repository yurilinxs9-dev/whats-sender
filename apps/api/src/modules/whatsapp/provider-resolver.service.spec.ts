import { ProviderResolver } from './provider-resolver.service';
import { UazApiService } from '../uazapi/uazapi.service';
import { EvolutionService } from './evolution.service';

describe('ProviderResolver', () => {
  const uazapi = { name: 'uazapi' } as unknown as UazApiService;
  const evolution = { name: 'evolution' } as unknown as EvolutionService;
  const resolver = new ProviderResolver(uazapi, evolution);

  it('instância sem marca de provedor continua na UazAPI', () => {
    const r = resolver.resolve({ uazapi_token: 'tok' });
    expect(r?.provider).toBe(uazapi);
    expect(r?.credential).toBe('tok');
  });

  it('instância marcada como evolution usa o nome como credencial', () => {
    const r = resolver.resolve({
      provider: 'evolution',
      evolution_instance: 'grupos-01',
    });
    expect(r?.provider).toBe(evolution);
    expect(r?.credential).toBe('grupos-01');
  });

  it('evolution sem nome de instância não resolve', () => {
    expect(resolver.resolve({ provider: 'evolution' })).toBeNull();
  });

  it('uazapi sem token não resolve', () => {
    expect(resolver.resolve({})).toBeNull();
  });

  it('config ausente não resolve', () => {
    expect(resolver.resolve(null)).toBeNull();
  });
});
