import { buildAnalysisSystemPrompt, buildAnalysisSummaryPrompt, buildAnalysisUserPrompt } from "../prompts/analysisPrompts";
import type { AgentResult, AgentStepState, AgentTask, AgentToolTrace, AgentWorkingMemory } from "../shared/agentTypes";
import type { ReactAgentDeps, ReactAgentRunResult, ReactAgentState } from "./reactTypes";

interface SchematicBomSummary {
  componentCount: number;
  categories: Array<{ category: string; count: number; examples: string[] }>;
}

interface SchematicKeyComponentsSummary {
  keyComponents: Array<{ ref: string; label: string; reason: string }>;
}

interface SchematicFunctionalBlocksSummary {
  functionalBlocks: Array<{ name: string; evidence: string[]; netHints: string[] }>;
}

interface SchematicPowerDomainsSummary {
  powerDomains: Array<{ name: string; nodeCount: number; attachedComponents: string[] }>;
}

interface SchematicConnectivitySummary {
  netCount: number;
  selectionCount: number;
  connectivityNotes: string[];
}

interface SchematicPowerPathSummary {
  paths: Array<{ sourceNet: string; path: string[]; note: string }>;
}

interface SchematicSignalPathSummary {
  paths: Array<{ block: string; path: string[]; note: string }>;
}

interface SchematicControlPathSummary {
  paths: Array<{ controller: string; target: string; path: string[]; note: string }>;
}

interface SchematicOverviewSummary {
  componentCount: number;
  netCount: number;
  selectionCount: number;
  categories: Array<{ category: string; count: number; examples: string[] }>;
  keyComponents: Array<{ ref: string; label: string; reason: string }>;
  functionalBlocks: Array<{ name: string; evidence: string[] }>;
  powerDomains: Array<{ name: string; nodeCount: number; attachedComponents: string[] }>;
  powerPaths?: Array<{ sourceNet: string; path: string[]; note: string }>;
  signalPaths?: Array<{ block: string; path: string[]; note: string }>;
  controlPaths?: Array<{ controller: string; target: string; path: string[]; note: string }>;
  connectivityNotes: string[];
}

interface LibrarySearchResultItem {
  name: string;
  uuid: string;
  libraryUuid: string;
  manufacturer?: string;
  footprintUuid?: string;
  footprintName?: string;
  symbolUuid?: string;
  symbolName?: string;
  description?: string;
}

interface McpResourcesResult {
  resources: Array<{ uri: string; description: string }>;
}

interface McpResourceReadResult {
  uri: string;
  title: string;
  summary: string;
  content: string;
}

export async function runAnalysisReactAgent(deps: ReactAgentDeps): Promise<ReactAgentRunResult> {
  assertContext(deps.task);
  const state: ReactAgentState = {
    toolTraces: [],
    stepStates: [],
    workingMemory: createWorkingMemory(deps.task),
    reactEvents: [],
  };

  const context = deps.task.context;
  const mcpResources: Array<{ uri: string; description: string }> = [];
  const mcpResourceReads: Array<{ uri: string; title: string; summary: string }> = [];
  const libraryInsights: NonNullable<AgentResult["libraryInsights"]> = [];
  let bomSummary: SchematicBomSummary | undefined;
  let keyComponentsSummary: SchematicKeyComponentsSummary | undefined;
  let functionalBlocksSummary: SchematicFunctionalBlocksSummary | undefined;
  let powerDomainsSummary: SchematicPowerDomainsSummary | undefined;
  let connectivitySummary: SchematicConnectivitySummary | undefined;
  let powerPathSummary: SchematicPowerPathSummary | undefined;
  let signalPathSummary: SchematicSignalPathSummary | undefined;
  let controlPathSummary: SchematicControlPathSummary | undefined;
  let overviewSummary: SchematicOverviewSummary | undefined;
  let liveContext = context;
  let checkResult: AgentResult["checkResult"] | undefined;
  let locateResult: AgentResult["locateResult"] = { located: false };
  let analysisReport: AgentResult["analysisReport"] | undefined;

  const planSteps = deps.task.planSteps?.length ? deps.task.planSteps : [
    { kind: "context", note: "读取当前原理图上下文并准备检查输入" },
    { kind: "mcp", note: "提取整图摘要、模块与知识证据" },
    { kind: "rules", note: "调用 jlceda_schematic_check 完成原理图规则检查" },
    { kind: "library", note: "根据已发现的问题器件查询 EDA 元件库信息" },
    { kind: "llm", note: "整理检查结果并生成问题报告" },
  ];
  const plannedStepKinds = new Set(planSteps.map((step) => step.kind));
  const shouldRun = (kind: AgentStepState["kind"]) => plannedStepKinds.has(kind);
  const taskLabels = planSteps.map((step, index) => `${index + 1}. ${step.note}`);
  const buildTodoTasks = (overrides?: Partial<Record<AgentStepState["kind"], "pending" | "running" | "done" | "failed" | "skipped">>) =>
    planSteps.map((step, index) => ({
      text: `${index + 1}. ${step.note}`,
      status: overrides?.[step.kind] ?? "pending",
    }));
  const updateTodoList = async (
    overrides?: Partial<Record<AgentStepState["kind"], "pending" | "running" | "done" | "failed" | "skipped">>,
    goal = "更新任务列表"
  ) => {
    await invokeObserved<{ action?: string; tasks: Array<{ text: string; status: string }> }, { tasks: Array<{ id: number; text: string; status: string }> }>(
      deps,
      state,
      "todo_list",
      { action: "update", tasks: buildTodoTasks(overrides) },
      goal
    );
  };
  await invokeObserved<{ action?: string; tasks: Array<{ text: string; status: string }> }, { tasks: Array<{ id: number; text: string; status: string }> }>(
    deps,
    state,
    "todo_list",
    { action: "create", tasks: buildTodoTasks() },
    "创建任务列表"
  );
  const tasks = {
    context: pushTask(state, "context", planSteps.find((step) => step.kind === "context")?.note || "读取当前原理图上下文并准备检查输入"),
    mcp: pushTask(state, "mcp", planSteps.find((step) => step.kind === "mcp")?.note || "提取整图摘要、模块与知识证据"),
    rules: pushTask(state, "rules", planSteps.find((step) => step.kind === "rules")?.note || "调用 jlceda_schematic_check 完成原理图规则检查"),
    library: pushTask(state, "library", planSteps.find((step) => step.kind === "library")?.note || "根据已发现的问题器件查询 EDA 元件库信息"),
    llm: pushTask(state, "llm", planSteps.find((step) => step.kind === "llm")?.note || "整理检查结果并生成问题报告"),
  };
  emitProgress(deps, state, "开始分析原理图");

  if (
    shouldRun("mcp") &&
    (canUse(deps, "schematic.summarize_bom") ||
      canUse(deps, "schematic.identify_key_components") ||
      canUse(deps, "schematic.identify_functional_blocks") ||
      canUse(deps, "schematic.identify_power_domains") ||
      canUse(deps, "schematic.summarize_connectivity") ||
      canUse(deps, "schematic.trace_power_paths") ||
      canUse(deps, "schematic.trace_signal_paths") ||
      canUse(deps, "schematic.trace_control_paths"))
  ) {
    await updateTodoList({ mcp: "running" }, "更新任务列表：mcp");
    updateTask(state, tasks.mcp, "running");
    thought(state, "Overview", "先按器件分类、关键器件、功能模块和电源域拆分提取整图观测证据。", "mcp");
    emitProgress(deps, state, "正在提取整图理解与知识证据");
    if (canUse(deps, "schematic.summarize_bom")) {
      bomSummary = await invokeObserved<{ context: NonNullable<AgentTask["context"]> }, SchematicBomSummary>(
        deps,
        state,
        "schematic.summarize_bom",
        { context: liveContext },
        "提取 BOM 分类概览"
      );
    }
    if (canUse(deps, "schematic.identify_key_components")) {
      keyComponentsSummary = await invokeObserved<{ context: NonNullable<AgentTask["context"]> }, SchematicKeyComponentsSummary>(
        deps,
        state,
        "schematic.identify_key_components",
        { context: liveContext },
        "识别关键器件"
      );
    }
    if (canUse(deps, "schematic.identify_functional_blocks")) {
      functionalBlocksSummary = await invokeObserved<{ context: NonNullable<AgentTask["context"]> }, SchematicFunctionalBlocksSummary>(
        deps,
        state,
        "schematic.identify_functional_blocks",
        { context: liveContext },
        "识别功能模块"
      );
    }
    if (canUse(deps, "schematic.identify_power_domains")) {
      powerDomainsSummary = await invokeObserved<{ context: NonNullable<AgentTask["context"]> }, SchematicPowerDomainsSummary>(
        deps,
        state,
        "schematic.identify_power_domains",
        { context: liveContext },
        "识别电源域"
      );
    }
    if (canUse(deps, "schematic.summarize_connectivity")) {
      connectivitySummary = await invokeObserved<{ context: NonNullable<AgentTask["context"]> }, SchematicConnectivitySummary>(
        deps,
        state,
        "schematic.summarize_connectivity",
        { context: liveContext },
        "提取连接性摘要"
      );
    }
    if (canUse(deps, "schematic.trace_power_paths")) {
      powerPathSummary = await invokeObserved<{ context: NonNullable<AgentTask["context"]> }, SchematicPowerPathSummary>(
        deps,
        state,
        "schematic.trace_power_paths",
        { context: liveContext },
        "追踪关键电源路径"
      );
    }
    if (canUse(deps, "schematic.trace_signal_paths")) {
      signalPathSummary = await invokeObserved<{ context: NonNullable<AgentTask["context"]> }, SchematicSignalPathSummary>(
        deps,
        state,
        "schematic.trace_signal_paths",
        { context: liveContext },
        "追踪主要信号路径"
      );
    }
    if (canUse(deps, "schematic.trace_control_paths")) {
      controlPathSummary = await invokeObserved<{ context: NonNullable<AgentTask["context"]> }, SchematicControlPathSummary>(
        deps,
        state,
        "schematic.trace_control_paths",
        { context: liveContext },
        "追踪主控中心链路"
      );
    }
    overviewSummary = {
      componentCount: bomSummary?.componentCount ?? liveContext.components.length,
      netCount: connectivitySummary?.netCount ?? liveContext.nets.length,
      selectionCount: connectivitySummary?.selectionCount ?? liveContext.selection.objectIds.length,
      categories: bomSummary?.categories ?? [],
      keyComponents: keyComponentsSummary?.keyComponents ?? [],
      functionalBlocks: functionalBlocksSummary?.functionalBlocks.map((item) => ({ name: item.name, evidence: item.evidence })) ?? [],
      powerDomains: powerDomainsSummary?.powerDomains ?? [],
      powerPaths: powerPathSummary?.paths ?? [],
      signalPaths: signalPathSummary?.paths ?? [],
      controlPaths: controlPathSummary?.paths ?? [],
      connectivityNotes: connectivitySummary?.connectivityNotes ?? [],
    };
    markStep(
      state,
      "mcp",
      "done",
      `已提取整图摘要：器件 ${overviewSummary.componentCount} 个，功能模块 ${overviewSummary.functionalBlocks.length} 个，电源域 ${overviewSummary.powerDomains.length} 个`
    );
    state.workingMemory.mcpReady = true;
    state.workingMemory.lastObservation = "已提取整图摘要";
    updateTask(state, tasks.mcp, "done", "整图摘要已就绪");
    await updateTodoList({ mcp: "done" }, "更新任务列表：mcp 完成");
    emitProgress(deps, state, "整图理解与知识证据已就绪");
  }

  if (shouldRun("mcp") && canUse(deps, "mcp.list_resources")) {
    thought(state, "Knowledge", "先读取工程知识和规范摘要，避免只看局部连接。", "mcp");
    const resources = await invokeObserved<undefined, McpResourcesResult>(deps, state, "mcp.list_resources", undefined, "列出知识资源");
    resources.resources.forEach((item) => mcpResources.push(item));
    markStep(state, "mcp", mcpResources.length > 0 ? "done" : "skipped", `知识资源 ${mcpResources.length} 条`);
    state.workingMemory.mcpReady = mcpResources.length > 0;
    if (canUse(deps, "mcp.read_resource")) {
      for (const resource of mcpResources.slice(0, 2)) {
        try {
          const read = await invokeObserved<{ uri: string }, McpResourceReadResult>(
            deps,
            state,
            "mcp.read_resource",
            { uri: resource.uri },
            `读取知识资源 ${resource.uri}`
          );
          mcpResourceReads.push({ uri: read.uri, title: read.title, summary: read.summary });
        } catch {
          // best effort
        }
      }
      if (mcpResourceReads.length > 0) {
        markStep(state, "mcp", "done", `知识摘要 ${mcpResourceReads.length} 条`);
        state.workingMemory.mcpReady = true;
      }
    }
  }
  if (!shouldRun("mcp")) {
    updateTask(state, tasks.mcp, "skipped", "计划未包含知识检索");
    markStep(state, "mcp", "skipped", "计划未包含知识检索");
    await updateTodoList({ mcp: "skipped" }, "更新任务列表：mcp 跳过");
  }

  if (shouldRun("context")) {
    await updateTodoList({ context: "running" }, "更新任务列表：context");
    updateTask(state, tasks.context, "running");
    thought(state, "Context", "同步编辑器里的最新原理图上下文，确保检查基于当前画布。", "context");
    emitProgress(deps, state, "正在读取当前原理图上下文");
    if (canUse(deps, "editor.get_current_context")) {
      liveContext = await invokeObserved<undefined, NonNullable<AgentTask["context"]>>(
        deps,
        state,
        "editor.get_current_context",
        undefined,
        "获取当前原理图上下文"
      );
      
      // 显示原理图标识信息，让用户确认
      const schematicInfo = [];
      if (liveContext.project.projectId) {
        schematicInfo.push(`项目ID: ${liveContext.project.projectId}`);
      }
      if (liveContext.project.pageId) {
        schematicInfo.push(`页面ID: ${liveContext.project.pageId}`);
      }
      schematicInfo.push(`版本: ${liveContext.project.channel === "professional" ? "专业版" : "标准版"}`);
      schematicInfo.push(`器件数: ${liveContext.components.length}`);
      schematicInfo.push(`网络数: ${liveContext.nets.length}`);
      
      const contextSummary = schematicInfo.join(", ");
      updateTask(state, tasks.context, "done", `已读取原理图 (${contextSummary})`);
      markStep(state, "context", "done", `已读取原理图 (${contextSummary})`);
    } else {
      updateTask(state, tasks.context, "done", "当前原理图上下文已就绪");
      markStep(state, "context", "done", "当前原理图上下文已就绪");
    }
    await updateTodoList({ context: "done" }, "更新任务列表：context 完成");
    emitProgress(deps, state, "原理图上下文已就绪");
    state.workingMemory.hasContext = true;
    state.workingMemory.lastObservation = "当前原理图上下文已就绪";
  } else {
    updateTask(state, tasks.context, "skipped", "计划未包含上下文读取");
    markStep(state, "context", "skipped", "计划未包含上下文读取");
    await updateTodoList({ context: "skipped" }, "更新任务列表：context 跳过");
  }

  if (shouldRun("rules")) {
    await updateTodoList({ rules: "running" }, "更新任务列表：rules");
    updateTask(state, tasks.rules, "running");
    thought(state, "Rules", "开始执行原理图检查工具，定位连接、属性和电源网络问题。", "rules");
    emitProgress(deps, state, "正在执行规则检查并定位问题");
    checkResult = await invokeObserved<{ context: NonNullable<AgentTask["context"]> }, AgentResult["checkResult"]>(
      deps,
      state,
      "rules.run_schematic_checks",
      { context: liveContext },
      "执行原理图规则检查"
    );
    state.workingMemory.rulesReady = true;
    state.workingMemory.lastObservation = checkResult?.summary || `发现 ${checkResult?.issues.length ?? 0} 个问题`;
    if (checkResult && checkResult.issues.length > 0 && canUse(deps, "issues.locate_first")) {
      thought(state, "Locate", `已发现 ${checkResult.issues.length} 个问题，继续定位首个可操作问题。`, "rules");
      locateResult = await invokeObserved<{ issues: NonNullable<typeof checkResult>["issues"] }, AgentResult["locateResult"]>(
        deps,
        state,
        "issues.locate_first",
        { issues: checkResult.issues },
        "定位首个问题对象"
      );
    }
    updateTask(
      state,
      tasks.rules,
      "done",
      `规则检查完成，问题 ${checkResult?.issues.length ?? 0} 个${locateResult?.located ? "，已定位首个问题" : ""}`
    );
    await updateTodoList({ rules: "done" }, "更新任务列表：rules 完成");
    emitProgress(
      deps,
      state,
      `规则检查完成，发现 ${checkResult?.issues.length ?? 0} 个问题${locateResult?.located ? "，已定位首个问题" : ""}`
    );
    markStep(
      state,
      "rules",
      "done",
      `规则检查完成，问题 ${checkResult?.issues.length ?? 0} 个${locateResult?.located ? "，已定位首个问题" : ""}`
    );
  } else {
    updateTask(state, tasks.rules, "skipped", "计划未包含规则检查");
    markStep(state, "rules", "skipped", "计划未包含规则检查");
    await updateTodoList({ rules: "skipped" }, "更新任务列表：rules 跳过");
  }

  if (shouldRun("library") && canUse(deps, "library.search_devices")) {
    await updateTodoList({ library: "running" }, "更新任务列表：library");
    updateTask(state, tasks.library, "running");
    thought(state, "Library", "围绕命中的高风险器件补充元件库事实，避免只凭规则摘要下判断。", "library");
    emitProgress(deps, state, "正在补充器件库与封装信息");
    const queries = buildAnalysisLibraryQueries(deps.task.userQuery, liveContext, checkResult);
    for (const query of queries) {
      try {
        const results = await invokeObserved<{ query: string; scope?: "system"; pageSize?: number; page?: number }, LibrarySearchResultItem[]>(
          deps,
          state,
          "library.search_devices",
          { query, scope: "system", pageSize: 8, page: 1 },
          `查询元件库：${query}`
        );
        if (!results.length) {
          continue;
        }
        const top = results[0];
        let summary = [top.name, top.manufacturer, top.footprintName ? `封装 ${top.footprintName}` : ""].filter(Boolean).join("，");
        if (canUse(deps, "library.get_device") && top.uuid) {
          try {
            const detail = await invokeObserved<{ deviceUuid: string; libraryUuid?: string; scope?: "system" }, { name?: string; lcscId?: string; description?: string; footprint?: { name?: string } }>(
              deps,
              state,
              "library.get_device",
              { deviceUuid: top.uuid, libraryUuid: top.libraryUuid, scope: "system" },
              `读取器件详情：${top.name}`
            );
            summary = [
              detail.name || top.name,
              detail.lcscId ? `LCSC ${detail.lcscId}` : "",
              detail.footprint?.name ? `封装 ${detail.footprint.name}` : top.footprintName ? `封装 ${top.footprintName}` : "",
              detail.description || top.description || "",
            ].filter(Boolean).join("，");
          } catch {
            // best effort
          }
        }
        libraryInsights.push({ query, title: top.name, summary });
      } catch {
        // best effort
      }
    }
    updateTask(
      state,
      tasks.library,
      libraryInsights.length > 0 ? "done" : "skipped",
      libraryInsights.length > 0 ? `补充 ${libraryInsights.length} 条元件库信息` : "未找到可补充的元件库信息"
    );
    await updateTodoList({ library: libraryInsights.length > 0 ? "done" : "skipped" }, "更新任务列表：library 完成");
    markStep(
      state,
      "library",
      libraryInsights.length > 0 ? "done" : "skipped",
      libraryInsights.length > 0 ? `补充 ${libraryInsights.length} 条元件库信息` : "未找到可补充的元件库信息"
    );
    state.workingMemory.libraryReady = libraryInsights.length > 0;
    emitProgress(
      deps,
      state,
      libraryInsights.length > 0 ? `已补充 ${libraryInsights.length} 条器件库信息` : "未找到可补充的器件库信息"
    );
  } else {
    updateTask(state, tasks.library, "skipped", shouldRun("library") ? "当前宿主未提供元件搜索能力" : "计划未包含器件检索");
    markStep(state, "library", "skipped", shouldRun("library") ? "当前宿主未提供元件搜索能力" : "计划未包含器件检索");
    await updateTodoList({ library: shouldRun("library") ? "failed" : "skipped" }, "更新任务列表：library 跳过");
  }

  if (shouldRun("llm") && canUse(deps, "llm.generate")) {
    await updateTodoList({ llm: "running" }, "更新任务列表：llm");
  }
  updateTask(state, tasks.llm, shouldRun("llm") && canUse(deps, "llm.generate") ? "running" : "skipped");
  if (shouldRun("llm") && canUse(deps, "llm.generate")) {
    thought(state, "LLM", "基于检查结果和知识摘要，整理成用户可读的问题报告。", "llm");
  emitProgress(deps, state, "正在生成分析报告");
  const llmResult = await invokeObserved<
    {
      stream?: boolean;
      onEvent?: (event: { type: "start" | "delta" | "done" | "error"; delta?: string; output_text?: string }) => void;
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    },
    { output_text?: string }
  >(
    deps,
    state,
    "llm.generate",
    {
      stream: true,
      onEvent: (event) => {
        if (event.type === "delta" && event.delta) {
          emitProgress(deps, state, "正在生成分析报告", event.delta);
        }
        if (event.type === "done") {
          emitProgress(deps, state, "分析报告已生成", undefined, event.output_text);
        }
      },
      messages: [
        { role: "system", content: buildAnalysisSystemPrompt() },
        {
          role: "user",
          content: buildAnalysisUserPrompt({
            userQuery: deps.task.userQuery,
            context: liveContext,
            checkResult: checkResult!,
            locateLabel: locateResult?.located ? formatLocateLabel(locateResult.objectType, locateResult.objectId) : undefined,
            libraryInsights,
            overviewSummary,
            mcpSummaries: mcpResourceReads,
          }),
        },
      ],
    },
    "生成最终分析报告"
  );
    analysisReport = parseAnalysisReport(llmResult.output_text, checkResult, locateResult);
    state.workingMemory.llmReady = true;
    state.workingMemory.lastObservation = "分析报告已生成";
    updateTask(state, tasks.llm, "done", "分析报告已生成");
    await updateTodoList({ llm: "done" }, "更新任务列表：llm 完成");
    markStep(state, "llm", "done", "分析报告已生成");
    emitProgress(deps, state, "分析报告已生成");
  } else {
    analysisReport = buildFallbackAnalysisReport(checkResult, locateResult);
    markStep(state, "llm", "skipped", shouldRun("llm") ? "LLM 不可用，已回退到规则结果摘要" : "计划未包含 LLM 生成");
    await updateTodoList({ llm: shouldRun("llm") ? "failed" : "skipped" }, "更新任务列表：llm 跳过");
  }

  final(state, `分析完成，共发现 ${checkResult?.issues.length ?? 0} 个问题`);
  emitProgress(deps, state, `分析完成，共发现 ${checkResult?.issues.length ?? 0} 个问题`);

  return {
    reactEvents: state.reactEvents,
    result: {
      summary: `collected schematic context for schematic_analysis; ${checkResult?.summary ?? "no result"}; locate_first=${locateResult?.located ?? false}; mcp_resources=${mcpResources.length}`,
      analysisReport,
      nextSuggestions: buildAnalysisSuggestions(checkResult, locateResult),
      structuredSuggestions: buildAnalysisStructuredSuggestions(checkResult),
      toolTraceNames: deps.listToolNames(),
      toolTraces: state.toolTraces,
      executionTraces: convertReactEventsToExecutionTraces(state.reactEvents),
      mcpResources,
      mcpResourceReads,
      libraryInsights,
      checkResult,
      locateResult,
      contextDigest: {
        channel: liveContext.project.channel,
        componentCount: liveContext.components.length,
        netCount: liveContext.nets.length,
        selectionCount: liveContext.selection.objectIds.length,
      },
      stepStates: state.stepStates,
      workingMemory: state.workingMemory,
    },
  };
}

function convertReactEventsToExecutionTraces(reactEvents: ReactAgentState["reactEvents"]): AgentResult["executionTraces"] {
  const traces: NonNullable<AgentResult["executionTraces"]> = [];
  
  for (const event of reactEvents) {
    if (event.kind === "thought") {
      traces.push({
        phase: "reason",
        message: `${event.label}: ${event.text}`,
      });
    } else if (event.kind === "task") {
      traces.push({
        phase: "reason",
        message: `Task ${event.status}: ${event.text}`,
      });
    } else if (event.kind === "tool_call") {
      traces.push({
        phase: "act",
        message: `${event.toolName}: ${event.text}${event.inputSummary ? ` (${event.inputSummary})` : ""}`,
      });
    } else if (event.kind === "observation") {
      traces.push({
        phase: "observe",
        message: `${event.toolName}: ${event.text}`,
      });
    } else if (event.kind === "final") {
      traces.push({
        phase: "finish",
        message: event.text,
      });
    }
  }
  
  return traces;
}

function emitProgress(
  deps: ReactAgentDeps,
  state: ReactAgentState,
  detail: string,
  textDelta?: string,
  text?: string
): void {
  deps.onProgress?.({
    detail,
    textDelta,
    text,
    reactEvents: state.reactEvents.map((item) => ({ ...item })),
    stepStates: state.stepStates.map((item) => ({ ...item })),
    workingMemory: { ...state.workingMemory },
  });
}

function canUse(deps: ReactAgentDeps, toolName: string): boolean {
  return deps.allowedTools.includes(toolName);
}

function assertContext(task: AgentTask): asserts task is AgentTask & { context: NonNullable<AgentTask["context"]> } {
  if (!task.context) {
    throw new Error(`task context missing: ${task.type}`);
  }
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

function pushTask(state: ReactAgentState, stepKind: AgentStepState["kind"], text: string): string {
  const id = `${stepKind}:${text}`;
  state.reactEvents.push({ kind: "task", label: "Task", status: "pending", text, stepKind });
  return id;
}

function updateTask(state: ReactAgentState, id: string, status: "pending" | "running" | "done" | "failed" | "skipped", text?: string): void {
  const event = state.reactEvents.find((item) => item.kind === "task" && `${item.stepKind}:${item.text}` === id);
  if (!event) return;
  event.status = status;
  if (text) {
    event.text = text;
  }
}

function thought(state: ReactAgentState, label: string, text: string, stepKind?: AgentStepState["kind"]): void {
  state.reactEvents.push({ kind: "thought", label, status: "done", text, stepKind });
}

function final(state: ReactAgentState, text: string): void {
  state.reactEvents.push({ kind: "final", label: "Finish", status: "done", text });
}

function markStep(
  state: ReactAgentState,
  kind: AgentStepState["kind"],
  status: AgentStepState["status"],
  observation: string
): void {
  const existing = state.stepStates.find((step) => step.kind === kind);
  if (existing) {
    existing.status = status;
    existing.observation = observation;
    return;
  }
  state.stepStates.push({ kind, required: true, note: observation, status, observation });
}

async function invokeObserved<TInput, TOutput>(
  deps: ReactAgentDeps,
  state: ReactAgentState,
  toolName: string,
  input: TInput,
  goal: string
): Promise<TOutput> {
  const inputSummary = summarizeToolInput(toolName, input);
  state.reactEvents.push({
    kind: "tool_call",
    label: mapToolNameToLabel(toolName),
    status: "running",
    text: goal,
    toolName,
    inputSummary,
  });
  try {
    const output = await deps.invokeTool<TInput, TOutput>(toolName, input);
    const outputSummary = summarizeToolOutput(toolName, output);
    state.toolTraces.push({ toolName, status: "success", note: outputSummary || undefined });
    state.reactEvents.push({
      kind: "observation",
      label: mapToolNameToLabel(toolName),
      status: "done",
      text: outputSummary || `${mapToolNameToLabel(toolName)} completed`,
      toolName,
      outputSummary,
    });
    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.toolTraces.push({ toolName, status: "blocked", note: message });
    state.reactEvents.push({
      kind: "observation",
      label: mapToolNameToLabel(toolName),
      status: "failed",
      text: message,
      toolName,
      outputSummary: message,
    });
    throw error;
  }
}

function buildAnalysisSuggestions(
  checkResult: AgentResult["checkResult"],
  locateResult: AgentResult["locateResult"]
): string[] {
  const issueCount = checkResult?.issues.length ?? 0;
  if (issueCount === 0) {
    return ["可以继续生成草案，或针对局部模块发起更深入问答。"]; 
  }
  const suggestions = [`建议先修复当前 ${issueCount} 个问题后再生成草案。`];
  if (locateResult?.located && locateResult.objectType && locateResult.objectId) {
    suggestions.push(`优先检查已定位对象 ${formatLocateLabel(locateResult.objectType, locateResult.objectId)}。`);
  }
  const highCount = (checkResult?.issues ?? []).filter((issue) => issue.severity === "high").length;
  if (highCount > 0) {
    suggestions.push(`检测到 ${highCount} 个高风险问题，建议先重新分析确认修复结果。`);
  }
  return suggestions;
}

function buildAnalysisStructuredSuggestions(
  checkResult: AgentResult["checkResult"]
): NonNullable<AgentResult["structuredSuggestions"]> {
  const issueCount = checkResult?.issues.length ?? 0;
  if (issueCount === 0) {
    return [
      { label: "生成草案", actionType: "regenerate_draft", prompt: "请基于当前原理图生成下一版草案" },
      { label: "继续问答", actionType: "ask_followup", prompt: "请继续解释当前原理图还可以优化哪些地方" },
    ];
  }
  return [
    { label: "重新分析", actionType: "rerun_analysis" },
    { label: "修复后重检", actionType: "ask_followup", prompt: "我已经修复一部分问题，请重新检查当前原理图" },
  ];
}

function parseAnalysisReport(
  rawText: string | undefined,
  checkResult: AgentResult["checkResult"],
  locateResult: AgentResult["locateResult"]
): NonNullable<AgentResult["analysisReport"]> {
  const fallback = buildFallbackAnalysisReport(checkResult, locateResult);
  if (!rawText) return fallback;
  try {
    const parsed = JSON.parse(extractJsonBlock(rawText)) as Partial<NonNullable<AgentResult["analysisReport"]>>;
    return {
      overview: typeof parsed.overview === "string" && parsed.overview.trim() ? parsed.overview.trim() : fallback.overview,
      executiveSummary:
        typeof parsed.executiveSummary === "string" && parsed.executiveSummary.trim()
          ? parsed.executiveSummary.trim()
          : fallback.executiveSummary,
      ercSummary:
        Array.isArray(parsed.ercSummary) && parsed.ercSummary.length > 0
          ? parsed.ercSummary.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 4)
          : fallback.ercSummary,
      bomOverview:
        Array.isArray(parsed.bomOverview) && parsed.bomOverview.length > 0
          ? parsed.bomOverview.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 6)
          : fallback.bomOverview,
      functionalBlocks:
        Array.isArray(parsed.functionalBlocks) && parsed.functionalBlocks.length > 0
          ? parsed.functionalBlocks.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 5)
          : fallback.functionalBlocks,
      powerDomains:
        Array.isArray(parsed.powerDomains) && parsed.powerDomains.length > 0
          ? parsed.powerDomains.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 5)
          : fallback.powerDomains,
      powerPaths:
        Array.isArray(parsed.powerPaths) && parsed.powerPaths.length > 0
          ? parsed.powerPaths.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 4)
          : fallback.powerPaths,
      signalPaths:
        Array.isArray(parsed.signalPaths) && parsed.signalPaths.length > 0
          ? parsed.signalPaths.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 4)
          : fallback.signalPaths,
      controlPaths:
        Array.isArray(parsed.controlPaths) && parsed.controlPaths.length > 0
          ? parsed.controlPaths.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 4)
          : fallback.controlPaths,
      keyComponents:
        Array.isArray(parsed.keyComponents) && parsed.keyComponents.length > 0
          ? parsed.keyComponents.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 6)
          : fallback.keyComponents,
      riskGroups: {
        high: Array.isArray(parsed.riskGroups?.high) ? parsed.riskGroups.high.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 3) : fallback.riskGroups?.high ?? [],
        medium: Array.isArray(parsed.riskGroups?.medium) ? parsed.riskGroups.medium.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 3) : fallback.riskGroups?.medium ?? [],
        low: Array.isArray(parsed.riskGroups?.low) ? parsed.riskGroups.low.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 3) : fallback.riskGroups?.low ?? [],
      },
      keyFindings: Array.isArray(parsed.keyFindings) && parsed.keyFindings.length > 0 ? parsed.keyFindings.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 3) : fallback.keyFindings,
      nextSteps: Array.isArray(parsed.nextSteps) && parsed.nextSteps.length > 0 ? parsed.nextSteps.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 3) : fallback.nextSteps,
    };
  } catch {
    return fallback;
  }
}

function buildFallbackAnalysisReport(
  checkResult: AgentResult["checkResult"],
  locateResult: AgentResult["locateResult"]
): NonNullable<AgentResult["analysisReport"]> {
  const issues = checkResult?.issues ?? [];
  const firstThree = issues.slice(0, 3).map((issue) => {
    const location = formatLocateLabel(issue.objectType, issue.objectId);
    return `${issue.title}${location ? `：${location}` : ""}`;
  });
  const nextSteps = buildAnalysisSuggestions(checkResult, locateResult).slice(0, 3);
  return {
    overview: issues.length > 0 ? `已完成当前原理图检查，发现 ${issues.length} 个需要关注的问题，建议优先处理高风险连接错误。` : "已完成当前原理图检查，暂未发现明显规则问题。",
    executiveSummary:
      issues.length > 0
        ? "已完成整图首轮理解与规则诊断。当前主要风险集中在高风险接线、电源域冲突或关键引脚连接错误，建议先修复核心风险再继续功能扩展。"
        : "已完成整图首轮理解与规则诊断。当前未发现明显规则问题，可以继续做模块化复核与设计优化。",
    ercSummary:
      issues.length > 0
        ? [
            `规则检查共发现 ${issues.length} 个问题。`,
            `${issues.filter((issue) => issue.severity === "high").length} 个高风险问题需要优先处理。`,
          ]
        : ["规则检查未发现明显 ERC 风险。"],
    bomOverview: [],
    functionalBlocks: [],
    powerDomains: [],
    powerPaths: [],
    signalPaths: [],
    controlPaths: [],
    keyComponents: [],
    riskGroups: {
      high: issues.filter((issue) => issue.severity === "high").slice(0, 3).map((issue) => `${issue.title}${formatLocateLabel(issue.objectType, issue.objectId) ? `：${formatLocateLabel(issue.objectType, issue.objectId)}` : ""}`),
      medium: issues.filter((issue) => issue.severity === "medium").slice(0, 3).map((issue) => `${issue.title}${formatLocateLabel(issue.objectType, issue.objectId) ? `：${formatLocateLabel(issue.objectType, issue.objectId)}` : ""}`),
      low: issues.filter((issue) => issue.severity === "low").slice(0, 3).map((issue) => `${issue.title}${formatLocateLabel(issue.objectType, issue.objectId) ? `：${formatLocateLabel(issue.objectType, issue.objectId)}` : ""}`),
    },
    keyFindings: firstThree.length > 0 ? firstThree : ["未发现需要优先处理的问题"],
    nextSteps: nextSteps.length > 0 ? nextSteps : ["如需更深入确认，可以继续询问具体器件或网络问题"],
  };
}

function extractJsonBlock(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

function formatLocateLabel(objectType?: string, objectId?: string): string {
  if (!objectType || !objectId) return "";
  if (objectType === "pin") {
    const match = objectId.match(/^pin-([^-]+)-(.+)$/i);
    if (match) return `${match[1].toUpperCase()} 的 ${match[2].toUpperCase()} 脚`;
  }
  if (objectType === "component") return `器件 ${objectId.replace(/^component-/i, "").toUpperCase()}`;
  if (objectType === "net") return `网络 ${objectId.replace(/^net-/i, "")}`;
  return `${objectType}:${objectId}`;
}

function buildAnalysisLibraryQueries(
  userQuery: string,
  context: NonNullable<AgentTask["context"]>,
  checkResult: AgentResult["checkResult"]
): string[] {
  const queries: string[] = [];
  const seen = new Set<string>();
  const push = (value?: string) => {
    const normalized = String(value || "").trim();
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(normalized);
  };

  const componentById = new Map(context.components.map((component) => [component.id, component]));
  const pinById = new Map(context.pins.map((pin) => [pin.id, pin]));
  const prioritized = [...(checkResult?.issues ?? [])].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 } as const;
    return (order[a.severity as keyof typeof order] ?? 9) - (order[b.severity as keyof typeof order] ?? 9);
  });

  prioritized.slice(0, 6).forEach((issue) => {
    if (issue.objectType === "component" && issue.objectId) {
      const component = componentById.get(issue.objectId);
      push([component?.ref, component?.name, component?.value].filter(Boolean).join(" "));
      push(component?.name);
      push(component?.value);
      return;
    }
    if (issue.objectType === "pin" && issue.objectId) {
      const pin = pinById.get(issue.objectId);
      const component = pin ? componentById.get(pin.componentId) : undefined;
      push([component?.ref, component?.name, component?.value].filter(Boolean).join(" "));
      push(component?.name);
      push(component?.value);
    }
  });

  if (queries.length === 0) {
    const tokens = userQuery.match(/[A-Za-z]+\d+[A-Za-z0-9_-]*|[A-Z]{2,}[A-Za-z0-9_-]*/g) ?? [];
    tokens.slice(0, 3).forEach(push);
  }
  if (queries.length === 0) {
    context.components.slice(0, 8).forEach((component) => {
      push(component.ref);
      push(component.name);
      push(component.value);
    });
  }
  return queries.slice(0, 3);
}

function summarizeToolInput(toolName: string, input: unknown): string {
  if (toolName === "rules.run_schematic_checks" && input && typeof input === "object") {
    const context = (input as { context?: { components?: unknown[]; nets?: unknown[]; selection?: { objectIds?: unknown[] } } }).context;
    return context ? buildAnalysisSummaryPrompt(context as never) : "使用当前原理图上下文";
  }
  if (toolName === "library.search_devices" && input && typeof input === "object") {
    return `query=${String((input as { query?: string }).query || "")}`;
  }
  if (toolName === "mcp.read_resource" && input && typeof input === "object") {
    return `uri=${String((input as { uri?: string }).uri || "")}`;
  }
  if (toolName === "todo_list" && input && typeof input === "object") {
    return `tasks=${((input as { tasks?: unknown[] }).tasks || []).length}`;
  }
  if (toolName === "issues.locate_first" && input && typeof input === "object") {
    return `issues=${((input as { issues?: unknown[] }).issues || []).length}`;
  }
  if (toolName.startsWith("schematic.") && input && typeof input === "object") {
    return "使用当前原理图上下文生成整图摘要";
  }
  if (toolName === "llm.generate" && input && typeof input === "object") {
    return `messages=${((input as { messages?: unknown[] }).messages || []).length}`;
  }
  return "";
}

function summarizeToolOutput(toolName: string, output: unknown): string {
  if (toolName === "library.search_devices" && Array.isArray(output)) {
    if (output.length === 0) return "未找到匹配器件";
    const first = output[0] as { name?: string; manufacturer?: string; footprintName?: string };
    return [`找到 ${output.length} 个候选`, first?.name ? `首项 ${first.name}` : "", first?.manufacturer || "", first?.footprintName ? `封装 ${first.footprintName}` : ""].filter(Boolean).join("，");
  }
  if (toolName === "library.get_device" && output && typeof output === "object") {
    const detail = output as { name?: string; lcscId?: string; footprint?: { name?: string }; description?: string };
    return [detail.name ?? "", detail.lcscId ? `LCSC ${detail.lcscId}` : "", detail.footprint?.name ? `封装 ${detail.footprint.name}` : "", detail.description ? detail.description.slice(0, 48) : ""].filter(Boolean).join("，");
  }
  if (toolName === "rules.run_schematic_checks" && output && typeof output === "object") {
    const result = output as { issues?: unknown[]; summary?: string };
    return result.summary || `发现 ${result.issues?.length ?? 0} 个问题`;
  }
  if (toolName === "issues.locate_first" && output && typeof output === "object") {
    const locate = output as { located?: boolean; objectType?: string; objectId?: string };
    return locate.located ? `已定位 ${formatLocateLabel(locate.objectType, locate.objectId)}` : "未找到可定位对象";
  }
  if (toolName === "schematic.summarize_bom" && output && typeof output === "object") {
    const result = output as SchematicBomSummary;
    return `BOM 摘要：器件 ${result.componentCount} 个，类别 ${result.categories.length} 类`;
  }
  if (toolName === "schematic.identify_key_components" && output && typeof output === "object") {
    const result = output as SchematicKeyComponentsSummary;
    return `关键器件 ${result.keyComponents.length} 个`;
  }
  if (toolName === "schematic.identify_functional_blocks" && output && typeof output === "object") {
    const result = output as SchematicFunctionalBlocksSummary;
    return `功能模块 ${result.functionalBlocks.length} 个`;
  }
  if (toolName === "schematic.identify_power_domains" && output && typeof output === "object") {
    const result = output as SchematicPowerDomainsSummary;
    return `电源域 ${result.powerDomains.length} 个`;
  }
  if (toolName === "schematic.summarize_connectivity" && output && typeof output === "object") {
    const result = output as SchematicConnectivitySummary;
    return `连接性摘要：网络 ${result.netCount} 条`;
  }
  if (toolName === "schematic.trace_power_paths" && output && typeof output === "object") {
    const result = output as SchematicPowerPathSummary;
    return `关键电源路径 ${result.paths.length} 条`;
  }
  if (toolName === "schematic.trace_signal_paths" && output && typeof output === "object") {
    const result = output as SchematicSignalPathSummary;
    return `主要信号路径 ${result.paths.length} 条`;
  }
  if (toolName === "schematic.trace_control_paths" && output && typeof output === "object") {
    const result = output as SchematicControlPathSummary;
    return `主控链路 ${result.paths.length} 条`;
  }
  if (toolName === "mcp.list_resources" && output && typeof output === "object") {
    const result = output as { resources?: unknown[] };
    return `已加载 ${result.resources?.length ?? 0} 条知识资源`;
  }
  if (toolName === "mcp.read_resource" && output && typeof output === "object") {
    const result = output as { title?: string; summary?: string };
    return [result.title, result.summary].filter(Boolean).join("：");
  }
  if (toolName === "todo_list" && output && typeof output === "object") {
    const tasks = (output as { tasks?: Array<{ text?: string }> }).tasks || [];
    return tasks.length > 0 ? `任务列表已创建（${tasks.length} 条）` : "任务列表为空";
  }
  if (toolName === "llm.generate" && output && typeof output === "object") {
    const result = output as { output_text?: string };
    return result.output_text ? `已生成 ${result.output_text.length} 字分析报告` : "已生成分析报告";
  }
  return "";
}

function mapToolNameToLabel(toolName: string): string {
  const map: Record<string, string> = {
    "todo_list": "todo_list",
    "editor.get_current_context": "jlceda_get_schematic_context",
    "schematic.summarize_bom": "jlceda_summarize_bom",
    "schematic.identify_key_components": "jlceda_identify_key_components",
    "schematic.identify_functional_blocks": "jlceda_identify_functional_blocks",
    "schematic.identify_power_domains": "jlceda_identify_power_domains",
    "schematic.summarize_connectivity": "jlceda_summarize_connectivity",
    "schematic.trace_power_paths": "jlceda_trace_power_paths",
    "schematic.trace_signal_paths": "jlceda_trace_signal_paths",
    "schematic.trace_control_paths": "jlceda_trace_control_paths",
    "library.search_devices": "jlceda_search_component_library",
    "library.get_device": "jlceda_get_component_detail",
    "mcp.list_resources": "jlceda_list_knowledge_resources",
    "mcp.read_resource": "jlceda_read_knowledge_resource",
    "rules.run_schematic_checks": "jlceda_schematic_check",
    "issues.locate_first": "jlceda_locate_issue",
    "llm.generate": "llm_generate_report",
  };
  return map[toolName] ?? toolName;
}
