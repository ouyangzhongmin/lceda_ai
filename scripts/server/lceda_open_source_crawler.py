import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse, urlunparse

import requests
from bs4 import BeautifulSoup

from scripts.server.extract_lceda_templates import _read_schematic_file_text, parse_schematic_text_tokens


PROJECT_HOSTS = {"oshwhub.com", "lceda.cn"}
NON_PROJECT_PATH_PREFIXES = {
    "activities",
    "api",
    "article",
    "assets",
    "attachments",
    "explore",
    "files",
    "forum",
    "ideas",
    "project",
    "search",
    "sign_in",
    "_next",
}
NON_PROJECT_AUTHOR_TRAILING_SEGMENTS = {
    "followers",
    "following",
    "likes",
    "projects",
    "activity",
    "activities",
    "about",
}
SCHEMATIC_EXTENSIONS = (
    ".json",
    ".epro",
    ".esch",
    ".sch",
    ".zip",
)
NOISE_TAGS = {"script", "style", "noscript", "nav", "footer", "header", "aside", "form"}
ATTACHMENT_NEGATIVE_HINTS = (
    "firmware",
    "固件",
    "stl",
    "ibom",
    "readme",
    "manual",
    "doc",
    "外壳",
    "model",
    "3d",
    "image",
    "preview",
    "logo",
    "焊接图",
)


def canonicalize_project_url(url: str) -> str:
    parsed = urlparse(url)
    path = re.sub(r"/{2,}", "/", parsed.path or "/")
    if path != "/" and path.endswith("/"):
        path = path[:-1]
    return urlunparse((parsed.scheme or "https", parsed.netloc.lower(), path, "", "", ""))


def _is_supported_project_url(url: str) -> bool:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    path = parsed.path.lower()
    if not any(host == h or host.endswith("." + h) for h in PROJECT_HOSTS):
        return False
    if path in {"/project/choose", "/project/new"}:
        return False
    if "/project/" in path or "/projects/" in path:
        return True

    segments = [segment for segment in path.strip("/").split("/") if segment]
    if len(segments) != 2:
        return False
    author_slug, project_slug = segments
    if author_slug in NON_PROJECT_PATH_PREFIXES:
        return False
    if project_slug in NON_PROJECT_AUTHOR_TRAILING_SEGMENTS:
        return False
    return True


def _append_unique(links: list[str], seen: set[str], url: str) -> None:
    canonical = canonicalize_project_url(url)
    if not _is_supported_project_url(canonical):
        return
    if canonical in seen:
        return
    seen.add(canonical)
    links.append(canonical)


def _iter_project_urls_from_json(value: Any, base_url: str):
    if isinstance(value, dict):
        author_slug = value.get("authorSlug") or value.get("userSlug")
        project_slug = value.get("projectSlug") or value.get("slug")
        if isinstance(author_slug, str) and isinstance(project_slug, str):
            yield urljoin(base_url, f"/{author_slug}/{project_slug}")
        for child in value.values():
            yield from _iter_project_urls_from_json(child, base_url)
    elif isinstance(value, list):
        for child in value:
            yield from _iter_project_urls_from_json(child, base_url)


def _extract_project_links_from_embedded_json(soup: BeautifulSoup, base_url: str) -> list[str]:
    links: list[str] = []
    seen: set[str] = set()
    for script in soup.find_all("script", type="application/json"):
        text = script.string or script.get_text("", strip=True)
        if not text:
            continue
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            continue
        for url in _iter_project_urls_from_json(data, base_url):
            _append_unique(links, seen, url)
    return links


def _extract_balanced_json_object(text: str, start_index: int) -> dict[str, Any] | None:
    depth = 0
    in_string = False
    escaped = False
    start = -1
    for index in range(start_index, len(text)):
        char = text[index]
        if start == -1:
            if char == "{":
                start = index
                depth = 1
            continue
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start : index + 1])
                except json.JSONDecodeError:
                    return None
    return None


def extract_project_payload_from_next_flight(html: str) -> dict[str, Any]:
    for encoded in re.findall(r"self\.__next_f\.push\(\[\d+,(\".*?\")\]\)", html, flags=re.DOTALL):
        try:
            decoded = json.loads(encoded)
        except json.JSONDecodeError:
            continue
        marker = '"data":'
        index = decoded.find(marker)
        if index == -1:
            continue
        payload = _extract_balanced_json_object(decoded, index + len(marker))
        if isinstance(payload, dict) and payload.get("uuid"):
            return payload
    return {}


def build_attachment_download_count_url(kind: str, object_uuid: str, attachment_uuid: str) -> str:
    return f"/api/common/{kind}/{object_uuid}/attachments/{attachment_uuid}/addDownloadCount"


def _iter_schematic_file_urls_from_json(value: Any, base_url: str):
    if isinstance(value, dict):
        project_uuid = value.get("uuid") if isinstance(value.get("uuid"), str) else None
        attachments = value.get("attachments")
        if isinstance(attachments, list):
            for attachment in attachments:
                if not isinstance(attachment, dict):
                    continue
                name = str(attachment.get("name") or attachment.get("filename") or "")
                if _is_likely_noise_attachment_name(name):
                    continue
                direct_url = str(
                    attachment.get("url")
                    or attachment.get("download_url")
                    or attachment.get("file_url")
                    or ""
                ).strip()
                if direct_url and any(direct_url.lower().endswith(ext) for ext in SCHEMATIC_EXTENSIONS):
                    yield urljoin(base_url, direct_url)
                elif name and any(name.lower().endswith(ext) for ext in SCHEMATIC_EXTENSIONS):
                    attachment_uuid = str(attachment.get("uuid") or "").strip()
                    if project_uuid and attachment_uuid:
                        yield urljoin(
                            base_url,
                            build_attachment_download_count_url("project", project_uuid, attachment_uuid),
                        )
        for child in value.values():
            yield from _iter_schematic_file_urls_from_json(child, base_url)
    elif isinstance(value, list):
        for child in value:
            yield from _iter_schematic_file_urls_from_json(child, base_url)


def _extract_schematic_file_urls_from_embedded_json(soup: BeautifulSoup, base_url: str) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    for script in soup.find_all("script", type="application/json"):
        text = script.string or script.get_text("", strip=True)
        if not text:
            continue
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            continue
        for url in _iter_schematic_file_urls_from_json(data, base_url):
            canonical = canonicalize_project_url(url)
            if canonical in seen:
                continue
            seen.add(canonical)
            urls.append(canonical)
    return urls


def _extract_schematic_file_urls_from_project_payload(payload: dict[str, Any], base_url: str) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    for attachment in payload.get("attachments") or []:
        if not isinstance(attachment, dict):
            continue
        raw_url = str(
            attachment.get("src")
            or attachment.get("url")
            or attachment.get("download_url")
            or attachment.get("file_url")
            or ""
        ).strip()
        name = str(attachment.get("name") or "").strip()
        if _is_likely_noise_attachment_name(name):
            continue
        candidate = raw_url if raw_url else ""
        attachment_uuid = str(attachment.get("uuid") or "").strip()
        project_uuid = str(payload.get("uuid") or "").strip()
        if candidate and any(candidate.lower().endswith(ext) for ext in SCHEMATIC_EXTENSIONS):
            if candidate.startswith("/oshwhub/project/attachments/"):
                absolute = canonicalize_project_url("https://image.lceda.cn" + candidate)
            elif candidate.startswith("/attachments/"):
                absolute = canonicalize_project_url("https://image.lceda.cn" + candidate)
            else:
                absolute = canonicalize_project_url(urljoin(base_url, candidate))
            if absolute not in seen:
                seen.add(absolute)
                urls.append(absolute)
            if attachment_uuid and project_uuid:
                api_candidate = canonicalize_project_url(
                    urljoin(base_url, build_attachment_download_count_url("project", project_uuid, attachment_uuid))
                )
                if api_candidate not in seen:
                    seen.add(api_candidate)
                    urls.append(api_candidate)
        elif name and any(name.lower().endswith(ext) for ext in SCHEMATIC_EXTENSIONS):
            if attachment_uuid and project_uuid:
                absolute = canonicalize_project_url(
                    urljoin(base_url, build_attachment_download_count_url("project", project_uuid, attachment_uuid))
                )
                if absolute not in seen:
                    seen.add(absolute)
                    urls.append(absolute)
    return urls


def _rank_schematic_url(candidate: str) -> tuple[int, int]:
    path = urlparse(candidate).path.lower()
    score = 0
    if "/oshwhub/project/attachments/" in path:
        score += 3
    if path.endswith((".sch", ".esch", ".epro", ".json")):
        score += 2
    elif path.endswith(".zip"):
        score += 1
    if any(k in path for k in ["schematic", "原理图", "project", "工程", "source", "源码", "main", "sch"]):
        score += 1
    if any(k in path for k in ATTACHMENT_NEGATIVE_HINTS):
        score -= 2
    return score, len(path)


def _is_likely_noise_attachment(url: str) -> bool:
    path = urlparse(url).path.lower()
    return any(hint in path for hint in ATTACHMENT_NEGATIVE_HINTS)


def _is_likely_noise_attachment_name(name: str) -> bool:
    normalized = (name or "").strip().lower()
    if not normalized:
        return False
    return any(hint in normalized for hint in ATTACHMENT_NEGATIVE_HINTS)


def _prioritize_schematic_urls(urls: list[str]) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for url in urls:
        canonical = canonicalize_project_url(url)
        if _is_likely_noise_attachment(canonical):
            continue
        if canonical in seen:
            continue
        seen.add(canonical)
        deduped.append(canonical)
    deduped.sort(key=lambda item: (-_rank_schematic_url(item)[0], _rank_schematic_url(item)[1], item))
    return deduped


def _looks_like_project_detail_page(html: str) -> bool:
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text("\n", strip=True)
    if soup.find("h1") and any(marker in text for marker in ["工程详情", "打开设计图", "设计图", "原理图", "PCB"]):
        return True
    return False


def extract_project_links(html: str, base_url: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    links: list[str] = []
    seen: set[str] = set()
    for node in soup.find_all("a", href=True):
        _append_unique(links, seen, urljoin(base_url, node["href"]))
    for url in _extract_project_links_from_embedded_json(soup, base_url):
        _append_unique(links, seen, url)
    return links


def _extract_text(html: str) -> tuple[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    for tag in NOISE_TAGS:
        for node in soup.find_all(tag):
            node.decompose()

    title = ""
    h1 = soup.find("h1")
    if h1:
        title = re.sub(r"\s+", " ", h1.get_text(" ", strip=True)).strip()
    if not title and soup.title and soup.title.string:
        title = re.sub(r"\s+", " ", soup.title.string).strip()
        title = re.split(r"\s[-|]\s", title)[0].strip()

    body = soup.body or soup
    lines = []
    for node in body.stripped_strings:
        text = re.sub(r"\s+", " ", node).strip()
        if text:
            lines.append(text)
    return title or "Untitled LCEDA Project", "\n".join(lines).strip()


def _slugify(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "-", text)
    return re.sub(r"-+", "-", text).strip("-") or "untitled"


def _project_id(project_url: str, title: str) -> str:
    parsed = urlparse(project_url)
    digest = hashlib.sha1(project_url.encode("utf-8")).hexdigest()[:8]
    path_label = _slugify(parsed.path)
    title_label = _slugify(title)
    return f"{parsed.netloc}-{path_label or title_label}-{digest}"


def _find_schematic_file_url(soup: BeautifulSoup, project_url: str) -> str:
    candidates: list[str] = []
    for node in soup.find_all(["a", "link"], href=True):
        candidates.append(urljoin(project_url, node["href"]))
    for node in soup.find_all(["script"], src=True):
        candidates.append(urljoin(project_url, node["src"]))

    scored: list[tuple[int, str]] = []
    for candidate in candidates:
        parsed = urlparse(candidate)
        path = parsed.path.lower()
        if not path.endswith(SCHEMATIC_EXTENSIONS):
            continue
        score = 0
        if any(k in path for k in ["schematic", "原理图", "project", "工程", "source", "源码"]):
            score += 2
        if path.endswith((".json", ".epro", ".esch", ".sch")):
            score += 1
        scored.append((score, canonicalize_project_url(candidate)))

    for candidate in _extract_schematic_file_urls_from_embedded_json(soup, project_url):
        score = 3
        scored.append((score, candidate))

    if not scored:
        return ""
    scored.sort(key=lambda item: (-item[0], item[1]))
    prioritized = _prioritize_schematic_urls([item[1] for item in scored])
    if not prioritized:
        return ""
    return prioritized[0]


def _find_schematic_file_urls(soup: BeautifulSoup, project_url: str, flight_payload: dict[str, Any]) -> list[str]:
    candidates: list[str] = []
    first = _find_schematic_file_url(soup, project_url)
    if first:
        candidates.append(first)
    if flight_payload:
        candidates.extend(_extract_schematic_file_urls_from_project_payload(flight_payload, project_url))
    return _prioritize_schematic_urls(candidates)


def _extract_preview_assets(soup: BeautifulSoup, project_url: str) -> list[str]:
    assets: list[str] = []
    seen: set[str] = set()
    for node in soup.find_all("img", src=True):
        absolute = canonicalize_project_url(urljoin(project_url, node["src"]))
        if absolute in seen:
            continue
        seen.add(absolute)
        assets.append(absolute)
    return assets


def _filename_from_url(url: str) -> str:
    parsed = urlparse(url)
    name = Path(parsed.path).name
    if not name:
        digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:8]
        name = f"schematic-{digest}.bin"
    return re.sub(r"[^A-Za-z0-9._\-\u4e00-\u9fff]+", "-", name)


def download_project_file(
    session: requests.Session,
    file_url: str,
    *,
    output_dir: Path,
    project_id: str,
    timeout_seconds: int,
) -> Path:
    response = session.get(file_url, timeout=timeout_seconds)
    response.raise_for_status()
    project_dir = output_dir / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    output_path = project_dir / _filename_from_url(file_url)
    output_path.write_bytes(response.content)
    return output_path


def _has_downloaded_schematic_signal(path: Path) -> bool:
    try:
        text = _read_schematic_file_text(str(path))
    except Exception:
        try:
            text = path.read_bytes()[:500_000].decode("utf-8", errors="ignore")
        except Exception:
            return False
    if not text:
        return False
    tokens = parse_schematic_text_tokens(text)
    upper = text.upper()
    if "PART NO" in upper or "PCB DECAL" in upper or "<EAGLE" in upper or "<DRAWING" in upper:
        return True
    if '"NETS"' in upper and any(
        marker in upper
        for marker in ['"3V3"', '"GND"', '"VBUS"', '"VBAT"', '"SDA"', '"SCL"', '"TX"', '"RX"', '"TXD"', '"RXD"']
    ):
        return True

    nets = {item.upper() for item in tokens["nets"]}
    values = tokens["part_values"]
    numbers = tokens["part_numbers"]
    connectors = tokens["connectors"]
    if values or numbers:
        return True

    def _is_core_net(net: str) -> bool:
        if net in {
            "GND",
            "3V3",
            "5V",
            "VBAT",
            "VBUS",
            "VCC",
            "SDA",
            "SCL",
            "TX",
            "RX",
            "TXD",
            "RXD",
            "RST",
            "RESET",
            "EN",
            "BOOT",
            "BOOT0",
            "GPIO0",
            "IO0",
            "B+",
            "B-",
            "P+",
            "P-",
        }:
            return True
        return net.startswith(("UART_", "GPIO", "IO", "U0TXD", "U0RXD", "CHIP_EN"))

    core_nets = [net for net in nets if _is_core_net(net)]
    if len(core_nets) >= 2:
        return True
    if connectors and core_nets:
        return True
    return False


def extract_project_record(
    html: str,
    project_url: str,
    category: str = "",
    keywords: list[str] | None = None,
) -> dict[str, Any]:
    canonical_url = canonicalize_project_url(project_url)
    soup = BeautifulSoup(html, "html.parser")
    title, raw_page_text = _extract_text(html)
    flight_payload = extract_project_payload_from_next_flight(html)
    schematic_file_urls = _find_schematic_file_urls(soup, canonical_url, flight_payload)
    schematic_file_url = schematic_file_urls[0] if schematic_file_urls else ""
    tags = sorted({tag.strip() for tag in (keywords or []) if tag.strip()})
    return {
        "project_id": _project_id(canonical_url, title),
        "project_uuid": str(flight_payload.get("uuid", "")),
        "title": title,
        "project_url": canonical_url,
        "category": category,
        "keywords": keywords or [],
        "summary": raw_page_text[:500],
        "tags": tags,
        "preview_assets": _extract_preview_assets(soup, canonical_url),
        "schematic_file_path": "",
        "schematic_file_url": schematic_file_url,
        "schematic_file_url_candidates": schematic_file_urls,
        "raw_page_html_path": "",
        "raw_page_text": raw_page_text,
        "source_mode": "file_first" if schematic_file_url else "text_fallback",
        "source_mode_reason": "",
        "source_mode_reason_detail": {},
        "captured_at": datetime.now(timezone.utc).isoformat(),
    }


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        for row in rows:
            file.write(json.dumps(row, ensure_ascii=False) + "\n")


def crawl_project_records(
    entry_urls: list[str],
    *,
    category: str = "",
    keywords: list[str] | None = None,
    timeout_seconds: int = 15,
    user_agent: str = "lceda-open-source-crawler/0.1",
    file_output_dir: Path | None = None,
    failure_events: list[dict[str, str]] | None = None,
) -> list[dict[str, Any]]:
    session = requests.Session()
    session.headers.update({"User-Agent": user_agent})
    records: list[dict[str, Any]] = []
    seen_projects: set[str] = set()

    for entry_url in entry_urls:
        try:
            response = session.get(entry_url, timeout=timeout_seconds)
            response.raise_for_status()
        except requests.RequestException as exc:
            print(f"[lceda-crawler] entry-fetch-failed url={entry_url} reason={exc}", file=sys.stderr)
            if failure_events is not None:
                failure_events.append(
                    {
                        "type": "entry_fetch_failed",
                        "url": entry_url,
                        "reason": str(exc),
                    }
                )
            continue
        project_urls = extract_project_links(response.text, entry_url)
        canonical_entry_url = canonicalize_project_url(entry_url)
        if _is_supported_project_url(canonical_entry_url):
            project_urls.insert(0, canonical_entry_url)
        elif _looks_like_project_detail_page(response.text):
            project_urls.insert(0, canonical_entry_url)
        for project_url in project_urls:
            if project_url in seen_projects:
                continue
            seen_projects.add(project_url)
            try:
                project_response = session.get(project_url, timeout=timeout_seconds)
                project_response.raise_for_status()
            except requests.RequestException as exc:
                print(f"[lceda-crawler] project-fetch-failed url={project_url} reason={exc}", file=sys.stderr)
                if failure_events is not None:
                    failure_events.append(
                        {
                            "type": "project_fetch_failed",
                            "url": project_url,
                            "reason": str(exc),
                        }
                    )
                continue
            record = extract_project_record(
                project_response.text,
                project_url,
                category=category,
                keywords=keywords or [],
            )
            if file_output_dir and record.get("schematic_file_url"):
                candidates = [str(record["schematic_file_url"])] + [
                    str(item) for item in record.get("schematic_file_url_candidates", []) if str(item)
                ]
                candidates = _prioritize_schematic_urls(candidates)
                download_succeeded = False
                failed_candidate_urls: list[str] = []
                for candidate_url in candidates:
                    try:
                        saved_path = download_project_file(
                            session,
                            candidate_url,
                            output_dir=file_output_dir,
                            project_id=str(record["project_id"]),
                            timeout_seconds=timeout_seconds,
                        )
                        record["schematic_file_path"] = str(saved_path)
                        record["schematic_file_url"] = candidate_url
                        if _has_downloaded_schematic_signal(saved_path):
                            record["source_mode_reason"] = "downloaded_file_with_schematic_signal"
                            download_succeeded = True
                            break
                        record["schematic_file_path"] = ""
                        record["schematic_file_url"] = ""
                        record["source_mode"] = "text_fallback"
                        record["source_mode_reason"] = "downloaded_file_without_schematic_signal"
                        continue
                    except requests.RequestException as exc:
                        failed_candidate_urls.append(candidate_url)
                        print(
                            f"[lceda-crawler] download-failed url={candidate_url} reason={exc}",
                            file=sys.stderr,
                        )
                if not download_succeeded:
                    record["schematic_file_path"] = ""
                    record["schematic_file_url"] = ""
                    record["source_mode"] = "text_fallback"
                    if not record.get("source_mode_reason"):
                        record["source_mode_reason"] = "download_failed"
                    if record.get("source_mode_reason") == "download_failed":
                        record["source_mode_reason_detail"] = {
                            "failed_candidate_urls": failed_candidate_urls,
                            "failed_candidate_count": len(failed_candidate_urls),
                        }
            records.append(record)
    return records


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Crawl LCEDA open-source project records")
    parser.add_argument("--entry-url", action="append", required=True, help="Category, search, or project URL")
    parser.add_argument("--output", required=True, help="Output project JSONL path")
    parser.add_argument("--category", default="", help="Project category label")
    parser.add_argument("--keyword", action="append", default=[], help="Keyword label to attach")
    parser.add_argument("--file-output-dir", default="", help="Optional directory for downloaded schematic/source files")
    parser.add_argument("--failure-output", default="", help="Optional JSON output path for fetch/download failures")
    parser.add_argument("--timeout-seconds", type=int, default=15)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    failure_events: list[dict[str, str]] = []
    records = crawl_project_records(
        args.entry_url,
        category=args.category,
        keywords=args.keyword,
        timeout_seconds=args.timeout_seconds,
        file_output_dir=Path(args.file_output_dir) if args.file_output_dir else None,
        failure_events=failure_events,
    )
    output = Path(args.output)
    write_jsonl(output, records)
    if args.failure_output:
        failure_path = Path(args.failure_output)
        failure_path.parent.mkdir(parents=True, exist_ok=True)
        failure_path.write_text(json.dumps({"failures": failure_events}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[lceda-crawler] records={len(records)} -> {output}")


if __name__ == "__main__":
    main()
