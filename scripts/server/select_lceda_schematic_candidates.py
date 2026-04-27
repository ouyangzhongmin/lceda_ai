import argparse
import json
from pathlib import Path


TITLE_POSITIVE_HINTS = (
    "esp32",
    "rp2040",
    "stm32",
    "stc",
    "st-link",
    "stlink",
    "开发板",
    "主控",
    "控制板",
    "飞控",
    "模块",
    "电源",
    "电压",
    "usb",
    "pd",
    "焊台",
)

ATTACHMENT_POSITIVE_HINTS = (
    "source",
    "schematic",
    "project",
    "sch",
    "pcb",
    "工程",
    "源码",
    "制作包",
    "开源",
)

ATTACHMENT_NEGATIVE_HINTS = (
    "firmware",
    "flash_download_tool",
    "固件",
    "ibom",
    "焊接图",
    "外壳",
    "模型",
    "stl",
    "3d",
    "render",
    "preview",
    "logo",
    "readme",
    "manual",
    "doc",
)


def _score_entry(entry: dict) -> int:
    score = 0
    title = str(entry.get("title", "")).lower()
    if any(hint in title for hint in TITLE_POSITIVE_HINTS):
        score += 2
    attachments = entry.get("attachments") or []
    has_positive_attachment = False
    has_only_negative = bool(attachments)
    for attachment in attachments:
        name = str((attachment or {}).get("name", "")).lower()
        raw = str((attachment or {}).get("raw", "")).lower()
        combined = f"{name} {raw}"
        if any(hint in combined for hint in ATTACHMENT_POSITIVE_HINTS):
            has_positive_attachment = True
        if not any(hint in combined for hint in ATTACHMENT_NEGATIVE_HINTS):
            has_only_negative = False
    if has_positive_attachment:
        score += 2
    if has_only_negative:
        score -= 3
    return score


def main() -> None:
    parser = argparse.ArgumentParser(description="Select higher-probability schematic candidates from attachment pool")
    parser.add_argument("--input", required=True, help="Input candidate JSON array")
    parser.add_argument("--output", required=True, help="Output candidate JSON array")
    parser.add_argument("--min-score", type=int, default=2, help="Minimum score threshold")
    args = parser.parse_args()

    src = Path(args.input)
    items = json.loads(src.read_text(encoding="utf-8"))
    selected = []
    for item in items:
        score = _score_entry(item)
        if score >= args.min_score:
            enriched = dict(item)
            enriched["selection_score"] = score
            selected.append(enriched)
    selected.sort(key=lambda row: row.get("selection_score", 0), reverse=True)

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(selected, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "input_total": len(items),
                "selected_total": len(selected),
                "min_score": args.min_score,
                "output": str(out),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
