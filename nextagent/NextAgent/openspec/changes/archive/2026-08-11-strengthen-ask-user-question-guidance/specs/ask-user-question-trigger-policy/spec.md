## REMOVED Requirements

### Requirement: User-facing agents trigger AskUserQuestion for blocking ordinary user input

**Reason**：该 Requirement 的目标行为属于 `FN-5.6 向用户提问` 的统一模型可见输入与交互边界，迁入 canonical `ask-user-question-tool` spec 后可避免同一 Function 的触发规则分散在两个 specs。

**Migration**：使用 `ask-user-question-tool` 中同名 ADDED Requirement 作为目标行为契约；`Invoked read-only network explorer does not directly create user questions` 继续保留在本 legacy spec，且本 change 不修改其行为。
