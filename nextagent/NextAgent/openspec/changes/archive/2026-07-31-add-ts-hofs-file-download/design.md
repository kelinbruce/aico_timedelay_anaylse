## 背景和现状（Context）

`add-ts-remote-file-upload` 完成了 HOFS 上传通路：产品 Skill API 通过 `BlobStoreGateway` 写入 HOFS，`AttachmentExecutionRuntime.materialize` 在 tool loop 前用 `BlobStoreGateway.materializeBlob` 把 HOFS 字节物化到 run-scoped `temp/attachments`，skill 从 `ToolExecutionContext.attachmentPaths` 读取本地文件，run terminal 后清理。这条 skill 读取侧的 egress 通路已确立了一个原则：**HOFS 是 canonical，`materializeBlob` 是唯一的 HOFS→local 原语，调用方 own 目标目录 + 生命周期清理。**

下载是这条 egress 通路的 HTTP 版，不是第二条 HOFS 访问机制。本 change 复用同一 `materializeBlob` 原语，把 scope 从 run 换成单个 HTTP 请求。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 对话气泡内 `TOOL_STRUCTURED_DELTA`（FILE）输出的 HOFS 文件，用户可点击下载。
- 下载经后端代理，复用 `BlobStoreGateway.materializeBlob`，不引入第二条 HOFS 读取机制。
- FILE messageType 的 content 携带完整 HOFS objectName（string），前端取末段展示，下载传完整路径。
- owner scope 来自 channel/auth boundary，不从请求体或模型输出获取。
- 下载临时文件 lifecycle 同形于 skill 读取侧（materialize → 流式输出 → scope 结束清理）+ 上传侧 D33（三层清理）。

**非目标：**

- 不下载用户上传的附件（attachmentId → storageRef），本 change 只针对产品 Skill API 生成并放入 HOFS 的文件。
- 不实现文件预览、多文件批量下载、下载进度反馈。
- 不修改 `BlobStoreGateway` contract（复用既有 `materializeBlob`/`getBlobMetadata`）。
- 不关心产品 Skill API 如何写入 HOFS、用什么身份写入——产品负责写入并把完整 objectName 放进 FILE content，本 change 只管下载。

## 设计决策（Decisions）

### D1: 下载复用 materializeBlob，同形于 skill 读取侧

skill 读取侧（既有，`add-ts-remote-file-upload` D36）与下载侧（新增）的结构完全平行：

| 维度 | skill 读取（既有 D36） | 下载（新增） |
|------|----------------------|-------------|
| HOFS canonical | `BlobStoreGateway` 持有字节 | `BlobStoreGateway` 持有字节 |
| 读取原语 | `materializeBlob(blobRef, localPath)` | `materializeBlob(blobRef, localPath)` |
| blobRef 来源 | `attachment.storageRef`（上传存入） | FILE content 的完整 HOFS objectName |
| owner scope | `identityContext.tenantId/subjectId` | `identityResolver` 解析的当前用户 |
| 目标目录 | run-scoped `temp/attachments/{runId}` | request-scoped `download-tmp/{downloadId}` |
| 目录 owner | `AttachmentExecutionRuntime` | 下载 materialize runtime |
| 清理时机 | run terminal / 物化中途出错 | HTTP response finish / error |
| 额外兜底 | run 生命周期 | 三层清理（启动扫描 + 定期 job） |

同原语、同原则（HOFS canonical / 瞬态物化视图 / scope 结束清理），scope 因生命周期差异而不同——这是同形同策的正解，不是例外。下载不新增任何 `BlobStoreGateway` 方法。

### D2: FILE content 携带完整 HOFS objectName

FILE messageType 的 content 类型不变（string），语义从"文件名"转为"完整 HOFS objectName"。格式约定同 `add-ts-remote-file-upload` D5：`aicoservice/answer/{sessionId}/{chatId}/result.xlsx`。

前端从 objectName 末段提取 `fileName` 展示（`result.xlsx`），下载时传完整 objectName 给后端 endpoint。

向后兼容：若 content 不含路径分隔符（旧格式纯文件名），`FileCard` 仍按纯展示渲染，不渲染下载按钮。

### D3: 下载 endpoint 与路由

```
GET /api/v1/sessions/:sessionId/files/download?path=<完整 HOFS objectName>
```

路由 session 级（`sessions/:sessionId/files/...`），与上传端点 `sessions/:sessionId/files/...` 同形。session 路径参数顺带可用于 agent scope 校验（sessionId → session.agentId），但下载的核心鉴权是 owner scope（当前用户），不是 agent scope。

`path` query 参数是完整 HOFS objectName，URL-encoded。

### D4: FileDownloadPort local port

`agent-channel-web` 不直接 import `BlobStoreGateway`（架构边界，同 `StagedUploadPort` 模式）。下载通过 local port：

```typescript
export interface FileDownloadPort {
  materialize(request: {
    readonly identityContext: IdentityContext;
    readonly objectName: string;
    readonly downloadId: string;
  }): Promise<{ readonly localFilePath: string; readonly safeFileName: string }>;
  cleanup(request: { readonly downloadId: string }): Promise<void>;
}
```

`WebChannelDependencies` 新增 `fileDownloadRuntime?: FileDownloadPort`。composition 接线到 `BlobStoreGateway.materializeBlob`。

### D5: 下载 materialize runtime

同 `AttachmentExecutionRuntime` 形状（`materialize` + `cleanup`），owner 一个 request-scoped 目录：

```typescript
export function createFileDownloadRuntime(input: {
  readonly blobStore: BlobStoreGateway;
  readonly downloadTempDir: string;
}): FileDownloadRuntime {
  return {
    async materialize(request) {
      const safeFileName = sanitizeFileName(extractLastSegment(request.objectName));
      const downloadDir = join(downloadTempDir, request.downloadId);
      const localFilePath = join(downloadDir, safeFileName);
      await mkdir(downloadDir, { recursive: true });
      const materialized = await blobStore.materializeBlob({
        tenantId: request.identityContext.tenantId,
        subjectId: request.identityContext.subjectId,
        blobRef: brand<string, "BlobRef">(request.objectName),
        localFilePath
      });
      if (materialized !== true) throw new Error("Download blob is unavailable.");
      return { localFilePath, safeFileName };
    },
    async cleanup(request) {
      await rm(join(downloadTempDir, request.downloadId), { recursive: true, force: true });
    }
  };
}
```

出错中途 → 清理已物化目录，throw（同 `AttachmentExecutionRuntime`）。

### D6: HTTP 响应与流式输出

```
1. identityResolver → owner scope (tenantId/subjectId)
2. 生成 downloadId（randomUUID）
3. FileDownloadPort.materialize(ownerScope, objectName, downloadId)
   → BlobStoreGateway.materializeBlob (remote: HOFS→本地临时文件)
4. reply.header("Content-Disposition", `attachment; filename="${safeFileName}"`)
   reply.type(mimeTypeFromExtension(safeFileName) || "application/octet-stream")
   reply.send(createReadStream(localFilePath))
5. reply 'finish'/'error' 事件 → FileDownloadPort.cleanup(downloadId)
```

mimeType 从 `safeFileName` 扩展名推断，不依赖 `getBlobMetadata`（避免额外 HOFS 往返）。octet-stream 兜底。

### D7: 下载临时文件 lifecycle（三层清理）

同形于 `add-ts-remote-file-upload` D33，但独立目录避免与 upload-tmp 混淆：

- **正常流程**：HTTP response finish → `FileDownloadPort.cleanup(downloadId)` 删除临时目录（try-catch-finally 保证）。
- **异常流程**：materialize 失败 / 流式发送出错 → 删除临时目录。
- **启动扫描**：服务启动时扫描 `download-tmp/`，清理所有残留文件（同 `cleanupUploadTempAtStartup`）。
- **定期清理**：复用 `execution-cleanup-jobs` 模式，定期清理超过 1 小时的孤儿文件（同 `upload-temp-cleanup-job`）。

`AppRuntimePaths` 新增 `downloadTempDir: string`（`{systemDataDir}/download-tmp`），路径校验逻辑覆盖（同 `uploadTempDir` 的加法）。

全局上限（同 D33 的 2048MB 思路）：使用下载专用内存计数器原子预留与释放容量。`getBlobMetadata` 返回有效大小时，在物化前预留；元数据不可用时，物化后按实际文件大小原子预留，预留失败立即删除请求目录并返回安全容量错误。实际大小与预留值不同时按差值校准。并发请求共享同一计数器，已接受文件的总计费大小不得超过 2048MB；该计数器与 upload-tmp 分离。

### D8: 安全约束

- **owner scope**：来自 `identityResolver`（channel/auth boundary），不从 query/body/模型输出获取。
- **objectName 路径穿越校验**：禁止 `..`、绝对路径（`/` 开头或盘符）、空字节。`safeFileName` 从末段提取后 `path.resolve()` + 规范路径比较，确保不逃逸 `download-tmp/{downloadId}/`（同形于 D30）。
- **不嵌入 credential/token**：鉴权由 channel/auth boundary 完成，URL 不含 token。
- **下载临时文件不进入 model-visible**：与 skill 读取侧一致，临时文件只用于 HTTP 响应，不进 `ToolExecutionContext`、tool args、sandbox、prompt。

### D9: 基线 spec 修改（FILE 受控例外）

`openspec/specs/tool-structured-delta/spec.md` 的 Security Constraints 当前规定：

> The `TOOL_STRUCTURED_DELTA` content MUST NOT contain credentials, tokens, raw provider errors, file paths, or prompt text.

本 change 修改该约束，为 FILE messageType 开受控例外：FILE content 允许携带完整 HOFS objectName（远端对象存储引用 + 下载定位 token，非本地 FS 路径/执行路径）。其余 messageType（PIU/DSL/ACTION/OPERATOR/TEXT）仍禁止 file paths。

实现层 `hasSensitiveStructuredContent`（`packages/agent-core/src/tools/structured-delta-safety.ts`）当前只查 credential/token 模式，不拦路径，无需改动实现，纯 spec gap 修正。

### D10: 前端 FileCard 升级

`FileCard` 从纯展示升级为下载卡片：

- 取 content 末段作为 `fileName` 展示。
- 若 content 含路径分隔符（HOFS objectName），渲染 [下载] 按钮；否则按旧格式纯展示。
- 下载触发：前端用 `fetch` 调用 `GET /api/v1/sessions/:sessionId/files/download?path=<objectName>`，读取响应 Blob，创建临时 object URL 后触发隐藏 `<a download>`，最后撤销 object URL。
- `AnswerSegments` FILE 分支：把完整 content 传给 `FileCard`，由 `FileCard` 内部取末段。
- 卡片视觉规范见 D12。

视觉参照 `docs/ucd/05-component-specs/file-download.md`，但下载机制改为后端代理（非 `<a download>` 直连，因 HOFS 不对浏览器直达）。


### D12: 文件卡片视觉规范

下载卡片固定尺寸 291px × 58px，圆角 8px，内边距 8px 16px。卡片横向分为左右两部分，右侧固定 48px 宽承载"下载"文字，左侧承载文件图标 + 文件信息。左右两部分之间有一条 26px 高、1px 宽的垂直分割线。

```
┌─────────────────────────────────────────────────────────────┐
│  ┌──────┐                              │            ┌─────┐ │
│  │ icon │  文件名称(14px, 省略)         │  divider   │下载 │ │   291 × 58, radius 8
│  │ 24²  │  已生成(12px)               │            └─────┘ │   padding 8px 16px
│  └──────┘   ↑ 8px gap to icon/divider   │  26px×1px  右侧48px│
└─────────────────────────────────────────────────────────────┘
   ←──────── 左侧（图标+信息）────────→│←── 右侧（下载）──→
```

**左侧布局**：左侧再分为图标区（24×24，`FileTypeIcon`）和信息区。信息区距图标和分割线各 8px，占据剩余宽度，分两行：第一行文件名（14px，line-height 22px，`truncateFileNameMiddle` 中间省略截断（保留扩展名，同 `AttachmentFileCard`），`title` 悬浮显示完整文件名），第二行固定文字「已生成」（12px，line-height 20px）。

**文件图标映射**：复用既有 `frontend/agent-web/src/features/shared/components/FileTypeIcon.tsx` 的 `resolveFileTypeKind`（与输入框 `AttachmentFileCard` 的 chip 图标选取规则一致），按文件扩展名映射 excel/word/markdown/pdf/archive/generic，避免第二套图标映射（同形同策）。

**右侧下载区**：右侧 48px 宽，最右边"下载"文字 12px；深色字体 `rgba(92,162,233,1)`，浅色字体 `rgba(0,103,209,1)`。hover 时 cursor 变 pointer，点击触发下载流程。

**分割线**：26px 高，1px 宽，居中于左右两部分之间；深色 `rgba(119,119,119,1)`，浅色 `rgba(201,201,201,1)`。

**主题色板**（复用 `:root[data-theme="light"/"dark"]` CSS 变量机制，见 `styles/theme.css`）：

| 元素 | 深色（dark/evening） | 浅色（light/lightday） |
|------|---------------------|----------------------|
| 卡片背景 | `rgba(243,243,243,0.1)` | `rgba(201,201,201,0.2)` |
| 卡片边框 | `1px solid rgba(46,134,222,1)` | `1px solid rgba(0,103,209,1)` |
| 文件名 | `rgba(255,255,255,1)` | `rgba(25,25,25,1)` |
| 已生成文字 | `rgba(201,201,201,1)` | `rgba(119,119,119,1)` |
| 分割线 | `rgba(119,119,119,1)` | `rgba(201,201,201,1)` |
| 下载文字 | `rgba(92,162,233,1)` | `rgba(0,103,209,1)` |

固定尺寸通过 `width: 291px; height: 58px;` 约束，内容不撑破布局。`FileCard` 接收 `isDark`（与 `AttachmentFileCard` 一致的主题判定）。

### D11: owner scope 不依赖写入侧

下载只用当前用户的 owner scope 调 `BlobStoreGateway`。产品 Skill API 如何写入 HOFS、用什么身份写入不进本 change 范围。remote `BlobStoreGateway` 实现按 D5 用 `blobRef`（=完整 objectName）+ bucket 前缀定位，不靠 owner scope 拼路径；若 remote 实现对读做了 owner scope 鉴权，那是隔离环境的事，不在本仓契约里。

## 数据流（Data Flow）

```
产品 Skill API 写 HOFS 文件 → 把完整 objectName 放进 FILE delta content
   │  (string: "aicoservice/answer/{sessionId}/{chatId}/result.xlsx")
   ▼
TOOL_STRUCTURED_DELTA(FILE) → stream 透传（对 string content 已支持）
   ▼
前端 FileCard: 取末段展示 + [下载]按钮
   │  点击
   ▼
GET /api/v1/sessions/:sessionId/files/download?path=<完整 objectName>
   │  owner scope ← identityResolver(channel/auth)
   ▼
FileDownloadPort (local port)
   └─ composition 接线 → BlobStoreGateway.materializeBlob
        (blobRef = objectName, localFilePath = download-tmp/{downloadId}/{safeFileName})
   ▼
reply: Content-Disposition: attachment; filename="result.xlsx"
       Content-Type: 从扩展名推断 (octet-stream 兜底)
       流式发送临时文件字节
   ▼
finish/error → FileDownloadPort.cleanup(downloadId) (+ 启动扫描 + 定期 cleanup)
```

## 影响文件

- `packages/agent-common/src/...`：`AppRuntimePaths` 新增 `downloadTempDir`。
- `packages/agent-channel-web/src/routes/requests.ts`：新增下载 endpoint；`WebChannelDependencies` 新增 `fileDownloadRuntime?`；新增 `FileDownloadPort` local port interface。
- `packages/agent-attachment-runtime/src/...`：新增 `createFileDownloadRuntime`（同 `AttachmentExecutionRuntime` 形状）；新增 `download-temp-cleanup-job`（同 `upload-temp-cleanup-job`）。
- `packages/agent-app/src/config/paths.ts`：`AppRuntimePaths` 新增 `downloadTempDir`，路径校验覆盖。
- `packages/agent-app/src/composition/attachment-composition.ts`（或下载 composition）：接线 `FileDownloadPort` → `BlobStoreGateway`；注册下载 cleanup job。
- `frontend/agent-web/src/features/chat/components/structured/FileCard.tsx`：升级为下载卡片。
- `frontend/agent-web/src/features/chat/components/structured/AnswerSegments.tsx`：FILE 分支适配。
- `packages/agent-core/src/tools/structured-delta-safety.ts`：无需改动（已不拦路径）。
- `openspec/specs/tool-structured-delta/spec.md`：基线修改（归档前）。
- `openspec/changes/add-ts-hofs-file-download/specs/tool-structured-delta/spec.md`：MODIFIED Requirements。
- `openspec/changes/add-ts-hofs-file-download/specs/ts-hofs-file-download/spec.md`：ADDED Requirements。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-5.2-调用能力` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/tool-structured-delta/spec.md`、`openspec/specs/ts-hofs-file-download/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
