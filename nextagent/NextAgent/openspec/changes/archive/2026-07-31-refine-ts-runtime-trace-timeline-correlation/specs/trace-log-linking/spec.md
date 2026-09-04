# trace-log-linking 规格增量

## MODIFIED Requirements

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

## ADDED Requirements

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
