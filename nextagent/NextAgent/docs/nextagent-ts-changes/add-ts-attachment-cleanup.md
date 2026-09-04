# add-ts-attachment-cleanup

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：附件

状态：ready
类型：实施 change
主要 owner：`agent-attachment-runtime`
依赖：`add-ts-attachment-intake`

目标：
- 提供显式 attachment cleanup port，并保留 owner scope 和 audit 接入点；首批不提供后台调度器或保留期策略。

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
- cleanup 通过 `AttachmentStoreGateway` 更新附件 metadata/status，通过通用 `BlobStoreGateway` 删除或检查内容 blob。
- cleanup 不得直接删除仍被 session message 引用的附件 metadata；可以删除 blob 并把 `availabilityStatus` 更新为 `UNAVAILABLE`，保留历史、审计和上下文诊断所需的附件事实。
- `BlobRef` 是 opaque 存储引用，cleanup 只能交给 `BlobStoreGateway` 处理，不得解析成本地路径或远端 locator。

并行边界：
- 附件内容不得绕过 attachment runtime 直接进入 message、context、model 或 capability。
- cleanup 不承担 artifact metadata cleanup、会话保留期策略、后台调度器或 admin-triggered cleanup。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
