# 嘉立创开源模板管线交接归档（2026-04-20）

## 当前阶段
- 当前主线已从“找真实下载入口”推进到“真实 `.sch/.zip` 结构化抽取 + 批量评估”阶段。
- 活跃执行记录仍在：
  - `docs/exec-plans/active/当前执行跟踪.md`
- 当前最新执行节点：
  - `4.19`

## 已完成能力

### 1. 抓取层
- 脚本：
  - `scripts/server/lceda_open_source_crawler.py`
- 已支持：
  - `/<author>/<project_slug>` 真实 Oshwhub 项目页
  - `Next Flight` / SSR payload 提取 `project_uuid/path/attachments`
  - 附件宿主修正到 `https://image.lceda.cn`
  - `--file-output-dir` 文件优先落盘
  - 单个附件下载失败时自动降级 `text_fallback`，不中断整批任务

### 2. 模板抽取层
- 脚本：
  - `scripts/server/extract_lceda_templates.py`
- 当前模板类型：
  - `usb_power_input`
  - `mcu_power_core`
  - `mcu_boot_reset`
  - `uart_download_header`
  - `i2c_sensor_subsystem`
  - `power_indicator`
  - `battery_protection`
  - `current_sense`
  - `temperature_sense`
  - `status_indicator`
- 关键增强：
  - `.zip` 内部 `.json/.epro/.esch/.sch` 文本扫描
  - `.sch` 结构化 token 提取：
    - `nets`
    - `part_values`
    - `part_numbers`
    - `footprints`
    - `connectors`
  - BMS 上下文门槛，避免电池类模板误报
  - 支持 `B+ / B- / P-` 被 `\x00` 包裹的真实文本形态
  - 支持低阻采样电阻模式：
    - `0.005R`
    - `0.06R`

### 3. 批量评估层
- 脚本：
  - `scripts/server/evaluate_lceda_template_extraction.py`
- 当前输出：
  - `total_projects`
  - `projects_with_templates`
  - `template_type_counts`
  - `source_mode_counts`
  - `risk_counts.battery_templates_without_bms_context`
  - `project_reports[*].template_types`
  - `project_reports[*].risk_flags`

## 当前关键产物

### 真实项目集
- `results/lceda_open_source_raw/real_attachment_projects.jsonl`

### 真实样本评估结果
- `results/lceda_template_corpus/real_attachment_eval.json`

### 重点单样本
- `results/lceda_open_source_raw/hmtang_schematic1.jsonl`
- `results/lceda_open_source_raw/files/oshwhub.com-hmtang-schematic1-2f69568f/ca2c374450344c8fb9b4b3557340764f.sch`

## 当前真实样本结论
- `基于中颖SH3676010B 7-10串 30A 锂电池保护板`
  - 命中：
    - `power_indicator`
    - `battery_protection`
    - `current_sense`
    - `temperature_sense`
- `基于CM1048+CM1010A,4串16.8V带均衡锂电保护板`
  - 命中：
    - `battery_protection`
    - `current_sense`
    - `temperature_sense`
- `USB-TTL串口通信模块-PL2303HXD`
  - 当前命中：
    - `status_indicator`
  - 该命中仍建议人工复核，可能偏噪声
- `YDIFLY——蝴蝶扑翼机飞控主控板开源`
  - 当前 `file_first`
  - 仍为 `0` 模板，尚未判断是合理空结果还是漏检

## 当前未完成但最值得继续的事项
1. 检查 `YDIFLY` zip 内容，判断应为 0 命中还是规则漏检。
2. 复核 `USB-TTL` 样本的 `status_indicator`，必要时收紧该规则。
3. 若后续切到插件侧：
   - 先评估是否接入
     - `battery_protection`
     - `current_sense`
     - `temperature_sense`
   - 不建议直接默认自动应用。

## 已验证命令
- 回归测试：
  - `python3 -m unittest scripts.server.tests.test_lceda_open_source_pipeline scripts.server.tests.test_transforms_pipeline scripts.server.tests.test_rag_knowledge_crawler`
- 最近结果：
  - `Ran 60 tests ... OK`
- 批量评估：
  - `python3 scripts/server/evaluate_lceda_template_extraction.py --input results/lceda_open_source_raw/real_attachment_projects.jsonl --output results/lceda_template_corpus/real_attachment_eval.json`

## 交接建议
- 新工具接手后，优先从这里继续：
  - `docs/exec-plans/active/当前执行跟踪.md`
  - `docs/exec-plans/archive/2026-04-20-lceda-open-source-template-pipeline-handoff.md`
