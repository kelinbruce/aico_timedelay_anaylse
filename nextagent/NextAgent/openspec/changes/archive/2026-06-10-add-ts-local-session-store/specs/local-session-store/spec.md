## ADDED Requirements

### Requirement: hideMessage — visibility flag update with audit trail

Local session store SHALL implement `SessionMessageStoreGateway.hideMessage(request: HideMessageRequest)` to mark a persisted message as `visible=false` with `reason` and `hiddenByContextId` recorded in the message metadata, within the owner scope (`tenantId` + `subjectId` + `agentId`).

The implementation SHALL UPDATE the `visible` column to `0` directly WHERE owner scope + agent scope + messageId match.

`hideMessage` SHALL be idempotent via state-based detection: if the message is already marked as `visible=false`, return the existing hidden `SessionMessageRecord` without modification.

After `hideMessage` succeeds, subsequent `listMessages` calls (without `includeHidden=true`) SHALL exclude this message. `loadMessage` SHALL still return the message with `visible=false`.

#### Scenario: Hide existing message

- **WHEN** `hideMessage` is called with a valid `messageId` within the correct owner scope
- **THEN** the store SHALL set `visible=false` with the provided `reason`, `hiddenAt`, `hiddenByContextId`
- **AND** subsequent `listMessages` SHALL exclude this message
- **AND** `loadMessage` SHALL still return the message with `visible=false`

#### Scenario: Idempotent hide returns existing

- **WHEN** `hideMessage` is called for a message that is already marked as `visible=false`
- **THEN** the store SHALL NOT modify the record
- **AND** SHALL return the existing hidden `SessionMessageRecord`

#### Scenario: Hide non-existent message returns undefined

- **WHEN** `hideMessage` is called with a `messageId` that does not exist
- **THEN** the store SHALL return `undefined`
- **AND** SHALL NOT throw

#### Scenario: Hide with mismatched scope returns undefined

- **WHEN** `hideMessage` is called with a correct `messageId` but mismatched `tenantId`, `subjectId` or `agentId`
- **THEN** the store SHALL return `undefined`
- **AND** SHALL NOT distinguish between "not found" and "scope mismatch"

### Requirement: SessionStoreGateway contract tests

`SessionStoreGateway` SHALL have contract tests verifying:
- `loadSession` with correct scope returns `SessionRecord`; with mismatched scope returns `undefined`
- `listSessions` returns sessions for the given owner scope, ordered by `updatedAt` descending, with `hasMore` pagination
- `saveSession` upserts by PK（INSERT OR REPLACE by `tenantId, subjectId, agentId, sessionId`），同 sessionId 重写覆盖
- Owner scope (`tenantId` + `subjectId`) and agent scope (`agentId`) isolation — cross-scope access returns empty

#### Scenario: loadSession scope isolation

- **WHEN** a session is saved with `tenantId=T1, subjectId=S1, agentId=A1`
- **AND** `loadSession` is called with `tenantId=T2, subjectId=S1, agentId=A1`
- **THEN** the store SHALL return `undefined`

#### Scenario: listSessions agent scope isolation

- **WHEN** two sessions exist for the same owner (`tenantId=T, subjectId=S`) but different agents (`A1`, `A2`)
- **AND** `listSessions` is called with `agentId=A1`
- **THEN** the result SHALL contain only `A1` sessions

### Requirement: SessionMessageStoreGateway contract tests

`SessionMessageStoreGateway` SHALL have contract tests verifying:
- `appendSessionMessage` with new `idempotencyKey` inserts; with duplicate `idempotencyKey` returns existing record unchanged
- `loadMessage` with correct scope returns `SessionMessageRecord`; with mismatched scope returns `undefined`
- `listMessages` with `includeHidden=false` excludes hidden messages; with `includeHidden=true` includes all
- `listCurrentRequestMessages` isolates by `requestId` + `runId` within owner scope
- Sequence monotonicity across requests and runs within the same session

#### Scenario: listMessages excludes hidden by default

- **WHEN** a session has 5 messages, 2 of which are `visible=false`
- **AND** `listMessages` is called without `includeHidden`
- **THEN** the result SHALL contain only the 3 visible messages

#### Scenario: listMessages includes hidden when requested

- **WHEN** `listMessages` is called with `includeHidden=true`
- **THEN** the result SHALL include both visible and hidden messages

#### Scenario: Sequence monotonic across requests

- **WHEN** a session has messages at sequences 1, 2, 3 from a prior request
- **AND** a new message is appended for a subsequent request in the same session
- **THEN** the new message SHALL receive a sequence > 3

### Requirement: Schema normalization — no json blob columns

Sessions, messages, attachments, and pending_inputs tables SHALL have all fields as independent SQL columns. The `json TEXT` column SHALL NOT be used for read or write operations on these tables.

#### sessions table

`sessions` table SHALL include `title TEXT` as an independent column. Read and write operations SHALL bind individual columns without `JSON.stringify`/`JSON.parse` on a whole-record json column.

`touchSession` SHALL use a direct `UPDATE SET updated_at = ?` without reading or writing a json blob.

#### messages table

`messages` table SHALL include `content TEXT NOT NULL`, `content_type TEXT NOT NULL`, and `metadata TEXT NOT NULL` as independent columns. `metadata` MAY be stored as a JSON-serialized string due to its polymorphic nature, but SHALL be bound as its own column, not wrapped inside a whole-record json blob.

#### attachments table

`attachments` table SHALL include `file_name TEXT NOT NULL`, `media_type TEXT NOT NULL`, and `storage_ref TEXT NOT NULL` as independent columns.

#### pending_inputs table

`pending_inputs` table SHALL include `request_context_id TEXT NOT NULL`, `checkpoint_id TEXT NOT NULL`, `kind TEXT NOT NULL`, `created_at INTEGER NOT NULL`, `request TEXT NOT NULL`, and `response_answers TEXT` as independent columns. `request` and `response_answers` MAY be stored as JSON-serialized strings due to their nested structure, but SHALL be bound as their own columns.

#### Scenario: loadSession returns correct session without json column

- **WHEN** a session is saved via `saveSession` with independent columns
- **AND** `loadSession` reads the session
- **THEN** the returned `SessionRecord` SHALL match the saved record
- **AND** the store SHALL NOT read from or write to a `json` column on the `sessions` table

#### Scenario: appendSessionMessage persists without json column

- **WHEN** a message is appended via `appendSessionMessage`
- **AND** `loadMessage` reads the message
- **THEN** the returned `SessionMessageRecord` SHALL match the saved record
- **AND** the store SHALL NOT read from or write to a `json` column on the `messages` table

#### Scenario: touchSession uses direct UPDATE

- **WHEN** `touchSession` is called to bump `updated_at`
- **THEN** the store SHALL execute a direct `UPDATE sessions SET updated_at = ? WHERE ...`
- **AND** SHALL NOT read the session row before updating

### Requirement: Explicit failure, no silent errors

All store operations SHALL produce explicit outcomes. Silent truncation, silent discard, and raw exception propagation across the port boundary SHALL NOT occur.

When the underlying storage is unavailable, the store SHALL return a gateway error normalized to `SafeError` with category `UNAVAILABLE`, not a raw database exception.

"Not found" on load or hide SHALL return `undefined`, not throw. Idempotent duplicate on save or hide SHALL return the existing record, not throw.

#### Scenario: Storage unavailable returns SafeError

- **WHEN** any store operation encounters a lost SQLite connection or disk-full condition
- **THEN** the store SHALL return an error with category `UNAVAILABLE`
- **AND** SHALL NOT throw a raw database exception across the port boundary
