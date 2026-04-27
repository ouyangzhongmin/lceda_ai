import argparse
import hashlib
import json
import re
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse, urlunparse
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup

LOW_VALUE_FILE_KEYWORDS = [
    "support",
    "sales",
    "supplier",
    "distributor",
    "company-contacts",
    "product-security-vulnerability",
    "video-library",
]


NOISE_TAGS = {"script", "style", "noscript", "nav", "footer", "header", "aside", "form"}
SKIP_EXTENSIONS = (
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".svg",
    ".zip",
    ".rar",
    ".7z",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
)


@dataclass
class CrawlConfig:
    seed_urls: list[str]
    allowed_domains: list[str]
    include_path_keywords: list[str] = field(default_factory=list)
    exclude_path_keywords: list[str] = field(default_factory=list)
    follow_links: bool = True
    kb_type: str = "principle"
    source_type: str = "official_doc"
    lang: str = "zh-CN"
    max_pages: int = 200
    timeout_seconds: int = 15
    sleep_seconds: float = 0.5
    min_content_chars: int = 180
    user_agent: str = "lceda-rag-crawler/0.1"
    respect_robots_txt: bool = True


def emit_log(enabled: bool, message: str) -> None:
    if enabled:
        print(message)


def print_crawl_report(
    enabled: bool,
    successes: list[str],
    failures: list[tuple[str, str]],
) -> None:
    if not enabled:
        return
    print(f"[summary] success={len(successes)} failure={len(failures)}")
    if successes:
        print("[summary] success_urls:")
        for url in successes:
            print(f"[success] {url}")
    if failures:
        print("[summary] failure_urls:")
        for url, reason in failures:
            print(f"[failure] {url} reason={reason}")


def enqueue_if_new(url: str, queue: Any, queued_set: set[str]) -> bool:
    if url in queued_set:
        return False
    queue.append(url)
    queued_set.add(url)
    return True


def canonicalize_url(url: str) -> str:
    parsed = urlparse(url)
    normalized_path = re.sub(r"/{2,}", "/", parsed.path or "/")
    if normalized_path != "/" and normalized_path.endswith("/"):
        normalized_path = normalized_path[:-1]
    return urlunparse((parsed.scheme, parsed.netloc.lower(), normalized_path, "", "", ""))


def _domain_allowed(url: str, allowed_domains: list[str]) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return any(host == d or host.endswith("." + d) for d in allowed_domains)


def should_visit_url(url: str, cfg: CrawlConfig) -> bool:
    normalized = canonicalize_url(url)
    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"}:
        return False
    if not _domain_allowed(normalized, cfg.allowed_domains):
        return False
    if normalized.lower().endswith(SKIP_EXTENSIONS):
        return False

    path = parsed.path.lower()
    if cfg.include_path_keywords:
        include = any(k.lower() in path for k in cfg.include_path_keywords)
        if not include:
            return False
    if any(k.lower() in path for k in cfg.exclude_path_keywords):
        return False
    return True


def extract_links(html: str, base_url: str, allowed_domains: set[str]) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    links: list[str] = []
    seen = set()
    for a in soup.find_all("a", href=True):
        absolute = canonicalize_url(urljoin(base_url, a["href"]))
        host = (urlparse(absolute).hostname or "").lower()
        if not any(host == d or host.endswith("." + d) for d in allowed_domains):
            continue
        if absolute.lower().endswith(SKIP_EXTENSIONS):
            continue
        if absolute not in seen:
            seen.add(absolute)
            links.append(absolute)
    return links


def extract_clean_text(html: str) -> tuple[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    for tag in NOISE_TAGS:
        for node in soup.find_all(tag):
            node.decompose()

    title = ""
    if soup.title and soup.title.string:
        title = re.sub(r"\s+", " ", soup.title.string).strip()

    body = soup.body or soup
    lines = []
    for node in body.stripped_strings:
        text = re.sub(r"\s+", " ", node).strip()
        if text:
            lines.append(text)
    content = "\n".join(lines)
    content = re.sub(r"\n{3,}", "\n\n", content).strip()
    content = trim_known_noise_sections(content)
    return title, content


def trim_known_noise_sections(content: str) -> str:
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    if not lines:
        return ""

    trimmed = [line for line in lines if line not in {"Show side navigation"}]

    tool_tail_markers = [
        "Resources and Products",
        "SSPMG User Guide",
        "User Guide",
        "EliteSiC Family",
    ]
    for marker in tool_tail_markers:
        if marker in trimmed:
            idx = trimmed.index(marker)
            if idx >= 4:
                trimmed = trimmed[:idx]
                break

    # Drop repeated marketplace/cart fragments from the tail.
    while trimmed and trimmed[-1] in {
        "Cart",
        "Checkout",
        "Continue Shopping",
        "Loading...",
        "New message",
        "Item Name",
    }:
        trimmed.pop()

    tail_markers = [
        "Browse videos",
        "Products",
        "Applications",
        "You May Be Interested In",
        "Support and Community",
        "Product Recommendation Tools+",
        "Technical Documentation & Models",
        "Interactive Block",
        "Item Name",
    ]
    for marker in tail_markers:
        if marker in trimmed:
            idx = trimmed.index(marker)
            if idx > 0:
                trimmed = trimmed[:idx]
                break

    return "\n".join(trimmed).strip()


def _slugify(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text or "untitled"


def _build_source_ref(url: str, title: str) -> str:
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]
    parsed = urlparse(url)
    label = _slugify(title) if title else _slugify(parsed.path)
    return f"{parsed.netloc}-{label}-{digest}"


def build_vendor_topic_key(url: str, title: str) -> str:
    host = (urlparse(url).netloc or "unknown").lower()
    host = host[4:] if host.startswith("www.") else host
    path = (urlparse(url).path or "/").lower()
    topic = "general"
    for seg in path.split("/"):
        seg = seg.strip()
        if seg in {"product-category", "products", "overview", "design", "support", "solutions"}:
            continue
        if seg:
            topic = _slugify(seg)
            break
    if topic == "general" and title:
        topic = _slugify(title.split("|")[0])
    return f"{host}_{topic or 'general'}"


def is_low_value_page(url: str, title: str, content: str) -> bool:
    target = " ".join([url.lower(), title.lower(), content[:300].lower()])
    keywords = [
        "login",
        "logout",
        "sign in",
        "account",
        "cart",
        "checkout",
        "privacy",
        "cookie",
        "terms of use",
        "website feedback",
    ]
    if any(k in target for k in keywords):
        return True

    lower_url = url.lower()
    lower_title = title.lower()
    lower_content = content.lower()
    content_head = lower_content[:1500]

    navigation_signals = [
        "show side navigation",
        "filters",
        "quick reference",
        "export",
        "clear all",
        "view all products",
        "browse by category",
        "parametric-filter",
    ]
    if sum(1 for signal in navigation_signals if signal in content_head) >= 2:
        return True

    if "interactive block diagrams" in content_head and any(
        signal in content_head for signal in ("solution subgroup", "diagram subgroup", '"children"', '"path"')
    ):
        return True

    if any(keyword in lower_title for keyword in ("seminar", "研讨会", "セミナー", "세미나")) and any(
        signal in lower_content for signal in ("register", "registration", "check-in", "会场", "會場", "会議議程", "日時", "등록", "報名")
    ):
        return True

    if ("technical documentation" in lower_title or "/technical-documentation" in lower_url) and any(
        signal in content_head
        for signal in ("document type", "application notes", "datasheet", "eval board", "drawing:", "reference manuals")
    ):
        return True

    if ("power management" in lower_title or "/power-management/" in lower_url) and any(
        signal in content_head for signal in ("view all products", "browse by category", "products", "power trends")
    ):
        return True

    if any(keyword in lower_url for keyword in ("webinar", "resources")) or any(
        keyword in lower_title for keyword in ("resources", "library", "webinars")
    ) or any(
        keyword in content_head for keyword in ("webinar details", "on-demand", "top resources")
    ):
        if any(
            signal in content_head
            for signal in ("top resources", "white paper", "presentation", "video", "download", "view", "re-watch now", "webinar details", "on-demand")
        ):
            return True

    return False


def is_auth_redirect_url(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return "login." in host or "/authorization.oauth2" in url.lower()


def content_signature(title: str, content: str) -> str:
    normalized = re.sub(r"\s+", " ", (title + "\n" + content).strip().lower())
    return hashlib.sha1(normalized.encode("utf-8")).hexdigest()


def content_only_signature(content: str) -> str:
    normalized = re.sub(r"\s+", " ", content.strip().lower())
    return hashlib.sha1(normalized.encode("utf-8")).hexdigest()


def cleanup_output_dir(output_dir: Path, verbose: bool = True) -> dict[str, int]:
    files = sorted(output_dir.glob("*.jsonl"))
    removed_low_value_files = 0
    removed_duplicate_rows = 0
    removed_empty_files = 0

    for fp in files:
        if fp.name == "knowledge_import_tasks.jsonl":
            # Historical single-file artifact; keep untouched.
            continue
        if any(k in fp.name for k in LOW_VALUE_FILE_KEYWORDS):
            fp.unlink(missing_ok=True)
            removed_low_value_files += 1
            emit_log(verbose, f"[cleanup] remove_low_value_file {fp.name}")

    seen_signatures: set[str] = set()
    for fp in sorted(output_dir.glob("*.jsonl")):
        if fp.name == "knowledge_import_tasks.jsonl":
            continue
        kept: list[str] = []
        for line in fp.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            obj = json.loads(line)
            content = str(obj.get("content", ""))
            sig = content_only_signature(content)
            if sig in seen_signatures:
                removed_duplicate_rows += 1
                continue
            seen_signatures.add(sig)
            kept.append(json.dumps(obj, ensure_ascii=False))
        if kept:
            fp.write_text("\n".join(kept) + "\n", encoding="utf-8")
        else:
            fp.unlink(missing_ok=True)
            removed_empty_files += 1
            emit_log(verbose, f"[cleanup] remove_empty_file {fp.name}")

    summary = {
        "removed_low_value_files": removed_low_value_files,
        "removed_duplicate_rows": removed_duplicate_rows,
        "removed_empty_files": removed_empty_files,
    }
    emit_log(verbose, f"[cleanup] summary={summary}")
    return summary


def generate_crawl_report(
    output_dir: Path,
    crawled_rows: int,
    cleanup_summary: dict[str, int],
    report_path: Path,
    verbose: bool = True,
) -> dict[str, Any]:
    files = sorted([p for p in output_dir.glob("*.jsonl") if p.name != "knowledge_import_tasks.jsonl"])
    rows_after_cleanup = 0
    pdf_source_count = 0
    topic_counter: dict[str, int] = {}
    vendor_counter: dict[str, int] = {}

    for fp in files:
        stem = fp.stem
        vendor, topic = (stem.split("_", 1) + ["general"])[:2] if "_" in stem else ("unknown", "general")
        for line in fp.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            rows_after_cleanup += 1
            obj = json.loads(line)
            src_url = str(obj.get("_source_url", "")).lower()
            if src_url.endswith(".pdf") or "/lit/" in src_url:
                pdf_source_count += 1
            topic_counter[topic] = topic_counter.get(topic, 0) + 1
            vendor_counter[vendor] = vendor_counter.get(vendor, 0) + 1

    pdf_rate = round((pdf_source_count / rows_after_cleanup) * 100, 2) if rows_after_cleanup else 0.0
    report = {
        "crawled_rows_before_cleanup": crawled_rows,
        "rows_after_cleanup": rows_after_cleanup,
        "pdf_source_count": pdf_source_count,
        "pdf_source_rate": pdf_rate,
        "topic_distribution_top10": sorted(topic_counter.items(), key=lambda x: x[1], reverse=True)[:10],
        "vendor_distribution": sorted(vendor_counter.items(), key=lambda x: x[1], reverse=True),
        "cleanup_summary": cleanup_summary,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    emit_log(verbose, f"[report] path={report_path}")
    emit_log(verbose, f"[report] pdf_source_rate={pdf_rate}% rows={rows_after_cleanup}")
    return report


def build_import_task_record(
    kb_type: str,
    title: str,
    source_type: str,
    source_ref: str,
    lang: str,
    content: str,
    source_url: str | None = None,
) -> dict[str, Any]:
    row = {
        "kb_type": kb_type,
        "title": title,
        "source_type": source_type,
        "source_ref": source_ref,
        "lang": lang,
        "content": content,
        "idempotency_key": source_ref,
    }
    if source_url:
        row["_source_url"] = source_url
    return row


def write_jsonl(rows: list[dict[str, Any]], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def init_jsonl_output(output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("", encoding="utf-8")


def append_jsonl_row(output_path: Path, row: dict[str, Any]) -> None:
    with output_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def _load_config(path: Path) -> CrawlConfig:
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".json":
        raw = json.loads(text)
    else:
        try:
            import yaml  # type: ignore
        except Exception as exc:
            raise RuntimeError("PyYAML is required for YAML config files") from exc
        raw = yaml.safe_load(text)

    if not isinstance(raw, dict):
        raise ValueError("Config root must be an object")
    return CrawlConfig(**raw)


def resolve_path_input(raw_path: str) -> Path:
    """Resolve user-provided path robustly across repo-root/server/scripts-server cwd."""
    candidate = Path(raw_path)
    if candidate.exists():
        return candidate

    script_dir = Path(__file__).resolve().parent
    if raw_path.startswith("scripts/server/"):
        trimmed = raw_path[len("scripts/server/") :]
        alt = script_dir / trimmed
        if alt.exists():
            return alt
    alt = script_dir / raw_path
    if alt.exists():
        return alt
    return candidate


def _fetch(url: str, timeout_seconds: int, user_agent: str) -> str:
    resp = requests.get(
        url,
        timeout=timeout_seconds,
        headers={"User-Agent": user_agent},
        allow_redirects=True,
    )
    resp.raise_for_status()
    ctype = (resp.headers.get("content-type") or "").lower()
    if "text/html" not in ctype:
        raise ValueError(f"Unsupported content-type: {ctype}")
    return resp.text


def extract_pdf_text(pdf_bytes: bytes) -> str:
    try:
        from pypdf import PdfReader  # type: ignore
    except Exception:
        return ""
    try:
        import io

        reader = PdfReader(io.BytesIO(pdf_bytes))
        parts: list[str] = []
        for page in reader.pages:
            parts.append(page.extract_text() or "")
        text = "\n".join(parts).strip()
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text
    except Exception:
        return ""


def _fetch_content(url: str, timeout_seconds: int, user_agent: str) -> tuple[str, str]:
    resp = requests.get(
        url,
        timeout=timeout_seconds,
        headers={"User-Agent": user_agent},
        allow_redirects=True,
    )
    resp.raise_for_status()
    if is_auth_redirect_url(resp.url):
        raise ValueError(f"Auth redirect detected: {resp.url}")
    ctype = (resp.headers.get("content-type") or "").lower()
    if "text/html" in ctype:
        return "html", resp.text
    if "application/pdf" in ctype or url.lower().endswith(".pdf"):
        return "pdf", extract_pdf_text(resp.content)
    raise ValueError(f"Unsupported content-type: {ctype}")


def load_robots_parser(
    base_origin: str,
    user_agent: str,
    timeout_seconds: int,
    verbose: bool,
) -> RobotFileParser | None:
    robots_url = urljoin(base_origin, "/robots.txt")
    try:
        resp = requests.get(
            robots_url,
            timeout=timeout_seconds,
            headers={"User-Agent": user_agent},
            allow_redirects=True,
        )
        if resp.status_code >= 400:
            emit_log(verbose, f"[robots] skip status={resp.status_code} url={robots_url}")
            return None
        parser = RobotFileParser()
        parser.parse(resp.text.splitlines())
        emit_log(verbose, f"[robots] loaded url={robots_url}")
        return parser
    except Exception as exc:
        emit_log(verbose, f"[robots] skip error={exc} url={robots_url}")
        return None


def crawl(cfg: CrawlConfig, verbose: bool = True, output_path: Path | None = None) -> list[dict[str, Any]]:
    queue = deque()
    queued_set: set[str] = set()
    for u in cfg.seed_urls:
        enqueue_if_new(canonicalize_url(u), queue, queued_set)
    visited = set()
    rows: list[dict[str, Any]] = []
    success_urls: list[str] = []
    failure_rows: list[tuple[str, str]] = []
    seen_content_signatures: set[str] = set()
    emit_log(verbose, f"[init] seeds={len(cfg.seed_urls)} max_pages={cfg.max_pages}")
    for u in cfg.seed_urls:
        emit_log(verbose, f"[seed] {canonicalize_url(u)}")

    robots: dict[str, RobotFileParser] = {}

    def allowed_by_robots(url: str) -> bool:
        if not cfg.respect_robots_txt:
            return True
        parsed = urlparse(url)
        key = f"{parsed.scheme}://{parsed.netloc}"
        if key not in robots:
            rp = load_robots_parser(
                base_origin=key,
                user_agent=cfg.user_agent,
                timeout_seconds=cfg.timeout_seconds,
                verbose=verbose,
            )
            if rp is None:
                return True
            robots[key] = rp
        return robots[key].can_fetch(cfg.user_agent, url)

    while queue and len(rows) < cfg.max_pages:
        url = queue.popleft()
        queued_set.discard(url)
        emit_log(verbose, f"[dequeue] {url} queue={len(queue)} visited={len(visited)}")
        if url in visited:
            emit_log(verbose, f"[skip] reason=visited url={url}")
            continue
        visited.add(url)

        if not should_visit_url(url, cfg):
            emit_log(verbose, f"[skip] reason=filter url={url}")
            failure_rows.append((url, "filter"))
            continue
        if not allowed_by_robots(url):
            emit_log(verbose, f"[skip] reason=robots url={url}")
            failure_rows.append((url, "robots"))
            continue

        try:
            emit_log(verbose, f"[fetch] url={url}")
            content_type, payload = _fetch_content(url, cfg.timeout_seconds, cfg.user_agent)
            if content_type == "html":
                title, content = extract_clean_text(payload)
            else:
                title = urlparse(url).path.split("/")[-1] or "pdf-document"
                content = payload
                if not content:
                    failure_rows.append((url, "pdf_extract_empty"))
                    emit_log(verbose, f"[skip] reason=pdf_extract_empty url={url}")
                    continue
            if len(content) < cfg.min_content_chars:
                emit_log(
                    verbose,
                    f"[skip] reason=content_too_short url={url} chars={len(content)} min={cfg.min_content_chars}",
                )
                failure_rows.append((url, "content_too_short"))
                continue

            source_ref = _build_source_ref(url, title)
            title_final = title or urlparse(url).path.strip("/") or "untitled"
            if is_low_value_page(url, title_final, content):
                emit_log(verbose, f"[skip] reason=low_value_page url={url}")
                failure_rows.append((url, "low_value_page"))
                continue

            sig = content_signature(title_final, content)
            if sig in seen_content_signatures:
                emit_log(verbose, f"[skip] reason=duplicate_content url={url}")
                failure_rows.append((url, "duplicate_content"))
                continue
            seen_content_signatures.add(sig)

            emit_log(
                verbose,
                f"[ok] url={url} title={title_final} chars={len(content)} source_ref={source_ref}",
            )
            success_urls.append(url)
            rows.append(
                build_import_task_record(
                    kb_type=cfg.kb_type,
                    title=title_final,
                    source_type=cfg.source_type,
                    source_ref=source_ref,
                    lang=cfg.lang,
                    content=content,
                    source_url=url,
                )
            )
            if output_path is not None:
                key = build_vendor_topic_key(url, title_final)
                output_file = output_path.parent / f"{key}.jsonl"
                append_jsonl_row(output_file, rows[-1])
                emit_log(verbose, f"[write-row] total={len(rows)} path={output_file}")

            if content_type == "html" and cfg.follow_links:
                discovered = extract_links(payload, url, set(cfg.allowed_domains))
                emit_log(verbose, f"[links] url={url} discovered={len(discovered)}")
                for link in discovered:
                    if link not in visited and enqueue_if_new(link, queue, queued_set):
                        emit_log(verbose, f"[enqueue] {link} queue={len(queue)}")

            time.sleep(cfg.sleep_seconds)
        except Exception as exc:
            emit_log(verbose, f"[error] url={url} error={exc}")
            failure_rows.append((url, f"error:{exc}"))
            continue

    emit_log(verbose, f"[done] crawled={len(rows)} visited={len(visited)}")
    print_crawl_report(verbose, success_urls, failure_rows)
    return rows


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Crawl official knowledge pages and export import-task JSONL.")
    parser.add_argument("--config", required=True, help="Path to YAML/JSON config")
    parser.add_argument("--output", required=True, help="Output JSONL path")
    parser.add_argument("--quiet", action="store_true", help="Disable verbose crawl logs")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    cfg = _load_config(resolve_path_input(args.config))
    output_path = resolve_path_input(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    emit_log(not args.quiet, f"[write-init] dir={output_path.parent}")
    rows = crawl(cfg, verbose=not args.quiet, output_path=output_path)
    cleanup_summary = cleanup_output_dir(output_path.parent, verbose=not args.quiet)
    generate_crawl_report(
        output_dir=output_path.parent,
        crawled_rows=len(rows),
        cleanup_summary=cleanup_summary,
        report_path=output_path.parent / "crawl_report.json",
        verbose=not args.quiet,
    )
    emit_log(not args.quiet, f"[write] rows={len(rows)} dir={output_path.parent}")
    print(f"crawled={len(rows)} output_dir={output_path.parent}")


if __name__ == "__main__":
    main()
