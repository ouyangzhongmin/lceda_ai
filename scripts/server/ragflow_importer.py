import argparse
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests


@dataclass
class ImportStats:
    file_count: int = 0
    row_count: int = 0
    success_count: int = 0
    fail_count: int = 0
    retry_count: int = 0
    deleted_count: int = 0


def emit_log(enabled: bool, msg: str) -> None:
    if enabled:
        print(msg)


def load_input_files(input_path: Path) -> list[Path]:
    if input_path.is_file():
        return [input_path]
    return sorted(input_path.glob("*.jsonl"))


def iter_jsonl_rows(path: Path):
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            yield json.loads(line)


def build_endpoint(base_url: str, endpoint_template: str, dataset_id: str) -> str:
    base = base_url.rstrip("/")
    endpoint = endpoint_template.format(dataset_id=dataset_id)
    if not endpoint.startswith("/"):
        endpoint = "/" + endpoint
    return base + endpoint


def _sanitize_filename(value: str) -> str:
    text = (value or "untitled").strip()
    text = re.sub(r"[\\/:*?\"<>|]+", "-", text)
    text = re.sub(r"\s+", "-", text)
    text = text.strip("-")
    return (text or "untitled")[:120]


def _row_identity_key(row: dict[str, Any]) -> str:
    metadata = row.get("metadata", {}) if isinstance(row.get("metadata", {}), dict) else {}
    for key in ("idempotency_key", "source_ref", "template_id"):
        value = str(metadata.get(key, "")).strip()
        if value:
            return value
    for key in ("idempotency_key", "source_ref", "title"):
        value = str(row.get(key, "")).strip()
        if value:
            return value
    return str(row.get("title", "untitled")).strip() or "untitled"


def build_row_file_name(row: dict[str, Any]) -> str:
    identity = _row_identity_key(row)
    return _sanitize_filename(identity) + ".md"


def build_legacy_title_file_name(row: dict[str, Any]) -> str:
    title = str(row.get("title", "untitled")).strip() or "untitled"
    return _sanitize_filename(title) + ".md"


def _list_existing_documents(
    session: requests.Session,
    endpoint: str,
    headers: dict[str, str],
    timeout_seconds: int,
) -> list[dict[str, Any]]:
    docs: list[dict[str, Any]] = []
    page = 1
    page_size = 100
    while True:
        resp = session.get(
            endpoint,
            headers=headers,
            params={"page": page, "page_size": page_size},
            timeout=timeout_seconds,
        )
        resp.raise_for_status()
        body = resp.json()
        if isinstance(body, dict) and body.get("code") not in (0, "0", None):
            raise RuntimeError(f"list documents failed: {resp.text}")
        data = body.get("data", {}) if isinstance(body, dict) else {}
        batch = data.get("docs", []) if isinstance(data, dict) else []
        if not isinstance(batch, list) or not batch:
            break
        docs.extend(item for item in batch if isinstance(item, dict))
        total = int(data.get("total", len(docs))) if isinstance(data, dict) else len(docs)
        if len(docs) >= total or len(batch) < page_size:
            break
        page += 1
    return docs


def _filename_stem_key(filename: str) -> str:
    text = str(filename or "").strip()
    if text.lower().endswith(".md"):
        text = text[:-3]
    text = re.sub(r"\(\d+\)$", "", text)
    return text


def _find_existing_document_ids_by_row(
    session: requests.Session,
    endpoint: str,
    headers: dict[str, str],
    timeout_seconds: int,
    row: dict[str, Any],
) -> list[str]:
    target_keys = {
        _filename_stem_key(build_row_file_name(row)),
        _filename_stem_key(build_legacy_title_file_name(row)),
    }
    matches: list[str] = []
    for item in _list_existing_documents(session, endpoint, headers, timeout_seconds):
        doc_id = str(item.get("id", "")).strip()
        doc_name = str(item.get("name", "") or item.get("location", "")).strip()
        if not doc_id or not doc_name:
            continue
        if _filename_stem_key(doc_name) in target_keys:
            matches.append(doc_id)
    return matches


def _delete_documents(
    session: requests.Session,
    endpoint: str,
    headers: dict[str, str],
    timeout_seconds: int,
    document_ids: list[str],
) -> int:
    if not document_ids:
        return 0
    resp = session.delete(
        endpoint,
        headers={**headers, "Content-Type": "application/json"},
        json={"ids": document_ids},
        timeout=timeout_seconds,
    )
    resp.raise_for_status()
    body = resp.json()
    if isinstance(body, dict) and body.get("code") not in (0, "0", None):
        raise RuntimeError(f"delete failed: {resp.text}")
    return len(document_ids)


def _build_markdown_doc(row: dict[str, Any]) -> str:
    title = str(row.get("title", "untitled")).strip() or "untitled"
    content = str(row.get("content", "")).strip()
    metadata = row.get("metadata", {})
    md = [f"# {title}", "", content]
    if metadata:
        md.extend(["", "---", "metadata:", "```json", json.dumps(metadata, ensure_ascii=False), "```"])
    return "\n".join(md).strip() + "\n"


def _is_success_response(resp: requests.Response) -> bool:
    try:
        body = resp.json()
    except Exception:
        return True
    if isinstance(body, dict) and "code" in body and body.get("code") not in (0, "0", None):
        return False
    return True


def _extract_document_ids(resp: requests.Response) -> list[str]:
    try:
        body = resp.json()
    except Exception:
        return []
    data = body.get("data") if isinstance(body, dict) else None
    if isinstance(data, list):
        out: list[str] = []
        for item in data:
            if isinstance(item, dict) and item.get("id"):
                out.append(str(item["id"]))
        return out
    if isinstance(data, dict) and data.get("id"):
        return [str(data["id"])]
    return []


def trigger_parse(
    session: requests.Session,
    parse_endpoint: str,
    headers: dict[str, str],
    timeout_seconds: int,
    document_ids: list[str],
) -> None:
    if not document_ids:
        return
    resp = session.post(
        parse_endpoint,
        headers={**headers, "Content-Type": "application/json"},
        json={"document_ids": document_ids},
        timeout=timeout_seconds,
    )
    resp.raise_for_status()
    if not _is_success_response(resp):
        raise RuntimeError(f"parse failed: {resp.text}")


def send_one_row(
    session: requests.Session,
    method: str,
    endpoint: str,
    row: dict[str, Any],
    headers: dict[str, str],
    timeout_seconds: int,
    retries: int,
    retry_backoff_seconds: float,
    stats: ImportStats,
    dry_run: bool,
    parse_after_upload: bool,
    parse_endpoint: str,
    replace_existing_by_title: bool,
) -> bool:
    if dry_run:
        stats.success_count += 1
        return True

    file_name = build_row_file_name(row)
    payload_text = _build_markdown_doc(row)

    attempts = 0
    while attempts <= retries:
        attempts += 1
        try:
            if attempts == 1 and replace_existing_by_title:
                deleted = _delete_documents(
                    session=session,
                    endpoint=endpoint,
                    headers=headers,
                    timeout_seconds=timeout_seconds,
                    document_ids=_find_existing_document_ids_by_row(
                        session=session,
                        endpoint=endpoint,
                        headers=headers,
                        timeout_seconds=timeout_seconds,
                        row=row,
                    ),
                )
                stats.deleted_count += deleted
            resp = session.request(
                method=method,
                url=endpoint,
                headers=headers,
                files={"file": (file_name, payload_text.encode("utf-8"), "text/markdown")},
                timeout=timeout_seconds,
            )
            resp.raise_for_status()
            if not _is_success_response(resp):
                raise RuntimeError(f"upload failed: {resp.text}")
            if parse_after_upload:
                trigger_parse(
                    session=session,
                    parse_endpoint=parse_endpoint,
                    headers=headers,
                    timeout_seconds=timeout_seconds,
                    document_ids=_extract_document_ids(resp),
                )
            stats.success_count += 1
            return True
        except Exception:
            if attempts <= retries:
                stats.retry_count += 1
                if retry_backoff_seconds > 0:
                    time.sleep(retry_backoff_seconds)
            else:
                stats.fail_count += 1
                return False
    return False


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Batch import JSONL records into RAGFlow API")
    p.add_argument("--input", required=True, help="Input .jsonl file or directory")
    p.add_argument("--base-url", required=True, help="RAGFlow base URL, e.g. http://127.0.0.1:39380")
    p.add_argument("--api-key", required=True, help="RAGFlow API key")
    p.add_argument("--dataset-id", required=True, help="RAGFlow dataset id")
    p.add_argument(
        "--endpoint-template",
        default="/api/v1/datasets/{dataset_id}/documents",
        help="Endpoint template with {dataset_id}",
    )
    p.add_argument(
        "--parse-endpoint-template",
        default="/api/v1/datasets/{dataset_id}/chunks",
        help="Parse endpoint template with {dataset_id}",
    )
    p.add_argument("--method", default="POST", choices=["POST", "PUT"])
    p.add_argument("--parse-after-upload", action="store_true", help="Trigger parsing after each uploaded document")
    p.add_argument("--timeout-seconds", type=int, default=20)
    p.add_argument("--retries", type=int, default=2)
    p.add_argument("--retry-backoff-seconds", type=float, default=0.5)
    p.add_argument("--failed-log", default="", help="Path to failed rows jsonl")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--quiet", action="store_true")
    p.add_argument(
        "--replace-existing-by-title",
        action="store_true",
        help="Delete existing docs with the same generated markdown file identity before upload",
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()
    input_path = Path(args.input)
    files = load_input_files(input_path)
    if not files:
        print("no input files")
        return

    endpoint = build_endpoint(args.base_url, args.endpoint_template, args.dataset_id)
    parse_endpoint = build_endpoint(args.base_url, args.parse_endpoint_template, args.dataset_id)
    headers = {"Authorization": f"Bearer {args.api_key}"}

    fail_path = Path(args.failed_log) if args.failed_log else None
    if fail_path:
        fail_path.parent.mkdir(parents=True, exist_ok=True)
        fail_path.write_text("", encoding="utf-8")

    stats = ImportStats(file_count=len(files))
    session = requests.Session()

    emit_log(
        not args.quiet,
        (
            f"[init] files={len(files)} endpoint={endpoint} parse_endpoint={parse_endpoint} "
            f"parse_after_upload={args.parse_after_upload} dry_run={args.dry_run}"
        ),
    )
    for fp in files:
        emit_log(not args.quiet, f"[file] {fp}")
        for row in iter_jsonl_rows(fp):
            stats.row_count += 1
            ok = send_one_row(
                session=session,
                method=args.method,
                endpoint=endpoint,
                row=row,
                headers=headers,
                timeout_seconds=args.timeout_seconds,
                retries=args.retries,
                retry_backoff_seconds=args.retry_backoff_seconds,
                stats=stats,
                dry_run=args.dry_run,
                parse_after_upload=args.parse_after_upload,
                parse_endpoint=parse_endpoint,
                replace_existing_by_title=args.replace_existing_by_title,
            )
            if not ok and fail_path:
                with fail_path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(row, ensure_ascii=False) + "\n")

    summary = {
        "files": stats.file_count,
        "rows": stats.row_count,
        "success": stats.success_count,
        "fail": stats.fail_count,
        "retry": stats.retry_count,
        "deleted": stats.deleted_count,
    }
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
