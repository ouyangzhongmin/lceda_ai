import type { MainPanelState } from "../../ui/panels/mainPanel";
import { buildChatToolUserPrompt, buildNaturalChatMessages } from "../prompts/chatPrompts";
import { buildLibraryQuery, decideChatFollowupPolicy, decideChatToolPolicy, shouldUseToolBackedPrompt } from "../policies/chatToolPolicy";
import type { AgentResult, AgentStepState, AgentTask, AgentWorkingMemory } from "../shared/agentTypes";
import type { ReactAgentDeps, ReactAgentRunResult, ReactAgentState } from "./reactTypes";

type TodoStatus = "pending" | "running" | "done" | "failed" | "skipped";

interface ChatMicroPlan {
  // Whether to fetch current schematic context (counts/channel/selection ids).
  need_context?: boolean;
  // Whether to fetch selection details.
  need_selection?: boolean;
  // Whether to try searching the component library.
  need_library?: boolean;
  // Whether to fetch knowledge via RAG.
  need_rag?: boolean;
  // Optional object query, like "U1" / "net 3V3" / "U1.5"
  object_query?: string;
  // Optional queries for library/rag.
  library_query?: string;
  rag_query?: string;
  // Short, user-safe rationale. Do not put chain-of-thought here.
  rationale?: string;
}

interface ChatReactAgentDeps extends ReactAgentDeps {
  panelState: MainPanelState;
}

interface RagSearchResult {
  results?: Array<{
    title?: string;
    source_ref?: string;
    kb_type?: string;
    snippet?: string;
    content?: string;
  }>;
}

interface LibrarySearchResultItem {
  name: string;
  uuid: string;
  libraryUuid: string;
  manufacturer?: string;
  footprintName?: string;
  description?: string;
}

interface LibraryDeviceDetail {
  uuid: string;
  name?: string;
  lcscId?: string;
  manufacturer?: string;
  description?: string;
  footprint?: {
    name?: string;
  };
}

interface EditorDescribeSelectionResult {
  count: number;
  summary: string;
  items: Array<{
    found: boolean;
    objectId: string;
    objectType: "component" | "pin" | "net";
    summary: string;
  }>;
}

interface EditorFindObjectResult {
  found: boolean;
  query: string;
  objectId?: string;
  objectType?: "component" | "pin" | "net";
  summary: string;
  matches?: Array<{
    objectId: string;
    objectType: "component" | "pin" | "net";
    summary: string;
    score: number;
  }>;
  object?: {
    found: boolean;
    objectId: string;
    objectType: "component" | "pin" | "net";
    summary: string;
  };
}

export async function runChatReactAgent(
  deps: ChatReactAgentDeps,
  options?: {
    onStreamEvent?: (event: {
      route: "chat" | "analysis" | "draft";
      stage: "llm";
      textDelta?: string;
      text?: string;
      detail?: string;
    }) => void;
    intentHint?: string;
  }
): Promise<ReactAgentRunResult> {
  const state: ReactAgentState = {
    toolTraces: [],
    stepStates: [],
    workingMemory: createWorkingMemory(deps.task),
    reactEvents: [],
  };

  thought(state, "意图", options?.intentHint ?? "识别用户意图为自然闲聊", "llm");
  // Chat route still follows a light ReAct: micro-plan -> optional tools -> final response.
  const planTaskId = pushTask(state, "llm", "生成本轮执行计划");
  updateTask(state, planTaskId, "running");

  // Default to no context facts unless we actually observed them via tools.
  // Panel state may carry placeholder values ("unknown/0") that should not be echoed as facts.
  let contextSummary = "";
  let selectionSummary = "";
  const ragSummary: string[] = [];
  const librarySummary: string[] = [];
  const objectSummary: string[] = [];
  let objectKnowledgeQuery = "";
  const fallbackPolicy = decideChatToolPolicy(deps.task.userQuery);
  const microPlan = await planChatTurnViaLLM(deps, state, deps.task.userQuery, fallbackPolicy);
  updateTask(state, planTaskId, "done", "计划已生成");
  markStep(state, "llm", "done", microPlan.rationale ? `计划：${microPlan.rationale}` : "计划已生成");

  const todoTasks: Array<{ text: string; status?: TodoStatus; key: string }> = [];
  if (microPlan.need_context && canUse(deps, "editor.get_current_context")) {
    todoTasks.push({ key: "context", text: "读取当前原理图基础信息", status: "pending" });
  }
  if (microPlan.need_selection && canUse(deps, "editor.describe_selection")) {
    todoTasks.push({ key: "selection", text: "解释当前选中对象", status: "pending" });
  }
  if ((microPlan.object_query || fallbackPolicy.objectQuery) && canUse(deps, "editor.find_object")) {
    todoTasks.push({ key: "object", text: "在图中查找相关对象", status: "pending" });
  }
  if (microPlan.need_library && canUse(deps, "library.search_devices")) {
    todoTasks.push({ key: "library", text: "查询元件库补充器件信息", status: "pending" });
  }
  if (microPlan.need_rag && canUse(deps, "rag.search")) {
    todoTasks.push({ key: "rag", text: "查询知识证据补充解释", status: "pending" });
  }
  todoTasks.push({ key: "reply", text: "生成自然回复", status: "pending" });

  const todoEnabled =
    todoTasks.some((task) => task.key !== "reply") &&
    canUse(deps, "todo_list");
  if (todoEnabled) {
    await invokeObserved(
      deps,
      state,
      "todo_list",
      { action: "create", tasks: todoTasks.map((t) => ({ text: t.text, status: t.status })) },
      "创建任务列表"
    );
  }

  selectionSummary = summarizeSelection(deps.panelState);

  async function updateTodo(statuses: Partial<Record<string, TodoStatus>>, goal: string) {
    if (!todoEnabled) return;
    const tasks = todoTasks.map((t) => ({ text: t.text, status: (statuses[t.key] ?? t.status ?? "pending") as TodoStatus }));
    for (const t of todoTasks) {
      t.status = (statuses[t.key] ?? t.status ?? "pending") as TodoStatus;
    }
    await invokeObserved(deps, state, "todo_list", { action: "update", tasks }, goal);
  }

  if (microPlan.need_context && canUse(deps, "editor.get_current_context")) {
    thought(state, "上下文", "先读取当前原理图上下文，确认我能看到哪些基础信息。", "context");
    await updateTodo({ context: "running" }, "更新任务列表：读取上下文");
    try {
      const context = await invokeObserved<
        undefined,
        { project?: { channel?: string; projectId?: string; pageId?: string }; components?: unknown[]; nets?: unknown[]; selection?: { objectIds?: unknown[] } }
      >(deps, state, "editor.get_current_context", undefined, "读取当前原理图上下文");
      
      // 构建详细的上下文摘要，包含原理图标识信息
      const schematicInfo = [];
      const schematicName = context.project?.pageName?.trim();
      if (schematicName) {
        schematicInfo.push(`原理图: ${schematicName}`);
      }
      if (context.project?.projectId) {
        schematicInfo.push(`项目ID: ${context.project.projectId}`);
      }
      if (context.project?.pageId) {
        schematicInfo.push(`页面ID: ${context.project.pageId}`);
      }
      schematicInfo.push(`版本: ${context.project?.channel === "professional" ? "专业版" : "标准版"}`);
      schematicInfo.push(`器件数: ${context.components?.length ?? 0}`);
      schematicInfo.push(`网络数: ${context.nets?.length ?? 0}`);
      
      contextSummary = schematicInfo.join(", ");
      state.workingMemory.hasContext = true;
      markStep(state, "context", "done", `已读取原理图 (${contextSummary})`);
      state.workingMemory.lastObservation = `已读取原理图 (${contextSummary})`;
      await updateTodo({ context: "done" }, "更新任务列表：上下文完成");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      markStep(state, "context", "failed", `读取原理图上下文失败：${message}`);
      state.workingMemory.hasContext = false;
      state.workingMemory.lastObservation = `读取原理图上下文失败：${message}`;
      contextSummary = "";
      await updateTodo({ context: "failed" }, "更新任务列表：上下文失败");
    }
  } else {
    await updateTodo({ context: "skipped" }, "更新任务列表：上下文跳过");
  }

  if (microPlan.need_selection && canUse(deps, "editor.describe_selection")) {
    thought(state, "选区", "读取选中对象，便于结合具体器件回答。", "context");
    await updateTodo({ selection: "running" }, "更新任务列表：选区进行中");
    try {
      const selection = await invokeObserved<undefined, EditorDescribeSelectionResult>(
        deps,
        state,
        "editor.describe_selection",
        undefined,
        "解释当前选区"
      );
      selectionSummary = selection.summary;
      await updateTodo({ selection: "done" }, "更新任务列表：选区完成");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateTodo({ selection: "failed" }, `更新任务列表：选区失败 ${message}`);
    }
  } else {
    await updateTodo({ selection: "skipped" }, "更新任务列表：选区跳过");
  }

  const objectQuery = (microPlan.object_query || fallbackPolicy.objectQuery || "").trim();
  if (objectQuery && canUse(deps, "editor.find_object")) {
    thought(state, "对象", "用户提到了具体对象标识，先在当前原理图里查找。", "context");
    await updateTodo({ object: "running" }, "更新任务列表：对象查找进行中");
    try {
      const found = await invokeObserved<{ query: string }, EditorFindObjectResult>(
        deps,
        state,
        "editor.find_object",
        { query: objectQuery },
        `查找原理图对象：${objectQuery}`
      );
      if (found.found && found.summary) {
        objectSummary.push(found.summary);
        if ((found.matches ?? []).length > 1) {
          objectSummary.push(`候选对象：${(found.matches ?? []).slice(0, 3).map((item) => item.summary).join("；")}`);
        }
        selectionSummary =
          selectionSummary && selectionSummary !== "当前没有选中对象"
            ? `${selectionSummary}；${found.summary}`
            : found.summary;
        const followupPolicy = decideChatFollowupPolicy({
          objectFound: found.found,
          objectType: found.objectType,
          objectKnowledgeQuery,
          ragSummaryCount: ragSummary.length,
        });
        if (followupPolicy.enrichComponentLibrary && canUse(deps, "library.search_devices")) {
          thought(state, "元件库", "已定位到图中器件，继续补充元件库事实。", "library");
          await updateTodo({ library: "running" }, "更新任务列表：元件库进行中");
          const libraryResults = await invokeObserved<
            { query: string; scope?: "system"; pageSize?: number; page?: number },
            LibrarySearchResultItem[]
          >(deps, state, "library.search_devices", { query: objectQuery, scope: "system", pageSize: 5, page: 1 }, `按对象检索元件库：${objectQuery}`);
          if (libraryResults.length > 0) {
            const top = libraryResults[0];
            let detailSummary = [top.name, top.manufacturer, top.footprintName ? `封装 ${top.footprintName}` : "", top.description || ""]
              .filter(Boolean)
              .join("，");
            if (canUse(deps, "library.get_device")) {
              try {
                const detail = await invokeObserved<{ deviceUuid: string; libraryUuid?: string; scope?: "system" }, LibraryDeviceDetail>(
                  deps,
                  state,
                  "library.get_device",
                  { deviceUuid: top.uuid, libraryUuid: top.libraryUuid, scope: "system" },
                  `读取元件库详情：${top.name}`
                );
                detailSummary = [
                  detail.name || top.name,
                  detail.lcscId ? `LCSC ${detail.lcscId}` : "",
                  detail.manufacturer || top.manufacturer || "",
                  detail.footprint?.name
                    ? `封装 ${detail.footprint.name}`
                    : top.footprintName
                      ? `封装 ${top.footprintName}`
                      : "",
                  detail.description || top.description || "",
                ]
                  .filter(Boolean)
                  .join("，");
              } catch {
                // best effort
              }
            }
            librarySummary.push(detailSummary);
            state.workingMemory.libraryReady = true;
            markStep(state, "library", "done", "已补充元件库详情");
            state.workingMemory.lastObservation = "已补充元件库详情";
            objectKnowledgeQuery = [objectQuery, top.name, top.description || "", detailSummary].filter(Boolean).join(" ");
          }
          await updateTodo({ library: "done" }, "更新任务列表：元件库完成");
        }
      }
      await updateTodo({ object: "done" }, "更新任务列表：对象查找完成");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateTodo({ object: "failed" }, `更新任务列表：对象查找失败 ${message}`);
    }
  }

  if (microPlan.need_library && canUse(deps, "library.search_devices") && librarySummary.length === 0) {
    thought(state, "元件库", "用户问题像是在问元件或封装信息，先查元件库事实。", "library");
    await updateTodo({ library: "running" }, "更新任务列表：元件库进行中");
    const query = (microPlan.library_query || buildLibraryQuery(deps.task.userQuery)).trim();
    const results = await invokeObserved<
      { query: string; scope?: "system"; pageSize?: number; page?: number },
      LibrarySearchResultItem[]
    >(deps, state, "library.search_devices", { query, scope: "system", pageSize: 6, page: 1 }, `查询元件库：${query}`);
    librarySummary.push(
      ...results
        .slice(0, 3)
        .map((item) => [item.name, item.manufacturer, item.footprintName ? `封装 ${item.footprintName}` : "", item.description || ""].filter(Boolean).join("，"))
    );
    if (librarySummary.length > 0) {
      state.workingMemory.libraryReady = true;
      markStep(state, "library", "done", `元件库返回 ${librarySummary.length} 条摘要`);
      state.workingMemory.lastObservation = `元件库返回 ${librarySummary.length} 条摘要`;
      await updateTodo({ library: "done" }, "更新任务列表：元件库完成");
    } else {
      await updateTodo({ library: "done" }, "更新任务列表：元件库无结果");
    }
  } else if (!microPlan.need_library) {
    await updateTodo({ library: "skipped" }, "更新任务列表：元件库跳过");
  }

  if (microPlan.need_rag && canUse(deps, "rag.search")) {
    thought(state, "知识", "补充一些设计原理或注意事项，避免凭空回答。", "mcp");
    await updateTodo({ rag: "running" }, "更新任务列表：知识查询进行中");
    const query = (microPlan.rag_query || deps.task.userQuery).trim();
    const rag = await invokeObserved<{ query: string; topK?: number }, RagSearchResult>(
      deps,
      state,
      "rag.search",
      { query, topK: 3 },
      `查询知识证据：${query}`
    );
    ragSummary.push(
      ...((rag.results ?? []).slice(0, 3).map((item) =>
        [item.title, item.kb_type ? `类型 ${item.kb_type}` : "", item.source_ref ? `来源 ${item.source_ref}` : "", item.snippet || item.content || ""]
          .filter(Boolean)
          .join("，")
      ))
    );
    if (ragSummary.length > 0) {
      state.workingMemory.mcpReady = true;
      markStep(state, "mcp", "done", `知识证据 ${ragSummary.length} 条`);
      state.workingMemory.lastObservation = `知识证据 ${ragSummary.length} 条`;
    }
    await updateTodo({ rag: "done" }, "更新任务列表：知识查询完成");
  } else {
    await updateTodo({ rag: "skipped" }, "更新任务列表：知识查询跳过");
  }

  const objectFollowupPolicy = decideChatFollowupPolicy({
    objectFound: Boolean(objectSummary.length),
    objectKnowledgeQuery,
    ragSummaryCount: ragSummary.length,
  });
  if (objectFollowupPolicy.enrichObjectKnowledge && canUse(deps, "rag.search")) {
    thought(state, "RAG", "已识别到具体器件，继续补充这类器件的用途和设计注意事项。", "mcp");
    const rag = await invokeObserved<{ query: string; topK?: number }, RagSearchResult>(
      deps,
      state,
      "rag.search",
      { query: `${objectKnowledgeQuery} 器件用途 使用注意事项 典型接法`, topK: 3 },
      `查询器件知识说明：${objectQuery}`
    );
    ragSummary.push(
      ...((rag.results ?? []).slice(0, 3).map((item) =>
        [item.title, item.kb_type ? `类型 ${item.kb_type}` : "", item.source_ref ? `来源 ${item.source_ref}` : "", item.snippet || item.content || ""]
          .filter(Boolean)
          .join("，")
      ))
    );
    if (ragSummary.length > 0) {
      state.workingMemory.mcpReady = true;
      markStep(state, "mcp", "done", `已补充器件知识 ${ragSummary.length} 条`);
      state.workingMemory.lastObservation = `已补充器件知识 ${ragSummary.length} 条`;
    }
  }

  await updateTodo({ reply: "running" }, "更新任务列表：生成回复");
  thought(state, "回复", "基于最近对话和已观测到的工具结果生成自然回复。", "llm");
  markStep(state, "llm", "running", "准备自然对话请求");
  const llmMessages = shouldUseToolBackedPrompt({
    contextSummary,
    selectionSummary,
    ragSummary,
    librarySummary,
    objectSummary,
  })
    ? [
        {
          role: "system" as const,
          content:
            "你是嘉立创 EDA 插件中的 AI 助手。现在插件端 agent 已经提供了部分工具观测结果。" +
            "你必须优先使用这些观测结果回答，不能忽略事实后自由发挥。",
        },
        {
          role: "user" as const,
          content: buildChatToolUserPrompt({
            userQuery: deps.task.userQuery,
            editorContextSummary: contextSummary,
            selectionSummary,
            ragSummary,
            librarySummary: [...objectSummary, ...librarySummary],
          }),
        },
      ]
    : buildNaturalChatMessages(deps.panelState, deps.task.userQuery);

  const result = await invokeObserved<
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
          options?.onStreamEvent?.({ route: "chat", stage: "llm", textDelta: event.delta, detail: "正在生成回复..." });
        }
        if (event.type === "done") {
          options?.onStreamEvent?.({ route: "chat", stage: "llm", text: event.output_text, detail: "回复已生成" });
        }
      },
      messages: llmMessages,
    },
    "生成自然语言回复"
  );

  await updateTodo({ reply: "done" }, "更新任务列表：回复完成");
  markStep(state, "llm", "done", "自然语言回复已生成");
  state.workingMemory.llmReady = true;
  state.workingMemory.lastObservation = "自然语言回复已生成";
  final(state, "自然对话完成");

  return {
    reactEvents: state.reactEvents,
    result: {
      summary: "natural chat reply generated",
      naturalReply: result.output_text?.trim() || "我暂时没有生成可展示的回复。",
      toolTraceNames: deps.listToolNames(),
      toolTraces: state.toolTraces,
      executionTraces: convertReactEventsToExecutionTraces(state.reactEvents),
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

function createWorkingMemory(task: AgentTask): AgentWorkingMemory {
  return { hasContext: Boolean(task.context), mcpReady: false, libraryReady: false, llmReady: false, rulesReady: false, draftReady: false };
}

function canUse(deps: ReactAgentDeps, toolName: string): boolean {
  return deps.allowedTools.includes(toolName);
}

function summarizePanelContext(state: MainPanelState): string {
  return [
    `channel=${state.channel ?? "unknown"}`,
    `components=${state.componentCount ?? 0}`,
    `nets=${state.netCount ?? 0}`,
    `issues=${state.issueCount ?? 0}`,
    `selection=${state.selectionCount ?? 0}`,
  ].join(", ");
}

function summarizeSelection(state: MainPanelState): string {
  if (!state.selectionCount) {
    return "当前没有选中对象";
  }
  return `当前选中 ${state.selectionCount} 个对象`;
}

async function planChatTurnViaLLM(
  deps: ReactAgentDeps,
  state: ReactAgentState,
  userQuery: string,
  fallback: ReturnType<typeof decideChatToolPolicy>
): Promise<Required<Pick<ChatMicroPlan, "need_context" | "need_selection" | "need_library" | "need_rag" | "object_query" | "library_query" | "rag_query" | "rationale">>> {
  // We keep the "rationale" user-safe and short, and avoid chain-of-thought.
  const system = [
    "你是嘉立创 EDA 插件中的对话执行规划器。",
    "目标：在尽量少的步骤下回答用户问题；当需要事实时才调用工具。",
    "可用工具（按需选择）：editor.get_current_context（读原理图基础信息）、editor.describe_selection、editor.find_object、library.search_devices、rag.search。",
    "只输出 JSON，不要输出解释文本。",
    "JSON schema：",
    "{",
    '  "need_context": boolean,',
    '  "need_selection": boolean,',
    '  "need_library": boolean,',
    '  "need_rag": boolean,',
    '  "object_query": string,',
    '  "library_query": string,',
    '  "rag_query": string,',
    '  "rationale": string',
    "}",
    'rationale 需要面向用户且简短，例如："先读取原理图基础信息以确认上下文" 或 "无需工具，直接闲聊回复"。',
  ].join("\n");
  const user = [
    `用户输入：${userQuery}`,
    "",
    "提示：如果用户只是问候(例如“你好”)，你可以选择 need_context=true 以便回一句“我已连接到当前原理图，器件数/网络数...”。如果看不到上下文也没关系，后续会提示用户打开原理图页面。",
    "",
    `fallback_hint: useEditorContext=${fallback.useEditorContext}, useSelection=${fallback.useSelection}, useLibrary=${fallback.useLibrary}, useRag=${fallback.useRag}, objectQuery=${fallback.objectQuery || ""}`,
  ].join("\n");

  try {
    const result = await invokeObserved<
      { stream?: boolean; messages: Array<{ role: "system" | "user" | "assistant"; content: string }> },
      { output_text?: string }
    >(deps, state, "llm.generate", { stream: false, messages: [{ role: "system", content: system }, { role: "user", content: user }] }, "生成执行计划");

    const jsonText = result.output_text?.match(/\{[\s\S]*\}/)?.[0] ?? "";
    const parsed = JSON.parse(jsonText) as ChatMicroPlan;
    return {
      need_context: Boolean(parsed.need_context),
      need_selection: Boolean(parsed.need_selection),
      need_library: Boolean(parsed.need_library),
      need_rag: Boolean(parsed.need_rag),
      object_query: String(parsed.object_query ?? ""),
      library_query: String(parsed.library_query ?? ""),
      rag_query: String(parsed.rag_query ?? ""),
      rationale: String(parsed.rationale ?? "").trim() || "根据用户输入选择必要的工具观测后生成回复",
    };
  } catch {
    // Fallback to cheap heuristics if planner output is invalid.
    return {
      need_context: Boolean(fallback.useEditorContext),
      need_selection: Boolean(fallback.useSelection),
      need_library: Boolean(fallback.useLibrary),
      need_rag: Boolean(fallback.useRag),
      object_query: fallback.objectQuery || "",
      library_query: buildLibraryQuery(userQuery),
      rag_query: userQuery,
      rationale: "规划器不可用，回退到规则匹配策略",
    };
  }
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

function summarizeToolInput(toolName: string, input: unknown): string {
  if ((toolName === "llm.generate" || toolName === "rag.search") && input && typeof input === "object") {
    if (toolName === "llm.generate") return `消息数=${((input as { messages?: unknown[] }).messages || []).length}`;
    return `查询=${String((input as { query?: string }).query || "")}`;
  }
  if (toolName === "todo_list" && input && typeof input === "object") {
    return `任务数=${((input as { tasks?: unknown[] }).tasks || []).length}`;
  }
  if (toolName === "library.search_devices" && input && typeof input === "object") {
    return `查询=${String((input as { query?: string }).query || "")}`;
  }
  return "";
}

function summarizeToolOutput(toolName: string, output: unknown): string {
  if (toolName === "llm.generate" && output && typeof output === "object") {
    const text = (output as { output_text?: string }).output_text || "";
    return text ? `已生成 ${text.length} 字回复` : "已生成回复";
  }
  if (toolName === "editor.get_current_context" && output && typeof output === "object") {
    const context = output as { components?: unknown[]; nets?: unknown[]; selection?: { objectIds?: unknown[] } };
    return `上下文：器件 ${context.components?.length ?? 0} 个，网络 ${context.nets?.length ?? 0} 条，选区 ${(context.selection?.objectIds || []).length} 个`;
  }
  if (toolName === "editor.get_selection" && output && typeof output === "object") {
    const selection = output as { objectIds?: unknown[]; objectType?: string };
    return selection.objectIds?.length ? `选中 ${selection.objectIds.length} 个对象${selection.objectType ? `，类型 ${selection.objectType}` : ""}` : "当前没有选中对象";
  }
  if (toolName === "editor.describe_selection" && output && typeof output === "object") {
    return (output as EditorDescribeSelectionResult).summary || "已解释当前选区";
  }
  if (toolName === "editor.find_object" && output && typeof output === "object") {
    const result = output as EditorFindObjectResult;
    if ((result.matches ?? []).length > 1) {
      return `${result.summary}；候选 ${(result.matches ?? []).length} 个`;
    }
    return result.summary || "已找到相关对象";
  }
  if (toolName === "rag.search" && output && typeof output === "object") {
    return `知识证据 ${((output as RagSearchResult).results || []).length} 条`;
  }
  if (toolName === "library.search_devices" && Array.isArray(output)) {
    if (output.length === 0) return "未找到匹配元件";
    const first = output[0] as LibrarySearchResultItem;
    return [`找到 ${output.length} 个候选`, first.name ? `首项 ${first.name}` : "", first.manufacturer || "", first.footprintName ? `封装 ${first.footprintName}` : ""].filter(Boolean).join("，");
  }
  if (toolName === "library.get_device" && output && typeof output === "object") {
    const detail = output as LibraryDeviceDetail;
    return [
      detail.name || "",
      detail.lcscId ? `LCSC ${detail.lcscId}` : "",
      detail.manufacturer || "",
      detail.footprint?.name ? `封装 ${detail.footprint.name}` : "",
      detail.description || "",
    ]
      .filter(Boolean)
      .join("，");
  }
  if (toolName === "todo_list" && output && typeof output === "object") {
    const tasks = (output as { tasks?: Array<{ text?: string }> }).tasks || [];
    return tasks.length > 0 ? `任务列表已创建（${tasks.length} 条）` : "任务列表为空";
  }
  return "";
}

function mapToolNameToLabel(toolName: string): string {
  const map: Record<string, string> = {
    "todo_list": "任务列表",
    "llm.generate": "LLM 生成",
    "editor.get_current_context": "原理图上下文",
    "editor.get_selection": "当前选区",
    "editor.describe_selection": "选区描述",
    "editor.describe_object": "对象描述",
    "editor.find_object": "对象查找",
    "rag.search": "知识检索",
    "library.search_devices": "器件库搜索",
    "library.get_device": "器件详情",
  };
  return map[toolName] ?? toolName;
}
