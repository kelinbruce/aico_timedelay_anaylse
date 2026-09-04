## 1. `FN-10.13 HarnessBench 评测`

- [x] 1.1 为分层预算、result-first 恢复和闭集失败码建立失败复现测试；覆盖 `900/780/120`、stdout 无效但结果有效、非零退出但结果有效、无结果的非零退出、无效摘要、结果缺失和结果 JSON 无效，以及 CLI terminal envelope 不得替代 upstream-result；实施前运行并确认目标断言失败
  来源：`FN-10.13` + 系统质量属性“可靠性/恢复”“审计/可追溯性” + Requirements `任务执行为结果收集保留确定预算`、`有效 upstream-result 优先于进程摘要`、`HarnessBench 进程失败使用闭集原因码` + 全部 Scenarios
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/preflight.test.ts tests/harnessbench/tests/generic-cli-integration.test.ts tests/harnessbench/tests/execution-reliability.test.ts`；预期新增目标断言在实现前失败且失败原因对应缺失行为
  验证结果：2026-08-13 使用 `npx vitest run --config vitest.config.release.ts ...` 执行 26 个测试，新增行为的 9 个断言按预期失败，17 个既有断言通过。

- [x] 1.2 实现 `900 s` 外层与 `780 s` terminal 分层预算，并在 profile、preflight、run manifest 和生成 harness config 中保持唯一一致的 `120 s` 收集余量
  来源：`FN-10.13` + 系统质量属性“可靠性/恢复” + Requirement `任务执行为结果收集保留确定预算` + Scenarios `terminal 在内层预算内完成`、`terminal 达到内层预算`
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/preflight.test.ts tests/harnessbench/tests/execution-reliability.test.ts`；预期合法预算生成正确配置，非法预算关系被拒绝
  验证结果：2026-08-13 使用 release Vitest config 执行目标回归，合法预算与非法差值断言通过。

- [x] 1.3 实现 Python task 进程关闭后的 result-first 恢复和结构化 harness-process 错误映射；存在有效 upstream-result 时忽略摘要/退出码缺陷，无有效结果时输出闭集原因码且不泄露原始进程输出
  来源：`FN-10.13` + 系统质量属性“可靠性/恢复”“审计/可追溯性” + Requirements `有效 upstream-result 优先于进程摘要`、`HarnessBench 进程失败使用闭集原因码` + 全部 Scenarios；design `FN-10.13 HarnessBench 评测 / 修改方案`
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/generic-cli-integration.test.ts tests/harnessbench/tests/execution-reliability.test.ts`；预期恢复路径与全部 negative cases 通过
  验证结果：2026-08-13 使用 release Vitest config 执行目标回归，最终 28/28 通过；包含 invalid JSON 与 raw-authoritative 补充负例。

- [x] 1.4 完成 `FN-10.13` HarnessBench 无凭据回归，确认评分、模型证据、重试、报告和定向 profile 语义无回归
  来源：design `验证策略`
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests`；预期全部 HarnessBench tests 通过
  验证结果：2026-08-13 使用 `python -m py_compile tests/harnessbench/harness-task-wrapper.py` 和 `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests`，Python 编译通过，9 files / 63 tests 全部通过。

## 2. Change 整体验证

- [x] 2.1 完成 OpenSpec、构建、contract 与架构门禁，并执行 OpenSpec/实现语义检视，确认改动仅触及 active change 与 `tests/harnessbench/**` 且不存在 P0/P1/P2
  来源：proposal `影响范围` + design `验证策略`、`长期基线刷新计划`
  验证：`openspec validate harden-harnessbench-timeout-result-collection --strict`、`openspec validate --all --strict`、`npm run build`、`npm run test:contract`、`npm run lint:architecture`，以及 `$nextagent-skill-review` 与 `$nextagent-code-review`；预期全部通过且语义检视结论为 PASS
  实际结果（2026-08-14）：HarnessBench 9 files / 64 tests、contract 49 files / 387 tests、architecture 50 files / 307 tests、全量 OpenSpec 277/277、Python wrapper 编译和 `git diff --check` 通过；修复 `origin/main` 两处测试基线漂移后，根 `npm run build` 与 `npm test` 167 files / 2108 tests 全部通过。OpenSpec 与代码语义检视结论为 PASS，无 P0/P1/P2。

- [x] 2.2 根据 08-14 的 7 个 task timeout 证据，把固定分层预算从 `900/780/120 s` 修订为 `1200/1080/120 s`，并同步 profile、preflight manifest 和生成 harness config 的回归断言
  来源：`FN-10.13` + 系统质量属性“可靠性/恢复” + Requirement `任务执行为结果收集保留确定预算` + Scenarios `terminal 在内层预算内完成`、`terminal 达到内层预算`；design `GAP 分析`、`修改方案`
  验证：运行 `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/preflight.test.ts tests/harnessbench/tests/execution-reliability.test.ts tests/harnessbench/tests/generic-cli-integration.test.ts`；预期 profile、manifest、adapter 和 terminal 参数均为目标值，余量仍恰好 `120 s`，非法组合仍被拒绝
  验证结果：2026-08-17 目标 3 files / 31 tests 全部通过；full profile、manifest、adapter、terminal 参数与非法余量负例一致。

- [x] 2.3 新增固定 `timeout-budget-regression` 非计分 profile，恰好覆盖 08-14 的 7 个 task timeout 与 037、041 两个 terminal 窗口耗尽 task
  来源：design `修改方案` 第 8 项、`验证策略`
  验证：运行 `node tests/harnessbench/run.mjs --help` 和 `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/preflight.test.ts`；预期 profile 满足闭集 schema、task id 唯一且只引用固定 catalog，并保持 `nonScoring=true`
  验证结果：2026-08-17 preflight 6/6 通过，固定 profile 的 9 个 task id、唯一性和 `nonScoring=true` 均被锁定。

- [x] 2.4 重新执行 HarnessBench 与 OpenSpec 门禁并完成修订后的语义检视
  来源：proposal `影响范围` + design `验证策略`、`风险与取舍`
  验证：运行 `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests`、`openspec validate harden-harnessbench-timeout-result-collection --strict`、`openspec validate --all --strict`；预期全部通过且 `$nextagent-skill-review` 结论无 P0/P1
  验证结果：2026-08-17 HarnessBench 9 files / 67 tests、change strict 与全量 OpenSpec 292/292 通过；语义检视 PASS，无 P0/P1。

## 归档前更新基线检查（非实施任务）

归档流程按照 design 的“长期基线刷新计划”同步 stable spec 与 `FN-10.13` Function 文档；实施阶段不直接修改长期基线。
