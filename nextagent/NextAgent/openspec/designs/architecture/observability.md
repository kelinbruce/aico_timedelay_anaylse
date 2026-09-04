# Observability Signal Inventory

## 目的

本设计补充 `observability-boundaries.md`，聚焦当前已落地的 observation signal inventory，而不是重定义 observability owner 边界。它为 runtime 内部调度、恢复、terminal commit 降级、health 探测和应用启停提供一个统一索引，方便后续将 signal 映射到 structured logging、audit、metrics 和 health diagnostics。

## 当前信号分组

- `request_lifecycle`
  覆盖 request accepted、terminal committed/failed、command rejection 和 terminal commit degradation。
- `system`
  覆盖 scheduler 与 runtime 内部控制面，包括 `RUN_DISPATCHED`、`LANE_DRAIN_*`、`RECOVERY_SCAN_*`、`APP_START`、`APP_SHUTDOWN`。
- `health_probe`
  覆盖 primary/deep health 聚合完成后的 `HEALTH_EVALUATED`。
- `model_invocation`、`capability_invocation`、`gateway_call`
  继续承载模型、能力和网关边界观察。
- `lifecycle_hook`
  覆盖 hook invocation、并行 observe 降级、control outcome 与安全 mutation summary；mutation summary 只在 runtime 实际应用 mutation 时产生，observe-only hook 返回的 ignored mutation 只记 diagnostic code 不记 mutation summary；它服务 structured logging / metrics / trace / audit 导航，但不形成新的 canonical timeline truth。

  `HOOK_INVOKED` 是 runtime 生成的 timeline-only hook invocation evidence，每次 hook invocation 产生一条。字段至少包括：`requestRunId`、`sessionId`、`requestId`、`hookId`、`agentId`、`agentVersion`、`stage`、`kind`、hook effects、execution strategy、invocation idempotency key、invocation `status`（`SUCCESS` / `TIMEOUT` / `FAILED`）、时间信息、`outcome`、`safeReason` 或 `error`、`mutationSummary`（仅 applied mutation）、ignored control output diagnostic（observe-only 返回被忽略的 outcome/mutation 时）、safe observe side-effect diagnostic（observe-only 外部副作用失败/超时时）。

  `mutationSummary` 只包含 stable mutation kind、replaced field names 和每个替换字段的 safe size/count/digest metadata；MUST NOT 包含字段值、raw prompt、model output、final content、tool arguments、tool result content、attachment content、credential、token、手机号、客户标识、filesystem path、raw provider error、full hook input、full hook result、full boundary 或 full mutation payload。

  Redaction 规则：`HOOK_INVOKED`、logs、metrics、audit events、control signals 和 safe diagnostics MUST NOT 包含 raw prompt、model messages、model output、finalContent、tool args/result、attachment content、credential、token、手机号、客户标识、路径、完整 boundary、完整 mutation、observe side-effect payload、external response body 或 external raw error。`BEFORE_MODEL_INVOKE` 的 `messages` boundary 可被 enabled hook code 在内存中读取，但上述观测输出仍然禁止输出 raw messages。

  Observe side-effect diagnostics MUST 使用 safe status / reason codes 和 safe idempotency metadata only；MUST NOT 包含 side-effect payloads、external response bodies、external raw errors、customer data、credentials、paths、prompts、model outputs、final content、tool arguments、tool result contents 或 attachment contents。

  `DENY` / `BLOCK` / `PEND` 等改变 request lifecycle 的 hook outcome 记录在同一条 `HOOK_INVOKED.outcome` 中，不再发布单独的 `HOOK_OUTCOME_APPLIED` event。`HOOK_INVOKED` 不进入首版 `StreamEventType`；channel 默认不向用户对话流投影。hook timeout/failed 如果未改变主流程，只通过 `HOOK_INVOKED`、结构化日志、指标或 audit sink 表达。
- `agent_execution_trajectory`
  覆盖 `CONTEXT_ASSEMBLY_COMPLETED`、`CAPABILITY_SELECTED`、`SANDBOX_EXECUTION_COMPLETED` 和 `MODEL_STREAM_FIRST_VISIBLE_CONTENT`，并与 terminal outcome 关联。这组信号服务一次 request 的首版安全 replay skeleton：runtime 已拥有的 capability/runtime facts 通过 listener 或 runtime log-derived observation 提供，first visible content 由 model wrapper observation 提供。它们只输出稳定 refs、低基数 reason code、bounded duration/usage 和安全摘要，不承载 raw prompt、raw model output、tool payload、stream delta 或 trace SDK 字段。稳定 `AGENT_TURN_*` vocabulary 和独立 `STREAM_VISIBLE_OUTPUT_STARTED` 仍是 deferred scope。

## Structured Logging 投影

当前 structured logging 对内部 lifecycle signal 的稳定映射为：

- `system` + `RUN_DISPATCHED` / `LANE_DRAIN_*` -> `SCHEDULER_DIAGNOSTIC`
- `system` + `RECOVERY_SCAN_*` -> `RECOVERY_DIAGNOSTIC`
- `health_probe` + `HEALTH_EVALUATED` -> `HEALTH_PROBE_RESULT`
- `system` + `APP_SHUTDOWN` -> `APP_SHUTDOWN`
- `agent_execution_trajectory` -> `AGENT_EXECUTION_TRAJECTORY`

这些映射只投影安全摘要、stable refs、低基数状态和有界数值。它们不是新的 timeline truth，也不是新的 gateway record。

`StructuredLogProjector` 按 `runId` 维护有界 `RequestLogSummaryAccumulator`，它是唯一知道“哪些 observation 实际到达 LOG surface”的 owner。每个 run 只保存：是否观察 accepted、已开始/已终止 Model invocation key、已处理 timeline event id、三个 usage 可选累加值、usage completeness、唯一 Capability invocation id 集合和 queue-drop marker。`REQUEST_ACCEPTED` 创建或重置 accumulator；Model started 记录 invocation key，Model completed/failed 以 `timelineEventId` 去重并闭合 started；`CAPABILITY_STARTED` 仅在存在唯一 `capabilityInvocationId` 时加入集合；host queue overflow 时调用 projector 的内部 `onObservationDropped(event)` hook 设置 drop marker。terminal 到达时计算 `status`、已知 usage、`toolCallCount` 和 `summaryStatus`（`COMPLETE` 或 `PARTIAL`），写 entry 并清除 run state。没有 accepted、存在未闭合 Model、usage 不完整、queue drop 或重复/无坐标事件导致统计不可证明时为 `PARTIAL`，且不得为未知统计伪造零值。accumulator 只服务日志 projection，不回写 timeline/runtime/persistence；terminal 后立即释放。

## Non-blocking 约束

内部 lifecycle observation 的发射必须保持 non-blocking：

- 调度、恢复、terminal commit、health 和关闭流程都只做同步 handoff。
- observation 发射失败不得阻断 request lifecycle、terminal fallback、health truth 或 app shutdown。
- signal 不新增持久化 observation record，不反向要求 runtime 持久化内部调度事件。

## 与长期基线的关系

长期 owner 边界仍以 [observability-boundaries.md](/D:/code/NextAgent/openspec/designs/architecture/observability-boundaries.md) 为准；本文档只作为当前 signal inventory 和内部 lifecycle observation 的补充承载。
