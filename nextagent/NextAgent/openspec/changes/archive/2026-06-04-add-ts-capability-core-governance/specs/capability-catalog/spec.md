## ADDED Requirements

### Requirement: Capability governance 使用既有统一契约

系统 MUST 通过已冻结的 `agent-contracts/capability` 契约治理 `TOOL`、`SKILL` 和 `AGENT` capability。Runtime、core、context assembly、app composition、discovery adapter 和 executor adapter MUST NOT 引入平行的 descriptor、provider、invocation request、invocation result 或 capability kind vocabulary。

本 change MUST 复用已冻结的 `CapabilityProvider`、`CapabilityDescriptor`、`CapabilityInvocationRequest`、`CapabilityInvocationResult` 和 `CapabilityInvocationPort` 契约，并 MUST 应用把 catalog public contract 命名为 `CapabilityCatalog` 的 `ts-core-contracts` 精化。它 MAY 在 `agent-contracts/capability` 下新增 provider 配置 DTO/schema 契约，但 MUST NOT 重命名已冻结的 descriptor、invocation 或 result 字段，也 MUST NOT 引入平行的 descriptor、catalog、invocation 或 result 契约。catalog、discovery 或 execution 的实现类 MUST 位于 `agent-contracts` 之外。

#### Scenario: 默认 read capability 保持在统一路径上

- **WHEN** app 组合默认的 builtin capability 路径
- **THEN** `read` capability MUST 通过统一的 catalog 和 invocation port 暴露
- **AND** context/core MUST 消费与未来 Tool、Skill 和 Agent capability 相同的 descriptor 和 invocation result 契约

#### Scenario: Capability 子系统对 app composition 的影响是受限的

- **WHEN** `agent-app` 组合后端
- **THEN** 本 change 的 capability 子系统部分 MUST 只把 `CapabilityCatalog` 和 `CapabilityInvocationPort` 的创建替换为 `createCapabilitySubsystem(capabilityProviderConfigs)`
- **AND** 本 scenario MUST NOT 禁止另行规定的 `ts-core-contracts` 精化，即 request 携带的 owner scope 和 runtime 拥有的 `AgentRunStatePort` 注入
- **AND** `agent-app` MUST NOT 重排、重绑定或重新设计无关的 runtime、context、model、gateway、observability、attachment、memory 或其他非 capability 子系统的 composition

### Requirement: Provider 配置由 Capability 拥有

系统 MUST 从 `agent-contracts/capability` 暴露 `CapabilityProviderConfig`、`CapabilityDiscoveryMode`、`CapabilityProviderOptions` 以及 provider 专属的 option DTO/schema 契约。`agent-contracts/app` MUST NOT 拥有或导出第二个 `CapabilityProviderConfig` DTO。App 配置以及后续的 config 加载行为 MUST 引用由 capability 拥有的 provider config 契约，而不是重新定义 provider/source、discovery mode、provider options 或 enable/disable 字段。

#### Scenario: App config 消费由 capability 拥有的 provider config

- **WHEN** app composition 接收到 capability provider 配置
- **THEN** 类型化输入 MUST 是来自 `agent-contracts/capability` 的 `CapabilityProviderConfig[]`
- **AND** `agent-contracts/app` MUST NOT 导出同名的 provider config DTO

### Requirement: Provider 身份与 Provider 配置分离

系统 MUST 把 `CapabilityProvider` 视为稳定的 provider 身份 DTO，而不是配置对象或可执行 service。`CapabilityProvider` MUST 只包含已冻结契约定义的 provider 身份字段：`providerId`、`providerKind` 和可选的 `providerType`。

Provider 实例配置 MUST 表示在 descriptor 之外。Provider 配置 MAY 包含 endpoint、credential 引用、本地目录引用、托管安装引用、cache policy 或 provider 私有 option，但这些字段 MUST NOT 进入 `CapabilityDescriptor.provider`、对模型可见的 capability 披露、stream payload、safe error、audit 细节或日志。

#### Scenario: 多个 MCP provider 实例共享一个 kind

- **WHEN** 配置了两个 MCP server provider 实例
- **THEN** 两者 MUST 使用 `providerKind=MCP_SERVER`
- **AND** 每个 MUST 拥有稳定且不同的 `providerId`
- **AND** 这些实例产生的 descriptor MUST 通过 `provider.providerId` 标识产生它的实例

### Requirement: Provider 配置核心使用 Provider 和 Options

系统 MUST 把 `CapabilityProviderConfig` 定义为可配置 capability provider 的核心 provider 实例配置契约。`CapabilityProviderConfig` MUST 使用一个稳定的 DTO shape，包含 `provider`、`discoveryMode` 和 `options` 字段。

`provider` MUST 使用已冻结的 `CapabilityProvider` 身份 DTO。`discoveryMode` MUST 使用 `CapabilityDiscoveryMode`。`options` MUST 使用由 provider 专属 option 对象组成的 `CapabilityProviderOptions` union。options union MUST NOT 包含裸 `JsonObject` 分支；`CUSTOM` provider MUST 使用带有 provider 私有 `customOptions: JsonObject` 值的 `CustomProviderOptions`。

内置 option 对象名 MUST 省略冗余的 `Provider` 后缀：`SkillHubOptions`、`McpServerOptions` 和 `AgentRegistryOptions`。

可配置的 provider kind MUST 按 `provider.providerKind` 校验 `options`，对 `CUSTOM` 还要按 `provider.providerType` 校验。`CUSTOM` provider MUST 包含非空的 `provider.providerType`。除非 capability 子系统拥有与该 provider type 匹配的 discovery 和 executor factory，custom provider MUST NOT 贡献可执行 descriptor。

`BUNDLED` provider MUST NOT 受外部 provider 配置控制。内置 tool、skill 和 agent provider MUST 只由 `agent-capability` 子系统创建，且 MUST NOT 通过 `CapabilityProviderConfig` 被替换或被分配 endpoint/options。

系统 MUST 在当前 change 中定义 provider config 校验/归一化边界。只定义 config 类型而不提供校验/归一化行为对本 change 是不够的。

外部 provider 配置文件、环境分层、tenant/Agent override、secret 解析和 hot reload 被延期到 `add-ts-capability-source-configuration`。该后续 change MUST 产出 `CapabilityProviderConfig[]`，并 MUST NOT 重新定义 provider/source vocabulary、discovery 所有权、catalog 治理、executor 路由或 capability result 语义。`CapabilityProviderConfig` MUST NOT 接受 `provider.providerKind=BUNDLED`。

#### Scenario: 内置 provider 由 capability 子系统注册

- **WHEN** `agent-app` 在没有外部 provider config 的情况下创建 capability 子系统
- **THEN** `agent-capability` MUST 仍然创建 `builtin-tools` provider
- **AND** 该 provider MUST 驱动 `read` capability 的 builtin discovery、catalog 注册、executor 路由和 result 消费
- **AND** 启用 builtin `read` 路径 MUST NOT 要求外部 config

#### Scenario: Provider kind 决定 config 校验

- **WHEN** capability 子系统收到一个 `provider.providerKind=MCP_SERVER` 的 provider config
- **THEN** 该 config MUST 被校验为带 MCP 专属字段（例如 endpoint 和可选 credential 引用）的 MCP server config
- **AND** 它 MUST NOT 被当作无类型的泛型对象接受

#### Scenario: Custom provider 需要显式 adapter 注册

- **WHEN** capability 子系统读取一个 `provider.providerKind=CUSTOM` 的 provider config
- **THEN** 该 config MUST 包含 `provider.providerType`
- **AND** 该 config 的 options MUST 使用 `CustomProviderOptions.customOptions`
- **AND** capability 子系统的 discovery 和 executor factory MUST 先支持该 provider type，来自该 provider 的 descriptor 才能变为可执行

### Requirement: Config 归一化产出 Factory 输入

系统 MUST 在创建 discovery 或 executor 实例之前校验并归一化 `capabilityProviderConfigs`，并 MUST 拒绝带 `provider.providerKind=BUNDLED` 的 config。可信 builtin provider 也 MUST 使用相同的 discovery/executor factory 路径。Factory 输入 MUST 保留 provider 身份、provider kind/type、discovery mode，以及 discovery/executor factory 所需的 provider 专属实现数据。Provider config options MUST NOT 进入 `CapabilityDescriptor` 或对模型可见的 DTO。

Provider config 归一化和 builtin provider 创建 MUST 拒绝同一 composition 范围内重复的 `providerId`。Credential 值 MUST 只以引用表示；raw secret MUST NOT 出现在 descriptor、日志、safe error、对模型可见的 capability 披露、stream payload 或 audit 细节中。

#### Scenario: 重复 provider id 被拒绝

- **WHEN** 同一 composition 范围内两个 provider config 使用相同的 `providerId`
- **THEN** 归一化 MUST 拒绝该配置
- **AND** capability 子系统 MUST NOT 创建有歧义的 discovery、catalog 或 executor 注册

#### Scenario: Config 不能覆盖 builtin provider id

- **WHEN** 外部 provider config 试图定义 `provider.providerKind=BUNDLED` 或复用 `provider.providerId=builtin-tools`
- **THEN** 归一化 MUST 拒绝该配置
- **AND** 在 `agent-capability` 内部创建的可信 builtin provider MUST 保持是 builtin provider 实例的唯一来源

### Requirement: Agent assembly 编译不要求 capability descriptor 预发现

系统 MUST 把 `AgentAssembly.capabilityBindings` 视为 Agent 授权意图，而不是匹配 capability descriptor 已被发现的证明。Agent assembly 编译 MUST 校验 binding shape、安全 id、capability kind 和 provider id 形状，但 MUST NOT 要求 capability descriptor 在 assembly 编译前已经存在。

Capability descriptor 的存在性、`AvailabilityStatus`、冲突解决和可执行唯一性 MUST 由 catalog 在为 request scope 执行 `listAvailable` 和 `resolve` 时决定。

#### Scenario: Assembly 可以在 capability discovery 之前编译

- **WHEN** 一个 Agent 定义绑定 `capabilityId=read`、`capabilityType=TOOL` 和 `providerId=builtin-tools`
- **THEN** Agent assembly 编译 MUST 能在未先读取 capability catalog 的情况下产出 `AgentAssembly.capabilityBindings`
- **AND** `catalog.listAvailable` / `catalog.resolve` MUST 在之后决定与该 binding 匹配的已发现 descriptor 是否可见且可执行

#### Scenario: 缺失 descriptor 在 catalog 闸门处失败

- **WHEN** 一个 Agent assembly 包含其 descriptor 尚未被发现的 capability binding
- **THEN** assembly 编译 MUST NOT 仅因该 descriptor 缺失而失败
- **AND** `catalog.listAvailable` MUST NOT 把该 binding 暴露为 capability
- **AND** `catalog.resolve` MUST 对该 capability 返回 undefined 或安全拒绝路径

### Requirement: Discovery 由单一 Discovery Factory 创建

系统 MUST 使用一个 `CapabilityDiscoveryFactory` 创建 provider 实例的 discovery adapter。Factory 输入 MUST 是由可信 builtin composition 创建、或由已被接受的 `CapabilityProviderConfig` 携带的 `CapabilityProvider`，加上该 provider 的 discovery mode 以及存在时的已接受 config。

一个 discovery adapter MUST 限定在一个 provider 实例范围内，并 MUST 暴露该 provider 的身份。Discovery adapter MAY 支持 `EAGER` 模式、`SEARCH` 模式、refresh hook 和 availability probe 事实。Discovery adapter MUST 发现或搜索候选 capability，但 MUST NOT 做出全局冲突、request Agent 可见性或最终 availability 决定。

Discovery 创建 MUST 在 factory 内部使用精确的 provider kind，对 `CUSTOM` 还要使用精确的 provider type。Capability 子系统 MUST 拒绝本 change 中单一 discovery factory 无法创建的 builtin 或已配置 provider。系统 MUST NOT 按注册顺序在多个 discovery factory 之间选择。

#### Scenario: Eager builtin discovery 在启动时注册 read

- **WHEN** `createCapabilitySubsystem([])` 在没有外部 provider config 的情况下启动
- **THEN** `agent-capability` MUST 创建一个 `providerId=builtin-tools` 且 `providerKind=BUNDLED` 的 builtin provider
- **AND** 它 MUST 用该 provider 和 `discoveryMode=EAGER` 调用单一 `CapabilityDiscoveryFactory`
- **AND** 该 factory MUST 为 `builtin-tools` provider 创建一个 `EAGER` discovery adapter
- **AND** 该 discovery adapter MUST 在启动 composition 期间返回 `read` descriptor
- **AND** catalog MUST 在 context/core 查询可用 capability 之前注册该 descriptor
- **AND** 该 descriptor MUST 使用 `provider.providerId=builtin-tools`
- **AND** 本 change MUST NOT 发现其他 builtin tool descriptor
- **AND** Agent assembly binding MUST NOT 影响 builtin discovery 返回哪些 descriptor

#### Scenario: Discovery factory 创建是确定性的

- **WHEN** 一个 provider 由 builtin composition 或已接受的 provider config 创建
- **THEN** 单一 discovery factory MUST 按精确的 provider kind 分发
- **AND** `CUSTOM` provider 还 MUST 按精确的 provider type 分发
- **AND** 不支持的 provider kind/type MUST 以安全配置错误使子系统创建失败

#### Scenario: Search provider 不在启动时注册远程 capability

- **WHEN** 一个 provider 的 `discoveryMode=SEARCH`
- **THEN** catalog MUST 只把该 discovery adapter 保留为 `listAvailable` / `resolve` 查询 hook
- **AND** 启动时 MUST NOT 把来自该 provider 的远程候选 capability 注册为可执行 descriptor

#### Scenario: Search discovery 在 listAvailable 期间被求值

- **WHEN** `catalog.listAvailable` 求值一个绑定了来自 `SEARCH` provider 的 capability 的 request scope
- **THEN** catalog MUST 以从 request `tenantId`、`subjectId`、`AgentAssembly` 和已绑定 capability id 派生的条件调用该 provider discovery 的 search hook
- **AND** search 返回的 descriptor MUST 通过与 eager descriptor 相同的 binding、availability 和冲突闸门
- **AND** catalog MUST NOT 暴露未被 request Agent assembly 绑定的远程 search 候选

### Requirement: Catalog 拥有注册闸门和 Availability 判定

Catalog 实现 MUST 拥有 descriptor 注册闸门、request Agent binding 过滤、availability 判定、冲突解决 hook 和 resolve 闸门。Discovery adapter MAY 提供候选 descriptor 和 probe 事实，但 catalog MUST 决定一个 descriptor 对给定 request 是否可见或可执行。

`listAvailable` 和 `resolve` MUST 应用相同的核心闸门：request scope 的 `AgentAssembly.capabilityBindings`、binding 中存在时的 provider 身份、`AvailabilityStatus`、面向该 request scope 的 `SEARCH` discovery 候选，以及 catalog 经冲突解决后的可见/可执行视图。一个 capability 若在某个 request context 下无法通过 `listAvailable` 可见，则 MUST NOT 在同一 context 下通过 `resolve` 可执行。

对给定的 Agent/run request scope，catalog MUST 以按 `capabilityId` 唯一的视图暴露可执行 capability。Provider 身份 MAY 在内部用于 descriptor 身份、binding 过滤、冲突解决、诊断和 executor 查找，但在 catalog 治理产出该 request 的可见/可执行视图后，`agent-core` MUST 能通过已冻结的 `CapabilityResolveRequest.capabilityId` 解析可执行 descriptor。

#### Scenario: 不可用 capability 不可执行

- **WHEN** 一个已注册 descriptor 的 `availabilityStatus=UNAVAILABLE`
- **THEN** `listAvailable` MUST 排除它，除非为诊断显式请求 unavailable descriptor
- **AND** `resolve` MUST NOT 把它作为可执行项返回

#### Scenario: 未绑定 capability 不可执行

- **WHEN** catalog 中存在一个 descriptor，但 request Agent assembly 未绑定该 capability id 和 provider id
- **THEN** 该 descriptor MUST NOT 对模型可见
- **AND** `resolve` MUST NOT 为 invocation 返回它

#### Scenario: 未解决的冲突不可执行

- **WHEN** 多个候选 descriptor 冲突，且 catalog 冲突扩展点无法为该 request scope 产出一个可执行 descriptor
- **THEN** 该 capability id MUST 被排除出 `listAvailable`
- **AND** `resolve` MUST NOT 返回有歧义的 descriptor

### Requirement: 本 change 中冲突策略是 Catalog 扩展点

Catalog 骨架 MUST 预留一个同时用于 eager 注册和未来 search 结果合并的单一冲突解决扩展点。本 change MUST NOT 为 capability 冲突定义具体的优先级顺序、shadowing 行为或 override 诊断。

具体的冲突优先级和同范围冲突行为 MUST 由 `add-ts-capability-conflict-resolution` 定义。

#### Scenario: 冲突行为不被 provider 重复实现

- **WHEN** 两个 provider adapter 产生 capability 身份冲突的候选 descriptor
- **THEN** provider MUST NOT 自行解决全局冲突
- **AND** catalog MUST 把这些候选路由到共享的冲突扩展点

### Requirement: 执行使用 Capability Kind 和 Provider 身份

系统 MUST 通过统一的 `CapabilityInvocationPort` 路由 capability 执行。Executor 选择 MUST 基于已解析 descriptor 的 `CapabilityKind` 和 provider 身份。Executor 选择 MUST NOT 假设 `providerKind` 与 executor 之间存在一一映射。

系统 MUST 使用一个 `CapabilityExecutorFactory` 创建或解析 executor。Executor factory 输入 MUST 是 `catalog.resolve` 返回的 `CapabilityDescriptor`。该 factory MUST 使用精确的 `descriptor.provider.providerId` 和精确的 `descriptor.kind`；它 MAY 使用 `providerKind` 和可选的 `providerType` 来选择 provider 实现分支并产生诊断。单一 provider kind 仍 MAY 为不同 capability kind 路由到不同 executor。

Runtime executor 匹配 MUST 使用已解析 descriptor 的具体 provider id 和 capability kind。如果没有 executor 匹配，或多个 executor 匹配同一 descriptor，invocation 路径 MUST 返回安全失败，而不是按注册顺序选择。

#### Scenario: 一个 Provider kind 可以有多个 executor

- **WHEN** `BUNDLED` provider kind 同时贡献 Tool 和 Skill capability
- **THEN** invocation 路径 MUST 能把 `TOOL` descriptor 和 `SKILL` descriptor 路由到不同的 executor 实现
- **AND** 它 MUST NOT 把 `BUNDLED` 当作单一 executor 选项

#### Scenario: Executor 匹配是唯一的

- **WHEN** catalog 解析出一个 `provider.providerId=builtin-tools` 且 `kind=TOOL` 的 descriptor
- **THEN** invocation MUST 用该 descriptor 调用单一 executor factory
- **AND** 该 factory MUST 为 `builtin-tools` 和 `TOOL` 恰好返回一个 executor
- **AND** 零个或多个匹配 executor MUST 产生安全的 capability 失败
- **AND** invocation MUST NOT 仅因共享 `providerKind=BUNDLED` 而选择某个 executor

#### Scenario: Provider 实例选择已配置的 executor

- **WHEN** 配置了两个 MCP server provider 实例
- **THEN** 来自 `providerId=mcp-a` 的 descriptor MUST 通过为 `mcp-a` 配置的 executor 实例执行
- **AND** 它 MUST NOT 通过恰好共享 `providerKind=MCP_SERVER` 的另一个 MCP provider 实例执行

### Requirement: Executor 返回结果但不拥有 Runtime 副作用

Executor MUST 返回 `CapabilityInvocationResult`，并 MUST NOT 直接写入 runtime timeline event、session message、checkpoint、audit sink、terminal commit 或 Agent/Core loop 状态。由 runtime/core 拥有的副作用 MUST 保持在既有 port 和 lifecycle 边界之后。

`agent-core` MUST 显式消费 capability result。它 MUST 通过统一 result 契约处理 `status`、`structuredPayload`、`generatedMessages`、`contextPatch`、`resultRef`、`artifactRefs`、`safeError`、`fallbackTriggered` 和安全 metadata。

`SUCCEEDED` result MUST 把安全 `structuredPayload` 和安全 ref 暴露为 tool call result。`DEGRADED` result MUST 发出降级通知，并仍把安全 `structuredPayload` 和安全 ref 暴露为 tool call result。`FAILED` 和 `TIMED_OUT` result MUST 发出安全失败或超时结果，且 MUST NOT 被当作后续 model step 的成功 tool result 内容。

`agent-core` MUST 把 result 驱动的 generated message 和 allowed-tool patch 保存在 request-local 状态中。它 MUST NOT 把 `generatedMessages` 持久化为 user session message，也 MUST NOT 让 capability executor 写入 session message、runtime timeline event、checkpoint、audit sink、terminal commit、Agent assembly、catalog 状态、provider 配置或 session 配置。

`contextPatch.modelName` 和 `contextPatch.modelOptions` MUST 在本 change 中通过 model 选择/治理校验获得支持。如果 capability result 包含其中任一字段，core MUST 在把它应用到同一 request/run 的后续 model step 之前，对照当前 request/run 的 Agent assembly、可见 model profile、model provider policy 和 model option 约束校验所请求的 model patch。无效、未授权或未受治理的 model patch MUST 安全失败，且 MUST NOT 被应用。

#### Scenario: Generated message 保持受控

- **WHEN** 一次 capability invocation 返回 `generatedMessages`
- **THEN** 每条 generated message MUST 使用 role `USER`
- **AND** core MUST 把 generated message 追加到 request/run 的 request-local model 输入，供后续 model step 使用
- **AND** core MUST NOT 把 generated message 持久化为 user session message

#### Scenario: Context patch 不能扩大 capability 权限

- **WHEN** 一个 capability result 包含 `contextPatch.allowedTools`
- **THEN** core MUST 确保它是 request scope 已授权且可见 capability id 的子集
- **AND** 该 patch MUST NOT 永久改变 Agent assembly、provider 配置、session 配置或 catalog 状态

#### Scenario: Result ref 保持不透明

- **WHEN** 一个 capability result 包含 `resultRef` 或 `artifactRefs`
- **THEN** core MUST 只把安全 ref 标识符或安全摘要传入 capability result metadata
- **AND** core MUST NOT 在消费 result 期间读取被引用内容、展开本地路径或内联 artifact 内容

### Requirement: 后续 Provider 复用该骨架

未来 provider 专属 change MUST 插入本 change 定义的 provider 配置、discovery、catalog、executor 和 result 消费骨架。它们 MUST NOT 为特定 Tool、Skill、Agent、远程 service 或本地目录引入独立的 catalog、discovery、execution envelope、result DTO 或 provider/source vocabulary。

#### Scenario: 未来 SkillHub provider 使用该骨架

- **WHEN** 一个未来的 SkillHub change 实现远程 search 和 refresh
- **THEN** 它 MUST 提供 SkillHub provider config，并按需扩展单一 discovery/executor factory 行为
- **AND** 它发现的 descriptor MUST 进入共享的 catalog 和 invocation result 路径

## 约束 / 必须避免

### 不得拆分 source vocabulary

本 change MUST NOT 定义与 provider 平行的第二个 public source 概念。Provider 私有 layout 或 raw source 细节只能存在于 provider adapter 内部，且 MUST NOT 成为 catalog、descriptor、runtime、core 或 context 的 public vocabulary。

### agent-contracts 中不得有实现

本 change MUST NOT 把 catalog、discovery、executor 或 provider factory 实现类放进 `agent-contracts`。`agent-contracts` 保持为 public DTO/schema/port 契约边界。

### 不得实现具体 Provider 而扩大范围

本 change MUST NOT 实现 MCP、SkillHub、本地目录、Agent registry、Skill invocation、sandbox 执行、audit、幂等恢复或冲突优先级行为。这些行为必须由各自专属 change 承载并复用该骨架。

### 不得实现外部配置源而扩大范围

本 change MUST NOT 实现外部 provider config 文件位置、格式、加载、合并优先级、tenant/Agent override、secret resolver 或 hot reload 行为。这些行为必须由 `add-ts-capability-source-configuration` 承载，并且必须产出 `CapabilityProviderConfig[]`。
