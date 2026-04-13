import type { AgentStepState, AgentToolTrace, AgentWorkingMemory } from "../shared/agentTypes";
import type { AgentReactEvent, ReactAgentDeps, ReactAgentState } from "./reactTypes";
import type { LlmMessage, LlmToolCall } from "../../services/llm/llmProxyClient";
import { throwIfCancelled, isCancelledError } from "./cancelledError";

type ReActDecision =
  | { type: "action"; tool: string; input?: unknown; rationale?: string }
  | { type: "final"; route?: "chat" | "analysis" | "draft"; rationale?: string; output?: string }
  | { type: "retry"; rationale?: string };

export interface ReActLoopResult {
  toolTraces: AgentToolTrace[];
  observations: Array<{ tool: string; summary: string }>;
  workingMemory: AgentWorkingMemory;
  finalOutput?: string;
  finalRationale?: string;
  finalRoute?: "chat" | "analysis" | "draft";
}

export async function runReActLoop(input: {
  deps: ReactAgentDeps;
  state: ReactAgentState;
  system: string;
  user: string;
  historyMessages?: LlmMessage[];
  toolDefinitions?: Array<{ name: string; description: string; parameters?: unknown }>;
  maxIterations?: number;
  requiredTools?: string[];
  // Allow the host to inject state updates (for UI streaming)
  onProgress?: (detail: string) => void;
  onThought?: (thought: string) => void;
  mapToolToStepKind?: (toolName: string) => AgentStepState["kind"] | undefined;
  // Override tool input before execution (e.g. inject context / reuse prior observations).
  prepareToolInput?: (toolName: string, llmInput: unknown) => unknown;
  formatObservation?: (toolName: string, output: unknown) => { summary: string; messageForModel: string };
  onToolResult?: (toolName: string, output: unknown) => void;
  specialTools?: Record<string, (args: {
    toolName: string;
    toolInput: unknown;
    iteration: number;
    messages: LlmMessage[];
  }) => Promise<{ output: unknown; observationForModel?: string; observationForUi?: string }>>;
}): Promise<ReActLoopResult> {
  const {
    deps,
    state,
    system,
    user,
    historyMessages = [],
    toolDefinitions = [],
    maxIterations = 10,
    requiredTools = [],
    onProgress,
    onThought,
    mapToolToStepKind,
    prepareToolInput,
    formatObservation,
    onToolResult,
    specialTools,
  } = input;

  const observations: Array<{ tool: string; summary: string }> = [];
  const usedTools = new Set<string>();
  const ensureNotCancelled = () => throwIfCancelled(deps.signal, deps.isCancelled);

  const messages: LlmMessage[] = [
    { role: "system", content: system },
    ...historyMessages,
    { role: "user", content: user },
  ];

  const normalizeToolName = (name: string) => String(name || "").trim();
  const stripFinalControlPayload = (text: string): string => {
    const raw = String(text || "");
    const controlPrefixes = [
      /([\s\S]*?)(?:\n|\r|^)\s*Final:\s*\{/u,
      /([\s\S]*?)(?:\n|\r|^)\s*\{\s*"type"\s*:\s*"final"/u,
    ];
    for (const pattern of controlPrefixes) {
      const match = raw.match(pattern);
      if (match) {
        return match[1] ?? "";
      }
    }
    return raw;
  };

  const normalizeTodoStatus = (value: unknown): "pending" | "running" | "done" | "failed" | "skipped" => {
    const raw = String(value || "").trim().toLowerCase();
    if (raw === "not-started" || raw === "pending") return "pending";
    if (raw === "in-progress" || raw === "running") return "running";
    if (raw === "completed" || raw === "done") return "done";
    if (raw === "failed") return "failed";
    if (raw === "skipped") return "skipped";
    return "pending";
  };

  const normalizeTodoToolInput = (raw: unknown): unknown => {
    if (!raw || typeof raw !== "object") {
      return { action: "create", tasks: [] };
    }
    const inputRecord = raw as Record<string, unknown>;
    if (Array.isArray(inputRecord.tasks)) {
      return {
        action: typeof inputRecord.action === "string" ? inputRecord.action : undefined,
        tasks: inputRecord.tasks
          .map((item) => {
            if (typeof item === "string") return item;
            if (!item || typeof item !== "object") return null;
            const row = item as Record<string, unknown>;
            const text = String(row.text || "").trim();
            if (!text) return null;
            return { text, status: normalizeTodoStatus(row.status) };
          })
          .filter(Boolean),
      };
    }
    if (Array.isArray(inputRecord.todoList)) {
      return {
        action: typeof inputRecord.action === "string" ? inputRecord.action : undefined,
        tasks: inputRecord.todoList
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const row = item as Record<string, unknown>;
            const text = String(row.title || row.text || "").trim();
            if (!text) return null;
            return { text, status: normalizeTodoStatus(row.status) };
          })
          .filter(Boolean),
      };
    }
    return {
      action: typeof inputRecord.action === "string" ? inputRecord.action : undefined,
      tasks: [],
    };
  };

  const summarize = (value: unknown, maxLen = 600): string => {
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    return raw.length > maxLen ? raw.slice(0, maxLen) + "…" : raw;
  };

  const safeJsonParse = (text: string): unknown => {
    const raw = String(text || "").trim();
    if (!raw) return null;
    // best-effort: first JSON object
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const slice = raw.slice(start, end + 1);
      try {
        return JSON.parse(slice);
      } catch {
        // fallthrough
      }
    }
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const tryParseToolCalls = (raw: unknown): Array<{ tool: string; input: unknown; rawCall: LlmToolCall }> | null => {
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const calls = raw as LlmToolCall[];
    const out: Array<{ tool: string; input: unknown; rawCall: LlmToolCall }> = [];
    for (const call of calls) {
      const name = String(call?.function?.name || "").trim();
      if (!name) continue;
      const argsRaw = call?.function?.arguments;
      let parsed: unknown = {};
      if (typeof argsRaw === "string" && argsRaw.trim()) {
        try {
          parsed = JSON.parse(argsRaw);
        } catch {
          parsed = { __raw: argsRaw };
        }
      }
      out.push({ tool: name, input: parsed, rawCall: call });
    }
    return out.length > 0 ? out : null;
  };

  const toolMetaByName = new Map(
    toolDefinitions.map((tool) => [
      tool.name,
      {
        description: String(tool.description || "").trim(),
        parameters: tool.parameters,
      },
    ])
  );

  const toolsForModel = deps.allowedTools
    .filter((name) => name !== "llm_generate") // never allow recursion
    .map((name) => ({
    type: "function",
    function: {
      name,
      description: toolMetaByName.get(name)?.description || name,
      parameters: toolMetaByName.get(name)?.parameters ?? { type: "object", properties: {}, additionalProperties: true },
      strict: true,
    },
  }));

  for (let i = 0; i < maxIterations; i += 1) {
    ensureNotCancelled();
    const iterationLabel = `迭代 ${i + 1}`;
    const iterationEvent: AgentReactEvent = {
      kind: "task",
      label: iterationLabel,
      status: "running",
      text: `ReAct 第 ${i + 1}/${maxIterations} 轮：LLM 决策 -> tool -> observation`,
      stepKind: "llm",
    };
    state.reactEvents.push(iterationEvent);
    const thoughtEvent: AgentReactEvent = {
      kind: "thought",
      label: `${iterationLabel}-thought`,
      status: "running",
      text: "",
      stepKind: "llm",
    };
    state.reactEvents.push(thoughtEvent);
    {
      const existing = state.stepStates.find((s) => s.kind === "llm");
      if (existing) {
        existing.status = "running";
        existing.observation = `正在生成下一步动作（第 ${i + 1} 轮）`;
      } else {
        state.stepStates.push({
          kind: "llm",
          required: true,
          note: "模型决策下一步动作",
          status: "running",
          observation: `正在生成下一步动作（第 ${i + 1} 轮）`,
        });
      }
    }
    deps.onProgress?.({
      detail: `LLM 决策中（${i + 1}/${maxIterations}）`,
      reactEvents: state.reactEvents,
      stepStates: state.stepStates,
      workingMemory: state.workingMemory,
    });
    onProgress?.(`ReAct 迭代 ${i + 1}/${maxIterations}`);
    let streamText = "";
    let streamReasoning = "";
    ensureNotCancelled();
    const decision = await deps
      .invokeTool<
        {
          stream?: boolean;
          messages: LlmMessage[];
          tools?: any[];
          tool_choice?: any;
          onEvent?: (event: import("../../services/llm/llmProxyClient").LlmStreamEvent) => void;
        },
        { output_text?: string; tool_calls?: unknown }
      >("llm_generate", {
        stream: true,
        messages,
        // Enable native tool calling when provider supports it.
        tools: toolsForModel,
        tool_choice: "auto",
        onEvent: (event) => {
          ensureNotCancelled();
          if (event.type === "reasoning_delta" && event.reasoning_delta) {
            streamReasoning += event.reasoning_delta;
            thoughtEvent.text = streamReasoning.trim();
            thoughtEvent.status = "running";
            deps.onProgress?.({
              detail: `ReAct 决策中（${i + 1}/${maxIterations}）`,
              reasoningDelta: event.reasoning_delta,
              reactEvents: state.reactEvents,
              stepStates: state.stepStates,
              workingMemory: state.workingMemory,
            });
          } else if (event.type === "delta" && event.delta) {
            // Avoid leaking control JSON into the main content; still keep a lightweight progress indicator.
            const nextStreamText = streamText + event.delta;
            const sanitizedStreamText = stripFinalControlPayload(nextStreamText);
            const emittedDelta = sanitizedStreamText.slice(streamText.length);
            streamText = sanitizedStreamText;
            if (!emittedDelta) {
              return;
            }
            deps.onProgress?.({
              detail: `ReAct 决策中（${i + 1}/${maxIterations}）`,
              textDelta: emittedDelta,
              text: streamText,
              reactEvents: state.reactEvents,
              stepStates: state.stepStates,
              workingMemory: state.workingMemory,
            });
          }
        },
      })
      .then((out): ReActDecision => {
        const toolCalls = tryParseToolCalls((out as any)?.tool_calls);
        if (toolCalls && toolCalls.length > 0) {
          const first = toolCalls[0];
          return {
            type: "action",
            tool: first.tool,
            input: { __toolInput: first.input, __toolCalls: toolCalls.map((item) => item.rawCall) },
            rationale: "tool_call",
          };
        }
        const parsed = safeJsonParse(out?.output_text ?? "");
        if (parsed && typeof parsed === "object") {
          const obj = parsed as Record<string, unknown>;
          if (obj.type === "final") {
            const routeRaw = typeof obj.route === "string" ? obj.route : undefined;
            const route =
              routeRaw === "chat" || routeRaw === "analysis" || routeRaw === "draft"
                ? (routeRaw as "chat" | "analysis" | "draft")
                : undefined;
            const output =
              typeof obj.output === "string"
                ? obj.output
                : typeof obj.final === "string"
                  ? obj.final
                  : typeof obj.text === "string"
                    ? obj.text
                    : undefined;
            return {
              type: "final",
              route,
              rationale: typeof obj.rationale === "string" ? obj.rationale : undefined,
              output,
            };
          }
          if (obj.type === "action" && typeof obj.tool === "string") {
            return {
              type: "action",
              tool: obj.tool,
              input: obj.input,
              rationale: typeof obj.rationale === "string" ? obj.rationale : undefined,
            };
          }
        }
        return { type: "retry", rationale: "model_output_parse_failed" };
      });
    ensureNotCancelled();

    // Do not inject host-side "thought summary" into the stream. Reasoner-style thinking
    // should come from provider `reasoning_delta` only.

    if (decision.type === "retry") {
      thoughtEvent.status = thoughtEvent.text ? "failed" : "skipped";
      const existing = state.stepStates.find((s) => s.kind === "llm");
      if (existing) {
        existing.status = "failed";
        existing.observation = "LLM 未产生合法动作，正在重试";
      }
      deps.onProgress?.({
        detail: `LLM 输出无效，准备重试（${i + 1}/${maxIterations}）`,
        reactEvents: state.reactEvents,
        stepStates: state.stepStates,
        workingMemory: state.workingMemory,
      });
      messages.push({
        role: "user",
        content:
          "约束提醒：上一轮没有产生合法的 tool_calls，也没有输出合法的 Action/Final JSON。当前不要直接回答，请先调用一个最相关的工具。",
      });
      iterationEvent.status = "failed";
      continue;
    }

    if (decision.type === "final") {
      iterationEvent.status = "done";
      thoughtEvent.status = thoughtEvent.text ? "done" : "skipped";
      const existing = state.stepStates.find((s) => s.kind === "llm");
      if (existing) {
        existing.status = "done";
        existing.observation = "LLM 已生成最终结论";
      }
      deps.onProgress?.({
        detail: `LLM 已生成结论（${i + 1}/${maxIterations}）`,
        reactEvents: state.reactEvents,
        stepStates: state.stepStates,
        workingMemory: state.workingMemory,
      });
      const missing = requiredTools.filter((t) => !usedTools.has(t));
      if (missing.length > 0) {
        messages.push({
          role: "user",
          content: `约束提醒：你还没有调用必需工具：${missing.join("、")}。请先通过工具补齐证据，再输出 final。`,
        });
        iterationEvent.status = "running";
        thoughtEvent.status = thoughtEvent.text ? "done" : "skipped";
        continue;
      }
      return {
        toolTraces: state.toolTraces,
        observations,
        workingMemory: state.workingMemory,
        finalOutput: decision.output,
        finalRationale: decision.rationale,
        finalRoute: decision.route,
      };
    }

    const toolName = normalizeToolName(decision.tool);
    const isSpecial = Boolean(specialTools && Object.prototype.hasOwnProperty.call(specialTools, toolName));
    if (!toolName || (!isSpecial && !deps.allowedTools.includes(toolName))) {
      thoughtEvent.status = thoughtEvent.text ? "failed" : "skipped";
      messages.push({
        role: "user",
        content: `Observation: 工具不可用：${toolName || "(empty)"}。请从可用工具中选择，或输出 final。`,
      });
      iterationEvent.status = "failed";
      continue;
    }
    usedTools.add(toolName);
    thoughtEvent.status = thoughtEvent.text ? "done" : "skipped";
    {
      const existing = state.stepStates.find((s) => s.kind === "llm");
      if (existing) {
        existing.status = "done";
        existing.observation = `LLM 已决定调用：${toolName}`;
      }
    }
    deps.onProgress?.({
      detail: `LLM 已决定调用工具：${toolName}`,
      reactEvents: state.reactEvents,
      stepStates: state.stepStates,
      workingMemory: state.workingMemory,
    });

    const stepKind = mapToolToStepKind?.(toolName);
    if (stepKind) {
      const existing = state.stepStates.find((s) => s.kind === stepKind);
      if (existing) {
        existing.status = "running";
        existing.observation = `执行中：${toolName}`;
      } else {
        state.stepStates.push({
          kind: stepKind,
          required: true,
          note: `执行工具：${toolName}`,
          status: "running",
          observation: `执行中：${toolName}`,
        });
      }
    }

    deps.onProgress?.({
      detail: `执行工具：${toolName}`,
      reactEvents: state.reactEvents,
      stepStates: state.stepStates,
      workingMemory: state.workingMemory,
    });
    ensureNotCancelled();

    const actionPayload =
      decision.input && typeof decision.input === "object" ? (decision.input as Record<string, unknown>) : undefined;
    const rawToolCalls = Array.isArray(actionPayload?.__toolCalls) ? (actionPayload.__toolCalls as LlmToolCall[]) : [];
    const rawToolInput: unknown = Object.prototype.hasOwnProperty.call(actionPayload ?? {}, "__toolInput")
      ? actionPayload?.__toolInput
      : (decision.input ?? {});
    const preparedInput: unknown = prepareToolInput ? prepareToolInput(toolName, rawToolInput) : rawToolInput;
    const toolInput: unknown = toolName === "todo_list" ? normalizeTodoToolInput(preparedInput) : preparedInput;
    const selectedToolCall =
      rawToolCalls.find((call) => normalizeToolName(call?.function?.name || "") === toolName) ?? rawToolCalls[0];
    const toolCallId = String(selectedToolCall?.id || `call_${i + 1}_${toolName}`);
    const assistantToolCalls =
      rawToolCalls.length > 0
        ? [
            {
              id: toolCallId,
              type: selectedToolCall?.type || "function",
              function: {
                name: toolName,
                arguments:
                  typeof selectedToolCall?.function?.arguments === "string"
                    ? selectedToolCall.function.arguments
                    : JSON.stringify(toolInput ?? {}),
              },
            },
          ]
        : [
            {
              id: toolCallId,
              type: "function",
              function: {
                name: toolName,
                arguments: JSON.stringify(toolInput ?? {}),
              },
            },
          ];

    messages.push({
      role: "assistant",
      content: null,
      tool_calls: assistantToolCalls,
    });

    const toolCallEvent: AgentReactEvent = {
      kind: "tool_call",
      label: "Action",
      status: "running",
      text: decision.rationale ? `${toolName}（${decision.rationale}）` : toolName,
      toolName,
      inputSummary: summarize(toolInput, 160),
      stepKind: stepKind,
    };
    state.reactEvents.push(toolCallEvent);
    deps.onProgress?.({
      detail: `执行工具：${toolName}`,
      reactEvents: state.reactEvents,
      stepStates: state.stepStates,
      workingMemory: state.workingMemory,
    });

    try {
      const toolResult = isSpecial && specialTools
        ? await specialTools[toolName]({ toolName, toolInput, iteration: i, messages: messages.slice() })
        : undefined;
      const output = toolResult ? toolResult.output : await deps.invokeTool<typeof toolInput, unknown>(toolName, toolInput as never);
      ensureNotCancelled();
      onToolResult?.(toolName, output);
      const formatted = formatObservation?.(toolName, output);
      const outputSummary = toolResult?.observationForUi ?? formatted?.summary ?? summarize(output, 900);
      const modelObs = toolResult?.observationForModel ?? formatted?.messageForModel ?? outputSummary;
      state.toolTraces.push({ toolName, status: "success", note: outputSummary.slice(0, 180) });
      toolCallEvent.status = "done";
      state.reactEvents.push({
        kind: "observation",
        label: "Observation",
        status: "done",
        text: outputSummary,
        toolName,
        outputSummary: outputSummary.slice(0, 240),
        stepKind: stepKind,
      });
      observations.push({ tool: toolName, summary: outputSummary });
      messages.push({
        role: "tool",
        tool_call_id: toolCallId,
        content: modelObs,
      });
      if (stepKind) {
        const existing = state.stepStates.find((s) => s.kind === stepKind);
        if (existing) {
          existing.status = "done";
          existing.observation = `已完成：${toolName}`;
        }
      }
      deps.onProgress?.({
        detail: `完成工具：${toolName}`,
        reactEvents: state.reactEvents,
        stepStates: state.stepStates,
        workingMemory: state.workingMemory,
      });
      iterationEvent.status = "done";
    } catch (err) {
      if (isCancelledError(err)) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      state.toolTraces.push({ toolName, status: "blocked", note: msg });
      toolCallEvent.status = "failed";
      state.reactEvents.push({
        kind: "observation",
        label: "Observation",
        status: "failed",
        text: msg,
        toolName,
        outputSummary: msg,
        stepKind: stepKind,
      });
      messages.push({
        role: "tool",
        tool_call_id: toolCallId,
        content: JSON.stringify({ error: msg }),
      });
      if (stepKind) {
        const existing = state.stepStates.find((s) => s.kind === stepKind);
        if (existing) {
          existing.status = "failed";
          existing.observation = `失败：${toolName} ${msg}`;
        }
      }
      deps.onProgress?.({
        detail: `工具失败：${toolName}`,
        reactEvents: state.reactEvents,
        stepStates: state.stepStates,
        workingMemory: state.workingMemory,
      });
      iterationEvent.status = "failed";
    }
  }

  // Hit iteration limit: return what we have.
  messages.push({ role: "user", content: "已达到最大迭代次数，请输出 final。" });
  return { toolTraces: state.toolTraces, observations, workingMemory: state.workingMemory };
}
