## ADDED Requirements

### Requirement: Fork From Durable Visible Assistant Message

系统 SHALL 支持用户从源 session 中一条已持久化、visible、可渲染的 assistant message 派生一个新的 child session。派生入口 MUST 由用户操作触发，MUST 通过可信 owner scope 和 Agent Scope 校验源 session 与锚点 message，MUST NOT 由模型输出、capability 参数或客户端请求体覆盖 owner scope、Agent Scope 或源消息归属。

一个 message 可作为 fork anchor 的条件是：它属于当前 owner+agent scoped source session，`role=ASSISTANT`，`visible=true`，content 非空，并且已经作为 conversation history 的持久化 message 出现。仍在 stream delta 中、尚未进入 conversation history 的 assistant 输出 MUST NOT 成为 fork anchor。

Fork eligibility MUST NOT be determined by `RequestRun.status=COMPLETED`. The backend eligibility boundary is the assistant message being durably present in conversation history. If an implementation can observe that the associated source run is still non-terminal, it MUST reject the anchor as a persistence invariant violation.

For UI state that is still represented as live stream envelopes rather than a refreshed conversation snapshot, the system MAY expose a request-scoped fork entry keyed by the source request/root message id. That entry MUST NOT fork live stream content directly. It MUST resolve the request id to exactly one owner+agent scoped, visible, non-empty, durably persisted assistant message whose metadata records `REQUEST_COMPLETED` / `COMPLETED`, then delegate to the normal message-anchor fork path. If the request has no completed durable assistant message, has a failed/canceled/superseded terminal message, is still streaming, or resolves to more than one completed assistant candidate, the request-scoped fork MUST fail safely and MUST NOT create a child session.

The source title snapshot used for the child session title and fork notice MUST use a session-domain normalized title: trim the source session title when present, and use `Untitled session` when the title is missing or trim-empty. This normalization MUST NOT depend on Web `displayTitle` aliases or Web channel helpers.

#### Scenario: Completed live request fork resolves to a durable assistant anchor
- **WHEN** the client asks to fork by source request/root message id after a live assistant response is marked completed
- **THEN** runtime MUST resolve that request id to exactly one durable visible assistant message with completed terminal metadata
- **AND** runtime MUST invoke the normal message-anchor fork path using that resolved assistant message id
- **AND** runtime MUST reject the request-scoped fork when the request is still streaming, failed, canceled, superseded, has no durable completed assistant message, or has multiple completed assistant candidates
- **AND** runtime MUST NOT copy raw live stream envelopes into the child session

#### Scenario: 用户从已持久化 assistant 回复派生新会话
- **WHEN** 用户对当前 owner+agent scoped source session 中一条已持久化、可渲染的 assistant message 发起 fork
- **THEN** 系统 MUST 创建一个新的 child session
- **AND** child session MUST 使用新的 `sessionId`
- **AND** child session 的标题 MUST 使用源 session 在 fork 时的标题快照
- **AND** fork response MUST 返回 child session 的安全 metadata，至少包含 child `sessionId`、display title 和 last activity time

#### Scenario: 尚未持久化的 assistant 输出不可派生
- **WHEN** assistant 输出仍只存在于 live stream delta 或 active run projection 中，尚未作为 visible assistant message 进入 conversation history
- **THEN** fork command MUST 拒绝该 anchor
- **AND** 系统 MUST NOT 创建 child session、message、active context item 或 fork metadata
- **AND** 对外错误 MUST 使用安全错误，不泄漏 stream delta 或 raw model output

#### Scenario: 不可渲染或非 assistant message 不可派生
- **WHEN** fork anchor 指向 user、system、capability result、hidden message、空内容 assistant message 或不存在的 message
- **THEN** fork command MUST 以安全错误拒绝
- **AND** 系统 MUST NOT 创建 child session 或任何派生持久化事实

#### Scenario: 跨 owner 或跨 agent anchor 被拒绝
- **WHEN** fork command 的可信 owner scope 或 Agent Scope 与 source session 或 anchor message 不匹配
- **THEN** 系统 MUST 以 safe not-found outcome 拒绝
- **AND** 系统 MUST NOT 泄漏源 session 或 anchor message 是否存在于其他 owner 或 agent scope

### Requirement: Child Session Inherits Prefix And Model-Visible Context

系统 SHALL 在 fork 时复制 source session 从开头到 anchor message 的 canonical conversation prefix，并用复制后的 child message ids 初始化 child active context。child conversation read MUST 展示与 source conversation 在 fork 时截至 anchor 的可见消息序列等价的内容，但 message ids、session id 和 child-side request grouping MUST 属于 child session。

child active context MUST 只引用 child session 中的 message ids。child active context state 的 `activeContextVersion` MUST 初始化为 `0`，item ordinals MUST 从 `0` 连续递增。系统 MUST NOT 直接引用 parent message ids，MUST NOT 复制 parent 当前 active context，MUST NOT 保存或回放任意历史 active context snapshot 来实现 fork。fork 后 child 的首次 submit MUST 使用 child active context 作为模型可见历史来源，而不是扫描 parent history 或全量 child history。

copied child messages MUST be produced by safe child message projection. The projection MUST cover message content, metadata, replacement evidence, summary metadata, `ContentRef` and backing refs. Known typed metadata MUST be remapped, cleared or rejected according to its field semantics. Unknown metadata MAY be retained only when it does not contain source run ids, checkpoint refs, timeline refs, raw provider fields, parent invocation lineage, source execution paths, host paths or execution-bound refs. Unknown metadata containing any such source-bound/runtime-only value MUST fail the fork safely and MUST NOT be silently copied. Durable owner+agent scoped attachment/artifact/blob refs MAY be retained or remapped only when child-accessible. Ordinary workspace file references MAY be retained only when they are already child-accessible through the same owner+agent workspace policy. Execution-bound refs such as `tool-results/<refId>`, source run workspace paths, session temp/generated output roots, `.nextagent` temp/cache/log/test-output paths, host tmp/cache/log/test-output paths or provider invocation scratch paths MUST NOT be copied as-is; they MUST be promoted to durable child-accessible content and rewritten, or the fork MUST fail atomically.

First-version promotion is limited to normalized `tool-results/<refId>` refs that runtime can resolve to bytes through the existing trusted source workspace/sandbox/resolver boundary. If runtime can only observe a source execution path, host path, temp/generated output path, tmp/cache/log/test-output path or unrecognized execution-bound ref shape, the fork MUST fail safely before child persistence and MUST synchronously abort any staged promotions for the current fork attempt. The implementation MUST NOT introduce a generic host-file read port for fork.

#### Scenario: Child conversation 展示锚点前可见历史
- **WHEN** fork 成功后客户端读取 child session conversation
- **THEN** response MUST 包含 source session 在 fork 时从开头到 anchor 的可见消息序列
- **AND** 每条 copied message MUST 使用 child session 的 `sessionId`
- **AND** 每条 copied message MUST 使用新的 child `messageId`
- **AND** copied message content、role、content type 和可见性 MUST 与 source prefix 在 fork 时的对应可见行为一致

#### Scenario: Child active context 只引用 child message ids
- **WHEN** fork 成功后系统读取 child session 的 active context
- **THEN** active context items MUST 全部引用 child session 中存在的 message ids
- **AND** active context items MUST NOT 引用 source session 的 message ids
- **AND** active context items MUST NOT 包含 source anchor 之后的消息
- **AND** child active context state `activeContextVersion` MUST 为 `0`

#### Scenario: 历史锚点不继承 parent 当前 active context
- **WHEN** source session 在 anchor 之后已经产生新消息或发生 context compaction
- **AND** 用户从历史 anchor 发起 fork
- **THEN** child active context MUST 只反映截至 anchor 的 copied prefix
- **AND** child active context MUST NOT 包含 source session anchor 之后的 message refs
- **AND** 系统 MUST NOT 通过 parent 当前 active context 决定 child model-visible context

#### Scenario: 压缩 summary 不与 covered originals 重复进入 child active context
- **WHEN** copied prefix 中包含 context compression `SUMMARY` message
- **AND** 该 summary metadata 覆盖 prefix 中更早的 copied child message ids
- **THEN** child active context MUST reference the child summary message id when the summary is selected for model visibility
- **AND** child active context MUST NOT also reference the covered original child message ids
- **AND** summary metadata refs MUST all be remapped to child message ids present in the copied prefix
- **AND** fork MUST fail if the summary refs cannot be safely remapped

#### Scenario: Child 首次 submit 使用继承后的 active context
- **WHEN** 用户在刚派生的 child session 中提交第一条新消息
- **THEN** context assembly MUST 从 child active context 读取 prior history
- **AND** 模型输入 MUST 能使用 fork anchor 之前的 child-side context
- **AND** context assembly MUST NOT 为该 submit 读取 parent session history、parent active context、parent timeline 或 parent checkpoint

### Requirement: Forked Session Is Isolated From Source Session

fork 后 child session SHALL 作为独立 session 演进。child 的后续 user message、RequestRun、timeline、checkpoint、active context、pending input、tool state、stream projection、conversation annotations 和 fork 后生成的 artifacts MUST 与 source session 隔离。fork 操作本身 MUST NOT 创建 RequestRun，MUST NOT 调用 Agent core，MUST NOT 调用 model provider，MUST NOT 修改 source session 的 messages、active context、timeline 或 runs。

#### Scenario: Fork 不修改 source session
- **WHEN** fork command 成功创建 child session
- **THEN** source session 的 messages、active context、timeline、RequestRun 和 checkpoint facts MUST 保持不变
- **AND** source session 的 active run 状态 MUST 不受 fork 影响

#### Scenario: Child 后续 submit 不写回 source
- **WHEN** 用户在 child session 中提交新消息并产生新的 run
- **THEN** 新 user message、assistant message、RequestRun、timeline events 和 active context items MUST 写入 child session
- **AND** source session MUST NOT 出现 child 后续 submit 产生的任何 message、run、timeline event 或 active context item

#### Scenario: Runtime state 不被继承
- **WHEN** source session 在 fork 时存在 checkpoint、pending input、stream delta、raw provider error、tool state 或未完成 run state
- **THEN** child session MUST NOT 继承这些 runtime state
- **AND** child session 只能继承截至 anchor 的 durable conversation prefix 和由该 prefix 初始化出的 active context

#### Scenario: Copied message projection 不保留 parent runtime truth
- **WHEN** fork materializes copied child messages
- **THEN** child message content and metadata MUST NOT contain source run ids、checkpoint refs、timeline refs、raw provider fields、source-bound workspace/file refs or parent invocation lineage
- **AND** message refs that remain necessary for model-visible behavior MUST be remapped to child message ids
- **AND** content, metadata or backing refs that cannot be safely remapped, promoted or proven child-accessible MUST cause fork failure

#### Scenario: Execution-bound capability result is promoted before child can continue
- **WHEN** source prefix contains an oversized capability result whose model-visible message points at `tool-results/<refId>`
- **AND** the fork succeeds
- **THEN** the copied child message MUST NOT contain the source execution workspace file path
- **AND** the child message MUST reference durable owner+agent scoped content that is resolvable from the child session through a child-accessible `ContentRef`
- **AND** the child message MUST NOT expose an internal `BlobRef`
- **AND** the child first submit model input MUST NOT instruct the model to read a source execution workspace path

#### Scenario: Unpromotable execution-bound ref fails fork atomically
- **WHEN** copied message content, metadata or backing refs contain an execution-bound ref
- **AND** runtime cannot resolve it to bytes through an existing trusted workspace/sandbox/resolver boundary and promote it to durable child-accessible content
- **THEN** fork MUST return safe failure
- **AND** system MUST NOT create a visible child session, copied message or child active context item

### Requirement: Fork Notice Projection

系统 SHALL 为 forked child session 提供窄化的 public fork notice projection。child session 在 fork 后尚未提交新 user message 时，默认/latest conversation bootstrap response MUST 包含 `forkNotice`，用于客户端在消息区域底部居中显示“由某会话派生”。`forkNotice` MUST 只包含打开源 session 所需的 `sourceSessionId` 和用于显示的 `sourceSessionTitle` 快照。用户在 child session 中提交第一条 fork 后 user message 后，默认/latest conversation bootstrap response MUST 不再返回 `forkNotice`。

fork notice 的显示条件 MUST 基于 child session 中 child anchor 之后是否存在 user message，而不是基于 `forkedAt` 是否存在。`forkNotice` is not a message, MUST NOT enter active context, and MUST NOT be returned for cursor-based, newer-cursor-based or anchor-message conversation reads.

#### Scenario: 刚派生的 child session 显示 fork notice
- **WHEN** 客户端读取刚 fork 成功且尚无 fork 后 user message 的 child session conversation
- **THEN** response MUST 包含 `forkNotice`
- **AND** `forkNotice.sourceSessionId` MUST 指向 source session
- **AND** `forkNotice.sourceSessionTitle` MUST 使用 fork 创建时记录的源标题快照
- **AND** response MUST NOT 暴露 source anchor message id、child anchor message id 或完整 fork source record

#### Scenario: Child 提交新消息后不再显示 fork notice
- **WHEN** child session 中已存在 child anchor 之后的 user message
- **THEN** conversation response MUST NOT 返回 `forkNotice`

#### Scenario: 分页或锚点读取不返回 fork notice
- **WHEN** client reads child conversation with `cursor`, `newerCursor` or `anchorMessageId`
- **THEN** response MUST NOT include `forkNotice`
- **AND** returned messages MUST remain ordinary conversation projection items, not synthetic fork notice messages

#### Scenario: 源会话标题后续变化不影响 notice 文案
- **WHEN** fork 创建后 source session 被重命名
- **THEN** child session 的 `forkNotice.sourceSessionTitle` MUST 继续使用 fork 创建时的标题快照
- **AND** fork notice link target MUST 仍为 source session

#### Scenario: 空源标题使用 domain 默认标题
- **WHEN** source session title 缺失或 trim 后为空
- **THEN** fork 创建的 child session title MUST 使用 `Untitled session`
- **AND** `forkNotice.sourceSessionTitle` MUST 使用同一个 normalized title snapshot

#### Scenario: forkNotice source link uses existing session access semantics
- **WHEN** child session 可访问但 source session 已删除、不可用或当前 identity 无权打开 source session
- **THEN** child conversation response MUST 仍可返回基于标题快照的 `forkNotice`
- **AND** `forkNotice` MUST NOT include source availability, deletion or access state
- **AND** 打开 source session 的请求 MUST 按现有 owner+agent scope 规则返回 safe not-found outcome

### Requirement: Fork Idempotency

fork command SHALL 是 retry-safe 的。fork command MUST receive a normalized `idempotencyKey` produced by the Web route from a required opaque bounded token: trim the client string, reject trim-empty values, and reject values longer than 128 characters after trim. 相同 owner scope、Agent Scope、source session、source anchor message 和相同 normalized `idempotencyKey` 的重复 fork MUST 返回首次创建的 child session。使用不同 `idempotencyKey` 对同一 source anchor 发起 fork MUST 创建新的 child session。幂等冲突 MUST 不重复复制 messages、active context 或 fork metadata。日志、metric、audit 和 safe diagnostics MUST NOT 记录原始 `idempotencyKey`。

#### Scenario: 相同 idempotencyKey 重试返回同一 child session
- **WHEN** 客户端因网络重试使用相同 `idempotencyKey` 对同一 source anchor 发起 fork
- **THEN** 系统 MUST 返回首次 fork 创建的 child session
- **AND** 系统 MUST NOT 创建第二个 child session、第二批 copied messages 或第二组 active context items
- **AND** 系统 MUST NOT repeat execution-bound content resolution or create a second set of staged promotions for an already committed idempotency anchor

#### Scenario: 不同 idempotencyKey 可再次派生
- **WHEN** 用户对同一 source anchor 使用新的 `idempotencyKey` 再次发起 fork
- **THEN** 系统 MUST 创建另一个新的 child session
- **AND** 两个 child sessions MUST 彼此隔离

#### Scenario: 相同 idempotencyKey 不得跨 scope 命中
- **WHEN** 不同 owner、agent、source session 或 source anchor 使用相同 `idempotencyKey`
- **THEN** 系统 MUST NOT 返回其他 scope 或其他 anchor 的 child session
- **AND** 幂等 anchor lookup MUST 受 trusted owner scope、Agent Scope、source session 和 source anchor 约束

#### Scenario: 失败 attempt 不占用成功幂等锚点
- **WHEN** fork materialization 在 child session commit 前失败
- **THEN** 系统 MUST NOT 写入表示成功 child session 的 idempotency anchor
- **AND** 使用相同 `idempotencyKey` 重试时 MUST 重新尝试 fork，而不是返回不存在的 child session
- **AND** `STAGED` 或 `ABORTED` promotion residue MUST NOT be treated as a successful idempotency hit

#### Scenario: commit 后响应失败按成功重试处理
- **WHEN** fork composite write 已成功提交 child session、copied messages、active context、fork source、idempotency anchor，并在同一 transaction 内将 matching promotion metadata 标记为 `COMMITTED`
- **AND** Web response delivery later fails
- **THEN** 使用相同 `idempotencyKey` 重试 MUST 返回首次创建的 child session
- **AND** 系统 MUST NOT abort or cleanup `COMMITTED` promotion as if the fork failed
- **AND** retry handling MUST not depend on source execution-bound refs still being readable

### Requirement: Fork Failure Is Atomic And Safe

fork 持久化 SHALL 是原子操作。创建 child session、复制 child messages、初始化 child active context、保存 fork source metadata 和幂等 anchor 任一步失败时，系统 MUST 返回安全错误，并且 MUST NOT 留下可见的部分 child session。错误响应、日志、metric、audit 或 safe diagnostics MUST NOT 包含 raw prompt、raw provider error、stream delta、tool result、附件内容、credential、token 或未脱敏路径。

Execution-bound promotion staging MUST be business-invisible until the fork is committed. Staging is not a runtime filesystem directory or host path. Staged bytes MAY be stored in an opaque blob store, but visibility MUST be controlled by owner+agent scoped promotion metadata whose lifecycle distinguishes `STAGED`, `COMMITTED` and `ABORTED`. `STAGED` or `ABORTED` promoted content MUST NOT be observable through conversation reads, artifact/content resolvers, model context, Web projection, safe errors or audit/log details. Fork failure MUST synchronously attempt promotion abort for the current fork attempt; scheduled cleanup only retries invisible residue and is not the safety boundary.

#### Scenario: 持久化中途失败不留下可见 child session
- **WHEN** fork composite write 在创建 child session、复制 messages、初始化 active context 或保存 fork metadata 的任一步失败
- **THEN** fork command MUST 返回 safe failure
- **AND** child session MUST 不可通过 session list 或 conversation read 观察到
- **AND** source session MUST 保持不变

#### Scenario: Active context 初始化失败导致 fork 失败
- **WHEN** child messages 已准备好但 child active context 初始化失败
- **THEN** fork command MUST 整体失败
- **AND** 系统 MUST NOT 返回 child session
- **AND** 系统 MUST NOT 退化为仅复制 history、active context 为空或 current-request-only 的 child session

#### Scenario: Resource preflight failure is atomic
- **WHEN** source prefix, safe child message projection, durable promotion or composite write cost exceeds the runtime-owned operation resource budget for copied message count, copied content bytes, promotion ref count or promoted bytes
- **THEN** fork command MUST return safe failure such as `SESSION_FORK_RESOURCE_EXHAUSTED`
- **AND** system MUST NOT silently truncate copied prefix
- **AND** system MUST NOT leave a visible child session, partial copied messages, partial durable promotions or partial active context

#### Scenario: Staged promotion is invisible before fork commit
- **WHEN** fork materialization stages promoted content for an execution-bound ref
- **AND** fork commit has not completed
- **THEN** conversation read, session list, artifact/content resolver and model context assembly MUST NOT observe the staged promoted content
- **AND** Web projection, safe errors, audit logs and metrics MUST NOT expose the staged content, internal `BlobRef` or source execution path

#### Scenario: Committed promotion is resolved through metadata
- **WHEN** fork materialization commits a promoted content id for a copied child message
- **THEN** normal content resolver paths MUST resolve it only through owner+agent scoped `COMMITTED` promotion metadata and the target child session/message coordinates
- **AND** the promoted content id MUST NOT be readable as a generic `BlobRef`

#### Scenario: Fork failure aborts staged promotion safely
- **WHEN** execution-bound content has been staged for promotion
- **AND** fork materialization later fails before the child session is committed
- **THEN** the fork MUST return safe failure
- **AND** the staged promoted content MUST remain invisible to normal read and resolver paths
- **AND** the system MUST synchronously attempt to mark the staged promotion `ABORTED`
- **AND** the system MAY best-effort delete the underlying blob before returning safe failure
- **AND** cleanup failure MUST NOT make the promoted bytes visible or child-accessible

#### Scenario: Promotion stage metadata failure is cleaned before failure
- **WHEN** promotion staging writes blob bytes but cannot durably write `STAGED` metadata
- **THEN** the stage operation MUST fail before child persistence
- **AND** the system MUST best-effort delete the just-created blob
- **AND** the fork command MUST return safe failure without a visible child session

#### Scenario: Fork promotion cleanup retries only invisible residue
- **WHEN** the scheduled fork-promotion cleanup job runs
- **THEN** it MUST only process `STAGED` or `ABORTED` promotions older than the configured retention window
- **AND** it MUST first make expired `STAGED` records `ABORTED`
- **AND** when an `ABORTED` record's blob is missing or deleted successfully, it MUST delete the promotion metadata
- **AND** blob delete failure MUST keep the `ABORTED` promotion metadata retryable for a later cleanup run
- **AND** it MUST NOT mutate `COMMITTED` promotions, child messages, child active context, source messages or source execution workspace files

#### Scenario: Safe diagnostics 不泄漏敏感内容
- **WHEN** fork 失败并产生日志、metric、audit 或 diagnostic
- **THEN** diagnostics MUST 只包含安全错误码、hashed 或 bounded refs、operation outcome 和低基数字段
- **AND** diagnostics MUST NOT 包含 copied message content、raw model output、stream delta、tool result、prompt、credential 或附件内容
