import { test } from "node:test";
import * as assert from "node:assert/strict";

import { buildRagModuleEvidence, formatRagModuleEvidenceForModel } from "../ragModuleEvidence";

test("buildRagModuleEvidence extracts reusable ESP32-S3 module structure from RAG snippets", () => {
  const modules = buildRagModuleEvidence([
    {
      chunk_id: "85cdeac21c158292",
      score: 0.656,
      title: "tpl-esp32-s3-gpio_passive_power_chain-b3bf3bff.md",
      snippet:
        "# ESP32-S3 gpio_passive_power_chain template\n" +
        "Template type: gpio_passive_power_chain\n" +
        "Components: EN, R8, R8, EN, R13, R13, IO0, R1, R1\n" +
        "Pin bindings: EN -> 3V3 via R8; IO0 -> GND via R1\n" +
        "连接链:\n" +
        "- P1: EN -> R8 -> 3V3\n" +
        "- P1: IO0 -> R1 -> GND",
      source_ref: "tpl-esp32-s3-gpio_passive_power_chain-b3bf3bff",
      kb_type: "template",
    },
  ]);

  assert.equal(modules[0]?.module_type, "esp32_s3_minimum_system");
  assert.equal(modules[0]?.anchor_component.part, "ESP32-S3");
  assert.equal(modules[0]?.anchor_component.role, "mcu_module");
  assert.deepEqual(modules[0]?.nets, ["EN", "3V3", "IO0", "GND"]);
  assert.deepEqual(modules[0]?.connection_chains[0], {
    from: "EN",
    via: "R8",
    to: "3V3",
    intent: "enable_pullup",
  });
  assert.deepEqual(modules[0]?.connection_chains[1], {
    from: "IO0",
    via: "R1",
    to: "GND",
    intent: "boot_strap",
  });
  assert.equal(modules[0]?.components.some((item) => item.ref === "R8" && item.role === "en_pullup"), true);
  assert.equal(
    modules[0]?.components.some((item) => item.ref === "R1" && item.role === "boot_pulldown_or_button_resistor"),
    true
  );
  assert.deepEqual(modules[0]?.pin_bindings, [
    { component_role: "mcu_module", pin: "EN", net: "EN" },
    { component_role: "mcu_module", pin: "IO0", net: "IO0" },
  ]);
});

test("formatRagModuleEvidenceForModel sends structured modules to the LLM", () => {
  const payload = formatRagModuleEvidenceForModel([
    {
      chunk_id: "1fc886e4d7863eaa",
      score: 0.659,
      title: "tpl-esp32-s3-component_combo_bundle-b21d026f.md",
      snippet:
        "Template type: component_combo_bundle\n" +
        "Components: C25744, VBUS -> GND\n" +
        "Pin bindings: EN -> bundle anchor net\n" +
        "连接链:\n" +
        "- Power: VBUS -> C6 -> GND",
      source_ref: "tpl-esp32-s3-component_combo_bundle-b21d026f",
      kb_type: "template",
    },
  ]);
  const parsed = JSON.parse(payload);

  assert.equal(parsed.modules[0].module_type, "esp32_s3_minimum_system");
  assert.deepEqual(parsed.modules[0].connection_chains[0], {
    from: "VBUS",
    via: "C6",
    to: "GND",
    intent: "decoupling",
  });
  assert.match(parsed.instruction, /module_type/);
  assert.match(parsed.instruction, /DraftDesignSpec/);
});
