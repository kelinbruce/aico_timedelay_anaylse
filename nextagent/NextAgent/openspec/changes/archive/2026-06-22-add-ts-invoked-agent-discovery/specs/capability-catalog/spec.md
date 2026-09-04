## ADDED Requirements

### Requirement: Agent Capability Candidates Use Existing Catalog Governance

Capability Catalog MUST 对 `AGENT` capability candidates 应用与其他 capability kind 一致的 request-scope governance，包括 availability filter、explicit disabled binding、conflict resolution、model visibility 和 provider identity 判断。Catalog MUST NOT 因 candidate 是 `AGENT` 而绕过 unified governance。

Catalog MUST distinguish global Agent catalog inclusion from request-scope callable visibility. 顶层 Agent、builtin Agent 和本地 subagent 都可以进入 Catalog；但 `CapabilityCatalog.listAvailable` 在某个父 Agent request scope 中只返回该父 Agent 经过 discovery source eligibility、explicit binding、本地 subagent 默认可见、availability、conflict 和 model visibility 治理后可调用的 Agent capabilities。Builtin Agent 和顶层 local Agent 必须由 discovery 基于 target assembly `agentInvocation="BOUND"` 发布为可绑定候选，并通过当前父 Agent 的 explicit enabled `AGENT` binding 进入 callable view；当前父 Agent package 下的 local subagent 只有通过 `listParentSubagentAssemblies(parentScope)` 返回、目标 assembly `agentInvocation="PARENT"` 且 `parentAgentScope` 匹配当前父 Agent 时在该父 Agent request scope 内默认可见。`agentInvocation` / `parentAgentScope` 不进入 descriptor metadata，Catalog 对这些事实的使用来自 discovery/source 发布路径和 compiled assembly，而不是 public descriptor 字段。

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
