#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/load-env.sh
: "${DATABASE_URL:?Set DATABASE_URL}"
umask 077
mkdir -p backups
file="backups/haven-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --dbname="$DATABASE_URL" --format=custom --file="$file"
echo "Saved $file"
