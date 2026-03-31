#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_NAME="${POSTGRES_CONTAINER_NAME:-lceda-ai-postgres}"
POSTGRES_DB="${POSTGRES_DB:-lceda_ai}"
POSTGRES_USER="${POSTGRES_USER:-lceda}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker command not found" >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "${CONTAINER_NAME}"; then
  echo "postgres container '${CONTAINER_NAME}' is not running" >&2
  echo "start it with: docker compose up -d postgres" >&2
  exit 1
fi

shopt -s nullglob
migration_files=("${ROOT_DIR}"/migrations/*.sql)
shopt -u nullglob

if [ "${#migration_files[@]}" -eq 0 ]; then
  echo "no migration files found in ${ROOT_DIR}/migrations" >&2
  exit 1
fi

for file in "${migration_files[@]}"; do
  echo "applying $(basename "${file}")"
  docker exec -i "${CONTAINER_NAME}" psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" < "${file}"
done

echo "all migrations applied"
