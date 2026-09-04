# local-run-timeline-store Specification

## Purpose
TBD - created by archiving change add-ts-local-run-timeline-store. Update Purpose after archive.
## Requirements
### Requirement: claimRun — CAS 领取实现

`RequestRunStoreGateway.claimRun(request: ClaimRunRequest)` SHALL be implemented as a real SQLite operation (not a stub). The adapter SHALL perform a scoped CAS UPDATE: set `lockedBy` and `lockExpiresAt`, increment `version`, update `updatedAt`, WHERE `run_id=? AND tenant_id=? AND subject_id=? AND agent_id=? AND version=expectedVersion`.

- `expectedVersion` 与完整 Agent Scope、Owner Scope 匹配：返回 `VersionedUpdateResult{status: "UPDATED", record: updated RequestRunRecord}`。
- row 存在但 `expectedVersion` 不匹配：返回 `VersionedUpdateResult{status: "VERSION_CONFLICT"}`。
- `runId` 不存在或 `tenantId`、`subjectId`、`agentId` 任一 scope 不匹配：返回 `VersionedUpdateResult{status: "NOT_FOUND"}`。

Gateway adapter SHALL NOT 决定 run 是否应恢复；runtime 必须仅对 recovery discovery 返回且 lease 可接管的候选执行 claim。Claim SHALL 适用于所有会重新进入 execution/scheduler path 的 `ACCEPTED`、`QUEUED`、`PLANNING`、`EXECUTING` run，而不是只适用于 `EXECUTING` run。

#### Scenario: Successful scoped claim

- **WHEN** `claimRun` 携带的 `tenantId`、`subjectId`、`agentId`、`runId` 和 `expectedVersion=N` 与当前记录匹配
- **THEN** adapter SHALL 更新 `lockedBy`、`lockExpiresAt`，并把 `version` 增加到 `N+1`
- **AND** 返回 `VersionedUpdateResult{status: "UPDATED"}`

#### Scenario: Version conflict on concurrent claim

- **WHEN** 两个实例使用相同 `expectedVersion=N` claim 同一个 scoped run
- **THEN** 只有一个 claim SHALL 返回 `UPDATED`
- **AND** 另一个 claim SHALL NOT 修改该 run，并返回 `VERSION_CONFLICT`

#### Scenario: Agent or owner scope mismatch

- **WHEN** `claimRun` 的 `tenantId`、`subjectId` 或 `agentId` 任一值与持久化记录不匹配
- **THEN** adapter SHALL NOT 修改该 run
- **AND** 返回 `VersionedUpdateResult{status: "NOT_FOUND"}`

### Requirement: listRecoverableRuns — 系统级恢复发现

`RequestRunStoreGateway.listRecoverableRuns(request: AgentListRecoverableRunsRequest)` SHALL be implemented as a real SQLite query (not a stub returning `[]`)。Request MUST carry trusted `agentId`、`now` 和 `limit`，且 MUST NOT carry tenant/user owner scope。Adapter SHALL 只返回 `request.agentId` 下符合 recoverable status、terminal commit state 和 lease 条件的 records，不同 Agent 的 records MUST NOT 被返回。

Recoverable status SHALL include active/unfinished `ACCEPTED`、`QUEUED`、`PLANNING`、`EXECUTING` with terminal commit state `NOT_STARTED`、`PENDING` 或 `RETRYING`，以及 terminal status with terminal commit state `PENDING` 或 `RETRYING`；stable `COMMITTED` terminal runs MUST NOT be returned。已有未过期 claim lease 的 record MUST NOT be returned；`lockExpiresAt <= request.now` 的 record SHALL be eligible for discovery。结果 SHALL 按 `updatedAt ASC`、`createdAt ASC`、`runId ASC` 稳定排序并受 `request.limit` 限制。

该查询是 Agent-scoped recovery discovery：它 SHALL 聚合同一 Agent 下所有 `tenantId`/`subjectId` 的候选，但返回的每条 `RequestRunRecord` MUST 保留完整 Agent Scope 和 Owner Scope。Adapter SHALL NOT 做恢复分类、重放或接管决策。空结果 SHALL 返回空数组，不得抛错。

#### Scenario: Discovery isolates different agents

- **WHEN** persistence 中同时存在 Agent A 和 Agent B 的 recoverable runs
- **AND** `listRecoverableRuns` 使用可信 `agentId=A`
- **THEN** 结果 SHALL 只包含 Agent A 的 runs
- **AND** SHALL NOT 包含 Agent B 的任何 run

#### Scenario: Discovery aggregates owners within one agent

- **WHEN** 同一 Agent 下多个 tenant 或 subject 都有 recoverable runs
- **AND** `listRecoverableRuns` 使用该 Agent 的可信 `agentId`
- **THEN** 结果 SHALL 包含所有符合筛选条件的 owner-scoped runs，直至达到 `limit`
- **AND** 每条结果 SHALL 保留其原始 `tenantId`、`subjectId` 和 `agentId`

#### Scenario: Active lease is excluded and expired lease is eligible

- **WHEN** 同一 Agent 下一个 recoverable run 的 `lockExpiresAt > request.now`，另一个 recoverable run 的 `lockExpiresAt <= request.now`
- **THEN** 未过期 lease 的 run SHALL NOT 被返回
- **AND** lease 已过期的 run SHALL 可被返回

#### Scenario: Stable ordering and limit enforcement

- **WHEN** 指定 Agent 有 10 个 recoverable runs 且 `limit=5`
- **THEN** 结果 SHALL 最多包含 5 个 runs
- **AND** 结果 SHALL 按 `updatedAt ASC`、`createdAt ASC`、`runId ASC` 稳定排序

#### Scenario: Committed terminal run is excluded

- **WHEN** 指定 Agent 的 run 已处于 stable terminal status 且 `terminalCommitState=COMMITTED`
- **THEN** `listRecoverableRuns` SHALL NOT 返回该 run

### Requirement: Terminal commit 幂等语义测试

`commitTerminal` SHALL have contract tests verifying idempotent retry behavior:

- Same `idempotencyKey` called twice → second call returns `ALREADY_COMMITTED`, no duplicate timeline events, no duplicate run status changes
- Transaction rollback after partial commit → same `idempotencyKey` can be retried, run state remains unchanged

#### Scenario: Idempotent retry returns ALREADY_COMMITTED

- **WHEN** `commitTerminal(idempotencyKey=K)` has been successfully committed
- **AND** `commitTerminal(idempotencyKey=K)` is called again
- **THEN** result SHALL be `TerminalCommitRecordResult{status: "ALREADY_COMMITTED"}`
- **AND** `listEvents` SHALL contain exactly one terminal event (not duplicated)

#### Scenario: Transaction rollback allows retry

- **WHEN** `commitTerminal` transaction fails and rolls back (e.g., version conflict detected during UPDATE)
- **THEN** the idempotencyKey SHALL NOT be recorded
- **AND** a retry with the same `idempotencyKey` SHALL be accepted (if version matches this time)

### Requirement: Terminal commit 恢复语义测试

`commitTerminal` SHALL have tests verifying crash recovery consistency:

- After `commitTerminal` succeeds and process restarts → `loadRun` SHALL return `terminalCommitState=COMMITTED`
- After `commitTerminal` succeeds → `listEvents` SHALL contain the terminal timeline event
- After `commitTerminal` succeeds → `listRecoverableRuns` SHALL NOT return this run

#### Scenario: Recovery after successful commit

- **WHEN** `commitTerminal` has successfully committed a run
- **AND** the process restarts (simulated by new `SqliteGatewayStores` instance on same DB file)
- **THEN** `loadRun` SHALL return the run with `terminalCommitState=COMMITTED`
- **AND** `listRecoverableRuns` SHALL NOT include this run

#### Scenario: Uncommitted run is recoverable

- **WHEN** a run has `status=EXECUTING, terminalCommitState=PENDING`
- **AND** the process restarts
- **THEN** `listRecoverableRuns` SHALL include this run

### Requirement: RequestRunStoreGateway contract tests

`RequestRunStoreGateway` SHALL have contract tests verifying:
- `saveRun` with `expectedVersion=0` inserts; with `expectedVersion>0` performs CAS UPDATE; version mismatch and duplicate `expectedVersion=0` return `VERSION_CONFLICT`.
- `loadRun` with correct Agent Scope and Owner Scope returns `RequestRunRecord`; mismatched scope returns `undefined`.
- `claimRun` verifies `UPDATED`、`VERSION_CONFLICT`、`NOT_FOUND`、Agent Scope mismatch、Owner Scope mismatch and concurrent single-winner outcomes.
- `listRecoverableRuns` verifies Agent isolation、same-Agent owner aggregation、lease filtering、recoverable state filtering、stable ordering and limit.
- `commitTerminal` verifies `COMMITTED`、`ALREADY_COMMITTED`、`VERSION_CONFLICT` and `NOT_FOUND` outcomes.

#### Scenario: loadRun scope isolation

- **WHEN** a run exists with `tenantId=T1, subjectId=S1, agentId=A1`
- **AND** `loadRun` is called with a different tenant、subject or agent
- **THEN** result SHALL be `undefined`

#### Scenario: Recoverable discovery rejects cross-agent visibility

- **WHEN** contract fixture stores recoverable runs for Agent A and Agent B
- **AND** discovery is executed for Agent A
- **THEN** contract assertions MUST fail if any Agent B record is returned

### Requirement: RunTimelineEventStoreGateway contract tests

`RunTimelineEventStoreGateway` SHALL have contract tests verifying:
- `appendEvent` with new `idempotencyKey` inserts; with duplicate `idempotencyKey` returns existing record
- `listEvents` with `afterSequence=0` returns all events; with `afterSequence>0` returns events after that sequence
- `listEvents` optional `requestId`/`runId` filtering
- Timeline sequence monotonicity within a session (not reset by run change)

#### Scenario: appendEvent idempotent

- **WHEN** `appendEvent` is called with the same `idempotencyKey` twice
- **THEN** the second call SHALL return the existing record without inserting a duplicate

#### Scenario: Timeline sequence across runs

- **WHEN** events from run1 have sequences 1, 2, 3
- **AND** an event is appended for run2 in the same session
- **THEN** that event SHALL receive sequence 4 (not reset to 1)

### Requirement: 失败与降级行为

Gateway adapter 的所有操作 MUST 在遇到不可恢复错误时返回 SafeError，不得抛 raw exception。SQLite 不可用时 MUST 返回 `SafeError(LOCAL_STORE_UNAVAILABLE)`。owner scope 不匹配的结果 MUST 返回空结果或专用冲突状态，不得静默成功。

#### Scenario: SQLite 不可用

- **WHEN** SQLite 连接丢失、文件不可访问或磁盘满
- **THEN** 操作返回 SafeError（`LOCAL_STORE_UNAVAILABLE`）
- **AND** SafeError 不包含 raw SQLite error message、文件路径或 connection string

### Requirement: Timeline persistence is classified by lifecycle finality

Product runtime SHALL通过唯一声明式policy把每个timeline event分类为`LIVE_ONLY`或`PERSISTED`。Policy MUST按event type及validated payload predicate声明允许形态；`emitEvent`主路径MUST只消费分类结果，不得增加thinking专用if/else。

调用中的`LLM_THINKING_DELTA`省略`completed`并MUST为LIVE_ONLY；单次模型调用最后累计`LLM_THINKING_DELTA`包含`completed=true`并MUST为PERSISTED。`LLM_CONTENT_DELTA`和`CAPABILITY_RESULT_DELTA`MUST保持LIVE_ONLY。既有其他event继续遵循其已有persistence规则，本change不扩大其他delta的持久化集合。Event持久化与Web可见性MUST是独立维度。

#### Scenario: In-progress deltas remain live only
- **WHEN**runtime处理调用中thinking、assistant content delta或capability result delta
- **THEN** policy MUST分类为LIVE_ONLY
- **AND** timeline store MUST不创建row或sequence

#### Scenario: Completed thinking is durable
- **WHEN**runtime处理合法`completed=true` thinking delta
- **THEN** policy MUST分类为PERSISTED
- **AND** composition override MUST不能把它降级为LIVE_ONLY

#### Scenario: Invalid persistence combination is rejected
- **WHEN** producer把partial thinking标成PERSISTED、把final thinking标成LIVE_ONLY或提供`completed=false`
- **THEN** runtime MUST在append和publish前失败
- **AND** MUST不留下row、sequence或live完成态

### Requirement: Final thinking reuses the canonical timeline store

Local runtime SHALL复用`RunTimelineEventStoreGateway.appendEvent`和`timeline_events`保存模型调用最后累计thinking delta，MUST NOT增加thinking message、sidecar或第二套sequence。每个model invocation最多追加一条包含完整reasoning和`completed=true`的record；gateway scoped idempotency replay MUST返回首次eventId、sequence、payload和createdAt，不插入第二条row。

Gateway-local只校验generic record、JsonObject serialization、scope、origin、idempotency和sequence，不解析model reasoning业务。Payload生命周期校验属于runtime policy。

#### Scenario: Last cumulative thinking delta is stored once
- **WHEN**runtime append合法completed thinking event
- **THEN** timeline table MUST增加恰好一条`LLM_THINKING_DELTA` row
- **AND** row MUST保留`reasoning`、`stepId`和`completed=true`
- **AND** message和ActiveContext stores MUST无变化

#### Scenario: Database reopen preserves completed thinking
- **WHEN**保存completed thinking event后关闭并重开同一SQLite database
- **THEN** eventId、coordinates、sequence、payload和createdAt MUST原样恢复
- **AND**未持久化的调用中deltas MUST不被合成

#### Scenario: Storage failure is explicit
- **WHEN** serialization、constraint或SQLite failure阻止append
- **THEN**runtime MUST不发布completed thinking delta或后续依赖model terminal boundary
- **AND** safe failure MUST不包含database path、raw SQLite error或reasoning content

### Requirement: Timeline records distinguish runtime facts from fork snapshots

`RunTimelineEventRecord` SHALL支持可选`recordOrigin=FORK_SNAPSHOT`；字段缺省表示既有runtime fact。Runtime fact MUST包含真实`requestContextId`。FORK_SNAPSHOT MUST省略requestContextId、contentRef和source coordinates，只能由fork composite write创建，不能通过普通`appendEvent`创建。

普通live stream、resume、lifecycle、recovery、terminal reconciliation、cancel、retry、edit、activeRun和stream-control reads MUST忽略FORK_SNAPSHOT。只有run-scoped history read MAY返回snapshot，经runtime映射后仍不暴露gateway细节。

#### Scenario: Normal append cannot manufacture a fork snapshot
- **WHEN** caller通过`appendEvent`提交`recordOrigin=FORK_SNAPSHOT`
- **THEN** gateway MUST在insert前拒绝
- **AND** MUST不推进sequence

#### Scenario: Runtime record still requires request context
- **WHEN**普通runtime record缺少requestContextId
- **THEN** gateway/runtime validation MUST失败
- **AND** 不得因fork支持而放宽普通事件不变量

#### Scenario: Lifecycle ignores copied snapshot facts
- **WHEN** child timeline包含run anchor的FORK_SNAPSHOT records但不存在RequestRun
- **THEN** recovery和控制操作 MUST不把该anchor识别为active或terminalized run
- **AND** cancel/retry/edit MUST保持run-not-found语义

#### Scenario: Live stream does not replay inherited snapshots
- **WHEN**client在child session建立普通live或resume stream
- **THEN**stream MUST不发送FORK_SNAPSHOT rows
- **AND**client MUST通过run event-history接口加载copied process history

### Requirement: Fork composite atomically copies durable timeline snapshots

Fork composite write SHALL接收已经过runtime验证和child identity重映射的snapshot drafts及每个copied run的`AVAILABLE | LEGACY_UNAVAILABLE`状态，在创建child session的同一transaction内写入messages、active context、fork metadata、snapshot records和status。

Gateway MUST按输入的source相对顺序为child snapshots分配连续的child session sequence。Idempotent replay MUST返回首次child且不得重复snapshot或推进sequence。任一validation或write失败 MUST回滚全部child facts。

#### Scenario: Successful fork owns independent event rows
- **WHEN**source prefix的display runs包含durable events且fork成功
- **THEN** child MUST拥有使用child session/request/run/event identities的snapshot rows
- **AND** source删除后child rows MUST保持可查询

#### Scenario: Live-only deltas are not copied
- **WHEN**source run包含多个只用于live展示的调用中deltas
- **THEN** fork copy set MUST只来自durable timeline rows
- **AND** child MUST不出现partial-only row

#### Scenario: Fork event failure is atomic
- **WHEN**任一snapshot payload、scope、origin、resource limit或write不合法
- **THEN** child session、messages、active context、snapshot rows和status MUST全部不存在
- **AND** source facts MUST保持不变

#### Scenario: Fork snapshot survives reopen and child continuation
- **WHEN**fork成功、database重开且child产生新的real run events
- **THEN**copied snapshots MUST保持原child sequence
- **AND**新runtime events MUST从child session当前最大sequence之后继续

### Requirement: Event history queries remain scoped and bounded

`RunTimelineEventStoreGateway.listEvents` SHALL按tenant、subject、agent、session、exclusive afterSequence和validated limit查询；requestId和runId出现时必须共同过滤。结果按sequence ASC返回。Owner或Agent mismatch返回不可区分空结果；storage failure显式失败。

#### Scenario: Run pagination has no duplicate or omission
- **WHEN**一个run的persisted events跨越多页
- **THEN**连续使用next cursor MUST让每条event恰好出现一次
- **AND**不得混入其他request或run

#### Scenario: Empty valid run is distinguishable at runtime facade
- **WHEN**合法RequestRun或AVAILABLE copied run没有persisted events
- **THEN**gateway可返回空records
- **AND**runtime依据已验证run/status返回AVAILABLE，而不是把空结果当作not-found

