import argparse
import json
from typing import Any

import requests


def _request_json(method: str, url: str, headers: dict[str, str], payload: dict[str, Any] | None = None) -> dict[str, Any]:
    resp = requests.request(method=method, url=url, headers=headers, json=payload, timeout=30)
    resp.raise_for_status()
    try:
        body = resp.json()
    except Exception as exc:
        raise RuntimeError(f"non-json response: {resp.text[:300]}") from exc
    if isinstance(body, dict) and body.get("code") not in (0, "0", None):
        raise RuntimeError(f"api error code={body.get('code')} message={body.get('message')}")
    return body if isinstance(body, dict) else {}


def _build_url(base_url: str, path: str) -> str:
    base = base_url.rstrip("/")
    p = path if path.startswith("/") else f"/{path}"
    return f"{base}{p}"


def _list_doc_ids(base_url: str, dataset_id: str, headers: dict[str, str], page_size: int = 100) -> list[str]:
    url = _build_url(base_url, f"/api/v1/datasets/{dataset_id}/documents")
    page = 1
    ids: list[str] = []
    while True:
        body = _request_json("GET", f"{url}?page={page}&page_size={page_size}", headers)
        data = body.get("data", {})
        docs = data.get("docs") if isinstance(data, dict) else None
        if not isinstance(docs, list) or not docs:
            break
        for item in docs:
            if isinstance(item, dict) and item.get("id"):
                ids.append(str(item["id"]))
        total = int(data.get("total", 0)) if isinstance(data, dict) else 0
        if len(ids) >= total:
            break
        page += 1
    return ids


def _chunked(items: list[str], size: int) -> list[list[str]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Trigger parse for existing RAGFlow documents.")
    p.add_argument("--base-url", required=True, help="e.g. http://127.0.0.1:39380")
    p.add_argument("--api-key", required=True)
    p.add_argument("--dataset-id", required=True)
    p.add_argument("--batch-size", type=int, default=20)
    p.add_argument("--dry-run", action="store_true")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    headers = {"Authorization": f"Bearer {args.api_key}", "Content-Type": "application/json"}
    parse_url = _build_url(args.base_url, f"/api/v1/datasets/{args.dataset_id}/chunks")

    doc_ids = _list_doc_ids(args.base_url, args.dataset_id, headers)
    print(f"[init] docs={len(doc_ids)} parse_url={parse_url} dry_run={args.dry_run}")
    if not doc_ids:
        print(json.dumps({"docs": 0, "submitted_batches": 0}, ensure_ascii=False))
        return

    submitted = 0
    for idx, batch in enumerate(_chunked(doc_ids, args.batch_size), start=1):
        print(f"[batch] {idx} size={len(batch)}")
        if args.dry_run:
            continue
        _request_json("POST", parse_url, headers, {"document_ids": batch})
        submitted += 1

    print(json.dumps({"docs": len(doc_ids), "submitted_batches": submitted}, ensure_ascii=False))


if __name__ == "__main__":
    main()
