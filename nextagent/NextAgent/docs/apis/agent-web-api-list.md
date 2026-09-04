# agent-web API 接口列表

本文档是 agent-web-channel 对外接口的权威文档。每个接口条目均按固定模板描述：Path 参数、Query 参数、Headers、Body / Multipart、Success response、Error responses、字段表和示例。可执行 schema 由 `packages/agent-channel-web/src/schemas`、`packages/agent-channel-web/src/routes/requests.ts` 与 `packages/agent-channel-web-auth-local/src/index.ts` 维护。

## 通用约定

- Base URL：agent-web 通过运行时配置或同源地址访问后端，例如 `http://127.0.0.1:3000`。
- JSON 请求：`Content-Type: application/json`。
- 本地认证模式：认证成功后使用 `nextagent_local_auth` HttpOnly Cookie，agent-web 请求默认携带 Cookie。
- 时间字段：epoch milliseconds number，例如 `1719878400000`。
- Owner Scope 来自 channel/auth 边界；Agent Scope 来自可信 app composition 或已持久化 session/run。请求体、query、path 不得覆盖当前 `tenantId`、`subjectId` 或 `agentId`。

### 通用错误响应

除 local auth challenge 外，Web channel 错误响应使用 safe error shape：

```json
{
  "error": {
    "code": "REQUEST_VALIDATION_FAILED",
    "message": "Request validation failed."
  }
}
```

| HTTP | code | message |
| --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `{field} is required.` / `{field} must not exceed {n} characters.` / `Field '{name}' is not allowed.` / `{field} value is not allowed.` / `{field} format is invalid.` / `{field} must not be empty.` / `{field} must contain at least {n} item(s).` / `{field} must not exceed {n} items.` / `{field} must be at least {n}.` / `{field} must not exceed {n}.` |
| 400 | `WEB_RUNTIME_BOOTSTRAP_TRANSPORT_INVALID` | `Web runtime bootstrap transport is invalid.` |
| 400 | `INVALID_KEYWORD` | `Keyword must not be empty.` |
| 400 | `INVALID_QUESTION` | `Question text must not be empty.` |
| 400 | `WEBSOCKET_HANDSHAKE_INVALID` | `WebSocket stream failed safely.` |
| 400 | `WEBSOCKET_STREAM_QUERY_INVALID` | `WebSocket stream failed safely.` |
| 401 | `LOCAL_AUTH_REQUIRED` | 认证边界返回的 safe auth-required message。 |
| 403 | safe authorization code | runtime/session/share 边界返回的 safe message。 |
| 404 | safe not-found code | runtime/session/share 边界返回的 safe message。 |
| 404 | `BACKGROUND_TASK_OUTPUT_UNAVAILABLE` | `Background task output is unavailable.` |
| 404 | `CRON_TASK_NOT_FOUND` | `No Cron task with id '<taskId>'.` |
| 409 | safe conflict code | runtime command/session 边界返回的 safe message。 |
| 409 | `CRON_TASK_NOT_ACTIVE` | `Cron task is not active.` |
| 409 | `CRON_TASK_UPDATE_CONFLICT` | `Cron task update conflicted.` |
| 409 | `CRON_TASK_LIMIT_REACHED` | `Cron task limit reached. Delete an existing active task or wait for a one-shot task to complete.` |
| 410 | `SHARE_EXPIRED` | share 边界返回的 safe message。 |
| 503 | safe unavailable code | runtime/session/catalog 边界返回的 safe message。 |
| 503 | `CRON_TASKS_UNAVAILABLE` | `Cron task management service is unavailable.` |
| 503 | `CATEGORY_QUESTION_UNAVAILABLE` | `Category question service is temporarily unavailable.` |
| 503 | `FREQUENT_QUESTION_UNAVAILABLE` | `Frequent question service is temporarily unavailable.` |
| 503 | `QUESTION_ASSOCIATION_UNAVAILABLE` | `Question association service is temporarily unavailable.` |
| 503 | `USER_QUESTION_ACTIVITY_UNAVAILABLE` | `User question activity storage is unavailable.` 或 `Failed to pin question.` |
| 503 | `ANNOTATIONS_UNAVAILABLE` | `Annotations service is unavailable.` |
| 503 | `SHARES_UNAVAILABLE` | `Shares service is unavailable.` |
| 503 | `ATTACHMENT_DEPENDENCY_UNAVAILABLE` | `Attachment intake dependencies are unavailable.` |

## Runtime / Auth / Health

### GET /api/v1/runtime/bootstrap

描述：获取 agent-web 运行时启动配置，当前用于选择流式传输方式。

Path 参数：无。

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Cookie` | 否 | 启用本地认证时携带 `nextagent_local_auth`。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回 Web channel transport 配置。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `transportKind` | `"SSE"` \| `"WEBSOCKET"` | 是 | agent-web 应使用的 stream transport。 |

```json
{
  "transportKind": "SSE"
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `WEB_RUNTIME_BOOTSTRAP_TRANSPORT_INVALID` | `Web runtime bootstrap transport is invalid.` | 运行时配置了不支持的 transport。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 本地认证启用且未认证。 |

示例：

```bash
curl -X GET "$BASE_URL/api/v1/runtime/bootstrap" -b cookies.txt
```

### POST /api/v1/auth/local/login

描述：本地配置认证模式登录。成功后设置 `nextagent_local_auth` HttpOnly Cookie。

Path 参数：无。

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | `application/json`。 |

Body / Multipart：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `credential` | string | 是 | 本地认证凭据。 |

```json
{
  "credential": "local-secret"
}
```

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回认证后的本地身份，并通过 `Set-Cookie` 设置登录态。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `identity` | object | 是 | 当前 Web 身份。 |
| `identity.tenantId` | string | 是 | Owner Scope tenant。 |
| `identity.subjectId` | string | 是 | Owner Scope subject。 |
| `identity.displayName` | string | 否 | 展示名。 |

```json
{
  "identity": {
    "tenantId": "local",
    "subjectId": "operator",
    "displayName": "Operator"
  }
}
```

Error responses：

| HTTP | code / error | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | Fastify validation error | validation message | 请求体缺少 `credential` 或包含额外字段。 |
| 401 | `Authentication failed` | `Authentication failed` | 凭据不匹配。local auth challenge 使用 legacy challenge shape，不使用 safe error shape。 |

```json
{
  "error": "Authentication failed",
  "authMode": "LOCAL_CONFIG",
  "loginUrl": "/login",
  "iamStatus": null,
  "localLoginEnabled": true
}
```

示例：

```bash
curl -X POST "$BASE_URL/api/v1/auth/local/login" \
  -H "Content-Type: application/json" \
  -d '{"credential":"local-secret"}' \
  -c cookies.txt
```

### POST /api/v1/auth/local/logout

描述：本地配置认证模式退出登录，清理本地认证 Cookie。

Path 参数：无。

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Cookie` | 否 | 当前登录 Cookie；未携带时仍返回成功并清理响应 Cookie。 |
| `Content-Type` | 否 | 可为 `application/json`。 |

Body / Multipart：无请求体或空 JSON 对象。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 退出登录成功。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean | 是 | 固定为 `true`。 |

```json
{
  "ok": true
}
```

Error responses：

| HTTP | code / error | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | Fastify validation error | validation message | 请求体不是合法 JSON。 |

示例：

```bash
curl -X POST "$BASE_URL/api/v1/auth/local/logout" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{}'
```

### GET /api/v1/health

描述：轻量健康检查。

Path 参数：无。

Query 参数：无。

Headers：无。

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 系统健康或降级但仍可响应。 |
| 503 | `application/json` | 系统不可用；响应体仍为 health response。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `status` | `"UP"` \| `"DOWN"` \| `"DEGRADED"` | 是 | 总体健康状态。 |
| `components` | array | 是 | 组件健康状态列表。 |
| `components[].name` | string | 是 | 组件名。 |
| `components[].status` | `"UP"` \| `"DOWN"` \| `"DEGRADED"` | 是 | 组件状态。 |
| `components[].summary` | string | 否 | safe 摘要。 |
| `components[].reasonCode` | string | 否 | safe reason code。 |
| `components[].latencyMs` | number | 否 | 组件检查耗时。 |
| `timestamp` | number | 是 | 检查时间。 |

```json
{
  "status": "UP",
  "components": [
    {
      "name": "runtime_authority",
      "status": "UP",
      "latencyMs": 3
    }
  ],
  "timestamp": 1719878400000
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 503 | health response | component summary | 深度依赖不可用时以 health response 返回，不使用 safe error shape。 |

示例：

```bash
curl -X GET "$BASE_URL/api/v1/health"
```

### GET /api/v1/health/deep

描述：深度健康检查。

Path 参数：无。

Query 参数：无。

Headers：无。

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 深度健康检查通过或降级但仍可响应。 |
| 503 | `application/json` | 深度健康检查失败；响应体仍为 health response。 |

字段表：同 `GET /api/v1/health`。

```json
{
  "status": "UP",
  "components": [],
  "timestamp": 1719878400000
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 503 | health response | component summary | 深度依赖不可用时以 health response 返回，不使用 safe error shape。 |

示例：

```bash
curl -X GET "$BASE_URL/api/v1/health/deep"
```

## Session

### GET /api/v1/sessions

描述：查询当前身份和当前 Agent Scope 下的会话列表，支持分页、问题文本搜索和最后活动时间范围过滤。

Path 参数：无。

Query 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `offset` | integer string | 否 | 非负整数，默认 `0`。 |
| `limit` | integer string | 否 | 正整数；普通列表默认 `50`，最大 `200`；搜索场景默认 `20` 且最大 `50`。 |
| `q` | string | 否 | 问题搜索文本；trim 后 ASCII 至少 3 个字符，非 ASCII 至少 2 个字符，最大 50 个字符。 |
 | `createdFrom` | epoch milliseconds string | 否 | 沿用的参数名；语义为最后活动时间下界，必须和 `createdTo` 同时提供。必须为非负整数（epoch 0 即 1970-01-01 00:00:00 UTC 为合法下界）。 |
 | `createdTo` | epoch milliseconds string | 否 | 沿用的参数名；语义为最后活动时间上界，必须大于等于 `createdFrom`，`createdTo - createdFrom` 最大为 `7,775,999,999` 毫秒（90 天减 1 毫秒）。必须为非负整数。 |

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回会话分页。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `entries` | array | 是 | 会话摘要列表。 |
| `entries[].sessionId` | string | 是 | 会话 ID。 |
| `entries[].displayTitle` | string | 是 | Web 展示标题。 |
| `entries[].lastActivityAt` | number | 是 | 最近活动时间。 |
| `entries[].lastRunStatus` | string | 否 | 最近运行状态。 |
| `entries[].hasInFlightRequest` | boolean | 是 | 是否存在未完成请求。 |
| `offset` | integer | 是 | 当前偏移。 |
| `limit` | integer | 是 | 当前页大小。 |
| `hasMore` | boolean | 是 | 是否还有下一页。 |

```json
{
  "entries": [
    {
      "sessionId": "sess_123",
      "displayTitle": "基站故障诊断",
      "lastActivityAt": 1719878400000,
      "lastRunStatus": "COMPLETED",
      "hasInFlightRequest": false
    }
  ],
  "offset": 0,
  "limit": 50,
  "hasMore": false
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `q must not exceed 50 characters.` / `createdFrom format is invalid.` / `offset format is invalid.` / `limit format is invalid.` / `Field '{name}' is not allowed.` | query schema 不合法。 |
| 400 | `REQUEST_VALIDATION_FAILED` | `offset must be an integer.` / `offset must be a finite safe integer.` / `offset must be a non-negative integer.` | `offset` 不是合法非负整数。 |
| 400 | `REQUEST_VALIDATION_FAILED` | `limit must be a positive integer.` / `search limit must not exceed 50.` / `limit must not exceed 200.` | `limit` 不是合法正整数或超过上限。 |
| 400 | `REQUEST_VALIDATION_FAILED` | `q length is invalid.` | `q` trim 后超过 50 个字符。 |
 | 400 | `REQUEST_VALIDATION_FAILED` | `createdFrom and createdTo must be provided together.` / `createdFrom must be an integer.` / `createdTo must be an integer.` / `createdFrom must be a non-negative epoch millisecond.` / `createdTo must be a non-negative epoch millisecond.` / `createdFrom must be less than or equal to createdTo.` / `created time range must not exceed 90 days.` / `createdTo must not be later than the end of today.` | 最后活动时间范围参数不合法。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 503 | safe unavailable code | safe message | session query 依赖不可用。 |

示例：

```bash
curl -X GET "$BASE_URL/api/v1/sessions?offset=0&limit=20&q=%E5%9F%BA%E7%AB%99" \
  -b cookies.txt
```

### POST /api/v1/sessions

描述：创建新会话。

Path 参数：无。

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | `application/json`。 |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `locale` | string | 否 | 会话 locale；枚举 `"zh-CN"` | `"en-US"`。 |

```json
{
  "locale": "zh-CN"
}
```

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回新会话摘要。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID。 |
| `displayTitle` | string | 是 | 展示标题。 |
| `lastActivityAt` | number | 是 | 最近活动时间。 |

```json
{
  "sessionId": "sess_123",
  "displayTitle": "Untitled session",
  "lastActivityAt": 1719878400000
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `locale value is not allowed.` / `Field '{name}' is not allowed.` | 请求体 schema 不合法。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 503 | safe unavailable code | safe message | session 创建依赖不可用。 |

示例：

```bash
curl -X POST "$BASE_URL/api/v1/sessions" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"locale":"zh-CN"}'
```

### PUT /api/v1/sessions/{sessionId}/title

描述：更新会话标题。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID。 |

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | `application/json`。 |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `title` | string | 是 | 手工标题；Web body 原始值不得超过 100 个字符，进入 session owner 后 trim，trim 后必须为 1–100 个字符且不能为空。 |

```json
{
  "title": "新的会话标题"
}
```

手工标题规则：

- Web schema 先按原始字符串执行 100 字符上限校验；session owner 再 trim 首尾空白，并拒绝 trim 后为空的标题。
- trim 后 1–100 字符的标题允许进入安全校验；匹配当前 secret 或 XSS 敏感模式时会被安全拒绝，错误消息按命中类别（XSS / secret）区分且不包含被拒绝的标题内容。
- 有效标题按 trim 后的值保存，不套用自动标题的标点清理或 40 字符截断规则。
- 任意成功更新都会把持久化 `titleSource` 设为 `manual`，后续自动标题生成不得覆盖。`titleSource` 是内部持久化事实，不在当前 Web session response 中公开。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回更新后的会话摘要。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID。 |
| `displayTitle` | string | 是 | 新展示标题。 |
| `lastActivityAt` | number | 是 | 最近活动时间。 |

```json
{
  "sessionId": "sess_123",
  "displayTitle": "新的会话标题",
  "lastActivityAt": 1719878400000
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `{field} is required.` / `{field} must not be empty.` / `{field} must not exceed {n} characters.` 等具体字段校验消息 | path 或 body schema 不合法。 |
| 400 | `SESSION_TITLE_TOO_SHORT` | `Session title must be 1-100 characters.` | 标题 trim 后为空。 |
| 400 | `SESSION_TITLE_UNSAFE_CONTENT` | `Session title must not contain HTML tags, javascript: URLs, or event handlers.`（匹配 XSS 模式）/ `Session title must not contain credentials, API keys, or secrets.`（匹配 secret 模式） | trim 后标题匹配 secret 或 XSS 敏感模式；错误消息不包含被拒绝的标题内容。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message（local 模式 `Authentication required.`，remote 模式 `Identity headers are required.`） | 未认证。 |
| 403 | `SESSION_ACCESS_DENIED` | `Session does not belong to the current user.` | 当前身份无权更新该会话（owner scope 不匹配）。 |
| 404 | `SESSION_NOT_FOUND` | `Session was not found.` | 当前 owner 和 Agent Scope 下找不到会话。 |
| 404 | `NOT_FOUND` | `Route not found.` | 路径不匹配已注册路由（如 `sessionId` 路径段为空导致路由折叠）。 |

示例：

```bash
curl -X PUT "$BASE_URL/api/v1/sessions/sess_123/title" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"title":"新的会话标题"}'
```

首尾空白会在 session owner 中移除：

```bash
curl -X PUT "$BASE_URL/api/v1/sessions/sess_123/title" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"title":"  网络巡检  "}'
```

### DELETE /api/v1/sessions/{sessionId}

描述：删除当前身份和 Agent Scope 下的会话。删除成功返回 `204 No Content`。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID。 |

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 204 | 无 | 删除成功，无响应体。 |

字段表：无响应字段。

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `sessionId must not exceed 256 characters.` | path schema 不合法。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | safe authorization code | safe message | 当前身份无权删除该会话。 |
| 404 | safe not-found code | safe message | 会话不存在。 |

示例：

```bash
curl -X DELETE "$BASE_URL/api/v1/sessions/sess_123" -b cookies.txt -i
```

### GET /api/v1/sessions/{sessionId}/runs/{runId}/events

描述：读取当前身份、当前 Agent Scope、指定 session 和 native run 下已经持久化的过程事件。响应事件使用与 SSE、WebSocket 和 resume 相同的 `StreamEnvelope` projector；接口不会从 final message 推断 live-only thinking 或 content delta。B305 fork 没有 child-owned event snapshot，无法解析为 child native run 时返回明确的 legacy-unavailable 状态，且不会回查 source session。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 当前 owner 和 Agent Scope 下的会话 ID。 |
| `runId` | string | 是 | 从可见 message 得到的 display run ID。 |

Query 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `afterSequence` | non-negative safe integer | 否 | exclusive timeline cursor，默认 `0`。 |
| `limit` | integer | 否 | 每页 canonical event 上限，默认 `100`，范围 `1..1000`。 |

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回 AVAILABLE event page 或 B305 fork legacy-unavailable 状态。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `availability` | `"AVAILABLE"` \| `"LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE"` | 是 | 当前 run 过程历史的可用状态。 |
| `events` | `StreamEnvelope[]` | 是 | shared projector 允许公开的已持久化事件；legacy-unavailable 时必须为空。 |
| `nextAfterSequence` | non-negative safe integer | 否 | 下一页 exclusive cursor；legacy-unavailable 时禁止出现。 |

AVAILABLE 示例：

```json
{
  "availability": "AVAILABLE",
  "events": [
    {
      "eventId": "stream_7",
      "sessionId": "sess_123",
      "requestId": "msg_root_1",
      "runId": "run_1",
      "sequence": 7,
      "eventType": "CAPABILITY_STARTED",
      "transportHints": [],
      "payload": {
        "rootMessageId": "msg_root_1",
        "requestId": "msg_root_1",
        "runId": "run_1",
        "capabilityId": "network-diagnosis",
        "toolCallId": "tool_call_1",
        "status": "RUNNING",
        "text": "RUNNING",
        "contentType": "PLAIN_TEXT",
        "metadata": {
          "accumulated": true
        }
      },
      "createdAt": 1719878400000
    }
  ],
  "nextAfterSequence": 7
}
```

B305 fork compatibility 示例：

```json
{
  "availability": "LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE",
  "events": []
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | safe validation message | path/query schema 不合法。 |
| 400 | `SESSION_EVENT_HISTORY_PAGINATION_INVALID` | safe validation message | runtime 收到越界或非 safe-integer pagination。 |
| 400 | `SESSION_EVENT_HISTORY_RECORD_INVALID` | safe validation message | 持久化 event 坐标、顺序或 payload 校验失败；整页失败。 |
| 400 | safe stream projection code | `Timeline event cannot be projected to the public stream.` | 任一 canonical event 无法安全投影；不返回 partial page。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | safe authorization code | safe message | 当前身份无权访问该会话。 |
| 404 | `SESSION_EVENT_HISTORY_NOT_FOUND` | `Session event history is not visible.` | native run 不存在、不属于该 session 或不可见，且不是 B305 fork compatibility case。 |
| 503 | safe unavailable code | safe message | session、run 或 timeline store 暂时不可用。 |

示例：

```bash
curl -X GET \
  "$BASE_URL/api/v1/sessions/sess_123/runs/run_1/events?afterSequence=0&limit=1000" \
  -b cookies.txt
```

### GET /api/v1/sessions/{sessionId}/conversation

描述：读取会话消息页，并返回当前活跃运行摘要。`cursor`、`newerCursor`、`anchorMessageId` 不能组合使用。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID。 |

Query 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `limit` | integer string | 否 | 正整数，默认 `50`，最大 `200`。 |
| `cursor` | string | 否 | before cursor，用于向历史方向翻页。 |
| `newerCursor` | string | 否 | after cursor，用于加载更新消息。 |
| `anchorMessageId` | string | 否 | 锚点消息 ID。 |
| `includeCapabilityResults` | string | 否 | 字符串 `"true"` 时包含 capability result；其他值视为 false。 |

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回会话消息页和可选 active run。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `items` | array | 是 | 消息列表。 |
| `items[].messageId` | string | 是 | 消息 ID。 |
| `items[].sessionId` | string | 是 | 会话 ID。 |
| `items[].requestId` | string | 否 | 请求 ID。 |
| `items[].runId` | string | 否 | 运行 ID。 |
| `items[].role` | string | 是 | 消息角色。 |
| `items[].sequence` | number | 是 | 会话内序号。 |
| `items[].content` | string | 是 | 展示文本。 |
| `items[].contentType` | string | 是 | 内容类型。 |
| `items[].metadata` | object | 是 | safe metadata。 |
| `items[].createdAt` | number | 是 | 创建时间。 |
| `items[].visible` | boolean | 是 | 是否可见。 |
| `nextCursor` | string | 否 | 历史方向（更旧）下一页 cursor。出现条件：当前页之外**还有更旧消息**时返回，值为当前页最旧消息的 `messageId`；作为 `cursor` 参数继续向历史方向翻页。无更旧消息时不返回。 |
| `newerCursor` | string | 否 | 更新方向（更新）下一页 cursor。出现条件：当前页之外**还有更新消息**时返回，值为当前页最新消息的 `messageId`；作为 `newerCursor` 参数继续向更新方向翻页。无更新消息时不返回。 |

`nextCursor` 与 `newerCursor` 出现规则（按请求参数，`cursor`/`newerCursor`/`anchorMessageId` 三者互斥）：

| 请求参数 | `nextCursor`（更旧方向） | `newerCursor`（更新方向） |
| --- | --- | --- |
| 无 cursor（首屏，取最新一页） | 有更旧消息时返回 | 不返回（首屏已是最新，无更新方向） |
| `cursor`（向历史方向翻页） | 有更旧消息时返回 | 不返回 |
| `newerCursor`（向更新方向翻页） | 不返回 | 有更新消息时返回 |
| `anchorMessageId`（以锚点消息为中心取前后页） | 锚点之前有更旧消息时返回 | 锚点之后有更新消息时返回 |

> 注：`cursor`/`newerCursor` 单方向翻页只返回该方向的 cursor，不返回另一方向 cursor；需要同时获取双向 cursor 时使用 `anchorMessageId`。两个 cursor 的值均为裸 `messageId`（如 `msg_9`），不带 `before:`/`after:` 前缀。
| `activeRun` | object | 否 | 当前活跃运行摘要。 |
| `forkNotice` | object | 否 | fork 提示信息。 |

示例响应（`anchorMessageId` 场景，锚点前后均有更多消息，故同时返回 `nextCursor` 与 `newerCursor`；单方向翻页仅返回对应方向 cursor）：

```json
{
  "items": [
    {
      "messageId": "msg_1",
      "sessionId": "sess_123",
      "requestId": "req_1",
      "runId": "run_1",
      "role": "USER",
      "sequence": 1,
      "content": "分析小区掉话率升高原因",
      "contentType": "TEXT",
      "metadata": {},
      "createdAt": 1719878400000,
      "visible": true
    }
  ],
  "nextCursor": "msg_1",
  "newerCursor": "msg_9",
  "activeRun": {
    "requestId": "req_2",
    "runId": "run_2",
    "status": "RUNNING"
  }
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `sessionId must not exceed 256 characters.` / `cursor must not exceed 256 characters.` / `Field '{name}' is not allowed.` | path/query schema 不合法。 |
| 400 | `REQUEST_VALIDATION_FAILED` | `Conversation cursors cannot be combined.` | `cursor`、`newerCursor`、`anchorMessageId` 同时提供了多个。 |
| 400 | `REQUEST_VALIDATION_FAILED` | `limit must be a positive integer.` / `limit must not exceed 200.` | `limit` 不是合法正整数或超过 200。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | safe authorization code | safe message | 当前身份无权读取该会话。 |
| 404 | safe not-found code | safe message | 会话不存在。 |

示例：

```bash
curl -X GET "$BASE_URL/api/v1/sessions/sess_123/conversation?limit=50&includeCapabilityResults=true" \
  -b cookies.txt
```

### GET /api/v1/sessions/{sessionId}/capability-presentation-resources

描述：返回当前会话绑定 Agent 的受治理 Capability winner 展示名称。该接口只读取当前静态、本地或已安装事实，不执行 Capability，也不触发远端发现、下载或安装。

Path 参数：`sessionId` 必填。Query 参数必须为空；客户端不得提交 locale、agentId 或 Provider selector。接口先校验当前 Owner 对 Session 的访问权，并使用 Session 中可信的 `agentId`。

Success response：

```json
{
  "resources": [
    {
      "capabilityKind": "TOOL",
      "capabilityId": "lookup-alarm",
      "displayName": "Query alarms",
      "locales": {
        "language": {
          "zh-CN": { "displayName": "查询告警" },
          "en-US": { "displayName": "Query alarms" }
        }
      }
    }
  ]
}
```

`capabilityKind` 为 `TOOL | SKILL | AGENT | WORKFLOW`。`displayName` 必填，`locales` 可选；响应一次携带全部已配置语言，前端切换语言不重新查询。空 `resources` 表示完整 current view 中没有可返回 winner；Provider current-read unavailable、timeout、取消或结果非法返回安全 `503`，不得伪装成空成功。

```bash
curl -X GET "$BASE_URL/api/v1/sessions/sess_123/capability-presentation-resources" -b cookies.txt
```

### GET /api/v1/sessions/{sessionId}/conversation/preview

描述：读取会话预览标记页，用于侧边栏或快速定位消息。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID。 |

Query 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `limit` | integer string | 是 | 1 到 100。 |
| `offset` | integer string | 否 | 非负整数，范围 `0` 到 `10000`，默认 `0`。 |

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回预览 marker 分页。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID。 |
| `totalMarkers` | integer | 是 | marker 总数。 |
| `offset` | integer | 是 | 当前偏移。 |
| `limit` | integer | 是 | 当前页大小。 |
| `markers` | array | 是 | 预览 marker 列表。 |
| `markers[].messageId` | string | 是 | 消息 ID。 |
| `markers[].requestId` | string | 否 | 请求 ID。 |
| `markers[].createdAt` | number | 是 | 创建时间。 |
| `markers[].previewText` | string | 是 | 用户问题预览。 |
| `markers[].previewTruncated` | boolean | 是 | 用户问题是否截断。 |
| `markers[].answerPreviewText` | string | 否 | 回答预览。 |
| `markers[].answerPreviewTruncated` | boolean | 否 | 回答是否截断。 |

```json
{
  "sessionId": "sess_123",
  "totalMarkers": 2,
  "offset": 0,
  "limit": 20,
  "markers": [
    {
      "messageId": "msg_1",
      "requestId": "req_1",
      "createdAt": 1719878400000,
      "previewText": "分析小区掉话率升高原因",
      "previewTruncated": false,
      "answerPreviewText": "初步判断与邻区切换失败相关",
      "answerPreviewTruncated": false
    }
  ]
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `sessionId must not exceed 256 characters.` / `offset format is invalid.` / `Field '{name}' is not allowed.` | path/query schema 不合法。 |
| 400 | `REQUEST_VALIDATION_FAILED` | `Conversation preview only supports offset and limit query parameters.` | query 包含 `offset`、`limit` 之外的字段。 |
| 400 | `REQUEST_VALIDATION_FAILED` | `offset must be an integer.` / `offset must be a non-negative integer.` / `offset must not exceed 10000.` | `offset` 不是合法非负整数或超过 10000。 |
| 400 | `REQUEST_VALIDATION_FAILED` | `limit is required.` / `limit must be a positive integer.` / `limit must not exceed 100.` | `limit` 缺失、不是合法正整数或超过 100。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | safe authorization code | safe message | 当前身份无权读取该会话。 |
| 404 | safe not-found code | safe message | 会话不存在。 |

示例：

```bash
curl -X GET "$BASE_URL/api/v1/sessions/sess_123/conversation/preview?offset=0&limit=20" \
  -b cookies.txt
```

### POST /api/v1/sessions/{sessionId}/messages/{messageId}/fork

描述：从指定消息锚点派生新会话。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 源会话 ID。 |
| `messageId` | string | 是 | fork 锚点消息 ID。 |

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | `application/json`。 |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `idempotencyKey` | string | 是 | minLength: 1, maxLength: 128。 |

```json
{
  "idempotencyKey": "idem-fork-001"
}
```

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回派生出的子会话摘要。 |

字段表：同 `POST /api/v1/sessions` success response。

```json
{
  "sessionId": "sess_child",
  "displayTitle": "Untitled session",
  "lastActivityAt": 1719878400000
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `sessionId must not exceed 256 characters.` / `idempotencyKey is required.` / `idempotencyKey must not exceed 128 characters.` / `Field '{name}' is not allowed.` | path/body schema 不合法。 |
| 400 | `REQUEST_VALIDATION_FAILED` | `idempotencyKey length is invalid.` | `idempotencyKey` trim 后为空或超过 128 个字符。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | safe authorization code | safe message | 当前身份无权读取源会话或消息。 |
| 404 | safe not-found code | safe message | 源会话或锚点消息不存在。 |

示例：

```bash
curl -X POST "$BASE_URL/api/v1/sessions/sess_123/messages/msg_1/fork" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"idempotencyKey":"idem-fork-001"}'
```

### POST /api/v1/sessions/{sessionId}/requests/{requestId}/fork

描述：从指定 request 锚点派生新会话。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 源会话 ID。 |
| `requestId` | string | 是 | fork 锚点 request ID。 |

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | `application/json`。 |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `idempotencyKey` | string | 是 | minLength: 1, maxLength: 128。 |

```json
{
  "idempotencyKey": "idem-fork-002"
}
```

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回派生出的子会话摘要。 |

字段表：同 `POST /api/v1/sessions` success response。

```json
{
  "sessionId": "sess_child",
  "displayTitle": "Untitled session",
  "lastActivityAt": 1719878400000
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `sessionId must not exceed 256 characters.` / `idempotencyKey is required.` / `idempotencyKey must not exceed 128 characters.` / `Field '{name}' is not allowed.` | path/body schema 不合法。 |
| 400 | `REQUEST_VALIDATION_FAILED` | `idempotencyKey length is invalid.` | `idempotencyKey` trim 后为空或超过 128 个字符。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | safe authorization code | safe message | 当前身份无权读取源会话或 request。 |
| 404 | safe not-found code | safe message | 源会话或锚点 request 不存在。 |

示例：

```bash
curl -X POST "$BASE_URL/api/v1/sessions/sess_123/requests/req_1/fork" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"idempotencyKey":"idem-fork-002"}'
```

## Request Command

### POST /api/v1/sessions/{sessionId}/requests

描述：在已有会话中提交用户请求。请求提交只接受 JSON；如果携带附件，必须先通过 `/api/v1/sessions/{sessionId}/files/upload` 暂存文件，再在 JSON `attachments` 中提交暂存引用。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 目标会话 ID。 |

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | `application/json`。 |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `inputText` | string | 是 | JSON 模式 minLength: 1, maxLength: 32768；multipart 模式非空。 |
| `idempotencyKey` | string | 是 | JSON 模式 minLength: 1, maxLength: 256；multipart 模式非空。 |
| `locale` | string | 否 | 枚举 `"zh-CN"` 或 `"en-US"`；省略时默认 `zh-CN`。 |
| `routingConstraints` | object | 否 | runtime routing constraints。 |
| `modelOptions` | object | 否 | 请求级模型选项。 |
| `inputVariables` | object | 否 | 结构化输入变量。 |
| `attachments` | array | 否 | 通过文件暂存上传接口获得的 staged attachment references；每项包含 `tempRunId` 和 `fileName`。 |

附件校验分两层执行：

- 浏览器上传暂存文件前预检附件数量、大小和 `.md` / `.markdown` 扩展名。
- 服务端文件暂存/attachment intake 是权威校验边界，会重新读取实际字节和大小，并同时校验可信文件名扩展名、声明 MIME、已知二进制 magic、UTF-8 可读性和 NUL；任一校验失败时对应暂存上传 fail closed。

```json
{
  "inputText": "分析小区掉话率升高原因",
  "idempotencyKey": "idem-001",
  "locale": "zh-CN",
  "routingConstraints": {
    "targetSkill": "network-diagnosis"
  }
}
```

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 请求已被 runtime 接收。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID。 |
| `requestId` | string | 是 | 请求消息 ID。 |
| `runId` | string | 是 | 本次运行 ID。 |
| `attempt` | integer | 是 | 尝试次数，从 1 开始。 |

```json
{
  "sessionId": "sess_123",
  "requestId": "req_1",
  "runId": "run_1",
  "attempt": 1
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `sessionId must not exceed 256 characters.` / `inputText is required.` / `inputText must not exceed 32768 characters.` / `idempotencyKey is required.` / `locale value is not allowed.` / `Field '{name}' is not allowed.` | path/body schema 不合法、JSON 非空附件、客户端注入 owner/agent/id 字段。 |
| 400 | `REQUEST_VALIDATION_FAILED` | `Request submit accepts JSON with staged attachment references.` | 请求使用 multipart/form-data。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | safe authorization code | safe message | 当前身份无权提交到该会话。 |
| 404 | safe not-found code | safe message | 会话不存在。 |
| 409 | safe conflict code | safe message | 幂等或并发冲突。 |
| 503 | `ATTACHMENT_DEPENDENCY_UNAVAILABLE` | `Attachment intake dependencies are unavailable.` | staged attachment 依赖未装配。 |

示例：

```bash
curl -X POST "$BASE_URL/api/v1/sessions/sess_123/requests" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"inputText":"分析小区掉话率升高原因","idempotencyKey":"idem-001","locale":"zh-CN"}'
```

### POST /api/v1/requests

描述：便捷提交入口。可以不传 `sessionId`，后端会先创建会话再提交请求。

Path 参数：无。

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | `application/json`。 |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 否 | JSON 模式 minLength: 1, maxLength: 256；省略时创建新会话。 |
| `inputText` | string | 是 | JSON 模式 minLength: 1, maxLength: 32768；multipart 模式非空。 |
| `idempotencyKey` | string | 是 | JSON 模式 minLength: 1, maxLength: 256；multipart 模式非空。 |
| `locale` | string | 否 | 枚举 `"zh-CN"` 或 `"en-US"`。 |
| `routingConstraints` | object | 否 | runtime routing constraints。 |
| `modelOptions` | object | 否 | 请求级模型选项。 |
| `inputVariables` | object | 否 | 结构化输入变量。 |
| `attachments` | array | 否 | 通过文件暂存上传接口获得的 staged attachment references；每项包含 `tempRunId` 和 `fileName`。 |

```json
{
  "sessionId": "sess_123",
  "inputText": "分析小区掉话率升高原因",
  "idempotencyKey": "idem-standalone-001",
  "locale": "zh-CN"
}
```

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 请求已被 runtime 接收。 |

字段表：同 `POST /api/v1/sessions/{sessionId}/requests` success response。

```json
{
  "sessionId": "sess_123",
  "requestId": "req_1",
  "runId": "run_1",
  "attempt": 1
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `inputText is required.` / `inputText must not exceed 32768 characters.` / `idempotencyKey is required.` / `locale value is not allowed.` / `Field '{name}' is not allowed.` | body schema 不合法、JSON 非空附件、客户端注入 owner/agent/id 字段。 |
| 400 | `REQUEST_VALIDATION_FAILED` | `Request submit accepts JSON with staged attachment references.` | 请求使用 multipart/form-data。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | safe authorization code | safe message | 当前身份无权提交到指定会话。 |
| 404 | safe not-found code | safe message | 指定会话不存在。 |
| 409 | safe conflict code | safe message | 幂等或并发冲突。 |
| 503 | `ATTACHMENT_DEPENDENCY_UNAVAILABLE` | `Attachment intake dependencies are unavailable.` | staged attachment 依赖未装配。 |

示例：

```bash
curl -X POST "$BASE_URL/api/v1/requests" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"inputText":"分析小区掉话率升高原因","idempotencyKey":"idem-standalone-001","locale":"zh-CN"}'
```

### POST /api/v1/sessions/{sessionId}/cancel

描述：取消会话中最新请求。当前后端固定按 `CANCEL` action 调用 runtime。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID。 |

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | `application/json`。 |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `expectedLatestRequestId` | string | 是 | minLength: 1, maxLength: 256；前端认为的最新请求 ID。 |
| `action` | `"CANCEL"` \| `"CANCEL_LATEST"` | 否 | 兼容字段；runtime action 固定为 `CANCEL`。 |
| `idempotencyKey` | string | 是 | minLength: 1, maxLength: 256。 |

```json
{
  "expectedLatestRequestId": "req_1",
  "action": "CANCEL_LATEST",
  "idempotencyKey": "idem-cancel-001"
}
```

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | cancel command 已接受。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID。 |
| `targetRequestId` | string | 是 | 被取消的请求 ID。 |
| `action` | string | 是 | 实际 action，当前为 `CANCEL`。 |
| `idempotencyKey` | string | 是 | 幂等键。 |

```json
{
  "sessionId": "sess_123",
  "targetRequestId": "req_1",
  "action": "CANCEL",
  "idempotencyKey": "idem-cancel-001"
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `sessionId must not exceed 256 characters.` / `expectedLatestRequestId is required.` / `idempotencyKey is required.` / `action value is not allowed.` / `Field '{name}' is not allowed.` | path/body schema 不合法。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | safe authorization code | safe message | 当前身份无权取消该会话请求。 |
| 404 | safe not-found code | safe message | 会话或请求不存在。 |
| 409 | safe conflict code | safe message | latest request 与预期不一致或状态冲突。 |

示例：

```bash
curl -X POST "$BASE_URL/api/v1/sessions/sess_123/cancel" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"expectedLatestRequestId":"req_1","action":"CANCEL_LATEST","idempotencyKey":"idem-cancel-001"}'
```

### POST /api/v1/sessions/{sessionId}/retry

描述：重试会话中最新请求。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID。 |

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | `application/json`。 |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `expectedLatestRequestId` | string | 是 | minLength: 1, maxLength: 256；前端认为的最新请求 ID。 |
| `idempotencyKey` | string | 是 | minLength: 1, maxLength: 256。 |

```json
{
  "expectedLatestRequestId": "req_1",
  "idempotencyKey": "idem-retry-001"
}
```

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | retry command 已接受。 |

字段表：同 `POST /api/v1/sessions/{sessionId}/requests` success response。

```json
{
  "sessionId": "sess_123",
  "requestId": "req_2",
  "runId": "run_2",
  "attempt": 2
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `sessionId must not exceed 256 characters.` / `expectedLatestRequestId is required.` / `idempotencyKey is required.` / `Field '{name}' is not allowed.` | path/body schema 不合法。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | safe authorization code | safe message | 当前身份无权重试该会话请求。 |
| 404 | safe not-found code | safe message | 会话或请求不存在。 |
| 409 | safe conflict code | safe message | latest request 与预期不一致或状态冲突。 |

示例：

```bash
curl -X POST "$BASE_URL/api/v1/sessions/sess_123/retry" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"expectedLatestRequestId":"req_1","idempotencyKey":"idem-retry-001"}'
```

### POST /api/v1/sessions/{sessionId}/requests/latest/edit

描述：编辑并重新提交会话中最新请求。当前只支持 JSON 文本编辑；multipart edit 和非空附件均会在调用 runtime 前被拒绝。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID。 |

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | `application/json`。 |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `expectedLatestRequestId` | string | 是 | minLength: 1, maxLength: 256。 |
| `editedInputText` | string | 是 | minLength: 1, maxLength: 32768；schema 不独立拒绝 whitespace-only，当前 Agent Web confirm path 会先 trim。 |
| `idempotencyKey` | string | 是 | minLength: 1, maxLength: 256。 |
| `locale` | string | 否 | 枚举 `"zh-CN"` | `"en-US"`；当前 runtime edit path 仍固定使用 `zh-CN`，因此这里不构成 locale 生效保证。 |
| `attachments` | array | 否 | 兼容字段，只允许空数组；route 始终向 runtime 传 `attachmentIds=[]`。 |

请求体不接受 `routingConstraints`、`modelOptions`、`inputVariables`、owner/Agent 字段或其他未列出字段。当前 Agent Web request service 在附件队列非空时也会在发出 HTTP 请求前拒绝 edit。

```json
{
  "expectedLatestRequestId": "req_1",
  "editedInputText": "重新分析小区掉话率升高原因，重点关注切换失败",
  "idempotencyKey": "idem-edit-001"
}
```

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | edit command 已接受。 |

字段表：同 `POST /api/v1/sessions/{sessionId}/requests` success response。

```json
{
  "sessionId": "sess_123",
  "requestId": "req_3",
  "runId": "run_3",
  "attempt": 1
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `sessionId must not exceed 256 characters.` / `expectedLatestRequestId is required.` / `editedInputText is required.` / `idempotencyKey is required.` / `locale value is not allowed.` / `Field '{name}' is not allowed.` | path/body schema 不合法、JSON 非空附件、未知字段或客户端注入 owner/agent/id 字段。 |
| 400 | `REQUEST_VALIDATION_FAILED` | `Edit latest accepts a JSON text body only.` | edit 请求使用 multipart/form-data。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | safe authorization code | safe message | 当前身份无权编辑该会话请求。 |
| 404 | safe not-found code | safe message | 会话或请求不存在。 |
| 409 | safe conflict code | safe message | latest request 与预期不一致或状态冲突。 |
| 503 | safe unavailable code | safe message | runtime/session dependency unavailable。 |

示例：

```bash
curl -X POST "$BASE_URL/api/v1/sessions/sess_123/requests/latest/edit" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"expectedLatestRequestId":"req_1","editedInputText":"重新分析小区掉话率升高原因","idempotencyKey":"idem-edit-001"}'
```

### POST /api/v1/sessions/{sessionId}/pending-inputs/{pendingInputId}/answer

描述：回答模型或 capability 请求的用户补充输入。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID。 |
| `pendingInputId` | string | 是 | pending input ID。 |

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | `application/json`。 |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `answers` | string[][] | 是 | minItems: 1, maxItems: 100；每个内层数组 minItems: 1, maxItems: 100；每个字符串 minLength: 1, maxLength: 4096。 |

```json
{
  "answers": [
    ["小区 A"],
    ["最近 24 小时"]
  ]
}
```

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | pending input answer 已接收。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID。 |
| `pendingInputId` | string | 是 | pending input ID。 |
| `status` | string | 是 | 接收状态。 |

```json
{
  "sessionId": "sess_123",
  "pendingInputId": "pending_1",
  "status": "RECEIVED"
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `sessionId must not exceed 256 characters.` / `answers is required.` / `answers must contain at least 1 item(s).` / `Field '{name}' is not allowed.` | path/body schema 不合法。 |
| 400 | `REQUEST_VALIDATION_FAILED` | `Pending input answers must be a non-empty ordered array.` | `answers` 缺失、不是数组或为空数组。 |
| 400 | `REQUEST_VALIDATION_FAILED` | `Pending input answers must be ordered non-empty string arrays.` | `answers[]` 不是非空字符串数组。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | safe authorization code | safe message | 当前身份无权回答该 pending input。 |
| 404 | safe not-found code | safe message | 会话或 pending input 不存在。 |
| 409 | safe conflict code | safe message | pending input 状态已终止或冲突。 |

示例：

```bash
curl -X POST "$BASE_URL/api/v1/sessions/sess_123/pending-inputs/pending_1/answer" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"answers":[["小区 A"],["最近 24 小时"]]}'
```

### POST /api/v1/sessions/{sessionId}/requests/{requestId}/suggested-questions

描述：基于指定 request 的上下文生成推荐问题。当前请求体为空；若 suggested question 依赖未注册，返回空数组。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID。 |
| `requestId` | string | 是 | 请求 ID。 |

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 否 | 可为 `application/json`。 |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体或空 JSON 对象。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 推荐问题列表。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `questions` | string[] | 是 | 推荐问题文本列表。 |

```json
{
  "questions": [
    "是否需要进一步分析切换失败 TOP 小区？",
    "是否需要生成近 24 小时告警摘要？"
  ]
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `sessionId must not exceed 256 characters.` / `requestId must not exceed 256 characters.` | path schema 不合法。 |
| 400 | `REQUEST_VALIDATION_FAILED` | `requestId is required.` | `requestId` 为空。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | safe authorization code | safe message | 当前身份无权读取该 request。 |
| 404 | `NOT_FOUND` 或 safe not-found code | `Not Found.` 或 safe message | 会话、request 或对应 run 不存在。 |
| 503 | safe unavailable code | safe message | suggested question 依赖不可用。 |

示例：

```bash
curl -X POST "$BASE_URL/api/v1/sessions/sess_123/requests/req_1/suggested-questions" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{}'
```

## Stream

### GET /api/v1/sessions/{sessionId}/stream

描述：SSE 流式读取会话 timeline envelope。agent-web 在 `transportKind` 为 `SSE` 时使用。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID。 |

Query 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `lastSeenSequence` | integer string | 否 | 已消费的最后 sequence，用于断点续传。 |
| `requestId` | string | 否 | 限定请求 ID。 |
| `runId` | string | 否 | 限定运行 ID。 |

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Accept` | 否 | `text/event-stream`。 |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `text/event-stream` | 每条 SSE `data` 为 `StreamEnvelope` JSON。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `eventId` | string | 是 | stream event ID。 |
| `sessionId` | string | 是 | 会话 ID。 |
| `requestId` | string | 是 | 请求 ID。 |
| `runId` | string | 否 | 运行 ID。 |
| `requestContextId` | string | 否 | 请求上下文 ID。 |
| `sequence` | number | 是 | timeline sequence。 |
| `eventType` | string | 是 | stream event 类型。 |
| `timelineEventRef` | string | 否 | timeline event 引用。 |
| `transportHints` | array | 是 | transport hints。 |
| `payload` | object | 是 | event payload；仅 safe projection。 |
| `createdAt` | number | 是 | 创建时间。 |

```json
{
  "eventId": "evt_1",
  "sessionId": "sess_123",
  "requestId": "req_1",
  "runId": "run_1",
  "sequence": 12,
  "eventType": "LLM_CONTENT_DELTA",
  "timelineEventRef": "timeline_12",
  "transportHints": [],
  "payload": {
    "text": "初步判断"
  },
  "createdAt": 1719878400000
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `sessionId must not exceed 256 characters.` / `lastSeenSequence format is invalid.` / `Field '{name}' is not allowed.` | path/query schema 不合法。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | safe authorization code | safe message | 当前身份无权订阅该会话。 |
| 404 | safe not-found code | safe message | 会话不存在。 |

示例：

```bash
curl -N "$BASE_URL/api/v1/sessions/sess_123/stream?lastSeenSequence=11&requestId=req_1" \
  -b cookies.txt
```

### WebSocket /api/v1/sessions/{sessionId}/ws

描述：WebSocket 流式读取会话 timeline envelope。agent-web 在 `transportKind` 为 `WEBSOCKET` 时使用。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID。 |

Query 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `lastSeenSequence` | integer string | 否 | 已消费的最后 sequence，用于断点续传。 |
| `requestId` | string | 否 | 限定请求 ID。 |
| `runId` | string | 否 | 限定运行 ID。 |

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Upgrade` | 是 | `websocket`。 |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 101 | WebSocket text frames | 每个 text frame 是一个 `StreamEnvelope` JSON，结构同 SSE。 |

字段表：同 `GET /api/v1/sessions/{sessionId}/stream` 的 `StreamEnvelope` 字段表。

```json
{
  "eventId": "evt_1",
  "sessionId": "sess_123",
  "requestId": "req_1",
  "runId": "run_1",
  "sequence": 12,
  "eventType": "LLM_CONTENT_DELTA",
  "transportHints": [],
  "payload": {
    "text": "初步判断"
  },
  "createdAt": 1719878400000
}
```

Error responses：

| HTTP / frame | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `WEBSOCKET_HANDSHAKE_INVALID` | `WebSocket stream failed safely.` | WebSocket handshake 非法。 |
| close/error frame | `WEBSOCKET_STREAM_QUERY_INVALID` | `WebSocket stream failed safely.` | query 不合法。 |
| close/error frame | safe authorization code | safe message | 当前身份无权订阅该会话。 |
| close/error frame | safe not-found code | safe message | 会话不存在。 |

示例：

```text
ws://127.0.0.1:3000/api/v1/sessions/sess_123/ws?lastSeenSequence=11&requestId=req_1
```

### GET /api/v1/session-activities/stream

描述：ER 专属的跨会话活动 SSE 投影。订阅范围固定为当前 Web Owner Scope 与 active Agent Scope；首条应用消息必须是 `SNAPSHOT`，之后只发送 `DELTA`。它不是 canonical timeline，也不提供 replay cursor、sequence 或历史补偿。

Path 参数：无。

Query 参数：无；任何未知 query 字段都会被拒绝。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Accept` | 否 | `text/event-stream`。 |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `text/event-stream` | `event` 为 `SNAPSHOT` 或 `DELTA`，`data` 为对应的严格 JSON 消息。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | `"SNAPSHOT"` \| `"DELTA"` | 是 | 消息类型；每次订阅第一条必须为 `SNAPSHOT`。 |
| `entries` | array | `SNAPSHOT` 时是 | 当前非 `NONE` 活动的完整投影。 |
| `entry` | object | `DELTA` 时是 | 单个会话的最新活动投影。 |
| `entry.sessionId` | string | 是 | 会话 ID；minLength: 1, maxLength: 256。 |
| `entry.status` | enum | 是 | `NONE`、`WAITING_FOR_INPUT`、`RUNNING`、`UNREAD_FAILURE`、`UNREAD_RESULT`。`SNAPSHOT` 不包含 `NONE`。 |
| `entry.pendingInputKind` | enum | `WAITING_FOR_INPUT` 时是 | `QUESTION`、`CONFIRMATION`、`AUTHORIZATION` 或 `HUMAN_HANDOFF`。 |
| `entry.activityId` | string | unread 状态时是 | 仅 `UNREAD_FAILURE`、`UNREAD_RESULT` 携带；minLength: 1, maxLength: 256。 |

消息使用 strict discriminated shape，不包含 `runId`、cursor、sequence、owner scope、Agent Scope 或其他 canonical runtime 字段。

```text
event: SNAPSHOT
data: {"type":"SNAPSHOT","entries":[{"sessionId":"sess_123","status":"RUNNING"},{"sessionId":"sess_456","status":"UNREAD_RESULT","activityId":"activity_9"}]}

event: DELTA
data: {"type":"DELTA","entry":{"sessionId":"sess_456","status":"NONE"}}
```

Error responses：

| HTTP / stream | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `Field '{name}' is not allowed.` | query 携带未知字段。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | safe authorization code | safe message | 当前身份无权订阅该 scope。 |
| 404 | safe not-found code | safe message | scoped activity projection 不存在。 |
| 503 | safe unavailable code | safe message | activity projection 依赖不可用。 |
| stream close | `SESSION_ACTIVITY_PROJECTION_INVALID` 或 safe delivery code | safe message | runtime 输出不符合 strict wire schema、连接关闭或 backpressure 超时；服务端不会伪造空 snapshot。 |

示例：

```bash
curl -N "$BASE_URL/api/v1/session-activities/stream" \
  -H "Accept: text/event-stream" \
  -b cookies.txt
```

### WebSocket /api/v1/session-activities/ws

描述：ER 专属的跨会话活动 WebSocket 投影。作用域、首条 `SNAPSHOT`、后续 `DELTA` 与 strict message shape 均与 Activity SSE 相同，并复用同一个 WebSocket upgrade/backpressure 机制。

Path 参数：无。

Query 参数：无；任何 query 字段都会使握手安全失败。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Upgrade` | 是 | `websocket`。 |
| `Connection` | 是 | 包含 `Upgrade`。 |
| `Sec-WebSocket-Key` | 是 | 合法 WebSocket handshake key。 |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 101 | WebSocket text frames | 每个 text frame 是一个 Activity `SNAPSHOT` 或 `DELTA` JSON；第一帧必须为 `SNAPSHOT`。 |

字段表：同 `GET /api/v1/session-activities/stream` 的 strict Activity message 字段表；不接受客户端业务消息，客户端 close/ping 仅用于连接生命周期。

```json
{
  "type": "DELTA",
  "entry": {
    "sessionId": "sess_456",
    "status": "UNREAD_FAILURE",
    "activityId": "activity_10"
  }
}
```

Error responses：

| HTTP / frame | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `WEBSOCKET_HANDSHAKE_INVALID` | `WebSocket stream failed safely.` | Upgrade handshake 非法。 |
| close/error frame | `WEBSOCKET_STREAM_QUERY_INVALID` | `WebSocket stream failed safely.` | 携带任何 query 字段。 |
| close/error frame | safe authorization code | safe message | 当前身份无权订阅该 scope。 |
| close/error frame | `SESSION_ACTIVITY_PROJECTION_INVALID` 或 safe delivery code | safe message | projection schema 非法或发送失败。 |
| close 1011 | `BACKPRESSURE_TIMEOUT` | `BACKPRESSURE_TIMEOUT` | socket 在安全等待窗口内持续不可写。 |

示例：

```text
ws://127.0.0.1:3000/api/v1/session-activities/ws
```

### POST /api/v1/sessions/{sessionId}/activity/consume

描述：消费一个 unread activity。服务端以当前可信 Owner Scope、会话绑定的 Agent Scope、`sessionId`、`activityId` 和 `observedRunId` 做条件消费；匹配、重复、过期或 run 已推进都安全返回 204，不会清除更新 run 的活动。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID；minLength: 1, maxLength: 256。 |

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | `application/json`。 |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `activityId` | string | 是 | 已观察的 unread activity ID；minLength: 1, maxLength: 256。 |
| `observedRunId` | string | 是 | 观察该 activity 时对应的 run ID；minLength: 1, maxLength: 256。 |

请求体是 strict schema，不接受 `tenantId`、`subjectId`、`agentId`、status、cursor、sequence 或其他字段。

```json
{
  "activityId": "activity_9",
  "observedRunId": "run_9"
}
```

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 204 | 无 | 条件消费已处理；重复、过期或 run mismatch 也保持幂等无 body。 |

字段表：无 response body 字段。

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `sessionId must not exceed 256 characters.` / `activityId is required.` / `observedRunId is required.` / `Field '{name}' is not allowed.` | path/body 不符合 strict schema，ID 为空、超长或存在未知字段。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | safe authorization code | safe message | 当前 Owner Scope 或 Agent Scope 无权访问该会话。 |
| 404 | safe not-found code | safe message | 当前可信 scope 下会话不存在。 |
| 503 | safe unavailable code | safe message | activity consume 依赖不可用。 |

示例：

```bash
curl -X POST "$BASE_URL/api/v1/sessions/sess_123/activity/consume" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"activityId":"activity_9","observedRunId":"run_9"}' \
  -i
```

## Cron Task Management

Cron Task Management 管理持久化定时 prompt。它不同于 Background Task：Cron task 是周期或单次调度定义，到期后进入标准 runtime request lifecycle；Background Task 是一次性后台 shell 进程。

### GET /api/v1/cron-tasks

描述：查询当前 Web 身份和 active Agent 下的 Cron task。Owner Scope 和 Agent Scope 只能来自可信 channel/app composition，query 不接受 scope 覆盖字段。

Path 参数：无。

Query 参数：

| 参数 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `offset` | number | 否 | `0` | 非负整数 | 跳过的 task 数量。 |
| `limit` | number | 否 | `50` | `1..50` | 本次最多返回的 task 数量。 |

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Cookie` | 否 | 启用本地认证时携带 `nextagent_local_auth`。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回 Cron task 列表。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tasks` | array | 是 | Cron task 列表。 |
| `total` | number | 是 | 当前 trusted scope 下可管理 Cron task 总数。 |
| `tasks[].taskId` | string | 是 | Cron task ID。 |
| `tasks[].cron` | string | 是 | 5 字段 cron 表达式。 |
| `tasks[].humanSchedule` | string | 是 | 可读调度描述。 |
| `tasks[].prompt` | string | 是 | 到期后提交给 Agent 的 prompt。 |
| `tasks[].recurring` | boolean | 是 | 是否循环触发。 |
| `tasks[].status` | `"ACTIVE"` \| `"COMPLETED"` | 是 | 管理视图状态。 |
| `tasks[].createdAt` | number | 是 | 创建时间。 |
| `tasks[].updatedAt` | number | 是 | 更新时间。 |
| `tasks[].nextRunAt` | number | 是 | 下一次运行时间。 |

```json
{
  "tasks": [
    {
      "taskId": "cron_123",
      "cron": "0 9 * * *",
      "humanSchedule": "Every day at 9:00 AM",
      "prompt": "检查核心网告警并汇总异常网元。",
      "recurring": true,
      "status": "ACTIVE",
      "createdAt": 1719878400000,
      "updatedAt": 1719878400000,
      "nextRunAt": 1719901200000
    }
  ],
  "total": 1
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | safe validation message | query 携带未知字段。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 503 | `CRON_TASKS_UNAVAILABLE` | `Cron task management service is unavailable.` | Cron task management port 未装配。 |

示例：

```bash
curl -X GET "$BASE_URL/api/v1/cron-tasks?offset=0&limit=50" -b cookies.txt
```

### POST /api/v1/cron-tasks

描述：创建持久化 Cron task。请求体不得携带 tenant、subject、agent、session、run、status、version、trigger 或持久化 owner 字段。

Path 参数：无。

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | `application/json`。 |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `cron` | string | 是 | 5 字段 cron 表达式，最大 256 字符。 |
| `prompt` | string | 是 | 到期后提交给 Agent 的 prompt，最大 10000 字符。 |
| `recurring` | boolean | 否 | 缺省 `true`；`false` 表示首次触发后完成。 |

```json
{
  "cron": "0 9 * * *",
  "prompt": "检查核心网告警并汇总异常网元。",
  "recurring": true
}
```

Success response：`200 application/json`，字段同单个 Cron task DTO。

字段表：`taskId` 为 task ID；`cron`、`prompt`、`recurring` 为调度定义；`status`、`createdAt`、`updatedAt`、`nextRunAt` 为服务端状态。

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | safe validation message | body 缺字段、字段为空或携带未知字段。 |
| 400 | `CRON_INVALID_EXPRESSION` | `Cron expression is invalid.` | cron 表达式不受支持。 |
| 400 | `CRON_NO_FUTURE_MATCH` | `Cron expression does not match any calendar date in the next year.` | 一年内没有下一次运行时间。 |
| 400 | `CRON_PROMPT_TOO_LONG` | `Prompt exceeds max length 10000.` | prompt 超长。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 409 | `CRON_TASK_LIMIT_REACHED` | `Cron task limit reached. Delete an existing active task or wait for a one-shot task to complete.` | 当前 trusted scope 已有 50 个 ACTIVE task；底层 category=CONFLICT 且 retryable=false。 |
| 503 | `CRON_TASKS_UNAVAILABLE` | `Cron task management service is unavailable.` | Cron task management port 未装配。 |

示例：

```bash
curl -X POST "$BASE_URL/api/v1/cron-tasks" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"cron":"0 9 * * *","prompt":"检查核心网告警并汇总异常网元。","recurring":true}'
```

### PUT /api/v1/cron-tasks/{taskId}

描述：修改 active Cron task 的 `cron`、`prompt` 或 `recurring`。至少提供一个字段；不支持修改 task scope、status、version 或 trigger。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `taskId` | string | 是 | Cron task ID。 |

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | `application/json`。 |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `cron` | string | 否 | 新 5 字段 cron 表达式。 |
| `prompt` | string | 否 | 新 prompt。 |
| `recurring` | boolean | 否 | 新循环标志。 |

```json
{
  "cron": "*/5 * * * *",
  "prompt": "每 5 分钟检查 LTE 切换失败。"
}
```

Success response：`200 application/json`，字段同单个 Cron task DTO。

字段表：`taskId` 为 task ID；`cron`、`prompt`、`recurring` 为更新后的调度定义；`status`、`updatedAt`、`nextRunAt` 为服务端状态。

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | safe validation message | body 为空、字段非法或携带未知字段。 |
| 400 | `CRON_INVALID_EXPRESSION` | `Cron expression is invalid.` | cron 表达式不受支持。 |
| 400 | `CRON_NO_FUTURE_MATCH` | `Cron expression does not match any calendar date in the next year.` | 一年内没有下一次运行时间。 |
| 400 | `CRON_PROMPT_TOO_LONG` | `Prompt exceeds max length 10000.` | prompt 超长。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 404 | `CRON_TASK_NOT_FOUND` | safe not-found message | task 不存在或不属于当前 trusted scope。 |
| 409 | `CRON_TASK_NOT_ACTIVE` | `Cron task is not active.` | task 已完成，不能修改。 |
| 409 | `CRON_TASK_UPDATE_CONFLICT` | `Cron task update conflicted.` | 并发修改导致 CAS 冲突。 |
| 503 | `CRON_TASKS_UNAVAILABLE` | `Cron task management service is unavailable.` | Cron task management port 未装配。 |

示例：

```bash
curl -X PUT "$BASE_URL/api/v1/cron-tasks/cron_123" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"cron":"*/5 * * * *","prompt":"每 5 分钟检查 LTE 切换失败。"}'
```

### GET /api/v1/cron-tasks/{taskId}/runs

描述：查询当前 trusted scope 下指定 Cron task 的执行记录和执行结果。该接口复用 Cron trigger、runtime request run 和 terminal timeline event 事实；不新增独立结果表。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `taskId` | string | 是 | Cron task ID。 |

Query 参数：

| 参数 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `offset` | number | 否 | `0` | 非负整数 | 从倒序 execution 列表中跳过的记录数。 |
| `limit` | number | 否 | `50` | `1..50` | 本次最多返回的 execution 数量。 |

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回 Cron task execution 列表。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `executions` | array | 是 | 执行记录列表，按 scheduledAt 倒序。 |
| `total` | number | 是 | 当前 trusted scope 下该 task 的 execution 总数。 |
| `executions[].triggerId` | string | 是 | Cron trigger ID。 |
| `executions[].taskId` | string | 是 | Cron task ID。 |
| `executions[].scheduledAt` | number | 是 | 本次计划触发时间。 |
| `executions[].triggerStatus` | `"CLAIMED"` \| `"ACCEPTED"` | 是 | trigger 是否已绑定 runtime run。 |
| `executions[].createdAt` | number | 是 | trigger 创建时间。 |
| `executions[].updatedAt` | number | 是 | trigger 更新时间。 |
| `executions[].sessionId` | string | 否 | 绑定 runtime run 后的执行 session ID。 |
| `executions[].requestRunId` | string | 否 | 绑定 runtime run 后的 run ID。 |
| `executions[].runStatus` | string | 否 | runtime run 状态。 |
| `executions[].terminalCommitState` | string | 否 | terminal commit 状态。 |
| `executions[].resultEventType` | string | 否 | terminal event 类型。 |
| `executions[].resultContent` | string | 否 | terminal event inline payload 中的 content。 |
| `executions[].resultAt` | number | 否 | terminal event 创建时间。 |

```json
{
  "executions": [
    {
      "triggerId": "trigger_cron_123_1719901200000",
      "taskId": "cron_123",
      "scheduledAt": 1719901200000,
      "triggerStatus": "ACCEPTED",
      "createdAt": 1719901200001,
      "updatedAt": 1719901200030,
      "sessionId": "sess_cron_exec",
      "requestRunId": "run_cron_exec",
      "runStatus": "COMPLETED",
      "terminalCommitState": "COMMITTED",
      "resultEventType": "REQUEST_COMPLETED",
      "resultContent": "核心网告警检查完成。",
      "resultAt": 1719901205000
    }
  ],
  "total": 1
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | safe validation message | path/query 不合法或 query 携带未知字段。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 404 | `CRON_TASK_NOT_FOUND` | safe not-found message | task 不存在或不属于当前 trusted scope。 |
| 503 | `CRON_TASKS_UNAVAILABLE` | `Cron task management service is unavailable.` | Cron task management port 未装配。 |

示例：

```bash
curl -X GET "$BASE_URL/api/v1/cron-tasks/cron_123/runs?offset=0&limit=50" -b cookies.txt
```

### POST /api/v1/cron-tasks/{taskId}/runs

描述：立即运行当前 trusted scope 下的 active Cron task。该命令复用标准 Cron trigger 和 runtime request lifecycle，不修改 task 的下一次计划时间。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `taskId` | string | 是 | Cron task ID。 |

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回本次即时执行记录。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `taskId` | string | 是 | Cron task ID。 |
| `triggerId` | string | 是 | 本次即时 trigger ID。 |
| `scheduledAt` | number | 是 | 本次触发时间。 |
| `triggerStatus` | `"CLAIMED"` \| `"ACCEPTED"` | 是 | trigger 当前状态。 |
| `createdAt` | number | 是 | trigger 创建时间。 |
| `updatedAt` | number | 是 | trigger 更新时间。 |
| `sessionId` | string | 否 | 接受后绑定的 runtime session ID。 |
| `requestRunId` | string | 否 | 接受后绑定的 runtime run ID。 |
| `runStatus` | string | 否 | runtime run 状态。 |
| `terminalCommitState` | string | 否 | terminal commit 状态。 |

响应示例：

```json
{
  "taskId": "cron_123",
  "triggerId": "trigger_456",
  "scheduledAt": 1719878400000,
  "triggerStatus": "CLAIMED",
  "createdAt": 1719878400000,
  "updatedAt": 1719878400000
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | safe validation message | path 非法。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 404 | `CRON_TASK_NOT_FOUND` | safe not-found message | task 不存在或不属于当前 trusted scope。 |
| 409 | `CRON_TASK_NOT_ACTIVE` | `Cron task is not active.` | task 已完成。 |
| 503 | `CRON_TASKS_UNAVAILABLE` | `Cron task management service is unavailable.` | Cron task management port 未装配。 |

示例：

```bash
curl -X POST "$BASE_URL/api/v1/cron-tasks/cron_123/runs" -b cookies.txt
```

### DELETE /api/v1/cron-tasks/{taskId}

描述：删除当前 trusted scope 下的 Cron task。删除后该 task 不再出现在查询结果中，也不再产生新的 trigger。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `taskId` | string | 是 | Cron task ID。 |

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 204 | 无 | 删除成功。 |

字段表：响应无 body。

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | safe validation message | path/query 不合法。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 404 | `CRON_TASK_NOT_FOUND` | safe not-found message | task 不存在或不属于当前 trusted scope。 |
| 503 | `CRON_TASKS_UNAVAILABLE` | `Cron task management service is unavailable.` | Cron task management port 未装配。 |

示例：

```bash
curl -X DELETE "$BASE_URL/api/v1/cron-tasks/cron_123" -b cookies.txt
```

## Long-term Memory Management

Long-term Memory API 管理当前 trusted Owner Scope 和 Agent Scope 下的长期记忆。`tenantId`、`userId` 和 `agentId` 均由 channel/app composition 注入，客户端不能覆盖。成功响应统一为 `{ "errorCode": 0, "errorMsg": "SUCCESS", "data": ... }`；错误响应统一为 `{ "code": string, "message": string, "retryable": boolean }`。

### GET /api/v1/memory/long-term-mem

描述：分页筛选当前 scope 下的长期记忆摘要。

Path 参数：无。

Query 参数：可选 `memoryInstance`、`queryText`、`memoryType`、`knowledgeSourceType`、`state`、`isPinned`、`minConfidence`、`sinceTime`、`untilTime`、`maxLastAccessedAt`、`labels`、`limit`、`offset`；`limit` 最大为 `10000`。

Headers：可选本地认证 `Cookie`。

Body / Multipart：无请求体。

Success response：`200 application/json`，`data` 为分页结果。

字段表：`data.items` 为记忆摘要列表；`data.total`、`data.offset`、`data.limit` 为分页字段。

响应示例：

```json
{
  "errorCode": 0,
  "errorMsg": "SUCCESS",
  "data": {
    "items": [
      {
        "memoryId": "mem_1",
        "memoryType": "FACTUAL",
        "knowledgeSourceType": "LEARNED",
        "state": "ACTIVE",
        "briefIndex": "站点状态",
        "content": "站点 A 射频单元功率异常",
        "labels": ["无线", "故障"],
        "confidence": 0.9,
        "isPinned": false,
        "accessCount": 3,
        "createTime": 1719878400000,
        "updateTime": 1719878400000,
        "version": 1
      }
    ],
    "total": 1,
    "offset": 0,
    "limit": 50
  }
}
```

错误响应示例：

```json
{
  "code": "LTM_QUERY_INVALID",
  "message": "memory list request contains unsupported fields.",
  "retryable": false
}
```

Error responses：`400 LTM_QUERY_INVALID` 表示 query 非法；领域 SafeError 保留其安全状态码；服务异常返回 `503 LTM_UNAVAILABLE`。

示例：

```bash
curl "$BASE_URL/api/v1/memory/long-term-mem?memoryInstance=defaultInstance&limit=50&offset=0" -b cookies.txt
```

### POST /api/v1/memory/long-term-mem

描述：保存一条长期记忆；缺省 `memoryInstance` 为 `defaultInstance`。

Path 参数：无。

Query 参数：无。

Headers：`Content-Type: application/json`；可选本地认证 `Cookie`。

Body / Multipart：JSON 字段包括可选的 `memoryId`、`memoryInstance`、`memoryType`、`knowledgeSourceType`、`briefIndex`、`content`、`labels`、`confidence`、`source`。

请求示例：

```json
{
  "memoryType": "FACTUAL",
  "knowledgeSourceType": "LEARNED",
  "briefIndex": "站点状态",
  "content": "站点 A 射频单元功率异常",
  "labels": ["无线", "故障"],
  "confidence": 0.9,
  "source": "request-req_1"
}
```

Success response：`200 application/json`，`data` 为保存后的长期记忆。

字段表：`data.memoryId` 为记忆 ID；`data.memoryInstance` 为记忆实例；其余字段为 canonical memory view。

响应示例：

```json
{
  "errorCode": 0,
  "errorMsg": "SUCCESS",
  "data": {
    "memoryId": "mem_1",
    "tenantId": "tenant-1",
    "userId": "user-1",
    "agentId": "agent-default",
    "memoryInstance": "defaultInstance",
    "memoryType": "FACTUAL",
    "knowledgeSourceType": "LEARNED",
    "sharingState": "PRIVATE",
    "state": "ACTIVE",
    "briefIndex": "站点状态",
    "content": "站点 A 射频单元功率异常",
    "labels": ["无线", "故障"],
    "confidence": 0.9,
    "version": 1,
    "accessCount": 0,
    "recallCount": 0,
    "extractionCount": 0,
    "archivedAt": 0,
    "archiveReason": "",
    "isPinned": false,
    "source": "request-req_1",
    "createTime": 1719878400000,
    "updateTime": 1719878400000
  }
}
```

Error responses：`400 LTM_QUERY_INVALID` 表示 body 非法；领域 SafeError 保留其安全状态码；服务异常返回 `503 LTM_UNAVAILABLE`。

示例：

```bash
curl -X POST "$BASE_URL/api/v1/memory/long-term-mem" -H "Content-Type: application/json" -b cookies.txt \
  -d '{"memoryType":"FACTUAL","knowledgeSourceType":"LEARNED","briefIndex":"站点状态","content":"站点 A 正常","confidence":0.9}'
```

### POST /api/v1/memory/long-term-mem/batch

描述：在当前 trusted Owner Scope 和 Agent Scope 下批量保存长期记忆，单次最多 `100` 条。

Path 参数：无。

Query 参数：无。

Headers：`Content-Type: application/json`；可选本地认证 `Cookie`。

Body / Multipart：JSON 包含可选 `memoryInstance` 和必填 `items`；每个 item 必须包含 `memoryType`、`knowledgeSourceType`、`briefIndex`、`content`，并可包含 `memoryId`、`labels`、`confidence`、`source`、`idempotencyKey`、`state`、`archiveReason`。

请求示例：

```json
{
  "memoryInstance": "defaultInstance",
  "items": [
    {
      "memoryType": "FACTUAL",
      "knowledgeSourceType": "LEARNED",
      "briefIndex": "站点状态",
      "content": "站点 A 射频单元功率异常",
      "confidence": 0.9
    }
  ]
}
```

Success response：`200 application/json`，`data` 为批量保存结果。

字段表：`data` 返回各 item 的保存结果；`items` 至少 `1` 条、最多 `100` 条。

响应示例：

```json
{
  "errorCode": 0,
  "errorMsg": "SUCCESS",
  "data": {
    "successCount": 1,
    "failCount": 0,
    "memoryIds": ["mem_1"]
  }
}
```

Error responses：`400 LTM_QUERY_INVALID` 表示 body 非法；领域 SafeError 保留其安全状态码；服务异常返回 `503 LTM_UNAVAILABLE`。

示例：

```bash
curl -X POST "$BASE_URL/api/v1/memory/long-term-mem/batch" -H "Content-Type: application/json" -b cookies.txt \
  -d '{"memoryInstance":"defaultInstance","items":[{"memoryType":"FACTUAL","knowledgeSourceType":"LEARNED","briefIndex":"站点状态","content":"站点 A 正常","confidence":0.9}]}'
```

### POST /api/v1/memory/long-term-mem/manual

描述：人工保存一条长期记忆。

Path 参数：无。

Query 参数：无。

Headers：`Content-Type: application/json`；可选本地认证 `Cookie`。

Body / Multipart：JSON 必须包含 `memoryType`、`knowledgeSourceType`、`briefIndex`、`content`、`confidence`；可选 `memoryId`、`memoryInstance`、`labels`。

请求示例：

```json
{
  "memoryType": "PROCEDURAL",
  "knowledgeSourceType": "CONFIGURED",
  "briefIndex": "巡检步骤",
  "content": "先检查告警，再检查链路。",
  "confidence": 1,
  "labels": ["运维"]
}
```

Success response：`200 application/json`，`data` 为保存后的长期记忆。

字段表：`data.memoryId` 为记忆 ID；`data.content` 为内容；`data.confidence` 为置信度。

响应示例：

```json
{
  "errorCode": 0,
  "errorMsg": "SUCCESS",
  "data": {
    "memoryId": "mem_2",
    "tenantId": "tenant-1",
    "userId": "user-1",
    "agentId": "agent-default",
    "memoryInstance": "defaultInstance",
    "memoryType": "PROCEDURAL",
    "knowledgeSourceType": "CONFIGURED",
    "sharingState": "PRIVATE",
    "state": "ACTIVE",
    "briefIndex": "巡检步骤",
    "content": "先检查告警，再检查链路。",
    "labels": ["运维"],
    "confidence": 1,
    "version": 1,
    "accessCount": 0,
    "recallCount": 0,
    "extractionCount": 0,
    "archivedAt": 0,
    "archiveReason": "",
    "isPinned": false,
    "source": "",
    "createTime": 1719878400000,
    "updateTime": 1719878400000
  }
}
```

Error responses：`400 LTM_QUERY_INVALID` 表示必填字段缺失或非法；领域 SafeError 保留其安全状态码；服务异常返回 `503 LTM_UNAVAILABLE`。

示例：

```bash
curl -X POST "$BASE_URL/api/v1/memory/long-term-mem/manual" -H "Content-Type: application/json" -b cookies.txt \
  -d '{"memoryType":"PROCEDURAL","knowledgeSourceType":"CONFIGURED","briefIndex":"巡检步骤","content":"先检查告警，再检查链路。","confidence":1}'
```

### POST /api/v1/memory/long-term-mem/search

描述：在当前 scope 下搜索长期记忆。

Path 参数：无。

Query 参数：无。

Headers：`Content-Type: application/json`；可选本地认证 `Cookie`。

Body / Multipart：JSON 可包含 `memoryInstance`、`queryText`、`memoryType`、`knowledgeSourceType`、`minConfidence`、`sinceTime`、`untilTime`、`labels`、`limit`、`offset`。

请求示例：

```json
{
  "queryText": "核心网告警",
  "minConfidence": 0.5,
  "limit": 10,
  "offset": 0
}
```

Success response：`200 application/json`，`data` 为带匹配分数的分页结果。

字段表：`data.items[].summary` 为记忆摘要；`score` 和 `relevanceScore` 为匹配分数；其余为分页字段。

响应示例：

```json
{
  "errorCode": 0,
  "errorMsg": "SUCCESS",
  "data": {
    "items": [
      {
        "summary": {
          "memoryId": "mem_1",
          "memoryType": "FACTUAL",
          "knowledgeSourceType": "LEARNED",
          "state": "ACTIVE",
          "briefIndex": "站点状态",
          "content": "站点 A 射频单元功率异常",
          "labels": ["无线", "故障"],
          "confidence": 0.9,
          "isPinned": false,
          "accessCount": 3,
          "createTime": 1719878400000,
          "updateTime": 1719878400000,
          "version": 1
        },
        "score": 0.87,
        "relevanceScore": 0.92
      }
    ],
    "total": 1,
    "offset": 0,
    "limit": 10
  }
}
```

Error responses：`400 LTM_QUERY_INVALID` 表示搜索条件非法；领域 SafeError 保留其安全状态码；服务异常返回 `503 LTM_UNAVAILABLE`。

示例：

```bash
curl -X POST "$BASE_URL/api/v1/memory/long-term-mem/search" -H "Content-Type: application/json" -b cookies.txt \
  -d '{"queryText":"核心网告警","limit":10,"offset":0}'
```

### GET /api/v1/memory/long-term-mem/shared

描述：分页查询可供当前 scope 复制的已发布记忆。

Path 参数：无。

Query 参数：可选 `memoryInstance`、`queryText`、`memoryType`、`knowledgeSourceType`、`labels`、`limit`、`offset`。

Headers：可选本地认证 `Cookie`。

Body / Multipart：无请求体。

Success response：`200 application/json`，`data` 为已发布记忆分页结果。

字段表：`data.items` 为 published memory 摘要；`data.total`、`data.offset`、`data.limit` 为分页字段。

响应示例：

```json
{
  "errorCode": 0,
  "errorMsg": "SUCCESS",
  "data": {
    "items": [
      {
        "memoryId": "mem_shared_1",
        "memoryType": "FACTUAL",
        "knowledgeSourceType": "LEARNED",
        "state": "ACTIVE",
        "briefIndex": "故障处理经验",
        "content": "BBU 链路闪断优先检查光纤接头",
        "labels": ["传输"],
        "confidence": 0.8,
        "isPinned": false,
        "accessCount": 12,
        "createTime": 1719878400000,
        "updateTime": 1719878400000,
        "version": 1,
        "sourceMemoryId": "mem_9",
        "ownerUserId": "user-2",
        "ownerUserName": "网优专家"
      }
    ],
    "total": 1,
    "offset": 0,
    "limit": 50
  }
}
```

Error responses：`400 LTM_QUERY_INVALID` 表示 query 非法；领域 SafeError 保留其安全状态码；服务异常返回 `503 LTM_UNAVAILABLE`。

示例：

```bash
curl "$BASE_URL/api/v1/memory/long-term-mem/shared?limit=50&offset=0" -b cookies.txt
```

### POST /api/v1/memory/long-term-mem/shared/copy

描述：将一组已发布记忆复制到当前 trusted scope。

Path 参数：无。

Query 参数：无。

Headers：`Content-Type: application/json`；可选本地认证 `Cookie`。

Body / Multipart：JSON 必须包含 `memoryIds` 非空数组；可选 `memoryInstance` 和 `reasonCode`。

请求示例：

```json
{
  "memoryIds": ["mem_shared_1"],
  "memoryInstance": "defaultInstance",
  "reasonCode": "team-share"
}
```

Success response：`200 application/json`，`data` 为逐条复制结果数组。

字段表：`data[].memoryId` 为新记忆 ID；`data[].record` 为复制后的记忆；`data[].sourceMemoryId` 为来源 ID。

响应示例：

```json
{
  "errorCode": 0,
  "errorMsg": "SUCCESS",
  "data": [
    {
      "memoryId": "mem_3",
      "record": {
        "memoryId": "mem_3",
        "tenantId": "tenant-1",
        "userId": "user-1",
        "agentId": "agent-default",
        "memoryInstance": "defaultInstance",
        "memoryType": "FACTUAL",
        "knowledgeSourceType": "LEARNED",
        "sharingState": "FORK",
        "sourceMemoryId": "mem_shared_1",
        "state": "ACTIVE",
        "briefIndex": "故障处理经验",
        "content": "BBU 链路闪断优先检查光纤接头",
        "labels": ["传输"],
        "confidence": 0.8,
        "version": 1,
        "accessCount": 0,
        "recallCount": 0,
        "extractionCount": 0,
        "archivedAt": 0,
        "archiveReason": "",
        "isPinned": false,
        "source": "",
        "createTime": 1719878400000,
        "updateTime": 1719878400000
      },
      "sourceMemoryId": "mem_shared_1",
      "copyStatus": "COPIED"
    }
  ]
}
```

Error responses：`400 LTM_QUERY_INVALID` 表示 `memoryIds` 为空或 body 非法；领域 SafeError 保留其安全状态码；服务异常返回 `503 LTM_UNAVAILABLE`。

示例：

```bash
curl -X POST "$BASE_URL/api/v1/memory/long-term-mem/shared/copy" -H "Content-Type: application/json" -b cookies.txt \
  -d '{"memoryIds":["mem_shared_1"],"memoryInstance":"defaultInstance"}'
```

### GET /api/v1/memory/long-term-mem/{memoryId}/record

描述：读取指定长期记忆的 canonical record 投影。

Path 参数：`memoryId`（string，必填）为长期记忆 ID。

Query 参数：可选 `memoryInstance`，缺省为 `defaultInstance`。

Headers：可选本地认证 `Cookie`。

Body / Multipart：无请求体。

Success response：`200 application/json`，`data` 为指定长期记忆。

字段表：`data.memoryId` 为记忆 ID；`data.tenantId`、`data.userId` 和 `data.agentId` 来自 trusted scope。

响应示例：

```json
{
  "errorCode": 0,
  "errorMsg": "SUCCESS",
  "data": {
    "memoryId": "mem_1",
    "tenantId": "tenant-1",
    "userId": "user-1",
    "agentId": "agent-default",
    "memoryInstance": "defaultInstance",
    "memoryType": "FACTUAL",
    "knowledgeSourceType": "LEARNED",
    "sharingState": "PRIVATE",
    "state": "ACTIVE",
    "briefIndex": "站点状态",
    "content": "站点 A 射频单元功率异常",
    "labels": ["无线", "故障"],
    "confidence": 0.9,
    "version": 1,
    "accessCount": 3,
    "recallCount": 1,
    "extractionCount": 0,
    "lastAccessedAt": 1719878500000,
    "archivedAt": 0,
    "archiveReason": "",
    "isPinned": false,
    "source": "request-req_1",
    "createTime": 1719878400000,
    "updateTime": 1719878400000
  }
}
```

Error responses：`400 LTM_QUERY_INVALID` 表示 query 非法；领域 SafeError 可返回安全的 not-found/authorization 状态；服务异常返回 `503 LTM_UNAVAILABLE`。

示例：

```bash
curl "$BASE_URL/api/v1/memory/long-term-mem/mem_1/record?memoryInstance=defaultInstance" -b cookies.txt
```

### GET /api/v1/memory/long-term-mem/{memoryId}

描述：读取指定长期记忆的详情视图。

Path 参数：`memoryId`（string，必填）为长期记忆 ID。

Query 参数：可选 `memoryInstance`，缺省为 `defaultInstance`。

Headers：可选本地认证 `Cookie`。

Body / Multipart：无请求体。

Success response：`200 application/json`，`data` 为包含详情字段的长期记忆。

字段表：`data.memoryId` 为记忆 ID；其余字段为 canonical memory detail view。

响应示例：同 `GET /api/v1/memory/long-term-mem/{memoryId}/record`。

Error responses：`400 LTM_QUERY_INVALID` 表示 query 非法；领域 SafeError 可返回安全的 not-found/authorization 状态；服务异常返回 `503 LTM_UNAVAILABLE`。

示例：

```bash
curl "$BASE_URL/api/v1/memory/long-term-mem/mem_1?memoryInstance=defaultInstance" -b cookies.txt
```

### DELETE /api/v1/memory/long-term-mem/{memoryId}

描述：删除当前 scope 下指定的长期记忆。

Path 参数：`memoryId`（string，必填）为长期记忆 ID。

Query 参数：可选 `memoryInstance` 和审计用 `reasonCode`。

Headers：可选本地认证 `Cookie`。

Body / Multipart：无请求体。

Success response：`200 application/json`，`data.memoryId` 返回已删除的记忆 ID。

字段表：`data.memoryId` 为已删除的长期记忆 ID。

响应示例：

```json
{
  "errorCode": 0,
  "errorMsg": "SUCCESS",
  "data": {
    "memoryId": "mem_1"
  }
}
```

Error responses：`400 LTM_QUERY_INVALID` 表示 query 非法；领域 SafeError 可返回安全的 not-found/conflict 状态；服务异常返回 `503 LTM_UNAVAILABLE`。

示例：

```bash
curl -X DELETE "$BASE_URL/api/v1/memory/long-term-mem/mem_1?reasonCode=user-request" -b cookies.txt
```

### PATCH /api/v1/memory/long-term-mem/{memoryId}

描述：归档、恢复、置顶或更新指定长期记忆的访问状态。

Path 参数：`memoryId`（string，必填）为长期记忆 ID。

Query 参数：无。

Headers：`Content-Type: application/json`；可选本地认证 `Cookie`。

Body / Multipart：JSON 可包含 `memoryInstance`、`targetState`、`archiveReason`、`delta`、`lastAccessTime`、`isPinned`、`expectedVersion`。

请求示例：

```json
{
  "isPinned": true,
  "expectedVersion": 2
}
```

Success response：`200 application/json`，`data` 返回变更状态、当前版本和可选 record。

字段表：`data.status` 为变更结果；`data.memoryId` 为记忆 ID；`data.currentVersion` 为当前版本；`data.record` 可选。

响应示例：

```json
{
  "errorCode": 0,
  "errorMsg": "SUCCESS",
  "data": {
    "status": "UPDATED",
    "memoryId": "mem_1",
    "currentVersion": 3
  }
}
```

Error responses：`400 LTM_QUERY_INVALID` 表示 body 非法；领域 SafeError 可返回安全的 not-found/conflict 状态；服务异常返回 `503 LTM_UNAVAILABLE`。

示例：

```bash
curl -X PATCH "$BASE_URL/api/v1/memory/long-term-mem/mem_1" -H "Content-Type: application/json" -b cookies.txt \
  -d '{"isPinned":true,"expectedVersion":2}'
```

### POST /api/v1/memory/long-term-mem/{memoryId}/publish

描述：将当前 scope 下的长期记忆发布到共享记忆视图。

Path 参数：`memoryId`（string，必填）为长期记忆 ID。

Query 参数：无。

Headers：`Content-Type: application/json`；可选本地认证 `Cookie`。

Body / Multipart：JSON 可包含 `memoryInstance` 和审计用 `reasonCode`。

请求示例：

```json
{
  "reasonCode": "share-approved"
}
```

Success response：`200 application/json`，`data` 返回已发布记忆和来源信息。

字段表：`data.publishedMemory` 为发布后的记忆；`data.sourceMemoryId` 为来源 ID；`data.ownerUserId` 为可信 owner。

响应示例：

```json
{
  "errorCode": 0,
  "errorMsg": "SUCCESS",
  "data": {
    "publishedMemory": {
      "memoryId": "mem_shared_1",
      "tenantId": "tenant-1",
      "userId": "user-1",
      "agentId": "agent-default",
      "memoryInstance": "defaultInstance",
      "memoryType": "FACTUAL",
      "knowledgeSourceType": "LEARNED",
      "sharingState": "SHARED",
      "sourceMemoryId": "mem_1",
      "state": "ACTIVE",
      "briefIndex": "站点状态",
      "content": "站点 A 射频单元功率异常",
      "labels": ["无线", "故障"],
      "confidence": 0.9,
      "version": 2,
      "accessCount": 0,
      "recallCount": 0,
      "extractionCount": 0,
      "archivedAt": 0,
      "archiveReason": "",
      "isPinned": false,
      "source": "request-req_1",
      "createTime": 1719878400000,
      "updateTime": 1719878500000
    },
    "sourceMemoryId": "mem_1",
    "ownerUserId": "user-1"
  }
}
```

Error responses：`400 LTM_QUERY_INVALID` 表示 body 非法；领域 SafeError 可返回安全的 not-found/conflict 状态；服务异常返回 `503 LTM_UNAVAILABLE`。

示例：

```bash
curl -X POST "$BASE_URL/api/v1/memory/long-term-mem/mem_1/publish" -H "Content-Type: application/json" -b cookies.txt \
  -d '{"reasonCode":"share-approved"}'
```

### POST /api/v1/memory/long-term-mem/{memoryId}/unpublish

描述：撤销指定长期记忆的共享发布状态。

Path 参数：`memoryId`（string，必填）为长期记忆 ID。

Query 参数：无。

Headers：`Content-Type: application/json`；可选本地认证 `Cookie`。

Body / Multipart：JSON 可包含 `memoryInstance` 和审计用 `reasonCode`。

请求示例：

```json
{
  "reasonCode": "share-revoked"
}
```

Success response：`200 application/json`，`data.memoryId` 返回已撤销发布的记忆 ID。

字段表：`data.memoryId` 为已撤销发布的长期记忆 ID。

响应示例：

```json
{
  "errorCode": 0,
  "errorMsg": "SUCCESS",
  "data": {
    "memoryId": "mem_shared_1"
  }
}
```

Error responses：`400 LTM_QUERY_INVALID` 表示 body 非法；领域 SafeError 可返回安全的 not-found/conflict 状态；服务异常返回 `503 LTM_UNAVAILABLE`。

示例：

```bash
curl -X POST "$BASE_URL/api/v1/memory/long-term-mem/mem_1/unpublish" -H "Content-Type: application/json" -b cookies.txt \
  -d '{"reasonCode":"share-revoked"}'
```

## Background Task

### GET /api/v1/sessions/{sessionId}/background-tasks

描述：查询当前会话下后台任务列表。先按 Web 身份校验会话 owner scope；后台任务服务未装配（多数 local/remote 部署无 background-capable sandbox）时降级返回空列表 `200 { "tasks": [] }`，不返回 503，便于前端无错轮询。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID。 |

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回后台任务列表。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tasks` | array | 是 | 后台任务列表。 |
| `tasks[].taskId` | string | 是 | 任务 ID。 |
| `tasks[].commandName` | string | 是 | 命令名。 |
| `tasks[].commandLine` | string | 否 | safe command line。 |
| `tasks[].status` | `"RUNNING"` \| `"COMPLETED"` \| `"FAILED"` \| `"KILLED"` | 是 | 任务状态。 |
| `tasks[].startedAt` | number | 是 | 启动时间。 |
| `tasks[].finishedAt` | number | 否 | 结束时间。 |
| `tasks[].exitCode` | number | 否 | 退出码。 |
| `tasks[].stdoutRef` | string | 是 | stdout 引用。 |
| `tasks[].stderrRef` | string | 是 | stderr 引用。 |

```json
{
  "tasks": [
    {
      "taskId": "bg_1",
      "commandName": "bash",
      "commandLine": "npm test",
      "status": "RUNNING",
      "startedAt": 1719878400000,
      "stdoutRef": "stdout:bg_1",
      "stderrRef": "stderr:bg_1"
    }
  ]
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `sessionId must not exceed 256 characters.` | path schema 不合法。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | safe authorization code | safe message | 当前身份无权读取该会话。 |
| 404 | safe not-found code | safe message | 会话不存在。 |

示例：

```bash
curl -X GET "$BASE_URL/api/v1/sessions/sess_123/background-tasks" -b cookies.txt
```

### GET /api/v1/sessions/{sessionId}/background-tasks/{taskId}/output

描述：读取后台任务 stdout/stderr 的 bounded 输出。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID。 |
| `taskId` | string | 是 | 后台任务 ID。 |

Query 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `stream` | `"stdout"` \| `"stderr"` string | 否 | 缺省为 `stdout`；其他值按 `stdout` 处理。 |
| `limitBytes` | integer string | 否 | 输出字节上限；后端 clamp 到 1 到 262144。 |

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回 stdout/stderr 内容。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `content` | string | 是 | 输出内容。 |
| `truncated` | boolean | 是 | 是否因 `limitBytes` 截断。 |
| `stream` | `"stdout"` \| `"stderr"` | 是 | 返回的输出流。 |

```json
{
  "content": "test output",
  "truncated": false,
  "stream": "stdout"
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `sessionId must not exceed 256 characters.` / `stream value is not allowed.` / `limitBytes format is invalid.` / `Field '{name}' is not allowed.` | path/query schema 不合法。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | safe authorization code | safe message | 当前身份无权读取该会话。 |
| 404 | `BACKGROUND_TASK_OUTPUT_UNAVAILABLE` | `Background task output is unavailable.` | 任务不存在、跨 session、输出不可用，或 background task port 未装配（降级为 404，不返回 503）。 |

示例：

```bash
curl -X GET "$BASE_URL/api/v1/sessions/sess_123/background-tasks/bg_1/output?stream=stderr&limitBytes=65536" \
  -b cookies.txt
```

### POST /api/v1/sessions/{sessionId}/background-tasks/{taskId}/kill

描述：终止当前会话下指定后台任务。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID。 |
| `taskId` | string | 是 | 后台任务 ID。 |

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回任务终止结果。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `status` | `"KILLED"` \| `"NOT_FOUND"` \| `"ALREADY_TERMINAL"` | 是 | kill 结果状态。 |

```json
{
  "status": "KILLED"
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `sessionId must not exceed 256 characters.` / `taskId must not exceed 256 characters.` | path schema 不合法。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | safe authorization code | safe message | 当前身份无权操作该会话。 |
| 404 | `BACKGROUND_TASK_NOT_FOUND` | `Background task is unavailable.` | background task port 未装配（降级为 404，不返回 503）；任务不存在时由 port 返回对应 safe not-found code。 |

示例：

```bash
curl -X POST "$BASE_URL/api/v1/sessions/sess_123/background-tasks/bg_1/kill" -b cookies.txt
```

## Annotation / Favorite

### POST /api/v1/sessions/{sessionId}/runs/{runId}/annotations

描述：为某次 run 写入或更新反馈、收藏。至少提供 `sentiment`、`isFavorited` 或 `isQuestionFavorited` 之一。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID。 |
| `runId` | string | 是 | run ID。 |

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | `application/json`。 |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sentiment` | `"UP"` \| `"DOWN"` \| null | 否 | 点赞/点踩反馈。 |
| `isFavorited` | boolean | 否 | 是否收藏回答。 |
| `isQuestionFavorited` | boolean | 否 | 是否收藏用户问题。 |

```json
{
  "sentiment": "UP",
  "isFavorited": true
}
```

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回 annotation view。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `annotationId` | string | 否 | annotation ID。 |
| `sessionId` | string | 否 | 会话 ID。 |
| `requestRunId` | string | 否 | run ID。 |
| `sentiment` | `"UP"` \| `"DOWN"` \| null | 是 | 反馈。 |
| `isFavorited` | boolean | 是 | 是否收藏回答。 |
| `isQuestionFavorited` | boolean | 是 | 是否收藏用户问题。 |
| `createdAt` | number | 否 | 创建时间。 |

```json
{
  "annotationId": "ann_1",
  "sessionId": "sess_123",
  "requestRunId": "run_1",
  "sentiment": "UP",
  "isFavorited": true,
  "isQuestionFavorited": false,
  "createdAt": 1719878400000
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `sessionId must not exceed 256 characters.` / `sentiment value is not allowed.` / `Field '{name}' is not allowed.` | path/body schema 不合法。 |
| 400 | `REQUEST_VALIDATION_FAILED` | `At least one of sentiment, isFavorited, or isQuestionFavorited must be provided.` | body 未包含任何可更新字段。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | safe authorization code | safe message | 当前身份无权更新该 run。 |
| 404 | `ANNOTATION_RUN_NOT_FOUND` | safe message | run 记录不存在或不属于该 session。 |
| 503 | `ANNOTATIONS_UNAVAILABLE` | `Annotations service is unavailable.` | annotation port 未装配。 |

示例：

```bash
curl -X POST "$BASE_URL/api/v1/sessions/sess_123/runs/run_1/annotations" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"sentiment":"UP","isFavorited":true}'
```

### GET /api/v1/sessions/{sessionId}/annotations

描述：查询某个会话下的 annotations。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID。 |

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回会话 annotation 列表。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `annotations` | array | 是 | annotation 列表。 |
| `annotations[].annotationId` | string | 是 | annotation ID。 |
| `annotations[].requestRunId` | string | 是 | run ID。 |
| `annotations[].sentiment` | `"UP"` \| `"DOWN"` \| null | 是 | 反馈。 |
| `annotations[].isFavorited` | boolean | 是 | 是否收藏回答。 |
| `annotations[].isQuestionFavorited` | boolean | 是 | 是否收藏用户问题。 |
| `annotations[].createdAt` | number | 是 | 创建时间。 |

```json
{
  "annotations": [
    {
      "annotationId": "ann_1",
      "requestRunId": "run_1",
      "sentiment": "UP",
      "isFavorited": true,
      "isQuestionFavorited": false,
      "createdAt": 1719878400000
    }
  ]
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `sessionId must not exceed 256 characters.` | path schema 不合法。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | safe authorization code | safe message | 当前身份无权读取该会话。 |
| 404 | safe not-found code | safe message | 会话不存在。 |
| 503 | `ANNOTATIONS_UNAVAILABLE` | `Annotations service is unavailable.` | annotation port 未装配。 |

示例：

```bash
curl -X GET "$BASE_URL/api/v1/sessions/sess_123/annotations" -b cookies.txt
```

### GET /api/v1/favorites

描述：查询当前 Agent Scope 下已收藏的会话页。

Path 参数：无。

Query 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `offset` | integer string | 否 | 非负整数，范围 `0` 到 `10000`，默认 `0`。 |
| `limit` | integer string | 否 | 1 到 100，默认 `50`。 |

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回收藏分页。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `entries` | array | 是 | 收藏会话列表。 |
| `entries[].sessionId` | string | 是 | 会话 ID。 |
| `entries[].favoriteCount` | number | 否 | 收藏数量。 |
| `entries[].sessionTitle` | string | 否 | 会话标题。 |
| `entries[].sessionUpdatedAt` | number | 否 | 会话更新时间。 |
| `offset` | integer | 是 | 当前偏移。 |
| `limit` | integer | 是 | 当前页大小。 |
| `hasMore` | boolean | 是 | 是否还有下一页。 |

```json
{
  "entries": [
    {
      "sessionId": "sess_123",
      "favoriteCount": 2,
      "sessionTitle": "基站故障诊断",
      "sessionUpdatedAt": 1719878400000
    }
  ],
  "offset": 0,
  "limit": 50,
  "hasMore": false
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `Field '{name}' is not allowed.` | query 包含未知字段。 |
| 400 | `REQUEST_VALIDATION_FAILED` | `offset must be an integer.` / `offset must be a non-negative integer.` / `offset must not exceed 10000.` | `offset` 不是合法非负整数或超过 10000。 |
| 400 | `REQUEST_VALIDATION_FAILED` | `limit must be a positive integer.` / `limit must not exceed 100.` | `limit` 不是合法正整数或超过 100。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 503 | `ANNOTATIONS_UNAVAILABLE` | `Annotations service is unavailable.` | annotation/favorite port 未装配。 |

示例：

```bash
curl -X GET "$BASE_URL/api/v1/favorites?offset=0&limit=50" -b cookies.txt
```

## Share

### POST /api/v1/sessions/{sessionId}/shares

描述：为会话中的指定 run 创建分享链接。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 会话 ID。 |

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | `application/json`。 |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `runIds` | string[] | 是 | minItems: 1, maxItems: 100；每个 run ID minLength: 1, maxLength: 256。 |
| `originUrl` | string | 是 | minLength: 1, maxLength: 2048。 |
| `expiresIn` | `"24h"` \| `"7d"` \| `"30d"` \| `"permanent"` | 是 | 分享有效期。 |
| `allowedOps` | string[] \| null | 是 | 为数组时 maxItems: 100，元素 minLength: 1, maxLength: 256；请求体不接受额外字段。 |

```json
{
  "runIds": ["run_1"],
  "originUrl": "http://127.0.0.1:3000/session/sess_123",
  "expiresIn": "7d",
  "allowedOps": ["view"]
}
```

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 创建分享链接成功。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `shareId` | string | 是 | 分享 ID。 |
| `shareUrl` | string | 是 | 可访问分享 URL。 |

```json
{
  "shareId": "share_1",
  "shareUrl": "http://127.0.0.1:3000/#/shared/share_1"
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `sessionId must not exceed 256 characters.` / `runIds is required.` / `originUrl is required.` / `expiresIn value is not allowed.` / `Field '{name}' is not allowed.` | path/body schema 不合法。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | `SHARE_FORBIDDEN` 或 safe authorization code | safe message | 当前身份无权分享该会话或 run。 |
| 404 | safe not-found code | safe message | 会话或 run 不存在。 |
| 503 | `SHARES_UNAVAILABLE` | `Shares service is unavailable.` | share port 未装配。 |

示例：

```bash
curl -X POST "$BASE_URL/api/v1/sessions/sess_123/shares" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"runIds":["run_1"],"originUrl":"http://127.0.0.1:3000/session/sess_123","expiresIn":"7d","allowedOps":["view"]}'
```

### GET /api/v1/shares/{shareId}/conversation

描述：读取分享会话内容。可通过 `X-Viewer-Ops` header 传入 viewer ops。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `shareId` | string | 是 | 分享 ID。 |

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `X-Viewer-Ops` | 否 | JSON 字符串数组，例如 `["view"]`。非法 JSON 会被当作无 ops。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回分享会话内容。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | 被分享会话 ID。 |
| `messages` | array | 是 | 被分享消息列表。 |
| `messages[].messageId` | string | 是 | 消息 ID。 |
| `messages[].sessionId` | string | 是 | 会话 ID。 |
| `messages[].requestId` | string | 否 | 请求 ID。 |
| `messages[].runId` | string | 否 | run ID。 |
| `messages[].role` | string | 是 | 消息角色。 |
| `messages[].content` | string | 是 | 展示内容。 |
| `messages[].contentType` | string | 是 | 内容类型。 |
| `messages[].metadata` | object | 是 | safe metadata。 |
| `messages[].visible` | boolean | 是 | 是否可见。 |
| `messages[].createdAt` | number | 是 | 创建时间。 |
| `createdAt` | number | 是 | 分享创建时间。 |

```json
{
  "sessionId": "sess_123",
  "messages": [
    {
      "messageId": "msg_1",
      "sessionId": "sess_123",
      "requestId": "req_1",
      "runId": "run_1",
      "role": "USER",
      "content": "分析小区掉话率升高原因",
      "contentType": "TEXT",
      "metadata": {},
      "visible": true,
      "createdAt": 1719878400000
    }
  ],
  "createdAt": 1719878400000
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `shareId must not exceed 256 characters.` | path schema 不合法。 |
| 403 | `SHARE_FORBIDDEN` | safe message | viewer ops 不满足分享访问要求。 |
| 404 | `SHARE_NOT_FOUND` | safe message | 分享不存在。 |
| 410 | `SHARE_EXPIRED` | safe message | 分享已过期。 |
| 503 | `SHARES_UNAVAILABLE` | `Shares service is unavailable.` | share port 未装配。 |

示例：

```bash
curl -X GET "$BASE_URL/api/v1/shares/share_1/conversation" \
  -H 'X-Viewer-Ops: ["view"]'
```

## File

### POST /api/v1/sessions/{sessionId}/files/upload

描述：把一个附件上传到 gateway 管理的会话临时暂存区，供后续 JSON request 通过 `attachments` 引用。Owner Scope 来自 Web 认证边界，Agent Scope 来自已持久化会话；客户端不能覆盖这些 scope。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | minLength: 1, maxLength: 256。 |

Query 参数：无。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- | --- |
| `Content-Type` | 是 | `multipart/form-data; boundary=...`。 |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：

| part | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tempRunId` | text | 是 | 上传批次 ID；每次请求只能提供一个。 |
| `file` | file | 是 | 单个附件；服务端使用 multipart 文件名作为可信校验输入。 |

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- | --- |
| 200 | `application/json` | 文件已写入当前 owner、agent、session scope 的临时目录。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tempRunId` | string | 是 | 后续 request 引用的上传批次 ID。 |
| `fileName` | string | 是 | 已暂存文件名。 |
| `sizeBytes` | integer | 是 | 服务端实际接收的文件字节数。 |

```json
{
  "tempRunId": "a1b2c3d4",
  "fileName": "report.md",
  "sizeBytes": 1024
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | safe validation message | 非 multipart、缺少或重复 `tempRunId`、缺少文件，或附件校验失败。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | safe authorization code | safe message | 当前身份无权访问该会话。 |
| 404 | safe not-found code | safe message | 会话不存在。 |
| 503 | `UPLOAD_NOT_AVAILABLE` | `File upload service is unavailable.` | staged upload runtime 或上传配置未装配。 |
| 503 | `UPLOAD_CONCURRENCY_TIMEOUT` | `Upload service is busy, please try again later.` | 上传并发等待超时。 |

示例：

```bash
curl -X POST "$BASE_URL/api/v1/sessions/sess-1/files/upload" \
  -F "file=@report.md" -F "tempRunId=a1b2c3d4" \
  -b cookies.txt
```

### DELETE /api/v1/sessions/{sessionId}/files/tmp/{tempRunId}

描述：删除当前 owner、session scope 下的一份 gateway 临时文件。该操作用于取消上传或 request 提交失败后的清理。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | minLength: 1, maxLength: 256。 |
| `tempRunId` | string | 是 | minLength: 1, maxLength: 256。 |

Query 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `fileName` | string | 是 | minLength: 1, maxLength: 255。 |

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- | --- |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- | --- |
| 204 | 无 | 删除完成；staged upload runtime 未装配时也安全返回 204。 |

字段表：响应无 body。

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `fileName query parameter is required.` | `fileName` 缺失或为空。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 403 | safe authorization code | safe message | 当前身份无权删除该临时文件。 |
| 404 | safe not-found code | safe message | 会话或临时文件不存在。 |

示例：

```bash
curl -X DELETE "$BASE_URL/api/v1/sessions/sess-1/files/tmp/a1b2c3d4?fileName=report.md" \
  -b cookies.txt
```

### GET /api/v1/sessions/{sessionId}/files/download

描述：代理下载 HOFS 远端对象存储中的文件。通过完整 HOFS object name 定位文件，后端 materialize 到临时文件后流式返回，响应结束后清理临时文件。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | minLength: 1, maxLength: 256。 |

Query 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 是 | 完整 HOFS object name（URL-encoded），如 `aicoservice/answer/{sessionId}/{chatId}/result.xlsx`。禁止 `..`、绝对路径、空字节。 |

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- | --- |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- | --- |
| 200 | 由文件扩展名推断 | 流式返回文件字节，`Content-Disposition: attachment`，含 `Content-Length`。 |

字段表：无 JSON 响应体（二进制流）。

```
Content-Disposition: attachment; filename="result.xlsx"
Content-Length: 20480
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
<binary stream>
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | safe validation message | `path` 缺失或含路径穿越。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 404 | `SESSION_NOT_FOUND` | safe not-found message | session 不存在或不属于当前用户。 |
| 503 | `DOWNLOAD_NOT_AVAILABLE` | safe unavailable message | 下载服务不可用。 |
| 503 | `DOWNLOAD_TEMP_CAPACITY_EXCEEDED` | safe capacity message | 下载临时存储已达上限。 |

示例：

```bash
curl -X GET "$BASE_URL/api/v1/sessions/sess-1/files/download?path=aicoservice%2Fanswer%2Fsess1%2Frun1%2Fresult.xlsx" \
  -b cookies.txt -o result.xlsx
```


## Skill / Questions

### GET /api/v1/skills

描述：查询当前身份可见的 skill catalog。

Path 参数：无。

Query 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `pageNum` | integer string | 否 | 默认 `1`，必须大于等于 1。 |
| `pageSize` | integer string | 否 | 默认 `50`，范围 1 到 100。 |
| `keyword` | string | 否 | maxLength: 512；trim 后为空则忽略。 |

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回 skill catalog 分页。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `total` | integer | 是 | 总数。 |
| `pageNum` | integer | 是 | 当前页。 |
| `pageSize` | integer | 是 | 页大小。 |
| `skills` | array | 是 | skill 列表。 |
| `skills[].capabilityId` | string | 是 | capability ID。 |
| `skills[].displayName` | string | 是 | 展示名。 |
| `skills[].description` | string | 否 | 描述。 |
| `skills[].providerKind` | `"BUNDLED"` \| `"LOCAL_DIRECTORY"` \| `"SKILL_HUB"` | 是 | provider 类型。 |
| `skills[].version` | string | 否 | 版本。 |

```json
{
  "total": 1,
  "pageNum": 1,
  "pageSize": 50,
  "skills": [
    {
      "capabilityId": "network-diagnosis",
      "displayName": "网络诊断",
      "description": "面向网络运维诊断的内置能力",
      "providerKind": "BUNDLED",
      "version": "1.0.0"
    }
  ]
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `keyword must not exceed 512 characters.` / `Field '{name}' is not allowed.` | query schema 不合法。 |
| 400 | `REQUEST_VALIDATION_FAILED` | `pageNum must be a positive integer.` / `pageSize must be a positive integer.` / `pageSize must not exceed 100.` | `pageNum` 或 `pageSize` 不是合法正整数或超过上限。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 503 | safe unavailable code | safe message | skill catalog 依赖不可用。 |

示例：

```bash
curl -X GET "$BASE_URL/api/v1/skills?pageNum=1&pageSize=50&keyword=%E8%AF%8A%E6%96%AD" \
  -b cookies.txt
```

### GET /api/v1/category-questions

描述：查询当前 Agent Scope 下的分类问题目录。未装配服务时返回空目录；服务调用失败时返回 `503 CATEGORY_QUESTION_UNAVAILABLE`。

Path 参数：无。

Query 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `locale` | string | 否 | 枚举 `"zh-CN"` | `"en-US"`。 |

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回分类问题目录。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `locale` | string | 是 | 响应 locale。 |
| `categories` | array | 是 | 分类列表。 |
| `categories[].id` | string | 否 | 分类 ID。 |
| `categories[].title` | string | 否 | 分类标题。 |
| `categories[].questions` | array | 否 | 分类下问题。 |
| `categories[].questions[].text` | string | 是 | 问题文本。 |
| `categories[].questions[].fixed` | boolean | 是 | 是否固定问题。 |

```json
{
  "locale": "zh-CN",
  "categories": []
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `locale value is not allowed.` / `Field '{name}' is not allowed.` | query schema 不合法。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 503 | `CATEGORY_QUESTION_UNAVAILABLE` | `Category question service is temporarily unavailable.` | 分类问题服务调用失败。 |

示例：

```bash
curl -X GET "$BASE_URL/api/v1/category-questions?locale=zh-CN" -b cookies.txt
```

### GET /api/v1/frequent-questions

描述：查询当前 Owner Scope 和 Agent Scope 下合并排序后的高频/常问问题。未装配服务时返回空列表；服务调用失败时返回 `503 FREQUENT_QUESTION_UNAVAILABLE`。

Path 参数：无。

Query 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `locale` | string | 否 | 枚举 `"zh-CN"` | `"en-US"`。 |

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回高频问题列表。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `locale` | string | 是 | 响应 locale。 |
| `questions` | array | 是 | 问题列表。 |
| `questions[].text` | string | 是 | 问题文本。 |

```json
{
  "locale": "zh-CN",
  "questions": [
    {
      "text": "是否需要进一步分析切换失败 TOP 小区？"
    }
  ]
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | `locale value is not allowed.` / `Field '{name}' is not allowed.` | query schema 不合法。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 503 | `FREQUENT_QUESTION_UNAVAILABLE` | `Frequent question service is temporarily unavailable.` | 高频问题服务调用失败。 |

示例：

```bash
curl -X GET "$BASE_URL/api/v1/frequent-questions?locale=zh-CN" -b cookies.txt
```

### GET /api/v1/question-association

描述：按输入关键词查询联想问题列表。`keyword.trim()` 不能为空；未装配服务时返回空列表；服务调用失败时返回 `503 QUESTION_ASSOCIATION_UNAVAILABLE`。

Path 参数：无。

Query 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `keyword` | string | 是 | minLength: 1, maxLength: 512；trim 后非空的关键词。 |
| `locale` | string | 否 | 枚举 `"zh-CN"` | `"en-US"`。 |

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Cookie` | 否 | 本地认证 Cookie。 |

Body / Multipart：无请求体。

Success response：

| HTTP | Content-Type | 说明 |
| --- | --- | --- |
| 200 | `application/json` | 返回联想问题列表。 |

字段表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `locale` | string | 是 | 响应 locale。 |
| `questions` | array | 是 | 联想问题列表。 |
| `questions[].text` | string | 是 | minLength: 1, maxLength: 512。 |
| `questions[].source` | `"configured"` \| `"high-frequency"` | 是 | 来源。 |

```json
{
  "locale": "zh-CN",
  "questions": [
    {
      "text": "分析当前告警根因",
      "source": "high-frequency"
    }
  ]
}
```

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `INVALID_KEYWORD` | `Keyword must not be empty.` | `keyword.trim()` 为空。 |
| 400 | `REQUEST_VALIDATION_FAILED` | `keyword is required.` / `keyword must not exceed 512 characters.` / `locale value is not allowed.` / `Field '{name}' is not allowed.` | query schema 不合法。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 未认证。 |
| 503 | `QUESTION_ASSOCIATION_UNAVAILABLE` | `Question association service is temporarily unavailable.` | 联想问题服务调用失败。 |

示例：

```bash
curl -X GET "$BASE_URL/api/v1/question-association?keyword=%E5%91%8A%E8%AD%A6&locale=zh-CN" \
  -b cookies.txt
```

## IR Surface

IR（机机交互）surface 面向外部系统（编排系统、网管平台、上游业务系统）的程序化调用。路径前缀 `/api/v1/ir`。以下明确列出的 6 个端点与各自 ER（人机交互）对应端点保持相同协议、DTO、schema 和 stream 行为，区别仅在身份来源和 URL prefix。

### 通用约定

- 身份通过 trusted-header 模式注入：上游网关已完成认证并注入 `x-tenant-id`、`x-subject-id`、`x-display-name` 请求头。NextAgent 只读不校验凭证。
- `x-tenant-id` 和 `x-subject-id` 必填；`x-display-name` 可选，缺省回退配置默认值。
- Agent Scope 不从 header 取，仍来自 `requireSession` 返回的持久化 `session.agentId`。
- IR 与 ER 认证隔离：IR 路由只认 header，ER 路由只认 cookie，互不交叉。缺凭证统一 safe 401，不产生任何 side effect。
- IR surface 只暴露以下 6 个端点，不暴露 Activity SSE、Activity WebSocket、activity consume，也不暴露 bootstrap、skills、conversation、annotations、shares 等 UI 专属端点。

### POST /api/v1/ir/sessions

描述：创建会话。协议与 `POST /api/v1/sessions` 完全一致。

Headers：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | `application/json`。 |
| `x-tenant-id` | 是 | Owner Scope tenant。 |
| `x-subject-id` | 是 | Owner Scope subject。 |
| `x-display-name` | 否 | 展示名，缺省回退配置默认值。 |

Body / Multipart：同 `POST /api/v1/sessions`。

Success response：同 `POST /api/v1/sessions`。

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 400 | `REQUEST_VALIDATION_FAILED` | safe validation message | 请求体不合法。 |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 缺 `x-tenant-id` 或 `x-subject-id`。 |
| 503 | safe unavailable code | safe message | session 创建依赖不可用。 |

示例：

```bash
curl -X POST "$BASE_URL/api/v1/ir/sessions" \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: T1" \
  -H "x-subject-id: U1" \
  -H "x-display-name: IR System" \
  -d '{"locale":"zh-CN"}'
```

### POST /api/v1/ir/sessions/{sessionId}/requests

描述：提交请求。协议与 `POST /api/v1/sessions/{sessionId}/requests` 完全一致。

Headers：同 IR 通用约定。

Body / Multipart：同 `POST /api/v1/sessions/{sessionId}/requests`。

Success response：同 `POST /api/v1/sessions/{sessionId}/requests`。

Error responses：同 `POST /api/v1/sessions/{sessionId}/requests`，额外：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 缺身份头。 |

示例：

```bash
curl -X POST "$BASE_URL/api/v1/ir/sessions/sess_123/requests" \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: T1" \
  -H "x-subject-id: U1" \
  -d '{"inputText":"分析此告警的根因","idempotencyKey":"key-1"}'
```

### GET /api/v1/ir/sessions/{sessionId}/stream

描述：SSE 事件流。协议与 `GET /api/v1/sessions/{sessionId}/stream` 完全一致，支持 `lastSeenSequence` replay。

Headers：同 IR 通用约定。

Query 参数：同 `GET /api/v1/sessions/{sessionId}/stream`。

Success response：同 `GET /api/v1/sessions/{sessionId}/stream`（`text/event-stream`）。

Error responses：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 缺身份头。 |
| 404 | safe not-found code | safe message | 会话不存在或不属于当前 scope。 |

示例：

```bash
curl -N "$BASE_URL/api/v1/ir/sessions/sess_123/stream?lastSeenSequence=10" \
  -H "x-tenant-id: T1" \
  -H "x-subject-id: U1"
```

### POST /api/v1/ir/sessions/{sessionId}/cancel

描述：取消请求。协议与 `POST /api/v1/sessions/{sessionId}/cancel` 完全一致。

Headers：同 IR 通用约定。

Body / Multipart：同 `POST /api/v1/sessions/{sessionId}/cancel`。

Success response：同 `POST /api/v1/sessions/{sessionId}/cancel`。

Error responses：同 `POST /api/v1/sessions/{sessionId}/cancel`，额外：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 缺身份头。 |

示例：

```bash
curl -X POST "$BASE_URL/api/v1/ir/sessions/sess_123/cancel" \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: T1" \
  -H "x-subject-id: U1" \
  -d '{"expectedLatestRequestId":"req_1","idempotencyKey":"key-1"}'
```

### POST /api/v1/ir/sessions/{sessionId}/retry

描述：重试请求。协议与 `POST /api/v1/sessions/{sessionId}/retry` 完全一致。

Headers：同 IR 通用约定。

Body / Multipart：同 `POST /api/v1/sessions/{sessionId}/retry`。

Success response：同 `POST /api/v1/sessions/{sessionId}/retry`。

Error responses：同 `POST /api/v1/sessions/{sessionId}/retry`，额外：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 缺身份头。 |

示例：

```bash
curl -X POST "$BASE_URL/api/v1/ir/sessions/sess_123/retry" \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: T1" \
  -H "x-subject-id: U1" \
  -d '{"expectedLatestRequestId":"req_1","idempotencyKey":"key-1"}'
```

### POST /api/v1/ir/sessions/{sessionId}/pending-inputs/{pendingInputId}/answer

描述：回答 pending input（追加 input）。协议与 `POST /api/v1/sessions/{sessionId}/pending-inputs/{pendingInputId}/answer` 完全一致。

Headers：同 IR 通用约定。

Body / Multipart：同 `POST /api/v1/sessions/{sessionId}/pending-inputs/{pendingInputId}/answer`。

Success response：同 `POST /api/v1/sessions/{sessionId}/pending-inputs/{pendingInputId}/answer`。

Error responses：同 `POST /api/v1/sessions/{sessionId}/pending-inputs/{pendingInputId}/answer`，额外：

| HTTP | code | message | 触发条件 |
| --- | --- | --- | --- |
| 401 | `LOCAL_AUTH_REQUIRED` | safe auth-required message | 缺身份头。 |

示例：

```bash
curl -X POST "$BASE_URL/api/v1/ir/sessions/sess_123/pending-inputs/pi_1/answer" \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: T1" \
  -H "x-subject-id: U1" \
  -d '{"answers":[["yes"]]}'
```
