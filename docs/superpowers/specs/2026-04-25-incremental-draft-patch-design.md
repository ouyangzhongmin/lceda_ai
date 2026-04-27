# 当前页增量草案 Patch 与器件变更设计

## 1. 背景

当前草案应用链路采用整版 `applyPlan` 模型：

- 首次应用要求目标原理图页为空白页。
- 应用成功后仅保留 `transactionId` 用于整体回滚。
- 用户在“已应用一版草案”后继续聊天修改，再次点击“应用草案”时，仍会走整版重放逻辑。

这会导致两个问题：

1. 当前页已有内容时，修改后的再次应用会被“空白页保护”阻断。
2. 用户对“继续修改当前页” 的心理预期，与“整版回滚后重放”模型不一致。

因此需要新增“基于当前页的增量 patch”能力，使草案后续修改可以直接落到当前页，并支持器件变更。

## 2. 目标

本设计目标如下：

- 已应用一版草案后，继续聊天修改并再次确认时，默认走当前页增量 patch，而不是整版重放。
- 支持器件变更能力。
- 同类器件替换时，尽量保留 Ref、位置、朝向与既有连线。
- 跨类器件替换时，允许结构变化；能保留的连线先保留，不能安全映射的连线断开并标记待处理。
- 变更前必须先生成结构化变更预览，再执行真实落图。
- 保留“整版替换”作为兜底策略，但不作为默认路径。

## 3. 非目标

首阶段不解决以下问题：

- 任意用户手工修改与 AI 修改的复杂双向 merge。
- 全页面所有对象的通用智能 diff。
- 任意模块级重构的全自动安全重布线。
- 任意跨类器件替换后的完整自动引脚语义重连。

## 4. 用户体验目标

### 4.1 主路径

用户路径应变为：

1. 生成并应用一版草案。
2. 继续聊天提出修改需求。
3. Agent 基于当前已应用草案生成更新后的草案版本。
4. UI 展示“变更预览”，而不是直接展示“应用草案”。
5. 用户点击 `应用变更`。
6. 插件将变更 patch 到当前页。
7. UI 返回结果摘要，包括新增、删除、替换与待处理连接。

### 4.2 跨类器件替换的默认策略

采用半自动模式：

- 能保留的连线先保留。
- 能自动映射的新引脚关系自动重连。
- 无法安全映射的连接先断开。
- 断开的连接必须进入“待处理连接”列表。

不允许静默强行重连。

## 5. 总体方案

采用“结构化 diff + 图元归属追踪”的增量 patch 方案。

核心思想：

- 不再只记录一次应用事务 ID。
- 在首次成功应用后，持久化“上一版已应用草案快照”和“草案对象到真实图元对象的映射”。
- 新一版草案生成后，先与上一版已应用草案做结构化 diff。
- 将 diff 转换为可执行 patch。
- 使用对象映射将 patch 精确落到当前页真实图元。

## 6. 核心数据模型

### 6.1 appliedDraftSnapshot

记录最近一次成功应用到当前页的结构化草案快照。

建议字段：

```ts
interface AppliedDraftSnapshot {
  draftVersionId: string;
  title: string;
  rationale: string;
  appliedAt: string;
  pageId?: string;
  components: DraftPlan["components"];
  pins: DraftPlan["pins"];
  nets: DraftPlan["nets"];
}
```

用途：

- 作为“旧版本草案”的稳定基准。
- 为增量 diff 提供输入。

### 6.2 draftObjectBindings

记录草案对象与当前页真实对象的映射关系。

建议字段：

```ts
interface DraftObjectBindings {
  pageId?: string;
  componentBindings: Array<{
    draftComponentId: string;
    ref?: string;
    primitiveId: string;
    deviceUuid?: string;
    libraryUuid?: string;
  }>;
  wireBindings: Array<{
    draftNetId: string;
    netName?: string;
    wireIds: string[];
  }>;
}
```

用途：

- 让 patch 引擎知道当前页哪些对象属于 AI 已应用结果。
- 让 patch 操作可以精准命中真实对象，而不是整页扫描重画。

### 6.3 DraftPatchPlan

新增结构化 patch 模型。

```ts
interface DraftPatchPlan {
  baseDraftVersionId: string;
  nextDraftVersionId: string;
  summary: {
    addComponentCount: number;
    removeComponentCount: number;
    replaceDeviceCount: number;
    updatePropCount: number;
    addWireCount: number;
    removeWireCount: number;
    conflictCount: number;
  };
  operations: DraftPatchOperation[];
  conflicts: DraftPatchConflict[];
}
```

### 6.4 DraftPatchOperation

首阶段支持的 patch 操作：

```ts
type DraftPatchOperation =
  | { kind: "add_component"; componentId: string }
  | { kind: "remove_component"; componentId: string; primitiveId?: string }
  | { kind: "update_component_props"; componentId: string; primitiveId?: string; propPatch: Record<string, string> }
  | {
      kind: "replace_component_device";
      componentId: string;
      primitiveId?: string;
      mode: "same_class" | "cross_class";
      nextDeviceUuid?: string;
      nextLibraryUuid?: string;
      keepRef: boolean;
      keepPlacement: boolean;
    }
  | { kind: "add_wire"; netId: string }
  | { kind: "remove_wire"; netId: string; wireIds?: string[] }
  | {
      kind: "rewire_endpoint";
      netId: string;
      componentId: string;
      fromPin?: string;
      toPin?: string;
    }
  | {
      kind: "mark_conflict";
      conflictId: string;
    };
```

### 6.5 DraftPatchConflict

```ts
interface DraftPatchConflict {
  id: string;
  type:
    | "pin_mapping_missing"
    | "net_semantics_changed"
    | "device_class_changed"
    | "binding_missing"
    | "user_edit_detected";
  level: "warning" | "blocking";
  componentRef?: string;
  netName?: string;
  message: string;
  suggestedAction?: string;
}
```

## 7. Diff 与 Patch 生成流程

### 7.1 输入

patch 生成器输入包含：

- `appliedDraftSnapshot`
- 新生成的 `DraftPlan`
- `draftObjectBindings`
- 当前页实际上下文

### 7.2 流程

1. 对旧草案和新草案做结构化归一化。
2. 按 `draftComponentId` 与 `ref` 建立主匹配。
3. 判断器件变更类型：
   - 无变化
   - 属性变化
   - 同类替换
   - 跨类替换
   - 删除
   - 新增
4. 计算网络变化：
   - 保留原有连接
   - 新增连接
   - 删除连接
   - 端点重定向
   - 无法映射的连接冲突
5. 生成 `DraftPatchPlan`。
6. 在 UI 中先展示 patch 预览，再允许执行。

## 8. 器件替换规则

### 8.1 同类替换

判定条件示例：

- 同一 completion role
- 同一器件类别
- 引脚语义差异较小

执行策略：

- 保留 `Ref`
- 保留位置与朝向
- 优先保留原连线
- 更新 device / symbol / footprint / 关键属性

如果某些引脚名变化但语义可映射：

- 自动建立旧引脚到新引脚的映射
- 对应连线直接迁移

### 8.2 跨类替换

判定条件示例：

- completion role 改变
- 关键电气角色改变
- 引脚集合和语义明显变化

执行策略：

- 默认仍保留 `Ref`
- 标记本次替换为 `cross_class`
- 先尝试按引脚语义匹配可继承网络
- 对可安全继承的连接自动重连
- 对不可安全继承的连接断开
- 生成 `DraftPatchConflict` 并进入待处理列表

## 9. 执行策略

### 9.1 默认执行路径

默认路径为：

1. 生成新草案。
2. 如果存在 `appliedDraftSnapshot + draftObjectBindings`，优先生成 `DraftPatchPlan`。
3. 若 patch 可执行，则 UI 展示“应用变更”。
4. 用户确认后执行 patch。

### 9.2 兜底路径

以下情况允许回退到整版替换或新建页应用：

- 当前页找不到足够的对象绑定。
- 当前宿主缺乏实现 patch 所需的编辑能力。
- patch 冲突达到阻断级别。
- 用户明确选择整版替换。

### 9.3 与现有回滚逻辑的关系

`rollbackApplyPlan` 不再作为“修改后再次应用”的默认路径。

它保留为：

- 用户显式点击“回滚应用”
- patch 失败后的人工恢复手段
- 不支持 patch 时的兜底替换策略

## 10. UI 方案

### 10.1 操作文案

当识别到当前页已有一版已应用草案时：

- 主按钮从 `应用草案` 改为 `应用变更`

若存在待处理连接：

- 文案显示为 `应用变更（有待处理连接）`

### 10.2 变更预览卡片

预览卡片需至少展示以下 4 类：

- 新增器件
- 替换器件
- 删除器件
- 待处理连接

对器件替换卡片，需展示：

- 旧器件 -> 新器件
- 是否同类替换
- 是否保留 Ref
- 是否存在待处理引脚/网络

### 10.3 执行结果摘要

应用完成后需返回：

- 新增器件数
- 删除器件数
- 替换器件数
- 自动保留连接数
- 自动重连数
- 待处理连接数

## 11. 阶段拆分

### 11.1 第一阶段

目标：

- 支持“已应用一版草案后，在当前页继续修改并再次应用”
- 支持同类器件替换
- 支持小范围新增/删除器件
- 连接侧只做“保留”或“断开待处理”，不做复杂自动重布线

范围：

- 新增 `appliedDraftSnapshot`
- 新增 `draftObjectBindings`
- 新增 `DraftPatchPlan`
- UI 增加“变更预览”和“应用变更”

### 11.2 第二阶段

目标：

- 支持跨类器件替换
- 支持引脚语义匹配
- 支持 `rewire_endpoint`
- 支持待处理连接列表与补救交互

### 11.3 第三阶段

目标：

- 支持复杂网络重构
- 支持用户手工修改冲突检测
- 支持更细粒度的对象级 merge

## 12. 实现建议

建议新增以下能力层：

- `draftPatchBuilder`
  - 输入旧草案、新草案、bindings
  - 输出 `DraftPatchPlan`

- `draftPatchExecutor`
  - 输入 `DraftPatchPlan`
  - 调用宿主对象级能力完成实际修改

- `draftBindingStore`
  - 管理 `appliedDraftSnapshot` 与 `draftObjectBindings`

- `draftPatchPreviewPresenter`
  - 将 patch 结果转换为 UI 预览卡片

## 13. 风险与约束

主要风险如下：

- 当前宿主对象级编辑能力可能不足以支撑完整 patch。
- 跨类替换的引脚语义匹配错误会带来误连线风险。
- 用户手工修改 AI 已生成对象后，绑定关系可能漂移。
- 当前部分 apply 实现仍偏向整版写入，需要额外补对象级更新能力。

因此首阶段必须坚持：

- 默认保守
- 不可安全映射时断开并提示
- 不做静默强连

## 14. 验收标准

首阶段验收以以下路径为准：

1. 用户生成并应用一版草案。
2. 用户继续聊天要求替换一个同类器件。
3. 系统展示变更预览，而非空白页报错。
4. 用户点击 `应用变更` 后，当前页就地更新。
5. 原有可保留连接保留。
6. 无法安全继承的连接进入待处理列表。
7. 不触发默认整版回滚。

## 15. 结论

当前问题的根因不是单一 bug，而是现有“整版 apply / 整体 rollback”模型与“继续修改当前页”的产品预期不一致。

本设计通过引入：

- 已应用草案快照
- 草案对象绑定
- 结构化 patch plan
- 器件替换分级策略

将“修改后再应用”从整版重放转为当前页增量 patch，并把“变更器件”纳入同一条可解释、可控、可逐阶段落地的演进路径。
