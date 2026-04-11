import { test } from "node:test";
import * as assert from "node:assert/strict";

import { buildSystemPrompt } from "../systemPrompt";

test("buildSystemPrompt includes strict DraftDesignSpec guidance for schematic_draft tasks", () => {
  const prompt = buildSystemPrompt({
    task: {
      type: "schematic_draft",
      userQuery: "继续这个方案",
    },
    tools: [
      {
        name: "draft_generate_plan",
        description: "根据用户需求生成最小可用的原理图草案计划",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: true,
        },
      } as any,
    ],
  });

  assert.equal(prompt.includes("## 最小合法 spec 示例"), true);
  assert.equal(prompt.includes("\"components\": ["), true);
  assert.equal(prompt.includes("\"connections\": ["), true);
  assert.equal(prompt.includes("\"pinIds\": ["), true);
  assert.equal(prompt.includes("禁止自造顶层字段替代标准结构"), true);
  assert.equal(prompt.includes("powerNets"), true);
  assert.equal(prompt.includes("signalNets"), true);
  assert.equal(prompt.includes("key_connections"), true);
});
