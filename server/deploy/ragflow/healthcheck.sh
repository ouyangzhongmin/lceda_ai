#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "[ragflow] docker-compose/docker compose not found"
  exit 2
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

http_code() {
  local url="$1"
  curl --connect-timeout 2 --max-time 3 -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo "000"
}

cpu_container="$(docker ps -aq --filter name='^ragflow-ragflow-cpu-1$' | head -n1)"
executor_container="$(docker ps -aq --filter name='^ragflow-task-executor-1$' | head -n1)"

if [[ -z "${cpu_container}" ]]; then
  echo "[ragflow] status=down reason=ragflow-cpu container not found"
  exit 1
fi

ADMIN_SVR_HTTP_PORT="${ADMIN_SVR_HTTP_PORT:-39381}"
SVR_HTTP_PORT="${SVR_HTTP_PORT:-39380}"
SVR_WEB_HTTP_PORT="${SVR_WEB_HTTP_PORT:-38080}"

api_code="$(http_code "http://127.0.0.1:${SVR_HTTP_PORT}/v1/system/version")"
web_code="$(http_code "http://127.0.0.1:${SVR_WEB_HTTP_PORT}/v1/system/version")"
admin_code="$(http_code "http://127.0.0.1:${ADMIN_SVR_HTTP_PORT}/api/v1/admin/ping")"

api_ok=false
web_ok=false
[[ "$api_code" == "200" || "$api_code" == "401" ]] && api_ok=true
[[ "$web_code" == "200" || "$web_code" == "401" ]] && web_ok=true

cpu_running="$(docker inspect "$cpu_container" --format '{{.State.Running}}' 2>/dev/null || echo false)"
exec_running=false
if [[ -n "${executor_container}" ]]; then
  exec_running="$(docker inspect "$executor_container" --format '{{.State.Running}}' 2>/dev/null || echo false)"
fi

echo "[ragflow] codes api=${api_code} web=${web_code} admin=${admin_code}"
echo "[ragflow] containers ragflow-cpu=${cpu_running} task-executor=${exec_running}"

if [[ "$api_ok" == true && "$web_ok" == true ]]; then
  echo "[ragflow] status=ready"
  exit 0
fi

if [[ "$cpu_running" == "true" ]]; then
  echo "[ragflow] status=starting reason=container is running but endpoint is not ready"
  exit 3
fi

echo "[ragflow] status=degraded reason=api endpoint down and container not running"
exit 4
