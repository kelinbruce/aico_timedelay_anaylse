## ADDED Requirements

### Requirement: METRIC surface 必须消费统一 observation stream

Runtime metrics SHALL 消费 `add-ts-trace-log-linking` 产生的 `ObservabilityObservationEvent`。runtime listener、wrapper taxonomy、source precedence、dedup 和 `ObservabilityProjectorHost.acceptObservation(event): void` 仍由 `add-ts-trace-log-linking` 拥有。

`MetricsProjector` SHALL 作为 `ObservabilityProjectorHost` 异步调用的 fixed projector。业务 package 不得 import metrics registry、metric names、label taxonomy、tracer 或 observability SDK。

#### Scenario: Metrics 使用 host handoff 路径
- **WHEN** runtime listener、wrapper、middleware 或 system producer 创建 observation
- **THEN** metrics 只能通过 `MetricsProjector` 写出
- **AND** wrappers 和业务模块不得直接写 registry samples

### Requirement: Metric domain objects 必须有稳定语义

`MetricDescriptor` SHALL 定义 metric name、type、unit、allowed labels、value source 和 acquisition source。`MetricSample` SHALL 包含 name、type、有限非负 value、allowed labels、occurredAt 和 dedup key。`MetricsRegistry` SHALL 是 in-process 输出目标。`MetricProjectionResult` SHALL 固定为 `emitted`、`skipped_not_covered`、`skipped_policy_denied`、`degraded` 或 `failed_closed`。

Metric descriptors、samples 和 registry types SHALL 保留在 `agent-observability` 内部，不得通过 `agent-contracts` 导出。

#### Scenario: Metrics 不进入 core contracts
- **WHEN** metrics implementation 被添加
- **THEN** `agent-contracts` 不暴露 metric descriptors、samples、registry 或 label taxonomy

### Requirement: Metric inventory 必须声明来源、标签和增强需求

METRIC surface SHALL 维护 stable inventory。每个 metric SHALL 声明 type、value、allowed labels、preferred input、fallback input、dedup key 和 event enhancement requirements。

首版 inventory SHALL 包含：

| Metric | Type | Labels | Preferred input | Fallback input |
|---|---|---|---|---|
| `web_request_total` | counter | `entrypoint`, `status_family` | channel entrypoint middleware observation | none |
| `web_request_duration_seconds` | histogram | `entrypoint`, `status_family` | channel entrypoint middleware observation | none |
| `request_outcome_total` | counter | `status` | terminal timeline observation | none |
| `request_duration_seconds` | histogram | `status` | terminal observation with duration candidate | runtime terminal wrapper if event lacks duration |
| `request_phase_duration_seconds` | histogram | `phase`, `status` | runtime lifecycle observation | runtime lifecycle wrapper |
| `model_invocation_total` | counter | `provider_kind`, `outcome` | `ModelInvocationService` wrapper observation | none |
| `model_invocation_duration_seconds` | histogram | `provider_kind`, `outcome` | model wrapper observation with `durationMs` | none |
| `model_token_usage_total` | counter | `provider_kind`, `token_type`, `outcome` | model wrapper observation with `usage` | none |
| `model_ttft_seconds` | histogram | `provider_kind`, `outcome` | normalized visible stream observation | 后续 normalized stream wrapper |
| `model_chunk_latency_seconds` | histogram | `provider_kind` | normalized visible stream observation | 后续 normalized stream wrapper |
| `capability_invocation_total` | counter | `capability_kind`, `outcome` | `CAPABILITY_COMPLETED` observation | capability wrapper |
| `capability_invocation_duration_seconds` | histogram | `capability_kind`, `outcome` | `CAPABILITY_COMPLETED` with `durationMs` | capability wrapper |
| `gateway_call_total` | counter | `gateway_category`, `outcome` | gateway authoritative observation | 后续 `GatewayPort` wrapper |
| `gateway_call_duration_seconds` | histogram | `gateway_category`, `outcome` | gateway authoritative observation | 后续 `GatewayPort` wrapper |
| `observability_degradation_total` | counter | `surface`, `reason_code` | shared degradation observation | none |
| `projector_projection_total` | counter | `surface`, `result` | projector host outcome observation | none |

本 change SHALL NOT 新增 `TimelineEventType`。Model invocation 的 duration / usage 由 `add-ts-trace-log-linking` 的 `ModelInvocationService` wrapper 拥有；`CAPABILITY_COMPLETED` 的 duration 增强由 `add-ts-trace-log-linking` 拥有。
当前代码实现已覆盖 request、model wrapper、capability completion、HTTP entrypoint、observability degradation 和 projector outcome metrics。normalized stream timing、generic gateway port 和其它 fallback wrappers 仍由后续 owner change 实现；本 change 只冻结它们必须进入同一 observation stream。

#### Scenario: Model end event 输出 usage metrics
- **WHEN** `MODEL_INVOCATION_COMPLETED` 或 `MODEL_INVOCATION_FAILED` observation 携带 normalized `usage`
- **THEN** `model_token_usage_total` 对每个 present token field 写一个 sample
- **AND** 缺失 usage 字段省略，不补 0、不估算

#### Scenario: Capability metrics 不读取 result payload
- **WHEN** `CAPABILITY_COMPLETED` observation 被投影
- **THEN** capability metrics 只使用 status、capability kind、outcome 和 duration
- **AND** 不读取 tool args 或 result payload

### Requirement: Metric labels 必须低基数且固定

Metric labels SHALL 只使用 descriptor 声明的 keys 和 values。request id、run id、session id、message id、tenant id、subject id、path、prompt、content、raw provider name、raw endpoint、free-text reason、secret、credential、trace id/span id 或 dynamic payload 不得作为 labels。

首版 allowed label vocabularies SHALL 包含：

- `entrypoint`: `health_primary`, `health_deep`, `submit`, `stream`, `history`, `other`
- `status_family`: `2xx`, `3xx`, `4xx`, `5xx`
- `status`: `COMPLETED`, `FAILED`, `CANCELED`, `SUPERSEDED`
- `phase`: `accepted`, `queued`, `executing`, `terminal_commit`
- `provider_kind`: `OPENAI`, `MODEL_GATEWAY`, `LOCAL`, `OTHER`
- `capability_kind`: `TOOL`, `SKILL`, `AGENT`
- `gateway_category`: `local`, `remote`, `model_provider`, `content`
- `outcome`: `success`, `failure`, `timeout`, `canceled`, `denied`, `degraded`, `no_first_token`
- `token_type`: `input`, `output`, `total`
- `surface`: `LOG`, `AUDIT`, `METRIC`, `HEALTH`, `TRACE`
- `result`: `emitted`, `skipped_not_covered`, `skipped_policy_denied`, `degraded`, `failed_closed`

#### Scenario: High-cardinality labels 被拒绝
- **WHEN** metric sample 尝试使用 `requestRunId`、`tenantId`、path 或 free-text reason 作为 label
- **THEN** sample 被拒绝或降级
- **AND** 业务 outcome 保持不变

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
