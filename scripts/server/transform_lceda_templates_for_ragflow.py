import argparse
import json
import re
from pathlib import Path
from typing import Any


def _template_title(template: dict[str, Any]) -> str:
    anchor = str(template.get("anchor_device_model") or template.get("anchor_device_family") or "Generic")
    return f"{anchor} {template.get('template_type', 'template')} template"


def _normalize_text_list(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    normalized: list[str] = []
    for value in values:
        text = re.sub(r"\s+", " ", str(value or "")).strip()
        if text:
            normalized.append(text)
    return normalized


def _render_chain_line(chain: dict[str, Any]) -> str:
    sheet_title = str(chain.get("sheet_title", "")).strip()
    anchor = str(chain.get("anchor_net", "")).strip()
    to_power = str(chain.get("to_power_net", "")).strip()
    passive_refdes = [str(v).strip() for v in chain.get("passive_refdes", []) if str(v).strip()]
    passive_values = [str(v).strip() for v in chain.get("passive_values", []) if str(v).strip()]
    middle = passive_refdes or passive_values or ["R/C"]
    prefix = f"{sheet_title}: " if sheet_title else ""
    if anchor and to_power:
        return f"{prefix}{anchor} -> {' / '.join(middle)} -> {to_power}"
    return ""


def _template_content(template: dict[str, Any]) -> str:
    component_values = [
        str(component.get("value", ""))
        for component in template.get("components", [])
        if component.get("value")
    ]
    nets = [
        f"{binding.get('net')} -> {binding.get('target')}"
        for binding in template.get("pin_bindings", [])
        if binding.get("net") or binding.get("target")
    ]
    source_project = template.get("source_project") or {}
    quality_detail = template.get("quality_detail") or {}
    scoring = template.get("scoring") or {}
    lcsc_codes = quality_detail.get("lcsc_part_codes") or []
    retrieval_score = template.get("retrieval_priority_score", template.get("quality_score", 0))
    connection_chains = quality_detail.get("connection_chains") or (template.get("default_values", {}) or {}).get("connection_chains", []) or []
    rendered_chains = [line for line in (_render_chain_line(chain) for chain in connection_chains[:8]) if line]
    score_reasons = _normalize_text_list(scoring.get("score_reasons"))
    intent_tags = _normalize_text_list(scoring.get("intent_tags"))
    parts = [
        _template_title(template),
        f"Template type: {template.get('template_type', '')}",
        f"Scenario tags: {', '.join(template.get('scenario_tags', []))}",
        f"Components: {', '.join(component_values)}",
        f"Pin bindings: {'; '.join(nets)}",
        "连接链:" if rendered_chains else "",
        *[f"- {line}" for line in rendered_chains],
        f"Retrieval priority score: {retrieval_score}",
        f"LCSC part codes: {', '.join(lcsc_codes)}",
        f"Source project: {source_project.get('title', '')} {source_project.get('project_url', '')}",
    ]
    if "static_quality_score" in scoring:
        parts.insert(5, f"Static quality score: {scoring.get('static_quality_score')}")
    if intent_tags:
        insert_at = 6 if "static_quality_score" in scoring else 5
        parts.insert(insert_at, f"Intent tags: {', '.join(intent_tags)}")
    if score_reasons:
        insert_at = 7 if "static_quality_score" in scoring and intent_tags else 6 if ("static_quality_score" in scoring or intent_tags) else 5
        parts.insert(insert_at, f"Score reasons: {', '.join(score_reasons)}")
    return "\n".join(part for part in parts if part.strip())


def to_ragflow_template_record(template: dict[str, Any]) -> dict[str, Any]:
    template_id = str(template.get("template_id", "")).strip()
    source_project = template.get("source_project") or {}
    scoring = template.get("scoring") or {}
    metadata = {
        "kb_type": "template",
        "source_type": "lceda_open_source_template",
        "source_ref": template_id,
        "lang": "zh-CN",
        "template_id": template_id,
        "template_type": template.get("template_type", ""),
        "anchor_device_family": template.get("anchor_device_family", ""),
        "anchor_device_model": template.get("anchor_device_model", ""),
        "quality_score": template.get("quality_score", 0),
        "retrieval_priority_score": template.get("retrieval_priority_score", template.get("quality_score", 0)),
        "source": template.get("source", ""),
        "duplicate_group_size": template.get("duplicate_group_size", 1),
        "quality_detail": template.get("quality_detail", {}),
        "lcsc_part_codes": (template.get("quality_detail", {}) or {}).get("lcsc_part_codes", []),
        "lcsc_part_code_count": len((template.get("quality_detail", {}) or {}).get("lcsc_part_codes", [])),
        "source_project_id": source_project.get("project_id", ""),
        "source_project_url": source_project.get("project_url", ""),
        "idempotency_key": template_id,
    }
    normalized_score_reasons = _normalize_text_list(scoring.get("score_reasons"))
    normalized_intent_tags = _normalize_text_list(scoring.get("intent_tags"))
    for key in (
        "static_quality_score",
        "structure_score",
        "signal_chain_score",
        "combo_integrity_score",
        "jlc_searchable_score",
        "project_quality_score",
    ):
        if key in scoring:
            metadata[key] = scoring.get(key)
    if normalized_score_reasons:
        metadata["score_reasons"] = normalized_score_reasons
    if normalized_intent_tags:
        metadata["intent_tags"] = normalized_intent_tags
    return {
        "title": _template_title(template),
        "content": _template_content(template),
        "external_rag_template_corpus": [template],
        "metadata": metadata,
    }


def _iter_jsonl(path: Path):
    with path.open("r", encoding="utf-8") as file:
        for line in file:
            line = line.strip()
            if line:
                yield json.loads(line)


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        for row in rows:
            file.write(json.dumps(row, ensure_ascii=False) + "\n")


def _sanitize_source_project_title(value: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    text = text.replace("S_ProPrj_", "")
    text = re.sub(r"\s+", " ", text).strip(" -_")
    return text


def _sanitize_source_project_url(value: str) -> str:
    return re.sub(r"\s+", "", str(value or "")).strip()


def _display_project_title(value: str, fallback: str) -> str:
    raw = re.sub(r"\s+", " ", str(value or "")).strip()
    match = re.search(r"(?:^|_)(?:S_)?ProPrj_(.+)$", raw)
    if match:
        text = match.group(1)
    else:
        text = _sanitize_source_project_title(raw)
    text = re.sub(r"_\d{4}-\d{2}-\d{2}$", "", text)
    text = re.sub(r"^\d+_简介[:：]?", "", text).strip()
    text = text.replace("S_ProPrj_", "")
    text = text.strip(" -_")
    return text or fallback


def _display_project_ref(project_id: str, project_url: str) -> str:
    pid = str(project_id or "").strip()
    url = _sanitize_source_project_url(project_url)
    if pid.startswith("local-files-"):
        return pid
    return url or pid


def _classify_combo_bundle(anchor_signals: list[str], chains: list[str], components: list[str]) -> tuple[str, str, list[str]]:
    upper_anchors = [signal.upper() for signal in anchor_signals if signal]
    upper_chains = [chain.upper() for chain in chains]
    upper_components = [component.upper() for component in components]

    if any(signal in {"RST", "RESET", "EN", "NRST"} for signal in upper_anchors) and any(
        power in chain for power in {"3.3V", "+3.3V", "VCC", "VDD"} for chain in upper_chains
    ):
        return (
            "reset_pullup_network",
            "复位上拉网络",
            ["复位脚上拉", "MCU 复位网络", "上拉电阻到 3.3V"],
        )

    if any("LED" in component for component in upper_components) and any(
        signal.startswith(("GPIO", "IO")) for signal in upper_anchors
    ):
        return (
            "gpio_led_drive",
            "GPIO 指示灯驱动网络",
            ["GPIO 驱动 LED", "串联限流电阻", "指示灯控制电路"],
        )

    if any(signal.startswith(("GPIO", "IO", "SDA", "SCL", "TX", "RX", "UART")) for signal in upper_anchors) and any(
        power in chain for power in {"3.3V", "+3.3V", "VCC", "VDD"} for chain in upper_chains
    ):
        return (
            "signal_pullup_network",
            "信号上拉网络",
            ["信号线上拉", "总线待机偏置", "上拉电阻到电源"],
        )

    if any("GND" in chain for chain in upper_chains) and any(
        power in chain for power in {"3.3V", "+3.3V", "5V", "VCC", "VDD", "VBAT"} for chain in upper_chains
    ):
        return (
            "power_decoupling_network",
            "电源去耦网络",
            ["电源去耦", "电源滤波", "电容接电源与地"],
        )

    return (
        "generic_signal_conditioning",
        "通用信号调理网络",
        ["信号整形", "外围阻容组合", "按连接链检索"],
    )


def _normalize_chain_text(chain: dict[str, Any]) -> str:
    anchor = str(chain.get("anchor_net", "")).strip()
    to_power = str(chain.get("to_power_net", "")).strip()
    passives = [str(v).strip() for v in chain.get("passive_values", []) if str(v).strip()]
    if anchor and to_power:
        return f"{anchor} -> {' / '.join(passives) if passives else 'R/C'} -> {to_power}"
    return ""


def _extract_supporting_parts(chains: list[dict[str, Any]], components: list[dict[str, Any]]) -> list[str]:
    parts: set[str] = set()
    for chain in chains:
        for value in chain.get("passive_values", []) or []:
            text = str(value).strip()
            if text:
                parts.add(text)
    for comp in components:
        value = str(comp.get("value", "")).strip()
        role = str(comp.get("role", "")).strip().lower()
        if value and role in {"passive_refdes", "series_resistor", "pullup_resistor", "decoupling_capacitor", "bulk_capacitor", "led"}:
            parts.add(value)
    return sorted(parts)


def _collect_project_combo_scoring(templates: list[dict[str, Any]]) -> dict[str, Any]:
    scoring_templates = [item.get("scoring") for item in templates if isinstance(item.get("scoring"), dict)]
    if not scoring_templates:
        return {}

    aggregated: dict[str, Any] = {}
    numeric_keys = (
        "static_quality_score",
        "structure_score",
        "signal_chain_score",
        "combo_integrity_score",
        "jlc_searchable_score",
        "project_quality_score",
    )
    for key in numeric_keys:
        values: list[float] = []
        for scoring in scoring_templates:
            try:
                if key in scoring:
                    values.append(float(scoring.get(key)))
            except (TypeError, ValueError):
                continue
        if values:
            aggregated[key] = round(max(values), 4)

    score_reasons: list[str] = []
    intent_tags: list[str] = []
    for scoring in scoring_templates:
        score_reasons.extend(_normalize_text_list(scoring.get("score_reasons")))
        intent_tags.extend(_normalize_text_list(scoring.get("intent_tags")))
    if score_reasons:
        aggregated["score_reasons"] = list(dict.fromkeys(score_reasons))
    if intent_tags:
        aggregated["intent_tags"] = list(dict.fromkeys(intent_tags))
    return aggregated


def build_project_combo_rows(templates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for t in templates:
        sp = t.get("source_project") or {}
        pid = str(sp.get("project_id", "")).strip()
        if not pid:
            continue
        grouped.setdefault(pid, []).append(t)

    rows: list[dict[str, Any]] = []
    for pid, ts in grouped.items():
        ts = sorted(
            ts,
            key=lambda item: float(item.get("retrieval_priority_score", item.get("quality_score", 0.0))),
            reverse=True,
        )
        sp = ts[0].get("source_project") or {}
        project_title = _display_project_title(sp.get("title", pid), pid)
        project_url = _sanitize_source_project_url(sp.get("project_url", ""))
        project_ref = _display_project_ref(pid, project_url)
        chain_items: list[dict[str, Any]] = []
        component_lines: list[str] = []
        anchor_signals: list[str] = []
        for t in ts[:20]:
            for comp in t.get("components", [])[:20]:
                val = str(comp.get("value", "")).strip()
                role = str(comp.get("role", "")).strip()
                if val:
                    component_lines.append(f"{role}:{val}" if role else val)
            for chain in (t.get("default_values", {}) or {}).get("connection_chains", [])[:20]:
                anchor = str(chain.get("anchor_net", "")).strip()
                if anchor:
                    anchor_signals.append(anchor)
                chain_items.append(chain)
        unique_components = sorted(set(component_lines))[:120]
        unique_chains = sorted(set(filter(None, (_normalize_chain_text(chain) for chain in chain_items))))[:80]
        if not unique_chains:
            continue
        unique_anchors = sorted(set(anchor_signals))[:20]
        supporting_parts = _extract_supporting_parts(chain_items, [comp for t in ts[:20] for comp in t.get("components", [])[:20]])
        combo_type, combo_function, retrieval_hints = _classify_combo_bundle(unique_anchors, unique_chains, unique_components)
        scoring = _collect_project_combo_scoring(ts[:20])
        title = f"{project_title or pid} project_combo_bundle"
        content_parts = [
            f"项目: {project_title or pid}",
            f"项目地址: {project_ref}",
            f"组合类型: {combo_type}",
            f"电路功能: {combo_function}",
            f"锚点信号: {', '.join(unique_anchors)}",
            f"配套器件: {', '.join(supporting_parts)}",
            f"Static quality score: {scoring.get('static_quality_score')}" if "static_quality_score" in scoring else "",
            f"Intent tags: {', '.join(scoring.get('intent_tags', []))}" if scoring.get("intent_tags") else "",
            f"Score reasons: {', '.join(scoring.get('score_reasons', []))}" if scoring.get("score_reasons") else "",
            "连接链:",
            *[f"- {chain}" for chain in unique_chains],
            "检索提示:",
            *[f"- {hint}" for hint in retrieval_hints],
        ]
        base_priority = max(
            float(item.get("retrieval_priority_score", item.get("quality_score", 0.0)))
            for item in ts
        )
        # Give project-level combo bundles a small fixed boost so grouped results
        # are favored over fragmented single templates during retrieval ranking.
        boosted_priority = round(min(base_priority + 0.08, 1.5), 4)

        record = {
            "title": title,
            "content": "\n".join(part for part in content_parts if part),
            "external_rag_template_corpus": ts,
            "metadata": {
                "kb_type": "template",
                "source_type": "lceda_project_combo_bundle",
                "source_ref": f"project_combo_{pid}",
                "lang": "zh-CN",
                "template_type": "project_combo_bundle",
                "source_project_id": pid,
                "source_project_url": project_url,
                "component_bundle_count": len(unique_components),
                "connection_chain_count": len(unique_chains),
                "retrieval_priority_score": boosted_priority,
                "idempotency_key": f"project_combo_{pid}",
            },
        }
        for key in (
            "static_quality_score",
            "structure_score",
            "signal_chain_score",
            "combo_integrity_score",
            "jlc_searchable_score",
            "project_quality_score",
        ):
            if key in scoring:
                record["metadata"][key] = scoring[key]
        if scoring.get("score_reasons"):
            record["metadata"]["score_reasons"] = scoring["score_reasons"]
        if scoring.get("intent_tags"):
            record["metadata"]["intent_tags"] = scoring["intent_tags"]
        rows.append(record)
    return rows


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Transform LCEDA templates to RAGFlow JSONL")
    parser.add_argument("--input", required=True, help="Template corpus JSONL")
    parser.add_argument("--output", required=True, help="RAGFlow JSONL output")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    templates = list(_iter_jsonl(Path(args.input)))
    rows = [to_ragflow_template_record(template) for template in templates]
    rows.extend(build_project_combo_rows(templates))
    output = Path(args.output)
    _write_jsonl(output, rows)
    print(f"[lceda-ragflow-transform] rows={len(rows)} -> {output}")


if __name__ == "__main__":
    main()
