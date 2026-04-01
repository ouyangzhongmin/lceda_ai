import type { MainPanelState } from "../ui/panels/mainPanel";
import type { EditorAdapter } from "../editor/adapters/editorAdapter";
import type { SchematicContext } from "../types/schematic";
import type { SessionStore } from "../services/auth/sessionStore";
import type { CustomLlmConfigStore } from "../services/llm/customLlmConfigStore";
import type { LlmProxyClient } from "../services/llm/llmProxyClient";
import type { RagClient } from "../services/rag/ragClient";
import { executeAgentTurn } from "./agentRunner";
import { buildFallbackPlan, buildPlannerSystemPrompt, buildPlannerUserPrompt, normalizePlannerPlan } from "./prompts/plannerPrompts";
import type { AgentResult, AgentTaskType, AgentTurnPlan, AgentTurnResult } from "./shared/agentTypes";
import { SkillLoader } from "./skills/skillLoader";
import { ToolRegistry } from "./tools/toolRegistry";
import { createEditorTools } from "./tools/editorTools";
import { createIssueTools } from "./tools/issueTools";
import { createLibraryTools } from "./tools/libraryTools";
import { createDraftTools } from "./tools/draftTools";
import { createMcpTools } from "./tools/mcpTools";
import { createRuleTools } from "./tools/ruleTools";
import { createSchematicSummaryTools } from "./tools/schematicSummaryTools";
import { createServerTools } from "./tools/serverTools";
import { createTodoTools } from "./tools/todoTools";
import type { HostEditorBridge } from "../editor/host/runtime";
import type { MCPClient } from "./mcp/mcpClient";
import { runAnalysisReactAgent } from "./core/analysisReactAgent";
import { runChatReactAgent } from "./core/chatReactAgent";
import { runDraftReactAgent } from "./core/draftReactAgent";

export interface PluginAgentDeps {
  llmClient: LlmProxyClient;
  ragClient: RagClient;
  sessionStore: SessionStore;
  customLlmConfigStore: CustomLlmConfigStore;
  hostBridge?: HostEditorBridge;
  mcpClient?: MCPClient;
}

export interface PluginAgent {
  createToolRegistry(adapter: EditorAdapter, options?: { includeIssueTools?: boolean; includeLibraryTools?: boolean }): ToolRegistry;
  run(input: {
    type: AgentTaskType;
    userQuery: string;
    panelState?: MainPanelState;
    context?: SchematicContext;
    adapter?: EditorAdapter;
  }): Promise<AgentResult>;
  planUserTurn(input: { userQuery: string }): Promise<AgentTurnPlan>;
  handleUserTurn(input: {
    userQuery: string;
    panelState: MainPanelState;
    context?: SchematicContext;
    adapter?: EditorAdapter;
    onStreamEvent?: (event: {
      route: "chat" | "analysis" | "draft";
      stage: "llm" | "progress";
      textDelta?: string;
      text?: string;
      detail?: string;
      reactEvents?: AgentResult["reactEvents"];
      stepStates?: AgentResult["stepStates"];
      workingMemory?: AgentResult["workingMemory"];
    }) => void;
  }): Promise<AgentTurnResult>;
  buildNaturalChatMessage(result: AgentResult): NonNullable<MainPanelState["chatMessages"]>[number];
  buildAnalysisMessages(input: {
    issueCount: number;
    topIssueTitle?: string;
    locateStatus?: string;
    locateLabel?: string;
    analysisReport?: AgentResult["analysisReport"];
    libraryInsights?: AgentResult["libraryInsights"];
    issueItems?: MainPanelState["issueItems"];
    mcpResources?: AgentResult["mcpResources"];
    mcpResourceReads?: AgentResult["mcpResourceReads"];
    toolTraces?: AgentResult["toolTraces"];
    executionTraces?: AgentResult["executionTraces"];
    uiEvents?: AgentResult["uiEvents"];
    reactEvents?: AgentResult["reactEvents"];
    stepStates?: AgentResult["stepStates"];
    workingMemory?: AgentResult["workingMemory"];
    nextSuggestions?: AgentResult["nextSuggestions"];
    structuredSuggestions?: AgentResult["structuredSuggestions"];
  }): NonNullable<MainPanelState["chatMessages"]>;
  buildDraftMessages(input: {
    draftPreview?: MainPanelState["draftPreview"];
    mcpResources?: AgentResult["mcpResources"];
    mcpResourceReads?: AgentResult["mcpResourceReads"];
    toolTraces?: AgentResult["toolTraces"];
    executionTraces?: AgentResult["executionTraces"];
    uiEvents?: AgentResult["uiEvents"];
    reactEvents?: AgentResult["reactEvents"];
    stepStates?: AgentResult["stepStates"];
    workingMemory?: AgentResult["workingMemory"];
    draftRisk?: AgentResult["draftRisk"];
    nextSuggestions?: AgentResult["nextSuggestions"];
    structuredSuggestions?: AgentResult["structuredSuggestions"];
  }): NonNullable<MainPanelState["chatMessages"]>;
  buildStatusMessages(input: {
    title?: string;
    content: string;
    tone?: "default" | "success" | "warning";
    actions?: NonNullable<MainPanelState["chatMessages"]>[number]["actions"];
  }): NonNullable<MainPanelState["chatMessages"]>;
  buildDraftAppliedMessages(componentCount: number, netCount: number): NonNullable<MainPanelState["chatMessages"]>;
  buildRollbackMessages(message: string): NonNullable<MainPanelState["chatMessages"]>;
  buildConfigSavedMessages(): NonNullable<MainPanelState["chatMessages"]>;
}

export function createPluginAgent(deps: PluginAgentDeps): PluginAgent {
  const skillLoader = new SkillLoader();
  const buildStepTranscript = (
    reactEvents?: NonNullable<MainPanelState["chatMessages"]>[number]["reactEvents"]
  ): string[] | undefined => {
    if (!Array.isArray(reactEvents) || reactEvents.length === 0) {
      return undefined;
    }
    const lines = reactEvents
      .map((event) => {
        if (!event || !event.kind) return "";
        if (event.kind === "task") return `任务: ${event.text || event.label || ""}`;
        if (event.kind === "thought") return `思考: ${event.text || event.label || ""}`;
        if (event.kind === "tool_call") {
          return `Tool: ${(event.label || event.toolName || "tool")}${event.inputSummary ? ` ${event.inputSummary}` : ""}`;
        }
        if (event.kind === "observation") return `观察: ${event.outputSummary || event.text || ""}`;
        if (event.kind === "final") return `完成: ${event.text || event.label || ""}`;
        return `${event.kind}: ${event.text || event.label || ""}`;
      })
      .filter(Boolean);
    return lines.length > 0 ? lines : undefined;
  };
  return {
    createToolRegistry: (adapter, options) => createAgentToolRegistry(adapter, deps, options),
    run: async (input) => {
      if (input.type === "natural_chat") {
        if (!input.panelState) {
          throw new Error("panelState is required for natural_chat");
        }
        return runNaturalChatInternal(
          input.userQuery,
          input.panelState,
          undefined,
          input.plan?.steps?.map((step) => ({ kind: step.kind, note: step.note })) ?? undefined
        );
      }
      if (input.type === "schematic_analysis") {
        if (!input.context || !input.adapter) {
          throw new Error("context and adapter are required for schematic_analysis");
        }
        return runAnalysisInternal(
          input.userQuery,
          input.context,
          input.adapter,
          undefined,
          input.plan?.steps?.map((step) => ({ kind: step.kind, note: step.note })) ?? undefined
        );
      }
      if (!input.context || !input.adapter) {
        throw new Error("context and adapter are required for schematic_draft");
      }
      return runDraftInternal(
        input.userQuery,
        input.context,
        input.adapter,
        undefined,
        input.plan?.steps?.map((step) => ({ kind: step.kind, note: step.note })) ?? undefined
      );
    },
    planUserTurn: async (input) => planUserTurnInternal(input.userQuery, {}),
    handleUserTurn: async (input) => {
      const intentHint = await classifyUserIntent(input.userQuery, input.panelState, input.context);
      if (intentHint.startsWith("pcb")) {
        return {
          route: "chat",
          intent: "chat",
          plan: {
            intent: "chat",
            route: "chat",
            requiresContext: false,
            steps: [{ kind: "llm", required: true, note: "自然对话回复" }],
          },
          result: {
            summary: "pcb intent not supported",
            naturalReply: "当前插件端尚未支持 PCB 绘制流程，请先提供原理图或描述分析需求。",
            toolTraceNames: [],
            stepStates: [],
            reactEvents: [
              {
                kind: "thought",
                label: "意图分析",
                status: "done",
                text: intentHint,
                stepKind: "llm",
              },
            ],
            workingMemory: {
              hasContext: Boolean(input.context),
              mcpReady: false,
              libraryReady: false,
              llmReady: false,
              rulesReady: false,
              draftReady: false,
            },
            uiEvents: [
              { kind: "think", label: "意图分析", status: "done", text: intentHint, source: "planner" },
              { kind: "plan", label: "计划", status: "done", text: "Route: chat\n任务列表：\n1. 自然对话回复", source: "planner" },
              { kind: "finish", label: "完成", status: "done", text: "PCB 绘制暂未支持", source: "planner" },
            ],
          },
        };
      }

      let plan: AgentTurnPlan;
      try {
        plan = await planUserTurnInternal(
          input.userQuery,
          {
            panelState: input.panelState,
            context: input.context,
          },
          intentHint
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // 未登录错误
        if (errorMessage === "NOT_LOGGED_IN") {
          return {
            route: "chat",
            intent: "chat",
            plan: {
              intent: "chat",
              route: "chat",
              requiresContext: false,
              steps: [],
            },
            result: {
              summary: "not_logged_in",
              naturalReply: "请先登录后再使用 AI 助手功能。",
              toolTraceNames: [],
              stepStates: [],
              reactEvents: [],
              workingMemory: {
                hasContext: Boolean(input.context),
                mcpReady: false,
                libraryReady: false,
                llmReady: false,
                rulesReady: false,
                draftReady: false,
              },
            },
          };
        }

        // LLM 调用失败或解析失败
        console.error("[agent] handleUserTurn: plan failed", error);
        return {
          route: "chat",
          intent: "chat",
          plan: {
            intent: "chat",
            route: "chat",
            requiresContext: false,
            steps: [],
          },
          result: {
            summary: "planner_failed",
            naturalReply: errorMessage === "PLANNER_PARSE_FAILED" 
              ? "规划任务时出现问题，请稍后重试或换个方式描述您的需求。"
              : "调用 AI 服务时出现网络问题，请检查网络连接后重试。",
            toolTraceNames: [],
            stepStates: [],
            reactEvents: [],
            workingMemory: {
              hasContext: Boolean(input.context),
              mcpReady: false,
              libraryReady: false,
              llmReady: false,
              rulesReady: false,
              draftReady: false,
            },
          },
        };
      }

      const initialResult = await executeAgentTurn(
        {
          plan,
          userQuery: input.userQuery,
          panelState: input.panelState,
          context: input.context,
          adapter: input.adapter,
          intentHint,
        },
        {
          runNaturalChat: (userQuery, panelState, adapter, context) =>
            runNaturalChatInternal(userQuery, panelState, adapter, context, input.onStreamEvent, intentHint),
            runAnalysis: (userQuery, context, adapter, planSteps) =>
              runAnalysisInternal(userQuery, context, adapter, input.onStreamEvent, planSteps),
            runDraft: (userQuery, context, adapter, planSteps) =>
              runDraftInternal(userQuery, context, adapter, input.onStreamEvent, planSteps),
        }
      );
      const turn = await maybeReplanBlockedDraft(plan, initialResult, input);
      const finalRoute = resolveFinalRoute(turn.plan, turn.result, turn.route);
      return {
        route: finalRoute,
        intent: turn.plan.intent,
        plan: turn.plan,
        result: turn.result,
      };
    },
    buildNaturalChatMessage: (result) => {
      const reactEvents = (result.reactEvents ?? []).filter(
        (event) => event.kind === "tool_call" || event.kind === "observation"
      );
      const hasToolSteps = reactEvents.length > 0;
      return {
        role: "assistant",
        title: "助手",
        content:
          result.summary === "missing access token for natural chat"
            ? "当前未检测到有效登录态，无法调用在线模型。请先登录。"
            : result.naturalReply ?? "我暂时没有生成可展示的回复。",
        toolTraces: result.toolTraces,
        executionTraces: result.executionTraces,
        uiEvents: undefined,
        reactEvents: hasToolSteps ? reactEvents : undefined,
        stepTranscript: hasToolSteps ? buildStepTranscript(reactEvents) : undefined,
        stepStates: hasToolSteps ? result.stepStates : undefined,
        workingMemory: result.workingMemory,
        suggestions: result.structuredSuggestions,
        actions:
          result.summary === "missing access token for natural chat"
            ? [
                {
                  label: "去登录",
                  action: "login",
                },
              ]
            : undefined,
      };
    },
  buildAnalysisMessages: (input) => {
      const report = input.analysisReport;
      const schematicEntries = [
        report?.schematicInfo?.pageName ? `原理图：${report.schematicInfo.pageName}` : "",
        report?.schematicInfo?.projectId ? `项目ID：${report.schematicInfo.projectId}` : "",
        report?.schematicInfo?.pageId ? `页面ID：${report.schematicInfo.pageId}` : "",
        report?.schematicInfo?.channel
          ? `版本：${report.schematicInfo.channel === "professional" ? "专业版" : "标准版"}`
          : "",
        typeof report?.schematicInfo?.componentCount === "number" ? `器件数：${report.schematicInfo.componentCount}` : "",
        typeof report?.schematicInfo?.netCount === "number" ? `网络数：${report.schematicInfo.netCount}` : "",
        typeof report?.schematicInfo?.selectionCount === "number" ? `选中对象：${report.schematicInfo.selectionCount}` : "",
      ].filter(Boolean);
      const schematicInfoHint =
        schematicEntries.length > 0 ? `\n\n当前原理图信息：\n${schematicEntries.map((item) => `- ${item}`).join("\n")}` : "";
      const libraryHint =
        input.libraryInsights && input.libraryInsights.length > 0
          ? `\n\n关联器件信息：\n${input.libraryInsights
              .slice(0, 2)
              .map((item, index) => `${index + 1}. ${item.title}：${item.summary}`)
              .join("\n")}`
          : "";
      const executiveSummaryHint = report?.executiveSummary ? `\n\n整图理解：\n${report.executiveSummary}` : "";
      const ercSummaryHint =
        report?.ercSummary && report.ercSummary.length > 0
          ? `\n\nERC 基础检查：\n${report.ercSummary.map((item) => `- ${item}`).join("\n")}`
          : "";
      const bomOverviewHint =
        report?.bomOverview && report.bomOverview.length > 0
          ? `\n\n元件清单概览：\n${report.bomOverview.map((item) => `- ${item}`).join("\n")}`
          : "";
      const functionalBlocksHint =
        report?.functionalBlocks && report.functionalBlocks.length > 0
          ? `\n\n电路功能分析：\n${report.functionalBlocks.map((item) => `- ${item}`).join("\n")}`
          : "";
      const powerDomainsHint =
        report?.powerDomains && report.powerDomains.length > 0
          ? `\n\n电源域分析：\n${report.powerDomains.map((item) => `- ${item}`).join("\n")}`
          : "";
      const powerPathsHint =
        report?.powerPaths && report.powerPaths.length > 0
          ? `\n\n关键电源路径：\n${report.powerPaths.map((item) => `- ${item}`).join("\n")}`
          : "";
      const signalPathsHint =
        report?.signalPaths && report.signalPaths.length > 0
          ? `\n\n主要信号路径：\n${report.signalPaths.map((item) => `- ${item}`).join("\n")}`
          : "";
      const controlPathsHint =
        report?.controlPaths && report.controlPaths.length > 0
          ? `\n\n主控中心链路：\n${report.controlPaths.map((item) => `- ${item}`).join("\n")}`
          : "";
      const keyComponentsHint =
        report?.keyComponents && report.keyComponents.length > 0
          ? `\n\n关键器件：\n${report.keyComponents.map((item) => `- ${item}`).join("\n")}`
          : "";
      const riskHint =
        report?.riskGroups &&
        ((report.riskGroups.high && report.riskGroups.high.length > 0) ||
          (report.riskGroups.medium && report.riskGroups.medium.length > 0) ||
          (report.riskGroups.low && report.riskGroups.low.length > 0))
          ? `\n\n风险分组：\n${[
              report.riskGroups.high?.length ? `高风险：${report.riskGroups.high.join("；")}` : "",
              report.riskGroups.medium?.length ? `中风险：${report.riskGroups.medium.join("；")}` : "",
              report.riskGroups.low?.length ? `低风险：${report.riskGroups.low.join("；")}` : "",
            ]
              .filter(Boolean)
              .join("\n")}`
          : "";
      const issueLines = (report?.keyFindings?.length
        ? report.keyFindings
        : (input.issueItems ?? [])
            .slice(0, 3)
            .map((item) => `${item.title}${formatIssueLocationSuffix(item.objectType, item.objectId)}`))
        .map((item, index) => `${index + 1}. ${item}`)
        .join("\n");
      const suggestionHint =
        (report?.nextSteps?.length
          ? report.nextSteps
          : input.nextSuggestions) && (report?.nextSteps?.length ? report.nextSteps : input.nextSuggestions)!.length > 0
          ? `\n\n下一步建议：\n${(report?.nextSteps?.length ? report.nextSteps : input.nextSuggestions)!.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
          : "";
      const actions =
        input.issueCount > 0
          ? [
              {
                label: "重新分析",
                action: "rerun" as const,
              },
              {
                label: "立即登录",
                action: "login" as const,
              },
            ]
          : [
              {
                label: "生成草案",
                action: "rerun" as const,
              },
            ];
      const structuredContent = buildAnalysisStructuredContent({
        report,
        issueCount: input.issueCount,
        topIssueTitle: input.topIssueTitle,
        locateStatus: input.locateStatus,
        locateLabel: input.locateLabel,
        issueItems: input.issueItems,
        nextSuggestions: input.nextSuggestions,
        libraryInsights: input.libraryInsights,
      });
      return [
        {
          role: "assistant",
          title: "分析结果",
          tone: input.issueCount > 0 ? "warning" : "success",
          content:
            input.issueCount > 0
              ? `${report?.overview ?? `我已经完成当前原理图的首轮检查，发现 ${input.issueCount} 个需要关注的问题。`}${schematicInfoHint}${executiveSummaryHint}${ercSummaryHint}${bomOverviewHint}${functionalBlocksHint}${powerDomainsHint}${powerPathsHint}${signalPathsHint}${controlPathsHint}${keyComponentsHint}\n\n优先问题：${
                  input.topIssueTitle ?? "未命名问题"
                }\n定位结果：${input.locateLabel || formatLocateStatus(input.locateStatus)}\n\n${issueLines || "暂无可定位问题。"}${riskHint}${libraryHint}${suggestionHint}`
              : `${report?.overview ?? "当前原理图未发现明显规则问题，可以继续进行草案生成或更深入问答。"}${schematicInfoHint}${executiveSummaryHint}${ercSummaryHint}${bomOverviewHint}${functionalBlocksHint}${powerDomainsHint}${powerPathsHint}${signalPathsHint}${controlPathsHint}${keyComponentsHint}${riskHint}${libraryHint}${suggestionHint}`,
          structuredContent,
          evidenceItems: buildEvidenceItems({
            toolTraces: input.toolTraces,
            reactEvents: input.reactEvents,
            uiEvents: input.uiEvents,
          }),
          toolTraces: input.toolTraces,
          executionTraces: input.executionTraces,
          uiEvents: input.uiEvents,
          reactEvents: input.reactEvents,
          stepTranscript: buildStepTranscript(input.reactEvents),
          stepStates: input.stepStates,
          workingMemory: input.workingMemory,
          analysisReport: input.analysisReport,
          suggestions: input.structuredSuggestions,
          actions,
        },
      ];
    },
    buildDraftMessages: (input) => {
      const preview = input.draftPreview;
      if (!preview) {
        return [
          {
            role: "assistant",
            title: "状态更新",
            tone: "warning",
            content: "草案生成完成，但未返回可展示内容。",
          },
        ];
      }
      const mcpHint =
        input.mcpResources && input.mcpResources.length > 0
          ? `\nMCP资源：${input.mcpResources.map((item) => item.uri).join("、")}`
          : "";
      const mcpReadHint =
        input.mcpResourceReads && input.mcpResourceReads.length > 0
          ? `\nMCP摘要：${input.mcpResourceReads.map((item) => `${item.title}(${item.summary})`).join("；")}`
          : "";
      const riskHint = input.draftRisk ? `\n验证结论：${input.draftRisk.message}` : "";
      const suggestionHint =
        input.nextSuggestions && input.nextSuggestions.length > 0
          ? `\n\n下一步建议：\n${input.nextSuggestions.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
          : "";
      const actions =
        input.draftRisk?.level === "blocked"
          ? [
              {
                label: "重新分析",
                action: "rerun" as const,
              },
            ]
          : [
              {
                label: "应用草案",
                action: "apply_draft" as const,
              },
              {
                label: "回滚应用",
                action: "rollback" as const,
              },
            ];
      const structuredContent = buildDraftStructuredContent(input);
      return [
        {
          role: "assistant",
          title: "草案草图",
          tone: input.draftRisk?.level === "blocked" ? "warning" : "success",
            content: `我已经生成一版草案。\n\n标题：${preview.title}\n说明：${preview.rationale}\n器件：${preview.componentRefs.join(
            "、"
          )}\n网络：${preview.netNames.join("、")}${mcpHint}${mcpReadHint}${riskHint}${suggestionHint}\n\n下一步应进入人工确认，再决定是否 apply-plan。`,
           structuredContent,
           evidenceItems: buildEvidenceItems({
             toolTraces: input.toolTraces,
             reactEvents: input.reactEvents,
             uiEvents: input.uiEvents,
           }),
             toolTraces: input.toolTraces,
            executionTraces: input.executionTraces,
            uiEvents: input.uiEvents,
            reactEvents: input.reactEvents,
            stepTranscript: buildStepTranscript(input.reactEvents),
            stepStates: input.stepStates,
            workingMemory: input.workingMemory,
            suggestions: input.structuredSuggestions,
          actions,
        },
      ];
    },
    buildStatusMessages: (input) => [
      {
        role: "assistant",
        title: input.title ?? "状态更新",
        tone: input.tone ?? "warning",
        content: input.content,
        evidenceItems: undefined,
        actions: input.actions,
      },
    ],
    buildDraftAppliedMessages: (componentCount, netCount) => [
      {
        role: "assistant",
        title: "已应用草案",
        tone: "success",
        content: `草案已成功应用到画布。\n器件数：${componentCount}\n网络数：${netCount}\n如不符合预期可以立即回滚。`,
        evidenceItems: undefined,
        actions: [
          {
            label: "回滚应用",
            action: "rollback",
          },
        ],
      },
    ],
    buildRollbackMessages: (message) => [
      {
        role: "assistant",
        title: "回滚结果",
        tone: "warning",
        content: message,
        evidenceItems: undefined,
        actions: [
          {
            label: "重新分析",
            action: "rerun",
          },
        ],
      },
    ],
    buildConfigSavedMessages: () => [
      {
        role: "assistant",
        title: "配置已保存",
        tone: "success",
        content: "自定义 LLM 配置已更新，后续对话将按当前配置执行。",
        evidenceItems: undefined,
      },
    ],
  };

  function runNaturalChatInternal(
    input: string,
    panelState: MainPanelState,
    adapter?: EditorAdapter,
    _context?: SchematicContext,
    onStreamEvent?: (event: {
      route: "chat" | "analysis" | "draft";
      stage: "llm";
      textDelta?: string;
      text?: string;
      detail?: string;
    }) => void,
    intentHint?: string,
    planSteps?: Array<{ kind: AgentTurnPlan["steps"][number]["kind"]; note: string }>
  ): Promise<AgentResult> {
    const tools = createBaseToolRegistry(deps);
    if (adapter) {
      for (const tool of createEditorTools(adapter)) {
        tools.register(tool);
      }
      for (const tool of createSchematicSummaryTools()) {
        tools.register(tool);
      }
    }
    const skill = skillLoader.selectForTask("natural_chat", input);
    return runChatReactAgent(
      {
        task: {
          type: "natural_chat",
          userQuery: input,
          planSteps,
        },
        panelState,
        allowedTools: skill.allowedTools,
        invokeTool: (toolName, toolInput) => tools.invoke(toolName, toolInput),
        listToolNames: () => tools.list().map((tool) => tool.name),
      },
      { onStreamEvent, intentHint }
    ).then(({ result, reactEvents }) => ({
      ...result,
      selectedSkill: skill.name,
      reactEvents,
    }));
  }

  async function planUserTurnInternal(
    userQuery: string,
    input: { panelState?: MainPanelState; context?: SchematicContext },
    intentHint?: string
  ): Promise<AgentTurnPlan> {
    const session = await deps.sessionStore.get();
    if (!session?.accessToken) {
      throw new Error("NOT_LOGGED_IN");
    }

    const resolvedIntentHint =
      intentHint ?? (await classifyUserIntent(userQuery, input.panelState, input.context));

    const plannerResult = await deps.llmClient.generate(session.accessToken, {
      messages: [
        { role: "system", content: buildPlannerSystemPrompt() },
        { role: "user", content: buildPlannerUserPrompt(userQuery, resolvedIntentHint) },
      ],
    });

    const plan = normalizePlannerPlan(plannerResult.output_text);
    if (!plan) {
      console.error("[agent] planUserTurn: failed to parse planner output", plannerResult.output_text);
      const fallbackIntent =
        resolvedIntentHint.includes("draft") || resolvedIntentHint.includes("design") || resolvedIntentHint.includes("generate")
          ? "draft"
          : resolvedIntentHint.includes("analysis") ||
              resolvedIntentHint.includes("schematic") ||
              resolvedIntentHint.includes("检查") ||
              resolvedIntentHint.includes("分析")
            ? "analysis"
            : "chat";
      return buildFallbackPlan(fallbackIntent);
    }

    return plan;
  }

  function runAnalysisInternal(
    input: string,
    context: SchematicContext,
    adapter: EditorAdapter,
    onStreamEvent?: (event: {
      route: "chat" | "analysis" | "draft";
      stage: "llm" | "progress";
      textDelta?: string;
      text?: string;
      detail?: string;
      reactEvents?: AgentResult["reactEvents"];
      stepStates?: AgentResult["stepStates"];
      workingMemory?: AgentResult["workingMemory"];
    }) => void,
    planSteps?: Array<{ kind: AgentTurnPlan["steps"][number]["kind"]; note: string }>
  ): Promise<AgentResult> {
    const tools = createAgentToolRegistry(adapter, deps, { includeIssueTools: true, includeLibraryTools: true });
    for (const tool of createMcpTools(deps.mcpClient)) {
      tools.register(tool);
    }
    const skill = skillLoader.selectForTask("schematic_analysis", input);
    return runAnalysisReactAgent({
      task: {
        type: "schematic_analysis",
        userQuery: input,
        context,
        planSteps,
      },
      allowedTools: skill.allowedTools,
      invokeTool: (toolName, toolInput) => tools.invoke(toolName, toolInput),
      listToolNames: () => tools.list().map((tool) => tool.name),
      onProgress: (payload) => {
        onStreamEvent?.({
          route: "analysis",
          stage: "progress",
          detail: payload.detail,
          textDelta: payload.textDelta,
          text: payload.text,
          reactEvents: payload.reactEvents,
          stepStates: payload.stepStates,
          workingMemory: payload.workingMemory,
        });
      },
    }).then(({ result, reactEvents }) => ({
      ...result,
      selectedSkill: skill.name,
      reactEvents,
    }));
  }

  function runDraftInternal(
    input: string,
    context: SchematicContext,
    adapter: EditorAdapter,
    onStreamEvent?: (event: {
      route: "chat" | "analysis" | "draft";
      stage: "llm" | "progress";
      textDelta?: string;
      text?: string;
      detail?: string;
      reactEvents?: AgentResult["reactEvents"];
      stepStates?: AgentResult["stepStates"];
      workingMemory?: AgentResult["workingMemory"];
    }) => void,
    planSteps?: Array<{ kind: AgentTurnPlan["steps"][number]["kind"]; note: string }>
  ): Promise<AgentResult> {
    const tools = createAgentToolRegistry(adapter, deps, { includeLibraryTools: true });
    for (const tool of createMcpTools(deps.mcpClient)) {
      tools.register(tool);
    }
    const skill = skillLoader.selectForTask("schematic_draft", input);
    return runDraftReactAgent({
      task: {
        type: "schematic_draft",
        userQuery: input,
        context,
        planSteps,
      },
      allowedTools: skill.allowedTools,
      invokeTool: (toolName, toolInput) => tools.invoke(toolName, toolInput),
      listToolNames: () => tools.list().map((tool) => tool.name),
      onProgress: (payload) => {
        onStreamEvent?.({
          route: "draft",
          stage: "progress",
          detail: payload.detail,
          textDelta: payload.textDelta,
          text: payload.text,
          reactEvents: payload.reactEvents,
          stepStates: payload.stepStates,
          workingMemory: payload.workingMemory,
        });
      },
    }).then(({ result, reactEvents }) => ({
      ...result,
      selectedSkill: skill.name,
      reactEvents,
    }));
  }

  async function maybeReplanBlockedDraft(
    plan: AgentTurnPlan,
    result: AgentResult,
    input: {
      userQuery: string;
      panelState: MainPanelState;
      context?: SchematicContext;
      adapter?: EditorAdapter;
    }
  ): Promise<{ route: AgentTurnPlan["route"]; plan: AgentTurnPlan; result: AgentResult }> {
    if (plan.route !== "draft" || result.draftRisk?.level !== "blocked") {
      return { route: plan.route, plan, result };
    }
    if (!input.context || !input.adapter) {
      return { route: plan.route, plan, result };
    }

    const replannedPlan: AgentTurnPlan = {
      intent: "analysis",
      route: "analysis",
      requiresContext: true,
      steps: [
        { kind: "context", required: true, note: "replan uses existing schematic context" },
        { kind: "mcp", required: true, note: "replan loads engineering references for blocked draft" },
        { kind: "rules", required: true, note: "replan inspects constraints that blocked draft apply" },
      ],
    };
    const analysisResult = await runAnalysisInternal(
      "analyze current schematic constraints for blocked draft",
      input.context,
      input.adapter
    );
    return {
      route: "analysis",
      plan: replannedPlan,
      result: {
        ...analysisResult,
        executionTraces: [
          ...(result.executionTraces ?? []),
          {
            phase: "reason",
            message: `replan from=draft to=analysis because ${result.draftRisk.message}`,
          },
          ...(analysisResult.executionTraces ?? []),
        ],
      },
    };
  }

  function formatLocateStatus(locateStatus?: string): string {
    if (!locateStatus || locateStatus === "none") {
      return "未定位";
    }
    const [objectType, ...rest] = locateStatus.split(":");
    return formatObjectReference(objectType, rest.join(":"));
  }

  function formatIssueLocationSuffix(objectType?: string, objectId?: string): string {
    const label = formatObjectReference(objectType, objectId);
    return label ? `（${label}）` : "";
  }

  function formatObjectReference(objectType?: string, objectId?: string): string {
    if (!objectType && !objectId) {
      return "";
    }
    const type = (objectType ?? "").trim().toLowerCase();
    const id = (objectId ?? "").trim();
    if (!id) {
      return type || "";
    }

    if (type === "pin") {
      const pinMatch = id.match(/^pin-([^-]+)-(.+)$/i);
      if (pinMatch) {
        const ref = pinMatch[1].toUpperCase();
        const pinNo = pinMatch[2].toUpperCase();
        return `${ref} 的 ${pinNo} 脚`;
      }
    }

    if (type === "component") {
      const compMatch = id.match(/^component-(.+)$/i);
      if (compMatch) {
        return `器件 ${compMatch[1].toUpperCase()}`;
      }
      return `器件 ${id.toUpperCase()}`;
    }

    if (type === "net") {
      const netMatch = id.match(/^net-(.+)$/i);
      if (netMatch) {
        return `网络 ${netMatch[1]}`;
      }
      return `网络 ${id}`;
    }

    return `${type || "对象"} ${id}`;
  }

  function buildAnalysisStructuredContent(input: {
    report?: NonNullable<AgentResult["analysisReport"]>;
    issueCount: number;
    topIssueTitle?: string;
    locateStatus?: string;
    locateLabel?: string;
    issueItems?: MainPanelState["issueItems"];
    nextSuggestions?: AgentResult["nextSuggestions"];
    libraryInsights?: AgentResult["libraryInsights"];
  }): NonNullable<NonNullable<MainPanelState["chatMessages"]>[number]["structuredContent"]> {
    const blocks: NonNullable<NonNullable<MainPanelState["chatMessages"]>[number]["structuredContent"]> = [];
    const report = input.report;

    blocks.push({
      kind: "paragraph",
      text:
        report?.overview ??
        (input.issueCount > 0
          ? `我已经完成当前原理图的首轮检查，发现 ${input.issueCount} 个需要关注的问题。`
          : "当前原理图未发现明显规则问题，可以继续进行草案生成或更深入问答。"),
    });

    const schematicEntries = [
      report?.schematicInfo?.pageName ? { key: "原理图", value: report.schematicInfo.pageName } : null,
      report?.schematicInfo?.projectId ? { key: "项目ID", value: report.schematicInfo.projectId } : null,
      report?.schematicInfo?.pageId ? { key: "页面ID", value: report.schematicInfo.pageId } : null,
      report?.schematicInfo?.channel
        ? { key: "版本", value: report.schematicInfo.channel === "professional" ? "专业版" : "标准版" }
        : null,
      typeof report?.schematicInfo?.componentCount === "number"
        ? { key: "器件数", value: String(report.schematicInfo.componentCount) }
        : null,
      typeof report?.schematicInfo?.netCount === "number"
        ? { key: "网络数", value: String(report.schematicInfo.netCount) }
        : null,
      typeof report?.schematicInfo?.selectionCount === "number"
        ? { key: "选中对象", value: String(report.schematicInfo.selectionCount) }
        : null,
    ].filter(Boolean) as Array<{ key: string; value: string }>;
    if (schematicEntries.length > 0) {
      blocks.push({
        kind: "kv",
        title: "当前原理图信息",
        entries: schematicEntries,
      });
    }

    if (report?.executiveSummary) {
      blocks.push({
        kind: "section",
        title: "整图理解",
        text: report.executiveSummary,
      });
    }

    if (input.issueCount > 0) {
      blocks.push({
        kind: "kv",
        title: "快速定位",
        entries: [
          { key: "优先问题", value: input.topIssueTitle ?? "未命名问题" },
          { key: "定位结果", value: input.locateLabel || formatLocateStatus(input.locateStatus) },
        ],
      });
    }

    const findings =
      report?.keyFindings?.length
        ? report.keyFindings
        : (input.issueItems ?? [])
            .slice(0, 5)
            .map((item) => `${item.title}${formatIssueLocationSuffix(item.objectType, item.objectId)}`);
    if (findings && findings.length > 0) {
      blocks.push({
        kind: "list",
        title: input.issueCount > 0 ? "关键问题" : "关键观察",
        items: findings,
      });
    }

    pushStructuredList(blocks, "ERC 基础检查", report?.ercSummary);
    pushStructuredList(blocks, "元件清单概览", report?.bomOverview);
    pushStructuredList(blocks, "电路功能分析", report?.functionalBlocks);
    pushStructuredList(blocks, "电源域分析", report?.powerDomains);
    pushStructuredList(blocks, "关键电源路径", report?.powerPaths);
    pushStructuredList(blocks, "主要信号路径", report?.signalPaths);
    pushStructuredList(blocks, "主控中心链路", report?.controlPaths);
    pushStructuredList(blocks, "关键器件", report?.keyComponents);

    const riskEntries = [
      report?.riskGroups?.high?.length ? { key: "高风险", value: report.riskGroups.high.join("；") } : null,
      report?.riskGroups?.medium?.length ? { key: "中风险", value: report.riskGroups.medium.join("；") } : null,
      report?.riskGroups?.low?.length ? { key: "低风险", value: report.riskGroups.low.join("；") } : null,
    ].filter(Boolean) as Array<{ key: string; value: string }>;
    if (riskEntries.length > 0) {
      blocks.push({
        kind: "kv",
        title: "风险分组",
        entries: riskEntries,
      });
    }

    if (input.libraryInsights && input.libraryInsights.length > 0) {
      blocks.push({
        kind: "list",
        title: "关联器件信息",
        items: input.libraryInsights.slice(0, 3).map((item) => `${item.title}：${item.summary}`),
      });
    }

    const nextSteps = report?.nextSteps?.length ? report.nextSteps : input.nextSuggestions;
    if (nextSteps && nextSteps.length > 0) {
      blocks.push({
        kind: "list",
        title: "下一步建议",
        items: nextSteps,
      });
    }

    return blocks;
  }

  function buildDraftStructuredContent(
    input: Parameters<PluginAgent["buildDraftMessages"]>[0]
  ): NonNullable<NonNullable<MainPanelState["chatMessages"]>[number]["structuredContent"]> {
    const preview = input.draftPreview;
    if (!preview) {
      return [{ kind: "paragraph", text: "草案生成完成，但未返回可展示内容。" }];
    }
    const blocks: NonNullable<NonNullable<MainPanelState["chatMessages"]>[number]["structuredContent"]> = [
      { kind: "paragraph", text: "我已经生成一版草案。" },
      {
        kind: "kv",
        title: "草案摘要",
        entries: [
          { key: "标题", value: preview.title },
          { key: "说明", value: preview.rationale },
          { key: "器件数量", value: String(preview.componentCount) },
          { key: "网络数量", value: String(preview.netCount) },
        ],
      },
      {
        kind: "list",
        title: "涉及器件",
        items: preview.componentRefs.length > 0 ? preview.componentRefs : ["未返回器件列表"],
      },
      {
        kind: "list",
        title: "涉及网络",
        items: preview.netNames.length > 0 ? preview.netNames : ["未返回网络列表"],
      },
    ];

    if (input.mcpResourceReads && input.mcpResourceReads.length > 0) {
      blocks.push({
        kind: "list",
        title: "参考知识",
        items: input.mcpResourceReads.map((item) => `${item.title}：${item.summary}`),
      });
    }

    if (input.draftRisk) {
      blocks.push({
        kind: "kv",
        title: "验证结论",
        entries: [
          { key: "风险等级", value: input.draftRisk.level },
          { key: "结论", value: input.draftRisk.message },
        ],
      });
    }

    if (input.nextSuggestions && input.nextSuggestions.length > 0) {
      blocks.push({
        kind: "list",
        title: "下一步建议",
        items: input.nextSuggestions,
      });
    }

    blocks.push({
      kind: "paragraph",
      text: "下一步应进入人工确认，再决定是否 apply-plan。",
    });
    return blocks;
  }

  function pushStructuredList(
    blocks: NonNullable<NonNullable<MainPanelState["chatMessages"]>[number]["structuredContent"]>,
    title: string,
    items?: string[]
  ): void {
    if (!items || items.length === 0) {
      return;
    }
    blocks.push({
      kind: "list",
      title,
      items,
    });
  }

  async function classifyUserIntent(
    userQuery: string,
    panelState?: MainPanelState,
    context?: SchematicContext
  ): Promise<string> {
    const session = await deps.sessionStore.get();
    if (!session?.accessToken) {
      return "fallback:chat";
    }
    const contextHint = context
      ? `context: components=${context.components.length}, nets=${context.nets.length}, selection=${context.selection.objectIds.length}`
      : panelState
        ? `panel: components=${panelState.componentCount ?? 0}, nets=${panelState.netCount ?? 0}, selection=${panelState.selectionCount ?? 0}`
        : "context: unavailable";
    try {
      const result = await deps.llmClient.generate(session.accessToken, {
        messages: [
          {
            role: "system",
            content:
              "你是嘉立创 EDA 插件的意图分类器。根据用户输入判断意图：" +
              "chat=闲聊/澄清/解释概念；analysis=分析/检查/排查当前原理图；draft=设计/生成/绘制原理图草案；pcb=绘制PCB。" +
              "仅输出 JSON：{\"intent\":\"chat|analysis|draft|pcb\",\"reason\":\"...\"}",
          },
          { role: "user", content: `用户输入：${userQuery}\n${contextHint}` },
        ],
      });
      const jsonText = result.output_text?.match(/\{[\s\S]*\}/)?.[0] ?? "";
      const parsed = JSON.parse(jsonText) as { intent?: string; reason?: string };
      const intent = parsed.intent ?? "chat";
      return `${intent}${parsed.reason ? ` (${parsed.reason})` : ""}`;
    } catch {
      return "fallback:chat";
    }
  }

  function buildEvidenceItems(input: {
    toolTraces?: AgentResult["toolTraces"];
    reactEvents?: AgentResult["reactEvents"];
    uiEvents?: AgentResult["uiEvents"];
  }): Array<{ label: string; detail: string; source?: "tool" | "react" | "planner" | "executor" }> | undefined {
    const items: Array<{ label: string; detail: string; source?: "tool" | "react" | "planner" | "executor" }> = [];
    const seen = new Set<string>();

    for (const trace of input.toolTraces ?? []) {
      const label = humanizeEvidenceLabel(trace.toolName);
      const detail = trace.note || (trace.status === "success" ? "工具调用成功" : "工具调用失败");
      const key = `tool:${label}:${detail}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      items.push({ label, detail, source: "tool" });
      if (items.length >= 6) {
        return items;
      }
    }

    for (const event of input.reactEvents ?? []) {
      if (event.kind !== "observation" || event.status === "failed") {
        continue;
      }
      const label = event.label || humanizeEvidenceLabel(event.toolName);
      const detail = event.outputSummary || event.text;
      if (!detail) {
        continue;
      }
      const key = `react:${label}:${detail}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      items.push({ label, detail, source: "react" });
      if (items.length >= 6) {
        return items;
      }
    }

    for (const event of input.uiEvents ?? []) {
      if (event.status !== "done" || event.kind === "task" || !event.text) {
        continue;
      }
      const source = event.source === "planner" ? "planner" : "executor";
      const key = `ui:${event.label}:${event.text}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      items.push({ label: event.label, detail: event.text, source });
      if (items.length >= 6) {
        break;
      }
    }

    return items.length > 0 ? items : undefined;
  }

  function humanizeEvidenceLabel(value?: string): string {
    if (!value) {
      return "证据";
    }
    const exact = {
      "editor.get_current_context": "原理图上下文",
      "editor.get_selection": "当前选区",
      "editor.describe_selection": "选区描述",
      "editor.describe_object": "对象描述",
      "editor.find_object": "对象查找",
      "editor.locate": "对象定位",
      "rules.run_schematic_checks": "规则检查",
      "rules.validate_draft": "草案校验",
      "library.search_devices": "器件库搜索",
      "library.get_device": "器件详情",
      "library.get_devices_by_lcsc_ids": "LCSC 器件查询",
      "schematic.summarize_bom": "BOM 摘要",
      "schematic.identify_key_components": "关键器件识别",
      "schematic.identify_functional_blocks": "功能模块识别",
      "schematic.identify_power_domains": "电源域识别",
      "schematic.summarize_connectivity": "连接性摘要",
      "schematic.trace_power_paths": "电源路径追踪",
      "schematic.trace_signal_paths": "信号路径追踪",
      "schematic.trace_control_paths": "控制链路追踪",
      "schematic.build_analysis_evidence": "分析证据构建",
      "issues.locate_first": "问题定位",
      "todo_list": "任务列表",
      "rag.search": "知识检索",
      "rag.build_citations": "引用构建",
      "llm.generate": "LLM 生成",
    };
    if (exact[value]) {
      return exact[value];
    }
    const label = value
      .replace(/\./g, " / ")
      .replace(/_/g, " ")
      .trim();
    return label || "证据";
  }

  function resolveFinalRoute(
    plan: AgentTurnPlan,
    result: AgentResult,
    fallbackRoute: AgentTurnPlan["route"]
  ): AgentTurnPlan["route"] {
    if (result.draftPreview || result.draftPlan) {
      return "draft";
    }
    if (result.analysisReport || result.checkResult) {
      return "analysis";
    }
    if (result.naturalReply) {
      return "chat";
    }
    if (plan.followup?.route === "draft" && (result.draftRisk || result.draftValidation)) {
      return "draft";
    }
    return fallbackRoute;
  }
}

function createAgentToolRegistry(
  adapter: EditorAdapter,
  deps: Pick<PluginAgentDeps, "hostBridge" | "ragClient" | "llmClient" | "sessionStore">,
  options?: { includeIssueTools?: boolean; includeLibraryTools?: boolean }
): ToolRegistry {
  const tools = createBaseToolRegistry(deps);
  for (const tool of createEditorTools(adapter)) {
    tools.register(tool);
  }
  for (const tool of createSchematicSummaryTools()) {
    tools.register(tool);
  }
  if (options?.includeLibraryTools) {
    for (const tool of createLibraryTools(deps.hostBridge)) {
      tools.register(tool);
    }
  }
  for (const tool of createDraftTools()) {
    tools.register(tool);
  }
  for (const tool of createRuleTools()) {
    tools.register(tool);
  }
  if (options?.includeIssueTools) {
    for (const tool of createIssueTools(tools)) {
      tools.register(tool);
    }
  }
  return tools;
}

function createBaseToolRegistry(
  deps: Pick<PluginAgentDeps, "ragClient" | "llmClient" | "sessionStore" | "hostBridge">
): ToolRegistry {
  const tools = new ToolRegistry();
  for (const tool of createServerTools(deps.ragClient, deps.llmClient, deps.sessionStore)) {
    tools.register(tool);
  }
  for (const tool of createLibraryTools(deps.hostBridge)) {
    tools.register(tool);
  }
  for (const tool of createTodoTools()) {
    tools.register(tool);
  }
  return tools;
}
