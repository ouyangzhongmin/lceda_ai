import json
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import Mock, patch

from scripts.server.rag_knowledge_crawler import (
    CrawlConfig,
    append_jsonl_row,
    build_import_task_record,
    canonicalize_url,
    cleanup_output_dir,
    build_vendor_topic_key,
    content_signature,
    generate_crawl_report,
    extract_pdf_text,
    emit_log,
    is_low_value_page,
    extract_clean_text,
    extract_links,
    init_jsonl_output,
    enqueue_if_new,
    load_robots_parser,
    print_crawl_report,
    resolve_path_input,
    should_visit_url,
    trim_known_noise_sections,
    write_jsonl,
    crawl,
)


class CanonicalizeUrlTests(unittest.TestCase):
    def test_strips_fragment_and_query(self):
        self.assertEqual(
            canonicalize_url("https://example.com/a/b?x=1#top"),
            "https://example.com/a/b",
        )


class HtmlExtractionTests(unittest.TestCase):
    def test_extract_clean_text_skips_noise_tags(self):
        html = """
        <html>
          <head><title>LDO Guide</title><script>alert(1)</script></head>
          <body>
            <nav>menu</nav>
            <main>
              <h1>LDO Guide</h1>
              <p>Input capacitor should be close to VIN.</p>
              <p>Output capacitor should meet ESR requirement.</p>
            </main>
            <footer>copyright</footer>
          </body>
        </html>
        """
        title, content = extract_clean_text(html)
        self.assertEqual(title, "LDO Guide")
        self.assertIn("Input capacitor should be close to VIN.", content)
        self.assertIn("Output capacitor should meet ESR requirement.", content)
        self.assertNotIn("menu", content)
        self.assertNotIn("copyright", content)

    def test_trim_known_noise_sections_removes_vendor_tail_noise(self):
        content = "\n".join(
            [
                "Show side navigation",
                "Design of a High-Frequency Series Capacitor Buck Converter",
                "This training will cover some of the challenges to high frequency operation today.",
                "What will I learn?",
                "Introduction to the series capacitor buck converter",
                "Browse videos",
                "View all videos",
                "Products",
                "Power management",
                "Cart",
            ]
        )
        trimmed = trim_known_noise_sections(content)
        self.assertIn("This training will cover some of the challenges", trimmed)
        self.assertIn("Introduction to the series capacitor buck converter", trimmed)
        self.assertNotIn("Show side navigation", trimmed)
        self.assertNotIn("Browse videos", trimmed)
        self.assertNotIn("Products", trimmed)
        self.assertNotIn("Cart", trimmed)

    def test_trim_known_noise_sections_removes_onsemi_recommendation_tail(self):
        content = "\n".join(
            [
                "Current Sense Design Tool",
                "Show side navigation",
                "The tool streamlines the normally iterative process of designing a shunt-based current sense solution.",
                "You May Be Interested In",
                "Product Recommendation Tools+",
                "Find Products",
                "Item Name",
                "Checkout",
            ]
        )
        trimmed = trim_known_noise_sections(content)
        self.assertIn("Current Sense Design Tool", trimmed)
        self.assertIn("shunt-based current sense solution", trimmed)
        self.assertNotIn("Show side navigation", trimmed)
        self.assertNotIn("You May Be Interested In", trimmed)
        self.assertNotIn("Checkout", trimmed)

    def test_trim_known_noise_sections_removes_ti_series_tail(self):
        content = "\n".join(
            [
                "VIDEO SERIES",
                "Designing a high-power bidirectional AC/DC power supply using SiC FETs",
                "Learn how to design a high-power bidirectional AC/DC power supply using silicon carbide MOSFETs.",
                "View series",
                "Applications",
                "Automotive",
                "Industrial",
            ]
        )
        trimmed = trim_known_noise_sections(content)
        self.assertIn("Designing a high-power bidirectional AC/DC power supply using SiC FETs", trimmed)
        self.assertIn("View series", trimmed)
        self.assertNotIn("Applications", trimmed)
        self.assertNotIn("Automotive", trimmed)

    def test_trim_known_noise_sections_trims_onsemi_tool_resource_tail(self):
        content = "\n".join(
            [
                "Elite Power Simulator",
                "Novel Power Device Simulation Reduces Development Time",
                "Elite Power Simulator enables power electronic engineers to accelerate time to market.",
                "Introduction",
                "The tool provides valuable insights into how their circuit will work using EliteSiC family products.",
                "Resources and Products",
                "User Guide",
                "Read More",
                "Application Note",
                "Read More",
                "EliteSiC Family",
            ]
        )
        trimmed = trim_known_noise_sections(content)
        self.assertIn("Elite Power Simulator", trimmed)
        self.assertIn("accelerate time to market", trimmed)
        self.assertIn("valuable insights into how their circuit will work", trimmed)
        self.assertNotIn("Resources and Products", trimmed)
        self.assertNotIn("User Guide", trimmed)
        self.assertNotIn("EliteSiC Family", trimmed)


class LinkFilterTests(unittest.TestCase):
    def test_extract_links_with_domain_and_extension_filters(self):
        html = """
        <html><body>
          <a href="/docs/a">A</a>
          <a href="https://example.com/docs/b.pdf">B</a>
          <a href="https://other.com/docs/c">C</a>
        </body></html>
        """
        links = extract_links(html, "https://example.com/start", {"example.com"})
        self.assertIn("https://example.com/docs/a", links)
        self.assertIn("https://example.com/docs/b.pdf", links)
        self.assertNotIn("https://other.com/docs/c", links)

    def test_should_visit_url_by_path_rules(self):
        cfg = CrawlConfig(
            seed_urls=["https://example.com/docs"],
            allowed_domains=["example.com"],
            include_path_keywords=["/docs/"],
            exclude_path_keywords=["/login"],
        )
        self.assertTrue(should_visit_url("https://example.com/docs/ldo", cfg))
        self.assertFalse(should_visit_url("https://example.com/login", cfg))


class OutputTests(unittest.TestCase):
    def test_build_import_task_record(self):
        rec = build_import_task_record(
            kb_type="principle",
            title="LDO Guide",
            source_type="official_doc",
            source_ref="example-ldo-v1",
            lang="zh-CN",
            content="abc",
        )
        self.assertEqual(rec["kb_type"], "principle")
        self.assertEqual(rec["idempotency_key"], "example-ldo-v1")

    def test_write_jsonl(self):
        rows = [{"a": 1}, {"a": 2}]
        with tempfile.TemporaryDirectory() as d:
            output = Path(d) / "out.jsonl"
            write_jsonl(rows, output)
            lines = output.read_text(encoding="utf-8").strip().splitlines()
            self.assertEqual(len(lines), 2)
            self.assertEqual(json.loads(lines[0])["a"], 1)

    def test_init_and_append_jsonl(self):
        with tempfile.TemporaryDirectory() as d:
            output = Path(d) / "stream.jsonl"
            init_jsonl_output(output)
            self.assertTrue(output.exists())
            append_jsonl_row(output, {"x": 1})
            append_jsonl_row(output, {"x": 2})
            lines = output.read_text(encoding="utf-8").strip().splitlines()
            self.assertEqual(len(lines), 2)
            self.assertEqual(json.loads(lines[1])["x"], 2)

class ClassificationTests(unittest.TestCase):
    def test_build_vendor_topic_key(self):
        key = build_vendor_topic_key(
            url="https://www.ti.com/product-category/power-management/overview.html",
            title="Power management | TI.com",
        )
        self.assertEqual(key, "ti.com_power-management")

    def test_low_value_page_detect(self):
        self.assertTrue(
            is_low_value_page(
                url="https://www.onsemi.com/myon/my-account",
                title="My Account",
                content="x",
            )
        )
        self.assertFalse(
            is_low_value_page(
                url="https://www.ti.com/product-category/power-management/overview.html",
                title="Power management | TI.com",
                content="design and application notes",
            )
        )

    def test_low_value_page_detects_navigation_and_filter_hubs(self):
        self.assertTrue(
            is_low_value_page(
                url="https://www.onsemi.com/design/technical-documentation",
                title="Technical Documentation | onsemi",
                content="Show side navigation Filters Quick Reference Export Clear all Document Type Application Notes Datasheet Eval Board Manual",
            )
        )
        self.assertTrue(
            is_low_value_page(
                url="https://www.onsemi.com/design/interactive-block-diagrams/automotive",
                title="Automotive | onsemi",
                content="Interactive Block Diagrams Find the perfect block diagram Solution subgroup Block Diagrams Diagram subgroup children path",
            )
        )
        self.assertTrue(
            is_low_value_page(
                url="https://www.ti.com/power-management/overview.html",
                title="Power management | TI.com",
                content="View all products Browse by category parametric-filter Power trends Products",
            )
        )

    def test_low_value_page_detects_event_registration_pages(self):
        self.assertTrue(
            is_low_value_page(
                url="https://www.ti.com/ja-jp/power-supply-design-seminar.html",
                title="パワー サプライ デザイン セミナー | TI.com",
                content="日時 東京会場 名古屋会場 登録 チェックイン 会場",
            )
        )
        self.assertTrue(
            is_low_value_page(
                url="https://www.ti.com/ko-kr/power-supply-design-seminar.html",
                title="전원 공급 장치 설계 세미나 | TI.com",
                content="등록 장소 날짜 시간 현장 교육",
            )
        )

    def test_low_value_page_keeps_real_training_content(self):
        self.assertFalse(
            is_low_value_page(
                url="https://training.ti.com/design-high-frequency-series-capacitor-buck-converter",
                title="Design of a High-Frequency Series Capacitor Buck Converter | Video | TI.com",
                content="This training will cover some of the challenges to high frequency operation today, introduce the series capacitor buck converter topology, present some experimental results and go through the design steps.",
            )
        )

    def test_low_value_page_keeps_onsemi_simulation_tool_pages(self):
        self.assertFalse(
            is_low_value_page(
                url="https://www.onsemi.com/design/elite-power-simulator",
                title="Elite Power Simulator | onsemi",
                content="Elite Power Simulator enables power electronic engineers to accelerate time to market. The tool provides valuable insights into how their circuit will work using EliteSiC family products.",
            )
        )
        self.assertFalse(
            is_low_value_page(
                url="https://www.onsemi.com/design/self-service-plecs-model-generator",
                title="Self-Service PLECS Model Generator | onsemi",
                content="Self-Service PLECS Model Generator lets engineers create custom, high-fidelity models for seamless integration and simulation. The latest enhancement adds gate drivers directly into the tool for more accurate switching prediction.",
            )
        )

    def test_low_value_page_detects_webinar_and_resource_listing_pages(self):
        self.assertTrue(
            is_low_value_page(
                url="https://www.onsemi.com/design/power-webinars",
                title="onsemi",
                content="Power Webinars Webinar Details On-Demand Re-Watch Now English October 18 2022 Silicon Carbide topics",
            )
        )
        self.assertTrue(
            is_low_value_page(
                url="https://www.ti.com/design-resources/seminars/power-supply-design-seminar-psds/psds-resources.html",
                title="PSDS resources | TI.com",
                content="PSDS library Browse through three decades of training content Top resources Title Year White paper Presentation Video Download View",
            )
        )

    def test_content_signature(self):
        s1 = content_signature("A", "Hello world")
        s2 = content_signature("A", "Hello world")
        s3 = content_signature("B", "Hello world")
        self.assertEqual(s1, s2)
        self.assertNotEqual(s1, s3)


class PathResolveTests(unittest.TestCase):
    def test_resolve_existing_path(self):
        p = resolve_path_input("scripts/server/rag_knowledge_crawler.py")
        self.assertTrue(str(p).endswith("scripts/server/rag_knowledge_crawler.py"))

    def test_resolve_scripts_server_prefixed_relative(self):
        p = resolve_path_input("scripts/server/configs/official_principle_sources.example.yaml")
        self.assertTrue(p.exists())

class LoggingTests(unittest.TestCase):
    def test_emit_log_enabled(self):
        out = io.StringIO()
        with redirect_stdout(out):
            emit_log(True, "hello")
        self.assertIn("hello", out.getvalue())

    def test_emit_log_disabled(self):
        out = io.StringIO()
        with redirect_stdout(out):
            emit_log(False, "hello")
        self.assertEqual(out.getvalue(), "")

class RobotsTests(unittest.TestCase):
    @patch("scripts.server.rag_knowledge_crawler.requests.get")
    def test_load_robots_parser_uses_timeout(self, mock_get: Mock):
        mock_resp = Mock()
        mock_resp.status_code = 200
        mock_resp.text = "User-agent: *\nAllow: /\n"
        mock_resp.raise_for_status = Mock()
        mock_get.return_value = mock_resp

        parser = load_robots_parser(
            base_origin="https://example.com",
            user_agent="ua-test",
            timeout_seconds=7,
            verbose=False,
        )
        self.assertIsNotNone(parser)
        mock_get.assert_called_once()
        _, kwargs = mock_get.call_args
        self.assertEqual(kwargs["timeout"], 7)

class QueueTests(unittest.TestCase):
    def test_enqueue_if_new_deduplicates(self):
        queued = set()
        q = []
        self.assertTrue(enqueue_if_new("https://a.com/x", q, queued))
        self.assertFalse(enqueue_if_new("https://a.com/x", q, queued))
        self.assertEqual(q, ["https://a.com/x"])

class ReportTests(unittest.TestCase):
    def test_print_crawl_report(self):
        out = io.StringIO()
        with redirect_stdout(out):
            print_crawl_report(
                enabled=True,
                successes=["https://a.com/ok"],
                failures=[("https://a.com/fail", "timeout")],
            )
        text = out.getvalue()
        self.assertIn("[summary] success=1 failure=1", text)
        self.assertIn("[success] https://a.com/ok", text)
        self.assertIn("[failure] https://a.com/fail reason=timeout", text)

class CleanupTests(unittest.TestCase):
    def test_cleanup_output_dir_removes_low_value_and_dedup(self):
        with tempfile.TemporaryDirectory() as d:
            out_dir = Path(d)
            keep_file = out_dir / "ti.com_power-management.jsonl"
            low_file = out_dir / "onsemi.com_support.jsonl"

            keep_rows = [
                {
                    "kb_type": "principle",
                    "title": "Power management | TI.com",
                    "source_type": "official_doc",
                    "source_ref": "a",
                    "lang": "zh-CN",
                    "content": "same content",
                    "idempotency_key": "a",
                },
                {
                    "kb_type": "principle",
                    "title": "Power management copy | TI.com",
                    "source_type": "official_doc",
                    "source_ref": "b",
                    "lang": "zh-CN",
                    "content": "same content",
                    "idempotency_key": "b",
                },
            ]
            low_rows = [
                {
                    "kb_type": "principle",
                    "title": "Support | onsemi",
                    "source_type": "official_doc",
                    "source_ref": "c",
                    "lang": "zh-CN",
                    "content": "support content",
                    "idempotency_key": "c",
                }
            ]

            keep_file.write_text(
                "\n".join(json.dumps(r, ensure_ascii=False) for r in keep_rows) + "\n",
                encoding="utf-8",
            )
            low_file.write_text(
                "\n".join(json.dumps(r, ensure_ascii=False) for r in low_rows) + "\n",
                encoding="utf-8",
            )

            summary = cleanup_output_dir(out_dir, verbose=False)
            self.assertEqual(summary["removed_low_value_files"], 1)
            self.assertEqual(summary["removed_duplicate_rows"], 1)
            self.assertTrue(keep_file.exists())
            self.assertFalse(low_file.exists())
            lines = keep_file.read_text(encoding="utf-8").strip().splitlines()
            self.assertEqual(len(lines), 1)

class ReportGenTests(unittest.TestCase):
    def test_generate_crawl_report(self):
        with tempfile.TemporaryDirectory() as d:
            out_dir = Path(d)
            fp = out_dir / "ti.com_power-management.jsonl"
            rows = [
                {
                    "kb_type": "principle",
                    "title": "A",
                    "source_type": "official_doc",
                    "source_ref": "r1",
                    "lang": "zh-CN",
                    "content": "c1",
                    "idempotency_key": "r1",
                    "_source_url": "https://www.ti.com/lit/an/a.pdf",
                },
                {
                    "kb_type": "principle",
                    "title": "B",
                    "source_type": "official_doc",
                    "source_ref": "r2",
                    "lang": "zh-CN",
                    "content": "c2",
                    "idempotency_key": "r2",
                    "_source_url": "https://www.ti.com/design/x.html",
                },
            ]
            fp.write_text(
                "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n",
                encoding="utf-8",
            )
            report_path = out_dir / "crawl_report.json"
            report = generate_crawl_report(
                output_dir=out_dir,
                crawled_rows=2,
                cleanup_summary={"removed_low_value_files": 1, "removed_duplicate_rows": 2, "removed_empty_files": 0},
                report_path=report_path,
                verbose=False,
            )
            self.assertEqual(report["rows_after_cleanup"], 2)
            self.assertEqual(report["pdf_source_count"], 1)
            self.assertEqual(report["pdf_source_rate"], 50.0)
            self.assertTrue(report_path.exists())

class PdfTests(unittest.TestCase):
    def test_extract_pdf_text_invalid_bytes(self):
        text = extract_pdf_text(b"not a real pdf")
        self.assertIsInstance(text, str)


class CrawlTests(unittest.TestCase):
    @patch("scripts.server.rag_knowledge_crawler.time.sleep")
    @patch("scripts.server.rag_knowledge_crawler.load_robots_parser")
    @patch("scripts.server.rag_knowledge_crawler._fetch_content")
    def test_crawl_does_not_follow_links_when_disabled(self, mock_fetch: Mock, mock_robots: Mock, _mock_sleep: Mock):
        mock_robots.return_value = None
        html = """
        <html>
          <head><title>Seed</title></head>
          <body>
            <main>
              <h1>Seed Page</h1>
              <p>This is a focused engineering article with enough content to keep.</p>
              <p>It should not enqueue linked pages when follow_links is disabled.</p>
              <a href="https://example.com/docs/child">child</a>
            </main>
          </body>
        </html>
        """
        mock_fetch.return_value = ("html", html)
        cfg = CrawlConfig(
            seed_urls=["https://example.com/docs/seed"],
            allowed_domains=["example.com"],
            include_path_keywords=["/docs/"],
            follow_links=False,
            min_content_chars=20,
        )

        rows = crawl(cfg, verbose=False)

        self.assertEqual(len(rows), 1)
        mock_fetch.assert_called_once()


if __name__ == "__main__":
    unittest.main()
