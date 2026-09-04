## 背景和现状

本 change 关注 request/run diagnostic context 如何被稳定 snapshot 到观测输入，并让后续结构化日志、审计、指标、health diagnostics 和后续 trace projector 能够基于同一 observation stream 做关联。业务模块可以添加 classified diagnostic candidate；统一 mapper 和 projector host 负责把这些候选信息按 surface policy 转成安全诊断输出。

## 第一性原理

trace/log linking 的唯一职责，是让一次执行产生的结构化日志和后续观测投影能够通过稳定业务标识被可靠串联，同时不让 observability 实现细节进入核心业务契约。

日志、后续 trace projector 和 request/run diagnostic context 只提供诊断导航，不拥有业务真相。业务真相仍由 runtime、session、gateway、audit、timeline、checkpoint 或对应 owning boundary 维护。

## 要解决的问题

本 change 解决的是诊断关联断裂问题，而不是日志内容本身的问题：

- 同一请求在入口、runtime acceptance、异步执行和 terminal commit 中产生多条结构化日志，但缺少稳定共享关联。
- 如果只有实现层 trace 信息而没有业务 id，无法稳定定位到用户会话、请求、消息、timeline event 或 capability invocation。
- 异步执行和异步观测消费如果依赖 consumer 当前 ALS，容易丢失当前 request/run 诊断上下文。
- 手工散落的 trace/log 字段或 trace attribute 会绕过统一 redaction，或者把 SDK 类型、trace id/span id 误推入核心契约。

## 黑盒目标

系统对一次用户请求从入口、runtime acceptance、异步执行到 terminal commit 的结构化日志、审计和指标投影，能够通过稳定业务标识定位到同一条执行链。operator 不读取 raw payload，也能回答：

- 这条日志属于哪个 session、request/run、message、timeline event 或 capability invocation；
- 它发生在请求生命周期的哪个阶段；
- 它是否跨过 Web、runtime 或 observability 边界；
- 是否存在 diagnostic context 缺失、logger sink 失败、serialization failure 或 redaction 降级；
- 后续应查 audit、metrics、health、timeline 还是 provider/gateway dependency 状态。

## 边界

- 负责：request/run diagnostic context、结构化日志关联字段、runtime timeline event 监听、统一 observation 输入模型、上下文缺失降级、跨异步边界关联连续性。
- 依赖：structured logging、audit sink、runtime metrics、health check 和 redaction policy 的已有或并行 change 消费本 change 提供的同一 observation 输入模型。

## 非范围与安全排除

本 change 不定义新的核心 `TraceId` / `SpanId` DTO、structured logging 事件 schema、redaction 规则、audit 事实、metrics taxonomy、health 判定或 runtime 状态机，也不实现 OpenTelemetry exporter、trace context carrier、远端 trace sink、trace storage、trace query API、通用 event bus、动态 projector registry、持久重试队列或后台 replay。

安全排除统一适用于本 change 的所有输入、输出和后续实现任务：raw prompt、raw thinking、raw model output、tool args/result、attachment content、raw provider response、credential、secret、token、stack trace、未脱敏本地路径、free-text reason、动态 payload、trace id/span id 和开放式 metric/usage key 不能进入日志、审计、指标、health diagnostic 或 runtime/channel public DTO。

## 黑盒效果

- 正常请求从入口到终态的关键结构化日志能按稳定业务标识串联。
- trace id/span id 不是本 change 的上下文字段；后续 trace projector 如需使用 SpanContext，必须在 trace change 中定义 implementation-owned carrier。
- 上下文缺失、redaction drop、logger sink failure 和 serialization failure 都有安全降级证据。
- 任何 log/trace 关联失败都不阻塞主流程，也不改变用户可见结果。

## 与已冻结架构和契约的一致性

本 change 复用以下已冻结约束：

- 核心契约不定义独立 `ExecutionTrace`、通用 `ObservabilityPort`、`MetricRecord`、`TraceId`、`SpanId` 或 observability SDK 类型。
- tracing、metrics、logging 和 audit projection 由 observability 实现层通过 runtime timeline event listener 优先、composition-time wrapper 兜底、middleware/interceptor 或 auto-instrumentation 接入。
- 业务定位优先使用 `tenantId`、`subjectId`、`sessionId`、`requestRunId`、`messageId`、`timelineEventId`、`capabilityInvocationId`、`auditEventId` 等稳定业务标识。
- safe error、日志、trace、audit、metrics、stream diagnostic 和 health diagnostic 必须执行同一套 redaction policy。

当前设计新增一条共同约束：ALS `DiagnosticContext` 只保存当前执行链的 request 级业务 refs、诊断候选信息和业务补充 attributes；它不保存 `traceId`、`spanId` 或不明确的 `traceContext`。权威 event / fact append 或 wrapper observation 边界必须 snapshot 当前 `DiagnosticContext` 到观测输入；`agent-observability` projector 只消费该 snapshot 或 observability internal observation event，不依赖 consumer 当前 ALS。

trace context 不属于本 change 的 `DiagnosticContext` 字段，也不写入 `RunTimelineEvent.inlinePayload`，不要求本 change 为 `RunTimelineEventRecord` 新增 metadata 字段。runtime 生成 timeline 业务事实时不显式写入 trace id / span id，也不生成或刷新 trace id / span id。首版 trace/log linking 通过 stable business refs 与 diagnostic snapshot 关联日志、审计和指标；后续真实 trace projector 如需 SpanContext、trace id 或 span id，必须在后续 trace change 中通过 observability implementation-owned carrier / projector 定义，不回填 timeline。

`SessionMessage` 不作为 trace/span carrier。message store 不被 observability wrapper 用来注入 `traceId` 或 `spanId`；message 只通过 `messageId`、`requestId`、`runId`、`timelineEventId` 等稳定业务 refs 间接关联到对应诊断投影。

首版提供一个进程内 `DiagnosticContext`、一个 diagnostic snapshot helper、一个 observability internal observation event shape、一个 runtime-owned `RunTimelineEvent` listener 接入点，以及 `ObservabilityProjectorHost.acceptObservation(event): void` 作为统一 handoff 接口。通用 event bus、动态 subscription registry、跨进程 context store、trace exporter、trace diagnostic record、outbound propagation pipeline 和插件化 projector registry 都归入非范围。

本组 observability changes 的共同采集顺序必须固定为：已有权威 `RunTimelineEvent` / fact 能覆盖时，由 runtime-owned `RunTimelineEvent` listener 接收 runtime 补齐后的领域事件；其中持久化 event 先写入 `RunTimelineEventRecord`，successful append 后再发布给 listeners，非持久 event 以 `RunTimelineEvent.persistence=LIVE_ONLY` 直接发布给 listeners。没有 timeline fact 但 public port 本身是权威边界时，才由对应 wrapper 生成 observability internal observation event；entrypoint middleware / interceptor 只处理 transport-safe facts；stream wrapper 只观察 normalized visible stream facts。同一 authoritative fact 只能有一个采集入口，多个 projector 可以消费同一个 snapshot / observation event，但不得让 timeline listener、port wrapper、middleware 或 stream wrapper 重复观察同一 fact 并为同一 surface 生成重复输出。

本 change 是整组 observability changes 的主设计承载点。它定义统一 observation 输入模型、采集优先级、runtime timeline / channel projection owner 边界、port wrapper taxonomy、cross-surface dedup 和 projector host 处理流程。`add-ts-structured-logging`、`add-ts-audit-sink`、`add-ts-runtime-metrics`、`add-ts-health-check` 和后续 trace projector 只能在该主设计上声明各自 processor / projector 的 coverage、schema、sink、failure 和 validation；它们不得重新定义采集入口、context carrier、event bus、wrapper 选择规则或 per-surface observation event。

## 唯一产品路径

从当前代码基线出发，本 change 的实施路径固定为一条：

1. `agent-runtime` 在 canonical timeline 生成点补齐 `RunTimelineEvent` 的 runtime-owned 字段，并通过 runtime-owned `RunTimelineEventListener` 发布补齐后的领域事件。
2. persisted event 先写入 `RunTimelineEventRecord`，successful append 后以 `persistence=PERSISTED` 发布给 listener；live-only event 由 runtime-owned persistence policy 决定，不创建 `RunTimelineEventRecord`，直接以 `persistence=LIVE_ONLY` 发布给 listener。
3. `agent-app` composition 注册 observability listener；listener 调用 `agent-observability` 的 timeline observation mapper，同步生成 `ObservabilityObservationEvent`。
4. 无 runtime timeline / authoritative event 覆盖的 public port 边界，由 `agent-app` composition-time wrapper 同步生成同一 shape 的 `ObservabilityObservationEvent`。
5. mapper / wrapper / system observation producer 统一调用 `ObservabilityProjectorHost.acceptObservation(event): void`；host 内部 bounded queue / mailbox 完成 handoff。
6. host 异步调用固定 projector set；LOG、AUDIT、METRIC、HEALTH 和后续 TRACE 只作为同一 observation stream 的 processors。

这条路径替代当前产品路径中的 `timelineObservers` 外部 observer 注入、trace-linked timeline store 包装、直接 `project()` / `await traceLogProjector.project()` 调用和 per-surface 入口。实现时不得保留第二条从 timeline/store/channel/port 直接到某个 surface sink 的产品路径。

## Runtime Timeline 与 Channel Projection 契约

`agent-runtime` 仍然只发布 `RunTimelineEvent`，不得发布 log / audit / metric / trace 专用事实，也不得 import logger、audit writer、metrics registry、tracer、observability SDK 或 projector。`RunTimelineEvent` 是否持久化由 runtime 按业务目的决定；本 change 不为了可观测性反向要求某个 event 必须持久化。runtime 应在事件发布前补齐 `eventId`、`sessionId`、`runId`、`requestId`、`requestContextId`、`sequence`、`createdAt`、`agentId`、`agentVersion` 和 `persistence`。

对比 `main` 代码基线后，本 change 不能把“只监听持久化 append”当成充分条件。当前实现中 `RuntimeOwnedAgentRunStatePort.emitEvent()` 会把大多数 core 发出的 event 写入 `timelineStore.appendEvent()`，因此 store wrapper 眼下能覆盖 `MODEL_INVOCATION_*`、`CAPABILITY_*`、`LLM_*` 和 `DEGRADATION_NOTICE` 等事实；但这只是当前实现形态，不是设计前提。`RunTimelineEvent` 是否持久化由 runtime 按业务目的决定，未来可以只持久化 request accepted、terminal、checkpoint/recovery 必需节点和关键业务节点。观测设计必须覆盖 `persistence=LIVE_ONLY` 的 timeline event，否则结构化日志、指标和 trace diagnostics 会丢失细粒度 lifecycle / latency / stream timing 事实。

`timelineObservers` 由 3045225 引入，语义上服务外部 observer，不属于 runtime 必须保留的清晰 contract；本 change 应清理该产品路径依赖，并收敛为明确语义的 runtime-owned `RunTimelineEventListener`。listener 的输入是 runtime 补齐后的 `RunTimelineEvent` 领域对象，不是 `RunTimelineEventRecord`。`RunTimelineEventRecord` 只用于持久化边界，是可直接映射 PO / SQLite row 的 gateway DTO；它必须新增 `agentVersion`，但不携带 `persistence`。`RunTimelineEvent.persistence` 由 runtime 设置为 `PERSISTED` 或 `LIVE_ONLY`，producer 不能设置或覆盖。`RuntimeOwnedAgentRunStatePortDependencies.onTimelineAppend` 仍只是 runtime 内部把 run-state append 结果交回 coordinator 以驱动 channel stream fanout 的回调，不是 observability extension point。

runtime listener mechanism 只负责把补齐后的 authoritative `RunTimelineEvent` 交给已注册 listeners。channel、observability 和后续 runtime-owned consumer 都应通过同一个 listener mechanism 获取事件；差异只在各自 listener 的处理逻辑。listener 不得修改 `RunTimelineEvent.inlinePayload`、sequence、createdAt、owner/agent scope、terminal truth 或 channel projection；listener failure 不得影响 append、terminal commit、stream projection、recovery 或 scheduler。channel-web 仍通过自己的 stream allowlist / projection function 决定是否以及如何呈现给客户端；observability 不订阅 channel stream 来构造审计、日志或指标事实。

runtime-owned persistence policy 只能由 runtime composition / runtime owner 配置，默认保持当前产品行为：已有 runtime/core timeline facts 继续持久化。该 policy 不是 observability 配置项，不能由 mapper、projector、logger、audit、metrics 或 channel 决定，也不能由 agent/core producer 通过 `RunTimelineEvent.persistence` 覆盖。测试必须覆盖 live-only event 会进入同一 listener、不会创建 `RunTimelineEventRecord`、不会进入 channel stream queue。

`RunTimelineEvent` 是否发送给客户端、以什么 DTO shape 发送给客户端，由 `agent-channel-web` 的 stream projection allowlist 和 projection function 决定；本 change 不要求 runtime event 自身声明 `client-visible`、`diagnostic-only` 或 public DTO 形态。新增 / 增强 runtime event 时，只需要维持以下 owner 边界：

- event type 是稳定 canonical timeline type；不得使用 surface-specific 名称，例如 `AUDIT_*`、`LOG_*` 或 `METRIC_*`。
- inline payload 仍是 runtime 业务 payload；为了可观测性补强字段时使用 runtime 自身业务需要且安全的低基数字段或有界数值字段，例如 status、phase、providerKind、capabilityKind、stable invocation refs、safeErrorCode、safeErrorCategory、durationMs、normalized model usage、size class 或 stable reason code。
- observability operation 映射由 `agent-observability` mapper 完成，不由 runtime 直接表达 surface 语义。
- 如果某事实已经被 runtime 持久化为 `RunTimelineEventRecord`，runtime 必须先完成 successful append，再发布 `persistence=PERSISTED` 的 `RunTimelineEvent` 给 listeners。若 runtime 按业务目的选择不持久化某个 `RunTimelineEvent`，runtime 发布 `persistence=LIVE_ONLY` 的 `RunTimelineEvent`；该 event 只能作为诊断投影输入，不能作为 durable audit truth、recovery truth 或 replay truth。channel stream projection 不是 observation source。

首版 runtime timeline observation mapper 应在不改变持久化归属和 channel projection 归属的前提下，识别以下已存在的 runtime-owned facts：

| Runtime fact type | Observation 用途 |
|---|---|
| `REQUEST_ACCEPTED` | request accepted log、audit、phase metric、trace diagnostic link |
| `REQUEST_COMPLETED` / `REQUEST_FAILED` / `REQUEST_CANCELED` / `REQUEST_SUPERSEDED` | terminal log、audit、request metrics、trace diagnostic link |
| model invocation wrapper observation | model lifecycle、model duration、model usage、model outcome log / metric / trace diagnostic；duration 和 usage 来自 `ModelInvocationService` wrapper 对 normalized model result 的同步快照；security / credential / quota failure 是否进入 audit 由 audit projector policy 决定 |
| `CAPABILITY_STARTED` / `CAPABILITY_COMPLETED` | capability lifecycle、capability duration、capability outcome log / metric / trace diagnostic；duration 应来自 completed end event 的 `durationMs`；denied / policy / security failures 是否进入 audit 由 audit projector policy 决定 |
| `LLM_CONTENT_DELTA` / normalized visible stream facts | visible stream projection 仍由 channel 拥有；observability 只能基于 safe normalized facts 派生 TTFT / chunk latency metrics |
| `LLM_THINKING_DELTA` / `CAPABILITY_RESULT_DELTA` | 只用于 stream projection / refs；不得向 observability processors 暴露 raw thinking、args 或 result |
| `DEGRADATION_NOTICE` | unified degradation log / trace / metric where projector coverage allows |
| `ATTACHMENT_ACCEPTED` / `ATTACHMENT_REJECTED` | attachment audit/log/trace diagnostics without attachment body |

当前代码落地的 acquisition source 是：runtime persisted/live-only listener、timeline observation mapper、`ModelInvocationService` wrapper、`RuntimeCommandPort` rejection wrapper、Web entrypoint middleware、health evaluator observation 和 system observation producer。`GatewayPort` wrapper、hook / policy wrapper、attachment intake/read wrapper、safe error wrapper、large content wrapper 和 normalized stream timing wrapper 仍是后续 owner change 的采集入口；本 change 只冻结它们必须输出 `ObservabilityObservationEvent`、必须进入同一个 `ObservabilityProjectorHost.acceptObservation(event)`，不得直接写任何 surface sink。未落地 wrapper 不在当前代码中放空壳；只有存在真实 public port 接入点并被 composition 使用时才实现。

`agent-channel-web` 必须继续使用显式 stream projection allowlist 和 payload projection。未知 timeline event type 在 `agent-channel-web` schema/projection 显式允许前，不得改变 client-visible stream presentation。对已有 client-visible events，在 `inlinePayload` 新增安全 runtime 业务字段不得改变 public DTO shape，除非 channel schema 显式 allowlist 这些字段。Channel projection 仍可使用 event id、sequence、createdAt 和既有 stream semantics 进行 transport，但不得暴露 raw prompt、model output、tool args/result、attachment content、path、secret、credential、raw provider error 或 high-cardinality diagnostic candidates。

## Timeline Event 清单与修改计划

本 change 不新增 `TimelineEventType`，但必须给出现有 vocabulary 的处理计划，避免后续为了 LOG / AUDIT / METRIC / TRACE 临时补 runtime event。原则是：已经由产品路径发布的 event 先被 observation mapper 消费；已经设计但当前产品路径未发布的 event 不在本 change 补实现；只有 owning runtime / capability / attachment / hook / policy / pending-input change 证明该 event 是业务事实时，才补实现。需要新增 vocabulary 的场景，必须回到对应日志、审计、指标或 runtime owner change 审视，不能在本 change 中暗加。

对于耗时，owning execution boundary 应在 outcome observation 上写入 `durationMs`，而不是要求 observability consumer 通过 start/end 配对推导。模型调用动作不是 canonical timeline 的首选事实，首版由 `ModelInvocationService` wrapper 从调用开始到 normalized final result / safe failure 计算 `durationMs` 并生成 `ObservabilityObservationEvent`。当前仍需要补强的 timeline end event 是 `CAPABILITY_COMPLETED`；`durationMs` 必须是有限、非负毫秒数，由拥有该调用边界的 core / capability 路径从 invocation start 到 outcome 成立时计算。`CAPABILITY_STARTED` 仍可作为 lifecycle / navigation fact，但不是 duration 的主输入，也不得为了 duration 要求它持久化或投影给客户端。

对于模型 token usage，`ModelInvocationService` wrapper 应在模型 provider / adapter 返回可信 normalized usage 时，把 `usage` 写入 model invocation observation，shape 与 `ModelUsage` 保持一致：`usage.inputTokens`、`usage.outputTokens`、`usage.totalTokens`。每个字段必须是有限、非负整数；provider 未返回、stream 结束时无 usage、异常 / 超时 / 本地 validation failure 无可信 usage 时省略对应字段或整个 `usage`。`usage` 是有界数值事实，可用于 metrics/audit/log/trace diagnostic policy；作为指标输出时只作为 metric value，由 `add-ts-runtime-metrics` 定义 metric name / label 策略。

| Timeline event | 当前状态 | 本 change 处理 | 后续实现 / 增强归属 |
|---|---|---|---|
| `REQUEST_ACCEPTED` | runtime product path 已发布并持久化 | 直接消费；不增强 payload | 无；mapper 使用 `attempt`、`agentId`、`agentVersion`、`status` 中的安全字段 |
| `REQUEST_COMPLETED` | terminal commit 已发布并持久化 | 直接消费；不增强 payload | 无；terminal truth 仍由 runtime/session/gateway composite commit 拥有 |
| `REQUEST_FAILED` | terminal commit 已发布并持久化 | 直接消费；不增强 payload | 无；safe error 细节只能按已有 safe fields / diagnostic snapshot 投影 |
| `REQUEST_CANCELED` | terminal commit / control path 可发布并持久化 | 直接消费；不增强 payload | 无 |
| `REQUEST_SUPERSEDED` | terminal commit / lane replacement path 可发布并持久化 | 直接消费；不增强 payload | 无 |
| `PLANNING_STARTED` | vocabulary / channel timeline-only 已设计；当前不作为 observability 必需事实 | 不补实现；runtime owner 实现后 mapper 可以识别 | runtime lifecycle owner；仅当 planning state 本身需要 durable/replay/status 事实时实现，safe payload 建议只含 `status` / `phase` / `reasonCode` |
| `MODEL_INVOCATION_STARTED` | vocabulary / channel timeline-only 已设计；当前不作为 canonical timeline 产品路径发布 | 不补实现；不作为 model duration、usage、log、audit 或 metric 的首选输入 | 如未来 runtime 证明模型调用动作本身需要业务 timeline / replay / status 事实，再由 runtime/core owner 重新提出；当前观测使用 `ModelInvocationService` wrapper |
| `MODEL_INVOCATION_COMPLETED` | vocabulary / channel timeline-only 已设计；当前不作为 canonical timeline 产品路径发布 | 不补实现；不作为 model duration、usage、log、audit 或 metric 的首选输入 | 如未来成为业务 timeline 事实，必须说明 channel projection、persistence purpose 和 wrapper dedup；当前观测使用 `ModelInvocationService` wrapper |
| `MODEL_INVOCATION_FAILED` | vocabulary / channel timeline-only 已设计；当前不作为 canonical timeline 产品路径发布 | 不补实现；不作为 model duration、usage、log、audit 或 metric 的首选输入 | 如未来成为业务 timeline 事实，必须说明 safe error payload、channel projection、persistence purpose 和 wrapper dedup；当前观测使用 `ModelInvocationService` wrapper |
| `LLM_CONTENT_DELTA` | agent-core product path 已发布；channel 可见 | 不作为日志/审计内容事实消费；metrics 只可用 event timing / refs，不读 `content` | 若需要 TTFT / chunk metrics，由 `add-ts-runtime-metrics` 通过 normalized stream observation 实现，不增强 payload |
| `LLM_THINKING_DELTA` | agent-core product path 已发布；channel 按策略投影 | 不进入 audit 或 metrics label；不读 thinking 内容 | 无；任何 thinking 诊断必须走 redaction / surface policy |
| `CAPABILITY_STARTED` | agent-core product path 已发布 | 可消费为 lifecycle / navigation observation；不增强 payload；不作为 duration 主输入 | 无；mapper 不依赖该 event 与 completed event 配对才能输出耗时 |
| `CAPABILITY_RESULT_DELTA` | agent-core product path 已发布；可能携带 result payload | observability mapper 必须忽略 raw result；不作为 audit/log/metric 内容输入 | 若需要安全摘要，应由 capability/runtime owner 后续把 `safeSummary` 作为业务安全投影补入；本 change 不改 payload |
| `CAPABILITY_COMPLETED` | agent-core product path 已发布 | 需要补强 safe payload：新增 `durationMs`；mapper 直接从该 end event 输出 outcome / duration observation，并继续使用 `status`、`safeErrorCode`、`safeErrorCategory` | agent-core capability invocation owner；dedup key 使用 `runId:toolCallId` 或 future stable invocation id；不得加入 tool args/result |
| `DEGRADATION_NOTICE` | runtime/core product path 已发布 | 应补 observation mapper；只消费 safe code/category/reason/safeSummary/status | 各 surface projector 决定是否输出；不新增 degradation-only event |
| `ATTACHMENT_ACCEPTED` | vocabulary / channel projection 已设计；当前发布路径由 attachment owner 决定 | 本 change 不补实现；有 event 时 mapper 可消费 attachment id/status/media/safe reason | `agent-attachment-runtime` owner；run-bound 接收/拒绝成为业务事实时实现，safe payload 建议 `attachmentId`、`status`、`mediaType`、`reasonCode`、`safeSummary`、可选 size class |
| `ATTACHMENT_REJECTED` | vocabulary / channel projection 已设计；当前发布路径由 attachment owner 决定 | 本 change 不补实现；有 event 时 mapper 可消费 safe rejection reason | `agent-attachment-runtime` owner；同上，不得包含文件路径、正文、原始校验错误 |
| `CONTEXT_COMPACTED` | vocabulary / channel projection 已设计；当前发布路径由 context owner 决定 | 本 change 不补实现；有 event 时 mapper 可消费 context refs | `agent-context-engine` / runtime compaction owner；compaction commit 成为 durable fact 时实现，safe payload 建议 `contextVersion`、`summaryMessageId`、`tokenEstimate`、`safeSummary` |
| `POLICY_APPLIED` | vocabulary / channel timeline-only 已设计 | 本 change 不补实现；policy observation 优先 wrapper / future policy event | policy owner；只有 policy decision 成为 request lifecycle 事实时才写 timeline，safe payload 建议 `policyId`、`stage`、`decision`、`safeReason` |
| `HOOK_DECISION_APPLIED` | vocabulary / channel timeline-only 已设计 | 本 change 不补实现；hook observation 优先 wrapper / future hook event | hook owner；只在 hook decision 改变 lifecycle、pending input 或 terminal outcome 时写 timeline，safe payload 建议 `hookId`、`bindingId`、`stage`、`decision`、`safeReason` |
| `USER_INPUT_REQUIRED` | vocabulary / channel projection 已设计；pending input owner 决定发布 | 本 change 不补实现；有 event 时 mapper 可消费 pending input refs/status | pending input owner；safe payload 建议 `pendingInputId`、`kind`、`status`、`timeoutAt`，不得包含 raw answer/body |
| `USER_INPUT_RECEIVED` | vocabulary / channel projection 已设计 | 本 change 不补实现；有 event 时 mapper 可消费 status refs | pending input owner；safe payload 建议 `pendingInputId`、`kind`、`status`、`safeSummary`，不得包含 answer content |
| `USER_INPUT_TIMEOUT` | vocabulary / channel projection 已设计 | 本 change 不补实现；有 event 时 mapper 可消费 timeout status | pending input owner；safe payload 建议 `pendingInputId`、`kind`、`status`、`safeSummary` |
| `USER_INPUT_CANCELED` | vocabulary / channel projection 已设计 | 本 change 不补实现；有 event 时 mapper 可消费 cancellation status | pending input owner；safe payload 建议 `pendingInputId`、`kind`、`status`、`safeSummary` |

因此，本 change 的代码整改范围只应包括现有 event 的 safe payload 补强、批准 wrapper 和 mapper / projector 消费侧：为 `CAPABILITY_COMPLETED` 补 `durationMs`；新增 `ModelInvocationService` observability wrapper 生成 model invocation observation，并携带 `durationMs` 和可选 normalized `usage`；补齐已存在 event 的 observation mapping、删除 timeline trace refs 注入、确保 stream delta / capability result delta 不被 raw payload 消费。补实现 `MODEL_INVOCATION_*`、`PLANNING_STARTED`、`ATTACHMENT_*`、`CONTEXT_COMPACTED`、`POLICY_APPLIED`、`HOOK_DECISION_APPLIED`、`USER_INPUT_*` 或新增任何 event，都必须在对应 owner change 中提出，并重新确认 channel projection 是否需要同步调整。

## Observation 采集矩阵

所有 observability 输出必须先进入同一条 observation acquisition path，再由 projector host 分发。每个 fact 必须在本 change 或依赖的 surface change 中声明首选输入、兜底输入和 dedup key。是否写出 LOG / AUDIT / METRIC / TRACE / HEALTH 由各 surface projector 的 `covers()` / coverage policy 决定，不由 mapper 写进 `ObservabilityObservationEvent`。

| 事实类别 | 首选输入 | 兜底输入 | Dedup key | Coverage owner |
|---|---|---|---|---|
| request accepted / terminal | `persistence=PERSISTED` 的 `RunTimelineEvent`；持久化边界写 `RunTimelineEventRecord` | 无 | `timelineEventId` 或 `runId:eventType` | surface projectors |
| model invocation outcome / duration / usage | `ModelInvocationService` wrapper；duration 从调用边界测量，usage 使用 provider / adapter 返回的 normalized `ModelUsage` | 仅当未来 runtime 出于业务目的发布 model timeline event 时，按 dedup 规则由 timeline fact 取代 wrapper | `requestRunId:stepId` 或 wrapper 生成的 `metricFactKey` | surface projectors |
| capability lifecycle / outcome / duration | runtime 出于业务目的发布的 capability timeline event；duration 使用 `CAPABILITY_COMPLETED` 的 `durationMs` | 仅当 timeline/event coverage 缺失时使用 `CapabilityInvocationPort` wrapper | `capabilityInvocationId` 或 `runId:toolCallId` | surface projectors |
| visible stream TTFT / chunk / total | runtime/channel 已有的 normalized visible stream facts | 仅当没有等价 normalized fact 时使用 normalized stream wrapper | `modelInvocationId` 或 `runId:stepId` | metrics / trace / log projectors by policy |
| request rejected before run exists | app composition 中的 `RuntimeCommandPort` wrapper | channel boundary observation | request idempotency key + owner scope | surface projectors |
| gateway owner-boundary / credential / unavailable / timeout | gateway port wrapper | 无，除非 gateway 后续发布 authoritative event | gateway category + operation + stable request/run refs | surface projectors |
| safe error emitted | safe output boundary observation | 无 | safe error code + stable request/run refs | surface projectors |
| hook / policy evaluated / allowed / denied / failed | hook / policy wrapper 或 future authoritative event | authoritative event 出现前使用 wrapper | hookId/policyId + stable request/run refs | surface projectors |
| attachment accepted / rejected / large content | 可用时使用 runtime / attachment owner event | attachment intake/read wrapper | attachment id 或 stable attachment ref + owner scope | surface projectors |
| health primary/deep evaluation | `HealthEvaluator` observation event | 无 | endpoint + component + evaluation timestamp | health / log / metric / trace projectors by policy |
| Web entrypoint response / error | channel entrypoint middleware | 无 | route category + response boundary instance | surface projectors |
| projector / sink degradation | 同一 source observation 加 projector outcome | 无 | source dedup key + surface + reason code | surface projectors |

优先级必须严格执行：同一个 authoritative fact 已存在 persisted timeline event 时，wrappers 不得为该 fact 发出第二个 observation。wrapper 被选为 source 时，必须保持被包装 port 的 input、output、exception、cancellation、timeout 和 idempotency 语义；observability failure 不得改写业务结果。Wrapper output 永远是 `ObservabilityObservationEvent`，不是 log entry、audit event、metric sample、trace span 或 health response。

## 非 Timeline Wrapper 分类

Timeline 不能覆盖所有 log/audit/metric/trace 输入。以下 wrapper category 可以作为 composition-time observation source。该 wrapper list 是设计契约；当前代码只实现并接入 `RuntimeCommandPort` wrapper 与 `ModelInvocationService` wrapper，其它 category 必须等对应 owner change 有真实 public port 接入点时再实现，不能在本 change 中保留未使用空壳。新增 wrappers 必须遵守该分类。

| Wrapper category | Port / boundary | 观测职责 | 明确排除 |
|---|---|---|---|
| `RuntimeCommandPort` wrapper | accepted run 产生前的 submit/cancel/retry | request rejected、validation/owner failure、pre-run duration | 不创建 run/timeline facts |
| `ModelInvocationService` wrapper | model stream/final invocation | 首版 model invocation diagnostics 的主输入；未来若 runtime 出于业务目的发布等价 model timeline fact，必须先定义 dedup 关系 | 不读取 prompt/raw provider body；不与 future model timeline 重复 |
| `CapabilityInvocationPort` wrapper | capability invoke | 仅当 runtime timeline 缺少等价 fact 时生成 capability diagnostic | 不读取 tool args/result；不与 capability timeline 重复 |
| `GatewayPort` wrapper | local/remote/content/model gateway operations | gateway category、outcome、duration、safe reason | 不暴露 path、SQL、credential、raw error、owner-private existence detail |
| `HealthProbe` adapter | primary/deep health evaluator | health observation 和 health-owned metrics input | 不执行写入，不接受 tenant/request body 覆盖 |
| `SafeErrorOutput` wrapper | safe API / stream output boundary | safe_error emitted observation | 不包含 raw error、stack 或 provider body |
| `AttachmentIntakeRead` wrapper | attachment intake/read/externalize | attachment accepted/rejected、large-content operation/failure | 不包含 attachment body 或 path |
| `LifecycleHookPolicy` wrapper | hook and policy evaluation | hook/policy governance observations | 不允许 hook/policy 直接写 observability sinks |
| `WebEntrypoint` middleware | HTTP route completion/error | route category、status family、duration | 不读取 request body、prompt、stream delta 或 attachment content |

每个 wrapper 必须声明 `boundary`、`operation` vocabulary、owner/time source、stable refs、dedup key，以及相对 timeline events 的 fallback/precedence relation。wrapper 不得决定 surface coverage，也不得直接写 surface sink；coverage 属于 projectors。无法建立 trusted owner scope 或 `occurredAt` 的 wrapper 必须按 surface policy 省略输出，或在安全时只输出 bounded degradation evidence；不得伪造 tenant、subject、timestamp、run id、session id 或 capability invocation id。

## 实施顺序标识

本 change 是本组 observability changes 的先行基础切片。实施顺序必须为：

1. 本 change 先落地 `DiagnosticContext`、diagnostic snapshot helper 和最小 observability internal observation event shape。
2. `add-ts-redaction-policy` 再落地 surface policy 与 diagnostic candidate gating。
3. `add-ts-structured-logging`、`add-ts-audit-sink`、`add-ts-runtime-metrics` 和 `add-ts-health-check` 只能消费上述同一套 helper / shape，不得各自复制。

若其他 change 因并行开发先行实现临时 helper，临时 helper 必须标记为 compatibility shim，并在本 change 落地后删除或改为 re-export 同一实现。不得保留第二套 DiagnosticContext、diagnostic snapshot helper 或 observation event。

## 最小 Observation Event 形态

首版 observability internal observation event 只允许表达 wrapper 兜底所需的安全字段：

- `boundary`：稳定边界分类，例如 `model_invocation`、`capability_invocation`、`gateway_call`、`health_probe`。
- `operation`：低基数 operation category。
- `outcome`：`success` / `failure` / `timeout` / `canceled` / `denied` / `degraded` 等稳定结果。
- `ownerScope`：必需可信 owner scope，字段固定为 `tenantId`、`subjectId`、`agentId`、`agentVersion`。这些字段只能来自 channel/auth boundary 与 trusted app composition、已持久化 session/run/record，或明确的 trusted system scope；不得来自请求体、模型输出、capability 参数、diagnostic candidate、consumer 当前 ALS 或 projector 默认值。`source` 不属于 `ownerScope`；如果实现需要保留来源信息，只能作为 observation metadata / validation evidence，不能混入 owner scope。
- `occurredAt`：权威事实或 wrapper observation outcome 发生时间。authoritative event 使用 owning boundary 发布事实时的时间或已有事实记录 timestamp；wrapper outcome observation 使用 operation outcome 成立的时间；invocation-start observation 使用 start time；system observation 使用 system owner 生成 observation 的时间。它不得使用 projector 写出时间、sink flush 时间、consumer 消费时间、客户端传入时间或后台补采时间替代。
- `durationMs`：可选有界耗时。只有 owning boundary 或 wrapper 能准确测量时才填写；`REQUEST_ACCEPTED`、lifecycle/navigation fact、policy decision 或 health snapshot 等没有耗时事实时必须省略。
- `usage`：可选模型 token usage，shape 直接复用 normalized `ModelUsage`：`{ inputTokens?: number; outputTokens?: number; totalTokens?: number }`。它由 `ModelInvocationService` wrapper 从 provider / adapter normalized final result 复制而来，每个 present value 必须是有限非负整数。它只能在 surface policy 允许时进入 metric value、audit/log numeric field 或 trace diagnostic attribute；metric name / label 仍由 `add-ts-runtime-metrics` 定义。
- `safeReasonCode`：可选安全 reason code。
- `stableRefs`：owner-safe refs，例如 `sessionId`、`requestRunId`、`requestContextId`、`requestId`、`messageId`、`timelineEventId`、`capabilityInvocationId`、`auditEventId`。它不重复保存 `tenantId`、`subjectId`、`agentId` 或 `agentVersion`。
- `diagnosticSnapshot`：event publish / wrapper 边界 snapshot 的 DiagnosticContext 安全候选。

当 projector、sink、redaction、serialization、context restore 或 policy check 失败但业务事实已经成立时，bounded observability degradation evidence 必须复用同一个 envelope / observation event model。Degradation evidence 只允许携带 `boundary`、`operation`、`outcome=degraded`、可信 `ownerScope`、可信 `occurredAt`、可选 `durationMs`、稳定 `safeReasonCode`、owner-safe `stableRefs` 和已 snapshot 的 `diagnosticSnapshot`。它不得定义 degradation-only event bus、surface-private degradation carrier、后台补采队列或从日志 / audit / metric / trace / health 输出回放生成的新事实。缺失可信 owner/time 时，degradation evidence 也不得伪造 tenant、subject、agent 或 timestamp；只能按 surface policy 省略输出或 fail closed。

安全排除项按“非范围与安全排除”统一处理。它不是 public contract，不进入 `agent-contracts`，不作为业务事实持久化。

authoritative fact snapshot 和 observability internal observation event 是所有 observability projector 的唯一稳定输入模型。structured log、audit、metric、trace、health 和 system diagnostic projector 必须只从该输入模型、surface policy 结果和 projector 自身的 sink 状态生成输出，不得定义 surface-private candidate carrier、surface-private observation event、per-surface event bus 或第二套 context propagation 机制。

`ownerScope` 和 `occurredAt` 是 envelope / observation event 的可信输入，不是 diagnostic candidate。缺失 `ownerScope` 或 `occurredAt` 时，audit projector 必须 fail closed；structured log、metrics、trace link、health 或 system diagnostic projector 只能在 surface policy 允许时输出 bounded degradation evidence，且不得伪造 tenant、subject、agent 或 timestamp。`stableRefs` 只允许保存已经由 owning boundary 产生的 owner-safe refs；缺失字段必须省略，不得用默认值、占位 id 或 consumer 当前 ALS 补齐。`diagnosticSnapshot` 中的 candidate 仍只是候选，进入任何输出面前都必须经过对应 surface policy。高基数或未分类 candidate 默认不得进入 metric label，也不得成为 trace/log correlation key；TRACE surface 可以接收的 candidate 也必须经过 classification 和 policy allowlist。

## 跨 Surface 投影规则

本组 changes 的 projector 共享以下规则：

1. 同一权威事实可以被 structured log、audit、metric、trace 或 health projector 分别消费，但这些 projector 必须消费同一个 snapshot / observation event。
2. wrapper 只负责把“没有 runtime timeline event 的权威 public port 边界”转成 observation event，不负责直接写 log、audit、metric 或 trace。
3. projector 只生成对应 surface 的观测输出，不得创建、修改或补建 request lifecycle、terminal commit、timeline、session、checkpoint、audit truth 或 health truth。
4. projector 写出失败只产生 bounded observability degradation evidence，不得回滚业务事实，不得触发后台补采、日志回放或离线重算。
5. 新增 observability surface 或新增采集入口时，必须先复用本 change 定义的 DiagnosticContext、diagnostic snapshot helper 和 observation event shape；确需扩展 shape 时，必须在本 change 或后续基础 contract refinement 中显式说明字段语义、安全边界和消费者。

## 执行模式与失败策略

为了不影响业务性能，同时尽可能保证可观测完整性，首版执行模式固定为：业务路径同步 map、observability 异步消费、失败有界降级。

同步业务路径只允许做以下有界 CPU 操作：

1. 在权威 runtime event listener / wrapper observation 边界 snapshot 当前 `DiagnosticContext`。
2. 从权威事实和 snapshot 映射出 safe `ObservabilityObservationEvent`，执行最小 shape 校验、字段裁剪、dedup key / stable refs 组装。
3. 把 observation event 交给 `ObservabilityProjectorHost.acceptObservation(event)`；该接口只做 non-blocking handoff，返回 `void`，不得把 handoff 状态暴露给业务路径。

同步路径不得执行 surface sink I/O、文件写入、网络发送、OpenTelemetry export、audit sink write、metric flush、日志 flush、远端 adapter 调用、后台 replay 等慢操作；不得等待 projector 或 sink 成功；不得为了可观测输出扩大 runtime transaction、terminal commit、stream projection、model invocation、capability invocation 或 gateway call 的关键路径。同步 mapping 若缺失可信 owner/time、字段超预算、schema 不合法或 handoff 背压，应按 surface policy fail closed、omit observation 或 emit bounded degradation，但不得抛回业务 owner 或改写业务结果。

异步 observability consumption 从 handoff 后开始。`ObservabilityProjectorHost` 应在当前进程内异步消费已接受的 observation event，并让固定 projector set 都得到明确 projection outcome。为了尽量保证完整性，除非 cancellation / shutdown policy 明确要求跳过，host 对已接受 event 必须尝试所有 configured covered projectors；单个 projector 的 timeout、reject、policy denial、redaction failure、serialization failure 或 sink failure 必须转换为该 surface 的 `degraded` / `failed_closed` outcome，且不得阻止其它 projectors 消费同一 event。

首版 handoff 是 best-effort in-process delivery，不承诺 durable queue、exactly-once、crash recovery、跨进程 replay 或后台补采。若需要持久队列、bounded retry worker、shutdown drain 或 exactly-once projection，必须由后续独立 change 定义 owner、存储、容量、背压、幂等、恢复和验证方式；不得在本 change 里通过日志回放、audit 回放、metric scrape 或 trace export 反向补建业务事实。

## 代码修改方案

本 change 的代码整改必须按以下固定方案实施，不把选择留到实现阶段：

1. `packages/agent-observability/src/linking/context.ts`：`ObservabilityContext` / `DiagnosticContext` 删除 `traceId`、`spanId` 和 `traceContext` 字段。`createRequestDiagnosticContext(identity)` 只从可信 identity 初始化 `tenantId` / `subjectId`；后续通过 `bindDiagnosticContext()` 补 `sessionId`、`requestRunId`、`requestContextId`、`messageId`、`capabilityInvocationId` 和 classified diagnostic candidates。需要 trace context / SpanContext 的后续能力必须由 trace projector change 定义 implementation-owned carrier。
2. `packages/agent-contracts/src/runtime/index.ts`：为 `RunTimelineEvent` 增加 runtime 补齐字段 `agentId`、`agentVersion` 和 `persistence?: "PERSISTED" | "LIVE_ONLY"`。`persistence` 只由 runtime 在发布前设置；agent/core/capability producer 不设置该字段。`persistence` 默认不进入 channel DTO，除非 channel projection 显式 allowlist。
3. `packages/agent-contracts/src/gateway/index.ts` 与 gateway-local row mapping：为 `RunTimelineEventRecord` 增加 `agentVersion`，并同步 SQLite row / mapper / migration 或 schema fixture。`RunTimelineEventRecord` 仍只作为 persisted gateway DTO / PO mapping input，不承载 live-only event，也不携带 `persistence`。
4. `packages/agent-runtime/src/lifecycle/submit.ts`、`packages/agent-runtime/src/lifecycle/agent-run-state-port.ts` 与 app composition：清理 `RequestLifecycleDependencies.timelineObservers` 和 `create-app.ts` 中对应注入，保留 runtime 内部 `onTimelineAppend` 只服务 run-state append 后的 channel stream fanout。新增明确语义的 runtime-owned `RunTimelineEventListener` / `onRunTimelineEvent(event)` 机制，listener 输入只使用补齐后的 `RunTimelineEvent` 领域对象；该机制不暴露 observability 类型，channel `stream()` 订阅保持独立。live-only 通过 runtime-owned `runTimelineEventPersistencePolicy` 决定，默认不改变现有持久化行为；当 policy 返回 `LIVE_ONLY` 时，runtime 补齐 owner / agent / refs / eventId / sequence / createdAt / `persistence=LIVE_ONLY` 后只通知 listener，不写 `RunTimelineEventRecord`，不进入 channel stream queue。
5. `packages/agent-observability/src/linking/timeline-wrapper.ts`：删除产品路径中的 trace/span payload enrichment。移除 `agent-app` composition 对 `createTraceLinkedTimelineStore()` 的使用；删除 `withTraceRefs()` / `createTraceLinkedTimelineStore()` 所在的 `timeline-wrapper.ts` 和 public export，不保留 deprecated pass-through shim。source test 必须断言 `timeline-wrapper.ts` 与 public export 不存在，并断言无 `inlinePayload.traceId` / `inlinePayload.spanId` 写入路径。
6. `packages/agent-observability/src/model/model-invocation-wrapper.ts` 与 `packages/agent-app/src/composition/create-app.ts`：新增 `ModelInvocationService` observability wrapper，并在 app composition 包装真实 model service 后再注入 `agent-core`。wrapper 保持 `complete()` / `stream()` 的 input、output、exception、cancellation 和 timeout 语义；它从 app composition 维护的 request/run observation context 取得可信 `ownerScope`、`sessionId`、`requestRunId`、`requestContextId` 和 `requestId`，生成 `boundary=model_invocation` 的 `ObservabilityObservationEvent`，并通过 `ObservabilityProjectorHost.acceptObservation(event)` handoff。wrapper 在 normalized final result / safe failure 上写 `durationMs`，并在 `final?.usage` 存在时复制 `usage.inputTokens` / `usage.outputTokens` / `usage.totalTokens`。普通 throw、timeout、cancellation、本地 validation failure 缺失 usage 时省略 usage。缺失 observation context、handoff failure 或 projector failure 不得影响模型调用结果。
7. `packages/agent-core/src/tools/tool-loop.ts`：在 `CAPABILITY_STARTED` 前后同一调用边界记录 start time；所有 `CAPABILITY_COMPLETED` path（success、failed、timed out、degraded）写同一语义的 `durationMs`。不得把 tool args/result 写入 duration 或 observation payload。
8. `packages/agent-observability/src/linking/observation.ts`：`ObservabilityObservationEvent.durationMs` 保持可选；增加 `usage?: ModelUsage`，shape 直接复用 `agent-contracts/model` 已定义的 `ModelUsage`：`{ inputTokens?: number; outputTokens?: number; totalTokens?: number }`。`ownerScope` 固定为 `tenantId`、`subjectId`、`agentId`、`agentVersion`，不包含 `source`；如需来源校验，使用独立 observation metadata / validation evidence。shape validation 校验每个 present usage value 都是有限非负整数。`BoundedObservabilityDegradationInput` 首版不携带 usage，避免降级证据变成 metric replay carrier。
9. `packages/agent-observability/src/audit/timeline-observation-mapper.ts`：不再把 `MODEL_INVOCATION_*` timeline vocabulary 作为 model observability 主输入；model invocation observation 由 `ModelInvocationService` wrapper 产生。从 `CAPABILITY_COMPLETED` 读取 `durationMs`；`CAPABILITY_STARTED` 只做 lifecycle observation，不参与 duration pairing。mapper 对非法 duration 对当前 observation fail closed，不补 0、不估算、不读取 stream delta / capability result raw payload。
10. `packages/agent-observability/src/logging/structured-log-projector.ts`：`StructuredLogEntry.details` 增加可选 `costUsage`，shape 与 `ModelUsage` 对齐：`inputTokens` / `outputTokens` / `totalTokens`，与 `costLatency.durationMs` 并列进入 redaction。usage 不进入 `stableIds`、`processState` 或日志 correlation key。
11. `packages/agent-observability/src/metrics/metrics-registry.ts`：本 change 只让 metrics projector 通过同一 observation stream 看到 `usage`；是否新增 token usage metric name / labels 由 `add-ts-runtime-metrics` 的 metric inventory 承载。当前 change 不在 metrics projector 中发明未被 metric change 定义的新 metric name。
12. `packages/agent-observability/src/linking/projector-host.ts` 与 `packages/agent-app/src/composition/create-app.ts`：保留固定 projector set，但业务路径必须只调用 `ObservabilityProjectorHost.acceptObservation(event): void`。该方法同步返回，不得 `await` projector 或 surface sink，也不得向 caller 暴露 enqueue / drop / degradation 结果。host 内部拥有 bounded in-process queue / mailbox，并由异步 worker 调用 fixed projector set；invalid shape、缺失 owner/time、oversized event、dedup skip、handoff 背压或 enqueue failure 都由 host 内部记录 bounded degradation evidence 或按 policy 丢弃。`create-app.ts` 中 request hooks、system observation、timeline listener 不得 `await` 任何 surface sink；统一 helper（例如 `acceptObservation(event)`）只能同步调用 host 接口。projector failure 只记录 degraded / failed_closed outcome，不抛回 Fastify hook、runtime callback、terminal commit 或 gateway call。unit / source test 必须覆盖 direct sink await 不再出现在业务入口路径。
13. `packages/agent-channel-web/src/projections/stream-envelope.ts`：保持 explicit allowlist/projection ownership。新增 `durationMs` / `usage` / `persistence` 不自动进入 Web DTO；除非 channel schema/projection 单独 allowlist，否则 client projection shape 不变。source snapshot test 必须证明新增 payload fields 不改变 stream DTO。
14. `packages/agent-contracts/src/observability/index.ts` 与 package export：删除 observability subpath。`AuditEvent` / `AuditEventWriter` / `ErrorNormalizer` 移到 `agent-observability` 内部 public API；`agent-contracts` 只保留业务 owner contract、runtime contract、gateway record 和 common vocabulary，不暴露日志、审计、指标、脱敏、projector 或 observability SDK 类型。

## ObservabilityProjectorHost 处理流程

首版整体处理框架由 `agent-observability` 内的最小 `ObservabilityProjectorHost` 承载，并由 `agent-app` 在 composition time 装配。它不是通用 event bus、动态 projector registry 或插件平台；它只接收 `add-ts-trace-log-linking` 定义的 authoritative fact snapshot / observability internal observation event，并调用当前已启用的 LOG / AUDIT / METRIC / HEALTH projectors 以及后续 TRACE projector fixture。每个 surface 是否处理该 event 由该 projector 的 `covers()` / coverage policy 决定，不由 mapper 在 event 上写 `coveredSurfaces`。

mapper / wrapper / system observation producer 只能通过以下同步接收接口把 observation 交给 host：

```ts
export interface ObservabilityProjectorHost {
  acceptObservation(event: ObservabilityObservationEvent): void;
}
```

`acceptObservation()` 是唯一面向业务路径的接收接口。它可以同步执行最小 shape 校验、字段裁剪、dedup / stable refs 组装和 bounded queue / mailbox 入队；不得执行 projector、sink I/O、file write、network send、OpenTelemetry export、audit sink write、metric flush 或日志 flush。该接口不得返回 public handoff status；invalid shape、缺失 owner/time、oversized event、dedup skip、handoff 背压或 enqueue failure 都由 host 内部记录 bounded degradation evidence 或按 policy 丢弃，不交给业务 caller 分支处理。内部 bounded queue / mailbox 属于 `ObservabilityProjectorHost` 私有实现细节，不作为 public `ObservationChannel`、通用 event bus 或其它业务 package 可依赖的 contract 暴露。

`ObservabilityProjectorHost` 的固定处理顺序是：

1. 通过 non-blocking handoff 接收 authoritative fact snapshot / observation event，并校验 `ownerScope`、`occurredAt`、`boundary`、`operation`、`outcome` 和 `diagnosticSnapshot` 的最小形状。
2. 依次调用固定 projector set 的 `covers()`；未覆盖的 surface 返回 `skipped_not_covered`。
3. 对每个覆盖的 surface 调用对应 projector；projector 内部先执行 surface policy / redaction，再写入该 surface 的输出目标。
4. 为每个 surface 记录投影结果：`emitted`、`skipped_not_covered`、`skipped_policy_denied`、`degraded` 或 `failed_closed`。
5. projector 缺失、sink 不可用、policy/redaction 失败、serialization 失败或输出目标不可用时，生成统一 bounded degradation evidence；不得静默吞掉。

不遗漏 / 不丢失在首版中的定义是：已经进入 `ObservabilityProjectorHost` 的 snapshot / observation event，必须让固定 projector set 返回明确 projection outcome：`emitted`、`skipped_not_covered`、`skipped_policy_denied`、`degraded` 或 `failed_closed`。首版不承诺在进程崩溃、电源中断或 host 尚未接收 event 前对观测输出做持久队列保证；需要持久队列、重试 worker、后台 replay 或 exactly-once projection 时，必须由后续独立 change 定义。Audit 的正式记录写入仍按 `add-ts-audit-sink` fail-closed 规则处理，不能用日志、metric 或 trace 输出伪装 audit 成功。

`ObservabilityProjectorHost` 不得阻塞 request lifecycle、terminal commit、stream projection、model invocation、capability invocation、gateway call 或 health response 等业务结果。若单个 projector 超出该 surface 的异步预算或失败，host 只能记录 degraded / failed_closed outcome，并继续处理其它 surface；不得等待后台补采，也不得让业务 owner 感知 logger、audit writer、metrics registry、tracer 或 OTel SDK。

## 系统日志边界

正式业务结构化日志之外的系统运行日志仍必须遵守同一套采集和投影原则。app bootstrap、configuration validation、server listen/shutdown、sink availability、health evaluator status 等系统 owner 可以生成 system observation event；`agent-observability` system log projector 再按 LOG / HEALTH_DIAGNOSTIC surface policy 写出系统运行日志。系统运行日志不得伪装成 request lifecycle fact，不得携带 prompt、model output、tool args/result、attachment content、raw provider error、path、secret 或 owner-private diagnostic detail。业务 package 仍不得直接 import logger、tracer、metrics registry、audit writer 或 observability SDK 来写系统日志。

## Trace 范围标记

本 change 只冻结 trace attribute candidate 的 capture、classification 和 surface policy gating，不定义 `TraceDiagnosticRecord`，不写 local trace JSONL，不定义 remote trace diagnostic sink adapter。它不实现 OpenTelemetry exporter、span lifecycle、outbound trace propagation headers、remote trace sink、trace storage 或 trace query API。任何真实 OpenTelemetry trace exporter / propagation wrapper / local trace fallback 必须由后续独立 change 定义。

因此，本 change 完成后系统仍不承诺具备可运行的端到端 OpenTelemetry trace 输出闭环。当前只冻结 trace 输入模型、policy gate、OpenTelemetry 1.9.0 标准映射和防泄漏边界；真实 span start/end、SpanProcessor、propagator 注入/抽取、OTLP exporter 配置、采样策略和 trace sink 可用性均属于后续 trace projector change。

后续真实 trace change 必须继续使用本 change 的 diagnostic snapshot / observation event 输入模型：runtime `RunTimelineEvent` listener 优先从补齐后的 timeline event 生成 span event / trace link，composition-time wrapper 只在无 runtime timeline event fact 的 public port 边界传播 trace context 并生成 observation event，TRACE attributes 只能来自通过 TRACE surface policy 的 diagnostic candidates。业务模块可以添加 classified diagnostic candidate，但不得 import tracer、span、meter、logger、audit writer 或 provider SDK tracing 类型。SpanContext、trace id 和 span id 的 capture / propagation / export carrier 属于后续 trace change，不属于本 change 的 `DiagnosticContext`。

## OpenTelemetry 协议映射

后续真实 trace projector 必须基于 OpenTelemetry 1.9.0 标准协议，而不是定义 NextAgent 私有 trace 协议。当前 change 只冻结以下标准映射和组件选择约束。这里的 `1.9.0` 指 trace 语义、W3C Trace Context 传播和 OTLP trace 导出行为必须按 OpenTelemetry 1.9.0 兼容语义解释；npm package 版本选择由后续实现 change 在满足该标准语义的前提下锁定。

| NextAgent 输入 / 语义 | OpenTelemetry 标准对象 | 约束 |
|---|---|---|
| synchronous execution boundary，例如 runtime、model invocation、capability invocation、gateway call、health probe | `Span` | span name 使用稳定 `boundary.operation`；`startTime` 使用 `occurredAt`；`endTime` 使用 `occurredAt + durationMs` 或 wrapper outcome time；不得使用 projector emission time |
| asynchronous fan-out、replay 或 projector 消费 snapshot | `SpanLink` | 后续 trace change 必须使用 implementation-owned SpanContext carrier 还原 linked `SpanContext`；不得依赖 consumer 当前 ALS 作为 parent |
| authoritative fact point，例如 `request.accepted`、`terminal.committed`、`policy.denied` | `SpanEvent` | 仅记录安全 event name、outcome、safe reason code 和 stable refs；不得记录 raw payload |
| safe diagnostic fields | `SpanAttributes` | attributes 必须先通过 TRACE surface policy；高基数字段必须有 classification 且被 policy allow 后才能进入 trace attributes |
| cross-process propagation | W3C Trace Context `traceparent` / `tracestate` | propagation 只由 observability wrapper / adapter 注入或抽取；业务 public DTO、gateway record 和 `agent-contracts` 不新增 trace id/span id 字段 |
| exporter protocol | OTLP traces | exporter 使用 OpenTelemetry Protocol；不得自定义 trace sink wire format 作为首版标准路径 |

本 change 的 `DiagnosticContext` 和 `diagnosticSnapshot` 不包含 `traceId`、`spanId` 或 `traceContext` 字段。后续 trace change 若需要 `SpanContext`，必须定义 observability implementation-owned carrier，字段语义按 OpenTelemetry `SpanContext` 解释：`traceId`、`spanId`、`traceFlags` 和可选 `traceState`。该 carrier 不是业务 contract；不得进入 `agent-contracts` public DTO，也不得持久化为 gateway business record。缺失或无效 trace context 时，trace projector 仍可用 stable business refs 生成诊断 link / degradation，但不得伪造 trace id 或 span id。

首版开源组件选择必须约束为 OpenTelemetry 官方 JavaScript 生态：`@opentelemetry/api` 作为 API facade，`@opentelemetry/sdk-trace-node` 或等价官方 Node SDK 作为 SDK，`@opentelemetry/exporter-trace-otlp-http` 或 `@opentelemetry/exporter-trace-otlp-grpc` 作为 OTLP exporter，W3C Trace Context propagator 使用官方 propagator。`agent-observability` 和 `agent-app` composition 是唯一允许装配 OTel SDK / exporter / propagator 的产品路径；runtime、core、model、capability、gateway、channel、context、memory 等业务 owner 不得 import OpenTelemetry SDK、tracer、meter、span 或 exporter 类型。

OTel resource attributes 只能由 `agent-app` / `agent-observability` composition 设置稳定部署维度，例如 `service.name`、`service.version`、`deployment.environment` 和 package/service category。tenant、subject、request、session、message、capability invocation、path、prompt、model output、tool args/result、附件内容、raw provider error、secret、credential 或 token 不得作为 resource attributes。是否将 tenant / subject / stable refs 写入 span attributes 必须由 TRACE surface policy 决定；metrics label policy 不得因 trace attribute allowlist 而放宽。

后续真实 trace projector 的唯一目标路径是：diagnostic snapshot / observation event -> TRACE surface redaction -> OpenTelemetry span / span link / span event / attributes -> OTLP exporter。不得从 structured log、audit record、metric sample 或 health response 回放生成 trace；不得让 wrapper 直接写 OTel span 并绕过 projector，除非后续独立 change 明确证明该同步 wrapper span 与 observation projector 不会双写同一 trace surface。

后续真实 trace projector 的首版 target coverage 必须至少覆盖以下调用链点，并继续遵守当前 change 的 event / wrapper 优先级：

| 调用链点 | OTel 映射 | 首选输入 | 兜底输入 | 输出目标 |
|---|---|---|---|---|
| request accepted / terminal committed | request span 或 lifecycle span 上的 `SpanEvent` | runtime lifecycle / terminal fact snapshot | 无 | OTLP traces |
| runtime execution boundary | `Span` | runtime `RunTimelineEvent` | 仅当没有 runtime timeline event fact 时使用 terminal/runtime port wrapper | OTLP traces |
| model invocation | `Span` | model invocation fact snapshot | model invocation wrapper | OTLP traces |
| capability invocation | `Span` | capability invocation fact snapshot | capability invocation wrapper | OTLP traces |
| gateway call | `Span` | gateway call fact snapshot | gateway port wrapper | OTLP traces |
| hook / policy evaluation | `SpanEvent` or short `Span` by boundary semantics | hook / policy fact snapshot | hook / policy wrapper | OTLP traces |
| async fan-out / replay / projector handoff | `SpanLink` | 后续 trace change 的 implementation-owned SpanContext carrier | 无 | OTLP traces |
| health probe | `Span` 或 `SpanEvent` | health evaluator observation event | 无 | OTLP traces |

该 matrix 只冻结后续 trace coverage 目标和标准映射，不表示当前 change 已实现可运行 trace exporter。

当前未发现与 `establish-ts-backend-architecture` 或 `establish-ts-core-contracts` 的冲突。

## 触发机制

trace/log linking 不引入新的业务触发器。它在已有流程边界被动接入：

- Web/API 请求进入可信 channel boundary 时，同步建立入口诊断上下文。
- runtime 接受请求、调度执行、取消、恢复、terminal commit 和 terminal projection 时，同步刷新当前 request/run diagnostic candidate。
- 权威 runtime event listener 边界必须 snapshot 当前 request/run diagnostic candidate 到观测输入；composition-time wrapper 兜底时生成 observability internal observation event 并携带同等 snapshot。
- runtime append / publish `RunTimelineEvent` 时，owning runtime/core/capability producer 可以写本 change 清单明确的 safe payload enhancement；observability 可以消费 runtime 补齐后的 `RunTimelineEvent`，但不得为了 trace/log linking 修改 `RunTimelineEvent.inlinePayload`、sequence、createdAt、owner/agent scope 或 terminal truth。
- 异步任务和观测消费运行时，必须使用 authoritative fact snapshot 中的 request/run 上下文或记录上下文缺失降级。
- 结构化日志、trace link、audit、metrics 和 health projector 写出时，同步从同一个 observation event / diagnostic snapshot 注入安全关联字段；sink 写出本身不得阻塞主业务结果。

## 输入与前置条件

本 change 依赖：

- 本 change 为 `add-ts-structured-logging`、`add-ts-audit-sink`、`add-ts-runtime-metrics`、`add-ts-health-check` 和后续 trace projector 提供 stable business correlation / diagnostic snapshot / observation 输入模型、采集优先级和 wrapper taxonomy；正式结构化日志 schema、audit sink、metric inventory、health response 和 trace exporter 由各自 change 消费本 change 后定义。
- `add-ts-redaction-policy` 提供统一脱敏规则。
- 可信身份边界提供 `tenantId`、`subjectId`。
- runtime 已产生或正在产生 `sessionId`、`requestRunId`、`rootMessageId`、`requestContextId`、`timelineEventId`、terminal status 等权威业务事实。
- 当前边界已经具备的 message、timeline 或 capability refs、reason code、outcome、latency 和 diagnostic candidate 等安全诊断字段。
- 后续 trace projector 如需读取或创建 trace context，必须在后续 trace change 中定义；当前 change 仅要求稳定业务标识可独立完成诊断关联。

## 输出与副作用

本 change 产生的输出是诊断投影，不是业务事实：

- diagnostic snapshot 包含 event 自身之外可补全的 request refs 和 diagnostic candidates；结构化日志、审计、指标和后续 trace link 只是该 snapshot 的受控投影。
- 上下文缺失、关联字段 redaction、logger sink failure 或 serialization failure 时，产生 observability degradation 证据。

本 change 不产生新的 `SessionMessage`、新的 `TimelineEventType`、checkpoint、pending input、artifact、memory record、learning event 或用户可见 stream event。它只定义 inventory-declared safe timeline payload enhancement：`CAPABILITY_COMPLETED.durationMs`；model invocation 的 `durationMs` 和 optional `usage` 只进入 `ModelInvocationService` wrapper 生成的 `ObservabilityObservationEvent`，不写入 canonical timeline payload。observability wrapper 不得修改 `RunTimelineEvent.inlinePayload`、sequence、createdAt、owner/agent scope 或 terminal truth。

## 核心判断逻辑

1. 先确定当前边界是否已经有权威业务事实；没有产生的业务 id 不得伪造。
2. 再从可信 request/run diagnostic context 读取当前可用的 owner scope、业务标识和 diagnostic candidates。
3. 在 runtime event listener 或 wrapper observation 边界把这些候选 snapshot 到观测输入；缺失字段不得伪造。对于 `RunTimelineEvent`，只有 owning runtime/core/capability producer 可以写 inventory-declared safe payload enhancement；observability listener / wrapper 不修改 runtime payload，只消费 runtime 已产生的 fact 和 snapshot。
4. projector 再按当前 surface policy 选择 allowed fields：stage、component、operation、outcome、reason code、latency、safe summary、refs 和允许的 diagnostic candidate。
5. 再执行 redaction policy；被拒绝、不确定安全性或 classification 缺失的字段必须删除、替换为 reason code，或降级为 safe summary。
6. 最后写出 structured log / audit / metric / health / future trace projection；写出失败只记录 observability degradation，不回滚、不重试业务状态机，也不改变用户可见结果。

## 关键流程

1. Web/API 入口接收请求，从可信身份边界获得 `tenantId`、`subjectId`，并由 trusted app composition 确定 `agentId`、`agentVersion`。
2. Runtime 正式接受请求后，产生或固化 `sessionId`、`requestRunId`、`requestContextId` 等权威业务标识，并刷新当前 request/run diagnostic context。
3. Runtime 调度或恢复异步执行时，执行任务必须显式绑定当前 request/run diagnostic context；绑定失败时不得伪造 id，只记录安全降级。
4. 发布权威 event 时，先验证字段来自权威事实或当前安全上下文，再 snapshot diagnostic context 到观测输入。
5. runtime event listener / projector 只使用 authoritative fact snapshot 的 safe refs；不得把 consumer 私有状态或当前 ALS 当成执行真相。
6. Model、Capability、Gateway、Hook、Policy、Attachment、SafeError、Health 和 Web entrypoint 若无法被 runtime timeline 覆盖，必须按本 change 的 wrapper taxonomy 在 `agent-app` composition 生成 observation event；wrapper 不直接写任何 surface sink，且不得与 timeline 对同一 fact 双写。
7. Runtime terminal commit 仍由 runtime/session/gateway owning boundary 决定；terminal 相关 log/trace 只作为诊断投影。后续 trace projector 不得回填或重写已持久化 timeline。
8. 任一阶段出现 context injection failure、redaction drop、logger sink failure 或 serialization failure 时，主流程继续，并产生 bounded safe degradation evidence。

## 状态 / 产物契约

本 change 的唯一产物是诊断上下文和诊断输出：

- request/run diagnostic context 是进程内执行上下文，只保存诊断候选信息，不是持久化业务对象。
- diagnostic snapshot 是 observability projector 的稳定输入，不是新的业务事实。
- timeline payload 和 message metadata 不保存 trace/span refs；message 通过稳定 `messageId` / `requestId` / `runId` / `timelineEventId` 关联 timeline 和诊断投影。
- structured log correlation fields、audit records、metric samples 和后续 trace outputs 是派生诊断投影。它们可以被 operator、release gate、observability tests、audit investigation 或 metrics dashboard 用于定位，但不得作为 request terminal truth、session history truth、checkpoint truth 或 audit truth。
- 上下文生命周期从可信请求入口或恢复入口开始，到当前 request/run 的 terminal diagnostic boundary 结束；后台 projector 只能使用 authoritative fact snapshot 的 safe refs 和 stage，不得继承过期上下文或 consumer-local ALS。

安全限制统一按“非范围与安全排除”执行；本节不再重复列出各 surface 的负向字段清单。

## 流程接入

主接入链路：

`Channel -> Runtime -> Agent Loop -> Context -> Model / Capability / Gateway -> Runtime terminal -> Observability`

协作边界：

- Channel 提供可信入口、transport 信息和外部请求边界。
- Runtime 提供 request/run lifecycle、terminal commit 和 timeline refs。
- Model、Capability、Gateway、Hook、Policy 和 Sandbox 提供各自调用边界的 safe outcome。
- 结构化日志消费当前诊断上下文并输出稳定日志。
- Redaction policy 在任何结构化日志写出前执行。
- Audit、metrics、health 和 release gates 可以使用相同业务标识交叉定位，但不能把 trace/log 输出当成权威事实。

## 失败与降级

- 异步上下文丢失：当前日志只输出已知业务标识；记录 `REQUEST_CONTEXT_UNAVAILABLE` 或等价 safe reason，不伪造上下文。
- redaction 拒绝字段：删除或替换该字段；日志/trace 写出继续。
- logger sink、serialization 或 context storage 不可用：业务流程继续；产生 bounded observability degradation 证据。
- sink 重复接收同一诊断输出：下游不得因此产生重复业务事实；最多视为重复诊断记录。

不得静默吞错：所有关联失败、上下文缺失、redaction drop 和 sink 不可用都必须留下安全、有限、可测试的降级证据。

## 验收样例

- 正常路径：Web submit 被接受后，request accepted 和 terminal structured log 携带 `tenantId`、`subjectId`、`agentId`、`agentVersion`、`sessionId`、`requestRunId`、`requestContextId`，并可通过同一 request/run 关联。
- 边界路径：某条日志发生在 `requestRunId` 尚未产生前，只携带可信 owner scope 和入口 request boundary，不生成伪造 run id。
- 异步路径：runtime 调度后的执行日志仍能关联到原 request/run；若上下文恢复失败，日志包含 safe degradation reason。
- 失败路径：provider 返回包含敏感响应体的错误，结构化日志只包含标准 safe error、reason code、provider kind 和 latency，不包含 raw body。
- 降级路径：logger sink failure 或 serialization failure 发生时，主流程仍按业务结果完成，同时产生 safe observability degradation 证据。
