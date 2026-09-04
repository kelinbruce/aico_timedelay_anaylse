## 背景与问题（Why）

`agent-channel-task` 已提供面向后台服务的 Task Channel，但当前 public contract 仍围绕内部 sandbox/CLIP 路径设计：外部任务标识被映射为 session、输入以 `inputText` 为主、异步回调依赖 CLIP capability，并且缺少任务批量对账接口。该形态不能完整支撑网管、告警、编排等外部系统通过 HTTP/JSON 管理任务生命周期。

后台系统与 NextAgent 任一侧重启、回调网络中断或消息处理确认丢失时，`RequestRun`、canonical timeline 和 `PendingInput` 仍可保留，但调用方可能错过 `USER_INPUT_REQUIRED` 或终态通知。Task Channel 需要以持久化 runtime 事实为准，通过批量状态查询和回调推送实现最终一致性恢复。

## 变更范围（What Changes）

- **拆分** 任务下发接口为两套独立路由树，按交付模式区分：流式路由树 `stream-task`（POST 直接以 SSE 事件流作为 HTTP response body 返回，无需二次订阅）；异步路由树 `async-tasks`（返回 JSON 控制响应并触发回调推送）。
- **修改** 流式创建 `POST /api/v1/stream-task`：单任务请求体，直接以 SSE 流作为响应体返回；首个事件为 `TASK_ACCEPTED`，终态事件后关闭流。
- **修改** 异步创建 `POST /api/v1/async-tasks`：批量 `tasks[]`（maxItems=20），必带 `callbackTarget`，返回 JSON 控制响应并触发回调推送。
- **删除** `GET /api/v1/task/:taskId/stream` 独立 SSE 订阅端点和 `WS /api/v1/task/:taskId/ws` WebSocket 端点：路由不注册，返回 404；保留 `lastSeenSequence` 断点续传设计供后续启用。
- **拆分** Edit 和 Retry 为流式/异步两种端点：`POST /api/v1/stream-task/:taskId/edit`（SSE 响应）和 `POST /api/v1/async-tasks/edit`（JSON 响应）；`POST /api/v1/stream-task/:taskId/retry`（SSE 响应）和 `POST /api/v1/async-tasks/retry`（JSON 响应）。
- **保留** Cancel、Query、Answer 端点路径不变：`POST /api/v1/tasks/cancel`、`POST /api/v1/tasks/query`、`POST /api/v1/tasks/pending-inputs/answer`。
- **新增** `reportEvents` 参数（替代 `isStreamRecord`）：create/edit/retry 的流式和异步端点都支持，接受事件类型列表或 `"ALL"`/`"TERMINAL"`；参数为预留，事件过滤引擎暂不实现，当前行为等同 `ALL`。
- **修改** idempotencyKey 差异化：Create 可选，Edit 必填，Answer 可选；缺失时 channel 内部生成 UUID 作为 runtime idempotency key。Query 为只读接口，不需要 idempotencyKey。
- **简化** Query 响应格式：统一用 `data: JsonObject` 扁平字段，按 `taskStatus` 区分内容（终态结果或 pending 快照），移除 `taskMessages` 数组包裹和 `pendingInput` 嵌套对象。
- **新增** Retry 响应增加 `attempt` 字段：从 runtime `RequestAccepted.attempt` 暴露递增尝试序号。
- **修改** 事件类型投影：channel 层过滤 `BACKGROUND_TASK_STARTED`、`BACKGROUND_TASK_COMPLETED`、`BACKGROUND_TASK_FAILED` 和 `OUTPUT_GUARD_BLOCKED` 四个事件类型，不在 SSE 和 callback 中推送给消费方；TaskEventType 枚举保留 23 个穷尽映射不变。
- **新增** Edit 端点支持 multipart form-data：流式和异步 edit 都接受文件上传，与 create 的 multipart 解析逻辑复用。
- **正式暴露** PendingInput questions 结构化 schema：公开 `prompt`、`options[]`（label/value/requiresTextInput/inputPlaceholder）、`multiple`、`custom` 和 4 种 kind（QUESTION/CONFIRMATION/AUTHORIZATION/HUMAN_HANDOFF），与 runtime 合约和 channel-common 投影一致。
- **修正** Edit taskId 行为描述：edit 产生新 taskId（runtime `editLatest` 创建新 requestId，旧 request 被 supersede），retry 保持同一 taskId（attempt 递增）；原 spec "Edit and retry preserve task identity" 描述错误，需修正。
- **修改** Task Channel public identifier：外部 `taskId` 对应 runtime `requestId`；`sessionId` 保留为独立会话坐标。移除 `runId` 和 `contextId` 等内部诊断字段，不再对外暴露。Retry 响应保留 `attempt` 字段。
- **修改** create/edit 任务输入数据为 `taskMessages: TaskMessage[]`。当前执行版本要求数组恰好包含一条消息，但保留数组 contract 供后续扩展。Answer 使用顶层 `answers`，不使用 `taskMessages`。
- **新增** JSON inline `fileContent`，支持 `raw` 或 `url` 二选一，并进入 attachment intake 可信校验路径。
- **新增** `POST /api/v1/tasks/query` 批量任务状态与恢复查询（最大 20 个 task），通过 runtime request summary read model 读取持久化事实，用于重启、回调丢失后的状态对账。终态时返回结果数据。
- **修改** `TaskStatus`，增加 `TASK_PENDING`。存在 active PendingInput 时该状态优先于底层运行中的 `RunStatus` 投影。
- **新增** 统一 `TaskEvent` 结构，SSE 和 callback 共用同一事件格式，与 channel-web `StreamEnvelope` 字段命名对齐，移除 `runId`、`requestContextId`、`transportHints`、`timelineEventRef` 等内部字段。
- **移除** public `routingConstraints`；skill/recipe 选择仅由输入文本的既有模式匹配/Agent routing 路径决定。
- **修改** pending-input answer body，要求携带 `sessionId` 并校验其与 `taskId` 所属 request 一致。Answer 使用顶层 `answers` 格式。
- **修改** async callback 为 HTTP/IR 交付，使用统一 `TaskEvent` 结构。
- **修改** `agent-contracts/runtime`：在现有 `RuntimeSessionPort` 的 `getRequestSummary` 返回类型增加 `terminalResult` 字段，用于终态结果数据返回。
- **新增** 接口 header 透明透传 W3C `traceparent`，channel 当前不处理，数据传递后续单开 change。
- **延期** 事件过滤引擎（按 `reportEvents` 事件类型列表过滤）、`callbackTarget.parameters` 结构增强、事件批量上报汇聚策略（按时间窗/数量）、traceparent 传播到 runtime/capability、HOFS 文件隔离存储、身份透传到业务 SKILL、PENDING_INPUT_TIMEOUT 恢复路径，均不在本 change 实施。

## 依赖与实施顺序

- HTTP callback 是 Task Channel 专用出站 transport，由 `agent-channel-task` 内的收窄实现负责，不依赖通用 HTTP gateway 或 APIToolProvider。
- `TaskCallbackDeliveryPort` 只接受固定 callback target 和 `TaskEvent[]`；不得扩展为允许任意 method/header/body 的通用 HTTP executor。
- `RuntimeSessionPort.getRequestSummary` 已实施，本 change 增加其返回类型的 `terminalResult` 字段。

## 不在范围内（Explicit Non-Goals）

- 不由 Task Channel 拥有 request lifecycle、canonical timeline、PendingInput 或 terminal commit。
- 不新增 Task Channel 专用持久化任务表；查询结果由 runtime 持久化事实投影。
- 不在本 change 实现通用 HTTP gateway、APIToolProvider、credential store 或任意 HTTP 执行器。
- 不在本 change 实现 durable callback outbox。callback 是可重试、可能重复的低延迟通知；POST 对账提供最终恢复路径。
- 不在本 change 实现 `reportEvents` 事件过滤引擎；参数为预留，当前行为等同 `ALL`。
- 不在本 change 实现 `callbackTarget.parameters` 结构增强；保留现有 `{ url }` 实现，待其他能力实现后再讨论。
- 不在本 change 实现事件批量上报汇聚策略（按时间窗/数量汇聚），该需求单独分析处理。
- 不在本 change 实现 traceparent 传播到 runtime/capability/出站调用；header 已支持透明传入，解析与传播单开 change。
- 不在本 change 实现 HOFS 文件隔离存储；`fileContent.url` remote intake 保持 deferred。
- 不在本 change 实现身份透传到业务 SKILL；IdentityContext 全调用链透传涉及 capability 调用框架改造，单开 change。
- 不在本 change 实现 PENDING_INPUT_TIMEOUT 恢复路径；当前有 TIMEOUT 事件但无恢复行为，需 runtime 支持，单开 change。
- 不实现 `WS /api/v1/task/:taskId/ws`、`GET /api/v1/task/:taskId/stream`、conversation、delete、stop、resume 或同一 task 下追加 request。GET stream 路由不注册，返回 404；保留 `lastSeenSequence` 断点续传设计供后续启用。
- 不允许请求体、TaskMessage metadata 或 callback metadata 覆盖 IdentityContext、Agent Scope 或 Owner Scope。
- 不扩大当前一次请求的消息执行能力；多消息执行明确 deferred。
- 不提供 create idempotency 保护；`idempotencyKey` 为可选参数，重复 POST 创建新 task。Edit 的 `idempotencyKey` 为必填，runtime 已强制要求。
- 不暴露 `runId`、`contextId` 等内部诊断字段；`attempt` 仅在 retry 响应中暴露。

## Capability 影响（Capabilities）

### 修改 Capability

- `agent-task-channel`：刷新外部 HTTP/JSON contract、标识映射、消息 DTO、状态投影、恢复查询、SSE 流式创建、统一事件结构和 callback delivery。
- `ts-core-contracts`：扩展现有 `RuntimeSessionPort.getRequestSummary` 返回类型，增加 `terminalResult` 字段；不改变 runtime lifecycle ownership。

## 影响范围（Impact）

- 代码：`packages/agent-channel-task`、`packages/agent-contracts/src/runtime`、`packages/agent-runtime`、`packages/agent-app`，以及必要的 gateway-local request read 查询实现。
- API：`/api/v1/stream-task`（流式创建，SSE）、`/api/v1/stream-task/:taskId/edit`（流式编辑，SSE）、`/api/v1/stream-task/:taskId/retry`（流式重试，SSE）、`/api/v1/async-tasks`（异步创建，JSON+callback）、`/api/v1/async-tasks/edit`（异步编辑，JSON）、`/api/v1/async-tasks/retry`（异步重试，JSON）、`/api/v1/tasks/cancel`（取消，JSON）、`/api/v1/tasks/query`（查询，JSON）、`/api/v1/tasks/pending-inputs/answer`（回答，JSON）；删除 `GET /api/v1/task/:taskId/stream` 和 `WS /api/v1/task/:taskId/ws`，路由不注册返回 404。
- 持久化：复用现有 request run、pending input 和 timeline 表；只增加读取路径，不新增 Task Channel 事实表。
- 安全：所有 list/control/answer 查询同时校验可信 Agent Scope 与 Owner Scope；callback URL 由 Task Channel 专用 HTTP transport 校验 protocol、credential、fragment；allowlist 为可选 origin 加固，未配置时放行合法 http/https URL；`tlsInsecure` 为 true 时仅对 callback HTTPS 跳过证书校验。
- 测试：contract、characterization、recovery、owner/agent isolation、SSE stream、callback delivery 和 architecture tests。

## 需群内确认

729 接口重构（URL 拆分、SSE 直接返回、reportEvents、idempotencyKey 差异化、answer 顶层格式、query 扁平化、retry attempt、事件过滤、multipart edit、questions 结构、edit taskId 修正）全部在 `agent-channel-task` channel 层完成，对 `agent-contracts` 无新增变更。

第一迭代已完成并实现的 `agent-contracts/runtime` 变更（作为本 change 的前序事实，不需再次确认）：
- `RuntimeSessionPort.getRequestSummary` 返回类型 `RuntimeRequestSummary` 已增加 `terminalResult` 字段；runtime 在组装 summary 时从 timeline 最后一个终态事件提取 content。
- `terminalResult` 包含 `content`、`contentType` 和可选 safe error 字段（`code`、`category`、`retryable`）。
- `RequestAccepted.attempt` 已存在；retry 时递增，edit 时重置为 1。
- `PendingInputKind`（QUESTION/CONFIRMATION/AUTHORIZATION/HUMAN_HANDOFF）和 `PendingInputQuestion`（prompt/options/multiple/custom）已定义。
- `editLatest` 创建新 requestId、`retryLatest` 保持同一 requestId 的行为已在 runtime 实现中固化。
- 不新增独立 request query port，不修改 `RunStatus`，`TASK_PENDING` 仅属于 Task Channel public projection。

本 change 后续对 `agent-contracts` 无变更需求。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/agent-task-channel/spec.md`
- `openspec/specs/ts-core-contracts/spec.md`
- `openspec/specs/ts-backend-architecture/spec.md`
- `openspec/specs/ts-minimal-agent-kernel/spec.md`
- `openspec/designs/architecture/ts-backend-architecture.md`
- `openspec/designs/architecture/task-channel-api-surface.md`
- `openspec/designs/architecture/task-async-callback.md`
- `openspec/designs/modules/agent-channel-task.md`
- `openspec/designs/spec-to-design-map.md`

验证入口：`openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。
- **修改** idempotencyKey 差异化：Create 可选，Edit 必填，Answer 可选；缺失时 channel 内部生成 UUID 作为 runtime idempotency key。Query 为只读接口，不需要 idempotencyKey。
- **修改** create 不接受 `sessionId`：channel 总是自动创建新 session，task 与 session 1:1。`sessionId` 不对外部消费方开放传入。edit/retry/cancel/query/answer 的 `sessionId` 用于定位已有 task 所属 session，逻辑不变。
- **新增** channel 创建 session 后 submit 失败时 best-effort 清理 session：Task Channel stream-task create、async-tasks create 和 Web Channel convenience submit 在 `RuntimeCommandPort.submit` 失败时，MUST 调用 `RuntimeSessionPort.deleteSession` 清理本次新建的 session；仅限本次新建的 session，不清理 caller 提供的已有 session；deleteSession 失败不掩盖原始错误