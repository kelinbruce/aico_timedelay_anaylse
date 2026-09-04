## Function

- **所属 Function**：`FN-10.13 HarnessBench 评测`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

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

## Function 变更汇总

### 输出

- **变更类型**：修改
- **目标内容**：完整计分运行输出明确区分框架效果总体与成功任务总体的内容一致统计，并为已知 stream 等待失败输出可行动的安全原因码。
- **依据 Requirements**：`计分报告提供显式总体的互斥统计`、`stream 等待失败使用可行动的闭集原因码`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统按各摘要声明的唯一总体与评分字段计算均值和互斥分档；对 runtime subscriber idle close 按 session cursor 续接同一 accepted run，并按 stream 的 HTTP、无法续接的关闭、transport 或本地等待预算结果形成唯一结论；通过固定非计分 profile 提供真实回归入口。
- **依据 Requirements**：`计分报告提供显式总体的互斥统计`、`stream 等待失败使用可行动的闭集原因码`、`stream 失败具有固定非计分回归入口`

### 规格

- **规格项**：报告格式
- **变更类型**：修改
- **原规格值**：schema version 3 机器可读 JSON 报告与内容一致 Markdown 摘要
- **目标规格值**：schema version 4 机器可读 JSON 报告与内容一致 Markdown 摘要；完整计分运行包含 `execute/taskScore` 与 `terminalStatus=scored/combinedScore` 两组显式总体统计及五档互斥分布
- **依据 Requirements**：`计分报告提供显式总体的互斥统计`

- **规格项**：stream 等待失败原因码
- **变更类型**：修改
- **原规格值**：`STREAM_WAIT_FAILED`
- **目标规格值**：`STREAM_HTTP_FAILED`、`STREAM_CLOSED_WITHOUT_TERMINAL`、`STREAM_TRANSPORT_FAILED`；本地 terminal 等待预算耗尽仍为 `TASK_TIMED_OUT`
- **依据 Requirements**：`stream 等待失败使用可行动的闭集原因码`

- **规格项**：stream 失败回归 profile
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`stream-failure-regression` 固定覆盖 `037`、`041`、`042`、`050`、`077`、`078`、`079`、`103`，且 `nonScoring=true`
- **依据 Requirements**：`stream 失败具有固定非计分回归入口`
