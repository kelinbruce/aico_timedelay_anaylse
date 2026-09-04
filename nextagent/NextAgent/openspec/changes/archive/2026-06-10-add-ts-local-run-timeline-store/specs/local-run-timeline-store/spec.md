# [TS] 本地 Run 和 Timeline 持久化规格 — 补实与测试

## ADDED Requirements

### Requirement: claimRun — CAS 领取实现

`RequestRunStoreGateway.claimRun(request: ClaimRunRequest)` SHALL be implemented as a real SQLite operation (not a stub). The adapter SHALL perform a CAS UPDATE: set `lockedBy` and `lockExpiresAt`, increment `version`, update `updatedAt`, WHERE `run_id=? AND tenant_id=? AND subject_id=? AND version=expectedVersion`.

- `expectedVersion` match → `VersionedUpdateResult{status: "UPDATED", record: updated RequestRunRecord}`
- `expectedVersion` mismatch (row exists but different version) → `VersionedUpdateResult{status: "VERSION_CONFLICT"}`
- `runId` not found or owner scope mismatch → `VersionedUpdateResult{status: "NOT_FOUND"}`

The adapter SHALL NOT validate lock expiry, current holder identity, or status transition legality — it only performs the atomic conditional write.

#### Scenario: Successful claim

- **WHEN** `claimRun` is called with `expectedVersion=N` matching the current version
- **THEN** adapter SHALL update `lockedBy`, `lockExpiresAt`, increment `version` to `N+1`
- **AND** return `VersionedUpdateResult{status: "UPDATED"}`

#### Scenario: Version conflict on claim

- **WHEN** `claimRun` is called with `expectedVersion=N` that does not match the current version
- **THEN** adapter SHALL NOT modify the run
- **AND** return `VersionedUpdateResult{status: "VERSION_CONFLICT"}`

#### Scenario: Run not found

- **WHEN** `claimRun` is called for a `runId` that does not exist
- **THEN** adapter SHALL return `VersionedUpdateResult{status: "NOT_FOUND"}`

### Requirement: listRecoverableRuns — 系统级恢复发现

`RequestRunStoreGateway.listRecoverableRuns(request: SystemListRecoverableRunsRequest)` SHALL be implemented as a real SQLite query (not a stub returning `[]`). The adapter SHALL SELECT from `request_runs` WHERE status is in an active/unfinished set AND `terminal_commit_state IN ('NOT_STARTED', 'PENDING', 'RETRYING')`, ordered by `created_at ASC`, limited by `request.limit`.

`SystemListRecoverableRunsRequest` carries only `now` and `limit` — no owner scope fields. The query SHALL return all matching runs regardless of `tenantId`/`subjectId` (system-scoped operation for recovery discovery).

The adapter SHALL NOT make recovery decisions — it only returns matching facts. Empty results SHALL return an empty array, not throw.

#### Scenario: Recoverable runs found

- **WHEN** the store has runs with `status=EXECUTING, terminalCommitState=PENDING`
- **AND** `listRecoverableRuns` is called
- **THEN** the result SHALL include these runs
- **AND** SHALL NOT include runs with `terminalCommitState=COMMITTED`

#### Scenario: No recoverable runs

- **WHEN** all runs have `terminalCommitState=COMMITTED` or terminal statuses
- **AND** `listRecoverableRuns` is called
- **THEN** the result SHALL be an empty array

#### Scenario: Limit enforcement

- **WHEN** there are 10 recoverable runs and `listRecoverableRuns` is called with `limit=5`
- **THEN** the result SHALL contain at most 5 runs, ordered by `created_at ASC`

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
- `saveRun` with `expectedVersion=0` → INSERT; with `expectedVersion>0` → CAS UPDATE; version mismatch → VERSION_CONFLICT; duplicate `expectedVersion=0` → VERSION_CONFLICT
- `loadRun` with correct scope returns `RequestRunRecord`; with mismatched scope returns `undefined`
- `claimRun` UPDATED/VERSION_CONFLICT/NOT_FOUND outcomes (per scenarios above)
- `listRecoverableRuns` filtering and limit (per scenarios above)
- `commitTerminal` COMMITTED/ALREADY_COMMITTED/VERSION_CONFLICT/NOT_FOUND outcomes

#### Scenario: saveRun version conflict

- **WHEN** `saveRun` is called with `expectedVersion=N` that does not match the DB version
- **THEN** result SHALL be `VersionedUpdateResult{status: "VERSION_CONFLICT"}`

#### Scenario: loadRun scope isolation

- **WHEN** a run exists with `tenantId=T1, subjectId=S1`
- **AND** `loadRun` is called with `tenantId=T2, subjectId=S1`
- **THEN** result SHALL be `undefined`

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