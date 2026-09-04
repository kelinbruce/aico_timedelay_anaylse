## 1. Capability contract update

- [x] 1.1 在 `CapabilityDescriptor` 中新增可选 `outputSchema?: JsonObject`
  来源：spec requirement "Capability descriptors expose structured output schema"
- [x] 1.2 更新 capability descriptor runtime schema / contract tests，确认 `outputSchema` 只描述 `CapabilityInvocationResult.structuredPayload`
  来源：spec scenario "Descriptor output schema describes structured payload"
- [x] 1.3 更新核心契约设计文档引用，明确不新增 `ToolDescriptor`、`ToolInvocationRequest`、`ToolInvocationResult` 或 `ToolSource`
  来源：spec requirement "Tool framework preserves capability contract uniqueness"
- [x] 1.4 更新 change 一致性记录，明确 `CapabilityDescriptor.outputSchema?` 是本 change 已确认的 capability contract update
  来源：design D1

## 2. Tool SPI

- [x] 2.1 在 `agent-capability` 定义 provider-neutral `ToolMetadata`
  来源：spec requirement "Tool metadata is provider-neutral"
- [x] 2.2 定义 `Tool` 接口，包含可选 `configure(config, deps?)` 和必需 `execute(input, options?)`
  来源：spec requirement "Tool implementation is separated from metadata"
- [x] 2.2a 定义 `ToolDefinition` 和 `defineTool` authoring helper；`defineTool` 只返回显式 definition，不注册、不扫描、不读配置、不自动生成 schema
  来源：spec requirement "defineTool simplifies Tool authoring without creating a registration path"
- [x] 2.2b 确认无配置、无依赖 Tool 可用最小 `defineTool({ name, description, inputSchema, outputSchema, execute })` 写法，不要求 `configSchema`、`configure`、`requiredDependencies`、空 config 或空 dependency list
  来源：spec scenario "Minimal Tool definition has no config or dependency ceremony"
- [x] 2.3 定义 `ToolDependencyName`、`ToolDependencies`、`ToolExecutionContext`、`ToolExecuteOptions`
  来源：spec requirement "Tool dependencies are optional and controlled"
- [x] 2.4 定义第一版受控依赖名称：`sandbox`、`workspaceFiles`；当前 `WorkspaceFilePort` 只暴露 read 所需 `readText`，不预置 write/glob 方法
  来源：spec scenario "Required dependency must be available"
- [x] 2.5 确认 Tool SPI 不暴露 `workspaceRoot`、host path、host process API、gateway-local 私有实现或 capability invocation envelope
  来源：spec scenario "Workspace root is not exposed to Tool"
- [x] 2.6 明确 `SandboxExecutionPort` 是 Tool-facing interface-only dependency；本 change 不实现 sandbox adapter，也不要求 `agent-capability` import `agent-contracts/gateway`
  来源：spec scenario "Sandbox dependency is interface-only in the framework"

## 3. Tool catalog

- [x] 3.1 实现 `ToolCatalog` / `BuiltinToolCatalog`，构造输入为 `CapabilityProvider`、显式 `ToolDefinition[]`、`ToolCatalogConfig` 和 `ToolDependencies`
  来源：spec requirement "Tool catalog implements existing discovery boundary and executable lookup"
- [x] 3.1a 确认 `ToolCatalog` / `BuiltinToolCatalog` 遵从现有 `CapabilityDiscovery`：提供 `provider`、`discoveryMode` 和 `listAll(signal)`，不新增 `discover(toolName)` 或 `scanAndRegister(catalog)`
  来源：spec scenario "Catalog lists descriptors through CapabilityDiscovery"
- [x] 3.1b 定义 `ToolCatalogConfig` / `ToolConfig` 作为 framework config 入口；确认它不是最终用户配置文件 schema，也不进入 `agent-contracts/app`
  来源：spec scenario "ToolCatalogConfig is the framework config entry"
- [x] 3.1c 将 builtin Tool discovery 接入现有 `CapabilityDiscoveryFactory`：`providerId=builtin-tools + discoveryMode=EAGER` 返回 `ToolCatalog`，替代产品路径中的 `BuiltinToolsDiscovery`；capability catalog 只通过 `listAll(signal)` 消费 descriptors
  来源：spec scenario "Capability discovery factory creates builtin Tool catalog"
- [x] 3.2 实现同一 provider 内 Tool name 唯一性校验
  来源：spec requirement "Tool catalog projects descriptors and executable lookup"
- [x] 3.3 实现 metadata schema shape 校验，包括 `inputSchema`、`outputSchema`、`configSchema?`
  来源：spec requirements "Tool metadata is provider-neutral"、"Capability descriptors expose structured output schema"
- [x] 3.4 实现 safe description override
  来源：spec requirement "Tool catalog uses explicit registration and trusted configuration"
- [x] 3.5 实现 per-tool config 校验：只允许 `ToolMetadata.configSchema` 声明的配置项
  来源：spec scenario "Tool config is validated by metadata schema"
- [x] 3.5a 实现 unknown Tool config 的确定性失败：`ToolCatalogConfig` 引用未注册 Tool 名称时，`createToolCatalog` 产生 safe configuration failure，不创建 descriptor 或 executable
  来源：spec scenario "Unknown configured Tool fails catalog creation"
- [x] 3.6 实现 `requiredDependencies` 可用性校验；缺失依赖的 Tool 不进入 executable lookup，并产生 unavailable descriptor 和 safe `availabilityReason`
  来源：spec scenario "Required dependency must be available"
- [x] 3.7 实现 `tool.configure?(config, deps)` 调用，配置失败时阻止 Tool executable
  来源：spec requirement "Tool catalog uses explicit registration and trusted configuration"
- [x] 3.8 实现 `ToolMetadata + CapabilityProvider -> CapabilityDescriptor` 投影，包含 `outputSchema`
  来源：spec scenario "Metadata is projected to descriptor"
- [x] 3.9 实现 provider-aware executable lookup，key 至少包含 `providerId + capabilityId`
  来源：spec scenario "Executable lookup is provider-aware"
- [x] 3.10 确认外部 invocation request 仍只使用 `capabilityId`；同名 provider 冲突必须先由 capability catalog/conflict resolver 给出唯一 descriptor，无法解析时在执行前 safe fail
  来源：spec scenario "Unresolved provider conflict fails before Tool execution"

## 4. Explicit builtin registration

- [x] 4.1 定义 owned builtin Tool list，entry 形态为 `ToolDefinition`
  来源：spec scenario "Explicit builtin list is the only builtin registration path"
- [x] 4.2 使用 `defineTool` 将既有 read 接入 Tool SPI：保留 read 业务语义、schema、安全约束和 read-only 行为，产品路径只通过 ToolCatalog / BuiltinToolExecutor 暴露和执行 read
  来源：spec requirement "Existing read Tool uses the Tool framework without behavior changes"
- [x] 4.2b 删除或收敛旧 read product path：`createReadCapabilityDescriptor` / `ReadCapabilityInvocationPort` 不再作为产品路径入口；允许把 read 业务校验和文件读取逻辑抽取为 read Tool 内部 helper
  来源：design current state and minimal delta
- [x] 4.2c 清理 `BuiltinToolsDiscovery` 产品路径：`CapabilityDiscoveryFactory` 不再返回 `BuiltinToolsDiscovery`，改为返回 `ToolCatalog`
  来源：design cleanup list
- [x] 4.2d 清理 `StaticCapabilityCatalog` 默认 read descriptor：默认构造不得调用 `createReadCapabilityDescriptor()` 自动注册 read，builtin descriptors 只来自 capability subsystem 消费 `ToolCatalog.listAll(signal)`
  来源：design cleanup list
- [x] 4.2e 清理 public exports 和 tests 中旧 read product path 用法：产品路径不得 import `createReadCapabilityDescriptor`、`ReadCapabilityInvocationPort` 或 `createReadCapabilityInvocationPort`；测试改用 ToolCatalog/read ToolDefinition 或纯 test fixture helper
  来源：design cleanup list
- [x] 4.2a 确认 `write`、`glob`、`bash`、`python` 等具体 Tool 行为不在本 change 实现；可使用 test fixture Tool 验证无配置/无依赖路径
  来源：proposal Non-Goals
- [x] 4.3 编写 architecture/source check，禁止 ToolCatalog 目录扫描、runtime decorator discovery、import side-effect 自注册和 config-created Tools
  来源：spec requirement "Tool catalog uses explicit registration and trusted configuration"、"defineTool simplifies Tool authoring without creating a registration path"
- [x] 4.4 记录后续 builtin Tool change 的注册规则：使用 `defineTool` 导出 `ToolDefinition`，加入 owned builtin Tool list
  来源：design D6

## 5. Builtin Tool executor

- [x] 5.1 重塑 `BuiltinToolExecutor`，使其依赖 ToolCatalog 而不是 `Map<CapabilityId, ToolHandler>`
  来源：spec requirement "Builtin Tool executor adapts capability invocation to Tool execution"
- [x] 5.1a 将 `BuiltinToolExecutor` 接入现有 `CapabilityExecutorFactory`：resolved descriptor 为 `providerId=builtin-tools + kind=TOOL` 时返回唯一 executor，0 个或多个匹配都 safe fail
  来源：spec scenario "Capability executor factory routes builtin Tools"
- [x] 5.2 executor 使用 resolved descriptor provider + request capability id 查找 executable Tool
  来源：spec scenario "Executable lookup is provider-aware"
- [x] 5.2a executor 不从 `CapabilityInvocationRequest` 读取 provider；provider 只来自已解析的 `CapabilityDescriptor`
  来源：spec requirement "Tool catalog implements existing discovery boundary and executable lookup"
- [x] 5.3 executor 在调用 Tool 前按 `inputSchema` 校验 `CapabilityInvocationRequest.arguments`
  来源：spec scenario "Executor validates input before Tool execution"
- [x] 5.4 executor 从可信 request/runtime facts 构造 `ToolExecutionContext`，并传递 `AbortSignal`
  来源：spec requirement "Builtin Tool executor adapts capability invocation to Tool execution"
- [x] 5.5 executor 调用 `Tool.execute(input, { context, deps, signal })`
  来源：spec scenario "Tool executes business input only"
- [x] 5.6 executor 按 `outputSchema` 校验 Tool 返回值，invalid output 返回 safe failed result 且不泄漏 raw output
  来源：spec scenario "Executor validates output after Tool execution"
- [x] 5.7 executor 将成功 Tool 输出包装到 `CapabilityInvocationResult.structuredPayload`
  来源：spec scenario "Executor wraps successful Tool output"
- [x] 5.8 executor 对 unknown executable、invalid input、invalid output、missing dependency、configuration failure、timeout、abort、Tool execution failure 统一 safe failed result
  来源：spec requirement "Builtin Tool executor adapts capability invocation to Tool execution"

## 6. Composition boundary

- [x] 6.1 确认本 change 不读取最终用户 Tool 配置文件、不定义外部 Tool 配置 schema；`ToolCatalogConfig` 只作为 trusted object 入口
  来源：spec requirement "Tool framework exposes a config entry without owning user configuration"
- [x] 6.2 capability subsystem 创建 trusted builtin `CapabilityProvider(providerId=builtin-tools, providerKind=BUNDLED)`，不从外部 provider config 声明或覆盖
  来源：spec scenario "Metadata projects through existing provider identity"
- [x] 6.3 capability subsystem 构建或接收 `ToolDependencies`，第一版支持 `sandbox?` 和 `workspaceFiles?`
  来源：spec requirement "Tool dependencies are optional and controlled"
- [x] 6.4 capability subsystem 将 trusted provider、owned builtin Tool list、可选 `ToolCatalogConfig`、dependencies 传入 ToolCatalog；agent-app 只调用 capability subsystem composition，不直接 mutate ToolCatalog 或注册 executor
  来源：design unique implementation path
- [x] 6.5 确认 builtin-tools provider 默认开启且当前不可由用户配置关闭；当前 read Tool 不要求配置
  来源：spec scenario "ToolCatalogConfig is the framework config entry"

## 7. Tests and validation

- [x] 7.1 为 `CapabilityDescriptor.outputSchema` 编写 contract tests
  来源：spec requirement "Capability descriptors expose structured output schema"
- [x] 7.2 为 ToolCatalog 编写 tests：`CapabilityDiscovery.listAll(signal)`、descriptor projection、description override、unknown configured tool produces safe configuration failure、config schema invalid produces unavailable descriptor、dependency missing produces unavailable descriptor、provider-aware lookup、unresolved provider conflict pre-execution safe fail
  来源：spec requirements "Tool catalog uses explicit registration and trusted configuration"、"Tool catalog implements existing discovery boundary and executable lookup"
- [x] 7.2a 为 `defineTool` 编写 tests：最小无配置/无依赖 Tool definition、带 configSchema/configure Tool definition、带 requiredDependencies Tool definition、导出 definition 不会隐式注册
  来源：spec requirement "defineTool simplifies Tool authoring without creating a registration path"
- [x] 7.2b 为 discovery 主流程接入编写 tests：capability subsystem / `CapabilityDiscoveryFactory` 为 `builtin-tools + EAGER` 创建 ToolCatalog 而不是 `BuiltinToolsDiscovery`，capability catalog 通过 `listAll(signal)` 消费 read descriptor，ToolCatalog 不直接 mutate capability catalog
  来源：spec scenario "Capability discovery factory creates builtin Tool catalog"
- [x] 7.3 为 BuiltinToolExecutor 编写 tests：valid execution、invalid input、invalid output、unknown executable、Tool throws、safe result wrapping、provider-aware lookup、request provider-free lookup
  来源：spec requirement "Builtin Tool executor adapts capability invocation to Tool execution"
- [x] 7.3a 为 executor 主流程接入编写 tests：`CapabilityInvocationPort` 使用 resolved descriptor 调用 `CapabilityExecutorFactory`，`builtin-tools + TOOL` 返回唯一 `BuiltinToolExecutor`，0 个或多个匹配 safe fail，core/runtime 不直接 import Tool executor
  来源：spec scenario "Capability executor factory routes builtin Tools"
- [x] 7.4 编写安全/架构测试，确认 Tool implementation path 不接收 `workspaceRoot`，不直接依赖 host fs/path/process 或 gateway-local 私有实现；当前 change 不实现 `SandboxExecutionPort` adapter 且 `agent-capability` 不直接 import `agent-contracts/gateway`
  来源：spec scenario "Workspace root is not exposed to Tool"
- [x] 7.5 编写 negative tests，确认 framework 不读取最终用户配置文件、不扫描目录、不使用 side-effect self-registration
  来源：spec requirements "Tool catalog uses explicit registration and trusted configuration"、"Tool framework exposes a config entry without owning user configuration"
- [x] 7.5a 为 read 接入编写 tests：read descriptor 由 Tool metadata 投影、read 通过 `BuiltinToolExecutor` 执行、read 不走 sandbox、缺 `workspaceFiles` 时产生 unavailable descriptor、产品路径不再调用旧静态 read descriptor 或旧专用执行对象
  来源：spec requirement "Existing read Tool uses the Tool framework without behavior changes"
- [x] 7.5b 编写 no-redundant-path architecture/source check：产品路径不得同时保留 `BuiltinToolsDiscovery` 和 `ToolCatalog` 两套 builtin discovery，不得同时注册旧 read descriptor 和 `readToolDefinition`，不得同时使用旧 read invocation port 和 `BuiltinToolExecutor -> Tool.execute`
  来源：design current state and minimal delta
- [x] 7.5c 编写 cleanup source check：`StaticCapabilityCatalog` 默认构造不自动创建 read descriptor；`agent-capability` public exports 不暴露旧 read invocation port；`agent-app`、`agent-core`、runtime 和 capability subsystem 产品路径不 import 旧 read descriptor/invocation helpers
  来源：design cleanup list
- [x] 7.6 运行 `npm run build`
  来源：AGENTS.md 验证门禁
- [x] 7.7 运行 `npm test`
  来源：AGENTS.md 验证门禁
- [x] 7.8 运行 `npm run test:contract`
  来源：AGENTS.md 验证门禁
- [x] 7.9 运行 `npm run lint:architecture`
  来源：AGENTS.md 验证门禁
- [x] 7.10 运行 `openspec validate add-ts-builtin-tool-framework --strict`
  来源：AGENTS.md 验证门禁
