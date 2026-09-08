#!/usr/bin/env bash

set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${repo_dir}/.env"
python_bin=""

if [[ -f "$env_file" ]]; then
  python_bin="$(awk 'index($0, "CAMERA_WORKER_PYTHON=") == 1 { value = substr($0, 22) } END { print value }' "$env_file")"
fi
python_bin="${python_bin:-${repo_dir}/services/vision-worker/.venv/bin/python}"
if [[ "$python_bin" != /* ]]; then
  python_bin="${repo_dir}/${python_bin}"
fi

if [[ ! -x "$python_bin" ]]; then
  printf 'Vision Worker Python is unavailable: %s\nRun pnpm worker:setup or set CAMERA_WORKER_PYTHON in .env.\n' "$python_bin" >&2
  exit 1
fi

export MPLCONFIGDIR="${repo_dir}/tmp/matplotlib"
mkdir -p "$MPLCONFIGDIR"
cd "$repo_dir"
exec "$python_bin" -m unittest discover -s services/vision-worker -p 'test_*.py'
