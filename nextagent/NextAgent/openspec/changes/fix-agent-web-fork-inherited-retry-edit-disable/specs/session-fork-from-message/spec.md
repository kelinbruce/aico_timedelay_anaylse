## Function

- **所属 Function**：`FN-1.11 从消息派生子会话`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Copied message 携带继承 provenance 标记

fork SHALL 为每条 copied child message 的 `metadata` 写入 child-owned provenance 标记 `forkInherited: true`（JSON 布尔值），用于浏览器投影识别消息来自 copied prefix。标记 MUST 在 fork composite write 落库前写入 copied message 的 metadata，随既有 `messages.metadata` 持久化和 conversation response 的 `metadata` 通道透出；系统 MUST NOT 为该标记新增表、列、gateway contract 或 Web schema 字段。

标记是 child-owned provenance 事实，不是 source 坐标事实：标记 MUST NOT 携带或编码 source session/message/request/run 的任何 id，与 source 的对应关系 MUST NOT 因此可解析。递归 fork 时 grandchild 的 copied messages MUST 按同一规则写入标记，与 source child 消息是否已携带标记无关。标记 MUST NOT 进入模型上下文语义，也 MUST NOT 被后端 retry/edit/cancel 等 lifecycle 合法性判断读取；后端权威判断继续使用 child-owned durable facts。既有已派生会话的 copied messages MUST NOT 回填标记。

标记在 Agent Web 层 MUST 承担前端操作禁用语义：当最新轮次的 copied message 携带 `forkInherited: true` 时，Agent Web MUST 禁用该轮次的 retry 和 edit 入口。该禁用是客户端保护层，不替代后端权威资格校验。

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

#### Scenario: 继承标记禁用前端 retry/edit

- **WHEN** 客户端读取携带 `metadata.forkInherited: true` 的 copied message
- **AND** 该消息所属轮次是当前最新轮次
- **THEN** Agent Web MUST 禁用该轮次的 retry 和 edit 入口
- **AND** MUST 展示说明性 tooltip 说明继承轮次不可重试或编辑

#### Scenario: 标记不表达操作资格

- **WHEN** 客户端读取携带 `metadata.forkInherited: true` 的 copied message
- **THEN** 该标记 MUST 表示消息来自 copied prefix，并作为 Agent Web 前端禁用 retry/edit 的输入
- **AND** 该标记 MUST NOT 表示后端 retry 或 edit 的权威操作资格

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：`forkInherited` 标记保留 provenance 语义，并重新承担 Agent Web 层的 retry/edit 禁用职责。
- **依据 Requirements**：`Copied message 携带继承 provenance 标记`

### 结果

- **变更类型**：修改
- **目标内容**：继承标记同时标识 copied message 来源和前端操作禁用。
- **依据 Requirements**：`Copied message 携带继承 provenance 标记`
