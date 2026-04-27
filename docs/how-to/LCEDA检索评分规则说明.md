# LCEDA 检索评分规则说明

## 目的

这份文档说明当前 LCEDA 开源原理图检索链路中的评分与排序规则，覆盖：

- 入库前的静态质量评分
- RAGFlow 检索后的动态意图重排
- 项目组合 `project_combo_bundle` 的优先与抑制规则
- 查询兜底启发式规则

目标不是做通用搜索，而是让用户在查 `ESP32-S3 复位网络`、`EN 上拉电阻 3.3V`、`I2C 上拉电阻` 这类问题时，优先拿到更完整、更可信、更容易在嘉立创落地的电路组合。

## 整体链路

当前排序分 4 层：

1. 抽取层静态评分
2. RAGFlow 原始召回分
3. 服务层查询意图分
4. 项目组合加减分与查询兜底

最终在服务层统一融合后排序。

## 一、静态评分

实现位置：

- `scripts/server/extract_lceda_templates.py`
- `scripts/server/transform_lceda_templates_for_ragflow.py`

### 输出字段

抽取结果中的 `scoring` 字段包含：

- `static_quality_score`
- `structure_score`
- `signal_chain_score`
- `combo_integrity_score`
- `jlc_searchable_score`
- `project_quality_score`
- `score_reasons`
- `intent_tags`

这些字段会在导入 RAGFlow 时同时进入：

- `metadata`
- `content`

因此向量召回和文本召回都能利用这些信号。

### 静态评分维度

#### 1. `structure_score`

衡量模板是否结构化、可追溯。

主要看：

- 是否有 `template_type`
- 是否有 `anchor_device_family` / `anchor_device_model`
- 是否有 `source_project_id`
- 是否有 `source_project_url`
- 是否能定位到真实项目来源

#### 2. `signal_chain_score`

衡量是否真的抽取到可信连接链。

高分特征：

- 存在 `EN/RESET/RST/BOOT/GPIO/SDA/SCL/TX/RX -> R/C -> 3V3/GND/VCC`
- `connection_chains` 为真实结构化链
- 不是只靠 token fallback 猜出来

低分特征：

- `token_fallback_chain`
- 没有真实连接链
- 只有器件列表，没有网络关系

#### 3. `combo_integrity_score`

衡量组合有没有被打散。

高分特征：

- 主控与外围电阻/电容/接口成组出现
- `project_combo_bundle` 中既有锚点信号又有配套器件
- 连接链和器件上下文能组成一个完整小系统

#### 4. `jlc_searchable_score`

衡量是否适合嘉立创/LCSC 落地。

高分特征：

- 有 `LCSC part code`
- 阻容值规范，如 `10k`、`100nF`、`10uF`
- 器件值可采购、可替代、可复用

低分特征：

- `={Value}`
- 脏值、空值
- 无法映射到嘉立创器件库

#### 5. `project_quality_score`

衡量来源项目整体可信度与复用价值。

高分特征：

- 来自真实项目
- 多组件组合真实存在
- 项目标题、项目 URL、连接链都能对齐

### 静态总分公式

```text
static_quality_score =
structure_score * 0.15 +
signal_chain_score * 0.30 +
combo_integrity_score * 0.25 +
jlc_searchable_score * 0.20 +
project_quality_score * 0.10
```

设计原则：

- `signal_chain_score` 和 `combo_integrity_score` 最高，因为你的核心要求就是“组合不能散、链路要真”
- `jlc_searchable_score` 次高，因为要优先给能在嘉立创落地的方案

## 二、RAGFlow 导入表现

当前导入到 RAGFlow 的每条模板/项目组合会显式写出：

- `Static quality score: ...`
- `Intent tags: ...`
- `Score reasons: ...`

示例：

```text
Static quality score: 0.98
Intent tags: gpio_bias, reset, power
Score reasons: real_connection_chains, lcsc_searchable_components, multi_component_context
```

这样做的作用：

- 提高文本召回时对高质量结果的命中概率
- 让服务层可以从片段中反解析评分字段继续重排

## 三、服务层混合排序

实现位置：

- `server/internal/usecase/rag/service.go`

### 最终排序公式

```text
final_score =
retrieval_score * 0.45 +
static_score * 0.25 +
intent_score * 0.20 +
combo_bonus * 0.10
```

含义：

- `retrieval_score`：RAGFlow 返回的原始召回分
- `static_score`：从 `Static quality score` 或兼容规则提取出的静态质量分
- `intent_score`：查询和结果的意图匹配度
- `combo_bonus`：针对 `project_combo_bundle` 的业务加减分

## 四、动态意图识别

服务层会先把查询解析成 `IntentProfile`。

当前核心意图：

- `wantsReset`
- `wantsGPIOBias`
- `wantsI2CPullup`
- `wantsCombo`
- `anchorDevice`

### 1. Reset 意图

典型触发词：

- `复位`
- `RESET`
- `RST`
- `BOOT`

加分方向：

- 含真实 `RESET ->`
- 含 `BOOT ->`
- 含 `EN ->`
- 有真实连接链
- 标记了 `reset` 意图标签

### 2. GPIO Bias 意图

典型触发词：

- `GPIO`
- `上拉`
- `下拉`
- `偏置`
- `电阻`
- `电容`

加分方向：

- `GPIOx -> R/C -> 3V3/VCC/GND`
- `gpio_passive_power_chain`
- 标记了 `gpio_bias`

### 3. I2C Pull-up 意图

典型触发词：

- `I2C`
- `SDA`
- `SCL`
- 并且同时包含 `上拉/下拉/电阻/偏置`

加分方向：

- 结果中出现 `I2C`、`SDA`、`SCL`
- 存在 `SDA ->`
- 存在 `SCL ->`
- 存在 `4.7K/4.7KΩ/4K7`

减分方向：

- 只有 `EN/RESET/GPIO0` 这种泛化上拉链
- 没有 `SDA/SCL/I2C` 证据

## 五、项目组合规则

`project_combo_bundle` 不会无脑优先。

### 会加分的情况

- 查询本身就是组合场景
- 查询是 reset/gpio bias，并且组合里有真实连接链
- 组合结果带完整上下文，适合小白用户直接参考

### 会减分的情况

- 组合里没有查询关键锚点
- 明显过宽，只是“大而全”的项目片段
- 带 `token_fallback_chain`

特别是最近新增的一条：

- `project_combo_bundle + token_fallback_chain` 会被额外扣分

原因：

- 这类结果在外观看起来完整，但链路可信度不如真实结构化模板
- 在 `ESP32-S3 复位网络` 这种查询里，应该让更纯净的 `RESET/BOOT/EN` 结构链排前面

## 六、查询兜底启发式

### I2C 上拉电阻兜底

当原始召回里没有足够的 `SDA/SCL` 结果时，服务层会主动注入一个启发式候选：

- `heuristic-i2c-sensor-subsystem`

其内容固定包含：

```text
SDA -> 4.7K -> 3V3
SCL -> 4.7K -> 3V3
```

目的：

- 避免 `I2C 上拉电阻` 被泛化成普通 `EN/GPIO` 上拉查询
- 在真实候选不足时仍然给用户一个可操作的结构化答案

注意：

- 这是兜底，不是替代真实项目数据
- 一旦真实 `SDA/SCL` 结构链足够多，真实结果仍应优先

## 七、当前线上验证结论

目前已验证通过的查询：

- `ESP32-S3 复位网络`
- `ESP32-S3 EN 上拉电阻 3.3V`
- `ESP32-S3 GPIO 电阻 电容 VCC`
- `I2C 上拉电阻`

已达到的效果：

- 组合不再被无脑抬高
- 真实 reset/gpio 链优先于低质量 fallback 组合
- I2C 场景不再被 reset/gpio 泛化结果淹没

## 八、后续扩展建议

后续可以沿同样模式扩展更多查询兜底和意图标签：

- `SPI`
- `UART 下载口`
- `LDO 去耦`
- `USB-C CC`
- `传感器中断脚上拉`
- `按键复位/启动下载`

建议扩展原则：

1. 先补结构化抽取与静态评分
2. 再补意图标签
3. 最后才补查询兜底启发式

不要先堆启发式，否则后期会越来越难维护。
