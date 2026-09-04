## MODIFIED Requirements

### Requirement: Stream Resume Uses In-Memory Cursor
TS 前端 SHALL treat `lastSeenSequence` as an in-memory, session-scoped cursor for the current page lifecycle. The cursor SHALL exist only after the current page has accepted at least one timeline-backed `StreamEnvelope`. The cursor SHALL advance only after a timeline-backed `StreamEnvelope` is successfully accepted by the frontend stream consumer. The frontend SHALL NOT persist stream resume cursor in sessionStorage for use after page refresh, new tab, or another device.

#### Scenario: Same page reconnect resumes after the last displayed sequence
- **WHEN** the current page has accepted timeline-backed stream envelopes through session timeline sequence `N`
- **AND** the stream disconnects without a page refresh
- **THEN** the next stream connection MUST use `lastSeenSequence=N`
- **AND** the backend MUST replay only events with session timeline `sequence > N`
- **AND** replay completion MUST continue into live stream for the same session

#### Scenario: Same page reconnect without an accepted cursor omits lastSeenSequence
- **WHEN** the current page has not accepted any timeline-backed stream envelope in memory
- **AND** the stream disconnects or reconnects
- **THEN** the frontend MUST NOT send `lastSeenSequence=0` as a substitute cursor
- **AND** the stream connection MUST omit `lastSeenSequence` unless it is performing activeRun or accepted-run bounded replay
- **AND** the frontend MUST use same-session conversation refresh and activeRun bootstrap rules to recover any visible state that cannot be trusted from the no-cursor stream

#### Scenario: Legacy persisted cursor is ignored after page load
- **WHEN** a page is opened or refreshed and sessionStorage contains an old stream cursor
- **THEN** the frontend MUST NOT use that persisted value as the resume anchor
- **AND** if the current page has not accepted timeline-backed envelopes in memory, the frontend MUST omit `lastSeenSequence` for ordinary session-level stream open
- **AND** the frontend MUST use activeRun scoped replay only when conversation bootstrap returns an activeRun that has not already been terminally observed by the current page

#### Scenario: Cold-start session open uses conversation before live-tail
- **WHEN** a page is refreshed, opened in a new tab, opened on another device, or switches to an existing session without an in-memory stream cursor
- **THEN** the frontend MUST load conversation bootstrap as the initial committed history source before opening an ordinary session-level stream
- **AND** if conversation bootstrap does not return a non-terminal `activeRun`, the ordinary session-level stream MUST omit `lastSeenSequence`
- **AND** after that no-cursor live-tail is established, the frontend MUST perform one opening conversation reconcile and merge it with already accepted live envelopes without duplicating visible turns or process details

### Requirement: Active Run Bootstrap Replays Current Run From Zero
TS frontend and backend SHALL support restoring an in-progress current run after page refresh, new tab, or another device opens the same session. When conversation bootstrap returns top-level `activeRun { requestId, runId, status }`, the frontend SHALL open a run-scoped stream with `activeRun.requestId`, `activeRun.runId`, and `lastSeenSequence=0` unless the current page has already accepted a terminal timeline-backed envelope for the same `requestId/runId`. ActiveRun bootstrap identity SHALL be keyed by `requestId + runId`, not by whether a session-level cursor already exists.

#### Scenario: Page refresh restores already generated active run content
- **WHEN** a user refreshes a page while the current run has generated user-visible stream content that has not yet become visible history
- **AND** conversation bootstrap returns `activeRun`
- **THEN** the frontend MUST open stream with `activeRun.requestId`, `activeRun.runId`, and `lastSeenSequence=0`
- **AND** the backend MUST replay recoverable stream content for that active run before continuing live
- **AND** the frontend MUST NOT use a persisted cursor that skips the already generated active run content

#### Scenario: Another device opens an executing session
- **WHEN** a device without local cursor opens a session with a non-terminal `activeRun`
- **THEN** visible history MUST load from conversation history
- **AND** current run stream content MUST recover through `activeRun.requestId`, `activeRun.runId`, and `lastSeenSequence=0`
- **AND** the frontend MUST NOT infer active run identity by scanning visible history messages

#### Scenario: ActiveRun bootstrap is not skipped by an unrelated session cursor
- **WHEN** the current page opens a no-cursor session stream and accepts a timeline-backed envelope
- **AND** conversation bootstrap later returns an `activeRun` whose `requestId/runId` has not been bootstrapped and has not been terminally observed by the current page
- **THEN** the frontend MUST still perform activeRun scoped replay with `lastSeenSequence=0`, `requestId`, and `runId`
- **AND** the existing session cursor MUST NOT be treated as proof that previously generated activeRun content was recovered

### Requirement: SSE And WebSocket Resume Equivalence
TS Web stream transport SHALL use the same resume inputs for SSE and WebSocket: `sessionId`, optional `lastSeenSequence`, optional `requestId`, and optional `runId`. Transport framing MAY differ, but recovery semantics SHALL be equivalent.

#### Scenario: Same resume input produces equivalent transport requests
- **WHEN** the frontend opens SSE and WebSocket streams for the same session, cursor, request filter, and run filter
- **THEN** both transports MUST carry the same `lastSeenSequence`, `requestId`, and `runId`
- **AND** omitting `lastSeenSequence` in one transport MUST omit it in the other transport
- **AND** switching transport MUST NOT create a new `RequestRun`
- **AND** switching transport MUST NOT change session-scoped sequence semantics

## ADDED Requirements

### Requirement: Accepted Request Recovery Uses Run-Scoped Replay When Session Stream Is Unreliable
TS frontend SHALL use accepted request coordinates for bounded recovery when a user action creates a new run but the session-level stream cannot be trusted to already cover the run's early events.

#### Scenario: Submit accepted while session stream is not covering new live events
- **WHEN** submit returns `requestId` and `runId`
- **AND** the current session-level stream is not connected, is disconnected, is reconnecting, is handling timeout/gap recovery, or has not yet established its live-tail boundary
- **THEN** the frontend MUST recover the accepted run through a run-scoped stream with `lastSeenSequence=0`, the accepted `requestId`, and the accepted `runId`
- **AND** the frontend MUST NOT wait for the stream activity timeout before starting this bounded recovery

#### Scenario: Submit accepted while connected no-cursor live-tail has no cursor yet
- **WHEN** submit returns `requestId` and `runId`
- **AND** the current session-level no-cursor live-tail is connected and has established its live boundary
- **AND** the current page has not yet accepted a timeline-backed session stream cursor
- **THEN** the frontend MUST NOT start an additional run-scoped replay only because the cursor is absent
- **AND** the connected session live-tail MUST be treated as covering events emitted after that boundary

#### Scenario: Retry or edit accepted while session stream is disconnected
- **WHEN** retry or edit returns a new accepted `requestId` and `runId`
- **AND** the current session stream is disconnected, reconnecting, or otherwise not usable for session-level resume
- **THEN** the frontend MUST recover the accepted run through a run-scoped stream with `lastSeenSequence=0`, the accepted `requestId`, and the accepted `runId`
- **AND** terminal delivery for that run MUST return the page to session-level stream recovery rules
