## Function

- **所属 Function**：`FN-10.13 HarnessBench 评测`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: 统一计算逐任务分数与框架效果得分

系统 MUST 使用固定 HarnessBench commit 自身生成的 `outcome_score`、`process_score`、`security_score` 和 `combined_score`，MUST NOT 在 NextAgent 侧重新解释或覆盖这些分量。状态为 `unsupported` 的 task，或因 Agent 错误、模型错误、超时、terminal failure、oracle 失败、过程评分失败、安全评分失败而没有合法 `combined_score` 的 task，系统 MUST 将其 `taskScore` 归一为 `0`。全部 task 形成终态结论后，系统 MUST 按下式计算并以四位小数输出框架效果得分：

```text
taskScore(task) = HarnessBench combined_score；不支持、失败、缺失或非法时为 0
frameworkEffectScore = round(sum(taskScore(task)) / scoringDenominator, 4)
```

其中 `benchmarkTaskCount` MUST 等于固定 HarnessBench commit 的完整 task catalog 数量；默认 commit 的值为 106。`scoringDenominator` MUST 等于全量评测清单中状态为 `execute` 的 task 数量。状态为 `unsupported` 的 task MUST NOT 计入 `scoringDenominator`；状态为 `execute` 的 task 无论终态结论如何 MUST 计入 `scoringDenominator`。系统 MUST NOT 因 task-level 失败而减少 `scoringDenominator`。任一 task 尚未形成 `scored`、`unsupported`、`agent_failed`、`model_evidence_missing`、`timed_out` 或 `grading_failed` 终态结论时，系统 MUST NOT 产生 `frameworkEffectScore`。完整计分运行（全部 task 已形成终态结论且非 nonScoring）MUST 发布 `frameworkEffectScore`，无论 rubric 覆盖是否完整。

**需求类别：功能性需求**

#### Scenario: 全量任务汇总框架效果得分

- **WHEN** 全量评测清单中的每个 task 均已形成终态结论
- **THEN** 系统为每个 task 保留可用的 HarnessBench 分量和归一后的 `taskScore`
- **AND** `frameworkEffectScore` 以 `scoringDenominator` 为分母
- **AND** `scoringDenominator` 等于状态为 `execute` 的 task 数量

#### Scenario: 不支持任务排除出分母

- **WHEN** 一个 task 的状态为 `unsupported`
- **THEN** 该 task 的 `taskScore` 为 `0`
- **AND** 该 task MUST NOT 计入 `scoringDenominator` 或 `frameworkEffectScore` 分母

#### Scenario: 执行失败任务保留在分母

- **WHEN** 一个状态为 `execute` 的 task 因 Agent、模型、超时、terminal、oracle、过程评分或安全评分失败而没有合法 `combined_score`
- **THEN** 该 task 的 `taskScore` 为 `0`
- **AND** 该 task 仍计入 `scoringDenominator` 和 `frameworkEffectScore` 分母

#### Scenario: 全量任务未完成不得发布总分

- **WHEN** 任一 task 尚未形成终态结论
- **THEN** 系统只生成部分报告
- **AND** 部分报告 MUST NOT 包含 `frameworkEffectScore`

#### Scenario: 评分覆盖退化标注覆盖缺口但发布得分

- **WHEN** 完整运行中任一应执行 task 缺少可用的 HarnessBench rubric/process 评分
- **THEN** 报告 MUST 将 `evaluationValidity` 标记为 `degraded`
- **AND** 报告 MUST 发布 `frameworkEffectScore`
- **AND** 报告 MUST 附带 `coverageGap` 字段，包含 `rubricSkippedCount`（缺失 processScore 的 execute task 数）和 `rubricCoverageRate`（rubricScoredCount / eligible taskCount，四位小数）
- **AND** 报告 MAY 附带 `diagnosticFrameworkEffectScore`（与 `frameworkEffectScore` 同值，用于向后兼容）

### Requirement: 评测报告可追溯且可恢复

系统 MUST 为每次评测生成一个机器可读 JSON 报告和一个内容一致的 Markdown 摘要。完整报告 MUST 包含运行标识、开始与结束时间、HarnessBench commit、NextAgent commit、候选与 grader 的非敏感模型标识、全量评测清单、`benchmarkTaskCount`、`scoringDenominator`、各终态状态数量、评分覆盖、`evaluationValidity`、逐 task 状态、逐 task 评分分量、逐 task `taskScore`、逐 task 请求数与 token 汇总，以及相对路径或 opaque evidence ref。完整计分运行（非 nonScoring、非中断）MUST 包含 `frameworkEffectScore`；评分覆盖退化时 MUST 同时包含 `frameworkEffectScore`、`coverageGap` 和 `evaluationValidity=degraded`。运行中断时，系统 MUST 原子写出截至中断点已知的 task 结果、未完成 task 状态和无法产生框架效果得分的原因。

**需求类别：系统质量属性**
**质量属性：审计/可追溯性**
**适用范围：该 Function**

#### Scenario: 成功运行生成双格式报告

- **WHEN** 全量评测清单中的全部 task 已形成终态结论且报告字段完整
- **THEN** 系统生成内容一致的 JSON 报告和 Markdown 摘要
- **AND** 两份报告给出同一 `frameworkEffectScore`、状态汇总和逐 task 结论
- **AND** 评分覆盖完整时 `evaluationValidity=valid` 且无 `coverageGap`
- **AND** 评分覆盖退化时 `evaluationValidity=degraded` 且包含 `coverageGap`

#### Scenario: 中断后保留安全的部分证据

- **WHEN** 评测进程在全部 task 结束前收到中断或发生不可恢复的评测基础设施错误
- **THEN** 系统生成部分报告并将未完成 task 标记为 `not_completed`
- **AND** 部分报告说明中断阶段且不包含受禁止内容
- **AND** 部分报告 MUST NOT 包含 `frameworkEffectScore`

## Function 变更汇总

### 规格

- **规格项**：评分覆盖退化时的得分发布
- **变更类型**：修改
- **原规格值**：评分覆盖退化时 `evaluationValidity=degraded`，报告 MUST NOT 生成 `frameworkEffectScore`，只给出诊断分数
- **目标规格值**：评分覆盖退化时 `evaluationValidity=degraded`，报告 MUST 发布 `frameworkEffectScore`，MUST 附带 `coverageGap`（含 `rubricSkippedCount` 和 `rubricCoverageRate`），MAY 附带 `diagnosticFrameworkEffectScore`（向后兼容）
- **依据 Requirements**：`统一计算逐任务分数与框架效果得分`、`评测报告可追溯且可恢复`
