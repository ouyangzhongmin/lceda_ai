import { buildDraftPlannerSystemPrompt, buildDraftPlannerUserPrompt } from "../prompts/draftPrompts";
import type { AgentResult, AgentStepState, AgentTask, AgentWorkingMemory } from "../shared/agentTypes";
import type { ReactAgentDeps, ReactAgentRunResult, ReactAgentState } from "./reactTypes";

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

interface SelectedDevice {
  role: string;
  query: string;
  deviceUuid: string;
  libraryUuid: string;
  name: string;
  manufacturer?: string;
  symbolUuid?: string;
  symbolName?: string;
  footprintUuid?: string;
  footprintName?: string;
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

export async function runDraftReactAgent(deps: ReactAgentDeps): Promise<ReactAgentRunResult> {
  assertContext(deps.task);
  const state: ReactAgentState = {
    toolTraces: [],
    stepStates: [],
    workingMemory: createWorkingMemory(deps.task),
    reactEvents: [],
  };

  const mcpResources: Array<{ uri: string; description: string }> = [];
  const mcpResourceReads: Array<{ uri: string; title: string; summary: string }> = [];
  const selectedDevices: SelectedDevice[] = [];
  let liveContext = deps.task.context;
  let llmDraftHint: string | undefined;
  let libraryHint = "";
  let draftPlan: AgentResult["draftPlan"] | undefined;
  let draftPreview: AgentResult["draftPreview"] | undefined;
  let draftValidation: AgentResult["draftValidation"] | undefined;
  let draftRisk: AgentResult["draftRisk"] | undefined;

  const planSteps = deps.task.planSteps?.length ? deps.task.planSteps : [
    { kind: "context", note: "读取当前原理图上下文并同步到草案规划" },
    { kind: "mcp", note: "补充整图摘要与工程知识证据" },
    { kind: "library", note: "查询候选元件与封装信息" },
    { kind: "llm", note: "让模型生成草案拓扑提示" },
    { kind: "draft", note: "生成草案并构建预览" },
    { kind: "rules", note: "校验草案约束与风险" },
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
    context: pushTask(state, "context", planSteps.find((step) => step.kind === "context")?.note || "读取当前原理图上下文并同步到草案规划"),
    library: pushTask(state, "library", planSteps.find((step) => step.kind === "library")?.note || "查询候选元件与封装信息"),
    llm: pushTask(state, "llm", planSteps.find((step) => step.kind === "llm")?.note || "让模型生成草案拓扑提示"),
    draft: pushTask(state, "draft", planSteps.find((step) => step.kind === "draft")?.note || "生成草案并构建预览"),
    rules: pushTask(state, "rules", planSteps.find((step) => step.kind === "rules")?.note || "校验草案约束与风险"),
  };
  emitProgress(deps, state, "开始生成草案");

  if (shouldRun("mcp") && canUse(deps, "mcp.list_resources")) {
    await updateTodoList({ mcp: "running" }, "更新任务列表：mcp");
    thought(state, "Knowledge", "先补充工程知识与设计约束，再进入草案规划。", "mcp");
    emitProgress(deps, state, "正在读取知识与设计约束");
    const resources = await invokeObserved<undefined, McpResourcesResult>(deps, state, "mcp.list_resources", undefined, "列出知识资源");
    resources.resources.forEach((item) => mcpResources.push(item));
    markStep(state, "mcp", mcpResources.length > 0 ? "done" : "skipped", `知识资源 ${mcpResources.length} 条`);
    state.workingMemory.mcpReady = mcpResources.length > 0;
    if (canUse(deps, "mcp.read_resource")) {
      for (const resource of mcpResources.slice(0, 2)) {
        try {
          const read = await invokeObserved<{ uri: string }, McpResourceReadResult>(deps, state, "mcp.read_resource", { uri: resource.uri }, `读取知识资源 ${resource.uri}`);
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
    emitProgress(deps, state, mcpResourceReads.length > 0 ? `已读取 ${mcpResourceReads.length} 条知识摘要` : `知识资源 ${mcpResources.length} 条`);
    await updateTodoList({ mcp: mcpResources.length > 0 ? "done" : "skipped" }, "更新任务列表：mcp 完成");
  } else if (!shouldRun("mcp")) {
    markStep(state, "mcp", "skipped", "计划未包含知识检索");
    await updateTodoList({ mcp: "skipped" }, "更新任务列表：mcp 跳过");
  }

  if (shouldRun("context")) {
    await updateTodoList({ context: "running" }, "更新任务列表：context");
    updateTask(state, tasks.context, "running");
    thought(state, "Context", "同步编辑器里的最新上下文，确保草案基于当前画布状态。", "context");
    emitProgress(deps, state, "正在同步原理图上下文");
    if (canUse(deps, "editor.get_current_context")) {
      liveContext = await invokeObserved<undefined, NonNullable<AgentTask["context"]>>(deps, state, "editor.get_current_context", undefined, "获取当前原理图上下文");
      
      // 显示原理图标识信息，让用户确认
      const schematicInfo = [];
      const schematicName = liveContext.project.pageName?.trim();
      if (schematicName) {
        schematicInfo.push(`原理图: ${schematicName}`);
      }
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
      updateTask(state, tasks.context, "done", "草案上下文已就绪");
      markStep(state, "context", "done", "草案上下文已就绪");
    }
    emitProgress(deps, state, "草案上下文已就绪");
    await updateTodoList({ context: "done" }, "更新任务列表：context 完成");
    state.workingMemory.hasContext = true;
    state.workingMemory.lastObservation = "草案上下文已就绪";
  } else {
    updateTask(state, tasks.context, "skipped", "计划未包含上下文读取");
    markStep(state, "context", "skipped", "计划未包含上下文读取");
    await updateTodoList({ context: "skipped" }, "更新任务列表：context 跳过");
  }

  if (shouldRun("library") && canUse(deps, "library.search_devices")) {
    await updateTodoList({ library: "running" }, "更新任务列表：library");
    updateTask(state, tasks.library, "running");
    thought(state, "Library", "先找候选器件与封装，再让模型给出更具体的拓扑建议。", "library");
    emitProgress(deps, state, "正在查询候选元件与封装");
    const libraryResults = await invokeObserved<{ query: string; scope?: "system"; pageSize?: number; page?: number }, LibrarySearchResultItem[]>(
      deps,
      state,
      "library.search_devices",
      { query: deps.task.userQuery, scope: "system", pageSize: 12, page: 1 },
      "查询候选元件"
    );
    if (libraryResults.length > 0) {
      libraryHint = buildLibraryHint(libraryResults);
      selectedDevices.push(...pickSelectedDevices(deps.task.userQuery, libraryResults));
      if (/ldo|稳压|regulator|3\.3v|5v/i.test(deps.task.userQuery)) {
        try {
          const capacitorResults = await invokeObserved<{ query: string; scope?: "system"; pageSize?: number; page?: number }, LibrarySearchResultItem[]>(
            deps,
            state,
            "library.search_devices",
            { query: "10uF capacitor 0603", scope: "system", pageSize: 12, page: 1 },
            "查询输入输出电容"
          );
          const capacitor = pickBestLibraryCandidate(capacitorResults, ["capacitor", "10uf", "0603"]);
          if (capacitor?.uuid && capacitor.libraryUuid) {
            for (const role of ["input_capacitor", "output_capacitor"] as const) {
              selectedDevices.push({
                role,
                query: "10uF capacitor",
                deviceUuid: capacitor.uuid,
                libraryUuid: capacitor.libraryUuid,
                name: capacitor.name,
                manufacturer: capacitor.manufacturer,
                symbolUuid: capacitor.symbolUuid,
                symbolName: capacitor.symbolName,
                footprintUuid: capacitor.footprintUuid,
                footprintName: capacitor.footprintName,
              });
            }
          }
        } catch {
          // best effort
        }
      }
    }
    updateTask(state, tasks.library, libraryResults.length > 0 ? "done" : "skipped", libraryResults.length > 0 ? `已获取 ${libraryResults.length} 个候选元件` : "未找到匹配元件");
    markStep(state, "library", libraryResults.length > 0 ? "done" : "skipped", libraryResults.length > 0 ? `已获取 ${libraryResults.length} 个候选元件` : "未找到匹配元件");
    await updateTodoList({ library: libraryResults.length > 0 ? "done" : "skipped" }, "更新任务列表：library 完成");
    state.workingMemory.libraryReady = libraryResults.length > 0;
    state.workingMemory.lastObservation = libraryResults.length > 0 ? `候选元件 ${libraryResults.length} 个` : state.workingMemory.lastObservation;
    emitProgress(deps, state, libraryResults.length > 0 ? `已获取 ${libraryResults.length} 个候选元件` : "未找到匹配元件");
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
    thought(state, "LLM", "先让模型给出草案拓扑提示，再进入结构化落图计划。", "llm");
    emitProgress(deps, state, "正在生成草案拓扑提示");
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
            emitProgress(deps, state, "正在生成草案拓扑提示", event.delta);
          }
          if (event.type === "done") {
            emitProgress(deps, state, "草案拓扑提示已生成", undefined, event.output_text);
          }
        },
        messages: [
          { role: "system", content: buildDraftPlannerSystemPrompt() },
          { role: "user", content: buildDraftPlannerUserPrompt(deps.task.userQuery, libraryHint || undefined) },
        ],
      },
      "生成草案拓扑提示"
    );
    llmDraftHint = llmResult.output_text;
    updateTask(state, tasks.llm, "done", llmDraftHint ? "已生成草案拓扑提示" : "模型未返回有效提示");
    await updateTodoList({ llm: llmDraftHint ? "done" : "skipped" }, "更新任务列表：llm 完成");
    markStep(state, "llm", "done", llmDraftHint ? "已生成草案拓扑提示" : "模型未返回有效提示");
    state.workingMemory.llmReady = true;
    state.workingMemory.lastObservation = llmDraftHint ? "已生成草案拓扑提示" : state.workingMemory.lastObservation;
    emitProgress(deps, state, llmDraftHint ? "草案拓扑提示已生成" : "模型未返回有效提示");
  } else {
    markStep(state, "llm", "skipped", shouldRun("llm") ? "LLM 不可用，直接进入草案生成" : "计划未包含 LLM 生成");
    await updateTodoList({ llm: shouldRun("llm") ? "failed" : "skipped" }, "更新任务列表：llm 跳过");
  }

  if (shouldRun("draft")) {
    await updateTodoList({ draft: "running" }, "更新任务列表：draft");
    updateTask(state, tasks.draft, "running");
    thought(state, "Draft", "将需求、元件候选和模型提示组合为结构化草案计划。", "draft");
    emitProgress(deps, state, "正在生成结构化草案与预览");
    draftPlan = await invokeObserved<{ userQuery: string; selectedDevices?: SelectedDevice[] }, AgentResult["draftPlan"]>(
      deps,
      state,
      "draft.generate_plan",
      { userQuery: llmDraftHint ? `${deps.task.userQuery}\n${llmDraftHint}` : deps.task.userQuery, selectedDevices },
      "生成结构化草案计划"
    );
    draftPreview = await invokeObserved<{ plan: NonNullable<typeof draftPlan> }, AgentResult["draftPreview"]>(
      deps,
      state,
      "draft.preview_plan",
      { plan: draftPlan! },
      "构建草案预览"
    );
    updateTask(state, tasks.draft, "done", `已生成草案，器件 ${draftPlan?.components.length ?? 0} 个，网络 ${draftPlan?.nets.length ?? 0} 条`);
    markStep(state, "draft", "done", `已生成草案，器件 ${draftPlan?.components.length ?? 0} 个，网络 ${draftPlan?.nets.length ?? 0} 条`);
    await updateTodoList({ draft: "done" }, "更新任务列表：draft 完成");
    state.workingMemory.draftReady = true;
    state.workingMemory.lastObservation = `草案器件 ${draftPlan?.components.length ?? 0} 个，网络 ${draftPlan?.nets.length ?? 0} 条`;
    emitProgress(deps, state, `草案已生成，器件 ${draftPlan?.components.length ?? 0} 个，网络 ${draftPlan?.nets.length ?? 0} 条`);
  } else {
    updateTask(state, tasks.draft, "skipped", "计划未包含草案生成");
    markStep(state, "draft", "skipped", "计划未包含草案生成");
    await updateTodoList({ draft: "skipped" }, "更新任务列表：draft 跳过");
  }

  if (shouldRun("rules")) {
    await updateTodoList({ rules: "running" }, "更新任务列表：rules");
    updateTask(state, tasks.rules, "running");
    thought(state, "Validate", "在预览前执行规则校验，确保高风险草案不会直接进入应用。", "rules");
    emitProgress(deps, state, "正在校验草案风险");
    draftValidation = await invokeObserved<
      { draft: { components: NonNullable<typeof draftPlan>["components"]; pins: NonNullable<typeof draftPlan>["pins"]; nets: NonNullable<typeof draftPlan>["nets"] } },
      AgentResult["draftValidation"]
    >(
      deps,
      state,
      "rules.validate_draft",
      { draft: { components: draftPlan!.components, pins: draftPlan!.pins, nets: draftPlan!.nets } },
      "校验草案约束"
    );
    draftRisk = evaluateDraftRisk(draftValidation);
    if (canUse(deps, "editor.preview_apply_plan")) {
      await invokeObserved<{ plan: NonNullable<typeof draftPlan> }, unknown>(deps, state, "editor.preview_apply_plan", { plan: draftPlan! }, "渲染草案预览");
    }
    updateTask(state, tasks.rules, draftRisk.level === "blocked" ? "failed" : "done", draftRisk.message);
    await updateTodoList({ rules: draftRisk.level === "blocked" ? "failed" : "done" }, "更新任务列表：rules 完成");
    markStep(state, "rules", "done", draftValidation?.summary ?? draftRisk.message);
    state.workingMemory.rulesReady = true;
    state.workingMemory.lastObservation = draftValidation?.summary ?? draftRisk.message;
    emitProgress(deps, state, draftRisk.message);
  } else {
    updateTask(state, tasks.rules, "skipped", "计划未包含草案校验");
    markStep(state, "rules", "skipped", "计划未包含草案校验");
    await updateTodoList({ rules: "skipped" }, "更新任务列表：rules 跳过");
  }

  final(state, `草案流程完成，风险级别 ${draftRisk.level}`);
  emitProgress(deps, state, `草案流程完成，风险级别 ${draftRisk.level}`);

  return {
    reactEvents: state.reactEvents,
    result: {
      summary: `generated draft plan; ${draftValidation?.summary ?? "no validation result"}; mcp_resources=${mcpResources.length}`,
      nextSuggestions: buildDraftSuggestions(draftRisk, draftValidation),
      structuredSuggestions: buildDraftStructuredSuggestions(draftRisk),
      llmDraftHint,
      toolTraceNames: deps.listToolNames(),
      toolTraces: state.toolTraces,
      executionTraces: convertReactEventsToExecutionTraces(state.reactEvents),
      mcpResources,
      mcpResourceReads,
      draftPlan,
      draftPreview,
      draftValidation,
      draftRisk,
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

function assertContext(task: AgentTask): asserts task is AgentTask & { context: NonNullable<AgentTask["context"]> } {
  if (!task.context) throw new Error(`task context missing: ${task.type}`);
}

function createWorkingMemory(task: AgentTask): AgentWorkingMemory {
  return { hasContext: Boolean(task.context), mcpReady: false, libraryReady: false, llmReady: false, rulesReady: false, draftReady: false };
}

function canUse(deps: ReactAgentDeps, toolName: string): boolean {
  return deps.allowedTools.includes(toolName);
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
  if (text) event.text = text;
}

function thought(state: ReactAgentState, label: string, text: string, stepKind?: AgentStepState["kind"]): void {
  state.reactEvents.push({ kind: "thought", label, status: "done", text, stepKind });
}

function final(state: ReactAgentState, text: string): void {
  state.reactEvents.push({ kind: "final", label: "Finish", status: "done", text });
}

function markStep(state: ReactAgentState, kind: AgentStepState["kind"], status: AgentStepState["status"], observation: string): void {
  const existing = state.stepStates.find((step) => step.kind === kind);
  if (existing) {
    existing.status = status;
    existing.observation = observation;
    return;
  }
  state.stepStates.push({ kind, required: true, note: observation, status, observation });
}

async function invokeObserved<TInput, TOutput>(deps: ReactAgentDeps, state: ReactAgentState, toolName: string, input: TInput, goal: string): Promise<TOutput> {
  const inputSummary = summarizeToolInput(toolName, input);
  state.reactEvents.push({ kind: "tool_call", label: mapToolNameToLabel(toolName), status: "running", text: goal, toolName, inputSummary });
  try {
    const output = await deps.invokeTool<TInput, TOutput>(toolName, input);
    const outputSummary = summarizeToolOutput(toolName, output);
    state.toolTraces.push({ toolName, status: "success", note: outputSummary || undefined });
    state.reactEvents.push({ kind: "observation", label: mapToolNameToLabel(toolName), status: "done", text: outputSummary || `${mapToolNameToLabel(toolName)} completed`, toolName, outputSummary });
    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.toolTraces.push({ toolName, status: "blocked", note: message });
    state.reactEvents.push({ kind: "observation", label: mapToolNameToLabel(toolName), status: "failed", text: message, toolName, outputSummary: message });
    throw error;
  }
}

function pickSelectedDevices(userQuery: string, items: LibrarySearchResultItem[]): SelectedDevice[] {
  const selected: SelectedDevice[] = [];
  if (/ldo|稳压|regulator|3\.3v|5v/i.test(userQuery)) {
    const ldo = pickBestLibraryCandidate(items, ["ldo", "regulator", "3.3v", "5v", "sot-23", "sot23"]);
    if (ldo?.uuid && ldo.libraryUuid) {
      selected.push({
        role: "ldo_regulator",
        query: userQuery,
        deviceUuid: ldo.uuid,
        libraryUuid: ldo.libraryUuid,
        name: ldo.name,
        manufacturer: ldo.manufacturer,
        symbolUuid: ldo.symbolUuid,
        symbolName: ldo.symbolName,
        footprintUuid: ldo.footprintUuid,
        footprintName: ldo.footprintName,
      });
    }
  }
  return selected;
}

function buildLibraryHint(items: LibrarySearchResultItem[]): string {
  return "可参考的综合库候选器件：\n" + items.slice(0, 5).map((item) => `- ${item.name} (uuid=${item.uuid}${item.manufacturer ? `, manufacturer=${item.manufacturer}` : ""}${item.footprintName ? `, footprint=${item.footprintName}` : ""}${item.symbolName ? `, symbol=${item.symbolName}` : ""})`).join("\n");
}

function pickBestLibraryCandidate<T extends { name?: string; description?: string; footprintName?: string; manufacturer?: string }>(items: T[], keywords: string[]): T | undefined {
  return items.map((item) => ({ item, score: scoreLibraryCandidate(item, keywords) })).sort((a, b) => b.score - a.score)[0]?.item;
}

function scoreLibraryCandidate(item: { name?: string; description?: string; footprintName?: string; manufacturer?: string }, keywords: string[]): number {
  const haystack = [item.name ?? "", item.description ?? "", item.footprintName ?? "", item.manufacturer ?? ""].join(" ").toLowerCase();
  return keywords.reduce((score, keyword) => (haystack.includes(keyword.toLowerCase()) ? score + 10 : score), 0);
}

function evaluateDraftRisk(draftValidation: AgentResult["draftValidation"]): NonNullable<AgentResult["draftRisk"]> {
  const issues = draftValidation?.issues ?? [];
  const highSeverityCount = issues.filter((issue) => issue.severity === "high").length;
  if (highSeverityCount > 0) {
    return { level: "blocked", issueCount: issues.length, highSeverityCount, message: `存在 ${highSeverityCount} 个高风险问题，阻断直接应用` };
  }
  if (issues.length > 0) {
    return { level: "warning", issueCount: issues.length, highSeverityCount: 0, message: `存在 ${issues.length} 个待确认问题，允许人工复核后决定是否应用` };
  }
  return { level: "safe", issueCount: 0, highSeverityCount: 0, message: "验证通过，可进入应用确认" };
}

function buildDraftSuggestions(draftRisk: AgentResult["draftRisk"], draftValidation: AgentResult["draftValidation"]): string[] {
  if (!draftRisk) return [];
  if (draftRisk.level === "blocked") {
    return ["建议先重新分析当前原理图约束，再重新生成草案。", "如果是器件选择导致风险，优先调整库候选或修改需求描述。"]; 
  }
  if (draftRisk.level === "warning") {
    return ["建议先人工复核验证问题，再决定是否应用草案。", `当前仍有 ${draftValidation?.issues.length ?? 0} 个待确认问题。`];
  }
  return ["草案验证通过，可以进入人工确认并决定是否应用。"]; 
}

function buildDraftStructuredSuggestions(draftRisk: AgentResult["draftRisk"]): NonNullable<AgentResult["structuredSuggestions"]> {
  if (!draftRisk) return [];
  if (draftRisk.level === "blocked") {
    return [
      { label: "重新分析约束", actionType: "rerun_analysis" },
      { label: "重新生成草案", actionType: "regenerate_draft", prompt: "请基于当前问题重新生成一版更保守的草案" },
    ];
  }
  if (draftRisk.level === "warning") {
    return [
      { label: "带修正重生成", actionType: "regenerate_draft", prompt: "请结合当前验证问题重新生成并规避这些风险" },
      { label: "继续评审", actionType: "ask_followup", prompt: "请解释当前草案里的风险点，并给出修改建议" },
    ];
  }
  return [{ label: "继续优化草案", actionType: "ask_followup", prompt: "请继续优化当前草案的器件选择和连接细节" }];
}

function summarizeToolInput(toolName: string, input: unknown): string {
  if (toolName === "library.search_devices" && input && typeof input === "object") return `query=${String((input as { query?: string }).query || "")}`;
  if (toolName === "draft.generate_plan" && input && typeof input === "object") return `selected_devices=${((input as { selectedDevices?: unknown[] }).selectedDevices || []).length}`;
  if (toolName === "draft.preview_plan" && input && typeof input === "object") return `plan_components=${((input as { plan?: { components?: unknown[] } }).plan?.components || []).length}`;
  if (toolName === "rules.validate_draft" && input && typeof input === "object") return `draft_components=${((input as { draft?: { components?: unknown[] } }).draft?.components || []).length}`;
  if (toolName === "llm.generate" && input && typeof input === "object") return `messages=${((input as { messages?: unknown[] }).messages || []).length}`;
  if (toolName === "todo_list" && input && typeof input === "object") return `tasks=${((input as { tasks?: unknown[] }).tasks || []).length}`;
  return "";
}

function summarizeToolOutput(toolName: string, output: unknown): string {
  if (toolName === "library.search_devices" && Array.isArray(output)) {
    if (output.length === 0) return "未找到匹配器件";
    const first = output[0] as { name?: string; manufacturer?: string; footprintName?: string };
    return [`找到 ${output.length} 个候选`, first?.name ? `首项 ${first.name}` : "", first?.manufacturer || "", first?.footprintName ? `封装 ${first.footprintName}` : ""].filter(Boolean).join("，");
  }
  if (toolName === "mcp.list_resources" && output && typeof output === "object") return `已加载 ${((output as { resources?: unknown[] }).resources || []).length} 条知识资源`;
  if (toolName === "mcp.read_resource" && output && typeof output === "object") return [((output as { title?: string }).title || ""), ((output as { summary?: string }).summary || "")].filter(Boolean).join("：");
  if (toolName === "draft.generate_plan" && output && typeof output === "object") return `生成草案计划，器件 ${((output as { components?: unknown[] }).components || []).length} 个，网络 ${((output as { nets?: unknown[] }).nets || []).length} 条`;
  if (toolName === "draft.preview_plan" && output && typeof output === "object") return `生成草案预览，器件 ${Number((output as { componentCount?: number }).componentCount || 0)} 个，网络 ${Number((output as { netCount?: number }).netCount || 0)} 条`;
  if (toolName === "rules.validate_draft" && output && typeof output === "object") return (output as { summary?: string }).summary || `发现 ${((output as { issues?: unknown[] }).issues || []).length} 个问题`;
  if (toolName === "editor.preview_apply_plan") return "已渲染草案预览";
  if (toolName === "llm.generate" && output && typeof output === "object") return (output as { output_text?: string }).output_text ? `已生成 ${(output as { output_text?: string }).output_text?.length || 0} 字草案提示` : "已生成草案提示";
  if (toolName === "todo_list" && output && typeof output === "object") {
    const tasks = (output as { tasks?: Array<{ text?: string }> }).tasks || [];
    return tasks.length > 0 ? `任务列表已创建（${tasks.length} 条）` : "任务列表为空";
  }
  return "";
}

function mapToolNameToLabel(toolName: string): string {
  const map: Record<string, string> = {
    "todo_list": "todo_list",
    "editor.get_current_context": "jlceda_get_schematic_context",
    "library.search_devices": "jlceda_search_component_library",
    "mcp.list_resources": "jlceda_list_knowledge_resources",
    "mcp.read_resource": "jlceda_read_knowledge_resource",
    "llm.generate": "llm_generate_draft_hint",
    "draft.generate_plan": "jlceda_generate_draft_plan",
    "draft.preview_plan": "jlceda_preview_draft",
    "rules.validate_draft": "jlceda_validate_draft",
    "editor.preview_apply_plan": "jlceda_preview_apply_plan",
  };
  return map[toolName] ?? toolName;
}
