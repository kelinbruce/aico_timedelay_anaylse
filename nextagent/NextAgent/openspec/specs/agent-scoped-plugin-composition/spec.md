 agent-scoped-plugin-composition Specification

## Purpose

Define trusted startup-only, Agent-scoped local TypeScript plugin composition for capability providers, lifecycle hooks, and explicitly open policy points, while preserving existing capability governance, lifecycle hook execution, routing policy semantics, and safe diagnostics.

## Function

- **所属 Function**：`FN-10.2 装配插件`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: Plugins load only during trusted startup composition

系统 SHALL 只在受信启动期根据系统配置 `plugins[]` 中显式声明的本地目录加载插件。`plugins[]` MUST 最多包含 8 个条目；每个目录 MUST 位于 `configRoot` 内并包含 `plugin.json`，且 `plugin.json.main` MUST 指向同一插件目录中的单文件 `.js` bundle。系统 MUST 在 readiness 前校验 system config、plugin directory、manifest、bundle export、plugin id/version/API version、provider/policy/hook shape、schema、required dependency、host externals 与 safe description，并形成冻结的 `PluginRegistrySnapshot`。重复 plugin id、超过插件上限或超过单插件 provider 上限 MUST 在启动校验中安全失败。

`createNextAgentApp`、`createComposedApp`、`createNextAgentAppAsync` 与 `createComposedAppAsync` SHALL 在配置非空且调用方未提供受信 `PluginRegistrySnapshot` 时支持上述加载。同步 materialize 的 object/factory MUST 在同步和异步启动入口产生等价的冻结快照与失败结果；异步入口 MUST await 返回 `Promise<NextAgentPlugin>` 的 factory，同步入口 MUST 在 readiness 前安全拒绝该 factory。调用方提供受信快照时，系统 MUST 直接消费该快照且 MUST NOT 再读取对应插件目录或 bundle。

`plugin.json.apiVersion` MAY 声明插件使用的 major/minor plugin API。API `1.1` 与 `1.2` factory artifact MUST 在 manifest 中显式声明 `apiVersion`，使系统可在 materialize 前选择唯一 host shape。兼容的 object export 或 API `1.0` factory 省略该字段时，系统 MUST 优先使用 materialized export 的 `apiVersion`，两处均未声明时 MUST 使用 root compatibility version `1.0`；省略 MUST NOT 隐式启用更高版本 factory host。root `definePlugin(...)` helper MUST 默认使用 `1.0`。latest version MUST 为 `1.2`，supported versions MUST 恰好为 `1.0`、`1.1` 与 `1.2`。manifest/export 版本不一致或版本不受支持时，系统 MUST 在接受插件贡献前安全拒绝；`plugin.version` MUST NOT 代替 plugin API version。

插件开发者 MAY 在构建期使用三方依赖，但 runtime artifact MUST 为自包含单文件 bundle；唯一例外是 `plugin.json.hostExternals` 显式声明且由 host inventory 开放的依赖。inventory MUST 恰好开放 `typebox` 与 `ajv` 两个 `OPEN` external id。API `1.0` factory host MUST 只含 `{ externals }`；API `1.1` MUST 只含 `{ externals, developerDiagnostics }`；API `1.2` MUST 只含 `{ externals, developerDiagnostics, runtime }`。API `1.1` 与 `1.2` artifact MUST 使用 factory default export，即使 `hostExternals` 为空。后续 host shape 变化 MUST 通过新的 plugin API version 定义。

系统 MUST 在执行 bundle 前扫描 static import declaration、带 `from` 的 re-export 与 string-literal dynamic `import(...)`。bundle 中存在 runtime import specifier、未知/关闭/版本不兼容的 host external、非 factory artifact 声明 `hostExternals`，或 bundle 需要未打包 runtime dependency 时，系统 MUST 在 readiness 前安全拒绝。插件加载 authority MUST 只来自受信启动配置；启动完成后，请求路径 MUST 只消费冻结快照与当前 Agent activation facts。

**需求类别**：功能性需求

#### Scenario: 启动期加载已声明的本地插件目录

- **WHEN** 系统配置声明合法的本地插件目录、manifest、自包含 bundle 与 supported plugin API version
- **AND** host externals 为空或只声明兼容的 `typebox` / `ajv`
- **WHEN** 系统通过同步或异步启动入口启动
- **THEN** 系统 MUST 在 readiness 前校验并冻结插件贡献
- **AND** 请求执行 MUST 只使用该冻结快照与当前 Agent activation facts

#### Scenario: 异步启动等待异步 factory

- **WHEN** 合法 plugin factory 返回 `Promise<NextAgentPlugin>`
- **AND** 系统通过异步启动入口启动
- **THEN** 系统 MUST await factory
- **AND** MUST 按普通 plugin export 的同一规则校验并冻结结果

#### Scenario: 同步启动拒绝异步 factory

- **WHEN** 合法 plugin factory 返回 `Promise<NextAgentPlugin>`
- **AND** 系统通过同步启动入口启动且调用方未提供受信预加载快照
- **THEN** 系统 MUST 在 readiness 前安全拒绝
- **AND** diagnostic MUST 使用不暴露 bundle source 或 raw error 的 safe reason code

#### Scenario: 同步启动消费受信预加载快照

- **WHEN** 调用方向同步启动入口提供受信 `PluginRegistrySnapshot`
- **THEN** 系统 MUST 消费该快照
- **AND** MUST NOT 为对应配置再次读取插件目录、manifest 或 bundle

#### Scenario: 非法插件 artifact 在边界安全失败

- **WHEN** plugin id 重复、容量越界、目录逃逸/缺失、manifest/main 非法、API version 不受支持/不一致，或 contribution shape/schema/dependency 非法
- **THEN** 同步与异步启动入口 MUST 在 readiness 前拒绝该插件
- **AND** diagnostic MUST 只包含 safe plugin/config reason code 与有界摘要

#### Scenario: Host utility external 通过 factory 注入

- **WHEN** manifest 声明兼容的 `typebox` 或 `ajv`
- **AND** bundle 使用匹配 plugin API 的 factory default export
- **THEN** factory host MUST 在对应 `externals` 字段提供该工具
- **AND** materialized plugin MUST 继续经过相同启动校验与冻结

#### Scenario: 关闭的 host external 安全失败

- **WHEN** manifest 声明 inventory 之外的 host external id
- **THEN** 系统 MUST 在 readiness 前拒绝该插件
- **AND** diagnostic MUST 只包含 safe plugin id、external id 与 safe reason code

#### Scenario: Bundle runtime import specifier 安全失败

- **WHEN** bundle 含 static import、带 `from` 的 re-export 或 string-literal dynamic `import(...)`
- **THEN** 系统 MUST 在执行 bundle 前拒绝该插件
- **AND** diagnostic MUST 只包含 safe plugin id、specifier category 与 safe reason code

#### Scenario: 请求输入不能加载插件

- **WHEN** request body、client metadata、model output、SkillHub package、remote URL 或未授权 Agent package path 携带 plugin id、module path、代码片段或 dynamic import 指令
- **THEN** 请求执行 MUST 继续只使用启动期冻结的插件快照与当前 Agent activation facts

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

系统 SHALL 定义面向智能体二次开发者的开放 policy 清单。每个 policy point MUST 声明稳定 policy point id、状态、owning module、冻结 executable contract、timeout 来源、failure semantics、安全测试事实以及是否允许 Agent-scoped plugin replacement。插件 manifest 和 Agent 配置 MUST 只引用开放 policy 清单中的 policy point id。

`agent-plugin-sdk` SHALL 为同一清单暴露面向 plugin 的开放 policy authoring surface。它 MUST 导出开放 policy point id vocabulary、通用 `PluginPolicy` contribution shape、`agentRoutingPolicy` authoring helper `defineAgentRoutingPolicy(...)`，以及 `OPEN` policy point 对应的 `AgentRoutingPolicy`、`AgentRoutingPolicyExecutable` 和 `AgentRoutingPolicyResult` type。SDK MAY 从 `agent-contracts` subpath re-export durable public contract type，但 MUST NOT 依赖 `agent-core` 实现或持有 policy runtime execution。`RESERVED` policy point id MAY 作为不可激活条目出现在 SDK inventory metadata 中，但 SDK MUST NOT 为 `RESERVED` policy point 提供 implementation helper。

policy point 状态 SHALL 只包含 `OPEN` 和 `RESERVED`。`OPEN` policy point MAY 由插件实现并用 Agent 激活；`RESERVED` policy point MUST NOT 被激活，只有 owning spec 冻结 executable contract 并将状态变更为 `OPEN` 后才 MAY 开放。

首版开放 policy 清单 SHALL 精确包含以下条目：

| policy point id | status | owner | contract | 触发边界 | 插件失败语义 |
| --- | --- | --- | --- | --- | --- |
| `restrictedOperationPolicy` | `RESERVED` | `agent-runtime` | 未冻结；状态变更为 `OPEN` 前 MUST NOT 提供 executable contract | 受限操作执行前，包括 capability invocation、sandbox dynamic execution 和 authorization/high-risk confirmation 的 risk policy enforcement 边界 | MUST NOT 激活 |
| `agentRoutingPolicy` | `OPEN` | `agent-core` | existing core `AgentRoutingPolicy.decide(RequestRun, RequestContext, AbortSignal)` / `AgentRoutingPolicyResult`; result SHALL align with `agent-contracts/core.AgentRoutingDecision` | 请求进入 Agent 后选择模型循环、定向 Skill/Workflow、澄清、拒绝或人机接管等处理路径 | fail closed to safe routing rejection |
| `modelSelectionPolicy` | `RESERVED` | `agent-context-engine` | 未冻结；状态变更为 `OPEN` 前 MUST NOT 提供 executable contract | 为主 Agent loop、summary、memory、session 助理和 workflow 等模型调用目的，从当前 Agent 激活模型集合中选择 initial 或 fallback profile | MUST NOT 激活 |
| `modelFallbackPolicy` | `RESERVED` | `agent-core` / `agent-context-engine` | 未冻结；状态变更为 `OPEN` 前 MUST NOT 提供 executable contract。前者只拥有 fallback lifecycle gate，后者拥有 fallback model selection | 模型调用失败、超时、限流或不可用后决定是否允许 fallback，并在允许时选择下一模型 | MUST NOT 激活 |
| `contextWindowPolicy` | `RESERVED` | `agent-context-engine` | 未冻结；状态变更为 `OPEN` 前 MUST NOT 提供 executable contract | 在模型上下文窗口内分配 history、attachment、Skill disclosure、system prompt、summary 等预算 | MUST NOT 激活 |

可激活 policy point set SHALL 恰好等于上表中的 `OPEN` 条目。`redactionPolicy`、`promptAssemblyPolicy`、`capabilityConflictResolutionPolicy`、`observabilityProjectionPolicy`、`authorizationAnswerPolicy` 和 `gatewayRetryPolicy` 属于非目标边界。

`agentRoutingPolicy` SHALL 使用由 `agent-core` 拥有且仅通过 public contract subpath 暴露的既有 core routing policy executable contract：`decide(run: RequestRun, context: RequestContext, signal: AbortSignal)`。`agentAssemblyRef` MUST 保持为 `RequestRun` 上 accepted request 的 frozen assembly ref。`acceptedInputText` MUST 与当前 routing policy baseline 消费的既有 `RequestContext.acceptedInputText` 保持相同名称和语义；core routing adapter MUST 原样传递该字段，不增加 summary、redaction、truncation 或 wrapper-level field projection。未来若收窄该输入边界，收窄规则 MUST 在 routing business contract 中定义，并 MUST 同等适用于 built-in 和 plugin routing policy。

`AgentRoutingPolicyResult` SHALL 使用 `agent-contracts/core` 的 public `AgentRoutingDecision` shape：`kind: RoutingDecisionKind`、`safeReason: string`、可选 `evidenceRef?: string` 和可选 `skillName?: string`。允许的 `kind` 值是既有 `RoutingDecisionKind` vocabulary：`DETERMINISTIC_FLOW`、`MODEL_DRIVEN_LOOP`、`CLARIFY`、`REJECT` 和 `HUMAN_HANDOFF`。系统 SHALL NOT 增加 plugin-specific routing result field。accepted assembly materialization 或 recipe/workflow implementation detail 等内部 `agent-core` routing field 保持在 `agent-core` 内部，并 SHALL 由 core routing adapter 或 routing implementation 增加，而不是由 plugin evaluator 返回。

除 `decide(...)` 和 `timeoutMs` 外，`AgentRoutingPolicy` implementation object MAY 声明 `configSchema` 和 `configure(config)`。`configure(config)` SHALL 返回带有 `decide(...)` 的 `AgentRoutingPolicyExecutable`。存在 `configSchema` 时，`AgentAssembly.policies.config` MUST 根据该 schema 校验，并 SHALL 仅由 runtime startup materialization 用于创建 assembly-specific policy executable。raw policy config MUST NOT 加入 routing policy execution input。

`agent-runtime` SHALL 根据 app composition 提供的 frozen plugin policy contribution materialize startup policy registry/resolver。该 materialization 只在 startup/assembly-scoped materialization 和 lookup 方面与 lifecycle hook materialization 同形：startup policy implementation 生成 default executable，带 config 的 accepted `AgentAssembly.policies` activation 生成以 `agentAssemblyRef + policyPointId + pluginId + policyId` 为 key 的 assembly-specific configured executable。plugin loading、Agent assembly compilation 或 policy registry materialization 期间，非法 policy activation reference、同一 policy point 的重复 enabled activation、非法 config 或不可用 executable implementation MUST 在 app/request readiness 前失败。resolver SHALL 接收 accepted Agent scope facts（`agentId`、`agentVersion`、`agentAssemblyRef`）和 `policyPointId`，加载 accepted Agent assembly，校验 assembly ref，选择该 assembly 针对请求 policy point 的 enabled `AgentAssembly.policies` binding，并从 assembly-specific executable map 或 fallback startup executable 解析具体 executable。存在 enabled binding 时，policy point lookup SHALL 返回 resolved policy entry；没有激活 binding 时 SHALL 返回 `undefined`。registry/resolver MUST 是可枚举 `AgentPolicyExecutableByPoint` mapping 上的 container 和 lookup mechanism：它 MUST 保留每个 policy point 自身的 executable shape，而不是强制全部 policy point 使用 `agentRoutingPolicy` input/output 或 method shape。每个 policy point owner SHALL 在执行前提供自己的 typed adapter。系统 SHALL 只通过 routing typed adapter 执行 `agentRoutingPolicy` 这一 `OPEN` point，`RESERVED` point 保持不可激活。

core `agentRoutingPolicy` adapter SHALL 先执行由 `agent-routing-core` spec 定义的显式路由解析（指令解析、约束治理、capability scope 校验和 `mode=policy` 规则匹配），再根据结果决定是否委托给路由策略实现。当显式路由解析产生路由决策时（命中或 miss 降级），adapter MUST 直接采用该决策，并且 MUST NOT 调用任何路由策略实现（plugin 或 built-in）。当显式路由解析未产生路由决策（policy 规则未匹配或无显式指定）时，adapter MUST 按以下顺序委托：存在 enabled plugin binding 时调用 resolved plugin policy；否则委托给系统 built-in routing policy。adapter MUST NOT 为不可用 plugin policy activation 增加第三种 runtime routing state；非法 activation 或 registry materialization MUST 在请求执行前被拒绝，而 plugin policy execution failure、timeout 或非法结果 MUST fail closed 为安全 routing rejection。`agent-core` SHALL 把 policy resolver 作为 runtime dependency 接收，并且 MUST NOT 读取 plugin config、plugin registry、plugin path 或 Agent raw config 来选择 plugin evaluator。

**需求类别**：功能性需求

#### Scenario: Agent 激活开放 routing policy

- **WHEN** 插件 manifest 贡献 `policyPointId="agentRoutingPolicy"` 的 implementation
- **AND** Agent `policies` 配置显式激活该 policy implementation
- **AND** `agent-app` 将该 activation 编译为 `AgentAssembly.policies` 中的 implementation-free binding fact
- **THEN** plugin loader MUST 根据开放 policy inventory 校验 contribution
- **AND** app/runtime composition MUST 为 accepted `agentAssemblyRef` materialize configured executable
- **AND** Agent core SHALL 通过 `agentRoutingPolicy` adapter 解析并调用 plugin routing policy
- **AND** runtime、capability、model 和 channel path SHALL 通过 core routing adapter 获得选定的路由行为
- **AND** routing policy adapter MUST 使用注入的 policy resolver，根据 accepted Agent 的 `AgentAssembly.policies` 和 runtime implementation registry 选择 implementation
- **AND** 该 implementation 的失败、timeout 或非法输出 MUST fail closed 为安全 routing rejection

#### Scenario: 未激活 routing policy 的 Agent 使用 built-in routing

- **WHEN** accepted Agent 的 `AgentAssembly.policies` 缺失、为空或不包含 enabled `agentRoutingPolicy` binding
- **THEN** core routing policy adapter MUST 委托给系统 built-in routing policy
- **AND** `agent-core` MUST NOT 读取 plugin registry 或 raw Agent config 来选择 plugin evaluator

#### Scenario: 显式路由指定优先于 plugin routing policy

- **WHEN** Agent 配置了 enabled `agentRoutingPolicy` plugin binding
- **AND** accepted request 包含 `$skill:` / `$workflow:` 指令、`targetRecipe` / `targetSkill` 约束或匹配的 `mode=policy` 规则
- **AND** 显式路由解析产生路由决策
- **THEN** adapter MUST 直接采用显式路由决策
- **AND** plugin routing policy MUST NOT 被调用

#### Scenario: policy 规则未匹配或无显式指定时 plugin routing policy 被正常调用

- **WHEN** Agent 配置了 enabled `agentRoutingPolicy` plugin binding
- **AND** 显式路由解析未产生路由决策（无指令、无约束、policy 规则未匹配或未配置）
- **THEN** adapter MUST 委托给 plugin routing policy
- **AND** plugin 接收的 `RequestContext` 与既有契约保持一致

#### Scenario: 拒绝 Reserved policy point

- **WHEN** 插件 manifest 或 Agent 配置引用 `restrictedOperationPolicy`、`modelSelectionPolicy`、`modelFallbackPolicy` 或 `contextWindowPolicy`
- **THEN** 系统 MUST 拒绝该 plugin policy 或 Agent activation
- **AND** 系统 MUST 产生 safe diagnostic，说明该 policy point 为 `RESERVED`
- **AND** policy point 处于 `RESERVED` 时，execution path creation SHALL 保持不可用

#### Scenario: 拒绝未知 policy point

- **WHEN** 插件 manifest 或 Agent 配置引用 `redactionPolicy`、`promptAssemblyPolicy` 或任何不在开放 policy 清单中的 policy point id
- **THEN** 系统 MUST 拒绝该 plugin policy 或 Agent activation
- **AND** 系统 MUST 产生 safe diagnostic
- **AND** policy execution path creation SHALL 仅限开放 inventory 条目

### Requirement: 插件 factory host 提供受治理 runtime services

系统 MUST 保持 `AgentRoutingPolicyExecutable.decide(run, context, signal)` 三个既有参数的名称、顺序和语义，MUST NOT 为官方 router 增加第四个 router-specific operations/context 参数。plugin API `1.2` factory host MUST 增加 required closed `runtime` services，且该对象 MUST 只包含 Agent assembly lookup、Capability catalog、Capability invocation、model selection、model invocation 与 prompt template resolution 的 public contract ports。系统 MUST 在 readiness 前为 factory 提供稳定且完整可用的 runtime host；无法提供时 MUST 安全失败且 MUST NOT 接受请求。

插件 MUST 使用 accepted `run/context` 构造这些 public ports 的 Agent Scope、Owner Scope、session、request 与 run coordinates。runtime services MUST NOT 暴露 raw Agent definition、credential、provider route、gateway implementation、workspace path、plugin registry、request lifecycle owner、全局配置或 implementation package object。Capability 调用 MUST 继续经过 `CapabilityInvocationPort` 的现有治理，model selection MUST 继续经过 `ModelSelectionService`，prompt resolution MUST 继续经过 `PromptTemplateResolverPort`。`runtime` MUST NOT 包含 `extensions`、string index signature、动态 service lookup、service inventory 或未被本 Requirement 定义的占位 service；后续改变 required service shape MUST 通过新 plugin API version 定义。

官方 plugin SDK MUST 导出 `agent-router-plugin` authoring/deployment surface，至少包含稳定 `pluginId=agent-router-plugin`、稳定 `policyId=agent-router-plugin.auto-routing`、严格 config schema、接收 runtime services 并创建 plugin object 的 helper，以及生成 `plugin.json` 与自包含单文件 `index.js` 的 artifact helper。生成的 artifact MUST 使用 plugin API `1.2`、factory default export 和空 `hostExternals`，并 MUST 继续经过既有 trusted startup validation、静态 import scan、manifest validation 与 Agent policy activation；artifact helper MUST NOT 修改 system config、Agent bindings、RAG indexes 或 RAG provider selection。

**需求类别**：功能性需求

#### Scenario: 宿主通过factory提供runtime services

- **WHEN** 系统 materialize plugin API `1.2` factory
- **THEN** factory MUST 收到 closed `runtime` services
- **AND** configured policy 的 `decide` MUST 仍只接收既有 `run`、`context`、`signal`
- **AND** factory host MUST NOT 向该调用增加 router-specific Tool、Prompt、模型或候选选择操作

#### Scenario: 官方router独立调用受治理Tool

- **WHEN** 官方 `agent-router-plugin` 的 configured RAG 预筛被触发
- **THEN** plugin MUST 通过 runtime `CapabilityInvocationPort` 调用当前 Agent bound `Rag` Tool
- **AND** Tool MUST 继续经过既有 Capability governance

#### Scenario: 三参数policy contract保持不变

- **WHEN** core 调用任意已激活 routing plugin policy
- **THEN** 该 policy MUST 只接收语义不变的 `run`、`context`、`signal`
- **AND** official router 的 runtime service 使用 MUST NOT 改变其它 policy 的 contributions 或结果

#### Scenario: runtime services 不可用时安全失败

- **WHEN** plugin API `1.2` factory 所需 runtime services 在 readiness 前不可用
- **THEN** 系统 MUST fail closed 且 MUST NOT 接受请求
- **AND** MUST NOT 形成可被 Agent 激活的 router policy

#### Scenario: runtime services保持closed surface

- **WHEN** plugin API `1.2` factory读取宿主提供的 `runtime`
- **THEN** public object MUST 只包含本 Requirement 定义的六类 public ports
- **AND** plugin MUST NOT 通过通用扩展袋、动态 service name 或 inventory 获得未定义服务

#### Scenario: 生成可部署agent-router-plugin artifact

- **WHEN** 插件开发者调用 artifact helper 指定空目录
- **THEN** helper MUST 生成 `plugin.json` 与自包含单文件 `index.js`
- **AND** manifest MUST 声明稳定 plugin id、plugin API `1.2`、factory default export 对应 main 和空 `hostExternals`
- **AND** helper MUST NOT 创建或修改 system config、Agent definition、policy activation 或 capability binding

### Requirement: 本地runtime包携带agent-router-plugin但不默认激活

本地 runtime 打包 MUST 在每个 backend-capable candidate 中携带官方 `agent-router-plugin` artifact，目标目录 MUST 为 `config/plugins/agent-router-plugin/`。artifact MUST 至少包含 `plugin.json` 与自包含单文件 `index.js`。

随包携带 artifact 只表示 operator 可在 trusted system config 与目标 Agent policy 中显式启用。package config sample MUST NOT 为 `agent-router-plugin` 增加 `nextAgent.system.plugins[]` entry，packaging MUST NOT 修改默认 Agent 的 `policies[]`、capability bindings、RAG config 或模型配置。未显式配置并激活时，该 artifact MUST NOT 参与 routing。

**需求类别**：功能性需求

#### Scenario: backend-capable运行包包含未激活router artifact

- **WHEN** local runtime packaging stages a `backend-only` or `with-frontend` candidate
- **THEN** candidate MUST contain `config/plugins/agent-router-plugin/plugin.json`
- **AND** candidate MUST contain `config/plugins/agent-router-plugin/index.js`
- **AND** manifest MUST 声明 `pluginId=agent-router-plugin`、`apiVersion=1.2`、`main=./index.js` 与空 `hostExternals`
- **AND** `config/default-system.yaml` MUST NOT declare `agent-router-plugin` in `nextAgent.system.plugins[]`
- **AND** default Agent MUST NOT activate `agent-router-plugin.auto-routing`

### Requirement: Plugin Tool authoring 使用统一展示名称契约

Plugin Tool authoring 的 frozen `DefineToolInput` 与 `ToolMetadata` MUST 继续使用 `name` 作为 canonical Tool identity，并 MUST additive 支持 optional stable `displayName` 和 optional `locales`。`displayName` 缺失时 plugin Tool Provider MUST 使用 `name` 作为 stable descriptor `displayName`；`locales` 的结构和校验边界 MUST 与 `CapabilityDescriptor.locales` 相同。

**需求类别**：功能性需求

Plugin SDK `defineToolProvider(...)` MUST 按统一 Tool descriptor 规则投影名称，并 MUST 在现有 Plugin API version 下保真暴露这些 backward-compatible optional fields。Stable `displayName` MUST 保留 Capability descriptor 的既有消费者语义；`locales` MUST 只参与 presentation。Tool 名称事实 MUST NOT 改变 provider identity、Tool name、Agent binding、conflict resolution、model-visible description、schemas、configuration、dependency、execution、risk policy、sandbox、权限或审计。插件也可以通过 `defineCapabilityProvider(...)` 直接返回满足统一 contract 的 Tool descriptor；两种 plugin authoring path MUST 进入同一个 Catalog governance path。

#### Scenario: Plugin Tool 提供中英文名称

- **WHEN** plugin `defineTool(...)` 提供 canonical `name`、稳定 `displayName` 以及合法 `zh-CN`、`en-US` 名称
- **THEN** `defineToolProvider(...)` 产生的 Tool descriptor MUST 逐值保留这些展示事实
- **AND** Tool identity 和模型调用名称 MUST 继续使用 canonical `name`

#### Scenario: Plugin Tool 未提供展示扩展

- **WHEN** plugin Tool 只提供既有 `name`、description 和 schemas
- **THEN** Tool descriptor MUST 使用 `name` 作为稳定 `displayName`
- **AND** Tool registration、discovery 和 invocation MUST 继续成功

#### Scenario: Stable displayName 进入既有目录消费者

- **GIVEN** plugin Tool 同时提供 canonical `name=lookup_alarm` 和 stable `displayName=Alarm lookup`
- **WHEN** Tool descriptor 被目录或 ToolSearch 读取
- **THEN** Tool identity 和模型调用名称 MUST 保持 `lookup_alarm`
- **AND** 读取 descriptor stable name 的结果 MUST 使用 `Alarm lookup`

#### Scenario: Tool 展示名称非法

- **WHEN** Tool authoring metadata 提供非法稳定 `displayName` 或非法 `locales`
- **THEN** provider assembly or descriptor validation MUST fail closed
- **AND** 系统 MUST NOT 以部分名称注册该 Tool
