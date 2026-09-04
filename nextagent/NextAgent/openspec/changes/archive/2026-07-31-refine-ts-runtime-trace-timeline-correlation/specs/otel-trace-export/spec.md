# otel-trace-export 规格增量

## MODIFIED Requirements

### Requirement: OTel tracing 配置必须走 system config + SecretReference

system config 的 `observability.tracing` MUST 接受 OPTIONAL `enabled`、`endpoint`、`authPkRef`、`authSkRef` 和 `serviceName`。`enabled` MUST 为 boolean。`serviceName` MUST 为非敏感字符串，缺失时 MUST 使用 `nextagent`。

`endpoint`、`authPkRef` 和 `authSkRef` MUST 全部存在或全部缺失。三项全部存在时，`endpoint` MUST 使用 `env:VAR_NAME` SecretReference，`authPkRef` 和 `authSkRef` MUST 使用 `env:` 或 `file:` SecretReference，并 MUST 由 `AppCredentialResolver` 校验和解析。仅存在一项或两项时，配置校验 MUST 在请求监听器和 exporter 启动前失败。

`enabled=false` MUST 关闭进程内 trace 和 exporter，并 MUST 关闭 taskEventId 的运行绑定、timeline 属性与出站传播。`enabled=true` 且三项全部缺失时 MUST 只启用进程内 trace。`enabled` 缺失且三项全部存在时 MUST 保持自动启用。`enabled` 和三项 exporter 配置均缺失时 MUST 关闭 trace。

#### Scenario: 配置完整时正常解析

- **WHEN** `observability.tracing` 的 endpoint、authPkRef、authSkRef 均已配置且 SecretReference 解析成功
- **THEN** app entrypoint MUST 将解析后的 endpoint URL 和认证信息传递给 `agent-observability` owning 的 OTel trace infrastructure factory
- **AND** `AppCredentialResolver` MUST 对三项 SecretReference 执行校验和解析

#### Scenario: 配置项格式校验

- **WHEN** endpoint、authPkRef 或 authSkRef 不符合其允许的 SecretReference 格式
- **THEN** config validation MUST 报告校验失败
- **AND** 系统 MUST NOT 将原始值传入 OTel SDK

#### Scenario: 显式启用但未配置 exporter

- **WHEN** `observability.tracing.enabled=true` 且 endpoint、authPkRef、authSkRef 全部缺失
- **THEN** 系统 MUST 启用进程内 trace、timeline enrichment 和 W3C 传播
- **AND** 系统 MUST 不创建 OTLP exporter

### Requirement: 缺值时必须跳过 trace 上报

endpoint、authPkRef 和 authSkRef 三项全部缺失时，系统 MUST 跳过 OTLP exporter 初始化和远程 trace 上报。`enabled=true` 时，系统 MUST 继续初始化不导出的 tracer provider；`enabled` 缺失或为 `false` 时，系统 MUST 保持 trace 关闭。

三项配置完整但任一 SecretReference 解析失败，或 exporter 初始化、发送失败时，系统 MUST 跳过或停止远程上报，通过唯一 operational writer 输出不含字段值和原始 exporter error 的有界安全原因，并 MUST 保留已经启用的进程内 trace、timeline enrichment 和 W3C 传播。系统 MUST NOT 在认证信息不完整时发出 trace 请求。

#### Scenario: endpoint、凭据全部未配置

- **WHEN** endpoint、authPkRef 和 authSkRef 全部未配置
- **THEN** 系统 MUST 跳过 OTLP exporter 初始化
- **AND** `enabled=true` 时 trace provider MUST 继续可用

#### Scenario: authSkRef resolve 失败时只降级 exporter

- **WHEN** 三项配置完整但 `AppCredentialResolver` 无法解析 authSkRef
- **THEN** 系统 MUST 输出 `CREDENTIAL_RESOLUTION_FAILED` 安全原因且不输出引用名称或值
- **AND** 系统 MUST 不发送远程 trace 请求
- **AND** 已启用的进程内 trace MUST 继续可用

### Requirement: 运行时入口必须初始化 OTel SDK

运行时入口 MUST 在 OTel trace infrastructure 初始化前创建唯一 operational writer，并从 system config 解析 trace 启用状态和 OPTIONAL exporter 配置。`agent-observability` MUST 拥有 `NodeTracerProvider`、span processor、OPTIONAL `OTLPTraceExporter`、timeline span lifecycle 与 `TraceProjector` 的创建；`agent-app` MUST NOT 直接依赖 OTel trace SDK。

trace 启用时，运行时入口 MUST 初始化真实 tracer provider。exporter 配置完整且解析成功时，系统 MUST 追加 `BatchSpanProcessor` 和 `OTLPTraceExporter`。exporter 缺失、解析失败或初始化失败时，系统 MUST 使用不导出的 provider，并 MUST 通过 component RuntimeLogger 输出安全 failureStage 和 reason。provider 初始化本身失败时，系统 MUST 禁用 trace 并继续启动。

#### Scenario: SDK 与 exporter 初始化成功

- **WHEN** trace 已启用且 exporter 配置完整、解析成功
- **THEN** 系统 MUST 构造 OTLPTraceExporter、BatchSpanProcessor 和 NodeTracerProvider
- **AND** provider registration MUST 使 timeline lifecycle 和 TraceProjector 获得真实 Tracer
- **AND** 系统 MUST 输出一次不含 endpoint、credential 或 serviceName 的 `otel.trace.init.completed`

#### Scenario: exporter 初始化失败时保留进程内 trace

- **WHEN** NodeTracerProvider 初始化成功但 exporter 初始化失败
- **THEN** 系统 MUST 输出 `TRACE_EXPORTER_INITIALIZATION_FAILED` 安全证据
- **AND** timeline span、timeline trace enrichment 和 W3C 传播 MUST 继续工作
- **AND** 启动 MUST 正常继续

#### Scenario: provider 初始化失败时安全降级

- **WHEN** NodeTracerProvider 初始化失败
- **THEN** 系统 MUST 输出 `TRACE_SDK_INITIALIZATION_FAILED` 安全证据且不包含原始错误信息
- **AND** 系统 MUST 禁用 trace 并正常继续启动
- **AND** 注入 Task Channel 的最终 traceEnabled MUST 为 false，eventId MUST 不进入执行上下文、timeline 或出站请求头

### Requirement: 每个 span 必须设置 observation_type 和 SpanKind

timeline span lifecycle MUST 为 request、model、capability 和本地 workflow 真实执行节点权威执行 span 设置 `nextagent.observation_type`，对应值 MUST 分别为 `request`、`model`、`tool` 和 `workflow_node`。request 和 workflow node 的 SpanKind MUST 为 INTERNAL；model 和 capability 的 SpanKind MUST 为 CLIENT。

`TraceProjector` 创建 gateway 和 system 辅助 span 时，`nextagent.observation_type` MUST 分别为 `gateway` 和 `system`；两者的 SpanKind MUST 都为 INTERNAL。gateway 辅助 span 表示 NextAgent 内部诊断阶段，不得表示物理出站请求或入站服务处理。它 MUST 只使用经 allowlist 批准的 observation。

#### Scenario: model_invocation span 设置 CLIENT kind 和 model observation_type

- **WHEN** timeline lifecycle 创建 MODEL 权威执行 span
- **THEN** span MUST 设置 SpanKind 为 CLIENT
- **AND** span MUST 设置 `nextagent.observation_type=model`

#### Scenario: gateway_call 辅助 span 设置 INTERNAL kind

- **WHEN** TraceProjector 创建 gateway_call 辅助 span
- **THEN** span MUST 设置 SpanKind 为 INTERNAL
- **AND** span MUST 设置 `nextagent.observation_type=gateway`
- **AND** span MUST NOT 成为出站传播父级

#### Scenario: workflow node 使用内部 span kind

- **WHEN** timeline lifecycle 创建本地 workflow 真实执行节点权威执行 span
- **THEN** span MUST 设置 SpanKind 为 INTERNAL
- **AND** span MUST 设置 `nextagent.observation_type=workflow_node`

## ADDED Requirements

### Requirement: TraceProjector 必须实现受控 Span 层级

运行轨迹 MUST 替换 TraceProjector 根据代码调用推衍父级的旧路径，改为 timeline lifecycle 的受控 NextAgent 层级。timeline span lifecycle MUST 创建 request span，并把本地 workflow 真实执行节点、既有直接 model 和 Tool Loop 产生的 capability 创建为 request 的直接子级。workflow handler 内部调用模型或 `CapabilityInvocationPort` MUST NOT 生成额外 MODEL/CAPABILITY lifecycle 或 span。RECIPE 和 START/END 脚手架不创建独立 span。`TraceProjector` MUST NOT 为携带 `spanOwner="TIMELINE_LIFECYCLE"` 的 observation 创建、结束或修改 timeline 权威执行 span；request diagnostic allowlist observation MUST 不因 boundary 分类被整体屏蔽。

`TraceProjector` MUST 为 allowlist 中的 system、gateway 和 request diagnostic observation 创建辅助观测 span。能够解析 request context 时，辅助观测 span MUST 是 request span 的直接子级。system/gateway observation 缺少 request context 时 MUST 跳过 span 创建，MUST NOT 使用 ROOT_CONTEXT 新建 trace；request diagnostic 缺少 request context 时 MUST 创建不进入权威 registry 的独立诊断 span。没有 `requestRunId` 的 observation MUST 保持不覆盖。

#### Scenario: REQUEST_ACCEPTED 由 timeline lifecycle 创建 request span

- **WHEN** `REQUEST_ACCEPTED` timeline event 首次持久化
- **THEN** timeline lifecycle MUST 使用有效入站父级或 root 创建 request span
- **AND** TraceProjector MUST NOT 为后续 REQUEST_ACCEPTED observation 创建第二个 span

#### Scenario: 既有 MODEL_INVOCATION 挂在 request span 下

- **WHEN** 既有 `RunBoundModelInvocation` model lifecycle 在 request span 已存在时开始
- **THEN** timeline lifecycle MUST 以 request span 为父级创建 model span
- **AND** TraceProjector MUST NOT 保存私有 modelInvocationContexts

#### Scenario: Workflow 内部模型调用复用节点 span

- **WHEN** workflow handler 在有效 workflow node 执行范围内调用模型
- **THEN** 系统 MUST NOT 为该调用新增 `MODEL_INVOCATION_STARTED`、`MODEL_INVOCATION_COMPLETED`、`MODEL_INVOCATION_FAILED` 或 MODEL span
- **AND** 模型出站传播 MUST 使用当前 workflow node span

#### Scenario: Workflow capability 调用复用节点 span

- **WHEN** workflow handler 在有效 workflow node 执行范围内直接调用 `CapabilityInvocationPort`
- **THEN** 系统 MUST NOT 为该调用合成 `CAPABILITY_STARTED`、`CAPABILITY_COMPLETED` 或 CAPABILITY span
- **AND** 该调用中的出站传播 MUST 使用当前 workflow node span

## REMOVED Requirements

### Requirement: TraceProjector 必须实现三层 Span 嵌套

**Reason**：本 change 不为 workflow 节点内部模型调用新增 timeline event 或 MODEL span；继续保留三层要求会引入没有权威 timeline lifecycle 的第二套 span 生成路径。

**Migration**：以新增的“TraceProjector 必须实现受控 Span 层级”替代。既有直接 MODEL、Tool Loop CAPABILITY 和 WORKFLOW_NODE 都是 request 的直接子级；workflow 节点内部模型与 capability 调用复用节点 span。

### Requirement: span 必须映射 safeSummary 和 outcome 供轨迹中心显示

**Reason**：timeline 权威执行 span 的 input/output 不在本 change 范围内，`safeSummary` 也不能作为 timeline 生命周期的权威输入；继续映射会形成第二个不受 timeline allowlist 控制的 attribute owner。

timeline 权威执行 span MUST NOT 映射 `input.value` 或 `output.value`，并 MUST 只保留本 change 定义的 `eventId`、节点标识/描述、execution kind、outcome、安全原因码和 duration。后续若需要节点 input/output，必须通过独立 OpenSpec change 定义按节点类型的 allowlist。

### Requirement: currentOtelSpanId() 必须安全获取当前 Span ID

**Reason**：直接读取当前 OTel span ID 会让业务执行依赖 SDK 当前上下文，与稳定 `ExecutionCorrelationRef` 的唯一路径冲突。

业务执行和出站适配器 MUST 使用 `ExecutionCorrelationPort` 激活稳定引用并生成请求头；timeline trace snapshot MUST 只由 `TimelineSpanLifecyclePort` 生成。
