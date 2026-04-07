import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  appendAssistantMessages,
  appendUserChatMessage,
  finalizeDraftTurnMessages,
  shouldAutoApplyDraftFromChatInput,
  shouldIgnoreDuplicateSendWhileRunning,
} from "../assistantRuntime";
import { getAssistantCardLayout } from "../assistantCardLayout";

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
