# otel-observability-adapter Specification

## Purpose

定义在不改变统一 observation contract、业务模块边界和 gateway implementation 的前提下，如何把 `ObservabilityProjectorHost` 接到正式的 OpenTelemetry trace / metric adapter。
## Requirements
### Requirement: OTel adapters 必须通过既有 observation handoff 路径接入

OTel metrics 和辅助观测 span MUST 继续通过 `ObservabilityProjectorHost.acceptObservation(event)` 接入。timeline 权威执行 span MUST 通过 `agent-observability` 在 composition 时提供的 trace-aware timeline store decorator 接入，并 MUST 以持久化 timeline lifecycle 为唯一开始和终止来源。

`TraceProjector`、trace-aware timeline store、trace-aware request-run store、span registry、OTel provider、exporter 和 propagator MUST 属于 `agent-observability`。`agent-app` MUST 创建一个共享 lifecycle/registry 实例并完成装配。runtime、core、workflow、model、capability、channel 和物理 gateway MUST NOT 直接调用 OTel API。

`MetricsProjector` MUST 继续通过统一 `MetricsRegistry` 抽象写入 OTel Meter sink。trace-aware decorator MUST NOT 替代 structured log、metric、audit、health 或其他 projector，也 MUST NOT 给业务 path 增加 direct trace sink。

物理 local 和 remote gateway 的 public port、Record、SQLite schema、事务、sequence、幂等、CAS、Record 映射、持久化路径和 transport 行为 MUST 保持不变。trace-aware decorator MUST 把 gateway-bound mutation 限制在 `RunTimelineEventRecord.inlinePayload` 的保留 `trace` 命名空间，并 MUST NOT 修改 owner scope、agent scope、eventId、sessionId、runId、requestId、requestContextId、sequence、type、createdAt、contentRef、幂等键或终止事务的其他 Record。

#### Scenario: TRACE surface 通过 fixed projector set 接入

- **WHEN** `agent-app` 装配 observability projector host 和 trace-aware stores
- **THEN** `TRACE` surface 中的辅助 observation MUST 以 `ObservabilityProjector` 的形式加入 fixed projector set
- **AND** timeline 权威执行 span MUST 只由 trace-aware stores 接入
- **AND** business path MUST NOT 新增 direct trace sink

#### Scenario: OTel metrics 通过既有 MetricsProjector 接入

- **WHEN** `MetricsProjector` 需要把 sample 写到 OpenTelemetry
- **THEN** projector MUST 继续通过 `MetricsRegistry` 抽象写入
- **AND** business path 与 wrappers MUST NOT 直接调用 OTel Meter API

#### Scenario: gateway implementation 保持不变

- **WHEN** 系统落地 OTel trace / metric adapter
- **THEN** `agent-platform-gateway-local` 与 `agent-platform-gateway-remote` 的实现逻辑、public port、Record、SQLite schema、持久化路径和 transport 行为 MUST 保持不变
- **AND** gateway 相关 observability 语义 MUST 只通过 `agent-app` / `agent-observability` owning decorator、wrapper 与 projector 实现

#### Scenario: 权威执行 span 通过持久化装饰器接入

- **WHEN** 权威执行 lifecycle event 被持久化
- **THEN** trace-aware store MUST 在 gateway 写入前创建或解析 timeline 权威执行 span 并写入关联
- **AND** 业务 path MUST NOT 直接调用 tracer

#### Scenario: 辅助 span 和 metrics 保留 observation handoff

- **WHEN** system/gateway observation 或 metric observation 被处理
- **THEN** `TraceProjector` 或 `MetricsProjector` MUST 继续通过 projector host 消费
- **AND** timeline lifecycle decorator MUST NOT 替代 metric、log、audit 或 health projector

#### Scenario: 物理 gateway 保持 OTel-free

- **WHEN** local SQLite gateway 或 remote persistence adapter 保存 timeline 或 terminal transaction
- **THEN** gateway implementation MUST NOT 导入 OTel、创建 span 或解析 W3C 载体
- **AND** gateway MUST 只保存 decorator 提交的 Record

### Requirement: TraceProjector 必须只消费安全 observation 并映射到 OTel trace 语义

`TraceProjector` MUST 只消费已经过 host redaction 和最小结构校验的 `ObservabilityObservationEvent`。持久化 timeline 到 observation 的 mapper MUST 对已经由 timeline lifecycle 拥有 span 投影决策的 request、model、直接 capability、本地 workflow 真实执行节点和 START/END 脚手架 observation 设置 implementation-owned `spanOwner="TIMELINE_LIFECYCLE"`。`TraceProjector` MUST 只对携带该标记的 observation 避让，并 MUST NOT 为它们创建、结束或修改 timeline 权威执行 span，即使 registry 中不存在对应 span。该标记不要求 observation 拥有独立 span；START/END 只复用 request span snapshot。request diagnostic allowlist MUST 固定为 `REQUEST_REJECTED`、`TERMINAL_COMMITTED`、`TERMINAL_FAILED`、`REQUEST_CONTROL_REJECTED`、`PENDING_INPUT_REJECTED` 和 `POLICY_APPLIED`；这些 observation MUST 不设置该标记并 MUST 创建辅助观测 span。

对于 allowlist 中且能够解析 request context 的 system 和 gateway observation，`TraceProjector` MUST 创建辅助观测 span。每个辅助 span MUST 使用 timeline lifecycle registry 中的 request context 作为标准父级，并 MUST 作为 request span 的直接子级。找不到 request context 时，`TraceProjector` MUST 跳过 span 创建并返回有界降级结果，MUST NOT 创建新的 root trace。

request diagnostic allowlist observation 有 request context 时，其辅助观测 span MUST 使用 request span 作为父级；缺少 request context 时 MUST 创建独立诊断 span。该独立 span MUST NOT 注册为 request 权威执行 span、写入 timeline、参与 `previewSpanIds` 或成为出站传播父级。

辅助 span MUST 使用 INTERNAL SpanKind，不进入 execution registry、不写 timeline、不参与 `previewSpanIds`、不进入 active execution scope、不成为出站传播父级，并 MUST 省略高基数 `eventId`。gateway 辅助 span MUST NOT 使用 SERVER 表示 sandbox 或物理出站调用。Trace 语义 MUST 对齐 OpenTelemetry 1.9.0；跨进程传播 MUST 使用 W3C Trace Context，导出 MUST 使用 OTLP traces。异步 fan-out、replay 或 projector handoff 需要关联 source context 时，`TraceProjector` MUST 使用 implementation-owned SpanContext carrier 创建 span link，MUST NOT 使用 consumer-local AsyncLocalStorage 伪造 parent。

`TraceProjector` MUST NOT 修改 runtime timeline、gateway Record、消息、公共 DTO、terminal truth 或 audit truth。除受控 `RunTimelineEventRecord.inlinePayload.trace` 外，`traceId`、`spanId`、SpanContext、tracer、span 或 exporter 类型 MUST NOT 进入 `agent-contracts`、gateway Record、message metadata 或 public DTO。

#### Scenario: timeline 已拥有的 lifecycle 不产生重复 span

- **WHEN** `TraceProjector` 收到携带 `spanOwner="TIMELINE_LIFECYCLE"` 的 lifecycle observation
- **THEN** 它 MUST NOT 创建、结束或修改 timeline 权威执行 span
- **AND** timeline lifecycle registry 中的 span MUST 保持唯一权威执行 span

#### Scenario: 请求拒绝诊断继续保留

- **WHEN** `TraceProjector` 收到 request diagnostic allowlist 中没有 timeline span owner 的 observation
- **THEN** 它 MUST 继续按既有安全投影规则处理该 observation
- **AND** 它 MUST NOT 因 request_lifecycle boundary 被整体屏蔽
- **AND** request context 缺失时 MUST 创建不进入权威 registry 的独立诊断 span

#### Scenario: system 和 gateway span 挂在 request 下

- **WHEN** allowlist system 或 gateway observation 携带可解析的 requestRunId
- **THEN** `TraceProjector` MUST 创建 request span 的直接子 span
- **AND** 该辅助 span MUST NOT 成为 model、capability 或 workflow node 的子 span

#### Scenario: system 和 gateway 缺少 request context 不创建新 trace

- **WHEN** allowlist system 或 gateway observation 的 requestRunId 无法在共享 registry 或 tombstone 中解析
- **THEN** `TraceProjector` MUST 返回有界降级结果
- **AND** 它 MUST NOT 以 ROOT_CONTEXT 创建 span
- **AND** 本 Scenario MUST NOT 改变 request diagnostic allowlist 缺少 request context 时创建独立诊断 span 的规则

#### Scenario: TraceProjector 只使用安全 attributes

- **WHEN** `TraceProjector` 创建辅助 span
- **THEN** 它 MUST 只使用 allowlist 中的稳定引用、安全原因码、持续时间、用量和低基数诊断字段
- **AND** prompt、content、input、output、工具参数或结果、路径、凭据、token、附件内容、trace 载体原文和 eventId MUST NOT 成为辅助 span attribute

#### Scenario: TraceProjector 只使用 allowlist attributes

- **WHEN** TraceProjector 把 observation 映射到辅助 OTel span attributes
- **THEN** 它 MUST 只使用低基数、policy-approved 的 owner scope、stable refs、safe reason code、duration、usage 和 diagnostic candidates
- **AND** raw prompt、content、tool args/result、path、credential、token、attachment content、trace carrier 原文和自由文本原因 MUST NOT 成为 span attribute

#### Scenario: trace context 不改变权威业务事实

- **WHEN** TraceProjector 创建辅助 span、span event 或 span link
- **THEN** runtime timeline、terminal commit、audit truth、message store 和 request truth MUST 保持不变
- **AND** 缺失或损坏的 trace propagation metadata MUST NOT 回填或改写业务事实

### Requirement: Metrics sink/output 必须保持既有 metric inventory 与标签策略

unified `MetricsRegistry` 的 local/remote sink/output MUST 继续复用 `agent-runtime-metrics` 已冻结的 metric inventory、label allowlist、dedup 语义和 `SurfaceProjectionResult` 行为。remote OTel sink MAY 把 sample 写到 OpenTelemetry Meter API，local sink MAY 把 bounded diagnostics 写到 `nextagent-observability.log`，但 MUST NOT 改变 `MetricName`、allowed labels、high-cardinality 禁止项或 `MetricsProjector` 的 acquisition / precedence contract。

#### Scenario: remote OTel sink 不改变 label policy

- **WHEN** `MetricsProjector` 通过 unified `MetricsRegistry` 写 metric，且 registry 选择 remote OTel sink
- **THEN** invalid label、invalid value 和 duplicate sample MUST 继续按既有 contract 返回 degraded / skipped outcome
- **AND** request id、run id、session id、tenant id、subject id、path、trace id、span id 或动态 payload 不得成为 metric labels

#### Scenario: local 与 remote sink 可替换

- **WHEN** `agent-app` 在 composition 时为 unified `MetricsRegistry` 选择 local sink 或 remote OTel sink
- **THEN** `MetricsProjector` 的输入 observation、输出 outcome 和 failure semantics MUST 保持一致
- **AND** 这种替换不得要求业务 package 修改调用方式或切换 registry 类型

#### Scenario: local sink 直接输出 observability log

- **WHEN** `agent-app` 为 unified `MetricsRegistry` 选择 local sink
- **THEN** 该实现 MAY 直接把有界 metric diagnostics 写入 `nextagent-observability.log`
- **AND** 这种直接日志输出 MUST 不改变 metric inventory、labels、dedup 语义或业务模块调用方式

### Requirement: OTel adapter failures 必须有界且不阻塞主流程

Tracer / meter unavailable、provider 未初始化、attribute serialization failure、export handoff failure、propagation parse failure 或 projector runtime exception MUST NOT 改变 request lifecycle、stream projection、gateway call、health response、terminal commit 或其它 observability surfaces。TRACE / METRIC surface MUST 返回 bounded degraded / failed-closed outcome，并保持其它 covered projectors 继续处理同一 observation。

#### Scenario: TraceProjector 失败不阻塞其它 surfaces

- **WHEN** 同一个 observation 的 TraceProjector 抛出异常或 tracer unavailable
- **THEN** TRACE surface MUST 返回 degraded 或 failed_closed
- **AND** LOG、AUDIT、METRIC、HEALTH 等其它 covered surfaces 仍 MUST 继续尝试处理该 observation

#### Scenario: remote OTel sink 不可用时主流程继续

- **WHEN** unified `MetricsRegistry` 选择了 remote OTel sink 且 meter/provider 不可用
- **THEN** `MetricsProjector` MUST 返回 degraded 或 failed_closed
- **AND** request terminal truth、user-visible result 和 audit / log truth MUST 保持不变

### Requirement: Span Resource MUST 由 tracer provider 统一设置

NextAgent span 的 OTel Resource MUST 由 `agent-observability` tracer provider 从可信应用配置和资源检测器统一设置。Resource MUST 至少包含 `service.name`；配置或运行环境提供有效值时，MUST 设置 `service.version`、`service.instance.id`、deployment environment、pod、namespace 和容器资源属性。

timeline event、任务 metadata、模型输出、能力参数和 observation payload MUST NOT 提供或覆盖 Resource。远端 CLIP、模型、工具和 RAG 服务 MUST 上报自身 Resource；NextAgent MUST NOT 把本地 pod 或 service identity 作为下游 Resource 传播。

#### Scenario: 节点 event 不覆盖 pod resource

- **WHEN** 工作流节点 lifecycle payload 包含名为 podName 或 serviceName 的业务字段
- **THEN** timeline 权威执行 span Resource MUST 保持 tracer provider 配置值
- **AND** 业务字段 MUST NOT 成为 Resource attribute

### Requirement: 执行 trace MUST 与 OTLP exporter 独立启用

系统配置 MUST 接受 OPTIONAL `observability.tracing.enabled`。显式 `false` MUST 关闭进程内 span、timeline trace enrichment、W3C 传播和 OTLP exporter。显式 `true` MUST 启用进程内 span、timeline enrichment 和 W3C 传播，不论 exporter 是否配置。

`endpoint`、`authPkRef` 和 `authSkRef` MUST 全部存在或全部缺失；仅存在一项或两项时，应用配置 MUST 在监听端口启动前校验失败。`enabled=true` 且三项全部缺失时，系统 MUST 使用不导出的 tracer provider。`enabled` 缺失且三项全部存在时 MUST 保持自动启用；两者均缺失时 MUST 关闭 trace。

`agent-observability` infrastructure factory MUST 返回 provider 初始化后的最终 `traceEnabled`。`agent-app` MUST 在 Task Channel composition 前完成初始化，并 MUST 把该值作为不可变布尔策略注入 Task Channel。Task Channel MUST 只使用该策略决定是否映射已校验 eventId，MUST NOT 导入 OTel、读取 exporter 状态或自行解释 tracing config。

#### Scenario: 无 exporter 时仍生成关联

- **WHEN** `observability.tracing.enabled=true` 且 exporter 三项全部缺失
- **THEN** timeline 权威执行 span、timeline trace 和下游 W3C MUST 可用
- **AND** 系统 MUST 不尝试远程导出

#### Scenario: 显式关闭覆盖 exporter

- **WHEN** `observability.tracing.enabled=false` 且 exporter 配置完整
- **THEN** 系统 MUST 不创建或导出 span
- **AND** 系统 MUST 不绑定、保存或恢复 taskEventId
- **AND** timeline MUST 省略 `attributes.eventId`，下游 MUST 省略 `x-task-event-id`

#### Scenario: 部分 exporter 配置启动失败

- **WHEN** endpoint、authPkRef 和 authSkRef 中恰好存在一项或两项
- **THEN** 配置校验 MUST 失败
- **AND** 请求监听器和 exporter MUST 不启动

### Requirement: OTel metrics adapter has one reader policy and deployment-specific exporters

Unified MetricsRegistry and OpenTelemetry Meter adapter MUST continue to reuse the single MetricDescriptor inventory, label allowlist, bounded recent-fact dedup semantics and SurfaceProjectionResult behavior frozen by agent-runtime-metrics. Descriptor kind/unit/labels/source MUST create each NextAgent-owned business OTel instrument and all such seconds histograms MUST use the frozen explicit boundary vector. Production registry composition MUST be streaming-only and MUST NOT retain/replay raw samples; test composition MAY explicitly inject the test-only in-memory registry/exporter. Metrics MUST NOT be implemented as operational log entries, and output selection MUST NOT introduce `metric_diagnostic` or reuse StructuredLogEntry.

Official `@opentelemetry/instrumentation-http` server instruments SHALL be the sole narrow exception to descriptor-owned instrument creation. They MUST be registered with this same MeterProvider, use stable HTTP semantic conventions and their package-owned `http.server.request.duration` instrument definition, and MUST NOT be copied into a parallel NextAgent descriptor or adapter. The SDK pipeline MUST NOT export the removed `web_request_total` or `web_request_duration_seconds` instruments.

`agent-observability` SHALL own the MeterProvider, PeriodicExportingMetricReader and bounded force-flush/shutdown lifecycle. The reader SHALL use a 60-second export interval, 10-second export timeout, cumulative temporality, explicit-bucket histograms and a cardinality limit of 200 per instrument. Product deployment profiles SHALL be:

- test: injected in-memory exporter;
- LOCAL: `LocalMetricHistoryExporter` appending cumulative snapshots to a bounded daily NDJSON file family;
- REMOTE/PaaS: injected official OTLP metric exporter writing to the platform collector/service.

`agent-app` SHALL create the shared SDK pipeline after trusted config is frozen. LOCAL product composition SHALL create `LocalMetricHistoryExporter` from `paths.logDirectory`; REMOTE product composition SHALL consume a trusted entrypoint-injected `PushMetricExporter`; test composition SHALL explicitly use the in-memory exporter. REMOTE without an injected exporter SHALL expose metrics degraded and MUST NOT select the LOCAL exporter.

#### Scenario: OTel meter adapter preserves metric policy

- **WHEN** MetricsProjector writes through MetricsRegistry and OTel Meter adapter
- **THEN** invalid labels/values and duplicate samples MUST keep existing outcomes
- **AND** request/run/session/tenant/subject/agent/path/host/trace/span ids MUST NOT become metric labels or exported resource identity

#### Scenario: Exporter selection does not alter acquisition

- **WHEN** composition selects test, LOCAL file or REMOTE/PaaS OTLP output
- **THEN** MetricsProjector input, inventory, labels, dedup and OTel instruments MUST remain unchanged
- **AND** business packages MUST remain unaware of exporter type

#### Scenario: SDK composition uses descriptor-owned instruments

- **WHEN** app composition creates counters and histograms
- **THEN** name, kind, unit and allowed labels MUST come from one MetricDescriptor inventory
- **AND** duration histograms MUST use the frozen explicit buckets
- **AND** SDK defaults MUST NOT silently change aggregation boundaries after a dependency upgrade

#### Scenario: SDK composition registers standard HTTP server metrics

- **WHEN** agent-observability creates the product MeterProvider
- **THEN** it MUST bind official HTTP instrumentation to that provider with stable semantic conventions and outgoing instrumentation disabled
- **AND** the resulting `http.server.request.duration` MUST flow through the same reader, resource and deployment-selected exporter
- **AND** no second provider or legacy custom HTTP instrument may be created

### Requirement: Local metric exporter appends bounded cumulative snapshots to an aged daily history

LOCAL deployment SHALL export to the metrics-owned file family `<paths.logDirectory>/nextagent-metrics.<YYYY-MM-DD>.<sequence>.ndjson`. Each successful 60-second collection SHALL append exactly one `NextAgentMetricSnapshotV1` JSON line representing the complete cumulative ResourceMetrics collection. The history MUST contain periodic aggregate snapshots, not raw MetricSample events.

The snapshot SHALL contain:

- `schemaVersion: 1` and ISO `exportedAt`;
- low-cardinality `resource` fields limited to service name, service version and deployment mode;
- NextAgent descriptor-owned metrics plus official `http.server.request.duration`, each with stable name, kind, unit, cumulative temporality and aggregated data points;
- each point's allowed labels, start/end time and counter value or bounded explicit-bucket histogram values.

It MUST omit exemplars and tenant/subject/agent/session/request/run/message/capability/task/trace/span/path/host/credential/token/content fields. Metric and point ordering SHOULD be deterministic for local inspection and testing.

The exporter SHALL serialize a complete line in memory before enqueue. Its UTF-8 serialized bytes, including the newline delimiter, MUST NOT exceed 4 MiB. The metrics destination SHALL use an implementation-owned 8 MiB asynchronous buffer; enqueue MUST NOT wait for drain or grow the buffer. Oversize, saturation or write failure MUST fail that export without committing a partial line and without changing business behavior.

`LocalMetricHistoryExporter` SHALL directly own its normalization/schema, metrics policy, writer buffer policy, single-flight and export failure mapping. It SHALL create one independent `agent-local-file-roll` handle for the destination, derived exact selector, rotation, gzip reconciliation, retention and close. The family SHALL use base `nextagent-metrics.ndjson`, `dateFormat=yyyy-MM-dd`, fixed `frequency=daily`, fixed `size=30m`, gzip closed segments through `.gz.tmp` plus atomic rename, startup reconciliation, closedAt-based retention 7 days and at most 10 committed gzip archives. Daily rotation and `YYYY-MM-DD` SHALL use the Node.js process-local timezone fixed for the process lifetime; retention SHALL use elapsed `7 * 24h` from `closedAt`, including across DST transitions. Archive count cleanup SHALL independently delete the oldest exactly owned archive by `mtime` and then file name. The physical extension-last pattern SHALL be `nextagent-metrics.<YYYY-MM-DD>.<sequence>.ndjson[.gz]`. Multiple collections in one day MUST reuse the active segment unless size rotation occurs; one file per collection is forbidden.

Operational, metrics and LOCAL audit file owners SHALL share only the `agent-local-file-roll` factory/mechanism code and MUST create separate handles. They MUST NOT share destination, active identity, buffer, timer, maintenance lane, mutable state, close state or policy object. Derived selectors MUST be mutually exclusive: operational maintenance MUST ignore every metrics/audit active/source/archive/temp file, `LocalMetricHistoryExporter` maintenance MUST ignore operational, audit, developer-trace, symlink, unknown and out-of-directory files, and the LOCAL audit gateway MUST likewise ignore operational and metrics files. Concurrent export attempts MUST be single-flight or coalesced. A state transition to degraded or recovered MAY produce one safe component diagnostic; successful periodic exports and individual samples MUST NOT produce operational logs.

#### Scenario: First local export appends a snapshot

- **WHEN** the first periodic collection succeeds in LOCAL mode
- **THEN** the active metrics `.ndjson` segment MUST contain one valid `NextAgentMetricSnapshotV1` line
- **AND** it MUST contain aggregated OTel points rather than raw per-operation samples

#### Scenario: Local append fails safely

- **WHEN** serialization, enqueue, write or rotation fails
- **THEN** the exporter MUST report export failure without throwing into business paths
- **AND** previous complete lines and archives MUST remain readable
- **AND** no partial snapshot line may be committed

#### Scenario: Local history rotates and ages

- **WHEN** the active metrics segment reaches 30 MiB, crosses the daily boundary or commits an eleventh gzip archive
- **THEN** the exporter-owned destination MUST select a new active sequence without blocking business paths
- **AND** the closed segment MUST be gzip archived and retained for 7 days
- **AND** startup reconciliation MUST complete eligible archive/aging work after downtime
- **AND** successful maintenance MUST leave no more than 10 committed metrics gzip archives

#### Scenario: Local metric file crosses a timezone boundary

- **WHEN** the controlled process-local calendar crosses midnight, including a daylight-saving transition
- **THEN** the active metrics segment MUST rotate and use the new local `YYYY-MM-DD`
- **AND** archive expiry MUST remain based on elapsed time from `closedAt`

#### Scenario: Operational maintenance sees metrics files

- **WHEN** operational archive/retention maintenance scans `paths.logDirectory`
- **THEN** it MUST ignore all `nextagent-metrics.<date>.<sequence>.ndjson[.gz][.tmp]` family members
- **AND** the metrics exporter MUST never modify operational, audit or developer-trace files

### Requirement: PaaS metrics use the official OTLP exporter without local fallback

The REMOTE/PaaS deployment entrypoint SHALL create and inject `@opentelemetry/exporter-metrics-otlp-proto`. The remote package SHALL resolve endpoint by the standard signal-specific/general precedence `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` then `OTEL_EXPORTER_OTLP_ENDPOINT`; optional headers, compression and timeout SHALL follow the corresponding OTel environment-variable precedence. Missing explicit PaaS endpoint SHALL degrade metrics readiness instead of silently using the localhost default. Raw endpoint/header values MUST NOT enter startup proof, logs, metrics or safe errors.

The remote package SHALL construct an allowlisted Resource containing only service name, service version and deployment mode; it MUST NOT pass arbitrary `OTEL_RESOURCE_ATTRIBUTES` through to exported metrics. `agent-app` core MUST NOT import the concrete OTLP package or read exporter endpoint/credential values.

REMOTE/PaaS composition MUST NOT create a `nextagent-metrics.*` family, expose a Prometheus endpoint or fall back to RuntimeLogger/file output when OTLP is unavailable. This change owns exporter composition and lifecycle evidence but does not deploy, configure or operate the external OpenTelemetry Collector/service.

#### Scenario: Remote deployment exports through OTLP

- **WHEN** the remote entrypoint supplies a valid OTLP metric exporter
- **THEN** the shared periodic reader MUST send the same metric instruments to that exporter
- **AND** package evidence MUST identify OTLP as selected without exposing endpoint or credential values

#### Scenario: Remote endpoint is absent

- **WHEN** neither the signal-specific nor general OTLP endpoint is present for REMOTE/PaaS startup
- **THEN** metrics readiness MUST be degraded with a bounded safe reason
- **AND** the exporter MUST NOT silently target the SDK localhost default
- **AND** app business readiness and behavior MUST remain unchanged

#### Scenario: OTLP export fails

- **WHEN** the OTLP endpoint is unavailable or export times out
- **THEN** metrics readiness MUST become bounded degraded
- **AND** no local metrics file or per-sample operational log fallback may be created
- **AND** prior business outcomes MUST remain unchanged

### Requirement: OTel adapter lifecycle is bounded and independent

MetricReader/exporter collect, enqueue, rotation, gzip, retention, force-flush and shutdown operations MUST be owned by observability/infrastructure composition and MUST have bounded timeout behavior. They MUST NOT be awaited from request/model/capability business paths. After trusted config is frozen, operational writer and deployment audit infrastructure SHALL start before the MeterProvider/reader/exporter, and the metrics pipeline SHALL start before projectors/business producers. During app shutdown, all producers and the projector host SHALL stop/drain and the audit gateway SHALL be bounded-closed before metrics finalization; metrics force-flush/provider-reader-exporter shutdown and `LocalMetricHistoryExporter` file-lifecycle close SHALL complete or time out before the final app shutdown diagnostic and operational writer close. Operational writer SHALL be the last normal output domain closed. Local file lifecycle failure MUST preserve recoverable source/archive evidence and MAY degrade only its owning output readiness.

Every producer, audit, metrics and operational finalizer SHALL run from an independent failure-isolation boundary. An earlier audit/producer close failure MUST NOT skip metrics shutdown or operational flush/close, and an audit/metrics degraded transition MAY use the still-open component RuntimeLogger before operational close without including payload.

#### Scenario: Metric flush times out

- **WHEN** local history or PaaS OTLP exporter cannot flush during shutdown
- **THEN** shutdown handling MUST remain bounded
- **AND** the failure MUST NOT trigger synchronous file/log fallback or change prior business outcomes

#### Scenario: Metrics finalization precedes operational close

- **WHEN** app shutdown reaches observability finalization
- **THEN** metrics force-flush/shutdown and `LocalMetricHistoryExporter` file-lifecycle close MUST be attempted first within bounded timeouts
- **AND** the operational writer MUST remain available for one bounded metrics degradation transition
- **AND** operational flush/close MUST run last even when metrics finalization fails
