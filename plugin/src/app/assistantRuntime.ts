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
import { PersistentSessionStore, type AuthSession } from "../services/auth/sessionStore";
import { CreditsClient } from "../services/credits/creditsClient";
import { CustomLlmConfigStore } from "../services/llm/customLlmConfigStore";
import { LlmProxyClient } from "../services/llm/llmProxyClient";
import { RagClient } from "../services/rag/ragClient";
import { LocalStorageKeyValueStore } from "../storage/keyValueStore";
import type { MainPanelState } from "../ui/panels/mainPanel";

const GLOBAL_KEY = "__LCEDA_AI_ASSISTANT_RUNTIME__";
const FRAME_STATE_EVENT = "lceda-ai-assistant:state";
const PANEL_STATE_STORAGE_KEY = "lceda_ai.panel.last_state";
type IssueObjectType = "component" | "pin" | "net";
const LOG_PREFIX = "[LCEDA-AI][runtime]";

function formatReactEventLine(event: NonNullable<MainPanelState["chatMessages"]>[number]["reactEvents"] extends Array<infer T> ? T : never): string {
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

export interface AssistantRuntime {
  openPanel(): Promise<MainPanelState>;
  rerunAnalysis(): Promise<MainPanelState>;
  locateIssue(index: number): Promise<MainPanelState>;
  startLogin(): Promise<MainPanelState>;
  sendChat(input: string): Promise<MainPanelState>;
  resetSession(): Promise<MainPanelState>;
  generateDraft(prompt: string): Promise<MainPanelState>;
  applyDraftPlan(): Promise<MainPanelState>;
  rollbackLastApply(): Promise<MainPanelState>;
  saveCustomLlmConfig(input: {
    provider: string;
    baseUrl: string;
    apiKey: string;
    model: string;
  }): Promise<MainPanelState>;
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
  const pluginAgent = createPluginAgent({
    llmClient,
    ragClient,
    sessionStore,
    customLlmConfigStore,
    hostBridge: resolveHostEditorBridge(),
    mcpClient,
  });

  // 启动主动刷新定时器
  startTokenRefreshTimer(sessionStore, authClient, internals, creditsClient, customLlmConfigStore, storage);

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
    await fillSettingsState(state, sessionStore, authClient, creditsClient, customLlmConfigStore);
    return state;
  }

  async function openIdlePanelState(): Promise<MainPanelState> {
    const restored = await restorePanelState(storage);
    if (restored) {
      await fillSettingsState(restored, sessionStore, authClient, creditsClient, customLlmConfigStore);
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

      try {
        const context = await buildSchematicContext(adapter);
        const result = await pluginAgent.run({
          type: "schematic_analysis",
          userQuery: "collect current schematic context",
          context,
          adapter,
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
        
        if (typeof console !== "undefined") {
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
      state.chatMessages = buildErrorChatMessages(state.summary);
      state.issueItems = [];
      internals.issueItems = [];
    }

    state.nextActions = buildNextActions(state);
    return commitState(internals, state, storage);
  }

  async function handleUnauthorizedSession(error: HttpError): Promise<void> {
    const refreshed = await refreshSessionIfNeeded("http_401");
    if (refreshed) {
      if (internals.currentState) {
        await fillSettingsState(internals.currentState, sessionStore, creditsClient, customLlmConfigStore);
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
      internals.issueItems = [];
      internals.draftPlan = undefined;
      internals.draftBlocked = undefined;
      internals.lastApplyTransactionId = undefined;
      internals.pendingChatInput = undefined;
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
          state.draftPreview = {
            title: result.draftPreview.title,
            rationale: result.draftPreview.rationale,
            componentRefs: result.draftPreview.componentRefs,
            netNames: result.draftPreview.netNames,
            componentCount: result.draftPreview.componentCount,
            netCount: result.draftPreview.netCount,
          };
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
      if (typeof console !== "undefined") {
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
      const session = await sessionStore.get();
      if (!session?.accessToken) {
        // Avoid waiting for credits syncing before showing the login-required toast.
        // Settings can be refreshed lazily via syncState / settings drawer.
        current.agentRunState = "idle";
        current.agentRunRoute = "chat";
        current.agentRunDetail = "未登录";
        current.summary = "请先登录后再继续自然聊天";
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
      
      if (typeof console !== "undefined") {
        console.log(`${LOG_PREFIX} sendChat.pending-message-added`, {
          messageCount: nextMessages.length,
          lastMessage: nextMessages[nextMessages.length - 1],
          agentRunState: current.agentRunState,
        });
      }
      
      commitState(internals, current, storage);
      
      if (typeof console !== "undefined") {
        console.log(`${LOG_PREFIX} sendChat.state-committed`, {
          version: internals.stateVersion,
          willWait: true,
        });
      }
      
      // 使用微任务确保 UI 有机会渲染 pending 状态，避免被后续的快速更新覆盖
      // 增加到 50ms 以确保 iframe 有足够时间处理事件和渲染
      await new Promise(resolve => setTimeout(resolve, 50));
      
      if (typeof console !== "undefined") {
        console.log(`${LOG_PREFIX} sendChat.after-delay`, {
          version: internals.stateVersion,
          proceedingToPlanning: true,
        });
      }
      
      internals.pendingChatInput = trimmed;
      turnIdCounter += 1;
      const turnId = turnIdCounter;
      internals.activeTurnId = turnId;
      try {
        const channel = resolveRuntimeChannel();
        const adapter = createEditorAdapter(channel);
        let plan;
        try {
          plan = await pluginAgent.planUserTurn({ userQuery: trimmed });
        } catch (error) {
          const plannerMessage = error instanceof Error ? error.message : String(error);
          if (typeof console !== "undefined") {
            console.warn(`${LOG_PREFIX} sendChat.plan.fallback`, { error: plannerMessage });
          }
          plan = {
            intent: "chat" as const,
            route: "chat" as const,
            requiresContext: false,
            steps: [{ kind: "llm" as const, required: true, note: "自然对话回复" }],
          };
        }
        let context;
        if (plan.requiresContext) {
          context = await buildSchematicContext(adapter);
        } else {
          try {
            context = await buildSchematicContext(adapter);
          } catch (error) {
            if (typeof console !== "undefined") {
              console.warn(`${LOG_PREFIX} sendChat.context.optional-failed`, {
                error: error instanceof Error ? error.message : String(error),
              });
            }
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
          lastMsg.content = plan.route === "chat" 
            ? "正在思考并请求模型回复..." 
            : plan.route === "draft" 
              ? "正在规划草案与校验约束..." 
              : "正在读取原理图并执行分析...";
          lastMsg.streaming = true;
        }
        commitState(internals, current, storage);
        const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), timeoutMs);
          });
          try {
            return await Promise.race([promise, timeout]);
          } finally {
            if (timer) clearTimeout(timer);
          }
        };

        const turnPromise = pluginAgent.handleUserTurn({
          userQuery: trimmed,
          panelState: current,
          context,
          adapter,
          onStreamEvent: (event) => {
            // Ignore late events from previous turns to prevent UI getting stuck.
            if (internals.activeTurnId !== turnId) return;
            const messages = current.chatMessages ?? [];
            const lastMessage = messages[messages.length - 1];
            if (!lastMessage || lastMessage.role !== "assistant") {
              return;
            }
            if (event.detail) {
              current.agentRunDetail = event.detail;
            }
            if (event.stage === "llm") {
              if (event.textDelta) {
                lastMessage.content = `${lastMessage.content || ""}${event.textDelta}`;
                lastMessage.streaming = true;
              }
              if (event.text !== undefined) {
                lastMessage.content = event.text || lastMessage.content || "";
              }
            } else if (event.stage === "progress") {
              lastMessage.streaming = true;
              lastMessage.title = event.route === "draft" ? "草案生成中" : "分析中";
              if (event.textDelta) {
                lastMessage.content = `${lastMessage.content || ""}${event.textDelta}`;
              } else if (event.text !== undefined) {
                lastMessage.content = event.text || lastMessage.content || "";
              } else if (event.detail) {
                // Do not overwrite streamed report content with status text like "分析完成..."。
                // Status belongs to header/steps; message.content is reserved for the final report stream.
                if (!lastMessage.content) {
                  lastMessage.content = event.detail;
                }
              }
            if (event.reactEvents) {
              lastMessage.reactEvents = event.reactEvents;
              lastMessage.stepTranscript = buildStepTranscriptFromReactEvents(event.reactEvents);
            }
            if (event.stepStates) {
              lastMessage.stepStates = event.stepStates;
            }
              if (event.workingMemory) {
                lastMessage.workingMemory = event.workingMemory;
              }
            }
            commitState(internals, current, storage);
          },
        });

        const turn = await withTimeout(turnPromise, 90_000, "handleUserTurn");
        if (typeof console !== "undefined") {
          console.log(`${LOG_PREFIX} sendChat.plan`, turn.plan);
          console.log(`${LOG_PREFIX} sendChat.intent`, { intent: turn.intent });
          console.log(`${LOG_PREFIX} sendChat.route`, { route: turn.route });
          console.log(`${LOG_PREFIX} sendChat.react.trace`, turn.result.executionTraces ?? []);
        }
        internals.pendingChatInput = undefined;
        if (internals.activeTurnId === turnId) {
          internals.activeTurnId = undefined;
        }
        const finalState = await applyTurnResultToState({
          baseState: current,
          userMessages: nextMessages,
          requestedRoute: plan.route,
          finalRoute: turn.route,
          plan: turn.plan,
          result: turn.result,
        });
        if (typeof console !== "undefined") {
          console.log(`${LOG_PREFIX} sendChat.success`, { 
            route: turn.route,
            agentRunState: finalState.agentRunState,
            streaming: finalState.chatMessages?.some(m => m.role === "assistant" && m.streaming),
            messageCount: finalState.chatMessages?.length,
          });
        }
        const committedState = commitState(internals, finalState, storage);
        if (typeof console !== "undefined") {
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
    applyDraftPlan: async (): Promise<MainPanelState> => {
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
      const adapter = createEditorAdapter(resolveRuntimeChannel());
      try {
        const result = await adapter.applyPlan(draftPlan);
      internals.lastApplyTransactionId = result.transactionId;
      internals.draftBlocked = false;
        state.agentRunState = "completed";
        state.agentRunRoute = "draft";
        state.agentRunDetail = "草案已应用";
        state.summary = `草案已应用：器件 ${result.componentCount}，网络 ${result.netCount}。`;
        state.chatMessages = pluginAgent.buildDraftAppliedMessages(result.componentCount, result.netCount);
      } catch (error) {
        state.agentRunState = "failed";
        state.agentRunRoute = "draft";
        state.agentRunDetail = error instanceof Error ? error.message : String(error);
        state.summary = `应用草案失败：${error instanceof Error ? error.message : String(error)}`;
        state.toast = {
          id: Date.now(),
          message: state.summary,
        };
      }
      state.nextActions = buildNextActions(state);
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
        state.chatMessages = pluginAgent.buildRollbackMessages(state.summary);
      } catch (error) {
        state.agentRunState = "failed";
        state.agentRunDetail = error instanceof Error ? error.message : String(error);
        state.summary = `回滚失败：${error instanceof Error ? error.message : String(error)}`;
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
        });
        await fillSettingsState(state, sessionStore, creditsClient, customLlmConfigStore);
        state.summary = "自定义 LLM 配置已保存。";
        state.chatMessages = pluginAgent.buildConfigSavedMessages();
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
        state.draftPreview = {
          title: result.draftPreview.title,
          rationale: result.draftPreview.rationale,
          componentRefs: result.draftPreview.componentRefs,
          netNames: result.draftPreview.netNames,
          componentCount: result.draftPreview.componentCount,
          netCount: result.draftPreview.netCount,
        };
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
    previousMessages: NonNullable<MainPanelState["chatMessages"]>
  ): Promise<MainPanelState> {
    const state = internals.currentState ?? (await computeAnalysisState());
    if (result.draftPreview) {
      internals.draftPlan = result.draftPlan;
      state.draftPreview = {
        title: result.draftPreview.title,
        rationale: result.draftPreview.rationale,
        componentRefs: result.draftPreview.componentRefs,
        netNames: result.draftPreview.netNames,
        componentCount: result.draftPreview.componentCount,
        netCount: result.draftPreview.netCount,
      };
      state.summary = `草案已生成：${result.draftPreview.title}，共 ${result.draftPreview.componentCount} 个器件，${result.draftPreview.netCount} 条网络。`;
      state.chatMessages = [
        ...previousMessages,
        ...pluginAgent.buildDraftMessages({
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
        }),
      ];
    } else {
      state.agentRunState = "completed";
      state.agentRunRoute = "draft";
      state.agentRunDetail = "草案未返回预览";
      state.summary = "草案生成完成，但未返回预览信息。";
      state.chatMessages = [
        ...previousMessages,
        ...pluginAgent.buildStatusMessages({ content: state.summary, tone: "warning" }),
      ];
    }
    state.nextActions = buildNextActions(state);
    return state;
  }

  async function applyTurnResultToState(input: {
    baseState: MainPanelState;
    userMessages: NonNullable<MainPanelState["chatMessages"]>;
    requestedRoute: "chat" | "analysis" | "draft";
    finalRoute: "chat" | "analysis" | "draft";
    plan: Awaited<ReturnType<typeof pluginAgent.handleUserTurn>>["plan"];
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
      drafted.chatMessages = replaceTrailingPendingAssistant(input.userMessages, drafted.chatMessages ?? []);
      drafted.nextActions = buildNextActions(drafted);
      return drafted;
    }

    // Analysis route: 直接更新最后一条streaming消息，而不是删除重建
    const analyzed = await buildAnalysisStateFromTurnResult(input.baseState, input.result);
    const replannedFromDraft =
      input.plan.route === "analysis" && input.plan.intent === "analysis" && input.requestedRoute === "draft";
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
        // 合并：保留streaming期间的reactEvents，使用新的content和其他字段
        lastMessage.streaming = false;
        lastMessage.title = newMessage.title;
        lastMessage.tone = newMessage.tone;
        lastMessage.content = newMessage.content;
        lastMessage.structuredContent = newMessage.structuredContent;
        lastMessage.evidenceItems = newMessage.evidenceItems;
        lastMessage.analysisReport = newMessage.analysisReport;
        lastMessage.suggestions = newMessage.suggestions;
        lastMessage.actions = newMessage.actions;
        // 保留streaming期间累积的reactEvents（如果新消息没有的话）
        lastMessage.reactEvents = preferNonEmptyArray(newMessage.reactEvents, lastMessage.reactEvents);
        lastMessage.stepTranscript =
          buildStepTranscriptFromReactEvents(lastMessage.reactEvents) ??
          newMessage.stepTranscript ??
          lastMessage.stepTranscript;
        lastMessage.stepStates = preferNonEmptyArray(newMessage.stepStates, lastMessage.stepStates);
        lastMessage.workingMemory = newMessage.workingMemory || lastMessage.workingMemory;
        lastMessage.toolTraces = newMessage.toolTraces || lastMessage.toolTraces;
        lastMessage.executionTraces = newMessage.executionTraces || lastMessage.executionTraces;
        lastMessage.uiEvents = newMessage.uiEvents || lastMessage.uiEvents;
        
        if (typeof console !== "undefined") {
          console.log(`${LOG_PREFIX} applyTurnResultToState.update-in-place`, {
            hasReactEvents: Boolean(lastMessage.reactEvents),
            reactEventsCount: lastMessage.reactEvents?.length ?? 0,
            hasStepStates: Boolean(lastMessage.stepStates),
            stepStatesCount: lastMessage.stepStates?.length ?? 0,
          });
        }
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
        lastMessage,
      ];
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
    void persistPanelState(storage, nextState);
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
  if (typeof console !== "undefined") {
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
  return sanitizeChatMessages(messages).map((message) => {
    const reactEvents = Array.isArray(message.reactEvents) ? message.reactEvents : undefined;
    const stepTranscript =
      Array.isArray(message.stepTranscript) && message.stepTranscript.length > 0
        ? message.stepTranscript
        : buildStepTranscriptFromReactEvents(reactEvents);
    return {
      ...message,
      reactEvents,
      stepTranscript,
      streaming: false,
    };
  });
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

function createPendingAssistantMessage(route: "chat" | "analysis" | "draft"): NonNullable<MainPanelState["chatMessages"]>[number] {
  return {
    role: "assistant",
    title: route === "chat" ? "助手" : route === "draft" ? "草案生成中" : "分析中",
    content:
      route === "chat"
        ? "正在思考并请求模型回复..."
        : route === "draft"
          ? "正在规划草案与校验约束..."
          : "正在读取原理图并执行分析...",
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
    // 保留streaming消息中的reactEvents和stepStates
    const preservedReactEvents = last.reactEvents;
    const preservedStepStates = last.stepStates;
    const preservedWorkingMemory = last.workingMemory;
    
    if (typeof console !== "undefined") {
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
        const mergedReactEvents = preferNonEmptyArray(msg.reactEvents, preservedReactEvents);
        return {
          ...msg,
          reactEvents: mergedReactEvents,
          stepTranscript: buildStepTranscriptFromReactEvents(mergedReactEvents) ?? msg.stepTranscript,
          stepStates: preferNonEmptyArray(msg.stepStates, preservedStepStates),
          workingMemory: msg.workingMemory || preservedWorkingMemory,
        };
      }
      return msg;
    });
    
    return [...list, ...mergedReplacements];
  }
  
  return [...list, ...normalized];
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

async function fillSettingsState(
  state: MainPanelState,
  sessionStore: PersistentSessionStore,
  authClient: AuthClient,
  creditsClient: CreditsClient,
  customLlmConfigStore: CustomLlmConfigStore
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
      };
    }
  } catch {
    state.customLlmConfig = undefined;
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

  for (let i = 0; i < 40; i += 1) {
    if (active.stopped) {
      return;
    }

    try {
      const status = await authClient.getLoginSession(active.loginSessionId, active.pollToken, 15);
      if (status.status === "success" && status.exchange_token) {
        const tokenData = await authClient.exchangeToken(active.loginSessionId, status.exchange_token);
        await sessionStore.set(toSession(tokenData));

        const state = internals.currentState ?? {
          loggedIn: false,
        };
        await fillSettingsState(state, sessionStore, authClient, creditsClient, customLlmConfigStore);
        state.summary = `登录成功，欢迎回来 ${tokenData.user.display_name || tokenData.user.email}。`;
        state.nextActions = buildNextActions(state);
        commitState(internals, state, storage);
        active.stopped = true;
        if (internals.pendingChatInput) {
          void retryPendingChatAfterLogin(internals, chatOrchestrator, storage);
        }
        return;
      }

      if (status.status === "failed" || status.status === "expired" || status.status === "cancelled") {
        const state = internals.currentState ?? {
          loggedIn: false,
        };
        state.loginStatus = `登录未完成（${status.status}）`;
        state.summary = "浏览器登录会话已结束，请重新发起登录。";
        state.nextActions = buildNextActions(state);
        commitState(internals, state, storage);
        active.stopped = true;
        return;
      }
    } catch (error) {
      const state = internals.currentState ?? {
        loggedIn: false,
      };
      state.loginStatus = "登录轮询失败";
      state.summary = `登录状态同步失败：${error instanceof Error ? error.message : String(error)}`;
      state.nextActions = buildNextActions(state);
      commitState(internals, state, storage);
      active.stopped = true;
      return;
    }
  }

  const state = internals.currentState ?? {
    loggedIn: false,
  };
  state.loginStatus = "登录等待超时";
  state.summary = "登录等待超时，请在浏览器完成后重新点击登录。";
  state.nextActions = buildNextActions(state);
  commitState(internals, state, storage);
  active.stopped = true;
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

async function restorePanelState(storage: LocalStorageKeyValueStore): Promise<MainPanelState | undefined> {
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
    if (typeof console !== "undefined") {
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
    if (typeof console !== "undefined") {
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
    if (typeof console !== "undefined") {
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
              creditsClient,
              customLlmConfigStore
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
