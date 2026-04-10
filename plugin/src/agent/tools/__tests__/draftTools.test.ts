import { test } from "node:test";
import * as assert from "node:assert/strict";

import { createDraftTools } from "../draftTools";

test("createDraftTools injects RAG guidance into draft generation when guidance is omitted", async () => {
  let buildCitationsCalled = false;
  const tools = createDraftTools({
    search: async () => ({
      results: [
        {
          chunk_id: "1",
          score: 0.9,
          title: "LED indicator",
          snippet: "推荐使用 2Pin header、150Ω 限流电阻、红色 LED。",
          source_ref: "kb://led",
          kb_type: "knowledge",
        },
      ],
    }),
    buildCitations: async () => ({
      ...(buildCitationsCalled = true, {}),
      query: "帮我设计一个点亮LED的电路 电路模板 器件选择 连接约束",
      results: [
        {
          chunk_id: "1",
          score: 0.9,
          title: "LED indicator",
          snippet: "推荐使用 2Pin header、150Ω 限流电阻、红色 LED。",
          source_ref: "kb://led-citation",
          kb_type: "knowledge",
        },
      ],
    }),
  } as any);
  const tool = tools.find((item) => item.name === "draft_generate_plan");
  if (!tool) throw new Error("draft_generate_plan missing");

  const plan = await tool.execute({ userQuery: "帮我设计一个点亮LED的电路" });

  assert.equal(plan.guidance?.templateId, "led_indicator_minimal");
  assert.equal(plan.components[0]?.properties.preferred_search_query, "header 1x2 2pin HDR-TH_1X2");
  assert.equal(buildCitationsCalled, true);
  assert.equal(plan.guidance?.evidence?.some((item) => item.sourceRef === "kb://led-citation"), true);
});

test("createDraftTools resolves concrete library devices before preview when search is available", async () => {
  const tools = createDraftTools(
    {
      search: async () => ({ results: [] }),
      buildCitations: async () => ({ query: "", results: [] }),
    } as any,
    async (input) => {
      if (input.query.includes("header")) {
        return [
          {
            uuid: "dev-j1",
            name: "CONN_1X2",
            libraryUuid: "lib-j1",
            symbolUuid: "sym-j1",
            footprintUuid: "fp-j1",
            footprintName: "HDR-TH_1X2",
          },
        ];
      }
      if (input.query.includes("150")) {
        return [
          {
            uuid: "dev-r1",
            name: "0805W8F1500T5E",
            libraryUuid: "lib-r1",
            symbolUuid: "sym-r1",
            footprintUuid: "fp-r1",
            footprintName: "R0805",
          },
        ];
      }
      return [
        {
          uuid: "dev-d1",
          name: "红色LED",
          libraryUuid: "lib-d1",
          symbolUuid: "sym-d1",
          footprintUuid: "fp-d1",
          footprintName: "LED-TH_BD3.0-P2.54-FD",
        },
      ];
    }
  );
  const tool = tools.find((item) => item.name === "draft_generate_plan");
  if (!tool) throw new Error("draft_generate_plan missing");

  const plan = await tool.execute({ userQuery: "帮我设计一个点亮LED的电路" });

  assert.equal(plan.selectedDevices?.length, 3);
  assert.equal(plan.components[0]?.properties.device_uuid, "dev-j1");
  assert.equal(plan.components[1]?.properties.device_uuid, "dev-r1");
  assert.equal(plan.components[2]?.properties.device_uuid, "dev-d1");
});
