import { test } from "node:test";
import * as assert from "node:assert/strict";

import { completeDraftPlanPeripherals } from "../draftPeripheralCompletion";
import { generateDraftPlanFromPrompt, normalizeDraftPlan } from "../generateDraftPlan";
import { previewDraftPlan } from "../previewDraftPlan";

test("completeDraftPlanPeripherals adds near-production support parts for esp32-s3 voice device drafts", () => {
  const completed = completeDraftPlanPeripherals({
    title: "voice device",
    rationale: "test",
    components: [
      { id: "u-mcu", ref: "U1", name: "ESP32-S3", properties: {} },
      { id: "j-usb", ref: "J1", name: "USB-C", properties: {} },
      { id: "u-mic", ref: "U2", name: "INMP441", properties: {} },
      { id: "u-amp", ref: "U3", name: "MAX98357A", properties: {} },
    ],
    pins: [],
    nets: [],
  } as any);

  const refs = completed.components.map((item) => item.ref);
  assert.equal(refs.includes("C1"), true);
  assert.equal(refs.includes("R1"), true);
  assert.equal((completed.completionSummary?.addedComponentCount ?? 0) > 0, true);
  assert.equal(
    completed.components.some((item) => item.properties?.generated_by === "rule_completion"),
    true
  );
});

test("completeDraftPlanPeripherals does not duplicate equivalent support parts already present", () => {
  const completed = completeDraftPlanPeripherals({
    title: "esp32",
    rationale: "test",
    components: [
      { id: "u1", ref: "U1", name: "ESP32-S3", properties: {} },
      { id: "c-existing", ref: "C1", name: "0.1uF", properties: { generated_by: "llm" } },
    ],
    pins: [],
    nets: [],
  } as any);

  assert.equal(completed.components.filter((item) => item.ref === "C1").length, 1);
});

test("normalizeDraftPlan runs peripheral completion before preview/apply consumers read the plan", () => {
  const normalized = normalizeDraftPlan(
    generateDraftPlanFromPrompt("帮我设计一个基于ESP32-S3、USB-C、INMP441、MAX98357A 的语音设备")
  );
  const refs = normalized.components.map((item) => item.ref);
  assert.equal(refs.some((ref) => String(ref || "").startsWith("C")), true);
  assert.equal((normalized.completionSummary?.addedComponentCount ?? 0) > 0, true);
});

test("previewDraftPlan reports automatically completed peripherals", () => {
  const preview = previewDraftPlan(
    completeDraftPlanPeripherals({
      title: "voice",
      rationale: "test",
      components: [{ id: "u1", ref: "U1", name: "ESP32-S3", properties: {} }],
      pins: [],
      nets: [],
    } as any)
  );

  assert.equal((preview.completedPeripheralCount ?? 0) > 0, true);
  assert.equal((preview.completedPeripheralTemplates ?? []).length > 0, true);
});

test("completeDraftPlanPeripherals runs devboard rag completion after rule completion", () => {
  const completed = completeDraftPlanPeripherals({
    title: "devboard",
    rationale: "test",
    components: [{ id: "u1", ref: "U1", name: "ESP32-S3-WROOM-1", properties: {} }],
    pins: [],
    nets: [{ id: "n-3v3", name: "3V3", nodeIds: [], isPower: true }],
  } as any);

  assert.equal(
    completed.components.some((item) => item.properties?.generated_by === "rag_template"),
    true
  );
});

test("completeDraftPlanPeripherals lets rag dedupe skip overlaps with real rule-completion roles", () => {
  const completed = completeDraftPlanPeripherals({
    title: "devboard",
    rationale: "test",
    components: [{ id: "u1", ref: "U1", name: "ESP32-S3-WROOM-1", properties: {} }],
    pins: [],
    nets: [{ id: "n-3v3", name: "3V3", nodeIds: [], isPower: true }],
  } as any);

  assert.equal(
    completed.components.filter((item) =>
      item.properties?.generated_by === "rag_template" &&
      (item.properties?.completion_role === "mcu_bulk_decoupling" ||
        item.properties?.completion_role === "mcu_en_pullup" ||
        item.properties?.completion_role === "mcu_local_decoupling")
    ).length,
    0
  );
});

test("generateDraftPlanFromPrompt can apply external rag template corpus during normalization", () => {
  const normalized = normalizeDraftPlan({
    title: "esp32c3 devboard",
    rationale: "test",
    components: [{ id: "u1", ref: "U1", name: "ESP32-C3-MINI-1", properties: {} }],
    pins: [],
    nets: [
      { id: "n-3v3", name: "3V3", nodeIds: [], isPower: true },
      { id: "n-gpio8", name: "GPIO8", nodeIds: [], isPower: false },
    ],
    externalRagTemplateCorpus: [
      {
        template_id: "external-esp32c3-status-indicator",
        template_type: "status_indicator",
        anchor_device_family: "ESP32",
        anchor_device_model: "ESP32-C3",
        scenario_tags: ["devboard", "status", "led"],
        components: [
          {
            ref: "D_EXT_STAT",
            name: "led",
            value: "GREEN",
            completion_role: "status_led",
            attach_to_net: "GPIO8",
          },
          {
            ref: "R_EXT_STAT",
            name: "resistor",
            value: "1k",
            completion_role: "status_led_resistor",
            attach_to_net: "GPIO8",
          },
        ],
        source: {
          kind: "lceda_open_source_extract",
          project_id: "oshw-esp32c3-board",
          sheet_ref: "sheet-1",
          extraction_revision: "2026-04-19-a",
        },
        quality_score: 0.95,
      },
    ],
  } as any);

  assert.equal(
    normalized.components.some(
      (item) =>
        item.properties?.generated_by === "rag_template" &&
        item.properties?.template_id === "external-esp32c3-status-indicator"
    ),
    true
  );
});
