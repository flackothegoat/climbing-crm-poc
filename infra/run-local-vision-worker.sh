#!/usr/bin/env bash

set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${repo_dir}/.env"

if [[ ! -f "$env_file" ]]; then
  printf 'Missing %s. Copy .env.example and configure local services first.\n' "$env_file" >&2
  exit 1
fi

read_env_value() {
  local key="$1"
  local value
  value="$(awk -v key="$key" 'index($0, key "=") == 1 { value = substr($0, length(key) + 2) } END { print value }' "$env_file")"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

stream_url="$(read_env_value CAMERA_RESOURCE_URL)"
worker_token="$(read_env_value CAMERA_WORKER_TOKEN)"
organization_id="$(read_env_value CAMERA_WORKER_ORGANIZATION_ID)"
api_port="$(read_env_value API_PORT)"
python_bin="$(read_env_value CAMERA_WORKER_PYTHON)"
output_dir="$(read_env_value CAMERA_WORKER_OUTPUT_DIR)"
route_refresh_seconds="$(read_env_value CAMERA_ROUTE_REFRESH_SECONDS)"

api_port="${api_port:-3101}"
python_bin="${python_bin:-${repo_dir}/services/vision-worker/.venv/bin/python}"
output_dir="${output_dir:-tmp/vision-worker}"
route_refresh_seconds="${route_refresh_seconds:-30}"

if [[ "$python_bin" != /* ]]; then
  python_bin="${repo_dir}/${python_bin}"
fi
if [[ "$output_dir" != /* ]]; then
  output_dir="${repo_dir}/${output_dir}"
fi

if [[ ! -x "$python_bin" ]]; then
  printf 'Vision Worker Python is unavailable: %s\nRun pnpm worker:setup or set CAMERA_WORKER_PYTHON in .env.\n' "$python_bin" >&2
  exit 1
fi
if [[ -z "$stream_url" ]]; then
  printf 'CAMERA_RESOURCE_URL is required in .env.\n' >&2
  exit 1
fi
if [[ ${#worker_token} -lt 32 || "$worker_token" == replace-* ]]; then
  printf 'CAMERA_WORKER_TOKEN must be a non-placeholder value of at least 32 characters.\n' >&2
  exit 1
fi
if [[ -z "$organization_id" || "$organization_id" == replace-* ]]; then
  printf 'CAMERA_WORKER_ORGANIZATION_ID must identify the local organization monitored by the API.\n' >&2
  exit 1
fi

mkdir -p "$output_dir"
export MPLCONFIGDIR="${repo_dir}/tmp/matplotlib"
mkdir -p "$MPLCONFIGDIR"
cd "${repo_dir}/services/vision-worker"
exec "$python_bin" live_stream_worker.py \
  --stream-url "$stream_url" \
  --api-url "http://127.0.0.1:${api_port}/api" \
  --worker-token "$worker_token" \
  --route-refresh-s "$route_refresh_seconds" \
  --output "$output_dir" \
  "$@"
