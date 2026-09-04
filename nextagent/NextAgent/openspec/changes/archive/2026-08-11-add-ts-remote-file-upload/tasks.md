## 1. 契约变更与配置基础

- [x] 1.1 保持 `RequestAttachmentRecord.mediaType` 与 `RequestAttachment.mediaType` 使用 `AttachmentMediaType`；上传 runtime 必须将受支持扩展显式映射为该共享词汇。
  验证：`npm run build`；attachment intake 与 staged upload tests 覆盖 `MARKDOWN` / `EXCEL` 映射。
  来源：design D1；spec `ts-attachment-intake` Requirement `Attachment mediaType uses shared vocabulary`

- [x] 1.2 新增文件上传配置加载模块：从 `agents/{agentId}/config/config.json` 读取 `chat-upload-file-config`，使用 `AgentPackageSourceLocator` 定位 agent package root。实现 Cap + Warn 校验策略。
  验证：单元测试覆盖字段缺失/类型错误/超上限/空 hofs-bucket-name 等场景；`npm run build`
  来源：design D2；spec `ts-attachment-config` Requirement `File upload config is loaded from agent config directory` + `Config validation uses Cap and Warn strategy`

- [x] 1.3 扩展 `/api/v1/runtime/bootstrap` 响应，新增 `chatUploadFileConfig` 字段（effective config）。
  验证：bootstrap API 测试覆盖有/无 HOFS 配置两种场景；`npm run build`
  来源：design D3；spec `ts-runtime-bootstrap-config` Requirement `Bootstrap API exposes file upload configuration`

- [x] 1.4 扩展 `AttachmentContextEvidence` 新增 `fileName`、`mediaType`、`sizeBytes` safe metadata 字段。不含 `storageRef`。
  验证：`npm run build`；`rg "storageRef" packages/agent-contracts/src/context/` 确认 AttachmentContextEvidence 不含 storageRef
  来源：design D8；spec `request-attachments` Requirement `AttachmentContextEvidence exposes safe file metadata`

- [x] 1.5 扩展 `ToolExecutionContext` 新增可选 `attachmentRefs` 字段，含 `attachmentId`、`fileName`、`mediaType`、`sizeBytes`、`storageRef`。
  验证：`npm run build`；`npm test -- packages/agent-capability/tests/`
  来源：design D9；spec `request-attachments` Requirement `ToolExecutionContext carries pre-resolved attachment refs`

- [x] 1.6 扩展 `WebRuntimeBootstrapConfig` 新增可选 `chatUploadFileConfig` 字段。
  验证：`npm run build`
  来源：design D3

## 2. 文件内容安全校验独立模块

- [x] 2.1 新增 `file-content-validator` 独立模块（位于 `agent-attachment-runtime`），实现 magic bytes 与扩展名交叉验证。
  验证：单元测试覆盖 xlsx/csv/pdf/md 正路径 + 类型不匹配负路径；`npm run build`
  来源：design D6a；spec `ts-file-security-validation` Requirement `Magic bytes cross-validation prevents type spoofing`

- [x] 2.2 在同模块中实现 zip 炸弹防护：读 ZIP Central Directory，累加 `uncompressedSize`，总解压大小 > 512MB 则拒绝。只读 header 不解压内容。
  验证：单元测试覆盖正常 xlsx 通过、构造的 zip 炸弹被拒绝、非 ZIP 文件跳过检查；`npm run build`
  来源：design D6b；spec `ts-file-security-validation` Requirement `Zip bomb protection limits total uncompressed size`

- [x] 2.3 增加文件名正则校验：`^(?=.{1,512}$)[a-zA-Z0-9&\u3010\u3011\uff08\uff09()\s_\-\.\u4e00-\u9fa5+\[\]]+\.\w+$`。
  验证：单元测试覆盖合法/非法文件名（路径注入、超长、无扩展名等）；`npm run build`
  来源：design D6；spec `ts-file-security-validation` Requirement `File name validation enforces strict character and length rules`

## 3. 用户级计数器与安全防护

- [x] 3.1 新增用户级上传计数器（内存 Map，LRU 淘汰上限 10000 用户）：跟踪 `totalFileCount`、`totalFileSize`、`tmpTotalSize`、`uploadTimestamps` 滑动窗口。
  验证：单元测试覆盖累加/扣减/LRU 淘汰/滑动窗口过期；`npm run build`
  来源：design D7；spec `ts-attachment-remote-upload` Requirement `User-level upload frequency limit prevents abuse`

- [x] 3.2 实现阶段 1 上传校验管道（多层，从便宜到昂贵，短路退出）：全局并发 → 文件名正则 → 扩展名匹配 → 单文件大小 → 上传频率 → per-session 累计 → per-user 累计 → tmp 配额 → 流式写本地临时 → 内容安全校验（magic bytes + zip slip + zip 炸弹）→ storeBlob 上传 → 删本地临时。
  验证：单元测试覆盖每一层独立失败场景 + 第一个文件就超限场景；`npm run build`
  来源：design D4, D6, D7；spec `ts-attachment-remote-upload` Requirement `Phase 1 upload enforces layered security validation`

## 4. 远端两阶段上传 API

- [x] 4.1 新增阶段 1 上传 endpoint `POST /api/v1/sessions/:sessionId/files/upload`（multipart，单文件）。返回 `{ tempRunId, fileName, sizeBytes }`，不返回 HOFS 路径。
  验证：API 测试覆盖正常上传 + 各校验层拒绝；`npm run build`
  来源：design D4；spec `ts-attachment-remote-upload` Requirement `Remote mode uses two-phase file upload` Scenario `Phase 1 uploads file to HOFS temp`

- [x] 4.2 扩展 submit request body 支持 `tempFiles: [{ tempRunId, fileName }]`（JSON，非 multipart）。后端执行 HOFS move temp → formal，创建 `RequestAttachmentRecord`。
  验证：API 测试覆盖正常提交 + move 失败 fail-closed；`npm run build`
  来源：design D4；spec `ts-attachment-remote-upload` Requirement `Remote mode uses two-phase file upload` Scenario `Phase 2 submits question with temp file references`

- [x] 4.3 实现 move 失败处理：任何文件 move 失败则整个请求失败，已 move 文件回滚，返回友好错误。
  验证：测试覆盖文件不存在/tmp 容量上限/formal 容量不够/HOFS 异常等 move 失败场景
  来源：design D4；spec `ts-attachment-remote-upload` Requirement `Phase 2 move failure fails the entire request`

- [x] 4.4 扩展 `BlobStoreGateway` contract（新增 `copyBlob`/`getBlobMetadata`/`listBlobs`，`storeBlob` 改为接收 `localFilePath`），位于 `agent-contracts/gateway`。Composition 按 deploymentMode 注入 local 或 remote 实现。Remote 实现在隔离环境开发，打包时放入 `packages/`。
  验证：接口定义存在；`npm run build`；architecture test 确认 agent-attachment-runtime 不直接依赖具体 HOFS 实现
  来源：design D5

## 5. Context Engine 适配

- [x] 5.1 `DefaultContextEngineDependencies` 新增 `deploymentMode` 字段。composition 注入 `systemConfig.gateway.deploymentMode`。
  验证：`npm run build`；`npm test -- packages/agent-context-engine/tests/`
  来源：design D8；spec `request-attachments` Requirement `Context Engine skips attachment content reading in all modes`

- [x] 5.2 两种模式下 `readAttachmentContentBlock()` 直接返回 null，`attachmentContentBlocks = []`。
  验证：测试覆盖 remote 模式不调 blobStore + local 模式也不调 blobStore；`npm run build`
  来源：design D8；spec `request-attachments` Scenario `Remote mode skips blob content reading` + `Local mode also skips blob content reading`

- [x] 5.3 两种模式下 `renderAttachmentDisclosure` 展示文件元数据列表（fileName, mediaType, sizeBytes）。
  验证：测试覆盖两种模式渲染文件列表 + 不含文件路径；`npm run build`
  来源：design D8, D10；spec `request-attachments` Scenario `Model-visible attachment disclosure includes file metadata in remote mode`

## 6. Skill 执行上下文注入

- [x] 6.1 Runtime 在 tool loop 前预解析当前 request 的全部 attachments，组装 `attachmentRefs` 注入 `ToolExecutionContext`。
  验证：测试覆盖 attachmentRefs 注入 + 同步可读 + 不含 model 可见路径；`npm run build`
  来源：design D9；spec `request-attachments` Scenario `Skill tool reads file paths from context`

- [x] 6.2 验证 `attachmentRefs` 不出现在 model input、tool call args、stream payload、safe error 中。
  验证：architecture/source test 断言 `attachmentRefs` 和 `storageRef` 不进入 model-visible 路径
  来源：design D9；spec `request-attachments` Scenario `attachmentRefs are not model-visible`

## 7. Conversation API 与前端展示

- [x] 7.1 Conversation API 返回的 message 中新增 attachment safe summary（fileName, mediaType, sizeBytes，不含 storageRef）。
  验证：API 测试覆盖 conversation 返回 attachment 列表；`npm run build`
  来源：design D11

- [x] 7.2 前端输入框文件展示改为 chip 列表（参考 `SelectedSkillChip`），文件多时横向可滚动。
  验证：前端组件测试或手动验证
  来源：design D10

- [x] 7.3 前端对话面板问题上方展示文件列表（只读）。
  验证：前端组件测试或手动验证
  来源：design D10

- [x] 7.4 前端根据 bootstrap config 切换上传行为：HOFS 非空走两阶段，为空走同步 multipart。
  验证：前端测试覆盖两种模式切换
  来源：design D10；spec `ts-runtime-bootstrap-config` Requirement `Bootstrap config drives frontend upload behavior`

- [x] 7.5 前端上传计时提醒（idle-expire / max-expire）。
  验证：前端组件测试或手动验证
  来源：design D10

- [x] 7.6 前端文件名校验（正则），不合规即时提示。
  验证：前端组件测试
  来源：design D6；spec `ts-file-security-validation` Requirement `File name validation enforces strict character and length rules`

## 8. 集成测试与验证

- [x] 8.1 统一 staged upload 端到端测试：选文件上传 → JSON refs 提交 → attachment record → materialize → tool/sandbox 文件路径 → terminal cleanup。存储 gateway 不改变 API 协议。
  验证：route integration、local product E2E、sandbox contract tests 通过
  来源：design 数据流

- [x] 8.2 Local 模式回归测试：确保 local 行为完全不变。
  验证：既有 attachment 测试全部通过
  来源：design 非目标

- [x] 8.3 安全防护边界测试：覆盖所有 25 个测试用例（文件名/大小/频率/配额/zip 炸弹/magic bytes 等）。
  验证：专项测试通过
  来源：design 安全防护体系

- [x] 8.4 `openspec validate add-ts-remote-file-upload --strict` 通过。
  验证：命令执行成功
  来源：AGENTS.md 验证门禁

- [x] 8.5 `npm run build` + `npm test` + `npm run test:contract` + `npm run lint:architecture` 全部通过。
  验证：全部命令执行成功
  来源：AGENTS.md 验证门禁

## 9. 补充任务（Supplementary Tasks）

- [x] 9.1 Remote 模式下 edit latest 只接受 JSON body（文字修改），拒绝 `tempFiles`，保留原 `attachmentIds`。
  验证：API 测试覆盖 remote edit latest 拒绝 tempFiles + 保留原 attachments；`npm run build`
  来源：design D12；spec `ts-attachment-remote-upload` Requirement `Edit latest in remote mode only allows text modification`

- [x] 9.2 测试 retry latest 在 remote 模式下复用持久化 `storageRef`，不需要重新上传或 move 文件。
  验证：retry 测试覆盖 remote 模式 attachmentRefs 从持久化 record 自然填充
  来源：design D13；spec `ts-attachment-remote-upload` Requirement `Retry latest in remote mode reuses persisted storage references`

- [x] 9.3 Conversation 完整历史和分享 endpoint 返回 attachment safe summary（fileName, mediaType, sizeBytes）。Preview endpoint 不返回。
  验证：API 测试覆盖 conversation + share 返回 attachment 列表 + preview 不返回；`npm run build`
  来源：design D14；spec `request-attachments` Requirement `Conversation history and share endpoints include attachment metadata`

- [x] 9.4 新增 `DELETE /api/v1/sessions/:sessionId/files/tmp/{tempRunId}/{fileName}` endpoint，删除 HOFS temp 文件并更新内存计数器。幂等删除。
  验证：API 测试覆盖正常删除 + 删除已过期文件（幂等）；`npm run build`
  来源：design D15；spec `ts-attachment-remote-upload` Requirement `Deleting a temp file requires a backend API call`

- [x] 9.5 实现频率计数扣减机制：阶段 2 提交 N 个文件时移除 N 个最旧时间戳；删除 temp 文件时移除 1 个最旧时间戳。
  验证：单元测试覆盖扣减 + 滑动窗口过期；`npm run build`
  来源：design D16

- [x] 9.6 前端文件选择器 `accept` 属性由 config 驱动，local 模式硬编码 `.md,.markdown`。
  验证：前端测试覆盖 config 驱动 + local 硬编码
  来源：design D17；spec `ts-attachment-remote-upload` Requirement `Frontend file selector accepts config-driven file types`

- [x] 9.7 确认同一个 `tempRunId` 可跨多次 phase 1 调用上传多个文件，阶段 2 一起 move。
  验证：e2e 测试覆盖同一 tempRunId 多文件上传 + 提交
  来源：design D18；spec `ts-attachment-remote-upload` Requirement `A single tempRunId can associate multiple files across phase 1 calls`

## 10. 补充任务：契约同步与清理适配

- [x] 10.1 前端 `AttachmentRef.mediaType` 保持 `AttachmentMediaType`，与后端 attachment record 使用同一共享词汇。
  验证：前端 build 通过；`AttachmentRef.mediaType` 为 `AttachmentMediaType`
  来源：design D19；spec `ts-attachment-intake` Requirement `Frontend AttachmentRef mediaType uses shared vocabulary`

- [x] 10.2 实现 config glob pattern 匹配：从 `*.ext` 提取扩展名做后缀匹配（大小写不敏感）。不支持复杂 glob 语法，不支持的 pattern 静默忽略。
  验证：单元测试覆盖 xlsx/csv/pdf/md 匹配 + 不支持 pattern 忽略；`npm run build`
  来源：design D20

- [x] 10.3 阶段 2 move 失败不回滚，孤儿文件留给 HOFS TTL 清理。确认 fail-closed 语义：不创建 `RequestAttachmentRecord`，请求失败。
  验证：测试覆盖多文件 move 部分失败场景 + 确认无回滚调用
  来源：design D21；spec `ts-attachment-remote-upload` Requirement `Move failure does not rollback already-moved files`

- [x] 10.4 新增 per-session 文件计数器（`sessionId → { fileCount, totalSize }`），执行 config `chat-upload-max-file-number` 限制。与 per-user 计数器（D7）双层校验。
  验证：单元测试覆盖 per-session 超限 + per-user 超限 + 两者都通过；`npm run build`
  来源：design D22；spec `ts-attachment-remote-upload` Requirement `Per-session and per-user dual-layer file count limits`

- [x] 10.5 确认 D5 定义的 `BlobStoreGateway.deleteBlob`（幂等）和 `copyBlob` 已覆盖 D15 用户删除 temp、D24 cleanup 删除 formal、D4 阶段 2 temp→formal move 三种场景。
  验证：接口定义存在；`npm run build`
  来源：design D23；spec `ts-attachment-remote-upload` Requirement `BlobStoreGateway supports temp and formal file deletion`

- [x] 10.6 Cleanup runtime 统一使用 `BlobStoreGateway.deleteBlob`，不区分 deploymentMode。
  验证：测试覆盖两种模式 cleanup 都调 blobStore.deleteBlob；`npm run build`
  来源：design D24；spec `ts-attachment-remote-upload` Requirement `Cleanup runtime uses BlobStoreGateway`

## 11. 安全设计补充任务

- [x] 11.1 实现 Zip Slip 防护：读 ZIP Central Directory 时检查每个条目 fileName 是否包含路径穿越字符（`../`、绝对路径）。在 zip 炸弹检查之前执行。
  验证：单元测试覆盖含 `../` 条目的 ZIP 被拒绝 + 安全相对路径 ZIP 通过；`npm run build`
  来源：design D25；spec `ts-file-security-validation` Requirement `Zip Slip protection rejects path traversal in ZIP entries`

- [x] 11.2 实现全局上传并发限制（4 个并发槽，全局共享，30 秒超时返回 503）。
  验证：单元测试覆盖 4 并发 + 第 5 个等待 + 超时 503；`npm run build`
  来源：design D26；spec `ts-file-security-validation` Requirement `Global upload concurrency limit of 4`

- [x] 11.3 Phase 1 上传改用流式 multipart 解析，文件流式写入本地临时文件，只读回 header 做校验。流式过程中实时检查文件大小，超限立即中止并删除本地临时文件。
  验证：测试覆盖大文件流式上传内存不爆 + 超限文件流式中止 + temp 文件清理；`npm run build`
  来源：design D27；spec `ts-file-security-validation` Requirement `Streaming upload prevents memory exhaustion`

- [x] 11.4 Phase 1 校验管道实现 try-catch-finally：任何校验失败后删除已写入的 HOFS temp 文件。
  验证：测试覆盖 magic bytes 失败后 temp 删除 + zip 炸弹失败后 temp 删除 + 任何异常后 temp 删除
  来源：design D28；spec `ts-file-security-validation` Requirement `Temp file cleanup on validation failure uses try-catch-finally`

- [x] 11.5 每次上传操作（phase 1 上传、phase 2 move、temp 删除）记录审计日志（成功+失败），含 userId/sessionId/operation/result/fileName/sizeBytes/reasonCode/timestamp/tempRunId，不含文件路径。
  验证：测试覆盖成功/失败/删除三种审计日志
  来源：design D29；spec `ts-file-security-validation` Requirement `Upload operation audit logging for success and failure`

- [x] 11.6 HOFS 路径构建使用 `path.resolve()` + 规范路径比较，校验 tempRunId（UUID 格式）和 fileName 不会逃逸目标目录。
  验证：单元测试覆盖 `../../` tempRunId 被拒绝 + 正常 tempRunId 通过
  来源：design D30；spec `ts-file-security-validation` Requirement `Path traversal protection for HOFS path construction`

- [x] 11.7 显式声明不支持分片上传，每个请求必须携带完整文件，大小通过流式实时检查控制。
  验证：spec 文档确认 + 测试覆盖单个完整文件上传正路径
  来源：design D31；spec `ts-file-security-validation` Requirement `Chunked upload is not supported`

- [x] 11.8 Runtime 从 `ToolExecutionContext.attachmentRefs` 组装 `hofsPath` 数组注入 `ToolExecutionContext`，同时以 `FILE_PATHS` key 通过 sandbox env 传递给产品 Skill API。即使单文件也用数组形式，无文件时不传递 hofsPath 字段和 FILE_PATHS key。
  验证：测试覆盖多文件/单文件/无文件三种场景的 hofsPath + FILE_PATHS 格式 + 确认不来自 model args；`npm run build`
  来源：design D32；spec `request-attachments` Requirement `File paths are passed to product Skill API via hofsPath array and FILE_PATHS env`

- [N/A] 11.9 ~~`GatewayBindings` 新增 `fileStore?: FileStoreGateway` 字段。Composition 在 remote 模式下从 `GatewayBindings.fileStore` 读取并注入给 attachment runtime 和 cleanup runtime。~~ — 已移除：BlobStoreGateway 是统一文件存储网关，不再需要 `GatewayBindings.fileStore`。
  验证：N/A
  来源：design D34

## 12. 本地临时文件中转（HOFS 非流式）

- [x] 12.1 `AppRuntimePaths` 新增 `uploadTempDir` 字段（`{systemDataDir}/upload-tmp`），路径校验逻辑覆盖新目录。
  验证：`npm run build`；路径校验测试覆盖
  来源：design D33

- [x] 12.2 Phase 1 上传改为"先写本地临时文件，再通过 storeBlob 整体上传到 BlobStoreGateway"。流式写入本地磁盘，实时检查大小，完成后读 header 校验，再通过 storeBlob 整体上传。
  验证：测试覆盖流式写入本地 + 校验 + BlobStoreGateway 上传 + 本地文件清理；`npm run build`
  来源：design D33；spec `ts-file-security-validation` Requirement `Local temp file staging before BlobStoreGateway upload`

- [x] 12.3 实现本地临时目录全局上限 2048MB 检查 + ENOSPC 磁盘写入失败处理。
  验证：测试覆盖超限拒绝 + ENOSPC 中止删除 + 正常通过；`npm run build`
  来源：design D33；spec `ts-file-security-validation` Requirement `Local upload temp directory has disk space protection`

- [x] 12.4 实现三层清理：正常流程 try-catch-finally 删除 + 启动时扫描清理 + 定期 cleanup job（复用 `execution-cleanup-jobs.ts` 模式，1 小时过期）。
  验证：测试覆盖正常删除 + 启动扫描 + 定期清理；`npm run build`
  来源：design D33；spec `ts-file-security-validation` Requirement `Local upload temp directory has three-layer cleanup`

- [x] 12.5 更新 D28 try-catch-finally 逻辑，同时清理本地临时文件和 HOFS temp 文件。
  验证：测试覆盖校验失败清理本地 + HOFS 上传失败清理本地 + 正常流程清理本地
  来源：design D33

## 13. 统一 staged upload 目标态收敛

- [x] 13.1 将 Web submit DTO 的 `tempFiles` 收敛为 `attachments`，并移除 session request 与 convenience request 的 multipart 附件回退；所有附件提交均为 JSON staged refs。
  验证：路由测试覆盖 local/remote 均使用同一 JSON submit；multipart submit 含文件被拒绝。

- [x] 13.2 将 `RemoteUploadService` 收敛为存储无关的 attachment staged-upload runtime，并在 composition 中无条件注入；effective upload config 在无 HOFS 时仍可用。
  验证：单元测试覆盖 local gateway 与 remote-style gateway 使用同一阶段 1、删除、最终化路径。

- [x] 13.3 收敛 `BlobStoreGateway.copyBlob`：返回 destination `BlobRef`，最终化时仅持久化 gateway 返回的 opaque ref；local gateway 不得依赖 remote 对象路径语义。
  验证：local copy 后 attachment record 的 `storageRef` 可被 `loadBlob` 读取；contract/unit tests 覆盖。

- [x] 13.4 移除 bootstrap、前端与 Web channel 中以 `hofsBucketName`/remote service 可用性决定上传协议的分支；bootstrap 不向客户端暴露存储路由细节。
  验证：frontend tests 覆盖 local 无 HOFS 时仍先上传再 JSON submit；bootstrap contract 不含 bucket 字段。

- [x] 13.5 更新 edit/retry 规则为存储无关的产品规则，并覆盖 staged attachments 的拒绝/复用行为。
  验证：local 与 remote-style composition 的 edit/retry contract tests 通过。

- [x] 13.6 为统一生命周期补全端到端测试：暂存上传 -> JSON submit 最终化 -> attachment record -> tool attachment refs；Python sandbox 读取 materialized 附件后进入下一轮问答；同时验证 local `storageRef` 可读且不等于 workspace path。
  验证：e2e/route integration tests 通过。

- [x] 13.7 执行 `openspec validate add-ts-remote-file-upload --strict`、`npm run build`、相关 package tests、`npm run test:contract`、`npm run lint:architecture`。
  验证：所有命令通过并记录结果。

- [x] 13.8 扩展 `BlobStoreGateway` 的流式 `materializeBlob` 能力；runtime 在每次 tool execution 前将 attachment records materialize 到 run-scoped `temp/attachments`，并仅向 tool/sandbox 传递 `attachmentPaths` / `FILE_PATHS`。删除 `storageRef` 与 `hofsPath` 作为执行路径的行为。
  验证：local SQLite blob 与 remote-style gateway 都通过相同的 materialization contract；大附件不经 `loadBlob(): Uint8Array`；run cleanup 删除 materialized 文件；model-visible 输入不含 raw ref 或 execution path。

- [x] 13.9 收敛 app composition 边界：attachment runtime 拥有附件物化、materialized view cleanup、upload temp startup cleanup 和 upload config loader；`agent-app` 仅创建服务、注册 maintenance job、并向 runtime/channel 接线。
  验证：attachment execution runtime tests、product attachment E2E、`npm run build`、`npm run test:contract`、`npm run lint:architecture` 通过。

- [x] 13.10 LOCAL product gateway 使用 `{systemDataDir}/blobs` 文件 blob store 保存附件字节，SQLite 仅保存 attachment metadata；通过同一 `BlobStoreGateway.materializeBlob` 生成 Read-visible execution 文件。
  验证：local filesystem blob store 测试覆盖 store/copy/materialize/delete/list；附件产品 E2E、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict` 通过。

- [x] 13.11 扩展 `AttachmentMediaType` 电信词汇：并列新增 `"PCAP" | "PCAPNG" | "CAP" | "TMF" | "PTMF" | "ZIP" | "TAR" | "RAR" | "GZ"`（信令分析与数传分析场景并集），staged-upload 与 intake 两条路径同步映射；`chat-upload-file-type` 为替换语义，`DEFAULT_FILE_TYPES` 保持 `["*.md", "*.markdown"]` markdown-only（平台除 markdown 外无内置解析能力），电信扩展名仅经显式配置生效；前端 `ATTACHMENT_MEDIA_TYPES` 与 `deriveAttachmentMediaType` 镜像同一映射。
  验证：`staged-upload-runtime.test.ts` 新增 11 组扩展名 → mediaType 全链路断言（显式 telecom config，含 `.PCAP` 大小写归一与 `.tar.gz` 末段命中）；`chat-upload-config.test.ts` 默认值断言更新为 `["*.md", "*.markdown"]`；`npm run build`、相关 package tests 通过。

- [x] 13.12 恢复前端选择后校验的 config 驱动（D17 回归修复）：`validateAttachmentFile`/`validateAttachmentSelection` 接受 bootstrap `chatUploadFileConfig`，扩展名白名单、大小与数量上限均取 config，无 config 回退 markdown-only 默认；`deriveAcceptedExtensions` 统一 accept 属性与 JS 校验的 pattern 归一逻辑；i18n 提示参数化（`{{types}}`/`{{maxSizeMB}}`），不再写死 Markdown/5 MiB。
  验证：`MessageInput.attachments.test.tsx` 新增 4 个 config 驱动校验用例（电信类型放行、配置替换语义、无配置默认、配置化大小/数量上限）通过；前端 `tsc --noEmit` 通过。
