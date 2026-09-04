# API 参考

这一篇是 NextAgent REST API 和流式事件的精炼参考。

> Web channel 权威字段定义、约束与完整示例以 [`../apis/agent-web-api-list.md`](../apis/agent-web-api-list.md) 为准；Task channel 权威字段定义以 [`../apis/task-channel-api.md`](../apis/task-channel-api.md) 为准。本篇保留高频接口、通用约定、事件总览和常用示例，避免与代码和权威清单重复维护。

本文档对应当前 TypeScript 后端两个 channel 实现：Web channel 主入口在 `packages/agent-channel-web/src/routes/requests.ts`，Task channel 主入口在 `packages/agent-channel-task/src/routes.ts`。

## 通用约定

- Base URL：运行时配置或同源地址，例如 `http://127.0.0.1:3000`。
- REST 基础路径：`/api/v1`。
- JSON 请求：`Content-Type: application/json`。
- SSE 响应：`Content-Type: text/event-stream; charset=utf-8`。
- 附件提交：新 request 先调用 staged upload，再在 JSON `attachments` 中引用 `tempRunId`/`fileName`；edit 的 JSON/multipart 约束以权威 API 清单为准。
- 时间字段：epoch milliseconds number，例如 `1719878400000`。
- 身份与 Scope：Owner Scope 来自 channel/auth 边界；Agent Scope 来自可信 app composition 或已持久化 session/run。请求体、query、path 都不能覆盖当前 `tenantId`、`subjectId`、`agentId`。

错误响应统一为安全错误投影：

```json
{
  "error": {
    "code": "REQUEST_VALIDATION_FAILED",
    "message": "Request validation failed."
  }
}
```

常见 HTTP 状态码：

- `400`：validation / bad request
- `401`：local auth required
- `403`：authorization / forbidden
- `404`：not found
- `409`：conflict
- `410`：gone（例如 share expired）
- `503`：unavailable

## Runtime / Auth / Health

| 方法 | 路径 | 说明 | 关键字段 |
| --- | --- | --- | --- |
| GET | `/api/v1/runtime/bootstrap` | 返回当前 Web stream transport 配置 | Response `{transportKind: "SSE" \| "WEBSOCKET", chatUploadFileConfig?, portalAbilityConfig, guardrail?}` |
| POST | `/api/v1/auth/local/login` | 本地认证登录 | Request `{credential}`；成功后设置 `nextagent_local_auth` Cookie |
| POST | `/api/v1/auth/local/logout` | 退出登录并清理 Cookie | Response `{ok:true}` |
| GET | `/api/v1/health` | 轻量健康检查 | Response `{status,components[],timestamp}` |
| GET | `/api/v1/health/deep` | 深度健康检查 | 结构同 `/api/v1/health` |

## Session

| 方法 | 路径 | 说明 | 关键字段 |
| --- | --- | --- | --- |
| GET | `/api/v1/sessions` | 查询当前 scope 下会话列表 | Query `offset`/`limit`/`q`/`createdFrom`/`createdTo`；Response `entries[]` |
| POST | `/api/v1/sessions` | 创建空会话并绑定 `agentId` | Request `{locale?}`；Response `{sessionId,displayTitle,lastActivityAt}` |
| PUT | `/api/v1/sessions/{sessionId}/title` | 更新会话标题 | Request `{title}`，max 100 |
| DELETE | `/api/v1/sessions/{sessionId}` | 物理删除会话 | Response `204 No Content` |
| POST | `/api/v1/sessions/{sessionId}/files/upload` | 暂存单个附件 | Multipart `tempRunId` + file；Response `{tempRunId,fileName,sizeBytes}` |
| DELETE | `/api/v1/sessions/{sessionId}/files/tmp/{tempRunId}` | 清理暂存附件 | Query `fileName`；Response `204 No Content` |
| GET | `/api/v1/sessions/{sessionId}/conversation` | 查询消息页与可选 `activeRun` | Query `limit`/`cursor`/`newerCursor`/`anchorMessageId`/`includeCapabilityResults` |
| GET | `/api/v1/sessions/{sessionId}/conversation/preview` | 查询会话预览 markers | Query `offset?`/`limit`(required,1–500) |
| POST | `/api/v1/sessions/{sessionId}/activity/consume` | 条件消费 unread activity | Request `{activityId,observedRunId}`；Response `204 No Content` |

`conversation` 的 `cursor`、`newerCursor`、`anchorMessageId` 不能组合使用。

## Request Command

| 方法 | 路径 | 说明 | 关键字段 |
| --- | --- | --- | --- |
| POST | `/api/v1/sessions/{sessionId}/requests` | 在指定会话提交请求 | Request `{inputText,idempotencyKey,locale?,routingConstraints?,attachments?,modelOptions?}` |
| POST | `/api/v1/requests` | 便捷提交；可省 `sessionId` 自动创建会话 | 同上 + 可选 `sessionId` |
| POST | `/api/v1/sessions/{sessionId}/cancel` | 取消最新请求 | Request `{expectedLatestRequestId,action?,idempotencyKey}` |
| POST | `/api/v1/sessions/{sessionId}/retry` | 重试最新已 terminal-committed 请求 | Request `{expectedLatestRequestId,idempotencyKey}` |
| POST | `/api/v1/sessions/{sessionId}/requests/latest/edit` | 编辑并重新提交最新请求 | JSON 或 multipart |
| POST | `/api/v1/sessions/{sessionId}/pending-inputs/{pendingInputId}/answer` | 回答 pending input | Request `{answers:[[string],...]}` |

`submit`、`cancel`、`retry`、`edit` 都需要 `idempotencyKey`。`cancel.action` 当前实际传给 runtime 的固定值是 `CANCEL`。新 request 携带附件时先暂存文件，再以 JSON staged references 提交。

### `RequestAccepted`

提交、重试和编辑成功后统一返回：

```json
{
  "sessionId": "session-1",
  "requestId": "msg-1",
  "runId": "run-1",
  "attempt": 1
}
```

### `routingConstraints`

提交请求时可选，用于约束当前请求路由：

```json
{
  "targetSkill": "troubleshoot-link-flap",
  "targetRecipe": "ospf-diagnosis",
  "forbiddenCapabilityIds": ["dangerous-tool"],
  "executionMode": "default",
  "locale": "zh-CN",
  "allowHumanInput": true,
  "allowSubagents": false
}
```

- 约束 ID 只允许 `A-Z`、`a-z`、`0-9`、`.`、`_`、`:`、`-`，长度 1 到 128；`forbiddenCapabilityIds` 最多 64 个。
- `executionMode` 为 `default` 或 `model-only`（`model-only` 强制 `toolChoice=NONE`，不执行任何 Tool；与 `modelOptions.thinking` 只支持 `depth: "OFF"` 组合）。
- `locale` 需匹配 BCP 47 风格 pattern（`xx` 或 `xx-YY`，总长 2-35）；注意 Web channel 的请求 DTO 只接受 `zh-CN` / `en-US` 两个值，其他 locale 会在 web 层被拒。
- `routingConstraints` 是封闭 schema（`additionalProperties: false`），不支持 `maxToolCalls` 等未列出字段——请求级 Tool 次数控制请使用 Agent 级 `runtimeSettings.maxToolCallsPerTurn`（见 [Agent 配置参考](./03-agent-configuration.md)）。

## Stream

| 方法 | 路径 | 说明 | 关键字段 |
| --- | --- | --- | --- |
| GET | `/api/v1/sessions/{sessionId}/stream` | SSE 流 | Query `lastSeenSequence?`/`requestId?`/`runId?` |
| WS | `/api/v1/sessions/{sessionId}/ws` | WebSocket 流 | Query 同 SSE；每个 text frame 是一个 `StreamEnvelope` |
| GET | `/api/v1/session-activities/stream` | ER 跨会话活动 SSE | 首条 `SNAPSHOT`，之后 `DELTA`；无 query/replay cursor |
| WS | `/api/v1/session-activities/ws` | ER 跨会话活动 WebSocket | 与 Activity SSE 使用相同 strict message shape |

Activity entry 只暴露 `sessionId`、`status` 及状态所需的 `pendingInputKind` 或 `activityId`，不暴露 run、sequence、Owner Scope 或 Agent Scope 字段。

`StreamEnvelope` 结构：

```json
{
  "eventId": "stream:evt-1",
  "sessionId": "session-1",
  "requestId": "msg-1",
  "runId": "run-1",
  "requestContextId": "ctx-1",
  "sequence": 42,
  "eventType": "LLM_CONTENT_DELTA",
  "timelineEventRef": "evt-1",
  "transportHints": [],
  "payload": {
    "rootMessageId": "msg-1",
    "requestId": "msg-1",
    "runId": "run-1",
    "requestContextId": "ctx-1",
    "content": "诊断结果...",
    "text": "诊断结果...",
    "contentType": "MARKDOWN",
    "role": "ASSISTANT",
    "metadata": {
      "accumulated": true
    }
  },
  "createdAt": 1782900000000
}
```

公开 `eventType`（完整清单与各事件 payload 细节见 [流式事件](./09-streaming-events.md)；客户端必须容忍未知事件类型）：

```text
REQUEST_ACCEPTED
LLM_THINKING_DELTA
LLM_CONTENT_DELTA
CAPABILITY_STARTED
CAPABILITY_RESULT_DELTA
CAPABILITY_COMPLETED
TOOL_STRUCTURED_DELTA
DEGRADATION_NOTICE
REQUEST_COMPLETED
REQUEST_FAILED
REQUEST_CANCELED
REQUEST_SUPERSEDED
USER_INPUT_REQUIRED
USER_INPUT_RECEIVED
USER_INPUT_TIMEOUT
USER_INPUT_CANCELED
ATTACHMENT_ACCEPTED
ATTACHMENT_REJECTED
CONTEXT_COMPACTED
BACKGROUND_TASK_STARTED
BACKGROUND_TASK_COMPLETED
BACKGROUND_TASK_FAILED
OUTPUT_GUARD_BLOCKED
```

事件协议、重连恢复和 payload 细节详见 [流式事件](./09-streaming-events.md)。

## Task Channel

Task Channel 是面向后台服务（网管系统、告警平台、编排系统）的机机接口，按交付模式拆分为三套路由树：`stream-task`（POST 直接返回 SSE）、`async-tasks`（JSON + callback）、`tasks`（cancel/query/answer 共享 JSON）。与 Web channel 并行注册于同一 Fastify instance。身份通过 HTTP header 注入（`x-tenant-id`、`x-subject-id`、`x-display-name`），不做 credential validation。`taskId` 映射内部 `requestId`，task 与 session 1:1。

完整字段定义、约束、枚举值和异常说明详见 [`../apis/task-channel-api.md`](../apis/task-channel-api.md)。

| 方法 | 路径 | 说明 | 关键字段 |
| --- | --- | --- | --- |
| POST | `/api/v1/stream-task` | 流式创建（直接返回 SSE） | Request `{taskMessages,locale?,idempotencyKey?,reportEvents?}`；Response SSE |
| POST | `/api/v1/stream-task/:taskId/edit` | 流式编辑（返回 SSE） | Request `{sessionId,taskMessages,idempotencyKey,locale?,reportEvents?}`；Response SSE |
| POST | `/api/v1/stream-task/:taskId/retry` | 流式重试（返回 SSE） | Request `{sessionId,idempotencyKey,reportEvents?}`；Response SSE |
| POST | `/api/v1/async-tasks` | 异步批量创建 | Request `{tasks:[{taskMessages,callbackTarget,locale?,reportEvents?}]}`；Response `{results:[{sessionId,taskId,taskStatus}]}` |
| POST | `/api/v1/async-tasks/edit` | 异步批量编辑 | Request `{tasks:[{taskId,sessionId,taskMessages,idempotencyKey,locale?}]}`；Response `{results:[{sessionId,taskId,taskStatus}]}` |
| POST | `/api/v1/async-tasks/retry` | 异步批量重试 | Request `{tasks:[{taskId,sessionId,idempotencyKey}]}`；Response `{results:[{sessionId,taskId,taskStatus,attempt}]}` |
| POST | `/api/v1/tasks/cancel` | 批量取消 | Request `{tasks:[{taskId,sessionId}]}`；Response `{results:[{sessionId,taskId,taskStatus:TASK_CANCELED}]}` |
| POST | `/api/v1/tasks/query` | 批量查询 | Request `{tasks:[{sessionId,taskId}]}`；Response `{results:[{sessionId,taskId,taskStatus,data?}]}` |
| POST | `/api/v1/tasks/pending-inputs/answer` | 回答 pending input | Request `{tasks:[{taskId,pendingInputId,sessionId,answers:string[][]}]}`；Response `{results:[{sessionId,taskId,taskStatus:TASK_EXECUTING}]}` |

`reportEvents` 为预留参数（`"ALL"`/`"TERMINAL"`/string[]），事件过滤引擎暂不实现。stream-task 默认 `ALL`，async-tasks 默认 `TERMINAL`。channel 层始终过滤 4 个内部事件类型（`BACKGROUND_TASK_*`、`OUTPUT_GUARD_BLOCKED`）。Edit 产生新 `taskId`（runtime 创建新 requestId），retry 保持同一 `taskId`（`attempt` 递增）。create 不接受 `sessionId`（task 与 session 1:1）。

`taskMessages` 中的 `text` 支持 capability directive：`$skill:<name>` 指定目标 skill，`$workflow:<name>` 指定目标 workflow recipe。directive 在每次执行时从 inputText 重新解析。详见 [`../apis/task-channel-api.md`](../apis/task-channel-api.md)。

### `TaskStatus`

由 `RunStatus` 加 `TASK_` 前缀映射，1:1 无损：

```text
TASK_ACCEPTED / TASK_PENDING / TASK_QUEUED / TASK_PLANNING / TASK_EXECUTING
TASK_COMPLETED / TASK_FAILED / TASK_CANCELED / TASK_SUPERSEDED
```

### `TaskEventType`

SSE 和 async callback 两条路径统一使用。由 `StreamEventType` 映射：`REQUEST_` -> `TASK_`，移除 `LLM_` 前缀。channel 层始终过滤 4 个内部事件类型（`BACKGROUND_TASK_*`、`OUTPUT_GUARD_BLOCKED`）不推送给消费方：

```text
TASK_ACCEPTED / THINKING_DELTA / CONTENT_DELTA
CAPABILITY_STARTED / CAPABILITY_RESULT_DELTA / CAPABILITY_COMPLETED
TOOL_STRUCTURED_DELTA / DEGRADATION_NOTICE
TASK_COMPLETED / TASK_FAILED / TASK_CANCELED / TASK_SUPERSEDED
USER_INPUT_REQUIRED / USER_INPUT_RECEIVED / USER_INPUT_TIMEOUT / USER_INPUT_CANCELED
ATTACHMENT_ACCEPTED / ATTACHMENT_REJECTED / CONTEXT_COMPACTED
```

Task channel SSE 使用与 Web channel 相同的 `StreamEnvelope` 格式投影为 `TaskEvent`。async callback 使用 `{ events: TaskEvent[] }`。

## IR Surface

IR（机机交互）surface 面向外部系统的程序化调用，路径前缀 `/api/v1/ir`。已列出的 6 个 IR 端点与各自 ER 对应端点保持相同协议、DTO、schema 和 stream 行为，区别仅在身份来源（trusted-header 而非 cookie）和 URL prefix。身份通过 `x-tenant-id`、`x-subject-id`、`x-display-name` 请求头注入，上游网关已认证，NextAgent 只读不校验。Agent Scope 仍来自 `session.agentId`，不从 header 取。

完整字段定义、约束和示例详见 [`../apis/agent-web-api-list.md`](../apis/agent-web-api-list.md#ir-surface)。

| 方法 | 路径 | 说明 | 关键字段 |
| --- | --- | --- | --- |
| POST | `/api/v1/ir/sessions` | 创建会话 | 同 `POST /api/v1/sessions` |
| POST | `/api/v1/ir/sessions/{sessionId}/requests` | 提交请求 | 同 `POST /api/v1/sessions/{sessionId}/requests` |
| GET | `/api/v1/ir/sessions/{sessionId}/stream` | SSE stream | Query `lastSeenSequence?`/`requestId?`/`runId?` |
| POST | `/api/v1/ir/sessions/{sessionId}/cancel` | 取消请求 | 同 `POST /api/v1/sessions/{sessionId}/cancel` |
| POST | `/api/v1/ir/sessions/{sessionId}/retry` | 重试请求 | 同 `POST /api/v1/sessions/{sessionId}/retry` |
| POST | `/api/v1/ir/sessions/{sessionId}/pending-inputs/{pendingInputId}/answer` | 回答 pending input | 同 `POST /api/v1/sessions/{sessionId}/pending-inputs/{pendingInputId}/answer` |

IR 与 ER 认证隔离：IR 路由只认 header，ER 路由只认 cookie，互不交叉。IR 不暴露 Activity SSE、Activity WebSocket、activity consume，也不暴露 bootstrap、skills、conversation、annotations、shares 等 UI 专属端点。

## Annotation / Favorite / Share

| 方法 | 路径 | 说明 | 关键字段 |
| --- | --- | --- | --- |
| POST | `/api/v1/sessions/{sessionId}/runs/{runId}/annotations` | 写入/更新反馈、收藏 | Request `{sentiment?:UP\|DOWN\|null,isFavorited?,isQuestionFavorited?}` |
| GET | `/api/v1/sessions/{sessionId}/annotations` | 查询会话 annotations | Response `{annotations[]}` |
| GET | `/api/v1/favorites` | 查询收藏会话列表 | Query `offset`/`limit`（max 100） |
| POST | `/api/v1/sessions/{sessionId}/shares` | 创建分享链接 | Request `{runIds,originUrl,expiresIn,allowedOps}` |
| GET | `/api/v1/shares/{shareId}/conversation` | 读取分享内容 | Header `X-Viewer-Ops`（JSON 字符串数组） |

`sentiment` 可为 `UP`、`DOWN`、`null`。`expiresIn` 可为 `24h`、`7d`、`30d`、`permanent`。

## Skill / Suggested Questions

| 方法 | 路径 | 说明 | 关键字段 |
| --- | --- | --- | --- |
| GET | `/api/v1/skills` | 查询当前 Agent Scope 可用 skill catalog | Query `pageNum`/`pageSize`(1–100)/`keyword` |
| POST | `/api/v1/sessions/{sessionId}/requests/{requestId}/suggested-questions` | 生成推荐追问 | 当前 body 为空对象即可 |
| GET | `/api/v1/category-questions` | 分类问题（按 locale） | Query `locale?`；Response `{locale,categories[]}` |

`providerKind` 可为 `BUNDLED`、`LOCAL_DIRECTORY`、`SKILL_HUB`。

## Frequent Questions / Question Association

| 方法 | 路径 | 说明 | 关键字段 |
| --- | --- | --- | --- |
| GET | `/api/v1/frequent-questions` | 高频/常问问题动态排序列表 | Query `locale?`；Response `{locale,questions[]}` |
| GET | `/api/v1/question-association` | 输入联想（关键词匹配） | Query `keyword`(required)/`locale?`；空 keyword 返回 `400` |

## 其他端点索引

以下能力端点本篇不展开，完整字段以 [`../apis/agent-web-api-list.md`](../apis/agent-web-api-list.md) 为准：

- **事件历史回放**：`GET /api/v1/sessions/{sessionId}/runs/{runId}/events` — 查询一个 run 的持久化 timeline 事件（客户端断线补历史手段之一）。
- **长期记忆**：`/api/v1/memory/long-term-mem` 下的增删改查、搜索、批量、共享（copy/publish/unpublish）等 14 个端点。
- **定时任务（Cron）**：`/api/v1/cron-tasks` 的增删改查与 run 查询（6 个端点）。
- **后台任务**：`GET /api/v1/sessions/{sessionId}/background-tasks`、`GET .../background-tasks/{taskId}/output`、`POST .../background-tasks/{taskId}/kill`。
- **Fork**：`POST /api/v1/sessions/{sessionId}/messages/{messageId}/fork`、`POST .../requests/{requestId}/fork`。
- **文件下载**：`GET /api/v1/sessions/{sessionId}/files/download`。
- **能力呈现资源**：`GET /api/v1/sessions/{sessionId}/capability-presentation-resources`。

## SessionMessage

会话消息来自 `agent-contracts/session`：

```json
{
  "messageId": "msg-1",
  "sessionId": "session-1",
  "requestId": "msg-1",
  "runId": "run-1",
  "role": "ASSISTANT",
  "content": "诊断结论...",
  "contentType": "MARKDOWN",
  "metadata": {},
  "sequence": 2,
  "visible": true,
  "hiddenByContextId": "ctx-old",
  "createdAt": 1782900000000
}
```

`role` 取值：`USER`、`ASSISTANT`、`CAPABILITY_RESULT`、`SUMMARY`。`contentType` 取值：`PLAIN_TEXT`、`MARKDOWN`、`MERMAID`。

## 典型 curl 流程

带本地认证的完整流程：

```bash
#!/bin/bash
BASE=http://127.0.0.1:3000
COOKIE=cookies.txt

curl -s -X POST "$BASE/api/v1/auth/local/login" \
  -H "Content-Type: application/json" \
  -d '{"credential":"local-secret"}' \
  -c "$COOKIE"

curl -s "$BASE/api/v1/runtime/bootstrap" -b "$COOKIE"

SESSION=$(
  curl -s -X POST "$BASE/api/v1/sessions" \
    -H "Content-Type: application/json" \
    -b "$COOKIE" \
    -d '{"locale":"zh-CN"}' \
  | sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p'
)

curl -N -s "$BASE/api/v1/sessions/$SESSION/stream" -b "$COOKIE" &
SSE_PID=$!

curl -s -X POST "$BASE/api/v1/sessions/$SESSION/requests" \
  -H "Content-Type: application/json" \
  -b "$COOKIE" \
  -d '{"inputText":"分析小区掉话率升高原因","idempotencyKey":"idem-001","locale":"zh-CN"}'

sleep 5
curl -s "$BASE/api/v1/sessions/$SESSION/conversation?includeCapabilityResults=true" -b "$COOKIE"

kill "$SSE_PID" 2>/dev/null
```

便捷提交并自动创建会话：

```bash
curl -s -X POST "$BASE/api/v1/requests" \
  -H "Content-Type: application/json" \
  -b "$COOKIE" \
  -d '{"inputText":"检查链路 flap 原因","idempotencyKey":"demo-002","locale":"zh-CN"}'
```

Staged 附件上传并提交引用：

```bash
curl -s -X POST "$BASE/api/v1/sessions/$SESSION/files/upload" \
  -b "$COOKIE" \
  -F "tempRunId=upload_batch_001" \
  -F "file=@./report.md;type=text/markdown"

curl -s -X POST "$BASE/api/v1/sessions/$SESSION/requests" \
  -H "Content-Type: application/json" \
  -b "$COOKIE" \
  -d '{"inputText":"分析这份巡检报告","idempotencyKey":"demo-file-001","locale":"zh-CN","attachments":[{"tempRunId":"upload_batch_001","fileName":"report.md"}]}'
```

## 当前代码位置

| 内容 | 路径 |
| --- | --- |
| Web channel 路由（REST + stream 注册） | `packages/agent-channel-web/src/routes/requests.ts` |
| 请求 DTO schema | `packages/agent-channel-web/src/schemas/*.ts` |
| Activity wire schema | `packages/agent-channel-web/src/schemas/session-activity-dto.ts` |
| SSE 投影与发送 | `packages/agent-channel-web/src/projections/stream-envelope.ts` |
| WebSocket stream | `packages/agent-channel-web/src/transports/websocket.ts` |
| 本地认证插件 | `packages/agent-channel-web-auth-local/src/index.ts` |
| StreamEnvelope / StreamEventType 契约 | `packages/agent-contracts/src/channel/index.ts` |
| Runtime / session 契约 | `packages/agent-contracts/src/runtime/index.ts`、`packages/agent-contracts/src/session/index.ts` |

## 相关资源

- 完整 API 字段与示例：[`../apis/agent-web-api-list.md`](../apis/agent-web-api-list.md)
- Task Channel 完整接口文档：[`../apis/task-channel-api.md`](../apis/task-channel-api.md)
- [流式事件](./09-streaming-events.md)
- [会话与状态管理](./07-session-state-management.md)
- [上下文管理](./08-context-management.md)
- OpenSpec 相关 changes / specs：`ts-web-sse-ws-transports`、`ts-web-command-idempotency`、`session-delete`、`request-cancel`、`request-retry`、`add-ts-task-channel`、`add-ts-cross-session-activity-awareness`
