## MODIFIED Requirements

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
