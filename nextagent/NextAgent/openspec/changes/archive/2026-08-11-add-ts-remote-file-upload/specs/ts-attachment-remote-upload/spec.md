## ADDED Requirements

### Requirement: 附件上传 API 与存储模式无关
Web channel 附件上传 API MUST NOT 把 LOCAL 与 REMOTE 存储模式暴露为不同的客户端工作流。所有部署 MUST 使用相同的 staged-upload 生命周期：把文件字节上传到 server 拥有的临时附件位置、通过 backend API 删除未提交的临时文件、以及带 staged 附件引用提交 request。存储模式差异 MUST 被隔离在 `BlobStoreGateway` 或等价的附件存储 adapter 之内。

#### Scenario: 客户端在所有存储模式下使用同一上传流
- **WHEN** 前端允许用户附加一个文件
- **THEN** 前端 MUST 不论本地还是远程存储都调用同一个 staged upload 端点
- **AND** 前端 MUST NOT 因 HOFS 缺失而切换到 request-submit multipart
- **AND** 前端 MUST NOT 检查 `hofsBucketName` 来选择不同的上传协议

#### Scenario: 存储实现被选择在 attachment runtime 之下
- **WHEN** staged upload runtime 存储一个临时文件
- **THEN** 本地存储 MUST 写入本地系统 data blob/temp 区域
- **AND** 远程存储 MAY 写入 HOFS 或其他远程 blob backend
- **AND** Web channel request 形状 MUST 保持不变

### Requirement: 统一 staged upload 与 submit-finalize 生命周期
系统 MUST 在所有存储模式下支持统一的 staged upload 生命周期。阶段 1 把单个完整文件上传到一个临时存储对象，并返回一个对存储不透明的 staged 引用。阶段 2 带 staged 附件引用提交 request，并在调用 runtime submit 之前把每个 staged 文件 finalize 成 request/run-scoped 的正式附件记录。

#### Scenario: Stage upload 把文件存入临时存储
- **WHEN** 用户选择一个文件
- **THEN** 前端 MUST 调用 `POST /api/v1/sessions/:sessionId/files/upload`，携带 multipart 文件字节和前端生成的 `tempRunId`
- **AND** backend MUST 校验并把该文件存储为临时对象
- **AND** response MUST 包含 `tempRunId`、`fileName` 和 `sizeBytes`
- **AND** response MUST NOT 包含本地文件系统路径、HOFS 路径或原始 `storageRef`

#### Scenario: Submit finalize staged 附件引用
- **WHEN** 用户带已上传的文件发送问题
- **THEN** request body MUST 是带 `inputText`、`idempotencyKey` 和 `attachments: [{ tempRunId, fileName }]` 的 JSON
- **AND** backend MUST 把每个 staged 文件 finalize 成正式的 request/run-scoped 对象
- **AND** backend MUST 创建带 owner scope、agent scope、request/run 坐标、安全文件 metadata 和正式 `storageRef` 的 `RequestAttachmentRecord`
- **AND** runtime MUST 只接收 `attachmentIds`，不接收文件字节或 staged upload 坐标

#### Scenario: Finalize 失败使整个 request 失败
- **WHEN** 任一 staged 文件无法被 finalize
- **THEN** 整个 request MUST 失败
- **AND** backend MUST 返回安全的面向用户的错误
- **AND** backend MUST NOT 为失败的 request 创建部分附件记录

### Requirement: 上传校验跨存储模式共享
Staged upload MUST 强制执行一条从最廉价到最昂贵的共享校验流水线：全局并发限制、文件名校验、扩展名与生效 config 匹配、单文件大小限制、上传频率限制、每 session 累计配额、每用户累计配额、用户临时配额加全局 upload-temp 限制、带磁盘空间保护的流式写入本地 upload temp、文件内容安全校验，以及通过 `BlobStoreGateway` 的存储。任何检查失败 MUST 以安全错误拒绝上传。该流水线 MUST 在首次失败时短路。

#### Scenario: 首个文件超过单文件大小限制
- **WHEN** 用户上传的文件超过生效的 `chat-upload-max-file-size`
- **THEN** 上传 MUST 在写入正式附件之前被拒绝
- **AND** 错误消息 MUST 指出大小限制

#### Scenario: 无 config 的 backend 默认只接受 markdown 家族
- **WHEN** 没有配置 `chat-upload-file-type`
- **THEN** backend 扩展名校验 MUST 接受 `.md` 和 `.markdown` 上传
- **AND** backend 扩展名校验 MUST 以安全错误拒绝任何其他扩展名
- **AND** 已配置的 `chat-upload-file-type` 列表 MUST 完全替换该默认值，而不是与之合并

#### Scenario: 用户超过累计文件数限制
- **WHEN** 某用户跨所有 session 的总文件数达到系统限制 200
- **THEN** 上传 MUST 被拒绝
- **AND** 错误消息 MUST 指出已达到数量限制

#### Scenario: 用户超过累计总大小限制
- **WHEN** 某用户跨所有 session 的总文件大小达到系统限制 500 MB
- **THEN** 上传 MUST 被拒绝
- **AND** 错误消息 MUST 指出已达到大小限制

#### Scenario: 用户超过 tmp 配额
- **WHEN** 某用户未提交临时文件的总大小达到 1024 MB
- **THEN** 上传 MUST 被拒绝
- **AND** 错误消息 MUST 指出已达到临时存储配额

### Requirement: 用户级上传频率限制防止滥用
系统 MUST 跟踪每个用户未提交 staged 上传时间戳的滑动窗口。在 staged 阶段已上传但尚未 finalize 的文件计入频率限制。随 request finalize 的文件 MUST 从计数中扣除。限制为每 1 小时滑动窗口 500 次未提交上传。计数器 MUST 使用带 LRU 淘汰的内存 Map（最多 10000 个用户）。

#### Scenario: 达到频率限制
- **WHEN** 某用户过去一小时内已有 500 次未提交上传
- **THEN** 下一次上传 MUST 被拒绝
- **AND** 错误消息 MUST 指出已达到频率限制

#### Scenario: 提交问题扣除频率计数
- **WHEN** 某用户提交一个带 3 个 staged 附件的问题
- **THEN** 频率计数 MUST 减少 3
- **AND** 窗口内的后续上传 MUST 使用更新后的计数

### Requirement: 临时文件过期由存储拥有
临时附件过期 MUST 由存储实现和 attachment runtime 策略拥有，而不是由 Web channel 协议分支拥有。远程存储 MAY 依赖 HOFS TTL 规则。本地存储 MUST 把临时字节保存在 `<workspaceRoot>/data/system/upload-tmp` 或其他由 `systemDataDir` 派生的区域下，并 MUST 通过文件安全校验 spec 定义的三层机制清理本地 server 端临时文件。前端 MAY 基于生效 config 的 `upload-file-idle-expire-time` 和 `upload-file-max-expire-time` 显示计时提醒。

#### Scenario: 已过期的 staged 文件导致 finalize 失败
- **WHEN** 某用户带一个 staged 附件引用提交问题
- **AND** 该临时文件已过期或已被清理
- **THEN** finalize MUST 失败
- **AND** 错误消息 MUST 指出文件已过期，需要重新上传

### Requirement: Edit latest 遵循产品策略而非存储模式
Edit latest 能否新增附件 MUST 被定义为产品/API 规则，MUST NOT 因存储是本地还是远程而不同。若 edit 支持附件，它 MUST 使用与 submit 相同的 staged upload 引用。若 edit 仅支持文本，它 MUST 在所有存储模式下拒绝 staged 附件引用。

#### Scenario: 仅文本的 edit 一致拒绝 staged 附件
- **WHEN** edit latest 被配置为仅文本
- **AND** 一个 edit request 包含 staged 附件引用
- **THEN** 该 request MUST 在每种存储模式下都以校验错误被拒绝

### Requirement: Retry latest 复用已持久化的存储引用
Retry latest MUST 读取已持久化的 `attachmentIds` 及其 `RequestAttachmentRecord.storageRef`，不重新上传或重新 finalize 文件。在 tool 执行之前，runtime MUST 通过 `BlobStoreGateway` 把这些 ref 物化到一个新的 run-scoped 临时目录。

#### Scenario: Retry 复用既有正式附件记录
- **WHEN** 某用户重试最新 request
- **THEN** 系统 MUST NOT 执行临时上传或临时到正式的 finalize
- **AND** runtime MUST 只把已持久化的 `storageRef` 值作为 gateway 输入复用
- **AND** tool 执行 MUST 接收新物化的路径，绝不接收原始存储 ref

### Requirement: 删除临时文件需要 backend API 调用
当用户在提交问题之前从输入区 chip 列表中移除一个文件时，前端 MUST 调用一个 backend 端点来删除该 staged 临时文件。backend MUST 通过存储 gateway 删除该临时文件，并更新内存计数器（tmp 配额和频率计数）。

#### Scenario: 用户删除一个已上传的临时文件
- **WHEN** 用户点击某个文件 chip 上的移除按钮
- **THEN** 前端 MUST 调用 `DELETE /api/v1/sessions/:sessionId/files/tmp/{tempRunId}/{fileName}` 或等价的、对存储不透明的临时文件删除端点
- **AND** backend MUST 删除该 staged 临时文件
- **AND** backend MUST 递减 `tmpTotalSize` 并从频率窗口移除一个时间戳

#### Scenario: 删除已过期的临时文件是幂等的
- **WHEN** backend 被要求删除一个已被存储 TTL 或本地清理删除的临时文件
- **THEN** backend MUST 仍更新内存计数器
- **AND** backend MUST 返回成功

### Requirement: 单个 tempRunId 可跨上传调用关联多个文件
前端 MUST 为每个会话输入期生成一个 `tempRunId`。同一输入期内的多次 staged upload 调用 MUST 使用同一个 `tempRunId`。临时存储 namespace MUST 支持同一 `tempRunId` 下的多个文件。

#### Scenario: 多个文件在同一 tempRunId 下上传
- **WHEN** 某用户在分开的 staged upload 调用中使用同一 `tempRunId` 上传文件 A 和文件 B
- **THEN** 两个文件 MUST 被存储在同一个临时上传 namespace 下
- **AND** 提交 MUST 在 `attachments` 中包含两个文件
- **AND** 两个文件 MUST 被 finalize 成正式附件记录

### Requirement: 前端文件选择器接受生效 config 的文件类型
前端 MUST 基于 bootstrap API 返回的 `chatUploadFileConfig.chatUploadFileType` 设置 `<input type="file" accept="...">` 属性。前端 MUST 还在选择后执行 JavaScript 级校验，且该校验 MUST 由同一 bootstrap config 驱动：接受的扩展名列表来自 `chatUploadFileType`，大小限制来自 `chatUploadMaxFileSize`，数量限制来自 `chatUploadMaxFileNumber`。没有 bootstrap config 时，校验 MUST 回退到仅 markdown 默认值。拒绝消息 MUST 展示生效的类型列表和大小限制，而不是硬编码默认值。该行为 MUST NOT 按本地与远程存储分支。

#### Scenario: 文件选择器接受已配置的类型
- **WHEN** bootstrap config 返回 `chatUploadFileType: ["*.xlsx", "*.csv"]`
- **THEN** 文件 input MUST 具有 `accept=".xlsx,.csv"`
- **AND** 文件对话框 MUST 过滤为这些类型

#### Scenario: 选择后校验遵循已配置的类型列表
- **WHEN** bootstrap config 返回 `chatUploadFileType: ["*.pcap"]` 且用户选择了 `capture.pcap`
- **THEN** 该选择 MUST 通过客户端校验
- **AND** 当用户在同一 config 下选择 `notes.md` 时，拒绝消息 MUST 把 `.pcap` 列为受支持的类型

#### Scenario: 无 config 时选择后校验回退到默认值
- **WHEN** 没有 bootstrap `chatUploadFileConfig`
- **THEN** 客户端校验 MUST 只接受 markdown 默认值（`.md`、`.markdown`），并使用默认大小和数量限制

### Requirement: Finalize 失败不要求回滚已复制的字节
当 finalize staged 文件在部分字节已复制到正式存储后失败时，系统 MUST NOT 为失败的 request 创建附件记录。已复制的孤儿文件 MAY 留给存储 TTL 或清理处理，除非存储实现能够在不改变 request 结果的前提下安全地尽力删除它们。

#### Scenario: Finalize 失败使孤儿字节不可见
- **WHEN** 某次提交成功 finalize 了 2 个文件但第 3 个失败
- **THEN** 系统 MUST NOT 为该 request 创建任何附件记录
- **AND** 该 request MUST 以安全错误失败
- **AND** 已复制的孤儿字节 MUST 保持无引用，且对正常读取不可见

### Requirement: 每 session 与每用户双层文件数限制
系统 MUST 强制执行两层文件数限制。config `chat-upload-max-file-number`（默认 10，封顶 200）MUST 按 session 强制执行。系统硬限制 200 个文件和 500 MB 总大小 MUST 按用户跨所有 session 强制执行。两个限制 MUST 在每次 staged upload 时都检查。任一限制被超出 MUST 拒绝上传。

#### Scenario: 每 session config 限制拒绝上传
- **WHEN** 某用户在单个 session 内已上传 10 个文件且 config 限制为 10
- **THEN** 第 11 次上传 MUST 被拒绝
- **AND** 错误消息 MUST 指出每 session 文件数限制

#### Scenario: 每用户系统限制跨 session 拒绝上传
- **WHEN** 某用户跨多个 session 已上传 200 个文件
- **THEN** 下一次上传 MUST 被拒绝
- **AND** 错误消息 MUST 指出用户级文件数限制

### Requirement: BlobStoreGateway 支持临时和正式文件删除
BlobStoreGateway port MUST 支持删除临时文件和正式文件。临时文件删除 MUST 是幂等的。正式文件删除也 MUST 是幂等的。临时文件删除用于用户移除未提交文件时。正式文件删除用于附件被清理时的 cleanup runtime。

#### Scenario: 删除临时文件调用 BlobStoreGateway
- **WHEN** 某用户删除一个未提交的临时文件
- **THEN** backend MUST 调用 `BlobStoreGateway.deleteBlob`
- **AND** 该删除 MUST 是幂等的

#### Scenario: Cleanup 通过 BlobStoreGateway 删除正式文件
- **WHEN** cleanup runtime 删除一个附件
- **THEN** cleanup runtime MUST 调用 `blobStore.deleteBlob`

### Requirement: Cleanup runtime 使用 BlobStoreGateway
cleanup runtime MUST 在所有存储模式下使用 `blobStore.deleteBlob` 删除附件。cleanup runtime MUST NOT 为删除而按 `deploymentMode` 分支。cleanup runtime MUST 以依赖注入方式接收 `blobStore`。

#### Scenario: Cleanup 使用 blob store
- **WHEN** cleanup runtime 删除一个附件
- **THEN** 它 MUST 调用 `blobStore.deleteBlob`
- **AND** 它 MUST NOT 检查本地还是远程存储模式

### Requirement: 删除临时文件扣除频率计数
当用户删除一个未提交的临时文件时，backend MUST 在递减 `tmpTotalSize` 之外，还从该用户的频率滑动窗口移除一个时间戳。这确保被删除的上传不计入每小时 500 次的频率限制。

#### Scenario: 删除临时文件递减频率计数
- **WHEN** 某用户频率窗口内有 400 次上传并删除一个未提交的临时文件
- **THEN** 频率计数 MUST 减少到 399
- **AND** `tmpTotalSize` MUST 按被删除文件的大小递减
- **AND** 后续上传 MUST 看到更新后的频率计数 399
