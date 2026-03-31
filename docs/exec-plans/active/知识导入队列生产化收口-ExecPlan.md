# 知识导入队列生产化收口（Redis Stream 参数化与观测增强）

本 ExecPlan 是一份活文档。"进度"、"意外发现"、"决策日志"和"成果与复盘"章节会随实施持续更新。本文档遵循 [PLANS.md](/Users/oyzm/workspace5/agents/lceda_ai/PLANS.md)。

## 目的 / 全局视角

当前知识导入任务已经具备异步队列、自动重试、死信记录、重试恢复和幂等去重，但 Redis Stream 的消费参数和回执观测仍偏固定值。完成本任务后，服务端可按配置控制 `block timeout / claim min idle / lock ttl / queue mode`，并可通过统计接口直接观察 ack 成功与失败，便于在多实例环境下做稳定性调优。

## 进度

- [x] (2026-03-25 15:20Z) 创建 ExecPlan 文档并确认收口范围。
- [x] (2026-03-25 15:34Z) 为导入任务队列增加可配置项（queue mode、stream/group、claim/block、lock ttl）。
- [x] (2026-03-25 15:36Z) 为队列回执增加统计指标（ack_success_count、ack_error_count）。
- [x] (2026-03-25 15:40Z) 更新服务端接线、配置样例与文档说明。
- [x] (2026-03-25 15:43Z) 完成测试与 PoC 回归，更新执行跟踪。
- [x] (2026-03-25 15:49Z) 增加 stream 运行时观测指标（claimed/new/pending）。
- [x] (2026-03-25 15:53Z) 增加 stream claim 策略参数化（enabled/count/interval/min-idle）。
- [x] (2026-03-26 02:30Z) 增加 ack 重试策略参数化（retry count/interval）与重试观测指标。
- [x] (2026-03-26 09:10Z) 完成文档收口与回归验证（go test/tsc/poc:draft）。
- [x] (2026-03-26 09:22Z) 增加任务执行重试策略参数化（task max attempts/retry delay）并接入主服务配置。
- [x] (2026-03-26 09:35Z) 增加任务执行退避模式（fixed/exponential）与重试上限延迟配置。
- [x] (2026-03-26 09:45Z) 修复退避策略引入的锁重入死锁并完成回归验证。
- [x] (2026-03-26 09:55Z) 增加重投治理观测指标（重试延迟与退避命中统计）并完成测试。
- [x] (2026-03-26 10:08Z) 收紧 `:retry` 语义为仅允许死信任务重试，并补充拒绝计数与错误码。

## 意外发现

- 观察：当前 `processOneAttempt` 的返回布尔值语义是“任务是否存在/可返回”，不是“是否已真正处理”，因此 worker 对 ack 的时机要谨慎。
  证据：`import_task_service.go` 中 `processOneAttempt` 在锁冲突时仍返回 `task, true`。
- 观察：在失败分支持有 `s.mu.Lock` 时调用会二次加读锁的方法会导致死锁。
  证据：`go test ./...` 在 `internal/usecase/knowledge` 阶段挂住，修复为 locked/unlocked 两套延迟计算入口后恢复正常。

## 决策日志

- 决策：本次先做“参数化 + 可观测”收口，不在同一轮引入更重的消息重投编排重构。
  理由：当前链路已可运行，先补生产调参入口与稳定性指标，风险更低且收益直接。
  日期/作者：2026-03-25 / Codex
- 决策：保留 `computeRetryDelay`（外部可安全调用）并新增 `computeRetryDelayLocked`（持锁场景），避免锁重入。
  理由：最小改动即可修复死锁，同时保持测试与后续复用清晰。
  日期/作者：2026-03-26 / Codex

## 成果与复盘

本轮完成了导入队列“可调参与可观测”收口：Redis Stream 队列已参数化接线，任务锁 TTL 可配置，stats 新增 ack 成功/失败计数与 ack 重试计数，ack 失败支持重试策略配置。`go test`、`tsc` 与 `poc:draft` 均通过，说明改动未破坏主链路。剩余缺口主要是更深层生产能力（例如多副本高可用与重投治理策略），不属于本轮实现范围。

## 状态变更
- 说明：主线已切换到“登录注册闭环 -> 插件真实宿主 -> LLM 透传”，本 ExecPlan 暂停更新，后续如需继续知识导入收口再恢复维护。

## 上下文与导航

任务主要涉及以下文件：

- 服务端队列实现：
  - `server/internal/usecase/knowledge/import_task_queue.go`
  - `server/internal/usecase/knowledge/import_task_queue_redis_stream.go`
  - `server/internal/usecase/knowledge/import_task_queue_redis.go`
- 服务端任务编排：
  - `server/internal/usecase/knowledge/import_task_service.go`
  - `server/internal/usecase/knowledge/import_task_locker.go`
  - `server/internal/usecase/knowledge/import_task_locker_redis.go`
- 服务启动与配置：
  - `server/cmd/main.go`
  - `server/internal/app/config.go`
  - `server/configs/config.yaml`
- 设计与执行文档：
  - `docs/design-docs/服务端API接口设计文档.md`
  - `docs/exec-plans/active/当前执行跟踪.md`
  - `docs/exec-plans/总体实施计划.md`

术语说明：

- `Redis Stream`：Redis 的日志型消息结构，支持消费组和显式 ack。
- `Consumer Group`：消费组，保证同组内消息分发并维护 pending 状态。
- `Ack`：消息确认，确认后该消息不会再被同消费组重复消费。
- `Claim`：认领 pending 消息，把长时间未处理的消息转移给当前 consumer。

## 工作计划

先在配置层新增导入任务队列参数，保证部署时可调。然后改造 Stream 队列构造函数接受参数对象，移除硬编码超时。接着在任务服务增加 ack 成功/失败统计项，并在 worker ack 逻辑中更新计数。最后更新主服务接线与文档，再执行 `go test`、`tsc` 和 PoC 脚本确认无回归。

## 具体步骤

在仓库根目录执行：

    cd server
    GOCACHE=/tmp/go-build go test ./...

在插件目录执行：

    cd ../plugin
    npx tsc --noEmit
    BASE_URL=http://127.0.0.1:18093 POC_USE_FAKE_HOST=1 npm run poc:draft

## 验证与验收

验收标准：

- 服务端可通过配置切换或调整导入队列策略，无需改代码。
- `/api/v1/knowledge/import-tasks/stats` 返回新增 ack 统计字段。
- 现有登录、草案 PoC 不受影响，`poc:draft` 继续通过。
- `go test ./...` 全量通过。

## 幂等性与恢复

所有改动为增量修改，支持重复执行。配置新增字段均有默认值；未配置时保持当前行为。若配置错误，可删除新增环境变量并回到默认参数。无破坏性数据库迁移。

## 产出物与备注

实际产出：

- 配置结构新增导入队列参数：
  - `knowledge.queue_mode`
  - `knowledge.queue_stream`
  - `knowledge.queue_group`
  - `knowledge.queue_block_ms`
  - `knowledge.queue_claim_idle_ms`
  - `knowledge.task_lock_ttl_ms`
  - `knowledge.queue_claim_enabled`
  - `knowledge.queue_claim_count`
  - `knowledge.queue_claim_interval_ms`
- `RedisStreamImportTaskQueue` 支持 options 参数化构造。
- stats 新增 ack 维度：
  - `ack_success_count`
  - `ack_error_count`
  - `ack_retry_count`
  - `ack_retry_exhausted_count`
- 配置新增 ack 重试参数：
  - `knowledge.ack_retry_count`
  - `knowledge.ack_retry_interval_ms`
- 配置新增任务执行重试参数：
  - `knowledge.task_max_attempts`
  - `knowledge.task_retry_delay_ms`
  - `knowledge.task_retry_backoff_mode`
  - `knowledge.task_retry_max_delay_ms`
- stats 新增 stream 运行维度：
  - `claimed_message_count`
  - `stream_message_count`
  - `queue_pending_count`
- stats 新增重投治理维度：
  - `retry_delay_last_ms`
  - `retry_delay_total_ms`
  - `retry_backoff_fixed_count`
  - `retry_backoff_exponential_count`
  - `manual_retry_rejected_count`
- `:retry` 行为收口：
  - 仅允许死信任务（`failed && attempts>=max_attempts`）执行
  - 非死信任务返回 `409001`
- 文档已同步更新到 README、API 设计文档、计划与执行跟踪。

## 接口与依赖

本次不新增外部 HTTP API；仅扩展已有 stats 输出字段。依赖保持 `github.com/redis/go-redis/v9`。
