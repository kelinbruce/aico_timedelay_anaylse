## ADDED Requirements

### Requirement: Session lane snapshot gateway 查询
Core contracts MUST 在 `RequestRunStoreGateway` 上定义 agent+owner-scoped session lane snapshot query。该 query MUST 允许 Runtime 读取 durable gateway-owned RequestRun facts，用于 scheduler dispatch、latest-submit replacement、latest-request legality、request control、recovery 和 terminal-pending protection，并且不得依赖 adapter-private database queries 或 process-local scheduler state。

#### Scenario: Runtime 通过 `RequestRunStoreGateway` 读取 lane facts
- **WHEN** Runtime needs to decide scheduler dispatch, latest-submit replacement, cancel, retry, edit or recovery legality for a session lane
- **THEN** Runtime MUST call `RequestRunStoreGateway.loadSessionLaneSnapshot`
- **AND** the query MUST include `tenantId`, `subjectId`, `agentId` and `sessionId`
- **AND** Runtime MUST NOT read adapter-private database schema, local file layout or Session/Channel-owned cache to determine queued/executing/latest lane facts

#### Scenario: Snapshot 返回 facts 而不是 decisions
- **WHEN** `RequestRunStoreGateway.loadSessionLaneSnapshot` returns a snapshot
- **THEN** the snapshot MUST expose durable gateway-owned facts for the agent+owner-scoped session lane
- **AND** the snapshot MUST include the current `latestRequestId` when known
- **AND** the snapshot MUST include `latestRun`, `executingRun`, `queuedRuns` and `terminalPendingRun` when those facts exist
- **AND** `queuedRuns` MUST be a list, because more than one accepted same-lane request can be waiting for scheduler dispatch
- **AND** the snapshot MUST NOT include decision fields such as `shouldQueue`, `shouldSupersede`, `shouldReject` or `shouldStartExecution`

#### Scenario: Snapshot 不是 scheduler queue
- **WHEN** Runtime reads `RequestRunStoreGateway.loadSessionLaneSnapshot`
- **THEN** Runtime MUST treat durable `RequestRun` state as the authoritative source for queued, executing and terminal-pending facts
- **AND** Runtime MUST treat any process-local scheduler pending queue as a rebuildable dispatch aid rather than an authoritative lifecycle store
- **AND** the snapshot MUST NOT allocate, reorder, dispatch, retain or remove scheduler work items

#### Scenario: Snapshot 保留 agent 和 owner scope
- **WHEN** the gateway reads RequestRun facts for a session lane snapshot
- **THEN** the gateway MUST filter by `tenantId`, `subjectId`, `agentId` and `sessionId`
- **AND** facts from a different tenant, subject or agent MUST NOT appear in the snapshot
- **AND** agent-scope or owner-scope mismatch MUST be handled through the safe error boundary or an empty scoped result without leaking hidden resource existence

#### Scenario: Snapshot 支持 terminal-pending protection
- **WHEN** a session lane contains a RequestRun whose `terminalCommitState` is `PENDING` or `RETRYING`
- **THEN** the snapshot MUST expose that run as `terminalPendingRun`
- **AND** Runtime MUST be able to distinguish terminal-pending protection from normal queued or executing facts using the snapshot

#### Scenario: Snapshot 保持 gateway 的 fact provider 职责
- **WHEN** Gateway returns `queuedRuns`, `executingRun`, `latestRun` or `terminalPendingRun`
- **THEN** Gateway MUST NOT decide whether Runtime starts execution, keeps a run queued, supersedes a run or rejects a command
- **AND** Gateway MUST only provide RequestRunRecord facts or a gateway-owned snapshot read model from durable state through the logical port contract

### Requirement: RequestRun gateway 主路径 scope foundation
Core contracts MUST 为 session lane scheduling、request control 和 local recovery 使用的 RequestRun 主路径 lookup、claim、terminal commit 和 submit idempotency handling 保留 Agent Scope 与 Owner Scope。凡是读取或修改 user/session lane run facts 的 RequestRun gateway request，MUST 携带 trusted `tenantId`、`subjectId`、`agentId` 以及相关 session/run coordinate。Runtime MUST 仅从 app composition、hosted-agent selection、persisted `Session.agentId` 或 persisted `RequestRun.agentId` 派生 `agentId`。

#### Scenario: Run lookup、claim 和 terminal commit 使用 agent scope
- **WHEN** Runtime looks up, claims or terminal-commits a RequestRun for scheduler, request control or recovery
- **THEN** the gateway request MUST include trusted `tenantId`, `subjectId`, `agentId` and the run coordinate
- **AND** gateway implementation MUST filter by all scoped fields before returning or mutating the run
- **AND** an agent-scope or owner-scope mismatch MUST return a safe not-found/forbidden outcome or scoped empty result without leaking hidden resource existence

#### Scenario: Submit idempotency 按 command semantics 作用域化
- **WHEN** Runtime accepts submit into the queued scheduler path
- **THEN** the idempotency anchor MUST include trusted agent+owner scope, `sessionId`, canonical submit command semantic and `idempotencyKey`
- **AND** the same key with the same semantic MUST return the same accepted run or an equivalent safe duplicate outcome
- **AND** the same key with a different semantic MUST return a safe idempotency conflict without creating another run, mutating the lane or publishing timeline/stream facts

### Requirement: RequestRun idempotency anchor lookup 查询
Core contracts MUST 在 `RequestRunStoreGateway` 上暴露 agent+owner-scoped lookup，用于读取既有 `RequestRun` idempotency anchors。该 lookup MUST 只读取既有 `request_runs` facts，并且 MUST NOT 创建单独的 command outcome fact、table、store 或 `RuntimeControlCommandOutcomeRecord`。

#### Scenario: Runtime 从 RequestRun acceptance anchor reload accepted retry
- **WHEN** Runtime receives a duplicate retry command with the same `idempotencyKey` after the retry run has already reached the durable acceptance boundary
- **THEN** Runtime MUST call `RequestRunStoreGateway.loadRunByIdempotencyKey` with trusted `tenantId`, `subjectId`, `agentId`, `sessionId`, `anchor=ACCEPTANCE`, canonical `idempotencyKey` and retry command semantic
- **AND** a matching `RequestRunRecord` with the same semantic MUST let Runtime derive the original `RequestAccepted`
- **AND** a matching key with a different semantic MUST return a safe idempotency conflict without creating another run, mutating the lane or publishing timeline/stream facts

#### Scenario: Runtime 从 RequestRun terminal commit anchor reload accepted cancel
- **WHEN** Runtime receives a duplicate cancel command with the same `idempotencyKey` after the target run's cancel terminal attempt has reached pending or committed terminal metadata
- **THEN** Runtime MUST call `RequestRunStoreGateway.loadRunByIdempotencyKey` with trusted `tenantId`, `subjectId`, `agentId`, `sessionId`, `anchor=TERMINAL_COMMIT`, canonical `idempotencyKey` and cancel command semantic
- **AND** a matching `RequestRunRecord` with the same semantic MUST let Runtime derive the original or equivalent `RequestControlAccepted`
- **AND** a matching key with a different semantic MUST return a safe idempotency conflict without starting another cancellation transition or terminal commit attempt

#### Scenario: RequestRun idempotency lookup 保留 agent 和 owner scope
- **WHEN** the gateway reads a RequestRun idempotency anchor
- **THEN** the gateway MUST scope the lookup by `tenantId`, `subjectId`, `agentId`, `sessionId`, anchor kind and `idempotencyKey`
- **AND** runs from a different tenant, subject, agent, session or anchor kind MUST NOT be returned
- **AND** an agent-scope or owner-scope mismatch MUST be handled through a safe scoped result without leaking hidden resource existence
