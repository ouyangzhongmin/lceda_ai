import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  appendAssistantMessages,
  appendUserChatMessage,
  buildDevicePickerApplyProgressText,
  buildDevicePickerSearchProgressText,
  deriveSessionHistoryEntries,
  finalizeDraftTurnMessages,
  formatDraftApplyErrorMessage,
  hasUnresolvedDraftDevices,
  normalizeDevicePickerCandidates,
  shouldStopRunningTurnFromComposer,
  shouldAutoApplyDraftFromChatInput,
  shouldIgnoreDuplicateSendWhileRunning,
  shouldUseDraftReplyLeadNarrative,
} from "../assistantRuntime";
import { getAssistantCardLayout } from "../assistantCardLayout";
import type { MainPanelState } from "../../ui/panels/mainPanel";

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
