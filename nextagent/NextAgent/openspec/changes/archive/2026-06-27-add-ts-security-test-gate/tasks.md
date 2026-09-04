# Tasks: ts-security-test-gate

## Phase 1: Foundation (Runtime P0 Tests)

### Task 1.1: Implement Safe-Not-Found Core
- **Tests**: TC-S-001, TC-S-001B, TC-S-001E
- **Source TP**: TP-006 (跨 Owner 安全隔离)
- **Experience**: TE-02 (safe-not-found 不泄露), TE-05 (无 side effect)
- **Actions**:
  1. Implement `beforeAll`: healthCheck → trustedLogin → createSession → submitRequest → waitForTerminal
  2. TC-S-001: GET nonexistent session → 404 SafeError; POST nonexistent session → 404; assert no property leakage
  3. TC-S-001B: Compare two nonexistent session responses — identical status + identical body structure
  4. TC-S-001E: Baseline msg count → POST attack to nonexistent → verify real session unchanged
- **File**: `TC-S-001-005.test.ts`

### Task 1.2: Implement Redaction Verification
- **Tests**: TC-S-004, TC-S-004B, TC-S-004E
- **Source TP**: TP-S03 (日志/Stream 脱敏)
- **Actions**:
  1. TC-S-004: Submit trigger → collect stream → assert no `sk-test-key-abc`, `张三`, `zhang@example.com`, `internal-system-id`
  2. TC-S-004B: Submit trigger → assert redaction enforced even if config tries to disable
  3. TC-S-004E: Submit trigger → assert short and long keys produce same `***redacted***` format; no length-based inference
- **File**: `TC-S-001-005.test.ts`
- **Dependencies**: `collectStreamText` helper, `getConversation`

### Task 1.3: Implement Sandbox Confinement
- **Tests**: TC-S-005, TC-S-005B, TC-S-005E
- **Source TP**: TP-S04 (Sandbox 隔离)
- **Experience**: TE-10 (Sandbox boundary)
- **Actions**:
  1. TC-S-005: In-bounds bash read → assistant message returned
  2. TC-S-005B: Network access denied → "not allowed"/"拒绝"/"denied"; prohibited path read → no `root:`; prohibited path write → denied
  3. TC-S-005E: Direct agent bash → denied; Skill internal bash → denied (white-box bypass prevention)
- **File**: `TC-S-001-005.test.ts`
- **Dependencies**: `getLastAssistantMessage` helper

## Phase 2: Runtime P1/P2 Tests

### Task 2.1: Implement Scope Indirect Verification
- **Tests**: TC-S-002, TC-S-002E
- **Source TP**: TP-S01 (跨 Scope 安全隔离)
- **Experience**: TE-06 (不可枚举)
- **Actions**:
  1. TC-S-002: Valid session conversation → 200; nonexistent session conversation → 404
  2. TC-S-002E: Agent attempts out-of-scope capability invocation → safe response, no existence disclosure
- **Reality Note**: `/capabilities` endpoint **does not exist**. Verification is indirect. Error code for scope violation is `CONFLICT`, **not** `REQUEST_CANCEL_ALREADY_TERMINAL`.
- **File**: `TC-S-001-005.test.ts`

### Task 2.2: Implement Secret Redaction (P2)
- **Tests**: TC-S-003
- **Source TP**: TP-S02 (Secret 脱敏)
- **Actions**:
  1. TC-S-003: SSE stream payload no raw `sk-actual-api-key-12345`; conversation no raw secret
- **File**: `TC-S-001-005.test.ts`

### Task 2.3: Implement Cancel/Retry Safety
- **Tests**: TC-S-006, TC-S-006E
- **Source TP**: TP-S05 (跨 scope Cancel/Retry 安全隔离)
- **Actions**:
  1. `beforeAll`: Create session with EXECUTING request (for cancel) + session with COMPLETED request (for retry)
  2. TC-S-006: Cancel nonexistent session → 404 `SESSION_NOT_FOUND`; Cancel own executing request → 200/409
  3. TC-S-006E: Retry nonexistent session → 404; Retry own completed → 200/202; No extra messages to normal session
- **File**: `TC-S-006-015.test.ts`

### Task 2.4: Implement *Record Isolation
- **Tests**: TC-S-007
- **Source TP**: TP-S06 (*Record 不进入 Web response)
- **Actions**:
  1. TC-S-007: SSE stream no `RequestRunRecord`, `SessionStateRecord`, `internalStateRecord`; conversation no these types; messages no `internalStateRecord` or `record` properties
- **File**: `TC-S-006-015.test.ts`

## Phase 3: Secret Configuration Boundary (P0, Source Repo Required)

### Task 3.1: Implement Raw Credential Rejection
- **Test**: TC-S-016
- **Source**: SEC-B-R02
- **Actions**:
  1. Write `application.yaml` with `gateway.apiKey: my-secret-key-12345` (raw value)
  2. Execute `nextagent-self-check --config application.yaml`
  3. Assert: `BLOCKED` + `credential-bearing field rejected.*expected SecretReference format.*env:.*file:.*got raw value`
  4. Assert: No `my-secret-key-12345` in combined output
  5. Assert: No raw exception/stack trace in output
  6. `findstr` logs for raw credential → 0 matches
- **Skip Condition**: `REPO_ROOT_AVAILABLE = false`
- **File**: `TC-S-016-020.test.ts`
- **Safety**: `afterAll` restores original config

### Task 3.2: Implement Inactive Secret Reference Bypass
- **Test**: TC-S-017
- **Source**: SEC-B-R04
- **Actions**:
  1. Write config with `active: false` deployment branch using `file:/etc/nextagent/gateway.key`
  2. Execute `nextagent-self-check` with valid env var for primary secret
  3. Assert: `READY` or `DEGRADED_READY` (not `BLOCKED`)
  4. Assert: No I/O for inactive file ref in logs
- **Skip Condition**: `REPO_ROOT_AVAILABLE = false`
- **File**: `TC-S-016-020.test.ts`

### Task 3.3: Implement Active Empty env: Blocking
- **Test**: TC-S-018
- **Source**: SEC-B-R06
- **Actions**:
  1. Write config with `secretRef: env:NEXTAGENT_MODEL_API_KEY`
  2. Execute with `NEXTAGENT_MODEL_API_KEY=""` (empty)
  3. Assert: `BLOCKED` + `SECRET_EMPTY` or `active env:.*reference resolved to empty value`
  4. Assert: Env var name only in ref/desensitized form in logs; no `= ''` patterns
- **Skip Condition**: `REPO_ROOT_AVAILABLE = false`
- **File**: `TC-S-016-020.test.ts`

### Task 3.4: Implement Active Unresolvable file: Blocking
- **Test**: TC-S-019
- **Source**: SEC-B-R06
- **Actions**:
  1. Write config with `credentialRef: file:/etc/nextagent/gateway.key`
  2. Verify target file does not exist
  3. Execute `nextagent-self-check`
  4. Assert: `BLOCKED` + `SECRET_FILE_MISSING` / `SECRET_FILE_UNREADABLE`
  5. Assert: File path only as safe field reference in logs; no raw path
- **Skip Condition**: `REPO_ROOT_AVAILABLE = false`
- **File**: `TC-S-016-020.test.ts`

### Task 3.5: Implement Zero Resolved-Value Leakage
- **Test**: TC-S-020
- **Source**: SEC-B-R09
- **Actions**:
  1. SSE stream: search `sk-real-api-key-abcdef123456` → 0 matches
  2. Conversation: search → 0 matches
  3. Logs: `findstr` → 0 matches (repo required)
  4. Trace/audit: conversation indirect → 0 matches
  5. Metrics: conditional (skip if `/metrics` returns 404) → 0 matches
  6. Frozen config: `findstr` logs → 0 matches
  7. SQLite: `findstr` db files → 0 matches
- **Partial Skip**: SSE/conversation/metrics tests run without repo; log/db/config tests require repo
- **File**: `TC-S-016-020.test.ts`

## Phase 4: Integration & Verification

### Task 4.1: Verify All Test Files Execute
- Run `vitest run tests/add-ts-security-test-gate/`
- Confirm: TC-S-001–TC-S-007 all pass
- Confirm: TC-S-016–TC-S-020 pass or skip (depending on repo availability)

### Task 4.2: Verify Acceptance Criteria
| Criteria | Verification Method |
|----------|---------------------|
| AC-001: All P0 pass | `vitest run` — 0 failures in P0 tests |
| AC-002: All P1 pass | `vitest run` — 0 failures in P1 tests |
| AC-003: All P2 pass | `vitest run` — 0 failures in P2 tests |
| AC-004: No raw credential in output | `findstr` + conversation assertions → 0 matches |
| AC-005: No *Record in web response | conversation + stream assertions → 0 matches |
| AC-006: Sandbox violations denied | Assistant message contains denial keywords |

### Task 4.3: Document API Reality Exceptions
- `/capabilities` does not exist → TC-S-002 uses indirect verification
- Error code is `CONFLICT` (not `REQUEST_CANCEL_ALREADY_TERMINAL`) → TC-S-002E reflects this
- Trusted identity mode → TC-S-001 uses nonexistent safe-not-found instead of cross-tenant
- SSE only → all stream tests use SSE reader
