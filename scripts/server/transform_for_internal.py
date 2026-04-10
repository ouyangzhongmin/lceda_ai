import argparse
import json
from pathlib import Path
from typing import Any


def to_internal_record(row: dict[str, Any]) -> dict[str, Any]:
    source_ref = str(row.get("source_ref", "")).strip()
    return {
        "kb_type": row.get("kb_type", "principle"),
        "title": row.get("title", "untitled"),
        "source_type": row.get("source_type", "official_doc"),
        "source_ref": source_ref,
        "lang": row.get("lang", "zh-CN"),
        "content": row.get("content", ""),
        "idempotency_key": row.get("idempotency_key") or source_ref,
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
    p = argparse.ArgumentParser(description="Transform crawler JSONL to internal import-task JSONL")
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
        rows = [to_internal_record(r) for r in _iter_rows(fp)]
        out = out_dir / fp.name
        _write_rows(out, rows)
        print(f"[internal] {fp.name} rows={len(rows)} -> {out}")


if __name__ == "__main__":
    main()
