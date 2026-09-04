## ADDED Requirements

### Requirement: Session Title Update By Session Owner

The session domain SHALL allow the session owner to manually modify
the session title through a Web Channel command. The operation is
synchronous — the caller receives the updated title or a SafeError
before the request completes.

Only the session owner (`tenantId + subjectId` matching the session's
owner scope) SHALL be authorized to modify the title. The updated
`SessionRecord.titleSource` SHALL be set to `"manual"`, which SHALL
permanently prevent automatic title generation from overwriting the
title for that session (as defined in `session-title-generation`).

#### Scenario: Session owner updates title successfully

- **WHEN** the session owner submits a title update command containing
  a valid title string via the Channel entry point
- **AND** the `tenantId` and `subjectId` from the trusted
  `IdentityContext` match those of the target session
- **AND** the submitted title passes all content validation rules
- **THEN** the system SHALL persist the new title into
  `SessionRecord.title`
- **AND** the system SHALL set `SessionRecord.titleSource` to
  `"manual"`
- **AND** the system SHALL write a `session.title.updated` audit event
- **AND** the caller SHALL receive a response containing the updated
  `sessionId` and the new title

#### Scenario: Non-owner is rejected

- **WHEN** a user whose `tenantId` or `subjectId` does not match the
  target session's owner scope submits a title update command
- **THEN** the system SHALL reject the request with a SafeError
- **AND** the SafeError SHALL NOT reveal whether the target session
  exists for another owner scope
- **AND** no audit event SHALL be written

#### Scenario: Session does not exist

- **WHEN** a title update command targets a session that does not
  exist or is not visible to the current owner scope
- **THEN** the system SHALL return a safe "not found" error
- **AND** the error SHALL NOT distinguish between "session does not
  exist" and "session belongs to another owner"

### Requirement: Title Content Validation

The submitted title SHALL pass mandatory content validation before
persistence. Validation failures SHALL produce explicit SafeError
responses to the caller.

#### Scenario: Title length within 4-40 characters

- **WHEN** the submitted title, after trimming leading and trailing
  whitespace, is between 4 and 40 characters inclusive
- **THEN** the title SHALL pass the length check

#### Scenario: Title below minimum length is rejected

- **WHEN** the submitted title, after trimming whitespace, is strictly
  fewer than 4 characters
- **THEN** the system SHALL reject the request with a SafeError
  indicating the title is too short

#### Scenario: Title above maximum length is rejected

- **WHEN** the submitted title, after trimming whitespace, strictly
  exceeds 40 characters
- **THEN** the system SHALL reject the request with a SafeError
  indicating the title exceeds the maximum length

#### Scenario: Title is empty or all-whitespace

- **WHEN** the submitted title is `null`、`undefined`、empty string、
  或 consists only of whitespace characters after trimming
- **THEN** the system SHALL reject the request with a SafeError
  indicating a non-empty title is required

#### Scenario: Title contains control characters

- **WHEN** the submitted title contains any character in the ranges
  U+0000-U+001F or U+007F-U+009F
- **THEN** the system SHALL reject the request with a SafeError
  indicating the title contains invalid characters
- **AND** the error SHALL NOT include the rejected title content

#### Scenario: Title contains prohibited content patterns

- **WHEN** the submitted title passes length and character validation
  but the redaction policy detects prohibited content patterns
  （secret、credential、token、file path、environment variable
   reference）
- **THEN** the system SHALL reject the request with a SafeError
  indicating the title contains unsafe content
- **AND** the error SHALL NOT include the unsafe title content

### Requirement: Audit Event For Title Update

Every successful title update SHALL produce an audit event. Rejected
update attempts SHALL NOT produce audit events for the title mutation
（failures may still produce diagnostic events through structured
logging or the observability layer）.

#### Scenario: Audit event written on successful update

- **WHEN** a title update is successfully persisted
- **THEN** the system SHALL write an audit event via
  `AuditEventWriter` with `eventName` set to `session.title.updated`
- **AND** the audit event SHALL include `sessionId`、`tenantId`、
  `subjectId`、`requestRunId`（if triggered within a request context）、
  `oldTitle` reference or safe summary、`newTitle` reference or safe
  summary、and `occurredAt`
- **AND** the audit event SHALL include the `operator` identity
  （derived from the trusted `IdentityContext`）
- **AND** the audit event SHALL NOT include raw secret、credential、
   or redacted content

#### Scenario: Rejected update produces no title audit event

- **WHEN** a title update is rejected for any reason（owner
  mismatch、validation failure、redaction rejection）
- **THEN** the system SHALL NOT write a `session.title.updated`
  audit event
- **AND** the rejection SHALL be traceable through the SafeError
  response and structured error logs

### Requirement: titleSource Is Set To Manual On Update

The system SHALL set `SessionRecord.titleSource` to `"manual"` on
every successful title update. Once set to `"manual"`, the automatic
title generation system SHALL NOT overwrite the title.

#### Scenario: titleSource is set to manual after user update

- **WHEN** a title update is successfully persisted
- **THEN** `SessionRecord.titleSource` SHALL be `"manual"` in the
  persisted record
- **AND** subsequent automatic title generation attempts for the same
  session SHALL detect `titleSource === "manual"` and skip title
  generation

#### Scenario: Manual title is preserved across multiple terminal events

- **WHEN** a session has `titleSource = "manual"`
- **AND** multiple subsequent requests reach terminal commit in that
  session
- **THEN** the automatic title generation subscriber SHALL skip every
  triggering event
- **AND** the `title` and `titleSource` SHALL remain unchanged

### Requirement: Title Update Is Atomic

The title update operation SHALL be atomic: the `title` and
`titleSource` fields SHALL be written in a single
`SessionStoreGateway.saveSession` call using CAS version semantics.

#### Scenario: Concurrent title updates resolve safely

- **WHEN** two title update commands race for the same session
- **THEN** the first command that successfully calls `saveSession`
  SHALL persist its title and write the audit event
- **AND** the second command SHALL encounter a version conflict on
  `saveSession` and SHALL return a SafeError indicating the session
  was modified by another request
- **AND** the second command SHALL NOT overwrite the first command's
  title

### Requirement: Failure And Safe Error Propagation

All title update validation failures SHALL produce explicit SafeError
responses. Gateway failures SHALL be normalized to SafeError through
the error normalization boundary. Raw exceptions、adapter-private
errors、and internal state SHALL NOT be propagated past the session
domain boundary.

#### Scenario: Session store unavailable

- **WHEN** `SessionStoreGateway.loadSession` or `saveSession` returns
  a gateway error or `UNAVAILABLE` SafeError
- **THEN** the system SHALL return a SafeError with category
  `UNAVAILABLE`
- **AND** the original raw gateway exception SHALL NOT be exposed to
  the caller

#### Scenario: Version conflict on save

- **WHEN** `SessionStoreGateway.saveSession` returns a version
  conflict result
- **THEN** the system SHALL return a SafeError indicating the session
  was modified by another request
- **AND** the caller SHALL be able to retry with a fresh session
  state
