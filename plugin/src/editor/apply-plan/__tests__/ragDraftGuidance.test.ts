import { test } from "node:test";
import * as assert from "node:assert/strict";

import { buildDraftGuidanceFromRag } from "../ragDraftGuidance";
import { generateDraftPlanFromPrompt } from "../generateDraftPlan";
import { previewDraftPlan } from "../previewDraftPlan";

test("buildDraftGuidanceFromRag returns LED indicator template guidance", () => {
  const guidance = buildDraftGuidanceFromRag("帮我设计一个点亮LED的电路", [
    {
      chunk_id: "1",
      score: 0.9,
      title: "LED indicator",
      snippet: "推荐使用 2Pin header、150Ω 限流电阻、红色 LED。",
      source_ref: "kb://led_indicator",
      kb_type: "knowledge",
    },
  ]);

  assert.equal(guidance?.templateId, "led_indicator_minimal");
  assert.equal(guidance?.preferredSearches?.power_connector, "header 1x2 2pin HDR-TH_1X2");
  assert.equal(guidance?.requiredNets?.includes("GND"), true);
  assert.equal(guidance?.evidence?.[0]?.title, "LED indicator");
  assert.equal(guidance?.evidence?.[0]?.sourceRef, "kb://led_indicator");
});

test("buildDraftGuidanceFromRag turns ESP32-S3 voice RAG snippets into draft constraints", () => {
  const guidance = buildDraftGuidanceFromRag("设计一个基于ESP32-S3的带锂电池及充电一体的小智语音聊天设备原理图", [
    {
      chunk_id: "1fc886e4d7863eaa",
      score: 0.659,
      title: "tpl-esp32-s3-component_combo_bundle-b21d026f.md",
      snippet:
        "ESP32-S3 component_combo_bundle template. Components: C18208922, C25744, C25794, C2913202, VBUS -> GND, VBUS -> GND. Pin bindings: EN -> bundle anchor net; IO0 -> bundle anchor net. 连接链:\n- Power: VBUS -> C6 -> GND\n- Power: VBUS -> C7 -> GND",
      source_ref: "tpl-esp32-s3-component_combo_bundle-b21d026f",
      kb_type: "template",
    },
    {
      chunk_id: "85cdeac21c158292",
      score: 0.656,
      title: "tpl-esp32-s3-gpio_passive_power_chain-b3bf3bff.md",
      snippet:
        "ESP32-S3 gpio_passive_power_chain template. Pin bindings: EN -> 3V3 via R8; IO0 -> GND via R1; EN -> GND via R5; IO17 -> 3V3 via R12. 连接链:\n- P1: EN -> R8 -> 3V3\n- P1: IO0 -> R1 -> GND\n- P1: EN -> R5 -> GND",
      source_ref: "tpl-esp32-s3-gpio_passive_power_chain-b3bf3bff",
      kb_type: "template",
    },
  ]);

  assert.equal(guidance?.templateId, "esp32_s3_voice_battery_assistant");
  assert.equal(guidance?.preferredSearches?.mcu, "ESP32-S3-WROOM-1 ESP32-S3 module");
  assert.equal(guidance?.preferredSearches?.charger_powerbank, "IP5306 lithium battery charge boost power management");
  assert.equal(guidance?.preferredSearches?.microphone, "INMP441 I2S MEMS microphone");
  assert.equal(guidance?.requiredNets?.includes("VBUS"), true);
  assert.equal(guidance?.requiredNets?.includes("VBAT"), true);
  assert.equal(guidance?.requiredNets?.includes("I2S_SCK"), true);
  assert.equal(guidance?.requiredConnections?.some((item) => item.netName === "VBUS" && item.toComponentRef === "C6"), true);
  assert.equal(guidance?.requiredConnections?.some((item) => item.netName === "IO0" && item.toComponentRef === "R1"), true);
  assert.equal(guidance?.evidence?.[0]?.sourceRef, "tpl-esp32-s3-component_combo_bundle-b21d026f");
});

test("generateDraftPlanFromPrompt writes RAG preferred searches into component properties", () => {
  const plan = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路", {
    guidance: {
      templateId: "led_indicator_minimal",
      rationale: "test",
      preferredSearches: {
        power_connector: "header 1x2 2pin HDR-TH_1X2",
        resistor: "150Ω resistor R0805",
        led: "red LED 3mm through hole",
      },
    },
  });

  assert.equal(plan.components[0]?.properties.preferred_search_query, "header 1x2 2pin HDR-TH_1X2");
  assert.equal(plan.components[1]?.properties.preferred_search_query, "150Ω resistor R0805");
  assert.equal(plan.components[2]?.properties.preferred_search_query, "red LED 3mm through hole");
});

test("generateDraftPlanFromPrompt uses ESP32-S3 voice guidance for key device searches", () => {
  const plan = generateDraftPlanFromPrompt("设计一个ESP32-S3小智语音聊天设备，带锂电池充电", {
    guidance: {
      templateId: "esp32_s3_voice_battery_assistant",
      rationale: "test",
      preferredSearches: {
        mcu: "ESP32-S3-WROOM-1 ESP32-S3 module",
        charger_powerbank: "IP5306 lithium battery charge boost power management",
        microphone: "INMP441 I2S MEMS microphone",
        audio_amplifier: "NS4168 I2S audio amplifier",
        usb_c_connector: "USB Type-C 16P female connector",
        battery_connector: "JST PH 2P battery connector",
      },
      requiredNets: ["VBUS", "VBAT", "5V", "3V3", "GND", "I2S_SCK", "I2S_LRCK", "I2S_SD", "I2S_DOUT"],
    },
  });

  assert.equal(plan.components.some((component) => component.name?.includes("IP5306")), true);
  assert.equal(
    plan.components.find((component) => component.ref === "U1")?.properties.preferred_search_query,
    "ESP32-S3-WROOM-1 ESP32-S3 module"
  );
  assert.equal(
    plan.components.find((component) => component.ref === "U2")?.properties.preferred_search_query,
    "IP5306 lithium battery charge boost power management"
  );
  assert.equal(plan.pins.some((pin) => pin.netName === "I2S_SCK"), true);
  assert.equal(plan.nets.some((net) => net.name === "VBAT"), true);
});

test("previewDraftPlan includes guidance rationale in the visible summary", () => {
  const plan = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路", {
    guidance: {
      templateId: "led_indicator_minimal",
      rationale: "依据知识库模板，推荐使用 2Pin 电源口 + 150Ω + 红色 LED。",
    },
  });

  const preview = previewDraftPlan(plan);

  assert.equal(preview.rationale.includes("依据知识库模板"), true);
});

test("previewDraftPlan exposes guidance summary for downstream UI rendering", () => {
  const plan = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路", {
    guidance: {
      templateId: "led_indicator_minimal",
      rationale: "依据知识库模板，推荐使用 2Pin 电源口 + 150Ω + 红色 LED。",
      preferredSearches: {
        power_connector: "header 1x2 2pin HDR-TH_1X2",
        resistor: "150Ω resistor R0805",
        led: "red LED 3mm through hole",
      },
      requiredNets: ["5V", "LED_ANODE", "GND"],
      requiredConnections: [
        { fromComponentRef: "J1", fromPin: "1", toComponentRef: "R1", toPin: "1", netName: "5V" },
      ],
      evidence: [
        {
          title: "LED indicator",
          snippet: "推荐使用 2Pin header、150Ω 限流电阻、红色 LED。",
          sourceRef: "kb://led_indicator",
        },
      ],
    },
  });

  const preview = previewDraftPlan(plan);

  assert.equal(preview.guidanceSummary?.templateId, "led_indicator_minimal");
  assert.deepEqual(preview.guidanceSummary?.requiredNets, ["5V", "LED_ANODE", "GND"]);
  assert.equal(
    preview.guidanceSummary?.preferredSearches?.some((item) => item.includes("电源接口")),
    true
  );
  assert.equal(preview.guidanceSummary?.evidence?.[0]?.includes("依据：LED indicator"), true);
  assert.equal(
    preview.guidanceSummary?.evidence?.[0]?.includes("来源：知识条目 led_indicator（kb://led_indicator）"),
    true
  );
});

test("previewDraftPlan exposes selected device details for downstream UI rendering", () => {
  const plan = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路", {
    selectedDevices: [
      {
        role: "power_connector",
        query: "header 1x2 2pin HDR-TH_1X2",
        deviceUuid: "dev-j1",
        libraryUuid: "lib-j1",
        name: "CONN_1X2",
        manufacturer: "LCSC",
        footprintName: "HDR-TH_1X2",
      },
      {
        role: "led",
        query: "red LED 3mm through hole",
        deviceUuid: "dev-d1",
        libraryUuid: "lib-d1",
        name: "红色LED",
        footprintName: "LED-TH_BD3.0-P2.54-FD",
      },
    ],
  });

  const preview = previewDraftPlan(plan);

  assert.equal(preview.selectedDeviceDetails?.[0]?.includes("power_connector"), true);
  assert.equal(preview.selectedDeviceDetails?.[0]?.includes("CONN_1X2"), true);
  assert.equal(preview.selectedDeviceDetails?.[1]?.includes("LED-TH_BD3.0-P2.54-FD"), true);
});

test("previewDraftPlan exposes unresolved device details for downstream UI rendering", () => {
  const plan = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路");
  plan.components[0]!.properties = {
    ...plan.components[0]!.properties,
    preferred_search_query: "header 1x2 2pin HDR-TH_1X2",
    device_resolution_status: "unresolved",
    device_resolution_reason: "no_search_results",
  };

  const preview = previewDraftPlan(plan);

  assert.equal(preview.unresolvedDeviceDetails?.[0]?.includes("J1"), true);
  assert.equal(preview.unresolvedDeviceDetails?.[0]?.includes("暂未自动匹配"), true);
  assert.equal(preview.unresolvedDeviceDetails?.[0]?.includes("header 1x2 2pin HDR-TH_1X2"), true);
});
