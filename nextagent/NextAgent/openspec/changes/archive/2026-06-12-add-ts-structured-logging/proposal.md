## 背景与问题

`add-ts-trace-log-linking` 已经定义统一 observation stream 和 `ObservabilityProjectorHost.acceptObservation(event): void`。structured logging 需要在这个主设计上定义 LOG surface 的领域对象、覆盖清单、投影规则和 sink 语义，避免 runtime、core、model、capability、gateway 或 channel 直接调用 logger 或发明私有日志 schema。

本 change 的目标，是把智能体请求生命周期、模型调用、capability 调用、gateway 调用、hook/policy、attachment、safe error、large content、system runtime 和 observability degradation 等业务诊断事实，投影成安全、稳定、可关联的 `StructuredLogEntry`。

## 目标效果

完成后，operator 可以通过结构化日志中的 owner scope、stable refs、boundary、operation、outcome、safe reason、duration 和 normalized usage，把一次智能体执行从入口、runtime、model、capability、gateway 到 terminal 串联起来。日志失败或 redaction 降级不会改变业务结果。

## 变更范围

- 定义 LOG surface 的领域对象：`StructuredLogEntry`、`StructuredLogProjector`、`StructuredLogTransport`、`StructuredLogProjectionPolicy` 和 logging degradation evidence。
- 定义从 `ObservabilityObservationEvent` 到 `StructuredLogEntry` 的生成规则。
- 定义完整 LOG coverage 清单，说明每个日志事实基于哪个 timeline event、是否需要增强、是否需要新增业务 event，或由哪个 wrapper / middleware / system producer 生成 `ObservabilityObservationEvent`。
- 定义唯一可实施路径：`ObservabilityProjectorHost` 异步调用 fixed `StructuredLogProjector`，projector 执行 LOG policy / redaction 后写 transport。

## 非范围与安全排除

- 本 change 不定义采集入口、runtime listener、wrapper taxonomy、DiagnosticContext、`ObservabilityObservationEvent` shape 或 projector host。
- 本 change 不新增 `TimelineEventType`，不定义审计事实、metric inventory、health judgment、trace exporter、多 sink fan-out、远端日志 exporter、JSONL flush 或业务包可调用 logger port。
- raw prompt、raw thinking、raw model output、tool args/result、attachment content、raw provider response、credential、secret、token、stack trace、未脱敏路径、free-text reason、动态 payload、trace id/span id 和高基数字段不得进入 `StructuredLogEntry`。

## 核心实现策略

- LOG 只消费 `ObservabilityObservationEvent`，coverage 由 `StructuredLogProjectionPolicy.covers(event)` 决定。
- `StructuredLogProjector` 映射稳定 `event` 名、`level`、`timestamp`、`correlation`、`processState`、`costLatency`、`costUsage` 和 `safeSummary`。
- `durationMs` 保持可选；model/capability duration 来自 `add-ts-trace-log-linking` 声明的 end event payload。
- `usage` 复用 `ModelUsage` shape：`inputTokens`、`outputTokens`、`totalTokens`。
- 日志写出前必须通过 LOG surface redaction policy。

## 影响

- `add-ts-trace-log-linking` 提供统一 acquisition、diagnostic snapshot、host handoff 和 source precedence。
- `add-ts-redaction-policy` 提供 LOG surface redaction 和 candidate gating。
- `add-ts-audit-sink`、`add-ts-runtime-metrics` 和后续 trace projector 可以消费同一 observation stream，但不得从 log output 回放生成自己的输入。

## 归档前基线提升计划

- `openspec/specs/structured-logging/spec.md`
