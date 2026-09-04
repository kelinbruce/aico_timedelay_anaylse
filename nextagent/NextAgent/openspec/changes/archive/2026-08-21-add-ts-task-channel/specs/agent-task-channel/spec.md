## ADDED Requirements

### Requirement: Task Channel 公开坐标

Task Channel SHALL 将 runtime request 身份暴露为 `taskId`，并将 `sessionId` 保留为独立的 session 坐标。Channel 响应和事件 MUST NOT 暴露 `requestId`、`targetRequestId`、`runId`、`contextId` 或任何其他内部 runtime 诊断字段。`attempt` SHALL 只在 retry 响应中暴露。公开响应 SHALL 包含 `sessionId`、`taskId` 和 `taskStatus`。

#### Scenario: Create 返回外部 task 坐标
- **WHEN** runtime 在一个 session 中接受一个 request
- **THEN** Task Channel MUST 返回与 runtime session id 相等的 `sessionId`
- **AND** `taskId` MUST 等于 runtime request id
- **AND** 响应 MUST NOT 包含 `runId` 或 `contextId`

#### Scenario: Create 不接受 sessionId
- **WHEN** create body 包含 `sessionId`
- **THEN** Task Channel MUST 返回 HTTP 400
- **AND** MUST NOT 创建 session 或提交 request

#### Scenario: 客户端不能提供受信 scope
- **WHEN** body、query、TaskMessage metadata 或 callback metadata 包含 owner 或 agent scope 字段
- **THEN** Task Channel MUST 依据其 closed schema 拒绝或忽略这些字段
- **AND** MUST 仅从受信边界派生 IdentityContext 和 Agent Scope

### Requirement: TaskMessage 契约

所有 Task Channel 公开 task 输入输出数据 SHALL 使用 `taskMessages: TaskMessage[]`。一个 TaskMessage SHALL 恰好包含 `text`、`data` 或 `fileContent` 之一；可选的 `metadata` SHALL 是不可信 JSON object。`fileContent` SHALL 恰好包含 base64 `raw` 或远程 `url` 之一，加上必需的 `filename` 和 `mediaType`。

当前执行版本 SHALL 要求 create 和 edit 恰好携带一个 TaskMessage。Answer 不使用 `taskMessages`；它使用与 web channel 对齐的顶层 `answers: string[][]`。create/edit 携带多于一条输入消息 MUST 返回 HTTP 400 且不调用 runtime。该数组契约为后续 multi-message execution change 保留。

#### Scenario: 文本输入被接受
- **WHEN** create 包含一条带非空 `text` 的 TaskMessage
- **THEN** channel MUST 将该文本作为 runtime 输入提交

#### Scenario: 结构化 data 输入被接受
- **WHEN** create 包含一条带 `data` 的 TaskMessage
- **THEN** channel MUST 使用稳定的 JSON 序列化作为 runtime 输入文本
- **AND** MUST 通过既有 accepted request facts 的 inputVariables 路径持久化该结构化值，使 recovery 能够重建它

#### Scenario: 内联 raw 文件通过附件接入被接受
- **WHEN** create 包含一条带 base64 `raw`、filename 和 mediaType 的 fileContent 消息
- **THEN** channel MUST 解码该文件并通过 attachment intake 校验提交
- **AND** MUST NOT 记录或暴露原始内容

#### Scenario: 远程文件通过附件接入被接受
- **WHEN** create 包含一条带 `url`、filename 和 mediaType 的 fileContent 消息
- **THEN** attachment runtime MUST 执行其远程 locator、协议、大小、media type 和安全策略校验
- **AND** channel MUST NOT 直接下载该 URL

#### Scenario: 当前版本拒绝多条输入消息
- **WHEN** create 或 edit 包含两条或多条 TaskMessages
- **THEN** Task Channel MUST 返回 HTTP 400
- **AND** MUST NOT 产生 runtime 或附件副作用

### Requirement: 批量操作语义

Async create、async edit、async retry、cancel 和 pending-input answer SHALL 接受最多 20 个条目的 `tasks` 数组 body。Stream-task create、stream-task edit 和 stream-task retry 是不使用 `tasks` 数组包装的单任务端点；其响应是 SSE stream。

`tasks` 数组中的每个条目 SHALL 被独立处理。部分失败 SHALL NOT 回滚成功的条目。当至少一个条目成功时，响应 SHALL 是 HTTP 200 并带 `results` 数组；每个结果在成功时 SHALL 包含条目的 `taskId`、`sessionId`、`taskStatus`，失败时包含 `error` 对象。对请求级校验失败（如空数组、超过 20 个条目或 closed-schema 违规）以及批内全部条目失败的情况 SHALL 返回 HTTP 400。在全部条目失败的情况下，仍 MUST 返回带每条 `error` 对象的 `results` 数组。

请求级校验失败 MUST 在任何 runtime 调用之前拒绝整个批次。条目级失败 MUST 在 `results` 中按条目报告，不影响其他条目。

#### Scenario: 批量 async create 提交多个任务
- **WHEN** 调用方提交带 3 个 task 条目的 async create
- **THEN** Task Channel MUST 提交 3 个独立 request
- **AND** 以与输入相同的顺序返回 3 个结果

#### Scenario: 部分失败被隔离
- **WHEN** 批次中一个 task 校验失败或被 runtime 拒绝
- **THEN** 成功的 task MUST 仍被处理并返回其 `taskStatus`
- **AND** 失败 task 的结果 MUST 包含 `error` 对象
- **AND** HTTP 状态 MUST 是 200

#### Scenario: 全部条目失败返回 HTTP 400
- **WHEN** 批次中每个条目都校验失败或被 runtime 拒绝
- **THEN** Task Channel MUST 返回 HTTP 400
- **AND** 每个结果 MUST 包含 `error` 对象
- **AND** `results` 数组 MUST 在响应 body 中返回

#### Scenario: 批量上限被强制执行
- **WHEN** 调用方提交超过 20 个 task 条目
- **THEN** Task Channel MUST 返回 HTTP 400
- **AND** MUST NOT 对任何条目调用 runtime

#### Scenario: 空批次被拒绝
- **WHEN** 调用方提交空的 `tasks` 数组
- **THEN** Task Channel MUST 返回 HTTP 400

#### Scenario: Stream-task 是单任务
- **WHEN** 调用方 POST 到 `POST /api/v1/stream-task`
- **THEN** 请求 body MUST 是单个 task 对象，而不是 `tasks` 数组
- **AND** 响应 MUST 是 SSE stream，而不是 JSON 批量响应

### Requirement: Task Create 与 Stream SSE

`POST /api/v1/stream-task` SHALL 接受单个 task body，包含 `taskMessages`、可选 `sessionId`、可选 `locale`、可选 `idempotencyKey` 和可选 `reportEvents`。公开 create schema MUST NOT 接受 `mode`、`callbackTarget`、`inputText`、`routingConstraints`、`callbackClipTarget`、`runId`、`contextId`、owner scope 或 agent scope 字段。

响应 SHALL 是直接作为 HTTP 响应 body 返回的 SSE stream（`text/event-stream`）。第一个事件 MUST 是携带 `sessionId` 和 `taskId` 的 `TASK_ACCEPTED`。该 stream SHALL 推送所有过程事件（被过滤类型除外）、terminal 事件和 `USER_INPUT_REQUIRED`。该 stream SHALL 保持打开直到发出 terminal 事件，之后关闭 stream。

`reportEvents` 参数接受事件类型列表或 `"ALL"`/`"TERMINAL"`；该参数为保留项，事件过滤引擎在本版本未实现。当前行为等价于 `ALL`（4 个始终被过滤的事件类型除外）。

Channel 层事件过滤：`BACKGROUND_TASK_STARTED`、`BACKGROUND_TASK_COMPLETED`、`BACKGROUND_TASK_FAILED` 和 `OUTPUT_GUARD_BLOCKED` SHALL NOT 被推送到 SSE 或 callback 消费方。

`GET /api/v1/task/:taskId/stream` SHALL NOT 被注册为路由；对其的请求返回 HTTP 404。`lastSeenSequence` 重放设计为未来启用而保留。


#### Scenario: Stream-task create 直接返回 SSE
- **WHEN** 调用方向 `POST /api/v1/stream-task` 提交合法的单任务 body
- **THEN** 响应 Content-Type MUST 是 `text/event-stream`
- **AND** SSE stream MUST 包含所有过程事件和 terminal 事件
- **AND** MUST 在 terminal 事件后关闭

#### Scenario: 第一个事件是 TASK_ACCEPTED
- **WHEN** 调用方提交合法的 create body
- **THEN** 第一个 SSE 事件 MUST 是携带 `sessionId` 和 `taskId` 的 `TASK_ACCEPTED`

#### Scenario: GET stream 返回 404
- **WHEN** 调用方请求 `GET /api/v1/task/:taskId/stream`
- **THEN** Task Channel MUST 返回 HTTP 404
- **AND** MUST NOT 建立任何 stream 连接

#### Scenario: Create 始终创建新 session
- **WHEN** 提交了合法的 create body
- **THEN** Task Channel MUST 创建一个新 session 并提交一个 request
- **AND** MUST 在第一个 SSE 事件中把 request id 作为 `taskId` 返回
- **AND** session 与 task 是 1:1 的

#### Scenario: Stream-task create 提交失败时清理 session
- **WHEN** channel 创建了一个新 session 且 `RuntimeCommandPort.submit` 在 run acceptance 之前抛出异常
- **THEN** Task Channel MUST 尽力通过 `RuntimeSessionPort.deleteSession` 删除新建的 session
- **AND** 原始错误 MUST 被返回给调用方
- **AND** 该 session MUST NOT 留在 session list 中

#### Scenario: 外部 routing constraints 被拒绝
- **WHEN** create 或 edit body 包含 `routingConstraints`
- **THEN** Task Channel MUST 返回 HTTP 400
- **AND** skill 或 recipe 路由 MUST 仍由既有受信 Agent/core 路由路径拥有

#### Scenario: 遗留字段被拒绝
- **WHEN** create body 包含 `mode` 或 `callbackTarget`
- **THEN** Task Channel MUST 返回 HTTP 400

#### Scenario: 被过滤的事件类型不被推送
#### Scenario: SSE stream 中断后通过 POST query 恢复
- **WHEN** 一个 stream-task SSE 连接在中途被中断
- **THEN** 调用方 MUST 通过 `POST /api/v1/tasks/query` 恢复，以获取当前 taskStatus 和数据
- **AND** Task Channel MUST NOT 提供 GET stream 重放端点（GET stream 返回 404）
- **AND** `lastSeenSequence` 重放设计为未来启用而保留，但本版本未实现

- **WHEN** 发生 `BACKGROUND_TASK_STARTED`、`BACKGROUND_TASK_COMPLETED`、`BACKGROUND_TASK_FAILED` 或 `OUTPUT_GUARD_BLOCKED` 事件
- **THEN** Task Channel MUST NOT 将其推送到 SSE 或 callback 消费方

### Requirement: 异步 Task Create

`POST /api/v1/async-tasks` SHALL 要求 body `tasks` 数组；每个条目 SHALL 包含 `taskMessages` 和带 `url` 的 `callbackTarget`，并 MAY 包含 `sessionId`、`locale` 和 `reportEvents`。该 body SHALL NOT 接受 `idempotencyKey` 或 `mode`。

每个 async task 条目 SHALL 通过 Task Channel 拥有的 `TaskCallbackDeliveryPort` 触发 callback 投递。Callback 目标 URL SHALL 在请求提交前对照受信 allowlist 校验。如果 callback 投递未配置，async create SHALL 以 HTTP 503 失败。

`reportEvents` 参数控制 callback 事件范围：
- `"TERMINAL"`（默认）：callback 只推送 `TASK_COMPLETED`、`TASK_FAILED`、`TASK_CANCELED` 和 `USER_INPUT_REQUIRED`。
- `"ALL"`：callback 额外推送过程事件。
- 事件类型列表：保留项，事件过滤引擎未实现；当前行为等价于 `"ALL"`。

响应 SHALL 是 `{ results: TaskControlResponse[] }`，其中每个 `TaskControlResponse` 包含 `sessionId`、`taskId` 和 `taskStatus`。

#### Scenario: Async create 触发 callback 投递
- **WHEN** 一个 async create 条目被接受
- **THEN** Task Channel MUST 为该 task 注册 callback 投递
- **AND** 在结果中返回 `taskStatus` TASK_ACCEPTED

#### Scenario: Async create 要求 callbackTarget
- **WHEN** 一个 async create 条目省略 `callbackTarget`
- **THEN** Task Channel MUST 返回 HTTP 400

#### Scenario: Async callback 不可用
- **WHEN** callback 投递 port 未配置
- **THEN** Task Channel MUST 返回 HTTP 503
- **AND** MUST NOT 提交任何 task

#### Scenario: reportEvents ALL 通过 callback 推送过程事件
- **WHEN** 一个 async create 请求带 `reportEvents="ALL"`
- **THEN** callback 投递 MUST 在 terminal 事件之外额外推送过程事件

#### Scenario: reportEvents TERMINAL 只推送 terminal 事件
- **WHEN** 一个 async create 请求带 `reportEvents="TERMINAL"`（或省略）
- **THEN** callback 投递 MUST 只推送 `TASK_COMPLETED`、`TASK_FAILED`、`TASK_CANCELED` 和 `USER_INPUT_REQUIRED`

#### Scenario: 失败的 async 条目不触发 callback 投递
- **WHEN** 一个 async create 条目校验失败或被 runtime 拒绝
- **THEN** Task Channel MUST NOT 为该条目触发 callback 投递
- **AND** 失败条目的结果 MUST 包含 `error` 对象
#### Scenario: Async create 提交失败时清理 session
- **WHEN** 一个 async create 条目的 `RuntimeCommandPort.submit` 在 run acceptance 之前抛出异常
- **THEN** Task Channel MUST 尽力通过 `RuntimeSessionPort.deleteSession` 删除该条目新建的 session
- **AND** 失败条目的结果 MUST 包含原始 `error` 对象
- **AND** 批次中的其他条目 MUST NOT 受影响

### Requirement: Stream-task Edit 与 Retry

`POST /api/v1/stream-task/:taskId/edit` SHALL 接受单个 task body，包含 `taskId`（路径参数）、`sessionId`、`taskMessages`、必需的 `idempotencyKey`、可选 `locale` 和可选 `reportEvents`。响应 SHALL 是直接作为 HTTP 响应 body 返回的 SSE stream（`text/event-stream`）。

`POST /api/v1/stream-task/:taskId/retry` SHALL 只接受包含 `taskId`（路径参数）和 `sessionId` 的 body。channel 内部生成 idempotencyKey。响应 SHALL 是 SSE stream。

Edit 创建新的 `requestId`（新 `taskId`）；SSE stream MUST 在第一个 `TASK_ACCEPTED` 事件中携带新 `taskId`。Retry 保持同一个 `requestId`（同一 `taskId`）；SSE stream MUST 在 `TASK_ACCEPTED` 事件 payload 中携带 `attempt`。

Stream-task edit SHALL 支持用于文件上传的 multipart form-data，复用 create 的 multipart 解析逻辑。Multipart 字段 MUST 限定为 `taskMessages`、`sessionId`、`locale`、`idempotencyKey` 和 `reportEvents`。

两个端点都 MUST NOT 接受 `mode`、`callbackTarget`、`routingConstraints`、`runId`、`contextId` 或 `callbackClipTarget`。

#### Scenario: Stream-task edit 返回带新 taskId 的 SSE
- **WHEN** 调用方向 `POST /api/v1/stream-task/:taskId/edit` 提交合法的 edit body
- **THEN** 响应 Content-Type MUST 是 `text/event-stream`
- **AND** 第一个 SSE 事件 MUST 是携带新 `taskId` 的 `TASK_ACCEPTED`

#### Scenario: Stream-task retry 返回带相同 taskId 和 attempt 的 SSE
- **WHEN** 调用方向 `POST /api/v1/stream-task/:taskId/retry` 提交合法的 retry body
- **THEN** 响应 Content-Type MUST 是 `text/event-stream`
- **AND** 第一个 SSE 事件 MUST 是携带相同 `taskId` 和 `attempt` 的 `TASK_ACCEPTED`

#### Scenario: Stream-task edit 要求 idempotencyKey
- **WHEN** 一个 stream-task edit 请求省略 `idempotencyKey`
- **THEN** Task Channel MUST 返回 HTTP 400

#### Scenario: Stream-task edit 支持 multipart
- **WHEN** 调用方向 `POST /api/v1/stream-task/:taskId/edit` 提交 multipart form-data
- **THEN** 响应 MUST 是 SSE stream
- **AND** multipart 字段 MUST 限定为 `taskMessages`、`sessionId`、`locale`、`idempotencyKey` 和 `reportEvents`

### Requirement: Async-tasks Edit 与 Retry

`POST /api/v1/async-tasks/edit` SHALL 接受 `tasks` 数组 body（maxItems=20）；每个条目 SHALL 包含 `taskId`、`sessionId`、`taskMessages`、必需的 `idempotencyKey` 和可选 `locale`。响应 SHALL 是 `{ results: TaskControlResponse[] }`。

`POST /api/v1/async-tasks/retry` SHALL 接受 `tasks` 数组 body（maxItems=20）；每个条目 SHALL 只包含 `taskId` 和 `sessionId`。channel 内部生成 idempotencyKey。响应 SHALL 是 `{ results: TaskControlResponse[] }`，其中每个 retry 结果额外包含 `attempt`。

Async edit 结果 `taskId` MUST 是新的 runtime request id。Async retry 结果 `taskId` MUST 保持同一 runtime request id，且 `attempt` 递增。

两个端点都 MUST NOT 接受 `reportEvents`、`mode`、`callbackTarget`、`routingConstraints`、`runId`、`contextId` 或 `callbackClipTarget`。

#### Scenario: Async edit 返回带新 taskId 的 JSON
- **WHEN** 调用方向 `POST /api/v1/async-tasks/edit` 提交合法的 edit 批次
- **THEN** 每个结果 MUST 包含 `sessionId`、`taskId`（新）和 `taskStatus`

#### Scenario: Async retry 返回带 attempt 的 JSON
- **WHEN** 调用方向 `POST /api/v1/async-tasks/retry` 提交合法的 retry 批次
- **THEN** 每个结果 MUST 包含 `sessionId`、`taskId`（相同）、`taskStatus` 和 `attempt`

#### Scenario: Async edit 要求每个条目携带 idempotencyKey
- **WHEN** 一个 async edit 条目省略 `idempotencyKey`
- **THEN** 该条目的结果 MUST 包含 `error` 对象


### Requirement: Pending-input Answer

`POST /api/v1/tasks/pending-inputs/answer` SHALL 接受 `tasks` 数组 body（maxItems=20）；每个条目 SHALL 包含 `taskId`、`pendingInputId`、`sessionId` 和顶层 `answers: string[][]`。该 body SHALL NOT 接受 `taskMessages`、`idempotencyKey`、`mode`、`runId`、`contextId` 或 `callbackClipTarget`。

Answer 使用与 web channel 对齐的顶层 `answers`，而不是 `taskMessages` 包装。Channel SHALL 在投影到 runtime `AnswerPendingInputCommand` 之前校验 answer 基数（非空有序字符串数组）、body `sessionId`/`taskId`/`pendingInputId` 三方一致性以及 owner/agent scope。Channel 在向 runtime 提交时生成内部 idempotency key。

PendingInput answer 按 kind 的差异化由 user-check 处理，而不是由 Task Channel 处理。Channel 不解释 `kind`，也不应用 kind 相关的 terminal 状态逻辑。

#### Scenario: 带顶层 answers 的 answer 被接受
- **WHEN** 调用方提交带顶层 `answers: string[][]` 的合法 answer
- **THEN** Task Channel MUST 投影到 runtime 并返回 `taskStatus`

#### Scenario: 带 taskMessages 包装的 answer 被拒绝
- **WHEN** 一个 answer 条目包含 `taskMessages` 而不是顶层 `answers`
- **THEN** Task Channel MUST 返回 HTTP 400

#### Scenario: Answer 三方一致性被强制执行
- **WHEN** body `taskId` 与 `sessionId` 的 active run 不匹配
- **OR** `pendingInputId` 不属于该 `taskId` request
- **THEN** Task Channel MUST 返回安全的 not-found 或 conflict 错误
- **AND** MUST NOT 泄露跨 owner 数据

#### Scenario: 跨 scope answer 被隐藏
- **WHEN** 调用方回答属于另一个 owner 或 agent scope 的 pending input
- **THEN** Task Channel MUST 返回安全的 not-found 错误

- **AND** 批次中其他成功条目 MUST 仍收到 callback 投递
### Requirement: 统一 Task 控制响应

Async create、async edit、async retry、cancel 和 pending-input answer SHALL 返回包含 `sessionId`、`taskId` 和 `taskStatus` 的公共响应。响应 MUST NOT 包含 `runId`、`contextId`、`requestId` 或 `targetRequestId`。每个成功的 task 控制响应 MUST 包含 `taskStatus`。批量响应 SHALL 把各条响应包装在 `results` 数组中。

Async retry 响应 SHALL 额外包含 `attempt`（来自 runtime `RequestAccepted.attempt` 的递增 retry 序号）。Stream-task retry 的 SSE 事件 SHALL 在 `TASK_ACCEPTED` 事件 payload 中携带相同的 `attempt`。

Edit 与 Retry 的 taskId 行为：
- **Edit**：runtime `editLatest` 创建新的 `requestId`；channel 将新 `requestId` 作为 `taskId` 返回。旧 request 被 supersede。`attempt` 重置为 1。
- **Retry**：runtime `retryLatest` 保持同一个 `requestId`；channel 返回相同 `taskId`。`attempt` 递增。

idempotencyKey 差异化：
- Create：可选；缺失时由 channel 生成 UUID。
- Edit：必需；runtime 强制非空 idempotencyKey。
- Retry：不接受；channel 内部生成 UUID，与 cancel 相同。
- Answer：可选；缺失时由 channel 生成 UUID。
- Query：不接受；query 是只读操作，不需要 idempotencyKey。
Edit、retry 和 cancel 的请求 body 条目 SHALL 要求 `sessionId` 和 `taskId`。Task Channel SHALL 把 body `sessionId` 传给既有 runtime command，并把 body `taskId` 作为 `expectedLatestRequestId` 传递；runtime SHALL 执行 latest-request 和 owner/agent scope 校验。这些控制 MUST NOT 要求新的 request lookup 契约。

Edit 请求 body 在 async 路径 SHALL NOT 接受 `reportEvents`。Async edit 返回 JSON 响应，不建立 SSE stream。Stream-task edit（`POST /api/v1/stream-task/:taskId/edit`）直接返回 SSE。

Stream-task edit 和 stream-task retry SHALL 支持用于文件上传的 multipart form-data，复用 create 的 multipart 解析逻辑。

Cancel 成功 MUST 返回带 `TASK_CANCELED` 的公共响应。重复 cancel 调用返回当前 task 状态且不出错。

#### Scenario: Cancel 返回统一响应
- **WHEN** cancel 将一个 task 迁移到 canceled
- **THEN** 结果 MUST 包含其 sessionId 和 taskId
- **AND** `taskStatus` MUST 是 `TASK_CANCELED`
- **AND** 响应 MUST NOT 包含 `runId` 或 `contextId`

#### Scenario: Edit 创建新 taskId
- **WHEN** edit 为该 request 创建新 attempt
- **THEN** 结果 taskId MUST 是新的 runtime request id
- **AND** 旧 request MUST 被 supersede
- **AND** `attempt` MUST 是 1

#### Scenario: Retry 保持 taskId 并递增 attempt
- **WHEN** retry 为该 request 创建新 attempt
- **THEN** 结果 taskId MUST 保持同一 runtime request id
- **AND** `attempt` MUST 递增

#### Scenario: 重复 cancel 是安全的
- **WHEN** 对已 canceled 的 task 调用 cancel
- **THEN** 结果 MUST 返回当前 `taskStatus` 且不出错

#### Scenario: Edit 要求 idempotencyKey
- **WHEN** 一个 edit 请求省略 `idempotencyKey`
- **THEN** Task Channel MUST 返回 HTTP 400

### Requirement: TaskStatus 投影

TaskStatus SHALL 包含 `TASK_ACCEPTED`、`TASK_QUEUED`、`TASK_PLANNING`、`TASK_EXECUTING`、`TASK_PENDING`、`TASK_COMPLETED`、`TASK_FAILED`、`TASK_CANCELED` 和 `TASK_SUPERSEDED`。

当该 request 当前 run 存在 active PendingInput 时，投影 MUST 返回 `TASK_PENDING`；否则投影 MUST 为当前 RunStatus 加上 `TASK_` 前缀。该投影 MUST NOT 向 runtime RunStatus 添加 `PENDING`。

#### Scenario: Active PendingInput 投影为 pending
- **WHEN** 一个 request 的 RunStatus 为 EXECUTING 且存在状态为 PENDING 的 active PendingInput
- **THEN** Task Channel MUST 返回 `TASK_PENDING`

#### Scenario: 非 pending run 正常映射
- **WHEN** 一个 request 没有 active PendingInput
- **THEN** Task Channel MUST 使用 TASK_ 前缀投影其 RunStatus

### Requirement: Task 批量对账查询

Task Channel SHALL 实现 `POST /api/v1/tasks/query`，作为基于已持久化 runtime request facts 的 owner-scoped 和 agent-scoped 对账端点。其主要场景是恢复丢失的 `USER_INPUT_REQUIRED` callback 通知或服务重启后的状态：调用方查询 `taskStatus` 并与自身状态对比以决定下一步动作。

请求 body SHALL 是 `{ tasks: [{ sessionId, taskId }] }`，最多 20 个条目。每个条目携带自己的 `sessionId` 和 `taskId`，支持跨 session 批量查询。Query 是只读操作，不需要 `idempotencyKey`。SHALL NOT 提供基于路径的单任务查询端点。

响应 SHALL 是 `{ results: [...] }`。每个结果条目 SHALL 包含 `sessionId`、`taskId` 和 `taskStatus`。结果 MUST NOT 包含受信 Owner Scope 和 Agent Scope 之外的 task。Task Channel MUST 将 `taskId` 解析为 `requestId` 并调用 `RuntimeSessionPort.getRequestSummary` 获取 request 摘要。如果摘要为 undefined，该条目结果 MUST 是安全的 not-found 错误。

当摘要包含 `activePendingInput` 时，投影状态 MUST 是 `TASK_PENDING`，且结果 MUST 内联一个包含 `pendingInputId`、`kind`、`questions` 和可选 `overtime` 的扁平 `data` 字段。

`kind` 字段 SHALL 是 `QUESTION`、`CONFIRMATION`、`AUTHORIZATION` 或 `HUMAN_HANDOFF` 之一。`questions` 字段 SHALL 是结构化问题对象数组。每个问题对象 SHALL 包含 `prompt`（非空字符串）和 `options`（选项对象数组）。每个选项对象 SHALL 包含 `label`（字符串）和 `value`（字符串），并 MAY 包含 `requiresTextInput`（布尔）和 `inputPlaceholder`（字符串）。每个问题对象 MAY 额外包含 `multiple`（布尔）和 `custom`（布尔）。channel MUST 从 runtime `PendingInputRequest` 逐字投影这些字段，不做解释或过滤。

当摘要状态是 terminal（COMPLETED、FAILED、CANCELED、SUPERSEDED）且存在 `terminalResult` 时，结果 MUST 将 terminal 结果内联为扁平 `data` 字段。对于 `TASK_COMPLETED`，`data` 包含 `content` 和 `contentType`。对于 `TASK_FAILED`，`data` 包含 `content`、`contentType` 和可选的安全错误字段（`code`、`retryable`）。当 `terminalResult` 缺失时，结果省略 `data`。

非 terminal、非 pending 状态（例如 `TASK_EXECUTING`）只返回 `sessionId`、`taskId` 和 `taskStatus`，不带 `data`。

`overtime` SHALL 等于 runtime `timeoutAt` 的绝对 epoch 毫秒值。当 `timeoutAt` 缺失时，`overtime` MUST 缺失。

#### Scenario: 已知 task 被查询
- **WHEN** 调用方提供可访问的 sessionId 和 taskId
- **THEN** Task Channel MUST 返回带投影 taskStatus 的匹配 task 摘要
- **AND** 摘要 MUST 通过 RuntimeSessionPort.getRequestSummary 从已持久化的 request facts 派生

#### Scenario: Terminal task 返回结果数据
- **WHEN** 被查询的 task 处于 terminal 状态且存在 `terminalResult`
- **THEN** 结果 MUST 内联包含 terminal 内容的 `data`
- **AND** 对于 TASK_COMPLETED，`data` MUST 包含 `content` 和 `contentType`

#### Scenario: 丢失的 pending 通知被恢复
- **WHEN** 被查询的 task 存在 active PendingInput
- **THEN** 其状态 MUST 是 `TASK_PENDING`
- **AND** `data` MUST 包含 `pendingInputId`、`kind`、`questions` 和可选 `overtime`
- **AND** 状态和 pendingInput MUST 描述同一逻辑快照

#### Scenario: Pending input questions 暴露结构化字段
- **WHEN** 被查询的 task 存在 kind 为 `QUESTION` 的 active PendingInput
- **AND** 该 pending input 包含带 `prompt`、`options`、`multiple` 和 `custom` 的问题
- **THEN** `data.questions` MUST 是一个数组，其中每项包含 `prompt`、`options`、`multiple` 和 `custom`
- **AND** 每个 `options` 条目 MUST 包含 `label` 和 `value`
- **AND** 当 runtime pending input 中存在时，每个 `options` 条目 MAY 包含 `requiresTextInput` 和 `inputPlaceholder`

#### Scenario: 跨 session 批量查询成功
- **WHEN** 调用方提供来自不同 session 的 tasks
- **THEN** Task Channel MUST 独立返回每个 task 结果
- **AND** 单条目失败 MUST NOT 阻塞其他条目

#### Scenario: Task 未找到是安全的单条目错误
- **WHEN** 被查询的 taskId 不匹配 session lane 快照中的任何 run
- **THEN** 该条目结果 MUST 是安全的 not-found 错误
- **AND** MUST NOT 泄露跨 owner 数据

#### Scenario: 跨 scope task 被隐藏
- **WHEN** 调用方查询属于另一个 owner 或 agent scope 的 task
- **THEN** Task Channel MUST 返回安全的 not-found 错误
- **AND** MUST NOT 泄露其存在性

### Requirement: 统一 Task 事件结构

所有 SSE stream 事件和 async callback 事件 SHALL 使用单一统一的 `TaskEvent` 结构。该结构 SHALL 与 channel-web `StreamEnvelope` 字段命名对齐，同时移除内部诊断字段。

`TaskEvent` SHALL 包含：
- `eventId`：稳定的事件标识符
- `eventType`：`TaskEventType`
- `sessionId`：session 坐标
- `taskId`：request 身份（由 runtime `requestId` 映射）
- `sequence`：单调递增事件序列
- `createdAt`：epoch 毫秒时间戳（与 channel-web 同名字段）
- `payload`：以 JSON object 表示的事件特定数据（与 channel-web 同名字段）

`TaskEvent` MUST NOT 包含 `runId`、`requestContextId`、`transportHints`、`timelineEventRef`、`attempt` 或任何内部 runtime 别名。`payload` SHALL 携带从 runtime timeline event 投影的事件特定字段，与 channel-web payload 投影一致。

SSE 事件和 callback 事件 MUST 使用相同的 `TaskEvent` 结构。Callback body SHALL 是 `{ events: TaskEvent[] }`。

Channel 层事件过滤：`BACKGROUND_TASK_STARTED`、`BACKGROUND_TASK_COMPLETED`、`BACKGROUND_TASK_FAILED` 和 `OUTPUT_GUARD_BLOCKED` SHALL NOT 被投影到 SSE 或 callback 消费方。TaskEventType enum 保留全部 23 个值以保证穷尽映射安全，但这 4 个类型在投影时被过滤。

#### Scenario: SSE 事件使用统一结构
- **WHEN** 一个 POST stream-task SSE 事件被发出
- **THEN** 该事件 MUST 包含 `eventId`、`eventType`、`sessionId`、`taskId`、`sequence`、`createdAt` 和 `payload`
- **AND** MUST NOT 包含 `runId`、`requestContextId`、`transportHints` 或 `timelineEventRef`

#### Scenario: Callback 事件使用与 SSE 相同的结构
- **WHEN** 一个 async callback 事件被投递
- **THEN** 该事件结构 MUST 与 SSE 事件结构完全一致
- **AND** callback body MUST 是 `{ events: TaskEvent[] }`

#### Scenario: 被过滤的事件类型不被推送
- **WHEN** 发生 `BACKGROUND_TASK_STARTED`、`BACKGROUND_TASK_COMPLETED`、`BACKGROUND_TASK_FAILED` 或 `OUTPUT_GUARD_BLOCKED` 事件
- **THEN** Task Channel MUST NOT 将其投影到 SSE 或 callback 消费方

### Requirement: TaskEventType 穷尽投影

TaskEventType SHALL 为每个 StreamEventType 提供穷尽映射。映射 SHALL 把 `REQUEST_` 替换为 `TASK_`，移除 `LLM_`，并保留所有其他名称。它 SHALL 包含 `BACKGROUND_TASK_STARTED`、`BACKGROUND_TASK_COMPLETED`、`BACKGROUND_TASK_FAILED` 和 `OUTPUT_GUARD_BLOCKED`。

Channel 层过滤：这 4 个事件类型 SHALL NOT 被推送到 SSE 或 callback 消费方。该 enum 保留所有值以获得编译期穷尽安全；过滤是运行时投影行为。

#### Scenario: 新事件类型被映射而无需断言
- **WHEN** 任何当前定义的 StreamEventType 被投影
- **THEN** MUST 恰好返回一个 TaskEventType
- **AND** 实现 MUST NOT 依赖 unchecked 类型断言处理缺失 case

#### Scenario: 契约检测未来漂移
- **WHEN** StreamEventType 新增一个值而没有对应的 TaskEventType 映射
- **THEN** 编译期穷尽检查或契约测试 MUST 失败

### Requirement: HTTP IR 异步 callback 投递

Async task create SHALL 要求 `callbackTarget.url` 并通过 Task Channel 拥有的 `TaskCallbackDeliveryPort` 和收窄的 HTTP 实现进行投递。该实现 SHALL 只 POST 固定的 callback JSON schema，MUST NOT 接受任意的 method、header、credential 或 body。Task Channel MUST NOT 调用 CLIP 或调用模型可见的 Tool provider。

一次 callback 请求 SHALL 包含至少一个事件的 `events: TaskEvent[]`，允许一次请求携带多个有序事件。`reportEvents` 参数控制推送哪些事件：`"TERMINAL"`（默认）只推送 `TASK_COMPLETED`、`TASK_FAILED`、`TASK_CANCELED` 和 `USER_INPUT_REQUIRED`；`"ALL"` 额外推送过程事件。事件类型列表为保留项；过滤引擎未实现，当前行为等价于 `"ALL"`。每个事件 SHALL 使用统一的 `TaskEvent` 结构。

Channel 层事件过滤：无论 `reportEvents` 设置如何，`BACKGROUND_TASK_STARTED`、`BACKGROUND_TASK_COMPLETED`、`BACKGROUND_TASK_FAILED` 和 `OUTPUT_GUARD_BLOCKED` SHALL NOT 通过 callback 推送。

`USER_INPUT_REQUIRED` payload SHALL 在存在 `timeoutAt` 时额外包含以绝对 epoch 毫秒表示的 `overtime`。Callback 重试 MUST 保留 eventId 和顺序。消费方 SHALL 能幂等处理重复的 eventId。

`callbackTarget` 保留既有 `{ url }` 结构。`parameters[]` 增强被延期。

#### Scenario: 多个事件在一次调用中推送
- **WHEN** callback 投影有多个有序的可投递事件就绪
- **THEN** TaskCallbackDeliveryPort MAY 在一个 events 数组中发送它们
- **AND** MUST 保留它们的 canonical sequence 顺序

#### Scenario: 用户输入 callback 携带恢复数据
- **WHEN** USER_INPUT_REQUIRED 被投影
- **THEN** callback 事件 payload MUST 包含 pending input 数据以及存在时的 `overtime`

#### Scenario: reportEvents TERMINAL 限制 callback 事件
- **WHEN** `reportEvents="TERMINAL"` 且发生一个过程事件（例如 CONTENT_DELTA）
- **THEN** Task Channel MUST NOT 通过 async callback 发送它

#### Scenario: reportEvents ALL 推送过程事件
- **WHEN** `reportEvents="ALL"` 且发生一个过程事件（例如 CONTENT_DELTA）
- **THEN** Task Channel MUST 通过 async callback 推送它

#### Scenario: 被过滤的事件类型永不被推送
- **WHEN** 发生 `BACKGROUND_TASK_*` 或 `OUTPUT_GUARD_BLOCKED` 事件
- **THEN** 无论 `reportEvents` 如何，Task Channel MUST NOT 通过 async callback 推送它

#### Scenario: Callback 失败不改变 runtime 事实
- **WHEN** HTTP callback 在有界重试后失败或超时
- **THEN** RequestRun、PendingInput、terminal 结果和 canonical timeline MUST 保持不变
- **AND** 调用方 MUST 能通过 POST 对账查询恢复
### Requirement: Task Callback 收窄传输边界

HTTP callback 实现 SHALL 由 `agent-channel-task` 拥有，作为一个专用出站传输。TaskCallbackDeliveryPort SHALL 只接受 callback 目标、有序 TaskEvent 数组和 cancellation 信号。它 MUST NOT 暴露通用 HTTP 请求形状。受信 app 配置 MUST 在网络 callback 投递可用前提供非空的 exact-origin allowlist。当未配置 allowlist 时，网络 callback 投递 MUST 保持不可用，且 async create MUST 在请求提交前以 HTTP 503 失败。远程 UDS callback 路径 MAY 使用 app composition 拥有的固定本地 origin，而不是配置的网络 origin。受信 app 配置 SHALL 提供传输限额。当 `tlsInsecure` 配置为 true 时，向 allowlist 内 HTTPS 目标的 callback 投递 SHALL 仅针对 callback channel 跳过 TLS 证书校验；进程内所有其他 HTTPS 连接保持不受影响。

#### Scenario: Callback 目标不在受信策略内
- **WHEN** callbackTarget.url 不满足配置的协议、credential 或 fragment 策略
- **THEN** 该条目 MUST 在 callback 订阅之前安全失败
- **AND** MUST NOT 尝试网络请求
- **AND** 在批次中，失败条目 MUST 在 `results` 中报告，不影响其他条目

#### Scenario: 空 allowlist 下的 callback 投递
- **WHEN** 未配置 callback URL allowlist
- **AND** 未装配远程 UDS callback 路径
- **THEN** async create MUST 在请求提交前以 HTTP 503 失败
- **AND** 系统 MUST NOT 尝试网络请求

#### Scenario: 自签名 TLS 证书下的 callback 投递
- **WHEN** `tlsInsecure` 配置为 true
- **AND** callbackTarget.url 使用 allowlist 内的 https origin
- **THEN** callback 投递 SHALL 跳过 TLS 证书校验
- **AND** 进程内其他 HTTPS 连接 SHALL 仍受标准 TLS 校验约束

#### Scenario: 收窄传输不能变成通用执行器
- **WHEN** Task Channel 调用 TaskCallbackDeliveryPort
- **THEN** 调用方 MUST NOT 能选择任意的 method、header 集、credential 或请求 body
- **AND** 投递 MUST 使用固定的 Task callback POST schema

### Requirement: Traceparent 头透明性

所有 Task Channel 端点 SHALL 接受 W3C `traceparent` 请求头，不拒绝也不过滤它。Channel SHALL NOT 在当前版本解析、校验、记录或处理该头部的值。Trace context 向 runtime、capability 和出站 CLIP 调用的传播延期到单独的 change。

#### Scenario: Traceparent 头被接受
- **WHEN** 一个请求携带 `traceparent` 头
- **THEN** Task Channel MUST NOT 基于该头部拒绝请求
- **AND** MUST NOT 解析或存储该头部值

#### Scenario: 缺失 traceparent 头被接受
- **WHEN** 一个请求不携带 `traceparent` 头
- **THEN** Task Channel MUST 正常处理该请求

### Requirement: Task Channel 安全错误与容量边界

所有 Task Channel 的 request、query、multipart、内联文件、callback 和 SSE stream 边界 SHALL 使用 runtime schema 校验。安全错误、日志、metric、trace 和 audit 事实 MUST NOT 包含原始文件内容、prompt/模型输出、callback body、credential、token、stack 或不安全的 URL 细节。

#### Scenario: 超大批次被拒绝
- **WHEN** 一个 query 或 mutation body 包含超过 20 个 task 条目
- **THEN** Task Channel MUST 返回 HTTP 400，不查询无界数据集也不调用 runtime

#### Scenario: 不安全的内联文件被拒绝
- **WHEN** raw 编码、media type、大小或远程 URL 违反附件策略
- **THEN** Task Channel MUST 以安全错误拒绝它
- **AND** MUST 不提交该 request

#### Scenario: 遗留公开字段被拒绝
- **WHEN** 客户端向任何端点提供 `inputText`、`routingConstraints`、`mode`、`runId`、`contextId` 或 `callbackClipTarget`，或向 cancel/answer 端点提供 `idempotencyKey`
- **THEN** closed schema 校验 MUST 返回 HTTP 400

#### Scenario: 已删除的 stream 端点返回 404
- **WHEN** 调用方请求 `WS /api/v1/task/:taskId/ws` 或 `GET /api/v1/task/:taskId/stream`
- **THEN** Task Channel MUST 返回 HTTP 404
- **AND** MUST NOT 建立任何 stream 连接
- Query：不接受；query 是只读操作，不需要 idempotencyKey。
请求 body SHALL 是 `{ tasks: [{ sessionId, taskId }] }`，最多 20 个条目。每个条目携带自己的 `sessionId` 和 `taskId`，支持跨 session 批量查询。Query 是只读操作，不需要 `idempotencyKey`。SHALL NOT 提供基于路径的单任务查询端点。
`POST /api/v1/stream-task` SHALL 接受单个 task body，包含 `taskMessages`、可选 `locale`、可选 `idempotencyKey` 和可选 `reportEvents`。Create SHALL NOT 接受 `sessionId`；channel 始终创建新 session，task 与 session 是 1:1 的。公开 create schema MUST NOT 接受 `mode`、`callbackTarget`、`inputText`、`routingConstraints`、`sessionId`、`callbackClipTarget`、`runId`、`contextId`、owner scope 或 agent scope 字段。
Stream-task create SHALL 接受用于文件上传的 multipart form-data；响应仍是 SSE。Multipart 字段 MUST 限定为 `taskMessages`、`locale`、`idempotencyKey` 和 `reportEvents`。
