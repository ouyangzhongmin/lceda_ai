import argparse
import json
import sys
from pathlib import Path

import requests

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scripts.server.ragflow_importer import build_endpoint, build_row_file_name, iter_jsonl_rows
from scripts.server.ragflow_importer import build_legacy_title_file_name


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Audit which local JSONL rows map to existing RAGFlow docs")
    p.add_argument("--input", required=True, help="Input .jsonl file")
    p.add_argument("--base-url", required=True, help="RAGFlow base URL")
    p.add_argument("--api-key", required=True, help="RAGFlow API key")
    p.add_argument("--dataset-id", required=True, help="RAGFlow dataset id")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    endpoint = build_endpoint(args.base_url, "/api/v1/datasets/{dataset_id}/documents", args.dataset_id)
    headers = {"Authorization": f"Bearer {args.api_key}"}

    resp = requests.get(endpoint, headers=headers, params={"page": 1, "page_size": 500}, timeout=30)
    resp.raise_for_status()
    body = resp.json()
    docs = ((body.get("data") or {}).get("docs") or []) if isinstance(body, dict) else []
    by_stem: dict[str, list[str]] = {}
    for doc in docs:
        name = str(doc.get("name", "") or doc.get("location", "")).strip()
        doc_id = str(doc.get("id", "")).strip()
        if not name or not doc_id:
            continue
        stem = name[:-3] if name.lower().endswith(".md") else name
        if stem.endswith(")") and "(" in stem:
            base, suffix = stem.rsplit("(", 1)
            if suffix[:-1].isdigit():
                stem = base.rstrip()
        by_stem.setdefault(stem, []).append(doc_id)

    out = []
    for row in iter_jsonl_rows(Path(args.input)):
        file_name = build_row_file_name(row)
        legacy_file_name = build_legacy_title_file_name(row)
        candidate_stems = []
        for name in (file_name, legacy_file_name):
            stem = name[:-3] if name.lower().endswith(".md") else name
            if stem not in candidate_stems:
                candidate_stems.append(stem)
        matched_ids = []
        for stem in candidate_stems:
            for doc_id in by_stem.get(stem, []):
                if doc_id not in matched_ids:
                    matched_ids.append(doc_id)
        out.append(
            {
                "title": row.get("title", ""),
                "file_name": file_name,
                "legacy_file_name": legacy_file_name,
                "matched_document_ids": matched_ids,
                "match_count": len(matched_ids),
            }
        )

    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
