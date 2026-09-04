## 1. 实施前规格检查

- [x] 1.1 确认本 change 只定义 local Skill source discovery、Catalog request-scope 默认候选注入、Agent scope visibility、shadowing、`configRoot/agents` locator 和 diagnostics，不定义 inline/fork execution、SkillHub、sandbox、routing、audit schema、Web API 或 stream event。
  验证：code review 检查 `proposal.md`、`design.md`、`specs/local-skill-source/spec.md` 与实现 diff；确认未新增 source-private invocation envelope、Web route、stream event、sandbox execution 或 SkillHub install/cache 行为。
  来源：proposal 非目标；design Goals / Non-Goals
- [x] 1.2 确认自动进入 Agent 可用 Skill 清单的语义由 Catalog `listAvailable` / `resolve` 计算，不通过向 `AgentAssembly.capabilityBindings` 写入 synthetic enabled binding 实现。
  验证：assembly 相关测试断言 local Skill 自动可见时 runtime-facing assembly 不新增 synthetic binding。
  来源：spec requirement "本地 Skill 自动参与 Agent 可用 Skill 清单"；design D5
- [x] 1.3 确认本地 Skill 不改变 `BUNDLED` builtin capability 最高优先级，也不扩展 `CapabilityProviderKind` vocabulary。
  验证：contract/schema 测试断言 provider kind closed set 未新增；conflict/shadowing 测试断言 local Skill 不覆盖 builtin capability。
  来源：spec requirement "Agent-owned 本地 Skill 优先于系统级本地 Skill"；design D6
- [x] 1.4 确认 `CapabilitySearchCriteria` / public discovery SEARCH SPI 的 binding-owned facts refinement 是本 change 的显式 contract 修改，不作为实现细节遗漏。
  验证：code review 检查 public `agent-capability` export；contract tests 断言 SEARCH criteria 不包含 `agentAssembly`、`boundCapabilityIds` 或 `capabilityBindings`。
  来源：spec requirement "Agent-owned SEARCH Discovery 不消费 Binding 决策"；design D3、D9

## 2. App Config 与 Agent Package Locator

- [x] 2.1 在 app config / app composition 中明确 system local root 和 Agent package root 均由 frozen `configRoot` 派生，用户配置入口只保留 `paths.workspaceRoot`。
  验证：app config validation tests 覆盖默认 `configRoot/skills`、`configRoot/agents`，覆盖 `paths.systemSkillsRoot` / `paths.agentsRoot` / `paths.sqliteFile` 作为用户配置入口时启动期拒绝；safe diagnostics 不暴露 raw absolute path。
  来源：spec requirements "本地 Skill Provider Identity 由系统保留"、"configRoot 和 workspaceRoot 定位配置输入与运行输出"；design D1、D2
- [x] 2.2 在 `agent-app` / Agent package assembly 边界新增 `AgentPackageSourceLocator` 或等价实现，按 trusted `agentId + agentVersion` 定位 `configRoot/agents/{agentId}`，并提供 `skills` root 给 agent-capability。
  验证：locator unit tests 覆盖 `agentId=default-agent` 定位 `configRoot/agents/default-agent/skills`；`application.yaml` 所在目录成为 `configRoot`；未知 Agent 或缺失 package root 返回安全 unavailable outcome。
  来源：spec requirement "configRoot 和 workspaceRoot 定位配置输入与运行输出"；design D2
- [x] 2.3 增加负例：`AgentAssembly.workspaceDir` 不作为 Agent-owned Skill source root。
  验证：test 构造 `workspaceDir` 与 `configRoot/agents/{agentId}` 不同且两边都有 `skills/`；断言只扫描 `configRoot/agents/{agentId}/skills`，不扫描 `workspaceDir/skills`。
  来源：spec scenario "workspaceDir 不作为 Agent-owned Skill root"；design D2
- [x] 2.4 明确并测试内置 default Agent 没有 `configRoot/agents/{agentId}` package root 时的兼容行为。
  验证：locator / Catalog SEARCH tests 覆盖 built-in default assembly registry 存在但 `configRoot/agents/default-agent` 缺失；断言 Agent-owned SEARCH 返回空候选和安全 not-configured/unavailable diagnostic，不扫描 `workspaceDir/skills`，不阻塞既有 Agent 请求路径。
  来源：spec scenario "内置 default Agent 无 package root 时不回退 workspaceDir"；design D2、Migration Plan
- [x] 2.5 在 app composition 中明确 `configRoot/skills` 的唯一承载，并合成 reserved provider source fact。
  验证：app config / composition tests 覆盖 `configRoot/skills` 默认派生；用户不能显式配置 `paths.systemSkillsRoot`；app composition 合成 `local-skills-system + LOCAL_DIRECTORY + EAGER` runtime source fact；外部 raw `CapabilityProviderConfig` 使用 `providerId=local-skills-system` 被拒绝；resolved root 不存在、不可读或为空时产生 safe unavailable/empty outcome 且不阻塞 builtin 或 Agent-owned local source。
  来源：spec scenarios "configRoot 默认定位 system local Skill root"、"System local root 由 configRoot 合成 reserved provider"、"configRoot/skills 缺失或为空不阻塞其他 capability source"；design D1
- [x] 2.6 修正配置根和运行根模型：`default-system.yaml` 作为内置默认配置，用户 `application.yaml` 作为覆盖层，合成后的 frozen config 暴露 `configRoot` 和 `workspaceRoot` 两个根。
  验证：`npm test -- tests/agent-kernel/config-assembly.test.ts tests/agent-kernel/local-skill-source-config.test.ts tests/local-runtime-package.test.ts` 覆盖 `configFile` 所在目录成为 `configRoot`；`application.yaml` 覆盖内置 `default-system.yaml`；`paths.systemSkillsRoot`、`paths.agentsRoot`、`paths.sqliteFile` 不作为用户配置入口；`sqliteFile` 从 `workspaceRoot/data/system/nextagent.sqlite` 派生。
  来源：spec requirements "配置根与运行根由 app composition 冻结"；design D2
- [x] 2.7 将 system local Skill root 和 Agent package root 改为从 `configRoot` 派生：`configRoot/skills` 与 `configRoot/agents/{agentId}`。
  验证：`npm test -- tests/agent-kernel/config-assembly.test.ts tests/agent-kernel/local-skill-source-config.test.ts tests/local-runtime-package.test.ts` 覆盖 `systemSkillsRoot=configRoot/skills`、`agentsRoot=configRoot/agents`；Agent-owned discovery 扫描 `configRoot/agents/{agentId}/skills`，不扫描 `workspaceRoot/{agentId}/skills`。
  来源：spec requirements "配置根与运行根由 app composition 冻结"、"configRoot 和 workspaceRoot 定位配置输入与运行输出"；design D2
- [x] 2.8 支持用户 Agent 配置覆盖：存在 `configRoot/agents/{agentId}/agent.yaml` 时加载该 AgentDefinition；缺失 `default-agent` 用户配置时继续使用内置 `default-agent.yaml`。
  验证：`npm test -- tests/agent-kernel/config-assembly.test.ts tests/agent-kernel/local-skill-source-config.test.ts tests/local-runtime-package.test.ts` 覆盖用户 `agent.yaml` 替换内置 AgentDefinition；非 default active Agent 缺少用户 `agent.yaml` 时 fail closed；AgentDefinition 不允许系统字段的负例保持有效。
  来源：design D2
- [x] 2.9 移除 `default-system.yaml` 中无效的 raw `capabilityProviders.providers=[builtin-tools]` 占位；builtin providers 只由 startup resource provider registry 注册。
  验证：`npm test -- tests/agent-kernel/config-assembly.test.ts tests/agent-kernel/local-skill-source-config.test.ts tests/local-runtime-package.test.ts tests/agent-kernel/main-path.test.ts tests/agent-kernel/local-configured-auth.test.ts` 覆盖默认 system config 不再暴露 `capabilityProviders`，同时 builtin read capability 仍由 startup registry 可见。
  来源：spec scenario "default-system 不配置 builtin provider"；design D1

## 3. LocalSkillDiscovery 与加载模式

- [x] 3.1 在 `agent-capability` 新增 `LocalSkillDiscovery implements CapabilityDiscovery` 的 system-level provider instance，使用 `providerKind=LOCAL_DIRECTORY`、`discoveryMode=EAGER` 和 trusted system root。
  验证：unit/startup tests 覆盖 system local provider exact identity、EAGER discovery 在 startup / discovery baseline 调用、descriptor candidate 使用 `LOCAL_DIRECTORY`；discovery 只消费 app composition 合成后的 trusted source fact，不读取 raw app config。
  来源：spec requirement "本地 Skill Source 支持系统级 EAGER 和 Agent-owned SEARCH 两类来源"；design D1
- [x] 3.2 在 `agent-capability` 新增 `LocalSkillDiscovery` 的 Agent-owned provider instance，使用 `providerKind=LOCAL_DIRECTORY`、`discoveryMode=SEARCH`，通过 `AgentPackageSourceLocator` 按 trusted Agent scope 定位 `configRoot/agents/{agentId}/skills`。
  验证：unit/Catalog tests 覆盖 SEARCH discovery 只为当前 Agent 调用 locator；非 owning Agent 不返回 candidates；package root unavailable 返回安全 outcome。
  来源：spec requirement "本地 Skill Source 支持系统级 EAGER 和 Agent-owned SEARCH 两类来源"；design D1、D2
- [x] 3.3 调整或新增 Agent-owned SEARCH criteria，使 discovery 不接收 `capabilityBindings` / `boundCapabilityIds`，只接收 trusted `agentId`、`agentVersion`、`agentAssemblyRef`、tenant/subject 和可选 `requestedCapabilityId`。
  验证：contract tests 覆盖 public search criteria schema/type 不包含 `agentAssembly`、`capabilityBindings` 或 `boundCapabilityIds`；Catalog 调用 fake SEARCH discovery 时断言未传 binding ids 或 runtime-facing assembly object；迁移 existing SEARCH callers / tests。
  来源：spec requirement "Agent-owned SEARCH Discovery 不消费 Binding 决策"；design D3
- [x] 3.4 实现本地 Skill layout 扫描：只枚举 root 下一级子目录，忽略隐藏目录，缺少 `SKILL.md` 的目录不注册，嵌套 `SKILL.md` 不成为独立 candidate。
  验证：directory layout unit tests 覆盖有效一级 candidate、隐藏目录忽略、missing `SKILL.md`、嵌套 `SKILL.md` 不发现。
  来源：spec requirement "本地 Skill Discovery 复用标准 SKILL.md Manifest Contract"；design D4
- [x] 3.5 对 system-level 和 Agent-owned local Skill 都复用 `parseSkillFrontmatter` 和 `mapSkillFrontmatterToDescriptor`，不得新增 local-only manifest schema 或 DTO。
  验证：manifest reuse tests 对比 local Skill descriptor、metadata 和 manifest diagnostics 与现有 Skill manifest contract 行为一致；architecture check 确认没有 local-only public manifest DTO。
  来源：spec requirement "本地 Skill Discovery 复用标准 SKILL.md Manifest Contract"；design D4
- [x] 3.6 注册 reserved local Skill provider identities，并拒绝外部配置占用。
  验证：resource provider registry / config tests 覆盖 `local-skills-system`、`local-skills-agent-owned` 只能由 app composition 注册；外部 provider config 使用同 id 时安全拒绝且不覆盖 trusted provider；diagnostic 不暴露 raw config/path。
  来源：spec requirement "本地 Skill Provider Identity 由系统保留"；design D1
- [x] 3.7 收敛用户 capability provider 配置，禁止用户配置声明 `type=local-directory`；`LOCAL_DIRECTORY` 只允许由本 change 的 reserved local Skill providers 使用。
  验证：capability source configuration tests 覆盖 `type=local-directory` 产生 `UNSUPPORTED_PROVIDER_TYPE` 且不生成 provider；app composition tests 覆盖用户配置中的 `local-directory` 不进入 `capabilityProviders.providers`；local Skill source tests 仍证明 `local-skills-system` / `local-skills-agent-owned` 由 trusted composition 注册。
  来源：spec requirement "本地 Skill Provider Identity 由系统保留"；design D1

## 4. Catalog 可见性、Binding 过滤与 Agent Scope

- [x] 4.1 将 governed system-level local EAGER descriptors 作为每个 Agent 的 request-scope 默认 Skill 候选，并继续经过 availability filter、conflict resolver、model visibility 和 invocation eligibility。
  验证：Catalog `listAvailable` / `resolve` tests 覆盖无 explicit binding 时 system-level local Skill 对多个 Agent 可见；unavailable/governance rejected candidate 不可见。
  来源：spec requirement "本地 Skill 自动参与 Agent 可用 Skill 清单"；design D5
- [x] 4.2 将 Agent-owned SEARCH descriptors 只作为当前 owning Agent 的 request-scope 默认 Skill 候选。
  验证：cross-Agent Catalog tests 覆盖 owning Agent 可见、非 owning Agent 不可见；直接 `resolve` 非 owning Agent 的 Agent-owned Skill 返回 unavailable/not-visible safe outcome。
  来源：spec requirement "本地 Skill 自动参与 Agent 可用 Skill 清单"；design D5
- [x] 4.3 保证 explicit enable/disable binding facts 由 Catalog 在 discovery 之后应用，不作为 discovery 输入。
  验证：assembly/catalog integration tests 断言 explicit disable 可排除 builtin、system-level local 和 Agent-owned local default-enabled candidates；fake discovery 断言 discovery 输出不因 bindings 改变；Catalog 对缺省 enabled 语义保持兼容。
  来源：spec requirement "Agent-owned SEARCH Discovery 不消费 Binding 决策"；design D3、D5
- [x] 4.4 保证 local Skill 自动可见性不生成 synthetic `AgentAssembly.capabilityBindings`。
  验证：assembly/catalog integration tests 断言 assembly bindings 未因 local Skill source 增加 synthetic entry。
  来源：spec scenario "自动可见性不写入 AgentAssembly explicit bindings"；design D5
- [x] 4.5 调整 Catalog SEARCH 触发逻辑，区分 default-enabled trusted SEARCH provider 和 binding-enabled SEARCH provider。
  验证：Catalog tests 覆盖 `local-skills-agent-owned` 在无 explicit enabled binding 时仍被 SEARCH 并返回当前 Agent candidates；explicit disabled binding 可排除该 default-enabled SEARCH candidate；非 reserved SEARCH provider 无 enabled binding 时不被调用；非 reserved SEARCH provider 被调用后仍只保留 enabled bindings 允许的 candidates。
  来源：spec scenarios "Default-enabled Agent-owned SEARCH provider 不依赖 binding"、"非 reserved SEARCH provider 仍按 binding 启用"、"Binding-enabled SEARCH provider 返回结果仍受 binding 限制"；design D5

## 5. 冲突、Shadowing 与 Priority

- [x] 5.1 实现 Agent-owned local Skill 对同一 Agent 的 system-level local Skill shadow 规则，并保留 system-level local Skill 对其他未覆盖 Agent 的可见性。
  验证：Catalog conflict/shadowing tests 覆盖 Agent A 的 Agent-owned Skill shadow system-level Skill；Agent B 仍看到 system-level Skill；diagnostic 标记 safe shadow outcome。
  来源：spec requirement "Agent-owned 本地 Skill 优先于系统级本地 Skill"；design D6
- [x] 5.2 实现同一 local source scope 内相同 `capabilityId` 且不同 stable source facts 的 duplicate/conflict reject，不允许 silent overwrite。
  验证：conflict tests 覆盖 system-level 同源重复 rejected、Agent-owned 同源重复 rejected；conflicted candidates 不进入 model-visible `listAvailable`。
  来源：spec requirement "Agent-owned 本地 Skill 优先于系统级本地 Skill"；design D6
- [x] 5.3 保持 builtin capability 优先级高于 local Skill，local Skill 与 builtin capability 同名时不得覆盖 builtin。
  验证：conflict tests 覆盖 local Skill 与 trusted builtin capability 同 `capabilityId` 时 local candidate 被 shadowed/rejected/unavailable，builtin 仍是 visible winner。
  来源：spec requirement "Agent-owned 本地 Skill 优先于系统级本地 Skill"；design D6
- [x] 5.4 确保 conflict resolver 比较 local priority 时只消费 safe source facts，不解析 raw local path、manifest body 或 package layout。
  验证：unit tests / code review 检查 conflict input read model 只包含 provider id、provider kind、source scope、agent id/version、capability id、safe priority 和 stable source identity。
  来源：spec requirement "本地 Skill Source 只暴露安全 Facts"；design D6
- [x] 5.5 实现并测试 request-scope conflict grouping 算法。
  验证：unit/Catalog tests 覆盖按当前 Agent 的 `capabilityId` 分组、同 scope duplicate 先 rejected、`BUNDLED` winner 优先、Agent-owned local shadow system local、shadow 不污染其他 Agent 的 system local visibility。
  来源：spec requirement "Agent-owned 本地 Skill 优先于系统级本地 Skill"；design D6

## 6. 安全边界、Loading Facts 与负例

- [x] 6.1 确保 runtime、core、context engine 和 recovery 只消费 compiled assembly facts 与 Catalog governed view，不直接读取 local source facts、locator、filesystem scanner 或 Skill manifest parser。
  验证：architecture tests / dependency-cruiser forbidden checks 覆盖 runtime/core/context/recovery 不 import local Skill discovery、locator、filesystem scanner 或 Skill manifest parser。
  来源：spec requirement "Runtime/Core/Context 不直接扫描本地 Skill 目录"；design D5
- [x] 6.2 将 source-owned internal loading facts 保留在 `agent-capability` provider/source implementation boundary，descriptor、metadata、model context、stream、safe error、audit detail 和 client-visible response 不得包含 loading key 或 content loading authority。
  验证：descriptor safety negative tests 覆盖 raw path、full Skill body、loading key、content loading authority 不出现在 descriptor/metadata/result；code review 检查 loading facts 不进入 `agent-contracts` public schema。
  来源：spec requirement "本地 Skill Source 只暴露安全 Facts"；design D7
- [x] 6.3 确保 local Skill discovery、diagnostics、readiness、logs 和 safe errors 不暴露 raw local path、Agent package internal layout、raw manifest content、full Skill body、credential 或 secret。
  验证：safety/redaction tests 覆盖 missing manifest、invalid manifest、source unavailable、duplicate rejected、shadowed diagnostic；断言输出只包含 safe provider/source/capability/outcome fields。
  来源：spec requirement "本地 Skill Source 只暴露安全 Facts"；design D8
- [x] 6.4 增加负例：客户端请求、模型输出、Skill manifest metadata、descriptor metadata、runtime command 或 capability arguments 尝试修改 `configRoot`、`workspaceRoot`、Agent package root、system local root 时必须被忽略或安全拒绝。
  验证：configuration / request schema / manifest metadata negative tests 实际构造越界输入并断言 root 不变或请求失败。
  来源：spec scenario "非可信输入不能覆盖 configRoot 或 agentsRoot"；design D2

## 7. Diagnostics 与 Readiness

- [x] 7.1 实现 implementation-local local Skill diagnostics/readiness evidence，覆盖 system source disabled、system source unavailable、derived Agent package root invalid、Agent package root unavailable、candidate ignored、missing `SKILL.md`、manifest invalid、governance unavailable、duplicate rejected、Agent-owned shadow system-level 和 successful governed registration。
  验证：focused diagnostics tests 覆盖每个 outcome code；successful registration 必须来自 governed catalog result，不得只因 manifest parsed 成功。
  来源：spec requirement "本地 Skill Diagnostics 可解释 Source、Manifest、Governance 和 Shadowing Outcome"；design D8
- [x] 7.2 将 local Skill diagnostics 聚合到 startup/readiness 或 capability diagnostics 的现有 implementation-local evidence 边界，不新增 Web API、stream event、audit schema 或 public readiness DTO。
  验证：architecture check / code review 确认无新增 public readiness DTO、Web route、stream event 或 audit schema；tests 通过 implementation-local evidence 观察 diagnostics。
  来源：design D8；proposal 变更范围
- [x] 7.3 确认 Catalog public response 不承载 local Skill diagnostics。
  验证：Catalog `listAvailable` / `resolve` response contract tests 断言不新增 diagnostics payload；SEARCH failure、missing `skills/`、manifest invalid 时只通过 implementation-local evidence 观察，并且返回空候选或排除失败 candidate。
  来源：spec requirement "本地 Skill Diagnostics 可解释 Source、Manifest、Governance 和 Shadowing Outcome"；design D8

## 8. 验证和收尾

- [x] 8.1 运行 local Skill source focused tests，覆盖 `configRoot/skills`、`configRoot/agents`、locator、EAGER discovery、SEARCH discovery、manifest reuse、Catalog visibility、Agent scope、binding filtering、shadowing、duplicates 和 safety diagnostics。
  验证：勾选前记录精确测试命令和结果；建议覆盖 `agent-capability`、`agent-app` 和 contract/integration 相关测试文件。
  来源：design 验证映射
- [x] 8.2 运行 architecture checks，覆盖 public contract expansion、private path import、runtime/core/context source scanning、source-private loading facts 泄漏、provider kind vocabulary 未扩展和 `workspaceDir/skills` 禁止作为 Agent-owned root。
  验证：`npm run lint:architecture`；如新增 forbidden-pattern tests，记录对应测试结果。
  来源：design Quality Attributes；AGENTS.md 验证门禁
- [x] 8.3 运行标准质量门禁。
  验证：`npm run build`、`npm test`、`npm run test:contract`
  来源：AGENTS.md 验证门禁
- [x] 8.4 运行 OpenSpec 验证。
  验证：`openspec validate add-ts-local-skill-source --strict`；归档前再运行 `openspec validate --all --strict`
  来源：AGENTS.md 验证门禁；openspec-propose workflow

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/local-skill-source/spec.md`。
- 按需更新 `openspec/specs/app-config-schema/spec.md`、`openspec/specs/agent-package-assembly/spec.md` 和 `openspec/specs/capability-source-configuration/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/capability-spi.md` 和 `openspec/designs/architecture/skill-manifest-contract.md`。
- 按需更新 `openspec/designs/modules/agent-app.md` 和 `openspec/designs/modules/agent-capability.md`。
- 如实施中产生长期取舍，按需新增或更新 `openspec/designs/adr/<id>.md`。
- 更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义 `configRoot/agents` locator、local Skill source layout、Catalog injection、Agent scope visibility、priority/shadowing 或 source-owned loading authority。
