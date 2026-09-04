## ADDED Requirements

### Requirement: Subagent Package Inputs Remain Parent-Scoped Candidates

系统 MUST 将 `subagents/` 视为父 Agent package 的 package-scoped candidate input。首版本地 subagent layout 固定为 `subagents/{subagentId}/agent.yaml`。每个 subagent candidate MUST 由自己的 `agent.yaml` 作为权威装配输入，并且 MUST 复用 Agent package assembly 的安全校验、identity/version 校验和 fail-closed / degraded 边界。

#### Scenario: Subagent package uses its own authoritative agent yaml

- **WHEN** 父 Agent package 包含 `subagents/alarm-correlation/agent.yaml`
- **THEN** 系统 MUST 将该 `agent.yaml` 作为该 subagent candidate 的权威业务装配输入
- **AND** MUST NOT 从目录名、父 Agent metadata、模型输出或 capability arguments 合成替代 `agent.yaml`

#### Scenario: Subagents do not become parent assembly fields

- **WHEN** startup compile 生成父 Agent 的 runtime-facing `AgentAssembly`
- **THEN** 父 assembly MUST NOT 包含 raw `subagents/` 文件、子 Agent prompt 正文、子 Agent provider 配置、子 Agent secret 或子 assembly 全量对象
- **AND** `subagents/` 中合法 candidates 的最终可见性 MUST 留给 Capability Catalog 在 request-scope view 阶段判断

#### Scenario: Local subagents are automatically visible to the owning parent Agent

- **WHEN** 父 Agent package contains a valid `subagents/{subagentId}/agent.yaml`
- **THEN** the subagent MUST be treated as a default-visible local Agent capability candidate for that parent Agent request scope
- **AND** startup compile MUST NOT write a synthetic `AgentAssembly.capabilityBindings` entry for that automatic local visibility
- **AND** an explicit disabled `AGENT` binding with the same provider and capability id MUST still be preserved so Catalog can hide the local subagent

### Requirement: All Agent Sources Compile To The Same Runtime Assembly Contract

无论 Agent 来源是 builtin Agent、`agents/{agentId}/agent.yaml` 顶层 local Agent，还是父 Agent package 下的 `subagents/{subagentId}/agent.yaml`，系统 MUST 使用同一 Agent package assembly contract 生成 runtime-facing `AgentAssembly`。`agent-core` owns builtin Agent package resources under `builtin-agents/{agentId}/agent.yaml` plus optional `prompts/`, and may only expose the trusted `builtin-agents` root directory. `agent-app` owns Agent source selection, direct-child builtin package scanning, local package locating, `agent.yaml` parsing, assembly compile, safety validation and registry publication. 同一个 app-owned concrete implementation MUST 同时提供 runtime lookup 所需的 `AgentAssemblyRegistry` 和 `agent-capability` discovery 所需的 `AgentDiscoverySource`；两者 MUST 来自同一批 compiled `AgentAssembly` facts。`agent-capability` MUST NOT own assembly compile, MUST NOT parse raw `agent.yaml`, and MUST NOT introduce `BuiltinAgentAssembly`、`SubagentAssembly`、`InvokedAgentAssembly` 或等价平行 DTO。

The existing single-active compiled registry shape MUST be expanded in `agent-app` to accept the full compiled assembly set. The configured `activeAgentId` MUST be treated as the current single-Agent default route id, not as registry-owned active Agent state. App composition MAY validate that default route at startup with the same top-level eligibility rule used by `AgentAssemblyRegistry.active(agentId)`, but MUST NOT store that route id or assembly inside the registry and MUST NOT initialize Agent-owned policies from it as a global default. Runtime request admission MUST resolve the session-bound Agent id through `AgentAssemblyRegistry.active(agentId)`, while accepted-run paths MUST use `AgentAssemblyRegistry.require(agentId, agentVersion)`. That same implementation MUST back `AgentAssemblyRegistry.active`, `AgentAssemblyRegistry.require`, `AgentDiscoverySource.listBuiltinAgentAssemblies`, `AgentDiscoverySource.listTopLevelLocalAgentAssemblies`, and `AgentDiscoverySource.listParentSubagentAssemblies`; implementations MUST NOT keep a separate locator/parser path for Agent capability discovery.

为保持简单，当前 app composition 内所有可发现 Agent 的 `agentId + agentVersion` MUST 全局唯一，包括 builtin Agent、顶层 local Agent 和 parent subagent。`subagents/` is a packaging and ownership layout, not a parent-local identity namespace.

Every compiled `AgentAssembly` MUST carry:

- `userInvocable: boolean`
- `agentInvocation: "NONE" | "BOUND" | "PARENT"`
- `sourceKind?: "BUILTIN" | "LOCAL"`
- `parentAgentScope?` for parent-only subagents
- `workspacePolicy.files` for workspace file-tool authority

`userInvocable=true` means trusted direct/default-route selection can directly serve that Agent to a user. `agentInvocation="BOUND"` means another Agent can call it only through explicit `AGENT` binding. `agentInvocation="PARENT"` means it is callable only as the owning parent Agent's local subagent through `AgentDiscoverySource.listParentSubagentAssemblies(parentScope)`, where ownership is matched against `AgentAssembly.parentAgentScope`. `agentInvocation="NONE"` means it MUST NOT be callable by another Agent.

Agent definition input MAY omit both fields. Assembly compile MUST default omitted `userInvocable` to `true` and omitted `agentInvocation` to `BOUND`; runtime-facing `AgentAssembly` MUST still carry the compiled values.

#### Scenario: Builtin Agent package uses the same assembly output

- **WHEN** trusted app composition reads a builtin Agent package root exported by `agent-core`
- **THEN** `agent-app` MUST discover builtin Agent packages by scanning direct child directories under the trusted `builtin-agents` root exposed by `agent-core`
- **AND** MUST compile each child package through the same Agent assembly compiler semantics used for local Agent packages
- **AND** the package MUST use `agent.yaml` as the authoritative Agent definition input
- **AND** the runtime-facing result MUST be an `AgentAssembly`
- **AND** the assembly MUST carry `userInvocable` and `agentInvocation`
- **AND** builtin-specific serviceability or source facts MUST NOT require a different runtime assembly object
- **AND** the same compiled assembly fact MUST be visible through both `AgentAssemblyRegistry` and `AgentDiscoverySource`
- **AND** `agent-core` MUST NOT parse or compile the package itself
- **AND** `agent-core` MUST NOT expose or require a hand-maintained list of builtin Agent ids

#### Scenario: Builtin Agent package omits legacy workspace fields

- **WHEN** trusted app composition reads a builtin Agent package under `builtin-agents/{agentId}/agent.yaml`
- **THEN** that builtin package definition MUST NOT contain legacy `workspaceDir`
- **AND** MUST NOT contain legacy `workspaceFiles`
- **AND** runtime workspace layout and file authority MUST be compiled into `AgentAssembly.workspacePolicy`
- **AND** `workspacePolicy.files` MUST carry product file-tool read/write directory and size limits

#### Scenario: Omitted workspace files uses runtime default file authority

- **WHEN** an Agent definition omits `workspaceFiles`
- **THEN** app assembly MUST derive default workspace file authority into `AgentAssembly.workspacePolicy.files`
- **AND** this default MUST NOT require legacy `workspaceFiles` in builtin Agent package configuration
- **AND** an explicit `workspaceFiles.writeDirectories=[]` MUST still disable workspace writes for that Agent
- **AND** workspace file authority MUST be resolved from the current runtime Agent Scope by reading that Agent assembly's `workspacePolicy.files`, not from the configured default route Agent

#### Scenario: Builtin Agent model profiles follow trusted app composition baseline

- **WHEN** a builtin Agent package references a framework-default model profile id that is not present in the current trusted `ResourceInventory`
- **THEN** `agent-app` MAY normalize that builtin Agent definition to use the trusted active Agent definition's model profile ids before assembly compile
- **AND** the normalized model profile facts MUST come only from trusted app composition
- **AND** the system MUST NOT use request input, model output, descriptor metadata, capability arguments or provider config to choose builtin Agent model profiles

#### Scenario: Invocation policy defaults are applied during assembly compile

- **WHEN** an Agent definition omits `userInvocable` and `agentInvocation`
- **THEN** the compiled `AgentAssembly` MUST have `userInvocable=true`
- **AND** MUST have `agentInvocation="BOUND"`

#### Scenario: Local top-level Agent and local subagent use the same assembly output

- **WHEN** trusted app composition exposes `agents/{agentId}/agent.yaml` or a parent package exposes `subagents/{subagentId}/agent.yaml`
- **THEN** the authoritative `agent.yaml` MUST be parsed and validated by the same Agent package assembly boundary
- **AND** the runtime-facing result for any later execution path MUST be an `AgentAssembly`
- **AND** the assembly MUST carry `userInvocable` and `agentInvocation`
- **AND** capability discovery publishes safe `CapabilityDescriptor(kind="AGENT")` projections but MUST NOT treat those descriptors as assembly objects

#### Scenario: Parent-local invocation policy is represented by assembly and source scope

- **WHEN** `agent-app` compiles a parent package `subagents/{subagentId}/agent.yaml`
- **THEN** the resulting subagent assembly MUST have `userInvocable=false`
- **AND** MUST have `agentInvocation="PARENT"`
- **AND** MUST have `parentAgentScope` equal to the owning parent Agent id, version and assembly ref
- **AND** parent ownership MUST NOT be duplicated into public `CapabilityDescriptor`

#### Scenario: Agent identity is globally unique within app composition

- **WHEN** app composition compiles builtin Agents, top-level local Agents and parent subagents
- **THEN** duplicate `agentId + agentVersion` across those sources MUST fail closed or be safely rejected before discovery publication
- **AND** later Agent execution resolves a governed `AGENT` descriptor through `AgentAssemblyRegistry.require(descriptor.capabilityId, descriptor.version)`

#### Scenario: Registry and discovery source share the same compiled facts

- **WHEN** app composition publishes compiled Agent assemblies
- **THEN** `AgentAssemblyRegistry.require(agentId, agentVersion)` and every `AgentDiscoverySource` list method MUST read from the same compiled assembly set
- **AND** `AgentDiscoverySource` MUST NOT reparse `agent.yaml`
- **AND** Agent capability discovery MUST NOT call an app-owned package locator directly

### Requirement: Subagent Source Uses Trusted Agent Package Roots

系统 MUST 只通过可信 app composition 或 `agent-app` owned Agent package source locating 定位父 Agent package 的 `subagents/` root。`agent-app` internally enumerates `subagents/*/agent.yaml` candidate inputs before assembly compile, but `agent-capability` discovery MUST receive compiled `AgentAssembly` facts through `AgentDiscoverySource`, not raw subagent roots or raw `agent.yaml` content. 系统 MUST NOT 仅从 runtime-facing `AgentAssembly.workspaceDir` 反推 raw subagent package inputs。

#### Scenario: Workspace directory is not used as package source locator

- **WHEN** 父 Agent 的 `AgentAssembly.workspaceDir` 下存在 `subagents/`
- **AND** 可信 Agent package source locator 未返回该 `subagents/` root
- **THEN** `agent-app` subagent assembly compile MUST 只使用可信 Agent package root 下的 `subagents/`
- **AND** MUST NOT 扫描 `workspaceDir/subagents`

#### Scenario: Missing subagents directory degrades safely

- **WHEN** 父 Agent package root 存在但 `subagents/` 不存在或为空
- **THEN** `AgentDiscoverySource.listParentSubagentAssemblies` MUST return an empty assembly set for that parent Agent scope
- **AND** MUST 产生或保留安全的 no-candidate diagnostic
- **AND** MUST NOT 阻塞父 Agent assembly publication 或既有 request path

#### Scenario: Parent package subagents are enumerable

- **WHEN** 父 Agent package root 下存在多个 `subagents/{subagentId}/agent.yaml`
- **THEN** `agent-app` MUST compile valid candidates into `AgentAssembly` facts for the current parent Agent scope
- **AND** Catalog default-visible discovery MUST NOT require a caller-provided `subagentId` before it can discover local subagent assemblies through `AgentDiscoverySource`
