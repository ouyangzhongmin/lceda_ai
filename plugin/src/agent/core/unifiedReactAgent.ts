import type { MainPanelState } from "../../ui/panels/mainPanel";
import type { EditorAdapter } from "../../editor/adapters/editorAdapter";
import type { SchematicContext } from "../../types/schematic";
import type { DraftPlanningMode } from "../../editor/apply-plan/draftPlan";
import type { AgentResult, AgentStepState, AgentTask, AgentTaskType, AgentWorkingMemory } from "../shared/agentTypes";
import type { ReactAgentDeps, ReactAgentRunResult, ReactAgentState } from "./reactTypes";
import { runReActLoop } from "./reactLoopAgent";
import { buildSystemPrompt } from "../prompts/systemPrompt";
import type { ToolRegistry } from "../tools/toolRegistry";

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

const MAX_HISTORY_MESSAGES = 20;
const MAX_HISTORY_MESSAGE_CHARS = 1600;

function normalizeHistoryText(text: string): string {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isMeaningfulAssistantHistory(text: string): boolean {
  const normalized = normalizeHistoryText(text);
  if (!normalized) return false;
  if (normalized === "正在思考...") return false;
  if (/^(处理中|分析中|草案生成中|执行中)\.*$/u.test(normalized)) return false;
  if (normalized.length < 3) return false;
  return true;
}

function extractMarkdownSection(text: string, heading: string): string {
  const normalized = normalizeHistoryText(text);
  if (!normalized) return "";
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|\\n)#{1,6}\\s*${escapedHeading}\\s*\\n([\\s\\S]*?)(?=\\n#{1,6}\\s+|$)`, "u");
  const match = normalized.match(pattern);
  if (!match) return "";
  return normalizeHistoryText(`## ${heading}\n${match[2] || ""}`);
}

function compressAssistantAnalysisHistory(text: string): string {
  const normalized = normalizeHistoryText(text);
  if (!normalized) return "";
  const summary = extractMarkdownSection(normalized, "结论摘要");
  const priority = extractMarkdownSection(normalized, "优先整改建议");
  const combined = [summary, priority].filter(Boolean).join("\n\n");
  if (!combined) return "";
  return combined.length > MAX_HISTORY_MESSAGE_CHARS
    ? `${combined.slice(0, MAX_HISTORY_MESSAGE_CHARS)}…`
    : combined;
}

function compressHistoryText(role: "user" | "assistant", text: string): string {
  const normalized = normalizeHistoryText(text);
  if (!normalized) return "";
  if (normalized.length <= MAX_HISTORY_MESSAGE_CHARS) return normalized;

  if (role === "assistant") {
    const analysisCompressed = compressAssistantAnalysisHistory(normalized);
    if (analysisCompressed) {
      return analysisCompressed;
    }
    const blocks = normalized
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter(Boolean)
      .filter((block) => !/^(工具与依据|详细审查报告|优先整改建议)\s*$/u.test(block.replace(/^#+\s*/, "")));
    const picked = blocks.slice(0, 3).join("\n\n");
    const compressed = picked || normalized.slice(0, MAX_HISTORY_MESSAGE_CHARS);
    return compressed.length > MAX_HISTORY_MESSAGE_CHARS
      ? `${compressed.slice(0, MAX_HISTORY_MESSAGE_CHARS)}…`
      : compressed;
  }

  return `${normalized.slice(0, MAX_HISTORY_MESSAGE_CHARS)}…`;
}

function trimConversationHistory(
  history: ConversationMessage[],
  mode: "analysis" | "chat"
): ConversationMessage[] {
  const list = Array.isArray(history) ? history : [];
  if (list.length <= MAX_HISTORY_MESSAGES) return list;

  const preferredRole = mode === "analysis" ? "assistant" : "user";
  const preferredLimit = mode === "analysis" ? 12 : 14;
  const otherLimit = MAX_HISTORY_MESSAGES - preferredLimit;
  const preferredPool = list.filter((item) => item.role === preferredRole);
  const otherPool = list.filter((item) => item.role !== preferredRole);
  const preferredTaken = preferredPool.slice(-preferredLimit);
  const otherTaken = otherPool.slice(-otherLimit);
  const selectedSet = new Set<ConversationMessage>([...preferredTaken, ...otherTaken]);

  if (selectedSet.size < MAX_HISTORY_MESSAGES) {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const item = list[i];
      if (!item || selectedSet.has(item)) continue;
      selectedSet.add(item);
      if (selectedSet.size >= MAX_HISTORY_MESSAGES) break;
    }
  }

  return list.filter((item) => selectedSet.has(item)).slice(-MAX_HISTORY_MESSAGES);
}

function createWorkingMemory(task: AgentTask): AgentWorkingMemory {
  return {
    hasContext: Boolean(task.context),
    mcpReady: false,
    libraryReady: false,
    llmReady: false,
    rulesReady: false,
    draftReady: false,
  };
}

function markStep(state: ReactAgentState, kind: AgentStepState["kind"], status: AgentStepState["status"], observation: string): void {
  const existing = state.stepStates.find((s) => s.kind === kind);
  if (existing) {
    existing.status = status;
    existing.observation = observation;
    return;
  }
  state.stepStates.push({ kind, required: true, note: observation, status, observation });
}

function thought(state: ReactAgentState, label: string, text: string, stepKind?: AgentStepState["kind"]): void {
  state.reactEvents.push({ kind: "thought", label, status: "done", text, stepKind });
}

function final(state: ReactAgentState, text: string): void {
  state.reactEvents.push({ kind: "final", label: "Finish", status: "done", text });
}

function isAllowedToolName(toolName: string, allowedTools: string[]): boolean {
  return allowedTools.includes(toolName);
}

function isBannedHighRiskTool(toolName: string): boolean {
  // Hard ban: even if mistakenly included in allowedTools.
  return toolName === "editor_apply_plan" || toolName === "editor_rollback_apply_plan";
}

function inferRouteFromResult(result: AgentResult): "chat" | "analysis" | "draft" {
  if (result.draftPlan || result.draftPreview || result.draftValidation || result.draftRisk) return "draft";
  if (result.analysisReport || result.checkResult || result.analysisMarkdown) return "analysis";
  return "chat";
}

function buildContextHint(context?: SchematicContext, panelState?: MainPanelState): string {
  if (context) {
    return `channel=${context.project.channel}, page=${context.project.pageName || ""}, components=${context.components.length}, nets=${context.nets.length}, selection=${context.selection.objectIds.length}`;
  }
  if (panelState) {
    return `components=${panelState.componentCount ?? 0}, nets=${panelState.netCount ?? 0}, selection=${panelState.selectionCount ?? 0}`;
  }
  return "";
}

function looksLikeAnalysisQuery(userQuery: string): boolean {
  const text = String(userQuery || "").trim().toLowerCase();
  if (!text) return false;
  return /(分析|检查|检查看看|看看|查看|排查|定位|问题|有什么问题|有啥问题|erc|审查|review|analy[sz]e|check|inspect)/iu.test(text);
}

function looksLikeDraftQuery(userQuery: string): boolean {
  const text = String(userQuery || "").trim().toLowerCase();
  if (!text) return false;
  return /(设计|生成|草案|原理图|draft|plan|esp32|语音|电池|充电|usb|麦克风|功放)/iu.test(text);
}

function isAnalysisTaskType(taskType?: AgentTaskType): boolean {
  return taskType === "schematic_analysis";
}

function isDraftTaskType(taskType?: AgentTaskType): boolean {
  return taskType === "schematic_draft";
}

function looksLikeDraftFollowUpSummaryQuery(userQuery: string): boolean {
  const text = String(userQuery || "").trim().toLowerCase();
  if (!text) return false;
  if (/(重新生成|重新设计|重画|修改草案|改原理图|增加模块|新增模块|替换器件|换成|重做)/iu.test(text)) {
    return false;
  }
  return /(列表|清单|主要元器件|主要器件|用哪些器件|用了哪些器件|器件列表|列出|展示|总结|概述|说明|介绍)/iu.test(text);
}

function looksLikeDraftFollowUpRevisionQuery(userQuery: string): boolean {
  const text = String(userQuery || "").trim().toLowerCase();
  if (!text) return false;
  return /(修改|调整|改成|换成|增加|新增|加入|补充|删掉|删除|替换|优化|重生成|重新生成|重做草案|重新设计|增加模块|新增模块)/iu.test(text);
}

function looksLikeDraftRiskAnalysisQuery(userQuery: string): boolean {
  const text = String(userQuery || "").trim().toLowerCase();
  if (!text) return false;
  return /(风险|问题|隐患|还能不能用|为什么报错|哪些地方有问题|哪里不合理|阻断|校验|验证|规则检查|悬空|未连接)/iu.test(text);
}

function shouldTreatAsAnalysis(input: { taskType?: AgentTaskType; userQuery: string }): boolean {
  return isAnalysisTaskType(input.taskType) || (!isDraftTaskType(input.taskType) && looksLikeAnalysisQuery(input.userQuery));
}

function shouldTreatAsDraft(input: { taskType?: AgentTaskType; userQuery: string }): boolean {
  return isDraftTaskType(input.taskType) || (!shouldTreatAsAnalysis(input) && looksLikeDraftQuery(input.userQuery));
}

function requiresStructuredDraftSpec(input: { taskType?: AgentTaskType; userQuery: string }): boolean {
  return shouldTreatAsDraft(input);
}

const STRUCTURED_SPEC_REQUIRED: DraftPlanningMode = "structured_spec_required";

function buildRequiredTools(input: {
  taskType?: AgentTaskType;
  userQuery: string;
  hasContext: boolean;
  availableToolNames: string[];
}): string[] {
  const required: string[] = [];
  const available = new Set(input.availableToolNames);
  if (shouldTreatAsAnalysis(input)) {
    if (!input.hasContext && available.has("editor_get_current_context")) {
      required.push("editor_get_current_context");
    }
    if (available.has("rules_run_schematic_checks")) {
      required.push("rules_run_schematic_checks");
    }
    return required;
  }
  if (shouldTreatAsDraft(input)) {
    if (available.has("draft_generate_plan")) {
      required.push("draft_generate_plan");
    }
    if (available.has("draft_preview_plan")) {
      required.push("draft_preview_plan");
    }
  }
  return required;
}

function buildDecisionToolNames(input: {
  taskType?: AgentTaskType;
  userQuery: string;
  availableToolNames: string[];
}): string[] {
  const names = input.availableToolNames.filter((name) => name !== "llm_generate");
  if (shouldTreatAsAnalysis(input)) {
    const preferredOrder = [
      "todo_list",
      "editor_get_current_context",
      "rules_run_schematic_checks",
      "schematic_review",
      "issues_locate_first",
      "editor_describe_object",
      "editor_locate",
      "schematic_build_analysis_evidence",
    ];
    const available = new Set(names);
    const narrowed = preferredOrder.filter((name) => available.has(name));
    return narrowed.length > 0 ? narrowed : names;
  }
  if (shouldTreatAsDraft(input)) {
    const preferredOrder = [
      "todo_list",
      "editor_get_current_context",
      "rag_search",
      "rag_build_citations",
      "library_search_devices",
      "library_get_device",
      "library_get_devices_by_lcsc_ids",
      "draft_generate_plan",
      "draft_preview_plan",
      "rules_validate_draft",
      "editor_preview_apply_plan",
    ];
    const available = new Set(names);
    const narrowed = preferredOrder.filter((name) => available.has(name));
    return narrowed.length > 0 ? narrowed : names;
  }
  return names;
}

function buildConversationHistory(panelState: MainPanelState | undefined, currentUserQuery: string): ConversationMessage[] {
  const messages = Array.isArray(panelState?.chatMessages) ? panelState.chatMessages : [];
  if (messages.length === 0) return [];

  const history = messages
    .filter((message): message is NonNullable<MainPanelState["chatMessages"]>[number] => Boolean(message))
    .filter((message) => message.role === "user" || message.role === "assistant")
    .filter((message) => !message.streaming)
    .map((message) => {
      const structuredText = Array.isArray(message.structuredContent)
        ? message.structuredContent
            .map((block) => {
              if (!block) return "";
              if (block.kind === "paragraph") return block.text || "";
              if (block.kind === "section") return [block.title, block.text].filter(Boolean).join("\n");
              if (block.kind === "list") return (block.items || []).filter(Boolean).join("\n");
              if (block.kind === "kv") return (block.entries || []).map((entry) => `${entry.key}: ${entry.value}`).join("\n");
              return "";
            })
            .filter(Boolean)
            .join("\n\n")
        : "";
      const content = String(message.content || structuredText || message.analysisMarkdown || "").trim();
      if (!content) return null;
      if (message.role === "assistant" && !isMeaningfulAssistantHistory(content)) {
        return null;
      }
      return {
        role: message.role,
        content: compressHistoryText(message.role, content),
      };
    })
    .filter((item): item is ConversationMessage => Boolean(item));

  while (
    history.length > 0 &&
    history[history.length - 1]?.role === "user" &&
    history[history.length - 1]?.content.trim() === currentUserQuery.trim()
  ) {
    history.pop();
  }

  return trimConversationHistory(history, looksLikeAnalysisQuery(currentUserQuery) ? "analysis" : "chat");
}

export async function runUnifiedReactAgent(input: {
  taskType?: AgentTaskType;
  userQuery: string;
  panelState: MainPanelState;
  context?: SchematicContext;
  adapter?: EditorAdapter;
  tools: ToolRegistry;
  allowedTools: string[];
  onStreamEvent?: (event: {
    route: "chat" | "analysis" | "draft";
    stage: "llm" | "progress";
    textDelta?: string;
    text?: string;
    reasoningDelta?: string;
    detail?: string;
    reactEvents?: AgentResult["reactEvents"];
    stepStates?: AgentResult["stepStates"];
    workingMemory?: AgentResult["workingMemory"];
  }) => void;
}): Promise<ReactAgentRunResult> {
  let liveContext: SchematicContext | undefined = input.context;
  let checkResult: AgentResult["checkResult"] | undefined;
  let locateResult: AgentResult["locateResult"] | undefined;
  let draftPlan: AgentResult["draftPlan"] | undefined = input.panelState.draftPlan;
  let draftPreview: AgentResult["draftPreview"] | undefined;
  let draftValidation: AgentResult["draftValidation"] | undefined;
  let draftRisk: AgentResult["draftRisk"] | undefined;
  let mcpResources: AgentResult["mcpResources"] | undefined;
  let mcpResourceReads: AgentResult["mcpResourceReads"] | undefined;
  let libraryInsights: AgentResult["libraryInsights"] | undefined;
  const resolvedTaskType = input.taskType ?? "natural_chat";

  const hasExistingDraftPreview = Boolean(input.panelState.draftPreview || input.panelState.draftPlan);
  const draftFollowUpIntent =
    resolvedTaskType === "natural_chat" &&
    hasExistingDraftPreview &&
    input.panelState.agentRunState === "awaiting_confirmation" &&
    (looksLikeDraftFollowUpRevisionQuery(input.userQuery)
      ? "revise_existing_draft"
      : looksLikeDraftRiskAnalysisQuery(input.userQuery)
        ? "analyze_existing_draft_risk"
      : looksLikeDraftFollowUpSummaryQuery(input.userQuery)
        ? "summarize_existing_draft"
        : undefined);

  const task: AgentTask = {
    type: resolvedTaskType,
    userQuery: input.userQuery,
    context: liveContext,
    draftFollowUpIntent,
    existingDraftSummary: draftFollowUpIntent
      ? {
          title: input.panelState.draftPreview?.title,
          rationale: input.panelState.draftPreview?.rationale,
          componentRefs: input.panelState.draftPreview?.componentRefs,
          netNames: input.panelState.draftPreview?.netNames,
          componentCount: input.panelState.draftPreview?.componentCount,
          netCount: input.panelState.draftPreview?.netCount,
          selectedDeviceDetails: input.panelState.draftPreview?.selectedDeviceDetails,
        }
      : undefined,
  };

  const state: ReactAgentState = {
    toolTraces: [],
    stepStates: [],
    workingMemory: createWorkingMemory(task),
    reactEvents: [],
  };

  if (draftPlan) {
    state.workingMemory.draftReady = true;
  }

  // Do not pre-seed stepStates. Steps should reflect actual tool calls / observations.

  const baseContextHint = buildContextHint(input.context, input.panelState);
  const allVisibleTools = input.tools
    .list()
    .filter((t) => isAllowedToolName(t.name, input.allowedTools))
    .filter((t) => !t.requiresConfirmation);
  const decisionToolNames = buildDecisionToolNames({
    taskType:
      draftFollowUpIntent === "revise_existing_draft"
        ? "schematic_draft"
        : draftFollowUpIntent === "analyze_existing_draft_risk"
          ? "schematic_analysis"
          : draftFollowUpIntent
            ? "natural_chat"
            : resolvedTaskType,
    userQuery: input.userQuery,
    availableToolNames: allVisibleTools.map((tool) => tool.name),
  });
  const toolList = allVisibleTools.filter((tool) =>
    draftFollowUpIntent === "summarize_existing_draft"
      ? !["draft_generate_plan", "draft_preview_plan", "rules_validate_draft", "editor_preview_apply_plan"].includes(tool.name) &&
        decisionToolNames.includes(tool.name)
      : decisionToolNames.includes(tool.name)
  );

  const system = buildSystemPrompt({
    task,
    tools: toolList,
    skills: [
      { name: "analysis", description: "分析/检查原理图问题（建议用 rules_run_schematic_checks + schematic_review）" },
      { name: "draft", description: "生成草案并预览（建议用 draft_generate_plan + draft_preview_plan + editor_preview_apply_plan）" },
      { name: "chat", description: "自然问答/解释/澄清（需要事实时先调用 editor/rag/library 工具）" },
    ],
    contextHint: baseContextHint,
  });

  const user = [
    `用户输入：${input.userQuery}`,
    "",
    `可用工具：${toolList.map((t) => t.name).join("、")}`,
    "",
    draftFollowUpIntent === "summarize_existing_draft"
      ? "这是基于现有草案的追问：优先复用当前草案摘要直接回答；除非用户明确要求重生成或修改草案，否则不要调用 draft_generate_plan / draft_preview_plan / rules_validate_draft。"
      : draftFollowUpIntent === "revise_existing_draft"
        ? "这是基于现有草案的修改请求：优先继承当前草案，只修改用户明确提出的部分；允许调用 draft_generate_plan 和 draft_preview_plan，但不要把整个系统从零重做。"
      : draftFollowUpIntent === "analyze_existing_draft_risk"
        ? "这是基于现有草案的风险复核请求：优先说明当前草案的问题、阻断项和待补充内容；可调用 rules_validate_draft，但不要无必要重生成草案。"
      :
    shouldTreatAsAnalysis({ taskType: resolvedTaskType, userQuery: input.userQuery })
      ? "这是分析类任务：先调用 editor_get_current_context，再调用 rules_run_schematic_checks；如需网表级证据，再调用 schematic_review。完成这些步骤前不要直接回答。"
      : shouldTreatAsDraft({ taskType: resolvedTaskType, userQuery: input.userQuery })
        ? "这是草案类任务：先补齐事实或证据，再由模型自行整理结构化 spec 并传给 draft_generate_plan；生成 plan 后必须调用 draft_preview_plan，完成这些步骤前不要直接输出 final。"
        : "如需原理图事实，先调用 editor_get_current_context；规则检查用 rules_run_schematic_checks；需要网表证据用 schematic_review。",
  ].join("\n");
  const historyMessages = buildConversationHistory(input.panelState, input.userQuery);

  const requiredTools = buildRequiredTools({
    taskType:
      draftFollowUpIntent === "revise_existing_draft"
        ? "schematic_draft"
        : draftFollowUpIntent === "analyze_existing_draft_risk"
          ? "schematic_analysis"
          : draftFollowUpIntent
            ? "natural_chat"
            : resolvedTaskType,
    userQuery: input.userQuery,
    hasContext: Boolean(liveContext),
    availableToolNames: toolList.map((tool) => tool.name),
  });

  const deps: ReactAgentDeps = {
    task,
    allowedTools: toolList.map((t) => t.name),
    invokeTool: (toolName, toolInput) => input.tools.invoke(toolName, toolInput),
    listToolNames: () => input.tools.list().map((t) => t.name),
    onProgress: (payload) => {
      const route = inferRouteFromResult({
        summary: "",
        toolTraceNames: [],
        checkResult,
        draftPlan,
        draftPreview,
        draftValidation,
        draftRisk,
        analysisMarkdown: undefined,
      });
      // If we receive model stream deltas/reasoning, treat it as llm stage so UI can render thinking.
      const stage = payload.reasoningDelta || payload.textDelta ? "llm" : "progress";
      input.onStreamEvent?.({
        route,
        stage,
        detail: payload.detail,
        textDelta: payload.textDelta,
        text: payload.text,
        reasoningDelta: payload.reasoningDelta,
        reactEvents: payload.reactEvents,
        stepStates: payload.stepStates,
        workingMemory: payload.workingMemory,
      });
    },
  };

  const mapToolToStepKind = (toolName: string): AgentStepState["kind"] | undefined => {
    if (toolName.startsWith("editor_")) return "context";
    if (toolName.startsWith("schematic_") || toolName.startsWith("mcp_") || toolName.startsWith("rag_")) return "mcp";
    if (toolName.startsWith("library_")) return "library";
    if (toolName.startsWith("rules_") || toolName.startsWith("issues_")) return "rules";
    if (toolName.startsWith("draft_")) return "draft";
    if (toolName.startsWith("llm_")) return "llm";
    return undefined;
  };

  const normalizeQueryInput = (llmInput: unknown): { query: string } => {
    if (typeof llmInput === "string") return { query: llmInput };
    if (llmInput && typeof llmInput === "object" && typeof (llmInput as any).query === "string") {
      return { query: String((llmInput as any).query) };
    }
    return { query: input.userQuery };
  };

  const prepareToolInput = (toolName: string, llmInput: unknown): unknown => {
    if (isBannedHighRiskTool(toolName)) {
      throw new Error(`tool banned: ${toolName}`);
    }
    if (toolName === "editor_get_current_context") {
      return {};
    }
    if (toolName === "editor_find_object") {
      return { query: normalizeQueryInput(llmInput).query };
    }
    if (toolName === "rag_search" || toolName === "rag_build_citations") {
      return { ...normalizeQueryInput(llmInput), topK: 3 };
    }
    if (toolName.startsWith("library_")) {
      return { query: normalizeQueryInput(llmInput).query, scope: "system", pageSize: 12, page: 1 };
    }
    if (toolName === "rules_run_schematic_checks" || toolName.startsWith("schematic_")) {
      if (!liveContext) {
        throw new Error("missing context: call editor_get_current_context first");
      }
      return { context: liveContext };
    }
    if (toolName === "issues_locate_first") {
      if (!liveContext) {
        throw new Error("missing context: call editor_get_current_context first");
      }
      const issues = (llmInput && typeof llmInput === "object" && Array.isArray((llmInput as any).issues)) ? (llmInput as any).issues : [];
      return { issues, context: liveContext };
    }
    if (toolName === "draft_generate_plan") {
      const payload = llmInput && typeof llmInput === "object" ? (llmInput as any) : {};
      const userQuery = typeof payload.userQuery === "string" ? payload.userQuery : input.userQuery;
      const planningMode =
        typeof payload.planningMode === "string"
          ? (payload.planningMode as DraftPlanningMode)
          : requiresStructuredDraftSpec({ taskType: resolvedTaskType, userQuery })
            ? STRUCTURED_SPEC_REQUIRED
            : undefined;
      return { ...payload, userQuery, ...(planningMode ? { planningMode } : {}) };
    }
    if (toolName === "draft_preview_plan") {
      const payload = llmInput && typeof llmInput === "object" ? (llmInput as any) : {};
      if (payload.plan) return payload;
      if (!draftPlan) throw new Error("draftPlan missing: call draft_generate_plan first");
      return { plan: draftPlan };
    }
    if (toolName === "rules_validate_draft") {
      const payload = llmInput && typeof llmInput === "object" ? (llmInput as any) : {};
      if (payload.draft) return payload;
      if (!draftPlan) throw new Error("draftPlan missing: call draft_generate_plan first");
      return { draft: { components: draftPlan.components, pins: draftPlan.pins, nets: draftPlan.nets } };
    }
    if (toolName === "editor_preview_apply_plan") {
      const payload = llmInput && typeof llmInput === "object" ? (llmInput as any) : {};
      if (payload.plan) return payload;
      if (!draftPlan) throw new Error("draftPlan missing: call draft_generate_plan first");
      return { plan: draftPlan };
    }
    return llmInput;
  };

  // Do not inject host-side thought text; Reasoner-style thinking should come from reasoning_delta.

  const loopResult = await runReActLoop({
    deps,
    state,
    system,
    user,
    historyMessages,
    toolDefinitions: toolList.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
    maxIterations: 50,
    requiredTools,
    mapToolToStepKind,
    prepareToolInput,
    // While-loop 决策阶段不做 llm token streaming，只做进度更新；route 动态推断。
    onProgress: (detail) => {
      const route = inferRouteFromResult({
        summary: "",
        toolTraceNames: [],
        checkResult,
        draftPlan,
        draftPreview,
        draftValidation,
        draftRisk,
        analysisMarkdown: undefined,
        naturalReply: undefined,
      });
      input.onStreamEvent?.({ route, stage: "progress", detail, reactEvents: state.reactEvents, stepStates: state.stepStates, workingMemory: state.workingMemory });
    },
    onThought: (t) => {
      const route = inferRouteFromResult({
        summary: "",
        toolTraceNames: [],
        checkResult,
        draftPlan,
        draftPreview,
        draftValidation,
        draftRisk,
        analysisMarkdown: undefined,
        naturalReply: undefined,
      });
      input.onStreamEvent?.({ route, stage: "progress", detail: `思考：${t}`, reactEvents: state.reactEvents, stepStates: state.stepStates, workingMemory: state.workingMemory });
    },
    onToolResult: (toolName, output) => {
      if (toolName === "editor_get_current_context") {
        liveContext = output as SchematicContext;
        task.context = liveContext;
        state.workingMemory.hasContext = true;
        markStep(state, "context", "done", "原理图上下文已读取");
      }
      if (toolName === "rules_run_schematic_checks") {
        checkResult = output as AgentResult["checkResult"];
        state.workingMemory.rulesReady = true;
        markStep(state, "rules", "done", `规则检查完成（issues=${checkResult?.issues?.length ?? 0}）`);
      }
      if (toolName === "issues_locate_first") {
        locateResult = output as AgentResult["locateResult"];
      }
      if (toolName === "draft_generate_plan") {
        draftPlan = output as AgentResult["draftPlan"];
        state.workingMemory.draftReady = true;
        markStep(state, "draft", "running", "草案计划已生成");
      }
      if (toolName === "draft_preview_plan") {
        draftPreview = output as AgentResult["draftPreview"];
        markStep(state, "draft", "done", "草案预览已生成");
      }
      if (toolName === "rules_validate_draft") {
        draftValidation = output as AgentResult["draftValidation"];
        const issues = draftValidation?.issues ?? [];
        const highSeverityCount = issues.filter((i) => i.severity === "high").length;
        draftRisk = highSeverityCount > 0
          ? { level: "blocked", issueCount: issues.length, highSeverityCount, message: `存在 ${highSeverityCount} 个高风险问题，阻断直接应用` }
          : issues.length > 0
            ? { level: "warning", issueCount: issues.length, highSeverityCount: 0, message: `存在 ${issues.length} 个待确认问题，允许人工复核后决定是否应用` }
            : { level: "safe", issueCount: 0, highSeverityCount: 0, message: "验证通过，可进入应用确认" };
        state.workingMemory.rulesReady = true;
        markStep(state, "rules", "done", draftRisk.message);
      }
      if (toolName === "mcp_list_resources") {
        const payload = output as { resources?: Array<{ uri: string; description: string }> };
        if (payload?.resources) {
          mcpResources = payload.resources.slice();
          state.workingMemory.mcpReady = mcpResources.length > 0;
          markStep(state, "mcp", mcpResources.length ? "done" : "skipped", `知识资源 ${mcpResources.length} 条`);
        }
      }
      if (toolName === "mcp_read_resource") {
        const payload = output as { uri?: string; title?: string; summary?: string };
        const next = { uri: String(payload?.uri || ""), title: String(payload?.title || ""), summary: String(payload?.summary || "") };
        mcpResourceReads = [...(mcpResourceReads ?? []), next].filter((x) => x.uri);
        state.workingMemory.mcpReady = true;
        markStep(state, "mcp", "done", `知识摘要 ${mcpResourceReads.length} 条`);
      }
      if (toolName === "library_search_devices") {
        const list = Array.isArray(output) ? (output as Array<{ name?: string; manufacturer?: string; footprintName?: string }>) : [];
        if (list.length > 0) {
          const head = list.slice(0, 3).map((it) => [it.name, it.manufacturer, it.footprintName ? `封装 ${it.footprintName}` : ""].filter(Boolean).join("，"));
          libraryInsights = [{ query: input.userQuery, title: "元件库候选", summary: head.join("；") }];
          state.workingMemory.libraryReady = true;
          markStep(state, "library", "done", `元件库候选 ${list.length} 条`);
        }
      }
    },
  });

  markStep(state, "llm", "done", "Final 已输出");
  final(state, "统一 ReAct 已完成");
  const finalText =
    (loopResult.finalOutput ?? "").trim() ||
    (loopResult.observations.length === 0
      ? "未获取到任何工具观测结果，因此当前不能对原理图做出可靠分析。请先确认工具调用链路可用后再重试。"
      : "已完成工具调用，但模型未返回最终报告。请检查 Final.output 协议是否生效。");

  const base: AgentResult = {
    summary: "unified react agent finished",
    toolTraceNames: deps.listToolNames(),
    toolTraces: state.toolTraces,
    executionTraces: state.reactEvents.map((e) => ({
      phase: e.kind === "tool_call" ? "act" : e.kind === "observation" ? "observe" : e.kind === "final" ? "finish" : "reason",
      message: e.text,
    })),
    stepStates: state.stepStates,
    workingMemory: state.workingMemory,
    reactEvents: state.reactEvents,
    checkResult,
    locateResult,
    draftPlan,
    draftPreview,
    draftValidation,
    draftRisk,
    mcpResources,
    mcpResourceReads,
    libraryInsights,
    contextDigest: liveContext
      ? {
          channel: liveContext.project.channel,
          pageName: liveContext.project.pageName,
          projectId: liveContext.project.projectId,
          pageId: liveContext.project.pageId,
          componentCount: liveContext.components.length,
          netCount: liveContext.nets.length,
          selectionCount: liveContext.selection.objectIds.length,
        }
      : undefined,
    };
  const route = loopResult.finalRoute ?? inferRouteFromResult({
    ...base,
    analysisMarkdown: checkResult ? finalText : undefined,
    naturalReply: checkResult ? undefined : finalText,
  });

  const result: AgentResult = {
    ...base,
    analysisMarkdown: route === "analysis" ? finalText : undefined,
    naturalReply: route === "chat" ? finalText : undefined,
  };

  return { result, reactEvents: state.reactEvents };
}
