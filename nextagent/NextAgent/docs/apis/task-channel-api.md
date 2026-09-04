# Task Channel API 接口文档

本文档是 Task Channel（`agent-channel-task`）面向外部消费者（网管系统、告警平台、编排系统）的权威 HTTP/JSON 机机接口定义。Task Channel 是 NextAgent 的第二个 product entrypoint，通过 HTTP/JSON + multipart + SSE 接口对接，不经过浏览器 UI。

所有字段定义、约束、枚举值以本文档为准。对应实现代码在 `packages/agent-channel-task/src/routes.ts`、`task-status.ts`、`task-message.ts`、`task-callback.ts`、`http-task-callback.ts`。

---

## 1. 通用约定

### 1.1 Base URL 与路径

- Base URL：运行时配置或同源地址，例如 `http://127.0.0.1:3000`。
- 路径按交付模式拆分为三套路由树：`/api/v1/stream-task`（流式，POST 直接返回 SSE）、`/api/v1/async-tasks`（异步，JSON + callback）、`/api/v1/tasks`（共享 JSON 端点：cancel/query/answer）。三套路由注册于同一 Fastify instance，通过路径模式隔离，互不干扰。
- `taskId` 映射内部 `requestId`（即 runtime 中的 MessageId）：一个 task 对应一个 request。`sessionId` 作为独立的会话坐标保留在响应中。响应和事件不暴露 `runId`、`contextId` 等内部诊断字段；`attempt` 仅在 retry 响应中暴露。
- Task 与 session 1:1：create 时 channel 自动创建新 session，不接受外部传入 `sessionId`。edit/retry/cancel/query/answer 的 `sessionId` 用于定位已有 task 所属 session。

### 1.2 Content-Type

| Content-Type | 适用端点 | 说明 |
| --- | --- | --- |
| `application/json` | async-tasks、cancel、query、answer | JSON 请求体 |
| `application/json` | stream-task（create/edit/retry） | JSON 请求体，响应为 SSE |
| `multipart/form-data` | stream-task（create/edit） | 文本字段作为 form fields，文件附件作为 file parts，响应为 SSE |
| `text/event-stream` | stream-task（create/edit/retry） | 响应体，每条事件为 `event: <eventType>\ndata: <TaskEvent JSON>\n\n` |

### 1.3 身份认证

Task Channel 不做 credential validation，认证统一通过 remote gateway 实现。gateway 完成认证后通过 HTTP header 注入身份信息。Task Channel 复用 `agent-channel-common` 的 `IdentityResolver` 从 header 提取 `IdentityContext`。

身份 Header 约定：

| Header | 映射字段 | 必填 | 说明 |
| --- | --- | --- | --- |
| `x-tenant-id` | `tenantId` | 是 | 租户 ID |
| `x-subject-id` | `subjectId` | 是 | 用户 ID |
| `x-display-name` | `displayName` | 否 | 显示名称，缺失时回退到默认 identity |

`agentId` 不从客户端 header 或请求体获取，由 runtime 内部 `resolveAgentId()` 决定。请求体、query、path 都不能覆盖当前 `tenantId`、`subjectId`、`agentId`。请求体中出现 owner/agent 字段会被 schema validation 拒绝（`additionalProperties: false`）。

### 1.4 traceparent Header

所有 Task Channel 端点接受 W3C `traceparent` 请求 header，不会因此拒绝或过滤请求。当前版本 channel 不解析、不校验、不日志记录、不处理该 header 值。trace context 向 runtime、capability 和出站调用的传播延期至单独 change 处理。

### 1.5 reportEvents 参数

`reportEvents` 是 create/edit 的可选参数（stream-task 和 async-tasks 都支持），接受事件类型列表或 `"ALL"` / `"TERMINAL"`。该参数为预留，事件过滤引擎暂不实现，当前行为等同 `"ALL"`（stream-task 默认 `ALL`，async-tasks 默认 `TERMINAL`）。retry 不接受此参数。

### 1.6 事件过滤

Channel 层在 SSE 和 callback 投影时**始终过滤**以下 4 个内部事件类型，不推送给消费方：

- `BACKGROUND_TASK_STARTED`
- `BACKGROUND_TASK_COMPLETED`
- `BACKGROUND_TASK_FAILED`
- `OUTPUT_GUARD_BLOCKED`

TaskEventType 枚举保留全部 23 个值用于编译期安全，过滤是运行时行为。

### 1.7 时间字段

epoch milliseconds number，例如 `1719878400000`。

### 1.8 错误响应

错误响应统一为安全错误投影：

```json
{
  "error": {
    "code": "REQUEST_VALIDATION_FAILED",
    "message": "Request validation failed."
  }
}
```

错误响应只包含 `error.code` 和 `error.message`，不暴露 raw provider error、stack trace、prompt、model output、file path 或 credential。批量端点的单项失败返回 per-item error，不阻塞其他项。当批量请求中所有项均失败时，返回 HTTP 400，响应体仍包含完整 `results` 数组，每项携带各自的 per-item error。

HTTP 状态码映射：

| HTTP 状态码 | 触发条件 | 典型 error.code |
| --- | --- | --- |
| `400` | Validation / bad request；批量请求全部项失败 | `REQUEST_VALIDATION_FAILED`、各 per-item error code |
| `401` | 身份 header 缺失或解析失败 | `IDENTITY_REQUIRED`、`IDENTITY_RESOLUTION_FAILED` |
| `403` | Authorization / forbidden | runtime `AUTHORIZATION` category |
| `404` | Not found（不泄露跨 owner 存在性） | runtime `NOT_FOUND` category |
| `409` | Conflict（terminal pending 等） | runtime `CONFLICT` category |
| `503` | Unavailable（async callback 未配置等） | `ASYNC_CALLBACK_UNAVAILABLE`、runtime `UNAVAILABLE` category |

---

## 2. 枚举定义

### 2.1 TaskStatus

| TaskStatus | 说明 |
| --- | --- |
| `TASK_ACCEPTED` | 请求已接受 |
| `TASK_QUEUED` | 排队中 |
| `TASK_PLANNING` | 规划中 |
| `TASK_EXECUTING` | 执行中 |
| `TASK_PENDING` | 等待用户输入（PendingInput 阻塞），存在活跃 PendingInput 时优先于此状态 |
| `TASK_COMPLETED` | 成功完成（terminal） |
| `TASK_FAILED` | 执行失败（terminal） |
| `TASK_CANCELED` | 已取消（terminal） |
| `TASK_SUPERSEDED` | 已被替代（terminal） |

stream-task create/edit 成功后 SSE 首事件为 `TASK_ACCEPTED`。async create/edit/retry 成功后返回 `taskStatus: TASK_ACCEPTED`。cancel 成功后返回 `TASK_CANCELED`。pending-input answer 成功后返回 `TASK_EXECUTING`。retry 额外返回 `attempt` 字段。

### 2.2 TaskEventType

SSE 和 async callback 统一使用 `TaskEventType`。共 23 个取值，其中 4 个始终过滤不推送给消费方。

| TaskEventType | 说明 | 是否推送 |
| --- | --- | --- |
| `TASK_ACCEPTED` | 请求已接受 | 是 |
| `THINKING_DELTA` | 模型思考过程增量 | 是 |
| `CONTENT_DELTA` | 模型输出内容增量 | 是 |
| `CAPABILITY_STARTED` | 能力调用开始 | 是 |
| `CAPABILITY_RESULT_DELTA` | 能力结果增量 | 是 |
| `CAPABILITY_COMPLETED` | 能力调用完成 | 是 |
| `TOOL_STRUCTURED_DELTA` | 工具结构化增量 | 是 |
| `DEGRADATION_NOTICE` | 降级通知 | 是 |
| `TASK_COMPLETED` | 请求成功完成（terminal） | 是 |
| `TASK_FAILED` | 请求执行失败（terminal） | 是 |
| `TASK_CANCELED` | 请求被取消（terminal） | 是 |
| `TASK_SUPERSEDED` | 请求被替代（terminal） | 是 |
| `USER_INPUT_REQUIRED` | 需要用户输入（run 阻塞） | 是 |
| `USER_INPUT_RECEIVED` | 已收到用户输入 | 是 |
| `USER_INPUT_TIMEOUT` | 用户输入超时 | 是 |
| `USER_INPUT_CANCELED` | 用户输入被取消 | 是 |
| `ATTACHMENT_ACCEPTED` | 附件已接受 | 是 |
| `ATTACHMENT_REJECTED` | 附件被拒绝 | 是 |
| `CONTEXT_COMPACTED` | 上下文已压缩 | 是 |
| `BACKGROUND_TASK_STARTED` | 后台任务开始 | **否（始终过滤）** |
| `BACKGROUND_TASK_COMPLETED` | 后台任务完成 | **否（始终过滤）** |
| `BACKGROUND_TASK_FAILED` | 后台任务失败 | **否（始终过滤）** |
| `OUTPUT_GUARD_BLOCKED` | 输出守卫拦截 | **否（始终过滤）** |

Terminal 事件（标志当前 run 到达终态，SSE 流在推送 terminal 事件后关闭）：`TASK_COMPLETED`、`TASK_FAILED`、`TASK_CANCELED`、`TASK_SUPERSEDED`。

### 2.3 TaskMessage

create 和 edit 的任务输入使用 `taskMessages: TaskMessage[]`（`minItems: 1, maxItems: 1`）。Answer 使用顶层 `answers`，不使用 `taskMessages`。

| 字段 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `text` | One-of | string | minLength: 1, maxLength: 32768 | 文本输入 |
| `data` | One-of | Record<string, unknown> | — | 结构化数据输入 |
| `fileContent` | One-of | object | 见下表 | 内联或远程文件内容 |
| `metadata` | 否 | Record<string, unknown> | — | 不可信 JSON 对象；`eventId` 字段在 `traceEnabled` 为 true 时作为 `taskEventId` 传播到 runtime |

`fileContent` 包含 `raw`（base64）或 `url`（远程）之一（one-of），以及必填的 `filename` 和 `mediaType`：

| 字段 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `raw` | One-of | string | base64, maxLength: 16MB | base64 编码的文件内容 |
| `url` | One-of | string | maxLength: 2048, http/https | 远程文件 URL（当前版本未接入，返回 error） |
| `filename` | 是 | string | minLength: 1, maxLength: 255 | 文件名 |
| `mediaType` | 是 | string | minLength: 1, maxLength: 255 | MIME 类型 |

### 2.4 TaskEvent

SSE 流式创建和 async callback 共用统一 `TaskEvent` 结构：

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `eventId` | 是 | string | 事件唯一 ID |
| `eventType` | 是 | TaskEventType | 事件类型 |
| `sessionId` | 是 | string | session ID |
| `taskId` | 是 | string | request ID（外部别名） |
| `sequence` | 是 | number | timeline sequence |
| `createdAt` | 是 | number | epoch milliseconds |
| `payload` | 是 | object | 事件 payload |

`payload` 携带事件特定字段，例如：
- `CONTENT_DELTA`：`content`、`text`、`contentType`
- `USER_INPUT_REQUIRED`：`pendingInputId`、`kind`、`questions`、`overtime`
- `TASK_COMPLETED`：`content`、`text`、`status`
- `TASK_FAILED`：`content`、`code`、`category`、`retryable`

---

## 3. 接口定义

Task Channel 当前实现 9 个端点，按交付模式分为三套路由树：

### 3.1 stream-task 路由树（POST 直接返回 SSE）

| # | 方法 | 路径 | 功能 | Content-Type |
| --- | --- | --- | --- | --- |
| 1 | POST | `/api/v1/stream-task` | 流式创建 task（单任务），直接返回 SSE 流 | JSON / multipart -> SSE |
| 2 | POST | `/api/v1/stream-task/:taskId/edit` | 流式编辑任务输入，直接返回 SSE 流 | JSON / multipart -> SSE |
| 3 | POST | `/api/v1/stream-task/:taskId/retry` | 流式重试任务，直接返回 SSE 流 | JSON -> SSE |

流式端点的 POST 直接以 SSE 事件流作为 HTTP response body 返回，无需二次订阅。首个事件为 `TASK_ACCEPTED`，终态事件后关闭流。

### 3.2 async-tasks 路由树（JSON + callback）

| # | 方法 | 路径 | 功能 | Content-Type |
| --- | --- | --- | --- | --- |
| 4 | POST | `/api/v1/async-tasks` | 异步批量创建 task，必带 callbackTarget | JSON -> JSON |
| 5 | POST | `/api/v1/async-tasks/edit` | 异步批量编辑任务输入 | JSON -> JSON |
| 6 | POST | `/api/v1/async-tasks/retry` | 异步批量重试任务（含 attempt） | JSON -> JSON |

异步端点返回 JSON 控制响应，通过 callback delivery 异步推送事件。callbackDeliveryPort 未配置时返回 503。

### 3.3 tasks 路由树（共享 JSON 端点）

| # | 方法 | 路径 | 功能 | Content-Type |
| --- | --- | --- | --- | --- |
| 7 | POST | `/api/v1/tasks/cancel` | 批量取消任务（路径不变） | JSON -> JSON |
| 8 | POST | `/api/v1/tasks/query` | 批量查询任务状态和终态结果（路径不变，扁平 data） | JSON -> JSON |
| 9 | POST | `/api/v1/tasks/pending-inputs/answer` | 批量回答 pending input（路径不变，顶层 answers） | JSON -> JSON |

### 3.4 流式创建任务

`POST /api/v1/stream-task`

创建新 session（channel 自动创建，不接受外部 `sessionId`）并提交请求。响应直接为 SSE 流（`text/event-stream`），首个事件为 `TASK_ACCEPTED`。Edit 产生新 `taskId`（runtime 创建新 requestId），Retry 保持同一 `taskId`。

#### 请求 Body（JSON）

| 字段 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `taskMessages` | 是 | TaskMessage[] | minItems: 1, maxItems: 1 | 任务消息数组 |
| `locale` | 否 | string | minLength: 2, maxLength: 35 | 请求语言，默认 `zh-CN` |
| `idempotencyKey` | 否 | string | minLength: 1, maxLength: 256 | 可选幂等键，缺失时 channel 生成 UUID |
| `reportEvents` | 否 | `"ALL"` / `"TERMINAL"` / string[] | 预留，默认 `ALL` | 事件过滤（暂不实现） |

请求体 `additionalProperties: false`，不接受 `sessionId`、`mode`、`callbackTarget`、`inputText`、`routingConstraints`、`runId`、`contextId` 等。

请求示例：

```json
{
  "taskMessages": [
    { "text": "分析小区掉话率升高原因" }
  ],
  "locale": "zh-CN",
  "idempotencyKey": "idem-create-001"
}
```

结构化数据输入示例：

```json
{
  "taskMessages": [
    {
      "data": { "alarmId": "ALM-2024-001", "neType": "gNB", "severity": "CRITICAL" },
      "metadata": { "source": "alarm-platform" }
    }
  ]
}
```

内联文件输入示例：

```json
{
  "taskMessages": [
    {
      "fileContent": {
        "raw": "BASE64_ENCODED_CONTENT",
        "filename": "kpi-report.csv",
        "mediaType": "text/csv"
      }
    }
  ]
}
```

#### Multipart 请求

`Content-Type: multipart/form-data` 时支持文件上传。响应仍为 SSE。表单字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `taskMessages` | 是 | JSON 编码的 TaskMessage 数组 |
| `locale` | 否 | 请求语言 |
| `idempotencyKey` | 否 | 可选幂等键 |
| `reportEvents` | 否 | 事件过滤（预留） |
| file parts | 否 | 文件附件 |

multipart 请求示例：

```bash
curl -X POST "$BASE_URL/api/v1/stream-task" \
  -H "x-tenant-id: tenant-1" \
  -H "x-subject-id: user-1" \
  -F 'taskMessages=[{"text":"分析小区掉话率升高原因"}];type=application/json' \
  -F 'locale=zh-CN' \
  -F 'file=@./kpi-report.csv'
```

#### 响应（200，SSE）

```
event: TASK_ACCEPTED
data: {"eventId":"evt-001","eventType":"TASK_ACCEPTED","sessionId":"sess-abc","taskId":"req-001","sequence":1,"createdAt":1719878400000,"payload":{}}

event: CONTENT_DELTA
data: {"eventId":"evt-002","eventType":"CONTENT_DELTA","sessionId":"sess-abc","taskId":"req-001","sequence":2,"createdAt":1719878401000,"payload":{"content":"根因分析...","text":"根因分析...","contentType":"MARKDOWN"}}

event: TASK_COMPLETED
data: {"eventId":"evt-003","eventType":"TASK_COMPLETED","sessionId":"sess-abc","taskId":"req-001","sequence":3,"createdAt":1719878402000,"payload":{"content":"分析完成","text":"分析完成","status":"COMPLETED"}}
[流关闭]
```

### 3.5 流式编辑任务

`POST /api/v1/stream-task/:taskId/edit`

编辑已有请求的输入。runtime `editLatest` 创建新 `requestId`，旧 request 被 supersede。SSE 流携带新 `taskId`。支持 multipart 文件上传。

#### 请求 Body（JSON）

| 字段 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | 是 | string | minLength: 1, maxLength: 256 | session ID |
| `taskMessages` | 是 | TaskMessage[] | minItems: 1, maxItems: 1 | 新的任务消息 |
| `idempotencyKey` | 是 | string | minLength: 1, maxLength: 256 | 必填幂等键，runtime 强制非空 |
| `locale` | 否 | string | minLength: 2, maxLength: 35 | 请求语言 |
| `reportEvents` | 否 | `"ALL"` / `"TERMINAL"` / string[] | 预留 | 事件过滤（暂不实现） |

`taskId` 来自 path parameter，作为 `expectedLatestRequestId` 交给 runtime 校验。

请求示例：

```json
{
  "sessionId": "sess-abc",
  "taskMessages": [
    { "text": "重新分析：仅关注邻区切换失败导致的掉话" }
  ],
  "idempotencyKey": "idem-edit-001",
  "locale": "zh-CN"
}
```

响应（200，SSE）：同 3.4 节 SSE 格式，`taskId` 为 runtime 新建的 requestId（如 `req-002`），旧 request 被 supersede。

#### 响应（200，SSE）

```
event: TASK_ACCEPTED
data: {"eventId":"evt-101","eventType":"TASK_ACCEPTED","sessionId":"sess-abc","taskId":"req-002","sequence":10,"createdAt":1719878410000,"payload":{"attempt":1}}

event: CONTENT_DELTA
data: {"eventId":"evt-102","eventType":"CONTENT_DELTA","sessionId":"sess-abc","taskId":"req-002","sequence":11,"createdAt":1719878411000,"payload":{"content":"重新分析...","text":"重新分析...","contentType":"MARKDOWN"}}

event: TASK_COMPLETED
data: {"eventId":"evt-103","eventType":"TASK_COMPLETED","sessionId":"sess-abc","taskId":"req-002","sequence":12,"createdAt":1719878412000,"payload":{"content":"分析完成","text":"分析完成","status":"COMPLETED"}}
[流关闭]
```

### 3.6 流式重试任务

`POST /api/v1/stream-task/:taskId/retry`

重试已有请求。runtime `retryLatest` 保持同一 `requestId`，新建 `runId`，`attempt` 递增。SSE 流携带同一 `taskId`，首事件 payload 含 `attempt`。channel 内部生成 idempotencyKey，不接受外部传入。

#### 请求 Body（JSON）

| 字段 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | 是 | string | minLength: 1, maxLength: 256 | session ID |

请求示例：

```json
{
  "sessionId": "sess-abc"
}
```

#### 响应（200，SSE）

```
event: TASK_ACCEPTED
data: {"eventId":"evt-201","eventType":"TASK_ACCEPTED","sessionId":"sess-abc","taskId":"req-001","sequence":20,"createdAt":1719878420000,"payload":{"attempt":2}}

event: CONTENT_DELTA
data: {"eventId":"evt-202","eventType":"CONTENT_DELTA","sessionId":"sess-abc","taskId":"req-001","sequence":21,"createdAt":1719878421000,"payload":{"content":"重试执行中...","text":"重试执行中...","contentType":"MARKDOWN"}}

event: TASK_COMPLETED
data: {"eventId":"evt-203","eventType":"TASK_COMPLETED","sessionId":"sess-abc","taskId":"req-001","sequence":22,"createdAt":1719878422000,"payload":{"content":"重试完成","text":"重试完成","status":"COMPLETED"}}
[流关闭]
```

### 3.7 异步创建任务

`POST /api/v1/async-tasks`

批量创建任务并注册 HTTP callback 交付。每个 async task 项必须包含 `callbackTarget.url`。如果 callback delivery port 未配置，返回 HTTP 503。不接受 `idempotencyKey` 和 `mode`。所有项均失败时返回 HTTP 400，响应体仍包含完整 `results` 数组。

`reportEvents` 默认 `"TERMINAL"`：callback 仅推送 `TASK_COMPLETED`、`TASK_FAILED`、`TASK_CANCELED`、`USER_INPUT_REQUIRED`。`reportEvents` 为 `"ALL"` 时额外推送过程事件（事件过滤引擎暂不实现，`"ALL"` 等同推送全部除 4 个过滤类型外的事件）。

#### 请求 Body

| 字段 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `tasks` | 是 | array | minItems: 1, maxItems: 20 | 批量任务项 |
| `tasks[].taskMessages` | 是 | TaskMessage[] | minItems: 1, maxItems: 1 | 任务消息数组 |
| `tasks[].callbackTarget.url` | 是 | string | minLength: 1, maxLength: 2048, http/https | 回调 URL |
| `tasks[].locale` | 否 | string | minLength: 2, maxLength: 35 | 请求语言 |
| `tasks[].reportEvents` | 否 | `"ALL"` / `"TERMINAL"` / string[] | 默认 `"TERMINAL"` | 事件过滤（预留） |

请求示例：

```json
{
  "tasks": [
    {
      "taskMessages": [
        { "text": "分析小区掉话率升高原因" }
      ],
      "callbackTarget": { "url": "https://callback.example.com/api/v1/task-events" },
      "locale": "zh-CN",
      "reportEvents": "TERMINAL"
    }
  ]
}
```

#### 响应（200 / 400）

全部项成功或部分项成功返回 200；全部项失败返回 400，响应体仍包含完整 `results` 数组。

```json
{
  "results": [
    { "sessionId": "sess-abc", "taskId": "req-001", "taskStatus": "TASK_ACCEPTED" }
  ]
}
```

单项失败示例（per-item error 不阻塞其他项；全部项失败时 HTTP 400，响应体结构相同）：

```json
{
  "results": [
    { "sessionId": "sess-abc", "taskId": "req-001", "taskStatus": "TASK_ACCEPTED" },
    { "error": { "code": "ASYNC_CALLBACK_UNAVAILABLE", "message": "Callback delivery is not configured.", "retryable": true } }
  ]
}
```

### 3.8 异步编辑任务

`POST /api/v1/async-tasks/edit`

批量编辑任务输入。每项的 `taskId` 为新 `requestId`（runtime 创建新 requestId，旧 request 被 supersede）。每项必填 `idempotencyKey`。所有项均失败时返回 HTTP 400，响应体仍包含完整 `results` 数组。

#### 请求 Body

| 字段 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `tasks` | 是 | array | minItems: 1, maxItems: 20 | 批量任务项 |
| `tasks[].taskId` | 是 | string | minLength: 1, maxLength: 256 | 要编辑的 request ID |
| `tasks[].sessionId` | 是 | string | minLength: 1, maxLength: 256 | session ID |
| `tasks[].taskMessages` | 是 | TaskMessage[] | minItems: 1, maxItems: 1 | 新的任务消息 |
| `tasks[].idempotencyKey` | 是 | string | minLength: 1, maxLength: 256 | 必填幂等键 |
| `tasks[].locale` | 否 | string | minLength: 2, maxLength: 35 | 请求语言 |

请求示例：

```json
{
  "tasks": [
    {
      "taskId": "req-001",
      "sessionId": "sess-abc",
      "taskMessages": [
        { "text": "重新分析：仅关注邻区切换失败导致的掉话" }
      ],
      "idempotencyKey": "idem-edit-001",
      "locale": "zh-CN"
    }
  ]
}
```

### 3.9 异步重试任务

`POST /api/v1/async-tasks/retry`

批量重试任务。`taskId` 保持不变，`attempt` 递增。channel 内部生成 idempotencyKey，不接受外部传入。响应包含 `attempt` 字段。

#### 请求 Body

| 字段 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `tasks` | 是 | array | minItems: 1, maxItems: 20 | 批量任务项 |
| `tasks[].taskId` | 是 | string | minLength: 1, maxLength: 256 | 要重试的 request ID |
| `tasks[].sessionId` | 是 | string | minLength: 1, maxLength: 256 | session ID |

请求示例：

```json
{
  "tasks": [
    { "taskId": "req-001", "sessionId": "sess-abc" }
  ]
}
```

#### 响应（200 / 400）

全部项成功或部分项成功返回 200；全部项失败返回 400，响应体仍包含完整 `results` 数组。

```json
{
  "results": [
    { "sessionId": "sess-abc", "taskId": "req-001", "taskStatus": "TASK_ACCEPTED", "attempt": 2 }
  ]
}
```

### 3.10 取消任务

`POST /api/v1/tasks/cancel`

批量取消任务。重复取消已取消的 task 返回当前状态，不报错。不接受 `idempotencyKey`。

#### 请求 Body

| 字段 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `tasks` | 是 | array | minItems: 1, maxItems: 20 | 批量任务项 |
| `tasks[].taskId` | 是 | string | minLength: 1, maxLength: 256 | 要取消的 request ID |
| `tasks[].sessionId` | 是 | string | minLength: 1, maxLength: 256 | session ID |

请求示例：

```json
{
  "tasks": [
    { "taskId": "req-001", "sessionId": "sess-abc" }
  ]
}
```

#### 响应（200 / 400）

返回 `{ results: TaskControlResponse[] }`，成功项 `taskStatus` 为 `TASK_CANCELED`。 全部项失败返回 400，响应体仍包含完整 `results` 数组。

```json
{
  "results": [
    { "sessionId": "sess-abc", "taskId": "req-001", "taskStatus": "TASK_CANCELED" }
  ]
}
```

### 3.11 回答 Pending Input

`POST /api/v1/tasks/pending-inputs/answer`

回答 `USER_INPUT_REQUIRED` 事件产生的 pending input。使用顶层 `answers: string[][]`（对齐 web channel，不用 `taskMessages` 包裹）。channel 校验 taskId/sessionId/pendingInputId 三方一致后调用 runtime `answerPendingInput`。kind 差异化由 user-check 处理，channel 不解释 kind。不接受 `idempotencyKey`。

#### 请求 Body

| 字段 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `tasks` | 是 | array | minItems: 1, maxItems: 20 | 批量任务项 |
| `tasks[].taskId` | 是 | string | minLength: 1, maxLength: 256 | 对应的 request ID |
| `tasks[].pendingInputId` | 是 | string | minLength: 1, maxLength: 256 | pending input ID |
| `tasks[].sessionId` | 是 | string | minLength: 1, maxLength: 256 | session ID |
| `tasks[].answers` | 是 | string[][] | 外层 minItems: 1, maxItems: 100; 内层 minItems: 1; 每个 string minLength: 1, maxLength: 4096 | 有序回答数组 |

请求示例：

```json
{
  "tasks": [
    {
      "taskId": "req-001",
      "pendingInputId": "pi-001",
      "sessionId": "sess-abc",
      "answers": [["a"]]
    }
  ]
}
```

#### 响应（200 / 400）

返回 `{ results: TaskControlResponse[] }`，成功项 `taskStatus` 为 `TASK_EXECUTING`。 全部项失败返回 400，响应体仍包含完整 `results` 数组。

```json
{
  "results": [
    { "sessionId": "sess-abc", "taskId": "req-001", "taskStatus": "TASK_EXECUTING" }
  ]
}
```

### 3.12 批量查询任务状态

`POST /api/v1/tasks/query`

跨 session 批量查询任务状态。只读接口，不需要 `idempotencyKey`。使用扁平 `data: JsonObject` 字段按 `taskStatus` 区分内容。

#### 请求 Body

| 字段 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `tasks` | 是 | array | minItems: 1, maxItems: 20 | 批量查询项 |
| `tasks[].sessionId` | 是 | string | minLength: 1, maxLength: 256 | session ID |
| `tasks[].taskId` | 是 | string | minLength: 1, maxLength: 256 | request ID |

请求示例：

```json
{
  "tasks": [
    { "sessionId": "sess-abc", "taskId": "req-001" },
    { "sessionId": "sess-def", "taskId": "req-002" }
  ]
}
```

#### 响应（200）

```json
{
  "results": [
    {
      "sessionId": "sess-abc",
      "taskId": "req-001",
      "taskStatus": "TASK_PENDING",
      "data": {
        "pendingInputId": "pi-001",
        "kind": "QUESTION",
        "questions": [{ "prompt": "选择诊断策略", "options": [{ "label": "选项A", "value": "a" }], "multiple": false, "custom": true }],
        "overtime": 1719878460000
      }
    },
    {
      "sessionId": "sess-def",
      "taskId": "req-002",
      "taskStatus": "TASK_COMPLETED",
      "data": { "content": "根因分析完成：基站射频单元功率异常...", "contentType": "PLAIN_TEXT" }
    },
    {
      "sessionId": "sess-ghi",
      "taskId": "req-003",
      "taskStatus": "TASK_EXECUTING"
    }
  ]
}
```

`data` 字段按 `taskStatus` 区分：

| taskStatus | data 内容 |
| --- | --- |
| `TASK_PENDING` | `{ pendingInputId, kind, questions[], overtime? }` |
| `TASK_COMPLETED` | `{ content, contentType }` |
| `TASK_FAILED` | `{ content, contentType, code?, retryable? }` |
| 其他非终态非 pending | 无 `data` |

`questions` 结构：`{ prompt, options[]?, multiple?, custom? }`，`options` 为 `{ label, value, requiresTextInput?, inputPlaceholder? }`。

查不到的 task 返回 per-item error：`{ "error": { "code": "TASK_NOT_FOUND", "message": "..." } }`。

---

## 4. 异步回调交付

`POST /api/v1/async-tasks` 创建的任务通过 Task Channel 拥有的收窄 HTTP callback transport 交付结果。callback 实现位于 `agent-channel-task`，不经过 CLIP、不调用通用 HTTP executor。

### 4.1 reportEvents 参数

| reportEvents | callback 推送范围 |
| --- | --- |
| `"TERMINAL"`（默认） | 仅 `TASK_COMPLETED`、`TASK_FAILED`、`TASK_CANCELED`、`USER_INPUT_REQUIRED` |
| `"ALL"` | 额外推送过程事件（除 4 个始终过滤的类型外） |
| string[] | 预留，过滤引擎暂不实现，等同 `"ALL"` |

4 个始终过滤的事件类型（不论 `reportEvents` 设置）：`BACKGROUND_TASK_STARTED`、`BACKGROUND_TASK_COMPLETED`、`BACKGROUND_TASK_FAILED`、`OUTPUT_GUARD_BLOCKED`。

### 4.2 回调 Payload

```json
{
  "events": [
    {
      "eventId": "evt-001",
      "eventType": "USER_INPUT_REQUIRED",
      "sessionId": "sess-abc",
      "taskId": "req-001",
      "sequence": 5,
      "createdAt": 1719878400000,
      "payload": {
        "pendingInputId": "pi-001",
        "kind": "QUESTION",
        "questions": [],
        "overtime": 1719878460000
      }
    }
  ]
}
```

### 4.3 HTTP 约束

- Method：固定 `POST`
- Content-Type：`application/json`
- 不接受调用方自定义 method、headers、credentials 或 body
- 回调 URL 校验 protocol（http/https）、不允许 embedded credentials、不允许 fragment
- allowlist 为可选 origin 加固，未配置时放行合法 http/https URL
- `tlsInsecure` 为 true 时仅对 callback HTTPS 跳过证书校验

### 4.4 重试与幂等

- 默认超时 30 秒，最大重试 3 次，指数退避
- 重试保持 `eventId` 和 `sequence` 不变
- 消费方应能幂等处理重复 `eventId`
- 回调失败不影响 runtime 持久化事实，调用方可通过 `POST /api/v1/tasks/query` 对账恢复

---

## 5. 已删除端点

以下端点路由不注册，返回 HTTP 404：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/task/:taskId/stream` | 独立 SSE 订阅端点（已删除，保留 `lastSeenSequence` 设计供后续启用） |
| WS | `/api/v1/task/:taskId/ws` | WebSocket stream（已删除） |
| POST | `/api/v1/task` | 旧创建端点（替换为 `POST /api/v1/stream-task`） |
| POST | `/api/v1/tasks/async` | 旧异步创建端点（替换为 `POST /api/v1/async-tasks`） |
| POST | `/api/v1/tasks/edit` | 旧批量编辑端点（拆分为 stream-task 和 async-tasks） |
| POST | `/api/v1/tasks/retry` | 旧批量重试端点（拆分为 stream-task 和 async-tasks） |

以下端点不在当前版本实现：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/tasks/:taskId` | task 详情 |
| DELETE | `/api/v1/tasks/:taskId` | 删除 task |
| POST | `/api/v1/tasks/:taskId/submit` | 追加请求 |
| POST | `/api/v1/tasks/:taskId/stop` | 停止 |
| POST | `/api/v1/tasks/:taskId/resume` | 恢复 |
| GET | `/api/v1/tasks/:taskId/conversation` | 对话历史 |

---

## 6. 典型流程

### 6.1 流式创建 + SSE 消费

```text
1. POST /api/v1/stream-task  ->  SSE stream
   event: TASK_ACCEPTED    data: { sessionId, taskId, ... }
   event: CONTENT_DELTA    data: { payload: { content: "根因分析..." } }
   event: TASK_COMPLETED   data: { payload: { content: "分析完成" } }
   [流关闭]
```

### 6.2 SSE 中断后恢复

```text
1. SSE 流中断（GET stream 已移除，无法 replay）
2. POST /api/v1/tasks/query  ->  { results: [{ taskStatus, data: { content } }] }
   或 { results: [{ taskStatus: TASK_PENDING, data: { pendingInputId, ... } }] }
```

### 6.3 异步创建 + HTTP Callback

```text
1. POST /api/v1/async-tasks  ->  { results: [{ sessionId, taskId, taskStatus: TASK_ACCEPTED }] }
2. [后台] Channel 订阅 stream，过滤回调事件（reportEvents=TERMINAL 仅 4 类，reportEvents=ALL 含过程事件）
3. [后台] POST callbackTarget.url  ->  { events: [{ eventType: TASK_COMPLETED, ... }] }
```

### 6.4 状态对账恢复

```text
1. 调用方重启后发现 USER_INPUT_REQUIRED 回调丢失
2. POST /api/v1/tasks/query  ->  { results: [{ taskStatus: TASK_PENDING, data: { pendingInputId, ... } }] }
3. POST /api/v1/tasks/pending-inputs/answer  ->  { results: [{ taskStatus: TASK_EXECUTING }] }
```

### 6.5 编辑 + 重试

```text
1. POST /api/v1/async-tasks/edit  ->  { results: [{ taskId: req-edit, taskStatus: TASK_ACCEPTED }] }
   (taskId 为新 requestId，旧 request 被 supersede)
2. [如果失败] POST /api/v1/async-tasks/retry  ->  { results: [{ taskId: req-001, taskStatus: TASK_ACCEPTED, attempt: 2 }] }
   (taskId 不变，attempt 递增)
```

---

## 7. 代码位置

| 文件 | 说明 |
| --- | --- |
| `packages/agent-channel-task/src/routes.ts` | 路由注册、请求处理、batch 逻辑、multipart 解析、SSE 流式返回、query 端点 |
| `packages/agent-channel-task/src/task-status.ts` | TaskStatus/TaskEventType 枚举、映射函数、事件过滤、TaskEvent projection |
| `packages/agent-channel-task/src/task-message.ts` | TaskMessage schema、解析、input projection、taskEventId 提取 |
| `packages/agent-channel-task/src/task-callback.ts` | 回调事件 projection、delivery port 接口、reportEvents 过滤、retry 逻辑 |
| `packages/agent-channel-task/src/http-task-callback.ts` | 收窄 HTTP callback transport 实现 |
| `packages/agent-channel-task/tests/routes.test.ts` | 路由单元测试 |
| `packages/agent-channel-task/tests/task-callback.test.ts` | 回调单元测试 |
| `tests/e2e/task-channel-product-path.test.ts` | E2E 产品路径测试 |
| `openspec/changes/add-ts-task-channel/` | OpenSpec change（规格、设计、任务） |

---

## 8. 相关资源

- [OpenSpec change: add-ts-task-channel](../../openspec/changes/add-ts-task-channel/proposal.md)
- [Task Channel spec](../../openspec/changes/add-ts-task-channel/specs/agent-task-channel/spec.md)
- [Web Channel API](./agent-web-api-list.md)
- [Backend architecture](../../docs/nextagent-architecture.md)
