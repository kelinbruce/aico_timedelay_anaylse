# capability-catalog Specification

## Purpose
Define the long-term governance requirements for capability provider configuration, startup provider contributions, discovery, catalog visibility, conflict gating, executor routing, and capability result consumption across Tool, Skill, and Agent capabilities.

## Function

- **所属 Function**：`FN-5.2 调用能力`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: Capability Governance Uses The Existing Unified Contracts

系统 MUST 通过 frozen `agent-contracts/capability` contracts 治理 `TOOL`、`SKILL` 和 `AGENT` Capability。所有调用方和 provider MUST 复用 `CapabilityProvider`、`CapabilityDescriptor`、`CapabilityInvocationRequest`、`CapabilityInvocationResult`、`CapabilityInvocationPort` 和 `CapabilityCatalog`；系统 MUST NOT 引入平行 descriptor、provider、catalog、invocation request、invocation result 或 Capability kind 词汇。

`CapabilityInvocationRequest.maxRetries` MUST 是 optional 字段，并 MUST 使用 `瞬态失败只在统一执行边界安全重试` 定义的类型、缺省值和计数边界。

**需求类别**：功能性需求

#### Scenario: 默认 Read Capability 保持统一路径

- **WHEN** app 组合默认 builtin Capability 路径
- **THEN** `Read` Capability MUST 通过统一 catalog 和 invocation ports 暴露
- **AND** Context Engine 和 Core MUST 消费未来 Tool、Skill 和 Agent Capability 使用的同一 descriptor 与 invocation result contracts

### Requirement: Provider Configuration Is Capability-Owned

The system MUST expose `CapabilityProviderConfig`, `CapabilityDiscoveryMode`, `CapabilityProviderOptions`, and provider-specific option DTO/schema contracts from `agent-contracts/capability`. `agent-contracts/app` MUST NOT own or export a second `CapabilityProviderConfig` DTO. App configuration and later config loading behavior MUST reference the capability-owned provider config contract instead of redefining provider/source, discovery mode, provider options, or enable/disable fields.

#### Scenario: App config consumes the capability-owned provider config

- **WHEN** app composition receives capability provider configuration
- **THEN** the typed input MUST be `CapabilityProviderConfig[]` from `agent-contracts/capability`
- **AND** no same-named provider config DTO MUST be exported from `agent-contracts/app`

### Requirement: Provider Identity Is Separate From Provider Configuration

The system MUST treat `CapabilityProvider` as a stable provider identity DTO, not as a configuration object or executable service. `CapabilityProvider` MUST contain only the provider identity fields already defined by the frozen contract: `providerId`, `providerKind`, and optional `providerType`.

Provider instance configuration MUST be represented outside descriptors. Provider configuration MAY include endpoint, credential reference, local directory reference, managed install reference, cache policy, or provider-private options, but those fields MUST NOT enter `CapabilityDescriptor.provider`, model-visible capability disclosure, stream payloads, safe errors, audit details, or logs.

#### Scenario: Multiple MCP provider instances share one kind

- **WHEN** two MCP server provider instances are configured
- **THEN** both MUST use `providerKind=MCP_SERVER`
- **AND** each MUST have a stable distinct `providerId`
- **AND** descriptors produced by those instances MUST identify the producing instance through `provider.providerId`

### Requirement: Provider Configuration Core Uses Provider And Options

The system MUST define `CapabilityProviderConfig` as the core provider instance configuration contract for configurable capability providers. `CapabilityProviderConfig` MUST use one stable DTO shape with `provider`, `discoveryMode`, and `options` fields.

`provider` MUST use the frozen `CapabilityProvider` identity DTO. `discoveryMode` MUST use `CapabilityDiscoveryMode`. `options` MUST use a `CapabilityProviderOptions` union of provider-specific option objects. The options union MUST NOT include a bare `JsonObject` branch; `CUSTOM` providers MUST use `CustomProviderOptions` with a provider-private `customOptions: JsonObject` value.

Built-in option object names MUST omit the redundant `Provider` suffix: `SkillHubOptions`, `McpServerOptions`, and `AgentRegistryOptions`.

Configurable provider kinds MUST validate `options` by `provider.providerKind` and, for `CUSTOM`, by `provider.providerType`. `CUSTOM` providers MUST include a non-empty `provider.providerType`. A custom provider MUST NOT contribute executable descriptors unless the capability subsystem has matching discovery and executor factories for that provider type.

`BUNDLED` providers and other framework/reserved providers MUST NOT be controlled by external provider configuration. Builtin tool, skill, agent, local Skill, local Agent, local subagent, memory Tool, and equivalent reserved providers MUST come from trusted startup provider contributions assembled by `agent-capability`. User `CapabilityProviderConfig` entries define only user-configured providers and MUST NOT declare, override, disable, or spoof framework/reserved provider ids or provider kinds.

The system MUST define the provider config validation/normalization boundary. Defining config types without validation/normalization behavior is not sufficient.

External provider configuration files, environment layering, tenant/Agent overrides, secret resolution, and hot reload are deferred to `add-ts-capability-source-configuration`. That follow-up change MUST produce `CapabilityProviderConfig[]` and MUST NOT redefine provider/source vocabulary, discovery ownership, catalog governance, executor routing, or capability result semantics. `CapabilityProviderConfig` MUST NOT accept `provider.providerKind=BUNDLED`.

#### Scenario: Builtin providers are registered by capability subsystem contributions

- **WHEN** `agent-app` creates the capability subsystem with no external provider config
- **THEN** `agent-capability` MUST still create the `builtin-tools` provider
- **AND** that provider MUST drive builtin discovery, catalog registration, executor routing, and result consumption for the `read` capability
- **AND** external config MUST NOT be required to enable the builtin `read` path

#### Scenario: Provider kind determines config validation

- **WHEN** the capability subsystem receives a provider config with `provider.providerKind=MCP_SERVER`
- **THEN** the config MUST be validated as an MCP server config with MCP-specific fields such as endpoint and optional credential reference
- **AND** it MUST NOT be accepted as an untyped generic object

#### Scenario: Custom provider requires explicit adapter registration

- **WHEN** the capability subsystem reads a provider config with `provider.providerKind=CUSTOM`
- **THEN** the config MUST include `provider.providerType`
- **AND** the config options MUST use `CustomProviderOptions.customOptions`
- **AND** the capability subsystem's discovery and executor factories MUST support that provider type before descriptors from that provider can become executable

### Requirement: Config Normalization Produces Config-Driven Provider Contributions

The system MUST validate and normalize `capabilityProviderConfigs` during startup before provider configs can contribute discovery or executor support, and MUST reject configs that attempt to declare `provider.providerKind=BUNDLED` or reserved provider identities. Accepted user configs SHALL be converted by `agent-capability` into config-driven provider contributions before catalog assembly.

Provider config normalization and provider contribution assembly MUST reject duplicate `providerId` values in the same governed composition scope. Credential values MUST be represented as references only; raw secrets MUST NOT appear in descriptors, logs, safe errors, model-visible capability disclosure, stream payloads, audit details, diagnostics, or contribution metadata.

Config-driven provider contributions MUST preserve provider identity, provider kind/type, discovery mode, and provider-specific implementation data needed by supported discovery/executor adapters. Provider config options MUST remain inside adapter/contribution implementation boundaries and MUST NOT enter `CapabilityDescriptor` or model-visible DTOs.

#### Scenario: Duplicate provider id is rejected

- **WHEN** two provider configs in the same composition scope use the same `providerId`
- **THEN** normalization MUST reject the configuration
- **AND** the capability subsystem MUST NOT create ambiguous discovery, catalog, or executor registrations

#### Scenario: Config cannot override builtin provider id

- **WHEN** external provider config attempts to define `provider.providerKind=BUNDLED` or reuse `provider.providerId=builtin-tools` / `provider.providerId=builtin-skills`
- **THEN** normalization MUST reject the configuration
- **AND** trusted builtin providers created inside `agent-capability` MUST remain the only source of builtin provider instances

### Requirement: Agent Assembly Compilation Does Not Require Capability Descriptor Pre-Discovery

The system MUST treat `AgentAssembly.capabilityBindings` as Agent authorization intent and explicit disable facts, not as proof that matching capability descriptors have already been discovered. Agent assembly compilation MUST validate binding shape, safe ids, capability kind, and registered provider id, but MUST NOT require capability descriptors to be present before assembly compilation.

Capability descriptor existence, `AvailabilityStatus`, conflict resolution, and executable uniqueness MUST be decided by the catalog during `listAvailable` and `resolve` for the request scope.

#### Scenario: Assembly can compile before capability discovery

- **WHEN** an Agent definition binds `capabilityId=read`, `capabilityType=TOOL`, and `providerId=builtin-tools`
- **THEN** Agent assembly compilation MUST be able to produce `AgentAssembly.capabilityBindings` without first reading the capability catalog
- **AND** `catalog.listAvailable` / `catalog.resolve` MUST later decide whether a discovered descriptor matching that binding is visible and executable

#### Scenario: Missing descriptor fails at catalog gate

- **WHEN** an Agent assembly contains a capability binding whose descriptor has not been discovered
- **THEN** assembly compilation MUST NOT fail solely because that descriptor is missing
- **AND** `catalog.listAvailable` MUST not expose that binding as a capability
- **AND** `catalog.resolve` MUST return undefined or the safe rejection path for that capability

### Requirement: Discovery Support Comes From Provider Contributions

The system MUST assemble discovery support from startup provider contributions. Each contribution SHALL bind exactly one `CapabilityProvider` identity to one provider-bound `CapabilityDiscovery` object. The discovery object MUST expose the same provider identity as the contribution and exactly one discovery mode. Discovery adapters MAY support `EAGER` mode, `SEARCH` mode, refresh hooks, and availability probe facts. Discovery adapters MUST discover or search candidate capabilities, but MUST NOT make global conflict, request Agent visibility, binding, or final availability decisions.

Discovery support creation MUST use exact provider id/kind and, for `CUSTOM`, exact provider type. Unsupported provider kind/type or provider/discovery mismatch MUST produce a safe assembly failure or blocking startup validation outcome. The system MUST NOT choose among multiple discovery implementations by registration order, import side effects, or hidden global mutable registries.

`agent-capability` MAY use internal factories to construct owner-owned discoveries, but those factories are implementation details. The stable startup contract is the frozen provider contribution snapshot and the projected discovery set consumed by the catalog.

#### Scenario: Eager builtin contribution registers read on startup

- **WHEN** `createCapabilitySubsystem({ providerConfigs: [] })` starts with no external provider config
- **THEN** `agent-capability` MUST create a builtin provider contribution with `providerId=builtin-tools`, `providerKind=BUNDLED`, and `discoveryMode=EAGER`
- **AND** that contribution MUST carry an `EAGER` discovery adapter for the `builtin-tools` provider
- **AND** that discovery adapter MUST return the `read` descriptor during startup composition
- **AND** the catalog MUST register that descriptor before context/core query available capabilities
- **AND** the descriptor MUST use `provider.providerId=builtin-tools`
- **AND** no other builtin tool descriptor MUST be discovered by the minimal builtin path
- **AND** Agent assembly bindings MUST NOT affect which descriptors builtin discovery returns

#### Scenario: Discovery contribution creation is deterministic

- **WHEN** a provider contribution is created from owner-owned builtin composition or accepted provider config
- **THEN** discovery support MUST be selected by exact provider id/kind
- **AND** `CUSTOM` providers MUST also dispatch by exact provider type
- **AND** unsupported provider kind/type MUST fail subsystem creation with a safe configuration error

#### Scenario: Search provider does not register remote capabilities on startup

- **WHEN** a provider has `discoveryMode=SEARCH`
- **THEN** the catalog MUST keep the discovery adapter as a `listAvailable` / `resolve` query hook only
- **AND** startup MUST NOT register remote candidate capabilities from that provider as executable descriptors

#### Scenario: Search discovery is evaluated during listAvailable

- **WHEN** `catalog.listAvailable` evaluates a request scope that binds capabilities from a `SEARCH` provider
- **THEN** the catalog MUST call that provider discovery's search hook with criteria derived from the trusted request `tenantId`, `subjectId`, `agentId`, `agentVersion`, `agentAssemblyRef`, and optional requested capability id
- **AND** descriptors returned by search MUST pass through the same binding, availability, and conflict gates as eager descriptors
- **AND** the catalog MUST NOT expose remote search candidates that are not bound by the request Agent assembly

#### Scenario: Search discovery criteria do not expose binding-owned facts

- **WHEN** the catalog calls any `SEARCH` discovery adapter
- **THEN** the public discovery criteria MUST NOT contain runtime-facing `AgentAssembly`, `capabilityBindings`, `boundCapabilityIds`, availability verdicts, routing policy, or conflict results
- **AND** discovery MUST NOT own final Agent visibility, explicit disable, binding, availability, or conflict decisions

#### Scenario: Default-enabled trusted search providers are catalog-owned facts

- **WHEN** a trusted app-composed `SEARCH` provider is registered as default-enabled for the current request scope
- **THEN** the catalog MAY call that provider without an explicit enabled Agent binding
- **AND** this default enablement MUST NOT be written as a synthetic `AgentAssembly.capabilityBindings` entry
- **AND** returned candidates MUST still pass explicit disabled binding, availability, conflict, model visibility, and invocation eligibility gates

### Requirement: Catalog Owns Registration Gates And Availability Verdict

The catalog implementation MUST own descriptor registration gates, request Agent binding filtering, availability verdict, conflict resolution hook, and resolve gating. Discovery adapters MAY provide candidate descriptors and probe facts, but the catalog MUST decide whether a descriptor is visible or executable for a given request.

`listAvailable` and `resolve` MUST apply the same core gates: trusted framework-default builtin candidates, trusted default-enabled provider candidates, request-scope `AgentAssembly.capabilityBindings`, explicit disable facts keyed by provider id + capability type + capability id, provider identity when present in a binding, `AvailabilityStatus`, `SEARCH` discovery candidates for the request scope, and the catalog's conflict-resolved visible/executable view. A capability that is not visible through `listAvailable` for a request context MUST NOT be executable through `resolve` for the same context.

For a given Agent/run request scope, the catalog MUST expose executable capabilities as a view that is unique by `capabilityId`. Provider identity MAY be used internally for descriptor identity, binding filters, conflict resolution, diagnostics, and executor lookup, but `agent-core` MUST be able to resolve an executable descriptor by the frozen `CapabilityResolveRequest.capabilityId` after catalog governance has produced the request visible/executable view.

#### Scenario: Unavailable capability is not executable

- **WHEN** a registered descriptor has `availabilityStatus=UNAVAILABLE`
- **THEN** `listAvailable` MUST exclude it unless unavailable descriptors are explicitly requested for diagnostics
- **AND** `resolve` MUST NOT return it as executable

#### Scenario: Unbound capability is not executable

- **WHEN** a descriptor exists in the catalog but the request Agent assembly does not bind that capability id and provider id
- **AND** the descriptor is not a trusted framework-default builtin candidate
- **THEN** the descriptor MUST NOT be model-visible
- **AND** `resolve` MUST not return it for invocation

#### Scenario: Unresolved conflict is not executable

- **WHEN** multiple candidate descriptors collide and the catalog conflict extension point cannot produce one executable descriptor for the request scope
- **THEN** the capability id MUST be excluded from `listAvailable`
- **AND** `resolve` MUST NOT return an ambiguous descriptor

### Requirement: Conflict Policy Is A Catalog Extension Point

The catalog skeleton MUST reserve a single conflict resolution extension point used by both eager registration and future search result merge. The capability catalog baseline MUST NOT define the concrete priority order, shadowing behavior, or override diagnostics for capability conflicts.

Concrete conflict priority and same-scope conflict behavior MUST be defined by `add-ts-capability-conflict-resolution`.

#### Scenario: Conflict behavior is not duplicated by providers

- **WHEN** two provider adapters produce candidate descriptors with colliding capability identities
- **THEN** providers MUST NOT resolve the global conflict themselves
- **AND** the catalog MUST route the candidates through the shared conflict extension point

### Requirement: Execution Uses Capability Kind And Provider Identity

The system MUST route capability execution through the unified `CapabilityInvocationPort`. Executor selection MUST be based on the resolved descriptor's `CapabilityKind` and provider identity. Executor selection MUST NOT assume a one-to-one mapping between `providerKind` and executor.

Executor support SHALL be assembled from provider contributions into a provider-aware runtime lookup table. Public `CapabilityExecutor` SPI is provider-neutral: it does not expose provider as its own public identity, and the same executor object MAY be reused by multiple provider contributions when the subsystem binds provider identity during assembly. Executor lookup MUST use the `CapabilityDescriptor` returned by `catalog.resolve`, exact `descriptor.provider.providerId`, and exact `descriptor.kind`; it MAY use `providerKind` and optional `providerType` to choose the provider implementation branch and produce diagnostics. A single provider kind MAY still route to different executors for different capability kinds.

Runtime executor matching MUST use the resolved descriptor's concrete provider id and capability kind. If no executor matches, or if multiple executors match the same descriptor, the invocation path MUST return a safe failure instead of choosing by registration order.

#### Scenario: Provider kind can have multiple executors

- **WHEN** the `BUNDLED` provider kind contributes both Tool and Skill capabilities
- **THEN** the invocation path MUST be able to route `TOOL` descriptors and `SKILL` descriptors to different executor implementations
- **AND** it MUST NOT treat `BUNDLED` as a single executor choice

#### Scenario: Executor match is unique

- **WHEN** catalog resolves a descriptor with `provider.providerId=builtin-tools` and `kind=TOOL`
- **THEN** invocation MUST call the single executor factory with that descriptor
- **AND** the factory MUST return exactly one executor for `builtin-tools` and `TOOL`
- **AND** zero or multiple matching executors MUST produce a safe capability failure
- **AND** invocation MUST NOT choose an executor only because it shares `providerKind=BUNDLED`

#### Scenario: Provider instance selects configured executor

- **WHEN** two MCP server provider instances are configured
- **THEN** a descriptor from `providerId=mcp-a` MUST execute through the executor instance configured for `mcp-a`
- **AND** it MUST NOT execute through another MCP provider instance that happens to share `providerKind=MCP_SERVER`

### Requirement: Follow-Up Providers Reuse The Skeleton

Future provider-specific changes MUST plug into the provider configuration, discovery, catalog, executor, and result consumption skeleton defined by this baseline. They MUST NOT introduce separate catalog, discovery, execution envelope, result DTO, or provider/source vocabulary for a specific Tool, Skill, Agent, remote service, or local directory.

#### Scenario: Future SkillHub provider uses the skeleton

- **WHEN** a future SkillHub change implements remote search and refresh
- **THEN** it MUST provide a SkillHub provider config and extend the single discovery/executor factory behavior as needed
- **AND** its discovered descriptors MUST enter the shared catalog and invocation result path

### Requirement: Agent Capability Candidates Use Existing Catalog Governance

Capability Catalog MUST 对 `AGENT` capability candidates 应用与其他 capability kind 一致的 request-scope governance，包括 availability filter、explicit disabled binding、conflict resolution、model visibility 和 provider identity 判断。Catalog MUST NOT 因 candidate 是 `AGENT` 而绕过 unified governance。

Catalog MUST distinguish global Agent catalog inclusion from request-scope callable visibility. 顶层 Agent、builtin Agent 和本地 subagent 都可以进入 Catalog；但 `CapabilityCatalog.listAvailable` 在某个父 Agent request scope 中只返回该父 Agent 经过 discovery source eligibility、explicit binding、本地 subagent 默认可见、availability、conflict 和 model visibility 治理后可调用的 Agent capabilities。Builtin Agent 使用 `providerId="builtin-agents"`，顶层 local Agent 使用 `providerId="local-agents"`，父 Agent package 下的 local subagent 使用 `providerId="local-subagents"`。Builtin Agent 和顶层 local Agent 必须由 discovery 基于 target assembly `agentInvocation="BOUND"` 发布为可绑定候选，并通过当前父 Agent 的 explicit enabled `AGENT` binding 进入 callable view；当前父 Agent package 下的 local subagent 只有通过 `listParentSubagentAssemblies(parentScope)` 返回、目标 assembly `agentInvocation="PARENT"` 且 `parentAgentScope` 匹配当前父 Agent 时在该父 Agent request scope 内默认可见。`agentInvocation` / `parentAgentScope` 不进入 descriptor metadata，Catalog 对这些事实的使用来自 discovery/source 发布路径和 compiled assembly，而不是 public descriptor 字段。

#### Scenario: Visible Agent capability passes catalog governance

- **WHEN** Agent capability discovery 返回一个 `availabilityStatus="AVAILABLE"` 的 `AGENT` descriptor
- **AND** 当前父 Agent 没有同 key `enabled=false` binding
- **AND** conflict resolution 选择该 descriptor
- **THEN** `CapabilityCatalog.listAvailable` MUST 在当前父 Agent request scope 中返回该 descriptor

#### Scenario: Bound builtin Agent is visible in the parent Agent callable view

- **WHEN** the Catalog contains a builtin `AGENT` descriptor
- **AND** the current parent Agent has an enabled binding for `providerId="builtin-agents" + capabilityType=AGENT + capabilityId`
- **AND** the target Agent assembly has `agentInvocation="BOUND"`
- **AND** availability and conflict rules pass
- **THEN** `CapabilityCatalog.listAvailable` MUST return that builtin Agent descriptor in the parent Agent request scope

#### Scenario: Unbound builtin Agent remains cataloged but not callable for the parent Agent

- **WHEN** the Catalog contains a builtin `AGENT` descriptor
- **AND** the current parent Agent has no enabled binding for that builtin Agent
- **THEN** the descriptor MUST remain in the global catalog candidate set
- **AND** `CapabilityCatalog.listAvailable` MUST NOT expose it as callable for that parent Agent request scope

#### Scenario: Bound top-level local Agent is visible in the parent Agent callable view

- **WHEN** the Catalog contains a top-level local `AGENT` descriptor from provider `local-agents`
- **AND** the current parent Agent has an enabled binding for `providerId="local-agents" + capabilityType=AGENT + capabilityId`
- **AND** the target Agent assembly has `agentInvocation="BOUND"`
- **AND** availability and conflict rules pass
- **THEN** `CapabilityCatalog.listAvailable` MUST return that local Agent descriptor in the parent Agent request scope

#### Scenario: Explicit binding cannot enable parent-local Agent

- **WHEN** parent-scoped local subagent discovery can return an `AGENT` candidate whose target assembly has `agentInvocation="PARENT"`
- **AND** the target assembly `parentAgentScope` matches the current parent Agent scope
- **AND** the current parent Agent has an enabled binding for that descriptor
- **THEN** `CapabilityCatalog.listAvailable` MUST NOT expose it through the explicit binding path
- **AND** it is visible only if returned by parent-scoped local subagent discovery for the current parent Agent scope

#### Scenario: Explicit binding cannot enable non-invocable Agent

- **WHEN** Agent discovery sees a target assembly with `agentInvocation="NONE"`
- **AND** the current parent Agent has an enabled binding for that target
- **THEN** `CapabilityCatalog.listAvailable` MUST NOT expose it as callable for that parent Agent request scope
- **AND** context prompt shaping MUST NOT render it as a delegable Agent target

#### Scenario: Unbound top-level local Agent remains cataloged but not callable for the parent Agent

- **WHEN** the Catalog contains a top-level local `AGENT` descriptor from provider `local-agents`
- **AND** the current parent Agent has no enabled binding for that local Agent
- **THEN** the descriptor MUST remain in the global catalog candidate set
- **AND** `CapabilityCatalog.listAvailable` MUST NOT expose it as callable for that parent Agent request scope

#### Scenario: Disabled binding hides parent local subagent capability

- **WHEN** 一个 local subagent descriptor 默认进入所属父 Agent request-scope candidate set
- **AND** the descriptor uses `providerId="local-subagents"`
- **AND** its target assembly has `agentInvocation="PARENT"`
- **AND** its target assembly `parentAgentScope` matches that parent Agent
- **AND** 父 Agent runtime-facing `AgentAssembly.capabilityBindings` 包含同 `providerId + capabilityType=AGENT + capabilityId` 的 `enabled=false` fact
- **THEN** Catalog MUST NOT 在 `listAvailable` 中返回该 Agent capability
- **AND** `resolve` MUST NOT 将其解析为可执行可见 capability

### Requirement: Agent Capability Search Does Not Consume Binding-Owned Facts

Agent capability SEARCH discovery MUST 只接收可信 search scope 和可选 capability narrowing。Discovery criteria MUST NOT 包含 runtime-facing `AgentAssembly` 对象、`capabilityBindings`、`boundCapabilityIds`、availability verdict、conflict result 或 routing decision。

#### Scenario: Search discovery cannot observe bindings

- **WHEN** Catalog 调用 Agent capability SEARCH discovery
- **THEN** criteria MUST 包含当前父 Agent 的 trusted `agentId`、`agentVersion`、`agentAssemblyRef`、`tenantId` 和 `subjectId`
- **AND** criteria MUST 只在 `resolve` 或等价窄化场景中携带可选 `requestedCapabilityId`
- **AND** criteria MUST NOT include `AgentAssembly`、`capabilityBindings` 或 `boundCapabilityIds`

### Requirement: Agent Capability Conflicts Are Resolved Before Model Visibility

Catalog MUST 在 `AGENT` descriptor 进入 model-visible capability list 前完成同 `capabilityId` 的冲突和 shadowing 判断。对于同一父 Agent request scope 内无法唯一解析的 `AGENT` capability，Catalog MUST 安全排除冲突候选，或只返回 governance 选定的唯一 winner。

#### Scenario: Duplicate Agent capability is not model visible

- **WHEN** 同一父 Agent request scope 中存在两个同 `capabilityId` 且无法通过 governance 唯一解析的 `AGENT` descriptors
- **THEN** Catalog MUST NOT 将这组 ambiguous descriptors 暴露给模型
- **AND** MUST 产生 safe conflict diagnostic 或 governance evidence

#### Scenario: Governed Agent capability is rendered as a delegable target

- **WHEN** Catalog returns an `AGENT` descriptor with `availabilityStatus="AVAILABLE"` and `modelInvocable=true`
- **AND** conflict resolution has selected that descriptor for the current parent Agent request scope
- **THEN** context prompt shaping MUST render the descriptor as a delegable Agent target for the model
- **AND** the rendered text MUST use only safe capability id and display/description facts
- **AND** the rendered text MUST NOT expose provider-private ids, raw package path, source identity, loading fact, prompt body, metadata secret or child assembly detail

#### Scenario: Parent scoped shadowing does not affect other Agents

- **WHEN** 父 Agent A 的 package-scoped subagent shadow 了系统或内置同名 Agent capability
- **THEN** shadowing MUST 只影响父 Agent A 的 request-scope view
- **AND** MUST NOT 污染父 Agent B 的 request-scope view

### Requirement: Runtime Capability 失败复用统一 SafeError 结果

Tool、Skill 和 Agent 的调用结果 MUST 使用同一个 `CapabilityInvocationResult` 契约。`safeError?: SafeError` MUST 是该契约唯一的调用失败字段，并且 MUST 为可选、非 `null`、默认缺失。

统一执行边界 MUST 以严格 runtime schema 校验以下状态组合和所有声明字段：

- `SUCCEEDED` MUST NOT 携带 `safeError`。
- `FAILED` 和 `TIMED_OUT` MUST 携带合法 `safeError`。
- `safeError.category=CANCELED` 时 status MUST 为 `FAILED`。
- `DEGRADED` 只允许 owning Capability 已声明的复合目标 producer 使用：至少一个可独立使用的子结果已经成功，同时至少一个已声明子结果缺失或失败。producer MAY 携带 `safeError` 作为降级原因；只有 owning Capability 契约声明该降级原因时才允许携带，未声明时默认不携带，调用方在缺少 `safeError` 时仍 MUST 按合法降级结果处理。first-party Tool 的 `DEGRADED` 出口 MUST 携带合法 `safeError`。
- `safeError` MUST 包含必填字段 `code`、`category`、`message`、`retryable`，并 MAY 包含 `safeDetails`；未声明字段 MUST 被拒绝。

runtime schema MUST 拒绝未声明字段和非法 status/`safeError` 组合。`structuredPayload` MUST 只承载 Capability 声明的安全业务结果，MUST NOT 建立 `errorDiagnostics` 或其他与 `safeError.safeDetails` 竞争的失败详情结构。

`structuredPayload` 与 output schema 的关系 MUST 固定如下：`SUCCEEDED` MUST 携带 owning Capability 声明的合法最终结果并通过 output schema；该结果 MAY 是合法空集合、受声明上限约束且带 truncation/cursor 的结果、明确的非零进程退出结果或协议控制结果，MUST NOT 仅因未完成更大的潜在工作而改为 `DEGRADED`。`DEGRADED` MUST 携带至少一个可独立使用的成功子结果、明确存在至少一个缺失或失败的已声明子结果，并通过 output schema。`FAILED` 在没有可用业务结果时 MUST 为 `{}`，只有 owning Capability 显式声明的安全业务恢复事实允许非空；`TIMED_OUT` 在没有安全部分结果时 MUST 为 `{}`，stdout、stderr、chunks 等声明为安全部分结果时可以非空。`FAILED` 或 `TIMED_OUT` 的 `structuredPayload` 非空时 MUST 通过声明 output schema；空对象 MUST 跳过业务 output schema，且 MUST NOT 为满足 output schema 构造伪业务 payload。任一 status 的非空业务 payload 未通过 output schema 时 MUST 整体替换为 `CAPABILITY_OUTPUT_INVALID + VALIDATION + retryable=false`，不得公开 output violations。失败原因、分类和恢复建议 MUST 只位于 `safeError`。

**需求类别**：功能性需求

#### Scenario: 失败结果使用 SafeError

- **WHEN** Capability 返回业务失败
- **THEN** `CapabilityInvocationResult.status` MUST 为 `FAILED` 或 `TIMED_OUT`
- **AND** `CapabilityInvocationResult.safeError` MUST 包含合法 `code/category/message/retryable`
- **AND** 结果中的任一未声明顶层字段 MUST 被拒绝

#### Scenario: 明确结果和复合部分成功使用合法状态

- **WHEN** Capability 返回合法空集合、声明范围内的截断结果、明确的进程完成结果或协议控制结果
- **THEN** 结果 MUST 为 `SUCCEEDED` 且 MUST NOT 携带 `safeError`
- **AND** 只有声明的复合目标同时包含可独立使用的成功子结果和缺失或失败子结果时，producer 才能返回 `DEGRADED`
- **AND** 调用方 MUST 保留合法 `DEGRADED` 的结构化子结果和可选降级错误

#### Scenario: 模型获得完整安全错误信息

- **WHEN** Agent 将最终 Capability 失败加入下一轮模型上下文
- **THEN** 模型可见结果 MUST 包含最终 `safeError` 的 `code/category/message/retryable`
- **AND** `safeError.safeDetails` 存在时 MUST 完整保留
- **AND** 模型可见结果 MUST NOT 包含 `structuredPayload.errorDiagnostics`

#### Scenario: 无业务结果的失败保持空 payload

- **WHEN** Capability 返回 `FAILED` 或 `TIMED_OUT` 且没有任何安全可用业务结果
- **THEN** `structuredPayload` MUST 为 `{}`
- **AND** 系统 MUST NOT 为满足声明 output schema 合成占位业务字段
- **AND** 失败事实与恢复建议 MUST 只位于 `safeError`

#### Scenario: 失败或超时的非空 payload 仍需校验

- **WHEN** owning Capability 为 `FAILED` 或 `TIMED_OUT` 显式返回安全业务恢复事实或部分结果
- **THEN** 非空 `structuredPayload` MUST 通过声明 output schema
- **AND** 校验失败 MUST 返回不含 output violations 的 `CAPABILITY_OUTPUT_INVALID`

### Requirement: Capability 结果扩展保持受治理

Capability 调用方 MUST 按 status 消费最终结果。`SUCCEEDED` MUST 暴露安全 `structuredPayload` 和 refs；`DEGRADED` MUST 只表示 owning Capability 已声明的复合目标发生可用部分成功，并暴露仍可被调用方独立使用的安全子结果；`DEGRADED` 携带 `safeError` 时，`safeError.message` MUST 说明可用子结果、缺失或失败子结果和安全下一步；`FAILED` 和 `TIMED_OUT` MUST 产生失败结果，MUST NOT 被消费为成功业务内容。

当 Capability 没有产生可用业务结果时，producer MUST NOT 返回 `DEGRADED`。未找到目标、依赖不可用、调用超时、执行失败和结果无效等没有可用业务结果的路径 MUST 按其真实事实返回 `FAILED` 或 `TIMED_OUT`；取消 MUST 使用 `safeError.category=CANCELED`。合法空集合、合法未命中项、受声明上限约束的 truncation、正常完成的非零进程退出和协议定义的“尚未完成”控制结果均是明确结果，MUST 使用 `SUCCEEDED`；它们不得仅因内容为空、结果受限、业务未达成或后续仍需动作而返回 `DEGRADED`。

`generatedMessages` MUST 只接受 role `USER`，MUST 只进入当前 request/run 的后续模型输入，MUST NOT 持久化为用户 session message。`contextPatch.allowedTools` MUST 是当前请求已授权且可见 Capability 的子集，MUST NOT 扩大 Capability authority 或永久修改 Agent assembly、provider configuration、session configuration 或 catalog state。

`CapabilityInvocationResult.contextPatch` MUST 使用可选 canonical `modelId` 和可选 `modelOptions`。`modelOptions` MUST 复用 canonical `ModelInferenceOptions`，MUST 是封闭对象，且可选字段 MUST 恰好为 `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking`、`toolChoice`、`providerOptions` 和 `modelParams`；除 `providerOptions` 和 `modelParams` 外的字段 MUST 使用 `ModelInvocationRequest` 的同名约束，`toolChoice` MUST 复用 canonical `ToolChoice` 的 `AUTO | NONE | REQUIRED` 值域，MUST NOT 新增 `ModelToolChoice` 或 Capability-owned 平行类型，`providerOptions` 与 `modelParams` MUST 为非 `null` `JsonObject`。`providerOptions` MUST 只接受受治理 Skill Tool 从当前已通过 source admission、manifest validation 和 Skill resolution governance 的 `SkillMetadata.modelOptions.providerOptions` 原样映射；其他 Capability result、Capability 参数、模型输出或 metadata 提供该字段时 MUST 被拒绝。`modelParams` MUST 遵守其 owning contract，且其中与 canonical `toolChoice` 规范化同名的 key MUST 被拒绝。

已接受的模型 patch MUST 在应用前基于当前 accepted Agent assembly 和 request/run 完成模型选择与治理校验，只能影响同一 request/run 的后续模型步骤。缺失 `modelId`、`modelOptions` 或 `modelOptions` 单个字段 MUST 表示不覆盖对应值，系统 MUST NOT 为缺失字段合成 Capability-specific 默认值。显式 `null`、封闭 schema 未列出的字段，以及 provider identity、endpoint、credential、header、transport、timeout 或 retry control MUST 被拒绝。非法或未授权 patch MUST 安全失败且不得应用。

`resultRef` 和 `artifactRefs` MUST 保持为安全 opaque ref 或安全 summary。Capability 结果消费方 MUST NOT 因消费 ref 而读取内容、展开本地路径或内联 artifact 内容。

`fallbackTriggered` MUST 只表示本次调用路径实际触发了声明的 fallback，MUST 与最终 status 正交。fallback 产生 owning Capability 声明的合法最终结果时 status MUST 为 `SUCCEEDED`；fallback 只完成复合目标中可独立使用的部分子结果时 MUST 为 `DEGRADED`；fallback 最终失败或超时时 MUST 分别为 `FAILED` 或 `TIMED_OUT`。producer、normalizer、consumer 和公共投影 MUST NOT 仅因 `fallbackTriggered=true` 把结果改为 `DEGRADED`，也 MUST NOT 用该字段绕过当前请求的 authority、结果校验或失败处置。`safeError` 在失败或降级时 MUST 描述最终 fallback 结果，不得用已被成功 fallback 恢复的 primary failure 覆盖最终事实。

**需求类别**：功能性需求

#### Scenario: Generated messages 保持 request-local

- **WHEN** Capability 结果包含 `generatedMessages`
- **THEN** 每条 generated message 的 role MUST 为 `USER`
- **AND** 系统 MUST 把它加入当前 request/run 的后续模型输入
- **AND** 系统 MUST NOT 把它持久化为用户 session message

#### Scenario: Context patch 不扩大 Capability authority

- **WHEN** Capability 结果包含 `contextPatch.allowedTools`
- **THEN** 系统 MUST 校验全部 id 已在当前请求中授权且可见
- **AND** 任一越权 id MUST 使 patch 安全失败且不得应用

#### Scenario: 受治理模型 patch 只在当前 request 内生效

- **WHEN** Capability result 返回通过 schema 和模型选择治理的 `contextPatch.modelId` 或 `contextPatch.modelOptions`
- **THEN** 系统 MUST 只把 patch 应用于同一 request/run 的后续模型步骤
- **AND** Agent、session、provider、catalog 和全局 model profile 的 durable configuration MUST NOT 改变

#### Scenario: 模型 patch 遵守封闭 schema 和缺失语义

- **WHEN** context patch 省略可选字段
- **THEN** 省略字段 MUST NOT 覆盖后续模型选择或对应模型参数
- **AND** 系统 MUST NOT 为省略字段合成 Capability-specific 默认值
- **AND** 当 patch 包含未声明字段或显式 `null` 时，系统 MUST 拒绝该 patch

#### Scenario: Provider options 只来自受治理 Skill metadata

- **WHEN** 受治理 Skill Tool 从当前 resolved Skill 的 accepted metadata 原样映射合法 `providerOptions`
- **THEN** result validation MUST 接受该字段进入同一 request/run 的后续模型参数治理
- **AND** 当其他来源提供 `providerOptions` 或 provider access、transport、timeout、retry 字段时，result validation MUST 拒绝该 patch

#### Scenario: Tool choice patch 只影响当前 request 的后续模型调用

- **WHEN** 受治理 Capability result 的 `contextPatch.modelOptions.toolChoice` 为 `AUTO`、`NONE` 或 `REQUIRED`
- **THEN** result validation MUST 接受该字段进入 canonical request-local model option merge
- **AND** 该字段 MUST 只影响同一 request/run 的后续模型调用
- **AND** 任一其他值、named-tool object、显式 `null` 或 provider-native `tool_choice` 字段 MUST 被拒绝

#### Scenario: Result refs 保持 opaque

- **WHEN** Capability 结果包含 `resultRef` 或 `artifactRefs`
- **THEN** 调用方 MUST 只消费安全 ref 或 summary
- **AND** 调用方 MUST NOT 在结果消费阶段读取引用内容、展开路径或内联 artifact 内容

#### Scenario: 没有可用结果时不得伪装成降级

- **WHEN** Capability 没有返回任何可继续使用的业务结果
- **AND** 调用未成功且未被取消
- **THEN** status MUST 为 `FAILED` 或 `TIMED_OUT`
- **AND** 系统 MUST NOT 仅为继续 Agent loop 而返回 `DEGRADED`

#### Scenario: 复合目标的可用部分成功使用显式降级

- **WHEN** first-party Tool 的 owning contract 声明一个由多个可独立使用子结果组成的复合目标
- **AND** 至少一个子结果成功且至少一个已声明子结果缺失或失败
- **THEN** status MUST 为 `DEGRADED`
- **AND** 结果 MUST 携带合法 `safeError`
- **AND** `safeError.message` MUST 说明可用子结果、缺失或失败子结果以及调用方可采取的下一步

#### Scenario: fallback 产生合法最终结果后保持成功

- **WHEN** primary path 未完成且声明的 fallback 被触发
- **AND** fallback 产生 owning Capability 声明且通过 output schema 的合法最终结果
- **THEN** status MUST 为 `SUCCEEDED` 且 `fallbackTriggered` MUST 为 `true`
- **AND** 结果 MUST NOT 携带 primary failure 的 `safeError`
- **AND** 模型或用户可见投影 MUST NOT 把该结果标记为 `DEGRADED` 或发出降级通知

#### Scenario: fallback 只完成复合目标的可用部分

- **WHEN** 声明的 fallback 被触发
- **AND** fallback 只完成复合目标中至少一个可独立使用的子结果，同时至少一个已声明子结果缺失或失败
- **THEN** status MUST 为 `DEGRADED` 且 `fallbackTriggered` MUST 为 `true`
- **AND** `safeError` MUST 描述 fallback 的可用部分、缺失部分和安全下一步

#### Scenario: fallback 失败或超时保持真实状态

- **WHEN** 声明的 fallback 被触发但最终失败或超时
- **THEN** status MUST 分别为 `FAILED` 或 `TIMED_OUT`，且 `fallbackTriggered` MUST 为 `true`
- **AND** `safeError` MUST 描述最终 fallback 失败或超时事实
- **AND** 系统 MUST NOT 仅因 fallback 已触发而返回 `DEGRADED`

#### Scenario: NON_IDEMPOTENT producer timeout 默认不可重放

- **WHEN** `replayPolicy=NON_IDEMPOTENT` 的 first-party Tool 发生 timeout
- **THEN** `safeError.category` MUST 为 `TIMEOUT`
- **AND** `safeError.retryable` MUST 为 `false`，除非 producer 明确声明重放安全
- **AND** 统一执行边界 MUST NOT 自动同参重试

### Requirement: Workflow Tool 通过统一入口忠实返回执行结果

`Workflow` MUST 作为 builtin `TOOL` Capability 通过统一目录、模型可见性和 `CapabilityInvocationPort` 调用路径提供。输入 MUST 使用非空 `recipeName`、可选 `inputText` 和可选 JSON object `inputVariables`；当前 Agent Scope 和 Owner Scope 的 Workflow capability 以及 Workflow execution dependency 不可用时，Tool MUST 不可见或安全失败。调用 MUST 在当前 scope 内执行，MUST NOT 创建子 session；安全 visible delta MUST 投影到当前 run timeline。

Workflow Tool MUST 按 `WorkflowExecutionStatus` 的明确事实唯一映射最终结果：

- `COMPLETED` MUST 返回 `SUCCEEDED`，payload 包含 `recipeName`、`status="succeeded"` 和安全 `outputVariables`。
- `FAILED` MUST 返回 `FAILED`，并保留 Workflow 最终安全错误；不存在合法上游 `safeError` 时 MUST 使用 `CAPABILITY_EXECUTION_FAILED + INTERNAL + retryable=false`。
- `INTERRUPTED` MUST 返回 `FAILED + CANCELED + retryable=false`。
- `WAITING` 在 `pendingInput` 符合声明 contract 且 questions 非空，或至少一个非空 answer preview 可用时 MUST 返回 `SUCCEEDED`，payload 包含 `recipeName`、`status="waiting"` 和全部可用 pending context，MUST NOT 携带 `safeError`。`pendingInput` 无效但 answer previews 可用时 MUST 省略 `pendingInput` 并保留 previews。
- `WAITING` 没有有效 pending questions 或 answer previews 时 MUST 返回空 payload 的 `FAILED + CAPABILITY_EXECUTION_FAILED + INTERNAL + retryable=false`。

除无可用 context 的非法 `WAITING` 外，Workflow execution result 的 payload MUST 包含 `answerPreviews`；系统 MUST 从 node results 中 `output.level="answer"` 的 content 提取 previews，每条 preview MUST 最多 `4000` 个字符，数组 MUST 最多 `10` 条，空数组表示没有 answer output。`outputVariables` MUST 经过安全过滤。metadata 如存在 MUST 是只包含 optional 安全 `executionId` 和 optional 非负安全整数 `nodeResultCount` 的 closed object；两个字段都无值时 metadata MUST 保持缺失，其他字段 MUST 被拒绝。payload、metadata 和 timeline projection MUST NOT 包含 secret、credential、raw provider error 或 Workflow 内部实现细节。recipe 不存在 MUST 返回 `FAILED + RECIPE_NOT_FOUND + NOT_FOUND + retryable=false`，message MUST 要求选择当前已注册 recipe 或不使用 Workflow，且 MUST NOT 泄漏 registry 或文件路径。

**需求类别**：功能性需求

#### Scenario: 模型通过统一路径调用 Workflow Tool

- **WHEN** 模型调用当前请求中已授权且可见的 `Workflow` Tool
- **THEN** 系统 MUST 通过统一 Capability invocation path 执行
- **AND** 结果 MUST 使用 `CapabilityInvocationResult`
- **AND** Workflow MUST 在当前 Agent Scope 和 Owner Scope 内执行且不得创建子 session

#### Scenario: Recipe 不存在

- **WHEN** `recipeName` 未命中当前 Agent Scope 的已注册 Workflow capability
- **THEN** 结果 MUST 为 `FAILED + RECIPE_NOT_FOUND + NOT_FOUND + retryable=false`
- **AND** message MUST 要求选择当前已注册 recipe 或不使用 Workflow
- **AND** 结果 MUST NOT 泄漏 registry 或文件路径

#### Scenario: Workflow 完成

- **WHEN** Workflow execution 返回 `COMPLETED`
- **THEN** Capability result MUST 为 `SUCCEEDED`
- **AND** payload MUST 包含 `recipeName`、`status="succeeded"`、安全 `outputVariables` 和有界 `answerPreviews`

#### Scenario: Workflow 中断

- **WHEN** Workflow execution 返回 `INTERRUPTED`
- **THEN** Capability result MUST 为 `FAILED`
- **AND** `safeError` MUST 使用 `CANCELED + retryable=false`

#### Scenario: Workflow WAITING 是成功控制结果

- **WHEN** Workflow execution 返回 `WAITING`，并携带符合 pending input contract 且 questions 非空的 `pendingInput`，或至少一个非空 answer preview
- **THEN** Workflow Capability result MUST 为 `SUCCEEDED`
- **AND** 结果 MUST NOT 携带 `safeError`
- **AND** 结果 MUST 保留 `status="waiting"` 和全部可用 pending context
- **AND** 当 `pendingInput` 无效但 answer previews 非空时，结果 MUST 省略 `pendingInput` 并保留 answer previews

#### Scenario: Workflow WAITING 没有可用 context 时安全失败

- **WHEN** Workflow execution 返回 `WAITING`
- **AND** `pendingInput` 缺失、无效或 questions 为空
- **AND** answer previews 为空
- **THEN** Workflow Capability result MUST 使用空 `structuredPayload` 的 `FAILED`
- **AND** `safeError` MUST 为 `CAPABILITY_EXECUTION_FAILED + INTERNAL + retryable=false`
- **AND** message MUST 要求停止当前 Workflow 动作并报告错误

#### Scenario: Workflow 结果保持有界和安全

- **WHEN** Workflow Tool 返回 execution result
- **THEN** 每条 answer preview MUST 不超过 `4000` 个字符且最多返回 `10` 条
- **AND** `outputVariables` MUST 经过安全过滤
- **AND** payload、metadata 和 timeline projection MUST NOT 包含 secret、credential、raw provider error 或 Workflow 内部实现细节

#### Scenario: Workflow metadata 只保留声明的安全事实

- **WHEN** Workflow execution 提供 `executionId`、`nodeResultCount`、两者之一或两者都不提供
- **THEN** Workflow Tool MUST 只投影有值的 `executionId` 和非负安全整数 `nodeResultCount`
- **AND** 两者都无值时 Capability result MUST 省略 metadata，而不是返回空 object

#### Scenario: Workflow metadata 拒绝未声明或非法字段

- **WHEN** Workflow Tool 将 `durationMs`、secret、provider/internal 字段，或负数、非整数、非安全整数的 `nodeResultCount` 放入 metadata
- **THEN** 受治理结果 MUST 在交付调用方前映射为 `FAILED + CAPABILITY_OUTPUT_INVALID + VALIDATION + retryable=false`
- **AND** 非法 metadata 的字段和值 MUST NOT 进入模型、timeline、history 或其他公共结果投影

### Requirement: 参数校验一次返回当前阶段全部违规

Capability 公共 input schema 校验和一方 Capability 自有的本地语义校验 MUST 分阶段执行。任一阶段失败时，系统 MUST 返回该阶段全部可以在不执行副作用、不访问新的外部状态且前置条件已经成立的独立违规。

参数校验失败 MUST 使用 `FAILED`、`safeError.category=VALIDATION` 和 `safeError.retryable=false`。`safeError.message` MUST 说明失败阶段、违规数量和“修改列出的字段后重新调用”的下一步。`safeError.safeDetails.violations` MUST 是至少包含一项的数组，MUST NOT 为 `null`；每项 MUST 是只包含以下三个必填非空字符串字段的对象，MUST NOT 接受其他字段：

- `path`：相对于 Capability input 根对象的 JSON Pointer。
- `constraint`：稳定的约束名称。
- `expected`：不含非法原值的安全期望描述。

能够唯一归属于单个已声明字段的违规，其 `path` MUST 指向该字段；`required` 违规 MUST 指向缺失的 schema 声明字段，数组元素 MUST 保留索引。只有对象整体或多个已声明字段之间的约束无法唯一归属于单个字段时，`path` 才能指向包含这些字段的最近共同父对象，且 `expected` MUST 使用 schema 声明字段名说明字段关系。

schema 声明的字段名属于可信契约信息，MUST 在 JSON Pointer 中精确保留；系统 MUST NOT 因字段名包含 `credential`、`token`、`prompt` 或其他敏感关键词而将已声明字段改写为泛化 `/field`。对 `anyOf` 或 `oneOf`，只有输入中显式 `const`/`enum` discriminator 唯一匹配一个候选分支时，formatter 才能删除其他分支的 branch-local errors。没有唯一匹配时，系统 MUST NOT 猜测当前分支，MUST NOT 返回任一候选分支私有的 `required` 或 `type` error，MUST 返回父对象路径上的 `anyOf`/`oneOf` 聚合 violation；同一父对象的 additional-property allowed fields MUST 使用全部候选分支声明字段的稳定排序并集。

违规 MUST 按 `path`、`constraint` 稳定排序；只有 `path` 和 `constraint` 都相同的重复项可以合并。additional-property 违规的 `path` MUST 指向包含该属性的最近合法父对象，根对象使用空 JSON Pointer；`constraint` MUST 为 `additionalProperties`；`expected` MUST 列出该违规前置条件已经成立的当前 schema 分支在该父对象允许的完整字段清单，清单顺序 MUST 稳定；没有允许字段时 MUST 明确说明该对象不允许任何字段。系统 MUST NOT 把未声明属性名写入 `path`、`expected` 或其他安全字段。系统 MUST NOT 为聚合错误而执行 Capability、查询外部状态、扩大权限或回显非法原值。

系统 MUST 先收集当前阶段全部独立违规，再按 `Capability 结果复用统一容量和转储机制` 检查完整失败结果。完整结果未超过公共单结果容量时 MUST 返回全部违规；超过该容量时 MUST 返回 `CAPABILITY_RESULT_LIMIT_EXCEEDED + VALIDATION + retryable=false`，`safeError.safeDetails.violations` MUST 缺失，`safeError.message` MUST 要求减少输入对象或数组规模、移除未声明字段或拆分为多个调用。容量失败 MUST NOT 开始 Capability execution，也 MUST NOT 返回截断的 violations。

**需求类别**：功能性需求

#### Scenario: 一次返回多个 schema 违规

- **WHEN** 同一个 Capability 输入同时违反 required、type、range 和 additional-property 约束
- **THEN** 本次调用 MUST 返回当前 schema 阶段全部四类违规
- **AND** Capability execution attempt 数 MUST 为 `0`
- **AND** `violations` MUST 不包含任一非法原值

#### Scenario: 范围错误精确定位可修改字段

- **GIVEN** Capability schema 声明 `limit` 必须是 `1` 至 `100` 的整数
- **WHEN** 输入中的 `limit` 大于 `100`
- **THEN** 对应 violation 的 `path` MUST 为 `/limit`
- **AND** `constraint` MUST 为 `maximum`
- **AND** `expected` MUST 说明 `limit` 的安全合法范围且 MUST NOT 包含非法原值

#### Scenario: 未知字段通过允许字段清单纠正

- **GIVEN** Capability 根 input schema 当前分支只允许 `query`、`limit` 和 `filters`
- **WHEN** 根输入对象包含一个未声明属性
- **THEN** 对应 violation 的 `path` MUST 为空 JSON Pointer
- **AND** `constraint` MUST 为 `additionalProperties`
- **AND** `expected` MUST 完整列出 `query`、`limit` 和 `filters`
- **AND** `safeError` 的全部字段 MUST NOT 包含该未声明属性名

#### Scenario: 声明字段名保持精确路径

- **GIVEN** schema 声明必填字段 `credentialRef` 和 `tokenCount`
- **WHEN** 输入缺失这些字段
- **THEN** violations 的路径 MUST 精确包含 `/credentialRef` 和 `/tokenCount`
- **AND** 系统 MUST NOT 将可信声明字段名替换为 `/field`

#### Scenario: 歧义组合分支不猜测

- **WHEN** 输入没有唯一匹配 `anyOf` 或 `oneOf` 分支的显式 discriminator
- **THEN** 系统 MUST 只返回父对象上的组合分支聚合 violation
- **AND** 系统 MUST NOT 返回任一候选分支私有的 `required` 或 `type` violation
- **AND** additional-property 的 allowed fields MUST 是全部候选分支声明字段的稳定排序并集

#### Scenario: 语义校验收集全部独立违规

- **WHEN** schema 已通过，且多个 Capability 自有语义约束可以独立判断
- **THEN** 本次调用 MUST 返回全部这些语义违规
- **AND** 依赖无效前置条件的规则 MUST 被跳过
- **AND** 不依赖该前置条件的规则 MUST 继续校验

#### Scenario: 完整违规超过公共单结果容量

- **WHEN** 当前校验阶段的全部安全 violations 使完整失败结果超过公共单结果容量
- **THEN** 系统 MUST 返回 `CAPABILITY_RESULT_LIMIT_EXCEEDED + VALIDATION + retryable=false`
- **AND** Capability execution attempt 数 MUST 为 `0`
- **AND** 系统 MUST NOT 截断 violations 或返回部分违规数组
- **AND** message MUST 指示调用方缩小、清理或拆分输入

### Requirement: 安全业务错误和未知异常使用确定映射

Capability producer 或下游依赖已经返回合法 `SafeError` 时，调用结果 MUST 保持其 `code`、`category`、`message`、`retryable` 和 `safeDetails`，除非 owning Capability 明确定义了更窄的业务映射。最终 category 为 `TIMEOUT` 时 status MUST 为 `TIMED_OUT`；其他失败 category 的 status MUST 为 `FAILED`。可纠正错误的 `message` MUST 说明安全的失败条件、期望状态或形态，以及至少一个可执行下一步。

仅因输入未满足可声明约束、且修改输入即可满足该约束的拒绝 MUST 映射为 `VALIDATION + retryable=false`，MUST NOT 映射为 `AUTHORIZATION` 或 `POLICY_DENIED`。只有当前可信身份、Agent Scope、Owner Scope、Capability authority 或当前生效策略明确禁止该动作时，系统才能使用 `AUTHORIZATION` 或 `POLICY_DENIED`。

同步 throw、异步 rejection、非法 `CapabilityInvocationResult` envelope、非法 generated message、非法 ref、非法 metadata 和其他未知执行异常 MUST 映射为阶段稳定的 `INTERNAL + retryable=false`。`GovernedCapabilityInvocationPort` 返回 producer result 前，Capability 的声明 output 或结构化 delta 未通过对应 schema 时 MUST 映射为 `code=CAPABILITY_OUTPUT_INVALID`、`category=VALIDATION`、`retryable=false`；该分类表示输出契约校验失败，不表示输入字段违规。可信 `AFTER_CAPABILITY_RESULT` hook 按自身契约完成的后置转换 MUST NOT 重新应用原 Capability `outputSchema`。上述错误 MUST NOT 被映射为业务 `CONFLICT` 或瞬态 `UNAVAILABLE`。

只有 Capability 未启用、未发现或对当前可信 scope 不可见时才能使用 `UNAVAILABLE` 或 owning not-found 语义。descriptor 与请求不一致、available descriptor 没有 executor、匹配多个 executor、executor factory 同步 throw/异步 rejection，以及其他 executor selection 异常 MUST 使用 `CAPABILITY_EXECUTION_FAILED + INTERNAL + retryable=false`。统一边界的 internal message MUST 指出固定安全阶段，并明确调用“未开始”或“已经停止”；message MUST 以停止该动作并报告错误的建议结束，MUST NOT 暴露 raw cause。

`safeDetails.reasonCode` MUST 只表达比 `safeError.code` 更窄的二级原因；两者值完全相同时 MUST 省略 `reasonCode`。例如 `COMMAND_NOT_ALLOWED` 配合 `BASH_COMMAND_UNCLOSED_QUOTE` 合法，`NL2PY_GUARD_BLOCKED` 配合同名 reason code 不合法。

只有执行事实 owner 明确确认“已 dispatch 且副作用结果无法确定”时，系统 MUST 使用 `code=CAPABILITY_RESULT_UNKNOWN` 和 `retryable=false`。系统 MUST NOT 仅根据 `NON_IDEMPOTENT`、timeout 或连接中断推断结果未知。

**需求类别**：功能性需求

#### Scenario: 安全业务错误穿过执行边界

- **WHEN** Capability producer 返回合法 `CONFLICT`，并在 message 中要求先查询当前状态
- **THEN** 最终 `safeError` MUST 保持 producer 的全部安全字段
- **AND** 系统 MUST NOT 使用通用 `Capability execution failed` 覆盖 message

#### Scenario: Agent child timeout 保持最终状态相容

- **WHEN** Agent Tool 收到 child `status=FAILED` 且合法 `safeError.category=TIMEOUT`
- **THEN** 最终 Capability result status MUST 为 `TIMED_OUT`
- **AND** 最终 `safeError` MUST 原样保留 child 的 `code/category/message/retryable/safeDetails`
- **AND** 最终结果 MUST NOT 包含 child session id 或 child run id

#### Scenario: Executor selection 异常使用标准内部失败

- **WHEN** descriptor mismatch、available descriptor 没有 executor、匹配多个 executor 或 executor factory 抛出任意异常
- **THEN** 最终结果 MUST 使用 `CAPABILITY_EXECUTION_FAILED + INTERNAL + retryable=false`
- **AND** message MUST 指出 executor 选择阶段失败且调用未开始
- **AND** message MUST 要求停止该动作并报告错误且不得包含 raw cause

#### Scenario: 输出校验失败使用不可自动重试的稳定错误

- **WHEN** Capability 返回不符合声明 output schema 的结果
- **THEN** 最终结果 MUST 使用 `CAPABILITY_OUTPUT_INVALID + VALIDATION + retryable=false`
- **AND** 错误 MUST 说明 Capability 输出未满足声明契约、不得原样重复调用，并允许调用方缩小或调整请求或者改用其他 Capability
- **AND** `safeError.safeDetails.violations` MUST 缺失
- **AND** 非法输出内容 MUST NOT 进入 `safeError`、模型上下文、stream、timeline、audit、metric 或 trace

#### Scenario: 可改参数的约束拒绝不是权限拒绝

- **WHEN** Capability 拒绝调用的唯一原因是输入未满足可声明约束
- **AND** 模型可以通过修改输入满足该约束
- **THEN** 最终错误 MUST 使用 `VALIDATION + retryable=false`
- **AND** 最终错误 MUST NOT 使用 `AUTHORIZATION` 或 `POLICY_DENIED`

#### Scenario: 非幂等结果未知由执行事实明确声明

- **WHEN** 非幂等 Capability 已 dispatch，且 producer 明确无法判断副作用是否完成
- **THEN** 最终错误 MUST 使用 `CAPABILITY_RESULT_UNKNOWN`
- **AND** timeout 事实 MUST 使用 `TIMED_OUT + TIMEOUT`
- **AND** 非 timeout 的断连或执行中断事实 MUST 使用 `FAILED + UNAVAILABLE`
- **AND** message MUST 要求通过独立查询核验实际状态
- **AND** 系统 MUST NOT 自动重放该调用

### Requirement: 模型可调用 Tool 的失败消息具有确定语义

每个模型可调用 Tool 的最终 `safeError.message` MUST 使用安全的领域语义说明本次调用为什么没有得到预期结果。message MUST 与 `code`、`category`、`retryable` 和 `safeDetails` 一致，MUST NOT 只包含“执行失败”“安全失败”“不可用”或“响应无效”等无法支持下一步判断的泛化描述。

message MUST 按最终错误事实满足以下规则：

- `VALIDATION`：公共 schema 或 Tool 本地语义校验失败时，说明失败阶段和修改输入的下一步，字段、约束和期望形态 MUST 位于 `safeError.safeDetails.violations`；`CAPABILITY_OUTPUT_INVALID` 必须说明输出契约校验失败、不得原样重复调用，并允许缩小或调整请求或者改用其他 Capability，`safeError.safeDetails.violations` MUST 缺失；post-dispatch 公共结果容量失败时，message MUST 说明缩小请求或降低结果数量的动作，`safeError.safeDetails.violations` MUST 缺失。
- `NOT_FOUND`：说明目标不存在或当前不可见，并指出安全的重新发现、查询或替代动作。
- `CONFLICT`：说明所依赖状态已变化或前置状态未满足，并指出必须先完成的刷新、读取或状态核验动作。
- `UNAVAILABLE` 或 `TIMEOUT`：说明不可用或超时的边界；统一执行边界耗尽自动重试后，message MUST 指出改用其他 Capability、缩小操作、稍后再试或结束当前动作中的至少一个安全选择。
- `AUTHORIZATION` 或 `POLICY_DENIED`：说明该动作在当前可信范围内不允许，MUST NOT 暗示修改同一参数即可绕过，并 MUST 指出选择已允许的替代 Capability、普通答复或结束中的至少一个安全下一步。
- `INTERNAL`：说明失败的安全阶段和调用已停止，MUST NOT 暗示修改业务参数即可恢复，并 MUST 指出选择其他 Capability、普通答复或结束中的至少一个安全下一步。
- `CAPABILITY_RESULT_UNKNOWN`：说明副作用结果无法确认，并要求先通过独立查询核验状态。
- `CANCELED`：说明调用已取消，MUST NOT 暗示框架会继续执行或自动重试。

除取消外，模型可见的最终失败 message MUST 至少提供一个无需猜测隐藏实现即可执行的下一步，MUST NOT 要求模型原样再次调用相同 Capability。对于 authorization、policy 或 internal 失败，该下一步 MUST NOT 暗示可绕过当前权限、安全策略或执行边界。动态 message MUST NOT 回显被拒绝的原始参数值、prompt、命令、代码、文件内容、provider response、credential、token、宿主路径或未经安全投影的输出。

**需求类别**：功能性需求

#### Scenario: 可恢复错误明确告诉模型下一步

- **WHEN** first-party Tool 返回输入 `VALIDATION`、`CAPABILITY_OUTPUT_INVALID`、`NOT_FOUND`、`CONFLICT`、最终 `UNAVAILABLE` 或最终 `TIMEOUT`
- **THEN** `safeError.message` MUST 说明失败条件
- **AND** message 或同一 `safeError` 的 violations MUST 说明期望状态或形态
- **AND** message MUST 给出至少一个安全、可执行的下一步

#### Scenario: 权限、策略、内部和结果未知错误提供安全替代建议

- **WHEN** first-party Tool 返回 `AUTHORIZATION`、`POLICY_DENIED`、`INTERNAL` 或 `CAPABILITY_RESULT_UNKNOWN`
- **THEN** `safeError.message` MUST 说明失败事实并提供安全替代动作；结果未知时 MUST 要求独立核验
- **AND** message MUST NOT 建议原样重试同一调用
- **AND** authorization 或 policy message MUST NOT 暗示可通过修改同一参数绕过当前边界

#### Scenario: 泛化失败文本不满足消息契约

- **WHEN** Tool 只返回未说明失败对象、阶段或下一步的泛化 message
- **THEN** 该结果 MUST 被视为不满足 first-party Tool 失败契约
- **AND** 验收 MUST 覆盖该 Tool 的具体安全 message

### Requirement: 瞬态失败只在统一执行边界安全重试

`CapabilityInvocationRequest.maxRetries` 的有效域 MUST 为 `0` 到 `5` 的安全整数，表示初始 execution attempt 之后最多允许的额外同参重试次数。字段缺失时 effective `maxRetries` MUST 为 `1`，因此默认总 execution attempt 数最多为 `2`；显式 `0` MUST 禁止自动同参重试。当统一执行边界收到非整数、负数、非安全整数或大于 `5` 的值时，effective `maxRetries` MUST 统一归一化为 `0`。系统 MUST 继续正常调用流程，并在调用前门禁通过后执行一次初始 attempt；系统 MUST NOT 仅因该非法值返回配置失败或启动第二次 attempt。

同一次逻辑 Capability 调用仅在以下条件全部成立、且已经执行的 retry 次数小于 effective `maxRetries` 时 MUST 启动下一次同参 attempt：

1. 首次 attempt 返回 `FAILED` 或 `TIMED_OUT`。
2. `safeError.category` 为 `UNAVAILABLE` 或 `TIMEOUT`。
3. `safeError.retryable=true`。
4. 已解析 descriptor 的 `replayPolicy=IDEMPOTENT`。
5. 父 `AbortSignal` 尚未取消。
6. `safeError.code` 不是 `CAPABILITY_RESULT_UNKNOWN`。
7. 当前 attempt 尚未调用 `CapabilityInvocationRuntimeContext.emitResultDelta`。

任一条件不成立时 MUST NOT 自动重试。`CapabilityInvocationRequest.timeoutMs` MUST 表示单次 execution attempt 的超时预算；第二次 attempt MUST 接收与第一次相同的原始 `timeoutMs`。同一个父 `AbortSignal` MUST 贯穿两次 attempt；所属请求、节点或上层调用取消时，该 signal MUST 终止当前 attempt 并禁止后续 attempt。

统一受治理执行边界 MUST 在每个 attempt 首次调用 `emitResultDelta` 时把该 attempt 视为已产生可见结果意图；即使 delta 校验或下游 emitter 随后失败，也 MUST NOT 重试该 attempt。producer MUST await emitter；attempt 结束后晚到 delta MUST 被拒绝且不得投影。调用方可见的 Capability 中间结果 MUST NOT 绕过该 callback 直接写 stream、timeline 或 session。

重试 MUST 复用原 `CapabilityInvocationRequest`、`invocationId`、`toolCallId` 和 `idempotencyKey`，并 MUST 在前一 attempt settle 且门禁成立后立即执行。同一逻辑调用的全部 attempt MUST 使用首次调用已接受的同一 descriptor snapshot 和 execution target，MUST NOT 在 retry 期间重新选择 Capability。一次逻辑调用最多消耗 `effective maxRetries + 1` 个 execution attempt timeout budget；调用方生命周期由父 `AbortSignal` 限制。调用方 MUST 只收到最后一次 attempt 的 `CapabilityInvocationResult`；中间失败 MUST NOT 进入模型上下文、Workflow exception 或 `CAPABILITY_RESULT` 消息。

**需求类别**：功能性需求

#### Scenario: 幂等瞬态失败自动恢复

- **WHEN** 首次 attempt 返回 `UNAVAILABLE + retryable=true`，且 descriptor 是 `IDEMPOTENT`
- **AND** 第二次 attempt 成功
- **THEN** 调用方 MUST 只收到成功结果
- **AND** execution attempt 数 MUST 为 `2`

#### Scenario: 缺省重试次数最多产生两次调用

- **GIVEN** `CapabilityInvocationRequest.maxRetries` 缺失
- **WHEN** 每次 attempt 都返回满足全部安全门禁的瞬态失败
- **THEN** effective `maxRetries` MUST 为 `1`
- **AND** execution attempt 数 MUST 为 `2`

#### Scenario: 显式零次重试只执行初始调用

- **GIVEN** `CapabilityInvocationRequest.maxRetries=0`
- **WHEN** 初始 attempt 返回满足其他全部安全门禁的瞬态失败
- **THEN** execution attempt 数 MUST 为 `1`
- **AND** 调用方 MUST 收到初始 attempt 的最终失败

#### Scenario: 重试次数表示初始调用之后的额外次数

- **GIVEN** `CapabilityInvocationRequest.maxRetries=2`
- **WHEN** 每次 attempt 都返回满足全部安全门禁的瞬态失败
- **THEN** execution attempt 数 MUST 为 `3`
- **AND** 系统 MUST NOT 启动第四次 attempt

#### Scenario: 双条件任一不满足时不重试

- **WHEN** `safeError.retryable=false` 或 descriptor 是 `NON_IDEMPOTENT`
- **THEN** execution attempt 数 MUST 为 `1`
- **AND** 调用方 MUST 收到首次最终失败

#### Scenario: 已产生可见增量时不重试

- **WHEN** 首次 attempt 调用了 `emitResultDelta`
- **AND** 随后返回 `UNAVAILABLE + retryable=true`
- **THEN** execution attempt 数 MUST 为 `1`
- **AND** 调用方 MUST 收到该次调用的最终失败

#### Scenario: Delta emitter 拒绝后仍不重试

- **WHEN** 首次 attempt 调用 `emitResultDelta`，且 delta 校验或下游 emitter 拒绝
- **THEN** execution attempt 数 MUST 为 `1`
- **AND** 系统 MUST 返回安全的最终失败
- **AND** 非法或未完成投影的 delta MUST NOT 进入调用方可见边界

#### Scenario: 瞬态重试耗尽

- **GIVEN** effective `maxRetries=1`
- **WHEN** 两次 attempt 都返回符合重试条件的瞬态失败
- **THEN** 调用方 MUST 只收到第二次最终失败
- **AND** execution attempt 数 MUST 为 `2`
- **AND** 后续调用方 MUST NOT 再以自动重试名义调用相同 Capability

#### Scenario: Timeout 后的第二次 attempt 获得完整预算

- **GIVEN** `CapabilityInvocationRequest.timeoutMs=30000` 且父 `AbortSignal` 未取消
- **WHEN** 第一次 attempt 在自身 timeout budget 结束时返回 `TIMEOUT + retryable=true`
- **AND** descriptor 是 `IDEMPOTENT`
- **THEN** 第二次 attempt MUST 继续接收 `timeoutMs=30000`

#### Scenario: 父生命周期取消阻止重试

- **WHEN** 第一次 attempt 返回可重试瞬态失败后父 `AbortSignal` 已取消
- **THEN** execution attempt 数 MUST 为 `1`
- **AND** 系统 MUST 返回 `FAILED + safeError.category=CANCELED + retryable=false`

#### Scenario: 第二次 attempt 不绕过父生命周期

- **GIVEN** effective `maxRetries=1`，且第二次 attempt 已使用与第一次相同的完整 `timeoutMs` 启动
- **WHEN** 父 `AbortSignal` 在第二次 attempt 完成前取消
- **THEN** 系统 MUST 取消当前 attempt 并返回 `FAILED + safeError.category=CANCELED + retryable=false`
- **AND** 系统 MUST NOT 启动第三次 attempt

#### Scenario: 调用前或 descriptor 解析期间取消不启动执行

- **WHEN** 父 `AbortSignal` 在 invocation 开始前已取消，或在 descriptor 解析期间取消
- **THEN** descriptor 解析 MUST 使用该父 signal 停止
- **AND** execution attempt 数 MUST 为 `0`
- **AND** 系统 MUST 返回 `FAILED + safeError.category=CANCELED + retryable=false`

#### Scenario: 非法重试上限按零次重试执行初始调用

- **WHEN** `CapabilityInvocationRequest.maxRetries` 是负数、非整数、非安全整数或大于 `5`
- **THEN** effective `maxRetries` MUST 为 `0`
- **AND** execution attempt 数 MUST 为 `1`
- **AND** 系统 MUST NOT 启动第二次 attempt
- **AND** 调用方 MUST 收到初始 attempt 的最终结果

### Requirement: 所有一方 Tool 闭合统一失败契约

仓库提供且可由生产装配注册的 first-party Tool definition 闭包 MUST 恰好覆盖：

`Read`、`Write`、`Edit`、`Glob`、`Grep`、`Bash`、`Python`、`AskUserQuestion`、`Agent`、`Skill`、`Rag`、`ToolSearch`、`TodoWrite`、`Workflow`、`Cron`、`search_memory`、`get_memory_detail`、`add_memory`、`acquire_skill`、`ApiCall`。

其中前 19 个 Tool 可以进入模型可见目录；`ApiCall` 是隐藏的编排专用 Tool，MUST NOT 暴露为普通模型可选 Tool。隐藏属性只改变调用入口，不改变公共失败、输出校验、取消和安全规则。

每个 Tool MUST 对其可发生的 descriptor/availability、公共 schema、Tool 自有语义校验、dependency/context/authority、下游业务结果、cancel/timeout/result-unknown、result/output/unknown exception 失败产生本 spec 定义的可观察结果。对某个 Tool 不可发生的阶段不要求合成运行时失败。CLIP 和 Plugin Tool MUST 遵守相同公共 schema、结果校验、错误保真和未知异常规则。

每个 first-party Tool 的全部实际失败出口 MUST 具有唯一的目标 status、`code/category/retryable`、message 语义、Agent disposition 和 Workflow disposition。任一新增或改变的失败出口 MUST 在进入生产注册闭包前满足相同映射。Tool-specific message MUST 遵守 `模型可调用 Tool 的失败消息具有确定语义`；公共 schema、取消、输出无效和 unknown exception 可以复用统一边界的阶段消息。

**需求类别**：功能性需求

#### Scenario: 注册闭包中的每个 Tool 遵守完整失败契约

- **WHEN** 上述任一 first-party Tool 在其适用失败阶段被调用
- **THEN** 调用 MUST 返回该阶段对应的统一安全结果
- **AND** 同步 throw、异步 rejection、取消和非法 producer result MUST 在受治理调用返回前完成规范化
- **AND** Tool 自有业务错误 MUST 保留 owning Tool 提供的安全 code 和 message

#### Scenario: 每个实际失败出口都有完整映射

- **WHEN** 上述任一 first-party Tool 进入任一实际可发生的失败出口
- **THEN** 该出口 MUST 产生唯一的 status、`code/category/retryable` 和安全 message
- **AND** Agent 与 Workflow MUST 能依据统一最终结果执行各自的恢复、终止或 exception 处置
- **AND** 系统 MUST NOT 把该出口留给 unknown exception 兜底代替已知业务映射

#### Scenario: 隐藏 ApiCall 进入同一失败闭包

- **WHEN** 编排路径调用隐藏 `ApiCall`
- **THEN** `ApiCall` MUST 使用与其他 first-party Tool 相同的公共 input、最终结果、输出校验、取消和未知异常规则
- **AND** `ApiCall` MUST NOT 出现在普通模型可选 Tool 目录

#### Scenario: 合法空查询不是错误

- **WHEN** `Glob`、`Grep`、`Rag`、`ToolSearch`、`search_memory` 或 `get_memory_detail` 返回合法空集合或业务定义的未命中项
- **THEN** 结果 MUST 保持相应成功结构
- **AND** 系统 MUST NOT 根据结果为空生成 `NOT_FOUND` 或其他 `safeError`

### Requirement: Capability 结果复用统一容量和转储机制

公共单个 Capability 结果容量 MUST 是规范化 `CapabilityInvocationResult` 的 JSON serialization 不超过 `256000` 个 UTF-16 code unit。该容量 MUST 同等适用于 `SUCCEEDED`、`DEGRADED`、`FAILED` 和 `TIMED_OUT`，MUST NOT 因结果失败而使用更小的专用上限。

结果遍历 MUST 同时执行节点计数预算和深度预算保护。节点 MUST 包含对象、数组、对象属性值和数组元素；标量值（string、number、boolean、null）MUST 计为节点。节点计数预算 MUST 为 `10000`，深度预算 MUST 为 `64`。遍历 MUST 在每次增加节点计数后立即检查预算，超过任一预算时 MUST 立即停止遍历并返回 `CAPABILITY_RESULT_LIMIT_EXCEEDED + VALIDATION + retryable=false`，MUST NOT 在遍历完成后才检查。

未超过公共单结果容量的完整结果 MUST 进入同一 schema validation、序列化和大结果转储机制。超过 inline 阈值但未超过公共单结果容量的结果在进入模型可见 session 结果时 MUST 保存完整内容，并提供受治理的结果引用和回读说明。超过公共单结果容量的结果 MUST 整体替换为 `CAPABILITY_RESULT_LIMIT_EXCEEDED + VALIDATION + retryable=false`，MUST NOT 截断、静默省略或建立第二套转储；message MUST 对只读调用要求缩小输入或结果规模，对已经执行的非幂等调用禁止原样重放，并要求使用 owning Capability 已声明的独立查询核验状态；没有该查询时 MUST 要求停止并向用户报告结果无法安全交付。

**需求类别**：系统质量属性
**质量属性**：性能/容量
**适用范围**：`FN-5.2 调用能力`

#### Scenario: 大型校验诊断通过公共结果转储

- **WHEN** 安全的 `safeError.safeDetails.violations` 使完整失败结果超过公共 inline 阈值但不超过 `256000` 个 UTF-16 code unit
- **THEN** 系统 MUST 保存完整结果并向模型提供受治理的结果引用和回读说明
- **AND** 系统 MUST NOT 静默删除 violation

#### Scenario: 所有状态使用同一公共容量

- **WHEN** 任一状态的规范化 `CapabilityInvocationResult` JSON serialization 超过 `256000` 个 UTF-16 code unit
- **THEN** 系统 MUST 返回 `CAPABILITY_RESULT_LIMIT_EXCEEDED + VALIDATION + retryable=false`
- **AND** 系统 MUST NOT 返回截断的原结果

#### Scenario: 节点计数超过预算时立即终止

- **WHEN** 结果遍历过程中节点计数超过 `10000`
- **THEN** 系统 MUST 立即停止遍历
- **AND** 系统 MUST 返回 `CAPABILITY_RESULT_LIMIT_EXCEEDED + VALIDATION + retryable=false`
- **AND** 系统 MUST NOT 读取剩余节点

#### Scenario: 深度超过预算时立即终止

- **WHEN** 结果遍历过程中嵌套深度超过 `64`
- **THEN** 系统 MUST 返回 `CAPABILITY_RESULT_LIMIT_EXCEEDED + VALIDATION + retryable=false`

### Requirement: Capability 失败证据不跨安全边界

raw exception、stack、cause、宿主路径、credential、token、prompt、provider response 和未经安全投影的 Capability 输出 MUST NOT 进入模型上下文、Web、stream、timeline、audit、metric 或 trace。本地 runtime diagnostic MAY 仅在 `runtime-logging` 的受控执行异常规则允许时记录脱敏后的 `rawExceptionData`；默认不记录，记录与否 MUST NOT 改变任何公共失败结果或其他可观察投影。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：`FN-5.2 调用能力`

#### Scenario: 原始异常不跨越安全边界

- **WHEN** Capability execution 产生包含路径、stack、credential 或 provider response 的未知异常
- **THEN** 公共结果 MUST 只包含对应阶段的稳定安全 code 和 message
- **AND** 禁止内容 MUST NOT 出现在任一公共或模型可见投影

### Requirement: Capability 内部来源诊断保持模型不可见

`CapabilityInvocationResult.metadata.sourceTrace` MUST 被视为有界的内部来源诊断。该顶层 metadata key MUST 只作为本地 canonical `toolOutput` 的内部诊断输入，MUST NOT 被视为安全 model-visible metadata。系统 MUST 在唯一的通用 Capability result 模型投影边界剔除该 key，并 MUST NOT 把它写入后续模型输入或 durable `CAPABILITY_RESULT`。

该过滤 MUST 只按 `CapabilityInvocationResult.metadata` 的顶层 exact key 工作。通用投影 MUST NOT 递归扫描 `structuredPayload`、解析 memory domain record、按 Tool 名称建立例外或删除其他已接受的安全 metadata。`metadata.sourceTrace` MUST NOT 扩散到 Web API、SSE、WebSocket、timeline event、SafeError、audit record、metric sample、trace attribute 或 `ObservabilityObservationEvent`。

**需求类别**：系统质量属性

**质量属性**：安全

**适用范围**：`FN-5.2 调用能力`

#### Scenario: 内部来源只进入本地 Tool 输出诊断
- **WHEN** Capability 成功结果包含安全业务 `structuredPayload` 和顶层 `metadata.sourceTrace`
- **THEN** 未触发既有单条日志容量 fallback 时，本地 canonical `toolOutput` MUST 在 credential 脱敏约束内记录两者
- **AND** 触发既有单条日志容量 fallback 时，系统 MUST 使用既有有界降级结果且不得把内部来源转移到其他 outward surface
- **AND** 后续模型输入和 durable `CAPABILITY_RESULT` MUST 保留业务 `structuredPayload` 但 MUST NOT 包含 `metadata.sourceTrace`
- **AND** public stream、timeline、SafeError、audit、metric、trace 和 observation MUST NOT 包含该内部来源

#### Scenario: 通用投影不理解 Tool 业务结构
- **WHEN** 通用 Capability result 投影处理包含 `metadata.sourceTrace` 的任意 Capability 结果
- **THEN** 投影 MUST 仅删除 metadata 的 exact top-level `sourceTrace` key
- **AND** 投影 MUST 保留其他已接受的安全 metadata
- **AND** 投影 MUST NOT 按 capability id、Tool name 或 `structuredPayload` 内部字段结构分支
