## 1. 实施前规格检查

- [x] 1.1 冻结 builtin Skill provider identity、package-owned bundled resource root、manifest 复用、catalog governance、safe diagnostics、framework-default builtin Tool / Skill catalog injection 和首版 required 电信 Skill `telecom-domain-qa` 要求。
  验证：`openspec validate add-ts-builtin-skill-source --strict`
- [x] 1.2 冻结唯一实施路径：builtin source 只产出 candidate/source facts、safe readiness evidence 和 source-owned internal loading facts；Catalog 基于 governed builtin descriptors 默认纳入 framework-default builtin Tool / Skill，invocation、routing、Skill 内容执行和 model behavior 继续由既有 owner 或后续 change 定义。
  验证：对照 `openspec/designs/architecture/capability-spi.md` 和 `skill-manifest-contract.md` 做设计检查
- [x] 1.3 刷新与 `establish-ts-backend-architecture`、`establish-ts-core-contracts`、`add-ts-skill-manifest-contract`、`add-ts-capability-core-governance`、`add-ts-agent-package-assembly` 以及并行 inline/fork Skill execution changes 的一致性。
  验证：design 只 refinement `agent-contracts/agent-assembly` 的 binding fact 语义，不扩展 capability descriptor、catalog request/response、invocation 或 readiness public contract，不引入第二条 Skill execution path

## 2. Builtin Skill Source

- [x] 2.1 在 `agent-capability` 中新增 `providerId="builtin-skills"`、`providerKind=BUNDLED` 的 builtin Skill provider 常量，并保持 BUNDLED provider 只由 trusted capability subsystem 代码创建。
  验证：单元测试断言 builtin Skill provider identity 和 provider kind；contract/schema 测试确认没有新增 provider kind
- [x] 2.2 在 `agent-capability` 中新增 package-owned builtin Skill resource root，用于框架打包 Skill。
  验证：测试或断言覆盖 package-owned root 的使用，并确认外部配置和用户输入不会改变 root
- [x] 2.3 新增 `BuiltinSkillDiscovery implements CapabilityDiscovery`，作为唯一 source-owned builtin Skill discovery adapter；它只枚举 package-owned root 下的一级子目录，并忽略隐藏目录和嵌套 Skill 目录。
  验证：单元测试覆盖有效一级 candidate、隐藏目录忽略、缺失 `SKILL.md`、嵌套 `SKILL.md` 不发现、factory exact-match 创建、无 fallback/order-based selection、无 raw path 出现在 descriptor/diagnostic
- [x] 2.4 对每个 builtin `SKILL.md` 复用 `parseSkillFrontmatter` 和 `mapSkillFrontmatterToDescriptor`。
  验证：单元测试对比 builtin Skill descriptor、metadata 和 diagnostics 与现有 manifest contract 行为一致，包括 rejected 和 degraded manifest
- [x] 2.5 Discovery 只输出 provider facts、manifest-derived descriptor facts、source trust/enablement facts、safe availability input、safe diagnostics 和保留在 source 边界内的 internal loading facts。
  验证：negative tests 断言 descriptor fields 和 metadata 不包含 root path、resource URI、raw manifest/body、loading key、content loading authority、provider-private config 或 full Skill content
- [x] 2.6 实现 trusted source enablement：默认 enabled；trusted product/test composition 可以禁用 source；source disabled 时不产生 executable catalog entry，并输出安全 readiness/diagnostic evidence。
  验证：单元/contract 测试断言默认 enabled；只有 trusted product/test composition 可禁用；Agent package、Agent definition、workspace config、client input、model output、manifest metadata、descriptor metadata 和 external provider config 不能禁用 source；disabled source 在 `listAvailable(... includeUnavailable=false)` / `resolve` 中不可见，并报告安全 disabled outcome

## 3. Catalog Governance 与 Agent 装配

- [x] 3.1 通过显式可信 startup chain 注册 `builtin-skills`：provider constant、`DefaultCapabilityDiscoveryFactory` exact-match branch、`createCapabilitySubsystem()` eager discovery、`StaticCapabilityCatalog` eager discovery list 和 `agent-app` startup resource provider registry。
  验证：startup/composition 和 catalog 测试断言 builtin Skill discovery 存在于 catalog startup discoveries；有效 builtin Skill 只通过正常 `listAvailable` / `resolve` 可见；resource provider registry 包含 `builtin-skills`；external `BUNDLED` provider config 继续 rejected；任何 external provider config 使用 `providerId=builtin-skills` 都被 rejected
- [x] 3.2 保持 owner 分工：`agent-app` assembly compiler 负责 binding shape/type/provider validation 和 explicit enabled / disabled fact 传递；Capability Catalog 基于 governed descriptors、framework-default builtin rules 和 runtime-facing explicit binding facts 生成可见能力，并继续拥有 availability filtering、conflict resolution、model visibility 和 invocation eligibility。
  验证：测试覆盖默认 builtin Skill 对每个 Agent 可见、显式禁用后 runtime-facing assembly 保留 disabled fact 且 catalog 不可见、unavailable builtin Skill 按 diagnostics 呈现、provider conflict 由既有 conflict resolver 处理；catalog 测试确认 catalog 不读取 Agent definition、不扫描 builtin source
- [x] 3.3 增加首个 packaged framework-default telecom Skill candidate `telecom-domain-qa`，authoring path 为 `packages/agent-capability/src/builtins/skills/telecom-domain-qa/SKILL.md`，使用标准 `SKILL.md` frontmatter 且 manifest stable identity 必须是 `name: telecom-domain-qa`。
  验证：packaging/source test 能按 stable identity `telecom-domain-qa` 发现该 Skill，并用标准 parser 校验 manifest
- [x] 3.4 在 Capability Catalog 中实现 framework-default builtin Tool / Skill 默认注入：trusted `builtin-tools` / `builtin-skills` governed descriptors 默认作为每个 Agent 的候选 capability。
  验证：catalog 测试断言每个 Agent 在无 explicit binding 时可见默认 builtin Tool / Skill；Catalog 只基于 governed descriptors 和 trusted provider identity 注入默认 builtin，不依赖 Agent App seed/list
- [x] 3.5 增加 required framework-default builtin identities 的 readiness consistency check；required builtin Skill stable identity `telecom-domain-qa` 必须映射到有效发现的 `SKILL.md` manifest name 或 stable governed capability id，required builtin Tool stable identity 必须映射到 owned builtin Tool descriptor。
  验证：当 required builtin Skill / Tool missing、invalid 或 governance-unavailable 时，readiness 输出安全 failure/degraded outcome
- [x] 3.6 实现 framework-default builtin Tool / Skill 的显式禁用语义；runtime-facing `AgentAssembly.capabilityBindings` 保留同 key `enabled=false` fact，Catalog 对该 Agent 不暴露该 capability。
  验证：Agent assembly/catalog 测试断言 override key 为 `providerId + capabilityType + capabilityId`；同 key `enabled=false` 排除默认 capability；同 key `enabled=true` 去重；disabled non-default target 不触发 source scan fallback；disabled default 不报告为该 Agent 的 source/readiness failure
- [x] 3.7 更新 `AgentAssembly.capabilityBindings` contract、default assembly 和 assembly compiler，使 runtime-facing assembly 支持 optional `enabled` binding fact，缺省或 `enabled=true` 表示显式启用，`enabled=false` 表示显式禁用，并且默认 Agent 通过 Catalog default injection 获得 framework-default builtin Tool / Skill 可见性。
  验证：unit/contract 测试覆盖既有 Tool binding 兼容、缺省 `enabled` 等价 enabled、Skill binding 接受、disabled binding fact 被保留、unknown type rejected、descriptor 缺失不导致 assembly 失败；`default-agent-assembly` 不再依赖硬编码 `builtin-tools/read` binding 获得默认 read 可见性
- [x] 3.8 更新 `ResourceInventoryCapability` 和 assembly validation，保留既有 capability vocabulary 中的 `SKILL`，并保持 unknown capability type 安全拒绝。
  验证：unit/contract 测试覆盖 Tool/Skill descriptor kinds 保持、provider id 必须匹配 trusted startup resource provider registry、external provider config 不能冒用 reserved builtin provider id；explicit binding 只做 shape/safe id/type/registered provider id 校验，不因装配阶段缺少 descriptor 失败；descriptor existence/availability/conflict 由 catalog `listAvailable` / `resolve` 判断

## 4. Diagnostics 与 Readiness

- [x] 4.1 实现 implementation-local safe readiness evidence，覆盖 source disabled、candidate ignored、missing `SKILL.md`、invalid manifest、governance unavailable/degraded 和 successful governed registration。
  验证：focused tests 断言 evidence 只包含 stable provider id、stable Skill identity、safe outcome code 和 sanitized message；不新增 Web API/stream/audit/metric/agent-contracts readiness DTO 或 generic readiness service；evidence 排除 raw local path、resource URI、package layout、raw manifest/body、loading key、secret 和 unsafe metadata
- [x] 4.2 增加 required telecom builtin Skill stable identity `telecom-domain-qa` 的 release readiness consistency check；missing、manifest invalid、discovery-only success 或 governance unavailable 必须产生安全 failure/degraded outcome；successful readiness 必须来自 governed registration。
  验证：focused readiness tests 覆盖 missing candidate、invalid manifest、governance unavailable、discovery-only success not fully ready 和 successful governed registration

## 5. 边界与执行交接

- [x] 5.1 确认 builtin Skill source 只覆盖 discovery、catalog default injection、explicit disable 和 readiness，不定义 inline/fork execution、tool loop、sandbox、audit、idempotency、SkillHub、nested invocation、progressive disclosure、prompt content、answer quality 或 model provider strategy。
  验证：architecture test 或 code review checkpoint 确认没有 source-private invocation envelope、没有 model/core/runtime routing change、discovery 不加载 full body
- [x] 5.2 保留 source-owned content loading facts 作为后续授权 invocation handler 的内部输入，并保持这些 facts 不出现在 public descriptor 或安全输出中。
  验证：content-loading negative tests 断言 discovery 不把 full content、loading key 或 content loading authority 放入 descriptors、metadata、request body、model context、stream、safe error、audit、metric、diagnostic 或 logs
- [x] 5.3 与 `add-ts-inline-skill-execution` / `add-ts-fork-skill-execution` 对齐：后续 change 可以在 catalog resolve 后消费 provider-owned loader；本 change 只 refinement `agent-contracts/agent-assembly` optional `enabled` binding fact，不新增 capability descriptor、invocation request/result 或 Skill execution public contract 字段。
  验证：design/code review checkpoint 确认共享边界是 implementation-owned adapter，不是 public descriptor 或 request contract

## 6. 验证

- [x] 6.1 运行 builtin Skill source、manifest 复用、catalog governance、framework-default catalog injection、explicit disable、diagnostics 和 readiness 的 focused unit / contract tests。
  验证：勾选前记录精确测试命令和结果
- [x] 6.2 运行 architecture checks，覆盖 public contract expansion、private path import、source-private descriptor metadata 和 Agent assembly/source scanning。
  验证：`npm run lint:architecture`；如实现引入新 public abstraction，增加 forbidden-pattern checks
- [x] 6.3 运行标准质量门禁。
  验证：`npm run build`、`npm test`、`npm run test:contract`
- [x] 6.4 运行 OpenSpec 验证。
  验证：`openspec validate add-ts-builtin-skill-source --strict`；归档前再运行 `openspec validate --all --strict`

## 归档前基线提升检查（非实施任务）

- [x] 7.1 同步 builtin Skill source 相关长期 capability source 基线。
  验证：长期 spec/design 与本 change 的 provider identity、root owner、catalog default injection、explicit disable 和 readiness 边界一致
- [x] 7.2 按需更新 capability governance、Agent package assembly 和 release readiness 相关长期设计索引。
  验证：长期索引能指向归档后的 builtin Skill source 能力定义
- [x] 7.3 检查长期文档没有重复定义 builtin provider identity、manifest schema、catalog registration、content loading authority 或 Skill execution 语义。

## 实施验证记录

- `npm run build`：通过，且 build 后 `packages/agent-capability/dist/builtins/skills/telecom-domain-qa/SKILL.md` 存在。
- `npx vitest run packages/agent-capability/tests/builtin-skill-source.test.ts packages/agent-capability/tests/skill-manifest.test.ts tests/agent-kernel/capability-governance.test.ts tests/agent-kernel/config-assembly.test.ts tests/architecture/builtin-skill-source-packaging.test.ts`：5 files / 27 tests 通过。
- `npm test`：28 files / 153 tests 通过。
- `npm run test:contract`：2 files / 21 tests 通过。
- `npm run lint:architecture`：dependency-cruiser 和 package manifest policy 通过。
- `openspec validate add-ts-builtin-skill-source --strict`：通过。
- `openspec validate --all --strict`：8 items 通过。
- `$nextagent-code-review` push 前语义检视：已检查 diff、OpenSpec 覆盖、contract/architecture 边界、packaged resource build 路径和验证证据；未发现阻断项。
  验证：归档 review 记录检查结果
