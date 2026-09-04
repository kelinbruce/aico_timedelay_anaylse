## 背景与问题（Why）

`add-ts-remote-file-upload` 已完成远端文件上传通路：产品 Skill API 通过 `BlobStoreGateway` 写入 HOFS，文件物化到本地 workspace 供 skill 读取，上传侧 lifecycle 完整。该 change 的 proposal/design/tasks 明确将"文件下载功能第一版不做"列为遗留项，前端 `FileCard` 至今是纯展示组件（仅接收 `fileName` 字符串，无下载入口），对话气泡内输出的 HOFS 文件用户无法下载。

当前缺口：
- **FILE messageType 无下载语义**：`TOOL_STRUCTURED_DELTA` 的 FILE 分支 content 仅为文件名字符串，前端 `FileCard` 只渲染图标 + 文件名，无下载按钮、无交互、无下载基础设施（前端零 `blob`/`createObjectURL`/`saveAs` 实现）。
- **HOFS 文件不可达**：HOFS 是远端对象存储，不对浏览器直接可达。前端无法用 `downloadUrl` + `<a download>` 直连，必须经后端代理下载。
- **下载通路缺失**：`agent-channel-web` 无下载 endpoint；`BlobStoreGateway` 有 `materializeBlob`（HOFS→本地文件）能力，但未用于下载。
- **spec 安全约束冲突**：`openspec/specs/tool-structured-delta/spec.md` 的 Security Constraints 规定 content MUST NOT contain file paths。HOFS 文件下载需要 content 携带完整 HOFS objectName 作为下载定位 handle，与该约束字面冲突，需修改基线 spec 为 FILE messageType 开受控例外。
- **同形原则未对齐**：skill 读取侧已用 `materializeBlob`（HOFS canonical → 本地瞬态物化视图 → scope 结束清理），下载侧应同形处理，不引入第二条 HOFS 访问机制。

## 变更范围（What Changes）

### 契约变更

- 修改基线 `openspec/specs/tool-structured-delta/spec.md` 的 Security Constraints：为 `FILE` messageType 开受控例外，允许 content 携带完整 HOFS objectName（远端对象存储引用，非本地 FS 路径/执行路径）作为下载定位 handle。其余 messageType 仍禁止 file paths。
- 新增 `ts-hofs-file-download` capability：HOFS 文件下载能力。

### 后端下载 endpoint

- 新增 `GET /api/v1/sessions/:sessionId/files/download` endpoint，query 携带 `path`（完整 HOFS objectName）。
- owner scope 来自 channel/auth boundary（`identityResolver`），不从请求体或模型输出获取。
- 下载流程：`identityResolver` 解析 owner scope → `FileDownloadPort`（local port，同 `StagedUploadPort` 模式）materialize HOFS 文件到 request-scoped 临时目录 → 流式 HTTP 响应（`Content-Disposition: attachment; filename=<末段>`）→ 响应结束清理临时文件。
- `FileDownloadPort` 在 composition 接线到 `BlobStoreGateway.materializeBlob`（复用既有方法，不新增 gateway 方法），不破 `agent-channel-web` 不直接依赖 `agent-contracts/gateway` 的架构边界。

### Materialize 临时文件 lifecycle

- 新增 `AppRuntimePaths.downloadTempDir`（`{systemDataDir}/download-tmp`），路径校验覆盖。
- 临时文件路径：`{downloadTempDir}/{downloadId}/{safeFileName}`，`downloadId` 请求级唯一。
- 三层清理（同形于 `add-ts-remote-file-upload` D33）：HTTP response finish/error 删除 + 启动扫描清理 + 定期 cleanup job（复用 `execution-cleanup-jobs` 模式）。
- `safeFileName` 从 objectName 末段提取 + 路径穿越校验（同形于 D30）。
- 全局上限（同形于 D33 的 2048MB 思路），防磁盘打满。

### 前端下载卡片

- `FileCard` 从纯展示组件升级为下载卡片：取 content（完整 HOFS objectName）末段展示文件名 + [下载] 按钮。
- 下载触发：调用下载 endpoint，浏览器触发原生下载。
- content 类型不变（string），语义从"文件名"转为"完整 HOFS objectName"。
- 向后兼容：若 content 不含路径分隔符（旧格式纯文件名），仍按纯展示渲染，不渲染下载按钮。
- 卡片视觉规范（固定尺寸、左右分区、分割线、文件图标、下载区、深浅色主题色板）见 design D12。

### 安全约束

- 下载 endpoint 必须校验 owner scope（当前用户），不从 query 或 body 绕过。
- objectName 必须通过路径穿越校验（禁止 `..`、绝对路径、空字节）。
- 下载临时文件不得进入 model-visible 路径、tool args、sandbox 或 model prompt。
- 不在 URL 中嵌入 credential/token；鉴权由 channel/auth boundary 完成。
- 下载文件大小由 `getBlobMetadata` 预检（可选），失败降级 octet-stream 流式输出。

## Capability 影响（Capabilities）

### 新增 Capability

- `ts-hofs-file-download`：HOFS 文件下载能力，经 `BlobStoreGateway.materializeBlob` 代理下载。

### 修改的 Capability

- `tool-structured-delta`：FILE messageType 的 content 语义扩展，允许携带完整 HOFS objectName 作为下载 handle。

## 影响范围（Impact）

- `agent-contracts`：无 gateway 方法新增（复用 `materializeBlob`）；无新增 DTO。
- `agent-common`：`AppRuntimePaths` 新增 `downloadTempDir` 字段。
- `agent-channel-web`：新增下载 endpoint；新增 `FileDownloadPort` local port interface（同 `StagedUploadPort` 模式）；`WebChannelDependencies` 新增 `fileDownloadRuntime?` 字段。
- `agent-attachment-runtime`（或下载 runtime owner）：新增下载 materialize runtime（同 `AttachmentExecutionRuntime` 形状：`materialize` + `cleanup`）；新增下载临时文件 cleanup job（同 `upload-temp-cleanup-job` 模式）。
- `agent-app`：composition 接线 `FileDownloadPort` 到 `BlobStoreGateway`；注册下载 cleanup job；`AppRuntimePaths` 注入 `downloadTempDir`。
- `frontend/agent-web`：`FileCard` 升级为下载卡片；`AnswerSegments` FILE 分支适配；前端下载触发逻辑。
- `openspec/specs/tool-structured-delta/spec.md`：基线 Security Constraints 修改（FILE 受控例外）。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- 修改 `openspec/specs/tool-structured-delta/spec.md`：Security Constraints 为 FILE messageType 开 HOFS objectName 受控例外。
- 新增 `openspec/specs/ts-hofs-file-download/spec.md`：HOFS 文件下载 endpoint、materialize lifecycle、安全约束。

设计视图：
- `openspec/designs/modules/agent-attachment-runtime.md`：补充下载 materialize runtime。
- `openspec/designs/modules/agent-app.md`：补充下载 composition 接线。
- `openspec/designs/spec-to-design-map.md`：补充验证入口映射。

验证入口：
- `openspec validate add-ts-hofs-file-download --strict`
- `openspec validate --all --strict`
- `npm run build`
- `npm test`
- `npm run test:contract`
- `npm run lint:architecture`
- 前端 `frontend/agent-web` `npm run build` + 相关测试

## 遗留项（Deferred）

- 文件预览（在 Expand Panel 展示文本类文件内容）不在本 change 范围。
- 多文件批量下载（zip 打包）不在本 change 范围。
- 下载进度反馈（后端无法控制浏览器原生下载进度条）不在本 change 范围。
- 用户上传附件的下载（`request-attachments` 的 attachmentId → storageRef 下载）不在本 change 范围，本 change 只针对产品 Skill API 生成并放入 HOFS 的文件。

## 契约确认（Contract Confirmation）

- `BlobStoreGateway` 无方法新增；下载复用既有 `materializeBlob`（owner-scoped，blobRef + localFilePath）。
- `FileDownloadPort` 是 `agent-channel-web` local port，composition 接线到 `BlobStoreGateway`，不破架构边界（同 `StagedUploadPort` 模式）。
- FILE messageType 的 content 类型不变（string），语义从"文件名"转为"完整 HOFS objectName"；前端取末段展示，下载传完整路径。
- 下载临时文件位于 `{systemDataDir}/download-tmp/{downloadId}/{safeFileName}`，不进入 model-visible 路径。
- owner scope 来自 channel/auth boundary，不从请求体或模型输出获取。
