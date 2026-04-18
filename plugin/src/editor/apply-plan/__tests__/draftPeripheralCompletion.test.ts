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
