## ADDED Requirements

### Requirement: Capability governance 精化核心 Capability 契约

系统 MUST 为 capability governance 精化核心 capability 契约面：把既有 catalog public contract 从 `CapabilityCatalogPort` 重命名为 `CapabilityCatalog`。`agent-contracts/capability` 下的 public catalog 契约 MUST 命名为 `CapabilityCatalog`；实现、context assembly、Agent core 和 app composition MUST NOT 引入或继续使用平行的 public catalog 契约名。

`agent-contracts/capability` MUST 拥有 `CapabilityCatalog`、`CapabilityProviderConfig`、`CapabilityDiscoveryMode`、`CapabilityProviderOptions`、`LocalDirectoryProviderOptions`、`SkillHubOptions`、`McpServerOptions`、`AgentRegistryOptions` 和 `CustomProviderOptions`。`agent-contracts/app` MUST NOT 拥有或导出第二个 `CapabilityProviderConfig`；携带 capability provider 配置的 app 配置 MUST 引用由 capability 拥有的 `CapabilityProviderConfig[]`。

本精化 MUST NOT 重命名 `CapabilityProvider`、`CapabilityDescriptor`、`CapabilityInvocationRequest`、`CapabilityInvocationResult` 或 `CapabilityInvocationPort`，也 MUST NOT 向 `agent-contracts` 添加实现类。

#### Scenario: Catalog 契约使用治理名称

- **WHEN** 一个 package 需要 capability catalog public contract
- **THEN** 它 MUST 从 `agent-contracts/capability` 导入并消费 `CapabilityCatalog`
- **AND** 在本精化实现后，它 MUST NOT 导入或导出 `CapabilityCatalogPort`
- **AND** catalog 实现 MUST 保持在 `agent-contracts` 之外

#### Scenario: Provider config 由 capability 拥有

- **WHEN** app composition 收到面向 capability governance 的 provider 配置
- **THEN** 类型化配置 MUST 是来自 `agent-contracts/capability` 的 `CapabilityProviderConfig[]`
- **AND** `agent-contracts/app` MUST NOT 定义同名的 provider config DTO

### Requirement: Capability context patch 支持受治理的 model 选择

当 model 选择/治理校验批准某个 patch 时，系统 MUST 为同一 request/run 的后续 model step 支持 `CapabilityInvocationResult.contextPatch.modelName` 和 `CapabilityInvocationResult.contextPatch.modelOptions`。Core MUST 在应用所请求的 model 变更之前，对照当前 request/run 的 Agent assembly、可见 model profile、model provider policy 和 model option 约束对其进行校验。

被接受的 model patch MUST 是 request-local 的，且 MUST NOT 改变 Agent assembly、session 配置、provider 配置、catalog 状态、全局 model profile 或已持久化的 session 状态。无效、未授权或未受治理的 model patch MUST 安全失败，MUST NOT 被静默应用或静默忽略。

`ContextAssemblyRequest` MUST 携带 runtime/core 已为该 request/run 接受的可信 `identityContext`，使 context assembly 能够查询 owner-scoped 状态，而无需 app composition 维护 request-local owner 侧映射。

#### Scenario: 受治理的 model patch 只在 request 内应用

- **WHEN** 一个 capability result 返回 `contextPatch.modelName` 或 `contextPatch.modelOptions`
- **AND** model 选择/治理校验为当前 Agent 和 request/run 批准了所请求的 patch
- **THEN** core MUST 只把该 patch 应用到同一 request/run 的后续 model step
- **AND** 任何持久化的 Agent、session、provider、catalog 或 model profile 配置 MUST NOT 被改变
- **AND** context assembly MUST 使用 request 携带的可信 `identityContext` 执行 owner-scoped context 查询

#### Scenario: 未授权的 model patch 安全失败

- **WHEN** 一个 capability result 返回 `contextPatch.modelName` 或 `contextPatch.modelOptions`
- **AND** 所请求的 patch 未被 model 选择/治理校验允许
- **THEN** core MUST 产生安全的 capability 失败
- **AND** 所请求的 model patch MUST NOT 被应用

### Requirement: Agent Core 使用 runtime 拥有的 Run State Port

系统 MUST 在 `agent-contracts/runtime` 下暴露 `AgentRunStatePort`，供 Agent 拥有的执行逻辑请求 runtime 拥有的 run 状态副作用。`AgentRunStatePort` MUST 支持发出 run timeline event、追加 run/session message，并以已接受的 `RequestRun` 和可信 `RequestContext` 保存 checkpoint。

`Agent.execute` MUST 只接受 `RequestRun`、`RequestContext` 和 `AbortSignal`。它 MUST NOT 接受 timeline 或 message port 作为 execute 时参数，实现 MUST NOT 为旧 execute 签名保留兼容重载。

Runtime MUST 把 `AgentRunStatePort` 实现为 runtime 拥有的 run 状态写 service，并通过 Agent 构造注入它。该 port MAY 是单例 service，因为每个操作都接收已接受的 `RequestRun` 和可信 `RequestContext`。如果 terminal commit 需要 per-run terminal 输出聚合，MUST 保存在 Agent Core 契约面之外由 runtime 拥有的 per-run 状态中。

App composition MUST NOT 为 Agent Core checkpoint 写入合成 `SubmitRequestCommand` 或 submit-command 形状的对象。Checkpoint 的 owner scope MUST 来自可信 `RequestContext.identityContext`；该 checkpoint 事实形状的 checkpoint 幂等 MUST 由已接受的 `run.runId`、`triggerReason` 和 `run.version` 锚定。

Runtime MUST 拥有 Agent 实例生命周期管理。它 MUST 接收由 app 组合的 `AgentConstructor[]` 和 Agent runtime 依赖，创建 runtime 拥有的 `AgentRunStatePort`，并决定何时为一个已接受的 request run 创建、复用或执行 Agent 实例。Runtime MUST NOT 为构建 Agent 实现而导入 `agent-core` 或 `agent-app`。

`AgentConstructor` MUST 是标准构造器契约，其类级 `getType()` 返回一个 `AgentType`。`AgentAssembly` MUST 携带可信 `agentType`；runtime MUST 从 `assembly.agentType` 解析构造器，并 MUST 把 Agent 复用限定在已接受的 assembly 身份范围内：`agentId`、`agentVersion` 和 `agentAssemblyRef`。App composition MAY 注册 Agent 构造器并注入 Agent runtime 依赖，但 MUST NOT 拥有 Agent 实例缓存、复用或执行生命周期策略。Agent 实现 package MAY 提供便利基类，但外部 Agent 兼容性 MUST 保持为 `Agent` 接口加上 `AgentConstructor` 形状。

Capability audit MUST 集中在 observability/audit 边界之后，并可由 runtime 拥有的 canonical lifecycle event 派生。Capability executor 和 Agent Core MUST NOT 为 capability audit 直接调用 `AuditEventWriter`；Agent Core MUST 发出安全的 capability lifecycle event，runtime MUST 用可信 owner/agent/run/session 坐标将其规范化，observability/audit 代码 MAY 从这些 canonical event 派生 audit event 而不改变 request lifecycle 结果。Capability audit 派生 MUST NOT 依赖 capability hook 的前后执行；hook MAY 产生自己的 hook audit/诊断事实，但它们 MUST NOT 是 capability invocation audit 的权威载体。

#### Scenario: Agent execute 限定为 run context 和 signal

- **WHEN** runtime 把一个已接受的 request run 分派给 Agent Core
- **THEN** 它 MUST 构造或提供一个带有 runtime 拥有的 `AgentRunStatePort` 的 Agent
- **AND** 它 MUST 调用 `Agent.execute(run, context, signal)`
- **AND** 它 MUST NOT 通过 `Agent.execute` 传递 timeline 或 message port
- **AND** runtime 拥有的 per-run terminal 输出状态 MUST 按已接受的 run id 隔离

#### Scenario: Core checkpoint 写入不在 app composition 中合成 submit command

- **WHEN** Agent Core 在一次 capability 调用前保存 capability checkpoint
- **THEN** 它 MUST 调用 `AgentRunStatePort.saveCheckpoint(run, context, "CAPABILITY_BEFORE_CALL")`
- **AND** runtime 拥有的代码 MUST 执行该 checkpoint 写入
- **AND** checkpoint 幂等 MUST 使用已接受的 run id、trigger reason 和 run version
- **AND** `agent-app` MUST NOT 为该 checkpoint 路径构造伪造的 submit command

#### Scenario: Runtime 通过已注册构造器实例化 Agent

- **WHEN** runtime 分派一个已接受的 request run
- **THEN** 它 MUST 通过已注册的 `AgentConstructor[]` 解析已接受的 `AgentAssembly.agentType`
- **AND** Agent 实例创建和复用决定 MUST 由 runtime 拥有，并限定在已接受的 `agentId`、`agentVersion` 和 `agentAssemblyRef` 范围内
- **AND** 它 MUST 在 Agent runtime kit 中传递 runtime 拥有的 `AgentRunStatePort`
- **AND** `agent-runtime` MUST NOT 导入 `agent-core` 或 `agent-app`

#### Scenario: Capability audit 从 canonical event 派生

- **WHEN** Agent Core 消费一次 capability invocation result
- **THEN** 它 MUST 为当前 run 发出安全的 capability terminal lifecycle event
- **AND** runtime MUST 在 observability/audit 派生前将该 event 规范化
- **AND** capability executor 和 Agent Core MUST NOT 直接写 capability audit event
- **AND** capability audit 派生 MUST 由 observability/audit 边界拥有，而不是 capability hook
- **AND** observability/audit 派生 MUST NOT 改变 request lifecycle 结果
