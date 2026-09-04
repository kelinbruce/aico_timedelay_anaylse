# add-ts-local-session-store — 设计

## 目标

补实 `hideMessage` 的 SQLite 实现；完成 sessions、messages、attachments、pending_inputs 四张表的独立列 schema 迁移；补齐 `SessionStoreGateway` 和 `SessionMessageStoreGateway` 的 contract/integration tests。

已实现部分（追认，不改动）：
- `SessionStoreGateway`：loadSession、listSessions、saveSession — 完整 SQLite 实现，owner scope + agent scope 严格过滤
- `SessionMessageStoreGateway`：appendSessionMessage、loadMessage、listMessages、listCurrentRequestMessages — 完整 SQLite 实现，owner scope + agent scope 严格过滤

## 核心决策

### 1. hideMessage：SQLite UPDATE

`messages` 表已有 `visible INTEGER NOT NULL` 列，`listMessages` 已支持 `includeHidden` 过滤。只需补 UPDATE 写路径。

```
hideMessage(request: HideMessageRequest):
  UPDATE messages
  SET visible = 0, metadata = <merged metadata with visibility info>
  WHERE tenant_id = request.tenantId
    AND subject_id = request.subjectId
    AND agent_id = request.agentId
    AND message_id = request.messageId
  -- 影响行数=0 → not-found (return undefined)
  -- 影响行数=1 → SELECT 当前行组装 SessionMessageRecord，返回
```

所有字段均为独立 SQL 列，无 json 列。UPDATE 只改 `visible` 和 `metadata` 列。

### 2. hideMessage 幂等

`HideMessageRequest` 包含 `idempotencyKey`。同一 idempotencyKey 重复调用应返回已隐藏的 record，不产生额外 UPDATE。

```
hideMessage(request):
  -- 检查 idempotencyKey 是否已处理（同 appendSessionMessage 的幂等机制）
  -- 若已存在 → 返回已隐藏的 record
  -- 若不存在 → UPDATE visible=0 WHERE PK
```

利用 `messages` 表现有的 `idx_messages_idempotency` partial unique index 实现幂等。

### 3. Schema 迁移：四张表 json 列 → 独立列

遵循与 `add-ts-local-checkpoint-store` 相同的模式：通过 `ensureColumn()` 增量添加新列 → 回填存量数据 → 切换读写 → 保留旧 `json` 列但不读写。

#### 3.1 sessions 表

```sql
CREATE TABLE sessions (
  tenant_id    TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  title        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  idempotency_key TEXT,
  PRIMARY KEY (tenant_id, subject_id, agent_id, session_id)
);
CREATE INDEX idx_sessions_history ON sessions(tenant_id, subject_id, agent_id, updated_at DESC, session_id ASC);
CREATE UNIQUE INDEX idx_sessions_idempotency ON sessions(tenant_id, subject_id, agent_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
```

改动：删除 `json TEXT NOT NULL` 列，新增 `title TEXT`。保留 `idempotency_key` 和幂等索引——运行时每次请求生成新 sessionId，依赖 idempotencyKey 返回已有 session。

读路径 `loadSession`：`SELECT tenant_id, subject_id, agent_id, session_id, title, created_at, updated_at FROM sessions WHERE ...` → 组装 `SessionRecord`。

`listSessions` 同理。`getSessionRow`（saveSession 内部用）同时读取 `idempotency_key` 以在 `INSERT OR REPLACE` 时保留。

写路径 `putSession`：`INSERT OR REPLACE INTO sessions(tenant_id, subject_id, agent_id, session_id, title, created_at, updated_at, idempotency_key) VALUES (...)`

#### 3.2 messages 表

```sql
CREATE TABLE messages (
  tenant_id      TEXT NOT NULL,
  subject_id     TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  message_id     TEXT NOT NULL,
  session_id     TEXT NOT NULL,
  request_id     TEXT NOT NULL,
  run_id         TEXT,
  role           TEXT NOT NULL,
  content        TEXT NOT NULL,
  content_type   TEXT NOT NULL,
  metadata       TEXT NOT NULL,
  visible        INTEGER NOT NULL,
  created_at     INTEGER NOT NULL,
  idempotency_key TEXT,
  PRIMARY KEY (tenant_id, subject_id, agent_id, message_id)
);
CREATE INDEX idx_messages_session_history  ON messages(tenant_id, subject_id, agent_id, session_id, created_at ASC, message_id ASC);
CREATE INDEX idx_messages_current_request ON messages(tenant_id, subject_id, agent_id, session_id, request_id, run_id, created_at ASC, message_id ASC);
CREATE UNIQUE INDEX idx_messages_idempotency ON messages(tenant_id, subject_id, agent_id, session_id, request_id, COALESCE(run_id, ''), idempotency_key) WHERE idempotency_key IS NOT NULL;
```

改动：删除 `json TEXT NOT NULL` 列，新增 `content TEXT NOT NULL`、`content_type TEXT NOT NULL`、`metadata TEXT NOT NULL`。`metadata` 保持 JSON 序列化（其内容本质多态）。

读路径：`SELECT tenant_id, subject_id, agent_id, message_id, session_id, request_id, run_id, role, content, content_type, metadata, visible, created_at FROM messages WHERE ...` → 逐列组装 `SessionMessageRecord`，其中 `metadata` 经 `JSON.parse`。

写路径 `saveMessageSync`：`INSERT INTO messages(...) VALUES(?, ?, ?, ..., ?, ?, ?)` — `content`、`content_type`、`metadata` 独立绑定，不再整体 `JSON.stringify`。

`hideMessage`：UPDATE 直接改 `visible = 0` 和 `metadata` 列，不再需要 `JSON.stringify(hidden)` 写入 `json` 列。

#### 3.3 attachments 表

```sql
CREATE TABLE attachments (
  tenant_id           TEXT NOT NULL,
  subject_id          TEXT NOT NULL,
  agent_id            TEXT NOT NULL,
  attachment_id       TEXT NOT NULL,
  session_id          TEXT NOT NULL,
  request_id          TEXT NOT NULL,
  run_id              TEXT,
  file_name           TEXT NOT NULL,
  media_type          TEXT NOT NULL,
  storage_ref         TEXT NOT NULL,
  validation_status   TEXT NOT NULL,
  availability_status TEXT NOT NULL,
  created_at          INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, subject_id, agent_id, attachment_id)
);
CREATE INDEX idx_attachments_request
  ON attachments(tenant_id, subject_id, agent_id, request_id, created_at ASC, attachment_id ASC);
```

改动：删除 `json TEXT NOT NULL` 列，新增 `file_name TEXT NOT NULL`、`media_type TEXT NOT NULL`、`storage_ref TEXT NOT NULL`。

读路径：`loadAttachment`、`listAttachmentsByRequestId`、`updateAttachmentStatus` — `SELECT` 改为逐列读取，组装 `RequestAttachmentRecord`。

写路径：`putAttachment` — `INSERT OR REPLACE` 改为所有 13 列独立绑定。

#### 3.4 pending_inputs 表

```sql
CREATE TABLE pending_inputs (
  tenant_id           TEXT NOT NULL,
  subject_id          TEXT NOT NULL,
  agent_id            TEXT NOT NULL,
  pending_input_id    TEXT NOT NULL,
  session_id          TEXT NOT NULL,
  request_id          TEXT NOT NULL,
  request_run_id      TEXT NOT NULL,
  request_context_id  TEXT NOT NULL,
  checkpoint_id       TEXT NOT NULL,
  kind                TEXT NOT NULL,
  request             TEXT NOT NULL,
  status              TEXT NOT NULL,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  response_answers    TEXT,
  PRIMARY KEY (tenant_id, subject_id, agent_id, pending_input_id)
);
CREATE INDEX idx_pending_inputs_run
  ON pending_inputs(tenant_id, subject_id, agent_id, request_run_id, status);
```

改动：删除 `json TEXT NOT NULL` 列，新增 6 列：
- `request_context_id TEXT NOT NULL` — 标量字符串
- `checkpoint_id TEXT NOT NULL` — 标量字符串
- `kind TEXT NOT NULL` — PendingInputKind 枚举字符串
- `created_at INTEGER NOT NULL` — 时间戳
- `request TEXT NOT NULL` — `PendingInputRequestRecord` 序列化 JSON（嵌套对象 `{ id, sessionId, kind, questions, timeoutAt? }`）
- `response_answers TEXT` — nullable，`(readonly string[])[]` 序列化 JSON

读路径：`loadPendingInput`、`resolvePendingInput` — `SELECT` 逐列读取，`request` 和 `response_answers` 经 `JSON.parse`。

写路径：`putPendingInput` — `INSERT OR REPLACE` 改为所有 15 列独立绑定，`request` 和 `response_answers` 经 `JSON.stringify`。

#### 3.5 迁移策略

v1 无存量数据。直接在 `initialize()` 的 `CREATE TABLE IF NOT EXISTS` 中修改 DDL，删除 `json` 列、添加新列。无需 `ensureColumn` 增量加列，无需回填。

## 数据流

```
调用方                    Gateway Port               Local Store
──────                    ────────────               ───────────
隐藏消息 ───────────────► hideMessage(request) ─────► UPDATE messages SET visible=0, metadata=? WHERE PK
                                        │
                                        ▼
                          idempotency check ───────► idx_messages_idempotency
```

## 失败处理

| 场景 | 产出 |
|------|------|
| owner/agent scope 不匹配 | 返回 `undefined`（不抛异常，不区分 not-found 和 scope mismatch） |
| messageId 不存在 | 返回 `undefined` |
| idempotencyKey 重复 | 返回已隐藏的 record |
| SQLite 不可用 | gateway error → SafeError(`LOCAL_STORE_UNAVAILABLE`) |

## 不在范围

- 已实现的 7 个方法 — 不重新实现，只改内部存储格式
- RequestRun/Timeline 持久化 → `add-ts-local-run-timeline-store`
- Checkpoint → `add-ts-local-checkpoint-store`
- Artifact → `add-ts-local-artifact-store`
- 恢复策略 → `add-ts-local-runtime-recovery`
- 过期/清理策略
- schema migration 框架
- 历史数据迁移 — v1 无存量数据