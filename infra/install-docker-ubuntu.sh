#!/usr/bin/env bash

set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

sudo apt-get update
sudo apt-get install -y ca-certificates curl

sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

ubuntu_codename="$(. /etc/os-release && printf '%s' "${UBUNTU_CODENAME:-$VERSION_CODENAME}")"
dpkg_arch="$(dpkg --print-architecture)"
docker_sources_file="$(mktemp)"
trap 'rm -f "$docker_sources_file"' EXIT

printf '%s\n' \
  'Types: deb' \
  'URIs: https://download.docker.com/linux/ubuntu' \
  "Suites: ${ubuntu_codename}" \
  'Components: stable' \
  "Architectures: ${dpkg_arch}" \
  'Signed-By: /etc/apt/keyrings/docker.asc' \
  > "$docker_sources_file"

sudo install -m 0644 "$docker_sources_file" \
  /etc/apt/sources.list.d/docker.sources

sudo apt-get update
sudo apt-get install -y \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin

sudo usermod -aG docker azureuser
sudo systemctl enable --now docker

sudo docker version
sudo docker compose version
