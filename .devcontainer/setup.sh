#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash .devcontainer/init-env.sh
source scripts/load-env.sh
bash scripts/db-ready.sh
# Create isolated test databases if absent; never reset an existing database.
psql "$DATABASE_URL" -Xq -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'CREATE DATABASE haven_test' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='haven_test')\gexec
SELECT 'CREATE DATABASE haven_e2e' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='haven_e2e')\gexec
SQL
make install
npx playwright install --with-deps chromium
echo 'Haven is ready. Run make dev, then open http://127.0.0.1:4321.'
