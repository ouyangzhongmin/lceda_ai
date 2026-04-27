import argparse
import json
from collections import Counter
from pathlib import Path
import re
import sys
from typing import Any

if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from scripts.server.extract_lceda_templates import (
    _read_schematic_file_text,
    extract_templates_from_project,
    parse_schematic_text_tokens,
)


BATTERY_TEMPLATE_TYPES = {"battery_protection", "current_sense", "temperature_sense"}
BMS_CONTEXT_MARKERS = ("bms", "battery", "锂电", "电池", "保护板", "电池组", "pack")
UART_BRIDGE_HINT_PATTERN = re.compile(
    r"(CH340|CH343|CH9102|CP210|PL2303|FT232|USB[\s\-_]*SERIAL|USB[\s\-_]*UART)",
    flags=re.IGNORECASE,
)


def _iter_jsonl(path: Path):
    with path.open("r", encoding="utf-8") as file:
        for line in file:
            line = line.strip()
            if line:
                yield json.loads(line)


def _has_bms_context(project: dict[str, Any]) -> bool:
    text = " ".join(
        [
            str(project.get("title", "")),
            str(project.get("summary", "")),
            str(project.get("raw_page_text", "")),
            " ".join(str(tag) for tag in project.get("tags", []) or []),
            " ".join(str(keyword) for keyword in project.get("keywords", []) or []),
            str(project.get("category", "")),
        ]
    ).lower()
    return any(marker in text for marker in BMS_CONTEXT_MARKERS)


def summarize_template_extraction(
    projects: list[dict[str, Any]],
    templates_by_project: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    template_type_counts: Counter[str] = Counter()
    source_mode_counts: Counter[str] = Counter()
    source_mode_reason_counts: Counter[str] = Counter()
    risk_counts: Counter[str] = Counter()
    projects_with_templates = 0
    project_reports: list[dict[str, Any]] = []
    file_first_signal_profiles: dict[str, dict[str, bool]] = {}

    for project in projects:
        project_id = str(project.get("project_id", ""))
        templates = templates_by_project.get(project_id, [])
        risk_flags: list[str] = []
        source_mode_counts[str(project.get("source_mode", ""))] += 1
        source_mode_reason = str(project.get("source_mode_reason", "")).strip()
        if source_mode_reason:
            source_mode_reason_counts[source_mode_reason] += 1
        if templates:
            projects_with_templates += 1
        for template in templates:
            template_type = str(template.get("template_type", ""))
            if template_type:
                template_type_counts[template_type] += 1
            if template_type in BATTERY_TEMPLATE_TYPES and not _has_bms_context(project):
                risk_key = "battery_templates_without_bms_context"
                risk_counts[risk_key] += 1
                if risk_key not in risk_flags:
                    risk_flags.append(risk_key)
        signal_profile: dict[str, bool] = {}
        if str(project.get("source_mode", "")) == "file_first":
            signal_profile = _profile_file_first_signals(project)
            file_first_signal_profiles[project_id] = signal_profile
            if not signal_profile.get("file_first_with_any_signal", False):
                risk_key = "file_first_without_schematic_signal"
                risk_counts[risk_key] += 1
                if risk_key not in risk_flags:
                    risk_flags.append(risk_key)
        project_reports.append(
            {
                "project_id": project_id,
                "project_url": str(project.get("project_url", "")),
                "title": str(project.get("title", "")),
                "source_mode": str(project.get("source_mode", "")),
                "template_types": [
                    str(template.get("template_type", ""))
                    for template in templates
                    if str(template.get("template_type", ""))
                ],
                "file_first_signal_profile": signal_profile,
                "risk_flags": risk_flags,
            }
        )

    file_first_projects = [project for project in projects if str(project.get("source_mode", "")) == "file_first"]
    file_first_high_signal_projects = [
        project
        for project in file_first_projects
        if (file_first_signal_profiles.get(str(project.get("project_id", ""))) or {}).get("file_first_with_any_signal")
    ]
    file_first_template_type_counts: Counter[str] = Counter()
    file_first_projects_with_templates = 0
    file_first_signal_counts: Counter[str] = Counter()
    for project in file_first_projects:
        project_id = str(project.get("project_id", ""))
        templates = templates_by_project.get(project_id, [])
        if templates:
            file_first_projects_with_templates += 1
        for template in templates:
            template_type = str(template.get("template_type", ""))
            if template_type:
                file_first_template_type_counts[template_type] += 1
        signal_flags = file_first_signal_profiles.get(project_id) or _profile_file_first_signals(project)
        for flag, enabled in signal_flags.items():
            if enabled:
                file_first_signal_counts[flag] += 1
    file_first_total = len(file_first_projects)
    file_first_hit_rate = (
        file_first_projects_with_templates / file_first_total if file_first_total else 0.0
    )
    file_first_high_signal_template_type_counts: Counter[str] = Counter()
    file_first_high_signal_projects_with_templates = 0
    for project in file_first_high_signal_projects:
        project_id = str(project.get("project_id", ""))
        templates = templates_by_project.get(project_id, [])
        if templates:
            file_first_high_signal_projects_with_templates += 1
        for template in templates:
            template_type = str(template.get("template_type", ""))
            if template_type:
                file_first_high_signal_template_type_counts[template_type] += 1
    file_first_high_signal_total = len(file_first_high_signal_projects)
    file_first_high_signal_hit_rate = (
        file_first_high_signal_projects_with_templates / file_first_high_signal_total
        if file_first_high_signal_total
        else 0.0
    )

    return {
        "total_projects": len(projects),
        "projects_with_templates": projects_with_templates,
        "template_type_counts": dict(template_type_counts),
        "source_mode_counts": dict(source_mode_counts),
        "source_mode_reason_counts": dict(source_mode_reason_counts),
        "file_first_subset": {
            "total_projects": file_first_total,
            "projects_with_templates": file_first_projects_with_templates,
            "hit_rate": round(file_first_hit_rate, 4),
            "template_type_counts": dict(file_first_template_type_counts),
            "signal_counts": {
                "file_first_with_any_signal": file_first_signal_counts.get("file_first_with_any_signal", 0),
                "file_first_with_uart_signal": file_first_signal_counts.get("file_first_with_uart_signal", 0),
                "file_first_with_uart_control_signal": file_first_signal_counts.get(
                    "file_first_with_uart_control_signal", 0
                ),
                "file_first_with_uart_bridge_hint": file_first_signal_counts.get(
                    "file_first_with_uart_bridge_hint", 0
                ),
                "file_first_uart_ready": file_first_signal_counts.get("file_first_uart_ready", 0),
            },
        },
        "file_first_high_signal_subset": {
            "total_projects": file_first_high_signal_total,
            "projects_with_templates": file_first_high_signal_projects_with_templates,
            "hit_rate": round(file_first_high_signal_hit_rate, 4),
            "template_type_counts": dict(file_first_high_signal_template_type_counts),
        },
        "project_reports": project_reports,
        "risk_counts": {
            "battery_templates_without_bms_context": risk_counts.get(
                "battery_templates_without_bms_context", 0
            ),
            "file_first_without_schematic_signal": risk_counts.get(
                "file_first_without_schematic_signal", 0
            ),
        },
    }


def _profile_file_first_signals(project: dict[str, Any]) -> dict[str, bool]:
    file_text = _read_schematic_file_text(str(project.get("schematic_file_path", "")))
    if not file_text:
        return {
            "file_first_with_any_signal": False,
            "file_first_with_uart_signal": False,
            "file_first_with_uart_control_signal": False,
            "file_first_with_uart_bridge_hint": False,
            "file_first_uart_ready": False,
        }
    tokens = parse_schematic_text_tokens(file_text)
    normalized_nets = {token.upper() for token in tokens["nets"]}
    normalized_connectors = {token.upper() for token in tokens["connectors"]}
    has_any_signal = bool(tokens["nets"] or tokens["part_values"] or tokens["part_numbers"] or tokens["connectors"])
    has_uart_signal = bool(
        any("UART" in net for net in normalized_nets)
        or any(net in {"TX", "RX", "TXD", "RXD", "U0TXD", "U0RXD", "DTR", "RTS"} for net in normalized_nets)
        or any(net.endswith(("_TX", "_RX", "_TXD", "_RXD")) for net in normalized_nets)
    )
    has_uart_control_signal = bool(
        any(
            net in {"GPIO0", "IO0", "BOOT", "BOOT0", "EN", "RST", "RESET", "CHIP_EN"}
            or net.endswith(("_EN", "_RST", "_RESET", "_BOOT", "_BOOT0", "_IO0", "_GPIO0"))
            for net in normalized_nets
        )
    )
    has_uart_bridge_hint = bool(UART_BRIDGE_HINT_PATTERN.search(file_text))
    has_uart_connector = any(
        "UART" in connector and any(marker in connector for marker in ("HEADER", "CONN", "PAD"))
        for connector in normalized_connectors
    )
    return {
        "file_first_with_any_signal": has_any_signal,
        "file_first_with_uart_signal": has_uart_signal,
        "file_first_with_uart_control_signal": has_uart_control_signal,
        "file_first_with_uart_bridge_hint": has_uart_bridge_hint,
        "file_first_uart_ready": has_uart_signal and has_uart_control_signal and (has_uart_bridge_hint or has_uart_connector),
    }


def evaluate_project_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        summary = summarize_template_extraction([], {})
        summary["input"] = str(path)
        return summary
    projects = list(_iter_jsonl(path))
    templates_by_project: dict[str, list[dict[str, Any]]] = {}
    for project in projects:
        project_id = str(project.get("project_id", ""))
        templates_by_project[project_id] = extract_templates_from_project(project)
    summary = summarize_template_extraction(projects, templates_by_project)
    summary["input"] = str(path)
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate LCEDA template extraction quality on project JSONL")
    parser.add_argument("--input", action="append", required=True, help="Project JSONL to evaluate")
    parser.add_argument("--output", default="", help="Optional JSON summary output path")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    summaries = [evaluate_project_file(Path(item)) for item in args.input]
    payload = {"files": summaries}
    if args.output:
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
