# invoked-agent-discovery Specification

## Purpose

Defines how builtin Agents, top-level local Agents, and parent-local subagents are projected as governed `AGENT` capability descriptors for model-visible delegation without introducing a parallel Agent catalog or exposing package-private Agent facts.
## Requirements
### Requirement: Subagents Are Discovered As Governed Agent Capabilities

系统 MUST 将可信内置 Agent capability、`agents/` 顶层 local Agent capability 和父 Agent package 下的本地 subagent 发现为统一 `CapabilityDescriptor(kind="AGENT")` candidate。Agent capability discovery MUST 复用现有 `CapabilityDiscovery`、`CapabilityDescriptor` 和 `CapabilityCatalog` contract，不得新增第二套 Agent descriptor、Agent catalog、Agent invocation envelope 或 subagent-only manifest。可信内置 Agent capability MUST 由 reserved `providerId="builtin-agents"`、`providerKind="BUNDLED"` 暴露；本地顶层 Agent MUST 由 reserved `providerId="local-agents"`、`providerKind="LOCAL_DIRECTORY"` 暴露；父 Agent package 下的本地 subagent MUST 由 reserved `providerId="local-subagents"`、`providerKind="LOCAL_DIRECTORY"` 暴露。这些 provider identity 只能来自可信 capability startup provider contributions，外部 `CapabilityProviderConfig` 不得声明、覆盖或禁用。

Agent capability discovery MUST obtain Agent candidates from the `AgentDiscoverySource` implementation injected by `agent-app`. That source MUST return compiled `AgentAssembly` facts, not raw `agent.yaml` content or package paths. Discovery MUST map those assemblies to descriptors and MUST NOT parse `agent.yaml` or compile Agent assemblies inside `agent-capability`. The only local Agent provider identities are `builtin-agents`, `local-agents`, and `local-subagents`; implementations MUST NOT keep `local-agents-parent-owned` or locator-backed Agent discovery as an alternate production path.

Builtin Agent business packages MUST be owned by `agent-core` under `builtin-agents/{agentId}/agent.yaml` with optional package-local `prompts/`. `agent-core` MUST expose only the trusted `builtin-agents` root directory; `agent-app` MUST scan its direct child directories and use the same parser/compiler path as local Agent packages. `agent-core` MUST NOT own discovery, parser/compiler execution, prompt template registration, Catalog publication, runtime assembly registry implementation, or a hand-maintained builtin Agent id list.

`CapabilityDescriptor` MUST NOT expose `AgentAssembly.userInvocable`, `AgentAssembly.agentInvocation`, `sourceKind` or `parentAgentScope`. Discovery MUST use those assembly facts to decide whether a candidate is published as available, unavailable, or only through parent-scoped discovery before Catalog/model visibility. Catalog MUST NOT depend on descriptor metadata for these routing facts; public descriptors remain safe capability projections.

#### Scenario: Builtin Agent becomes an Agent capability candidate

- **WHEN** trusted app/capability composition registers a builtin Agent capability candidate
- **THEN** Agent capability discovery MUST receive the compiled builtin `AgentAssembly` through `AgentDiscoverySource`
- **AND** MUST produce a `CapabilityDescriptor` candidate with `kind="AGENT"`
- **AND** descriptor `provider.providerId` MUST be `builtin-agents`
- **AND** descriptor `provider.providerKind` MUST be `BUNDLED`
- **AND** the descriptor MUST enter existing Capability Catalog governance
- **AND** the descriptor MUST NOT expose raw Agent definition, prompt body, provider secret, executor wiring, child assembly or internal routing detail

#### Scenario: Local subagent becomes an Agent capability candidate

- **WHEN** 当前父 Agent package 中存在合法 `subagents/{subagentId}/agent.yaml`
- **THEN** `agent-app` MUST compile that subagent into an `AgentAssembly`
- **AND** Agent capability discovery MUST receive that compiled assembly through `AgentDiscoverySource`
- **AND** discovery MUST 为该 subagent 产生一个 `kind="AGENT"` 的 `CapabilityDescriptor` candidate
- **AND** descriptor `provider.providerId` MUST be `local-subagents`
- **AND** descriptor `provider.providerKind` MUST be `LOCAL_DIRECTORY`
- **AND** 该 descriptor MUST 进入现有 Capability Catalog governance
- **AND** 父 Agent package 的 runtime-facing `AgentAssembly` MUST NOT 直接嵌入该 subagent 的 raw package 内容、prompt 正文或子 assembly 全量对象

#### Scenario: Top-level local Agent becomes an Agent capability candidate

- **WHEN** trusted app composition exposes `agents/{agentId}/agent.yaml` through the local Agent source
- **THEN** `agent-app` MUST compile that top-level local Agent into an `AgentAssembly`
- **AND** Agent capability discovery MUST receive that compiled assembly through `AgentDiscoverySource`
- **AND** discovery MUST produce a `CapabilityDescriptor(kind="AGENT")` candidate for that top-level local Agent
- **AND** descriptor `provider.providerId` MUST be `local-agents`
- **AND** Catalog inclusion MUST NOT by itself make that Agent callable by every parent Agent

#### Scenario: Local Agent discovery uses separate top-level and subagent providers

- **WHEN** the capability subsystem creates local Agent discovery
- **THEN** it MUST create an EAGER `local-agents` discovery for `AgentDiscoverySource.listTopLevelLocalAgentAssemblies`
- **AND** it MUST create a SEARCH `local-subagents` discovery for `AgentDiscoverySource.listParentSubagentAssemblies`
- **AND** it MUST NOT create or register `local-agents-parent-owned`
- **AND** both discovery instances MUST map compiled `AgentAssembly` facts to `CapabilityDescriptor(kind="AGENT")`

#### Scenario: Implementation leaves no alternate Agent discovery path

- **WHEN** this change is fully implemented
- **THEN** production source MUST NOT retain `local-agents-parent-owned`, `LocalAgentCapabilityDiscovery`, `BuiltinAgentCandidate`, `LocalAgentPackageCandidate`, `subagentPackageLocator`, `listSubagentPackages` or `locateSubagentPackage` as Agent discovery code paths
- **AND** `agent-capability` MUST NOT parse `agent.yaml`, scan `agents/` or `subagents/`, or call Agent assembly compiler APIs for Agent discovery
- **AND** Agent discovery MUST only consume compiled `AgentAssembly` facts through `AgentDiscoverySource`

#### Scenario: Discovery reuses existing capability contracts

- **WHEN** Agent capability discovery 输出可治理候选能力
- **THEN** 输出 MUST 使用现有 `CapabilityDescriptor`
- **AND** `kind` MUST 为 `AGENT`
- **AND** provider identity MUST 使用现有 `CapabilityProvider` vocabulary
- **AND** 系统 MUST NOT 新增与 `CapabilityDescriptor` 平行的 `SubagentDescriptor`、`InvokedAgentDescriptor` 或同等 public DTO

#### Scenario: External config cannot claim builtin Agent provider identity

- **WHEN** external capability provider configuration declares provider id `builtin-agents`
- **THEN** system MUST safely reject or ignore that external provider declaration
- **AND** trusted builtin Agent candidates MUST remain owned by app/capability composition

### Requirement: All Agent Categories Enter The Unified Catalog

系统 MUST 将所有可装配 Agent 类别作为统一 `AGENT` capability candidate 进入 Capability Catalog，包括顶层 Agent、可信 builtin Agent，以及父 Agent package 自定义的本地 subagent。Catalog inclusion MUST NOT imply model visibility or invocation eligibility; runtime MUST first compute the current parent Agent's governed callable Agent view.

#### Scenario: Top-level Agent enters the Agent capability catalog

- **WHEN** trusted app composition registers or selects a top-level Agent package
- **THEN** the Agent MUST be representable as a `CapabilityDescriptor(kind="AGENT")`
- **AND** the descriptor MUST enter Capability Catalog governance
- **AND** direct/default-route Agent selection MUST remain owned by trusted app composition and runtime dispatch, not by model input or descriptor metadata

#### Scenario: Builtin Agent can enter the catalog without being user invocable

- **WHEN** trusted app/capability composition registers a builtin Agent whose assembly has `userInvocable=false` and `agentInvocation="BOUND"`
- **THEN** the Agent MUST enter the Capability Catalog as `CapabilityDescriptor(kind="AGENT")`
- **AND** the Agent MUST NOT be selectable as a direct/default-route service Agent
- **AND** another parent Agent can bind it as a callable Agent capability through `capabilityBindings`
- **AND** `CapabilityDescriptor` MUST NOT expose `userInvocable`, `agentInvocation` or equivalent runtime routing policy

#### Scenario: Builtin network explorer is a read-only invoked Agent

- **WHEN** trusted app composition registers the canonical builtin Agent `network-explorer`
- **THEN** its assembly MUST have `userInvocable=false` and `agentInvocation="BOUND"`
- **AND** because builtin tools are default-enabled by the `builtin-tools` provider, its capability bindings MUST NOT redundantly enable default read/search tools
- **AND** its capability bindings MUST explicitly disable side-effecting builtin tools such as `write`, `bash`, `python` and `skill`
- **AND** its capability bindings MUST NOT enable write, configuration mutation, remediation, approval, shell, python, script, sandbox execution, deployment, ticket update or other side-effecting capabilities
- **AND** trusted app composition MUST register its own Agent-scoped `SYSTEM_PROMPT` template facts for `network-explorer` through the context-engine prompt template registry
- **AND** builtin Agent prompt template registration MUST be derived from trusted builtin Agent package/source records and their package-local `prompts/` directory rather than one hard-coded composition-root registration per Agent id
- **AND** that `SYSTEM_PROMPT` template MUST define the role, narrow input contract, allowed read/search/query actions, prohibited side-effecting actions, evidence-summary output contract, and safety/scope constraints
- **AND** that prompt template body MUST NOT be exposed in the Agent `CapabilityDescriptor` or parent Agent prompt disclosure
- **AND** its runtime-facing `AgentAssembly` MUST NOT contain `promptTemplateIds`, `runtimeSettings.defaultPromptTemplateId`, prompt root paths, template refs, prompt body, or prompt allowlist fields
- **AND** its builtin package definition MUST NOT contain legacy `workspaceDir` or `workspaceFiles`
- **AND** its file-tool authority MUST come from the compiled `AgentAssembly.workspacePolicy.files`
- **AND** it MUST enter the Catalog as a builtin `CapabilityDescriptor(kind="AGENT")`
- **AND** it MUST only become callable for a parent Agent through that parent Agent's explicit `AGENT` binding

#### Scenario: Default builtin Agent binds builtin network explorer through configuration

- **WHEN** trusted app composition loads the default builtin Agent definition
- **THEN** that default Agent assembly MUST preserve an enabled `capabilityBindings` entry with `capabilityType="AGENT"`, `providerId="builtin-agents"` and `capabilityId="network-explorer"`
- **AND** Catalog governance MUST treat that binding the same as any parent Agent binding a builtin `BOUND` Agent
- **AND** Context Engine prompt disclosure for the default builtin Agent MUST include `network-explorer` only through the governed `### Available agents` render-stage section
- **AND** the implementation MUST NOT hard-code `network-explorer` directly into the parent prompt or use a builtin-only shortcut outside Catalog governance

#### Scenario: Non-invocable Agent enters catalog as unavailable for delegation

- **WHEN** trusted app/capability composition registers an Agent whose assembly has `agentInvocation="NONE"`
- **THEN** the Agent MUST enter the Capability Catalog as `CapabilityDescriptor(kind="AGENT")`
- **AND** discovery MUST publish it as unavailable or otherwise non-callable for delegation
- **AND** no parent Agent binding or parent-scoped discovery result MUST make it model-visible as a delegable target

#### Scenario: Parent Agent local subagent enters the catalog automatically

- **WHEN** a parent Agent package contains a valid `subagents/{subagentId}/agent.yaml`
- **THEN** the subagent MUST enter the current parent Agent request-scope Catalog view as `CapabilityDescriptor(kind="AGENT")`
- **AND** this automatic local subagent visibility MUST NOT require a synthetic `AgentAssembly.capabilityBindings` entry

#### Scenario: Governed Agent capability is rendered as prompt disclosure

- **WHEN** Context Engine renders model input for a parent Agent request
- **AND** the governed request-scope Catalog view contains `CapabilityDescriptor(kind="AGENT")` entries with `availabilityStatus="AVAILABLE"` and `modelInvocable=true`
- **THEN** the system message MUST include a fixed `### Available agents` section
- **AND** that section MUST list only governed Agent descriptors in the form `- <agent-capability-id>: <safe description>`
- **AND** the system message MUST include a `### How to use agents` section that treats them as governed delegation targets without inventing execution syntax for this discovery-only change
- **AND** `AGENT` descriptors MUST NOT be projected into `RenderedModelInput.tools` by this change
- **AND** prompt text MUST NOT expose provider-private ids, raw package paths, source identities, loading facts, prompt bodies, metadata secrets, `userInvocable`, `agentInvocation` or child assembly details

#### Scenario: Base system prompt does not imply unavailable Agent execution

- **WHEN** no concrete Agent invocation mechanism is available for the model turn
- **THEN** the base system prompt MUST NOT unconditionally instruct the model to use an Agent tool
- **AND** any general Agent delegation guidance MUST be conditional on the rendered `### Available agents` section and a concrete invocation mechanism
- **AND** the model MUST be instructed to use only listed Agent ids and not invent Agent names

### Requirement: Agent Bindings Select Callable Agent Capabilities

父 Agent MUST be able to bind builtin Agent and top-level local Agent capabilities using existing `capabilityBindings` with `capabilityType="AGENT"` when the target assembly has `agentInvocation="BOUND"`. A bound Agent can itself also have `userInvocable=true`, or can be user-invocable false and only exposed as an invoked target. Local subagents under the current parent Agent package MUST be automatically visible for that parent Agent request scope when returned by `listParentSubagentAssemblies(parentScope)`, their assembly has `agentInvocation="PARENT"`, and their `parentAgentScope` matches the current parent Agent, unless an explicit disabled binding hides them.

#### Scenario: Parent Agent binds a builtin Agent

- **WHEN** a parent Agent assembly contains an enabled binding with `capabilityType="AGENT"` and `providerId="builtin-agents"`
- **AND** the target builtin Agent assembly has `agentInvocation="BOUND"`
- **THEN** Catalog governance MUST include that Agent in the parent Agent callable Agent view when availability and conflict rules pass
- **AND** this rule MUST apply equally when the parent Agent is itself a builtin Agent

#### Scenario: Parent Agent binds a top-level local Agent

- **WHEN** a parent Agent assembly contains an enabled binding with `capabilityType="AGENT"` and `providerId="local-agents"`
- **AND** the target Agent is a top-level local Agent discovered from `agents/{agentId}/agent.yaml`
- **AND** the target Agent assembly has `agentInvocation="BOUND"`
- **THEN** Catalog governance MUST include that Agent in the parent Agent callable Agent view when availability and conflict rules pass
- **AND** the bound top-level local Agent MUST NOT need to be physically located under the parent Agent's `subagents/` directory

#### Scenario: Parent-local Agent cannot be enabled by explicit binding

- **WHEN** a parent Agent assembly contains an enabled binding to an Agent whose assembly has `agentInvocation="PARENT"`
- **THEN** Catalog governance MUST NOT make that Agent callable through the explicit binding path
- **AND** the Agent is callable only when returned by `AgentDiscoverySource.listParentSubagentAssemblies` for the current parent Agent scope because its `parentAgentScope` matches that scope

#### Scenario: Non-invocable Agent cannot be enabled by explicit binding

- **WHEN** a parent Agent assembly contains an enabled binding to an Agent whose assembly has `agentInvocation="NONE"`
- **THEN** discovery and Catalog governance MUST NOT make that Agent callable for the parent Agent
- **AND** the Agent MUST NOT be rendered as a model-visible delegable Agent target

#### Scenario: Parent Agent disables an automatically discovered local subagent

- **WHEN** a parent Agent package contains a valid local subagent
- **AND** the parent Agent assembly contains a disabled binding with the same `providerId + capabilityType=AGENT + capabilityId`
- **THEN** Catalog governance MUST exclude that local subagent from the parent Agent callable Agent view

### Requirement: Subagent Discovery Uses Trusted Parent Agent Scope

本地 subagent discovery MUST 由可信父 Agent scope 驱动。Discovery 输入 MUST 至少绑定当前父 Agent 的 `agentId`、`agentVersion` 和 `agentAssemblyRef`，并且 MUST NOT 从客户端请求体、模型输出、capability arguments、descriptor metadata 或 runtime command 中读取或覆盖父 Agent scope。

#### Scenario: Parent scoped discovery only returns owning subagents

- **WHEN** Catalog 为父 Agent A 构造 request-scope capability view
- **THEN** Agent capability discovery MUST 只返回 `parentAgentScope` 匹配 Agent A 的本地 subagent candidates
- **AND** MUST NOT 返回 Agent B package 下的 subagent candidates

#### Scenario: App composition injects trusted Agent discovery source

- **WHEN** product app composition initializes the capability subsystem
- **AND** the active parent Agent package contains `subagents/{subagentId}/agent.yaml`
- **THEN** local Agent capability discovery MUST receive the trusted `AgentDiscoverySource` implementation from `agent-app`
- **AND** Catalog `listAvailable` MUST expose the valid local subagent as a governed `CapabilityDescriptor(kind="AGENT")`
- **AND** registering `local-subagents` without the discovery source MUST NOT be treated as a complete implementation

#### Scenario: Untrusted input cannot select a subagent root

- **WHEN** 客户端请求体、模型输出、capability arguments 或 descriptor metadata 包含 subagent root、parent agent id 或 package path 字段
- **THEN** 系统 MUST 忽略或安全拒绝该字段
- **AND** discovery MUST 继续只使用可信 app composition 注入的 `AgentDiscoverySource` 和已编译 assembly facts

### Requirement: Discovery Does Not Execute Child Agents

Agent capability discovery MUST 只产生 descriptor candidates 和 safe diagnostics。Discovery MUST NOT 执行子 Agent、创建 child run 或 branch、调用模型、调用 Tool/Skill、写入父 run timeline/checkpoint/session history、执行 sandbox 命令，或把子 Agent prompt 正文注入父 Agent 模型上下文。

#### Scenario: Discovering a subagent has no runtime side effects

- **WHEN** Catalog 调用 Agent capability discovery 构造父 Agent 的可见能力视图
- **THEN** discovery MUST NOT 创建 `RequestRun`
- **AND** MUST NOT 写入 session message、timeline event、checkpoint、artifact 或 audit event
- **AND** MUST NOT 调用 model provider、Tool executor、Skill invocation 或 sandbox gateway

#### Scenario: Agent capability execution remains unavailable until execution change

- **WHEN** 一个 `AGENT` descriptor 已通过 discovery 和 catalog governance 可见
- **AND** 后续执行语义尚未由本地 invoked Agent execution change 实现
- **THEN** 任何直接执行该 Agent capability 的路径 MUST 安全失败或保持 unavailable
- **AND** 失败结果 MUST NOT 启动子 Agent 或创建 child run

### Requirement: Agent Capability Descriptor Exposes Only Safe Facts

Agent capability descriptor MUST 只暴露安全、稳定、可治理的能力事实。Descriptor、metadata、model-visible capability listing、diagnostics、logs、safe errors 和 readiness evidence MUST NOT 包含 raw absolute path、raw `agent.yaml` 内容、prompt 正文、provider secret、workspace path、loading key、child assembly 全量对象或 package 内部布局细节。

#### Scenario: Descriptor omits package-private facts

- **WHEN** discovery 将一个合法 subagent 映射为 `CapabilityDescriptor(kind="AGENT")`
- **THEN** descriptor MUST NOT 包含 raw subagent package path
- **AND** MUST NOT 包含 raw `agent.yaml`
- **AND** MUST NOT 包含 prompt template body、model provider secret、workspace absolute path、loading key 或 child assembly 全量对象

#### Scenario: Builtin Agent metadata is safe by construction

- **WHEN** builtin Agent discovery maps a trusted candidate into `CapabilityDescriptor(kind="AGENT")`
- **THEN** descriptor metadata MUST be omitted unless the implementation applies an explicit safe-field allowlist
- **AND** raw Agent definition, prompt body, provider secret, path, executor wiring, loading key and child assembly MUST NOT be copied from candidate input into descriptor metadata

#### Scenario: Invalid subagent diagnostics are safe

- **WHEN** discovery 遇到缺失、非法、重复或不可治理的 subagent candidate
- **THEN** diagnostics MUST 使用 safe outcome code 和 sanitized message 描述结果
- **AND** diagnostics MUST NOT 暴露 raw path、secret、prompt、raw config、raw model output 或 raw package content

### Requirement: Agent Descriptor Resolution Uses AgentAssemblyRegistry

系统 MUST NOT place `AgentAssembly`、assembly source keys、raw package path 或 loading keys inside public `CapabilityDescriptor` metadata. After Catalog selects a governed `CapabilityDescriptor(kind="AGENT")`, any later execution-oriented resolver MUST map the descriptor back to a trusted `AgentAssembly` through `AgentAssemblyRegistry.require(descriptor.capabilityId, descriptor.version)`. Therefore Agent descriptors MUST include `version`, and app composition MUST keep `agentId + agentVersion` globally unique across builtin Agents, top-level local Agents and parent subagents.

#### Scenario: Governed Agent descriptor resolves through registry lookup

- **WHEN** Catalog returns a governed `CapabilityDescriptor(kind="AGENT")`
- **AND** a later execution change asks to resolve the descriptor to an executable Agent assembly
- **THEN** the resolver MUST call `AgentAssemblyRegistry.require(descriptor.capabilityId, descriptor.version)`
- **AND** the resolver MUST verify the returned assembly agent id and version match the descriptor before execution can proceed
- **AND** the descriptor MUST remain safe for model visibility and MUST NOT contain the `AgentAssembly` object or loading key

### Requirement: Remote Agent Registry Discovery Is Out Of Scope

本 change MUST NOT 定义远端 AgentRegistry discovery、远端 Agent execution、远端认证、远端缓存、远端安装、远端协议或跨实例 Agent delegation。任何 `AGENT_REGISTRY` provider 在本 change 中 MUST 继续按既有未支持 provider 规则处理，除非已有独立 change 明确定义其行为。

#### Scenario: Remote registry provider remains unsupported by this change

- **WHEN** 系统配置或测试输入尝试通过 `AGENT_REGISTRY` provider 发现 invoked Agent
- **THEN** 本 change MUST NOT 为该 provider 新增远端发现行为
- **AND** 系统 MUST 继续返回既有安全 unsupported/unavailable 结果
