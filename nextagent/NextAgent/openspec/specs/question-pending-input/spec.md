# question-pending-input Specification

## Purpose
定义提问 pending input 的选项类型、提交校验、超时和恢复行为，使运行时可安全暂停并继续等待用户回答的请求。
## Requirements
### Requirement: Question pending input supports text, single select, multi-select, and custom answers

NextAgent SHALL support `PendingInputKind.QUESTION` for user clarification during an existing request run. A question pending input MUST reuse the runtime-owned pending lifecycle and MUST NOT create a separate question state machine.

#### Scenario: Text question answer
- **WHEN** a `QUESTION` pending input contains a question with no options
- **THEN** the answer for that question MUST contain exactly one non-empty string
- **AND** runtime MUST treat that string as the user's text answer for the original run continuation.

#### Scenario: Single-select answer
- **WHEN** a `QUESTION` pending input contains a question with options and `multiple` is absent or false
- **THEN** the answer for that question MUST contain exactly one string
- **AND** that string MUST match one option value from the pending request unless `custom=true`
- **AND** any non-option value MUST be rejected with a safe validation outcome when `custom` is absent or false.

#### Scenario: Multi-select answer
- **WHEN** a `QUESTION` pending input contains a question with options and `multiple=true`
- **THEN** the answer for that question MUST contain one or more unique non-empty strings
- **AND** every selected string MUST match an option value from the pending request unless `custom=true`
- **AND** runtime MUST treat the ordered answer array as the selected values for the original run continuation.

#### Scenario: Custom option answer
- **WHEN** a `QUESTION` pending input contains a question with options and `custom=true`
- **THEN** runtime MUST accept either matching option values or at most one non-option custom text value for that question
- **AND** `custom=true` MUST come from the accepted pending request, not from the client answer payload.

#### Scenario: Invalid question answer shape is rejected
- **WHEN** a `QUESTION` answer entry violates its accepted question constraints
- **THEN** runtime MUST reject the answer with a safe validation outcome
- **AND** runtime MUST NOT resolve the pending input to `RECEIVED`.

### Requirement: Question answer resumes the original run

NextAgent SHALL route accepted question answers back into the original run's continuation from the saved checkpoint.

#### Scenario: Accepted question answer continues execution
- **WHEN** runtime accepts a valid answer for a `QUESTION` pending input
- **THEN** runtime MUST resolve the pending input to `RECEIVED`
- **AND** runtime MUST resume the original run from the pending checkpoint
- **AND** runtime MUST make the answer available to the run continuation without creating a new root request.

#### Scenario: Question timeout does not synthesize answer
- **WHEN** a `QUESTION` pending input times out
- **THEN** runtime MUST resolve the pending input to `TIMED_OUT`
- **AND** runtime MUST NOT synthesize a text answer or option choice
- **AND** runtime MUST terminalize the original run with a pending-input timeout outcome
- **AND** the visible terminal reason MUST be `PENDING_INPUT_TIMEOUT`.

### Requirement: Question pending input keeps safe projection

NextAgent SHALL expose only safe question request fields to users and downstream projections.

#### Scenario: Question request projection
- **WHEN** channel projects `USER_INPUT_REQUIRED` for a `QUESTION`
- **THEN** the payload MUST contain only pending input id, session id, kind, questions, and timeoutAt
- **AND** question prompt, options, `multiple`, and `custom` MUST be the already accepted safe request fields
- **AND** projection MUST NOT include hidden reasoning, model raw output, identity, idempotency key, origin, or answer schema.

### Requirement: Single-select option can require one attached text value

A `QUESTION` pending input SHALL allow multiple different options in one single-select question to declare `requiresTextInput=true`. Selecting one such option MUST produce one answer entry that preserves both the selected stable option value and one non-empty attached text value through the existing ordered `string[][]` answer envelope.

#### Scenario: Attached text option answer

- **WHEN** a pending single-select question contains an option with `requiresTextInput=true`
- **AND** the user selects that option and enters non-empty text
- **THEN** the client MUST submit the question answer entry as `[optionValue, inputText]`
- **AND** runtime MUST validate that the first string exactly matches the selected accepted option
- **AND** runtime MUST accept the second string only because that matched option has `requiresTextInput=true`
- **AND** the accepted answer MUST resume the original run with both strings in that order.

#### Scenario: Ordinary option keeps the existing answer shape

- **WHEN** a pending single-select question contains option-attached input options but the user selects an ordinary option without `requiresTextInput=true`
- **THEN** the client MUST submit exactly `[optionValue]`
- **AND** runtime MUST reject any second string for that ordinary option.

#### Scenario: Attached option answer requires complete input

- **WHEN** an answer selects an option with `requiresTextInput=true` but omits the second string, supplies an empty second string, supplies more than two strings, or uses a first string that does not match an accepted option
- **THEN** runtime MUST reject the answer with a safe validation outcome
- **AND** MUST NOT resolve the pending input to `RECEIVED`.

#### Scenario: Attached option input constraints are mutually exclusive with multi-select and generic custom

- **WHEN** an accepted question contains any option with `requiresTextInput=true`
- **THEN** the question MUST be single-select
- **AND** question-level `custom` MUST be absent or false
- **AND** runtime MUST reject a pending intent that combines attached option input with `multiple=true` or `custom=true`.

### Requirement: Option-attached input projection remains safe and host-consistent

The system SHALL project only already accepted option-attached input presentation constraints, and all browser host modes MUST reuse the same question component and answer submission semantics.

#### Scenario: Selected option expands one bounded text input

- **WHEN** the user selects an option with `requiresTextInput=true`
- **THEN** the shared browser question component MUST expand one text input inside that option row
- **AND** MUST display the accepted `inputPlaceholder` when present or a generic localized fallback when absent
- **AND** MUST limit the entered text to 500 characters
- **AND** MUST keep submission disabled until the attached text is non-empty.

#### Scenario: Switching selection clears stale attached input

- **WHEN** the user enters attached text and then selects a different option in the same single-select question
- **THEN** the previous option's attached text MUST NOT be included in the submitted answer
- **AND** selecting another attached-input option MUST present an input owned only by the newly selected option.
