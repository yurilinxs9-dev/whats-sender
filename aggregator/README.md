# UazAPI Webhook Aggregator

Recebe **um** webhook da UazAPI e distribui (fan-out) para os sistemas, **por número**.
Resolve o conflito de "um webhook por instância" quando o MESMO número é usado por
2+ sistemas (ex: CRM + tracking).

## Como funciona

```
UazAPI ──POST──> Aggregator :4000 ──┬──> tracking-rm
 (só números                        ├──> disparador
  compartilhados)                   └──> crm (URL por-instância copiada do painel)
```

- Responde 200 na hora (UazAPI não re-tenta nem desativa o webhook).
- Roteia **por `instanceName`** via allow-list (`ROUTES` em `index.js`).
- Número **fora do mapa = ignorado** → não toca em nada.
- **Números de cliente do CRM não entram aqui.** O webhook deles continua direto pro CRM.

## Segurança

- Só os números explicitamente listados em `ROUTES` passam pelo aggregator.
- Para o CRM, a URL de destino é a **mesma que a UazAPI já usa hoje** (copiada do
  painel UazAPI, com UUID + secret embutidos). Nenhum acesso ao banco/código do CRM.
- Rollback = apontar o webhook do número de volta pro destino original. 10 segundos.

## Portas na VPS

| Sistema | Porta | Webhook | Secret |
|---|---|---|---|
| tracking-rm | 3010 | `/api/webhooks/whatsapp` | não |
| disparador | 3003 | `/api/webhook/uazapi` | não |
| crm | 3001 | `/api/webhook/.../:instanceId/:secret` | sim (por instância) |

## Deploy

```bash
cd /root/whatsapp-sender/aggregator
echo "WEBHOOK_SECRET=$(openssl rand -hex 24)" > .env
docker compose up -d --build
curl http://localhost:4000/health
docker logs -f uazapi-aggregator
```

## Configurar um número compartilhado

1. No painel UazAPI, **copie a URL de webhook atual** do número (é a URL do CRM).
2. Edite `ROUTES` em `index.js`:
   ```js
   const ROUTES = {
     'NOME-DA-INSTANCIA': [
       'http://localhost:3010/api/webhooks/whatsapp',          // tracking
       'http://localhost:3003/api/webhook/uazapi',             // disparador
       'http://localhost:3001/api/webhook/uazapi/<uuid>/<sec>', // crm (URL copiada)
     ],
   };
   ```
3. `docker compose up -d --build`
4. No painel UazAPI, troque o webhook do número para
   `http://<IP-DA-VPS>:4000/webhook/<WEBHOOK_SECRET>`.
5. Teste e confira `docker logs -f uazapi-aggregator`.
