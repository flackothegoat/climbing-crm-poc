#!/usr/bin/env bash

set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${repo_dir}/.env"

read_env_value() {
  local key="$1"
  local value=""
  if [[ -f "$env_file" ]]; then
    value="$(awk -v key="$key" 'index($0, key "=") == 1 { value = substr($0, length(key) + 2) } END { print value }' "$env_file")"
  fi
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

output_dir="$(read_env_value CAMERA_WORKER_OUTPUT_DIR)"
output_dir="${output_dir:-tmp/vision-worker}"
if [[ "$output_dir" != /* ]]; then
  output_dir="${repo_dir}/${output_dir}"
fi
mkdir -p "$output_dir"

pid_file="${output_dir}/worker.pid"
log_file="${output_dir}/worker.log"
status_file="${output_dir}/status.json"
start_marker="${output_dir}/worker-start.marker"
worker_program="${repo_dir}/services/vision-worker/live_stream_worker.py"

running_pid() {
  local pid=""
  local command=""
  if [[ -f "$pid_file" ]]; then
    pid="$(tr -cd '0-9' < "$pid_file")"
  fi
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$command" == *"$worker_program"* ]]; then
      printf '%s' "$pid"
      return
    fi
  fi
  pgrep -f "$worker_program" 2>/dev/null | head -n 1 || true
}

start_worker() {
  local pid=""
  local launched_pid=""
  pid="$(running_pid)"
  if [[ -n "$pid" ]]; then
    printf 'local worker already running; pid=%s\n' "$pid"
    "${repo_dir}/infra/check-local-vision-worker.sh"
    return
  fi

  rm -f "$pid_file" "$start_marker"
  touch "$start_marker"
  nohup "${repo_dir}/infra/run-local-vision-worker.sh" >> "$log_file" 2>&1 &
  launched_pid=$!
  printf '%s\n' "$launched_pid" > "$pid_file"

  for _ in {1..60}; do
    pid="$(running_pid)"
    if [[ -f "$status_file" && "$status_file" -nt "$start_marker" ]] \
      && [[ -n "$pid" ]] \
      && "${repo_dir}/infra/check-local-vision-worker.sh" >/dev/null 2>&1; then
      printf '%s\n' "$pid" > "$pid_file"
      rm -f "$start_marker"
      printf 'local worker started from current workspace; pid=%s\n' "$pid"
      "${repo_dir}/infra/check-local-vision-worker.sh"
      return
    fi
    if ! kill -0 "$launched_pid" 2>/dev/null; then
      break
    fi
    sleep 1
  done

  printf 'local worker did not produce a healthy heartbeat within 60 seconds; see %s\n' "$log_file" >&2
  tail -n 30 "$log_file" >&2 || true
  rm -f "$start_marker"
  return 1
}

stop_worker() {
  local pid=""
  pid="$(running_pid)"
  if [[ -z "$pid" ]]; then
    rm -f "$pid_file" "$start_marker"
    printf 'local worker is not running\n'
    return
  fi

  kill -TERM "$pid"
  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$pid_file" "$start_marker"
      printf 'local worker stopped; pid=%s\n' "$pid"
      return
    fi
    sleep 1
  done
  printf 'local worker did not stop within 20 seconds; pid=%s\n' "$pid" >&2
  return 1
}

status_worker() {
  local pid=""
  pid="$(running_pid)"
  if [[ -z "$pid" ]]; then
    printf 'local worker process is not running\n' >&2
    return 1
  fi
  printf 'local worker process running; pid=%s\n' "$pid"
  "${repo_dir}/infra/check-local-vision-worker.sh"
}

case "${1:-}" in
  start)
    start_worker
    ;;
  stop)
    stop_worker
    ;;
  restart | restore)
    stop_worker
    start_worker
    ;;
  status)
    status_worker
    ;;
  *)
    printf 'Usage: %s {start|stop|restart|restore|status}\n' "$0" >&2
    exit 2
    ;;
esac
