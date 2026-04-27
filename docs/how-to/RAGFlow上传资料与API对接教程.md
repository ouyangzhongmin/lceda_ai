# RAGFlow 上传资料与 API 对接教程

## 1. 目标
- 将抓取清洗后的知识数据上传到 RAGFlow。
- 让当前服务端 `/api/v1/rag/search` 走 RAGFlow 检索。
- 保持插件侧接口不变。

## 2. 前置条件
- RAGFlow 已启动（你当前已启动成功）。
- 已拿到：
  - `RAGFLOW_API_KEY`
  - `RAGFLOW_DATASET_ID`
- 已有抓取脚本产物目录：`results/ragflow_import/`（每行 `title/content/metadata`）。

## 3. 生成上传资料（抓取 + 清洗 + 转换）
在仓库执行：

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai/scripts/server
./run_pipeline.sh
```

关键产物：
- 抓取分文件：`/Users/oyzm/workspace5/agents/lceda_ai/results/*.jsonl`
- 服务端导入格式：`/Users/oyzm/workspace5/agents/lceda_ai/results/internal_import/*.jsonl`
- RAGFlow 导入格式：`/Users/oyzm/workspace5/agents/lceda_ai/results/ragflow_import/*.jsonl`
- 报告：`/Users/oyzm/workspace5/agents/lceda_ai/results/crawl_report.json`

## 4. 上传资料到 RAGFlow
### 4.1 dry-run 先验量
```bash
cd /Users/oyzm/workspace5/agents/lceda_ai/scripts/server
python ragflow_importer.py \
  --input ../../results/ragflow_import \
  --base-url http://127.0.0.1:39380 \
  --api-key <RAGFLOW_API_KEY> \
  --dataset-id <RAGFLOW_DATASET_ID> \
  --dry-run
```

### 4.2 正式上传（含重试+失败日志）
```bash
cd /Users/oyzm/workspace5/agents/lceda_ai/scripts/server
python ragflow_importer.py \
  --input ../../results/ragflow_import \
  --base-url http://127.0.0.1:39380 \
  --api-key <RAGFLOW_API_KEY> \
  --dataset-id <RAGFLOW_DATASET_ID> \
  --retries 3 \
  --retry-backoff-seconds 0.8 \
  --failed-log ../../results/ragflow_failed_rows.jsonl
```

成功后会输出统计 JSON：
- `files`
- `rows`
- `success`
- `fail`
- `retry`

## 5. 启用当前服务端对接 RAGFlow
编辑配置文件：
`/Users/oyzm/workspace5/agents/lceda_ai/server/configs/config.yaml`

```yaml
ragflow:
  enabled: true
  base_url: "http://127.0.0.1:39380"
  api_key: "<RAGFLOW_API_KEY>"
  dataset_id: "<RAGFLOW_DATASET_ID>"
  endpoint_template: "/api/v1/retrieval"
  timeout_seconds: 12
```

然后重启服务端（示例）：
```bash
cd /Users/oyzm/workspace5/agents/lceda_ai/server
APP_CONFIG=./configs/config.yaml PORT=18082 go run ./cmd
```

## 6. 对接验证
### 6.1 看当前 provider
```bash
curl http://127.0.0.1:18082/api/v1/rag/providers
```
期望：`provider` 为 `ragflow`。

### 6.2 调检索接口
```bash
curl -X POST http://127.0.0.1:18082/api/v1/rag/search \
  -H 'content-type: application/json' \
  -d '{"query":"LDO 输入输出电容怎么选","top_k":5}'
```

### 6.3 构建引用包
```bash
curl -X POST http://127.0.0.1:18082/api/v1/rag/citations:build \
  -H 'content-type: application/json' \
  -d '{"query":"Buck 开关电源纹波如何优化","top_k":5}'
```

## 7. 常见问题
- `entrypoint.sh: permission denied`
  - 执行：`chmod +x server/deploy/ragflow/entrypoint.sh`
- `cp: cannot stat ... ragflow.conf.python`
  - 已在本项目 `entrypoint.sh` 做兼容，不会阻断启动。
- 上传失败行排查
  - 查看：`/Users/oyzm/workspace5/agents/lceda_ai/results/ragflow_failed_rows.jsonl`
  - 再次跑 importer 可重试。

## 8. 建议运行顺序
1. `./run_pipeline.sh`
2. `ragflow_importer.py --dry-run`
3. `ragflow_importer.py` 正式上传
4. `config.yaml` 打开 `ragflow.enabled`
5. `curl /api/v1/rag/providers`
6. `curl /api/v1/rag/search`
