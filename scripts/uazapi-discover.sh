#!/usr/bin/env bash
# Descobre o contrato real da UazAPI para adicao de participantes e convite.
# Rodar NA VPS (le UAZAPI_URL do .env do backend).
#
#   bash scripts/uazapi-discover.sh <TOKEN_DA_INSTANCIA> <GROUP_JID> [NUMERO_TESTE]
#
# Sem NUMERO_TESTE nada e adicionado de verdade: so sonda quais verbos existem.
set -uo pipefail

TOKEN="${1:?token da instancia (config.uazapi_token)}"
GROUP="${2:?jid do grupo destino}"
TARGET="${3:-}"

ENV_FILE="$(dirname "$0")/../apps/api/.env"
BASE="${UAZAPI_URL:-$(grep -hoP '^UAZAPI_URL=\K.*' "$ENV_FILE" 2>/dev/null | tr -d '"'"'"'')}"
: "${BASE:?UAZAPI_URL nao encontrado — exporte manualmente}"
echo "BASE=$BASE"

probe() { # probe <metodo> <path> <body>
  printf '%-6s %-32s -> ' "$1" "$2"
  code=$(curl -s -m 20 -o /tmp/uaz_out -w '%{http_code}' \
    -X "$1" "$BASE$2" -H 'Content-Type: application/json' -H "token: $TOKEN" \
    ${3:+-d "$3"})
  echo "$code $(head -c 200 /tmp/uaz_out)"
  echo
}

echo "### 1. Verbos aceitos em /group/participants (sem participante: so o roteamento importa)"
for m in POST PUT PATCH; do
  probe "$m" /group/participants "{\"groupId\":\"$GROUP\",\"action\":\"add\",\"participants\":[]}"
done

echo "### 2. Caminhos alternativos"
for p in /group/updateParticipants /group/participants/add /group/addParticipants; do
  probe POST "$p" "{\"groupId\":\"$GROUP\",\"action\":\"add\",\"participants\":[]}"
done

echo "### 3. Link de convite (fallback quando a adicao direta e bloqueada)"
for p in "/group/invite?groupId=$GROUP" "/group/inviteCode?groupId=$GROUP" "/group/invitelink?groupId=$GROUP"; do
  probe GET "$p" ""
done

if [ -n "$TARGET" ]; then
  echo "### 4. ADICAO REAL de $TARGET — resposta crua (define o parser de sucesso/falha)"
  probe PUT /group/participants \
    "{\"groupId\":\"$GROUP\",\"action\":\"add\",\"participants\":[{\"id\":\"$TARGET\"}]}"
fi
