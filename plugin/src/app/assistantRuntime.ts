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
import { previewDraftPlan } from "../editor/apply-plan/previewDraftPlan";
import { isCancelledError } from "../agent/core/cancelledError";

const GLOBAL_KEY = "__LCEDA_AI_ASSISTANT_RUNTIME__";
const FRAME_STATE_EVENT = "lceda-ai-assistant:state";
const PANEL_STATE_STORAGE_KEY = "lceda_ai.panel.last_state";
const PANEL_SESSION_INDEX_STORAGE_KEY = "lceda_ai.panel.session_index";
const PANEL_SESSION_STATE_PREFIX = "lceda_ai.panel.session.";
const MAX_SESSION_HISTORY = 20;
type IssueObjectType = "component" | "pin" | "net";
const LOG_PREFIX = "[LCEDA-AI][runtime]";
const ENABLE_VERBOSE_RUNTIME_LOGS = false;
// Streaming can emit lots of deltas; committing/persisting on every delta makes the UI churn.
const STREAM_COMMIT_MIN_INTERVAL_MS = 80;
const PERSIST_PANEL_STATE_THROTTLE_MS = 600;
const CONTEXT_COMPACTION_TRIGGER_TURNS = 20;
const CONTEXT_COMPACTION_KEEP_RECENT_TURNS = 3;
const CONTEXT_COMPACTION_MAX_TURNS = 30;
const CONTEXT_COMPACTION_TITLE = "上下文下压缩";

let persistPanelTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPersist: { storage: LocalStorageKeyValueStore; state: MainPanelState } | null = null;

type ChatMessage = NonNullable<MainPanelState["chatMessages"]>[number];

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
  footprintName?: string;
  manufacturer?: string;
  supplier?: string;
  supplierId?: string;
  description?: string;
}

export function buildDevicePickerRoleLabel(role: string | undefined): string {
  switch (String(role || "").trim()) {
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

function unwrapLibrarySearchResults(payload: unknown): unknown[] {
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
      const record = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
      const owner =
        typeof record.owner === "object" && record.owner !== null
          ? (record.owner as Record<string, unknown>)
          : undefined;
      const uuid =
        readSearchString(record, ["uuid", "deviceUuid", "id"]) ??
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
        libraryUuid:
          readSearchString(record, ["libraryUuid", "library_uuid", "ownerUuid"]) ??
          readSearchString(owner ?? {}, ["uuid"]) ??
          "",
        footprintName: readSearchString(record, ["footprintName", "packageName", "package"]),
        manufacturer: readSearchString(record, ["manufacturer", "brand"]),
        supplier: readSearchString(record, ["supplier", "ownerName"]),
        supplierId: readSearchString(record, ["supplierId", "lcscId", "lcsc_id"]),
        description: readSearchString(record, ["description", "desc"]),
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

function buildDevicePickerState(plan?: DraftPlan): MainPanelState["devicePicker"] | undefined {
  if (!plan) {
    return undefined;
  }
  const selectedByComponentId = new Map(
    (plan.selectedDevices ?? [])
      .filter((item) => item.componentId)
      .map((item) => [item.componentId as string, item])
  );
  const items = plan.components.map((component) => {
    const ref = component.ref ?? component.id;
    const selected = selectedByComponentId.get(component.id);
    const status: "unresolved" | "resolved" =
      component.properties?.device_resolution_status === "unresolved" ? "unresolved" : "resolved";
    return {
      componentId: component.id,
      componentRef: ref,
      role: inferDraftComponentRole(ref),
      roleLabel: buildDevicePickerRoleLabel(inferDraftComponentRole(ref)),
      query: component.properties?.preferred_search_query,
      status,
      reason: component.properties?.device_resolution_reason,
      reasonLabel: buildDevicePickerReasonLabel({
        reason: component.properties?.device_resolution_reason,
        role: inferDraftComponentRole(ref),
        query: component.properties?.preferred_search_query,
      }),
      usageHint:
        inferDraftComponentRole(ref) === "power_connector"
          ? "这里需要的是外部供电接口，优先看它是不是适合作为电源输入口。"
          : undefined,
      selectedDeviceLabel: selected
        ? `${selected.name}${selected.footprintName ? ` [${selected.footprintName}]` : ""}`
        : undefined,
      candidates: undefined,
    };
  });
  return {
    open: false,
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
  state.devicePicker = buildDevicePickerState(plan);
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

  const events = (message.reactEvents ??= []);
  const label = "Reasoning";
  const stepKind = "llm" as const;
  const existing = events.find((e) => e && e.kind === "thought" && e.label === label && e.stepKind === stepKind);
  const text = msgAny.__llmReasoningText;
  if (existing) {
    existing.text = text;
    existing.status = "done";
    return;
  }
  events.push({
    kind: "thought",
    label,
    status: "done",
    text,
    stepKind,
  });
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
  openDevicePicker(): Promise<MainPanelState>;
  closeDevicePicker(): Promise<MainPanelState>;
  searchDraftDeviceCandidates(componentId: string): Promise<MainPanelState>;
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
  draftBlocked?: boolean;
  lastApplyTransactionId?: string;
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
              lastMessage.content = `${lastMessage.content || ""}${event.textDelta}`;
            } else if (event.text !== undefined) {
              lastMessage.content = event.text || lastMessage.content || "";
            }
          } else {
            // progress 阶段只更新步骤，不写入 content；content 留给最终流式报告。
            if (event.stepItems !== undefined || event.reactEvents !== undefined) {
              const normalizedProcess = normalizeProcessFields({
                ...lastMessage,
                stepItems: event.stepItems ?? lastMessage.stepItems,
                reactEvents: event.reactEvents ?? lastMessage.reactEvents,
              });
              lastMessage.stepItems = normalizedProcess.stepItems;
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
        ...(buildDevicePickerState(draftPlan) ?? { open: true, items: [] }),
        open: true,
      };
      state.toast = {
        id: Date.now(),
        message: state.summary,
      };
      return commitState(internals, state, storage);
    }
    const adapter = createEditorAdapter(resolveRuntimeChannel());
    try {
      const result = await adapter.applyPlan(draftPlan);
      if (!result.applied) {
        const capabilityReport = await adapter.getCapabilityReport().catch(() => null);
        throw new Error(
          buildDraftApplyUnavailableMessage({
            adapterSource: adapter.source,
            capabilityReport,
          })
        );
      }
      internals.lastApplyTransactionId = result.transactionId;
      internals.draftBlocked = false;
      state.agentRunState = "completed";
      state.agentRunRoute = "draft";
      state.agentRunDetail = "草案已应用";
      state.summary = `草案已应用：器件 ${result.componentCount}，网络 ${result.netCount}。`;
      state.chatMessages = appendAssistantMessages(
        sanitizeChatMessages(state.chatMessages),
        pluginAgent.buildDraftAppliedMessages(result.componentCount, result.netCount)
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

  async function searchDraftDeviceCandidatesInternal(
    state: MainPanelState,
    componentId: string
  ): Promise<{ state: MainPanelState; updated: boolean; candidateCount: number }> {
    const plan = internals.draftPlan;
    const bridge = resolveHostEditorBridge();
    if (!plan || !bridge?.searchLibraryDevices) {
      state.summary = "当前宿主不支持器件库搜索。";
      state.toast = { id: Date.now(), message: state.summary };
      return { state, updated: false, candidateCount: 0 };
    }
    const component = plan.components.find((item) => item.id === componentId);
    const query = component?.properties?.preferred_search_query;
    if (!component || !query) {
      state.summary = "当前器件缺少可用搜索条件。";
      state.toast = { id: Date.now(), message: state.summary };
      return { state, updated: false, candidateCount: 0 };
    }
    const rawCandidates = await bridge.searchLibraryDevices({ query, scope: "system", pageSize: 8 });
    const candidates = normalizeDevicePickerCandidates(rawCandidates);
    const role = inferDraftComponentRole(component.ref ?? component.id);
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
    const picker = buildDevicePickerState(plan) ?? { open: true, items: [] };
    picker.open = true;
    picker.items = picker.items.map((item) => {
      if (item.componentId !== componentId) {
        const previousItem = previousPicker?.items.find((entry) => entry.componentId === item.componentId);
        return previousItem?.candidates && previousItem.candidates.length > 0
          ? { ...item, candidates: previousItem.candidates }
          : item;
        }
        return {
          ...item,
          candidates: presentedCandidates,
        };
      });
    state.devicePicker = picker;
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
    const component = plan.components.find((entry) => entry.id === input.componentId);
    if (!item || !candidate || !component) {
      return state;
    }
    component.libraryId = candidate.uuid;
    component.packageName = candidate.footprintName || component.packageName;
    component.properties = {
      ...component.properties,
      device_uuid: candidate.uuid,
      library_uuid: candidate.libraryUuid,
      device_resolution_status: "resolved",
      device_resolution_reason: "manual_selection",
    };
    const role = inferDraftComponentRole(component.ref ?? component.id);
    plan.selectedDevices = [
      ...(plan.selectedDevices ?? []).filter((entry) => entry.componentId !== input.componentId),
      {
        componentId: input.componentId,
        componentRef: component.ref ?? component.id,
        role,
        query: component.properties?.preferred_search_query || "",
        deviceUuid: candidate.uuid,
        libraryUuid: candidate.libraryUuid,
        name: candidate.name,
        manufacturer: candidate.manufacturer,
        footprintName: candidate.footprintName,
      },
    ];
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
    state.chatMessages = replaceTrailingPendingAssistant(
      sanitizeChatMessages(state.chatMessages),
      pluginAgent.buildDraftMessages({
        draftPreview: state.draftPreview,
      })
    );
    return state;
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
      const scheduleTurnCommit = (force: boolean) => {
        if (force) {
          if (turnCommitTimer) {
            clearTimeout(turnCommitTimer);
            turnCommitTimer = null;
          }
          lastTurnCommitAt = Date.now();
          commitState(internals, current, storage);
          return;
        }
        const now = Date.now();
        const elapsed = now - lastTurnCommitAt;
        if (elapsed >= STREAM_COMMIT_MIN_INTERVAL_MS && !turnCommitTimer) {
          lastTurnCommitAt = now;
          commitState(internals, current, storage);
          return;
        }
        if (turnCommitTimer) return;
        turnCommitTimer = setTimeout(() => {
          turnCommitTimer = null;
          lastTurnCommitAt = Date.now();
          commitState(internals, current, storage);
        }, Math.max(0, STREAM_COMMIT_MIN_INTERVAL_MS - elapsed));
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
          context = await buildSchematicContext(adapter);
        } catch (error) {
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
        const TURN_IDLE_TIMEOUT_MS = 6 * 60_000;
        const withActivityTimeout = async <T>(
          promise: Promise<T>,
          label: string,
          onRegisterTouch: (touch: () => void) => void
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
              reject(new Error(`timeout: ${label} (max ${TURN_MAX_TIMEOUT_MS}ms)`));
            }, TURN_MAX_TIMEOUT_MS);
          });

          const idleTimeout = new Promise<never>((_, reject) => {
            idleReject = (error) => reject(error);
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
        const turnPromise = pluginAgent.handleUserTurn({
          userQuery: trimmed,
          panelState: current,
          context,
          adapter,
          signal: internals.activeTurnAbortController.signal,
          onStreamEvent: (event) => {
            // Ignore late events from previous turns to prevent UI getting stuck.
            if (internals.activeTurnId !== turnId) return;
            touchTurnActivity?.();
            const sanitizedTextDelta = stripFinalControlLikeText(event.textDelta);
            const sanitizedText = stripFinalControlLikeText(event.text);
            const sanitizedReasoningDelta = stripFinalControlLikeText(event.reasoningDelta);
            const sanitizedReactEvents = sanitizeReactEventsForUi(event.reactEvents);
            const messages = current.chatMessages ?? [];
            const lastMessage = messages[messages.length - 1];
            if (!lastMessage || lastMessage.role !== "assistant") {
              return;
            }
            const normalizedStreamProcess = normalizeProcessFields({
              ...lastMessage,
              stepItems: event.stepItems ?? lastMessage.stepItems,
              reactEvents: sanitizedReactEvents ?? lastMessage.reactEvents,
            });
          if (event.detail) {
            current.agentRunDetail = event.detail;
          }
          if (event.stage === "llm") {
            lastMessage.streaming = true;
            lastMessage.title = event.route === "draft" ? "草案生成中" : event.route === "analysis" ? "分析中" : "处理中";
            // 对 reasoning 模型，思考区走 reasoningDelta；对非 reasoning 模型，
            // 普通文本 delta 需要进入正文区，否则用户只会看到工具进度而看不到任何生成过程。
            if (sanitizedTextDelta) {
              lastMessage.content = `${lastMessage.content === "正在思考..." ? "" : lastMessage.content || ""}${sanitizedTextDelta}`;
            } else if (event.text !== undefined && String(sanitizedText || "").trim()) {
              lastMessage.content = sanitizedText || lastMessage.content || "";
            }
            if (sanitizedReasoningDelta) {
              upsertLlmReasoningEvent(lastMessage, sanitizedReasoningDelta);
            }
            if (event.stepItems !== undefined || sanitizedReactEvents !== undefined || sanitizedReasoningDelta) {
              const normalizedAfterReasoning = normalizeProcessFields(lastMessage);
              lastMessage.stepItems = normalizedAfterReasoning.stepItems;
              lastMessage.reactEvents = normalizedAfterReasoning.reactEvents;
              lastMessage.stepTranscript = normalizedAfterReasoning.stepTranscript;
            }
            if (event.stepItems !== undefined || sanitizedReactEvents !== undefined) {
              lastMessage.stepItems = normalizedStreamProcess.stepItems;
              lastMessage.reactEvents = normalizedStreamProcess.reactEvents;
              lastMessage.stepTranscript = normalizedStreamProcess.stepTranscript;
            }
            if (event.stepStates) {
              lastMessage.stepStates = event.stepStates;
            }
            if (event.workingMemory) {
              lastMessage.workingMemory = event.workingMemory;
            }
          } else if (event.stage === "progress") {
            lastMessage.streaming = true;
            lastMessage.title = event.route === "draft" ? "草案生成中" : "分析中";
            // progress 阶段只更新 header/steps，不写入 message.content，避免污染最终流式报告。
            if (event.stepItems !== undefined || sanitizedReactEvents !== undefined) {
              lastMessage.stepItems = normalizedStreamProcess.stepItems;
              lastMessage.reactEvents = normalizedStreamProcess.reactEvents;
              lastMessage.stepTranscript = normalizedStreamProcess.stepTranscript;
            }
            if (event.stepStates) {
              lastMessage.stepStates = event.stepStates;
            }
            if (event.workingMemory) {
              lastMessage.workingMemory = event.workingMemory;
            }
          }
            scheduleTurnCommit(false);
          },
        });

        const turn = await withActivityTimeout(turnPromise, "handleUserTurn", (touch) => {
          touchTurnActivity = touch;
          touch(); // start idle timer immediately
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
        scheduleTurnCommit(true);
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
    openDevicePicker: async (): Promise<MainPanelState> => {
      const state = internals.currentState ?? (await computeAnalysisState());
      state.devicePicker = {
        ...(buildDevicePickerState(internals.draftPlan) ?? { open: true, items: [] }),
        open: true,
      };
      return commitState(internals, state, storage);
    },
    closeDevicePicker: async (): Promise<MainPanelState> => {
      const state = internals.currentState ?? (await computeAnalysisState());
      if (state.devicePicker) {
        state.devicePicker = { ...state.devicePicker, open: false };
      }
      return commitState(internals, state, storage);
    },
    searchDraftDeviceCandidates: async (componentId: string): Promise<MainPanelState> => {
      const state = internals.currentState ?? (await computeAnalysisState());
      await searchDraftDeviceCandidatesInternal(state, componentId);
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
      chooseDraftDeviceCandidateInternal(state, input);
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
    requestedRoute: "chat" | "analysis" | "draft";
    finalRoute: "chat" | "analysis" | "draft";
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
    }).__LCEDA_AI_ASSISTANT_FRAME_STATE__ = nextState;
  } catch {
    // Ignore assignment failures in constrained runtimes.
  }
  if (storage) {
    // Persisting on every state delta is expensive; throttle while running.
    schedulePersistPanelState(storage, nextState, !isRunning);
  }
  try {
    const runtime = globalThis as typeof globalThis & {
      dispatchEvent?: (event: Event) => boolean;
      CustomEvent?: typeof CustomEvent;
    };
    if (typeof runtime.dispatchEvent === "function" && typeof CustomEvent === "function") {
      runtime.dispatchEvent(new CustomEvent(FRAME_STATE_EVENT, { detail: nextState }));
    }
  } catch {
    // Ignore frame broadcast failures; state is still committed locally.
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

function stripInitialWelcomeMessages(
  messages: NonNullable<MainPanelState["chatMessages"]>
): NonNullable<MainPanelState["chatMessages"]> {
  return messages;
}

export function stripFinalControlLikeText(text: string | undefined): string {
  const raw = String(text || "");
  if (!raw) return "";
  const patterns = [
    /([\s\S]*?)(?:\n|\r|^)\s*```(?:json)?\s*$/u,
    /([\s\S]*?)(?:\n|\r|^)\s*```json\s*(?:\n|\r)/u,
    /([\s\S]*?)(?:\n|\r|^)\s*Final:\s*$/u,
    /([\s\S]*?)(?:\n|\r|^)\s*Final:\s*\{/u,
    /([\s\S]*?)(?:\n|\r|^)\s*\{\s*"type"\s*:\s*"final"/u,
    /([\s\S]*?)(?:\n|\r|^)\s*\{\s*"type"\s*:\s*$/u,
    /([\s\S]*?)(?:\n|\r|^)\s*\{\s*"type"\s*$/u,
    /([\s\S]*?)(?:\n|\r|^)\s*\{\s*"type"$/u,
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

function normalizeProcessFields(message: NonNullable<MainPanelState["chatMessages"]>[number]): NonNullable<MainPanelState["chatMessages"]>[number] {
  const reactEvents = Array.isArray(message.reactEvents) ? sanitizeReactEventsForUi(message.reactEvents) : undefined;
  const explicitStepItems = Array.isArray(message.stepItems) ? message.stepItems : undefined;
  const stepItems = explicitStepItems ?? convertReactEventsToStepItems(reactEvents);
  const stepTranscript =
    Array.isArray(message.stepTranscript) && message.stepTranscript.length > 0
      ? message.stepTranscript
      : buildStepTranscriptFromStepItems(stepItems) ?? buildStepTranscriptFromReactEvents(reactEvents);
  return {
    ...message,
    reactEvents,
    stepItems,
    stepTranscript,
  };
}

function createPendingAssistantMessage(route: "chat" | "analysis" | "draft"): NonNullable<MainPanelState["chatMessages"]>[number] {
  return {
    role: "assistant",
    title: route === "chat" ? "助手" : route === "draft" ? "草案生成中" : "分析中",
    // content 只用于最终流式报告/回复，进度与步骤展示由 reactEvents/stepStates 承载，避免污染最终输出。
    content: "",
    reactEvents: [
      {
        kind: "thought",
        label: "思考",
        status: "running",
        text:
          route === "draft"
            ? "正在规划草案与校验约束..."
            : route === "analysis"
              ? "正在读取原理图并准备分析..."
              : "正在分析用户意图并规划下一步...",
        stepKind: "llm",
      },
    ],
    streaming: true,
  };
}

function buildPendingAgentDetail(route: "chat" | "analysis" | "draft"): string {
  if (route === "chat") {
    return "正在规划对话并等待模型回复";
  }
  return route === "draft" ? "正在规划草案与执行规则校验" : "正在收集上下文并执行分析";
}

function buildPendingAgentSummary(route: "chat" | "analysis" | "draft"): string {
  if (route === "chat") {
    return "正在生成回复...";
  }
  return route === "draft" ? "正在生成草案..." : "正在分析当前原理图...";
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
        const mergedReactEvents = preferDefinedArray(msg.reactEvents, preservedReactEvents);
        const normalizedProcess = normalizeProcessFields({
          ...msg,
          stepItems: mergedStepItems,
          reactEvents: mergedReactEvents,
        });
        return {
          ...msg,
          stepItems: normalizedProcess.stepItems,
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
  const preservedReactEvents = normalizedPending.reactEvents;
  const preservedStepStates = pendingMessage.stepStates;
  const preservedWorkingMemory = pendingMessage.workingMemory;

  const mergedStepItems = normalizedFinal.stepItems === undefined ? preservedStepItems : normalizedFinal.stepItems;
  const mergedReactEvents = preferDefinedArray(normalizedFinal.reactEvents, preservedReactEvents);
  const mergedProcess = normalizeProcessFields({
    ...normalizedFinal,
    stepItems: mergedStepItems,
    reactEvents: mergedReactEvents,
  });
  return {
    ...normalizedFinal,
    role: "assistant",
    streaming: false,
    stepItems: mergedProcess.stepItems,
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
