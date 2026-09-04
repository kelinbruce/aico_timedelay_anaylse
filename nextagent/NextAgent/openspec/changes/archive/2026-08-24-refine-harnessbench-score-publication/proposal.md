## Why

HarnessBench 评测的 `evaluationValidity` 判定采用 all-or-nothing 门禁：只要有一个 execute task 缺少 processScore，就将 `evaluationValidity` 标记为 `degraded` 并拒绝发布 `frameworkEffectScore`。两次完整评测（2026-08-12 和 2026-08-13）均因非 NextAgent 原因被降级：

- 08-12：5 个 task rubric skipped（91/96 = 94.8% 覆盖）→ degraded，未发布 FES
- 08-13：13 个 task rubric skipped（83/96 = 86.5% 覆盖）→ degraded，未发布 FES

13 个 skip 中 11 个是 Python harness `subprocess.run` 结果收集失败（CLI 实际执行了模型调用但 Python 进程未产出 upstream-result 文件），2 个是 HarnessBench task 定义缺少 `llm_rubric.py`。两者均非 NextAgent 框架能力问题。

**关键事实**：FES 计算公式 `round(sum(taskScore) / scoringDenominator, 4)` 不依赖 processScore。`taskScore` 来自 `combinedScore`（或失败时归零），processScore 缺失不影响分数计算，只触发 validity 门禁。`frameworkEffectScore` 和 `diagnosticFrameworkEffectScore` 使用完全相同的 `calculatedScore`，区别仅在于"是否发布"。

当前 all-or-nothing 门禁导致即使覆盖率 94.8% 也无法获得可比较分数，使评测失去对框架效果趋势分析的价值。

## Goal

- complete scoring run（非 nonScoring、非中断）始终发布 `frameworkEffectScore`，无论 rubric 覆盖是否完整
- `evaluationValidity` 保留 `valid`/`degraded` 作为覆盖质量指示器：`valid` 表示全覆盖，`degraded` 表示有覆盖缺口
- degraded 时 MUST 附带 `coverageGap` 字段（含 `rubricSkippedCount` 和 `rubricCoverageRate`），标注覆盖缺口详情
- 保留 `diagnosticFrameworkEffectScore` 用于向后兼容（degraded 时与 `frameworkEffectScore` 同值）

## Non-goals

- 不改 FES 计算公式（`round(sum(taskScore) / scoringDenominator, 4)` 不变）
- 不改 `scoringDenominator` 定义（execute task 数量）
- 不改 nonScoring / interrupted 的 `invalid` 行为（这两种情况仍不发布 `frameworkEffectScore`）
- 不改 `gradingCoverage` 字段结构
- 不定义发布阈值或 pass/fail 判定
