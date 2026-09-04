## MODIFIED Requirements

### Requirement: Child Session Inherits Prefix And Model-Visible Context

系统 SHALL 在 fork 时复制 source session 从开头到 anchor message 的 canonical conversation prefix，并用复制后的 child message ids 初始化 child active context。child conversation read MUST 展示与 source conversation 在 fork 时截至 anchor 的可见消息序列等价的内容，但 message ids、session id、child-side request grouping 和 child-scoped run anchors MUST 属于 child session。

child active context MUST 只引用 child session 中的 message ids。child active context state 的 `activeContextVersion` MUST 初始化为 `0`，item ordinals MUST 从 `0` 连续递增。系统 MUST NOT 直接引用 parent message ids，MUST NOT 复制 parent 当前 active context，MUST NOT 保存或回放任意历史 active context snapshot 来实现 fork。fork 后 child 的首次 submit MUST 使用 child active context 作为模型可见历史来源，而不是扫描 parent history 或全量 child history。

copied message 的 child-owned identity 覆盖 `messageId`、`sessionId`、`requestId` 和 `runId` 字段。对携带 `runId` 的 source message，fork MUST 为其 copied message 铸造 child-scoped run anchor：同一 source run 的 copied messages MUST 共享同一个新 child run id；不同 source run MUST 映射到不同 child run id；run anchor MUST NOT 等于任何 source `runId`；source message 无 `runId` 时其 copied message MUST NOT 携带 `runId`。run anchor 与 source run 的对应关系 MUST NOT 持久化。run anchor 只是 durable message 的分组/读取锚点，fork MUST NOT 为 run anchor 创建 RequestRun、timeline event 或 checkpoint 事实。

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

#### Scenario: 继承问答对携带 child-scoped run anchor
- **WHEN** fork 成功且 source prefix 中的 messages 携带 `runId`
- **THEN** 每条携带 `runId` 的 source message 的 copied message MUST 携带 child-scoped run anchor
- **AND** 同一 source run 的 copied messages MUST 共享同一个 run anchor
- **AND** 不同 source run 的 copied messages MUST 使用不同 run anchor
- **AND** run anchor MUST NOT 等于任何 source `runId`
- **AND** child session MUST NOT 出现与 run anchor 对应的 RequestRun、timeline event 或 checkpoint 事实

#### Scenario: 无 runId 的 source message 不获得 run anchor
- **WHEN** source prefix 中的 message 未携带 `runId`
- **THEN** 其 copied message MUST NOT 携带 `runId`

#### Scenario: 继承问答对可经 conversation share 分享
- **WHEN** 用户在 child session 中勾选继承的问答对创建分享
- **THEN** 分享创建的 `runIds` 快照 MUST 能引用 copied messages 的 run anchor
- **AND** 分享读取 MUST 返回 run anchor 对应的 copied messages
- **AND** 分享读取 MUST NOT 返回 source session 的任何 message、run 或 timeline 事实

### Requirement: Forked Session Is Isolated From Source Session

fork 后 child session SHALL 作为独立 session 演进。child 的后续 user message、RequestRun、timeline、checkpoint、active context、pending input、tool state、stream projection、conversation annotations 和 fork 后生成的 artifacts MUST 与 source session 隔离。fork 操作本身 MUST NOT 创建 RequestRun，MUST NOT 调用 Agent core，MUST NOT 调用 model provider，MUST NOT 修改 source session 的 messages、active context、timeline 或 runs。

copied message 携带的 child-scoped run anchor 是 durable message 的分组/读取锚点，不是 runtime 事实。run anchor MUST NOT 等于任何 source `runId`，与 source run 的对应关系 MUST NOT 持久化，MUST NOT 被 cancel/retry/edit/recovery/stream/activeRun 等 lifecycle 路径当作可操作的 run。

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

#### Scenario: Run anchor 不是 runtime lifecycle 事实
- **WHEN** child session 中存在携带 run anchor 的 copied messages
- **THEN** runtime MUST NOT 为 run anchor 创建 RequestRun、timeline、checkpoint、pending input 或 lane queue 事实
- **AND** cancel/retry/edit/recovery/stream/activeRun 等 lifecycle 路径 MUST NOT 把 run anchor 当作可操作的 run
- **AND** run anchor MUST NOT 可解析回 source run
