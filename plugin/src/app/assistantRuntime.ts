import { createPluginAgent } from "../agent";
import { MCPClient } from "../agent/mcp/mcpClient";
import { getConfig } from "../config/env";
import type { DraftPlan } from "../editor/apply-plan/draftPlan";
import { createEditorAdapter } from "../editor/adapters/createEditorAdapter";
import { buildSchematicContext } from "../editor/context/buildSchematicContext";
import { resolveHostEditorBridge, resolveRuntimeChannel } from "../editor/host/runtime";
import { FetchHttpClient, HttpError } from "../services/api-client/httpClient";
import { AuthClient, type TokenExchangeData } from "../services/auth/authClient";
import { HostBrowserLauncher } from "../services/auth/browserLauncher";
import { waitLoginSuccess } from "../services/auth/loginPolling";
import { PersistentSessionStore, type AuthSession } from "../services/auth/sessionStore";
import { CreditsClient } from "../services/credits/creditsClient";
import {
  CustomLlmConfigStore,
  DEFAULT_PREFERRED_OUTPUT_LANGUAGE,
} from "../services/llm/customLlmConfigStore";
import { LlmModeStore, type LlmMode } from "../services/llm/llmModeStore";
import { LlmProxyClient, type LlmMessage } from "../services/llm/llmProxyClient";
import { UnifiedLlmClient } from "../services/llm/unifiedLlmClient";
import { RagClient } from "../services/rag/ragClient";
import { LocalStorageKeyValueStore } from "../storage/keyValueStore";
import type { MainPanelState } from "../ui/panels/mainPanel";
import type { AgentIterationStep } from "../agent/shared/agentTypes";
import { previewDraftPlan } from "../editor/apply-plan/previewDraftPlan";
import { shouldRepairDraftApplyError } from "../editor/apply-plan/repairDraftPlan";
import { isCancelledError } from "../agent/core/cancelledError";
import { resolveDraftPlanDevices } from "../editor/apply-plan/resolveDraftPlanDevices";
import type { HostEditorBridge } from "../editor/host/runtime";
import {
  summarizeDraftPatchPlan,
  type AppliedDraftSnapshot,
  type DraftObjectBindings,
} from "../editor/apply-plan/draftPatchPlan";
import { buildDraftPatchPlan } from "../editor/apply-plan/buildDraftPatchPlan";
import { executeDraftPatchPlan } from "../editor/apply-plan/executeDraftPatchPlan";

const GLOBAL_KEY = "__LCEDA_AI_ASSISTANT_RUNTIME__";
const PANEL_STATE_STORAGE_KEY = "lceda_ai.panel.last_state";
const PERF_DEBUG_STORAGE_KEY = "lceda_ai.perf_debug";
const STREAM_STATS_STORAGE_KEY = "lceda_ai.stream_stats";
const STAGE_TIMING_STORAGE_KEY = "lceda_ai.stage_timing";
const PANEL_SESSION_INDEX_STORAGE_KEY = "lceda_ai.panel.session_index";
const PANEL_SESSION_STATE_PREFIX = "lceda_ai.panel.session.";
const MAX_SESSION_HISTORY = 20;
type IssueObjectType = "component" | "pin" | "net";
const LOG_PREFIX = "[LCEDA-AI][runtime]";
const ENABLE_VERBOSE_RUNTIME_LOGS = false;
const ENABLE_STREAM_STEP_DEBUG =
  (typeof globalThis !== "undefined" &&
    Boolean((globalThis as typeof globalThis & Record<string, unknown>).__LCEDA_AI_STREAM_DEBUG__));
// Streaming can emit lots of deltas; committing/persisting on every delta makes the UI churn.
const STREAM_COMMIT_MIN_INTERVAL_MS = 250;
const MAX_STREAM_STEP_ITEMS = 80;
const MAX_STREAM_ITERATION_STEPS = 60;
const MAX_STREAM_REACT_EVENTS = 120;
const PERSIST_PANEL_STATE_THROTTLE_MS = 600;
const CONTEXT_COMPACTION_TRIGGER_TURNS = 20;
const CONTEXT_COMPACTION_KEEP_RECENT_TURNS = 3;
const CONTEXT_COMPACTION_MAX_TURNS = 30;
const CONTEXT_COMPACTION_TITLE = "上下文下压缩";
const MAX_DRAFT_REPAIR_ATTEMPTS = 2;

let persistPanelTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPersist: { storage: LocalStorageKeyValueStore; state: MainPanelState } | null = null;

type ChatMessage = NonNullable<MainPanelState["chatMessages"]>[number];
type StreamEventPayload = {
  route: "chat" | "analysis" | "draft" | "modify";
  stage: "llm" | "progress";
  textDelta?: string;
  text?: string;
  reasoningDelta?: string;
  detail?: string;
  reactEvents?: unknown[];
  stepItems?: unknown[];
  iterationSteps?: unknown[];
  stepStates?: unknown[];
  workingMemory?: unknown;
};

export function isPerfDebugEnabled(): boolean {
  let storageFlag = false;
  try {
    storageFlag =
      typeof localStorage !== "undefined" &&
      localStorage.getItem(PERF_DEBUG_STORAGE_KEY) === "1";
  } catch {
    storageFlag = false;
  }
  return (
    typeof globalThis !== "undefined" &&
    Boolean((globalThis as typeof globalThis & Record<string, unknown>).__LCEDA_AI_PERF_DEBUG__)
  ) || storageFlag;
}

function getPerfNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function logPerf(label: string, detail: Record<string, unknown>): void {
  if (!isPerfDebugEnabled() || typeof console === "undefined") {
    return;
  }
  console.log(`${LOG_PREFIX} perf.${label}`, detail);
}

function isStreamStatsEnabled(): boolean {
  let storageFlag = false;
  try {
    storageFlag =
      typeof localStorage !== "undefined" &&
      localStorage.getItem(STREAM_STATS_STORAGE_KEY) === "1";
  } catch {
    storageFlag = false;
  }
  return (
    typeof globalThis !== "undefined" &&
    Boolean((globalThis as typeof globalThis & Record<string, unknown>).__LCEDA_AI_STREAM_STATS__)
  ) || storageFlag;
}

function isStageTimingEnabled(): boolean {
  let storageFlag = false;
  try {
    storageFlag =
      typeof localStorage !== "undefined" &&
      (localStorage.getItem(STAGE_TIMING_STORAGE_KEY) === "1" ||
        localStorage.getItem(STREAM_STATS_STORAGE_KEY) === "1");
  } catch {
    storageFlag = false;
  }
  return (
    typeof globalThis !== "undefined" &&
    (Boolean((globalThis as typeof globalThis & Record<string, unknown>).__LCEDA_AI_STAGE_TIMING__) ||
      Boolean((globalThis as typeof globalThis & Record<string, unknown>).__LCEDA_AI_STREAM_STATS__))
  ) || storageFlag;
}

function logStageTiming(scope: string, label: string, detail: Record<string, unknown>): void {
  if (!isStageTimingEnabled() || typeof console === "undefined") return;
  console.log(`${LOG_PREFIX} timing.${scope}.${label}`, detail);
}

function createStreamStatsLogger(turnId: number): {
  event(input: {
    event: {
      route?: string;
      stage?: string;
      textDelta?: string;
      reasoningDelta?: string;
      text?: string;
      stepItems?: unknown[];
      iterationSteps?: unknown[];
      reactEvents?: unknown[];
      stepStates?: unknown[];
      workingMemory?: unknown;
    };
    changed?: boolean;
    committed?: boolean;
    scheduled?: boolean;
    durationMs?: number;
  }): void;
  flush(reason: string): void;
} {
  const enabled = isStreamStatsEnabled();
  const startedAt = Date.now();
  let lastFlushAt = startedAt;
  let events = 0;
  let changed = 0;
  let commits = 0;
  let scheduled = 0;
  let llm = 0;
  let progress = 0;
  let textDeltaChars = 0;
  let reasoningDeltaChars = 0;
  let maxTextLength = 0;
  let maxStepItems = 0;
  let maxIterationSteps = 0;
  let maxReactEvents = 0;
  let maxStepStates = 0;
  let workingMemoryEvents = 0;
  let maxDurationMs = 0;

  const flush = (reason: string) => {
    if (!enabled || typeof console === "undefined" || events === 0) return;
    const now = Date.now();
    console.log(`${LOG_PREFIX} stream-stats`, {
      turnId,
      reason,
      windowMs: now - lastFlushAt,
      totalMs: now - startedAt,
      events,
      changed,
      commits,
      scheduled,
      llm,
      progress,
      textDeltaChars,
      reasoningDeltaChars,
      maxTextLength,
      maxStepItems,
      maxIterationSteps,
      maxReactEvents,
      maxStepStates,
      workingMemoryEvents,
      maxDurationMs: Number(maxDurationMs.toFixed(2)),
    });
    lastFlushAt = now;
    events = 0;
    changed = 0;
    commits = 0;
    scheduled = 0;
    llm = 0;
    progress = 0;
    textDeltaChars = 0;
    reasoningDeltaChars = 0;
    maxTextLength = 0;
    maxStepItems = 0;
    maxIterationSteps = 0;
    maxReactEvents = 0;
    maxStepStates = 0;
    workingMemoryEvents = 0;
    maxDurationMs = 0;
  };

  return {
    event(input) {
      if (!enabled) return;
      const event = input.event;
      events += 1;
      if (input.changed) changed += 1;
      if (input.committed) commits += 1;
      if (input.scheduled) scheduled += 1;
      if (event.stage === "llm") llm += 1;
      if (event.stage === "progress") progress += 1;
      textDeltaChars += String(event.textDelta || "").length;
      reasoningDeltaChars += String(event.reasoningDelta || "").length;
      maxTextLength = Math.max(maxTextLength, String(event.text || "").length);
      maxStepItems = Math.max(maxStepItems, Array.isArray(event.stepItems) ? event.stepItems.length : 0);
      maxIterationSteps = Math.max(maxIterationSteps, Array.isArray(event.iterationSteps) ? event.iterationSteps.length : 0);
      maxReactEvents = Math.max(maxReactEvents, Array.isArray(event.reactEvents) ? event.reactEvents.length : 0);
      maxStepStates = Math.max(maxStepStates, Array.isArray(event.stepStates) ? event.stepStates.length : 0);
      if (event.workingMemory) workingMemoryEvents += 1;
      maxDurationMs = Math.max(maxDurationMs, Number(input.durationMs || 0));
      if (Date.now() - lastFlushAt >= 2000) {
        flush("interval");
      }
    },
    flush,
  };
}

function canBuildPatchPreview(input: {
  appliedDraftSnapshot?: AppliedDraftSnapshot;
  draftObjectBindings?: DraftObjectBindings;
  currentPageId?: string;
}): boolean {
  const snapshot = input.appliedDraftSnapshot;
  const bindings = input.draftObjectBindings;
  if (!snapshot || !bindings || bindings.authoritative !== true) {
    return false;
  }

  if (snapshot.pageId && bindings.pageId && snapshot.pageId !== bindings.pageId) {
    return false;
  }

  if (!input.currentPageId) {
    return true;
  }

  if (snapshot.pageId && snapshot.pageId !== input.currentPageId) {
    return false;
  }

  if (bindings.pageId && bindings.pageId !== input.currentPageId) {
    return false;
  }

  return true;
}

function buildDraftPlanFingerprint(plan: DraftPlan): string {
  return JSON.stringify({
    title: plan.title,
    rationale: plan.rationale,
    components: plan.components,
    pins: plan.pins,
    nets: plan.nets,
  });
}

export function planContextCompaction(messages: MainPanelState["chatMessages"]): {
  shouldCompact: boolean;
  olderMessages: ChatMessage[];
  recentMessages: ChatMessage[];
} {
  const sanitized = sanitizeChatMessages(messages).filter((message) => !message.streaming);
  const turnIndices = sanitized
    .map((message, index) => (message.role === "user" ? index : -1))
    .filter((index) => index >= 0);

  if (turnIndices.length < CONTEXT_COMPACTION_TRIGGER_TURNS) {
    return {
      shouldCompact: false,
      olderMessages: [],
      recentMessages: sanitized,
    };
  }

  const keepTurnCount = Math.min(CONTEXT_COMPACTION_KEEP_RECENT_TURNS, turnIndices.length);
  const rawStartIndex = turnIndices[turnIndices.length - keepTurnCount] ?? 0;
  const olderMessages = sanitized.slice(0, rawStartIndex);
  const recentMessages = sanitized.slice(rawStartIndex);

  return {
    shouldCompact: olderMessages.length > 0,
    olderMessages,
    recentMessages,
  };
}

export async function applyDraftPlanWithRepair(input: {
  initialPlan: DraftPlan;
  applyPlan: (plan: DraftPlan) => Promise<{ applied: boolean; componentCount: number; netCount: number; transactionId?: string }>;
  repairPlan: (args: { plan: DraftPlan; applyError: string }) => Promise<{ repaired?: boolean; plan?: DraftPlan }>;
  maxRepairAttempts?: number;
}): Promise<{
  result: { applied: boolean; componentCount: number; netCount: number; transactionId?: string };
  finalPlan: DraftPlan;
  repaired: boolean;
  repairCount: number;
}> {
  let currentPlan = input.initialPlan;
  let repaired = false;
  let repairCount = 0;
  const maxRepairAttempts = Math.max(0, input.maxRepairAttempts ?? 0);

  while (true) {
    try {
      const result = await input.applyPlan(currentPlan);
      return {
        result,
        finalPlan: currentPlan,
        repaired,
        repairCount,
      };
    } catch (error) {
      if (repairCount >= maxRepairAttempts || !shouldRepairDraftApplyError(error)) {
        throw error;
      }
      const repairedResult = await input.repairPlan({
        plan: currentPlan,
        applyError: error instanceof Error ? error.message : String(error),
      });
      if (!repairedResult?.repaired || !repairedResult.plan) {
        throw error;
      }
      currentPlan = repairedResult.plan;
      repaired = true;
      repairCount += 1;
    }
  }
}

function formatMessagesForCompaction(messages: ChatMessage[]): string {
  return messages
    .map((message) => {
      if (message.contextCompaction) {
        return "";
      }
      const role = message.role === "user" ? "用户" : "助手";
      const title = message.title ? `（${message.title}）` : "";
      const content = String(message.content || message.analysisMarkdown || "").trim();
      if (!content) return "";
      return `${role}${title}：\n${content}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

async function compactChatHistoryIfNeeded(input: {
  state: MainPanelState;
  llmClient: UnifiedLlmClient;
}): Promise<void> {
  const { state, llmClient } = input;
  const currentMessages = sanitizeChatMessages(state.chatMessages).filter((message) => !message.streaming);
  const plan = planContextCompaction(currentMessages);
  if (!plan.shouldCompact) return;

  const recentTurnCount = plan.recentMessages.filter((message) => message.role === "user").length;
  const olderTurnCount = plan.olderMessages.filter((message) => message.role === "user").length;
  const olderText = formatMessagesForCompaction(plan.olderMessages);
  if (!olderText) return;

  const compressionPrompt: LlmMessage[] = [
    {
      role: "system",
      content: [
        "你是对话上下文压缩助手。",
        "请将给定的历史对话压缩成一条供后续多轮对话继续使用的摘要。",
        "要求：",
        "- 只保留对后续继续理解用户诉求和助手承诺有帮助的信息。",
        "- 保留：用户目标、关键约束、已确认结论、未解决问题、关键建议。",
        "- 删除：寒暄、重复表述、详细推理过程、工具日志。",
        "- 输出必须是简洁 Markdown，长度控制在 600 汉字以内。",
        `- 标题固定为：## ${CONTEXT_COMPACTION_TITLE}`,
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `请压缩以下较早历史对话，共 ${olderTurnCount} 轮：`,
        "",
        olderText,
      ].join("\n"),
    },
  ];

  const compressed = await llmClient.generate({
    messages: compressionPrompt,
  });
  const summary = String(compressed.output_text || "").trim();
  if (!summary) return;

  const compactedMessage: ChatMessage = {
    role: "assistant",
    title: CONTEXT_COMPACTION_TITLE,
    content: summary,
    tone: "default",
    contextCompaction: {
      compressedTurns: olderTurnCount,
      keptRecentTurns: recentTurnCount,
      createdAt: new Date().toISOString(),
      version: 1,
    },
    structuredContent: [
      {
        kind: "paragraph",
        text: `已执行${CONTEXT_COMPACTION_TITLE}：压缩 ${olderTurnCount} 轮历史，保留最近 ${recentTurnCount} 轮原始对话。`,
      },
      {
        kind: "section",
        title: "压缩摘要",
        text: summary.replace(/^##\s*上下文下压缩\s*/u, "").trim(),
      },
    ],
  };

  const merged = [compactedMessage, ...plan.recentMessages];
  const trimmed = merged.slice(-(CONTEXT_COMPACTION_MAX_TURNS * 2 + 1));
  state.chatMessages = trimmed;
  state.summary = `已执行${CONTEXT_COMPACTION_TITLE}：压缩 ${olderTurnCount} 轮历史，保留最近 ${recentTurnCount} 轮原始对话。`;
}

function schedulePersistPanelState(
  storage: LocalStorageKeyValueStore,
  state: MainPanelState,
  force: boolean
): void {
  pendingPersist = { storage, state };
  if (force) {
    if (persistPanelTimer) {
      clearTimeout(persistPanelTimer);
      persistPanelTimer = null;
    }
    const latest = pendingPersist;
    pendingPersist = null;
    if (latest) {
      void persistPanelState(latest.storage, latest.state);
    }
    return;
  }
  if (persistPanelTimer) return;
  persistPanelTimer = setTimeout(() => {
    persistPanelTimer = null;
    const latest = pendingPersist;
    pendingPersist = null;
    if (latest) {
      void persistPanelState(latest.storage, latest.state);
    }
  }, PERSIST_PANEL_STATE_THROTTLE_MS);
}

function cancelScheduledPanelStatePersist(): void {
  pendingPersist = null;
  if (persistPanelTimer) {
    clearTimeout(persistPanelTimer);
    persistPanelTimer = null;
  }
}

export function shouldIgnoreDuplicateSendWhileRunning(input: {
  trimmedInput: string;
  pendingChatInput?: string;
  activeTurnId?: number;
  agentRunState?: MainPanelState["agentRunState"];
  lastUserMessageContent?: string;
}): boolean {
  const normalizedInput = input.trimmedInput.trim();
  const normalizedPending = input.pendingChatInput?.trim();
  const normalizedLastUser = input.lastUserMessageContent?.trim();
  if (!normalizedInput) {
    return false;
  }
  const isRunning =
    input.agentRunState === "planning" ||
    input.agentRunState === "running_tools" ||
    input.agentRunState === "waiting_llm";
  if (!isRunning) {
    return false;
  }
  if (normalizedPending && normalizedInput === normalizedPending) {
    return Boolean(input.activeTurnId || input.agentRunState === "planning");
  }
  return Boolean(normalizedLastUser && normalizedInput === normalizedLastUser);
}

export function shouldStopRunningTurnFromComposer(input: {
  activeTurnId?: number;
  agentRunState?: MainPanelState["agentRunState"];
}): boolean {
  if (!input.activeTurnId) {
    return false;
  }
  return (
    input.agentRunState === "planning" ||
    input.agentRunState === "running_tools" ||
    input.agentRunState === "waiting_llm"
  );
}

export function shouldSendComposerPrompt(input: {
  isBusy: boolean;
  text: string;
}): boolean {
  if (input.isBusy) {
    return true;
  }
  return Boolean(String(input.text || "").trim());
}

export function shouldAutoApplyDraftFromChatInput(input: {
  agentRunState?: MainPanelState["agentRunState"];
  input: string;
  hasDraftPlan: boolean;
  draftBlocked?: boolean;
}): boolean {
  if (input.agentRunState !== "awaiting_confirmation") {
    return false;
  }
  if (!input.hasDraftPlan || input.draftBlocked) {
    return false;
  }
  const normalized = input.input.trim().toLowerCase();
  return /^(确认|确定|应用|应用草案|好的应用|开始应用|ok|okay|yes)$/u.test(normalized);
}

export function formatDraftApplyErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const emptyPageMatch = message.match(/draft apply requires an empty schematic page(?:: current page "([^"]+)" already has content)?/i);
  if (!emptyPageMatch) {
    const unresolvedPinMatch = message.match(/unresolved draft pin mappings:\s*(.+)$/i);
    if (unresolvedPinMatch) {
      const rawPins = unresolvedPinMatch[1]
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const refs = Array.from(
        new Set(
          rawPins
            .map((item) => item.split(".")[0]?.trim())
            .filter(Boolean)
        )
      ).join("、");
      return refs
        ? `应用草案失败：${refs} 等器件的连接还没有自动校正完成。请先确认相关器件型号，再重新应用草案。`
        : "应用草案失败：当前草案中仍有部分器件连接未自动校正完成。请先确认相关器件型号，再重新应用草案。";
    }
    const unresolvedPlacementMatch = message.match(
      /typed placement requires all draft components to have resolved devices:\s*(.+)$/i
    );
    if (unresolvedPlacementMatch) {
      const rawRefs = unresolvedPlacementMatch[1]
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const refs = rawRefs.join("、");
      return `应用草案失败：以下器件还没有完成可放置器件选型：${refs}。请先完成器件确认，再重新应用草案。`;
    }
    return `应用草案失败：${message}`;
  }
  const pageName = emptyPageMatch[1];
  return pageName
    ? `应用草案失败：当前原理图页“${pageName}”已有内容。请先新建空白原理图页，再重新应用草案。`
    : "应用草案失败：当前原理图页已有内容。请先新建空白原理图页，再重新应用草案。";
}

export function hasUnresolvedDraftDevices(plan?: DraftPlan): boolean {
  return Boolean(
    plan?.components?.some((component) => component.properties?.device_resolution_status === "unresolved")
  );
}

export function buildDevicePickerSearchProgressText(current: number, total: number): string {
  return `正在搜索待确认器件候选（${current}/${total}）...`;
}

export function buildDevicePickerApplyProgressText(current: number, total: number): string {
  return `正在确认待确认器件（${current}/${total}）...`;
}

export function applyCustomLlmConfigSavedState(state: MainPanelState, toastId: number): MainPanelState {
  state.summary = "自定义 LLM 配置已保存。";
  state.toast = {
    id: toastId,
    message: state.summary,
  };
  return state;
}

export function buildDraftApplyUnavailableMessage(input: {
  adapterSource: "host" | "mock" | "unimplemented";
  capabilityReport?: {
    channel: string;
    available: boolean;
    missing: string[];
    optionalMissing: string[];
  } | null;
}): string {
  const missing = [...(input.capabilityReport?.missing ?? []), ...(input.capabilityReport?.optionalMissing ?? [])]
    .filter((item) => item === "applyPlan" || item === "rollbackApplyPlan");
  const missingText = missing.length > 0 ? `；缺少能力：${missing.join("、")}` : "";
  return `应用草案失败：宿主未真正执行原理图应用。当前适配器来源：${input.adapterSource}${missingText}。请先检查宿主 applyPlan 能力是否已接通。`;
}

function formatSkippedConnectionLabel(connection: {
  fromComponentRef?: string;
  fromPin?: string;
  toComponentRef?: string;
  toPin?: string;
  netName?: string;
}): string {
  const from = [connection.fromComponentRef, connection.fromPin].filter(Boolean).join(".");
  const to = [connection.toComponentRef, connection.toPin].filter(Boolean).join(".");
  if (from && to) {
    return `${from} -> ${to}${connection.netName ? ` (${connection.netName})` : ""}`;
  }
  if (from) {
    return `${from}${connection.netName ? ` (${connection.netName})` : ""}`;
  }
  return connection.netName || "未解析连接";
}

export function formatDraftApplySuccessSummary(result: {
  componentCount: number;
  netCount: number;
  partialWiring?: {
    connectedNetCount: number;
    skippedConnectionCount: number;
    skippedConnections?: Array<{
      fromComponentRef?: string;
      fromPin?: string;
      toComponentRef?: string;
      toPin?: string;
      netName?: string;
      reason: string;
    }>;
  };
}): {
  title: string;
  summary: string;
  content: string;
} {
  const skippedCount = result.partialWiring?.skippedConnectionCount ?? 0;
  const connectedCount = result.partialWiring?.connectedNetCount ?? result.netCount;
  if (skippedCount <= 0) {
    const summary = `草案已应用：器件 ${result.componentCount}，网络 ${result.netCount}。`;
    return {
      title: "已应用草案",
      summary,
      content: `草案已成功应用到画布。\n器件数：${result.componentCount}\n网络数：${result.netCount}\n如不符合预期可以立即回滚。`,
    };
  }
  const manualItems = (result.partialWiring?.skippedConnections ?? [])
    .slice(0, 6)
    .map((item) => `- ${formatSkippedConnectionLabel(item)}`);
  const summary = `草案已应用，但有 ${skippedCount} 处连接需手动处理：已放置 ${result.componentCount} 个器件，已自动连线 ${connectedCount} 条。`;
  return {
    title: "已应用，部分连接需手动处理",
    summary,
    content: [
      "草案已放置到画布，未能自动解析的连接已跳过。",
      `器件数：${result.componentCount}`,
      `原始网络数：${result.netCount}`,
      `已自动连线：${connectedCount}`,
      `需手动连线：${skippedCount}`,
      manualItems.length > 0 ? "待手动处理：" : "",
      ...manualItems,
      "如不符合预期可以立即回滚。",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function buildAppliedDraftSnapshot(input: {
  plan: DraftPlan;
  transactionId?: string;
  pageId?: string;
}): AppliedDraftSnapshot {
  const stableDraftPayload = JSON.stringify({
    title: input.plan.title,
    rationale: input.plan.rationale,
    components: input.plan.components,
    pins: input.plan.pins,
    nets: input.plan.nets,
  });
  let hash = 2166136261;
  for (let index = 0; index < stableDraftPayload.length; index += 1) {
    hash ^= stableDraftPayload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return {
    draftVersionId: `draft_${(hash >>> 0).toString(36)}`,
    applyTransactionId: input.transactionId,
    title: input.plan.title,
    rationale: input.plan.rationale,
    appliedAt: new Date().toISOString(),
    pageId: input.pageId,
    components: input.plan.components,
    pins: input.plan.pins,
    nets: input.plan.nets,
  };
}

function buildInitialDraftObjectBindings(pageId?: string): DraftObjectBindings {
  return {
    pageId,
    authoritative: false,
    componentBindings: [],
    wireBindings: [],
  };
}

export async function enrichDraftPlanFromBridge(
  plan: DraftPlan | undefined,
  bridge?: Pick<HostEditorBridge, "getLibraryDevice" | "getLibrarySymbol" | "getLibrarySymbolSource">
): Promise<DraftPlan | undefined> {
  if (!plan || !bridge?.getLibraryDevice) {
    return plan;
  }
  return resolveDraftPlanDevices(
    plan,
    async () => [],
    async ({ deviceUuid, libraryUuid }) =>
      bridge.getLibraryDevice!({
        deviceUuid,
        libraryUuid,
        scope: "system",
      }),
    bridge.getLibrarySymbol
      ? async ({ symbolUuid, libraryUuid }) =>
          bridge.getLibrarySymbol!({
            symbolUuid,
            libraryUuid,
            scope: "system",
          })
      : undefined,
    bridge.getLibrarySymbolSource
      ? async ({ symbolUuid, libraryUuid }) =>
          bridge.getLibrarySymbolSource!({
            symbolUuid,
            libraryUuid,
            scope: "system",
          })
      : undefined
  );
}

export function shouldUseDraftReplyLeadNarrative(input: {
  draftNarrative?: string;
  naturalReply?: string;
}): string | undefined {
  const draftNarrative = String(input.draftNarrative || "").trim();
  if (draftNarrative) {
    return draftNarrative;
  }
  const naturalReply = String(input.naturalReply || "").trim();
  return naturalReply || undefined;
}

export interface SessionHistoryEntry {
  sessionId: string;
  sessionTitle: string;
  createdAt: string;
  updatedAt: string;
}

export interface DevicePickerCandidate {
  uuid: string;
  name: string;
  libraryUuid: string;
  displayName?: string;
  symbolUuid?: string;
  symbolName?: string;
  footprintUuid?: string;
  footprintName?: string;
  manufacturer?: string;
  supplier?: string;
  supplierId?: string;
  description?: string;
  resolvedFrom?: "search" | "lcsc_detail" | "device_detail";
}

const DEVICE_PICKER_MODEL_LCSC_FALLBACKS: Record<string, string[]> = {
  IP5306: ["C181692"],
  INMP441: ["C5438445"],
  NS4168: ["C910588"],
  MAX98357A: ["C910544"],
  ME6211: ["C82942"],
  XC6206: ["C5446"],
};

function buildDraftDeviceSearchProperties(input: {
  role?: string;
  defaultQuery?: string;
  manualQuery?: string;
  componentName?: string;
  componentValue?: string;
}): import("../editor/host/runtime").LibraryDeviceSearchProperties[] {
  const propertiesList: import("../editor/host/runtime").LibraryDeviceSearchProperties[] = [];
  const push = (props: import("../editor/host/runtime").LibraryDeviceSearchProperties) => {
    const normalized = Object.fromEntries(
      Object.entries(props).filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    ) as import("../editor/host/runtime").LibraryDeviceSearchProperties;
    if (Object.keys(normalized).length > 0) {
      propertiesList.push(normalized);
    }
  };

  const role = String(input.role ?? "").trim();
  const defaultQuery = String(input.defaultQuery ?? "").trim();
  const manualQuery = String(input.manualQuery ?? "").trim();
  const componentName = String(input.componentName ?? "").trim();
  const componentValue = String(input.componentValue ?? "").trim();
  const modelHint = [manualQuery, defaultQuery, componentName, componentValue]
    .join(" ")
    .match(/\b[A-Z]{1,6}\d{2,}[A-Z0-9-]*\b/i)?.[0];

  const lcscId = extractLcscIdsFromText([manualQuery, defaultQuery, componentName, componentValue].join(" "))[0];
  if (lcscId) {
    push({ supplierId: lcscId, partCode: lcscId });
  }
  if (modelHint) {
    push({ name: modelHint, partNumber: modelHint });
  }

  if (role === "power_connector") {
    push({ name: "USB Type-C", footprintName: "TYPE-C", description: "usb type-c receptacle" });
  } else if (role === "charger_powerbank") {
    push({ name: "IP5306", partNumber: "IP5306", description: "charge boost power management" });
  } else if (role === "microphone") {
    push({ name: "INMP441", symbolName: "INMP441", description: "I2S MEMS microphone" });
  } else if (role === "audio_amplifier") {
    push({ name: "MAX98357A", description: "I2S audio amplifier" });
    push({ name: "NS4168", description: "I2S audio amplifier" });
  } else if (role === "ldo_regulator") {
    push({ name: modelHint || "ME6211", description: "LDO regulator", value: componentValue || "3.3V" });
  }

  if (manualQuery) {
    push({ name: manualQuery, description: manualQuery });
  }
  if (defaultQuery) {
    push({ name: defaultQuery, description: defaultQuery });
  }
  if (componentName) {
    push({ name: componentName });
  }

  return propertiesList.slice(0, 6);
}

export function applyDraftDeviceCandidateSelection(
  plan: DraftPlan,
  input: {
    componentId: string;
    candidate: DevicePickerCandidate;
  }
): DraftPlan {
  const component = plan.components.find((entry) => entry.id === input.componentId);
  if (!component) {
    return plan;
  }
  component.libraryId = input.candidate.uuid;
  component.packageName = input.candidate.footprintName || component.packageName;
  component.properties = {
    ...component.properties,
    device_uuid: input.candidate.uuid,
    library_uuid: input.candidate.libraryUuid,
    symbol_uuid: input.candidate.symbolUuid || "",
    footprint_uuid: input.candidate.footprintUuid || "",
    device_resolution_status: "resolved",
    device_resolution_reason: "manual_selection",
  };
  const role = resolveDraftComponentRole(component);
  plan.selectedDevices = [
    ...(plan.selectedDevices ?? []).filter((entry) => entry.componentId !== input.componentId),
    {
      componentId: input.componentId,
      componentRef: component.ref ?? component.id,
      role,
      query: component.properties?.preferred_search_query || "",
      deviceUuid: input.candidate.uuid,
      libraryUuid: input.candidate.libraryUuid,
      name: input.candidate.displayName || input.candidate.name,
      manufacturer: input.candidate.manufacturer,
      symbolUuid: input.candidate.symbolUuid,
      symbolName: input.candidate.symbolName,
      footprintUuid: input.candidate.footprintUuid,
      footprintName: input.candidate.footprintName,
    },
  ];
  return plan;
}

export function buildDevicePickerRoleLabel(role: string | undefined): string {
  switch (String(role || "").trim()) {
    case "mcu":
    case "mcu_module":
      return "主控模块";
    case "charger_powerbank":
    case "battery_charger":
      return "充放电管理";
    case "usb_c_connector":
      return "USB-C 接口";
    case "microphone":
      return "麦克风";
    case "audio_amplifier":
      return "音频功放";
    case "speaker_connector":
      return "扬声器接口";
    case "boot_resistor":
      return "启动/复位电阻";
    case "decoupling_capacitor":
      return "去耦电容";
    case "power_connector":
      return "电源输入接口";
    case "battery_connector":
      return "电池接口";
    case "ldo_regulator":
      return "稳压器";
    case "resistor":
      return "电阻";
    case "led":
      return "LED 指示灯";
    case "input_capacitor":
      return "输入电容";
    default:
      return "待确认器件";
  }
}

export function buildDevicePickerReasonLabel(input: {
  reason?: string;
  role?: string;
  query?: string;
}): string {
  const reason = String(input.reason || "").trim();
  if (reason === "all_candidates_filtered") {
    return "自动筛选后没有找到完全符合当前用途的器件，下面展示的是接近的候选。";
  }
  if (reason === "manual_selection") {
    return "该器件由你手动确认，后续会按这个选择继续应用草案。";
  }
  if (reason === "resolved_from_library") {
    return "已从器件库中找到可直接使用的匹配器件。";
  }
  if (reason === "unresolved") {
    return `还没有找到可直接确认的${buildDevicePickerRoleLabel(input.role)}。`;
  }
  if (reason) {
    return `当前需要你确认这个${buildDevicePickerRoleLabel(input.role)}是否合适。`;
  }
  return `当前需要你确认这个${buildDevicePickerRoleLabel(input.role)}是否适合放在这里。`;
}

function inferCandidateTypeLabel(candidate: DevicePickerCandidate): string {
  const haystack = [candidate.name, candidate.description, candidate.footprintName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/type-?c|usb[-\s]?c/.test(haystack)) return "USB Type-C 接口";
  if (/usb/.test(haystack)) return "USB 接口";
  if (/header|conn|connector|母座|插座|接口|座子/.test(haystack)) return "连接器";
  if (/ldo|regulator|稳压/.test(haystack)) return "稳压器";
  if (/resistor|电阻/.test(haystack)) return "电阻";
  if (/led/.test(haystack)) return "LED";
  return "通用器件";
}

export function buildDevicePickerCandidatePresentation(
  item: { role?: string; query?: string },
  candidate: DevicePickerCandidate,
  index: number
): {
  typeLabel: string;
  fitLabel: string;
  fitLevel: "recommended" | "possible" | "weak";
  summary: string;
  reasons: string[];
  cautions: string[];
} {
  const haystack = [candidate.name, candidate.description, candidate.footprintName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const query = String(item.query || "").trim();
  const queryLower = query.toLowerCase();
  const reasons: string[] = [];
  const cautions: string[] = [];
  let fitLevel: "recommended" | "possible" | "weak" = index === 0 ? "possible" : "weak";

  if (item.role === "power_connector") {
    if (/type-?c|usb[-\s]?c/.test(haystack)) {
      fitLevel = "recommended";
      reasons.push("接口外形与查询目标接近，更可能适合作为当前接口位。");
      if (/16pin/.test(haystack) || /16pin/.test(queryLower)) {
        reasons.push("引脚数与查询词里的 16PIN 方向一致。");
      }
      cautions.push("如果这一路只拿来供电，不做 USB 数据，后续还要确认是否真的需要完整 16Pin 方案。");
    } else if (/usb/.test(haystack) || /connector|母座|插座|接口|座子/.test(haystack)) {
      fitLevel = "possible";
      reasons.push("它属于接口/连接器类器件，有可能用于外部供电输入。");
      cautions.push("但名称里没有明确显示为 Type-C，需要再确认接口形态和引脚定义。");
    } else {
      fitLevel = "weak";
      cautions.push("从名称上看不像典型的电源输入连接器，建议谨慎选择。");
    }
  }

  if (query && haystack.includes(queryLower.replace(/\s+/g, "").replace(/-/g, ""))) {
    reasons.push("器件名称与当前查询词高度接近。");
  }

  const fitLabel =
    fitLevel === "recommended" ? "较匹配" : fitLevel === "possible" ? "可考虑" : "需谨慎";

  let summary = "这是一个可供你进一步确认的候选器件。";
  if (item.role === "power_connector") {
    if (fitLevel === "recommended") {
      summary = `可作为电源输入接口使用，和当前“${query || "目标接口"}”的查询目标基本一致。`;
    } else if (fitLevel === "possible") {
      summary = "它看起来属于连接器类器件，但是否完全符合当前接口用途还需要你再确认。";
    } else {
      summary = "它被搜到了，但从名称看和当前接口用途的匹配度不高。";
    }
  }

  return {
    typeLabel: inferCandidateTypeLabel(candidate),
    fitLabel,
    fitLevel,
    summary,
    reasons,
    cautions,
  };
}

function readSearchString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function parseJsonPayloadString(payload: string): unknown {
  const trimmed = payload.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return payload;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return payload;
  }
}

function flattenLibrarySearchListGroups(value: unknown): unknown[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  return Object.values(value as Record<string, unknown>).flatMap((entry) => {
    if (Array.isArray(entry)) {
      return entry;
    }
    if (entry && typeof entry === "object") {
      return flattenLibrarySearchListGroups(entry);
    }
    return [];
  });
}

function summarizeLibrarySearchPayloadKind(payload: unknown): string {
  if (Array.isArray(payload)) return `array:${payload.length}`;
  if (typeof payload === "string") return "string";
  if (!payload || typeof payload !== "object") return typeof payload;
  const record = payload as Record<string, unknown>;
  if (record.result && typeof record.result === "object") {
    const nested = record.result as Record<string, unknown>;
    if (nested.lists && typeof nested.lists === "object") {
      return `result.lists:${Object.keys(nested.lists as Record<string, unknown>).join(",")}`;
    }
    if (Array.isArray(nested.results)) return `result.results:${nested.results.length}`;
    if (Array.isArray(nested.items)) return `result.items:${nested.items.length}`;
  }
  if (record.lists && typeof record.lists === "object") {
    return `lists:${Object.keys(record.lists as Record<string, unknown>).join(",")}`;
  }
  if (Array.isArray(record.results)) return `results:${record.results.length}`;
  if (Array.isArray(record.items)) return `items:${record.items.length}`;
  return `object:${Object.keys(record).slice(0, 6).join(",")}`;
}

function unwrapLibrarySearchResults(payload: unknown): unknown[] {
  if (typeof payload === "string") {
    return unwrapLibrarySearchResults(parseJsonPayloadString(payload));
  }
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.result)) {
    return record.result;
  }
  if (record.result && typeof record.result === "object") {
    const nestedResult = record.result as Record<string, unknown>;
    if (nestedResult.lists && typeof nestedResult.lists === "object") {
      return flattenLibrarySearchListGroups(nestedResult.lists);
    }
    if (Array.isArray(nestedResult.results)) {
      return nestedResult.results;
    }
    if (Array.isArray(nestedResult.items)) {
      return nestedResult.items;
    }
    const nestedItems = unwrapLibrarySearchResults(nestedResult);
    if (nestedItems.length > 0) return nestedItems;
  }
  if (record.data && typeof record.data === "object") {
    const dataItems = unwrapLibrarySearchResults(record.data);
    if (dataItems.length > 0) return dataItems;
  }
  if (record.lists && typeof record.lists === "object") {
    return flattenLibrarySearchListGroups(record.lists);
  }
  if (Array.isArray(record.results)) {
    return record.results;
  }
  if (Array.isArray(record.items)) {
    return record.items;
  }
  return [];
}

export function normalizeDevicePickerCandidates(payload: unknown): DevicePickerCandidate[] {
  return unwrapLibrarySearchResults(payload)
    .map((item) => {
      const parsedItem = typeof item === "string" ? parseJsonPayloadString(item) : item;
      const record = (typeof parsedItem === "object" && parsedItem !== null ? parsedItem : {}) as Record<string, unknown>;
      const owner =
        typeof record.owner === "object" && record.owner !== null
          ? (record.owner as Record<string, unknown>)
          : undefined;
      const creator =
        typeof record.creator === "object" && record.creator !== null
          ? (record.creator as Record<string, unknown>)
          : undefined;
      const modifier =
        typeof record.modifier === "object" && record.modifier !== null
          ? (record.modifier as Record<string, unknown>)
          : undefined;
      const symbolRecord =
        typeof record.symbol === "object" && record.symbol !== null
          ? (record.symbol as Record<string, unknown>)
          : undefined;
      const footprintRecord =
        typeof record.footprint === "object" && record.footprint !== null
          ? (record.footprint as Record<string, unknown>)
          : undefined;
      const attributes =
        typeof record.attributes === "object" && record.attributes !== null
          ? (record.attributes as Record<string, unknown>)
          : undefined;
      const uuid =
        readSearchString(record, ["uuid", "deviceUuid", "device_uuid", "id"]) ??
        readSearchString(owner ?? {}, ["uuid"]);
      if (!uuid) {
        return undefined;
      }
      return {
        uuid,
        name:
          readSearchString(record, ["name", "title", "symbol"]) ??
          readSearchString(owner ?? {}, ["nickname", "username"]) ??
          uuid,
        displayName: readSearchString(record, ["display_title", "title", "name"]),
        libraryUuid:
          readSearchString(record, ["libraryUuid", "library_uuid", "ownerUuid"]) ??
          readSearchString(owner ?? {}, ["uuid"]) ??
          readSearchString(creator ?? {}, ["uuid"]) ??
          readSearchString(modifier ?? {}, ["uuid"]) ??
          "",
        symbolUuid:
          readSearchString(record, ["symbolUuid"]) ??
          readSearchString(symbolRecord ?? {}, ["uuid"]) ??
          readSearchString(attributes ?? {}, ["Symbol"]),
        symbolName:
          readSearchString(record, ["symbolName"]) ??
          readSearchString(symbolRecord ?? {}, ["display_title", "title", "name"]),
        footprintUuid:
          readSearchString(record, ["footprintUuid"]) ??
          readSearchString(footprintRecord ?? {}, ["uuid"]) ??
          readSearchString(attributes ?? {}, ["Footprint"]),
        footprintName:
          readSearchString(record, ["footprintName", "packageName", "package", "packageNameCn"]) ??
          readSearchString(footprintRecord ?? {}, ["display_title", "title", "name"]) ??
          readSearchString(attributes ?? {}, ["Supplier Footprint"]),
        manufacturer:
          readSearchString(record, ["manufacturer", "brand"]) ??
          readSearchString(attributes ?? {}, ["Manufacturer", "Manufacturer Part"]),
        supplier:
          readSearchString(record, ["supplier", "ownerName"]) ??
          readSearchString(attributes ?? {}, ["Supplier"]),
        supplierId:
          readSearchString(record, ["supplierId", "lcscId", "lcsc_id", "lcsc", "product_code"]) ??
          readSearchString(attributes ?? {}, ["Supplier Part"]),
        description:
          readSearchString(record, ["description", "desc", "dataStr"]) ??
          readSearchString(attributes ?? {}, ["Description", "LCSC Part Name"]),
        resolvedFrom: "search",
      } as DevicePickerCandidate;
    })
    .filter((item): item is DevicePickerCandidate => Boolean(item));
}

export function inferDraftComponentRole(refOrName: string): string {
  const raw = String(refOrName || "").trim();
  const value = raw.toUpperCase();
  if (value.startsWith("BT") || value.startsWith("BAT")) return "battery_connector";
  if (value.startsWith("J")) return "power_connector";
  if (value.startsWith("R")) return "resistor";
  if (value.startsWith("LED") || value.startsWith("D")) return "led";
  if (value.startsWith("C")) return "input_capacitor";
  if (value.startsWith("U")) return "ldo_regulator";
  if (/LED|指示灯|充电指示灯|电源指示灯/i.test(raw)) return "led";
  return "generic";
}

function resolveDraftComponentRole(component: SchematicComponent): string {
  const explicitRole = String(component.properties?.role || "").trim();
  if (explicitRole) {
    return explicitRole;
  }
  const preferredQuery = String(component.properties?.preferred_search_query || "").trim();
  const haystack = [component.ref, component.name, component.value, preferredQuery].filter(Boolean).join(" ");
  if (/inmp441|mems|microphone|麦克风|mic/i.test(haystack)) return "microphone";
  if (/max98357|ns4168|amplifier|功放|audio/i.test(haystack)) return "audio_amplifier";
  if (/ip5306|charger|充电|powerbank|boost/i.test(haystack)) return "charger_powerbank";
  if (/esp32|mcu|主控/i.test(haystack)) return "mcu";
  return inferDraftComponentRole(component.ref ?? component.id);
}

export function resolveDraftDeviceSearchQuery(input: { defaultQuery?: string; manualQuery?: string }): string | null {
  const manualQuery = String(input.manualQuery ?? "").trim();
  if (manualQuery) {
    return manualQuery;
  }
  const defaultQuery = String(input.defaultQuery ?? "").trim();
  if (defaultQuery) {
    return defaultQuery;
  }
  return null;
}

function pushUniqueSearchQuery(queries: string[], query: string | undefined): void {
  const normalized = String(query ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return;
  }
  const key = normalized.toLowerCase();
  if (queries.some((item) => item.toLowerCase() === key)) {
    return;
  }
  queries.push(normalized);
}

export function buildDraftDeviceSearchQueries(input: {
  role?: string;
  defaultQuery?: string;
  manualQuery?: string;
  componentRef?: string;
  componentName?: string;
  componentValue?: string;
}): string[] {
  const queries: string[] = [];
  const role = String(input.role ?? "").trim();
  const defaultQuery = String(input.defaultQuery ?? "").trim();
  const manualQuery = String(input.manualQuery ?? "").trim();
  const haystack = [defaultQuery, input.componentName, input.componentValue].filter(Boolean).join(" ");

  pushUniqueSearchQuery(queries, manualQuery);
  pushUniqueSearchQuery(queries, defaultQuery);

  const modelMatches = haystack.match(/\b[A-Z]{1,6}\d{2,}[A-Z0-9-]*\b/gi) ?? [];
  for (const model of modelMatches.slice(0, 4)) {
    pushUniqueSearchQuery(queries, model);
  }

  if (role === "ldo_regulator" || /ldo|稳压|regulator/i.test(haystack)) {
    pushUniqueSearchQuery(queries, /500\s*m?a/i.test(haystack) ? "LDO regulator 500mA" : "LDO regulator");
    pushUniqueSearchQuery(queries, /3\.3|3v3/i.test(haystack) ? "3.3V LDO" : undefined);
    pushUniqueSearchQuery(queries, "ME6211");
    pushUniqueSearchQuery(queries, "XC6206");
    pushUniqueSearchQuery(queries, "AMS1117-3.3");
  }
  if (role === "microphone" || /microphone|mems|麦克风|mic/i.test(haystack)) {
    pushUniqueSearchQuery(queries, "INMP441");
    pushUniqueSearchQuery(queries, "I2S MEMS microphone");
    pushUniqueSearchQuery(queries, "MEMS microphone");
    pushUniqueSearchQuery(queries, "麦克风");
  }
  if (role === "audio_amplifier" || /amplifier|功放|audio/i.test(haystack)) {
    pushUniqueSearchQuery(queries, "MAX98357A");
    pushUniqueSearchQuery(queries, "NS4168");
    pushUniqueSearchQuery(queries, "I2S audio amplifier");
    pushUniqueSearchQuery(queries, "音频功放");
  }
  if (role === "charger_powerbank" || /ip5306|charger|充电|powerbank|boost/i.test(haystack)) {
    pushUniqueSearchQuery(queries, "IP5306");
    pushUniqueSearchQuery(queries, "power bank charge boost");
    pushUniqueSearchQuery(queries, "锂电池充电 升压");
  }
  if (role === "power_connector" || /type-?c|usb|connector|接口|座/i.test(haystack)) {
    pushUniqueSearchQuery(queries, "USB Type-C");
    pushUniqueSearchQuery(queries, "Type-C 16PIN");
    pushUniqueSearchQuery(queries, "JST battery connector");
  }

  return queries.slice(0, 8);
}

function extractLcscIdsFromText(value: string | undefined): string[] {
  const text = String(value ?? "");
  const matches = text.match(/\bC\d{4,}\b/gi) ?? [];
  const ids: string[] = [];
  for (const match of matches) {
    const normalized = match.toUpperCase();
    if (!ids.includes(normalized)) {
      ids.push(normalized);
    }
  }
  return ids;
}

function buildDraftDeviceLcscFallbackIds(input: {
  defaultQuery?: string;
  manualQuery?: string;
  componentName?: string;
  componentValue?: string;
}): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | undefined) => {
    for (const id of extractLcscIdsFromText(value)) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  };
  push(input.manualQuery);
  push(input.defaultQuery);
  push(input.componentName);
  push(input.componentValue);

  const haystack = [input.manualQuery, input.defaultQuery, input.componentName, input.componentValue]
    .filter(Boolean)
    .join(" ");
  const modelMatches = haystack.match(/\b[A-Z]{1,6}\d{2,}[A-Z0-9-]*\b/gi) ?? [];
  for (const model of modelMatches) {
    const fallbackIds = DEVICE_PICKER_MODEL_LCSC_FALLBACKS[model.toUpperCase()];
    if (!fallbackIds) continue;
    for (const id of fallbackIds) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids.slice(0, 6);
}

function normalizeDevicePickerCandidatesFromLcscDetails(details: LibraryDeviceDetail[] | null | undefined): DevicePickerCandidate[] {
  if (!Array.isArray(details)) {
    return [];
  }
  return details
    .map((detail) => {
      const uuid = String(detail.uuid || "").trim();
      if (!uuid) return undefined;
      return {
        uuid,
        name: String(detail.name || uuid).trim(),
        displayName: String(detail.name || uuid).trim(),
        libraryUuid: String(detail.libraryUuid || detail.symbol?.libraryUuid || detail.footprint?.libraryUuid || "").trim(),
        symbolUuid: String(detail.symbol?.uuid || "").trim() || undefined,
        symbolName: String(detail.symbol?.name || "").trim() || undefined,
        footprintUuid: String(detail.footprint?.uuid || "").trim() || undefined,
        footprintName: String(detail.footprint?.name || "").trim() || undefined,
        manufacturer: String(detail.manufacturer || "").trim() || undefined,
        supplier: String(detail.supplier || "").trim() || undefined,
        supplierId: String(detail.supplierId || detail.lcscId || "").trim() || undefined,
        description: String(detail.description || "").trim() || undefined,
        resolvedFrom: "lcsc_detail",
      } as DevicePickerCandidate;
    })
    .filter((item): item is DevicePickerCandidate => Boolean(item));
}

function mergeDevicePickerCandidateDetail(
  candidate: DevicePickerCandidate,
  detail: LibraryDeviceDetail | null | undefined
): DevicePickerCandidate {
  if (!detail) {
    return candidate;
  }
  const detailLibraryUuid =
    String(detail.libraryUuid || detail.symbol?.libraryUuid || detail.footprint?.libraryUuid || "").trim() || undefined;
  return {
    ...candidate,
    name: String(detail.name || "").trim() || candidate.name,
    displayName: String(detail.name || "").trim() || candidate.displayName || candidate.name,
    libraryUuid: detailLibraryUuid || candidate.libraryUuid,
    symbolUuid: String(detail.symbol?.uuid || "").trim() || candidate.symbolUuid,
    symbolName: String(detail.symbol?.name || "").trim() || candidate.symbolName,
    footprintUuid: String(detail.footprint?.uuid || "").trim() || candidate.footprintUuid,
    footprintName: String(detail.footprint?.name || "").trim() || candidate.footprintName,
    manufacturer: String(detail.manufacturer || "").trim() || candidate.manufacturer,
    supplier: String(detail.supplier || "").trim() || candidate.supplier,
    supplierId: String(detail.supplierId || detail.lcscId || "").trim() || candidate.supplierId,
    description: String(detail.description || "").trim() || candidate.description,
    resolvedFrom: "device_detail",
  };
}

function buildDevicePickerCandidateKey(candidate: DevicePickerCandidate): string {
  const uuid = String(candidate.uuid || "").trim();
  if (uuid) return `uuid:${uuid}`;
  const supplierId = String(candidate.supplierId || "").trim().toUpperCase();
  if (supplierId) return `lcsc:${supplierId}`;
  return [
    "shape",
    String(candidate.name || "").trim().toLowerCase(),
    String(candidate.footprintName || "").trim().toLowerCase(),
  ].join(":");
}

function mergeDevicePickerCandidates(
  existing: DevicePickerCandidate[],
  incoming: DevicePickerCandidate[]
): DevicePickerCandidate[] {
  const byKey = new Map<string, DevicePickerCandidate>();
  for (const candidate of [...existing, ...incoming]) {
    const key = buildDevicePickerCandidateKey(candidate);
    const previous = byKey.get(key);
    byKey.set(key, previous ? mergeDevicePickerCandidateRecords(previous, candidate) : candidate);
  }
  return Array.from(byKey.values());
}

function mergeDevicePickerCandidateRecords(
  previous: DevicePickerCandidate,
  next: DevicePickerCandidate
): DevicePickerCandidate {
  return {
    ...previous,
    ...next,
    displayName: next.displayName || previous.displayName,
    libraryUuid: next.libraryUuid || previous.libraryUuid,
    symbolUuid: next.symbolUuid || previous.symbolUuid,
    symbolName: next.symbolName || previous.symbolName,
    footprintUuid: next.footprintUuid || previous.footprintUuid,
    footprintName: next.footprintName || previous.footprintName,
    manufacturer: next.manufacturer || previous.manufacturer,
    supplier: next.supplier || previous.supplier,
    supplierId: next.supplierId || previous.supplierId,
    description: next.description || previous.description,
    resolvedFrom: previous.resolvedFrom === "lcsc_detail" ? previous.resolvedFrom : next.resolvedFrom || previous.resolvedFrom,
  };
}

async function withDevicePickerTimeout<T>(
  task: Promise<T>,
  label: string,
  timeoutMs = 5000
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function enrichDevicePickerCandidatesWithDetails(
  candidates: DevicePickerCandidate[],
  getLibraryDevice: HostEditorBridge["getLibraryDevice"] | undefined
): Promise<{ candidates: DevicePickerCandidate[]; detailHits: number }> {
  if (!getLibraryDevice || candidates.length === 0) {
    return { candidates, detailHits: 0 };
  }
  let detailHits = 0;
  const enriched = await Promise.all(
    candidates.map(async (candidate) => {
      const needsDetail = !candidate.libraryUuid || !candidate.footprintName || !candidate.description;
      if (!needsDetail) {
        return candidate;
      }
      try {
        const detail = await withDevicePickerTimeout(
          getLibraryDevice({
            deviceUuid: candidate.uuid,
            libraryUuid: candidate.libraryUuid || undefined,
            scope: "system",
          }),
          "device_detail_lookup",
          3500
        );
        if (detail) {
          detailHits += 1;
        }
        return mergeDevicePickerCandidateDetail(candidate, detail);
      } catch {
        return candidate;
      }
    })
  );
  return { candidates: enriched, detailHits };
}

export function updateDevicePickerManualQueryState(
  picker: MainPanelState["devicePicker"] | undefined,
  input: { componentId: string; manualQueryExpanded?: boolean; manualQueryDraft?: string }
): MainPanelState["devicePicker"] | undefined {
  if (!picker) {
    return picker;
  }
  let changed = false;
  const nextItems = picker.items.map((item) => {
    if (item.componentId !== input.componentId) {
      return item;
    }
    const nextItem = { ...item };
    if ("manualQueryExpanded" in input) {
      nextItem.manualQueryExpanded = input.manualQueryExpanded;
    }
    if ("manualQueryDraft" in input) {
      nextItem.manualQueryDraft = input.manualQueryDraft;
    }
    changed = true;
    return nextItem;
  });
  if (!changed) {
    return picker;
  }
  return {
    ...picker,
    items: nextItems,
  };
}

type DevicePickerItem = NonNullable<MainPanelState["devicePicker"]>["items"][number];

export function resolveDevicePickerManualQueryStateForSearch(input: {
  item: DevicePickerItem;
  previousItem?: DevicePickerItem;
  manualQuery?: string;
}): Pick<DevicePickerItem, "manualQueryExpanded" | "manualQueryDraft"> {
  if (typeof input.manualQuery === "string") {
    return {
      manualQueryExpanded: true,
      manualQueryDraft: input.manualQuery,
    };
  }
  return {
    manualQueryExpanded: input.previousItem?.manualQueryExpanded ?? input.item.manualQueryExpanded,
    manualQueryDraft: input.previousItem?.manualQueryDraft ?? input.item.manualQueryDraft,
  };
}

function buildDevicePickerState(
  plan?: DraftPlan,
  previousPicker?: MainPanelState["devicePicker"]
): MainPanelState["devicePicker"] | undefined {
  if (!plan) {
    return undefined;
  }
  const previousByComponentId = new Map((previousPicker?.items ?? []).map((item) => [item.componentId, item]));
  const selectedByComponentId = new Map(
    (plan.selectedDevices ?? [])
      .filter((item) => item.componentId)
      .map((item) => [item.componentId as string, item])
  );
  const items = plan.components.map((component) => {
    const ref = component.ref ?? component.id;
    const role = resolveDraftComponentRole(component);
    const selected = selectedByComponentId.get(component.id);
    const previousItem = previousByComponentId.get(component.id);
    const status: "unresolved" | "resolved" =
      component.properties?.device_resolution_status === "unresolved" ? "unresolved" : "resolved";
    return {
      componentId: component.id,
      componentRef: ref,
      role,
      roleLabel: buildDevicePickerRoleLabel(role),
      query: component.properties?.preferred_search_query,
      status,
      reason: component.properties?.device_resolution_reason,
      reasonLabel: buildDevicePickerReasonLabel({
        reason: component.properties?.device_resolution_reason,
        role,
        query: component.properties?.preferred_search_query,
      }),
      usageHint:
        role === "power_connector"
          ? "这里需要的是外部供电接口，优先看它是不是适合作为电源输入口。"
          : undefined,
      selectedDeviceLabel: selected
        ? `${selected.name}${selected.footprintName ? ` [${selected.footprintName}]` : ""}`
        : undefined,
      manualQueryExpanded: previousItem?.manualQueryExpanded,
      manualQueryDraft: previousItem?.manualQueryDraft,
      suggestedQueries: buildDraftDeviceSearchQueries({
        role,
        defaultQuery: component.properties?.preferred_search_query,
        componentRef: ref,
        componentName: component.name,
        componentValue: component.value,
      }),
      attemptedQueries: previousItem?.attemptedQueries,
      searchDiagnostics: previousItem?.searchDiagnostics,
      candidates: previousItem?.candidates,
    };
  });
  return {
    open: previousPicker?.open ?? false,
    items,
  };
}

function syncDraftPreviewState(state: MainPanelState, plan: DraftPlan | undefined): void {
  state.draftPlan = plan;
  if (!plan) {
    state.draftPreview = undefined;
    state.devicePicker = undefined;
    return;
  }
  const preview = previewDraftPlan(plan);
  state.draftPreview = {
    title: preview.title,
    rationale: preview.rationale,
    componentRefs: preview.componentRefs,
    netNames: preview.netNames,
    componentCount: preview.componentCount,
    netCount: preview.netCount,
    selectedDeviceDetails: preview.selectedDeviceDetails,
    unresolvedDeviceDetails: preview.unresolvedDeviceDetails,
    guidanceSummary: preview.guidanceSummary,
  };
  state.devicePicker = buildDevicePickerState(plan, state.devicePicker);
}

function createSessionId(): string {
  return `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function deriveSessionTitleFromState(state?: MainPanelState): string {
  const explicit = String(state?.sessionTitle || "").trim();
  if (explicit) {
    return explicit;
  }
  const firstUserMessage = (state?.chatMessages ?? []).find((message) => message.role === "user" && String(message.content || "").trim());
  const inferred = distillSessionTitle(String(firstUserMessage?.content || "").trim());
  return inferred || "未命名会话";
}

function normalizeSessionHistoryEntry(entry: unknown): SessionHistoryEntry | undefined {
  if (!entry || typeof entry !== "object") {
    return undefined;
  }
  const record = entry as Record<string, unknown>;
  const sessionId = String(record.sessionId || "").trim();
  if (!sessionId) {
    return undefined;
  }
  const createdAt = String(record.createdAt || record.updatedAt || new Date().toISOString());
  const updatedAt = String(record.updatedAt || createdAt);
  return {
    sessionId,
    sessionTitle: String(record.sessionTitle || "未命名会话").trim() || "未命名会话",
    createdAt,
    updatedAt,
  };
}

export function deriveSessionHistoryEntries(
  rawIndex: string | undefined,
  lastState?: MainPanelState
): SessionHistoryEntry[] {
  const parsedEntries = (() => {
    if (!rawIndex) return [];
    try {
      const parsed = JSON.parse(rawIndex) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeSessionHistoryEntry).filter((item): item is SessionHistoryEntry => Boolean(item));
    } catch {
      return [];
    }
  })();
  if (parsedEntries.length > 0) {
    return parsedEntries
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, MAX_SESSION_HISTORY);
  }
  if (!lastState) {
    return [];
  }
  const fallbackNow = new Date().toISOString();
  return [
    {
      sessionId: String((lastState as MainPanelState & { sessionId?: string }).sessionId || "").trim() || createSessionId(),
      sessionTitle: deriveSessionTitleFromState(lastState),
      createdAt: String((lastState as MainPanelState & { createdAt?: string }).createdAt || fallbackNow),
      updatedAt: String((lastState as MainPanelState & { updatedAt?: string }).updatedAt || fallbackNow),
    },
  ];
}

function buildSessionStateStorageKey(sessionId: string): string {
  return `${PANEL_SESSION_STATE_PREFIX}${sessionId}`;
}

type MessageReactEvent = NonNullable<MainPanelState["chatMessages"]>[number]["reactEvents"] extends Array<infer T>
  ? T
  : never;
type MessageStepItem = NonNullable<MainPanelState["chatMessages"]>[number]["stepItems"] extends Array<infer T> ? T : never;
type MessageIterationStep = NonNullable<MainPanelState["chatMessages"]>[number]["iterationSteps"] extends Array<infer T>
  ? T
  : never;

function formatReactEventLine(event: MessageReactEvent): string {
  if (!event || !event.kind) return "";
  if (event.kind === "task") return `任务: ${event.text || event.label || ""}`;
  if (event.kind === "thought") return `思考: ${event.text || event.label || ""}`;
  if (event.kind === "tool_call") return `Tool: ${(event.label || event.toolName || "tool")}${event.inputSummary ? ` ${event.inputSummary}` : ""}`;
  if (event.kind === "observation") return `观察: ${event.outputSummary || event.text || ""}`;
  if (event.kind === "final") return `完成: ${event.text || event.label || ""}`;
  return `${event.kind}: ${event.text || event.label || ""}`;
}

function buildStepTranscriptFromReactEvents(
  reactEvents?: NonNullable<MainPanelState["chatMessages"]>[number]["reactEvents"]
): string[] | undefined {
  if (!Array.isArray(reactEvents) || reactEvents.length === 0) {
    return undefined;
  }
  const lines = reactEvents.map(formatReactEventLine).filter(Boolean);
  return lines.length > 0 ? lines : undefined;
}

function formatStepItemLine(stepItem: MessageStepItem): string {
  if (!stepItem || !stepItem.type) return "";
  if (stepItem.type === "task") return `任务: ${stepItem.text || stepItem.title || ""}`;
  if (stepItem.type === "thought") return `思考: ${stepItem.text || stepItem.title || ""}`;
  if (stepItem.type === "tool_call")
    return `Tool: ${(stepItem.title || stepItem.toolName || "tool")}${stepItem.inputSummary ? ` ${stepItem.inputSummary}` : ""}`;
  if (stepItem.type === "observation") return `观察: ${stepItem.outputSummary || stepItem.text || ""}`;
  if (stepItem.type === "status") return `状态: ${stepItem.text || stepItem.title || ""}`;
  return `${stepItem.type}: ${stepItem.text || stepItem.title || ""}`;
}

function buildStepTranscriptFromStepItems(
  stepItems?: NonNullable<MainPanelState["chatMessages"]>[number]["stepItems"]
): string[] | undefined {
  if (!Array.isArray(stepItems) || stepItems.length === 0) {
    return undefined;
  }
  const lines = stepItems.map(formatStepItemLine).filter(Boolean);
  return lines.length > 0 ? lines : undefined;
}

// Intentionally do not inject host-side "LLM progress" into reactEvents.
// Reasoner-style thinking should come from `reasoning_delta`, and steps should reflect
// real tool calls/observations rather than synthetic counters.

function upsertLlmReasoningEvent(
  message: NonNullable<MainPanelState["chatMessages"]>[number],
  reasoningDelta: string | undefined
): void {
  if (!reasoningDelta) return;
  const msgAny = message as unknown as { __llmReasoningText?: string };
  msgAny.__llmReasoningText = `${msgAny.__llmReasoningText || ""}${reasoningDelta}`;
}

export function upsertLlmReasoningStepItem(
  message: NonNullable<MainPanelState["chatMessages"]>[number]
): void {
  const msgAny = message as unknown as { __llmReasoningText?: string };
  const text = String(msgAny.__llmReasoningText || "").trim();
  if (!text) return;
  const stepItems = (message.stepItems ??= []);
  const existing = [...stepItems]
    .reverse()
    .find(
      (item) =>
        item &&
        item.type === "thought" &&
        item.phase === "llm" &&
        (item.status === "running" || item.streaming || !String(item.text || "").trim())
    );
  if (existing) {
    existing.text = text;
    existing.streaming = true;
    if (existing.status !== "done") {
      existing.status = "running";
    }
    return;
  }
  stepItems.push({
    id: "runtime-llm-thought",
    phase: "llm",
    type: "thought",
    status: "running",
    title: "Reasoning",
    text,
    streaming: true,
  });
}

export function clampStreamingAssistantContent(previous: string, deltaOrNext: string): string {
  return stripFinalControlLikeText(`${String(previous || "")}${String(deltaOrNext || "")}`);
}

export function applyStreamingAssistantContentDelta(
  message: NonNullable<MainPanelState["chatMessages"]>[number],
  deltaOrNext: string,
  mode: "append" | "replace" = "append"
): string {
  const holder = message as NonNullable<MainPanelState["chatMessages"]>[number] & {
    __rawStreamingContent?: string;
  };
  const previousRaw =
    mode === "replace"
      ? ""
      : String(holder.__rawStreamingContent ?? message.content ?? "");
  const nextRaw = `${previousRaw}${String(deltaOrNext || "")}`;
  holder.__rawStreamingContent = nextRaw;
  message.content = stripFinalControlLikeText(nextRaw);
  return message.content;
}

export function shouldMirrorStreamingTextToAssistantBody(input: {
  route: "chat" | "analysis" | "draft" | "modify";
  hasStepItems?: boolean;
  hasIterationSteps?: boolean;
  hasReactEvents?: boolean;
  hasReasoningDelta?: boolean;
}): boolean {
  if (input.hasStepItems || input.hasIterationSteps || input.hasReactEvents || input.hasReasoningDelta) {
    return false;
  }
  if (input.route === "chat") {
    return true;
  }
  return false;
}

export function shouldSanitizeFullStreamingText(input: {
  route: "chat" | "analysis" | "draft" | "modify";
  mirrorTextToBody?: boolean;
}): boolean {
  return input.route === "chat" && Boolean(input.mirrorTextToBody);
}

export function shouldApplyStreamingReactEvents(input: {
  reactEvents?: NonNullable<MainPanelState["chatMessages"]>[number]["reactEvents"];
  stepItems?: NonNullable<MainPanelState["chatMessages"]>[number]["stepItems"];
  iterationSteps?: NonNullable<MainPanelState["chatMessages"]>[number]["iterationSteps"];
}): boolean {
  if (!Array.isArray(input.reactEvents) || input.reactEvents.length === 0) {
    return false;
  }
  if (Array.isArray(input.stepItems) && input.stepItems.length > 0) {
    return false;
  }
  if (Array.isArray(input.iterationSteps) && input.iterationSteps.length > 0) {
    return false;
  }
  return true;
}

export function buildStreamingProcessSignature(input: {
  stepItems?: NonNullable<MainPanelState["chatMessages"]>[number]["stepItems"];
  iterationSteps?: NonNullable<MainPanelState["chatMessages"]>[number]["iterationSteps"];
  reactEvents?: NonNullable<MainPanelState["chatMessages"]>[number]["reactEvents"];
  stepStates?: NonNullable<MainPanelState["chatMessages"]>[number]["stepStates"];
  workingMemory?: NonNullable<MainPanelState["chatMessages"]>[number]["workingMemory"];
}): string {
  const lastStepItem =
    Array.isArray(input.stepItems) && input.stepItems.length > 0
      ? input.stepItems[input.stepItems.length - 1]
      : undefined;
  const lastIteration =
    Array.isArray(input.iterationSteps) && input.iterationSteps.length > 0
      ? input.iterationSteps[input.iterationSteps.length - 1]
      : undefined;
  const lastReactEvent =
    Array.isArray(input.reactEvents) && input.reactEvents.length > 0
      ? input.reactEvents[input.reactEvents.length - 1]
      : undefined;
  const lastStepState =
    Array.isArray(input.stepStates) && input.stepStates.length > 0
      ? input.stepStates[input.stepStates.length - 1]
      : undefined;

  // `workingMemory` can change frequently (timestamps/counters/ordering) and is typically not a user-visible
  // part of the streaming UI. Including it in the signature causes excessive re-renders and can freeze UI.
  // Keep it out of the "has visible activity" signature.
  return [
    Array.isArray(input.stepItems) ? input.stepItems.length : 0,
    lastStepItem?.id || "",
    lastStepItem?.status || "",
    String(lastStepItem?.text || "").length,
    Array.isArray(input.iterationSteps) ? input.iterationSteps.length : 0,
    lastIteration?.id || "",
    lastIteration?.status || "",
    String(lastIteration?.thoughtText || "").length,
    Array.isArray(lastIteration?.toolEvents) ? lastIteration.toolEvents.length : 0,
    Array.isArray(lastIteration?.observationTexts) ? lastIteration.observationTexts.length : 0,
    Array.isArray(input.reactEvents) ? input.reactEvents.length : 0,
    lastReactEvent?.kind || "",
    lastReactEvent?.status || "",
    String(lastReactEvent?.text || "").length,
    Array.isArray(input.stepStates) ? input.stepStates.length : 0,
    lastStepState?.kind || "",
    lastStepState?.status || "",
  ].join("|");
}

export function shouldCountStreamEventAsTurnActivity(input: {
  contentChanged?: boolean;
  processChanged?: boolean;
  detailChanged?: boolean;
}): boolean {
  return Boolean(input.contentChanged || input.processChanged || input.detailChanged);
}

function trimTail<T>(items: T[] | undefined, maxItems: number): T[] | undefined {
  if (!Array.isArray(items)) return items;
  return items.length > maxItems ? items.slice(-maxItems) : items;
}

function cloneForStream<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function limitStreamProcessItems(input: {
  stepItems?: NonNullable<MainPanelState["chatMessages"]>[number]["stepItems"];
  iterationSteps?: NonNullable<MainPanelState["chatMessages"]>[number]["iterationSteps"];
  reactEvents?: NonNullable<MainPanelState["chatMessages"]>[number]["reactEvents"];
}): {
  stepItems?: NonNullable<MainPanelState["chatMessages"]>[number]["stepItems"];
  iterationSteps?: NonNullable<MainPanelState["chatMessages"]>[number]["iterationSteps"];
  reactEvents?: NonNullable<MainPanelState["chatMessages"]>[number]["reactEvents"];
} {
  return {
    stepItems: trimTail(input.stepItems, MAX_STREAM_STEP_ITEMS),
    iterationSteps: trimTail(input.iterationSteps, MAX_STREAM_ITERATION_STEPS),
    reactEvents: trimTail(input.reactEvents, MAX_STREAM_REACT_EVENTS),
  };
}

function getIterationStepMergeKey(step: MessageIterationStep | undefined): string | undefined {
  if (!step) return undefined;
  const id = String(step.id || "").trim();
  if (id) return `id:${id}`;
  return Number.isFinite(step.iteration) ? `iteration:${step.iteration}` : undefined;
}

function sortIterationStepsByIteration<T extends MessageIterationStep>(steps: T[]): T[] {
  if (!steps.every((step) => Number.isFinite(step.iteration))) {
    return steps;
  }
  return steps.slice().sort((left, right) => left.iteration - right.iteration);
}

function mergeIterationStepsForStream(
  previous: NonNullable<MainPanelState["chatMessages"]>[number]["iterationSteps"],
  incoming: NonNullable<MainPanelState["chatMessages"]>[number]["iterationSteps"]
): NonNullable<MainPanelState["chatMessages"]>[number]["iterationSteps"] {
  if (!Array.isArray(incoming)) return previous;
  if (incoming.length === 0) return incoming;
  if (!Array.isArray(previous) || previous.length === 0) {
    return sortIterationStepsByIteration(incoming);
  }
  if (incoming.length >= previous.length) {
    return sortIterationStepsByIteration(incoming);
  }

  const merged = previous.slice();
  for (const nextStep of incoming) {
    const nextKey = getIterationStepMergeKey(nextStep);
    const existingIndex =
      nextKey === undefined
        ? -1
        : merged.findIndex((currentStep) => getIterationStepMergeKey(currentStep) === nextKey);
    if (existingIndex >= 0) {
      merged[existingIndex] = nextStep;
    } else {
      merged.push(nextStep);
    }
  }
  return sortIterationStepsByIteration(merged);
}

export interface AssistantRuntime {
  openPanel(): Promise<MainPanelState>;
  rerunAnalysis(): Promise<MainPanelState>;
  locateIssue(index: number): Promise<MainPanelState>;
  startLogin(): Promise<MainPanelState>;
  sendChat(input: string): Promise<MainPanelState>;
  stopCurrentTurn(): Promise<MainPanelState>;
  resetSession(): Promise<MainPanelState>;
  generateDraft(prompt: string): Promise<MainPanelState>;
  applyDraftPlan(): Promise<MainPanelState>;
  applyPatchDraftPlan(): Promise<MainPanelState>;
  openDevicePicker(): Promise<MainPanelState>;
  closeDevicePicker(): Promise<MainPanelState>;
  setDraftDeviceManualQueryExpanded(input: { componentId: string; expanded: boolean }): Promise<MainPanelState>;
  setDraftDeviceManualQueryDraft(input: { componentId: string; draft: string }): Promise<MainPanelState>;
  searchDraftDeviceCandidates(componentId: string, manualQuery?: string): Promise<MainPanelState>;
  searchAllUnresolvedDraftDeviceCandidates(): Promise<MainPanelState>;
  chooseDraftDeviceCandidate(input: { componentId: string; candidateIndex: number }): Promise<MainPanelState>;
  chooseBestDraftDeviceCandidates(): Promise<MainPanelState>;
  rollbackLastApply(): Promise<MainPanelState>;
  saveCustomLlmConfig(input: {
    provider: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    preferredOutputLanguage?: string;
  }): Promise<MainPanelState>;
  setLlmMode(input: { mode: LlmMode }): Promise<MainPanelState>;
  listSessionHistory(): Promise<SessionHistoryEntry[]>;
  restoreSession(sessionId: string): Promise<MainPanelState>;
  syncState(): Promise<MainPanelState>;
  getLastState(): MainPanelState | null;
}

interface RuntimeInternals {
  currentState: MainPanelState | null;
  stateVersion: number;
  issueItems: Array<{ objectId?: string; objectType?: IssueObjectType }>;
  draftPlan?: DraftPlan;
  draftPatchPreviewFingerprint?: string;
  draftBlocked?: boolean;
  lastApplyTransactionId?: string;
  devicePickerCloseVersion?: number;
  pendingChatInput?: string;
  activeTurnId?: number;
  activeTurnAbortController?: AbortController;
  sessionId?: string;
  activeLoginSession?: {
    loginSessionId: string;
    pollToken: string;
    stopped: boolean;
  };
}

export function getAssistantRuntime(): AssistantRuntime {
  const runtime = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: AssistantRuntime;
  };
  if (!runtime[GLOBAL_KEY]) {
    runtime[GLOBAL_KEY] = createAssistantRuntime();
  }
  return runtime[GLOBAL_KEY]!;
}

function createAssistantRuntime(): AssistantRuntime {
  const internals: RuntimeInternals = {
    currentState: null,
    stateVersion: 0,
    issueItems: [],
  };
  let toastId = 0;
  let turnIdCounter = 0;

  const storage = new LocalStorageKeyValueStore();
  const sessionStore = new PersistentSessionStore(storage);
  const customLlmConfigStore = new CustomLlmConfigStore(storage);
  const llmModeStore = new LlmModeStore(storage);
  const config = getConfig();
  let refreshInFlight: Promise<boolean> | null = null;
  const authHttpClient = new FetchHttpClient(config.serverBaseUrl);
  const httpClient = new FetchHttpClient(config.serverBaseUrl, {
    onUnauthorized: async (error) => {
      await handleUnauthorizedSession(error);
    },
  });
  const authClient = new AuthClient(authHttpClient);
  const creditsClient = new CreditsClient(httpClient);
  const llmClient = new LlmProxyClient(httpClient);
  const ragClient = new RagClient(httpClient);
  const mcpClient = new MCPClient();
  const unifiedLlmClient = new UnifiedLlmClient(
    llmClient,
    sessionStore,
    customLlmConfigStore,
    llmModeStore
  );
  const pluginAgent = createPluginAgent({
    llmClient,
    ragClient,
    sessionStore,
    customLlmConfigStore,
    llmModeStore,
    onLlmRoute: (info) => {
      const state = internals.currentState;
      if (!state) return;
      state.llmLastRoute = info.route;
      state.llmLastModel = info.model || state.llmLastModel;
      state.llmLastAt = new Date().toISOString();
    },
    hostBridge: resolveHostEditorBridge(),
    mcpClient,
  });

  // 启动主动刷新定时器
  startTokenRefreshTimer(sessionStore, authClient, internals, creditsClient, customLlmConfigStore, llmModeStore, storage);

  async function buildBaseState(): Promise<MainPanelState> {
    const channel = resolveRuntimeChannel();
    const adapter = createEditorAdapter(channel);
    const capabilityReport = await adapter.getCapabilityReport();
    const state: MainPanelState = {
      loggedIn: false,
      capabilityReport: capabilityReport ?? undefined,
    };

    const existingSession = await sessionStore.get();
    if (existingSession && !hasUsableSession(existingSession) && existingSession.refreshToken) {
      await refreshSessionIfNeeded("startup_restore");
    }
    await fillSettingsState(state, sessionStore, authClient, creditsClient, customLlmConfigStore, llmModeStore);
    return state;
  }

  async function openIdlePanelState(): Promise<MainPanelState> {
    const restored = await restorePanelState(storage);
    if (restored) {
      internals.sessionId = String((restored as MainPanelState & { sessionId?: string }).sessionId || "").trim() || undefined;
      internals.draftPlan = restored.draftPlan;
      internals.lastApplyTransactionId = restored.appliedDraftSnapshot?.applyTransactionId;
      internals.issueItems = (restored.issueItems ?? []).map((item) => ({
        objectId: item.objectId,
        objectType: item.objectType as IssueObjectType | undefined,
      }));
      await fillSettingsState(restored, sessionStore, authClient, creditsClient, customLlmConfigStore, llmModeStore);
      if (
        restored.agentRunState === "planning" ||
        restored.agentRunState === "running_tools" ||
        restored.agentRunState === "waiting_llm"
      ) {
        restored.agentRunState = "idle";
        restored.agentRunDetail = "已恢复上次会话";
        restored.summary = restored.summary || "已恢复上次会话。";
      }
      restored.nextActions = buildNextActions(restored);
      return commitState(internals, restored, storage);
    }
    const state = await buildBaseState();
    (state as MainPanelState & { sessionId?: string; createdAt?: string; updatedAt?: string }).sessionId = createSessionId();
    (state as MainPanelState & { sessionId?: string; createdAt?: string; updatedAt?: string }).createdAt = new Date().toISOString();
    (state as MainPanelState & { sessionId?: string; createdAt?: string; updatedAt?: string }).updatedAt = (state as MainPanelState & { updatedAt?: string }).createdAt;
    internals.sessionId = (state as MainPanelState & { sessionId?: string }).sessionId;
    state.sessionTitle = "New Session";
    state.agentRunState = "idle";
    state.agentRunDetail = "等待用户输入";
    state.summary = "助手已就绪。可以先自然聊天，也可以让我检查当前原理图或生成草案。";
    state.chatMessages = [];
    state.nextActions = buildNextActions(state);
    return commitState(internals, state, storage);
  }

  async function refreshSessionIfNeeded(reason: string): Promise<boolean> {
    if (refreshInFlight) {
      return refreshInFlight;
    }
    refreshInFlight = (async () => {
      const session = await sessionStore.get();
      if (!session?.refreshToken) {
        if (typeof console !== "undefined") {
          console.warn(`${LOG_PREFIX} session.refresh.skipped`, { reason, hasSession: Boolean(session) });
        }
        return false;
      }
      try {
        if (typeof console !== "undefined") {
          console.log(`${LOG_PREFIX} session.refresh.start`, { reason, ...summarizeSessionForLog(session) });
        }
        const tokenData = await authClient.refreshToken(session.refreshToken);
        const nextSession = toSession(tokenData);
        await sessionStore.set(nextSession);
        if (typeof console !== "undefined") {
          console.log(`${LOG_PREFIX} session.refresh.success`, summarizeSessionForLog(nextSession));
        }
        return true;
      } catch (error) {
        if (typeof console !== "undefined") {
          console.warn(`${LOG_PREFIX} session.refresh.failed`, {
            reason,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        try {
          await sessionStore.clear();
        } catch {
          // Ignore storage cleanup failures during refresh failure handling.
        }
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  }

  async function computeAnalysisState(): Promise<MainPanelState> {
    const channel = resolveRuntimeChannel();
    const adapter = createEditorAdapter(channel);
    const state = await buildBaseState();

    state.agentRunState = "running_tools";
    state.agentRunRoute = "analysis";
    state.agentRunDetail = "正在读取原理图并执行分析";
    state.summary = "正在分析当前原理图...";
    state.chatMessages = [createPendingAssistantMessage("analysis")];
    commitState(internals, state, storage);

    let streamCommitTimer: ReturnType<typeof setTimeout> | null = null;
    let lastStreamCommitAt = 0;
    const scheduleStreamCommit = (force: boolean) => {
      if (force) {
        if (streamCommitTimer) {
          clearTimeout(streamCommitTimer);
          streamCommitTimer = null;
        }
        lastStreamCommitAt = Date.now();
        commitState(internals, state, storage);
        return;
      }
      const now = Date.now();
      const elapsed = now - lastStreamCommitAt;
      if (elapsed >= STREAM_COMMIT_MIN_INTERVAL_MS && !streamCommitTimer) {
        lastStreamCommitAt = now;
        commitState(internals, state, storage);
        return;
      }
      if (streamCommitTimer) return;
      streamCommitTimer = setTimeout(() => {
        streamCommitTimer = null;
        lastStreamCommitAt = Date.now();
        commitState(internals, state, storage);
      }, Math.max(0, STREAM_COMMIT_MIN_INTERVAL_MS - elapsed));
    };

    try {
      const context = await buildSchematicContext(adapter);
      const result = await pluginAgent.run({
        type: "schematic_analysis",
        userQuery: "collect current schematic context",
        context,
        adapter,
        onStreamEvent: (event) => {
          if (event.route !== "analysis") {
            return;
          }
          const messages = state.chatMessages ?? [];
          const lastMessage = messages[messages.length - 1];
          if (!lastMessage || lastMessage.role !== "assistant") {
            return;
          }
          state.agentRunState = event.stage === "llm" ? "waiting_llm" : "running_tools";
          if (event.detail) {
            state.agentRunDetail = event.detail;
          }
          lastMessage.streaming = true;
          lastMessage.title = "分析中";
          if (event.stage === "llm") {
            if (event.textDelta) {
              applyStreamingAssistantContentDelta(lastMessage, event.textDelta, "append");
            } else if (event.text !== undefined) {
              applyStreamingAssistantContentDelta(lastMessage, event.text || lastMessage.content || "", "replace");
            }
          } else {
            // progress 阶段只更新步骤，不写入 content；content 留给最终流式报告。
            if (
              event.stepItems !== undefined ||
              event.iterationSteps !== undefined ||
              event.reactEvents !== undefined
            ) {
              const normalizedProcess = normalizeProcessFields({
                ...lastMessage,
                stepItems: event.stepItems ?? lastMessage.stepItems,
                iterationSteps: event.iterationSteps ?? lastMessage.iterationSteps,
                reactEvents: event.reactEvents ?? lastMessage.reactEvents,
              });
              lastMessage.stepItems = normalizedProcess.stepItems;
              lastMessage.iterationSteps = normalizedProcess.iterationSteps;
              lastMessage.reactEvents = normalizedProcess.reactEvents;
              lastMessage.stepTranscript = normalizedProcess.stepTranscript;
            }
            if (event.stepStates) {
              lastMessage.stepStates = event.stepStates;
            }
            if (event.workingMemory) {
              lastMessage.workingMemory = event.workingMemory;
            }
          }
          scheduleStreamCommit(false);
        },
      });
      if (typeof console !== "undefined") {
        console.log(`${LOG_PREFIX} analysis.react.trace`, result.executionTraces ?? []);
      }

      state.agentRunState = "completed";
      state.agentRunRoute = "analysis";
      state.agentRunDetail = result.summary;
      state.channel = result.contextDigest?.channel;
      state.componentCount = result.contextDigest?.componentCount;
      state.netCount = result.contextDigest?.netCount;
      state.selectionCount = result.contextDigest?.selectionCount;
      state.issueCount = result.checkResult?.issues.length;
      state.topIssueTitle = result.checkResult?.issues[0]?.title;
      state.locateStatus = result.locateResult?.located
        ? `${result.locateResult.objectType}:${result.locateResult.objectId}`
        : "none";
      state.issueItems =
        result.checkResult?.issues.slice(0, 6).map((issue) => ({
          title: issue.title,
          severity: issue.severity,
          objectId: issue.objectId,
          objectType: normalizeIssueObjectType(issue.objectType),
        })) ?? [];
        state.chatMessages = pluginAgent.buildAnalysisMessages({
          issueCount: state.issueCount ?? 0,
          topIssueTitle: state.topIssueTitle,
          locateStatus: state.locateStatus,
          analysisReport: result.analysisReport,
          libraryInsights: result.libraryInsights,
          issueItems: state.issueItems,
          mcpResources: result.mcpResources,
          mcpResourceReads: result.mcpResourceReads,
           toolTraces: result.toolTraces,
           executionTraces: result.executionTraces,
           reactEvents: result.reactEvents,
           stepStates: result.stepStates,
           workingMemory: result.workingMemory,
           nextSuggestions: result.nextSuggestions,
          structuredSuggestions: result.structuredSuggestions,
        });
        
      if (ENABLE_VERBOSE_RUNTIME_LOGS && typeof console !== "undefined") {
        console.log(`${LOG_PREFIX} buildAnalysisMessages.result`, {
          hasReactEvents: Boolean(result.reactEvents),
          reactEventsCount: result.reactEvents?.length ?? 0,
          messageCount: state.chatMessages?.length ?? 0,
          lastMessageHasReactEvents: state.chatMessages?.[state.chatMessages.length - 1]?.reactEvents?.length ?? 0,
        });
      }
      // 使用详细报告的 overview 作为 summary，而不是简陋的总结
      state.summary = result.analysisReport?.overview ?? buildAnalysisSummary(state, adapter.source);

      internals.issueItems = state.issueItems
        .map((item) => ({
          objectId: item.objectId,
          objectType: normalizeIssueObjectType(item.objectType),
        }))
        .filter((item) => Boolean(item.objectId && item.objectType));
    } catch (error) {
      const resultError = error instanceof Error ? error.message : String(error);
      state.agentRunState = "failed";
      state.agentRunRoute = "analysis";
      state.agentRunDetail = resultError;
      state.summary = `分析未完成：${resultError}（adapter_source=${adapter.source}）`;
      state.chatMessages = replaceTrailingPendingAssistant(
        state.chatMessages ?? [],
        buildErrorChatMessages(state.summary)
      );
      state.issueItems = [];
      internals.issueItems = [];
    }

    state.nextActions = buildNextActions(state);
    scheduleStreamCommit(true);
    return commitState(internals, state, storage);
  }

  async function handleUnauthorizedSession(error: HttpError): Promise<void> {
    const refreshed = await refreshSessionIfNeeded("http_401");
    if (refreshed) {
      if (internals.currentState) {
        await fillSettingsState(internals.currentState, sessionStore, authClient, creditsClient, customLlmConfigStore, llmModeStore);
        internals.currentState.summary = "登录状态已自动刷新。";
        internals.currentState.nextActions = buildNextActions(internals.currentState);
        commitState(internals, internals.currentState, storage);
      }
      return;
    }
    try {
      await sessionStore.clear();
    } catch {
      // Ignore local storage cleanup failures; the runtime still needs to drop to logged-out state.
    }
    if (typeof console !== "undefined") {
      console.warn(`${LOG_PREFIX} session.invalidated`, {
        status: error.status,
        message: error.message,
      });
    }
    if (!internals.currentState) {
      return;
    }
    internals.currentState.loggedIn = false;
    internals.currentState.loginStatus = "登录已失效";
    internals.currentState.userDisplayName = undefined;
    internals.currentState.userEmail = undefined;
    internals.currentState.creditsBalance = undefined;
    internals.currentState.creditsCurrency = undefined;
    internals.currentState.creditsTransactions = [];
    internals.currentState.summary = "登录状态已失效，请重新登录。";
    if (internals.pendingChatInput) {
      internals.currentState.summary = "登录状态已失效，请重新登录。登录成功后会自动继续刚才的对话。";
    }
    internals.currentState.nextActions = buildNextActions(internals.currentState);
    commitState(internals, internals.currentState, storage);
  }

  async function applyCurrentDraftPlan(): Promise<MainPanelState> {
    const state = internals.currentState ?? (await computeAnalysisState());
    const draftPlan = internals.draftPlan;
    if (!draftPlan) {
      state.agentRunState = "failed";
      state.agentRunRoute = "draft";
      state.agentRunDetail = "当前没有可应用草案";
      state.summary = "当前没有可应用的草案，请先生成草案。";
      state.toast = {
        id: Date.now(),
        message: state.summary,
      };
      return commitState(internals, state, storage);
    }
    if (internals.draftBlocked) {
      state.agentRunState = "awaiting_confirmation";
      state.agentRunRoute = "draft";
      state.agentRunDetail = "草案存在高风险问题，已阻断直接应用";
      state.summary = "草案存在高风险问题，请先修改或重新生成后再应用。";
      state.toast = {
        id: Date.now(),
        message: state.summary,
      };
      return commitState(internals, state, storage);
    }
    if (hasUnresolvedDraftDevices(draftPlan)) {
      state.agentRunState = "awaiting_confirmation";
      state.agentRunRoute = "draft";
      state.agentRunDetail = "草案仍有待确认器件";
      state.summary = "草案中仍有待确认器件，请先选择器件后再应用。";
      state.devicePicker = {
        ...(buildDevicePickerState(draftPlan, state.devicePicker) ?? { open: true, items: [] }),
        open: true,
      };
      state.toast = {
        id: Date.now(),
        message: state.summary,
      };
      return commitState(internals, state, storage);
    }
    const adapter = createEditorAdapter(resolveRuntimeChannel());
    const currentContext = await adapter.getCurrentContext().catch(() => null);
    const currentPageId = currentContext?.project?.pageId;
    if (
      canBuildPatchPreview({
        appliedDraftSnapshot: state.appliedDraftSnapshot,
        draftObjectBindings: state.draftObjectBindings,
        currentPageId,
      })
    ) {
      const patchPlan = buildDraftPatchPlan({
        previous: state.appliedDraftSnapshot!,
        next: draftPlan,
        bindings: state.draftObjectBindings!,
      });
      const patchSummary = summarizeDraftPatchPlan(patchPlan);
      internals.draftPatchPreviewFingerprint = buildDraftPlanFingerprint(draftPlan);
      state.draftPatchPlan = patchPlan;
      state.agentRunState = "awaiting_confirmation";
      state.agentRunRoute = "draft";
      state.agentRunDetail = "草案 patch 预览已生成，等待确认";
      state.summary = `已生成草案 patch 预览。${patchSummary}`;
      state.chatMessages = appendAssistantMessages(
        sanitizeChatMessages(state.chatMessages),
        pluginAgent.buildStatusMessages({
          title: "补丁预览",
          content: `检测到当前草案将覆盖已应用版本，已生成 patch 预览。\n\n${patchSummary}`,
          tone: "warning",
          actions: [
            {
              label: "应用补丁草案",
              action: "apply_patch_draft",
            },
          ],
        })
      );
      state.nextActions = buildNextActions(state);
      return commitState(internals, state, storage);
    }
    const replacingExistingDraft = Boolean(internals.lastApplyTransactionId);
    state.agentRunState = "running_tools";
    state.agentRunRoute = "draft";
    state.agentRunDetail = replacingExistingDraft ? "正在替换当前草案" : "正在应用已确认草案";
    state.summary = replacingExistingDraft
      ? "正在回滚上一版草案并应用修改后的版本，请稍候。"
      : "正在将草案写入原理图，请稍候。";
    state.nextActions = buildNextActions(state);
    commitState(internals, state, storage);
    try {
      const result = await applyDraftPlanWithRepair({
        initialPlan: draftPlan,
        maxRepairAttempts: MAX_DRAFT_REPAIR_ATTEMPTS,
        applyPlan: async (plan) => {
          const applyResult = await adapter.applyPlan(plan, {
            replaceTransactionId: internals.lastApplyTransactionId,
          });
          if (!applyResult.applied) {
            const capabilityReport = await adapter.getCapabilityReport().catch(() => null);
            throw new Error(
              buildDraftApplyUnavailableMessage({
                adapterSource: adapter.source,
                capabilityReport,
              })
            );
          }
          return applyResult;
        },
        repairPlan: async ({ plan, applyError }) =>
          pluginAgent
            .createToolRegistry(adapter, { includeIssueTools: false, includeLibraryTools: true })
            .invoke("draft_repair_plan", {
              plan,
              applyError,
            }) as Promise<{ repaired?: boolean; plan?: DraftPlan }>,
      });
      if (result.finalPlan !== draftPlan) {
        internals.draftPlan = result.finalPlan;
        syncDraftPreviewState(state, result.finalPlan);
      }
      internals.lastApplyTransactionId = result.result.transactionId;
      internals.draftBlocked = false;
      const appliedContext = await adapter.getCurrentContext().catch(() => null);
      const appliedPageId = appliedContext?.project?.pageId;
      state.appliedDraftSnapshot = buildAppliedDraftSnapshot({
        plan: result.finalPlan,
        transactionId: result.result.transactionId,
        pageId: appliedPageId,
      });
      state.draftObjectBindings = buildInitialDraftObjectBindings(appliedPageId);
      state.draftPatchPlan = undefined;
      internals.draftPatchPreviewFingerprint = undefined;
      state.agentRunState = "completed";
      state.agentRunRoute = "draft";
      const applyPresentation = formatDraftApplySuccessSummary(result.result);
      state.agentRunDetail = result.repaired
        ? `草案已自动修补并应用${result.result.partialWiring?.skippedConnectionCount ? "，部分连接需手动处理" : ""}`
        : applyPresentation.title;
      state.summary = result.repaired
        ? `草案已自动修补 ${result.repairCount} 次后应用。${applyPresentation.summary}`
        : applyPresentation.summary;
      state.chatMessages = appendAssistantMessages(
        sanitizeChatMessages(state.chatMessages),
        result.repaired
          ? pluginAgent.buildStatusMessages({
              title: applyPresentation.title,
              content: state.summary,
              tone: "success",
            })
          : [
              {
                ...pluginAgent.buildDraftAppliedMessages(result.result.componentCount, result.result.netCount)[0],
                title: applyPresentation.title,
                content: applyPresentation.content,
              },
            ]
      );
    } catch (error) {
      state.agentRunState = "failed";
      state.agentRunRoute = "draft";
      state.agentRunDetail = error instanceof Error ? error.message : String(error);
      state.summary = formatDraftApplyErrorMessage(error);
      state.chatMessages = appendAssistantMessages(
        sanitizeChatMessages(state.chatMessages),
        pluginAgent.buildStatusMessages({
          title: "应用失败",
          content: state.summary,
          tone: "warning",
        })
      );
      state.toast = {
        id: Date.now(),
        message: state.summary,
      };
    }
    state.nextActions = buildNextActions(state);
    return commitState(internals, state, storage);
  }

  async function applyCurrentDraftPatchPlan(): Promise<MainPanelState> {
    const state = internals.currentState ?? (await computeAnalysisState());
    const draftPlan = internals.draftPlan;
    const patchPlan = state.draftPatchPlan;
    if (!draftPlan || !patchPlan) {
      state.agentRunState = "failed";
      state.agentRunRoute = "draft";
      state.agentRunDetail = "当前没有可应用的补丁草案";
      state.summary = "当前没有可应用的补丁草案，请先生成补丁预览。";
      state.toast = {
        id: Date.now(),
        message: state.summary,
      };
      return commitState(internals, state, storage);
    }

    const currentDraftFingerprint = buildDraftPlanFingerprint(draftPlan);
    if (
      !internals.draftPatchPreviewFingerprint ||
      currentDraftFingerprint !== internals.draftPatchPreviewFingerprint
    ) {
      state.agentRunState = "failed";
      state.agentRunRoute = "draft";
      state.agentRunDetail = "补丁预览已过期";
      state.summary = "补丁预览已过期，请重新生成补丁预览后再应用。";
      state.toast = {
        id: Date.now(),
        message: state.summary,
      };
      return commitState(internals, state, storage);
    }

    const adapter = createEditorAdapter(resolveRuntimeChannel());
    state.agentRunState = "running_tools";
    state.agentRunRoute = "draft";
    state.agentRunDetail = "正在应用补丁草案";
    state.summary = "正在将补丁草案写入原理图，请稍候。";
    state.nextActions = buildNextActions(state);
    commitState(internals, state, storage);

    try {
      const result = await executeDraftPatchPlan({
        adapter,
        plan: patchPlan,
      });
      if (!result.applied) {
        throw new Error("patch draft apply reported no changes");
      }

      const transactionId = result.transactionId ?? internals.lastApplyTransactionId;
      if (transactionId) {
        internals.lastApplyTransactionId = transactionId;
      }
      const appliedPageId = result.bindings?.pageId ?? state.appliedDraftSnapshot?.pageId;
      state.appliedDraftSnapshot = buildAppliedDraftSnapshot({
        plan: draftPlan,
        transactionId,
        pageId: appliedPageId,
      });
      if (result.bindings) {
        state.draftObjectBindings = result.bindings;
      } else {
        state.draftObjectBindings = buildInitialDraftObjectBindings(appliedPageId);
      }
      state.draftPatchPlan = undefined;
      internals.draftPatchPreviewFingerprint = undefined;
      state.agentRunState = "completed";
      state.agentRunRoute = "draft";
      state.agentRunDetail = "补丁草案已应用";
      state.summary = result.bindings
        ? "补丁草案已应用，草案快照与对象绑定已刷新。"
        : "补丁草案已应用，但未返回新的对象绑定，已保留非权威绑定。";
      state.chatMessages = appendAssistantMessages(
        sanitizeChatMessages(state.chatMessages),
        pluginAgent.buildStatusMessages({
          title: "已应用补丁草案",
          content: state.summary,
          tone: "success",
        })
      );
    } catch (error) {
      state.agentRunState = "failed";
      state.agentRunRoute = "draft";
      state.agentRunDetail = error instanceof Error ? error.message : String(error);
      state.summary = `应用补丁草案失败：${error instanceof Error ? error.message : String(error)}`;
      state.chatMessages = appendAssistantMessages(
        sanitizeChatMessages(state.chatMessages),
        pluginAgent.buildStatusMessages({
          title: "补丁应用失败",
          content: state.summary,
          tone: "warning",
        })
      );
      state.toast = {
        id: Date.now(),
        message: state.summary,
      };
    }

    state.nextActions = buildNextActions(state);
    return commitState(internals, state, storage);
  }

  async function searchDraftDeviceCandidatesInternal(
    state: MainPanelState,
    componentId: string,
    manualQuery?: string
  ): Promise<{ state: MainPanelState; updated: boolean; candidateCount: number }> {
    const plan = internals.draftPlan;
    const bridge = resolveHostEditorBridge();
    if (!plan || !bridge?.searchLibraryDevices) {
      state.summary = "当前宿主不支持器件库搜索。";
      state.toast = { id: Date.now(), message: state.summary };
      return { state, updated: false, candidateCount: 0 };
    }
    const component = plan.components.find((item) => item.id === componentId);
    const pickerItem = state.devicePicker?.items.find((item) => item.componentId === componentId);
    const role = component ? resolveDraftComponentRole(component) : pickerItem?.role;
    const queries = component
      ? buildDraftDeviceSearchQueries({
          role,
          defaultQuery: component.properties?.preferred_search_query,
          manualQuery: manualQuery ?? pickerItem?.manualQueryDraft,
          componentRef: component.ref,
          componentName: component.name,
          componentValue: component.value,
        })
      : [];
    const attemptedLcscIds = component
      ? buildDraftDeviceLcscFallbackIds({
          defaultQuery: component.properties?.preferred_search_query,
          manualQuery: manualQuery ?? pickerItem?.manualQueryDraft,
          componentName: component.name,
          componentValue: component.value,
        })
      : [];
    if (!component || queries.length === 0) {
      state.summary = "当前器件缺少可用搜索条件，请手动输入搜索关键词。";
      state.toast = { id: Date.now(), message: state.summary };
      return { state, updated: false, candidateCount: 0 };
    }
    const attemptedQueries: string[] = [];
    const attemptedPropertySearches: string[] = [];
    const rawResultKinds: string[] = [];
    let query = queries[0]!;
    let candidates: DevicePickerCandidate[] = [];
    let route = "query_search";
    const routesHit = new Set<string>();
    let detailHits = 0;
    const propertySearches = component
      ? buildDraftDeviceSearchProperties({
          role,
          defaultQuery: component.properties?.preferred_search_query,
          manualQuery: manualQuery ?? pickerItem?.manualQueryDraft,
          componentName: component.name,
          componentValue: component.value,
        })
      : [];
    if (bridge.searchLibraryDevices) {
      for (const candidateQuery of queries) {
        attemptedQueries.push(candidateQuery);
        const rawCandidates = await withDevicePickerTimeout(
          bridge.searchLibraryDevices({ query: candidateQuery, scope: "system", pageSize: 8 }),
          "library_search"
        );
        rawResultKinds.push(summarizeLibrarySearchPayloadKind(rawCandidates));
        const queryCandidates = normalizeDevicePickerCandidates(rawCandidates);
        query = candidateQuery;
        if (queryCandidates.length > 0) {
          candidates = mergeDevicePickerCandidates(candidates, queryCandidates);
          routesHit.add("query_search");
          break;
        }
      }
    }
    if (bridge.searchLibraryDevicesByProperties && propertySearches.length > 0) {
      for (const properties of propertySearches) {
        attemptedPropertySearches.push(JSON.stringify(properties));
        const rawCandidates = await withDevicePickerTimeout(
          bridge.searchLibraryDevicesByProperties({
            properties,
            scope: "system",
            pageSize: 8,
          }),
          "library_property_search"
        );
        rawResultKinds.push(`property:${Object.keys(properties).join(",")}:${summarizeLibrarySearchPayloadKind(rawCandidates)}`);
        const propertyCandidates = normalizeDevicePickerCandidates(rawCandidates);
        if (propertyCandidates.length > 0) {
          candidates = mergeDevicePickerCandidates(candidates, propertyCandidates);
          routesHit.add("property_search");
          break;
        }
      }
    }
    if (attemptedLcscIds.length > 0 && bridge.getLibraryDevicesByLcscIds) {
      const lcscDetails = await withDevicePickerTimeout(
        bridge.getLibraryDevicesByLcscIds({
          lcscIds: attemptedLcscIds,
          scope: "system",
          allowMultiMatch: true,
        }),
        "lcsc_lookup"
      );
      rawResultKinds.push(`lcsc_details:${Array.isArray(lcscDetails) ? lcscDetails.length : 0}`);
      const lcscCandidates = normalizeDevicePickerCandidatesFromLcscDetails(lcscDetails);
      if (lcscCandidates.length > 0) {
        candidates = mergeDevicePickerCandidates(candidates, lcscCandidates);
        routesHit.add("lcsc_id_lookup");
      }
    }
    if (routesHit.size > 1) {
      route = "merged_search";
    } else if (routesHit.size === 1) {
      route = Array.from(routesHit)[0]!;
    }
    if (candidates.length > 0) {
      const enriched = await enrichDevicePickerCandidatesWithDetails(candidates, bridge.getLibraryDevice);
      candidates = enriched.candidates;
      detailHits = enriched.detailHits;
    }
    const presentedCandidates = candidates.map((candidate, index) => ({
      ...candidate,
      ...buildDevicePickerCandidatePresentation(
        {
          role,
          query,
        },
        candidate,
        index
      ),
    }));
    const previousPicker = state.devicePicker;
    const picker = buildDevicePickerState(plan, previousPicker) ?? { open: true, items: [] };
    picker.open = true;
    picker.items = picker.items.map((item) => {
      const previousItem = previousPicker?.items.find((entry) => entry.componentId === item.componentId);
      if (item.componentId !== componentId) {
        return previousItem?.candidates && previousItem.candidates.length > 0
          ? { ...item, candidates: previousItem.candidates }
          : item;
        }
        return {
          ...item,
          ...resolveDevicePickerManualQueryStateForSearch({
            item,
            previousItem,
            manualQuery,
          }),
          suggestedQueries: queries,
          attemptedQueries,
          searchDiagnostics: {
            route,
            attemptedLcscIds,
            attemptedQueries: attemptedPropertySearches.length > 0
              ? [...attemptedPropertySearches, ...attemptedQueries]
              : attemptedQueries,
            rawResultKinds,
            detailHits,
            normalizedCount: presentedCandidates.length,
          },
          candidates: presentedCandidates,
        };
      });
    state.devicePicker = picker;
    if (presentedCandidates.length === 0 && attemptedQueries.length > 0) {
      state.summary = "未找到可用候选，可改用推荐词或手动输入继续搜索。";
    }
    return { state, updated: true, candidateCount: presentedCandidates.length };
  }

  function chooseDraftDeviceCandidateInternal(
    state: MainPanelState,
    input: { componentId: string; candidateIndex: number }
  ): MainPanelState {
    const plan = internals.draftPlan;
    if (!plan) {
      return state;
    }
    const picker = state.devicePicker ?? buildDevicePickerState(plan);
    const item = picker?.items.find((entry) => entry.componentId === input.componentId);
    const candidate = item?.candidates?.[input.candidateIndex];
    if (!item || !candidate) {
      return state;
    }
    applyDraftDeviceCandidateSelection(plan, {
      componentId: input.componentId,
      candidate,
    });
    internals.draftPlan = plan;
    syncDraftPreviewState(state, plan);
    const remainingUnresolved = hasUnresolvedDraftDevices(plan);
    if (state.devicePicker) {
      state.devicePicker.open = remainingUnresolved;
    }
    state.agentRunState = "awaiting_confirmation";
    state.agentRunRoute = "draft";
    state.agentRunDetail = "器件已更新";
    state.summary = remainingUnresolved ? "已更新草案器件选择，请继续完成剩余器件确认。" : "器件已全部确认，可以应用草案。";
    refreshDraftMessageActionsAfterDeviceSelection(state, remainingUnresolved);
    return state;
  }

  async function enrichCurrentDraftPlanFromLibrary(state: MainPanelState): Promise<void> {
    const plan = internals.draftPlan;
    const bridge = resolveHostEditorBridge();
    internals.draftPlan = await enrichDraftPlanFromBridge(plan, bridge);
    syncDraftPreviewState(state, internals.draftPlan);
  }

  function refreshDraftMessageActionsAfterDeviceSelection(state: MainPanelState, remainingUnresolved: boolean): void {
    const messages = sanitizeChatMessages(state.chatMessages);
    const lastMessageIndex = messages.map((message) => message.role).lastIndexOf("assistant");
    if (lastMessageIndex >= 0 && messages[lastMessageIndex]) {
      const previous = messages[lastMessageIndex]!;
      const nextActions = remainingUnresolved
        ? [{ label: "选择器件", action: "select_devices" as const }]
        : [
            { label: "应用草案", action: "apply_draft" as const },
            { label: "回滚应用", action: "rollback" as const },
          ];
      messages[lastMessageIndex] = {
        ...previous,
        content: appendDeviceSelectionStatusToDraftMessage(previous.content, state.summary),
        actions: nextActions,
      };
    }
    state.chatMessages = messages;
  }

  return {
    openPanel: openIdlePanelState,
    rerunAnalysis: computeAnalysisState,
    locateIssue: async (index: number): Promise<MainPanelState> => {
      const currentState = internals.currentState ?? (await computeAnalysisState());
      const channel = resolveRuntimeChannel();
      const adapter = createEditorAdapter(channel);
      const issue = internals.issueItems[index];
      if (!issue?.objectId || !issue.objectType) {
        currentState.summary = "定位失败：未找到目标问题。";
        return commitState(internals, currentState, storage);
      }
      try {
        await adapter.locate({
          objectId: issue.objectId,
          objectType: issue.objectType,
        });
        currentState.locateStatus = `${issue.objectType}:${issue.objectId}`;
        currentState.summary = `已定位到对象 ${issue.objectType}:${issue.objectId}。`;
        currentState.chatMessages = buildLocateChatMessages(currentState, issue.objectType, issue.objectId);
      } catch (error) {
        currentState.summary = `定位失败：${error instanceof Error ? error.message : String(error)}`;
        currentState.chatMessages = buildErrorChatMessages(currentState.summary);
      }
      currentState.nextActions = buildNextActions(currentState);
      return commitState(internals, currentState, storage);
    },
    startLogin: async (): Promise<MainPanelState> => {
      const state = internals.currentState ?? (await computeAnalysisState());
      const channel = resolveRuntimeChannel();
      const launcher = new HostBrowserLauncher();

      try {
        const loginSession = await authClient.createLoginSession(channel);
        await launcher.open(loginSession.login_url);

        if (internals.activeLoginSession) {
          internals.activeLoginSession.stopped = true;
        }
        internals.activeLoginSession = {
          loginSessionId: loginSession.login_session_id,
          pollToken: loginSession.poll_token,
          stopped: false,
        };

        state.loginStatus = "等待浏览器完成登录";
        state.summary = "已打开登录页面，请在浏览器完成邮箱或微信登录。";
        state.nextActions = buildNextActions(state);
        commitState(internals, state, storage);

        // 后台轮询会话状态，成功后自动回写面板状态。
        void pollLoginSessionUntilDone(
          internals,
          authClient,
          sessionStore,
          creditsClient,
          customLlmConfigStore,
          storage
        );
      } catch (error) {
        state.loginStatus = "登录启动失败";
        state.summary = `登录启动失败：${error instanceof Error ? error.message : String(error)}`;
        state.toast = {
          id: Date.now(),
          message: state.summary,
        };
        state.nextActions = buildNextActions(state);
        commitState(internals, state, storage);
      }

      return internals.currentState!;
    },
    resetSession: async (): Promise<MainPanelState> => {
      internals.currentState = null;
      internals.sessionId = undefined;
      internals.issueItems = [];
      internals.draftPlan = undefined;
      internals.draftBlocked = undefined;
      internals.lastApplyTransactionId = undefined;
      internals.pendingChatInput = undefined;
      internals.activeTurnId = undefined;
      internals.activeTurnAbortController = undefined;
      cancelScheduledPanelStatePersist();
      await clearPanelState(storage);
      return openIdlePanelState();
    },
    generateDraft: async (prompt: string): Promise<MainPanelState> => {
      const state = internals.currentState ?? (await computeAnalysisState());
      const channel = resolveRuntimeChannel();
      const adapter = createEditorAdapter(channel);

      try {
        const context = await buildSchematicContext(adapter);
        const result = await pluginAgent.run({
          type: "schematic_draft",
          userQuery: prompt,
          context,
          adapter,
        });
        if (typeof console !== "undefined") {
          console.log(`${LOG_PREFIX} draft.react.trace`, result.executionTraces ?? []);
        }
        if (result.draftPreview) {
          state.agentRunState = "awaiting_confirmation";
          state.agentRunRoute = "draft";
          state.agentRunDetail = result.summary;
          internals.draftPlan = result.draftPlan;
          internals.draftBlocked = result.draftRisk?.level === "blocked";
          syncDraftPreviewState(state, result.draftPlan);
          state.summary = `草案已生成：${result.draftPreview.title}，共 ${result.draftPreview.componentCount} 个器件，${result.draftPreview.netCount} 条网络。`;
          state.chatMessages = pluginAgent.buildDraftMessages({
            draftPreview: state.draftPreview,
            mcpResources: result.mcpResources,
            mcpResourceReads: result.mcpResourceReads,
           toolTraces: result.toolTraces,
           executionTraces: result.executionTraces,
           uiEvents: result.uiEvents,
           reactEvents: result.reactEvents,
           stepStates: result.stepStates,
           workingMemory: result.workingMemory,
           draftRisk: result.draftRisk,
            nextSuggestions: result.nextSuggestions,
            structuredSuggestions: result.structuredSuggestions,
          });
        } else {
          state.agentRunState = "completed";
          state.agentRunRoute = "draft";
          state.agentRunDetail = "草案未返回预览";
          state.summary = "草案生成完成，但未返回预览信息。";
          state.chatMessages = pluginAgent.buildStatusMessages({ content: state.summary, tone: "warning" });
        }
      } catch (error) {
        state.agentRunState = "failed";
        state.agentRunRoute = "draft";
        state.agentRunDetail = error instanceof Error ? error.message : String(error);
        state.summary = `草案生成失败：${error instanceof Error ? error.message : String(error)}`;
        state.chatMessages = pluginAgent.buildStatusMessages({ content: state.summary, tone: "warning" });
      }
      state.nextActions = buildNextActions(state);
      return commitState(internals, state, storage);
    },
    sendChat: async (input: string): Promise<MainPanelState> => {
      const trimmed = input.trim();
      if (!trimmed) {
        if (typeof console !== "undefined") {
          console.warn(`${LOG_PREFIX} sendChat.empty-input`);
        }
        return internals.currentState ?? computeAnalysisState();
      }
      if (ENABLE_VERBOSE_RUNTIME_LOGS && typeof console !== "undefined") {
        console.log(`${LOG_PREFIX} sendChat.start`, {
          promptLength: trimmed.length,
          hasState: Boolean(internals.currentState),
        });
      }
      // If the panel state hasn't been initialized yet (e.g. sendChat invoked early),
      // do NOT block on expensive editor/context/credits calls. Create a minimal state
      // so the iframe can immediately render the pending assistant card.
      const current =
        internals.currentState ??
        commitState(
          internals,
          {
            loggedIn: false,
            sessionTitle: "New Session",
            agentRunState: "idle",
            agentRunRoute: "chat",
            agentRunDetail: "等待用户输入",
            summary: "助手已就绪。",
            chatMessages: [],
          },
          storage
        );
      if (
        shouldAutoApplyDraftFromChatInput({
          agentRunState: current.agentRunState,
          input: trimmed,
          hasDraftPlan: Boolean(internals.draftPlan),
          draftBlocked: internals.draftBlocked,
        })
      ) {
        current.chatMessages = appendUserChatMessage(
          stripInitialWelcomeMessages(sanitizeChatMessages(current.chatMessages)),
          trimmed
        );
        current.agentRunRoute = "draft";
        current.agentRunDetail = "正在应用已确认草案";
        current.summary = "已收到确认，正在将草案应用到原理图。";
        commitState(internals, current, storage);
        return applyCurrentDraftPlan();
      }
      const llmMode = await llmModeStore.get();
      const session = await sessionStore.get();
      if (llmMode === "proxy" && !session?.accessToken) {
        // Avoid waiting for credits syncing before showing the login-required toast.
        // Settings can be refreshed lazily via syncState / settings drawer.
        current.agentRunState = "idle";
        current.agentRunRoute = "chat";
        current.agentRunDetail = "未登录";
        current.summary = "当前 LLM 模式为服务器转发，请先登录后再继续。";
        try {
          await resolveHostEditorBridge()?.showToastMessage?.("请先登录后再发送消息", 2200);
        } catch {
          // Ignore toast failures in unsupported host environments.
        }
        toastId += 1;
        current.toast = { id: toastId, message: "请先登录后再发送消息" };
        current.nextActions = buildNextActions(current);
        if (typeof console !== "undefined") {
          console.warn(`${LOG_PREFIX} sendChat.not-logged-in`, {
            promptLength: trimmed.length,
          });
        }
        return commitState(internals, current, storage);
      }
      if (!current.sessionTitle || current.sessionTitle === "New Session") {
        current.sessionTitle = buildSessionTitleFromPrompt(trimmed);
      }
      if (
        shouldIgnoreDuplicateSendWhileRunning({
          trimmedInput: trimmed,
          pendingChatInput: internals.pendingChatInput,
          activeTurnId: internals.activeTurnId,
          agentRunState: current.agentRunState,
          lastUserMessageContent:
            sanitizeChatMessages(current.chatMessages)
              .filter((message) => message.role === "user")
              .slice(-1)[0]?.content,
        })
      ) {
        if (typeof console !== "undefined") {
          console.warn(`${LOG_PREFIX} sendChat.duplicate-ignored`, {
            promptLength: trimmed.length,
          });
        }
        return current;
      }
      await compactChatHistoryIfNeeded({
        state: current,
        llmClient: unifiedLlmClient,
      });
      const historyMessages = stripInitialWelcomeMessages(sanitizeChatMessages(current.chatMessages));
      const nextMessages = historyMessages.slice();
      const userMessage = {
        role: "user",
        title: "你",
        content: trimmed,
      } as const;
      nextMessages.push(userMessage);
      
      // 立即添加"处理中"的助手消息，让用户看到加载状态
      const pendingMessage = {
        role: "assistant" as const,
        title: "助手",
        content: "正在思考...",
        streaming: true,
      };
      nextMessages.push(pendingMessage);
      
      current.chatMessages = nextMessages;
      current.agentRunState = "planning";
      current.agentRunDetail = "正在规划本轮 agent 执行";
      
      if (ENABLE_VERBOSE_RUNTIME_LOGS && typeof console !== "undefined") {
        console.log(`${LOG_PREFIX} sendChat.pending-message-added`, {
          messageCount: nextMessages.length,
          lastMessage: nextMessages[nextMessages.length - 1],
          agentRunState: current.agentRunState,
        });
      }
      
      commitState(internals, current, storage);
      
      if (ENABLE_VERBOSE_RUNTIME_LOGS && typeof console !== "undefined") {
        console.log(`${LOG_PREFIX} sendChat.state-committed`, {
          version: internals.stateVersion,
          willWait: true,
        });
      }
      
      // 使用微任务确保 UI 有机会渲染 pending 状态，避免被后续的快速更新覆盖
      // 增加到 50ms 以确保 iframe 有足够时间处理事件和渲染
      await new Promise(resolve => setTimeout(resolve, 50));
      
      if (ENABLE_VERBOSE_RUNTIME_LOGS && typeof console !== "undefined") {
        console.log(`${LOG_PREFIX} sendChat.after-delay`, {
          version: internals.stateVersion,
          proceedingToPlanning: true,
        });
      }
      
      internals.pendingChatInput = trimmed;
      turnIdCounter += 1;
      const turnId = turnIdCounter;
      internals.activeTurnId = turnId;
      internals.activeTurnAbortController = new AbortController();

      let turnCommitTimer: ReturnType<typeof setTimeout> | null = null;
      let lastTurnCommitAt = 0;
      const turnStartedAt = getPerfNow();
      let lastStreamEventAt = turnStartedAt;
      let lastCommitAt = turnStartedAt;
      const streamStats = createStreamStatsLogger(turnId);
      const scheduleTurnCommit = (
        force: boolean,
        options?: {
          route?: "chat" | "analysis" | "draft" | "modify";
          stage?: string;
          textDeltaLength?: number;
          reasoningDeltaLength?: number;
        }
      ) => {
        const commitStart = getPerfNow();
        const minIntervalMs = STREAM_COMMIT_MIN_INTERVAL_MS;
        if (force) {
          if (turnCommitTimer) {
            clearTimeout(turnCommitTimer);
            turnCommitTimer = null;
          }
          lastTurnCommitAt = Date.now();
          commitState(internals, current, storage);
          lastCommitAt = getPerfNow();
          logStageTiming("runtime", "commit", {
            turnId,
            action: "committed",
            force: true,
            durationMs: Number((lastCommitAt - commitStart).toFixed(2)),
            sinceTurnStartMs: Number((lastCommitAt - turnStartedAt).toFixed(2)),
          });
          return "committed";
        }
        const now = Date.now();
        const elapsed = now - lastTurnCommitAt;
        if (elapsed >= minIntervalMs && !turnCommitTimer) {
          const previousCommitAt = lastCommitAt;
          lastTurnCommitAt = now;
          commitState(internals, current, storage);
          lastCommitAt = getPerfNow();
          logStageTiming("runtime", "commit", {
            turnId,
            action: "committed",
            force: false,
            durationMs: Number((lastCommitAt - commitStart).toFixed(2)),
            sincePreviousCommitMs: Number((commitStart - previousCommitAt).toFixed(2)),
            sinceTurnStartMs: Number((lastCommitAt - turnStartedAt).toFixed(2)),
          });
          return "committed";
        }
        if (turnCommitTimer) return "pending";
        turnCommitTimer = setTimeout(() => {
          const delayedCommitStart = getPerfNow();
          const previousCommitAt = lastCommitAt;
          turnCommitTimer = null;
          lastTurnCommitAt = Date.now();
          commitState(internals, current, storage);
          lastCommitAt = getPerfNow();
          logStageTiming("runtime", "commit", {
            turnId,
            action: "timer",
            durationMs: Number((lastCommitAt - delayedCommitStart).toFixed(2)),
            sincePreviousCommitMs: Number((delayedCommitStart - previousCommitAt).toFixed(2)),
            sinceTurnStartMs: Number((lastCommitAt - turnStartedAt).toFixed(2)),
          });
        }, Math.max(0, minIntervalMs - elapsed));
        return "scheduled";
      };
      try {
        const channel = resolveRuntimeChannel();
        const adapter = createEditorAdapter(channel);
        const plan = {
          intent: "chat" as const,
          route: "chat" as const,
          // LLM decides whether it needs context via tool calls; runtime still tries to load context best-effort.
          requiresContext: false,
          steps: [],
        };
        let context;
        try {
          const contextStart = getPerfNow();
          context = await buildSchematicContext(adapter);
          logStageTiming("runtime", "context", {
            turnId,
            durationMs: Number((getPerfNow() - contextStart).toFixed(2)),
            sinceTurnStartMs: Number((getPerfNow() - turnStartedAt).toFixed(2)),
            hasContext: Boolean(context),
          });
        } catch (error) {
          logStageTiming("runtime", "context", {
            turnId,
            failed: true,
            sinceTurnStartMs: Number((getPerfNow() - turnStartedAt).toFixed(2)),
            error: error instanceof Error ? error.message : String(error),
          });
          if (typeof console !== "undefined") {
            console.warn(`${LOG_PREFIX} sendChat.context.optional-failed`, {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        current.agentRunState = plan.route === "chat" ? "waiting_llm" : "running_tools";
        current.agentRunRoute = plan.route;
        current.agentRunDetail = buildPendingAgentDetail(plan.route);
        current.summary = buildPendingAgentSummary(plan.route);
        // 更新最后一条消息（已经存在的 pending 消息）
        const messages = current.chatMessages ?? [];
        if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
          const lastMsg = messages[messages.length - 1];
          lastMsg.streaming = true;
        }
        commitState(internals, current, storage);
        // Timeout policy:
        // - Max timeout: hard ceiling for a single turn.
        // - Idle timeout: only triggers when we receive no onStreamEvent updates for a while.
        // This prevents long but healthy tool/LLM runs from being cut off by a fixed 90s timer.
        // Some schematic analyses + tool calls can be slow; allow long turns as long as we keep receiving progress.
        const TURN_MAX_TIMEOUT_MS = 25 * 60_000;
        const TURN_IDLE_TIMEOUT_MS = 2 * 60_000;
        const withActivityTimeout = async <T>(
          promise: Promise<T>,
          label: string,
          onRegisterTouch: (touch: () => void) => void,
          onTimeout?: () => void
        ): Promise<T> => {
          let hardTimer: ReturnType<typeof setTimeout> | undefined;
          let idleTimer: ReturnType<typeof setTimeout> | undefined;
          let idleReject: ((error: Error) => void) | null = null;

          const armIdle = () => {
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
              idleReject?.(new Error(`timeout: ${label} (idle ${TURN_IDLE_TIMEOUT_MS}ms)`));
            }, TURN_IDLE_TIMEOUT_MS);
          };

          // The touch fn resets idle timeout; it should be called on each stream/progress event.
          const touch = () => armIdle();
          onRegisterTouch(touch);

          const hardTimeout = new Promise<never>((_, reject) => {
            hardTimer = setTimeout(() => {
              onTimeout?.();
              reject(new Error(`timeout: ${label} (max ${TURN_MAX_TIMEOUT_MS}ms)`));
            }, TURN_MAX_TIMEOUT_MS);
          });

          const idleTimeout = new Promise<never>((_, reject) => {
            idleReject = (error) => {
              onTimeout?.();
              reject(error);
            };
            armIdle();
          });

          try {
            return await Promise.race([promise, hardTimeout, idleTimeout]);
          } finally {
            if (hardTimer) clearTimeout(hardTimer);
            if (idleTimer) clearTimeout(idleTimer);
          }
        };

        let touchTurnActivity: (() => void) | null = null;
        const applyStreamEvent = (event: StreamEventPayload) => {
          const perfStart = (isPerfDebugEnabled() || isStageTimingEnabled()) ? getPerfNow() : 0;
          const eventGapMs = perfStart ? perfStart - lastStreamEventAt : 0;
          if (perfStart) {
            lastStreamEventAt = perfStart;
          }
          if (internals.activeTurnId !== turnId) return;
          const sanitizedTextDelta = stripFinalControlLikeText(event.textDelta);
          const sanitizedReasoningDelta = stripFinalControlLikeText(event.reasoningDelta);
          const sanitizeDoneAt = (isPerfDebugEnabled() || isStageTimingEnabled()) ? getPerfNow() : 0;
          const shouldKeepReactEvents = shouldApplyStreamingReactEvents({
            reactEvents: event.reactEvents,
            stepItems: event.stepItems,
            iterationSteps: event.iterationSteps,
          });
          const sanitizedReactEvents = shouldKeepReactEvents
            ? sanitizeReactEventsForUi(event.reactEvents)
            : undefined;
          const clonedStepItems = event.stepItems !== undefined ? cloneForStream(event.stepItems) : undefined;
          const clonedIterationSteps = event.iterationSteps !== undefined ? cloneForStream(event.iterationSteps) : undefined;
          const clonedStepStates = event.stepStates !== undefined ? cloneForStream(event.stepStates) : undefined;
          const clonedWorkingMemory = event.workingMemory !== undefined ? cloneForStream(event.workingMemory) : undefined;
          const clonedReactEvents = sanitizedReactEvents !== undefined ? cloneForStream(sanitizedReactEvents) : undefined;
          const messages = current.chatMessages ?? [];
          const lastMessage = messages[messages.length - 1];
          if (!lastMessage || lastMessage.role !== "assistant") {
            return;
          }
          const previousDetail = String(current.agentRunDetail || "");
          const previousContent = String(lastMessage.content || "");
          const previousProcessSignature = buildStreamingProcessSignature({
            stepItems: lastMessage.stepItems,
            iterationSteps: lastMessage.iterationSteps,
            reactEvents: lastMessage.reactEvents,
            stepStates: lastMessage.stepStates,
            workingMemory: lastMessage.workingMemory,
          });
          const beforeApplyAt = (isPerfDebugEnabled() || isStageTimingEnabled()) ? getPerfNow() : 0;
          if (event.detail) {
            current.agentRunDetail = event.detail;
          }
          if (event.stage === "llm") {
            lastMessage.streaming = true;
            lastMessage.title =
              event.route === "draft"
                ? "草案生成中"
                : event.route === "analysis"
                  ? "分析中"
                  : event.route === "modify"
                    ? "修改当前原理图中"
                    : "处理中";
            const shouldMirrorTextToBody = shouldMirrorStreamingTextToAssistantBody({
              route: event.route,
              hasStepItems: clonedStepItems !== undefined && Boolean(clonedStepItems?.length),
              hasIterationSteps: clonedIterationSteps !== undefined && Boolean(clonedIterationSteps?.length),
              hasReactEvents: clonedReactEvents !== undefined && Boolean(clonedReactEvents?.length),
              hasReasoningDelta: Boolean(sanitizedReasoningDelta),
            });
            const sanitizedProcessText = event.text !== undefined
              ? stripFinalControlLikeText(event.text)
              : undefined;
            const sanitizedText = shouldSanitizeFullStreamingText({
              route: event.route,
              mirrorTextToBody: shouldMirrorTextToBody,
            })
              ? sanitizedProcessText
              : undefined;
            if (shouldMirrorTextToBody && lastMessage.content === "正在思考...") {
              lastMessage.content = "";
            }
            if (shouldMirrorTextToBody && sanitizedTextDelta) {
              applyStreamingAssistantContentDelta(lastMessage, sanitizedTextDelta, "append");
            } else if (shouldMirrorTextToBody && sanitizedText !== undefined && String(sanitizedText).trim()) {
              applyStreamingAssistantContentDelta(lastMessage, sanitizedText, "replace");
            } else if (!shouldMirrorTextToBody && lastMessage.content === "正在思考...") {
              lastMessage.content = "";
            }
            if (
              clonedStepItems !== undefined ||
              clonedIterationSteps !== undefined ||
              clonedReactEvents !== undefined ||
              sanitizedReasoningDelta
            ) {
              mergeStreamProcessFields({
                lastMessage,
                stepItems: clonedStepItems,
                iterationSteps: clonedIterationSteps,
                reactEvents: clonedReactEvents,
                reasoningDelta: sanitizedReasoningDelta,
                text: sanitizedProcessText,
              });
            }
            if (clonedStepStates) {
              lastMessage.stepStates = clonedStepStates;
            }
            if (clonedWorkingMemory) {
              lastMessage.workingMemory = clonedWorkingMemory;
            }
          } else if (event.stage === "progress") {
            lastMessage.streaming = true;
            lastMessage.title = event.route === "draft" ? "草案生成中" : event.route === "modify" ? "修改当前原理图中" : "分析中";
            if (
              clonedStepItems !== undefined ||
              clonedIterationSteps !== undefined ||
              clonedReactEvents !== undefined
            ) {
              mergeStreamProcessFields({
                lastMessage,
                stepItems: clonedStepItems,
                iterationSteps: clonedIterationSteps,
                reactEvents: clonedReactEvents,
              });
            }
            if (clonedStepStates) {
              lastMessage.stepStates = clonedStepStates;
            }
            if (clonedWorkingMemory) {
              lastMessage.workingMemory = clonedWorkingMemory;
            }
          }
          const nextProcessSignature = buildStreamingProcessSignature({
            stepItems: lastMessage.stepItems,
            iterationSteps: lastMessage.iterationSteps,
            reactEvents: lastMessage.reactEvents,
            stepStates: lastMessage.stepStates,
            workingMemory: lastMessage.workingMemory,
          });
          const afterApplyAt = (isPerfDebugEnabled() || isStageTimingEnabled()) ? getPerfNow() : 0;
          const contentChanged = previousContent !== String(lastMessage.content || "");
          const processChanged = previousProcessSignature !== nextProcessSignature;
          const detailChanged = previousDetail !== String(current.agentRunDetail || "");
          const hasVisibleActivity = shouldCountStreamEventAsTurnActivity({
            contentChanged,
            processChanged,
            detailChanged,
          });
          if (!hasVisibleActivity) {
            streamStats.event({
              event,
              changed: false,
              durationMs: isStreamStatsEnabled() || isStageTimingEnabled() ? getPerfNow() - perfStart : 0,
            });
            logStageTiming("runtime", "stream-event", {
              turnId,
              route: event.route,
              stage: event.stage,
              changed: false,
              gapMs: Number(eventGapMs.toFixed(2)),
              sanitizeMs: sanitizeDoneAt && perfStart ? Number((sanitizeDoneAt - perfStart).toFixed(2)) : 0,
              applyMs: afterApplyAt && beforeApplyAt ? Number((afterApplyAt - beforeApplyAt).toFixed(2)) : 0,
              totalMs: perfStart ? Number((getPerfNow() - perfStart).toFixed(2)) : 0,
              sinceTurnStartMs: perfStart ? Number((perfStart - turnStartedAt).toFixed(2)) : 0,
              textDeltaLength: String(sanitizedTextDelta || "").length,
              reasoningDeltaLength: String(sanitizedReasoningDelta || "").length,
              eventIterationSteps: Array.isArray(event.iterationSteps) ? event.iterationSteps.length : 0,
            });
            return;
          }
          touchTurnActivity?.();
          if (isPerfDebugEnabled()) {
            logPerf("onStreamEvent", {
              route: event.route,
              stage: event.stage,
              durationMs: Number((getPerfNow() - perfStart).toFixed(2)),
              textDeltaLength: String(sanitizedTextDelta || "").length,
              textLength: String(event.text || "").length,
              reasoningDeltaLength: String(sanitizedReasoningDelta || "").length,
              stepItems: Array.isArray(lastMessage.stepItems) ? lastMessage.stepItems.length : 0,
              iterationSteps: Array.isArray(lastMessage.iterationSteps) ? lastMessage.iterationSteps.length : 0,
              reactEvents: Array.isArray(lastMessage.reactEvents) ? lastMessage.reactEvents.length : 0,
              contentLength: String(lastMessage.content || "").length,
            });
          }
          const commitAction = scheduleTurnCommit(false, {
            route: event.route,
            stage: event.stage,
            textDeltaLength: String(sanitizedTextDelta || "").length,
            reasoningDeltaLength: String(sanitizedReasoningDelta || "").length,
          });
          const afterCommitAt = (isPerfDebugEnabled() || isStageTimingEnabled()) ? getPerfNow() : 0;
          streamStats.event({
            event,
            changed: true,
            committed: commitAction === "committed",
            scheduled: commitAction === "scheduled",
            durationMs: isStreamStatsEnabled() || isStageTimingEnabled() ? getPerfNow() - perfStart : 0,
          });
          logStageTiming("runtime", "stream-event", {
            turnId,
            route: event.route,
            stage: event.stage,
            changed: true,
            commitAction,
            gapMs: Number(eventGapMs.toFixed(2)),
            sanitizeMs: sanitizeDoneAt && perfStart ? Number((sanitizeDoneAt - perfStart).toFixed(2)) : 0,
            applyMs: afterApplyAt && beforeApplyAt ? Number((afterApplyAt - beforeApplyAt).toFixed(2)) : 0,
            totalMs: perfStart && afterCommitAt ? Number((afterCommitAt - perfStart).toFixed(2)) : 0,
            sinceTurnStartMs: perfStart ? Number((perfStart - turnStartedAt).toFixed(2)) : 0,
            textDeltaLength: String(sanitizedTextDelta || "").length,
            reasoningDeltaLength: String(sanitizedReasoningDelta || "").length,
            eventStepItems: Array.isArray(event.stepItems) ? event.stepItems.length : 0,
            eventIterationSteps: Array.isArray(event.iterationSteps) ? event.iterationSteps.length : 0,
            storedIterationSteps: Array.isArray(lastMessage.iterationSteps) ? lastMessage.iterationSteps.length : 0,
          });
        };
      const turnPromise = pluginAgent.handleUserTurn({
          userQuery: trimmed,
          panelState: current,
          context,
          adapter,
          signal: internals.activeTurnAbortController.signal,
          onStreamEvent: (event) => {
            touchTurnActivity?.();
            applyStreamEvent(event);
          },
        });

        const turn = await withActivityTimeout(turnPromise, "handleUserTurn", (touch) => {
          touchTurnActivity = touch;
          touch(); // start idle timer immediately
        }, () => {
          internals.activeTurnAbortController?.abort();
        });
        if (ENABLE_VERBOSE_RUNTIME_LOGS && typeof console !== "undefined") {
          console.log(`${LOG_PREFIX} sendChat.route`, { route: turn.route });
          console.log(`${LOG_PREFIX} sendChat.react.trace`, turn.result.executionTraces ?? []);
        }
        internals.pendingChatInput = undefined;
        if (internals.activeTurnId === turnId) {
          internals.activeTurnId = undefined;
        }
        internals.activeTurnAbortController = undefined;
        const finalState = await applyTurnResultToState({
          baseState: current,
          userMessages: nextMessages,
          requestedRoute: plan.route,
          finalRoute: turn.route,
          result: turn.result,
        });
        if (ENABLE_VERBOSE_RUNTIME_LOGS && typeof console !== "undefined") {
          console.log(`${LOG_PREFIX} sendChat.success`, { 
            route: turn.route,
            agentRunState: finalState.agentRunState,
            streaming: finalState.chatMessages?.some(m => m.role === "assistant" && m.streaming),
            messageCount: finalState.chatMessages?.length,
          });
        }
        streamStats.flush("before-final-commit");
        scheduleTurnCommit(true);
        streamStats.flush("after-final-commit");
        const committedState = commitState(internals, finalState, storage);
        if (ENABLE_VERBOSE_RUNTIME_LOGS && typeof console !== "undefined") {
          console.log(`${LOG_PREFIX} sendChat.committed`, {
            agentRunState: committedState.agentRunState,
            version: committedState.__stateVersion,
          });
        }
        return committedState;
      } catch (error) {
        if (internals.activeTurnId === turnId) {
          internals.activeTurnId = undefined;
        }
        internals.activeTurnAbortController = undefined;
        if (isCancelledError(error)) {
          internals.pendingChatInput = undefined;
          current.agentRunState = "idle";
          current.agentRunDetail = "已停止当前任务";
          current.summary = "已停止当前任务。";
          current.chatMessages = replaceTrailingPendingAssistant(
            nextMessages,
            pluginAgent.buildStatusMessages({
              title: "已停止",
              content: "已停止当前任务。",
              tone: "warning",
            })
          );
          current.nextActions = buildNextActions(current);
          return commitState(internals, current, storage);
        }
        if (error instanceof HttpError && error.status === 401) {
          const unauthorizedState = internals.currentState ?? current;
          unauthorizedState.agentRunState = "failed";
          unauthorizedState.agentRunDetail = "登录失效";
          unauthorizedState.summary = "登录已失效，请重新登录";
          unauthorizedState.chatMessages = replaceTrailingPendingAssistant(
            nextMessages,
            pluginAgent.buildStatusMessages({
              title: "处理失败",
              content: unauthorizedState.summary,
              tone: "warning",
              actions: [
                {
                  label: "去登录",
                  action: "login",
                },
              ],
            })
          );
          unauthorizedState.toast = {
            id: Date.now(),
            message: "登录已失效，请重新登录",
          };
          unauthorizedState.nextActions = buildNextActions(unauthorizedState);
          return commitState(internals, unauthorizedState, storage);
        }
        if (typeof console !== "undefined") {
          console.error(`${LOG_PREFIX} sendChat.failed`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        internals.pendingChatInput = undefined;
        current.agentRunState = "failed";
        current.agentRunDetail = error instanceof Error ? error.message : String(error);
        current.summary = `对话处理失败：${error instanceof Error ? error.message : String(error)}`;
        current.toast = {
          id: Date.now(),
          message: current.summary,
        };
        current.chatMessages = replaceTrailingPendingAssistant(
          nextMessages,
          pluginAgent.buildStatusMessages({
            title: "处理失败",
            content: current.summary,
            tone: "warning",
          })
        );
        return commitState(internals, current, storage);
      }
    },
    stopCurrentTurn: async (): Promise<MainPanelState> => {
      const state = internals.currentState ?? (await openIdlePanelState());
      if (
        !shouldStopRunningTurnFromComposer({
          activeTurnId: internals.activeTurnId,
          agentRunState: state.agentRunState,
        })
      ) {
        return state;
      }

      internals.activeTurnId = undefined;
      internals.pendingChatInput = undefined;
      internals.activeTurnAbortController?.abort();
      internals.activeTurnAbortController = undefined;

      state.agentRunState = "idle";
      state.agentRunDetail = "已停止当前任务";
      state.summary = "已停止当前任务。";

      const messages = sanitizeChatMessages(state.chatMessages);
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role === "assistant" && lastMessage.streaming) {
        lastMessage.streaming = false;
        lastMessage.title = "已停止";
        lastMessage.content = "已停止当前任务。";
        lastMessage.tone = "warning";
      } else {
        messages.push({
          role: "assistant",
          title: "已停止",
          content: "已停止当前任务。",
          tone: "warning",
        });
      }
      state.chatMessages = messages;
      state.nextActions = buildNextActions(state);
      return commitState(internals, state, storage);
    },
    applyDraftPlan: async (): Promise<MainPanelState> => {
      return applyCurrentDraftPlan();
    },
    applyPatchDraftPlan: async (): Promise<MainPanelState> => {
      return applyCurrentDraftPatchPlan();
    },
    openDevicePicker: async (): Promise<MainPanelState> => {
      const state = internals.currentState ?? (await computeAnalysisState());
      const draftPlan = internals.draftPlan ?? state.draftPlan;
      internals.draftPlan = draftPlan;
      state.devicePicker = {
        ...(buildDevicePickerState(draftPlan, state.devicePicker) ?? { open: true, items: [] }),
        open: true,
      };
      return commitState(internals, state, storage);
    },
    closeDevicePicker: async (): Promise<MainPanelState> => {
      internals.devicePickerCloseVersion = (internals.devicePickerCloseVersion ?? 0) + 1;
      const state = internals.currentState ?? (await computeAnalysisState());
      if (state.devicePicker) {
        state.devicePicker = { ...state.devicePicker, open: false };
      }
      return commitState(internals, state, storage);
    },
    setDraftDeviceManualQueryExpanded: async (input: {
      componentId: string;
      expanded: boolean;
    }): Promise<MainPanelState> => {
      const state = internals.currentState ?? (await computeAnalysisState());
      state.devicePicker = updateDevicePickerManualQueryState(state.devicePicker, {
        componentId: input.componentId,
        manualQueryExpanded: input.expanded,
      });
      return commitState(internals, state, storage);
    },
    setDraftDeviceManualQueryDraft: async (input: { componentId: string; draft: string }): Promise<MainPanelState> => {
      const state = internals.currentState ?? (await computeAnalysisState());
      state.devicePicker = updateDevicePickerManualQueryState(state.devicePicker, {
        componentId: input.componentId,
        manualQueryDraft: input.draft,
      });
      return commitState(internals, state, storage);
    },
    searchDraftDeviceCandidates: async (componentId: string, manualQuery?: string): Promise<MainPanelState> => {
      const state = internals.currentState ?? (await computeAnalysisState());
      if (typeof manualQuery === "string") {
        state.devicePicker = updateDevicePickerManualQueryState(state.devicePicker, {
          componentId,
          manualQueryExpanded: true,
          manualQueryDraft: manualQuery,
        });
      }
      await searchDraftDeviceCandidatesInternal(state, componentId, manualQuery);
      return commitState(internals, state, storage);
    },
    searchAllUnresolvedDraftDeviceCandidates: async (): Promise<MainPanelState> => {
      const state = internals.currentState ?? (await computeAnalysisState());
      const unresolvedItems = (state.devicePicker?.items ?? buildDevicePickerState(internals.draftPlan)?.items ?? []).filter(
        (item) => item.status === "unresolved"
      );
      if (unresolvedItems.length === 0) {
        state.summary = "当前没有待确认器件。";
        state.toast = { id: Date.now(), message: state.summary };
        return commitState(internals, state, storage);
      }
      let updatedCount = 0;
      for (let index = 0; index < unresolvedItems.length; index += 1) {
        const item = unresolvedItems[index]!;
        state.summary = buildDevicePickerSearchProgressText(index + 1, unresolvedItems.length);
        commitState(internals, state, storage);
        const result = await searchDraftDeviceCandidatesInternal(state, item.componentId);
        if (result.updated) {
          updatedCount += 1;
        }
      }
      const remaining = state.devicePicker?.items.filter((item) => item.status === "unresolved").length ?? 0;
      state.summary = `已完成待确认器件候选搜索：${updatedCount}/${unresolvedItems.length}，剩余待确认 ${remaining}。`;
      state.toast = { id: Date.now(), message: state.summary };
      return commitState(internals, state, storage);
    },
    chooseDraftDeviceCandidate: async (input: { componentId: string; candidateIndex: number }): Promise<MainPanelState> => {
      const state = internals.currentState ?? (await computeAnalysisState());
      const closeVersion = internals.devicePickerCloseVersion ?? 0;
      chooseDraftDeviceCandidateInternal(state, input);
      await enrichCurrentDraftPlanFromLibrary(state);
      const remainingUnresolved = hasUnresolvedDraftDevices(internals.draftPlan);
      state.summary = remainingUnresolved ? "已更新草案器件选择，请继续完成剩余器件确认。" : "器件已全部确认，可以应用草案。";
      refreshDraftMessageActionsAfterDeviceSelection(state, remainingUnresolved);
      if ((internals.devicePickerCloseVersion ?? 0) !== closeVersion && state.devicePicker) {
        state.devicePicker = { ...state.devicePicker, open: false };
      }
      return commitState(internals, state, storage);
    },
    chooseBestDraftDeviceCandidates: async (): Promise<MainPanelState> => {
      const state = internals.currentState ?? (await computeAnalysisState());
      const unresolvedItems = (state.devicePicker?.items ?? buildDevicePickerState(internals.draftPlan)?.items ?? []).filter(
        (item) => item.status === "unresolved"
      );
      if (unresolvedItems.length === 0) {
        state.summary = "当前没有待确认器件。";
        state.toast = { id: Date.now(), message: state.summary };
        return commitState(internals, state, storage);
      }
      let appliedCount = 0;
      let skippedCount = 0;
      let searchedCount = 0;
      for (let index = 0; index < unresolvedItems.length; index += 1) {
        const item = unresolvedItems[index]!;
        state.summary = buildDevicePickerApplyProgressText(index + 1, unresolvedItems.length);
        commitState(internals, state, storage);
        let pickerItem = state.devicePicker?.items.find((entry) => entry.componentId === item.componentId);
        if (!pickerItem?.candidates || pickerItem.candidates.length === 0) {
          const searchResult = await searchDraftDeviceCandidatesInternal(state, item.componentId);
          if (searchResult.updated) {
            searchedCount += 1;
          }
          pickerItem = state.devicePicker?.items.find((entry) => entry.componentId === item.componentId);
          if (!pickerItem?.candidates || pickerItem.candidates.length === 0) {
            skippedCount += 1;
            continue;
          }
        }
        chooseDraftDeviceCandidateInternal(state, {
          componentId: item.componentId,
          candidateIndex: 0,
        });
        await enrichCurrentDraftPlanFromLibrary(state);
        appliedCount += 1;
      }
      const remaining = state.devicePicker?.items.filter((item) => item.status === "unresolved").length ?? 0;
      state.summary = `已批量确认器件：成功 ${appliedCount}，跳过 ${skippedCount}，补充搜索 ${searchedCount}，剩余待确认 ${remaining}。`;
      state.toast = { id: Date.now(), message: state.summary };
      return commitState(internals, state, storage);
    },
    rollbackLastApply: async (): Promise<MainPanelState> => {
      const state = internals.currentState ?? (await computeAnalysisState());
      if (!internals.lastApplyTransactionId) {
        state.agentRunState = "failed";
        state.agentRunDetail = "没有可回滚事务";
        state.summary = "没有可回滚的应用事务。";
        state.toast = {
          id: Date.now(),
          message: state.summary,
        };
        return commitState(internals, state, storage);
      }
      const adapter = createEditorAdapter(resolveRuntimeChannel());
      try {
        const result = await adapter.rollbackApplyPlan(internals.lastApplyTransactionId);
        if (result.rolledBack) {
          internals.lastApplyTransactionId = undefined;
      state.appliedDraftSnapshot = undefined;
      state.draftObjectBindings = undefined;
      state.draftPatchPlan = undefined;
      internals.draftPatchPreviewFingerprint = undefined;
        }
        state.agentRunState = "completed";
        state.agentRunDetail = result.rolledBack ? "已回滚最近一次草案应用" : "回滚未生效";
        state.summary = result.rolledBack ? "已回滚最近一次草案应用。" : "回滚未生效。";
        state.chatMessages = appendAssistantMessages(
          sanitizeChatMessages(state.chatMessages),
          pluginAgent.buildRollbackMessages(state.summary)
        );
      } catch (error) {
        state.agentRunState = "failed";
        state.agentRunDetail = error instanceof Error ? error.message : String(error);
        state.summary = `回滚失败：${error instanceof Error ? error.message : String(error)}`;
        state.chatMessages = appendAssistantMessages(
          sanitizeChatMessages(state.chatMessages),
          pluginAgent.buildStatusMessages({
            title: "回滚失败",
            content: state.summary,
            tone: "warning",
          })
        );
        state.toast = {
          id: Date.now(),
          message: state.summary,
        };
      }
      state.nextActions = buildNextActions(state);
      return commitState(internals, state, storage);
    },
    saveCustomLlmConfig: async (input): Promise<MainPanelState> => {
      const state = internals.currentState ?? (await computeAnalysisState());
      try {
        await customLlmConfigStore.set({
          provider: input.provider.trim(),
          baseUrl: input.baseUrl.trim(),
          apiKey: input.apiKey.trim(),
          model: input.model.trim(),
          preferredOutputLanguage: (input.preferredOutputLanguage || DEFAULT_PREFERRED_OUTPUT_LANGUAGE).trim() || DEFAULT_PREFERRED_OUTPUT_LANGUAGE,
        });
        await fillSettingsState(state, sessionStore, authClient, creditsClient, customLlmConfigStore, llmModeStore);
        applyCustomLlmConfigSavedState(state, Date.now());
      } catch (error) {
        state.summary = `保存 LLM 配置失败：${error instanceof Error ? error.message : String(error)}`;
        state.toast = {
          id: Date.now(),
          message: state.summary,
        };
      }
      state.nextActions = buildNextActions(state);
      return commitState(internals, state, storage);
    },
    setLlmMode: async (input): Promise<MainPanelState> => {
      const state = internals.currentState ?? (await computeAnalysisState());
      await llmModeStore.set(input.mode);
      await fillSettingsState(state, sessionStore, authClient, creditsClient, customLlmConfigStore, llmModeStore);
      state.summary =
        input.mode === "proxy"
          ? "已切换为 LLM 服务器转发（需要登录）。"
          : "已切换为自定义 LLM（无需登录）。";
      state.nextActions = buildNextActions(state);
      return commitState(internals, state, storage);
    },
    listSessionHistory: async (): Promise<SessionHistoryEntry[]> => {
      return readSessionHistoryIndex(storage);
    },
    restoreSession: async (sessionId: string): Promise<MainPanelState> => {
      const restored = await readSessionState(storage, sessionId);
      if (!restored) {
        const state = internals.currentState ?? (await openIdlePanelState());
        state.toast = {
          id: Date.now(),
          message: "未找到对应历史会话。",
        };
        return commitState(internals, state, storage);
      }
      internals.sessionId = sessionId;
      internals.draftPlan = restored.draftPlan;
      internals.issueItems = (restored.issueItems ?? []).map((item) => ({
        objectId: item.objectId,
        objectType: item.objectType as IssueObjectType | undefined,
      }));
      await fillSettingsState(restored, sessionStore, authClient, creditsClient, customLlmConfigStore, llmModeStore);
      restored.agentRunState =
        restored.agentRunState === "planning" ||
        restored.agentRunState === "running_tools" ||
        restored.agentRunState === "waiting_llm"
          ? "idle"
          : restored.agentRunState;
      restored.agentRunDetail = "已恢复历史会话";
      restored.summary = restored.summary || "已恢复历史会话。";
      restored.nextActions = buildNextActions(restored);
      return commitState(internals, restored, storage);
    },
    syncState: async (): Promise<MainPanelState> => {
      if (!internals.currentState) {
        return computeAnalysisState();
      }
      return attachStateVersion(internals.currentState, internals.stateVersion);
    },
    getLastState: () => internals.currentState,
  };

  async function generateDraftState(prompt: string): Promise<MainPanelState> {
    const state = internals.currentState ?? (await computeAnalysisState());
    const channel = resolveRuntimeChannel();
    const adapter = createEditorAdapter(channel);
    try {
      const context = await buildSchematicContext(adapter);
      const result = await pluginAgent.run({
        type: "schematic_draft",
        userQuery: prompt,
        context,
        adapter,
      });
      if (typeof console !== "undefined") {
        console.log(`${LOG_PREFIX} draft.react.trace`, result.executionTraces ?? []);
      }
      if (result.draftPreview) {
        state.agentRunState = "awaiting_confirmation";
        state.agentRunRoute = "draft";
        state.agentRunDetail = result.summary;
        internals.draftPlan = result.draftPlan;
        internals.draftBlocked = result.draftRisk?.level === "blocked";
        syncDraftPreviewState(state, result.draftPlan);
        state.summary = `草案已生成：${result.draftPreview.title}，共 ${result.draftPreview.componentCount} 个器件，${result.draftPreview.netCount} 条网络。`;
        state.chatMessages = pluginAgent.buildDraftMessages({
          draftPreview: state.draftPreview,
          mcpResources: result.mcpResources,
          mcpResourceReads: result.mcpResourceReads,
           toolTraces: result.toolTraces,
           executionTraces: result.executionTraces,
           reactEvents: result.reactEvents,
           stepItems: result.stepItems,
           iterationSteps: result.iterationSteps,
           stepStates: result.stepStates,
           workingMemory: result.workingMemory,
           draftRisk: result.draftRisk,
          nextSuggestions: result.nextSuggestions,
          structuredSuggestions: result.structuredSuggestions,
        });
      } else {
        state.agentRunState = "completed";
        state.agentRunRoute = "draft";
        state.agentRunDetail = "草案未返回预览";
        state.summary = "草案生成完成，但未返回预览信息。";
        state.chatMessages = pluginAgent.buildStatusMessages({ content: state.summary, tone: "warning" });
      }
    } catch (error) {
      state.agentRunState = "failed";
      state.agentRunRoute = "draft";
      state.agentRunDetail = error instanceof Error ? error.message : String(error);
      state.summary = `草案生成失败：${error instanceof Error ? error.message : String(error)}`;
      state.chatMessages = pluginAgent.buildStatusMessages({ content: state.summary, tone: "warning" });
    }

    state.nextActions = buildNextActions(state);
    return commitState(internals, state, storage);
  }

async function generateDraftStateFromResult(
  result: Awaited<ReturnType<typeof pluginAgent.run>>,
  _previousMessages: NonNullable<MainPanelState["chatMessages"]>
): Promise<MainPanelState> {
  const state = internals.currentState ?? (await computeAnalysisState());
  if (result.draftPreview) {
      internals.draftPlan = result.draftPlan;
      syncDraftPreviewState(state, result.draftPlan);
      state.summary = `草案已生成：${result.draftPreview.title}，共 ${result.draftPreview.componentCount} 个器件，${result.draftPreview.netCount} 条网络。`;
      state.chatMessages = pluginAgent.buildDraftMessages({
        draftPreview: state.draftPreview,
        draftNarrative: shouldUseDraftReplyLeadNarrative(result),
        mcpResources: result.mcpResources,
        mcpResourceReads: result.mcpResourceReads,
        toolTraces: result.toolTraces,
        executionTraces: result.executionTraces,
        uiEvents: result.uiEvents,
        reactEvents: result.reactEvents,
        stepItems: result.stepItems,
        iterationSteps: result.iterationSteps,
        stepStates: result.stepStates,
        workingMemory: result.workingMemory,
        draftRisk: result.draftRisk,
      });
    } else {
      state.agentRunState = "completed";
      state.agentRunRoute = "draft";
      state.agentRunDetail = "草案未返回预览";
      state.summary = "草案生成完成，但未返回预览信息。";
      state.chatMessages = pluginAgent.buildStatusMessages({ content: state.summary, tone: "warning" });
    }
    state.nextActions = buildNextActions(state);
    return state;
  }

  async function applyTurnResultToState(input: {
    baseState: MainPanelState;
    userMessages: NonNullable<MainPanelState["chatMessages"]>;
    requestedRoute: "chat" | "analysis" | "draft" | "modify";
    finalRoute: "chat" | "analysis" | "draft" | "modify";
    result: Awaited<ReturnType<typeof pluginAgent.run>>;
  }): Promise<MainPanelState> {
    if (input.finalRoute === "chat") {
      const nextState = input.baseState;
      nextState.agentRunRoute = "chat";
      nextState.agentRunState = "completed";
      nextState.agentRunDetail = input.result.summary;
      nextState.summary = "已完成一次自然对话回复。";
      nextState.chatMessages = replaceTrailingPendingAssistant(input.userMessages, pluginAgent.buildNaturalChatMessage(input.result));
      nextState.nextActions = buildNextActions(nextState);
      return nextState;
    }

    if (input.finalRoute === "draft") {
      const drafted = await generateDraftStateFromResult(input.result, input.userMessages);
      drafted.agentRunRoute = "draft";
      drafted.agentRunState = input.result.draftPreview ? "awaiting_confirmation" : "completed";
      drafted.agentRunDetail = input.result.summary;
      drafted.chatMessages = finalizeDraftTurnMessages(input.userMessages, drafted.chatMessages ?? []);
      drafted.nextActions = buildNextActions(drafted);
      return drafted;
    }

    if (input.finalRoute === "modify") {
      const modified = input.baseState;
      modified.agentRunRoute = "modify";
      modified.agentRunState = "completed";
      modified.agentRunDetail = input.result.summary;
      modified.summary = input.result.summary || "已完成当前原理图修改方案整理。";
      modified.chatMessages = replaceTrailingPendingAssistant(
        input.userMessages,
        pluginAgent.buildStatusMessages({
          title: "修改方案",
          tone: "warning",
          content: input.result.analysisMarkdown || input.result.summary || "已基于当前原理图整理修改建议。",
        })
      );
      modified.nextActions = buildNextActions(modified);
      return modified;
    }

    // Analysis route: 直接更新最后一条streaming消息，而不是删除重建
    const analyzed = await buildAnalysisStateFromTurnResult(input.baseState, input.result);
    const replannedFromDraft =
      input.requestedRoute === "draft";
    analyzed.agentRunRoute = "analysis";
    analyzed.agentRunState = "completed";
    analyzed.agentRunDetail = replannedFromDraft ? `draft blocked -> analysis: ${input.result.summary}` : input.result.summary;
    
    // 检查最后一条消息是否是streaming的assistant消息
    const lastMessage = input.userMessages[input.userMessages.length - 1];
    if (lastMessage?.role === "assistant" && lastMessage.streaming) {
      // 直接更新最后一条消息，保留reactEvents和stepStates
        const newMessages = pluginAgent.buildAnalysisMessages({
          issueCount: analyzed.issueCount ?? 0,
          topIssueTitle: analyzed.topIssueTitle,
          locateStatus: analyzed.locateStatus,
          locateLabel: input.result.locateLabel,
          analysisReport: input.result.analysisReport,
          analysisMarkdown: input.result.analysisMarkdown,
          libraryInsights: input.result.libraryInsights,
        issueItems: analyzed.issueItems,
        mcpResources: input.result.mcpResources,
        mcpResourceReads: input.result.mcpResourceReads,
        toolTraces: input.result.toolTraces,
        executionTraces: input.result.executionTraces,
        uiEvents: input.result.uiEvents,
        reactEvents: input.result.reactEvents,
        stepItems: input.result.stepItems,
        iterationSteps: input.result.iterationSteps,
        stepStates: input.result.stepStates,
        workingMemory: input.result.workingMemory,
        nextSuggestions: input.result.nextSuggestions,
        structuredSuggestions: input.result.structuredSuggestions,
      });
      
      if (newMessages.length > 0) {
        const newMessage = newMessages[0];
        const mergedMessage = mergeAssistantFinalMessage(lastMessage, newMessage);
        
        if (typeof console !== "undefined") {
          console.log(`${LOG_PREFIX} applyTurnResultToState.update-in-place`, {
            hasReactEvents: Boolean(mergedMessage.reactEvents),
            reactEventsCount: mergedMessage.reactEvents?.length ?? 0,
            hasStepStates: Boolean(mergedMessage.stepStates),
            stepStatesCount: mergedMessage.stepStates?.length ?? 0,
          });
        }

        analyzed.chatMessages = [
          ...input.userMessages.slice(0, -1),
          ...(replannedFromDraft
            ? pluginAgent.buildStatusMessages({
                title: "自动重规划",
                tone: "warning",
                content: "草案因高风险问题被阻断，已自动切换到分析模式。",
              })
            : []),
          mergedMessage,
        ];
      } else {
        analyzed.chatMessages = [
          ...input.userMessages.slice(0, -1),
          ...(replannedFromDraft
            ? pluginAgent.buildStatusMessages({
                title: "自动重规划",
                tone: "warning",
                content: "草案因高风险问题被阻断，已自动切换到分析模式。",
              })
            : []),
          {
            ...lastMessage,
            streaming: false,
          },
        ];
      }
    } else {
      // 没有streaming消息，使用原来的逻辑
      analyzed.chatMessages = replaceTrailingPendingAssistant(input.userMessages, [
        ...(replannedFromDraft
          ? pluginAgent.buildStatusMessages({
              title: "自动重规划",
              tone: "warning",
              content: "草案因高风险问题被阻断，已自动切换到分析模式。",
            })
          : []),
        ...(analyzed.chatMessages ?? []),
      ]);
    }
    
    analyzed.nextActions = buildNextActions(analyzed);
    return analyzed;
  }

  async function computeAnalysisStateFromResult(
    result: Awaited<ReturnType<typeof pluginAgent.run>>
  ): Promise<MainPanelState> {
    const state = await buildBaseState();
    state.channel = result.contextDigest?.channel;
    state.componentCount = result.contextDigest?.componentCount;
    state.netCount = result.contextDigest?.netCount;
    state.selectionCount = result.contextDigest?.selectionCount;
    state.issueCount = result.checkResult?.issues.length;
    state.topIssueTitle = result.checkResult?.issues[0]?.title;
    state.locateStatus = result.locateResult?.located
      ? `${result.locateResult.objectType}:${result.locateResult.objectId}`
      : "none";
    state.issueItems =
      result.checkResult?.issues.slice(0, 6).map((issue) => ({
        title: issue.title,
        severity: issue.severity,
        objectId: issue.objectId,
        objectType: normalizeIssueObjectType(issue.objectType),
      })) ?? [];
    state.agentRunState = "completed";
    state.agentRunRoute = "analysis";
    state.agentRunDetail = result.summary;
    state.summary = result.summary;
    state.chatMessages = pluginAgent.buildAnalysisMessages({
      issueCount: state.issueCount ?? 0,
      topIssueTitle: state.topIssueTitle,
      locateStatus: state.locateStatus,
      locateLabel: result.locateLabel,
      analysisReport: result.analysisReport,
      analysisMarkdown: result.analysisMarkdown,
      libraryInsights: result.libraryInsights,
      issueItems: state.issueItems,
      mcpResources: result.mcpResources,
      mcpResourceReads: result.mcpResourceReads,
      toolTraces: result.toolTraces,
      executionTraces: result.executionTraces,
      uiEvents: result.uiEvents,
      reactEvents: result.reactEvents,
      stepItems: result.stepItems,
      iterationSteps: result.iterationSteps,
      stepStates: result.stepStates,
      workingMemory: result.workingMemory,
      nextSuggestions: result.nextSuggestions,
      structuredSuggestions: result.structuredSuggestions,
    });
    state.nextActions = buildNextActions(state);
    return state;
  }

  async function buildAnalysisStateFromTurnResult(
    baseState: MainPanelState,
    result: Awaited<ReturnType<typeof pluginAgent.run>>
  ): Promise<MainPanelState> {
    const state = baseState;
    state.channel = result.contextDigest?.channel;
    state.componentCount = result.contextDigest?.componentCount;
    state.netCount = result.contextDigest?.netCount;
    state.selectionCount = result.contextDigest?.selectionCount;
    state.issueCount = result.checkResult?.issues.length;
    state.topIssueTitle = result.checkResult?.issues[0]?.title;
    state.locateStatus = result.locateResult?.located
      ? `${result.locateResult.objectType}:${result.locateResult.objectId}`
      : "none";
    state.issueItems =
      result.checkResult?.issues.slice(0, 6).map((issue) => ({
        title: issue.title,
        severity: issue.severity,
        objectId: issue.objectId,
        objectType: normalizeIssueObjectType(issue.objectType),
      })) ?? [];
    state.summary = result.summary;
    state.chatMessages = pluginAgent.buildAnalysisMessages({
      issueCount: state.issueCount ?? 0,
      topIssueTitle: state.topIssueTitle,
      locateStatus: state.locateStatus,
      locateLabel: result.locateLabel,
      analysisReport: result.analysisReport,
      analysisMarkdown: result.analysisMarkdown,
      libraryInsights: result.libraryInsights,
      issueItems: state.issueItems,
      mcpResources: result.mcpResources,
      mcpResourceReads: result.mcpResourceReads,
      toolTraces: result.toolTraces,
      executionTraces: result.executionTraces,
      uiEvents: result.uiEvents,
      reactEvents: result.reactEvents,
      stepItems: result.stepItems,
      iterationSteps: result.iterationSteps,
      stepStates: result.stepStates,
      workingMemory: result.workingMemory,
      nextSuggestions: result.nextSuggestions,
      structuredSuggestions: result.structuredSuggestions,
    });
    return state;
  }

}

function commitState(
  internals: RuntimeInternals,
  state: MainPanelState,
  storage?: LocalStorageKeyValueStore
): MainPanelState {
  const perfStart = isPerfDebugEnabled() ? getPerfNow() : 0;
  const isRunning =
    state.agentRunState === "planning" ||
    state.agentRunState === "running_tools" ||
    state.agentRunState === "waiting_llm";
  // When a turn ends, make sure no assistant message is left in streaming state.
  // Otherwise the iframe will keep showing "Working/处理中".
  if (!isRunning && Array.isArray(state.chatMessages)) {
    let clearedCount = 0;
    state.chatMessages.forEach((msg) => {
      if (msg && msg.role === "assistant" && msg.streaming) {
        msg.streaming = false;
        clearedCount++;
      }
    });
    if (typeof console !== "undefined" && clearedCount > 0) {
      console.log(`${LOG_PREFIX} commitState.clearStreaming`, {
        clearedCount,
        isRunning,
        agentRunState: state.agentRunState,
      });
    }
  }

  internals.stateVersion += 1;
  const nextState = attachStateVersion(state, internals.stateVersion);
  internals.currentState = nextState;
  // Ensure iframe UI can always read the latest state even if some event listeners are missing.
  // The iframe page reads from this global variable.
  try {
    (globalThis as typeof globalThis & {
      __LCEDA_AI_ASSISTANT_FRAME_STATE__?: MainPanelState;
      __LCEDA_AI_ASSISTANT_FRAME_SYNC_STATE__?: (state: MainPanelState) => void;
    }).__LCEDA_AI_ASSISTANT_FRAME_STATE__ = nextState;
    (globalThis as typeof globalThis & {
      __LCEDA_AI_ASSISTANT_FRAME_SYNC_STATE__?: (state: MainPanelState) => void;
    }).__LCEDA_AI_ASSISTANT_FRAME_SYNC_STATE__?.(nextState);
  } catch {
    // Ignore assignment failures in constrained runtimes.
  }
  if (storage) {
    // Persisting large streaming state snapshots is expensive and can stall the host UI.
    // While a turn is running, keep state in-memory + broadcast to iframe only; persist once when it settles.
    if (!isRunning) {
      schedulePersistPanelState(storage, nextState, true);
    }
  }
  if (ENABLE_VERBOSE_RUNTIME_LOGS && typeof console !== "undefined") {
    const running =
      nextState.agentRunState === "planning" ||
      nextState.agentRunState === "running_tools" ||
      nextState.agentRunState === "waiting_llm";
    const streamingCount = (nextState.chatMessages ?? []).filter((m) => m.role === "assistant" && m.streaming).length;
    console.log(`${LOG_PREFIX} state.commit`, {
      version: nextState.__stateVersion,
      agentRunState: nextState.agentRunState,
      running,
      messageCount: nextState.chatMessages?.length ?? 0,
      streamingCount,
      detail: nextState.agentRunDetail,
    });
  }
  if (isPerfDebugEnabled()) {
    const messages = nextState.chatMessages ?? [];
    const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
    logPerf("commitState", {
      durationMs: Number((getPerfNow() - perfStart).toFixed(2)),
      version: nextState.__stateVersion,
      agentRunState: nextState.agentRunState,
      messageCount: messages.length,
      contentLength: String(lastAssistant?.content || "").length,
      iterationSteps: Array.isArray(lastAssistant?.iterationSteps) ? lastAssistant.iterationSteps.length : 0,
      reactEvents: Array.isArray(lastAssistant?.reactEvents) ? lastAssistant.reactEvents.length : 0,
      stepItems: Array.isArray(lastAssistant?.stepItems) ? lastAssistant.stepItems.length : 0,
    });
  }
  return nextState;
}

function attachStateVersion(state: MainPanelState, stateVersion: number): MainPanelState {
  state.__stateVersion = stateVersion;
  return state;
}

function normalizeChatMessagesForPersistence(
  messages: MainPanelState["chatMessages"]
): NonNullable<MainPanelState["chatMessages"]> {
  return sanitizeChatMessages(messages).map((message) => ({
    ...normalizeProcessFields(message),
    streaming: false,
  }));
}

function sanitizeChatMessages(
  messages: MainPanelState["chatMessages"]
): NonNullable<MainPanelState["chatMessages"]> {
  return (messages ?? []).filter((message) => !(message as { __typing?: boolean }).__typing);
}

function appendDeviceSelectionStatusToDraftMessage(content: string | undefined, status: string): string {
  const base = String(content || "").trimEnd();
  const cleanStatus = String(status || "").trim();
  if (!cleanStatus) {
    return base;
  }
  const statusBlock = `\n\n## 器件确认状态\n${cleanStatus}`;
  if (/##\s*器件确认状态/u.test(base)) {
    return base.replace(/\n\n##\s*器件确认状态\n[\s\S]*$/u, statusBlock);
  }
  return `${base}${statusBlock}`;
}

function stripInitialWelcomeMessages(
  messages: NonNullable<MainPanelState["chatMessages"]>
): NonNullable<MainPanelState["chatMessages"]> {
  return messages;
}

export function stripFinalControlLikeText(text: string | undefined): string {
  const raw = String(text || "");
  if (!raw) return "";
  if (
    raw.length < 64 &&
    !raw.includes("{") &&
    !raw.includes("`") &&
    !/final|type/i.test(raw)
  ) {
    return raw;
  }
  const patterns = [
    /([\s\S]*?)(?:\n|\r|^)\s*```(?:json)?\s*$/u,
    /([\s\S]*?)(?:\n|\r|^)\s*```json\s*(?:\n|\r)/u,
    /([\s\S]*?)(?:\n|\r|^)\s*Final:\s*$/u,
    /([\s\S]*?)(?:\n|\r|^)\s*Final:\s*\{/u,
    /([\s\S]*?)(?:\n|\r|^)\s*\{\s*"type"\s*:\s*"final"/u,
    /([\s\S]*?)(?:\n|\r|^)\s*\{\s*"type"\s*:\s*"f(?:i(?:n(?:a(?:l?)?)?)?)?$/u,
    /([\s\S]*?)(?:\n|\r|^)\s*\{\s*"type"\s*:\s*$/u,
    /([\s\S]*?)(?:\n|\r|^)\s*\{\s*"type"\s*$/u,
    /([\s\S]*?)(?:\n|\r|^)\s*\{\s*"type"$/u,
    /([\s\S]*?)(?:\n|\r|^)\s*"type"\s*:\s*"final"$/u,
    /([\s\S]*?)(?:\n|\r|^)\s*"type"\s*:\s*"f(?:i(?:n(?:a(?:l?)?)?)?)?$/u,
    /([\s\S]*?)(?:\n|\r|^)\s*"type"\s*:\s*$/u,
    /([\s\S]*?)(?:\n|\r|^)\s*"type"\s*$/u,
    /([\s\S]*?)(?:\n|\r|^)\s*"type"$/u,
    /([\s\S]*?)(?:\n|\r|^)\s*:\s*"final"$/u,
    /([\s\S]*?)(?:\n|\r|^)\s*:\s*"f(?:i(?:n(?:a(?:l?)?)?)?)?$/u,
    /([\s\S]*?)(?:\n|\r|^)\s*```\s*$/u,
    /([\s\S]*?)(?:\n|\r|^)\s*``$/u,
    /([\s\S]*?)(?:\n|\r|^)\s*`$/u,
    /([\s\S]*?)(?:\n|\r|^)\s*\{$/u,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) {
      return (match[1] ?? "").trimEnd();
    }
  }
  return raw;
}

function sanitizeReactEventsForUi(
  reactEvents: NonNullable<MainPanelState["chatMessages"]>[number]["reactEvents"]
): NonNullable<MainPanelState["chatMessages"]>[number]["reactEvents"] {
  if (!Array.isArray(reactEvents)) {
    return reactEvents;
  }
  return reactEvents.map((event) =>
    event && event.kind === "thought"
      ? {
          ...event,
          text: stripFinalControlLikeText(event.text),
        }
      : event
  );
}

function convertReactEventsToStepItems(
  reactEvents?: NonNullable<MainPanelState["chatMessages"]>[number]["reactEvents"]
): NonNullable<MainPanelState["chatMessages"]>[number]["stepItems"] | undefined {
  if (!Array.isArray(reactEvents) || reactEvents.length === 0) {
    return undefined;
  }
  const stepItems: NonNullable<MainPanelState["chatMessages"]>[number]["stepItems"] = reactEvents
    .map((event, index) => {
      if (!event || event.kind === "final") {
        return undefined;
      }
      const type = event.kind;
      const phase = event.stepKind ?? "system";
      const title = String(event.label || event.toolName || type).trim() || type;
      const text = stripFinalControlLikeText(event.text) || "";
      return {
        id: `legacy-react-${index}-${type}`,
        phase,
        type,
        status: event.status,
        title,
        text,
        toolName: event.toolName,
        inputSummary: event.inputSummary,
        outputSummary: event.outputSummary,
      };
    })
    .filter((item): item is NonNullable<typeof stepItems>[number] => Boolean(item));
  return stepItems.length > 0 ? stepItems : [];
}

function buildIterationStepsFromStepItems(
  stepItems?: NonNullable<MainPanelState["chatMessages"]>[number]["stepItems"]
): NonNullable<MainPanelState["chatMessages"]>[number]["iterationSteps"] | undefined {
  if (!Array.isArray(stepItems) || stepItems.length === 0) {
    return undefined;
  }
  const grouped = new Map<
    number,
    {
      iteration: number;
      thought?: MessageStepItem;
      toolCalls: MessageStepItem[];
      observations: MessageStepItem[];
    }
  >();

  stepItems.forEach((item) => {
    if (!item) return;
    const id = String(item.id || "");
    const match = id.match(/^react-(?:task|thought|tool-call|observation)-(\d+)/u);
    const iteration = match ? Number.parseInt(match[1] || "", 10) : Number.NaN;
    if (!Number.isFinite(iteration)) return;
    const bucket = grouped.get(iteration) ?? {
      iteration,
      thought: undefined,
      toolCalls: [],
      observations: [],
    };
    if (item.type === "thought") {
      bucket.thought = item;
    } else if (item.type === "tool_call") {
      bucket.toolCalls.push(item);
    } else if (item.type === "observation") {
      bucket.observations.push(item);
    }
    grouped.set(iteration, bucket);
  });

  const iterationSteps: NonNullable<MainPanelState["chatMessages"]>[number]["iterationSteps"] = Array.from(grouped.values())
    .sort((a, b) => a.iteration - b.iteration)
    .map((bucket) => ({
      id: bucket.thought?.id || `react-iteration-${bucket.iteration}`,
      iteration: bucket.iteration,
      status: bucket.thought?.status || bucket.toolCalls[bucket.toolCalls.length - 1]?.status || "pending",
      thoughtText: stripFinalControlLikeText(bucket.thought?.text || "").trim(),
      streaming: Boolean(bucket.thought?.streaming),
      toolEvents: bucket.toolCalls.map((item) => ({
        toolName: String(item.toolName || item.title || "").trim(),
        label: String(item.toolName || item.title || "").trim(),
        status: item.status,
      })),
      observationTexts: bucket.observations
        .map((item) => stripFinalControlLikeText(item.outputSummary || item.text || "").trim())
        .filter(Boolean),
    }))
    .filter((item) => item.thoughtText || item.toolEvents.length > 0 || item.observationTexts.length > 0);

  return iterationSteps.length > 0 ? iterationSteps : undefined;
}

function normalizeProcessFields(message: NonNullable<MainPanelState["chatMessages"]>[number]): NonNullable<MainPanelState["chatMessages"]>[number] {
  const reactEvents = Array.isArray(message.reactEvents) ? sanitizeReactEventsForUi(message.reactEvents) : undefined;
  const explicitStepItems = Array.isArray(message.stepItems) ? message.stepItems : undefined;
  const stepItems =
    Array.isArray(message.iterationSteps) && message.iterationSteps.length > 0
      ? explicitStepItems
      : explicitStepItems ?? convertReactEventsToStepItems(reactEvents);
  const iterationSteps =
    Array.isArray(message.iterationSteps) && message.iterationSteps.length > 0
      ? message.iterationSteps
      : buildIterationStepsFromStepItems(stepItems);
  const stepTranscript =
    Array.isArray(message.stepTranscript) && message.stepTranscript.length > 0
      ? message.stepTranscript
      : buildStepTranscriptFromStepItems(stepItems) ?? buildStepTranscriptFromReactEvents(reactEvents);
  return {
    ...message,
    reactEvents,
    stepItems,
    iterationSteps,
    stepTranscript,
  };
}

export function mergeStreamProcessFields(input: {
  lastMessage: NonNullable<MainPanelState["chatMessages"]>[number];
  stepItems?: NonNullable<MainPanelState["chatMessages"]>[number]["stepItems"];
  iterationSteps?: NonNullable<MainPanelState["chatMessages"]>[number]["iterationSteps"];
  reactEvents?: NonNullable<MainPanelState["chatMessages"]>[number]["reactEvents"];
  reasoningDelta?: string;
  text?: string;
}): void {
  const { lastMessage, stepItems, iterationSteps, reactEvents, reasoningDelta, text } = input;
  const limited = limitStreamProcessItems({
    stepItems,
    reactEvents: reactEvents !== undefined ? sanitizeReactEventsForUi(reactEvents) : undefined,
  });
  if (stepItems !== undefined) {
    lastMessage.stepItems = limited.stepItems;
  }
  if (reactEvents !== undefined) {
    lastMessage.reactEvents = limited.reactEvents;
  }
  if (iterationSteps !== undefined) {
    lastMessage.iterationSteps = limitStreamProcessItems({
      iterationSteps: mergeIterationStepsForStream(lastMessage.iterationSteps, iterationSteps),
    }).iterationSteps;
  }

  const currentSteps = Array.isArray(lastMessage.iterationSteps) ? lastMessage.iterationSteps : [];
  if (reasoningDelta && currentSteps.length > 0) {
    const activeStepKey =
      Array.isArray(iterationSteps) && iterationSteps.length > 0
        ? getIterationStepMergeKey(iterationSteps[iterationSteps.length - 1])
        : undefined;
    const activeStepIndex = activeStepKey
      ? currentSteps.findIndex((step) => getIterationStepMergeKey(step) === activeStepKey)
      : currentSteps.length - 1;
    lastMessage.iterationSteps = currentSteps.map((step, index) =>
      index === (activeStepIndex >= 0 ? activeStepIndex : currentSteps.length - 1)
        ? {
            ...step,
            thoughtText:
              iterationSteps !== undefined && String(step.thoughtText || "").trim()
                ? String(step.thoughtText || "").trim()
                : `${String(step.thoughtText || "")}${reasoningDelta}`.trim(),
            status: step.status === "done" ? "done" : "running",
            streaming: true,
          }
        : step
    );
    return;
  }

  if (!reasoningDelta && iterationSteps !== undefined && String(text || "").trim()) {
    const activeStepKey =
      Array.isArray(iterationSteps) && iterationSteps.length > 0
        ? getIterationStepMergeKey(iterationSteps[iterationSteps.length - 1])
        : undefined;
    const activeStepIndex = activeStepKey
      ? currentSteps.findIndex((step) => getIterationStepMergeKey(step) === activeStepKey)
      : currentSteps.length - 1;
    lastMessage.iterationSteps = currentSteps.map((step, index) =>
      index === (activeStepIndex >= 0 ? activeStepIndex : currentSteps.length - 1)
        ? {
            ...step,
            thoughtText: String(text || "").trim(),
            status: step.status === "done" ? "done" : "running",
            streaming: true,
          }
        : step
    );
  }
}

function createPendingAssistantMessage(route: "chat" | "analysis" | "draft" | "modify"): NonNullable<MainPanelState["chatMessages"]>[number] {
  return {
    role: "assistant",
    title: route === "chat" ? "助手" : route === "draft" ? "草案生成中" : route === "modify" ? "修改当前原理图中" : "分析中",
    // content 只用于最终流式报告/回复，进度与步骤展示由 reactEvents/stepStates 承载，避免污染最终输出。
    content: "",
    iterationSteps: [],
    streaming: true,
  };
}

function buildPendingAgentDetail(route: "chat" | "analysis" | "draft" | "modify"): string {
  if (route === "chat") {
    return "正在规划对话并等待模型回复";
  }
  if (route === "draft") {
    return "正在规划草案与执行规则校验";
  }
  return route === "modify" ? "正在基于当前原理图整理修改方案" : "正在收集上下文并执行分析";
}

function buildPendingAgentSummary(route: "chat" | "analysis" | "draft" | "modify"): string {
  if (route === "chat") {
    return "正在生成回复...";
  }
  if (route === "draft") {
    return "正在生成草案...";
  }
  return route === "modify" ? "正在修改当前原理图..." : "正在分析当前原理图...";
}

function replaceTrailingPendingAssistant(
  messages: NonNullable<MainPanelState["chatMessages"]>,
  replacements: MainPanelState["chatMessages"] extends Array<infer T> ? T | T[] : never
): NonNullable<MainPanelState["chatMessages"]> {
  const list = messages.slice();
  const last = list[list.length - 1];
  const normalized = Array.isArray(replacements) ? replacements : [replacements];
  
  if (last?.role === "assistant" && last.streaming) {
    // 保留streaming消息中的过程信息和状态信息
    const preservedStepItems = last.stepItems;
    const preservedIterationSteps = last.iterationSteps;
    const preservedReactEvents = last.reactEvents;
    const preservedStepStates = last.stepStates;
    const preservedWorkingMemory = last.workingMemory;
    
      if (ENABLE_VERBOSE_RUNTIME_LOGS && typeof console !== "undefined") {
        console.log(`${LOG_PREFIX} replaceTrailingPendingAssistant.preserve`, {
          hasReactEvents: Boolean(preservedReactEvents),
          reactEventsCount: preservedReactEvents?.length ?? 0,
        hasStepStates: Boolean(preservedStepStates),
        stepStatesCount: preservedStepStates?.length ?? 0,
      });
    }
    
    list.pop();
    
    // 将保留的数据合并到新消息中
      const mergedReplacements = normalized.map((msg, idx) => {
        if (idx === 0 && msg.role === "assistant") {
        const mergedStepItems = msg.stepItems === undefined ? preservedStepItems : msg.stepItems;
        const mergedIterationSteps = msg.iterationSteps === undefined ? preservedIterationSteps : msg.iterationSteps;
        const mergedReactEvents = preferDefinedArray(msg.reactEvents, preservedReactEvents);
        const normalizedProcess = normalizeProcessFields({
          ...msg,
          stepItems: mergedStepItems,
          iterationSteps: mergedIterationSteps,
          reactEvents: mergedReactEvents,
        });
        return {
          ...msg,
          stepItems: normalizedProcess.stepItems,
          iterationSteps: normalizedProcess.iterationSteps,
          reactEvents: normalizedProcess.reactEvents,
          stepTranscript: normalizedProcess.stepTranscript,
          stepStates: preferDefinedArray(msg.stepStates, preservedStepStates),
          workingMemory: msg.workingMemory || preservedWorkingMemory,
        };
      }
      return msg;
    });
    
    return [...list, ...mergedReplacements];
  }
  
  return [...list, ...normalized];
}

export function finalizeDraftTurnMessages(
  previousMessages: NonNullable<MainPanelState["chatMessages"]>,
  draftMessages: NonNullable<MainPanelState["chatMessages"]>
): NonNullable<MainPanelState["chatMessages"]> {
  return replaceTrailingPendingAssistant(previousMessages, draftMessages);
}

export function mergeAssistantFinalMessage(
  pendingMessage: NonNullable<MainPanelState["chatMessages"]>[number],
  finalMessage: NonNullable<MainPanelState["chatMessages"]>[number]
): NonNullable<MainPanelState["chatMessages"]>[number] {
  const normalizedPending = normalizeProcessFields(pendingMessage);
  const normalizedFinal = normalizeProcessFields(finalMessage);
  const preservedStepItems = normalizedPending.stepItems;
  const preservedIterationSteps = normalizedPending.iterationSteps;
  const preservedReactEvents = normalizedPending.reactEvents;
  const preservedStepStates = pendingMessage.stepStates;
  const preservedWorkingMemory = pendingMessage.workingMemory;

  const mergedStepItems = normalizedFinal.stepItems === undefined ? preservedStepItems : normalizedFinal.stepItems;
  const mergedIterationSteps =
    normalizedFinal.iterationSteps === undefined ? preservedIterationSteps : normalizedFinal.iterationSteps;
  const mergedReactEvents = preferDefinedArray(normalizedFinal.reactEvents, preservedReactEvents);
  const mergedProcess = normalizeProcessFields({
    ...normalizedFinal,
    stepItems: mergedStepItems,
    iterationSteps: mergedIterationSteps,
    reactEvents: mergedReactEvents,
  });
  return {
    ...normalizedFinal,
    role: "assistant",
    streaming: false,
    stepItems: mergedProcess.stepItems,
    iterationSteps: mergedProcess.iterationSteps,
    reactEvents: mergedProcess.reactEvents,
    stepTranscript: mergedProcess.stepTranscript ?? normalizedFinal.stepTranscript ?? normalizedPending.stepTranscript,
    stepStates: preferDefinedArray(normalizedFinal.stepStates, preservedStepStates),
    workingMemory: normalizedFinal.workingMemory || preservedWorkingMemory,
    toolTraces: normalizedFinal.toolTraces || pendingMessage.toolTraces,
    executionTraces: normalizedFinal.executionTraces || pendingMessage.executionTraces,
    uiEvents: normalizedFinal.uiEvents || pendingMessage.uiEvents,
  };
}

export function appendAssistantMessages(
  previousMessages: NonNullable<MainPanelState["chatMessages"]>,
  nextMessages: NonNullable<MainPanelState["chatMessages"]>
): NonNullable<MainPanelState["chatMessages"]> {
  return [...sanitizeChatMessages(previousMessages), ...nextMessages];
}

export function appendUserChatMessage(
  previousMessages: NonNullable<MainPanelState["chatMessages"]>,
  content: string
): NonNullable<MainPanelState["chatMessages"]> {
  return [
    ...sanitizeChatMessages(previousMessages),
    {
      role: "user",
      title: "你",
      content,
    },
  ];
}

function preferNonEmptyArray<T>(primary?: T[], fallback?: T[]): T[] | undefined {
  if (Array.isArray(primary) && primary.length > 0) {
    return primary;
  }
  if (Array.isArray(fallback) && fallback.length > 0) {
    return fallback;
  }
  return primary ?? fallback;
}

function preferDefinedArray<T>(primary?: T[], fallback?: T[]): T[] | undefined {
  return primary === undefined ? fallback : primary;
}

async function fillSettingsState(
  state: MainPanelState,
  sessionStore: PersistentSessionStore,
  authClient: AuthClient,
  creditsClient: CreditsClient,
  customLlmConfigStore: CustomLlmConfigStore,
  llmModeStore: LlmModeStore
): Promise<void> {
  state.loggedIn = false;
  state.userDisplayName = undefined;
  state.userEmail = undefined;
  state.creditsBalance = undefined;
  state.creditsCurrency = undefined;
  state.creditsTransactions = [];
  try {
    let session = await sessionStore.get();
    if (typeof console !== "undefined") {
      console.log(`${LOG_PREFIX} session.restore`, summarizeSessionForLog(session));
    }
    if (session && !hasUsableSession(session) && session.refreshToken) {
      if (typeof console !== "undefined") {
        console.log(`${LOG_PREFIX} session.restore.refresh-needed`, summarizeSessionForLog(session));
      }
      try {
        const refreshed = await authClient.refreshToken(session.refreshToken);
        session = toSession(refreshed);
        await sessionStore.set(session);
        if (typeof console !== "undefined") {
          console.log(`${LOG_PREFIX} session.restore.refresh-success`, summarizeSessionForLog(session));
        }
      } catch (error) {
        if (typeof console !== "undefined") {
          console.warn(`${LOG_PREFIX} session.restore.refresh-failed`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    if (!hasUsableSession(session)) {
      if (session) {
        await sessionStore.clear();
        if (typeof console !== "undefined") {
          console.warn(`${LOG_PREFIX} session.restore.invalid`, summarizeSessionForLog(session));
        }
      }
      state.loginStatus = "未登录";
    } else {
      state.loggedIn = true;
      state.userDisplayName = session.user?.display_name;
      state.userEmail = session.user?.email;
      state.loginStatus = "已登录";

      try {
        const balance = await creditsClient.getBalance(session.accessToken);
        state.creditsBalance = balance.balance;
        state.creditsCurrency = balance.currency;
        try {
          const tx = await creditsClient.listTransactions(session.accessToken, 8);
          state.creditsTransactions = tx.transactions.map((item) => ({
            id: item.transaction_id,
            type: item.transaction_type,
            amount: item.amount,
            balanceAfter: item.balance_after,
            remark: item.remark,
            createdAt: item.created_at,
          }));
        } catch {
          state.creditsTransactions = [];
        }
      } catch (error) {
        state.loginStatus = "已登录，Credits 未同步";
        if (typeof console !== "undefined") {
          console.warn(`${LOG_PREFIX} credits.sync.failed`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  } catch (error) {
    if (typeof console !== "undefined") {
      console.warn(`${LOG_PREFIX} session.restore.failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    state.loginStatus = "未登录";
  }

  try {
    const llmConfig = await customLlmConfigStore.get();
    if (llmConfig) {
      state.customLlmConfig = {
        provider: llmConfig.provider,
        baseUrl: llmConfig.baseUrl,
        apiKeyMasked: maskApiKey(llmConfig.apiKey),
        model: llmConfig.model,
        preferredOutputLanguage: llmConfig.preferredOutputLanguage,
      };
    }
  } catch {
    state.customLlmConfig = undefined;
  }

  try {
    state.llmMode = await llmModeStore.get();
  } catch {
    state.llmMode = "custom";
  }
}

async function pollLoginSessionUntilDone(
  internals: RuntimeInternals,
  authClient: AuthClient,
  sessionStore: PersistentSessionStore,
  creditsClient: CreditsClient,
  customLlmConfigStore: CustomLlmConfigStore,
  storage: LocalStorageKeyValueStore
): Promise<void> {
  const active = internals.activeLoginSession;
  if (!active) {
    return;
  }

  try {
    const status = await waitLoginSuccess(
      authClient,
      {
        login_session_id: active.loginSessionId,
        poll_token: active.pollToken,
        login_url: "",
        expires_at: "",
        interval_seconds: 15,
      },
      {
        waitIntervalMs: 15_000,
        timeoutMs: 10 * 60_000,
        maxConsecutiveErrors: 3,
      }
    );

    if (active.stopped) {
      return;
    }

    if (!status.exchange_token) {
      throw new Error("登录成功但缺少 exchange token");
    }

    const tokenData = await authClient.exchangeToken(active.loginSessionId, status.exchange_token);
    await sessionStore.set(toSession(tokenData));

    const state = internals.currentState ?? {
      loggedIn: false,
    };
    await fillSettingsState(state, sessionStore, authClient, creditsClient, customLlmConfigStore, llmModeStore);
    state.summary = `登录成功，欢迎回来 ${tokenData.user.display_name || tokenData.user.email}。`;
    state.nextActions = buildNextActions(state);
    commitState(internals, state, storage);
    active.stopped = true;
    if (internals.pendingChatInput) {
      void retryPendingChatAfterLogin(internals, chatOrchestrator, storage);
    }
    return;
  } catch (error) {
    const state = internals.currentState ?? {
      loggedIn: false,
    };
    if (error instanceof Error && /browser login ended with status:/i.test(error.message)) {
      const status = error.message.replace(/^.*status:\s*/i, "").trim();
      state.loginStatus = `登录未完成（${status}）`;
      state.summary = "浏览器登录会话已结束，请重新发起登录。";
    } else if (error instanceof Error && /timed out/i.test(error.message)) {
      state.loginStatus = "登录等待超时";
      state.summary = "登录等待超时，请在浏览器完成后重新点击登录。";
    } else {
      state.loginStatus = "登录轮询失败";
      state.summary = `登录状态同步失败：${error instanceof Error ? error.message : String(error)}`;
    }
    state.nextActions = buildNextActions(state);
    commitState(internals, state, storage);
    active.stopped = true;
    return;
  }
}

async function retryPendingChatAfterLogin(
  internals: RuntimeInternals,
  chatOrchestrator: ChatOrchestrator,
  storage: LocalStorageKeyValueStore
): Promise<void> {
  const pendingInput = internals.pendingChatInput?.trim();
  const currentState = internals.currentState;
  if (!pendingInput || !currentState) {
    return;
  }
  if (typeof console !== "undefined") {
    console.log(`${LOG_PREFIX} sendChat.retry-after-login`, {
      promptLength: pendingInput.length,
    });
  }
  try {
    const assistantReply = await chatOrchestrator.replyNaturally(currentState, pendingInput);
    const nextMessages = sanitizeChatMessages(currentState.chatMessages);
    currentState.summary = "登录恢复成功，已继续刚才的对话。";
    currentState.chatMessages = [
      ...nextMessages,
      assistantReply,
    ];
    internals.pendingChatInput = undefined;
    commitState(internals, currentState, storage);
  } catch (error) {
    if (typeof console !== "undefined") {
      console.error(`${LOG_PREFIX} sendChat.retry-after-login.failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    currentState.summary = `登录成功，但自动恢复对话失败：${error instanceof Error ? error.message : String(error)}`;
    currentState.chatMessages = [
      ...sanitizeChatMessages(currentState.chatMessages),
      ...buildErrorChatMessages(currentState.summary),
    ];
    commitState(internals, currentState, storage);
  }
}

function toSession(data: TokenExchangeData): AuthSession {
  // 使用 refresh_expires_in 作为 session 的过期时间，因为只要 refresh token 有效就可以刷新 access token
  const expiresIn = data.refresh_expires_in || data.expires_in;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    user: data.user,
  };
}

function hasUsableSession(session: AuthSession | undefined): session is AuthSession {
  if (!session) {
    return false;
  }
  if (
    typeof session.accessToken !== "string" ||
    session.accessToken.trim() === "" ||
    typeof session.refreshToken !== "string" ||
    session.refreshToken.trim() === "" ||
    typeof session.expiresAt !== "string" ||
    session.expiresAt.trim() === ""
  ) {
    return false;
  }
  const expiresAtMs = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }
  return expiresAtMs > Date.now() + 30_000;
}

function summarizeSessionForLog(session: AuthSession | undefined): Record<string, unknown> {
  return {
    exists: Boolean(session),
    hasAccessToken: Boolean(session?.accessToken),
    hasRefreshToken: Boolean(session?.refreshToken),
    expiresAt: session?.expiresAt,
    isExpired: session?.expiresAt ? Date.parse(session.expiresAt) <= Date.now() : undefined,
    hasUser: Boolean(session?.user),
    userEmail: session?.user?.email,
  };
}

function normalizeIssueObjectType(value: string | undefined): IssueObjectType | undefined {
  if (value === "component" || value === "pin" || value === "net") {
    return value;
  }
  return undefined;
}

function buildAnalysisSummary(state: MainPanelState, adapterSource: string): string {
  const issueCount = state.issueCount ?? 0;
  const componentCount = state.componentCount ?? 0;
  const netCount = state.netCount ?? 0;
  if (issueCount > 0) {
    return `已完成分析：发现 ${issueCount} 个问题，当前优先问题为“${state.topIssueTitle ?? "未命名问题"}”。（components=${componentCount}, nets=${netCount}, source=${adapterSource}）`;
  }
  return `已完成分析：当前未发现明显规则问题。（components=${componentCount}, nets=${netCount}, source=${adapterSource}）`;
}

function buildSessionTitleFromPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  const cleaned = stripSessionTitlePrefix(normalized);
  const distilled = distillSessionTitle(cleaned);
  if (!distilled) {
    return "New Session";
  }
  const maxVisualWidth = 26;
  let visualWidth = 0;
  let result = "";
  for (const char of distilled) {
    const width = isWideCharacter(char) ? 2 : 1;
    if (visualWidth + width > maxVisualWidth) {
      break;
    }
    result += char;
    visualWidth += width;
  }
  if (!result) {
    return "New Session";
  }
  return result.length < distilled.length ? `${result}...` : result;
}

function stripSessionTitlePrefix(text: string): string {
  return text
    .replace(/^(请你|请先|请|麻烦你|麻烦|帮我|请帮我|能否|可以|帮忙|想请你)\s*/u, "")
    .replace(/^(分析一下|分析|看一下|看下|检查一下|检查|帮我分析一下|帮我看一下|帮我检查一下)\s*/u, "")
    .replace(/^(当前|这个|这张|这个原理图|当前原理图)\s*/u, "")
    .replace(/^(一下|一下子)\s*/u, "")
    .trim();
}

function distillSessionTitle(text: string): string {
  if (!text) {
    return "";
  }
  const compact = text
    .replace(/^(分析|检查|看看|查看|确认|判断|评估|优化|生成|设计|绘制|修改|排查|定位)\s*/u, "")
    .replace(/(一下|一下子|是否|有无|有没有|怎么|怎样|如何)$/u, "")
    .replace(/\b(please|help|check|analyze|review)\b/giu, "")
    .replace(/\s+/g, " ")
    .trim();

  const keywords = extractSessionKeywords(compact);
  if (keywords.length >= 2) {
    const candidate = keywords.join(" ");
    if (candidate.length >= 4) {
      return candidate;
    }
  }

  return compact;
}

function extractSessionKeywords(text: string): string[] {
  const matches = text.match(/[A-Za-z]+\d+[A-Za-z0-9_-]*|[A-Z]{2,}[A-Za-z0-9_-]*|\d+(?:\.\d+)?[kKmMuUnNpPfF]?|[\u4e00-\u9fff]{2,}/gu) ?? [];
  const seen = new Set<string>();
  const results: string[] = [];
  for (const raw of matches) {
    const token = raw.trim();
    if (!token) {
      continue;
    }
    const normalized = token.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(token);
    if (results.length >= 4) {
      break;
    }
  }
  return results;
}

function isWideCharacter(char: string): boolean {
  return /[^\u0000-\u00ff]/u.test(char);
}

async function readSessionHistoryIndex(storage: LocalStorageKeyValueStore): Promise<SessionHistoryEntry[]> {
  const rawIndex = await storage.getItem(PANEL_SESSION_INDEX_STORAGE_KEY);
  const lastState = await restorePanelStateSnapshot(storage);
  return deriveSessionHistoryEntries(rawIndex || undefined, lastState);
}

async function writeSessionHistoryIndex(storage: LocalStorageKeyValueStore, entries: SessionHistoryEntry[]): Promise<void> {
  await storage.setItem(PANEL_SESSION_INDEX_STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_SESSION_HISTORY)));
}

async function readSessionState(storage: LocalStorageKeyValueStore, sessionId: string): Promise<MainPanelState | undefined> {
  try {
    const raw = await storage.getItem(buildSessionStateStorageKey(sessionId));
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as MainPanelState;
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }
    parsed.chatMessages = normalizeChatMessagesForPersistence(parsed.chatMessages);
    return parsed;
  } catch {
    return undefined;
  }
}

async function upsertSessionHistoryIndex(storage: LocalStorageKeyValueStore, state: MainPanelState): Promise<void> {
  const now = new Date().toISOString();
  const stateWithSession = state as MainPanelState & { sessionId?: string; createdAt?: string; updatedAt?: string };
  const sessionId = String(stateWithSession.sessionId || "").trim() || createSessionId();
  const createdAt = String(stateWithSession.createdAt || now);
  const updatedAt = now;
  const sessionTitle = deriveSessionTitleFromState(state);
  stateWithSession.sessionId = sessionId;
  stateWithSession.createdAt = createdAt;
  stateWithSession.updatedAt = updatedAt;
  state.sessionTitle = sessionTitle;
  const nextEntry: SessionHistoryEntry = {
    sessionId,
    sessionTitle,
    createdAt,
    updatedAt,
  };
  const existing = await readSessionHistoryIndex(storage);
  const merged = [nextEntry, ...existing.filter((item) => item.sessionId !== sessionId)]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, MAX_SESSION_HISTORY);
  await storage.setItem(buildSessionStateStorageKey(sessionId), JSON.stringify({
    ...state,
    sessionId,
    sessionTitle,
    createdAt,
    updatedAt,
  }));
  await writeSessionHistoryIndex(storage, merged);
}

async function restorePanelState(storage: LocalStorageKeyValueStore): Promise<MainPanelState | undefined> {
  const restored = await restorePanelStateSnapshot(storage);
  if (!restored) {
    return undefined;
  }
  const sessionHistory = await readSessionHistoryIndex(storage);
  const fallbackSession = sessionHistory[0];
  const sessionMeta = sessionHistory.find((item) => item.sessionId === String((restored as MainPanelState & { sessionId?: string }).sessionId || "").trim()) ?? fallbackSession;
  if (sessionMeta) {
    (restored as MainPanelState & { sessionId?: string; createdAt?: string; updatedAt?: string }).sessionId = sessionMeta.sessionId;
    (restored as MainPanelState & { sessionId?: string; createdAt?: string; updatedAt?: string }).createdAt = sessionMeta.createdAt;
    (restored as MainPanelState & { sessionId?: string; createdAt?: string; updatedAt?: string }).updatedAt = sessionMeta.updatedAt;
    restored.sessionTitle = sessionMeta.sessionTitle;
  }
  return restored;
}

async function restorePanelStateSnapshot(storage: LocalStorageKeyValueStore): Promise<MainPanelState | undefined> {
  try {
    const raw = await storage.getItem(PANEL_STATE_STORAGE_KEY);
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as MainPanelState;
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }
    
    // Log reactEvents status after deserialization
    if (ENABLE_VERBOSE_RUNTIME_LOGS && typeof console !== "undefined") {
      console.log(`${LOG_PREFIX} restorePanelState.after-parse`, {
        messageCount: parsed.chatMessages?.length ?? 0,
        reactEventsInMessages: parsed.chatMessages?.map((m, idx) => ({
          index: idx,
          role: m.role,
          hasReactEvents: Boolean(m.reactEvents),
          reactEventsCount: m.reactEvents?.length ?? 0,
          hasStepStates: Boolean(m.stepStates),
          stepStatesCount: m.stepStates?.length ?? 0,
        })) ?? [],
      });
    }
    
    parsed.chatMessages = normalizeChatMessagesForPersistence(parsed.chatMessages);
    return parsed;
  } catch {
    return undefined;
  }
}

async function persistPanelState(storage: LocalStorageKeyValueStore, state: MainPanelState): Promise<void> {
  try {
    // Log reactEvents status before serialization
    if (ENABLE_VERBOSE_RUNTIME_LOGS && typeof console !== "undefined") {
      console.log(`${LOG_PREFIX} persistPanelState.before-serialize`, {
        messageCount: state.chatMessages?.length ?? 0,
        reactEventsInMessages: state.chatMessages?.map((m, idx) => ({
          index: idx,
          role: m.role,
          hasReactEvents: Boolean(m.reactEvents),
          reactEventsCount: m.reactEvents?.length ?? 0,
          hasStepStates: Boolean(m.stepStates),
          stepStatesCount: m.stepStates?.length ?? 0,
        })) ?? [],
      });
    }
    
      const snapshot: MainPanelState = {
      ...state,
      __stateVersion: undefined,
      chatMessages: normalizeChatMessagesForPersistence(state.chatMessages),
    };
    
    // Log reactEvents status after creating snapshot
    if (ENABLE_VERBOSE_RUNTIME_LOGS && typeof console !== "undefined") {
      console.log(`${LOG_PREFIX} persistPanelState.after-snapshot`, {
        messageCount: snapshot.chatMessages?.length ?? 0,
        reactEventsInMessages: snapshot.chatMessages?.map((m, idx) => ({
          index: idx,
          role: m.role,
          hasReactEvents: Boolean(m.reactEvents),
          reactEventsCount: m.reactEvents?.length ?? 0,
          hasStepStates: Boolean(m.stepStates),
          stepStatesCount: m.stepStates?.length ?? 0,
        })) ?? [],
      });
    }
    
    await storage.setItem(PANEL_STATE_STORAGE_KEY, JSON.stringify(snapshot));
    await upsertSessionHistoryIndex(storage, snapshot);
  } catch {
    // Ignore local persistence failure.
  }
}

async function clearPanelState(storage: LocalStorageKeyValueStore): Promise<void> {
  try {
    await storage.removeItem(PANEL_STATE_STORAGE_KEY);
  } catch {
    // Ignore local cleanup failure.
  }
}

function buildLocateChatMessages(
  state: MainPanelState,
  objectType: string,
  objectId: string
): NonNullable<MainPanelState["chatMessages"]> {
  return [
    {
      role: "assistant",
      title: "定位完成",
      tone: "success",
      content: `我已经在画布中定位到 ${objectType}:${objectId}。\n如果还需要，我可以继续重新分析或生成草案。`,
      actions: [
        {
          label: "重新分析",
          action: "rerun",
        },
      ],
    },
    ...(state.chatMessages ?? []),
  ];
}

function maskApiKey(value: string): string {
  if (value.length <= 8) {
    return "********";
  }
  return `${value.slice(0, 4)}********${value.slice(-4)}`;
}

function buildNextActions(state: MainPanelState): string[] {
  const actions: string[] = [];
  if (!state.loggedIn) {
    actions.push("点击“登录”后用浏览器完成邮箱或微信登录。");
  }
  if ((state.issueCount ?? 0) > 0) {
    actions.push("点击问题列表中的“定位”优先检查接线标准、电源冲突与属性缺失。");
  }
  if (state.capabilityReport && state.capabilityReport.missing.length > 0) {
    actions.push(`当前宿主能力受限：${state.capabilityReport.missing.join("、")}。`);
  }
  actions.push("输入项目需求后可生成草案，确认后再进入 apply-plan。");
  return actions;
}

/**
 * 启动 Token 主动刷新定时器
 * 在 Access Token 过期前 5 分钟自动刷新，避免用户操作中断
 */
function startTokenRefreshTimer(
  sessionStore: PersistentSessionStore,
  authClient: AuthClient,
  internals: RuntimeInternals,
  creditsClient: CreditsClient,
  customLlmConfigStore: CustomLlmConfigStore,
  llmModeStore: LlmModeStore,
  storage: LocalStorageKeyValueStore
): void {
  // 每分钟检查一次
  setInterval(async () => {
    try {
      const session = await sessionStore.get();
      if (!session?.expiresAt) {
        return;
      }

      const expiresAtMs = Date.parse(session.expiresAt);
      if (!Number.isFinite(expiresAtMs)) {
        return;
      }

      const timeUntilExpiry = expiresAtMs - Date.now();
      
      // 提前 5 分钟刷新（300秒）
      // 但不要在已经过期或即将过期（30秒内）时刷新
      if (timeUntilExpiry < 5 * 60 * 1000 && timeUntilExpiry > 30_000) {
        if (typeof console !== "undefined") {
          console.log(`${LOG_PREFIX} token.proactive-refresh.start`, {
            timeUntilExpiry: Math.floor(timeUntilExpiry / 1000),
          });
        }

        try {
          const tokenData = await authClient.refreshToken(session.refreshToken);
          const nextSession = toSession(tokenData);
          await sessionStore.set(nextSession);

          if (typeof console !== "undefined") {
            console.log(`${LOG_PREFIX} token.proactive-refresh.success`, {
              newExpiresAt: nextSession.expiresAt,
            });
          }

          // 更新当前状态中的用户信息
          if (internals.currentState) {
            await fillSettingsState(
              internals.currentState,
              sessionStore,
              authClient,
              creditsClient,
              customLlmConfigStore,
              llmModeStore
            );
            commitState(internals, internals.currentState, storage);
          }
        } catch (error) {
          if (typeof console !== "undefined") {
            console.warn(`${LOG_PREFIX} token.proactive-refresh.failed`, {
              error: error instanceof Error ? error.message : String(error),
            });
          }
          // 刷新失败不清除会话，等待下次 HTTP 401 时处理
        }
      }
    } catch (error) {
      // 静默处理定时器错误，避免影响主流程
      if (typeof console !== "undefined") {
        console.warn(`${LOG_PREFIX} token.refresh-timer.error`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }, 60_000); // 每 60 秒检查一次
}
