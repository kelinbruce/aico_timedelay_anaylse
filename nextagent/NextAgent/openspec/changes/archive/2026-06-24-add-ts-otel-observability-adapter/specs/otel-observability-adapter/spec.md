## ADDED Requirements

### Requirement: OTel adapters 必须通过既有 observation handoff 路径接入

系统 MUST 只通过 `ObservabilityProjectorHost.acceptObservation(event)` 接入 OpenTelemetry trace / metric adapter。`TraceProjector` 与 unified `MetricsRegistry` 的 remote OTel sink/output MUST 属于 `agent-observability` owning surface，并由 `agent-app` composition 显式装配。runtime、core、model、capability、gateway、channel 和其它业务 package MUST NOT 直接调用 tracer、meter、exporter 或 propagator。本 capability MUST NOT 要求调整 gateway implementation。

#### Scenario: TRACE surface 通过 fixed projector set 接入
- **WHEN** `agent-app` 装配 observability projector host
- **THEN** `TRACE` surface MUST 以 `ObservabilityProjector` 的形式加入 fixed projector set
- **AND** business path 仍只调用 `acceptObservation(event)`，不得新增 direct trace sink path

#### Scenario: OTel metrics 通过既有 MetricsProjector 接入
- **WHEN** `MetricsProjector` 需要把 sample 写到 OpenTelemetry
- **THEN** projector MUST 继续通过 `MetricsRegistry` 抽象写入
- **AND** business path 与 wrappers 不得直接调用 OTel Meter API

#### Scenario: gateway implementation 保持不变
- **WHEN** 系统落地 OTel trace / metric adapter
- **THEN** `agent-platform-gateway-local` 与 `agent-platform-gateway-remote` 的实现逻辑、public port、持久化路径和 transport 行为 MUST 保持不变
- **AND** 如需覆盖 gateway 相关 observability 语义，只能通过 `agent-app` / `agent-observability` owning wrapper 与 projector 消费实现

### Requirement: TraceProjector 必须只消费安全 observation 并映射到 OTel trace 语义

`TraceProjector` MUST 只消费已经过 host redaction 和最小 shape 校验的 `ObservabilityObservationEvent`。它 MUST 按既有 observation 语义把 synchronous execution boundary 映射为 span，把 authoritative fact 或 outcome 映射为 span event / status / bounded attributes。cross-process propagation MUST 使用 W3C Trace Context；trace export 语义 MUST 对齐 OTLP traces。`traceId`、`spanId`、SpanContext、tracer、span 或 exporter 类型 MUST NOT 进入 `agent-contracts`、runtime timeline、gateway records、message metadata 或 public DTO。

#### Scenario: TraceProjector 只使用 allowlist attributes
- **WHEN** TraceProjector 把 observation 映射到 OTel span attributes
- **THEN** 它 MUST 只使用低基数、policy-approved 的 owner scope、stable refs、safe reason code、duration、usage 和 diagnostic candidates
- **AND** raw prompt、content、tool args/result、path、credential、token、attachment content、trace carrier 原文和自由文本原因不得成为 span attribute

#### Scenario: trace context 不改变权威业务事实
- **WHEN** TraceProjector 创建 span、span event 或 span link
- **THEN** runtime timeline、terminal commit、audit truth、message store 和 request truth MUST 保持不变
- **AND** 缺失或损坏的 trace propagation metadata 不得回填或改写业务事实

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
