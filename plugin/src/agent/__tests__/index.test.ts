import { test } from "node:test";
import * as assert from "node:assert/strict";
import { createPluginAgent } from "../index";
import { runComponentAttributesCheck } from "../../rules/checks/componentAttributesCheck";
import { generateDraftPlanFromPrompt, normalizeDraftPlan } from "../../editor/apply-plan/generateDraftPlan";

function createAgent() {
  return createPluginAgent({
    llmClient: {} as any,
    ragClient: {} as any,
    sessionStore: {} as any,
    customLlmConfigStore: {} as any,
    llmModeStore: {} as any,
    mcpClient: { listResources: () => [], registerTools: () => {} } as any,
  });
}

test("buildAnalysisMessages hides thought/task/final react events from final message", () => {
  const agent = createAgent();
  const messages = agent.buildAnalysisMessages({
    issueCount: 1,
    topIssueTitle: "器件缺少封装信息",
    analysisMarkdown: "## 原理图分析报告\n\n- 问题 A",
    reactEvents: [
      { kind: "task", label: "Task", status: "done", text: "ReAct 第 1 轮", stepKind: "llm" },
      { kind: "thought", label: "Reasoning", status: "done", text: "很长的推理过程", stepKind: "llm" },
      {
        kind: "tool_call",
        label: "Action",
        status: "done",
        text: "editor_get_current_context",
        toolName: "editor_get_current_context",
        stepKind: "context",
      },
      {
        kind: "observation",
        label: "Observation",
        status: "done",
        text: "上下文读取完成",
        outputSummary: "上下文读取完成",
        toolName: "editor_get_current_context",
        stepKind: "context",
      },
      { kind: "final", label: "Finish", status: "done", text: "Final 已输出" },
    ],
    stepStates: [
      { kind: "context", required: true, note: "执行工具：editor_get_current_context", status: "done", observation: "已完成：editor_get_current_context" },
    ],
  });

  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0]?.reactEvents, [
    {
      kind: "tool_call",
      label: "Action",
      status: "done",
      text: "editor_get_current_context",
      toolName: "editor_get_current_context",
      stepKind: "context",
    },
    {
      kind: "observation",
      label: "Observation",
      status: "done",
      text: "上下文读取完成",
      outputSummary: "上下文读取完成",
      toolName: "editor_get_current_context",
      stepKind: "context",
    },
  ]);
});

test("runComponentAttributesCheck treats supplier footprint metadata as valid package info", () => {
  const issues = runComponentAttributesCheck({
    project: { channel: "professional" },
    selection: { objectIds: [] },
    pins: [],
    nets: [],
    components: [
      {
        id: "cmp_r118",
        ref: "R118",
        name: "={Value}",
        value: "1kΩ",
        componentType: "part",
        addIntoBom: true,
        addIntoPcb: true,
        properties: {
          "Supplier Footprint": "0402",
          FootprintName: "R0402",
          Supplier: "LCSC",
        },
      },
    ],
  });

  assert.equal(issues.some((issue) => issue.ruleId === "component.missing-package"), false);
});

test("generateDraftPlanFromPrompt builds LED draft instead of misrouting 5V LED request to LDO", () => {
  const plan = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路，使用5V供电");

  assert.equal(plan.title, "5V LED Indicator Draft");
  assert.equal(plan.components.some((component) => component.ref === "D1"), true);
  assert.equal(plan.components.some((component) => component.ref === "R1"), true);
  assert.equal(plan.components.some((component) => component.ref === "U1"), false);
  assert.deepEqual(plan.nets.map((net) => net.name), ["5V", "LED_ANODE", "GND"]);
  assert.equal(plan.pins.find((pin) => pin.id === "draft-j1-1")?.pinNumber, "1");
  assert.equal(plan.pins.find((pin) => pin.id === "draft-j1-2")?.pinNumber, "2");
  assert.equal(plan.pins.find((pin) => pin.id === "draft-d1-a")?.pinNumber, "1");
  assert.equal(plan.pins.find((pin) => pin.id === "draft-d1-k")?.pinNumber, "2");
});

test("normalizeDraftPlan converts legacy connections into pins and nets", () => {
  const normalized = normalizeDraftPlan({
    title: "5V LED Indicator Draft",
    rationale: "Generated a minimal LED indicator draft based on the user request.",
    components: [
      { id: "draft-j1", ref: "J1", properties: {} },
      { id: "draft-r1", ref: "R1", properties: {} },
      { id: "draft-d1", ref: "D1", properties: {} },
    ],
    connections: [
      { from: "draft-j1", fromPin: "1", to: "draft-r1", toPin: "1", netName: "5V" },
      { from: "draft-r1", fromPin: "2", to: "draft-d1", toPin: "1", netName: "LED_ANODE" },
      { from: "draft-d1", fromPin: "2", to: "draft-j1", toPin: "2", netName: "GND" },
    ],
  } as any);

  assert.equal(normalized.pins.length, 6);
  assert.deepEqual(normalized.nets.map((net) => net.name), ["5V", "LED_ANODE", "GND"]);
  assert.deepEqual(normalized.nets.map((net) => net.nodeIds.length), [2, 2, 2]);
});

test("buildDraftMessages renders guidance and evidence details into structured draft content", () => {
  const agent = createAgent();
  const messages = agent.buildDraftMessages({
    draftPreview: {
      title: "5V LED Indicator Draft",
      rationale: "Generated a minimal LED indicator draft based on the user request.",
      componentRefs: ["J1", "R1", "D1"],
      netNames: ["5V", "LED_ANODE", "GND"],
      componentCount: 3,
      netCount: 3,
      selectedDeviceDetails: [
        "power_connector: CONN_1X2 [HDR-TH_1X2]",
        "led: 红色LED [LED-TH_BD3.0-P2.54-FD]",
      ],
      unresolvedDeviceDetails: [
        "J1 / power_connector: unresolved (no_search_results) query=header 1x2 2pin HDR-TH_1X2",
      ],
      guidanceSummary: {
        templateId: "led_indicator_minimal",
        rationale: "依据知识库模板，推荐使用 2Pin 电源口 + 150Ω + 红色 LED。",
        preferredSearches: [
          "power_connector: header 1x2 2pin HDR-TH_1X2",
          "resistor: 150Ω resistor R0805",
        ],
        requiredNets: ["5V", "LED_ANODE", "GND"],
        requiredConnections: ["J1.1 -> R1.1 @ 5V"],
        evidence: ["LED indicator：推荐使用 2Pin header、150Ω 限流电阻、红色 LED。 (kb://led_indicator)"],
      },
    },
  });

  const structured = messages[0]?.structuredContent ?? [];
  assert.equal(structured.some((block) => block.kind === "kv" && block.title === "生成依据"), true);
  assert.equal(structured.some((block) => block.kind === "list" && block.title === "已选器件详情"), true);
  assert.equal(structured.some((block) => block.kind === "list" && block.title === "待处理器件"), true);
  assert.equal(structured.some((block) => block.kind === "list" && block.title === "器件检索偏好"), true);
  assert.equal(structured.some((block) => block.kind === "list" && block.title === "必需连接约束"), true);
  assert.equal(structured.some((block) => block.kind === "list" && block.title === "RAG 证据"), true);
  assert.deepEqual(messages[0]?.actions?.map((item) => item.action), ["select_devices"]);
});

test("buildNaturalChatMessage shows tool failure details when naturalReply is empty", () => {
  const agent = createAgent();
  const message = agent.buildNaturalChatMessage({
    summary: "unified react agent finished",
    naturalReply: undefined,
    toolTraceNames: [],
    toolTraces: [
      {
        toolName: "rag_build_citations",
        status: "blocked",
        note: "Internal Server Error",
      },
    ],
    executionTraces: [],
    reactEvents: [
      {
        kind: "observation",
        label: "Observation",
        status: "failed",
        text: "Internal Server Error",
        toolName: "rag_build_citations",
        outputSummary: "Internal Server Error",
        stepKind: "mcp",
      },
    ],
    stepStates: [],
    workingMemory: {
      hasContext: true,
      mcpReady: false,
      libraryReady: false,
      llmReady: false,
      rulesReady: false,
      draftReady: false,
    },
  } as any);

  assert.equal(message.content.includes("rag_build_citations"), true);
  assert.equal(message.content.includes("Internal Server Error"), true);
});
