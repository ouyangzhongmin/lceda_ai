import argparse
import hashlib
import json
import re
import zipfile
import unittest
from collections import defaultdict
from pathlib import Path
from typing import Any


DEVICE_PATTERNS = [
    ("ESP32", r"\b(ESP32[- ]?(?:S3|C3|S2|C6)?)\b"),
    ("RP2040", r"\b(RP2040)\b"),
    ("STM32", r"\b(STM32F103\w*|STM32\w*)\b"),
]
SCHEMATIC_TEXT_EXTENSIONS = {".json", ".epro", ".esch", ".sch"}
ZIP_SCHEMATIC_MAX_FILES = 3
ZIP_SCHEMATIC_MIN_SCORE = 7
SCHEMATIC_NET_CANDIDATE_PATTERN = re.compile(r"\b[A-Z][A-Z0-9_+\-]{1,23}\b")
SCHEMATIC_LABELED_VALUE_PATTERN = re.compile(r"(?:PART NO|VALUE|PCB DECAL)\s*\n([^\n\r]+)")
SCHEMATIC_UNIT_VALUE_PATTERN = re.compile(r"[A-Z0-9_-]+;[A-Z]+;([^;\n\r]+)")
LOW_OHM_SENSE_PATTERN = re.compile(r"\b0\.\d+R(?: \d{4})?\b")
LCSC_PART_CODE_PATTERN = re.compile(r"\bC\d{5,9}\b", re.IGNORECASE)
PASSIVE_VALUE_PATTERN = re.compile(r"^\d+(?:\.\d+)?(?:R|K|M|OHM|Ω|UF|NF|PF|H|MH|UH|V|W|%)", re.IGNORECASE)
EPRU_DOCTYPE_PATTERN = re.compile(r'"docType"\s*:\s*"([^"]+)"')
GPIO_NET_PATTERN = re.compile(r"\b(GPIO\d{1,2}|IO\d{1,2}|EN|RST|RESET|BOOT0?|U0TXD|U0RXD)\b", re.IGNORECASE)
POWER_NET_PATTERN = re.compile(r"\b(VCC|3V3|5V|VBAT|VBUS|VDD|GND)\b", re.IGNORECASE)
REFDES_PATTERN = re.compile(r"\b([RCLDUQJ]\d{1,4})\b", re.IGNORECASE)
PASSIVE_IN_SEGMENT_PATTERN = re.compile(r"\b\d+(?:\.\d+)?(?:R|K|M|UF|NF|PF)\b", re.IGNORECASE)
PASSIVE_REFDES_PATTERN = re.compile(r"^(?:R|C|L|FB)\d{1,4}$", re.IGNORECASE)
RESISTOR_REFDES_PATTERN = re.compile(r"^R\d{1,4}$", re.IGNORECASE)
CAPACITOR_REFDES_PATTERN = re.compile(r"^C\d{1,4}$", re.IGNORECASE)
INDUCTOR_REFDES_PATTERN = re.compile(r"^(?:L|FB)\d{1,4}$", re.IGNORECASE)
SCHEMATIC_TEXT_EXTENSIONS.update({".epro2", ".epru"})


def _normalize_schematic_token(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().strip(";,:")).upper()


def _sanitize_source_project_title(value: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    text = text.replace("S_ProPrj_", "")
    text = re.sub(r"\s+", " ", text).strip(" -_")
    return text


def _sanitize_source_project_url(value: str) -> str:
    return re.sub(r"\s+", "", str(value or "")).strip()


def _contains_bus_label(text: str, label: str) -> bool:
    if label in text:
        return True
    compact = text.replace("\x00", "")
    return label in compact


def _first_low_ohm_sense_value(values: set[str]) -> str:
    for value in sorted(values):
        match = LOW_OHM_SENSE_PATTERN.search(value)
        if match:
            return match.group(0).split()[0]
    return ""


def parse_schematic_text_tokens(text: str) -> dict[str, list[str]]:
    if not text:
        return {
            "nets": [],
            "part_values": [],
            "part_numbers": [],
            "footprints": [],
            "connectors": [],
        }

    nets: set[str] = set()
    part_values: set[str] = set()
    part_numbers: set[str] = set()
    footprints: set[str] = set()
    connectors: set[str] = set()

    for match in SCHEMATIC_NET_CANDIDATE_PATTERN.finditer(text):
        candidate = _normalize_schematic_token(match.group(0))
        if candidate in {"FIELD", "VALUE", "PART", "NAME", "DESCRIPTION", "TOLERANCE", "VENDOR", "MANUFACTURERS", "DRAWN", "CHECKED", "RELEASED", "COMPANY", "TITLE", "CODE", "SCALE", "DATE", "UNIT", "COST"}:
            continue
        if any(
            marker in candidate
            for marker in (
                "VBAT",
                "VBUS",
                "VCC",
                "3V3",
                "5V",
                "GND",
                "UART",
                "TX",
                "TXD",
                "RX",
                "RXD",
                "DTR",
                "RTS",
                "SDA",
                "SCL",
                "RESET",
                "RST",
                "EN",
                "CHIP_EN",
                "BOOT",
                "BOOT0",
                "GPIO0",
                "IO0",
                "NTC",
                "B+",
                "B-",
            )
        ):
            nets.add(candidate)
        if any(marker in candidate for marker in ("PAD", "HEADER", "CONN", "UART")):
            connectors.add(candidate)

    for line in text.splitlines():
        normalized_line = _normalize_schematic_token(line)
        if normalized_line in {"B+", "B-", "P+", "P-"}:
            nets.add(normalized_line)
        if any(marker in normalized_line for marker in ("PAD", "HEADER", "CONN", "UART")):
            connectors.add(normalized_line)

    labeled_values = [_normalize_schematic_token(match.group(1)) for match in SCHEMATIC_LABELED_VALUE_PATTERN.finditer(text)]
    unit_values = [_normalize_schematic_token(match.group(1)) for match in SCHEMATIC_UNIT_VALUE_PATTERN.finditer(text)]

    for value in labeled_values + unit_values:
        if not value:
            continue
        if any(marker in value for marker in ("0603", "0805", "1206", "2512", "SOT", "TSSOP", "SOD", "SMB", "PAD")):
            footprints.add(value)
        if any(marker in value for marker in ("LED", "MMBT", "NTC", "USB", "UART")) or re.search(r"\b\d+(?:\.\d+)?(?:[KMRUFVWA%]+)(?: \d{4})?\b", value):
            part_values.add(value)
        if value.startswith(("TR", "RT", "CY", "LE", "DI")) and re.search(r"\d", value):
            part_numbers.add(value)
        elif re.fullmatch(r"[A-Z0-9-]{6,}", value) and not any(ch.isdigit() for ch in value[-3:]):
            part_numbers.add(value)
        if any(marker in value for marker in ("PAD", "HEADER", "CONN", "UART")):
            connectors.add(value)

    return {
        "nets": sorted(nets),
        "part_values": sorted(part_values),
        "part_numbers": sorted(part_numbers),
        "footprints": sorted(footprints),
        "connectors": sorted(connectors),
    }


def _combined_text(project: dict[str, Any]) -> str:
    file_text = _read_schematic_file_text(str(project.get("schematic_file_path", "")))
    return " ".join(
        str(project.get(key, ""))
        for key in ["title", "summary", "raw_page_text", "project_url"]
    ) + " " + file_text


def _bms_context_text(project: dict[str, Any]) -> str:
    parts = [
        str(project.get("title", "")),
        str(project.get("summary", "")),
        str(project.get("raw_page_text", "")),
        " ".join(str(tag) for tag in project.get("tags", []) or []),
        " ".join(str(keyword) for keyword in project.get("keywords", []) or []),
        str(project.get("category", "")),
    ]
    return " ".join(parts).lower()


def _has_bms_context(project: dict[str, Any]) -> bool:
    text = _bms_context_text(project)
    return any(
        marker in text
        for marker in [
            "bms",
            "battery",
            "pack",
            "protection board",
            "锂电",
            "电池",
            "保护板",
            "电池组",
            "串",
        ]
    )


def _read_schematic_file_text(path: str) -> str:
    if not path:
        return ""
    file_path = Path(path)
    if not file_path.is_file():
        return ""
    data = file_path.read_bytes()
    if not data:
        return ""
    suffix = file_path.suffix.lower()
    if suffix == ".zip":
        try:
            return _read_schematic_zip_text(file_path)
        except zipfile.BadZipFile:
            return data[:500_000].decode("utf-8", errors="ignore")
    if suffix == ".epro2":
        try:
            return _read_epro2_text(file_path)
        except zipfile.BadZipFile:
            return data[:500_000].decode("utf-8", errors="ignore")
    if suffix == ".epru":
        return _extract_epru_schematic_text(data.decode("utf-8", errors="ignore"))
    return data[:500_000].decode("utf-8", errors="ignore")


def _read_schematic_zip_text(path: Path) -> str:
    candidates: list[tuple[int, str]] = []
    with zipfile.ZipFile(path) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            filename = info.filename
            if Path(filename).suffix.lower() not in SCHEMATIC_TEXT_EXTENSIONS:
                continue
            with archive.open(info) as file:
                raw = file.read(800_000)
            suffix = Path(filename).suffix.lower()
            if suffix == ".epru":
                content = _extract_epru_schematic_text(raw.decode("utf-8", errors="ignore"))
            elif suffix == ".epro2":
                content = _read_epro2_bytes(raw)
            else:
                content = raw[:500_000].decode("utf-8", errors="ignore")
            score = _score_zip_schematic_candidate(filename, content)
            if score >= ZIP_SCHEMATIC_MIN_SCORE:
                candidates.append((score, content))

    if not candidates:
        return ""
    candidates.sort(key=lambda item: item[0], reverse=True)
    return "\n".join(content for _, content in candidates[:ZIP_SCHEMATIC_MAX_FILES])


def _score_zip_schematic_candidate(filename: str, content: str) -> int:
    name = filename.lower()
    suffix = Path(name).suffix
    score = 0

    if suffix == ".sch":
        score += 8
    elif suffix == ".esch":
        score += 7
    elif suffix == ".epro":
        score += 6
    elif suffix == ".epro2":
        score += 8
    elif suffix == ".epru":
        score += 9
    elif suffix == ".json":
        score += 4

    for marker in ("schematic", "sch", "hardware", "project", "main", "sheet"):
        if marker in name:
            score += 2
    for marker in ("readme", "manual", "doc", "bom", "3d", "image", "preview", "logo", "icon", "license", "说明"):
        if marker in name:
            score -= 3

    normalized = content.upper()
    for marker in (
        "VBAT",
        "VBUS",
        "3V3",
        "VCC",
        "GND",
        "UART",
        "TXD",
        "RXD",
        "DTR",
        "RTS",
        "SDA",
        "SCL",
        "BOOT",
        "RESET",
        "NTC",
        "B+",
        "B-",
        "P+",
        "P-",
        "ESP32",
        "RP2040",
        "STM32",
        "CH340",
        "CP210",
    ):
        if marker in normalized:
            score += 1
    if "PART NO" in normalized or "PCB DECAL" in normalized:
        score += 2
    if '"DOCTYPE":"SCH"' in normalized or '"DOCTYPE":"SCH_PAGE"' in normalized:
        score += 3
    return score


def _read_epro2_text(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        return _read_epro2_archive(archive)


def _read_epro2_bytes(data: bytes) -> str:
    from io import BytesIO

    with zipfile.ZipFile(BytesIO(data)) as archive:
        return _read_epro2_archive(archive)


def _read_epro2_archive(archive: zipfile.ZipFile) -> str:
    parts: list[str] = []
    for name in archive.namelist():
        if name.endswith("/"):
            continue
        lower = name.lower()
        if lower.endswith("project2.json"):
            parts.append(archive.read(name)[:500_000].decode("utf-8", errors="ignore"))
        elif lower.endswith(".epru"):
            raw = archive.read(name)[:2_000_000].decode("utf-8", errors="ignore")
            parts.append(_extract_epru_schematic_text(raw))
    return "\n".join(item for item in parts if item.strip())


def _iter_epru_records(raw: str):
    if not raw:
        return
    for chunk in raw.split("|\n"):
        chunk = chunk.strip()
        if not chunk or "||" not in chunk:
            continue
        meta_raw, data_raw = chunk.split("||", 1)
        meta_raw = meta_raw.strip()
        data_raw = data_raw.strip().rstrip("|").strip()
        if not meta_raw.startswith("{") or not data_raw.startswith("{"):
            continue
        try:
            meta = json.loads(meta_raw)
            data = json.loads(data_raw)
        except Exception:
            continue
        yield meta, data


def _load_epru_structured_records(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if not name.lower().endswith(".epru"):
                continue
            raw = archive.read(name).decode("utf-8", errors="ignore")
            for meta, data in _iter_epru_records(raw):
                merged = dict(data)
                for key, value in meta.items():
                    merged.setdefault(key, value)
                merged["_epru_name"] = name
                records.append(merged)
    return records


def _extract_epru_sheet_blocks(path: str) -> list[dict[str, Any]]:
    if not path:
        return []
    file_path = Path(path)
    if not file_path.is_file() or file_path.suffix.lower() != ".epro2":
        return []

    try:
        records = _load_epru_structured_records(file_path)
    except zipfile.BadZipFile:
        return []

    sheet_blocks: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for record in records:
        doc_type = str(record.get("docType", "")).upper()
        rec_type = str(record.get("type", "")).upper()
        if rec_type == "DOCHEAD" and doc_type in {"SCH", "SCH_PAGE"}:
            current = {
                "docType": doc_type,
                "uuid": record.get("uuid", ""),
                "title": "",
                "records": [],
            }
            sheet_blocks.append(current)
            continue
        if current is None:
            continue
        if rec_type == "DOCHEAD" and doc_type not in {"SCH", "SCH_PAGE"}:
            current = None
            continue
        current["records"].append(record)
        if rec_type == "META" and not current["title"]:
            current["title"] = str(record.get("title", "")).strip()
    return [block for block in sheet_blocks if block.get("records")]


def _normalize_net_label(value: str) -> str:
    label = str(value or "").strip().upper()
    if not label:
        return ""
    if label == "NONE":
        return ""
    return label


def _looks_like_passive_designator(designator: str) -> bool:
    text = str(designator or "").strip().upper()
    return bool(text) and bool(PASSIVE_REFDES_PATTERN.fullmatch(text))


def _component_role_from_designator(designator: str) -> str:
    text = str(designator or "").strip().upper()
    if CAPACITOR_REFDES_PATTERN.fullmatch(text):
        return "capacitor"
    if RESISTOR_REFDES_PATTERN.fullmatch(text):
        return "resistor"
    if INDUCTOR_REFDES_PATTERN.fullmatch(text):
        return "inductor"
    if text.startswith("U"):
        return "ic"
    if text.startswith("Q"):
        return "transistor"
    if text.startswith("D") or text.startswith("LED"):
        return "diode"
    if text.startswith(("USB", "CN", "J", "H")):
        return "connector"
    return "component"


def _extract_structured_connection_chains(path: str) -> list[dict[str, Any]]:
    sheet_blocks = _extract_epru_sheet_blocks(path)
    chains: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, tuple[str, ...]]] = set()
    power_nets = {"+3.3V", "3V3", "+5V", "VBUS", "+12V", "VCC", "VDD"}
    resistor_anchor_nets = {"CC1", "CC2"} | power_nets

    for block in sheet_blocks:
        if str(block.get("docType", "")).upper() != "SCH_PAGE":
            continue

        part_attrs: dict[str, dict[str, Any]] = defaultdict(dict)
        net_labels: list[dict[str, Any]] = []
        component_instances: list[dict[str, Any]] = []

        for record in block.get("records", []):
            rec_type = str(record.get("type", "")).upper()
            if rec_type == "COMPONENT":
                component_instances.append(record)
                continue
            if rec_type != "ATTR":
                continue
            parent_id = str(record.get("parentId", "")).strip()
            key = str(record.get("key", "")).strip()
            value = record.get("value", "")
            if parent_id and key and value not in (None, ""):
                part_attrs[parent_id][key] = value
            if key in {"NET", "Global Net Name"}:
                net_name = _normalize_net_label(str(value))
                if net_name:
                    net_labels.append(
                        {
                            "parent_id": parent_id,
                            "net": net_name,
                            "x": record.get("x"),
                            "y": record.get("y"),
                        }
                    )

        components_by_id: dict[str, dict[str, str]] = {}
        for instance in component_instances:
            parent_id = str(instance.get("id", "")).strip()
            attrs = part_attrs.get(parent_id, {})
            designator = str(attrs.get("Designator", "")).strip()
            name = str(attrs.get("Name", "")).strip()
            value = str(attrs.get("Value", "")).strip()
            device = str(attrs.get("Device", "")).strip()
            if not any([designator, name, value, device]):
                continue
            components_by_id[parent_id] = {
                "designator": designator,
                "name": name,
                "value": value,
                "device": device,
                "role": _component_role_from_designator(designator),
                "x": instance.get("x"),
                "y": instance.get("y"),
            }

        for component in components_by_id.values():
            x = component.get("x")
            y = component.get("y")
            if x in (None, "") or y in (None, ""):
                continue
            nearby_nets: list[tuple[float, str]] = []
            for item in net_labels:
                nx = item.get("x")
                ny = item.get("y")
                if nx in (None, "") or ny in (None, ""):
                    continue
                dist = ((float(x) - float(nx)) ** 2 + (float(y) - float(ny)) ** 2) ** 0.5
                if dist <= 180:
                    nearby_nets.append((dist, str(item["net"])))
            nearby_nets.sort(key=lambda item: item[0])
            ordered_nets = []
            for _, net in nearby_nets:
                if net not in ordered_nets:
                    ordered_nets.append(net)
            if not ordered_nets:
                continue

            designator = str(component.get("designator", "")).strip()
            role = str(component.get("role", "")).strip()
            if role not in {"capacitor", "resistor"}:
                continue
            part_label = designator or str(component.get("name", "")).strip() or str(component.get("device", "")).strip()
            part_value = str(component.get("value", "")).strip() or str(component.get("name", "")).strip() or part_label
            if role == "capacitor":
                primary_net = next((net for net in ordered_nets if net in power_nets), "")
                if not primary_net or "GND" not in ordered_nets:
                    continue
                to_power = "GND"
            else:
                anchor_priority = []
                for net in ordered_nets:
                    if net in {"CC1", "CC2"}:
                        anchor_priority.append((0, net))
                    elif GPIO_NET_PATTERN.search(net):
                        anchor_priority.append((1, net))
                    elif net in power_nets:
                        anchor_priority.append((2, net))
                if not anchor_priority:
                    continue
                anchor_priority.sort(key=lambda item: (item[0], ordered_nets.index(item[1])))
                primary_net = anchor_priority[0][1]

                if primary_net in resistor_anchor_nets:
                    to_power = "GND"
                else:
                    to_power = next(
                        (net for net in ordered_nets if net in power_nets | {"GND"} and net != primary_net),
                        "GND",
                    )

            passive_values = [part_value]
            passive_refdes = [designator] if _looks_like_passive_designator(designator) else []
            if not passive_refdes:
                continue

            peers = [part_label] + [net for net in ordered_nets if net != primary_net][:4]

            key = (str(block.get("title", "")), primary_net, to_power, tuple(passive_refdes))
            if key in seen:
                continue
            seen.add(key)

            chains.append(
                {
                    "sheet_title": str(block.get("title", "")),
                    "anchor_net": primary_net,
                    "to_power_net": to_power,
                    "chain_type": _classify_connection_chain(primary_net, to_power, role, peers),
                    "passive_values": passive_values,
                    "passive_refdes": passive_refdes,
                    "peer_components": peers,
                    "evidence": f"{block.get('title', '')}: {primary_net} -> {part_label} -> {to_power}",
                }
            )

    return chains


def _classify_connection_chain(anchor_net: str, to_power_net: str, role: str, peers: list[str]) -> str:
    anchor = str(anchor_net or "").upper()
    to_power = str(to_power_net or "").upper()
    peer_text = " ".join(str(item).upper() for item in peers)
    power_rails = {"+12V", "+5V", "+3.3V", "3V3", "VBUS", "VCC", "VDD"}
    motor_hints = ("PWM", "FAN", "MOTOR", "LIMIT", "CHARGE")

    if anchor in {"CC1", "CC2"}:
        return "usb_cc"
    if GPIO_NET_PATTERN.search(anchor):
        return "gpio_bias"
    if role == "capacitor" and anchor in power_rails and to_power == "GND":
        if any(hint in peer_text for hint in motor_hints):
            return "power_stage"
        return "power_decoupling"
    if role == "resistor" and anchor in power_rails:
        if any(hint in peer_text for hint in motor_hints):
            return "power_stage"
        return "power_bias"
    if role == "resistor" and anchor in {"EN", "RST", "RESET", "BOOT", "BOOT0"}:
        return "control_bias"
    return "generic"


class StructuredChainExtractionTests(unittest.TestCase):
    def test_passive_designator_detection_is_strict(self) -> None:
        self.assertTrue(_looks_like_passive_designator("R4"))
        self.assertTrue(_looks_like_passive_designator("C12"))
        self.assertTrue(_looks_like_passive_designator("FB1"))
        self.assertFalse(_looks_like_passive_designator("CN1"))
        self.assertFalse(_looks_like_passive_designator("LDO1"))
        self.assertFalse(_looks_like_passive_designator("USB1"))

    def test_sample_project_filters_connectors_and_bad_capacitor_anchors(self) -> None:
        sample = Path(__file__).resolve().parents[2] / "results/lceda_open_source_raw/files/03_简介：为了不把手机带上床，我们给它也做了张床。HTXStudio手机床_ProPrj_HTXStudio手机床_2026-04-21.epro2"
        if not sample.is_file():
            self.skipTest(f"sample file missing: {sample}")

        chains = _extract_structured_connection_chains(str(sample))
        refdes = {item for chain in chains for item in chain.get("passive_refdes", [])}
        evidences = [str(chain.get("evidence", "")) for chain in chains]

        self.assertNotIn("CN1", refdes)
        self.assertNotIn("CN3", refdes)
        self.assertNotIn("LDO1", refdes)
        self.assertFalse(any("GPIO1 -> C4" in evidence for evidence in evidences))
        self.assertFalse(any("CC1 -> C1" in evidence for evidence in evidences))
        self.assertFalse(any("CC1 -> C2" in evidence for evidence in evidences))
        self.assertTrue(any("CC2 -> R4 -> GND" in evidence for evidence in evidences))
        self.assertTrue(any("+5V -> C12 -> GND" in evidence for evidence in evidences))

    def test_sample_project_classifies_and_filters_gpio_template(self) -> None:
        sample = Path(__file__).resolve().parents[2] / "results/lceda_open_source_raw/files/03_简介：为了不把手机带上床，我们给它也做了张床。HTXStudio手机床_ProPrj_HTXStudio手机床_2026-04-21.epro2"
        if not sample.is_file():
            self.skipTest(f"sample file missing: {sample}")

        project = {
            "project_id": "local-files-004",
            "project_url": "https://oshwhub.com/local/sample",
            "title": sample.stem,
            "summary": "",
            "raw_page_text": "",
            "schematic_file_path": str(sample),
            "source_mode": "file_first",
        }
        templates = extract_templates_from_project(project)
        gpio_template = next(item for item in templates if item.get("template_type") == "gpio_passive_power_chain")
        chains = (gpio_template.get("default_values", {}) or {}).get("connection_chains", [])
        evidences = [str(chain.get("evidence", "")) for chain in chains]

        self.assertTrue(any("CC2 -> R4 -> GND" in evidence for evidence in evidences))
        self.assertTrue(any("GPIO41 -> R1 -> +3.3V" in evidence for evidence in evidences))
        self.assertFalse(any("+12V -> C3 -> GND" in evidence for evidence in evidences))
        self.assertFalse(any("+5V -> C12 -> GND" in evidence for evidence in evidences))


def _extract_sheet_component_summaries(path: str) -> list[dict[str, Any]]:
    sheet_blocks = _extract_epru_sheet_blocks(path)
    summaries: list[dict[str, Any]] = []
    for block in sheet_blocks:
        part_attrs: dict[str, dict[str, Any]] = defaultdict(dict)
        net_names: set[str] = set()
        for record in block["records"]:
            rec_type = str(record.get("type", "")).upper()
            if rec_type == "ATTR":
                parent_id = str(record.get("parentId", "")).strip()
                key = str(record.get("key", "")).strip()
                value = record.get("value", "")
                if parent_id and key and value not in (None, ""):
                    part_attrs[parent_id][key] = value
                if key in {"NET", "Global Net Name"} and value:
                    net_names.add(str(value).strip().upper())
            elif rec_type == "NET":
                net_name = str(record.get("name", "") or record.get("netName", "") or "").strip()
                if net_name:
                    net_names.add(net_name.upper())

        components: list[dict[str, str]] = []
        for parent_id, attrs in part_attrs.items():
            designator = str(attrs.get("Designator", "")).strip()
            value = str(attrs.get("Value", "")).strip()
            device = str(attrs.get("Device", "")).strip()
            footprint = str(attrs.get("Footprint", "")).strip()
            if not any([designator, value, device, footprint]):
                continue
            components.append(
                {
                    "part_id": parent_id,
                    "designator": designator,
                    "value": value,
                    "device": device,
                    "footprint": footprint,
                }
            )

        summaries.append(
            {
                "sheet_title": block.get("title", "") or str(block.get("uuid", "")),
                "component_count": len(components),
                "net_count": len(net_names),
                "components": components,
                "nets": sorted(net_names),
            }
        )
    return summaries


def _extract_epru_schematic_text(raw: str) -> str:
    # .epru is pipe-joined JSON fragments, keep SCH/SCH_PAGE and key doc hints.
    if not raw:
        return ""
    out: list[str] = []
    keep_attr_keys = (
        '"key":"Pin Name"',
        '"key":"NET"',
        '"key":"Global Net Name"',
        '"key":"Designator"',
        '"key":"Value"',
        '"key":"LCSC Part Name"',
        '"key":"Supplier Part"',
        '"key":"Manufacturer Part"',
        '"key":"Device"',
        '"key":"Footprint"',
    )
    for frag in raw.split("||"):
        frag = frag.strip().lstrip("|").strip()
        if not frag or not frag.startswith("{"):
            continue
        upper = frag.upper()
        if '"DOCTYPE":"SCH"' in upper or '"DOCTYPE":"SCH_PAGE"' in upper:
            out.append(frag[:12000])
        elif any(
            key in upper
            for key in (
                '"DOCTYPE":"DEVICE"',
                '"DOCTYPE":"SYMBOL"',
                '"DOCTYPE":"FOOTPRINT"',
                "VBAT",
                "VBUS",
                "3V3",
                "GND",
                "UART",
                "SDA",
                "SCL",
                "CH340",
                "CP210",
                "ESP32",
                "STM32",
                "RP2040",
            )
        ):
            out.append(frag[:4000])
        elif '"TYPE":"ATTR"' in upper and any(key in frag for key in keep_attr_keys):
            out.append(frag[:4000])
        elif '"TYPE":"WIRE"' in upper or '"TYPE":"LINE"' in upper:
            if '"NETNAME":"' in upper or '"NETWORKLIST"' in upper:
                out.append(frag[:3000])
        if len(out) >= 2200:
            break
    return "\n".join(out)


def _extract_connection_chains(text: str) -> list[dict[str, Any]]:
    chains = _extract_connection_chains_from_attr_records(text)
    if chains:
        return chains
    return _extract_connection_chains_by_segment(text)


def _fallback_connection_chains_from_tokens(
    normalized_nets: set[str],
    normalized_values: set[str],
) -> list[dict[str, Any]]:
    gpio_nets = sorted(
        net
        for net in normalized_nets
        if GPIO_NET_PATTERN.search(net)
    )
    power_nets = sorted(
        net
        for net in normalized_nets
        if net in {"VCC", "3V3", "VDD", "5V", "VBAT", "VBUS"}
    )
    if not gpio_nets or not power_nets:
        return []
    passive_values = [value for value in sorted(normalized_values) if PASSIVE_VALUE_PATTERN.search(value)]
    if not passive_values:
        passive_values = ["10K", "100NF"]
    power_target = power_nets[0]
    out: list[dict[str, Any]] = []
    for idx, gpio in enumerate(gpio_nets[:12]):
        passive = passive_values[idx % len(passive_values)]
        out.append(
            {
                "anchor_net": gpio,
                "to_power_net": power_target,
                "passive_values": [passive],
                "passive_refdes": [],
                "evidence": f"token-fallback: {gpio} -> {passive} -> {power_target}",
            }
        )
    return out


def _extract_connection_chains_from_attr_records(text: str) -> list[dict[str, Any]]:
    if not text:
        return []
    attr_map: dict[str, dict[str, set[str]]] = {}
    for frag in text.split("||"):
        frag = frag.strip().lstrip("|").strip()
        if '"key":"' not in frag or '"value":' not in frag:
            continue
        part_match = re.search(r'"partId":"([^"]*)"', frag)
        key_match = re.search(r'"key":"([^"]+)"', frag)
        value_match = re.search(r'"value":("([^"]*)"|null)', frag)
        if not key_match or not value_match:
            continue
        part_id = (part_match.group(1) if part_match else "__unknown__").strip()
        key = key_match.group(1).strip()
        value = (value_match.group(2) or "").strip()
        if not value:
            continue
        attr_map.setdefault(part_id, {}).setdefault(key, set()).add(value)

    passive_nodes: list[dict[str, str]] = []
    fallback_passive_values: set[str] = set()
    for part_id, attrs in attr_map.items():
        designators = attrs.get("Designator", set())
        values = attrs.get("Value", set())
        if values:
            for raw_val in values:
                val = str(raw_val).upper()
                if PASSIVE_VALUE_PATTERN.search(val):
                    fallback_passive_values.add(val)
        if designators and values:
            ref = sorted(designators)[0].upper()
            val = sorted(values)[0].upper()
            if ref.startswith(("R", "C", "L")) and PASSIVE_VALUE_PATTERN.search(val):
                passive_nodes.append({"ref": ref, "value": val, "part_id": part_id})

    chains: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, str]] = set()
    for part_id, attrs in attr_map.items():
        fingerprint = " ".join(
            list(attrs.get("Device", set()))
            + list(attrs.get("LCSC Part Name", set()))
            + list(attrs.get("Manufacturer Part", set()))
            + [part_id]
        ).upper()
        if not any(chip in fingerprint for chip in ("ESP32", "STM32", "RP2040", "CH32", "GD32", "ATMEGA", "MSP")):
            continue
        pin_values = set()
        for key in ("Pin Name", "NET", "Global Net Name"):
            pin_values.update(attrs.get(key, set()))
        if not pin_values:
            continue
        blob = " ".join(pin_values).upper()
        gpios = sorted(set(item.upper() for item in GPIO_NET_PATTERN.findall(blob)))
        powers = sorted(set(item.upper() for item in POWER_NET_PATTERN.findall(blob)))
        if not gpios or not powers or not passive_nodes:
            continue
        power_target = next((p for p in powers if p in {"VCC", "3V3", "VDD", "5V", "VBAT", "VBUS"}), powers[0])
        for idx, gpio in enumerate(gpios[:8]):
            pick = passive_nodes[idx % len(passive_nodes)]
            key = (part_id, gpio, power_target, pick["ref"])
            if key in seen:
                continue
            seen.add(key)
            chains.append(
                {
                    "anchor_net": gpio,
                    "to_power_net": power_target,
                    "passive_values": [pick["value"]],
                    "passive_refdes": [pick["ref"]],
                    "evidence": f"{part_id}: {gpio} -> {pick['ref']}({pick['value']}) -> {power_target}",
                }
            )
            if len(chains) >= 24:
                return chains
    if chains:
        return chains

    # Fallback: build project-level chains to keep "GPIO -> passive -> VCC/3V3" bundled.
    global_gpio: set[str] = set()
    global_power: set[str] = set()
    for attrs in attr_map.values():
        values = set()
        for key in ("Pin Name", "NET", "Global Net Name"):
            values.update(attrs.get(key, set()))
        blob = " ".join(values).upper()
        global_gpio.update(item.upper() for item in GPIO_NET_PATTERN.findall(blob))
        global_power.update(item.upper() for item in POWER_NET_PATTERN.findall(blob))
    if not global_gpio or not global_power:
        return []
    if not passive_nodes:
        if not fallback_passive_values:
            fallback_passive_values.update({"10K", "100NF"})
        for idx, val in enumerate(sorted(fallback_passive_values)[:24]):
            passive_nodes.append({"ref": f"R{idx+1}", "value": val, "part_id": "__fallback__"})
    power_target = next((p for p in sorted(global_power) if p in {"VCC", "3V3", "VDD", "5V", "VBAT", "VBUS"}), sorted(global_power)[0])
    for idx, gpio in enumerate(sorted(global_gpio)[:16]):
        pick = passive_nodes[idx % len(passive_nodes)]
        chains.append(
            {
                "anchor_net": gpio,
                "to_power_net": power_target,
                "passive_values": [pick["value"]],
                "passive_refdes": [pick["ref"]],
                "evidence": f"fallback: {gpio} -> {pick['ref']}({pick['value']}) -> {power_target}",
            }
        )
        if len(chains) >= 24:
            break
    return chains


def _extract_connection_chains_by_segment(text: str) -> list[dict[str, Any]]:
    if not text:
        return []
    segs = re.split(r"\|\||[\r\n]+|[{}]", text)
    chains: list[dict[str, Any]] = []
    seen: set[tuple[str, str, tuple[str, ...], tuple[str, ...]]] = set()
    for seg in segs:
        seg = re.sub(r"\s+", " ", seg).strip()
        if len(seg) < 8:
            continue
        if len(seg) > 600:
            # For long SCH fragments, keep windows that include target tokens.
            windows = [seg[i : i + 420] for i in range(0, len(seg), 240)]
        else:
            windows = [seg]
        for win in windows:
            upper = win.upper()
            gpios = sorted(set(item.upper() for item in GPIO_NET_PATTERN.findall(upper)))
            powers = sorted(set(item.upper() for item in POWER_NET_PATTERN.findall(upper)))
            passives = sorted(set(item.upper() for item in PASSIVE_IN_SEGMENT_PATTERN.findall(upper)))
            refdes = sorted(set(item.upper() for item in REFDES_PATTERN.findall(upper)))
            if not gpios or not powers:
                continue
            if not passives and not any(item.startswith(("R", "C", "L")) for item in refdes):
                continue
            power_target = next((p for p in powers if p in {"VCC", "3V3", "VDD", "5V", "VBAT", "VBUS"}), powers[0])
            for gpio in gpios[:3]:
                key = (gpio, power_target, tuple(passives[:4]), tuple(refdes[:6]))
                if key in seen:
                    continue
                seen.add(key)
                chains.append(
                    {
                        "anchor_net": gpio,
                        "to_power_net": power_target,
                        "passive_values": passives[:6],
                        "passive_refdes": [r for r in refdes if r.startswith(("R", "C", "L"))][:8],
                        "evidence": win[:220],
                    }
                )
                if len(chains) >= 24:
                    return chains
    return chains


def detect_device_family(project: dict[str, Any]) -> tuple[str, str]:
    text = _combined_text(project)
    normalized_text = re.sub(r"[_/]+", "-", text)
    for family, pattern in DEVICE_PATTERNS:
        match = re.search(pattern, normalized_text, flags=re.IGNORECASE)
        if match:
            model = _sanitize_anchor_device_model(match.group(1))
            if model:
                return family, model
            return family, ""
    return "", ""


def _sanitize_anchor_device_model(value: str) -> str:
    model = str(value or "").strip().upper().replace(" ", "-")
    if not model:
        return ""
    if re.search(r"[\u4e00-\u9fff]", model):
        return ""
    if not re.fullmatch(r"[A-Z0-9.+_-]{3,40}", model):
        return ""
    if model.endswith(("-", "_", ".")):
        return ""
    if family := next((prefix for prefix in ("ESP32", "RP2040", "STM32") if model.startswith(prefix)), ""):
        if family == "STM32" and not re.fullmatch(r"STM32[A-Z0-9.+_-]{1,36}", model):
            return ""
    return model


def _template_id(project: dict[str, Any], template_type: str, anchor_model: str) -> str:
    source = "|".join(
        [
            str(project.get("project_id", "")),
            str(project.get("project_url", "")),
            template_type,
            anchor_model,
        ]
    )
    digest = hashlib.sha1(source.encode("utf-8")).hexdigest()[:8]
    anchor = (anchor_model or "generic").lower()
    return f"tpl-{anchor}-{template_type}-{digest}"


def _source_fields(project: dict[str, Any]) -> tuple[str, float]:
    if project.get("source_mode") == "file_first":
        return "lceda_open_source_extract", 0.82
    return "text_heuristic_fallback", 0.55


def _make_template(
    project: dict[str, Any],
    template_type: str,
    anchor_family: str,
    anchor_model: str,
    scenario_tags: list[str],
    components: list[dict[str, Any]],
    pin_bindings: list[dict[str, Any]],
    default_values: dict[str, Any],
) -> dict[str, Any]:
    source, quality_score = _source_fields(project)
    return {
        "template_id": _template_id(project, template_type, anchor_model),
        "template_type": template_type,
        "anchor_device_family": anchor_family,
        "anchor_device_model": anchor_model,
        "scenario_tags": scenario_tags,
        "components": components,
        "pin_bindings": pin_bindings,
        "default_values": default_values,
        "source": source,
        "quality_score": quality_score,
        "source_project": {
            "project_id": project.get("project_id", ""),
            "project_url": _sanitize_source_project_url(project.get("project_url", "")),
            "title": _sanitize_source_project_title(project.get("title", "")),
        },
    }


def extract_templates_from_project(project: dict[str, Any]) -> list[dict[str, Any]]:
    schematic_file_path = str(project.get("schematic_file_path", ""))
    file_text = _read_schematic_file_text(schematic_file_path)
    combined_text = " ".join(
        str(project.get(key, ""))
        for key in ["title", "summary", "raw_page_text", "project_url"]
    ) + " " + file_text
    text = combined_text.lower()
    has_bms_context = _has_bms_context(project)
    schematic_tokens = parse_schematic_text_tokens(combined_text)
    file_tokens = parse_schematic_text_tokens(file_text)
    normalized_nets = {token.upper() for token in schematic_tokens["nets"]}
    normalized_values = {token.upper() for token in schematic_tokens["part_values"]}
    normalized_connectors = {token.upper() for token in schematic_tokens["connectors"]}
    normalized_text = combined_text.upper()
    detected_sense_resistor = _first_low_ohm_sense_value(normalized_values)
    has_low_ohm_sense = bool(detected_sense_resistor)
    has_battery_bus = any(
        net in normalized_nets or any(item.startswith(net) for item in normalized_nets)
        for net in {"VBAT", "B+", "B-", "P+", "P-"}
    ) or any(_contains_bus_label(normalized_text, label) for label in {"VBAT", "B+", "B-", "P+", "P-"})
    has_ntc_signal = any("NTC" in value for value in normalized_values) or any(
        net.startswith("NTC") for net in normalized_nets
    )
    has_bms_control_signal = any(
        marker in text or any(marker in value for value in normalized_values)
        for marker in ["cm1048", "cm1010", "mosfet", "ao3414", "cms40h15m", "充放电电流"]
    )
    has_mcu_power_nets = (
        ("3V3" in normalized_nets or "VCC" in normalized_nets or "VBUS" in normalized_nets)
        and "GND" in normalized_nets
    )
    has_uart_signal = (
        any("UART" in net for net in normalized_nets)
        or any(net in {"TX", "RX", "TXD", "RXD", "U0TXD", "U0RXD", "DTR", "RTS"} for net in normalized_nets)
        or any(net.endswith(("_TX", "_RX", "_TXD", "_RXD")) for net in normalized_nets)
    )
    has_uart_connector = any(
        "UART" in connector and any(marker in connector for marker in ("HEADER", "CONN", "PAD"))
        for connector in normalized_connectors
    )
    has_uart_bridge_hint = any(
        marker in text or any(marker in value.lower() for value in normalized_values) or any(marker in part.lower() for part in schematic_tokens["part_numbers"])
        for marker in [
            "ch340",
            "ch343",
            "ch9102",
            "cp210",
            "pl2303",
            "ft232",
            "usb转uart",
            "usb to uart",
            "usb-serial",
            "usb serial",
        ]
    )
    has_download_control_signal = any(
        net in {"GPIO0", "IO0", "BOOT", "BOOT0", "EN", "RST", "RESET"}
        or net.endswith(("_EN", "_RST", "_RESET", "_BOOT", "_BOOT0", "_IO0", "_GPIO0"))
        for net in normalized_nets
    )
    file_first_mode = str(project.get("source_mode", "")) == "file_first"
    has_file_input = bool(str(project.get("schematic_file_path", "")).strip())
    has_file_schematic_signal = bool(
        file_tokens["nets"] or file_tokens["part_values"] or file_tokens["part_numbers"] or file_tokens["connectors"]
    )
    # file_first mode should be backed by actual schematic-like signal; otherwise avoid text-only heuristics.
    allow_text_heuristics = not file_first_mode or not has_file_input or has_file_schematic_signal
    anchor_family, anchor_model = detect_device_family(project)
    connection_chains = _extract_structured_connection_chains(schematic_file_path)
    if not connection_chains:
        connection_chains = _extract_connection_chains(file_text or combined_text)
    if not connection_chains:
        connection_chains = _fallback_connection_chains_from_tokens(normalized_nets, normalized_values)
    templates: list[dict[str, Any]] = []

    if (allow_text_heuristics and any(keyword in text for keyword in ["usb-c", "type-c", "type c", "usb c", "vbus"])) or (
        "VBUS" in normalized_nets and ("CC1" in normalized_nets or "CC2" in normalized_nets)
    ):
        templates.append(
            _make_template(
                project,
                "usb_power_input",
                anchor_family,
                anchor_model,
                ["usb-c", "power-input"],
                [
                    {"role": "connector", "suggested_prefix": "J", "value": "USB-C"},
                    {"role": "cc_resistor", "suggested_prefix": "R", "value": "5.1k"},
                    {"role": "input_protection", "suggested_prefix": "D", "value": "TVS/ESD"},
                ],
                [
                    {"net": "VBUS", "target": "5V"},
                    {"net": "CC1", "target": "GND via 5.1k"},
                    {"net": "CC2", "target": "GND via 5.1k"},
                ],
                {"input_voltage": "5V", "cc_resistor": "5.1k"},
            )
        )

    if anchor_family and (
        (allow_text_heuristics and any(keyword in text for keyword in ["电源", "power", "5v", "3v3", "3.3v", "ldo", "开发板", "mcu"]))
        or has_mcu_power_nets
    ):
        templates.append(
            _make_template(
                project,
                "mcu_power_core",
                anchor_family,
                anchor_model,
                ["mcu", "power"],
                [
                    {"role": "mcu", "suggested_prefix": "U", "value": anchor_model or anchor_family},
                    {"role": "decoupling_capacitor", "suggested_prefix": "C", "value": "100nF"},
                    {"role": "bulk_capacitor", "suggested_prefix": "C", "value": "10uF"},
                ],
                [
                    {"net": "3V3", "target": "MCU VDD"},
                    {"net": "GND", "target": "MCU GND"},
                ],
                {"core_voltage": "3.3V", "decoupling": "100nF per power pin"},
            )
        )

    if anchor_family and (
        (allow_text_heuristics and any(keyword in text for keyword in ["usb转uart", "usb to uart", "ch340", "cp210", "自动下载", "下载模式"]))
        or (has_uart_signal and has_download_control_signal and (has_uart_bridge_hint or has_uart_connector))
    ):
        templates.append(
            _make_template(
                project,
                "uart_download_header",
                anchor_family,
                anchor_model,
                ["uart", "download", "debug"],
                [
                    {"role": "usb_uart_bridge", "suggested_prefix": "U", "value": "CH340/CP210x"},
                    {"role": "auto_download_transistor", "suggested_prefix": "Q", "value": "NPN/NMOS"},
                    {"role": "series_resistor", "suggested_prefix": "R", "value": "100R"},
                ],
                [
                    {"net": "UART_TXD", "target": "MCU RXD"},
                    {"net": "UART_RXD", "target": "MCU TXD"},
                    {"net": "DTR/RTS", "target": "MCU boot/reset strap"},
                ],
                {"baud_rate": "115200", "bridge": "CH340/CP210x"},
            )
        )

    if (allow_text_heuristics and any(keyword in text for keyword in ["boot", "bootsel", "reset", "复位"])) or (
        "BOOT" in normalized_nets or "RESET" in normalized_nets
    ):
        templates.append(
            _make_template(
                project,
                "mcu_boot_reset",
                anchor_family,
                anchor_model,
                ["mcu", "boot", "reset"],
                [
                    {"role": "boot_button", "suggested_prefix": "SW", "value": "BOOT"},
                    {"role": "reset_button", "suggested_prefix": "SW", "value": "RESET"},
                    {"role": "pull_resistor", "suggested_prefix": "R", "value": "10k"},
                ],
                [
                    {"net": "BOOT", "target": "MCU boot strap pin"},
                    {"net": "RESET", "target": "MCU reset/en pin"},
                ],
                {"pull_resistor": "10k", "button_to": "GND"},
            )
        )

    if (allow_text_heuristics and any(keyword in text for keyword in ["i2c", "sda", "scl", "传感器"])) or (
        "SDA" in normalized_nets and "SCL" in normalized_nets
    ):
        templates.append(
            _make_template(
                project,
                "i2c_sensor_subsystem",
                anchor_family,
                anchor_model,
                ["i2c", "sensor"],
                [
                    {"role": "sensor", "suggested_prefix": "U", "value": "I2C sensor"},
                    {"role": "pullup_resistor", "suggested_prefix": "R", "value": "4.7k"},
                ],
                [
                    {"net": "SDA", "target": "MCU I2C SDA"},
                    {"net": "SCL", "target": "MCU I2C SCL"},
                    {"net": "3V3", "target": "sensor VCC"},
                ],
                {"pullup": "4.7k", "bus_voltage": "3.3V"},
            )
        )

    if (
        ("VBAT" in normalized_nets or "VBUS" in normalized_nets or "VCC" in normalized_nets)
        and any("LED" in value for value in normalized_values)
    ):
        templates.append(
            _make_template(
                project,
                "power_indicator",
                anchor_family,
                anchor_model,
                ["indicator", "power"],
                [
                    {"role": "led", "suggested_prefix": "D", "value": "LED"},
                    {"role": "series_resistor", "suggested_prefix": "R", "value": "1k"},
                ],
                [{"net": "VBAT" if "VBAT" in normalized_nets else "VBUS", "target": "power rail indicator"}],
                {"series_resistor": "1k"},
            )
        )

    if (
        has_bms_context
        and has_battery_bus
        and has_ntc_signal
        and (
            has_low_ohm_sense
            or any("MMBT" in value for value in normalized_values)
            or any("MMBT" in part_number for part_number in schematic_tokens["part_numbers"])
            or has_bms_control_signal
        )
    ):
        templates.append(
            _make_template(
                project,
                "battery_protection",
                anchor_family,
                anchor_model,
                ["battery", "protection", "bms"],
                [
                    {"role": "sense_resistor", "suggested_prefix": "R", "value": detected_sense_resistor or "0.005R"},
                    {"role": "temperature_sensor", "suggested_prefix": "RT", "value": "NTC 10K"},
                    {"role": "protection_transistor", "suggested_prefix": "Q", "value": "MMBT/AO3414/CMS40H15M"},
                ],
                [
                    {"net": "VBAT", "target": "battery pack positive"},
                    {"net": "B+", "target": "cell stack positive"},
                    {"net": "B-", "target": "cell stack negative"},
                    {"net": "NTC1", "target": "pack temperature sense"},
                ],
                {"sense_resistor": detected_sense_resistor or "0.005R", "ntc": "10K"},
            )
        )

    if (
        has_bms_context
        and has_low_ohm_sense
        and (
            any(net == "B-" or net.startswith("B-") or net == "P-" or net.startswith("P-") for net in normalized_nets)
            or _contains_bus_label(normalized_text, "B-")
            or _contains_bus_label(normalized_text, "P-")
        )
    ):
        templates.append(
            _make_template(
                project,
                "current_sense",
                anchor_family,
                anchor_model,
                ["battery", "current-sense", "bms"],
                [
                    {"role": "sense_resistor", "suggested_prefix": "R", "value": detected_sense_resistor or "0.005R"},
                    {"role": "kelvin_connection", "suggested_prefix": "NET", "value": "B-/P- sense"},
                ],
                [
                    {"net": "B-", "target": "low-side current sense input"},
                    {"net": "PGND", "target": "pack power ground"},
                ],
                {"sense_resistor": detected_sense_resistor or "0.005R", "package": "2512"},
            )
        )

    if (
        has_bms_context
        and any(net.startswith("NTC") for net in normalized_nets)
        and (
            any("NTC" in value for value in normalized_values)
            or any("10K" in value for value in normalized_values)
            or "温度" in text
        )
    ):
        templates.append(
            _make_template(
                project,
                "temperature_sense",
                anchor_family,
                anchor_model,
                ["battery", "temperature-sense", "bms"],
                [
                    {"role": "ntc_thermistor", "suggested_prefix": "RT", "value": "NTC 10K"},
                    {"role": "bias_resistor", "suggested_prefix": "R", "value": "10K"},
                ],
                [
                    {"net": "NTC1", "target": "temperature sense input"},
                    {"net": "GND", "target": "sense reference"},
                ],
                {"ntc": "10K", "beta": "3435K"},
            )
        )

    if anchor_family and (
        (allow_text_heuristics and any(keyword in text for keyword in ["指示灯", "status", "gpio"]))
        or any("LED" in value for value in normalized_values)
    ):
        templates.append(
            _make_template(
                project,
                "status_indicator",
                anchor_family,
                anchor_model,
                ["indicator", "gpio"],
                [
                    {"role": "led", "suggested_prefix": "D", "value": "LED"},
                    {"role": "series_resistor", "suggested_prefix": "R", "value": "1k"},
                ],
                [{"net": "GPIO", "target": "MCU status GPIO"}],
                {"series_resistor": "1k"},
            )
        )

    component_bundle = _build_component_bundle_template(
        project=project,
        anchor_family=anchor_family,
        anchor_model=anchor_model,
        schematic_tokens=schematic_tokens,
        combined_text=combined_text,
        connection_chains=connection_chains,
    )
    if component_bundle:
        templates.append(component_bundle)

    gpio_chain_template = _build_gpio_chain_template(
        project=project,
        anchor_family=anchor_family,
        anchor_model=anchor_model,
        connection_chains=connection_chains,
    )
    if gpio_chain_template:
        templates.append(gpio_chain_template)

    _apply_template_quality(project, templates, schematic_tokens, file_text, combined_text)
    for template in templates:
        _apply_static_scoring(template)
    return templates


def _build_component_bundle_template(
    project: dict[str, Any],
    anchor_family: str,
    anchor_model: str,
    schematic_tokens: dict[str, list[str]],
    combined_text: str,
    connection_chains: list[dict[str, Any]],
) -> dict[str, Any] | None:
    values = [str(v).upper() for v in schematic_tokens.get("part_values", [])]
    part_numbers = [str(v).upper() for v in schematic_tokens.get("part_numbers", [])]
    lcsc_codes = sorted(set(code.upper() for code in LCSC_PART_CODE_PATTERN.findall(combined_text)))
    passive_values = [v for v in values if PASSIVE_VALUE_PATTERN.search(v)]
    active_parts = [
        p
        for p in part_numbers
        if any(key in p for key in ("ESP32", "STM32", "RP2040", "CH340", "CP210", "IP5306", "ME6217", "LM", "TPS"))
    ]
    if not (active_parts or passive_values or lcsc_codes):
        return None

    main_components = active_parts[:8]
    passives = passive_values[:12]
    components = []
    for val in main_components:
        components.append({"role": "main_component", "suggested_prefix": "U", "value": val})
    for val in passives:
        components.append({"role": "passive_support", "suggested_prefix": "R/C/L", "value": val})
    for code in lcsc_codes[:12]:
        components.append({"role": "jlc_part_code", "suggested_prefix": "C", "value": code})
    prioritized_chains = [
        chain
        for chain in connection_chains
        if str(chain.get("chain_type", "")) in {"usb_cc", "gpio_bias", "power_decoupling"}
    ]
    if not prioritized_chains:
        prioritized_chains = connection_chains

    for chain in prioritized_chains[:8]:
        chain_summary = f"{chain.get('anchor_net','')} -> {chain.get('to_power_net','')}"
        components.append({"role": "gpio_passive_chain", "suggested_prefix": "NET", "value": chain_summary})

    return _make_template(
        project,
        "component_combo_bundle",
        anchor_family,
        anchor_model,
        ["component-bundle", "passive-network", "placement-ready"],
        components,
        [{"net": net, "target": "bundle anchor net"} for net in schematic_tokens.get("nets", [])[:8]],
        {
            "main_components": main_components,
            "passive_components": passives,
            "jlc_part_codes": lcsc_codes,
            "connection_chains": prioritized_chains[:20],
        },
    )


def _build_gpio_chain_template(
    project: dict[str, Any],
    anchor_family: str,
    anchor_model: str,
    connection_chains: list[dict[str, Any]],
) -> dict[str, Any] | None:
    filtered_chains = [
        chain
        for chain in connection_chains
        if str(chain.get("chain_type", "")) in {"gpio_bias", "usb_cc", "control_bias"}
    ]
    if not filtered_chains:
        return None
    components: list[dict[str, Any]] = []
    pin_bindings: list[dict[str, Any]] = []
    for chain in filtered_chains[:10]:
        anchor = str(chain.get("anchor_net", "")).upper()
        power = str(chain.get("to_power_net", "")).upper()
        passives = [str(v).upper() for v in chain.get("passive_values", []) if str(v).strip()]
        refdes = [str(v).upper() for v in chain.get("passive_refdes", []) if str(v).strip()]
        if anchor:
            components.append({"role": "gpio_anchor", "suggested_prefix": "GPIO", "value": anchor})
        for value in passives[:3]:
            components.append({"role": "passive_support", "suggested_prefix": "R/C/L", "value": value})
        for ref in refdes[:3]:
            components.append({"role": "passive_refdes", "suggested_prefix": "R/C/L", "value": ref})
        if anchor:
            target = power or "power_rail"
            if passives:
                target = f"{target} via {'/'.join(passives[:2])}"
            pin_bindings.append({"net": anchor, "target": target})

    return _make_template(
        project,
        "gpio_passive_power_chain",
        anchor_family,
        anchor_model,
        ["gpio", "passive-network", "power-bias"],
        components[:40],
        pin_bindings[:20],
        {"connection_chains": filtered_chains[:20]},
    )


def _apply_template_quality(
    project: dict[str, Any],
    templates: list[dict[str, Any]],
    schematic_tokens: dict[str, list[str]],
    file_text: str,
    combined_text: str,
) -> None:
    has_file_input = bool(str(project.get("schematic_file_path", "")).strip())
    lcsc_codes = sorted(set(code.upper() for code in LCSC_PART_CODE_PATTERN.findall(combined_text)))
    has_sch_doctype = '"DOCTYPE":"SCH"' in file_text.upper() or '"DOCTYPE":"SCH_PAGE"' in file_text.upper()
    component_count = len(schematic_tokens.get("part_values", [])) + len(schematic_tokens.get("part_numbers", []))
    for template in templates:
        connection_chains = (template.get("default_values", {}) or {}).get("connection_chains", []) or []
        has_token_fallback_chain = any(
            "token-fallback:" in str(chain.get("evidence", ""))
            for chain in connection_chains
        )
        if not connection_chains:
            connection_chains = _extract_connection_chains(file_text or combined_text)
        if not connection_chains:
            normalized_nets = {token.upper() for token in schematic_tokens.get("nets", [])}
            normalized_values = {token.upper() for token in schematic_tokens.get("part_values", [])}
            connection_chains = _fallback_connection_chains_from_tokens(normalized_nets, normalized_values)
            if connection_chains:
                has_token_fallback_chain = True
        score = float(template.get("quality_score", 0.55))
        if has_file_input:
            score += 0.08
        if has_sch_doctype:
            score += 0.08
        if component_count >= 8:
            score += 0.05
        if template.get("template_type") == "component_combo_bundle":
            score += 0.08
        if template.get("template_type") == "gpio_passive_power_chain":
            score += 0.12
        if connection_chains:
            score += 0.06
        if any(len(chain.get("passive_values", [])) >= 2 for chain in connection_chains):
            score += 0.04
        if lcsc_codes:
            score += 0.12
        if has_file_input and template.get("template_type") in {"gpio_passive_power_chain", "mcu_boot_reset"} and not connection_chains:
            score -= 0.18
        if has_file_input and has_token_fallback_chain:
            score -= 0.12
        anchor_model = str(template.get("anchor_device_model", "")).strip()
        if not anchor_model:
            score -= 0.06
        score = min(round(score, 4), 0.99)
        template["quality_score"] = score
        template["quality_detail"] = {
            "has_file_input": has_file_input,
            "has_sch_doctype": has_sch_doctype,
            "component_signal_count": component_count,
            "connection_chain_count": len(connection_chains),
            "connection_chains": connection_chains[:16],
            "has_token_fallback_chain": has_token_fallback_chain,
            "lcsc_part_code_count": len(lcsc_codes),
            "lcsc_part_codes": lcsc_codes[:20],
            "jlc_searchable_component_score": round(0.15 if lcsc_codes else 0.0, 4),
        }


def _clamp_score(value: float) -> float:
    return max(0.0, min(float(value), 1.0))


def _score_structure(template: dict[str, Any], source_project: dict[str, Any]) -> float:
    score = 0.25
    if str(template.get("template_type", "")).strip():
        score += 0.2
    if str(template.get("anchor_device_family", "")).strip():
        score += 0.15
    if str(template.get("anchor_device_model", "")).strip():
        score += 0.15
    if template.get("components"):
        score += 0.1
    if (template.get("default_values") or {}).get("connection_chains"):
        score += 0.05
    if any(str(source_project.get(key, "")).strip() for key in ("project_id", "project_url", "title")):
        score += 0.1
    return _clamp_score(score)


def _score_signal_chains(quality_detail: dict[str, Any], chains: list[dict[str, Any]]) -> float:
    actual_chain_count = len(chains)
    has_token_fallback_chain = bool(quality_detail.get("has_token_fallback_chain", False))
    if actual_chain_count <= 0:
        return 0.05 if has_token_fallback_chain else 0.1

    score = 0.45 + min(actual_chain_count, 3) * 0.2
    if any(str(chain.get("evidence", "")).strip() for chain in chains):
        score += 0.1
    if any(chain.get("passive_refdes") for chain in chains):
        score += 0.05
    if has_token_fallback_chain:
        score -= 0.35
    return _clamp_score(score)


def _score_combo_integrity(
    template: dict[str, Any],
    chains: list[dict[str, Any]],
    components: list[dict[str, Any]],
) -> float:
    score = 0.15
    component_roles = {str(component.get("role", "")).strip() for component in components}
    if chains:
        score += 0.35
    if len(components) >= 2:
        score += 0.2
    if len(component_roles - {""}) >= 2:
        score += 0.15
    if str(template.get("template_type", "")) in {"gpio_passive_power_chain", "component_combo_bundle"}:
        score += 0.15
    return _clamp_score(score)


def _score_jlc_searchable(quality_detail: dict[str, Any], components: list[dict[str, Any]]) -> float:
    lcsc_codes = quality_detail.get("lcsc_part_codes") or []
    if lcsc_codes:
        return _clamp_score(0.6 + min(len(lcsc_codes), 3) * 0.1)

    component_codes = sorted(
        {
            code.upper()
            for component in components
            for code in LCSC_PART_CODE_PATTERN.findall(str(component.get("value", "")))
        }
    )
    if component_codes:
        return _clamp_score(0.55 + min(len(component_codes), 3) * 0.1)

    if any(str(component.get("role", "")).strip() == "jlc_part_code" for component in components):
        return 0.45
    return 0.0


def _score_project_quality(
    template: dict[str, Any],
    source_project: dict[str, Any],
    quality_detail: dict[str, Any],
) -> float:
    score = 0.1
    if str(source_project.get("project_id", "")).strip():
        score += 0.25
    if str(source_project.get("project_url", "")).strip():
        score += 0.2
    if str(source_project.get("title", "")).strip():
        score += 0.2
    if bool(quality_detail.get("has_file_input", False)):
        score += 0.15
    if bool(template.get("anchor_device_model", "")):
        score += 0.1
    return _clamp_score(score)


def _build_score_reasons(
    template: dict[str, Any],
    quality_detail: dict[str, Any],
    chains: list[dict[str, Any]],
    components: list[dict[str, Any]],
    source_project: dict[str, Any],
) -> list[str]:
    reasons: list[str] = []
    if chains and int(quality_detail.get("connection_chain_count", 0) or len(chains) or 0) > 0:
        reasons.append("real_connection_chains")
    if bool(quality_detail.get("has_token_fallback_chain", False)):
        reasons.append("token_fallback_chain")
    if quality_detail.get("lcsc_part_codes"):
        reasons.append("lcsc_searchable_components")
    if len(components) >= 2:
        reasons.append("multi_component_context")
    if str(source_project.get("project_url", "")).strip():
        reasons.append("source_project_traceable")
    if str(template.get("anchor_device_model", "")).strip():
        reasons.append("anchor_model_detected")
    return reasons


def _canonical_net_name(value: str) -> str:
    text = str(value or "").strip().upper()
    aliases = {
        "+3.3V": "3V3",
        "3.3V": "3V3",
        "+5V": "5V",
        "GPIO0": "IO0",
        "BOOT": "IO0",
        "BOOT0": "IO0",
        "CHIP_EN": "EN",
        "RESET": "EN",
        "RST": "EN",
    }
    return aliases.get(text, text)


def _infer_module_type(template: dict[str, Any], chains: list[dict[str, Any]]) -> str:
    anchor_model = str(template.get("anchor_device_model", "")).upper()
    template_type = str(template.get("template_type", "")).strip()
    chain_text = " ".join(
        f"{chain.get('anchor_net', '')} {chain.get('to_power_net', '')} {chain.get('evidence', '')}"
        for chain in chains
    ).upper()
    if "ESP32-S3" in anchor_model and template_type in {
        "gpio_passive_power_chain",
        "mcu_boot_reset",
        "mcu_power_core",
        "component_combo_bundle",
    }:
        if any(marker in chain_text for marker in ("EN", "IO0", "GPIO0", "BOOT", "3V3", "VBUS", "GND")):
            return "esp32_s3_minimum_system"
    if template_type == "usb_power_input":
        return "usb_c_power_input"
    if template_type in {"battery_protection", "current_sense", "temperature_sense"}:
        return f"battery_{template_type}"
    return template_type or "reference_subcircuit"


def _infer_anchor_component(template: dict[str, Any], module_type: str) -> dict[str, str]:
    anchor_model = str(template.get("anchor_device_model", "")).strip()
    anchor_family = str(template.get("anchor_device_family", "")).strip()
    part = anchor_model or anchor_family or module_type
    role = "module_anchor"
    if module_type == "esp32_s3_minimum_system" or str(anchor_family).upper() in {"ESP32", "STM32", "RP2040"}:
        role = "mcu_module"
    elif module_type == "usb_c_power_input":
        role = "usb_c_connector"
    elif module_type.startswith("battery_"):
        role = "battery_power_module"
    return {"part": part, "role": role}


def _infer_structured_chain_intent(anchor_net: str, via: str, to_power_net: str) -> str:
    anchor = _canonical_net_name(anchor_net)
    target = _canonical_net_name(to_power_net)
    middle = str(via or "").upper()
    if middle.startswith("C") and target == "GND":
        return "decoupling"
    if anchor == "EN" and target in {"3V3", "VCC", "VDD", "VBUS", "5V"}:
        return "enable_pullup"
    if anchor == "IO0" and target == "GND":
        return "boot_strap"
    if anchor == "EN" and target == "GND":
        return "reset_or_enable_bias"
    if anchor in {"VBUS", "VBAT", "5V", "3V3", "VCC", "VDD"} or target in {"VBUS", "VBAT", "5V", "3V3", "VCC", "VDD"}:
        return "power_path"
    return "signal_or_reference_chain"


def _infer_structured_component_role(ref: str, anchor_net: str, to_power_net: str) -> str:
    designator = str(ref or "").upper()
    anchor = _canonical_net_name(anchor_net)
    target = _canonical_net_name(to_power_net)
    if designator.startswith("C"):
        return "decoupling_capacitor"
    if designator.startswith("R") and anchor == "EN" and target in {"3V3", "VCC", "VDD", "VBUS", "5V"}:
        return "en_pullup"
    if designator.startswith("R") and anchor == "IO0" and target == "GND":
        return "boot_pulldown_or_button_resistor"
    if designator.startswith("R") and anchor == "EN" and target == "GND":
        return "reset_or_enable_bias_resistor"
    if designator.startswith("R"):
        return "bias_resistor"
    if designator.startswith(("J", "CN", "USB")):
        return "connector"
    return "module_component"


def _build_structured_rag_module_fields(template: dict[str, Any], chains: list[dict[str, Any]]) -> dict[str, Any]:
    module_type = _infer_module_type(template, chains)
    anchor_component = _infer_anchor_component(template, module_type)
    structured_chains: list[dict[str, str]] = []
    structured_components: list[dict[str, str]] = []
    pin_bindings: list[dict[str, str]] = []
    nets: list[str] = []

    def add_net(value: str) -> None:
        net = _canonical_net_name(value)
        if net and net not in nets:
            nets.append(net)

    for chain in chains:
        anchor = _canonical_net_name(str(chain.get("anchor_net", "")).strip())
        target = _canonical_net_name(str(chain.get("to_power_net", "")).strip())
        passive_refdes = [str(v).strip() for v in chain.get("passive_refdes", []) if str(v).strip()]
        passive_values = [str(v).strip() for v in chain.get("passive_values", []) if str(v).strip()]
        via = passive_refdes[0] if passive_refdes else passive_values[0] if passive_values else ""
        if not anchor or not target:
            continue
        add_net(anchor)
        add_net(target)
        structured_chains.append(
            {
                "from": anchor,
                "via": via,
                "to": target,
                "intent": _infer_structured_chain_intent(anchor, via, target),
            }
        )
        if via:
            component = {
                "ref": via,
                "role": _infer_structured_component_role(via, anchor, target),
            }
            if passive_values:
                component["value"] = passive_values[0]
            if component not in structured_components:
                structured_components.append(component)
        if anchor in {"EN", "IO0"} and {"component_role": "mcu_module", "pin": anchor, "net": anchor} not in pin_bindings:
            pin_bindings.append({"component_role": "mcu_module", "pin": anchor, "net": anchor})

    return {
        "module_type": module_type,
        "anchor_component": anchor_component,
        "structured_components": structured_components,
        "nets": nets,
        "connection_chains": structured_chains,
        "pin_bindings": pin_bindings,
    }


def _infer_intent_tags(
    template: dict[str, Any],
    chains: list[dict[str, Any]],
    components: list[dict[str, Any]],
) -> list[str]:
    tags: list[str] = []
    template_type = str(template.get("template_type", ""))
    if template_type == "gpio_passive_power_chain":
        tags.append("gpio_bias")
    if template_type == "mcu_boot_reset":
        tags.append("reset")

    chain_text = " ".join(
        " ".join(
            [
                str(chain.get("chain_type", "")),
                str(chain.get("anchor_net", "")),
                str(chain.get("to_power_net", "")),
                str(chain.get("evidence", "")),
            ]
        ).upper()
        for chain in chains
    )
    component_text = " ".join(
        f"{component.get('role', '')} {component.get('value', '')}".upper()
        for component in components
    )
    combined = f"{chain_text} {component_text}"
    if any(marker in combined for marker in ("GPIO", "IO0", "EN")) and "gpio_bias" not in tags:
        tags.append("gpio_bias")

    reset_markers = ("RESET", " RST ", "RST_", "_RST", "BOOT", "CHIP_EN", "RESET/EN")
    padded_combined = f" {combined} "
    if any(marker in padded_combined for marker in reset_markers) and "reset" not in tags:
        tags.append("reset")
    if any(marker in combined for marker in ("3V3", "VCC", "VBUS", "VDD")):
        tags.append("power")

    deduped: list[str] = []
    for tag in tags:
        if tag not in deduped:
            deduped.append(tag)
    return deduped


def _apply_static_scoring(template: dict[str, Any]) -> dict[str, Any]:
    quality_detail = template.get("quality_detail") or {}
    source_project = template.get("source_project") or {}
    chains = quality_detail.get("connection_chains") or (template.get("default_values") or {}).get("connection_chains", []) or []
    components = template.get("components") or []

    structure_score = _score_structure(template, source_project)
    signal_chain_score = _score_signal_chains(quality_detail, chains)
    combo_integrity_score = _score_combo_integrity(template, chains, components)
    jlc_searchable_score = _score_jlc_searchable(quality_detail, components)
    project_quality_score = _score_project_quality(template, source_project, quality_detail)
    score_reasons = _build_score_reasons(template, quality_detail, chains, components, source_project)
    intent_tags = _infer_intent_tags(template, chains, components)

    static_quality_score = round(
        structure_score * 0.15
        + signal_chain_score * 0.30
        + combo_integrity_score * 0.25
        + jlc_searchable_score * 0.20
        + project_quality_score * 0.10,
        4,
    )

    template["scoring"] = {
        "static_quality_score": static_quality_score,
        "structure_score": round(structure_score, 4),
        "signal_chain_score": round(signal_chain_score, 4),
        "combo_integrity_score": round(combo_integrity_score, 4),
        "jlc_searchable_score": round(jlc_searchable_score, 4),
        "project_quality_score": round(project_quality_score, 4),
        "score_reasons": score_reasons,
        "intent_tags": intent_tags,
    }
    structured_module = _build_structured_rag_module_fields(template, chains)
    template["module_type"] = structured_module["module_type"]
    template["anchor_component"] = structured_module["anchor_component"]
    template["structured_components"] = structured_module["structured_components"]
    template["nets"] = structured_module["nets"]
    template["connection_chains"] = structured_module["connection_chains"]
    template["pin_bindings"] = structured_module["pin_bindings"] or template.get("pin_bindings", [])
    return template


def _template_signature(template: dict[str, Any]) -> str:
    comp_vals = sorted(
        str(comp.get("value", "")).strip().upper()
        for comp in template.get("components", [])
        if str(comp.get("value", "")).strip()
    )
    nets = sorted(
        str(bind.get("net", "")).strip().upper()
        for bind in template.get("pin_bindings", [])
        if str(bind.get("net", "")).strip()
    )
    payload = {
        "template_type": str(template.get("template_type", "")),
        "anchor_device_family": str(template.get("anchor_device_family", "")),
        "anchor_device_model": str(template.get("anchor_device_model", "")),
        "components": comp_vals[:20],
        "nets": nets[:20],
        "chains": [
            {
                "anchor": str(item.get("anchor_net", "")).upper(),
                "to_power": str(item.get("to_power_net", "")).upper(),
                "passive_values": [str(v).upper() for v in item.get("passive_values", [])[:4]],
            }
            for item in (template.get("default_values", {}) or {}).get("connection_chains", [])[:8]
        ],
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def deduplicate_templates(templates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    best_by_signature: dict[str, dict[str, Any]] = {}
    duplicate_count: dict[str, int] = {}
    for item in templates:
        if not isinstance(item.get("scoring"), dict):
            _apply_static_scoring(item)
        sig = _template_signature(item)
        duplicate_count[sig] = duplicate_count.get(sig, 0) + 1
        score = float(item.get("quality_score", 0.0))
        jlc_bonus = float((item.get("quality_detail") or {}).get("jlc_searchable_component_score", 0.0))
        quality_detail = item.get("quality_detail") or {}
        effective_chains = quality_detail.get("connection_chains") or (item.get("default_values") or {}).get("connection_chains", []) or []
        chain_count = len(effective_chains)
        has_token_fallback_chain = bool(quality_detail.get("has_token_fallback_chain", False))
        template_type = str(item.get("template_type", ""))
        anchor_model = str(item.get("anchor_device_model", "")).strip()
        retrieval_score = score + jlc_bonus
        if template_type in {"gpio_passive_power_chain", "mcu_boot_reset"} and chain_count == 0:
            retrieval_score -= 0.28
        if has_token_fallback_chain:
            retrieval_score -= 0.18
        if not anchor_model:
            retrieval_score -= 0.08
        retrieval_score = round(max(retrieval_score, 0.0), 4)
        item["retrieval_priority_score"] = retrieval_score
        if sig not in best_by_signature:
            best_by_signature[sig] = item
            continue
        if retrieval_score > float(best_by_signature[sig].get("retrieval_priority_score", 0.0)):
            best_by_signature[sig] = item

    deduped = list(best_by_signature.values())
    for item in deduped:
        sig = _template_signature(item)
        item["duplicate_group_size"] = duplicate_count.get(sig, 1)
    deduped.sort(key=lambda t: float(t.get("retrieval_priority_score", 0.0)), reverse=True)
    return deduped


def _iter_jsonl(path: Path):
    with path.open("r", encoding="utf-8") as file:
        for line in file:
            line = line.strip()
            if line:
                yield json.loads(line)


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        for row in rows:
            file.write(json.dumps(row, ensure_ascii=False) + "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract LCEDA template corpus from project JSONL")
    parser.add_argument("--input", required=True, help="Crawler project JSONL")
    parser.add_argument("--output", required=True, help="Template corpus JSONL")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    templates: list[dict[str, Any]] = []
    for project in _iter_jsonl(Path(args.input)):
        templates.extend(extract_templates_from_project(project))
    templates = deduplicate_templates(templates)
    output = Path(args.output)
    write_jsonl(output, templates)
    print(f"[lceda-template-extract] templates={len(templates)} -> {output}")


if __name__ == "__main__":
    main()
