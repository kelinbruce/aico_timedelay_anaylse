## ADDED Requirements

### Requirement: Automatic Title Generation Triggered By First Request Terminal Event

The session domain SHALL automatically generate a readable session title
when the first user request in a session reaches terminal commit. Title
generation MUST NOT block request terminal commit, MUST NOT invoke any
model provider, and MUST NOT overwrite a title that has been manually
set by the session owner.

The system SHALL use the `tenantId + subjectId + sessionId` tuple to
locate the session and SHALL apply owner-scoped queries on all gateway
operations.

#### Scenario: Request terminal commit triggers title generation

- **WHEN** the Runtime publishes a canonical `REQUEST_COMPLETED`、
  `REQUEST_FAILED`、`REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED` timeline
  event for a session that has no prior terminal event
- **AND** the `SessionRecord.title` for that session is `undefined`、
  `null` 或 empty
- **THEN** the session domain SHALL extract a title from the first
  user-authored `SessionMessage` in that session
- **AND** the extraction SHALL use a deterministic rule pipeline without
  invoking any model provider or external service
- **AND** the generated title SHALL be persisted into `SessionRecord.title`
  with `SessionRecord.titleSource` set to `"automatic"`
- **AND** the generation SHALL NOT delay, block 或 modify the terminal
  commit of the triggering request

#### Scenario: Session with existing title is skipped

- **WHEN** a request reaches a terminal state in a session whose
  `SessionRecord.title` is already non-empty
- **AND** the session's `SessionRecord.titleSource` is `undefined`、
  `"automatic"` 或 `"manual"`
- **THEN** the generation SHALL be skipped
- **AND** the existing `title` and `titleSource` SHALL remain unchanged

#### Scenario: Session with manual title is never overwritten

- **WHEN** a request reaches a terminal state in a session whose
  `SessionRecord.titleSource` is `"manual"`
- **THEN** the system SHALL NOT generate or persist a new title
  regardless of the current `title` value

### Requirement: Title Extraction Uses Only The First User Message

The title extraction input SHALL be the content of the earliest
`SessionMessage` in the session whose `role` is `USER`. Messages of
other roles, hidden messages, and slash-command messages SHALL be
excluded.

#### Scenario: First user message is the extraction input

- **WHEN** the session domain loads messages for title extraction
- **THEN** the system SHALL query `SessionMessageStoreGateway` for the
  visible conversation messages in the session, ordered by `sequence`
  ascending
- **AND** the system SHALL select the first message whose `role` is `USER`
  and whose `visible` is `true`
- **AND** messages with `role` `ASSISTANT`、`CAPABILITY_RESULT` 或
  `SUMMARY` SHALL be ignored
- **AND** the selected message's `content` SHALL be the sole input to
  the extraction pipeline

#### Scenario: Slash-command messages are skipped

- **WHEN** the first qualifying `USER` message content starts with `/`
  after trimming whitespace
- **THEN** the system SHALL skip that message
- **AND** the system SHALL select the next qualifying `USER` message in
  sequence order
- **AND** if no qualifying message remains, the session SHALL retain its
  empty title without further processing

### Requirement: Deterministic Title Extraction Pipeline

Title extraction SHALL operate through a fixed, deterministic rule
pipeline with three branches selected by input length. The pipeline
MUST NOT invoke any model provider, external service, or asynchronous
computation.

#### Scenario: Short input used directly

- **WHEN** the first user message content, after trimming leading and
  trailing whitespace, is strictly fewer than 30 characters
- **THEN** the trimmed content SHALL become the title candidate

#### Scenario: Medium-length input heuristically extracted

- **WHEN** the trimmed content length is between 30 and 100 characters
  inclusive
- **THEN** the system SHALL apply the heuristic extraction sub-pipeline:
  1. Detect the language of the content
  2. Remove polite prefixes and suffixes matched against the
     language-appropriate prefix/suffix list
  3. Take the text from the beginning of the remaining content up to
     the end of the first sentence, as determined by the earliest
     occurrence of a sentence terminator character
  4. If no sentence terminator is found, take the full prefix-stripped
     content
  5. If the result after these steps is blank, fall back to the first
     40 characters of the original trimmed content
- **AND** the result SHALL become the title candidate

#### Scenario: Long input truncated to first sentence

- **WHEN** the trimmed content length strictly exceeds 100 characters
- **THEN** the system SHALL locate the earliest sentence terminator
  within the content
- **AND** if a sentence terminator is found, the text up to and
  including that terminator SHALL become the title candidate
- **AND** if no sentence terminator is found within the full content,
  the first 100 characters of the trimmed content SHALL become the
  title candidate

### Requirement: Title Candidate Normalization To 4-40 Characters

Every title candidate produced by the extraction pipeline SHALL be
normalized before persistence. Candidates that fall below the minimum
length after normalization SHALL be discarded silently — the session
retains its empty title state.

#### Scenario: Whitespace and control characters are cleaned

- **WHEN** a title candidate is being normalized
- **THEN** the system SHALL replace consecutive whitespace characters
  with a single space
- **AND** the system SHALL strip leading and trailing whitespace
- **AND** the system SHALL remove all control characters in the ranges
  U+0000-U+001F 和 U+007F-U+009F

#### Scenario: Leading and trailing punctuation is removed

- **WHEN** the normalized candidate has leading or trailing characters
  that are punctuation marks not contributing to semantic meaning
  （顿号、逗号、句号、问号、感叹号、分号、冒号、省略号、破折号、
  括号、引号、中英文等对标题无信息增益的标点）
- **THEN** the system SHALL strip those leading and trailing
  punctuation characters

#### Scenario: Candidate below minimum length is discarded

- **WHEN** the normalized title candidate, after all cleaning steps,
  is strictly fewer than 4 characters
- **THEN** the system SHALL discard the candidate
- **AND** the session SHALL retain its empty title state
- **AND** no audit event SHALL be written for this outcome

#### Scenario: Candidate above maximum length is truncated

- **WHEN** the normalized title candidate strictly exceeds 40 characters
- **THEN** the system SHALL truncate to 40 characters
- **AND** truncation SHALL occur at the last word boundary (space or
  CJK character boundary) before position 40
- **AND** if no word boundary exists within the first 40 characters,
  truncation SHALL occur at position 40

### Requirement: Title Content Safety Via Redaction Policy

Title content SHALL be checked against the configured redaction policy
before persistence. Titles that match unsafe content patterns SHALL be
discarded silently.

#### Scenario: Redaction policy is applied before persistence

- **WHEN** the final normalized title is ready for persistence
- **THEN** the system SHALL submit the title to the configured
  redaction policy
- **AND** if the redaction policy rejects the title content （detected
  secret、credential、token、path 或 other prohibited pattern），the
  title SHALL NOT be persisted
- **AND** the session SHALL retain its empty title state
- **AND** the rejection SHALL be recorded as a structured log entry
  at `warn` level containing the session identity and rejection reason
  code，but MUST NOT include the rejected title content or the raw
  first user message content

### Requirement: Language Detection For Polite Prefix Removal

The system SHALL detect the language of the first user message to
select the appropriate set of polite-prefix removal rules for
heuristic extraction.

#### Scenario: Chinese content triggers Chinese prefix rules

- **WHEN** the first user message content contains any character in the
  CJK Unified Ideographs range （U+4E00-U+9FFF）or CJK Extension A
  （U+3400-U+4DBF）
- **THEN** the system SHALL apply Chinese polite-prefix and
  polite-suffix removal rules
- **AND** if the content also contains Latin alphabet characters
  exceeding a threshold of 20% of the total character count，English
  polite-prefix rules SHALL also be applied

#### Scenario: Non-Chinese content triggers English prefix rules

- **WHEN** the first user message content contains no CJK characters
- **THEN** the system SHALL apply English polite-prefix removal rules
  only

### Requirement: Idempotent Title Write

The title write operation SHALL be idempotent such that concurrent or
duplicate title generation attempts for the same session do not produce
duplicate audit events or conflicting writes.

#### Scenario: Concurrent generation attempts are safe

- **WHEN** two title generation attempts race for the same session
  that has an empty title
- **THEN** the first attempt that successfully calls
  `SessionStoreGateway.saveSession` SHALL persist the title and write
  the `session.title.generated` audit event
- **AND** the second attempt SHALL load the session, detect that
  `SessionRecord.title` is already non-empty 或 `titleSource` is
  already set，skip further processing，and NOT write a duplicate
  audit event

### Requirement: Audit Event For Successful Title Generation

Every successful automatic title generation SHALL produce a single
audit event. Failed generation attempts SHALL NOT produce audit events.

#### Scenario: Audit event written on successful generation

- **WHEN** a title is successfully generated and persisted into
  `SessionRecord`
- **THEN** the system SHALL write an audit event via
  `AuditEventWriter` with `eventName` set to
  `session.title.generated`
- **AND** the audit event SHALL include `sessionId`、`tenantId`、
  `subjectId`、the `requestRunId` of the triggering request、a
  `safeSummary` indicating the outcome, and `occurredAt`
- **AND** the audit event SHALL NOT include the raw first user message
  content、raw model input 或 output、secret material、or the full
  title content if the title itself contains redacted information

### Requirement: SessionRecord Extension With titleSource Field

The `SessionRecord` type SHALL be extended with an optional
`titleSource` field to distinguish automatically generated titles from
user-modified titles.

#### Scenario: titleSource persists alongside title

- **WHEN** `SessionRecord` is defined in `agent-contracts/gateway`
- **THEN** it SHALL include `titleSource?: "automatic" | "manual"`
- **AND** `undefined` 或 absent SHALL be semantically equivalent to
  "the title has neither been auto-generated nor manually set"
- **AND** `"automatic"` SHALL indicate the title was produced by the
  automatic generation system
- **AND** `"manual"` SHALL indicate the title was produced by user-
  initiated modification

### Requirement: Failure And Degradation Do Not Block Terminal Commit

All failures in the title generation path SHALL be handled with
explicit outcomes. Silent truncation、silent discard of error
information、and raw exception propagation across module boundaries
SHALL NOT occur. No title generation failure SHALL delay、block、or
modify the request terminal commit that triggered generation.

#### Scenario: First user message unavailable

- **WHEN** the first `USER`-role message cannot be loaded because
  `SessionMessageStoreGateway` returns an error、unavailable status、
  或 the gateway port is unreachable
- **THEN** the system SHALL log a structured diagnostic entry at
  `warn` level containing `sessionId` and the failure reason code
- **AND** the session SHALL retain its empty title
- **AND** the terminal commit of the triggering request SHALL NOT be
  affected

#### Scenario: Session record cannot be loaded

- **WHEN** `SessionStoreGateway.loadSession` returns an error、
  unavailable status、或 the session is not found
- **THEN** the system SHALL log a structured diagnostic entry at
  `warn` level containing the lookup parameters and failure reason
  code
- **AND** the session SHALL retain its empty title

#### Scenario: Session store write fails

- **WHEN** the generated title cannot be persisted because
  `SessionStoreGateway.saveSession` returns a version conflict、
  gateway error、或 `UNAVAILABLE` SafeError
- **THEN** the system SHALL log a structured diagnostic entry at
  `warn` level containing `sessionId` and the specific failure reason
  code
- **AND** the session SHALL retain its prior title state
- **AND** no audit event SHALL be written

#### Scenario: Empty or blank first user message

- **WHEN** the first qualifying `USER`-role message exists but its
  content is empty or consists only of whitespace after trimming
- **THEN** the system SHALL skip title generation for this session
- **AND** the session SHALL retain its empty title
- **AND** no audit event SHALL be written

#### Scenario: Title candidate below minimum results in no-op

- **WHEN** the normalized title candidate is strictly fewer than 4
  characters after all cleaning steps
- **THEN** the system SHALL discard the candidate without persisting
- **AND** the session SHALL retain its empty title
- **AND** a structured log entry at `info` level SHALL record that
  the candidate was discarded （containing `sessionId` and the discard
  reason，but NOT the discarded title content）
- **AND** no audit event SHALL be written
