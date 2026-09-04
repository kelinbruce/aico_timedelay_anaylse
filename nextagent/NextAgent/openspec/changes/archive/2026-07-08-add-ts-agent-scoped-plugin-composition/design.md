## 背景和现状（Context）

当前 TS 后端已经具备几个可复用主路径：

- `agent-capability` 已有 Tool SPI、`defineTool`、Tool catalog、Capability catalog、descriptor projection 和 invocation 主路径。
- `complete-ts-lifecycle-hook-capabilities` 完成后，`agent-runtime` / `agent-contracts/runtime` 拥有完整 lifecycle hook contract：`LifecycleHook`、effects-derived execution strategy、`HookOutcome`、stage mutation、`AgentAssembly.hooks` activation 和 startup hook registry。本 change 面向插件开发者的 `defineLifecycleHook(...)` authoring helper 由 `agent-plugin-sdk` 暴露，且必须保持与 runtime hook validation 相同的语义。
- `add-ts-risk-policy-enforcement` 定义了现有受限操作前治理主路径；插件 Tool 继续走既有 capability / risk governance。
- `agent-app` 是唯一 composition root，负责启动期读取配置、编译 Agent assembly、创建 capability subsystem、runtime、model、gateway 和 observability。

缺口是开发者自定义代码缺少一个受控入口。Tool、policy、hook 如果各自读取目录或动态 import，会绕过 `agent-app` composition、Agent Scope、capability governance 和 safe diagnostics。本 change 把插件定义为启动期本地 TypeScript composition 能力：启动前准备本地插件目录和单文件 ESM bundle，bundle 除白名单 host-provided 工具库外必须自包含，启动时由 `agent-app` 按 system config 显式加载并冻结；Tool 只有被当前 Agent `capabilityBindings` 绑定后才可见，policy/hook 只有被当前 Agent 专用配置激活后才生效。

当前代码与目标设计存在 gap：

- `DefaultSystemConfig` 未包含 plugin package 配置；`agent-app` plugin subsystem 也未定义 framework-owned `OpenPolicyInventory`。
- `AgentDefinition` 未包含 plugin activation 配置。
- `StartupAgentAssemblyCompiler` 只编译 model/profile/prompt/capability/workspace facts，未编译 plugin activation。
- plugin hook 接入完整 lifecycle hook registry 和 `AgentAssembly.hooks` activation。
- capability subsystem 已有外部 provider 接入能力（当前代码命名为 `externalContributions`），需要把 provider 命名和插件 provider authoring surface 收敛清晰；插件 provider 复用该外部 provider 输入和统一 Tool registry。
- `agent-core` 拥有 Agent 内部 request routing 和 orchestration；policy 插件首版只开放 `agentRoutingPolicy`，需要由 `agent-contracts/runtime` 定义 policy resolver contract、`agent-runtime` 实现通用 policy registry/resolver、`agent-core` 提供 Agent-scoped routing typed adapter，并由 `agent-app` 在 composition root 装配这些组件，以便按当前 Agent activation 选择插件 evaluator 或系统内置 evaluator。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 提供智能体开发者可使用的本地 TypeScript 插件 authoring 入口。
- `agent-app` 在启动期从 system config 显式声明的本地插件目录加载、校验并冻结插件 registry。
- Agent 配置通过既有 `capabilityBindings` 允许插件 Tool，通过 `policies` 编译到 `AgentAssembly.policies` 激活开放 policy 清单中的 policy implementation；lifecycle hook 仍通过同级 `hooks` / `AgentAssembly.hooks` 激活。
- 插件 provider 进入 capability provider/discovery/catalog 主路径，Tool 调用继续复用现有 `CapabilityInvocationPort`。
- 明确 capability discovery 和 Agent binding 是两条独立事实：provider + `discoveryMode` 决定 descriptor 何时进入 catalog（`EAGER` 启动期描述符或 `SEARCH` 延迟检索），当前 accepted Agent 的 `capabilityBindings` 参与 catalog filtering，决定 descriptor 是否可见、可 resolve、可 invoke。
- 保留现有 capability catalog filtering 语义：builtin Tool、builtin/system/agent-owned Skill、parent subagent 等既有默认可见 provider 继续保持既有规则；SkillHub 继续使用既有 provider binding 后 search 的规则；app-composed `memory-tools` 继续使用既有 enabled binding opt-in/registration 规则；插件 provider 首版返回 `TOOL` descriptors，可选择 `EAGER` 或 `SEARCH` discovery，并通过当前 Agent 的 `capabilityBindings` 显式 binding/selector 获得可见、search、resolve 和 invoke authority。
- policy 插件按明确开放且状态为 `OPEN` 的 policy point 接入；首版清单包含 `restrictedOperationPolicy`、`agentRoutingPolicy`、`modelSelectionPolicy`、`modelFallbackPolicy` 和 `contextWindowPolicy`，其中 `agentRoutingPolicy` 可激活。
- hook 插件复用完整 lifecycle hook execution 的 stage、effects、outcome、mutation、failure/configure/order 和 AgentAssembly activation semantics。
- request 执行按 accepted `agentId`、`agentVersion`、`agentAssemblyRef` 消费当前 Agent 的 `capabilityBindings`、`AgentAssembly.policies` 和 frozen `AgentAssembly.hooks`。
- 所有插件加载、校验、激活失败都产生 safe diagnostic，诊断字段使用 plugin id、provider id、policy id、hook id、agent id、agent version、safe reason code 和 bounded summary。
- 明确插件交付和依赖边界：运行时插件 artifact 是单文件 `.js` ESM bundle，host-provided 工具库通过白名单 inventory、manifest 声明、静态 import specifier 扫描和 factory 注入治理。

**非目标：**

- 不支持运行时安装、热加载、watcher reload、远端下载、marketplace、签名信任链、版本回滚或 UI 管理。
- 不支持非 TypeScript 插件 runtime。
- 不支持 zip 包、目录自动扫描、glob discovery、插件私有 `node_modules` 解析或由 `agent-app` 执行插件依赖安装。
- 不允许 Agent package、SkillHub package、request body、client metadata 或 model output 携带可执行插件代码。
- 不开放通用 `PolicyPort`、未知 policy kind、remote policy service、script policy 或 hook executor plugin。
- 不重定义 capability catalog、Tool executor、risk policy enforcement 或 lifecycle hook execution 语义。

## 设计决策（Decisions）

### D0: 实施顺序依赖完整 lifecycle hook 能力

本 change 必须在 `complete-ts-lifecycle-hook-capabilities` 归档后实施。插件 hook 接入完整 hook contract 和 `AgentAssembly.hooks` activation 语义，使用当前 `LifecycleHook` object、startup hook registry 和 runtime hook executor 主路径。

实施时的唯一 hook 接入路径：

1. 插件导出由 `agent-plugin-sdk` 的 `defineLifecycleHook(...)` 创建的 `LifecycleHook` implementation object。
2. `agent-app` plugin composition 在启动期校验插件 hook object，并把它作为 already-composed startup hook registry input 交给完整 hook registry。
3. Agent 是否启用、禁用、收窄 stage、配置 config、声明 custom order，仍只由 `agent.yaml.hooks` 编译成 `AgentAssembly.hooks` 决定。
4. runtime 只按 accepted run 的 frozen `AgentAssembly.hooks` 和完整 hook executor 语义执行。

### D1: 插件 authoring 使用薄 `agent-plugin-sdk`

新增 workspace package `@nextagent/agent-plugin-sdk`。该包只暴露插件 authoring 所需的稳定 helper 和类型：

- `definePlugin(plugin): NextAgentPlugin`
- `definePluginFactory(factory): NextAgentPluginFactory`
- `defineCapabilityProvider(provider): CapabilityProvider`
- `defineTool(input: DefineToolInput): ToolDefinition`，作为单 Tool authoring 糖，只返回 ToolDefinition
- `defineToolProvider(input: DefineToolProviderInput): CapabilityProvider`，作为标准 Tool provider 糖，生成 `EAGER` discovery + Tool executor 的 provider
- `defineAgentRoutingPolicy(policy): AgentRoutingPolicy`，作为首版唯一 `OPEN` policy point 的 authoring helper
- `defineLifecycleHook(hook): LifecycleHook`
- `getPluginMetadata(plugin): PluginMetadata`，作为 authoring/test helper，只读取已物化插件对象的 safe metadata
- 插件 provider/policy/hook authoring 类型和开放 policy inventory metadata
- `HostExternalId`
- `HostExternalRegistry`
- `HOST_EXTERNAL_INVENTORY`
- `LATEST_PLUGIN_API_VERSION`
- `ROOT_PLUGIN_API_VERSION`
- `SUPPORTED_PLUGIN_API_VERSIONS`
- dev-only subpath `@nextagent/agent-plugin-sdk/scaffold`，提供 `create-nextagent-plugin` CLI 的 scaffold 实现
- 从 public contract 转出的必要 type-only contract，例如 `ToolDefinition`、`LifecycleHook`、`HookInput`、`HookResult`、`AgentRoutingPolicy`、`AgentRoutingPolicyExecutable`、`AgentRoutingPolicyResult`

`definePlugin` 是默认 authoring 路径，适用于直接把 `typebox`、`ajv` 或其它三方依赖打包进单文件 bundle 的插件。`definePluginFactory` 是 host external 优化路径，适用于多个插件共享 `typebox` / `ajv` 且需要与宿主版本一致的场景：插件 default export 是 factory，`agent-app` 在启动期完成 manifest 校验后注入 `{ externals }`，factory 返回 `NextAgentPlugin`。首版 factory host object 只包含 `{ externals }`；后续如需 safe logger、safe config reader、safe http client 等 host service，必须通过新的 OpenSpec change 扩展 host object contract，插件不得依赖未文档化字段。

`defineTool(...)` 和 `defineToolProvider(...)` 是两层糖：`defineTool(...)` 降低单个 Tool 的 authoring 成本，`defineToolProvider(...)` 降低标准 Tool provider 的 authoring 成本。Capability provider authoring 分为三层：

- 高级路径：`agent-contracts/capability` 定义稳定 `CapabilityProvider` SPI，包括 `CapabilityProviderIdentity`、`CapabilityDiscovery`、`CapabilityExecutor` 和 descriptor/result contract。插件可以通过 `defineCapabilityProvider(...)` 直接贡献带自定义 discovery/executor 的 provider。
- Tool 糖路径：`defineTool(...)` 使用 public `DefineToolInput` 生成 `ToolDefinition`，职责范围是单 Tool metadata/schema/config/dependency/policy/observability/configure/execute authoring。
- Provider 糖路径：`defineToolProvider(...)` 使用同一 SPI 把 `ToolDefinition[]` 包装成标准 `CapabilityProvider`，提供 startup `EAGER` descriptor discovery 和 Tool executor。它覆盖标准 Tool provider 场景；自定义发现或执行编排继续使用高级路径。

`DefineToolInput` 是 `defineTool(...)` 的糖接口入参，必须对齐当前 `agent-capability` 已有 `defineTool(...)` 的 public authoring shape，但归 `agent-contracts/capability` owning，避免 plugin SDK 依赖 `agent-capability` implementation package：

```ts
interface DefineToolInput<
  TInput extends JsonObject = JsonObject,
  TOutput extends JsonObject = JsonObject,
  TConfig extends JsonObject = JsonObject
> {
  name: CapabilityId;
  description: string;
  inputSchema: JsonObject;
  outputSchema: JsonObject;
  configSchema?: JsonObject;
  requiredDependencies?: readonly ToolDependencyName[];
  replayPolicy?: CapabilityReplayPolicy;
  disclosurePolicy?: CapabilityDisclosurePolicy;
  returnsCapabilityResult?: boolean;
  observability?: ToolObservabilityDefinition;
  configure?(config: TConfig, deps?: ToolDependencies): Tool<TInput, TOutput, TConfig>;
  execute(input: TInput, options?: ToolExecuteOptions): Promise<TOutput | CapabilityInvocationResult>;
}
```

`DefineToolInput` 可以表达单 Tool 的 metadata、schema、safe config、required dependencies、replay/disclosure policy、observability、configure 和 execute。Provider identity、discovery mode、binding policy、default exposure、Agent activation、plugin loading、host external import、filesystem path 和 registry side effect 归 provider、assembly、loader 或 catalog 边界处理。`ToolDefinition`、`ToolMetadata`、`Tool`、`ToolExecuteOptions`、`ToolDependencies`、`ToolObservabilityDefinition` 和 `DefineToolInput` 应由 `agent-contracts/capability` 暴露；`agent-plugin-sdk` 可以 re-export 这些 type，并提供纯函数 `defineTool(...)`。

`DefineToolProviderInput` 是 `defineToolProvider(...)` 的糖接口入参，不是运行时概念。它只包含：

```ts
interface DefineToolProviderInput {
  providerId: string;
  providerType?: string;
  description?: string;
  tools: ToolDefinition[];
}
```

`DefineToolProviderInput` 是通用 authoring shape。first-party module 例如 memory 显式传 `providerId=memory-tools`。插件 SDK 使用该 shape 时要求插件作者显式声明 `providerId`，`providerType` 可省略并按插件 Tool provider 默认值 `nextagent-plugin-tool` 处理；`agent-app` 在插件加载校验时校验 provider id safe vocabulary、全局唯一性、reserved provider id 冲突和 provider type 约束。`description` 只用于 safe diagnostic 和开发者文档。`tools` 是唯一必填字段，每个 Tool 的 name、schema、executor 继续来自既有 `ToolDefinition`。需要 `SEARCH` discovery 或自定义执行编排时使用 `defineCapabilityProvider(...)`，并同样显式声明 provider identity。

`defineAgentRoutingPolicy(...)` 是 policy authoring 糖，输入和输出复用既有 core routing policy 的 `AgentRoutingPolicy` / `AgentRoutingPolicyExecutable` / `AgentRoutingPolicyResult`。SDK 同时暴露通用 `PluginPolicy` contribution shape，用于让 plugin registry 承载可枚举 policy point 到各自 executable 类型的映射；`AgentRoutingPolicy` 是 `PluginPolicy<"agentRoutingPolicy"> & AgentRoutingPolicyExecutable` 的强类型 specialization，支持 `configSchema?`、`configure?(config)` 和 routing-specific `decide(run, context, signal)`。SDK 同步导出开放 policy inventory metadata：`agentRoutingPolicy` 标记为 `OPEN`，`restrictedOperationPolicy`、`modelSelectionPolicy`、`modelFallbackPolicy` 和 `contextWindowPolicy` 标记为 `RESERVED`。SDK 可以暴露 RESERVED id 的 metadata 便于开发者理解路线图，但本 change 不提供 RESERVED policy implementation helper，也不允许 Agent 激活 RESERVED policy point。

`agent-plugin-sdk` 只在插件 authoring 语义上包一层：保留插件类型体验，并输出 `CapabilityProvider`、`ToolDefinition`、`AgentRoutingPolicy` 或 `LifecycleHook`。First-party module，例如 `agent-memory`，直接使用 `agent-contracts/capability` 中的 provider SPI / `DefineToolInput` / `DefineToolProviderInput` shape 或自己的薄 wrapper。

`getPluginMetadata(...)` 是 authoring/test helper，用于模板测试和开发者自检。它只读取已物化插件对象中的 plugin id、version、provider id、policy id、hook id 等 safe metadata；不得读取 `plugin.json`、执行 dynamic import、校验 host external 版本、冻结 registry、编译 Agent activation 或证明 production loadability。

`agent-plugin-sdk` 的职责是 developer-facing authoring helper、类型、open policy id/type 清单、host external id/type 清单和 dev-only scaffold entry point。runtime、catalog、gateway、filesystem、config loader、plugin loader 和 policy runtime execution 实现归各 owner package。插件 hook authoring 从 SDK 导入 `defineLifecycleHook(...)`，保持与 runtime hook validation 同形。SDK 中的 `HOST_EXTERNAL_INVENTORY` 是 authoring-time 稳定 id/type 清单；真正的版本校验、对象注入和 fail-closed enforcement 由 `agent-app` 完成。

SDK 同时暴露插件 API contract 版本常量。首版 `LATEST_PLUGIN_API_VERSION` 为 `"1.0"`，`SUPPORTED_PLUGIN_API_VERSIONS` 只包含 `"1.0"`，root `definePlugin(...)` 使用固定的 root plugin API version `"1.0"` 写入 `NextAgentPlugin.apiVersion`，不得把 authoring helper 默认值绑定到未来可能变化的 host latest 版本。该版本描述 NextAgent plugin API contract，不描述插件自身发布版本；插件自身发布版本继续使用 `NextAgentPlugin.version` / `plugin.json.version`。未来如果引入 `"2.0"` 等新插件 API 版本，应通过新的 OpenSpec change 增加显式版本化 SDK subpath 或等价稳定入口；本 change 只在结构上保留该演进方向，不预先暴露 `vXX` subpath。

`agent-plugin-sdk` 是本 change 新增的独立 workspace package，必须同步更新 workspace architecture guard：root workspace package inventory、package README、package manifest exports、package `bin`、dependency-cruiser package lists、implementation package firewall 和 architecture tests。该 package 的 allowed dependencies 包含 `agent-common`、public `agent-contracts` subpaths（包括 `agent-contracts/capability` 中的 `DefineToolInput`、provider SPI 和 `DefineToolProviderInput` shape，以及 `agent-contracts/core` / `agent-contracts/runtime` 中 routing policy 需要的 public type）、dev-only scaffold dependencies、以及 type-only / runtime-safe utility dependencies needed for SDK helper shape。`defineLifecycleHook(...)` 可由 SDK 内部实现为纯 authoring helper，或通过 contract-safe pure helper 与 runtime 共享校验语义。新增该 package 保持 `agent-app` 作为 runtime plugin loader owner。

放弃方案：

- 让插件直接 import `agent-app` 内部类型：会把 composition root 变成开发者 SDK，导致实现细节外泄。
- 让插件直接 import `agent-contracts/plugin`：当前没有独立 plugin owning module，新增该 subpath 会扩大 public contract 面。
- 不提供 SDK，只要求插件导出任意 plain object：难以稳定约束 provider、policy、hook shape，也不利于 contract tests。

### D2: 插件以显式目录 artifact 进入系统

插件开发者在启动前准备插件目录。首版支持的运行时交付形态是插件目录内的 `.js` ESM bundle。开发者可以在自己的构建阶段使用任意三方依赖；默认推荐做法是把 `typebox`、`ajv` 和其它三方依赖直接打包进 bundle，并使用 `definePlugin(...)` 导出 plain plugin object。只有当多个插件共享 framework-owned 工具库且需要与宿主版本保持一致时，才使用 `definePluginFactory(...)` 加 `hostExternals`。`agent-app` 的职责是启动期读取显式配置、校验 artifact、注入 allowed host externals 并冻结 registry。首版 system config `plugins[]` 最多声明 8 个插件，超过上限在 startup validation 阶段 fail closed；该上限是启动期容量和可诊断性 guardrail，不是 Agent activation 语义。

推荐目录形态：

```text
configRoot/
  plugins/
    telecom-diagnostics/
      plugin.json
      index.js
```

`plugin.json` 最小 shape：

```json
{
  "pluginId": "telecom-diagnostics",
  "version": "1.0.0",
  "apiVersion": "1.0",
  "main": "./index.js",
  "artifactType": "esm-bundle",
  "hostExternals": [
    {
      "id": "typebox",
      "versionRange": "^0.34.0"
    }
  ]
}
```

manifest 字段语义：

- `pluginId`：必须是 safe id，且与 system config 和插件 export 的 `pluginId` 一致。
- `version`：用于 safe diagnostic、registry snapshot 和 activation refs，不参与运行时版本解析或自动升级。
- `apiVersion`：可选，声明插件 bundle 使用的 NextAgent plugin API contract 版本，采用 major/minor 字符串，例如 `"1.0"`；省略时 `agent-app` 优先使用插件 export 的 `apiVersion`，若 export 也省略则按当前宿主最新支持版本解释，首版为 `"1.0"`。显式声明但宿主不支持的版本，例如当前的 `"2.0"`，必须在 startup validation 中 fail closed。
- `main`：必须是插件目录内的相对单文件 `.js` ESM bundle；不得是 URL、绝对路径、parent traversal、glob、shell expression、目录或 multi-file entry。
- `artifactType`：首版只允许 `esm-bundle`。bundle 必须是单文件且自包含，唯一例外是通过 `hostExternals` 声明并由 `agent-app` 注入的白名单工具库。
- `hostExternals`：可选。每个条目必须引用 framework-owned `HostExternalInventory` 中的稳定 id，并声明插件期望的兼容版本范围。未知 id、版本不兼容或声明关闭库 MUST fail closed。

Host external 是 factory injection，不是 Node module resolution。默认推荐路径不声明 `hostExternals`，插件将 `typebox` / `ajv` 直接打进 bundle 并导出 `definePlugin(...)` 的结果。插件只有在需要复用宿主工具库时才通过 `host.externals` 使用注入对象。`agent-app` 在执行 main bundle 的 dynamic import 前必须静态扫描单文件 bundle import specifier，覆盖 static `import`、`export ... from` 和 string-literal dynamic `import(...)`。扫描通过条件是 bundle 中没有任何 runtime import specifier；所有第三方依赖在构建期打包进该单文件 bundle，host external package name（例如 `@sinclair/typebox` / `ajv`）通过 factory injection 消费。需要复用宿主工具库时，插件必须导出 factory：

`agent-app` loader 按 manifest `apiVersion` 或 materialized plugin export `apiVersion` 选择 plugin API contract gate。首版只有 v1 gate：校验当前 manifest shape、materialize plain plugin object 或 factory result，并统一输出 `PluginRegistrySnapshot`。后续如增加 `"2.0"`，应新增 v2 gate/adapter，把 v2 manifest 和 plugin object shape 转成同一个内部 snapshot；runtime、capability、routing 和 hook 主路径不得散落 v1/v2 分支。manifest 和 plugin export 同时声明版本时必须一致；manifest 省略时，当前 root `definePlugin(...)` 写入的 `"1.0"` 决定插件对象使用 v1 API version，而不是跟随宿主 latest 漂移。

```ts
export default definePluginFactory((host) => {
  const { Type } = host.externals.typebox;

  return definePlugin({
    pluginId: "telecom-diagnostics",
    version: "1.0.0",
    providers: []
  });
});
```

`agent-app` 启动期注入：

```ts
pluginFactory({
  externals: {
    typebox: { Type },
    ajv: { Ajv }
  }
});
```

Host external inventory 的开放原则：

- 只开放纯工具库、schema 构建库、validation 库、确定性数据处理库。
- 开放库不得拥有 transport/server lifecycle、日志、metric/trace、数据库连接、gateway/provider SDK、文件/进程/网络副作用或 workspace private path。
- 插件不得声明任意 npm package name；只能声明 inventory 中的稳定 id。
- 新增 host external 必须更新 inventory、SDK type、agent-app 注入实现、manifest validation 和 negative tests。

首版 host external inventory 精确如下：

| external id | host package | status | exposed surface | 说明 |
| --- | --- | --- | --- | --- |
| `typebox` | `@sinclair/typebox` | `OPEN` | `{ Type }` and type-only helpers | JSON schema / TypeBox schema 构建工具 |
| `ajv` | `ajv` | `OPEN` | `{ Ajv }` or framework-owned validator factory | JSON schema validation 工具 |

首版明确关闭：`fastify`、`pino`、`kysely`、`@opentelemetry/api`、所有 `agent-*` implementation package、gateway/provider SDK、HTTP/DB client、filesystem/shell helper 和任意 workspace private path。

### D3: 插件发现由 system config 显式声明，`agent-app` 启动期执行

`DefaultSystemConfig` 新增 plugin directory 配置：

```yaml
plugins:
  - pluginId: telecom-diagnostics
    path: plugins/telecom-diagnostics
    required: true
```

配置字段语义：

- `pluginId`：必须是 safe id，且与插件 export 的 `pluginId` 一致。
- `path`：必须是 `configRoot` 下的相对插件目录；目录必须包含 `plugin.json`；不得是 URL、绝对路径、parent traversal、glob、shell expression、zip/archive 文件或单独 module 文件。
- `required`：首版保留并实现，默认 `true`。`true` 表示加载或校验失败阻断 app readiness；`false` 表示插件不进入 registry，输出 safe degradation diagnostic，不影响未引用它的 Agent。若某 Agent 引用 optional 但加载失败的插件，该 Agent assembly 编译 fail closed。

`agent-app` 的插件发现流程只消费 system config 显式声明的 `plugins[]`。发现流程固定为：

1. 读取受信 system config 的 `plugins[]`。
2. 将每个 `path` 解析到 `configRoot` 下的插件目录，并校验仍位于 `configRoot` 内。
3. 读取并 schema-validate 该目录内的 `plugin.json`。
4. 校验 system config、`plugin.json` 和插件 export 的 `pluginId` 一致。
5. 校验 `plugin.json.main` 指向插件目录内的相对单文件 `.js` ESM bundle。
6. 校验 `plugin.json.hostExternals` 只引用 `HostExternalInventory` 中 `OPEN` 的工具库 id，且版本范围与宿主声明兼容。
7. 在 evaluate bundle 前静态扫描 main ESM bundle import specifier，拒绝 static import、re-export with `from`、string-literal dynamic import、bare package、host external package、closed package、workspace private path、Node builtin、URL、绝对路径、parent traversal、relative chunk import 或任何会触发宿主/插件 `node_modules` resolution 的残留 import。
8. 使用 `pathToFileURL(mainBundlePath).href` 执行 Node ESM dynamic import。
9. 如果 default export 是 plugin factory，则注入已校验的 `host.externals`；如果 default export 是 plugin object，则要求 `hostExternals` 为空。
10. 对插件对象执行 runtime shape validation，验证 plugin id、version、provider id、policy id、hook id、schema、required dependencies、hook definition、policy point id 和 safe description。

该 import 只发生在 app startup composition 阶段。启动完成后 request path 不再读取 plugin config、plugin manifest 或执行 dynamic import。

### D4: 插件 registry 和 AgentAssembly activation facts 分离

启动期形成两个只读结构：

- `PluginRegistrySnapshot`：app-owned 全局加载结果，保存所有合法插件 provider、policy implementation 和 hook object。
- `AgentAssembly` activation facts：当前 Agent 可用的 Tool 绑定继续由 `AgentAssembly.capabilityBindings` 承载；当前 Agent 激活的 policy binding 编译为 `AgentAssembly.policies`；插件 hook object 只作为 startup hook registry 候选，Agent-scoped hook activation 仍由 `AgentAssembly.hooks` 承载。

`PluginRegistrySnapshot` 是启动期加载事实。Tool 的授权依据是 frozen `AgentAssembly.capabilityBindings` 加 capability catalog governance；policy 的授权依据是 frozen `AgentAssembly.policies` 加 `agent-runtime` policy resolver；hook 的授权依据是 frozen `AgentAssembly.hooks` 加 startup hook registry materialized definitions/executables。

`AgentAssembly.policies` 保存 implementation-free binding facts。原因：

- 插件 activation 的 implementation handle 留在 runtime policy registry，public `AgentAssembly`、gateway record、stream 和 model context 只消费绑定事实。
- `AgentAssembly` 是 request acceptance 后的 frozen Agent Scope 事实，适合保存当前 Agent 选择了哪个 policy point / plugin id / policy id / config / timeout。
- runtime policy registry 可以用 `pluginId + policyId + policyPointId` 解析 implementation handle，core routing adapter 再用 accepted `agentAssemblyRef` 读取当前 assembly，满足恢复和 Agent Scope 约束。

### D5: Agent 配置按既有绑定和专用激活边界消费插件 provider/policy/hook

插件 Tool 通过 Agent 既有 `capabilityBindings` 激活：

```yaml
capabilityBindings:
  - capabilityId: parse-alarm-log
    capabilityType: TOOL
    providerId: telecom-diagnostics.alarm-tools
    enabled: true
    description: 解析网管告警日志，提取网元、告警码、级别和建议排障方向
```

`AgentDefinition` 新增顶层 `policies` 配置段，只用于开放 policy activation，并编译到 `AgentAssembly.policies`：

```yaml
policies:
  - policyPointId: agentRoutingPolicy
    pluginId: telecom-diagnostics
    policyId: telecom-routing-policy
    enabled: true
    timeoutMs: 1000
    config:
      routeMajorAlarmTo: ran-alarm-diagnosis
hooks:
  - hookId: telecom.terminal-safety
    enabled: true
    stages: [BEFORE_AGENT_TERMINAL]
    order:
      priority: 100
    timeoutMs: 1000
    config:
      strict: true
```

Agent `policies` 配置引用已加载插件中的 policy implementation，并可收窄 `enabled`、`config` 和 policy timeout。Tool 可见性、禁用和模型可见描述继续由 `capabilityBindings` 表达。对于插件 provider 下的 Tool，`capabilityBindings` entry 是正向 allow binding：entry 存在且 `enabled` 省略或为 `true` 时可见；entry 缺失或 `enabled=false` 时保持 unavailable。该语义不改变 builtin Tool 的既有 default-enabled / disabled binding override 行为。Lifecycle hook 启用由同级 `agent.yaml.hooks` 表达；hook object 被 plugin composition 注册进 startup hook registry 后，Agent 通过 `hookId` 声明 enabled/disabled、stage narrowing、order、timeout 和 config。Agent 配置的职责范围是引用已加载实现和声明 activation facts；Tool schema、execution mapping、policy point、hook implementation、plugin path、module path、script、remote call 和 DSL 均属于其它 owner 或非目标边界。

`AgentAssembly.policies` 的条目是冻结绑定事实，必须包含 `policyPointId`、`pluginId`、`policyId` 和 `enabled`，可包含 `timeoutMs?` 和 validated `config?`。Evaluator function、factory、module path、raw config、plugin directory 和其它 implementation handle 保留在 runtime policy registry 或 loader diagnostics 中。

`StartupAgentAssemblyCompiler` 校验 Agent activation，并输出：

- 原有 `AgentAssembly` 和 `AgentAssemblyRegistry`
- 带 `policies?: AgentPolicyActivation[]` 或等价字段的 `AgentAssembly` / `AgentAssemblyRegistry`
- external capability providers，作为 `createCapabilitySubsystem({ externalProviders })` 或等价 capability provider 输入；其中 plugin providers 来自已加载插件的 `providers[]`，memory-tools provider 来自 app-composed memory opt-in 投影，二者都不来自 Agent policy activation
- policy resolver 输入；执行时用 `AgentAssembly.policies` 中的 binding facts 查找 runtime policy registry 中的 implementation
- plugin hook objects，作为 startup hook registry already-composed input；hook 是否对 Agent 生效仍由 `AgentAssembly.hooks` 决定

### D6: CapabilityProvider 作为 capability 来源，插件声明 provider 进入主路径

本 change 同时修正 capability provider 命名：当前纯身份对象 `CapabilityProvider` 改为 `CapabilityProviderIdentity`；当前注册单元 `CapabilityProviderContribution` 改为 `CapabilityProvider`。新语义固定为：

- `CapabilityProviderIdentity`：纯身份，包含 `providerId`、`providerKind`、`providerType?`；descriptor、binding、diagnostic、安全投影只引用 identity。
- `CapabilityProvider`：capability 来源，由 `identity: CapabilityProviderIdentity`、`discovery: CapabilityDiscovery` 和可选 `executor: CapabilityExecutor` 组成。
- `CapabilityDiscovery.provider` / `CapabilityDescriptor.provider` 等字段改为引用 `CapabilityProviderIdentity`，并保持与 owning `CapabilityProvider.identity` 一致。

这个重命名必须覆盖所有现有 provider 注册来源，而不只覆盖插件。为开放 capability 发现和调用扩展，同时降低标准 Tool provider 的编写成本，本 change 将 `CapabilityProvider` 固定为 public capability SPI：

- `CapabilityProvider`：定义在 `agent-contracts/capability`，是插件、first-party module 和 capability subsystem 共同使用的 provider SPI；它可以携带自定义 discovery 和可选 executor。
- `DefineToolInput`：用于单 Tool authoring 糖；对齐当前 `agent-capability` 既有 `defineTool(...)` 的 public shape，输出 `ToolDefinition`，但不依赖 `agent-capability` implementation。
- `DefineToolProviderInput`：用于标准 Tool provider 糖；表达 required `providerId`、optional `providerType`、optional `description` 和 `tools: ToolDefinition[]`；discovery mode、executor、binding policy、default exposure 和 Agent activation 由高级 provider SPI、catalog 或 assembly 边界承载；插件侧使用该通用 shape 时还必须满足 plugin provider identity validation。
- `agent-plugin-sdk` 的 `defineCapabilityProvider(...)` 直接校验并返回 `CapabilityProvider`；`defineTool(...)` 使用 `DefineToolInput` 生成 `ToolDefinition`；`defineToolProvider(...)` 使用 `DefineToolProviderInput` 生成标准 `CapabilityProvider`，不依赖 `agent-capability`。
- `agent-capability` 负责接收 provider 后的 validation、normalization、guard wrapping 和 assembly：校验 descriptor projection、provider identity consistency、duplicate capability id、config override、required dependency、discovery result schema、executor lookup、timeout/cancellation、safe error 和 diagnostic。插件 loader、plugin activation、Agent binding policy、host external injection、memory opt-in 和 memory domain execution 语义分别归 `agent-app`、catalog filtering、loader 或 `agent-memory` owner。

当前 `agent-memory` 的 memory Tool 路径已经通过 `createMemoryToolsProviderContribution(...)` 生成 `memory-tools` provider identity、`EAGER` discovery，并由 `agent-app` 在 memory binding opt-in 满足后作为 `externalContributions` 传入 capability subsystem。实施本 change 时，该路径应同步迁移为 `createMemoryToolsProvider(...)` 或等价命名，直接返回 `CapabilityProvider`；`memoryToolsProvider` 自身降为 `CapabilityProviderIdentity`，`CapabilityDiscovery.provider` 和 memory Tool descriptor `provider` 继续引用同一个 identity。`agent-app` 在 memory opt-in 满足后把该 provider 交给 `agent-capability` validation/normalization/wrapping 后进入统一 subsystem。memory-specific 的三工具 opt-in、description override diagnostic、memory port execution、safe result budget 仍归 `agent-memory` 和 `agent-app` 现有治理，不进入 plugin SDK。

插件 authoring 不再使用 `contributes` wrapper。插件对象直接声明：

```ts
definePlugin({
  pluginId: "telecom-diagnostics",
  providers: [
    defineToolProvider({
      providerId: "telecom-diagnostics.alarm-tools",
      tools: [
        defineTool({
          name: "parse-alarm-log",
          description: "Parse telecom alarm logs.",
          inputSchema: parseAlarmLogInputSchema,
          outputSchema: parseAlarmLogOutputSchema,
          execute: async (input, options) => parseAlarmLog(input, options?.signal)
        })
      ]
    })
  ],
  policies: [defineAgentRoutingPolicy(...)],
  hooks: [defineLifecycleHook(...)]
});
```

`providers[]` 是插件的 capability 扩展入口。首版每个插件最多包含 4 个 capability provider。插件可以直接使用 `defineCapabilityProvider(...)` 贡献自定义 discovery/executor，也可以使用 `defineToolProvider(...)` 糖把 `ToolDefinition[]` 包装成标准 `CapabilityProvider`。`agent-app` 校验已加载插件的 provider 后，将其作为 external provider 输入交给 `agent-capability` 进入 validation/normalization/wrapping 和 capability assembly。首版只允许插件 provider 返回 `TOOL` descriptors；`SKILL`、`AGENT` / Subagent descriptors 作为 reserved provider surface，必须由后续 OpenSpec change 冻结 kind-specific governance 后才能开放。

自定义 provider 示例：

```ts
definePlugin({
  pluginId: "telecom-diagnostics",
  providers: [
    defineCapabilityProvider({
      identity: {
        providerId: "telecom-diagnostics.search-tools",
        providerKind: "CUSTOM",
        providerType: "nextagent-plugin-tool"
      },
      discovery: {
        provider: {
          providerId: "telecom-diagnostics.search-tools",
          providerKind: "CUSTOM",
          providerType: "nextagent-plugin-tool"
        },
        discoveryMode: "SEARCH",
        discover: async (query, context) => searchDomainTools(query, context)
      },
      executor: {
        execute: async (request, context) => executeDomainTool(request, context)
      }
    })
  ]
});
```

Plugin provider identity：

- `providerKind` 使用现有 `CUSTOM`。
- `providerType` 固定为 `nextagent-plugin-tool`。
- `providerId` 由插件作者显式声明，必须满足当前 Agent capability binding 的 safe id 校验，不引入冒号或其它需要 contract refinement 的 provider id vocabulary。

`agent-app` 不从 `pluginId` 推导 `providerId`，也不为插件 provider 自动生成隐含 provider id。首版同一 plugin 内最多 4 个 capability provider；每个 provider id 在 frozen plugin registry 中必须全局唯一，不得使用 framework reserved provider ids，例如 builtin providers、`memory-tools`、SkillHub provider ids 或 system/local Agent provider ids。同一 provider 内 capability id 必须唯一。跨 plugin provider conflict 继续由 capability conflict resolution 和 Agent binding filtering 处理。

Capability discovery 只回答“descriptor 从哪个 provider 来、何时可被 catalog 查询到”，不回答“当前 Agent 是否被授权使用”。`discoveryMode` 是既有 provider/discovery 属性：

- `EAGER`：startup composition 阶段即可投影 descriptor，catalog list/resolve 可直接在启动期 materialized descriptors 上过滤。适合 builtin Tool、builtin Skill、system local Skill、top-level Agent、memory-tools 被 app opt-in 注册后的 provider，以及 `defineToolProvider(...)` 生成的标准 plugin Tool provider。
- `SEARCH`：startup 只注册 provider/source，具体 capability descriptor 在当前 Agent scope 和 query 条件下延迟检索。适合 agent-owned local Skill、parent subagent 和 SkillHub 等数量可能较大或需要 scoped delayed search 的 source。

Discovery 结果必须继续进入同一个 capability catalog / resolver / invocation governance。`EAGER` 只表示 descriptor 已经 materialized，`SEARCH` 只表示 descriptor 延迟检索；当前 Agent 能否看到 descriptor 继续由 catalog 对 `AgentAssembly.capabilityBindings` 和既有 provider 规则的过滤决定。

插件 provider 的 `SEARCH` discovery 会在 request path 执行，因此 `agent-capability` wrapping 必须像治理 executor 一样治理 `discover` 调用本身：执行 timeout、cancellation、safe error mapping、safe diagnostic 和 discovery result validation。`EAGER` provider 的 startup descriptor 投影仍在启动期完成，但其 descriptor/result 也必须经过同一 validation/normalization 路径。

插件 provider 下的 Tool 使用显式 allow binding。Agent 必须声明既有 `capabilityBindings`，例如 `providerId=<plugin-authored-provider-id>`、`capabilityType=TOOL`、`capabilityId=<ToolDefinition.metadata.name>`；缺失 binding 或 disabled binding 由 catalog filtering 投影为不可见、不可 resolve、不可 invoke。

Catalog filtering 是 framework-owned 判定，不是首版用户配置项。它按 provider 统一处理 Tool、Skill 和 Agent capability，而不是只按 capability kind 判断。本 change 不新增一组可配置的 activation mode；启用逻辑只使用已有的 `AgentAssembly.capabilityBindings`、provider identity、discovery result、availability/model visibility filter 和 provider-owning module 的治理结果。

首版绑定策略收敛为三条规则：

1. 所有 provider 的 capability 可见性都必须经过 catalog binding filtering；`EAGER` 只表示 descriptor 已经可查询，`SEARCH` 只表示 descriptor 延迟检索，二者都不等于默认启用。
2. Binding 可以是精确 capability binding，也可以是已有 provider/condition selector。精确 binding 使用 `providerId + capabilityType + capabilityId` 决定具体 descriptor 是否可见、可 resolve、可 invoke；provider/condition selector 只授权 search source 是否可被搜索，例如 SkillHub。`enabled=false` 的精确 binding 始终可以覆盖默认暴露或过滤 search 结果中的对应 descriptor。
3. 系统默认暴露只作为 capability catalog 内部的 framework-owned allowlist 存在，用于保留当前 builtin/local 默认可见行为；默认暴露不写入 `AgentAssembly.capabilityBindings`，也不由 `agent-app` 或 assembly compiler 生成 synthetic binding。插件 provider、`memory-tools`、SkillHub、top-level Agent 和任何未知 CUSTOM/remote provider 不在默认暴露 allowlist 中，必须通过各自既有显式 binding、provider selector 或 opt-in 语义启用。

任何不在下表或 owning OpenSpec change 中明确声明绑定策略的新 provider kind / providerType 使用 fail-closed 默认策略：只有明确 catalog binding policy 后才获得 Agent-visible 行为。

| provider | capability kind | discoveryMode | binding 策略 | 无 matching binding / selector | matching binding / selector `enabled` 省略或 `true` | matching binding `enabled=false` |
| --- | --- | --- | --- | --- | --- | --- |
| `builtin-tools` | `TOOL` | `EAGER` | catalog 内部默认暴露 allowlist | 保持既有默认可见语义；不生成 assembly binding | 可见；可按已有 Tool config/description governance 收窄 | 禁用该 binding 覆盖的能力 |
| `memory-tools` | `TOOL` | opt-in 后 app-composed `EAGER` provider | memory tool enabled binding opt-in | 不注册或不可见，保持既有 memory opt-in 语义 | 三个 memory tools 均 enabled binding 时 app composition 注册 provider，并对当前 Agent 可见 | 不注册或不可见 |
| `builtin-skills` | `SKILL` | `EAGER` | catalog 内部默认暴露 allowlist | 保持既有默认可见语义；不生成 assembly binding | 可见；不改变既有 Skill governance | 禁用该 binding 覆盖的能力 |
| `local-skills-system` | `SKILL` | `EAGER` | catalog 内部默认暴露 allowlist | 保持既有系统本地 Skill 默认可见语义；不生成 assembly binding | 可见；不改变既有 local Skill governance | 禁用该 binding 覆盖的能力 |
| `local-skills-agent-owned` | `SKILL` | `SEARCH` | accepted Agent scope 内默认 search/可见 | 当前 Agent owned Skill 在 accepted Agent scope 内默认 search/可见；不生成 assembly binding | 可见；binding 不是启用前提 | 禁用该 binding 覆盖的能力 |
| `local-subagents` | `AGENT` | `SEARCH` | accepted parent scope 内默认 search/可见 | 当前 parent Agent 的 subagent 在 accepted parent scope 内默认 search/可见；不生成 assembly binding | 可见；binding 不是启用前提 | 禁用该 binding 覆盖的能力 |
| `builtin-agents` / `local-agents` | `AGENT` | `EAGER` | 精确 capability binding | 不可见、不可 resolve、不可 invoke | 对当前 Agent 可见、可 resolve、可 invoke | 不可见、不可 resolve、不可 invoke |
| `SKILL_HUB` provider | `SKILL` | `SEARCH` | provider/condition selector 授权 search | provider 不被当前 Agent binding 授权，不搜索该 provider | provider 被授权并可 search；可见结果继续受 SkillHub governance 和 conflict resolution 约束 | 若只有 disabled binding 则 provider 不被授权；exact disabled binding 可过滤对应 Skill |
| plugin provider `<plugin-authored-provider-id>` / `providerType=nextagent-plugin-tool` | `TOOL` | `EAGER` 或 `SEARCH` | 精确 capability binding 或 provider/condition selector | 不可见、不可 search、不可 resolve、不可 invoke | `EAGER` exact binding 对当前 Agent 可见、可 resolve、可 invoke；`SEARCH` provider/condition selector 授权该 provider search，返回结果继续受 Tool descriptor validation、conflict resolution、availability/model visibility 和 exact disabled binding 过滤 | 不可见、不可 search、不可 resolve、不可 invoke |

这个判定发生在 capability catalog / resolver 的 Agent binding filtering 层。plugin loader 负责校验和加载插件；`CapabilityProvider` 表达 capability 来源、发现和可选调用能力；`agent-capability` 负责 provider validation/normalization/wrapping 和 assembly；catalog filtering 按当前 accepted `AgentAssembly.capabilityBindings` 和既有 provider 规则决定是否暴露。Loaded plugin registry membership 只表示启动期加载事实，plugin provider 下的 Tool 保持独立 provider identity。

同形同策约束：如果后续 change 要让插件 provider 返回 Skill 或 Subagent/Agent descriptors，必须先定义该 capability kind 的 plugin provider governance，并明确它通过哪个 provider identity、哪个 `discoveryMode` 和哪种 binding 策略接入既有 catalog filtering。插件 provider 可以按需要选择 `EAGER` 或 `SEARCH` discovery，但默认必须要求显式 binding 或定义更严格的 provider/condition selector；不得因为 builtin/system Skill、local agent-owned Skill 或 parent subagent 当前默认可见，就让插件 Skill/Subagent 自动对所有 Agent 或 parent scope 生效。`memory-tools` 证明 app-composed provider 即使通过外部 provider 输入接入，也可以并且应当要求 enabled binding opt-in，而不是继承 builtin Tool 的默认可见语义。实施本 change 时，memory-tools 的 opt-in 判断仍由 `agent-app` 根据当前 Agent assembly 的 memory bindings 完成；provider 注册 shape 跟随 `CapabilityProvider` 命名与通用 authoring helper 调整，但不得把 memory-tools 改成 builtin default-enabled provider，不得让 `agent-memory` 依赖 `agent-plugin-sdk`，也不得把 memory opt-in 搬进 plugin `plugins[]` activation。

### D7: 开放 policy 清单是 framework-owned inventory

开放 policy 清单由 `agent-app` plugin subsystem 中的 framework-owned constant 提供，首版不可由插件或 Agent 配置扩展。清单项使用二次开发者可理解的业务 policy id，而不是底层 TypeScript interface 名称。清单项状态只包含：

- `OPEN`：当前 change 允许插件实现并由 Agent 激活。
- `RESERVED`：已作为二次开发扩展点保留，但必须等 owning OpenSpec change 冻结 contract 后才能启用。

首版清单如下：

| policy point id | status | owner | contract | 触发边界 | 插件失败语义 |
| --- | --- | --- | --- | --- | --- |
| `restrictedOperationPolicy` | `RESERVED` | `agent-runtime` | 由后续 risk policy plugin OpenSpec change 冻结 | 受限操作执行前，包括 capability invocation、sandbox dynamic execution 和 authorization/high-risk confirmation 的 risk policy enforcement 边界 | 不允许插件激活 |
| `agentRoutingPolicy` | `OPEN` | `agent-core` | existing core `AgentRoutingPolicy.decide(RequestRun, RequestContext, AbortSignal)` / `AgentRoutingPolicyResult`; result aligns with `agent-contracts/core.AgentRoutingDecision` | 请求进入 Agent 后选择模型循环、定向 Skill/Workflow、澄清、拒绝或人机接管等处理路径 | fail closed to safe routing rejection |
| `modelSelectionPolicy` | `RESERVED` | `agent-core` / `agent-model` | 由后续 model selection OpenSpec change 冻结 | 在当前 Agent 可用 model profiles 中选择本次模型调用使用的 profile | 不允许插件激活 |
| `modelFallbackPolicy` | `RESERVED` | `agent-model` 或模型调用 orchestration owner | 由后续 model fallback OpenSpec change 冻结 | 模型调用失败、超时、限流或不可用后决定是否 fallback 及 fallback 目标 | 不允许插件激活 |
| `contextWindowPolicy` | `RESERVED` | `agent-context-engine` | 由后续 context window OpenSpec change 冻结 | 在模型上下文窗口内分配 history、attachment、Skill disclosure、system prompt、summary 等预算 | 不允许插件激活 |

关闭清单同样固定：`redactionPolicy`、`promptAssemblyPolicy`、`capabilityConflictResolutionPolicy`、`observabilityProjectionPolicy`、`authorizationAnswerPolicy`、`gatewayRetryPolicy` 都不是本 change 的开放 point。

`agent-plugin-sdk` 暴露与该清单同源的 plugin-facing policy authoring surface：`OPEN_POLICY_INVENTORY` / 等价 metadata、`defineAgentRoutingPolicy(...)`、`AgentRoutingPolicy`、`AgentRoutingPolicyExecutable` 和 `AgentRoutingPolicyResult`。这些 SDK export 只服务插件 authoring 和类型约束；实际 policy point inventory enforcement 和 Agent activation 编译仍由 `agent-app` owning，policy resolver contract 由 `agent-contracts/runtime` owning，registry/resolver implementation 由 `agent-runtime` owning，`agentRoutingPolicy` evaluator selection/execution adapter 由 `agent-core` owning。SDK 可以把 `RESERVED` policy point 暴露为不可激活 metadata，但不得提供 `defineRestrictedOperationPolicy(...)`、`defineModelSelectionPolicy(...)`、`defineModelFallbackPolicy(...)` 或 `defineContextWindowPolicy(...)` 等 RESERVED implementation helper。

Policy implementation shape 必须包含：

- `policyPointId`
- `policyId`
- `description`
- `configSchema?`
- `configure?`
- executable implementation，类型必须满足该 policy point 的固定 contract

Agent `policies` 对同一个 `policyPointId` 只能选择一个 enabled policy implementation。重复选择同一 policy point 必须 fail closed。任何 `RESERVED` 或未知 policy point 的 plugin policy 或 activation 都必须 fail closed。`AgentAssembly.policies` 是该选择的唯一 runtime-facing activation fact。

`agentRoutingPolicy` 的执行接入必须保持 Agent Core routing owner 不变。插件 routing policy 复用存量 core routing policy 的 `decide(run: RequestRun, context: RequestContext, signal: AbortSignal)` 形状；`acceptedInputText` 与当前代码基线中 routing policy 消费的 `RequestContext.acceptedInputText` 同名同语义，由 core routing adapter 透传，不在插件 wrapper 中做额外 summary、redaction、truncation 或字段投影。输入边界如需收紧，必须在 routing 业务 contract 中统一调整，并同时适用于内置 policy 和插件 policy。

`AgentRoutingPolicyResult` 直接对齐 `agent-contracts/core.AgentRoutingDecision`：`kind`、`safeReason`、`evidenceRef?`、`skillName?`，其中 `kind` 使用已冻结 `RoutingDecisionKind`。本 change 不为插件 evaluator 增加 result 字段；`agent-core` 当前内部 routing decision 所需的 accepted assembly materialization、recipe/workflow implementation 字段等继续保留在 core/wrapper 内部。

`agent-runtime` 在 startup composition 输入中接收 frozen plugin policy contributions，并 materialize 通用 policy registry/resolver。它与 hook registry 同型的是 startup/assembly-scoped materialization 和按 accepted Agent scope 查询的机制，不是执行接口形状：startup policy implementation 生成默认 executable；带 `config` 的 `AgentAssembly.policies` activation 会先通过 `configSchema` 校验，再调用 `configure(config)` 生成 assembly-specific executable，并按 `agentAssemblyRef + policyPointId + pluginId + policyId` 保存。policy activation 引用缺失、同一 policy point 重复 enabled、config 非法或 implementation/executable 不可用，都必须在插件加载、Agent assembly 编译或 registry materialization 阶段失败，不进入 request 执行态。resolver 的输入是 accepted Agent scope facts（`agentId`、`agentVersion`、`agentAssemblyRef`）和 `policyPointId`；resolver 读取 accepted `AgentAssembly`、校验 assembly ref、从 `AgentAssembly.policies` 选择该 policy point 的 enabled binding，再优先从 assembly-specific executable map 解析 executable，缺省回到 startup executable。对单个 policy point，resolver 在存在 enabled binding 时返回已解析 policy entry；没有激活项时返回 `undefined`。这个 resolver 是插件 policy 的统一容器和查询机制，通过 `AgentPolicyExecutableByPoint` 枚举 supported policy point 到各自 executable 类型；每个 policy point 的 owner 在执行前提供自己的 typed adapter。本 change 只执行 `agentRoutingPolicy` 这个 `OPEN` point，`RESERVED` points 仍不可激活。

`agent-core` 提供 Agent-scoped routing policy adapter，并通过 core runtime dependency 接收 app-composed policy resolver。adapter 不直接捕获某个全局插件 evaluator，而是调用 policy resolver 解析当前 accepted Agent 的 `agentRoutingPolicy` evaluator；存在 enabled 插件 binding 时，adapter 先执行插件 evaluator，不得先调用系统内置 routing policy；`AgentAssembly.policies` 缺失、为空、没有 enabled `agentRoutingPolicy` binding，或 Agent 未配置 `policies` 时，adapter 委托系统内置 routing policy。routing adapter 不定义 unavailable plugin policy 运行态；activation 或 registry materialization 问题必须在装配或物化阶段失败。只有插件 evaluator 执行过程中的 throw、timeout 或 invalid result 会在 routing 业务边界 fail closed to safe routing rejection。不得把插件 evaluator 作为全局 app-wide routing policy 直接替换，也不得让 capability、model 或 channel 读取 plugin registry、Agent config 或 plugin path；`agent-app` 只负责在 composition root 中把 runtime policy resolver 注入 `agent-core`。

### D8: Hook 插件声明 LifecycleHook object，由完整 hook registry 执行

插件 `hooks[]` 包含 `LifecycleHook` object。

`agent-app` 在 startup plugin composition 中校验 hook implementation object：

- hook object 必须由 `agent-plugin-sdk` 的 `defineLifecycleHook(...)` 生成并满足完整 hook contract；
- `hookId` 必须是插件声明的稳定 hook id；
- `supportedStages` 必须来自完整 hook stage vocabulary；
- effects、failureMode、system order、configSchema、configure 和 execute 必须满足完整 hook registry validation；
- 不允许插件把 risk policy enforcement 注册为 hook
- 不允许 hook object 定义非 TypeScript runtime、script path、remote handler 或 shell command

`agent-runtime` 不加载插件，也不读取 plugin registry。runtime 接收完整 hook registry materialized 后的 definitions、configured executables 和 frozen `AgentAssembly.hooks`。插件 hook 是否对某个 Agent 生效只由该 Agent 的 `agent.yaml.hooks` / `AgentAssembly.hooks` 决定。

### D9: Safe diagnostics 和 observability

插件相关 diagnostic 统一分为三类：

- startup plugin diagnostic：目录加载、manifest、main bundle export、provider/policy/hook shape。
- Agent activation diagnostic：Agent 配置引用、policy point、hook stage、Tool binding。
- execution diagnostic：插件 Tool/policy/hook 的 safe failure、timeout、invalid result。

所有 diagnostic 只允许 stable refs 和 safe summary：plugin id、provider id、policy id、policy point id、hook id、capability id、agent id、agent version、agentAssemblyRef、safe reason code、bounded summary、低基数 outcome。

禁止输出本地绝对路径、raw config、secret、credential、prompt、model output、tool args/result、raw provider response、stack trace 和高基数字段。

## 简化设计检查（KISS）

| 检查项 | 结论 |
|---|---|
| 现有事实是否足够 | Tool SPI、capability catalog、memory-tools app-composed provider、hook contract、Agent assembly ref 都可复用。不足是缺少开发者代码的启动期加载、校验、Agent-scoped policy activation owner、通用 policy registry/resolver 和 routing typed adapter，capability provider 命名需要从 contribution/provider 双概念收敛为 identity/provider，并需要把 `CapabilityProvider` 固定为 public SPI，让插件可自定义 discovery/executor，同时由 `agent-capability` 统一 validation/normalization/wrapping。 |
| 真实消费者 | `agent-app` 消费 system plugin config、Agent `policies` / `AgentAssembly.policies`、plugin hook registry input，并把插件 `providers[]` 装配为 capability providers、把插件 `policies[]` 传给 `agent-runtime` policy resolver；`agent-capability` 消费 plugin provider discovery/executor facts 并继续用 `AgentAssembly.capabilityBindings` 过滤；`agent-core` 消费 injected policy resolver 并在 routing path 内使用 Agent-scoped routing typed adapter；`agent-runtime` 消费 frozen `AgentAssembly.hooks` 并提供 policy resolver；`agent-observability` 消费 safe diagnostics。 |
| 最小改动路径 | 新增 public `CapabilityProvider` SPI / `DefineToolInput` / `DefineToolProviderInput`、plugin SDK、system-config-driven directory loader、plugin registry、`AgentAssembly.policies` 编译、runtime policy registry/resolver、core routing typed adapter 和 provider validation/wrapping adapter；同步把现有 external contribution 输入和 memory-tools 注册路径改为 external `CapabilityProvider` 输入；hook 只贡献 `LifecycleHook` object 给完整 hook registry，不改写 capability、hook、risk policy 主路径。 |
| 新对象必要性 | `PluginRegistrySnapshot` 保存启动期合法 plugin provider/policy/hook；`AgentAssembly.policies` 保存 Agent-scoped policy binding facts；`OpenPolicyInventory` 固定开放 policy 清单；`CapabilityProviderIdentity` / `CapabilityProvider` 命名修正复用并开放现有 capability subsystem provider SPI。`DefineToolInput` 和 `DefineToolProviderInput` 只是糖接口入参，不新增启用概念。这些对象解决加载、发现/执行、授权和 policy 白名单四个不同问题。 |

### D10: `agent-test-kit` 提供插件逻辑测试 harness

`@nextagent/agent-test-kit` 扩展一个 test-only helper：`createPluginTestHarness(plugin, options)`。它面向插件开发者的 npm test 阶段，用来直接验证已导入插件对象中的 Tool、开放 policy 和 lifecycle hook 逻辑。该 harness 不启动 `createComposedApp`，不读取 system config / `plugin.json`，不执行 dynamic import，不做 bundle import specifier 静态扫描，不解析 host external 版本，也不冻结 app plugin registry。

建议 public API：

```ts
import { createPluginTestHarness } from "@nextagent/agent-test-kit";
import { myPlugin } from "../src/index.js";

const harness = createPluginTestHarness(myPlugin, {
  toolDependencies: {
    // test-only Tool dependency doubles
  }
});

const result = await harness.invokeTool(
  "telecom-diagnostics.alarm-tools",
  "parse-alarm-log",
  { alarmLog: "..." }
);
```

最小接口：

```ts
interface PluginTestHarnessOptions {
  toolDependencies?: Partial<ToolDependencies>;
  defaultAgentScope?: {
    agentId: AgentId;
    agentVersion: AgentVersion;
    agentAssemblyRef: string;
  };
}

interface PluginTestHarness {
  invokeTool(providerId: string, capabilityId: string, input: JsonObject): Promise<CapabilityInvocationResult>;
  evaluateAgentRoutingPolicy(policyId: string, run: RequestRun, context: RequestContext): Promise<AgentRoutingPolicyResult>;
  executeHook(hookId: string, input: HookInput): Promise<HookResult>;
}
```

接口语义：

- harness 只消费 already materialized `NextAgentPlugin` object。开发者可以从源码直接 import `myPlugin`，绕过 bundler/loader，只测试 plugin object 的业务逻辑。
- `invokeTool(...)` 使用显式 `providerId + capabilityId` 定位插件 provider 下的 Tool，并把 `toolDependencies` 注入到 Tool 执行路径；未匹配 provider/tool 或缺失必需 dependency 时以 test failure / safe error 表达。
- `evaluateAgentRoutingPolicy(...)` 使用显式 `policyId` 调用插件声明的 `agentRoutingPolicy` executable。调用方传入与 core routing policy 一致的 `RequestRun` / `RequestContext`，harness 不读取 prompt、model output 或 app registry。
- `executeHook(...)` 使用显式 `hookId` 调用插件声明的 lifecycle hook object，并使用 public hook input/output contract。
- harness 可依赖 `agent-common`、public `agent-contracts` subpaths、`agent-plugin-sdk` public types 和 test-only utility；不得依赖 `agent-app` loader、gateway/platform、filesystem/shell/network helper、provider SDK 或 implementation private path。

该 harness 不验证部署有效性。通过 harness 只能说明插件对象逻辑可被直接调用；是否可被 `agent-app` 加载、manifest 是否合法、bundle 是否单文件自包含、host external 是否兼容、Agent activation 是否正确、provider 是否进入 capability catalog、policy wrapper / hook registry 是否接入主路径，仍由本 change 的 loader、activation、capability、policy、hook 和 architecture tests 覆盖。

### D11: `create-nextagent-plugin` 脚手架降低插件构建摩擦

`@nextagent/agent-plugin-sdk/scaffold` 是 dev-only entry point，承载 `create-nextagent-plugin` CLI 的实现和可复用 scaffold API。它解决的黑盒问题是：插件开发者不需要先理解 bundler、single-file ESM、inline sourcemap、manifest 和基础测试 wiring，才能写第一个插件。

命令形态：

```bash
npx create-nextagent-plugin my-plugin
```

实现归属：

- CLI command：`create-nextagent-plugin`
- SDK dev-only subpath：`@nextagent/agent-plugin-sdk/scaffold`
- package ownership：仍在 `@nextagent/agent-plugin-sdk`，不新增 runtime package，不让 `agent-app`、`agent-runtime`、`agent-core`、`agent-capability` 依赖 scaffold

生成目录：

```text
my-plugin/
  package.json
  tsconfig.json
  esbuild.config.ts
  src/
    index.ts
  plugin.json
  tests/
    plugin.test.ts
```

模板约束：

- `package.json` 包含 `@nextagent/agent-plugin-sdk`、`typescript`、`esbuild`、`vitest` 等开发依赖和 `build` / `test` scripts。
- `esbuild.config.ts` 固定输出 ESM、single-file bundle、inline sourcemap，并默认把第三方依赖打包进 bundle。
- `src/index.ts` 使用 `definePlugin(...)` 作为默认模板，可包含一个 `defineTool(...)` + `defineToolProvider(...)` 的最小 Tool 示例。
- `plugin.json` 与生成的 plugin id、version、main bundle path、`artifactType=esm-bundle` 对齐，默认不声明 `hostExternals`。
- `tests/plugin.test.ts` 使用 `getPluginMetadata(...)` 校验插件对象 shape，例如 plugin id、provider id、Tool id、policy id 或 hook id；该测试不读取 manifest，不执行 bundle，不替代 loader validation。
- README 或 package scripts 指导开发者执行 `npm run build`，再把 dist 输出和 `plugin.json` 复制到 `configRoot/plugins/<pluginId>/`。

脚手架默认文档必须优先展示 direct bundle path。Factory 注入只作为优化章节出现：当多个插件共享 `typebox` / `ajv` 且需要与宿主版本一致时，开发者可改用 `definePluginFactory(...)` 和 `hostExternals`。脚手架生成物不得默认使用 `hostExternals`，不得生成 `AgentAssembly`、Agent `capabilityBindings`、Agent `policies`、system config `plugins[]` 或任何 runtime registry artifact。

`@nextagent/agent-plugin-sdk/scaffold` 可以使用 Node 文件系统 API 写入目标目录，但该依赖只存在于 dev-only scaffold subpath；SDK root authoring helper 和 runtime-facing packages 不得因此获得 filesystem/shell/network 权限。Architecture tests 需要确认 scaffold subpath 与 root SDK exports 的依赖边界分离。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 插件只从 system config 显式声明的 `configRoot` 下本地插件目录启动期加载；插件运行时 artifact 必须是自包含 ESM bundle，唯一例外是 host external inventory 中的工具库注入；运行期输入不能触发加载；plugin provider 首版只允许返回 `TOOL` descriptors，可选择 `EAGER` 或 `SEARCH` discovery，但只按 `AgentAssembly.capabilityBindings` 正向绑定/selector 生效；现有 memory-tools、SkillHub、Skill/Subagent discovery/filtering 不被插件机制扩大；policy 只按 `AgentAssembly.policies` 生效，hook 只按 `AgentAssembly.hooks` 生效；policy 只允许开放清单；diagnostics 只输出 safe refs。 | config/directory/manifest/host external negative tests、Agent scope tests、policy allowlist tests、security diagnostics tests、architecture tests |
| 性能/容量 | 插件 import、manifest/schema 校验和 activation 编译只发生在启动期；request path 只查 frozen registry map。首版不定义大规模插件容量 SLA。 | startup unit tests、request path characterization tests |
| 可靠性/恢复 | accepted request 使用 `agentAssemblyRef` 绑定 Tool binding、`AgentAssembly.policies` 和 `AgentAssembly.hooks` snapshot；插件加载失败按 required/optional 和 Agent 引用关系 fail closed；routing policy 插件失败 fail closed to safe routing rejection。 | assembly fail-closed tests、runtime recovery characterization、policy failure tests |
| 可维护性 | provider SPI、`DefineToolInput` 和 `DefineToolProviderInput` shape 由 `agent-contracts/capability` 拥有；provider validation/normalization/wrapping 由 `agent-capability` 实现；SDK 暴露 `defineCapabilityProvider(...)` 高级路径、`defineTool(...)` 和 `defineToolProvider(...)` 糖且不依赖 `agent-capability`；`agent-app` 是加载 owner；capability/runtime/core 不读插件路径；开放 policy 清单集中定义；scaffold 只存在于 SDK dev-only subpath。 | dependency-cruiser/architecture tests、module boundary review |
| 可测试性 | plugin loader、manifest validator、activation compiler、Tool discovery adapter、policy resolver、hook port adapter 都可用 fixture plugin 测试；`agent-test-kit` 提供直接消费插件对象的 test-only harness，帮助插件开发者在不启动 `createComposedApp`、不部署到 `agent-app` 的情况下测试 Tool、`agentRoutingPolicy` 和 hook 逻辑；scaffold 生成项目自带 metadata shape test。 | unit、contract、integration tests；agent-test-kit harness tests；scaffold generation tests |
| 审计/可追溯性 | startup、activation、execution diagnostic 都带 plugin/provider/policy/hook/agent stable refs；hook/policy/Tool 仍走既有 observability surface。 | structured log/audit/metric projection tests、safe field assertions |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 插件只在启动期从受信本地配置声明的插件目录加载，host external 只通过白名单注入 | T1.1, T1.2, T1.3, T2.1 | plugin config/directory/manifest/host external/loader unit tests；architecture forbidden dynamic load tests |
| 插件加载和 Agent 激活分离 | T1.2, T2.2, T2.3, T3.2 | Agent activation tests |
| 未绑定/未激活 Agent 不可见、不可 resolve、不可 invoke 插件贡献 | T3.4, T4.3, T5.2 | capability list/resolve/invoke integration tests；policy activation tests |
| 插件 provider 进入 capability discovery/catalog 主路径，且首版 plugin provider 只返回 `TOOL` descriptors、可选择 `EAGER` 或 `SEARCH` discovery、并由 `capabilityBindings` 显式 binding/selector 允许；现有 memory-tools 同步迁移到 runtime `CapabilityProvider` shape，但 opt-in/filtering 不变；SkillHub、Skill/Subagent discovery/filtering 不变 | T4.1, T4.2, T4.3, T4.4 | provider SPI contract tests；capability provider validation/wrapping tests；capability catalog/invocation tests；discovery/binding filtering regression tests；memory-tools/SkillHub/Skill/Subagent regression tests |
| 首版开放 policy 清单包含 5 个业务 policy id，且只有 `agentRoutingPolicy` 为 `OPEN` | T1.5, T5.1, T5.4 | policy inventory tests；reserved/unknown policy point negative tests |
| policy 插件失败 fail closed to safe routing rejection，且按 accepted `AgentAssembly.policies` 选择 activation | T5.2 | policy timeout/throw/invalid result tests；routing policy shape contract tests |
| hook 插件复用完整 lifecycle hook execution semantics | T0.1, T5.3, T5.4 | lifecycle hook plugin object/stage/effects/outcome/order/failure tests |
| 插件开发者可在不部署到 app 的情况下测试已导入插件对象逻辑，且 harness 不替代 loader/activation/主路径验证 | T6.5, T6.6 | agent-test-kit plugin harness tests；developer guide examples |
| 插件开发者可通过 CLI 生成默认 direct-bundle 项目，且 scaffold 不进入 runtime loading/activation path | T1.1, T6.5, T6.7 | SDK scaffold tests；generated template smoke tests；architecture dependency boundary tests |
| runtime/core/capability 不加载插件代码 | T2.4, T6.2 | architecture tests/review |
| safe diagnostics 不泄漏敏感信息 | T6.1 | security diagnostics tests |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/agent-scoped-plugin-composition/spec.md` 主承载插件加载、开放 policy 清单、Agent activation、provider/policy/hook 和 safe diagnostics 行为。
- 开发者指南：`docs/developer/agent-plugins.md` 或等价开发者文档主承载智能体二次开发者视角的 `create-nextagent-plugin` 快速开始、插件目录结构、`plugin.json`、ESM bundle 构建方式、默认直接打包依赖并使用 `definePlugin(...)`、host external / factory 作为优化路径、`providers[]` / `policies[]` / `hooks[]` authoring 示例、`defineCapabilityProvider(...)` 高级 provider SPI、`defineTool(...)` / `defineToolProvider(...)` 糖、`defineAgentRoutingPolicy(...)` 示例、`agent-test-kit` plugin harness 示例、Agent Tool 绑定示例、Agent policy/hook 激活示例、故障诊断和禁止事项。该指南不得定义新行为，只能解释本 change 和归档后基线规格中已经冻结的 contract。
- 架构和跨模块设计：`openspec/designs/architecture/capability-spi.md` 主承载 `CapabilityProviderIdentity`、public `CapabilityProvider` SPI、`DefineToolInput`、`DefineToolProviderInput`、provider validation/normalization/wrapping、`EAGER`/`SEARCH` discovery mode、`capabilityBindings` filtering，以及插件 provider 进入 capability 主路径；`openspec/designs/architecture/security-and-governance.md` 主承载开放 policy 清单和 Agent Scope 隔离。
- 模块设计：`openspec/designs/modules/agent-plugin-sdk.md` 主承载 SDK authoring helper、provider/policy/hook public surface、open policy inventory type exposure、host external type exposure、scaffold dev-only subpath 和 workspace dependency boundary；`openspec/designs/modules/agent-app.md` 主承载 plugin loader、registry、activation compiler 和 composition wiring；`openspec/designs/modules/agent-capability.md` 主承载 plugin provider adapter；`openspec/designs/modules/agent-core.md` 主承载 `agentRoutingPolicy` 消费边界和 routing typed adapter；`openspec/designs/modules/agent-runtime.md` 主承载 frozen hook activation 消费边界和 policy registry/resolver implementation；`openspec/designs/modules/agent-test-kit.md` 主承载 plugin test harness 的 test-only 边界。
- ADR：`openspec/designs/adr/agent-scoped-startup-plugin-composition.md` 记录启动期本地 TypeScript composition 的取舍。
- 导航：`openspec/designs/spec-to-design-map.md` 增加 `agent-scoped-plugin-composition` 映射。

## 风险与取舍（Risks / Trade-offs）

- [风险] 插件代码运行在宿主 Node 进程，可能被误解为 sandbox。 -> 明确插件是部署可信代码；动态执行仍必须走 sandbox gateway；插件机制不接收模型生成代码或远端下载代码。
- [风险] 插件依赖管理膨胀为 app 内置包管理器。 -> 首版只支持 ESM bundle 加受控 host external 工具库白名单；`agent-app` 不执行安装、不解析插件私有 `node_modules`、不加载 zip/archive。
- [风险] host external 被误用为宿主内部依赖共享。 -> 只开放 framework-owned 工具库 inventory；插件通过 factory 参数拿 injected object，不通过 Node ESM resolution import 宿主 `node_modules`；transport、logging、persistence、observability、gateway/provider SDK 和 workspace private path 均关闭。
- [风险] policy 扩展面过大。 -> 首版清单虽然列出 5 个二次开发者需要的 policy point，但只有 `agentRoutingPolicy` 为 `OPEN`；其它均为 `RESERVED`，新增可激活 policy point 必须走后续 OpenSpec change。
- [风险] public SDK 增加长期兼容负担。 -> SDK 只放 authoring helper 和 stable type re-export，不暴露 loader、registry、runtime internals。
- [风险] plugin provider 与 builtin/custom provider 发生冲突。 -> 继续使用 capability conflict resolution 和 Agent binding filtering，不新增并行优先级规则；plugin provider 不进入 builtin default set，未绑定时不参与当前 Agent 的可见候选。
- [风险] 多 Agent 场景下插件全局加载导致误生效。 -> 加载 registry 不作为授权依据，Tool 只有 `AgentAssembly.capabilityBindings` 按 `agentAssemblyRef` 生效，policy 只有 `AgentAssembly.policies` 按 `agentAssemblyRef` 生效，hook 只有 `AgentAssembly.hooks` 按 `agentAssemblyRef` 生效。

## 迁移计划（Migration Plan）

无数据迁移。默认配置不声明 plugins 时，系统行为保持不变：没有插件加载，没有插件 provider，没有插件 policy replacement，没有插件 hook activation。

发布和回滚策略：

1. 先实现配置 schema 和 directory/manifest loader，默认空配置。
2. 再接入 Agent activation 和 plugin provider discovery/binding matrix，未配置插件时测试必须证明现有 builtin/local/SkillHub capability 行为不变。
3. 再接入 policy resolver 和 hook registry，未激活插件时继续使用现有系统内置 routing policy 和 lifecycle hook behavior。
4. 回滚时移除 plugins 配置并重启；没有持久化 schema 需要迁移。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/agent-scoped-plugin-composition/spec.md`：提炼本 change 的全部长期行为契约。
- `openspec/overview.md`：补充受控 Agent-scoped startup plugin composition 已进入 capability/governance 基线，并保留动态加载、热加载、远端分发、marketplace 非目标。
- `openspec/designs/architecture/capability-spi.md`：提炼 `CapabilityProviderIdentity`、public `CapabilityProvider` SPI、`DefineToolInput`、`DefineToolProviderInput`、provider validation/normalization/wrapping、`EAGER`/`SEARCH` discovery mode、`capabilityBindings` filtering，以及插件 provider 如何进入 capability catalog。
- `openspec/designs/architecture/security-and-governance.md`：提炼开放 policy 清单、policy replacement 限制和 Agent Scope 隔离。
- `openspec/designs/modules/agent-plugin-sdk.md`：新增或更新，提炼 SDK authoring helper、`getPluginMetadata(...)`、provider/policy/hook public surface、开放 policy inventory type exposure、host external type exposure、`@nextagent/agent-plugin-sdk/scaffold` dev-only subpath、`create-nextagent-plugin` CLI、workspace package boundary 和禁止依赖 implementation package 的架构约束。
- `openspec/designs/modules/agent-app.md`：提炼 plugin config、loader、registry snapshot、activation compiler、safe diagnostics owner。
- `openspec/designs/modules/agent-capability.md`：提炼 provider identity rename、provider registration shape 和 plugin provider adapter。
- `openspec/designs/modules/agent-core.md`：提炼 Agent-scoped `agentRoutingPolicy` wrapper 和 accepted `agentAssemblyRef` 消费边界。
- `openspec/designs/modules/agent-runtime.md`：提炼 frozen hook activation 消费边界。
- `openspec/designs/modules/agent-test-kit.md`：提炼 `createPluginTestHarness(...)` test-only helper、public contract dependency boundary、直接插件对象测试能力和不替代 app loader/activation/main path 验证的限制。
- `openspec/designs/adr/agent-scoped-startup-plugin-composition.md`：提炼启动期本地 TypeScript 插件 composition 取舍。
- `openspec/designs/spec-to-design-map.md`：补充 spec 到 architecture/modules/ADR/验证入口映射。

## 待确认问题（Open Questions）

无。首版开放 policy 清单固定为 5 个业务 policy id，只有 `agentRoutingPolicy` 为 `OPEN`；`restrictedOperationPolicy`、`modelSelectionPolicy`、`modelFallbackPolicy` 和 `contextWindowPolicy` 为 `RESERVED`，不得在本 change 中激活。
