# otel-trace-export Specification

## Purpose

定义如何在 system config 中配置 OTel tracing 参数，在运行时入口初始化 OpenTelemetry SDK，并将已 redaction 的 ObservabilityObservationEvent 通过 TraceProjector 映射为三层嵌套的 OTLP traces span 导出到外部轨迹中心。

## ADDED Requirements

### Requirement: OTel tracing 配置必须走 system config + SecretReference

system config 的 observability.tracing 段 MUST 提供 endpoint、authPkRef、authSkRef 和可选 serviceName 配置项。endpoint 使用 env:VAR_NAME 格式的 SecretReference。authPkRef 和 authSkRef 使用 SecretReference（env: 或 file:），由 AppCredentialResolver 统一解析和校验。serviceName 为非敏感字符串，默认 nextagent。

#### Scenario: 配置完整时正常解析

- **WHEN** observability.tracing 的 endpoint、authPkRef、authSkRef 均已配置且 SecretReference 解析成功
- **THEN** app entrypoint MUST 将解析后的 endpoint URL 和认证信息传递给 agent-observability owning 的 OTel trace infrastructure factory
- **AND** AppCredentialResolver MUST 对 authPkRef 和 authSkRef 执行 validate/resolve

#### Scenario: 配置项格式校验

- **WHEN** authPkRef 或 authSkRef 不符合 env: 或 file: 格式
- **THEN** config validation MUST 报告校验失败
- **AND** 不得将原始值传入 OTel SDK

### Requirement: 缺值时必须跳过 trace 上报

app entrypoint MUST 检查 endpoint、authPkRef、authSkRef 三个字段。任一字段未配置或 resolve 失败时 MUST 跳过 OTel SDK 初始化，通过唯一 operational writer 输出不含字段值的 bounded safe reason，traceProjector 为 undefined。不得在认证信息不完整时发出 trace 请求。

#### Scenario: endpoint 未配置时跳过

- **WHEN** observability.tracing.endpoint 未配置或为空
- **THEN** 系统 MUST 通过 operational writer 输出 `TRACING_CONFIG_ABSENT` 或 `MISSING_ENDPOINT_OR_CREDENTIALS` safe reason，不输出 endpoint 值
- **AND** traceProjector MUST 为 undefined
- **AND** 启动 MUST 正常继续

#### Scenario: authPkRef 未配置时跳过

- **WHEN** endpoint 已配置但 authPkRef 未配置
- **THEN** 系统 MUST 通过 operational writer 输出 bounded safe reason，不输出 authPkRef 名称或值
- **AND** traceProjector MUST 为 undefined

#### Scenario: authSkRef resolve 失败时跳过

- **WHEN** authSkRef 已配置但 AppCredentialResolver resolve 失败（如环境变量不存在）
- **THEN** 系统 MUST 通过 operational writer 输出 `CREDENTIAL_RESOLUTION_FAILED` safe reason和安全异常证据，不输出 authSkRef 名称或值
- **AND** traceProjector MUST 为 undefined
- **AND** 启动 MUST 正常继续

### Requirement: 运行时入口必须初始化 OTel SDK

运行时入口（agent-app local-runtime-package） MUST 在 OTel trace infrastructure 初始化前创建唯一 operational writer，并从 systemConfig 读取 tracing 配置、通过 credentialResolver 解析认证 key。agent-observability MUST owning NodeTracerProvider、BatchSpanProcessor、OTLPTraceExporter 与 TraceProjector 创建；agent-app MUST NOT 直接依赖 OTel trace SDK。SDK 初始化失败时 MUST 通过 component RuntimeLogger 输出安全 failureStage/reason/exception evidence并继续启动。

#### Scenario: SDK 初始化成功

- **WHEN** tracing 配置完整且 OTel SDK 包可用
- **THEN** 系统 MUST 构造 OTLPTraceExporter（含解析后的 endpoint 和 Basic Auth header）、BatchSpanProcessor 和 NodeTracerProvider
- **AND** provider.register() MUST 使 trace.getTracer() 返回真实 Tracer
- **AND** 系统 MUST 通过 operational writer 输出一次 `otel.trace.init.completed`，不得包含 endpoint、credential或serviceName
- **AND** createTraceProjector() MUST 返回使用真实 Tracer 的 TraceProjector

#### Scenario: SDK 依赖缺失时安全降级

- **WHEN** OTel SDK 初始化失败
- **THEN** 系统 MUST 通过 operational writer 输出 `TRACE_SDK_INITIALIZATION_FAILED` 和安全异常证据，不得包含原始错误信息
- **AND** 启动 MUST 正常继续
- **AND** traceProjector MUST 为 undefined，不注入 App 创建函数

### Requirement: TraceProjector 必须实现三层 Span 嵌套

TraceProjector MUST 按 requestRunId 分组，通过 resolveParentContext() 推衍父子关系：REQUEST_ACCEPTED 作为根 span，MODEL_INVOCATION 作为 REQUEST_ACCEPTED 的子 span，CAPABILITY_INVOCATION 作为最新 MODEL_INVOCATION 的子 span。其他 request_lifecycle 和 system 事件 MUST 挂在 rootSpanContexts 对应的根 span 下。covers() MUST 过滤没有 requestRunId 的孤立事件。

#### Scenario: REQUEST_ACCEPTED 创建根 span

- **WHEN** TraceProjector 处理 boundary=request_lifecycle、operation=REQUEST_ACCEPTED 的事件
- **THEN** 系统 MUST 以 ROOT_CONTEXT 为父上下文创建 span
- **AND** span context MUST 记录到 rootSpanContexts[requestRunId]

#### Scenario: MODEL_INVOCATION 挂在根 span 下

- **WHEN** TraceProjector 处理 boundary=model_invocation 事件且 rootSpanContexts[requestRunId] 存在
- **THEN** 系统 MUST 以 rootSpanContexts[requestRunId] 为父上下文创建 span
- **AND** span context MUST 记录到 modelInvocationContexts[requestRunId]

#### Scenario: CAPABILITY_INVOCATION 挂在最新 MODEL_INVOCATION 下

- **WHEN** TraceProjector 处理 boundary=capability_invocation 事件且 modelInvocationContexts[requestRunId] 存在
- **THEN** 系统 MUST 以 modelInvocationContexts[requestRunId] 为父上下文创建 span

### Requirement: 每个 span 必须设置 observation_type 和 SpanKind

TraceProjector MUST 为每个 span 设置 nextagent.observation_type 属性，按 boundary 映射：model_invocation -> model，capability_invocation -> tool，request_lifecycle -> request，gateway_call -> gateway，system -> system。SpanKind 按相同规则：model_invocation/capability_invocation -> CLIENT，gateway_call -> SERVER，其他 -> INTERNAL。

#### Scenario: model_invocation span 设置 CLIENT kind 和 model observation_type

- **WHEN** TraceProjector 创建 boundary=model_invocation 的 span
- **THEN** span MUST 设置 SpanKind 为 CLIENT
- **AND** span MUST 设置 nextagent.observation_type 属性为 model

#### Scenario: gateway_call span 设置 SERVER kind 和 gateway observation_type

- **WHEN** TraceProjector 创建 boundary=gateway_call 的 span
- **THEN** span MUST 设置 SpanKind 为 SERVER
- **AND** span MUST 设置 nextagent.observation_type 属性为 gateway

### Requirement: span 必须映射 safeSummary 和 outcome 供轨迹中心显示

TraceProjector MUST 将已脱敏的 safeSummary 映射到 span 的 input.value 属性，将 outcome 和 safeReasonCode（如有）映射到 output.value 属性。这两个属性供轨迹中心（如 LangFuse）在 span 详情页显示输入摘要和输出结果。safeSummary 和 outcome 均为经过 sanitizeObservation() 脱敏的安全字段，MUST NOT 映射任何未脱敏的原始数据。

#### Scenario: safeSummary 映射到 input.value

- **WHEN** TraceProjector 创建 span 且事件的 safeSummary 字段存在
- **THEN** span MUST 设置 input.value 属性为 safeSummary 的值
- **AND** 该值 MUST 已经过 sanitizeObservation() 脱敏处理

#### Scenario: outcome 映射到 output.value

- **WHEN** TraceProjector 创建 span
- **THEN** span MUST 设置 output.value 属性
- **AND** 该属性 MUST 包含 outcome 值
- **AND** 当 safeReasonCode 存在时该属性 MUST 同时包含 safeReasonCode 值

#### Scenario: safeSummary 缺失时省略 input.value

- **WHEN** 事件的 safeSummary 字段为 undefined
- **THEN** span MUST NOT 设置 input.value 属性

### Requirement: currentOtelSpanId() 必须安全获取当前 Span ID

agent-observability MUST 提供 currentOtelSpanId() 函数，使用动态 require 获取 @opentelemetry/api 并返回当前活跃 OTel Span 的 spanId。当 @opentelemetry/api 不可用或当前上下文无活跃 span 时，MUST 返回 undefined 而不抛异常。

#### Scenario: SDK 可用时返回当前 span ID

- **WHEN** OTel SDK 已初始化且当前上下文有活跃 span
- **THEN** currentOtelSpanId() MUST 返回当前 span 的 spanId 字符串

#### Scenario: SDK 不可用时安全降级

- **WHEN** @opentelemetry/api 不存在或未初始化
- **THEN** currentOtelSpanId() MUST 返回 undefined
- **AND** 不得抛出异常或阻断 agent-observability 包的加载

### Requirement: TraceProjector 失败不阻塞其他 surfaces

TraceProjector 在 resolveParentContext、startSpan 或 span 属性设置时抛出异常 MUST 返回 degraded 或 failed_closed，不得影响 LOG、AUDIT、METRIC、HEALTH 等 projector 对同一 observation 的处理。

#### Scenario: TraceProjector 异常返回 degraded

- **WHEN** TraceProjector 在 project() 中抛出异常
- **THEN** 返回值 MUST 为 { surface: "TRACE", outcome: "degraded", safeReasonCode: "PROJECTOR_FAILED" }
- **AND** ProjectorHost MUST 继续调用其他 covered projector 处理同一事件
