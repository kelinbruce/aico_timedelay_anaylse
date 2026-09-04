## Function

- **所属 Function**：`FN-10.13 HarnessBench 评测`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: 全量任务通过真实 NextAgent 产品边界评测

系统 MUST 对全量评测清单中的每个 task 形成一个终态评测结论。状态为 `execute` 的 task MUST 使用当前工作树构建出的 NextAgent local runtime，并通过公开的会话、请求和 stream 行为提交任务及等待 terminal result；状态为 `unsupported` 的 task MUST 以 `0` 分形成终态结论，且 MUST NOT 计入框架效果得分分母。系统 MUST 以 HarnessBench 提供的任务工作区作为执行 task 的输入与结果边界。系统 MUST NOT 修改 `packages/**`、公共契约、产品默认 Agent 或 HarnessBench task、oracle 与评分实现来使任务通过。mock 模型、固定答案、直接调用领域 service、伪造 terminal result 或在 NextAgent 执行之外生成预期工作区结果 MUST NOT 构成框架效果评测证据。

**需求类别：功能性需求**

#### Scenario: 真实产品路径完成任务

- **WHEN** 一个状态为 `execute` 的 task 被评测
- **THEN** 系统通过当前 NextAgent local runtime 建立会话并提交该 task
- **AND** task 的最终工作区由该次 NextAgent 请求产生的行为形成
- **AND** HarnessBench 在该最终工作区和对应执行 trace 上评分

#### Scenario: 不支持任务以零分排除出分母

- **WHEN** 一个 task 在全量评测清单中的状态为 `unsupported`
- **THEN** 系统为该 task 记录非空不支持原因和 `taskScore=0`
- **AND** 该 task MUST 计入 `benchmarkTaskCount` 但 MUST NOT 计入 `scoringDenominator` 或 `frameworkEffectScore` 分母

#### Scenario: 替代路径不得计分

- **WHEN** task 使用 mock 模型、固定答案、直接领域 service 调用、伪造 terminal result 或 NextAgent 之外的结果生成代替目标链路
- **THEN** 系统 MUST 将本次全量运行标记为无效
- **AND** 本次运行 MUST NOT 产生 `frameworkEffectScore`

### Requirement: 计分运行验证真实模型调用

系统 MUST 在全量评测开始前验证真实模型 provider 与 credential 可用，并 MUST 让每个状态为 `execute` 的 task 的 NextAgent 模型请求经过 HarnessBench usage proxy。获得非零 `taskScore` 的 task MUST 从 proxy trace 取得至少一次成功上游模型请求和大于 0 的总 token 用量。模型凭据 MUST 来自受支持的安全引用，不得来自 task 输入或全量评测清单。全量运行的真实模型前置验证失败时，系统 MUST 在第一个 task 前终止且不得产生 `frameworkEffectScore`；单个 task 缺少真实模型证据时，该 task MUST 以 `model_evidence_missing` 和 `taskScore=0` 结束并计入 `scoringDenominator`。

**需求类别：功能性需求**

#### Scenario: 真实模型证据成立

- **WHEN** task 的 proxy trace 至少记录一次成功上游请求且总 token 用量大于 0
- **THEN** 系统将该 task 识别为具有真实模型证据
- **AND** 报告记录非敏感模型标识、请求数和 token 汇总

#### Scenario: 模型未调用或证据缺失

- **WHEN** task 没有成功上游模型请求、总 token 用量为 0 或 proxy trace 不可用
- **THEN** task 结果为 `model_evidence_missing`
- **AND** `taskScore=0`
- **AND** 系统继续生成包含该失败的完整评测报告

#### Scenario: 真实模型前置条件无效

- **WHEN** 真实模型 provider 不可达或 credential 校验失败
- **THEN** 系统 MUST 在第一个 task 执行前终止全量评测
- **AND** 本次运行 MUST NOT 产生 `frameworkEffectScore`

### Requirement: 统一计算逐任务分数与框架效果得分

系统 MUST 使用固定 HarnessBench commit 自身生成的 `outcome_score`、`process_score`、`security_score` 和 `combined_score`，MUST NOT 在 NextAgent 侧重新解释或覆盖这些分量。状态为 `unsupported` 的 task，或因 Agent 错误、模型错误、超时、terminal failure、oracle 失败、过程评分失败、安全评分失败而没有合法 `combined_score` 的 task，系统 MUST 将其 `taskScore` 归一为 `0`。全部 task 形成终态结论后，系统 MUST 按下式计算并以四位小数输出框架效果得分：

```text
taskScore(task) = HarnessBench combined_score；不支持、失败、缺失或非法时为 0
frameworkEffectScore = round(sum(taskScore(task)) / scoringDenominator, 4)
```

其中 `benchmarkTaskCount` MUST 等于固定 HarnessBench commit 的完整 task catalog 数量；默认 commit 的值为 106。`scoringDenominator` MUST 等于全量评测清单中状态为 `execute` 的 task 数量。状态为 `unsupported` 的 task MUST NOT 计入 `scoringDenominator`；状态为 `execute` 的 task 无论终态结论如何 MUST 计入 `scoringDenominator`。系统 MUST NOT 因 task-level 失败而减少 `scoringDenominator`。任一 task 尚未形成 `scored`、`unsupported`、`agent_failed`、`model_evidence_missing`、`timed_out` 或 `grading_failed` 终态结论时，系统 MUST NOT 产生 `frameworkEffectScore`。

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

#### Scenario: 评分覆盖退化不得发布可比分数

- **WHEN** 完整运行中任一应执行 task 缺少可用的 HarnessBench rubric/process 评分
- **THEN** 报告 MUST 将 `evaluationValidity` 标记为 `degraded`
- **AND** 报告 MUST 给出评分覆盖计数和不参与正式对比的诊断分数
- **AND** 报告 MUST NOT 生成 `frameworkEffectScore`

### Requirement: 评测失败提供安全诊断

系统 MUST 为每个非成功 task 提供唯一的安全失败阶段和闭集原因码，并 MUST 区分候选准备、会话创建、请求提交、stream 等待、terminal、工作区导出、HarnessBench 进程和 grader 阶段。报告 MUST 记录模型请求和工作区产物是否已观测到，并 MUST 只使用 run-relative evidence ref。

**需求类别：系统质量属性**
**质量属性：审计/可追溯性**
**适用范围：该 Function**

#### Scenario: terminal 失败保留安全诊断

- **WHEN** NextAgent request 进入失败 terminal
- **THEN** task 仍 MUST 按零分计入 `scoringDenominator`
- **AND** 报告 MUST 记录 `failurePhase=terminal`、公开 stream 中已有的安全原因码或 `UNKNOWN`、模型请求证据和工作区产物观测结论

### Requirement: 评测报告可追溯且可恢复

系统 MUST 为每次评测生成一个机器可读 JSON 报告和一个内容一致的 Markdown 摘要。完整报告 MUST 包含运行标识、开始与结束时间、HarnessBench commit、NextAgent commit、候选与 grader 的非敏感模型标识、全量评测清单、`benchmarkTaskCount`、`scoringDenominator`、各终态状态数量、评分覆盖、`evaluationValidity`、逐 task 状态、逐 task 评分分量、逐 task `taskScore`、逐 task 请求数与 token 汇总，以及相对路径或 opaque evidence ref。只有评分覆盖完整的有效计分运行 MUST 包含 `frameworkEffectScore`；评分覆盖退化时 MUST 改为诊断分数和不可比较原因。运行中断时，系统 MUST 原子写出截至中断点已知的 task 结果、未完成 task 状态和无法产生框架效果得分的原因。

**需求类别：系统质量属性**
**质量属性：审计/可追溯性**
**适用范围：该 Function**

#### Scenario: 成功运行生成双格式报告

- **WHEN** 全量评测清单中的全部 task 已形成终态结论、评分覆盖完整且报告字段完整
- **THEN** 系统生成内容一致的 JSON 报告和 Markdown 摘要
- **AND** 两份报告给出同一 `frameworkEffectScore`、状态汇总和逐 task 结论

#### Scenario: 中断后保留安全的部分证据

- **WHEN** 评测进程在全部 task 结束前收到中断或发生不可恢复的评测基础设施错误
- **THEN** 系统生成部分报告并将未完成 task 标记为 `not_completed`
- **AND** 部分报告说明中断阶段且不包含受禁止内容
- **AND** 部分报告 MUST NOT 包含 `frameworkEffectScore`

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：系统对完整 catalog 形成终态结论，以全部 execute task 数量作为固定计分分母，并在模型证据、执行或评分失败时保留对应 execute task 的零分占位。
- **依据 Requirements**：`全量任务通过真实 NextAgent 产品边界评测`、`计分运行验证真实模型调用`、`统一计算逐任务分数与框架效果得分`、`评测失败提供安全诊断`

### 结果

- **变更类型**：修改
- **目标内容**：完整有效运行同时给出完整任务数、计分分母、逐 task 结论和 FES；中断或评分覆盖退化时不发布 FES。
- **依据 Requirements**：`统一计算逐任务分数与框架效果得分`、`评测报告可追溯且可恢复`

### 规格

- **规格项**：评测范围
- **变更类型**：修改
- **原规格值**：固定 HarnessBench commit 的完整 106-task catalog；unsupported 和 failed task 均以 0 分保留在分母
- **目标规格值**：固定 HarnessBench commit 的完整 106-task catalog；unsupported task 排除出计分分母，全部 execute task 保留在计分分母
- **依据 Requirements**：`全量任务通过真实 NextAgent 产品边界评测`、`统一计算逐任务分数与框架效果得分`

- **规格项**：框架效果得分
- **变更类型**：修改
- **原规格值**：`round(sum(taskScore) / benchmarkTaskCount, 4)`
- **目标规格值**：`round(sum(taskScore) / scoringDenominator, 4)`，其中 `scoringDenominator` 为完整清单中的 execute task 数量
- **依据 Requirements**：`统一计算逐任务分数与框架效果得分`、`评测报告可追溯且可恢复`
