import { test } from "node:test";
import * as assert from "node:assert/strict";
import { runReActLoop } from "../reactLoopAgent";
import type { ReactAgentDeps, ReactAgentState } from "../reactTypes";
import { runUnifiedReactAgent } from "../unifiedReactAgent";
import { ToolRegistry, type AgentTool } from "../../tools/toolRegistry";
import type { SchematicContext } from "../../../types/schematic";
import type { DraftPlan } from "../../../editor/apply-plan/draftPlan";
import type { MainPanelState } from "../../../ui/panels/mainPanel";
import { planContextCompaction } from "../../../app/assistantRuntime";

function createState(): ReactAgentState {
  return {
    toolTraces: [],
    stepStates: [],
    workingMemory: {
      hasContext: false,
      mcpReady: false,
      libraryReady: false,
      llmReady: false,
      rulesReady: false,
      draftReady: false,
    },
    reactEvents: [],
  };
}

function createMinimalContext(): SchematicContext {
  return {
    project: {
      channel: "professional",
      pageName: "P1",
      projectId: "proj-1",
      pageId: "page-1",
    },
    components: [],
    pins: [],
    nets: [],
    selection: {
      objectIds: [],
    },
  };
}

test("runReActLoop passes non-empty tool descriptions to llm_generate", async () => {
  let capturedTools: Array<{ type: string; function: { name: string; description: string; parameters: unknown } }> = [];

  const deps: ReactAgentDeps = {
    task: { type: "natural_chat", userQuery: "分析当前原理图有什么问题" },
    allowedTools: ["editor_get_current_context"],
    listToolNames: () => ["editor_get_current_context", "llm_generate"],
    invokeTool: async (toolName, input) => {
      if (toolName === "llm_generate") {
        capturedTools = ((input as { tools?: typeof capturedTools }).tools ?? []).slice();
        return { output_text: '{"type":"final","route":"chat","rationale":"done"}' } as never;
      }
      if (toolName === "editor_get_current_context") {
        return {} as never;
      }
      throw new Error(`unexpected tool: ${toolName}`);
    },
  };

  await runReActLoop({
    deps,
    state: createState(),
    system: "system",
    user: "user",
    toolDefinitions: [{
      name: "editor_get_current_context",
      description: "读取当前编辑器中的原理图上下文",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    }],
  });

  assert.equal(capturedTools.length, 1);
  assert.equal(capturedTools[0]?.function.name, "editor_get_current_context");
  assert.notEqual(capturedTools[0]?.function.description, "");
});

test("runReActLoop sends structured parameter schemas for key tools", async () => {
  let capturedTools: Array<{ type: string; function: { name: string; description: string; parameters: Record<string, unknown> } }> = [];

  const deps: ReactAgentDeps = {
    task: { type: "natural_chat", userQuery: "查找 U1 并分析问题" },
    allowedTools: ["editor_find_object", "rules_run_schematic_checks"],
    listToolNames: () => ["editor_find_object", "rules_run_schematic_checks", "llm_generate"],
    invokeTool: async (toolName, input) => {
      if (toolName === "llm_generate") {
        capturedTools = ((input as { tools?: typeof capturedTools }).tools ?? []).slice();
        return { output_text: '{"type":"final","route":"chat","rationale":"done"}' } as never;
      }
      throw new Error(`unexpected tool: ${toolName}`);
    },
  };

  await runReActLoop({
    deps,
    state: createState(),
    system: "system",
    user: "user",
    toolDefinitions: [
      {
        name: "editor_find_object",
        description: "基于当前上下文按位号、引脚名、网络名或对象 ID 查找原理图对象",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "要搜索的位号、引脚名、网络名或问题描述" },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
      {
        name: "rules_run_schematic_checks",
        description: "执行本地原理图规则检查，发现连线与属性问题",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    ],
  });

  const findTool = capturedTools.find((tool) => tool.function.name === "editor_find_object");
  const rulesTool = capturedTools.find((tool) => tool.function.name === "rules_run_schematic_checks");

  assert.ok(findTool);
  assert.ok(rulesTool);
  assert.deepEqual(findTool.function.parameters, {
    type: "object",
    properties: {
      query: { type: "string", description: "要搜索的位号、引脚名、网络名或问题描述" },
    },
    required: ["query"],
    additionalProperties: false,
  });
  assert.deepEqual(rulesTool.function.parameters, {
    type: "object",
    properties: {},
    additionalProperties: false,
  });
});

test("runReActLoop retries when model output is not a valid action/final payload", async () => {
  let llmCalls = 0;
  let toolCalls = 0;

  const deps: ReactAgentDeps = {
    task: { type: "natural_chat", userQuery: "分析当前原理图有什么问题" },
    allowedTools: ["editor_get_current_context"],
    listToolNames: () => ["editor_get_current_context", "llm_generate"],
    invokeTool: async (toolName) => {
      if (toolName === "llm_generate") {
        llmCalls += 1;
        if (llmCalls === 1) {
          return { output_text: "我先想一下" } as never;
        }
        if (llmCalls === 2) {
          return {
            tool_calls: [
              {
                function: {
                  name: "editor_get_current_context",
                  arguments: "{}",
                },
              },
            ],
            output_text: "",
          } as never;
        }
        return { output_text: '{"type":"final","route":"analysis","rationale":"done"}' } as never;
      }
      if (toolName === "editor_get_current_context") {
        toolCalls += 1;
        return createMinimalContext() as never;
      }
      throw new Error(`unexpected tool: ${toolName}`);
    },
  };

  const result = await runReActLoop({
    deps,
    state: createState(),
    system: "system",
    user: "user",
    toolDefinitions: [{
      name: "editor_get_current_context",
      description: "读取当前编辑器中的原理图上下文",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    }],
    requiredTools: ["editor_get_current_context"],
  });

  assert.equal(llmCalls, 3);
  assert.equal(toolCalls, 1);
  assert.deepEqual(result.observations.map((item) => item.tool), ["editor_get_current_context"]);
});

test("runReActLoop preserves assistant tool_calls and tool messages across rounds", async () => {
  const llmMessages: unknown[][] = [];

  const deps: ReactAgentDeps = {
    task: { type: "natural_chat", userQuery: "分析当前原理图有什么问题" },
    allowedTools: ["editor_get_current_context"],
    listToolNames: () => ["editor_get_current_context", "llm_generate"],
    invokeTool: async (toolName, input) => {
      if (toolName === "llm_generate") {
        const payload = input as { messages?: unknown[] };
        llmMessages.push((payload.messages ?? []).slice());
        if (llmMessages.length === 1) {
          return {
            output_text: "",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "editor_get_current_context",
                  arguments: "{}",
                },
              },
            ],
          } as never;
        }
        return { output_text: '{"type":"final","route":"analysis","rationale":"done"}' } as never;
      }
      if (toolName === "editor_get_current_context") {
        return createMinimalContext() as never;
      }
      throw new Error(`unexpected tool: ${toolName}`);
    },
  };

  await runReActLoop({
    deps,
    state: createState(),
    system: "system",
    user: "user",
    toolDefinitions: [{
      name: "editor_get_current_context",
      description: "读取当前编辑器中的原理图上下文",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    }],
  });

  assert.equal(llmMessages.length, 2);
  assert.deepEqual(llmMessages[1], [
    { role: "system", content: "system" },
    { role: "user", content: "user" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "editor_get_current_context",
            arguments: "{}",
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call_1",
      content: JSON.stringify(createMinimalContext()),
    },
  ]);
});

test("runReActLoop only persists the executed tool_call when model returns multiple tool calls", async () => {
  const llmMessages: unknown[][] = [];

  const deps: ReactAgentDeps = {
    task: { type: "natural_chat", userQuery: "解释 J1 是什么器件" },
    allowedTools: ["library_search_devices", "mcp_list_resources"],
    listToolNames: () => ["library_search_devices", "mcp_list_resources", "llm_generate"],
    invokeTool: async (toolName, input) => {
      if (toolName === "llm_generate") {
        const payload = input as { messages?: unknown[] };
        llmMessages.push((payload.messages ?? []).slice());
        if (llmMessages.length === 1) {
          return {
            output_text: "",
            tool_calls: [
              {
                id: "call_lib",
                type: "function",
                function: {
                  name: "library_search_devices",
                  arguments: "{\"query\":\"power connector\"}",
                },
              },
              {
                id: "call_mcp",
                type: "function",
                function: {
                  name: "mcp_list_resources",
                  arguments: "{}",
                },
              },
            ],
          } as never;
        }
        return { output_text: '{"type":"final","route":"chat","rationale":"done"}' } as never;
      }
      if (toolName === "library_search_devices") {
        return [{ name: "HDR-TH_1X2" }] as never;
      }
      if (toolName === "mcp_list_resources") {
        throw new Error("unexpected second tool execution");
      }
      throw new Error(`unexpected tool: ${toolName}`);
    },
  };

  await runReActLoop({
    deps,
    state: createState(),
    system: "system",
    user: "user",
    toolDefinitions: [
      {
        name: "library_search_devices",
        description: "搜索器件",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
          additionalProperties: false,
        },
      },
      {
        name: "mcp_list_resources",
        description: "列出资源",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    ],
  });

  assert.equal(llmMessages.length, 2);
  assert.deepEqual(llmMessages[1], [
    { role: "system", content: "system" },
    { role: "user", content: "user" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_lib",
          type: "function",
          function: {
            name: "library_search_devices",
            arguments: "{\"query\":\"power connector\"}",
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call_lib",
      content: JSON.stringify([{ name: "HDR-TH_1X2" }]),
    },
  ]);
});

test("runReActLoop creates stepStates when mapped tools execute", async () => {
  const deps: ReactAgentDeps = {
    task: { type: "natural_chat", userQuery: "分析当前原理图有什么问题" },
    allowedTools: ["editor_get_current_context"],
    listToolNames: () => ["editor_get_current_context", "llm_generate"],
    invokeTool: async (toolName) => {
      if (toolName === "llm_generate") {
        return {
          output_text: "",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "editor_get_current_context",
                arguments: "{}",
              },
            },
          ],
        } as never;
      }
      if (toolName === "editor_get_current_context") {
        return createMinimalContext() as never;
      }
      throw new Error(`unexpected tool: ${toolName}`);
    },
  };

  const state = createState();
  await runReActLoop({
    deps,
    state,
    system: "system",
    user: "user",
    toolDefinitions: [{
      name: "editor_get_current_context",
      description: "读取当前编辑器中的原理图上下文",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    }],
    maxIterations: 1,
    mapToolToStepKind: () => "context",
  });

  assert.deepEqual(state.stepStates, [
    {
      kind: "llm",
      required: true,
      note: "模型决策下一步动作",
      status: "done",
      observation: "LLM 已决定调用：editor_get_current_context",
    },
    {
      kind: "context",
      required: true,
      note: "执行工具：editor_get_current_context",
      status: "done",
      observation: "已完成：editor_get_current_context",
    },
  ]);
});

test("runReActLoop emits running tool_call progress before tool finishes", async () => {
  const progressSnapshots: Array<{
    detail: string;
    reactEvents: ReactAgentState["reactEvents"];
    stepStates: ReactAgentState["stepStates"];
  }> = [];
  let releaseTool: (() => void) | undefined;
  let llmCalls = 0;

  const deps: ReactAgentDeps = {
    task: { type: "natural_chat", userQuery: "调用上下文工具" },
    allowedTools: ["editor_get_current_context"],
    listToolNames: () => ["editor_get_current_context", "llm_generate"],
    onProgress: (payload) => {
      progressSnapshots.push({
        detail: payload.detail,
        reactEvents: payload.reactEvents.map((event) => ({ ...event })),
        stepStates: payload.stepStates.map((step) => ({ ...step })),
      });
    },
    invokeTool: async (toolName) => {
      if (toolName === "llm_generate") {
        llmCalls += 1;
        if (llmCalls > 1) {
          return { output_text: '{"type":"final","route":"chat","rationale":"done"}' } as never;
        }
        return {
          output_text: "",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "editor_get_current_context",
                arguments: "{}",
              },
            },
          ],
        } as never;
      }
      if (toolName === "editor_get_current_context") {
        await new Promise<void>((resolve) => {
          releaseTool = resolve;
        });
        return createMinimalContext() as never;
      }
      throw new Error(`unexpected tool: ${toolName}`);
    },
  };

  const runPromise = runReActLoop({
    deps,
    state: createState(),
    system: "system",
    user: "user",
    toolDefinitions: [{
      name: "editor_get_current_context",
      description: "读取当前编辑器中的原理图上下文",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    }],
    mapToolToStepKind: () => "context",
  });

  let runningSnapshot:
    | {
        detail: string;
        reactEvents: ReactAgentState["reactEvents"];
        stepStates: ReactAgentState["stepStates"];
      }
    | undefined;
  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      runningSnapshot = progressSnapshots.find((snapshot) =>
        snapshot.reactEvents.some(
          (event) => event.kind === "tool_call" && event.toolName === "editor_get_current_context" && event.status === "running"
        )
      );
      if (runningSnapshot) break;
    }

    assert.ok(runningSnapshot);
    assert.equal(runningSnapshot?.detail, "执行工具：editor_get_current_context");
    assert.equal(
      runningSnapshot?.stepStates.some((step) => step.kind === "context" && step.status === "running"),
      true
    );
  } finally {
    releaseTool?.();
    await runPromise;
  }
});

test("runReActLoop forwards plain text deltas as textDelta progress for non-reasoning models", async () => {
  const progressEvents: Array<{ detail: string; textDelta?: string; reasoningDelta?: string }> = [];

  const deps: ReactAgentDeps = {
    task: { type: "natural_chat", userQuery: "解释 J1 是什么器件" },
    allowedTools: [],
    listToolNames: () => ["llm_generate"],
    onProgress: (payload) => {
      progressEvents.push({
        detail: payload.detail,
        textDelta: payload.textDelta,
        reasoningDelta: payload.reasoningDelta,
      });
    },
    invokeTool: async (toolName, input) => {
      if (toolName !== "llm_generate") {
        throw new Error(`unexpected tool: ${toolName}`);
      }
      const payload = input as {
        onEvent?: (event: {
          type: "start" | "delta" | "reasoning_delta" | "done" | "error";
          delta?: string;
          reasoning_delta?: string;
        }) => void;
      };
      payload.onEvent?.({ type: "start" });
      payload.onEvent?.({ type: "delta", delta: "J1 通常表示" });
      payload.onEvent?.({ type: "delta", delta: "电源输入连接器。" });
      payload.onEvent?.({
        type: "done",
      });
      return {
        output_text: '{"type":"final","route":"chat","rationale":"done","output":"J1 通常表示电源输入连接器。"}',
      } as never;
    },
  };

  await runReActLoop({
    deps,
    state: createState(),
    system: "system",
    user: "user",
  });

  assert.equal(
    progressEvents.some((event) => event.textDelta === "J1 通常表示"),
    true
  );
  assert.equal(
    progressEvents.some((event) => event.textDelta === "电源输入连接器。"),
    true
  );
  assert.equal(
    progressEvents.some((event) => event.reasoningDelta),
    false
  );
});

test("runReActLoop does not forward Final control json as textDelta progress", async () => {
  const progressEvents: Array<{ detail: string; textDelta?: string; text?: string }> = [];

  const deps: ReactAgentDeps = {
    task: { type: "natural_chat", userQuery: "分析这个原理图" },
    allowedTools: [],
    listToolNames: () => ["llm_generate"],
    onProgress: (payload) => {
      progressEvents.push({
        detail: payload.detail,
        textDelta: payload.textDelta,
        text: payload.text,
      });
    },
    invokeTool: async (toolName, input) => {
      if (toolName !== "llm_generate") {
        throw new Error(`unexpected tool: ${toolName}`);
      }
      const payload = input as {
        onEvent?: (event: {
          type: "start" | "delta" | "reasoning_delta" | "done" | "error";
          delta?: string;
        }) => void;
      };
      payload.onEvent?.({ type: "start" });
      payload.onEvent?.({ type: "delta", delta: "先检查一下主要发现。" });
      payload.onEvent?.({
        type: "delta",
        delta: '\n\nFinal: {"type":"final","route":"analysis","rationale":"done","output":"## 报告"}',
      });
      payload.onEvent?.({ type: "done" });
      return {
        output_text: '{"type":"final","route":"analysis","rationale":"done","output":"## 报告"}',
      } as never;
    },
  };

  await runReActLoop({
    deps,
    state: createState(),
    system: "system",
    user: "user",
  });

  assert.equal(progressEvents.some((event) => String(event.textDelta || "").includes('Final: {"type":"final"')), false);
  assert.equal(progressEvents.some((event) => String(event.text || "").includes('"route":"analysis"')), false);
  assert.equal(progressEvents.some((event) => event.textDelta === "先检查一下主要发现。"), true);
});

test("runReActLoop does not forward raw final json object as textDelta progress", async () => {
  const progressEvents: Array<{ detail: string; textDelta?: string; text?: string }> = [];

  const deps: ReactAgentDeps = {
    task: { type: "natural_chat", userQuery: "分析这个原理图" },
    allowedTools: [],
    listToolNames: () => ["llm_generate"],
    onProgress: (payload) => {
      progressEvents.push({
        detail: payload.detail,
        textDelta: payload.textDelta,
        text: payload.text,
      });
    },
    invokeTool: async (toolName, input) => {
      if (toolName !== "llm_generate") {
        throw new Error(`unexpected tool: ${toolName}`);
      }
      const payload = input as {
        onEvent?: (event: {
          type: "start" | "delta" | "reasoning_delta" | "done" | "error";
          delta?: string;
        }) => void;
      };
      payload.onEvent?.({ type: "start" });
      payload.onEvent?.({ type: "delta", delta: "现在生成最终报告。" });
      payload.onEvent?.({
        type: "delta",
        delta: '\n{\n  "type": "final",\n  "route": "analysis",\n  "rationale": "done",\n  "output": "## 报告"\n}',
      });
      payload.onEvent?.({ type: "done" });
      return {
        output_text: '{"type":"final","route":"analysis","rationale":"done","output":"## 报告"}',
      } as never;
    },
  };

  await runReActLoop({
    deps,
    state: createState(),
    system: "system",
    user: "user",
  });

  assert.equal(progressEvents.some((event) => String(event.textDelta || "").includes('"type": "final"')), false);
  assert.equal(progressEvents.some((event) => String(event.text || "").includes('"route": "analysis"')), false);
  assert.equal(progressEvents.some((event) => event.textDelta === "现在生成最终报告。"), true);
});

test("runReActLoop does not forward split final json chunks as textDelta progress", async () => {
  const progressEvents: Array<{ detail: string; textDelta?: string; text?: string }> = [];

  const deps: ReactAgentDeps = {
    task: { type: "natural_chat", userQuery: "分析这个原理图" },
    allowedTools: [],
    listToolNames: () => ["llm_generate"],
    onProgress: (payload) => {
      progressEvents.push({
        detail: payload.detail,
        textDelta: payload.textDelta,
        text: payload.text,
      });
    },
    invokeTool: async (toolName, input) => {
      if (toolName !== "llm_generate") {
        throw new Error(`unexpected tool: ${toolName}`);
      }
      const payload = input as {
        onEvent?: (event: {
          type: "start" | "delta" | "reasoning_delta" | "done" | "error";
          delta?: string;
        }) => void;
      };
      payload.onEvent?.({ type: "start" });
      payload.onEvent?.({ type: "delta", delta: "先输出结论摘要。\n" });
      payload.onEvent?.({ type: "delta", delta: "{\n  \"type\"" });
      payload.onEvent?.({ type: "delta", delta: ": \"final\",\n  \"route\": \"analysis\"" });
      payload.onEvent?.({ type: "delta", delta: ",\n  \"output\": \"## 报告\"\n}" });
      payload.onEvent?.({ type: "done" });
      return {
        output_text: '{"type":"final","route":"analysis","rationale":"done","output":"## 报告"}',
      } as never;
    },
  };

  await runReActLoop({
    deps,
    state: createState(),
    system: "system",
    user: "user",
  });

  assert.equal(progressEvents.some((event) => String(event.textDelta || "").includes('"type"')), false);
  assert.equal(progressEvents.some((event) => String(event.text || "").includes('"route"')), false);
  assert.equal(progressEvents.some((event) => event.textDelta === "先输出结论摘要。\n"), true);
});

test("runReActLoop does not forward fenced final json chunks as textDelta progress", async () => {
  const progressEvents: Array<{ detail: string; textDelta?: string; text?: string }> = [];

  const deps: ReactAgentDeps = {
    task: { type: "natural_chat", userQuery: "分析这个原理图" },
    allowedTools: [],
    listToolNames: () => ["llm_generate"],
    onProgress: (payload) => {
      progressEvents.push({
        detail: payload.detail,
        textDelta: payload.textDelta,
        text: payload.text,
      });
    },
    invokeTool: async (toolName, input) => {
      if (toolName !== "llm_generate") {
        throw new Error(`unexpected tool: ${toolName}`);
      }
      const payload = input as {
        onEvent?: (event: {
          type: "start" | "delta" | "reasoning_delta" | "done" | "error";
          delta?: string;
        }) => void;
      };
      payload.onEvent?.({ type: "start" });
      payload.onEvent?.({ type: "delta", delta: "先输出概览。\n\n" });
      payload.onEvent?.({ type: "delta", delta: "```json\n" });
      payload.onEvent?.({ type: "delta", delta: "{\n" });
      payload.onEvent?.({ type: "delta", delta: '  "type": "final",\n' });
      payload.onEvent?.({ type: "delta", delta: '  "route": "analysis"\n' });
      payload.onEvent?.({ type: "done" });
      return {
        output_text: '{"type":"final","route":"analysis","rationale":"done","output":"## 报告"}',
      } as never;
    },
  };

  await runReActLoop({
    deps,
    state: createState(),
    system: "system",
    user: "user",
  });

  assert.equal(progressEvents.some((event) => String(event.textDelta || "").includes("```json")), false);
  assert.equal(progressEvents.some((event) => String(event.textDelta || "").includes('"type": "final"')), false);
  assert.equal(progressEvents.some((event) => String(event.text || "").includes('"route": "analysis"')), false);
  assert.equal(progressEvents.some((event) => event.textDelta === "先输出概览。\n\n"), true);
});

test("runReActLoop aborts before starting llm generation when signal is already aborted", async () => {
  let llmCalls = 0;
  const controller = new AbortController();
  controller.abort();

  const deps: ReactAgentDeps = {
    task: { type: "natural_chat", userQuery: "停止当前任务" },
    allowedTools: ["editor_get_current_context"],
    listToolNames: () => ["editor_get_current_context", "llm_generate"],
    signal: controller.signal,
    isCancelled: () => controller.signal.aborted,
    invokeTool: async (toolName) => {
      if (toolName === "llm_generate") {
        llmCalls += 1;
      }
      throw new Error(`unexpected tool: ${toolName}`);
    },
  };

  await assert.rejects(
    () =>
      runReActLoop({
        deps,
        state: createState(),
        system: "system",
        user: "user",
      }),
    (error: unknown) => error instanceof Error && error.name === "CancelledError"
  );

  assert.equal(llmCalls, 0);
});

test("runReActLoop drops late tool result after cancellation and does not continue to next llm round", async () => {
  let llmCalls = 0;
  let releaseTool: (() => void) | undefined;
  const controller = new AbortController();
  const state = createState();

  const deps: ReactAgentDeps = {
    task: { type: "natural_chat", userQuery: "停止当前任务" },
    allowedTools: ["editor_get_current_context"],
    listToolNames: () => ["editor_get_current_context", "llm_generate"],
    signal: controller.signal,
    isCancelled: () => controller.signal.aborted,
    invokeTool: async (toolName) => {
      if (toolName === "llm_generate") {
        llmCalls += 1;
        if (llmCalls === 1) {
          return {
            output_text: "",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "editor_get_current_context",
                  arguments: "{}",
                },
              },
            ],
          } as never;
        }
        return { output_text: '{"type":"final","route":"chat","rationale":"done"}' } as never;
      }
      if (toolName === "editor_get_current_context") {
        await new Promise<void>((resolve) => {
          releaseTool = resolve;
        });
        return createMinimalContext() as never;
      }
      throw new Error(`unexpected tool: ${toolName}`);
    },
  };

  const runPromise = runReActLoop({
    deps,
    state,
    system: "system",
    user: "user",
    toolDefinitions: [{
      name: "editor_get_current_context",
      description: "读取当前编辑器中的原理图上下文",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    }],
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  releaseTool?.();

  await assert.rejects(
    () => runPromise,
    (error: unknown) => error instanceof Error && error.name === "CancelledError"
  );

  assert.equal(llmCalls, 1);
  assert.deepEqual(state.toolTraces, []);
  assert.equal(state.reactEvents.some((event) => event.kind === "observation"), false);
});

test("runUnifiedReactAgent treats draft confirmation follow-up summary as chat instead of regenerating draft", async () => {
  const calls: string[] = [];
  const tools = new ToolRegistry();
  tools.register({
    name: "draft_generate_plan",
    description: "根据用户需求生成最小可用的原理图草案计划",
    parameters: { type: "object", properties: {}, additionalProperties: true },
    execute: async () => {
      calls.push("draft_generate_plan");
      return {};
    },
  } as AgentTool);
  tools.register({
    name: "draft_preview_plan",
    description: "根据草案计划生成预览摘要",
    parameters: { type: "object", properties: {}, additionalProperties: true },
    execute: async () => {
      calls.push("draft_preview_plan");
      return {};
    },
  } as AgentTool);
  tools.register({
    name: "llm_generate",
    description: "llm",
    parameters: { type: "object", properties: {}, additionalProperties: true },
    execute: async () => ({ output_text: "" }),
  } as AgentTool);

  const llmPayloads: Array<{ system?: string; user?: string; tools?: Array<{ function: { name: string } }> }> = [];
  const originalInvoke = tools.invoke.bind(tools);
  tools.invoke = (async (name: string, input: unknown) => {
    if (name === "llm_generate") {
      const payload = input as { messages?: Array<{ role: string; content: string }>; tools?: Array<{ function: { name: string } }> };
      llmPayloads.push({
        system: payload.messages?.find((item) => item.role === "system")?.content,
        user: payload.messages?.find((item) => item.role === "user")?.content,
        tools: payload.tools,
      });
      return {
        output_text:
          '{"type":"final","route":"chat","rationale":"reuse existing draft","output":"## 主要元器件\\n- U1\\n- U2\\n- J1"}',
      } as any;
    }
    return originalInvoke(name, input);
  }) as typeof tools.invoke;

  const result = await runUnifiedReactAgent({
    taskType: "natural_chat",
    userQuery: "给我生成一个列表展示用哪些主要的元器件",
    panelState: {
      loggedIn: true,
      agentRunState: "awaiting_confirmation",
      draftPreview: {
        title: "ESP32-S3 语音设备",
        rationale: "已有草案",
        componentRefs: ["U1", "U2", "J1"],
        netNames: ["5V", "VBAT", "3V3"],
        componentCount: 3,
        netCount: 3,
      },
      draftPlan: {
        title: "ESP32-S3 语音设备",
        rationale: "已有草案",
        components: [],
        pins: [],
        nets: [],
      } as DraftPlan,
      chatMessages: [],
    } as MainPanelState,
    context: createMinimalContext(),
    tools,
    allowedTools: ["draft_generate_plan", "draft_preview_plan", "llm_generate"],
  });

  assert.equal(result.result.naturalReply?.includes("主要元器件"), true);
  assert.deepEqual(calls, []);
  assert.equal(
    llmPayloads[0]?.system?.includes("## 现有草案追问任务定义"),
    true
  );
  assert.equal(
    llmPayloads[0]?.user?.includes("优先复用当前草案摘要直接回答"),
    true
  );
  assert.equal(
    llmPayloads[0]?.tools?.some((tool) => tool.function.name === "draft_generate_plan"),
    false
  );
});

test("runUnifiedReactAgent treats generic draft follow-up why-question as chat instead of regenerating draft", async () => {
  const calls: string[] = [];
  const llmPayloads: Array<{ system?: string; user?: string; tools?: Array<{ function: { name: string } }> }> = [];
  const tools = new ToolRegistry();
  tools.register({
    name: "draft_generate_plan",
    description: "根据用户需求生成最小可用的原理图草案计划",
    parameters: { type: "object", properties: {}, additionalProperties: true },
    execute: async () => {
      calls.push("draft_generate_plan");
      return {};
    },
  } as AgentTool);
  tools.register({
    name: "draft_preview_plan",
    description: "根据草案计划生成预览摘要",
    parameters: { type: "object", properties: {}, additionalProperties: true },
    execute: async () => {
      calls.push("draft_preview_plan");
      return {};
    },
  } as AgentTool);
  tools.register({
    name: "llm_generate",
    description: "llm",
    parameters: { type: "object", properties: {}, additionalProperties: true },
    execute: async () => ({ output_text: "" }),
  } as AgentTool);

  const originalInvoke = tools.invoke.bind(tools);
  tools.invoke = (async (name: string, input: unknown) => {
    if (name === "llm_generate") {
      const payload = input as { messages?: Array<{ role: string; content: string }>; tools?: Array<{ function: { name: string } }> };
      llmPayloads.push({
        system: payload.messages?.find((item) => item.role === "system")?.content,
        user: payload.messages?.find((item) => item.role === "user")?.content,
        tools: payload.tools,
      });
      return {
        output_text:
          '{"type":"final","route":"chat","rationale":"explain existing draft","output":"J1、J2、J3 是为电源输入、调试接入和外设预留的连接器。"}',
      } as any;
    }
    return originalInvoke(name, input);
  }) as typeof tools.invoke;

  const result = await runUnifiedReactAgent({
    taskType: "natural_chat",
    userQuery: "为什么会出现J1,J2,J3三个power_connector呢？",
    panelState: {
      loggedIn: true,
      agentRunState: "awaiting_confirmation",
      draftPreview: {
        title: "ESP32-S3 语音设备",
        rationale: "已有草案",
        componentRefs: ["J1", "J2", "J3", "U1"],
        netNames: ["5V", "VBAT", "3V3"],
        componentCount: 4,
        netCount: 3,
      },
      draftPlan: {
        title: "ESP32-S3 语音设备",
        rationale: "已有草案",
        components: [],
        pins: [],
        nets: [],
      } as DraftPlan,
      chatMessages: [],
    } as MainPanelState,
    context: createMinimalContext(),
    tools,
    allowedTools: ["draft_generate_plan", "draft_preview_plan", "llm_generate"],
  });

  assert.equal(result.result.naturalReply?.includes("J1、J2、J3"), true);
  assert.deepEqual(calls, []);
  assert.equal(
    llmPayloads[0]?.system?.includes("## 现有草案追问任务定义"),
    true
  );
  assert.equal(
    llmPayloads[0]?.tools?.some((tool) => tool.function.name === "draft_generate_plan"),
    false
  );
});

test("runUnifiedReactAgent defaults unmatched draft follow-up questions to summarize existing draft", async () => {
  const llmPayloads: Array<{ system?: string; user?: string; tools?: Array<{ function: { name: string } }> }> = [];
  const tools = new ToolRegistry();
  tools.register({
    name: "draft_generate_plan",
    description: "根据用户需求生成最小可用的原理图草案计划",
    parameters: { type: "object", properties: {}, additionalProperties: true },
    execute: async () => ({}),
  } as AgentTool);
  tools.register({
    name: "draft_preview_plan",
    description: "根据草案计划生成预览摘要",
    parameters: { type: "object", properties: {}, additionalProperties: true },
    execute: async () => ({}),
  } as AgentTool);
  tools.register({
    name: "llm_generate",
    description: "llm",
    parameters: { type: "object", properties: {}, additionalProperties: true },
    execute: async () => ({ output_text: "" }),
  } as AgentTool);

  const originalInvoke = tools.invoke.bind(tools);
  tools.invoke = (async (name: string, input: unknown) => {
    if (name === "llm_generate") {
      const payload = input as { messages?: Array<{ role: string; content: string }>; tools?: Array<{ function: { name: string } }> };
      llmPayloads.push({
        system: payload.messages?.find((item) => item.role === "system")?.content,
        user: payload.messages?.find((item) => item.role === "user")?.content,
        tools: payload.tools,
      });
      return {
        output_text:
          '{"type":"final","route":"chat","rationale":"answer existing draft follow-up","output":"这版草案目前偏最小化，后续可以继续补充音频前端。"}',
      } as any;
    }
    return originalInvoke(name, input);
  }) as typeof tools.invoke;

  const result = await runUnifiedReactAgent({
    taskType: "natural_chat",
    userQuery: "这个方案整体思路再说清楚一点",
    panelState: {
      loggedIn: true,
      agentRunState: "awaiting_confirmation",
      draftPreview: {
        title: "ESP32-S3 语音设备",
        rationale: "已有草案",
        componentRefs: ["U1", "U2", "J1"],
        netNames: ["5V", "VBAT", "3V3"],
        componentCount: 3,
        netCount: 3,
      },
      draftPlan: {
        title: "ESP32-S3 语音设备",
        rationale: "已有草案",
        components: [],
        pins: [],
        nets: [],
      } as DraftPlan,
      chatMessages: [],
    } as MainPanelState,
    context: createMinimalContext(),
    tools,
    allowedTools: ["draft_generate_plan", "draft_preview_plan", "llm_generate"],
  });

  assert.equal(result.result.naturalReply?.includes("整体思路"), false);
  assert.equal(
    llmPayloads[0]?.system?.includes("## 现有草案追问任务定义"),
    true
  );
  assert.equal(
    llmPayloads[0]?.tools?.some((tool) => tool.function.name === "draft_generate_plan"),
    false
  );
});

test("runUnifiedReactAgent treats draft confirmation revision request as draft refinement", async () => {
  const llmPayloads: Array<{ system?: string; user?: string; tools?: Array<{ function: { name: string } }> }> = [];
  const tools = new ToolRegistry();
  tools.register({
    name: "draft_generate_plan",
    description: "根据用户需求生成最小可用的原理图草案计划",
    parameters: { type: "object", properties: {}, additionalProperties: true },
    execute: async () => ({}),
  } as AgentTool);
  tools.register({
    name: "draft_preview_plan",
    description: "根据草案计划生成预览摘要",
    parameters: { type: "object", properties: {}, additionalProperties: true },
    execute: async () => ({}),
  } as AgentTool);
  tools.register({
    name: "llm_generate",
    description: "llm",
    parameters: { type: "object", properties: {}, additionalProperties: true },
    execute: async () => ({ output_text: "" }),
  } as AgentTool);

  const originalInvoke = tools.invoke.bind(tools);
  tools.invoke = (async (name: string, input: unknown) => {
    if (name === "llm_generate") {
      const payload = input as { messages?: Array<{ role: string; content: string }>; tools?: Array<{ function: { name: string } }> };
      llmPayloads.push({
        system: payload.messages?.find((item) => item.role === "system")?.content,
        user: payload.messages?.find((item) => item.role === "user")?.content,
        tools: payload.tools,
      });
      return {
        output_text:
          '{"type":"final","route":"draft","rationale":"revise existing draft","output":"## 已更新草案\\n- 新增电量计"}',
      } as any;
    }
    return originalInvoke(name, input);
  }) as typeof tools.invoke;

  await runUnifiedReactAgent({
    taskType: "natural_chat",
    userQuery: "在当前草案上增加电量计模块",
    panelState: {
      loggedIn: true,
      agentRunState: "awaiting_confirmation",
      draftPreview: {
        title: "ESP32-S3 语音设备",
        rationale: "已有草案",
        componentRefs: ["U1", "U2", "J1"],
        netNames: ["5V", "VBAT", "3V3"],
        componentCount: 3,
        netCount: 3,
      },
      draftPlan: {
        title: "ESP32-S3 语音设备",
        rationale: "已有草案",
        components: [],
        pins: [],
        nets: [],
      } as DraftPlan,
      chatMessages: [],
    } as MainPanelState,
    context: createMinimalContext(),
    tools,
    allowedTools: ["draft_generate_plan", "draft_preview_plan", "llm_generate"],
  });

  assert.equal(
    llmPayloads[0]?.system?.includes("## 现有草案修改任务定义"),
    true
  );
  assert.equal(
    llmPayloads[0]?.user?.includes("这是基于现有草案的修改请求"),
    true
  );
  assert.equal(
    llmPayloads[0]?.tools?.some((tool) => tool.function.name === "draft_generate_plan"),
    true
  );
});

test("runUnifiedReactAgent keeps draft component-count complaint in existing-draft follow-up mode without relying on keyword hardcoding", async () => {
  const llmPayloads: Array<{ system?: string; user?: string; tools?: Array<{ function: { name: string } }> }> = [];
  const tools = new ToolRegistry();
  tools.register({
    name: "draft_generate_plan",
    description: "根据用户需求生成最小可用的原理图草案计划",
    parameters: { type: "object", properties: {}, additionalProperties: true },
    execute: async () => ({}),
  } as AgentTool);
  tools.register({
    name: "draft_preview_plan",
    description: "根据草案计划生成预览摘要",
    parameters: { type: "object", properties: {}, additionalProperties: true },
    execute: async () => ({}),
  } as AgentTool);
  tools.register({
    name: "llm_generate",
    description: "llm",
    parameters: { type: "object", properties: {}, additionalProperties: true },
    execute: async () => ({ output_text: "" }),
  } as AgentTool);

  const originalInvoke = tools.invoke.bind(tools);
  tools.invoke = (async (name: string, input: unknown) => {
    if (name === "llm_generate") {
      const payload = input as { messages?: Array<{ role: string; content: string }>; tools?: Array<{ function: { name: string } }> };
      llmPayloads.push({
        system: payload.messages?.find((item) => item.role === "system")?.content,
        user: payload.messages?.find((item) => item.role === "user")?.content,
        tools: payload.tools,
      });
      return {
        output_text:
          '{"type":"final","route":"chat","rationale":"answer follow-up","output":"当前器件偏少，是因为上一版还是最小占位草案。"}',
      } as any;
    }
    return originalInvoke(name, input);
  }) as typeof tools.invoke;

  const result = await runUnifiedReactAgent({
    taskType: "natural_chat",
    userQuery: "这个为什么只找到4个器件？",
    panelState: {
      loggedIn: true,
      agentRunState: "awaiting_confirmation",
      draftPreview: {
        title: "ESP32-S3 语音设备",
        rationale: "已有草案",
        componentRefs: ["U1", "U2", "U3"],
        netNames: ["5V", "VBAT", "3V3", "GND"],
        componentCount: 3,
        netCount: 4,
      },
      draftPlan: {
        title: "ESP32-S3 语音设备",
        rationale: "已有草案",
        components: [],
        pins: [],
        nets: [],
      } as DraftPlan,
      chatMessages: [],
    } as MainPanelState,
    context: createMinimalContext(),
    tools,
    allowedTools: ["draft_generate_plan", "draft_preview_plan", "llm_generate"],
  });

  assert.equal(result.result.naturalReply?.includes("当前器件偏少"), true);
  assert.equal(
    llmPayloads[0]?.system?.includes("## 现有草案追问任务定义"),
    true
  );
  assert.equal(
    llmPayloads[0]?.tools?.some((tool) => tool.function.name === "draft_generate_plan"),
    false
  );
  assert.equal(
    llmPayloads[0]?.user?.includes("优先复用当前草案摘要直接回答"),
    true
  );
});

test("runUnifiedReactAgent treats draft confirmation risk question as risk analysis follow-up", async () => {
  const llmPayloads: Array<{ system?: string; user?: string; tools?: Array<{ function: { name: string } }> }> = [];
  const tools = new ToolRegistry();
  tools.register({
    name: "rules_validate_draft",
    description: "在应用前校验生成的原理图草案",
    parameters: { type: "object", properties: {}, additionalProperties: true },
    execute: async () => ({}),
  } as AgentTool);
  tools.register({
    name: "draft_generate_plan",
    description: "根据用户需求生成最小可用的原理图草案计划",
    parameters: { type: "object", properties: {}, additionalProperties: true },
    execute: async () => ({}),
  } as AgentTool);
  tools.register({
    name: "llm_generate",
    description: "llm",
    parameters: { type: "object", properties: {}, additionalProperties: true },
    execute: async () => ({ output_text: "" }),
  } as AgentTool);

  const originalInvoke = tools.invoke.bind(tools);
  tools.invoke = (async (name: string, input: unknown) => {
    if (name === "llm_generate") {
      const payload = input as { messages?: Array<{ role: string; content: string }>; tools?: Array<{ function: { name: string } }> };
      llmPayloads.push({
        system: payload.messages?.find((item) => item.role === "system")?.content,
        user: payload.messages?.find((item) => item.role === "user")?.content,
        tools: payload.tools,
      });
      return {
        output_text:
          '{"type":"final","route":"analysis","rationale":"review current draft risk","output":"## 风险复核\\n- 当前仍有阻断项"}',
      } as any;
    }
    return originalInvoke(name, input);
  }) as typeof tools.invoke;

  await runUnifiedReactAgent({
    taskType: "natural_chat",
    userQuery: "这版草案还有哪些风险，为什么不能直接应用？",
    panelState: {
      loggedIn: true,
      agentRunState: "awaiting_confirmation",
      draftPreview: {
        title: "ESP32-S3 语音设备",
        rationale: "已有草案",
        componentRefs: ["U1", "U2", "J1"],
        netNames: ["5V", "VBAT", "3V3"],
        componentCount: 3,
        netCount: 3,
      },
      draftPlan: {
        title: "ESP32-S3 语音设备",
        rationale: "已有草案",
        components: [],
        pins: [],
        nets: [],
      } as DraftPlan,
      chatMessages: [],
    } as MainPanelState,
    context: createMinimalContext(),
    tools,
    allowedTools: ["rules_validate_draft", "draft_generate_plan", "llm_generate"],
  });

  assert.equal(
    llmPayloads[0]?.system?.includes("## 现有草案风险复核任务定义"),
    true
  );
  assert.equal(
    llmPayloads[0]?.user?.includes("这是基于现有草案的风险复核请求"),
    true
  );
  assert.equal(
    llmPayloads[0]?.tools?.some((tool) => tool.function.name === "rules_validate_draft"),
    true
  );
});

test("runReActLoop settles tool_call react event status after tool result", async () => {
  const deps: ReactAgentDeps = {
    task: { type: "natural_chat", userQuery: "分析当前原理图有什么问题" },
    allowedTools: ["editor_get_current_context"],
    listToolNames: () => ["editor_get_current_context", "llm_generate"],
    invokeTool: async (toolName) => {
      if (toolName === "llm_generate") {
        return {
          output_text: "",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "editor_get_current_context",
                arguments: "{}",
              },
            },
          ],
        } as never;
      }
      if (toolName === "editor_get_current_context") {
        return createMinimalContext() as never;
      }
      throw new Error(`unexpected tool: ${toolName}`);
    },
  };

  const state = createState();
  await runReActLoop({
    deps,
    state,
    system: "system",
    user: "user",
    toolDefinitions: [{
      name: "editor_get_current_context",
      description: "读取当前编辑器中的原理图上下文",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    }],
    maxIterations: 1,
    mapToolToStepKind: () => "context",
  });

  const toolCallEvent = state.reactEvents.find((event) => event.kind === "tool_call");
  assert.ok(toolCallEvent);
  assert.equal(toolCallEvent?.status, "done");
});

test("runReActLoop blocks draft final until required draft tools are completed", async () => {
  let llmCalls = 0;
  const toolCalls: string[] = [];
  const deps: ReactAgentDeps = {
    task: { type: "natural_chat", userQuery: "帮我设计一个基于ESP32-S3的语音设备原理图" },
    allowedTools: ["draft_generate_plan", "draft_preview_plan"],
    listToolNames: () => ["draft_generate_plan", "draft_preview_plan", "llm_generate"],
    invokeTool: async (toolName) => {
      if (toolName === "llm_generate") {
        llmCalls += 1;
        if (llmCalls === 1) {
          return {
            output_text: "",
            tool_calls: [
              {
                id: "call_plan",
                type: "function",
                function: {
                  name: "draft_generate_plan",
                  arguments: JSON.stringify({
                    userQuery: "帮我设计一个基于ESP32-S3的语音设备原理图",
                    spec: {
                      systemType: "esp32_s3_voice_device",
                      title: "ESP32-S3 Voice Device",
                      rationale: "structured",
                      components: [],
                      nets: [],
                      connections: [],
                    },
                  }),
                },
              },
            ],
          } as never;
        }
        if (llmCalls === 2) {
          return {
            output_text: '{"type":"final","route":"draft","rationale":"done","output":"no preview"}',
          } as never;
        }
        if (llmCalls === 3) {
          return {
            output_text: "",
            tool_calls: [
              {
                id: "call_preview",
                type: "function",
                function: {
                  name: "draft_preview_plan",
                  arguments: "{}",
                },
              },
            ],
          } as never;
        }
        return {
          output_text: '{"type":"final","route":"draft","rationale":"done","output":"with preview"}',
        } as never;
      }
      if (toolName === "draft_generate_plan") {
        toolCalls.push("draft_generate_plan");
        return { title: "ESP32-S3 Voice Device", components: [], pins: [], nets: [] } as never;
      }
      if (toolName === "draft_preview_plan") {
        toolCalls.push("draft_preview_plan");
        return { title: "ESP32-S3 Voice Device", componentCount: 0, netCount: 0 } as never;
      }
      throw new Error(`unexpected tool: ${toolName}`);
    },
  };

  const result = await runReActLoop({
    deps,
    state: createState(),
    system: "system",
    user: "user",
    toolDefinitions: [
      {
        name: "draft_generate_plan",
        description: "根据用户需求生成最小可用的原理图草案计划",
        parameters: { type: "object", properties: { userQuery: { type: "string" }, spec: { type: "object" } }, required: ["userQuery"], additionalProperties: true },
      },
      {
        name: "draft_preview_plan",
        description: "根据草案计划生成预览摘要",
        parameters: { type: "object", properties: { plan: { type: "object" } }, additionalProperties: true },
      },
    ],
    requiredTools: ["draft_generate_plan", "draft_preview_plan"],
  });

  assert.equal(llmCalls, 4);
  assert.equal(result.finalRoute, "draft");
  assert.equal(result.finalOutput, "with preview");
  assert.deepEqual(toolCalls, ["draft_generate_plan", "draft_preview_plan"]);
  assert.deepEqual(result.observations.map((item) => item.tool), ["draft_generate_plan", "draft_preview_plan"]);
});

test("runUnifiedReactAgent forces analysis queries to fetch context and run checks", async () => {
  const registry = new ToolRegistry();
  const llmRequestKinds: string[] = [];
  const executedTools: string[] = [];
  let reactLlmCalls = 0;
  let firstReactToolNames: string[] = [];
  let firstReactToolsStrictFlags: boolean[] = [];

  const tools: AgentTool[] = [
    {
      name: "llm_generate",
      description: "生成 AI 回复",
      parameters: {
        type: "object",
        properties: {
          messages: { type: "array", items: { type: "object" } },
          tools: { type: "array", items: { type: "object" } },
          tool_choice: {},
        },
        required: ["messages"],
        additionalProperties: true,
      },
      execute: async (input: unknown) => {
        const payload = input as { tools?: unknown[]; messages?: Array<{ role: string; content: string }> };
        llmRequestKinds.push(Array.isArray(payload.tools) ? "react" : "final");
        if (Array.isArray(payload.tools)) {
          if (firstReactToolNames.length === 0) {
            firstReactToolNames = payload.tools.map((item) => ((item as { function?: { name?: string } }).function?.name || ""));
            firstReactToolsStrictFlags = payload.tools.map((item) => Boolean((item as { function?: { strict?: boolean } }).function?.strict));
          }
          reactLlmCalls += 1;
          if (reactLlmCalls === 1) {
            return { output_text: '{"type":"final","route":"chat","rationale":"try_finish_early"}' };
          }
          if (reactLlmCalls === 2) {
            return {
              output_text: "",
              tool_calls: [{ function: { name: "editor_get_current_context", arguments: "{}" } }],
            };
          }
          if (reactLlmCalls === 3) {
            return {
              output_text: "",
              tool_calls: [{ function: { name: "rules_run_schematic_checks", arguments: "{}" } }],
            };
          }
          return { output_text: '{"type":"final","route":"analysis","rationale":"done","output":"最终报告"}' };
        }
        return { output_text: "最终报告" };
      },
    },
    {
      name: "editor_get_current_context",
      description: "读取当前编辑器中的原理图上下文",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => {
        executedTools.push("editor_get_current_context");
        return createMinimalContext();
      },
    },
    {
      name: "rules_run_schematic_checks",
      description: "执行本地原理图规则检查，发现连线与属性问题",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => {
        executedTools.push("rules_run_schematic_checks");
        return { issues: [], summary: "ok" };
      },
    },
  ];

  for (const tool of tools) {
    registry.register(tool);
  }

  const panelState = { loggedIn: true, componentCount: 158, netCount: 165, selectionCount: 0 } as MainPanelState;
  const { result } = await runUnifiedReactAgent({
    userQuery: "分析当前原理图有什么问题",
    panelState,
    tools: registry,
    allowedTools: tools.map((tool) => tool.name),
  });

  assert.deepEqual(executedTools, ["editor_get_current_context", "rules_run_schematic_checks"]);
  assert.deepEqual(llmRequestKinds, ["react", "react", "react", "react"]);
  assert.equal(result.checkResult?.summary, "ok");
  assert.equal(result.analysisMarkdown, "最终报告");
  assert.deepEqual(firstReactToolNames, ["editor_get_current_context", "rules_run_schematic_checks"]);
  assert.deepEqual(firstReactToolsStrictFlags, [true, true]);
});

test("runUnifiedReactAgent includes prior session chat history in the first llm request", async () => {
  const registry = new ToolRegistry();
  const llmMessages: Array<Array<{ role: string; content: string | null }>> = [];

  const tools: AgentTool[] = [
    {
      name: "llm_generate",
      description: "生成 AI 回复",
      parameters: {
        type: "object",
        properties: {
          messages: { type: "array", items: { type: "object" } },
          tools: { type: "array", items: { type: "object" } },
          tool_choice: {},
        },
        required: ["messages"],
        additionalProperties: true,
      },
      execute: async (input: unknown) => {
        const payload = input as { messages?: Array<{ role: string; content: string | null }> };
        llmMessages.push((payload.messages ?? []).map((item) => ({ role: item.role, content: item.content ?? null })));
        return { output_text: '{"type":"final","route":"chat","rationale":"done","output":"最终答复"}' };
      },
    },
  ];

  for (const tool of tools) {
    registry.register(tool);
  }

  const panelState = {
    loggedIn: true,
    chatMessages: [
      { role: "user", content: "第一轮问题" },
      { role: "assistant", content: "第一轮回答" },
      { role: "user", content: "第二轮追问" },
      { role: "assistant", content: "第二轮回答" },
      { role: "assistant", content: "正在思考...", streaming: true },
    ],
  } as MainPanelState;

  const { result } = await runUnifiedReactAgent({
    userQuery: "第三轮问题",
    panelState,
    tools: registry,
    allowedTools: tools.map((tool) => tool.name),
  });

  assert.equal(result.naturalReply, "最终答复");
  assert.equal(llmMessages.length, 1);
  assert.deepEqual(llmMessages[0], [
    { role: "system", content: llmMessages[0][0]?.content ?? null },
    { role: "user", content: "第一轮问题" },
    { role: "assistant", content: "第一轮回答" },
    { role: "user", content: "第二轮追问" },
    { role: "assistant", content: "第二轮回答" },
    {
      role: "user",
      content:
        "用户输入：第三轮问题\n\n可用工具：\n\n这是分析类任务：先调用 editor_get_current_context，再调用 rules_run_schematic_checks；如需网表级证据，再调用 schematic_review。完成这些步骤前不要直接回答。",
    },
  ]);
});

test("runUnifiedReactAgent keeps up to 20 prior meaningful messages", async () => {
  const registry = new ToolRegistry();
  const llmMessages: Array<Array<{ role: string; content: string | null }>> = [];

  registry.register({
    name: "llm_generate",
    description: "生成 AI 回复",
    parameters: {
      type: "object",
      properties: {
        messages: { type: "array", items: { type: "object" } },
      },
      required: ["messages"],
      additionalProperties: true,
    },
    execute: async (input: unknown) => {
      const payload = input as { messages?: Array<{ role: string; content: string | null }> };
      llmMessages.push((payload.messages ?? []).map((item) => ({ role: item.role, content: item.content ?? null })));
      return { output_text: '{"type":"final","route":"chat","rationale":"done","output":"ok"}' };
    },
  });

  const chatMessages: NonNullable<MainPanelState["chatMessages"]> = [];
  for (let i = 1; i <= 24; i += 1) {
    chatMessages.push({ role: "user", content: `用户消息 ${i}` });
  }

  await runUnifiedReactAgent({
    userQuery: "当前问题",
    panelState: { loggedIn: true, chatMessages } as MainPanelState,
    tools: registry,
    allowedTools: ["llm_generate"],
  });

  assert.equal(llmMessages.length, 1);
  assert.equal(llmMessages[0].length, 22);
  assert.deepEqual(llmMessages[0].slice(1, -1), Array.from({ length: 20 }, (_, index) => ({
    role: "user",
    content: `用户消息 ${index + 5}`,
  })));
});

test("runUnifiedReactAgent filters non-meaningful assistant history messages", async () => {
  const registry = new ToolRegistry();
  const llmMessages: Array<Array<{ role: string; content: string | null }>> = [];

  registry.register({
    name: "llm_generate",
    description: "生成 AI 回复",
    parameters: {
      type: "object",
      properties: {
        messages: { type: "array", items: { type: "object" } },
      },
      required: ["messages"],
      additionalProperties: true,
    },
    execute: async (input: unknown) => {
      const payload = input as { messages?: Array<{ role: string; content: string | null }> };
      llmMessages.push((payload.messages ?? []).map((item) => ({ role: item.role, content: item.content ?? null })));
      return { output_text: '{"type":"final","route":"chat","rationale":"done","output":"ok"}' };
    },
  });

  await runUnifiedReactAgent({
    userQuery: "继续问",
    panelState: {
      loggedIn: true,
      chatMessages: [
        { role: "user", content: "上一个问题" },
        { role: "assistant", content: "正在思考..." },
        { role: "assistant", content: "处理中..." },
        { role: "assistant", content: "这是有效回答，包含明确结论和建议。" },
      ],
    } as MainPanelState,
    tools: registry,
    allowedTools: ["llm_generate"],
  });

  assert.equal(llmMessages.length, 1);
  assert.deepEqual(llmMessages[0].slice(1, -1), [
    { role: "user", content: "上一个问题" },
    { role: "assistant", content: "这是有效回答，包含明确结论和建议。" },
  ]);
});

test("runUnifiedReactAgent compresses long analysis history to summary and priority sections", async () => {
  const registry = new ToolRegistry();
  const llmMessages: Array<Array<{ role: string; content: string | null }>> = [];

  registry.register({
    name: "llm_generate",
    description: "生成 AI 回复",
    parameters: {
      type: "object",
      properties: {
        messages: { type: "array", items: { type: "object" } },
      },
      required: ["messages"],
      additionalProperties: true,
    },
    execute: async (input: unknown) => {
      const payload = input as { messages?: Array<{ role: string; content: string | null }> };
      llmMessages.push((payload.messages ?? []).map((item) => ({ role: item.role, content: item.content ?? null })));
      return { output_text: '{"type":"final","route":"chat","rationale":"done","output":"ok"}' };
    },
  });

  const longReport = [
    "# 工具与依据",
    "这里是很长的工具说明。",
    "",
    "## 结论摘要",
    "高风险：电源反馈网络可能配置错误。",
    "中风险：若干器件封装缺失。",
    "",
    "## 详细审查报告",
    "这里是非常长非常长非常长的详细表格说明。".repeat(200),
    "",
    "## 优先整改建议",
    "P0：先修正关键电源链路。",
    "P1：补全封装与丝印信息。",
  ].join("\n");

  await runUnifiedReactAgent({
    userQuery: "继续分析",
    panelState: {
      loggedIn: true,
      chatMessages: [
        { role: "assistant", content: longReport },
      ],
    } as MainPanelState,
    tools: registry,
    allowedTools: ["llm_generate"],
  });

  assert.equal(llmMessages.length, 1);
  assert.deepEqual(llmMessages[0].slice(1, -1), [
    {
      role: "assistant",
      content: "## 结论摘要\n高风险：电源反馈网络可能配置错误。\n中风险：若干器件封装缺失。\n\n## 优先整改建议\nP0：先修正关键电源链路。\nP1：补全封装与丝印信息。",
    },
  ]);
});

test("runUnifiedReactAgent favors user history for chat route when trimming to 20 messages", async () => {
  const registry = new ToolRegistry();
  const llmMessages: Array<Array<{ role: string; content: string | null }>> = [];

  registry.register({
    name: "llm_generate",
    description: "生成 AI 回复",
    parameters: {
      type: "object",
      properties: {
        messages: { type: "array", items: { type: "object" } },
      },
      required: ["messages"],
      additionalProperties: true,
    },
    execute: async (input: unknown) => {
      const payload = input as { messages?: Array<{ role: string; content: string | null }> };
      llmMessages.push((payload.messages ?? []).map((item) => ({ role: item.role, content: item.content ?? null })));
      return { output_text: '{"type":"final","route":"chat","rationale":"done","output":"ok"}' };
    },
  });

  const chatMessages: NonNullable<MainPanelState["chatMessages"]> = [];
  for (let i = 1; i <= 15; i += 1) {
    chatMessages.push({ role: "user", content: `用户问题 ${i}` });
    chatMessages.push({ role: "assistant", content: `助手回答 ${i}` });
  }

  await runUnifiedReactAgent({
    userQuery: "继续聊聊这个方案",
    panelState: { loggedIn: true, chatMessages } as MainPanelState,
    tools: registry,
    allowedTools: ["llm_generate"],
  });

  const history = llmMessages[0].slice(1, -1);
  assert.equal(history.length, 20);
  assert.equal(history.filter((item) => item.role === "user").length, 14);
  assert.equal(history.filter((item) => item.role === "assistant").length, 6);
});

test("runUnifiedReactAgent favors assistant history for analysis route when trimming to 20 messages", async () => {
  const registry = new ToolRegistry();
  const llmMessages: Array<Array<{ role: string; content: string | null }>> = [];

  registry.register({
    name: "llm_generate",
    description: "生成 AI 回复",
    parameters: {
      type: "object",
      properties: {
        messages: { type: "array", items: { type: "object" } },
      },
      required: ["messages"],
      additionalProperties: true,
    },
    execute: async (input: unknown) => {
      const payload = input as { messages?: Array<{ role: string; content: string | null }> };
      llmMessages.push((payload.messages ?? []).map((item) => ({ role: item.role, content: item.content ?? null })));
      return { output_text: '{"type":"final","route":"chat","rationale":"done","output":"ok"}' };
    },
  });

  const chatMessages: NonNullable<MainPanelState["chatMessages"]> = [];
  for (let i = 1; i <= 15; i += 1) {
    chatMessages.push({ role: "user", content: `分析问题 ${i}` });
    chatMessages.push({ role: "assistant", content: `分析结论 ${i}` });
  }

  await runUnifiedReactAgent({
    userQuery: "分析一下最新这个原理图问题",
    panelState: { loggedIn: true, chatMessages } as MainPanelState,
    tools: registry,
    allowedTools: ["llm_generate"],
  });

  const history = llmMessages[0].slice(1, -1);
  assert.equal(history.length, 20);
  assert.equal(history.filter((item) => item.role === "assistant").length, 12);
  assert.equal(history.filter((item) => item.role === "user").length, 8);
});

test("planContextCompaction keeps the most recent 3 turns uncompressed after 20 turns", () => {
  const messages: NonNullable<MainPanelState["chatMessages"]> = [];
  for (let i = 1; i <= 20; i += 1) {
    messages.push({ role: "user", content: `用户第 ${i} 轮` });
    messages.push({ role: "assistant", content: `助手第 ${i} 轮` });
  }

  const plan = planContextCompaction(messages);

  assert.equal(plan.shouldCompact, true);
  assert.equal(plan.recentMessages.length, 6);
  assert.deepEqual(plan.recentMessages.map((item) => item.content), [
    "用户第 18 轮",
    "助手第 18 轮",
    "用户第 19 轮",
    "助手第 19 轮",
    "用户第 20 轮",
    "助手第 20 轮",
  ]);
  assert.equal(plan.olderMessages.length, 34);
});

test("planContextCompaction does not trigger below 20 turns", () => {
  const messages: NonNullable<MainPanelState["chatMessages"]> = [];
  for (let i = 1; i <= 19; i += 1) {
    messages.push({ role: "user", content: `用户第 ${i} 轮` });
    messages.push({ role: "assistant", content: `助手第 ${i} 轮` });
  }

  const plan = planContextCompaction(messages);

  assert.equal(plan.shouldCompact, false);
  assert.equal(plan.olderMessages.length, 0);
  assert.equal(plan.recentMessages.length, 38);
});

test("runUnifiedReactAgent reuses persisted draftPlan for follow-up draft preview", async () => {
  const registry = new ToolRegistry();
  const persistedDraftPlan: DraftPlan = {
    title: "5V LED Indicator Draft",
    rationale: "5V -> R1 -> D1 -> GND",
    components: [],
    pins: [],
    nets: [],
  };
  let previewInput: unknown;
  let llmCalls = 0;

  registry.register({
    name: "llm_generate",
    description: "生成 AI 回复",
    parameters: {
      type: "object",
      properties: {
        messages: { type: "array", items: { type: "object" } },
      },
      required: ["messages"],
      additionalProperties: true,
    },
    execute: async () => {
      llmCalls += 1;
      if (llmCalls === 1) {
        return {
          output_text: "",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "draft_preview_plan",
                arguments: "{}",
              },
            },
          ],
        };
      }
      return {
        output_text: '{"type":"final","route":"draft","rationale":"done","output":"ok"}',
      };
    },
  });

  registry.register({
    name: "draft_preview_plan",
    description: "根据草案计划生成预览摘要",
    parameters: {
      type: "object",
      properties: {
        plan: { type: "object" },
      },
      additionalProperties: true,
    },
    execute: async (input: unknown) => {
      previewInput = input;
      return {
        title: "5V LED Indicator Draft",
        rationale: "Generated a minimal LED indicator draft based on the user request.",
        componentRefs: ["J1", "R1", "D1"],
        netNames: ["5V", "LED_ANODE", "GND"],
        componentCount: 3,
        netCount: 3,
      };
    },
  } satisfies AgentTool);

  const { result } = await runUnifiedReactAgent({
    userQuery: "上面展示的J1,R1,D1是什么器件，这个应该显示清楚，剩下的确认操作",
    panelState: { loggedIn: true, draftPlan: persistedDraftPlan } as MainPanelState,
    context: createMinimalContext(),
    tools: registry,
    allowedTools: ["llm_generate", "draft_preview_plan"],
  });

  assert.deepEqual(previewInput, { plan: persistedDraftPlan });
  assert.equal(result.draftPreview?.title, "5V LED Indicator Draft");
  assert.deepEqual(result.draftPreview?.componentRefs, ["J1", "R1", "D1"]);
});

test("runUnifiedReactAgent can drive draft generation through rag -> draft plan with inline spec", async () => {
  const registry = new ToolRegistry();
  const toolCalls: string[] = [];
  let llmCalls = 0;
  let draftPlanInput: any;
  let firstLlmTools: any[] = [];

  registry.register({
    name: "llm_generate",
    description: "生成 AI 回复",
    parameters: { type: "object", properties: { messages: { type: "array", items: { type: "object" } } }, additionalProperties: true },
    execute: async (input: any) => {
      if (llmCalls === 0) {
        firstLlmTools = Array.isArray(input?.tools) ? input.tools : [];
      }
      llmCalls += 1;
      if (llmCalls === 1) {
        return {
          output_text: "",
          tool_calls: [
            {
              id: "call_rag",
              type: "function",
              function: { name: "rag_search", arguments: JSON.stringify({ query: "ESP32-S3 语音设备模板" }) },
            },
          ],
        };
      }
      if (llmCalls === 2) {
        return {
          output_text: "",
          tool_calls: [
            {
              id: "call_plan",
              type: "function",
              function: {
                name: "draft_generate_plan",
                arguments: JSON.stringify({
                  userQuery: "生成基于esp32-s3的小智语音聊天设备原理图",
                  spec: {
                    systemType: "esp32_s3_voice_device",
                    title: "ESP32-S3 Voice Chat Device",
                    rationale: "spec approved",
                    components: [
                      {
                        id: "draft-u1",
                        ref: "U1",
                        role: "mcu_module",
                        name: "ESP32-S3 Module",
                        value: "ESP32-S3",
                        packageName: "RF-MODULE_ESP32-S3-WROOM-1",
                        searchQuery: "ESP32-S3-WROOM-1",
                        pins: [{ id: "draft-u1-3v3", pinName: "3V3", electricalType: "power_in" }],
                      },
                    ],
                    nets: [{ id: "net-3v3", name: "3V3", isPower: true }],
                    connections: [{ netName: "3V3", pinIds: ["draft-u1-3v3"] }],
                  },
                }),
              },
            },
          ],
        };
      }
      if (llmCalls === 3) {
        return {
          output_text: "",
          tool_calls: [
            {
              id: "call_preview",
              type: "function",
              function: { name: "draft_preview_plan", arguments: "{}" },
            },
          ],
        };
      }
      return {
        output_text: '{"type":"final","route":"draft","rationale":"done","output":"ok"}',
      };
    },
  } satisfies AgentTool);

  registry.register({
    name: "rag_search",
    description: "检索知识",
    parameters: { type: "object", properties: { query: { type: "string" } }, additionalProperties: true },
    execute: async () => {
      toolCalls.push("rag_search");
      return {
        results: [{ title: "voice ref", snippet: "ESP32-S3 + codec + USB-C", source_ref: "kb://voice" }],
      };
    },
  } satisfies AgentTool);

  registry.register({
    name: "draft_generate_plan",
    description: "生成草案计划",
    parameters: {
      type: "object",
      properties: {
        userQuery: { type: "string" },
        spec: { type: "object" },
        planningMode: { type: "string", enum: ["auto", "structured_spec_required"] },
      },
      additionalProperties: true,
    },
    execute: async (input: any) => {
      toolCalls.push("draft_generate_plan");
      draftPlanInput = input;
      return {
        title: input.spec.title,
        rationale: input.spec.rationale,
        components: [{ id: "draft-u1", ref: "U1", properties: {} }],
        pins: [{ id: "draft-u1-3v3", componentId: "draft-u1", pinName: "3V3" }],
        nets: [{ id: "net-3v3", name: "3V3", nodeIds: ["draft-u1-3v3"], isPower: true }],
      };
    },
  } satisfies AgentTool);

  registry.register({
    name: "draft_preview_plan",
    description: "预览草案计划",
    parameters: { type: "object", properties: { plan: { type: "object" } }, additionalProperties: true },
    execute: async () => {
      toolCalls.push("draft_preview_plan");
      return {
        title: "ESP32-S3 Voice Chat Device",
        rationale: "spec approved",
        componentRefs: ["U1"],
        netNames: ["3V3"],
        componentCount: 1,
        netCount: 1,
      };
    },
  } satisfies AgentTool);

  const { result } = await runUnifiedReactAgent({
    userQuery: "生成基于esp32-s3的小智语音聊天设备原理图",
    panelState: { loggedIn: true } as MainPanelState,
    context: createMinimalContext(),
    tools: registry,
    allowedTools: ["llm_generate", "rag_search", "draft_generate_plan", "draft_preview_plan"],
  });

  assert.equal(result.draftPreview?.title, "ESP32-S3 Voice Chat Device");
  assert.deepEqual(toolCalls, ["rag_search", "draft_generate_plan", "draft_preview_plan"]);
  assert.equal(draftPlanInput.planningMode, "structured_spec_required");
  const draftTool = firstLlmTools.find((tool) => tool?.function?.name === "draft_generate_plan");
  assert.deepEqual(draftTool?.function?.parameters?.properties?.planningMode?.enum, ["auto", "structured_spec_required"]);
});

test("runUnifiedReactAgent does not fake draft success when structured spec is missing", async () => {
  const registry = new ToolRegistry();
  let llmCalls = 0;

  registry.register({
    name: "llm_generate",
    description: "生成 AI 回复",
    parameters: { type: "object", properties: { messages: { type: "array", items: { type: "object" } } }, additionalProperties: true },
    execute: async () => {
      llmCalls += 1;
      if (llmCalls === 1) {
        return {
          output_text: "",
          tool_calls: [
            {
              id: "call_plan_without_spec",
              type: "function",
              function: {
                name: "draft_generate_plan",
                arguments: JSON.stringify({
                  userQuery: "生成基于esp32-s3的小智语音聊天设备原理图",
                }),
              },
            },
          ],
        };
      }
      return {
        output_text: '{"type":"final","route":"draft","rationale":"failed as expected","output":"草案生成失败，缺少结构化 spec。"}',
      };
    },
  } satisfies AgentTool);

  registry.register({
    name: "draft_generate_plan",
    description: "生成草案计划",
    parameters: {
      type: "object",
      properties: {
        userQuery: { type: "string" },
        spec: { type: "object" },
        planningMode: { type: "string", enum: ["auto", "structured_spec_required"] },
      },
      additionalProperties: true,
    },
    execute: async (input: any) => {
      if (!input.spec && input.planningMode === "structured_spec_required") {
        throw new Error("planningMode=structured_spec_required requires llm-authored spec before draft_generate_plan");
      }
      return {
        title: "unexpected success",
        rationale: "unexpected success",
        components: [],
        pins: [],
        nets: [],
      };
    },
  } satisfies AgentTool);

  const { result } = await runUnifiedReactAgent({
    userQuery: "生成基于esp32-s3的小智语音聊天设备原理图",
    panelState: { loggedIn: true } as MainPanelState,
    context: createMinimalContext(),
    tools: registry,
    allowedTools: ["llm_generate", "draft_generate_plan"],
  });

  assert.equal(result.draftPlan, undefined);
  assert.equal(result.draftPreview, undefined);
  assert.equal(result.naturalReply, undefined);
  assert.equal(result.analysisMarkdown, undefined);
  assert.equal(result.toolTraces?.some((item) => item.toolName === "draft_generate_plan" && item.status === "blocked"), true);
  assert.equal(
    result.reactEvents?.some((event) => event.kind === "observation" && event.status === "failed" && /structured_spec_required/.test(event.text)),
    true
  );
});

test("runUnifiedReactAgent honors explicit schematic_draft taskType over query keywords", async () => {
  const registry = new ToolRegistry();
  const toolCalls: string[] = [];
  let llmCalls = 0;

  registry.register({
    name: "llm_generate",
    description: "生成 AI 回复",
    parameters: { type: "object", properties: { messages: { type: "array", items: { type: "object" } } }, additionalProperties: true },
    execute: async () => {
      llmCalls += 1;
      if (llmCalls === 1) {
        return {
          output_text: "",
          tool_calls: [
            {
              id: "call_plan",
              type: "function",
              function: {
                name: "draft_generate_plan",
                arguments: JSON.stringify({
                  userQuery: "继续这个方案",
                  spec: {
                    systemType: "esp32_s3_voice_device",
                    title: "ESP32-S3 Voice Chat Device",
                    rationale: "spec approved",
                    components: [],
                    nets: [],
                    connections: [],
                  },
                }),
              },
            },
          ],
        };
      }
      if (llmCalls === 2) {
        return {
          output_text: "",
          tool_calls: [
            {
              id: "call_preview",
              type: "function",
              function: { name: "draft_preview_plan", arguments: "{}" },
            },
          ],
        };
      }
      return {
        output_text: '{"type":"final","route":"draft","rationale":"done","output":"ok"}',
      };
    },
  } satisfies AgentTool);

  registry.register({
    name: "draft_generate_plan",
    description: "生成草案计划",
    parameters: {
      type: "object",
      properties: {
        userQuery: { type: "string" },
        spec: { type: "object" },
        planningMode: { type: "string", enum: ["auto", "structured_spec_required"] },
      },
      additionalProperties: true,
    },
    execute: async (input: any) => {
      toolCalls.push(`draft_generate_plan:${input.planningMode}`);
      return {
        title: input.spec.title,
        rationale: input.spec.rationale,
        components: [],
        pins: [],
        nets: [],
      };
    },
  } satisfies AgentTool);

  registry.register({
    name: "draft_preview_plan",
    description: "预览草案计划",
    parameters: { type: "object", properties: { plan: { type: "object" } }, additionalProperties: true },
    execute: async () => {
      toolCalls.push("draft_preview_plan");
      return {
        title: "ESP32-S3 Voice Chat Device",
        rationale: "spec approved",
        componentRefs: [],
        netNames: [],
        componentCount: 0,
        netCount: 0,
      };
    },
  } satisfies AgentTool);

  const { result } = await runUnifiedReactAgent({
    taskType: "schematic_draft",
    userQuery: "继续这个方案",
    panelState: { loggedIn: true } as MainPanelState,
    context: createMinimalContext(),
    tools: registry,
    allowedTools: ["llm_generate", "draft_generate_plan", "draft_preview_plan"],
  });

  assert.equal(result.draftPreview?.title, "ESP32-S3 Voice Chat Device");
  assert.deepEqual(toolCalls, ["draft_generate_plan:structured_spec_required", "draft_preview_plan"]);
});
