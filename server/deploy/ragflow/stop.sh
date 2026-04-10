#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_BIN="docker-compose"
elif docker compose --help >/dev/null 2>&1; then
  COMPOSE_BIN="docker compose"
else
  echo "[ragflow] docker-compose/docker compose not found"
  exit 1
fi

$COMPOSE_BIN -f docker-compose-base.yml -f docker-compose.yml down
