# add-ts-local-checkpoint-store — 设计

## 目标

追认已有 `saveCheckpoint` / `loadCheckpoint` 实现，归一化 `checkpoints` 表 schema，补齐 agent scope 和 contract tests。

已实现部分（追认）：
- `saveCheckpoint` — transaction 内幂等检查（`idx_checkpoints_idempotency`）→ INSERT，已完整工作
- `loadCheckpoint` — SELECT latest by scope + session/request/run，已完整工作

## 核心决策

### 1. Schema 归一化

当前 `checkpoints` 表：

```sql
CREATE TABLE checkpoints (
  tenant_id        TEXT NOT NULL,
  subject_id       TEXT NOT NULL,
  checkpoint_id    TEXT NOT NULL,
  session_id       TEXT NOT NULL,
  request_id       TEXT NOT NULL,
  run_id           TEXT NOT NULL,
  saved_at         INTEGER NOT NULL,
  idempotency_key  TEXT NOT NULL,
  json             TEXT NOT NULL,
  PRIMARY KEY (tenant_id, subject_id, checkpoint_id)
);
```

归一化后：

```sql
CREATE TABLE checkpoints (
  tenant_id              TEXT NOT NULL,
  subject_id             TEXT NOT NULL,
  agent_id               TEXT NOT NULL,
  checkpoint_id          TEXT NOT NULL,
  session_id             TEXT NOT NULL,
  request_id             TEXT NOT NULL,
  run_id                 TEXT NOT NULL,
  request_context_id     TEXT NOT NULL,
  run_version            INTEGER NOT NULL,
  trigger_reason         TEXT NOT NULL,
  last_sequence          INTEGER NOT NULL,
  active_context_version INTEGER NOT NULL,
  flow_variables         TEXT NOT NULL,
  saved_at               INTEGER NOT NULL,
  idempotency_key        TEXT NOT NULL,
  PRIMARY KEY (tenant_id, subject_id, agent_id, checkpoint_id)
);
CREATE UNIQUE INDEX idx_checkpoints_idempotency
  ON checkpoints(tenant_id, subject_id, agent_id, session_id, request_id, run_id, idempotency_key);
```

变更点：
- 新增 `agent_id TEXT NOT NULL` — agent scope 强制，写入时从 `CheckpointRecord.agentId` 取值（需合约补齐）
- 删除 `json TEXT NOT NULL` — 所有字段独立列
- 新增 6 个独立列：`request_context_id`、`run_version`、`trigger_reason`、`last_sequence`、`active_context_version`、`flow_variables`
- PK 从 `(tenant_id, subject_id, checkpoint_id)` 改为 `(tenant_id, subject_id, agent_id, checkpoint_id)`
- `idx_checkpoints_idempotency` 增加 `agent_id` 维度

`flow_variables` 为 `JsonObject` 类型，存为 TEXT（JSON 序列化字符串），读写时 `JSON.stringify`/`JSON.parse`。

### 2. agent_id 列

当前 `agent-contracts` 的 `CheckpointRecord` 不包含 `agentId` 字段。需补齐合约：

```typescript
export interface CheckpointRecord extends OwnerScoped {
  readonly agentId: AgentId;  // 新增
  readonly checkpointId: CheckpointId;
  // ... 其余不变
}
```

对应的 `CheckpointPayload`（runtime contract）也需补齐 `agentId`。

调用方 `saveRuntimeCheckpoint` 需从 `run.agentId` 获取并传入。

### 3. saveCheckpoint — 独立列写入

```
saveCheckpoint(record, options):
  transaction:
    -- 幂等检查（idx_checkpoints_idempotency）
    SELECT * WHERE scope + session + request + run + idempotency_key
    -- 若存在 → 返回已有 record
    -- 若不存在 → INSERT 15 个独立列，无 json
```

### 4. loadCheckpoint — 独立列读取

```
loadCheckpoint(request):
  SELECT tenant_id, subject_id, agent_id, checkpoint_id, session_id,
         request_id, run_id, request_context_id, run_version,
         trigger_reason, last_sequence, active_context_version,
         flow_variables, saved_at
  FROM checkpoints
  WHERE tenant_id=? AND subject_id=? AND agent_id=?
    AND session_id=? AND request_id=? AND run_id=?
  ORDER BY saved_at DESC, checkpoint_id ASC
  LIMIT 1
  -- 空结果 → undefined
  -- 有结果 → toCheckpointRecord(row)
```

### 5. CheckpointRow 接口 + toCheckpointRecord

```
interface CheckpointRow {
  tenant_id, subject_id, agent_id, checkpoint_id, session_id,
  request_id, run_id, request_context_id, run_version,
  trigger_reason, last_sequence, active_context_version,
  flow_variables, saved_at
}

function toCheckpointRecord(row: CheckpointRow): CheckpointRecord {
  return {
    tenantId, subjectId, agentId, checkpointId, ...,
    flowVariables: JSON.parse(row.flow_variables)
  };
}
```

## 失败处理

| 场景 | 产出 |
|------|------|
| scope 不匹配 | loadCheckpoint → undefined |
| 无匹配 checkpoint | loadCheckpoint → undefined |
| 幂等重复 | saveCheckpoint → 返回已有 record |
| SQLite 不可用 | SafeError(LOCAL_STORE_UNAVAILABLE) |

## 不在范围

- 已实现的 saveCheckpoint/loadCheckpoint — 不重新实现，只改 schema 绑定
- Checkpoint 恢复逻辑 → `add-ts-local-runtime-recovery`
- Session/SessionMessage → `add-ts-local-session-store`
- RequestRun/Timeline → `add-ts-local-run-timeline-store`
- 过期/清理策略
- schema migration 框架