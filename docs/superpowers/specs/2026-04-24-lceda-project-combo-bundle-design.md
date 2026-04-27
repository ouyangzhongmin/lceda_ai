# LCEDA Project Combo Bundle Design

## Goal

Improve `project_combo_bundle` records so they are retrieval-oriented schematic combination templates instead of noisy raw text dumps.

## Scope

This change only affects project-level combo bundle text generation in `scripts/server/transform_lceda_templates_for_ragflow.py`.

## Requirements

1. Remove redundant title repetition from bundle content.
2. Keep metadata in metadata fields only; do not shape main content like a metadata dump.
3. Rewrite combo content into stable sections: project, URL, combo type, function, anchor signal, supporting parts, connection chains, retrieval hints.
4. Add rule-based combo classification for common patterns such as reset pull-up, signal pull-up, LED drive, and power decoupling.
5. Skip project-level bundles that do not contain real connection chains.
6. Preserve compatibility with existing JSONL output shape.

## Non-Goals

1. No redesign of per-template records.
2. No deep `.epro2` extraction changes in this task.
3. No RAGFlow API/importer changes in this task.
