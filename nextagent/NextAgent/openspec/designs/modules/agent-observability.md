# agent-observability

## 职责

承载 AsyncLocalStorage request/run context、diagnostic snapshot、ObservabilityProjectorHost、structured log projector/transport compatibility re-export、audit projector/writer、metrics projector/unified registry、health evaluator/probe metrics、TraceProjector 与 OTel integration helpers、metric tag policy 和 redaction policy。

最小内核中 hook、checkpoint 和 audit 使用显式 no-op product providers 保留调用点；safe error、structured logging 和 redaction policy 仍必须阻止 raw prompt、model output、stream delta、tool args/result、raw provider error、credential、token、附件内容或未脱敏路径进入对外 payload 或日志。

## 非职责

不定义业务事件语义、runtime state、gateway data model 或 domain object；不要求业务 package 直接依赖 tracing/metrics SDK 类型。

## 依赖

允许依赖 `@nextagent/agent-common`、`@nextagent/agent-contracts/observability`、`@nextagent/agent-local-file-roll` 和 adapter-local OTel libraries。业务 implementation package 不直接依赖 OTel SDK 类型；observability helper、audit writer 或 typed adapter 由 `agent-app` composition 注入或由明确的 contract/wrapper 边界接入。

## 核心设计落点

- Capability 自动 retry 的中间 attempts 不形成模型、Web、timeline 或 audit 事实；observability 可以记录有界低基数 attempt/outcome evidence，但不得改变调用方只消费一个最终结果的不变量。
- Capability safe error、完整 violations 和外置结果引用不得把 raw exception、stack、路径、credential、非法参数值、provider response 或原始 output 带入 log/metric/trace/audit。普通 `AUTHORIZATION` error 与显式 `REQUIRE_AUTHORIZATION` control 必须保持可区分的稳定 outcome。

- Canonical trajectory acquisition来自 persisted timeline mapper；context/sandbox等无 canonical fact 的边界使用 narrow typed adapter。删除 generic runtime-log bridge与 model observation wrapper，direct RuntimeLogger call不创建 observation。
- Structured log projector只输出 `observation_derived`，successful health probe不进入 LOG；audit projector显式映射到 write-only gateway record。
- Metrics使用单一 immutable descriptor inventory和 streaming OTel instruments；production registry不保留 raw samples，recent-fact dedup固定为16,384-key FIFO。
- `LocalMetricHistoryExporter` owning deterministic cumulative NDJSON schema、4 MiB line、8 MiB独立 foundation handle、60s reader output、100 MiB daily/gzip/固定7-day policy；不复用 operational/audit handle。
- `MetricsInfrastructure` 统一监视 LOCAL/REMOTE exporter callback与 flush/shutdown，暴露 bounded `READY|DEGRADED` readiness；REMOTE缺少显式 endpoint时以 `METRICS_EXPORTER_UNAVAILABLE` degraded启动且不创建 localhost/file/log fallback，恢复/降级诊断只按状态转换输出。

- 落实 `architecture/observability-boundaries.md` 的 structured logging、redaction、safe error 和 low-cardinality observability policy。
- 落实 `architecture/core-contracts.md` 的 `AuditEventWriter` 和 safe observability contract；不把 tracing/metrics SDK 类型放进业务核心 DTO。
- 统一通过 `ObservabilityProjectorHost.acceptObservation(event)` 接收 sanitized observation，并以 fixed projector set 产出 LOG、AUDIT、METRIC、HEALTH 和后续 TRACE；业务包、runtime listener 和 wrappers 不直接写 surface sink。
- 可为兼容性 re-export shared runtime logger factory，但 runtime diagnostic contract owning 归 `agent-common`，structured log projection owning 仍归本包。
- redaction 在 host 接收边界同步执行，host 内部 queue/mailbox 不保留 raw prompt、thinking、tool args/result、attachment body、provider body、path、secret、credential、token 或 trace id/span id。
- `StructuredLogProjector`、`AuditProjector`、`MetricsProjector`、`TraceProjector` 和 `HealthEvaluator` 共享同一 observation 输入模型，但各自拥有 coverage、schema、sink 和 fail-closed/degraded policy。
- `StructuredLogProjector` 按 `runId` 维护有界 `RequestLogSummaryAccumulator`：`REQUEST_ACCEPTED` 创建或重置，Model started/completed 以 `timelineEventId` 去重并闭合 invocation，`CAPABILITY_STARTED` 仅在存在唯一 `capabilityInvocationId` 时计数，host queue overflow 通过 `onObservationDropped(event)` hook 设置 drop marker；terminal 时计算 `status`、已知 usage、`toolCallCount` 和 `summaryStatus`（`COMPLETE` 或 `PARTIAL`）后写 entry 并释放 run state。无法证明完整时标记 `PARTIAL`，不为未知统计伪造零值。accumulator 只服务日志 projection，不回写 timeline/runtime/persistence。
- 可信 trace 关联通过进程内 correlation sidecar 进入 LOG surface：本包提供内部 correlation registry，以 observation object identity 关联从可信 `inlinePayload.trace` 验证得到的 `traceId`/`spanId`，timeline mapper 在创建 lifecycle observation 时完成绑定；`ObservabilityProjectorHost` sanitization 后把 correlation binding 转移到 sanitized object，只有 `StructuredLogProjector` 读取它并写入 `StructuredLogEntry`。audit、metric、trace projector 接口和输入 shape 不变。
- agent execution trajectory 的 replay surface owner 归本包：trajectory 事件统一经 `ObservabilityObservationEvent` 进入 fixed projector set，由 structured logging 产出主复盘视图。首版覆盖 `CONTEXT_ASSEMBLY_COMPLETED`、`CAPABILITY_SELECTED`、`SANDBOX_EXECUTION_COMPLETED`、`MODEL_STREAM_FIRST_VISIBLE_CONTENT`、`REQUEST_FIRST_CONTENT_DELIVERED` 和 terminal 关联；本包只投影安全摘要、稳定 refs、低基数 reason code 和 bounded duration/usage，不创建第二套 trajectory bus，也不接受 runtime log 反向拼装 replay。`REQUEST_FIRST_CONTENT_DELIVERED` 由 `TimelineObservationMapper` 在 per run 首个 `LLM_CONTENT_DELTA` 或 `LLM_THINKING_DELTA` 时产出，`durationMs` 为 `REQUEST_ACCEPTED.createdAt` 到该 delta 的时延，per run 只产出一次；`request_first_content_latency_seconds` histogram 和 `request.first_content_delivered` 结构化日志均从该 observation 派生。
- `TraceProjector` 只消费 host 已 redaction 的 observation，并按 OpenTelemetry 1.9 语义映射 spans、span events、span links 和 bounded attributes；W3C Trace Context / OTLP traces 语义、tracer/meter/provider/exporter helpers 只停留在本包与 `agent-app` composition 边界内。
- OTel trace infrastructure 由本包集中构造 `NodeTracerProvider`、`BatchSpanProcessor`、`OTLPTraceExporter` 和 `TraceProjector`；`agent-app` 只从冻结的 `observability.tracing` 配置选择 endpoint、Basic Auth credential refs 和可选 service name，通过统一 credential resolver 得到运行值后调用本包 factory。endpoint 或任一 credential 缺失、解析失败或 SDK 初始化失败时，必须输出不含配置值、credential 或 raw error 的 bounded operational evidence，跳过 trace projector 并继续启动。
- `observability.tracing.endpoint`、`authPkRef` 和 `authSkRef` 都是受控 `SecretReference`；endpoint 的配置形态为 `env:`，认证引用允许 `env:` 或 `file:`，`serviceName` 缺失时使用 `nextagent`。默认配置只提供引用占位，不把 secret 或解析后的 endpoint 写入日志、observation 或 span attributes。
- Trace projector 使用 `requestRunId` 维护请求和最新模型调用的进程内上下文：`REQUEST_ACCEPTED` 创建根 span，模型调用 span 直接挂在请求 span 下，能力调用 span 挂在同一 run 最新模型调用 span 下，其他 request/system observation 在存在请求上下文时挂到请求 span。缺少 `requestRunId` 的分组事件不进入该投影路径；request terminal 后清理该 run 的请求和模型上下文。
- 每个投影 span 都设置 boundary、operation、outcome、owner scope、稳定业务 refs、低基数 observation type 与对应 `SpanKind`。只有经过 host redaction 的 `safeSummary` 可以进入 `input.value`，`output.value` 只由低基数 outcome 和可选 safe reason code 组成；不得读取或导出 raw prompt、模型输出、工具参数、工具结果、路径、credential 或 token。
- trace 初始化、export 和 projection 失败都属于非阻塞观测降级。初始化成功只记录一次不含 endpoint、credential 或 service name 的完成事件；exporter 失败和 projector 异常通过 component runtime logger 输出 bounded failure stage/reason，且不得阻止其他 fixed projectors 消费同一 observation。
- `currentOtelSpanId()` 是本包的兼容性 helper：仅返回当前活跃 OTel span 的 `spanId`；SDK 不可用或当前上下文没有 span 时返回 `undefined`，不得抛出异常，也不得把该标识提升为业务契约、持久化字段或公共 DTO。
- unified `MetricsRegistry` 继续拥有 metric inventory、label allowlist、dedup 和 projection outcome 主逻辑；LOCAL只由 `LocalMetricHistoryExporter` 写独立 `nextagent-metrics.*.ndjson[.gz]`，REMOTE只由 entrypoint注入的 official OTLP exporter输出，metric sample不得镜像到 operational log。
- `AuditEventWriter` 只映射到 deployment-selected、top-level write-only `AuditEventStoreGateway`；LOCAL由独立 `nextagent-audit.*.ndjson[.gz]` family承载，禁止 SQLite、legacy `nextagent-audit.log` mirror或 operational-log fallback。
- capability audit 从 runtime canonical `CAPABILITY_COMPLETED` lifecycle event 派生；capability executor 和 Agent Core 不直接调用 `AuditEventWriter` 写 capability audit。
- 最小内核 no-op audit writer 是显式 product provider，只保留调用证据，不替代真实 audit sink；归档后正式产品路径应优先装配真实 audit/log/metrics/health projector，而不是继续依赖 no-op。

## 替换边界

是。Observability sink/integration 可整包替换或通过 wrapper 扩展。

## 验证关注点

- 业务 package 不直接依赖 OTel SDK 类型或散落 `console.*`。
- metrics labels 不包含高基数 request/run/session id、prompt、payload、content、local path、raw provider error 或 secret。
- logs/traces 使用 safe summary 和 stable refs。
- tracing 配置缺失、credential 解析失败、SDK 初始化失败和 exporter 失败均不阻断启动或其他 observability surfaces，且诊断不泄漏 endpoint、secret reference、credential 或 raw error。
- TraceProjector 测试覆盖请求/模型/能力父子关系、低基数 observation type、`SpanKind`、安全 input/output 映射、孤立事件过滤和 terminal 清理。
- no-op audit writer 是显式产品 provider，不是缺失依赖或 test-only stub。

## Capability 失败处置协作

本包只投影最终 status、稳定 code/category、低基数 failure stage、attempt count 和时延等安全观测；中间 retry 不能成为模型、Workflow、stream 或 timeline 事实。raw arguments、provider body、路径、凭据和结果正文仍受 canonical operational diagnostic 的窄边界约束，不能进入产品观测面。完整诊断与安全矩阵见 `openspec/designs/architecture/capability-invocation-and-failure-disposition.md`。

## Public Exports

`@nextagent/agent-observability`

## Safe Diagnostic Projection in Debug Mode

When `observability.logging.redaction=debug`, the `StructuredLogProjector` MAY include additional policy-approved safe diagnostic fields in structured log output, sourced from the same `ObservabilityObservationEvent`. The projector MUST NOT emit raw prompt, raw model output, stack, path, credential, token, tool args/result, or attachment content. The projector MUST remain valid even when additional fields are absent. Debug mode does not change the redaction boundary, create a second observation stream, or permit a bypass of the shared `ObservabilityProjectorHost`.
