## Function

- **所属 Function**：`FN-1.11 从消息派生子会话`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Copied message 携带继承 provenance 标记

fork SHALL 为每条 copied child message 的 `metadata` 写入 child-owned provenance 标记 `forkInherited: true`（JSON 布尔值），用于浏览器投影识别消息来自 copied prefix。标记 MUST 在 fork composite write 落库前写入 copied message 的 metadata，随既有 `messages.metadata` 持久化和 conversation response 的 `metadata` 通道透出；系统 MUST NOT 为该标记新增表、列、gateway contract 或 Web schema 字段。

标记是 child-owned provenance 事实，不是 source 坐标或操作资格事实：标记 MUST NOT 携带或编码 source session/message/request/run 的任何 id，与 source 的对应关系 MUST NOT 因此可解析。递归 fork 时 grandchild 的 copied messages MUST 按同一规则写入标记，与 source child 消息是否已携带标记无关。标记的含义 MUST 限于 copied message 来源，MUST NOT 表示 retry/edit 可用或不可用。标记 MUST NOT 进入模型上下文语义，也 MUST NOT 被后端 retry/edit/cancel 等 lifecycle 合法性判断读取；后端权威判断继续使用 child-owned durable facts。既有已派生会话的 copied messages MUST NOT 回填标记。

**需求类别**：功能性需求

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

#### Scenario: 标记不表达操作资格

- **WHEN** 客户端读取携带 `metadata.forkInherited: true` 的 copied message
- **THEN** 该标记 MUST 仅表示消息来自 copied prefix
- **AND** 该标记 MUST NOT 表示 retry 或 edit 可用或不可用

## Function 变更汇总

### 输出

- **变更类型**：修改
- **目标内容**：fork 继续通过 conversation metadata 输出 copied message 的 child-owned provenance；该事实不包含 source 坐标，也不表达操作资格。
- **依据 Requirements**：`Copied message 携带继承 provenance 标记`

### 处理过程

- **变更类型**：修改
- **目标内容**：递归 fork 重新写入 provenance，浏览器和后端均不得用该标记替代既有操作资格判断。
- **依据 Requirements**：`Copied message 携带继承 provenance 标记`
