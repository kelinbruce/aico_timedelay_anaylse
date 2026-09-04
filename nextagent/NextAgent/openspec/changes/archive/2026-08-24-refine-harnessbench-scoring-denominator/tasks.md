## 1. FN-10.13 HarnessBench 评测

- [x] 1.1 确认 scoring.test.ts 已断言 unsupported 排除出分母的新规则

  来源：统一计算逐任务分数与框架效果得分 — Scenario: 不支持任务排除出分母 / design §修改方案
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/scoring.test.ts` — 断言当前目标态
  验证结果（2026-08-13）：当前分支在本次修复前已包含实现，未重写历史来补造 RED 证据；全量 HarnessBench 测试运行包含该文件且通过。

- [x] 1.2 修改 report.mjs 引入 scoringDenominator 并更改 FES 公式分母

  来源：统一计算逐任务分数与框架效果得分 / design §修改方案
  验证：`npx vitest run tests/harnessbench/tests/scoring.test.ts` — 应通过
  验证结果（2026-08-13）：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests` 通过，9 个文件、38 项测试通过。

- [x] 1.3 新增显式测试：unsupported task 不计入 scoringDenominator

  来源：统一计算逐任务分数与框架效果得分 — Scenario: 不支持任务排除出分母
  验证：`npx vitest run tests/harnessbench/tests/scoring.test.ts` — 新测试通过
  验证结果（2026-08-13）：测试断言全量清单 `benchmarkTaskCount=106`、`scoringDenominator=96`，以及最小样例中 execute failure 保留在分母、unsupported 排除出分母。

- [x] 1.4 更新 README.md FES 公式表述

  来源：评测报告可追溯且可恢复 / design §修改方案
  验证：人工检查 `tests/harnessbench/README.md` 公式行
  验证结果（2026-08-13）：README 明确记录 `frameworkEffectScore = round(sum(taskScore) / scoringDenominator, 4)` 及 execute-only 分母规则。

## 2. Change 整体验证

- [x] 2.1 OpenSpec change 校验

  验证：`openspec validate refine-harnessbench-scoring-denominator --strict` — PASS
  验证结果（2026-08-13）：PASS。

- [x] 2.2 全量 spec 校验

  验证：`openspec validate --all --strict` — PASS
  验证结果（2026-08-13）：260 项通过，0 项失败。

- [x] 2.3 harnessbench 全量契约测试

  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests` — 35+ passed, 0 failed
  验证结果（2026-08-13）：9 个文件、38 项测试通过，0 项失败。
