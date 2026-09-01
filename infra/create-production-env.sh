#!/usr/bin/env bash

set -euo pipefail

deployment_dir="${1:-/opt/climbing-demo}"
app_domain="${2:?Pass the public application domain as the second argument}"
env_file="${deployment_dir}/.env.production"

if [[ -e "$env_file" ]]; then
  printf 'Refusing to overwrite existing %s\n' "$env_file" >&2
  exit 1
fi

postgres_password="$(openssl rand -hex 32)"
minio_password="$(openssl rand -hex 32)"

umask 077
printf '%s\n' \
  "APP_DOMAIN=${app_domain}" \
  'POSTGRES_USER=climbing_poc' \
  "POSTGRES_PASSWORD=${postgres_password}" \
  'POSTGRES_DB=climbing_poc' \
  'MINIO_ROOT_USER=climbing-poc-storage' \
  "MINIO_ROOT_PASSWORD=${minio_password}" \
  'MINIO_BUCKET=climbingapp-hold-assets' \
  'SESSION_COOKIE_NAME=climbing_crm_session' \
  'SESSION_COOKIE_SECURE=true' \
  'SESSION_TTL_HOURS=168' \
  'INVITATION_TTL_HOURS=72' \
  'CAMERA_LIVE_ENABLED=true' \
  'CAMERA_LIVE_NAME=攀岩墙主摄像头' \
  "CAMERA_PLAYER_URL='https://${app_domain}/wvp/#/play/share?type=2&url=wss%3A%2F%2F${app_domain}%2Fwvp-media%2Frtp%2F34020000001320000001_34020000001320000001.live.flv%3ForiginTypeStr%3Drtp_push%26videoCodec%3DH264'" \
  "CAMERA_RESOURCE_URL=wss://${app_domain}/wvp-media/rtp/34020000001320000001_34020000001320000001.live.flv?originTypeStr=rtp_push&videoCodec=H264" \
  "CAMERA_PROBE_URL=https://${app_domain}/wvp-media/rtp/34020000001320000001_34020000001320000001.live.flv?originTypeStr=rtp_push&videoCodec=H264" \
  'CAMERA_PROBE_TIMEOUT_MS=4000' \
  'CAMERA_PROBE_CACHE_MS=10000' \
  'CAMERA_SNAPSHOT_TIMEOUT_MS=20000' \
  'CAMERA_SNAPSHOT_CACHE_MS=5000' \
  'CAMERA_SNAPSHOT_STALE_MS=300000' \
  > "$env_file"

chmod 600 "$env_file"
printf 'Created %s with generated secrets.\n' "$env_file"
