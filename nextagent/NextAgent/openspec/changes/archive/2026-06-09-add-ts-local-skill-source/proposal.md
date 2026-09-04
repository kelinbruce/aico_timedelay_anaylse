## 背景与问题（Why）

NextAgent 已经冻结了统一 Capability Catalog、Skill manifest contract、builtin Skill source、Agent package assembly 和 capability conflict resolution 的基本边界，但本地 Skill source 仍缺少独立规格。当前系统可以表达 `LOCAL_DIRECTORY` provider kind 和 source configuration baseline，也已经把 `agents/{agentId}` 作为目标态 Agent package root，并把 package 下的 `skills/` 视为 assembly 候选输入；但系统尚未定义本地 Skill 如何被发现、校验、进入 Catalog governance，并按 Agent 范围形成可用 Skill 清单。

这个缺口会导致两个实际问题：

- 电信产品部署需要一组系统级本地 Skill，用于承载运营商现场交付、网络运维诊断、客户系统集成和版本内预置之外的本地能力；这些 Skill 不能依赖 SkillHub 或远端安装流程，也不能绕过统一 capability governance。
- 每个 Agent package 需要拥有自己的 `skills/` 目录，用来表达 Agent-owned Skill。该目录中的 Skill 只服务所属 Agent，并且在与系统级本地 Skill 同名时应优先，避免系统级默认能力压过 Agent 专属诊断流程。

系统级本地 Skill 和 Agent-owned Skill 的加载时机不同。系统级 source 是进程级输入，适合在启动期 `EAGER` 加载；Agent-owned source 依赖当前请求的 trusted Agent scope，适合由 Catalog 在 `listAvailable` / `resolve` 构造 request-scope view 时以 `SEARCH` 模式加载。这个设计可以避免启动时扫描所有 Agent package，也避免把不同 Agent 的同名 Skill 放进全局候选后误判为全局冲突。

同时，本 change 需要补齐配置根和运行根的最小可信语义。`packages/agent-app/config/default-system.yaml` 和 `packages/agent-app/config/default-agent.yaml` 是内置默认配置，不是用户可修改配置；用户系统配置入口是 `application.yaml`，它作为覆盖层与内置 `default-system.yaml` 合成最终 frozen system config。合成后的路径模型必须区分 `configRoot` 和 `workspaceRoot`：`configRoot` 承载 `application.yaml`、用户 Agent package 和本地 Skill 输入；`workspaceRoot` 承载 Agent 执行 workspace、SQLite、日志和运行数据。Agent-owned Skill root 不应从 `AgentAssembly.workspaceDir` 推导，因为 `workspaceDir` 是 Agent 执行 workspace / provider execution root，不是 Agent package/config root。Agent-owned Skill root 必须来自 trusted Agent package source locator：`configRoot/agents/{agentId}/skills`。

## 变更范围（What Changes）

- 新增本地 Skill source 行为规格，统一覆盖两类来源：
  - system-level local Skill source：由可信 app composition 指定一个系统级 `skills/` root，使用 `discoveryMode=EAGER`，启动期加载。
  - Agent-owned local Skill source：由 `configRoot/agents/{agentId}/skills` 承载，只对 owning Agent 可见，使用 `discoveryMode=SEARCH`，由 Catalog 按 trusted Agent scope 查询加载。
- 新增/明确 app config `paths` 配置语义：
  - frozen runtime paths 必须包含 `configRoot` 和 `workspaceRoot`。
  - `configRoot` 来自用户 `application.yaml` 所在目录；未提供用户配置时沿用当前启动 base dir 作为兼容默认。
  - `workspaceRoot` 来自最终合成后的 system config `paths.workspaceRoot`。
  - `systemSkillsRoot` 派生为 `configRoot/skills`。
  - `agentsRoot` 派生为 `configRoot/agents`，用于定位 Agent package root：`agentPackageRoot = resolve(agentsRoot, agentId)`。
  - `sqliteFile` 派生为 `workspaceRoot/data/system/nextagent.sqlite`。
  - `paths.systemSkillsRoot`、`paths.agentsRoot` 和 `paths.sqliteFile` 不作为用户配置入口，也不属于 `CapabilityProviderConfig`，不由 `agent-capability` 直接解释 raw config。
  - `capabilityProviders.providers` 不作为 `default-system.yaml` 用户配置入口；`builtin-tools`、`builtin-skills` 和 reserved local Skill providers 由 app composition 的 startup resource provider registry 注册。
- 新增 Agent package source locator 边界：`agent-app` / Agent package assembly 负责提供 trusted `agentId + agentVersion -> agentPackageRoot` 定位能力；`LocalSkillDiscovery` 只能通过该 locator 定位 Agent-owned `skills/`。
- 保留两类 local Skill provider identity：
  - `local-skills-system`：trusted system-level local Skill provider，由 app composition 注册。
  - `local-skills-agent-owned`：trusted Agent-owned local Skill provider，由 app composition 注册。
  - 外部 `CapabilityProviderConfig` / source configuration 不得声明、覆盖、禁用或劫持这些 reserved provider id；resource provider registry 必须拒绝冲突注册。
- 明确内置 capability provider 不由 `default-system.yaml` 配置：
  - `builtin-tools` 和 `builtin-skills` 是框架内置 provider identity，由 app composition 的 startup resource provider registry 注册。
  - 内置默认 `default-system.yaml` 不包含 `capabilityProviders.providers`。
  - 用户系统配置入口仍是 `application.yaml` 覆盖层；用户可配置外部 provider 只通过 `adnclaw.system.capability-providers`，不得把 builtin provider 写入 raw system config。
- 明确 `LOCAL_DIRECTORY` 不作为用户配置型 provider kind：
  - `adnclaw.system.capability-providers` 不支持 `type=local-directory`。
  - system-level local Skill 只能通过 `configRoot/skills` 提供。
  - Agent-owned local Skill 只能通过 trusted Agent package source locator 定位。
  - 用户配置中出现 `type=local-directory` 必须安全诊断为 `UNSUPPORTED_PROVIDER_TYPE`，不得生成外部 `LOCAL_DIRECTORY` provider。
- 明确 system-level local Skill root 的唯一承载：
  - 用户/部署配置只能通过选择 `configRoot` 间接确定系统级 `skills/` root；不得提供 provider id、provider kind、discovery mode 或 provider-private options。
  - `agent-app` 在启动期校验并冻结该 path，并由 trusted app composition 合成 reserved provider `local-skills-system + LOCAL_DIRECTORY + EAGER` 的 runtime source fact / discovery input。
  - 合成后的 `directoryRef` / resolved root 只作为 frozen startup source fact 传给 `agent-capability`，不允许 `agent-capability` 直接解释 raw app config。
  - 若 `configRoot/skills` 不存在或为空，则 `local-skills-system` 产生 safe unavailable / empty-candidate outcome，不阻塞 Agent-owned local Skill source 或 builtin capability。
- 明确用户 Agent 配置覆盖：
  - 用户 AgentDefinition 入口为 `configRoot/agents/{agentId}/agent.yaml`。
  - 存在该文件时，它替换内置 `default-agent.yaml` 对应 AgentDefinition，不做深 merge。
  - 当 active Agent 是 `default-agent` 且用户 agent file 缺失时，继续使用内置 `default-agent.yaml` 作为兼容 fallback。
  - 非 default active Agent 缺失用户 `agent.yaml` 必须 fail closed。
- 两类本地 Skill source 均使用 `providerKind=LOCAL_DIRECTORY`，复用现有 `SKILL.md` manifest parser、descriptor mapper、typed `SkillMetadata` 和 safe diagnostics。
- 两类本地 Skill source 只扫描一级 Skill candidate：root 下每个包含 `SKILL.md` 的一级子目录表示一个 Skill candidate；隐藏目录忽略；嵌套 Skill 不作为独立 candidate。
- 本地 Skill 自动参与 Agent 的 request-scope 可用 Skill 清单计算：Catalog 在 `listAvailable` / `resolve` 时把受治理的 system local Skill 和当前 Agent 的 Agent-owned local Skill 纳入候选集，不要求 `AgentAssembly.capabilityBindings` 显式绑定。
- Catalog 不得把 `capabilityBindings` 传给 discovery 作为发现依据。Discovery 只接收 trusted search scope（`agentId`、`agentVersion`、`agentAssemblyRef`、可选 `requestedCapabilityId`）；binding、禁用、可见性、availability、冲突和优先级仍由 Catalog governance 负责。
- 明确 `agent-capability` public discovery SEARCH SPI 的最小 refinement：现有 `CapabilitySearchCriteria` 属于 public package surface；本 change 必须移除或替换 SEARCH criteria 中的 `AgentAssembly` / `boundCapabilityIds` binding-owned 输入，改为只携带 trusted Agent search scope 和可选 requested capability narrowing，并补 contract / compatibility tests。
- 调整 Catalog SEARCH provider 触发规则：
  - trusted app composition 默认启用的内置/reserved SEARCH provider（本 change 中为 `local-skills-agent-owned`）不依赖 explicit enabled binding；Catalog 在构造当前 Agent request-scope view 时按 trusted Agent scope 调用。
  - 这些 default-enabled provider 等价于拥有 Catalog 内部默认启用事实，但不写入 `AgentAssembly.capabilityBindings`。
  - 其他 SEARCH provider 继续按 explicit enabled binding 启用和过滤；未绑定 provider 不被搜索。
  - 所有 candidates（EAGER、default-enabled SEARCH、binding-enabled SEARCH）仍统一经过 Catalog 的 explicit disabled binding、availability、conflict、shadowing、model visibility 和 invocation eligibility；显式 disabled binding 必须能关闭默认启用 provider 暴露出的 capability。
- 冲突策略固定为：
  - `BUNDLED` builtin capability 继续保持全局最高优先级，本 change 不允许本地 Skill 覆盖 builtin capability。
  - 对同一个 Agent，Agent-owned local Skill 优先于 system-level local Skill。
  - 同一来源和同一 scope 内相同 `capabilityId` 的不同 stable source facts 必须安全 rejected，不允许 silent overwrite。
  - system-level local Skill 被 Agent-owned local Skill shadow 后，不进入该 Agent 的 model-visible 可用清单，并产生 safe shadow diagnostic；它对其他未覆盖 Agent 仍可见。
- Agent-owned local source 对现有内置 default Agent 兼容：如果当前 Agent 仍由 built-in default assembly registry 提供，且 `configRoot/agents/{agentId}` 不存在或 locator 标记为 not configured，则 Agent-owned SEARCH 返回空候选集和安全 diagnostic；不得回退扫描 `AgentAssembly.workspaceDir/skills`，也不得阻塞该 Agent 的既有请求路径。
- 本 change 不定义 Skill inline/fork execution、Skill body execution、SkillHub install/cache、sandbox execution、routing policy、audit schema、stream event 或 Web API。

## Capability 影响（Capabilities）

### 新增 Capability

- `local-skill-source`: 定义 system-level local Skills 和 Agent-owned local Skills 的本地目录发现、manifest 复用、`EAGER`/`SEARCH` 加载时机、Agent 范围可见性、Catalog 默认候选注入、优先级/shadowing 和安全诊断边界。

### 修改的 Capability

- `app-config-schema`: 新增/明确 `configRoot` 和 `workspaceRoot` 两个 frozen runtime roots；`systemSkillsRoot`、`agentsRoot` 和 `sqliteFile` 是派生路径，不是用户配置入口。
- `agent-package-assembly`: 明确 Agent package root 由 trusted Agent package source locator 承载；目标布局为 `configRoot/agents/{agentId}`，其下 `skills/` 是 Agent-owned local Skill source；runtime-facing `AgentAssembly.workspaceDir` 不作为 Agent-owned Skill source root。
- `capability-source-configuration`: 明确 system-level local Skill root 先由 app composition 校验并合成 reserved `LOCAL_DIRECTORY` provider/source fact；外部 raw provider entry 不得声明 reserved provider id；`agentsRoot` 不属于 capability provider options。
- `capability-catalog`: 明确本地 Skill source 的 request-scope 默认候选注入、Agent-owned SEARCH discovery、system local fallback、binding 过滤和 shadowing 语义仍由统一 Catalog governance 执行。
- `capability-discovery-spi`: 明确 public SEARCH criteria 不再携带 binding-owned facts 或 runtime-facing `AgentAssembly` 对象；discovery 只接收 trusted search scope，不拥有 binding、availability 或 priority 决策。

## 影响范围（Impact）

- 受影响模块：
  - `modules/agent-app`：负责 `configRoot` / `workspaceRoot` 冻结、Agent package source locator、可信 system local Skill root 派生、startup resource provider registration 和 diagnostics 聚合。
  - `modules/agent-capability`：负责 `LocalSkillDiscovery` adapter、system EAGER discovery、Agent-owned SEARCH discovery、manifest reuse、source-owned loading facts、Catalog candidate merge、availability 和 conflict/shadowing 治理。
  - `modules/agent-contracts`：原则上复用现有 capability descriptor/catalog/invocation surface；如 `SEARCH` criteria 需要移除 binding 依赖或补充安全 search scope，必须以最小 contract refinement 完成并补 contract tests。
  - `modules/agent-context-engine`、`modules/agent-runtime`、`modules/agent-core`：只消费 Catalog 结果，不扫描本地 Skill 目录，不读取 `SKILL.md`。
- 受影响配置：
  - `configRoot`：用户配置根，承载 `application.yaml`、`skills/` 和 `agents/`。
  - `workspaceRoot`：运行根，承载 Agent workspace、SQLite、日志和运行数据。
  - `configRoot/skills` 下约定的 system-level local Skill 目录。
  - `configRoot/agents/{agentId}/skills` 下约定的 Agent-owned Skill 目录。
  - `LOCAL_DIRECTORY` reserved provider identity / scope 规则；用户 capability provider 配置不支持 `local-directory`。
- 受影响测试：
  - app config validation tests
  - Agent package source locator tests
  - EAGER / SEARCH discovery unit tests
  - Skill manifest reuse tests
  - Catalog request-scope visibility tests
  - conflict/shadowing tests
  - architecture boundary tests
  - OpenSpec validation
- 运维面：
  - startup/readiness 或 capability implementation-local diagnostics 必须能安全解释 system local source unavailable、derived Agent package root invalid、Agent package root unavailable / not configured、Agent-owned source search unavailable、manifest invalid、same-scope duplicate rejected、Agent-owned shadowed system local 等结果；Catalog public list/resolve response 不新增 diagnostics payload。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：

- `openspec/specs/local-skill-source/spec.md`：新增 system-level local Skill source、Agent-owned local Skill source、EAGER/SEARCH 加载时机、Catalog 默认候选注入、Agent scope visibility、shadowing 和 diagnostics 行为。
- `openspec/specs/app-config-schema/spec.md`：补充 `configRoot` / `workspaceRoot` 与派生 runtime paths。
- `openspec/specs/agent-package-assembly/spec.md`：补充 `configRoot/agents/{agentId}` package root locator 与 `skills/` candidate input 的归档后关系。
- `openspec/specs/capability-source-configuration/spec.md`：按需补充 `LOCAL_DIRECTORY` source configuration 与 local Skill discovery 的消费关系。

长期背景：

- `openspec/overview.md`：补充本地 Skill source 在电信网络智能体产品中的目标态摘要。

设计视图：

- `openspec/designs/architecture/capability-spi.md`：补充 local Skill source 复用统一 capability descriptor/catalog/invocation surface、EAGER/SEARCH 分工和 Catalog governance 边界。
- `openspec/designs/architecture/skill-manifest-contract.md`：补充 system local 和 Agent-owned local source 复用统一 manifest parser/mapper 的归档后事实。
- `openspec/designs/modules/agent-app.md`：补充 `configRoot`、`workspaceRoot`、Agent package source locator、trusted system local root 派生和 diagnostics 聚合职责。
- `openspec/designs/modules/agent-capability.md`：补充 local Skill discovery adapter、source-owned loading facts、Catalog default candidate injection 和 shadowing owner。
- `openspec/designs/spec-to-design-map.md`：新增 `local-skill-source` 到相关 architecture/module 设计的导航。

验证入口：

- `openspec validate add-ts-local-skill-source --strict`
- app config / Agent package source locator tests
- local Skill source focused unit / contract tests
- Catalog visibility and conflict/shadowing tests
- architecture checks for no runtime/core/context source loading, no discovery binding ownership, and no raw path/content leakage
