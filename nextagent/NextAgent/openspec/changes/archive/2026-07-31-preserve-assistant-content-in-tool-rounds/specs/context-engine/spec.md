## MODIFIED Requirements

### Requirement: Render 映射消息角色并将 tool call 与结果配对

`ModelInputRenderer` SHALL 将会话消息角色映射为 `RenderedMessage` 角色：USER 映射为 user、ASSISTANT 映射为 assistant、CAPABILITY_RESULT 映射为 tool 并携带来源 tool call id 和 tool 名称。当一条持久化的 assistant tool-use 消息包含非空公开 assistant 内容和有序 tool calls 时，renderer SHALL 发出一条 assistant 消息，其 content parts 先包含公开文本，再按持久化顺序包含 tool calls。当公开内容为空或缺席时，renderer SHALL 不发出空文本 part。压缩 summary 消息 SHALL 渲染为普通历史消息，而不是 system 权威。

renderer SHALL 按 tool call id 和 tool 名称将每个 assistant tool call 与其对应的 capability-result 消息配对，SHALL 避免重复或孤立的 tool-result 消息，并 SHALL 保持与只包含 `toolCalls` 的持久化 assistant tool-use 消息兼容。它 SHALL NOT 从 reasoning、timeline 事件、stream delta 或 raw provider 响应派生 assistant 文本。System prompt SHALL 渲染为开头的 system 消息，并在稳定与动态段文本之间发出 cache 边界标记。

#### Scenario: assistant 公开内容与 tool call 和结果配对

- **WHEN** 一条选定的 assistant tool-use 消息包含非空公开内容和带有匹配 capability-result 消息的 tool calls
- **THEN** renderer MUST 将公开内容作为该 assistant 消息的第一个文本 part 发出
- **AND** 它 MUST 在文本 part 之后按持久化顺序发出 tool calls
- **AND** 每个 tool result MUST 渲染在 assistant 消息之后并按 tool call id 和 tool 名称配对
- **AND** 已渲染过的 capability result MUST NOT 被再次发出

#### Scenario: 仅含 tool call 的 legacy assistant 消息保持可渲染

- **WHEN** 一条选定的 assistant tool-use 消息包含 tool calls 但没有公开内容字段
- **THEN** renderer MUST 发出有序的 tool-call parts 而不带空文本 part
- **AND** 匹配的 tool results MUST 保持正确配对

#### Scenario: Summary 消息渲染为历史

- **WHEN** 一条选定消息是压缩 summary
- **THEN** 它被渲染为普通历史消息而不是 system 权威段
