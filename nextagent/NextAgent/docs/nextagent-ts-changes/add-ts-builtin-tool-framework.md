# add-ts-builtin-tool-framework

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Tool

状态：active
类型：实施 change
主要 owner：`agent-capability`
依赖：`add-ts-capability-core-governance`

目标：
- 在 `CapabilityDescriptor` 中新增 `outputSchema?`，描述成功调用时 `CapabilityInvocationResult.structuredPayload` 的 schema。
- 新增 provider-neutral Tool SPI：Tool metadata、Tool implementation、`ToolDefinition`、`defineTool`、Tool dependencies、Tool execution context 和 execute options。
- 新增 `ToolCatalog` / `BuiltinToolCatalog`，通过 `defineTool` 生成的显式 owned Tool list 承载内置 Tool 注册、发现、per-tool config validation、dependency validation、descriptor projection 和 executable lookup。
- 新增 `BuiltinToolExecutor` 实现 `CapabilityExecutor`，把 resolved `CapabilityDescriptor + CapabilityInvocationRequest` 适配为 `Tool.execute(input, options)`，并统一 input/output validation、safe failure mapping 和 result wrapping。
- 明确主流程接入：`ToolCatalog` 由 capability subsystem 作为 `builtin-tools + EAGER` 的 `CapabilityDiscovery` 接入，`BuiltinToolExecutor` 由 executor factory 作为 `builtin-tools + TOOL` 的 `CapabilityExecutor` 接入；agent-core/runtime 仍只使用 `CapabilityCatalog` / `CapabilityInvocationPort`。
- 使用 `defineTool` 将既有 read 接入 Tool SPI，不改变 read 业务语义；产品路径只通过 `ToolCatalog` / `BuiltinToolExecutor` 暴露和执行 read，不保留并行 read capability path。
- 清理旧 builtin read 产品路径：`BuiltinToolsDiscovery`、静态 read descriptor source、旧 read invocation port、`StaticCapabilityCatalog` 默认 read descriptor 和相关 public exports 不再作为产品路径入口。
- 明确内置 Tool discovery 不再单独作为 `add-ts-builtin-tool-discovery` 实施；本 change 完整承载内置 Tool framework + discovery + registry 的首版范围。

非目标：
- 不定义除既有 read 接入之外的具体工具 handler 实现，由各工具 change 定义。
- 不改变具体 `read` 业务行为；本 change 只把既有 read 接入 Tool SPI。`write`、`glob`、`bash`、`python`、`question`、`todo` 或 `task` 的业务行为由后续 change 定义；本 change 可使用 test fixture Tool 验证无配置、无依赖路径。
- 不实现插件加载、插件 manifest、动态安装、目录扫描、runtime decorator discovery 或 import side-effect 自注册。
- 不展开最终用户配置文件 schema；builtin-tools provider 默认开启且当前不可由用户配置关闭，本 change 只定义 `createToolCatalog({ config })` 接收已注册 Tool 配置的 framework 入口。
