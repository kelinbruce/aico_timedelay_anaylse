# 可观测边界

## Operational、audit 与 metrics 的语义隔离

- Operational log 由唯一 app-composed `agent-log` writer 输出；direct component diagnostic 使用 `runtime_diagnostic`，timeline/typed observation projection使用 `observation_derived`。Direct log不反向生成 observation。
- Audit 是 `agent-contracts/gateway` 的 top-level write-only `AuditEventStoreGateway.appendAuditEvent(record)`；LOCAL gateway写独立 versioned NDJSON，REMOTE只消费 entrypoint-selected gateway，不 fallback 到 local/SQLite/operational mirror。
- Metrics 通过 descriptor-owned OTel instruments、MeterProvider和 periodic reader/exporter streaming输出；production registry不保留 raw sample history。LOCAL使用独立 NDJSON history exporter，REMOTE只接受 trusted entrypoint注入的 OTLP exporter，缺失时 degraded且不创建 local fallback。

Canonical request/model/capability/policy/hook trajectory来自 persisted timeline或 narrow typed adapter，再由 projectors派生 log/audit/metric/trace；业务 owner只保留真正 private component diagnostics。Successful health probe不投影到 LOG，health/metric truth仍保留。

Shutdown顺序固定为 stop producers -> bounded projector drain -> 独立 close audit -> metrics forceFlush/shutdown -> shutdown-completed operational milestone -> operational flush/close。任一 finalizer failure不得跳过后续 finalizer。

## 核心结论

Tracing、metrics 和 structured logging 由 observability 实现层通过 middleware/interceptor、port decorator、auto-instrumentation 和 timeline/event subscriber 接入。核心契约不定义独立 trace 对象、metric record 或 SDK 类型，业务核心模块不得依赖 observability SDK/API 类型。

## 接入位置

- HTTP/SSE/WS 入口、transport 错误和 response boundary 使用 middleware/interceptor。
- model、capability、gateway、sandbox、checkpoint、audit writer 和 hook executor 使用 observed decorator 包装目标 port。
- request lifecycle、terminal commit、pending input、context compact、memory extraction、memory aging 和 task trajectory worker 使用 timeline/event subscriber、observed wrapper 或 app-composed safe diagnostic handoff 派生指标和结构化日志。

业务包确需本地运行诊断时，必须使用 `agent-common` 的 runtime logging contract。structured logging 仍必须通过 observation handoff 和 `StructuredLogProjector` 生成，并遵守 redaction policy。

## Audit

Audit event 是核心契约的一部分，用于记录 request、gateway、capability、hook、checkpoint、terminal commit 等关键事实的可追溯引用。Audit payload 不得承载 raw secret、raw credential、未脱敏路径、raw provider error、模型/工具原始输入输出或未授权对象内容。

Memory extraction、memory aging、task trajectory 和 model-facing memory tools 的 observation/audit payload 只能使用 status、operation、reason code、bounded counts、duration 和 stable refs。它们不得包含 memory content、structured content、briefIndex 原文、raw trait value、prompt、model output、tool payload、attachment content、path、credential、token、raw provider error 或 raw storage error。

`RiskPolicyEvaluation` 是 observability-owned structure fact，不是 runtime/pending input/gateway 的业务真相。它只允许稳定 reason code、risk level、outcome、operation kind、trusted refs、bounded safe details 和低基数耗时/计数；不得承载 raw prompt、raw model output、raw tool args/result、raw attachment body、secret、credential、本地路径、完整 sandbox request 或 provider raw response。

## Metrics 和 Trace 标签

Metrics labels 必须低基数，不得包含 requestId、runId、sessionId、prompt、payload、content、delta、local path、raw provider error 或 secret。Trace/log payload 使用 safe summary 和 stable refs。

TRACE 也是固定 projector set 的一个 surface，由 `agent-observability` 拥有 `TraceProjector` 实现、由 `agent-app` 显式决定是否装配。它只消费 host 已 redaction 的 observation snapshot，把同步执行边界映射为 OTel spans，把权威 outcome/fact 映射为 span events/status/bounded attributes；跨进程传播只使用 W3C Trace Context，导出语义只对齐 OTLP traces。`traceId`、`spanId`、SpanContext、tracer、meter、provider、exporter 或 propagator 类型不得进入 `agent-contracts`、runtime timeline、gateway records、message metadata、metrics labels 或 public DTO。

统一 `MetricsRegistry` 保持单一主逻辑，local/remote 差异只体现在 exporter/output。LOCAL由 `LocalMetricHistoryExporter` 把 cumulative aggregate snapshot写入独立 `nextagent-metrics.*.ndjson[.gz]` family；REMOTE由 entrypoint注入的 official OTLP exporter输出同一 inventory/aggregate语义。两者都不得把 metric payload写入 operational log；切换 exporter不得改变 metric inventory、allowed labels、dedup key、projection outcome 或 high-cardinality 拒绝规则。

Health details 只能暴露安全摘要、状态枚举和稳定引用，不得暴露 secret、raw credential、raw payload、raw provider error、local path、模型输入输出或工具输入输出。

## 错误归一化

`ErrorNormalizer` 归 `agent-contracts/observability` owning。Runtime、channel、context、model、capability、gateway、sandbox 或 observability boundary 返回失败时，必须归一化为 SafeError contract。


## Safe Debug Logging Mode

The app composition configuration exposes `observability.logging.redaction` with two stable modes:

- **`normal`** (default): structured log output contains only the current stable safe fields.
- **`debug`**: redaction remains fully enforced; structured log output MAY include additional policy-approved safe diagnostic fields sourced from the same observation event, but MUST NOT emit raw prompt, raw model output, stack, path, credential, token, tool args/result, or attachment content.

This mode is a controlled local diagnostic extension. It MUST NOT be interpreted as a permission to disable redaction, bypass the shared observation boundary, or emit raw sensitive fields. Downstream projectors, logger transports, audit sinks, and metric registries MUST NOT receive raw prohibited fields because of debug mode.

The only current exception is runtime diagnostic logging for the Agent Core tool loop: in `debug`, app composition MAY enable a dedicated `toolInput` runtime-log field to carry raw tool arguments for local troubleshooting. That exception is limited to the runtime diagnostic log surface, does not change `toolInputPreview` / `toolSafeSummary`, and does not permit raw tool arguments to enter structured logging, audit, metrics, trace, safe errors, or stream projections.
## 验证入口

- observability contract tests
- audit envelope tests
- log redaction tests
- metric tag policy tests
- trace smoke tests
- memory extraction/aging/task trajectory safe diagnostic tests

## 统一 Observation 输入

可观测主路径已经收敛为同一个 observation handoff：runtime authoritative timeline listener 优先，composition-time wrapper 作为只在缺少 runtime fact 时启用的兜底入口。所有正式 LOG、AUDIT、METRIC、HEALTH 和后续 TRACE processor 都必须消费同一个 sanitized `ObservabilityObservationEvent`，不得再各自定义 per-surface event bus、context carrier 或直接 sink write 路径。

`ObservabilityProjectorHost.acceptObservation(event)` 是唯一产品 handoff。它在事件进入内部异步 queue/mailbox 前同步执行 redaction 和 shape validation，内部只保留 sanitized observation、stable refs、safe numeric facts 和 bounded degradation evidence。业务模块、runtime、channel、gateway、model、capability、hook 与 health probe 都不得绕过 host 直接写结构化日志、audit sink、metrics registry 或 trace exporter。

## Trace/Log Linking 与 Diagnostic Snapshot

trace/log linking 的稳定关联基础是 business refs，而不是 SDK-owned trace identifiers。`DiagnosticContext` 只保存当前执行链的 trusted owner scope、request/run refs、boundary/operation、safe diagnostic candidates 和 bounded numeric facts；它不保存 `traceId`、`spanId`、raw payload 或 surface-specific schema。authoritative runtime facts 或 wrapper observation 必须在边界处 snapshot 当前 diagnostic context，后续 projector 只能消费 snapshot，不依赖 consumer 当前 ALS。

可信 trace 关联只通过进程内 sidecar 进入 local operational log：`agent-common` 的 runtime logging 边界提供只读 `RuntimeLogCorrelation` 与 `AsyncLocalStorage` helper，只接受有效 `traceId`/`spanId`，不接受任意附加字段；`TimelineSpanLifecycle.withExecutionRef()` 在找到可信 active/closed span entry 后以该 snapshot 包裹既有 operation，`agent-log` 的 runtime-diagnostic bound logger 在每次 write 时读取 sidecar 并忽略 caller 提交的 trace 字段。timeline observation 路径不修改 `ObservabilityObservationEvent`；`agent-observability` 提供内部 correlation registry，以 observation object identity 关联从可信 `inlinePayload.trace` 验证得到的 `traceId`/`spanId`，`ObservabilityProjectorHost` sanitization 后把 correlation binding 转移到 sanitized object，只有 `StructuredLogProjector` 读取它并写入 `StructuredLogEntry`。audit、metric、trace projector 接口和输入 shape 不变；普通 `getLogger()` 始终忽略 caller trace 并只使用当前 runtime correlation sidecar。Tracing 关闭或 sidecar 不存在时直接省略字段。

同一 authoritative fact 只能有一个 acquisition source。runtime 已拥有 canonical timeline fact 时，logging/audit/metrics/health/trace 都必须从该 fact 派生；没有 runtime fact 覆盖的 public port 才允许 wrapper 产生同 shape observation。不得让 timeline listener 和 wrapper 对同一事实双写同一 surface。

## Redaction 与 Fail-Closed 准入

统一 redaction policy 在 host 接收边界同步执行，职责是决定 observation 字段是否允许进入异步观测流，以及字段值只能以 safe value、ref-only、safe summary 还是 omitted 形式保留。该策略不改字段名，不创建第二套 redacted event carrier，也不让 projector 读取 redaction 前候选值。

下列内容不得进入 host queue、projector 或任何 surface sink：raw prompt、thinking、model output、tool args/result、attachment body、raw provider body、raw gateway error、stack trace、path、secret、credential、token、free-text reason、trace id/span id 和开放式高基数字段。缺失 trusted owner/time、field classification 不合法或 redaction 失败时，observation 必须 fail closed，并留下 bounded degradation evidence。

## Structured Logging、Audit、Metrics 与 Health

structured logging 是 observation stream 的一个 fixed projector，而不是业务包随处可调用的 helper surface。日志只表达已成立业务事实和系统事实的安全投影，包含 owner scope、stable refs、boundary、operation、outcome、low-cardinality state、可选 duration/usage 和 safe summary；日志不是 request truth、audit truth、metric sample、trace span 或 replay source。

runtime logging 是与 structured logging 分离的本地诊断面。它由业务包和 app composition 通过 `agent-common` 的 `RuntimeLogger` contract 直接使用，用于本地问题诊断；它不是 observation fact、audit truth、metric sample、health truth 或 timeline truth。runtime diagnostic log 不得调用 `ObservabilityProjectorHost.acceptObservation`，也不得生成 `StructuredLogEntry`。

agent execution trajectory 也遵循同一分层。canonical lifecycle fact由 persisted timeline mapper进入统一 observation stream；仅缺少 authoritative fact 的 context/sandbox等窄边界允许 typed adapter补 observation。`observation_derived` operational entries提供默认问题定位骨架，`runtime_diagnostic`只承载 queue、dispatch、commit-private、recovery、delivery和maintenance等 owner-private诊断；两者共享唯一 operational writer但都不是 durable replay truth，完整复盘仍以 canonical timeline与业务事实为准，也不得把 trace id/span id作为业务主关联键。

审计也是 observation stream 的 fixed projector。`AuditEvent` 由 observability 根据已成立 governance facts 投影，使用 stable owner scope、`agentId`、run/session refs、event name、outcome、safe reason code 和 safe summary 表达；它不是 canonical timeline event，也不是 gateway business record。只有 `AuditProjector` 可以调用 `AuditEventWriter`；runtime/core/capability/gateway/channel 不得直接写 audit sink。

`AuditEventWriter` 只把安全 `AuditEvent` 显式映射为 `AuditEventRecord` 并调用 deployment-selected、top-level write-only `AuditEventStoreGateway`。LOCAL gateway独占 `nextagent-audit.*.ndjson[.gz]` family；禁止 `audit_events` SQLite table/query、legacy mirror、dual write和 operational-log fallback。append/output失败只产生 bounded projector degraded outcome，不改变业务事实。

metrics 固定为 host projector 内的 inventory + label allowlist + dedup write 流程，只消费 sanitized observation 中的低基数枚举和 bounded 数值，如 request/model/capability/gateway outcome、duration、token usage 和 projector degradation；tenant、subject、session、run、request、message、capability invocation、path、payload 或 free-text reason 不得作为 label。

health response 是 machine-readable HTTP product surface，但 evaluator 仍归 observability implementation。primary health 是 bounded live check；deep health 才运行 app-composed `HealthProbe[]`。probe 受 timeout 和 `AbortSignal` 约束，不执行真实写操作，也不导出 raw provider error、path、secret、credential、prompt 或 model output。health diagnostics 只允许 stable component、status、reasonCode、latencyMs、timestamp 和 safe summary。
