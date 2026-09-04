# invoked-agent-discovery Specification Delta

## Modified Requirements

### Requirement: Subagents Are Discovered As Governed Agent Capabilities

系统 MUST 将可信内置 Agent capability、`agents/` 顶层 local Agent capability 和父 Agent package 下的本地 subagent 发现为统一 `CapabilityDescriptor(kind="AGENT")` candidate。Agent capability discovery MUST 复用现有 `CapabilityDiscovery`、`CapabilityDescriptor` 和 `CapabilityCatalog` contract。可信内置 Agent capability MUST 由 reserved `providerId="builtin-agents"`、`providerKind="BUNDLED"` 暴露；本地顶层 Agent MUST 由 reserved `providerId="local-agents"`、`providerKind="LOCAL_DIRECTORY"` 暴露；本地 parent-scoped subagent MUST 由 reserved `providerId="local-subagents"`、`providerKind="LOCAL_DIRECTORY"` 暴露。这些 provider identity 来自可信 app/capability composition。

Agent capability discovery MUST obtain Agent candidates from the `AgentDiscoverySource` implementation injected by `agent-app`. That source MUST return startup-materialized `AgentAssembly` facts produced from trusted Agent definitions. Discovery MUST map those assemblies to descriptors, and final runtime visibility remains subject to startup graph validation before app ready. The local Agent provider identities in this change are `local-agents` for top-level local Agents and `local-subagents` for parent-scoped subagents.

#### Scenario: Local subagent becomes an Agent capability candidate

- **WHEN** 当前父 Agent package 中存在合法 `subagents/{subagentId}/agent.yaml`
- **THEN** `agent-app` MUST materialize that subagent into an `AgentAssembly`
- **AND** Agent capability discovery MUST receive that materialized assembly through `AgentDiscoverySource`
- **AND** discovery MUST 为该 subagent 产生一个 `kind="AGENT"` 的 `CapabilityDescriptor` candidate
- **AND** descriptor `provider.providerId` MUST be `local-subagents`
- **AND** 该 descriptor MUST 进入现有 Capability Catalog governance
- **AND** 父 Agent package 的 runtime-facing `AgentAssembly` MUST only be published after startup graph validation passes

#### Scenario: Top-level local Agent becomes an Agent capability candidate

- **WHEN** trusted app composition exposes `agents/{agentId}/agent.yaml` through the local Agent source
- **THEN** `agent-app` MUST materialize that top-level local Agent into an `AgentAssembly`
- **AND** Agent capability discovery MUST receive that materialized assembly through `AgentDiscoverySource`
- **AND** discovery MUST produce a `CapabilityDescriptor(kind="AGENT")` candidate for that top-level local Agent
- **AND** descriptor `provider.providerId` MUST be `local-agents`
- **AND** callable visibility remains governed by the current parent Agent bindings

#### Scenario: Local Agent discovery uses separate providers for EAGER and SEARCH modes

- **WHEN** the capability subsystem creates local Agent discovery
- **THEN** it MUST create an EAGER `local-agents` discovery for `AgentDiscoverySource.listTopLevelLocalAgentAssemblies`
- **AND** it MUST create a SEARCH `local-subagents` discovery for `AgentDiscoverySource.listParentSubagentAssemblies`
- **AND** both discovery instances MUST map startup-materialized `AgentAssembly` facts to `CapabilityDescriptor(kind="AGENT")`

### Requirement: Agent Bindings Select Callable Agent Capabilities

父 Agent MUST be able to bind builtin Agent and top-level local Agent capabilities using existing `capabilityBindings` with `capabilityType="AGENT"` when the target assembly has `agentInvocation="BOUND"`. A bound Agent can itself also have `userInvocable=true`, or can be user-invocable false and only exposed as an invoked target. Local subagents under the current parent Agent package MUST be automatically visible for that parent Agent request scope when returned by `listParentSubagentAssemblies(parentScope)`, their assembly has `agentInvocation="PARENT"`, their descriptor uses `providerId="local-subagents"`, and their `parentAgentScope` matches the current parent Agent, unless an explicit disabled binding hides them.

#### Scenario: Parent Agent binds a top-level local Agent

- **WHEN** a parent Agent assembly contains an enabled binding with `capabilityType="AGENT"` and `providerId="local-agents"`
- **AND** the target Agent is a top-level local Agent discovered from `agents/{agentId}/agent.yaml`
- **AND** the target Agent assembly has `agentInvocation="BOUND"`
- **THEN** Catalog governance MUST include that Agent in the parent Agent callable Agent view when availability and conflict rules pass
- **AND** the bound top-level local Agent is resolved from the top-level local Agent discovery source

#### Scenario: Parent Agent disables an automatically discovered local subagent

- **WHEN** a parent Agent package contains a valid local subagent
- **AND** the parent Agent assembly contains a disabled binding with `providerId="local-subagents"`, `capabilityType="AGENT"` and the same `capabilityId`
- **THEN** Catalog governance MUST exclude that local subagent from the parent Agent callable Agent view
