## Function

- **所属 Function**：`FN-10.4 自定义工具和提示词`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 内置系统提示提供有界产物执行指导

系统 MUST 在 builtin `SYSTEM_PROMPT` 的 `task_approach` section 中提供复杂 workspace task 的有界产物推进指导。该指导 MUST 要求模型先执行确定产物结构所需的最小检查，再识别用户明确要求的全部工作区产物和可由可用 Tool 本地检查的验收条件；结构确定后 MUST 尽早创建每个必需产物的最小有效版本，再使用多个有界 Tool call 增量补全大体量内容，并在结束前验证必需产物存在且满足明确的本地格式要求。该指导 MUST NOT 包含特定 benchmark 的 task id、固定答案、oracle 规则、rubric 内容或 grader 反馈。Agent package 对 `task_approach` section 的既有覆盖优先级 MUST 保持不变。

**需求类别**：系统质量属性
**质量属性**：性能/容量
**适用范围**：该 Function

#### Scenario: 最小检查后尽早创建全部必需产物

- **WHEN** 系统装配 builtin `SYSTEM_PROMPT`
- **THEN** `task_approach` section MUST 要求模型只执行确定产物结构所需的最小检查
- **AND** 该 section MUST 要求模型识别全部必需工作区产物和可本地检查的验收条件
- **AND** 结构确定后，该 section MUST 要求尽早创建每个必需产物的最小有效版本
- **AND** 该 section MUST 要求使用多个有界 Tool call 增量补全大体量内容

#### Scenario: 任务完成前接收产物验证指导

- **WHEN** 系统装配 builtin `SYSTEM_PROMPT`
- **THEN** `task_approach` section MUST 要求模型在结束前检查全部必需产物是否存在
- **AND** 对 JSON、CSV 或其他可由可用 Tool 本地检查的明确格式，section MUST 要求模型运行匹配的本地验证

#### Scenario: Builtin 指导保持通用且可覆盖

- **WHEN** 系统装配 builtin `SYSTEM_PROMPT` 或 Agent package 覆盖 `task_approach` section
- **THEN** builtin 指导 MUST NOT 包含特定 benchmark 的 task id、固定答案、oracle 规则、rubric 内容或 grader 反馈
- **AND** Agent package 的 `task_approach` section MUST 继续按既有 source priority 覆盖 builtin section

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：系统装配可由 Agent package 覆盖的 builtin Prompt Template，并在默认任务指导中提供复杂 workspace task 的有界产物推进与验证策略。
- **依据 Requirements**：`内置系统提示提供有界产物执行指导`

### 处理过程

- **变更类型**：修改
- **目标内容**：builtin `task_approach` 指导模型先完成确定结构所需的最小检查，再尽早形成全部必需产物的最小有效版本、分段补全并在结束前验证；Agent package 覆盖优先级保持不变。
- **依据 Requirements**：`内置系统提示提供有界产物执行指导`

### 结果

- **变更类型**：修改
- **目标内容**：使用 builtin `SYSTEM_PROMPT` 的模型输入包含通用、有界且可本地验证的复杂任务执行指导。
- **依据 Requirements**：`内置系统提示提供有界产物执行指导`
