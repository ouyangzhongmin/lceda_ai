import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  applyCustomLlmConfigSavedState,
  appendAssistantMessages,
  appendUserChatMessage,
  buildDraftApplyUnavailableMessage,
  buildDevicePickerApplyProgressText,
  buildDevicePickerCandidatePresentation,
  buildDevicePickerSearchProgressText,
  buildDevicePickerReasonLabel,
  buildDevicePickerRoleLabel,
  deriveSessionHistoryEntries,
  finalizeDraftTurnMessages,
  formatDraftApplyErrorMessage,
  hasUnresolvedDraftDevices,
  inferDraftComponentRole,
  mergeAssistantFinalMessage,
  normalizeDevicePickerCandidates,
  stripFinalControlLikeText,
  shouldStopRunningTurnFromComposer,
  shouldAutoApplyDraftFromChatInput,
  shouldIgnoreDuplicateSendWhileRunning,
  shouldUseDraftReplyLeadNarrative,
} from "../assistantRuntime";
import { getAssistantCardLayout } from "../assistantCardLayout";
import type { MainPanelState } from "../../ui/panels/mainPanel";
import { previewDraftPlan } from "../../editor/apply-plan/previewDraftPlan";

test("shouldIgnoreDuplicateSendWhileRunning returns true for the same pending prompt in an active turn", () => {
  assert.equal(
    shouldIgnoreDuplicateSendWhileRunning({
      trimmedInput: "帮我设计一个点亮LED的电路",
      pendingChatInput: "帮我设计一个点亮LED的电路",
      activeTurnId: 1,
      agentRunState: "waiting_llm",
    }),
    true
  );
});

test("shouldIgnoreDuplicateSendWhileRunning returns false for a different prompt", () => {
  assert.equal(
    shouldIgnoreDuplicateSendWhileRunning({
      trimmedInput: "帮我设计一个点亮LED的电路",
      pendingChatInput: "检查这个原理图",
      activeTurnId: 1,
      agentRunState: "waiting_llm",
    }),
    false
  );
});

test("shouldIgnoreDuplicateSendWhileRunning returns false when no turn is active", () => {
  assert.equal(
    shouldIgnoreDuplicateSendWhileRunning({
      trimmedInput: "帮我设计一个点亮LED的电路",
      pendingChatInput: "帮我设计一个点亮LED的电路",
      activeTurnId: undefined,
      agentRunState: "idle",
    }),
    false
  );
});

test("shouldIgnoreDuplicateSendWhileRunning returns true during planning when the latest user message already matches", () => {
  assert.equal(
    shouldIgnoreDuplicateSendWhileRunning({
      trimmedInput: "帮我设计一个点亮LED的电路",
      pendingChatInput: undefined,
      activeTurnId: undefined,
      agentRunState: "planning",
      lastUserMessageContent: "帮我设计一个点亮LED的电路",
    }),
    true
  );
});

test("shouldStopRunningTurnFromComposer returns true while a turn is running", () => {
  assert.equal(
    shouldStopRunningTurnFromComposer({
      agentRunState: "waiting_llm",
      activeTurnId: 1,
    }),
    true
  );
});

test("shouldStopRunningTurnFromComposer returns false when no turn is active", () => {
  assert.equal(
    shouldStopRunningTurnFromComposer({
      agentRunState: "idle",
      activeTurnId: undefined,
    }),
    false
  );
});

test("finalizeDraftTurnMessages replaces the pending assistant without duplicating previous user messages", () => {
  const previousMessages = [
    { role: "user" as const, title: "你", content: "帮我设计一个点亮LED的电路" },
    { role: "assistant" as const, title: "草案生成中", content: "", streaming: true },
  ];

  const draftMessages = [
    { role: "assistant" as const, title: "需关注", content: "草案生成完成，但未返回预览信息。", tone: "warning" as const },
  ];

  const finalMessages = finalizeDraftTurnMessages(previousMessages, draftMessages);
  assert.equal(finalMessages.length, 2);
  assert.equal(finalMessages[0]?.role, "user");
  assert.equal(finalMessages[0]?.content, "帮我设计一个点亮LED的电路");
  assert.equal(finalMessages[1]?.role, "assistant");
  assert.equal(finalMessages[1]?.title, "需关注");
  assert.equal(finalMessages[1]?.content, "草案生成完成，但未返回预览信息。");
  assert.equal(finalMessages[1]?.tone, "warning");
});

test("shouldAutoApplyDraftFromChatInput returns true for confirm-like input in awaiting_confirmation state", () => {
  assert.equal(
    shouldAutoApplyDraftFromChatInput({
      agentRunState: "awaiting_confirmation",
      input: "确认",
      hasDraftPlan: true,
      draftBlocked: false,
    }),
    true
  );
});

test("shouldAutoApplyDraftFromChatInput returns false when no draft is pending confirmation", () => {
  assert.equal(
    shouldAutoApplyDraftFromChatInput({
      agentRunState: "completed",
      input: "确认",
      hasDraftPlan: true,
      draftBlocked: false,
    }),
    false
  );
});

test("formatDraftApplyErrorMessage converts empty-page guard errors into actionable guidance", () => {
  assert.equal(
    formatDraftApplyErrorMessage(new Error('draft apply requires an empty schematic page: current page "Sheet 1" already has content')),
    "应用草案失败：当前原理图页“Sheet 1”已有内容。请先新建空白原理图页，再重新应用草案。"
  );
});

test("formatDraftApplyErrorMessage keeps generic errors readable", () => {
  assert.equal(
    formatDraftApplyErrorMessage(new Error("unmapped required nets: 5V (draft-j1-vbus)")),
    "应用草案失败：unmapped required nets: 5V (draft-j1-vbus)"
  );
});

test("formatDraftApplyErrorMessage converts unresolved placement device errors into actionable guidance", () => {
  assert.equal(
    formatDraftApplyErrorMessage(
      new Error("typed placement requires all draft components to have resolved devices: B1, U3")
    ),
    "应用草案失败：以下器件还没有完成可放置器件选型：B1、U3。请先完成器件确认，再重新应用草案。"
  );
});

test("draft confirmation follow-up summary requests should not auto-apply", () => {
  assert.equal(
    shouldAutoApplyDraftFromChatInput({
      agentRunState: "awaiting_confirmation",
      input: "给我生成一个列表展示用哪些主要的元器件",
      hasDraftPlan: true,
      draftBlocked: false,
    }),
    false
  );
});

test("shouldUseDraftReplyLeadNarrative falls back to naturalReply when draftNarrative is empty", () => {
  assert.equal(
    shouldUseDraftReplyLeadNarrative({
      draftNarrative: undefined,
      naturalReply: "先回答：J1 / power_connector 是外部电源输入接口。",
    }),
    "先回答：J1 / power_connector 是外部电源输入接口。"
  );
});

test("appendAssistantMessages preserves prior chat history when adding apply result", () => {
  const history = [
    { role: "user" as const, title: "你", content: "帮我设计一个点亮LED的电路" },
    { role: "assistant" as const, title: "草案草图", content: "我已经生成一版草案。" },
  ];
  const applied = [
    { role: "assistant" as const, title: "已应用草案", content: "草案已成功应用到画布。", tone: "success" as const },
  ];

  const merged = appendAssistantMessages(history, applied);
  assert.equal(merged.length, 3);
  assert.equal(merged[0]?.content, "帮我设计一个点亮LED的电路");
  assert.equal(merged[1]?.title, "草案草图");
  assert.equal(merged[2]?.title, "已应用草案");
  assert.equal(merged[2]?.tone, "success");
});

test("appendUserChatMessage preserves the confirm prompt before auto-applying a draft", () => {
  const history = [
    { role: "user" as const, title: "你", content: "帮我设计一个点亮LED的电路" },
    { role: "assistant" as const, title: "草案草图", content: "下一步应进入人工确认。" },
  ];

  const merged = appendUserChatMessage(history, "确认");
  assert.equal(merged.length, 3);
  assert.equal(merged[2]?.role, "user");
  assert.equal(merged[2]?.content, "确认");
});

test("mergeAssistantFinalMessage fully replaces streamed content while preserving progress metadata", () => {
  const pending = {
    role: "assistant" as const,
    title: "分析中",
    content: "{\"type\":\"final\",\"route\":\"analysis\"}",
    streaming: true,
    reactEvents: [
      { kind: "thought" as const, label: "Reasoning", status: "done" as const, text: "思考中", stepKind: "llm" as const },
    ],
    stepStates: [
      { kind: "llm" as const, required: true, note: "生成最终报告", status: "done" as const },
    ],
    workingMemory: {
      hasContext: true,
      mcpReady: false,
      libraryReady: false,
      llmReady: true,
      rulesReady: false,
      draftReady: false,
      lastObservation: "已有最终结论",
    },
  };
  const finalMessage = {
    role: "assistant" as const,
    title: "分析结果",
    content: "# 原理图审查报告\n\n最终正文",
    tone: "warning" as const,
    structuredContent: [
      { kind: "paragraph" as const, text: "最终结构化内容" },
    ],
  };

  const merged = mergeAssistantFinalMessage(pending, finalMessage);

  assert.equal(merged.streaming, false);
  assert.equal(merged.title, "分析结果");
  assert.equal(merged.content, "# 原理图审查报告\n\n最终正文");
  assert.equal(Array.isArray(merged.structuredContent), true);
  assert.equal(merged.reactEvents?.length, 1);
  assert.equal(merged.stepStates?.length, 1);
  assert.equal(merged.workingMemory?.lastObservation, "已有最终结论");
});

test("mergeAssistantFinalMessage preserves pending process stepItems when final message omits them", () => {
  const pending = {
    role: "assistant" as const,
    title: "分析中",
    content: "streaming...",
    streaming: true,
    stepItems: [
      {
        id: "step-1",
        phase: "llm" as const,
        type: "thought" as const,
        status: "running" as const,
        title: "Reasoning",
        text: "正在思考",
        startedAt: "2026-04-14T10:00:00.000Z",
        streaming: true,
      },
    ],
  };
  const finalMessage = {
    role: "assistant" as const,
    title: "分析结果",
    content: "最终答案",
  };

  const merged = mergeAssistantFinalMessage(pending, finalMessage);

  assert.equal(Array.isArray(merged.stepItems), true);
  assert.equal(merged.stepItems?.length, 1);
  assert.equal(merged.stepItems?.[0]?.id, "step-1");
  assert.equal(merged.stepItems?.[0]?.type, "thought");
  assert.equal(merged.stepItems?.[0]?.text, "正在思考");
});

test("mergeAssistantFinalMessage converts legacy reactEvents into stepItems without final entries", () => {
  const pending = {
    role: "assistant" as const,
    title: "分析中",
    content: "streaming...",
    streaming: true,
    reactEvents: [
      {
        kind: "thought" as const,
        label: "Reasoning",
        status: "running" as const,
        text: "正在思考",
        stepKind: "llm" as const,
      },
      {
        kind: "final" as const,
        label: "完成",
        status: "done" as const,
        text: "最终结论",
        stepKind: "llm" as const,
      },
    ],
  };
  const finalMessage = {
    role: "assistant" as const,
    title: "分析结果",
    content: "最终答案",
  };

  const merged = mergeAssistantFinalMessage(pending, finalMessage);

  assert.equal(Array.isArray(merged.stepItems), true);
  assert.equal(merged.stepItems?.length, 1);
  assert.equal(merged.stepItems?.[0]?.type, "thought");
  assert.equal(merged.stepItems?.[0]?.title, "Reasoning");
});

test("mergeAssistantFinalMessage respects explicit empty final stepItems without fallback", () => {
  const pending = {
    role: "assistant" as const,
    title: "分析中",
    content: "streaming...",
    streaming: true,
    stepItems: [
      {
        id: "step-1",
        phase: "llm" as const,
        type: "thought" as const,
        status: "running" as const,
        title: "Reasoning",
        text: "正在思考",
      },
    ],
  };
  const finalMessage = {
    role: "assistant" as const,
    title: "分析结果",
    content: "最终答案",
    stepItems: [],
  };

  const merged = mergeAssistantFinalMessage(pending, finalMessage);

  assert.equal(Array.isArray(merged.stepItems), true);
  assert.equal(merged.stepItems?.length, 0);
});

test("mergeAssistantFinalMessage strips final-control-like text from converted stepItems", () => {
  const pending = {
    role: "assistant" as const,
    title: "分析中",
    content: "streaming...",
    streaming: true,
    reactEvents: [
      {
        kind: "thought" as const,
        label: "Reasoning",
        status: "done" as const,
        text: "先输出概览。\n\n```json\n{\n  \"type\": \"final\",\n  \"route\": \"analysis\"\n}",
        stepKind: "llm" as const,
      },
    ],
  };
  const finalMessage = {
    role: "assistant" as const,
    title: "分析结果",
    content: "最终答案",
  };

  const merged = mergeAssistantFinalMessage(pending, finalMessage);

  assert.equal(merged.stepItems?.[0]?.text, "先输出概览。");
});

test("mergeAssistantFinalMessage keeps explicit empty final reactEvents without fallback", () => {
  const pending = {
    role: "assistant" as const,
    title: "分析中",
    content: "streaming...",
    streaming: true,
    reactEvents: [
      {
        kind: "thought" as const,
        label: "Reasoning",
        status: "running" as const,
        text: "正在思考",
        stepKind: "llm" as const,
      },
    ],
  };
  const finalMessage = {
    role: "assistant" as const,
    title: "分析结果",
    content: "最终答案",
    reactEvents: [],
  };

  const merged = mergeAssistantFinalMessage(pending, finalMessage);

  assert.equal(Array.isArray(merged.reactEvents), true);
  assert.equal(merged.reactEvents?.length, 0);
});

test("mergeAssistantFinalMessage keeps explicit empty final stepStates without fallback", () => {
  const pending = {
    role: "assistant" as const,
    title: "分析中",
    content: "streaming...",
    streaming: true,
    stepStates: [
      {
        kind: "llm" as const,
        required: true,
        note: "生成最终报告",
        status: "running" as const,
      },
    ],
  };
  const finalMessage = {
    role: "assistant" as const,
    title: "分析结果",
    content: "最终答案",
    stepStates: [],
  };

  const merged = mergeAssistantFinalMessage(pending, finalMessage);

  assert.equal(Array.isArray(merged.stepStates), true);
  assert.equal(merged.stepStates?.length, 0);
});

test("stripFinalControlLikeText removes fenced final payload from UI text", () => {
  assert.equal(
    stripFinalControlLikeText("先输出概览。\n\n```json\n{\n  \"type\": \"final\",\n  \"route\": \"analysis\"\n}"),
    "先输出概览。"
  );
});

test("stripFinalControlLikeText removes split final control prefix", () => {
  assert.equal(stripFinalControlLikeText("{\n\"type\""), "");
});

test("applyCustomLlmConfigSavedState keeps existing chat messages and uses toast instead", () => {
  const state = {
    chatMessages: [
      { role: "user" as const, title: "你", content: "之前的对话" },
      { role: "assistant" as const, title: "分析结果", content: "这里已经有内容" },
    ],
    summary: "旧状态",
  } as MainPanelState;

  const next = applyCustomLlmConfigSavedState(state, 123);

  assert.equal(next.summary, "自定义 LLM 配置已保存。");
  assert.equal(next.toast?.id, 123);
  assert.equal(next.toast?.message, "自定义 LLM 配置已保存。");
  assert.equal(next.chatMessages?.length, 2);
  assert.equal(next.chatMessages?.[0]?.content, "之前的对话");
  assert.equal(next.chatMessages?.[1]?.content, "这里已经有内容");
});

test("buildDraftApplyUnavailableMessage explains adapter source and missing apply capability", () => {
  const message = buildDraftApplyUnavailableMessage({
    adapterSource: "host",
    capabilityReport: {
      channel: "professional",
      available: true,
      missing: [],
      optionalMissing: ["applyPlan", "rollbackApplyPlan"],
    },
  });

  assert.equal(
    message,
    "应用草案失败：宿主未真正执行原理图应用。当前适配器来源：host；缺少能力：applyPlan、rollbackApplyPlan。请先检查宿主 applyPlan 能力是否已接通。"
  );
});

test("getAssistantCardLayout places the final report after expanded steps when execution is complete", () => {
  const layout = getAssistantCardLayout({
    streaming: false,
    hasThinking: false,
    hasSteps: true,
    hasReport: true,
    stepsOpen: true,
  });

  assert.deepEqual(layout.sectionOrder, ["header", "steps", "report"]);
  assert.equal(layout.showSteps, true);
  assert.equal(layout.showReport, true);
  assert.equal(layout.useSplitLayout, false);
});

test("getAssistantCardLayout hides steps and keeps only the final report when execution is complete and collapsed", () => {
  const layout = getAssistantCardLayout({
    streaming: false,
    hasThinking: false,
    hasSteps: true,
    hasReport: true,
    stepsOpen: false,
  });

  assert.deepEqual(layout.sectionOrder, ["header", "report"]);
  assert.equal(layout.showSteps, false);
  assert.equal(layout.showReport, true);
  assert.equal(layout.reportFillsRemainingHeight, true);
});

test("getAssistantCardLayout keeps streaming thinking above the report while execution is in progress", () => {
  const layout = getAssistantCardLayout({
    streaming: true,
    hasThinking: true,
    hasSteps: false,
    hasReport: true,
    stepsOpen: true,
  });

  assert.deepEqual(layout.sectionOrder, ["header", "thinking", "report"]);
  assert.equal(layout.showThinking, true);
  assert.equal(layout.useSplitLayout, true);
  assert.equal(layout.reportFillsRemainingHeight, false);
});

test("getAssistantCardLayout keeps both thinking and steps visible while streaming", () => {
  const layout = getAssistantCardLayout({
    streaming: true,
    hasThinking: true,
    hasSteps: true,
    hasReport: false,
    stepsOpen: true,
  });

  assert.deepEqual(layout.sectionOrder, ["header", "steps", "thinking"]);
  assert.equal(layout.showThinking, true);
  assert.equal(layout.showSteps, true);
  assert.equal(layout.useSplitLayout, true);
});

test("draftPreview state shape preserves selected device and guidance details", () => {
  const draftPreview: MainPanelState["draftPreview"] = {
    title: "5V LED Indicator Draft",
    rationale: "Generated a minimal LED indicator draft based on the user request.",
    componentRefs: ["J1", "R1", "D1"],
    netNames: ["5V", "LED_ANODE", "GND"],
    componentCount: 3,
    netCount: 3,
    selectedDeviceDetails: ["power_connector: CONN_1X2 [HDR-TH_1X2]"],
    guidanceSummary: {
      templateId: "led_indicator_minimal",
      rationale: "依据知识库模板，推荐使用 2Pin 电源口 + 150Ω + 红色 LED。",
      evidence: ["LED indicator：推荐使用 2Pin header、150Ω 限流电阻、红色 LED。 (kb://led_indicator)"],
    },
  };

  assert.equal(draftPreview.selectedDeviceDetails?.[0], "power_connector: CONN_1X2 [HDR-TH_1X2]");
  assert.equal(draftPreview.guidanceSummary?.templateId, "led_indicator_minimal");
});

test("hasUnresolvedDraftDevices returns true when draft contains unresolved components", () => {
  assert.equal(
    hasUnresolvedDraftDevices({
      title: "draft",
      rationale: "",
      components: [
        {
          id: "draft-j1",
          properties: {
            device_resolution_status: "unresolved",
          },
        },
      ],
      pins: [],
      nets: [],
    } as any),
    true
  );
});

test("buildDevicePickerSearchProgressText returns expected progress text", () => {
  assert.equal(buildDevicePickerSearchProgressText(2, 5), "正在搜索待确认器件候选（2/5）...");
});

test("buildDevicePickerApplyProgressText returns expected progress text", () => {
  assert.equal(buildDevicePickerApplyProgressText(3, 7), "正在确认待确认器件（3/7）...");
});

test("buildDevicePickerRoleLabel humanizes internal role names", () => {
  assert.equal(buildDevicePickerRoleLabel("power_connector"), "电源输入接口");
  assert.equal(buildDevicePickerRoleLabel("battery_connector"), "电池接口");
  assert.equal(buildDevicePickerRoleLabel("ldo_regulator"), "稳压器");
  assert.equal(buildDevicePickerRoleLabel("generic"), "待确认器件");
});

test("inferDraftComponentRole recognizes LED-style refs instead of treating them as generic", () => {
  assert.equal(inferDraftComponentRole("LED1"), "led");
  assert.equal(inferDraftComponentRole("LED2"), "led");
  assert.equal(inferDraftComponentRole("D1"), "led");
  assert.equal(inferDraftComponentRole("BT1"), "battery_connector");
});

test("buildDevicePickerReasonLabel translates internal unresolved reasons into user-facing language", () => {
  assert.equal(
    buildDevicePickerReasonLabel({
      reason: "all_candidates_filtered",
      role: "power_connector",
      query: "USB Type-C 16PIN",
    }),
    "自动筛选后没有找到完全符合当前用途的器件，下面展示的是接近的候选。"
  );
  assert.equal(
    buildDevicePickerReasonLabel({
      reason: "unresolved",
      role: "battery_connector",
      query: "JST PH 2P",
    }),
    "还没有找到可直接确认的电池接口。"
  );
});

test("previewDraftPlan hides internal unresolved markers for battery connectors", () => {
  const preview = previewDraftPlan({
    title: "battery preview",
    rationale: "test",
    components: [
      {
        id: "draft-bt1",
        ref: "BT1",
        name: "Battery Connector",
        componentType: "part",
        addIntoBom: true,
        addIntoPcb: true,
        properties: {
          device_resolution_status: "unresolved",
          device_resolution_reason: "no_search_results",
          preferred_search_query: "JST PH 2P battery connector",
        },
      },
    ],
    pins: [],
    nets: [],
  } as any);

  assert.deepEqual(preview.unresolvedDeviceDetails, ["BT1：电池接口，暂未自动匹配到可直接放置的器件。建议搜索：JST PH 2P battery connector"]);
});

test("buildDevicePickerCandidatePresentation explains why a usb-c receptacle fits a power connector slot", () => {
  const presentation = buildDevicePickerCandidatePresentation(
    {
      role: "power_connector",
      query: "USB Type-C 16PIN",
    },
    {
      uuid: "cand-1",
      name: "TYPE-C16PIN母座 板上四脚三次molding",
      libraryUuid: "lib-1",
      footprintName: "USB-SMD_TYPE-C16PIN",
      supplierId: "C9900000202",
      description: "Type-C receptacle connector",
    },
    1
  );

  assert.equal(presentation.fitLevel, "recommended");
  assert.equal(presentation.fitLabel, "较匹配");
  assert.equal(presentation.typeLabel, "USB Type-C 接口");
  assert.equal(
    presentation.summary,
    "可作为电源输入接口使用，和当前“USB Type-C 16PIN”的查询目标基本一致。"
  );
  assert.equal(
    presentation.reasons.includes("接口外形与查询目标接近，更可能适合作为当前接口位。"),
    true
  );
});

test("normalizeDevicePickerCandidates unwraps wrapped host payload and maps title-based fields", () => {
  const candidates = normalizeDevicePickerCandidates({
    success: true,
    code: 0,
    result: [
      {
        uuid: "8eee80085aeb4c14ba56d613c645ea4b",
        title: "rps6045-47mt",
        owner: {
          uuid: "0819f05c4eef4c71ace90d822a990e87",
          username: "LCSC",
          nickname: "LCSC",
        },
        description: "4.7uH power inductor",
      },
    ],
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.uuid, "8eee80085aeb4c14ba56d613c645ea4b");
  assert.equal(candidates[0]?.name, "rps6045-47mt");
  assert.equal(candidates[0]?.libraryUuid, "0819f05c4eef4c71ace90d822a990e87");
  assert.equal(candidates[0]?.description, "4.7uH power inductor");
});

test("deriveSessionHistoryEntries migrates last_state into history when session index is empty", () => {
  const lastState: MainPanelState = {
    loggedIn: true,
    sessionTitle: "LED 电源检查",
    summary: "已恢复上次会话。",
    chatMessages: [
      { role: "user", title: "你", content: "帮我检查 LED 供电" },
      { role: "assistant", title: "分析结果", content: "发现限流电阻缺失。" },
    ],
  };

  const entries = deriveSessionHistoryEntries(undefined, lastState);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.sessionTitle, "LED 电源检查");
  assert.ok(entries[0]?.sessionId);
});
