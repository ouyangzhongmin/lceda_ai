# Agent 模块

- `orchestrator/`：Agent 执行入口与 ReAct 编排器
- `skills/`：Skill 定义
- `tools/`：工具注册与实现
- `mcp/`：MCP 适配
- `prompts/`：提示词模板

## 当前实现状态
- 已实现：
  - `ReactExecutor` 作为统一 agent 执行入口
  - `index.ts` 作为统一 facade 入口
  - Prompt 模块化：`chat` / `draft` / `analysis`
  - Skill 选择与工具白名单约束
  - Tool trace / execution trace 基础记录
  - MCP 已作为统一 tool provider 接入 facade/tool runtime
- 待补齐：
  - Skill 动态装载（配置化）
  - MCP 远程 server 连接

## 当前入口
- agent facade 入口：
  - `src/agent/index.ts`
  - 负责对外暴露 `classify/run/build message` 等统一封装
  - `run(...)` 是标准执行入口
- UI/runtime 入口：
  - `src/app/assistantRuntime.ts`
- agent 核心执行入口：
  - `src/agent/orchestrator/reactExecutor.ts`
- 意图分类：
  - `src/agent/intent/intentClassifier.ts`
- skill 定义与选择：
  - `src/agent/skills/skillLoader.ts`
  - `src/agent/skills/skillTypes.ts`
- prompt 定义：
  - `src/agent/prompts/*.ts`
- tool 定义：
  - `src/agent/tools/*.ts`
- MCP 适配：
  - `src/agent/mcp/mcpClient.ts`
