## ADDED Requirements

### Requirement: 不安全标题内容 SHALL 报告按类别区分的安全消息

当修剪后的标题匹配某个禁止内容模式时，session owner SHALL 以一个 `SESSION_TITLE_UNSAFE_CONTENT` SafeError 拒绝该更新，其 message 指明匹配的内容类别。系统 SHALL 区分 XSS 敏感类别（HTML 标签、`javascript:` URL 或事件处理属性）与 secret 敏感类别（credential、API key、token 或密码），并 SHALL 报告引用所匹配类别的消息。该错误 SHALL NOT 包含不安全的标题内容或任何匹配的子串。

当修剪后的标题同时匹配两个类别时，系统 SHALL 报告单一确定的类别（XSS 敏感类别）。

#### Scenario: XSS 敏感标题被拒绝并带 XSS 特定消息

- **WHEN** 修剪后的标题匹配已实现的 XSS 敏感模式（HTML 标签、`javascript:` URL 或事件处理属性）
- **THEN** 更新 SHALL 以一个 `SESSION_TITLE_UNSAFE_CONTENT` SafeError 失败
- **AND** 错误消息 SHALL 引用 HTML 标签、`javascript:` URL 或事件处理器
- **AND** 该错误 SHALL NOT 包含不安全的标题内容

#### Scenario: Secret 敏感标题被拒绝并带 secret 特定消息

- **WHEN** 修剪后的标题匹配已实现的 secret 敏感模式（credential、API key、token 或密码）
- **THEN** 更新 SHALL 以一个 `SESSION_TITLE_UNSAFE_CONTENT` SafeError 失败
- **AND** 错误消息 SHALL 引用 credential、API key 或 secret
- **AND** 该错误 SHALL NOT 包含不安全的标题内容

#### Scenario: 同时匹配两个类别的标题报告 XSS 类别

- **WHEN** 修剪后的标题同时匹配 XSS 敏感模式和 secret 敏感模式
- **THEN** 更新 SHALL 以单一一个报告 XSS 敏感类别的 `SESSION_TITLE_UNSAFE_CONTENT` SafeError 失败
- **AND** 该错误 SHALL NOT 包含不安全的标题内容
