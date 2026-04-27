# 2026-04-24 RAGFlow + LCEDA 开发进度归档

## 归档时间
- 2026-04-24 23:28:55 CST

## 本轮目标
- 清理并重建嘉立创原理图与官方电路知识的 RAG 入库链路。
- 提升 LCEDA 组合模板检索效果，保证 `ESP32-S3 + GPIO/电阻/电容/VCC` 这类组合不被打散。
- 为原则类查询增加官方知识支持，并避免污染 LCEDA 模板检索。

## 已完成事项

### 1. 嘉立创开源原理图下载链路
- 下载脚本目录已调整到 `scripts/download/`。
- Playwright 下载流程已整理为：
  - 搜索项目
  - 进入详情
  - 点击“打设计图”
  - 在设计图页执行 `文件(F) -> 另存为 -> 工程另存为(本地)(A)… -> 确认`
  - 下载完成后关闭本次打开的设计图页和详情页，再进入下一个项目
- 增加了本地已存在文件跳过逻辑，已存在文件不会计入当次待处理条目。
- 登录流程已接入持久化浏览器数据目录和 storage state，用于规避频繁重新登录。

### 2. LCEDA `.epro2` 解析与模板抽取
- 已确认 `.epro2` 可以作为嘉立创原理图工程包输入，能够提取出原理图相关结构化信息。
- 已完成 LCEDA 模板抽取主链路，实现方向包括：
  - 器件组合抽取
  - 连接链抽取
  - 组合模板去重
  - 基于质量和器件可搜索性的打分
- 检索目标已围绕“组合不散”设计，例如：
  - `ESP32-S3` + `GPIO` + `上拉/下拉电阻` + `去耦/储能电容` + `VCC`
- 相关脚本已落地在：
  - [extract_lceda_templates.py](/Users/oyzm/workspace5/agents/lceda_ai/scripts/server/extract_lceda_templates.py)
  - [transform_lceda_templates_for_ragflow.py](/Users/oyzm/workspace5/agents/lceda_ai/scripts/server/transform_lceda_templates_for_ragflow.py)
  - [evaluate_lceda_template_extraction.py](/Users/oyzm/workspace5/agents/lceda_ai/scripts/server/evaluate_lceda_template_extraction.py)

### 3. LCEDA 模板打分与重排
- 已实现模板质量评分与检索优先级评分，重点信号包括：
  - `real_connection_chains`
  - `lcsc_searchable_components`
  - `multi_component_context`
  - `source_project_traceable`
  - `anchor_model_detected`
- 已实现组合模板和精确模板的混合重排，避免“项目组合总是压过精确连接模板”的问题。
- 已补充多组 Go 单测，覆盖：
  - reset chain
  - I2C pull-up
  - 普通 power/passive query
  - combo vs precise template
- 关键文件：
  - [service.go](/Users/oyzm/workspace5/agents/lceda_ai/server/internal/usecase/rag/service.go)
  - [service_test.go](/Users/oyzm/workspace5/agents/lceda_ai/server/internal/usecase/rag/service_test.go)

### 4. 官方电路知识抓取清理
- 已确认旧官方知识抓取结果垃圾率过高，主要问题包括：
  - 目录页
  - 资源索引页
  - webinar / seminar / registration 页面
  - 技术文档列表页
  - block diagram / navigation 页面
- 已将旧官方知识结果做归档，不建议直接重导。
- 当前官方知识抓取已切换为严格白名单模式，仅抓单文章/单 PDF：
  - TI training
  - TI application report PDF
  - onsemi current sense tool
- 已新增 `follow_links: false`，避免继续沿页面扩散抓出低质量链接。
- 已补充页面低价值识别和尾部噪声截断规则。
- 关键文件：
  - [official_principle_sources.yaml](/Users/oyzm/workspace5/agents/lceda_ai/scripts/server/configs/official_principle_sources.yaml)
  - [rag_knowledge_crawler.py](/Users/oyzm/workspace5/agents/lceda_ai/scripts/server/rag_knowledge_crawler.py)
  - [test_rag_knowledge_crawler.py](/Users/oyzm/workspace5/agents/lceda_ai/scripts/server/tests/test_rag_knowledge_crawler.py)

### 5. 官方知识导入 RAGFlow
- 已安装 `pypdf`，恢复 PDF 抽取。
- 已筛选出高质量官方知识子集并导入 RAGFlow：
  - 2 条 TI PDF
  - 5 条 TI training
  - 1 条 onsemi current sense tool
- 导入使用脚本：
  - [ragflow_importer.py](/Users/oyzm/workspace5/agents/lceda_ai/scripts/server/ragflow_importer.py)
- 导入目录：
  - [official_curated_import_20260424](/Users/oyzm/workspace5/agents/lceda_ai/results/official_curated_import_20260424)
- 导入结果：
  - `files=8`
  - `rows=8`
  - `success=8`
  - `fail=0`

### 6. 原则类查询重排增强
- 已发现并修复问题：
  - `current sense` 查询时，之前会被 `temperature_sense` 模板错误挤到前面。
- 已增加“原则类查询”意图识别，主要覆盖：
  - `EMI`
  - `current sense`
  - `shunt`
  - `buck converter`
  - `boost converter`
  - `PFC`
  - `LLC`
  - `AC/DC`
  - `DC/DC`
- 对原则类查询已增加：
  - 官方知识加权
  - 温度感测类错配模板降权
  - 非原则普通模板在 `EMI` 等查询下的降权
- 已补充测试：
  - 官方 `current sense` 文档应优先于 `temperature_sense`
  - 官方 `EMI` 文档应优先于普通 power template

## 本轮实际检索验证结论

### 已验证通过
- `EMI`
  - Top 1 为 TI PDF `snva489c`
- `series capacitor buck converter`
  - Top 1 为 TI training `design-of-a-high-frequency-series-capacitor-buck-converter`
- `esp32-s3`
  - Top 5 仍为 LCEDA `component_combo_bundle`，说明模板侧主链路没有被官方知识污染
- `current sense`
  - 修复前：Top 1-2 曾被 `temperature_sense` 模板挤占
  - 修复后：Top 1-3 已变成 `www.onsemi.com-current-sense-design-tool-360cb8d39b.md`

## 当前关键输出目录
- 原始下载文件：
  - `results/lceda_open_source_raw/files/`
- 当前官方知识抓取结果：
  - `results/*.jsonl`
- 官方知识导入包：
  - [official_curated_import_20260424](/Users/oyzm/workspace5/agents/lceda_ai/results/official_curated_import_20260424)
- 抓取报告：
  - [crawl_report.json](/Users/oyzm/workspace5/agents/lceda_ai/results/crawl_report.json)

## 当前未完成 / 待继续事项
1. 官方知识多厂商扩展仍有剩余缺口
- 已于 2026-04-25 完成：
  - `onsemi.com_elite-power-simulator.jsonl` 清洗收口
  - `onsemi.com_self-service-plecs-model-generator.jsonl` 清洗收口
  - 新增 `NXP` 官方 PDF 2 篇并产出新的导入包
- 仍待继续：
  - `ADI` 官方单页在当前环境下请求超时
  - `ST` 官方 PDF 在当前环境下请求超时
  - `Infineon` 当前候选页质量不足或链接失效，需要更换更强的单 PDF 白名单

2. 原则类关键词规则可继续扩展
- 可继续覆盖：
  - `LDO`
  - `ADC`
  - `current shunt`
  - `gate driver`
  - `soft switching`
  - `resonant`

3. 建议补一套固定检索基准
- 当前还没有完整自动化基准集
- 建议后续整理如下查询用于回归：
  - `esp32-s3`
  - `esp32-s3 reset`
  - `I2C 上拉电阻`
  - `EMI`
  - `current sense`
  - `buck converter`
  - `LLC`
  - `PFC`

## 2026-04-25 续作补充

### 本轮目标
- 延续 2026-04-24 收尾项，继续清洗官方电路知识并补抓一批高质量白名单资料。
- 目标优先级：
  - 电源设计
  - 信号链/采样
  - 驱动/谐振

### 本轮已完成
- 更新官方知识白名单配置，扩展厂商范围到：
  - `TI`
  - `onsemi`
  - `NXP`
  - 并预留 `ADI / ST / Infineon` 白名单入口
- 调整白名单路径过滤，移除会误伤多厂商文档页的过宽规则：
  - `exclude_path_keywords` 中不再使用通配过宽的 `/resource`
  - `exclude_path_keywords` 中不再使用通配过宽的 `/products`
- 完成 onsemi 工具页清洗收口：
  - `Elite Power Simulator`
  - `Self-Service PLECS Model Generator`
  - 对营销/资源尾部进行了截断，保留设计与仿真原理相关正文
- 实际重新抓取官方知识并产出新目录：
  - 原始导入任务目录：`results/official_curated_import_20260425/`
  - RAGFlow 导入格式目录：`results/official_curated_ragflow_import_20260425/`
- 新一轮抓取成功结果：
  - `files=10`
  - `rows=12`
  - `pdf_source_count=4`
  - `pdf_source_rate=33.33%`
- dry-run 导入验证通过：
  - `files=10`
  - `rows=12`
  - `success=12`
  - `fail=0`
- 已正式导入现有 `lceda` dataset：
  - `dataset_id=6bd834b4342911f185870d318ee3a4a1`
  - 上传结果：`files=10 rows=12 success=12 fail=0 deleted=8`
  - 已对现有文档触发重新解析：`docs=510 submitted_batches=26`

### 本轮新增知识覆盖
- `TI`
  - `EMI`
  - `I2C pull-up`
  - `series capacitor buck`
  - `PFC + LLC`
  - `高功率 AC/DC`
- `onsemi`
  - `current sense`
  - `power simulation`
  - `PLECS model generation`
- `NXP`
  - `AN5381`
  - `AN12617`

### 本轮失败与原因
- `ADI`
  - 官方站点在当前执行环境下多次 `read timeout`
- `ST`
  - 官方站点在当前执行环境下多次 `read timeout`
- `Infineon`
  - 一个候选产品页被判为低价值页
  - 一个候选 URL 返回 `404`

### 当前建议交接点
1. 先将 `results/official_curated_ragflow_import_20260425/` 导入 RAGFlow 并重建索引。
2. 用以下查询做一轮人工回归：
   - `EMI`
   - `current sense`
   - `buck converter`
   - `PFC`
   - `LLC`
   - `gate driver`
   - `resonant`
3. 下一轮新增官方知识时，优先替换成可稳定访问的 `ADI / ST / Infineon` 单 PDF，而不是目录页或产品页。

### 2026-04-25 检索接线校正
- 已确认本地 RAGFlow v0.24.0 实际检索端点为：
  - `/api/v1/retrieval`
- 已确认旧文档/默认值中的：
  - `/api/v1/datasets/{dataset_id}/search`
  - 对当前本地实例返回 `404`
- 已完成修正：
  - `server/internal/app/config.go` 默认 `RAGFLOW_ENDPOINT_TEMPLATE` 改为 `/api/v1/retrieval`
  - `server/README.md` 与 `docs/how-to/RAGFlow上传资料与API对接教程.md` 已同步
- 现场验证：
  - `POST /api/v1/retrieval` + `dataset_ids` 可直接返回 `EMI`、`current sense` 等检索结果

### 2026-04-25 检索结果元数据兜底补强
- 已补充 RAGFlow chunk 结果的第三层元数据兜底：
  - 第一层：直接解析 chunk 正文尾部的 markdown footer metadata
  - 第二层：同一检索响应内，按 `document_id` / 文档标题回填同文档 chunk 的 metadata
  - 第三层：当整份文档返回的 chunk 都没有 footer metadata 时，从文档标题推断：
    - `source_ref`：取文档标题去掉 `.md` 后的 stem
    - `kb_type`：按标题模式推断 `principle / template / open_source`
- 已补充 Go 单测：
  - `TestProviderSearchInfersChunkMetadataFromDocumentTitle`
- 代码侧验证结果：
  - `GOCACHE=/tmp/go-build go test ./internal/repository/ragflow`
  - `GOCACHE=/tmp/go-build go test ./internal/app ./internal/repository/ragflow`
  - 均已通过

### 2026-04-25 运行态阻塞点
- 当前本地 Go 服务 `http://127.0.0.1:28080/healthz` 可正常返回：
  - `{"code":0,"data":{"service":"lceda-ai-server"},"message":"ok"}`
- 当前本地 RAGFlow 管理端可正常返回：
  - `GET /api/v1/admin/ping -> PONG`
- 但当前 RAGFlow 检索链路仍不稳定：
  - `POST /api/v1/rag/search` 对 `EMI` / `current sense` 都返回上游 `http://127.0.0.1:39380/api/v1/retrieval` 超时
  - 直接请求 `/api/v1/retrieval` 也未拿到可用返回
- 已从容器日志确认当前阻塞更偏向本地 RAGFlow 部署异常，而不是服务端 Go 代码：
  - `valkey.exceptions.ConnectionError: Error -2 connecting to redis:6379. Name or service not known.`
  - `watchdog` 持续报告 `ragflow_server unhealthy`
- 因此本轮已完成：
  - 代码修复
  - 单测验证
  - 服务联通性验证
- 但尚未完成：
  - 基于当前运行态的 `EMI/snva489c` 真机返回结果再次核验
  - 插件真实宿主联调回归

### 2026-04-25 运行态恢复与回归验证
- 已进一步排查本地 RAGFlow 运行态异常，确认不是 Go 服务代码配置错误：
  - `ragflow-cpu` / `task-executor` 容器内当前均可正确解析 `redis`
  - `service_conf.yaml` 内 Redis 配置为 `redis:6379`
- 根因更接近：
  - 依赖容器重建窗口内，`ragflow-cpu` 主服务进入异常状态
  - `39380` 主 API 端口一度出现 `connection reset by peer`
  - 管理端 `39381` 仍可返回 `PONG`
- 已通过重启 `ragflow-cpu` 与 `task-executor` 恢复主链路。
- 恢复后现场验证结果：
  - `GET http://127.0.0.1:38080/v1/system/version` 返回 `401`
    - 说明 web proxy + 主 API 已正常接收请求
  - `POST http://127.0.0.1:38080/api/v1/retrieval` 对 `EMI` 可正常返回检索结果
  - `POST http://127.0.0.1:28080/api/v1/rag/search` 对 `EMI` 已正常返回
  - `POST http://127.0.0.1:28080/api/v1/rag/search` 对 `current sense` 已正常返回
- 本轮最关键验证结论：
  - `EMI` 查询中，`www.ti.com-snva489c-pdf-c53bd72bcd.md` 返回块现在已带有：
    - `source_ref = www.ti.com-snva489c-pdf-c53bd72bcd`
    - `kb_type = principle`
  - 说明新增的“按文档标题推断 metadata”兜底逻辑已经在真实服务响应中生效。
- 当前仍未完成项：
  - 插件真实宿主联调回归
  - 受限原因不是当前 RAG 检索链路，而是仓库当前仍未完成真实嘉立创宿主接线与宿主内浏览器验证

## 当前关键文件清单
- 下载：
  - `scripts/download/`
- LCEDA 抽取：
  - [extract_lceda_templates.py](/Users/oyzm/workspace5/agents/lceda_ai/scripts/server/extract_lceda_templates.py)
  - [transform_lceda_templates_for_ragflow.py](/Users/oyzm/workspace5/agents/lceda_ai/scripts/server/transform_lceda_templates_for_ragflow.py)
- 官方知识抓取：
  - [rag_knowledge_crawler.py](/Users/oyzm/workspace5/agents/lceda_ai/scripts/server/rag_knowledge_crawler.py)
  - [official_principle_sources.yaml](/Users/oyzm/workspace5/agents/lceda_ai/scripts/server/configs/official_principle_sources.yaml)
- RAGFlow 导入：
  - [ragflow_importer.py](/Users/oyzm/workspace5/agents/lceda_ai/scripts/server/ragflow_importer.py)
  - [ragflow_audit_existing_docs.py](/Users/oyzm/workspace5/agents/lceda_ai/scripts/server/ragflow_audit_existing_docs.py)
- Go 检索重排：
  - [service.go](/Users/oyzm/workspace5/agents/lceda_ai/server/internal/usecase/rag/service.go)
  - [service_test.go](/Users/oyzm/workspace5/agents/lceda_ai/server/internal/usecase/rag/service_test.go)

## 切换工具时的注意事项
- 当前工作区是脏的，存在大量与本轮工作无关的修改，不要整体回滚。
- 这次新增和重点改动主要集中在：
  - `scripts/download/`
  - `scripts/server/*`
  - `server/internal/usecase/rag/*`
  - `results/official_curated_import_20260424/`
- 若后续工具要继续接手，建议先只聚焦以上路径。
