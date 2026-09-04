# otel-observability-adapter 规格增量

## MODIFIED Requirements

### Requirement: OTel adapters 必须通过既有 observation handoff 路径接入

OTel metrics 和辅助观测 span MUST 继续通过 `ObservabilityProjectorHost.acceptObservation(event)` 接入。timeline 权威执行 span MUST 通过 `agent-observability` 在 composition 时提供的 trace-aware timeline store decorator 接入，并 MUST 以持久化 timeline lifecycle 为唯一开始和终止来源。

`TraceProjector`、trace-aware timeline store、trace-aware request-run store、span registry、OTel provider、exporter 和 propagator MUST 属于 `agent-observability`。`agent-app` MUST 创建一个共享 lifecycle/registry 实例并完成装配。runtime、core、workflow、model、capability、channel 和物理 gateway MUST NOT 直接调用 OTel API。

`MetricsProjector` MUST 继续通过统一 `MetricsRegistry` 抽象写入 OTel Meter sink。trace-aware decorator MUST NOT 替代 structured log、metric、audit、health 或其他 projector，也 MUST NOT 给业务 path 增加 direct trace sink。

物理 local 和 remote gateway 的 public port、Record、SQLite schema、事务、sequence、幂等、CAS、Record 映射、持久化路径和 transport 行为 MUST 保持不变。trace-aware decorator MUST 把 gateway-bound mutation 限制在 `RunTimelineEventRecord.inlinePayload` 的保留 `trace` 命名空间，并 MUST NOT 修改 owner scope、agent scope、eventId、sessionId、runId、requestId、requestContextId、sequence、type、createdAt、contentRef、幂等键或终止事务的其他 Record。

#### Scenario: TRACE surface 通过 fixed projector set 接入

- **WHEN** `agent-app` 装配 observability projector host 和 trace-aware stores
- **THEN** `TRACE` surface 中的辅助 observation MUST 以 `ObservabilityProjector` 的形式加入 fixed projector set
- **AND** timeline 权威执行 span MUST 只由 trace-aware stores 接入
- **AND** business path MUST NOT 新增 direct trace sink

#### Scenario: OTel metrics 通过既有 MetricsProjector 接入

- **WHEN** `MetricsProjector` 需要把 sample 写到 OpenTelemetry
- **THEN** projector MUST 继续通过 `MetricsRegistry` 抽象写入
- **AND** business path 与 wrappers MUST NOT 直接调用 OTel Meter API

#### Scenario: gateway implementation 保持不变

- **WHEN** 系统落地 OTel trace / metric adapter
- **THEN** `agent-platform-gateway-local` 与 `agent-platform-gateway-remote` 的实现逻辑、public port、Record、SQLite schema、持久化路径和 transport 行为 MUST 保持不变
- **AND** gateway 相关 observability 语义 MUST 只通过 `agent-app` / `agent-observability` owning decorator、wrapper 与 projector 实现

#### Scenario: 权威执行 span 通过持久化装饰器接入

- **WHEN** 权威执行 lifecycle event 被持久化
- **THEN** trace-aware store MUST 在 gateway 写入前创建或解析 timeline 权威执行 span 并写入关联
- **AND** 业务 path MUST NOT 直接调用 tracer

#### Scenario: 辅助 span 和 metrics 保留 observation handoff

- **WHEN** system/gateway observation 或 metric observation 被处理
- **THEN** `TraceProjector` 或 `MetricsProjector` MUST 继续通过 projector host 消费
- **AND** timeline lifecycle decorator MUST NOT 替代 metric、log、audit 或 health projector

#### Scenario: 物理 gateway 保持 OTel-free

- **WHEN** local SQLite gateway 或 remote persistence adapter 保存 timeline 或 terminal transaction
- **THEN** gateway implementation MUST NOT 导入 OTel、创建 span 或解析 W3C 载体
- **AND** gateway MUST 只保存 decorator 提交的 Record

### Requirement: TraceProjector 必须只消费安全 observation 并映射到 OTel trace 语义

`TraceProjector` MUST 只消费已经过 host redaction 和最小结构校验的 `ObservabilityObservationEvent`。持久化 timeline 到 observation 的 mapper MUST 对已经由 timeline lifecycle 拥有 span 投影决策的 request、model、直接 capability、本地 workflow 真实执行节点和 START/END 脚手架 observation 设置 implementation-owned `spanOwner="TIMELINE_LIFECYCLE"`。`TraceProjector` MUST 只对携带该标记的 observation 避让，并 MUST NOT 为它们创建、结束或修改 timeline 权威执行 span，即使 registry 中不存在对应 span。该标记不要求 observation 拥有独立 span；START/END 只复用 request span snapshot。request diagnostic allowlist MUST 固定为 `REQUEST_REJECTED`、`TERMINAL_COMMITTED`、`TERMINAL_FAILED`、`REQUEST_CONTROL_REJECTED`、`PENDING_INPUT_REJECTED` 和 `POLICY_APPLIED`；这些 observation MUST 不设置该标记并 MUST 创建辅助观测 span。

对于 allowlist 中且能够解析 request context 的 system 和 gateway observation，`TraceProjector` MUST 创建辅助观测 span。每个辅助 span MUST 使用 timeline lifecycle registry 中的 request context 作为标准父级，并 MUST 作为 request span 的直接子级。找不到 request context 时，`TraceProjector` MUST 跳过 span 创建并返回有界降级结果，MUST NOT 创建新的 root trace。

request diagnostic allowlist observation 有 request context 时，其辅助观测 span MUST 使用 request span 作为父级；缺少 request context 时 MUST 创建独立诊断 span。该独立 span MUST NOT 注册为 request 权威执行 span、写入 timeline、参与 `previewSpanIds` 或成为出站传播父级。

辅助 span MUST 使用 INTERNAL SpanKind，不进入 execution registry、不写 timeline、不参与 `previewSpanIds`、不进入 active execution scope、不成为出站传播父级，并 MUST 省略高基数 `eventId`。gateway 辅助 span MUST NOT 使用 SERVER 表示 sandbox 或物理出站调用。Trace 语义 MUST 对齐 OpenTelemetry 1.9.0；跨进程传播 MUST 使用 W3C Trace Context，导出 MUST 使用 OTLP traces。异步 fan-out、replay 或 projector handoff 需要关联 source context 时，`TraceProjector` MUST 使用 implementation-owned SpanContext carrier 创建 span link，MUST NOT 使用 consumer-local AsyncLocalStorage 伪造 parent。

`TraceProjector` MUST NOT 修改 runtime timeline、gateway Record、消息、公共 DTO、terminal truth 或 audit truth。除受控 `RunTimelineEventRecord.inlinePayload.trace` 外，`traceId`、`spanId`、SpanContext、tracer、span 或 exporter 类型 MUST NOT 进入 `agent-contracts`、gateway Record、message metadata 或 public DTO。

#### Scenario: timeline 已拥有的 lifecycle 不产生重复 span

- **WHEN** `TraceProjector` 收到携带 `spanOwner="TIMELINE_LIFECYCLE"` 的 lifecycle observation
- **THEN** 它 MUST NOT 创建、结束或修改 timeline 权威执行 span
- **AND** timeline lifecycle registry 中的 span MUST 保持唯一权威执行 span

#### Scenario: 请求拒绝诊断继续保留

- **WHEN** `TraceProjector` 收到 request diagnostic allowlist 中没有 timeline span owner 的 observation
- **THEN** 它 MUST 继续按既有安全投影规则处理该 observation
- **AND** 它 MUST NOT 因 request_lifecycle boundary 被整体屏蔽
- **AND** request context 缺失时 MUST 创建不进入权威 registry 的独立诊断 span

#### Scenario: system 和 gateway span 挂在 request 下

- **WHEN** allowlist system 或 gateway observation 携带可解析的 requestRunId
- **THEN** `TraceProjector` MUST 创建 request span 的直接子 span
- **AND** 该辅助 span MUST NOT 成为 model、capability 或 workflow node 的子 span

#### Scenario: system 和 gateway 缺少 request context 不创建新 trace

- **WHEN** allowlist system 或 gateway observation 的 requestRunId 无法在共享 registry 或 tombstone 中解析
- **THEN** `TraceProjector` MUST 返回有界降级结果
- **AND** 它 MUST NOT 以 ROOT_CONTEXT 创建 span
- **AND** 本 Scenario MUST NOT 改变 request diagnostic allowlist 缺少 request context 时创建独立诊断 span 的规则

#### Scenario: TraceProjector 只使用安全 attributes

- **WHEN** `TraceProjector` 创建辅助 span
- **THEN** 它 MUST 只使用 allowlist 中的稳定引用、安全原因码、持续时间、用量和低基数诊断字段
- **AND** prompt、content、input、output、工具参数或结果、路径、凭据、token、附件内容、trace 载体原文和 eventId MUST NOT 成为辅助 span attribute

#### Scenario: TraceProjector 只使用 allowlist attributes

- **WHEN** TraceProjector 把 observation 映射到辅助 OTel span attributes
- **THEN** 它 MUST 只使用低基数、policy-approved 的 owner scope、stable refs、safe reason code、duration、usage 和 diagnostic candidates
- **AND** raw prompt、content、tool args/result、path、credential、token、attachment content、trace carrier 原文和自由文本原因 MUST NOT 成为 span attribute

#### Scenario: trace context 不改变权威业务事实

- **WHEN** TraceProjector 创建辅助 span、span event 或 span link
- **THEN** runtime timeline、terminal commit、audit truth、message store 和 request truth MUST 保持不变
- **AND** 缺失或损坏的 trace propagation metadata MUST NOT 回填或改写业务事实

## ADDED Requirements

### Requirement: Span Resource MUST 由 tracer provider 统一设置

NextAgent span 的 OTel Resource MUST 由 `agent-observability` tracer provider 从可信应用配置和资源检测器统一设置。Resource MUST 至少包含 `service.name`；配置或运行环境提供有效值时，MUST 设置 `service.version`、`service.instance.id`、deployment environment、pod、namespace 和容器资源属性。

timeline event、任务 metadata、模型输出、能力参数和 observation payload MUST NOT 提供或覆盖 Resource。远端 CLIP、模型、工具和 RAG 服务 MUST 上报自身 Resource；NextAgent MUST NOT 把本地 pod 或 service identity 作为下游 Resource 传播。

#### Scenario: 节点 event 不覆盖 pod resource

- **WHEN** 工作流节点 lifecycle payload 包含名为 podName 或 serviceName 的业务字段
- **THEN** timeline 权威执行 span Resource MUST 保持 tracer provider 配置值
- **AND** 业务字段 MUST NOT 成为 Resource attribute

### Requirement: 执行 trace MUST 与 OTLP exporter 独立启用

系统配置 MUST 接受 OPTIONAL `observability.tracing.enabled`。显式 `false` MUST 关闭进程内 span、timeline trace enrichment、W3C 传播和 OTLP exporter。显式 `true` MUST 启用进程内 span、timeline enrichment 和 W3C 传播，不论 exporter 是否配置。

`endpoint`、`authPkRef` 和 `authSkRef` MUST 全部存在或全部缺失；仅存在一项或两项时，应用配置 MUST 在监听端口启动前校验失败。`enabled=true` 且三项全部缺失时，系统 MUST 使用不导出的 tracer provider。`enabled` 缺失且三项全部存在时 MUST 保持自动启用；两者均缺失时 MUST 关闭 trace。

`agent-observability` infrastructure factory MUST 返回 provider 初始化后的最终 `traceEnabled`。`agent-app` MUST 在 Task Channel composition 前完成初始化，并 MUST 把该值作为不可变布尔策略注入 Task Channel。Task Channel MUST 只使用该策略决定是否映射已校验 eventId，MUST NOT 导入 OTel、读取 exporter 状态或自行解释 tracing config。

#### Scenario: 无 exporter 时仍生成关联

- **WHEN** `observability.tracing.enabled=true` 且 exporter 三项全部缺失
- **THEN** timeline 权威执行 span、timeline trace 和下游 W3C MUST 可用
- **AND** 系统 MUST 不尝试远程导出

#### Scenario: 显式关闭覆盖 exporter

- **WHEN** `observability.tracing.enabled=false` 且 exporter 配置完整
- **THEN** 系统 MUST 不创建或导出 span
- **AND** 系统 MUST 不绑定、保存或恢复 taskEventId
- **AND** timeline MUST 省略 `attributes.eventId`，下游 MUST 省略 `x-task-event-id`

#### Scenario: 部分 exporter 配置启动失败

- **WHEN** endpoint、authPkRef 和 authSkRef 中恰好存在一项或两项
- **THEN** 配置校验 MUST 失败
- **AND** 请求监听器和 exporter MUST 不启动
