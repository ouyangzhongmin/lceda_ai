# Agent 模块

- `core/`：统一 while-loop ReAct 执行器
- `tools/`：工具注册与实现
- `mcp/`：MCP 适配
- `prompts/`：提示词模板

## 当前实现状态
- 已实现：
  - 统一 ReAct while-loop：`llm 决策 -> tool -> observation -> … -> final`
  - 单一系统提示词构建：`buildSystemPrompt()`
  - 工具能力：editor/mcp/rag/rules/library/draft/todo 等
  - Tool trace / react events / step states 基础记录
- 约束：
  - 高风险工具必须标记 `requiresConfirmation=true`，默认不下放给 LLM

## 当前入口
- agent facade 入口：
  - `src/agent/index.ts`
  - `run(...)` 是标准执行入口
- UI/runtime 入口：
  - `src/app/assistantRuntime.ts`
- prompt 定义：
  - `src/agent/prompts/*.ts`
- tool 定义：
  - `src/agent/tools/*.ts`
- MCP 适配：
  - `src/agent/mcp/mcpClient.ts`
