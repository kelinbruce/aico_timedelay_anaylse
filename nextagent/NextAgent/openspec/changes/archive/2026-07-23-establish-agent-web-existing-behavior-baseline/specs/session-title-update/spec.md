## ADDED Requirements

### Requirement: 手动 session 标题更新 SHALL 以 owner 和 Agent 为作用域

Web 路由 `PUT /api/v1/sessions/:sessionId/title` SHALL 解析可信身份并委托给 runtime session facade，而不接受来自请求体的 Agent 作用域。runtime/session 边界 SHALL 在调用 session owner 之前解析该 session 可信的 Agent 作用域。不在该 owner 和 Agent 作用域内或未找到的 session SHALL 返回既有的安全 not-found 契约，而不泄露其他作用域的数据。

#### Scenario: 作用域内的 session 标题更新成功
- **GIVEN** 目标 session 属于可信的 owner 和 Agent 作用域
- **WHEN** 客户端发送一个合法的标题更新
- **THEN** session owner SHALL 持久化并返回更新后的 session 投影

#### Scenario: 作用域内缺失 session 时安全地返回 not found
- **WHEN** 在可信的 owner 和 Agent 作用域内未找到 session
- **THEN** 该更新 SHALL 以既有的安全 session-not-found 契约失败

### Requirement: 手动标题校验 SHALL 与当前 session-owner 规则一致

Web 标题路由 SHALL 通过既有的请求校验契约拒绝超过 100 个字符的原始 `title` 值。到达 session owner 的标题 SHALL 在校验和持久化之前被修剪。修剪后长度在 1 到 100 个字符之间（含边界）的标题 SHALL 被接受，除非它匹配已实现的敏感信息或 XSS 敏感模式。空或纯空白的标题 SHALL 被拒绝，且 SHALL NOT 清除或修改已存储的标题。

#### Scenario: 超过请求体限制的原始 Web 标题被拒绝
- **WHEN** Web 客户端提交一个超过 100 个字符的原始标题
- **THEN** 该路由 SHALL 以既有的请求校验契约失败，而不委托该更新

#### Scenario: 单字符标题被接受
- **WHEN** session owner 收到一个修剪后值仅含一个字符的安全标题
- **THEN** session owner SHALL 持久化该单字符标题

#### Scenario: 空或纯空白的标题被拒绝
- **WHEN** session owner 收到一个修剪后为空的标题
- **THEN** 该更新 SHALL 以既有的安全 too-short 契约失败
- **AND** 已存储的 session 标题 SHALL 保持不变

#### Scenario: 合法标题在持久化前被修剪
- **WHEN** session owner 收到一个带首尾空白的合法标题
- **THEN** session owner SHALL 持久化修剪后的标题

#### Scenario: 不安全的标题在修剪后被拒绝
- **WHEN** 修剪后的标题匹配已实现的敏感信息或 XSS 敏感模式
- **THEN** 该更新 SHALL 失败而不改变已存储的 session 标题

### Requirement: 手动标题来源 SHALL 阻止稍后的自动覆盖

每次成功的手动标题更新 SHALL 持久化 `titleSource="manual"`。稍后的自动标题生成 SHALL 保留手动来源并 SHALL NOT 替换该标题。

#### Scenario: 手动标题保持受保护
- **GIVEN** 用户已成功设置一个手动 session 标题
- **WHEN** 自动标题生成稍后运行
- **THEN** 它 SHALL 保留该手动标题和 `titleSource="manual"`
