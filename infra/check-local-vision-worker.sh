#!/usr/bin/env bash

set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${repo_dir}/.env"
python_bin=""
output_dir=""

if [[ -f "$env_file" ]]; then
  python_bin="$(awk 'index($0, "CAMERA_WORKER_PYTHON=") == 1 { value = substr($0, 22) } END { print value }' "$env_file")"
  output_dir="$(awk 'index($0, "CAMERA_WORKER_OUTPUT_DIR=") == 1 { value = substr($0, 26) } END { print value }' "$env_file")"
fi
python_bin="${python_bin:-${repo_dir}/services/vision-worker/.venv/bin/python}"
output_dir="${output_dir:-tmp/vision-worker}"

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

exec "$python_bin" "${repo_dir}/services/vision-worker/worker_healthcheck.py" "${output_dir}/status.json"
