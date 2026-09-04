## 背景和现状

Builtin Skill source 是首版 TS Agent 的能力来源之一。它需要向统一 capability governance 提供可信、可诊断、可默认启用、可由用户显式禁用的 Skill descriptor 输入，同时保持 Owner 10 和 Owner 9 的职责边界清晰：

1. Owner 10 负责 builtin source、package-owned resource root、manifest facts、source enablement 和 source-local readiness evidence。
2. Owner 9 负责 Capability Catalog governance、framework-default builtin injection、explicit binding / disable application、availability、conflict resolution、model visibility 和 invocation eligibility。
3. `agent-app` 作为唯一 composition root，负责可信 provider registration、Agent definition binding validation 和 runtime-facing assembly fact 传递；builtin 默认 capability 的权威事实位于 Catalog governed descriptors。

当前 TS 代码已有可复用基线：

1. `packages/agent-capability/src/skills/skill-manifest.ts` 提供统一 `SKILL.md` frontmatter parser、descriptor mapper、typed metadata accessor 和 safe diagnostic 生成。
2. `packages/agent-capability/src/discovery/discovery.ts` 定义 `CapabilityDiscoveryFactory`，当前已有 trusted BUNDLED provider 的 discovery 创建路径。
3. `packages/agent-capability/src/catalog/catalog.ts` 已拥有 Agent binding gate、availability filter、conflict resolver 和 `listAvailable` / `resolve` 一致治理。
4. `packages/agent-capability/src/subsystem.ts` 负责创建可信 BUNDLED discovery，并把 eager discovery 注入 catalog。
5. `packages/agent-app/src/assembly/resource-inventory.ts`、`agent-assembly-compiler.ts`、`default-agent-assembly.ts` 和 `resource-provider-registry.ts` 已处理 capability binding、resource inventory 和 startup provider facts。

本 design 以这些既有入口为增量实施路径，避免为单一 builtin Skill source 引入新的通用 source 框架。

当前基线中的 `AgentAssembly.capabilityBindings` 只表达 enabled bindings，`AgentCapabilityBinding` 只有 `capabilityId`、`capabilityType` 和 `providerId`。本 change 的 Catalog 默认注入方案需要把用户显式禁用传递给 Catalog，因此唯一 public contract refinement 是 `agent-contracts/agent-assembly` 中 existing `AgentCapabilityBinding` 增加 optional `enabled` fact，语义为缺省或 `enabled=true` 表示显式启用、`enabled=false` 表示显式禁用。Capability descriptor、catalog request/response、invocation request/result 和 readiness public contract 保持现有 shape。

## 目标状态

完成后，系统具备以下目标状态：

1. `agent-capability` 拥有 `builtinSkillsProvider = { providerId: "builtin-skills", providerKind: "BUNDLED" }`。
2. `agent-capability` 拥有 package-owned builtin Skill resource root，root 下一级目录中的 `SKILL.md` 形成 builtin Skill candidate。
3. `agent-capability` 在 builtin Skill root 下打包首版 framework-default builtin Skill `telecom-domain-qa/SKILL.md`，manifest `name` 必须为 `telecom-domain-qa`。
4. `BuiltinSkillDiscovery` 实现现有 `CapabilityDiscovery`，负责枚举 candidate、复用标准 manifest parser/mapper、产出 descriptor candidates、safe diagnostics、readiness evidence 和 source-owned internal loading facts。
5. `DefaultCapabilityDiscoveryFactory` 只在 trusted `builtin-skills + BUNDLED + EAGER` provider 输入下创建 `BuiltinSkillDiscovery`。
6. `createCapabilitySubsystem()` 默认创建 builtin Skill eager discovery，并与 builtin Tool discovery 一起注入 `StaticCapabilityCatalog`。
7. `agent-app` startup resource provider registry 注册 `builtin-skills`，resource inventory 和 assembly validation 支持 `SKILL` binding，并校验 binding 的 provider id 来自可信注册 provider。
8. Agent assembly compiler 保留用户 Agent definition 中的显式 enabled / disabled binding facts；默认 builtin Tool / Skill 可见性由 Catalog 计算。
9. Capability Catalog 继续通过现有 Agent binding gate、availability filter 和 conflict resolver，基于 governed descriptors、framework-default builtin rules 和 runtime-facing `AgentAssembly.capabilityBindings` 中的 explicit binding facts 决定 request-scope 可见能力。
10. Framework-default builtin Tools 和 builtin Skills 默认对每个 Agent 可见，首版 required builtin Skill stable identity 是 `telecom-domain-qa`，除非 Agent assembly 中存在同 key `enabled=false` explicit disable。
11. Readiness evidence 留在 implementation-local startup/readiness 边界，用安全 outcome code 表达 source 和 governance 状态。

## 核心设计

### D1：Provider Identity

Builtin Skill source 使用固定 provider identity：

1. `providerId="builtin-skills"`
2. `providerKind=BUNDLED`

这个 identity 由 `agent-capability` 可信代码定义，并作为 discovery、catalog、resource inventory、explicit binding / disable 和 readiness evidence 的共同稳定坐标。

### D2：Builtin Skill Root

Builtin Skill root 是 `agent-capability` package-owned bundled resource root。Authoring layout 使用框架包内结构，例如：

```text
packages/agent-capability/src/builtins/skills/<skill>/SKILL.md
```

运行时实际 dist layout、物理路径和资源 URI 都属于 provider-private implementation fact。Discovery 只把 root 下一级含 `SKILL.md` 的目录视为 candidate，隐藏目录作为占位或内部材料忽略，嵌套目录关系不在本 change 中建模为 Skill 层级。

首版 required framework-default builtin Skill 使用以下 authoring layout：

```text
packages/agent-capability/src/builtins/skills/telecom-domain-qa/SKILL.md
```

该 Skill 的稳定 manifest identity 必须是 `name: telecom-domain-qa`。它作为电信领域问答与诊断意图澄清的默认能力 identity 被发现、治理、默认注入和 readiness 检查；本 change 不定义它的知识内容、prompt 内容、模型行为或执行语义。

### D3：Discovery Owner

`BuiltinSkillDiscovery` 是唯一 builtin Skill discovery adapter。它位于 `agent-capability`，实现现有 `CapabilityDiscovery`，使用 `discoveryMode=EAGER`。

`BuiltinSkillDiscovery` 负责：

1. 读取可信 source enablement。
2. 枚举 package-owned root 下的一级 candidate。
3. 过滤隐藏目录和非 Skill candidate。
4. 读取 candidate 的 `SKILL.md` manifest facts。
5. 调用 `parseSkillFrontmatter` 和 `mapSkillFrontmatterToDescriptor`。
6. 产出 manifest-derived descriptor facts、safe diagnostics、source/readiness outcomes 和 source-owned internal loading facts。

### D4：Manifest Reuse

Builtin Skill 使用 `add-ts-skill-manifest-contract` 定义的标准 `SKILL.md` manifest facts。Descriptor、metadata 和 manifest diagnostics 复用现有 parser/mapper 行为。Builtin source 只把 manifest-derived facts 交给 governance，不建立第二套 builtin-only manifest schema。

### D5：Catalog Governance

Builtin Skill source 输出的是 candidate/source facts，不是最终可执行事实。最终 `AVAILABLE`、`DISABLED`、`UNAVAILABLE`、conflict resolution、model visibility 和 invocation eligibility 仍由 Capability Catalog governance 决定。

Catalog `listAvailable` / `resolve` 的 request-scope view 继续同时考虑：

1. 受治理 descriptor。
2. Framework-default builtin capability rule。
3. runtime-facing `AgentAssembly.capabilityBindings` 中的 explicit enable / disable facts。
4. Availability filter。
5. Conflict resolver。
6. Provider identity 和 capability kind。

Catalog 不负责读取 Agent definition，也不扫描 builtin source root。Catalog 消费 governed descriptors 和 runtime-facing assembly facts，并在统一治理阶段完成：

1. 将 trusted builtin providers 发现出的 builtin Tool / Skill descriptors 默认纳入每个 Agent 的候选集。
2. 将非 builtin explicit enabled bindings 作为需要按 provider discovery / availability 解析的候选。
3. 应用同 key `enabled=false` explicit disable，从该 Agent 的候选集中排除对应 capability。
4. 对同 key `enabled=true` explicit binding 去重，避免重复评估默认 builtin capability。
5. 执行 availability filtering、provider conflict resolution、model visibility 和 invocation eligibility 判断。

### D6：Framework-Default Builtin Injection

Framework-default builtin capabilities 是每个 Agent 默认拥有的基线能力，包括首版默认 builtin Tools 和 builtin Skills。默认启用规则由 Capability Catalog 基于 trusted builtin provider descriptors 实现。

Agent App 不需要 builtin capability 清单，也不需要为默认 builtin capability 生成 synthetic bindings。唯一的 builtin capability source of truth 是：

1. `builtin-tools` / `builtin-skills` provider identity。
2. 这些 provider 通过 trusted discovery 产出的 governed descriptors。
3. Readiness 对 required framework-default builtin identities 的安全检查结果；首版 required builtin Skill identity 固定为 `telecom-domain-qa`。

Catalog 的默认 builtin 处理流程固定为：

1. 从 eager governed descriptors 中选择 trusted builtin provider 的 Tool / Skill descriptors。
2. 将这些 descriptors 作为每个 Agent 的默认候选。
3. 读取 Agent assembly 的 explicit binding facts。
4. 使用 `providerId + capabilityType + capabilityId` 作为 override key。
5. 同 key `enabled=false` 排除默认候选。
6. 同 key `enabled=true` 对默认候选去重；对非 builtin capability 作为显式启用候选。
7. 对不存在 descriptor 的 explicit binding 不在 assembly 阶段失败，由 catalog 在 `listAvailable` / `resolve` 阶段返回不可见或 unavailable 结果。

Agent App 装配阶段的 binding validation 范围固定如下：

1. 对用户 Agent definition 中的 explicit bindings 做 shape 校验、安全 id 校验和 `capabilityType=TOOL | SKILL` 校验。
2. 校验 `providerId` 格式安全，并且必须匹配可信 startup resource provider registry 中已注册 provider。
3. 保持 reserved builtin provider id 只能来自 framework trusted registration；external provider config 不能注册或覆盖 `builtin-tools` / `builtin-skills`。
4. 保留 explicit `enabled=true` 和 `enabled=false` facts 到 runtime-facing `AgentAssembly.capabilityBindings`。
5. 不做 capability descriptor existence 校验，不要求装配阶段已获取 builtin 或 non-builtin 的 capability 清单，也不因 catalog 尚未发现 descriptor 而让 Agent assembly 编译失败。
6. Capability existence、availability、provider conflict、model visibility 和 invocation eligibility 由 Capability Catalog 在 request-scope `listAvailable` / `resolve` 阶段根据当前 governed descriptors 和 runtime-facing assembly 决定。

### D7：Agent Definition Compatibility

Agent definition parsing 和 assembly compilation 扩展接受 `capabilityType=SKILL`。既有 `capabilityType=TOOL` binding 行为保持兼容。未知 capability type 继续由 parser/compiler 安全拒绝。

Runtime-facing `AgentAssembly.capabilityBindings` 必须保留 explicit binding 的 optional `enabled` 语义。`enabled` 缺省或 `enabled=true` 表示显式请求该 capability 进入 catalog 治理；`enabled=false` 表示显式禁用同 key 默认 builtin capability 或对非默认 capability 的无效化 override。Catalog 必须解释该字段，Agent App 不得把 disabled facts 在装配阶段丢弃。

`default-agent-assembly` 也需要跟随同一语义：默认 Agent 不通过硬编码 `builtin-tools/read` binding 获得 framework-default builtin Tool 可见性；Catalog 的 default builtin injection 是默认可见性的来源。默认 Agent 只在需要表达用户或产品显式 enable/disable 时携带 capability binding facts。

`ResourceInventoryCapability` 和 assembly validation 使用既有 capability vocabulary，保持 Tool / Skill / Agent 的 canonical capability kind，不把 Skill binding 改写成 Tool。

`ResourceInventoryCapability` 只能作为 startup resource inventory 的安全投影输入，不能被用来要求 Agent App 在装配阶段拥有全量 capability 清单。Agent App 不从 catalog、discovery、builtin source 或 descriptor metadata 推导 capability existence。

### D8：Source Enablement

Builtin Tool provider 和 builtin Skill source 默认 enabled。可信 product/test composition 可以禁用整个 provider/source，用于产品裁剪、故障注入或测试。Source disabled 时，discovery 产出安全 disabled outcome，catalog 不获得对应 executable builtin capability entry。

用户配置不能关闭 builtin provider/source。Agent 级禁用由 explicit binding disable fact 表达，作用于具体 framework-default builtin Tool 或 builtin Skill，不改变 source root、provider identity 或全局 source enablement。

### D9：Provider Registration

Provider 注册链使用显式可信 composition：

1. `agent-capability` 定义 `builtinSkillsProvider` 常量。
2. `DefaultCapabilityDiscoveryFactory` 为 `builtin-skills + BUNDLED + EAGER` 创建 `BuiltinSkillDiscovery`。
3. `createCapabilitySubsystem()` 创建 builtin Skill eager discovery 并注入 `StaticCapabilityCatalog`。
4. `agent-app` startup resource provider registry 注册 `builtin-skills` provider registration，用于 resource inventory、readiness 和 binding provider id validation。

外部 `CapabilityProviderConfig` 继续按现有规则拒绝 `BUNDLED` provider，并且 provider config normalization 必须把 `builtin-skills` 作为 reserved provider id。任何 external provider config 使用 `providerId="builtin-skills"` 都应安全拒绝，避免通过非 BUNDLED provider kind 覆盖可信 builtin provider identity。

### D10：Readiness Evidence

Readiness evidence 是 implementation-local startup evidence，由 `agent-capability` 产生 source/manifest/governance safe outcomes，由 `agent-app` startup/readiness boundary 聚合或测试读取。

Evidence 只包含：

1. Stable provider id。
2. Stable Skill identity。
3. Safe outcome code。
4. Sanitized message。

Outcome code 至少覆盖：

1. `BUILTIN_SKILL_SOURCE_DISABLED`
2. `BUILTIN_SKILL_SOURCE_UNAVAILABLE`
3. `BUILTIN_SKILL_CANDIDATE_IGNORED`
4. `BUILTIN_SKILL_MANIFEST_MISSING`
5. `BUILTIN_SKILL_MANIFEST_INVALID`
6. `BUILTIN_SKILL_GOVERNANCE_UNAVAILABLE`
7. `BUILTIN_SKILL_REGISTERED`

Successful readiness 需要 `telecom-domain-qa` discovery accepted，并且 catalog governance 能按 stable identity 解析为 governed available/degraded result。仅发现 manifest 不构成 fully ready。

### D11：Content Loading Handoff

Builtin source 可以保存后续 inline/fork execution 所需的 source-owned internal loading facts。该 facts 只在授权后的 provider-owned loader / invocation handler 边界内消费。本 change 不把 loading key、full Skill body 或 content loading authority 放入 public descriptor、metadata、model context、stream、audit、metric、diagnostic、safe error 或客户端输入。

## 主流程

1. `agent-capability` 提供 `builtinSkillsProvider`。
2. Product app 创建 capability subsystem。
3. `DefaultCapabilityDiscoveryFactory` 创建 `BuiltinSkillDiscovery`。
4. `BuiltinSkillDiscovery` 检查 trusted source enablement。
5. Source enabled 时，discovery 从 package-owned root 枚举一级 candidate。
6. Discovery 对每个 candidate 读取 `SKILL.md` 并复用标准 parser/mapper。
7. Accepted manifest facts 进入 Capability Catalog governance。
8. Catalog 产生 governed descriptor、availability 和 conflict outcome。
9. `agent-app` 编译 Agent definition 时校验 capability binding shape、safe id、supported type 和 registered provider id，并保留 explicit enabled / disabled binding facts。
10. Catalog `listAvailable` / `resolve` 将 trusted builtin provider descriptors 默认纳入候选，应用 Agent assembly explicit disable，然后按 governance 结果返回 request-scope 可见 Skill。
11. Startup/readiness boundary 输出安全 evidence。

## 失败与降级

1. Trusted source disabled：系统输出 safe disabled outcome，catalog 不注册 executable builtin Skill。
2. Builtin Skill root 缺失或无法解析：系统输出 source unavailable outcome，并保持 path/resource URI 不外露。
3. Candidate 缺失 `SKILL.md`：系统输出 missing manifest outcome，该 candidate 不进入 executable catalog。
4. Manifest rejected：系统复用 Skill manifest diagnostics，并输出 safe invalid manifest outcome。
5. Governance unavailable：discovery accepted 但 catalog 无法解析为可用结果时，readiness 输出 governance unavailable/degraded outcome。
6. 用户显式禁用默认 builtin Skill：该 Agent 的 runtime-facing assembly 保留 disabled binding fact，Catalog 对该 Agent 不返回该 capability，readiness 不把它报告为 source failure。
7. Required builtin Skill descriptor 缺失或 governance 后不可用：readiness 按 stable identity 输出 missing 或 governance unavailable outcome，Agent assembly 不因此失败。
8. Agent definition 中 unknown capability type：parser/compiler 安全拒绝。
9. Agent definition 中 provider id 未注册或尝试冒用 reserved builtin provider id：parser/compiler 安全拒绝。
10. explicit binding 在装配阶段没有匹配 descriptor：assembly 只要 binding shape、id 和 provider 有效即可编译；catalog 在 `listAvailable` / `resolve` 阶段按 governed descriptors 返回不可见或 unavailable 结果。

## 实施简化

首版实施保持显式、窄作用域：

1. `builtinSkillsProvider` 和首版 packaged Skill stable identity `telecom-domain-qa` 可以是 `agent-capability` 内显式常量。
2. `createCapabilitySubsystem()` 可以显式创建 builtin Tool discovery 和 builtin Skill discovery 两个 eager discoveries。
3. `BuiltinSkillDiscovery` 只实现现有 `CapabilityDiscovery.listAll()`；首版不需要 search、refresh 或 background watcher。
4. Readiness evidence 可以是 discovery/subsystem 内 implementation-local result 或测试可观察对象。
5. Catalog 对 explicit binding facts 使用局部 `Map`，key 固定为 `providerId + capabilityType + capabilityId`。
6. `ResourceInventoryCapability` 复用既有 capability vocabulary / descriptor kind。

## 边界约束

本 change 保持以下边界：

1. 不新增通用 `SkillSource`、`SourceRegistry`、`ProviderRegistry`、`ReadinessService`、plugin-like manifest 或 source framework。
2. 不修改 `agent-contracts/capability` public DTO/schema、Capability Catalog request/response、Capability invocation request/result 或 public readiness DTO/schema；`agent-contracts/agent-assembly` 的 binding fact refinement 是本 change 的唯一 public contract refinement。
3. 不新增 builtin-only provider kind。
4. 不让 Agent package、workspace config、客户端输入、模型输出、manifest metadata、descriptor metadata 或外部 provider config 控制 builtin root、provider identity 或 source enablement。
5. 不让 Agent assembly、context engine、Agent loop 或 runtime/core 直接扫描 builtin source、读取 `SKILL.md` 或消费 source-owned loading key。
6. 不把 raw path、resource URI、package layout、raw manifest body、full Skill content、loading key、content loading authority、secret 或 provider-private config 暴露到 descriptor、metadata、model context、stream、audit、metric、diagnostic、safe error 或日志。
7. 不定义 Skill inline/fork execution、nested invocation、progressive disclosure、sandbox、audit、idempotency、SkillHub 或模型调用策略。

## 验证映射

1. Provider identity：验证 `builtin-skills + BUNDLED` 稳定 identity，且 public provider kind vocabulary 未扩展。
2. Root boundary：验证 package-owned root 形成 candidate，外部配置和用户输入无法替换 root。
3. Discovery adapter：验证 factory exact-match 创建 `BuiltinSkillDiscovery`，非匹配 provider 不触发 fallback 或 order-based selection。
4. Manifest reuse：验证 builtin `SKILL.md` 使用标准 parser/mapper，非法 manifest 复用现有 diagnostic 语义。
5. Descriptor safety：验证 descriptor 和 metadata 不包含 root/path/resource URI/raw manifest/full body/loading key。
6. Catalog governance：验证 builtin Skill 只能通过 `CapabilityCatalog.listAvailable` / `resolve` 进入可见结果，且 catalog 基于 governed descriptors、framework-default builtin rules 和 runtime-facing explicit binding facts 计算可见能力，不读取 Agent definition。
7. Default builtin visibility：验证每个 Agent 默认在 catalog 可见视图中获得 framework-default builtin Skill `telecom-domain-qa`。
8. Explicit disable：验证同 key `enabled=false` 使 catalog 不再返回该 Skill，且不影响 source readiness。
9. Binding validation：验证 Agent App 只做 shape/safe id/type/registered provider id 校验，存在性由 catalog 判断。
10. Compatibility：验证既有 Tool binding 兼容，Skill binding 被接受，unknown capability type rejected。
11. Provider registration：验证 provider constant、factory branch、subsystem eager discovery 和 app resource provider registry 全链路注册。
12. Readiness：验证 `telecom-domain-qa` 的 disabled、ignored、missing manifest、invalid manifest、governance unavailable 和 successful registration 都有安全 evidence。
13. Architecture：验证无 public contract expansion、无 generic source/readiness framework、无 runtime/core routing shortcut、无 Agent assembly source scanning。
14. OpenSpec：执行 `openspec validate add-ts-builtin-skill-source --strict`。

## 开放问题

无。当前 change 的目标口径固定为：trusted package-owned builtin source、standard manifest facts、catalog default builtin injection、explicit binding / disable facts、unified capability governance、implementation-local readiness evidence。
