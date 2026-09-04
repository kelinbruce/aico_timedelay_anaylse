# add-ts-audit-sink

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Observability 和 Audit

状态：active
类型：实施 change
主要 owner：`agent-observability`、gateway audit adapter
依赖：`ship-ts-minimal-agent-kernel`

目标：
- 将最小内核 no-op `AuditEventWriter` 替换为真实 audit 记录边界。

能力组共享输入：

整理状态：已整理为能力组级输入

范围标识：本文件的共享输入是能力组背景；具体实施范围、最小闭环和验收任务以对应 active OpenSpec change 的 proposal / design / spec / tasks 为准。若本文件的大能力清单与 active change 的最小 stable inventory 不一致，不得扩大当前 change 范围。

能力组目标：
- 补实可观测、审计、脱敏和健康检查，同时保持业务模块不直接依赖 observability SDK/API 类型。

共享规格输入：
- 核心契约只冻结 `AuditEvent`、`AuditEventWriter` 和 `ErrorNormalizer`；不定义独立 `ExecutionTrace`、通用 `ObservabilityPort`、`MetricRecord`、`TraceId`、`SpanId` 或 OpenTelemetry SDK 类型。
- 首批 audit event 最小集合包括 request.accepted、request.rejected、model.selected、model.started、capability.invoked、capability.completed、capability.failed、capability.denied、hook.invoked、hook.completed、hook.failed、policy.evaluated、policy.allowed、policy.denied、policy.failed、attachment.accepted、attachment.rejected、routing.decision、terminal.committed、safe_error.emitted。
- audit event 不记录 raw prompt、raw model output、raw attachment content、raw secret，只记录 refs、safe summary、owner scope、session id、run id、message id、capability id、hook id、policy id、outcome、reason code、timestamp。
- 首批 metrics 至少覆盖 request accepted/rejected、request terminal by status、request response time、active/queued run gauge、queue wait、run duration、model invocation count、model latency、model failure、model token usage、tool invocation count、tool response time、tool completed/failed/denied/timeout/canceled、stream live delivery、stream replay、stream gap、terminal projection failure、checkpoint write failure、recovery attempt/success/failure、terminal commit retry。
- 首批 health check 至少区分 liveness、readiness 和 dependency availability。
- liveness 表示进程存活。
- readiness 表示 runtime admission 可安全接收新请求，且关键依赖可用。
- dependency availability 至少覆盖 session store、run/timeline store、checkpoint store、model provider、gateway adapter，以及启用时的 sandbox gateway。
- 降级或不可用时返回可诊断 reason code，但不得暴露 secret、raw prompt、raw model output 或 raw content。
- 启用 sandbox 时 metrics 还必须覆盖 sandbox execution count、timeout、denied、unavailable、failure。
- 默认敏感信息包括 token、secret、credential、raw prompt、raw model output、raw attachment/content、用户隐私字段、内部路径和配置路径。
- safe error、日志、trace、audit、metrics、stream diagnostic 和 health diagnostic 必须使用同一套 redaction policy。
- 输出只能包含 presentation-safe 字段、refs、reason code、safe summary、session id、run id、message id、capability id、hook id、policy id、timestamp、outcome 等诊断所需信息。
- 脱敏规则不得把 raw secret、raw prompt、raw model output 或 raw content 写入日志、trace、audit、stream 或 safe error。

并行边界：
- 业务 package 不得直接依赖 tracing、metrics、logging SDK/API 类型，不得散落 ad hoc operational log、manual span 或 manual metric。
- 观测采集优先通过 event subscriber 消费 event envelope；没有 event stream 但 public port 本身是权威边界时，由 composition-time wrapper/decorator 生成 observability internal observation event；entrypoint middleware/interceptor 只记录 transport-safe facts。业务包不得显式调用结构化日志 helper。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
