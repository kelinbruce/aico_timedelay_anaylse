# local-skill-source Specification

## Purpose
Define the stable behavior for system-level and Agent-owned local Skill discovery, trusted provider identity, `configRoot`/`workspaceRoot` source roots, Catalog request-scope visibility, shadowing, and safe diagnostics.

## Requirements
### Requirement: 本地 Skill Source 支持系统级 EAGER 和 Agent-owned SEARCH 两类来源

系统 SHALL 支持两类 `LOCAL_DIRECTORY` Skill source：

- system-level local Skill source：由可信 app composition 指定一个系统级 `skills/` root，使用 `discoveryMode=EAGER`，在 startup / capability discovery baseline 阶段加载。
- Agent-owned local Skill source：由 trusted Agent package root 下的 `skills/` 目录承载，使用 `discoveryMode=SEARCH`，由 Capability Catalog 在构造当前 Agent request-scope view 时按 trusted Agent scope 加载。

两类来源 MUST 进入统一 capability discovery 和 Catalog governance 边界，最终归一为 `SKILL` capability descriptor candidate。系统不得为本地 Skill 创建第二套 Skill contract、第二套 manifest schema 或第二套可用性计算路径。

#### Scenario: 系统级本地 Skill source 启动期加载

- **WHEN** app composition 配置了启用状态的 system-level local `skills/` root
- **THEN** 系统必须把该 root 作为 trusted system local Skill source 处理
- **AND** 该 source 必须使用 `providerKind=LOCAL_DIRECTORY` 和 `discoveryMode=EAGER`
- **AND** 有效本地 Skill 必须在 startup / capability discovery baseline 阶段进入统一 capability catalog governance

#### Scenario: Agent-owned Skill source 按当前 Agent 搜索加载

- **WHEN** Capability Catalog 为某个 trusted Agent assembly 构造 `listAvailable` 或 `resolve` 的 request-scope view
- **THEN** 系统必须通过 Agent-owned local Skill `SEARCH` discovery 加载该 Agent package root 下的 `skills/`
- **AND** 该 source 必须使用 `providerKind=LOCAL_DIRECTORY` 和 `discoveryMode=SEARCH`
- **AND** 该 source 中的有效 Skill 只允许进入 owning Agent 的可用 Skill 候选集

#### Scenario: 本地 Skill source 不创建第二套 Skill contract

- **WHEN** 本地 Skill source 发现有效 Skill
- **THEN** 系统必须输出统一 `SKILL` capability descriptor candidate
- **AND** 系统不得创建 local-only Skill DTO、local-only invocation contract 或 local-only catalog

### Requirement: 本地 Skill Provider Identity 由系统保留

系统 SHALL 把本地 Skill source 的 provider identity 作为 trusted owner-owned startup contribution fact 管理。`local-skills-system` SHALL 表示 system-level local Skill provider，`local-skills-agent-owned` SHALL 表示 Agent-owned local Skill provider。两者都 MUST 使用 `providerKind=LOCAL_DIRECTORY`，并且只能由 `agent-capability` 在 startup provider contribution assembly 中从可信 app composition locator/configRoot facts 物化；`agent-app` 不维护这些 provider 的权威清单。

外部 `CapabilityProviderConfig`、source configuration、Agent package、Skill manifest metadata、client request、runtime command 或 capability argument MUST NOT 声明、覆盖、禁用、重映射或劫持这些 reserved provider id。系统发现外部配置与 reserved provider id 冲突时 MUST 安全拒绝该外部 provider registration，并保留 safe diagnostic。

System-level local Skill root SHALL be derived from the frozen app `configRoot` as `configRoot/skills`. `default-system.yaml` is an internal default config source; user `application.yaml` is an overlay source whose containing directory defines `configRoot`. User-facing app config MUST NOT expose `paths.systemSkillsRoot`, `paths.agentsRoot`, or `paths.sqliteFile` as writable path entries. App composition SHALL validate, resolve and freeze `configRoot` and `workspaceRoot`, derive `systemSkillsRoot=configRoot/skills`, then synthesize the reserved runtime source fact for `local-skills-system + LOCAL_DIRECTORY + EAGER`.

`CapabilityProviderConfig.options.directoryRef` MAY be used only after trusted app composition has synthesized the reserved provider runtime input. External raw provider configuration MUST NOT declare `providerId=local-skills-system` even when it wants to configure the system local Skill root.

User-facing capability source configuration MUST NOT support `type=local-directory`. `LOCAL_DIRECTORY` is reserved for the two trusted local Skill providers defined by this change and is not a general user-configurable provider kind. Users MUST provide system local Skills under `configRoot/skills`; Agent-owned local Skills MUST come from the trusted Agent package source locator rooted at `configRoot/agents`.

Built-in provider identity MUST be owned by the package that owns the provider semantics, not by `default-system.yaml`. `builtin-tools`, `builtin-skills`, `local-skills-system`, and `local-skills-agent-owned` SHALL enter the capability subsystem as trusted startup provider contributions. `default-system.yaml` and user `application.yaml` MUST NOT use a raw `capabilityProviders.providers` entry to declare `builtin-tools` or any other framework/reserved provider.

#### Scenario: Reserved provider identity 由 capability startup contribution 注册

- **WHEN** 系统启用本地 Skill source
- **THEN** capability startup contribution assembly 必须注册 `local-skills-system` 和 `local-skills-agent-owned` 这两个 trusted provider identity
- **AND** 两者必须使用 `providerKind=LOCAL_DIRECTORY`
- **AND** system provider 必须使用 `EAGER` discovery mode，Agent-owned provider 必须使用 `SEARCH` discovery mode

#### Scenario: 外部 provider 不能占用 reserved id

- **WHEN** 外部 capability source configuration 或 Agent package 声明 `providerId=local-skills-system` 或 `providerId=local-skills-agent-owned`
- **THEN** 系统必须拒绝该外部 provider registration
- **AND** 系统不得让外部配置覆盖、禁用或修改 trusted local Skill provider
- **AND** diagnostic 不得暴露 provider-private raw config 或路径

#### Scenario: 用户配置不支持 local-directory provider

- **WHEN** user capability source configuration 声明 `type=local-directory`
- **THEN** resolver 必须以 `UNSUPPORTED_PROVIDER_TYPE` 安全拒绝该 entry
- **AND** `ResolvedCapabilityProviders.providers` 不得包含来自该 entry 的 `LOCAL_DIRECTORY` provider
- **AND** 系统必须继续只通过 frozen `configRoot/skills` 和 trusted Agent package source locator 创建本地 Skill source

#### Scenario: default-system 不配置 builtin provider

- **WHEN** product composition 加载内置 `default-system.yaml`
- **THEN** 该文件不得包含 raw `capabilityProviders.providers`
- **AND** `builtin-tools` 和 `builtin-skills` 必须由 owning package startup provider contributions 注册
- **AND** app readiness 不得依赖用户 raw config 中存在 `providerId=builtin-tools`

#### Scenario: configRoot 默认定位 system local Skill root

- **WHEN** product composition 未提供用户 `application.yaml`
- **THEN** app composition 必须使用启动 base dir 作为兼容 `configRoot`
- **AND** system-level local Skill root 必须派生为 `configRoot/skills`
- **AND** app composition 必须合成 `providerId=local-skills-system`、`providerKind=LOCAL_DIRECTORY`、`discoveryMode=EAGER` 的 reserved runtime source fact

#### Scenario: application.yaml 所在目录定义 configRoot

- **WHEN** startup 使用用户 `application.yaml`
- **THEN** app composition 必须把该文件所在目录冻结为 `configRoot`
- **AND** system-level local Skill discovery 必须扫描 `configRoot/skills` 下的一级 Skill candidates
- **AND** diagnostics 不得暴露 raw absolute path

#### Scenario: System local root 由 configRoot 合成 reserved provider

- **WHEN** app composition 已解析并冻结 `configRoot`
- **THEN** app composition 必须使用 `configRoot/skills` 作为 frozen system local Skill root
- **AND** app composition 必须合成 `providerId=local-skills-system`、`providerKind=LOCAL_DIRECTORY`、`discoveryMode=EAGER` 的 reserved runtime source fact
- **AND** `LocalSkillDiscovery` 必须只消费合成后的 trusted source fact
- **AND** `agent-capability` 不得直接读取 raw app config 或 raw user provider entry

#### Scenario: configRoot/skills 缺失或为空不阻塞其他 capability source

- **WHEN** `configRoot/skills` 目录不存在、不可读或没有有效一级 Skill candidate
- **THEN** `local-skills-system` 必须产生 safe unavailable、ignored 或 empty candidate outcome
- **AND** 系统不得因此阻塞 builtin capability 或 Agent-owned local Skill source
- **AND** diagnostic 必须只表达 safe unavailable/no-candidate outcome

### Requirement: configRoot 和 workspaceRoot 定位配置输入与运行输出

系统 SHALL 在可信 app config / app composition 中冻结两个 root：`configRoot` 和 `workspaceRoot`。`configRoot` 承载用户 `application.yaml`、`skills/` 和 `agents/`；`workspaceRoot` 承载运行数据、SQLite、logs 和 execution workspace state。`workspaceRoot` MUST come from the final system config after applying `application.yaml` over the internal `default-system.yaml`. `configRoot` MUST come from the `application.yaml` containing directory, or from the current startup base dir when no user application config is supplied.

Agent-owned Skill root MUST 使用 trusted locator 解析为：

```text
agentPackageRoot = resolve(configRoot, "agents", agentId)
agentOwnedSkillRoot = resolve(agentPackageRoot, "skills")
```

`agentsRoot` 是 frozen derived path `configRoot/agents`，不属于 `CapabilityProviderConfig`，也不得由 `agent-capability` 直接从 raw app config 解释。Runtime-facing `AgentAssembly.workspacePolicy` 和 accepted-run execution workspace view 只描述运行时文件访问策略与执行 root，不得作为 Agent-owned Skill source root 的权威来源。Legacy package `workspaceDir` input 同样不得作为 Agent-owned Skill source root。

#### Scenario: configRoot 默认定位 Agent package

- **WHEN** app composition 已冻结 `configRoot`
- **THEN** Agent package root 集合必须派生为 `configRoot/agents`
- **AND** Agent-owned Skill source for `agentId=default-agent` 必须定位到 `configRoot/agents/default-agent/skills`

#### Scenario: workspaceRoot 定位运行输出

- **WHEN** final system config 指定 `paths.workspaceRoot`
- **THEN** app composition 必须冻结该 path 作为运行根
- **AND** `sqliteFile` 必须派生为 `workspaceRoot/data/system/nextagent.sqlite`
- **AND** Agent execution workspace state 必须由 app composition 派生到 `workspaceRoot/execution`，并由 runtime resolver 按 `workspacePolicy` 和 trusted accepted-run facts 解析具体 execution roots
- **AND** diagnostics 不得暴露 raw absolute path

#### Scenario: Execution workspace 不作为 Agent-owned Skill root

- **WHEN** execution workspace root 或 legacy package `workspaceDir` 与 `configRoot/agents/{agentId}` 指向不同目录
- **THEN** Agent-owned Skill discovery 必须使用 `configRoot/agents/{agentId}/skills`
- **AND** 系统不得扫描 execution workspace、runtime-facing `workspacePolicy` logical roots 或 legacy `workspaceDir/skills` 作为 Agent-owned Skill source

#### Scenario: 非可信输入不能覆盖 configRoot 或 agentsRoot

- **WHEN** 客户端请求、模型输出、Skill manifest metadata、descriptor metadata、runtime command 或 capability arguments 提供 configRoot、workspaceRoot、agentsRoot、agent package root 或 equivalent path
- **THEN** 系统不得把这些值用于定位 Agent-owned Skill source
- **AND** 系统必须继续使用 app composition 冻结的 trusted Agent package source locator

#### Scenario: 内置 default Agent 无 package root 时不回退 workspaceDir

- **WHEN** 当前 Agent 由 built-in default assembly registry 提供
- **AND** trusted Agent package source locator 对 `configRoot/agents/{agentId}` 返回 not configured、not found 或 package unavailable
- **THEN** Agent-owned local Skill SEARCH discovery 必须返回空候选集
- **AND** 系统必须保留安全 Agent package unavailable/not-configured diagnostic
- **AND** 系统不得扫描 execution workspace、runtime-facing `workspacePolicy` logical roots 或 legacy `workspaceDir/skills`
- **AND** 系统不得仅因为 Agent-owned local Skill source 缺失而阻塞该 Agent 的既有请求路径

#### Scenario: 用户 Agent 配置替换内置 AgentDefinition

- **WHEN** `configRoot/agents/{agentId}/agent.yaml` 存在
- **THEN** app assembly loader 必须使用该文件作为 active AgentDefinition
- **AND** 该文件必须替换对应 AgentDefinition，不得与内置 `default-agent.yaml` 深 merge
- **AND** AgentDefinition 中出现 SQLite、channel、gateway、owner identity 或 provider endpoint 等系统字段必须 fail closed

#### Scenario: default-agent 缺少用户 Agent 配置时兼容内置默认

- **WHEN** active Agent 是 `default-agent`
- **AND** `configRoot/agents/default-agent/agent.yaml` 不存在
- **THEN** app assembly loader 可以使用内置 `packages/agent-app/config/default-agent.yaml`
- **AND** Agent-owned local Skill discovery 仍不得扫描 execution workspace、runtime-facing `workspacePolicy` logical roots 或 legacy `workspaceDir/skills`

### Requirement: Agent-owned SEARCH Discovery 不消费 Binding 决策

Agent-owned local Skill `SEARCH` discovery SHALL 只消费 trusted Agent search scope 和可选请求定位条件。Discovery MUST NOT 消费 `AgentAssembly.capabilityBindings`、explicit disable、routing policy、availability verdict 或 conflict result 作为发现依据。

Binding、显式禁用、可见性、availability、冲突、shadowing、model visibility 和 invocation eligibility MUST 由 Capability Catalog governance 在 discovery 返回 candidates 之后统一处理。

`agent-capability` public discovery SEARCH SPI MUST reflect this ownership boundary. `CapabilitySearchCriteria` 或其 replacement criteria SHALL expose only safe request scope: tenant/subject safe context, `agentId`, `agentVersion`, `agentAssemblyRef`, and optional `requestedCapabilityId`. It MUST NOT expose runtime-facing `AgentAssembly`, `capabilityBindings`, `boundCapabilityIds`, availability verdict, routing policy, or conflict result to discovery.

#### Scenario: Catalog 调用 SEARCH discovery 时不传 bindings

- **WHEN** Catalog 为 Agent-owned local Skill source 调用 `SEARCH` discovery
- **THEN** search criteria 必须只包含 trusted `agentId`、`agentVersion`、`agentAssemblyRef`、tenant/subject 安全上下文和可选 `requestedCapabilityId`
- **AND** search criteria 不得包含 `capabilityBindings` 或 `boundCapabilityIds`
- **AND** search criteria 不得包含 runtime-facing `AgentAssembly` 对象

#### Scenario: Public SEARCH criteria contract 不暴露 binding-owned facts

- **WHEN** consumer 通过 `agent-capability` public discovery SEARCH SPI 调用 discovery
- **THEN** TypeScript public criteria type 不得包含 `boundCapabilityIds`、`capabilityBindings` 或 `agentAssembly`
- **AND** 既有 discovery callers / tests 必须迁移到 trusted search scope criteria
- **AND** compatibility tests 必须证明 discovery 无法基于 binding-owned facts 改变发现输出

#### Scenario: Binding disable 由 Catalog 应用

- **WHEN** Agent-owned SEARCH discovery 返回某个 Skill candidate
- **AND** 当前 Agent assembly 存在同 key explicit disable binding
- **THEN** Catalog 必须排除该 candidate
- **AND** Discovery 不得因为 binding disable 改变 discovery 输出

### Requirement: 本地 Skill Discovery 复用标准 SKILL.md Manifest Contract

本地 Skill discovery MUST 对 system-level 和 Agent-owned 两类来源复用同一 `SKILL.md` manifest parser、descriptor mapper、typed `SkillMetadata` 和 manifest diagnostics。Root 下每个包含 `SKILL.md` 的一级子目录表示一个 Skill candidate。隐藏目录必须忽略。嵌套目录中的 `SKILL.md` 不得在本 change 中成为独立 Skill candidate。

#### Scenario: 一级目录中的 SKILL.md 形成本地 Skill candidate

- **WHEN** 本地 Skill discovery 扫描 system-level 或 Agent-owned `skills/` root
- **AND** root 下某个一级子目录包含有效 `SKILL.md`
- **THEN** 该子目录必须成为一个本地 Skill candidate
- **AND** discovery 必须使用标准 Skill manifest parser 和 descriptor mapper 生成 descriptor candidate

#### Scenario: 缺少 SKILL.md 的目录不注册为 Skill

- **WHEN** 本地 Skill discovery 扫描一个一级子目录
- **AND** 该目录不包含 `SKILL.md`
- **THEN** 系统不得把该目录注册为 Skill capability
- **AND** 系统必须最多输出安全 missing-manifest 或 ignored-candidate diagnostic

#### Scenario: 隐藏目录和嵌套 Skill 被忽略

- **WHEN** 本地 Skill discovery 遇到名称以 `.` 开头的目录或非一级嵌套 `SKILL.md`
- **THEN** discovery 必须忽略该 candidate
- **AND** 系统不得把嵌套目录关系解释为 Skill hierarchy、progressive disclosure 或 nested invocation fact

### Requirement: 本地 Skill 自动参与 Agent 可用 Skill 清单

本地 Skill source 发现出的有效 Skill SHALL 自动参与 Agent request-scope 可用 Skill 清单计算。自动参与的含义是：Capability Catalog 在 `listAvailable` / `resolve` 中把受治理的 system-level local Skill 和当前 Agent 的 Agent-owned local Skill 纳入该 Agent 的候选集。系统不得要求这些自动可见的本地 Skill 必须先作为 explicit binding 写入 runtime-facing `AgentAssembly.capabilityBindings`。

Capability Catalog SHALL distinguish default-enabled trusted SEARCH providers from binding-enabled SEARCH providers. `local-skills-agent-owned` is a reserved default-enabled trusted SEARCH provider; Catalog MUST call it for the current Agent request-scope view without requiring explicit enabled binding. Default-enabled providers behave like Catalog-owned default enablement facts, but MUST NOT be written as synthetic `AgentAssembly.capabilityBindings`. Non-reserved or externally configured SEARCH providers MUST remain binding-enabled: Catalog MUST NOT search them unless the current Agent assembly has an enabled binding for that provider, and their returned candidates MUST remain constrained by enabled bindings.

Explicit disabled bindings SHALL apply to all candidates after discovery/default candidate collection, including builtin EAGER providers, system-level local EAGER provider, Agent-owned default-enabled SEARCH provider and binding-enabled SEARCH providers.

#### Scenario: 系统级本地 Skill 默认对每个 Agent 可见

- **WHEN** system-level local Skill 被 discovery 和 catalog governance 接受
- **AND** 某个 Agent 没有显式禁用或更高优先级 shadow 该 Skill
- **THEN** `CapabilityCatalog.listAvailable` 必须把该 Skill 纳入该 Agent 的可见 Skill 清单
- **AND** `CapabilityCatalog.resolve` 必须能按同一治理结果解析该 Skill

#### Scenario: Agent-owned local Skill 默认对 owning Agent 可见

- **WHEN** Agent-owned local Skill 被 SEARCH discovery 和 catalog governance 接受
- **THEN** `CapabilityCatalog.listAvailable` 必须把该 Skill 纳入 owning Agent 的可见 Skill 清单
- **AND** 非 owning Agent 的可见 Skill 清单不得包含该 Agent-owned Skill

#### Scenario: Default-enabled Agent-owned SEARCH provider 不依赖 binding

- **WHEN** `local-skills-agent-owned` provider 已由 trusted app composition 注册并启用
- **AND** 当前 Agent assembly 没有为 `local-skills-agent-owned` 或其 discovered Skill 写入 explicit binding
- **THEN** Catalog 在构造该 Agent 的 `listAvailable` 或 `resolve` request-scope view 时必须调用 `local-skills-agent-owned` SEARCH discovery
- **AND** discovery 返回的有效 Agent-owned Skill 必须进入该 Agent 的候选集
- **AND** 该 candidate 仍必须经过 Catalog 的 explicit disable、availability、conflict、shadowing 和 model visibility 治理

#### Scenario: Explicit disabled binding 覆盖 default-enabled provider

- **WHEN** builtin、system-level local 或 Agent-owned local default-enabled provider 发现某个 capability
- **AND** 当前 Agent assembly 存在同 provider/capability key 的 explicit disabled binding
- **THEN** Catalog 必须从该 Agent 的可见清单和 `resolve` 结果中排除该 capability
- **AND** Discovery 不得因为 disabled binding 改变 discovery 输出
- **AND** 系统不得为了表达该默认启用关系向 `AgentAssembly.capabilityBindings` 写入 synthetic enabled binding

#### Scenario: 非 reserved SEARCH provider 仍按 binding 启用

- **WHEN** 某个非 reserved 或外部配置的 SEARCH provider 被注册
- **AND** 当前 Agent assembly 没有为该 provider 写入 enabled binding
- **THEN** Catalog 不得为了自动可见性调用该 SEARCH provider
- **AND** 该 provider 的 capability 不得进入当前 Agent 的候选集

#### Scenario: Binding-enabled SEARCH provider 返回结果仍受 binding 限制

- **WHEN** 某个非 reserved SEARCH provider 因 explicit binding 被 Catalog 调用
- **THEN** Catalog 必须只保留 enabled bindings 允许的 provider/capability candidates
- **AND** 未绑定 capability 不得因为 provider 被搜索而进入 model-visible 可用清单

#### Scenario: 自动可见性不写入 AgentAssembly explicit bindings

- **WHEN** 本地 Skill 因 system-level 或 Agent-owned source 被自动纳入 Agent 可见候选
- **THEN** runtime-facing `AgentAssembly.capabilityBindings` 不需要包含该 Skill 的 synthetic enabled binding
- **AND** runtime、core、context engine 和 recovery 必须只消费 compiled assembly facts 与 Catalog 结果

### Requirement: Agent-owned 本地 Skill 优先于系统级本地 Skill

当同一个 Agent 的 Agent-owned local Skill 和 system-level local Skill 具有相同 `capabilityId` 时，Catalog governance MUST 选择 Agent-owned Skill 作为该 Agent 的 winning candidate，并使 system-level local Skill 在该 Agent 范围内 shadowed 或 non-executable。同一来源同一 scope 内相同 `capabilityId` 且无法证明 stable source fact identity 相同的 candidates MUST 被安全 rejected，不得 silent overwrite。

本 change 不改变 `BUNDLED` builtin capability 的最高优先级。本地 Skill 不得覆盖 builtin capability；本地 Skill 与 builtin capability 冲突时，必须按既有 conflict governance 使本地 Skill shadowed、rejected 或 unavailable。

Catalog conflict governance MUST use an internal candidate fact model that includes provider id、provider kind、source scope、agent id/version when applicable、capability id、stable source fact identity and local priority. It MUST group candidates by `capabilityId` for the current Agent request scope and apply this ordered policy:

1. `BUNDLED` candidate remains the winner over any local candidate.
2. Same local source scope duplicate candidates with different stable source fact identity are rejected before model-visible list construction.
3. For the same Agent request scope, Agent-owned `LOCAL_DIRECTORY` candidate wins over system-level `LOCAL_DIRECTORY` candidate with the same `capabilityId`.
4. System-level local candidate shadowed by Agent-owned local candidate remains eligible for other Agents that do not have an Agent-owned candidate with the same `capabilityId`.

#### Scenario: Agent-owned Skill shadow 系统级本地 Skill

- **WHEN** 一个 Agent 的 Agent-owned local Skill 与 system-level local Skill 使用相同 `capabilityId`
- **AND** 两者均通过 manifest validation 和 catalog governance 的基本候选校验
- **THEN** 该 Agent 的可见 Skill 清单必须选择 Agent-owned local Skill
- **AND** system-level local Skill 必须在该 Agent 范围内 shadowed 或 non-executable
- **AND** 系统必须保留安全 shadow diagnostic

#### Scenario: 系统级本地 Skill 仍对未覆盖 Agent 可见

- **WHEN** system-level local Skill 被某个 Agent-owned local Skill shadow
- **AND** 另一个 Agent 没有同 `capabilityId` 的 Agent-owned local Skill
- **THEN** system-level local Skill 必须仍可作为另一个 Agent 的可见候选

#### Scenario: 同一来源内重复 capabilityId 被拒绝

- **WHEN** 同一个 system-level local source 或同一个 Agent-owned local source 内出现多个相同 `capabilityId` 的不同 stable source facts
- **THEN** 系统必须把这些 candidates 视为同 scope conflict
- **AND** 冲突 candidates 不得 silent overwrite
- **AND** 冲突 candidates 不得进入 model-visible 可用 Skill 清单

#### Scenario: 本地 Skill 不覆盖 builtin capability

- **WHEN** 本地 Skill 与 `BUNDLED` builtin capability 使用相同 `capabilityId`
- **THEN** 本地 Skill 不得覆盖 builtin capability
- **AND** 系统必须按既有 conflict governance 产生安全 shadow、reject 或 unavailable outcome

### Requirement: Runtime/Core/Context 不直接扫描本地 Skill 目录

system-level local Skill discovery SHALL 发生在 startup / capability discovery baseline 阶段。Agent-owned local Skill discovery MAY 在 Catalog `listAvailable` / `resolve` 构造 request-scope view 时以 `SEARCH` 模式扫描当前 Agent 的 trusted `configRoot/agents/{agentId}/skills`。除 Catalog 调用受控 SEARCH discovery 外，用户请求、stream resume、history read、runtime control command、context assembly、model invocation、capability invocation 或 recovery 不得直接触发本地目录扫描或 `SKILL.md` 解析。

#### Scenario: Runtime/Core/Context 不扫描本地 Skill 目录

- **WHEN** runtime、core、context engine 或 recovery 需要 Skill 可见性或 Skill descriptor facts
- **THEN** 它们必须消费 Capability Catalog 的 governed view 或 compiled assembly facts
- **AND** 它们不得扫描 system-level `skills/` root、`configRoot/agents/{agentId}/skills` 或解析 `SKILL.md`

#### Scenario: Catalog SEARCH 是唯一 request-scope Agent-owned discovery 入口

- **WHEN** Agent-owned local Skill 需要为当前 Agent 形成 request-scope candidates
- **THEN** 只有 Capability Catalog 可以调用 Agent-owned `SEARCH` discovery
- **AND** discovery 必须使用 trusted Agent package source locator 定位 `configRoot/agents/{agentId}/skills`

### Requirement: 本地 Skill Source 只暴露安全 Facts

本地 Skill discovery、Catalog governance、diagnostics、readiness、safe errors、logs、metrics、stream projection、model-visible capability context 和 audit-related facts MUST NOT 暴露 raw local path、raw manifest content、full Skill body、source-owned loading key、content loading authority、credential、secret、provider-private config 或 Agent package internal layout。

本地 Skill discovery MAY 保存后续授权 inline/fork execution 所需的 source-owned internal loading facts。这些 facts MUST 限定在 provider/source implementation boundary 内，并且只能在后续授权 loader 或 invocation handler 中消费。

#### Scenario: Descriptor 不包含本地路径或加载授权

- **WHEN** 本地 Skill discovery 注册有效 Skill descriptor candidate
- **THEN** descriptor 和 metadata 不得包含 raw local path、raw manifest content、full Skill body、source-owned loading key 或 content loading authority
- **AND** descriptor 必须只包含统一 capability descriptor 和 Skill metadata 允许的安全 facts

#### Scenario: Diagnostic 不泄露 source-private 事实

- **WHEN** 本地 Skill source 输出 missing manifest、invalid manifest、source unavailable、duplicate rejected 或 shadowed diagnostic
- **THEN** diagnostic 必须只包含 provider id、provider kind、Agent scope、capability id、safe outcome code 和 sanitized message 等安全定位字段
- **AND** diagnostic 不得包含 raw local path、Agent package internal layout、raw manifest content、full Skill body、credential 或 secret

#### Scenario: Loading facts 只在授权后被消费

- **WHEN** 后续 Skill inline 或 fork execution 需要加载本地 Skill 内容
- **THEN** 它必须在 catalog resolve 和 invocation authorization 之后通过 provider-owned loader 消费 source-owned loading facts
- **AND** 本 change 不得把 loading facts 放入 public descriptor、model context、stream、safe error 或 client-visible response

### Requirement: 本地 Skill Diagnostics 可解释 Source、Manifest、Governance 和 Shadowing Outcome

系统 SHALL 为本地 Skill source 提供 implementation-local safe diagnostics 或 readiness evidence，用于解释 system source disabled、system source unavailable、derived Agent package root invalid、Agent package root unavailable、candidate ignored、missing `SKILL.md`、manifest invalid、governance unavailable、same-source duplicate rejected、Agent-owned shadow system-level 和 successful governed registration。

这些 diagnostics / readiness evidence MUST remain implementation-local to startup/readiness/capability diagnostics boundaries. `CapabilityCatalog.listAvailable`、`CapabilityCatalog.resolve`、stream events、Web API response 和 public capability descriptors MUST NOT add diagnostic payloads in this change.

Agent-owned SEARCH discovery failure, package root not configured, missing `skills/` root, unavailable source, ignored candidate, missing manifest or invalid manifest SHALL produce safe diagnostic evidence and an empty candidate set for the affected candidate/source. A Skill MUST only be reported as `LOCAL_SKILL_REGISTERED` after manifest parsing and Catalog governance both accept it as a governed result.

#### Scenario: 本地 Skill source outcome 可被运维诊断

- **WHEN** 本地 Skill source 在 discovery 或 governance 中产生 disabled、unavailable、invalid、duplicate、shadowed 或 registered outcome
- **THEN** startup/readiness 或 capability diagnostics 必须能以安全 outcome code 表达该结果
- **AND** outcome 必须能关联到 safe provider identity、Agent scope 和 Skill identity
- **AND** Catalog public list/resolve response 不得新增 diagnostics 字段

#### Scenario: Agent-owned SEARCH failure 返回空候选并记录安全 evidence

- **WHEN** Agent-owned local Skill SEARCH discovery 无法定位 package root、无法读取 `skills/` root 或遇到 invalid manifest
- **THEN** discovery / governance 必须为对应 source 或 candidate 记录 safe diagnostic evidence
- **AND** 失败 source 或 candidate 不得进入 model-visible 可用 Skill 清单
- **AND** 系统不得把 raw local path、Agent package internal layout 或 manifest content 放入 public descriptor、Catalog response、stream event 或 Web API response

#### Scenario: Successful registration 来自 governed catalog result

- **WHEN** 本地 Skill discovery 发现有效 manifest
- **AND** capability catalog governance 无法把该 candidate 注册或解析为可用结果
- **THEN** diagnostics 不得报告该 Skill successful governed registration
- **AND** diagnostics 必须报告安全 governance-unavailable、conflict、shadowed 或 unavailable outcome
