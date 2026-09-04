## MODIFIED Requirements

### Requirement: 安全约束

`TOOL_STRUCTURED_DELTA` 内容 MUST NOT 包含 credential、token、raw provider error 或 prompt 文本。`toolMessageType` 校验 MUST 在发出前拒绝未知类型。ACTION 和 OPERATOR 类型的 `content` 字段 MUST 是一个 JSON 字符串，其 `data` 字段是客户端可安全 `JSON.parse` 的对象字符串。

仅对 `FILE` `toolMessageType`，`content` 字段 MAY 携带完整的 HOFS object name（一个作为下载定位 handle 使用的远程对象存储引用，例如 `aicoservice/answer/{sessionId}/{chatId}/result.xlsx`）。这是对 `TOOL_STRUCTURED_DELTA` 内容中文件路径一般性禁令的受控例外：HOFS object name 不是本地文件系统路径，也不是执行路径；它是一个仅由下载端点消费以定位文件进行代理下载的不透明远程对象引用。对所有其他 `toolMessageType` 值（PIU、DSL、ACTION、OPERATOR、TEXT），`content` MUST NOT 包含任何形式的文件路径，包括 HOFS object name。Credential、token、raw provider error 和 prompt 文本禁令适用于包括 FILE 在内的所有 `toolMessageType` 值。

#### Scenario: 带 HOFS object name 的 FILE content 被接受

- **WHEN** 一个 CLIP structured event 具有 `toolMessageType: "FILE"` 且 `content` 是一个完整的 HOFS object name 字符串（例如 `aicoservice/answer/sess1/run1/result.xlsx`）
- **THEN** tool-loop MUST 发出 FILE 消息类型的 `TOOL_STRUCTURED_DELTA`，并在 `content` 中保留该 object name
- **AND** 该事件 MUST 可供前端下载卡片渲染使用

#### Scenario: 带文件路径的非 FILE content 被拒绝

- **WHEN** 一个 CLIP structured event 的 `toolMessageType` 不是 `FILE`（例如 `TEXT`）且 `content` 包含文件路径或 HOFS object name
- **THEN** tool-loop MUST NOT 为该事件发出 `TOOL_STRUCTURED_DELTA`
- **AND** 结果 MUST 回退为带完整 payload 的 `CAPABILITY_RESULT_DELTA`（模型仍能看到它）

#### Scenario: 带 credential 的 FILE content 被拒绝

- **WHEN** 一个 CLIP structured event 具有 `toolMessageType: "FILE"` 且 `content` 包含 `api_key`、`authorization`、`credential`、`password`、`secret` 或 `token` 模式
- **THEN** tool-loop MUST NOT 为该事件发出 `TOOL_STRUCTURED_DELTA`
- **AND** 结果 MUST 回退为带完整 payload 的 `CAPABILITY_RESULT_DELTA`

#### Scenario: 带 credential 的 content 被拒绝

- **WHEN** 一个 CLIP structured event 的 content 包含 `api_key`、`authorization`、`credential`、`password`、`secret` 或 `token` 模式
- **THEN** tool-loop MUST NOT 为该事件发出 `TOOL_STRUCTURED_DELTA`
- **AND** 结果 MUST 回退为带完整 payload 的 `CAPABILITY_RESULT_DELTA`（模型仍能看到它）
