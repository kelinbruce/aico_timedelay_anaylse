## MODIFIED Requirements

### Requirement: Agent Assembly And Routing Skeleton

TS 后端 MUST 在核心契约中保留 runtime-facing Agent assembly 和 request routing skeleton。Agent assembly MUST 表达 agent id/version、已校验 workspace policy、model profile ids、prompt template ids、显式 capability binding facts 和最小 runtime settings。Request routing MUST 位于 Agent 内部，并输出 deterministic flow、model-driven loop、clarify、reject、human handoff 或 directed capability flow 等受控 decision。

#### Scenario: Agent assembly 提供运行期输入

- **WHEN** app composition 或 Agent loader 装配 Agent
- **THEN** runtime-ready AgentAssembly MUST contain agentId、agentVersion、displayName、description、workspacePolicy、modelProfileIds、promptTemplateIds、capabilityBindings and runtimeSettings
- **AND** workspacePolicy MUST be resolved and validated before entering runtime-facing assembly
- **AND** legacy package `workspaceDir` input MUST NOT enter runtime-facing AgentAssembly
- **AND** prompt-facing `workspaceDir` MUST equal the logical path `workspace/` when a downstream consumer needs the model-visible workspace directory
- **AND** physical workspace roots MUST be derived only by resolver-backed infrastructure, not stored on AgentAssembly
- **AND** capabilityBindings MUST contain explicit enabled or disabled binding facts
- **AND** each capability binding MUST contain capabilityId、capabilityType and providerId, and MAY contain optional enabled where a missing value means enabled=true
- **AND** AgentAssembly MUST NOT contain raw Agent definition, provider configuration, capabilityProviderRefs, routingHints, hook bindings, deny rules, shadowing records, raw workspaceDir, provider secrets, prompt contents, model profile details, Skill/SubAgent package contents, or request/run-specific execution roots
- **AND** Agent package inputs such as agent.yaml、skills/、subagents/ and prompts/ MUST be compiled before producing runtime-ready AgentAssembly

#### Scenario: Agent assembly registry resolves runtime-ready assemblies

- **WHEN** runtime accepts a request for an Agent id without an already resolved Agent version
- **THEN** runtime MUST resolve the current active AgentAssembly through AgentAssemblyRegistry.active(agentId)
- **AND** runtime MUST persist the resolved agentId、agentVersion and agentAssemblyRef in RequestRun and RequestContext
- **AND** once a request is accepted, runtime recovery、context engine、core and capability routing MUST resolve the same assembly through AgentAssemblyRegistry.require(agentId, agentVersion)
- **AND** active version selection MUST NOT be used for an already accepted request or recovery path
- **AND** AgentAssemblyRegistry MUST return runtime-ready AgentAssembly, not raw Agent package definitions or manifests
- **AND** missing assembly resolution MUST fail with an explicit missing assembly or not found error and MUST NOT fall back to a default Agent
- **AND** modules that need runtime-ready assembly resolution MUST depend on AgentAssemblyRegistry directly or on assembly-scoped wrappers derived from it, and MUST NOT parse Agent package files or own assembly compilation
- **AND** core contracts MUST NOT define a persistent assembly store, lazy compilation, hot reload, gray release or same-version snapshot id

#### Scenario: Routing 不在 channel 前置

- **WHEN** request 已通过 runtime 接受并进入 Agent 处理
- **THEN** Agent 内部 routing policy MUST 选择受控 routing decision
- **AND** channel 和 runtime MUST NOT 在 Agent 前绕过 routing policy 直接选择业务 Skill、Tool 或 Agent capability

## ADDED Requirements

### Requirement: Gateway Contracts Carry Sandbox Filesystem Layout And Scheduled Maintenance Jobs

TS gateway contracts SHALL carry the minimal platform-facing execution inputs needed by gateway adapters for sandbox execution and scheduled maintenance. `SandboxExecutionRequest.filesystem` SHALL include only the sandbox filesystem layout required by adapters: `defaultCwd` and `roots[]`. Each root entry SHALL carry the root kind, logical path, adapter physical path or mount source, and access mode. Sandbox target paths and standard temp env values SHALL be derived by the gateway adapter from `filesystem.defaultCwd` and the matching root logical path.

Gateway scheduled maintenance contracts SHALL provide a single app-registration shape for capability-owned maintenance jobs: job id, cadence/retention hints, overlap policy, and `run(signal, now)`. Capability modules own cleanup policy and cleanup candidate selection. Gateway adapters own deployment-mode-specific scheduling and execution.

#### Scenario: Sandbox gateway receives filesystem layout only

- **WHEN** a sandbox execution request is submitted
- **THEN** the gateway request SHALL carry `filesystem.defaultCwd` and `filesystem.roots[]`
- **AND** gateway adapters SHALL derive sandbox target paths and temp env values from that layout
- **AND** the request SHALL NOT carry `AgentWorkspacePolicy`, `ExecutionWorkspaceResolver`, full `ExecutionWorkspaceView`, Skill source loading facts, or authorization decisions

#### Scenario: Capability cleanup job is scheduled by gateway

- **WHEN** app composition registers a capability-provided cleanup job
- **THEN** the gateway scheduled execution contract SHALL carry job id, cadence/retention hints, overlap policy and `run(signal, now)`
- **AND** the gateway adapter SHALL execute the job according to LOCAL or REMOTE/PaaS deployment mode
- **AND** cleanup policy, Skill identity interpretation and cleanup candidate selection SHALL remain owned by the capability job
