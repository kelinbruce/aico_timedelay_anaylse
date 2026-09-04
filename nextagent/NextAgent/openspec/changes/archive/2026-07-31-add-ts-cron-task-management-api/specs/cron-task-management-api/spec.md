## ADDED Requirements

### Requirement: Cron task management API surface
系统 SHALL 在 Web channel 暴露 Cron task 管理 REST API，用于对当前 trusted owner 与 active Agent 下的 Cron task 执行查询、创建、修改和删除。接口 MUST 使用 `/api/v1/cron-tasks` 作为集合路径，使用 `/api/v1/cron-tasks/:taskId` 作为单个 task 路径。接口 MUST 提供 request schema、success response schema 和 safe error response schema；task 响应 MUST 使用 public DTO，不得暴露 gateway `CronTaskRecord`、SQLite row、trigger fact、idempotency key、version、raw prompt history 或 runtime 内部 fact。

#### Scenario: Query Cron tasks
- **WHEN** 客户端发送 `GET /api/v1/cron-tasks`
- **THEN** Web channel MUST 返回当前 trusted owner 与 active Agent 下可管理的 Cron task page，包含 `tasks` 和 `total`
- **AND** query MAY 包含非负整数 `offset` 与正整数 `limit`
- **AND** `limit` 默认值 MUST 为 50，最大值 MUST 为 50
- **AND** 响应 MUST NOT 回显 `offset` 或 `limit`
- **AND** 每个 task DTO MUST 至少包含 `taskId`、`cron`、`humanSchedule`、`prompt`、`recurring`、`status`、`createdAt`、`updatedAt` 和 `nextRunAt`
- **AND** 响应 MUST NOT 包含 tenant、subject、session、run、version、trigger、gateway record 或 SQLite row 字段

#### Scenario: Create Cron task
- **WHEN** 客户端发送 `POST /api/v1/cron-tasks` 并提供合法 `cron`、非空 `prompt` 和可选 `recurring`
- **THEN** Web channel MUST 创建一个 durable Cron task
- **AND** 成功响应 MUST 返回创建后的 public task DTO
- **AND** task MUST 参与既有 Cron scheduler/remote callback 到期触发路径

#### Scenario: Update Cron task
- **WHEN** 客户端发送 `PUT /api/v1/cron-tasks/:taskId` 并提供一个或多个合法可修改字段
- **THEN** Web channel MUST 只修改该 task 的 `cron`、`prompt` 或 `recurring`
- **AND** 如果 `cron` 被修改，系统 MUST 重新计算 `nextRunAt`
- **AND** 成功响应 MUST 返回修改后的 public task DTO

#### Scenario: Delete Cron task
- **WHEN** 客户端发送 `DELETE /api/v1/cron-tasks/:taskId`
- **THEN** Web channel MUST 删除当前 trusted scope 下的对应 Cron task
- **AND** 成功响应 MUST 为 `204 No Content`
- **AND** 删除后的 task MUST 不再被 query response 返回，也 MUST 不再产生新的 trigger

### Requirement: Cron task execution record API surface
系统 SHALL 在 Web channel 暴露 `GET /api/v1/cron-tasks/:taskId/runs`，用于查询当前 trusted owner 与 active Agent 下指定 Cron task 的执行记录和执行结果。接口 MUST 返回 public execution DTO，不得暴露 gateway record、SQLite row、idempotency key、version、raw provider error、stack、credential、token 或跨 scope 对象存在性。

#### Scenario: Query Cron task executions
- **WHEN** 客户端发送 `GET /api/v1/cron-tasks/:taskId/runs`
- **THEN** Web channel MUST 先确认 task 存在于当前 trusted owner 与 active Agent scope
- **AND** 响应 MUST 返回该 task 的 execution page，包含 `executions` 和 `total`
- **AND** 响应 MUST NOT 回显 `offset` 或 `limit`
- **AND** query MAY 包含非负整数 `offset` 与正整数 `limit`
- **AND** `limit` 默认值 MUST 为 50，最大值 MUST 为 50
- **AND** 每个 execution DTO MUST 至少包含 `triggerId`、`taskId`、`scheduledAt`、`triggerStatus`、`createdAt` 和 `updatedAt`
- **AND** 当 trigger 已绑定 runtime run 时，DTO MUST 包含 `sessionId`、`requestRunId`、`runStatus` 和 `terminalCommitState`
- **AND** 当 runtime run 已产生 terminal event 时，DTO MUST 包含 `resultEventType`、`resultAt`，并在 terminal event inline payload 含 `content` 时包含 `resultContent`

#### Scenario: Scoped execution query does not leak foreign task existence
- **WHEN** 客户端查询当前 trusted scope 外存在的 Cron task executions
- **THEN** Web channel MUST 返回 404 safe error 或等价 not-found outcome
- **AND** 系统 MUST NOT 返回该 task 的 trigger、session、run 或 terminal result

### Requirement: Cron task management API scope is trusted-only
Cron task 管理 API SHALL 只从 channel/auth boundary 获取 Owner Scope，只从 trusted app composition 获取 active Agent Scope。请求 body、query、path 或 client metadata MUST NOT 接受 tenant、subject、agent、session、run、createdAt、updatedAt、version、status、nextRunAt、trigger 或 persistence owner 字段。管理 API 创建的 task MUST NOT 要求客户端提供 session，也 MUST NOT 以创建请求所在 session 作为 task 归属；Cron task 的持久化归属 MUST 为 trusted owner + active Agent。

#### Scenario: Client cannot override owner or agent scope
- **WHEN** create、update、task query 或 execution query 请求携带 tenant、subject、agent、session 或 run 字段
- **THEN** Web channel MUST 在调用 Cron gateway 前返回 validation error
- **AND** 系统 MUST NOT 创建、修改、删除或返回跨 owner 或跨 Agent 的 Cron task

#### Scenario: Unknown task does not leak existence
- **WHEN** 客户端查询、修改或删除当前 trusted scope 外存在的 task id
- **THEN** Web channel MUST 返回 404 safe error 或等价 not-found outcome
- **AND** 响应 MUST NOT 泄露该 task 是否存在于其他 owner 或 Agent scope

### Requirement: Cron task management API validates task input
Cron task 管理 API SHALL 在进入 gateway 前验证所有不可信输入。`cron` MUST 是受支持的 5 字段 cron 表达式，长度 MUST 不超过 256 字符，并且 MUST 能在未来一年内计算出下一次运行时间。`prompt` MUST 为非空字符串，长度 MUST 不超过 10000 字符。`PUT` body MUST 至少包含一个可修改字段且不得包含未知字段。

#### Scenario: Invalid create input fails closed
- **WHEN** create 请求提供非法 cron、空 prompt、过长 prompt 或未知字段
- **THEN** Web channel MUST 返回 400 safe validation error
- **AND** Cron gateway MUST NOT 被调用创建 task

#### Scenario: Invalid update input fails closed
- **WHEN** update 请求 body 为空、只包含未知字段、提供非法 cron 或过长 prompt
- **THEN** Web channel MUST 返回 400 safe validation error
- **AND** Cron gateway MUST NOT 持久化任何修改

### Requirement: Cron task management API preserves durable scheduling semantics
Cron task 管理 API SHALL 复用既有 Cron task gateway 和 scheduler/callback delivery 语义。成功 create/update/delete 返回前，相关 Cron task mutation MUST 已 durable commit。`PUT` 修改 active task 后 MUST 保持同一 task id 和 trusted scope；`DELETE` MUST 使用 gateway 删除语义使 task 不再参与 due scan。接口不得绕过 runtime lifecycle 直接执行 prompt。

#### Scenario: Created task survives restart
- **WHEN** create 请求成功后应用以同一 durable Cron gateway 重启
- **THEN** query 请求 MUST 返回该 task，且 task id、cron、prompt、recurring 和 status 保持一致

#### Scenario: Updated schedule affects next trigger
- **WHEN** update 请求成功修改 active task 的 cron
- **THEN** 后续 local scheduler due scan 或 remote Cron service MUST 使用更新后的 schedule fact
- **AND** 已经 accepted 的 trigger/run MUST 不被 update 回滚或重写

### Requirement: Cron task management API is safe and documented
Cron task 管理 API SHALL 对所有成功和失败响应使用可文档化的 public shape。错误响应 MUST 至少包含 safe `error.code` 和 safe `error.message`，不得暴露非 execution result 的执行内容、模型输出、raw provider error、stack、credential、token、host path、SQLite detail 或跨 scope 对象存在性。Web API 清单 MUST 在同一 change 中记录五个 endpoint 的请求、响应和错误码。

#### Scenario: Missing Cron gateway returns unavailable
- **WHEN** deployment 未选择或未装配 Cron task gateway
- **THEN** Cron task management endpoints MUST 返回 503 safe error
- **AND** 响应 MUST NOT 暴露内部装配对象或 provider detail

#### Scenario: API documentation covers the management surface
- **WHEN** Cron task management endpoints 被注册
- **THEN** authoritative Web API document MUST 列出 query、create、update、execution query 和 delete endpoint
- **AND** 文档 MUST 覆盖 path/query/body、success response 和 endpoint-specific safe error codes
