# add-ts-local-run-timeline-store — 设计

## 目标

补实 `claimRun` 和 `listRecoverableRuns` 的 SQLite 实现，并补齐 `RequestRunStoreGateway` 和 `RunTimelineEventStoreGateway` 的 contract tests，重点覆盖 terminal commit 幂等/恢复语义。

已实现部分（追认，不改动）：
- `RequestRunStoreGateway`：saveRun（CAS version check）、loadRun（owner scope SELECT）、commitTerminal（事务原子：UPDATE run + INSERT timeline event + 记录 idempotency）
- `RunTimelineEventStoreGateway`：appendEvent（sequence 分配 + idempotent）、listEvents（scope + afterSequence + optional requestId/runId 过滤）

## 核心决策

### 1. claimRun：本地 CAS 领取

本地单进程模式下无分布式竞争，但 contract 要求 CAS 领取语义。实现为简单的 version check UPDATE：

```
claimRun(request: ClaimRunRequest):
  UPDATE request_runs
  SET locked_by = request.lockedBy,
      lock_expires_at = request.lockExpiresAt,
      version = version + 1,
      updated_at = <now>
  WHERE tenant_id = request.tenantId
    AND subject_id = request.subjectId
    AND run_id = request.runId
    AND version = request.expectedVersion
  -- 影响行数=0 → 判断 VERSION_CONFLICT 或 NOT_FOUND
  -- 影响行数=1 → UPDATED，返回更新后的 record
```

本地模式下 claimRun 的实际价值：为 contract 完整性和 future remote gateway 对齐提供一致语义。当前 single-session lane 机制保证同一 session 只有一个活跃 writer，claimRun 不被主路径调用，但 contract 约定存在即需实现。

不校验锁定是否过期、当前持有者——只做原子条件写入。

### 2. listRecoverableRuns：系统级恢复发现

`SystemListRecoverableRunsRequest` 合约只有 `now` + `limit`，不含 owner scope（`tenantId`/`subjectId`）。这是有意设计：恢复发现是系统级操作，不按 tenant/subject 过滤。

```
listRecoverableRuns(request: SystemListRecoverableRunsRequest):
  SELECT tenant_id, subject_id, run_id, session_id, request_id, agent_id,
         agent_version, agent_assembly_ref, attempt, status, version,
         terminal_commit_state, created_at, updated_at
  FROM request_runs
  WHERE status IN (<active statuses>)
    AND terminal_commit_state IN ('NOT_STARTED', 'PENDING', 'RETRYING')
  ORDER BY created_at ASC
  LIMIT request.limit
  -- 空结果 → 空数组
```

本地模式下此方法为进程重启恢复提供入口。Gateway 只返回事实，不做恢复决策（恢复逻辑由 Runtime 的 `add-ts-local-runtime-recovery` 负责）。

### 3. Schema（追认）

`request_runs` 表：
```sql
CREATE TABLE request_runs (
  tenant_id              TEXT NOT NULL,
  subject_id             TEXT NOT NULL,
  run_id                 TEXT NOT NULL,
  session_id             TEXT NOT NULL,
  request_id             TEXT NOT NULL,
  agent_id               TEXT NOT NULL,
  agent_version          TEXT NOT NULL,
  agent_assembly_ref     TEXT NOT NULL,
  attempt                INTEGER NOT NULL,
  status                 TEXT NOT NULL,
  version                INTEGER NOT NULL,
  terminal_commit_state  TEXT NOT NULL,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  idempotency_key        TEXT,
  PRIMARY KEY (tenant_id, subject_id, run_id)
);
CREATE UNIQUE INDEX idx_request_runs_idempotency
  ON request_runs(tenant_id, subject_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

`timeline_events` 表：
```sql
CREATE TABLE timeline_events (
  tenant_id            TEXT NOT NULL,
  subject_id           TEXT NOT NULL,
  agent_id             TEXT NOT NULL,
  session_id           TEXT NOT NULL,
  sequence             INTEGER NOT NULL,
  event_id             TEXT NOT NULL,
  request_id           TEXT NOT NULL,
  run_id               TEXT NOT NULL,
  request_context_id   TEXT NOT NULL,
  type                 TEXT NOT NULL,
  inline_payload       TEXT NOT NULL,
  content_ref          TEXT,
  created_at           INTEGER NOT NULL,
  idempotency_key      TEXT,
  PRIMARY KEY (tenant_id, subject_id, agent_id, session_id, sequence)
);
CREATE UNIQUE INDEX idx_timeline_events_idempotency
  ON timeline_events(tenant_id, subject_id, agent_id, session_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

- 无 `local_` 前缀；无 `local_terminal_idempotency` 独立表
- terminal idempotency 通过 `request_runs.idempotency_key` + `terminal_commit_state=COMMITTED` 实现
- 无 json 列——所有字段均为独立 SQL 列，读写时逐列绑定

### 4. Terminal commit 幂等/恢复语义

`commitTerminal` 的现有实现已包含完整的事务原子性：
1. 检查 run existence + version → NOT_FOUND / VERSION_CONFLICT
2. 检查 terminalCommitState → ALREADY_COMMITTED（幂等）
3. UPDATE run status + terminalCommitState=COMMITTED + version+1
4. INSERT timeline event
5. UPDATE session updatedAt

测试需要覆盖的场景：
- **幂等重试**：相同 idempotencyKey 二次调用 → ALREADY_COMMITTED，不产生重复 timeline event
- **事务回滚安全**：模拟事务中步骤失败 → run/timeline 不残留 → 可用相同 idempotencyKey 重试
- **崩溃恢复一致性**：commitTerminal 成功后进程重启 → loadRun 返回 COMMITTED 状态 → listEvents 包含 terminal event
- **Version 冲突**：expectedVersion 不匹配 → VERSION_CONFLICT，run/timeline 不变

### 5. loadSessionLaneSnapshot — 不在本 change

`loadSessionLaneSnapshot` 方法尚未定义在 `agent-contracts` 的 `RequestRunStoreGateway` 接口中（当前接口只有 5 个方法）。此方法应由 `add-ts-session-lane-scheduling` change 在合约层面先定义，再由后续 change 实现。

## 数据流

```
调用方                    Gateway Port               Local Store
──────                    ────────────               ───────────
领取 run ───────────────► claimRun(request) ───────► UPDATE SET locked_by WHERE version=expectedVersion
恢复发现 ───────────────► listRecoverableRuns ─────► SELECT by status + terminalCommitState
```

## 失败处理

| 场景 | 产出 |
|------|------|
| version 不匹配 (claimRun) | VERSION_CONFLICT |
| run 不存在 (claimRun) | NOT_FOUND |
| SQLite 不可用 | SafeError(LOCAL_STORE_UNAVAILABLE) |
| 空结果 (listRecoverableRuns) | 空数组 |

## 不在范围

- 已实现的 saveRun/loadRun/commitTerminal/appendEvent/listEvents — 不重新实现
- loadSessionLaneSnapshot → `add-ts-session-lane-scheduling`
- Session/SessionMessage → `add-ts-local-session-store`
- Checkpoint → `add-ts-local-checkpoint-store`
- Artifact → `add-ts-local-artifact-store`
- 恢复决策逻辑 → `add-ts-local-runtime-recovery`
- 多实例 lock/lease/共享状态
- Timeline event 过期/清理策略