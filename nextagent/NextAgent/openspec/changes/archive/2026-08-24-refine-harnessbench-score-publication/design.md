## 背景

HarnessBench 评测报告的 `evaluationValidity` 判定采用 all-or-nothing 门禁：`rubricSkippedCount > 0` 即 `degraded`，不发布 `frameworkEffectScore`。两次完整评测均因此无法获得可比较分数。

## GAP 分析

| 维度 | 现状 | 目标 |
|------|------|------|
| FES 发布条件 | `evaluationValidity=valid`（全覆盖）才发布 | 完整计分运行始终发布 |
| degraded 时 | 只发 `diagnosticFrameworkEffectScore` | 发 `frameworkEffectScore` + `coverageGap` |
| FES 计算 | `round(sum(taskScore) / scoringDenominator, 4)` | 不变 |
| processScore 缺失影响 | 触发 degraded → 不发布 FES | 触发 degraded → 发布 FES + 标注缺口 |

**关键不变量**：`frameworkEffectScore` 的计算（`calculatedScore`）完全不依赖 `processScore`。`normalizedScore` 基于 `taskScore`（来自 `combinedScore` 或失败时归零），processScore 只用于 `gradingCoverage` 统计和 validity 判定，不参与 FES 公式。

## 设计决策

### 决策 1：始终发布 frameworkEffectScore（非阈值）

考虑过引入覆盖率阈值（如 ≥90% 才发布），但 rejected：
- 阈值是任意值，无法客观论证
- 08-13 的 86.5% 覆盖率在 90% 阈值下仍无法发布
- 用户需求是"每次都能给出得分用于趋势分析"

采用：完整计分运行（非 nonScoring、非中断）始终发布 `frameworkEffectScore`。`evaluationValidity` 保留为质量指示器，`coverageGap` 提供缺口详情。

### 决策 2：保留 diagnosticFrameworkEffectScore

保留 `diagnosticFrameworkEffectScore`（degraded 时与 `frameworkEffectScore` 同值）用于向后兼容：
- 已有报告解析逻辑可能引用 `diagnosticFrameworkEffectScore`
- 08-12 评测报告使用此字段
- 移除是 breaking change，收益不大

### 决策 3：新增 coverageGap 字段

degraded 时附带 `coverageGap`：
```json
{
  "coverageGap": {
    "rubricSkippedCount": 13,
    "rubricCoverageRate": 0.8646
  }
}
```
- `rubricSkippedCount`：直接来自 `gradingCoverage.rubricSkippedCount`
- `rubricCoverageRate`：`round4(rubricScoredCount / taskCount)`，四位小数

### 决策 4：scoreUnavailableReason 调整

- `valid`：无 `scoreUnavailableReason`（有 FES）
- `degraded`：无 `scoreUnavailableReason`（有 FES），但有 `coverageGap`
- `invalid`（nonScoring/interrupted）：保留 `scoreUnavailableReason`

## 不变项

- `scoringDenominator` 定义和计算不变
- `gradingCoverage` 字段结构不变
- `normalizedScore`、`validScore`、`summarizeGradingCoverage` 不变
- nonScoring 和 interrupted 的 `invalid` 行为不变
- `assertSafeReport` 安全检查不变

## 影响范围

| 文件 | 变更 |
|------|------|
| `tests/harnessbench/report.mjs` | score 发布逻辑 + coverageGap + validityReason + renderMarkdown |
| `tests/harnessbench/tests/scoring.test.ts` | degraded 测试断言 + coverageGap 测试 |
