# Proposal: ts-security-test-gate

## Overview

End-to-end security test gate for the NextAgent TS backend, covering trusted-identity access isolation, scope/capability boundary enforcement, secret desensitization (redaction), log/stream sanitization, sandbox confinement, cancel/retry cross-scope safety, internal-record leakage prevention, and secret-configuration-boundary validation.

## Motivation

The NextAgent TS backend operates in a trusted-identity mode (no cross-tenant isolation), serves SSE-only streams, and lacks several originally-planned endpoints (`/capabilities`, `getRunStatus`, `getAuditEvents`). The existing security posture must be validated through **indirect** and **safe-not-found** patterns rather than traditional tenant-boundary checks. Additionally, secret lifecycle management (raw-credential rejection, empty/unresolvable secret reference blocking, resolved-value zero-leakage across all output channels) is a P0 concern that requires source-repo access for white-box validation.

## Scope

| Area | Coverage | Priority |
|------|----------|----------|
| Trusted-identity nonexistent-session safe-not-found | TC-S-001, TC-S-001B, TC-S-001E | P0 |
| Scope/capability indirect verification & safe-not-found | TC-S-002, TC-S-002E | P1 |
| Secret redaction (stream + conversation) | TC-S-003, TC-S-004, TC-S-004B, TC-S-004E | P0 |
| Sandbox confinement (in-bounds, boundary, white-box bypass) | TC-S-005, TC-S-005B, TC-S-005E | P0 |
| Cancel/Retry nonexistent-session safety | TC-S-006, TC-S-006E | P1 |
| *Record internal-type leakage prevention | TC-S-007 | P2 |
| Secret-configuration-boundary (raw, inactive, empty, unresolvable, zero-leakage) | TC-S-016–TC-S-020 | P0 |

## Key Design Decisions

1. **Trusted-identity model**: No cross-tenant isolation exists. Tests verify `safe-not-found` for nonexistent resources instead of cross-tenant 403/404 differentiation.
2. **No `/capabilities` endpoint**: Scope enforcement is verified indirectly via conversation access and capability invocation outcomes (TC-S-002 / TC-S-002E). The error code for out-of-scope invocation is `CONFLICT` (not `REQUEST_CANCEL_ALREADY_TERMINAL`).
3. **SSE-only streaming**: No WebSocket; all stream collection uses SSE readers.
4. **Secret boundary tests require source repo**: TC-S-016–TC-S-020 need `NEXTAGENT_REPO_ROOT` with `bin/nextagent-self-check` to perform white-box startup validation, log auditing, and database scanning. These tests auto-skip when the repo is unavailable.
5. **Safe-not-found pattern**: Any nonexistent resource returns 404 with no property leakage (no `sessionId`, `requestId`, `agentId`, `title` in response body).

## Test Traceability Matrix

| Test Case | Source TP | Factor | Experience TE | Priority | Type |
|-----------|----------|--------|---------------|----------|------|
| TC-S-001 | TP-006 | 安全隔离 | TE-02, TE-05 | P0 | 正路径 |
| TC-S-001B | TP-006 | 安全隔离 | TE-02 | P0 | 边界 |
| TC-S-001E | TP-006 | 安全隔离 | TE-05 | P0 | 异常 |
| TC-S-002 | TP-S01 | 安全隔离 | TE-06 | P1 | 正路径 |
| TC-S-002E | TP-S01 | 安全隔离 | TE-06 | P1 | 异常 |
| TC-S-003 | TP-S02 | 脱敏性 | TE-02 | P2 | 正路径 |
| TC-S-004 | TP-S03 | 脱敏性 | TE-02 | P0 | 正路径 |
| TC-S-004B | TP-S03 | 脱敏性 | — | P0 | 边界 |
| TC-S-004E | TP-S03 | 脱敏性 | TE-06 | P0 | 异常 |
| TC-S-005 | TP-S04 | Sandbox隔离 | TE-10 | P0 | 正路径 |
| TC-S-005B | TP-S04 | Sandbox隔离 | TE-10 | P0 | 边界 |
| TC-S-005E | TP-S04 | Sandbox隔离 | — | P0 | 异常 |
| TC-S-006 | TP-S05 | 安全隔离 | TE-02, TE-06 | P1 | 正路径 |
| TC-S-006E | TP-S05 | 安全隔离 | TE-02, TE-06 | P1 | 异常 |
| TC-S-007 | TP-S06 | 安全隔离 | TE-02 | P2 | 正路径 |
| TC-S-016 | SEC-B-R02 | 安全隔离/脱敏 | — | P0 | 正路径 |
| TC-S-017 | SEC-B-R04 | 正确性 | — | P0 | 正路径 |
| TC-S-018 | SEC-B-R06 | 安全隔离 | — | P0 | 正路径 |
| TC-S-019 | SEC-B-R06 | 安全隔离 | — | P0 | 正路径 |
| TC-S-020 | SEC-B-R09 | 脱敏性 | — | P0 | 正路径 |

## API Reality Notes

| Original Design | Actual Reality | Impact |
|-----------------|---------------|--------|
| Cross-tenant 403/404 | Trusted identity — no tenant boundary | TC-S-001 uses nonexistent-session safe-not-found |
| `/capabilities` endpoint | Does not exist | TC-S-002 uses conversation indirect verification |
| `REQUEST_CANCEL_ALREADY_TERMINAL` error code | `CONFLICT` error code | TC-S-002E expects `CONFLICT` for scope violations |
| WebSocket streams | SSE only | All stream helpers use SSE reader |
| `getRunStatus` | Use conversation API | `waitForTerminal` polls conversation |
| `getAuditEvents` | No dedicated endpoint | TC-S-020 audit check via conversation |

## Risk Assessment

- **TC-S-016–TC-S-020**: Require source repo + config file manipulation. These are white-box tests that modify `application.yaml` and restart the service. Must run in isolated environments; auto-skip if repo unavailable.
- **TC-S-005B/005E**: Sandbox boundary tests depend on backend enforcing network/path restrictions. If sandbox is misconfigured, these tests expose real security holes.
- **TC-S-004B**: Desensitization cannot be disabled — if the backend allows disabling redaction, this is a P0 security violation.

## Out of Scope

- Rate limiting / DDoS protection
- Authentication brute-force resistance
- TLS/certificate validation
- Cross-tenant isolation (not applicable in trusted-identity mode)
