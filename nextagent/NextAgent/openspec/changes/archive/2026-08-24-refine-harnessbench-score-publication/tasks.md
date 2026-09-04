# Tasks

## 1. 修改 score 发布逻辑

- [x] 1.1 修改 `tests/harnessbench/report.mjs` 的 `createEvaluationReport`：complete scoring run（非 invalid）始终发布 `frameworkEffectScore`；degraded 时额外发布 `diagnosticFrameworkEffectScore` 和 `coverageGap`
- [x] 1.2 修改 `validityReason`：degraded 的 reason 更新为标注覆盖缺口但已发布得分
- [x] 1.3 修改 `renderMarkdown`：degraded 时显示 FES + coverageGap 信息

## 2. 修改测试

- [x] 2.1 修改 `tests/harnessbench/tests/scoring.test.ts` 的 degraded 测试：断言 `frameworkEffectScore` 存在、`coverageGap` 存在、`diagnosticFrameworkEffectScore` 仍存在
- [x] 2.2 新增多 task degraded 场景测试：验证 `coverageGap.rubricCoverageRate` 计算正确
- [x] 2.3 确认 valid 测试不变（full coverage 仍为 valid，有 FES，无 coverageGap）

## 3. 验证

- [x] 3.1 `openspec validate --all --strict` PASS
- [x] 3.2 `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests` 全部通过

验证结果（2026-08-17）：全量 OpenSpec 292/292 通过；HarnessBench 9 files / 67 tests 全部通过，覆盖 valid、degraded 与 multi-task coverage gap。
