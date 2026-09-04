## ADDED Requirements

### Requirement: LOG surface 必须消费统一 observation stream

Structured logging SHALL 消费 `add-ts-trace-log-linking` 产生的 `ObservabilityObservationEvent`。runtime listener、wrapper taxonomy、system observation、source precedence、dedup 和 `ObservabilityProjectorHost.acceptObservation(event): void` 仍由 `add-ts-trace-log-linking` 拥有。

`StructuredLogProjector` SHALL 作为 `ObservabilityProjectorHost` 异步调用的 fixed projector。业务 package 不得 import logger helper、Pino、logging transport、metrics registry、audit writer、tracer 或 observability SDK 来写产品日志。

#### Scenario: LOG 使用 host handoff 路径
- **WHEN** runtime listener、wrapper、middleware 或 system producer 创建 observation
- **THEN** structured logging 通过 `ObservabilityProjectorHost` 和 `StructuredLogProjector` 执行
- **AND** wrapper 不得直接写 log sink

### Requirement: StructuredLogEntry 必须 schema-stable

`StructuredLogEntry` SHALL 是 LOG surface 的输出对象，必须包含稳定 `timestamp`、`level`、`event`、`ownerScope`、`correlation`、`boundary`、`operation`、`outcome`、可选 `processState`、可选 `costLatency.durationMs`、可选 `costUsage` 和可选有界 `safeSummary`。

`costUsage` SHALL 复用 normalized `ModelUsage` shape：`inputTokens`、`outputTokens` 和 `totalTokens`。projector 不得引入 `modelInputTokens`、开放式 usage key、raw provider usage payload、request id label 或高基数字段。

#### Scenario: Model usage shape 保持一致
- **WHEN** model observation 携带 normalized usage
- **THEN** structured log entry 使用 `costUsage.inputTokens`、`costUsage.outputTokens` 和 `costUsage.totalTokens`
- **AND** 不输出 `model*` 前缀的 usage 字段

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

### Requirement: Structured logs 必须从 observation 受控映射

`StructuredLogProjector` SHALL 只把可信 observation fields 和已批准 diagnostic candidates 映射到 `StructuredLogEntry`。它必须复制可用 owner-safe refs，省略缺失 optional refs，使用稳定 event name，按 policy 选择有界 level，复制可选 `durationMs` 和 normalized `usage`，并在 sink write 前执行 LOG redaction。

#### Scenario: Missing refs 被省略
- **WHEN** log observation 缺少 `messageId` 或 `capabilityInvocationId`
- **THEN** log entry 省略这些 refs
- **AND** 不生成 placeholder id

#### Scenario: Raw capability result 被忽略
- **WHEN** capability result delta 包含 raw result payload
- **THEN** LOG projection 忽略 raw result fields
- **AND** 只可记录 safe refs、status、duration 和 safe reason

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
