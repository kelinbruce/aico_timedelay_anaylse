## ADDED Requirements

### Requirement: Capability descriptor 暴露结构化输出 schema

`CapabilityDescriptor` SHALL 包含一个可选的 `outputSchema` 字段。存在时，`outputSchema` SHALL 描述该 capability 成功时的 `CapabilityInvocationResult.structuredPayload` 形状。它 SHALL NOT 描述整个 `CapabilityInvocationResult` 信封，也 SHALL NOT 约束 `safeError`、`generatedMessages`、`contextPatch`、`resultRef`、`artifactRefs` 或 result metadata。

#### Scenario: Descriptor 输出 schema 描述 structured payload

- **WHEN** 一个 Tool metadata 声明了输出 schema
- **THEN** 投影后的 `CapabilityDescriptor` 把该 schema 作为 `outputSchema` 包含进来
- **AND** 成功 invocation result 的 `structuredPayload` 依据该 schema 校验

### Requirement: Tool metadata 是 provider 中立的

Tool 框架 SHALL 定义 provider 中立的 Tool metadata，包含 Tool 名称、安全描述、输入 schema、输出 schema、可选的 config schema、可选的必需依赖名和可选的 replay policy。Tool metadata MUST NOT 包含 provider 身份。Provider 身份 SHALL 继续来自既有的 `CapabilityProvider` 契约。

#### Scenario: Metadata 通过既有 provider 身份投影

- **WHEN** builtin Tool metadata 与 builtin `CapabilityProvider` 组合
- **THEN** 得到的 descriptor 使用 `providerId="builtin-tools"` 和 `providerKind=BUNDLED`
- **AND** Tool metadata 不定义 provider id、provider kind 或 provider type

### Requirement: Tool 实现与 metadata 分离

框架 SHALL 把 Tool metadata 与 Tool 实现分离。一个 Tool 实现 SHALL 暴露 `execute(input, options?)` 操作，并 MAY 暴露 `configure(config, deps?)` 操作。Tool 实现 SHALL NOT 接收 `CapabilityInvocationRequest`，也 SHALL NOT 返回 `CapabilityInvocationResult`。

#### Scenario: Tool 只执行业务输入

- **WHEN** executor 调用一个 Tool
- **THEN** 该 Tool 接收已校验的业务输入
- **AND** 它可以接收包含 context、依赖和 abort signal 的可选执行 option
- **AND** 它返回业务输出对象，而不是 capability result 信封

### Requirement: defineTool 简化 Tool 编写但不创建注册路径

框架 SHALL 把 `defineTool` 暴露为 Tool 编写 helper。`defineTool` SHALL 返回一个显式的 `ToolDefinition`，其中包含 Tool metadata 和 Tool 实现。它 SHALL NOT 注册 Tool、扫描目录、依赖 import 副作用、读取配置、自动生成 schema，或把 Tool 添加到任何 catalog。

`defineTool` SHALL 支持无配置且无依赖的 Tool，而不要求 `configSchema`、`configure`、`requiredDependencies`、空 config 对象或空依赖列表。

#### Scenario: 最小 Tool 定义没有 config 或依赖仪式

- **WHEN** 一个 Tool 作者只以名称、描述、输入 schema、输出 schema 和 execute 函数定义一个 Tool
- **THEN** `defineTool` 返回一个 `ToolDefinition`
- **AND** 得到的 metadata 没有 config schema，也没有必需依赖
- **AND** 该定义可以被添加到所拥有的 builtin Tool 列表

#### Scenario: defineTool 不隐式注册

- **WHEN** 一个模块导出一个由 `defineTool` 创建的 Tool 定义
- **THEN** 在拥有它的 package 显式把该 Tool 添加到 builtin Tool 列表之前，该 Tool 不可被发现

### Requirement: Tool 依赖是可选且受控的

框架 SHALL 定义可选且受控的 Tool 依赖。第一个版本 SHALL 支持依赖名 `sandbox` 和 `workspaceFiles`。`workspaceFiles` SHALL 只暴露本 change 中 read Tool 所需的读操作。未来的写入或 glob Tool change 如果需要额外文件操作，MUST 在其自身范围内扩展该依赖 port。Tool MAY 在 metadata 中声明必需依赖名。Catalog SHALL 在一个 Tool 变为可执行之前校验必需依赖。

Tool 实现 MUST NOT 通过 Tool 输入或 `CapabilityInvocationRequest` 接收 workspace root、宿主绝对路径、sandbox 内部实现、gateway-local 私有实现或宿主进程 API。

面向 Tool 的 sandbox 依赖 SHALL 只暴露窄的 `runShell` 和 `runPython` 操作。本 change SHALL 只定义依赖接口，SHALL NOT 实现 adapter。后续的 bash、python 或可执行 Tool change MUST 定义 adapter 实现，并让动态执行保持在 sandbox gateway 边界之后。

#### Scenario: 必需依赖必须可用

- **WHEN** Tool metadata 声明 `requiredDependencies=["sandbox"]`
- **AND** capability 子系统未提供 sandbox 依赖
- **THEN** 该 Tool MUST NOT 变为可执行
- **AND** catalog MUST 暴露一个带有安全 availability 原因的 unavailable descriptor

#### Scenario: Workspace root 不暴露给 Tool

- **WHEN** 一个 Tool 需要 workspace 文件访问
- **THEN** 它 MUST 使用受控的 `workspaceFiles` 依赖
- **AND** 它 MUST NOT 从 request 参数、client metadata、model 输出或 capability invocation payload 接收或推导 workspace root

#### Scenario: Sandbox 依赖在框架中只有接口

- **WHEN** 本框架 change 定义 `sandbox` 依赖
- **THEN** 它只暴露面向 Tool 的 `runShell` 和 `runPython` 接口
- **AND** 它不实现 sandbox 执行
- **AND** 它不要求 `agent-capability` 导入 gateway 契约

### Requirement: Tool catalog 使用显式注册和可信配置

Builtin Tool 注册 SHALL 通过一个被拥有的 builtin Tool 列表显式完成。每个列表条目 SHALL 是一个把 Tool metadata 与 Tool 实现配对的 `ToolDefinition`。Tool catalog SHALL NOT 扫描目录、执行运行时装饰器发现、依赖 import 副作用自注册，或从配置创建 Tool。

Tool catalog SHALL 消费由 app composition、后续具体 Tool owner 或测试提供的可选 `ToolCatalogConfig`。`ToolCatalogConfig` 是用于安全描述覆盖和已注册 Tool 的逐 Tool config 校验的框架 config 入口；它不是最终的用户配置文件 schema。本 change 中 builtin-tools provider SHALL 默认启用，且 SHALL NOT 被用户配置禁用。配置 MAY 控制安全描述覆盖以及被 Tool metadata config schema 显式允许的 Tool config 字段。配置 MUST NOT 创建 Tool 名称、禁用 builtin provider、替换输入或输出 schema、改变 provider 身份、改变必需依赖或定义执行映射。如果配置引用一个在被拥有的 Tool 列表中不存在的 Tool 名称，Tool catalog 创建 SHALL 以安全配置失败终止，并 SHALL NOT 为该名称创建 descriptor 或可执行 Tool。

#### Scenario: 显式 builtin 列表是唯一的 builtin 注册路径

- **WHEN** builtin Tool 被组合
- **THEN** catalog 只读取被拥有的 Tool 定义列表
- **AND** 配置中的未知 Tool 名称不会创建 descriptor 或可执行 Tool

#### Scenario: 未知已配置 Tool 使 catalog 创建失败

- **WHEN** `ToolCatalogConfig` 包含一个不在被拥有的 builtin Tool 列表中的 Tool 名称
- **THEN** Tool catalog 创建以安全配置失败终止
- **AND** 不会为该已配置名称创建任何 descriptor 或可执行 Tool

### Requirement: 既有 read Tool 使用 Tool 框架且行为不变

read Tool SHALL 在被拥有的 builtin Tool 列表中被表示为一个由 `defineTool` 创建的 Tool 定义。Read 输入、输出、只读语义、workspace 限制、offset/limit 行为和安全失败行为 SHALL 继续由 read Tool 规格管辖。

Read SHALL NOT 使用 sandbox 依赖。它 SHALL 使用受控的 workspace 文件依赖，并且在必需的 workspace 文件依赖未被提供时 SHALL 变为不可用。

#### Scenario: Read descriptor 从 Tool metadata 投影

- **WHEN** builtin Tool catalog 列出 descriptor
- **THEN** read descriptor 从 read Tool 定义 metadata 投影而来
- **AND** 它包含 read 输入 schema 和 read 输出 schema

#### Scenario: Read 通过 BuiltinToolExecutor 执行

- **WHEN** capability catalog 解析出 builtin read descriptor 后 read 被调用
- **THEN** `BuiltinToolExecutor` 校验输入、调用 read Tool 实现、校验输出并包装结果
- **AND** read 在 capability 产品路径中只通过 ToolCatalog 和 BuiltinToolExecutor 暴露和执行

#### Scenario: Read 不使用 sandbox

- **WHEN** read 被配置并执行
- **THEN** read Tool 不要求或调用 sandbox 依赖
- **AND** 缺失 workspace 文件依赖使 read 在执行前不可用

#### Scenario: Tool config 由 metadata schema 校验

- **WHEN** 可信配置为一个带 `configSchema` 的 Tool 提供 config 对象
- **THEN** catalog 在该 Tool 变为可执行之前，依据 Tool metadata config schema 校验该 config
- **AND** 无效 config 阻止该 Tool 变为可执行
- **AND** catalog 暴露一个带有安全 availability 原因的 unavailable descriptor

### Requirement: Tool catalog 实现既有 discovery 边界和可执行查找

Tool catalog SHALL 组合 `CapabilityProvider`、显式 `ToolDefinition` 条目、可信配置和可用依赖，产出 Tool descriptor 和感知 provider 的可执行查找。对于 descriptor 发现，它 SHALL 使用 `provider`、`discoveryMode` 和 `listAll(signal)` 实现既有的 `CapabilityDiscovery` 边界。它 MUST NOT 引入替代性 discovery 方法，例如 `discover(toolName)` 或 `scanAndRegister(catalog)`。

对于可信 builtin provider，既有 capability 子系统 SHALL 把 Tool catalog 插入正常 discovery 路径。`CapabilityDiscoveryFactory.create({ provider: builtin-tools, discoveryMode: "EAGER" })` SHALL 为 builtin Tool 返回 Tool catalog。既有 capability catalog SHALL 只通过 `CapabilityDiscovery.listAll(signal)` 消费 Tool descriptor，并 SHALL 继续拥有 request 可见的 descriptor 视图、冲突解决、Agent binding 过滤和 capability id 唯一性。

Descriptor 投影 SHALL 保持既有 capability public 契约，并 SHALL 设置 `kind=TOOL`。

可执行查找 MUST 使用 provider 身份和 capability id。解析可执行 Tool 时，它 MUST NOT 只依赖 capability id。外部 capability invocation 保持不含 provider，并使用 `CapabilityInvocationRequest.capabilityId`；provider 坐标来自已被解析的 `CapabilityDescriptor`。如果 capability catalog 无法为某个 capability id 解析出唯一 descriptor，invocation MUST 在 Tool 执行之前安全失败。

#### Scenario: Catalog 通过 CapabilityDiscovery 列出 descriptor

- **WHEN** capability 子系统向 Tool catalog 请求启动 descriptor
- **THEN** 它调用 `CapabilityDiscovery.listAll(signal)`
- **AND** catalog 注册仍由 capability 子系统拥有
- **AND** Tool catalog 不直接修改 capability catalog

#### Scenario: Capability discovery factory 创建 builtin Tool catalog

- **WHEN** capability 子系统为 `providerId="builtin-tools"` 和 `discoveryMode=EAGER` 创建 discovery
- **THEN** discovery factory 返回以被拥有的 builtin Tool 列表为支撑的 Tool catalog
- **AND** capability catalog 把它当作普通 `CapabilityDiscovery` 消费
- **AND** request 可见唯一性和冲突解决仍由 capability catalog 拥有

#### Scenario: Metadata 被投影为 descriptor

- **WHEN** 一个已注册的 Tool metadata 条目与一个 provider 组合
- **THEN** catalog 产出一个 `CapabilityDescriptor`，其 `capabilityId` 和 `displayName` 来自 metadata 名称
- **AND** 其 `safeDescription` 来自 metadata 描述或可信覆盖
- **AND** 其 `inputSchema` 和 `outputSchema` 来自 metadata
- **AND** 其 provider 来自所提供的 `CapabilityProvider`

#### Scenario: 可执行查找感知 provider

- **WHEN** 两个 provider 包含具有相同 capability id 的 Tool
- **AND** capability governance 把其中一个 provider 的 descriptor 解析为唯一可执行 descriptor
- **THEN** 可执行查找 MUST 按 descriptor provider 身份区分可执行 Tool
- **AND** 调用已解析的 descriptor MUST NOT 执行另一个 provider 的 Tool

#### Scenario: 未解决的 provider 冲突在 Tool 执行之前失败

- **WHEN** 两个 provider 包含具有相同 capability id 的 Tool
- **AND** capability governance 无法解析出唯一 descriptor
- **THEN** 按 `capabilityId` 的不含 provider 的 invocation MUST 返回安全的不可用或冲突结果
- **AND** Tool executor MUST NOT 执行任何一个 provider 的 Tool

### Requirement: Builtin Tool executor 把 capability invocation 适配为 Tool 执行

builtin Tool executor SHALL 接收一个已解析的 `CapabilityDescriptor`、`CapabilityInvocationRequest` 和 `AbortSignal`。它 SHALL 按 descriptor provider 和 request capability id 解析可执行 Tool、依据 Tool 输入 schema 校验 request 参数、从可信 request/runtime 事实构造安全执行 option、执行该 Tool、依据 Tool 输出 schema 校验返回输出，并把输出包装进 `CapabilityInvocationResult.structuredPayload`。

builtin Tool executor SHALL 作为 `CapabilityExecutor` 插入既有 capability 执行路径。`CapabilityExecutorFactory.create({ descriptor })` SHALL 为 `kind=TOOL` 且 `provider.providerId="builtin-tools"` 的 descriptor 恰好返回一个 `BuiltinToolExecutor`。Agent core 和 runtime SHALL 继续只调用 `CapabilityInvocationPort`；它们 SHALL NOT 直接导入或调用 `BuiltinToolExecutor`、`ToolCatalog` 或 Tool 实现。

executor SHALL 为未知可执行 Tool、无效输入、无效输出、缺失依赖、配置失败、超时、abort 或 Tool 执行失败返回安全失败结果。它 SHALL NOT 通过日志、stream payload、safe error、audit 字段或 result metadata 泄漏 raw 宿主异常、raw 命令文本、raw Python 代码、文件内容、stdout、stderr、credential、token、宿主绝对路径或高基数字段。

#### Scenario: Executor 在 Tool 执行前校验输入

- **WHEN** 一次 Tool invocation 包含与 Tool 输入 schema 不匹配的参数
- **THEN** executor MUST NOT 调用 `Tool.execute`
- **AND** 它返回一个带有稳定 reason code 的安全失败结果

#### Scenario: Capability executor factory 路由 builtin Tool

- **WHEN** `CapabilityInvocationPort` 调用一个 provider id 为 `builtin-tools` 且 kind 为 `TOOL` 的已解析 descriptor
- **THEN** 它调用既有的 `CapabilityExecutorFactory`
- **AND** 该 factory 恰好返回一个 `BuiltinToolExecutor`
- **AND** 零个或多个匹配 executor 在 Tool 执行之前产生安全 capability 失败
- **AND** invocation 不按 provider kind 或注册顺序选择 executor

#### Scenario: Executor 在 Tool 执行后校验输出

- **WHEN** `Tool.execute` 返回一个与 Tool 输出 schema 不匹配的对象
- **THEN** executor 返回安全失败结果
- **AND** 它不暴露无效的 raw 输出

#### Scenario: Executor 包装成功的 Tool 输出

- **WHEN** `Tool.execute` 返回与 Tool 输出 schema 匹配的输出
- **THEN** executor 返回 `CapabilityInvocationResult.status=SUCCEEDED`
- **AND** Tool 输出被放入 `structuredPayload`

### Requirement: Tool 框架保持 capability 契约唯一性

Tool 框架 MUST 复用 `CapabilityProvider`、`CapabilityDescriptor`、`CapabilityInvocationRequest`、`CapabilityInvocationResult` 和 `CapabilityInvocationPort`。它 MUST NOT 引入 public 的 `ToolDescriptor`、`ToolInvocationRequest`、`ToolInvocationResult`、`ToolSource` 或平行的 capability kind vocabulary。

#### Scenario: Tool 不是平行的 public invocation 协议

- **WHEN** Agent Core 调用一个 Tool capability
- **THEN** 它继续以 `CapabilityInvocationRequest` 调用 `CapabilityInvocationPort.invoke(...)`
- **AND** 它接收 `CapabilityInvocationResult`
- **AND** 它不使用 Tool 专属的 public request 或 result 信封

### Requirement: Tool 框架暴露 config 入口但不拥有用户配置

Tool 框架 SHALL NOT 直接读取最终用户配置文件，并且 SHALL NOT 在本 change 中定义外部 Tool 配置 schema。它 SHALL 把 `ToolCatalogConfig` 暴露为 `createToolCatalog({ config })` 接受的可信对象，使后续具体 Tool change 或 app composition 可以为已注册的 Tool 传递配置。

#### Scenario: 框架消费所提供的 ToolCatalogConfig

- **WHEN** 一个调用方提供 `ToolCatalogConfig`
- **THEN** catalog 只为已注册的 Tool 校验 config
- **AND** Tool 实现从不直接读取配置文件

#### Scenario: ToolCatalogConfig 是框架 config 入口

- **WHEN** 一个调用方需要配置已注册 Tool 的行为
- **THEN** 它向 `createToolCatalog({ config })` 提供 `ToolCatalogConfig`
- **AND** 框架只校验该可信对象和逐 Tool 的 config schema
- **AND** 框架不定义或解析最终的外部配置文件格式
