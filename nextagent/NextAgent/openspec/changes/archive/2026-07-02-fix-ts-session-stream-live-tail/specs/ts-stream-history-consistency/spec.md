## MODIFIED Requirements

### Requirement: History Uses Visible Messages
TS 后端 SHALL use visible `SessionMessage` records as the final conversation history source. Stream replay SHALL NOT reconstruct final conversation history. TS frontend SHALL use conversation history for committed history and live stream state for runtime/process details that have not been safely replaced by visible history.

#### Scenario: History read returns visible committed messages
- **WHEN** a client opens or refreshes a session conversation
- **THEN** history MUST be read from visible session messages
- **AND** final history content MUST NOT be reconstructed from stream envelopes, timeline replay, projection cache, or frontend cache

#### Scenario: Active run content is recovered by stream replay
- **WHEN** a session has visible history and a non-terminal `activeRun`
- **THEN** visible history MUST be loaded from conversation history
- **AND** uncommitted active run stream content MUST be recovered through activeRun-scoped stream replay
- **AND** history MUST NOT synthesize the active run partial content as final history

#### Scenario: Ordinary terminal does not replace live process details with conversation snapshot
- **WHEN** a frontend session view receives a terminal stream envelope for the active request
- **THEN** the frontend MUST settle the local request state from the terminal envelope
- **AND** the frontend MUST preserve already accepted live stream process details for the request
- **AND** the frontend MUST NOT use an ordinary terminal-triggered conversation refresh to overwrite the current live/process detail presentation
- **AND** conversation refresh MAY still be used for gap recovery, stream timeout recovery, manual refresh, or opening and switching sessions

#### Scenario: No-cursor live-tail does not reconstruct history
- **WHEN** a frontend opens a session stream without `lastSeenSequence`
- **THEN** any already committed history MUST still be displayed from conversation history
- **AND** the no-cursor stream MUST NOT be treated as a source for reconstructing previously committed conversation messages

#### Scenario: Opening reconcile closes the conversation-to-live-tail window
- **WHEN** a frontend cold-starts an existing session by loading conversation and then opening no-cursor live-tail
- **AND** committed messages or activeRun state appear between the initial conversation snapshot and the live-tail boundary
- **THEN** the frontend MUST perform one opening conversation reconcile after live-tail is established
- **AND** the reconciled conversation state MUST merge with already accepted live envelopes without duplicating visible turns or removing live process details
- **AND** this opening reconcile MUST NOT make ordinary terminal delivery use conversation refresh to overwrite live/process detail presentation
