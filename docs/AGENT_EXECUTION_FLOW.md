# Agent执行流程详解

本文档详细说明嘉立创EDA AI助手插件中Agent的完整执行流程。

## 目录
1. [整体架构](#整体架构)
2. [执行流程概览](#执行流程概览)
3. [详细步骤说明](#详细步骤说明)
4. [三种Agent类型](#三种agent类型)
5. [数据流转](#数据流转)
6. [关键组件](#关键组件)

---

## 整体架构

```
用户输入
    ↓
assistantRuntime.ts (UI层)
    ↓
agent/index.ts (Agent入口)
    ↓
core/unifiedReactAgent.ts (统一 ReAct 执行器)
    ↓
工具调用 (tools/)
    ↓
返回结果
```

---

## 执行流程概览

### 重要说明：统一 ReAct while-loop（LLM 全程决策）

**当前实现方式**：统一 ReAct 循环（Reason-Act-Observe-Reason-Act...）
- 所有任务统一由 `core/unifiedReactAgent.ts` 执行 while-loop
- 每一轮由 LLM 输出下一步 `Action(tool_call)` 或 `Final`
- 工具输出被摘要化为 `Observation` 注入回 LLM，用于下一轮决策
- 最终输出直接写入 `Final.output`，插件端根据结果字段推断 route（chat/analysis/draft）

**多轮 ReAct 循环**：
```
while (not done) {
  Reason: LLM 决定下一步要调用哪个工具，以及原因（rationale）
  Act:   调用工具（tool_call）
  Observe: 观察工具结果（Observation），并反馈给 LLM
}
Final: 由 LLM 触发最终输出工具（流式输出）
```

**实现对比**：

| 特性 | 多轮 ReAct | 计划-执行（两阶段） | 纯预定义序列 |
|------|-----------|---------------------|--------------|
| LLM决策次数 | 多次（每步） | 2次（plan + final） | 1次（final） |
| 灵活性 | 高 | 中 | 低 |
| 可控性 | 中（白名单/输入重写/摘要化） | 高 | 高 |
| Token消耗 | 中-高 | 中 | 低 |
| 适应性 | 强（能自我修正） | 中 | 弱 |

### 阶段1: 用户输入处理
**文件**: `plugin/src/app/assistantRuntime.ts`

```typescript
用户输入 → sendChat() → handleUserTurn()
```

1. 用户在UI输入文字
2. `sendChat()` 被调用
3. 创建pending assistant消息
4. 调用 `pluginAgent.handleUserTurn()`

### 阶段2: 统一执行器
**文件**: `plugin/src/agent/index.ts`

```typescript
handleUserTurn() → runUnifiedReactAgent() → runReActLoop()
```

1. **统一执行器**
   - 不再使用本地意图路由选择不同 agent
   - 统一进入 while-loop，由 LLM 决策调用哪些工具获取证据、何时输出 Final

### 阶段3: Agent执行
**文件**: `plugin/src/agent/core/unifiedReactAgent.ts`

```typescript
runUnifiedReactAgent() → runReActLoop()
```

执行要点：
- LLM 每轮输出 JSON action/final
- action 触发工具调用，tool 输出作为 observation 回填
- final 输出最终展示内容

### 阶段4: 结果处理
**文件**: `plugin/src/app/assistantRuntime.ts`

```typescript
AgentResult → applyTurnResultToState() → commitState() → UI更新
```

1. 接收agent返回的结果
2. 构建消息对象
3. 更新状态
4. 触发UI渲染

---

## 两阶段ReAct模式详解

当前实现是一个**简化的ReAct模式**，分为两个阶段：

### 阶段1: Planning（Reasoning）

**Chat Agent的Planning**：

```typescript
// 调用LLM生成micro plan
async function planChatTurnViaLLM(userQuery: string): Promise<ChatMicroPlan> {
  const result = await llm.generate({
    messages: [
      {
        role: "system",
        content: `你是对话执行规划器。
        可用工具：
        - editor.get_current_context（读原理图）
        - editor.describe_selection（读选区）
        - editor.find_object（查找对象）
        - library.search_devices（查元件库）
        - rag.search（查知识库）
        
        只输出JSON：
        {
          "need_context": boolean,
          "need_selection": boolean,
          "need_library": boolean,
          "need_rag": boolean,
          "object_query": string,
          "library_query": string,
          "rag_query": string,
          "rationale": string
        }`
      },
      {
        role: "user",
        content: `用户输入：${userQuery}`
      }
    ]
  });
  
  return JSON.parse(result.output_text);
}
```

**LLM的决策示例**：

用户输入："U1是什么芯片？"

LLM返回：
```json
{
  "need_context": true,
  "need_selection": false,
  "need_library": true,
  "need_rag": false,
  "object_query": "U1",
  "library_query": "U1",
  "rag_query": "",
  "rationale": "先在图中找到U1，再查元件库获取详细信息"
}
```

**Analysis/Draft Agent的Planning**：

这两个agent使用更高层的planner（在`agent/index.ts`中）：

```typescript
// 调用LLM生成执行计划
const plannerResult = await llmClient.generate({
  messages: [
    { role: "system", content: buildPlannerSystemPrompt() },
    { role: "user", content: buildPlannerUserPrompt(userQuery, intentHint) }
  ]
});

// 返回结构化计划
return {
  intent: "analysis",
  route: "analysis",
  requiresContext: true,
  steps: [
    { kind: "context", required: true, note: "读取当前原理图上下文" },
    { kind: "mcp", required: true, note: "提取整图摘要" },
    { kind: "rules", required: true, note: "运行规则检查" },
    { kind: "llm", required: true, note: "生成分析报告" }
  ]
};
```

### 阶段2: Execution（Acting + Observing）

**按计划执行工具序列**：

```typescript
// Chat Agent的执行
async function runChatReactAgent(deps, options) {
  const state = initializeState();
  
  // 1. Planning阶段
  const microPlan = await planChatTurnViaLLM(userQuery);
  
  // 2. Execution阶段 - 按计划执行
  let contextSummary = "";
  let selectionSummary = "";
  const ragSummary = [];
  const librarySummary = [];
  
  // 根据plan决定是否执行每个工具
  if (microPlan.need_context) {
    const context = await invokeTool("editor.get_current_context");
    contextSummary = formatContext(context);
    recordEvent(state, "tool_call", "editor.get_current_context");
    recordEvent(state, "observation", contextSummary);
  }
  
  if (microPlan.need_selection) {
    const selection = await invokeTool("editor.describe_selection");
    selectionSummary = selection.summary;
    recordEvent(state, "tool_call", "editor.describe_selection");
    recordEvent(state, "observation", selectionSummary);
  }
  
  if (microPlan.object_query) {
    const found = await invokeTool("editor.find_object", {
      query: microPlan.object_query
    });
    recordEvent(state, "tool_call", "editor.find_object");
    recordEvent(state, "observation", found.summary);
  }
  
  if (microPlan.need_library) {
    const results = await invokeTool("library.search_devices", {
      query: microPlan.library_query
    });
    librarySummary.push(...results.map(r => r.name));
    recordEvent(state, "tool_call", "library.search_devices");
    recordEvent(state, "observation", `找到${results.length}个器件`);
  }
  
  if (microPlan.need_rag) {
    const rag = await invokeTool("rag.search", {
      query: microPlan.rag_query
    });
    ragSummary.push(...rag.results.map(r => r.snippet));
    recordEvent(state, "tool_call", "rag.search");
    recordEvent(state, "observation", `找到${rag.results.length}条知识`);
  }
  
  // 3. 汇总所有观察结果，生成最终回复
  const finalReply = await invokeTool("llm.generate", {
    stream: true,
    messages: buildPromptWithObservations({
      userQuery,
      contextSummary,
      selectionSummary,
      ragSummary,
      librarySummary
    })
  });
  
  recordEvent(state, "tool_call", "llm.generate");
  recordEvent(state, "observation", finalReply.output_text);
  
  return { result: finalReply, reactEvents: state.reactEvents };
}
```

### 关键特点

1. **LLM决策工具选择**：
   - Planning阶段，LLM分析用户输入，决定需要哪些工具
   - 不是硬编码的固定序列
   - 根据不同的用户输入，会选择不同的工具组合

2. **一次性规划**：
   - 只在开始时规划一次，不会中途调整
   - 所有工具调用都是并行或顺序执行，不会根据中间结果重新规划

3. **观察结果汇总**：
   - 所有工具的观察结果都被收集起来
   - 最后一次性传给LLM生成最终回复

4. **事件记录**：
   - 每个工具调用都记录到`reactEvents`
   - 用于UI显示执行过程
   - 符合ReAct的Thought-Action-Observation模式

### 与传统ReAct的区别

**传统多轮ReAct**：
```
用户: "U1是什么芯片？"

Round 1:
  Thought: "我需要先在原理图中找到U1"
  Action: editor.find_object("U1")
  Observation: "找到U1，是一个STM32F103芯片"

Round 2:
  Thought: "现在我知道是STM32F103，需要查元件库获取详细信息"
  Action: library.search_devices("STM32F103")
  Observation: "找到STM32F103C8T6，32位MCU，64KB Flash"

Round 3:
  Thought: "信息已足够，可以回答用户"
  Action: finish
  Answer: "U1是STM32F103C8T6芯片，这是一个32位MCU..."
```

**当前两阶段ReAct**：
```
用户: "U1是什么芯片？"

Planning阶段:
  LLM分析: "需要find_object和library.search_devices"
  Plan: {
    need_context: true,
    object_query: "U1",
    need_library: true,
    library_query: "U1"
  }

Execution阶段:
  Action 1: editor.find_object("U1")
  Observation 1: "找到U1，是一个STM32F103芯片"
  
  Action 2: library.search_devices("U1")
  Observation 2: "找到STM32F103C8T6，32位MCU，64KB Flash"
  
  Final Action: llm.generate(所有观察结果)
  Answer: "U1是STM32F103C8T6芯片，这是一个32位MCU..."
```

### 为什么选择两阶段而不是多轮？

**优势**：
1. **性能**：只需2次LLM调用（plan + final），而不是N次
2. **并行化**：可以并行执行多个工具调用
3. **可预测**：执行流程相对固定，易于调试
4. **成本**：大幅降低token消耗

**劣势**：
1. **适应性**：无法根据中间结果动态调整
2. **复杂推理**：不适合需要多步推理的复杂任务

**适用场景**：
- ✅ 信息检索类任务（查找、搜索、读取）
- ✅ 结构化分析任务（检查、验证、报告）
- ❌ 复杂推理任务（需要多步试错）
- ❌ 交互式任务（需要用户反馈）

---

## 详细步骤说明

### 步骤1: 用户输入 (assistantRuntime.ts)

**入口函数**: `sendChat(input: string)`

```typescript
// 1. 验证登录状态
const session = await sessionStore.get();
if (!session) throw new Error("NOT_LOGGED_IN");

// 2. 创建用户消息
const userMessage = { role: "user", content: input };

// 3. 创建pending assistant消息
const pendingMessage = {
  role: "assistant",
  title: "分析中",
  content: "",
  streaming: true
};

// 4. 更新UI状态
commitState(internals, current, storage);

// 5. 调用agent
const turn = await pluginAgent.handleUserTurn({
  userQuery: input,
  panelState: current,
  context: await adapter.getCurrentContext(),
  adapter,
  onStreamEvent: (event) => {
    // 实时更新streaming消息
    lastMessage.reactEvents = event.reactEvents;
    lastMessage.stepStates = event.stepStates;
    commitState(internals, current, storage);
  }
});
```

**关键点**:
- 使用`onStreamEvent`回调实时更新UI
- `reactEvents`和`stepStates`用于显示执行步骤
- `streaming: true`标记消息正在生成

---

### 步骤2: 意图分类 (agent/index.ts)

**函数**: `classifyUserIntent()`

```typescript
// 调用LLM分类意图
const result = await llmClient.generate(accessToken, {
  messages: [
    {
      role: "system",
      content: "你是嘉立创 EDA 插件的意图分类器..."
    },
    {
      role: "user",
      content: `用户输入：${userQuery}\n${contextHint}`
    }
  ]
});

// 解析JSON结果
const parsed = JSON.parse(result.output_text);
return parsed.intent; // "chat" | "analysis" | "draft" | "pcb"
```

**意图类型**:
- `chat`: 闲聊、解释概念、澄清问题
- `analysis`: 分析/检查当前原理图
- `draft`: 设计/生成原理图草案
- `pcb`: PCB相关操作（暂未实现）

---

### 步骤3: 生成计划 (agent/index.ts)

**函数**: `planUserTurn()`

```typescript
// 调用LLM生成计划
const plannerResult = await llmClient.generate(accessToken, {
  messages: [
    { role: "system", content: buildPlannerSystemPrompt() },
    { role: "user", content: buildPlannerUserPrompt(userQuery, intentHint) }
  ]
});

// 解析计划
const plan = normalizePlannerPlan(plannerResult.output_text);
```

**计划结构** (`AgentTurnPlan`):
```typescript
{
  intent: "analysis",
  route: "analysis",
  requiresContext: true,
  steps: [
    { kind: "context", required: true, note: "读取当前原理图上下文" },
    { kind: "mcp", required: true, note: "提取整图摘要、模块与知识证据" },
    { kind: "rules", required: true, note: "调用规则检查" },
    { kind: "llm", required: true, note: "生成分析报告" }
  ]
}
```

**步骤类型** (`kind`):
- `context`: 读取原理图上下文
- `mcp`: 检索工程知识
- `library`: 查询器件库
- `rules`: 运行规则检查
- `llm`: LLM推理
- `draft`: 生成草案

---

### 步骤4: 执行协调 (agentRunner.ts)

**函数**: `executeAgentTurn()`

这是一个协调器，负责:

1. **初始化状态**
```typescript
const stepStates = plan.steps.map(step => ({
  ...step,
  status: "pending"
}));

const workingMemory = {
  hasContext: false,
  mcpReady: false,
  libraryReady: false,
  llmReady: false,
  rulesReady: false,
  draftReady: false
};
```

2. **处理planner步骤**
```typescript
for (const [index, step] of plan.steps.entries()) {
  if (!step.required) {
    stepStates[index].status = "skipped";
    continue;
  }
  
  stepStates[index].status = "running";
  
  // 根据step.kind执行不同操作
  if (step.kind === "context") {
    workingMemory.hasContext = true;
    stepStates[index].status = "done";
  }
  // ... 其他步骤类型
}
```

3. **分发到具体agent**
```typescript
if (plan.route === "chat") {
  return deps.runNaturalChat(userQuery, panelState, adapter, context);
}
if (plan.route === "analysis") {
  return deps.runAnalysis(userQuery, context, adapter, planSteps);
}
if (plan.route === "draft") {
  return deps.runDraft(userQuery, context, adapter, planSteps);
}
```

---

### 步骤5: Agent执行 (core/xxxReactAgent.ts)

以`analysisReactAgent`为例:

**函数**: `runAnalysisReactAgent()`

#### 5.1 初始化

```typescript
const state: ReactAgentState = {
  executionTraces: [],
  uiEvents: [],
  stepStates: [],
  workingMemory: createWorkingMemory(deps.task),
  reactEvents: []  // 用于UI显示的事件流
};
```

#### 5.2 创建任务列表

```typescript
const tasks = {
  context: pushTask(state, "context", "读取当前原理图上下文"),
  mcp: pushTask(state, "mcp", "提取整图摘要、模块与知识证据"),
  rules: pushTask(state, "rules", "调用规则检查"),
  llm: pushTask(state, "llm", "生成分析报告")
};
```

#### 5.3 执行步骤

**读取上下文**:
```typescript
if (shouldRun("context")) {
  updateTask(state, tasks.context, "running");
  thought(state, "Context", "同步编辑器里的最新原理图上下文", "context");
  
  liveContext = await invokeObserved(
    deps,
    state,
    "editor.get_current_context",
    undefined,
    "获取当前原理图上下文"
  );
  
  updateTask(state, tasks.context, "done", "已读取原理图");
  markStep(state, "context", "done", "已读取原理图");
}
```

**调用MCP工具**:
```typescript
if (shouldRun("mcp")) {
  updateTask(state, tasks.mcp, "running");
  thought(state, "Overview", "提取整图观测证据", "mcp");
  
  bomSummary = await invokeObserved(
    deps,
    state,
    "schematic.summarize_bom",
    { context: liveContext },
    "提取 BOM 分类概览"
  );
  
  updateTask(state, tasks.mcp, "done", "已提取整图摘要");
}
```

**运行规则检查**:
```typescript
if (shouldRun("rules")) {
  updateTask(state, tasks.rules, "running");
  thought(state, "Rules", "执行原理图检查工具", "rules");
  
  checkResult = await invokeObserved(
    deps,
    state,
    "rules.run_schematic_checks",
    { context: liveContext },
    "执行原理图规则检查"
  );
  
  updateTask(state, tasks.rules, "done", `发现 ${checkResult.issues.length} 个问题`);
}
```

**生成报告**:
```typescript
if (shouldRun("llm")) {
  updateTask(state, tasks.llm, "running");
  thought(state, "LLM", "整理成用户可读的问题报告", "llm");
  
  const reportResult = await invokeObserved(
    deps,
    state,
    "llm.generate",
    {
      stream: true,  // 使用stream模式
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    },
    "生成分析报告"
  );
  
  updateTask(state, tasks.llm, "done", "分析报告已生成");
}
```

#### 5.4 返回结果

```typescript
return {
  reactEvents: state.reactEvents,  // UI显示的事件流
  result: {
    summary: "...",
    analysisReport: { ... },
    checkResult: { ... },
    stepStates: state.stepStates,
    workingMemory: state.workingMemory,
    executionTraces: state.executionTraces
  }
};
```

---

### 步骤6: 结果处理 (assistantRuntime.ts)

**函数**: `applyTurnResultToState()`

```typescript
// 1. 根据route构建消息
if (finalRoute === "analysis") {
  const analyzed = await buildAnalysisStateFromTurnResult(baseState, result);
  
  // 2. 检查最后一条消息是否是streaming消息
  const lastMessage = userMessages[userMessages.length - 1];
  if (lastMessage?.role === "assistant" && lastMessage.streaming) {
    // 3. 直接更新消息，保留reactEvents
    lastMessage.streaming = false;
    lastMessage.content = newMessage.content;
    lastMessage.reactEvents = newMessage.reactEvents || lastMessage.reactEvents;
    lastMessage.stepStates = newMessage.stepStates || lastMessage.stepStates;
  }
  
  analyzed.chatMessages = [...userMessages.slice(0, -1), lastMessage];
}

// 4. 提交状态更新
return analyzed;
```

**关键点**:
- 不删除streaming消息，直接更新
- 保留streaming期间累积的`reactEvents`
- 设置`streaming: false`标记完成

---

## 统一Agent模式

不再区分 chat/analysis/draft 三套 core agent 实现，统一由 `unifiedReactAgent` 执行。
前端 route 由最终结果字段推断：
- 出现草案相关字段（draftPlan/draftPreview 等）视为 draft
- 出现检查/报告字段（checkResult/analysisMarkdown 等）视为 analysis
- 否则视为 chat

---

## 数据流转

### ReactEvents (UI显示)

```typescript
type AgentReactEvent = 
  | { kind: "task", label: string, text: string, status: string }
  | { kind: "thought", label: string, text: string }
  | { kind: "tool_call", toolName: string, inputSummary: string }
  | { kind: "observation", toolName: string, outputSummary: string, status: string }
  | { kind: "final", text: string };
```

**流转路径**:
```
Agent执行 → state.reactEvents.push(event)
           ↓
       onProgress回调
           ↓
    onStreamEvent回调
           ↓
  lastMessage.reactEvents = events
           ↓
      commitState()
           ↓
       UI渲染step
```

### StepStates (任务状态)

```typescript
type AgentStepState = {
  kind: string;
  required: boolean;
  note: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  observation?: string;
};
```

**用途**:
- 跟踪每个计划步骤的执行状态
- 显示在UI的任务列表中

### WorkingMemory (工作记忆)

```typescript
type AgentWorkingMemory = {
  hasContext: boolean;
  mcpReady: boolean;
  libraryReady: boolean;
  llmReady: boolean;
  rulesReady: boolean;
  draftReady: boolean;
  lastObservation?: string;
};
```

**用途**:
- 记录agent已完成的准备工作
- 用于决策是否跳过某些步骤

---

## 关键组件

### 1. ToolRegistry (tools/toolRegistry.ts)

**作用**: 管理所有可用的工具

```typescript
class ToolRegistry {
  register(tool: AgentTool): void;
  invoke(toolName: string, input: unknown): Promise<unknown>;
  list(): AgentTool[];
}
```

**工具类型**:
- Editor工具: 读取/操作原理图
- Rule工具: 运行规则检查
- Library工具: 查询器件库
- MCP工具: 检索知识
- Server工具: 调用后端服务
- Draft工具: 生成草案

### 2. SkillLoader (skills/skillLoader.ts)

**作用**: 根据任务类型选择合适的技能配置

```typescript
class SkillLoader {
  selectForTask(taskType: string, userQuery: string): {
    name: string;
    allowedTools: string[];
  };
}
```

**技能配置**:
- 定义每种任务允许使用的工具
- 限制agent的能力范围
- 提高执行效率和安全性

### 3. invokeObserved (工具调用包装器)

**作用**: 包装工具调用，自动记录事件

```typescript
async function invokeObserved<TInput, TOutput>(
  deps: ReactAgentDeps,
  state: ReactAgentState,
  toolName: string,
  input: TInput,
  label: string
): Promise<TOutput> {
  // 1. 记录tool_call事件
  state.reactEvents.push({
    kind: "tool_call",
    toolName,
    inputSummary: summarizeInput(input)
  });
  
  // 2. 调用工具
  const output = await deps.invokeTool(toolName, input);
  
  // 3. 记录observation事件
  state.reactEvents.push({
    kind: "observation",
    toolName,
    outputSummary: summarizeOutput(output),
    status: "done"
  });
  
  return output;
}
```

---

## 执行时序图

```
用户输入
    ↓
[assistantRuntime] sendChat()
    ↓
[assistantRuntime] 创建pending消息
    ↓
[agent/index] handleUserTurn()
    ↓
[agent/index] planUserTurnLocal()（本地路由）
    ↓
[agent/index] 直接分发到具体agent
    ↓
[xxxReactAgent] 执行agent逻辑
    │
    ├─→ 读取上下文 ──→ editor.get_current_context
    │       ↓
    │   onProgress() ──→ onStreamEvent() ──→ UI更新
    │
    ├─→ 调用MCP工具 ──→ schematic.summarize_bom
    │       ↓
    │   onProgress() ──→ onStreamEvent() ──→ UI更新
    │
    ├─→ 运行规则检查 ──→ rules.run_schematic_checks
    │       ↓
    │   onProgress() ──→ onStreamEvent() ──→ UI更新
    │
    └─→ 生成报告 ──→ llm.generate (stream)
            ↓
        onDelta() ──→ onStreamEvent() ──→ UI更新
    ↓
[xxxReactAgent] 返回结果
    ↓
[agentRunner] finalizePlanResult()
    ↓
[agent/index] 返回AgentResult
    ↓
[assistantRuntime] applyTurnResultToState()
    ↓
[assistantRuntime] 更新最后一条消息
    ↓
[assistantRuntime] commitState()
    ↓
UI渲染完成
```

---

## 常见问题

### Q1: 这是真正的ReAct吗？

**答**: 是的，但是简化版本。当前实现是**两阶段ReAct**：
- ✅ 有Reasoning：LLM在Planning阶段决定使用哪些工具
- ✅ 有Acting：执行LLM选择的工具
- ✅ 有Observing：记录工具返回结果
- ❌ 没有多轮循环：只规划一次，不会根据中间结果重新规划

这是一个工程化的权衡，在保留ReAct灵活性的同时，避免了多轮循环的高成本。

### Q2: 为什么不实现完整的多轮ReAct循环？

**答**: 主要考虑：
- **性能**：多轮循环需要多次LLM调用，延迟高
- **成本**：每轮都要消耗大量token
- **可控性**：多轮循环可能"跑飞"，难以调试
- **场景适配**：当前的信息检索和分析任务，两阶段已经足够

如果未来需要处理更复杂的推理任务，可以考虑实现完整的多轮ReAct。

### Q3: 为什么step会消失？

**原因**: 完成时删除了streaming消息并重新创建，导致`reactEvents`丢失。

**解决**: 修改`applyTurnResultToState`，直接更新消息而不是删除重建。

### Q2: 为什么有些工具调用看不到？

**原因**: 只有通过`invokeObserved`调用的工具才会记录到`reactEvents`。

**解决**: 确保所有工具调用都使用`invokeObserved`包装器。

### Q3: 如何添加新的工具？

1. 在`tools/`目录创建工具文件
2. 实现`AgentTool`接口
3. 在`createAgentToolRegistry`中注册
4. 在skill配置中添加到`allowedTools`

### Q4: 如何修改agent的执行逻辑？

修改对应的agent文件:
- Chat: `core/chatReactAgent.ts`
- Analysis: `core/analysisReactAgent.ts`
- Draft: `core/draftReactAgent.ts`

---

## 相关文档

- [Agent设计文档](./design-docs/Agent设计文档.md)
- [架构总纲](../ARCHITECTURE.md)
- [Codex Agent架构参考](./references/CODEX_AGENT_ARCHITECTURE.md)
