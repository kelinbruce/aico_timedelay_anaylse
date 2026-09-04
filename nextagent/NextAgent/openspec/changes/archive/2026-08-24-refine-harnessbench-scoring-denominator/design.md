## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| FN-10.13 HarnessBench 评测 | FES 分母从 `benchmarkTaskCount` 改为 `scoringDenominator`（execute task count） | `harnessbench-evaluation` | 本文件 |

## FN-10.13 HarnessBench 评测

### 目标与规范依据

#### 本 Function 的目标 Requirements

- MODIFIED: 全量任务通过真实 NextAgent 产品边界评测
- MODIFIED: 计分运行验证真实模型调用
- MODIFIED: 统一计算逐任务分数与框架效果得分
- MODIFIED: 评测失败提供安全诊断
- MODIFIED: 评测报告可追溯且可恢复

### 当前实现

`tests/harnessbench/report.mjs` 第 63 行：

```javascript
const calculatedScore = round4(taskResults.reduce((sum, task) => sum + normalizedScore(task), 0) / manifest.benchmarkTaskCount);
```

`benchmarkTaskCount` 在 `preflight.mjs` 第 112 行设为 `input.catalog.length`（= 106，含 unsupported）。`normalizedScore` 对 `unsupported` 返回 0，但 task 仍留在 `taskResults` 中参与除法分母。

stable spec 第 36 行明确要求 `unsupported 的 task MUST 以 0 分形成终态结论，不得从框架效果得分分母移除`，第 112 行要求 `系统 MUST NOT 因不支持或任何 task-level 失败而减少该分母`。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| unsupported 不计入 FES 分母 | unsupported 以 0 分计入 106 分母 | unsupported 压低 FES |
| FES 准确反映 execute task 效果 | FES = sum / 106 含 10 个 0 分 unsupported | FES 低估框架在可执行任务上的效果 |
| 报告包含 scoringDenominator | 报告无此字段 | 缺少 execute task count 透明度 |

### 修改方案

#### 字段设计

- `benchmarkTaskCount`：保持不变，= 完整 task catalog 数量（106）。用于 manifest 完整性校验和结果数校验。
- `scoringDenominator`：新增字段，= `manifest.tasks.filter(t => t.supportStatus === 'execute').length`（默认 96）。用于 FES 公式分母和报告透明度。

#### 公式变更

```text
// 旧
frameworkEffectScore = round(sum(taskScore) / benchmarkTaskCount, 4)

// 新
frameworkEffectScore = round(sum(taskScore) / scoringDenominator, 4)
```

`sum(taskScore)` 不变——unsupported 的 `taskScore` 仍为 0，不贡献分子。变化仅在分母从 106 改为 execute task count。

#### 不变项

- `normalizedScore` 对 unsupported 仍返回 0（分子不变）
- `benchmarkTaskCount` 仍用于 `taskResults.length` 校验（第 52 行，全量 106 结果仍需完整）
- `gradingCoverage.taskCount` 已按 execute 过滤（第 200 行），无需修改
- `summarizeDiagnostics` 已按 execute 过滤（第 212 行），无需修改
- `nonScoring` 回归 profile 不发布 FES，不受影响

#### 质量属性影响

| 质量属性 | 影响 | 说明 |
|---|---|---|
| 审计/可追溯性 | 正向 | 新增 `scoringDenominator` 提升分母透明度 |
| 可比较性 | 正向 | FES 更准确反映 execute task 效果，减少 capability 缺失的干扰 |
| 安全 | 无影响 | 不涉及 credential、prompt 或路径 |

#### 备选方案（Alternatives Considered）

1. **将 `benchmarkTaskCount` 本身改为 96**：会破坏 manifest 完整性校验语义（106 结果对应 106 catalog），且 `benchmarkTaskCount` 的语义是"完整 catalog 数量"。否决。
2. **在 `normalizedScore` 中跳过 unsupported**：会改变分子语义且无法区分"0 分因 unsupported"和"0 分因失败"。否决。
3. **引入 `scoringDenominator` 独立字段**：最小侵入，保持 `benchmarkTaskCount` 语义不变，分母语义清晰。采纳。

## 验证策略（Verification Strategy）

| 层 | 验证方法 |
|---|---|
| unit | `scoring.test.ts` 断言 unsupported 排除出分母、FES = sum/executeCount |
| integration | `full-suite.test.ts` 确认 catalog/profile 一致性不受影响 |
| architecture | `architecture.test.ts` 确认无 forbidden import 或敏感字段 |
| negative case | 测试 unsupported task 不贡献分子也不贡献分母 |
| 人工审查 | spec delta 与 stable spec Requirement 名称一致 |

## 长期基线刷新计划（Baseline Promotion Plan）

归档时同步以下 stable spec Requirement（5 个 MODIFIED）：
- `全量任务通过真实 NextAgent 产品边界评测`
- `计分运行验证真实模型调用`
- `统一计算逐任务分数与框架效果得分`
- `评测失败提供安全诊断`
- `评测报告可追溯且可恢复`

## 风险与取舍（Risks / Trade-offs）

- **历史可比性**：分母变更后，新旧 FES 不可直接比较。首次评测已在报告中同时给出 106 分母（0.3904）和 96 分母（0.4311）两个值，后续运行以 `scoringDenominator` 为准。
- **profile taskSupport 变更影响**：如果未来 profile 调整 unsupported 数量，`scoringDenominator` 会随之变化。这是预期行为——分母反映当前可执行任务集。
