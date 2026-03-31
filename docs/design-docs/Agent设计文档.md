# 嘉立创 EDA AI 助手 Agent 设计文档

## 1. 文档信息
- 文档版本：v0.1
- 创建日期：2026-03-24
- 关联文档：`需求文档.md`
- 关联文档：`ARCHITECTURE.md`
- 关联文档：`服务端API接口设计文档.md`
- 关联文档：`数据库设计文档.md`

## 2. 设计目标
Agent 设计目标如下：
- 在插件内实现可解释、可扩展、可控的智能体执行框架。
- 遵循 `ReAct` 模式组织推理、工具调用和结果观察。
- 通过 `Tool Calling` 实现编辑器、规则、RAG、LLM 和落图能力编排。
- 通过 `MCP` 接入外部资源和工具。
- 通过 `Skill` 封装领域能力，支持原理图分析、绘图草案生成和规范检查。

## 3. Agent 总体定位

### 3.1 职责边界
Agent 位于插件端，不是独立常驻进程。

Agent 负责：
- 理解用户任务
- 构建上下文
- 选择技能
- 规划工具调用顺序
- 汇总工具观察结果
- 形成最终可解释输出

Agent 不负责：
- 长期持久化用户数据
- 独立运行后台服务
- 替代规则引擎进行关键工程安全判断

### 3.2 运行模式
- 插件内同步/异步任务编排器
- 首版以单任务串行执行为主
- 后续可演进为可取消、可重试、可并行的任务调度器

## 4. ReAct 执行模型

### 4.1 基本循环
标准循环：
1. `Reason`
2. `Act`
3. `Observe`
4. `Reason`
5. `Finish`

### 4.2 在本项目中的映射
- `Reason`
  - 判断当前任务是分析、问答、绘图、解释还是定位
  - 判断应选择哪些技能
  - 判断需要哪些工具
- `Act`
  - 调用工具
  - 请求 RAG
  - 请求 LLM
  - 读取编辑器上下文
- `Observe`
  - 接收规则命中
  - 接收知识引用
  - 接收绘图草案
  - 接收错误或失败原因
- `Finish`
  - 输出问题列表、解释结果、草案或落图计划

### 4.3 执行约束
- 每轮必须记录：
  - 当前目标
  - 调用工具
  - 工具输入摘要
  - 工具输出摘要
- 高风险结论至少依赖以下其一：
  - 规则命中
  - RAG 引用
  - 编辑器实际观测数据
- 禁止跳过观察阶段直接生成关键工程判断

## 5. Agent 状态机

### 5.1 状态定义
- `idle`
- `planning`
- `running_tools`
- `waiting_llm`
- `assembling_result`
- `awaiting_user_confirmation`
- `completed`
- `failed`
- `cancelled`

### 5.2 状态转换
- `idle -> planning`
  - 用户发起任务
- `planning -> running_tools`
  - 生成初始执行计划
- `running_tools -> waiting_llm`
  - 工具结果需要交给 LLM 综合推理
- `waiting_llm -> running_tools`
  - LLM 决定继续调用工具
- `waiting_llm -> assembling_result`
  - 已满足输出条件
- `assembling_result -> awaiting_user_confirmation`
  - 需要用户确认草案或高风险操作
- `awaiting_user_confirmation -> running_tools`
  - 用户要求修改草案
- `awaiting_user_confirmation -> completed`
  - 用户确认执行
- `* -> failed`
  - 不可恢复错误
- `* -> cancelled`
  - 用户主动取消

## 6. 核心组件设计

### 6.1 agent-orchestrator
职责：
- 接收任务请求
- 选择技能
- 驱动 ReAct 循环
- 协调工具注册中心、MCP 客户端、LLM 管理器和规则引擎

建议接口：

```ts
interface AgentOrchestrator {
  run(task: AgentTask): Promise<AgentResult>;
  cancel(taskId: string): Promise<void>;
}
```

### 6.2 tool-registry
职责：
- 注册工具定义
- 校验工具输入输出
- 提供统一调用入口

建议接口：

```ts
interface ToolRegistry {
  register(tool: AgentTool): void;
  get(name: string): AgentTool | undefined;
  list(): AgentTool[];
  invoke(name: string, input: unknown): Promise<unknown>;
}
```

### 6.3 skill-loader
职责：
- 加载技能元数据
- 根据任务场景选择技能
- 将技能提示、规则和工具约束注入上下文

### 6.4 mcp-client
职责：
- 连接 MCP Server
- 枚举资源和工具
- 调用远程 MCP 工具
- 将 MCP 能力转换为本地 Tool Calling 规范

## 7. Tool Calling 设计

### 7.1 工具分类
- 编辑器工具
- 规则工具
- RAG 工具
- LLM 工具
- 绘图工具
- 登录与账户工具
- MCP 工具

### 7.2 首版工具清单
- `editor.get_current_document`
- `editor.get_selection`
- `editor.locate_object`
- `editor.preview_apply_plan`
- `editor.apply_plan`
- `rules.run_schematic_checks`
- `rules.validate_draft`
- `rag.search`
- `rag.build_citations`
- `llm.generate`
- `account.get_session`
- `credits.get_balance`

### 7.3 Tool Schema 建议

```ts
interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high";
  requiresConfirmation?: boolean;
  execute(input: unknown): Promise<unknown>;
}
```

### 7.4 高风险工具约束
- `editor.apply_plan`
  - 必须要求用户确认
- `rules.validate_draft`
  - 若命中高风险错误，阻断落图
- 任何会修改原理图的工具：
  - 必须产生预览结果
  - 必须可取消

## 8. Skill 设计

### 8.1 Skill 定位
Skill 是领域任务模板，不直接替代工具。

Skill 负责：
- 提供任务目标
- 限制可用工具范围
- 注入领域提示词
- 配置输出结构

### 8.2 首版 Skill 清单
- `schematic-analysis-skill`
- `component-explain-skill`
- `wiring-standards-check-skill`
- `power-module-draft-skill`
- `generic-schematic-draft-skill`

### 8.3 Skill 元数据建议

```json
{
  "name": "schematic-analysis-skill",
  "version": "0.1.0",
  "description": "Analyze schematic issues with evidence",
  "allowedTools": [
    "editor.get_current_document",
    "rules.run_schematic_checks",
    "rag.search",
    "llm.generate"
  ],
  "outputMode": "analysis_result"
}
```

### 8.4 Skill 生命周期
- 发现
- 加载
- 选择
- 执行
- 卸载

## 9. MCP 接入设计

### 9.1 MCP 作用
- 统一接入外部知识资源
- 统一接入结构化数据源
- 统一接入外部工具服务

### 9.2 首版使用边界
- 首版优先用于：
  - 知识资源访问
  - 扩展工具接入
- 不要求首版依赖第三方复杂 MCP 生态才能运行

### 9.3 MCP 能力映射
- MCP `resource`
  - 转换为 Agent 可读取上下文资源
- MCP `tool`
  - 转换为 Tool Registry 中的可调用工具

### 9.4 安全约束
- 所有 MCP 工具都必须声明：
  - 名称
  - 输入 schema
  - 输出 schema
  - 风险级别
- 高风险 MCP 工具默认禁止直接修改原理图

## 10. 上下文构建设计

### 10.1 输入上下文来源
- 用户输入
- 当前页面原理图结构
- 当前选中器件/网络
- 本地规则结果
- RAG 检索结果
- 当前登录与 Credits 状态

### 10.2 上下文裁剪原则
- 只带当前任务需要的结构化信息
- 优先传摘要，不传整图冗余对象
- 对大型工程使用局部上下文 + 引用定位

### 10.3 上下文对象建议

```ts
interface AgentContext {
  taskType: string;
  pluginChannel: "standard" | "professional";
  userQuery: string;
  schematic: {
    components: unknown[];
    nets: unknown[];
    pins: unknown[];
  };
  selection: unknown[];
  ruleHits: unknown[];
  citations: unknown[];
}
```

## 11. 典型执行流程

### 11.1 原理图分析
1. 加载 `schematic-analysis-skill`
2. 调用 `editor.get_current_document`
3. 调用 `rules.run_schematic_checks`
4. 如果规则结果不足以解释，调用 `rag.search`
5. 调用 `llm.generate`
6. 汇总问题、证据、建议

### 11.2 元件接反检查
1. 加载 `wiring-standards-check-skill`
2. 调用 `editor.get_selection`
3. 调用 `rules.run_schematic_checks`
4. 如需典型接法参考，调用 `rag.search`
5. 输出风险说明与修复建议

### 11.3 草案生成与落图
1. 加载 `generic-schematic-draft-skill`
2. 调用 `editor.get_current_document`
3. 调用 `rag.search`
4. 调用 `llm.generate`
5. 输出草案
6. 进入 `awaiting_user_confirmation`
7. 用户确认后调用 `rules.validate_draft`
8. 通过后调用 `editor.preview_apply_plan`
9. 再确认后调用 `editor.apply_plan`

## 12. 输出结构设计

### 12.1 分析结果

```json
{
  "summary": "发现 2 个高风险问题",
  "issues": [],
  "citations": [],
  "tool_traces": []
}
```

### 12.2 草案结果

```json
{
  "summary": "已生成智能药盒项目原理图草案",
  "draft": {
    "components": [],
    "connections": [],
    "net_names": [],
    "attribute_suggestions": []
  },
  "citations": [],
  "tool_traces": []
}
```

## 13. 容错与失败策略

### 13.1 可恢复错误
- 单个工具调用失败
- RAG 未命中足够证据
- LLM 首次响应结构不合法

处理策略：
- 重试一次
- 降级使用规则结果
- 明确提示“不确定”

### 13.2 不可恢复错误
- 原理图上下文无法读取
- 落图工具不可用
- 高风险规则未通过却要求强制落图

处理策略：
- 终止任务
- 返回可解释错误信息

## 14. 可观测性设计
- 每个 Agent 任务都记录：
  - `task_id`
  - `task_type`
  - `selected_skills`
  - `tool_traces`
  - `llm_request_id`
  - `credits_cost`
  - `final_status`
- 插件 UI 可展示：
  - 工具调用摘要
  - 引用证据
  - 风险阻断原因

## 15. 首版实现边界
- 首版不做多 Agent 协作。
- 首版不做自主长期规划任务。
- 首版不做插件外本地守护进程。
- 首版优先保证：
  - 分析可解释
  - 草案可确认
  - 落图可阻断
  - 工具调用可审计

## 16. 结论
本 Agent 方案以 `ReAct + Tool Calling + MCP + Skill` 为核心，能够满足嘉立创 EDA AI 助手插件在分析、问答、草案生成和安全落图上的需求，同时兼顾可解释性、可扩展性和工程可控性。
