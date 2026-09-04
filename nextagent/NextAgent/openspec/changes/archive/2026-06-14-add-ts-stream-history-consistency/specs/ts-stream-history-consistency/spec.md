## ADDED Requirements

### Requirement: History Uses Visible Messages
TS 后端 SHALL use visible `SessionMessage` records as the final conversation history source. Stream replay SHALL NOT reconstruct final conversation history.

#### Scenario: History read returns visible committed messages
- **WHEN** a client opens or refreshes a session conversation
- **THEN** history MUST be read from visible session messages
- **AND** final history content MUST NOT be reconstructed from stream envelopes, timeline replay, projection cache, or frontend cache

#### Scenario: Active run content is recovered by stream replay
- **WHEN** a session has visible history and a non-terminal `activeRun`
- **THEN** visible history MUST be loaded from conversation history
- **AND** uncommitted active run stream content MUST be recovered through activeRun-scoped stream replay
- **AND** history MUST NOT synthesize the active run partial content as final history

### Requirement: Gap Refresh Gates Resume Anchor
TS frontend SHALL use `resumeAfterSequence` only after same-session visible conversation refresh succeeds.

#### Scenario: Successful refresh enables resumeAfterSequence
- **WHEN** stream resume returns a gap notice with `resumeAfterSequence`
- **AND** the frontend refreshes the same session visible conversation successfully
- **THEN** the next resume request MAY use `lastSeenSequence=resumeAfterSequence`

#### Scenario: Failed refresh keeps previous cursor
- **WHEN** stream resume returns a gap notice with `resumeAfterSequence`
- **AND** the same session visible conversation refresh fails or returns an unusable result
- **THEN** the frontend MUST NOT use `resumeAfterSequence`
- **AND** the frontend MUST keep the last timeline-backed sequence accepted by the current page lifecycle
- **AND** the UI MUST remain in a degraded or disconnected state

### Requirement: History Recovery Failure Is Explicit
TS frontend and backend SHALL NOT present incomplete history refresh as complete recovery.

#### Scenario: Refresh failure is visible
- **WHEN** visible conversation refresh fails after a stream gap
- **THEN** the user MUST see a recovery failure, degraded, or disconnected state
- **AND** the system MUST NOT mark the stream recovery as successful
- **AND** the system MUST NOT advance the stream cursor because of the failed refresh
