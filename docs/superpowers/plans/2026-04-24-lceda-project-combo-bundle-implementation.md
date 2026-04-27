# LCEDA Project Combo Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite LCEDA project combo bundle text into structured retrieval-oriented content with rule-based combo classification.

**Architecture:** Keep extraction unchanged and modify only the transformation layer that converts template corpus rows into RAGFlow rows. Add narrow helper functions for chain classification and bundle content rendering, then regenerate the import manifest.

**Tech Stack:** Python, unittest, JSONL transform scripts

---

### Task 1: Lock expected bundle rendering behavior

**Files:**
- Modify: `scripts/server/tests/test_transforms_pipeline.py`
- Test: `scripts/server/tests/test_transforms_pipeline.py`

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run the targeted test command and verify failure**
- [ ] **Step 3: Cover structured sections, semantic combo type, and metadata-free body text**
- [ ] **Step 4: Re-run targeted tests after implementation**

### Task 2: Implement structured combo bundle rendering

**Files:**
- Modify: `scripts/server/transform_lceda_templates_for_ragflow.py`
- Test: `scripts/server/tests/test_transforms_pipeline.py`

- [ ] **Step 1: Add chain summarization and combo classification helpers**
- [ ] **Step 2: Rewrite `build_project_combo_rows` content rendering**
- [ ] **Step 3: Keep output record shape compatible with existing importer**
- [ ] **Step 4: Run targeted tests to verify pass**

### Task 3: Regenerate import artifact and verify output

**Files:**
- Modify: `results/lceda_ragflow_import/files_import_manifest.templates.v2.jsonl`
- Modify: `results/lceda_template_corpus/files_import_manifest.templates.v2.jsonl` (read-only dependency for regeneration)

- [ ] **Step 1: Run transform script to regenerate the RAGFlow import manifest**
- [ ] **Step 2: Inspect a representative `project_combo_local-files-195` row**
- [ ] **Step 3: Run the relevant unittest suite and Python compile check**
