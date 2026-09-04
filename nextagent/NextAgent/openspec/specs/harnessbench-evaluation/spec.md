# harnessbench-evaluation Specification

## Purpose

定义 NextAgent 框架效果外部评测能力：接收固定 HarnessBench 基线和真实模型运行条件，覆盖该基线全部 task，通过真实 NextAgent 产品边界执行评测，输出逐任务终态结论、框架效果得分（`frameworkEffectScore`）和可追溯的安全报告。该能力不属于发布门禁默认阻断，不定义发布阈值。

## Function

- **所属 Function**：`FN-10.13 HarnessBench 评测`
## Requirements
### Requirement: 评测运行固定版本与任务边界

系统 MUST 以 `node tests/harnessbench/run.mjs` 作为唯一标准全量评测入口。该入口 MUST 在任务执行前解析 HarnessBench Git commit、NextAgent Git commit、模型标识和该 HarnessBench commit 的完整 task catalog，并将这些事实写入不可变的全量评测清单。HarnessBench Git commit MUST 是完整的 40 位提交哈希。全量评测清单 MUST 与上游 task catalog 恰好一致，每个 task id MUST 恰好出现一次，状态 MUST 是 `execute` 或 `unsupported`；`unsupported` 项 MUST 具有非空原因。评测开始后，系统 MUST NOT 增加、删除或改变清单项。

**需求类别：功能性需求**

#### Scenario: 固定清单后开始评测

- **WHEN** HarnessBench commit 可解析且完整 task catalog 已加载
- **THEN** 系统生成与上游 task catalog 恰好一致的不可变全量评测清单
- **AND** 清单关联 HarnessBench commit、NextAgent commit、模型标识和全部 task id
- **AND** 每个 task 的状态恰好是 `execute` 或具有非空原因的 `unsupported`

#### Scenario: 标准入口完成全量评测

- **WHEN** 运行 `node tests/harnessbench/run.mjs` 且运行前条件有效
- **THEN** 系统 MUST 覆盖全量评测清单并生成完整报告
- **AND** task-level 的不支持或失败 MUST NOT 使标准入口跳过其余 task
- **AND** 全部 task 形成终态结论且报告发布成功时标准入口退出码为 `0`

#### Scenario: 上游版本或任务范围非法

- **WHEN** HarnessBench commit 不可解析、检出的上游 `HEAD` 与请求 commit 不一致、任一上游 task 缺失或重复、清单存在额外 task，或任一 `unsupported` 项缺少原因
- **THEN** 系统 MUST 在第一个 task 执行前终止评测
- **AND** 本次运行 MUST NOT 产生 `frameworkEffectScore`
- **AND** 标准入口退出码 MUST 非 `0`

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

### Requirement: 计分运行验证 grader 前置条件

系统 MUST 从显式安全引用解析 HarnessBench grader 的 provider、credential 和 model id，并 MUST 在第一个计分 task 前验证 grader 鉴权和评分返回结构。候选模型与 grader 的配置和预检结果 MUST 分别形成非敏感结论；任一 grader 前置条件无效时，系统 MUST fail closed 且 MUST NOT 生成 `frameworkEffectScore`。

**需求类别：功能性需求**

#### Scenario: 候选模型与 grader 分别通过预检

- **GIVEN** 候选模型和 grader 使用显式 model id、provider 安全引用和 credential 安全引用
- **WHEN** 开始全量计分运行
- **THEN** 系统 MUST 分别验证候选模型响应和 grader 评分返回结构
- **AND** 两项预检成功后系统才开始第一个计分 task

#### Scenario: grader 鉴权或返回结构无效

- **WHEN** grader credential 被拒绝、provider 不可达或评分响应结构无效
- **THEN** 全量评测 MUST 在第一个计分 task 前失败
- **AND** 系统 MUST NOT 生成 `frameworkEffectScore`

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

### Requirement: 评测失败提供安全诊断

系统 MUST 为每个非成功 task 提供唯一的安全失败阶段和闭集原因码，并 MUST 区分候选准备、会话创建、请求提交、stream 等待、terminal、工作区导出、HarnessBench 进程和 grader 阶段。报告 MUST 记录模型请求和工作区产物是否已观测到，并 MUST 只使用 run-relative evidence ref。NextAgent request 进入失败 terminal 时，系统 MUST 优先保留公开 stream 提供的安全原因码；公开 stream 未提供安全原因码且 terminal status 为 `failed` 时，系统 MUST 使用 `TERMINAL_FAILED`，不得使用 `UNKNOWN`。

**需求类别**：系统质量属性

**质量属性**：审计/可追溯性
**适用范围**：该 Function

#### Scenario: terminal 失败保留公开安全原因码

- **WHEN** NextAgent request 进入失败 terminal 且公开 stream 提供安全原因码
- **THEN** task 仍 MUST 按零分进入固定分母
- **AND** 报告 MUST 记录 `failurePhase=terminal`、公开 stream 提供的安全原因码、模型请求证据和工作区产物观测结论

#### Scenario: failed terminal 缺少公开安全原因码

- **WHEN** NextAgent request 进入 `failed` terminal 且公开 stream 未提供安全原因码
- **THEN** task 仍 MUST 按零分进入固定分母
- **AND** 报告 MUST 记录 `failurePhase=terminal`、`failureReasonCode=TERMINAL_FAILED`、模型请求证据和工作区产物观测结论
- **AND** 报告 MUST NOT 为该失败记录 `failureReasonCode=UNKNOWN`

### Requirement: 评测基础设施失败有界恢复

系统 MAY 仅在失败阶段属于 HarnessBench 基础设施、模型请求数为零、没有工作区结果且没有上游结果时自动重试一次；其他失败 MUST NOT 自动重试。重试 MUST 记录非敏感 attempt ledger，且 MUST NOT 改变 task 的固定计分规则。

**需求类别：系统质量属性**
**质量属性：可靠性/恢复**
**适用范围：该 Function**

#### Scenario: 纯基础设施失败重试一次

- **WHEN** HarnessBench 基础设施在没有模型请求、工作区结果和上游结果时失败
- **THEN** 系统 MAY 自动重试该 task 一次
- **AND** attempt ledger MUST 记录两次尝试的阶段和安全原因码
- **AND** 第二次失败后系统 MUST 形成零分终态并继续后续 task

#### Scenario: 已有副作用证据的失败不重试

- **WHEN** 失败 task 已存在模型请求、工作区结果、上游结果或 NextAgent terminal 结论
- **THEN** 系统 MUST NOT 自动重试该 task

### Requirement: 定向回归运行不得计分

系统 MUST 提供用于 grader、terminal、sandbox 和评测基础设施诊断的固定定向回归 profile。定向 profile MUST 显式声明 `nonScoring`，MUST 仅引用全量 catalog 中的 task，并 MUST NOT 生成 `frameworkEffectScore`。

**需求类别：功能性需求**

#### Scenario: 执行定向回归 profile

- **WHEN** 开发者选择一个固定定向回归 profile
- **THEN** 系统 MUST 只执行该 profile 声明的 task
- **AND** JSON 与 Markdown 报告 MUST 标记 `nonScoring`
- **AND** 两份报告 MUST NOT 包含 `frameworkEffectScore`

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

### Requirement: 评测报告不泄露敏感信息

系统 MUST NOT 在 JSON 报告或 Markdown 摘要中写入 credential、认证 token、完整 prompt、完整模型输出、task 文件内容或主机绝对路径。待发布内容命中任一禁止项时，系统 MUST 拒绝发布两种格式的最终报告，并 MUST 让评测返回失败。

**需求类别：系统质量属性**
**质量属性：安全**
**适用范围：该 Function**

#### Scenario: 敏感报告被拒绝

- **WHEN** 待写入报告的任一字段包含 credential、认证 token、完整 prompt、完整模型输出、task 文件内容或主机绝对路径
- **THEN** 系统 MUST 拒绝发布该报告
- **AND** 评测返回失败

### Requirement: 多轮 adapter 证据形成单一安全诊断

当一个 HarnessBench task 包含一个或多个按执行顺序排列的 adapter 轮次结果时，评测报告 MUST 检查全部轮次中的安全结构化证据；非成功 task 的 `failurePhase` 和 `failureReasonCode` MUST 取最后一个同时包含合法失败阶段和安全原因码的失败轮次。`workspaceOutcomeObserved` MUST 在任一轮明确记录已观测工作区结果时为 `true`，否则为 `false`。报告 MUST NOT 因末轮摘要缺少失败字段而丢弃更早轮次的合法安全证据，也 MUST NOT 把原始 stdout、prompt、模型输出或异常正文复制到诊断字段。

**需求类别**：系统质量属性

**质量属性**：审计/可追溯性
**适用范围**：该 Function

#### Scenario: 末轮摘要不覆盖前序明确失败
- **WHEN** 一个非成功 task 的前序 adapter 轮次包含合法 `STREAM_WAIT_FAILED` 失败证据，而末轮摘要不包含合法失败字段
- **THEN** 报告的 `failurePhase` 和 `failureReasonCode` 分别为该前序证据的 `stream_wait` 和 `STREAM_WAIT_FAILED`
- **AND** 报告不包含该轮次的原始 stdout、prompt、模型输出或异常正文

#### Scenario: 多个明确失败采用最后一项
- **WHEN** 一个非成功 task 按执行顺序包含多个合法失败轮次
- **THEN** 报告仅使用最后一个合法失败轮次的 `failurePhase` 和 `failureReasonCode` 形成唯一诊断

#### Scenario: 任一轮观测到工作区结果
- **WHEN** 一个 task 的任一 adapter 轮次明确记录 `workspaceOutcomeObserved=true`
- **THEN** 报告的 `workspaceOutcomeObserved` 为 `true`，即使最后一轮没有工作区观测或缺少该字段

#### Scenario: 没有合法结构化证据
- **WHEN** 一个非成功 task 的 adapter 输出均不包含合法的安全结构化失败证据
- **THEN** 报告使用既有安全 fallback 阶段和原因码
- **AND** 报告不从非结构化文本猜测失败原因

### Requirement: 模型输出上限仅形成观测事实

评测报告 schema version 3 MUST 为每个 task 输出必填布尔字段 `modelOutputLimitObserved`，并 MUST 汇总 `modelOutputLimitObservedCount`。当任一可验证模型轮次的 `usage.output_tokens` 达到或超过该候选运行配置的 `maxOutputTokens` 时，逐 task 字段 MUST 为 `true`；没有达到、缺少合法 usage 或 task 未执行时 MUST 为 `false`。该观测 MUST NOT 改写 task 的 terminal 状态、失败阶段、原因码、重试资格、评分分量或 `taskScore`。JSON 报告与 Markdown 摘要 MUST 对该观测给出一致结论。

**需求类别**：系统质量属性

**质量属性**：审计/可追溯性
**适用范围**：该 Function

#### Scenario: 失败 task 达到输出上限
- **WHEN** 一个失败 task 的任一可验证模型轮次记录 `usage.output_tokens` 等于候选运行配置的 `maxOutputTokens`
- **THEN** 逐 task `modelOutputLimitObserved` 为 `true` 且汇总计数包含该 task
- **AND** task 保留原有 terminal 状态、失败阶段、原因码和零分语义

#### Scenario: 成功 task 达到输出上限
- **WHEN** 一个最终成功的 task 曾有模型轮次达到候选运行配置的 `maxOutputTokens`
- **THEN** 逐 task `modelOutputLimitObserved` 为 `true`
- **AND** task 仍按上游合法评分形成成功结论

#### Scenario: 没有达到或没有 usage
- **WHEN** task 的全部合法模型轮次均低于候选输出上限，或不存在合法模型轮次 usage
- **THEN** 逐 task `modelOutputLimitObserved` 为 `false`

#### Scenario: JSON 与 Markdown 结论一致
- **WHEN** 系统为同一次运行生成 JSON 报告和 Markdown 摘要
- **THEN** Markdown 展示的逐 task 输出上限观测与 JSON 的 `modelOutputLimitObserved` 一致
- **AND** Markdown 展示的汇总数量与 JSON 的 `modelOutputLimitObservedCount` 一致

### Requirement: 剩余失败类型具有固定恢复回归入口

系统 MUST 提供版本控制内的 `failure-recovery-regression` profile，并 MUST 固定执行 `007-session-memory`、`078-local-api-cursor-retry-ledger`、`081-local-html-dom-form-extract`、`088-api-contract-mock-client-compat` 和 `091-financial-close-reconciliation`。该 profile MUST 声明 `nonScoring=true`，MUST 复用真实候选执行、grader 预检、报告和安全诊断路径，且 MUST NOT 生成 `frameworkEffectScore` 或改变全量评测清单与计分语义。

**需求类别**：功能性需求

#### Scenario: 执行固定恢复回归
- **WHEN** 开发者选择 `failure-recovery-regression` profile 运行评测
- **THEN** manifest 恰好包含该 Requirement 固定的五个 task id
- **AND** 每个 task 通过与全量运行相同的候选执行、grader 预检、报告和安全诊断路径处理

#### Scenario: 恢复回归保持非计分
- **WHEN** `failure-recovery-regression` 运行完成或中断
- **THEN** 报告标记 `nonScoring=true` 且不包含 `frameworkEffectScore`
- **AND** 该运行结果不得被宣称为框架效果得分或全量可比基线

### Requirement: 计分报告提供显式总体的互斥统计

完整计分运行的 schema version 4 JSON 报告 MUST 包含 `scoreSummaries.frameworkEffect` 和 `scoreSummaries.scoredCombined`。每个摘要 MUST 包含 `population`、`scoreField`、`taskCount`、`scoreSum`、`mean` 和 `bands`；`bands` MUST 恰好包含互斥的 `perfect`、`excellent`、`good`、`qualified` 和 `needsImprovement` 计数，五个计数之和 MUST 等于该摘要的 `taskCount`。`perfect` MUST 只统计分数等于 `1` 的 task；`excellent` MUST 只统计分数大于等于 `0.9` 且小于 `1` 的 task；`good` MUST 只统计分数大于等于 `0.6` 且小于 `0.9` 的 task；`qualified` MUST 只统计分数大于等于 `0.4` 且小于 `0.6` 的 task；`needsImprovement` MUST 只统计分数小于 `0.4` 的 task。

`scoreSummaries.frameworkEffect` 的 `population` MUST 为 `execute`，`scoreField` MUST 为 `taskScore`，`taskCount` MUST 等于 `scoringDenominator`，`mean` MUST 等于 `frameworkEffectScore`。`scoreSummaries.scoredCombined` 的 `population` MUST 为 `terminalStatus=scored`，`scoreField` MUST 为 `combinedScore`，并 MUST 只统计具有合法 `combinedScore` 的 scored task。两组摘要的 `scoreSum` 和 `mean` MUST 分别由各自声明的总体与评分字段计算，并以四位小数输出。Markdown 摘要 MUST 输出与 JSON 一致的总体、评分字段、任务数、均值和互斥分档，不得把 failed task 的 `combinedScore` 表述为 `frameworkEffectScore` 贡献。

**需求类别**：系统质量属性

**质量属性**：审计/可追溯性
**适用范围**：该 Function

#### Scenario: 失败 task 具有正向原始 combinedScore

- **WHEN** 完整计分运行包含 `terminalStatus=agent_failed`、合法正向 `combinedScore` 且 `taskScore=0` 的 task
- **THEN** `scoreSummaries.frameworkEffect` MUST 仅使用该 task 的 `taskScore=0`
- **AND** `scoreSummaries.scoredCombined` MUST 排除该 task
- **AND** `scoreSummaries.frameworkEffect.mean` MUST 等于 `frameworkEffectScore`

#### Scenario: 计分分档边界互斥

- **WHEN** 一个摘要总体包含分数 `1`、`0.9`、`0.6`、`0.4` 和小于 `0.4` 的 task
- **THEN** 每个 task MUST 恰好计入一个 `bands` 计数
- **AND** `perfect` 与 `excellent` MUST NOT 重复计数分数等于 `1` 的 task
- **AND** 五个计数之和 MUST 等于该摘要的 `taskCount`

#### Scenario: JSON 与 Markdown 统计一致

- **WHEN** 系统为同一个完整计分运行生成 JSON 报告和 Markdown 摘要
- **THEN** 两种格式 MUST 输出相同的两个统计总体、评分字段、任务数、均值和分档计数

### Requirement: stream 等待失败使用可行动的闭集原因码

已接受请求的 stream 等待 MUST 按可观察条件形成唯一结论。stream 在未出现 terminal event 时成功结束，且已经接收至少一个具有合法 timeline `sequence` 的 event 时，系统 MUST 使用同一 `sessionId`、`runId` 和已接收的最高 `sequence` 作为 `lastSeenSequence` 续接 stream；续接 MUST 共享原始 terminal 等待 deadline，MUST NOT 重新提交请求、重新执行 task、重试模型调用或重置等待预算，且续接次数 MUST 以当前等待预算内可能发生的 300000ms subscriber idle close 次数为上界。stream HTTP 响应为非成功状态时，系统 MUST 输出 `failurePhase=stream_wait` 和 `failureReasonCode=STREAM_HTTP_FAILED`；stream 在未出现 terminal event 且没有合法续接 cursor，或超出有界续接次数时结束，系统 MUST 输出 `failurePhase=stream_wait` 和 `failureReasonCode=STREAM_CLOSED_WITHOUT_TERMINAL`；stream 请求或响应体读取因非本地 terminal 等待预算原因失败时，系统 MUST 输出 `failurePhase=stream_wait` 和 `failureReasonCode=STREAM_TRANSPORT_FAILED`。本地 terminal 等待预算耗尽时，系统 MUST 继续输出 `failurePhase=terminal` 和 `failureReasonCode=TASK_TIMED_OUT`，不得输出任一 stream 等待原因码。报告 MUST NOT 包含原始响应体、异常正文、主机路径、credential 或认证 token。

**需求类别**：系统质量属性

**质量属性**：审计/可追溯性
**适用范围**：该 Function

#### Scenario: stream HTTP 响应失败

- **WHEN** 已接受请求的 stream endpoint 返回非成功 HTTP 状态
- **THEN** task MUST 记录 `failurePhase=stream_wait` 和 `failureReasonCode=STREAM_HTTP_FAILED`
- **AND** 报告 MUST NOT 记录原始响应体

#### Scenario: stream 在 terminal 前关闭

- **WHEN** stream 响应成功但在任何 terminal event 或合法 timeline sequence 出现前结束，或已超出有界续接次数
- **THEN** task MUST 记录 `failurePhase=stream_wait` 和 `failureReasonCode=STREAM_CLOSED_WITHOUT_TERMINAL`

#### Scenario: subscriber idle close 后续接同一 run

- **WHEN** stream 在 terminal event 前成功结束且已经接收最高合法 timeline `sequence=N`
- **AND** 原始 terminal 等待预算尚未耗尽且有界续接次数尚未用尽
- **THEN** 系统 MUST 使用同一 `sessionId`、`runId` 和 `lastSeenSequence=N` 续接 stream
- **AND** 后续 terminal event MUST 形成该 task 的唯一 terminal 结论
- **AND** 系统 MUST NOT 重新提交请求、重新执行 task、重试模型调用或重置原始 terminal 等待预算

#### Scenario: stream transport 失败

- **WHEN** stream 请求或响应体读取因非本地 terminal 等待预算原因失败
- **THEN** task MUST 记录 `failurePhase=stream_wait` 和 `failureReasonCode=STREAM_TRANSPORT_FAILED`
- **AND** 报告 MUST NOT 记录异常正文

#### Scenario: terminal 等待预算耗尽

- **WHEN** 已接受请求等待 terminal event 达到当前 profile 的 terminal 等待预算
- **THEN** task MUST 记录 `failurePhase=terminal` 和 `failureReasonCode=TASK_TIMED_OUT`
- **AND** task MUST NOT 记录 `STREAM_HTTP_FAILED`、`STREAM_CLOSED_WITHOUT_TERMINAL` 或 `STREAM_TRANSPORT_FAILED`

### Requirement: stream 失败具有固定非计分回归入口

系统 MUST 提供版本控制内的 `stream-failure-regression` profile，并 MUST 固定执行 `037-policy-clause-retrieval`、`041-frontend-state-bug`、`042-api-schema-migration`、`050-multitable-join-analysis`、`077-archive-manifest-defense`、`078-local-api-cursor-retry-ledger`、`079-smallfile-batch-reject-ledger` 和 `103-policy-update-replan-diff`。该 profile MUST 声明 `nonScoring=true`，MUST 复用完整评测的真实候选执行、grader 预检、报告和安全诊断路径，且 MUST NOT 生成 `frameworkEffectScore` 或改变全量评测清单与计分语义。

**需求类别**：功能性需求

#### Scenario: 执行固定 stream 失败回归

- **WHEN** 开发者选择 `stream-failure-regression` profile
- **THEN** manifest MUST 恰好包含该 Requirement 固定的八个 task id
- **AND** 每个 task MUST 通过与完整评测相同的真实候选执行、grader 预检、报告和安全诊断路径处理

#### Scenario: stream 失败回归保持非计分

- **WHEN** `stream-failure-regression` 完成或中断
- **THEN** 报告 MUST 标记 `nonScoring=true`
- **AND** 报告 MUST NOT 包含 `frameworkEffectScore`

### Requirement: 候选模型调用与任务执行采用分层预算

系统 MUST 为全量和定向 HarnessBench 运行生成隔离 candidate，并将该 candidate 的每次模型调用预算固定为 `300,000 ms`；HarnessBench generic CLI adapter 的 task 进程预算与 NextAgent 已接受请求的 terminal 等待预算 MUST 分别固定为 `600 s`。单次模型调用达到模型调用预算时，系统 MUST 以模型调用超时结束该次调用；已接受请求的 terminal 等待达到 `600 s` 时，系统 MUST 取消该请求并以 `timed_out` 形成终态结论。

**需求类别**：系统质量属性
**质量属性**：可靠性/恢复
**适用范围**：该 Function

#### Scenario: 长模型调用在任务总预算内继续执行

- **WHEN** 一个状态为 `execute` 的 task 发起单次耗时超过 `120,000 ms` 且小于 `300,000 ms` 的模型调用
- **THEN** 系统 MUST NOT 因旧的 `120,000 ms` 预算终止该次模型调用
- **AND** task MUST 继续受 `600 s` 总执行预算约束

#### Scenario: 任务总预算仍然生效

- **WHEN** 一个状态为 `execute` 的 task 已接受请求且等待 terminal result 达到 `600 s`
- **THEN** 系统 MUST 取消该 task 已接受但未终止的请求
- **AND** task MUST 以 `timed_out` 和 `taskScore=0` 形成终态结论

### Requirement: 本机 mock endpoint 不依赖公网 tunnel

系统 MUST 为状态为 `execute` 且依赖 HarnessBench 本机 mock HTTP endpoint 的 task 提供该 endpoint 的本机可达 URL。标准评测运行 MUST 将 `HARNESSBENCH_PUBLIC_URL_TEMPLATE` 固定为 `{local_url}`，MUST 以该值覆盖调用者进程中的同名环境变量，并且 MUST NOT 要求安装或启动公网 tunnel 工具。

**需求类别**：系统质量属性
**质量属性**：可测试性
**适用范围**：该 Function

#### Scenario: 本机 mock endpoint 直接暴露

- **WHEN** 一个状态为 `execute` 的 task 启动 HarnessBench 本机 mock HTTP endpoint
- **THEN** task hook MUST 取得该 endpoint 的本机 URL
- **AND** 系统 MUST NOT 启动公网 tunnel 进程

#### Scenario: 外部模板不得重定向标准评测

- **WHEN** 调用者进程已设置其他 `HARNESSBENCH_PUBLIC_URL_TEMPLATE` 值
- **THEN** 标准评测传给 task hook 的值 MUST 仍为 `{local_url}`
- **AND** task MUST 继续使用本机 mock HTTP endpoint

### Requirement: 多轮任务保持会话连续且跨任务隔离

当固定 HarnessBench task 以同一个上游 session id 提交多个顺序轮次时，评测系统 MUST 让全部轮次使用同一个 NextAgent 候选持久化边界和同一个 NextAgent session，并 MUST 让后续轮次通过公开 request 与 stream 行为观察前序轮次已经持久化的会话事实。不同上游 session id、不同 task 或不同评测 run MUST NOT 共享候选持久化边界、NextAgent session 或映射状态。HarnessBench 输入 workspace 由上游 task 生命周期拥有，不属于本 Requirement 的隔离 owner。每轮完成后系统 MUST 有界停止本轮 local runtime；停止进程 MUST NOT 删除仍供同 task 后续轮次使用的持久化边界。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复
**适用范围**：该 Function

#### Scenario: 同一 session 的第二轮观察第一轮会话事实
- **WHEN** 一个多轮 task 的第一轮通过真实 NextAgent session 持久化会话事实，第二轮使用相同 HarnessBench session id 提交新 request
- **THEN** 第二轮使用与第一轮相同的 NextAgent session
- **AND** 第二轮可通过产品既有 context/history 路径观察第一轮已经持久化的会话事实

#### Scenario: 不同 session 保持隔离
- **WHEN** 两个 HarnessBench task 或两个不同上游 session id 分别执行
- **THEN** 它们使用不同的候选持久化边界和 NextAgent session
- **AND** 任一执行均不能观察另一执行的 NextAgent session、候选持久化事实或映射状态

#### Scenario: 首轮执行初始化会话
- **WHEN** 一个合法上游 session id 尚无已完成初始化的复用状态
- **THEN** 系统初始化隔离候选持久化边界并通过公开 API 创建恰好一个 NextAgent session
- **AND** 仅在初始化完整成功后使该状态可供后续轮次复用

#### Scenario: 非法复用状态安全失败
- **WHEN** 上游 session id 对应的复用状态无法通过版本、session identity 或 containment 校验
- **THEN** 系统 MUST 拒绝使用该状态并形成安全 task failure
- **AND** MUST NOT 读取边界外路径、复用其他 session 或以部分状态继续执行

### Requirement: 任务执行为结果收集保留确定预算

系统 MUST 将标准全量与定向 profile 的 generic CLI 子进程预算固定为 `1200 s`，并将 NextAgent 已接受请求的 terminal 等待预算固定为 `1080 s`；从 terminal 等待预算结束到 generic CLI 子进程预算结束 MUST 保留恰好 `120 s`，用于 CLI runtime cleanup 和 workspace export。系统 MUST NOT 使用同一个截止时刻同时终止 terminal 等待和 generic CLI 子进程；oracle、rubric 和 upstream-result 落盘 MUST 在 generic CLI 子进程返回后继续执行。

**需求类别**：系统质量属性
**质量属性**：可靠性/恢复
**适用范围**：该 Function

#### Scenario: terminal 在内层预算内完成

- **WHEN** 一个 `execute` task 在提交后 `1080 s` 内形成 terminal result
- **THEN** 系统 MUST 在 generic CLI 子进程内继续完成 runtime cleanup 和 workspace export
- **AND** generic CLI 子进程 MUST 继续受 `1200 s` 确定上界约束
- **AND** generic CLI 子进程返回后，系统 MUST 继续执行 oracle、rubric 和 upstream-result 落盘

#### Scenario: terminal 达到内层预算

- **WHEN** 一个已接受请求等待 terminal result 达到 `1080 s`
- **THEN** 系统 MUST 取消该请求并形成结构化 terminal failure
- **AND** 系统 MUST 继续在剩余 `120 s` 预算内完成 CLI runtime cleanup 和 workspace export
- **AND** generic CLI 子进程返回后，系统 MUST 继续执行 oracle、rubric 和 upstream-result 落盘

### Requirement: 有效 upstream-result 优先于进程摘要

Python task 进程退出后，系统 MUST 读取与当前 task id 唯一匹配的 upstream-result；当该文件存在且是有效 JSON 时，系统 MUST 以该文件形成 task 结论，MUST NOT 因进程 stdout 摘要缺失、包含额外文本或无法解析而丢弃该结果。不存在有效 upstream-result 时，系统 MUST NOT 使用仅包含 CLI terminal envelope 的 sidecar 伪造 scored 结果。

**需求类别**：系统质量属性
**质量属性**：可靠性/恢复
**适用范围**：该 Function

#### Scenario: stdout 摘要无效但结果文件有效

- **WHEN** Python task 进程已经退出、stdout 不包含有效 JSON 摘要且当前 task 的 upstream-result 是有效 JSON
- **THEN** 系统 MUST 从 upstream-result 形成 task 结论
- **AND** task 的 usage、oracle、rubric 和评分 MUST 来自该 upstream-result

#### Scenario: 结果文件不存在

- **WHEN** Python task 进程已经退出且当前 task 不存在有效 upstream-result
- **THEN** 系统 MUST 形成 `harness_process` 失败
- **AND** 系统 MUST NOT 把 CLI terminal envelope 解释为 upstream-result

### Requirement: HarnessBench 进程失败使用闭集原因码

系统 MUST 为未形成有效 upstream-result 的 HarnessBench 进程失败输出唯一 `failurePhase=harness_process`，且 `failureReasonCode` MUST 是 `PROCESS_START_FAILED`、`PROCESS_NONZERO_EXIT`、`PROCESS_TIMEOUT`、`RESULT_SUMMARY_INVALID`、`RESULT_JSON_MISSING` 或 `RESULT_JSON_INVALID` 之一。系统 MUST NOT 在上述可判定条件下输出 `UNKNOWN`，且报告 MUST NOT 包含原始 stdout、stderr、prompt、模型输出、credential、token 或主机绝对路径。

**需求类别**：系统质量属性
**质量属性**：审计/可追溯性
**适用范围**：该 Function

#### Scenario: Python 进程非零退出且无结果

- **WHEN** Python task 进程以非零退出码结束且不存在有效 upstream-result
- **THEN** task MUST 以 `failureReasonCode=PROCESS_NONZERO_EXIT` 形成终态结论

#### Scenario: Python 进程被外层预算终止且无结果

- **WHEN** Python task 进程达到 `1200 s` 外层预算且不存在有效 upstream-result
- **THEN** task MUST 以 `failureReasonCode=PROCESS_TIMEOUT` 形成终态结论

#### Scenario: stdout 摘要无效且无结果

- **WHEN** Python task 进程以退出码 `0` 结束、stdout 不包含有效 JSON 摘要且不存在有效 upstream-result
- **THEN** task MUST 以 `failureReasonCode=RESULT_SUMMARY_INVALID` 形成终态结论

#### Scenario: upstream-result JSON 无效

- **WHEN** 当前 task 存在 upstream-result 文件但全部匹配文件都不是有效 JSON
- **THEN** task MUST 以 `failureReasonCode=RESULT_JSON_INVALID` 形成终态结论

### Requirement: 候选模型使用固定的基础输出预算

系统 MUST 对标准全量 profile 和全部固定定向回归 profile 使用相同的 candidate profile 基础输出预算 `maxOutputTokens=16384`。系统 MUST NOT 按 task id、task 内容、task 类型、历史分数或运行中间结果动态改写该基础值。当既有输出恢复契约被触发时，恢复调用 MUST 按该契约计算并覆盖单次调用的 `maxOutputTokens`；未触发恢复时，模型调用 MUST 使用 `16384 tokens` 基础值。

**需求类别**：系统质量属性
**质量属性**：性能/容量、可测试性
**适用范围**：该 Function

#### Scenario: 标准全量运行使用固定候选预算

- **WHEN** 运维人员启动标准全量 HarnessBench profile
- **THEN** 每个 `execute` task 生成的 candidate profile MUST 包含 `maxOutputTokens=16384`
- **AND** 未触发既有输出恢复契约的模型调用 MUST 使用该基础值
- **AND** 不同 task 之间不得根据 task 属性改变该基础值

#### Scenario: 定向回归与标准全量保持同一预算

- **WHEN** 运维人员启动任一固定定向回归 profile
- **THEN** candidate profile MUST 使用与标准全量 profile 相同的 `16384 tokens` 基础输出预算
- **AND** 定向 profile 的 `nonScoring` 语义 MUST 保持不变

#### Scenario: 输出恢复覆盖基础预算

- **WHEN** 候选模型结果按既有输出恢复契约进入预算提升调用
- **THEN** 恢复调用 MUST 使用该契约计算出的 `maxOutputTokens` 覆盖 `16384 tokens` 基础值
- **AND** 未触发输出恢复的其他 task MUST 继续使用固定基础值

### Requirement: 候选模型使用固定的单次调用超时

系统 MUST 对标准全量 profile 和全部固定定向回归 profile 使用相同的候选模型单次调用超时：从模型请求发出到模型终态或安全失败形成的时间上界 MUST 为 `540 s`。系统 MUST NOT 按 task id、task 内容、task 类型、历史分数或运行中间结果动态改写该值。模型调用仍 MUST 受已接受请求的 terminal 等待预算与取消信号约束；达到较早截止条件时，系统 MUST 使用该条件的既有安全终态，不得为等待单次调用上限而越过 terminal 等待预算。

**需求类别**：系统质量属性
**质量属性**：可靠性/恢复、可测试性
**适用范围**：该 Function

#### Scenario: 标准全量运行使用固定调用超时

- **WHEN** 运维人员启动标准全量 HarnessBench profile
- **THEN** 每个 `execute` task 生成的 candidate profile MUST 包含 `timeoutMs=540000`
- **AND** 不同 task 之间不得根据 task 属性改变该值

#### Scenario: 定向回归使用相同调用超时

- **WHEN** 运维人员启动任一固定定向回归 profile
- **THEN** candidate profile MUST 使用与标准全量 profile 相同的 `540 s` 单次调用超时

#### Scenario: terminal 截止早于模型调用截止

- **WHEN** 已接受请求的 terminal 等待预算或取消信号在单次模型调用形成终态前到达
- **THEN** 系统 MUST 停止等待该模型调用
- **AND** MUST 按既有 terminal 或取消失败语义形成安全结论
- **AND** MUST NOT 为等待 `540 s` 单次调用上限而越过较早的 terminal 截止

### Requirement: Windows 上游 Python 命令使用已预检解释器

在 Windows 标准全量和定向 HarnessBench 运行中，系统 MUST 在第一个 task 执行前使上游子进程中的 `python3` 命令调用本次运行已通过候选模型前置验证的 Python 解释器。该命令 MUST 只在本次评测运行的 HarnessBench task 子进程环境中可见，MUST NOT 修改系统或用户级 `PATH`、Python 安装、固定 HarnessBench cache、task、Oracle 或 rubric。系统无法建立该命令，或该命令解析出的解释器身份与已预检解释器不一致时，MUST 在第一个 task 前终止且 MUST NOT 产生 `frameworkEffectScore`。

**需求类别**：系统质量属性
**质量属性**：可靠性/恢复、可测试性、审计/可追溯性
**适用范围**：该 Function

#### Scenario: 上游 Oracle 通过 python3 使用已预检解释器

- **GIVEN** Windows 评测入口已用选定 Python 解释器完成候选模型前置验证
- **WHEN** HarnessBench task 或 Oracle 在上游子进程中执行 `python3`
- **THEN** 该命令 MUST 启动同一个已预检 Python 解释器
- **AND** task MUST 继续使用固定 HarnessBench task、Oracle 与评分实现形成上游结果

#### Scenario: 运行级命令不污染主机和固定上游

- **WHEN** Windows 评测入口为上游子进程提供 `python3`
- **THEN** 该命令 MUST 仅对本次运行的 HarnessBench task 子进程生效
- **AND** 系统和用户级环境以及固定 HarnessBench cache MUST 保持不变

#### Scenario: 无法保证解释器身份时前置失败

- **WHEN** Windows 评测入口无法建立 `python3` 命令，或该命令不能解析到已预检解释器
- **THEN** 系统 MUST 在第一个 task 执行前终止
- **AND** 本次运行 MUST NOT 产生 `frameworkEffectScore`

### Requirement: 候选任务固定使用可信 shell 模式

系统为 HarnessBench 清单中每个状态为 `execute` 的 task 启动 NextAgent 候选运行时，MUST 在候选配置中显式设置 `sandbox.enabled=false`。该值 MUST 对全部 task 和全部执行 attempt 保持固定，MUST NOT 从 task id、task 输入、prompt、模型输出或客户端 metadata 派生或被其覆盖。动态 Bash、Python 和脚本执行仍 MUST 经过产品既有 sandbox gateway 边界；本 Requirement MUST NOT 改变 HarnessBench 评测之外的产品 sandbox 默认值或配置语义。

**需求类别**：功能性需求

#### Scenario: 执行任务生成固定候选配置

- **WHEN** 系统为任一状态为 `execute` 的 HarnessBench task 准备候选运行时
- **THEN** 该候选配置包含 `sandbox.enabled=false`
- **AND** task 的每个执行 attempt 使用相同配置值

#### Scenario: 任务内容不得改变候选执行模式

- **WHEN** task 输入、prompt、模型输出或客户端 metadata 包含 sandbox 配置或本地 API 信息
- **THEN** 系统仍以 `sandbox.enabled=false` 启动候选运行时
- **AND** 系统 MUST NOT 根据这些不可信输入启用受限 sandbox 或生成 task-specific allowlist

#### Scenario: 评测外产品配置保持原有语义

- **WHEN** NextAgent 在 HarnessBench 候选运行之外启动
- **THEN** 本 Requirement 不改变其 `sandbox.enabled` 默认值、显式配置值或 sandbox gateway 执行边界

### Requirement: reasoning-only 输出耗尽形成独立报告事实

HarnessBench schema version 5 JSON task result MUST 包含 boolean `modelReasoningOnlyOutputLimitObserved`，diagnostics MUST 包含非负整数 `modelReasoningOnlyOutputLimitObservedCount`。只有当前 task 的 run-local usage-proxy 结构化证据中至少一次已完成模型调用同时满足以下全部条件时，task 字段 MUST 为 `true`：归一化结束原因为 `length`；用户可见 content 为空；Tool call 为空；合法 completion token 数为正整数；合法 reasoning token 数等于 completion token 数。证据缺失、不可解析、字段非法、数值不相等、调用未完成或任一条件不满足时，task 字段 MUST 为 `false`。聚合计数 MUST 恰好等于 task 字段为 `true` 的 task 数；JSON 与 Markdown MUST 内容一致。

该事实 MUST 独立于 task 的 `terminalStatus`、`failurePhase` 和 `failureReasonCode`。报告生成器 MUST NOT 以该事实改写实际终态、失败原因、retry、grader 输入、`taskScore`、`combinedScore`、`frameworkEffectScore` 或 scoring denominator。证据提取和报告 MUST NOT 输出 reasoning、prompt、模型 content、Tool arguments、provider raw body、stream delta、usage-proxy 原始记录、主机绝对路径、credential 或认证 token。

**需求类别**：系统质量属性
**质量属性**：审计/可追溯性
**适用范围**：该 Function

#### Scenario: 全部 completion 均为 reasoning 的长度截断

- **WHEN** 当前 task 的一次已完成模型调用具有 `finishReason="length"`、空可见 content、空 Tool call、`completionTokens=16384` 和 `reasoningTokens=16384`
- **THEN** task 的 `modelReasoningOnlyOutputLimitObserved` MUST 为 `true`
- **AND** diagnostics 的 `modelReasoningOnlyOutputLimitObservedCount` MUST 包含该 task 恰好一次

#### Scenario: 普通可见输出长度截断不误标

- **WHEN** 已完成模型调用具有 `finishReason="length"`，但存在非空可见 content、完整 Tool call或 `reasoningTokens` 不等于 `completionTokens`
- **THEN** 该调用 MUST NOT 使 `modelReasoningOnlyOutputLimitObserved` 变为 `true`

#### Scenario: 证据缺失时关闭观测

- **WHEN** usage-proxy 结构化记录缺失、不可解析、越出当前 run 边界、调用未完成或缺少合法 token detail
- **THEN** task 的 `modelReasoningOnlyOutputLimitObserved` MUST 为 `false`
- **AND** 报告 MUST NOT 推断 token 数、读取边界外文件或暴露原始证据

#### Scenario: timeout 终态保持真实原因

- **WHEN** task 已观测到 reasoning-only 输出耗尽并最终因 terminal 等待预算耗尽而失败
- **THEN** `modelReasoningOnlyOutputLimitObserved` MUST 为 `true`
- **AND** `failurePhase` MUST 继续为 `terminal`
- **AND** `failureReasonCode` MUST 继续为 `TASK_TIMED_OUT`

### Requirement: reasoning-only 输出耗尽具有固定非计分回归入口

系统 MUST 提供版本控制内的 `reasoning-only-output-exhaustion-regression` profile，并 MUST 固定执行 `021-batch-rename-transform` 与 `037-policy-clause-retrieval`。该 profile MUST 声明 `nonScoring=true`，MUST 复用完整评测的真实候选执行、usage-proxy、grader 预检、报告和安全诊断路径，且 MUST NOT 生成 `frameworkEffectScore` 或改变全量评测清单与计分语义。

**需求类别**：功能性需求

#### Scenario: 执行固定 reasoning-only 回归

- **WHEN** 开发者选择 `reasoning-only-output-exhaustion-regression` profile
- **THEN** manifest MUST 恰好包含 `021-batch-rename-transform` 与 `037-policy-clause-retrieval`
- **AND** 每个 task MUST 通过与完整评测相同的真实候选执行、usage-proxy、grader 预检、报告和安全诊断路径处理

#### Scenario: reasoning-only 回归保持非计分

- **WHEN** `reasoning-only-output-exhaustion-regression` 完成或中断
- **THEN** 报告 MUST 标记 `nonScoring=true`
- **AND** 报告 MUST NOT 包含 `frameworkEffectScore`
