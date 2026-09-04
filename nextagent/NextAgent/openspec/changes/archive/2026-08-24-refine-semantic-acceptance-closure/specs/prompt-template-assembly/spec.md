## Function

- **所属 Function**：`FN-10.4 自定义工具和提示词`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 内置系统提示提供语义验收闭环指导

系统 MUST 在 builtin `SYSTEM_PROMPT` 的 `task_approach` section 中，为正确性依赖用户显式规则和本地来源证据的 workspace task 提供语义验收闭环指导。该指导 MUST 要求模型在宣称完成前逐项关联与所请求结果相关的全部显式规则、支持该规则判断的来源证据和对应产出结果，并复核规则覆盖、证据支持以及结果间一致性。对分类、聚合、交叉引用和审计结果，该指导 MUST 要求模型从来源证据重新核对关键分类、数量和引用关系；发现不一致时 MUST 先修正结果，来源证据不足或显式规则冲突时 MUST 明确保留可核查的限制说明。该指导 MUST 明确文件存在、语法可解析或格式验证通过均不能单独证明语义验收完成，且 MUST NOT 引导模型编造缺失事实。

该指导 MUST 保持通用，不得包含特定 benchmark 的 task id、固定答案、oracle 规则、rubric 内容或 grader 反馈。Agent package 对 `task_approach` section 的既有覆盖优先级 MUST 保持不变。

**需求类别**：系统质量属性
**质量属性**：可靠性/恢复
**适用范围**：该 Function

#### Scenario: 规则驱动任务接收语义验收指导

- **WHEN** 系统装配 builtin `SYSTEM_PROMPT`
- **THEN** `task_approach` section MUST 要求模型在宣称规则驱动的 workspace task 完成前逐项关联与所请求结果相关的全部显式规则、来源证据和对应产出结果
- **AND** 该 section MUST 要求模型复核这些显式规则的覆盖情况、每项结果的证据支持以及结果间一致性
- **AND** 该 section MUST 明确文件存在、语法可解析或格式验证通过均不能单独证明语义验收完成

#### Scenario: 分类和聚合结果从来源证据重新核对

- **WHEN** 系统装配 builtin `SYSTEM_PROMPT`
- **THEN** `task_approach` section MUST 要求模型在规则驱动的 workspace task 包含分类、聚合、交叉引用或审计结果时，从来源证据重新核对适用的关键分类、数量和引用关系
- **AND** 发现产出结果与来源证据不一致时，该 section MUST 要求模型先修正结果再宣称完成

#### Scenario: 证据不足或规则冲突时不编造结果

- **WHEN** 系统装配 builtin `SYSTEM_PROMPT`
- **THEN** `task_approach` section MUST 要求模型在本地来源证据不足以支持结果，或两个显式规则对同一结果产生冲突时，保留可核查的限制说明
- **AND** 该 section MUST NOT 引导模型补写没有来源证据支持的事实

#### Scenario: Builtin 指导保持通用且可覆盖

- **WHEN** 系统装配 builtin `SYSTEM_PROMPT` 或 Agent package 覆盖 `task_approach` section
- **THEN** builtin 指导 MUST NOT 包含特定 benchmark 的 task id、固定答案、oracle 规则、rubric 内容或 grader 反馈
- **AND** Agent package 的 `task_approach` section MUST 继续按既有 source priority 覆盖 builtin section

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：系统装配可由 Agent package 覆盖的 builtin Prompt Template，并在默认任务指导中为规则驱动的 workspace task 提供规则、来源证据与产出结果之间的语义验收闭环。
- **依据 Requirements**：`内置系统提示提供语义验收闭环指导`

### 处理过程

- **变更类型**：修改
- **目标内容**：builtin 任务指导要求模型在宣称完成前逐项核对显式规则、来源证据和产出结果，复核关键分类、数量及引用关系，并在不一致时修正结果，在证据不足或规则冲突时保留限制说明。
- **依据 Requirements**：`内置系统提示提供语义验收闭环指导`

### 结果

- **变更类型**：修改
- **目标内容**：使用 builtin `SYSTEM_PROMPT` 的模型输入包含通用、可核查且不以格式通过替代语义正确性的任务验收指导。
- **依据 Requirements**：`内置系统提示提供语义验收闭环指导`
