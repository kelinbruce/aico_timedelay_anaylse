## 背景和现状（Context）

当前稳定基线已经提供了本 change 可以复用的几条边界：

- `CapabilityProviderKind` 已包含 `LOCAL_DIRECTORY`。
- `CapabilityDiscoveryMode` 已包含 `EAGER` 和 `SEARCH`。
- `capability-source-configuration` 定义了启动期 source configuration validation 和 frozen snapshot，但不定义具体 local Skill discovery。
- `skill-manifest-contract` 定义了 `SKILL.md` frontmatter 到 `CapabilityDescriptor` / `SkillMetadata` / diagnostics 的统一 parser 和 mapper。
- `add-ts-builtin-skill-source` 定义了 builtin Skill 如何作为 trusted source 进入 Catalog governance，并把默认可见性放在 Catalog 而不是 Agent assembly。
- `add-ts-agent-package-assembly` 定义了 Agent package root、`agent.yaml` 和 `skills/` 等 candidate inputs 的编译边界，但当前实现还没有稳定的 `configRoot/agents/{agentId}` locator。
- `add-ts-capability-conflict-resolution` 定义了冲突检测在 catalog registration 前执行，并且冲突检测只消费 assembled descriptor candidates 和 safe source facts。

本 change 要补齐的是具体本地 Skill source：系统级 `skills/` 目录和 `configRoot/agents/{agentId}/skills` 目录如何被发现、校验、进入 Catalog，并按 Agent scope 形成可用 Skill 清单。关键修正是：Agent-owned Skill root 不能从 `AgentAssembly.workspaceDir` 推导；`workspaceDir` 是执行 workspace / provider execution root，Agent package root 必须由 trusted `configRoot` / package source locator 承载。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 支持可信 app composition 指定 system-level local `skills/` root，并以 `EAGER` 模式启动加载。
- 明确 frozen runtime paths 中的 `configRoot` 与 `workspaceRoot`。
- `configRoot` 承载用户 `application.yaml`、system-level local `skills/` 和 `agents/{agentId}` Agent package。
- `workspaceRoot` 承载 Agent execution workspace、SQLite、logs 和运行数据。
- `systemSkillsRoot` 派生为 `configRoot/skills`，用于定位 system-level local Skill root。
- `agentsRoot` 派生为 `configRoot/agents`，用于定位 `configRoot/agents/{agentId}` Agent package root。
- 支持 `configRoot/agents/{agentId}/skills` 作为 Agent-owned local Skill source，并以 `SEARCH` 模式按当前 Agent request scope 加载。
- 两类 source 都复用标准 `SKILL.md` manifest parser/mapper。
- 两类 source 都自动进入对应 Agent 的 Catalog request-scope 可见 Skill 候选，不要求 explicit binding。
- Catalog 不把 bindings 传给 discovery；bindings 只由 Catalog 用于显式 enable/disable、过滤和治理。
- 对同一 Agent，Agent-owned local Skill 优先于 system-level local Skill。
- 保持 builtin capability 最高优先级，不允许 local Skill 覆盖 builtin。
- 保存后续授权 Skill execution 可用的 source-owned loading facts，但不把 raw path、full body 或 loading key 放入 public surface。

**非目标：**

- 不定义 inline/fork Skill execution、Skill body loading 的执行语义或 prompt 注入语义。
- 不定义 SkillHub、remote install、managed cache、checksum 或 trust workflow。
- 不定义 sandbox runtime、audit schema、stream event、Web API 或 routing policy。
- 不引入通用 `SkillSourceRegistry` / plugin framework / background watcher。
- 不支持 hot reload 或 filesystem watcher；Agent-owned SEARCH 可以在 request-scope view 构造时加载，但不由 runtime/core/context 直接扫描。
- 不改变 `BUNDLED` builtin priority。

## 设计决策（Decisions）

### D1: Hybrid discovery：system EAGER，Agent-owned SEARCH

唯一实现路径是在 `agent-capability` 内新增一个 `LocalSkillDiscovery` adapter，可按 provider instance 配置为两种模式：

1. `local-skills-system + LOCAL_DIRECTORY + EAGER`
   - root 来自 app-owned `configRoot/skills` 经启动校验后合成的 trusted runtime source fact。
   - startup / capability discovery baseline 阶段扫描并注册 descriptors。
   - 产出的 descriptors 对所有 Agent 作为 request-scope 默认候选。
   - provider identity 为 reserved trusted id，只能由 app composition / resource provider registry 注册。

2. `local-skills-agent-owned + LOCAL_DIRECTORY + SEARCH`
   - 不绑定某个具体 Agent root。
   - Catalog 在 `listAvailable` / `resolve` 构造 request-scope view 时，以 trusted Agent search scope 调用 discovery。
   - discovery 通过 Agent package source locator 定位 `configRoot/agents/{agentId}/skills`，只返回当前 Agent 的 candidates。
   - provider identity 为 reserved trusted id，只能由 app composition / resource provider registry 注册。

`local-skills-system` 和 `local-skills-agent-owned` 是 reserved provider id。外部 `CapabilityProviderConfig`、source configuration、Agent package 或 manifest metadata 不得声明、覆盖、禁用或劫持这两个 provider id；resource provider registry 必须在注册阶段拒绝冲突，并记录 safe diagnostic。这样可以避免用户配置把 trusted local source provider 替换成任意目录解释器。

`builtin-tools` 和 `builtin-skills` 同样不是 `default-system.yaml` 用户配置项。它们作为 framework trusted provider identity 由 app composition 的 startup resource provider registry 注册。`default-system.yaml` 不得通过 `capabilityProviders.providers=[builtin-tools]` 之类占位字段来满足 readiness；是否存在 framework builtin provider 是 app composition 事实，不是用户 raw config 事实。

`LOCAL_DIRECTORY` 在本阶段不是用户配置型 provider kind。它只服务本 change 定义的本地 Skill source：system-level local Skill 由 `configRoot/skills` 派生，Agent-owned local Skill 由 trusted Agent package source locator 配置。`adnclaw.system.capability-providers` 不得接受 `type=local-directory`；用户配置中出现该 type 必须作为 `UNSUPPORTED_PROVIDER_TYPE` 处理，不得生成外部 `LOCAL_DIRECTORY` provider。

System-level local Skill root 的唯一承载是 `configRoot/skills` 派生事实，而不是用户声明的 provider entry：

1. 用户/部署配置提供 `application.yaml` 覆盖层；`configRoot` 来自该文件所在目录，未提供用户配置时沿用当前启动 base dir 作为兼容默认。
2. `workspaceRoot` 来自合成后的 `paths.workspaceRoot`，只表达运行根。
3. `paths.systemSkillsRoot`、`paths.agentsRoot` 和 `paths.sqliteFile` 不作为用户配置入口；三者分别派生为 `configRoot/skills`、`configRoot/agents` 和 `workspaceRoot/data/system/nextagent.sqlite`。
4. `agent-app` 在启动期解析、校验、冻结该 path；若 resolved root 不存在、不可读或没有有效一级 Skill candidate，`local-skills-system` 产生 safe unavailable / empty candidate outcome。
5. app composition 以 trusted code 合成 reserved runtime source fact：`providerId=local-skills-system`、`providerKind=LOCAL_DIRECTORY`、`discoveryMode=EAGER`、`directoryRef=<validated configRoot/skills>`。
6. `agent-capability` 的 `LocalSkillDiscovery` 只消费合成后的 source fact，不读取 raw app config，不允许外部 `CapabilityProviderConfig` 使用 `local-skills-system` provider id。

因此，`CapabilityProviderConfig.options.directoryRef` 可以作为合成后传入 discovery factory 的 runtime input，但不是外部 raw config 对 reserved provider identity 的声明权。

放弃方案：

- 启动时扫描所有 Agent-owned `skills/`：会让启动成本随 Agent 数量增长，也容易把不同 Agent 的同名 Skill 放进全局冲突域。
- 每个 Agent 一个 provider instance：provider identity 会被 Agent 实例数量放大，resource inventory、diagnostics 和 config 会变复杂；首版差异只需要通过 trusted search scope 表达。
- 使用 `workspaceDir/skills`：混淆执行 workspace 和 Agent package/config root。

### D2: configRoot、workspaceRoot 和 AgentPackageSourceLocator 由 agent-app 拥有

`configRoot` 和 `workspaceRoot` 是 app config / app composition 的可信 frozen roots。`default-system.yaml` 提供内置默认 system config；用户 `application.yaml` 是覆盖层，覆盖后生成最终 `DefaultSystemConfig`。`configRoot` 来自 `application.yaml` 所在目录，未提供用户配置时使用启动 base dir；`workspaceRoot` 来自最终 `paths.workspaceRoot`。`agent-app` 或 Agent package assembly 边界提供 `AgentPackageSourceLocator`（或等价实现）：

```text
locate(agentId, agentVersion) -> { status: "found", agentPackageRoot } | { status: "not-configured" | "not-found" | "unavailable", safeCode }
```

首版默认定位规则：

```text
agentPackageRoot = resolve(configRoot, "agents", agentId)
agentOwnedSkillRoot = resolve(agentPackageRoot, "skills")
```

`LocalSkillDiscovery` 不直接读取 raw app config，不解释 `configRoot` 或 `agentsRoot`，只通过 locator 获取 trusted package root。客户端请求、模型输出、Skill manifest metadata、descriptor metadata、runtime command 或 capability arguments 不得覆盖 `configRoot`、`workspaceRoot`、`agentsRoot` 或 package root。

用户 AgentDefinition 入口是 `configRoot/agents/{agentId}/agent.yaml`。存在该文件时，它替换对应 AgentDefinition；不存在时，只有 `default-agent` 可以回退到内置 `default-agent.yaml`。非 default active Agent 缺失用户 AgentDefinition 必须 fail closed。

兼容规则：

- 对采用 `configRoot/agents/{agentId}` package 布局的 Agent，locator `found` 后才允许扫描 `agentPackageRoot/skills`。
- 对当前仍由 built-in default assembly registry 提供、且没有 `configRoot/agents/{agentId}` package root 的 Agent，locator 返回 `not-configured` / `not-found`，Agent-owned SEARCH 返回空候选集和安全 diagnostic；不得阻塞该 Agent 的既有请求路径。
- `agentPackageRoot` 存在但 `skills/` 不存在时，Agent-owned SEARCH 返回空候选集和安全 missing/unavailable evidence；这表示该 Agent 没有 Agent-owned local Skill，不表示 assembly 失败。
- 任何情况下都不得回退扫描 `AgentAssembly.workspaceDir/skills`。

### D3: Discovery criteria 不包含 bindings

Discovery 只负责发现 candidate descriptors，不负责可用性、binding、显式禁用、优先级或冲突。Agent-owned SEARCH criteria 固定为 trusted scope：

- `tenantId`
- `subjectId`
- `agentId`
- `agentVersion`
- `agentAssemblyRef`
- `requestedCapabilityId?`（仅用于 `resolve` 窄化扫描/过滤）

criteria 不得包含 `AgentAssembly`、`capabilityBindings`、`boundCapabilityIds`、routing policy、availability verdict 或 conflict result。Catalog 在 discovery 返回 candidates 之后再应用 explicit disable、availability filter、conflict resolver 和 model visibility。

这是 `agent-capability` public discovery SEARCH SPI refinement，而不是仅限实现内部的 helper 改名。当前 public `CapabilitySearchCriteria` 已经从 `agent-capability` package export 暴露，因此实施时必须采用以下二选一的最小兼容路径：

1. 直接替换 `CapabilitySearchCriteria` shape 为 safe search scope criteria，并迁移所有 SEARCH callers / fake discovery tests。
2. 新增 replacement criteria type，并把 public `CapabilityDiscovery.search` signature 切换到该 type；旧 binding-owned criteria 不再作为 discovery 输入。

无论采用哪条路径，contract tests 都必须证明 public criteria type 不含 `agentAssembly` / `boundCapabilityIds`，且 fake SEARCH discovery 无法观察 capability bindings。

### D4: Discovery layout 固定为一级目录 + SKILL.md

system-level 和 Agent-owned local source 使用相同 authoring layout：

```text
<skills-root>/<skill-id-or-dir>/SKILL.md
```

规则：

1. 只枚举 root 下一级子目录。
2. 名称以 `.` 开头的隐藏目录忽略。
3. 缺少 `SKILL.md` 的目录不注册为 Skill，只产生 safe ignored/missing outcome。
4. 嵌套 `SKILL.md` 不成为独立 Skill candidate。
5. manifest identity / descriptor identity 来自标准 manifest parser/mapper，不从 raw path 推导 public identity。

### D5: Catalog request-scope 注入 local Skill 候选

Catalog `listAvailable` / `resolve` 的 candidate pipeline 固定为：

1. 收集 default-enabled candidates：builtin EAGER descriptors、system-level local EAGER descriptors、Catalog 以当前 trusted Agent scope 调用 `local-skills-agent-owned` SEARCH 得到的 Agent-owned local descriptors。
2. 收集 binding-enabled candidates：对 runtime-facing `AgentAssembly.capabilityBindings` 中 explicit enabled bindings 指向的 non-default provider / capability 执行既有 provider 搜索和候选匹配。
3. 应用 explicit disabled bindings：disabled binding 对 default-enabled candidates 和 binding-enabled candidates 都生效。
4. 应用 availability filter、conflict resolver、shadowing、model visibility 和 invocation eligibility。

`AgentAssembly.capabilityBindings` 不因本地 Skill自动可见性新增 synthetic entries。default-enabled provider 可以视为 Catalog-owned default enablement facts；Agent assembly 只保留显式 enable/disable facts 和 compiled Agent identity/version。显式 disabled binding 的优先级高于 Catalog-owned default enablement。

Catalog SEARCH 触发规则需要从当前单一路径 `searchBoundProviders` 调整为按 provider enablement 分流：

1. default-enabled trusted SEARCH providers：
   - 来源是 app composition / resource provider registry 注册的 trusted internal provider，不由用户配置启用。
   - 本 change 中唯一成员是 `local-skills-agent-owned`。
   - Catalog 每次构造 `listAvailable` / `resolve` request-scope view 时都可以调用它，调用条件是 provider 已由 trusted composition 注册且 discovery mode 为 `SEARCH`。
   - 调用不要求 `AgentAssembly.capabilityBindings` 中存在同 provider 或同 capability binding。
   - 返回 candidates 只表示“被发现”，仍要经过 explicit disabled binding、availability、conflict/shadowing 和 model visibility。

2. binding-enabled SEARCH providers：
   - 包括用户配置或非 reserved 的 SEARCH provider。
   - 沿用既有 explicit binding 启用语义：只有 provider id 出现在 enabled bindings 中才搜索。
   - 搜索结果继续按 enabled bindings 过滤，避免未绑定 provider 扩大可见性。

这条分流保留现有外部 SEARCH provider 的安全边界，同时允许新增的内置/default-enabled `LOCAL_DIRECTORY` Agent-owned provider自动进入 Agent 可用清单；两类 SEARCH 结果最终都进入同一个 Catalog governance pipeline，因此 explicit disabled binding 对所有 provider 生效。

### D6: Source priority 使用安全 source facts，不解析路径

本地 Skill priority 在 conflict governance 前或 governance 内通过 safe source facts 表达：

| Priority | Kind | Scope | 结果 |
|---|---|---|---|
| 最高 | `BUNDLED` | framework trusted | 本 change 不改变，local 不能覆盖 |
| local-1 | `LOCAL_DIRECTORY` | Agent-owned for same Agent | shadow system-level local |
| local-2 | `LOCAL_DIRECTORY` | System-level | fallback default local |

同一 source scope 内相同 `capabilityId` 且不是同一个 stable source fact identity 的 candidates 必须 rejected。Agent-owned shadow system-level 只影响该 owning Agent；system-level candidate 对其他未覆盖 Agent 仍可见。

可实施算法固定为：

1. Catalog 为当前 Agent request scope 汇总候选事实：EAGER builtin/system local、当前 Agent 的 Agent-owned SEARCH local，以及显式 binding facts。
2. 每个 candidate 附带 safe conflict fact：`providerId`、`providerKind`、`sourceScope`（`framework` / `system-local` / `agent-owned-local`）、`agentId` / `agentVersion`（仅 Agent-owned）、`capabilityId`、`stableSourceFactId`、`priority`。
3. 按当前 Agent request scope 的 `capabilityId` 分组。
4. 每组先检查同一 `sourceScope` 内的 local duplicate：如果相同 `capabilityId` 对应不同 `stableSourceFactId`，这些 duplicate candidates 全部 rejected，不进入 model-visible list。
5. 组内若存在 `BUNDLED` candidate，它保持 winner；local candidates 只能形成 shadowed/rejected/unavailable outcome，不覆盖 builtin。
6. 没有 `BUNDLED` 时，当前 Agent 的 `agent-owned-local` candidate 优先于 `system-local` candidate；被 shadow 的 system candidate 只在当前 Agent scope 内不可见。
7. 对另一个 Agent 重新构造 request scope 时重新分组；上一步 shadow 不得污染 system-level candidate 的全局注册事实。

该设计选择不修改 public `CapabilityProviderKind` vocabulary，也不让 conflict resolver 读取 raw local path。需要比较的事实只包含 provider id、provider kind、source scope、agent id/version、capability id、manifest identity、safe priority。

### D7: Source-owned loading facts 留在 provider 边界

Discovery 可以把后续授权 execution 所需的 loading fact 保存在 `agent-capability` implementation boundary，例如以 provider/source/capability stable key 关联到内部 loader input。Descriptor、metadata、diagnostic、stream、safe error、audit detail 和 model context 都不得包含 raw path、full body、loading key 或 content loading authority。

后续 inline/fork Skill execution 只能在 Catalog resolve 和 invocation authorization 后，通过 provider-owned loader 使用这些 facts。

### D8: Diagnostics 是 implementation-local safe evidence

本 change 不新增 public readiness DTO、Web API 或 stream event。Local Skill diagnostics 作为 startup/readiness/capability implementation-local evidence，最小覆盖：

- `LOCAL_SKILL_SOURCE_DISABLED`
- `LOCAL_SKILL_SOURCE_UNAVAILABLE`
- `LOCAL_SKILL_AGENTS_ROOT_INVALID`
- `LOCAL_SKILL_AGENT_PACKAGE_UNAVAILABLE`
- `LOCAL_SKILL_CANDIDATE_IGNORED`
- `LOCAL_SKILL_MANIFEST_MISSING`
- `LOCAL_SKILL_MANIFEST_INVALID`
- `LOCAL_SKILL_DUPLICATE_REJECTED`
- `LOCAL_SKILL_SHADOWED_BY_AGENT`
- `LOCAL_SKILL_GOVERNANCE_UNAVAILABLE`
- `LOCAL_SKILL_REGISTERED`

Evidence 只包含 stable provider id、provider kind、source scope、agent id/version（如适用）、capability id、safe outcome code 和 sanitized message。

Catalog public `listAvailable` / `resolve` 返回值不新增 diagnostics payload。测试和 readiness 只通过 implementation-local diagnostics/readiness evidence 观察这些结果。SEARCH 阶段遇到 package root not configured / unavailable、`skills/` root missing、candidate ignored、manifest missing 或 manifest invalid 时，返回空 candidate set 或排除对应 candidate，并记录 safe diagnostic；只有 manifest validation 和 Catalog governance 都接受后才允许报告 `LOCAL_SKILL_REGISTERED`。

### D9: 现有 contract 优先，必要 refinement 必须最小

首选实现复用现有 `CapabilityDescriptor`、`CapabilityCatalog`、`CapabilityInvocationPort` 和 `AgentAssembly` identity/version/ref facts。已知当前 `CapabilitySearchCriteria` public surface 包含 `agentAssembly` 和 `boundCapabilityIds`，本 change 必须把 Agent-owned local Skill SEARCH criteria refinement 为不携带 bindings 或 runtime-facing assembly object；该 refinement 是 public capability discovery SPI 修改，必须补 contract tests 和 caller migration tests。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | Root 只来自 trusted app config / locator；请求体、模型输出和 manifest metadata 不能控制 source；Agent-owned discovery 使用 `configRoot/agents/{agentId}/skills` 而不是 `workspaceDir/skills`；descriptor/diagnostic/model context 不暴露 raw path、full body、loading key、secret 或 package layout。 | app config tests、locator tests、descriptor safety negative tests、architecture forbidden-pattern checks |
| 性能/容量 | system local EAGER 启动加载；Agent-owned SEARCH 只加载当前 Agent，避免启动扫描所有 Agent；首版不支持 watcher/hot reload。 | EAGER/SEARCH mode tests、Catalog list/resolve tests |
| 可靠性/恢复 | system source 和派生 Agent package root 问题在 startup/readiness 可见；Agent-owned package/search 问题在 Catalog SEARCH diagnostics 中安全可见；accepted request 只通过 Catalog 访问 discovery。 | startup/readiness tests、Catalog SEARCH failure tests |
| 可维护性 | 一个 `LocalSkillDiscovery` 复用 manifest parser/mapper；system vs Agent-owned 差异通过 provider mode 和 trusted source scope 表达，不新增泛化 source framework。 | module tests、code review checkpoint、lint:architecture |
| 可测试性 | `configRoot/agents` 派生、locator、EAGER scan、SEARCH scan、binding 不传入 discovery、shadowing 和 safety facts 都可独立测试。 | unit/contract/integration tests |
| 审计/可追溯性 | 本 change 不新增 audit schema；diagnostics/readiness evidence 提供 safe provider/source/capability/outcome 定位字段，后续 audit change 可消费 safe outcome 而非 raw source facts。 | diagnostics tests、redaction/safety assertions |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `configRoot` / `workspaceRoot` 冻结与派生 path 解析 | 2.6, 2.7 | app config validation tests |
| user capability provider config 不支持 `local-directory`，`LOCAL_DIRECTORY` 只保留给 reserved local Skill providers | 3.7 | capability source configuration tests、app composition tests |
| AgentPackageSourceLocator 使用 `configRoot/agents/{agentId}` | 2.2, 2.7 | locator tests |
| system local root reference 合成 reserved provider | 2.5, 3.1, 3.6 | app config / source synthesis tests、source discovery unit tests |
| Agent-owned SEARCH discovery 不消费 bindings | 3.2, 3.3 | contract/search criteria tests |
| 两类 source 复用标准 manifest parser/mapper | 3.4 | manifest reuse tests |
| 本地 Skill 自动参与 Catalog 可见清单，不写 synthetic binding | 4.1, 4.2, 4.4 | Catalog `listAvailable` / `resolve` tests、assembly negative tests |
| default-enabled vs binding-enabled SEARCH 分流 | 4.3, 4.5 | Catalog SEARCH trigger tests、disabled binding tests |
| Agent-owned 只对 owning Agent 可见 | 4.2 | cross-Agent visibility tests |
| Agent-owned shadow system-level；同源重复 rejected；local 不覆盖 builtin | 5.1, 5.2, 5.3, 5.5 | conflict/shadowing tests |
| runtime/core/context 不直接扫描目录 | 6.1 | architecture tests |
| descriptor/diagnostic 不泄露 raw path/content/loading facts | 6.2, 6.3 | safety negative tests |
| diagnostics/readiness outcome 可解释 | 7.1 | diagnostics/readiness focused tests |
| OpenSpec 和架构门禁 | 8.1, 8.2 | `openspec validate add-ts-local-skill-source --strict`、`npm run lint:architecture` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/local-skill-source/spec.md` 主承载。
- app config 行为：`openspec/specs/app-config-schema/spec.md` 主承载 `configRoot` / `workspaceRoot` 和派生 runtime paths。
- Agent package 行为：`openspec/specs/agent-package-assembly/spec.md` 主承载 `configRoot/agents/{agentId}` package root locator 与 `skills/` candidate input。
- 架构和跨模块设计：`openspec/designs/architecture/capability-spi.md` 主承载 local Skill source 如何复用 unified capability SPI、EAGER/SEARCH 分工和 Catalog governance；`openspec/designs/architecture/skill-manifest-contract.md` 主承载 manifest reuse 事实。
- 模块设计：`openspec/designs/modules/agent-app.md` 主承载 `configRoot/agents` 派生和 Agent package source locator；`openspec/designs/modules/agent-capability.md` 主承载 `LocalSkillDiscovery`、source-owned loading facts、Catalog candidate injection 和 conflict/shadowing owner。
- ADR：当前无新增 ADR。若实施中需要改变全局 capability priority 或 provider identity vocabulary，必须另起 ADR 或 contract refinement；本 change 不做该改变。
- 导航：`openspec/designs/spec-to-design-map.md` 增加 `local-skill-source` 的设计入口和验证入口。

## 风险与取舍（Risks / Trade-offs）

- [风险] “自动进入清单”被误实现为写入 `AgentAssembly.capabilityBindings`。 -> 在 spec/design/tasks 中明确自动可见性由 Catalog request-scope 计算，并增加 assembly negative test。
- [风险] Catalog 把 bindings 传给 discovery，导致 discovery 拥有可见性判断。 -> 明确 SEARCH criteria 不含 bindings，并添加 contract/search criteria negative tests。
- [风险] 使用 `workspaceDir/skills` 作为 Agent-owned source root。 -> 明确 `workspaceDir` 非权威来源，使用 `configRoot/agents/{agentId}/skills`，并添加 negative test。
- [风险] Agent-owned SEARCH 每次请求重复扫描。 -> 首版允许 Catalog SEARCH 触发加载；实现可以按 `agentId + agentVersion + agentAssemblyRef` 做 process-local cache，但 cache/invalidation 不形成外部契约。
- [风险] local source diagnostics 泄露部署路径或 Agent package layout。 -> Descriptor、diagnostic 和 readiness tests 必须断言不包含 raw path、resource URI、package internal layout。

## 迁移计划（Migration Plan）

无数据迁移。本 change 将用户可感知路径收敛为 `configRoot` 和 `workspaceRoot`：system local Skill 从 `configRoot/skills` 加载；Agent-owned local Skill 仅在 `configRoot/agents/{agentId}/skills` 存在时由 Catalog SEARCH 加载；SQLite 从 `workspaceRoot/data/system/nextagent.sqlite` 派生。若 local Skill 目录不存在、不可读或为空，则产生 safe unavailable / empty candidate outcome，不阻塞 builtin 或 Agent-owned local source。当前内置默认 Agent 若仍不使用 `configRoot/agents/{agentId}` 文件布局，可以继续通过内置 default AgentDefinition 服务请求；其 Agent-owned local Skill source 在 package locator 无法定位时返回安全 not-configured / unavailable empty outcome，不回退到 `workspaceDir/skills`，不因缺少 Agent-owned local source 阻塞请求。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/local-skill-source/spec.md`：新增可验证行为契约。
- `openspec/specs/app-config-schema/spec.md`：补充 `configRoot` / `workspaceRoot` 和派生 runtime paths。
- `openspec/specs/agent-package-assembly/spec.md`：提炼 Agent package locator 与 `configRoot/agents/{agentId}/skills` 的关系。
- `openspec/specs/capability-source-configuration/spec.md`：提炼 system local `LOCAL_DIRECTORY` source configuration 与 local Skill discovery 的消费关系。
- `openspec/overview.md`：补充本地 Skill source对电信网络智能体现场交付和 Agent 专属能力的长期目标。
- `openspec/designs/architecture/capability-spi.md`：补充 local Skill source 复用统一 capability governance、EAGER/SEARCH 分工和 Catalog binding owner 边界。
- `openspec/designs/architecture/skill-manifest-contract.md`：补充 system local 和 Agent-owned local source 复用 manifest contract。
- `openspec/designs/modules/agent-app.md`：补充 `configRoot`、`workspaceRoot`、Agent package source locator、trusted system local root 派生和 diagnostics aggregation。
- `openspec/designs/modules/agent-capability.md`：补充 `LocalSkillDiscovery`、Catalog candidate injection、source-owned loading facts 和 conflict/shadowing。
- `openspec/designs/spec-to-design-map.md`：增加导航和验证入口。

## 待确认问题（Open Questions）

当前 change 不定义本地 Skill 数量上限、目录大小上限、SEARCH cache TTL 或 startup SLA；若产品需要容量承诺，必须另行补充可量化规格后再实施相关门禁。
