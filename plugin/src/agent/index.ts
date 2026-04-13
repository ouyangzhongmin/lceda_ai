import type { MainPanelState } from "../ui/panels/mainPanel";
import type { EditorAdapter } from "../editor/adapters/editorAdapter";
import type { SchematicContext } from "../types/schematic";
import type { SessionStore } from "../services/auth/sessionStore";
import type { CustomLlmConfigStore } from "../services/llm/customLlmConfigStore";
import type { LlmProxyClient } from "../services/llm/llmProxyClient";
import type { RagClient } from "../services/rag/ragClient";
import type { AgentResult, AgentTaskType, AgentTurnResult } from "./shared/agentTypes";
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
import { runUnifiedReactAgent } from "./core/unifiedReactAgent";
import type { UnifiedLlmRouteInfo } from "../services/llm/unifiedLlmClient";

export interface PluginAgentDeps {
  llmClient: LlmProxyClient;
  ragClient: RagClient;
  sessionStore: SessionStore;
  customLlmConfigStore: CustomLlmConfigStore;
  llmModeStore: import("../services/llm/llmModeStore").LlmModeStore;
  onLlmRoute?: (info: UnifiedLlmRouteInfo) => void;
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
    signal?: AbortSignal;
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
  }): Promise<AgentResult>;
  handleUserTurn(input: {
    userQuery: string;
    panelState: MainPanelState;
    taskType?: AgentTaskType;
    context?: SchematicContext;
    adapter?: EditorAdapter;
    signal?: AbortSignal;
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
  }): Promise<AgentTurnResult>;
  buildNaturalChatMessage(result: AgentResult): NonNullable<MainPanelState["chatMessages"]>[number];
  buildAnalysisMessages(input: {
    issueCount: number;
    topIssueTitle?: string;
    locateStatus?: string;
    locateLabel?: string;
    analysisReport?: AgentResult["analysisReport"];
    analysisMarkdown?: AgentResult["analysisMarkdown"];
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
    draftNarrative?: AgentResult["draftNarrative"];
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

export function resolveTurnDisposition(
  preferredTaskType: AgentTaskType | undefined,
  result: AgentResult
): Pick<AgentTurnResult, "route"> {
  const fallbackRoute = result.draftPlan || result.draftPreview || result.draftValidation || result.draftRisk
    ? "draft"
    : result.analysisReport || result.checkResult || result.analysisMarkdown
      ? "analysis"
      : "chat";
  const route =
    preferredTaskType === "schematic_draft"
      ? "draft"
      : preferredTaskType === "schematic_analysis"
        ? "analysis"
        : fallbackRoute;
  return { route };
}

export function createPluginAgent(deps: PluginAgentDeps): PluginAgent {
  const filterDisplayReactEvents = (
    reactEvents?: NonNullable<MainPanelState["chatMessages"]>[number]["reactEvents"]
  ): NonNullable<MainPanelState["chatMessages"]>[number]["reactEvents"] | undefined => {
    if (!Array.isArray(reactEvents) || reactEvents.length === 0) {
      return undefined;
    }
    const filtered = reactEvents.filter(
      (event) => event && (event.kind === "tool_call" || event.kind === "observation")
    );
    return filtered.length > 0 ? filtered : undefined;
  };

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

  const buildDraftFollowUpSuggestions = (
    suggestions?: MainPanelState["chatMessages"][number]["suggestions"]
  ): MainPanelState["chatMessages"][number]["suggestions"] => {
    if (Array.isArray(suggestions) && suggestions.length > 0) {
      return suggestions;
    }
    return [
      {
        label: "列主要器件",
        actionType: "ask_followup",
        prompt: "给我列一下这版草案使用的主要元器件和各自作用",
      },
      {
        label: "说明风险",
        actionType: "ask_followup",
        prompt: "这版草案还有哪些阻断风险，为什么现在不能直接应用？",
      },
      {
        label: "继续修改草案",
        actionType: "ask_followup",
        prompt: "基于当前这版草案，不要重做整体方案，只修改我接下来指出的部分",
      },
    ];
  };

  const looksLikeCompleteMarkdownDocument = (value?: string): boolean => {
    const text = String(value || "").trim();
    if (!text) return false;
    const hasHeading = /^(#{1,3})\s+\S/m.test(text);
    const hasStructuredSections = /^##\s+\S/m.test(text) || /^###\s+\S/m.test(text);
    const hasList = /^(?:-|\*|\d+\.)\s+\S/m.test(text);
    return hasHeading && (hasStructuredSections || hasList);
  };

  const buildDraftReportMarkdown = (input: {
    draftPreview: NonNullable<MainPanelState["draftPreview"]>;
    draftRisk?: AgentResult["draftRisk"];
    nextSuggestions?: AgentResult["nextSuggestions"];
  }): string => {
    const { draftPreview, draftRisk, nextSuggestions } = input;
    const selectedDevices = draftPreview.selectedDeviceDetails ?? [];
    const readableComponentRefs = buildReadableComponentRefs(
      draftPreview.componentRefs,
      draftPreview.selectedDeviceDetails
    );
    const lines = [
      "## 草案范围",
      `- 标题：${draftPreview.title}`,
      `- 说明：${draftPreview.rationale}`,
      `- 器件数量：${draftPreview.componentCount}`,
      `- 网络数量：${draftPreview.netCount}`,
      "",
      "## 关键器件",
      ...(selectedDevices.length > 0
        ? readableComponentRefs.map((item) => `- ${item}`)
        : readableComponentRefs.length > 0
          ? readableComponentRefs.map((item) => `- ${item}`)
          : ["- 未返回关键器件详情"]),
      "",
      "## 主要网络",
      ...(draftPreview.netNames.length > 0
        ? buildReadableNetNames(draftPreview.netNames).map((item) => `- ${item}`)
        : ["- 未返回网络列表"]),
    ];

    if (draftRisk) {
      lines.push("", "## 风险结论");
      lines.push(`- 风险等级：${draftRisk.level}`);
      lines.push(`- 说明：${draftRisk.message}`);
    }

    lines.push("", "## 下一步");
    if (nextSuggestions && nextSuggestions.length > 0) {
      lines.push(...nextSuggestions.map((item, index) => `${index + 1}. ${item}`));
    } else {
      lines.push("1. 先人工确认关键器件与主要网络命名");
      lines.push("2. 再决定是否应用草案或继续局部修改");
    }

    return lines.join("\n");
  };

  const summarizeDraftRationale = (value?: string): string => {
    const text = String(value || "").trim();
    if (!text) {
      return "未返回草案说明。";
    }
    const stopMarkers = ["已检索到知识依据", "未匹配到专用草案模板", "回退到通用草案生成", "已选器件:"];
    let end = text.length;
    for (const marker of stopMarkers) {
      const index = text.indexOf(marker);
      if (index >= 0 && index < end) {
        end = index;
      }
    }
    const cleaned = text.slice(0, end).trim();
    return cleaned || text;
  };

  const summarizeDraftList = (items: string[], overflowLabel: string, limit = 3): string[] => {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }
    if (items.length <= limit) {
      return items;
    }
    return [...items.slice(0, limit), `另有 ${items.length - limit} ${overflowLabel}未展开`];
  };

  const draftRoleLabels: Record<string, { label: string; purpose?: string }> = {
    power_connector: { label: "电源输入接口", purpose: "用于接入外部电源，连接到充电与供电链路" },
    usb_type_c: { label: "USB-C 接口", purpose: "用于接入 USB 电源或数据连接" },
    mcu_module: { label: "主控模块", purpose: "作为整机控制与通信核心" },
    charger: { label: "锂电池充电芯片", purpose: "用于给锂电池充电并管理充电状态" },
    ldo_regulator: { label: "稳压芯片", purpose: "用于把输入电压稳压到系统所需电源轨" },
    audio_codec: { label: "音频编解码器", purpose: "用于处理麦克风输入和扬声器输出音频" },
    led: { label: "指示灯", purpose: "用于显示电源、状态或工作指示" },
  };

  const humanizeDraftDetail = (value: string): string => {
    const text = String(value || "").trim();
    if (!text) return text;

    const unresolvedMatch = text.match(/^([^/]+)\s*\/\s*([a-z0-9_]+):\s*(.*)$/i);
    if (unresolvedMatch) {
      const ref = unresolvedMatch[1]?.trim();
      const role = unresolvedMatch[2]?.trim().toLowerCase();
      const rest = unresolvedMatch[3]?.trim();
      const roleMeta = draftRoleLabels[role];
      if (roleMeta) {
        return `${ref} ${roleMeta.label}：${rest}`;
      }
      return text;
    }

    const selectedMatch = text.match(/^([a-z0-9_]+):\s*(.+)$/i);
    if (selectedMatch) {
      const role = selectedMatch[1]?.trim().toLowerCase();
      const rest = selectedMatch[2]?.trim();
      const roleMeta = draftRoleLabels[role];
      if (roleMeta) {
        return roleMeta.purpose ? `${roleMeta.label}：${rest}。${roleMeta.purpose}。` : `${roleMeta.label}：${rest}`;
      }
    }

    return text;
  };

  const buildReadableComponentRefs = (componentRefs: string[], selectedDeviceDetails?: string[]): string[] => {
    if (!Array.isArray(componentRefs) || componentRefs.length === 0) {
      return [];
    }
    const details = Array.isArray(selectedDeviceDetails) ? selectedDeviceDetails : [];
    if (details.length === 0) {
      return componentRefs;
    }
    const roleLabels = details.map((item) => {
      const match = String(item || "").trim().match(/^([a-z0-9_]+):/i);
      if (!match) return undefined;
      return draftRoleLabels[match[1].toLowerCase()]?.label;
    });
    return componentRefs.map((ref, index) => {
      const label = roleLabels[index];
      return label ? `${ref} ${label}` : ref;
    });
  };

  const humanizeNetName = (value: string): string => {
    const net = String(value || "").trim();
    if (!net) return net;
    const upper = net.toUpperCase();
    if (upper === "5V" || upper === "VCC_5V") return "5V 外部输入电源";
    if (upper === "VBAT" || upper === "VCC_BAT" || upper === "BAT") return "VBAT 电池电源";
    if (upper === "3V3" || upper === "VDD3V3") return "3V3 主系统 3.3V 电源";
    if (upper === "GND" || upper === "PGND" || upper === "AGND") return "GND 地线";
    if (upper === "I2C_SDA") return "I2C_SDA I2C 数据线";
    if (upper === "I2C_SCL") return "I2C_SCL I2C 时钟线";
    if (upper === "TXD" || upper === "UART_TX") return "TXD 串口发送";
    if (upper === "RXD" || upper === "UART_RX") return "RXD 串口接收";
    return net;
  };

  const buildReadableNetNames = (netNames: string[]): string[] => {
    return (Array.isArray(netNames) ? netNames : []).map(humanizeNetName);
  };

  const buildNaturalChatFallback = (result: AgentResult): string => {
    const failedToolNotes = (result.toolTraces ?? [])
      .filter((trace) => trace.status === "blocked")
      .map((trace) => `${trace.toolName}: ${trace.note || "调用失败"}`);
    const failedObservations = (result.reactEvents ?? [])
      .filter((event) => event?.kind === "observation" && event.status === "failed")
      .map((event) => `${event.toolName || event.label || "tool"}: ${event.outputSummary || event.text || "调用失败"}`);
    const failedDetails = [...new Set([...failedToolNotes, ...failedObservations])].filter(Boolean);
    if (failedDetails.length > 0) {
      return `本轮生成失败，关键错误：${failedDetails.slice(0, 2).join("；")}。请稍后重试。`;
    }
    return "本轮未生成最终回复，请重试。";
  };

  return {
    createToolRegistry: (adapter, options) => createAgentToolRegistry(adapter, deps, options),
    run: async (input) => {
      const toolRegistry = (() => {
        if (input.adapter) {
          return createAgentToolRegistry(input.adapter, deps, { includeIssueTools: true, includeLibraryTools: true });
        }
        return createBaseToolRegistry(deps);
      })();
      for (const tool of createMcpTools(deps.mcpClient)) {
        toolRegistry.register(tool);
      }
      const allowedTools = toolRegistry
        .list()
        .filter((tool) => !tool.requiresConfirmation) // hard-safety boundary
        .map((tool) => tool.name);

      if (input.type === "natural_chat") {
        if (!input.panelState) {
          throw new Error("panelState is required for natural_chat");
        }
        const { result } = await runUnifiedReactAgent({
          taskType: input.type,
          userQuery: input.userQuery,
          panelState: input.panelState,
          adapter: input.adapter,
          context: input.context,
          tools: toolRegistry,
          allowedTools,
          signal: input.signal,
          onStreamEvent: input.onStreamEvent,
        });
        return result;
      }
      if (input.type === "schematic_analysis") {
        if (!input.context || !input.adapter) {
          throw new Error("context and adapter are required for schematic_analysis");
        }
        const { result } = await runUnifiedReactAgent({
          taskType: input.type,
          userQuery: input.userQuery,
          panelState: input.panelState ?? ({} as MainPanelState),
          adapter: input.adapter,
          context: input.context,
          tools: toolRegistry,
          allowedTools,
          signal: input.signal,
          onStreamEvent: input.onStreamEvent,
        });
        return result;
      }
      if (!input.context || !input.adapter) {
        throw new Error("context and adapter are required for schematic_draft");
      }
      const { result } = await runUnifiedReactAgent({
        taskType: input.type,
        userQuery: input.userQuery,
        panelState: input.panelState ?? ({} as MainPanelState),
        adapter: input.adapter,
        context: input.context,
        tools: toolRegistry,
        allowedTools,
        signal: input.signal,
        onStreamEvent: input.onStreamEvent,
      });
      return result;
    },
    handleUserTurn: async (input) => {
      const taskType = input.taskType ?? "natural_chat";
      const adapter = input.adapter;
      const tools = adapter
        ? createAgentToolRegistry(adapter, deps, { includeIssueTools: true, includeLibraryTools: true })
        : createBaseToolRegistry(deps);
      for (const tool of createMcpTools(deps.mcpClient)) {
        tools.register(tool);
      }
      const allowedTools = tools
        .list()
        .filter((tool) => !tool.requiresConfirmation)
        .map((tool) => tool.name);

      const { result } = await runUnifiedReactAgent({
        taskType,
        userQuery: input.userQuery,
        panelState: input.panelState,
        context: input.context,
        adapter,
        tools,
        allowedTools,
        signal: input.signal,
        onStreamEvent: input.onStreamEvent,
      });
      const disposition = resolveTurnDisposition(taskType, result);
      return {
        route: disposition.route,
        result,
      };
    },
    buildNaturalChatMessage: (result) => {
      const reactEvents = filterDisplayReactEvents(result.reactEvents);
      const hasToolSteps = Array.isArray(reactEvents) && reactEvents.length > 0;
      return {
        role: "assistant",
        title: "助手",
        content:
          result.summary === "missing access token for natural chat"
            ? "当前未检测到有效登录态，无法调用在线模型。请先登录。"
            : result.naturalReply ?? buildNaturalChatFallback(result),
        toolTraces: result.toolTraces,
        executionTraces: result.executionTraces,
        uiEvents: undefined,
        reactEvents,
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
      const displayReactEvents = filterDisplayReactEvents(input.reactEvents);
      const report = input.analysisReport;
      const schematicEntries = [
        report?.schematicInfo?.pageName ? `原理图：${report.schematicInfo.pageName}` : "",
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
      const markdownOnly = input.analysisMarkdown && input.analysisMarkdown.trim().length > 0;
      return [
        {
          role: "assistant",
          title: "分析结果",
          tone: input.issueCount > 0 ? "warning" : "success",
          analysisMarkdown: input.analysisMarkdown,
          content:
            markdownOnly
              ? input.analysisMarkdown!
              : input.issueCount > 0
                ? `${report?.overview ?? `我已经完成当前原理图的首轮检查，发现 ${input.issueCount} 个需要关注的问题。`}${schematicInfoHint}${executiveSummaryHint}${ercSummaryHint}${bomOverviewHint}${functionalBlocksHint}${powerDomainsHint}${powerPathsHint}${signalPathsHint}${controlPathsHint}${keyComponentsHint}\n\n优先问题：${
                    input.topIssueTitle ?? "未命名问题"
                  }\n定位结果：${input.locateLabel || formatLocateStatus(input.locateStatus)}\n\n${issueLines || "暂无可定位问题。"}${riskHint}${libraryHint}${suggestionHint}`
                : `${report?.overview ?? "当前原理图未发现明显规则问题，可以继续进行草案生成或更深入问答。"}${schematicInfoHint}${executiveSummaryHint}${ercSummaryHint}${bomOverviewHint}${functionalBlocksHint}${powerDomainsHint}${powerPathsHint}${signalPathsHint}${controlPathsHint}${keyComponentsHint}${riskHint}${libraryHint}${suggestionHint}`,
          structuredContent: markdownOnly ? undefined : structuredContent,
          evidenceItems: buildEvidenceItems({
            toolTraces: input.toolTraces,
            reactEvents: displayReactEvents,
            uiEvents: input.uiEvents,
          }),
          toolTraces: input.toolTraces,
          executionTraces: input.executionTraces,
          uiEvents: input.uiEvents,
          reactEvents: displayReactEvents,
          stepTranscript: buildStepTranscript(displayReactEvents),
          stepStates: input.stepStates,
          workingMemory: input.workingMemory,
          analysisReport: input.analysisReport,
          suggestions: input.structuredSuggestions,
          actions,
        },
      ];
    },
    buildDraftMessages: (input) => {
      const displayReactEvents = filterDisplayReactEvents(input.reactEvents);
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
      const hasUnresolvedDevices = Boolean(preview.unresolvedDeviceDetails && preview.unresolvedDeviceDetails.length > 0);
      const suggestions = buildDraftFollowUpSuggestions(input.structuredSuggestions);
      const narrativeText = String(input.draftNarrative || "").trim();
      const preferNarrativeMarkdown = looksLikeCompleteMarkdownDocument(narrativeText);
      const reportMarkdown = buildDraftReportMarkdown({
        draftPreview: preview,
        draftRisk: input.draftRisk,
        nextSuggestions: input.nextSuggestions,
      });
      const readableComponentRefs = buildReadableComponentRefs(
        preview.componentRefs,
        preview.selectedDeviceDetails
      );
      const readableNetNames = buildReadableNetNames(preview.netNames);
      const actions =
        input.draftRisk?.level === "blocked"
          ? [
              {
                label: "重新分析",
                action: "rerun" as const,
              },
            ]
          : hasUnresolvedDevices
            ? [
                {
                  label: "选择器件",
                  action: "select_devices" as const,
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
      const structuredContent = preferNarrativeMarkdown ? undefined : buildDraftStructuredContent(input);
      return [
        {
          role: "assistant",
          title: "草案草图",
          tone: input.draftRisk?.level === "blocked" ? "warning" : "success",
            content: preferNarrativeMarkdown
              ? narrativeText
              : `${narrativeText || "我已经生成一版草案。"}\n\n标题：${preview.title}\n说明：${preview.rationale}\n器件：${readableComponentRefs.join(
                  "、"
                )}\n网络：${readableNetNames.join("、")}${mcpHint}${mcpReadHint}${riskHint}${suggestionHint}\n\n下一步应进入人工确认，再决定是否 apply-plan。`,
            structuredContent,
            evidenceItems: buildEvidenceItems({
              toolTraces: input.toolTraces,
             reactEvents: displayReactEvents,
             uiEvents: input.uiEvents,
           }),
             toolTraces: input.toolTraces,
            executionTraces: input.executionTraces,
            uiEvents: input.uiEvents,
             reactEvents: displayReactEvents,
              stepTranscript: buildStepTranscript(displayReactEvents),
              stepStates: input.stepStates,
              workingMemory: input.workingMemory,
              reportMarkdown: preferNarrativeMarkdown ? undefined : reportMarkdown,
               suggestions,
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

    const pageName = String(report?.schematicInfo?.pageName || "").trim();
    const dominantIssueTitle = (() => {
      const groups = report?.issueGroups ?? [];
      if (!groups.length) return "";
      const severityRank = (value: string) => (value === "high" ? 2 : value === "medium" ? 1 : 0);
      return groups
        .slice()
        .sort((a, b) => (b.count - a.count) || (severityRank(b.severity) - severityRank(a.severity)))[0]
        ?.title?.trim?.() ?? "";
    })();

    const schematicEntries = [
      report?.schematicInfo?.pageName ? { key: "原理图", value: report.schematicInfo.pageName } : null,
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
    const schematicMeta =
      schematicEntries.length > 0
        ? schematicEntries.map((item) => `${item.key} ${item.value}`).join(" · ")
        : "";

    const leadBase =
      input.issueCount > 0
        ? `已完成当前原理图${pageName ? `【${pageName}】` : ""}检查，发现 ${input.issueCount} 个需要关注的问题` +
          (dominantIssueTitle ? `，当前以${dominantIssueTitle}为主。` : "。")
        : `已完成当前原理图${pageName ? `【${pageName}】` : ""}检查，未发现明显规则问题。`;

    blocks.push({
      kind: "paragraph",
      text:
        leadBase + (schematicMeta ? `（${schematicMeta}）` : ""),
    });

    // Prefer issue-first layout when issues exist: keep report short and actionable.
    const issueFirst = input.issueCount > 0;

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

    if (report?.issueGroups && report.issueGroups.length > 0) {
      const groupLines = report.issueGroups.slice(0, 4).map((group) => {
        const severity = group.severity === "high" ? "高" : group.severity === "low" ? "低" : "中";
        const examples = group.examples && group.examples.length > 0 ? `；代表：${group.examples.join("、")}` : "";
        const suggestion = group.suggestion ? `；建议：${group.suggestion}` : "";
        return `【${severity}风险】${group.title}：${group.count} 个${examples}${suggestion}`;
      });
      blocks.push({
        kind: "list",
        title: "问题聚合（按类型）",
        items: groupLines,
      });
    }

    if (report?.issueSamples && report.issueSamples.length > 0) {
      const sampleLines = report.issueSamples.slice(0, 6).map((item) => {
        const severity = item.severity === "high" ? "高" : item.severity === "low" ? "低" : "中";
        const parts = [
          `【${severity}风险】${item.title}`,
          item.label ? `对象：${item.label}` : "",
          item.message ? `影响：${item.message}` : "",
          item.suggestion ? `建议：${item.suggestion}` : "",
        ].filter(Boolean);
        return parts.join("\n");
      });
      blocks.push({
        kind: "list",
        title: "问题样本（抽样）",
        items: sampleLines,
      });
    }

    if (!issueFirst) {
      if (report?.executiveSummary) {
        blocks.push({
          kind: "section",
          title: "整图理解",
          text: report.executiveSummary,
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
      pushStructuredList(blocks, "连接性检查", report?.connectivityChecks);
    } else {
      // Keep one lightweight context block when issues exist.
      const compactContext = [
        ...(report?.functionalBlocks ?? []).slice(0, 3),
        ...(report?.keyComponents ?? []).slice(0, 3),
      ].filter(Boolean);
      if (compactContext.length > 0) {
        blocks.push({
          kind: "list",
          title: "关联模块与关键器件（摘要）",
          items: compactContext.slice(0, 6),
        });
      }
      if (report?.connectivityChecks && report.connectivityChecks.length > 0) {
        blocks.push({
          kind: "list",
          title: "连接性与电源路径提示（摘要）",
          items: report.connectivityChecks.slice(0, 4),
        });
      }
    }

    const severityCounts = (groups?: NonNullable<NonNullable<AgentResult["analysisReport"]>["issueGroups"]>) => {
      const counts = { high: 0, medium: 0, low: 0 };
      (groups ?? []).forEach((g) => {
        if (!g || !g.severity || !g.count) return;
        if (g.severity === "high") counts.high += g.count;
        else if (g.severity === "low") counts.low += g.count;
        else counts.medium += g.count;
      });
      return counts;
    };
    const counts = report?.issueGroups?.length ? severityCounts(report.issueGroups) : undefined;
    const riskEntries = [
      typeof input.issueCount === "number" ? { key: "问题总数", value: String(input.issueCount) } : null,
      counts ? { key: "高风险", value: String(counts.high) } : null,
      counts ? { key: "中风险", value: String(counts.medium) } : null,
      counts ? { key: "低风险", value: String(counts.low) } : null,
    ].filter(Boolean) as Array<{ key: string; value: string }>;
    if (riskEntries.length > 0) {
      blocks.push({
        kind: "kv",
        title: "风险概览",
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
        items: nextSteps.slice(0, 4),
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
    const readableComponents = buildReadableComponentRefs(preview.componentRefs, preview.selectedDeviceDetails);
    const readableNets = buildReadableNetNames(preview.netNames);
    const selectedItems = (preview.selectedDeviceDetails ?? []).map(humanizeDraftDetail);
    const unresolvedItems = (preview.unresolvedDeviceDetails ?? []).map(humanizeDraftDetail);
    const roleHints = Array.from(
      new Set(
        [...(preview.selectedDeviceDetails ?? []), ...(preview.unresolvedDeviceDetails ?? [])]
          .map(extractDraftRoleLabel)
          .filter(Boolean)
      )
    );
    const leadText = String(input.draftNarrative || "").trim()
      || (input.draftRisk || unresolvedItems.length > 0
        ? "已生成一版可继续讨论和修正的草案，但当前还有待确认项，不建议直接应用。"
        : "已生成一版可进入人工确认的草案。");
    const statusEntries = [
      {
        key: "已确定",
        value:
          selectedItems.length > 0
            ? `${selectedItems.length} 个关键器件/模块已明确`
            : `${preview.componentCount} 个器件已纳入本版方案`,
      },
      {
        key: "待确认",
        value: unresolvedItems.length > 0 ? `${unresolvedItems.length} 项仍需人工确认` : "当前未发现待确认器件",
      },
      {
        key: "风险",
        value: input.draftRisk?.message || (unresolvedItems.length > 0 ? "存在未定器件，暂不建议直接应用" : "未返回明确阻断风险"),
      },
      {
        key: "下一动作",
        value:
          unresolvedItems.length > 0 || input.draftRisk?.level === "blocked"
            ? "先确认器件与连接，再决定是否应用"
            : "人工复核后可继续应用或局部修改",
      },
    ];
    const capabilityItems =
      buildDraftCapabilityItems({
        roleHints,
        readableNets,
        rationale: summarizeDraftRationale(preview.rationale),
      });
    const moduleItems =
      selectedItems.length > 0
        ? summarizeDraftList(selectedItems, "个模块")
        : readableComponents.length > 0
          ? summarizeDraftList(readableComponents, "个器件")
          : ["未返回关键模块信息"];
    const nextItems =
      input.nextSuggestions && input.nextSuggestions.length > 0
        ? input.nextSuggestions
        : [
            "先人工确认关键器件是否符合成本、封装和采购预期",
            "确认主电源链路与主要网络命名后，再决定是否 apply-plan",
          ];
    const supportingItems: string[] = [];
    if (preview.guidanceSummary?.rationale) {
      supportingItems.push(`生成依据：${preview.guidanceSummary.rationale}`);
    }
    if (preview.guidanceSummary?.templateId) {
      supportingItems.push(`参考模板：${preview.guidanceSummary.templateId}`);
    }
    if (preview.guidanceSummary?.evidence?.length) {
      supportingItems.push(...preview.guidanceSummary.evidence.slice(0, 2));
    }
    if (input.mcpResourceReads?.length) {
      supportingItems.push(...input.mcpResourceReads.slice(0, 2).map((item) => `${item.title}：${item.summary}`));
    }

    const blocks: NonNullable<NonNullable<MainPanelState["chatMessages"]>[number]["structuredContent"]> = [
      { kind: "paragraph", text: leadText },
      {
        kind: "section",
        title: "这版方案",
        text: `${preview.title}\n${summarizeDraftRationale(preview.rationale)}`,
      },
      {
        kind: "list",
        title: "核心能力",
        items: capabilityItems,
      },
      {
        kind: "list",
        title: "关键模块与器件",
        items: moduleItems,
      },
      {
        kind: "list",
        title: "关键网络",
        items: readableNets.length > 0 ? summarizeDraftList(readableNets, "条网络", 4) : ["未返回关键网络"],
      },
      {
        kind: "kv",
        title: "当前状态",
        entries: statusEntries,
      },
    ];

    if (unresolvedItems.length > 0) {
      blocks.push({
        kind: "list",
        title: "待确认项",
        items: unresolvedItems,
      });
    }

    blocks.push({
      kind: "list",
      title: "下一步建议",
      items: nextItems,
    });

    if (supportingItems.length > 0) {
      blocks.push({
        kind: "list",
        title: "补充依据",
        items: supportingItems,
      });
    }

    return blocks;
  }

  function extractDraftRoleLabel(detail?: string): string | undefined {
    const text = String(detail || "").trim();
    if (!text) return undefined;
    const selectedMatch = text.match(/^([a-z0-9_]+):/i);
    if (selectedMatch) {
      return draftRoleLabels[selectedMatch[1].toLowerCase()]?.label;
    }
    const unresolvedMatch = text.match(/\/\s*([a-z0-9_]+)\s*:/i);
    if (unresolvedMatch) {
      return draftRoleLabels[unresolvedMatch[1].toLowerCase()]?.label;
    }
    return undefined;
  }

  function buildDraftCapabilityItems(input: {
    roleHints: string[];
    readableNets: string[];
    rationale: string;
  }): string[] {
    const items: string[] = [];
    const push = (value?: string) => {
      const text = String(value || "").trim();
      if (!text || items.includes(text)) return;
      items.push(text);
    };

    input.roleHints.forEach((label) => {
      if (label === "电源输入接口" || label === "USB-C 接口") {
        push("支持外部供电接入，作为整机电源入口");
      } else if (label === "锂电池充电芯片") {
        push("包含锂电池充电与电源切换链路");
      } else if (label === "稳压芯片") {
        push("包含系统稳压，给主系统提供稳定工作电源");
      } else if (label === "主控模块") {
        push("以主控模块作为整机控制与连接核心");
      } else if (label === "音频编解码器") {
        push("预留语音输入输出所需的音频处理链路");
      } else if (label === "指示灯") {
        push("包含基础状态指示能力");
      }
    });

    if (input.readableNets.some((item) => item.includes("VBAT"))) {
      push("包含电池电源域与主系统电源域的基础划分");
    }
    if (input.readableNets.some((item) => item.includes("3V3"))) {
      push("主系统以 3.3V 电源轨作为核心供电");
    }
    if (items.length === 0 && input.rationale) {
      input.rationale
        .split(/[。；]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 3)
        .forEach(push);
    }
    if (items.length === 0) {
      push("当前返回的是一版最小可用草案，适合继续确认器件与连接");
    }
    return items.slice(0, 4);
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
      "editor_get_current_context": "原理图上下文",
      "editor_get_selection": "当前选区",
      "editor_describe_selection": "选区描述",
      "editor_describe_object": "对象描述",
      "editor_find_object": "对象查找",
      "editor_locate": "对象定位",
      "rules_run_schematic_checks": "规则检查",
      "rules_validate_draft": "草案校验",
      "library_search_devices": "器件库搜索",
      "library_get_device": "器件详情",
      "library_get_devices_by_lcsc_ids": "LCSC 器件查询",
      "schematic_summarize_bom": "BOM 摘要",
      "schematic_identify_key_components": "关键器件识别",
      "schematic_identify_functional_blocks": "功能模块识别",
      "schematic_identify_power_domains": "电源域识别",
      "schematic_summarize_connectivity": "连接性摘要",
      "schematic_trace_power_paths": "电源路径追踪",
      "schematic_trace_signal_paths": "信号路径追踪",
      "schematic_trace_control_paths": "控制链路追踪",
      "schematic_build_analysis_evidence": "分析证据构建",
      "issues_locate_first": "问题定位",
      "todo_list": "任务列表",
      "rag_search": "知识检索",
      "rag_build_citations": "引用构建",
      "llm_generate": "LLM 生成",
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

}

function createAgentToolRegistry(
  adapter: EditorAdapter,
  deps: Pick<PluginAgentDeps, "hostBridge" | "ragClient" | "llmClient" | "sessionStore" | "customLlmConfigStore" | "llmModeStore">,
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
  for (const tool of createDraftTools(
    deps.ragClient,
    deps.hostBridge?.searchLibraryDevices,
    deps.hostBridge?.getLibraryDevice
  )) {
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
  deps: Pick<
    PluginAgentDeps,
    "ragClient" | "llmClient" | "sessionStore" | "hostBridge" | "customLlmConfigStore" | "llmModeStore" | "onLlmRoute"
  >
): ToolRegistry {
  const tools = new ToolRegistry();
  for (const tool of createServerTools(
    deps.ragClient,
    deps.llmClient,
    deps.sessionStore,
    deps.customLlmConfigStore,
    deps.llmModeStore,
    deps.onLlmRoute
  )) {
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
