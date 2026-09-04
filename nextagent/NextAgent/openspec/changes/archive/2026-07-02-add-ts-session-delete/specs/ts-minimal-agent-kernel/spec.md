## ADDED Requirements

### Requirement: Runtime session port supports scoped session deletion

Runtime session-facing contract SHALL support deleting an owner-scoped and agent-scoped session without changing request submit、terminal commit、stream replay or history consistency semantics. The delete command MUST carry trusted `IdentityContext` and `sessionId`; runtime MUST resolve trusted Agent Scope internally before delegating to `agent-session`. `UserSessionPort` deletion input MUST carry trusted `IdentityContext`、trusted `agentId` and `sessionId`.

Gateway contract SHALL expose a single owner+agent scoped composite delete for session deletion. The composite delete MUST fail closed when a non terminal request run exists for the session and MUST complete all deletion effects in one local persistence transaction.

#### Scenario: Runtime resolves Agent Scope for deletion
- **WHEN** Web channel calls runtime session delete for session `S1`
- **THEN** Runtime MUST resolve `agentId` through the same trusted internal Agent Scope resolver used by session create/list/history
- **AND** Runtime MUST NOT accept `agentId` from client request body、query string、metadata、model output or Capability arguments

#### Scenario: Session port delete uses domain boundary
- **WHEN** Runtime deletes session `S1`
- **THEN** Runtime MUST call `UserSessionPort` or equivalent session domain boundary with trusted `IdentityContext` and `agentId`
- **AND** Runtime MUST NOT pass gateway `*Record` values to Web channel

#### Scenario: Gateway composite delete is the only persistence write path
- **WHEN** session deletion reaches gateway-local
- **THEN** gateway-local MUST use a single composite delete transaction for session-owned facts
- **AND** runtime、session domain 或 Web channel MUST NOT independently delete messages、runs、timeline、checkpoint、annotation 或 share rows one by one outside that composite boundary

#### Scenario: Minimal question-answer path remains unchanged
- **WHEN** `add-ts-session-delete` is implemented
- **THEN** existing submit、SSE/WS stream、terminal commit and history read behavior for non-deleted sessions MUST remain unchanged
- **AND** deleting one terminal session MUST NOT mutate another session's request run、timeline、history or active context facts
