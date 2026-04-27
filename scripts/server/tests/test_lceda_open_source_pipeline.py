import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from scripts.server.lceda_open_source_crawler import (
    build_attachment_download_count_url,
    canonicalize_project_url,
    crawl_project_records,
    download_project_file,
    extract_project_payload_from_next_flight,
    extract_project_links,
    extract_project_record,
)
from scripts.server.extract_lceda_templates import (
    _apply_static_scoring,
    _sanitize_anchor_device_model,
    _read_schematic_file_text,
    detect_device_family,
    deduplicate_templates,
    extract_templates_from_project,
    parse_schematic_text_tokens,
)
from scripts.server.evaluate_lceda_template_extraction import summarize_template_extraction
from scripts.server.evaluate_lceda_template_extraction import evaluate_project_file
from scripts.server.transform_lceda_templates_for_ragflow import to_ragflow_template_record


class LcedaCrawlerTests(unittest.TestCase):
    def test_canonicalize_project_url_strips_query_fragment_and_trailing_slash(self):
        self.assertEqual(
            canonicalize_project_url("https://oshwhub.com/example/esp32-s3-dev?tab=docs#files/"),
            "https://oshwhub.com/example/esp32-s3-dev",
        )

    def test_extract_project_links_deduplicates_lceda_project_urls(self):
        html = """
        <a href="/project/abc/esp32-s3-devboard">A</a>
        <a href="https://oshwhub.com/project/abc/esp32-s3-devboard?tab=1">A duplicate</a>
        <a href="https://example.com/project/not-lceda">External</a>
        <a href="/user/demo/projects/stm32-bluepill">B</a>
        """
        links = extract_project_links(html, "https://oshwhub.com/explore")
        self.assertEqual(
            links,
            [
                "https://oshwhub.com/project/abc/esp32-s3-devboard",
                "https://oshwhub.com/user/demo/projects/stm32-bluepill",
            ],
        )

    def test_extract_project_links_supports_author_slug_style_urls(self):
        html = """
        <a href="/li-chuang-kai-fa-ban/project_gzzvrwqn">A</a>
        <a href="/htx-studio/project_kpilekig">B</a>
        <a href="/search">Search</a>
        """
        self.assertEqual(
            extract_project_links(html, "https://oshwhub.com/explore"),
            [
                "https://oshwhub.com/li-chuang-kai-fa-ban/project_gzzvrwqn",
                "https://oshwhub.com/htx-studio/project_kpilekig",
            ],
        )

    def test_extract_project_links_supports_author_general_project_slugs(self):
        html = """
        <a href="/mojinyinhu/t12858-tong-yong-han-tai">A</a>
        <a href="/mojinyinhu/following">Not project</a>
        <a href="/explore">Explore</a>
        """
        self.assertEqual(
            extract_project_links(html, "https://oshwhub.com/mojinyinhu"),
            ["https://oshwhub.com/mojinyinhu/t12858-tong-yong-han-tai"],
        )

    def test_extract_project_links_reads_next_data_json(self):
        html = (
            '<script id="__NEXT_DATA__" type="application/json">'
            '{"props":{"pageProps":{"projects":[{"authorSlug":"maker-a","projectSlug":"project_abcd1234"},'
            '{"authorSlug":"maker-b","projectSlug":"project_xyz987"}]}}}'
            "</script>"
        )
        self.assertEqual(
            extract_project_links(html, "https://oshwhub.com/search?wd=ESP32"),
            [
                "https://oshwhub.com/maker-a/project_abcd1234",
                "https://oshwhub.com/maker-b/project_xyz987",
            ],
        )


    def test_extract_project_links_ignores_create_project_routes(self):
        html = """
        <a href="/project/choose">Create</a>
        <a href="/project/new">New</a>
        """
        self.assertEqual(extract_project_links(html, "https://oshwhub.com/BOOW/esp32-s3"), [])

    def test_crawl_treats_detail_page_as_project_even_without_project_links(self):
        from unittest.mock import Mock, patch

        detail_html = """
        <html><body>
          <h1>ESP32-S3 开发板</h1>
          <div>工程详情</div>
          <div>打开设计图</div>
          <div>USB转UART: CH340K</div>
        </body></html>
        """
        response = Mock()
        response.text = detail_html
        response.raise_for_status = Mock()
        response.url = "https://oshwhub.com/BOOW/esp32-s3"

        session = Mock()
        session.get.return_value = response
        session.headers = {}

        with patch('scripts.server.lceda_open_source_crawler.requests.Session', return_value=session):
            records = crawl_project_records(["https://oshwhub.com/BOOW/esp32-s3"], category="validation_sample", keywords=["ESP32"])

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["project_url"], "https://oshwhub.com/BOOW/esp32-s3")
        self.assertEqual(records[0]["title"], "ESP32-S3 开发板")
        self.assertIn("CH340K", records[0]["raw_page_text"])

    def test_crawl_continues_when_one_entry_url_fails(self):
        from unittest.mock import Mock, patch
        from requests import HTTPError

        bad_response = Mock()
        bad_response.raise_for_status.side_effect = HTTPError("418 Client Error")

        good_list_response = Mock()
        good_list_response.text = """
        <a href="/project/abc/esp32-s3-devboard">A</a>
        """
        good_list_response.raise_for_status = Mock()

        good_project_response = Mock()
        good_project_response.text = """
        <html><body><h1>ESP32-S3 DevBoard</h1><p>工程详情 原理图 PCB</p></body></html>
        """
        good_project_response.raise_for_status = Mock()

        session = Mock()
        session.headers = {}
        session.get.side_effect = [bad_response, good_list_response, good_project_response]

        with patch("scripts.server.lceda_open_source_crawler.requests.Session", return_value=session):
            records = crawl_project_records(
                ["https://oshwhub.com/blocked-entry", "https://oshwhub.com/explore"],
                category="validation_sample",
                keywords=["ESP32"],
            )
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["project_url"], "https://oshwhub.com/project/abc/esp32-s3-devboard")

    def test_crawl_collects_failure_events_for_entry_fetch_errors(self):
        from unittest.mock import Mock, patch
        from requests import HTTPError

        bad_response = Mock()
        bad_response.raise_for_status.side_effect = HTTPError("418 Client Error")

        session = Mock()
        session.headers = {}
        session.get.side_effect = [bad_response]
        failures: list[dict[str, str]] = []

        with patch("scripts.server.lceda_open_source_crawler.requests.Session", return_value=session):
            records = crawl_project_records(
                ["https://oshwhub.com/blocked-entry"],
                category="validation_sample",
                keywords=["ESP32"],
                failure_events=failures,
            )
        self.assertEqual(records, [])
        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0]["type"], "entry_fetch_failed")
        self.assertEqual(failures[0]["url"], "https://oshwhub.com/blocked-entry")
        self.assertIn("418", failures[0]["reason"])

    def test_download_project_file_writes_stable_project_scoped_path(self):
        class FakeResponse:
            content = b'{"components":[{"name":"ESP32-S3"}]}'

            def raise_for_status(self):
                return None

        class FakeSession:
            def get(self, url, timeout):
                self.url = url
                self.timeout = timeout
                return FakeResponse()

        with tempfile.TemporaryDirectory() as d:
            path = download_project_file(
                FakeSession(),
                "https://oshwhub.com/files/esp32-s3.json?token=abc",
                output_dir=Path(d),
                project_id="oshwhub-project-esp32-s3",
                timeout_seconds=7,
            )
            self.assertTrue(path.exists())
            self.assertEqual(path.name, "esp32-s3.json")
            self.assertEqual(path.parent.name, "oshwhub-project-esp32-s3")
            self.assertIn("ESP32-S3", path.read_text(encoding="utf-8"))

    def test_crawl_downloads_schematic_file_when_output_dir_is_set(self):
        from unittest.mock import Mock, patch

        detail_html = """
        <html><body>
          <h1>ESP32-S3 DevKit</h1>
          <p>工程详情 原理图 PCB</p>
          <a href="/files/esp32-s3.json">工程源码</a>
        </body></html>
        """
        page_response = Mock()
        page_response.text = detail_html
        page_response.raise_for_status = Mock()
        file_response = Mock()
        file_response.content = b'{"nets":["3V3","GND"],"components":["ESP32-S3"]}'
        file_response.raise_for_status = Mock()

        session = Mock()
        session.headers = {}
        session.get.side_effect = [page_response, page_response, file_response]

        with tempfile.TemporaryDirectory() as d, patch(
            "scripts.server.lceda_open_source_crawler.requests.Session",
            return_value=session,
        ):
            records = crawl_project_records(
                ["https://oshwhub.com/project/abc/esp32-s3-devkit"],
                category="validation_sample",
                keywords=["ESP32"],
                file_output_dir=Path(d),
            )

            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]["source_mode"], "file_first")
            self.assertTrue(records[0]["schematic_file_path"].endswith("esp32-s3.json"))
            self.assertTrue(Path(records[0]["schematic_file_path"]).exists())


class LcedaTemplateExtractionTests(unittest.TestCase):
    def test_sanitize_anchor_device_model_rejects_dirty_suffix(self):
        self.assertEqual(_sanitize_anchor_device_model("ESP32-"), "")
        self.assertEqual(_sanitize_anchor_device_model("STM32仅支持3"), "")
        self.assertEqual(_sanitize_anchor_device_model("ESP32-S3"), "ESP32-S3")

    def test_deduplicate_templates_penalizes_token_fallback_zero_chain_templates(self):
        weak = {
            "template_id": "tpl-weak",
            "template_type": "mcu_boot_reset",
            "anchor_device_family": "ESP32",
            "anchor_device_model": "ESP32-S3",
            "components": [],
            "pin_bindings": [],
            "default_values": {"connection_chains": []},
            "quality_score": 0.99,
            "quality_detail": {
                "has_file_input": True,
                "has_sch_doctype": False,
                "component_signal_count": 10,
                "connection_chain_count": 0,
                "connection_chains": [],
                "lcsc_part_code_count": 1,
                "lcsc_part_codes": ["C123456"],
                "jlc_searchable_component_score": 0.15,
                "has_token_fallback_chain": True,
            },
        }
        strong = {
            "template_id": "tpl-strong",
            "template_type": "mcu_boot_reset",
            "anchor_device_family": "ESP32",
            "anchor_device_model": "ESP32-S3",
            "components": [],
            "pin_bindings": [],
            "default_values": {
                "connection_chains": [
                    {
                        "anchor_net": "EN",
                        "to_power_net": "3V3",
                        "passive_values": ["10K"],
                        "passive_refdes": ["R1"],
                        "evidence": "P1: EN -> R1 -> 3V3",
                    }
                ]
            },
            "quality_score": 0.92,
            "quality_detail": {
                "has_file_input": True,
                "has_sch_doctype": True,
                "component_signal_count": 10,
                "connection_chain_count": 1,
                "connection_chains": [
                    {
                        "anchor_net": "EN",
                        "to_power_net": "3V3",
                        "passive_values": ["10K"],
                        "passive_refdes": ["R1"],
                        "evidence": "P1: EN -> R1 -> 3V3",
                    }
                ],
                "lcsc_part_code_count": 1,
                "lcsc_part_codes": ["C123456"],
                "jlc_searchable_component_score": 0.15,
                "has_token_fallback_chain": False,
            },
        }

        rows = deduplicate_templates([weak, strong])
        scores = {row["template_id"]: row["retrieval_priority_score"] for row in rows}

        self.assertLess(scores["tpl-weak"], scores["tpl-strong"])
        self.assertLess(scores["tpl-weak"], 1.0)

    def test_deduplicate_templates_penalizes_stale_positive_chain_count_without_actual_chains(self):
        weak = {
            "template_id": "tpl-weak-stale-count",
            "template_type": "gpio_passive_power_chain",
            "anchor_device_family": "ESP32",
            "anchor_device_model": "ESP32-S3",
            "components": [],
            "pin_bindings": [],
            "default_values": {"connection_chains": []},
            "quality_score": 0.95,
            "quality_detail": {
                "has_file_input": True,
                "has_sch_doctype": True,
                "component_signal_count": 10,
                "connection_chain_count": 2,
                "connection_chains": [],
                "lcsc_part_code_count": 1,
                "lcsc_part_codes": ["C123456"],
                "jlc_searchable_component_score": 0.15,
                "has_token_fallback_chain": False,
            },
        }
        strong = {
            "template_id": "tpl-strong-real-chain",
            "template_type": "gpio_passive_power_chain",
            "anchor_device_family": "ESP32",
            "anchor_device_model": "ESP32-S3",
            "components": [],
            "pin_bindings": [],
            "default_values": {
                "connection_chains": [
                    {
                        "anchor_net": "GPIO0",
                        "to_power_net": "3V3",
                        "passive_values": ["10K"],
                        "passive_refdes": ["R1"],
                        "evidence": "P1: GPIO0 -> R1 -> 3V3",
                    }
                ]
            },
            "quality_score": 0.92,
            "quality_detail": {
                "has_file_input": True,
                "has_sch_doctype": True,
                "component_signal_count": 10,
                "connection_chain_count": 1,
                "connection_chains": [
                    {
                        "anchor_net": "GPIO0",
                        "to_power_net": "3V3",
                        "passive_values": ["10K"],
                        "passive_refdes": ["R1"],
                        "evidence": "P1: GPIO0 -> R1 -> 3V3",
                    }
                ],
                "lcsc_part_code_count": 1,
                "lcsc_part_codes": ["C123456"],
                "jlc_searchable_component_score": 0.15,
                "has_token_fallback_chain": False,
            },
        }

        rows = deduplicate_templates([weak, strong])
        scores = {row["template_id"]: row["retrieval_priority_score"] for row in rows}

        self.assertLess(scores["tpl-weak-stale-count"], scores["tpl-strong-real-chain"])
        self.assertLess(scores["tpl-weak-stale-count"], 1.0)

    def test_extract_templates_sanitizes_source_project_title_and_url(self):
        project = {
            "project_id": "local-files-195",
            "project_url": "https://oshwhub.com/local/94_简介：这是一个成本低，高颜值，带回流焊温度曲线的加热台来焊接pcb。\n主控采用S_ProPrj_红龙加热台 - 支持恒温、回流焊_2026-04-23",
            "title": "94_简介：这是一个ESP32成本低，高颜值，带回流焊温度曲线的加热台来焊接pcb。\n主控采用S_ProPrj_红龙加热台 - 支持恒温、回流焊_2026-04-23",
            "summary": "",
            "raw_page_text": "ESP32 RST R21 R23 3.3V VCC GND 电源 mcu",
            "schematic_file_path": "",
            "source_mode": "text_fallback",
        }

        templates = extract_templates_from_project(project)
        self.assertTrue(templates)
        source_project = templates[0]["source_project"]
        self.assertNotIn("\n", source_project["title"])
        self.assertNotIn("\n", source_project["project_url"])
        self.assertNotIn("S_ProPrj_", source_project["title"])

    def test_crawl_falls_back_to_text_when_schematic_download_fails(self):
        from unittest.mock import Mock, patch

        detail_html = """
        <html><body>
          <h1>ESP32-S3 DevKit</h1>
          <p>工程详情 原理图 PCB USB转UART: CH340K</p>
          <a href="/files/missing.zip">工程源码</a>
        </body></html>
        """
        page_response = Mock()
        page_response.text = detail_html
        page_response.raise_for_status = Mock()

        file_response = Mock()

        from requests import HTTPError

        file_response.raise_for_status.side_effect = HTTPError("404 Client Error")

        session = Mock()
        session.headers = {}
        session.get.side_effect = [page_response, page_response, file_response]

        with tempfile.TemporaryDirectory() as d, patch(
            "scripts.server.lceda_open_source_crawler.requests.Session",
            return_value=session,
        ):
            records = crawl_project_records(
                ["https://oshwhub.com/project/abc/esp32-s3-devkit"],
                category="validation_sample",
                keywords=["ESP32"],
                file_output_dir=Path(d),
            )

            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]["source_mode"], "text_fallback")
            self.assertEqual(records[0]["schematic_file_path"], "")
            self.assertEqual(records[0]["schematic_file_url"], "")
            self.assertEqual(records[0]["source_mode_reason"], "download_failed")
            detail = records[0]["source_mode_reason_detail"]
            self.assertEqual(detail["failed_candidate_count"], 1)
            self.assertIn("missing.zip", " ".join(detail["failed_candidate_urls"]))

    def test_crawl_downgrades_file_first_for_platformio_like_build_manifest(self):
        from unittest.mock import Mock, patch

        detail_html = """
        <html><body>
          <h1>ESP32 Build Package</h1>
          <p>工程详情 原理图 PCB</p>
          <a href="/files/source.zip">工程源码</a>
        </body></html>
        """
        page_response = Mock()
        page_response.text = detail_html
        page_response.raise_for_status = Mock()

        file_response = Mock()
        file_response.content = (
            b'{"build_type":"release","env_name":"esp32-c3-devkitm-1",'
            b'"defines":["ARDUINO_USB_CDC_ON_BOOT","AUTO-GENERATED"]}'
        )
        file_response.raise_for_status = Mock()

        session = Mock()
        session.headers = {}
        session.get.side_effect = [page_response, page_response, file_response]

        with tempfile.TemporaryDirectory() as d, patch(
            "scripts.server.lceda_open_source_crawler.requests.Session",
            return_value=session,
        ):
            records = crawl_project_records(
                ["https://oshwhub.com/project/abc/esp32-build-package"],
                category="validation_sample",
                keywords=["ESP32"],
                file_output_dir=Path(d),
            )
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]["source_mode"], "text_fallback")
            self.assertEqual(records[0]["source_mode_reason"], "downloaded_file_without_schematic_signal")

    def test_crawl_retries_next_schematic_candidate_when_first_download_fails(self):
        from unittest.mock import Mock, patch

        detail_html = """
        <html><body>
          <h1>ESP32-S3 DevKit</h1>
          <p>工程详情 原理图 PCB</p>
        </body></html>
        <script>
          self.__next_f.push([1,"0:[\\"$\\",\\"$L26\\",null,{\\"data\\":{\\"uuid\\":\\"proj-789\\",\\"path\\":\\"maker/project_demo\\",\\"name\\":\\"ESP32-S3 DevKit\\",\\"attachments\\":[{\\"uuid\\":\\"att-1\\",\\"name\\":\\"a.zip\\",\\"src\\":\\"/oshwhub/project/attachments/a.zip\\"},{\\"uuid\\":\\"att-2\\",\\"name\\":\\"very-good-success.zip\\",\\"src\\":\\"/oshwhub/project/attachments/very-good-success.zip\\"}]}}"])\n        </script>
        """
        page_response = Mock()
        page_response.text = detail_html
        page_response.raise_for_status = Mock()

        file_fail_response = Mock()
        from requests import HTTPError

        file_fail_response.raise_for_status.side_effect = HTTPError("404 Client Error")

        file_ok_response = Mock()
        file_ok_response.content = b'{"nets":["3V3","GND","UART_TXD","UART_RXD"],"components":["ESP32-S3","CH340"]}'
        file_ok_response.raise_for_status = Mock()

        session = Mock()
        session.headers = {}
        session.get.side_effect = [page_response, page_response, file_fail_response, file_ok_response]

        with tempfile.TemporaryDirectory() as d, patch(
            "scripts.server.lceda_open_source_crawler.requests.Session",
            return_value=session,
        ):
            records = crawl_project_records(
                ["https://oshwhub.com/project/abc/esp32-s3-devkit"],
                category="validation_sample",
                keywords=["ESP32"],
                file_output_dir=Path(d),
            )

            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]["source_mode"], "file_first")
            self.assertIn("very-good-success.zip", records[0]["schematic_file_url"])
            self.assertTrue(records[0]["schematic_file_path"].endswith("very-good-success.zip"))
            self.assertTrue(Path(records[0]["schematic_file_path"]).exists())

    def test_crawl_downgrades_file_first_when_downloaded_file_has_no_schematic_signal(self):
        from unittest.mock import Mock, patch

        detail_html = """
        <html><body>
          <h1>ESP32-S3 DevKit</h1>
          <p>工程详情 原理图 PCB</p>
          <a href="/files/source.zip">工程源码</a>
        </body></html>
        """
        page_response = Mock()
        page_response.text = detail_html
        page_response.raise_for_status = Mock()

        file_response = Mock()
        file_response.content = b'{"name":"firmware-package","kind":"release"}'
        file_response.raise_for_status = Mock()

        session = Mock()
        session.headers = {}
        session.get.side_effect = [page_response, page_response, file_response]

        with tempfile.TemporaryDirectory() as d, patch(
            "scripts.server.lceda_open_source_crawler.requests.Session",
            return_value=session,
        ):
            records = crawl_project_records(
                ["https://oshwhub.com/project/abc/esp32-s3-devkit"],
                category="validation_sample",
                keywords=["ESP32"],
                file_output_dir=Path(d),
            )

            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]["source_mode"], "text_fallback")
            self.assertEqual(records[0]["source_mode_reason"], "downloaded_file_without_schematic_signal")
            self.assertEqual(records[0]["schematic_file_path"], "")
            self.assertEqual(records[0]["schematic_file_url"], "")

    def test_extract_project_record_prefers_schematic_file(self):
        html = """
        <html>
          <head><title>ESP32-S3 DevKit - 嘉立创开源硬件平台</title></head>
          <body>
            <h1>ESP32-S3 DevKit</h1>
            <p>USB-C 5V 输入，BOOT 和 RESET 按键，I2C 传感器接口。</p>
            <a href="/attachments/esp32-s3-devkit.json">工程源码</a>
            <img src="/assets/preview.png" />
          </body>
        </html>
        """
        record = extract_project_record(
            html,
            "https://oshwhub.com/project/abc/esp32-s3-devkit",
            category="mcu_devboard",
            keywords=["ESP32"],
        )
        self.assertEqual(record["source_mode"], "file_first")
        self.assertEqual(record["schematic_file_url"], "https://oshwhub.com/attachments/esp32-s3-devkit.json")
        self.assertEqual(record["title"], "ESP32-S3 DevKit")
        self.assertIn("USB-C 5V", record["raw_page_text"])
        self.assertIn("https://oshwhub.com/assets/preview.png", record["preview_assets"])

    def test_extract_project_record_reads_schematic_file_from_embedded_json(self):
        html = """
        <html>
          <body>
            <h1>ESP32-S3 DevKit</h1>
            <script type="application/json">
              {
                "project": {
                  "uuid": "proj-123",
                  "attachments": [
                    {"uuid": "att-preview", "name": "preview.png", "url": "https://cdn.example.com/preview.png"},
                    {"uuid": "att-sch", "name": "schematic.zip", "url": "https://cdn.example.com/schematic.zip"}
                  ]
                }
              }
            </script>
          </body>
        </html>
        """
        record = extract_project_record(
            html,
            "https://oshwhub.com/project/abc/esp32-s3-devkit",
            category="mcu_devboard",
            keywords=["ESP32"],
        )
        self.assertEqual(record["source_mode"], "file_first")
        self.assertEqual(record["schematic_file_url"], "https://cdn.example.com/schematic.zip")

    def test_build_attachment_download_count_url(self):
        self.assertEqual(
            build_attachment_download_count_url("project", "proj-123", "att-456"),
            "/api/common/project/proj-123/attachments/att-456/addDownloadCount",
        )

    def test_extract_project_payload_from_next_flight(self):
        html = """
        <script>
          self.__next_f.push([1,"0:[\\"$\\",\\"$L6\\",null,{\\"initialSeedData\\":[\\"\\",{\\"children\\":[[\\"username\\",\\"maker\\",\\"d\\"],{\\"children\\":[\\"(project)\\",{\\"children\\":[[\\"path\\",\\"project_demo\\",\\"d\\"],{\\"children\\":[\\"__PAGE__\\",{},[[\\"$L7\\",\\"$L8\\",[[\\"$\\",\\"$L26\\",null,{\\"data\\":{\\"uuid\\":\\"proj-123\\",\\"path\\":\\"maker/project_demo\\",\\"name\\":\\"Demo Board\\",\\"attachments\\":[{\\"uuid\\":\\"att-1\\",\\"name\\":\\"schematic.zip\\",\\"url\\":\\"https://cdn.example.com/schematic.zip\\"}]}}]]]}]}]}]}]}"])\n        </script>
        """
        payload = extract_project_payload_from_next_flight(html)
        self.assertEqual(payload["uuid"], "proj-123")
        self.assertEqual(payload["path"], "maker/project_demo")
        self.assertEqual(payload["name"], "Demo Board")
        self.assertEqual(payload["attachments"][0]["url"], "https://cdn.example.com/schematic.zip")

    def test_extract_project_record_reads_schematic_src_from_next_flight_payload(self):
        html = """
        <html><body><h1>Battery Board</h1></body></html>
        <script>
          self.__next_f.push([1,"0:[\\"$\\",\\"$L26\\",null,{\\"data\\":{\\"uuid\\":\\"proj-456\\",\\"path\\":\\"maker/project_demo\\",\\"name\\":\\"Battery Board\\",\\"attachments\\":[{\\"uuid\\":\\"att-1\\",\\"name\\":\\"note.png\\",\\"src\\":\\"/oshwhub/project/attachments/note.png\\"},{\\"uuid\\":\\"att-2\\",\\"name\\":\\"main.sch\\",\\"src\\":\\"/oshwhub/project/attachments/main.sch\\"}]}}"])\n        </script>
        """
        record = extract_project_record(
            html,
            "https://oshwhub.com/maker/project_demo",
            category="battery",
            keywords=["BMS"],
        )
        self.assertEqual(record["project_uuid"], "proj-456")
        self.assertEqual(record["schematic_file_url"], "https://image.lceda.cn/oshwhub/project/attachments/main.sch")
        self.assertIn(
            "https://oshwhub.com/api/common/project/proj-456/attachments/att-2/addDownloadCount",
            record["schematic_file_url_candidates"],
        )
        self.assertEqual(record["source_mode"], "file_first")

    def test_extract_project_record_maps_attachments_path_to_image_host(self):
        html = """
        <html><body><h1>Power Board</h1></body></html>
        <script>
          self.__next_f.push([1,"0:[\\"$\\",\\"$L26\\",null,{\\"data\\":{\\"uuid\\":\\"proj-999\\",\\"path\\":\\"maker/project_demo\\",\\"name\\":\\"Power Board\\",\\"attachments\\":[{\\"uuid\\":\\"att-1\\",\\"name\\":\\"package.zip\\",\\"src\\":\\"/attachments/2024/4/demo-package.zip\\"}]}}"])\n        </script>
        """
        record = extract_project_record(
            html,
            "https://oshwhub.com/maker/project_demo",
            category="power",
            keywords=["USB"],
        )
        self.assertEqual(record["source_mode"], "file_first")
        self.assertEqual(record["schematic_file_url"], "https://image.lceda.cn/attachments/2024/4/demo-package.zip")

    def test_extract_project_record_skips_noise_attachment_names_from_payload(self):
        html = """
        <html><body><h1>MCU Board</h1></body></html>
        <script>
          self.__next_f.push([1,"0:[\\"$\\",\\"$L26\\",null,{\\"data\\":{\\"uuid\\":\\"proj-1001\\",\\"path\\":\\"maker/project_demo\\",\\"name\\":\\"MCU Board\\",\\"attachments\\":[{\\"uuid\\":\\"att-1\\",\\"name\\":\\"外壳模型.zip\\",\\"src\\":\\"/attachments/2024/4/shell-model.zip\\"},{\\"uuid\\":\\"att-2\\",\\"name\\":\\"main-board-source.zip\\",\\"src\\":\\"/attachments/2024/4/main-board-source.zip\\"}]}}"])\n        </script>
        """
        record = extract_project_record(
            html,
            "https://oshwhub.com/maker/project_demo",
            category="mcu_devboard",
            keywords=["ESP32"],
        )
        self.assertEqual(record["source_mode"], "file_first")
        self.assertIn("main-board-source.zip", record["schematic_file_url"])
        self.assertNotIn("shell-model.zip", " ".join(record.get("schematic_file_url_candidates", [])))

    def test_extract_project_record_deprioritizes_firmware_zip_candidate(self):
        html = """
        <html><body><h1>MCU Board</h1></body></html>
        <script>
          self.__next_f.push([1,"0:[\\"$\\",\\"$L26\\",null,{\\"data\\":{\\"uuid\\":\\"proj-789\\",\\"path\\":\\"maker/project_demo\\",\\"name\\":\\"MCU Board\\",\\"attachments\\":[{\\"uuid\\":\\"att-1\\",\\"name\\":\\"firmware.zip\\",\\"src\\":\\"/oshwhub/project/attachments/firmware.zip\\"},{\\"uuid\\":\\"att-2\\",\\"name\\":\\"main-board.zip\\",\\"src\\":\\"/oshwhub/project/attachments/main-board.zip\\"}]}}"])\n        </script>
        """
        record = extract_project_record(
            html,
            "https://oshwhub.com/maker/project_demo",
            category="mcu_devboard",
            keywords=["ESP32"],
        )
        self.assertEqual(record["source_mode"], "file_first")
        self.assertIn("main-board.zip", record["schematic_file_url"])
        self.assertNotIn(
            "firmware.zip",
            " ".join(str(item) for item in record.get("schematic_file_url_candidates", [])),
        )

    def test_extract_project_record_falls_back_to_text_without_file(self):
        html = """
        <html><body><h1>RP2040 Mini Board</h1><p>Type-C power and BOOT button.</p></body></html>
        """
        record = extract_project_record(
            html,
            "https://oshwhub.com/project/xyz/rp2040-mini",
            category="mcu_devboard",
            keywords=["RP2040"],
        )
        self.assertEqual(record["source_mode"], "text_fallback")
        self.assertEqual(record["schematic_file_url"], "")
        self.assertIn("Type-C power", record["raw_page_text"])


class TestStaticScoring(unittest.TestCase):
    def test_template_includes_scoring_fields(self):
        template = {
            "template_type": "gpio_passive_power_chain",
            "anchor_device_family": "ESP32",
            "anchor_device_model": "ESP32-S3",
            "quality_detail": {
                "connection_chain_count": 2,
                "connection_chains": [
                    {
                        "anchor_net": "EN",
                        "to_power_net": "3V3",
                        "passive_values": ["10k"],
                        "passive_refdes": ["R1"],
                        "evidence": "P1: EN -> R1 -> 3V3",
                    },
                    {
                        "anchor_net": "GPIO0",
                        "to_power_net": "3V3",
                        "passive_values": ["10k"],
                        "passive_refdes": ["R2"],
                        "evidence": "P1: GPIO0 -> R2 -> 3V3",
                    },
                ],
                "lcsc_part_codes": ["C17414", "C14663"],
                "has_token_fallback_chain": False,
            },
            "source_project": {
                "project_id": "local-files-022",
                "project_url": "https://oshwhub.com/local/022",
                "title": "ESP32-S3 Dev Board",
            },
            "components": [
                {"value": "10k", "role": "pullup_resistor"},
                {"value": "100nF", "role": "decoupling_capacitor"},
                {"value": "10uF", "role": "bulk_capacitor"},
            ],
            "default_values": {
                "connection_chains": [
                    {"anchor_net": "EN", "to_power_net": "3V3", "passive_values": ["10k"]},
                    {"anchor_net": "GPIO0", "to_power_net": "3V3", "passive_values": ["10k"]},
                ]
            },
        }

        scored = _apply_static_scoring(template)

        self.assertIn("scoring", scored)
        self.assertGreater(scored["scoring"]["static_quality_score"], 0.7)
        self.assertGreater(scored["scoring"]["signal_chain_score"], 0.7)
        self.assertGreater(scored["scoring"]["jlc_searchable_score"], 0.5)
        self.assertIn("real_connection_chains", scored["scoring"]["score_reasons"])
        self.assertIn("gpio_bias", scored["scoring"]["intent_tags"])

    def test_token_fallback_template_is_penalized(self):
        template = {
            "template_type": "mcu_boot_reset",
            "anchor_device_family": "ESP32",
            "anchor_device_model": "",
            "quality_detail": {
                "connection_chain_count": 0,
                "connection_chains": [],
                "lcsc_part_codes": [],
                "has_token_fallback_chain": True,
            },
            "source_project": {},
            "components": [],
            "default_values": {},
        }

        scored = _apply_static_scoring(template)

        self.assertLess(scored["scoring"]["static_quality_score"], 0.4)
        self.assertLess(scored["scoring"]["signal_chain_score"], 0.3)
        self.assertIn("token_fallback_chain", scored["scoring"]["score_reasons"])

    def test_uses_default_connection_chains_when_quality_detail_chains_empty(self):
        template = {
            "template_type": "gpio_passive_power_chain",
            "anchor_device_family": "ESP32",
            "anchor_device_model": "ESP32-S3",
            "quality_detail": {
                "connection_chain_count": 0,
                "connection_chains": [],
                "lcsc_part_codes": ["C17414"],
                "has_token_fallback_chain": False,
            },
            "source_project": {
                "project_id": "local-files-023",
                "project_url": "https://oshwhub.com/local/023",
                "title": "ESP32-S3 Bias Board",
            },
            "components": [{"value": "10k", "role": "pullup_resistor"}],
            "default_values": {
                "connection_chains": [
                    {
                        "anchor_net": "GPIO0",
                        "to_power_net": "3V3",
                        "passive_values": ["10k"],
                        "passive_refdes": ["R2"],
                        "evidence": "P1: GPIO0 -> R2 -> 3V3",
                    }
                ]
            },
        }

        scored = _apply_static_scoring(template)

        self.assertGreater(scored["scoring"]["signal_chain_score"], 0.7)
        self.assertIn("real_connection_chains", scored["scoring"]["score_reasons"])
        self.assertIn("gpio_bias", scored["scoring"]["intent_tags"])
        self.assertNotIn("reset", scored["scoring"]["intent_tags"])

    def test_nonzero_connection_chain_count_without_payload_does_not_inflate_signal_score(self):
        template = {
            "template_type": "gpio_passive_power_chain",
            "anchor_device_family": "ESP32",
            "anchor_device_model": "ESP32-S3",
            "quality_detail": {
                "connection_chain_count": 3,
                "connection_chains": [],
                "lcsc_part_codes": [],
                "has_token_fallback_chain": False,
            },
            "source_project": {},
            "components": [],
            "default_values": {},
        }

        scored = _apply_static_scoring(template)

        self.assertLess(scored["scoring"]["signal_chain_score"], 0.3)
        self.assertNotIn("real_connection_chains", scored["scoring"]["score_reasons"])

    def test_token_fallback_with_default_chains_keeps_fallback_penalty(self):
        template = {
            "template_type": "gpio_passive_power_chain",
            "anchor_device_family": "ESP32",
            "anchor_device_model": "ESP32-S3",
            "quality_detail": {
                "connection_chain_count": 0,
                "connection_chains": [],
                "lcsc_part_codes": [],
                "has_token_fallback_chain": True,
            },
            "source_project": {},
            "components": [{"value": "10k", "role": "pullup_resistor"}],
            "default_values": {
                "connection_chains": [
                    {
                        "anchor_net": "GPIO0",
                        "to_power_net": "3V3",
                        "passive_values": ["10k"],
                        "evidence": "token-fallback: GPIO0 -> 10k -> 3V3",
                    }
                ]
            },
        }

        scored = _apply_static_scoring(template)

        self.assertLess(scored["scoring"]["signal_chain_score"], 0.5)
        self.assertIn("token_fallback_chain", scored["scoring"]["score_reasons"])

    def test_plain_en_bias_case_does_not_get_reset_tag(self):
        template = {
            "template_type": "gpio_passive_power_chain",
            "anchor_device_family": "ESP32",
            "anchor_device_model": "ESP32-S3",
            "quality_detail": {
                "connection_chain_count": 1,
                "connection_chains": [
                    {
                        "anchor_net": "EN",
                        "to_power_net": "3V3",
                        "passive_values": ["10k"],
                        "passive_refdes": ["R1"],
                        "evidence": "P1: EN -> R1 -> 3V3",
                    }
                ],
                "lcsc_part_codes": [],
                "has_token_fallback_chain": False,
            },
            "source_project": {},
            "components": [{"value": "10k", "role": "pullup_resistor"}],
            "default_values": {},
        }

        scored = _apply_static_scoring(template)

        self.assertIn("gpio_bias", scored["scoring"]["intent_tags"])
        self.assertNotIn("reset", scored["scoring"]["intent_tags"])

    def test_generic_package_text_alone_is_not_strong_jlc_signal(self):
        template = {
            "template_type": "component_combo_bundle",
            "anchor_device_family": "ESP32",
            "anchor_device_model": "ESP32-S3",
            "quality_detail": {
                "connection_chain_count": 0,
                "connection_chains": [],
                "lcsc_part_codes": [],
                "has_token_fallback_chain": False,
            },
            "source_project": {},
            "components": [
                {"value": "0603", "role": "passive_support"},
                {"value": "SOT23-5", "role": "main_component"},
            ],
            "default_values": {},
        }

        scored = _apply_static_scoring(template)

        self.assertEqual(scored["scoring"]["jlc_searchable_score"], 0.0)


class LcedaTemplateExtractorTests(unittest.TestCase):
    def test_parse_schematic_text_tokens_extracts_structured_signals(self):
        text = """
        PART NO
        TRMMBT5401S23D
        VALUE
        LED RED
        PCB DECAL
        LED0603-RED
        VALUE
        0.005R 2512
        VALUE
        NTC 10K
        VBAT
        UART
        TEST-PAD1.5MM
        """
        tokens = parse_schematic_text_tokens(text)
        self.assertIn("VBAT", tokens["nets"])
        self.assertIn("UART", tokens["nets"])
        self.assertIn("LED RED", tokens["part_values"])
        self.assertIn("0.005R 2512", tokens["part_values"])
        self.assertIn("NTC 10K", tokens["part_values"])
        self.assertIn("LED0603-RED", tokens["footprints"])
        self.assertIn("TRMMBT5401S23D", tokens["part_numbers"])
        self.assertIn("TEST-PAD1.5MM", tokens["connectors"])

    def test_read_schematic_file_text_falls_back_when_zip_is_invalid(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "invalid.zip"
            p.write_text("ESP32-S3 UART_TXD UART_RXD 3V3 GND", encoding="utf-8")
            text = _read_schematic_file_text(str(p))
            self.assertIn("ESP32-S3", text)

    def test_parse_schematic_text_tokens_extracts_battery_protection_signals(self):
        text = """
        B+
        B-
        VBAT
        NTC1
        VALUE
        0.005R 2512
        VALUE
        NTC 10K
        VALUE
        MMBT5401
        PART NO
        TRMMBT5401S23D
        """
        tokens = parse_schematic_text_tokens(text)
        self.assertIn("B+", tokens["nets"])
        self.assertIn("B-", tokens["nets"])
        self.assertIn("VBAT", tokens["nets"])
        self.assertIn("NTC1", tokens["nets"])
        self.assertIn("0.005R 2512", tokens["part_values"])
        self.assertIn("NTC 10K", tokens["part_values"])
        self.assertIn("MMBT5401", tokens["part_values"])
        self.assertIn("TRMMBT5401S23D", tokens["part_numbers"])

    def test_detect_device_family_from_title_and_text(self):
        project = {"title": "ESP32-S3 DevKit", "raw_page_text": "USB-C and I2C sensor"}
        self.assertEqual(detect_device_family(project), ("ESP32", "ESP32-S3"))

    def test_detect_device_family_from_underscore_slug(self):
        project = {
            "title": "RP2040_Minimal",
            "project_url": "https://oshwhub.com/embeddedboys/rp2040_minimal",
            "raw_page_text": "reset boot",
        }
        self.assertEqual(detect_device_family(project), ("RP2040", "RP2040"))

    def test_detect_device_family_filters_dirty_stm32_noise(self):
        project = {
            "title": "STM32仅支持3 数字电压电流表扩展板",
            "project_url": "https://oshwhub.com/local/bad-sample",
            "raw_page_text": "",
        }
        self.assertEqual(detect_device_family(project), ("STM32", ""))

    def test_extract_text_fallback_templates_are_external_corpus_compatible(self):
        project = {
            "project_id": "oshwhub-project-abc-esp32-s3-devkit",
            "title": "ESP32-S3 DevKit",
            "project_url": "https://oshwhub.com/project/abc/esp32-s3-devkit",
            "source_mode": "text_fallback",
            "raw_page_text": "USB-C 5V 输入，BOOT 按键，RESET 按键，I2C 传感器接口，电源指示灯。",
            "tags": ["ESP32", "USB-C"],
        }
        templates = extract_templates_from_project(project)
        by_type = {template["template_type"]: template for template in templates}
        self.assertIn("usb_power_input", by_type)
        self.assertIn("mcu_boot_reset", by_type)
        self.assertIn("i2c_sensor_subsystem", by_type)
        self.assertEqual(by_type["usb_power_input"]["source"], "text_heuristic_fallback")
        self.assertLess(by_type["usb_power_input"]["quality_score"], 0.7)
        self.assertEqual(by_type["usb_power_input"]["anchor_device_family"], "ESP32")
        self.assertIn("components", by_type["usb_power_input"])
        self.assertIn("pin_bindings", by_type["usb_power_input"])
        self.assertIn("default_values", by_type["usb_power_input"])

    def test_extract_file_first_templates_use_higher_confidence_source(self):
        project = {
            "project_id": "oshwhub-project-rp2040-mini",
            "title": "RP2040 Mini Board",
            "project_url": "https://oshwhub.com/project/xyz/rp2040-mini",
            "source_mode": "file_first",
            "raw_page_text": "USB-C 5V 输入，BOOTSEL 按键，RESET 按键，状态指示灯。",
            "tags": ["RP2040"],
        }
        templates = extract_templates_from_project(project)
        self.assertTrue(templates)
        self.assertTrue(all(t["source"] == "lceda_open_source_extract" for t in templates))
        self.assertTrue(all(t["quality_score"] >= 0.7 for t in templates))

    def test_extract_templates_reads_saved_schematic_file_text(self):
        with tempfile.TemporaryDirectory() as d:
            schematic_path = Path(d) / "esp32-s3.json"
            schematic_path.write_text(
                json.dumps(
                    {
                        "components": ["ESP32-S3", "USB-C", "CH340K"],
                        "nets": ["VBUS", "3V3", "GND", "UART_TXD", "UART_RXD"],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            project = {
                "project_id": "oshwhub-project-esp32-s3",
                "title": "ESP32-S3 DevKit",
                "project_url": "https://oshwhub.com/project/abc/esp32-s3",
                "source_mode": "file_first",
                "schematic_file_path": str(schematic_path),
                "raw_page_text": "",
                "tags": [],
            }
            templates = extract_templates_from_project(project)
            by_type = {template["template_type"]: template for template in templates}
            self.assertIn("usb_power_input", by_type)
            self.assertIn("uart_download_header", by_type)
            self.assertEqual(by_type["usb_power_input"]["source"], "lceda_open_source_extract")

    def test_extract_templates_derives_power_and_uart_from_file_nets_without_text_keywords(self):
        with tempfile.TemporaryDirectory() as d:
            schematic_path = Path(d) / "esp32-signals.sch"
            schematic_path.write_text(
                """
                ESP32-S3
                3V3
                GND
                UART_TXD
                UART_RXD
                DTR
                RTS
                GPIO0
                EN
                UART-HEADER
                """,
                encoding="utf-8",
            )
            project = {
                "project_id": "oshwhub-project-esp32-s3-signal-only",
                "title": "ESP32-S3 Core",
                "project_url": "https://oshwhub.com/demo/esp32-s3-core",
                "source_mode": "file_first",
                "schematic_file_path": str(schematic_path),
                "raw_page_text": "",
                "tags": [],
            }
            templates = extract_templates_from_project(project)
            by_type = {template["template_type"]: template for template in templates}
            self.assertIn("mcu_power_core", by_type)
            self.assertIn("uart_download_header", by_type)

    def test_extract_templates_derives_uart_download_from_bootstrap_variant_signals(self):
        with tempfile.TemporaryDirectory() as d:
            schematic_path = Path(d) / "esp32-uart-variant.sch"
            schematic_path.write_text(
                """
                ESP32-C3
                3V3
                GND
                U0TXD
                U0RXD
                GPIO0
                EN
                DTR
                RTS
                USB-Serial
                UART-HEADER
                """,
                encoding="utf-8",
            )
            project = {
                "project_id": "oshwhub-project-esp32-c3-uart-variant",
                "title": "ESP32-C3 Debug Board",
                "project_url": "https://oshwhub.com/demo/esp32-c3-debug-board",
                "source_mode": "file_first",
                "schematic_file_path": str(schematic_path),
                "raw_page_text": "",
                "tags": [],
            }
            templates = extract_templates_from_project(project)
            by_type = {template["template_type"]: template for template in templates}
            self.assertIn("uart_download_header", by_type)

    def test_extract_templates_does_not_emit_uart_download_header_without_bridge_hint(self):
        with tempfile.TemporaryDirectory() as d:
            schematic_path = Path(d) / "esp32-uart-no-bridge.sch"
            schematic_path.write_text(
                """
                ESP32-S3
                UART_TXD
                UART_RXD
                3V3
                GND
                """,
                encoding="utf-8",
            )
            project = {
                "project_id": "oshwhub-project-esp32-s3-uart-no-bridge",
                "title": "ESP32-S3 Bare Core",
                "project_url": "https://oshwhub.com/demo/esp32-s3-bare",
                "source_mode": "file_first",
                "schematic_file_path": str(schematic_path),
                "raw_page_text": "",
                "tags": [],
            }
            templates = extract_templates_from_project(project)
            template_types = {template["template_type"] for template in templates}
            self.assertIn("mcu_power_core", template_types)
            self.assertNotIn("uart_download_header", template_types)

    def test_extract_templates_reads_schematic_text_from_zip(self):
        with tempfile.TemporaryDirectory() as d:
            schematic_path = Path(d) / "project.zip"
            with zipfile.ZipFile(schematic_path, "w") as archive:
                archive.writestr(
                    "docs/readme.txt",
                    "marketing text that should not be enough",
                )
                archive.writestr(
                    "hardware/schematic.json",
                    json.dumps(
                        {
                            "components": ["ESP32-C3", "USB-C", "CH340K"],
                            "nets": ["VBUS", "3V3", "GND", "UART_TXD", "UART_RXD"],
                        },
                        ensure_ascii=False,
                    ),
                )
                archive.writestr("images/preview.png", b"\x89PNG\r\n")

            project = {
                "project_id": "oshwhub-project-esp32-c3",
                "title": "ESP32-C3 Zip Project",
                "project_url": "https://oshwhub.com/project/abc/esp32-c3",
                "source_mode": "file_first",
                "schematic_file_path": str(schematic_path),
                "raw_page_text": "",
                "tags": [],
            }
            templates = extract_templates_from_project(project)
            by_type = {template["template_type"]: template for template in templates}
            self.assertIn("usb_power_input", by_type)
            self.assertIn("uart_download_header", by_type)
            self.assertEqual(by_type["usb_power_input"]["anchor_device_model"], "ESP32-C3")

    def test_extract_templates_skips_non_schematic_zip_payload(self):
        with tempfile.TemporaryDirectory() as d:
            schematic_path = Path(d) / "ydi.zip"
            with zipfile.ZipFile(schematic_path, "w") as archive:
                archive.writestr("readme.txt", "蝴蝶扑翼机说明文档")
                archive.writestr("YDIFly/YDIFly.ino", "void setup() {}\nvoid loop() {}")

            project = {
                "project_id": "oshwhub.com-ydi-pcb-ydi-flapping-wing-flight-control-main-control-board-open-source-4c56a374",
                "title": "YDIFLY——蝴蝶扑翼机飞控主控板开源",
                "project_url": "https://oshwhub.com/ydi_pcb/ydi-flapping-wing-flight-control-main-control-board-open-source",
                "source_mode": "file_first",
                "schematic_file_path": str(schematic_path),
                "raw_page_text": "",
                "tags": [],
            }
            templates = extract_templates_from_project(project)
            self.assertEqual(templates, [])

    def test_extract_templates_prefers_main_schematic_over_readme_json_in_zip(self):
        with tempfile.TemporaryDirectory() as d:
            schematic_path = Path(d) / "mixed.zip"
            with zipfile.ZipFile(schematic_path, "w") as archive:
                archive.writestr(
                    "docs/readme.json",
                    json.dumps({"note": "project guide", "desc": "no circuit nets"}, ensure_ascii=False),
                )
                archive.writestr(
                    "hardware/main.sch",
                    """
                    ESP32-S3
                    3V3
                    GND
                    UART_TXD
                    UART_RXD
                    DTR
                    RTS
                    GPIO0
                    EN
                    UART-HEADER
                    """,
                )

            project = {
                "project_id": "oshwhub-project-esp32-s3-mixed-zip",
                "title": "ESP32-S3 Mixed Zip",
                "project_url": "https://oshwhub.com/demo/esp32-s3-mixed-zip",
                "source_mode": "file_first",
                "schematic_file_path": str(schematic_path),
                "raw_page_text": "",
                "tags": [],
            }
            templates = extract_templates_from_project(project)
            by_type = {template["template_type"]: template for template in templates}
            self.assertIn("mcu_power_core", by_type)
            self.assertIn("uart_download_header", by_type)

    def test_extract_templates_file_first_firmware_zip_does_not_use_text_fallback_heuristics(self):
        with tempfile.TemporaryDirectory() as d:
            schematic_path = Path(d) / "firmware.zip"
            with zipfile.ZipFile(schematic_path, "w") as archive:
                archive.writestr(
                    "firmware/.vscode/settings.json",
                    json.dumps({"name": "demo project", "tags": ["status", "i2c", "usb-c"]}, ensure_ascii=False),
                )
                archive.writestr(
                    "firmware/config/board.json",
                    json.dumps({"chip": "esp32-c3", "feature": "usb to uart"}, ensure_ascii=False),
                )

            project = {
                "project_id": "oshwhub-project-firmware-zip",
                "title": "ESP32 firmware package",
                "project_url": "https://oshwhub.com/demo/esp32-firmware-package",
                "source_mode": "file_first",
                "schematic_file_path": str(schematic_path),
                "raw_page_text": "USB-C status gpio i2c reset boot",
                "tags": [],
            }
            templates = extract_templates_from_project(project)
            self.assertEqual(templates, [])

    def test_extract_templates_avoids_status_indicator_for_non_mcu_text_fallback(self):
        project = {
            "project_id": "oshwhub.com-jixin-usb-ttl-pl2303hxd-a6b1e2b29902455a8c64281de3ec3245-1a7920a4",
            "title": "USB-TTL串口通信模块-PL2303HXD",
            "project_url": "https://oshwhub.com/jixin/USB_TTL_PL2303HXD-a6b1e2b29902455a8c64281de3ec3245",
            "source_mode": "text_fallback",
            "raw_page_text": "通讯接口带有指示灯指示工作状态，通讯稳定，体积小。",
            "tags": [],
        }
        templates = extract_templates_from_project(project)
        template_types = {template["template_type"] for template in templates}
        self.assertNotIn("status_indicator", template_types)

    def test_extract_templates_keeps_status_indicator_for_mcu_projects(self):
        project = {
            "project_id": "oshwhub-project-esp32-led-status",
            "title": "ESP32-S3 Dev Board",
            "project_url": "https://oshwhub.com/demo/esp32-s3-dev-board",
            "source_mode": "text_fallback",
            "raw_page_text": "状态指示灯连接到 GPIO，调试时显示运行状态。",
            "tags": [],
        }
        templates = extract_templates_from_project(project)
        template_types = {template["template_type"] for template in templates}
        self.assertIn("status_indicator", template_types)

    def test_extract_templates_promotes_power_indicator_from_schematic_tokens(self):
        with tempfile.TemporaryDirectory() as d:
            schematic_path = Path(d) / "battery-board.sch"
            schematic_path.write_text(
                """
                VALUE
                LED RED
                VALUE
                1K
                VALUE
                NTC 10K
                PCB DECAL
                LED0603-RED
                VBAT
                TEST-PAD1.5MM
                POWER-PAD-5PIN-4.5MM
                """,
                encoding="utf-8",
            )
            project = {
                "project_id": "oshwhub.com-hmtang-schematic1-2f69568f",
                "title": "基于中颖SH3676010B 7-10串 30A 锂电池保护板",
                "project_url": "https://oshwhub.com/hmtang/schematic1",
                "source_mode": "file_first",
                "schematic_file_path": str(schematic_path),
                "raw_page_text": "",
                "tags": [],
            }
            templates = extract_templates_from_project(project)
            by_type = {template["template_type"]: template for template in templates}
            self.assertIn("power_indicator", by_type)
            self.assertEqual(by_type["power_indicator"]["source"], "lceda_open_source_extract")
            self.assertEqual(by_type["power_indicator"]["pin_bindings"][0]["net"], "VBAT")

    def test_extract_templates_promotes_battery_protection_from_schematic_tokens(self):
        with tempfile.TemporaryDirectory() as d:
            schematic_path = Path(d) / "battery-protection.sch"
            schematic_path.write_text(
                """
                B+
                B-
                VBAT
                NTC1
                VALUE
                0.005R 2512
                VALUE
                NTC 10K
                VALUE
                MMBT5401
                PART NO
                TRMMBT5401S23D
                """,
                encoding="utf-8",
            )
            project = {
                "project_id": "oshwhub.com-hmtang-schematic1-2f69568f",
                "title": "基于中颖SH3676010B 7-10串 30A 锂电池保护板",
                "project_url": "https://oshwhub.com/hmtang/schematic1",
                "source_mode": "file_first",
                "schematic_file_path": str(schematic_path),
                "raw_page_text": "",
                "tags": ["BMS"],
            }
            templates = extract_templates_from_project(project)
            by_type = {template["template_type"]: template for template in templates}
            self.assertIn("battery_protection", by_type)
            self.assertEqual(by_type["battery_protection"]["source"], "lceda_open_source_extract")
            self.assertEqual(by_type["battery_protection"]["default_values"]["sense_resistor"], "0.005R")

    def test_extract_templates_derives_current_sense_from_schematic_tokens(self):
        with tempfile.TemporaryDirectory() as d:
            schematic_path = Path(d) / "current-sense.sch"
            schematic_path.write_text(
                """
                B-
                VALUE
                0.005R 2512
                PCB DECAL
                RC2512-0.005R+/-1%
                """,
                encoding="utf-8",
            )
            project = {
                "project_id": "oshwhub.com-hmtang-schematic1-2f69568f",
                "title": "BMS current sense",
                "project_url": "https://oshwhub.com/hmtang/schematic1",
                "source_mode": "file_first",
                "schematic_file_path": str(schematic_path),
                "raw_page_text": "",
                "tags": ["BMS"],
            }
            templates = extract_templates_from_project(project)
            by_type = {template["template_type"]: template for template in templates}
            self.assertIn("current_sense", by_type)
            self.assertEqual(by_type["current_sense"]["default_values"]["sense_resistor"], "0.005R")
            self.assertEqual(by_type["current_sense"]["pin_bindings"][0]["net"], "B-")

    def test_extract_templates_derives_temperature_sense_from_schematic_tokens(self):
        with tempfile.TemporaryDirectory() as d:
            schematic_path = Path(d) / "temperature-sense.sch"
            schematic_path.write_text(
                """
                NTC1
                NTC2
                VALUE
                NTC 10K
                VALUE
                10K
                """,
                encoding="utf-8",
            )
            project = {
                "project_id": "oshwhub.com-hmtang-schematic1-2f69568f",
                "title": "BMS temperature sense",
                "project_url": "https://oshwhub.com/hmtang/schematic1",
                "source_mode": "file_first",
                "schematic_file_path": str(schematic_path),
                "raw_page_text": "",
                "tags": ["BMS"],
            }
            templates = extract_templates_from_project(project)
            by_type = {template["template_type"]: template for template in templates}
            self.assertIn("temperature_sense", by_type)
            self.assertEqual(by_type["temperature_sense"]["default_values"]["ntc"], "10K")
            self.assertEqual(by_type["temperature_sense"]["pin_bindings"][0]["net"], "NTC1")

    def test_extract_templates_does_not_emit_bms_templates_without_bms_context(self):
        with tempfile.TemporaryDirectory() as d:
            schematic_path = Path(d) / "generic-sense.sch"
            schematic_path.write_text(
                """
                B-
                NTC1
                VALUE
                0.005R 2512
                VALUE
                NTC 10K
                VALUE
                MMBT5401
                """,
                encoding="utf-8",
            )
            project = {
                "project_id": "oshwhub.com-generic-power-board",
                "title": "Generic Power Board",
                "project_url": "https://oshwhub.com/maker/generic-power-board",
                "source_mode": "file_first",
                "schematic_file_path": str(schematic_path),
                "raw_page_text": "A generic power board with protection signals and thermal monitor.",
                "tags": [],
            }
            templates = extract_templates_from_project(project)
            template_types = {template["template_type"] for template in templates}
            self.assertNotIn("battery_protection", template_types)
            self.assertNotIn("current_sense", template_types)
            self.assertNotIn("temperature_sense", template_types)

    def test_extract_templates_detects_cm1048_bms_from_realistic_signals(self):
        with tempfile.TemporaryDirectory() as d:
            schematic_path = Path(d) / "cm1048-bms.sch"
            schematic_path.write_text(
                """
                B+
                B-
                P-
                NTC1
                VALUE
                0.06R 2512
                VALUE
                CM1010-A
                VALUE
                CM1048-ET
                PART NAME
                MOSFET
                POWER-PAD-5PIN-3MM
                """,
                encoding="utf-8",
            )
            project = {
                "project_id": "oshwhub.com-hmtang-cm1048",
                "title": "基于CM1048+CM1010A,4串16.8V带均衡锂电保护板",
                "project_url": "https://oshwhub.com/hmtang/based-on-cm1048-cm10104-string-2",
                "source_mode": "file_first",
                "schematic_file_path": str(schematic_path),
                "raw_page_text": "CM1048 系列是一款 3~4 串锂电池保护芯片，可检测温度与充放电电流。",
                "tags": ["real_batch"],
            }
            templates = extract_templates_from_project(project)
            by_type = {template["template_type"]: template for template in templates}
            self.assertIn("battery_protection", by_type)
            self.assertIn("current_sense", by_type)
            self.assertIn("temperature_sense", by_type)

    def test_extract_templates_detects_bus_labels_wrapped_in_binary_text(self):
        with tempfile.TemporaryDirectory() as d:
            schematic_path = Path(d) / "cm1048-binaryish.sch"
            schematic_path.write_text(
                "\x00B+\x00 some bytes \x00B-\x00 other bytes \x00P-\x00\n"
                "VALUE\n0.06R 2512\n"
                "VALUE\nCM1048-ET\n"
                "NTC1\n",
                encoding="utf-8",
                errors="ignore",
            )
            project = {
                "project_id": "oshwhub.com-hmtang-cm1048-binaryish",
                "title": "基于CM1048+CM1010A,4串16.8V带均衡锂电保护板",
                "project_url": "https://oshwhub.com/hmtang/based-on-cm1048-cm10104-string-2",
                "source_mode": "file_first",
                "schematic_file_path": str(schematic_path),
                "raw_page_text": "锂电保护板，支持温度与电流检测。",
                "tags": ["real_batch"],
            }
            templates = extract_templates_from_project(project)
            by_type = {template["template_type"]: template for template in templates}
            self.assertIn("battery_protection", by_type)
            self.assertIn("current_sense", by_type)

    def test_summarize_template_extraction_reports_distribution_and_risk_flags(self):
        projects = [
            {
                "project_id": "bms-1",
                "title": "7串锂电保护板",
                "project_url": "https://oshwhub.com/hmtang/schematic1",
                "source_mode": "file_first",
                "raw_page_text": "BMS 锂电池保护板",
                "tags": ["BMS"],
                "schematic_file_path": "",
            },
            {
                "project_id": "devboard-1",
                "title": "ESP32-S3 开发板",
                "project_url": "https://oshwhub.com/BOOW/esp32-s3",
                "source_mode": "text_fallback",
                "raw_page_text": "USB转UART: CH340K 支持自动下载",
                "tags": [],
                "schematic_file_path": "",
            },
        ]
        templates_by_project = {
            "bms-1": [
                {"template_type": "battery_protection"},
                {"template_type": "current_sense"},
            ],
            "devboard-1": [{"template_type": "uart_download_header"}],
        }
        summary = summarize_template_extraction(projects, templates_by_project)
        self.assertEqual(summary["total_projects"], 2)
        self.assertEqual(summary["projects_with_templates"], 2)
        self.assertEqual(summary["template_type_counts"]["battery_protection"], 1)
        self.assertEqual(summary["template_type_counts"]["uart_download_header"], 1)
        self.assertEqual(summary["file_first_subset"]["total_projects"], 1)
        self.assertEqual(summary["file_first_subset"]["projects_with_templates"], 1)
        self.assertEqual(summary["file_first_subset"]["hit_rate"], 1.0)
        self.assertEqual(summary["file_first_subset"]["template_type_counts"]["battery_protection"], 1)
        self.assertIn("signal_counts", summary["file_first_subset"])
        self.assertEqual(summary["file_first_subset"]["signal_counts"]["file_first_with_any_signal"], 0)
        self.assertEqual(summary["risk_counts"]["battery_templates_without_bms_context"], 0)
        self.assertEqual(len(summary["project_reports"]), 2)
        self.assertEqual(summary["project_reports"][0]["project_id"], "bms-1")
        self.assertEqual(
            summary["project_reports"][0]["template_types"],
            ["battery_protection", "current_sense"],
        )
        self.assertIn("file_first_without_schematic_signal", summary["project_reports"][0]["risk_flags"])
        self.assertEqual(summary["project_reports"][1]["project_id"], "devboard-1")
        self.assertEqual(summary["project_reports"][1]["template_types"], ["uart_download_header"])

    def test_summarize_template_extraction_marks_project_level_battery_risk(self):
        projects = [
            {
                "project_id": "generic-1",
                "title": "Generic Power Board",
                "project_url": "https://oshwhub.com/maker/generic-power-board",
                "source_mode": "file_first",
                "raw_page_text": "Generic power board",
                "tags": [],
                "schematic_file_path": "",
            }
        ]
        templates_by_project = {
            "generic-1": [{"template_type": "battery_protection"}],
        }
        summary = summarize_template_extraction(projects, templates_by_project)
        self.assertEqual(summary["risk_counts"]["battery_templates_without_bms_context"], 1)
        self.assertEqual(summary["risk_counts"]["file_first_without_schematic_signal"], 1)
        self.assertEqual(summary["file_first_subset"]["total_projects"], 1)
        self.assertEqual(summary["file_first_subset"]["projects_with_templates"], 1)
        self.assertEqual(summary["file_first_subset"]["hit_rate"], 1.0)
        self.assertIn("battery_templates_without_bms_context", summary["project_reports"][0]["risk_flags"])
        self.assertIn("file_first_without_schematic_signal", summary["project_reports"][0]["risk_flags"])

    def test_summarize_template_extraction_reports_file_first_signal_profile(self):
        with tempfile.TemporaryDirectory() as d:
            schematic_path = Path(d) / "uart-ready.sch"
            schematic_path.write_text(
                """
                ESP32-S3
                U0TXD
                U0RXD
                GPIO0
                EN
                DTR
                RTS
                CH340
                UART-HEADER
                """,
                encoding="utf-8",
            )
            projects = [
                {
                    "project_id": "ff-uart-ready",
                    "title": "UART ready file-first",
                    "project_url": "https://oshwhub.com/demo/ff-uart-ready",
                    "source_mode": "file_first",
                    "schematic_file_path": str(schematic_path),
                }
            ]
            templates_by_project = {"ff-uart-ready": []}
            summary = summarize_template_extraction(projects, templates_by_project)
            signal_counts = summary["file_first_subset"]["signal_counts"]
            self.assertEqual(signal_counts["file_first_with_any_signal"], 1)
            self.assertEqual(signal_counts["file_first_with_uart_signal"], 1)
            self.assertEqual(signal_counts["file_first_with_uart_control_signal"], 1)
            self.assertEqual(signal_counts["file_first_with_uart_bridge_hint"], 1)
            self.assertEqual(signal_counts["file_first_uart_ready"], 1)
            self.assertEqual(summary["risk_counts"]["file_first_without_schematic_signal"], 0)
            self.assertEqual(
                summary["project_reports"][0]["file_first_signal_profile"]["file_first_with_any_signal"], 1
            )

    def test_summarize_template_extraction_reports_file_first_high_signal_subset(self):
        with tempfile.TemporaryDirectory() as d:
            high_signal_path = Path(d) / "high-signal.sch"
            high_signal_path.write_text(
                """
                ESP32-S3
                3V3
                GND
                UART_TXD
                UART_RXD
                GPIO0
                EN
                CH340
                UART-HEADER
                """,
                encoding="utf-8",
            )
            low_signal_path = Path(d) / "low-signal.json"
            low_signal_path.write_text(
                """
                {"name":"settings","kind":"firmware"}
                """,
                encoding="utf-8",
            )
            projects = [
                {
                    "project_id": "ff-high",
                    "title": "High signal file first",
                    "project_url": "https://oshwhub.com/demo/ff-high",
                    "source_mode": "file_first",
                    "schematic_file_path": str(high_signal_path),
                    "raw_page_text": "ESP32-S3 dev board",
                },
                {
                    "project_id": "ff-low",
                    "title": "Low signal file first",
                    "project_url": "https://oshwhub.com/demo/ff-low",
                    "source_mode": "file_first",
                    "schematic_file_path": str(low_signal_path),
                    "raw_page_text": "firmware package",
                },
            ]
            templates_by_project = {
                "ff-high": [{"template_type": "mcu_power_core"}, {"template_type": "uart_download_header"}],
                "ff-low": [],
            }
            summary = summarize_template_extraction(projects, templates_by_project)
            high_subset = summary["file_first_high_signal_subset"]
            self.assertEqual(high_subset["total_projects"], 1)
            self.assertEqual(high_subset["projects_with_templates"], 1)
            self.assertEqual(high_subset["hit_rate"], 1.0)
            self.assertEqual(high_subset["template_type_counts"]["mcu_power_core"], 1)
            self.assertEqual(high_subset["template_type_counts"]["uart_download_header"], 1)

    def test_summarize_template_extraction_reports_source_mode_reason_counts(self):
        projects = [
            {
                "project_id": "ff-1",
                "title": "File first failed download",
                "project_url": "https://oshwhub.com/demo/ff-1",
                "source_mode": "text_fallback",
                "source_mode_reason": "download_failed",
                "schematic_file_path": "",
            },
            {
                "project_id": "ff-2",
                "title": "File first no signal",
                "project_url": "https://oshwhub.com/demo/ff-2",
                "source_mode": "text_fallback",
                "source_mode_reason": "downloaded_file_without_schematic_signal",
                "schematic_file_path": "",
            },
            {
                "project_id": "ff-3",
                "title": "File first ok",
                "project_url": "https://oshwhub.com/demo/ff-3",
                "source_mode": "file_first",
                "source_mode_reason": "downloaded_file_with_schematic_signal",
                "schematic_file_path": "",
            },
        ]
        summary = summarize_template_extraction(projects, {"ff-1": [], "ff-2": [], "ff-3": []})
        reason_counts = summary["source_mode_reason_counts"]
        self.assertEqual(reason_counts["download_failed"], 1)
        self.assertEqual(reason_counts["downloaded_file_without_schematic_signal"], 1)
        self.assertEqual(reason_counts["downloaded_file_with_schematic_signal"], 1)

    def test_evaluate_project_file_returns_empty_summary_when_input_missing(self):
        with tempfile.TemporaryDirectory() as d:
            missing_path = Path(d) / "missing.jsonl"
            summary = evaluate_project_file(missing_path)
        self.assertEqual(summary["input"], str(missing_path))
        self.assertEqual(summary["total_projects"], 0)
        self.assertEqual(summary["projects_with_templates"], 0)
        self.assertEqual(summary["source_mode_counts"], {})
        self.assertEqual(summary["source_mode_reason_counts"], {})

    def test_extract_mcu_devboard_text_creates_power_core_template(self):
        project = {
            "project_id": "oshwhub-project-rp2040-minimal",
            "title": "RP2040_Minimal",
            "project_url": "https://oshwhub.com/embeddedboys/rp2040_minimal",
            "source_mode": "text_fallback",
            "raw_page_text": "基于RP2040的嵌入式MCU开发板，取自官方设计，但稍作升级。",
            "tags": [],
        }
        templates = extract_templates_from_project(project)
        by_type = {template["template_type"]: template for template in templates}
        self.assertIn("mcu_power_core", by_type)
        self.assertEqual(by_type["mcu_power_core"]["anchor_device_family"], "RP2040")

    def test_extract_uart_download_header_from_usb_uart_text(self):
        project = {
            "project_id": "oshwhub-project-esp32-s3",
            "title": "ESP32-S3 开发板",
            "project_url": "https://oshwhub.com/BOOW/esp32-s3",
            "source_mode": "text_fallback",
            "raw_page_text": "USB转UART: CH340K 支持自动下载，不需要手动进下载模式。",
            "tags": [],
        }
        templates = extract_templates_from_project(project)
        by_type = {template["template_type"]: template for template in templates}
        self.assertIn("uart_download_header", by_type)
        self.assertEqual(by_type["uart_download_header"]["anchor_device_model"], "ESP32-S3")

    def test_extract_does_not_create_boot_template_from_generic_download_text(self):
        project = {
            "project_id": "oshwhub-project-generic",
            "title": "Generic Open Project",
            "project_url": "https://oshwhub.com/maker/project_generic",
            "source_mode": "text_fallback",
            "raw_page_text": "附件 序号 文件名称 下载次数 暂无数据 打开设计图",
            "tags": [],
        }
        templates = extract_templates_from_project(project)
        self.assertEqual(templates, [])


class LcedaTemplateRagflowTransformTests(unittest.TestCase):
    def test_to_ragflow_template_record_preserves_structured_payload(self):
        template = {
            "template_id": "tpl-esp32-usb_power_input-12345678",
            "template_type": "usb_power_input",
            "anchor_device_family": "ESP32",
            "anchor_device_model": "ESP32-S3",
            "scenario_tags": ["usb-c", "power"],
            "components": [{"role": "connector", "suggested_prefix": "J", "value": "USB-C"}],
            "pin_bindings": [{"net": "VBUS", "target": "5V"}],
            "default_values": {"cc_resistor": "5.1k"},
            "source": "text_heuristic_fallback",
            "quality_score": 0.55,
            "source_project": {
                "project_id": "oshwhub-project-abc-esp32-s3-devkit",
                "project_url": "https://oshwhub.com/project/abc/esp32-s3-devkit",
                "title": "ESP32-S3 DevKit",
            },
        }
        record = to_ragflow_template_record(template)
        self.assertEqual(record["title"], "ESP32-S3 usb_power_input template")
        self.assertIn("external_rag_template_corpus", record)
        self.assertEqual(record["external_rag_template_corpus"], [template])
        self.assertEqual(record["metadata"]["kb_type"], "template")
        self.assertEqual(record["metadata"]["template_type"], "usb_power_input")
        self.assertEqual(record["metadata"]["source_ref"], "tpl-esp32-usb_power_input-12345678")
        self.assertIn("USB-C", record["content"])


if __name__ == "__main__":
    unittest.main()
