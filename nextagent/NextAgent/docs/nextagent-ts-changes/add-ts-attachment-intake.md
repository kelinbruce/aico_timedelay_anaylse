# add-ts-attachment-intake

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：附件

状态：active
类型：实施 change
主要 owner：`agent-attachment-runtime`
依赖：`establish-ts-core-contracts`

目标：
- 按共同附件范围和限制接入 attachment runtime；首版本地 release 仅启用 Markdown，未启用类型返回明确 safe error。

能力组共享输入：

整理状态：已整理为能力组级输入

能力组目标：
- 补实附件上传、可信校验、受控引用和上下文消费。

共享规格输入：
- 目标附件范围为 Markdown、PDF、Excel 和 Word 文档。
- 每请求最多 3 个附件，单文件最大 5 MiB。
- TS 首版本地 release 仅启用 Markdown。
- PDF、Excel、Word、其他类型、超大小、超数量、文件不可读或损坏、空文件、密码保护或需要外部解析的文件，都返回明确 safe error。
- PDF、Excel、Word 的解析与上下文消费由后续附件解析 change 补齐。
- 请求 command 和 `SessionMessage` 只保存 `attachmentIds: AttachmentId[]`，不保存附件名称、类型、大小、状态或存储引用副本。
- `RequestAttachment` 是附件 metadata 权威事实，包含文件名、类型、大小、`storageRef: BlobRef`、validation status、availability status 和 request/session/run 绑定。
- 附件内容写入通用 `BlobStoreGateway`，附件 metadata/status 写入 `AttachmentStoreGateway`；不得引入 attachment-only blob store。
- LOCAL deployment 下，`BlobStoreGateway` 的物理 blob root 作为 gateway-private 派生路径固定落在 `workspaceRoot` 下的数据子目录；不得使用 execution root、客户端输入或模型输出决定附件物理路径。
- `BlobRef` 是 opaque 内容存储引用，不得进入模型上下文、用户可见 stream、SafeError、audit 明细或结构化日志。

并行边界：
- 附件内容不得绕过 attachment runtime 直接进入 message、context、model 或 capability。
- 入口层不得信任客户端提交的附件名称、类型、大小或状态；runtime/attachment runtime 必须通过 `AttachmentStoreGateway` 查询权威 `RequestAttachment`。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
