## ADDED Requirements

### Requirement: Session Fork Web 路由

Web 路由 registry SHALL 为用户从持久化的可见 assistant message 发起的 session fork 暴露 `POST /api/v1/sessions/{sessionId}/messages/{messageId}/fork`。它 SHALL 同时暴露 `POST /api/v1/sessions/{sessionId}/requests/{requestId}/fork` 作为 live-completion 便捷入口，在复用正常 message-anchor fork 路径之前由 runtime 把 request/root message id 解析为持久化的已完成 assistant message。这些路由 MUST 通过可信 channel/auth 和 runtime session facade 进行 owner scope 和 agent scope 约束。请求体 MUST 只接受一个必填的 `idempotencyKey` 不透明有界 token。Web 路由 MUST 对提供的字符串做 trim，拒绝 trim 后为空的值，拒绝 trim 后超过 128 个字符的值，并且只把规范化后的 key 传给 runtime。该路由 MUST NOT 接受 owner 字段、Agent Scope 字段、子会话 id、子消息 id、fork source metadata、复制的消息、active context ref、timeline ref、checkpoint ref 或 raw prompt 内容。

#### Scenario: 路由 registry 暴露 fork 路由
- **WHEN** Web 路由 registry 被检查
- **THEN** 路由 registry MUST 暴露 `POST /api/v1/sessions/{sessionId}/messages/{messageId}/fork`
- **AND** 路由 registry MUST 暴露 `POST /api/v1/sessions/{sessionId}/requests/{requestId}/fork`
- **AND** 该路由 MUST 调用 runtime session fork command
- **AND** 该路由 MUST NOT 直接创建 session、message、active context 项或 fork metadata

#### Scenario: Request fork 路由把锚点解析委托给 runtime
- **WHEN** 客户端调用 `POST /api/v1/sessions/{sessionId}/requests/{requestId}/fork`
- **THEN** Web channel MUST 只把可信 identity context、源 session id、源 request id 和规范化幂等 key 传给 runtime
- **AND** Web channel MUST NOT 加载会话历史、推断 assistant message id、读取 live stream envelope 或直接创建子会话事实

#### Scenario: Fork 路由拒绝客户端提供的权限字段
- **WHEN** fork 请求体包含 `tenantId`、`subjectId`、`agentId`、`childSessionId`、`childMessageIds`、`forkSource`、`messages`、`activeContextItems`、`timelineEvents` 或 `checkpoint`
- **THEN** Web schema 校验 MUST 拒绝该请求
- **AND** runtime fork command MUST NOT 被调用

#### Scenario: Fork 路由拒绝无效幂等 key
- **WHEN** fork 请求体省略 `idempotencyKey`、提供空字符串、纯空白字符串、trim 后超过 128 个字符的字符串或非字符串值
- **THEN** Web schema 校验 MUST 拒绝该请求
- **AND** runtime fork command MUST NOT 被调用

#### Scenario: Fork 响应使用安全的会话投影
- **WHEN** fork 路由成功
- **THEN** 响应 MUST 返回适合打开子会话的安全子会话 metadata
- **AND** 响应 MUST NOT 包含正常会话读取之外的复制消息内容
- **AND** 响应 MUST NOT 包含公共源会话 id/标题 notice 数据之外的内部 fork source record 字段（需要时）

### Requirement: Fork Notice 会话投影

默认/最新的 Web 会话 bootstrap 响应 SHALL 仅当 fork 出的子会话在 fork 边界之后没有用户消息时，为其包含可选 `forkNotice`。`forkNotice` MUST 从服务端 fork source metadata 和子会话状态推导。Web channel MUST NOT 让客户端通过查询参数或请求体字段请求、抑制、伪造或覆盖 fork notice。`forkNotice` 不是会话消息，MUST NOT 被投影为条目，MUST NOT 进入 active context，且 MUST 在基于 cursor、基于 newer-cursor 和基于 anchor message 的会话读取中被省略。

#### Scenario: 子用户消息之前的默认/最新会话响应包含 forkNotice
- **WHEN** 客户端读取某个 fork 子会话的默认/最新 `GET /api/v1/sessions/{sessionId}/conversation` 响应，该会话在 fork 边界之后没有用户消息
- **THEN** 响应 MUST 包含 `forkNotice`
- **AND** `forkNotice` MUST 包含源 session id 和源会话标题快照
- **AND** `forkNotice` MUST NOT 作为会话条目出现

#### Scenario: 子用户消息之后的默认/最新会话响应省略 forkNotice
- **WHEN** 客户端读取某个 fork 子会话的默认/最新 `GET /api/v1/sessions/{sessionId}/conversation` 响应，且用户已提交新的子消息
- **THEN** 响应 MUST NOT 包含 `forkNotice`

#### Scenario: 分页和锚定读取省略 forkNotice
- **WHEN** 客户端以 `cursor`、`newerCursor` 或 `anchorMessageId` 读取 `GET /api/v1/sessions/{sessionId}/conversation`
- **THEN** 响应 MUST NOT 包含 `forkNotice`
- **AND** 响应条目 MUST 仍只是正常会话消息投影

#### Scenario: 客户端不能伪造 notice 可见性
- **WHEN** 会话请求包含试图强制 fork notice 可见性的查询参数或等价请求体 metadata
- **THEN** Web channel MUST 按既有 schema 规则忽略或拒绝这些字段
- **AND** notice 可见性 MUST 只从服务端 fork metadata 和子会话状态计算
