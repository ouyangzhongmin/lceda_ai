#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

FILES_DIR="$ROOT_DIR/results/lceda_open_source_raw/files"
MANIFEST_PATH="$ROOT_DIR/results/lceda_open_source_raw/files_import_manifest.jsonl"
TEMPLATE_OUTPUT="$ROOT_DIR/results/lceda_template_corpus/files_import_manifest.templates.v1.jsonl"
RAGFLOW_OUTPUT="$ROOT_DIR/results/lceda_ragflow_import/files_import_manifest.templates.v1.jsonl"
FAILED_LOG="$ROOT_DIR/results/ragflow_failed_rows.files_import_manifest.v1.jsonl"

BASE_URL=""
API_KEY=""
DATASET_ID=""
DRY_RUN="false"
PARSE_AFTER_UPLOAD="true"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/download/import-local-files-to-ragflow.sh \
    --base-url http://127.0.0.1:39380 \
    --api-key <RAGFLOW_API_KEY> \
    --dataset-id <RAGFLOW_DATASET_ID> \
    [--files-dir ./results/lceda_open_source_raw/files] \
    [--dry-run]

Options:
  --base-url            RAGFlow base URL
  --api-key             RAGFlow API key
  --dataset-id          RAGFlow dataset id
  --files-dir           Local LCEDA file directory, defaults to results/lceda_open_source_raw/files
  --manifest-path       Generated import manifest path
  --template-output     Extracted template JSONL output path
  --ragflow-output      RAGFlow JSONL output path
  --failed-log          Failed import row log path
  --dry-run             Build and validate only, do not upload
  --no-parse            Do not trigger parse after upload
  --help                Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      BASE_URL="${2:-}"
      shift 2
      ;;
    --api-key)
      API_KEY="${2:-}"
      shift 2
      ;;
    --dataset-id)
      DATASET_ID="${2:-}"
      shift 2
      ;;
    --files-dir)
      FILES_DIR="$(cd "$ROOT_DIR" && python -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "${2:-}")"
      shift 2
      ;;
    --manifest-path)
      MANIFEST_PATH="$(cd "$ROOT_DIR" && python -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "${2:-}")"
      shift 2
      ;;
    --template-output)
      TEMPLATE_OUTPUT="$(cd "$ROOT_DIR" && python -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "${2:-}")"
      shift 2
      ;;
    --ragflow-output)
      RAGFLOW_OUTPUT="$(cd "$ROOT_DIR" && python -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "${2:-}")"
      shift 2
      ;;
    --failed-log)
      FAILED_LOG="$(cd "$ROOT_DIR" && python -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "${2:-}")"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    --no-parse)
      PARSE_AFTER_UPLOAD="false"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ ! -d "$FILES_DIR" ]]; then
  echo "files directory not found: $FILES_DIR" >&2
  exit 1
fi

if [[ "$DRY_RUN" != "true" ]]; then
  if [[ -z "$BASE_URL" || -z "$API_KEY" || -z "$DATASET_ID" ]]; then
    echo "--base-url, --api-key, and --dataset-id are required unless --dry-run is used" >&2
    exit 1
  fi
fi

mkdir -p "$(dirname "$MANIFEST_PATH")" "$(dirname "$TEMPLATE_OUTPUT")" "$(dirname "$RAGFLOW_OUTPUT")" "$(dirname "$FAILED_LOG")"

cd "$ROOT_DIR"

python - "$FILES_DIR" "$MANIFEST_PATH" <<'PY'
import json
import sys
from pathlib import Path

files_dir = Path(sys.argv[1])
manifest_path = Path(sys.argv[2])
rows = []

for idx, file_path in enumerate(sorted(files_dir.glob("*.epro2")), start=1):
    rows.append(
        {
            "project_id": f"local-files-{idx:03d}",
            "project_url": f"https://oshwhub.com/local/{file_path.stem}",
            "title": file_path.stem,
            "summary": file_path.stem,
            "raw_page_text": file_path.stem,
            "schematic_file_path": str(file_path.resolve()),
            "source_mode": "file_first",
            "tags": [],
            "keywords": [],
            "category": "local_file_import",
        }
    )

manifest_path.write_text(
    "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
    encoding="utf-8",
)
print(f"[manifest] rows={len(rows)} -> {manifest_path}")
PY

python scripts/server/extract_lceda_templates.py \
  --input "$MANIFEST_PATH" \
  --output "$TEMPLATE_OUTPUT"

python scripts/server/transform_lceda_templates_for_ragflow.py \
  --input "$TEMPLATE_OUTPUT" \
  --output "$RAGFLOW_OUTPUT"

IMPORT_ARGS=(
  python
  scripts/server/ragflow_importer.py
  --input "$RAGFLOW_OUTPUT"
  --failed-log "$FAILED_LOG"
)

if [[ "$DRY_RUN" == "true" ]]; then
  IMPORT_ARGS+=(
    --base-url "${BASE_URL:-http://127.0.0.1:39380}"
    --api-key "${API_KEY:-dry-run-key}"
    --dataset-id "${DATASET_ID:-dry-run-dataset}"
    --dry-run
  )
else
  IMPORT_ARGS+=(
    --base-url "$BASE_URL"
    --api-key "$API_KEY"
    --dataset-id "$DATASET_ID"
    --retries 3
    --retry-backoff-seconds 0.8
    --replace-existing-by-title
  )
  if [[ "$PARSE_AFTER_UPLOAD" == "true" ]]; then
    IMPORT_ARGS+=(--parse-after-upload)
  fi
fi

"${IMPORT_ARGS[@]}"
