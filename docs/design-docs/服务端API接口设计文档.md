# 嘉立创 EDA AI 助手服务端 API 接口设计文档

## 1. 文档信息
- 文档版本：v0.1
- 创建日期：2026-03-24
- 关联文档：`需求文档.md`
- 关联文档：`ARCHITECTURE.md`

## 2. 设计目标
本接口文档用于定义 Go 服务端的外部 API，服务于嘉立创 EDA 标准版与专业版插件。

设计目标：
- 支持浏览器登录 + 插件轮询登录状态。
- 支持邮箱验证码登录与微信扫码登录。
- 支持 Credits 模式调用。
- 支持 RAG 检索、LLM 代理、Agent 任务执行。
- 支持未来团队/租户能力扩展，但首版只面向个人用户。

## 3. 总体约定

### 3.1 协议与风格
- 协议：`HTTPS`
- 风格：`REST API + JSON`
- 编码：`UTF-8`
- 时间格式：`ISO 8601`
- 认证方式：`Bearer Token`

### 3.2 基础路径
- 建议统一前缀：`/api/v1`

### 3.3 通用响应结构
成功响应：

```json
{
  "code": 0,
  "message": "success",
  "request_id": "req_01hxxx",
  "data": {}
}
```

失败响应：

```json
{
  "code": 401001,
  "message": "invalid access token",
  "request_id": "req_01hxxx",
  "error": {
    "detail": "token expired"
  }
}
```

### 3.4 通用错误码
- 编码规则建议：
  - `0`：成功
  - `4xxxxx`：客户端请求或认证错误
  - `5xxxxx`：服务端内部或下游错误
- 建议错误码：
  - `0`：成功
  - `400000`：通用请求错误
  - `401000`：未认证
  - `401001`：访问令牌无效
  - `401002`：登录会话已过期
  - `401003`：验证码无效
  - `401004`：微信登录回调校验或 OAuth 失败
  - `403000`：无权限
  - `404000`：资源不存在
  - `409000`：资源冲突
  - `409001`：任务状态不允许执行重置重试
  - `429000`：请求过于频繁
  - `402001`：Credits 余额不足
  - `422001`：RAG 查询参数无效
  - `422002`：原理图上下文无效
  - `502001`：模型服务调用失败
  - `500000`：服务内部错误

## 4. 认证与登录接口

### 4.1 创建登录会话
- 方法：`POST`
- 路径：`/auth/login-sessions`
- 用途：插件申请浏览器登录会话

请求体：

```json
{
  "client_type": "lceda_plugin",
  "plugin_channel": "standard",
  "plugin_version": "0.1.0",
  "platform": "macos",
  "login_methods": ["email", "wechat"]
}
```

响应体：

```json
{
  "code": 0,
  "message": "success",
  "request_id": "req_xxx",
  "data": {
    "login_session_id": "ls_xxx",
    "poll_token": "pt_xxx",
    "login_url": "https://auth.example.com/login?session=ls_xxx&poll_token=pt_xxx",
    "expires_at": "2026-03-24T14:00:00Z",
    "interval_seconds": 2
  }
}
```
说明：
- `login_url` 指向服务端登录页（`/login`），用于浏览器完成登录流程。

### 4.2 查询登录会话状态
- 方法：`GET`
- 路径：`/auth/login-sessions/{login_session_id}`
- 用途：插件短轮询或长轮询获取登录结果

请求参数：
- `poll_token`
- `wait_seconds`
说明：
- `wait_seconds=0` 表示短轮询
- `wait_seconds=20` 可实现长轮询

响应状态枚举：
- `pending`
- `success`
- `failed`
- `expired`
- `cancelled`

成功示例：

```json
{
  "code": 0,
  "message": "success",
  "request_id": "req_xxx",
  "data": {
    "login_session_id": "ls_xxx",
    "status": "success",
    "exchange_token": "et_xxx",
    "expires_at": "2026-03-24T14:00:00Z"
  }
}
```

### 4.3 交换正式登录令牌
- 方法：`POST`
- 路径：`/auth/tokens:action?action=tokens:exchange`
- 用途：插件用一次性 `exchange_token` 换取正式 token

请求体：

```json
{
  "login_session_id": "ls_xxx",
  "exchange_token": "et_xxx"
}
```

响应体：

```json
{
  "code": 0,
  "message": "success",
  "request_id": "req_xxx",
  "data": {
    "access_token": "atk_xxx",
    "refresh_token": "rtk_xxx",
    "expires_in": 7200,
    "user": {
      "user_id": "usr_xxx",
      "email": "demo@example.com",
      "display_name": "demo"
    }
  }
}
```

### 4.4 刷新访问令牌
- 方法：`POST`
- 路径：`/auth/tokens:action?action=tokens:refresh`

请求体：

```json
{
  "refresh_token": "rtk_xxx"
}
```

### 4.5 登出
- 方法：`POST`
- 路径：`/auth/logout`
- 认证：需要 `access_token`

请求体：

```json
{
  "all_devices": false
}
```

## 5. 邮箱登录接口

### 5.1 发送邮箱验证码
- 方法：`POST`
- 路径：`/auth/email/send-code`

请求体：

```json
{
  "login_session_id": "ls_xxx",
  "email": "demo@example.com",
  "scene": "login"
}
```

### 5.2 校验邮箱验证码并登录
- 方法：`POST`
- 路径：`/auth/email/verify-code`

请求体：

```json
{
  "login_session_id": "ls_xxx",
  "email": "demo@example.com",
  "code": "123456"
}
```

说明：
- 验证成功后，服务端更新 `login_session` 为 `success`
- 同时生成一次性 `exchange_token`

## 6. 微信登录接口

### 6.1 获取微信登录跳转信息
- 方法：`POST`
- 路径：`/auth/wechat/login-url`

请求体：

```json
{
  "login_session_id": "ls_xxx"
}
```

响应体：

```json
{
  "code": 0,
  "message": "success",
  "request_id": "req_xxx",
  "data": {
    "provider": "wechat",
    "authorize_url": "https://open.weixin.qq.com/connect/qrconnect?...",
    "state": "wx_state_xxx"
  }
}
```

### 6.2 微信登录回调
- 方法：`GET`
- 路径：`/auth/wechat/callback`
- 用途：供微信开放平台回调浏览器服务端页面

请求参数：
- `code`
- `state`

处理逻辑：
- 校验 `state`
- 获取微信用户标识
- 查找或创建用户
- 更新 `login_session`
- 跳转到登录完成页
  - `Accept: text/html` 时，自动重定向至 `next_url`（/login）
  - 非 HTML 请求返回 JSON，包含 `next_url`

响应体（非 HTML）示例：

```json
{
  "code": 0,
  "message": "success",
  "request_id": "req_xxx",
  "data": {
    "login_session_id": "ls_xxx",
    "status": "success",
    "exchange_token": "et_xxx",
    "next_url": "/login?session=ls_xxx&poll_token=pt_xxx"
  }
}
```

### 6.3 绑定微信账号
- 方法：`POST`
- 路径：`/auth/wechat/bind`
- 认证：需要 `access_token`

请求体：

```json
{
  "bind_ticket": "wxb_xxx"
}
```

## 7. 用户与账户接口

### 7.1 获取当前用户信息
- 方法：`GET`
- 路径：`/users/me`
- 认证：需要 `access_token`

响应体：

```json
{
  "code": 0,
  "message": "success",
  "request_id": "req_xxx",
  "data": {
    "user_id": "usr_xxx",
    "display_name": "demo",
    "email": "demo@example.com",
    "email_verified": true,
    "wechat_bound": false,
    "user_type": "personal",
    "created_at": "2026-03-24T12:00:00Z"
  }
}
```

### 7.2 更新用户资料
- 方法：`PATCH`
- 路径：`/users/me`
- 认证：需要 `access_token`

请求体：

```json
{
  "display_name": "new_name"
}
```

## 8. Credits 接口

### 8.1 获取 Credits 余额
- 方法：`GET`
- 路径：`/credits/balance`
- 认证：需要 `access_token`

响应体：

```json
{
  "code": 0,
  "message": "success",
  "request_id": "req_xxx",
  "data": {
    "balance": 1250,
    "currency": "credits",
    "frozen": 0
  }
}
```

### 8.2 查询消费流水
- 方法：`GET`
- 路径：`/credits/transactions`
- 认证：需要 `access_token`

查询参数：
- `page`
- `page_size`
- `type`
- `start_time`
- `end_time`

### 8.3 预估调用消耗
- 方法：`POST`
- 路径：`/credits/estimate`
- 认证：需要 `access_token`

请求体：

```json
{
  "scene": "llm_chat",
  "model": "gpt-4.1",
  "input_tokens": 3000,
  "output_tokens": 1500
}
```

## 9. LLM 代理接口

### 9.1 创建对话补全
- 方法：`POST`
- 路径：`/llm/generate`
- 认证：需要 `access_token`

请求体：

```json
{
  "scene": "schematic_analysis",
  "billing_mode": "credits",
  "model": "gpt-4.1",
  "stream": true,
  "messages": [
    {
      "role": "system",
      "content": "..."
    },
    {
      "role": "user",
      "content": "分析这个模块"
    }
  ],
  "response_format": {
    "type": "json_schema",
    "name": "analysis_result"
  },
  "metadata": {
    "plugin_channel": "professional"
  }
}
```

说明：
- 服务端负责 Credits 预扣、实际计费、失败回滚
- `stream=true` 时建议采用 `SSE`
- `messages` 必填且不能为空；为空返回 `400000`
- 透传重试与超时可通过配置控制：
  - `LLM_REQUEST_TIMEOUT_MS`
  - `LLM_RETRY_COUNT`
  - `LLM_RETRY_BACKOFF_MS`

### 9.2 查询模型调用日志
- 方法：`GET`
- 路径：`/llm/logs`
- 认证：需要 `access_token`

## 10. RAG 接口

### 10.1 检索知识证据
- 方法：`POST`
- 路径：`/rag/search`
- 认证：需要 `access_token`

请求体：

```json
{
  "query": "LDO 输入输出电容应该怎么选",
  "top_k": 8,
  "filters": {
    "kb_types": ["principle", "component"],
    "component_type": ["LDO"],
    "voltage_level": ["3.3V", "5V"]
  },
  "context": {
    "project_type": "power",
    "selected_component_refs": ["U1"]
  }
}
```

响应体：

```json
{
  "code": 0,
  "message": "success",
  "request_id": "req_xxx",
  "data": {
    "results": [
      {
        "chunk_id": "chk_xxx",
        "score": 0.92,
        "title": "LDO 设计指南",
        "snippet": "...",
        "source_ref": "doc-ldo-v1#p12",
        "kb_type": "principle"
      }
    ]
  }
}
```

### 10.2 混合检索并生成引用包
- 方法：`POST`
- 路径：`/rag/citations:build`
- 认证：需要 `access_token`

用途：
- 给 Agent / LLM 代理生成用于提示词拼装的标准引用包

## 11. Agent 任务接口

### 11.1 提交原理图分析任务
- 方法：`POST`
- 路径：`/agent/tasks/schematic-analysis`
- 认证：需要 `access_token`

请求体：

```json
{
  "billing_mode": "credits",
  "project": {
    "project_id": "prj_xxx",
    "page_id": "page_xxx",
    "channel": "standard"
  },
  "task": {
    "user_query": "分析这个音频放大模块是否有接线错误",
    "mode": "partial"
  },
  "schematic_context": {
    "components": [],
    "nets": [],
    "pins": [],
    "rules_hit": []
  }
}
```

响应体：

```json
{
  "code": 0,
  "message": "success",
  "request_id": "req_xxx",
  "data": {
    "task_id": "agt_xxx",
    "status": "queued"
  }
}
```

### 11.2 提交原理图草案生成任务
- 方法：`POST`
- 路径：`/agent/tasks/schematic-draft`
- 认证：需要 `access_token`

请求体：

```json
{
  "billing_mode": "credits",
  "project": {
    "project_id": "prj_xxx",
    "page_id": "page_xxx",
    "channel": "professional"
  },
  "task": {
    "user_query": "帮我生成一个智能药盒项目，采用 esp32-s3 + 功放喇叭 + 麦克风 + 多个按键 + 霍尔感应器"
  },
  "constraints": {
    "voltage": "5V",
    "must_have_components": ["ESP32-S3"]
  },
  "schematic_context": {
    "components": [],
    "nets": []
  }
}
```

### 11.3 查询 Agent 任务结果
- 方法：`GET`
- 路径：`/agent/tasks/{task_id}`
- 认证：需要 `access_token`

响应体：

```json
{
  "code": 0,
  "message": "success",
  "request_id": "req_xxx",
  "data": {
    "task_id": "agt_xxx",
    "status": "completed",
    "result": {
      "summary": "检测到 2 个高风险问题",
      "tool_traces": [
        {
          "tool_name": "rule_engine.check",
          "status": "success"
        }
      ],
      "citations": [],
      "issues": [],
      "draft": {
        "components": [],
        "connections": [],
        "net_names": []
      }
    }
  }
}
```

## 12. 知识库管理接口

### 12.1 导入知识文档
- 方法：`POST`
- 路径：`/knowledge/documents`
- 认证：后台管理或内部使用

请求体示例：

```json
{
  "kb_type": "principle",
  "title": "LDO设计指南",
  "source_type": "manual",
  "source_ref": "doc-ldo-v1",
  "lang": "zh-CN",
  "content": "LDO输入输出电容应尽量靠近芯片引脚。"
}
```

响应补充：
- `data.import_mode`：
  - `created`：新建文档
  - `updated`：按来源键命中文档并更新内容
  - `skipped_duplicate`：来源键命中且内容哈希一致，跳过重复导入

### 12.2 查询知识文档列表
- 方法：`GET`
- 路径：`/knowledge/documents`

查询参数：
- `limit`

### 12.3 重建文档索引
- 方法：`POST`
- 路径：`/knowledge/documents/{document_id}:reindex`

### 12.4 创建知识导入任务
- 方法：`POST`
- 路径：`/knowledge/import-tasks`

请求体示例：

```json
{
  "kb_type": "principle",
  "title": "LDO设计指南",
  "source_type": "manual",
  "source_ref": "doc-ldo-v1",
  "lang": "zh-CN",
  "content": "LDO输入输出电容应尽量靠近芯片引脚。",
  "file_path": "",
  "idempotency_key": "imp-ldo-v1"
}
```

说明：
- `content` 与 `file_path` 二选一，优先使用 `content`。
- 创建任务后会自动入队执行，无需额外调用 `:run`。
- 支持可选 `idempotency_key`：
  - 相同 `idempotency_key` 的重复创建请求会直接返回已存在任务。
  - 未提供时，服务端按请求关键字段自动生成去重键做基础幂等控制。

### 12.5 查询知识导入任务
- 方法：`GET`
- 路径：`/knowledge/import-tasks/{task_id}`

返回补充字段：
- `attempts`：当前已执行次数
- `max_attempts`：最大重试次数
- `next_run_at`：下次重试时间（仅排队重试时存在）
- `last_error_at`：最近失败时间
- `error_message`：最近失败原因

### 12.6 触发知识导入任务执行
- 方法：`POST`
- 路径：`/knowledge/import-tasks/{task_id}:run`

### 12.7 将知识导入任务重新入队
- 方法：`POST`
- 路径：`/knowledge/import-tasks/{task_id}:enqueue`

说明：
- 任务创建后会自动进入后台队列执行。
- 失败任务支持自动重试与手动重新入队。
- 当前实现支持队列自动选择：
  - Redis 可用时使用 Redis Stream + Consumer Group（持久化 + ack）
  - Redis 不可用时回退进程内队列
- 执行前任务锁策略：
  - Redis 可用时使用分布式任务锁，避免多实例重复执行同一 `task_id`
  - Redis 不可用时使用进程内防重策略
- 后续仍需演进生产级消息能力（死信队列、消费组、高可用）。
- Stream 重投策略支持参数化：
  - `claim enabled`
  - `claim count`
  - `claim interval`
  - `claim min idle`
- 任务执行重试策略支持参数化：
  - `KNOWLEDGE_TASK_MAX_ATTEMPTS`
  - `KNOWLEDGE_TASK_RETRY_DELAY_MS`
  - `KNOWLEDGE_TASK_RETRY_BACKOFF_MODE`（`fixed` / `exponential`）
  - `KNOWLEDGE_TASK_RETRY_MAX_DELAY_MS`

### 12.7.1 重置失败任务并重试
- 方法：`POST`
- 路径：`/knowledge/import-tasks/{task_id}:retry`

说明：
- 适用于已达到最大重试次数并进入失败状态（死信）的任务。
- 与 `:enqueue` 不同，`:retry` 会重置任务尝试计数与错误状态，再重新入队执行。
- 若任务不是死信状态，返回 `409001`。

### 12.8 查询知识导入任务队列统计
- 方法：`GET`
- 路径：`/knowledge/import-tasks/stats`

说明：
- 用于观测任务创建、入队、出队、运行、成功、失败、重试、死信等计数。
- 包含重复创建命中计数：`deduplicated_create_count`。
- 包含任务锁指标：
  - `lock_conflict_count`
  - `lock_error_count`
- 包含消息确认指标：
  - `ack_success_count`
  - `ack_error_count`
  - `ack_retry_count`
  - `ack_retry_exhausted_count`
- 包含 Stream 消费来源与积压指标：
  - `claimed_message_count`
  - `stream_message_count`
  - `queue_pending_count`
- 包含重投治理观测指标：
  - `retry_delay_last_ms`
  - `retry_delay_total_ms`
  - `retry_backoff_fixed_count`
  - `retry_backoff_exponential_count`
  - `manual_retry_rejected_count`
- ack 重试策略支持参数化：
  - `KNOWLEDGE_ACK_RETRY_COUNT`
  - `KNOWLEDGE_ACK_RETRY_INTERVAL_MS`

### 12.9 查询知识导入死信记录
- 方法：`GET`
- 路径：`/knowledge/import-tasks/dead-letters`

查询参数：
- `limit`（可选，默认 `20`，最大建议 `100`）

说明：
- 返回最近失败且达到最大重试次数的任务记录。
- 每条记录包含 `task_uid/error_message/attempts/max_attempts/failed_at`。

## 13. 审计与运维接口

### 13.1 查询调用日志
- 方法：`GET`
- 路径：`/ops/request-logs`
- 认证：后台管理

### 13.2 查询限流状态
- 方法：`GET`
- 路径：`/ops/rate-limits/me`
- 认证：需要 `access_token`

## 14. 首版接口范围

### 14.1 P0 必须实现
- `POST /auth/login-sessions`
- `GET /auth/login-sessions/{login_session_id}`
- `POST /auth/tokens:action?action=tokens:exchange`
- `POST /auth/tokens:action?action=tokens:refresh`
- `POST /auth/email/send-code`
- `POST /auth/email/verify-code`
- `GET /users/me`
- `GET /credits/balance`
- `GET /credits/transactions`
- `POST /llm/generate`
- `POST /rag/search`
- `POST /agent/tasks/schematic-analysis`
- `POST /agent/tasks/schematic-draft`
- `GET /agent/tasks/{task_id}`

### 14.2 P1 增强实现
- `POST /auth/wechat/login-url`
- `GET /auth/wechat/callback`
- `POST /auth/wechat/bind`
- `POST /credits/estimate`
- `POST /rag/citations:build`
- `POST /knowledge/documents`
- `GET /knowledge/documents`
- `POST /knowledge/documents/{document_id}:reindex`
- `POST /knowledge/import-tasks`
- `GET /knowledge/import-tasks/{task_id}`
- `POST /knowledge/import-tasks/{task_id}:run`
- `POST /knowledge/import-tasks/{task_id}:enqueue`

## 15. 设计说明
- 首版接口优先满足插件单用户、个人账号、Credits 消费与双端兼容。
- 所有高风险工程结论都应通过 `tool_traces`、`citations` 或规则命中结果回传给插件。
- 插件自定义 LLM 模式不依赖服务端代理接口，但仍可复用登录、账户、Credits 和 RAG 接口。
