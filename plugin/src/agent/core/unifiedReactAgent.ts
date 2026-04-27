import type { MainPanelState } from "../../ui/panels/mainPanel";
import type { EditorAdapter } from "../../editor/adapters/editorAdapter";
import type { LibraryDeviceDetail, LibrarySearchResultItem } from "../../editor/host/runtime";
import type { DraftPlan, DraftPreview } from "../../editor/apply-plan/draftPlan";
import type { SchematicContext } from "../../types/schematic";
import type { DraftPlanningMode } from "../../editor/apply-plan/draftPlan";
import type { AgentResult, AgentStepItem, AgentStepState, AgentTask, AgentTaskType, AgentWorkingMemory } from "../shared/agentTypes";
import type { ReactAgentDeps, ReactAgentRunResult, ReactAgentState } from "./reactTypes";
import { runReActLoop } from "./reactLoopAgent";
import { buildSystemPrompt } from "../prompts/systemPrompt";
import type { ToolRegistry } from "../tools/toolRegistry";

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
  reasoning_content?: string;
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

function inferRouteFromResult(result: AgentResult): "chat" | "analysis" | "draft" | "modify" {
  if (result.naturalReply) return "chat";
  if (result.selectedSkill === "modify_existing_schematic") return "modify";
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

function looksLikeExistingSchematicEditQuery(userQuery: string): boolean {
  const text = String(userQuery || "").trim().toLowerCase();
  if (!text) return false;
  return /((当前|这个|现有|已有|原理图中|图中).*(网络标签|连线|补线|接线|未连接|没连上|连接缺失|连起来|接上|补齐)|(网络标签|连线|补线|接线).*(完成这个|补齐|连起来|接上|修好|完善))/iu.test(
    text
  );
}

function looksLikeDraftQuery(userQuery: string): boolean {
  const text = String(userQuery || "").trim().toLowerCase();
  if (!text) return false;
  if (looksLikeExistingSchematicEditQuery(text)) return false;
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
  return !looksLikeDraftFollowUpRevisionQuery(text) && !looksLikeDraftRiskAnalysisQuery(text);
}

function looksLikeDraftFollowUpRevisionQuery(userQuery: string): boolean {
  const text = String(userQuery || "").trim().toLowerCase();
  if (!text) return false;
  return /(修改|调整|改成|换成|增加|新增|加入|补充|删掉|删除|替换|优化|重生成|重新生成|重做草案|重新设计|增加模块|新增模块|网络标签|连线|补线|接线|补齐连接|完成这个)/iu.test(
    text
  );
}

function looksLikeDraftRepairQuery(userQuery: string): boolean {
  const text = String(userQuery || "").trim().toLowerCase();
  if (!text) return false;
  return /(应用草案失败|apply.*fail|修复草案|修一下|补齐.*网络|缺失网络|missing endpoints|required nets|unmapped required nets|net mismatch|重新补充连接|补齐连接后再试|不能应用|应用失败)/iu.test(text);
}

function looksLikeDraftRiskAnalysisQuery(userQuery: string): boolean {
  const text = String(userQuery || "").trim().toLowerCase();
  if (!text) return false;
  return /(风险|问题|隐患|还能不能用|为什么报错|哪些地方有问题|哪里不合理|阻断|校验|验证|规则检查|悬空|未连接)/iu.test(text);
}

function shouldTreatAsAnalysis(input: { taskType?: AgentTaskType; userQuery: string }): boolean {
  return isAnalysisTaskType(input.taskType);
}

function shouldTreatAsDraft(input: { taskType?: AgentTaskType; userQuery: string }): boolean {
  return isDraftTaskType(input.taskType);
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
      "draft_repair_plan",
      "draft_generate_plan",
      "draft_preview_plan",
      "rules_validate_draft",
    ];
    const available = new Set(names);
    const narrowed = preferredOrder.filter((name) => available.has(name));
    return narrowed.length > 0 ? narrowed : names;
  }
  const preferredOrder = [
    "todo_list",
    "editor_get_current_context",
    "editor_get_selection",
    "editor_describe_selection",
    "editor_find_object",
    "editor_describe_object",
    "rules_run_schematic_checks",
    "schematic_review",
    "schematic_build_analysis_evidence",
    "rag_search",
    "rag_build_citations",
    "library_search_devices",
    "library_get_device",
    "library_get_devices_by_lcsc_ids",
    "draft_repair_plan",
    "draft_generate_plan",
    "draft_preview_plan",
    "rules_validate_draft",
    "issues_locate_first",
    "editor_locate",
  ];
  const available = new Set(names);
  const narrowed = preferredOrder.filter((name) => available.has(name));
  return narrowed.length > 0 ? narrowed : names;
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
      const reasoningContent =
        message.role === "assistant"
          ? message.reasoningContent ||
            message.iterationSteps
              ?.map((step) => String(step?.thoughtText || "").trim())
              .filter(Boolean)
              .join("\n\n") ||
            undefined
          : undefined;
      return {
        role: message.role,
        content: compressHistoryText(message.role, content),
        reasoning_content:
          reasoningContent && reasoningContent.length > MAX_HISTORY_MESSAGE_CHARS
            ? `${reasoningContent.slice(0, MAX_HISTORY_MESSAGE_CHARS)}…`
            : reasoningContent,
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
  signal?: AbortSignal;
  onStreamEvent?: (event: {
    route: "chat" | "analysis" | "draft" | "modify";
    stage: "llm" | "progress";
    textDelta?: string;
    text?: string;
    reasoningDelta?: string;
    detail?: string;
    reactEvents?: AgentResult["reactEvents"];
    stepItems?: AgentStepItem[];
    iterationSteps?: AgentResult["iterationSteps"];
    stepStates?: AgentResult["stepStates"];
    workingMemory?: AgentResult["workingMemory"];
  }) => void;
}): Promise<ReactAgentRunResult> {
  let liveContext: SchematicContext | undefined = input.context;
  let checkResult: AgentResult["checkResult"] | undefined;
  let locateResult: AgentResult["locateResult"] | undefined;
  let draftPlan: AgentResult["draftPlan"] | undefined = input.panelState.draftPlan;
  let draftPreview: AgentResult["draftPreview"] | undefined = input.panelState.draftPreview;
  let draftValidation: AgentResult["draftValidation"] | undefined;
  let draftRisk: AgentResult["draftRisk"] | undefined;
  let mcpResources: AgentResult["mcpResources"] | undefined;
  let mcpResourceReads: AgentResult["mcpResourceReads"] | undefined;
  let libraryInsights: AgentResult["libraryInsights"] | undefined;
  const resolvedTaskType = input.taskType ?? "natural_chat";

  const hasExistingDraftPreview = Boolean(
    input.panelState.draftPreview || input.panelState.draftPlan || input.panelState.appliedDraftSnapshot
  );
  const draftFollowUpIntent =
    resolvedTaskType === "natural_chat" &&
    hasExistingDraftPreview &&
    (input.panelState.agentRunRoute === "draft" || input.panelState.agentRunState === "awaiting_confirmation") &&
    (looksLikeDraftFollowUpRevisionQuery(input.userQuery)
      ? "revise_existing_draft"
      : looksLikeDraftRepairQuery(input.userQuery)
        ? "repair_existing_draft"
      : looksLikeDraftRiskAnalysisQuery(input.userQuery)
        ? "analyze_existing_draft_risk"
        : "summarize_existing_draft");

  const task: AgentTask = {
    type: resolvedTaskType,
    userQuery: input.userQuery,
    context: liveContext,
    draftFollowUpIntent,
    existingDraftSummary: draftFollowUpIntent
      ? {
          title: input.panelState.draftPreview?.title ?? input.panelState.appliedDraftSnapshot?.title,
          rationale: input.panelState.draftPreview?.rationale ?? input.panelState.appliedDraftSnapshot?.rationale,
          componentRefs:
            input.panelState.draftPreview?.componentRefs ??
            input.panelState.appliedDraftSnapshot?.components?.map((item) => item.ref || item.id).filter(Boolean),
          netNames:
            input.panelState.draftPreview?.netNames ??
            input.panelState.appliedDraftSnapshot?.nets?.map((item) => item.name).filter(Boolean),
          componentCount: input.panelState.draftPreview?.componentCount ?? input.panelState.appliedDraftSnapshot?.components?.length,
          netCount: input.panelState.draftPreview?.netCount ?? input.panelState.appliedDraftSnapshot?.nets?.length,
          selectedDeviceDetails: input.panelState.draftPreview?.selectedDeviceDetails,
        }
      : undefined,
  };

  const state: ReactAgentState = {
    toolTraces: [],
    stepStates: [],
    stepItems: [],
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
        : draftFollowUpIntent === "repair_existing_draft"
          ? "natural_chat"
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
      : draftFollowUpIntent === "repair_existing_draft"
        ? !["draft_generate_plan", "editor_preview_apply_plan"].includes(tool.name) && decisionToolNames.includes(tool.name)
      : tool.name !== "editor_preview_apply_plan" && decisionToolNames.includes(tool.name)
  );

  const system = buildSystemPrompt({
    task: {
      ...task,
      preferredOutputLanguage:
        input.panelState?.customLlmConfig?.preferredOutputLanguage || task.preferredOutputLanguage,
    },
    tools: toolList,
    skills: [
      { name: "analysis", description: "分析/检查原理图问题（建议用 rules_run_schematic_checks + schematic_review）" },
      { name: "draft", description: "生成草案并预览（建议用 draft_generate_plan + draft_preview_plan；真正应用由用户点击应用草案触发）" },
      { name: "modify", description: "修改当前原理图或已应用草案（优先复用当前页面/已有草案，输出 route=modify 或 draft）" },
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
        : draftFollowUpIntent === "repair_existing_draft"
          ? "这是基于现有草案的修复请求：优先使用 draft_repair_plan 处理结构化应用错误，并在修补后继续预览或验证；除非修补失败或用户明确要求重做，否则不要调用 draft_generate_plan。"
      : draftFollowUpIntent === "analyze_existing_draft_risk"
        ? "这是基于现有草案的风险复核请求：优先说明当前草案的问题、阻断项和待补充内容；可调用 rules_validate_draft，但不要无必要重生成草案。"
      : shouldTreatAsAnalysis({ taskType: resolvedTaskType, userQuery: input.userQuery })
      ? "这是分析类任务：先调用 editor_get_current_context，再调用 rules_run_schematic_checks；如需网表级证据，再调用 schematic_review。完成这些步骤前不要直接回答。"
      : shouldTreatAsDraft({ taskType: resolvedTaskType, userQuery: input.userQuery })
        ? "这是草案类任务：先补齐事实或证据，再由模型自行整理结构化 spec 并传给 draft_generate_plan；生成 plan 后必须调用 draft_preview_plan，完成这些步骤前不要直接输出 final。"
        : [
            "请先根据用户意图自行选择 route，而不是按关键词硬分流：",
            "- route=analysis：用户要检查、审查、解释问题或输出分析报告。",
            "- route=draft：用户要从需求生成新草案，或修改已有草案并产出新的草案预览。",
            "- route=modify：用户要在当前原理图页面或已应用草案上做局部修改、补线、换器件、修连接；应优先读取当前上下文，必要时复用已有草案并生成局部修改方案。",
            "- route=chat：用户只是问答、解释、澄清。",
            "如需原理图事实，先调用 editor_get_current_context；需要检查再调用 rules_run_schematic_checks 或 schematic_review；需要生成/修改草案时再调用 draft_* 工具。不要把预览工具当成实际应用；真正应用草案只能由用户点击应用动作触发。",
          ].join("\n"),
  ].join("\n");
  const historyMessages = buildConversationHistory(input.panelState, input.userQuery);

  const requiredTools = buildRequiredTools({
    taskType:
      draftFollowUpIntent === "revise_existing_draft"
        ? "schematic_draft"
        : draftFollowUpIntent === "repair_existing_draft"
          ? "natural_chat"
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
    signal: input.signal,
    isCancelled: () => Boolean(input.signal?.aborted),
    invokeTool: (toolName, toolInput) => input.tools.invoke(toolName, toolInput, { signal: input.signal }),
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
        stepItems: payload.stepItems,
        iterationSteps: payload.iterationSteps,
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
          : requiresStructuredDraftSpec({ taskType: resolvedTaskType, userQuery }) || resolvedTaskType === "natural_chat"
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
    if (toolName === "draft_repair_plan") {
      const payload = llmInput && typeof llmInput === "object" ? (llmInput as any) : {};
      if (!draftPlan) throw new Error("draftPlan missing: call draft_generate_plan first");
      if (typeof payload.applyError !== "string" || !payload.applyError.trim()) {
        throw new Error("applyError missing: provide the original apply failure message");
      }
      return { plan: draftPlan, applyError: payload.applyError };
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

  const formatObservation = (toolName: string, output: unknown): { summary: string; messageForModel: string } => {
    const asRecord = (value: unknown): Record<string, unknown> =>
      value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const cleanText = (value: unknown): string => String(value || "").trim();
    const joinParts = (parts: unknown[], separator = "，"): string =>
      parts.map((item) => cleanText(item)).filter(Boolean).join(separator);
    if (toolName === "todo_list") {
      const payload = output && typeof output === "object" ? (output as { action?: string; tasks?: Array<{ text?: string; status?: string }> }) : {};
      const action = payload.action === "create" ? "已创建待办步骤" : "已更新待办步骤";
      const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
      const preview = tasks.slice(0, 3).map((item) => String(item?.text || "").trim()).filter(Boolean);
      return {
        summary: preview.length > 0 ? `${action}，包括：${preview.join("；")}` : action,
        messageForModel: JSON.stringify(output),
      };
    }
    if (toolName === "editor_get_current_context") {
      const ctx = output as SchematicContext | undefined;
      const componentCount = Array.isArray(ctx?.components) ? ctx.components.length : 0;
      const netCount = Array.isArray(ctx?.nets) ? ctx.nets.length : 0;
      const selectionCount = Array.isArray(ctx?.selection?.objectIds) ? ctx.selection.objectIds.length : 0;
      const pageName = String(ctx?.project?.pageName || "").trim();
      return {
        summary: `已读取当前原理图${pageName ? `“${pageName}”` : ""}，包含 ${componentCount} 个器件、${netCount} 条网络${selectionCount ? `，当前选中 ${selectionCount} 个对象` : ""}`,
        messageForModel: JSON.stringify(output),
      };
    }
    if (toolName === "rules_run_schematic_checks") {
      const result = output as AgentResult["checkResult"];
      const issues = Array.isArray(result?.issues) ? result.issues : [];
      const high = issues.filter((item) => item.severity === "high").length;
      const medium = issues.filter((item) => item.severity === "medium").length;
      const low = issues.filter((item) => item.severity === "low").length;
      return {
        summary: issues.length > 0 ? `规则检查完成，发现 ${issues.length} 个问题（高风险 ${high}、中风险 ${medium}、低风险 ${low}）` : "规则检查完成，未发现明显问题",
        messageForModel: JSON.stringify(output),
      };
    }
    if (toolName === "schematic_review") {
      const result = output as { stats?: { componentCount?: number; uniqueNetNameCount?: number }; notes?: string[] } | undefined;
      const componentCount = Number(result?.stats?.componentCount || 0);
      const netCount = Number(result?.stats?.uniqueNetNameCount || 0);
      const note = Array.isArray(result?.notes) ? String(result?.notes?.[0] || "").trim() : "";
      return {
        summary: `已读取网表证据，覆盖 ${componentCount} 个器件、${netCount} 条网络${note ? `；${note}` : ""}`,
        messageForModel: JSON.stringify(output),
      };
    }
    if (toolName === "schematic_build_analysis_evidence") {
      const result = output as { stats?: { componentCount?: number; netCount?: number }; keyComponents?: Array<{ ref?: string }> } | undefined;
      const componentCount = Number(result?.stats?.componentCount || 0);
      const netCount = Number(result?.stats?.netCount || 0);
      const keyRefs = Array.isArray(result?.keyComponents)
        ? result.keyComponents.map((item) => String(item?.ref || "").trim()).filter(Boolean).slice(0, 3)
        : [];
      return {
        summary: `已整理分析证据，覆盖 ${componentCount} 个器件、${netCount} 条网络${keyRefs.length > 0 ? `；关键器件：${keyRefs.join("、")}` : ""}`,
        messageForModel: JSON.stringify(output),
      };
    }
    if (toolName === "editor_get_selection") {
      const payload = asRecord(output);
      const objectIds = Array.isArray(payload.objectIds) ? payload.objectIds : [];
      return {
        summary: objectIds.length > 0 ? `已读取当前选区，共 ${objectIds.length} 个对象` : "已读取当前选区，当前没有选中对象",
        messageForModel: JSON.stringify(output),
      };
    }
    if (toolName === "editor_describe_selection") {
      const payload = asRecord(output);
      const count = Number(payload.count || 0);
      const summary = cleanText(payload.summary);
      return {
        summary: count > 0
          ? `已解释当前选区，共 ${count} 个对象${summary ? `；${summary}` : ""}`
          : (summary || "当前没有可解释的选中对象"),
        messageForModel: JSON.stringify(output),
      };
    }
    if (toolName === "editor_describe_object") {
      const payload = asRecord(output);
      const found = payload.found !== false;
      const objectType = cleanText(payload.objectType);
      const summary = cleanText(payload.summary);
      const label = joinParts([payload.ref, payload.name, payload.value, cleanText(payload.packageName) ? `封装 ${payload.packageName}` : ""], "，");
      return {
        summary: found
          ? `已读取${objectType === "pin" ? "引脚" : objectType === "net" ? "网络" : "对象"}信息${summary ? `：${summary}` : label ? `：${label}` : ""}`
          : (summary || "未找到对应对象"),
        messageForModel: JSON.stringify(output),
      };
    }
    if (toolName === "editor_find_object") {
      const payload = asRecord(output);
      const found = payload.found === true;
      const matches = Array.isArray(payload.matches) ? payload.matches : [];
      const summary = cleanText(payload.summary);
      const first = matches[0] && typeof matches[0] === "object" ? (matches[0] as Record<string, unknown>) : {};
      const firstLabel = joinParts([first.ref, first.name, first.summary], "，");
      return {
        summary: found
          ? (summary || `已找到 ${matches.length || 1} 个匹配对象${firstLabel ? `；例如：${firstLabel}` : ""}`)
          : (summary || "未找到匹配对象"),
        messageForModel: JSON.stringify(output),
      };
    }
    if (toolName === "issues_locate_first") {
      const payload = asRecord(output);
      const located = payload.located === true;
      const objectLabel = cleanText(payload.objectLabel);
      return {
        summary: located ? `已定位到需要关注的对象${objectLabel ? `：${objectLabel}` : ""}` : "没有找到可直接定位的问题对象",
        messageForModel: JSON.stringify(output),
      };
    }
    if (toolName === "library_search_devices") {
      const items = Array.isArray(output) ? (output as LibrarySearchResultItem[]) : [];
      const preview = items
        .slice(0, 3)
        .map((item) =>
          joinParts(
            [
              item.name,
              item.footprintName ? `封装 ${item.footprintName}` : "",
              item.supplierId ? `LCSC ${item.supplierId}` : "",
            ],
            "，"
          )
        )
        .filter(Boolean);
      return {
        summary:
          items.length > 0
            ? `已搜索到 ${items.length} 个器件候选${preview.length > 0 ? `；前几项：${preview.join("；")}` : ""}`
            : "未搜索到匹配的器件候选",
        messageForModel: JSON.stringify(output),
      };
    }
    if (toolName === "library_get_device") {
      const item = asRecord(output) as LibraryDeviceDetail;
      const summary = joinParts(
        [
          item.name,
          item.footprint?.name ? `封装 ${item.footprint.name}` : "",
          item.lcscId ? `LCSC ${item.lcscId}` : item.supplierId ? `LCSC ${item.supplierId}` : "",
          item.manufacturer,
        ],
        "，"
      );
      return {
        summary: summary ? `已读取器件详情：${summary}` : "已读取器件详情",
        messageForModel: JSON.stringify(output),
      };
    }
    if (toolName === "library_get_devices_by_lcsc_ids") {
      const items = Array.isArray(output) ? (output as LibraryDeviceDetail[]) : [];
      const preview = items
        .slice(0, 3)
        .map((item) =>
          joinParts(
            [
              item.name,
              item.footprint?.name ? `封装 ${item.footprint.name}` : "",
              item.lcscId ? `LCSC ${item.lcscId}` : item.supplierId ? `LCSC ${item.supplierId}` : "",
            ],
            "，"
          )
        )
        .filter(Boolean);
      return {
        summary:
          items.length > 0
            ? `已按 LCSC 编号匹配到 ${items.length} 个器件${preview.length > 0 ? `；前几项：${preview.join("；")}` : ""}`
            : "未按给定 LCSC 编号匹配到器件",
        messageForModel: JSON.stringify(output),
      };
    }
    if (toolName === "draft_generate_plan") {
      const plan = asRecord(output) as DraftPlan;
      const components = Array.isArray(plan.components) ? plan.components : [];
      const nets = Array.isArray(plan.nets) ? plan.nets : [];
      const refs = components
        .slice(0, 4)
        .map((item) => cleanText(item?.ref) || cleanText(item?.id))
        .filter(Boolean);
      return {
        summary:
          components.length > 0 || nets.length > 0
            ? `已生成草案计划，包含 ${components.length} 个器件、${nets.length} 条网络${refs.length > 0 ? `；器件示例：${refs.join("、")}` : ""}`
            : "已生成草案计划",
        messageForModel: JSON.stringify(output),
      };
    }
    if (toolName === "draft_repair_plan") {
      const payload = asRecord(output);
      const classification = asRecord(payload.classification);
      const kind = cleanText(classification.kind);
      const repaired = payload.repaired === true;
      return {
        summary: repaired
          ? `已按结构化错误完成草案局部修补${kind ? `：${kind}` : ""}`
          : `已分析草案应用错误${kind ? `：${kind}` : ""}，当前没有可自动修补的变更`,
        messageForModel: JSON.stringify(output),
      };
    }
    if (toolName === "draft_preview_plan" || toolName === "editor_preview_apply_plan") {
      const preview = asRecord(output) as DraftPreview & { warnings?: string[] };
      const unresolved = Array.isArray(preview.unresolvedDeviceDetails) ? preview.unresolvedDeviceDetails.length : 0;
      return {
        summary:
          cleanText(preview.title) || typeof preview.componentCount === "number" || typeof preview.netCount === "number"
            ? `已生成草案预览${cleanText(preview.title) ? `：${cleanText(preview.title)}` : ""}，包含 ${Number(preview.componentCount || 0)} 个器件、${Number(preview.netCount || 0)} 条网络${unresolved > 0 ? `；仍有 ${unresolved} 个待确认器件` : ""}`
            : "已生成草案预览",
        messageForModel: JSON.stringify(output),
      };
    }
    if (toolName === "rules_validate_draft") {
      const payload = asRecord(output);
      const issues = Array.isArray(payload.issues) ? payload.issues : [];
      const summary = cleanText(payload.summary);
      const riskLevel = cleanText((payload as { riskLevel?: string }).riskLevel);
      return {
        summary:
          summary ||
          (issues.length > 0
            ? `草案校验完成，发现 ${issues.length} 个问题${riskLevel ? `；风险等级：${riskLevel}` : ""}`
            : `草案校验完成，未发现明显问题${riskLevel ? `；风险等级：${riskLevel}` : ""}`),
        messageForModel: JSON.stringify(output),
      };
    }
    return {
      summary: typeof output === "string" ? output : JSON.stringify(output),
      messageForModel: typeof output === "string" ? output : JSON.stringify(output),
    };
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
    formatObservation,
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
      input.onStreamEvent?.({
        route,
        stage: "progress",
        detail,
        reactEvents: state.reactEvents,
        stepItems: state.stepItems,
        iterationSteps: state.iterationSteps,
        stepStates: state.stepStates,
        workingMemory: state.workingMemory,
      });
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
      input.onStreamEvent?.({
        route,
        stage: "progress",
        detail: `思考：${t}`,
        reactEvents: state.reactEvents,
        stepItems: state.stepItems,
        iterationSteps: state.iterationSteps,
        stepStates: state.stepStates,
        workingMemory: state.workingMemory,
      });
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
      if (toolName === "draft_repair_plan") {
        const repairedOutput = output as { plan?: DraftPlan; repaired?: boolean };
        if (repairedOutput?.plan) {
          draftPlan = repairedOutput.plan;
          draftPreview = undefined;
          state.workingMemory.draftReady = true;
          markStep(state, "draft", repairedOutput.repaired ? "running" : "done", repairedOutput.repaired ? "草案计划已完成局部修补" : "草案修补分析已完成");
        }
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
    stepItems: state.stepItems,
    iterationSteps: state.iterationSteps,
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
  const inferredFinalResult: AgentResult = {
    ...base,
    analysisMarkdown:
      loopResult.finalRoute === "analysis"
        ? finalText
        : loopResult.finalRoute
          ? undefined
          : checkResult
            ? finalText
            : undefined,
    naturalReply:
      loopResult.finalRoute === "chat"
        ? finalText
        : loopResult.finalRoute
          ? undefined
          : checkResult
            ? undefined
            : finalText,
  };
  const route = loopResult.finalRoute ?? inferRouteFromResult(inferredFinalResult);
  const fallbackDraftPreview =
    route === "draft" && base.draftPlan && !base.draftPreview && input.tools.get("draft_preview_plan")
      ? (await input.tools.invoke("draft_preview_plan", { plan: base.draftPlan }, { signal: input.signal }) as AgentResult["draftPreview"])
      : undefined;

  const result: AgentResult = {
    ...base,
    draftPreview: base.draftPreview ?? fallbackDraftPreview,
    draftNarrative: route === "draft" ? finalText : undefined,
    analysisMarkdown: route === "analysis" || route === "modify" ? finalText : undefined,
    naturalReply: route === "chat" ? finalText : undefined,
    selectedSkill: route === "modify" ? "modify_existing_schematic" : base.selectedSkill,
  };

  return { result, reactEvents: state.reactEvents, stepItems: state.stepItems };
}
