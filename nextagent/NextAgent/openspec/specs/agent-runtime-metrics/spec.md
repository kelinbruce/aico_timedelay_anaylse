# agent-runtime-metrics Specification

## Purpose
定义统一 observation stream 上的运行时 metrics inventory、label policy、dedup 语义，以及 unified `MetricsRegistry` 在 local log sink 与 remote OTel sink 之间的可替换输出边界。

## Function

- **所属 Function**：`FN-7.5 采集指标`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: METRIC surface 必须消费统一 observation stream

Runtime metrics SHALL 消费 `add-ts-trace-log-linking` 产生的 `ObservabilityObservationEvent`。runtime listener、wrapper taxonomy、source precedence、dedup 和 `ObservabilityProjectorHost.acceptObservation(event): void` 仍由 `add-ts-trace-log-linking` 拥有。

`MetricsProjector` SHALL 作为 `ObservabilityProjectorHost` 异步调用的 fixed projector。业务 package 不得 import metrics registry、metric names、label taxonomy、tracer 或 observability SDK。

#### Scenario: Metrics 使用 host handoff 路径
- **WHEN** runtime listener、wrapper、middleware 或 system producer 创建 observation
- **THEN** metrics 只能通过 `MetricsProjector` 写出
- **AND** wrappers 和业务模块不得直接写 registry samples

### Requirement: Metric domain objects 必须有稳定语义

`MetricDescriptor` SHALL 定义 metric name、type、unit、allowed labels、value source 和 acquisition source。`MetricSample` SHALL 包含 name、type、有限非负 value、allowed labels、occurredAt 和 dedup key。`MetricsRegistry` SHALL 是 `agent-observability` owning 的 implementation-local output target abstraction；它 MUST 保持单一 registry 主逻辑，并允许 `agent-app` composition 只通过切换 sink/output 策略来选择 local log 输出或 remote OTel 输出，但 MUST NOT 改变 `MetricsProjector` 的输入 observation、output outcome、metric inventory、label taxonomy、dedup 语义或 degraded / failed-closed contract。local sink MAY 作为默认本地/测试实现直接把 bounded metric diagnostics 写入 `nextagent-observability.log`；这种日志写入属于 registry implementation 细节，不得改变 metric contract。`MetricProjectionResult` SHALL 固定为 `emitted`、`skipped_not_covered`、`skipped_policy_denied`、`degraded` 或 `failed_closed`。

Metric descriptors、samples 和 registry types SHALL 保留在 `agent-observability` 内部，不得通过 `agent-contracts` 导出。OTel meter、counter、histogram、provider 或 exporter 类型同样不得进入 `agent-contracts`、runtime、core、model、capability、gateway 或 channel public contract。

#### Scenario: Metrics 不进入 core contracts
- **WHEN** metrics implementation 被添加
- **THEN** `agent-contracts` 不暴露 metric descriptors、samples、registry 或 label taxonomy

#### Scenario: remote OTel sink 保持 projector contract
- **WHEN** `MetricsProjector` 使用 unified `MetricsRegistry` 且其 remote OTel sink 被启用
- **THEN** projector MUST 继续只通过 `MetricsRegistry` 抽象写入 sample
- **AND** 同一个 observation 的 `SurfaceProjectionResult` 语义 MUST 与 local sink 保持一致

#### Scenario: sink/output 可替换但行为不可漂移
- **WHEN** `agent-app` 在 composition 时为 unified `MetricsRegistry` 从 local sink 切换到 remote OTel sink
- **THEN** metric name、allowed labels、dedup key、invalid label/value 处理和 high-cardinality 拒绝语义 MUST 保持不变
- **AND** business owner packages 不得因 sink/output 切换而修改调用方式或切换 registry 类型

#### Scenario: local sink 直接写 observability log 时仍保持 contract
- **WHEN** unified `MetricsRegistry` 的 local sink 把 metric diagnostics 直接写到 `nextagent-observability.log`
- **THEN** 该输出 MUST 只包含 bounded metric contract 可导出的名称、标签和值
- **AND** 这种实现细节不得让 `MetricsProjector`、wrappers 或业务 owner 直接依赖日志写入成功

### Requirement: Metric inventory 必须声明来源、标签和增强需求

METRIC surface SHALL 维护 stable inventory。每个 metric SHALL 声明 type、value、allowed labels、preferred input、fallback input、dedup key 和 event enhancement requirements。

`FN-7.5` owning 的 inventory SHALL 包含：

| Metric | Type | Labels | Preferred input | Fallback input |
|---|---|---|---|---|
| `request_outcome_total` | counter | `status` | terminal timeline observation | none |
| `request_duration_seconds` | histogram | `status` | terminal observation with duration candidate | runtime terminal wrapper if event lacks duration |
| `request_phase_duration_seconds` | histogram | `phase`, `status` | runtime lifecycle observation | runtime lifecycle typed adapter |
| `request_first_content_latency_seconds` | histogram | `outcome` | `REQUEST_FIRST_CONTENT_DELIVERED` timeline-derived observation | none |
| `request_token_count` | histogram | `token_type`, `status` | terminal request aggregation | none |
| `request_active_concurrency` | histogram | none | runtime execution-state observation | none |
| `request_abnormal_termination_total` | counter | none | failed terminal timeline observation | none |
| `operation_timeout_total` | counter | `boundary` | authoritative operation terminal observation | none |
| `model_flow_control_total` | counter | none | terminal model rate-limit observation | none |
| `model_invocation_total` | counter | `outcome` | terminal model invocation observation | none |
| `model_invocation_duration_seconds` | histogram | `outcome` | terminal model invocation observation with `durationMs` | none |
| `model_token_usage_total` | counter | `token_type`, `outcome` | terminal model invocation observation with `usage` | none |
| `model_token_count` | histogram | `token_type`, `outcome` | terminal model invocation observation with `usage` | none |
| `model_output_token_rate` | histogram | `outcome` | terminal model invocation observation with output usage and stream timing | none |
| `model_ttft_seconds` | histogram | `outcome` | normalized visible stream observation | normalized stream wrapper |
| `model_chunk_latency_seconds` | histogram | none | normalized visible stream observation | normalized stream wrapper |
| `model_total_latency_seconds` | histogram | `outcome` | normalized terminal stream observation | normalized stream wrapper |
| `capability_invocation_total` | counter | `capability_kind`, `outcome` | `CAPABILITY_COMPLETED` observation | capability wrapper |
| `capability_invocation_duration_seconds` | histogram | `capability_kind`, `outcome` | `CAPABILITY_COMPLETED` with `durationMs` | capability wrapper |
| `gateway_call_total` | counter | `gateway_category`, `outcome` | gateway authoritative observation | `GatewayPort` wrapper |
| `gateway_call_duration_seconds` | histogram | `gateway_category`, `outcome` | gateway authoritative observation | `GatewayPort` wrapper |
| `observability_degradation_total` | counter | `surface`, `reason_code` | shared degradation observation | none |
| `projector_projection_total` | counter | `surface`, `result` | projector host outcome observation | none |

Official instrumentation 或其他 Function owning 的指标 SHALL 继续由各自 stable Requirement 定义，不得为把它们列入本 inventory 而创建重复 descriptor 或重复 sample。

model metrics MUST NOT 使用 `modelId`、`providerId`、provider implementation class 或等价 provider category label。模型 identity 和 provider binding 的变化 MUST NOT 改变同一 outcome、usage 或 timing fact 的 metric name、value、dedup 或 emission behavior。

Metric acquisition MUST NOT 要求新增 `TimelineEventType`。Model invocation 的 duration、usage、首字符时序和终态 MUST 来自同一模型调用的 canonical observation。request、model、capability、gateway、observability degradation、projector outcome 和 normalized stream timing MUST 进入同一 observation stream；运行时执行态的排队与并发事实 MUST 通过 narrow typed observation 进入该 stream，不得由日志反向推断。

**需求类别**：功能性需求

#### Scenario: Inventory 可回答目标统计
- **WHEN** 运维人员读取一个完成聚合的指标时间窗
- **THEN** inventory MUST 提供模型调用、模型时序、模型 token、对话、排队、并发、异常终止、超时和流控的对应指标
- **AND** 同一 stable fact MUST NOT 通过 preferred input 与 fallback input 重复计数

#### Scenario: 外部 owning 指标不被重复声明
- **WHEN** official instrumentation 或其他 Function 已定义一个指标
- **THEN** `FN-7.5` inventory MUST NOT 为该指标创建平行 descriptor 或重复 sample

#### Scenario: 模型指标不按 provider 分组
- **WHEN** 两次模型调用使用不同 `modelId` 或 `providerId` 但产生相同 outcome
- **THEN** model metric samples MUST 使用相同 label schema
- **AND** metrics MUST NOT 根据 provider identity 推断或生成 category label

### Requirement: Metric labels 必须低基数且固定

Metric labels SHALL 只使用 descriptor 声明的 keys 和 values。request id、run id、session id、message id、tenant id、subject id、path、prompt、content、raw provider name、raw endpoint、`modelId`、`providerId`、free-text reason、secret、credential、trace id/span id 或 dynamic payload MUST NOT 作为 labels。

首版 allowed label vocabularies SHALL 包含：

- `entrypoint`: `health_primary`, `health_deep`, `submit`, `stream`, `history`, `other`
- `status_family`: `2xx`, `3xx`, `4xx`, `5xx`
- `status`: `COMPLETED`, `FAILED`, `CANCELED`, `SUPERSEDED`
- `phase`: `accepted`, `queued`, `executing`, `terminal_commit`
- `capability_kind`: `TOOL`, `SKILL`, `AGENT`
- `gateway_category`: `local`, `remote`, `model_provider`, `content`
- `outcome`: `success`, `failure`, `timeout`, `canceled`, `denied`, `degraded`, `no_first_token`
- `token_type`: `input`, `output`, `total`
- `surface`: `LOG`, `AUDIT`, `METRIC`, `HEALTH`, `TRACE`
- `result`: `emitted`, `skipped_not_covered`, `skipped_policy_denied`, `degraded`, `failed_closed`

**需求类别**：系统质量属性
**质量属性**：性能/容量
**适用范围**：该 Function

#### Scenario: High-cardinality labels 被拒绝
- **WHEN** metric sample 尝试使用 `requestRunId`、`tenantId`、path、`modelId`、`providerId` 或 free-text reason 作为 label
- **THEN** sample MUST 被拒绝或降级
- **AND** 业务 outcome MUST 保持不变

#### Scenario: Provider category 不构成 metric label
- **WHEN** model observation 被投影为 model metrics
- **THEN** model metrics MUST 继续按 inventory 产生 samples
- **AND** 系统 MUST NOT 合成 `provider_kind=OTHER` 或其他替代 label
- **AND** `model_total_latency_seconds` sample MUST 只包含 `outcome`

### Requirement: Metrics 必须从 observation 受控生成

`MetricsProjector` SHALL 只从 observation fields 和 approved diagnostic candidates 生成 samples。写 registry 前必须校验有限非负 value、allowed labels 和 dedup key。较低优先级 fallback source 在较高优先级 observation 已经为同一 stable fact key 写出或产生 projection outcome 后，不得再写同一 metric。

#### Scenario: Event-derived sample 抑制 wrapper duplicate
- **WHEN** model completed event observation 和 model wrapper observation 描述同一 model invocation
- **THEN** event-derived metric source 获胜
- **AND** wrapper 不写重复 invocation 或 duration samples

### Requirement: Model stream metrics 必须使用 normalized visible facts

Model TTFT 和 chunk latency metrics SHALL 只使用 normalized visible stream observations。它们不得使用 prompt、provider raw deltas、raw content text、logs 或 offline replay。no-first-token outcome SHALL 作为 terminal model outcome 统计，不生成正常 TTFT sample。

#### Scenario: No-first-token 跳过 TTFT
- **WHEN** model invocation 在任何 normalized visible content event 产生前结束
- **THEN** `model_ttft_seconds` 不写出
- **AND** model total outcome 可以使用 `outcome=no_first_token`

### Requirement: Request 首个内容交付时延必须从 request accepted 测量到首个可见内容

`TimelineObservationMapper` MUST 在首次 `LLM_CONTENT_DELTA` 或 `LLM_THINKING_DELTA` per run 时产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation。该首条 observation 的 `durationMs` MUST 等于该 `LLM_CONTENT_DELTA` 或 `LLM_THINKING_DELTA` 的 `createdAt` 减去该 run 的 `REQUEST_ACCEPTED` 的 `createdAt`。该 observation 的 `boundary` MUST 为 `request_lifecycle`，`outcome` MUST 为 `success`。

同一 run 后续的 `LLM_CONTENT_DELTA` 或 `LLM_THINKING_DELTA` MUST NOT 重复产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation。多轮 agent loop 中只产出一次（以首次内容或思考交付为准），不随每轮 model invocation 重复。

若 `REQUEST_ACCEPTED` 的 `acceptedAt` 未被 mapper 记录（例如 replay 时 mapper 未消费该 run 的 accepted event），`LLM_CONTENT_DELTA` 或 `LLM_THINKING_DELTA` MUST NOT 产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation。

若 run 无 `LLM_CONTENT_DELTA` 或 `LLM_THINKING_DELTA` 终止，`REQUEST_FIRST_CONTENT_DELIVERED` observation MUST NOT 产出，`request_first_content_latency_seconds` metric MUST NOT 生成 sample。

terminal event MUST 按 `firstContentDeliveredByRun` 的 runId 清理该 run 的状态，与 `clearRunState` 对 `modelStartedAtByInvocation` 和 `firstVisibleByInvocation` 的清理一致。

该 observation MUST NOT 包含 prompt、content text、provider raw delta、model output 或高基数字段。`durationMs` 只记录时延。stable refs 只包含 `runId`、`requestId`、`sessionId` 和 `timelineEventId`。

该 observation 产出 MUST NOT 阻塞 timeline event 投影或 request lifecycle 行为。timeline observation 是 non-blocking 的。`durationMs` MUST 经 `Math.max(0, ...)` 钳制。`MODEL_STREAM_FIRST_VISIBLE_CONTENT` observation（per-invocation）只由 `LLM_CONTENT_DELTA` 触发，MUST NOT 由 `LLM_THINKING_DELTA` 触发。

**需求类别**：功能性需求

#### Scenario: 首个 LLM_CONTENT_DELTA 产出 observation
- **WHEN** mapper 收到某 run 的首个 `LLM_CONTENT_DELTA`，且该 run 的 `REQUEST_ACCEPTED` 已被 mapper 处理过，产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation
- **THEN** 必须产出一条 `REQUEST_FIRST_CONTENT_DELIVERED` observation
- **AND** `durationMs` 必须等于 `LLM_CONTENT_DELTA.createdAt - REQUEST_ACCEPTED.createdAt`
- **AND** `boundary` 必须为 `request_lifecycle`
- **AND** `outcome` 必须为 `success`

#### Scenario: 首个 LLM_THINKING_DELTA 产出 observation
- **WHEN** mapper 收到某 run 的首个 `LLM_THINKING_DELTA`，且该 run 的 `REQUEST_ACCEPTED` 已被 mapper 处理过，产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation
- **THEN** 必须产出一条 `REQUEST_FIRST_CONTENT_DELIVERED` observation
- **AND** `durationMs` 必须等于 `LLM_THINKING_DELTA.createdAt - REQUEST_ACCEPTED.createdAt`
- **AND** `boundary` 必须为 `request_lifecycle`
- **AND** `outcome` 必须为 `success`
- **AND** 不得产出 `MODEL_STREAM_FIRST_VISIBLE_CONTENT` observation

#### Scenario: LLM_THINKING_DELTA 已交付后 LLM_CONTENT_DELTA 不重复产出
- **WHEN** mapper 收到某 run 的首个 `LLM_THINKING_DELTA` 并产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation，随后该 run 收到首个 `LLM_CONTENT_DELTA`
- **THEN** 不得再次产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation
- **AND** 该 `LLM_CONTENT_DELTA` 仍 MAY 产出 `MODEL_STREAM_FIRST_VISIBLE_CONTENT` observation（per-invocation，独立于 per-run）

#### Scenario: 首个 LLM_CONTENT_DELTA 同时产出 per-invocation 与 per-run observation
- **WHEN** mapper 收到某 run 的首个 `LLM_CONTENT_DELTA`，该 `LLM_CONTENT_DELTA` 携带有效 `stepId`，且该 run 的 `REQUEST_ACCEPTED` 已被 mapper 处理过，产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation
- **THEN** mapper 返回的 observation 数组必须同时包含 `MODEL_STREAM_FIRST_VISIBLE_CONTENT`（per-invocation，duration = delta - modelStartedAt）和 `REQUEST_FIRST_CONTENT_DELIVERED`（per-run，duration = delta - acceptedAt）
- **AND** 两条 observation 的 `durationMs` 语义不同，不得合并

#### Scenario: stepId 缺失但 REQUEST_ACCEPTED 存在时仍产出 per-run observation
- **WHEN** mapper 收到某 run 的首个 `LLM_CONTENT_DELTA` 或 `LLM_THINKING_DELTA`，该 delta 不携带 `stepId` 或 `activeModelStepByRun` 无对应记录，但该 run 的 `REQUEST_ACCEPTED` 已被 mapper 处理过
- **THEN** 必须产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation
- **AND** 不得产出 `MODEL_STREAM_FIRST_VISIBLE_CONTENT` observation（per-invocation 逻辑依赖 stepId，被跳过）

#### Scenario: 后续 LLM_CONTENT_DELTA 不重复产出
- **WHEN** mapper 收到某 run 的后续 `LLM_CONTENT_DELTA`
- **THEN** 不得再次产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation

#### Scenario: 后续 LLM_THINKING_DELTA 不重复产出
- **WHEN** mapper 收到某 run 的后续 `LLM_THINKING_DELTA`
- **THEN** 不得再次产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation

#### Scenario: 多轮 agent loop 只产出一次
- **WHEN** 同一 run 的第二轮 model invocation 产生首个 `LLM_CONTENT_DELTA`
- **THEN** 不得再次产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation
- **AND** 首轮已产出的 observation 保持该 run 的唯一 first-content observation

#### Scenario: REQUEST_ACCEPTED 缺失时跳过
- **WHEN** mapper 收到某 run 的首个 `LLM_CONTENT_DELTA` 或 `LLM_THINKING_DELTA`，但该 run 的 `REQUEST_ACCEPTED` 未被 mapper 处理过
- **THEN** 不得产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation

#### Scenario: Run 无内容交付时不产出
- **WHEN** run 终止时未产生任何 `LLM_CONTENT_DELTA` 或 `LLM_THINKING_DELTA`
- **THEN** 不得产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation
- **AND** `request_first_content_latency_seconds` 不得生成 sample

#### Scenario: Terminal 清理 per-run 状态
- **WHEN** mapper 收到 `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED`
- **THEN** `firstContentDeliveredByRun` 必须按 runId 清理该项

### Requirement: Metrics failures 必须显式、有界且不影响业务结果

Registry unavailable、invalid label、invalid value、serialization failure、dedup failure 或 projector timeout SHALL NOT 改变 request lifecycle、terminal commit、stream projection、model invocation、capability invocation、gateway call 或 health response。Metrics degradation SHALL 使用 shared bounded degradation model。

#### Scenario: Registry outage non-blocking
- **WHEN** terminal metric projection 时 `MetricsRegistry` 不可用
- **THEN** terminal truth 保持不变
- **AND** METRIC projection 返回 degraded / failed_closed，并留下 safe degradation evidence

### Requirement: Health-owned metrics 由 health change 定义

`add-ts-health-check` SHALL 拥有 health probe metric names、semantic 和 allowed labels。本 change 可以提供 registry 和 generic label validation primitives，但不定义 health evaluator、health endpoint、health response 或 health-owned metric names。

#### Scenario: Health probe metric 只复用 shared registry
- **WHEN** health check 写出 health-owned metric
- **THEN** 它使用本 change 的 registry primitives
- **AND** metric name 和 labels 由 `add-ts-health-check` 定义

### Requirement: Metric domain objects use one inventory and one OTel instrument path

MetricDescriptor SHALL define each NextAgent-owned business metric's name, type, unit, allowed labels, value source and acquisition source. One immutable descriptor inventory MUST be the only source for those business metrics' label validation, sample kind/unit and OTel instrument creation; a parallel `metricPolicies`/instrument definition table is forbidden. Unit policy SHALL be: every NextAgent-owned `*_duration_seconds`, `model_ttft_seconds` and `model_chunk_latency_seconds` histogram uses `s`; `model_token_usage_total` uses `{token}`; every other business counter uses `1`. Every NextAgent-owned seconds histogram SHALL use the explicit boundaries `[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300]`. Official instrumentation-owned instruments use their OpenTelemetry package definition as specified below and MUST NOT be duplicated into this inventory.

MetricSample SHALL contain name, type, finite non-negative value, allowed labels, occurredAt and optional dedup key. Production MetricsRegistry SHALL remain an `agent-observability` implementation-local streaming projection abstraction: it MUST validate through the descriptor inventory and synchronously record approved values to the pre-created OTel instruments, but MUST NOT retain an unbounded or replayable raw `MetricSample[]`, expose production sample history, or attach a late sink by replaying prior samples. A test-only `InMemoryMetricsRegistry` MAY expose `snapshot()` when explicitly injected into test composition; product LOCAL/REMOTE composition MUST NOT select it.

MetricsProjector source-precedence dedup SHALL be bounded recent-fact protection rather than durable idempotency. It SHALL use an implementation-owned FIFO set capped at `16_384` stable dedup keys, evicting the oldest key before accepting a new one at capacity. Preferred and fallback observations for one fact MUST compete within that window. The set MUST NOT grow with process lifetime beyond the cap, and its eviction behavior MUST be deterministic under test.

Metrics output MUST NOT use RuntimeLogger, an observation-bound operational logger or the operational writer. `createLocalMetricsLogSink` and `surface=metric_diagnostic` MUST NOT remain in product/package composition. MetricsRegistry SHALL attach its approved samples to OpenTelemetry instruments through the existing Meter adapter; LOCAL, REMOTE/PaaS and test modes MUST reuse those instruments and differ only at the MetricReader/exporter composition.

MetricProjectionResult SHALL remain `emitted`, `skipped_not_covered`, `skipped_policy_denied`, `degraded` or `failed_closed`.

#### Scenario: Metrics do not enter operational log

- **WHEN** MetricsProjector produces samples in product, package or test composition
- **THEN** samples MUST be recorded only through MetricsRegistry and the OTel Meter adapter
- **AND** no sample MUST be serialized through RuntimeLogger or operational writer
- **AND** operational console/file/archive MUST NOT contain `metric_diagnostic` or metric payload

#### Scenario: Deployment changes only the exporter

- **WHEN** composition changes from test to LOCAL or REMOTE/PaaS deployment
- **THEN** MetricsProjector input, MetricsRegistry policy and OTel instruments MUST remain unchanged
- **AND** only the exporter behind the periodic MetricReader may change

#### Scenario: Production registry does not retain raw samples

- **WHEN** LOCAL or REMOTE product composition records more than one export interval of metric observations
- **THEN** approved values MUST be recorded directly to OTel instruments
- **AND** the production registry MUST NOT accumulate raw samples or replay them to a late sink
- **AND** trend history MUST come only from periodic aggregate exports

#### Scenario: Tests require raw sample assertions

- **WHEN** a test needs to inspect individual projected samples
- **THEN** test composition MUST explicitly inject `InMemoryMetricsRegistry`
- **AND** that fixture MUST NOT become the LOCAL or REMOTE default

#### Scenario: Recent-fact dedup reaches capacity

- **WHEN** the projector accepts more than 16,384 distinct stable dedup keys
- **THEN** the oldest key MUST be evicted before the newest key is inserted
- **AND** dedup memory MUST remain bounded
- **AND** this recent-fact mechanism MUST NOT be represented as durable exactly-once accounting

#### Scenario: Descriptor creates a duration histogram

- **WHEN** the OTel adapter creates any seconds-duration instrument
- **THEN** kind, unit, labels and acquisition metadata MUST come from the single descriptor
- **AND** the frozen seconds bucket vector MUST be applied rather than an SDK-version-dependent default

### Requirement: Metrics deployment uses periodic reader with local file or PaaS OTLP exporter

Product composition SHALL use one OpenTelemetry MeterProvider and one PeriodicExportingMetricReader with implementation-owned `exportIntervalMillis=60_000`, `exportTimeoutMillis=10_000`, cumulative temporality, explicit-bucket histogram aggregation and cardinality limit 200 per instrument.

LOCAL deployment SHALL pair the reader with `LocalMetricHistoryExporter`, which appends one bounded `NextAgentMetricSnapshotV1` JSON line per successful collection to the metrics-owned file family `<paths.logDirectory>/nextagent-metrics.<YYYY-MM-DD>.<sequence>.ndjson`. `LocalMetricHistoryExporter` SHALL directly own this family's schema, policy, single-flight and export-result mapping, and SHALL create one independent `agent-local-file-roll` handle for destination, rotation, gzip reconciliation, retention and close. It MUST NOT use an operational `agent-log` writer or handle. That family SHALL rotate at 30 MiB or the fixed process-local daily boundary, use the same process-local date for `YYYY-MM-DD`, gzip closed segments, retain them for 7 elapsed days from closedAt and keep at most 10 committed gzip archives. Elapsed retention and archive count SHALL be independent deletion conditions. REMOTE/PaaS deployment SHALL pair the same reader policy with an official OTLP metric exporter injected by the remote deployment entrypoint. Test composition MAY use an in-memory exporter. REMOTE/PaaS MUST NOT create or fall back to the local metrics file.

#### Scenario: Local deployment exposes metrics without Prometheus

- **WHEN** a LOCAL app reaches the first successful periodic metric export
- **THEN** the active daily metrics NDJSON segment MUST contain one complete cumulative metrics snapshot line
- **AND** no Prometheus server, scrape endpoint or collector process may be required

#### Scenario: Local deployment preserves a bounded trend

- **WHEN** multiple successful 60-second collections occur across a daily or 30 MiB rotation boundary, or commit an eleventh gzip archive
- **THEN** each collection MUST remain as one ordered snapshot line in the current or closed metrics family
- **AND** closed segments MUST be gzip archived and aged after 7 days
- **AND** one collection MUST NOT create one new metrics file
- **AND** successful maintenance MUST leave no more than 10 committed metrics gzip archives

#### Scenario: PaaS deployment uses OTLP

- **WHEN** deployment mode is REMOTE and the remote entrypoint injects its configured OTLP metric exporter
- **THEN** the periodic reader MUST export to the platform OTLP endpoint
- **AND** no local metrics file or operational-log fallback may be created

### Requirement: Metrics do not enter core contracts

Metric descriptors, samples, registry, MeterProvider, MetricReader, exporter and label taxonomy SHALL remain outside agent-contracts and business package public contracts. runtime/core/model/capability/gateway/channel MUST NOT call an exporter directly. A trusted `agent-app` infrastructure composition option MAY accept a `PushMetricExporter` for REMOTE deployment, but this type MUST remain outside agent-contracts and business owners. `agent-app` core MUST NOT import a concrete OTLP exporter package; the remote deployment entrypoint owns its concrete exporter and resolves standard OTel endpoint/header/compression environment variables. Raw exporter configuration MUST NOT enter core config, startup proof, log or metric fields.

#### Scenario: Business package remains exporter agnostic

- **WHEN** metric deployment changes from LOCAL history files to PaaS OTLP
- **THEN** business package contracts and observation acquisition MUST remain unchanged
- **AND** request/model/capability input MUST NOT select or configure the exporter

### Requirement: Metrics sink/output preserves inventory and label policy

MetricsRegistry and the OTel adapter MUST preserve metric name, allowed labels, invalid-value handling, dedup key and SurfaceProjectionResult behavior across output configurations. No output adapter may add request/run/session/tenant/subject/agent/path/host/trace/span identifiers as metric labels or resource fields.

#### Scenario: OTel output does not change metric policy

- **WHEN** samples are recorded through the OTel Meter adapter
- **THEN** inventory, labels, dedup and degraded outcomes MUST match the existing registry contract
- **AND** exporter availability MUST NOT change business behavior

#### Scenario: Product metric memory remains bounded between exports

- **WHEN** observations continue for an arbitrarily long process lifetime
- **THEN** the registry MUST NOT retain raw sample history
- **AND** projector dedup MUST remain capped at 16,384 keys
- **AND** the OTel SDK aggregation/cardinality policy and exporter buffers MUST remain the only product metric accumulation mechanisms

### Requirement: Metric output failure does not affect business results

MeterProvider, MetricReader or exporter unavailable, serialization/enqueue/write/rotation/compression/retention failure, OTLP timeout, force-flush or shutdown failure MUST NOT change request lifecycle, terminal, model, capability, gateway or health result. Metric failure MAY update bounded observability degradation state but MUST NOT fall back to operational log per sample.

For LOCAL export failure, already committed complete NDJSON lines and archives MUST remain readable; an oversized or dropped collection MUST NOT be written as a partial line. For REMOTE/PaaS export failure, no local file fallback may be created. In both cases metrics readiness MAY be degraded while business readiness and behavior remain unchanged. A component runtime logger MAY emit only bounded `metrics.export.degraded/recovered` transition diagnostics, never one log per sample, snapshot or retry.

#### Scenario: Local metrics snapshot cannot be appended

- **WHEN** snapshot serialization exceeds 4 MiB, the 8 MiB async buffer is full, or enqueue/write/rotation fails
- **THEN** no partial snapshot line may be committed
- **AND** prior complete lines and archives MUST remain readable
- **AND** metric recording and business behavior MUST continue

#### Scenario: PaaS OTLP exporter is unavailable

- **WHEN** the configured OTLP exporter fails or times out
- **THEN** metrics readiness MUST expose a bounded degraded outcome
- **AND** business behavior MUST remain unchanged
- **AND** samples MUST NOT be mirrored into a local file or operational logs as fallback

### Requirement: HTTP server metrics use official OpenTelemetry HTTP instrumentation

HTTP server request measurement SHALL be owned by `@opentelemetry/instrumentation-http` registered against the same product MeterProvider and PeriodicExportingMetricReader as NextAgent business metrics. The instrumentation SHALL opt into stable HTTP semantic conventions and emit `http.server.request.duration` in seconds with the OpenTelemetry-recommended explicit bucket advice. Its cumulative histogram point count SHALL be the request count; a parallel request counter MUST NOT be created. Incoming/server instrumentation SHALL be enabled, outgoing/client instrumentation SHALL be disabled, and incoming span creation SHALL require a parent so HTTP measurement does not add a parallel owner for parentless HTTP traces.

The legacy NextAgent-owned `web_request_total`, `web_request_duration_seconds`, `recordWebRequestMetrics`, HTTP observation-to-sample fallback and Fastify `onResponse` metric hook MUST be removed. Official instrumentation-owned HTTP instruments are a narrow exception to the NextAgent business `MetricDescriptor` inventory: their name, unit, bucket advice and attributes SHALL come from the installed OpenTelemetry instrumentation and semantic-conventions packages, not from a duplicated product descriptor. They MUST still use the shared MeterProvider, exporter, resource, cumulative temporality and bounded lifecycle.

HTTP metric attributes MUST follow stable OpenTelemetry semantic conventions and MUST NOT include raw URL, query, headers, credential/token, client request id, tenant/subject/agent/session/request/run/message/trace/span identifiers or other NextAgent high-cardinality correlation. `http.route` MAY be absent when the Node HTTP boundary cannot obtain a validated framework route template; the implementation MUST NOT substitute a raw path or target.

#### Scenario: HTTP request is measured once

- **WHEN** Fastify completes a matched, unmatched, validation-failed or handler-failed HTTP server request
- **THEN** official HTTP instrumentation MUST add exactly one observation to `http.server.request.duration`
- **AND** the request MUST NOT add `web_request_total` or `web_request_duration_seconds`
- **AND** histogram count MUST provide the cumulative request count without a parallel counter

#### Scenario: HTTP metric remains safe at an unmatched route

- **WHEN** an incoming request contains dynamic path data, query values, credentials, headers or a forged client request id
- **THEN** no raw target or client-controlled correlation value may appear in exported HTTP metric attributes
- **AND** absence of a validated `http.route` MUST remain absence rather than falling back to the raw request path

#### Scenario: HTTP instrumentation shares the product SDK lifecycle

- **WHEN** product composition creates or closes metrics infrastructure
- **THEN** HTTP instrumentation MUST use that infrastructure's MeterProvider and exporter
- **AND** the app server MUST stop accepting requests before provider shutdown so later requests cannot write into a closed pipeline
- **AND** registering HTTP metrics MUST NOT create a second MeterProvider, reader or exporter

### Requirement: 模型性能指标必须按终态调用提供次数、分布和生成速率

每个模型调用 MUST 仅在 `COMPLETED` 或 `FAILED` 终态为 `model_invocation_total` 产生恰好一个 sample；模型调用开始、stream 首内容、stream chunk 和 stream 终止 observation MUST NOT 增加该 counter。

当模型终态提供 `durationMs` 时，系统 MUST 为该调用记录 `model_invocation_duration_seconds`。当模型终态提供 `inputTokens` 或 `outputTokens` 时，系统 MUST 分别为 present 字段同时记录 `model_token_usage_total` counter 和 `model_token_count` histogram；缺失字段 MUST 省略，不得补 `0` 或估算。`model_token_count` 的 `token_type` MUST 只使用 `input` 或 `output`。

仅当同一模型终态同时提供 `outputTokens`、`durationMs` 和 `firstContentLatencyMs`，且 `durationMs > firstContentLatencyMs` 时，系统 MUST 记录一个 `model_output_token_rate` sample，其值 MUST 等于：

`outputTokens / ((durationMs - firstContentLatencyMs) / 1000)`，单位为 `{token}/s`。

条件不满足时系统 MUST 省略该速率 sample。`model_ttft_seconds`、`model_invocation_duration_seconds`、`model_token_count` 和 `model_output_token_rate` 的聚合 `sum / count` MUST 分别表示单次调用平均值，聚合 `max` MUST 表示单次调用最大值；`model_token_usage_total` MUST 表示 present token 字段的累计总数。

**需求类别**：功能性需求

#### Scenario: 成功模型调用只计一次并输出完整分布
- **WHEN** 一个模型调用先产生 started observation，后以 success 终态结束，并提供 `durationMs=2400`、`firstContentLatencyMs=400`、`inputTokens=120`、`outputTokens=80`
- **THEN** `model_invocation_total{outcome=success}` MUST 增加 `1`
- **AND** started observation MUST NOT 增加 `model_invocation_total`
- **AND** `model_token_count` MUST 分别记录 input `120` 和 output `80`
- **AND** `model_output_token_rate` MUST 记录 `40 {token}/s`

#### Scenario: 失败模型调用仍按终态计一次
- **WHEN** 一个模型调用以 failure、timeout、canceled、denied 或 degraded 终态结束
- **THEN** `model_invocation_total` MUST 按对应低基数 outcome 增加 `1`
- **AND** 同一调用的开始或 stream observations MUST NOT 产生第二次调用计数

#### Scenario: 缺失或无效速率输入时不推算
- **WHEN** 模型终态缺少 `outputTokens`、`durationMs` 或 `firstContentLatencyMs` 中任一字段，或者 `durationMs <= firstContentLatencyMs`
- **THEN** 系统 MUST NOT 记录 `model_output_token_rate`
- **AND** 其他已满足输入条件的模型指标 MUST 保持可记录

### Requirement: 对话指标必须覆盖终态次数、首字、总耗时、排队、并发和 token 分布

一次对话 MUST 以一个 request run 的 terminal outcome 为唯一计数边界，并为 `request_outcome_total` 产生恰好一个 sample。`request_duration_seconds` MUST 测量 request accepted 到 terminal commit 的秒数。`request_first_content_latency_seconds` MUST 继续测量 request accepted 到首个用户可见内容或思考进入 canonical stream 的秒数，并且每个 request run 至多产生一个 sample。

`request_phase_duration_seconds{phase=queued}` MUST 测量 request accepted 到该 run 首次进入执行态的秒数；未进入执行态即到达终态的 run MUST 省略 queued sample，不得把终态时间当作执行态开始时间。

系统 MUST 在每个 request run 进入执行态或离开执行态后记录一个 `request_active_concurrency` sample，其值 MUST 等于该状态转换完成后当前 app runtime 实例中处于执行态的 request run 数量。一个聚合时间窗内，`sum / count` MUST 表示并发采样值的平均值，`max` MUST 表示最大并发采样值；该平均值是按执行态转换采样的算术平均值，不是时间加权平均值，也不是多 runtime 实例的集群全局并发值。

对话到达终态时，仅当该 run 的每个 terminal 模型调用都提供目标 token 字段且该 run 至少包含一个 terminal 模型调用，系统 MUST 分别汇总 `inputTokens` 和 `outputTokens`，并各产生一个 `request_token_count` sample。任一 terminal 模型调用缺失目标字段时，系统 MUST 省略该 run 对应 token type 的 sample，不得输出不完整汇总。`request_token_count` 的 `sum / count` MUST 表示对话级平均 token 数，`max` MUST 表示对话级最大 token 数，input 与 output token 各自的 `sum` MUST 表示对应 token type 的对话级累计总数。

**需求类别**：功能性需求

#### Scenario: 完成对话输出完整框架指标
- **WHEN** 一个 request run 排队 `250 ms` 后进入执行态，包含两个均提供 usage 的 terminal 模型调用，并最终 `COMPLETED`
- **THEN** `request_outcome_total{status=COMPLETED}` MUST 增加 `1`
- **AND** `request_phase_duration_seconds{phase=queued,status=success}` MUST 记录 `0.25 s`
- **AND** `request_token_count` MUST 分别记录两个模型调用 input token 之和与 output token 之和
- **AND** 该 run 的总耗时和存在时的界面首字响应时间 MUST 各记录至对应 histogram

#### Scenario: 并发按每次执行态转换采样
- **WHEN** 依次有两个 request run 进入执行态，随后依次离开执行态
- **THEN** `request_active_concurrency` MUST 依次记录 `1`、`2`、`1`、`0`
- **AND** 该样本序列的聚合平均值 MUST 为 `1`
- **AND** 聚合最大值 MUST 为 `2`

#### Scenario: 未执行的终态 run 不伪造排队时间
- **WHEN** 一个 request run 在首次进入执行态前到达终态
- **THEN** 该 run MUST 仍按其 terminal outcome 计入 `request_outcome_total`
- **AND** 系统 MUST NOT 为该 run 记录 queued duration 或执行态并发增加样本

#### Scenario: 不完整模型 usage 不形成对话级伪总数
- **WHEN** 一个 request run 的任一 terminal 模型调用缺少 `outputTokens`
- **THEN** 系统 MUST NOT 为该 run 记录 `request_token_count{token_type=output}`
- **AND** 若每个 terminal 模型调用都提供 `inputTokens`，input token sample MUST 保持可记录

### Requirement: 异常指标必须使用唯一权威终态分类

每个 `FAILED` request run MUST 为 `request_abnormal_termination_total` 产生恰好一个 sample；`COMPLETED`、`CANCELED` 和 `SUPERSEDED` request run MUST NOT 增加该 counter。

每个具有 authoritative timeout classification 的 request、model、capability 或 gateway operation terminal MUST 为 `operation_timeout_total` 产生恰好一个 sample，并使用 `boundary=request|model|capability|gateway` 中对应的唯一 label。request terminal 仅当 canonical safe error category 为 `TIMEOUT` 或 canonical safe error code 为 `PENDING_INPUT_TIMEOUT` 时具有 authoritative timeout classification；model、capability 和 gateway terminal 仅当 canonical observation `outcome=timeout` 时具有 authoritative timeout classification。非终态 observation、上层对下层 timeout 的重复转述以及只有 free-text 包含 timeout 的失败 MUST NOT 增加该 counter。

每个 terminal model invocation 的 canonical safe reason code 为 `MODEL_RATE_LIMITED` 时，系统 MUST 为 `model_flow_control_total` 产生恰好一个 sample；retry、fallback 或 request 最终成功 MUST NOT 抹除已成立的模型流控事实。同一模型调用的中间异常、日志文本或 HTTP 状态推断 MUST NOT 产生额外 sample。

**需求类别**：功能性需求

#### Scenario: 失败对话只产生一次异常终止计数
- **WHEN** 一个 request run 以 `FAILED` terminal outcome 结束
- **THEN** `request_abnormal_termination_total` MUST 增加 `1`
- **AND** 同一 run 的 model 或 capability failure MUST NOT 再增加该 counter

#### Scenario: 权威 timeout 按边界计数
- **WHEN** 一个 capability operation 以 authoritative `outcome=timeout` 终止
- **THEN** `operation_timeout_total{boundary=capability}` MUST 增加 `1`
- **AND** started observation 或 free-text error MUST NOT 增加该 counter

#### Scenario: 模型流控在 fallback 成功后仍保留
- **WHEN** 一个模型调用以 `MODEL_RATE_LIMITED` 终止，后续 fallback 模型调用成功
- **THEN** `model_flow_control_total` MUST 对前一个模型调用增加 `1`
- **AND** 后续成功调用 MUST NOT 抵消或重复该 sample

### Requirement: 非秒数直方图必须使用量纲匹配的固定聚合

`model_token_count` 和 `request_token_count` MUST 使用 unit `{token}` 与显式 boundaries `[1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144]`。`model_output_token_rate` MUST 使用 unit `{token}/s` 与显式 boundaries `[1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]`。`request_active_concurrency` MUST 使用 unit `1` 与显式 boundaries `[0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]`。

全部 NextAgent-owned histogram MUST 记录 `count`、`sum`、`min` 和 `max`。local 与 remote exporter MUST 使用相同 unit、boundaries 和 aggregation semantics；sink/output 切换 MUST NOT 改变平均值、最大值或总数的计算口径。

**需求类别**：系统质量属性
**质量属性**：性能/容量
**适用范围**：该 Function

#### Scenario: 不同量纲使用各自固定桶
- **WHEN** metrics infrastructure 创建 token count、token rate、concurrency 和 seconds histogram instruments
- **THEN** 每个 instrument MUST 使用本 Requirement 或既有 seconds Requirement 为其量纲定义的唯一 boundaries
- **AND** 非秒数 histogram MUST NOT 使用 seconds boundaries

#### Scenario: Local 与 remote 聚合结果同义
- **WHEN** 同一组 metric samples 分别通过 local 与 remote exporter 输出
- **THEN** 两种输出的 histogram `count`、`sum`、`min`、`max` 与 bucket boundaries MUST 具有相同语义
