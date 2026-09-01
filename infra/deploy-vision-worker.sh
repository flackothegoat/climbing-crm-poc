#!/usr/bin/env bash

set -euo pipefail

app_dir="${1:-/opt/climbing-demo}"
organization_id="${2:?Pass the production organization ID as the second argument}"
runtime_dir="${3:-/opt/climbing-vision-worker}"
env_file="${app_dir}/.env.production"
app_compose="${app_dir}/infra/compose.production.yaml"
worker_compose="${app_dir}/infra/compose.vision-worker.yaml"
worker_env="${runtime_dir}/worker.env"

if [[ ! -f "$env_file" ]]; then
  printf 'Missing production environment: %s\n' "$env_file" >&2
  exit 1
fi

set_env_value() {
  local key="$1"
  local value="$2"
  local temporary_file
  temporary_file="$(mktemp "${env_file}.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { replaced = 0 }
    index($0, key "=") == 1 { print key "=" value; replaced = 1; next }
    { print }
    END { if (!replaced) print key "=" value }
  ' "$env_file" > "$temporary_file"
  chmod --reference="$env_file" "$temporary_file"
  mv "$temporary_file" "$env_file"
}

read_env_value() {
  local key="$1"
  awk -v key="$key" 'index($0, key "=") == 1 { value = substr($0, length(key) + 2) } END { print value }' "$env_file"
}

worker_token="$(read_env_value CAMERA_WORKER_TOKEN)"
if [[ ${#worker_token} -lt 32 || "$worker_token" == replace-* ]]; then
  worker_token="$(openssl rand -hex 32)"
  set_env_value CAMERA_WORKER_TOKEN "$worker_token"
fi
set_env_value CAMERA_WORKER_ORGANIZATION_ID "$organization_id"

camera_resource_url="$(read_env_value CAMERA_RESOURCE_URL)"
if [[ -z "$camera_resource_url" ]]; then
  printf 'CAMERA_RESOURCE_URL is not configured in %s\n' "$env_file" >&2
  exit 1
fi

install -d -m 700 "$runtime_dir" "$runtime_dir/output/live-worker"
umask 077
printf '%s\n' \
  "CAMERA_RESOURCE_URL=${camera_resource_url}" \
  'CAMERA_WORKER_API_URL=http://api:3101/api' \
  "CAMERA_WORKER_TOKEN=${worker_token}" \
  'CAMERA_ROUTE_REFRESH_SECONDS=30' \
  > "$worker_env"
chmod 600 "$worker_env"

cd "$app_dir"
sudo docker compose --env-file "$env_file" -f "$app_compose" up -d --force-recreate api

export CAMERA_WORKER_ENV_FILE="$worker_env"
export CAMERA_WORKER_OUTPUT_DIR="$runtime_dir/output/live-worker"
sudo docker compose -f "$worker_compose" build
sudo docker compose -f "$worker_compose" up -d --force-recreate

worker_container="$(sudo docker compose -f "$worker_compose" ps -q vision-worker)"
for _ in $(seq 1 48); do
  health="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}starting{{end}}' "$worker_container")"
  [[ "$health" == healthy ]] && break
  if [[ "$health" == unhealthy ]]; then
    sudo docker compose -f "$worker_compose" logs --tail=160 vision-worker >&2
    exit 1
  fi
  sleep 5
done

health="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$worker_container")"
if [[ "$health" != healthy ]]; then
  sudo docker compose -f "$worker_compose" logs --tail=160 vision-worker >&2
  printf 'Vision Worker failed health check: %s\n' "$health" >&2
  exit 1
fi

sudo docker compose -f "$worker_compose" exec -T vision-worker \
  python worker_healthcheck.py output/live-worker/status.json
sudo docker compose -f "$worker_compose" exec -T vision-worker \
  python -c 'import json, os, urllib.request; request=urllib.request.Request("http://api:3101/api/camera/worker/route-definitions", headers={"x-camera-worker-token": os.environ["CAMERA_WORKER_TOKEN"]}); payload=json.load(urllib.request.urlopen(request, timeout=5)); assert payload["definitions"], "No published camera route definitions"; print(json.dumps({"cameraKey": payload["cameraKey"], "routeDefinitionCount": len(payload["definitions"]), "routes": [item["route"]["code"] for item in payload["definitions"]]}, ensure_ascii=False))'

sudo docker compose --env-file "$env_file" -f "$app_compose" ps api
sudo docker compose -f "$worker_compose" ps
