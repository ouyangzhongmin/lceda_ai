## Prompts

本目录用于集中管理 agent 的提示词构建逻辑，方便统一维护与理解。

### systemPrompt.ts

`buildSystemPrompt(...)` 负责组装统一系统提示词：
- 基础规则与输出协议（ReAct action/final JSON）
- skills 说明（能力边界与建议调用路径）
- 可用工具描述（含 riskLevel / requiresConfirmation 元信息）
- 可选的上下文提示（统计信息等）

执行器在每轮 while-loop 中调用 `llm_generate`，并要求模型严格输出：
- `{"type":"action","tool":"...","input":{...},"rationale":"..."}`
- `{"type":"final","rationale":"...","output":"..."}`（最终展示内容）

