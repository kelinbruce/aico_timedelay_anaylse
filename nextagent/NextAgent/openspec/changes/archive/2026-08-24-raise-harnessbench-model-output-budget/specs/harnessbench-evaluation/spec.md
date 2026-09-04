## Function

- **所属 Function**：`FN-10.13 HarnessBench 评测`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

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

## Function 变更汇总

### 输入

- **变更类型**：修改
- **目标内容**：HarnessBench 计分运行和定向回归的运行预算包含固定的 candidate profile 基础输出预算与单次调用超时。
- **依据 Requirements**：`候选模型使用固定的基础输出预算`、`候选模型使用固定的单次调用超时`

### 规格

- **规格项**：候选模型调用预算
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：标准全量与全部固定定向回归的 candidate profile 固定使用 `16384 tokens` 基础输出预算和 `540 s` 单次调用超时；不得按 task 动态改写，输出恢复仍可按既有契约覆盖单次恢复预算，模型调用仍受较早的 terminal 截止或取消信号约束。
- **依据 Requirements**：`候选模型使用固定的基础输出预算`、`候选模型使用固定的单次调用超时`
