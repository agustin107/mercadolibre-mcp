#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${ML_ENV_FILE:-$PROJECT_ROOT/.env.local}"
ENTRYPOINT="$PROJECT_ROOT/dist/index.js"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "[ml-mcp] Advertencia: no existe $ENV_FILE" >&2
fi

export ML_ENV_FILE="$ENV_FILE"

# ⛔ Tokens: el server (src/auth.ts) auto-refresca. No cron/n8n/curl manual.

if [[ ! -f "$ENTRYPOINT" ]]; then
  echo "[ml-mcp] dist/ no encontrado. Ejecutá: npm run build" >&2
  exit 1
fi

exec node "$ENTRYPOINT"
