import json
import tempfile
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
