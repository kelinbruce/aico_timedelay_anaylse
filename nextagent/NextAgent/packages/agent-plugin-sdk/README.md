# @nextagent/agent-plugin-sdk

## 职责

- 为智能体二次开发者提供本地 TypeScript 插件 authoring helper。
- 导出插件 provider、Tool、开放 policy、lifecycle hook 和 host external inventory 的稳定 public surface。
- 通过 `@nextagent/agent-plugin-sdk/scaffold` 提供 dev-only 插件脚手架。

## 非职责

- 不加载插件目录、不读取 `plugin.json`、不执行 dynamic import。
- 不拥有 capability catalog、Agent activation、runtime lifecycle、gateway、filesystem、sandbox 或 observability 实现。
- 不作为 first-party runtime package 的共享实现层。

## Public exports

- `definePlugin`
- `definePluginFactory`
- `defineCapabilityProvider`
- `defineTool`
- `defineToolProvider`
- `defineAgentRoutingPolicy`
- `defineLifecycleHook`
- `getPluginMetadata`
- `LATEST_PLUGIN_API_VERSION`
- `ROOT_PLUGIN_API_VERSION`
- `SUPPORTED_PLUGIN_API_VERSIONS`
- `HOST_EXTERNAL_INVENTORY`
- `OPEN_POLICY_INVENTORY`
- `@nextagent/agent-plugin-sdk/scaffold`

The root `definePlugin(...)` entry point is the current v1-compatible authoring helper. It materializes `NextAgentPlugin.apiVersion` with `ROOT_PLUGIN_API_VERSION` (`"1.0"`) when the plugin author omits it, and it MUST NOT drift when a future host latest plugin API version changes. Future plugin API versions should be exposed through explicit versioned SDK subpaths by a follow-up OpenSpec change, not by changing the root helper semantics.

`defineAgentRoutingPolicy(...)` is the only OPEN policy helper in this SDK version. The SDK also exposes the generic `PluginPolicy` contribution shape so the runtime policy registry can store executables for enumerable policy points with different input/output contracts. The routing policy object may provide `configSchema`, `configure(config)` and `decide(run, context, signal)`, matching the existing core routing policy shape. App composition wires the runtime policy resolver into the core routing adapter; the wrapper does not define a separate safe input projection.

## Allowed dependencies

- `@nextagent/agent-common`
- `@nextagent/agent-contracts` public subpaths
- Node builtins only from the scaffold subpath

## Forbidden dependencies

- `@nextagent/agent-app`
- `@nextagent/agent-runtime`
- `@nextagent/agent-core`
- `@nextagent/agent-capability`
- gateway/platform packages
- Web/channel packages
- provider SDKs
