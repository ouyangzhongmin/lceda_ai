# LCEDA Hybrid Scoring Design

## Goal

为 LCEDA 开源原理图抽取与 RAGFlow 检索链路增加一套“静态质量评分 + 动态查询意图重排”的混合评分体系，使检索结果优先返回更完整、更可信、更适合嘉立创落地、且更符合用户查询意图的原理图组合与信号链。

## Problem

当前链路虽然已经能抽取 `.epro2` 并导入 RAGFlow，但排序仍存在两个结构性问题：

1. 仅靠向量召回时，真实 `project_combo_bundle` 不一定能在较小召回窗口中稳定进入前列。
2. 模板与项目组合共用一套粗粒度排序逻辑，无法根据查询意图动态偏向“整套组合”或“精确信号链”。

这会导致诸如 `ESP32-S3 复位网络`、`ESP32-S3 EN 上拉电阻 3.3V`、`ESP32-S3 GPIO 电阻 电容 VCC` 这类查询虽然已有相关数据，但前排结果不总是最适合小白用户直接参考或复用。

## Design Decision

采用混合策略：

- 入库前计算静态评分，描述数据本身是否高质量、完整、可落地。
- 查询时计算动态意图评分，描述结果是否符合当前查询的目标信号、器件组合与功能场景。
- 服务层扩窗召回后，用统一混合公式做最终重排。

这比“只做入库评分”或“只做服务层重排”更稳定，也更适合原理图组合检索的业务目标。

## Architecture

### 1. 抽取层静态评分

文件：`scripts/server/extract_lceda_templates.py`

在模板抽取阶段新增结构化评分字段，不替换现有 `quality_score` / `retrieval_priority_score`，而是在现有输出基础上增加一套更显式、可解释、可演进的规则评分。

新增字段：

- `scoring.static_quality_score`
- `scoring.structure_score`
- `scoring.signal_chain_score`
- `scoring.combo_integrity_score`
- `scoring.jlc_searchable_score`
- `scoring.project_quality_score`
- `scoring.score_reasons`
- `scoring.intent_tags`

### 2. RAGFlow 转换层增强

文件：`scripts/server/transform_lceda_templates_for_ragflow.py`

在输出到 RAGFlow 的 `content` 和 `metadata` 中显式写入静态评分与评分原因，使高质量模板和组合在纯文本召回时也更容易被召回，并为后续审计提供依据。

新增内容包括：

- metadata 中的评分字段与意图标签
- content 中的评分摘要文本
- 面向检索的 `Intent tags`、`Score reasons`、`Static quality score`

### 3. 服务层动态重排

文件：`server/internal/usecase/rag/service.go`

在已有“扩窗召回 + 规则重排”的基础上，改为统一的评分管道：

- 识别查询意图
- 提取结果中的静态评分
- 计算动态意图匹配分
- 计算型号匹配与 `project_combo` 奖励
- 融合 RAGFlow 原始召回顺序/相似度
- 生成 `final_score` 后排序

## Static Scoring Rules

静态评分各维度范围均为 `0.0 - 1.0`。

### structure_score

衡量模板是否具备可追溯、可引用、可解释的结构信息。

加分项：

- 有 `anchor_device_model`
- 有明确 `template_type`
- 有 `source_project_id`
- 有 `source_project_url`
- 有 `sheet_title`

降分项：

- 型号为空
- 仅泛化到 `generic`
- 只有标题词命中，没有结构字段

### signal_chain_score

衡量是否真正抽取到了可信的信号链。

加分项：

- 存在 `EN/RST/RESET/BOOT/GPIOx/SDA/SCL/TX/RX -> R/C -> 3V3/GND/VCC`
- `connection_chain_count` 足够且不完全重复
- 有明确 `evidence`

降分项：

- token fallback 链
- 只有器件列表，没有链路
- 链路值、refdes、网络名污染严重

### combo_integrity_score

衡量组合是否完整，是否能作为整体被小白用户直接参考。

加分项：

- 同时包含主控 + 上拉/下拉 + 去耦 + 接口/功能器件
- `project_combo_bundle` 中锚点信号和配套器件成组出现
- 有 `连接链` + `配套器件` + `组合类型`

降分项：

- 只有单器件说明
- 组合被打散
- 只有抽象模板，没有项目上下文

### jlc_searchable_score

衡量器件是否更容易在嘉立创/LCSC 中落地。

加分项：

- 有 `LCSC part code`
- 常见阻容值规范，如 `10k`、`100nF`、`10uF`
- 器件值和封装信息合理

降分项：

- `={Value}`
- 空值、脏值
- 无法映射采购信息

### project_quality_score

衡量来源项目与模式本身的可信度与复用价值。

加分项：

- 来自真实开源项目
- 同类模式在多个项目中重复出现
- 项目组合内容有真实连接链与配套器件

降分项：

- 页面文本污染严重
- fallback 模板痕迹明显
- 非目标型号信息混入

## Static Score Formula

```text
static_quality_score =
structure_score * 0.15 +
signal_chain_score * 0.30 +
combo_integrity_score * 0.25 +
jlc_searchable_score * 0.20 +
project_quality_score * 0.10
```

理由：

- `signal_chain_score` 与 `combo_integrity_score` 直接对应“链路真实”和“组合不能散”，权重最高。
- `jlc_searchable_score` 对小白用户可落地性很重要，因此次高。
- `structure_score` 和 `project_quality_score` 作为基础质量保障，权重略低。

## Dynamic Query Intent Scoring

查询时不直接复用静态分，而是根据查询内容生成 `IntentProfile`。

意图类别：

- `reset_intent`
- `gpio_bias_intent`
- `power_intent`
- `interface_intent`
- `sensor_bus_intent`

示例规则：

### reset_intent

触发词：`复位`、`RESET`、`RST`、`EN`、`BOOT`

加分方向：

- `project_combo_bundle`
- 含真实 `EN ->` / `RST ->` / `BOOT ->`
- 含 `3V3` / `VCC` / `GND` 的复位链

减分方向：

- 无真实链路的 `mcu_boot_reset`
- 错误型号，如查 `ESP32-S3` 命中 `ESP32-C3`

### gpio_bias_intent

触发词：`GPIO`、`IO`、`电阻`、`电容`、`VCC`、`3V3`

加分方向：

- `gpio_passive_power_chain`
- `GPIOx -> R/C -> 3V3/VCC`
- 同时含去耦链的组合

### power_intent

触发词：`LDO`、`电源`、`去耦`、`滤波`、`10uF`、`100nF`

加分方向：

- `mcu_power_core`
- `power_decoupling_network`
- `VBUS/VCC/3V3 -> C -> GND`

### interface_intent

触发词：`USB`、`UART`、`I2C`、`SDA`、`SCL`、`CC1`、`CC2`

加分方向：

- `usb_power_input`
- `uart_download_header`
- `i2c sensor`、`SDA/SCL -> 4.7k -> VCC`

## Final Ranking Formula

服务层最终排序使用：

```text
final_score =
retrieval_score * 0.35 +
static_quality_score * 0.30 +
query_intent_score * 0.25 +
project_combo_bonus * 0.10
```

其中：

- `retrieval_score` 来自 RAGFlow 原始召回顺序/相似度归一化
- `static_quality_score` 来自入库前规则评分
- `query_intent_score` 来自当前查询与结果内容的动态匹配
- `project_combo_bonus` 只给真实 `project_combo_bundle` 与强组合结果

额外规则：

- 型号明确不匹配时，如 `ESP32-S3` 查询命中 `ESP32-C3`，在 `query_intent_score` 中直接扣分
- 若结果没有真实连接链，只是抽象模板，应限制其在强意图查询中的上限

## Data Compatibility

本设计不改变下载与解析输入链路：

- Playwright 下载 `.epro2` 逻辑不动
- `.epro2` 到模板 JSONL 的整体抽取链路不推翻
- RAGFlow 导入流程继续复用现有脚本

只做增量增强：

1. 抽取结果增加评分字段
2. 转换结果增加评分文本与 metadata
3. 服务层优先读取新字段，读不到则回退旧逻辑

## Implementation Units

### Unit A: Static Scoring in Extractor

职责：计算模板级静态评分与评分原因。

涉及文件：

- `scripts/server/extract_lceda_templates.py`
- `scripts/server/tests/test_lceda_open_source_pipeline.py`

### Unit B: RAGFlow Metadata/Text Enrichment

职责：把静态评分、原因和意图标签显式写入导入文本与 metadata。

涉及文件：

- `scripts/server/transform_lceda_templates_for_ragflow.py`
- `scripts/server/tests/test_transforms_pipeline.py`

### Unit C: Dynamic Intent Reranking in Service

职责：统一查询意图识别、静态分读取、最终分合成与排序。

涉及文件：

- `server/internal/usecase/rag/service.go`
- `server/internal/usecase/rag/service_test.go`

## Verification Criteria

必须满足以下查询表现：

1. `ESP32-S3 复位网络`
- 前 3 至少 2 条为真实 `project_combo` 或含 `EN/RST/BOOT` 真实链路

2. `ESP32-S3 EN 上拉电阻 3.3V`
- 前 3 必须含 `EN -> R -> 3V3`

3. `ESP32-S3 GPIO 电阻 电容 VCC`
- 前 3 必须含 `GPIO -> R/C -> VCC/3V3`

4. `I2C 上拉电阻`
- 前排优先 `SDA/SCL -> 4.7k -> VCC`

5. 同类结果中
- 有更多 LCSC/JLC 可搜索器件信息的结果应稳定优先于弱模板

## Risks

### Risk 1: 规则过多导致排序僵化

缓解方式：

- 评分维度拆开，保留可调权重
- 服务层先在 `top_k=20` 的候选集内重排，不全局硬编码覆盖 RAGFlow 召回

### Risk 2: RAGFlow 文本污染影响召回

缓解方式：

- 使用简短、结构化评分文本
- 避免把过多噪声 JSON 再次注入内容正文

### Risk 3: 老数据与新数据并存时行为不一致

缓解方式：

- 服务层对新字段缺失时回退旧逻辑
- 重新生成模板语料并批量重导入后再以新逻辑为主

## Rollout Plan

1. 为抽取层补静态评分与测试
2. 为转换层补 metadata/content 增强与测试
3. 为服务层补统一动态评分与测试
4. 重新生成模板语料
5. 重新导入 RAGFlow
6. 用关键查询做回归验证

## Out of Scope

当前设计不包括：

- 直接修改 RAGFlow 内部排序器
- 引入在线学习或用户点击反馈学习
- 多数据源融合排序（如官方文档 + LCEDA 项目 + 私有知识库联合排序）
