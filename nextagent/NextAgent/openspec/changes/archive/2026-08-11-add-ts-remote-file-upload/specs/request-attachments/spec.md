## MODIFIED Requirements

### Requirement: Context Engine 在所有模式下跳过附件内容读取
context engine MUST NOT 在任何存储模式下为附件内容调用 `blobStore.loadBlob`。`attachmentContentBlocks` MUST 为空。它 MUST 只渲染安全的文件 metadata 披露；模型和模型可见 tool 都不得接收作为路径的 `storageRef`。

#### Scenario: Remote 模式跳过 blob 内容读取
- **WHEN** deployment mode 是 REMOTE
- **AND** 当前 request 已接受附件
- **THEN** context engine MUST NOT 调用 `blobStore.loadBlob`
- **AND** `attachmentContentBlocks` MUST 为空
- **AND** attachment evidence MUST 仍从 `attachmentStore` 收集

#### Scenario: Local 模式同样跳过 blob 内容读取
- **WHEN** deployment mode 是 LOCAL
- **AND** 当前 request 已接受附件
- **THEN** context engine MUST NOT 通过 `blobStore` 读取附件内容
- **AND** `attachmentContentBlocks` MUST 为空
- **AND** 模型可见 prompt 文本 MUST NOT 包含存储坐标或执行附件路径

### Requirement: AttachmentContextEvidence 暴露安全文件 metadata
`AttachmentContextEvidence` MUST 包含 `fileName`、`mediaType` 和 `sizeBytes` 字段。这些字段 MUST 对模型可见披露是安全的。它们 MUST NOT 包含 `storageRef`、`BlobRef`、HOFS 路径或任何原始存储坐标。

#### Scenario: remote 模式下模型可见附件披露包含文件 metadata
- **WHEN** deployment mode 是 REMOTE
- **AND** 当前 request 已接受附件
- **THEN** 渲染出的附件披露 MUST 为每个附件包含文件名、media type 和大小
- **AND** 该披露 MUST NOT 包含 HOFS 路径或存储引用

### Requirement: Runtime 为 tool 执行物化附件
在 tool loop 启动之前，runtime MUST 解析当前 request 已持久化的附件记录，并把每个正式 blob 物化到一个 run-scoped 的受信执行临时目录。物化 MUST 使用流式的 `BlobStoreGateway.materializeBlob` 操作，MUST NOT 通过 `loadBlob(): Uint8Array` 加载完整附件。得到的执行路径（而不是 `storageRef`）MUST 对 tool 执行同步可用。它们 MUST NOT 出现在 model input、tool call 参数、stream payload 或 safe error 中。

#### Scenario: Skill tool 读取物化后的附件路径
- **WHEN** runtime 为一个带已接受附件的 request 启动 tool loop
- **THEN** 每个附件 MUST 被物化到执行 resolver 的 run-scoped `temp/attachments` 目录之下
- **AND** `ToolExecutionContext.attachmentPaths` MUST 只包含物化后的可读路径
- **AND** skill tool MUST 能够同步读取这些路径
- **AND** `storageRef` 和物化后的路径都不得对模型可见

#### Scenario: attachmentRefs 不对模型可见
- **WHEN** context engine 渲染 model input
- **THEN** `attachmentRefs` MUST NOT 出现在 system prompt、user message 或任何模型可见 section
- **AND** `storageRef` 值 MUST NOT 出现在 stream 事件或 safe error 中

### Requirement: 会话历史和分享端点包含附件 metadata
完整会话历史端点（`GET /api/v1/sessions/:sessionId/conversation`）和分享会话端点（`GET /api/v1/shares/:shareId/conversation`）MUST 在每个带附件的用户 request 消息中包含附件安全摘要（`fileName`、`mediaType`、`sizeBytes`）。该摘要 MUST NOT 包含 `storageRef` 或任何存储坐标。会话预览端点（`GET /api/v1/sessions/:sessionId/conversation/preview`）MUST NOT 包含附件 metadata。

#### Scenario: 完整会话历史返回附件列表
- **WHEN** 用户打开一个历史会话
- **THEN** conversation API response MUST 为每个带附件的消息包含附件 metadata
- **AND** 该 metadata MUST 包含 `fileName`、`mediaType` 和 `sizeBytes`
- **AND** 该 metadata MUST NOT 包含 `storageRef`

#### Scenario: 分享会话返回附件列表
- **WHEN** 用户打开一个被分享的会话
- **THEN** 分享会话 API response MUST 包含附件 metadata
- **AND** 该 metadata MUST NOT 包含 `storageRef`

#### Scenario: 会话预览不返回附件 metadata
- **WHEN** 会话预览端点被调用
- **THEN** response MUST NOT 包含附件 metadata
- **AND** response MUST 只包含轻量 preview 字段

### Requirement: 物化路径传递给产品 Skill API
runtime MUST 把 run-scoped 的物化附件路径数组注入 `ToolExecutionContext.attachmentPaths`，并把同一 JSON 数组注入 sandbox `FILE_PATHS`。该数组 MUST 在 local 和 remote 存储下同样使用。没有附件时，两个字段都不得存在。产品 Skill API MUST 同步读取这些由系统组装的路径，不解析模型 tool call 参数。

#### Scenario: 多个文件以物化路径传递
- **WHEN** 某个 request 有 2 个已接受附件
- **THEN** `ToolExecutionContext.attachmentPaths` MUST 包含 run-scoped 临时附件目录下的两个不同路径
- **AND** sandbox 环境 `FILE_PATHS` MUST 把相同路径编码为 JSON 数组

#### Scenario: 单个文件作为单元素 attachmentPaths 数组传递
- **WHEN** 某个 request 有 1 个附件
- **THEN** `ToolExecutionContext.attachmentPaths` MUST 包含一个物化路径
- **AND** 该值 MUST 是数组而不是字符串

#### Scenario: 无附件时省略 attachmentPaths 和 FILE_PATHS
- **WHEN** 某个 request 没有附件
- **THEN** `ToolExecutionContext.attachmentPaths` MUST NOT 存在
- **AND** sandbox `FILE_PATHS` 环境变量 MUST NOT 被设置

#### Scenario: attachmentPaths 由系统组装，不来自模型参数
- **WHEN** 模型调用一个 Skill tool
- **THEN** 这些路径 MUST 由 runtime 在 gateway 物化之后组装
- **AND** 模型的 tool call 参数 MUST NOT 包含附件路径
