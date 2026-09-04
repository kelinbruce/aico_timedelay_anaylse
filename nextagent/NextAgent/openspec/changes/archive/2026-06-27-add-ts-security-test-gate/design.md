# Design: ts-security-test-gate

## 1. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Test Runner (Vitest)                    │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │  Part 1     │  │  Part 2     │  │  Part 3         │ │
│  │ TC-S-001-005│  │ TC-S-006-007│  │ TC-S-016-020    │ │
│  │ (runtime)   │  │ (runtime)   │  │ (config+repo)   │ │
│  └─────────────┘  └─────────────┘  └─────────────────┘ │
│         │                │                 │             │
│         ▼                ▼                 ▼             │
│  ┌──────────────────────────────────────────────────┐   │
│  │              api-client helpers                   │   │
│  │  trustedLogin · createSession · submitRequest    │   │
│  │  getConversation · waitForTerminal · cancelRun   │   │
│  │  retryRun · connectStream · execCommand          │   │
│  │  readFileContent · writeFileContent · fileExists │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
              │                              │
              ▼                              ▼
   ┌──────────────────┐        ┌──────────────────────┐
   │ NextAgent Backend │        │ Source Repo (optional)│
   │ (HTTP + SSE)      │        │ nextagent-self-check  │
   └──────────────────┘        │ Config files / Logs   │
                               └──────────────────────┘
```

## 2. Test Organization

### 2.1 File Structure

```
tests/add-ts-security-test-gate/
├── TC-S-001-005.test.ts   # Part 1: Identity + Scope + Secret Redaction + Sandbox
├── TC-S-006-015.test.ts   # Part 2: Cancel/Retry Safety + *Record Isolation
├── TC-S-016-020.test.ts   # Part 3: Secret Configuration Boundary (repo required)
└── helpers/
    └── api-client.ts      # Shared test helpers
```

### 2.2 Grouping by Priority

| Group | Cases | Files | Environment |
|-------|-------|-------|-------------|
| **G-P0-runtime** | TC-S-001, TC-S-001B, TC-S-001E, TC-S-004, TC-S-004B, TC-S-004E, TC-S-005, TC-S-005B, TC-S-005E | Part 1 | Backend only |
| **G-P1-runtime** | TC-S-002, TC-S-002E, TC-S-006, TC-S-006E | Parts 1+2 | Backend only |
| **G-P2-runtime** | TC-S-003, TC-S-007 | Parts 1+2 | Backend only |
| **G-P0-repo** | TC-S-016, TC-S-017, TC-S-018, TC-S-019, TC-S-020 | Part 3 | Backend + Source repo |

## 3. Test Design Patterns

### 3.1 Safe-Not-Found Pattern

```
┌─────────────────┐
│ Request → 404   │
│ SafeError body  │──▶ No property leakage (sessionId, requestId, etc.)
│ No side effect  │──▶ Existing sessions unchanged
└─────────────────┘

Applied to: TC-S-001, TC-S-001B, TC-S-001E, TC-S-006, TC-S-006E
```

**Implementation**:
- Create a baseline session with known state
- Send request to `nonExistSessionId`
- Verify: (a) 404 status, (b) no property leakage, (c) baseline session unchanged

### 3.2 Indirect Verification Pattern

```
┌──────────────────────────────┐
│ /capabilities does NOT exist │
│                              │
│ Verify scope via:            │
│  1. Valid session → conv 200 │
│  2. Invalid session → conv 404│
│  3. Out-of-scope invocation  │──▶ safe-not-found (CONFLICT, not REQUEST_CANCEL_ALREADY_TERMINAL)
└──────────────────────────────┘

Applied to: TC-S-002, TC-S-002E
```

**Error Code Reality**: The backend returns `CONFLICT` for scope violations, not `REQUEST_CANCEL_ALREADY_TERMINAL`. TC-S-002E must assert this reality.

### 3.3 Redaction Verification Pattern

```
┌────────────────────────┐
│ Submit trigger message  │──▶ "show API key / user info"
│ Collect SSE stream text │──▶ search for raw secret/PII
│ Get conversation body   │──▶ JSON.stringify → search for raw secret/PII
│ Assert: 0 matches       │
└────────────────────────┘

Applied to: TC-S-003, TC-S-004, TC-S-004B, TC-S-004E, TC-S-020
```

**Stream collection**: Uses SSE reader (`connectStream`) with timeout and terminal-state detection (`COMPLETED`, `FAILED`, `CANCELLED`).

### 3.4 Sandbox Boundary Pattern

```
┌─────────────────────────────────┐
│ In-bounds operation             │──▶ Normal execution (read file)
│ Boundary violation:             │
│   - Network access              │──▶ "not allowed" / "拒绝" / "denied"
│   - Prohibited path read        │──▶ No root: content
│   - Prohibited path write       │──▶ "not allowed" / "拒绝" / "denied"
│ White-box bypass:               │
│   - Direct agent bash call      │──▶ Same rejection
│   - Skill internal bash call    │──▶ Same rejection
└─────────────────────────────────┘

Applied to: TC-S-005, TC-S-005B, TC-S-005E
```

### 3.5 Secret Configuration Boundary Pattern

```
┌──────────────────────────────────────────────┐
│ TC-S-016: Write raw credential to config     │
│   → exec nextagent-self-check                │
│   → Assert: BLOCKED + no raw echo in output  │
│   → Assert: 0 raw matches in logs            │
│                                              │
│ TC-S-017: Inactive branch file: ref          │
│   → exec nextagent-self-check                │
│   → Assert: READY/DEGRADED_READY             │
│   → Assert: no I/O for inactive ref in logs  │
│                                              │
│ TC-S-018: Active env: empty value            │
│   → exec with env var = ""                   │
│   → Assert: BLOCKED + SECRET_EMPTY           │
│   → Assert: env name only in ref form        │
│                                              │
│ TC-S-019: Active file: unreadable            │
│   → exec nextagent-self-check                │
│   → Assert: BLOCKED + SECRET_FILE_MISSING    │
│   → Assert: path only as safe ref            │
│                                              │
│ TC-S-020: Resolved secret zero-leakage       │
│   → SSE stream: 0 matches                   │
│   → Conversation: 0 matches                  │
│   → Logs: 0 matches                          │
│   → SQLite: 0 matches                        │
│   → Metrics: 0 matches                       │
│   → Frozen config: 0 matches                 │
└──────────────────────────────────────────────┘

Applied to: TC-S-016, TC-S-017, TC-S-018, TC-S-019, TC-S-020
```

**Skip mechanism**: All Part 3 tests check `REPO_ROOT_AVAILABLE` and skip if the source repo is not present.

## 4. Shared State Management

### 4.1 Part 1 & 2 (Runtime Tests)

```
beforeAll:
  1. healthCheck() → confirm backend available
  2. trustedLogin() → acquire cookies (cookieA)
  3. createSession('zh-CN') → sessionIdA
  4. submitRequest + waitForTerminal → baseline conversation state

afterAll:
  resetCookies()
```

### 4.2 Part 3 (Repo Tests)

```
beforeAll:
  1. Read original application.yaml → originalConfig (for restore)
  2. healthCheck()
  3. trustedLogin()
  4. createSession() → sessionId

afterAll:
  Restore originalConfig to application.yaml
  resetCookies()
```

## 5. Key Helper Functions

| Helper | Purpose | Used By |
|--------|---------|---------|
| `requestRaw(method, path)` | Raw HTTP requests bypassing api-client path conventions | TC-S-001B |
| `collectStreamText(sessionId, requestId)` | SSE stream reader → full text with terminal-state detection | TC-S-003, TC-S-004, TC-S-004E |
| `getLastAssistantMessage(body)` | Extract last assistant message text from conversation | TC-S-005B, TC-S-005E |
| `execCommand(cmd, opts)` | Shell execution with timeout and env vars | TC-S-016–TC-S-019 |
| `readFileContent / writeFileContent` | Config file manipulation | TC-S-016–TC-S-019 |
| `fileExists` | Check file presence (e.g., FILE_REF_PATH) | TC-S-019 |
| `findstr` (Windows) | Log/database content search for secret leakage | TC-S-016–TC-S-020 |

## 6. API Reality Mapping

### 6.1 `/capabilities` Does Not Exist

**Impact**: TC-S-002 cannot call `GET /capabilities`. Instead:
- Verify valid session → `getConversation` → 200
- Verify invalid session → `getConversation` → 404
- TC-S-002E: Agent attempts out-of-scope capability → receives safe response (no existence disclosure)

### 6.2 Error Code: `CONFLICT` not `REQUEST_CANCEL_ALREADY_TERMINAL`

**Reality**: When a scope-violating request is attempted, the backend returns HTTP 409 with error code `CONFLICT`.

**Original design** expected `REQUEST_CANCEL_ALREADY_TERMINAL` for already-terminal cancel attempts. The actual behavior is:
- Cancel on nonexistent session → 404 `SESSION_NOT_FOUND`
- Cancel on own session executing request → 200 (success) or 409 `CONFLICT` (if already terminal)
- Scope violation on request → handled safely via agent behavior (no explicit 409 from the submit endpoint itself)

**TC-S-002E assertion**: The test submits a request asking the agent to use an out-of-scope capability, then checks that the terminal response does not leak capability existence. The `CONFLICT` code reality applies to cancel/retry operations on already-terminal requests.

### 6.3 SSE Only

All stream tests use `connectStream(sessionId)` → SSE reader. No WebSocket path exists.

## 7. Security Considerations for Test Execution

- **Config modification**: TC-S-016–TC-S-019 modify `application.yaml` and run `nextagent-self-check`. Original config is restored in `afterAll`.
- **Environment variable manipulation**: TC-S-018 sets `NEXTAGENT_MODEL_API_KEY=""`. Must not persist beyond test scope.
- **Log scanning**: `findstr` commands search `CONFIG_DIR/logs/` and `CONFIG_DIR/data/*.db`. These operations are read-only.
- **Auto-skip**: All Part 3 tests skip when `REPO_ROOT_AVAILABLE = false`, preventing false failures in environments without source repo access.
