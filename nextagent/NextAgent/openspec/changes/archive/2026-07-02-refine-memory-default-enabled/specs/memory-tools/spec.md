## ADDED Requirements

### Requirement: Default-enabled memory configuration participates in memory tool exposure gate

系统 SHALL 将默认有效的 `MemoryConfig` 纳入既有 memory tool exposure gate。省略 `nextAgent.memory.enabled` 时，配置默认 enabled 只满足 memory tool exposure gate 中的配置状态条件；它 MUST NOT 绕过 AgentAssembly capability binding、memory core 依赖、owner scope、agent scope、capability governance 或 runtime tool invocation 校验。

默认开启的目标是让已绑定 memory tools 的 Agent 在 memory core 可用时无需额外配置即可暴露长期记忆工具。产品内置 `default-agent` MUST 在自身 `agent.yaml` / Agent definition 的 `capabilityBindings[]` 中显式绑定 `search_memory`、`get_memory_detail` 和 `add_memory`，作为默认产品 Agent 的记忆工具 opt-in。没有绑定 memory capability 的其他 Agent MUST 仍然不暴露 memory tools。

#### Scenario: Default memory configuration allows bound memory tools to pass configuration gate
- **GIVEN** 源配置省略 `nextAgent.memory.enabled`
- **AND** app composition has frozen `MemoryConfig.status = VALID`
- **AND** the active AgentAssembly enables memory tools
- **AND** app composition provides a valid enabled memory core public boundary
- **WHEN** capability providers are registered
- **THEN** the configuration gate MUST NOT block `search_memory`, `get_memory_detail`, or `add_memory`
- **AND** the remaining memory tool exposure checks MUST still run

#### Scenario: Default enabled does not expose tools without Agent binding
- **GIVEN** 源配置省略 `nextAgent.memory.enabled`
- **AND** app composition has frozen `MemoryConfig.status = VALID`
- **AND** the active AgentAssembly does not enable memory tools
- **WHEN** capability providers are registered
- **THEN** memory tools MUST NOT be exposed to model tool discovery
- **AND** default memory configuration MUST NOT create an implicit AgentAssembly binding

#### Scenario: Builtin default Agent explicitly opts in to memory tools
- **GIVEN** the product builtin `default-agent` Agent definition is loaded from `agent.yaml`
- **WHEN** Agent assembly compilation reads `capabilityBindings[]`
- **THEN** the builtin `default-agent` MUST contain enabled bindings for `search_memory`, `get_memory_detail`, and `add_memory`
- **AND** each binding MUST use `capabilityType=TOOL` and `providerId=memory-tools`
- **AND** this explicit binding MUST NOT create implicit memory tool bindings for other Agents

#### Scenario: Explicit disabled configuration still blocks memory tools
- **GIVEN** 源配置设置 `nextAgent.memory.enabled=false`
- **AND** app composition has frozen `MemoryConfig.status = DISABLED`
- **AND** the active AgentAssembly enables memory tools
- **WHEN** capability providers are registered
- **THEN** memory tools MUST NOT be exposed to model tool discovery
- **AND** memory tools MUST NOT appear in effective capability catalog results or executable invocation paths
