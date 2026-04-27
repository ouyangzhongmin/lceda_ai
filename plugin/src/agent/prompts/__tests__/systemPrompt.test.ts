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
  assert.equal(prompt.includes("待确认器件"), true);
  assert.equal(prompt.includes("元件库中直接检索"), true);
  assert.equal(prompt.includes("禁止把 `generic`"), true);
  assert.equal(prompt.includes("连接器/电池接口"), true);
});

test("buildSystemPrompt includes existing draft follow-up instructions when draft summary mode is enabled", () => {
  const prompt = buildSystemPrompt({
    task: {
      type: "natural_chat",
      userQuery: "给我生成一个列表展示用哪些主要的元器件",
      draftFollowUpIntent: "summarize_existing_draft",
      existingDraftSummary: {
        title: "ESP32-S3 语音设备",
        rationale: "已有草案",
        componentRefs: ["U1", "U2", "J1"],
        netNames: ["5V", "VBAT", "3V3"],
        componentCount: 3,
        netCount: 3,
      },
    },
    tools: [
      {
        name: "draft_generate_plan",
        description: "根据用户需求生成最小可用的原理图草案计划",
        parameters: { type: "object", properties: {}, additionalProperties: true },
      } as any,
    ],
  });

  assert.equal(prompt.includes("## 现有草案追问任务定义"), true);
  assert.equal(prompt.includes("不是重新生成草案"), true);
  assert.equal(prompt.includes("不要调用 `draft_generate_plan`"), true);
  assert.equal(prompt.includes("器件位号：U1、U2、J1"), true);
});

test("buildSystemPrompt includes existing draft revision instructions when draft revise mode is enabled", () => {
  const prompt = buildSystemPrompt({
    task: {
      type: "natural_chat",
      userQuery: "在当前草案上增加电量计模块",
      draftFollowUpIntent: "revise_existing_draft",
      existingDraftSummary: {
        title: "ESP32-S3 语音设备",
        rationale: "已有草案",
        componentRefs: ["U1", "U2", "J1"],
        netNames: ["5V", "VBAT", "3V3"],
      },
    },
    tools: [
      {
        name: "draft_generate_plan",
        description: "根据用户需求生成最小可用的原理图草案计划",
        parameters: { type: "object", properties: {}, additionalProperties: true },
      } as any,
    ],
  });

  assert.equal(prompt.includes("## 现有草案修改任务定义"), true);
  assert.equal(prompt.includes("不是从零开始重新构思全部系统"), true);
  assert.equal(prompt.includes("可进入 `draft_generate_plan`"), true);
});

test("buildSystemPrompt includes existing draft risk analysis instructions when follow-up intent is risk review", () => {
  const prompt = buildSystemPrompt({
    task: {
      type: "natural_chat",
      userQuery: "这版草案还有哪些风险，为什么不能直接应用？",
      draftFollowUpIntent: "analyze_existing_draft_risk",
      existingDraftSummary: {
        title: "ESP32-S3 语音设备",
        rationale: "已有草案",
        componentRefs: ["U1", "U2", "J1"],
        netNames: ["5V", "VBAT", "3V3"],
      },
    },
    tools: [
      {
        name: "rules_validate_draft",
        description: "在应用前校验生成的原理图草案",
        parameters: { type: "object", properties: {}, additionalProperties: true },
      } as any,
    ],
  });

  assert.equal(prompt.includes("## 现有草案风险复核任务定义"), true);
  assert.equal(prompt.includes("可调用 `rules_validate_draft`"), true);
  assert.equal(prompt.includes("不要无必要重新调用 `draft_generate_plan`"), true);
});

test("buildSystemPrompt includes existing draft repair instructions when follow-up intent is repair", () => {
  const prompt = buildSystemPrompt({
    task: {
      type: "natural_chat",
      userQuery: "这版草案应用失败了，补齐缺失网络再试一次",
      draftFollowUpIntent: "repair_existing_draft" as any,
      existingDraftSummary: {
        title: "ESP32-S3 语音设备",
        rationale: "已有草案",
        componentRefs: ["U1", "U2", "J1"],
        netNames: ["5V", "VBAT", "3V3"],
      },
    },
    tools: [
      {
        name: "draft_repair_plan",
        description: "基于结构化应用错误修补草案",
        parameters: { type: "object", properties: {}, additionalProperties: true },
      } as any,
    ],
  });

  assert.equal(prompt.includes("## 现有草案修复任务定义"), true);
  assert.equal(prompt.includes("优先调用 `draft_repair_plan`"), true);
  assert.equal(prompt.includes("而不是整版重新生成"), true);
  assert.equal(prompt.includes("结构化应用错误"), true);
  assert.equal(prompt.includes("editor_preview_apply_plan"), false);
});

test("buildSystemPrompt includes preferred output language guidance", () => {
  const prompt = buildSystemPrompt({
    task: {
      type: "natural_chat",
      userQuery: "解释一下这个模块",
      preferredOutputLanguage: "zh-CN",
    },
    tools: [],
  });

  assert.equal(prompt.includes("用户可见输出默认使用 zh-CN"), true);
  assert.equal(prompt.includes("若模型会输出思考摘要或 reasoning，也应尽量使用 zh-CN"), true);
});
