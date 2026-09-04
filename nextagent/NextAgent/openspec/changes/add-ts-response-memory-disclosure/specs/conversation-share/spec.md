## ADDED Requirements

### Requirement: 会话分享不得公开长期记忆披露

conversation share 的服务端公开投影 MUST 从每条消息 metadata 中省略整段 `memoryDisclosure`，无论该消息的 terminal status 是 COMPLETED、FAILED、CANCELED 还是 SUPERSEDED。过滤 MUST 发生在 `agent-channel-web` 的 shared conversation response projection，浏览器分享页 MUST NOT 接收到该字段；系统不得只依赖前端隐藏组件。

该过滤 MUST NOT 删除或改写 canonical `SessionMessage.metadata`、terminal event 或 owner conversation 投影。分享会话只授权查看分享契约允许的问答内容，MUST NOT 被解释为授权查看用户长期记忆内容、记忆清单或本次回复装入的个人记忆。该要求不改变 assistant 正文中已经存在的文本，也不要求从正文反向推断或清除事实。

#### Scenario: owner 会话可见而分享会话不可见
- **WHEN** 一条 canonical assistant message 包含合法 `memoryDisclosure`
- **AND** owner 读取 conversation，同时另一查看者通过 conversation share 读取同一条消息
- **THEN** owner conversation MUST 按终态规则投影该 disclosure
- **AND** shared conversation response 的对应 message metadata MUST NOT 包含 `memoryDisclosure`
- **AND** canonical message MUST 保持不变

#### Scenario: 非完成消息携带披露也不得分享
- **WHEN** FAILED、CANCELED 或 SUPERSEDED assistant message 的 metadata 包含 `memoryDisclosure`
- **AND** 该消息进入 conversation share
- **THEN** shared conversation response MUST 保留分享契约允许的正文和安全 metadata
- **AND** MUST NOT 返回 `memoryDisclosure` 或据此生成记忆 footer
