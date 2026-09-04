## 背景和现状

METRIC surface 需要在统一 observation stream 上生成聚合指标。当前代码基线中存在 `MetricsRegistry`、`MetricsProjector`、timeline metrics observer、entrypoint metrics helper 和 app composition 直接调用路径；本 change 将这些收敛为 `ObservabilityProjectorHost` fixed projector 模式。

## 第一性原理

指标的唯一职责，是把已成立的业务事实和系统事实聚合为低基数、可运营、可告警的数值信号。指标不是业务事实，不表达逐请求详情，不替代日志、审计、trace、health response、timeline 或 release gate 证据。

## 黑盒目标

系统能够用稳定 metric inventory 覆盖智能体主业务：Web entrypoint、request lifecycle、model invocation、model stream timing、model token usage、capability invocation、gateway call、degradation 和 projector / sink health。operator 不读取 raw payload，也能按低基数标签观察吞吐、错误、耗时、token 成本和降级。

## 非范围与安全排除

本 change 不定义 observation acquisition、runtime listener、wrapper taxonomy、DiagnosticContext、`ObservabilityObservationEvent` shape、projector host、structured log schema、audit truth、health endpoint、HealthEvaluator、HealthProbe 或 trace exporter。

本 change 不定义 Prometheus、OTLP metrics、StatsD、file sink、remote push、多 registry fan-out、后台 flush worker、metrics query API 或 `agent-contracts` metric DTO。

Metric labels 只允许低基数固定枚举。tenant、subject、session、run、request、message、timeline event、capability invocation、path、prompt、content、raw provider name、free-text reason、secret、credential、trace id/span id 和动态 payload 不得作为 label。

## 核心对象

### MetricDescriptor

`MetricDescriptor` 定义稳定 metric name、type、unit、description、allowed labels、value source 和 acquisition source。它是 `agent-observability` 内部 inventory，不进入 `agent-contracts`。

### MetricSample

`MetricSample` 是 METRIC surface 写入 registry 的领域对象：

- `name`：稳定 metric name。
- `type`：`counter` 或 `histogram`。
- `value`：有限非负数值。
- `labels`：只包含 descriptor allowlist 的低基数字段。
- `occurredAt`：来自 observation 的事实时间。
- `sourceObservationId` / dedup key：host/projector 内部用于避免重复写入。

### MetricsRegistry

`MetricsRegistry` 是首版唯一输出目标，提供 in-process counter / histogram update 和 snapshot。它不是 exporter，也不是业务 contract。

### MetricsProjector

`MetricsProjector` 是 `ObservabilityProjectorHost` 的 fixed projector。它从 observation 生成零个或多个 `MetricSample`，并写入 `MetricsRegistry`。

### MetricProjectionPolicy

`MetricProjectionPolicy` 基于 metric inventory 判断 observation 是否覆盖某个 metric，并校验 labels、value、dedup key 和 surface policy。

## 唯一产品路径

1. `add-ts-trace-log-linking` 负责 runtime listener / wrappers / middleware / system producer 生成 `ObservabilityObservationEvent`，并调用 `ObservabilityProjectorHost.acceptObservation(event): void`。
2. `ObservabilityProjectorHost` 异步调用 `MetricsProjector`。
3. `MetricsProjector` 根据 metric inventory 生成 `MetricSample[]`。
4. 每个 sample 经过 label allowlist、value validation、dedup 和 METRIC surface policy。
5. 合法 sample 写入 in-process `MetricsRegistry`。
6. registry failure、invalid label、invalid value 或 duplicate lower-precedence source 只产生 metrics degradation / skipped outcome，不改变业务结果。

这条路径替代当前产品路径中的 timeline metrics observer 直接写 registry、entrypoint helper 直接写 registry、wrapper 直接写 metric、业务模块 import registry / metric names 和 per-metric 采集入口。

## Metric Inventory

| Metric | Type | Value | Labels | Preferred input | Fallback input | Event 状态 / 增强 |
|---|---|---|---|---|---|---|
| `web_request_total` | counter | `1` | `entrypoint`, `status_family` | channel entrypoint middleware observation | 无 | middleware，不新增 timeline |
| `web_request_duration_seconds` | histogram | duration seconds | `entrypoint`, `status_family` | channel entrypoint middleware observation | 无 | middleware，不新增 timeline |
| `request_outcome_total` | counter | `1` | `status` | terminal timeline observation | 无 | `REQUEST_COMPLETED` / `FAILED` / `CANCELED` / `SUPERSEDED` 已有 |
| `request_duration_seconds` | histogram | terminal duration seconds | `status` | terminal observation with request duration candidate | runtime terminal wrapper if event lacks duration | 不要求本 change 增强 timeline；wrapper 可从 accepted/terminal boundary 计算 |
| `request_phase_duration_seconds` | histogram | phase duration seconds | `phase`, `status` | runtime lifecycle observation | runtime lifecycle wrapper | 不新增 event；phase 只用低基数 |
| `model_invocation_total` | counter | `1` | `provider_kind`, `outcome` | `ModelInvocationService` wrapper observation | 无 | wrapper 由 trace-log-linking 定义，duration/usage 不写 timeline |
| `model_invocation_duration_seconds` | histogram | `durationMs / 1000` | `provider_kind`, `outcome` | model completed/failed observation with `durationMs` | model invocation wrapper | `durationMs` 由 trace-log-linking 补强 |
| `model_token_usage_total` | counter | token count | `provider_kind`, `token_type=input|output|total`, `outcome` | model completed/failed observation with `usage` | 无 | `usage` 由 trace-log-linking 补强；shape 复用 `ModelUsage` |
| `model_ttft_seconds` | histogram | first visible content latency | `provider_kind`, `outcome` | normalized visible stream observation | 后续 normalized stream wrapper | 不读取 raw delta/content |
| `model_chunk_latency_seconds` | histogram | adjacent visible chunk latency | `provider_kind` | normalized visible stream observation | 后续 normalized stream wrapper | 不读取 raw delta/content |
| `capability_invocation_total` | counter | `1` | `capability_kind`, `outcome` | `CAPABILITY_COMPLETED` observation | capability wrapper | event 已有；不使用 args/result |
| `capability_invocation_duration_seconds` | histogram | `durationMs / 1000` | `capability_kind`, `outcome` | `CAPABILITY_COMPLETED` with `durationMs` | capability wrapper | `durationMs` 由 trace-log-linking 补强 |
| `gateway_call_total` | counter | `1` | `gateway_category`, `outcome` | gateway authoritative observation | 后续 `GatewayPort` wrapper | 当前无 timeline；后续 wrapper |
| `gateway_call_duration_seconds` | histogram | duration seconds | `gateway_category`, `outcome` | gateway authoritative observation | 后续 `GatewayPort` wrapper | 后续 wrapper 测量 |
| `observability_degradation_total` | counter | `1` | `surface`, `reason_code` | shared degradation observation | 无 | shared degradation model |
| `projector_projection_total` | counter | `1` | `surface`, `result` | projector host outcome observation | 无 | system/internal observation |

Health-owned metrics such as `health_probe_total` and `health_probe_duration_seconds` are defined by `add-ts-health-check`; this change only supplies registry and generic label validation primitives.
当前代码实现已覆盖 request、model wrapper、capability completion、HTTP entrypoint、observability degradation 和 projector outcome metrics。normalized stream timing、generic gateway port 和其它 fallback wrappers 仍由后续 owner change 实现；本 change 只冻结它们必须进入同一 observation stream。

## 从 Observation 到 MetricSample 的映射

1. 读取 observation 的 `boundary`、`operation`、`outcome`、`ownerScope`、`occurredAt`、`stableRefs`、`durationMs`、`usage`、`safeReasonCode` 和 safe category fields。
2. 遍历 metric inventory，判断 observation 是否覆盖 metric。
3. 生成 metric value：counter 为 `1` 或 token count，histogram 使用 `durationMs / 1000` 或 wrapper measured seconds。
4. 生成 labels：只允许 descriptor 定义的 key/value；非法 label 产生 degradation 或 skip。
5. 生成 dedup key：metric name + owner scope category + stable fact key + source precedence。
6. 较低优先级 source 不得覆盖较高优先级 source。
7. 写入 `MetricsRegistry`；registry failure 返回 `degraded`。

`usage` 处理规则：

- `inputTokens` 写 `model_token_usage_total{token_type="input"}`。
- `outputTokens` 写 `model_token_usage_total{token_type="output"}`。
- `totalTokens` 写 `model_token_usage_total{token_type="total"}`。
- 缺失字段省略，不补 0、不估算。

## Label Policy

允许标签必须来自固定枚举：

- `entrypoint`: `health_primary`、`health_deep`、`submit`、`stream`、`history`、`other`
- `status_family`: `2xx`、`3xx`、`4xx`、`5xx`
- `status`: `COMPLETED`、`FAILED`、`CANCELED`、`SUPERSEDED`
- `phase`: `accepted`、`queued`、`executing`、`terminal_commit`
- `provider_kind`: `OPENAI`、`MODEL_GATEWAY`、`LOCAL`、`OTHER`
- `capability_kind`: `TOOL`、`SKILL`、`AGENT`
- `gateway_category`: `local`、`remote`、`model_provider`、`content`
- `outcome`: `success`、`failure`、`timeout`、`canceled`、`denied`、`degraded`、`no_first_token`
- `token_type`: `input`、`output`、`total`
- `surface`: `LOG`、`AUDIT`、`METRIC`、`HEALTH`、`TRACE`
- `result`: `emitted`、`skipped_not_covered`、`skipped_policy_denied`、`degraded`、`failed_closed`

Capability id 不作为首版 label，避免 registry 随 capability catalog 增长形成高基数或租户差异。

## 失败与降级

- invalid label / value：skip 当前 sample，并记录 metrics degradation。
- registry unavailable：业务结果继续，projection result 为 degraded。
- duplicate lower-precedence source：返回 skipped，不重复写入。
- missing optional duration/usage：省略对应 metric，不补 0、不估算。

## 代码修改方案

1. `packages/agent-observability/src/metrics/metrics-registry.ts`：保留 in-process registry，补 descriptor inventory、label validation 和 sample write API。
2. 新增或整改 `MetricsProjector`：输入 `ObservabilityObservationEvent`，按 inventory 生成 `MetricSample[]`。
3. `packages/agent-app/src/composition/create-app.ts`：移除直接写 registry 的 metrics helper / timeline metrics observer 产品路径，注册 `MetricsProjector` 到 host。
4. entrypoint middleware / wrappers：只生成 observation，不直接写 registry。
5. tests：覆盖 inventory、labels、duration/usage、dedup、registry failure、无业务模块 direct registry import。

## 验收样例

- `MODEL_INVOCATION_COMPLETED` observation 带 `durationMs` 和 `usage` 时，生成 invocation total、duration histogram 和 token usage counters。
- `CAPABILITY_COMPLETED` observation 生成 capability total 和 duration，不读取 args/result。
- 后续 gateway wrapper observation 生成 gateway total/duration 时，不包含 path/SQL/raw error label。
- 同一 model terminal fact 同时被 event 和 wrapper 看到时，只由 event-derived observation 写 metric。
- registry unavailable 不影响 request terminal commit，并产生 bounded metrics degradation evidence。
