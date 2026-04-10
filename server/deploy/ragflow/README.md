# RAGFlow Deployment (Local)
默认是：
账号：admin@ragflow.io
密码：admin
This directory provides a local RAGFlow deployment for development.

## 1) Prerequisites

- Docker Engine + Docker Compose (`docker-compose` v1 or `docker compose` v2)
- At least 8GB RAM recommended (4GB minimum for light usage)

## 2) First-time setup

```bash
cd deploy/ragflow
cp .env.example .env
```

Update passwords in `.env` before startup.

## 3) Start

```bash
./start.sh
# Or run directly (choose one):
# docker-compose -f docker-compose-base.yml -f docker-compose.yml up -d
# docker compose -f docker-compose-base.yml -f docker-compose.yml up -d
```

After startup:

- Web UI: `http://127.0.0.1:38080`
- API: `http://127.0.0.1:39380`
- Admin API: `http://127.0.0.1:39381`

## 4) Stop

```bash
./stop.sh
# Or run directly (choose one):
# docker-compose -f docker-compose-base.yml -f docker-compose.yml down
# docker compose -f docker-compose-base.yml -f docker-compose.yml down
```

## 5) Logs

```bash
docker-compose -f docker-compose-base.yml -f docker-compose.yml logs -f ragflow-cpu
```

## 6) Health Check (recommended)

```bash
cd server/deploy/ragflow
./healthcheck.sh
```

Expected:

- `status=ready`: usable.
- `status=starting`: still initializing (wait and retry).
- `status=degraded`: API process is down, check container logs.

## 7) Notes

- Default profile is `elasticsearch + cpu`.
- If you want OpenSearch/Infinity, change `DOC_ENGINE` in `.env`.
- If you want GPU, set `DEVICE=gpu` (and ensure NVIDIA runtime is available).
