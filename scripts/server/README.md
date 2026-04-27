# scripts/server

## 作用
- 存放服务端相关的辅助脚本（如知识抓取、数据预处理、批量导入）。

## 使用 uv 运行知识爬虫（官方资料优先）
- 适用脚本：
  - `rag_knowledge_crawler.py`
- 初始化环境：
  - `uv python install 3.12`
  - `uv venv --python 3.12`
  - `source .venv/bin/activate`
  - `uv pip install -r requirements-rag-crawler.txt`
  - 说明：已支持 PDF 文本抽取（`pypdf`）
- 准备配置：
  - `cp configs/official_principle_sources.example.yaml configs/official_principle_sources.yaml`
  - 按需修改 `seed_urls`、`allowed_domains`、`include_path_keywords`
  - 当前推荐策略：
    - 只保留官方单页、单 PDF、单工具页白名单
    - 保持 `follow_links: false`
    - 优先主题：`Buck/Boost/LDO/EMI/PFC/LLC`，再补 `ADC/current sense/shunt/op amp`、`gate driver/soft switching/resonant`
- 运行爬虫并导出任务 JSONL：
  - 若当前目录是仓库根目录：
    - `python scripts/server/rag_knowledge_crawler.py --config scripts/server/configs/official_principle_sources.yaml --output results/knowledge_import_tasks.jsonl`
  - 若当前目录是 `scripts/server`：
    - `python rag_knowledge_crawler.py --config configs/official_principle_sources.yaml --output ../../results/knowledge_import_tasks.jsonl`
  - 默认会打印抓取全过程日志；如需静默执行，追加 `--quiet`
  - 抓取结束后会自动执行：
    - 跨文件正文去重
    - 删除低价值主题文件（support/sales/supplier/distributor/company-contacts 等）
    - 清理去重后空文件
    - 生成 `results/crawl_report.json`（包含 PDF 来源占比、主题分布、厂商分布、清洗统计）
  - 建议：若要提升“电路原理知识”密度，优先在 `seed_urls` 中加入应用笔记/设计指南入口与 PDF 链接页
  - 2026-04-25 多厂商白名单补充结果：
    - 成功抓取并适合继续导入：
      - `TI PDF / TI training / onsemi tool pages / NXP PDF`
    - 当前访问受阻或质量不达标：
      - `ADI`：站点超时
      - `ST`：站点超时
      - `Infineon`：产品页低价值或 URL 失效
- 产物用途：
  - 实际会按 `厂商_主题` 分文件输出到 `results/`，例如：
    - `ti.com_power-management.jsonl`
    - `ti.com_interface.jsonl`
    - `onsemi.com_support.jsonl`
  - 每行都是一个 `POST /api/v1/knowledge/import-tasks` 请求体。
  - `knowledge_import_tasks.jsonl` 可能是旧版本脚本遗留文件，可按需清理。
  - 当前一批已验证产物：
    - 原始导入任务：`results/official_curated_import_20260425/`
    - RAGFlow 导入格式：`results/official_curated_ragflow_import_20260425/`

## 数据处理流水线
- 一键执行（抓取 + 质量校验 + 双目标格式转换）：
  - `./run_pipeline.sh`
  - 或指定配置：`./run_pipeline.sh configs/official_principle_sources.yaml`
- 脚本说明：
  - `validate_batch.py`：输出每个 JSONL 的质量指标（内容长度、可追溯率、标签率）
  - `transform_for_internal.py`：转换为服务端 `POST /api/v1/knowledge/import-tasks` 可直接消费格式
  - `transform_for_ragflow.py`：转换为 RAGFlow 导入友好格式（`title/content/metadata`）
  - `ragflow_importer.py`：将 `results/ragflow_import/*.jsonl` 批量导入 RAGFlow（支持重试、失败日志、dry-run）
- 产物目录：
  - `results/`：抓取分文件
  - `results/internal_import/`：服务端导入格式
  - `results/ragflow_import/`：RAGFlow 导入格式

## 嘉立创开源模板管线
- 目标：
  - 抓取嘉立创开源项目详情，优先定位原理图/工程文件。
  - 从项目记录中抽取 `external_rag_template_corpus` 兼容模板。
  - 将模板转换成可导入 RAGFlow 的独立 dataset 记录。
- 脚本说明：
  - `lceda_open_source_crawler.py`：抓取项目列表/详情并输出标准化项目 JSONL。
  - `extract_lceda_templates.py`：从项目 JSONL 抽取模板 JSONL。
  - `transform_lceda_templates_for_ragflow.py`：将模板 JSONL 转成 RAGFlow 导入 JSONL。
  - `evaluate_lceda_template_extraction.py`：对项目 JSONL 直接跑抽取评估，输出模板分布与风险计数。
- 推荐输出目录：
  - `results/lceda_open_source_raw/`
  - `results/lceda_template_corpus/`
  - `results/lceda_ragflow_import/`
- 最小运行示例：
  - 抓取项目记录：
    - `python scripts/server/lceda_open_source_crawler.py --entry-url https://oshwhub.com/explore --category mcu_devboard --keyword ESP32 --output results/lceda_open_source_raw/esp32_projects.jsonl --file-output-dir results/lceda_open_source_raw/files`
  - 抽取模板语料：
    - `python scripts/server/extract_lceda_templates.py --input results/lceda_open_source_raw/esp32_projects.jsonl --output results/lceda_template_corpus/esp32_templates.jsonl`
  - 转换为 RAGFlow 导入格式：
    - `python scripts/server/transform_lceda_templates_for_ragflow.py --input results/lceda_template_corpus/esp32_templates.jsonl --output results/lceda_ragflow_import/esp32_templates.jsonl`
- 文件优先说明：
  - 抓取器识别到原理图/工程文件 URL 时，可用 `--file-output-dir` 保存到项目 ID 子目录。
  - 项目记录中的 `schematic_file_path` 会指向本地文件，抽取器会读取文本型文件内容参与模板识别。
  - `.zip` 文件会扫描内部 `.json/.epro/.esch/.sch` 文本型工程文件，忽略图片等二进制资源。
  - 若单个附件下载返回 `404/4xx/5xx`，抓取器当前会记录告警并自动降级为 `text_fallback`，不会中断整批任务。
- 批量评估示例：
  - `python scripts/server/evaluate_lceda_template_extraction.py --input results/lceda_open_source_raw/sample_projects.jsonl --input results/lceda_open_source_raw/hmtang_schematic1.jsonl --output results/lceda_template_corpus/eval_summary.json`
  - 输出会包含：
    - `template_type_counts`
    - `source_mode_counts`
    - `risk_counts.battery_templates_without_bms_context`
    - `project_reports[*].template_types`
    - `project_reports[*].risk_flags`
- 当前首版抽取范围：
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

## 导入到 RAGFlow
进入脚本目录并激活环境
```
cd /Users/oyzm/workspace5/agents/lceda_ai/scripts/server
source .venv/bin/activate
```
把 results/*.jsonl 转成 RAGFlow 导入格式
```
python transform_for_ragflow.py \
  --input ../../results \
  --output ../../results/ragflow_import
```
先 dry-run 检查（不真正写入）
```
python ragflow_importer.py \
  --input ../../results/ragflow_import \
  --base-url http://127.0.0.1:39380 \
  --api-key ragflow-g8zpcvPSSi0lLtkDvaa9_940ZjJbOg1lu8qYw2rHY3k \
  --dataset-id 6bd834b4342911f185870d318ee3a4a1 \
  --dry-run
  ```
正式导入
```
python ragflow_importer.py \
  --input ../../results/ragflow_import \
  --base-url http://127.0.0.1:39380 \
  --api-key ragflow-g8zpcvPSSi0lLtkDvaa9_940ZjJbOg1lu8qYw2rHY3k \
  --dataset-id 6bd834b4342911f185870d318ee3a4a1 \
  --retries 3 \
  --retry-backoff-seconds 0.8 \
  --failed-log ../../results/ragflow_failed_rows.jsonl
  ```
导入后去 RAGFlow 知识库页面点“解析/重建索引”（如果界面提示需要），然后再做检索测试。
