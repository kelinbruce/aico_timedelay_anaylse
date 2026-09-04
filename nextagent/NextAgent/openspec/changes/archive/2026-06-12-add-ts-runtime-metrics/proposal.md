## 背景与问题

`add-ts-trace-log-linking` 已经定义统一 observation stream、source precedence 和 `ObservabilityProjectorHost.acceptObservation(event): void`。runtime metrics 需要在这个主设计上定义 METRIC surface 的领域对象、指标清单、label 策略、投影规则和 registry 写入语义。

当前目标不是让业务模块直接写 registry，也不是定义 exporter，而是让智能体请求、模型调用、stream、capability、gateway、Web entrypoint、system degradation 等关键业务事实通过同一 observation stream 生成安全、低基数、可解释的聚合指标。

## 目标效果

完成后，operator 和 release gate 可以通过稳定 metric name、allowed labels 和 bounded values 观察请求结果、请求耗时、模型耗时与 usage、capability 耗时、gateway 耗时、stream timing、Web entrypoint 和 observability degradation。业务模块不 import metrics registry、metric names、label taxonomy、tracer 或 observability SDK。

## 变更范围

- 定义 METRIC surface 的领域对象：`MetricDescriptor`、`MetricSample`、`MetricsRegistry`、`MetricProjectionPolicy`、`MetricsProjector`、`MetricProjectionResult`。
- 定义完整 metric inventory，包括 metric name、type、value、allowed labels、preferred observation source、fallback source、dedup key 和 event 增强需求。
- 定义从 `ObservabilityObservationEvent` 到 metric samples 的生成规则。
- 定义唯一可实施路径：`ObservabilityProjectorHost` 异步调用 fixed `MetricsProjector`，projector 按 inventory 写入 `MetricsRegistry`。

## 非范围与安全排除

- 本 change 不定义采集入口、runtime listener、wrapper taxonomy、DiagnosticContext、`ObservabilityObservationEvent` shape 或 projector host。
- 本 change 不定义 health endpoint、HealthEvaluator、HealthProbe 或 health response schema；health-owned metric semantic 由 `add-ts-health-check` 定义。
- 本 change 不定义 Prometheus scrape endpoint、OTLP metrics exporter、StatsD、文件落盘、远端推送、多 registry fan-out、后台 flush worker 或 metrics 类型进入 `agent-contracts`。
- request id、run id、session id、message id、tenant id、subject id、path、free-text reason、raw provider name、prompt、content、payload、secret、trace id/span id 和高基数字段不得作为 metric label。

## 核心实现策略

- METRIC 只消费 `ObservabilityObservationEvent`，coverage 由 metric inventory 和 `MetricProjectionPolicy` 决定。
- timeline event 已覆盖的事实优先从 runtime listener observation 生成 metric；没有 authoritative event 的事实才通过 `add-ts-trace-log-linking` 批准的 wrapper / middleware / system producer 生成 observation。
- `durationMs` 可选；model/capability end event 的 duration 由 `add-ts-trace-log-linking` 补强。
- `usage` 复用 `ModelUsage` shape，并投影为 token usage metric value。
- registry 写入是 in-process bounded O(1) counter / histogram update；失败只产生 metrics degradation evidence。

## 影响

- `add-ts-trace-log-linking` 提供统一 observation acquisition 和 dedup。
- `add-ts-redaction-policy` 提供 METRIC surface candidate gating 和 label safety。
- `add-ts-health-check` 可以复用 registry / label validation primitives，但 health probe metric 名称和 health judgment 由 health change 拥有。

## 归档前基线提升计划

- `openspec/specs/agent-runtime-metrics/spec.md`
