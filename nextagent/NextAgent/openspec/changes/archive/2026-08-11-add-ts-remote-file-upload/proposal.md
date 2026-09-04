## 背景与问题（Why）

当前文件上传能力（`ts-attachment-intake`、`request-attachments`）在 local 模式下可用：multipart/form-data 同步上传 Markdown 文件，blob 存入 SQLite，context engine 读取文件内容注入 model context。但该实现存在以下限制，无法满足远端产品场景：

- **文件类型硬编码为 MARKDOWN**：`attachmentIntakeLimits.enabledMediaTypes` 写死 `["MARKDOWN"]`，`AttachmentMediaType` 枚举虽预留 WORD/EXCEL/PDF 但从未驱动任何行为。远端产品需要按配置支持 xlsx/csv/pdf 等多种类型。
- **文件限制硬编码**：3 files、5MiB 写死在后端 `agent-attachment-runtime` 和前端 `attachmentRules.ts` 两处，产品无法自定义。
- **无配置驱动机制**：不同产品对文件类型、大小、数量、过期时间有不同诉求，缺乏类似 `category-question` 的 per-agent 配置能力。
- **远端模式无 HOFS 集成**：远端模式下文件需要写入远端文件存储（BlobStoreGateway），文件内容由产品 Skill API 自行从远端存储拉取解析，不进入 context。当前架构完全没有这条通路。
- **两阶段上传缺失**：远端模式下大文件/多文件无法走 multipart 同步上传，需要"选文件即上传到远端 temp 路径 → 发送问题时 move 到 formal 路径"的两阶段流程。
- **Skill 执行无法获取文件路径**：`ToolExecutionContext` 没有 attachment 字段，skill tool 无法取到文件的文件路径传递给产品 API。
- **安全防护不足**：缺少用户级上传配额、频率限制、zip 炸弹防护等安全措施。
- **前端展示缺失**：对话面板不展示文件列表，输入框文件展示不支持多文件 chip。

## 变更范围（What Changes）

### 配置层

- 在 `agents/{agentId}/config/config.json` 中新增 `chat-upload-file-config` 配置块，包含：HOFS 桶名、文件类型、最大文件数、最大文件大小、空闲过期时间、最大过期时间。
- 默认 agent 的 config 当作全局系统配置对外暴露。
- 扩展 `/api/v1/runtime/bootstrap` API，在响应中附加 `chat-upload-file-config`（effective config，后端校验后的实际生效值）。
- 配置异常处理采用 Cap + Warn 策略：字段缺失/类型错误/超系统上限时静默使用默认值或截断，不需要 notices 机制。
- `hofs-bucket-name` 为空或 config 不存在时，仅选择 local `BlobStoreGateway` 实现；对外仍使用同一暂存上传与提交最终化协议。

### 契约变更

- `RequestAttachmentRecord.mediaType` 与 `RequestAttachment.mediaType` 保持 `AttachmentMediaType`；上传 runtime 将受支持扩展映射为共享词汇。
- `AttachmentContextEvidence` 新增 safe metadata 字段（`fileName`、`mediaType`、`sizeBytes`），不含 `storageRef`。
- `ToolExecutionContext` 新增 `attachmentRefs` 字段（含 `attachmentId`、`fileName`、`mediaType`、`sizeBytes`、`storageRef`），由 runtime 预解析注入，非 model 可见。
- `WebRuntimeBootstrapConfig` 扩展 `chat-upload-file-config` 字段。
- `BlobStoreGateway` 扩展 `copyBlob`/`getBlobMetadata`/`listBlobs` 方法，`storeBlob` 从接收 `bytes: Uint8Array` 改为接收 `localFilePath: string`。

### 统一暂存上传流程

- 新增阶段 1 上传 endpoint（独立 API），用户选文件时立即上传到 gateway 管理的临时对象。返回 `{ tempRunId, fileName, sizeBytes }`，不返回存储坐标。
- 阶段 2 提交问题时，JSON body 携带 `attachments: [{ tempRunId, fileName }]`，后端最终化临时对象并创建 `RequestAttachmentRecord`。`storageRef` 必须是 gateway 返回的 opaque formal ref。
- `BlobStoreGateway` 扩展 `copyBlob`/`getBlobMetadata`/`listBlobs` 方法，`storeBlob` 改为接收 `localFilePath: string`；`copyBlob` 必须返回最终 destination `BlobRef`。
- `tempRunId` 由前端生成。
- move 操作为原子操作，fail-closed，任何文件 move 失败则整个请求失败并返回友好错误。
- 过期清理由 HOFS TTL 配置负责，前端仅做 UI 计时提醒。

### 安全防护

- 文件名正则校验：`^(?=.{1,512}$)[a-zA-Z0-9&\u3010\u3011\uff08\uff09()\s_\-\.\u4e00-\u9fa5+\[\]]+\.\w+$`，前后端均校验。
- 用户级累计限制：200 文件 / 500MB（所有 session 总和）。
- 用户级 tmp 配额：1024MB。
- 用户级上传频率限制：1 小时内最多 500 次未发送问题的上传（随问题发送的文件不计入）。
- Zip 炸弹防护：独立模块，检测 ZIP-based 文件的总解压大小 ≤ 512MB。只查总解压大小，不查压缩比、条目数或嵌套归档。
- Magic bytes 与扩展名交叉验证。
- 所有计数器使用内存 Map，LRU 淘汰（上限 10000 用户）。

### Context Engine 适配

- `DefaultContextEngineDependencies` 新增 `deploymentMode` 字段。
- 两种模式下 context engine 都跳过 `readAttachmentContentBlock()`（不调 blobStore），`attachmentContentBlocks = []`。
- 两种模式下 `renderAttachmentDisclosure` 都展示文件元数据列表（fileName、mediaType、sizeBytes），让 model 知道有哪些文件但不暴露文件路径。模型通过 Read tool 读取文件。

### Skill 执行上下文注入

- Runtime 在 tool loop 前预解析当前 request 的全部 attachments，并通过 `BlobStoreGateway.materializeBlob` 写入本次 run 的受控 `temp/attachments` 目录。
- Skill tool 只从 `context.attachmentPaths` 同步读取 materialize 后的全量文件路径数组，同时以 `FILE_PATHS` 环境变量通过 sandbox 传递。`storageRef` 只作为 gateway 输入，绝不作为工具路径或 model-visible 内容。
- `forbiddenArgKeys` 不修改（model 不传 path）。

### 前端展示

- 对话面板问题上方展示文件列表（只读，不支持下载）。
- 输入框文件展示改为 chip 列表（参考 `SelectedSkillChip` 样式），文件多时区域可横向滚动。
- 前端始终使用暂存上传；bootstrap config 只决定文件类型、大小、数量和计时展示，不能决定上传协议。
- 前端展示上传计时提醒（idle-expire / max-expire）。
- 历史会话还原时，conversation API 返回的 message 自带 attachment 列表，自然还原。

### Local 存储实现

- local gateway 必须承载与 remote 相同的临时/正式附件生命周期；附件物理字节位于 gateway 管理的 local blob file area，SQLite 仅保存 attachment metadata 与生命周期事实，不能以 execution workspace 作为持久化事实源。
- workspace 仅可在已授权的 tool execution 中按需 materialize 正式附件，不能作为 `RequestAttachmentRecord.storageRef` 的跨 run 语义。

## Capability 影响（Capabilities）

### 新增 Capability

- `ts-attachment-remote-upload`：远端模式两阶段文件上传（阶段 1 独立上传 endpoint + 阶段 2 提交时 move）。
- `ts-file-security-validation`：文件内容安全校验（magic bytes 交叉验证 + zip 炸弹防护）。
- `ts-attachment-config`：文件上传配置加载与暴露。
- `ts-runtime-bootstrap-config`：runtime bootstrap 配置扩展。

### 修改的 Capability

- `ts-attachment-intake`：受支持扩展映射为 `AttachmentMediaType`；无映射的配置扩展拒绝上传。
- `request-attachments`：context engine 两种模式都跳过 content block 读取；`AttachmentContextEvidence` 新增 safe metadata。
- `context-assembly-contracts`：`ToolExecutionContext` 新增 `attachmentRefs`。

## 影响范围（Impact）

- `agent-common`：`AttachmentMediaType` 是附件类型的共享词汇。
- `agent-contracts`：`RequestAttachmentRecord.mediaType` 保持 `AttachmentMediaType`；`AttachmentContextEvidence` 新增字段；`ToolExecutionContext` 新增 `attachmentRefs`；`WebRuntimeBootstrapConfig` 扩展；`BlobStoreGateway` 扩展 `copyBlob`/`getBlobMetadata`/`listBlobs`，`storeBlob` 改为接收 `localFilePath`。
- `agent-attachment-runtime`：新增文件内容安全校验独立模块；新增远端上传校验管道。
- `agent-context-engine`：`DefaultContextEngineDependencies` 新增 `deploymentMode`；两种模式都跳过 content block 读取；`renderAttachmentDisclosure` 展示元数据。
- `agent-capability`：`ToolExecutionContext` 新增 `attachmentRefs`；skill tool 执行时注入。
- `agent-runtime`：tool loop 前预解析 attachments 注入 context。
- `agent-channel-web`：新增阶段 1 上传 endpoint；扩展 bootstrap response；submit request body 支持 `attachments`；禁止按存储模式走 multipart 回退；conversation API 返回 attachment 列表。
- `agent-app`：composition 注入 config loader、deploymentMode、`BlobStoreGateway`（extended，统一文件存储网关）。
- `agent-platform-gateway-remote`（或隔离环境）：`BlobStoreGateway` remote 实现（`storeBlob`/`copyBlob`/`getBlobMetadata`/`listBlobs`/`deleteBlob`），打包时放入 `packages/`。
- `frontend/agent-web`：chip 列表、对话面板文件展示、bootstrap config 消费、上传计时提醒。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-attachment-intake/spec.md`：提升 `mediaType` 保持共享词汇及扩展映射的约束。
- `openspec/specs/request-attachments/spec.md`：提升 remote 模式 context engine 适配、`AttachmentContextEvidence` safe metadata、`ToolExecutionContext.attachmentRefs` 约束。
- 新增 `openspec/specs/ts-attachment-remote-upload/spec.md`：远端两阶段上传流程。
- 新增 `openspec/specs/ts-file-security-validation/spec.md`：文件内容安全校验。
- 新增 `openspec/specs/ts-attachment-config/spec.md`：文件上传配置。
- 新增 `openspec/specs/ts-runtime-bootstrap-config/spec.md`：bootstrap 配置扩展。

设计视图：
- `openspec/designs/modules/agent-attachment-runtime.md`：补充远端上传校验管道、安全校验模块。
- `openspec/designs/modules/agent-context-engine.md`：补充 deploymentMode 驱动的 remote 适配。
- `openspec/designs/modules/agent-capability.md`：补充 `attachmentRefs` 注入边界。
- `openspec/designs/spec-to-design-map.md`：补充验证入口映射。

验证入口：
- `openspec validate add-ts-remote-file-upload --strict`
- `openspec validate --all --strict`
- `npm run build`
- `npm test`
- `npm run test:contract`
- `npm run lint:architecture`

## 遗留项（Deferred）

- `BlobStoreGateway` remote 实现待隔离环境提供（`storeBlob`/`copyBlob`/`getBlobMetadata`/`listBlobs`/`deleteBlob`），打包时放入 `packages/` 目录。Contract 扩展已在 design 定义，不影响本 change 的实现框架。
- Local 模式既有 bug 修复不在本 change 范围。
- 文件下载功能第一版不做。

## 契约确认（Contract Confirmation）

- `agent-common` 的 `AttachmentMediaType`（`"WORD" | "EXCEL" | "PDF" | "MARKDOWN"`）是 `RequestAttachmentRecord.mediaType` 与 `RequestAttachment.mediaType` 的类型约束。
- 上传 runtime 必须在持久化前把支持的文件扩展映射为 `AttachmentMediaType`。
- `agent-contracts/context` 的 `AttachmentContextEvidence` 新增 `fileName`、`mediaType`、`sizeBytes` 字段。
- `agent-capability` 的 `ToolExecutionContext` 新增可选 `attachmentRefs` 字段。
- `agent-channel-web` 的 `WebRuntimeBootstrapConfig` 新增可选 `chat-upload-file-config` 字段。
- `agent-contracts/gateway` 扩展 `BlobStoreGateway` contract（新增 `copyBlob`/`getBlobMetadata`/`listBlobs`，`storeBlob` 改为接收 `localFilePath: string`）。
