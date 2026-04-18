# 草案应用阶段部分连线容错设计

## 背景

当前 typed placement 应用链路要求 DraftPlan 中相关器件的引脚映射在应用前全部解析完成。只要仍存在 `unresolved draft pin mappings`，应用流程就会直接失败，并提示用户先确认器件型号后重新应用。

这会导致两个问题：

- 即使器件本身已经可以放置，用户也无法先把器件落到图上。
- 少量未解析连接会阻塞整张草案的应用，用户必须反复回到“确认器件”阶段，无法接受“先落器件，再手工补线”的工作流。

用户希望调整为：

- 器件先正常放置到编辑器中。
- 能确定端点的连接继续自动连线。
- 涉及未解析引脚的连接跳过自动连线。
- 最终整体仍视为应用成功，并明确提示用户哪些连接需要手动补线。

## 目标

- 将 typed placement 应用策略从“全部引脚映射必须先解析完成”调整为“尽量完成可确定的放置和连线”。
- 只跳过无法确定真实端点的连接，不阻塞已确认器件的放置。
- 应用结果在至少成功放置器件时返回成功，而不是整体失败。
- 为用户提供清晰的后置提示，说明哪些连接未自动完成，需要手动处理。

## 非目标

- 不修改草案生成逻辑。
- 不修改器件确认弹窗的交互。
- 不保证未解析连接一定能在应用后自动补齐。
- 不引入新的自动布线算法。
- 不改变回滚语义，只复用现有 typed placement transaction 记录已创建对象。

## 问题定位

当前应用链路的根因不是“器件无法放置”，而是“连线解析被当成应用前置硬门槛”：

1. 先尝试补全器件解析与引脚解析。
2. 只要还存在 unresolved pin mappings，就直接失败。
3. 因此还没进入“逐条连接尝试自动连线”的阶段，就已经终止。

这意味着当前失败是架构策略问题，而不是单纯的 pin matching 精度问题。

## 方案对比

### 方案 A：应用阶段部分容错

保留现有 typed placement 方案，但把“未解析引脚映射”从 apply 前硬失败改成 apply 中软跳过。

流程：

- 已确认器件先全部放置。
- 每条连接单独判断是否具备可解析端点。
- 能解析就自动连线。
- 不能解析就记录为 skipped connection，继续后续连接。
- 最终输出“已放置器件 + 部分连线 + 剩余手动处理项”。

优点：

- 改动范围集中在 apply 链路。
- 最符合用户期望。
- 风险和实现复杂度最低。

缺点：

- 需要重新定义 apply 成功/失败边界。

### 方案 B：先放置，再二次反查补线

先把器件都放下，再从编辑器内真实对象反查一次 pin / primitive，再尝试补齐更多连接。

优点：

- 理论上自动连线命中率更高。

缺点：

- 链路更长，状态更复杂。
- 失败归因和回滚处理更难。
- 对当前问题来说属于过度设计。

### 结论

采用方案 A。当前阻塞点本质上是错误的 apply 前置条件，先把它降级为“逐条连接容错”即可达成目标，不需要新增更复杂的放置后补线阶段。

## 用户可见行为

### 应用前

- 用户仍按现有流程确认器件型号并点击应用草案。
- 不再要求“所有连接都必须在应用前自动校正完成”。

### 应用中

- 能放置的器件继续放置。
- 能自动连接的网络继续连接。
- 某条连接只要依赖未解析引脚，就跳过该连接，不影响其他连接。

### 应用后

- 只要至少成功放置了器件，整体状态按“应用成功”处理。
- 提示文本明确区分：
  - 已放置器件数
  - 已自动连接的网络或线段数
  - 需要手动处理的连接数量
- 用户会看到类似：
  - `草案已应用：已放置 9 个器件，已自动连接 6 条网络，3 条连接需手动处理。`

### 手动处理提示

- 在聊天结果中附带一段结构化提示，列出未完成连接。
- 每项提示至少包含：
  - 起点器件与引脚
  - 终点器件与引脚
  - 对应网络名（若有）

示例：

- `U1.OUT -> C3.1 @ VCC：未能自动确定真实引脚，需手动补线`
- `J1.CC1 -> U2.CC1 @ USB_CC1：未能自动确定真实引脚，需手动补线`

## 成功与失败语义

### 视为成功

满足以下任一条件：

- 至少一个器件成功放置
- 或至少一条连接成功创建

即使存在 skipped connections，也返回成功，但 summary / toast / chat 消息必须说明存在手动补线项。

### 仍视为失败

以下情况仍然返回失败：

- 没有任何器件成功放置
- typed placement 运行时本身不可用
- 编辑器创建组件调用整体失败
- 事务记录或底层宿主 API 发生致命异常，导致无法判断已创建对象

## 架构设计

### 当前问题边界

当前链路里“引脚未解析”被建模成整体 apply 阻塞条件。改造后应改为“单条连接不可自动完成”的局部问题。

### 建议拆分

在 typed placement apply 内部拆成三个阶段：

1. `placeComponents`
   负责基于已确认 device 放置器件，输出已创建 componentIds 以及 component 对应真实 primitive / pin 信息。

2. `connectResolvableNets`
   遍历草案中的连接需求，只对两端都已解析的连接尝试画线。
   对无法解析的连接写入 `skippedConnections`。

3. `summarizePartialApplyResult`
   根据 placed components / created wires / skipped connections 统一构建 apply result、summary、toast 和 chat 提示。

## 数据流设计

### 输入

- DraftPlan
- 已确认器件的真实 device / library 信息
- typed placement 运行时返回的已放置 primitive / pin 信息

### 中间状态

建议在 apply 内部维护：

- `placedComponents: string[]`
- `createdWires: string[]`
- `skippedConnections: Array<{ fromComponentRef?: string; fromPin?: string; toComponentRef?: string; toPin?: string; netName?: string; reason: string }>`

### 输出

`ApplyPlanResult` 语义保持兼容，但上层 summary 增强：

- `applied: true`
- `componentCount`
- `netCount`
- 可通过附加摘要文本表达部分连线完成情况

如现有 `ApplyPlanResult` 无法承载 skipped connection 明细，则由 runtime 层另行组织结构化聊天消息，不强行扩大底层宿主 adapter 返回模型。

## 连接跳过规则

以下情况跳过单条连接：

- 起点 draft pin 未解析到真实 pin
- 终点 draft pin 未解析到真实 pin
- 对应组件未成功放置
- 宿主返回的真实 primitive / pin 信息缺失

跳过后：

- 不抛整体异常
- 不终止后续连接
- 记录到 `skippedConnections`

## 错误处理

### 降级错误

以下错误从“整体失败”降级为“局部跳过”：

- `unresolved draft pin mappings`
- 单条连接所需的端点解析失败

### 保持硬失败

以下仍保留为整体失败：

- 组件放置主调用失败
- 宿主 typed placement 不可用
- 创建事务记录失败且无法回滚或汇总结果

## UI / 消息设计

上层 runtime 在 apply 成功但存在 skipped connections 时，应输出 warning-like detail，但总体状态为 success/completed。

建议消息结构：

- 标题：`已应用，部分连接需手动处理`
- 主文案：`草案已应用：已放置 X 个器件，已自动连接 Y 条网络，Z 条连接需手动处理。`
- 附加列表：列出前若干条 skipped connections

如果 skipped connections 数量较多，可只展示前 10 条，并附加：

- `其余 N 条连接也需手动处理。`

## 测试设计

至少覆盖以下场景：

### Adapter / apply 层

- 所有引脚已解析时，行为与当前成功路径一致
- 部分连接未解析时：
  - 器件仍成功放置
  - 可解析连接仍被创建
  - 未解析连接被跳过
  - 结果整体返回成功
- 所有连接都未解析但器件成功放置时：
  - 仍返回成功
  - created wires 为 0
  - skipped connections 有记录
- 组件放置本身失败时：
  - 仍返回失败

### Runtime 层

- apply 成功且存在 skipped connections 时，summary 为成功语义而非失败语义
- 聊天结果包含“需手动处理连接”的提示
- 不再出现“请先确认相关器件型号，再重新应用草案”这类针对 unresolved pin mapping 的硬失败提示

## 风险

- 现有 apply 结果模型可能不足以直接传递 skipped connection 明细，需要在 adapter 与 runtime 之间选择合适的承载位置。
- typed placement 现有实现可能默认把 pin 未解析视为非法输入，需要修改到“逐条连接容错”而不是单纯修改错误文案。
- 部分成功语义需要避免误导用户，以为所有网络都已自动连接完成。

## 验收标准

- 当器件已确认但部分连接仍未解析时，点击应用草案不会整体失败。
- 已确认器件会被放置到编辑器中。
- 可解析的连接会继续自动完成。
- 无法解析的连接会被跳过，不阻塞其他连接。
- 最终 UI 提示整体为成功，并明确告知哪些连接需要手动补线。
