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
  assert.equal(preview.unresolvedDeviceDetails?.[0]?.includes("no_search_results"), true);
});
