## MODIFIED Requirements

### Requirement: Canonical Timeline And Stream Projection
TS 后端 MUST 在核心契约中冻结 canonical timeline 和用户可见 stream projection 的边界。TimelineEventType MUST 是 request 执行事实的 canonical vocabulary；StreamEventType MUST 是 channel 对 canonical timeline 和 runtime status 的投影。SSE 和 WebSocket MUST 共享同一 stream envelope 和 projection 语义。Web/channel stream resume MUST enter runtime through `RuntimeSessionPort.streamEvents(query: RuntimeSessionStreamEventsQuery): AsyncIterable<RunTimelineEvent>`.

#### Scenario: Timeline 记录 canonical 执行事实
- **WHEN** request 被接受、开始计划、调用模型、调用 capability、产生降级、hook 控制决策改变生命周期、等待用户输入、处理附件、压缩上下文或进入终态
- **THEN** runtime MUST 发布 canonical timeline event
- **AND** event MUST 包含 eventId、sessionId、runId、requestId、requestContextId、sequence、event type、inline payload、可选 content reference boundary 和 createdAt
- **AND** runtime MUST populate or overwrite eventId、sessionId、runId、requestId、requestContextId、sequence and createdAt before an event becomes canonical
- **AND** agent/core MUST NOT rely on runtime-owned fields supplied before timeline publication being preserved

#### Scenario: Runtime session stream facade supports resume and live events
- **WHEN** channel opens or resumes a runtime stream
- **THEN** channel MUST call `RuntimeSessionPort.streamEvents`
- **AND** `RuntimeSessionStreamEventsQuery` MUST contain `identityContext`, `sessionId`, `lastSeenSequence`, optional `requestId`, optional `runId`, and optional `signal`
- **AND** channel MUST provide `sessionId` and `lastSeenSequence`
- **AND** `lastSeenSequence` MUST be a non-negative safe integer and MUST NOT exceed `Number.MAX_SAFE_INTEGER`
- **AND** `lastSeenSequence` MUST be treated as a session-scoped stream observation cursor
- **AND** runtime MUST return recoverable timeline events from the same session with sequence greater than `lastSeenSequence` and then continue with newly emitted events
- **AND** `requestId` and `runId` filters, when supplied, MUST only narrow the stream and MUST NOT change sequence ownership or reset sequence numbering
- **AND** delta timeline events MUST be non-persistent
- **AND** each delta timeline event MUST contain the cumulative full state for that delta stream
- **AND** replay MUST resume from the nearest recoverable event after `lastSeenSequence` according to delta persistence policy and MUST NOT require every sequence to be replayed
- **AND** channel MUST project runtime timeline events to `StreamEnvelope` and MUST NOT own canonical replay semantics
- **AND** Web channel MUST NOT use a channel-owned replay buffer as the source of execution facts

#### Scenario: Timeline sequence is consistent across instances
- **WHEN** runtime assigns timeline event sequence in a single-instance or multi-instance deployment
- **THEN** the sequence MUST be greater than zero and MUST increase within the session timeline
- **AND** runtime MUST NOT wrap, reset, reuse, modulo or run-scope the sequence for the same session
- **AND** concurrent timeline events in the same session MUST NOT receive duplicate sequence values
- **AND** runtime MUST NOT publish same-session timeline events in a way that violates sequence order
- **AND** the core contract MUST NOT require a specific coordination mechanism

#### Scenario: Stream replay and history use different facts
- **WHEN** stream content is recovered after disconnect, refresh, or another device opening the session
- **THEN** runtime MUST recover runtime process facts from timeline events according to persistence and delta policies
- **AND** historical conversation display MUST use visible `SessionMessage` records as the final conversation content source
- **AND** stream replay MUST NOT reconstruct final conversation history from timeline events
- **AND** when delta or sequence continuity cannot restore an active display, the system MUST use a stream notice or equivalent safe outcome to trigger history refresh from visible messages

#### Scenario: Active run summary is available for bootstrap
- **WHEN** a session has a latest non-terminal `RequestRun`
- **THEN** `RuntimeSessionPort.getActiveRun(query: RuntimeGetActiveRunQuery)` MUST return `RuntimeActiveRunSummary { requestId, runId, status }`
- **AND** the summary MUST be derived from runtime-owned run state
- **AND** the summary MUST NOT be derived from frontend cache or conversation-message scanning

#### Scenario: Stream 从 timeline 投影
- **WHEN** channel 向用户发送 request stream
- **THEN** channel MUST 使用 `StreamEventType` 投影 canonical timeline 或 runtime status
- **AND** channel MUST NOT 发明与 canonical timeline 冲突的执行事实
- **AND** SSE 和 WebSocket 对同一 request MUST 暴露等价的 stream envelope、terminal event 和 error semantics
- **AND** stream envelope MUST carry eventId、sessionId、requestId、optional run/context refs、sequence、eventType、optional timeline event ref、transport hints、payload 和 createdAt
- **AND** requestId MUST identify the root user request message and `StreamEnvelope` MUST use requestId as its request correlation field
- **AND** when projected from a timeline event, timelineEventRef MUST reference the source timeline event id and payload MUST be the channel-safe projection of the timeline payload
- **AND** terminal state MUST be derived from `StreamEventType` rather than a separate envelope flag

#### Scenario: 事件 vocabulary 被校验
- **WHEN** contract tests 枚举 RunStatus、TimelineEventType 和 StreamEventType
- **THEN** tests MUST 验证 canonical vocabulary 中的状态和事件名称稳定
- **AND** degradation MUST NOT 作为 RunStatus value 表达，MUST 通过 timeline/stream event、result、safe error、audit event 或 observability metric 表达
- **AND** HOOK_DECISION_APPLIED and POLICY_APPLIED MUST be timeline-only events and MUST NOT be part of first-release StreamEventType
- **AND** deprecated projection name MUST NOT 出现在 public stream contract 中
