import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from scripts.server.ragflow_importer import (
    ImportStats,
    build_endpoint,
    iter_jsonl_rows,
    load_input_files,
    send_one_row,
)


class PathTests(unittest.TestCase):
    def test_load_input_files(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            (p / "a.jsonl").write_text("{}\n", encoding="utf-8")
            (p / "b.jsonl").write_text("{}\n", encoding="utf-8")
            files = load_input_files(p)
            self.assertEqual([f.name for f in files], ["a.jsonl", "b.jsonl"])

    def test_build_endpoint(self):
        url = build_endpoint(
            base_url="http://127.0.0.1:39380",
            endpoint_template="/api/v1/datasets/{dataset_id}/documents",
            dataset_id="ds_1",
        )
        self.assertEqual(url, "http://127.0.0.1:39380/api/v1/datasets/ds_1/documents")


class JsonlTests(unittest.TestCase):
    def test_iter_jsonl_rows(self):
        with tempfile.TemporaryDirectory() as d:
            fp = Path(d) / "x.jsonl"
            fp.write_text(json.dumps({"a": 1}) + "\n\n" + json.dumps({"b": 2}) + "\n", encoding="utf-8")
            rows = list(iter_jsonl_rows(fp))
            self.assertEqual(len(rows), 2)
            self.assertEqual(rows[0]["a"], 1)


class SendTests(unittest.TestCase):
    def test_send_one_row_success(self):
        session = Mock()
        resp = Mock()
        resp.status_code = 200
        resp.text = "ok"
        resp.raise_for_status = Mock()
        session.request.return_value = resp

        stats = ImportStats()
        ok = send_one_row(
            session=session,
            method="POST",
            endpoint="http://x/api",
            row={"title": "T", "content": "C", "metadata": {}},
            headers={"Authorization": "Bearer k"},
            timeout_seconds=10,
            retries=2,
            retry_backoff_seconds=0.01,
            stats=stats,
            dry_run=False,
            parse_after_upload=False,
            parse_endpoint="http://x/parse",
        )
        self.assertTrue(ok)
        self.assertEqual(stats.success_count, 1)

    def test_send_one_row_retry_then_success(self):
        session = Mock()
        bad = Mock()
        bad.raise_for_status.side_effect = Exception("boom")
        bad.status_code = 500
        bad.text = "err"
        good = Mock()
        good.status_code = 200
        good.text = "ok"
        good.raise_for_status = Mock()
        session.request.side_effect = [bad, good]

        stats = ImportStats()
        ok = send_one_row(
            session=session,
            method="POST",
            endpoint="http://x/api",
            row={"title": "T", "content": "C", "metadata": {}},
            headers={},
            timeout_seconds=10,
            retries=2,
            retry_backoff_seconds=0.0,
            stats=stats,
            dry_run=False,
            parse_after_upload=False,
            parse_endpoint="http://x/parse",
        )
        self.assertTrue(ok)
        self.assertEqual(stats.retry_count, 1)


if __name__ == "__main__":
    unittest.main()
