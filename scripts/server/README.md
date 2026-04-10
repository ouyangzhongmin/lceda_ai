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
- 产物用途：
  - 实际会按 `厂商_主题` 分文件输出到 `results/`，例如：
    - `ti.com_power-management.jsonl`
    - `ti.com_interface.jsonl`
    - `onsemi.com_support.jsonl`
  - 每行都是一个 `POST /api/v1/knowledge/import-tasks` 请求体。
  - `knowledge_import_tasks.jsonl` 可能是旧版本脚本遗留文件，可按需清理。

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
