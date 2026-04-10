import argparse
import json
from pathlib import Path
from typing import Any


def summarize_rows(rows: list[dict[str, Any]], min_content_chars: int = 200) -> dict[str, Any]:
    total = len(rows)
    valid_content_count = 0
    traceable_count = 0
    kb_tag_count = 0

    for r in rows:
        content = str(r.get("content", ""))
        source_ref = str(r.get("source_ref", "")).strip()
        kb_type = str(r.get("kb_type", "")).strip()
        if len(content) >= min_content_chars:
            valid_content_count += 1
        if source_ref:
            traceable_count += 1
        if kb_type:
            kb_tag_count += 1

    def rate(x: int) -> float:
        return round((x / total) * 100, 2) if total else 0.0

    return {
        "total": total,
        "valid_content_count": valid_content_count,
        "valid_content_rate": rate(valid_content_count),
        "traceable_count": traceable_count,
        "traceable_rate": rate(traceable_count),
        "kb_tag_count": kb_tag_count,
        "kb_tag_rate": rate(kb_tag_count),
        "min_content_chars": min_content_chars,
    }


def _iter_rows(path: Path):
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            yield json.loads(line)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Validate JSONL knowledge batch quality")
    p.add_argument("--input", required=True, help="Input file or directory with .jsonl files")
    p.add_argument("--min-content-chars", type=int, default=200)
    return p.parse_args()


def main() -> None:
    args = parse_args()
    in_path = Path(args.input)
    files = [in_path] if in_path.is_file() else sorted(in_path.glob("*.jsonl"))
    if not files:
        print("no input files")
        return

    for fp in files:
        rows = list(_iter_rows(fp))
        s = summarize_rows(rows, min_content_chars=args.min_content_chars)
        print(json.dumps({"file": fp.name, **s}, ensure_ascii=False))


if __name__ == "__main__":
    main()
