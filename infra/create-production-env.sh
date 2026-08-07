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
  > "$env_file"

chmod 600 "$env_file"
printf 'Created %s with generated secrets.\n' "$env_file"
