## ADDED Requirements

### Requirement: Observation-derived logs share the operational writer without becoming the universal log contract

When operational logging is enabled, StructuredLogProjector output SHALL pass through the app-composed operational writer and use `surface=observation_derived`. `StructuredLogEntry` SHALL remain the specialized trajectory projection contract. Runtime diagnostics MAY be structured without constructing StructuredLogEntry or fabricating a durable business event, but every ordinary diagnostic physical line MUST still carry a stable code-owned log event. Fastify native final access records are outside StructuredLogEntry and use their fixed native message instead of an operational event.

#### Scenario: Direct and projected logs share only physical infrastructure

- **WHEN** a runtime direct diagnostic and a trajectory entry are emitted
- **THEN** both MUST use the common writer/envelope
- **AND** only the trajectory entry MUST use StructuredLogEntry and its projector-owned event
- **AND** the runtime diagnostic MUST NOT be converted into an observation

### Requirement: Canonical runtime timeline drives existing request-bound trajectory facts

For lifecycle facts already represented by RunTimelineEvent, the runtime timeline listener and TimelineObservationMapper SHALL be the sole semantic acquisition path into ProjectorHost. The mapper MUST cover actually produced request, model, capability, policy/hook, context compaction/degradation, pending-input and background-task families using only approved safe fields.

The mapper MAY observe live-only content delta to emit one content-free first-visible milestone per model invocation. Run-scoped timing and dedup state MUST be bounded and cleared after request terminal.

Product composition MUST remove equivalent model wrapper, runtime-log bridge and generic internal observation after mapper coverage exists. A typed adapter MAY cover only an approved trajectory fact absent from canonical timeline.

#### Scenario: Model and capability facts are not double projected

- **WHEN** canonical model/capability timeline events pass through the listener
- **THEN** each start/terminal outcome MUST be projected at most once
- **AND** no wrapper, runtime-log parser, internal observer or same-outcome direct log may duplicate it

#### Scenario: Live delta yields no content log

- **WHEN** thinking/content/tool-result deltas are published
- **THEN** no delta content may enter operational output
- **AND** at most one content-free first-visible milestone may be emitted per invocation

### Requirement: Typed trajectory adapters remain narrow and transparent

This change MAY use typed observation adapters only for trusted pre-acceptance rejection, ContextEnginePort.assemble, existing attachment intake and AppSandboxGatewayPort.execute/executeWithStdoutChunks. Each adapter MUST preserve result, error, cancellation, retry and chunk semantics and MUST NOT wrap an equivalent timeline fact.

#### Scenario: Context assembly uses a narrow adapter

- **WHEN** ContextEnginePort.assemble completes or fails without a canonical timeline fact
- **THEN** its typed adapter MAY produce the approved trajectory observation
- **AND** ContextEnginePort.render and existing compaction/degradation timeline facts MUST NOT be wrapped

### Requirement: Successful child stages support default info diagnosis

Model and capability start/terminal bookends SHALL remain visible at info. First-visible, successful context assembly, policy allow, hook success and successful sandbox child stage SHALL also be visible at info because they are the local problem-location path for ordinary internal run diagnosis. Denial/degradation SHALL be at least warn and failure SHALL be error.

#### Scenario: Normal sandbox child stage remains visible at info

- **WHEN** a capability invokes sandbox and completes normally
- **THEN** capability start/terminal MAY be info
- **AND** policy allow and sandbox start/completed MUST be info
- **AND** denial/failure MUST remain visible without debug

## MODIFIED Requirements

### Requirement: Structured logs 必须从 observation 受控映射

`StructuredLogProjector` SHALL 只把可信 observation fields 和已批准 diagnostic candidates 映射到 `StructuredLogEntry`。它必须复制可用 owner-safe refs，省略缺失 optional refs，使用稳定 event name，按 policy 选择有界 level，复制可选 `durationMs` 和 normalized `usage`，并在 sink write 前执行 LOG redaction。

The LOG surface for this release SHALL support exactly two diagnostic-detail modes from frozen `observability.logging.diagnosticDetail`:

- `normal`: 当前默认行为；仅输出现有 stable safe 字段。
- `debug`: 保持 redaction 不变，但允许在 structured log 中输出额外的 safe diagnostic fields，用于本地排障。

`debug` mode MUST remain a safe debug mode. It MUST NOT emit raw prompt、raw model output、raw provider response、stack、path、credential、token、tool args/result、attachment content or any field already forbidden by the redaction policy. Extra debug fields MUST come only from trusted observation fields, trusted safe error fields, or policy-approved diagnostic candidates already attached to the same `ObservabilityObservationEvent`.

#### Scenario: Missing refs 被省略
- **WHEN** log observation 缺少 `messageId` 或 `capabilityInvocationId`
- **THEN** log entry 省略这些 refs
- **AND** 不生成 placeholder id

#### Scenario: Raw capability result 被忽略
- **WHEN** capability result delta 包含 raw result payload
- **THEN** LOG projection 忽略 raw result fields
- **AND** 只可记录 safe refs、status、duration 和 safe reason

#### Scenario: debug mode expands safe diagnostic fields

- **WHEN** frozen app config sets `observability.logging.diagnosticDetail=debug` and an observation carries policy-approved safe diagnostic fields
- **THEN** structured log output MAY include more of those safe diagnostic fields than `normal` mode
- **AND** the additional fields MUST remain bounded, deterministic, and sourced from the same observation
- **AND** the output MUST remain valid even when those additional fields are absent

#### Scenario: normal mode remains backward-compatible

- **WHEN** frozen app config omits `observability.logging.diagnosticDetail` or sets it to `normal`
- **THEN** structured log projection MUST preserve the current normal-mode behavior
- **AND** it MUST NOT require producers to attach new diagnostic fields in order to emit a valid log entry

### Requirement: StructuredLogEntry 必须 schema-stable

StructuredLogEntry SHALL 是 `surface=observation_derived` 的专用逻辑输出对象，不是所有 operational log 的公共 DTO。它必须包含事实 `occurredAt`、logical `level`、一个具体稳定 `event`、扁平 allowlisted owner/correlation coordinates、可选 safe reason/category、可选 duration、可选 normalized usage 和可选低基数诊断 fields。logical level MUST support debug/info/warn/error。它不得包含 physical `timestamp`、嵌套 `ownerScope`/`correlation`、`boundary`、`operation`、`outcome`、`processState`、`safeSummary`、`requestContextId` 或 `stepId`。

StructuredLogProjector SHALL use `StructuredLogEntry.level` to invoke an app-injected observation-bound RuntimeLogger. That logger MUST be created by the same operational writer implementation used by ordinary `getLogger`, MUST bind `surface=observation_derived`, and MUST add writer-owned textual level、timestamp、component、serviceVersion through the same Pino child、field/message sanitization、Error projection、budget and enqueue path. RuntimeLogger direct diagnostic 不受 StructuredLogEntry schema 约束，但使用同一 API 与写入实现并绑定 `surface=runtime_diagnostic`，physical line 同样必须提供一个稳定 event。physical line MAY 带公共 writer 净化后的可选 msg，但不得持久化 operation/outcome；msg 不得改变 StructuredLogEntry、observation 或 canonical timeline 的机器语义。

Product composition MUST NOT retain `StructuredLogTransport`, a per-level transport adapter, an independently injectable trajectory transport, or a second silent transport implementation. Business callers MUST NOT select or override surface. Test composition MAY inject a test-only capture RuntimeLogger directly into the projector without adding a product transport option.

Root-cause exception evidence SHALL remain a direct component diagnostic rather than a StructuredLogEntry or canonical observation. Canonical model/capability/request failure remains the unique trajectory outcome. Model/capability/context catches that continue propagation MUST NOT emit `*.exception_captured`; only the request execution termination boundary MAY add one correlated `request.execution.exception_captured` containing writer-derived safe exception type/fingerprint/bounded cause chain/owned frames and `failureStage=REQUEST_EXECUTION`.

#### Scenario: Debug-only maintenance trajectory respects common threshold

- **WHEN** projector emits logical debug maintenance detail under default info
- **THEN** operational writer MUST filter it from enabled sinks
- **AND** development debug MUST expose it without changing truth source

#### Scenario: Model usage remains normalized

- **WHEN** model observation carries usage
- **THEN** entry MUST use inputTokens/outputTokens/totalTokens
- **AND** it MUST NOT introduce open-ended or provider-raw usage fields
- **AND** the operational writer MUST preserve the approved numeric values rather than treating the field names as credentials

#### Scenario: Task trajectory uses concrete terminal events

- **WHEN** task trajectory build diagnostics report ENQUEUED, BUILT, SKIPPED, DROPPED or FAILED
- **THEN** StructuredLogProjector MUST emit `task.trajectory.build.enqueued`, `task.trajectory.build.completed`, `task.trajectory.build.skipped`, `task.trajectory.build.dropped` or `task.trajectory.build.failed`
- **AND** routine enqueue/build/skip MUST be debug, drop MUST be warn and failure MUST be error
- **AND** details MUST NOT repeat the safeReasonCode as a second reasonCode field

#### Scenario: Exception evidence is delayed to the request termination boundary

- **WHEN** an unexpected model or capability Error produces a canonical failed timeline event
- **THEN** StructuredLogProjector MUST emit exactly one lifecycle failure outcome
- **AND** the model or capability owner MUST preserve and propagate the exception without a direct diagnostic
- **AND** if the exception terminates the accepted request execution, `agent-runtime` MUST emit exactly one correlated runtime diagnostic
- **AND** the runtime diagnostic MUST NOT be parsed back into an observation

### Requirement: Structured observability log SHALL be the primary operational trajectory diagnosis view

The observation-derived surface in the unified operational file SHALL be the primary local log view for safe request trajectory diagnosis, not the authoritative or complete durable replay source. At default info it MUST provide request/model/capability/terminal skeleton, successful context、policy/hook、sandbox、first-visible milestones where present, and stable correlation. Debug MAY add lower-level maintenance and task-build detail; denial/degradation/failure MUST remain visible at warn/error.

Canonical persisted timeline and business durable facts SHALL remain the source for complete lifecycle replay. The operational log MUST NOT claim that debug-only facts are recoverable when debug was not enabled. The physical operational-log path MUST preserve acquisition truth, safe correlation and all default-info/warn/error diagnosis guarantees defined by this change.

#### Scenario: Default operational trajectory supports problem location

- **WHEN** a request performs multiple model/tool rounds and reaches terminal
- **THEN** filtering info observation-derived entries MUST provide the safe request/model/capability/terminal skeleton plus key context/policy/hook/sandbox/first-visible milestones where present
- **AND** failure/degradation child stages MUST remain visible
- **AND** complete replay MUST use canonical durable facts rather than runtime private logs or raw content

### Requirement: LOG output does not absorb audit, metrics, health, or direct component truth

StructuredLogProjector SHALL consume only approved observations. It MUST NOT consume AuditEvent, MetricSample, health probe output, operational file content or arbitrary RuntimeLogger objects. Successful health probe results MUST NOT be projected into operational logs; only separately owned state-transition or subsystem-failure diagnostics MAY be logged through RuntimeLogger.

#### Scenario: Other output domains are not projected as logs

- **WHEN** audit, metric or successful health probe output is produced
- **THEN** StructuredLogProjector MUST NOT serialize it merely for redundancy
- **AND** each output domain MUST retain its own sink contract
