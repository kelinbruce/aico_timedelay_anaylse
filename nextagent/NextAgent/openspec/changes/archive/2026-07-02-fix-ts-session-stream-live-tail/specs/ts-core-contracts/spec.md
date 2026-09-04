## MODIFIED Requirements

### Requirement: Canonical Timeline And Stream Projection
TS 后端 MUST 在核心契约中冻结 canonical timeline 和用户可见 stream projection 的边界。TimelineEventType MUST 是 request 执行事实的 canonical vocabulary；StreamEventType MUST 是 channel 对 canonical timeline 和 runtime status 的投影。SSE 和 WebSocket MUST 共享同一 stream envelope 和 projection 语义。Web/channel stream resume MUST enter runtime through `RuntimeSessionPort.streamEvents(query: RuntimeSessionStreamEventsQuery): AsyncIterable<RunTimelineEvent>`.

#### Scenario: Timeline 记录 canonical 执行事实
- **WHEN** request 被接受、开始计划、调用模型、调用 capability、产生降级、hook 控制决策改变生命周期、等待用户输入、处理附件、压缩上下文或进入终态
- **THEN** runtime MUST 发布 canonical timeline event
- **AND** event MUST 包含 eventId、sessionId、runId、requestId、requestContextId、sequence、event type、inline payload、可选 content reference boundary 和 createdAt
- **AND** runtime MUST populate or overwrite eventId、sessionId、runId、requestId、requestContextId、sequence and createdAt before an event becomes canonical
- **AND** agent/core MUST NOT rely on runtime-owned fields supplied before timeline publication being preserved

#### Scenario: Runtime session stream facade supports optional resume cursor and live events
- **WHEN** channel opens or resumes a runtime stream
- **THEN** channel MUST call `RuntimeSessionPort.streamEvents`
- **AND** `RuntimeSessionStreamEventsQuery` MUST contain `identityContext`, `sessionId`, optional `lastSeenSequence`, optional `requestId`, optional `runId`, and optional `signal`
- **AND** channel MUST provide `identityContext` and `sessionId`
- **AND** channel MUST preserve omitted `lastSeenSequence` as omitted and MUST NOT synthesize `0`
- **AND** when `lastSeenSequence` is present it MUST be a non-negative safe integer and MUST NOT exceed `Number.MAX_SAFE_INTEGER`
- **AND** present `lastSeenSequence` MUST be treated as a session-scoped stream observation cursor
- **AND** when `lastSeenSequence` is present, runtime MUST return recoverable timeline events from the same session with sequence greater than `lastSeenSequence` and then continue with newly emitted events
- **AND** when `lastSeenSequence`, `requestId`, and `runId` are all omitted, runtime MUST treat the stream as session live-tail and MUST NOT replay existing session timeline history
- **AND** when `requestId` or `runId` is supplied for bounded recovery, `lastSeenSequence` MUST also be supplied
- **AND** `requestId` and `runId` filters, when supplied, MUST only narrow the stream and MUST NOT change sequence ownership or reset sequence numbering
- **AND** delta timeline events MUST be non-persistent
- **AND** each delta timeline event MUST contain the cumulative full state for that delta stream
- **AND** replay MUST resume from the nearest recoverable event after `lastSeenSequence` according to delta persistence policy and MUST NOT require every sequence to be replayed
- **AND** channel MUST project runtime timeline events to `StreamEnvelope` and MUST NOT own canonical replay semantics
- **AND** Web channel MUST NOT use a channel-owned replay buffer as the source of execution facts
