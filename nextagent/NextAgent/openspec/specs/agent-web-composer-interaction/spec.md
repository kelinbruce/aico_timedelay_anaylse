# agent-web-composer-interaction Specification

## Purpose
定义 Agent Web 普通 Composer 的提交、换行、IME、可见上下文键盘优先级、当前已加载问题回看、Escape 控制、slash-command 目录和快捷键帮助行为。
## Requirements
### Requirement: Composer SHALL preserve submit, newline, and IME semantics

Agent Web Composer MUST only submit non-blank text. When no higher-priority Composer overlay is handling the key, `Enter` without `Shift` SHALL submit the current text, `Shift+Enter` SHALL preserve the browser newline behavior, and an `Enter` generated while an IME composition is active SHALL NOT submit.

#### Scenario: Enter submits non-blank text
- **GIVEN** the Composer contains non-blank text and no command or association panel is handling the key
- **WHEN** the user presses `Enter` without `Shift` outside IME composition
- **THEN** Agent Web SHALL submit the current text

#### Scenario: Shift Enter inserts a newline
- **WHEN** the user presses `Shift+Enter` in the Composer
- **THEN** Agent Web SHALL NOT submit
- **AND** the textarea SHALL retain its native newline behavior

#### Scenario: IME Enter does not submit
- **WHEN** the user presses `Enter` while IME composition is active
- **THEN** Agent Web SHALL NOT submit the Composer text

### Requirement: Composer keyboard handling SHALL follow visible-context priority

The Composer MUST give an open slash-command panel priority over an open question-association panel, and MUST give either panel priority over history navigation and normal submit. An active panel SHALL consume its supported `ArrowUp`, `ArrowDown`, `Enter`, `Tab`, and `Escape` actions. Selecting an enabled command or associated question with `Enter` or `Tab` SHALL update the Composer text and close the panel. Selecting a Skill SHALL update the separate Skill selection state and close its picker rather than inserting the Skill name as question text. None of these selection actions SHALL submit until a later explicit submit action.

#### Scenario: Open command panel consumes Enter
- **GIVEN** the slash-command panel is open with an enabled item selected
- **WHEN** the user presses `Enter`
- **THEN** Agent Web SHALL fill that item into the Composer and close the panel
- **AND** Agent Web SHALL NOT submit a request from that key press

#### Scenario: Open association panel consumes navigation keys
- **GIVEN** the question-association panel is open
- **WHEN** the user presses `ArrowUp`, `ArrowDown`, `Enter`, `Tab`, or `Escape`
- **THEN** the panel SHALL handle the action before Composer history or submit handling

### Requirement: Normal Composer mode SHALL provide browser-session request history recall

In normal mode, `ArrowUp` or `ArrowDown` without Alt, Ctrl, or Meta and with a collapsed textarea selection SHALL navigate the Composer request history. Shift does not exclude the current history path. The first `ArrowUp` SHALL enter history only when the current Composer is empty, navigation SHALL proceed from newest to older entries, and moving past the newest entry with `ArrowDown` SHALL restore the draft that existed before history navigation. Editing recalled text SHALL leave history-navigation mode. Edit-resubmit mode SHALL NOT enable this history navigation.

#### Scenario: Arrow Up recalls the newest request
- **GIVEN** normal Composer mode, an empty input, a collapsed selection, and non-empty request history
- **WHEN** the user presses `ArrowUp` without Alt, Ctrl, or Meta
- **THEN** Agent Web SHALL place the newest history entry in the Composer

#### Scenario: Arrow Down restores the pre-navigation draft
- **GIVEN** the user entered history navigation with a saved pre-navigation draft
- **WHEN** the user navigates past the newest entry with `ArrowDown`
- **THEN** Agent Web SHALL restore that saved draft

#### Scenario: Edit mode does not recall normal history
- **GIVEN** the Composer is in edit-resubmit mode
- **WHEN** the user presses `ArrowUp` or `ArrowDown`
- **THEN** Agent Web SHALL NOT replace the edited text with Composer request history

### Requirement: Escape SHALL dismiss transient UI before stopping an executing request

`Escape` MUST first be offered to visible dialogs, drawers, popovers, dropdowns, selects, command panels, and association panels. In non-executing edit mode, `Escape` SHALL cancel edit mode. While a request is executing and no dismissible surface consumes the key, the first `Escape` SHALL arm a short-lived stop confirmation and display its notice; a second `Escape` within the current confirmation window SHALL request stop. The same two-step stop behavior SHALL work while focus remains inside Agent Web even when the textarea itself is not focused.

#### Scenario: Overlay dismissal does not arm request stop
- **GIVEN** a dismissible Composer overlay is visible while a request is executing
- **WHEN** the user presses `Escape`
- **THEN** Agent Web SHALL dismiss the overlay
- **AND** SHALL NOT arm or invoke request stop from that key press

#### Scenario: Two Escape presses stop the current request
- **GIVEN** a request is executing and no dismissible surface consumes `Escape`
- **WHEN** the user presses `Escape` and then presses it again within the confirmation window
- **THEN** the first press SHALL display a stop confirmation notice
- **AND** the second press SHALL invoke stop for the executing request

#### Scenario: Escape leaves edit mode when not executing
- **GIVEN** the Composer is in edit-resubmit mode and no request is executing
- **WHEN** the user presses `Escape`
- **THEN** Agent Web SHALL route the action to edit cancellation
- **AND** the resulting draft restoration SHALL follow the `request-edit-resubmit` contract

### Requirement: Composer SHALL expose only the implemented slash-command catalog

The built-in command catalog MUST contain `/help`, `/retry`, and `/edit`. The catalog entry for `/help` SHALL remain enabled independently of Write permission, while Slash-command execution still passes through the current writable Composer submit guard. `/retry` and `/edit` SHALL be enabled only when the user has Write permission, a latest target exists, and the conversation is not executing. The first whitespace-delimited token SHALL determine an exact command, so trailing text SHALL NOT turn a recognized command into a normal message. When an exact command reaches the writable submit handler, executing a disabled command or an unknown slash-prefixed token SHALL clear that command text, display a safe warning, and SHALL NOT submit it as a user message.

#### Scenario: Help command with trailing text opens help
- **GIVEN** the Composer is writable
- **WHEN** the user submits `/help explain alarms`
- **THEN** Agent Web SHALL open command help
- **AND** SHALL NOT send the text as a user message

#### Scenario: Unknown slash text is not sent
- **WHEN** the user submits an unknown slash-prefixed token
- **THEN** Agent Web SHALL clear the command text and display a warning
- **AND** SHALL NOT submit a request

#### Scenario: Retry and edit reflect current eligibility
- **GIVEN** Write permission, a latest target, and no executing request
- **WHEN** the command catalog is shown
- **THEN** `/retry` and `/edit` SHALL be enabled
- **AND** if any prerequisite is absent, the affected command SHALL be disabled with a reason

### Requirement: Shortcut help SHALL match the implemented public shortcuts

Agent Web SHALL expose shortcut help for focusing the Composer, opening help, navigating adjacent sessions, submitting, entering a newline, cancelling edit or confirming stop, and navigating the session list. `Mod+K` SHALL focus the Composer on the chat root or navigate to the root before focusing it. `Mod+/` SHALL open shortcut help. Outside editable targets, `Mod+[` and `Mod+]` SHALL navigate to the previous and next adjacent session. Session-list `ArrowUp`, `ArrowDown`, and `Enter` SHALL navigate and activate the selected session.

#### Scenario: Mod K focuses the Composer
- **WHEN** the user presses `Mod+K`
- **THEN** Agent Web SHALL focus the Composer
- **AND** if necessary SHALL first navigate to the chat root

#### Scenario: Adjacent-session shortcuts avoid editable targets
- **GIVEN** focus is not in an editable target
- **WHEN** the user presses `Mod+[` or `Mod+]`
- **THEN** Agent Web SHALL navigate to the previous or next adjacent session respectively
