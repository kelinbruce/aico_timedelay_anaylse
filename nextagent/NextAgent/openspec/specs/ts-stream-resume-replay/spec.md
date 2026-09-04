# ts-stream-resume-replay Specification

## Purpose
定义 TS 前端在 SSE/WebSocket 断线重连、activeRun bootstrap 和 accepted-request recovery 中使用 session-scoped cursor 与 run-scoped replay 的一致语义。
## Requirements
### Requirement: Stream Resume Uses In-Memory Cursor
TS 前端 SHALL treat `lastSeenSequence` as an in-memory, session-scoped cursor for the current page lifecycle. The cursor SHALL exist only after the current page has accepted at least one timeline-backed `StreamEnvelope`. The cursor SHALL advance only after a timeline-backed `StreamEnvelope` is successfully accepted by the frontend stream consumer. The frontend SHALL NOT persist stream resume cursor in sessionStorage for use after page refresh, new tab, or another device.

#### Scenario: Same page reconnect resumes after the last displayed sequence
- **WHEN** the current page has accepted timeline-backed stream envelopes through session timeline sequence `N`
- **AND** the stream disconnects without a page refresh
- **THEN** the next stream connection MUST use `lastSeenSequence=N`
- **AND** the backend MUST replay only events with session timeline `sequence > N`
- **AND** replay completion MUST continue into live stream for the same session

#### Scenario: Same page reconnect without an accepted cursor omits lastSeenSequence
- **WHEN** the current page has not accepted any timeline-backed stream envelope in memory
- **AND** the stream disconnects or reconnects
- **THEN** the frontend MUST NOT send `lastSeenSequence=0` as a substitute cursor
- **AND** the stream connection MUST omit `lastSeenSequence` unless it is performing activeRun or accepted-run bounded replay
- **AND** the frontend MUST use same-session conversation refresh and activeRun bootstrap rules to recover any visible state that cannot be trusted from the no-cursor stream

#### Scenario: Legacy persisted cursor is ignored after page load
- **WHEN** a page is opened or refreshed and sessionStorage contains an old stream cursor
- **THEN** the frontend MUST NOT use that persisted value as the resume anchor
- **AND** if the current page has not accepted timeline-backed envelopes in memory, the frontend MUST omit `lastSeenSequence` for ordinary session-level stream open
- **AND** the frontend MUST use activeRun scoped replay only when conversation bootstrap returns an activeRun that has not already been terminally observed by the current page

#### Scenario: Cold-start session open uses conversation before live-tail
- **WHEN** a page is refreshed, opened in a new tab, opened on another device, or switches to an existing session without an in-memory stream cursor
- **THEN** the frontend MUST load conversation bootstrap as the initial committed history source before opening an ordinary session-level stream
- **AND** if conversation bootstrap does not return a non-terminal `activeRun`, the ordinary session-level stream MUST omit `lastSeenSequence`
- **AND** after that no-cursor live-tail is established, the frontend MUST perform one opening conversation reconcile and merge it with already accepted live envelopes without duplicating visible turns or process details

### Requirement: Active Run Bootstrap Replays Current Run From Zero
TS frontend and backend SHALL support restoring an in-progress current run after page refresh, new tab, or another device opens the same session. When conversation bootstrap returns top-level `activeRun { requestId, runId, status }`, the frontend SHALL open a run-scoped stream with `activeRun.requestId`, `activeRun.runId`, and `lastSeenSequence=0` unless the current page has already accepted a terminal timeline-backed envelope for the same `requestId/runId`. ActiveRun bootstrap identity SHALL be keyed by `requestId + runId`, not by whether a session-level cursor already exists.

#### Scenario: Page refresh restores already generated active run content
- **WHEN** a user refreshes a page while the current run has generated user-visible stream content that has not yet become visible history
- **AND** conversation bootstrap returns `activeRun`
- **THEN** the frontend MUST open stream with `activeRun.requestId`, `activeRun.runId`, and `lastSeenSequence=0`
- **AND** the backend MUST replay recoverable stream content for that active run before continuing live
- **AND** the frontend MUST NOT use a persisted cursor that skips the already generated active run content

#### Scenario: Another device opens an executing session
- **WHEN** a device without local cursor opens a session with a non-terminal `activeRun`
- **THEN** visible history MUST load from conversation history
- **AND** current run stream content MUST recover through `activeRun.requestId`, `activeRun.runId`, and `lastSeenSequence=0`
- **AND** the frontend MUST NOT infer active run identity by scanning visible history messages

#### Scenario: ActiveRun bootstrap is not skipped by an unrelated session cursor
- **WHEN** the current page opens a no-cursor session stream and accepts a timeline-backed envelope
- **AND** conversation bootstrap later returns an `activeRun` whose `requestId/runId` has not been bootstrapped and has not been terminally observed by the current page
- **THEN** the frontend MUST still perform activeRun scoped replay with `lastSeenSequence=0`, `requestId`, and `runId`
- **AND** the existing session cursor MUST NOT be treated as proof that previously generated activeRun content was recovered

### Requirement: Gap Recovery Gates Resume Anchor
TS frontend SHALL NOT treat a gap notice as a cursor advance. `resumeAfterSequence` SHALL be used only after the same session visible conversation refresh succeeds.

#### Scenario: Gap notice requires refresh before using resumeAfterSequence
- **WHEN** stream resume returns `STREAM_RESUME_GAP` with `resumeAfterSequence`
- **THEN** the frontend MUST keep the current in-memory cursor unchanged
- **AND** the frontend MUST refresh the same session visible conversation
- **AND** only after refresh succeeds MAY the next stream connection use `lastSeenSequence=resumeAfterSequence`

#### Scenario: Refresh failure keeps the last accepted cursor
- **WHEN** stream resume returns `STREAM_RESUME_GAP`
- **AND** the same session visible conversation refresh fails
- **THEN** the frontend MUST NOT use `resumeAfterSequence`
- **AND** the frontend MUST keep showing a degraded or disconnected state
- **AND** any later retry MUST use the last timeline-backed sequence accepted by the current page lifecycle

### Requirement: SSE And WebSocket Resume Equivalence
TS Web stream transport SHALL use the same resume inputs for SSE and WebSocket: `sessionId`, optional `lastSeenSequence`, optional `requestId`, and optional `runId`. Transport framing MAY differ, but recovery semantics SHALL be equivalent.

#### Scenario: Same resume input produces equivalent transport requests
- **WHEN** the frontend opens SSE and WebSocket streams for the same session, cursor, request filter, and run filter
- **THEN** both transports MUST carry the same `lastSeenSequence`, `requestId`, and `runId`
- **AND** omitting `lastSeenSequence` in one transport MUST omit it in the other transport
- **AND** switching transport MUST NOT create a new `RequestRun`
- **AND** switching transport MUST NOT change session-scoped sequence semantics

### Requirement: Accepted Request Recovery Uses Run-Scoped Replay When Session Stream Is Unreliable
TS frontend SHALL use accepted request coordinates for bounded recovery when a user action creates a new run but the session-level stream cannot be trusted to already cover the run's early events.

#### Scenario: Submit accepted while session stream is not covering new live events
- **WHEN** submit returns `requestId` and `runId`
- **AND** the current session-level stream is not connected, is disconnected, is reconnecting, is handling timeout/gap recovery, or has not yet established its live-tail boundary
- **THEN** the frontend MUST recover the accepted run through a run-scoped stream with `lastSeenSequence=0`, the accepted `requestId`, and the accepted `runId`
- **AND** the frontend MUST NOT wait for the stream activity timeout before starting this bounded recovery

#### Scenario: Submit accepted while connected no-cursor live-tail has no cursor yet
- **WHEN** submit returns `requestId` and `runId`
- **AND** the current session-level no-cursor live-tail is connected and has established its live boundary
- **AND** the current page has not yet accepted a timeline-backed session stream cursor
- **THEN** the frontend MUST NOT start an additional run-scoped replay only because the cursor is absent
- **AND** the connected session live-tail MUST be treated as covering events emitted after that boundary

#### Scenario: Retry or edit accepted while session stream is disconnected
- **WHEN** retry or edit returns a new accepted `requestId` and `runId`
- **AND** the current session stream is disconnected, reconnecting, or otherwise not usable for session-level resume
- **THEN** the frontend MUST recover the accepted run through a run-scoped stream with `lastSeenSequence=0`, the accepted `requestId`, and the accepted `runId`
- **AND** terminal delivery for that run MUST return the page to session-level stream recovery rules

### Requirement: Stream Cursor And Run Coverage Require Consumer Acceptance

TS frontend SHALL 把 session resume cursor 与 exact-run coverage 作为两个不同事实管理。session cursor 仅表示当前页面中该 envelope 的 owning frontend consumer 已接纳到的最高 timeline-backed sequence；当前 request/run 的 conversation envelope 必须由 conversation store 接纳，background-task envelope 必须由既有 background-task consumer 接纳。exact-run coverage SHALL 使用 `requestId + runId` 标识。其他 run 的有效 envelope可以推进 session cursor并建立其自身 coverage，但 transport open、frame arrival、仅通过 schema validation 或其他 run 的 coverage MUST NOT 证明目标 run 已被 conversation consumer 接纳。

Timeline-backed envelope MUST 在 identity binding、attempt isolation 和 conversation store acceptance 成功后才能推进 session cursor 和对应 exact-run coverage。被 invalid schema、wrong session、stale attempt 或 identity mismatch 拒绝的 envelope MUST NOT 推进 cursor，也 MUST NOT 阻止目标 `activeRun` 使用既有 run-scoped replay 规则恢复。

Connected live-tail 对当前页面新 accepted run 的覆盖判断继续遵守既有 accepted request recovery 规则；本 requirement 不新增第二条 replay 路径。SSE 与 WebSocket MUST 使用相同的 consumer acceptance、cursor 和 exact-run coverage 语义。

#### Scenario: Unrelated session event does not suppress activeRun replay

- **GIVEN** 当前页面已接纳其他 run 或 background activity 的 timeline-backed envelope，并形成 session cursor
- **AND** conversation bootstrap 随后返回一个尚未被当前页面接纳、也未观察到 terminal 的 `activeRun`
- **WHEN** frontend 决定是否执行 activeRun bootstrap
- **THEN** 现有 session cursor MUST NOT 被当作该 `requestId + runId` 已覆盖的证明
- **AND** frontend MUST 按既有规则使用该 activeRun 的 `requestId`、`runId` 和 `lastSeenSequence=0` 执行 run-scoped replay

#### Scenario: Accepted matching event establishes exact-run coverage

- **GIVEN** 当前页面已打开 session stream
- **WHEN** conversation consumer 成功接纳目标 `requestId + runId` 的 timeline-backed envelope
- **THEN** frontend SHALL 记录该 exact run 已被当前页面覆盖
- **AND** 同一 activeRun identity 后续出现时 MUST NOT 仅因 bootstrap state 更新而启动重复 run-scoped replay

#### Scenario: Pre-HTTP exact-run coverage remains valid only when projection survives binding

- **GIVEN** conversation consumer 已在 HTTP response 前接纳某个 exact request/run 的普通 event 或 terminal
- **AND** frontend 已记录该 exact run 的 coverage
- **WHEN** HTTP response 随后把 local optimistic Turn 绑定到相同 request/run
- **THEN** 已接纳的 active/settled bucket MUST 在 binding 后继续存在于同一 Turn
- **AND** 如果 binding 无法保留该 bucket，coverage MUST NOT 阻止该 exact run 使用现有 bounded recovery

#### Scenario: Rejected event cannot advance resume state

- **GIVEN** stream transport 收到 timeline-backed envelope
- **WHEN** 该 envelope 因 invalid schema、wrong session、stale attempt 或无法完成 current pending identity binding 而未被其 owning frontend consumer 接纳
- **THEN** frontend MUST 保持当前 session cursor 不变
- **AND** frontend MUST NOT 把该 envelope 的 `requestId + runId` 标记为已覆盖
- **AND** 后续 matching activeRun recovery MUST 仍可执行

#### Scenario: Batched live envelopes advance after store commit

- **GIVEN** 多条可批处理 live envelope 在同一 animation frame 内到达
- **WHEN** conversation store 接纳该 batch
- **THEN** session cursor SHALL 推进到该 batch 中已接纳的最高 timeline sequence
- **AND** cursor MUST NOT 在 batch 尚未提交到 conversation consumer 前提前推进
- **AND** frame batching MUST NOT 改变 envelope 的顺序、attempt isolation 或 terminal handling

### Requirement: Timeline 重放总量限制

Runtime timeline stream 的 `streamOwned` 重放循环 MUST 限制全量重放的总事件数和总时间，防止超大 session 的 `?lastSeenSequence=0` 请求耗尽 CPU 和内存。重放循环 MUST 在循环外初始化 `replayedCount`（已重放事件计数）和 `replayStartTime`（重放开始时间戳），并在每批 timeline 事件读取后检查：

- 当 `replayedCount` 超过 `maxReplayTotalEvents`（10000）时，MUST 抛 `AgentError`（`code: "STREAM_REPLAY_LIMIT_EXCEEDED"`, `category: "UNAVAILABLE"`, `retryable: true`）。
- 当 `Date.now() - replayStartTime` 超过 `maxReplayDurationMs`（30000ms）时，MUST 抛相同的 safe error。

重放总量限制为固定常量，系统 MUST NOT 从 client payload、client metadata 或配置读取或覆盖上限值。

#### Scenario: 重放事件数超限

- **WHEN** session timeline 事件数超过 10000，客户端以 `lastSeenSequence=0` 请求全量重放
- **THEN** 重放循环 MUST 在 `replayedCount` 超过 10000 时抛 `STREAM_REPLAY_LIMIT_EXCEEDED`
- **AND** error MUST 为 `retryable: true`
- **AND** transport 层 MUST 返回 safe error 并关闭连接

#### Scenario: 重放时间超限

- **WHEN** 重放循环执行时间超过 30 秒（如 timeline store 查询缓慢）
- **THEN** 重放循环 MUST 在时间检查时抛 `STREAM_REPLAY_LIMIT_EXCEEDED`
- **AND** error MUST 为 `retryable: true`

#### Scenario: 正常重放不受影响

- **WHEN** session timeline 事件数不超过 10000，重放时间不超过 30 秒
- **THEN** 重放循环 MUST 正常完成
- **AND** MUST NOT 抛 `STREAM_REPLAY_LIMIT_EXCEEDED`

### Requirement: Timeline 重放 abort 检查

Runtime timeline stream 的 `streamOwned` 重放循环 MUST 在每批 timeline 事件读取后检查 `request.signal?.aborted`。当 client disconnect、transport timeout 或 server shutdown 触发 abort signal 时，重放循环 MUST 静默退出（`return`），MUST NOT 抛 error，MUST NOT 产生 terminal event。此行为对齐 live-tail 循环已有的 `while (!request.signal?.aborted)` 检查模式。

#### Scenario: client disconnect 中断重放

- **WHEN** 重放循环进行中，client 断开连接触发 `request.signal.aborted`
- **THEN** 重放循环 MUST 在下一批读取后检测到 abort 并退出
- **AND** MUST NOT 抛 error
- **AND** MUST NOT 产生 terminal event

#### Scenario: 重放完成后 abort 不影响结果

- **WHEN** 重放循环正常完成（`records.length < maxReplayBatchEvents`），随后 abort signal 被触发
- **THEN** 重放已完成的事件 MUST 已正常 yield
- **AND** abort MUST NOT 影响已 yield 的事件

Runtime timeline stream 的 streamEvents 和 stream 方法 MUST 使用 filter-aware 路由处理 lastSeenSequence=0：当 lastSeenSequence=0 且无 requestId/runId filter 时，MUST 走 live-tail 路径（streamLiveTailOwned），不触发历史重放。当 lastSeenSequence=0 且有 filter 时（如 subagent-execution-port 使用 0 + requestId + runId 从头重放子请求事件），MUST 走 streamOwned 重放路径（受 maxReplayTotalEvents 和 maxReplayDurationMs 限制）。

streamEvents 方法中 lastSeenSequence=undefined 且无 filter 时 MUST 走 live-tail 路径，行为与 lastSeenSequence=0 且无 filter 一致。lastSeenSequence=undefined 且有 filter 时 MUST 抛 STREAM_REPLAY_ANCHOR_REQUIRED（filtered live-tail 无意义）。

非零 lastSeenSequence anchor 仍正常走重放路径，受 maxReplayTotalEvents 和 maxReplayDurationMs 限制。

客户端如需加载历史事件 MUST 使用 conversation history API 分页加载。

#### Scenario: lastSeenSequence=0 无 filter 走 live-tail

- **WHEN** 客户端以 lastSeenSequence=0 请求 stream
- **THEN** runtime MUST 走 streamLiveTailOwned 路径
- **AND** MUST NOT 进入 streamOwned 重放循环
- **AND** subscriber MUST 仅接收重连后产生的新事件

#### Scenario: lastSeenSequence=0 有 filter 走重放

- **WHEN** runtime 以 lastSeenSequence=0 且 requestId/runId filter 请求 stream（如 subagent-execution-port）
- **THEN** runtime MUST 走 streamOwned 重放路径
- **AND** 重放受 maxReplayTotalEvents 和 maxReplayDurationMs 限制

#### Scenario: lastSeenSequence=undefined 无 filter 走 live-tail

- **WHEN** 客户端未提供 lastSeenSequence 请求 stream
- **THEN** runtime MUST 走 streamLiveTailOwned 路径
- **AND** 行为 MUST 与 lastSeenSequence=0 一致

#### Scenario: 非零 lastSeenSequence 仍走重放

- **WHEN** 客户端以 lastSeenSequence=100 请求 stream
- **THEN** runtime MUST 走 streamOwned 重放路径
- **AND** MUST 从 sequence 101 开始重放
- **AND** 重放受 maxReplayTotalEvents 和 maxReplayDurationMs 限制

### Requirement: Cross-Pod Timeline DB Fallback Poll

In multi-pod deployments where SSE connections and request processing may land on different pods, `publishTimelineEvent` only delivers events to in-process subscribers. Runtime stream live phase SHALL poll the timeline DB when the in-process subscriber is idle, to recover events persisted by other pods.

The poll interval SHALL be `crossPodPollIntervalMs` (2000ms). When the in-process subscriber returns no event within that interval, the runtime SHALL query the timeline DB with `afterSequence` equal to `subscriber.lastSeenSequence` to fetch incremental persisted events from other pods. Events already seen (`sequence <= lastSeenSequence`) SHALL be skipped to avoid duplicate delivery. The stream SHALL end after `crossPodMaxIdlePolls` consecutive idle polls with no DB events.

#### Scenario: Stream recovers events persisted by another pod

- **WHEN** a request is processed on pod A and its timeline events are persisted to DB
- **AND** an SSE connection on pod B is subscribed to the same session timeline
- **THEN** pod B in-process subscriber receives no event within `crossPodPollIntervalMs`
- **AND** pod B polls DB and receives events with `sequence > lastSeenSequence`
- **AND** pod B delivers those events to the SSE stream
- **AND** pod B resets the idle poll counter

#### Scenario: Stream ends after idle limit

- **WHEN** the in-process subscriber and DB poll both yield no new events
- **AND** consecutive idle polls reach `crossPodMaxIdlePolls`
- **THEN** the stream SHALL end gracefully

#### Scenario: No duplicate delivery from DB fallback

- **WHEN** DB fallback returns events already delivered via in-process subscriber
- **THEN** events with `sequence <= subscriber.lastSeenSequence` SHALL be skipped
- **AND** only events with `sequence > lastSeenSequence` SHALL be delivered

#### Scenario: DB poll timeout degrades to idle

- **WHEN** the timeline DB query times out or fails during cross-pod fallback
- **THEN** the runtime SHALL return idle status without breaking the SSE stream
- **AND** the idle poll counter SHALL advance normally
- **AND** the stream SHALL continue polling on the next interval

### Requirement: Cross-Pod Pending Input State Synchronization

When DB fallback delivers `USER_INPUT_REQUIRED`, `USER_INPUT_RECEIVED`, `USER_INPUT_TIMEOUT`, or `USER_INPUT_CANCELED` events, the subscriber `pendingInputActive` flag SHALL be updated to match the in-process `publishTimelineEvent` behavior. This ensures `nextSubscriberEvent` applies the correct idle timeout policy after DB fallback delivery.

#### Scenario: DB fallback sets pendingInputActive on USER_INPUT_REQUIRED

- **WHEN** DB fallback delivers a `USER_INPUT_REQUIRED` event
- **THEN** `subscriber.pendingInputActive` SHALL be set to `true`

#### Scenario: DB fallback resolves pending input during wait

- **WHEN** the subscriber is waiting with ``pendingInputActive`` set to ``true``
- **AND** another pod persists a ``USER_INPUT_RECEIVED`` event to the DB
- **THEN** the stream SHALL continue polling the DB during the pending wait
- **AND** the ``USER_INPUT_RECEIVED`` event SHALL be delivered via DB fallback
- **AND** ``subscriber.pendingInputActive`` SHALL be cleared to ``false``
#### Scenario: DB fallback clears pendingInputActive on resolution events

- **WHEN** DB fallback delivers `USER_INPUT_RECEIVED`, `USER_INPUT_TIMEOUT`, or `USER_INPUT_CANCELED`
- **THEN** `subscriber.pendingInputActive` SHALL be set to `false`

### Requirement: Cross-Pod Stream Sequence High-Water Maintenance

After DB fallback delivers events, the runtime SHALL call `rememberStreamSequence` to update the stream high-water mark. This maintains sequence continuity for subsequent subscriber connections on the same pod.

#### Scenario: High-water updated after DB fallback events

- **WHEN** DB fallback delivers one or more events
- **THEN** `rememberStreamSequence(streamKey, lastSeenSequence)` SHALL be called with the updated `subscriber.lastSeenSequence`
