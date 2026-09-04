# builtin-skill-source Specification

## Purpose
Define the stable behavior for packaged builtin Skill discovery, trusted bundled provider identity, package-owned source root, framework-default catalog injection, explicit disable handling, safe readiness evidence, and the required telecom builtin Skill candidate.
## Requirements
### Requirement: 内置 Skill 通过统一 Capability Catalog 注册

系统 MUST 通过统一 capability discovery 和 catalog governance 边界发现 builtin Skills。本规格中的 builtin Skills 必须归一为 `SKILL` capability，并通过 `CapabilityCatalog` 注册为受治理 descriptor。

#### Scenario: 有效内置 Skill 成为受治理 descriptor

- **WHEN** builtin Skill discovery 发现有效 builtin Skill source entry
- **THEN** 系统必须把该 Skill 归一为受治理 `CapabilityDescriptor`
- **AND** 系统必须通过 `CapabilityCatalog` 注册该 descriptor

#### Scenario: Catalog 可见性和上下文披露消费受治理 Skill descriptor

- **WHEN** capability catalog、context assembly 或 model-visible capability disclosure 需要 builtin Skill descriptor facts
- **THEN** 系统必须消费 capability catalog governance 返回的 governed descriptor 或 governed visible view
- **AND** Agent App 装配路径不得扫描 builtin Skill source root、解析 `SKILL.md`、查询 discovery state、维护 builtin capability 清单或消费 source-owned loading facts

### Requirement: 内置 Skill Provider 使用冻结的 BUNDLED Provider Kind

Builtin Skill source MUST 使用稳定 provider identity：

- `providerId="builtin-skills"`
- `providerKind=BUNDLED`

该 identity 是 discovery、catalog、resource inventory、explicit binding / disable 和 readiness evidence 的共同坐标。

#### Scenario: Builtin Skill provider 使用 BUNDLED

- **WHEN** 系统创建 builtin Skill 的 provider identity
- **THEN** provider 必须使用 `providerKind=BUNDLED`
- **AND** provider 必须使用稳定 provider id `builtin-skills`
- **AND** 系统不得新增 builtin-only provider kind 或允许 builtin Skill 自行声明 provider kind

### Requirement: 内置 Skill Source 使用 agent-capability 拥有的 SKILL.md 目录结构

Builtin Skill discovery MUST 从 `agent-capability` package-owned trusted bundled Skill resource root 解析候选 Skill。该 root 是 framework packaged resource material。Root 下每个包含 `SKILL.md` 的一级子目录表示一个 builtin Skill candidate。以 `.` 开头的目录作为隐藏目录，由 discovery 忽略。

Trusted bundled resource root 是本规格的 builtin Skill archive boundary。系统必须把 root 视为只读 discovery source material，并保持物理路径、resource URI 和 package internal layout 为 provider-private implementation fact。

#### Scenario: Builtin Skill archive root 产生候选 Skill

- **WHEN** builtin Skill discovery 扫描 trusted bundled resource root
- **THEN** 每个包含有效 `SKILL.md` 的一级子目录必须成为一个 builtin Skill candidate
- **AND** 嵌套目录不会在本规格中成为独立 builtin Skill candidate

#### Scenario: 缺少 SKILL.md 的目录不注册为 Skill

- **WHEN** builtin Skill discovery 扫描一个 builtin Skill directory candidate
- **AND** 该目录不包含有效 `SKILL.md`
- **THEN** 该 candidate 不得注册为 builtin Skill capability
- **AND** 系统必须只暴露安全 missing-manifest diagnostic 或 readiness reason

#### Scenario: 隐藏目录被忽略

- **WHEN** builtin Skill discovery 遇到名称以 `.` 开头的目录
- **THEN** discovery 必须忽略该目录

#### Scenario: Source 坐标不暴露

- **WHEN** builtin Skill discovery 产生 candidate、descriptor、diagnostic、safe error、audit fact、metric、log、stream 或 model-visible capability context
- **THEN** 输出不得包含 trusted root path、resource URI、local path、package internal layout、raw manifest body 或 provider-private config

#### Scenario: 外部配置不能重定义 builtin root

- **WHEN** 外部 provider configuration、Agent package configuration、workspace configuration 或 client input 提供 builtin Skills 的目录或资源引用
- **THEN** 系统不得把该值作为 builtin Skill root
- **AND** builtin Skill discovery 必须继续使用 trusted package-owned resource root

### Requirement: 内置 Skill Discovery Adapter 由 agent-capability 拥有

Builtin Skill discovery MUST 由 `agent-capability` 内的 `BuiltinSkillDiscovery` adapter 负责。`BuiltinSkillDiscovery` 必须实现现有 provider-bound `CapabilityDiscovery` contract，使用 `discoveryMode=EAGER`，并只能作为 trusted `builtin-skills` startup provider contribution 的 discovery support 被组装。该 contribution 的 provider input MUST 精确匹配 `providerId="builtin-skills"` 和 `providerKind=BUNDLED`。

`BuiltinSkillDiscovery` 负责 package-root enumeration、candidate filtering、`SKILL.md` manifest fact extraction、manifest parser/mapper reuse、safe diagnostic production 和 source-owned internal loading facts。

#### Scenario: Contribution 为可信 provider 创建 builtin Skill discovery

- **WHEN** capability subsystem 组装 `providerId="builtin-skills"`、`providerKind=BUNDLED` 和 `discoveryMode=EAGER` 的 trusted provider contribution
- **THEN** contribution 必须包含 `BuiltinSkillDiscovery`
- **AND** 该 discovery 必须使用 package-owned builtin Skill root

#### Scenario: Builtin Skill discovery 只按精确 provider identity 选择

- **WHEN** provider input 未精确匹配 `providerId="builtin-skills"` 和 `providerKind=BUNDLED`
- **THEN** capability subsystem 不得为该 provider 绑定 builtin Skill discovery
- **AND** 系统不得通过注册顺序、custom provider type、external config 或 fallback matching 选择 builtin Skill discovery

### Requirement: 内置 Skill Discovery 由可信 Source Enablement 控制

Builtin Skill discovery MUST 受 trusted source enablement configuration 控制。该 source enablement 默认 enabled。可信 product/test composition 可以禁用整个 builtin Skill source。Source disabled 时，builtin Skill discovery 不得把 builtin Skills 注册进 executable catalog，并且必须提供安全 disabled-source outcome。

Agent 级禁用必须通过具体 framework-default builtin Skill 的 explicit binding disable 表达。

#### Scenario: 默认 source enablement 启用 builtin Skill discovery

- **WHEN** product/test composition 未显式禁用 builtin Skill source
- **THEN** builtin Skill discovery 必须按 enabled source 处理 package-owned candidate
- **AND** 有效 candidate 必须进入 capability catalog governance

#### Scenario: 可信禁用阻止 builtin Skill 注册

- **WHEN** trusted builtin Skill source enablement gate 被禁用
- **THEN** builtin Skill discovery 不得把 builtin Skills 注册进 executable catalog
- **AND** release readiness 或 health diagnostics 必须暴露安全 disabled-source outcome

#### Scenario: 非可信输入不能控制 source enablement

- **WHEN** Agent package configuration、Agent definition、workspace configuration、client input、model output、Skill manifest metadata、descriptor metadata 或 external provider config 尝试控制 builtin Skill source discovery
- **THEN** 系统不得把这些输入解释为 trusted source enablement gate
- **AND** Agent 级禁用必须保持为具体 framework-default builtin Skill 的 explicit binding disable

### Requirement: Manifest Parsing 复用标准 Skill Manifest Contract

Builtin Skill discovery MUST 使用受治理 Skill manifest contract 解析 `SKILL.md`。Builtin Skill descriptor、metadata 和 manifest diagnostic 必须复用现有 manifest parser/mapper 行为。

#### Scenario: Builtin Skill manifest 使用受治理 SKILL.md contract

- **WHEN** builtin Skill discovery 解析 builtin `SKILL.md`
- **THEN** discovery 必须使用受治理 Skill manifest contract
- **AND** 系统不得要求 source-private manifest schema

#### Scenario: Manifest 字段不创建 Skill 层级事实

- **WHEN** builtin Skill discovery 解析 builtin `SKILL.md`
- **THEN** discovery 不得从 manifest metadata、`allowed-tools`、目录嵌套、raw path、Tool id、Agent id、external resource 或隐藏内容创建 parent/child Skill hierarchy、progressive disclosure 或 nested invocation facts
- **AND** runtime relationship 必须由 capability governance 和 invocation execution 相关规格定义

### Requirement: 内置 Skill Source 保持 Content Loading Authority 为内部事实

Builtin Skill discovery MAY 保存后续受治理加载所需的 source-owned internal loading facts。这些 facts MUST 限定在 builtin Skill provider 和 capability id 范围内，并只作为后续授权 invocation handler 或 provider-owned loader 的内部输入。

Builtin Skill descriptor 和 metadata 必须只携带安全 descriptor facts。Discovery 阶段必须只解析 descriptor registration 所需的 manifest facts。

#### Scenario: Descriptor 不携带内容加载授权

- **WHEN** builtin Skill discovery 注册有效 builtin Skill
- **THEN** discovery 可以保存绑定到 builtin Skill provider 和 capability id 的 source-owned internal loading fact
- **AND** descriptor 不得包含 raw path、raw manifest content、full Skill body、executable resource body、source-owned loading key 或 content loading authority
- **AND** descriptor metadata 不得授予 content loading authority

#### Scenario: Discovery 阶段不加载 full content

- **WHEN** builtin Skill discovery 扫描并校验 `SKILL.md`
- **THEN** discovery 必须只解析 descriptor registration 所需的 manifest facts
- **AND** discovery 不得为了 prompt injection 或 execution 加载 full Skill content

### Requirement: Availability 来自可信 Source State、有效 Manifest Facts 和 Catalog Governance

Builtin Skill candidate eligibility MUST 来自 trusted source enablement 和有效 manifest-derived facts。最终 request-scope availability、conflict resolution、model visibility 和 invocation eligibility 必须继续由 Capability Catalog governance 决定。

#### Scenario: 无效 manifest 或 disabled source 阻止可执行可用性

- **WHEN** builtin Skill discovery 发现 source disabled 或 manifest facts invalid 的 candidate
- **THEN** 该 candidate 不得成为 executable available Skill capability

#### Scenario: Governance unavailable 阻止 executable availability

- **WHEN** builtin Skill discovery 接受了 manifest
- **AND** capability catalog governance 无法把 candidate 注册或解析为 available
- **THEN** 该 Skill 不得成为 executable capability
- **AND** readiness 或 health diagnostics 必须暴露安全 governance-unavailable 或 degraded outcome

### Requirement: Framework-Default Builtin Capabilities 默认由 Catalog 对每个 Agent 启用并支持禁用

首个 TS 发布版本 MUST 把必需 builtin Tools 和实际存在的有效 builtin Skills 作为 framework-default Agent capabilities。Framework-default builtin capability 的默认启用 MUST 由 Capability Catalog 基于 trusted builtin provider descriptors 计算。Agent App MUST 负责校验并传递用户显式 binding facts。首版 framework-default builtin Tool 必须至少包含 `providerId=builtin-tools`、`capabilityType=TOOL` 的 `read` capability。框架 MUST NOT 为 builtin Skills 固化单一 required business Skill identity；builtin Skill 默认候选必须来自 package-owned source 中实际发现并被 governance 接受的 descriptors。

用户可以通过 Agent binding configuration 显式禁用某个 framework-default builtin Tool 或 builtin Skill。Runtime-facing `AgentAssembly.capabilityBindings` MUST 保留该 explicit disable fact，Capability Catalog `listAvailable` / `resolve` MUST 应用该 fact，并为该 Agent 生成排除该 capability 的可见能力视图。

AgentAssembly materialization MUST 校验 binding shape、安全 id 和受支持 capability type，并把用户显式 enabled / disabled binding facts 传递给 runtime-facing assembly。Runtime-facing `AgentCapabilityBinding.enabled` MUST 是可选字段；缺省值 MUST 等价于 `enabled=true`，`enabled=false` MUST 表达显式禁用。Provider id 有效性 MUST 在 startup graph validation 阶段基于 `CapabilitySubsystem.capabilityProviders` 冻结 provider facts 校验；该校验发生在 AgentAssembly materialization 之后、ready 之前。Capability existence、availability、conflict resolution、model visibility 和 invocation eligibility MUST 由 Capability Catalog 在 `listAvailable` / `resolve` 阶段决定。

Catalog 处理 explicit binding facts 时 MUST 使用 key `providerId + capabilityType + capabilityId`。相同 key 且 `enabled=false` 的 binding MUST 排除对应默认 builtin candidate。相同 key 且 `enabled=true` 的 binding MUST 对默认 builtin candidate 去重；对非 builtin capability 则作为显式启用候选进入 catalog governance。

#### Scenario: 每个 Agent 默认获得实际受治理的 framework-default builtin capability 可见性

- **WHEN** Capability Catalog 为某个 Agent 计算 `listAvailable` 或 `resolve`
- **AND** trusted builtin Tool 或 Skill descriptors 已被 governance 接受
- **THEN** catalog 必须把 framework-default builtin Tool 和实际受治理的 builtin Skill descriptors 作为该 Agent 的默认候选
- **AND** builtin Tool candidate 必须使用 `capabilityType=TOOL`
- **AND** builtin Skill candidate 必须使用 `providerId=builtin-skills` 和 `capabilityType=SKILL`
- **AND** catalog 不得合成 source 中不存在的 required builtin Skill candidate
- **AND** 默认候选必须来自 governed descriptors

#### Scenario: 显式禁用排除默认 builtin capability

- **WHEN** Agent binding configuration 显式禁用某个 framework-default builtin Tool 或 builtin Skill
- **THEN** runtime-facing `AgentAssembly.capabilityBindings` 必须保留同 key `enabled=false` binding fact
- **AND** capability catalog `listAvailable` 和 `resolve` 必须为该 Agent 生成排除该 capability 的可见能力视图
- **AND** 该 Agent 的禁用结果必须作为 Agent-level explicit disable outcome 处理

#### Scenario: 显式启用去重默认 builtin capability

- **WHEN** Agent binding configuration 显式启用已由 catalog 默认纳入候选的同 key framework-default builtin capability
- **THEN** capability catalog governance 必须只为该 Agent 评估一次该 capability
- **AND** `listAvailable` 必须返回去重后的 capability

#### Scenario: 非默认目标的 disabled binding 保留为无效化 fact

- **WHEN** Agent binding configuration 禁用一个没有默认 builtin candidate 的 capability key
- **THEN** runtime-facing `AgentAssembly.capabilityBindings` 必须保留该 disabled binding fact
- **AND** catalog 必须把该 disabled fact 解释为 exclusion-only override
- **AND** Agent assembly 必须把该 disabled binding 作为用户显式配置 fact 传递

#### Scenario: Agent App 先传递 explicit binding facts 再做 provider ready 校验

- **WHEN** Agent App 装配 Agent assembly
- **THEN** 它必须基于 Agent definition 完成 binding shape、安全 id 和 capability type materialization
- **AND** 它必须把用户显式 enabled / disabled binding facts 传递给 runtime-facing assembly
- **AND** 缺省 `enabled` 的 runtime-facing binding 必须等价于 `enabled=true`
- **AND** provider id 有效性必须由 startup graph validation 基于 capability subsystem 返回的 frozen `capabilityProviders` 校验
- **AND** framework-default builtin capability 列表必须由 Capability Catalog 基于 governed descriptors 计算

#### Scenario: Resource inventory 和 assembly 支持 Skill binding facts

- **WHEN** resource inventory 和 assembly compilation 处理 Skill binding facts
- **THEN** 它们必须保留 `capabilityType=SKILL`
- **AND** 它们必须保留 optional `enabled` 语义，缺省等价于 `enabled=true`
- **AND** 它们不得把 builtin Skill bindings 改写为 `TOOL`
- **AND** 它们不得接受既有 capability vocabulary 之外的任意 capability type

#### Scenario: Binding 在 materialization 阶段只做 shape 和 type 检查

- **WHEN** Agent definition 包含 explicit enabled 或 disabled binding
- **THEN** AgentAssembly materialization 必须校验 binding shape、安全 `capabilityId`、受支持 `capabilityType` 和 `providerId` 格式
- **AND** `providerId` 是否存在于 trusted frozen provider facts 必须由 startup graph validation 在 capability subsystem assembly 之后校验
- **AND** Agent App 不得要求装配阶段已存在该 binding 对应的 descriptor
- **AND** descriptor existence、availability、conflict 和最终可见性必须由 Capability Catalog governance 在 `listAvailable` / `resolve` 阶段决定

### Requirement: Agent Definition Binding Compatibility 保持兼容

Agent definition parsing 和 assembly compilation MUST 保持既有 `TOOL` capability binding 兼容。本规格可以扩展 accepted Agent definition `capabilityBindings[].capabilityType` 到 `SKILL`，并且必须继续拒绝未知 capability type。Runtime-facing `AgentAssembly.capabilityBindings` MUST 保留 optional enabled / disabled binding facts，供 Capability Catalog 计算默认 builtin visibility 和显式禁用结果；缺省 `enabled` MUST 等价于 enabled binding。

#### Scenario: 既有 Tool binding 继续有效

- **WHEN** 既有 Agent definition 包含 enabled `capabilityType=TOOL` binding
- **THEN** parsing 和 assembly compilation 必须保持该 binding 行为
- **AND** 该 binding 继续按既有 provider 和 availability rules 进入 catalog governance

#### Scenario: Skill binding 被接受为受治理 Skill capability

- **WHEN** Agent definition 包含带 safe ids 的 `capabilityType=SKILL` binding
- **THEN** parsing 和 assembly compilation 必须接受该 binding shape
- **AND** parsing 和 assembly compilation 不得因装配阶段缺少该 Skill descriptor 而失败
- **AND** 最终可见性仍由 capability catalog governance 决定

#### Scenario: Disabled binding fact 被传递给 Catalog

- **WHEN** Agent definition 包含带 safe ids、registered provider id 和 `enabled=false` 的 capability binding
- **THEN** parsing 和 assembly compilation 必须接受该 disabled binding fact
- **AND** runtime-facing `AgentAssembly.capabilityBindings` 必须保留该 disabled fact
- **AND** Catalog 必须负责解释该 disabled fact 是否排除默认 builtin candidate

#### Scenario: Unknown capability type 被拒绝

- **WHEN** Agent definition 包含不属于既有 capability vocabulary 的 capability binding type
- **THEN** parsing 或 assembly compilation 必须安全拒绝
- **AND** 系统不得把该值重新解释为 custom Skill、Tool、provider type 或 source type

#### Scenario: 未注册 provider id 被拒绝

- **WHEN** Agent definition capability binding 使用未出现在 `CapabilitySubsystem.capabilityProviders` frozen provider facts 中的 `providerId`
- **THEN** startup graph validation 必须在 ready 前安全拒绝
- **AND** 系统不得把该 provider id 解释为 lazy provider、builtin provider alias 或 descriptor metadata lookup

### Requirement: Builtin Skill Provider 只通过可信 Capability Contribution 注册

`builtin-skills` provider MUST 通过可信 capability startup provider contribution 注册。`agent-capability` 必须定义 trusted provider identity，provider contribution 必须为该 provider 绑定 `BuiltinSkillDiscovery`，`createCapabilitySubsystem()` 必须把 builtin Skill eager discovery 加入 catalog startup discoveries，并通过 `CapabilitySubsystem.capabilityProviders` 暴露 `builtin-skills` provider fact，用于 resource inventory、readiness 和 binding provider id validation。

External `CapabilityProviderConfig` 必须继续拒绝 `BUNDLED` providers，并且不能新增、覆盖、禁用或替换 `builtin-skills`。任何 external provider config 只要声明 `providerId="builtin-skills"`，无论 provider kind 是否为 `BUNDLED`，都必须被 provider config normalization 安全拒绝。

#### Scenario: Startup contribution 注册 builtin skills provider

- **WHEN** product app 创建 capability subsystem
- **THEN** subsystem 必须包含 `builtin-skills` 的 trusted eager discovery
- **AND** `CapabilitySubsystem.capabilityProviders` 必须包含 `providerId="builtin-skills"` 和 `providerKind=BUNDLED`
- **AND** provider fact、discovery support 和 readiness evidence 都必须来自 trusted capability startup contribution

#### Scenario: External provider config 不能覆盖 builtin skills provider

- **WHEN** external capability provider config 声明 `providerKind=BUNDLED` 或尝试重定义 `providerId="builtin-skills"`
- **THEN** provider config normalization 必须拒绝它
- **AND** trusted builtin Skill provider identity、root 和 discovery adapter 必须保持不变

### Requirement: Builtin Skill Readiness Evidence 保持 Implementation-Local 且安全

Builtin Skill readiness 或 health diagnostics MUST 是 implementation-local startup evidence，由 `agent-capability` 和 trusted app startup/readiness composition 拥有。本规格不新增 Web API、stream event、audit schema、metric schema 或 `agent-contracts` public readiness DTO。

Readiness evidence 必须只包含 stable provider id、stable Skill identity、safe outcome code 和 sanitized message。Source/readiness outcome codes 必须与 `SkillManifestDiagnosticReasonCode` 分离；manifest validation 细节可以复用 `SkillManifestDiagnostic`。

Safe outcome code 至少覆盖：

- `BUILTIN_SKILL_SOURCE_DISABLED`
- `BUILTIN_SKILL_SOURCE_UNAVAILABLE`
- `BUILTIN_SKILL_CANDIDATE_IGNORED`
- `BUILTIN_SKILL_MANIFEST_MISSING`
- `BUILTIN_SKILL_MANIFEST_INVALID`
- `BUILTIN_SKILL_GOVERNANCE_UNAVAILABLE`
- `BUILTIN_SKILL_REGISTERED`

#### Scenario: Readiness evidence 报告安全 source 和 governance outcome

- **WHEN** builtin Skill source disabled、unavailable、missing required Skill、manifest-invalid、governance-unavailable 或 successfully registered
- **THEN** implementation-local readiness evidence 必须暴露对应 safe outcome code
- **AND** evidence 不需要新的 public contract 或 client-facing event

#### Scenario: Successful readiness 需要 governed registration

- **WHEN** builtin Skill discovery 发现有效 required Skill manifest
- **AND** capability catalog governance 无法把 stable identity 注册或解析为 available
- **THEN** readiness evidence 不得报告该 Skill successfully registered
- **AND** evidence 必须报告安全 governance-unavailable 或 degraded outcome

#### Scenario: Readiness evidence 不泄露敏感或 provider-private 事实

- **WHEN** 系统输出 builtin Skill readiness evidence
- **THEN** evidence 不得包含 raw local path、resource URI、package layout、raw manifest content、raw Skill body、descriptor metadata、source-owned loading key、credential、provider-private config、model input/output 或 client input

### Requirement: 本规格复用 Public Capability Descriptor 和 Invocation Contracts

本规格 MUST 复用现有 `CapabilityProvider`、`CapabilityDescriptor`、`SkillMetadata`、`SkillManifestDiagnostic`、`CapabilityCatalog` 和 `CapabilityInvocationPort` surface。为支持 Catalog 默认注入 builtin capability 后应用用户禁用，`AgentAssembly.capabilityBindings` MUST 支持 optional `enabled` binding fact。Source-owned implementation facts 必须保留在 `agent-capability` 或可信 app composition 实现边界内。

#### Scenario: Builtin Skill source 使用现有 public capability surface

- **WHEN** builtin Skill source implementation 被加入
- **THEN** public capability descriptor、catalog 和 invocation contracts 必须保持现有 shape
- **AND** source-owned implementation facts 必须留在 `agent-contracts` 之外

### Requirement: 本规格覆盖 Discovery、Catalog 默认注入和 Explicit Disable，不定义 Skill Execution

本规格 MUST 只定义 builtin Skill discovery、validation、catalog registration、catalog default builtin injection 和 explicit disable application。Skill inline execution、fork execution、progressive disclosure、nested invocation、audit、idempotency、sandbox behavior 和 remote SkillHub protocol behavior 由后续对应规格定义。

#### Scenario: Builtin Skill source 不定义 execution semantics

- **WHEN** builtin Skill discovery 暴露 builtin Skill capability
- **THEN** capability entry 必须保持为 discovery、catalog registration、catalog default injection 和 explicit disable 语义
- **AND** execution semantics 必须由 capability execution 和 governance 相关规格定义

### Requirement: Builtin Skill Diagnostics 安全可解释

Builtin Skill source diagnostics MUST 解释 source disabled、candidate ignored、missing manifest、invalid manifest、unavailable after governance 和 successful registration outcome，并保持输出安全。Diagnostics MUST 按实际发现的 candidate 和治理结果产生，不得要求或合成某个固定 business Skill identity 的 readiness outcome。

#### Scenario: Invalid builtin Skill 报告安全 diagnostic

- **WHEN** builtin Skill discovery 因 manifest invalid 拒绝 candidate
- **THEN** 系统必须暴露安全 diagnostic reason
- **AND** diagnostic 不得包含 raw manifest content、local filesystem path、secret 或 provider-private data

#### Scenario: Successful builtin Skill 报告安全 readiness evidence

- **WHEN** builtin Skill discovery 成功注册一个实际存在的有效 builtin Skill candidate
- **THEN** readiness 或 health diagnostics 必须为该 Skill identity 暴露安全 successful-registration outcome
- **AND** outcome 不得包含 raw manifest content、local filesystem path、package layout、source-owned loading key 或 provider-private data

#### Scenario: 空 builtin Skill source 不合成 required identity failure

- **WHEN** trusted builtin Skill source 可读取但不包含任何有效 candidate
- **THEN** discovery 必须返回空 descriptor 集合
- **AND** diagnostics 不得合成固定 business Skill identity 的 missing、governance-unavailable 或 registered outcome

### Requirement: 默认源码和发布包不得提供 telecom-domain-qa

框架默认源码、构建产物和本地运行发布包 MUST NOT 包含 `telecom-domain-qa` Skill。Capability Catalog MUST NOT 因 framework-default builtin source 自动披露或解析该 capability identity。若部署方仍需要同名业务能力，必须通过受治理的非预制 Skill source 显式提供。

#### Scenario: 默认 builtin discovery 不再发现 telecom-domain-qa

- **WHEN** builtin Skill discovery 扫描框架 package-owned resource root
- **THEN** discovery 结果不得包含 `capabilityId=telecom-domain-qa`
- **AND** Capability Catalog 的默认可见集合不得包含来自 `providerId=builtin-skills` 的 `telecom-domain-qa`

#### Scenario: 本地运行发布包不预装 telecom-domain-qa

- **WHEN** 系统生成包含后端的本地运行发布包
- **THEN** archive 中不得包含 `skills/telecom-domain-qa`
- **AND** packaged `@nextagent/agent-capability` builtin resource 中不得包含 `telecom-domain-qa`
- **AND** archive 仍必须包含其他当前受支持的 builtin Skill resources
