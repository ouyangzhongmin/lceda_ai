# Agent 执行流程详解（正确版本）

本文档基于实际代码分析，准确描述 LCEDA AI Assistant 插件中 Agent 的执行流程。

## 重要发现：真正的 ReAct 实现

经过代码分析确认，系统**确实实现了真正的 ReAct (Reasoning + Acting) 循环模式**：

- **当前生产实现**：`unifiedReactAgent.ts` + `reactLoopAgent.ts`
- **旧实现（已废弃）**：`chatReactAgent.ts`, `analysisReactAgent.ts`, `draftReactAgent.ts` (这些文件已不存在)
- **核心特征**：多轮迭代循环（最多 50 轮），LLM 在每轮动态决策下一步行动

## 1. 整体架构

```
用户输入
  ↓
assistantRuntime.ts (协调层)
  ↓
agent/index.ts (入口 - createPluginAgent)
  ↓
unifiedReactAgent.ts (统一 Agent 实现)
  ↓
reactLoopAgent.ts (ReAct 循环引擎)
  ↓
ToolRegistry + Tools (工具层)
  ↓
LLM + Editor + Server (基础设施层)
```

## 2. 执行流程概览

Agent 执行采用**真正的 ReAct 循环模式**，分为以下阶段：

1. **初始化阶段**：创建 ToolRegistry，注册所有可用工具
2. **ReAct 循环阶段**（核心）：
   - **Reasoning（思考）**：LLM 分析当前状态，决定下一步行动
   - **Acting（行动）**：执行 LLM 选择的工具
   - **Observation（观察）**：获取工具执行结果，反馈给 LLM
   - 重复上述过程，直到 LLM 决定任务完成或达到最大迭代次数（50次）
3. **结果生成阶段**：LLM 基于所有观察结果生成最终报告
4. **结果返回阶段**：将结果转换为 UI 可展示的格式

## 3. 详细执行步骤

### 3.1 入口：agent/index.ts

所有 Agent 执行都从 `createPluginAgent()` 返回的 `run()` 方法开始：

```typescript
// plugin/src/agent/index.ts
export function createPluginAgent(deps: PluginAgentDeps): PluginAgent {
  return {
    run: async (input) => {
      // 1. 创建工具注册表
      const toolRegistry = createAgentToolRegistry(adapter, deps, {
        includeIssueTools: true,
        includeLibraryTools: true
      });
      
      // 2. 添加 MCP 工具
      for (const tool of createMcpTools(deps.mcpClient)) {
        toolRegistry.register(tool);
      }
      
      // 3. 过滤允许的工具（排除需要确认的工具）
      const allowedTools = toolRegistry
        .list()
        .filter((tool) => !tool.requiresConfirmation)
        .map((tool) => tool.name);
      
      // 4. 统一使用 unifiedReactAgent（所有任务类型）
      const { result } = await runUnifiedReactAgent({
        userQuery: input.userQuery,
        panelState: input.panelState ?? ({} as MainPanelState),
        adapter: input.adapter,
        context: input.context,
        tools: toolRegistry,
        allowedTools,
        onStreamEvent: input.onStreamEvent,
      });
      
      return result;
    }
  };
}
```

**关键点**：
- 不再根据任务类型选择不同的 Agent
- 统一使用 `runUnifiedReactAgent`，由它内部的 ReAct 循环动态决策
- 所有任务类型（chat/analysis/draft）都走同一个执行流程

### 3.2 Unified React Agent (unifiedReactAgent.ts)

系统使用**单一的统一 Agent 实现**，通过 ReAct 循环动态适应不同任务类型。

**核心代码**：

```typescript
// plugin/src/agent/core/unifiedReactAgent.ts
export async function runUnifiedReactAgent(input: {
  userQuery: string;
  panelState: MainPanelState;
  adapter?: EditorAdapter;
  context?: SchematicContext;
  tools: ToolRegistry;
  allowedTools: string[];
  onStreamEvent?: (event: StreamEvent) => void;
}): Promise<{ result: AgentResult }> {
  
  // 1. 构建系统提示词（包含任务上下文、可用工具等）
  const systemPrompt = buildSystemPrompt(input);
  
  // 2. 调用 ReAct 循环引擎
  const { result } = await runReactLoop({
    userQuery: input.userQuery,
    systemPrompt,
    tools: input.tools,
    allowedTools: input.allowedTools,
    maxIterations: 50,  // 最多 50 轮迭代
    onStreamEvent: input.onStreamEvent,
  });
  
  return { result };
}
```

**关键特征**：
- 不预先规划工具调用顺序
- LLM 在每轮迭代中动态决策
- 支持最多 50 轮 Reasoning-Acting 循环
- 根据观察结果自适应调整策略

### 3.3 ReAct 循环引擎（reactLoopAgent.ts）

这是系统的核心，实现了真正的 ReAct 模式：

```typescript
// plugin/src/agent/core/reactLoopAgent.ts
export async function runReactLoop(input: {
  userQuery: string;
  systemPrompt: string;
  tools: ToolRegistry;
  allowedTools: string[];
  maxIterations: number;
  onStreamEvent?: (event: StreamEvent) => void;
}): Promise<{ result: AgentResult }> {
  
  const messages: Message[] = [
    { role: "system", content: input.systemPrompt },
    { role: "user", content: input.userQuery }
  ];
  
  const reactEvents: ReactEvent[] = [];
  let iteration = 0;
  
  // ReAct 循环
  while (iteration < input.maxIterations) {
    iteration++;
    
    // 1. LLM 思考并决策（Reasoning）
    const response = await llmClient.generate({
      messages,
      tools: buildToolSchemas(input.tools, input.allowedTools),
      tool_choice: "auto",  // LLM 自主决定是否调用工具
    });
    
    // 2. 检查是否完成
    if (!response.tool_calls || response.tool_calls.length === 0) {
      // LLM 认为任务已完成，返回最终答案
      return {
        result: {
          naturalReply: response.content,
          reactEvents,
          summary: "completed"
        }
      };
    }
    
    // 3. 执行工具调用（Acting）
    for (const toolCall of response.tool_calls) {
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments);
      
      // 记录工具调用事件
      reactEvents.push({
        kind: "tool_call",
        toolName,
        inputSummary: JSON.stringify(toolArgs),
        timestamp: Date.now()
      });
      
      // 执行工具
      const toolResult = await input.tools.invoke(toolName, toolArgs);
      
      // 4. 观察结果（Observation）
      reactEvents.push({
        kind: "observation",
        toolName,
        outputSummary: JSON.stringify(toolResult),
        status: "success",
        timestamp: Date.now()
      });
      
      // 5. 将观察结果添加到对话历史
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [toolCall]
      });
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(toolResult)
      });
    }
    
    // 6. 流式更新 UI
    input.onStreamEvent?.({
      stage: "progress",
      reactEvents,
      detail: `第 ${iteration} 轮迭代完成`
    });
  }
  
  // 达到最大迭代次数
  return {
    result: {
      summary: "max_iterations_reached",
      reactEvents
    }
  };
}
```

**ReAct 循环的关键特征**：

1. **动态决策**：LLM 在每轮迭代中根据当前状态决定下一步行动
2. **工具调用**：支持原生 `tool_calls` 格式（OpenAI 标准）
3. **观察反馈**：工具执行结果作为 `tool` 角色消息返回给 LLM
4. **自主终止**：LLM 决定何时任务完成（不调用工具即表示完成）
5. **迭代上限**：最多 50 轮，防止无限循环

### 3.4 工具调用示例

在 ReAct 循环中，LLM 可能会调用以下工具序列（动态决定）：

**示例 1：原理图分析任务**

```
第 1 轮：
  LLM 思考 → 决定先读取原理图上下文
  工具调用 → editor_get_current_context()
  观察结果 → 获得器件数、网络数等信息

第 2 轮：
  LLM 思考 → 基于上下文，决定识别功能模块
  工具调用 → schematic_identify_functional_blocks()
  观察结果 → 识别出电源模块、MCU模块等

第 3 轮：
  LLM 思考 → 需要检查规则问题
  工具调用 → rules_run_schematic_checks()
  观察结果 → 发现 15 个问题

第 4 轮：
  LLM 思考 → 需要定位第一个问题
  工具调用 → issues_locate_first()
  观察结果 → 定位到具体器件

第 5 轮：
  LLM 思考 → 信息已足够，生成报告
  不调用工具 → 返回最终分析报告
```

**示例 2：自然对话任务**

```
第 1 轮：
  LLM 思考 → 用户问"这个电路的电源设计有什么问题"
  工具调用 → editor_get_current_context()
  观察结果 → 获得原理图信息

第 2 轮：
  LLM 思考 → 需要追踪电源路径
  工具调用 → schematic_trace_power_paths()
  观察结果 → 发现电源路径信息

第 3 轮：
  LLM 思考 → 信息足够回答用户问题
  不调用工具 → 返回自然语言回复
```

### 3.5 最终报告生成

在 ReAct 循环中，当 LLM 决定不再调用工具时，它会直接返回最终答案：

```typescript
// LLM 的最后一轮响应（不包含 tool_calls）
const finalResponse = await llmClient.generate({
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userQuery },
    ...toolCallHistory,  // 所有之前的工具调用和观察结果
  ],
  stream: true  // 支持流式输出
});

// 流式返回最终报告
for await (const chunk of finalResponse) {
  onStreamEvent?.({
    stage: "llm",
    textDelta: chunk.delta,
    reactEvents  // 包含完整的执行历史
  });
}
```

**关键点**：
- LLM 自主决定何时生成最终报告
- 报告基于所有之前的观察结果
- 支持流式输出，实时显示生成进度

## 4. 数据流

### 4.1 ReactEvents（执行历史）

记录 ReAct 循环中的所有事件：

```typescript
type ReactEvent = {
  kind: "task" | "thought" | "tool_call" | "observation" | "final";
  toolName?: string;
  label?: string;
  text?: string;
  inputSummary?: string;   // 工具调用参数
  outputSummary?: string;  // 工具执行结果
  status?: "success" | "failed";
  timestamp: number;
};
```

**在 ReAct 模式中的作用**：
- `tool_call`：记录 LLM 决定调用的工具
- `observation`：记录工具执行后的观察结果
- 完整的 `reactEvents` 数组构成了 Agent 的"思考-行动-观察"历史

### 4.2 StepStates（UI 展示状态）

用于 UI 展示执行进度：

```typescript
type StepState = {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  detail?: string;
};
```

**注意**：`stepStates` 是从 `reactEvents` 派生的 UI 展示数据，不是执行逻辑的一部分。

### 4.3 WorkingMemory（中间结果缓存）

存储工具执行的中间结果，避免重复调用：

```typescript
type WorkingMemory = {
  contextSummary?: string;
  bomSummary?: string;
  functionalBlocks?: string[];
  powerDomains?: string[];
  issues?: Issue[];
  // ...
};
```

**在 ReAct 模式中的作用**：
- 缓存已获取的信息
- LLM 可以在后续迭代中引用这些信息
- 减少重复的工具调用

## 5. 关键组件

### 5.1 ToolRegistry（工具注册表）

管理所有可用工具，提供给 LLM 调用：

```typescript
class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }
  
  async invoke(name: string, args: any): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    
    // 执行工具并返回结果
    return await tool.execute(args);
  }
  
  list(): Tool[] {
    return Array.from(this.tools.values());
  }
  
  // 生成工具的 JSON Schema（供 LLM 理解）
  getToolSchemas(): ToolSchema[] {
    return this.list().map(tool => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }
}
```

**在 ReAct 模式中的作用**：
- 提供工具的 JSON Schema 给 LLM
- LLM 根据 Schema 决定调用哪个工具
- 执行 LLM 选择的工具并返回结果

### 5.2 可用工具类型

系统提供以下工具类别：

- **Editor 工具**：读取/操作原理图（`editor_get_current_context`, `editor_locate` 等）
- **Schematic Summary 工具**：分析原理图（`schematic_identify_functional_blocks`, `schematic_trace_power_paths` 等）
- **Rule 工具**：运行规则检查（`rules_run_schematic_checks`, `rules_validate_draft` 等）
- **Library 工具**：查询器件库（`library_search_devices`, `library_get_device` 等）
- **Issue 工具**：问题定位（`issues_locate_first` 等）
- **Draft 工具**：生成草案
- **Server 工具**：调用后端服务（`rag_search`, `llm_generate` 等）
- **MCP 工具**：Model Context Protocol 工具（动态注册）

## 6. ReAct 循环序列图

```
用户 → assistantRuntime → agent/index → unifiedReactAgent → reactLoopAgent
                                                                  ↓
                                                            [ReAct 循环开始]
                                                                  ↓
                                                            LLM 思考（第1轮）
                                                            "我需要先读取原理图"
                                                                  ↓
                                                            调用 Tool: editor_get_current_context
                                                                  ↓
                                                            观察结果：{componentCount: 25, ...}
                                                                  ↓
                                                            LLM 思考（第2轮）
                                                            "现在我需要识别功能模块"
                                                                  ↓
                                                            调用 Tool: schematic_identify_functional_blocks
                                                                  ↓
                                                            观察结果：["电源模块", "MCU模块", ...]
                                                                  ↓
                                                            LLM 思考（第3轮）
                                                            "需要检查规则问题"
                                                                  ↓
                                                            调用 Tool: rules_run_schematic_checks
                                                                  ↓
                                                            观察结果：{issueCount: 15, ...}
                                                                  ↓
                                                            LLM 思考（第N轮）
                                                            "信息已足够，生成报告"
                                                                  ↓
                                                            不调用工具，返回最终答案
                                                                  ↓
                                                            [ReAct 循环结束]
                                                                  ↓
                                                            返回结果（包含完整 reactEvents）
```

## 7. 任务类型推断

系统不再预先分类任务类型，而是根据最终结果推断：

```typescript
// plugin/src/agent/index.ts - handleUserTurn()
const { result } = await runUnifiedReactAgent({...});

// 根据结果字段推断任务类型
const route = result.draftPlan || result.draftPreview || result.draftValidation || result.draftRisk
  ? "draft"
  : result.analysisReport || result.checkResult || result.analysisMarkdown
    ? "analysis"
    : "chat";
```

**推断规则**：
- 如果结果包含草案相关字段 → `draft`
- 如果结果包含分析/检查相关字段 → `analysis`
- 否则 → `chat`

## 8. 常见问题

### Q1: 这是真正的 ReAct 吗？

**答**：是的，这是真正的 ReAct 实现。系统具备：
- ✅ **Reasoning（推理）**：LLM 在每轮迭代中分析当前状态
- ✅ **Acting（行动）**：执行 LLM 选择的工具
- ✅ **Observation（观察）**：获取工具结果并反馈给 LLM
- ✅ **多轮循环**：支持最多 50 轮迭代
- ✅ **动态决策**：LLM 根据观察结果调整策略
- ✅ **自主终止**：LLM 决定何时完成任务

### Q2: 为什么之前的文档说是"两阶段 ReAct"？

**答**：之前的分析基于错误的假设。实际代码中：
- `chatReactAgent.ts`, `analysisReactAgent.ts`, `draftReactAgent.ts` 这些文件已不存在
- 当前只有 `unifiedReactAgent.ts` + `reactLoopAgent.ts`
- 实现了完整的 while 循环，不是两阶段模式

### Q3: 为什么 step 会消失？

**原因**：完成时删除了 streaming 消息并重新创建，导致 `reactEvents` 丢失。

**解决方案**：修改 `assistantRuntime.ts` 中的 `applyTurnResultToState()` 函数，直接更新消息而不是删除重建：

```typescript
// 不要这样做：
chatMessages.pop();  // 删除 streaming 消息
chatMessages.push(newMessage);  // 创建新消息

// 应该这样做：
const lastMessage = chatMessages[chatMessages.length - 1];
if (lastMessage?.streaming) {
  lastMessage.streaming = false;
  lastMessage.content = newMessage.content;
  lastMessage.reactEvents = newMessage.reactEvents || lastMessage.reactEvents;  // 保留
  lastMessage.stepStates = newMessage.stepStates || lastMessage.stepStates;    // 保留
}
```

### Q4: 如何添加新的工具？

1. 在 `plugin/src/agent/tools/` 目录创建工具文件
2. 实现 `AgentTool` 接口
3. 在相应的 `create*Tools()` 函数中注册
4. 工具会自动对 LLM 可见，LLM 会根据需要调用

### Q5: 如何控制 Agent 的行为？

通过以下方式：
- **系统提示词**：在 `unifiedReactAgent.ts` 中修改 `buildSystemPrompt()`
- **工具白名单**：在 `agent/index.ts` 中过滤 `allowedTools`
- **最大迭代次数**：修改 `maxIterations` 参数（默认 50）
- **工具描述**：修改工具的 `description` 和 `parameters`，影响 LLM 的选择

## 9. 相关文档

- [Agent设计文档](./design-docs/Agent设计文档.md)
- [架构总纲](../ARCHITECTURE.md)
- [UI 问题修复](./UI_FIXES.md)
