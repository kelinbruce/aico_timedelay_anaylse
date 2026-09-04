## ADDED Requirements

### Requirement: Copied message 携带继承 provenance 标记

fork SHALL 为每条 copied child message 的 `metadata` 写入 child-owned provenance 标记 `forkInherited: true`（JSON 布尔值），用于浏览器投影识别继承 turn 并禁用不可用的 retry/edit 操作。标记 MUST 在 fork composite write 落库前就写入 copied message 的 metadata，随既有 `messages.metadata` 持久化和 conversation response 的 `metadata` 通道透出；系统 MUST NOT 为该标记新增表、列、gateway contract 或 Web schema 字段。

标记是 child-owned provenance 事实，不是 source 坐标：标记 MUST NOT 携带或编码 source session/message/request/run 的任何 id，与 source 的对应关系 MUST NOT 因此可解析。递归 fork 时 grandchild 的 copied messages MUST 按同一规则写入标记，与 source child 消息是否已携带标记无关。标记 MUST NOT 进入模型上下文语义，MUST NOT 被后端 retry/edit/cancel 等 lifecycle 合法性判断读取——后端权威判断仍是 lane `RequestRun` 事实；即使标记缺失或被绕过，既有 not-found 安全错误 MUST 保持为最终拒绝边界。既有已派生会话的 copied messages MUST NOT 回填标记。

#### Scenario: fork 成功写入继承标记
- **WHEN** fork 成功创建 child session
- **THEN** 每条 copied child message 的 `metadata.forkInherited` MUST 为 `true`
- **AND** 标记 MUST NOT 包含任何 source session、message、request 或 run 的 id

#### Scenario: 继承标记随 conversation 读取透出
- **WHEN** 客户端读取 child session conversation
- **THEN** copied messages 的响应项 MUST 通过既有 `metadata` 通道携带 `forkInherited: true`
- **AND** fork 后新提交的 child 自身消息 MUST NOT 携带该标记

#### Scenario: 递归 fork 重新写入标记
- **WHEN** 用户从 child session 再次 fork 生成 grandchild
- **THEN** grandchild 的全部 copied messages MUST 携带 `forkInherited: true`
- **AND** 标记 MUST NOT 编码任何祖先会话坐标

#### Scenario: 标记缺失不改变后端权威边界
- **WHEN** child session 的 copied messages 未携带标记（既有派生会话）或被客户端绕过禁用态直接调用 retry/edit
- **THEN** 后端 MUST 按既有 lane 事实返回 `REQUEST_RETRY_NOT_FOUND` 或 `EDIT_LATEST_NOT_FOUND`
- **AND** MUST NOT 以 metadata 标记的存在与否作为合法性依据
