# trace-log-linking Specification

## Purpose
定义 request/run diagnostic snapshot、统一 observation handoff、safe redaction 边界，以及 observability implementation 对 structured log、metrics、audit 和 OTel trace adapter 的共享输入语义。
## Requirements
### Requirement: trace/log linking 必须明确范围和安全排除

本 change SHALL 定义 request/run 诊断上下文传播、runtime `RunTimelineEvent` listener、诊断快照采集和统一观测输入。结构化日志 schema、audit truth、metric inventory、health judgment、runtime lifecycle state、trace context carrier、TraceDiagnosticRecord、local trace JSONL、remote trace adapter 和 OpenTelemetry exporter 行为继续由各自 change 拥有。

本 change 管辖的诊断输出必须只使用有界安全字段。raw prompt、raw thinking、raw model output、tool args/result、attachment content、raw provider response、credential、secret、token、stack trace、未脱敏本地路径、free-text reason、动态 payload 和开放式 usage/metric key 不属于 log、audit、metric、trace diagnostic、health diagnostic、runtime/channel DTO 或 gateway record 的允许输出形态。

#### Scenario: owner 范围保持明确
- **WHEN** 后续 change 需要新增 metric name、audit record、health judgment 或 OpenTelemetry exporter 行为
- **THEN** 对应 change 必须定义 schema、sink、owner、validation 和安全规则
- **AND** 本 change 只提供该 owner 所需的共享 diagnostic context / observation 输入

### Requirement: 结构化日志关联必须使用稳定业务标识作为主关联键

TS 后端 SHALL 使用稳定业务标识作为结构化日志关联的主关联键。可用字段包括 `tenantId`、`subjectId`、`agentId`、`agentVersion`、`sessionId`、`requestRunId`、`requestContextId`、`messageId`、`timelineEventId`、`capabilityInvocationId`、`hookId`、`policyId` 和 `auditEventId`。当前 change 的 `DiagnosticContext` 不携带 trace id、span id 或 trace context，也不实现 trace/span attributes 输出或 outbound trace propagation。

#### Scenario: 请求生命周期结构化日志共享业务标识
- **WHEN** runtime 接受请求并进入执行链路
- **THEN** 结构化日志必须包含当前已知的 `tenantId`、`subjectId`、`sessionId`、`requestRunId` 和 `requestContextId`
- **AND** trace id、span id 或 trace context 字段不得进入当前 `DiagnosticContext`、timeline payload 或 public DTO

#### Scenario: 缺失业务标识时不伪造
- **WHEN** 某个业务标识在当前生命周期阶段尚未产生
- **THEN** 结构化日志必须省略该字段
- **AND** 系统不得生成伪造或占位 id

### Requirement: Agent execution trajectory inputs SHALL enter the shared observation stream

agent execution trajectory 新增的 turn、context assembly、capability selection、sandbox execution 和 user-visible output 对齐信号 MUST 通过现有 `ObservabilityObservationEvent` stream 进入 LOG、AUDIT、METRIC 和 TRACE surface。系统 MUST NOT 为这些轨迹点新增第二套 observability event carrier、per-surface bus、direct logger path 或 trace-private carrier。

当轨迹点已有 runtime-owned canonical 或 live-only timeline fact 时，observation mapper MUST 优先消费该事实；只有在对应事实由 wrapper 或 composition-time producer 才能安全获得时，才允许使用 approved wrapper / producer observation。

#### Scenario: Trajectory event uses the shared observation handoff
- **WHEN** turn、context assembly、capability selection、sandbox execution 或 visible output 对齐轨迹点被产生
- **THEN** 它 MUST 通过 `ObservabilityProjectorHost.acceptObservation(event)` 进入统一 observation stream
- **AND** 各 observability surface 从同一 observation 派生各自输出
- **AND** 系统 MUST NOT 为该轨迹点引入 direct wrapper-to-sink path

### Requirement: request/run 诊断上下文必须跨异步执行边界传播

TS 后端 SHALL 在请求入口、runtime 调度、权威 `RunTimelineEvent` listener 边界、composition-time wrapper 和 terminal commit 之间传播当前 request/run diagnostic context。该 context 是诊断候选上下文，不是业务状态机或持久化事实；它主要承载 event 自身之外的 request 级 refs 和业务补充 attributes。runtime event listener 或 wrapper observation 边界必须把当前 diagnostic context snapshot 到观测输入；projector 必须消费该 diagnostic snapshot，而不是依赖 consumer 当前 ALS。

model invocation、capability invocation、gateway call、hook execution、policy evaluation、attachment intake、safe error output、health evaluation、Web entrypoint 和 stream replay 如果不能由 runtime `RunTimelineEvent` / authoritative event 覆盖，必须按本 change 的 composition-time wrapper taxonomy 生成 observability internal observation event，不能直接写 surface 输出。

Observability internal observation event 必须把可信 `ownerScope` 和 `occurredAt` 作为一等输入。`ownerScope` 字段固定为 `tenantId`、`subjectId`、`agentId`、`agentVersion`；这些字段只能来自 channel/auth identity、trusted app composition、已持久化 session/run/record 或明确的 trusted system scope；不能来自 request body、model output、capability arguments、diagnostic candidates、consumer-local ALS 或 projector 默认值。`source` 不属于 `ownerScope`。`occurredAt` 必须表示权威事实时间或 wrapper observation outcome 时间；不能替换为 projector emission time、sink flush time、consumer consumption time、client-provided time 或 replay time。

#### Scenario: 调度执行保留请求上下文
- **WHEN** 已接受请求从调度队列进入异步执行
- **THEN** 后续结构化日志必须仍能关联到已接受的 request/run
- **AND** 执行上下文传播失败时必须产生安全 observability degradation evidence

#### Scenario: runtime event listener 边界采集诊断快照
- **WHEN** request/run diagnostic context 活跃期间发布权威 event
- **THEN** runtime event listener 或 wrapper observation 边界必须把稳定业务标识、可信 owner scope、`occurredAt` 和 diagnostic candidates snapshot 到观测输入
- **AND** 下游 projector 不得依赖自身当前 ALS store 获取这些字段

#### Scenario: 观测输入不伪造字段
- **WHEN** observation input 缺失 owner scope 或 `occurredAt`
- **THEN** projector output 必须按 surface policy fail closed 或只输出有界 degradation
- **AND** 系统不得从 diagnostic candidates、consumer-local ALS 或 sink time 伪造 tenant、subject、agent 或 timestamp

### Requirement: runtime timeline event 必须保持为 runtime 拥有的唯一观测事实

`agent-runtime` SHALL 只发布 runtime-owned request lifecycle、capability invocation、visible stream 和 terminal facts 对应的 `RunTimelineEvent`。模型调用动作默认不是 canonical timeline fact；当它只服务日志、审计、指标或 trace diagnostic 时，必须通过批准的 `ModelInvocationService` wrapper 生成 observation。runtime 不发布 audit/log/metric/trace 专用事实，不 import logger、audit writer、metrics registry、tracer、observability SDK 或 projector，也不决定某个事实由哪个 observability surface 消费。

runtime 必须按业务目的决定 `RunTimelineEvent` 是否持久化，而不是按 observability surface 需求决定。新增或增强 runtime timeline event 时，必须保持稳定 canonical type 和安全 runtime-owned payload 字段；不能使用 `AUDIT_*`、`LOG_*` 或 `METRIC_*` 这类 surface-specific 名称。runtime diagnostic payload 可包含稳定 status、phase、capability kind、stable invocation refs、safe error code/category、duration/size class 和 stable reason code。模型 provider kind、usage、finish reason 和模型调用 duration 属于 model invocation wrapper observation 的安全候选字段，除非未来 runtime/core owner 证明模型调用动作本身需要 canonical timeline 事实。

`agent-channel-web` 拥有 runtime timeline event 是否以及如何投影到 client stream 的决策权，通过显式 allowlist 和 projection function 实现。runtime event 不携带 `client-visible` 或 `diagnostic-only` 这类 observability-owned event property。未知 timeline event 不改变客户端 stream 呈现。已有投影 event 可以保持当前 DTO shape；新增 inline payload 字段只有被 Web channel schema/projection 显式 allowlist 后才能暴露。

`agent-contracts` SHALL NOT expose an observability subpath for audit/log/metric/redaction/projector internals. `AuditEvent`、`AuditEventWriter`、`StructuredLogEntry`、`MetricsRegistry`、redaction policy types、`ObservabilityProjectorHost` 和 error-normalizer implementation contracts SHALL stay in `agent-observability` or the owning package. Cross-package persistence 仍通过 gateway-owned records / local store contracts 表达，不通过通用 observability contract 表达。

runtime 必须提供明确语义的 runtime-owned `RunTimelineEvent` listener 机制，覆盖 `PERSISTED` 和 `LIVE_ONLY` event。`timelineObservers` 不属于本 change 保留的主设计依赖；实现应清理该产品路径依赖，改为单一 listener 机制。runtime 发布前必须补齐 `RunTimelineEvent.eventId`、`sessionId`、`runId`、`requestId`、`requestContextId`、`sequence`、`createdAt`、`agentId`、`agentVersion` 和 `persistence`。`persistence` 只能由 runtime 设置为 `PERSISTED` 或 `LIVE_ONLY`，producer 不能设置或覆盖。`RunTimelineEventRecord` 只用于持久化边界，必须携带 `agentVersion`，不得用于 live-only event，也不得携带 `persistence`。listener failure 不得影响 append、terminal commit、stream projection、scheduler 或 recovery。runtime 内部 `onTimelineAppend` 只服务 run-state append 后的 channel stream fanout，不得作为 observability extension point。

runtime-owned persistence policy SHALL default to existing persisted behavior and MAY mark selected runtime-owned events as `LIVE_ONLY`. The policy is not an observability surface decision: LOG / AUDIT / METRIC / TRACE / HEALTH projectors, mappers, channel projection and agent/core producers MUST NOT choose persistence. A `LIVE_ONLY` event SHALL be delivered to the same runtime listener with runtime-filled fields and SHALL NOT create a `RunTimelineEventRecord` or channel stream queue item.

#### Scenario: observability contract surface 被收紧
- **WHEN** package exports 被检查
- **THEN** `@nextagent/agent-contracts/observability` 不存在
- **AND** 业务 package 不通过 `agent-contracts` import audit writer、logger、metrics registry、redaction 或 projector 类型

#### Scenario: runtime event 本身不改变客户端呈现
- **WHEN** runtime 为业务诊断增强 `CAPABILITY_COMPLETED`
- **THEN** `agent-channel-web` 不得在未显式 allowlist 时把它渲染成新的 client-visible event
- **AND** LOG / AUDIT / METRIC / TRACE projectors 仍可按 coverage policy 消费对应 observation event

#### Scenario: runtime 不发布 surface-specific facts
- **WHEN** model invocation 因 credential-safe reason code 失败
- **THEN** observability 的 `ModelInvocationService` wrapper 必须生成 `MODEL_CREDENTIAL_FAILED` / `MODEL_SECURITY_FAILED` / `MODEL_QUOTA_FAILED` 等 model invocation observation
- **AND** runtime 不发布 `AUDIT_MODEL_CREDENTIAL_FAILED`，不调用 audit writer，不递增 metric，也不调用 logger

#### Scenario: runtime listener 与 channel stream 分离
- **WHEN** runtime append 或 publish `RunTimelineEvent`
- **THEN** runtime listener 可以把补齐后的 `RunTimelineEvent` 交给 observation mapper
- **AND** channel-web client stream 仍只能通过 `RuntimeSessionPort.streamEvents()` 和 channel projection allowlist 输出
- **AND** listener failure 不得改变客户端 stream、terminal truth 或 event persistence

#### Scenario: live-only event 不创建持久化记录
- **WHEN** runtime-owned persistence policy 将某个 runtime event 判定为 `LIVE_ONLY`
- **THEN** listener 收到补齐后的 `RunTimelineEvent`，其 `persistence` 为 `LIVE_ONLY`
- **AND** runtime 不写 `RunTimelineEventRecord`
- **AND** channel stream 不因该 live-only event 新增 client-visible queue item

### Requirement: timeline event inventory 必须定义观测处理且不新增 event

本 change MUST NOT 新增 `TimelineEventType` 值。它必须维护当前 timeline vocabulary 的全量清单，并把每个 event 分类为产品路径已发布、已设计但本 change 不实现、或 owner-deferred。每个 event 必须说明 observability 是按现状消费、只需要 mapper/projector 处理、需要 owning business change 补强 safe runtime payload，还是因为携带 raw 或用户可见 stream payload 而必须被 observability 忽略。

已经由 runtime 发布的 event 只能通过安全字段、record metadata 和 diagnostic snapshot 被 observation mapper 消费。已设计但未实现的 event 不得仅为 LOG / AUDIT / METRIC / TRACE / HEALTH 覆盖率在本 change 中实现。它们的实现 owner 必须是拥有对应事实的业务 package，例如 runtime lifecycle、model invocation、capability invocation、attachment runtime、context compaction、hook/policy 或 pending input。当前 vocabulary 中不存在但后续需要的新 event，必须先在 owning logging、audit、metrics 或 runtime/capability change 中提出。

关闭 invocation boundary 的 outcome observation / end timeline event 用于 duration diagnostics 时必须携带 `durationMs`。当前 model invocation 由 `ModelInvocationService` wrapper 生成 observation 并携带 `durationMs`；当前 runtime timeline inventory 中适用于 `CAPABILITY_COMPLETED`。`durationMs` 必须是有限、非负毫秒值，由 invocation boundary owner 从 invocation start 到 outcome 计算。`CAPABILITY_STARTED` 可以继续作为 lifecycle/navigation fact；当 completion event 已携带 `durationMs` 时，observation mapper 不得把 start/end 配对作为生成 duration 的主路径。

`ModelInvocationService` wrapper 在 model adapter 或 provider 返回可信 usage 时，必须在 model invocation observation 中携带 normalized model usage。usage shape 与 `ModelUsage` 对齐：可选 `inputTokens`、`outputTokens` 和 `totalTokens`。每个 present value 必须是有限、非负整数。provider 未返回 usage、stream 结束时无 usage、timeout、cancellation、local validation failure 或 thrown exception 时，必须省略缺失 usage 字段。structured logs、trace diagnostics 和 metrics projectors 必须消费同一 shape，不增加 `model*` 前缀，也不引入开放式 usage key。

#### Scenario: 已有 event 只补消费侧处理
- **WHEN** `REQUEST_ACCEPTED`、terminal events、`CAPABILITY_*` 或 `DEGRADATION_NOTICE` 已由产品路径发布
- **THEN** observability 只在需要时新增或更新 mapper/projector 处理
- **AND** 除 inventory 声明的 `CAPABILITY_COMPLETED.durationMs` 等 safe payload enhancement 外，不修改 runtime payload、channel projection、sequence、createdAt 或 owner/agent scope

#### Scenario: model invocation wrapper 携带 duration 和 usage
- **WHEN** model invocation 完成或失败，`ModelInvocationService` wrapper 观察到 normalized final result、safe failure 或 thrown failure
- **THEN** wrapper 生成的 model invocation observation 必须包含有限非负 `durationMs`
- **AND** 可信 normalized model usage 可用时，observation 必须包含有限非负整数 `usage.inputTokens`、`usage.outputTokens` 和/或 `usage.totalTokens`
- **AND** runtime timeline mapper 不得要求配对 `MODEL_INVOCATION_STARTED` 生成 model duration 或 usage

#### Scenario: capability completion event 携带 duration
- **WHEN** capability invocation 到达 success、failure、timeout、canceled、denied 或 degraded outcome，runtime/core 发布 `CAPABILITY_COMPLETED`
- **THEN** event safe payload 必须包含有限非负 `durationMs`
- **AND** observation mapping 必须从 completion event 派生 capability duration，不读取 tool args 或 result payload

#### Scenario: 缺失 model usage 时省略
- **WHEN** model invocation 在 provider 返回 normalized usage 前失败，或 provider 不报告 usage
- **THEN** model invocation observation 必须省略不可用 usage 字段
- **AND** wrapper、mapper 和 projectors 只能传递 provider / model adapter normalized usage

#### Scenario: 已设计 event 不因 observability 单独实现
- **WHEN** `ATTACHMENT_*`、`CONTEXT_COMPACTED`、`POLICY_APPLIED`、`PLANNING_STARTED` 或 `USER_INPUT_*` 当前产品路径未发布对应业务事实
- **THEN** 本 change 不得仅为 observability coverage 实现这些 event
- **AND** future owner change 必须定义 safe payload、persistence purpose、channel projection effect 和 observation mapper impact

#### Scenario: stream payload 不作为诊断事实
- **WHEN** `LLM_CONTENT_DELTA`、`LLM_THINKING_DELTA` 或 `CAPABILITY_RESULT_DELTA` 包含用户可见内容、thinking 或 capability result data
- **THEN** observability 不得把 raw payload 用作 audit/log/metric/trace 字段
- **AND** metrics 或 trace diagnostics 只能使用 surface policy 批准的 safe refs、timing、size class 或 summary fields

### Requirement: observation acquisition 必须遵循声明的 source 和 precedence matrix

每个 observability-covered fact SHALL 声明 preferred observation source、fallback source 和 dedup key。surface coverage 由各 projector 的 `covers()` / coverage policy 决定，不写入 `ObservabilityObservationEvent` 字段。优先级固定为：

1. runtime `RunTimelineEvent` listener 提供的 `persistence=PERSISTED` event;
2. runtime `RunTimelineEvent` listener 提供的 `persistence=LIVE_ONLY` event;
3. 非 runtime owner 在已有 authoritative event/fact source 中提供的 authoritative fact snapshot;
4. 无 runtime timeline event / authoritative event 覆盖该 fact 时，`agent-app` composition-time wrapper 包装 public authoritative port;
5. 仅处理 transport-safe Web facts 的 channel entrypoint middleware;
6. 仅处理 health-owned facts 的 health evaluator observation。

同一 authoritative fact 已由 runtime timeline event 表达时，wrapper 不得再为该 fact 发出第二个 observation。wrapper output 永远是 observability internal observation event，不直接构造 structured log entry、audit event、metric sample、trace span 或 health response。`persistence=LIVE_ONLY` 的 `RunTimelineEvent` 只能作为诊断投影输入，不能被 audit projector 当成 durable audit truth。

#### Scenario: timeline source 抑制 wrapper 重复
- **WHEN** capability completion 已由 persisted `CAPABILITY_COMPLETED` timeline event 表达
- **THEN** capability wrapper 不得为同一个 capability invocation 发出第二个 observation
- **AND** coverage policy 命中的任何 projector 都必须消费从 timeline record 派生的 observation

#### Scenario: pre-run request rejection 使用 wrapper source
- **WHEN** submit request 在 run 或 timeline event 产生前被拒绝
- **THEN** command 或 channel boundary wrapper 可以生成带可信 owner scope 和 safe reason code 的 observation event
- **AND** 它必须省略尚未建立的 run/session refs

### Requirement: observability surfaces 必须作为同一 observation stream 的 processors

structured logging、audit、metrics、health diagnostics 和 trace diagnostics SHALL 实现为同一 `ObservabilityObservationEvent` stream 上的 processors/projectors。`add-ts-structured-logging` 定义 LOG coverage 和 schema；`add-ts-audit-sink` 定义 AUDIT coverage 和 sink semantics；`add-ts-runtime-metrics` 定义 METRIC inventory 和 labels；`add-ts-health-check` 定义 health-owned evaluator facts；后续 trace changes 定义 TRACE exporter behavior。这些 surface changes 不得定义第二套 event carrier、surface-private observation event、per-surface event bus、direct wrapper-to-sink path 或 replay-from-other-surface input。

产品路径 SHALL 固定为 runtime `RunTimelineEvent` listener 或批准的 composition-time wrapper 同步生成 `ObservabilityObservationEvent`，再调用 `ObservabilityProjectorHost.acceptObservation(event): void`，由 host 内部 bounded queue / mailbox handoff 到 fixed projector set。现有 `timelineObservers` 外部 observer 注入、trace-linked timeline store 包装、直接调用 surface projector 和 per-surface observation entrypoint 必须由该路径替代。

`ObservabilityProjectorHost` 是 composition-time fanout point。它 SHALL 暴露唯一面向业务路径的同步接收接口 `acceptObservation(event: ObservabilityObservationEvent): void`。该接口 SHALL 同步返回，且不得向 caller 暴露 accepted、skipped、degraded、enqueue failure、drop reason、projector output、sink response、raw error、raw payload 或 retry handle。业务路径 observation work 只限于同步 bounded mapping、minimal validation、dedup/stable-ref assembly、diagnostic snapshot capture 和调用 `acceptObservation()`。同步路径不得执行 surface sink I/O、file write、network send、OpenTelemetry export、audit sink write、metric flush、log flush、remote adapter call、replay 或 retry worker work，也不得等待 projector 或 sink success 才返回业务 owner。

handoff buffer SHALL 由 `ObservabilityProjectorHost` 内部拥有，可以实现为 bounded in-process queue / mailbox。invalid shape、missing trusted owner/time、oversized event、dedup skip、handoff backpressure 或 enqueue failure SHALL 由 host 内部记录 bounded degradation evidence 或按 policy 丢弃，不得交给业务 caller 分支处理。该 buffer 不作为 public `ObservationChannel`、通用 event bus、动态 subscription registry 或业务 package 可依赖 contract 暴露。handoff 后，配置的 projectors 必须异步消费 observation event。对于每个 accepted observation event，每个 configured covered projector 必须返回或记录明确 projection outcome，例如 emitted、skipped、degraded 或 failed closed。单个 projector failure、timeout、policy denial、redaction failure、serialization failure 或 sink failure 不得阻止其它 projectors 处理同一个 observation event，也不得重写业务 outcome。

首版 handoff 是 best-effort in-process delivery。不承诺 durable queue、exactly-once projection、crash recovery、cross-process replay、background backfill 或 replay from structured log/audit/metric/trace output。handoff backpressure、invalid observation shape、missing trusted owner/time 或 oversized fields 阻止安全投递时，系统必须按 surface policy 省略 unsafe observation 或输出 bounded degradation evidence；不得把错误抛回 runtime/core/gateway/channel business paths，也不得伪造缺失 facts。

#### Scenario: 一个 observation 输入多个 surfaces
- **WHEN** terminal timeline record 变成 observation event
- **THEN** structured logging、audit、metrics 和 trace diagnostics 可以按 coverage 消费同一个 observation
- **AND** 它们都不得为同一 terminal fact 创建新的 observation source

#### Scenario: 产品路径只有一个 handoff 入口
- **WHEN** runtime listener、approved wrapper 或 system observation producer 生成 observation
- **THEN** 它必须调用 `ObservabilityProjectorHost.acceptObservation(event)` 进入 projector fanout
- **AND** 产品路径不得保留 `timelineObservers` 外部 observer 注入、trace-linked timeline store 包装、直接 surface projector 调用或 per-surface observation entrypoint

#### Scenario: 业务路径只做有界 mapping 和 handoff
- **WHEN** runtime append timeline event、wrapper 观测 gateway call，或 terminal commit 发布 authoritative fact
- **THEN** 业务路径可以同步 snapshot diagnostic context、把 safe fields 映射成 observation event、校验最小 shape 并调用 `ObservabilityProjectorHost.acceptObservation(event)`
- **AND** 它不得等待 log、audit、metric、trace、health、file、network、exporter 或 remote adapter sink completion

#### Scenario: host 接口不暴露内部队列
- **WHEN** mapper 或 wrapper 产生 `ObservabilityObservationEvent`
- **THEN** 它只能通过 `acceptObservation(event)` 把 event 交给 `ObservabilityProjectorHost`
- **AND** runtime、core、channel、gateway、model 或 capability package 不得依赖 host 内部 queue / mailbox、projector set、sink response、handoff status 或异步 worker 实现

#### Scenario: 异步 projector 失败不影响业务 outcome
- **WHEN** configured projector 在 handoff 后 reject、timeout、redaction failure、serialization failure 或 sink unavailable
- **THEN** projector host 必须为该 surface 记录 `degraded` 或 `failed_closed` outcome
- **AND** request lifecycle、terminal commit、stream projection、model invocation、capability invocation、gateway call 和 health response 必须继续遵守各自业务 owner 边界
- **AND** 同一个 observation event 的其它 covered projectors 仍必须被尝试

#### Scenario: metric projection 不绕过 observation stream
- **WHEN** runtime timeline records 用于 request 或 model metrics
- **THEN** metric projection 必须消费 observation event 或本 change 约束的 mapper
- **AND** 不得维护绕过共享 acquisition 和 dedup rules 的第二条 raw timeline metrics path

### Requirement: non-timeline facts 只能通过批准的 composition-time wrappers 观测

runtime timeline 或其它 authoritative event 覆盖不了的 facts SHALL 只能通过批准的 composition-time wrappers 观测：用于 pre-run rejection 的 `RuntimeCommandPort` wrapper、`ModelInvocationService` wrapper、`CapabilityInvocationPort` wrapper、`GatewayPort` wrapper、`HealthProbe` adapter、`SafeErrorOutput` wrapper、attachment intake/read wrapper、lifecycle hook / policy wrapper、Web entrypoint middleware 或 normalized stream wrapper。每个 wrapper 必须声明 boundary、operation vocabulary、trusted owner/time source、stable refs、dedup key 和相对 timeline events 的 precedence relation。wrapper 不得决定 surface coverage，也不得直接写 surface sinks。

wrappers 必须保持被包装 port 的 input、output、exception、cancellation、timeout、idempotency 和 owner/agent scope semantics。如果 wrapper 无法建立 trusted owner scope 或 `occurredAt`，必须按 surface policy fail closed 或只输出 bounded degradation evidence；不得伪造 tenant、subject、timestamp、sessionId、runId、requestContextId、messageId 或 capabilityInvocationId。

#### Scenario: gateway failure 通过 gateway wrapper 观测
- **WHEN** gateway operation 返回 owner-boundary 或 credential-safe failure，且没有 authoritative event/fact source
- **THEN** gateway wrapper 可以生成一个包含 gateway category、outcome、duration 和 safe reason code 的 observation event
- **AND** 它不得暴露 path、SQL、credential、raw error 或 owner-private existence detail

#### Scenario: wrapper 不直接写 surface sink
- **WHEN** Web entrypoint middleware、safe error wrapper 或 health adapter 观测到 fact
- **THEN** 它只能发出 observation event
- **AND** LOG / AUDIT / METRIC / TRACE / HEALTH outputs 只能由对应 projectors 或 evaluator-owned processor 生成

### Requirement: structured log linking 必须遵循 request-to-terminal diagnostic flow

TS 后端 SHALL 按既有请求生命周期接入 trace/log linking：可信入口建立 diagnostic candidate context，runtime acceptance 固化 request/run refs，异步执行绑定当前 context，runtime event listener 或 wrapper observation 边界 snapshot context 到观测输入，projector 写出前执行 allowed-field selection 和 redaction，terminal commit 后只输出诊断投影。

#### Scenario: request-to-terminal diagnostics 保持关联
- **WHEN** request 被接受，经过 model 或 capability 边界执行，并到达 terminal commit
- **THEN** 这些阶段的 diagnostic outputs 必须能通过 stable business identifiers 关联
- **AND** terminal truth 仍由 runtime/session/gateway facts 拥有，而不是由 log 或 trace output 拥有

#### Scenario: linking 降级时流程继续
- **WHEN** context binding、redaction field selection、logger sink 或 serialization 在任一阶段失败
- **THEN** 受影响阶段必须产生 bounded safe degradation evidence
- **AND** request lifecycle 必须继续遵守 owning business boundary

### Requirement: trace propagation 必须保持为 observability implementation concern

trace span 创建、结束、W3C 语法校验、上下文注入和 OTLP 导出 MUST 由 `agent-observability` 实现，并由 `agent-app` 在 composition 时装配。`agent-runtime`、`agent-core`、`agent-workflow`、channel、model、capability 和 gateway implementation MUST NOT 导入 OpenTelemetry SDK、tracer、span、exporter、propagator 或供应方 trace 类型。

`agent-contracts/observability` MUST 只提供不含 SDK 类型和 trace/span 标识的 `ExecutionCorrelationRef` 与执行关联端口。请求、模型、能力和本地工作流节点执行边界 MUST 通过该端口激活稳定执行引用，但 MUST NOT 调用 `startSpan`、`endSpan`、生成 trace ID 或读取 Span 对象。span 生命周期 MUST 由 `agent-observability` 的 timeline 持久化装饰器管理。

跨进程传播 MUST 使用 W3C Trace Context `traceparent` 和 OPTIONAL `tracestate`。出站传播 MUST 从当前最窄执行引用对应的 timeline 权威执行 span context 生成载体。系统生成的 `traceparent`、`tracestate` 和 `x-task-event-id` MUST 覆盖大小写不敏感的同名业务请求头。没有有效系统值时，适配器 MUST 删除不可信同名请求头。

OpenRouter、CLIP、SkillHub HTTP v1、RobotRouter 和本地工作流远端 RAG 适配器 MUST 只注入载体，MUST NOT 为物理 HTTP、CLIP 命令或 gateway 传输创建额外本地 span。HTTP instrumentation MUST 保持关闭 outgoing request instrumentation。NextAgent MUST NOT 为下游创建 SERVER span；接收载体的下游服务拥有其入站 SERVER span。

OTLP exporter 未配置或不可用时，已启用的进程内 trace、timeline enrichment 和 W3C 传播 MUST 继续工作。trace 关闭时，系统 MUST 不生成或传播 W3C Trace Context，MUST 不绑定、保存或恢复 taskEventId，并 MUST 删除不可信 `x-task-event-id`。

business module MAY 提供后续 trace attributes 所需的 diagnostic candidates，但每个 candidate MUST 包含 classification，并 MUST 在成为 span attribute 前通过 TRACE surface policy。高基数或未分类 candidate MUST 默认省略。

timeline 权威执行 lifecycle decorator 与辅助 `TraceProjector` MUST 使用 OpenTelemetry 1.9.0 标准协议语义和官方 JavaScript 生态组件，不得定义 NextAgent 私有 trace wire format。同步执行边界 MAY 成为 span；权威事实 MAY 成为 span event；异步 fan-out、replay 或 projector handoff MUST 使用 implementation-owned SpanContext carrier 建立 span link，不得用 consumer-local AsyncLocalStorage 伪造父级。npm package 版本 MAY 由 implementation owner 选择，但 trace、W3C propagation 和 OTLP export 语义 MUST 兼容 OpenTelemetry 1.9.0。

`DiagnosticContext` MUST NOT 携带 `traceId`、`spanId` 或 `traceContext`。`agent-contracts`、公共业务 DTO 和 gateway Record MUST NOT 增加独立 trace ID、span ID 或 SDK context 字段；唯一持久化例外是 `RunTimelineEventRecord.inlinePayload.trace` 中由 trace-aware decorator 写入的受控 JSON snapshot。

#### Scenario: 外部 gateway call 传播 trace context 不改变 gateway contract

- **WHEN** gateway、model provider 或 capability source call 在 active request/run 中发出
- **THEN** trace propagation wrapper MUST 通过 implementation-owned transport metadata 传播 trace context
- **AND** public business request/response contract MUST NOT 要求 trace id、span id 或 SDK context fields

#### Scenario: boundary wrappers 在 model 和 executor calls 间携带 diagnostics

- **WHEN** runtime 调用 model invocation、capability executor、gateway adapter、hook execution 或 policy evaluation
- **THEN** shared boundary wrapper MUST 绑定适用的 diagnostic context 和执行引用
- **AND** 被调用 business module MUST NOT 在 public contract 中定义 trace/span fields

#### Scenario: trace attribute candidates 需要 policy 批准

- **WHEN** business module 添加 base station id 或 stable operation category diagnostic candidate
- **THEN** candidate 在 TRACE surface policy 批准安全表示前 MUST 保持为非输出 diagnostic context
- **AND** high-cardinality 或 unclassified candidates MUST 默认省略

#### Scenario: async handoff trace 使用 OpenTelemetry span links

- **WHEN** TraceProjector 消费带有效 implementation-owned SpanContext carrier 的辅助 observation event
- **THEN** TraceProjector MUST 创建指向该 source span context 的 OpenTelemetry span link
- **AND** MUST NOT 使用 consumer-local ALS 伪造 parent span context

#### Scenario: trace exporter 使用 OTLP 且不向业务 contract 泄漏 SDK types

- **WHEN** agent-observability 导出 trace output
- **THEN** exporter MUST 通过官方 OpenTelemetry JavaScript components 使用 OTLP traces
- **AND** OpenTelemetry SDK、exporter、tracer、span、meter 或 propagator types MUST NOT 出现在 `agent-contracts` 或 business package public contracts 中

#### Scenario: 业务执行只激活稳定引用

- **WHEN** runtime 执行请求、core 调用模型或能力、workflow 执行本地节点
- **THEN** 对应执行包装边界 MUST 激活 `ExecutionCorrelationRef`
- **AND** 业务 package MUST NOT 创建、结束或持有 OTel span

#### Scenario: 外部调用传播当前最窄权威执行 span

- **WHEN** CLIP、REST、模型、RAG、工具或能力来源在模型、能力或工作流节点执行引用激活期间被调用
- **THEN** 下游 `traceparent` 的父 span 标识 MUST 等于当前最窄 timeline 权威执行 span
- **AND** 下游业务 DTO MUST NOT 增加 trace ID、span ID 或 SDK context 字段

#### Scenario: 出站适配器不创建物理传输 span

- **WHEN** OpenRouter、CLIP、SkillHub HTTP v1、RobotRouter 或远端 RAG 发送携带 W3C 载体的请求
- **THEN** NextAgent MUST NOT 为该物理传输创建额外 CLIENT 或 SERVER span
- **AND** gateway 辅助观测 span MUST NOT 成为该请求的传播父级
- **AND** 下游载体的 parent-id MUST 来自当前 timeline 权威执行 span

#### Scenario: exporter 不可用不关闭进程内关联

- **WHEN** trace 已启用但 OTLP exporter 未配置或不可用
- **THEN** timeline event MUST 仍可获得有效 trace 关联
- **AND** 下游 MUST 仍可获得有效 W3C 载体
- **AND** exporter 失败 MUST NOT 改变请求执行或持久化结果

### Requirement: 结构化日志关联字段写出前必须经过 redaction

写入结构化日志的 request/run 关联字段 SHALL 先经过 unified redaction policy。structured log outputs 不得包含 raw prompt、raw thinking、raw model output、raw tool arguments、raw tool result、raw attachment content、raw large content、raw provider response、raw secret、credential、token、stack trace、未脱敏本地路径或 unauthorized object content。

#### Scenario: provider failure 可关联但不暴露 raw body
- **WHEN** provider call 带 raw response body 或 stack trace 失败
- **THEN** structured log output 只能包含 safe error category、safe reason code、retryability、provider kind 和 bounded latency
- **AND** raw response body 和 stack trace 不得输出

#### Scenario: redaction 删除不安全 linking field
- **WHEN** candidate structured log field 被 redaction policy 拒绝
- **THEN** 该字段必须被移除或替换为 safe reason code
- **AND** 剩余 diagnostic output 仍可输出

### Requirement: trace/log linking 不得创建或覆盖权威业务事实

structured log correlation output MUST 被视为 derived observability evidence。它不得创建、更新、替换或覆盖 `RequestRun`、`RunTimelineEvent`、`SessionMessage`、checkpoint、pending input、artifact、memory record、audit event 或 terminal commit facts。

#### Scenario: trace output 与 runtime truth 冲突
- **WHEN** trace/log diagnostics 和 runtime durable facts 看起来不一致
- **THEN** runtime durable facts 仍是权威事实
- **AND** trace/log diagnostics 必须被视为可能 degraded 的 observability evidence

### Requirement: trace context 不得注入 runtime timeline 或 message payload

trace context MUST NOT 写入 `DiagnosticContext`、`SessionMessage.metadata`、公共 Web DTO、stream DTO、审计事实、指标标签、幂等键或 RequestRun 顶层字段。`RunTimelineEvent.inlinePayload.trace` 是唯一允许保存 trace/span 关联的业务持久化位置。

trace 启用且持久化 timeline lifecycle 能解析到 timeline 权威执行 span 时，组装期 trace-aware store decorator MUST 在首次持久化前写入 `inlinePayload.trace`。该对象 MUST 包含小写 32 位十六进制 `traceId`、小写 16 位十六进制 `spanId` 和当前 span 的 `traceparent`；存在标准父 span 时 MUST 包含 `parentSpanId`；存在有效 `tracestate` 时 MUST 保存该值；本地工作流真实执行节点 MUST 按直接前驱解析结果保存 `previewSpanIds`。START/END 脚手架不创建独立 span；request span 可解析时，其 timeline event MUST 复用 request span snapshot 并省略 `previewSpanIds`。

runtime timeline producer MUST NOT 生成 trace/span 标识。业务 producer 提供的 `inlinePayload.trace` MUST 被整体丢弃。trace-aware decorator MUST 保留其他业务 payload 和 runtime 生成的 `attributes`。enrichment 缺失、无效或失败时，系统 MUST 省略 `trace`，并 MUST NOT 改变 event sequence、createdAt、persistence 分类、生命周期、回放、恢复、Owner Scope、Agent Scope、terminal commit 或请求结果。

message store MUST NOT 为 trace/span injection 包装。`SessionMessage` MAY 继续通过稳定 `messageId`、`requestId`、`runId` 和 `timelineEventId` 引用间接关联，但 trace/span snapshot MUST NOT 进入 message metadata。

#### Scenario: timeline observation 不修改 payload

- **WHEN** runtime producer append 或 publish `RunTimelineEvent`
- **THEN** runtime producer MUST NOT 向 `inlinePayload` 注入 traceId 或 spanId
- **AND** 只有 composition-time trace-aware decorator MAY 在物理持久化前写入保留 `inlinePayload.trace`

#### Scenario: message store 不携带 trace refs

- **WHEN** root user message、assistant message、tool result message 或 hidden/context message 被持久化
- **THEN** message store MUST NOT 向 message metadata 注入 trace id 或 span id
- **AND** diagnostics MUST 通过 stable message / request / run / timeline refs 和 timeline trace snapshot 导航

#### Scenario: trace context 不重定义 runtime truth

- **WHEN** `traceId` 或 `spanId` 缺失、无效或与 runtime facts 不一致
- **THEN** sequence、createdAt、lifecycle state、replay、recovery、terminal commit、audit truth、owner scope、agent scope 和 metrics labels MUST 继续使用 authoritative runtime facts
- **AND** 系统 MUST NOT 使用后续 projector output 回填或重写 persisted timeline event

#### Scenario: 首次持久化已经包含 trace

- **WHEN** 一个 lifecycle START event 通过 trace-aware timeline store 持久化
- **THEN** 返回并保存的 event MUST 已包含该 lifecycle span 的 `inlinePayload.trace`
- **AND** 实时查询 MUST NOT 依赖后续 projector、回填或同步任务获得关联

#### Scenario: 终止复合提交使用同一 enrichment

- **WHEN** 请求终止 event 通过 `commitTerminal` 复合事务持久化
- **THEN** 终止 event MUST 在事务开始前完成 request span enrichment
- **AND** 事务提交成功后才能结束 request span

#### Scenario: 消息和公共 DTO 不携带 trace

- **WHEN** 用户消息、助手消息、工具结果、stream event 或 Web 响应被创建
- **THEN** 其公共或持久化 metadata MUST NOT 包含 traceId、spanId、traceparent、tracestate 或 previewSpanIds
- **AND** trace 关联 MUST 仅保留在 timeline 和 OTel

#### Scenario: trace enrichment 失败不改变权威事实

- **WHEN** lifecycle、registry、snapshot 或 attribute 写入失败
- **THEN** 业务 event MUST 按原持久化契约继续处理
- **AND** 系统 MUST 输出不包含原始载体、payload 或 taskEventId 的有界安全降级证据
- **AND** 持久化已经成功时，任一提交后 lifecycle 回调失败 MUST NOT 把成功结果改为异常

### Requirement: structured log linking failures 必须明确、有界且非阻塞

structured log linking failure、context injection failure、logger sink failure 或 serialization failure MUST NOT 阻塞 request acceptance、model invocation、capability invocation、gateway call、stream projection、terminal commit 或 recovery。发生这些失败时，系统必须产生 bounded safe degradation evidence。OpenTelemetry trace propagation failure、trace context capture failure 和 remote trace sink unavailability 同样必须保持 non-blocking，并由 observability-owned OTel adapter degradation policy 处理。

#### Scenario: terminal commit 时 logger sink 不可用
- **WHEN** terminal commit 成功但 log sink 不可用
- **THEN** terminal outcome 必须保持 committed
- **AND** 系统必须记录 safe observability degradation，且不改变用户可见 terminal result

### Requirement: downstream diagnostics 只能把 trace/log linking 当作导航辅助

audit sink、metrics、health、release gates 和 operator tooling SHALL 只能使用 structured log linking fields 导航相关诊断。它们不得把 structured log output 当作 request status、owner scope、audit fact、checkpoint state、session history 或 capability result 的权威来源。

#### Scenario: release gate 使用 linked diagnostics
- **WHEN** release gate 检查失败请求是否可诊断
- **THEN** 它可以验证 structured logs 是否包含安全业务标识和 reason codes
- **AND** pass/fail 决策仍必须使用 authoritative runtime、audit、health 或 test evidence

### Requirement: timeline 权威执行 span MUST 由 timeline lifecycle 驱动

trace 启用时，系统 MUST 在持久化 lifecycle START event 前创建 timeline 权威执行 span，在对应 TERMINAL event 持久化成功后结束同一个 span。请求、直接模型、直接能力和本地工作流真实执行节点各自 MUST 使用稳定 `ExecutionCorrelationRef` 匹配 START 与 TERMINAL。START/END 脚手架 MUST 不创建 `ExecutionCorrelationRef` 或 timeline 权威执行 span。

同一 lifecycle 的 START、任一持久化中间 event 和 TERMINAL MUST 保存相同 `traceId` 和 `spanId`。重复 START MUST 复用首次 span。重复 TERMINAL MUST NOT 重复结束或导出第二个 span。缺少 START 的 TERMINAL MUST NOT 触发补建 span。

普通 timeline append 与请求终止复合提交 MUST 使用同一个 lifecycle 实例和 span registry。`LIVE_ONLY` event MUST 保持非持久化，并 MUST NOT 因 trace enrichment 改变分类。

#### Scenario: 一个模型 lifecycle 只生成一个 span

- **WHEN** `MODEL_INVOCATION_STARTED` 持久化成功，随后 `MODEL_INVOCATION_COMPLETED` 持久化成功
- **THEN** 两条 event MUST 包含相同的 model spanId
- **AND** 系统 MUST 恰好结束一个 model span

#### Scenario: 终止写入失败时允许重试

- **WHEN** lifecycle TERMINAL event 的持久化未提交
- **THEN** 对应 ACTIVE span MUST 保持可供下一次持久化重试使用
- **AND** 未提交结果 MUST NOT 被当作 lifecycle 完成

#### Scenario: START 写入失败清理新 span

- **WHEN** lifecycle START event 的持久化失败
- **THEN** 本次新建 span MUST 以错误状态结束并从 ACTIVE registry 移除
- **AND** 业务错误 MUST 按原 timeline gateway 契约返回

### Requirement: timeline 权威执行 trace MUST 保持受控 NextAgent 层级

每个已接收请求 MUST 对应一个 request timeline 权威执行 span。每个本地工作流真实执行节点实例、既有直接 MODEL span和 Tool Loop 产生的 CAPABILITY span MUST 对应 request span 的直接子 span。

本地 recipe route 和 START/END 脚手架 MUST NOT 创建独立 timeline 权威执行 span；该 route 的真实执行节点 MUST 各自创建 WORKFLOW_NODE span。节点内部调用模型、`CapabilityInvocationPort`、CLIP、REST、RAG 或远端工具 MUST NOT 合成 MODEL/CAPABILITY lifecycle；下游 W3C 载体 MUST 使用当前节点 span。

MODEL 或 CAPABILITY span MUST NOT 因普通代码调用嵌套而互相成为父级。父级选择 MUST 在 START event 首次持久化时冻结；既有 MODEL 和 CAPABILITY MUST 始终使用 request span。NextAgent 权威执行层级 MUST 固定为 request → workflow node、request → MODEL 或 request → CAPABILITY。

工作流节点的控制顺序 MUST 通过 `previewSpanIds` 表达，不得通过把同级节点改为 OTel 父子关系表达。

#### Scenario: 两节点 recipe 的父级和顺序正确

- **WHEN** 一个请求依次执行本地节点 A 和 B 后完成
- **THEN** timeline MUST 至少包含 `REQUEST_ACCEPTED`、A 的 `CAPABILITY_STARTED` 和 `CAPABILITY_COMPLETED`、B 的 `CAPABILITY_STARTED` 和 `CAPABILITY_COMPLETED` 以及请求终止 event
- **AND** A 与 B 的 `parentSpanId` MUST 都等于 request spanId
- **AND** A MUST 包含 `previewSpanIds=[]`
- **AND** B MUST 包含 `previewSpanIds=[A.spanId]`
- **AND** recipe route、START 和 END MUST 不存在独立 timeline 权威执行 span

#### Scenario: 节点内模型调用不新增 lifecycle

- **WHEN** 工作流节点内部调用模型，并在该执行范围内向远端服务发出请求
- **THEN** node span MUST 是 request span 的直接子级
- **AND** timeline MUST NOT 因该调用新增 `MODEL_INVOCATION_STARTED`、`MODEL_INVOCATION_COMPLETED` 或 `MODEL_INVOCATION_FAILED`
- **AND** 系统 MUST NOT 创建该调用专属 MODEL span
- **AND** 远端请求 MUST 使用当前 node span 作为 W3C 父级

#### Scenario: 节点内能力端口调用不合成 lifecycle

- **WHEN** 工作流节点 handler 直接调用 `CapabilityInvocationPort`
- **THEN** 系统 MUST NOT 合成能力 START、TERMINAL event 或 CAPABILITY ref
- **AND** 该调用中的 REST、CLIP、RAG 或远端工具请求 MUST 使用当前 node span 作为 W3C 父级

#### Scenario: 既有直接模型和 Tool Loop 能力挂在 request 下

- **WHEN** 既有 `RunBoundModelInvocation` 产生模型 lifecycle，或 Tool Loop 产生能力 lifecycle
- **THEN** 对应 MODEL 或 CAPABILITY span MUST 是 request span 的直接子级
- **AND** 系统 MUST NOT 根据普通代码调用栈选择另一个 MODEL 或 CAPABILITY span 为父级

### Requirement: 入站 W3C 上下文 MUST 经过统一校验

每个请求通道 MUST 按自身传输契约提取 OPTIONAL W3C 载体，并在运行时提交范围内绑定到统一入站关联。通道 MUST NOT 创建 span 或把入站载体写入提交命令、RequestRun、RequestContext、checkpoint、消息或公共 DTO。

有效 `traceparent` MUST 成为 request span 的远程父级，不论其 sampled flag 为 0 或 1。缺失或无效载体时，trace-aware lifecycle MUST 创建 root request span。无效载体 MUST 不被回显到 timeline、日志、审计或安全错误。

异步任务的 HTTP 接收响应完成 MUST NOT 结束 request span。request span MUST 持续到请求终止 event 成功提交。

#### Scenario: 有效但未采样的上游上下文保持 trace

- **WHEN** 入站 `traceparent` 格式有效且 sampled flag 为 0
- **THEN** request span context MUST 使用相同 traceId 和入站 parentSpanId
- **AND** 是否记录或导出 MUST 由 OTel sampler 决定

#### Scenario: 缺失或无效载体创建 root

- **WHEN** 通道没有提供 traceparent，或提供格式错误、全零、重复或超限值
- **THEN** trace 启用时系统 MUST 创建新的 root request span
- **AND** 业务请求 MUST 不因无效 trace 载体被拒绝

#### Scenario: 异步执行超过 HTTP 响应

- **WHEN** 任务通道返回 accepted 后在后台继续执行
- **THEN** 后续模型、能力、节点和终止 event MUST 保持在已创建的 request trace 中
- **AND** HTTP response completion MUST NOT 结束 request span

### Requirement: Timeline enrichment MUST 覆盖全部持久化写路径

每个持久化 timeline event MUST 在物理 gateway 写入前经过 trace-aware lifecycle。普通追加、runtime-owned append、后台 append 和 session append MUST 通过装饰后的 `RunTimelineEventStoreGateway`；终止复合提交 MUST 通过装饰后的 `RequestRunStoreGateway`。

物理 local 或 remote gateway MUST NOT 创建 span、读取执行关联或导入 OTel。任何未经过装饰器的持久化产品路径 MUST 被架构或 composition 测试拒绝。

#### Scenario: 普通追加与终止提交共享 registry

- **WHEN** request START 通过 timeline store 保存，request TERMINAL 通过 request-run store 保存
- **THEN** 两条 event MUST 使用同一个 request spanId
- **AND** 两个 decorator MUST 不创建两个 registry

#### Scenario: LIVE_ONLY 不进入持久化

- **WHEN** event 的 persistence 分类为 `LIVE_ONLY`
- **THEN** trace-aware store MUST 不导致该 event 持久化
- **AND** event 的实时投递行为 MUST 保持不变
