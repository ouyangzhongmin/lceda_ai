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
    write_jsonl,
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


if __name__ == "__main__":
    unittest.main()
