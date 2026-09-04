## ADDED Requirements

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

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Alpha 包含可发现的 Framework-Default 电信 Builtin Skill Candidate

**Reason**：框架不再把 `telecom-domain-qa` 固化为所有 Agent 必需的默认业务能力；该默认注入会影响不需要该能力的业务 Agent。

**Migration**：需要同名能力的部署方必须通过 system-local、Agent-owned、SkillHub 或其他受治理的非预制 Skill source 提供，并在需要时通过 Agent capability binding 显式启用。
