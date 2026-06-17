# UazAPI Webhook Aggregator

Recebe **um** webhook da UazAPI e distribui (fan-out) para todos os sistemas.
Resolve o conflito de "um webhook por instancia" quando varios sistemas usam o mesmo numero.

## Como funciona

```
UazAPI ──POST──> Aggregator (porta 4000) ──┬──> tracking-rm
                                            ├──> disparador
                                            ├──> crm
                                            └──> erp (opcional)
```

- Responde 200 imediatamente (UazAPI nao re-tenta nem desativa o webhook).
- Distribui o payload IDENTICO, em paralelo, com retry 3x por destino.
- Cada sistema filtra pelo `instanceName` do payload — quem nao conhece o numero ignora.

## Deploy na VPS

```bash
cd /root/whatsapp-sender/aggregator

# 1. definir o secret (qualquer string longa aleatoria)
export WEBHOOK_SECRET="cole-um-secret-longo-aqui"
echo "WEBHOOK_SECRET=$WEBHOOK_SECRET" > .env

# 2. subir
docker compose up -d --build

# 3. conferir
curl http://localhost:4000/health
docker logs -f uazapi-aggregator
```

## Registrar na UazAPI

Para CADA instancia (numero), aponte o webhook para:

```
http://<IP-DA-VPS>:4000/webhook/<WEBHOOK_SECRET>
```

Eventos: `messages`, `messages_update`, `connection`.

## Editar destinos

Edite o array `TARGETS` em `index.js` e rode `docker compose up -d --build` de novo.
Use as portas PUBLICADAS na VPS (as de `docker ps`), pois o container roda em `network_mode: host`.
