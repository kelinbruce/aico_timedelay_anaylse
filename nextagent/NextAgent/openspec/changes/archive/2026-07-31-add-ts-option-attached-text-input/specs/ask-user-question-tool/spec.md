## ADDED Requirements

### Requirement: AskUserQuestion 支持具体选项附带文本输入

`AskUserQuestion` SHALL allow multiple different options in one single-select question to independently declare that selecting the option requires one attached text value. The model-facing Tool description and input schema MUST distinguish free-text questions, ordinary option questions, question-level custom answers, and option-attached text input without adding a parallel question type discriminator.

#### Scenario: Tool 描述向模型说明全部输入形态

- **WHEN** context rendering exposes `AskUserQuestion` as a callable model Tool
- **THEN** description and schema MUST explain that a free-text question omits `options` and directly accepts user text
- **AND** an ordinary option omits `requiresTextInput`
- **AND** an option that needs a parameter sets `requiresTextInput=true` and may supply `inputPlaceholder`
- **AND** multiple different options in the same single-select question MAY each set `requiresTextInput=true`
- **AND** the model MUST use a unique meaningful option `value` for each such option and MUST NOT use the reserved value `custom` to identify option-attached input
- **AND** question-level `custom=true` MUST remain the one generic non-option answer mechanism rather than an option-attached parameter.

#### Scenario: Producer preserves valid option-attached input constraints

- **WHEN** the model calls `AskUserQuestion` with a single-select question whose options have unique values and one or more options set `requiresTextInput=true`
- **THEN** Agent/core MUST validate the resolved descriptor schema and visible-text limits
- **AND** the accepted `QUESTION` pending request MUST preserve each option's `requiresTextInput` and optional `inputPlaceholder`
- **AND** the producer MUST NOT add an answer schema, client identity, idempotency material or lifecycle ownership to the Tool result.

#### Scenario: Producer rejects ambiguous option-attached input combinations

- **WHEN** a question with any `requiresTextInput=true` option also has `multiple=true` or `custom=true`
- **THEN** Agent/core MUST reject the input with safe `INVALID_INPUT`
- **AND** MUST NOT create or partially persist a pending input.

#### Scenario: Producer rejects invalid option input presentation fields

- **WHEN** an option supplies `inputPlaceholder` without `requiresTextInput=true`, supplies a non-boolean `requiresTextInput`, or supplies an empty or more than 200 character `inputPlaceholder`
- **THEN** Agent/core MUST reject the input with safe `INVALID_INPUT`
- **AND** MUST NOT create a pending input.
