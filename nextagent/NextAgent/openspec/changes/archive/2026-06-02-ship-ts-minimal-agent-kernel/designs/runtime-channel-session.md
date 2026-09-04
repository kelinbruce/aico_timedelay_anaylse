# Runtime、Channel、Session 设计

## 范围

本分册定义最小内核中 `agent-runtime`、`agent-channel-web`、`agent-session` 和 gateway persistence 的协作。它只覆盖已确认最小 Web route table、TS convenience submit、SSE stream、history、RequestRun、timeline、terminal commit、内部 cancellation propagation 和最小并发正确性，不覆盖完整 cancel/retry/edit、WebSocket、断连恢复完整 replay、多实例接管或容量/SLA benchmark。

## 主流程

```text
HTTP submit / session create
  -> agent-channel-web
    -> runtime session/request facade
      -> runtime-owned Agent scope resolution
      -> agent-session create/load owner-scoped and agent-scoped session
      -> AgentAssemblyRegistry.active(agentId)
      -> SessionStoreGateway load with owner + agent scope
      -> ActiveContextStoreGateway initialize/load active context state
    -> RuntimeCommandPort.submit
      -> RequestRunStoreGateway.saveRun(ACCEPTED)
      -> RunTimelineEventPort.emit(REQUEST_ACCEPTED)
      -> SessionMessageStoreGateway.appendSessionMessage(user)
      -> runtime single-run dispatcher executes Agent.execute(run, context, timeline, messages, signal)
      -> Agent emits runtime events through timeline and appends execution messages through RunMessagePort
      -> runtime terminal commit
  -> SSE stream reads RuntimeEventStreamPort.stream(sessionId, lastSeenSequence, requestId?, runId?)
  -> history asks runtime session facade, which reads through agent-session and gateway
```

## Runtime 责任

- 解析可信 `IdentityContext` 中的 `tenantId`、`subjectId`，并把 owner scope 传入所有 gateway query/write。
- Runtime 内部拥有 Agent Scope 解析。当前 single hosted Agent 产品路径由 app composition 注入 active hosted Agent selection；后续 multi hosted Agent 可替换为可信 host/path/auth selection。该 resolver 是 runtime 内部实现，不进入 `agent-contracts` public contract；`agentId` 不得来自 Web request body、client metadata、模型输出或 capability 参数。
- Runtime 暴露 channel-facing session facade，用于创建 session、列出 session、读取 conversation 和校验已有 session。`agent-channel-web` 不直接依赖或调用 `agent-session`，也不自定义 session port。
- Runtime 在 session facade 中解析 trusted `agentId`，并委托 `agent-session` 的领域 `UserSessionPort` 完成 `UserSession` 与 gateway Record 的映射。所有 session/message/active-context gateway query/write 必须同时携带 `tenantId`、`subjectId` 和 `agentId`。
- 接收的 `RuntimeCommandPort.submit` command 必须已经携带核心契约必填的 `sessionId`；Runtime 不定义无 sessionId 的 submit command 变体。
- 对同一 owner-scoped and agent-scoped session 的 submit 保证最多一个 active `RequestRun`；已有 active run 时，新 submit 必须返回 safe conflict/rejection，不创建 queued run，不引入 FIFO lane、scheduler queue、replacement 或 terminal-pending dispatch protection，不能交叉写入 timeline、history 或 active context。
- 调用 `AgentAssemblyRegistry.active(agentId)` 解析 active assembly，并把 resolved assembly identity 固化到 `RequestRun` 和 `RequestContext`。
- 持久化 `RequestRun` 后发布 `REQUEST_ACCEPTED` canonical timeline event；简单 gateway 写入使用 `Record + write options` 携带 `idempotencyKey`，`TerminalCommitRequest` 必须携带核心契约要求的 `idempotencyKey`，并在 terminal commit 使用 `expectedVersion`。
- 创建只包含恢复坐标的 `RequestContext`，不写入 `attempt`、`deadlineAt` 或 `messageRefs`。
- 通过 runtime single-run dispatcher/scheduler 调度 `Agent.execute(run, context, timeline, messages, signal)`；dispatcher 只处理已持久化、assembly 已固化且未进入 terminal 的 accepted run，启动前必须用 `RequestRunRecord + { expectedVersion }` 将同一 run 从 `status=ACCEPTED` CAS 推进到 `status=EXECUTING`，CAS 未更新时不得调用 Agent。
- Dispatcher 必须向 Agent 传入 authoritative `RequestRun`、`RequestContext`、runtime-owned timeline wrapper、runtime-owned message append port 和 runtime-owned `AbortSignal`；Agent resolve 后进入 terminal commit，Agent reject、timeout 或 internal abort 进入 safe failure normalization 和 terminal commit。
- 包装 `RunTimelineEventPort`，在事件 canonical 化前填充或覆盖 `eventId`、`sessionId`、`runId`、`requestId`、`requestContextId`、`sequence` 和 `createdAt`。
- 实现 `RunMessagePort.appendMessage(run, context, draft)`，用 trusted `RequestRun` 和 `RequestContext` 补齐 owner、agent、session、request、run、timestamp 和 active context 坐标，再调用 gateway composite write 同时写入 session message record、更新 session `updatedAt` 并追加 active context item；core 不直接消费 gateway persistence contract。
- 在本 change 范围内的 Agent resolve/reject 后执行 terminal commit，并发布 runtime-owned terminal lifecycle event；cancel/supersede 由后续 request-control change 接入同一 terminal commit 边界。
- 调用 hook、checkpoint、audit no-op boundary。
- Runtime、core、model、capability 和 stream delivery 慢边界调用必须传递 runtime-owned `AbortSignal`；内部 abort 触发源限定为内部 timeout、server shutdown、测试注入 abort 和 transport disconnect cleanup，并归一化为 safe failure/degradation。Gateway public port 保持 async；当前 gateway-local SQLite local atomic persistence transaction 以一致性为先，不承诺事务中途 abort。本 change 不暴露用户 cancel route，不新增 cancel runtime command，不持久化 user-canceled terminal state，也不投影 `REQUEST_CANCELED`。

Runtime 不负责业务语义路由、prompt shaping、provider SDK 调用、文件读取实现或 Web transport。

## Session 和 Gateway 责任

`agent-session` 负责 `UserSession`、conversation 领域 read model 和 gateway record 之间的映射。gateway ports 只接收 gateway-owned record/query，不返回上层领域对象，也不接收或返回 Web public DTO alias。Web channel 不直接调用 `agent-session`；Runtime session facade 在解析 trusted Agent Scope 后调用 `agent-session` 创建、校验和读取 owner-scoped and agent-scoped session。

`agent-contracts/session` 必须定义领域 `UserSessionPort` 和领域对象，不定义 Web DTO，也不返回 gateway `*Record`。`UserSession` 是 session 本体，必须携带 `tenantId`、`subjectId`、`agentId`、`sessionId`、`title?`、`createdAt` 和 `updatedAt`。`UserSessionPage.entries` 直接使用 `UserSession[]`。`ListUserSessionsQuery`、`ListSessionMessagesQuery` 等领域 query 必须显式携带 trusted `IdentityContext` 和 `agentId`；不得引入 generic `OwnerScope` DTO。

最小内核需要以下 gateway 能力：

- `SessionStoreGateway.loadSession(SessionLookupRequest)` 和 `saveSession(SessionRecord, options?)`：Runtime session facade 创建或使用 owner-scoped and agent-scoped session。`SessionRecord` 和 `SessionLookupRequest` 必须显式携带 `agentId`；session create 使用 `sessions` fact table 上的 `idempotency_key` 返回首次 created session。
- `SessionStoreGateway.listSessions(SessionHistoryRecordQuery)`：history session list，必须 owner-scoped and agent-scoped，query 携带 `tenantId`、`subjectId`、`agentId`、`offset`、`limit`，不得携带 `includeSuperseded`；gateway/internal record 使用 `tenantId`、`subjectId`、`agentId`、`sessionId`、`title?`、`createdAt`、`updatedAt` 等内部字段，不返回 public alias 或 last-message/run-summary 字段，结果按 `updatedAt desc, sessionId asc` 稳定排序；public `entries/offset/limit/hasMore` 和 `displayTitle/lastActivityAt` 只由 channel 投影。
- `SessionMessageStoreGateway.listMessages(ListSessionMessagesRecordQuery)`：visible conversation history，必须 owner-scoped and agent-scoped，query 携带 `tenantId`、`subjectId`、`agentId`、`sessionId`、可选 `requestId`、可选 `locale`、固定 `includeHidden=false`、`includeCapabilityResults`、可选 `beforeCursor`、`limit`；默认返回最近 visible message window，record cursor 使用内部 before-cursor 语义，internal page 返回可选 `nextBeforeCursor`，response items 按 `createdAt asc, messageId asc` 输出；public `cursor`/`nextCursor` 只由 channel 映射和投影。
- `SessionMessageStoreGateway.appendSessionMessage(record, options?)`：模型可见 user、assistant tool-use 和 capability result message 的唯一复合写入口；`record` 是 `SessionMessageRecord`，`options.idempotencyKey` 是 write option，必须 owner-scoped and agent-scoped，写入 message、更新 session `updatedAt` 并追加 active context item。最小内核的 public message store contract 不暴露 standalone `saveMessage(record, options?)`，避免上层绕过 active context 事务。
- `SessionMessageStoreGateway.listCurrentRequestMessages(ListCurrentRequestMessagesRecordQuery)`：当前 request/run 内消息读取，必须携带 tenant、subject、agent、session、requestId、runId、includeHidden、offset、limit。
- `ActiveContextStoreGateway.loadActiveContext(ActiveContextLookupRequest)`：Context Engine 读取模型可见消息序列，必须 owner-scoped and agent-scoped。
- `ActiveContextStoreGateway.appendItem(AppendActiveContextItemRequest)`：保留为 gateway-level active context CAS primitive，并使用 `expectedActiveContextVersion` 防冲突；runtime 主路径不得用 `saveMessage` 后再手动 `appendItem` 表达模型可见 message append。新建 session 必须初始化可追加的 active context state。
- `RequestRunStoreGateway`：accepted run create 使用 `idempotencyKey` 锚定在 `request_runs`；executing、terminal pending 和 diagnostic failure 是同一 run fact 的 version CAS transition，只使用 `expectedVersion`。
- `RunTimelineEventStoreGateway`：使用 `idempotencyKey` 追加 canonical timeline，按 sessionId 和 afterSequence 查询。
- `CheckpointStoreGateway.saveCheckpoint`：主流程 checkpoint save 调用点，默认 no-op 成功且无产品副作用。

SQLite gateway-local 必须用专用事实表实现上述能力，不得用 generic business record store 作为主路径事实底座。幂等 key 默认保存在锚点事实表上，且 scoped uniqueness 必须由 trusted owner scope、agent scope 和相关 session/request/run 坐标组成。session create 的锚点是 `sessions`，accepted run create 的锚点是 `request_runs`，message append 的锚点是 `messages`，timeline append 的锚点是 `timeline_events`，checkpoint save 的锚点是 `checkpoints`，terminal commit 的锚点是 `request_runs` terminal state。RequestRun 的 executing、terminal pending 和 diagnostic failure 更新是同一 run fact 的 version CAS transition，不声明独立 idempotency key。message append 是复合写入：message、session `updatedAt` 和 active context item 必须由 `SessionMessageStoreGateway.appendSessionMessage` 在一个 SQLite transaction 内完成；重复 key 通过 `messages` anchor fact 和 active-context uniqueness 保证不重复 side effect，并且在已有 message anchor 但 active context item 缺失时允许重试补齐 active context。`idempotencyKey` 属于 command/write option，不能进入 `SessionRecord`、`SessionMessageRecord`、`RunTimelineEventRecord`、`CheckpointRecord` 或其它 gateway `*Record`；同形的 `record + idempotencyKey` 不得新增专用 request wrapper。gateway contract 可用 `OwnerScoped` 复用 `tenantId/subjectId` 字段，但不得让 `*Record` 继承名为 `*Request` 的接口。DO 和 Record 共用的 durable scalar vocabulary 归 `agent-common`；gateway 不定义 `SessionMessageRecordRole`、`AttachmentMediaRecordType` 或 `PendingInputRecordKind` 这类副本，也不依赖 session/runtime/attachment contract subpath 来复用这些 vocabulary。

以上 gateway 查询、stream/list 和写入接口必须是 async contract。当前 gateway-local 只有 SQLite local atomic persistence transaction，以一致性为先，不承诺事务中途 abort；远程、长耗时或可取消的 Gateway cancellation deferred。

Session history 的权威来源是 visible `SessionMessage` records；timeline 只用于执行事实、stream 和 replay，不重建最终 conversation history。

## Web Channel 责任

`agent-channel-web` 使用 Fastify adapter 实现：

- `agent-channel-web` 独占 public Web DTO compatibility projection/normalization：将内部 `title?`/`updatedAt` 投影为 `displayTitle`/`lastActivityAt`，将 public conversation `cursor`/`nextCursor` 映射到/来自内部 `beforeCursor`/`nextBeforeCursor`，并将 public 空 `attachments?: []` 映射为核心 `attachmentIds=[]`。这些 public alias 不得传入 runtime、session、core 或 gateway boundary。
- `GET /api/v1/sessions`：通过 runtime session facade 读取 owner-scoped and agent-scoped session list，query 只允许 `offset?` 和 `limit?`，稳定排序 `updatedAt desc, sessionId asc`；response 为 `entries/offset/limit/hasMore`，entry 只包含 `sessionId/displayTitle/lastActivityAt`，不返回 owner、agent、`includeSuperseded`、cursor、运行状态摘要、stream/ws path 或 conversation。
- `POST /api/v1/sessions`：通过 runtime session facade 创建新的 owner-scoped and agent-scoped 空 session 并初始化 active context state，不提交 request、不调用 Agent core/model；不打开既有 session；request body 只允许 `locale?`，owner scope 只来自可信 identity boundary，Agent scope 只来自 runtime internal resolver；请求体中的 `sessionId`、`idempotencyKey`、owner 字段、agent 字段、title、status、deploymentMode、channel、metadata、stream/ws path 或其他 session detail 字段必须 schema validation failed；channel 必须生成安全 server-side idempotency key 后交给 runtime session facade；重复 scoped server-side/internal key 返回首次 created session；成功响应只返回与 session list entry 相同字段集的安全 metadata：`sessionId/displayTitle/lastActivityAt`，不返回 stream/ws path、conversation、request accepted fields、cursor 或 timeline sequence。
- `POST /api/v1/sessions/{sessionId}/requests`：session-scoped submit route。
- `POST /api/v1/requests`：TS convenience submit route；payload 可无 `sessionId`。
- `GET /api/v1/sessions/{sessionId}/stream`：SSE stream route。
- `GET /api/v1/sessions/{sessionId}/conversation`：conversation history route，默认最近 window，使用 public `cursor` 加载更早记录，并返回 `nextCursor`。
- submit payload 未带 `sessionId` 时先调用 runtime session facade 创建 owner-scoped and agent-scoped session；该 child session create command 可以从 submit `idempotencyKey` 派生 server-side idempotency key，保证重复 convenience submit 返回首次 accepted run 且不会泄漏额外空 session。携带 `sessionId` 时由 runtime 通过 `agent-session` 和 gateway 按 owner + agent scope 校验归属。
- submit request body 要求 non-blank `inputText` 和 `idempotencyKey`，可携带 `locale?` 和 `attachments?: []`；public `attachments?: []` 在本 change 中语义为 empty attachment id refs，并映射为核心 `attachmentIds=[]`；convenience submit 可额外携带 `sessionId?`；客户端提供的 `requestId`、`language`、`submittedAt`、owner 字段、metadata 或其他 non-minimal envelope 字段必须 schema validation failed。
- 本 change 的 submit schema 可接收空 `attachments?: []`；`attachmentIds` 字段、非空附件数组、附件对象或 upload refs 必须 schema validation failed；构造 `RuntimeCommandPort.submit` 时 `attachmentIds` 固定为空数组，附件 intake 由后续 change 接入。
- `GET` SSE stream：解析 `sessionId`、`lastSeenSequence` 和可选 `requestId/runId` filter，调用 `RuntimeEventStreamPort.stream` 并投影为 public `StreamEnvelope`。
- history routes：调用 runtime session facade；runtime 再调用 `agent-session` 将领域 query 映射为 gateway record query，补齐 owner scope、agent scope、cursor/page 参数和 include 标志。Channel 禁止直接调用 `agent-session` 或 store driver，禁止自定义 session port。
- route registry 不得暴露 WebSocket、user-input、cancel、retry、edit、attachment upload/download、title 或 feedback route 作为本 change 产品行为。
- route registry 不得暴露 `GET /api/v1/sessions/{sessionId}`；open/resume existing session handle 语义不进入本 change。

`RequestAccepted` 响应只包含 `sessionId`、`requestId`、`runId`、`attempt`。`streamPath`、`createdSession`、accepted sequence、stream cursor 和 timeline sequence 不出现在 accepted response 中。若同 session 已有 active run，本 change 返回 safe conflict/rejection，不返回 accepted DTO，不创建 `QUEUED` 事实；提交后首次 stream 使用 `lastSeenSequence=0`，或客户端复用自有 session cursor。

## Stream Projection

Channel 投影规则只从 canonical timeline 到 `StreamEnvelope`：

- `REQUEST_ACCEPTED` -> `REQUEST_ACCEPTED`
- `LLM_THINKING_DELTA` -> `LLM_THINKING_DELTA`
- `LLM_CONTENT_DELTA` -> `LLM_CONTENT_DELTA`
- `CAPABILITY_STARTED` -> `CAPABILITY_STARTED`
- `CAPABILITY_RESULT_DELTA` -> `CAPABILITY_RESULT_DELTA`
- `CAPABILITY_COMPLETED` -> `CAPABILITY_COMPLETED`
- terminal runtime events -> 对应 terminal stream event

Stream event name 必须使用 shared canonical `StreamEventType` vocabulary。未实现的 cancel/supersede/pending-input 事件即使 enum 存在，也不得由本 change 产品路径产生。

未进入首版 `StreamEventType` 的 timeline-only event 不投影给普通对话流。

## Terminal Commit

Terminal commit 的唯一实现路径：

1. Runtime 根据 Agent execution outcome 选择 terminal type。
2. Runtime 读取 Agent 通过 timeline 发布的 final agent message fact，构造 terminal assistant message 或 safe failure message。
3. Runtime 在写入前应用输出大小/长度 guard；除 read capability line-based bounded slice 已显式携带 `truncated=true`/`nextOffset` 外，模型 delta、capability result message 或 terminal assistant message 命中硬安全上限时必须构造 `DEGRADATION_NOTICE` 和 safe failure terminal message，不能静默截断。
4. Runtime 在 durable terminal commit 前用 `RequestRunRecord + { expectedVersion }` 将 `RequestRun.terminalCommitState` 置为 `PENDING`；这是本 change 要持久化和测试的主路径状态，不是 no-op。
5. Runtime 通过 terminal commit gateway contract 以 version check/idempotency key 在一个 gateway transaction 内写入 terminal message、active context item、terminal timeline event 和 `RequestRun` terminal state；成功结果必须进入 `terminalCommitState=COMMITTED`。
6. 写入成功后 channel-visible stream 才能读取到 `REQUEST_COMPLETED` 或 `REQUEST_FAILED` terminal event。
7. active-run guard 的释放或后续状态推进只依据 successful terminal commit result。

任何重复 terminal commit 必须返回 already committed、version conflict 或 safe failure，不得产生第二个 visible terminal message。terminal durable commit 失败时不得发布 completed/failed final stream event；若已进入 `PENDING`，runtime 必须尝试把 terminal commit state 更新为内部 `FAILED`，该更新本身失败时保留 `PENDING` 作为可诊断状态；这两种状态都不是用户可见终态。自动 terminal commit retry/recovery 和多实例 takeover 由既有 `add-ts-local-runtime-recovery` / `add-ts-runtime-recovery-idempotency-guard` 计划承接，本 change 只保留可恢复所需事实和状态。

## Deferred

- WebSocket。
- 断连恢复完整 replay gap 策略。
- cancel/retry/edit 完整用户能力。
- 多实例 lease、fencing takeover 和真实 checkpoint recovery。
- attachment-aware request acceptance。
- 容量/SLA benchmark。
