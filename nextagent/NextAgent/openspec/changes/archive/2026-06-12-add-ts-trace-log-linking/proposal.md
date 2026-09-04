## 背景与问题

`add-ts-structured-logging` 已经定义正式业务诊断日志的安全结构和触发边界，但日志仍需要和一次请求的运行上下文、异步调用链路稳定关联。否则 operator 只能看到孤立日志，难以把入口、runtime acceptance、异步执行和 terminal commit 上的诊断事实串成一次可追踪执行。

本 change 的目标，是补齐 request/run 诊断上下文传播、runtime timeline event 监听、diagnostic snapshot、统一 observation 输入和结构化日志关联规则，让日志、审计、指标、health diagnostics 和后续 trace projector 能基于同一条 observation stream 使用稳定业务标识完成关联。

## 第一性原理

trace/log linking 的唯一职责，是让一次执行产生的结构化日志能够通过稳定业务标识被可靠串联，同时不让 observability 实现细节进入核心业务契约。

日志、后续 trace projector 和 request/run 诊断上下文都是派生诊断面，不是 request truth、terminal truth、audit truth、session history truth 或 checkpoint truth。

## 要解决的问题

- 孤立结构化日志难以确认是否属于同一次请求、同一个 run 或同一条 capability invocation。
- 异步调度和当前 request 执行日志边界跨越后，request/run 诊断上下文可能丢失。
- 如果只有实现层 trace 信息而没有安全业务标识，operator 无法稳定回到 `sessionId`、`requestRunId`、`messageId`、`timelineEventId` 或 `capabilityInvocationId`。
- 各业务包自行打 trace/log 容易产生字段不一致、绕过 redaction，或泄露 raw prompt、raw model output、raw tool args/result、raw content、secret、credential、stack trace 或未脱敏路径。

## 目标效果

完成后，operator 可以通过稳定业务标识，把一次请求从 Web/API 入口串到 runtime acceptance、异步执行日志和 terminal commit 的诊断输出。`agent-runtime` 提供统一的 `RunTimelineEvent` listener 机制；channel、observability 和后续 runtime-owned consumer 都获取同一份 runtime 补齐后的领域事件。mapper 同步把 runtime event 或 wrapper observation 转成 `ObservabilityObservationEvent`，再通过 `ObservabilityProjectorHost.acceptObservation(event): void` 交给 host 内部 bounded handoff queue / mailbox，由固定 projectors 异步生成可观测结果。模型调用动作默认不写 canonical timeline；由 `ModelInvocationService` observability wrapper 生成 model invocation observation。持久化边界仍使用 `RunTimelineEventRecord`，非持久化边界只使用 `RunTimelineEvent`。

日志关联失败、上下文缺失或 logger sink failure 不会改变业务结果。

## 变更范围

- 新增 `trace-log-linking` spec，冻结 request/run 诊断上下文、结构化日志关联字段和降级规则。
- 明确结构化日志中的稳定业务标识是主关联键；trace/span 等 observability 字段不进入当前 `DiagnosticContext`。
- 明确跨 Web、runtime acceptance、异步执行和 terminal commit 边界传播当前执行上下文。
- 明确结构化日志关联字段先经过 redaction policy，再进入各 surface projector。
- 明确 runtime 原生基线包含 canonical timeline append 与 channel stream fanout，并以 runtime-owned `RunTimelineEvent` listener 覆盖 persisted 和 live-only event。
- 明确 `ObservabilityProjectorHost.acceptObservation(event): void` 是 mapper / wrapper / system observation producer 进入异步 projector fanout 的唯一业务路径接口。
- 收紧 `agent-contracts` 暴露面：审计、日志、指标、脱敏和 projector host 的领域对象停留在 `agent-observability`；`agent-contracts` 不提供 observability subpath。
- 明确结构化日志关联失败时产生 bounded observability degradation evidence。

## 非范围与安全排除

- structured logging schema、audit truth、metric inventory、health judgment、runtime lifecycle state 和 OpenTelemetry exporter 由各自 owner change 定义。
- 核心契约不新增 trace id、span id、通用 observability port 或具体观测 SDK 类型；trace context capture、trace exporter、outbound propagation、慢边界专用 wrappers 和 stream/replay 专用 linking 不属于当前 change。
- 本 change 不定义 `TraceDiagnosticRecord`、local trace JSONL 或 remote trace adapter；后续 trace projector 如需这些输出，必须独立定义。
- 本 change 的所有诊断输出只使用安全、低基数、可脱敏字段；raw prompt、raw thinking、raw model output、tool args/result、attachment content、raw provider response、credential、secret、token、stack trace、未脱敏路径、free-text reason、动态 payload、trace id/span id 和开放式 usage/metric key 不属于允许输出形态。
- 模型 usage 复用 `ModelUsage` shape：`inputTokens`、`outputTokens`、`totalTokens`；不引入 `modelInputTokens` 等二次命名。

## 核心实现策略

冻结以下黑盒策略：

- 请求入口建立受控 request/run diagnostic context。
- runtime 在 request acceptance、execution、terminal commit 和恢复/取消路径维护当前上下文。
- runtime 发布 `RunTimelineEvent` 时同步补齐 event id、sequence、createdAt、agentId、agentVersion 和由 runtime 设置的 `persistence`；持久化 event 在 successful append 后通知 listeners，非持久 event 以 `persistence=LIVE_ONLY` 通知 listeners。
- runtime event listener 或 wrapper observation 边界 snapshot 当前 diagnostic context，projector 从 diagnostic snapshot / observation event 注入安全关联字段。
- mapper 同步生成 `ObservabilityObservationEvent` 并调用 `ObservabilityProjectorHost.acceptObservation(event): void`；host 内部完成 bounded queue / mailbox handoff，projectors 异步消费。
- 结构化日志关联缺失或写出失败只产生 observability degradation，不改变主流程结果。

## 黑盒效果

- 一次请求的关键结构化日志能通过 `sessionId`、`requestRunId`、`requestContextId` 等稳定业务标识关联。
- 异步执行和 terminal commit 的诊断上下文缺失时，系统留下安全降级证据。
- structured log linking 失败不影响 request acceptance、model invocation、capability invocation、gateway call、stream projection、terminal commit 或 recovery。

## 影响

- 需要补齐结构化日志关联字段规则，避免各模块自行发明 trace/log 语义。
- 需要明确异步执行和 terminal commit 期间的上下文传播规则。
- 需要与 `add-ts-structured-logging`、`add-ts-redaction-policy`、`add-ts-audit-sink`、`add-ts-runtime-metrics`、`add-ts-health-check` 和 release gates 保持一致。
- 测试需要覆盖正常关联、上下文缺失、redaction、异步边界和非阻塞降级。

## 归档前基线提升计划

- `openspec/specs/trace-log-linking/spec.md`
