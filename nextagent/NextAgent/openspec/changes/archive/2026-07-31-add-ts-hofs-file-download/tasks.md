## 1. 契约与基线 spec

- [x] 1.1 修改基线 `openspec/specs/tool-structured-delta/spec.md` 的 Security Constraints：为 `FILE` messageType 开受控例外，允许 content 携带完整 HOFS objectName；其余 messageType 仍禁止 file paths；credential/token 禁令对 FILE 同样适用。
  验证：`openspec validate add-ts-hofs-file-download --strict`；spec 文本包含 FILE 受控例外段落与非 FILE 拒绝路径场景。
  来源：design D9；spec `tool-structured-delta` Requirement `Security Constraints`

- [x] 1.2 确认 `packages/agent-core/src/tools/structured-delta-safety.ts` 的 `hasSensitiveStructuredContent` 无需改动（已只查 credential/token，不拦路径）。
  验证：源码断言该函数仅匹配 credential/token 模式；既有 structured-delta 测试通过。
  来源：design D9

- [x] 1.3 确认 `BlobStoreGateway` contract 无方法新增（复用 `materializeBlob`）。
  验证：`rg "materializeBlob|interface BlobStoreGateway" packages/agent-contracts/src/gateway/index.ts` 确认无新增方法；`npm run build`。
  来源：design D1；spec `ts-hofs-file-download` Requirement `Download reuses BlobStoreGateway.materializeBlob`

## 2. 后端下载 endpoint 与 local port

- [x] 2.1 在 `packages/agent-channel-web/src/routes/requests.ts` 新增 `GET /api/v1/sessions/:sessionId/files/download` endpoint：query 接收 `path`（完整 HOFS objectName），owner scope 来自 `identityResolver`。
  验证：API 测试覆盖正常下载 + owner scope 不来自 query/body；`npm run build`。
  来源：design D3, D6；spec `ts-hofs-file-download` Requirement `HOFS file download endpoint`

- [x] 2.2 在 `packages/agent-channel-web/src/routes/requests.ts` 新增 `FileDownloadPort` local port interface（`materialize` + `cleanup`），同 `StagedUploadPort` 模式；`WebChannelDependencies` 新增 `fileDownloadRuntime?: FileDownloadPort`。
  验证：architecture test 断言 `agent-channel-web` 不直接 import `BlobStoreGateway`/`agent-attachment-runtime`；`npm run build`。
  来源：design D4；spec `ts-hofs-file-download` Requirement `FileDownloadPort local port`

- [x] 2.3 实现下载路由逻辑：生成 `downloadId` → `FileDownloadPort.materialize` → `reply.header("Content-Disposition", ...)` + `reply.type(mimeTypeFromExtension)` → `reply.send(createReadStream(localFilePath))` → response finish/error 调 `cleanup`。
  验证：API 测试覆盖 Content-Disposition filename 为末段、Content-Type 由扩展名推断、octet-stream 兜底；`npm run build`。
  来源：design D6；spec `ts-hofs-file-download` Requirement `Download file name and content type derivation`

- [x] 2.4 实现 objectName 路径穿越校验：禁止 `..`、绝对路径（`/` 开头或盘符）、空字节；`safeFileName` 从末段提取 + `path.resolve()` 规范路径比较。
  验证：单元测试覆盖 `../`、绝对路径、空字节被拒绝 + 正常 objectName 通过；`npm run build`。
  来源：design D8；spec `ts-hofs-file-download` Requirement `HOFS file download endpoint` Scenario `Object name with path traversal rejected`

## 3. 下载 materialize runtime 与临时文件 lifecycle

- [x] 3.1 在 `agent-attachment-runtime` 新增 `createFileDownloadRuntime`（同 `AttachmentExecutionRuntime` 形状：`materialize` + `cleanup`），owner 一个 request-scoped 目录，调 `BlobStoreGateway.materializeBlob`。
  验证：单元测试覆盖 materialize 成功 + materialize 失败清理目录 + throw；`npm run build`。
  来源：design D5；spec `ts-hofs-file-download` Requirement `Download reuses BlobStoreGateway.materializeBlob`

- [x] 3.2 在 `agent-app/src/config/paths.ts` 的 `AppRuntimePaths` 新增 `downloadTempDir`（`{systemDataDir}/download-tmp`），路径校验逻辑覆盖（同 `uploadTempDir` 加法）。
  验证：路径校验测试覆盖 `downloadTempDir`；`npm run build`。
  来源：design D7；spec `ts-hofs-file-download` Requirement `Download temporary file lifecycle`

- [x] 3.3 实现三层清理：HTTP response finish/error 删除 `download-tmp/{downloadId}` + 启动扫描清理（同 `cleanupUploadTempAtStartup`）+ 定期 cleanup job（同 `upload-temp-cleanup-job`，1 小时过期）。
  验证：测试覆盖正常删除 + 启动扫描 + 定期清理；`npm run build`。
  来源：design D7；spec `ts-hofs-file-download` Requirement `Download temporary file lifecycle`

- [x] 3.4 实现下载临时目录全局上限（同 D33 的 2048MB 思路），下载专用内存计数器原子预留/释放容量；元数据可用时物化前预留，缺失时按实际大小预留且超限立即清理；并发请求不得共同穿透上限。
  验证：`npx vitest run packages/agent-attachment-runtime/tests/file-download-runtime.test.ts` 覆盖预检超限不调用 materialize、并发仅一个请求获准、cleanup 释放容量。
  来源：design D7；spec `ts-hofs-file-download` Requirement `Download temporary file lifecycle` Scenario `Download temp global size cap enforced`

## 4. Composition 接线

- [x] 4.1 在 composition（`attachment-composition.ts` 或下载 composition）接线 `FileDownloadPort` 到 `BlobStoreGateway`，注入 `downloadTempDir`。
  验证：composition 测试覆盖 `fileDownloadRuntime` 被注入且 backing 到 `materializeBlob`；`npm run build`。
  来源：design D4, D5；spec `ts-hofs-file-download` Requirement `FileDownloadPort local port`

- [x] 4.2 注册下载 cleanup job 到 `scheduledMaintenance`，启动扫描在 composition 启动时执行。
  验证：composition 测试覆盖 job 注册 + 启动扫描调用；`npm run build`。
  来源：design D7

## 5. 前端下载卡片

- [x] 5.1 升级 `frontend/agent-web/src/features/chat/components/structured/FileCard.tsx` 为下载卡片：取 content 末段展示 fileName + [下载] 按钮；content 含路径分隔符时渲染下载按钮，否则纯展示。
  验证：前端组件测试覆盖 HOFS objectName 展示末段 + 下载按钮 + 旧格式纯文件名纯展示；`frontend/agent-web` `npm run build`。
  来源：design D10；spec `ts-hofs-file-download` Requirement `FILE delta content carries complete HOFS object name`

- [x] 5.2 适配 `AnswerSegments.tsx` FILE 分支：把完整 content 传给 `FileCard`，由 `FileCard` 内部取末段。
  验证：前端测试覆盖 FILE 分支传完整 content；`frontend/agent-web` `npm run build`。
  来源：design D10

- [x] 5.3 实现下载触发逻辑：点击下载按钮调用 `GET /api/v1/sessions/:sessionId/files/download?path=<objectName>`，浏览器触发原生下载。
  验证：前端测试覆盖下载触发调用正确 endpoint + 传完整 objectName；`frontend/agent-web` `npm run build`。
  来源：design D10；spec `ts-hofs-file-download` Requirement `FILE delta content carries complete HOFS object name`

- [x] 5.4 实现文件卡片视觉规范：固定 291px×58px、圆角 8px、padding 8px 16px；左右分区（右侧 48px 承载"下载"文字）；26px×1px 垂直分割线；左侧 24×24 `FileTypeIcon`（复用 `resolveFileTypeKind`，与 `AttachmentFileCard` 一致）+ 文件信息两行（文件名 14px/22px 省略 + title 悬浮、文件大小 12px/20px），信息区距图标和分割线 8px；深浅色主题色板按 D12 表格（卡片背景/边框/文件名/文件大小/分割线/下载文字）；下载文字 hover 变 cursor pointer。
  验证：前端组件测试覆盖固定尺寸 + 左右分区 + 分割线 + 图标复用 `resolveFileTypeKind` + 文件名省略与 title + 深色/浅色色值 + 下载文字 hover cursor pointer；`frontend/agent-web` `npm run build`。
  来源：design D12；spec `ts-hofs-file-download` Requirement `File download card visual specification`

## 6. 安全与边界测试

- [x] 6.1 测试 owner scope 不来自 query/body/模型输出：架构/源码测试断言下载路由的 owner scope 来自 `identityResolver`。
  验证：源码测试断言 owner scope 来源；`npm run build`。
  来源：design D8；spec `ts-hofs-file-download` Requirement `HOFS file download endpoint` Scenario `Owner scope not taken from request input`

- [x] 6.2 测试下载临时文件不进入 model-visible 路径：源码测试断言临时文件路径不出现在 `ToolExecutionContext`、tool args、sandbox env、prompt。
  验证：源码测试断言；`npm run build`。
  来源：design D8；spec `ts-hofs-file-download` Requirement `Download temporary file lifecycle` Scenario `Download temp file never model-visible`

- [x] 6.3 测试 `BlobStoreGateway` contract 无新增方法（architecture test）。
  验证：architecture test 断言 `BlobStoreGateway` 接口方法集未因下载新增；`npm run lint:architecture`。
  来源：design D1；spec `ts-hofs-file-download` Requirement `Download reuses BlobStoreGateway.materializeBlob` Scenario `BlobStoreGateway contract unchanged by download`

## 7. 验证门禁

- [x] 7.1 `openspec validate add-ts-hofs-file-download --strict` 通过。
  验证：命令执行成功。
  来源：AGENTS.md 验证门禁

- [x] 7.2 `npm run build` + `npm test` + `npm run test:contract` + `npm run lint:architecture` 全部通过。
  验证：全部命令执行成功。
  来源：AGENTS.md 验证门禁

- [x] 7.3 前端 `frontend/agent-web` `npm run build` + 相关测试通过。
  验证：命令执行成功。
  来源：AGENTS.md 验证门禁（前端改动）
