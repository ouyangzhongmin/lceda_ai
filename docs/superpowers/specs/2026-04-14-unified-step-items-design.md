# 统一 Step Items 过程展示改造设计

## 背景

当前助手消息的过程展示由 `reactEvents`、`stepStates`、`stepTranscript` 和独立的“思考摘要”区域共同组成，存在以下问题：

- 过程信息被拆散到多个视觉区域，用户需要在 step 列表、思考摘要、最终报告之间来回切换。
- `thought` 在数据上本质属于过程事件，但 UI 上被提升为单独卡片，层级不一致。
- 流式输出时，过程日志、思考文本和最终报告的边界不清晰，容易出现重复和错位。
- 控制协议文本如 `{"type":"final"...` 曾泄漏到可见区域，破坏阅读体验。

本次改造目标是一步到位，将过程展示收敛为统一时间流 `stepItems`，并将最终结果固定为单独正式报告区。

## 目标

- 引入统一过程协议 `stepItems`，作为助手消息唯一的过程展示数据源。
- 将思考摘要并入过程时间流，作为普通的 `thought` 类型 item，不再单独渲染卡片。
- 保持所有过程 item 支持流式更新，更新方式为原位刷新，不制造重复项。
- 将最终分析报告、聊天回复或草案报告放入单独正式报告区，不作为过程 item 展示。
- 阻断所有控制协议文本进入时间流和正式报告区。
- 保持历史会话可读，通过兼容转换让旧消息继续展示。

## 非目标

- 本次不重做聊天消息整体模型，仍保留单条助手消息承载“过程 + 结果”。
- 本次不要求立刻删除所有旧字段，只要求它们退出主渲染路径。
- 本次不调整 agent 路由判定逻辑，`chat / analysis / draft` 仍沿用现有语义。

## 方案总览

助手消息调整为两段结构：

1. 过程时间流
   基于 `stepItems` 严格按事件发生顺序渲染，包含 `task`、`thought`、`tool_call`、`observation`、`status` 等过程 item。
2. 正式报告区
   在过程完成后渲染，展示 `analysisMarkdown`、`reportMarkdown`、`naturalReply`、`draftNarrative` 等最终结果。

关键规则如下：

- `thought` 是普通过程 item，与工具调用和观察结果同级。
- `final` 不进入时间流，只驱动流程结束和最终结果落区。
- 如果过程尚未结束，则只显示时间流。
- 一旦 final 到达，停止过程流更新，展示正式报告区。

## 数据模型设计

在助手消息上新增 `stepItems` 字段，作为统一过程展示协议。

```ts
interface AssistantStepItem {
  id: string;
  phase: "context" | "mcp" | "rules" | "library" | "llm" | "draft" | "system";
  type: "task" | "thought" | "tool_call" | "observation" | "status";
  status: "pending" | "running" | "done" | "failed" | "skipped";
  title: string;
  text: string;
  toolName?: string;
  inputSummary?: string;
  outputSummary?: string;
  startedAt?: string;
  updatedAt?: string;
  streaming?: boolean;
}
```

字段约束：

- `id` 用于流式更新时原位合并，必须稳定。
- `phase` 表示所属过程阶段，用于 UI 图标、颜色和筛选。
- `type` 表示过程 item 类型，是主渲染分支依据。
- `status` 表示当前状态，决定 UI 状态标识。
- `title` 为简短标题，如“思考”“读取上下文”“Action”“观察”。
- `text` 为用户可读正文，允许流式增量更新。
- `streaming` 为可选标记，用于 UI 渲染打字态或进行中态。

## 过程事件映射规则

现有 `reactEvents` 到 `stepItems` 的映射规则如下：

- `task` -> `type: "task"`
- `thought` -> `type: "thought"`
- `tool_call` -> `type: "tool_call"`
- `observation` -> `type: "observation"`
- `final` -> 不映射到时间流；只用于终止过程并触发正式报告区

映射保留以下信息：

- `stepKind` 映射到 `phase`
- `label` 映射到 `title`
- `text` 原样保留，但要先经过控制文本清洗
- `toolName`、`inputSummary`、`outputSummary` 继续保留
- `status` 原样保留

新增约束：

- 不允许将 `final` 伪装成 `status` item 保留在时间流中。
- 不允许由宿主再额外注入“思考摘要”型合成事件。
- LLM streaming 的 `reasoning_delta` 只能更新已有 `thought` item，不得单独生成其他摘要区。

## Agent 层改造

Agent 层需要从“先产出 `reactEvents`，再由上层解释”为主，调整为“以 `stepItems` 为一等输出”。

改造要求：

- ReAct 循环中所有过程节点直接产出 `stepItems`。
- `thought` item 在 reasoning delta 到来时原位更新 `text` 和 `streaming` 状态。
- `tool_call` 与 `observation` 使用稳定 `id`，确保一次调用对应一条过程记录。
- 当模型输出 `final` 控制对象时，只更新最终结果载荷，不向 `stepItems` 追加 final item。

兼容期策略：

- AgentResult 同时可保留 `reactEvents`，但其来源应当是从 `stepItems` 回写，避免双份来源并行演化。
- 新逻辑完成后，UI 和 runtime 只消费 `stepItems`。

## Runtime 层改造

Runtime 负责三件事：流式合并、持久化、历史兼容。

### 流式合并

- 将消息过程主字段切换为 `stepItems`。
- 处理 streaming 时，根据 `id` 对 item 做原位更新。
- 对于旧链路仍传入的 `reactEvents`，先转换为 `stepItems` 再进入消息状态。
- `reasoning_delta` 只能更新某个 `thought` item 的 `text`，不得再写入独立临时卡片。

### 持久化

- 会话持久化优先写入 `stepItems`。
- `stepTranscript` 不再作为主持久化产物；如果保留，仅作为兼容冗余字段。
- `reactEvents` 与 `stepStates` 可暂时保留，但不作为恢复后主展示源。

### 历史兼容

- 读取历史消息时，如果存在 `stepItems`，直接使用。
- 如果不存在 `stepItems` 但存在 `reactEvents`，运行一次映射逻辑生成 `stepItems`。
- 历史消息中的 `final` 事件不进入过程时间流。

## UI 渲染设计

iframe 中的助手消息卡片统一采用两段式结构。

### 过程时间流

- 仅消费 `stepItems`
- 按数组顺序渲染，不按 phase 分组
- `thought`、`tool_call`、`observation`、`status` 均是同级时间流节点
- 流式更新时在原位置刷新文本与状态
- 不再渲染“思考摘要”独立卡片
- 不再渲染 `stepTranscript` 文本拼接块

### 正式报告区

- 过程完成后出现在时间流下方
- 内容优先级按 route 决定：
  - `analysis`: `analysisMarkdown`
  - `draft`: `reportMarkdown` 或 `draftNarrative`
  - `chat`: `content` 或 `naturalReply`
- 如果正式报告为空，则只展示时间流，不补空壳区域

### 视觉约束

- 过程时间流应明显弱于正式报告区，避免日志喧宾夺主
- `thought` item 与 `tool_call` item 视觉权重一致，不单独放大
- `running` 态允许显示轻量流式提示，但不新增第二内容容器

## 控制文本泄漏治理

当前已存在 `stripFinalControlLikeText` 一类清洗逻辑，但需要从补丁式修复升级为链路约束。

治理规则：

- 控制协议文本仅允许存在于模型输出解析阶段，不允许进入最终消息内容。
- 过程 item 的 `text` 在进入 state 前必须经过控制文本清洗。
- 正式报告区内容在落盘前再次清洗，确保不会展示 `Final:`、```json`、`{"type":"final"` 等残片。
- 对未完整闭合的 JSON 片段同样按控制文本处理。

## 测试设计

至少补齐以下测试：

- `reactEvents -> stepItems` 映射正确，且 `final` 不进入时间流
- `reasoning_delta` 能原位更新 `thought` item
- 工具调用与观察结果按顺序追加到时间流
- final 到达后出现正式报告区
- 历史消息只有 `reactEvents` 时也能正确展示
- 控制文本不会出现在时间流 item 和正式报告区中

## 风险与缓解

风险一：当前实现链路同时依赖 `reactEvents`、`stepStates`、`stepTranscript`

缓解：

- 先引入 `stepItems` 并让 UI 主路径切换
- 旧字段保留一个兼容周期
- 用测试覆盖 runtime 合并和恢复链路

风险二：流式更新容易产生重复 item 或顺序错乱

缓解：

- 所有 streaming item 强制使用稳定 `id`
- runtime 统一负责基于 `id` 合并
- UI 只渲染最终状态数组，不自行猜测去重

风险三：历史会话恢复后表现不一致

缓解：

- 历史消息加载时执行统一转换
- 将转换逻辑集中在 runtime，而不是分散到多个渲染分支

## 实施边界

本设计覆盖以下文件族群的后续实现：

- `plugin/src/agent/core/*`
- `plugin/src/agent/shared/agentTypes.ts`
- `plugin/src/app/assistantRuntime.ts`
- `plugin/src/ui/panels/mainPanel.ts`
- `plugin/iframe/iframe-app.js`
- 相关测试文件

本设计不要求修改服务端 API，也不要求改变宿主侧业务接口。

## 结论

本次改造采用“新增统一协议，UI 全量切换”的方式：

- 新增 `stepItems` 作为唯一过程展示数据源
- 思考内容并入时间流
- 最终结果进入单独正式报告区
- 旧字段保留兼容，不再主导 UI

这能以可控范围完成一次性收敛，直接解决当前 UI 中过程割裂、思考摘要单独卡片、以及控制文本泄漏的问题。
