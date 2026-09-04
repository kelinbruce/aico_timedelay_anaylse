## MODIFIED Requirements

### Requirement: Plugins load only during trusted startup composition

系统 SHALL 只在 `agent-app` 启动期从受信系统配置 `plugins[]` 显式声明的本地插件目录加载插件。System config `plugins[]` MUST contain at most 8 plugin entries。每个插件目录 MUST 位于 `configRoot` 下，MUST 包含 `plugin.json`，且 `plugin.json.main` MUST 指向同一插件目录内的单文件 `.js` bundle。插件加载 MUST 由 `agent-app` 校验 system config、plugin directory、`plugin.json`、main bundle exports、plugin id、version、plugin API version、provider/policy/hook shape、schema、required dependency、host externals 和 safe description 后形成冻结的 plugin registry snapshot。Duplicate plugin id、超过插件数量上限或超过单插件 provider 数量上限 MUST fail closed during startup validation。

`createNextAgentApp`、`createComposedApp`、`createNextAgentAppAsync` 和 `createComposedAppAsync` SHALL all support trusted startup plugin loading when `systemConfig.pluginSystem.plugins[]` is non-empty and no preloaded `pluginRegistrySnapshot` is provided。For plugin artifacts whose default export or factory materializes synchronously, synchronous and asynchronous startup入口 MUST produce an equivalent frozen `PluginRegistrySnapshot` and MUST reject the same invalid plugin configuration before app readiness。Asynchronous startup入口 MUST also support plugin factories that return `Promise<NextAgentPlugin>`；synchronous startup入口 MUST reject such async factories before readiness with a safe diagnostic unless a trusted `pluginRegistrySnapshot` is provided。When a caller provides a trusted `pluginRegistrySnapshot`, app composition MUST consume that snapshot and MUST NOT load plugin directories again。

`plugin.json` MAY include `apiVersion` to declare the NextAgent plugin API contract version used by the bundle。The version string SHALL use major/minor form such as `"1.0"`。When `apiVersion` is omitted, `agent-app` MUST use the materialized plugin export `apiVersion` when present, and otherwise MUST treat the plugin as using the latest plugin API version supported by the current host。The root `definePlugin(...)` authoring helper SHALL be v1-compatible in this change and SHALL default `NextAgentPlugin.apiVersion` to the SDK root plugin API version `"1.0"` rather than to a drifting latest host version。The initial latest and supported plugin API version SHALL be `"1.0"`。If a plugin declares a syntactically valid but unsupported plugin API version, such as `"2.0"` before v2 support exists, `agent-app` MUST reject the plugin during startup validation before materializing provider/policy/hook contributions when declared in the manifest, or before accepting provider/policy/hook contributions when declared by the plugin export。`plugin.version` remains the plugin author's own release version and MUST NOT be used as the host plugin API contract version。Future plugin API versions SHALL be introduced through a follow-up OpenSpec change, for example by adding explicit versioned SDK subpaths, and this change SHALL NOT predefine any `vXX` SDK subpath。

插件开发者 MAY 在构建期使用任意三方依赖。交付给系统的运行时 artifact MUST 是自包含单文件 bundle，唯一例外是通过 `plugin.json.hostExternals` 显式声明、被 framework-owned host external inventory 允许、并由 `agent-app` 注入的宿主工具库。插件依赖管理 SHALL be completed before startup composition；`agent-app` 的加载职责是读取显式配置、校验本地 artifact、注入 allowed host externals 并冻结 registry。

Host external inventory SHALL 只开放纯工具库、schema 构建库、validation 库和确定性数据处理库。首版 inventory MUST 精确包含 `typebox` 和 `ajv` 两个 `OPEN` external id：`typebox` 对应 `@sinclair/typebox` 的 schema 构建 surface，`ajv` 对应 `ajv` 的 JSON schema validation surface。其它 host package category 作为非目标边界由 loader validation fail closed。

插件 MUST 通过 `agent-plugin-sdk` 的 plugin factory host object 使用 host externals。The host object passed to plugin factory SHALL initially contain only `{ externals }`。Future changes MAY extend the host object with additional safe host services through new OpenSpec changes；plugin authors MUST NOT rely on undocumented host fields。`agent-app` MUST statically scan the single-file main bundle before evaluating it。该扫描 MUST cover static `import` declarations, re-export declarations with `from`, and string-literal dynamic `import(...)` expressions。扫描通过条件是：bundle 中没有任何 runtime import specifier，所有三方依赖已在构建期打包进单文件 bundle，host external 只通过 factory `host.externals` 注入对象消费。未知 host external id、关闭库、版本不兼容、非 factory 插件声明 `hostExternals` 或 bundle 残留 runtime import specifier 时，系统 MUST reject 该插件加载并 fail closed。

插件加载 authority SHALL come only from trusted startup system config。启动完成后，request 执行路径 SHALL consume the frozen plugin registry snapshot and current Agent activation snapshot。

#### Scenario: Startup loads declared local plugin directory

- **WHEN** 系统配置声明 `plugins[].path="plugins/telecom-diagnostics"`
- **AND** `configRoot/plugins/telecom-diagnostics/plugin.json` 合法
- **AND** `plugin.json.apiVersion` is omitted or equals a supported plugin API version such as `"1.0"`
- **AND** `plugin.json.main` 指向同一目录内的 `.js` bundle
- **AND** `plugin.json.hostExternals` 为空或只声明 `typebox` / `ajv` 且版本兼容
- **AND** the plugin bundle exports a valid `NextAgentPlugin` object or valid plugin factory
- **WHEN** app composition starts through either a synchronous or asynchronous startup API
- **THEN** `agent-app` SHALL validate the plugin artifact during startup composition
- **AND** 该插件 SHALL 进入冻结的 plugin registry snapshot
- **AND** request execution SHALL use only that frozen snapshot and Agent activation facts

#### Scenario: Asynchronous startup awaits async plugin factory

- **WHEN** `plugin.json.hostExternals` declares an allowed host external
- **AND** 插件 default export 是返回 `Promise<NextAgentPlugin>` 的 plugin factory
- **WHEN** app composition starts through an asynchronous startup API
- **THEN** `agent-app` SHALL await the factory during startup plugin composition
- **AND** the materialized plugin SHALL be validated and frozen like a normal plugin export

#### Scenario: Synchronous startup rejects async plugin factory

- **WHEN** `plugin.json.hostExternals` declares an allowed host external
- **AND** 插件 default export 是返回 `Promise<NextAgentPlugin>` 的 plugin factory
- **WHEN** app composition starts through a synchronous startup API without a trusted preloaded `pluginRegistrySnapshot`
- **THEN** `agent-app` SHALL reject the plugin before app readiness
- **AND** diagnostic MUST include a safe reason code that does not expose bundle source or raw error details

#### Scenario: Synchronous startup consumes preloaded snapshot without reloading

- **WHEN** app composition starts through a synchronous startup API
- **AND** system config declares `plugins[]`
- **AND** the caller provides a trusted `pluginRegistrySnapshot`
- **THEN** `agent-app` SHALL consume the provided snapshot
- **AND** `agent-app` MUST NOT read plugin directories, `plugin.json`, or plugin bundle files for those config entries during that composition

#### Scenario: Boundary plugin artifact fails closed

- **WHEN** 系统配置声明了 plugin
- **AND** plugin id duplicate、超过 8 个插件、插件目录逃逸 `configRoot`、插件目录缺失、插件目录缺失 `plugin.json`
- **OR** `plugin.json.apiVersion` or plugin export `apiVersion` declares an unsupported plugin API version such as `"2.0"` before v2 support exists
- **OR** `plugin.json.main` 指向插件目录外、非 `.js` 文件或需要未打包且未声明为 allowed host external 的 runtime dependency artifact
- **OR** plugin export identity、version、provider、policy、hook、schema 或 required dependency 不满足 plugin contract
- **THEN** synchronous and asynchronous startup composition MUST reject the plugin before app readiness
- **AND** diagnostic MUST use safe plugin/config reason code and safe bounded summary

#### Scenario: Host utility external is injected through plugin factory

- **WHEN** `plugin.json.hostExternals` declares `typebox`
- **AND** 插件 default export 是通过 `agent-plugin-sdk` 定义的 plugin factory
- **WHEN** app composition starts through either a synchronous or asynchronous startup API
- **THEN** `agent-app` SHALL inject `host.externals.typebox` during startup plugin composition
- **AND** the materialized plugin SHALL be validated and frozen like a normal plugin export

#### Scenario: Closed host external fails closed

- **WHEN** plugin declares a host external id outside the OPEN inventory
- **THEN** synchronous and asynchronous startup composition MUST reject the plugin before app readiness
- **AND** diagnostic MUST include only safe plugin id、external id 和 safe reason code

#### Scenario: Bundle runtime import specifier fails closed

- **WHEN** plugin bundle contains a static import declaration, a re-export with `from`, or a string-literal dynamic `import(...)`
- **THEN** synchronous and asynchronous startup composition MUST reject the plugin during startup static import specifier scanning before evaluating the bundle
- **AND** the host external MUST only be available through the plugin factory `host.externals.typebox`
- **AND** diagnostic MUST include only safe plugin id、external id/package specifier category and safe reason code

#### Scenario: Boundary runtime input cannot load plugins

- **WHEN** request body、client metadata、model output、SkillHub package、remote URL 或 Agent package 未授权路径携带 plugin id、module path、代码片段或动态 import 指令
- **THEN** request 执行 MUST 继续只使用启动期冻结的 plugin registry snapshot 和当前 Agent activation snapshot
