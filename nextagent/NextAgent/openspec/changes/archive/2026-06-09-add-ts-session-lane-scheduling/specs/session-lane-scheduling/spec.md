## ADDED Requirements

### Requirement: Agent 和 Owner 作用域内的 session lane scheduling
NextAgent TS runtime MUST 将每个 `tenantId + subjectId + agentId + sessionId` tuple 视为不同 session lane。Runtime MUST 拥有该 lane 的 request acceptance、queueing、scheduler dispatch、execution status advancement 和 terminal commit。Channel、Session、Agent Loop、Gateway 和 App composition MUST NOT 为 session lane scheduling 创建竞争性的 request lifecycle state machine。

#### Scenario: Submit 为 agent+owner-scoped lane 排队一个 run
- **WHEN** Runtime 收到携带可信 `identityContext`、非空 canonical `idempotencyKey` 且满足有效 session/input 前置条件的 submit command
- **THEN** Runtime MUST 为 `tenantId + subjectId + agentId + sessionId` lane 创建新的 `RequestRun`
- **AND** Runtime MUST 在 scheduling Agent execution 前持久化该 run
- **AND** Runtime MUST 让 accepted run 在 dispatch 前进入 `QUEUED`
- **AND** Runtime MUST 返回包含 `sessionId`、`requestId`、`runId` 和 `attempt` 的 `RequestAccepted`
- **AND** Runtime MUST NOT 在 acceptance response 中暴露 stream cursor 或 timeline sequence

#### Scenario: Submit command idempotency key 是 Runtime command 前置条件
- **WHEN** Runtime 处理 submit command
- **THEN** command MUST 已经包含由 upstream Channel/command boundary 提供的非空 canonical `idempotencyKey`
- **AND** Runtime MUST 在创建 `RequestRun`、scheduling work、terminalizing another run 或 publishing timeline/stream facts 前，通过 safe validation outcome 拒绝缺失或空白 `idempotencyKey`
- **AND** Runtime MUST 使用稳定错误码 `SUBMIT_IDEMPOTENCY_REQUIRED`
- **AND** Runtime MUST NOT 从 client metadata、model output、capability input 或 hidden payload fields 推断或补填 `idempotencyKey`
- **AND** 本 Runtime requirement 不定义 public Web DTO 的 key 是来自 client 还是由 Channel 生成

#### Scenario: 不同 session lanes 可以独立推进
- **WHEN** 两个 submit commands 目标是不同的 `tenantId + subjectId + agentId + sessionId` lane tuples
- **THEN** Runtime MUST NOT 通过同一个 session lane 串行化它们
- **AND** 任何 global admission、queue capacity 或 execution concurrency limit MUST 与 session lane scheduling 分离

#### Scenario: Lane lookup 使用 agent+owner scope
- **WHEN** Runtime 检查一个 session lane 的 scheduler dispatch、cancel、retry、edit 或 recovery legality
- **THEN** lookup MUST 包含 `tenantId`、`subjectId`、`agentId` 和 `sessionId`
- **AND** command MUST NOT 使用 client payload、client metadata、model output 或 capability input 覆盖可信 identity context 或 Agent Scope

### Requirement: Queued、executing 和 terminal-pending 分类
Runtime MUST 将 `ACCEPTED`、`QUEUED` 和 `PLANNING` RequestRuns 分类为 queued 或 pre-execution lane facts，直到 Agent execution 开始。Runtime MUST 将 `EXECUTING` RequestRuns 分类为 executing lane facts。Runtime MUST 将 `COMPLETED`、`FAILED`、`CANCELED` 和 `SUPERSEDED` RequestRuns 分类为 terminal。Runtime MUST 将任何 `terminalCommitState` 为 `PENDING` 或 `RETRYING` 的 RequestRun 视为 terminal-pending，并保护它不被 same-lane dispatch 越过。

#### Scenario: Queued run 不表示 Agent execution 已开始
- **WHEN** Runtime 接受 submit 并将 run 持久化为 `QUEUED`
- **THEN** 系统 MUST 将该 request 视为已接受并等待 scheduler dispatch
- **AND** Runtime MUST NOT 仅因为 run 存在就假设 Agent execution 已开始

#### Scenario: Executing run 阻塞 same-lane dispatch
- **WHEN** session lane 中存在 `EXECUTING` 状态的 RequestRun
- **THEN** Runtime scheduler MUST NOT 启动另一个可能写入 terminal facts 的 same-lane RequestRun execution
- **AND** same-lane queued run MUST 保持 `QUEUED`，直到 executing run 离开 blocking execution path

#### Scenario: Terminal-pending run 阻塞 dispatch 但不阻塞 submit
- **WHEN** session lane 中存在 `terminalCommitState` 为 `PENDING` 或 `RETRYING` 的 RequestRun
- **THEN** Runtime MUST NOT 启动较新的 same-lane queued run 去写 terminal facts
- **AND** Runtime MAY 接受较新的 same-lane submit 为 `QUEUED`
- **AND** Runtime MUST 让 terminal commit 达到 stable committed、already-committed、version-conflict 或 safe failure outcome 后，较新的 same-lane run 才能执行 terminal-writing work

### Requirement: Scheduler dispatch 是 same-lane execution gate
Runtime scheduler MUST 是把 same-lane queued work 推进到 execution 的 execution gate。Submit acceptance MUST NOT 被视为 same-lane execution 被授权的时间点。

#### Scenario: Durable queued facts 是 queue authority
- **WHEN** Runtime 同时拥有 durable `RequestRun` facts 和 process-local scheduler pending queue
- **THEN** Runtime MUST 将 durable `RequestRun.status=QUEUED` facts 视为 authoritative queue state
- **AND** Runtime MUST 将 scheduler pending queue 视为可重建的 dispatch structure
- **AND** Runtime MUST correct 或 discard durable RequestRun 已不再 queued、不再 agent+owner-scoped 到该 lane、或已经 terminal 的 scheduler pending work

#### Scenario: Scheduler 只在 lane clear 时 dispatch queued run
- **WHEN** Runtime scheduler 准备 dispatch 一个 `QUEUED` run
- **THEN** Runtime MUST 对该 run 所属 lane 评估 agent+owner-scoped lane facts
- **AND** Runtime MUST 只在没有 blocking same-lane executing run 或 terminal-pending run 时，将该 run 推进到 `EXECUTING`
- **AND** Runtime MUST 在 lane 被阻塞时保持该 run queued

#### Scenario: Same-lane serial execution 是默认行为
- **WHEN** 同一个 agent+owner-scoped session lane 中存在多个 accepted runs
- **THEN** Runtime MUST dispatch 它们，并默认保证同一时间至多一个 same-lane run 处于 `EXECUTING`
- **AND** queued same-lane runs MUST 仍然是可区分的 durable facts

#### Scenario: Queue capacity failure 是 safe outcome
- **WHEN** bounded scheduler capacity 或 per-lane pending-depth limit 耗尽，导致 Runtime 无法 queue 或 retain 一个 run
- **THEN** Runtime MUST 产生安全、确定的 failure 或 rejection outcome
- **AND** Runtime MUST NOT 让 accepted run 在没有 queueing、executing 或 terminalizing 的情况下无限期保持 active

### Requirement: Latest submit replacement 和 supersession
Runtime MUST 将同一 agent+owner-scoped session lane 的较晚 normal submit 视为 latest-submit replacement，同时仍在 dispatch 前把 newer run 接受为 queued work。Runtime MUST 拥有所有 supersession decisions 和 terminal commits。User-initiated cancel MUST 使用 `CANCELED`，不得使用 `SUPERSEDED`；latest-submit replacement 和其他 explicit replacement flows 在把 older work terminalize 为 replaced 时 MUST 使用 `SUPERSEDED`。

#### Scenario: 较晚 submit supersede older queued work
- **WHEN** Runtime 接受 agent+owner-scoped lane 中较新的 submit
- **AND** 同一 lane 中存在 older non-terminal queued work
- **THEN** Runtime MUST 将 newer run 保持为 durable `QUEUED` work
- **AND** Runtime MUST 将 older queued run terminal commit 为 `SUPERSEDED`
- **AND** Runtime MUST cancel、discard 或 correct 引用 superseded run 的任何 scheduler pending work item
- **AND** Runtime MUST NOT 将 older queued run 归类为 user-canceled

#### Scenario: 较晚 submit 请求在 safe boundary supersede executing work
- **WHEN** Runtime 接受 agent+owner-scoped lane 中较新的 submit
- **AND** 同一 lane 中存在 older `EXECUTING` run
- **THEN** Runtime MUST 将 newer run 保持为 durable `QUEUED` work
- **AND** Runtime MUST 通过 Runtime-owned execution handle 或等价 control boundary signal older executing run 进行 supersession
- **AND** Runtime MUST 为 older executing run 记录 replacement request identity
- **AND** Runtime scheduler MUST NOT 在 older run 仍处于 executing 或 terminal-pending 时 dispatch newer run
- **AND** Runtime MUST 让 older run 到达 Agent loop safe boundary 并持久化 exactly one terminal outcome，newer run 才能执行 terminal-writing work

#### Scenario: Superseded executing work 使用 terminal commit
- **WHEN** older executing run 在形成完整 terminal assistant result 前观察到 latest-submit supersession
- **THEN** Runtime MUST 将该 older run terminal commit 为 `SUPERSEDED`
- **AND** Runtime MUST 产生 canonical `REQUEST_SUPERSEDED` terminal event
- **AND** Runtime MUST NOT 让 superseded run 继续进入另一个 model 或 capability turn

#### Scenario: Completed-but-overtaken work 保持 terminal correctness
- **WHEN** older executing run 在 latest-submit supersession 能安全停止它之前，已经形成完整 terminal assistant result
- **THEN** Runtime MAY 将该 older run terminal commit 为 `COMPLETED`，并在 existing terminal/audit fields 中携带 replacement 或 overtaken metadata
- **AND** Runtime MUST 仍将 newer accepted run 视为后续 dispatch 的 latest queued work
- **AND** Runtime MUST NOT 为 older run 发布两个 terminal lifecycle events

#### Scenario: Explicit replacement 产生 superseded terminal fact
- **WHEN** defined replacement policy supersedes previous run
- **THEN** Runtime MUST 为该 previous run 产生 canonical `REQUEST_SUPERSEDED` terminal event
- **AND** Runtime MUST 使用 terminal commit 持久化 previous run terminal state
- **AND** Runtime MUST NOT 将 previous run 归类为 user-canceled
- **AND** Runtime MUST NOT 让 previous run 无限期保持 active

### Requirement: Session lane timeline 和 history consistency
Runtime MUST 保留 queued、executing 或 superseded run 已经产生的 canonical timeline facts，并且 MUST 让这些 facts 继续关联原始 `runId`。Runtime MUST 是 completed、failed、canceled 或 superseded runs 的 terminal lifecycle events 的唯一 publisher。Channel MUST project Runtime 和 Session facts，MUST NOT 发明 session lane terminal state。

#### Scenario: Queued status 不要求新的 timeline event
- **WHEN** Runtime 接受 same-lane run 为 `QUEUED`
- **THEN** queued condition MUST 能通过 `RunStatus` 表达
- **AND** 系统 MUST NOT 在本 capability 中为 queued state 引入新的 `TimelineEventType` 或 `StreamEventType`

#### Scenario: Superseded run 保留 prior timeline facts
- **WHEN** run 在已经发出 canonical non-terminal timeline facts 后被 superseded
- **THEN** 系统 MUST 保持这些 facts 关联到 superseded run
- **AND** terminalized as `SUPERSEDED` 的 run MUST NOT 在 supersession 后产生 visible assistant terminal answer

#### Scenario: Session list 投影 durable latest run summary
- **WHEN** Channel 为 owner+agent-scoped session list 服务 `GET /api/v1/sessions`
- **THEN** 每个 session list entry MUST 在存在 run 时投影 latest durable `RequestRun.status` 作为 public run summary
- **AND** 每个 session list entry MUST 投影是否存在 same-session run 仍处于 in-flight 或 terminal-pending
- **AND** summary MUST 来自 owner+agent-scoped Runtime/Gateway durable facts，而不是 visible message content 或 frontend inference
- **AND** Channel MUST NOT 在投影该 summary 时实现 lane admission、scheduler dispatch、supersession 或 terminal lifecycle decisions

#### Scenario: Historical assistant messages 不表示 refresh 后仍在 active execution
- **WHEN** client 在 page refresh 后基于 persisted conversation messages 重建 session view
- **AND** durable latest run summary 是 terminal 且不是 in-flight
- **THEN** client MUST 将对应 turn 渲染为 terminal，而不是仅因为 historical assistant message 映射到 answer content 就保持 executing state

### Requirement: Session lane safe outcomes 约束
Runtime MUST 为 stale latest request、lane conflict、queue capacity exhaustion、duplicate idempotency key conflict 和 agent/owner-scope mismatch 返回安全、确定的 outcomes。Runtime MUST NOT 在 user-visible errors 中暴露 raw tenant、subject、agent、credential、adapter-private query detail 或 hidden resource existence。

#### Scenario: Stale latest request 被安全拒绝
- **WHEN** control command 引用的 `expectedLatestRequestId` 已不再是 agent+owner-scoped session lane 中的 latest request
- **THEN** Runtime MUST 以 safe stale-latest outcome 拒绝该 command
- **AND** Runtime MUST NOT 因 stale command 修改任何 RequestRun

#### Scenario: Duplicate submit 不创建 duplicate run
- **WHEN** Runtime 在 original request 已 accepted 后收到具有相同 `idempotencyKey` 的同一个 submit command
- **THEN** Runtime MUST 返回 original acceptance outcome 或 equivalent safe duplicate outcome
- **AND** Runtime MUST NOT 为同一个 idempotent submit 创建第二个 RequestRun

#### Scenario: 相同 submit idempotency key 配合不同 command semantic 时冲突
- **WHEN** Runtime 收到的 submit command 使用了已被不同 submit command semantic 使用过的 `idempotencyKey`
- **THEN** Runtime MUST 以 safe idempotency conflict outcome 拒绝该 command
- **AND** Runtime MUST 使用稳定错误码 `DUPLICATE_IDEMPOTENCY_KEY_CONFLICT`
- **AND** Runtime MUST NOT 因该 conflicting command 创建另一个 `RequestRun`、修改 session lane、terminalize existing run 或 publish timeline/stream facts

#### Scenario: Owner scope mismatch 是安全的
- **WHEN** command 尝试访问 trusted `identityContext.tenantId` 和 `identityContext.subjectId` 之外的 session lane
- **THEN** Runtime MUST 通过 safe error boundary 拒绝该 command
- **AND** user-visible error MUST NOT 泄漏另一个 agent 或 owner scope 下是否存在目标 session、message 或 run

### Requirement: Model stream completion 必须可信后才能 terminal success
当 OpenAI-compatible model stream 不完整、被截断或结构上不适合 final display 时，Runtime MUST NOT commit successful assistant terminal answer。Model/provider adapters MUST 在 Runtime terminal commit 前把 provider completion metadata 归一化为 safe success 或 safe failure outcomes。

#### Scenario: Incomplete provider stream 不是 terminal success
- **WHEN** OpenAI-compatible provider stream 在 adapter 观察到 stream completion sentinel 或 terminal provider finish metadata 前结束
- **THEN** model adapter MUST 返回 safe model stream error
- **AND** Runtime MUST NOT 为 partial content 发布 `REQUEST_COMPLETED`
- **AND** Runtime MUST 通过 safe failed/degraded outcome terminalize，且不泄漏 raw provider payload

#### Scenario: Provider length finish 不是 terminal success
- **WHEN** OpenAI-compatible provider 报告 length-limited 或 truncated finish reason
- **THEN** model adapter MUST 返回 safe truncation error
- **AND** Runtime MUST NOT 将 partial answer commit 为 `COMPLETED`

#### Scenario: Incomplete final Markdown table 不作为 completed answer commit
- **WHEN** final assistant answer 会结束在 incomplete Markdown table row 或其他 guarded incomplete Markdown structure 内部
- **THEN** Runtime MUST 将该 content 视为 unsafe for successful terminal commit 并拒绝
- **AND** Runtime MUST 产生 safe failed/degraded terminal outcome，而不是持久化半渲染的 successful answer
