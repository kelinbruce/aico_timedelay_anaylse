## 1. `FN-10.13 HarnessBench 评测`

- [x] 1.1 先更新执行可靠性 contract test，使生成的 candidate config 必须固定输出 `maxOutputTokens=16384`、`timeoutMs=540000`，并继续断言 terminal `780 s` 与 generic CLI `900 s`；实现前运行并确认新预算断言失败。
  来源：`FN-10.13 HarnessBench 评测` + 系统质量属性“性能/容量、可靠性/恢复、可测试性” + Requirements `候选模型使用固定的基础输出预算`、`候选模型使用固定的单次调用超时` + Scenarios `标准全量运行使用固定候选预算`、`输出恢复覆盖基础预算`、`标准全量运行使用固定调用超时`、`terminal 截止早于模型调用截止`
  验证：运行 `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/execution-reliability.test.ts`；实现前预期新预算断言失败，实施后预期全部通过。
  实际证据（2026-08-14）：新增目标断言后运行上述命令，1/2 测试按预期失败；实际 config 为 `maxOutputTokens=8192`、`timeoutMs=300000`，目标为 `16384`、`540000`。默认 Vitest config 不收集该目录，已将命令修正为仓库既有 release config。

- [x] 1.2 在 HarnessBench evaluation config 中固定 `16384 tokens` 初始输出预算和 `540000 ms` 单次模型调用超时，并让 candidate config builder 只消费这两个固定值；不得增加环境变量、task id、task 类型或模型名分支，不修改 `packages/**`。
  来源：design `FN-10.13 HarnessBench 评测/修改方案`；Requirements `候选模型使用固定的基础输出预算`、`候选模型使用固定的单次调用超时` + Scenarios `标准全量运行使用固定候选预算`、`定向回归与标准全量保持同一预算`、`标准全量运行使用固定调用超时`、`定向回归使用相同调用超时`
  验证：运行 `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/execution-reliability.test.ts tests/harnessbench/tests/nextagent-cli.test.ts`；预期 candidate config 固定为目标值且 CLI 集成测试全部通过。运行 `git diff --name-only -- packages`；预期无输出。
  实际证据（2026-08-14）：上述 Vitest 命令通过 2 files / 16 tests；`git diff --name-only -- packages` 无输出，确认未修改产品 packages。

- [x] 1.3 完成 HarnessBench 定向回归，证明新模型预算不改变 failure classification、结果收集、评分或 non-scoring profile 语义，并确认不存在 candidate budget 的动态覆盖入口。
  来源：`FN-10.13 HarnessBench 评测` + 系统质量属性“可靠性/恢复、可测试性” + Requirements `候选模型使用固定的基础输出预算`、`候选模型使用固定的单次调用超时`；design `验证策略`
  验证：运行 `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests`；预期全部通过。运行 `rg -n "HARNESSBENCH_MODEL_MAX_OUTPUT_TOKENS|HARNESSBENCH_MODEL_TIMEOUT_MS|maxOutputTokens:|timeoutMs:" tests/harnessbench` 并人工检查候选模型预算只来自固定 evaluation config，预期不存在环境变量或 task-specific override。
  实际证据（2026-08-14）：定向回归通过 9 files / 63 tests。首次运行发现 output-limit 夹具仍使用旧 `8192` 阈值，已同步为 `16384` 后通过；源码检查确认 candidate 基础输出预算与单次调用超时只由 `evaluation-config.mjs` 固定提供，无环境变量或 task-specific override。

## 2. Change 整体验证

- [x] 2.1 完成 strict OpenSpec、contract、architecture 与 diff hygiene 验证，确认 P1 仅改变 HarnessBench 评测配置且不修改产品 package 边界。
  来源：proposal `影响范围`；design `验证策略`
  验证：运行 `openspec validate raise-harnessbench-model-output-budget --strict`、`npm run test:contract`、`npm run lint:architecture`、`git diff --check` 和 `git diff --name-only -- packages`；预期全部通过且最后一项无输出。
  实际证据（2026-08-14）：OpenSpec strict 通过；contract 49 files / 387 tests；architecture 50 files / 307 tests 且 dependency-cruiser、package manifest policy 通过；`git diff --check` 仅输出既有 CRLF 转换 warning，无 whitespace error；packages diff 无输出。

- [x] 2.2 执行 backend 常规构建与测试并记录结果；若失败，仅在失败属于本 change 触达范围时修复，既有无关失败保留可复现证据且不得把本 task 标记完成。
  来源：proposal `影响范围`；design `验证策略`；AGENTS.md 验证门禁
  验证：运行 `npm run build` 和 `npm test`；预期全部通过。无 frontend 或 `packages/**` 变更，不运行 frontend build/test/e2e，也不新增 package-specific 测试。
  实际证据（2026-08-14）：修复 `origin/main` 的两个测试基线漂移后，`npm run build` 通过，`npm test` 167 files / 2108 tests 全部通过。修复仅补齐 workflow observer 测试的契约字段类型，并让 northbound Hook 测试对齐其 active OpenSpec 已定义的 `TRANSFORM + mutation.structuredPayload` 目标态；未修改产品实现。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”归并 stable spec、Function 和 spec-to-design-map；确认 Feature、overview、architecture、modules 和 ADR 无需变化，且长期文档没有重复定义候选模型调用预算。
