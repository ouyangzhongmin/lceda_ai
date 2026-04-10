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

if [[ ! -f .env ]]; then
  echo "[ragflow] .env not found, creating from .env.example"
  cp .env.example .env
  echo "[ragflow] please review passwords in .env, then re-run ./start.sh"
  exit 1
fi

mkdir -p ragflow-logs
mkdir -p data/es01 data/opensearch01 data/infinity data/mysql data/minio data/redis data/kibana

wait_for_http() {
  local url="$1"
  local name="$2"
  local timeout="${3:-420}"
  local interval=3
  local start_ts
  start_ts="$(date +%s)"

  echo "[ragflow] waiting for ${name}: ${url}"
  while true; do
    # 200/401 means upstream is alive and routing is ready.
    local code
    code="$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)"
    if [[ "$code" == "200" || "$code" == "401" ]]; then
      echo "[ragflow] ${name} ready (http ${code})"
      return 0
    fi
    if (( $(date +%s) - start_ts > timeout )); then
      echo "[ragflow] timeout waiting for ${name}, last http code=${code}"
      return 1
    fi
    sleep "$interval"
  done
}

echo "[ragflow] pulling images..."
$COMPOSE_BIN -f docker-compose-base.yml -f docker-compose.yml pull

echo "[ragflow] starting services..."
$COMPOSE_BIN -f docker-compose-base.yml -f docker-compose.yml up -d

wait_for_http "http://127.0.0.1:39381/api/v1/admin/ping" "admin api" 180 || true
wait_for_http "http://127.0.0.1:39380/v1/system/version" "main api" 420 || true
wait_for_http "http://127.0.0.1:38080/v1/system/version" "web proxy api" 420 || true

echo "[ragflow] started"
echo "[ragflow] web:   http://127.0.0.1:38080"
echo "[ragflow] api:   http://127.0.0.1:39380"
echo "[ragflow] admin: http://127.0.0.1:39381"
