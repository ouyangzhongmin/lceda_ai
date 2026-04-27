import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scripts.server.extract_lceda_templates import _extract_epru_sheet_blocks


def summarize_sheet(block: dict[str, Any]) -> dict[str, Any]:
    part_attrs: dict[str, dict[str, Any]] = defaultdict(dict)
    wire_net_names: list[dict[str, Any]] = []
    attr_key_counter: Counter[str] = Counter()
    record_type_counter: Counter[str] = Counter()

    for record in block.get("records", []):
        rec_type = str(record.get("type", "")).upper()
        record_type_counter[rec_type] += 1
        if rec_type == "ATTR":
            key = str(record.get("key", "")).strip()
            parent_id = str(record.get("parentId", "")).strip()
            value = record.get("value", "")
            if key:
                attr_key_counter[key] += 1
            if parent_id and key and value not in (None, ""):
                part_attrs[parent_id][key] = value
            if key in {"NET", "Global Net Name"}:
                wire_net_names.append(
                    {
                        "parent_id": parent_id,
                        "key": key,
                        "value": value,
                        "x": record.get("x"),
                        "y": record.get("y"),
                    }
                )

    components = []
    for part_id, attrs in part_attrs.items():
        designator = str(attrs.get("Designator", "")).strip()
        value = str(attrs.get("Value", "")).strip()
        device = str(attrs.get("Device", "")).strip()
        footprint = str(attrs.get("Footprint", "")).strip()
        name = str(attrs.get("Name", "")).strip()
        if not any([designator, value, device, footprint, name]):
            continue
        components.append(
            {
                "part_id": part_id,
                "designator": designator,
                "value": value,
                "name": name,
                "device": device,
                "footprint": footprint,
            }
        )

    components.sort(key=lambda item: (item["designator"] or item["part_id"]))
    nets = sorted(
        {
            str(item.get("value", "")).strip().upper()
            for item in wire_net_names
            if str(item.get("value", "")).strip()
        }
    )

    return {
        "sheet_title": block.get("title", "") or str(block.get("uuid", "")),
        "doc_type": block.get("docType", ""),
        "uuid": block.get("uuid", ""),
        "record_type_counts": dict(record_type_counter),
        "attr_key_counts": dict(attr_key_counter.most_common(40)),
        "component_count": len(components),
        "components": components[:200],
        "net_count": len(nets),
        "nets": nets[:200],
        "net_labels": wire_net_names[:200],
    }


def inspect_file(file_path: Path) -> dict[str, Any]:
    blocks = _extract_epru_sheet_blocks(str(file_path))
    return {
        "file_path": str(file_path),
        "sheet_count": len(blocks),
        "sheets": [summarize_sheet(block) for block in blocks],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inspect structured content from an LCEDA .epro2 file")
    parser.add_argument("--input", required=True, help="Path to .epro2 file")
    parser.add_argument("--output", default="", help="Optional JSON output path")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = inspect_file(Path(args.input))
    payload = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(payload + "\n", encoding="utf-8")
        print(out)
        return
    print(payload)


if __name__ == "__main__":
    main()
