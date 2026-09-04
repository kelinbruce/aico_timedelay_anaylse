## Function

- **所属 Function**：`FN-5.6 向用户提问`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: AskUserQuestion QUESTION kind accepts free-text answers regardless of custom declaration

QUESTION kind 的 pending input MUST 总是接受用户提交的选项列表外自由文本回答，无论模型是否在 Tool input 中声明 `custom=true`。Runtime answer 校验 MUST NOT 因 `custom !== true` 拒绝 QUESTION kind 的自定义值；MUST 限制每个 question 的自定义值不超过一个。已接受的自由文本回答 MUST 通过已有 `customText` 语义投影到 `resolvedAnswers`，使模型在后续步骤中能参考和使用。`custom=true` 仍为模型显式声明自定义回答的方式，MUST NOT 从 model-facing schema 中移除；但它 MUST NOT 作为 runtime 接受自由文本回答的前提条件。

QUESTION answer payload MAY 提供与 `answers` 等长的 `answerKinds`。提供时，每项 MUST 为 `TEXT`、`OPTION_SELECTION`、`OPTION_ATTACHED_TEXT`、`CUSTOM_TEXT` 或 `OPTION_SELECTIONS_WITH_CUSTOM_TEXT`，并 MUST 与对应 accepted question 和 answer values 一致；不一致时 runtime MUST 拒绝该回答。缺失时 runtime MUST 保持既有 value 匹配推断行为。`CUSTOM_TEXT` 与 `OPTION_SELECTIONS_WITH_CUSTOM_TEXT` MUST 以用户选择的输入控件为依据，不得通过自由文本是否等于 option value 推断。

单选模式下选项选择与自由文本 MUST 互斥：用户要么提交一个选项值，要么提交一段自由文本，MUST NOT 同时提交。多选模式下选项选择与自由文本 MAY 共存：用户 MAY 同时提交多个选项值和一段自由文本。前端 MUST 通过互斥交互保证单选模式下不会同时产生选项值和自由文本。

CONFIRMATION、AUTHORIZATION 和 HUMAN_HANDOFF 的 answer 校验 MUST NOT 受本 Requirement 影响；它们 MUST 继续使用各自定义的固定 answer 校验。

**需求类别**：功能性需求

#### Scenario: 未声明 custom 的单选问题接受自由文本回答

- **GIVEN** 模型调用 `AskUserQuestion` 时一个问题包含 options 且未声明 `custom=true`
- **WHEN** 用户通过可信 answer boundary 提交一个不匹配任何 option value 的自由文本
- **THEN** runtime MUST 接受该回答并 resolve pending input
- **AND** `resolvedAnswers` MUST 把该值投影为 `customText`
- **AND** runtime MUST NOT 返回 `PENDING_INPUT_ANSWER_INVALID`

#### Scenario: 自由文本与 option value 相同仍保持自由输入语义

- **GIVEN** 单选 QUESTION 的一个 option value 为 `change_ne`
- **WHEN** 用户通过自由输入控件提交文本 `change_ne`，并携带 `answerKinds=["CUSTOM_TEXT"]`
- **THEN** runtime MUST 把回答投影为 `customText="change_ne"`
- **AND** `selections` MUST 为空
- **AND** Tool Result MUST 回显已校验的 `answerKinds`
- **AND** Tool Result MUST 提供英文指令，声明 `CUSTOM_TEXT` 与 `resolvedAnswers[].customText` 是权威输入来源
- **AND** 该指令 MUST 明确即使自由文本与 option value 或 label 完全相同，也不得重新解释为选项选择
- **AND** 模型 MUST 按自由文本语义继续，且不得仅因其不是预设选项选择而重复原问题

#### Scenario: 未声明 custom 的多选问题接受选项与自由文本共存

- **GIVEN** 模型调用 `AskUserQuestion` 时一个问题包含 options 且 `multiple=true`，未声明 `custom=true`
- **WHEN** 用户提交的 answer 同时包含匹配 option 的值和不匹配 option 的自由文本
- **THEN** runtime MUST 接受该回答
- **AND** `resolvedAnswers` MUST 把匹配的值投影为 `selections`，把不匹配的值投影为 `customText`
- **AND** runtime MUST NOT 返回 `PENDING_INPUT_ANSWER_INVALID`

#### Scenario: requiresTextInput option 问题接受自由文本回答

- **GIVEN** 模型调用 `AskUserQuestion` 时一个问题包含 `requiresTextInput=true` option，且未声明 `custom=true`
- **WHEN** 用户提交一个不匹配任何 option value 的自由文本
- **THEN** runtime MUST 接受该回答
- **AND** `resolvedAnswers` MUST 把该值投影为 `customText`，MUST NOT 投影为 `selections[].textInput`
- **AND** runtime MUST NOT 返回 `PENDING_INPUT_ANSWER_INVALID`

#### Scenario: 超过一个自定义值仍被拒绝

- **GIVEN** 模型调用 `AskUserQuestion` 时一个问题包含 options
- **WHEN** 用户提交的 answer 包含两个或更多不匹配任何 option value 的自定义值
- **THEN** runtime MUST 返回 `PENDING_INPUT_ANSWER_INVALID`
- **AND** runtime MUST NOT resolve pending input

#### Scenario: 声明 custom 的问题行为不变

- **GIVEN** 模型调用 `AskUserQuestion` 时一个问题包含 options 且 `custom=true`
- **WHEN** 用户提交选项列表外的自由文本
- **THEN** runtime MUST 接受该回答
- **AND** `resolvedAnswers` MUST 把该值投影为 `customText`
- **AND** 行为 MUST 与未声明 custom 时一致

#### Scenario: 模型可见指导提及用户自由文本可能性

- **WHEN** context rendering 把 `AskUserQuestion` 作为 callable model Tool 暴露
- **THEN** model-facing guidance MUST 提及用户可能提供选项列表外的自由文本回答
- **AND** guidance MUST 要求模型在后续步骤中参考和使用该回答
- **AND** guidance MUST NOT 改变 schema 的 `custom` 字段定义或将其标记为 deprecated

#### Scenario: CONFIRMATION 和 AUTHORIZATION 不受自由文本影响

- **WHEN** pending input kind 为 `CONFIRMATION` 或 `AUTHORIZATION`
- **THEN** runtime MUST 继续使用各自定义的固定 answer 校验
- **AND** MUST NOT 接受固定选项外的自由文本

#### Scenario: 单选模式 answer 格式不产生歧义

- **GIVEN** 一个单选 QUESTION 问题（`multiple` 缺失或为 false）
- **WHEN** 用户通过前端交互提交回答
- **THEN** answer MUST 为恰好一个 `string[]`，包含一个 option value 或一段自由文本
- **AND** answer MUST NOT 同时包含 option value 和自由文本
- **AND** 前端 MUST 通过互斥交互保证此约束

## MODIFIED Requirements

### Requirement: AskUserQuestion 支持具体选项附带文本输入

`AskUserQuestion` SHALL allow multiple different options in one single-select question to independently declare that selecting the option requires one attached text value. The model-facing Tool description and input schema MUST distinguish free-text questions, ordinary option questions, question-level custom answers, and option-attached text input without adding a parallel question type discriminator.

`requiresTextInput=true` option 与 `custom=true` MAY 在同一个 single-select question 中共存。`requiresTextInput=true` option 与 `multiple=true` MUST NOT 在同一个 question 中共存。

#### Scenario: Tool 描述向模型说明全部输入形态

- **WHEN** context rendering exposes `AskUserQuestion` as a callable model Tool
- **THEN** description and schema MUST explain that a free-text question omits `options` and directly accepts user text
- **AND** an ordinary option omits `requiresTextInput`
- **AND** an option that needs a parameter sets `requiresTextInput=true` and may supply `inputPlaceholder`
- **AND** multiple different options in the same single-select question MAY each set `requiresTextInput=true`
- **AND** the model MUST use a unique meaningful option `value` for each such option and MUST NOT use the reserved value `custom` to identify option-attached input
- **AND** question-level `custom=true` MUST remain the one generic non-option answer mechanism rather than an option-attached parameter
- **AND** guidance MUST mention that users may provide free-text answers outside the predefined options regardless of whether `custom=true` is declared

#### Scenario: Producer preserves valid option-attached input constraints

- **WHEN** the model calls `AskUserQuestion` with a single-select question whose options have unique values and one or more options set `requiresTextInput=true`
- **THEN** Agent/core MUST validate the resolved descriptor schema and visible-text limits
- **AND** the accepted `QUESTION` pending request MUST preserve each option's `requiresTextInput` and optional `inputPlaceholder`
- **AND** the producer MUST NOT add an answer schema, client identity, idempotency material or lifecycle ownership to the Tool result.

#### Scenario: Producer rejects ambiguous option-attached input combinations

- **WHEN** a question with any `requiresTextInput=true` option also has `multiple=true`
- **THEN** Agent/core MUST reject the input with safe `INVALID_INPUT`
- **AND** MUST NOT create or partially persist a pending input.

#### Scenario: Producer rejects invalid option input presentation fields

- **WHEN** an option supplies `inputPlaceholder` without `requiresTextInput=true`, supplies a non-boolean `requiresTextInput`, or supplies an empty or more than 200 character `inputPlaceholder`
- **THEN** Agent/core MUST reject the input with safe `INVALID_INPUT`
- **AND** MUST NOT create a pending input.

### Requirement: AskUserQuestion 用户回答提供可信且模型友好的结果

用户对 pending question 的回答 MUST 继续通过可信 channel/runtime answer boundary 提交，MUST NOT 由模型在 AskUserQuestion input 中提供或覆盖。Runtime MUST 保留既有有序 `answers: string[][]` 事实；QUESTION 调用方 MAY 同时提交与问题等长的 `answerKinds`。Runtime MUST 在正常 AskUserQuestion `CAPABILITY_RESULT` 中提供根据 accepted question shape、answer values 和已校验 `answerKinds` 解析的 `resolvedAnswers`。

`resolvedAnswers` MUST 通过 `questionIndex` 与原问题对应，MUST 明确区分纯文本、预设 option selection、option-attached text input 和 custom text。QUESTION kind 的 custom text 投影 MUST NOT 依赖模型是否声明 `custom=true`。存在 `answerKinds` 时，runtime MUST 以其表达的已校验用户输入来源为准；缺失时，不匹配任何 option value 的回答值 MUST 被投影为 `customText`。解析 MUST NOT 改变数据库表结构。

#### Scenario: option-attached text answer 被语义化

- **GIVEN** accepted question 的 option `later` 使用 `requiresTextInput=true`
- **WHEN** 用户通过可信 answer boundary 提交 `[["later", "10分钟"]]`
- **THEN** 正常 capability result 的原始 `answers` MUST 保持 `[["later", "10分钟"]]`
- **AND** `resolvedAnswers[0].selections[0]` MUST 包含 option 的 `value`、`label` 和 `textInput="10分钟"`。

#### Scenario: custom 与纯文本回答不与选项值混淆

- **WHEN** 用户对 custom-enabled option question 提交列表外文本
- **THEN** runtime MUST 把该值投影为 `customText`
- **WHEN** 用户回答无 options 的文本问题
- **THEN** runtime MUST 把该值投影为 `text`
- **AND** 两种场景都 MUST 保留原始 `answers`。

#### Scenario: 未声明 custom 时的自由文本被投影为 customText

- **GIVEN** accepted question 包含 options 且模型未声明 `custom=true`
- **WHEN** 用户提交的 answer 包含一个不匹配任何 option value 的自由文本
- **THEN** `resolvedAnswers` MUST 把该值投影为 `customText`
- **AND** `resolvedAnswers` MUST NOT 把该值投影为 `text`（因为该问题有 options）
- **AND** 原始 `answers` MUST 保留该值

#### Scenario: 多选模式下的选项与自由文本共存投影

- **GIVEN** accepted question 包含 options 且 `multiple=true`，模型未声明 `custom=true`
- **WHEN** 用户提交的 answer 同时包含匹配 option 的值和自由文本，并携带 `answerKinds=["OPTION_SELECTIONS_WITH_CUSTOM_TEXT"]`
- **THEN** `resolvedAnswers` MUST 把匹配的值投影为 `selections`
- **AND** `resolvedAnswers` MUST 把不匹配的值投影为 `customText`
- **AND** 原始 `answers` MUST 保留所有值
- **AND** Tool Result MUST 提供英文指令，声明 `selections` 与 `customText` 是同一用户回答中有意提供的两个组成部分
- **AND** 该指令 MUST 要求模型同时保留和使用两个组成部分，不得丢弃或重新解释任一部分
