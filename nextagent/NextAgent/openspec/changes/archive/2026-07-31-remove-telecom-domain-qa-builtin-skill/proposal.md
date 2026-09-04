## 背景与问题（Why）

`telecom-domain-qa` 当前同时被定义为 required framework-default builtin Skill、`agent-capability` 包内资源和 release package 的 system-local 预装资源。该业务 Skill 会默认进入所有 Agent 的可见 Capability Catalog，并随本地运行包部署，因而把特定电信问答行为注入不需要该能力的业务 Agent，造成能力披露、路由和回答行为相互影响。

系统仍需要通用的 `builtin-skills` provider、标准 `SKILL.md` discovery 和 Skill 调用机制，但不应把某个具体业务 Skill 固化为框架必需能力。现在必须移除这一特例，使 Agent 的业务 Skill 集合只由实际保留的 bundled resources、可信 system-local resources、Agent package bindings 或其他受治理 provider 决定。

## 变更范围（What Changes）

- **BREAKING**：从框架资源、默认 Catalog 可见集合和 release package 预装集合中移除 `telecom-domain-qa`；依赖该 capability identity 的 Agent 必须通过受治理的非预制 Skill source 显式提供并绑定相应能力。
- 删除 `telecom-domain-qa` 的 package-owned `SKILL.md` 资源，以及围绕该唯一 identity 建立的 required builtin Skill 常量和 readiness 特例。
- 保留 `builtin-skills` provider、package-owned resource root、EAGER discovery、manifest validation、catalog governance、source enablement 和安全诊断；剩余 bundled Skill 仍按相同通用路径工作。
- release packaging 不再把任何具体 builtin Skill 强制复制到 `systemSkillsRoot`，也不再维护 `telecom-domain-qa` 预装清单。
- 将只用于验证通用 Skill 协议的测试数据改为中性 capability identity；新增负向验证，确保源码、默认 catalog 和 release archive 不再包含 `telecom-domain-qa`。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `builtin-skill-source`：移除 required `telecom-domain-qa` candidate、默认注入和专属 readiness 语义；保留按实际 bundled resources 发现和治理 builtin Skills 的通用行为。

## 影响范围（Impact）

- 代码：`packages/agent-capability` 的 builtin Skill 资源、identity/readiness 实现与相关 public exports。
- 打包：`scripts/pack-local-runtime.mjs` 的 builtin Skill dependency staging 和 system-local 预装逻辑。
- 运行行为：默认 Agent 不再获得 `telecom-domain-qa`；保留的 `skill-creator` 及其他受治理 Skill source 不受影响。
- API/契约：不修改 `agent-contracts`、Web DTO、Capability invocation contract 或 provider identity。
- 测试与文档：builtin discovery/catalog、minimal kernel、architecture、packaging、smoke/E2E fixture 及直接引用该预制 Skill 的开发文档。
- 运维：新生成的本地运行包不再包含 `skills/telecom-domain-qa`，也不得在 `node_modules/@nextagent/agent-capability/dist/builtins/skills` 中残留该资源。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/builtin-skill-source/spec.md`：移除具体 required telecom Skill identity 和专属 readiness 要求，保留通用 builtin Skill source 契约。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/capability-spi.md`：移除 framework-required `telecom-domain-qa` 的稳定设计事实，保留 bundled provider 通用路径。
- `openspec/designs/modules/agent-capability.md`：更新 package-owned builtin Skill 资源和 readiness 职责说明。
- `openspec/designs/adr/<id>.md`：无；本变更不引入新的长期技术决策。
- `openspec/designs/spec-to-design-map.md`：无需改变 capability 映射；归档时确认现有验证入口已更新。

验证入口：
- `packages/agent-capability/tests/builtin-skill-source.test.ts`
- `tests/agent-kernel/capability-governance.test.ts`
- `tests/architecture/builtin-skill-source-packaging.test.ts`
- `tests/fullstack-packaging-boundary.test.ts`
- `npm run build`
- `npm test`
- `npm run test:contract`
- `npm run lint:architecture`
- `openspec validate --all --strict`
- `npm run pack:release -- skip` 后检查 release archive
