# ts-minimal-agent-kernel Specification

## Purpose
Defines the stable minimum TypeScript Agent kernel: Web submit, SSE streaming, session/history reads, runtime lifecycle, trusted Agent Scope, gateway persistence, OpenAI model invocation, capability boundary, observability hooks and verification gates needed for one production-path question-answer flow.
## Requirements
### Requirement: 最小问答主流程
TS 后端 SHALL 提供一个基于核心契约的最小 Agent 问答内核，使用户通过 Web 入口提交一个问题后，系统能够创建或使用会话、用核心契约的 submit command 接受 request、执行 Agent、调用模型、发布流式输出、提交唯一终态，并通过 history 读取一致结果。该主流程不得使用测试 provider、mock Agent 或 no-op core 替代真实问答执行路径。

#### Scenario: 用户完成一次最小问答
- **WHEN** 已配置默认 Agent assembly、真实 model provider profile、可用 session gateway 和 Web channel 的用户提交一条合法问题
- **THEN** Web channel MUST 返回 accepted response
- **AND** Runtime MUST 基于携带 `sessionId` 的 `RuntimeCommandPort.submit` command 创建或推进一个 `RequestRun`
- **AND** Agent core MUST 至少完成一次 context render 和 model invocation
- **AND** 用户 MUST 能通过 SSE stream 看到模型输出和 terminal stream event
- **AND** history MUST 能读取到该用户问题和最终 assistant message

#### Scenario: 创建或使用会话
- **WHEN** 客户端调用 `POST /api/v1/sessions`
- **THEN** Web channel MUST call the runtime session facade
- **AND** Runtime MUST resolve trusted Agent Scope through its internal resolver before delegating to `agent-session`
- **AND** Runtime MUST 委托 `agent-session` 创建 owner-scoped and agent-scoped empty `UserSession` and initialize appendable active context state
- **AND** 该 route MUST NOT 提交 request、触发 Agent core 或调用 model
- **AND** request body MUST only allow `locale?`
- **AND** `tenantId` and `subjectId` MUST come only from trusted identity boundary
- **AND** `agentId` MUST come only from Runtime internal Agent Scope resolver
- **AND** request body containing `sessionId`、`idempotencyKey`、owner fields、agent fields、title、status、deploymentMode、channel、metadata、stream path、websocket path 或其他 session detail fields MUST fail schema validation
- **AND** Web channel MUST generate a safe server-side idempotency key before session write
- **AND** repeated owner-scoped and agent-scoped session create with the same server-side/internal `idempotencyKey` MUST return the first created session and MUST NOT create a second session
- **AND** 成功响应 MUST 只返回与 session list entry 相同字段集的安全 metadata: `sessionId`、`displayTitle` and `lastActivityAt`
- **AND** create-session response metadata MUST contain only `sessionId`、`displayTitle` and `lastActivityAt`
- **AND** 成功响应 MUST NOT 返回 `streamPath`、`websocketPath`、conversation messages、request accepted fields、cursor 或 timeline sequence
- **WHEN** 客户端调用 `POST /api/v1/requests` 且 payload 未携带 `sessionId`
- **THEN** Web channel MUST call the runtime session facade to create an owner-scoped and agent-scoped session, then use the created `sessionId` to construct `RuntimeCommandPort.submit` command
- **AND** the child session create command MAY derive its server-side idempotency key from the submit `idempotencyKey` so repeated convenience submit returns the first accepted run without leaking extra empty sessions
- **WHEN** 合法 Web submit path 或 payload 携带 `sessionId`
- **THEN** Runtime MUST 通过 owner-scoped and agent-scoped session lookup 校验该 session 属于当前 trusted `tenantId`、`subjectId` and `agentId`
- **AND** Runtime 接收的 `RuntimeCommandPort.submit` command MUST 始终携带核心契约必填的 `sessionId`
- **AND** 该 `sessionId` MUST 写入 accepted response、`RequestRun`、user message、timeline 和后续 history query
- **AND** 跨 owner、跨 agent、缺失或不可用 session MUST 返回 safe not-found outcome and MUST NOT reveal whether the session exists under another owner or agent

#### Scenario: 同 session 并发 submit 不串写
- **WHEN** 两个合法 submit 同时进入同一个 owner-scoped and agent-scoped session
- **THEN** Runtime MUST guarantee at most one active `RequestRun` for the same owner+agent scoped session
- **AND** if an active run already exists for that session, the later submit MUST return a safe conflict/rejection
- **AND** this change MUST NOT create queued run facts, FIFO lane scheduling, replacement behavior, or terminal-pending dispatch protection
- **AND** 两个 submit MUST NOT 交叉写入彼此的 `requestId`、`runId`、timeline sequence、visible history 或 active context item
- **WHEN** 两个合法 submit 进入不同 owner-scoped or agent-scoped sessions
- **THEN** 系统 MUST NOT 串写 session、request、run、timeline 或 history 标识

#### Scenario: 测试替身不能替代产品路径
- **WHEN** 最小内核在产品 app composition 中启动
- **THEN** 测试 provider、mock Agent 或内存-only fake gateway MUST NOT 被作为唯一产品实现装配
- **AND** 测试替身只能通过 test fixture 或 test composition 显式注入

#### Scenario: Gateway-local uses dedicated fact tables and anchor idempotency
- **WHEN** SQLite gateway-local persists main-path runtime facts
- **THEN** it MUST use dedicated business tables for request runs、sessions、messages、active context state/items、timeline events and checkpoints
- **AND** it MUST NOT use a generic business record table such as `records(store,key,json)` to carry main-path persisted facts
- **AND** every idempotent write MUST define an anchor fact table and store `idempotencyKey` on that anchor table by default
- **AND** the scoped uniqueness for `idempotencyKey` MUST be built from trusted owner scope and the relevant agent/session/request/run coordinates
- **AND** duplicate scoped `idempotencyKey` writes MUST return the first anchor fact result and MUST NOT repeat side effects
- **AND** session create MUST anchor idempotency on the `sessions` fact table
- **AND** accepted request run create MUST anchor idempotency on the `request_runs` fact table
- **AND** RequestRun state updates such as executing, terminal pending and diagnostic failure MUST be modeled as version CAS transitions and MUST NOT use unanchored pseudo idempotency operation keys
- **AND** composite writes such as message append plus active context update MUST be exposed as one gateway write and complete in a single SQLite transaction
- **AND** `SessionMessageStoreGateway` MUST expose `appendSessionMessage(record, options?)` as the only public message write contract for the minimal kernel and MUST NOT expose a standalone `saveMessage(record, options?)` contract
- **AND** message append duplicates MUST be retry-safe through the same `messages` anchor fact and active-context uniqueness constraints, including the case where the message anchor exists but the active context item is missing
- **AND** persistence MUST NOT introduce a synthetic `operationKind` field when the domain fact does not contain it
- **AND** this change MUST NOT add request payload hash conflict detection; same scoped `idempotencyKey` returns the first result in this change
- **AND** an independent idempotency table/store is allowed only when an operation has no clear anchor fact table, and that exception MUST be documented in this change before implementation

### Requirement: Runtime 接受请求并固化 Agent Assembly
Runtime SHALL own trusted Agent Scope resolution for session and request admission. Runtime SHALL 在 request acceptance 阶段解析 runtime-ready Agent assembly，并将 resolved `agentId`、`agentVersion` 和 `agentAssemblyRef` 固化到 `RequestRun` 和 `RequestContext`。请求被接受后，core、context、capability routing 和 recovery 路径 SHALL 读取同一个 assembly version，不得重新按 active version 选择。

#### Scenario: Runtime 内部解析 Agent Scope
- **WHEN** Web channel calls runtime session or submit boundaries
- **THEN** Runtime MUST resolve `agentId` through a trusted internal resolver provided by app composition
- **AND** the resolver MUST NOT be exposed as an `agent-contracts` public port
- **AND** client request body、client metadata、model output and capability arguments MUST NOT provide or override `agentId`
- **AND** current single hosted Agent product path MAY resolve the configured active hosted Agent id
- **AND** future multi hosted Agent selection MUST plug into the same runtime-owned resolver shape without making channel own Agent routing

#### Scenario: 接受请求时解析 active assembly
- **WHEN** Runtime 接受一个不携带已解析 Agent version 的 submit command
- **THEN** Runtime MUST 调用 `agent-contracts/agent-assembly` 的 `AgentAssemblyRegistry.active(agentId)` 解析当前 active assembly
- **AND** Runtime MUST 将 resolved `agentId`、`agentVersion` 和 `agentAssemblyRef` 持久化或记录到 `RequestRun` 和 `RequestContext`
- **AND** missing active assembly MUST produce a safe unavailable error and MUST NOT fallback to an implicit default Agent
- **AND** Runtime MUST NOT fallback 到隐式默认 Agent

#### Scenario: 已接受请求使用固定 assembly
- **WHEN** 已接受 request 进入 Agent core、Context Engine、Capability routing 或 recovery 路径
- **THEN** 调用方 MUST 通过 `agent-contracts/agent-assembly` 的 `AgentAssemblyRegistry.require(agentId, agentVersion)` 获取 assembly 或消费 runtime 传入的 accepted assembly facts
- **AND** active version selection MUST NOT 再用于该 request
- **AND** 后续 active assembly 变化 MUST NOT 影响该 request 的执行和恢复

#### Scenario: Session facts bind owner and agent scope
- **WHEN** Runtime creates, requires, lists or reads conversation for a session
- **THEN** Runtime MUST call `agent-session` through a domain `UserSessionPort`
- **AND** `UserSessionPort` inputs MUST carry trusted `IdentityContext` and trusted `agentId`
- **AND** returned `UserSession` MUST contain `tenantId`、`subjectId`、`agentId`、`sessionId`、optional `title`、`createdAt` and `updatedAt`
- **AND** `UserSessionPort` MUST NOT return gateway `*Record` values or Web DTO aliases
- **AND** gateway session/message/active-context queries and records MUST explicitly carry `agentId` in addition to `tenantId` and `subjectId`
- **AND** session create/list/conversation MUST fail closed for cross-owner or cross-agent access

### Requirement: Agent Core 通过目标执行边界运行
Runtime SHALL construct or provide an Agent with a runtime-owned `AgentRunStatePort` and call `Agent.execute(run, context, signal): Promise<void>`。Agent core SHALL 负责最小请求处理路径、context assembly、model invocation、最小 capability loop、中间执行消息追加和最终 agent message 发布，但 SHALL NOT 拥有 request lifecycle 终态。

#### Scenario: Runtime single-run dispatcher 调度 accepted run
- **WHEN** Runtime has persisted an accepted run with fixed assembly identity
- **THEN** Runtime dispatcher MUST only dispatch a persisted run that has not reached terminal state
- **AND** Runtime dispatcher MUST use `RequestRunRecord + { expectedVersion }` to CAS the run from `status=ACCEPTED` to `status=EXECUTING` before invoking Agent
- **AND** Runtime dispatcher MUST NOT invoke Agent when that CAS update does not update the run
- **AND** Runtime dispatcher MUST NOT dispatch a run whose assembly identity is missing or unresolved
- **AND** Runtime dispatcher MUST NOT create queued run facts, FIFO lane scheduling, replacement behavior, or terminal-pending dispatch protection in this change
- **AND** dispatch failure before `Agent.execute` MUST be normalized as safe failure and enter terminal commit path when a run has been accepted

#### Scenario: Runtime 调用 Agent.execute
- **WHEN** Runtime 将 accepted run 调度到执行阶段
- **THEN** Runtime MUST construct or provide an Agent with a runtime-owned `AgentRunStatePort`
- **AND** Runtime MUST 调用 `Agent.execute(run, context, signal)`
- **AND** `run` MUST 是 authoritative `RequestRun`
- **AND** `signal` MUST 是 runtime-owned `AbortSignal`
- **AND** Agent.execute MUST NOT receive timeline or message ports as execute-time parameters
- **AND** the runtime-owned `AgentRunStatePort` MUST stamp trusted run/context coordinates before writing timeline events, session messages or checkpoints
- **AND** Agent.execute 正常 resolve MUST 表示 Agent 主体执行完成
- **AND** Agent.execute reject MUST 由 Runtime 归一化为 request failure path

#### Scenario: Agent 通过 runtime-owned run state 发布事实
- **WHEN** Agent 产生 planning、model delta、capability lifecycle、capability result 或 final agent message
- **THEN** Agent MUST 调用 `AgentRunStatePort.emitEvent(run, context, event): Promise<void>`
- **AND** Runtime MUST 填充或覆盖 runtime-owned timeline 字段后才使事件成为 canonical
- **AND** Agent MUST NOT 发布 `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED`

### Requirement: Web Submit Stream And History
TS Web channel SHALL expose the minimal session/create/list/conversation/submit/stream path through runtime-owned boundaries. Web channel SHALL own HTTP/SSE/WebSocket transport schema and public DTO projection, but SHALL NOT own request lifecycle, canonical timeline replay truth, session history source, or runtime terminal state.

#### Scenario: Web route table 与最小范围一致
- **WHEN** Web channel registers product routes
- **THEN** route registry MUST expose `POST /api/v1/sessions`
- **AND** route registry MUST expose `GET /api/v1/sessions`
- **AND** route registry MUST expose `GET /api/v1/sessions/{sessionId}/conversation`
- **AND** route registry MUST expose `GET /api/v1/sessions/{sessionId}/conversation/preview`
- **AND** route registry MUST expose `POST /api/v1/sessions/{sessionId}/requests`
- **AND** route registry MUST expose `GET /api/v1/sessions/{sessionId}/stream`
- **AND** route registry MUST expose TS convenience submit `POST /api/v1/requests`
- **AND** route registry MUST expose `PUT /api/v1/sessions/{sessionId}/title`
- **AND** route registry MUST NOT expose `GET /api/v1/sessions/{sessionId}` in this change
- **AND** route registry MUST NOT expose global `GET /api/v1/search`, `GET /api/v1/sessions/search`, or `GET /api/v1/sessions/{sessionId}/conversation/search` in this change
- **AND** route registry MUST NOT expose WebSocket, user-input, cancel, retry, edit, attachment upload/download, or feedback routes as product behavior in the minimal kernel scope unless another active spec explicitly owns them

#### Scenario: Submit 返回最小 accepted response
- **WHEN** Web channel accepts a legal submit request
- **THEN** channel MUST inject trusted identity from the auth/channel boundary
- **AND** channel MUST call runtime session/request boundaries and MUST NOT call `agent-session` directly
- **AND** channel MUST NOT define a channel-owned session abstraction
- **AND** channel MUST call Runtime command boundary
- **AND** `RuntimeCommandPort.submit` command MUST carry `sessionId`
- **AND** session-scoped submit request body MUST require non-blank `inputText` and `idempotencyKey`
- **AND** submit request body MAY include `locale?`、`attachments?: []`，以及 `modelOptions?: { thinking?: { depth?: "OFF" } }`
- **AND** public `attachments?: []` in this requirement MUST mean empty attachment id refs and MUST be mapped to core `attachmentIds=[]`
- **AND** `agent-channel-web` MUST be the only boundary that accepts the public `attachments?: []` compatibility field
- **AND** `agent-runtime`, `agent-session`, `agent-core`, and gateway ports MUST NOT receive `attachments`; channel MUST normalize it to core `attachmentIds=[]` before calling Runtime command boundary
- **AND** channel MUST normalize `modelOptions` to runtime-owned typed `requestModelOptions` before calling Runtime command boundary
- **AND** TS convenience submit request body MAY include `sessionId?` in addition to the same submit fields
- **AND** submit request body containing client-provided `requestId`, `language`, `submittedAt`, owner fields, agent fields, metadata, or other non-minimal envelope fields MUST fail schema validation
- **AND** `attachmentIds` field, non-empty `attachments`, attachment object, upload ref, or attachment metadata MUST fail runtime schema validation
- **AND** `modelOptions` containing `temperature`、`topP`、`maxOutputTokens`、non-`OFF` thinking depth、provider-private reasoning object or any unknown field MUST fail schema validation
- **AND** in this requirement `RuntimeCommandPort.submit` command `attachmentIds` MUST be an empty array
- **AND** Runtime persistence for `RequestRun`, session message, active context item, timeline event, and terminal commit MUST use core contract defined `idempotencyKey`, `expectedVersion`, or `expectedActiveContextVersion`
- **AND** accepted response MUST return only `sessionId`, `requestId`, `runId`, and `attempt`
- **AND** `POST /api/v1/requests` and `POST /api/v1/sessions/{sessionId}/requests` MUST return the same accepted DTO on success
- **AND** accepted response MUST NOT return `streamPath`, `createdSession`, stream cursor, `acceptedSequence`, or timeline sequence fields

#### Scenario: SSE 从 runtime session-facing stream facade 投影
- **WHEN** a client opens SSE stream for a visible session
- **THEN** channel MUST call `RuntimeSessionPort.streamEvents({ identityContext, sessionId, lastSeenSequence?, requestId?, runId?, signal? })`
- **AND** channel MUST pass `lastSeenSequence` only when the client explicitly provides the query parameter
- **AND** frontend product paths MUST explicitly provide `lastSeenSequence` only for a verified in-memory cursor, activeRun bootstrap, accepted-run bounded recovery, or intentional explicit replay
- **AND** cold-start product paths for refresh, new tab, new device, or ordinary session switch MUST load conversation bootstrap before opening an ordinary session-level stream
- **AND** channel MUST NOT synthesize `lastSeenSequence=0` when a session-scoped stream omits the query parameter
- **AND** omitted `lastSeenSequence` with no `requestId/runId` MUST be treated as session live-tail rather than replay from the beginning
- **AND** optional `requestId/runId` MUST only be filters and MUST NOT reset session-scoped sequence
- **AND** channel MUST project runtime events to public `StreamEnvelope` rather than exposing runtime timeline records as Web DTOs
- **AND** stream event name MUST match shared canonical `StreamEventType` vocabulary
- **AND** minimal projectable subset MUST include `REQUEST_ACCEPTED`, `LLM_THINKING_DELTA`, `LLM_CONTENT_DELTA`, `CAPABILITY_STARTED`, `CAPABILITY_RESULT_DELTA`, `CAPABILITY_COMPLETED`, `REQUEST_COMPLETED`, `REQUEST_FAILED`, and `DEGRADATION_NOTICE`
- **AND** unimplemented capability-related `REQUEST_CANCELED`, `REQUEST_SUPERSEDED`, `USER_INPUT_REQUIRED`, `USER_INPUT_RECEIVED`, `USER_INPUT_TIMEOUT`, and `USER_INPUT_CANCELED` MUST NOT be produced by product path unless an owning spec enables them
- **AND** channel MUST NOT fabricate execution facts that conflict with runtime timeline
- **AND** channel MUST NOT call lower-level timeline stores or a channel-owned replay buffer as the source of replay truth
- **AND** WebSocket transport equivalence is owned by `ts-web-sse-ws-transports` and MUST enter the same runtime session-facing stream path

#### Scenario: Conversation bootstrap exposes activeRun for refresh and new devices
- **WHEN** a client reads `GET /api/v1/sessions/{sessionId}/conversation`
- **THEN** the response MAY include top-level `activeRun`
- **AND** `activeRun`, when present, MUST contain only `requestId`, `runId`, and `status`
- **AND** `activeRun` MUST come from runtime session-facing `getActiveRun`
- **AND** Web channel MUST NOT infer `activeRun` from visible conversation messages
- **AND** frontend cold-start bootstrap MUST use conversation as the initial history source before opening ordinary no-cursor live-tail
- **AND** after ordinary no-cursor live-tail is established, frontend MUST perform one opening conversation reconcile to cover committed messages or activeRun state that appeared between the initial conversation snapshot and the live-tail boundary

#### Scenario: History 通过 runtime session facade 读取
- **WHEN** client reads session list, conversation history, or conversation preview
- **THEN** channel MUST call runtime session facade
- **AND** runtime MUST resolve trusted `agentId` and call `agent-session` `UserSessionPort`
- **AND** `agent-session` MUST map domain `ListUserSessionsQuery` to gateway-owned `SessionHistoryRecordQuery` before calling `SessionStoreGateway.listSessions(...)`
- **AND** `agent-session` MUST map domain `ListSessionMessagesQuery` to gateway-owned `ListSessionMessagesRecordQuery` before calling `SessionMessageStoreGateway.listMessages(...)`
- **AND** `agent-session` MUST map domain conversation preview/query to gateway-owned message-store query before calling gateway
- **AND** public `GET /api/v1/sessions` query MUST allow only `offset?`, `limit?`, `q?`, `createdFrom?`, and `createdTo?`
- **AND** non-empty `q.trim()` MUST be mapped by `agent-channel-web` to canonical `questionSearchText` before runtime/session/gateway contracts are called only when it is at most 50 Unicode code points
- **AND** omitted `q` or trim-empty `q` MUST NOT produce `questionSearchText` in runtime/session/gateway contracts
- **AND** `q.trim()` with length greater than 50 Unicode code points MUST fail Web API validation before runtime/session/gateway contracts are called
- **AND** `createdFrom` and `createdTo` MUST be mapped by `agent-channel-web` to canonical `createdAtFrom` and `createdAtTo` before runtime/session/gateway contracts are called only when both are present, `createdFrom <= createdTo`, and their epoch millis span does not exceed 90 days minus 1 millisecond
- **AND** invalid or partial `createdFrom/createdTo` ranges MUST fail Web API validation before runtime/session/gateway contracts are called
- **AND** when neither a legal trim-non-empty `q` nor a complete `createdFrom/createdTo` range is present, the pre-existing session-list default limit behavior MUST be preserved
- **AND** when a legal trim-non-empty `q` or a complete `createdFrom/createdTo` range is present and `limit` is omitted, the search list page size MUST default to 20
- **AND** search queries MUST reject `limit` values greater than 50
- **AND** `SessionHistoryRecordQuery` MUST carry trusted `tenantId`, `subjectId`, `agentId`, `offset`, `limit`, optional `questionSearchText`, and optional `createdAtFrom/createdAtTo`
- **AND** `SessionHistoryRecordQuery` MUST NOT contain `includeSuperseded`
- **AND** session list MUST be stably ordered by `updatedAt desc, sessionId asc`
- **AND** session list response MUST contain `entries`, `offset`, `limit`, and `hasMore`
- **AND** each session list entry MUST contain `sessionId`, `displayTitle`, `lastActivityAt`, and `hasInFlightRequest`
- **AND** each session list entry MAY contain `lastRunStatus`
- **AND** search MUST preserve the existing session list entry response field set rather than adding a search-specific entry DTO or removing existing run-state summary fields
- **AND** session list entry `displayTitle` MUST be projected from internal `title?` or a safe default title
- **AND** session list entry `lastActivityAt` MUST be projected from internal `updatedAt`
- **AND** `agent-channel-web` MUST be the only boundary that exposes public `displayTitle` and `lastActivityAt` compatibility names
- **AND** `agent-session` and gateway/internal contracts MUST use canonical/internal fields such as `title?` and `updatedAt`, and MUST NOT receive or return public session list alias names
- **AND** session list response MUST NOT expose `tenantId`, `subjectId`, `agentId`, `includeSuperseded`, `nextCursor`, `title`, `updatedAt`, `latestRunStatus`, `lastMessagePreview`, `lastRequestStatus`, stream path, websocket path, matched text, highlights, result count, snippets, or conversation messages
- **AND** `ListSessionMessagesRecordQuery` MUST carry `tenantId`, `subjectId`, `agentId`, `sessionId`, optional `requestId`, optional `locale`, fixed `includeHidden=false`, `includeCapabilityResults`, optional `beforeCursor`, optional `afterCursor`, optional `anchorMessageId`, and `limit`
- **AND** conversation history MUST default to latest visible message window
- **AND** conversation response items MUST be ordered by `createdAt asc, messageId asc`
- **AND** public conversation query MUST use `cursor?` as the older-record cursor and map it to internal `beforeCursor`
- **AND** public conversation query MAY use `newerCursor?` to load records newer than the current newest boundary
- **AND** public `newerCursor?` MUST map to internal `afterCursor?`
- **AND** public conversation query MAY use `anchorMessageId?` to load a continuous visible message window containing that message
- **AND** `cursor?`, `newerCursor?`, and `anchorMessageId?` MUST NOT be combined in one request
- **AND** existing public `includeCapabilityResults?` query semantics MUST be preserved for conversation reads, default to `false`, and MAY be combined with latest, older, newer, or anchor reads without changing scope, anchor validation, window continuity, or cursor semantics
- **AND** internal conversation page MUST return optional `nextBeforeCursor` and optional `newerCursor`; channel MUST project `nextBeforeCursor` to public `nextCursor` for compatibility
- **AND** conversation response MUST return `nextCursor` for loading older records and MUST set it to null or omit it when no older records remain
- **AND** conversation response MAY return `newerCursor` for loading newer records and MUST set it to null or omit it when no newer records remain
- **AND** conversation response MUST NOT include `windowMode`
- **AND** conversation response MUST NOT include `anchor`
- **AND** anchored conversation history MUST return one continuous visible message window around the anchor message
- **AND** anchored conversation history MUST NOT stitch a latest window and an earlier window together when messages between them are not loaded
- **AND** stale, hidden, deleted, cross-owner, or cross-agent `anchorMessageId` MUST fail closed and MUST NOT fall back to latest history as if anchor loading succeeded
- **AND** `agent-channel-web` MUST be the only boundary that exposes public `cursor` and `nextCursor` compatibility names
- **AND** `agent-session` and gateway/internal contracts MUST preserve existing `beforeCursor`/`nextBeforeCursor` older-record pagination names, use internal `afterCursor` for newer-record queries, return `newerCursor` for newer-record pagination, and MUST NOT receive or return public conversation older cursor alias names
- **AND** public `GET /api/v1/sessions/{sessionId}/conversation/preview` query MUST require explicit `limit` and MAY accept explicit `offset`
- **AND** public preview query without `offset` MUST return the latest preview marker window and report the actual effective `offset`
- **AND** public preview query MUST reject search, date, cursor, `includeCapabilityResults`, position, or search-total parameters
- **AND** public preview query MUST reject negative `offset`, non-positive `limit`, or `limit` greater than 500
- **AND** conversation preview MUST create markers only from visible USER messages in the requested session under the trusted owner and Agent scope
- **AND** conversation preview response MUST contain only `sessionId`, `totalMarkers`, `offset`, `limit`, and `markers`
- **AND** `totalMarkers` MUST represent the current-session visible USER marker count under the trusted owner and Agent scope
- **AND** each conversation preview marker MUST contain `messageId`, optional `requestId`, `createdAt`, bounded `previewText`, and `previewTruncated`
- **AND** each conversation preview marker MAY contain bounded `answerPreviewText` and `answerPreviewTruncated` only when a visible ASSISTANT message exists for the same request
- **AND** conversation preview MUST server-truncate `previewText` and `answerPreviewText` to at most 300 Unicode code points before the Web response without splitting surrogate pairs
- **AND** conversation preview MUST support sessions with more than 100 visible USER markers through valid `offset` and `limit` pages
- **AND** conversation preview MUST NOT sample markers or return random/partial marker data that does not correspond to the requested page
- **AND** conversation preview response MUST NOT include `markersComplete`, `markerLimit`, highlight, rank, position ratio, tool/Capability result text, hidden content, or conversation items
- **AND** public Web API MUST NOT expose `includeHidden`
- **AND** `includeCapabilityResults` MUST default to `false`
- **AND** history MUST use visible `SessionMessage` records as the final conversation content source
- **AND** Web channel MUST NOT reconstruct final history from stream envelopes, projection cache, or timeline replay

### Requirement: Terminal Consistency And Safe Error
最小内核 SHALL 保证每个 accepted request 产生唯一终态，并保证 terminal stream、RequestRun terminal state 和 visible history 一致。所有跨边界失败 SHALL 被归一化为 SafeError，不得向用户、stream、history、audit 或日志泄漏敏感原始内容。

#### Scenario: 请求产生唯一终态
- **WHEN** 本 change 范围内的 Agent execution 正常完成或失败
- **THEN** Runtime MUST persist or update `RequestRun.terminalCommitState=PENDING` before attempting durable terminal commit
- **AND** Runtime MUST 通过 terminal commit contract 在一个 gateway transaction 内持久化 terminal message、active context item、terminal event 和 RequestRun terminal state
- **AND** terminal commit MUST 同时使用 compare-and-set 和 idempotency key 防止双终态
- **AND** successful terminal commit MUST persist `RequestRun.terminalCommitState=COMMITTED`
- **AND** channel-visible `REQUEST_COMPLETED` 或 `REQUEST_FAILED` terminal stream event MUST only appear after runtime terminal commit succeeds
- **AND** terminal durable commit failure MUST NOT publish completed/failed final stream
- **AND** terminal durable commit failure after `PENDING` MUST attempt to update the run to diagnosable internal `FAILED` terminal commit state
- **AND** if that diagnostic update also fails, the run MUST remain in diagnosable internal `PENDING` terminal commit state
- **AND** diagnosable terminal commit failure state MUST NOT be treated as a user-visible terminal outcome in this change
- **AND** canceled 或 superseded 用户能力不属于本 change 验收范围，不能通过本 change 新增用户可见 control route 或 replacement 行为

#### Scenario: Stream terminal 与 history 一致
- **WHEN** stream 已投影 request terminal event
- **THEN** 后续 history read MUST 能看到与该 terminal event 一致的最终 visible assistant message 或 safe failure outcome
- **AND** stream replay MUST NOT 被作为最终 conversation history 的权威来源

#### Scenario: Safe error 不泄漏敏感内容
- **WHEN** runtime、channel、context、model、capability、gateway、hook、checkpoint 或 audit boundary 返回失败
- **THEN** 对外响应 MUST 使用 SafeError shape
- **AND** SafeError、stream payload、history message 和 audit safe summary MUST NOT 包含 raw prompt、model output、stream delta、raw provider error、tool arguments、tool result、raw credential、token、附件内容或未脱敏路径

#### Scenario: 内部 cancellation 传播但不暴露用户 cancel route
- **WHEN** runtime、core、model、capability 或 timeline stream 慢边界执行
- **THEN** 调用 MUST 使用 async contract and accept `AbortSignal`
- **AND** Gateway public port MUST 使用 async contract
- **AND** 当前 gateway-local SQLite local atomic persistence transaction MUST 以一致性为先，不承诺事务中途 abort
- **AND** 远程、长耗时或可取消的 Gateway cancellation MUST be deferred from this change
- **AND** internal abort MUST propagate to downstream slow boundaries
- **AND** internal abort trigger in this change MUST be limited to internal timeout、server shutdown、test-injected abort and transport disconnect cleanup
- **AND** internal abort MUST be normalized as safe failure/degradation
- **AND** product Web API MUST NOT expose user-visible cancel route in this change
- **AND** runtime command boundary MUST NOT add user cancel command or request-control command in this change
- **AND** internal abort MUST NOT persist user-canceled terminal state or request-control state
- **AND** internal abort MUST NOT be projected as `REQUEST_CANCELED` unless a later request-control change defines that behavior

### Requirement: Owner Scope And No-op Boundaries
最小内核 SHALL 贯穿 `tenantId` 和 `subjectId` owner scope，并在主路径持久化事实中贯穿可信 `agentId`。hook、checkpoint 和 audit 这些一层直接依赖 SHALL 调用对应 boundary 且装配默认 no-op 实现。No-op SHALL 仅用于不影响一次问答成立的依赖，且不得改变后续真实 provider 的调用语义。

#### Scenario: Owner scope 来自可信 channel/auth boundary
- **WHEN** Web channel 构造 submit、stream 或 history query
- **THEN** `tenantId` 和 `subjectId` MUST 来自可信 identity context
- **AND** 请求体、客户端 metadata、模型输出或 capability arguments 中的 owner 字段 MUST NOT 覆盖当前身份
- **AND** 跨 owner 或跨 agent session、message、run、timeline 或 history 访问 MUST 返回 safe not-found outcome

#### Scenario: No-op hook checkpoint audit 被主流程调用
- **WHEN** 最小内核执行一次合法问答
- **THEN** Runtime 或对应模块 MUST 调用 lifecycle hook boundary in the main flow
- **AND** Runtime MUST 调用 `CheckpointStoreGateway.saveCheckpoint` 或本 change 定义的最小 checkpoint save boundary in the main flow
- **AND** Runtime、terminal path 或 observability-derived capability audit path MUST 调用 `AuditEventWriter` 或本 change 定义的 audit boundary in the main flow
- **AND** capability executors and Agent Core MUST NOT call `AuditEventWriter` directly for capability audit
- **AND** default hook/checkpoint/audit providers MUST be explicit product composition providers, not missing dependencies or test-only stubs
- **AND** 默认 lifecycle hook provider MUST only return continue/no-op outcome and MUST NOT change model profile、tools、context、terminal state、degradation strategy or security decision
- **AND** 默认 checkpoint provider MUST NOT write checkpoint record and MUST NOT support lookup/recovery
- **AND** 默认 audit writer MUST NOT persist audit record、ring buffer or debug read interface
- **AND** real policy hook execution、checkpoint persistence/recovery and durable audit store MUST remain deferred
- **AND** no-op calls MAY be verified through test spy/sink
- **AND** no-op provider MUST NOT 掩盖 owner scope、agent scope、terminal consistency、safe error 或问答结果所需行为

### Requirement: Scope Boundary For In-scope And Deferred Behavior
最小内核 SHALL 严格区分 `real`、`minimal`、`noop` 和 `deferred` 范围。范围内标记为 `real` 或 `minimal` 的行为 MUST 提供真实实现；明确 deferred 的能力 MUST NOT 隐式进入最小内核。

#### Scenario: 范围内行为不得降级为占位
- **WHEN** 行为直接决定问答结果、流式可见性、终态一致性、用户可操作状态或安全边界
- **THEN** TS 最小内核 MUST 提供真实实现
- **AND** 系统 MUST NOT 使用 mock、测试替身、空实现或只返回固定响应的占位逻辑替代该行为
- **AND** any behavior on the Web submit -> terminal/history main path MUST satisfy the concrete contract, schema, state, event, owner-scope, agent-scope and verification requirements defined by this change
- **AND** behavior outside that main path MUST NOT be partially implemented as product behavior

#### Scenario: Deferred 能力不进入最小内核
- **WHEN** 能力属于附件、多工具、多 Skill source、长期记忆、WebSocket、取消/重试/编辑完整能力、多实例 recovery、terminal retry/takeover、远端 Agent 或 output continuation
- **THEN** TS 最小内核 MUST NOT 隐式实现这些二层或 deferred 能力
- **AND** Web submit MUST NOT 接收或绑定用户附件；若请求包含非空附件输入，MUST fail schema validation
- **AND** 若主流程必须保留调用点，只能按本规格 no-op 约束处理

### Requirement: Productized Package Module Structure

最小内核 SHALL 以产品化 TypeScript 后端 package 结构交付。核心 implementation package MUST NOT 将主流程实现集中在单个 `src/index.ts` 中；`src/index.ts` SHALL serve as a public barrel or explicitly documented lightweight factory export only. Package 内部目录结构 SHALL follow `openspec/designs/architecture/ts-backend-architecture.md` 的开发视图和对应 `openspec/designs/modules/<module>.md` 的模块设计，unless a package is explicitly classified as a minimal stub package by those stable designs.

#### Scenario: Product implementation packages depend only through common, authorized contracts and narrow foundations

- **WHEN** product implementation packages other than `agent-app` declare workspace dependencies or import cross-package code
- **THEN** they MUST NOT depend on another product implementation package
- **AND** cross-module business collaboration MUST use `agent-common` and explicitly authorized `agent-contracts/<subpath>` public exports only
- **AND** `agent-local-file-roll` MAY be classified by the stable architecture as a Node-only technical foundation rather than a product implementation package
- **AND** only `agent-log`, `agent-observability` and `agent-platform-gateway-local` MAY depend on that foundation for rolling-file mechanics
- **AND** that exception MUST NOT carry business contracts, output-domain vocabulary or implementation-to-implementation collaboration and MUST NOT be generalized to another package without a later OpenSpec change
- **AND** this guard MUST cover both TypeScript source imports and `package.json` workspace dependency declarations
- **AND** `agent-app` MAY depend on implementation packages only as the composition root, and that exception MUST NOT be available to other packages
- **AND** tests, fixtures and `agent-test-kit` MAY have a separate test-only dependency policy

#### Scenario: Contract subpath imports follow architecture allowlist

- **WHEN** a product package imports `@nextagent/agent-contracts/<subpath>`
- **THEN** the imported subpath MUST be present in the package-specific allowlist defined by `openspec/designs/architecture/ts-backend-architecture.md` and the corresponding `openspec/designs/modules/<module>.md`
- **AND** product code MUST NOT import from the `@nextagent/agent-contracts` root aggregate export
- **AND** the allowlist MUST be based on architecture ownership and cycle prevention, not on the subpaths currently imported by implementation code
- **AND** runtime-safe Agent assembly facts MUST be imported from `agent-contracts/agent-assembly`, not from `agent-contracts/runtime`
- **AND** `agent-contracts/agent-assembly` MUST NOT contain `Agent`, `AgentDefinition`, compiler/loader/parser types, raw config, provider credential, gateway config or channel config
- **AND** `agent-core` MUST NOT import `agent-contracts/gateway`
- **AND** `agent-context-engine` MUST NOT import `agent-contracts/runtime`
- **AND** `agent-channel-web` MUST import only channel/runtime contracts and MUST NOT import session、gateway、model or capability contracts
- **AND** gateway adapter packages MUST import only gateway contracts
- **AND** model packages MUST import only model contracts
- **AND** capability packages MAY import only capability and agent-assembly contracts
- **AND** any new contract subpath consumption MUST require updating the OpenSpec design and architecture tests before implementation

#### Scenario: 核心 package 不以单文件实现交付

- **WHEN** 开发者检查 `agent-runtime`、`agent-core`、`agent-channel-web`、`agent-model`、`agent-capability`、`agent-context-engine`、`agent-session`、`agent-platform-gateway-local` 和 `agent-app`
- **THEN** each package MUST organize implementation under responsibility-specific directories such as lifecycle、timeline、terminal、agent、tools、routes、schemas、providers、catalog、assembly、services、stores or composition according to `openspec/designs/architecture/ts-backend-architecture.md` and the corresponding `openspec/designs/modules/<module>.md`
- **AND** `src/index.ts` MUST NOT contain request lifecycle implementation、Agent execution loop、Fastify route registration logic、provider SDK calls、capability read implementation、context render logic、gateway store implementation or schema validation bodies
- **AND** preserving all public package exports MUST be part of the refactor acceptance

#### Scenario: 测试夹具和产品 composition 分离

- **WHEN** product composition is built
- **THEN** it MUST NOT import deterministic/test provider、test gateway、test clock/id generator or test-only helpers from `testing/` entries
- **AND** deterministic/test helpers MAY be exported only through explicit `testing/` package entries or test-kit packages
- **AND** unit, contract and characterization tests MAY use those testing entries without introducing cross-package private path imports

#### Scenario: Architecture guard prevents demo-style regression

- **WHEN** `npm run lint:architecture` runs
- **THEN** it MUST fail on cross-package private path imports
- **AND** it MUST fail when product code imports another package's `testing/` entry
- **AND** it MUST fail when an unauthorized package depends on `agent-local-file-roll`, when the foundation imports common/contracts/implementation packages, or when pino-roll/SonicBoom/zlib rolling lifecycle escapes that foundation
- **AND** it MUST include a guard that the core implementation packages listed in this requirement are not delivered as single implementation files
- **AND** productized module restructuring MUST NOT change Web API behavior、stream event vocabulary、runtime command shape、model invocation shape、capability invocation shape、owner scope、safe error handling or terminal consistency

#### Scenario: Architecture and contract guards preserve the session scope boundary

- **WHEN** Web session create, session list, conversation history, convenience submit and session-scoped submit tests run
- **THEN** Web API observable behavior MUST preserve owner+agent isolation, reject client-supplied owner/agent fields, and expose only public Web DTO fields
- **AND** runtime public-boundary tests MUST show accepted session/run facts are scoped by trusted identity and trusted Agent Scope without accepting client-provided Agent Scope
- **AND** session public contract tests MUST expose only domain session objects/read models and MUST NOT expose Web DTO aliases, gateway records or gateway-local rows
- **AND** gateway public contract tests MUST require owner+agent scoped session/message/active-context record/query shapes
- **AND** architecture tests MAY use representative category-level negative fixtures for forbidden cross-package dependencies, runtime-internal resolver leakage, DTO/Record boundary leakage and product-path test fixture leakage
- **AND** these architecture/source assertions MUST correspond only to architecture boundaries or forbidden patterns and MUST NOT lock down private call order, helper names, directory internals or individual historical symbol names

### Requirement: Minimal Kernel Verification
最小内核 SHALL 提供可重复验证路径，覆盖端到端问答、stream/history 一致性、安全边界、assembly 固化、no-op 调用和架构边界。没有可重复验证路径的任务不得视为完成。

#### Scenario: 验证命令覆盖主路径和边界
- **WHEN** 开发者从仓库根目录验证本变更
- **THEN** `npm run build` MUST 编译通过
- **AND** `npm test` MUST 执行最小内核 unit 和 characterization tests
- **AND** `npm run test:contract` MUST 执行 contract tests
- **AND** `npm run lint:architecture` MUST 阻止 forbidden dependency、private import、framework leakage 和 provider SDK 泄漏
- **AND** `openspec validate --all --strict` MUST 通过
- **AND** `npm run lint:architecture` MUST include a dependency-cruiser rule that fails on cross-package private path import
- **AND** `npm run lint:architecture` MUST fail when a non-app product implementation package imports or declares a dependency on another implementation package
- **AND** `npm run lint:architecture` or an equivalent architecture test MUST fail when product code imports an unauthorized `agent-contracts` subpath or the `agent-contracts` root aggregate export

#### Scenario: Negative cases 被断言失败
- **WHEN** 测试触发跨 owner 访问、重复 terminal commit、active assembly 重新选择、缺失 current request query owner scope、provider raw error 泄漏、read 工具路径逃逸或 no-op 边界未调用
- **THEN** 对应测试 MUST 断言系统失败或拒绝
- **AND** 失败 MUST 以 safe error、contract test failure 或 architecture lint failure 表达

### Requirement: Runtime session port supports scoped session deletion

Runtime session-facing contract SHALL support deleting an owner-scoped and agent-scoped session without changing request submit、terminal commit、stream replay or history consistency semantics. The delete command MUST carry trusted `IdentityContext` and `sessionId`; runtime MUST resolve trusted Agent Scope internally before delegating to `agent-session`. `UserSessionPort` deletion input MUST carry trusted `IdentityContext`、trusted `agentId` and `sessionId`.

Gateway contract SHALL expose a single owner+agent scoped composite delete for session deletion. The composite delete MUST fail closed when a non terminal request run exists for the session and MUST complete all deletion effects in one local persistence transaction.

#### Scenario: Runtime resolves Agent Scope for deletion
- **WHEN** Web channel calls runtime session delete for session `S1`
- **THEN** Runtime MUST resolve `agentId` through the same trusted internal Agent Scope resolver used by session create/list/history
- **AND** Runtime MUST NOT accept `agentId` from client request body、query string、metadata、model output or Capability arguments

#### Scenario: Session port delete uses domain boundary
- **WHEN** Runtime deletes session `S1`
- **THEN** Runtime MUST call `UserSessionPort` or equivalent session domain boundary with trusted `IdentityContext` and `agentId`
- **AND** Runtime MUST NOT pass gateway `*Record` values to Web channel

#### Scenario: Gateway composite delete is the only persistence write path
- **WHEN** session deletion reaches gateway-local
- **THEN** gateway-local MUST use a single composite delete transaction for session-owned facts
- **AND** runtime、session domain 或 Web channel MUST NOT independently delete messages、runs、timeline、checkpoint、annotation 或 share rows one by one outside that composite boundary

#### Scenario: Minimal question-answer path remains unchanged
- **WHEN** `add-ts-session-delete` is implemented
- **THEN** existing submit、SSE/WS stream、terminal commit and history read behavior for non-deleted sessions MUST remain unchanged
- **AND** deleting one terminal session MUST NOT mutate another session's request run、timeline、history or active context facts

### Requirement: Session Fork Web Route

The Web route registry SHALL expose `POST /api/v1/sessions/{sessionId}/messages/{messageId}/fork` for user-initiated session fork from a durable visible assistant message. It SHALL also expose `POST /api/v1/sessions/{sessionId}/requests/{requestId}/fork` as a live-completion convenience entry that resolves a request/root message id to a durable completed assistant message in runtime before reusing the normal message-anchor fork path. These routes MUST be owner scoped and agent scoped through the trusted channel/auth and runtime session facade. The request body MUST only accept a required `idempotencyKey` opaque bounded token. The Web route MUST trim the supplied string, reject trim-empty values, reject values longer than 128 characters after trim, and pass only the normalized key to runtime. The route MUST NOT accept owner fields、Agent Scope fields、child session id、child message ids、fork source metadata、copied messages、active context refs、timeline refs、checkpoint refs or raw prompt content.

#### Scenario: Route registry exposes fork route
- **WHEN** the Web route registry is inspected
- **THEN** route registry MUST expose `POST /api/v1/sessions/{sessionId}/messages/{messageId}/fork`
- **AND** route registry MUST expose `POST /api/v1/sessions/{sessionId}/requests/{requestId}/fork`
- **AND** the route MUST call runtime session fork command
- **AND** the route MUST NOT create sessions, messages, active context items or fork metadata directly

#### Scenario: Request fork route delegates anchor resolution to runtime
- **WHEN** the client calls `POST /api/v1/sessions/{sessionId}/requests/{requestId}/fork`
- **THEN** Web channel MUST pass only trusted identity context, source session id, source request id and normalized idempotency key to runtime
- **AND** Web channel MUST NOT load conversation history, infer assistant message ids, read live stream envelopes or create child session facts directly

#### Scenario: Fork route rejects client-supplied authority fields
- **WHEN** a fork request body contains `tenantId`、`subjectId`、`agentId`、`childSessionId`、`childMessageIds`、`forkSource`、`messages`、`activeContextItems`、`timelineEvents` or `checkpoint`
- **THEN** Web schema validation MUST reject the request
- **AND** runtime fork command MUST NOT be called

#### Scenario: Fork route rejects invalid idempotency key
- **WHEN** a fork request body omits `idempotencyKey`, provides an empty string, a whitespace-only string, a string longer than 128 characters after trim, or a non-string value
- **THEN** Web schema validation MUST reject the request
- **AND** runtime fork command MUST NOT be called

#### Scenario: Fork response uses safe session projection
- **WHEN** fork route succeeds
- **THEN** response MUST return safe child session metadata suitable for opening the child session
- **AND** response MUST NOT include copied message content outside normal conversation read
- **AND** response MUST NOT include internal fork source record fields other than public source session id/title notice data when needed

### Requirement: Fork Notice Conversation Projection

The default/latest Web conversation bootstrap response SHALL include optional `forkNotice` for forked child sessions only when the child session has no user message after the fork boundary. `forkNotice` MUST be derived from server-side fork source metadata and child session state. The Web channel MUST NOT let clients request, suppress, forge or override fork notice through query parameters or request body fields. `forkNotice` is not a conversation message, MUST NOT be projected as an item, MUST NOT enter active context, and MUST be omitted from cursor-based, newer-cursor-based and anchor-message conversation reads.

#### Scenario: Default/latest conversation response includes forkNotice before child user message
- **WHEN** a client reads the default/latest `GET /api/v1/sessions/{sessionId}/conversation` response for a forked child session with no user message after the fork boundary
- **THEN** response MUST include `forkNotice`
- **AND** `forkNotice` MUST include source session id and source session title snapshot
- **AND** `forkNotice` MUST NOT appear as a conversation item

#### Scenario: Default/latest conversation response omits forkNotice after child user message
- **WHEN** a client reads the default/latest `GET /api/v1/sessions/{sessionId}/conversation` response for a forked child session after the user has submitted a new child message
- **THEN** response MUST NOT include `forkNotice`

#### Scenario: Paged and anchored reads omit forkNotice
- **WHEN** a client reads `GET /api/v1/sessions/{sessionId}/conversation` with `cursor`, `newerCursor` or `anchorMessageId`
- **THEN** response MUST NOT include `forkNotice`
- **AND** response items MUST remain only normal conversation message projections

#### Scenario: Clients cannot forge notice visibility
- **WHEN** a conversation request contains query parameters or body-equivalent metadata attempting to force fork notice visibility
- **THEN** Web channel MUST ignore or reject those fields according to existing schema rules
- **AND** notice visibility MUST be computed only from server-side fork metadata and child conversation state

### Requirement: App Config Supports Operator Local Resource Roots

`agent-app/config` SHALL allow trusted system configuration to set local resource roots for Agent packages and system Skills through `paths.agentRoot` and `paths.skillRoot`. The built-in `default-system.yaml` SHALL declare `paths.agentRoot: "agents"` and `paths.skillRoot: "skills"`. When either field is omitted by an overlay or test fixture, the system SHALL derive the same default root as before from the app config root: `agents` for Agent packages and `skills` for system Skills.

The resulting `DefaultSystemConfig.paths.agentsRoot` and `DefaultSystemConfig.paths.systemSkillsRoot` SHALL remain normalized absolute paths owned by app composition. Runtime, core, context, model, capability, gateway and channel packages MUST NOT parse raw path config or environment variables.

#### Scenario: Configured Local Resource Roots

- **WHEN** application config sets `paths.agentRoot: "../configured-agents"` and `paths.skillRoot: "../configured-skills"`
- **THEN** app config validation MUST freeze normalized absolute roots under `DefaultSystemConfig.paths`
- **AND** Agent package discovery MUST use `paths.agentsRoot`
- **AND** system Skill discovery MUST use `paths.systemSkillsRoot`
- **AND** omitted fields MUST preserve the existing `agents` and `skills` defaults.

#### Scenario: Release Package Stages Default Agent For Capability Validation

- **WHEN** a local runtime release package is assembled
- **THEN** the `pack:release` package MUST include `agents/default-agent/agent.yaml` at the package root for capability validation
- **AND** the package MUST NOT include `config/default-agent.yaml` as a copied local default Agent definition
- **AND** the package MUST preserve the builtin `default-agent` definition under the packaged `@nextagent/agent-core` builtin Agent resources
- **AND** the packaged `config/default-system.yaml` MUST declare `paths.agentRoot: "agents"` and `paths.skillRoot: "skills"`
- **AND** `agents/default-agent/agent.yaml` MUST take priority over the packaged builtin `default-agent` definition as a full AgentDefinition replacement, with no builtin field fallback or deep merge.

#### Scenario: Unsafe Local Resource Roots Are Rejected

- **WHEN** configured local resource roots overlap runtime execution, runtime data, sqlite storage or shared-data roots
- **THEN** app config validation MUST fail closed before startup returns a ready `DefaultSystemConfig`.

### Requirement: App Config Supports RAG Index Environment References

`agent-app/config` SHALL allow `rag.indexes` source configuration to use `env:<NAME>`. The env reference SHALL be resolved by the app config source loader before schema validation and normalized to the existing frozen `DefaultSystemConfig.rag.indexes` string-array shape.

The env value MAY be a comma-separated list of RAG index names or a JSON string array of RAG index names. Empty or unresolved env values in an application overlay MUST be ignored so the existing default `rag.indexes` remains effective. Raw `env:` strings MUST NOT leak into downstream components.

#### Scenario: RAG Indexes From Environment

- **GIVEN** `rag.indexes: env:RAG_INDEXES`
- **AND** `RAG_INDEXES=local,remote-netops`
- **WHEN** `agent-app/config` resolves the default system config source
- **THEN** `DefaultSystemConfig.rag.indexes` MUST equal `["local", "remote-netops"]`
- **AND** downstream packages MUST consume only the frozen string array.

#### Scenario: Missing RAG Index Environment Value Keeps Defaults

- **GIVEN** `rag.indexes: env:RAG_INDEXES`
- **AND** `RAG_INDEXES` is unset or empty
- **WHEN** app config validation runs
- **THEN** startup MUST remain ready using the existing default RAG indexes
- **AND** downstream packages MUST NOT receive a raw `env:RAG_INDEXES` value.

### Requirement: Model producers persist the last accumulated thinking delta at model invocation completion

Default Agent SHALL继续在单次model invocation局部累积reasoning，并通过`RunBoundModelInvocation`的唯一terminal path在`MODEL_INVOCATION_COMPLETED|FAILED`之前完成并持久化最后一个非空累计`LLM_THINKING_DELTA`。该terminal path MUST覆盖normal completion、safe error、throw和abort，MUST对同一invocation至多执行一次completion callback。

Runtime MUST NOT为此新增open-segment state、segment identity、generation token、per-run thinking lane或ordinal recovery。

#### Scenario: Normal model completion orders completed thinking first
- **WHEN**invocation产生partial reasoning后正常完成
- **THEN**最后完整reasoning MUST先作为`completed=true`的PERSISTED thinking delta append/publish
- **AND**MODEL_INVOCATION_COMPLETED MUST获得更大sequence

#### Scenario: Model failure preserves the last accepted reasoning
- **WHEN**invocation产生partial reasoning后以safe error、throw或abort结束
- **THEN**completion callback MUST在MODEL_INVOCATION_FAILED前尝试保存最后累计delta
- **AND**同一invocation的重复failed调用 MUST不重复完成或持久化thinking delta

#### Scenario: Final append failure blocks dependent boundary
- **WHEN**最后累计thinking delta append失败
- **THEN**model terminal event MUST不发布
- **AND**request MUST沿既有safe failure路径结束，不伪造completed history

#### Scenario: Crash before model invocation completion may lose in-progress state
- **WHEN**进程在模型调用producer观察到调用结束前直接终止
- **THEN**未持久化的调用中reasoning MAY丢失
- **AND**recovery MUST不猜测或生成final thinking

### Requirement: Workflow lifecycle does not own model thinking completion

Workflow runtime projector SHALL只投影workflow visible output和node lifecycle。`NODE_COMPLETED | NODE_FAILED | NODE_SKIPPED` MUST NOT作为模型thinking完成边界，MUST NOT据此生成`completed=true`的`LLM_THINKING_DELTA`。

#### Scenario: Workflow node terminal does not synthesize completed thinking
- **WHEN**workflow LLM node此前投影过live-only thinking delta后进入任一node terminal state
- **THEN**projector MUST只输出既有workflow terminal投影
- **AND**MUST不生成PERSISTED thinking delta

### Requirement: Runtime event emission follows one persistence path

`RuntimeOwnedAgentRunStatePort` SHALL调用统一persistence policy决定LIVE_ONLY或PERSISTED。LIVE_ONLY只进入live callback；PERSISTED必须先append canonical record，再进入既有timeline publication。Terminal request events继续由既有terminal composite transaction拥有。

#### Scenario: Main emit path has no thinking special case
- **WHEN**调用中thinking、completed thinking和其他events进入emitEvent
- **THEN**emitEvent MUST通过同一policy结果选择live或append路径
- **AND**不得通过独立thinking branch绕过scope、suppression或publication规则

#### Scenario: Persisted completed event publishes canonical coordinates
- **WHEN**gateway成功append completed thinking
- **THEN**live consumer MUST接收gateway返回的eventId、sequence和createdAt对应投影
- **AND**history query MUST读取同一canonical record

### Requirement: Runtime exposes one scoped event-history facade

Runtime SHALL实现`RuntimeSessionPort.listEvents`并拥有session/run解析、pagination和safe mapping。Web/channel MUST不直连timeline gateway。Current RequestRun优先于copied-run status；没有两者的runId安全失败。

#### Scenario: Current run query uses RequestRun binding
- **WHEN**runId解析为同owner、Agent和session的RequestRun
- **THEN**runtime MUST以该run的requestId和runId查询timeline
- **AND**返回AVAILABLE page

#### Scenario: Copied run query uses snapshot status
- **WHEN**runId不是RequestRun但属于child copied prefix
- **THEN**runtime MUST读取对应snapshot status
- **AND**AVAILABLE读取child snapshot rows，LEGACY_UNAVAILABLE返回exact unavailable page

#### Scenario: Gateway or projection preparation failure returns no partial page
- **WHEN**任一page read、record validation或safe mapping失败
- **THEN**runtime MUST整页失败
- **AND**MUST不返回已读取的前缀events

### Requirement: Cron trigger 使用标准 request lifecycle
合法 Cron trigger SHALL 转换为标准 submit command 并进入 runtime acceptance。Cron gateway、scheduler 和 callback transport MUST NOT 直接调用 model、Agent core 或 capability。trigger 创建的 run MUST 固化 task 所属 `agentId`、当前可解析 `agentVersion` 与 `agentAssemblyRef`，并同时校验 Owner Scope 与 Agent Scope。

#### Scenario: 同 session 串行
- **WHEN** Cron trigger 与用户请求同时提交到同一 session
- **THEN** 两者 MUST 经过既有 same-session lane 排序，不得绕过 scheduler 并发执行

#### Scenario: terminal commit 非回归
- **WHEN** Cron 触发的 Agent 执行成功、失败或取消
- **THEN** runtime MUST 产生与普通 submit 相同的 canonical timeline 和唯一 terminal commit

### Requirement: Tool-call rounds preserve public assistant content for subsequent model invocation

When a model result contains both public assistant content and one or more tool calls, Agent Core SHALL persist the non-empty public content and the ordered tool calls in the same hidden assistant tool-use session message before capability invocation. The message SHALL retain the existing owner scope, Agent scope, request/run coordinates, visibility, active-context composite-write and tool-call idempotency semantics.

Agent Core SHALL NOT persist model reasoning/thinking, raw provider response or a timeline/stream replay as assistant content. A persistence failure SHALL fail through the existing explicit request failure path and MUST NOT silently execute the tool batch after dropping the public content.

The persisted public content SHALL belong only to the model invocation that produced the tool calls in that assistant tool-use message. Agent Core SHALL NOT prepend or append public content from an earlier or later tool round, even when request-level stream projection retains cumulative visible content.

#### Scenario: Public content and tool calls survive into the next model round

- **GIVEN** a model invocation returns non-empty public assistant content and ordered tool calls
- **WHEN** Agent Core accepts the tool batch for execution
- **THEN** Agent Core MUST persist one hidden `ASSISTANT_TOOL_USE` message containing that public content and those tool calls
- **AND** matching capability results MUST retain the existing toolCallId and toolName pairing
- **AND** the subsequent model invocation MUST receive the public content and tool calls in one assistant message followed by the matching tool results

#### Scenario: Tool-call-only response remains supported

- **GIVEN** a model invocation returns tool calls with empty public content
- **WHEN** Agent Core accepts the tool batch for execution
- **THEN** the hidden assistant tool-use message MUST remain a valid tool-call-only message
- **AND** the subsequent model invocation MUST receive the tool calls and matching tool results without an empty text part

#### Scenario: Consecutive tool rounds remain distinct

- **GIVEN** one request contains two consecutive model invocations that each return distinct public content and tool calls
- **WHEN** Agent Core persists both accepted tool batches and assembles the following model request
- **THEN** each hidden assistant tool-use message MUST contain only the public content from its own model invocation
- **AND** the following model request MUST contain two distinct assistant messages without repeating the first round's public content in the second message

#### Scenario: Public content persistence fails explicitly

- **GIVEN** a model invocation returns public assistant content and tool calls
- **WHEN** the composite assistant tool-use message write fails
- **THEN** Agent Core MUST NOT continue by executing the tool batch with only a live stream copy of the content
- **AND** the request MUST follow the existing safe failure path

#### Scenario: Reasoning is not retained as assistant content

- **GIVEN** a model invocation returns public content, reasoning and tool calls
- **WHEN** Agent Core persists and later renders the assistant tool-use message
- **THEN** only the public content and tool calls MUST enter the message and subsequent model request
- **AND** reasoning MUST NOT enter the persisted session message or subsequent model request

### Requirement: Terminal assistant output must be non-empty

When a request reaches terminal commit with status `COMPLETED`, the terminal assistant content SHALL be a non-empty, non-whitespace string.

Before terminal readiness, a model result with no tool calls and empty or whitespace-only visible assistant content MUST enter bounded model-output recovery. If that recovery is exhausted, Agent Core MUST emit `DEGRADATION_NOTICE` with code `MODEL_EMPTY_OUTPUT` and fail the run safely instead of emitting final content or allowing a completed terminal commit.

If an empty or whitespace-only assistant result reaches the Agent Core terminal-readiness boundary after model-output recovery, Agent Core MUST emit `DEGRADATION_NOTICE` with code `MODEL_FINAL_CONTENT_EMPTY` and fail the run safely.

Runtime terminal commit MUST defensively convert any `COMPLETED` terminal commit with empty or whitespace-only assistant content into safe `FAILED`, emit `DEGRADATION_NOTICE` with code `MODEL_FINAL_CONTENT_EMPTY`, and persist a non-empty safe assistant failure message.

Zero retrieval results from `Rag`, memory search, or other read-only tools MUST NOT by themselves fail the request. The failure condition is the model's empty terminal assistant output after tool processing.

When a model returns `finishReason="stop"`, non-empty reasoning, no visible assistant content anywhere in the current model route, no tool calls, and no safe error, Agent Core MUST make exactly one same-model corrective invocation within that planning round before producing `MODEL_EMPTY_OUTPUT`. The corrective invocation MUST use a fixed trusted instruction, MUST NOT project reasoning into visible assistant content, and MUST preserve the existing cancellation, timeout, deadline, lifecycle-hook, and model-routing boundaries.

If the corrective invocation still produces no visible content or tool call, Agent Core MUST classify the result as retryable `MODEL_EMPTY_OUTPUT` and evaluate the existing model fallback policy. Fallback MUST occur only when the existing visible-output replay, cancellation, deadline, budget, route-availability, and route-exhaustion guards permit it. A fallback route MUST NOT receive a second reasoning-only corrective invocation in the same planning round.

A completely empty model result without reasoning MUST continue directly to `MODEL_EMPTY_OUTPUT` without consuming the reasoning-only corrective invocation.

#### Scenario: Model stops with completely empty output

- **GIVEN** a model round returns `finishReason="stop"`, no reasoning, no tool calls, and empty or whitespace-only assistant content
- **WHEN** Agent Core evaluates model-output recovery
- **THEN** Agent Core MUST classify the result as retryable `MODEL_EMPTY_OUTPUT` without consuming the reasoning-only corrective invocation
- **AND** Agent Core MUST evaluate the existing fallback policy
- **AND** Agent Core MUST emit `DEGRADATION_NOTICE` with code `MODEL_EMPTY_OUTPUT` if recovery is exhausted
- **AND** the request MUST end with `REQUEST_FAILED`
- **AND** the request MUST NOT publish `REQUEST_COMPLETED`
- **AND** conversation history MUST contain a non-empty safe assistant failure message

#### Scenario: Runtime prevents custom agent empty completed terminal commit

- **GIVEN** an agent implementation bypasses Agent Core output guard and attempts a `COMPLETED` terminal commit with empty or whitespace-only content
- **WHEN** Runtime performs terminal commit
- **THEN** Runtime MUST emit `DEGRADATION_NOTICE` with code `MODEL_FINAL_CONTENT_EMPTY`
- **AND** Runtime MUST persist `REQUEST_FAILED` with a non-empty safe assistant failure message

#### Scenario: Reasoning-only stop is corrected once

- **GIVEN** a model invocation returns `finishReason="stop"`, non-empty reasoning, no visible content, and no tool calls
- **WHEN** Agent Core evaluates the model result
- **THEN** Agent Core MUST invoke the same routed model once with the fixed corrective instruction
- **AND** the corrective request MUST NOT include the prior reasoning as visible content
- **AND** visible content or a tool call from the corrective invocation MUST continue through the ordinary agent loop

#### Scenario: Consecutive reasoning-only stops use conditional fallback

- **GIVEN** both the initial invocation and its one corrective invocation return reasoning-only `finishReason="stop"` results
- **WHEN** Agent Core exhausts reasoning-only correction
- **THEN** Agent Core MUST produce retryable `MODEL_EMPTY_OUTPUT`
- **AND** Agent Core MUST evaluate the existing fallback policy exactly as it does for other retryable model failures
- **AND** an eligible fallback route MUST be used when no existing fallback guard denies it
- **AND** the run MUST fail explicitly with `MODEL_EMPTY_OUTPUT` when no eligible fallback route exists
- **AND** no fallback route MUST receive another reasoning-only corrective invocation in the same planning round

#### Scenario: Reasoning with a tool call is not semantic-empty output

- **GIVEN** a model invocation returns reasoning and at least one tool call
- **WHEN** Agent Core evaluates the model result
- **THEN** Agent Core MUST continue through the ordinary tool loop
- **AND** it MUST NOT issue the reasoning-only corrective invocation

#### Scenario: Confirmed visible continuation is not semantic-empty output

- **GIVEN** output-token recovery has already confirmed visible assistant content in the current model route
- **AND** a continuation invocation returns reasoning-only `finishReason="stop"`
- **WHEN** Agent Core evaluates the continuation result
- **THEN** Agent Core MUST preserve the confirmed visible content
- **AND** it MUST NOT issue the reasoning-only corrective invocation
- **AND** it MUST NOT replay the route through model fallback

### Requirement: Execution-root exception termination remains owner-scoped

The minimal kernel SHALL assign exception termination to the owner of each execution root rather than to the first catch. `agent-runtime` SHALL own exceptions that terminate an accepted request execution; Web and Task channels SHALL own synchronous transport or pre-acceptance exceptions they convert to a public response; deployment/app lifecycle SHALL own startup and shutdown termination; scheduler/worker owners SHALL own consumed background-attempt failures; executable deployment entrypoints SHALL own process-fatal escape handling.

An intermediate model, capability, context, gateway, composition or lifecycle helper that continues propagation MUST rethrow the same exception or wrap it with the original exception as standard `cause`, and MUST NOT record the exception. SafeError conversion MUST preserve public safety and terminal consistency without exposing the Error or cause chain. This requirement MUST NOT introduce a cross-owner global exception-handler service or exception-logged marker.

#### Scenario: Accepted request failure remains runtime-owned

- **WHEN** an unexpected model, capability or context exception escapes core execution after request acceptance
- **THEN** the lower owner MAY complete its canonical safe failure fact but MUST propagate without printing the exception
- **AND** runtime MUST classify the exception once at the request execution termination boundary
- **AND** runtime MUST continue the existing single safe terminal commit semantics
- **AND** a later terminal commit failure MUST remain a distinct operation and MUST NOT be mislabeled as dispatch or execution failure

#### Scenario: Channel maps only unconsumed boundary failures

- **WHEN** a channel receives a non-INTERNAL domain exception, a boundary-owned schema validation failure, an INTERNAL exception or an unknown exception before accepted-request terminal ownership begins
- **THEN** the channel MUST use its top error handler to preserve the existing safe domain/validation response for the expected cases and produce a safe 500 for the INTERNAL/unknown cases
- **AND** the channel MUST NOT print an exception already converted into a runtime terminal fact

#### Scenario: Startup helper preserves cause for the deployment boundary

- **WHEN** an app composition or listen helper adds stable startup context and rethrows
- **THEN** the wrapper MUST retain the original exception as cause and MUST NOT log it
- **AND** the deployment startup boundary MUST terminate startup and own the single startup exception diagnostic

### Requirement: 最小 Capability Tool 集合
`agent-capability` SHALL 提供最小 Tool catalog 与 invocation 行为；`agent-core` SHALL 通过统一 capability boundary 驱动最小 tool loop。首版产品路径只暴露已启用的内置 `read` 和 `bash` capability，其他 capability 不得进入模型可见工具集或执行路径。`agent-core` 不得 hardcode 文件读取、bash 执行或其他 tool 语义，所有 tool 调用 MUST 通过已治理的 `CapabilityCatalog` / `CapabilityInvocationPort`、routing constraints、risk policy、sandbox boundary 和 safe error handling 执行。

#### Scenario: normal 与 debug 日志都记录 Tool payload
- **WHEN** Tool invocation 产生实际输入或有效输出
- **THEN** tool-loop runtime direct diagnostic MUST 分别通过 canonical `toolInput` 和 `toolOutput` 记录实际输入与已有的有效输出
- **AND** 该行为 MUST NOT 依赖 `rawToolInputLogging`、`rawToolPayloadLogging` 或其它 payload logging flag
- **AND** normal 与 debug diagnostic detail MUST 使用同一行为
- **AND** `toolInputPreview` 和 `toolSafeSummary` MUST 保持安全摘要
- **AND** credential 与认证类 token MUST 由集中 operational writer 窄匹配脱敏
- **AND** 非秘密 prompt、path、command、result content 与正常 credential/token 诊断元数据 MUST 保真并受集中容量边界约束

#### Scenario: 未启用 capability 不进入产品路径
- **GIVEN** 当前产品 assembly 默认启用内置 `read` 和 `bash`
- **WHEN** 模型返回 `write`、Skill tool、remote Agent 或其它未启用 capability/tool call
- **THEN** Agent core MUST NOT execute the tool outside `CapabilityInvocationPort`
- **AND** Runtime/Core MUST publish `DEGRADATION_NOTICE` and end the request with safe `REQUEST_FAILED`
- **AND** logs、stream、history 和 SafeError MUST NOT expose raw tool arguments or host paths

#### Scenario: read 工具遵守 workspace 边界
- **WHEN** read capability 请求读取文件
- **THEN** 工具 MUST 只接受 `file_path` as workspace-relative 单文件路径
- **AND** 绝对路径、路径逃逸、目录读取、glob pattern、权限拒绝、timeout 或 abort MUST 返回 safe capability failure，并导致 request 发布 `DEGRADATION_NOTICE` 后以 `REQUEST_FAILED` 结束
- **AND** 缺失文件或普通 IO failure MAY 作为 safe tool result 交给模型继续生成答复
- **AND** `offset` MUST mean 0-based start line and default to `0`
- **AND** `limit` MUST mean maximum line count and default to `2000`
- **AND** `offset` and `limit` MUST be integers, `offset` MUST be greater than or equal to `0`, and `limit` MUST be between `1` and `2000`; invalid values MUST fail capability input schema validation
- **AND** successful payload MUST 受 line-based `offset`、`limit` 和最大输出大小约束
- **AND** successful payload MUST contain `file_path`、`offset`、`limit`、`content`、`truncated` and optional `nextOffset`
- **AND** successful payload `file_path` MUST be a normalized workspace-relative path and MUST NOT expose host absolute path
- **AND** 超限时 MUST 返回 bounded slice，并显式包含 `truncated=true` 和 `nextOffset`
- **AND** safe failure MUST NOT 泄漏未脱敏宿主路径、credential 或未授权对象内容

#### Scenario: tool loop 按工具危险性分级约束每轮 fan-out 并可恢复
- **GIVEN** Agent core SHALL 把 capability 按是否只读分类：read-only capability 集合为 runtime-owned 静态白名单 `{Read, Grep, Glob}`，其余为 side-effecting capability
- **AND** 模型或 capability provider 的任何断言 MUST NOT 改变该只读分类
- **WHEN** 同一模型 round 产生多个 tool calls
- **THEN** Agent core MUST 按 side-effecting count 与 read-only count 分别计上限
- **AND** 每轮 side-effecting tool call 数 MUST NOT 超过 `maxToolCallsPerRound`（默认 5，上限 5）
- **AND** 每轮 read-only tool call 数 MUST NOT 超过 `maxReadOnlyToolCallsPerRound`（默认 20，上限 20）
- **AND** read-only tool call MUST NOT 计入 `maxToolCallsPerRound` 预算，side-effecting tool call MUST NOT 计入 `maxReadOnlyToolCallsPerRound` 预算
- **AND** `executionMode=model-only` 或 `maxToolCalls=0` 时两个上限 MUST 同时为 0，任何 tool call 都 MUST NOT 执行
- **AND** 当 `maxToolCalls=0`（零工具预算）时，发给模型的请求 MUST NOT 携带任何 tool descriptor（`tools` MUST 为空），使模型在请求层即无法生成 tool call；tool loop 的零预算 guard 仅作为防御性兜底
- **AND** 同一 round 内多个 ordinary tool call MAY 受控并行执行，tool result MUST 按模型返回顺序回填
- **AND** 每个 tool call MUST 有独立稳定 `toolCallId`、capability lifecycle events、result message 和 safe error handling
- **AND** 一个 request 最多执行 `maxToolRounds=50`
- **AND** 当 side-effecting count 或 read-only count 超过其上限时该 round 为 over-limit round，MUST NOT 执行该 round 的任何 tool call
- **AND** over-limit round MUST NOT 持久化无对应 tool result 的 assistant tool-use 消息
- **AND** 当 over-limit 且 `maxToolCalls=0`（零预算）时 Agent core MUST 发布 `DEGRADATION_NOTICE`（code `TOOL_CALL_LIMIT_EXCEEDED`）并以 safe `REQUEST_FAILED` 结束，MUST NOT 重试
- **AND** 当 over-limit 且 `maxToolCalls>0`（正预算）时 Agent core MUST 发布 `DEGRADATION_NOTICE`（code `TOOL_CALL_LIMIT_EXCEEDED`）并追加一条 model-visible 纠正消息后重新进入模型 round，MUST NOT 执行任何 tool call
- **AND** 连续 over-limit round 计数 MUST 累加；任意一轮正常执行 tool call 后 MUST 将该计数清零
- **AND** 连续 over-limit round 计数达到 `toolCallLimitRecoveryLimit=3` 时 Agent core MUST 以 safe `REQUEST_FAILED` 结束
- **AND** capability `contextPatch`、动态修改 allowed tools、model name 或 model options MUST NOT 在本 change 生效

#### Scenario: accepted assembly 未显式配置 round limit 时使用统一 fallback
- **WHEN** accepted assembly 未提供 `runtimeSettings.maxToolIterations` 且 `DefaultAgent` 未注入 `deps.maxToolRounds`
- **THEN** tool loop round limit MUST fall back to `50`
- **AND** 该 fallback MUST 与产品默认 builtin agent 的 `maxToolIterations` 保持一致
- **AND** 达到该上限时 MUST 发布 `DEGRADATION_NOTICE` with `TOOL_ROUND_LIMIT_EXCEEDED` 并以 safe `REQUEST_FAILED` 结束

### Requirement: Channel Session Cleanup On Submit Failure

When a channel creates a new session and the subsequent `RuntimeCommandPort.submit` call fails before the run is accepted, the channel MUST perform a best-effort session deletion to avoid leaking an orphan session. This requirement applies to all channel-initiated create-then-submit paths, including Task Channel stream-task create, Task Channel async-tasks create, and Web Channel convenience submit (`POST /api/v1/requests` without `sessionId`).

The cleanup SHALL only delete sessions that were created by the current request. Sessions supplied by the client (existing sessions with a caller-provided `sessionId`) MUST NOT be deleted by the failure-cleanup path.

The session deletion MUST be best-effort: if the deletion itself fails, the channel MUST NOT mask, swallow, or replace the original submit failure error. The original error MUST be the one returned to the caller. The cleanup failure MAY be logged as a diagnostic warning.

This cleanup is safe because a submit failure before run acceptance means no `RequestRun`, user message, timeline event, or active context item has been persisted for the session. The session row is the only persisted artifact, and its deletion via the existing `RuntimeSessionPort.deleteSession` composite cascade is a local persistence operation.

#### Scenario: Task Channel stream-task create submit failure cleans up session
- **WHEN** a caller posts a valid stream-task create body and the channel creates a new session
- **AND** `RuntimeCommandPort.submit` throws before run acceptance (e.g. `CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY`)
- **THEN** the channel MUST call `RuntimeSessionPort.deleteSession` for the newly created session
- **AND** the original error MUST be returned to the caller
- **AND** the session MUST NOT remain in the session list

#### Scenario: Task Channel async-tasks create submit failure cleans up session
- **WHEN** a caller posts an async-tasks create batch and one item's `RuntimeCommandPort.submit` throws before run acceptance
- **THEN** the channel MUST call `RuntimeSessionPort.deleteSession` for that item's newly created session
- **AND** the failed item result MUST contain the original `error` object
- **AND** other items in the batch MUST NOT be affected

#### Scenario: Web Channel convenience submit failure cleans up session
- **WHEN** a caller posts `POST /api/v1/requests` without `sessionId` and the channel creates a new session
- **AND** `RuntimeCommandPort.submit` throws before run acceptance
- **THEN** the channel MUST call `RuntimeSessionPort.deleteSession` for the newly created session
- **AND** the original error MUST be returned to the caller

#### Scenario: Pre-existing session is not deleted on submit failure
- **WHEN** a caller posts a request with a caller-provided `sessionId` and submit fails
- **THEN** the channel MUST NOT delete the session
- **AND** the original error MUST be returned to the caller

#### Scenario: Cleanup failure does not mask original error
- **WHEN** `RuntimeSessionPort.deleteSession` itself throws during cleanup
- **THEN** the channel MUST return the original submit failure error to the caller
- **AND** the cleanup failure MAY be logged as a diagnostic warning
- **AND** the cleanup failure MUST NOT be re-thrown or wrapped into the caller-visible error

#### Scenario: Successful submit does not trigger cleanup
- **WHEN** `RuntimeCommandPort.submit` succeeds and returns a `RequestAccepted`
- **THEN** the channel MUST NOT delete the session
- **AND** the session MUST remain visible in the session list with the accepted run

### Requirement: Conversation cursor and anchor existence validation

`UserSessionService.listMessages` MUST validate that a supplied `beforeCursor` (`cursor`), `afterCursor` (`newerCursor`), or `anchorMessageId` resolves to a message within the requested session `(tenantId, subjectId, agentId, sessionId)` before delegating to the message store. The validation SHALL perform a same-session message lookup keyed by the cursor/anchor message ID (reusing the existing message-store `loadMessage` port); a cursor/anchor that does not resolve, or that resolves to a message whose `sessionId` differs from the requested session (cross-session), MUST fail closed by throwing `AgentError { code: "SESSION_MESSAGE_ANCHOR_NOT_FOUND", category: "NOT_FOUND", retryable: false }`, which the Web channel projects to HTTP `404`.

For `anchorMessageId`, the service MUST additionally fail closed when the message store returns an empty visible page after a resolving lookup (covering the case where a backing store returns an empty set for a hidden anchor); it MUST NOT return `200` with `items: []`. For `beforeCursor`/`afterCursor`, a cursor that resolves but yields no older/newer visible messages (paging boundary) MUST return `200` with an empty items page and `hasMore: false`, and MUST NOT be treated as not-found. A hidden cursor (resolves via the lookup but is filtered out by `includeHidden=false`) is treated as a paging boundary, not an error.

The `cursor`, `newerCursor`, and `anchorMessageId` public query parameters MUST each be 1–64 characters. The Web channel MUST reject a value exceeding 64 characters at the web boundary with HTTP `400` and a field-level `REQUEST_VALIDATION_FAILED` message (`<field> must not exceed 64 characters.`), and MUST NOT forward the value to the backing message store. The three parameters MUST NOT be combined in one request.

**需求类别**：功能性需求

#### Scenario: Non-existent anchor fails closed even on an empty store page
- **WHEN** `listMessages` is called with `anchorMessageId` that does not resolve within the session, or resolves but the store returns an empty visible page
- **THEN** the service MUST throw `SESSION_MESSAGE_ANCHOR_NOT_FOUND`
- **AND** the Web API MUST return `404` and MUST NOT return `200` with `items: []`

#### Scenario: Non-existent cursor or newerCursor fails closed
- **WHEN** `listMessages` is called with `beforeCursor` or `afterCursor` whose message does not resolve within the session (forged, deleted, or cross-session)
- **THEN** the service MUST throw `SESSION_MESSAGE_ANCHOR_NOT_FOUND`
- **AND** the Web API MUST return `404` and MUST NOT return `200` with `items: []`

#### Scenario: Paging boundary returns an empty page
- **WHEN** `listMessages` is called with a `beforeCursor` or `afterCursor` that resolves within the session, and no older/newer visible messages remain
- **THEN** the service MUST return `200` with `items: []` and `hasMore: false`
- **AND** it MUST NOT throw `SESSION_MESSAGE_ANCHOR_NOT_FOUND`

#### Scenario: Cursor or anchor exceeding 64 characters is rejected at the web boundary
- **WHEN** the Web channel receives `cursor`, `newerCursor`, or `anchorMessageId` exceeding 64 characters
- **THEN** it MUST return `400` with a field-level `REQUEST_VALIDATION_FAILED` message
- **AND** it MUST NOT forward the value to the message store
