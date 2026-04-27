import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  exportDevboardRagTemplateCorpus,
  getDevboardRagTemplates,
  importDevboardRagTemplateCorpus,
} from "../devboardRagTemplates";
import { applyDevboardRagCompletion, recallDevboardRagTemplates } from "../devboardRagCompletion";

test("getDevboardRagTemplates returns structured templates for supported MCU families", () => {
  const templates = getDevboardRagTemplates();

  assert.equal(templates.some((item) => item.anchorDeviceModel === "ESP32-S3"), true);
  assert.equal(templates.some((item) => item.anchorDeviceFamily === "RP2040"), true);
  assert.equal(templates.some((item) => item.templateType === "mcu_boot_reset"), true);

  const firstCallEsp32 = templates.find((item) => item.anchorDeviceModel === "ESP32-S3");
  assert.equal(firstCallEsp32 === undefined, false);
  firstCallEsp32?.scenarioTags.push("mutated-tag");

  const secondCallEsp32 = getDevboardRagTemplates().find((item) => item.anchorDeviceModel === "ESP32-S3");
  assert.equal(secondCallEsp32 === undefined, false);
  assert.equal(secondCallEsp32?.scenarioTags.includes("mutated-tag"), false);
});

test("getDevboardRagTemplates includes first-phase local templates for esp32-c3, stm32f103, uart header, and power indicator", () => {
  const templates = getDevboardRagTemplates();

  assert.equal(templates.some((item) => item.anchorDeviceModel === "ESP32-C3"), true);
  assert.equal(templates.some((item) => item.anchorDeviceModel === "STM32F103"), true);
  assert.equal(templates.some((item) => item.templateType === "uart_download_header"), true);
  assert.equal(templates.some((item) => item.templateType === "power_indicator"), true);
});

test("recallDevboardRagTemplates ranks exact MCU model matches ahead of family matches", () => {
  const result = recallDevboardRagTemplates({
    components: [{ id: "u1", ref: "U1", name: "ESP32-S3-WROOM-1-N16R8", properties: {} }],
  } as any);

  assert.equal(result.candidates[0]?.anchorDeviceModel, "ESP32-S3");
  assert.equal(
    result.candidates[0]?.score > result.candidates[result.candidates.length - 1]!.score,
    true
  );
});

test("recallDevboardRagTemplates detects ESP32 family when only non-exact model text is present", () => {
  const result = recallDevboardRagTemplates({
    components: [{ id: "u1", ref: "U1", name: "ESP32-WROOM-32", properties: {} }],
  } as any);

  assert.equal(result.anchorModel, undefined);
  assert.equal(result.anchorFamily, "ESP32");
  assert.equal(result.candidates.some((item) => item.templateId === "esp32-family-expansion-header"), true);
});

test("recallDevboardRagTemplates surfaces exact model candidates for esp32-c3 and stm32f103", () => {
  const esp32c3Result = recallDevboardRagTemplates({
    components: [{ id: "u1", ref: "U1", name: "ESP32-C3-MINI-1", properties: {} }],
  } as any);
  assert.equal(esp32c3Result.anchorModel, "ESP32-C3");
  assert.equal(esp32c3Result.candidates.some((item) => item.anchorDeviceModel === "ESP32-C3"), true);

  const stm32f103Result = recallDevboardRagTemplates({
    components: [{ id: "u1", ref: "U1", name: "STM32F103C8T6", properties: {} }],
  } as any);
  assert.equal(stm32f103Result.anchorModel, "STM32F103");
  assert.equal(stm32f103Result.candidates.some((item) => item.anchorDeviceModel === "STM32F103"), true);
});

test("applyDevboardRagCompletion merges high-confidence template parts into the draft plan", () => {
  const completed = applyDevboardRagCompletion({
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
  assert.equal(
    completed.components.some((item) => item.properties?.template_type === "mcu_power_core"),
    true
  );
  assert.equal(
    (completed.ragTemplateSummary?.appliedTemplateIds ?? []).includes("esp32s3-mcu-power-core"),
    true
  );
  assert.deepEqual(completed.ragTemplateSummary?.appliedSourceKinds, ["local_seed"]);
});

test("applyDevboardRagCompletion keeps family fallback templates as suggestions instead of auto-merging", () => {
  const completed = applyDevboardRagCompletion({
    title: "devboard",
    rationale: "test",
    components: [{ id: "u1", ref: "U1", name: "ESP32-WROOM-32", properties: {} }],
    pins: [],
    nets: [{ id: "n-3v3", name: "3V3", nodeIds: [], isPower: true }],
  } as any);

  assert.equal(
    completed.components.some((item) => item.properties?.generated_by === "rag_template"),
    false
  );
  assert.deepEqual(completed.ragTemplateSummary?.appliedTemplateIds ?? [], []);
  assert.equal(
    (completed.ragTemplateSummary?.suggestedTemplateIds ?? []).includes("esp32-family-expansion-header"),
    true
  );
  assert.equal(completed.ragTemplateSummary?.addedComponentCount ?? 0, 0);
  assert.deepEqual(completed.ragTemplateSummary?.suggestedSourceKinds, ["local_seed"]);
});

test("applyDevboardRagCompletion tracks mixed local and external template provenance in summary", () => {
  const externalTemplates = importDevboardRagTemplateCorpus([
    {
      template_id: "external-esp32s3-sensor-header",
      template_type: "expansion_header",
      anchor_device_family: "ESP32",
      anchor_device_model: "ESP32-S3",
      scenario_tags: ["devboard", "expansion", "sensor"],
      components: [
        {
          ref: "J_EXT_SENSOR",
          name: "pin_header",
          value: "1x4",
          completion_role: "sensor_header",
          attach_to_net: "3V3",
        },
      ],
      pin_bindings: [
        {
          component_ref: "J_EXT_SENSOR",
          completion_role: "sensor_header",
          net_name: "3V3",
        },
      ],
      default_values: [
        {
          role: "sensor_header",
          value: "1x4",
        },
      ],
      source: {
        kind: "lceda_open_source_extract",
        project_id: "oshw-esp32s3-sensor",
        sheet_ref: "sheet-a",
        extraction_revision: "2026-04-19-b",
      },
      quality_score: 0.95,
    },
  ]);
  const completed = applyDevboardRagCompletion(
    {
      title: "devboard",
      rationale: "test",
      components: [{ id: "u1", ref: "U1", name: "ESP32-S3-WROOM-1", properties: {} }],
      pins: [],
      nets: [{ id: "n-3v3", name: "3V3", nodeIds: [], isPower: true }],
    } as any,
    { externalTemplates }
  );

  assert.equal((completed.ragTemplateSummary?.appliedTemplateIds ?? []).includes("esp32s3-mcu-power-core"), true);
  assert.equal((completed.ragTemplateSummary?.appliedTemplateIds ?? []).includes("external-esp32s3-sensor-header"), true);
  assert.deepEqual(
    completed.ragTemplateSummary?.appliedSourceKinds?.sort(),
    ["lceda_open_source_extract", "local_seed"]
  );
  assert.equal(
    completed.ragTemplateSummary?.appliedSourceRefs?.includes("lceda_open_source_extract:oshw-esp32s3-sensor/sheet-a"),
    true
  );
});

test("applyDevboardRagCompletion dedupes against real rule-completion role variants for esp32 support parts", () => {
  const completed = applyDevboardRagCompletion({
    title: "dedupe",
    rationale: "test",
    components: [
      { id: "u1", ref: "U1", name: "ESP32-S3", properties: {} },
      {
        id: "c-bulk-existing",
        ref: "C9",
        name: "capacitor",
        value: "10uF",
        properties: {
          generated_by: "rule_completion",
          completion_role: "mcu_bulk_cap",
        },
      },
      {
        id: "r-en-existing",
        ref: "R9",
        name: "resistor",
        value: "10k",
        properties: {
          generated_by: "rule_completion",
          completion_role: "en_pullup",
        },
      },
      {
        id: "c-local-existing",
        ref: "C8",
        name: "capacitor",
        value: "0.1uF",
        properties: {
          generated_by: "rule_completion",
          completion_role: "mcu_decoupling_small",
        },
      },
    ],
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
  assert.equal(
    completed.components.some(
      (item) =>
        item.properties?.generated_by === "rag_template" &&
        item.properties?.completion_role === "mcu_en_rc"
    ),
    true
  );
});

test("getDevboardRagTemplates covers exact ESP32-S3 devboard skeleton stages for usb input, 3v3 ldo, uart download, power indicator, and expansion", () => {
  const templates = getDevboardRagTemplates();
  const esp32s3Templates = templates.filter((item) => item.anchorDeviceModel === "ESP32-S3");

  assert.equal(
    esp32s3Templates.some((item) => item.templateType === "usb_power_input"),
    true
  );
  assert.equal(
    esp32s3Templates.some(
      (item) =>
        item.templateType === "mcu_power_core" &&
        item.scenarioTags.includes("ldo")
    ),
    true
  );
  assert.equal(
    esp32s3Templates.some((item) => item.templateType === "uart_download_header"),
    true
  );
  assert.equal(
    esp32s3Templates.some((item) => item.templateType === "power_indicator"),
    true
  );
  assert.equal(
    esp32s3Templates.some((item) => item.templateType === "expansion_header"),
    true
  );
});

test("getDevboardRagTemplates expands common devboard control and indicator templates across rp2040 and stm32f103", () => {
  const templates = getDevboardRagTemplates();
  const rp2040Templates = templates.filter((item) => item.anchorDeviceModel === "RP2040");
  const stm32f103Templates = templates.filter((item) => item.anchorDeviceModel === "STM32F103");

  assert.equal(
    rp2040Templates.some((item) => item.templateType === "button_reset"),
    true
  );
  assert.equal(
    rp2040Templates.some((item) => item.templateType === "status_indicator"),
    true
  );
  assert.equal(
    stm32f103Templates.some((item) => item.templateType === "button_reset"),
    true
  );
  assert.equal(
    stm32f103Templates.some((item) => item.templateType === "button_boot"),
    true
  );
  assert.equal(
    stm32f103Templates.some((item) => item.templateType === "status_indicator"),
    true
  );
});

test("exportDevboardRagTemplateCorpus exposes structured source metadata for future rag ingestion", () => {
  const corpus = exportDevboardRagTemplateCorpus();
  const esp32s3Power = corpus.find((item) => item.template_id === "esp32s3-mcu-power-core");

  assert.equal(Array.isArray(corpus), true);
  assert.equal((corpus.length ?? 0) > 0, true);
  assert.equal(esp32s3Power?.anchor_device_model, "ESP32-S3");
  assert.equal(esp32s3Power?.source.project_id, "local-devboard-seed");
  assert.equal(esp32s3Power?.source.kind, "local_seed");
  assert.equal(esp32s3Power?.source.extraction_revision, "v1");
  assert.equal(Array.isArray(esp32s3Power?.default_values), true);
  assert.equal(
    esp32s3Power?.default_values?.some((item) => item.role === "mcu_bulk_decoupling" && item.value === "10uF"),
    true
  );
  assert.equal(
    esp32s3Power?.pin_bindings?.some((item) => item.net_name === "3V3" && item.component_ref === "C_AUTO_10U"),
    true
  );
});

test("importDevboardRagTemplateCorpus normalizes external corpus entries and drops malformed records", () => {
  const imported = importDevboardRagTemplateCorpus([
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
      quality_score: 0.88,
    },
    {
      template_id: "broken-template",
      template_type: "unknown_type",
      anchor_device_family: "ESP32",
      components: [],
      source: {
        kind: "lceda_open_source_extract",
        project_id: "broken",
        sheet_ref: "sheet-x",
        extraction_revision: "bad",
      },
      quality_score: 0.5,
    },
  ]);

  assert.equal(imported.length, 1);
  assert.equal(imported[0]?.templateId, "external-esp32c3-status-indicator");
  assert.equal(imported[0]?.templateType, "status_indicator");
  assert.equal(imported[0]?.anchorDeviceModel, "ESP32-C3");
  assert.equal(imported[0]?.source.kind, "lceda_open_source_extract");
  assert.equal(imported[0]?.source.projectId, "oshw-esp32c3-board");
  assert.equal(imported[0]?.components[0]?.completionRole, "status_led");
  assert.equal(imported[0]?.components[0]?.attachToNet, "GPIO8");
});

test("recallDevboardRagTemplates merges local seeds with external corpus candidates", () => {
  const externalTemplates = importDevboardRagTemplateCorpus([
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
      ],
      source: {
        kind: "lceda_open_source_extract",
        project_id: "oshw-esp32c3-board",
        sheet_ref: "sheet-1",
        extraction_revision: "2026-04-19-a",
      },
      quality_score: 0.88,
    },
  ]);

  const result = recallDevboardRagTemplates(
    {
      components: [{ id: "u1", ref: "U1", name: "ESP32-C3-MINI-1", properties: {} }],
    } as any,
    { externalTemplates }
  );

  assert.equal(result.candidates.some((item) => item.templateId === "esp32c3-mcu-power-core"), true);
  assert.equal(result.candidates.some((item) => item.templateId === "external-esp32c3-status-indicator"), true);
});

test("applyDevboardRagCompletion applies high-confidence external templates alongside local seeds", () => {
  const externalTemplates = importDevboardRagTemplateCorpus([
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
  ]);

  const completed = applyDevboardRagCompletion(
    {
      title: "esp32c3-with-external",
      rationale: "test",
      components: [{ id: "u1", ref: "U1", name: "ESP32-C3-MINI-1", properties: {} }],
      pins: [],
      nets: [
        { id: "n-3v3", name: "3V3", nodeIds: [], isPower: true },
        { id: "n-gpio8", name: "GPIO8", nodeIds: [], isPower: false },
      ],
    } as any,
    { externalTemplates }
  );

  assert.equal(
    (completed.ragTemplateSummary?.appliedTemplateIds ?? []).includes("esp32c3-mcu-power-core"),
    true
  );
  assert.equal(
    (completed.ragTemplateSummary?.appliedTemplateIds ?? []).includes("external-esp32c3-status-indicator"),
    true
  );
  assert.equal(
    completed.components.some(
      (item) =>
        item.properties?.generated_by === "rag_template" &&
        item.properties?.template_id === "external-esp32c3-status-indicator"
    ),
    true
  );
});

test("applyDevboardRagCompletion auto-applies newly covered exact ESP32-S3 devboard skeleton templates", () => {
  const completed = applyDevboardRagCompletion({
    title: "esp32s3-devboard",
    rationale: "test",
    components: [{ id: "u1", ref: "U1", name: "ESP32-S3-WROOM-1", properties: {} }],
    pins: [],
    nets: [
      { id: "n-vbus", name: "VBUS", nodeIds: [], isPower: true },
      { id: "n-5v", name: "5V", nodeIds: [], isPower: true },
      { id: "n-3v3", name: "3V3", nodeIds: [], isPower: true },
    ],
  } as any);

  const appliedTemplateIds = completed.ragTemplateSummary?.appliedTemplateIds ?? [];
  assert.equal(appliedTemplateIds.includes("esp32s3-usb-5v-input"), true);
  assert.equal(appliedTemplateIds.includes("esp32s3-3v3-ldo"), true);
  assert.equal(appliedTemplateIds.includes("esp32s3-uart-download-header"), true);
  assert.equal(appliedTemplateIds.includes("esp32s3-power-indicator"), true);
  assert.equal(appliedTemplateIds.includes("esp32s3-expansion-header"), true);

  assert.equal(
    completed.components.some(
      (item) =>
        item.properties?.generated_by === "rag_template" &&
        item.properties?.template_type === "usb_power_input"
    ),
    true
  );
  assert.equal(
    completed.components.some(
      (item) =>
        item.properties?.generated_by === "rag_template" &&
        item.properties?.template_type === "uart_download_header"
    ),
    true
  );
  assert.equal(
    completed.components.some(
      (item) =>
        item.properties?.generated_by === "rag_template" &&
        item.properties?.template_type === "power_indicator"
    ),
    true
  );
  assert.equal(
    completed.components.some(
      (item) =>
        item.properties?.generated_by === "rag_template" &&
        item.properties?.template_type === "expansion_header"
    ),
    true
  );
});

test("applyDevboardRagCompletion auto-applies newly expanded rp2040 and stm32f103 control templates on exact model match", () => {
  const rp2040Completed = applyDevboardRagCompletion({
    title: "rp2040-devboard",
    rationale: "test",
    components: [{ id: "u1", ref: "U1", name: "RP2040", properties: {} }],
    pins: [],
    nets: [
      { id: "n-3v3", name: "3V3", nodeIds: [], isPower: true },
      { id: "n-run", name: "RUN", nodeIds: [], isPower: false },
      { id: "n-led", name: "GPIO25", nodeIds: [], isPower: false },
    ],
  } as any);

  assert.equal(
    (rp2040Completed.ragTemplateSummary?.appliedTemplateIds ?? []).includes("rp2040-reset-button"),
    true
  );
  assert.equal(
    (rp2040Completed.ragTemplateSummary?.appliedTemplateIds ?? []).includes("rp2040-status-indicator"),
    true
  );
  assert.equal(
    rp2040Completed.components.some(
      (item) =>
        item.properties?.generated_by === "rag_template" &&
        item.properties?.template_type === "button_reset"
    ),
    true
  );
  assert.equal(
    rp2040Completed.components.some(
      (item) =>
        item.properties?.generated_by === "rag_template" &&
        item.properties?.template_type === "status_indicator"
    ),
    true
  );

  const stm32Completed = applyDevboardRagCompletion({
    title: "stm32-devboard",
    rationale: "test",
    components: [{ id: "u1", ref: "U1", name: "STM32F103C8T6", properties: {} }],
    pins: [],
    nets: [
      { id: "n-3v3", name: "3V3", nodeIds: [], isPower: true },
      { id: "n-nrst", name: "NRST", nodeIds: [], isPower: false },
      { id: "n-boot0", name: "BOOT0", nodeIds: [], isPower: false },
      { id: "n-pa5", name: "PA5", nodeIds: [], isPower: false },
    ],
  } as any);

  assert.equal(
    (stm32Completed.ragTemplateSummary?.appliedTemplateIds ?? []).includes("stm32f103-reset-button"),
    true
  );
  assert.equal(
    (stm32Completed.ragTemplateSummary?.appliedTemplateIds ?? []).includes("stm32f103-boot-button"),
    true
  );
  assert.equal(
    (stm32Completed.ragTemplateSummary?.appliedTemplateIds ?? []).includes("stm32f103-status-indicator"),
    true
  );
  assert.equal(
    stm32Completed.components.some(
      (item) =>
        item.properties?.generated_by === "rag_template" &&
        item.properties?.template_type === "button_boot"
    ),
    true
  );
});

test("applyDevboardRagCompletion creates placeholder net attachments for rag template parts with attachToNet", () => {
  const completed = applyDevboardRagCompletion({
    title: "esp32s3-net-attachment",
    rationale: "test",
    components: [{ id: "u1", ref: "U1", name: "ESP32-S3-WROOM-1", properties: {} }],
    pins: [],
    nets: [
      { id: "n-vbus", name: "VBUS", nodeIds: [], isPower: true },
      { id: "n-5v", name: "5V", nodeIds: [], isPower: true },
      { id: "n-3v3", name: "3V3", nodeIds: [], isPower: true },
    ],
  } as any);

  const ragAttachedPins = completed.pins.filter((item) =>
    String(item.id).startsWith("rag-pin-")
  );
  assert.equal(ragAttachedPins.length > 0, true);
  assert.equal(ragAttachedPins.some((item) => item.netName === "VBUS"), true);
  assert.equal(ragAttachedPins.some((item) => item.netName === "3V3"), true);

  const vbusNet = completed.nets.find((item) => item.name === "VBUS");
  const powerNet = completed.nets.find((item) => item.name === "3V3");
  assert.equal((vbusNet?.nodeIds ?? []).some((id) => String(id).startsWith("rag-pin-")), true);
  assert.equal((powerNet?.nodeIds ?? []).some((id) => String(id).startsWith("rag-pin-")), true);
});
