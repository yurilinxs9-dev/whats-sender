# Relatório — Integração Webhook Compartilhado (tracking-rm + CRM)

**Data:** 2026-06-19
**VPS:** 187.127.11.117 (srv1552263)
**Objetivo:** número `atendimento alvaro` alimentar **simultaneamente** tracking-rm e CRM, sem um sistema "roubar" o webhook do outro.

---

## 1. Problema

UazAPI permite **apenas 1 webhook por instância**. Quando vários sistemas usam o mesmo número, o último a registrar o webhook rouba os eventos dos outros. Sintomas observados:

- Tracking-rm parou de receber mensagens depois que o número foi conectado por token no CRM.
- Mensagens de/para o alvaro não apareciam no CRM.
- Ao apagar números no tracking-rm, a instância era apagada da própria UazAPI.

## 2. Solução adotada — Agregador de webhook (fan-out)

Um único serviço (`uazapi-aggregator`) é o webhook registrado na UazAPI para o número compartilhado. Ele responde 200 na hora e **distribui o payload idêntico** para N destinos.

```
UazAPI (atendimento alvaro)
        │  webhook → http://187.127.11.117:4000/webhook/<SECRET>
        ▼
  uazapi-aggregator (porta 4000, network_mode: host)
        ├──► localhost:3010/api/webhooks/whatsapp   (tracking-rm)  → 200
        └──► localhost:3001/api/webhook/uazapi       (CRM legacy)   → 201
```

- Roteamento por `instanceName` via allow-list (`ROUTES`). Número fora do mapa = ignorado.
- CRM legacy resolve o tenant por `payload.token` (= `config.uazapi_token`), sem secret extra.

## 3. Causas-raiz encontradas (em ordem de descoberta)

| #   | Sintoma                                 | Causa-raiz                                                                                                                                         | Correção                                                                                        |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | Tracking some ao conectar no CRM        | 1 webhook por instância                                                                                                                            | Agregador fan-out                                                                               |
| 2   | Deletar no tracking apaga da UazAPI     | delete chamava UazAPI mesmo p/ número importado                                                                                                    | flag `is_imported` (tracking) / `config.imported` (CRM) — não deleta instância quando importado |
| 3   | CRM "instância não conectada" ao enviar | lead preso a instância morta, sem swap p/ gerente/admin                                                                                            | `resolveLeadAndToken()` troca p/ instância viva no modo individual                              |
| 4   | **Webhook nunca chegava ao agregador**  | **porta 4000 bloqueada no ufw** (default deny incoming). Teste loopback do próprio VPS passava (hairpin fura o ufw) e mascarava o problema         | `ufw allow 4000/tcp`                                                                            |
| 5   | CRM respondia **429** e perdia msgs     | ThrottlerGuard global (100 req/min/IP); rajada do agregador (1 msg = evento `messages` + `messages_update` + retries, todos do mesmo IP) estourava | `@SkipThrottle()` no `WebhooksController`                                                       |
| 6   | Token do alvaro dava 401                | token errado em uso (`...e461f621375d`); real era `...e46d207eae3f` (lido do banco do CRM)                                                         | usar token real do `WhatsappInstance.config.uazapi_token`                                       |

## 4. Mudanças aplicadas

### Infra / VPS

- `ufw allow 4000/tcp` (porta do agregador).
- Webhook UazAPI do alvaro → `http://187.127.11.117:4000/webhook/ece3c2e1b023e82dff2e4ec9cdd3ce54d396c46638709dec`.
- Config webhook: `events:[messages,messages_update,connection]`, `excludeMessages:[wasSentByApi]`, `enabled:true`.

### Agregador (`/root/whatsapp-sender/aggregator/index.js`)

- `ROUTES['atendimento alvaro'] = [tracking, crm]`.
- Backup salvo: `index.js.bak.<timestamp>`.
- Rebuild: `docker compose build && docker compose up -d`.

### CRM (repo yurilinxs9-dev/CRM-ROBUSTO, branch master)

- `webhooks.controller.ts`: `@SkipThrottle()` no controller (commit `034e49b`).
- `instances.service.ts`: `config.imported=true` ao importar; delete não apaga UazAPI quando imported.
- `messages.service.ts`: swap p/ instância viva no envio individual.
- Deploy: `git pull origin master && docker compose build crm-backend && docker compose up -d crm-backend`.

### Tracking-rm (`/var/www/tracking-rm`, PM2)

- `schema.prisma`: campo `is_imported Boolean @default(false)` em `WhatsappConnection`.
- `numbers.ts`: importa com `is_imported:true`; delete não chama UazAPI quando importado.

## 5. Estado final (verificado)

- `#0` tracking → 200 constante. Log `[webhook] IN inst=atendimento alvaro` confirmado.
- `#1` CRM → 201 constante, sem 429.

---

## 6. PREVENÇÕES

### 6.1 Firewall (causa-raiz #4 — a que mais custou tempo)

- **Toda nova porta exposta exige regra ufw explícita.** Checklist ao subir serviço novo:
  ```bash
  ufw status numbered | grep <porta> || ufw allow <porta>/tcp
  ```
- **Nunca confiar em teste loopback** (`curl localhost`/IP-próprio do VPS) para validar acesso externo — hairpin fura o ufw. Validar de uma máquina **de fora** ou por um webhook real.
- Documentar portas usadas: 80(nginx), 3001(CRM), 3003(disparador), 3010(tracking), 4000(agregador), 8080.

### 6.2 Webhook UazAPI

- Sempre usar o **token real** da instância (ler de `WhatsappInstance.config.uazapi_token` no banco do CRM, não confiar em token copiado de print).
- Confirmar webhook registrado **após** setar:
  ```bash
  curl -s -H "token: <TOKEN>" https://jgtech.uazapi.com/webhook
  ```
- Manter `excludeMessages:[wasSentByApi]` p/ não duplicar eventos de mensagens enviadas pela API.
- Qualquer reconexão/recriação da instância **reescreve o webhook** → re-apontar para o agregador depois.

### 6.3 Agregador

- **Monitorar entrega**: alerta se `#destino` acumular `✗ ... DESISTIU`. Comando rápido de saúde:
  ```bash
  docker logs uazapi-aggregator --tail=200 | grep -c DESISTIU
  ```
- `restart: unless-stopped` já garante reinício; conferir que o container volta após reboot do VPS.
- Se cair, **só o número compartilhado** para — os demais (webhook direto) não são afetados.
- Adicionar novo número compartilhado = nova entrada em `ROUTES` + rebuild + apontar webhook na UazAPI.
- Backup do `index.js` antes de editar (já há `.bak.*`). Rollback: restaurar `.bak` + rebuild.

### 6.4 Throttle / capacidade CRM

- Endpoint de webhook isento de throttle (`@SkipThrottle`). **Não reverter** sem outra proteção (o webhook já é autenticado por token/secret).
- Se abrir endpoint público novo, lembrar que o limite global é 100 req/min/IP — webhooks de alto volume precisam de `@SkipThrottle` ou limite próprio.

### 6.5 Deploy / código (repo compartilhado com Yuri)

- **Sempre `git pull --rebase origin master` antes de push** (Yuri commita em paralelo; já houve rebase necessário).
- Avisar o Yuri das mudanças aditivas: flag `config.imported`, swap de instância morta no envio, `@SkipThrottle` no webhook.
- Build do CRM é pesado (~3 min). Não interromper `docker compose build` no meio (Ctrl+C deixa imagem velha rodando).
- Deletar conexão importada NÃO deve apagar instância UazAPI — coberto por `is_imported`/`config.imported`. Manter ao mexer no delete.

### 6.6 Verificação pós-mudança (rotina)

1. Mandar 1 msg real do celular pro número.
2. `docker logs uazapi-aggregator --tail=6` → esperar `→ 2 destinos` + `✓ 200` + `✓ 201`.
3. Conferir tracking (`pm2 logs tracking-rm`) e CRM (UI: lead + conversa).

---

## 7. Pendências (fora deste escopo)

- Erros Meta CAPI no tracking-rm: faltando `currency` + `messaging_channel: whatsapp` em eventos Purchase.
- ERP Estúdio AME: feature de importar por token ainda não implementada.
