## Function

- **所属 Function**：`FN-5.9 调用技能`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Skill args 不按字段名承担执行治理

当模型通过 `Skill.args` 提交目标 Skill 的 task data 时，系统 MUST 把任意字段名视为普通 task data，并 MUST NOT 仅因根对象或任意嵌套对象中的字段名称拒绝调用。`mode`、`path`、`directory`、`provider`、`providerId`、`timeout`、`budget`、`timeoutMs`、`timeout_ms`、`childBudget`、`child_budget` 和 `providerOverride` MUST 与其他字段名使用相同规则。系统 MUST 只从可信 runtime context、policy 和受治理 metadata 推导实际执行治理，并 MUST NOT 从 `Skill.args` 读取 timeout、child budget、provider selection 或其他执行控制。`args` 仍 MUST 满足既有 JSON object、可序列化、字节数和嵌套深度边界。

**需求类别**：功能性需求

#### Scenario: 治理同名业务字段在根层和嵌套层通过
- **WHEN** 模型调用 `Skill`，且 `args` 在根层或嵌套对象中包含本 Requirement 明确列出的任一字段
- **THEN** 系统 MUST NOT 因字段名称拒绝调用
- **AND** 系统 MUST 继续应用与字段名称无关的既有 JSON envelope 边界

#### Scenario: Args 中的治理同名字段不改变执行控制
- **WHEN** `Skill.args` 包含 `timeoutMs`、`timeout_ms`、`childBudget`、`child_budget` 或 `providerOverride`
- **THEN** 系统 MUST NOT 从这些字段派生实际 timeout、child budget 或 provider selection
- **AND** 可信 runtime context、policy 和受治理 metadata MUST 保持为执行治理的唯一来源

#### Scenario: Tool 描述区分 task data 与执行治理
- **WHEN** 系统向模型披露 Skill Tool descriptor
- **THEN** descriptor MUST 指示模型把 `args` 用作 task data
- **AND** descriptor MUST 说明 `args` 中的字段不会改变可信 runtime 执行治理

## Function 变更汇总

### 输入

- **变更类型**：修改
- **目标内容**：`Skill.args` 接受满足既有 JSON envelope 边界的业务 task data，任意字段名都不因名称本身被全局拒绝。
- **依据 Requirements**：`Skill args 不按字段名承担执行治理`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统将 `args` 作为 task data 校验，并只从可信运行上下文与受治理事实决定执行控制。
- **依据 Requirements**：`Skill args 不按字段名承担执行治理`

### 规格

- **规格项**：`args` 字段名规则
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：任意字段名均不因名称本身被全局拒绝，且不覆盖可信执行治理
- **依据 Requirements**：`Skill args 不按字段名承担执行治理`
