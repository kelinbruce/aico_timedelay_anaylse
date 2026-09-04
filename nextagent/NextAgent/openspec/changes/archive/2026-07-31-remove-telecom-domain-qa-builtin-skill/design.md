## 背景和现状（Context）

`agent-capability` 当前拥有通用 `builtin-skills` provider、package-owned resource root 和 `BuiltinSkillDiscovery`。该通用路径可以发现多个一级 `SKILL.md` candidate，目前资源根包含 `skill-creator` 与 `telecom-domain-qa`。

现状中又叠加了两个只服务 `telecom-domain-qa` 的特例：

1. `requiredBuiltinSkillId` 与 `evaluateRequiredBuiltinSkillReadiness()` 把该 identity 固化为 required readiness 目标。
2. `scripts/pack-local-runtime.mjs` 先从 packaged `agent-capability` 中排除该 Skill，再把它复制到 release package 的 `systemSkillsRoot`，形成第二个预装位置。

因此只删除 `SKILL.md` 会留下 readiness 和打包强依赖，导致测试或 release packing 失败；只修改打包则仍会让开发态 Catalog 默认披露该 Skill。当前实现与目标规格之间的 gap 是：生产源码和 release staging 仍显式维护 `telecom-domain-qa`，而目标态要求框架不再提供该具体业务能力。

本变更不触达 `agent-contracts`。现有 `CapabilityDescriptor`、`CapabilityCatalog`、`CapabilityInvocationPort`、provider identity 和 Agent binding shape 足以表达目标行为。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 从 package-owned builtin Skill resource 中删除 `telecom-domain-qa`。
- 删除该 identity 的 required readiness 常量、判断和 public export。
- 删除 release package 中针对该 Skill 的排除后再预装逻辑。
- 保留 `builtin-skills` provider、`BuiltinSkillDiscovery`、catalog governance、explicit binding 和剩余 builtin Skill 行为。
- 让产品测试、架构测试和 release archive 以黑盒结果证明该 Skill 不再被默认提供。

**非目标：**

- 不删除或禁用通用 Skill capability、`Skill` Tool、SkillHub、system-local Skill、Agent-owned Skill 或 runtime-generated Skill。
- 不禁止部署方通过非预制 source 提供同名 Skill。
- 不修改 Web API、stream event、runtime lifecycle、persistence、Agent Scope、Owner Scope 或 sandbox contract。
- 不新增配置开关、兼容 alias、空壳 Skill、fallback 或替代业务 Skill。
- 不重写与默认预制行为无关的测试逻辑；仅把把目标 identity 当作通用 fixture 的位置改为中性名称。

## 设计决策（Decisions）

### 1. 保留 provider，删除具体资源和 required identity 特例

唯一实现路径是保留 `builtin-skills` provider 与目录发现机制，删除：

- `packages/agent-capability/src/builtins/skills/telecom-domain-qa/`
- `requiredBuiltinSkillId`
- `evaluateRequiredBuiltinSkillReadiness()` 及只被该函数使用的 governance-unavailable outcome

`BuiltinSkillDiscovery.listAll()` 继续按实际目录产生 descriptor 和安全 evidence。Catalog 继续把实际受治理的 bundled Skill descriptors 作为默认候选，因此 `skill-creator` 保持可用，但系统不合成 source 中不存在的 required Skill。

未选择“把 required identity 改成另一个 Skill”，因为这会把同一业务耦合迁移到新名称；未选择“保留空壳并默认禁用”，因为空壳仍会占据 capability identity 并增加误披露和维护成本。

### 2. release packaging 只打包 workspace dependency 中实际存在的 builtin resources

删除 `preinstalledSystemSkills`、`stagePreinstalledSystemSkills()` 和“先排除、再复制到 system root”的双路径。`stagePackageDependencies()` 继续复制 `@nextagent/agent-capability` 的实际 dist，现有 `--exclude-builtin-skill` 仍可用于调用方明确要求的归档裁剪。

release package 的 `systemSkillsRoot` 不再由 pack script 注入任何具体预制 Skill。部署方提供的 system-local Skills 属于部署资源，不由本 change 自动生成。

未选择保留空数组配置或新的 deny list，因为删除唯一调用方后这些结构没有产品价值。

### 3. 测试分为产品负向断言与通用协议 fixture

- builtin source/product tests 断言默认 discovery 包含仍受支持的 `skill-creator` 且不包含 `telecom-domain-qa`。
- packaging tests 断言 packaged dependency 和 archive 均不包含目标 Skill，也不再期待 system-local 预装目录。
- 通用 Tool、context、workflow、Web projection 测试若只需要任意 Skill identity，统一改用中性 fixture，例如 `network-diagnostics` 或 `sample-skill`；其通用协议断言不变。
- archived OpenSpec artifacts 和历史测试特性记录保持历史事实，不作为当前产品引用清理目标；stable OpenSpec 通过本 change delta 在归档时收敛。

### 4. 不引入新的跨包 contract

删除的是 package-private resource、实现常量和测试 helper。`agent-contracts` 无新增、删除、重命名或 shape 变化。Agent App 继续只消费 capability subsystem 暴露的 frozen provider facts 和 governed catalog，不感知具体 builtin Skill 清单。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 减少默认 model-visible 业务指令面；保留 trusted source、manifest validation 和目录信息不泄漏规则。非预制同名 Skill 仍必须经过既有 provider governance。 | builtin discovery 单元测试、catalog tests、architecture tests |
| 性能/容量 | 删除一个 EAGER candidate 和一份重复 package resource，只减少扫描、上下文披露与归档体积；不改变容量上限或并发策略。 | build/pack 产物检查、现有 catalog tests |
| 可靠性/恢复 | 移除“资源删除后 readiness 必然失败”的固定依赖；空或仅含其他 candidate 的 builtin root 按实际结果工作，不新增 retry、fallback 或状态迁移。 | 空目录/有效 candidate discovery tests、release package self-check |
| 可维护性 | 一个 Skill 只由一个受治理 source 提供；移除 builtin dist 与 system-local root 的重复 staging，以及具体 identity 特例。 | `rg` 生产引用检查、architecture lint、代码语义检视 |
| 可测试性 | 产品路径用负向断言证明不再预装；通用协议测试改用中性 fixture，避免测试名称反向固化已删除业务能力。 | targeted Vitest、root/contract tests、archive listing |
| 审计/可追溯性 | 保留现有按实际 candidate 产生的安全 discovery evidence；不再合成固定 identity 的 readiness 结果。无新增 audit/event schema。 | builtin readiness evidence tests、日志安全断言 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 默认源码与 Catalog 不包含 `telecom-domain-qa` | 2.1、2.2 | `builtin-skill-source.test.ts`、`capability-governance.test.ts`、source path negative assertion |
| 通用 builtin provider 和剩余 Skill 保持工作 | 2.2 | builtin discovery/catalog targeted tests |
| 不保留 required identity/readiness 特例 | 2.1 | TypeScript build、targeted tests、生产源码 `rg` |
| release package 不在 dependency 或 system root 预装目标 Skill | 3.1、3.2 | `fullstack-packaging-boundary.test.ts`、`pack:release -- skip`、ZIP listing |
| 通用 Skill 协议不依赖已删除业务名称 | 4.1 | root、contract、frontend targeted tests |
| OpenSpec 与架构边界一致 | 1.1、5.1 | `openspec validate --all --strict`、`nextagent-skill-review`、`npm run lint:architecture` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/builtin-skill-source/spec.md` 主承载 builtin discovery、默认候选和不再预装具体 Skill 的可验证行为。
- 架构和跨模块设计：`openspec/designs/architecture/capability-spi.md` 主承载 builtin provider 与 Catalog 协作；不新增接口或状态机。
- 模块设计：`openspec/designs/modules/agent-capability.md` 主承载 package-owned builtin resource 与 discovery 职责；release staging 的实现入口由相关部署文档导航。
- ADR：无。本变更是对既有 owner 边界的简化，不新增需要独立保留的技术取舍。
- 导航：`openspec/designs/spec-to-design-map.md` 继续映射 `builtin-skill-source`，归档时仅校准验证入口。

## 风险与取舍（Risks / Trade-offs）

- [风险] 现有 Agent 或测试显式调用 `telecom-domain-qa` 后会得到 capability unavailable。 -> 这是本次 BREAKING 目标；需要该能力的部署方必须通过受治理的非预制 source 提供并绑定。
- [风险] 仅删除源码可能在已有 dist 或旧 ZIP 中留下陈旧资源。 -> build 强制重建 workspace dist；验收重新生成 ZIP，并同时检查源码、dist staging 和 archive。
- [风险] 批量替换测试 fixture 可能误改历史规范。 -> 只修改当前产品代码、测试和直接使用指南；archive 目录保留历史事实，stable spec 由 delta 归档流程处理。
- [取舍] `builtin-skills` provider 即使未来没有任何 candidate 也继续存在。 -> provider 是通用稳定边界，保留它比为当前资源数量引入条件装配更简单，也避免破坏 provider binding contract。

## 迁移计划（Migration Plan）

1. 先合入 active change、源码删除、实现收敛和测试更新。
2. 重新执行 workspace build，确保 dist 不携带旧资源。
3. 重新生成 release package，并在发布前检查 archive 中不存在目标路径。
4. 需要该能力的部署方在升级前将其作为 system-local、Agent-owned、SkillHub 或其他受治理 Skill 部署并完成 Agent binding。

回滚只需恢复该 change 对源码、readiness 和打包预装的完整改动；不得只恢复单个 `SKILL.md`，以免再次形成实现与规格不一致。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/builtin-skill-source/spec.md`：移除 required telecom candidate requirement，改为实际 bundled descriptors 驱动默认候选，并保留不再预装目标 Skill 的负向契约。
- `openspec/designs/architecture/capability-spi.md`：删除固定 required business Skill identity/readiness 事实，保留 provider、governance 和 explicit binding 边界。
- `openspec/designs/modules/agent-capability.md`：更新 package-owned resource 与通用 discovery 职责。
- `openspec/designs/spec-to-design-map.md`：保持 capability 映射，更新或确认验证入口。
- `openspec/overview.md`：无。
- `openspec/designs/adr/<id>.md`：无。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-5.8-发现技能` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/builtin-skill-source/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
