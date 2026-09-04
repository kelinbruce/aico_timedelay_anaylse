# ADR: Agent Execution Trajectory Safe Diagnostics

## Status

Accepted

## Context

NextAgent 需要支持一次 request 的 agent 执行复盘，但仓库安全边界同时禁止把 raw prompt、raw model output、raw tool args/result、stream delta、provider payload、path、credential、token 或 tracing SDK 字段写入正式 observability surface。现有 runtime log、structured log、audit 和 trace 也已分离 owner，不能为了 trajectory replay 再引入一套并行 event bus 或让 runtime log 充当唯一事实源。

## Decision

系统采用一套最小 agent execution trajectory replay skeleton，首版覆盖 context assembly、capability selection、sandbox execution、first visible model content 和 terminal。所有 trajectory 输入统一进入现有 `ObservabilityObservationEvent` stream，由 `agent-observability` 以 structured logging 产出主复盘视图。

安全约束如下：

- trajectory 只记录稳定业务 refs、低基数 reason code、bounded duration/usage 和安全摘要；
- runtime 已拥有的 canonical 或 live-only 事实优先由 timeline listener 提供；
- 只有没有 authoritative fact 的边界才允许 approved wrapper 或 producer 补 observation；
- 首版不强行引入 `AGENT_TURN_STARTED` / `AGENT_TURN_COMPLETED` 或独立 `STREAM_VISIBLE_OUTPUT_STARTED` vocabulary；可见输出边界使用 `MODEL_STREAM_FIRST_VISIBLE_CONTENT`，稳定 turn ref 留待后续明确 owner 后再引入；
- `runtime_diagnostic` surface 继续只承载编排诊断，不拼装完整 trajectory replay；物理输出统一进入 operational writer owning的 numbered JSONL family；
- `traceId`、`spanId`、`traceparent` 等 tracing SDK 字段不是 replay 主关联键。

## Consequences

优点：

- 可以在不泄漏敏感内容的前提下，稳定复盘一次 request 的主执行路径；
- 保持 observability、runtime、core、context、sandbox 各自唯一 owner，不引入第二套 carrier；
- structured trajectory log、audit、metrics 和 trace 继续共享同一 observation handoff，degradation 也保持 non-blocking。

代价：

- trajectory 无法表达 raw chain-of-thought 或正文级诊断；
- 某些轨迹点在首版可能只以 observation 存在，而不是 durable timeline fact；
- 需要在长期设计文档里持续维护哪些轨迹点由 runtime 拥有，哪些只由 approved producer 提供。
