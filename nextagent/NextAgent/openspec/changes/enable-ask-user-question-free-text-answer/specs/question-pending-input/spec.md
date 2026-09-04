## Function

- **所属 Function**：`FN-5.6 向用户提问`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Question pending input supports text, single select, multi-select, and custom answers

NextAgent SHALL support `PendingInputKind.QUESTION` for user clarification during an existing request run. A question pending input MUST reuse the runtime-owned pending lifecycle and MUST NOT create a separate question state machine.

QUESTION kind MUST 总是接受用户提交的选项列表外自由文本回答，无论模型是否在 Tool input 中声明 `custom=true`。Runtime answer 校验 MUST NOT 因 `custom` 缺失或为 false 拒绝 QUESTION kind 的自定义值；MUST 限制每个 question 的自定义值不超过一个。`custom=true` 仍为模型显式声明自定义回答的方式，MUST NOT 作为 runtime 接受自由文本回答的前提条件。

QUESTION answer payload MAY 携带与 ordered `answers` 等长的 `answerKinds`。提供时，runtime MUST 按 accepted question 校验每一项与 answer values 的一致性，并 MUST 持久化该来源语义；缺失时 runtime MUST 使用既有 option value 匹配规则推断。`answerKinds` MUST NOT 被 CONFIRMATION、AUTHORIZATION 或 HUMAN_HANDOFF 接受。

单选模式下选项选择与自由文本 MUST 互斥：用户要么提交一个选项值，要么提交一段自由文本，MUST NOT 同时提交。多选模式下选项选择与自由文本 MAY 共存：用户 MAY 同时提交多个选项值和一段自由文本。

#### Scenario: Text question answer
- **WHEN** a `QUESTION` pending input contains a question with no options
- **THEN** the answer for that question MUST contain exactly one non-empty string
- **AND** runtime MUST treat that string as the user's text answer for the original run continuation.

#### Scenario: Single-select answer
- **WHEN** a `QUESTION` pending input contains a question with options and `multiple` is absent or false
- **THEN** the answer for that question MUST contain exactly one string
- **AND** that string MAY match one option value from the pending request
- **AND** if that string does not match any option value, runtime MUST accept it as a free-text answer and MUST NOT reject it
- **AND** runtime MUST NOT require `custom=true` to accept a non-option value.

#### Scenario: Multi-select answer
- **WHEN** a `QUESTION` pending input contains a question with options and `multiple=true`
- **THEN** the answer for that question MUST contain one or more unique non-empty strings
- **AND** strings that match option values from the pending request MUST be treated as selected options
- **AND** at most one string that does not match any option value MUST be accepted as a free-text answer
- **AND** runtime MUST NOT require `custom=true` to accept a non-option value
- **AND** runtime MUST treat the ordered answer array as the selected values and optional free text for the original run continuation.

#### Scenario: Free-text answer without custom declaration
- **GIVEN** a `QUESTION` pending input contains a question with options and `custom` is absent or false
- **WHEN** the user submits a single non-option value for that question
- **THEN** runtime MUST accept the answer
- **AND** runtime MUST resolve the pending input to `RECEIVED`
- **AND** `resolvedAnswers` MUST project the value as `customText`
- **AND** runtime MUST NOT return a validation error.

#### Scenario: More than one non-option value is rejected
- **WHEN** a `QUESTION` answer entry contains two or more strings that do not match any option value
- **THEN** runtime MUST reject the answer with a safe validation outcome
- **AND** runtime MUST NOT resolve the pending input to `RECEIVED`.

#### Scenario: Custom option answer behavior unchanged
- **WHEN** a `QUESTION` pending input contains a question with options and `custom=true`
- **THEN** runtime MUST accept either matching option values or at most one non-option custom text value for that question
- **AND** behavior MUST be identical to when `custom` is absent or false
- **AND** `custom=true` MUST come from the accepted pending request, not from the client answer payload.

#### Scenario: Invalid question answer shape is rejected
- **WHEN** a `QUESTION` answer entry violates its accepted question constraints
- **THEN** runtime MUST reject the answer with a safe validation outcome
- **AND** runtime MUST NOT resolve the pending input to `RECEIVED`.
#### Scenario: Custom option answer
- **WHEN** a `QUESTION` pending input contains a question with options and `custom=true`
- **THEN** runtime MUST accept either matching option values or at most one non-option custom text value for that question
- **AND** `custom=true` MUST come from the accepted pending request, not from the client answer payload.
