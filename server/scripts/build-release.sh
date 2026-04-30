#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"

GOOS="${GOOS:-linux}"
GOARCH="${GOARCH:-amd64}"
CGO_ENABLED="${CGO_ENABLED:-0}"

APP_NAME="${APP_NAME:-lceda-ai-server}"

if command -v git >/dev/null 2>&1 && git -C "${ROOT_DIR}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  VERSION="${VERSION:-$(git -C "${ROOT_DIR}" describe --tags --always --dirty 2>/dev/null || true)}"
else
  VERSION="${VERSION:-}"
fi

if [[ -z "${VERSION}" ]]; then
  VERSION="$(date -u +%Y%m%dT%H%M%SZ)"
fi

OUT_DIR="${DIST_DIR}/${APP_NAME}_${GOOS}_${GOARCH}_${VERSION}"
STAGE_DIR="${OUT_DIR}/bundle"

rm -rf "${OUT_DIR}"
mkdir -p "${STAGE_DIR}"

echo "[build] GOOS=${GOOS} GOARCH=${GOARCH} CGO_ENABLED=${CGO_ENABLED}"
echo "[build] VERSION=${VERSION}"

LDFLAGS="-s -w"
BIN_DIR="${STAGE_DIR}/bin"
mkdir -p "${BIN_DIR}"

(
  cd "${ROOT_DIR}"
  env GOOS="${GOOS}" GOARCH="${GOARCH}" CGO_ENABLED="${CGO_ENABLED}" \
    GOCACHE="${GOCACHE:-/tmp/lceda_ai_go_build_cache}" \
    go build -trimpath -ldflags "${LDFLAGS}" -o "${BIN_DIR}/${APP_NAME}" ./cmd
)

chmod +x "${BIN_DIR}/${APP_NAME}"

mkdir -p "${STAGE_DIR}/configs"
INCLUDE_LOCAL_CONFIG="${INCLUDE_LOCAL_CONFIG:-0}"
if [[ "${INCLUDE_LOCAL_CONFIG}" == "1" ]]; then
  cp -f "${ROOT_DIR}/configs/config.yaml" "${STAGE_DIR}/configs/config.yaml"
else
  if [[ -f "${ROOT_DIR}/configs/config.example.yaml" ]]; then
    cp -f "${ROOT_DIR}/configs/config.example.yaml" "${STAGE_DIR}/configs/config.yaml"
  else
    echo "[warn] configs/config.example.yaml not found; falling back to configs/config.yaml" >&2
    cp -f "${ROOT_DIR}/configs/config.yaml" "${STAGE_DIR}/configs/config.yaml"
  fi
fi

cp -R "${ROOT_DIR}/migrations" "${STAGE_DIR}/migrations"
mkdir -p "${STAGE_DIR}/scripts"
cp -f "${ROOT_DIR}/scripts/apply-migrations.sh" "${STAGE_DIR}/scripts/apply-migrations.sh"

mkdir -p "${STAGE_DIR}/deploy/docker"
cp -f "${ROOT_DIR}/deploy/docker/docker-compose.yml" "${STAGE_DIR}/deploy/docker/docker-compose.yml"
mkdir -p "${STAGE_DIR}/deploy/docker/postgres_data" "${STAGE_DIR}/deploy/docker/redis_data"

if [[ -d "${ROOT_DIR}/deploy/production" ]]; then
  mkdir -p "${STAGE_DIR}/deploy/production"
  cp -R "${ROOT_DIR}/deploy/production/"* "${STAGE_DIR}/deploy/production/" 2>/dev/null || true
fi

if [[ -d "${ROOT_DIR}/deploy/ragflow" ]]; then
  mkdir -p "${STAGE_DIR}/deploy/ragflow"
  # Copy only deployment templates (exclude local data/logs and secrets).
  for f in \
    README.md \
    .env.example \
    docker-compose.yml \
    docker-compose-base.yml \
    docker-compose.single.yml \
    entrypoint.sh \
    healthcheck.sh \
    infinity_conf.toml \
    init.sql \
    service_conf.yaml.template \
    start.sh \
    stop.sh; do
    if [[ -f "${ROOT_DIR}/deploy/ragflow/${f}" ]]; then
      cp -f "${ROOT_DIR}/deploy/ragflow/${f}" "${STAGE_DIR}/deploy/ragflow/${f}"
    fi
  done
  mkdir -p "${STAGE_DIR}/deploy/ragflow/data" "${STAGE_DIR}/deploy/ragflow/ragflow-logs"
fi

cat > "${STAGE_DIR}/run.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

APP_CONFIG="${APP_CONFIG:-${ROOT_DIR}/configs/config.yaml}"
PORT="${PORT:-18082}"

export APP_CONFIG PORT

exec "${ROOT_DIR}/bin/lceda-ai-server"
EOF
chmod +x "${STAGE_DIR}/run.sh"

cat > "${OUT_DIR}/README.txt" <<EOF
${APP_NAME} release bundle

1) Start dependencies (PostgreSQL + Redis):
   cd deploy/docker
   docker compose up -d

2) Apply migrations:
   bash ./scripts/apply-migrations.sh

3) Run server:
   ./run.sh

Notes:
- Set environment variables like DB_* / REDIS_* / BASE_URL / etc as needed.
- APP_CONFIG defaults to ./configs/config.yaml (override with env var).
EOF

TARBALL="${DIST_DIR}/${APP_NAME}_${GOOS}_${GOARCH}_${VERSION}.tar.gz"
(
  cd "${OUT_DIR}"
  tar -czf "${TARBALL}" bundle README.txt
)

echo "[done] ${TARBALL}"
