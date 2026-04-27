import json
import tempfile
import unittest
from pathlib import Path

from scripts.server.transform_lceda_templates_for_ragflow import (
    build_project_combo_rows,
    to_ragflow_template_record,
)
from scripts.server.transform_for_internal import to_internal_record
from scripts.server.transform_for_ragflow import to_ragflow_record
from scripts.server.validate_batch import summarize_rows


class TransformTests(unittest.TestCase):
    def setUp(self):
        self.row = {
            "kb_type": "principle",
            "title": "Power management | TI.com",
            "source_type": "official_doc",
            "source_ref": "www.ti.com-power-management-ti-com-674c0b9d53",
            "lang": "zh-CN",
            "content": "Power design tips...",
            "idempotency_key": "www.ti.com-power-management-ti-com-674c0b9d53",
        }

    def test_internal_record_shape(self):
        out = to_internal_record(self.row)
        self.assertEqual(out["kb_type"], "principle")
        self.assertIn("idempotency_key", out)
        self.assertEqual(out["source_ref"], self.row["source_ref"])

    def test_ragflow_record_shape(self):
        out = to_ragflow_record(self.row)
        self.assertIn("title", out)
        self.assertIn("content", out)
        self.assertIn("metadata", out)
        self.assertEqual(out["metadata"]["source_ref"], self.row["source_ref"])


class ValidationTests(unittest.TestCase):
    def test_summarize_rows(self):
        rows = [
            {
                "title": "A",
                "content": "x" * 300,
                "source_ref": "ref-a",
                "kb_type": "principle",
            },
            {
                "title": "B",
                "content": "short",
                "source_ref": "",
                "kb_type": "",
            },
        ]
        summary = summarize_rows(rows, min_content_chars=100)
        self.assertEqual(summary["total"], 2)
        self.assertEqual(summary["valid_content_count"], 1)
        self.assertEqual(summary["traceable_count"], 1)


class EndToEndIoTests(unittest.TestCase):
    def test_jsonl_roundtrip(self):
        sample = {"title": "T", "content": "C", "source_ref": "S", "kb_type": "principle"}
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "a.jsonl"
            p.write_text(json.dumps(sample, ensure_ascii=False) + "\n", encoding="utf-8")
            text = p.read_text(encoding="utf-8").strip()
            self.assertEqual(json.loads(text)["title"], "T")


class LcedaTransformTests(unittest.TestCase):
    def test_template_record_without_scoring_keeps_legacy_compatibility(self):
        template = {
            "template_id": "tpl-no-scoring",
            "template_type": "gpio_passive_power_chain",
            "anchor_device_family": "ESP32",
            "anchor_device_model": "ESP32-S3",
            "scenario_tags": ["mcu"],
            "components": [{"value": "10k"}],
            "pin_bindings": [{"net": "EN", "target": "MCU EN pin"}],
            "quality_score": 0.95,
            "quality_detail": {
                "connection_chains": [
                    {"evidence": "P1: EN -> R1 -> 3V3"}
                ],
                "lcsc_part_codes": ["C17414"],
            },
            "source_project": {
                "project_id": "local-files-022",
                "project_url": "https://oshwhub.com/local/022",
                "title": "ESP32-S3 Dev Board",
            },
        }

        record = to_ragflow_template_record(template)

        self.assertNotIn("Static quality score:", record["content"])
        self.assertNotIn("Intent tags:", record["content"])
        self.assertNotIn("Score reasons:", record["content"])
        self.assertNotIn("static_quality_score", record["metadata"])
        self.assertNotIn("structure_score", record["metadata"])
        self.assertNotIn("signal_chain_score", record["metadata"])
        self.assertNotIn("combo_integrity_score", record["metadata"])
        self.assertNotIn("jlc_searchable_score", record["metadata"])
        self.assertNotIn("project_quality_score", record["metadata"])
        self.assertNotIn("score_reasons", record["metadata"])
        self.assertNotIn("intent_tags", record["metadata"])

    def test_template_record_includes_scoring_metadata_and_summary(self):
        template = {
            "template_id": "tpl-esp32-s3-gpio-001",
            "template_type": "gpio_passive_power_chain",
            "anchor_device_family": "ESP32",
            "anchor_device_model": "ESP32-S3",
            "scenario_tags": ["mcu", "gpio_bias"],
            "components": [{"value": "10k"}],
            "pin_bindings": [{"net": "EN", "target": "MCU EN pin"}],
            "source": "lceda_open_source_extract",
            "quality_score": 0.95,
            "duplicate_group_size": 1,
            "quality_detail": {
                "connection_chains": [
                    {"evidence": "P1: EN -> R1 -> 3V3"}
                ],
                "lcsc_part_codes": ["C17414"],
            },
            "scoring": {
                "static_quality_score": 0.91,
                "structure_score": 0.9,
                "signal_chain_score": 0.95,
                "combo_integrity_score": 0.88,
                "jlc_searchable_score": 0.9,
                "project_quality_score": 0.8,
                "score_reasons": ["real_connection_chains", "lcsc_searchable_components"],
                "intent_tags": ["reset", "gpio_bias"],
            },
            "source_project": {
                "project_id": "local-files-022",
                "project_url": "https://oshwhub.com/local/022",
                "title": "ESP32-S3 Dev Board",
            },
        }

        record = to_ragflow_template_record(template)

        self.assertEqual(record["metadata"]["static_quality_score"], 0.91)
        self.assertEqual(record["metadata"]["structure_score"], 0.9)
        self.assertEqual(record["metadata"]["signal_chain_score"], 0.95)
        self.assertEqual(record["metadata"]["combo_integrity_score"], 0.88)
        self.assertEqual(record["metadata"]["jlc_searchable_score"], 0.9)
        self.assertEqual(record["metadata"]["project_quality_score"], 0.8)
        self.assertEqual(record["metadata"]["score_reasons"], ["real_connection_chains", "lcsc_searchable_components"])
        self.assertEqual(record["metadata"]["intent_tags"], ["reset", "gpio_bias"])
        self.assertIn("Static quality score: 0.91", record["content"])
        self.assertIn("Intent tags: reset, gpio_bias", record["content"])
        self.assertIn("Score reasons: real_connection_chains, lcsc_searchable_components", record["content"])

    def test_template_record_normalizes_scoring_values_consistently_for_content_and_metadata(self):
        template = {
            "template_id": "tpl-scoring-normalize",
            "template_type": "gpio_passive_power_chain",
            "anchor_device_family": "ESP32",
            "quality_detail": {
                "connection_chains": [
                    {"evidence": "P1: EN -> R1 -> 3V3"}
                ]
            },
            "scoring": {
                "static_quality_score": 0.91,
                "score_reasons": [" real_connection_chains ", None, "", 42],
                "intent_tags": [" reset ", "", None, 7, "gpio_bias"],
            },
        }

        record = to_ragflow_template_record(template)

        self.assertEqual(record["metadata"]["score_reasons"], ["real_connection_chains", "42"])
        self.assertEqual(record["metadata"]["intent_tags"], ["reset", "7", "gpio_bias"])
        self.assertIn("Score reasons: real_connection_chains, 42", record["content"])
        self.assertIn("Intent tags: reset, 7, gpio_bias", record["content"])

    def test_template_record_sanitizes_dirty_multiline_chain_evidence(self):
        template = {
            "template_id": "tpl-dirty-evidence",
            "template_type": "gpio_passive_power_chain",
            "quality_detail": {
                "connection_chains": [
                    {
                        "sheet_title": "P1",
                        "anchor_net": "EN",
                        "passive_refdes": ["R1"],
                        "to_power_net": "3V3",
                        "evidence": "  P1:\nEN  -> R1 \t-> 3V3 \n\nmetadata: bad  ",
                    }
                ]
            },
        }

        record = to_ragflow_template_record(template)

        self.assertIn("- P1: EN -> R1 -> 3V3", record["content"])
        self.assertNotIn("metadata: bad", record["content"])
        self.assertNotIn("\nEN  ->", record["content"])
        self.assertNotIn("\t", record["content"])

    def test_template_record_drops_dirty_evidence_for_partially_structured_chain(self):
        template = {
            "template_id": "tpl-partial-dirty-evidence",
            "template_type": "gpio_passive_power_chain",
            "quality_detail": {
                "connection_chains": [
                    {
                        "sheet_title": "P1",
                        "passive_refdes": ["R1"],
                        "evidence": "P1:\nunknown -> R1 -> 3V3\nmetadata: bad",
                    }
                ]
            },
        }

        record = to_ragflow_template_record(template)

        self.assertNotIn("metadata: bad", record["content"])
        self.assertNotIn("unknown -> R1 -> 3V3", record["content"])
        self.assertNotIn("- P1:", record["content"])
        self.assertNotIn("连接链:", record["content"])

    def test_to_ragflow_template_record_prefers_compact_chain_content_over_raw_json(self):
        template = {
            "template_id": "tpl-esp32-s3-gpio",
            "template_type": "gpio_passive_power_chain",
            "anchor_device_family": "ESP32",
            "anchor_device_model": "ESP32-S3",
            "scenario_tags": ["gpio", "passive-network", "power-bias"],
            "components": [
                {"role": "gpio_anchor", "value": "EN"},
                {"role": "passive_refdes", "value": "R47"},
                {"role": "passive_support", "value": "10K"},
            ],
            "pin_bindings": [{"net": "EN", "target": "3V3 via 10K"}],
            "default_values": {
                "connection_chains": [
                    {
                        "sheet_title": "P1",
                        "anchor_net": "EN",
                        "to_power_net": "3V3",
                        "passive_values": ["10K"],
                        "passive_refdes": ["R47"],
                        "evidence": "P1: EN -> R47 -> 3V3",
                    },
                    {
                        "sheet_title": "P1",
                        "anchor_net": "3V3",
                        "to_power_net": "GND",
                        "passive_values": ["100nF"],
                        "passive_refdes": ["C1"],
                        "evidence": "P1: 3V3 -> C1 -> GND",
                    },
                ]
            },
            "quality_score": 0.99,
            "retrieval_priority_score": 1.14,
            "quality_detail": {
                "connection_chain_count": 2,
                "connection_chains": [
                    {
                        "sheet_title": "P1",
                        "anchor_net": "EN",
                        "to_power_net": "3V3",
                        "passive_values": ["10K"],
                        "passive_refdes": ["R47"],
                        "evidence": "P1: EN -> R47 -> 3V3",
                    },
                    {
                        "sheet_title": "P1",
                        "anchor_net": "3V3",
                        "to_power_net": "GND",
                        "passive_values": ["100nF"],
                        "passive_refdes": ["C1"],
                        "evidence": "P1: 3V3 -> C1 -> GND",
                    },
                ],
                "lcsc_part_codes": ["C11702", "C22935"],
                "has_token_fallback_chain": False,
            },
            "source_project": {
                "project_id": "local-files-022",
                "project_url": "https://oshwhub.com/local/demo",
                "title": "ESP32-S3 demo",
            },
        }

        row = to_ragflow_template_record(template)
        content = row["content"]

        self.assertIn("连接链:", content)
        self.assertIn("- P1: EN -> R47 -> 3V3", content)
        self.assertIn("- P1: 3V3 -> C1 -> GND", content)
        self.assertNotIn('"connection_chains"', content)
        self.assertNotIn("Default values:", content)

    def test_build_project_combo_rows_skips_projects_without_connection_chains(self):
        templates = [
            {
                "template_id": "tpl-a",
                "template_type": "mcu_power_core",
                "components": [{"role": "mcu", "value": "CW32"}],
                "default_values": {},
                "source_project": {
                    "project_id": "local-files-130",
                    "project_url": "https://oshwhub.com/local/sample",
                    "title": "bad sample",
                },
                "quality_score": 0.9,
                "retrieval_priority_score": 0.9,
            }
        ]
        self.assertEqual(build_project_combo_rows(templates), [])

    def test_build_project_combo_rows_renders_structured_reset_bundle(self):
        templates = [
            {
                "template_id": "tpl-reset-a",
                "template_type": "gpio_passive_power_chain",
                "components": [
                    {"role": "gpio_anchor", "value": "RST"},
                    {"role": "passive_refdes", "value": "R21"},
                    {"role": "passive_refdes", "value": "R23"},
                ],
                "default_values": {
                    "connection_chains": [
                        {
                            "anchor_net": "RST",
                            "to_power_net": "+3.3V",
                            "passive_values": ["R21"],
                        },
                        {
                            "anchor_net": "RST",
                            "to_power_net": "+3.3V",
                            "passive_values": ["R23"],
                        },
                    ]
                },
                "source_project": {
                    "project_id": "local-files-195",
                    "project_url": "https://oshwhub.com/local/reset-demo",
                    "title": "红龙加热台",
                },
                "scoring": {
                    "static_quality_score": 0.93,
                    "structure_score": 0.9,
                    "signal_chain_score": 0.95,
                    "combo_integrity_score": 0.92,
                    "jlc_searchable_score": 0.88,
                    "project_quality_score": 0.84,
                    "score_reasons": ["real_connection_chains", "source_project_traceable"],
                    "intent_tags": ["reset", "gpio_bias"],
                },
                "quality_score": 0.99,
                "retrieval_priority_score": 0.99,
            }
        ]

        rows = build_project_combo_rows(templates)
        self.assertEqual(len(rows), 1)

        row = rows[0]
        self.assertEqual(row["title"], "红龙加热台 project_combo_bundle")
        self.assertEqual(row["metadata"]["source_ref"], "project_combo_local-files-195")
        self.assertEqual(row["metadata"]["connection_chain_count"], 2)
        self.assertEqual(row["metadata"]["static_quality_score"], 0.93)
        self.assertEqual(row["metadata"]["intent_tags"], ["reset", "gpio_bias"])
        self.assertEqual(
            row["metadata"]["score_reasons"],
            ["real_connection_chains", "source_project_traceable"],
        )

        content = row["content"]
        self.assertIn("项目: 红龙加热台", content)
        self.assertIn("项目地址: local-files-195", content)
        self.assertIn("组合类型: reset_pullup_network", content)
        self.assertIn("电路功能: 复位上拉网络", content)
        self.assertIn("锚点信号: RST", content)
        self.assertIn("配套器件: R21, R23", content)
        self.assertIn("Static quality score: 0.93", content)
        self.assertIn("Intent tags: reset, gpio_bias", content)
        self.assertIn("Score reasons: real_connection_chains, source_project_traceable", content)
        self.assertIn("- RST -> R21 -> +3.3V", content)
        self.assertIn("- RST -> R23 -> +3.3V", content)
        self.assertIn("- 复位脚上拉", content)
        self.assertNotIn("metadata:", content)
        self.assertNotIn("Template count:", content)
        self.assertEqual(content.count("红龙加热台 project_combo_bundle"), 0)

    def test_build_project_combo_rows_sanitizes_dirty_source_project_fields(self):
        templates = [
            {
                "template_id": "tpl-reset-b",
                "template_type": "gpio_passive_power_chain",
                "components": [{"role": "passive_refdes", "value": "R21"}],
                "default_values": {
                    "connection_chains": [
                        {
                            "anchor_net": "RST",
                            "to_power_net": "+3.3V",
                            "passive_values": ["R21"],
                        }
                    ]
                },
                "source_project": {
                    "project_id": "local-files-195",
                    "project_url": "https://oshwhub.com/local/demo\npath",
                    "title": "94_简介：测试项目\n主控采用S_ProPrj_红龙加热台",
                },
                "quality_score": 0.99,
                "retrieval_priority_score": 0.99,
            }
        ]

        row = build_project_combo_rows(templates)[0]
        self.assertNotIn("\n", row["title"])
        self.assertNotIn("S_ProPrj_", row["title"])
        self.assertIn("项目: 红龙加热台", row["content"])
        self.assertIn("项目地址: local-files-195", row["content"])
        self.assertEqual(
            row["metadata"]["source_project_url"],
            "https://oshwhub.com/local/demopath",
        )

    def test_build_project_combo_rows_prefers_short_project_name_from_proprj_title(self):
        templates = [
            {
                "template_id": "tpl-reset-c",
                "template_type": "gpio_passive_power_chain",
                "components": [{"role": "passive_refdes", "value": "R21"}],
                "default_values": {
                    "connection_chains": [
                        {
                            "anchor_net": "RST",
                            "to_power_net": "+3.3V",
                            "passive_values": ["R21"],
                        }
                    ]
                },
                "source_project": {
                    "project_id": "local-files-195",
                    "project_url": "https://oshwhub.com/local/demo",
                    "title": "94_简介：这是一个成本低，高颜值的加热台_ProPrj_红龙加热台 - 支持恒温、回流焊_2026-04-23",
                },
                "quality_score": 0.99,
                "retrieval_priority_score": 0.99,
            }
        ]

        row = build_project_combo_rows(templates)[0]
        self.assertEqual(row["title"], "红龙加热台 - 支持恒温、回流焊 project_combo_bundle")
        self.assertIn("项目: 红龙加热台 - 支持恒温、回流焊", row["content"])
        self.assertNotIn("94_简介：", row["content"])
        self.assertNotIn("_2026-04-23", row["content"])

    def test_build_project_combo_rows_uses_project_id_for_local_display_ref(self):
        templates = [
            {
                "template_id": "tpl-reset-d",
                "template_type": "gpio_passive_power_chain",
                "components": [{"role": "passive_refdes", "value": "R21"}],
                "default_values": {
                    "connection_chains": [
                        {
                            "anchor_net": "RST",
                            "to_power_net": "+3.3V",
                            "passive_values": ["R21"],
                        }
                    ]
                },
                "source_project": {
                    "project_id": "local-files-195",
                    "project_url": "https://oshwhub.com/local/94_简介：这是一个成本低，高颜值的加热台_ProPrj_红龙加热台_2026-04-23",
                    "title": "94_简介：这是一个成本低，高颜值的加热台_ProPrj_红龙加热台_2026-04-23",
                },
                "quality_score": 0.99,
                "retrieval_priority_score": 0.99,
            }
        ]

        row = build_project_combo_rows(templates)[0]
        self.assertIn("项目地址: local-files-195", row["content"])
        self.assertEqual(
            row["metadata"]["source_project_url"],
            "https://oshwhub.com/local/94_简介：这是一个成本低，高颜值的加热台_ProPrj_红龙加热台_2026-04-23",
        )


if __name__ == "__main__":
    unittest.main()
