# Lceda Open Source Template Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first local pipeline for LCEDA open-source project crawling, template extraction, and RAGFlow import conversion.

**Architecture:** Add three focused Python CLI modules under `scripts/server/`. The crawler emits normalized project JSONL records, the extractor consumes those records and emits `external_rag_template_corpus`-compatible template JSONL, and the transformer converts templates into RAGFlow-oriented records with structured metadata.

**Tech Stack:** Python standard library, existing `requests`/`beautifulsoup4` conventions, `unittest`, JSONL file outputs.

---

### Task 1: Crawler Record Model and HTML Extraction

**Files:**
- Create: `scripts/server/lceda_open_source_crawler.py`
- Test: `scripts/server/tests/test_lceda_open_source_pipeline.py`

- [ ] Write failing tests for project record normalization, list link extraction, schematic file detection, and text fallback.
- [ ] Run `python3 -m unittest scripts.server.tests.test_lceda_open_source_pipeline` and confirm crawler imports/functions fail because they do not exist.
- [ ] Implement minimal crawler helpers: `canonicalize_project_url`, `extract_project_links`, `extract_project_record`, `write_jsonl`, CLI argument parsing.
- [ ] Run the same unittest command and confirm crawler tests pass.

### Task 2: Template Extraction

**Files:**
- Create: `scripts/server/extract_lceda_templates.py`
- Test: `scripts/server/tests/test_lceda_open_source_pipeline.py`

- [ ] Add failing tests for text fallback extracting `usb_power_input`, `mcu_power_core`, `button_boot`, and low-confidence source metadata.
- [ ] Run the focused unittest command and confirm extractor imports/functions fail because they do not exist.
- [ ] Implement minimal extractor helpers: `detect_device_family`, `extract_templates_from_project`, `build_template_id`, JSONL CLI.
- [ ] Run the focused unittest command and confirm extractor tests pass.

### Task 3: RAGFlow Template Transform

**Files:**
- Create: `scripts/server/transform_lceda_templates_for_ragflow.py`
- Test: `scripts/server/tests/test_lceda_open_source_pipeline.py`

- [ ] Add failing tests for RAGFlow record shape, metadata preservation, and structured template payload embedding.
- [ ] Run the focused unittest command and confirm transformer imports/functions fail because they do not exist.
- [ ] Implement minimal transformer helpers: `to_ragflow_template_record`, JSONL reader/writer, CLI.
- [ ] Run the focused unittest command and confirm transformer tests pass.

### Task 4: Docs and Tracking

**Files:**
- Modify: `scripts/server/README.md`
- Modify: `docs/exec-plans/active/当前执行跟踪.md`

- [ ] Document the three script commands and output directories.
- [ ] Append section `4.5` with completed pipeline implementation notes and verification evidence.

### Task 5: Final Verification

**Files:**
- Test command: `python3 -m unittest scripts.server.tests.test_lceda_open_source_pipeline scripts.server.tests.test_transforms_pipeline scripts.server.tests.test_rag_knowledge_crawler`

- [ ] Run the final unittest command.
- [ ] If it fails, fix only failures caused by this pipeline work and rerun.
- [ ] Report exact verification command and result.
