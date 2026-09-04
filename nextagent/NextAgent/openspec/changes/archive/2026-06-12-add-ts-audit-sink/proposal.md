## 背景与问题

`add-ts-trace-log-linking` 已经定义统一的 `ObservabilityObservationEvent` 输入、runtime `RunTimelineEvent` listener、wrapper 兜底和 `ObservabilityProjectorHost.acceptObservation(event): void` handoff。AUDIT surface 需要在这个主设计上定义自己的领域对象、覆盖清单、投影规则和 sink 语义，避免业务模块直接感知审计能力。

当前 audit sink change 的目标，是把智能体请求、模型、capability、gateway、hook/policy、attachment、safe error 和 terminal 等业务治理事实投影成安全、稳定、可追溯的 `AuditEvent`。审计记录是治理留痕，不是 request lifecycle、terminal commit、timeline、session history、checkpoint 或 capability result 的权威来源。

## 目标效果

完成后，AUDIT projector 可以从同一条 observation stream 中识别命中 AUDIT coverage 的治理事实，生成 redacted `AuditEvent`，并通过 `AuditEventWriter` 写入真实 audit sink。业务 owner 只发布权威业务 event / fact 或提供 classified diagnostic candidate，不 import audit writer、logger、metrics registry、tracer 或 observability SDK。

## 变更范围

- 定义 AUDIT surface 的领域对象：`AuditEvent`、`AuditEventWriter`、`AuditProjectionPolicy`、`AuditProjectionResult` 和 audit degradation evidence。
- 定义从 `ObservabilityObservationEvent` 到 `AuditEvent` 的生成规则，包括 coverage 判断、字段映射、redaction、最小字段校验、幂等锚点和失败降级。
- 定义完整 AUDIT coverage 清单，说明每个审计事实基于哪个 timeline event、是否需要增强、是否需要新增业务 event，或由哪个 port wrapper 生成 `ObservabilityObservationEvent`。
- 定义唯一可实施路径：`ObservabilityProjectorHost` 异步调用 fixed `AuditProjector`，`AuditProjector` 是产品路径中唯一允许调用 `AuditEventWriter` 的组件。

## 非范围与安全排除

- 本 change 不定义新的采集入口、event bus、wrapper taxonomy、diagnostic context、observation event shape 或 projector host；这些由 `add-ts-trace-log-linking` 拥有。
- 本 change 不新增 `TimelineEventType`。需要新增业务 event 的场景，只在清单中标注 future owner，由对应业务 owner change 定义。
- 本 change 不定义 audit 查询 API、报表产品面、operator UI、远端审计平台 SDK、独立 audit queue、retry worker、后台 replay 或从日志 / 指标 / trace 回放生成 audit 的路径。
- raw prompt、raw thinking、raw model output、tool args/result、attachment content、raw provider response、credential、secret、token、stack trace、未脱敏路径、free-text reason、动态 payload、trace id/span id 和高基数字段不得进入 `AuditEvent`。

## 核心实现策略

- AUDIT 只消费 `ObservabilityObservationEvent`，coverage 由 `AuditProjectionPolicy.covers(event)` 决定。
- `AuditProjector` 从 observation 的 `ownerScope`、`stableRefs`、`boundary`、`operation`、`outcome`、`occurredAt`、`durationMs`、`usage` 和 `diagnosticSnapshot` 中选择安全字段。
- `AuditEvent` 写出前必须通过 AUDIT surface redaction policy。
- `AuditEventWriter` 只由 `agent-observability` 的 `AuditProjector` 调用，并由 `agent-app` composition 注入真实 sink。
- audit sink failure、redaction failure、serialization failure 或缺失可信 owner/time 时，只产生 bounded audit degradation evidence，不改变业务结果。

## 影响

- `add-ts-trace-log-linking` 提供统一 observation acquisition、diagnostic snapshot 和 projector host。
- `add-ts-redaction-policy` 提供 AUDIT surface redaction 和 candidate gating。
- `add-ts-structured-logging`、`add-ts-runtime-metrics`、`add-ts-health-check` 可以消费同一 observation stream，但不得复用 audit output 反推自己的输入。

## 归档前基线提升计划

- `openspec/specs/audit-sink/spec.md`
