import { test } from "node:test";
import * as assert from "node:assert/strict";

import { finalizeDraftTurnMessages, shouldIgnoreDuplicateSendWhileRunning } from "../assistantRuntime";

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
