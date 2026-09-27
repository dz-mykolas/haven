#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/load-env.sh
: "${DATABASE_URL:?Configure DATABASE_URL in the environment file}"
if ! command -v pg_isready >/dev/null; then
  echo 'Install PostgreSQL client tools to check database readiness.' >&2
  exit 1
fi
for ((attempt=0; attempt<30; attempt++)); do
  if pg_isready --dbname="$DATABASE_URL" --timeout=1 --quiet; then
    # pg_isready alone does not validate credentials or database existence.
    PGCONNECT_TIMEOUT=3 psql "$DATABASE_URL" -XqAt -v ON_ERROR_STOP=1 -c 'SELECT 1' >/dev/null
    echo 'Haven database ready.'
    exit 0
  fi
  sleep 1
done
echo 'Database is unavailable. Reopen the Compose devcontainer, or start PostgreSQL with make db outside it.' >&2
exit 1
