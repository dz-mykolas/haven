#!/usr/bin/env bash
# Source from repository-root scripts. Preserve exported test variables unless
# the selected file explicitly overrides them.
haven_env_file="${HAVEN_ENV_FILE:-.env}"
if [[ -f "$haven_env_file" ]]; then
  set -a
  source "$haven_env_file"
  set +a
elif [[ -n "${HAVEN_ENV_FILE:-}" ]]; then
  echo "Missing $haven_env_file. Run the environment setup first." >&2
  return 1
fi
unset haven_env_file
