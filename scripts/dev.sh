#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/load-env.sh
: "${DATABASE_URL:?Copy .env.example to .env and configure PostgreSQL first}"
# Check before building or starting children; never stop a process we don't own.
node --input-type=module <<'NODE'
import net from 'node:net';
const api = new URL('http://' + (process.env.HAVEN_ADDR || '127.0.0.1:8080'));
for (const [name, host, port] of [
  ['API', api.hostname.replace(/^\[|\]$/g, ''), Number(api.port || 80)],
  ['web', '127.0.0.1', 4321],
]) {
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host, port }, resolve);
    });
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } catch (error) {
    console.error(error.code === 'EADDRINUSE'
      ? 'Haven ' + name + ' port is already in use at ' + host + ':' + port + '. Stop the existing server (Ctrl+C in its terminal), then run make dev again.'
      : 'Cannot start Haven ' + name + ' at ' + host + ':' + port + ': ' + error.message);
    process.exit(1);
  }
}
NODE
export HAVEN_API_URL="http://${HAVEN_ADDR:-127.0.0.1:8080}"
mkdir -p /tmp/haven-dev
api_binary=$(mktemp /tmp/haven-dev/api.XXXXXX)
api_pid=''
web_pid=''
cleanup() {
  trap - EXIT INT TERM
  [[ -z "$api_pid" ]] || kill "$api_pid" 2>/dev/null || true
  [[ -z "$web_pid" ]] || kill -- "-$web_pid" 2>/dev/null || true
  wait 2>/dev/null || true
  rm -f "$api_binary"
}
trap cleanup EXIT INT TERM
(cd apps/api && go build -o "$api_binary" ./cmd/server)
"$api_binary" & api_pid=$!
ASTRO_DEV_BACKGROUND=0 setsid npm run dev & web_pid=$!
wait -n "$api_pid" "$web_pid"
