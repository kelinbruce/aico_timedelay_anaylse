# structured-logging Specification

## Purpose
TBD - created by archiving change add-ts-structured-logging. Update Purpose after archive.
## Requirements
### Requirement: LOG surface 必须消费统一 observation stream

Structured logging SHALL 消费 `add-ts-trace-log-linking` 产生的 `ObservabilityObservationEvent`。runtime listener、wrapper taxonomy、system observation、source precedence、dedup 和 `ObservabilityProjectorHost.acceptObservation(event): void` 仍由 `add-ts-trace-log-linking` 拥有。

`StructuredLogProjector` SHALL 作为 `ObservabilityProjectorHost` 异步调用的 fixed projector。业务 package 不得 import logger helper、Pino、logging transport、metrics registry、audit writer、tracer 或 observability SDK 来写产品日志。

#### Scenario: LOG 使用 host handoff 路径
- **WHEN** runtime listener、wrapper、middleware 或 system producer 创建 observation
- **THEN** structured logging 通过 `ObservabilityProjectorHost` 和 `StructuredLogProjector` 执行
- **AND** wrapper 不得直接写 log sink

### Requirement: LOG coverage 清单必须声明输入来源

LOG surface SHALL 维护 coverage inventory。每个 log event SHALL 声明业务事实、首选 timeline event、event 是否已存在、已有 event 是否需要增强、是否需要由 owner change 新增业务 event，或由哪个 wrapper / middleware / system producer 生成 `ObservabilityObservationEvent`。

首版 LOG inventory SHALL 包含：

| Log event | Preferred input | Status |
|---|---|---|
| `request.accepted` | `REQUEST_ACCEPTED` | 已有 timeline event；无需增强 |
| `request.rejected` | `RuntimeCommandPort` wrapper | 当前由 `agent-app` composition 接入；run / timeline 尚未产生时使用 wrapper observation |
| `request.terminal` | `REQUEST_COMPLETED` / `REQUEST_FAILED` / `REQUEST_CANCELED` / `REQUEST_SUPERSEDED` | 已有 timeline events；无需增强 |
| `model.invocation.completed` | `ModelInvocationService` wrapper observation | wrapper observation；`durationMs` 和 optional `usage` 归 `add-ts-trace-log-linking` |
| `model.invocation.failed` | `ModelInvocationService` wrapper observation | wrapper observation；`durationMs`、safe reason 和 optional `usage` 归 `add-ts-trace-log-linking` |
| `capability.invocation.started` | `CAPABILITY_STARTED` | 已有 timeline event；无需增强 |
| `capability.invocation.completed` | `CAPABILITY_COMPLETED` | 已有 event；`durationMs` 增强归 `add-ts-trace-log-linking` |
| `stream.visible_content` | `LLM_CONTENT_DELTA` 或 normalized stream observation | 已有 event 可用于 safe refs；normalized stream timing wrapper 后续实现；忽略 raw content |
| `degradation.notice` | `DEGRADATION_NOTICE` | 已有 timeline event；无需增强 |
| `gateway.call` | `GatewayPort` wrapper | 后续 gateway owner wrapper；本 change 不新增 runtime timeline event |
| `hook.policy` | hook / policy wrapper | 后续 hook / policy owner wrapper；本 change 不新增 runtime timeline event |
| `attachment.intake` | `ATTACHMENT_*` 或 `AttachmentIntakeRead` wrapper | event / wrapper 由 attachment owner 后续实现 |
| `safe_error.emitted` | `SafeErrorOutput` wrapper | 后续 safe error owner wrapper |
| `large_content.operation` | attachment / capability / context wrapper | 后续 owner wrapper；不包含 content/path |
| `web.entrypoint` | channel entrypoint middleware | transport-safe observation |
| `system.runtime` | system observation producer | 仅 app/config/server/sink facts |
| `logging.degraded` | projector / host degradation evidence | shared degradation model |

本 change SHALL NOT 新增 `TimelineEventType`。gateway、hook、policy、attachment 或 large-content facts 的 future timeline event 必须由对应业务 owner change 定义。
本 change 的代码实现落地 LOG projector、当前已存在 acquisition source 的消费，以及 pre-run rejection 所需的 `RuntimeCommandPort` wrapper 消费；后续 wrapper 行表示允许且必须遵循的接入方式，不表示当前已经实现对应采集器。

#### Scenario: Model wrapper observation 生成日志
- **WHEN** `MODEL_INVOCATION_COMPLETED` observation 包含 `durationMs` 和 optional `usage`
- **THEN** LOG projection 输出 `model.invocation.completed`
- **AND** 日志不包含 prompt、model output、raw provider response 或 trace/span id

#### Scenario: Wrapper 不重复 timeline 日志
- **WHEN** `CAPABILITY_COMPLETED` observation 已经来自 runtime timeline
- **THEN** capability wrapper 不得为同一事实发出重复 LOG observation

### Requirement: System runtime logs 必须通过 system observation

System runtime logs SHALL 从 system observation events 和 LOG policy 生成。app bootstrap、configuration validation、server listen/shutdown、sink availability 和 health evaluator status 可以产生 system observation。它们不得伪装成 request lifecycle、audit、metric、health truth 或 terminal fact。

#### Scenario: Config validation 输出 system runtime log
- **WHEN** configuration validation 完成或失败
- **THEN** system observation 可以生成 `system.runtime`
- **AND** 日志不包含 request lifecycle ids、prompt、tool args/result、attachment content、raw provider error、path 或 secret

### Requirement: LOG failures 必须显式、有界且不影响业务结果

Structured log transport failure、redaction failure、schema validation failure、serialization failure、missing trusted owner/time 或 projector timeout SHALL NOT 改变 request lifecycle、terminal commit、stream projection、model invocation、capability invocation、gateway call 或 health response。projector SHALL 通过 shared degradation model 产生 bounded logging degradation evidence。

#### Scenario: Transport failure 不阻塞 terminal commit
- **WHEN** terminal observation 被投影且 log transport 不可用
- **THEN** terminal truth 保持不变
- **AND** LOG projection 记录 degraded / failed_closed outcome，且不写 raw fallback

### Requirement: LOG output 不得成为其它 surface 的输入真相

Structured log output SHALL 是 derived observability evidence。Audit、metrics、health 和 trace projectors SHALL 消费 `ObservabilityObservationEvent`、policy results 和自身 sink 状态；它们不得 replay structured log output 来生成 audit records、metric samples、health truth 或 trace spans。

#### Scenario: Metric projector 不读取日志
- **WHEN** request duration metrics 被写出
- **THEN** 它们从 observation / metric policy 派生
- **AND** 不从 structured log entries 重建

### Requirement: Structured observability log SHALL be the primary replay surface for agent execution trajectory

`nextagent-observability.log` 对应的 structured logging surface MUST 成为 agent 执行轨迹复盘主视图。它 MUST 覆盖 turn、context assembly、capability selection、sandbox execution 和 user-visible output 对齐的安全轨迹事件，并保持与 request lifecycle、model invocation、capability invocation 和 terminal outcome 的稳定关联。

structured trajectory logs MUST 只输出安全摘要、稳定 refs、低基数 reason code 和 bounded duration/usage fields。它 MUST NOT 输出 raw prompt、raw model output、raw tool args/result、stream delta、free-text reasoning、路径、credential、token 或 tracing SDK 字段。

#### Scenario: Agent trajectory can be replayed from structured observability logs
- **WHEN** 一次 request 经历多轮 model/tool 执行并完成 terminal commit
- **THEN** `nextagent-observability.log` MUST 足以按稳定 refs 重放 turn、context assembly、capability selection、sandbox execution、visible output 和 terminal 的主轨迹
- **AND** 复盘不需要依赖 runtime private debug fields 或 raw content



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
