<!--
本文件是 active change 的行为规格 delta，路径为 specs/ts-run-status-visibility/spec.md。
归档后，仍然成立的行为契约会同步到 openspec/specs/ts-run-status-visibility/spec.md。

本 change 只新增 4 个 requirement 覆盖现有 gap，不修改已有 requirement。
设计入口：openspec/designs/architecture/conversation-ui-state.md（归档时新增）。
-->

## ADDED Requirements

### Requirement: Attachment Accepted Stream Event Visibility

TS Web channel SHALL project `ATTACHMENT_ACCEPTED` as a stream-visible `StreamEnvelope` when an attachment passes trusted validation and is accepted into the request scope. The envelope payload SHALL expose only safe fields: `attachmentId`, `status`, `mediaType`, and optional `safeSummary`. The envelope MUST NOT expose attachment content, local file path, credential, or raw validation detail. Frontend consuming this event SHALL render an attachment-accepted indication bound to the `attachmentId` that owns the attachment, and MUST NOT render attachment body content from this event.

#### Scenario: Accepted attachment produces stream-visible envelope
- **WHEN** runtime accepts an attachment into the request scope after trusted validation
- **THEN** Web channel MUST project an `ATTACHMENT_ACCEPTED` `StreamEnvelope` with `attachmentId`, `status`, and `mediaType`
- **AND** the envelope MUST NOT contain attachment content, file path, or credential
- **AND** frontend MUST render an accepted-state indication bound to the owning `attachmentId`

#### Scenario: Accepted attachment event does not leak sensitive content
- **WHEN** the accepted attachment carries content bytes or local path metadata
- **THEN** the projected `ATTACHMENT_ACCEPTED` envelope MUST omit content bytes and local path
- **AND** only `attachmentId`, `status`, `mediaType`, and optional `safeSummary` MAY appear in the payload

#### Scenario: Historical conversation does not reconstruct attachment accepted event
- **WHEN** a frontend opens a historical conversation without an active run
- **THEN** the frontend MUST NOT reconstruct `ATTACHMENT_ACCEPTED` from visible `SessionMessage` records
- **AND** historical attachment status SHALL rely only on persisted attachment metadata in the owning USER message, not on stream replay

### Requirement: Attachment Rejected Stream Event Visibility

TS Web channel SHALL project `ATTACHMENT_REJECTED` as a stream-visible `StreamEnvelope` when an attachment fails trusted validation, security policy, or capacity limit. The envelope payload SHALL expose only safe fields: `attachmentId`, `status`, `mediaType`, optional `reasonCode`, and optional `safeSummary`. The envelope MUST NOT expose the rejected content, raw validation error, local path, or policy internals. Frontend consuming this event SHALL render a rejection indication bound to the `attachmentId` with a user-readable reason derived only from `reasonCode` and `safeSummary`.

#### Scenario: Rejected attachment produces stream-visible envelope with safe reason
- **WHEN** runtime rejects an attachment due to validation, security policy, or capacity limit
- **THEN** Web channel MUST project an `ATTACHMENT_REJECTED` `StreamEnvelope` with `attachmentId`, `status`, and `mediaType`
- **AND** the envelope MAY include `reasonCode` and `safeSummary` when a safe reason exists
- **AND** the envelope MUST NOT contain rejected content, raw validation error, local path, or policy internals

#### Scenario: Frontend renders rejection with safe reason only
- **WHEN** frontend receives an `ATTACHMENT_REJECTED` envelope
- **THEN** frontend MUST render a rejection indication bound to the owning `attachmentId`
- **AND** the user-visible reason MUST be derived only from `reasonCode` and `safeSummary`
- **AND** frontend MUST NOT display raw validation error text or policy internals

#### Scenario: Historical conversation does not reconstruct attachment rejected event
- **WHEN** a frontend opens a historical conversation without an active run
- **THEN** the frontend MUST NOT reconstruct `ATTACHMENT_REJECTED` from visible `SessionMessage` records
- **AND** historical rejection status SHALL rely only on persisted attachment metadata, not on stream replay

### Requirement: Context Compacted Stream Event Visibility

TS Web channel SHALL project `CONTEXT_COMPACTED` as a stream-visible `StreamEnvelope` when the context engine completes a compaction (micro-compact or summary compression) that changes the active context version during a run. The envelope payload SHALL expose only safe fields: `contextVersion`, optional `summaryMessageId`, optional `safeSummary`, and optional `tokenEstimate`. The envelope MUST NOT expose compacted prompt content, model output, raw message bodies, or internal context-engine state. Frontend consuming this event SHALL render a compaction notice that communicates context was compacted, and MUST NOT render compacted content.

#### Scenario: Compaction produces stream-visible envelope
- **WHEN** the context engine completes a compaction that changes the active context version during a run
- **THEN** Web channel MUST project a `CONTEXT_COMPACTED` `StreamEnvelope` with `contextVersion`
- **AND** the envelope MAY include `summaryMessageId`, `safeSummary`, or `tokenEstimate`
- **AND** the envelope MUST NOT contain compacted prompt content, model output, raw message bodies, or internal context-engine state

#### Scenario: Frontend renders compaction notice without content
- **WHEN** frontend receives a `CONTEXT_COMPACTED` envelope
- **THEN** frontend MUST render a compaction notice communicating that context was compacted
- **AND** frontend MUST NOT render compacted content or internal context-engine state
- **AND** the notice MAY reference `contextVersion` or `safeSummary` for user orientation

#### Scenario: Historical conversation reconstructs compaction notice from persisted record
- **WHEN** a frontend opens a historical conversation
- **THEN** the frontend SHALL reconstruct `CONTEXT_COMPACTED` from persisted compaction notice records so that the compaction notice is visible in history
- **AND** the `SUMMARY` message produced by compaction SHALL be filtered out of historical conversation envelopes
- **AND** historical browsing SHALL display a compaction notice with the same content as seen in live mode after completion

### Requirement: Capability Path Rejected Failure Visibility

TS Web channel SHALL project a `CAPABILITY_PATH_REJECTED` safe error code in `CAPABILITY_RESULT_DELTA` or `CAPABILITY_COMPLETED` envelopes when a capability invocation is blocked by path access policy. The safe error code SHALL be accompanied by a safe summary communicating that path access was blocked by policy. The envelope MUST NOT expose the rejected path, file system detail, or policy internals. Frontend consuming this code SHALL render a failure indication with a user-readable summary derived only from `safeErrorCode` and `safeSummary`, and MUST NOT display the rejected path or policy internals.

#### Scenario: Path-blocked capability produces safe error code
- **WHEN** a capability invocation is blocked by path access policy
- **THEN** Web channel MUST project the failure with `safeErrorCode` set to `CAPABILITY_PATH_REJECTED`
- **AND** the envelope MUST include a `safeSummary` communicating that path access was blocked by policy
- **AND** the envelope MUST NOT expose the rejected path, file system detail, or policy internals

#### Scenario: Frontend renders path-rejected failure with safe summary only
- **WHEN** frontend receives a `CAPABILITY_RESULT_DELTA` or `CAPABILITY_COMPLETED` envelope with `safeErrorCode` set to `CAPABILITY_PATH_REJECTED`
- **THEN** frontend MUST render a failure indication with a user-readable summary derived from `safeErrorCode` and `safeSummary`
- **AND** frontend MUST NOT display the rejected path or policy internals
- **AND** frontend MUST NOT imply the capability executed successfully

#### Scenario: Path-rejected failure is not elevated to run failure
- **WHEN** a capability is blocked by path policy but the run can continue
- **THEN** `RunStatus` MUST NOT transition to `FAILED` solely due to `CAPABILITY_PATH_REJECTED`
- **AND** the failure MUST be visible through the capability failure projection and `DEGRADATION_NOTICE` per existing `ts-run-status-visibility` rules
- **AND** the run MAY continue to the next capability or model round per routing policy
