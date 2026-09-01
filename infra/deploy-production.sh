#!/usr/bin/env bash

set -euo pipefail

app_dir="${1:-/opt/climbing-demo}"
app_domain="${2:?Pass the public application domain as the second argument}"
env_file="${app_dir}/.env.production"
compose_file="${app_dir}/infra/compose.production.yaml"

if [[ ! -f "$env_file" ]]; then
  printf 'Missing production environment: %s\n' "$env_file" >&2
  exit 1
fi

ensure_env_value() {
  local key="$1"
  local value="$2"
  local temporary_file

  if grep -q "^${key}=" "$env_file"; then
    return
  fi

  temporary_file="$(mktemp "${env_file}.XXXXXX")"
  cp "$env_file" "$temporary_file"
  printf '%s=%s\n' "$key" "$value" >> "$temporary_file"
  chmod --reference="$env_file" "$temporary_file"
  mv "$temporary_file" "$env_file"
}

stream_path='wvp-media/rtp/34020000001320000001_34020000001320000001.live.flv?originTypeStr=rtp_push&videoCodec=H264'
ensure_env_value CAMERA_LIVE_ENABLED true
ensure_env_value CAMERA_LIVE_NAME 攀岩墙主摄像头
ensure_env_value CAMERA_PLAYER_URL "https://${app_domain}/wvp/#/play/share?type=2&url=wss%3A%2F%2F${app_domain}%2Fwvp-media%2Frtp%2F34020000001320000001_34020000001320000001.live.flv%3ForiginTypeStr%3Drtp_push%26videoCodec%3DH264"
ensure_env_value CAMERA_RESOURCE_URL "wss://${app_domain}/${stream_path}"
ensure_env_value CAMERA_PROBE_URL "https://${app_domain}/${stream_path}"
ensure_env_value CAMERA_PROBE_TIMEOUT_MS 4000
ensure_env_value CAMERA_PROBE_CACHE_MS 10000
ensure_env_value CAMERA_SNAPSHOT_TIMEOUT_MS 20000
ensure_env_value CAMERA_SNAPSHOT_CACHE_MS 5000
ensure_env_value CAMERA_SNAPSHOT_STALE_MS 300000

cd "$app_dir"
mkdir -p deployment-backups
backup_path="deployment-backups/postgres-before-release-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
sudo docker compose --env-file "$env_file" -f "$compose_file" exec -T postgres \
  sh -lc 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip -9 > "$backup_path"

sudo docker compose --env-file "$env_file" -f "$compose_file" build api web
sudo docker compose --env-file "$env_file" -f "$compose_file" run --rm api \
  pnpm --filter @climbing-crm/api prisma migrate deploy
sudo docker compose --env-file "$env_file" -f "$compose_file" up -d

api_container="$(sudo docker compose --env-file "$env_file" -f "$compose_file" ps -q api)"
web_container="$(sudo docker compose --env-file "$env_file" -f "$compose_file" ps -q web)"
for container in "$api_container" "$web_container"; do
  for _ in $(seq 1 36); do
    health="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}starting{{end}}' "$container")"
    [[ "$health" == healthy ]] && break
    [[ "$health" == unhealthy ]] && break
    sleep 5
  done
  health="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container")"
  if [[ "$health" != healthy ]]; then
    sudo docker compose --env-file "$env_file" -f "$compose_file" logs --tail=120 api web >&2
    printf 'Production container failed health check: %s (%s)\n' "$container" "$health" >&2
    exit 1
  fi
done

sudo docker compose --env-file "$env_file" -f "$compose_file" exec -T api \
  sh -lc 'command -v ffmpeg >/dev/null && node -e '\''fetch("http://127.0.0.1:3101/api/health").then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))'\'''

printf 'Database backup: %s\n' "$backup_path"
sudo docker compose --env-file "$env_file" -f "$compose_file" ps
