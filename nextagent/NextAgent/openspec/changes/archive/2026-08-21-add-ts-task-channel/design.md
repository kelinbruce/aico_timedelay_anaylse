## 背景和现状（Context）现有 `agent-channel-task`、`agent-channel-common`、Fastify registration、SSE/WS projection 和 runtime command 接线均已存在。当前实现将 `taskId` 解释为 `sessionId`，create 使用 `inputText`，async callback 通过内存订阅逐事件调用 CLIP target，并明确让 GET `/api/v1/task/stream` 返回 404。runtime 已持久化 `RequestRun`、canonical timeline 和 `PendingInput`，`RuntimeSessionPort.streamEvents` 支持按 sequence replay；`getRequestSummary` 已实现但返回类型缺少终态结果数据。callback subscription 也不是 durable fact，进程重启后不会自动恢复。

## 目标和非目标（Goals / Non-Goals）目标：- 将 Task Channel 收敛为外部消费者稳定使用的 HTTP/JSON 机机 contract。- 以 runtime `requestId` 作为外部 `taskId`，`sessionId` 作为 task scope 容器，create 时由 channel 自动创建新 session，task 与 session 1:1。- 增加任务批量对账，使回调丢失和双方重启后能够从持久化事实恢复。- 用 `TASK_PENDING` 明确表达等待用户输入的阻塞状态。- 保持 channel 只负责 transport/projection，runtime 继续拥有 lifecycle 和 canonical truth。

- 统一事件结构，SSE 和 callback 共用同一 `TaskEvent` 格式。- 用 `taskMessages` 表达 create/edit 任务输入数据；answer 使用顶层 `answers` 对齐 web channel；query 使用扁平 `data` 字段。- 按交付模式拆分路由树：流式端点 POST 直接返回 SSE 事件流；异步端点返回 JSON + callback。GET stream 路由不注册返回 404。

- `reportEvents` 参数控制 SSE 和 callback 事件范围（预留，过滤引擎暂不实现）。非目标：- 不新增 Task Channel persistence owner 或 task 表。- 不在本 change 实现通用 HTTP/IR gateway 或 APIToolProvider。- 不承诺 callback exactly-once；消费者必须按 `eventId` 幂等。- 不实现多条输入消息的执行语义、task detail、conversation、delete、pause/resume。- 不让 external metadata、URL 或 task identifier 成为可信 identity/agent scope 来源。- 不提供 create idempotency 保护；`idempotencyKey` 为可选参数，重复 POST 创建新 task。- 不在本 change 实现事件批量上报汇聚策略，该需求单独分析处理。- 不暴露 `runId`、`contextId` 等内部诊断字段；`attempt` 仅在 retry 响应中暴露。

## 唯一实施路径

```text
  -> HTTP Task DTO
  -> agent-channel-task schema/projection
  -> RuntimeCommandPort / RuntimeSessionPort
  -> agent-runtime lifecycle + request summary application query (with terminalResult)
  -> existing gateway request-run/pending-input/timeline storesStream-task (SSE direct return)
  -> POST /api/v1/stream-task single-task body
  -> submit runtime request (create/edit/retry)
  -> deliverWebStream
  -> TaskEvent projection (filtered)
  -> SSE response body (text/event-stream, closes on terminal)Async-tasks (JSON + callback)
  -> POST /api/v1/async-tasks batch body
  -> submit runtime request, register callback subscription
  -> JSON control response { results: TaskControlResponse[] }
  -> TaskCallbackDeliveryPort
  -> narrowed HTTP callback transport
  -> TaskEvent[] (filtered by reportEvents + 4 always-filtered types)
```

Task Channel 不直接查询 gateway record，不把 `*Record` 投影到 Web response，也不通过 APIToolProvider 发起系统 callback。runtime application query 负责组装内部 read model；gateway-local 只读取已有持久化事实。专用 HTTP callback transport 只允许固定 POST JSON callback schema，不提供任意 HTTP 调用能力。

## 设计决策（Decisions）

### D1. Task 和 session 坐标- 外部 `taskId` = runtime `requestId`。- 外部 `sessionId` = runtime `sessionId`。- 不对外暴露 `runId`、`contextId` 等内部诊断字段；`attempt` 仅在 retry 响应中暴露。create 不接受外部传入的 `sessionId`；channel 总是自动创建新 session，task 与 session 1:1。edit、retry、cancel 和 pending answer body 必须携带 `sessionId`，用于定位已有 task 所属 session。edit、retry、cancel 和 pending answer body 必须携带 `sessionId`；channel 将 body `taskId` 作为 `expectedLatestRequestId` 交给现有 runtime command 校验。禁止把 taskId 直接当 sessionId，也不为控制接口增加 request lookup contract。

### D2. API surface：stream-task 和 async-tasks 两套路由树按交付模式拆分为两套独立路由树。流式端点 POST 直接以 SSE 事件流作为 response body 返回；异步端点返回 JSON 控制响应并触发回调推送。Cancel、Query、Answer 保持原路径不变。

| # | 方法 | 路径 | 响应模式 | 功能 |

|---

|---

|---

|---

|---|

| 1 | POST | `/api/v1/stream-task`

| SSE | 流式创建 task（单任务），直接返回 SSE 流 |

| 2 | POST | `/api/v1/stream-task/:taskId/edit`

| SSE | 流式编辑任务输入，直接返回 SSE 流 |

| 3 | POST | `/api/v1/stream-task/:taskId/retry`

| SSE | 流式重试任务，直接返回 SSE 流 |

| 4 | POST | `/api/v1/async-tasks` | JSON+callback | 异步批量创建 task，必带 callbackTarget |

| 5 | POST | `/api/v1/async-tasks/edit` | JSON | 异步批量编辑任务输入 |

| 6 | POST | `/api/v1/async-tasks/retry` | JSON | 异步批量重试任务 |

| 7 | POST | `/api/v1/tasks/cancel` | JSON | 批量取消任务（路径不变） |

| 8 | POST | `/api/v1/tasks/query` | JSON | 批量查询任务状态和终态结果（路径不变，格式简化） |

| 9 | POST | `/api/v1/tasks/pending-inputs/answer` | JSON | 批量回答 pending input（路径不变，格式对齐 web channel） |删除的端点：

- `GET /api/v1/task/:taskId/stream` — 路由不注册，返回 404；保留 `lastSeenSequence` 断点续传设计供后续启用

- `WS /api/v1/task/:taskId/ws` — 删除，不再提供 WebSocket stream

- `POST /api/v1/task` — 替换为 `POST /api/v1/stream-task`（SSE 响应）

- `POST /api/v1/tasks/async` — 替换为 `POST /api/v1/async-tasks`

- `POST /api/v1/tasks/edit` — 拆分为 stream-task 和 async-tasks 两个端点

- `POST /api/v1/tasks/retry` — 拆分为 stream-task 和 async-tasks 两个端点流式端点（stream-task）的 POST 直接以 SSE 事件流作为 HTTP response body 返回，无需二次订阅。首个事件为 `TASK_ACCEPTED`，终态事件后关闭流。异步端点（async-tasks）返回 JSON 控制响应，通过 callback delivery 推送事件。未列出的 task detail、conversation、delete、stop、resume 和 GET stream 路径继续返回 404。

## D3. TaskMessage contract

```typescriptinterface TaskMessage {  readonly text?: string;  readonly data?: JsonValue;  readonly fileContent?: {    readonly raw?: string;    readonly url?: string;    readonly filename: string;    readonly mediaType: string;  };  readonly metadata?: JsonObject;}

`

```text`、`data`、`fileContent` 必须且只能出现一个。`fileContent.raw` 与 `fileContent.url` 必须且只能出现一个。`raw` 使用 base64；`url` 必须经 attachment intake 的 remote locator、安全策略、大小和 media type 校验，channel 不自行下载。所有 public 任务输入数据字段使用 `taskMessages`（create/edit）。Answer 使用顶层 `answers`，不使用 `taskMessages`。当前执行版本对 create/edit 的输入 `taskMessages` 设置 `minItems=1,maxItems=1`，多条输入返回 400；数组形态不变。映射规则唯一确定为：

- `text`：原值作为 runtime input text。

- `data`：使用稳定 JSON serialization 作为 runtime input text，并通过现有 `SubmitRequestCommand.inputVariables` 保存到 accepted request facts；原始结构可在恢复投影中重建。

- `fileContent`：先转换为 attachment intake draft；runtime input text 使用固定的安全附件指令，不拼接未可信 filename，文件名和内容只经 attachment runtime 进入模型上下文。

### 附件 metadata 到 workflow 变量注入

- `agent-core`：`DefaultAgent` 构造 `WorkflowExecutionRequest` 时，将 `resolveAttachmentRefs` 已解析的第一个 `AttachmentRef` 注入到 `inputVariables.fileContent` 保留键（caller precedence，不覆盖调用方已有 `fileContent` 键）。

`fileContent` 是系统注入的保留变量键，与 `input_question` 同类。调用方 `inputVariables` 已包含 `fileContent` 键时，系统不覆盖（caller precedence）。附件内容不随变量注入；内容访问仍由 context engine 的 attachment disclosure + Read tool 路径处理，或由 workflow tool node 通过 `storageRef` 主动读取。当前 task-message schema 限制 `maxItems=1`，因此注入为单个对象而非数组。

- `metadata`：仅作为不可信 public message metadata 投影；不得覆盖 identity、agent、routing、credential 或 persistence scope。所有 public 任务输入数据字段使用 `taskMessages`（create/edit）。Answer 使用顶层 `answers`，不使用 `taskMessages`。当前执行版本对 create/edit 的输入 `taskMessages` 设置 `minItems=1,maxItems=1`，多条输入返回 400；数组形态不变。映射规则唯一确定为：

## D4. Create 语义与流式 SSE流式创建（`POST /api/v1/stream-task`）请求体（单任务，无 `tasks[]` 包装）：

```json{  "taskMessages": [{ "text": "分析此告警的根因" }],  "sessionId": "optional-session-id",  "locale": "zh-CN",  "idempotencyKey": "optional-client-key",  "reportEvents": "ALL"}

```- 可选 `idempotencyKey`：调用方可传入实现亚等提交；缺失时 channel 内部生成 UUID。不含 `mode`、`callbackTarget`、`runId`、`contextId`。- 可选 `reportEvents`：接受事件类型列表或 `"ALL"`/`"TERMINAL"`；参数为预留，事件过滤引擎暂不实现，当前行为等同 `ALL`。- 响应直接以 SSE 事件流作为 HTTP response body 返回（`text/event-stream`），无需二次订阅。首个事件为 `TASK_ACCEPTED`，终态事件后关闭流。- 重复 POST 创建新 task，无幂等保护。- Multipart form-data 支持：与 JSON 路径相同的 SSE 响应。异步创建（`POST /api/v1/async-tasks`）请求体（批量）：

```json{  "tasks": [{    "taskMessages": [{ "text": "分析此告警的根因" }],    "callbackTarget": { "url": "https://ir.example/api/task-events" },    "sessionId": "optional-session-id",    "locale": "zh-CN",    "reportEvents": "TERMINAL"  }]}

```

- `reportEvents` 默认 `"TERMINAL"`：callback 仅推送 `TASK_COMPLETED`、`TASK_FAILED`、`TASK_CANCELED`、`USER_INPUT_REQUIRED`。

- `reportEvents` 为 `"ALL"` 或事件类型列表：callback 额外推送过程事件。事件过滤引擎暂不实现，当前 `"ALL"` 等同推送全部事件。- 响应为 JSON `{ results: TaskControlResponse[] }`。public schema 不接受 `routingConstraints`。Task Channel 不构造客户端指定的 targetSkill/targetRecipe；`text` 或序列化后的输入进入现有 Agent/core routing，skill/recipe 只由该路径的模式匹配和可信配置选择。

## D5. 统一任务控制响应与 Edit/Retry 行为异步 create、edit、retry、cancel、pending answer 均返回同一 envelope：

```json{  "sessionId": "session-1",  "taskId": "request-1",  "taskStatus": "TASK_EXECUTING"}

```控制接口不得额外返回外部 `requestId`、`targetRequestId`、`runId`、`contextId`。cancel 成功返回该 envelope 且 `taskStatus=TASK_CANCELED`；重复 cancel 返回当前 task 状态，不报错。Retry 响应额外返回 `attempt` 字段（从 runtime `RequestAccepted.attempt` 暴露递增尝试序号）：

```json{  "sessionId": "session-1",  "taskId": "request-1",  "taskStatus": "TASK_ACCEPTED",  "attempt": 2}

```Edit 和 Retry 的 taskId 行为：

- **Edit**：runtime `editLatest` 创建新 requestId，旧 request 被 supersede。channel 返回的 `taskId` 是新 requestId（新 taskId）。`attempt` 重置为 1。

- **Retry**：runtime `retryLatest` 保持同一 requestId，新建 runId。channel 返回的 `taskId` 不变。`attempt` 递增。Edit 和 Retry 的 idempotencyKey 差异化：- Create：可选，缺失时 channel 内部生成 UUID。- Edit：必填，runtime 已强制要求非空 idempotencyKey。- Answer：可选，缺失时 channel 内部生成 UUID。

- Query：不需要（只读接口）。Pending-input answer body 使用顶层 `answers: string[][]`（对齐 web channel），不含 `taskMessages` 包裹、不含 `idempotencyKey`。channel 校验问题数量、每项非空约束以及 body sessionId、taskId 所属 request、pendingInput 所属 session/request 三者一致后，才投影为 runtime answers；不一致返回 safe 404 或 409，不泄漏跨 owner 信息。流式 edit（`POST /api/v1/stream-task/:taskId/edit`）和流式 retry（`POST /api/v1/stream-task/:taskId/retry`）支持 multipart form-data，与 create 的 multipart 解析逻辑复用。

## D6. TaskStatus 投影外部枚举为：`TASK_ACCEPTED | TASK_QUEUED | TASK_PLANNING | TASK_EXECUTING | TASK_PENDING | TASK_COMPLETED | TASK_FAILED | TASK_CANCELED | TASK_SUPERSEDED`

## Scenario: Active PendingInput projects pending

1. 若 request 的当前 run 存在 active `PendingInput(status=PENDING)`，返回 `TASK_PENDING`。

2. 否则按 `RunStatus` 增加 `TASK_` 前缀。`TASK_PENDING` 是 channel read projection，不新增或改变 runtime `RunStatus`。所有任务控制响应和 query entry 均必须包含 `taskStatus`。

## D7. Runtime request summary query在 `RuntimeSessionPort` 的 `getRequestSummary(query)` 只读查询方法（已实现）基础上，扩展返回类型 `RuntimeRequestSummary` 增加 `terminalResult` 字段。不新增平行 port，不让 channel 直接使用 gateway `*Record`。Query 包含可信 `identityContext`、`sessionId`、`requestId`。runtime 内部组合 `loadSessionLaneSnapshot`（找到 requestId 对应的 run 记录）和 `loadActivePendingInput`（仅非终态时查活跃 pending input），返回 runtime 域 `RuntimeRequestSummary`：- canonical `sessionId`、`requestId`

- `RunStatus`（原始状态，不投影）

- `updatedAt`- 可选 `activePendingInput`（`PendingInputRequest` 域类型）- 可选 `terminalResult`：当 request 为终态时，从 timeline 最后一个终态事件提取。包含 `content`（结果文本）、`contentType`，以及可选 safe error 字段（`code`、`category`、`retryable`）用于失败请求。无终态事件时省略。返回类型包含 `runId` 作为内部 read model 字段，但 channel 不得将其投影到 public response 或事件；`requestContextId`、`lastEventSequence`、`attempt` 不暴露。结果按 owner scope 与 persisted agentId 过滤。状态和 active pending 来自同一逻辑快照。channel 层负责投影 RunStatus -> TaskStatus。

## D8. POST `/api/v1/tasks/query` 对账语义请求体为 `{ tasks: [{ sessionId, taskId }] }`，每项携带自己的 sessionId 和 taskId，支持跨 session 批量查询，最大 20 项。Query 为只读接口，不需要 idempotencyKey。响应为 `{ results: [...] }`。每项包含 `sessionId`、`taskId`、`taskStatus`。使用扁平 `data: JsonObject` 字段按 `taskStatus` 区分内容，不再使用 `taskMessages` 数组包裹和 `pendingInput` 嵌套对象。当状态为 `TASK_PENDING` 时，`data` 内联 pending 快照：

```json{  "sessionId": "session-1",  "taskId": "request-1",  "taskStatus": "TASK_PENDING",  "data": {    "pendingInputId": "pending-1",    "kind": "QUESTION",    "questions": [{ "prompt": "选择诊断策略", "options": [{ "label": "选项A", "value": "a" }], "multiple": false, "custom": true }],    "overtime": 1784772300000  }}

```当状态为终态且 `terminalResult` 存在时，`data` 内联终态结果：

```json// TASK_COMPLETED{  "sessionId": "session-1",  "taskId": "request-1",  "taskStatus": "TASK_COMPLETED",  "data": { "content": "根因分析完成：...", "contentType": "PLAIN_TEXT" }}// TASK_FAILED{  "sessionId": "session-1",  "taskId": "request-1",  "taskStatus": "TASK_FAILED",  "data": { "content": "失败原因...", "contentType": "PLAIN_TEXT", "code": "INTERNAL_ERROR", "retryable": false }}

```对于 `TASK_COMPLETED`，terminal content 投影为 `data.content`；对于 `TASK_FAILED`，terminal content 和可选 safe error 字段投影为 `data` 的附加字段。`terminalResult` 不存在时省略 `data`。非终态非 pending 状态（如 `TASK_EXECUTING`）只返回 `sessionId`、`taskId`、`taskStatus`，不包含 `data`。`overtime` 是 absolute epoch milliseconds，对应 runtime `timeoutAt`；无超时则省略。找不到的 task 返回 per-item error（NOT_FOUND），不阻塞其他项。

## D9. 统一 TaskEvent 结构与事件过滤SSE 和 callback 共用同一 `TaskEvent` 结构，与 channel-web `StreamEnvelope` 字段命名对齐：

```typescriptinterface TaskEvent {  readonly eventId: string;  readonly eventType: TaskEventType;  readonly sessionId: string;  readonly taskId: string;  readonly sequence: number;  readonly createdAt: number;  readonly payload: JsonObject;}

```移除 `runId`、`requestContextId`、`transportHints`、`timelineEventRef` 等内部字段。`payload` 携带事件特定字段，与 channel-web payload 投影一致。SSE event = TaskEvent。Callback event = TaskEvent。Callback body = `{ events: TaskEvent[] }`。不再有独立的 `TaskCallbackEvent` 类型。

**事件过滤**：channel 层在 SSE 和 callback 投影时过滤以下 4 个事件类型，不推送给消费方：

- `BACKGROUND_TASK_STARTED`

- `BACKGROUND_TASK_COMPLETED`

- `BACKGROUND_TASK_FAILED`

- `OUTPUT_GUARD_BLOCKED`TaskEventType 枚举保留 23 个穷尽映射不变（确保新增 StreamEventType 时编译失败），但在投影到 SSE/callback 时跳过这 4 个类型。`reportEvents` 参数为预留，事件过滤引擎暂不实现，当前行为等同 `ALL`（除上述 4 个始终过滤的类型外，推送全部事件）。

## D10. TaskEventType 穷尽性与过滤映射规则保持 `REQUEST_* -> TASK_*`、移除 `LLM_` 前缀，其余同名。TaskEventType 枚举覆盖当前 23 个 StreamEventType，包括 `BACKGROUND_TASK_STARTED`、`BACKGROUND_TASK_COMPLETED`、`BACKGROUND_TASK_FAILED` 和 `OUTPUT_GUARD_BLOCKED`。projection 必须使用穷尽映射，新增 StreamEventType 后未同步 TaskEventType 时 TypeScript/contract test 必须失败，禁止运行时强制断言掩盖缺失枚举。在 SSE 和 callback 投影时，channel 层过滤上述 4 个事件类型不推送给消费方。枚举保留穷尽映射是为了编译期安全，过滤是运行时行为。

## D1

1. 流式端点 SSE 直接返回流式创建（`POST /api/v1/stream-task`）、流式编辑（`POST /api/v1/stream-task/:taskId/edit`）和流式重试（`POST /api/v1/stream-task/:taskId/retry`）的 POST 直接以 SSE 事件流作为 HTTP response body 返回，无需二次订阅。实现路径：

1. channel 解析请求体（JSON 或 multipart），创建新 session，提交 runtime request（create/edit/retry）。

2. POST 直接以 SSE 流作为 response body 返回（`text/event-stream`）。3. runtime timeline 事件经 `projectTimelineEventsToStreamEnvelopes` 投影为 `StreamEnvelope`，再由 Task Channel projection 转为 `TaskEvent`（移除内部字段，`requestId` -> `taskId`，`eventType` 映射为 `TaskEventType`，过滤 4 个事件类型）。4. 全部 `TaskEvent` 推送到 SSE（`reportEvents` 参数为预留，当前等同 `ALL`）。5. 首个事件为 `TASK_ACCEPTED`（由 runtime `REQUEST_ACCEPTED` 投影），携带 `sessionId` 和 `taskId`。6. 终态事件推送后关闭 SSE 流。7. Edit 的 SSE 流携带新 taskId（runtime 创建新 requestId）；Retry 的 SSE 流携带同一 taskId。`GET /api/v1/task/:taskId/stream` 路由不注册，返回 404。保留 `lastSeenSequence` 断点续传设计供后续启用。SSE 格式与 channel-web 一致：`event: {eventType}\ndata: {JSON}\n\n`。

## D1

2. HTTP/IR async callback 与 reportEvents异步创建（`POST /api/v1/async-tasks`）要求 `callbackTarget.url`。Task Channel 通过 `TaskCallbackDeliveryPort` 发送 HTTP request；该 port 及其 HTTP 实现归 `agent-channel-task`，因为 callback 是该 channel 的专用出站 transport。实现只允许 POST 固定 JSON schema，不接受任意 method、headers、credentials 或 body，不调用 CLIP，也不将 callback 建模为 CapabilityInvocation。`reportEvents` 参数（替代 `isStreamRecord`）控制 callback 事件范围：

- `"TERMINAL"`（默认）：callback 只推送 `TASK_COMPLETED`、`TASK_FAILED`、`TASK_CANCELED`、`USER_INPUT_REQUIRED`。

- `"ALL"`：callback 额外推送过程事件。- 事件类型列表（如 `["TASK_COMPLETED", "CONTENT_DELTA"]`）：预留，事件过滤引擎暂不实现，当前行为等同 `"ALL"`。一次 callback body 可批量携带一个或多个事件：

```json{  "events": [    {      "eventId": "event-1",      "eventType": "USER_INPUT_REQUIRED",      "sessionId": "session-1",      "taskId": "request-1",      "sequence": 18,      "createdAt": 1784772000000,      "payload": {        "kind": "QUESTION",        "questions": [],        "overtime": 1784772300000      }    }  ]}

```事件使用统一 `TaskEvent` 结构。实现可以在同一次发送中聚合连续产生的多条事件，但必须保持 sequence 顺序。消费者按 `eventId` 幂等；重试不得生成新的 eventId。callback 事件投影同样过滤 4 个事件类型（`BACKGROUND_TASK_*`、`OUTPUT_GUARD_BLOCKED`）。callback timeout、重试和失败不改变 runtime 状态或 timeline。callback 最终失败时记录脱敏诊断；调用方通过 POST query 对账恢复。durable callback outbox deferred。事件批量上报汇聚策略（按时间窗/数量）也 deferred。`callbackTarget`

保留现有 `{ url }` 结构。`parameters[]` 结构增强 deferred，待其他能力实现后再讨论。
### UDS 回调 socket path 回退

REMOTE 模式下，当 `taskCallback.socketPath` 未配置时，app composition 自动回退到 `channel.udsPath` 作为有效 UDS socket path。这使得 `allowedOrigins` 自动填充固定本地 origin（`http://localhost`），`callbackDeliveryPort` 自动创建，async-tasks 接口在未显式配置 `taskCallback` 节点时也可用。回退仅发生在 REMOTE 模式；LOCAL 模式不回退，保持空 `allowedOrigins` 语义。这符合 spec 中 `remote UDS callback path MAY use the app composition-owned fixed local origin` 的描述。`taskCallback.socketPath` 显式配置时优先于 `channel.udsPath`。


## D13. Identity、安全和容量- identity 仍由 channel/auth boundary 的 `IdentityResolver` 提供；请求 body/query/metadata 不得提供 agentId、tenantId 或 subjectId。- list、lookup、control、stream 和 pending answer 均执行 Owner Scope + Agent Scope 校验，跨 scope 统一 safe not-found。

- `taskId` batch 最大 20，`limit` 有固定上限；禁止无界全量扫描。- inline raw、remote URL、callback URL、media type、文件名和响应体均在不可信边界 runtime schema validation。- callback URL 的 protocol、credential、fragment 校验由 Task Channel 专用 callback transport 始终执行；allowlist 为可选 origin 加固，未配置时放行合法 http/https URL；redirect、DNS/IP、timeout 和 response-size policy 由 callback transport 执行；`tlsInsecure` 为 true 时仅对 callback HTTPS 跳过证书校验，不影响进程其他 HTTPS 连接；remote file URL policy 仍由 attachment owner 执行。- safe error、日志、metric、trace 和 audit 不包含 file raw、callback body、模型输出或 credential。

- `WS /api/v1/task/:taskId/ws` 和 `GET /api/v1/task/:taskId/stream` 路由不注册，返回 404；流式端点 POST 直接返回 SSE。

- 所有 public schema 为 closed schema；create 接受可选 `idempotencyKey`，edit 必填 `idempotencyKey`，query 不接受 `idempotencyKey`（只读接口），answer 不接受 `idempotencyKey`、`runId`、`contextId`、`mode`、`callbackClipTarget` 等旧字段。

## 故障与恢复

| 故障 | canonical fact | 恢复路径 |

|---

|---

|---|

| 调用方重启并错过 callback | runtime timeline/request run/pending input | POST query 对账 |

| NextAgent 重启导致内存 callback subscription 丢失 | 同上

| 调用方 POST query 对账；durable outbox deferred |

| SSE 流中断 | runtime timeline 保持 | POST query 查询已有 task 状态（GET stream 已移除，`lastSeenSequence` 设计保留供后续启用） |

| USER_INPUT_REQUIRED 丢失 | active PendingInput | POST query 返回 TASK_PENDING + pendingInput payload |

| callback 已处理但响应丢失

| callback eventId | 重试允许重复，消费者 eventId 幂等 |

| query 后 pending 恰好超时/被回答 | pending CAS/versioned state | answer 返回冲突，调用方重新 query |

## 当前代码增量

保留现有 package、registration、attachment intake 和 runtime command 主路径。修改点：

- `agent-channel-task`：

- 删除 `websocket.ts`，移除 WS upgrade handler。

- 路由拆分为三套路由树：`stream-task`（POST 直接返回 SSE）、`async-tasks`（JSON + callback）、`tasks`（cancel/query/answer，JSON）。

- 流式创建 `POST /api/v1/stream-task` 直接返回 SSE 流；流式 edit/retry 同样直接返回 SSE。

- `GET /api/v1/task/:taskId/stream` 路由不注册，返回 404。

- create schema 接受可选 `idempotencyKey`；edit schema 必填 `idempotencyKey`；query 不接受 `idempotencyKey`；answer 不接受 `idempotencyKey`。

- answer 请求格式改为顶层 `answers: string[][]`（对齐 web channel）。

- query 响应格式简化为扁平 `data: JsonObject`（移除 taskMessages 数组和 pendingInput 嵌套）。

- retry 响应增加 `attempt` 字段（从 runtime `RequestAccepted.attempt` 透传）。

- `reportEvents` 参数替代 `isStreamRecord`（预留，过滤引擎暂不实现）。

- channel 层过滤 4 个事件类型（`BACKGROUND_TASK_*`、`OUTPUT_GUARD_BLOCKED`）不推送给 SSE/callback 消费方。

- edit 流式和异步端点支持 multipart form-data。

- 从 `TaskControlResponse` 移除 `runId`、`contextId`。

- 统一事件结构为 `TaskEvent`，SSE 和 callback 共用。

- callback 使用 `TaskEvent` 结构，`reportEvents` 参数控制事件范围。

- `agent-contracts/runtime`：`RuntimeRequestSummary` 增加 `terminalResult` 字段。

- `agent-runtime`：`getRequestSummary` 实现增加 terminalResult 提取逻辑。

- `gateway-local`：仅补足实现 summary query terminalResult 所需的专用读取，不新增 generic records 或 Task Channel table。
- `agent-core`：`DefaultAgent` 构造 `WorkflowExecutionRequest` 时，将 `resolveAttachmentRefs` 已解析的 `AttachmentRef[]` 注入到 `inputVariables.attachments` 保留键（caller precedence，不覆盖调用方已有 `attachments` 键）。

- `agent-app`：组合 Task Channel 专用 callback delivery，并从可信配置注入 callback URL policy。
- `agent-app`：REMOTE 模式下 `taskCallback.socketPath` 未配置时，app composition 自动回退到 `channel.udsPath` 作为有效 UDS socket path（见上 UDS 回调 socket path 回退）。

## 验证策略

- Contract tests：所有 DTO、字段命名、TaskMessage one-of、状态/event 枚举、9 个 endpoint、旧字段拒绝（`idempotencyKey` 在非 create/edit/query 端点返回 400、`runId`/`contextId`/`mode`）、删除端点返回 404。

- Characterization tests：POST stream-task 直接返回 SSE 首事件为 TASK_ACCEPTED；callback 事件结构统一；事件过滤 4 个类型不推送。

- Recovery tests：双方重启、lost pending callback、SSE 中断、terminal callback loss。

- Security tests：跨 owner/agent taskId、sessionId mismatch、pending mismatch、SSRF/非法 file URL、超大 batch。

- Architecture tests：channel 不 import gateway implementation、CLIP、agent-capability private path 或 Web channel。

- Gates：`openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。

## 需群内确认

729 接口重构（URL 拆分、SSE 直接返回、reportEvents、idempotencyKey 差异化、answer 顶层格式、query 扁平化、retry attempt、事件过滤、multipart edit、questions 结构、edit taskId 修正）全部在 `agent-channel-task` channel 层完成，对 `agent-contracts` 无新增变更。

第一迭代已完成并实现的 `agent-contracts/runtime` 变更（作为本 change 的前序事实，不需再次确认）：
- `RuntimeRequestSummary` 已增加 `terminalResult` 字段；runtime 从 timeline 最后一个终态事件提取 content 和 safe error 字段。
- `RequestAccepted.attempt` 已存在；retry 时递增，edit 时重置为 1。
- `PendingInputKind`（QUESTION/CONFIRMATION/AUTHORIZATION/HUMAN_HANDOFF）和 `PendingInputQuestion`（prompt/options/multiple/custom）已定义。
- `editLatest` 创建新 requestId、`retryLatest` 保持同一 requestId 的行为已在 runtime 实现中固化。

本 change 后续对 `agent-contracts` 无变更需求。

### D14. Channel 创建 Session 后 Submit 失败的泄漏修复

**问题**：channel 层（Task Channel stream-task create、async-tasks create、Web Channel convenience submit）先 `createSession` 再 `runtime.submit`。submit 同步失败（如 `CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY`、scheduler 容量、hook 拒绝）时，session 已持久化但不清理，形成孤儿 session。

**根因**：两层都不清理。channel 层 catch 只返回错误不删除 session；runtime 的 orphan session 机制只覆盖 `createdSessionInternally === true`（即 `command.sessionId === undefined`），而 channel 传入已有 `sessionId`，`createdSessionInternally` 为 `false`，orphan 机制不触发。

**策略**：channel 层在 submit 失败时 best-effort 调用 `RuntimeSessionPort.deleteSession`。理由：
- **符合 spec 架构**：不改变"channel 创建 session"的设计（spec line 33），只在失败路径补充清理。
- **同形同策**：三个 create+submit 路径用同一个 cleanup pattern。
- **安全**：submit 失败在 run acceptance 之前，无 `RequestRun`、user message、timeline event 或 active context item 被持久化。session row 是唯一持久化 artifact，`deleteSession` 级联删除是安全的本地操作。
- **best-effort 可接受**：deleteSession 失败概率极低（刚创建的 session，SQLite 本地操作），即使失败也只留空 session，不影响功能正确性，可通过日志发现。
- **不掩盖原始错误**：cleanup 异常被 catch 且不 re-throw，原始 submit 错误正常返回给调用方。

**为什么不选其他策略**：
- 让 submit 内部创建 session：违反 spec line 33（channel 负责创建 session），改动 channel-runtime contract 范围过大。
- runtime 层做 orphan 清理：runtime 的 orphan 机制只覆盖 `sessionId === undefined`；channel 传入 sessionId 时不触发，且当前只记日志不删除，改动 runtime 影响面大。
- 前置校验拦截纯魔法符号：只解决 `$workflow:` 这一种 case；submit 还可能因其他原因失败，这些 case 也会泄漏 session。
- 数据库事务包裹 createSession+submit：跨 runtime 和 session 两个 port，无法在一个 SQLite 事务中完成。

**实现路径**：提取公共 cleanup helper，接收 `sessions` port、`identityContext`、`sessionId`，内部 catch 且不 re-throw。三处 create+submit 路径复用同一 helper。