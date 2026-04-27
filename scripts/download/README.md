# scripts/download

## 作用
- 从嘉立创开源中下载原理图存放本地开发的辅助脚本（含 Playwright 自动下载 oshwhub 原理图）。
- 导出动作基于编辑器菜单：`文件 -> 另存为 -> 工程另存为(本地)(A)…`。
- 每个工程导出后会关闭当前详情/设计图页，再进入下一个工程，直到全部处理完成。

## 启动下载命令
在仓库根目录执行：

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai
node scripts/download/oshwhub-download-schematics.mjs \
  --keyword="ESP32" \
  --download-dir="./results/lceda_open_source_raw/files" \
  --max-items=5 \
  --headless=false
```

## 登录流程（先执行一次）
首次建议先准备登录态（会打开浏览器，手动登录后回终端按 Enter）：

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai
node scripts/download/oshwhub-download-schematics.mjs \
  --prepare-login=true \
  --login-only=true \
  --storage-state="./results/playwright/oshwhub-storage-state.json" \
  --user-data-dir="./results/playwright/chromium-user-data"
```

后续下载会自动复用登录态：

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai
node scripts/download/oshwhub-download-schematics.mjs \
  --keyword="ESP32" \
  --download-dir="./results/lceda_open_source_raw/files" \
  --max-items=5 \
  --headless=false \
  --editor-ready-wait-ms=30000 \
  --storage-state="./results/playwright/oshwhub-storage-state.json" \
  --user-data-dir="./results/playwright/chromium-user-data"
```

如遇“看起来已登录但接口仍提示未登录”，先清理用户目录并重新登录一次：

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai
rm -rf ./results/playwright/chromium-user-data
```

参数说明：
- `--keyword`：搜索关键词。
- `--download-dir`：统一下载目录。
- `--max-items`：最多处理的项目数。
- `--headless=false`：建议可视化运行，便于登录和观察页面行为。
- `--prepare-login=true`：进入登录准备模式并保存登录态。
- `--login-only=true`：只做登录，不执行下载。
- `--storage-state`：登录态文件路径（cookies/session 持久化）。
- `--user-data-dir`：Chromium 持久化用户目录（优先保留完整会话）。
- `--editor-ready-wait-ms`：进入编辑器后的额外等待毫秒数，用于等待登录态同步。

## 下载后导入 RAGFlow 命令
1) 从已下载项目记录中抽取模板：

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai
python scripts/server/extract_lceda_templates.py \
  --input results/lceda_open_source_raw/esp32_projects.jsonl \
  --output results/lceda_template_corpus/esp32_templates.jsonl
```

2) 转换为 RAGFlow 导入格式：

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai
python scripts/server/transform_lceda_templates_for_ragflow.py \
  --input results/lceda_template_corpus/esp32_templates.jsonl \
  --output results/lceda_ragflow_import/esp32_templates.jsonl
```

3) dry-run 检查：

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai/scripts/server
source .venv/bin/activate
python ragflow_importer.py \
  --input ../../results/lceda_ragflow_import \
  --base-url http://127.0.0.1:39380 \
  --api-key <RAGFLOW_API_KEY> \
  --dataset-id <RAGFLOW_DATASET_ID> \
  --dry-run
```

4) 正式导入：

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai/scripts/server
source .venv/bin/activate
python ragflow_importer.py \
  --input ../../results/lceda_ragflow_import \
  --base-url http://127.0.0.1:39380 \
  --api-key <RAGFLOW_API_KEY> \
  --dataset-id <RAGFLOW_DATASET_ID> \
  --replace-existing-by-title \
  --retries 3 \
  --retry-backoff-seconds 0.8 \
  --failed-log ../../results/ragflow_failed_rows.jsonl
```

说明：
- `--replace-existing-by-title` 现在实际按 `metadata.idempotency_key/source_ref` 优先生成文件名并覆盖旧文档。
- 同一条模板再次导入时会先删除旧文档，再上传新文档，避免数据集里持续累积旧版本。

## 本地 files 一键导入 RAGFlow
如果你已经把 `.epro2` 下载到了 `results/lceda_open_source_raw/files/`，可以直接执行：

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai
bash scripts/download/import-local-files-to-ragflow.sh \
  --base-url http://127.0.0.1:39380 \
  --api-key <RAGFLOW_API_KEY> \
  --dataset-id <RAGFLOW_DATASET_ID>
```

脚本会自动执行：
- 扫描 `results/lceda_open_source_raw/files/*.epro2`
- 生成 `files_import_manifest.jsonl`
- 抽取模板语料
- 转换为 RAGFlow 导入 JSONL
- 调用 importer 上传并触发解析

只验证不上传：

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai
bash scripts/download/import-local-files-to-ragflow.sh --dry-run
```

## 导入前审计现有覆盖关系
如果要先检查这批 JSONL 会覆盖掉哪些现有文档，可执行：

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai
python scripts/server/ragflow_audit_existing_docs.py \
  --input results/lceda_ragflow_import/files_import_manifest.templates.v7.jsonl \
  --base-url http://127.0.0.1:39380 \
  --api-key <RAGFLOW_API_KEY> \
  --dataset-id <RAGFLOW_DATASET_ID>
```
