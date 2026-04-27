import type { AgentStepItem, AgentStepState, AgentToolTrace, AgentWorkingMemory } from "../shared/agentTypes";
import type { AgentReactEvent, ReactAgentDeps, ReactAgentState } from "./reactTypes";
import type { LlmMessage, LlmToolCall } from "../../services/llm/llmProxyClient";
import { throwIfCancelled, isCancelledError } from "./cancelledError";

const REACT_DEBUG_FLAG = "__LCEDA_AI_REACT_DEBUG__";
const STREAM_PROGRESS_MIN_INTERVAL_MS = 200;

type ReActDecision =
  | { type: "action"; tool: string; input?: unknown; rationale?: string }
  | { type: "final"; route?: "chat" | "analysis" | "draft" | "modify"; rationale?: string; output?: string }
  | { type: "retry"; rationale?: string };

export interface ReActLoopResult {
  toolTraces: AgentToolTrace[];
  observations: Array<{ tool: string; summary: string }>;
  workingMemory: AgentWorkingMemory;
  finalOutput?: string;
  finalRationale?: string;
  finalRoute?: "chat" | "analysis" | "draft" | "modify";
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
  const debugEnabled = Boolean((globalThis as typeof globalThis & Record<string, unknown>)[REACT_DEBUG_FLAG]);
  const debugLog = (label: string, payload: Record<string, unknown>) => {
    if (!debugEnabled || typeof console === "undefined") return;
    console.log(`[LCEDA-AI][react-debug] ${label}`, payload);
  };

  const messages: LlmMessage[] = [
    { role: "system", content: system },
    ...historyMessages,
    { role: "user", content: user },
  ];

  const normalizeToolName = (name: string) => String(name || "").trim();
  const formatToolDisplayName = (name: string): string => {
    const raw = normalizeToolName(name);
    if (!raw) return "工具";
    if (/^todo_list$/i.test(raw)) return "整理待办步骤";
    if (/^editor_get_current_context$/i.test(raw)) return "读取当前原理图";
    if (/^editor_get_selection$/i.test(raw)) return "读取当前选区";
    if (/^editor_describe_selection$/i.test(raw)) return "解释当前选区";
    if (/^editor_describe_object$/i.test(raw)) return "解释指定对象";
    if (/^editor_find_object$/i.test(raw)) return "查找原理图对象";
    if (/^editor_locate$/i.test(raw)) return "在画布中定位对象";
    if (/^library_search_devices$/i.test(raw)) return "查找器件库候选";
    if (/^library_get_device$/i.test(raw)) return "读取器件详情";
    if (/^library_get_devices_by_lcsc_ids$/i.test(raw)) return "按 LCSC 编号匹配器件";
    if (/^rules_run_schematic_checks$/i.test(raw)) return "执行规则检查";
    if (/^rules_validate_draft$/i.test(raw)) return "校验草案";
    if (/^schematic_review$/i.test(raw)) return "读取网表证据";
    if (/^schematic_build_analysis_evidence$/i.test(raw)) return "整理分析证据";
    if (/^draft_generate_plan$/i.test(raw)) return "生成草案结构";
    if (/^draft_preview_plan$/i.test(raw)) return "生成草案预览";
    if (/^editor_preview_apply_plan$/i.test(raw)) return "预览草案应用效果";
    return raw;
  };
  const buildUserFacingObservationText = (toolName: string, displayName: string): string => {
    if (/^library_/i.test(toolName)) {
      return `已完成${displayName}，正在继续整理候选结果`;
    }
    if (/^draft_generate_plan$/i.test(toolName)) {
      return "已完成草案结构生成";
    }
    if (/^draft_preview_plan$/i.test(toolName) || /^editor_preview_apply_plan$/i.test(toolName)) {
      return "已完成草案预览整理";
    }
    if (/^rules_validate_draft$/i.test(toolName)) {
      return "已完成草案校验";
    }
    if (/^editor_get_current_context$/i.test(toolName)) {
      return "已读取当前原理图上下文";
    }
    if (/^rules_run_schematic_checks$/i.test(toolName)) {
      return "已完成原理图规则检查";
    }
    if (/^schematic_review$/i.test(toolName) || /^schematic_build_analysis_evidence$/i.test(toolName)) {
      return "已完成原理图证据整理";
    }
    return `已完成${displayName}`;
  };
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
  const stripFinalControlPayloadEarly = (text: string): string => {
    const raw = String(text || "");
    const startPatterns = [
      /(?:\n|\r|^)\s*```(?:json)?\s*$/u,
      /(?:\n|\r|^)\s*```json\s*(?:\n|\r)/u,
      /(?:\n|\r|^)\s*```\s*(?:\n|\r)\s*\{\s*"type"\s*:\s*"final"/u,
      /(?:\n|\r|^)\s*Final:\s*$/u,
      /(?:\n|\r|^)\s*Final:\s*\{/u,
      /(?:\n|\r|^)\s*\{\s*"type"\s*:\s*"final"/u,
      /(?:\n|\r|^)\s*\{\s*"type"\s*:\s*$/u,
      /(?:\n|\r|^)\s*\{\s*"type"\s*$/u,
      /(?:\n|\r|^)\s*\{\s*"type"$/u,
      /(?:\n|\r|^)\s*```\s*$/u,
      /(?:\n|\r|^)\s*``$/u,
      /(?:\n|\r|^)\s*`$/u,
      /(?:\n|\r|^)\s*\{$/u,
    ];
    let cutIndex = -1;
    for (const pattern of startPatterns) {
      const match = pattern.exec(raw);
      if (!match) continue;
      const nextIndex = match.index;
      if (cutIndex < 0 || nextIndex < cutIndex) {
        cutIndex = nextIndex;
      }
    }
    return cutIndex >= 0 ? raw.slice(0, cutIndex) : raw;
  };
  const sanitizeStreamPayload = (text: string): string => stripFinalControlPayloadEarly(stripFinalControlPayload(text));
  const extractRationaleFromControlPayload = (text: string): string => {
    const raw = String(text || "");
    if (!raw) return "";
    const rationaleKeyMatch = raw.match(/"rationale"\s*:\s*"/u);
    if (!rationaleKeyMatch || rationaleKeyMatch.index === undefined) {
      return "";
    }
    let cursor = rationaleKeyMatch.index + rationaleKeyMatch[0].length;
    let out = "";
    let escaped = false;
    while (cursor < raw.length) {
      const ch = raw[cursor]!;
      cursor += 1;
      if (escaped) {
        switch (ch) {
          case "n":
            out += "\n";
            break;
          case "r":
            out += "\r";
            break;
          case "t":
            out += "\t";
            break;
          case '"':
          case "\\":
          case "/":
            out += ch;
            break;
          case "u": {
            const hex = raw.slice(cursor, cursor + 4);
            if (/^[0-9a-fA-F]{4}$/u.test(hex)) {
              out += String.fromCharCode(Number.parseInt(hex, 16));
              cursor += 4;
            }
            break;
          }
          default:
            out += ch;
            break;
        }
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        break;
      }
      out += ch;
    }
    return out.trim();
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
  const appendIterationLine = (step: {
    thoughtText: string;
  }, line: string): void => {
    const text = String(line || "").trim();
    if (!text) return;
    const current = String(step.thoughtText || "").trim();
    if (!current) {
      step.thoughtText = text;
      return;
    }
    const lines = current.split(/\n+/u).map((item) => item.trim()).filter(Boolean);
    if (lines[lines.length - 1] === text) {
      return;
    }
    step.thoughtText = `${current}\n${text}`;
  };
  const sanitizeThoughtRationale = (value: unknown): string => {
    const text = String(value || "").trim();
    if (!text) return "";
    if (text === "tool_call" || text === "model_output_parse_failed" || text === "done") {
      return "";
    }
    return text;
  };
  const nowIso = (): string => new Date().toISOString();
  const createStepItem = (item: AgentStepItem): AgentStepItem => {
    state.stepItems.push(item);
    return item;
  };
  const ensureIterationSteps = () => {
    if (!state.iterationSteps) {
      state.iterationSteps = [];
    }
    return state.iterationSteps;
  };
  const updateStepItem = (
    item: AgentStepItem,
    patch: Partial<Pick<AgentStepItem, "status" | "text" | "inputSummary" | "outputSummary" | "streaming">>
  ): void => {
    if (patch.status) item.status = patch.status;
    if (patch.text !== undefined) item.text = patch.text;
    if (patch.inputSummary !== undefined) item.inputSummary = patch.inputSummary;
    if (patch.outputSummary !== undefined) item.outputSummary = patch.outputSummary;
    if (patch.streaming !== undefined) item.streaming = patch.streaming;
    item.updatedAt = nowIso();
  };
  const buildProgressSignature = (payload: {
    detail: string;
    textDelta?: string;
    text?: string;
    reasoningDelta?: string;
    reactEvents: AgentReactEvent[];
    stepItems: AgentStepItem[];
    iterationSteps?: ReactAgentState["iterationSteps"];
    stepStates: AgentStepState[];
    workingMemory: AgentWorkingMemory;
  }): string => {
    const lastReactEvent = Array.isArray(payload.reactEvents) && payload.reactEvents.length > 0
      ? payload.reactEvents[payload.reactEvents.length - 1]
      : undefined;
    const lastStepItem = Array.isArray(payload.stepItems) && payload.stepItems.length > 0
      ? payload.stepItems[payload.stepItems.length - 1]
      : undefined;
    const lastIteration = Array.isArray(payload.iterationSteps) && payload.iterationSteps.length > 0
      ? payload.iterationSteps[payload.iterationSteps.length - 1]
      : undefined;
    const lastStepState = Array.isArray(payload.stepStates) && payload.stepStates.length > 0
      ? payload.stepStates[payload.stepStates.length - 1]
      : undefined;
    return [
      payload.detail,
      payload.textDelta || "",
      payload.text || "",
      payload.reasoningDelta || "",
      Array.isArray(payload.reactEvents) ? payload.reactEvents.length : 0,
      lastReactEvent?.kind || "",
      lastReactEvent?.status || "",
      lastReactEvent?.text || "",
      Array.isArray(payload.stepItems) ? payload.stepItems.length : 0,
      lastStepItem?.id || "",
      lastStepItem?.status || "",
      lastStepItem?.text || "",
      lastStepItem?.inputSummary || "",
      lastStepItem?.outputSummary || "",
      String(lastStepItem?.streaming || false),
      Array.isArray(payload.iterationSteps) ? payload.iterationSteps.length : 0,
      lastIteration?.id || "",
      lastIteration?.status || "",
      lastIteration?.thoughtText || "",
      JSON.stringify(lastIteration?.toolEvents || []),
      JSON.stringify(lastIteration?.observationTexts || []),
      Array.isArray(payload.stepStates) ? payload.stepStates.length : 0,
      lastStepState?.kind || "",
      lastStepState?.status || "",
      lastStepState?.observation || "",
      JSON.stringify(payload.workingMemory || {}),
    ].join("|");
  };
  let lastProgressSignature = "";
  let lastStreamProgressAt = 0;
  const emitProgressIfChanged = (payload: {
    detail: string;
    textDelta?: string;
    text?: string;
    reasoningDelta?: string;
    reactEvents: AgentReactEvent[];
    stepItems: AgentStepItem[];
    iterationSteps?: ReactAgentState["iterationSteps"];
    stepStates: AgentStepState[];
    workingMemory: AgentWorkingMemory;
  }): void => {
    const signature = buildProgressSignature(payload);
    if (signature === lastProgressSignature) {
      return;
    }
    const isStreamDelta = Boolean(payload.textDelta || payload.reasoningDelta);
    if (isStreamDelta) {
      const now = Date.now();
      if (now - lastStreamProgressAt < STREAM_PROGRESS_MIN_INTERVAL_MS) {
        return;
      }
      lastStreamProgressAt = now;
    }
    lastProgressSignature = signature;
    deps.onProgress?.(payload);
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
    const iterationStepItem = createStepItem({
      id: `react-task-${i + 1}`,
      phase: "llm",
      type: "task",
      status: "running",
      title: iterationLabel,
      text: `ReAct 第 ${i + 1}/${maxIterations} 轮：LLM 决策 -> tool -> observation`,
      startedAt: nowIso(),
      updatedAt: nowIso(),
    });
    const thoughtEvent: AgentReactEvent = {
      kind: "thought",
      label: `${iterationLabel}-thought`,
      status: "running",
      text: "",
      stepKind: "llm",
    };
    state.reactEvents.push(thoughtEvent);
    const thoughtStepItem = createStepItem({
      id: `react-thought-${i + 1}`,
      phase: "llm",
      type: "thought",
      status: "running",
      title: `${iterationLabel}-thought`,
      text: "",
      startedAt: nowIso(),
      updatedAt: nowIso(),
      streaming: true,
    });
    const iterationSteps = ensureIterationSteps();
    const iterationStep = {
      id: `react-iteration-${i + 1}`,
      iteration: i + 1,
      status: "running" as const,
      thoughtText: "",
      streaming: true,
      toolEvents: [] as Array<{ toolName: string; label: string; status: "pending" | "running" | "done" | "failed" | "skipped" }>,
      observationTexts: [] as string[],
    };
    iterationSteps.push(iterationStep);
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
    emitProgressIfChanged({
      detail: `LLM 决策中（${i + 1}/${maxIterations}）`,
      reactEvents: state.reactEvents,
      stepItems: state.stepItems,
      iterationSteps: state.iterationSteps,
      stepStates: state.stepStates,
      workingMemory: state.workingMemory,
    });
    onProgress?.(`ReAct 迭代 ${i + 1}/${maxIterations}`);
    let rawStreamText = "";
    let streamText = "";
    let rawStreamReasoning = "";
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
        { output_text?: string; output_reasoning_text?: string; tool_calls?: unknown }
      >("llm_generate", {
        stream: true,
        messages,
        // Enable native tool calling when provider supports it.
        tools: toolsForModel,
        tool_choice: "auto",
        onEvent: (event) => {
          ensureNotCancelled();
          if (event.type === "reasoning_delta" && event.reasoning_delta) {
            rawStreamReasoning += event.reasoning_delta;
            streamReasoning = sanitizeStreamPayload(rawStreamReasoning);
            thoughtEvent.text = streamReasoning.trim();
            thoughtEvent.status = "running";
            updateStepItem(thoughtStepItem, { status: "running", text: thoughtEvent.text, streaming: true });
            iterationStep.thoughtText = thoughtEvent.text;
            iterationStep.status = "running";
            iterationStep.streaming = true;
            debugLog("llm.reasoning_delta", {
              iteration: i + 1,
              reasoningDelta: event.reasoning_delta,
              accumulatedThoughtText: thoughtEvent.text,
            });
            if (!streamReasoning.trim()) {
              return;
            }
            emitProgressIfChanged({
              detail: `ReAct 决策中（${i + 1}/${maxIterations}）`,
              reasoningDelta: event.reasoning_delta,
              reactEvents: state.reactEvents,
              stepItems: state.stepItems,
              iterationSteps: state.iterationSteps,
              stepStates: state.stepStates,
              workingMemory: state.workingMemory,
            });
          } else if (event.type === "delta" && event.delta) {
            // Avoid leaking control JSON into the main content; still keep a lightweight progress indicator.
            rawStreamText += event.delta;
            const sanitizedStreamText = sanitizeStreamPayload(rawStreamText);
            const rationalePreview = sanitizedStreamText.trim()
              ? ""
              : extractRationaleFromControlPayload(rawStreamText);
            if (!streamReasoning.trim() && rationalePreview && rationalePreview !== thoughtEvent.text) {
              thoughtEvent.text = rationalePreview;
              thoughtEvent.status = "running";
              updateStepItem(thoughtStepItem, {
                status: "running",
                text: rationalePreview,
                streaming: true,
              });
              iterationStep.thoughtText = rationalePreview;
              iterationStep.status = "running";
              iterationStep.streaming = true;
            }
            const looksLikeControlPayload =
              /^\s*\{/u.test(sanitizedStreamText) &&
              /"type"\s*:\s*"(?:action|final)"/u.test(sanitizedStreamText);
            if (
              !streamReasoning.trim() &&
              !looksLikeControlPayload &&
              sanitizedStreamText.trim() &&
              sanitizedStreamText !== thoughtEvent.text
            ) {
              thoughtEvent.text = sanitizedStreamText.trim();
              thoughtEvent.status = "running";
              updateStepItem(thoughtStepItem, {
                status: "running",
                text: thoughtEvent.text,
                streaming: true,
              });
              iterationStep.thoughtText = thoughtEvent.text;
              iterationStep.status = "running";
              iterationStep.streaming = true;
            }
            const emittedDelta = sanitizedStreamText.slice(streamText.length);
            streamText = sanitizedStreamText;
            debugLog("llm.delta", {
              iteration: i + 1,
              delta: event.delta,
              accumulatedText: streamText,
              rationalePreview,
            });
            if (!emittedDelta) {
              return;
            }
            emitProgressIfChanged({
              detail: `ReAct 决策中（${i + 1}/${maxIterations}）`,
              textDelta: emittedDelta,
              text: streamText,
              reactEvents: state.reactEvents,
              stepItems: state.stepItems,
              iterationSteps: state.iterationSteps,
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
              routeRaw === "chat" || routeRaw === "analysis" || routeRaw === "draft" || routeRaw === "modify"
                ? (routeRaw as "chat" | "analysis" | "draft" | "modify")
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

    // Some models do not emit `reasoning_delta`, but still provide a useful rationale
    // in the final parsed decision payload. Backfill the unified thought item so the UI
    // does not fall back to the placeholder title like `迭代 N-thought`.
    if (!thoughtEvent.text) {
      const rationaleText = sanitizeThoughtRationale(decision.rationale);
      if (rationaleText) {
        thoughtEvent.text = rationaleText;
        updateStepItem(thoughtStepItem, {
          status: "running",
          text: rationaleText,
          streaming: true,
        });
        iterationStep.thoughtText = rationaleText;
        iterationStep.status = "running";
        iterationStep.streaming = true;
        debugLog("thought.backfill_from_rationale", {
          iteration: i + 1,
          decisionType: decision.type,
          rationale: decision.rationale,
          thoughtText: thoughtEvent.text,
        });
      }
    }
    debugLog("llm.decision", {
      iteration: i + 1,
      decisionType: decision.type,
      rationale: decision.rationale,
      thoughtText: thoughtEvent.text,
      thoughtStatus: thoughtEvent.status,
      thoughtStepItem: {
        id: thoughtStepItem.id,
        status: thoughtStepItem.status,
        title: thoughtStepItem.title,
        text: thoughtStepItem.text,
        streaming: thoughtStepItem.streaming,
      },
    });

    // Do not inject host-side "thought summary" into the stream. Reasoner-style thinking
    // should come from provider `reasoning_delta` only.

    if (decision.type === "retry") {
      thoughtEvent.status = thoughtEvent.text ? "failed" : "skipped";
      updateStepItem(thoughtStepItem, {
        status: thoughtEvent.status,
        text: thoughtEvent.text,
        streaming: false,
      });
      updateStepItem(iterationStepItem, { status: "failed" });
      const existing = state.stepStates.find((s) => s.kind === "llm");
      if (existing) {
        existing.status = "failed";
        existing.observation = "LLM 未产生合法动作，正在重试";
      }
      emitProgressIfChanged({
        detail: `LLM 输出无效，准备重试（${i + 1}/${maxIterations}）`,
        reactEvents: state.reactEvents,
        stepItems: state.stepItems,
        iterationSteps: state.iterationSteps,
        stepStates: state.stepStates,
        workingMemory: state.workingMemory,
      });
      messages.push({
        role: "user",
        content:
          "约束提醒：上一轮没有产生合法的 tool_calls，也没有输出合法的 Action/Final JSON。当前不要直接回答，请先调用一个最相关的工具。",
      });
      iterationEvent.status = "failed";
      iterationStep.status = "failed";
      iterationStep.streaming = false;
      continue;
    }

    if (decision.type === "final") {
      iterationEvent.status = "done";
      thoughtEvent.status = thoughtEvent.text ? "done" : "skipped";
      updateStepItem(thoughtStepItem, {
        status: thoughtEvent.status,
        text: thoughtEvent.text,
        streaming: false,
      });
      updateStepItem(iterationStepItem, { status: "done" });
      const existing = state.stepStates.find((s) => s.kind === "llm");
      if (existing) {
        existing.status = "done";
        existing.observation = "LLM 已生成最终结论";
      }
      emitProgressIfChanged({
        detail: `LLM 已生成结论（${i + 1}/${maxIterations}）`,
        reactEvents: state.reactEvents,
        stepItems: state.stepItems,
        iterationSteps: state.iterationSteps,
        stepStates: state.stepStates,
        workingMemory: state.workingMemory,
      });
      const missing = requiredTools.filter((t) => !usedTools.has(t));
      if (missing.length > 0) {
        messages.push({
          role: "user",
          content: `约束提醒：你还没有调用必需工具：${missing.join("、")}。请先通过工具补齐证据，再输出 final。`,
        });
        iterationEvent.status = "failed";
        thoughtEvent.status = thoughtEvent.text ? "done" : "skipped";
        updateStepItem(thoughtStepItem, {
          status: thoughtEvent.status,
          text: thoughtEvent.text,
          streaming: false,
        });
        updateStepItem(iterationStepItem, { status: "failed" });
        iterationStep.status = "failed";
        iterationStep.streaming = false;
        continue;
      }
      iterationStep.status = thoughtEvent.status === "done" ? "done" : "skipped";
      iterationStep.streaming = false;
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
    const toolDisplayName = formatToolDisplayName(toolName);
    const isSpecial = Boolean(specialTools && Object.prototype.hasOwnProperty.call(specialTools, toolName));
    if (!toolName || (!isSpecial && !deps.allowedTools.includes(toolName))) {
      thoughtEvent.status = thoughtEvent.text ? "failed" : "skipped";
      updateStepItem(thoughtStepItem, {
        status: thoughtEvent.status,
        text: thoughtEvent.text,
        streaming: false,
      });
      updateStepItem(iterationStepItem, { status: "failed" });
      messages.push({
        role: "user",
        content: `Observation: 工具不可用：${toolName || "(empty)"}。请从可用工具中选择，或输出 final。`,
      });
      iterationEvent.status = "failed";
      iterationStep.status = "failed";
      iterationStep.streaming = false;
      continue;
    }
    usedTools.add(toolName);
    thoughtEvent.status = thoughtEvent.text ? "done" : "skipped";
    updateStepItem(thoughtStepItem, {
      status: thoughtEvent.status,
      text: thoughtEvent.text,
      streaming: false,
    });
    {
      const existing = state.stepStates.find((s) => s.kind === "llm");
      if (existing) {
        existing.status = "done";
        existing.observation = `LLM 已决定调用：${toolName}`;
      }
    }
    emitProgressIfChanged({
      detail: `LLM 已决定调用工具：${toolDisplayName}`,
      reactEvents: state.reactEvents,
      stepItems: state.stepItems,
      iterationSteps: state.iterationSteps,
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

    emitProgressIfChanged({
      detail: `执行工具：${toolDisplayName}`,
      reactEvents: state.reactEvents,
      stepItems: state.stepItems,
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
    const assistantReasoningContent = String(
      (decision as unknown as { output_reasoning_text?: string }).output_reasoning_text || rawStreamReasoning || thoughtEvent.text || ""
    ).trim();
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
      ...(assistantReasoningContent ? { reasoning_content: assistantReasoningContent } : {}),
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
    const toolCallStepItem = createStepItem({
      id: `react-tool-call-${i + 1}-${toolCallId}`,
      phase: stepKind ?? "system",
      type: "tool_call",
      status: "running",
      title: "Action",
      text: toolCallEvent.text,
      toolName,
      inputSummary: summarize(toolInput, 160),
      startedAt: nowIso(),
      updatedAt: nowIso(),
    });
    iterationStep.toolEvents.push({
      toolName,
      label: toolDisplayName,
      status: "running",
    });
    appendIterationLine(iterationStep, `调用工具：${toolDisplayName}`);
    iterationStep.status = "running";
    iterationStep.streaming = true;
    const observationStepItem = createStepItem({
      id: `react-observation-${i + 1}-${toolCallId}`,
      phase: stepKind ?? "system",
      type: "observation",
      status: "running",
      title: "Observation",
      text: "等待工具结果",
      toolName,
      startedAt: nowIso(),
      updatedAt: nowIso(),
    });
    emitProgressIfChanged({
      detail: `执行工具：${toolDisplayName}`,
      reactEvents: state.reactEvents,
      stepItems: state.stepItems,
      iterationSteps: state.iterationSteps,
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
      const userFacingObservationText = buildUserFacingObservationText(toolName, toolDisplayName);
      state.toolTraces.push({ toolName, status: "success", note: outputSummary.slice(0, 180) });
      toolCallEvent.status = "done";
      const toolEvent = iterationStep.toolEvents[iterationStep.toolEvents.length - 1];
      if (toolEvent) {
        toolEvent.status = "done";
      }
      updateStepItem(toolCallStepItem, {
        status: "done",
        text: toolCallEvent.text,
        inputSummary: summarize(toolInput, 160),
      });
      state.reactEvents.push({
        kind: "observation",
        label: "Observation",
        status: "done",
        text: userFacingObservationText,
        toolName,
        outputSummary: undefined,
        stepKind: stepKind,
      });
      observations.push({ tool: toolName, summary: outputSummary });
      iterationStep.observationTexts.push(userFacingObservationText);
      appendIterationLine(iterationStep, userFacingObservationText);
      updateStepItem(observationStepItem, {
        status: "done",
        text: userFacingObservationText,
        outputSummary: undefined,
      });
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
      emitProgressIfChanged({
        detail: `完成工具：${toolDisplayName}`,
        reactEvents: state.reactEvents,
        stepItems: state.stepItems,
        iterationSteps: state.iterationSteps,
        stepStates: state.stepStates,
        workingMemory: state.workingMemory,
      });
      iterationEvent.status = "done";
      updateStepItem(iterationStepItem, { status: "done" });
    } catch (err) {
      if (isCancelledError(err)) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      state.toolTraces.push({ toolName, status: "blocked", note: msg });
      toolCallEvent.status = "failed";
      const toolEvent = iterationStep.toolEvents[iterationStep.toolEvents.length - 1];
      if (toolEvent) {
        toolEvent.status = "failed";
      }
      updateStepItem(toolCallStepItem, {
        status: "failed",
        text: toolCallEvent.text,
        inputSummary: summarize(toolInput, 160),
      });
      state.reactEvents.push({
        kind: "observation",
        label: "Observation",
        status: "failed",
        text: msg,
        toolName,
        outputSummary: msg,
        stepKind: stepKind,
      });
      updateStepItem(observationStepItem, {
        status: "failed",
        text: msg,
        outputSummary: msg,
      });
      iterationStep.observationTexts.push(msg);
      appendIterationLine(iterationStep, `${toolDisplayName}执行失败：${msg}`);
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
      emitProgressIfChanged({
        detail: `工具失败：${toolName}`,
        reactEvents: state.reactEvents,
        stepItems: state.stepItems,
        iterationSteps: state.iterationSteps,
        stepStates: state.stepStates,
        workingMemory: state.workingMemory,
      });
      iterationEvent.status = "failed";
      updateStepItem(iterationStepItem, { status: "failed" });
      iterationStep.status = "failed";
      iterationStep.streaming = false;
    }
  }

  // Hit iteration limit: return what we have.
  messages.push({ role: "user", content: "已达到最大迭代次数，请输出 final。" });
  return { toolTraces: state.toolTraces, observations, workingMemory: state.workingMemory };
}
