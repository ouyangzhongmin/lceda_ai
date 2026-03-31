# PLANS.md

本文件定义本仓库的 `ExecPlan` 规范与使用方式。凡是复杂功能、跨插件/服务端联动、或大规模重构，必须先写 `ExecPlan`，再实施。

## 适用范围

- 需要跨多个模块改动（例如 `plugin/ + server/ + docs/`）。
- 需要多轮验证与回归（接口、PoC、测试）。
- 需求存在不确定性，需要先做原型验证再收敛方案。

## 强制要求

- `ExecPlan` 必须自包含：新成员只看计划和当前代码即可执行。
- `ExecPlan` 必须是活文档：执行中持续更新，不允许“写完不维护”。
- `ExecPlan` 必须可验证：包含可运行命令与可观察结果。
- `ExecPlan` 必须面向结果：明确用户可见行为，不只描述代码改动。

## 文档结构（必须包含）

每份 `ExecPlan` 必须包含以下章节：

1. 目的 / 全局视角
2. 进度（仅此章节使用 checklist）
3. 意外发现
4. 决策日志
5. 成果与复盘
6. 上下文与导航
7. 工作计划
8. 具体步骤
9. 验证与验收
10. 幂等性与恢复
11. 产出物与备注
12. 接口与依赖

## 进度章节规范

- 使用复选框并带时间戳。
- 每次停顿都必须更新“已完成/剩余”。
- 示例：
  - `[x] (2026-03-25 23:00Z) 完成服务端队列接口重构。`
  - `[ ] 完成 Redis Stream 消费组重投策略参数化。`

## 执行规范

- 不等待用户逐步指挥，按里程碑连续推进。
- 遇到模糊点先做可逆决策，并在“决策日志”记录原因。
- 每个里程碑都要有可验证证据（测试、命令输出、接口返回）。
- 任何影响架构边界的改动必须同步更新对应文档：
  - [ARCHITECTURE.md](/Users/oyzm/workspace5/agents/lceda_ai/ARCHITECTURE.md)
  - [服务端API接口设计文档.md](/Users/oyzm/workspace5/agents/lceda_ai/docs/design-docs/服务端API接口设计文档.md)
  - [当前执行跟踪.md](/Users/oyzm/workspace5/agents/lceda_ai/docs/exec-plans/active/当前执行跟踪.md)

## 本仓库计划入口

- 总体实施计划：[总体实施计划.md](/Users/oyzm/workspace5/agents/lceda_ai/docs/exec-plans/总体实施计划.md)
- 当前执行跟踪：[当前执行跟踪.md](/Users/oyzm/workspace5/agents/lceda_ai/docs/exec-plans/active/当前执行跟踪.md)
- PoC 验证计划：[PoC验证计划.md](/Users/oyzm/workspace5/agents/lceda_ai/docs/exec-plans/PoC验证计划.md)

## ExecPlan 模板（复制后填写）

`# <任务标题>`

`## 目的 / 全局视角`

`## 进度`
- `[ ] (YYYY-MM-DD hh:mmZ) ...`

`## 意外发现`
- `观察：...`
- `证据：...`

`## 决策日志`
- `决策：...`
- `理由：...`
- `日期/作者：...`

`## 成果与复盘`

`## 上下文与导航`

`## 工作计划`

`## 具体步骤`

`## 验证与验收`

`## 幂等性与恢复`

`## 产出物与备注`

`## 接口与依赖`

