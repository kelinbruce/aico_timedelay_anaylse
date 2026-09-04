## 背景和现状（Context）

当前 `agent-capability` 已有 `CapabilityDescriptor`、`CapabilityInvocationRequest`、`CapabilityInvocationResult`、catalog 和 executor factory 边界。最小内核中 builtin `read` 仍以静态 descriptor 和专用执行对象接入。这个形态可以支撑一个工具，但不能支撑后续大量 builtin Tool 和插件 Tool 的开发体验：每个 Tool 都可能重复实现 schema 校验、配置消费、依赖获取、safe error mapping、result wrapping 和 descriptor projection。

当前需要演进的存量对象：

- `BuiltinToolsDiscovery` 直接通过 `createReadCapabilityDescriptor()` 产出 read descriptor。
- `BuiltinToolsExecutor` 当前包装 `ReadCapabilityInvocationPort` 执行 read。
- `ReadCapabilityInvocationPort` 当前同时承载 read input validation、workspace path enforcement、文件读取、结果包装和 capability envelope。
- `StaticCapabilityCatalog`、`StaticCapabilityExecutorFactory` 和 `GovernedCapabilityInvocationPort` 是既有 capability 主流程，应保留并接入新的 Tool discovery/executor。

本 change 的最小 delta 是：`ToolCatalog` 替代 `BuiltinToolsDiscovery` 成为 `builtin-tools + EAGER` 的产品 discovery implementation；read descriptor 由 `readToolDefinition.metadata` 投影；read execution 由 `BuiltinToolExecutor -> ToolCatalog.resolveExecutable(...) -> readTool.execute(...)` 完成。旧静态 read descriptor helper 和旧 read 专用 invocation port 不再作为产品路径入口。read 的业务校验和文件读取逻辑可以抽取为 read Tool 内部 helper 复用，但不得保留第二条 capability discovery 或 invocation path。

必须清理或替换的旧产品路径：

- `BuiltinToolsDiscovery`：由 `ToolCatalog` 替代为 `builtin-tools + EAGER` discovery implementation；不得继续由 discovery factory 返回。
- `createReadCapabilityDescriptor()`：不得再作为产品 descriptor source；read descriptor 必须由 `readToolDefinition.metadata` 投影。测试可改为从 ToolCatalog/listAll 获取 descriptor，或使用新的 test fixture descriptor helper。
- `ReadCapabilityInvocationPort` / `createReadCapabilityInvocationPort()`：不得再作为产品 invocation path；read 业务逻辑可抽取为 read Tool 内部 helper，但 helper 不实现 `CapabilityInvocationPort`。
- `BuiltinToolsExecutor` 内部 `ReadCapabilityInvocationPort` 字段：必须替换为 `ToolCatalog.resolveExecutable(...) -> Tool.execute(...)`。
- `StaticCapabilityCatalog` 默认构造参数中的 `createReadCapabilityDescriptor()`：必须移除，避免未显式传入 descriptors 时自动注册旧 read descriptor；builtin descriptors 应只来自 capability subsystem 对 `ToolCatalog.listAll(signal)` 的消费。
- public exports 和 tests 中直接依赖旧 read descriptor / invocation port 的产品路径用法必须删除或改为 Tool SPI 路径；只允许保留纯 test fixture helper，不得被 app/subsystem/core/runtime 产品路径 import。

本 change 不替代 capability 公共契约。Tool 是 `Capability(kind="TOOL")` 的开发和执行模型；跨模块公共事实仍由 capability contracts 承载。

## 目标和非目标（Goals / Non-Goals）

### 目标

- 为 Tool 开发者提供第一版标准 Tool SPI 和 `defineTool` authoring helper，使 Tool 元数据和业务本体分离，并降低无配置、无依赖 Tool 的定义成本。
- 通过现有 `CapabilityProvider` 表达 Tool 来源身份，不新增 `ToolSource`。
- 将 provider-neutral `ToolMetadata` 投影为 `CapabilityDescriptor(kind="TOOL")`。
- 在 `CapabilityDescriptor` 增加可选 `outputSchema`，用于描述 `CapabilityInvocationResult.structuredPayload`。
- 提供 `ToolCatalog` / `BuiltinToolCatalog`，合并第一版 discovery 与 registry，消费显式 Tool 列表、可信配置和受控依赖。
- 提供 `BuiltinToolExecutor`，统一完成 `CapabilityInvocationRequest -> Tool.execute -> CapabilityInvocationResult` 适配。
- 明确后续 builtin Tool 的注册方式：通过 `defineTool` 生成显式 `ToolDefinition` 并加入 owned list，不目录扫描、不 side-effect 自注册、不由配置创建 Tool。

### 非目标

- 不改变具体 `read` 业务行为；本 change 只把既有 read 接入 Tool SPI。其他基础 Tool 行为由后续具体 Tool change 定义。
- 不实现插件加载、插件 manifest、动态安装或目录扫描。
- 不实现 runtime decorator discovery。
- 不要求自动 schema generation。
- 不新增并行 Tool public invocation/result/descriptor 契约。
- 不展开最终用户配置文件 schema；builtin-tools provider 默认开启且当前不可由用户配置关闭。本 change 只定义 Tool framework 接收已注册 Tool 配置的 `ToolCatalogConfig` 入口，外部配置文件格式和 app 映射在后续涉及具体 Tool 配置时定义。

## 第一性原理

Tool 的本质是 `TOOL` capability 的开发模型，不是新的系统间协议。因此公共边界必须继续复用 `CapabilityProvider`、`CapabilityDescriptor`、`CapabilityInvocationRequest` 和 `CapabilityInvocationResult`。

Tool 调用必须隔离不可信输入和可信执行环境。模型和客户端只能影响 Tool input；workspace、sandbox、identity、Agent Scope、Owner Scope、配置和依赖只能来自可信 app/runtime composition。

Tool 开发者只应负责业务行为。框架负责治理：input validation、output validation、配置校验、依赖检查、timeout/cancellation、safe failure、观测脱敏和 result wrapping。

## 设计决策（Design Decisions）

### D1: CapabilityDescriptor 增加 outputSchema

这是本 change 明确执行的 capability contract update。实现时必须同步更新 `agent-contracts/capability`、contract tests、核心契约设计引用和一致性记录；不需要另起并行 Tool descriptor contract。

`CapabilityDescriptor` 新增可选字段：

```typescript
interface CapabilityDescriptor {
  readonly inputSchema?: JsonObject;
  readonly outputSchema?: JsonObject;
}
```

`outputSchema` 只描述成功调用时 `CapabilityInvocationResult.structuredPayload` 的 schema，不描述整个 `CapabilityInvocationResult` envelope，也不约束 `safeError`、`generatedMessages`、`contextPatch`、`resultRef`、`artifactRefs` 或 `metadata`。

### D2: Tool metadata 与 Tool 本体分离

Tool 元数据是 provider-neutral 的开发者声明：

```typescript
interface ToolMetadata<TConfig extends JsonObject = JsonObject> {
  readonly name: CapabilityId;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly outputSchema: JsonObject;
  readonly configSchema?: JsonObject;
  readonly requiredDependencies?: readonly ToolDependencyName[];
  readonly replayPolicy?: CapabilityReplayPolicy;
}
```

Tool 本体只承载配置绑定和业务执行：

```typescript
interface Tool<
  TInput extends JsonObject = JsonObject,
  TOutput extends JsonObject = JsonObject,
  TConfig extends JsonObject = JsonObject
> {
  configure?(config: TConfig, deps?: ToolDependencies): Tool<TInput, TOutput, TConfig>;

  execute(input: TInput, options?: ToolExecuteOptions): Promise<TOutput>;
}
```

第一版不单独暴露 `ConfiguredTool`。有配置的 Tool 可在 `configure()` 中返回绑定配置和依赖后的新 Tool；无配置 Tool 直接实现 `execute()`。

Tool 作者默认使用 `defineTool` 生成显式 definition。`defineTool` 是 authoring helper，不是注册机制：它不扫描目录、不产生 side effect、不读取配置、不把 Tool 自动加入 catalog，只返回可加入 owned list 的 `ToolDefinition`。

```typescript
interface ToolDefinition<
  TInput extends JsonObject = JsonObject,
  TOutput extends JsonObject = JsonObject,
  TConfig extends JsonObject = JsonObject
> {
  readonly metadata: ToolMetadata<TConfig>;
  readonly tool: Tool<TInput, TOutput, TConfig>;
}

function defineTool<
  TInput extends JsonObject = JsonObject,
  TOutput extends JsonObject = JsonObject,
  TConfig extends JsonObject = JsonObject
>(definition: {
  readonly name: CapabilityId;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly outputSchema: JsonObject;
  readonly configSchema?: JsonObject;
  readonly requiredDependencies?: readonly ToolDependencyName[];
  readonly replayPolicy?: CapabilityReplayPolicy;
  configure?(config: TConfig, deps?: ToolDependencies): Tool<TInput, TOutput, TConfig>;
  execute(input: TInput, options?: ToolExecuteOptions): Promise<TOutput>;
}): ToolDefinition<TInput, TOutput, TConfig>;
```

无配置、无依赖 Tool 必须支持最小写法，不需要声明 `configSchema`、`configure`、`requiredDependencies` 或空 dependency list：

```typescript
const echoTool = defineTool({
  name: "echo",
  description: "Echo validated input.",
  inputSchema: echoInputSchema,
  outputSchema: echoOutputSchema,
  async execute(input) {
    return input;
  }
});
```

### D3: Provider identity 继续使用 CapabilityProvider

ToolMetadata 不包含 `providerId`、`providerKind` 或 `providerType`。Tool 来源身份由现有 `CapabilityProvider` 在 catalog composition 时注入：

```text
ToolMetadata + CapabilityProvider -> CapabilityDescriptor
```

第一版 builtin provider 固定为：

```text
providerId = "builtin-tools"
providerKind = BUNDLED
```

后续插件 Tool 通过插件对应的 `CapabilityProvider` 接入，不需要修改 Tool SPI。

### D4: 受控依赖和执行上下文

Tool 可选使用受控依赖和执行上下文：

```typescript
type ToolDependencyName = "sandbox" | "workspaceFiles";

interface ToolDependencies {
  readonly sandbox?: SandboxExecutionPort;
  readonly workspaceFiles?: WorkspaceFilePort;
}

interface ToolExecutionContext {
  readonly identityContext: IdentityContext;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly sessionId: SessionId;
  readonly requestId: MessageId;
  readonly runId: RequestRunId;
  readonly requestContextId: RequestContextId;
  readonly stepId: string;
  readonly timeoutMs: number;
}

interface ToolExecuteOptions {
  readonly context?: ToolExecutionContext;
  readonly deps?: ToolDependencies;
  readonly signal?: AbortSignal;
}
```

Tool 不接触 `workspaceRoot`。文件访问必须通过 `workspaceFiles` 受控 port；命令和 Python 执行必须通过 `sandbox` 受控 port。Tool 实现不得直接使用宿主 `fs/path/child_process`、gateway-local 私有实现或 sandbox 内部实现。

### D5: WorkspaceFilePort 与 SandboxExecutionPort

第一版只定义 Tool-facing 依赖边界，不在本 change 固定具体工具行为。`WorkspaceFilePort` 和 `SandboxExecutionPort` 是 `agent-capability` 内 Tool SPI 的受控适配接口，不是新的跨模块 gateway public contract。

```typescript
interface WorkspaceFilePort {
  readText(input: JsonObject, signal?: AbortSignal): Promise<JsonObject>;
}

interface SandboxExecutionPort {
  runShell(input: JsonObject, signal?: AbortSignal): Promise<JsonObject>;
  runPython(input: JsonObject, signal?: AbortSignal): Promise<JsonObject>;
}
```

`WorkspaceFilePort` 当前只暴露 read 所需的 `readText`。后续 write/glob Tool change 如需文件写入或 glob 行为，必须在对应 change 中扩展该 port 并补齐安全约束和验证，不得在本 change 预置未使用方法。

后续 bash、python 或 executable Tool change 可以在具体 Tool 语义中定义 `SandboxExecutionPort` 的实现，并可通过既有 `SandboxGatewayPort` 执行动态内容；本 change 不规定实现包、调用映射或 sandbox request 构造规则。

本 change 不实现 `SandboxExecutionPort`，也不要求 `agent-capability` 导入 `agent-contracts/gateway`。后续 bash、python 或 executable Tool change 必须在具体 Tool 语义中定义该 adapter 的实现归属，并证明动态执行仍通过 sandbox gateway boundary。

这些 port 的实现负责 workspace/sandbox 安全边界：workspace-relative path enforcement、workspace binding、sandbox routing、timeout/cancellation、bounded output 和 safe failure mapping。底层事实不得暴露为 Tool input 或 `CapabilityInvocationRequest` 字段。

### D6: Builtin Tool 注册规则

Builtin Tool 注册必须显式通过 owned list 完成。每个 entry 是 `ToolDefinition`，通常由 `defineTool` 生成：

```typescript
const BUILTIN_TOOLS = [
  readToolDefinition,
  writeToolDefinition
] as const;
```

后续 builtin Tool change 的唯一注册路径：

1. 使用 `defineTool` 定义并导出 `ToolDefinition`。
2. 将 `ToolDefinition` 加入 owning package 的 builtin Tool list。

禁止目录扫描、import side-effect 自注册、运行时 decorator discovery，以及通过最终用户配置创建不存在于 list 中的 Tool。

本 change 使用 `defineTool` 将既有 read 接入第一版 Tool SPI：read 的 input/output schema、read-only 语义、workspace 限制、截断/offset 行为和 safe failure 语义沿用既有 read 规格；framework change 只负责将其转换为 `readToolDefinition`、加入 owned builtin Tool list，并通过 `ToolCatalog` / `BuiltinToolExecutor` 暴露和执行。read 不走 sandbox；它通过 `WorkspaceFilePort` 读取，并在缺失 `workspaceFiles` dependency 时产生 unavailable descriptor。

### D7: ToolCatalog / BuiltinToolCatalog

第一版用一个 catalog 对象合并 discovery 与 registry，避免过早拆分。对 capability discovery 边界，它必须遵从现有 `CapabilityDiscovery` 接口；executable lookup 只是 `BuiltinToolExecutor` 使用的 framework-internal 能力，不新增或替代 discovery SPI：

```typescript
interface ToolCatalog extends CapabilityDiscovery {
  readonly provider: CapabilityProvider;
  readonly discoveryMode: "EAGER";

  listAll(signal: AbortSignal): Promise<readonly CapabilityDescriptor[]>;

  resolveExecutable(input: {
    readonly provider: CapabilityProvider;
    readonly capabilityId: CapabilityId;
  }): ExecutableTool | undefined;
}
```

`ExecutableTool` 是框架内部对象，不面向 Tool 开发者：

```typescript
interface ExecutableTool {
  readonly metadata: ToolMetadata;
  readonly tool: Tool;
  readonly deps?: ToolDependencies;
}
```

Catalog 创建输入：

```typescript
createToolCatalog({
  provider,
  tools: readonly ToolDefinition[],
  config,
  dependencies
})
```

Tool framework config 入口是 `ToolCatalogConfig`，由 app composition、后续具体 Tool owner 或测试 fixture 构造并传给 `createToolCatalog({ config })`。当前 change 只定义入口和校验规则，不定义最终用户配置文件字段，也不要求 app composition 读取 Tool 配置：

```typescript
interface ToolCatalogConfig {
  readonly tools?: Readonly<Record<string, ToolConfig>>;
}

interface ToolConfig {
  readonly safeDescriptionOverride?: string;
  readonly config?: JsonObject;
}
```

`ToolCatalogConfig` 不是最终用户配置文件 schema，也不进入 `agent-contracts/app`。它只能配置已注册 Tool，不得创建 Tool。builtin-tools provider 默认开启；当前 change 不提供 provider/global enabled 或 disabled 开关。外部配置文件如何表达 builtin Tool description override 或 per-tool config，由后续涉及具体 Tool 配置的 change 定义。

Catalog 职责：

1. 校验同一 provider 内 `metadata.name` 唯一。
2. 校验 metadata schema shape。
3. 应用 safe description override。
4. 使用 `metadata.configSchema` 校验 per-tool config。
5. 校验 `requiredDependencies` 在 `dependencies` 中可用。
6. 调用 `tool.configure?(config, dependencies)`。
7. 投影 `CapabilityDescriptor`。
8. 按 `provider.providerId + capabilityId` 保存 executable lookup。

`ToolCatalog` 不提供 `discover(toolName)`、`scanAndRegister(catalog)` 或其它 discovery 替代接口。单个 capability resolve 仍由既有 capability catalog 负责；ToolCatalog 接入、catalog 注册/组装和 executor routing 由 capability subsystem 负责。

主流程接入规则：

- `ToolCatalog` 是 `builtin-tools` provider 的 `CapabilityDiscovery` implementation，不是第二套 capability catalog。
- `CapabilityDiscoveryFactory.create({ provider: builtin-tools, discoveryMode: "EAGER" })` 必须返回由 owned builtin Tool list、`ToolCatalogConfig?` 和 `ToolDependencies` 构造的 `ToolCatalog`。
- 现有 capability catalog 只通过 `CapabilityDiscovery.listAll(signal)` 消费 Tool descriptors；`ToolCatalog` 不直接 mutate capability catalog，也不绕过 conflict resolution。
- request-visible/executable view、按 `capabilityId` 的唯一解析、provider conflict 处理和 Agent binding 过滤仍归现有 capability catalog / governance 负责。

### D8: ToolMetadata 到 CapabilityDescriptor 的投影

投影规则：

```text
ToolMetadata.name -> CapabilityDescriptor.capabilityId
ToolMetadata.name -> CapabilityDescriptor.displayName
ToolMetadata.description or trusted override -> CapabilityDescriptor.safeDescription
ToolMetadata.inputSchema -> CapabilityDescriptor.inputSchema
ToolMetadata.outputSchema -> CapabilityDescriptor.outputSchema
ToolMetadata.replayPolicy or default -> CapabilityDescriptor.replayPolicy
CapabilityProvider -> CapabilityDescriptor.provider
framework constant -> CapabilityDescriptor.kind = "TOOL"
enablement/config/dependency result -> availabilityStatus / availabilityReason
```

配置不得替换 `inputSchema`、`outputSchema`、provider identity、dependency declarations 或 execute mapping。

### D9: BuiltinToolExecutor

`BuiltinToolExecutor` 是 `CapabilityExecutor` 实现，负责统一执行适配：

```text
CapabilityDescriptor + CapabilityInvocationRequest
  -> descriptor provider + request capability id executable lookup
  -> validate request.arguments against metadata.inputSchema
  -> build ToolExecutionContext from request
  -> call Tool.execute(input, { context, deps, signal })
  -> validate output against metadata.outputSchema / descriptor.outputSchema
  -> wrap output into CapabilityInvocationResult.structuredPayload
  -> map validation/config/dependency/tool failures to safe CapabilityInvocationResult
```

Capability invocation request 仍只携带 `capabilityId`，不新增 provider 字段。调用前，既有 capability catalog / conflict resolver 必须已经根据 Agent binding 和 provider 冲突规则解析出唯一 `CapabilityDescriptor`；若同名 capability 冲突不能解析，外部直接按 capabilityId 调用时应在 catalog/invocation port 阶段返回 unavailable/conflict safe result，而不是进入 Tool executor。

Executor lookup 必须使用 resolved descriptor 的 provider 和 request capability id，不得只按 `capabilityId` 查找。第一版 `BuiltinToolExecutor` 只处理 builtin provider；后续 provider-specific executor 或通用 Tool executor 可以复用相同 Tool SPI。

具体 Tool 不返回 `CapabilityInvocationResult`，不写 timeline/session/audit，不直接暴露 raw host error。

执行主流程接入规则：

- `BuiltinToolExecutor` 是 `CapabilityExecutor` implementation，不是新的 invocation port。
- `CapabilityExecutorFactory.create({ descriptor })` 在 `descriptor.kind="TOOL"` 且 `descriptor.provider.providerId="builtin-tools"` 时必须返回唯一 `BuiltinToolExecutor`。
- `CapabilityInvocationPort` 仍是 agent-core/runtime 的唯一调用入口：它先通过 capability catalog resolve 得到唯一 descriptor，再调用 executor factory；Tool executor 不接收未解析 provider 的 request。
- 如果 executor factory 对 builtin `TOOL` descriptor 返回 0 个或多个 executor，invocation path 必须返回 safe failure，不得按注册顺序选择。
- `BuiltinToolExecutor` 使用同一个 `ToolCatalog.resolveExecutable({ provider: descriptor.provider, capabilityId: request.capabilityId })` 获取 executable Tool。

### D10: Tool 配置边界

最终用户配置文件读取和外层装配不属于本 change。ToolCatalog 只消费外部传入的 `ToolCatalogConfig` 可信配置对象；该对象是本 change 的 Tool config 框架入口。

配置允许：

- safe description override。
- `ToolMetadata.configSchema` 明确允许的 per-tool config。

配置禁止：

- 创建新 Tool。
- 修改 provider identity。
- 替换 input/output schema。
- 修改 required dependencies。
- 指定 execute mapping。
- 暴露 workspace/sandbox behavior。

配置失败策略：

- 单个 Tool config 无效时，该 Tool 不进入 executable lookup，ToolCatalog 必须产生 `availabilityStatus="UNAVAILABLE"` 的 descriptor，并使用安全 `availabilityReason` reason code 说明配置无效。
- `ToolCatalogConfig` 包含未注册 Tool 名称时，`createToolCatalog` 必须产生 safe configuration failure；不得静默忽略，也不得创建 descriptor 或 executable。
- 缺失 required dependency 时，该 Tool 不进入 executable lookup，ToolCatalog 必须产生 `availabilityStatus="UNAVAILABLE"` 的 descriptor，并使用安全 `availabilityReason` reason code 说明依赖缺失。
- ToolCatalog 可以同时产生安全启动诊断，但 descriptor 是必需的可观察结果。
- 不得静默忽略无效配置，也不得延迟到请求期才暴露配置错误。

## 唯一实施路径

```text
agent-app calls createCapabilitySubsystem(...)
  -> agent-capability creates trusted CapabilityProvider(providerId=builtin-tools, providerKind=BUNDLED)
  -> agent-capability obtains ToolDependencies(sandbox?, workspaceFiles?) and optional ToolCatalogConfig
  -> existing read is represented as readToolDefinition = defineTool(...)
  -> CapabilityDiscoveryFactory creates ToolCatalog for builtin-tools/EAGER from BUILTIN_TOOLS + ToolCatalogConfig? + dependencies
  -> ToolCatalog validates metadata/config/dependencies
  -> capability catalog consumes ToolCatalog through CapabilityDiscovery.listAll(signal)
  -> capability catalog resolves a unique descriptor by capabilityId for the request-visible executable view
  -> CapabilityInvocationPort invokes executor factory with resolved descriptor + provider-free request
  -> CapabilityExecutorFactory selects exactly one BuiltinToolExecutor for providerId=builtin-tools + kind=TOOL
  -> BuiltinToolExecutor resolves executable from ToolCatalog by descriptor.provider + request.capabilityId
  -> executor validates input, calls Tool.execute, validates output
  -> executor returns CapabilityInvocationResult
```

## 影响模块

- `agent-contracts`：`CapabilityDescriptor.outputSchema?`。
- `agent-capability`：Tool SPI、catalog、executor、descriptor projection、validation、安全测试。
- `agent-app`：调用 capability subsystem composition，并可传入可选 `ToolCatalogConfig` / dependencies source；不直接拥有 Tool discovery、ToolCatalog mutation 或 Tool executor routing，不在本 change 定义最终用户 Tool 配置 schema。

## 质量属性

- Security：Tool 不接触 workspace root、host path、host process API 或 private gateway implementation；依赖由受控 port 注入。
- Reliability：executor 统一传递 `AbortSignal` 并映射 safe failure；配置错误启动期暴露。
- Capacity：input/output schema validation 和 DFX policy 由 catalog/executor 统一消费；具体限制由 Tool metadata 或后续具体 Tool change 定义。
- Observability：Tool/executor 不记录 raw command、code、content、stdout/stderr、credential、token、host path 或高基数字段。
- Maintainability：新增 builtin Tool 只新增 `ToolDefinition` 并加入 owned list，不修改 executor。
- Testability：catalog projection、config validation、dependency validation、executor input/output validation 和 safe failure mapping 可独立黑盒测试。

## 归档前更新基线

- `openspec/specs/builtin-tool-framework/spec.md`
- `openspec/designs/architecture/capability-lifecycle.md`
- `openspec/designs/contracts/capability-provider-spi.md`
- `openspec/designs/contracts/capability-executor-spi.md`
- `openspec/designs/architecture/core-contracts.md`
- `openspec/designs/modules/agent-capability.md`
- `openspec/designs/spec-to-design-map.md`
