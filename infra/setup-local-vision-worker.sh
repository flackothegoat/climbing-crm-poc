#!/usr/bin/env bash

set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
worker_dir="${repo_dir}/services/vision-worker"
venv_dir="${worker_dir}/.venv"
python_bin="${CAMERA_WORKER_SETUP_PYTHON:-}"

if [[ -z "$python_bin" ]]; then
  if command -v python3.12 >/dev/null 2>&1; then
    python_bin="$(command -v python3.12)"
  elif command -v python3.11 >/dev/null 2>&1; then
    python_bin="$(command -v python3.11)"
  else
    printf 'Python 3.11 or 3.12 is required for the local Vision Worker.\n' >&2
    exit 1
  fi
fi

"$python_bin" -m venv "$venv_dir"
"${venv_dir}/bin/python" -m pip install --upgrade pip
"${venv_dir}/bin/python" -m pip install -r "${worker_dir}/requirements.local.txt"
"${venv_dir}/bin/python" -m pip install --no-deps ultralytics==8.4.115

printf 'Local Vision Worker environment is ready: %s\n' "${venv_dir}/bin/python"
