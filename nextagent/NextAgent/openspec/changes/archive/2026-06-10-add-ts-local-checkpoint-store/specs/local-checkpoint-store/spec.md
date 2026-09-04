# [TS] 本地 Checkpoint 持久化规格 — 归一化与测试

## ADDED Requirements

### Requirement: Checkpoint schema 归一化

`checkpoints` 表 SHALL have all fields as independent SQL columns. The `json TEXT` column SHALL be removed.

The table SHALL include `agent_id TEXT NOT NULL` as part of the primary key and all index definitions, enforcing agent scope at the persistence layer. `CheckpointRecord` in `agent-contracts` SHALL be extended with an `agentId: AgentId` field.

New columns extracted from the former `json` blob:

| Column | Type | Source field |
|--------|------|-------------|
| `agent_id` | TEXT NOT NULL | `CheckpointRecord.agentId` |
| `request_context_id` | TEXT NOT NULL | `CheckpointRecord.requestContextId` |
| `run_version` | INTEGER NOT NULL | `CheckpointRecord.runVersion` |
| `trigger_reason` | TEXT NOT NULL | `CheckpointRecord.triggerReason` |
| `last_sequence` | INTEGER NOT NULL | `CheckpointRecord.lastSequence` |
| `active_context_version` | INTEGER NOT NULL | `CheckpointRecord.activeContextVersion` |
| `flow_variables` | TEXT NOT NULL | `CheckpointRecord.flowVariables` (stored as JSON string) |

PRIMARY KEY SHALL be `(tenant_id, subject_id, agent_id, checkpoint_id)`.

#### Scenario: Checkpoint table has no json column

- **WHEN** the checkpoint store initializes
- **THEN** the `checkpoints` table SHALL NOT contain a `json` column
- **AND** all 15 columns SHALL be independent SQL columns

#### Scenario: Checkpoint table has agent scope

- **WHEN** `saveCheckpoint` is called with `agentId=A1`
- **AND** `loadCheckpoint` is called with `agentId=A2`
- **THEN** `loadCheckpoint` SHALL return `undefined`

### Requirement: saveCheckpoint — 幂等独立列写入

`CheckpointStoreGateway.saveCheckpoint` SHALL insert a new checkpoint row with all fields bound as individual SQL columns. The implementation SHALL remain transactional with idempotency check via `idx_checkpoints_idempotency`.

Same `idempotencyKey` + same scope SHALL return the existing `CheckpointRecord` without producing a duplicate row.

#### Scenario: Save new checkpoint

- **WHEN** `saveCheckpoint` is called with a new `checkpointId` and `idempotencyKey`
- **THEN** the store SHALL INSERT a row with all 15 columns populated
- **AND** return the `CheckpointRecord`

#### Scenario: Idempotent duplicate save

- **WHEN** `saveCheckpoint` is called with the same `idempotencyKey` as a previously committed checkpoint
- **THEN** the store SHALL NOT insert a new row
- **AND** SHALL return the existing `CheckpointRecord`

### Requirement: loadCheckpoint — 最新 checkpoint 查询

`CheckpointStoreGateway.loadCheckpoint` SHALL return the most recent checkpoint for the given scope (`tenantId`, `subjectId`, `agentId`) and (`sessionId`, `requestId`, `runId`), ordered by `saved_at DESC, checkpoint_id ASC`.

No matching checkpoint SHALL return `undefined`.

#### Scenario: Load latest checkpoint

- **WHEN** two checkpoints exist for the same scope + session/request/run with different `savedAt`
- **AND** `loadCheckpoint` is called for that scope + session/request/run
- **THEN** the store SHALL return the checkpoint with the most recent `savedAt`

#### Scenario: Load with mismatched scope returns undefined

- **WHEN** a checkpoint exists with `tenantId=T1, agentId=A1`
- **AND** `loadCheckpoint` is called with `tenantId=T2` or `agentId=A2`
- **THEN** the store SHALL return `undefined`

#### Scenario: No matching checkpoint returns undefined

- **WHEN** no checkpoint exists for the given scope + session/request/run
- **AND** `loadCheckpoint` is called
- **THEN** the store SHALL return `undefined`

### Requirement: CheckpointStoreGateway contract tests

`CheckpointStoreGateway` SHALL have contract tests verifying:
- `saveCheckpoint` with new `idempotencyKey` inserts; with duplicate `idempotencyKey` returns existing record
- `loadCheckpoint` returns latest by `savedAt DESC`; wrong scope returns `undefined`
- Agent scope isolation — `agentId` mismatch produces no results

#### Scenario: saveCheckpoint idempotent across different checkpointIds

- **WHEN** `saveCheckpoint` is called with `checkpointId=C1, idempotencyKey=K`
- **AND** `saveCheckpoint` is called with `checkpointId=C2, idempotencyKey=K`
- **THEN** the second call SHALL return the first checkpoint (checkpointId=C1)
- **AND** no second row SHALL be inserted

#### Scenario: loadCheckpoint agent scope isolation

- **WHEN** a checkpoint is saved with `agentId=A1`
- **AND** `loadCheckpoint` is called with `agentId=A2` (same tenant/subject/session/request/run)
- **THEN** the store SHALL return `undefined`

### Requirement: 失败与降级行为

Gateway adapter 的所有操作 MUST 在遇到不可恢复错误时返回 SafeError，不得抛 raw exception。SQLite 不可用时 MUST 返回 `SafeError(LOCAL_STORE_UNAVAILABLE)`。

#### Scenario: SQLite 不可用

- **WHEN** SQLite 连接丢失、文件不可访问或磁盘满
- **THEN** 操作返回 SafeError（`LOCAL_STORE_UNAVAILABLE`）
- **AND** SafeError 不包含 raw SQLite error message、文件路径或 connection string