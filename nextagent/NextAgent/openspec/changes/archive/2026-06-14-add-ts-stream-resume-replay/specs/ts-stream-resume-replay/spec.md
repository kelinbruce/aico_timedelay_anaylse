## ADDED Requirements

### Requirement: Stream Resume Uses In-Memory Cursor
TS 前端 SHALL treat `lastSeenSequence` as an in-memory cursor for the current page lifecycle. The cursor SHALL advance only after a timeline-backed `StreamEnvelope` is successfully accepted by the frontend stream consumer. The frontend SHALL NOT persist stream resume cursor in sessionStorage for use after page refresh, new tab, or another device.

#### Scenario: Same page reconnect resumes after the last displayed sequence
- **WHEN** the current page has accepted timeline-backed stream envelopes through sequence `N`
- **AND** the stream disconnects without a page refresh
- **THEN** the next stream connection MUST use `lastSeenSequence=N`
- **AND** the backend MUST replay only events with `sequence > N`
- **AND** replay completion MUST continue into live stream for the same session

#### Scenario: Legacy persisted cursor is ignored after page load
- **WHEN** a page is opened or refreshed and sessionStorage contains an old stream cursor
- **THEN** the frontend MUST NOT use that persisted value as the resume anchor
- **AND** the stream MUST start from `0` unless the current page has already accepted timeline-backed envelopes in memory

### Requirement: Active Run Bootstrap Replays Current Run From Zero
TS frontend and backend SHALL support restoring an in-progress current run after page refresh, new tab, or another device opens the same session. When conversation bootstrap returns top-level `activeRun { requestId, runId, status }`, the frontend SHALL open a run-scoped stream with `activeRun.requestId`, `activeRun.runId`, and `lastSeenSequence=0`.

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

### Requirement: Gap Recovery Gates Resume Anchor
TS frontend SHALL NOT treat a gap notice as a cursor advance. `resumeAfterSequence` SHALL be used only after the same session visible conversation refresh succeeds.

#### Scenario: Gap notice requires refresh before using resumeAfterSequence
- **WHEN** stream resume returns `STREAM_RESUME_GAP` with `resumeAfterSequence`
- **THEN** the frontend MUST keep the current in-memory cursor unchanged
- **AND** the frontend MUST refresh the same session visible conversation
- **AND** only after refresh succeeds MAY the next stream connection use `lastSeenSequence=resumeAfterSequence`

#### Scenario: Refresh failure keeps the last accepted cursor
- **WHEN** stream resume returns `STREAM_RESUME_GAP`
- **AND** the same session visible conversation refresh fails
- **THEN** the frontend MUST NOT use `resumeAfterSequence`
- **AND** the frontend MUST keep showing a degraded or disconnected state
- **AND** any later retry MUST use the last timeline-backed sequence accepted by the current page lifecycle

### Requirement: SSE And WebSocket Resume Equivalence
TS Web stream transport SHALL use the same resume inputs for SSE and WebSocket: `sessionId`, `lastSeenSequence`, optional `requestId`, and optional `runId`. Transport framing MAY differ, but recovery semantics SHALL be equivalent.

#### Scenario: Same resume input produces equivalent transport requests
- **WHEN** the frontend opens SSE and WebSocket streams for the same session, cursor, request filter, and run filter
- **THEN** both transports MUST carry the same `lastSeenSequence`, `requestId`, and `runId`
- **AND** switching transport MUST NOT create a new `RequestRun`
- **AND** switching transport MUST NOT change session-scoped sequence semantics
