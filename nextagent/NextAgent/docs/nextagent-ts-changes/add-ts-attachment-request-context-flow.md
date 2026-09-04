# add-ts-attachment-request-context-flow

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：附件

状态：active
类型：实施 change
主要 owner：`agent-runtime`、`agent-context-engine`、`agent-attachment-runtime`
依赖：`add-ts-attachment-intake`

目标：
- Runtime 接受请求前校验 attachmentIds 并查询权威 RequestAttachment，Context Engine 只消费安全 descriptor、summary 或受控内容引用；首版本地 release 附件上下文消费限定为 Markdown。

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
- runtime command 和 `SessionMessage` 只保存 `attachmentIds: AttachmentId[]`。
- Runtime 接受请求前必须按 `tenantId`、`subjectId` 和 `attachmentIds` 查询权威 `RequestAttachment`，校验 owner/request 可见范围、`validationStatus=ACCEPTED` 和 `availabilityStatus=AVAILABLE`。
- Context Engine 生成附件 descriptor 或加载 Markdown 附件内容时，必须通过 `AttachmentId` 查询权威 `RequestAttachment`。
- Context Engine 不得信任 command、message metadata、模型输出或 capability 参数中的附件名称、类型、大小、状态或存储引用。

并行边界：
- 附件内容不得绕过 attachment runtime 直接进入 message、context、model 或 capability。
- `BlobRef` 不得进入模型上下文；模型可见内容只能是安全 descriptor、受控 Markdown 内容或受控大内容引用。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
