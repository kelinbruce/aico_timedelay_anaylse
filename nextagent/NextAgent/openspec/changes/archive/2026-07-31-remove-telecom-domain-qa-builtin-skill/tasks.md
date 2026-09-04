## 1. 规格与边界确认

- [x] 1.1 严格校验并语义检视本 change，确认唯一实现路径是“保留通用 builtin provider，删除具体资源、required identity 与 release 预装特例”，且不修改 `agent-contracts`。
  验证：`openspec validate remove-telecom-domain-qa-builtin-skill --strict`；按 `$nextagent-skill-review` 检查 proposal、spec、design、tasks 和当前代码。
  来源：proposal Capability 影响；design 决策 1 至 4。

## 2. agent-capability 目标态

- [x] 2.1 删除 `telecom-domain-qa` package-owned Skill 资源、`requiredBuiltinSkillId` 和专属 required readiness evaluator/outcome，不保留 alias、空壳或 fallback。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/builtin-skill-source.test.ts`；`rg -n "requiredBuiltinSkillId|evaluateRequiredBuiltinSkillReadiness" packages/agent-capability/src` 无结果。
  来源：Requirement“默认源码和发布包不得提供 telecom-domain-qa”；design 决策 1。

- [x] 2.2 更新 builtin discovery 与 Catalog 产品测试，断言剩余 `skill-creator` 继续通过通用 provider 可见，且默认结果中不存在 `telecom-domain-qa`。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/builtin-skill-source.test.ts tests/agent-kernel/capability-governance.test.ts tests/architecture/builtin-skill-source-packaging.test.ts`。
  来源：Requirement“Framework-Default Builtin Capabilities 默认由 Catalog 对每个 Agent 启用并支持禁用”；Requirement“Builtin Skill Diagnostics 安全可解释”。

## 3. 发布打包目标态

- [x] 3.1 删除 `preinstalledSystemSkills` 与 system-local Skill 强制复制路径，使 release packaging 只组装实际 workspace dist 和调用方显式指定的 archive exclusion。
  验证：`npx vitest run --config vitest.config.release.ts tests/fullstack-packaging-boundary.test.ts`；测试必须断言 package root 和 packaged dependency 均不存在目标 Skill。
  来源：Requirement“默认源码和发布包不得提供 telecom-domain-qa”；design 决策 2。

- [x] 3.2 重新生成 Windows release archive，并以 archive listing 负向断言 `skills/telecom-domain-qa` 与 packaged builtin resource 均不存在，同时确认 `skill-creator` 仍存在。
  验证：`npm run pack:release -- skip`；`tar -tf nextagent-local-win32-x64.zip` 的目标路径检查。
  来源：Scenario“本地运行发布包不预装 telecom-domain-qa”；design 验证映射。

## 4. 通用调用方与文档去耦

- [x] 4.1 将仅用于验证通用 Skill 调用、上下文披露、workflow、contract 或 Web projection 的当前测试 fixture 改为中性 Skill identity，保持原有黑盒断言不变。
  验证：`npm test`；`npm run test:contract`；在 `frontend/agent-web` 运行受影响的 Vitest 测试。
  来源：proposal 测试影响；design 决策 3。

- [x] 4.2 更新直接面向当前实现的开发与使用文档，移除将 `telecom-domain-qa` 描述为当前预制 Skill、示例或源码入口的内容；历史 archive artifact 和历史特性记录保持不变。
  验证：`rg -n "telecom-domain-qa" docs --glob "!NextAgent测试特性树.md"` 仅允许不存在当前实现语义的历史说明；人工检查示例使用中性名称。
  来源：proposal 影响范围；design 决策 3。

## 5. 门禁与收尾

- [x] 5.1 运行后端与 OpenSpec 门禁，确认删除不破坏通用 Skill provider、最小内核和架构边界。
  验证：`npm run build`；`npm test`；`npm run test:contract`；`npm run lint:architecture`；`openspec validate --all --strict`。
  来源：design 质量属性设计与验证映射。

- [x] 5.2 检查最终 diff 和生产路径引用，确认未修改 `agent-contracts`、未留下本次产生的临时文件，且 `telecom-domain-qa` 仅存在于 active change、stable/archived OpenSpec 历史和明确保留的历史记录。
  验证：`git diff --check`；`git status --short`；`rg -n "telecom-domain-qa" packages scripts tests frontend docs openspec` 并逐项分类。
  来源：proposal 非目标；design 决策 4、风险与取舍。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/builtin-skill-source/spec.md`。
- 更新 `openspec/designs/architecture/capability-spi.md`。
- 更新 `openspec/designs/modules/agent-capability.md`。
- 确认 `openspec/designs/spec-to-design-map.md` 的导航和验证入口。
- 不新增 ADR，不更新 `openspec/overview.md`。
- 检查长期文档没有重复定义 builtin provider、Catalog 默认候选或 readiness 语义。
