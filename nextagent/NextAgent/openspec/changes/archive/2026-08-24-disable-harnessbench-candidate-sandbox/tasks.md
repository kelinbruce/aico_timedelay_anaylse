## 1. `FN-10.13 HarnessBench 评测`

- [x] 1.1 在 HarnessBench 候选配置测试中增加 `sandbox.enabled=false` 断言；变更前该测试可复现当前配置与目标行为不一致
  来源：`FN-10.13 HarnessBench 评测` + Requirement `候选任务固定使用可信 shell 模式` + Scenario `执行任务生成固定候选配置`
  验证：已运行 `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/execution-reliability.test.ts`；实现前结果为 1 个断言失败、3 个通过，失败明确显示 `expected true to be false`

- [x] 1.2 将 `buildHarnessCandidateConfig` 的 HarnessBench 候选 sandbox 模式固定为 `sandbox.enabled=false`，保持 gateway 路径、其余配置和产品默认值不变
  来源：`FN-10.13 HarnessBench 评测` + Requirement `候选任务固定使用可信 shell 模式` + Scenarios `执行任务生成固定候选配置`、`任务内容不得改变候选执行模式`、`评测外产品配置保持原有语义`；design `FN-10.13 HarnessBench 评测 / 修改方案`
  验证：已运行 `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/execution-reliability.test.ts`；结果为 1 个测试文件、4 个测试全部通过，配置断言为 `false`

## 2. Change 整体验证

- [x] 2.1 验证 HarnessBench 测试、OpenSpec strict gate 和变更范围，确保无 `packages/**` 或产品配置契约变更
  来源：proposal `影响范围` + design `验证策略`
  验证：已运行 `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests`（9 个测试文件、73 个测试全部通过）、`openspec validate disable-harnessbench-candidate-sandbox --strict`（valid）、`openspec validate --all --strict`（295 项通过、0 失败）、`git diff --check`（无错误，仅既有 LF/CRLF warning）和 `git diff --name-only -- packages`（输出为空）

## 归档前更新基线检查（非实施任务）

归档流程按照 design 的“长期基线刷新计划”同步 `harnessbench-evaluation` stable spec 和 `FN-10.13 HarnessBench 评测`，并确认 Feature、architecture、modules、ADR 与 spec-to-design-map 无需变化。
