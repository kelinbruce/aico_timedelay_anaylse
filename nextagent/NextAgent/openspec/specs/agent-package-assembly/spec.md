# agent-package-assembly Specification

## Purpose
Defines the startup-time compile boundary for compiling Agent package roots (authoritative `agent.yaml` + package-scoped candidates) into a runtime-ready `AgentAssemblyRegistry`. Separates package assembly from product entry selection, default-agent packaging layout, and release-packaging.

## Function

- **所属 Function**：`FN-3.2 编译智能体装配`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: Agent Package Assembly Compiles Runtime-Ready Assembly At Startup

系统 MUST 在 request acceptance 开放前，把每个受信任选中的 Agent package 输入编译为 runtime-ready `AgentAssembly`，并发布为请求处理可读取的 accepted assembly。该编译行为 MUST 在启动成功条件满足前完成，MUST NOT 延迟到 request path、后台刷新或 lazy lookup。

受信任启动选择 MUST 在编译前决定哪些 Agent package 输入参与本次装配。本 capability 只约束“被选中的 package 输入如何形成 runtime-facing assembly”，MUST NOT 定义产品入口选择、default-agent 打包布局或 release-packaging 文件同步。

Agent definition MAY 省略 `modelIds` 以继承 frozen `systemConfig.modelProfiles` 中全部已校验模型的 canonical `modelId`，并保持 provider/profile 配置顺序；显式 `modelIds` MUST 是非空、有序且无重复的模型激活范围，Agent config MUST NOT 使用 singular `modelId` 代替该集合。编译后的 `AgentAssembly` MUST 始终携带解析后的非空、有序且无重复 `modelIds`。可选 `defaultModelId` MAY 省略；存在时 MUST 是解析后 `modelIds` 中恰好一个 exact canonical id。省略 `defaultModelId` 时，initial selection MUST 使用解析后 `modelIds` 顺序中的第一个 eligible model，MUST NOT 合成 global default。assembly MUST NOT 复制 `ModelProfile` 默认调用参数、`providerId`、endpoint、credential reference、provider options 或 transport。

**需求类别**：功能性需求

#### Scenario: 启动编译发布 runtime-ready assembly

- **GIVEN** 受信任启动选择已接受一个 enabled Agent package 输入
- **WHEN** 系统执行 Agent assembly
- **THEN** 系统 MUST 在任何 request acceptance 对外服务前完成 compile
- **AND** MUST 产出 runtime-ready accepted `AgentAssembly`
- **AND** 请求处理、恢复和后台模型消费者 MUST 只消费该 accepted assembly
- **AND** assembly 中的模型事实 MUST 只包含激活 `modelIds` 和可选 `defaultModelId`，不包含全局模型配置或模型接入事实

#### Scenario: Agent 省略 default model

- **GIVEN** Agent definition 提供非空且无重复的 `modelIds`
- **AND** 省略 `defaultModelId`
- **WHEN** 系统编译并发布 runtime-ready assembly
- **THEN** assembly MUST 保留有序 `modelIds` 并省略 `defaultModelId`
- **AND** 后续 initial selection MUST 从该顺序中选择第一个 eligible model

#### Scenario: Agent 省略模型激活范围

- **GIVEN** Agent definition 省略 `modelIds`
- **WHEN** 系统使用已校验且冻结的 `systemConfig.modelProfiles` 编译 Agent assembly
- **THEN** assembly MUST 按 provider/profile 配置顺序携带其中全部 canonical `modelId`
- **AND** builtin、顶层 local Agent 与 parent subagent MUST 使用同一解析规则
- **AND** 系统 MUST NOT 读取运行期 catalog health、Gateway metadata、环境变量或请求输入决定该范围

#### Scenario: Agent 模型激活配置非法

- **WHEN** Agent definition 提供空 `modelIds`、重复或未知 id，提供 singular `modelId`，或让 `defaultModelId` 不属于解析后的 `modelIds`
- **THEN** package compilation MUST 在 assembly publication 前安全失败
- **AND** MUST NOT 把显式非法值按省略处理或用 system config 覆盖

#### Scenario: 请求路径不重新编译 package 输入

- **WHEN** 请求处理、恢复或后台模型消费者需要 Agent assembly 数据
- **THEN** 它们 MUST 读取 accepted assembly facts
- **AND** MUST NOT 在 request path 重新解析或重新编译 Agent package 输入

### Requirement: Agent Package Inputs Have Fixed Authority And Compile Order

系统 MUST 将 `agent.yaml` 视为一个 Agent package 的权威业务装配输入。package-scoped `skills/`、`subagents/`、`prompts/` 和 assembly-scoped provider/source 输入 MAY 提供候选事实，但 MUST NOT 自行成为 runtime-facing assembly。

compile 顺序 MUST 固定为：
1. 解析 package root 和 `agent.yaml`
2. 校验 `agentId`、`agentVersion`、display metadata、workspace 和 runtime settings
3. 收集 package-scoped candidate sources
4. 消费已验证的 model profile ids、context-engine 已注册 prompt facts，以及 capability binding 需要的 registered provider facts
5. 生成 runtime-facing `AgentAssembly`
6. 将结果发布到 in-memory registry 和 assembly compile diagnostics

#### Scenario: Candidate sources do not bypass authoritative assembly input

- **WHEN** package-scoped `skills/`、`subagents/`、`prompts/` 或 provider/source 输入存在
- **THEN** 它们 MUST 只被当作 assembly compile 的候选输入
- **AND** MUST NOT 绕过 `agent.yaml` 权威性
- **AND** MUST NOT 被直接暴露为 runtime-facing `AgentAssembly`

#### Scenario: Half-compiled assembly is never exposed

- **WHEN** compile 在 package parsing 之后的任一步骤失败
- **THEN** 系统 MUST NOT 暴露半成品 `AgentAssembly`
- **AND** MUST 只在 fail-closed 或完整降级 assembly 两种结果之间收敛

### Requirement: Runtime-Ready AgentAssembly Contains Only Runtime-Facing Fields

系统 MUST 生成仅包含 runtime-facing 最小结果的 `AgentAssembly`。运行时结果 MUST 包含：

- `agentId`
- `agentType`
- `agentVersion`
- `agentAssemblyRef`
- `displayName`
- `description`
- `workspacePolicy`
- `modelIds`
- optional `defaultModelId`
- `capabilityBindings`
- `hooks`
- `runtimeSettings`

Source `agent.yaml.agentType` MAY be omitted. When omitted, package assembly MUST default the runtime-facing `AgentAssembly.agentType` to `default`. When `agent.yaml.agentType` is present, it MUST be a non-empty implementation selector string that is copied into the runtime-facing `AgentAssembly.agentType`; an explicit empty or non-string value MUST fail closed. `agentType` is a runtime implementation selector used for constructor resolution, not Agent business identity, routing policy, model selection, capability binding, or prompt/resource selection.

Prompt template availability、selection、fallback 和 prompt template identity MUST be owned by `agent-context-engine` registered prompt facts, not by runtime-facing `AgentAssembly` fields. Package assembly MUST NOT require or emit developer-maintained prompt template id allowlists.

`hooks` 是当前 Agent 的 lifecycle hook activation facts，来源只能是该 Agent package 的权威 `agent.yaml.hooks`。`hooks` MUST NOT include hook executable code, hook definition metadata, plugin metadata, raw package paths, local absolute paths, provider config, request/run-specific fields, owner scope, or independent Agent Scope fields. Each hook entry MUST contain `hookId` and MAY contain `enabled`, `disabled`, `stages`, `order`, `timeoutMs`, and `config`.

`workspacePolicy` MUST be the runtime-facing policy for execution file access. It MUST contain a policy schema version, isolation mode and logical root policies for the execution roots authorized for the agent. Logical root policies MAY describe root kind, logical path and access, but MUST NOT contain lifecycle, host physical execution roots, raw tenant/subject/session identifiers, Skill source paths, provider-private loading facts, managed install paths or request/run-specific fields. Physical execution roots MUST be derived later by runtime from the system runtime workspace root, `workspacePolicy`, trusted owner scope and trusted run/session facts. The prompt-facing `workspaceDir` MUST be the logical path `workspace/`; the physical workspace root MUST NOT be stored as a raw `AgentAssembly` field.

For source compatibility, package compilation MAY accept an existing raw `agent.yaml.workspaceDir` field, but it MUST NOT copy that value into `AgentAssembly` and MUST NOT use it to derive physical execution roots. If `agent.yaml.workspaceDir` is present, the compiler MUST either ignore it with safe deprecation evidence or fail closed when the value is absolute, unresolved, points at a system/provider-private directory, or otherwise implies a physical execution root.

系统 MUST NOT 将原始 `agent.yaml`、原始 package 布局、prompt 正文、prompt root paths、prompt template refs、prompt binding/version summaries、provider/source 配置、provider secret、model profile 详情、shadowing records、deny rules、`workspaceDir` raw path 或 Skill/SubAgent package 内容放入 runtime-facing `AgentAssembly`。

#### Scenario: Assembly exposes workspace policy instead of workspace dir

- **WHEN** startup compile 生成一个 runtime-ready `AgentAssembly`
- **THEN** 该 assembly MUST contain `workspacePolicy`
- **AND** 该 assembly MUST NOT contain `workspaceDir`
- **AND** runtime consumers that need prompt-facing `workspaceDir` MUST derive logical `workspace/`; consumers that need physical workspace access MUST use resolver-backed infrastructure
- **AND** physical execution roots MUST NOT be derivable from raw package paths alone

#### Scenario: Legacy workspaceDir does not enter assembly

- **WHEN** startup compile reads an Agent package that contains `agent.yaml.workspaceDir`
- **THEN** the compiler MAY accept the field for source compatibility
- **AND** the resulting runtime-ready `AgentAssembly` MUST still contain `workspacePolicy`
- **AND** it MUST NOT contain `workspaceDir`
- **AND** the raw `workspaceDir` value MUST NOT determine runtime physical execution roots
- **AND** unsafe `workspaceDir` values MUST fail closed before assembly publication

#### Scenario: Assembly excludes raw package and provider inputs

- **WHEN** startup compile 生成一个 runtime-ready `AgentAssembly`
- **THEN** 该 assembly MUST 只包含 runtime-facing 字段
- **AND** MUST 排除 raw package files、prompt text、prompt root paths、prompt template refs、provider configuration、provider secrets、package contents and raw workspace paths

### Requirement: Agent package prompt root is provided before compilation

Agent package assembly SHALL treat package-scoped `prompts/` as the trusted prompt root for that Agent. During synchronous Agent assembly, the system MUST resolve that prompt root to an absolute path under package-root containment and pass only `agentId`, `agentVersion` and the trusted absolute `path` to the context-engine-owned `register` entry. Prompt template compilation and registry publication SHALL run through that single context-engine entry before the runtime-facing `AgentAssembly` is request-acceptable. Agent package assembly MUST NOT own prompt manifest schema, prompt semantic validation, `PromptTemplate` materialization, `templateRef` derivation, registry publication or template selection. Runtime-facing `AgentAssembly` MUST remain minimal and MUST NOT embed prompt text, raw package layout, raw template files, provider configuration, secrets, `promptTemplateIds` or `runtimeSettings.defaultPromptTemplateId`.

#### Scenario: Prompt candidates are compiled before serving

- **WHEN** an enabled Agent package contains package-scoped `prompts/` candidates
- **THEN** synchronous Agent assembly MUST resolve the trusted absolute prompt root path without interpreting prompt manifest semantics
- **AND** synchronous Agent assembly MUST call context-engine `register` once for that Agent prompt root
- **AND** context-engine `register` MUST validate supported prompt template manifests and register valid templates as available to that Agent before the `AgentAssembly` is request-acceptable
- **AND** request acceptance for that Agent MUST NOT begin before required prompt template facts are compiled or fail-closed safe errors are produced

#### Scenario: Assembly excludes prompt bodies

- **WHEN** synchronous Agent assembly creates runtime-facing `AgentAssembly`
- **THEN** the assembly MUST NOT include prompt version summaries or prompt binding summaries in this change
- **AND** it MUST NOT include prompt root paths, raw prompt text, raw template body, complete `PromptTemplate` objects, raw package paths, template file contents, `promptTemplateIds`, `runtimeSettings.defaultPromptTemplateId` or derived `templateRef` lists

### Requirement: Request path does not reparse Agent prompt inputs

After request acceptance, runtime, core, context engine, memory, model, capability and recovery paths SHALL consume frozen assembly facts and prompt template assembly output. They MUST NOT re-read `agent.yaml` or package `prompts/` to change template selection for an accepted request.

#### Scenario: Accepted run uses frozen template authority

- **WHEN** an accepted request has frozen `agentId`, `agentVersion` and `agentAssemblyRef`
- **THEN** prompt selection MUST use those accepted assembly facts
- **AND** later package file changes MUST NOT affect that accepted request's prompt selection

### Requirement: Capability Bindings Remain Assembly Facts Rather Than Discovery Results

系统 MUST 将 runtime-facing `AgentAssembly.capabilityBindings` 视为 Agent 的显式 enabled binding facts，而不是 capability descriptor 已发现或已可执行的快照。assembly compiler MUST 只校验 binding shape、安全 id、capability type 和 registered provider id；capability descriptor existence、availability、conflict 和 executability MUST 继续由 capability catalog 在 request-scope `listAvailable` / `resolve` 阶段判断。

compiler 透传全部 capability binding facts（含 `enabled`）到 runtime-facing assembly。compiler 只校验 binding shape 和 provider registration，enable/disable 决策由 Capability Catalog 在执行期根据 `enabled` 字段判断。

assembly compiler MUST NOT 为 framework-default builtin capability、default-enabled trusted provider 或 request-scope search 结果写入 synthetic enabled binding。explicit `enabled=false` 表示显式禁用同 key 默认 capability，MUST 被透传到 runtime-facing assembly 供 Catalog 处理。

#### Scenario: Assembly compiles without requiring descriptor pre-discovery

- **WHEN** Agent definition 包含一个 shape 合法、provider 已注册的 capability binding
- **THEN** assembly compiler MUST 能在不先读取 capability catalog descriptor 快照的情况下生成 `AgentAssembly.capabilityBindings`
- **AND** descriptor 是否存在、是否 AVAILABLE、是否发生冲突 MUST 留给 capability catalog 后续判断

#### Scenario: Default-enabled capability visibility is not written back into assembly

- **WHEN** 某个 builtin capability 或 trusted default-enabled provider capability 对当前 request scope 默认可见
- **THEN** 该默认可见性 MUST 由 capability catalog 负责
- **AND** 系统 MUST NOT 为表达该默认可见性向 `AgentAssembly.capabilityBindings` 写入 synthetic enabled binding

### Requirement: AgentAssemblyRegistry Lookup Semantics Stay Frozen

系统 MUST 提供 in-memory `AgentAssemblyRegistry` 作为 runtime-facing lookup boundary。

- `active(agentId)` MUST 可用于 request acceptance 或等效的 pre-acceptance active-version 解析
- `require(agentId, agentVersion)` MUST 可用于 accepted request execution、recovery、context engine、core 和 capability routing
- request 一旦被 accepted，系统 MUST 持续通过 `require(agentId, agentVersion)` 使用 frozen assembly
- accepted execution MUST NOT 回退到 `active(agentId)` 或静默切换到另一个 active version
- `active(agentId)` MUST 支持查找 registry 中任意已注册的 user-invocable agent，MUST NOT 限制为单一的 configured `activeAgentId`
- registry MUST 支持运行时动态刷新（见"AgentAssemblyRegistry 支持运行时动态刷新发现新增 agent"），刷新后 `active` 和 `require` MUST 返回更新后的 assembly 集合

#### Scenario: Acceptance uses active lookup and accepted run uses require lookup

- **WHEN** runtime 即将接受一个新 request
- **THEN** MUST 通过 `AgentAssemblyRegistry.active(agentId)` 解析当前 active assembly
- **AND** acceptance 之后的执行与恢复路径 MUST 通过 `AgentAssemblyRegistry.require(agentId, agentVersion)` 读取 frozen assembly
- **AND** runtime MUST 在 accepted request state 中固化 `agentId`、`agentVersion` 和 `agentAssemblyRef`
- **AND** 后续处理 MUST NOT 重新读取 package 输入来改写该 request 的 assembly

#### Scenario: Missing assembly does not fall back to a default assembly

- **WHEN** `active(agentId)` 或 `require(agentId, agentVersion)` 无法解析所需 assembly
- **THEN** 系统 MUST 返回明确的 missing-assembly / not-found safe failure
- **AND** MUST NOT 合成 implicit default assembly 或静默切换版本

#### Scenario: 任意已注册 agent 均可通过 active 查找

- **WHEN** registry 中包含多个 user-invocable agent（如 `default-agent` 和 `network-specialist`）
- **THEN** `AgentAssemblyRegistry.active('network-specialist')` MUST 返回 `network-specialist` 的 assembly
- **AND** `AgentAssemblyRegistry.active('default-agent')` MUST 返回 `default-agent` 的 assembly
- **AND** 查找结果 MUST NOT 限制为 configured `activeAgentId`

### Requirement: Workspace Resolution And Package Validation Are Compile-Time Preconditions

系统 MUST 在 `workspacePolicy` 进入 runtime-facing assembly 之前完成解析和安全校验。compiler MUST 拒绝未解析 workspace policy、非法 schema version、非法 isolation mode、非法 root kind、非法 logical path/access、未授权系统目录引用、raw unresolved path 或会把 execution roots 指向 provider-private/source-private layout 的输入进入 runtime-facing assembly。`workspacePolicy` MUST NOT 承载 lifecycle、deployment mode、物理 root、trusted identity、request/run-specific fields 或 provider-private loading facts。Limits 只有在存在明确 per-agent 消费者时才进入 assembly contract；首版继续使用系统/工具默认限制。

`workspacePolicy.roots` MAY include the root kind `sharedData` with canonical logical path `shared-data` and access `read` only when trusted app composition is building a LOCAL deployment runtime-facing assembly. `sharedData` authorizes the local shared data root for root-aware file tools and sandbox filesystem preparation. `sharedData` MUST NOT contain a physical path in assembly, MUST NOT be readWrite, MUST NOT be interpreted as an Agent package source, MUST NOT be emitted for REMOTE/PaaS deployment mode, and MUST NOT change prompt-facing `workspaceDir`.

系统 MUST 在 compile-time 校验 required model/profile/template/provider 引用、resource path 和 Agent identity/version。缺失、非法或越界输入 MUST 在 assembly publication 前被拒绝。

#### Scenario: Invalid workspace policy causes fail-closed assembly compile

- **WHEN** package assembly 输入把 `workspacePolicy` 解析为非法 schema version、非法 isolation mode、非法 root kind、非法 logical path/access、未授权系统目录引用、raw unresolved path、lifecycle、deployment mode、物理 root、trusted identity、request/run-specific fields 或 provider-private loading facts
- **THEN** package assembly compile MUST fail closed
- **AND** runtime acceptance MUST NOT 为该 required assembly 开放

#### Scenario: Shared data root policy is logical and read-only

- **WHEN** package assembly 输入包含 `sharedData` root kind
- **THEN** trusted app composition MUST accept it only for LOCAL deployment mode when logical path is `shared-data` and access is `read`
- **AND** compiler or composition MUST reject any physical shared-data path, `readWrite` access, lifecycle, deployment mode or request/run-specific field in `workspacePolicy`
- **AND** REMOTE/PaaS composition MUST fail closed if `sharedData` would enter runtime-facing assembly

#### Scenario: Missing required references fail before assembly publication

- **GIVEN** app composition 选择了一个 enabled Agent package root
- **AND** 该 package 引用了 required model、prompt、provider 或 resource facts
- **WHEN** compile-time 校验发现至少一个 required reference 缺失、非法或越界
- **THEN** startup MUST 在 assembly publication 前 fail closed
- **AND** 该缺失事实 MUST NOT 被静默删除后继续发布 assembly

### Requirement: Failure And Degradation Are Explicit At The Package Assembly Boundary

系统 MUST 区分 fail-closed assembly failure 和 safe unavailable assembly degradation。

fail-closed 条件至少包括：

- 缺失权威 `agent.yaml`
- 非法 `agentId` 或 `agentVersion`
- 非法 `workspacePolicy` 或 unsafe legacy `agent.yaml.workspaceDir`
- required model / prompt / provider / resource reference 缺失或非法
- required assembly compile failure
- registry 无法提供 startup serving 所需的 active lookup

safe unavailable / degraded assembly 条件至少包括：

- 未被显式 binding 消费的非关键 candidate source unavailable
- 非关键 package-scoped candidate 输入校验失败，但权威 assembly 仍然合法

系统 MUST NOT 静默吞掉失败候选、暴露半成品 assembly、或在 request path 重新尝试解析 package 输入来绕过启动期 compile 失败。

#### Scenario: Missing authoritative input fails closed

- **WHEN** required Agent package 缺失权威 `agent.yaml`
- **THEN** startup assembly MUST fail closed
- **AND** request-serving path MUST 在问题修复前保持不可用

#### Scenario: Non-critical unbound candidate source degrades with safe diagnostics

- **WHEN** 一个未被显式 binding 消费的非关键 package-scoped candidate source 无法加载或校验
- **THEN** compiler MAY 在权威 assembly 仍合法时继续生成 runtime-ready assembly
- **AND** MUST 从 resulting assembly 中排除该失败候选
- **AND** MUST 产出 safe assembly compile diagnostics 记录该降级

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

### Requirement: Agent-scoped file extension policy compilation

系统 SHALL 将可信 Agent definition 的四个 workspace file extension allowlist/denylist 编译为 app-private Agent/version scoped policy，保留字段缺省与显式空数组的差异，并通过 composition provider 注入文件 capability；系统 MUST NOT 修改或重新定义 frozen `AgentWorkspaceFilePolicy`。读取类操作 SHALL 仅使用读取 allowlist/denylist，写入类操作 SHALL 仅使用写入 allowlist/denylist；系统 MUST NOT 在两类策略之间自动合并或扩权。每类策略 MUST 按以下顺序判定目标最终后缀：命中 denylist 时拒绝；否则 allowlist 缺省时允许；否则仅在命中 allowlist 时允许。运行期 MUST 使用 accepted run 固化的 Agent/version 对应策略，MUST NOT 从默认 Agent、其他 Agent、Tool input、模型输出、客户端 metadata 或 capability 参数补充或扩大后缀授权。

#### Scenario: Read and write policies remain independent
- **WHEN** Agent 配置 `readAllowedExtensions: [".log"]` 和 `writeAllowedExtensions: [".json"]`
- **THEN** 读取授权 SHALL 仅允许 `.log`，写入授权 SHALL 仅允许 `.json`，compiler MUST NOT 把 `.json` 自动加入读取 allowlist

#### Scenario: Deny precedence is preserved in runtime policy
- **WHEN** `.json` 同时位于读取 allowlist 和读取 denylist
- **THEN** 编译后的 private policy MUST 保留两个事实，读取判定 MUST 拒绝 `.json`

#### Scenario: Frozen workspace policy contract remains unchanged
- **WHEN** 系统编译任意 extension allowlist/denylist 配置
- **THEN** `AgentAssembly.workspacePolicy.files` 的 frozen shape MUST 保持不变，extension policy MUST 仅由 app-private provider 提供

#### Scenario: Accepted Agent scope is authoritative
- **WHEN** 两个 Agent 对同一后缀配置不同授权并分别接受 request run
- **THEN** 每个 run 的文件 Tool MUST 仅使用其固化 Agent/version 的策略且缓存不得跨 Agent/version 复用

### Requirement: Agent 运行设置只定义轮次上限和单轮工具调用上限

Runtime-ready `AgentAssembly.runtimeSettings` MUST 使用 `maxTurns` 表达一个 request 的普通 Agent model turn 上限，并 MUST 使用 `maxToolCallsPerTurn` 表达一个普通 model turn 可接纳的 Tool call 上限。`maxTurns` MUST 是正安全整数且缺失时 effective default MUST 为 `50`；`maxToolCallsPerTurn` MUST 是 `1..100` 的安全整数且缺失时 effective default MUST 为 `30`。

`maxTurns` MUST 同时约束有 Tool 和无 Tool 的普通 Agent model turns。`maxToolCallsPerTurn` MUST 统一计数一个 turn 中按模型顺序返回的全部 Tool calls，不区分 read-only 与 side-effecting Tool，也不按 Tool 名称去重。runtime settings MUST NOT 建立平行的 read-only/side-effecting call limits、Tool-call recovery limit 或 request 累计 Tool-call budget。

Agent package compilation MUST 在发布 runtime-ready assembly 前校验显式值；非法类型、非安全整数、`maxTurns < 1` 或 `maxToolCallsPerTurn` 超出 `1..100` MUST fail closed。默认值 MUST 在可信 assembly/config resolution 边界产生，MUST NOT 由不可信 request、模型输出、Capability 参数或 provider options 覆盖。

**需求类别**：功能性需求

#### Scenario: 运行设置使用规范循环上限

- **WHEN** Agent package 声明合法 `runtimeSettings.maxTurns` 和 `runtimeSettings.maxToolCallsPerTurn`
- **THEN** startup compilation MUST 把两个 canonical fields 发布到 runtime-ready `AgentAssembly`
- **AND** Agent loop MUST 使用 `maxTurns` 作为唯一 loop-count bound
- **AND** Agent loop MUST 使用 `maxToolCallsPerTurn` 作为唯一 per-turn Tool-call admission bound

#### Scenario: 运行设置省略循环上限

- **WHEN** Agent package 未声明 `maxTurns` 或 `maxToolCallsPerTurn`
- **THEN** effective `maxTurns` MUST 为 `50`
- **AND** effective `maxToolCallsPerTurn` MUST 为 `30`
- **AND** request 或模型输出 MUST NOT 改写这些 assembly-owned defaults

#### Scenario: 运行设置包含非法循环上限

- **WHEN** Agent package 声明非整数、非安全整数、`maxTurns < 1` 或不在 `1..100` 的 `maxToolCallsPerTurn`
- **THEN** Agent package compilation MUST fail closed before assembly publication
- **AND** 系统 MUST NOT 截断、猜测或静默替换显式非法值

### Requirement: AgentAssemblyRegistry 支持运行时动态刷新发现新增 agent

系统 MUST 在运行时检测 `agentsRoot` 下顶层 agent 目录的新增、删除和 agent.yaml 修改。fingerprint 覆盖范围限定为 `agentsRoot` 下的顶层 agent 目录（`agents/{agentId}/agent.yaml`），不覆盖 `agents/{parentAgentId}/subagents/` 目录，并在检测到变化后重建编译后的 assembly 集合。重建后 `AgentAssemblyRegistry.active`、`AgentAssemblyRegistry.require`、`AgentDiscoverySource.listBuiltinAgentAssemblies`、`AgentDiscoverySource.listTopLevelLocalAgentAssemblies` 和 `AgentDiscoverySource.listParentSubagentAssemblies` MUST 返回更新后的 assembly 集合。

触发机制：fingerprint 检查在 `AgentAssemblyRegistry.active`、`AgentAssemblyRegistry.require` 和 `AgentDiscoverySource` 的 list 方法被调用时同步执行。fingerprint 未变化时直接返回当前集合，不产生额外开销。fingerprint 变化时同步执行重建。不涉及后台 job 或调度机制。

前置条件：`agentsRoot` 目录可访问；`systemConfig` 和 `modelProfiles` 已初始化；`assemblyRegistry` 已在启动时完成首次编译。

重建 MUST 复用与启动时相同的 Agent package assembly 编译边界和校验规则。重建过程中已 accepted 的 request MUST 继续使用其 frozen assembly（通过 `require(agentId, agentVersion)`），MUST NOT 受重建影响。

重建失败时系统 MUST 保留上一次有效的 assembly 集合，MUST NOT 用半成品或部分重建结果替换已有 registry。重建失败 MUST 通过 structured log 记录（event: `agent.registry.refresh_failed`，字段: `safeReasonCode`），MUST NOT 进入 Web API response 或 audit event。

并发触发语义：当多个请求并发触发 fingerprint 检查且 fingerprint 已变化时，系统 MUST 使用上一次有效的 assembly 集合响应当前请求，MUST NOT 阻塞请求等待重建完成。重建 MUST 在当前请求的 fingerprint 检查中同步完成；如果重建期间有新请求到达，新请求 MUST 触发独立的 fingerprint 检查，若 fingerprint 仍未变化（已重建完成）则直接返回新集合，若仍在重建中则使用上一次有效集合响应。

**需求类别**：功能性需求

#### Scenario: pub 新增 agent 目录后 registry 自动发现

- **WHEN** 进程启动后 `agentsRoot` 下新增一个 agent 目录 `agents/network-specialist/agent.yaml`
- **THEN** 系统 MUST 在下一次 registry 查询时同步检测到目录变化
- **AND** MUST 重新编译 `agentsRoot` 下所有 agent 的 assembly 集合
- **AND** `AgentAssemblyRegistry.active('network-specialist')` MUST 能返回该 agent 的 assembly
- **AND** `AgentDiscoverySource.listTopLevelLocalAgentAssemblies` MUST 包含该 agent 的 assembly

#### Scenario: 删除 agent 目录后 registry 不再返回该 agent

- **WHEN** 进程启动后 `agentsRoot` 下删除一个 agent 目录
- **THEN** 系统 MUST 在下一次 registry 查询时同步检测到目录变化
- **AND** 重建后 `AgentAssemblyRegistry.active(deletedAgentId)` MUST 返回 missing-assembly safe failure
- **AND** 已 accepted 且 frozen 到该 agent 的 request MUST 继续通过 `require(agentId, agentVersion)` 正常执行

#### Scenario: 重建失败时保留上一次有效 assembly 集合

- **WHEN** registry 重建过程中编译失败（如新增的 agent.yaml 格式非法）
- **THEN** 系统 MUST 保留上一次有效的 assembly 集合
- **AND** MUST 通过 structured log 记录失败（event: `agent.registry.refresh_failed`）
- **AND** MUST NOT 用部分重建结果替换已有 registry

#### Scenario: 已 accepted request 不受重建影响

- **WHEN** 一个 request 已 accepted 并 frozen 到 `agentId:default-agent, agentVersion:v1`
- **AND** registry 重建后 `default-agent` 的 agent.yaml 发生变化
- **THEN** 该 accepted request MUST 继续通过 `require('default-agent', 'v1')` 读取 frozen assembly
- **AND** MUST NOT 使用重建后的新 assembly 替换该 request 的 frozen assembly

#### Scenario: 并发请求不阻塞等待重建

- **WHEN** 多个请求并发触发 fingerprint 检查且 fingerprint 已变化
- **THEN** 当前正在重建的请求 MUST 同步完成重建后返回新集合
- **AND** 重建期间到达的新请求 MUST 使用上一次有效集合响应，MUST NOT 阻塞等待

### Requirement: Agent 装配编译 root-qualified 文件目录权限

系统 MUST 在 Agent 装配时将 `workspaceFiles.readDirectories` 和 `workspaceFiles.writeDirectories` 编译为 root-qualified canonical directories。`.` MUST 编译为 `workspace`；不带已知 root 前缀的普通目录 MUST 编译为 `workspace/<directory>`；以 `workspace`、`temp`、`.nextagent`、`generated-skills` 或 `shared-data` 开头的目录 MUST 保留对应 root 并完成规范化。workspace 内与已知 root 同名的普通目录 MUST 通过 `workspace/<name>` 显式配置。

`readDirectories` 缺省时，effective Read authority MUST 包含整个 `workspace`；显式空数组 MUST 不授权任何 workspace 目录。`writeDirectories` 缺省时 MUST 保持产品默认 workspace 写权限，显式空数组 MUST 不授权 workspace 写入；每个 write directory MUST 自动加入 effective Read authority。系统 MUST 在发布 `AgentAssembly` 前拒绝绝对路径、父级穿越、glob、链接逃逸或不能映射到受治理逻辑 root 的目录，并 MUST NOT 让 request、模型输出、Tool input 或客户端 metadata 修改编译结果。

**需求类别**：功能性需求

#### Scenario: 普通目录配置编译到 workspace

- **WHEN** Agent 定义配置 `readDirectories=["diagnostics"]` 和 `writeDirectories=["."]`
- **THEN** 编译后的目录 MUST 分别为 `workspace/diagnostics` 和 `workspace`
- **AND** effective Read authority MUST 同时包含这两个 workspace 范围

#### Scenario: 省略与显式空集合保持不同语义

- **WHEN** 两个 Agent 定义分别省略 `readDirectories` 和显式配置 `readDirectories=[]`
- **THEN** 前者 MUST 获得整个 `workspace` 的读取权限
- **AND** 后者 MUST 不获得任何 workspace 读取权限，除非 `writeDirectories` 贡献了对应 workspace 目录

#### Scenario: 缺省与显式空写目录保持兼容语义

- **WHEN** 两个 Agent 定义分别省略 `workspaceFiles` 和显式配置 `writeDirectories=[]`
- **THEN** 前者 MUST 编译产品默认 workspace 写权限
- **AND** 后者 MUST 不获得 workspace 写权限

#### Scenario: 保留显式特殊 root

- **WHEN** Agent 定义配置 `generated-skills/output` 或 `workspace/temp`
- **THEN** 系统 MUST 分别保留为 `generated-skills/output` 和 `workspace/temp`
- **AND** 系统 MUST NOT 将 `workspace/temp` 错误解释为 run-scoped `temp/`

#### Scenario: 非法目录阻断受影响 Agent 装配

- **WHEN** 目录配置包含绝对路径、父级穿越、glob 或逃逸当前 execution scope 的链接
- **THEN** 系统 MUST 在发布受影响 Agent 装配前安全失败
- **AND** 其他 Agent 装配的权限 MUST NOT 被扩大

### Requirement: Agent package 保留可选本地化展示名称

`agent.yaml` MUST 支持 optional、非 `null` 的 `locales`，其结构和校验边界 MUST 与 `CapabilityDescriptor.locales` 相同。字段缺失时 Agent package MUST 继续按既有 `displayName` 编译；字段非法时 package compilation MUST fail closed，并 MUST NOT 发布半成品 `AgentAssembly`。

**需求类别**：功能性需求

runtime-ready `AgentAssembly` MUST 保留已校验的 optional `locales`，使 Agent Capability Provider 可以把 `AgentAssembly.displayName` 和 `AgentAssembly.locales` 逐值投影到同一 Agent descriptor。`locales` MUST 只承载展示事实，MUST NOT 改变 `agentId`、`agentVersion`、assembly selection、routing、model、prompt、capability binding、Agent invocation、workspace policy 或 Agent Scope。

#### Scenario: Agent package 提供中英文名称

- **WHEN** 合法 `agent.yaml` 提供稳定 `displayName` 以及 `zh-CN`、`en-US` 本地化名称
- **THEN** compilation MUST 在 runtime-ready `AgentAssembly` 中保留这些展示事实
- **AND** Agent Provider 产生的 descriptor MUST 逐值保留相同事实

#### Scenario: Agent package 未提供本地化名称

- **WHEN** 合法 `agent.yaml` 不包含 `locales`
- **THEN** compilation MUST 继续成功
- **AND** Agent descriptor MUST 使用既有稳定 `displayName`，MUST NOT 伪造本地化名称

#### Scenario: 随产品交付的 network-explorer 可直接验收中英文名称

- **GIVEN** 仓库随产品交付既有 `network-explorer` builtin Agent package
- **WHEN** app-owned loader 编译该 package
- **THEN** runtime-ready assembly MUST 包含产品定义的 `zh-CN` 与 `en-US` 名称
- **AND** `agentId`、稳定 `displayName`、description、binding 和 Agent invocation MUST 保持不变

#### Scenario: Agent package 名称非法

- **WHEN** `agent.yaml.locales` 不满足 `CapabilityDescriptor.locales` 的结构、locale grammar 或文本约束
- **THEN** package compilation MUST fail closed
- **AND** 系统 MUST NOT 发布该 Agent 的半成品 assembly 或 descriptor
