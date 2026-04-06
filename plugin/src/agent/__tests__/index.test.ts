import { test } from "node:test";
import * as assert from "node:assert/strict";
import { createPluginAgent } from "../index";

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
