## MODIFIED Requirements

### Requirement: Runtime-Ready AgentAssembly Contains Only Runtime-Facing Fields

系统 MUST 生成仅包含 runtime-facing 最小结果的 `AgentAssembly`。运行时结果 MUST 包含：

- `agentId`
- `agentType`
- `agentVersion`
- `agentAssemblyRef`
- `displayName`
- `description`
- `workspacePolicy`
- `modelProfileIds`
- `capabilityBindings`
- `hooks`
- `runtimeSettings`

`hooks` 是当前 Agent 的 lifecycle hook activation facts，来源只能是该 Agent package 的权威 `agent.yaml.hooks`。`hooks` MUST NOT include hook executable code, hook definition metadata, hook manifest contents, plugin metadata, raw package paths, local absolute paths, provider config, request/run-specific fields, owner scope, or independent Agent Scope fields.

Each `hooks` entry MUST contain `hookId` and MAY contain `enabled`, `disabled`, `stages`, `order`, `timeoutMs`, and `config`. For `CUSTOM` hook entries, `order` MUST be an optional object containing `priority?`, `before?`, and/or `after?`; `priority` is an integer absolute order within the custom hook group, and `before` / `after` values are hookId or non-empty hookId arrays within the custom group. Omitted custom `order` MUST preserve the hook enablement declaration order. For `SYSTEM` hook entries, `order` MUST NOT be present because system order is owned by the framework hook definition. A hook entry MUST NOT contain `bindingId`, `agentId`, `agentVersion`, or `agentAssemblyRef`; those scope facts are provided by the containing compiled `AgentAssembly`.

#### Scenario: Assembly exposes hook activation facts

- **WHEN** startup compile 生成一个 runtime-ready `AgentAssembly`
- **THEN** 该 assembly MAY contain `hooks`
- **AND** each hook entry MUST be scoped by the containing `agentId`、`agentVersion` and `agentAssemblyRef`
- **AND** hook entries MUST NOT duplicate or override those Agent Scope fields

#### Scenario: Assembly excludes hook code and hook definitions

- **WHEN** startup compile 生成一个 runtime-ready `AgentAssembly`
- **THEN** `hooks` MUST contain only activation and allowed override facts
- **AND** the assembly MUST NOT embed hook executable code, `LifecycleHookDefinition`, hook manifest contents, plugin metadata, raw hook implementation paths, or hook implementation source files

### Requirement: Agent Package Inputs Have Fixed Authority And Compile Order

系统 MUST 将 `agent.yaml` 视为一个 Agent package 的权威业务装配输入。package-scoped `skills/`、`subagents/`、`prompts` MAY provide candidate facts, and assembly-scoped provider/source inputs MAY provide registered provider facts, but none of them MAY become the runtime-facing assembly or Agent hook activation authority. Lifecycle hook implementation candidates are supplied by startup hook registry inputs assembled by app/plugin composition, not by Agent package files or directories.

compile 顺序 MUST 固定为：
1. 解析 package root 和 `agent.yaml`
2. 校验 `agentId`、`agentVersion`、display metadata、workspace、runtime settings 和 `hooks`
3. 收集 package-scoped candidate sources
4. 消费已验证的 model profile ids、context-engine 已注册 prompt facts、capability binding 需要的 registered provider facts，以及 hook activation 需要的 registered hook facts 和 runtime lifecycle stage vocabulary
5. 生成 runtime-facing `AgentAssembly`
6. 将结果发布到 in-memory registry 和 assembly compile diagnostics

#### Scenario: Hook activation is authored in agent.yaml

- **WHEN** an Agent package needs to enable, disable, narrow, order, timebox, or configure a lifecycle hook
- **THEN** the Agent package MUST declare that activation in `agent.yaml.hooks`
- **AND** hook manifests, plugin manifests or system configuration MUST NOT declare Agent activation facts for that Agent

#### Scenario: Hook activation compile fails before assembly publication

- **WHEN** `agent.yaml.hooks` contains an unknown hookId, missing hook code registration, unknown stage, duplicate hook entry, unsafe `hookId`, invalid `enabled` / `disabled` combination, invalid order shape, bare numeric order value, enum order slot, system hook order override, unknown order target, cross-kind order target, order target not effective in the same stage, invalid timeout, invalid config, unsupported override field, or any lifecycle stage whose effective hook count exceeds `maxHooksPerStage`
- **THEN** assembly compile MUST fail closed before publishing that `AgentAssembly`
- **AND** request acceptance for that Agent MUST NOT begin with a weakened or partially compiled hook activation snapshot

### Requirement: Request path does not reparse Agent prompt inputs

After request acceptance, runtime, core, context engine, memory, model, capability, hook executor and recovery paths SHALL consume frozen assembly facts, prompt template assembly output and hook activation facts. They MUST NOT re-read `agent.yaml`, package `prompts/`, hook manifests, plugin metadata or hook source inputs to change hook activation for an accepted request.

#### Scenario: Accepted run uses frozen hook activation authority

- **WHEN** an accepted request has frozen `agentId`, `agentVersion` and `agentAssemblyRef`
- **THEN** lifecycle hook activation MUST use the accepted `AgentAssembly.hooks`
- **AND** later package file changes MUST NOT affect that accepted request's effective hook set
