#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${HAVEN_E2E_DATABASE_URL:?Set HAVEN_E2E_DATABASE_URL to a disposable database ending in _e2e}"
node --input-type=module -e 'if (!new URL(process.env.HAVEN_E2E_DATABASE_URL).pathname.endsWith("_e2e")) throw new Error("Database must end in _e2e")'
psql "$HAVEN_E2E_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
# Browser tests use simulated bank responses, never the developer's EB application.
unset EB_APPLICATION_ID EB_PRIVATE_KEY_PATH EB_REDIRECT_URL
export DATABASE_URL="$HAVEN_E2E_DATABASE_URL"
export HAVEN_ADDR=127.0.0.1:8181
export HAVEN_ORIGINS=http://127.0.0.1:4322
HAVEN_E2E_KEY_DIR=$(mktemp -d /tmp/haven-e2e-keys.XXXXXX)
export HAVEN_LLM_KEY_FILE="$HAVEN_E2E_KEY_DIR/llm-encryption.key"
trap 'rm -f "$HAVEN_LLM_KEY_FILE"; rmdir "$HAVEN_E2E_KEY_DIR"' EXIT
cd apps/api
go run ./cmd/server
