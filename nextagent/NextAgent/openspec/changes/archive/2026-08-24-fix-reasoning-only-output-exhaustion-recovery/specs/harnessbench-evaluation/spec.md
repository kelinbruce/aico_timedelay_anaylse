## Function

- **所属 Function**：`FN-10.13 HarnessBench 评测`（harnessbench-evaluation）
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

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


## Function 变更汇总

### 输出

- **变更类型**：修改
- **目标内容**：schema version 5 报告以不改变终态与计分的独立布尔事实和聚合计数标记 reasoning-only 输出耗尽，并保持 JSON 与 Markdown 内容一致且不暴露原始模型证据。
- **依据 Requirements**：`reasoning-only 输出耗尽形成独立报告事实`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统对当前 run 内结构化证据执行 fail-closed 判定，并通过固定非计分 profile 对两个已知复现 task 使用完整真实评测路径验证恢复结果。
- **依据 Requirements**：`reasoning-only 输出耗尽形成独立报告事实`、`reasoning-only 输出耗尽具有固定非计分回归入口`

### 规格

- **规格项**：报告格式
- **变更类型**：修改
- **原规格值**：schema version 4 机器可读 JSON 报告与内容一致 Markdown 摘要
- **目标规格值**：schema version 5 机器可读 JSON 报告与内容一致 Markdown 摘要，增加 reasoning-only 输出耗尽独立观测事实及聚合计数
- **依据 Requirements**：`reasoning-only 输出耗尽形成独立报告事实`

- **规格项**：reasoning-only 输出耗尽回归 profile
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`reasoning-only-output-exhaustion-regression` 固定覆盖 `021-batch-rename-transform`、`037-policy-clause-retrieval`，且 `nonScoring=true`
- **依据 Requirements**：`reasoning-only 输出耗尽具有固定非计分回归入口`
