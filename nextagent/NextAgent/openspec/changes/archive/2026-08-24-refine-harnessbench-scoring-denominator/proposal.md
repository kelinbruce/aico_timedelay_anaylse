## Why

HarnessBench 评测当前以 `benchmarkTaskCount`（固定 106，含 unsupported）作为 `frameworkEffectScore` 分母。`unsupported` task 反映的是框架不具备某项 capability（如浏览器交互、图像理解、邮件连接器），而非框架在可执行任务上的效果缺陷。将 capability 缺失的 task 以 0 分计入分母，会系统性压低 FES，使分数不能准确反映框架在可执行任务上的真实效果。

首次全量评测（2026-08-12）的数据印证了这一问题：96 个 execute task 中 55 个 scored（实际 sum=41.38），10 个 unsupported 以 0 分计入 106 分母，导致 FES=0.3904；若以 96 为分母，FES=0.4311，更准确反映框架在可执行任务上的能力水位。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 让框架效果得分只以状态为 `execute` 的 task 数量为分母。
- 保留完整 catalog 与全部 task 终态结论的可追溯性。

**非目标：**

- 不改变 `unsupported` task 的终态、`gradingCoverage`、非计分 profile 或发布阈值。

## What Changes

- 引入 `scoringDenominator` 字段，定义为全量评测清单中状态为 `execute` 的 task 数量
- `frameworkEffectScore` 公式分母从 `benchmarkTaskCount` 改为 `scoringDenominator`
- `unsupported` task 仍以 0 分形成终态结论、仍计入 `benchmarkTaskCount`，但 MUST NOT 计入 `scoringDenominator`
- 状态为 `execute` 的 task 无论终态结论如何（scored、agent_failed、model_evidence_missing、timed_out、grading_failed），MUST 计入 `scoringDenominator`
- 报告 MUST 新增 `scoringDenominator` 字段

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.13 HarnessBench 评测` → `specs/harnessbench-evaluation/spec.md`
  - 功能边界：修改 FES 分母规则，排除 `unsupported` task，并公开 `scoringDenominator`；不改变任务执行、评分分量或完整 catalog。
  - 系统质量属性：审计/可追溯性。
  - 映射说明：canonical spec；无 legacy spec 迁移。

## 影响范围（Impact）

| 影响层 | 文件 | 变更类型 |
|---|---|---|
| OpenSpec baseline spec | `openspec/specs/harnessbench-evaluation/spec.md` | 归档时同步 5 个 MODIFIED Requirement |
| 评测实现 | `tests/harnessbench/report.mjs` | FES 公式分母、新增 `scoringDenominator` 字段 |
| 评测测试 | `tests/harnessbench/tests/scoring.test.ts` | 断言 unsupported 排除出分母 |
| 评测文档 | `tests/harnessbench/README.md` | FES 公式表述 |
