## Function

- **所属 Function**：`FN-5.6 向用户提问`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 单个问题支持至多十五个预定义选项

`AskUserQuestion` 的 model-facing input schema 中，当单个问题包含 `options` 数组时，该数组 MUST 接受二至十五个合法预定义选项。系统接受该输入后 MUST 按输入顺序完整保留所有选项，不得截断或重排。包含十六个或更多选项的调用 MUST 返回安全 `INVALID_INPUT` validation outcome，并且 MUST NOT 创建部分 pending input。

**需求类别**：功能性需求

#### Scenario: 九个预定义选项被完整接受

- **GIVEN** 一个其他字段均合法且包含九个唯一预定义选项的问题
- **WHEN** Agent 调用 `AskUserQuestion`
- **THEN** 系统 MUST 接受该调用并创建 `QUESTION` pending input
- **AND** pending input MUST 按输入顺序包含全部九个选项

#### Scenario: 十五个预定义选项在上边界被完整接受

- **GIVEN** 一个其他字段均合法且包含十五个唯一预定义选项的问题
- **WHEN** Agent 调用 `AskUserQuestion`
- **THEN** 系统 MUST 接受该调用并创建 `QUESTION` pending input
- **AND** pending input MUST 按输入顺序包含全部十五个选项

#### Scenario: 十六个预定义选项被拒绝

- **GIVEN** 一个其他字段均合法但包含十六个预定义选项的问题
- **WHEN** Agent 调用 `AskUserQuestion`
- **THEN** 系统 MUST 返回安全 `INVALID_INPUT` validation outcome
- **AND** 系统 MUST NOT 截断选项或创建 pending input

#### Scenario: 模型可见 schema 声明新边界

- **WHEN** Agent 获取 `AskUserQuestion` Tool descriptor
- **THEN** `questions[].options` schema MUST 声明 `minItems: 2` 和 `maxItems: 15`
- **AND** `questions[].options.description` MUST 表明单个问题可提供二至十五个预定义选项

### Requirement: 中文界面使用简洁的手动输入标签

当中文界面为允许自由文本回答的 `AskUserQuestion` 问题显示自由文本入口时，系统 MUST 将该入口标记为“手动输入”，并且 MUST NOT 改变该入口原有的自由文本回答语义。

**需求类别**：功能性需求

#### Scenario: 中文自由文本入口显示简洁标签

- **GIVEN** 当前界面语言为 `zh-CN`
- **WHEN** 前端呈现允许自由文本回答的 `AskUserQuestion` 问题
- **THEN** 自由文本入口 MUST 显示“手动输入”

## Function 变更汇总

- **结果**
  - 变更类型：修改
  - 目标内容：中文界面的自由文本回答入口显示“手动输入”，回答语义保持不变
  - 依据 Requirements：`中文界面使用简洁的手动输入标签`

- **规格**
  - 规格项：单个问题的预定义选项数量
  - 变更类型：修改
  - 原规格值：不适用（新增）
  - 目标规格值：每个问题二至十五个预定义选项
  - 依据 Requirement：`单个问题支持至多十五个预定义选项`
