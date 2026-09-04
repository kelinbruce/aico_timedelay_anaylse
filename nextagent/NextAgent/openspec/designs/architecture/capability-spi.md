# Capability SPI Governance

本设计承载 capability provider、discovery、catalog、executor 和 result consumption 的长期设计事实。行为性验收要求由 `openspec/specs/capability-catalog/spec.md` 和 `openspec/specs/ts-core-contracts/spec.md` 承载；本文件只记录跨模块设计和取舍。

## Deferred capability discovery

`ToolSearch` 由 context assembly 默认披露为 bootstrap Tool，并只搜索当前请求受治理的 `AVAILABLE`、非 `HIDDEN`、`modelInvocable=false` Tool 或 Skill descriptor。命中结果仅形成 request-local activation patch；下一模型 step 才可调用 concrete Tool 或加载 Skill。provider-private descriptor facts 不穿过该投影边界。

## 统一契约

Tool、Skill 和 Agent 都是 Capability 类型，必须复用 `agent-contracts/capability` 的 `CapabilityProviderIdentity`、`CapabilityProvider`、`CapabilityDescriptor`、`CapabilityCatalog`、`CapabilityInvocationRequest`、`CapabilityInvocationResult` 和 `CapabilityInvocationPort`。Skill descriptor metadata 和 manifest diagnostics 还必须复用 `SkillMetadata`、`SkillManifestDiagnostic` 和 `architecture/skill-manifest-contract.md` 定义的 parser/mapper/accessor 边界。实现包不得为某一类 provider 或 source 定义平行 descriptor、catalog、invocation envelope、result DTO、manifest DTO 或 capability kind vocabulary。

Tool framework 的 public contract update 只是在 `CapabilityDescriptor` 增加 `outputSchema?`，用于描述成功 invocation 的 `structuredPayload`。Tool authoring SPI 留在 `agent-capability`，不得进入 `agent-contracts` 形成 `ToolDescriptor`、`ToolInvocationRequest`、`ToolInvocationResult` 或 `ToolSource`。

`CapabilityProviderIdentity` 是 descriptor 中的轻量 provider identity，只包含 `providerId`、`providerKind` 和可选 `providerType`。runtime registration unit 是 `CapabilityProvider { identity, discovery, executor? }`；identity 可以进入 descriptor、binding、diagnostic 和 ready gate，discovery/executor implementation handle 只能停留在 capability subsystem 内部。endpoint、credential reference、local directory reference、managed install reference、cache policy 和 provider-private options 只能存在于 provider config 或 adapter 内部，不得进入 descriptor、model-visible capability disclosure、stream、安全错误、audit detail 或日志。

## Provider Config

`CapabilityProviderConfig` 由 `agent-contracts/capability` owning，形态固定为 `{ provider, discoveryMode, options }`。`agent-contracts/app` 不拥有同名 DTO，也不重新定义 provider/source vocabulary。

配置只控制非 framework/reserved provider。`BUNDLED` provider 和其他 reserved provider 由 `agent-capability` 在启动期 provider contribution assembly 中可信创建；用户配置不得声明、覆盖、禁用或复用这些 provider id。当前 reserved provider baseline 是：

```text
providerId: builtin-tools
providerKind: BUNDLED
discoveryMode: EAGER

providerId: builtin-skills
providerKind: BUNDLED
discoveryMode: EAGER

providerId: builtin-agents
providerKind: BUNDLED
discoveryMode: EAGER

providerId: local-agents
providerKind: LOCAL_DIRECTORY
discoveryMode: EAGER

providerId: local-subagents
providerKind: LOCAL_DIRECTORY
discoveryMode: SEARCH

providerId: local-skills-system
providerKind: LOCAL_DIRECTORY
discoveryMode: EAGER

providerId: local-skills-agent-owned
providerKind: LOCAL_DIRECTORY
discoveryMode: SEARCH

providerId: memory-tools
providerKind: BUNDLED
discoveryMode: EAGER
```

`builtin-agents`、`local-agents` 和 `local-subagents` 是 Agent capability projection 的 reserved provider identity。`local-agents` 只表示顶层 local Agent assemblies 的 EAGER projection；`local-subagents` 只表示 parent-scoped local subagent assemblies 的 SEARCH projection。两者都不表示通用用户目录 provider，也不授权 `agent-capability` 扫描 Agent package。它们只消费 `agent-app` 提供的 compiled `AgentAssembly` facts。

`CapabilityProviderOptions` 必须按 `provider.providerKind` 校验。`CUSTOM` provider 必须包含非空 `provider.providerType`，并使用 `CustomProviderOptions.customOptions` 承载 provider-private 配置；options union 不允许裸 `JsonObject` 分支。用户 provider 配置通过 `nextAgent.system.capability-providers` 加载并解析为 `CapabilityProviderConfig[]`，当前闭集只允许 `mcp-server`、`agent-registry`、`skill-hub` 和 `custom`。用户配置不得复用 `builtin-tools`、`builtin-skills` 或任何 framework/reserved provider id；`local-directory` 不是用户配置入口，只能用于受信 startup contribution 物化的 reserved local Skill/Agent source。

`LOCAL_DIRECTORY` 不作为 framework/reserved local source 的用户控制入口。当前受信本地 Skill providers 是 `local-skills-system` 和 `local-skills-agent-owned`，由 capability startup provider contributions 从 trusted `configRoot` 和 Agent package locator facts 物化；外部配置不得复用这些 provider id。system local root 来自 frozen `configRoot/skills`，Agent-owned local root 只通过 trusted Agent package source locator 定位为 `configRoot/agents/{agentId}/skills`。

`SKILL_HUB` 是受信配置型 provider kind，但它只通过 remote gateway boundary 访问。`agent-capability` owns remote Skill content source behavior、normalized staged folder intake、manifest validation、managed install publication and provider-private installed facts; `agent-app` owns provider config validation、`gatewayId` adapter selection and injection; concrete SkillHub URL、credential、HTTP path、wire DTO、archive bytes、single-file content and service-private consistency facts remain in remote gateway or deployment adapter packages. Local-only mode cannot substitute provider-private installed contents for the remote boundary.

## Extension Registration and Provider Contributions

Framework extension registration is startup-only. The stable public SPI is `CapabilityProvider` under `agent-contracts/capability`, plus provider-bound `CapabilityDiscovery` and provider-neutral `CapabilityExecutor`. A provider binds exactly one `CapabilityProviderIdentity` to exactly one discovery object and at most one executor object. The provider `identity` is the authoritative provider fact; the discovery object must expose the same provider identity and exactly one discovery mode; the executor object intentionally does not expose provider as a public identity because provider binding is applied by `agent-capability` during assembly.

`agent-capability` assembles providers in three ordered groups:

- internal owner-owned providers, such as builtin Tool/Skill/Agent/local Skill/local Agent/local subagent sources owned by `agent-capability`;
- external owner providers returned by other owning packages through public factories, such as `agent-memory` returning the `memory-tools` provider;
- plugin providers materialized by trusted startup plugin composition;
- config-driven providers converted from validated `ResolvedCapabilityProviders.providers`.

The order is semantically significant. Internal, external owner and plugin providers define the occupied provider identity set before config-driven provider configs are normalized and converted, so user configuration cannot override, spoof, or collide with framework/reserved providers such as `builtin-tools`, `local-subagents`, owner-contributed `memory-tools`, or plugin-contributed providers.

Assembly validates provider shape, duplicate provider ids, provider/discovery mismatch, unsupported provider kind/type, missing local dependencies, malformed schema, discovery support absence, and executor support absence when those facts are determinable inside capability. Capability-owned asynchronous startup checks, such as EAGER discovery readiness and SEARCH discovery guard readiness, are surfaced through `validateStartupRegistration()`. Cross-module checks that require other assembled resources remain app ready-gate validation.

`createCapabilitySubsystem({ ... })` is the capability composition entrypoint. It accepts a single options object containing validated provider configs, external providers, plugin providers, and trusted runtime/adaptor options needed to assemble capability-owned dependencies. It returns `catalog`, `invocationPort`, `capabilityProviders`, `validateStartupRegistration()`, `collectSkillScanReport()`, and owner-provided cleanup/maintenance hooks or jobs. It must not return provider snapshots, discovery objects, executor objects, provider config options, standalone diagnostics fields, or Tool-facing dependency ports such as `WorkspaceFilePort`.

`agent-app` can call owner provider factories and pass returned providers, including plugin-materialized providers, to `agent-capability`, but it is not the provider registry owner. It does not maintain a hand-authored reserved provider list, does not import provider internals only to build registry facts, and does not compose Tool definitions for another package. App startup uses `CapabilitySubsystem.capabilityProviders` as one provider-fact input for cross-module ready validation.

Plugin providers are `CUSTOM` providers with `providerType=nextagent-plugin-tool` in the first supported version. They may contribute only `TOOL` descriptors, are limited per plugin, and become visible only through explicit Agent `capabilityBindings`; no synthetic binding is generated for plugin providers. `agent-capability` wraps plugin discovery/execution with the same validation, timeout/cancellation, safe error mapping, diagnostic field policy, duplicate capability id checks, required dependency checks and config override validation used for other providers. SEARCH discovery must be guarded by timeout/cancellation, safe error mapping and result validation before candidates enter catalog governance.

`DefineToolInput`、`ToolDefinition`、`DefineToolProviderInput` 和 runtime `CapabilityProvider` 是 public `agent-contracts/capability` shapes。`DefineToolInput` owns single Tool authoring fields: `name`、`description`、`inputSchema`、`outputSchema`、optional `configSchema`、`requiredDependencies`、`replayPolicy`、`disclosurePolicy`、`returnsCapabilityResult`、`observability`、optional `configure(config,deps?)` and required `execute(input,options?)`。It does not own provider identity、discovery mode、binding/default exposure、Agent activation、plugin id、config root or source path. `DefineToolProviderInput` is only a sugar input for standard Tool provider creation: required `providerId`、optional `providerType`、optional `description` and required `tools: ToolDefinition[]`.

First-party modules and plugin SDK may both use these public shapes. `agent-plugin-sdk` can wrap them for authoring ergonomics, but capability registration semantics remain owned here: providers enter the subsystem only after owner/app composition passes `CapabilityProvider` objects to `createCapabilitySubsystem(...)`, and `agent-capability` validates/normalizes/wraps them before catalog visibility or invocation.

## Discovery

Discovery support comes from startup provider contributions. `agent-capability` may use internal factories to construct owner-owned or config-driven discovery objects, but factory shape and count are implementation details rather than public architecture. The stable rule is deterministic contribution assembly by exact provider id/kind and, for `CUSTOM`, exact provider type. 没有匹配实现或 provider/discovery identity 不一致时，subsystem creation 或 startup registration validation 必须以安全配置错误失败，不能按注册顺序、import side effect 或隐藏全局 registry 猜测。

Discovery adapter 只返回 candidate descriptors、search results、refresh/probe facts，不拥有全局可见性、Agent binding gate、availability verdict 或 conflict resolution。`EAGER` discovery 可在 startup/refresh 注册 descriptors；`SEARCH` discovery 在 startup 只注册 query hook，由 catalog 在 `listAvailable`/`resolve` 构造 request-scope view 时按 trusted request scope 调用。Public search criteria 只能包含 safe owner/request context、`agentId`、`agentVersion`、`agentAssemblyRef` 和可选 requested capability narrowing，不得包含 runtime-facing `AgentAssembly`、`capabilityBindings`、`boundCapabilityIds`、availability verdict、routing policy 或 conflict result。

Builtin Tool discovery 使用 `ToolCatalog` 作为 `builtin-tools + EAGER` provider contribution 的 discovery implementation。后续 builtin Tool 注册只能通过 `defineTool` 导出显式 `ToolDefinition`，再加入 `agent-capability` owned builtin Tool list；禁止目录扫描、runtime decorator discovery、import side-effect 自注册或通过配置创建不存在于 owned list 的 Tool，也禁止在 `agent-app` 中维护 Tool 或 provider 清单作为权威来源。


Builtin Skill discovery 使用 `BuiltinSkillDiscovery` 作为 `builtin-skills + EAGER` 的 discovery implementation。它只枚举 `agent-capability` package-owned builtin Skill root 下的一级 `SKILL.md` candidate，复用标准 Skill manifest parser/mapper，输出 governed `SKILL` descriptor input、安全 readiness evidence 和 source-owned internal loading facts；不得创建第二套 Skill manifest schema、公开 loading key、读取 Agent definition、定义 execution semantics 或让外部配置替换 root/source enablement。

Local Skill discovery 使用同一 manifest parser/mapper 和 capability governance 边界。`local-skills-system + LOCAL_DIRECTORY + EAGER` 在 startup discovery baseline 扫描 `configRoot/skills`；`local-skills-agent-owned + LOCAL_DIRECTORY + SEARCH` 在 Catalog request-scope view 中通过 Agent package locator 扫描当前 Agent 的 `configRoot/agents/{agentId}/skills`。两者只枚举一级 Skill candidate，保存 source-owned loading facts 在 provider implementation boundary，不把 raw path、full Skill body、loading key 或 content loading authority 放入 descriptor、diagnostic、model context、stream、安全错误或 audit detail。

### Agent Capability Discovery

Agent discovery 进入同一 Capability Catalog，但不创建第二套 Agent catalog。`agent-app` 拥有受信 builtin/local/subagent package 编译，并暴露 app-owned `AgentDiscoverySource`；`agent-capability` 拥有最小 discovery adapter，把已编译 `AgentAssembly` facts 投影为 `CapabilityDescriptor(kind="AGENT")` candidates。

所有 Agent 来源先统一编译成 `AgentAssembly`：

- framework builtin Agent packages live under the trusted builtin Agent package root owned by `agent-core`, then are parsed and compiled by `agent-app`;
- top-level local Agent packages are resolved from frozen `configRoot/agents/{agentId}`;
- parent-local subagents are resolved from the fixed layout `agents/{parentAgentId}/subagents/{subagentId}/agent.yaml`.

这些 source differences 不改变 runtime-facing assembly shape。系统不得为 builtin Agent、top-level local Agent 或 subagent 新增平行 assembly DTO、parallel descriptor、parallel catalog 或 discovery-private execution envelope。

`AgentDiscoverySource` 是 discovery 所需的最小 port。它只列出已经编译的 safe `AgentAssembly` facts：builtin assemblies、top-level local assemblies、以及给定 parent Agent scope 下的 parent-local subagent assemblies。`agent-capability` 不读取 raw path、不解析 `agent.yaml`、不扫描 `subagents/`、不注册 prompt templates，也不持有 source loading key 作为 execution authority。Provider split is stable: builtin assemblies use `builtin-agents + EAGER`, top-level local assemblies use `local-agents + EAGER`, and parent-local subagents use `local-subagents + SEARCH`.

`AgentAssembly.agentInvocation` 决定 delegation eligibility：

- `NONE`：assembly 可以为 direct/runtime 目的存在，但不能作为 model-invocable delegation target。
- `BOUND`：当普通 Catalog governance 和显式 `AGENT` binding 允许时，该 Agent 可以成为 delegation target。
- `PARENT`：该 Agent 只在精确匹配的 trusted `parentAgentScope` 下作为 local subagent 可见。

`userInvocable` 决定 direct/default-route user selection，本身不授权 model delegation。`parentAgentScope` 属于 child assembly，不属于 public descriptor。`CapabilityDescriptor(kind="AGENT")` 只能暴露 Catalog/model disclosure 所需的 safe display 和 availability facts；不得暴露 raw package paths、agent.yaml contents、prompt/Skill/subagent body、source loading keys、child assembly objects、workspace paths、provider secrets 或 execution authority。

Discovery remains side-effect-free. It must not create child runs、sessions、messages、timeline events、checkpoints、artifacts or audit facts. If an Agent descriptor is resolved for execution later, the execution path must go back through `AgentAssemblyRegistry.require(descriptor.capabilityId, descriptor.version)` instead of descriptor metadata or discovery-private source facts.

## Builtin Tool Framework

Tool 是 `Capability(kind="TOOL")` 的开发和执行模型，不是新的系统间协议。Tool 开发者声明 provider-neutral `ToolMetadata` 和业务 `Tool` 本体；框架负责 descriptor projection、config/dependency validation、input/output validation、safe failure mapping 和 result wrapping。

长期稳定设计事实如下：

- `ToolMetadata` 包含 `name`、`description`、`inputSchema`、`outputSchema`、可选 `configSchema`、可选 `requiredDependencies` 和可选 `replayPolicy`，不得包含 provider identity。
- builtin Tool 的 model-visible `description` 是统一 Capability SPI 的一部分，而不是各 Tool 自行发挥的提示文案。长期要求是：description 必须覆盖一句话总结、适用场景、误用时的路由指引，以及 schema 外但模型决策必须知道的关键行为（如输出解读、截断、hard failure、degraded failure、跨 Tool 差异和未体现在 outputSchema 的返回语义）。显式 `When to use` / `When NOT to use` / `Key behaviors` 分段是首选，但等价 prose 也可以，只要不损失语义覆盖。
- `Tool` 只暴露可选 `configure(config, deps?)` 和必需 `execute(input, options?)`；Tool implementation 不接收 `CapabilityInvocationRequest`，也不返回 `CapabilityInvocationResult`。
- `defineTool` 只是 authoring helper，返回显式 `ToolDefinition { metadata, tool }`；它不注册 Tool、不扫描目录、不读取配置、不生成 schema、不通过 import side effect 修改 catalog。无配置、无依赖 Tool 不需要声明空 config、空 dependency list、`configSchema` 或 `configure`。
- builtin Tool 通过 owned builtin Tool list 注册。当前 read 以 `readToolDefinition` 进入该 list；read descriptor 由 metadata 投影，read execution 只通过 `ToolCatalog` 和 `BuiltinToolExecutor` 产品路径发生，不保留静态 read descriptor 或 read 专用 invocation port 的第二条产品路径。
- `ToolCatalogConfig` 是 framework trusted object，不是最终用户配置文件 schema，也不进入 `agent-contracts/app`。它只能配置已注册 Tool 的 safe description override 和 `configSchema` 明确允许的 per-tool config；不得创建 Tool、禁用 builtin provider、替换 input/output schema、修改 provider identity、修改 required dependencies 或指定 execute mapping。
- Tool description 与 schema 的分工必须稳定：input field semantics、shape constraints 和 defaults 归 `inputSchema`；output interpretation、reason code 含义、read-before-write/read-before-edit 之类 schema 无法完整表达的行为语义归 `description`。description 不得复述 schema 已稳定承载的字段定义，也不得为了追求文案整齐而偏离真实实现。
- Memory tools 复用同一个 provider-scoped Tool SPI，但 provider contribution 由 `agent-memory` owning。`agent-memory` 在 memory exposure gate 所需的 trusted inputs 可用时，通过 public factory 返回 `providerId="memory-tools"` 的 startup contribution；`agent-app` 只调用该 factory 并把 returned contribution 传给 `agent-capability`。Capability SPI 不新增 memory-specific dependency name、memory registry、memory executor、memory gateway import 或 memory lifecycle 分支；descriptor visibility、schema validation 和 invocation 仍走通用 Tool path。
- `ToolDependencies` 由 `agent-capability` owner-assembled，包含 `workspaceFiles?`、`sandbox?` 和后续 change 明确加入的受控 dependency。`WorkspaceFilePort` 是 capability-owned Tool-facing boundary，负责 read/write/glob/edit、Skill resource projection、sandbox filesystem preparation、run temp and snapshot cleanup policy；`agent-app` 只提供 trusted resolver/gateway/adaptor options 并注册 owner-provided cleanup jobs，不直接创建、返回或调用 `WorkspaceFilePort`。`SandboxExecutionPort` 是 Tool-facing interface，暴露 `runShell` 和 `runPython`；本框架不实现 sandbox adapter，`agent-capability` 不因此依赖 gateway contract。
- `todoState` 是受控 Tool dependency，由 app/runtime/gateway composition 注入给 `TodoWrite`。它只暴露 current todo replacement 所需的 store-facing operations，不能把 gateway-local row、SQLite/Kysely type、owner scope override 或 runtime lifecycle handle 暴露给 Tool implementation。
- 后续 builtin file tools 可以在同一 `workspaceFiles` dependency 上扩展 `writeText`、`glob`、`editText` 等操作，但仍不得绕开同一个 resolver-backed file authority boundary、snapshot guard 和 cleanup lifecycle。
- Tool 不接收 workspace root、host absolute path、host process API、gateway-local private implementation、sandbox internals、identity、Agent Scope 或 Owner Scope 的不可信覆盖值。文件访问经 `workspaceFiles`，动态执行经 `sandbox`，依赖和执行上下文只能来自可信 composition/runtime facts。
- `ToolExecutionContext` 由 executor 从可信 request/runtime facts 构造，包含 identity、agent/run/session/request/request-context/step 坐标和 timeout；`AbortSignal` 必须传递到 Tool。

`ToolCatalog` 对 discovery 边界实现现有 `CapabilityDiscovery`：只暴露 `provider`、`discoveryMode=EAGER` 和 `listAll(signal)`。它的 executable lookup 是 `BuiltinToolExecutor` 使用的 framework-internal 能力，必须按 `provider.providerId + capabilityId` 区分 Tool；不得新增 `discover(toolName)`、`scanAndRegister(catalog)` 或替代 capability catalog 的解析接口。

`ToolCatalog` 创建时消费 trusted provider、显式 `ToolDefinition[]`、可选 `ToolCatalogConfig` 和可选 `ToolDependencies`，并按以下顺序治理：同 provider Tool name 唯一性、metadata schema shape、safe description override、per-tool config schema、required dependency availability、`configure(config, deps)`、descriptor projection 和 executable lookup 建立。未知 Tool config 必须导致 safe configuration failure；单个 Tool config 无效、依赖缺失或 configure 失败时，该 Tool 不进入 executable lookup，并产生 `availabilityStatus=UNAVAILABLE` descriptor 和安全 `availabilityReason`。无效配置不得静默忽略，也不得延迟到请求期才暴露。

Tool metadata 到 descriptor 的投影规则是：`metadata.name -> capabilityId/displayName`，`metadata.description` 或 trusted override -> `description`，`metadata.inputSchema -> inputSchema`，`metadata.outputSchema -> outputSchema`，`metadata.replayPolicy` 或默认值 -> `replayPolicy`，composition provider -> `provider`，framework constant -> `kind=TOOL`，config/dependency verdict -> `availabilityStatus/availabilityReason`。

`ToolSearch`、`AskUserQuestion` 和 `rag` 都是 builtin Tool framework 下的普通 Tool-kind entry，而不是平行 capability 机制。`ToolSearch` 是查询型 Tool：它只搜索当前 request 中 governed visible 的 Tool / Skill 元数据，并把命中的 Tool schema 激活限制在 request-local `allowedTools`，把 ToolSearch-deferred Skill 激活限制在 request-local `discoveredSkills`。`AskUserQuestion` 是 pending-input producer Tool：它只创建 runtime-owned `QUESTION` pending input，不等待答案、不拥有 resume state。`rag` 是 retrieval Tool：它只调用 compose 好的 `RagRetrievalGateway`，不拥有知识治理、索引构建或 provider 选择权。

`TodoWrite` 是 builtin Tool framework 下的 stateful Tool。It replaces the current todo list with `todos[]`, returns `{ oldTodos, newTodos }`, uses `CapabilityReplayPolicy=IDEMPOTENT`, and persists each successful invocation through the gateway-owned todo state boundary. Tool input schema rejects identity/scope fields; trusted owner scope, agent scope, session and invocation idempotency anchor come only from `ToolExecutionContext` and runtime-provided invocation context. Full todo text may be persisted and returned in the structured payload, but logs, metrics, trace and audit may only use low-cardinality counts/status/reason fields.

SkillHub acquisition is a capability-owned service path, not a catalog-query side effect. The acquisition service reuses the SkillHub source search/fetch/managed-install/index/catalog governance path and returns only safe acquisition outcomes to core. It does not mutate runtime state, publish terminal facts, or expose endpoint, credential, staged folder, installed path, raw package or provider-private loading key.

内置 Agent tool 复用 builtin Tool framework。它是 `kind="TOOL"` 的模型工具入口，输入 schema 只接受受控 Agent target 和 prompt 字段；风险/参数校验允许 schema 中声明的 Agent target 字段，但 schema 外 scope 字段必须拒绝。执行时先通过 `RuntimeCapabilityResolver` 解析 governed `kind="AGENT"` descriptor，再通过 `SubagentExecutionPort` 发起 child run。`SubagentExecutionPort` contract 归 `agent-contracts/capability`，runtime implementation 归 `agent-runtime` 并由 `agent-app` 注入；capability package 不导入 runtime subpath 或 runtime implementation。

Agent tool 的职责边界是 governance adapter，不是 lifecycle owner。它执行 input schema validation、prompt size check、self-invocation rejection、Catalog-resolved AGENT descriptor validation 和 safe result mapping。它不解析 `AgentAssembly`、不创建 session/run、不等待 timeline、不读取 child messages、不写 terminal commit、不决定 scheduler priority。所有这些 lifecycle facts 由 `SubagentExecutionPort` 的 runtime implementation 通过 runtime `submit()` path 完成。

Agent tool input 只允许 schema 中声明的 target Agent id 和 prompt。任何 schema 外的 owner scope、agent scope、session/run id、provider id、workspace root、credential、path 或 model-routing authority 都必须拒绝。risk/policy checks 可以承认 schema 内的 Agent target 字段，但不能因此放宽 schema 外 scope 字段。

## Catalog Governance

Catalog 拥有最终 request-scope governance：

- 合并 EAGER descriptors 和当前 request scope 的 SEARCH candidates。
- 将 trusted framework-default builtin Tool/Skill descriptors、system local EAGER descriptors 和当前 Agent 的 default-enabled Agent-owned local SEARCH descriptors 作为默认候选，再按 `AgentAssembly.capabilityBindings`、provider identity 和 capability id 过滤非默认候选。
- 对 default-enabled trusted SEARCH provider（当前为 `local-skills-agent-owned`）按 trusted Agent scope 搜索，但不写入 synthetic Agent binding；其他 SEARCH provider 仍需 explicit enabled binding 才会被调用。
- plugin provider 不进入 default-enabled allowlist；缺失 matching enabled binding 或 provider/condition selector 时不得搜索、列出、resolve 或 invoke plugin Tool。Provider/condition selector 只授权 SEARCH provider 被调用，返回 descriptors 仍要经过 exact disabled binding、availability/model visibility、conflict resolution 和 invocation eligibility。
- 应用同 key `enabled=false` explicit binding fact 排除默认 builtin candidate；同 key `enabled=true` 与默认候选去重。
- 排除 `availabilityStatus != AVAILABLE` 的 descriptors，除非显式诊断查询要求包含 unavailable。
- 通过共享 conflict extension point 得到当前 request scope 下按 `capabilityId` 唯一的 visible/executable view。
- `resolve` 必须与 `listAvailable` 使用同一组 gate，不得执行不可见 capability。

`AgentAssembly.capabilityBindings` 是 Agent 授权意图和 explicit disable fact，不是 descriptor 已发现快照。Assembly compiler 只校验 binding shape、安全 id、capability kind 和 registered provider id；descriptor existence、availability、conflict 和 executability 都在 catalog query/resolve 阶段判定。本地 Skill 自动可见性不得向 `AgentAssembly.capabilityBindings` 写入 synthetic enabled binding。

Agent descriptor governance 复用同一套 Catalog 规则，并增加两个 Agent-specific 规则：

- parent-local `agentInvocation="PARENT"` candidates 只在 `AgentDiscoverySource.listParentSubagentAssemblies(parentScope)` 返回的精确 parent Agent scope 下默认可见；
- 来自 builtin/top-level local source 的 `agentInvocation="BOUND"` candidates 需要经过普通 binding/catalog governance 后才可调用。

`enabled=false` binding hides a matching Agent descriptor with the same provider id, capability kind and capability id. Parent-local default visibility must not be materialized as synthetic `AgentAssembly.capabilityBindings`; it is a request-scope Catalog view. Conflict and shadowing diagnostics must use stable safe identifiers and reason codes, not source paths or package contents.

当 trusted app composition 把 Skill 或 CLIP disclosure 配置为 `tool-search` 模式时，Catalog governance 仍保持“已有可见 Tool Calling 不被 ToolSearch 模式隐藏”这一不变量。deferred 只适用于显式选择的 Skill/CLIP disclosure surface：system prompt 可以渲染轻量 `available-deferred-skills` 或 `available-deferred-clipc` 候选，`ToolSearch` 命中后再通过 request-local activation 暴露具体能力；它不得成为删减原有 model-visible Tool 列表的借口。

Existing provider exposure semantics are stable under plugin composition. Builtin Tool、builtin/system/Agent-owned Skill、parent subagent 等既有默认可见 provider 继续由 finite framework-owned default exposure allowlist 控制；top-level builtin/local Agent capability 继续需要显式 binding；`memory-tools` 继续由 memory exposure gate、AgentAssembly binding 和 frozen memory config 共同决定；SkillHub 继续采用 provider authorization controls search，再对返回 Skill descriptors 应用 readiness、conflict、availability/model visibility 和 exact disabled binding filtering。Plugin provider 不能扩大这些既有 provider 的默认可见性或 search authority。

## Execution

Execution 只通过 `CapabilityInvocationPort` 发生。Invocation port 必须先使用 catalog-resolved descriptor，再通过 provider contribution assembly 产生的 executor lookup 按精确 `descriptor.provider.providerId + descriptor.kind` 找 executor。`providerKind` 可用于 provider branch 和诊断，但不能作为唯一 executor 选择条件；没有匹配或出现多个匹配时，必须返回安全 capability failure，而不是按注册顺序选择。

Capability executor 只返回 `CapabilityInvocationResult`，不得直接写 runtime timeline、session messages、checkpoints、audit sinks、terminal commits、Agent assembly、catalog state 或 provider configuration。

`BuiltinToolExecutor` 是 builtin Tool 的 `CapabilityExecutor` implementation，不是新的 invocation port。`builtin-tools` provider contribution 将该 executor 绑定到 builtin Tool descriptors；0 个或多个匹配都必须在 Tool 执行前 safe fail，不能按注册顺序选择。Executor 使用 resolved descriptor 的 provider 和 provider-free `CapabilityInvocationRequest.capabilityId` 查找 executable Tool，按 Tool `inputSchema` 校验 request arguments，构造 `ToolExecutionContext` 并传递 `deps`/`signal`，调用 `Tool.execute(input, options)`，再按 `outputSchema` 校验输出并放入 `CapabilityInvocationResult.structuredPayload`。unknown executable、invalid input、invalid output、missing dependency、configuration failure、timeout、abort 和 Tool exception 都必须映射为安全失败结果，不泄漏 raw output、raw exception、命令/code、文件内容、stdout/stderr、credential、token、host path 或高基数字段。

Agent tool 的 subagent 调用失败、超时或取消也必须映射为安全 `CapabilityInvocationResult`，让 `agent-core` 能作为一次失败 tool result 交回模型进行修正或继续，除非 runtime lifecycle owner 明确判定当前 parent request 已不可继续。错误日志和 safe error 可以包含稳定 error code、category、target agent id、provider kind、status 和 child run/session id；不得包含 prompt、模型输出、raw provider error、host path、credential、token 或附件内容。

Remote AgentRegistry execution 不属于本地 Agent tool path。当 resolved target provider kind 需要尚未 compose 的 remote execution path 时，结果必须是 safe unavailable/failed capability result。这样可以保持同一 Tool result contract，同时把 A2A/remote invocation 细节留给未来 remote Agent execution boundary。

## Result Consumption

统一执行边界在 descriptor resolve、输入 schema 校验和治理通过后调用唯一 executor。一次逻辑调用只交付一个最终 `CapabilityInvocationResult`；`CapabilityInvocationRequest.maxRetries` 表示 `0..5` 次额外同参 retry，省略时为 `1`，非法值按 `0` 处理。只有最终错误属于 `UNAVAILABLE` 或 `TIMEOUT`、`safeError.retryable=true`、descriptor `replayPolicy=IDEMPOTENT` 且父 `AbortSignal` 未取消时才允许重试；每次 attempt 重新获得原始 `timeoutMs`。中间 attempt 不向 Agent、Workflow、stream、timeline 或 audit 暴露。

结果 normalization 必须保持以下单一路径：`SUCCEEDED` 无 `safeError`；`FAILED`/`TIMED_OUT` 有 `safeError`；`DEGRADED` 同时具有通过 output schema 的可独立使用复合子结果和描述缺失子结果的 `safeError`。合法空结果、受声明上限截断、Bash 正常完成的非零退出和 Workflow `WAITING` 控制结果都不是 `DEGRADED`。`fallbackTriggered` 只表达确实触发 fallback，与 status 正交。失败原因、分类和恢复建议只位于 `safeError`，不得通过伪业务 payload 满足 output schema。

参数校验一次返回当前阶段全部可独立判断的安全 violations，不回显非法原值。失败与成功共用 `256000` UTF-16 code unit 的 canonical JSON 容量；容量内结果不得截断，超限返回显式容量错误并复用既有 result externalizer/Read 回读边界。未知异常、非法 executor envelope、非法 extension 和 output schema failure 在交付 consumer 前安全规范化；raw exception、路径、credential、provider response 和非法输出不得进入模型或 Web 投影。

普通 Agent 把所有非取消最终失败作为下一模型轮输入，由模型选择改参、改用其他 Capability、核验状态或结束；这不是 executor retry。定向 Skill 与隐藏 `ApiCall` 使用相同最终结果但不创建普通 Agent 恢复轮。Workflow 不执行第二层 retry，除取消和 Recipe 已消费的 poll/batch 单项失败外，最终失败直接进入节点显式 `exception`。

`agent-core` 是 capability result 的显式消费者：

- `SUCCEEDED` 和 `DEGRADED` 可把安全 `structuredPayload`、`resultRef` 和 `artifactRefs` 投影为后续模型可见 capability result content；`DEGRADED` 还必须产生降级 notice。
- `FAILED` 和 `TIMED_OUT` 必须以完整安全失败结果进入普通 Agent 的下一模型轮；定向 Skill、隐藏 `ApiCall` 与 Workflow 按各自终止或显式 exception 边界消费。
- `generatedMessages` 必须全是 `USER`，只进入当前 request/run 后续模型输入，不作为 executor-owned session message 持久化。
- `contextPatch.allowedTools` 只能收窄到当前 Agent 已授权且 catalog 可见的 capability ids。
- `contextPatch.modelName` 和 `contextPatch.modelOptions` 必须通过 context-engine/model selection governance validation 后，才能 request-locally 影响后续模型步骤。
- `resultRef` 和 `artifactRefs` 保持 opaque；core 不读取引用内容、不展开本地路径、不内联 artifact 内容。

Capability audit 从 canonical runtime events 派生。Capability executor 和 Agent Core 不直接调用 `AuditEventWriter` 写 capability audit；core 发出安全 `CAPABILITY_COMPLETED` lifecycle event，runtime canonicalize owner/agent/run/session 坐标，observability/audit boundary 可派生 `capability.completed`、`capability.failed` 或 `security.rejected` audit event。

Builtin Tool executor 使用已解析 descriptor 的 provider identity 和 provider-free `CapabilityInvocationRequest.capabilityId` 做 executable lookup。模型或客户端不能在 invocation request 中指定 provider；无法解析唯一 descriptor 的 provider 冲突必须在 Tool 执行前 safe fail。

## Deferred Scope

本设计不实现 MCP、SkillHub remote refresh/cache、sandbox gateway adapter internals、Skill FORK、external provider config loading 或通用 idempotency store。Local Skill source 已由 `local-skill-source` 稳定规格限定为 system EAGER 与 Agent-owned SEARCH 两类受信 `LOCAL_DIRECTORY` source；Agent discovery 和 Agent tool 已进入统一 Capability SPI，但不创建 Agent 专用 catalog 或平行 invocation envelope。Skill manifest 字段、typed metadata 和 safe diagnostics 由 `architecture/skill-manifest-contract.md` 承载；后续能力必须复用本 SPI 和 manifest contract，不得引入平行 provider/source、catalog、execution、manifest 或 result contract。

## 统一失败处置主设计

本页定义 Capability SPI、catalog 与 provider 结构；`GovernedCapabilityInvocationPort` 的逐步执行、状态不变量、E1–E7、重试真值表、容量、一方 Tool 闭包和消费者分流由 `openspec/designs/architecture/capability-invocation-and-failure-disposition.md` 完整承载。两页共同维护：SPI 结构调整必须同步验证主设计的单一执行边界，失败处置调整不得建立第二套 catalog/provider/executor contract。
