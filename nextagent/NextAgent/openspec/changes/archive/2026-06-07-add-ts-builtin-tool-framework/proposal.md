## 背景与问题（Why）

NextAgent 当前通过静态 `read` descriptor 和专用执行路径提供最小 builtin tool 能力。随着后续需要增加 `read`、`write`、`glob`、`bash`、`python`、任务类工具、插件工具等能力，如果每个 Tool 都各自定义 descriptor、参数校验、配置读取、依赖获取、执行包装和 safe error mapping，会形成多套并行机制，破坏 capability 统一治理边界。

本 change 定义第一版 Tool 框架：Tool 开发者只声明 Tool 元数据和业务执行本体；框架负责把 Tool 暴露为 `CapabilityDescriptor(kind="TOOL")`，并把标准 `CapabilityInvocationRequest` 安全适配到 Tool 执行，再统一返回 `CapabilityInvocationResult`。

## 变更范围（What Changes）

- 在 `agent-contracts/capability` 的 `CapabilityDescriptor` 增加可选 `outputSchema` 字段，用于描述成功调用时 `CapabilityInvocationResult.structuredPayload` 的 schema。
- 在 `agent-capability` 定义 provider-neutral 的 Tool 开发 SPI：`ToolMetadata`、`Tool`、`ToolDefinition`、`defineTool`、`ToolDependencies`、`ToolExecutionContext` 和 `ToolExecuteOptions`。
- 新增 `ToolCatalog` / `BuiltinToolCatalog`：从显式 Tool 注册列表、已注册 Tool 配置和受控依赖生成 descriptors，并保存 provider-aware executable Tool lookup。
- 新增/重塑 `BuiltinToolExecutor`：将 `CapabilityInvocationRequest` 转换为 `Tool.execute(input, options)` 调用，统一执行 input validation、output validation、safe failure mapping 和 result wrapping。
- 明确 builtin Tool 注册规则：后续 builtin Tool change 通过 `defineTool` 生成显式 `ToolDefinition` 并加入 owned list；不得目录扫描、import side-effect 自注册或通过配置创建 Tool。
- 使用 `defineTool` 将既有 `read` 接入 Tool SPI，不改变 read 业务语义，并移除静态 read descriptor / 专用执行路径这条并行机制。
- 明确内置 Tool discovery 不再单独由 `add-ts-builtin-tool-discovery` 承载；本 change 完整承载 builtin Tool framework + discovery + registry 的首版范围。
- 明确 Tool 配置边界：本 change 只定义 `ToolCatalogConfig` 作为 framework config 入口，供外部传入已注册 Tool 的配置；最终用户配置文件 schema 和 app 映射在后续涉及具体 Tool 配置时定义。
- 明确 `SandboxExecutionPort` 是 Tool-facing 受控依赖接口；本 change 不实现该接口，后续 bash/python 等具体 Tool change 再定义其实现并保持 sandbox gateway boundary。

## Capability 影响（Capabilities）

### 修改的公共契约

- `agent-contracts/capability` - `CapabilityDescriptor.outputSchema?`

### 新增的 Tool 框架对象

- `ToolMetadata`
- `Tool`
- `ToolDefinition`
- `defineTool`
- `ToolDependencies`
- `ToolExecutionContext`
- `ToolExecuteOptions`
- `ToolCatalog` / `BuiltinToolCatalog`
- `BuiltinToolExecutor`
- `ToolCatalogConfig`

## 影响范围（Impact）

- `packages/agent-contracts` - 扩展 `CapabilityDescriptor` 和对应 schema/spec。
- `packages/agent-capability` - Tool SPI、builtin catalog、executor、descriptor projection、validation 和测试。
- `packages/agent-app` - 调用 capability subsystem composition，并可传入可选 `ToolCatalogConfig` / dependency source；不直接拥有 Tool discovery、ToolCatalog mutation 或 Tool executor routing。本 change 不定义最终用户 Tool 配置 schema。

## 主要 Owner

- Owner 9 Tool Capability

## 非目标（Non-Goals）

- 不改变具体 `read` 业务行为；本 change 只把既有 read 接入 Tool SPI。`write`、`glob`、`bash`、`python` 等具体 Tool 行为由后续 builtin tools change 承载。
- 不实现插件安装、插件 manifest、插件目录扫描或动态 Tool source；后续插件只复用现有 `CapabilityProvider` 和本 change 的 Tool SPI。
- 不引入 `ToolSource`、`ToolDescriptor`、`ToolInvocationRequest`、`ToolInvocationResult` 等并行公共契约。
- 不做运行时 decorator discovery、import side-effect 自注册或通过配置文件创建 Tool。
- 不要求第一版自动从 TypeScript 泛型生成 JSON Schema；可以后续通过 build-time generator 增强，但运行时必须消费固定 schema。
- 不把 workspace root、sandbox 内部细节、provider-private 配置或依赖对象加入 `CapabilityInvocationRequest`。
- 不展开最终用户配置文件 schema；builtin-tools provider 默认开启且当前不可由用户配置关闭，本 change 只定义 Tool framework 接收已注册 Tool 配置的入口。
