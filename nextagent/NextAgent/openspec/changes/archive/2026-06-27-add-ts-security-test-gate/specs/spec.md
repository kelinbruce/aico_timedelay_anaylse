# Spec: ts-security-test-gate

## 1. Purpose

Define the behavioral specification for the NextAgent TS backend security test gate — what the system **must** guarantee under trusted-identity mode, SSE-only streaming, and secret-configuration-boundary constraints.

## 2. System Context

```
┌─────────────┐     ┌──────────────────────┐     ┌─────────────┐
│  Test Client │────▶│  NextAgent TS Backend │────▶│   Sandbox   │
│  (vitest)    │     │  (trusted identity)   │     │  (isolated) │
└─────────────┘     └──────────────────────┘     └─────────────┘
       │                    │                            │
       │                    ▼                            │
       │            ┌──────────────┐                     │
       │            │  Config Store │                     │
       │            │ (application │                     │
       │            │   .yaml)     │                     │
       │            └──────────────┘                     │
       │                    │                            │
       ▼                    ▼                            ▼
  SSE Stream          Secret Manager               OS Boundary
  (no WebSocket)      (env: / file: refs)          (network/paths)
```

### 2.1 API Reality

| Endpoint | Reality | Test Adaptation |
|----------|---------|-----------------|
| `POST /api/v1/sessions` | Creates session; backend generates `sessionId` | `createSession(locale?)` |
| `POST /api/v1/sessions/:id/requests` | Submits request; returns `requestId` | `submitRequest(sessionId, msg, idempotencyKey)` |
| `GET /api/v1/sessions/:id/conversation` | Returns conversation items; no `getRunStatus` | `getConversation(sessionId)` + `waitForTerminal` |
| `DELETE /api/v1/sessions/:id/requests/:rid` | Cancel a request | `cancelRun(sessionId, requestId, idempotencyKey?)` |
| `POST /api/v1/sessions/:id/requests/:rid/retry` | Retry a completed request | `retryRun(sessionId, requestId, idempotencyKey?)` |
| `GET /api/v1/sessions/:id/stream` | SSE stream | `connectStream(sessionId)` |
| `/capabilities` | **Does not exist** | Indirect verification via conversation (TC-S-002) |
| `/metrics` | May not exist | Conditional check; skip if 404 (TC-S-020) |

### 2.2 Error Code Reality

| Scenario | Expected Code | Notes |
|----------|--------------|-------|
| Nonexistent session | `SESSION_NOT_FOUND` (HTTP 404) | Safe-not-found; no property leakage |
| Out-of-scope capability invocation | `CONFLICT` (HTTP 409) | **Not** `REQUEST_CANCEL_ALREADY_TERMINAL` |
| Raw credential in config | Startup → `BLOCKED` | Config validation rejects raw values |
| Active empty env: ref | Startup → `BLOCKED` | `SECRET_EMPTY` diagnostic |
| Active unresolvable file: ref | Startup → `BLOCKED` | `SECRET_FILE_MISSING` / `SECRET_FILE_UNREADABLE` |

## 3. Security Guarantees (Spec Requirements)

### 3.1 SG-001: Safe-Not-Found

> Any request targeting a nonexistent resource returns HTTP 404 with a `SafeError` body that does **not** expose any property (`sessionId`, `requestId`, `agentId`, `title`, `items`, etc.). Two different nonexistent resources must produce structurally identical responses.

**Verified by**: TC-S-001, TC-S-001B, TC-S-006

### 3.2 SG-002: No Side Effect on Failed Access

> Accessing a nonexistent session (GET or POST) must not modify any existing session's state. Cancel/retry on a nonexistent session must not alter any real session's conversation.

**Verified by**: TC-S-001E, TC-S-006E

### 3.3 SG-003: Scope Indirect Enforcement

> Since `/capabilities` does not exist, scope enforcement is verified indirectly: a valid session's conversation returns 200; a nonexistent session returns 404. An agent attempting to invoke an out-of-scope capability receives a safe response that does not reveal the capability's existence.

> **Error code reality**: The backend returns `CONFLICT` (not `REQUEST_CANCEL_ALREADY_TERMINAL`) for scope violations on request operations.

**Verified by**: TC-S-002, TC-S-002E

### 3.4 SG-004: Secret Redaction (Zero Raw Leakage)

> Raw credentials (`sk-*` patterns, PII names, PII emails, internal system IDs) must **never** appear in SSE stream payloads, conversation responses, or any web-facing output. Redaction is mandatory and cannot be disabled.

**Verified by**: TC-S-003, TC-S-004, TC-S-004B

### 3.5 SG-005: Redaction Non-Reversible

> Redacted values must use a fixed format (e.g., `***redacted***`). Short and long secrets must produce the same redaction format, preventing length-based or pattern-based inference of the original value.

**Verified by**: TC-S-004E

### 3.6 SG-006: Sandbox Confinement

> Operations within sandbox boundaries execute normally. Operations exceeding boundaries (network access, prohibited path reads, prohibited path writes) are explicitly denied with messages containing "not allowed" / "拒绝" / "denied". Sandbox enforcement applies equally to direct agent calls and skill-internal calls (white-box bypass prevention).

**Verified by**: TC-S-005, TC-S-005B, TC-S-005E

### 3.7 SG-007: Internal Record Isolation

> Internal record types (`RequestRunRecord`, `SessionStateRecord`, `internalStateRecord`) must never appear in SSE stream payloads, conversation responses, or any web-facing output. Messages must not contain `internalStateRecord` or `record` properties.

**Verified by**: TC-S-007

### 3.8 SG-008: Secret Configuration Boundary

> The system enforces strict secret lifecycle rules at startup:

| Rule | ID | Behavior |
|------|----|----------|
| Raw credential rejection | SEC-B-R02 | Config fields expecting `SecretReference` (`env:`/`file:` format) reject raw string values. Startup state = `BLOCKED`. Diagnostic does not echo the raw credential. |
| Inactive secret bypass | SEC-B-R04 | `active: false` deployment branches with unresolvable `file:` references do not trigger resolvability validation. Startup succeeds (READY/DEGRADED_READY). No I/O for inactive refs. |
| Active empty env: blocking | SEC-B-R06 | Active `env:` references resolving to empty values cause startup `BLOCKED` with `SECRET_EMPTY` diagnostic. Env var names appear only in desensitized/reference form. |
| Active unresolvable file: blocking | SEC-B-R06 | Active `file:` references to non-existent/unreadable files cause startup `BLOCKED` with `SECRET_FILE_MISSING`/`SECRET_FILE_UNREADABLE` diagnostic. File paths appear only as safe field references. |
| Zero resolved-value leakage | SEC-B-R09 | After resolution, secret values must not appear in any persistent or output channel: logs, SQLite databases, SSE streams, conversation responses, audit/trace output, metrics, frozen config snapshots. |

**Verified by**: TC-S-016, TC-S-017, TC-S-018, TC-S-019, TC-S-020

## 4. Test Environment Requirements

### 4.1 Standard Environment (TC-S-001–TC-S-007)

- NextAgent TS backend running at `NEXTAGENT_URL` (default `http://localhost:3000`)
- Trusted-identity login capability
- Vitest test framework with `api-client` helpers

### 4.2 Source Repo Environment (TC-S-016–TC-S-020)

- `NEXTAGENT_REPO_ROOT` containing `bin/nextagent-self-check`
- Write access to `NEXTAGENT_APP_CONFIG` (`application.yaml`)
- Access to `NEXTAGENT_CONFIG_DIR/logs/` for log auditing
- Access to `NEXTAGENT_CONFIG_DIR/data/*.db` for SQLite scanning
- Ability to set environment variables for `env:` secret reference tests
- Tests **auto-skip** when `REPO_ROOT_AVAILABLE = false`

## 5. Acceptance Criteria

| ID | Criterion | Threshold |
|----|----------|-----------|
| AC-001 | All P0 tests pass (TC-S-001, TC-S-001B, TC-S-001E, TC-S-004, TC-S-004B, TC-S-004E, TC-S-005, TC-S-005B, TC-S-005E, TC-S-016–TC-S-020) | 100% |
| AC-002 | All P1 tests pass (TC-S-002, TC-S-002E, TC-S-006, TC-S-006E) | 100% |
| AC-003 | All P2 tests pass (TC-S-003, TC-S-007) | 100% |
| AC-004 | No raw credential appears in any output channel | 0 matches |
| AC-005 | No *Record internal type appears in web response | 0 matches |
| AC-006 | Sandbox boundary violations are explicitly denied | "not allowed"/"拒绝"/"denied" |
