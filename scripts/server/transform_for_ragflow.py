import argparse
import json
from pathlib import Path
from typing import Any


def _guess_vendor_from_source_ref(source_ref: str) -> str:
    if not source_ref:
        return "unknown"
    parts = source_ref.split("-")
    return parts[0].replace("www.", "") if parts else "unknown"


def _guess_topic_from_title(title: str) -> str:
    if not title:
        return "general"
    return title.split("|")[0].strip().lower().replace(" ", "-")


def to_ragflow_record(row: dict[str, Any]) -> dict[str, Any]:
    source_ref = str(row.get("source_ref", "")).strip()
    title = str(row.get("title", "untitled")).strip()
    return {
        "title": title,
        "content": row.get("content", ""),
        "metadata": {
            "kb_type": row.get("kb_type", "principle"),
            "source_type": row.get("source_type", "official_doc"),
            "source_ref": source_ref,
            "lang": row.get("lang", "zh-CN"),
            "vendor": _guess_vendor_from_source_ref(source_ref),
            "topic": _guess_topic_from_title(title),
            "idempotency_key": row.get("idempotency_key") or source_ref,
        },
    }


def _iter_rows(path: Path):
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            yield json.loads(line)


def _write_rows(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Transform crawler JSONL to RAGFlow-oriented JSONL")
    p.add_argument("--input", required=True, help="Input file or directory with .jsonl files")
    p.add_argument("--output-dir", required=True, help="Output directory")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    in_path = Path(args.input)
    out_dir = Path(args.output_dir)

    files = [in_path] if in_path.is_file() else sorted(in_path.glob("*.jsonl"))
    if not files:
        print("no input files")
        return

    for fp in files:
        rows = [to_ragflow_record(r) for r in _iter_rows(fp)]
        out = out_dir / fp.name
        _write_rows(out, rows)
        print(f"[ragflow] {fp.name} rows={len(rows)} -> {out}")


if __name__ == "__main__":
    main()
