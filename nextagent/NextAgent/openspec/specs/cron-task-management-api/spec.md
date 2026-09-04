# cron-task-management-api Specification

## Purpose
定义 Cron 任务创建、查询和控制的 Web API 契约及其显式目标绑定，使可信调用方可按固定的请求和结果模型安全管理调度任务。

## Function

- **所属 Function**：`FN-10.9 Cron 工具`
## Requirements
### Requirement: Cron task management API supports explicit target binding

Cron task management API MUST support an optional `target` field on public task create, update and response DTOs. When `target` is present, it MUST identify exactly one Cron task execution target with `kind` equal to `SKILL` or `WORKFLOW` and `name` equal to a safe capability identifier. When `target` is absent, the Cron task MUST preserve the current prompt-only execution behavior.

#### Scenario: Create prompt-only Cron task
- **WHEN** a client sends `POST /api/v1/cron-tasks` with valid `cron`, non-empty `prompt`, optional `recurring`, and no `target`
- **THEN** Web channel MUST create a durable Cron task with no explicit target
- **AND** the response MUST omit `target`
- **AND** future trigger delivery MUST submit the task prompt without `routingConstraints.targetSkill` or `routingConstraints.targetRecipe`

#### Scenario: Create Skill-bound Cron task
- **WHEN** a client sends `POST /api/v1/cron-tasks` with `target.kind="SKILL"` and valid `target.name`
- **THEN** Web channel MUST create a durable Cron task whose public DTO contains the same target kind and name
- **AND** future trigger delivery MUST submit the task prompt with `routingConstraints.targetSkill` equal to `target.name`
- **AND** delivery MUST NOT set `routingConstraints.targetRecipe`

#### Scenario: Create Workflow-bound Cron task
- **WHEN** a client sends `POST /api/v1/cron-tasks` with `target.kind="WORKFLOW"` and valid `target.name`
- **THEN** Web channel MUST create a durable Cron task whose public DTO contains the same target kind and name
- **AND** future trigger delivery MUST submit the task prompt with `routingConstraints.targetRecipe` equal to `target.name`
- **AND** delivery MUST NOT set `routingConstraints.targetSkill`

#### Scenario: Update Cron task target
- **WHEN** a client sends `PUT /api/v1/cron-tasks/:taskId` with a valid `target`
- **THEN** Web channel MUST update only the current trusted owner and active Agent scoped task
- **AND** the response MUST contain the updated target
- **AND** already accepted trigger/run facts MUST NOT be rewritten

#### Scenario: Clear Cron task target
- **WHEN** a client sends `PUT /api/v1/cron-tasks/:taskId` with `target` explicitly set to null
- **THEN** Web channel MUST clear the durable Cron task target
- **AND** subsequent trigger delivery MUST submit the task prompt without `routingConstraints.targetSkill` or `routingConstraints.targetRecipe`

### Requirement: Cron task target input fails closed

Cron task management API MUST validate `target` before calling Cron task gateway. `target.kind` MUST be either `SKILL` or `WORKFLOW`. `target.name` MUST be a non-empty safe identifier using the same allowed character class as runtime routing constraint target identifiers. The API MUST reject target objects with unknown fields, missing fields, empty names, invalid names, unsupported kinds or conflicting legacy target fields.

#### Scenario: Invalid target is rejected
- **WHEN** create or update request body contains an invalid `target`
- **THEN** Web channel MUST return a safe 400 validation error
- **AND** Cron task gateway MUST NOT create or modify a task

#### Scenario: Client cannot smuggle routing constraints through Cron task target
- **WHEN** create or update request body contains `routingConstraints`, `targetSkill`, `targetRecipe`, owner scope, Agent scope, session, run, capability parameters or prompt override fields outside the defined Cron task body
- **THEN** Web channel MUST return a safe 400 validation error
- **AND** the system MUST NOT create or modify a Cron task

#### Scenario: Explicit target rejects prompt directive conflict
- **WHEN** create or update request would leave a Cron task with both a structured `target` and a prompt containing a valid `$skill:` or `$workflow:` directive
- **THEN** Cron task management API MUST return a safe 400 validation error
- **AND** the system MUST NOT create or modify a Cron task

### Requirement: Cron task target is a durable management fact

Cron task target MUST be persisted as part of the Cron task durable fact. A persisted task with no target MUST remain a valid task. Query, create and update responses MUST expose target only through the public DTO `target` field and MUST NOT expose database column names, gateway-only field names, idempotency key, version, owner fields, trigger facts or runtime routing internals.

#### Scenario: Target survives restart
- **WHEN** a Skill-bound or Workflow-bound Cron task is created successfully and the application restarts with the same durable Cron gateway
- **THEN** `GET /api/v1/cron-tasks` MUST return the task with the same `target.kind` and `target.name`

#### Scenario: Legacy or unbound task remains prompt-only
- **WHEN** a Cron task was created before target support or was created without target
- **THEN** query response MUST remain valid
- **AND** the task MUST execute as prompt-only unless a later update sets target

### Requirement: Cron target delivery preserves runtime governance

Cron trigger delivery MUST convert a durable target into runtime routing constraints only at the server-side delivery boundary. The conversion MUST NOT execute Skill or Workflow directly, bypass runtime acceptance, bypass agent-core routing, or bypass capability governance. If the target names a Skill or Workflow unavailable in the accepted Agent scope, the run MUST follow the existing runtime/core failure, rejection or fallback behavior for that target kind.

#### Scenario: Target execution enters standard request lifecycle
- **WHEN** a due trigger is claimed for a Cron task with target
- **THEN** delivery MUST create or reuse the server-side Cron execution session
- **AND** delivery MUST call runtime submit with the task prompt, trusted owner scope, trusted Agent scope, low priority and the mapped routing constraint
- **AND** the accepted run MUST be bound back to the Cron trigger through the existing trigger/run binding

#### Scenario: Target does not override trusted scope
- **WHEN** a Cron task has target configured
- **THEN** delivery MUST derive owner scope from the task durable fact and Agent scope from the task `agentId`
- **AND** target MUST NOT override tenant, subject, agent, session, run, model profile, capability provider, credential, prompt text or attachment ids

### Requirement: Cron task management API persists creator display name

Cron task management API MUST 在创建 Cron task 时从 trusted identity context 提取创建者显示名称并持久化。创建者显示名称 MUST 来自 `IdentityContext.displayName`，不得来自客户端请求体。task 响应 DTO MUST 包含 `createdByName` 字段，类型为 optional string；当持久化的创建者显示名称为空字符串时，`createdByName` MUST 为 `null`。`createdByName` 是展示性字段，MUST NOT 参与 owner scope 校验、Agent Scope 校验或权限控制。

**需求类别**：功能性需求

#### Scenario: Create task persists creator display name
- **WHEN** 客户端发送 `POST /api/v1/cron-tasks` 且 trusted identity context 的 `displayName` 为 "Local developer"
- **THEN** 系统 MUST 持久化 `createdByName` 为 "Local developer"
- **AND** 成功响应 DTO MUST 包含 `createdByName` 字段且值为 "Local developer"

#### Scenario: Task list response includes creator display name
- **WHEN** 客户端发送 `GET /api/v1/cron-tasks` 且存在已持久化 `createdByName` 的任务
- **THEN** 响应中每个 task DTO MUST 包含 `createdByName` 字段
- **AND** `createdByName` 值 MUST 与创建时持久化的值一致

#### Scenario: Task with missing creator display name returns null
- **WHEN** 持久化的 `createdByName` 为 NULL（如迁移前已存在的旧任务）
- **THEN** task DTO 的 `createdByName` 字段 MUST 为 `null`
- **AND** 响应 MUST NOT 包含 `undefined` 或空字符串

### Requirement: Cron task management API surface
系统 SHALL 在 Web channel 暴露 Cron task 管理 REST API，用于对当前 trusted owner 与 active Agent 下的 Cron task 执行查询、创建、修改和删除。接口 MUST 使用 `/api/v1/cron-tasks` 作为集合路径，使用 `/api/v1/cron-tasks/:taskId` 作为单个 task 路径。接口 MUST 提供 request schema、success response schema 和 safe error response schema；task 响应 MUST 使用 public DTO，不得暴露 gateway `CronTaskRecord`、SQLite row、trigger fact、idempotency key、version、raw prompt history 或 runtime 内部 fact。task 响应 DTO MUST 包含 `createdByName` 字段，类型为 optional string 或 null；该字段 MUST 来自创建时持久化的 trusted identity context 显示名称，不得来自客户端请求体。

**需求类别**：功能性需求

#### Scenario: Query Cron tasks
- **WHEN** 客户端发送 `GET /api/v1/cron-tasks`
- **THEN** Web channel MUST 返回当前 trusted owner 与 active Agent 下可管理的 Cron task page，包含 `tasks` 和 `total`
- **AND** query MAY 包含非负整数 `offset` 与正整数 `limit`
- **AND** `limit` 默认值 MUST 为 50，最大值 MUST 为 50
- **AND** 响应 MUST NOT 回显 `offset` 或 `limit`
- **AND** 每个 task DTO MUST 至少包含 `taskId`、`cron`、`humanSchedule`、`prompt`、`recurring`、`status`、`createdAt`、`updatedAt`、`nextRunAt` 和 `createdByName`
- **AND** 响应 MUST NOT 包含 tenant、subject、session、run、version、trigger、gateway record 或 SQLite row 字段

#### Scenario: Create Cron task
- **WHEN** 客户端发送 `POST /api/v1/cron-tasks` 并提供合法 `cron`、非空 `prompt` 和可选 `recurring`
- **THEN** Web channel MUST 创建一个 durable Cron task
- **AND** 系统 MUST 从 trusted identity context 持久化创建者显示名称
- **AND** 成功响应 MUST 返回创建后的 public task DTO，包含 `createdByName`
- **AND** task MUST 参与既有 Cron scheduler/remote callback 到期触发路径

#### Scenario: Update Cron task
- **WHEN** 客户端发送 `PUT /api/v1/cron-tasks/:taskId` 并提供一个或多个合法可修改字段
- **THEN** Web channel MUST 只修改该 task 的 `cron`、`prompt` 或 `recurring`
- **AND** 如果 `cron` 被修改，系统 MUST 重新计算 `nextRunAt`
- **AND** 成功响应 MUST 返回修改后的 public task DTO
- **AND** 更新 MUST NOT 修改 `createdByName`

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

### Requirement: Cron task dashboard lists manageable tasks

Cron task dashboard SHALL 分为“任务”和“执行记录”两个 Tab。页面 MUST 具备与会话界面一致的整体布局：顶部 Header 左侧展示当前语言下的定时任务页面名称，右侧展示“手动创建”和 primary 风格的“通过会话创建”按钮，业务主体 MUST 使用与会话界面相同的最大宽度并居中显示。任务 Tab SHALL 加载并展示当前 trusted owner 与 active Agent 下可管理的 Cron tasks。页面 MUST 使用现有 Cron task management REST API，不得直接调用 Cron Tool、gateway、runtime command 或 stream event。任务 Tab MUST NOT 展示任务总数、当前页、执行记录三个指标块。任务 Tab MUST 以单列行式卡片展示 task；每张 task 卡片 MUST 使用 header、content、footer 结构，其中 header 左侧展示标题，header 右侧展示“执行”按钮、更多操作入口和表示是否开启的 switch，content 展示任务描述，footer 左侧展示时间和频率，footer 右侧展示创建该任务的用户名，footer 右侧 MUST 从 API 响应的 `createdByName` 字段读取用户名，当 `createdByName` 为 null 或缺失时 MUST 展示占位符 `-`，不得展示 `undefined`、`null` 或空字符串；“修改”和“删除”MUST 收纳在更多操作入口展开后的菜单中，同一时间 MUST NOT 有多个卡片菜单同时展开。

定时任务页面名称 MUST 由 `agent-web-page-layout` 的 `内置业务页面的导航标识与页面标题保持一致` Requirement 定义；本 Requirement MUST NOT 为定时任务建立第二套页面名称。

**需求类别**：功能性需求

#### Scenario: Dashboard renders task list
- **WHEN** 用户打开 Cron task dashboard route 且后端返回 task page
- **THEN** 页面 MUST 渲染单列行式 task 卡片列表
- **AND** 顶部 Header MUST 展示当前语言下的定时任务页面名称、“手动创建”和 primary 风格的“通过会话创建”
- **AND** 业务主体 MUST 按会话界面的最大宽度居中显示
- **AND** 每张卡片 MUST 以 header、content、footer 展示标题、描述、时间、频率、创建人、执行按钮、更多操作入口和开启 switch
- **AND** footer 右侧 MUST 从 `createdByName` 展示创建者名称，值为 null 时展示 `-`
- **AND** 任务 Tab MUST NOT 展示任务总数、当前页、执行记录三个指标块
- **AND** 页面 MUST NOT 同时展示独立“激活”按钮和开启 switch
- **AND** 用户 MUST 能直接点击“执行”进入该 task 的执行记录，并能通过更多操作菜单进入“修改”和“删除”
- **AND** 页面 MUST NOT 要求用户先进入或创建 chat session

#### Scenario: Dashboard handles unavailable service
- **WHEN** Cron task management API 返回 503 unavailable
- **THEN** 页面 MUST 显示可恢复错误状态
- **AND** 页面 MUST 提供重新加载入口

### Requirement: Cron task 管理 API 执行 ACTIVE 任务容量限制

Cron task management API MUST 在 `POST /api/v1/cron-tasks` 创建任务时应用与 Cron Tool 相同的 ACTIVE task capacity invariant。容量 MUST 按 trusted owner + active Agent scope 统计，只统计 `status='ACTIVE'` 的 durable task，上限为 50；`COMPLETED` 和 `DELETED` task MUST NOT 占用额度。

当当前 scope 已有 50 个 ACTIVE task 时，Web API MUST 返回 HTTP `409`，响应 `error.code` MUST 为 `CRON_TASK_LIMIT_REACHED`。底层 management failure MUST 使用 `AgentError` 的 `category=CONFLICT` 且 `retryable=false`；Web 投影 MUST 沿用既有 public safe error envelope，只暴露 stable `code` 与 safe `message`。系统 MUST NOT 创建 task、创建 trigger、修改既有 task 或推进任何持久化状态。响应 MUST NOT 暴露 tenant、subject、agent、SQL、存储路径、stack trace 或跨 scope 对象存在性。

Tool-created ACTIVE task 和 management-created ACTIVE task MUST 共享同一 50 条额度。

**需求类别**：功能性需求

#### Scenario: 第 50 个 management task 被接受

- **WHEN** 当前 trusted owner + active Agent scope 已有 49 个 ACTIVE task
- **AND** 客户端发送一个合法 `POST /api/v1/cron-tasks`
- **THEN** Web API MUST 创建 durable task
- **AND** 成功响应 MUST 返回 public task DTO

#### Scenario: 超限创建返回 409

- **WHEN** 当前 trusted owner + active Agent scope 已有 50 个 ACTIVE task
- **AND** 客户端发送一个合法 `POST /api/v1/cron-tasks`
- **THEN** Web API MUST 返回 HTTP `409`
- **AND** 响应 `error.code` MUST 为 `CRON_TASK_LIMIT_REACHED`
- **AND** 响应 MUST 使用既有 public safe error envelope，不新增 category/retryable 公共字段
- **AND** gateway MUST NOT 创建或修改 task

#### Scenario: COMPLETED 和 DELETED task 不占 Web 创建额度

- **WHEN** scope 内只有 `COMPLETED` 或 `DELETED` task 达到或超过 50 条
- **AND** 当前 ACTIVE task 少于 50
- **THEN** 合法 create MUST 成功
- **AND** capacity 判定 MUST NOT 把这些非 ACTIVE task 计入

#### Scenario: Tool 与 Web 创建共享额度

- **WHEN** scope 内已有 Cron Tool 创建的 50 个 ACTIVE task
- **AND** Web management API 尝试创建新 task
- **THEN** Web API MUST 返回 409 `CRON_TASK_LIMIT_REACHED`

#### Scenario: 超限错误不泄漏内部事实

- **WHEN** `POST /api/v1/cron-tasks` 因 ACTIVE capacity 被拒绝
- **THEN** 响应 MUST NOT 包含 tenant、subject、agent、SQLite detail、SQL、存储路径或 stack trace
- **AND** 响应 MUST NOT 揭示其他 scope 是否满额

#### Scenario: API 文档记录容量拒绝

- **WHEN** Cron task create endpoint 注册完成
- **THEN** authoritative Web API 文档 MUST 记录 HTTP 409、`CRON_TASK_LIMIT_REACHED`、category 和 retryable 语义
