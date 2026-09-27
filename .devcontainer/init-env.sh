#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -e .env.devcontainer ]]; then
  umask 077
  cp .env.devcontainer.example .env.devcontainer
  # Preserve the optional existing sandbox configuration without printing secrets
  # or carrying the old localhost database URL into the new environment.
  if [[ -f .env ]]; then
    (
      source .env
      for name in EB_APPLICATION_ID EB_PRIVATE_KEY_PATH EB_REDIRECT_URL; do
        if [[ -n "${!name:-}" ]]; then printf '%s=%q\n' "$name" "${!name}"; fi
      done
    ) >> .env.devcontainer
  fi
fi
chmod 600 .env.devcontainer
