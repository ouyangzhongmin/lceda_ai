# 临时放置真实 Pin + RAG 增强匹配设计

## 背景

当前草案自动应用依赖库元数据接口为草案引脚建立 `plan pin -> runtime pin` 映射。实际验证表明：

- `LIB_Device.get()` 只返回器件元数据，不含可用引脚表。
- `LIB_Symbol.get()` 只返回符号元数据，不含可用引脚表。
- `LIB_Footprint.get()` 只返回封装元数据，不含可用焊盘/引脚表。

因此，基于这些 `get()` 元数据接口无法可靠完成自动连线前的引脚解析。继续在元数据层补字段会不断遇到新的宿主差异，无法构成稳定方案。

## 目标

构建一条以宿主真实器件引脚为准的自动连线能力：

- 应用草案前，先读取宿主最终认可的真实引脚。
- 用这些真实引脚完成草案引脚映射。
- RAG 仅作为匹配增强与排序依据，不作为真实引脚真值来源。
- 对简单器件形成稳定闭环，减少“请先确认器件型号再重新应用”的失败。

第一阶段目标器件类型：

- LED
- 电阻
- 电容
- 2pin 连接器

## 非目标

- 第一阶段不处理复杂多单元器件。
- 第一阶段不解析 `.elibz/.elibz2` 库文件。
- 第一阶段不依赖服务端保存完整器件 pin 数据缓存。
- 第一阶段不对所有低置信度器件强行自动连线。

## 核心原则

1. 宿主真实 pin 是唯一真值来源。
2. RAG 只能辅助排序，不能替代真实 pin。
3. 探测事务与正式应用事务分离。
4. 所有探测放置必须可清理、可回滚。
5. 内部失败原因应结构化记录，但不向用户暴露“unresolved pin mapping”等内部术语。

## 总体方案

### 方案摘要

在正式应用草案前，先将候选器件临时放置到隔离区域，通过宿主 `SCH_PrimitiveComponent.getAllPinsByPrimitiveId(...)` 读取真实 pin。随后用本地规则与 RAG 样本对 `plan pin -> real pin` 做匹配打分，生成高置信度映射后再执行正式应用。

### 为什么选择这条路线

- 不依赖库元数据结构是否完整。
- 直接读取宿主最终使用的实际器件引脚。
- 不需要先攻克库文件解析与权限问题。
- 对不同器件类型更通用。

## 模块设计

### 1. `TransientPlacementResolver`

职责：

- 将 `DraftPlan` 中已选定器件临时放置到隔离区域。
- 读取每个临时器件的真实引脚。
- 记录探测事务中的临时 primitive。
- 在成功或失败后统一清理。

输入：

- `DraftPlan`
- 已解析的 `device_uuid/library_uuid`

输出：

- `componentId -> realPins[]`

`realPins[]` 最小字段：

- `pinName`
- `pinNumber`
- `primitiveId`
- `x`
- `y`

约束：

- 只放置器件，不创建导线。
- 临时放置坐标必须与正式应用区域隔离。
- 清理失败要明确记录日志。

### 2. `PinMatchEngine`

职责：

- 把草案引脚映射到真实引脚。
- 给每个候选匹配计算置信度和原因。

输入：

- 草案 `plan.pins`
- `TransientPlacementResolver` 读取到的 `realPins`
- 器件角色信息
- 可选 RAG 样本

输出：

- `resolvedPinName`
- `resolvedPinNumber`
- `resolvedElectricalType`
- `pinResolutionStatus`
- `pinResolutionConfidence`
- `pinResolutionReason`

匹配顺序：

1. 精确 pin number 命中
2. 精确 pin name 命中
3. 语义别名命中
4. 器件角色规则
5. RAG 历史样本增强

### 3. `RagPinHintProvider`

职责：

- 从后端已有原理图或知识样本中返回“该类器件常见 pin 命名/连接习惯”。

典型用途：

- `LED` 常见 `A/K`
- 电阻、电容常见 `1/2`
- 2pin 连接器常见 `VCC/GND`、`BAT+/BAT-`

输出不是最终映射，而是打分增强信息，例如：

- `expectedPinNames`
- `expectedPinRoles`
- `commonMappings`
- `evidence`

### 4. `DraftConnectivityResolver`

职责：

- 串联探测放置、真实 pin 读取、匹配、结果写回。
- 输出一个可用于正式应用的增强版 `DraftPlan`。

成功条件：

- 目标器件的每个关键 plan pin 都获得高置信度映射。

失败条件：

- 器件无法放置
- 无法读取真实 pin
- 匹配分数低于阈值

失败后行为：

- 清理临时器件
- 返回结构化内部原因
- UI 用用户可理解语言提示“当前器件引脚信息不足，无法直接自动应用”

### 5. `TypedApplyExecutor`

职责：

- 使用已经解析好的真实 pin 映射执行正式放置与导线创建。
- 不再临时猜测 pin。

与现有实现关系：

- 保留现有 typed placement 正式应用主流程。
- 在正式应用前增加 `DraftConnectivityResolver` 作为前置步骤。

## 数据流

1. LLM 生成草案。
2. 设备解析完成，获得 `device_uuid/library_uuid`。
3. 用户点击应用草案。
4. 进入 `DraftConnectivityResolver`。
5. `TransientPlacementResolver` 临时放置器件。
6. 读取真实 pin。
7. `PinMatchEngine` 本地规则匹配。
8. 低置信度项调用 `RagPinHintProvider` 获取增强信息。
9. 生成最终 pin 映射并写回 plan。
10. 清理临时器件。
11. `TypedApplyExecutor` 正式放置并连线。
12. 失败时返回结构化错误与用户友好提示。

## 置信度与决策

建议引入分数阈值：

- `>= 0.9`：自动通过
- `0.65 - 0.9`：允许简单器件自动通过，但记调试日志
- `< 0.65`：不自动应用，进入失败提示或后续人工确认流程

第一阶段建议仅对简单器件在中高分区间自动通过。

## 第一阶段实现范围

### 支持器件

- LED
- 电阻
- 电容
- 2pin 连接器

### 暂不支持

- 多单元运放、逻辑门
- 大型连接器阵列
- pin 复用复杂 MCU/Codec
- 需要子门/子部件选择的器件

## 事务与清理

探测事务要求：

- 临时放置的组件 ID 必须单独记录。
- 若任一步骤失败，必须删除已创建的临时组件。
- 清理失败也必须写日志，不可静默吞掉。

正式应用事务要求：

- 与探测事务分离。
- 正式应用失败时回滚正式放置对象，不影响探测事务清理逻辑。

## 日志与诊断

需要新增或强化以下日志：

- `draft-transient-placement`
  - 器件临时放置是否成功
  - 读取到的 pin 数量
- `draft-pin-match`
  - 每个 `plan pin -> real pin` 的候选打分
- `draft-rag-pin-hints`
  - RAG 返回了哪些增强证据
- `draft-transient-cleanup`
  - 临时器件删除是否成功

日志目标：

- 能区分“放置失败”
- 能区分“读取 pin 失败”
- 能区分“匹配失败”
- 能区分“正式应用失败”

## 测试策略

### 单元测试

- 临时放置成功后正确读取 pin
- 清理事务在异常时执行
- LED `A/K` 匹配
- 电阻/电容 `1/2` 匹配
- 2pin 连接器 `VCC/GND` 匹配
- 低置信度时拒绝自动通过

### 集成测试

- 应用前自动执行探测放置并生成 pin 映射
- 生成 pin 映射后正式应用成功
- 探测失败时不污染画布

## 风险与对策

### 风险 1：临时放置性能不足

对策：

- 第一阶段只处理少量简单器件
- 后续考虑批量放置与读取

### 风险 2：某些器件放置后 pin 名依然不标准

对策：

- 用本地语义别名 + RAG 样本增强
- 低置信度时不自动通过

### 风险 3：清理失败污染画布

对策：

- 临时放置区域隔离
- 独立 cleanup 日志
- 后续可增加“清理残留探测器件”恢复动作

## 实施顺序

1. 为 typed placement 提取“临时放置 + 读取 pin + 清理”能力。
2. 实现不依赖 RAG 的基础 `PinMatchEngine`。
3. 在应用前接入 `DraftConnectivityResolver`。
4. 对 LED/电阻/电容/2pin 连接器打通闭环。
5. 再接入 `RagPinHintProvider` 做增强打分。

## 成功标准

满足以下条件视为第一阶段完成：

- 简单 LED 指示灯电路可自动应用成功
- 电阻/电容/2pin 连接器不再因 metadata-only pin 问题阻塞
- 应用失败时能明确区分失败层级
- 用户侧不再看到“请先确认器件型号，再重新应用草案”这一类笼统错误覆盖所有情况
