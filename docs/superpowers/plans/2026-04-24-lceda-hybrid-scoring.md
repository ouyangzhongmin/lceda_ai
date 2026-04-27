# LCEDA Hybrid Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 LCEDA 开源原理图抽取、RAGFlow 导入和服务层检索增加“静态质量评分 + 动态查询意图重排”的混合评分体系，使组合检索和信号链检索都更准确。

**Architecture:** 在抽取层为模板和项目组合增加结构化静态评分字段，在 RAGFlow 转换层把评分与原因显式写入 metadata 和内容文本，在服务层统一计算查询意图分并与原始召回分、静态分组合为最终排序分。整体保持现有下载与导入链路不变，只做增量增强，并对缺失新字段的老数据保持回退兼容。

**Tech Stack:** Python 3, unittest, Go, Gin, RAGFlow retrieval API, JSONL import manifests

---

## File Map

- Modify: `scripts/server/extract_lceda_templates.py`
  - 为模板抽取结果增加静态评分字段、评分原因、意图标签。
- Modify: `scripts/server/transform_lceda_templates_for_ragflow.py`
  - 将评分字段写入 RAGFlow content 和 metadata。
- Modify: `scripts/server/tests/test_lceda_open_source_pipeline.py`
  - 为静态评分规则补测试。
- Modify: `scripts/server/tests/test_transforms_pipeline.py`
  - 为 RAGFlow 转换输出的评分字段与评分摘要补测试。
- Modify: `server/internal/usecase/rag/service.go`
  - 增加查询意图识别、静态分提取、统一 final score 排序。
- Modify: `server/internal/usecase/rag/service_test.go`
  - 为动态评分、扩窗召回、最终排序结果补测试。
- Regenerate: `results/lceda_template_corpus/files_import_manifest.templates.v2.jsonl`
  - 重新生成模板导入语料。
- Regenerate: `results/lceda_ragflow_import/files_import_manifest.templates.v2.jsonl`
  - 重新生成 RAGFlow 导入 manifest。

### Task 1: Static Scoring in Extractor

**Files:**
- Modify: `scripts/server/tests/test_lceda_open_source_pipeline.py`
- Modify: `scripts/server/extract_lceda_templates.py`

- [ ] **Step 1: Write the failing tests for static scoring fields**

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m unittest scripts.server.tests.test_lceda_open_source_pipeline -v`
Expected: FAIL with `_apply_static_scoring` missing or scoring fields absent.

- [ ] **Step 3: Implement static scoring helpers in extractor**

```python
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
    return template
```

- [ ] **Step 4: Wire static scoring into template generation path**

```python
for template in templates:
    _apply_template_quality(template)
    deduplicated.append(_apply_static_scoring(template))
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m unittest scripts.server.tests.test_lceda_open_source_pipeline -v`
Expected: PASS with new static scoring assertions green.

- [ ] **Step 6: Commit**

```bash
git add scripts/server/extract_lceda_templates.py scripts/server/tests/test_lceda_open_source_pipeline.py
git commit -m "feat: add static scoring for lceda templates"
```

### Task 2: RAGFlow Transform Enrichment

**Files:**
- Modify: `scripts/server/tests/test_transforms_pipeline.py`
- Modify: `scripts/server/transform_lceda_templates_for_ragflow.py`

- [ ] **Step 1: Write the failing tests for scoring metadata and content rendering**

```python
def test_template_record_includes_scoring_metadata(self):
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
    self.assertEqual(record["metadata"]["intent_tags"], ["reset", "gpio_bias"])
    self.assertIn("Static quality score: 0.91", record["content"])
    self.assertIn("Score reasons: real_connection_chains, lcsc_searchable_components", record["content"])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m unittest scripts.server.tests.test_transforms_pipeline -v`
Expected: FAIL because metadata/content do not yet include scoring fields.

- [ ] **Step 3: Implement scoring metadata and score summary rendering**

```python
def _template_content(template: dict[str, Any]) -> str:
    scoring = template.get("scoring") or {}
    score_reasons = ", ".join(scoring.get("score_reasons", []))
    intent_tags = ", ".join(scoring.get("intent_tags", []))
    parts = [
        _template_title(template),
        f"Template type: {template.get('template_type', '')}",
        f"Static quality score: {scoring.get('static_quality_score', 0)}",
        f"Intent tags: {intent_tags}",
        f"Score reasons: {score_reasons}",
    ]
    # append existing component / chain / source lines
    return "\n".join(part for part in parts if part.strip())


def to_ragflow_template_record(template: dict[str, Any]) -> dict[str, Any]:
    scoring = template.get("scoring") or {}
    return {
        # existing fields...
        "metadata": {
            # existing metadata...
            "static_quality_score": scoring.get("static_quality_score", 0),
            "structure_score": scoring.get("structure_score", 0),
            "signal_chain_score": scoring.get("signal_chain_score", 0),
            "combo_integrity_score": scoring.get("combo_integrity_score", 0),
            "jlc_searchable_score": scoring.get("jlc_searchable_score", 0),
            "project_quality_score": scoring.get("project_quality_score", 0),
            "score_reasons": scoring.get("score_reasons", []),
            "intent_tags": scoring.get("intent_tags", []),
        },
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m unittest scripts.server.tests.test_transforms_pipeline -v`
Expected: PASS with scoring metadata and content summary present.

- [ ] **Step 5: Commit**

```bash
git add scripts/server/transform_lceda_templates_for_ragflow.py scripts/server/tests/test_transforms_pipeline.py
git commit -m "feat: expose scoring metadata in ragflow transform"
```

### Task 3: Unified Intent Scoring in RAG Service

**Files:**
- Modify: `server/internal/usecase/rag/service_test.go`
- Modify: `server/internal/usecase/rag/service.go`

- [ ] **Step 1: Write the failing tests for query intent reranking**

```go
func TestServiceUsesStaticScoreAndQueryIntentForResetQueries(t *testing.T) {
    service := NewService("test_collection", &fixedVectorStoreWithResetNoiseHits{})

    results, err := service.Search("ESP32-S3 复位网络", 5)
    if err != nil {
        t.Fatalf("Search returned error: %v", err)
    }
    if results[0].Title != "project_combo_local-files-190.md" {
        t.Fatalf("expected project combo first, got %q", results[0].Title)
    }
}

func TestServicePromotesPreciseSignalChainForGpioBiasQuery(t *testing.T) {
    service := NewService("test_collection", &fixedVectorStoreWithProjectComboAndTemplateHits{})

    results, err := service.Search("ESP32-S3 GPIO 电阻 电容 VCC", 5)
    if err != nil {
        t.Fatalf("Search returned error: %v", err)
    }
    if results[0].Title != "tpl-esp32-s3-gpio_passive_power_chain-80cf943d.md" {
        t.Fatalf("expected signal chain template first, got %q", results[0].Title)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/usecase/rag -v`
Expected: FAIL because service does not yet compute unified final score from static score and intent profile.

- [ ] **Step 3: Implement query intent detection and final score helpers**

```go
type IntentProfile struct {
	QueryUpper        string
	TargetModel       string
	ResetIntent       bool
	GPIOBiasIntent    bool
	PowerIntent       bool
	InterfaceIntent   bool
	SensorBusIntent   bool
}

func detectQueryIntent(query string) IntentProfile {
	upper := strings.ToUpper(strings.TrimSpace(query))
	return IntentProfile{
		QueryUpper:      upper,
		TargetModel:     detectTargetModel(upper),
		ResetIntent:     strings.Contains(upper, "复位") || strings.Contains(upper, "RESET") || strings.Contains(upper, "RST") || strings.Contains(upper, "EN") || strings.Contains(upper, "BOOT"),
		GPIOBiasIntent:  strings.Contains(upper, "GPIO") || strings.Contains(upper, "IO") || strings.Contains(upper, "电阻") || strings.Contains(upper, "电容") || strings.Contains(upper, "VCC") || strings.Contains(upper, "3V3"),
		PowerIntent:     strings.Contains(upper, "LDO") || strings.Contains(upper, "电源") || strings.Contains(upper, "去耦"),
		InterfaceIntent: strings.Contains(upper, "USB") || strings.Contains(upper, "UART") || strings.Contains(upper, "I2C") || strings.Contains(upper, "SDA") || strings.Contains(upper, "SCL"),
	}
}

func computeFinalScore(intent IntentProfile, index int, total int, result SearchResult) float64 {
	retrievalScore := normalizedRetrievalScore(index, total, result)
	staticScore := extractStaticScore(result)
	intentScore := scoreQueryIntent(intent, result)
	comboBonus := scoreProjectComboBonus(result)
	return retrievalScore*0.35 + staticScore*0.30 + intentScore*0.25 + comboBonus*0.10
}
```

- [ ] **Step 4: Replace ad-hoc rerank with unified final score sorting**

```go
func rerankGroupedTemplateResults(query string, results []SearchResult) []SearchResult {
	intent := detectQueryIntent(query)
	type rankedResult struct {
		result SearchResult
		rank   float64
	}
	items := make([]rankedResult, 0, len(results))
	for idx, result := range results {
		items = append(items, rankedResult{
			result: result,
			rank:   computeFinalScore(intent, idx, len(results), result),
		})
	}
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].rank > items[j].rank
	})
	out := make([]SearchResult, 0, len(results))
	for _, item := range items {
		out = append(out, item.result)
	}
	return out
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `go test ./internal/usecase/rag -v`
Expected: PASS with reset intent and gpio bias intent ranking expectations green.

- [ ] **Step 6: Commit**

```bash
git add server/internal/usecase/rag/service.go server/internal/usecase/rag/service_test.go
git commit -m "feat: add hybrid intent scoring for rag search"
```

### Task 4: Full Pipeline Regression

**Files:**
- Modify: `scripts/server/tests/test_lceda_open_source_pipeline.py`
- Modify: `scripts/server/tests/test_transforms_pipeline.py`
- Modify: `server/internal/usecase/rag/service_test.go`

- [ ] **Step 1: Run the focused Python and Go test suites together**

Run: `python -m unittest scripts.server.tests.test_lceda_open_source_pipeline scripts.server.tests.test_transforms_pipeline -v && cd server && go test ./internal/usecase/rag -v`
Expected: All tests PASS.

- [ ] **Step 2: If any pipeline regression appears, add the minimal failing test first**

```python
# Example pattern for Python regression

def test_project_combo_keeps_scoring_when_no_source_url(self):
    row = build_project_combo_rows([...])[0]
    self.assertIn("static_quality_score", row["metadata"])
```

```go
// Example pattern for Go regression
func TestServiceFallsBackWhenStaticScoreMissing(t *testing.T) {
    // assert old documents without scoring still sort deterministically
}
```

- [ ] **Step 3: Fix only the failing regression paths**

```text
Use the smallest code change that restores the failing assertion while preserving the new hybrid scoring behavior.
```

- [ ] **Step 4: Re-run the full focused test suite**

Run: `python -m unittest scripts.server.tests.test_lceda_open_source_pipeline scripts.server.tests.test_transforms_pipeline -v && cd server && go test ./internal/usecase/rag -v`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/server/tests/test_lceda_open_source_pipeline.py scripts/server/tests/test_transforms_pipeline.py server/internal/usecase/rag/service_test.go
git commit -m "test: cover hybrid scoring pipeline regressions"
```

### Task 5: Regenerate Corpus and Reimport RAGFlow Data

**Files:**
- Regenerate: `results/lceda_template_corpus/files_import_manifest.templates.v2.jsonl`
- Regenerate: `results/lceda_ragflow_import/files_import_manifest.templates.v2.jsonl`

- [ ] **Step 1: Regenerate extracted templates and transformed manifest**

Run:

```bash
python scripts/server/extract_lceda_templates.py \
  --input-dir results/lceda_open_source_raw/files \
  --output results/lceda_template_corpus/files_import_manifest.templates.v2.jsonl

python scripts/server/transform_lceda_templates_for_ragflow.py \
  --input results/lceda_template_corpus/files_import_manifest.templates.v2.jsonl \
  --output results/lceda_ragflow_import/files_import_manifest.templates.v2.jsonl
```

Expected: both JSONL files regenerated with `scoring` fields and score summary text.

- [ ] **Step 2: Verify regenerated manifest contains scoring fields**

Run:

```bash
python - <<'PY'
import json
from pathlib import Path
path = Path('results/lceda_ragflow_import/files_import_manifest.templates.v2.jsonl')
row = json.loads(path.read_text(encoding='utf-8').splitlines()[0])
print(row['metadata']['static_quality_score'])
print(row['metadata']['intent_tags'])
print('Static quality score:' in row['content'])
PY
```

Expected: numeric score, non-empty intent tags where applicable, and `True` for score text in content.

- [ ] **Step 3: Reimport the regenerated manifest into RAGFlow**

Run:

```bash
python scripts/server/ragflow_import_jsonl.py \
  --input results/lceda_ragflow_import/files_import_manifest.templates.v2.jsonl \
  --base-url http://127.0.0.1:39380 \
  --api-key ragflow-g8zpcvPSSi0lLtkDvaa9_940ZjJbOg1lu8qYw2rHY3k \
  --dataset-id 6bd834b4342911f185870d318ee3a4a1 \
  --batch-size 20
```

Expected: import completes successfully for all rows, or missing rows are identified for补传.

- [ ] **Step 4: Audit imported documents exist in RAGFlow**

Run:

```bash
python scripts/server/ragflow_audit_existing_docs.py \
  --input results/lceda_ragflow_import/files_import_manifest.templates.v2.jsonl \
  --base-url http://127.0.0.1:39380 \
  --api-key ragflow-g8zpcvPSSi0lLtkDvaa9_940ZjJbOg1lu8qYw2rHY3k \
  --dataset-id 6bd834b4342911f185870d318ee3a4a1
```

Expected: `missing=0`.

- [ ] **Step 5: Commit regenerated manifests if they are intended to stay versioned**

```bash
git add results/lceda_template_corpus/files_import_manifest.templates.v2.jsonl results/lceda_ragflow_import/files_import_manifest.templates.v2.jsonl
git commit -m "chore: regenerate ragflow manifests with hybrid scoring"
```

### Task 6: Retrieval Validation Against Acceptance Queries

**Files:**
- Modify: `server/internal/usecase/rag/service_test.go` (only if a new acceptance regression test is needed)

- [ ] **Step 1: Validate reset query through local service**

Run:

```bash
curl -sS -X POST 'http://127.0.0.1:28080/api/v1/rag/search' \
  -H 'Content-Type: application/json' \
  -d '{"query":"ESP32-S3 复位网络","top_k":5}' | jq '.data.results | map(.title)'
```

Expected: top results include real `project_combo` or real `EN/RST/BOOT` chains.

- [ ] **Step 2: Validate EN pull-up query through local service**

Run:

```bash
curl -sS -X POST 'http://127.0.0.1:28080/api/v1/rag/search' \
  -H 'Content-Type: application/json' \
  -d '{"query":"ESP32-S3 EN 上拉电阻 3.3V","top_k":5}' | jq '.data.results[0]'
```

Expected: result contains `EN -> R -> 3V3` evidence.

- [ ] **Step 3: Validate GPIO bias query through local service**

Run:

```bash
curl -sS -X POST 'http://127.0.0.1:28080/api/v1/rag/search' \
  -H 'Content-Type: application/json' \
  -d '{"query":"ESP32-S3 GPIO 电阻 电容 VCC","top_k":5}' | jq '.data.results[0]'
```

Expected: result contains `GPIO -> R/C -> VCC/3V3` evidence.

- [ ] **Step 4: Validate I2C pull-up query through local service**

Run:

```bash
curl -sS -X POST 'http://127.0.0.1:28080/api/v1/rag/search' \
  -H 'Content-Type: application/json' \
  -d '{"query":"I2C 上拉电阻","top_k":5}' | jq '.data.results | map(.title)'
```

Expected: front results include `SDA/SCL -> 4.7k -> VCC` style hits.

- [ ] **Step 5: Add a new failing test first if any acceptance query regresses**

```go
func TestAcceptanceLikeResetQueryKeepsProjectComboAheadOfWeakTemplates(t *testing.T) {
    // encode the observed regression into a deterministic unit test before changing code
}
```

- [ ] **Step 6: Re-run the focused Go suite after any acceptance-fix change**

Run: `cd server && go test ./internal/usecase/rag -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/internal/usecase/rag/service.go server/internal/usecase/rag/service_test.go

git commit -m "fix: tune hybrid scoring retrieval acceptance cases"
```
