## ADDED Requirements

### Requirement: Plugins load only during trusted startup composition

系统 SHALL 只在 `agent-app` 启动期从受信系统配置 `plugins[]` 显式声明的本地插件目录加载插件。System config `plugins[]` MUST contain at most 8 plugin entries。每个插件目录 MUST 位于 `configRoot` 下，MUST 包含 `plugin.json`，且 `plugin.json.main` MUST 指向同一插件目录内的单文件 `.js` ESM bundle。插件加载 MUST 由 `agent-app` 校验 system config、plugin directory、`plugin.json`、main bundle exports、plugin id、version、plugin API version、provider/policy/hook shape、schema、required dependency、host externals 和 safe description 后形成冻结的 plugin registry snapshot。Duplicate plugin id、超过插件数量上限或超过单插件 provider 数量上限 MUST fail closed during startup validation。

`plugin.json` MAY include `apiVersion` to declare the NextAgent plugin API contract version used by the bundle。The version string SHALL use major/minor form such as `"1.0"`。When `apiVersion` is omitted, `agent-app` MUST use the materialized plugin export `apiVersion` when present, and otherwise MUST treat the plugin as using the latest plugin API version supported by the current host。The root `definePlugin(...)` authoring helper SHALL be v1-compatible in this change and SHALL default `NextAgentPlugin.apiVersion` to the SDK root plugin API version `"1.0"` rather than to a drifting latest host version。The initial latest and supported plugin API version SHALL be `"1.0"`。If a plugin declares a syntactically valid but unsupported plugin API version, such as `"2.0"` before v2 support exists, `agent-app` MUST reject the plugin during startup validation before materializing provider/policy/hook contributions when declared in the manifest, or before accepting provider/policy/hook contributions when declared by the plugin export。`plugin.version` remains the plugin author's own release version and MUST NOT be used as the host plugin API contract version。Future plugin API versions SHALL be introduced through a follow-up OpenSpec change, for example by adding explicit versioned SDK subpaths, and this change SHALL NOT predefine any `vXX` SDK subpath。

插件开发者 MAY 在构建期使用任意三方依赖。交付给系统的运行时 artifact MUST 是自包含单文件 ESM bundle，唯一例外是通过 `plugin.json.hostExternals` 显式声明、被 framework-owned host external inventory 允许、并由 `agent-app` 注入的宿主工具库。插件依赖管理 SHALL be completed before startup composition；`agent-app` 的加载职责是读取显式配置、校验本地 artifact、注入 allowed host externals 并冻结 registry。

Host external inventory SHALL 只开放纯工具库、schema 构建库、validation 库和确定性数据处理库。首版 inventory MUST 精确包含 `typebox` 和 `ajv` 两个 `OPEN` external id：`typebox` 对应 `@sinclair/typebox` 的 schema 构建 surface，`ajv` 对应 `ajv` 的 JSON schema validation surface。其它 host package category 作为非目标边界由 loader validation fail closed。

插件 MUST 通过 `agent-plugin-sdk` 的 plugin factory host object 使用 host externals。The host object passed to plugin factory SHALL initially contain only `{ externals }`。Future changes MAY extend the host object with additional safe host services through new OpenSpec changes；plugin authors MUST NOT rely on undocumented host fields。`agent-app` MUST statically scan the single-file main ESM bundle before dynamic import。该扫描 MUST cover static `import` declarations, re-export declarations with `from`, and string-literal dynamic `import(...)` expressions。扫描通过条件是：bundle 中没有任何 runtime import specifier，所有三方依赖已在构建期打包进单文件 bundle，host external 只通过 factory `host.externals` 注入对象消费。未知 host external id、关闭库、版本不兼容、非 factory 插件声明 `hostExternals` 或 bundle 残留 runtime import specifier 时，系统 MUST reject 该插件加载并 fail closed。

插件加载 authority SHALL come only from trusted startup system config。启动完成后，request 执行路径 SHALL consume the frozen plugin registry snapshot and current Agent activation snapshot。

#### Scenario: Startup loads declared local plugin directory

- **WHEN** 系统配置声明 `plugins[].path="plugins/telecom-diagnostics"`
- **AND** `configRoot/plugins/telecom-diagnostics/plugin.json` 合法
- **AND** `plugin.json.apiVersion` is omitted or equals a supported plugin API version such as `"1.0"`
- **AND** `plugin.json.main` 指向同一目录内的 `.js` ESM bundle
- **AND** `plugin.json.hostExternals` 为空或只声明 `typebox` / `ajv` 且版本兼容
- **AND** 该 bundle 的 exports 和 provider/policy/hook shape 均合法
- **THEN** `agent-app` SHALL 在启动期加载该插件
- **AND** 该插件 SHALL 进入冻结的 plugin registry snapshot
- **AND** 该插件只有在 Agent `capabilityBindings` 绑定 Tool、Agent `policies` 编译到 `AgentAssembly.policies` 激活 policy 或 `hooks` 激活 hook 后才对对应 Agent 生效

#### Scenario: Boundary plugin artifact fails closed

- **WHEN** 系统配置声明超过 8 个插件
- **OR** 系统配置声明的插件 path 指向 zip/archive、单独 module 文件、绝对路径、parent traversal、URL、glob 或 shell expression
- **OR** 插件目录缺失 `plugin.json`
- **OR** `plugin.json.apiVersion` or plugin export `apiVersion` declares an unsupported plugin API version such as `"2.0"` before v2 support exists
- **OR** `plugin.json.main` 指向插件目录外、非 `.js` 文件或需要未打包且未声明为 allowed host external 的 runtime dependency artifact
- **THEN** `agent-app` MUST reject 该插件加载
- **AND** 若该插件为 required，app readiness MUST fail closed
- **AND** diagnostic MUST use safe plugin/config reason code and safe bounded summary

#### Scenario: Host utility external is injected through plugin factory

- **WHEN** 插件 manifest 声明 `hostExternals=[{"id":"typebox","versionRange":"^0.34.0"}]`
- **AND** 插件 default export 是通过 `agent-plugin-sdk` 定义的 plugin factory
- **AND** 宿主 `typebox` inventory 版本与声明兼容
- **THEN** `agent-app` SHALL inject `host.externals.typebox` during startup plugin composition
- **AND** 插件 MAY use the injected TypeBox surface to construct provider、policy 或 hook schemas
- **AND** request path SHALL use the injected object rather than Node module resolution for `@sinclair/typebox`

#### Scenario: Boundary host external fails closed

- **WHEN** 插件 manifest 声明 `fastify`、`pino`、`kysely`、`@opentelemetry/api`、workspace private path、unknown npm package name 或任何不在 host external inventory 中的 id
- **THEN** `agent-app` MUST reject 该插件加载
- **AND** 系统 SHALL fail closed before host `node_modules` resolution
- **AND** diagnostic MUST include only safe plugin id、external id 和 safe reason code

#### Scenario: Residual host external import is rejected by static scan

- **WHEN** 插件 manifest 声明 `hostExternals=[{"id":"typebox","versionRange":"^0.34.0"}]`
- **AND** main ESM bundle still contains `import { Type } from "@sinclair/typebox"`、`export { Type } from "@sinclair/typebox"` or `await import("@sinclair/typebox")`
- **THEN** `agent-app` MUST reject the plugin during startup static import specifier scanning before dynamic import evaluates the bundle
- **AND** the host external MUST only be available through the plugin factory `host.externals.typebox`
- **AND** diagnostic MUST include only safe plugin id、external id/package specifier category and safe reason code

#### Scenario: Boundary runtime input cannot load plugins

- **WHEN** request body、client metadata、model output、SkillHub package、remote URL 或 Agent package 未授权路径携带 plugin id、module path、代码片段或动态 import 指令
- **THEN** request 执行 MUST 继续只使用启动期冻结的 plugin registry snapshot 和当前 Agent activation snapshot

### Requirement: Plugin activation is explicit and Agent-scoped

插件加载、Tool 绑定、policy 激活和 hook 激活 SHALL 是分离边界。系统配置声明可加载插件目录；插件 `providers[]` 声明 capability provider，首版每个插件最多声明 4 个 capability provider；Agent `capabilityBindings` 声明当前 Agent 允许哪些插件 provider 下的 capability；Agent `policies` 编译为 `AgentAssembly.policies`，声明当前 Agent 激活哪些开放 policy implementation；Agent `hooks` 声明当前 Agent 激活哪些 lifecycle hook。插件加载事实进入 `PluginRegistrySnapshot`，Agent 可用性由对应 Agent activation facts 决定。

系统 SHALL rename the current pure provider identity contract to `CapabilityProviderIdentity` and use runtime `CapabilityProvider` for the registration unit that contains `identity: CapabilityProviderIdentity`, `discovery: CapabilityDiscovery`, and optional `executor: CapabilityExecutor`。该 rename SHALL apply to all capability provider registration sources, including built-in provider assembly, config-driven provider assembly, external provider inputs, plugin providers, and the existing app-composed `memory-tools` provider path。系统 SHALL define the public `CapabilityProvider` SPI, `DefineToolInput`, and `DefineToolProviderInput` in `agent-contracts/capability` so plugin SDK and first-party modules can contribute Tool and provider discovery/executor logic through public contracts。`defineCapabilityProvider(...)` SHALL allow plugins to return a `CapabilityProvider` with custom discovery and optional executor。`defineTool(...)` SHALL be a sugar path that converts `DefineToolInput` into public `ToolDefinition`。`DefineToolInput` SHALL align with the existing `agent-capability` `defineTool(...)` public authoring shape and MAY include Tool metadata fields (`name`, `description`, `inputSchema`, `outputSchema`, optional `configSchema`, `requiredDependencies`, `replayPolicy`, `disclosurePolicy`, `returnsCapabilityResult`, `observability`) plus optional `configure` and required `execute`。`defineToolProvider(...)` SHALL be a sugar path that converts `DefineToolProviderInput` into a standard `CapabilityProvider` with Tool descriptor discovery and executor behavior。`DefineToolProviderInput` SHALL contain required `providerId`、optional `providerType`、optional `description` and required `tools: ToolDefinition[]`。Discovery mode、custom executor、binding policy、default exposure、Agent activation、`pluginId`、`configRoot` and path are owned by advanced provider SPI, catalog filtering, Agent assembly or loader contracts。`agent-capability` SHALL validate, normalize, guard-wrap, and assemble providers before they enter the capability subsystem；this wrapping SHALL enforce provider identity consistency, descriptor schema validation, duplicate capability checks, required dependency checks, discovery result validation, executor lookup rules, timeout/cancellation, safe errors and diagnostics。Plugin manifest loading, plugin activation, Agent binding policy, host external injection, memory opt-in and domain-specific memory execution semantics SHALL remain with their owning modules。系统 SHALL separate capability discovery from Agent capability binding。`CapabilityProvider.discovery.discoveryMode` 只决定 capability descriptor 如何进入 catalog：`EAGER` provider 在 startup composition 后提供 materialized descriptors，`SEARCH` provider 在当前 Agent scope 和 query 条件下延迟检索。Agent visibility, search authority, resolve authority and invocation authority SHALL continue to be determined by existing catalog filtering over provider rules and the accepted Agent's `AgentAssembly.capabilityBindings`。

系统 SHALL preserve existing capability catalog filtering semantics in this change。`AgentAssembly.capabilityBindings` SHALL contain Agent-authored explicit binding entries；system defaults SHALL remain catalog-internal framework-owned facts。对于现有默认可见 provider，包括 framework builtin Tool、builtin/system/agent-owned Skill 和 parent subagent，缺失 Agent binding MAY continue to mean default-visible only through a framework-owned catalog-internal default exposure allowlist, and explicit disabled binding MAY continue to disable or narrow that capability。该 default exposure allowlist MUST be finite and framework-owned。

对于现有必须显式 capability binding 的 provider，包括 top-level builtin/local Agent capability 和本 change 新增的 plugin provider，缺失 matching Agent `capabilityBindings` entry MUST mean not visible, not searchable when search authority is required, not resolvable, and not invocable for that Agent；matching entry with `enabled` omitted or `true` means enabled for that Agent；matching entry with `enabled=false` MUST keep that capability unavailable for that Agent。

Capability binding matching SHALL support exact capability binding and existing provider/condition selector semantics。Exact capability binding uses `providerId`、`capabilityType` and `capabilityId` to decide descriptor visibility, resolve authority and invocation authority。Provider/condition selector MAY authorize search for a provider without requiring exact enabled binding for every returned descriptor, as with the current SkillHub governance；returned descriptors remain subject to conflict resolution, availability/model visibility filtering and exact disabled binding filtering。Any new provider kind or providerType not covered by the catalog-internal default exposure allowlist and without an explicit OpenSpec-defined binding policy SHALL use fail-closed default visibility。

`memory-tools` provider registration MUST continue to require the existing enabled memory tool binding opt-in conditions。Memory Tools SHOULD produce a memory-owned `CapabilityProvider` using the same `agent-contracts/capability` provider SPI / `DefineToolInput` / `DefineToolProviderInput` shape used by plugin providers, and `agent-app` SHALL pass that provider to `agent-capability` when memory opt-in is satisfied。`agent-memory` remains the owner of memory Tool semantics, while plugin activation remains scoped to plugin providers。SkillHub provider authorization through current Agent bindings MUST remain unchanged: provider authorization controls search; once provider search is authorized, returned Skill descriptors remain subject to SkillHub governance, conflict resolution, model visibility filtering, availability filtering, and exact disabled binding filtering。

系统 SHALL add `AgentAssembly.policies` as the runtime-facing policy activation facts for this change。Each `AgentAssembly.policies` entry MUST be an implementation-free binding fact and MUST include `policyPointId`、`pluginId`、`policyId` and `enabled`。Each entry MAY include `timeoutMs` and validated `config`。Policy evaluator functions、closures、module paths、plugin directory paths、registry handles、raw config and implementation handles SHALL remain in runtime policy registry / loader internals。

Request acceptance 固化 `agentId`、`agentVersion` 和 `agentAssemblyRef` 后，runtime、core、capability、policy 和 hook 执行路径 MUST use that accepted Agent's frozen facts。Tool MUST use the accepted Agent's `AgentAssembly.capabilityBindings` and capability catalog governance；policy MUST 使用该 accepted Agent 对应的 `AgentAssembly.policies` and runtime policy resolver；hook MUST 使用该 accepted Agent 对应的 `AgentAssembly.hooks` activation snapshot 和 startup hook registry materialized facts。

#### Scenario: Plugin provider, policy and hook affect only explicitly configured Agents

- **WHEN** 插件 `telecom-diagnostics` 同时存在于系统 plugin registry 中
- **AND** Agent A 通过 `capabilityBindings` 绑定该插件 provider 下的 Tool、通过 `policies` / `AgentAssembly.policies` 激活其 policy implementation 或通过 `hooks` 激活其 hook
- **AND** Agent B 未声明对应 binding 或 activation
- **THEN** Agent A 的 accepted request MAY 使用对应 provider、policy 或 hook
- **AND** Agent B 的 accepted request uses its own assembly facts and therefore lacks authority for the corresponding provider、policy 或 hook

#### Scenario: Missing plugin policy or hook activation fails assembly

- **WHEN** Agent `policies` 或 `hooks` 引用不存在的 plugin id、policy id、policy point id 或 hook id
- **THEN** 该 Agent assembly 编译 MUST fail closed
- **AND** 系统 MUST 产生 safe config 或 assembly diagnostic
- **AND** 该 Agent 的 ready 状态 SHALL require a complete referenced policy/hook activation set

### Requirement: Plugin providers enter the capability governance path

插件 SHALL declare capability extension through top-level `providers[]`。首版插件 `providers[]` SHALL contain at most 4 capability providers。`agent-app` SHALL be the startup owner that validates loaded plugin providers and passes them to the capability subsystem during startup composition。Plugin providers MUST enter the existing capability discovery/catalog path and continue to obey descriptor schema validation、Agent binding filtering、conflict resolution、`CapabilityInvocationPort`、risk policy、sandbox dependency、timeout/cancellation 和 observability 规则。

Plugin SDK `defineCapabilityProvider(...)` SHALL be a plugin-facing facade over the `agent-contracts/capability` public provider SPI。It MAY add plugin-owned provider identity constraints and plugin authoring typing, and it MUST output `CapabilityProvider` and allow custom discovery/executor implementations。Plugin SDK `defineTool(...)` SHALL be a plugin-facing facade over the `agent-contracts/capability` public Tool authoring contract and MUST output `ToolDefinition`。Plugin SDK `defineToolProvider(...)` SHALL be a sugar path over the same SPI for plugins that only need to expose Tool definitions through a standard Tool provider, and its input SHALL be `DefineToolProviderInput`。`agent-plugin-sdk` SHALL implement these helpers through public `agent-contracts/capability` shapes。`agent-capability` SHALL validate, normalize, guard-wrap and assemble plugin providers before they are consumed by the capability subsystem。The existing capability provider path SHALL remain the single plugin Tool discovery, resolution and invocation path。

首版 plugin provider SHALL return `TOOL` descriptors。Plugin providers MAY use `EAGER` discovery for startup-known Tool descriptors or `SEARCH` discovery for scoped delayed Tool descriptor retrieval。Because `SEARCH` plugin provider discovery runs on the request path, each `SEARCH` plugin provider `discover` invocation MUST be guarded by `agent-capability` timeout, cancellation, safe error mapping, diagnostic and discovery result validation wrapping with governance equivalent to provider executor wrapping。Remote plugin provider discovery, SkillHub-delivered plugin provider discovery, Agent-package-delivered plugin provider discovery, and plugin-provided `SKILL` / `AGENT` descriptors are reserved non-goals for follow-up changes。

插件 provider 下的 Tool visibility and invocation authority SHALL come from existing `AgentAssembly.capabilityBindings` and capability catalog filtering。`plugins[]` is a startup loading declaration；`capabilityBindings` is the Agent-scoped Tool authority declaration；plugin registry membership is a loading fact。

插件 provider SHALL use its explicitly authored provider identity and SHALL expose Tool descriptors through the capability catalog。Tool name/schema/execution mapping comes from provider-owned Tool definitions and is consumed through capability governance。

插件 provider identity MUST 使用现有 safe id vocabulary。首版插件 provider identity MUST use `providerKind=CUSTOM` and `providerType=nextagent-plugin-tool`。插件作者 MUST explicitly declare each plugin provider `providerId`；`agent-app` MUST NOT derive `providerId` from `pluginId`。Plugin provider ids MUST be unique across the frozen plugin registry and MUST NOT use framework reserved provider ids such as builtin provider ids、`memory-tools`、SkillHub provider ids or system/local Agent provider ids。Agent `capabilityBindings` MUST reference the explicit plugin provider id authored by the plugin。Provider id format SHALL be compatible with existing Agent capability binding safe id validation。

#### Scenario: Plugin Tool is discoverable only through capability catalog

- **WHEN** 插件 `telecom-diagnostics` 声明 provider `telecom-diagnostics.alarm-tools`
- **AND** 该 provider 通过 `defineToolProvider(...)` 暴露由 `defineTool(...)` 返回的 Tool `parse-alarm-log`
- **AND** Agent `capabilityBindings` 包含 `providerId="telecom-diagnostics.alarm-tools"`、`capabilityType="TOOL"` 和 `capabilityId="parse-alarm-log"` 的 enabled binding
- **THEN** 该 Tool SHALL 作为 plugin provider 的 discovery fact 进入 capability catalog
- **AND** 模型可见能力、resolve 和 invocation MUST 由既有 capability governance 主路径决定
- **AND** runtime/core SHALL invoke it only through the capability governance path

#### Scenario: Plugin provider can customize discovery and execution

- **WHEN** 插件 `telecom-diagnostics` 通过 `defineCapabilityProvider(...)` 声明 provider `telecom-diagnostics.search-tools`
- **AND** 该 provider implements `SEARCH` discovery and a custom executor for `TOOL` descriptors
- **AND** Agent `capabilityBindings` authorizes that provider through a matching provider/condition selector
- **THEN** capability catalog MAY search that provider in the accepted Agent scope
- **AND** returned Tool descriptors MUST be validated, filtered and resolved through the existing capability governance path
- **AND** invocation MUST call the provider executor only through `CapabilityInvocationPort`
- **AND** runtime/core SHALL consume the plugin implementation only through `CapabilityInvocationPort`

#### Scenario: Plugin discovery does not imply plugin Tool visibility

- **WHEN** 插件 `telecom-diagnostics` 已在 startup composition 中加载
- **AND** 其 `parse-alarm-log` Tool descriptor 已通过 `EAGER` 或 `SEARCH` plugin provider discovery 进入 capability catalog
- **AND** 当前 Agent 没有 matching enabled `capabilityBindings` entry
- **THEN** 当前 Agent 的 capability list SHALL project the Tool as absent
- **AND** 当前 Agent 对该 capability id 的 resolve 或 invoke MUST return safe unavailable/not found 结果

#### Scenario: Unbound plugin Tool is unavailable

- **WHEN** 插件 registry 包含 provider `telecom-diagnostics.alarm-tools`
- **AND** 该 provider 包含 Tool descriptor `parse-alarm-log`
- **AND** 当前 Agent 没有对应 enabled `capabilityBindings` entry
- **THEN** 当前 Agent 的 capability list SHALL project the Tool as absent
- **AND** 当前 Agent 对该 capability id 的 resolve 或 invoke MUST return safe unavailable/not found 结果

#### Scenario: Plugin Tool disabled binding is unavailable

- **WHEN** 插件 registry 包含 provider `telecom-diagnostics.alarm-tools`
- **AND** 该 provider 包含 Tool descriptor `parse-alarm-log`
- **AND** 当前 Agent 的 `capabilityBindings` 包含 matching entry 但 `enabled=false`
- **THEN** 当前 Agent 的 capability list SHALL project the Tool as absent
- **AND** 当前 Agent 对该 capability id 的 resolve 或 invoke MUST return safe unavailable/not found 结果

#### Scenario: Builtin Tool default exposure is unchanged

- **WHEN** 系统未配置任何插件
- **AND** Agent 使用既有 builtin Tool provider 和既有 Agent binding 配置
- **THEN** builtin Tool 的 default-enabled 和 disabled binding override 语义 MUST remain unchanged
- **AND** builtin Tool explicit allow-binding requirements remain unchanged

#### Scenario: Memory Tool provider uses the unified provider registration shape

- **WHEN** Agent memory tool opt-in conditions are satisfied for `search_memory`、`get_memory_detail` and `add_memory`
- **AND** `agent-app` composes the memory Tool provider during startup
- **THEN** the memory Tool source SHALL be passed to `agent-capability` as a runtime `CapabilityProvider` with `identity.providerId="memory-tools"` and `EAGER` discovery mode
- **AND** `agent-capability` SHALL validate, normalize and guard-wrap that provider before adding it to the capability subsystem
- **AND** `CapabilityDiscovery.provider` and each memory Tool descriptor `provider` SHALL reference that same `CapabilityProviderIdentity`
- **AND** the memory-owned provider factory SHOULD reuse the `agent-contracts/capability` provider SPI / `DefineToolInput` / `DefineToolProviderInput` shape
- **AND** `agent-memory` SHALL create the memory Tool provider through memory-owned code and public capability contract shapes
- **AND** memory Tools SHALL use runtime `CapabilityProvider` as the registration concept

#### Scenario: Memory Tool opt-in is unchanged

- **WHEN** 系统未配置任何插件
- **AND** Agent 使用既有 `memory-tools` bindings for `search_memory`、`get_memory_detail` and `add_memory`
- **THEN** app-composed memory Tool provider registration and visibility MUST continue to require the existing enabled binding opt-in semantics
- **AND** `memory-tools` default visibility remains governed by existing memory opt-in semantics
- **AND** disabled or missing memory Tool bindings MUST continue to keep memory Tools unregistered or unavailable according to existing memory governance

#### Scenario: Skill and Subagent exposure are unchanged

- **WHEN** 系统未配置任何插件
- **AND** Agent 使用既有 builtin/system/agent-owned Skill、SkillHub provider binding、top-level Agent binding 或 parent subagent 配置
- **THEN** existing Skill and Subagent capability discovery and exposure semantics MUST remain unchanged, including delayed `SEARCH` discovery for agent-owned Skill、parent subagent and SkillHub sources where applicable
- **AND** Skill、Agent 和 Subagent capability creation remains governed by their existing owners
- **AND** existing Skill or parent subagent default-visible sources keep their current binding requirements

#### Scenario: SkillHub provider-gated search is unchanged

- **WHEN** 系统未配置任何插件
- **AND** Agent does not authorize a `SKILL_HUB` provider through current capability binding governance
- **THEN** capability catalog SHALL leave that SkillHub provider unsearched
- **WHEN** Agent authorizes that `SKILL_HUB` provider
- **THEN** capability catalog MAY search the provider
- **AND** returned Skill descriptors SHALL continue to be governed by SkillHub readiness, conflict resolution, availability/model visibility filters, and exact disabled bindings
- **AND** SkillHub provider-gated search keeps its current exact-binding requirements for returned Skills

### Requirement: Policy plugins use an explicit open policy inventory

系统 SHALL 定义面向智能体二次开发者的开放 policy 清单。每个 policy point MUST 声明稳定 policy point id、状态、owning module、固定 executable contract、timeout 来源、failure semantics、安全观测事实和是否允许 Agent-scoped plugin replacement。插件 manifest 和 Agent 配置只能引用开放 policy 清单中的 policy point id。

`agent-plugin-sdk` SHALL expose the plugin-facing open policy authoring surface for the same inventory。It MUST export the open policy point id vocabulary, a generic `PluginPolicy` contribution shape, the `agentRoutingPolicy` authoring helper `defineAgentRoutingPolicy(...)`, and the `AgentRoutingPolicy` / `AgentRoutingPolicyExecutable` / `AgentRoutingPolicyResult` types for the `OPEN` policy point。The SDK MAY re-export durable public contract types from `agent-contracts` subpaths, but it MUST NOT depend on `agent-core` implementation or own policy runtime execution。RESERVED policy point ids MAY appear in SDK inventory metadata as non-activatable entries, but the SDK MUST NOT provide implementation helpers for RESERVED policy points in this change。

policy point 状态 SHALL 只包含 `OPEN` 和 `RESERVED`。`OPEN` 表示当前 change 允许插件实现并由 Agent 激活；`RESERVED` 表示该 policy point 是已规划的二次开发扩展点，后续 owning OpenSpec change 冻结 contract 后可变更开放状态。

首版开放 policy 清单 SHALL 精确包含以下条目：

| policy point id | status | owner | contract | 触发边界 | 插件失败语义 |
| --- | --- | --- | --- | --- | --- |
| `restrictedOperationPolicy` | `RESERVED` | `agent-runtime` | 由后续 risk policy plugin OpenSpec change 冻结 | 受限操作执行前，包括 capability invocation、sandbox dynamic execution 和 authorization/high-risk confirmation 的 risk policy enforcement 边界 | 保留到后续 change |
| `agentRoutingPolicy` | `OPEN` | `agent-core` | existing core `AgentRoutingPolicy.decide(RequestRun, RequestContext, AbortSignal)` / `AgentRoutingPolicyResult`; result SHALL align with `agent-contracts/core.AgentRoutingDecision` | 请求进入 Agent 后选择模型循环、定向 Skill/Workflow、澄清、拒绝或人机接管等处理路径 | fail closed to safe routing rejection |
| `modelSelectionPolicy` | `RESERVED` | `agent-core` / `agent-model` | 由后续 model selection OpenSpec change 冻结 | 在当前 Agent 可用 model profiles 中选择本次模型调用使用的 profile | 保留到后续 change |
| `modelFallbackPolicy` | `RESERVED` | `agent-model` 或模型调用 orchestration owner | 由后续 model fallback OpenSpec change 冻结 | 模型调用失败、超时、限流或不可用后决定是否 fallback 及 fallback 目标 | 保留到后续 change |
| `contextWindowPolicy` | `RESERVED` | `agent-context-engine` | 由后续 context window OpenSpec change 冻结 | 在模型上下文窗口内分配 history、attachment、Skill disclosure、system prompt、summary 等预算 | 保留到后续 change |

本 change 的可激活 policy point set SHALL be exactly the `OPEN` entries in the above inventory。`redactionPolicy`、`promptAssemblyPolicy`、`capabilityConflictResolutionPolicy`、`observabilityProjectionPolicy`、`authorizationAnswerPolicy` 和 `gatewayRetryPolicy` 属于非目标边界。

`agentRoutingPolicy` SHALL use the existing core routing policy executable contract owned by `agent-core` and exposed only through public contract subpaths: `decide(run: RequestRun, context: RequestContext, signal: AbortSignal)`. `agentAssemblyRef` MUST remain the accepted request's frozen assembly ref on `RequestRun`. `acceptedInputText` MUST have the same name and semantics as the existing `RequestContext.acceptedInputText` consumed by the current routing policy baseline, and the core routing adapter MUST pass it through without additional summary, redaction, truncation, or wrapper-level field projection. If this input boundary is narrowed in the future, the narrowing MUST be specified in the routing business contract and MUST apply equally to built-in and plugin routing policies.

`AgentRoutingPolicyResult` SHALL be the public `AgentRoutingDecision` shape from `agent-contracts/core`: `kind: RoutingDecisionKind`、`safeReason: string`、optional `evidenceRef?: string` and optional `skillName?: string`。The allowed `kind` values are the existing `RoutingDecisionKind` vocabulary: `DETERMINISTIC_FLOW`、`MODEL_DRIVEN_LOOP`、`CLARIFY`、`REJECT` and `HUMAN_HANDOFF`。This change SHALL NOT add plugin-specific routing result fields. Any internal `agent-core` routing fields, such as accepted assembly materialization or recipe/workflow implementation details, remain inside `agent-core` and SHALL be added by the core routing adapter or routing implementation rather than returned by plugin evaluators.

`AgentRoutingPolicy` implementation objects MAY declare `configSchema` and `configure(config)` in addition to `decide(...)` and `timeoutMs`。`configure(config)` SHALL return an `AgentRoutingPolicyExecutable` with `decide(...)`。`AgentAssembly.policies.config` MUST be validated against `configSchema` when present and SHALL be used only by runtime startup materialization to create an assembly-specific policy executable. Raw policy config MUST NOT be added to routing policy execution input.

`agent-runtime` SHALL materialize a startup policy registry/resolver from frozen plugin policy contributions supplied by app composition. This materialization SHALL mirror lifecycle hook materialization only for startup/assembly-scoped materialization and lookup: startup policy implementations produce default executables, and accepted `AgentAssembly.policies` activations with config produce assembly-specific configured executables keyed by `agentAssemblyRef + policyPointId + pluginId + policyId`。Invalid policy activation references, duplicate enabled activations for the same policy point, invalid config, or unavailable executable implementations MUST fail before app/request readiness during plugin loading, Agent assembly compilation, or policy registry materialization. The resolver SHALL take accepted Agent scope facts (`agentId`, `agentVersion`, `agentAssemblyRef`) plus a `policyPointId`, load the accepted Agent assembly, verify the assembly ref, select that assembly's enabled `AgentAssembly.policies` binding for the requested policy point, and resolve the concrete executable from the assembly-specific executable map or fallback startup executable. A lookup for a policy point SHALL return a resolved policy entry when an enabled binding exists, and `undefined` when no binding is activated. The registry/resolver MUST be a container and lookup mechanism over an enumerable `AgentPolicyExecutableByPoint` mapping: it MUST preserve each policy point's own executable shape rather than forcing every policy point to use the `agentRoutingPolicy` input/output or method shape. Each policy point owner SHALL provide its own typed adapter before execution. This change SHALL only execute the `agentRoutingPolicy` OPEN point through the routing typed adapter, while RESERVED points remain non-activatable.

The core `agentRoutingPolicy` adapter SHALL call the injected policy resolver before invoking the system built-in routing policy. When an enabled plugin binding exists, the adapter MUST evaluate the resolved plugin policy directly and MUST NOT invoke the built-in routing policy first. When `AgentAssembly.policies` is absent, empty, contains no enabled `agentRoutingPolicy` binding, or the Agent has no `policies` config, the adapter MUST delegate to the system built-in routing policy. The adapter MUST NOT add a third runtime routing state for unavailable plugin policy activation; invalid activation or registry materialization MUST be rejected before request execution, while plugin policy execution failure, timeout or invalid result MUST fail closed to safe routing rejection. `agent-core` SHALL receive the policy resolver as a runtime dependency and MUST NOT read plugin config, plugin registry, plugin paths or Agent raw config to choose plugin evaluators.

#### Scenario: Agent activates an open routing policy

- **WHEN** 插件 manifest 贡献 `policyPointId="agentRoutingPolicy"` 的 implementation
- **AND** Agent `policies` 配置显式激活该 policy implementation
- **AND** `agent-app` 将该 activation 编译为 `AgentAssembly.policies` 中的 implementation-free binding fact
- **THEN** 当前 Agent 的 routing MAY 使用该插件 implementation
- **AND** 该 implementation MUST receive the same `RequestRun` / `RequestContext` / `AbortSignal` contract as the built-in core routing policy
- **AND** 该 implementation MUST return only `AgentRoutingPolicyResult` aligned with `agent-contracts/core.AgentRoutingDecision`
- **AND** 未激活该 policy implementation 的 Agent MUST continue to use the system built-in routing policy
- **AND** runtime、capability、model 和 channel path SHALL receive the selected routing behavior through the core routing adapter
- **AND** the routing policy adapter MUST use the injected policy resolver to choose the implementation from the accepted Agent's `AgentAssembly.policies` and runtime implementation registry
- **AND** 该 implementation 的失败、timeout 或非法输出 MUST fail closed to safe routing rejection

#### Scenario: Agent without routing policy activation uses built-in routing

- **WHEN** accepted Agent `AgentAssembly.policies` is absent, empty, or contains no enabled `agentRoutingPolicy` binding
- **THEN** the core routing policy adapter MUST delegate to the system built-in routing policy
- **AND** `agent-core` MUST NOT read plugin registry or raw Agent config to choose a plugin evaluator

#### Scenario: Reserved policy point is rejected

- **WHEN** 插件 manifest 或 Agent 配置引用 `restrictedOperationPolicy`、`modelSelectionPolicy`、`modelFallbackPolicy` 或 `contextWindowPolicy`
- **THEN** 系统 MUST reject 该 plugin policy 或 Agent activation
- **AND** 系统 MUST 产生 safe diagnostic，说明该 policy point 为 `RESERVED`
- **AND** execution path creation SHALL remain reserved for the owning follow-up change

#### Scenario: Unknown policy point is rejected

- **WHEN** 插件 manifest 或 Agent 配置引用 `redactionPolicy`、`promptAssemblyPolicy` 或任何不在开放 policy 清单中的 policy point id
- **THEN** 系统 MUST reject 该 plugin policy 或 Agent activation
- **AND** 系统 MUST 产生 safe diagnostic
- **AND** policy execution path creation SHALL remain limited to the open inventory entries

### Requirement: Plugin scaffold is available from the SDK dev entry point

`agent-plugin-sdk` SHALL provide a dev-only scaffold surface for intelligent-agent plugin developers。The implementation owner SHALL be `@nextagent/agent-plugin-sdk/scaffold`。The package SHALL expose a CLI command named `create-nextagent-plugin` that creates a local plugin project from templates；the CLI and scaffold subpath MUST NOT be imported by production runtime packages and MUST NOT participate in plugin loading, registry freezing, Agent activation, capability discovery, policy execution or hook execution。

The scaffold command SHALL support `create-nextagent-plugin <plugin-directory>` and SHALL generate a starter project containing at least:

- `package.json` with development dependencies on `@nextagent/agent-plugin-sdk`, `esbuild`, TypeScript and test tooling
- `tsconfig.json`
- `esbuild.config.ts` configured for ESM, single-file bundle output and inline sourcemap
- `src/index.ts` using `definePlugin(...)` as the default authoring path
- `plugin.json` template aligned with the generated plugin id and single-file bundle output
- `tests/plugin.test.ts` that uses `getPluginMetadata(...)` to verify the plugin object exposes the expected safe ids and contribution shape

`agent-plugin-sdk` SHALL expose `getPluginMetadata(plugin)` as an authoring/test helper that reads a materialized plugin object and returns safe metadata such as plugin id, version, provider ids, policy ids and hook ids. `getPluginMetadata(...)` MUST NOT load files, read `plugin.json`, execute dynamic import, validate host external versions, freeze a plugin registry, compile Agent activation, or prove production loadability。

The generated scaffold SHALL default to bundled dependencies and `definePlugin(...)`。It MAY include commented guidance for `definePluginFactory(...)` and `hostExternals`, but MUST present factory injection as an optimization for shared host externals rather than the default path。

#### Scenario: Developer creates a plugin project with the scaffold CLI

- **WHEN** a developer runs `create-nextagent-plugin my-plugin`
- **THEN** the CLI SHALL create a `my-plugin/` project with `package.json`, `tsconfig.json`, `esbuild.config.ts`, `src/index.ts`, `plugin.json` and `tests/plugin.test.ts`
- **AND** `src/index.ts` SHALL use `definePlugin(...)` by default
- **AND** the build configuration SHALL produce a single-file ESM bundle with inline sourcemap
- **AND** the generated test SHALL use `getPluginMetadata(...)` to assert expected plugin metadata
- **AND** the generated README or package scripts SHALL show the path `npm run build -> copy dist output to configRoot/plugins/<pluginId>/`

#### Scenario: Scaffold output does not bypass plugin governance

- **WHEN** a project generated by `create-nextagent-plugin` builds successfully and its generated metadata test passes
- **THEN** the plugin SHALL still require normal `agent-app` loader, `plugin.json`, static import scan, host external, Agent activation, capability, policy and hook validation before use in startup composition
- **AND** scaffold output MUST NOT create default Agent bindings, default policy activation, system config entries or runtime plugin registry facts

### Requirement: Plugin logic is testable without app deployment

`agent-test-kit` SHALL provide a plugin test harness for intelligent-agent plugin developers to test already imported plugin objects without starting `createComposedApp` and without deploying the plugin through `agent-app`。`@nextagent/agent-test-kit` MUST export `createPluginTestHarness(plugin, options?)`。The function MUST accept an already materialized `NextAgentPlugin` object and optional test-only options containing `toolDependencies?` and `defaultAgentScope?` safe Agent scope facts。

The harness SHALL use public plugin SDK / contract shapes to invoke plugin logic directly. It SHALL support at least these developer-facing test operations: invoking a Tool by explicit `providerId` and Tool capability id, evaluating an `agentRoutingPolicy` implementation by explicit `policyId` with the same `RequestRun` / `RequestContext` shape as the core routing policy, and executing a lifecycle hook by explicit `hookId` with public hook input/output contracts。The harness MUST NOT read system config, `plugin.json`, plugin directories, bundle files, host `node_modules`, plugin private `node_modules`, raw Agent config, gateway records, or local filesystem paths；MUST NOT perform dynamic import, import specifier static scanning, host external version validation, app readiness calculation, Agent assembly compilation, or `agent-app` plugin registry freezing。

The harness SHALL be a test-only authoring aid. Passing plugin harness tests SHALL NOT prove the plugin is loadable, correctly bundled, manifest-valid, Agent-activated, or production-ready；loader, manifest, static scan, activation compiler, capability integration, policy wrapper and hook registry behavior remain covered by their owning `agent-app` / `agent-capability` / `agent-core` / `agent-runtime` tests。

#### Scenario: Developer tests a plugin Tool without app deployment

- **WHEN** a developer imports `myPlugin` in a unit test
- **AND** creates `createPluginTestHarness(myPlugin, { toolDependencies })`
- **AND** calls `invokeTool("telecom-diagnostics.alarm-tools", "parse-alarm-log", { alarmLog: "..." })`
- **THEN** the harness SHALL invoke only the matching plugin provider's Tool logic
- **AND** it SHALL pass the supplied test-only Tool dependencies to the Tool execution path
- **AND** it MUST NOT start `createComposedApp`, read `plugin.json`, dynamic import the plugin bundle, or validate host externals

#### Scenario: Harness does not replace loader or activation validation

- **WHEN** a plugin object passes `createPluginTestHarness` Tool, policy or hook tests
- **THEN** the system SHALL still require separate loader, manifest, static scan, Agent activation and governed integration tests before the plugin can be considered valid in startup composition
- **AND** the harness MUST NOT create `AgentAssembly.policies`, `AgentAssembly.capabilityBindings`, startup hook registry entries or plugin registry snapshots

### Requirement: Hook plugins reuse lifecycle hook execution semantics

插件 hook MAY 贡献由 `defineLifecycleHook(...)` 生成的 `LifecycleHook` implementation object。插件作者 MUST 从 `agent-plugin-sdk` 导入 `defineLifecycleHook(...)` authoring helper。该 hook MUST 继续遵守完整 lifecycle hook execution 的 stage vocabulary、effects、outcome、failure mode、timeout、configure/config、排序、mutation 校验、pending intent handoff 和 HookInvocationEvent 语义。

Plugin composition MUST pass valid plugin hook objects to the startup hook registry as already-composed inputs. Agent hook activation MUST be authored in `agent.yaml.hooks` and compiled to `AgentAssembly.hooks`; hook binding, execution mode, decision vocabulary and per-Agent hook activation are owned by the lifecycle hook contract and Agent assembly compiler.

Hook executor MUST use the current accepted Agent's frozen `AgentAssembly.hooks` activation snapshot。Startup hook registry materialized facts and `AgentAssembly.hooks` together determine which plugin hook executable runs for the accepted request.

#### Scenario: Activated Hook runs at configured stage

- **WHEN** 插件贡献 `hookId="telecom.terminal-safety"` 的 `LifecycleHook` implementation object
- **AND** Agent 的 `agent.yaml.hooks` enabled 该 hook 并收窄到 `BEFORE_AGENT_TERMINAL`
- **THEN** 当前 Agent 的 request 到达 `BEFORE_AGENT_TERMINAL` 时 SHALL 按 lifecycle hook execution 规则调用该 handler
- **AND** 其它 Agent SHALL execute the handler only when their own `AgentAssembly.hooks` activates it

#### Scenario: Hook plugin cannot define unsupported stage

- **WHEN** 插件 hook object 或 Agent hook activation 引用不在 `LifecycleStage` vocabulary 中的 stage
- **THEN** 该 hook object 或 Agent activation MUST be rejected during startup/assembly validation
- **AND** runtime hook execution SHALL require successful startup/assembly validation

### Requirement: Plugin diagnostics are safe and auditable

插件加载、插件 provider/policy/hook 校验、Agent activation、插件 Tool/policy/hook 执行相关诊断 SHALL 只暴露 safe fields。允许的 stable refs 包括 plugin id、provider id、capability id、policy point id、policy id、hook id、agent id、agent version、agentAssemblyRef、safe reason code、bounded safe summary 和低基数 outcome。

safe error、stream、structured log、audit、metric label 和 trace attribute SHALL use the safe projection above；本地绝对路径、raw config、secret、credential、prompt、model output、tool arguments、tool result、raw provider response、stack trace 和高基数字段属于安全诊断非目标字段。

#### Scenario: Plugin activation failure emits safe diagnostic

- **WHEN** Agent activation 因缺失 policy/hook 或非法 policy point 失败
- **THEN** 系统 SHALL emit safe config/assembly diagnostic
- **AND** diagnostic MAY include plugin id、provider id、policy id、policy point id、hook id、agent id、agent version 和 safe reason code
- **AND** diagnostic SHALL use only the safe diagnostic projection
