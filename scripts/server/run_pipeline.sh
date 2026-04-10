#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT_DIR="$ROOT_DIR/scripts/server"
RAW_OUT_DIR="$ROOT_DIR/results"
INTERNAL_OUT_DIR="$ROOT_DIR/results/internal_import"
RAGFLOW_OUT_DIR="$ROOT_DIR/results/ragflow_import"

CONFIG_FILE="${1:-$SCRIPT_DIR/configs/official_principle_sources.yaml}"

echo "[1/4] crawl -> vendor_topic jsonl"
python "$SCRIPT_DIR/rag_knowledge_crawler.py" \
  --config "$CONFIG_FILE" \
  --output "$RAW_OUT_DIR/knowledge_import_tasks.jsonl"

echo "[2/4] validate raw batch"
python "$SCRIPT_DIR/validate_batch.py" --input "$RAW_OUT_DIR" --min-content-chars 200

echo "[3/4] transform for internal api"
python "$SCRIPT_DIR/transform_for_internal.py" --input "$RAW_OUT_DIR" --output-dir "$INTERNAL_OUT_DIR"

echo "[4/4] transform for ragflow"
python "$SCRIPT_DIR/transform_for_ragflow.py" --input "$RAW_OUT_DIR" --output-dir "$RAGFLOW_OUT_DIR"

echo "done"
