## MODIFIED Requirements

### Requirement: Agent Assembly And Routing Skeleton
TS 后端 MUST 在核心契约中保留 runtime-facing Agent assembly 和 request routing skeleton。Agent assembly MUST 表达 agent id/version、已校验 workspace、model profile ids、显式 capability binding facts 和最小 runtime settings。Prompt template availability、selection、fallback 和 prompt template identity MUST be owned by `agent-context-engine` registered prompt facts, not by runtime-facing `AgentAssembly` fields. Request routing MUST 位于 Agent 内部，并输出 deterministic flow、model-driven loop、clarify、reject、human handoff 或 directed capability flow 等受控 decision。

#### Scenario: Agent assembly 提供运行期输入
- **WHEN** app composition 或 Agent loader 装配 Agent
- **THEN** runtime-ready AgentAssembly MUST contain agentId、agentVersion、displayName、description、workspaceDir、modelProfileIds、capabilityBindings and runtimeSettings
- **AND** runtime-ready AgentAssembly MUST NOT contain `promptTemplateIds`
- **AND** AgentRuntimeSettings MUST NOT contain `defaultPromptTemplateId`
- **AND** workspaceDir MUST be resolved and validated before entering runtime-facing assembly
- **AND** capabilityBindings MUST contain explicit enabled or disabled binding facts
- **AND** each capability binding MUST contain capabilityId、capabilityType and providerId, and MAY contain optional enabled where missing is equivalent to enabled=true
- **AND** AgentAssembly MUST NOT contain raw Agent definition, provider configuration, capabilityProviderRefs, routingHints, hook bindings, deny rules, shadowing records, raw paths outside workspaceDir, provider secrets, prompt template id allowlists, default prompt template ids, prompt contents, prompt root paths, prompt template refs, prompt binding/version summaries, model profile details, or Skill/SubAgent package contents
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
- **THEN** Agent 内部 MUST own request routing decisions
- **AND** runtime、channel、session、context、model、capability、gateway and observability packages MUST NOT independently route business intent before Agent execution
