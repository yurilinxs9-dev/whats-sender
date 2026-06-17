'use strict';

/**
 * UazAPI Webhook Aggregator
 * -------------------------------------------------------------------------
 * A UazAPI so permite UM webhook por instancia. Quando varios sistemas usam
 * o mesmo numero, o ultimo a registrar o webhook "rouba" os eventos dos outros.
 *
 * Este servico resolve isso: e o UNICO webhook registrado na UazAPI. Ao receber
 * um evento, ele responde 200 imediatamente (pra UazAPI nao re-tentar nem
 * desativar o webhook) e em seguida distribui (fan-out) o payload IDENTICO
 * para todos os sistemas configurados em TARGETS.
 *
 * Cada sistema ja filtra pelo `instanceName` do payload, entao quem nao conhece
 * o numero simplesmente ignora — nenhuma mudanca de logica e necessaria neles.
 */

const express = require('express');

/* ========================================================================
 * CONFIG — edite TARGETS com os endpoints reais de webhook de cada sistema.
 * Use as portas PUBLICADAS na VPS (as mesmas que aparecem em `docker ps`),
 * porque o container roda em network_mode: host.
 * ===================================================================== */
const TARGETS = [
  { name: 'tracking-rm', url: 'http://localhost:3005/api/webhooks/whatsapp' }, // CONFIRMAR PORTA
  { name: 'disparador',  url: 'http://localhost:3003/api/webhook/uazapi' },
  { name: 'crm',         url: 'http://localhost:3001/api/webhook/uazapi' },    // CONFIRMAR PATH
  // { name: 'erp',      url: 'http://localhost:XXXX/webhook/uazapi' },        // se o ERP precisar
];

const PORT = parseInt(process.env.PORT || '4000', 10);
// Secret simples no path: a UazAPI registra /webhook/<SECRET>. Bloqueia POSTs aleatorios.
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'troque-este-secret';
const DELIVERY_TIMEOUT_MS = 8000;
const MAX_RETRIES = 3;

const app = express();
app.use(express.json({ limit: '5mb' }));

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, targets: TARGETS.map((t) => t.name) });
});

// Endpoint que a UazAPI chama. Path inclui o secret.
app.post('/webhook/:secret', (req, res) => {
  if (req.params.secret !== WEBHOOK_SECRET) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }

  const body = req.body || {};

  // Responde JA — a UazAPI nao deve esperar o fan-out.
  res.json({ ok: true });

  const instance = body.instanceName || body.instance || '?';
  const event = body.EventType || body.event || '?';
  log(`recebido: event=${event} instance=${instance} → distribuindo p/ ${TARGETS.length} sistemas`);

  // Fan-out assincrono, cada destino com retry independente.
  for (const target of TARGETS) {
    deliver(target, body, 1);
  }
});

async function deliver(target, body, attempt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const res = await fetch(target.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log(`  ✓ ${target.name} (${res.status})`);
  } catch (err) {
    log(`  ✗ ${target.name} tentativa ${attempt}: ${err.message}`);
    if (attempt < MAX_RETRIES) {
      const delayMs = attempt * 2000; // 2s, 4s, ...
      setTimeout(() => deliver(target, body, attempt + 1), delayMs);
    } else {
      log(`  ✗✗ ${target.name} DESISTIU apos ${MAX_RETRIES} tentativas`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

app.listen(PORT, () => {
  log(`UazAPI Aggregator rodando na porta ${PORT}`);
  log(`Endpoint p/ registrar na UazAPI: http://<IP-DA-VPS>:${PORT}/webhook/${WEBHOOK_SECRET}`);
  log(`Distribuindo para: ${TARGETS.map((t) => t.name).join(', ')}`);
});
