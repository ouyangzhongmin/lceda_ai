import { test } from "node:test";
import * as assert from "node:assert/strict";
import { createPluginAgent, resolveTurnDisposition } from "../index";
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

test("generateDraftPlanFromPrompt keeps ESP32-S3 voice device requests from falling back to LDO", () => {
  const plan = generateDraftPlanFromPrompt(
    "设计一个基于ESP32-S3的带锂电池及充电一体的小智AI语音聊天设备原理图。包含 USB 5V、3.3V 稳压、麦克风和功放。"
  );

  assert.equal(plan.title, "ESP32-S3 Voice Device Draft");
  assert.equal(plan.components.some((component) => /ESP32-S3/i.test(component.name ?? "")), true);
  assert.equal(plan.components.some((component) => /INMP441/i.test(component.name ?? "")), true);
  assert.equal(plan.components.some((component) => component.properties.role === "audio_amplifier"), true);
  assert.equal(plan.components.some((component) => /USB[-\s]?Type-C|Type-C/i.test(component.name ?? "")), true);
  assert.equal(plan.nets.some((net) => net.name === "I2S_DOUT"), true);
  assert.notEqual(String(plan.title), "5V to 3.3V LDO Draft");
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
          "电源接口：header 1x2 2pin HDR-TH_1X2",
          "限流电阻：150Ω resistor R0805",
        ],
        requiredNets: ["5V", "LED_ANODE", "GND"],
        requiredConnections: ["J1.1 -> R1.1 @ 5V"],
        evidence: ["依据：LED indicator。要点：推荐使用 2Pin header、150Ω 限流电阻、红色 LED。。来源：kb://led_indicator"],
      },
    },
  });

  const structured = messages[0]?.structuredContent ?? [];
  assert.equal(structured.some((block) => block.kind === "section" && block.title === "这版方案"), true);
  assert.equal(structured.some((block) => block.kind === "list" && block.title === "关键模块与器件"), true);
  assert.equal(structured.some((block) => block.kind === "list" && block.title === "待确认项"), true);
  assert.equal(structured.some((block) => block.kind === "kv" && block.title === "当前状态"), true);
  assert.equal(structured.some((block) => block.kind === "list" && block.title === "补充依据"), true);
  assert.deepEqual(messages[0]?.actions?.map((item) => item.action), ["select_devices"]);
});

test("buildDraftMessages humanizes internal draft role labels for user-facing device details", () => {
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
    },
  });

  const structured = messages[0]?.structuredContent ?? [];
  const selectedBlock = structured.find((block) => block.kind === "list" && block.title === "关键模块与器件");
  const unresolvedBlock = structured.find((block) => block.kind === "list" && block.title === "待确认项");

  const selectedItems = selectedBlock && selectedBlock.kind === "list" ? selectedBlock.items : [];
  const unresolvedItems = unresolvedBlock && unresolvedBlock.kind === "list" ? unresolvedBlock.items : [];

  assert.equal(selectedItems.some((item) => item.includes("电源输入接口")), true);
  assert.equal(selectedItems.some((item) => item.includes("用于接入外部电源")), true);
  assert.equal(selectedItems.some((item) => item.includes("power_connector")), false);
  assert.equal(unresolvedItems.some((item) => item.includes("J1 电源输入接口")), true);
  assert.equal(unresolvedItems.some((item) => item.includes("power_connector")), false);
});

test("buildDraftMessages includes markdown detail report alongside structured summary", () => {
  const agent = createAgent();
  const messages = agent.buildDraftMessages({
    draftPreview: {
      title: "ESP32-S3 Voice Draft",
      rationale: "Portable voice chat device draft.",
      componentRefs: ["U1", "U2", "U3"],
      netNames: ["5V", "VBAT", "3V3", "GND"],
      componentCount: 3,
      netCount: 4,
      selectedDeviceDetails: [
        "mcu_module: ESP32-S3-WROOM-1U",
        "charger: TP4056",
      ],
    },
    draftRisk: {
      level: "warning",
      issueCount: 2,
      highSeverityCount: 0,
      message: "存在待确认连接，暂不建议直接应用。",
    },
    nextSuggestions: ["先检查电源链路", "确认音频器件选型"],
  });

  assert.equal(typeof messages[0]?.reportMarkdown, "string");
  assert.equal(messages[0]?.reportMarkdown?.includes("## 草案范围"), true);
  assert.equal(messages[0]?.reportMarkdown?.includes("## 关键器件"), true);
  assert.equal(messages[0]?.reportMarkdown?.includes("## 主要网络"), true);
  assert.equal(messages[0]?.reportMarkdown?.includes("## 下一步"), true);
});

test("buildDraftMessages keeps next-step narrative aligned with blocked rerun-only actions", () => {
  const agent = createAgent();
  const messages = agent.buildDraftMessages({
    draftPreview: {
      title: "ESP32-S3 Voice Draft",
      rationale: "Portable voice chat device draft.",
      componentRefs: ["U1", "U2", "U3"],
      netNames: ["5V", "VBAT", "3V3", "GND"],
      componentCount: 3,
      netCount: 4,
    },
    draftRisk: {
      level: "blocked",
      issueCount: 2,
      highSeverityCount: 1,
      message: "存在阻断项，当前不能直接应用。",
    },
  });

  assert.deepEqual(messages[0]?.actions?.map((item) => item.action), ["rerun"]);
  assert.equal(messages[0]?.content?.includes("点击“应用草案”"), false);
  assert.equal(messages[0]?.content?.includes("点击卡片底部的“重新分析”"), true);
  assert.equal(messages[0]?.reportMarkdown?.includes("点击卡片底部的“重新分析”"), true);
});

test("buildDraftMessages keeps next-step narrative aligned with apply actions", () => {
  const agent = createAgent();
  const messages = agent.buildDraftMessages({
    draftPreview: {
      title: "ESP32-S3 Voice Draft",
      rationale: "Portable voice chat device draft.",
      componentRefs: ["U1", "U2", "U3"],
      netNames: ["5V", "VBAT", "3V3", "GND"],
      componentCount: 3,
      netCount: 4,
    },
  });

  assert.deepEqual(messages[0]?.actions?.map((item) => item.action), ["apply_draft", "rollback"]);
  assert.equal(messages[0]?.content?.includes("点击“应用草案”"), true);
  assert.equal(messages[0]?.content?.includes("重新分析"), false);
  assert.equal(messages[0]?.reportMarkdown?.includes("点击“应用草案”"), true);
});

test("buildDraftMessages prefers select devices over blocked rerun when devices are unresolved", () => {
  const agent = createAgent();
  const messages = agent.buildDraftMessages({
    draftNarrative: [
      "# 草案",
      "",
      "## 如何应用草案",
      "1. 点击「应用草案」按钮",
      "2. 系统将自动放置 26 个已匹配器件并完成网络标签连接",
      "如果找不到应用按钮，请按 Ctrl+D。",
    ].join("\n"),
    draftPreview: {
      title: "ESP32-S3 Voice Draft",
      rationale: "Portable voice chat device draft.",
      componentRefs: ["U1", "U5", "J1"],
      netNames: ["5V", "VBAT", "3V3", "GND"],
      componentCount: 31,
      netCount: 12,
      unresolvedDeviceDetails: [
        "U5 / microphone: unresolved (no_search_results) query=INMP441",
        "J1 / power_connector: unresolved (no_search_results) query=TYPE-C 16PIN",
      ],
    },
    draftRisk: {
      level: "blocked",
      issueCount: 2,
      highSeverityCount: 2,
      message: "存在未确认器件，暂不允许直接应用。",
    },
  });

  assert.deepEqual(messages[0]?.actions?.map((item) => item.action), ["select_devices"]);
  assert.equal(messages[0]?.content?.includes("点击「应用草案」"), false);
  assert.equal(messages[0]?.content?.includes("Ctrl+D"), false);
  assert.equal(messages[0]?.content?.includes("点击“选择器件”"), true);
});

test("buildDraftMessages prefers draftNarrative as the lead answer when present", () => {
  const agent = createAgent();
  const messages = agent.buildDraftMessages({
    draftNarrative: "先回答：当前器件只有 4 个，是因为上一版只是占位级最小草案。",
    draftPreview: {
      title: "ESP32-S3 Voice Draft",
      rationale: "Portable voice chat device draft.",
      componentRefs: ["U1", "U2", "U3"],
      netNames: ["5V", "VBAT", "3V3", "GND"],
      componentCount: 3,
      netCount: 4,
    },
  });

  assert.equal(
    messages[0]?.content?.startsWith("先回答：当前器件只有 4 个"),
    true
  );
});

test("buildDraftMessages shows follow-up answer as the lead paragraph for draft follow-up replies", () => {
  const agent = createAgent();
  const messages = agent.buildDraftMessages({
    draftNarrative: "先回答：J1 / power_connector 通常是电源输入连接器，用于把外部 5V 接入充电与供电链路。",
    draftPreview: {
      title: "ESP32-S3 Voice Draft",
      rationale: "Portable voice chat device draft.",
      componentRefs: ["J1", "U1", "U2"],
      netNames: ["5V", "VBAT", "3V3", "GND"],
      componentCount: 3,
      netCount: 4,
    },
  });

  assert.equal(
    messages[0]?.content?.startsWith("先回答：J1 / power_connector 通常是电源输入连接器"),
    true
  );
  assert.equal(messages[0]?.content?.includes("我已经生成一版草案。"), false);
});

test("buildDraftMessages prefers full markdown draft content over structured summary cards", () => {
  const agent = createAgent();
  const markdownDraft = `# ESP32-S3 小智语音聊天设备原理图草案

## 草案概述
已成功生成基于 ESP32-S3 的便携式语音聊天设备原理图草案。

## 关键器件配置
- 主控：ESP32-S3
- 充电：TP4056
- 电池：单节锂电池`;

  const messages = agent.buildDraftMessages({
    draftNarrative: markdownDraft,
    draftPreview: {
      title: "ESP32-S3 Voice Draft",
      rationale: "Portable voice chat device draft.",
      componentRefs: ["U1", "U2", "BT1"],
      netNames: ["5V", "VBAT", "3V3", "GND"],
      componentCount: 3,
      netCount: 4,
    },
  });

  assert.equal(messages[0]?.content?.startsWith(markdownDraft), true);
  assert.equal(messages[0]?.content?.includes("## 当前可用操作"), true);
  assert.equal(messages[0]?.structuredContent, undefined);
  assert.equal(messages[0]?.reportMarkdown, undefined);
});

test("buildDraftMessages keeps summary rationale concise when preview rationale contains fallback chatter", () => {
  const agent = createAgent();
  const messages = agent.buildDraftMessages({
    draftPreview: {
      title: "ESP32-S3 Voice Draft",
      rationale:
        "便携式语音聊天设备，集成锂电池充电管理、音频输入输出和无线连接。 已检索到知识依据，但未匹配到专用草案模板，回退到通用草案生成。 已选器件: mcu=ESP32-S3, charger=TP4056, codec=WM8960",
      componentRefs: ["U1", "U2", "U3"],
      netNames: ["5V", "VBAT", "3V3", "GND"],
      componentCount: 3,
      netCount: 4,
    },
  });

  const summaryBlock = (messages[0]?.structuredContent ?? []).find(
    (block) => block.kind === "section" && block.title === "这版方案"
  );
  const rationaleValue =
    summaryBlock && summaryBlock.kind === "section"
      ? String(summaryBlock.text || "").split("\n").slice(1).join("\n").trim()
      : "";

  assert.equal(rationaleValue, "便携式语音聊天设备，集成锂电池充电管理、音频输入输出和无线连接。");
});

test("buildDraftMessages truncates summary lists for components and nets", () => {
  const agent = createAgent();
  const messages = agent.buildDraftMessages({
    draftPreview: {
      title: "ESP32-S3 Voice Draft",
      rationale: "Portable voice chat device draft.",
      componentRefs: ["U1", "U2", "U3", "U4", "U5", "U6"],
      netNames: ["5V", "VBAT", "3V3", "GND", "I2C_SDA", "I2C_SCL"],
      componentCount: 6,
      netCount: 6,
    },
  });

  const structured = messages[0]?.structuredContent ?? [];
  const componentBlock = structured.find((block) => block.kind === "list" && block.title === "关键模块与器件");
  const netBlock = structured.find((block) => block.kind === "list" && block.title === "关键网络");

  assert.deepEqual(
    componentBlock && componentBlock.kind === "list" ? componentBlock.items : [],
    ["U1", "U2", "U3", "另有 3 个器件未展开"]
  );
  assert.deepEqual(
    netBlock && netBlock.kind === "list" ? netBlock.items : [],
    ["5V 外部输入电源", "VBAT 电池电源", "3V3 主系统 3.3V 电源", "GND 地线", "另有 2 条网络未展开"]
  );
});

test("buildDraftMessages prefers ref plus readable device name in component summary when device details exist", () => {
  const agent = createAgent();
  const messages = agent.buildDraftMessages({
    draftPreview: {
      title: "ESP32-S3 Voice Draft",
      rationale: "Portable voice chat device draft.",
      componentRefs: ["J1", "U1", "U2"],
      netNames: ["5V", "VBAT", "3V3", "GND"],
      componentCount: 3,
      netCount: 4,
      selectedDeviceDetails: [
        "power_connector: USB-C 电源座 [TYPE-C]",
        "mcu_module: ESP32-S3-WROOM-1U [WIRELM-SMD_ESP32-S3-WROOM-1U]",
        "charger: TP4056 [ESOP-8]",
      ],
    },
  });

  const structured = messages[0]?.structuredContent ?? [];
  const componentBlock = structured.find((block) => block.kind === "list" && block.title === "关键模块与器件");
  const componentItems = componentBlock && componentBlock.kind === "list" ? componentBlock.items : [];

  assert.equal(componentItems.some((item) => item.includes("电源输入接口：USB-C 电源座")), true);
  assert.equal(componentItems.some((item) => item.includes("主控模块：ESP32-S3-WROOM-1U")), true);
  assert.equal(componentItems.some((item) => item.includes("锂电池充电芯片：TP4056")), true);
  assert.equal(messages[0]?.content?.includes("器件：J1 电源输入接口、U1 主控模块、U2 锂电池充电芯片"), true);
  assert.equal(messages[0]?.reportMarkdown?.includes("- J1 电源输入接口"), true);
});

test("buildDraftMessages humanizes common network names for user-facing summaries", () => {
  const agent = createAgent();
  const messages = agent.buildDraftMessages({
    draftPreview: {
      title: "ESP32-S3 Voice Draft",
      rationale: "Portable voice chat device draft.",
      componentRefs: ["J1", "U1", "U2"],
      netNames: ["5V", "VBAT", "3V3", "GND"],
      componentCount: 3,
      netCount: 4,
      selectedDeviceDetails: [
        "power_connector: USB-C 电源座 [TYPE-C]",
        "mcu_module: ESP32-S3-WROOM-1U [WIRELM-SMD_ESP32-S3-WROOM-1U]",
        "charger: TP4056 [ESOP-8]",
      ],
    },
  });

  const structured = messages[0]?.structuredContent ?? [];
  const netBlock = structured.find((block) => block.kind === "list" && block.title === "关键网络");
  const netItems = netBlock && netBlock.kind === "list" ? netBlock.items : [];

  assert.deepEqual(netItems, [
    "5V 外部输入电源",
    "VBAT 电池电源",
    "3V3 主系统 3.3V 电源",
    "GND 地线",
  ]);
  assert.equal(messages[0]?.content?.includes("网络：5V 外部输入电源、VBAT 电池电源、3V3 主系统 3.3V 电源、GND 地线"), true);
  assert.equal(messages[0]?.reportMarkdown?.includes("- VBAT 电池电源"), true);
});

test("buildDraftMessages provides default follow-up suggestions for draft confirmation", () => {
  const agent = createAgent();
  const messages = agent.buildDraftMessages({
    draftPreview: {
      title: "ESP32-S3 Voice Draft",
      rationale: "Portable voice chat device draft.",
      componentRefs: ["U1", "U2", "U3"],
      netNames: ["5V", "VBAT", "3V3", "GND"],
      componentCount: 3,
      netCount: 4,
    },
  });

  assert.deepEqual(messages[0]?.suggestions, [
    {
      label: "列主要器件",
      actionType: "ask_followup",
      prompt: "给我列一下这版草案使用的主要元器件和各自作用",
    },
    {
      label: "说明风险",
      actionType: "ask_followup",
      prompt: "这版草案还有哪些阻断风险，为什么现在不能直接应用？",
    },
    {
      label: "继续修改草案",
      actionType: "ask_followup",
      prompt: "基于当前这版草案，不要重做整体方案，只修改我接下来指出的部分",
    },
  ]);
});

test("buildDraftMessages preserves provided structured suggestions", () => {
  const agent = createAgent();
  const providedSuggestions = [
    {
      label: "查看风险",
      actionType: "ask_followup" as const,
      prompt: "总结当前风险",
    },
  ];
  const messages = agent.buildDraftMessages({
    draftPreview: {
      title: "ESP32-S3 Voice Draft",
      rationale: "Portable voice chat device draft.",
      componentRefs: ["U1", "U2", "U3"],
      netNames: ["5V", "VBAT", "3V3", "GND"],
      componentCount: 3,
      netCount: 4,
    },
    structuredSuggestions: providedSuggestions,
  });

  assert.deepEqual(messages[0]?.suggestions, providedSuggestions);
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

test("resolveTurnDisposition prefers explicit schematic_draft over result fallback", () => {
  const disposition = resolveTurnDisposition("schematic_draft", {
    summary: "ok",
    toolTraceNames: [],
    naturalReply: "只是聊天文本",
  } as any);

  assert.equal(disposition.route, "draft");
});

test("resolveTurnDisposition prefers explicit schematic_analysis over result fallback", () => {
  const disposition = resolveTurnDisposition("schematic_analysis", {
    summary: "ok",
    toolTraceNames: [],
    naturalReply: "只是聊天文本",
  } as any);

  assert.equal(disposition.route, "analysis");
});

test("resolveTurnDisposition uses result fallback for natural_chat", () => {
  const disposition = resolveTurnDisposition("natural_chat", {
    summary: "ok",
    toolTraceNames: [],
    draftPreview: {
      title: "draft",
      rationale: "draft",
      componentRefs: [],
      netNames: [],
      componentCount: 0,
      netCount: 0,
    },
  } as any);

  assert.equal(disposition.route, "draft");
});

test("resolveTurnDisposition uses modify fallback when result is an existing-schematic modification", () => {
  const disposition = resolveTurnDisposition("natural_chat", {
    summary: "ok",
    toolTraceNames: [],
    selectedSkill: "modify_existing_schematic",
    analysisMarkdown: "已整理当前图修改方案",
  } as any);

  assert.equal(disposition.route, "modify");
});
