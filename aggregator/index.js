'use strict';

/**
 * UazAPI Webhook Aggregator
 * -------------------------------------------------------------------------
 * A UazAPI so permite UM webhook por instancia. Quando varios sistemas usam
 * o mesmo numero, o ultimo a registrar "rouba" os eventos dos outros.
 *
 * Este servico e o UNICO webhook registrado na UazAPI para os numeros
 * COMPARTILHADOS. Ao receber um evento, responde 200 na hora (pra UazAPI nao
 * re-tentar nem desativar) e distribui (fan-out) o payload IDENTICO para os
 * destinos configurados para AQUELE numero.
 *
 * SEGURANCA POR DESIGN:
 *  - Roteamento por `instanceName` via allow-list explicita (ROUTES).
 *  - Numero que NAO esta no mapa e ignorado (nao toca em nada).
 *  - Numeros de cliente do CRM nunca entram aqui: o webhook deles continua
 *    apontando direto pro CRM. So os numeros compartilhados passam por aqui.
 *  - Para o CRM, a URL de destino e a MESMA que a UazAPI ja usa hoje (copiada
 *    do painel UazAPI) — com UUID + secret embutidos. Nenhum acesso ao banco
 *    ou codigo do CRM.
 */

const express = require('express');

/* ========================================================================
 * CONFIG — mapeie cada numero COMPARTILHADO (instanceName na UazAPI) para a
 * lista de URLs de destino. Para o CRM, cole a URL EXATA que ja esta
 * registrada hoje no painel da UazAPI para aquele numero.
 *
 * Portas (de `docker ps` / netstat na VPS):
 *   tracking-rm : 3010  → /api/webhooks/whatsapp   (sem secret)
 *   disparador  : 3003  → /api/webhook/uazapi      (sem secret)
 *   crm         : 3001  → URL por-instancia com UUID+secret (copiar do painel)
 * ===================================================================== */
const ROUTES = {
  // EXEMPLO — troque "NOME-DA-INSTANCIA" pelo instanceName real do numero compartilhado:
  //
  // 'NOME-DA-INSTANCIA': [
  //   'http://localhost:3010/api/webhooks/whatsapp',
  //   'http://localhost:3003/api/webhook/uazapi',
  //   'http://localhost:3001/api/webhook/uazapi/<CRM-INSTANCE-UUID>/<CRM-SECRET>',
  // ],
};

const PORT = parseInt(process.env.PORT || '4000', 10);
// Secret no path do aggregator: a UazAPI registra /webhook/<SECRET>. Bloqueia POSTs aleatorios.
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'troque-este-secret';
const DELIVERY_TIMEOUT_MS = 8000;
const MAX_RETRIES = 3;

const app = express();
app.use(express.json({ limit: '5mb' }));

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, routes: Object.keys(ROUTES) });
});

// Endpoint que a UazAPI chama. Path inclui o secret.
app.post('/webhook/:secret', (req, res) => {
  if (req.params.secret !== WEBHOOK_SECRET) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }

  const body = req.body || {};

  // Responde JA — a UazAPI nao deve esperar o fan-out.
  res.json({ ok: true });

  const instance = body.instanceName || body.instance || '';
  const event = body.EventType || body.event || '?';

  const targets = ROUTES[instance];
  if (!targets || targets.length === 0) {
    log(
      `ignorado: instance="${instance}" event=${event} (nao mapeado em ROUTES)`,
    );
    return;
  }

  log(
    `recebido: event=${event} instance="${instance}" → ${targets.length} destinos`,
  );
  targets.forEach((url, i) => deliver(`${instance}#${i}`, url, body, 1));
});

async function deliver(label, url, body, attempt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log(`  ✓ ${label} → ${res.status}`);
  } catch (err) {
    log(`  ✗ ${label} tentativa ${attempt}: ${err.message}`);
    if (attempt < MAX_RETRIES) {
      setTimeout(() => deliver(label, url, body, attempt + 1), attempt * 2000);
    } else {
      log(`  ✗✗ ${label} DESISTIU apos ${MAX_RETRIES} tentativas`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

app.listen(PORT, () => {
  log(`UazAPI Aggregator rodando na porta ${PORT}`);
  log(
    `Endpoint p/ UazAPI: http://<IP-DA-VPS>:${PORT}/webhook/${WEBHOOK_SECRET}`,
  );
  log(
    `Numeros mapeados: ${Object.keys(ROUTES).join(', ') || '(nenhum ainda)'}`,
  );
});
