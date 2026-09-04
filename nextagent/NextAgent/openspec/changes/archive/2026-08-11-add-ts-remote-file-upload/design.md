## 背景和现状（Context）

当前文件上传在 local 模式下完整可用，但所有行为约束（文件类型、大小、数量）硬编码在 `agent-attachment-runtime/src/index.ts` 的 `attachmentIntakeLimits` 和前端 `attachmentRules.ts`。`AttachmentMediaType` 枚举虽预留了 WORD/EXCEL/PDF，但行为层只认 `"MARKDOWN"`，其他枚举值从未驱动任何代码路径。

远端模式需要支持产品自定义文件类型（xlsx/csv/pdf 等），文件写入远端文件存储。核心架构决策是统一使用 `BlobStoreGateway` 作为文件存储 gateway（扩展而非新建），文件内容不进入 context，文件路径通过 context 传递，model 通过 Read/workspace-files 工具自行读取文件。这要求：

1. 配置驱动的文件限制（替代硬编码）。
2. 两阶段上传（temp → formal）。
3. 新的安全防护层（用户级配额、频率限制、zip 炸弹）。
4. Context engine 在所有模式下跳过附件内容读取，统一渲染文件元数据。
5. Skill 执行上下文注入文件路径（`FILE_PATHS` 环境变量）。

三条核心原则：
- 上传逻辑留在 attachment-runtime（优化/扩展现有 intake，不迁移到 web channel）。
- context 中只传递文件路径 — model 通过现有 Read/workspace-files 工具自行读取文件。
- 持久化通过 `BlobStoreGateway`（扩展，不替换）。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 远端模式下文件上传支持产品配置的文件类型、大小、数量。
- 远端模式两阶段上传：选文件即上传到 temp 路径，发送问题时 move 到 formal 路径。
- 文件内容不进入 model context，文件路径通过 context 传递，model 通过 Read tool 自行读取。
- 文件路径由 runtime 预解析注入 `ToolExecutionContext`，通过 `FILE_PATHS` 环境变量传递，local 和 remote 模式统一。
- 统一使用 `BlobStoreGateway` 作为文件存储 gateway（扩展既有方法，不新建 FileStoreGateway）。
- 多层安全防护：全局并发限制、文件名正则、扩展名匹配、单文件大小、上传频率、per-session 累计、per-user 累计、tmp 配额、本地磁盘防护、magic bytes 交叉验证、zip slip 防护、zip 炸弹防护、TTL。
- 前端单按钮，后端 config 驱动行为。
- 对话面板和输入框文件展示。

**非目标：**

- 不修复 local 模式既有 bug（另行处理）。
- 不实现文件下载（第一版不做）。
- 不实现 `BlobStoreGateway` remote adapter（由隔离环境提供）。
- 不修改 `forbiddenArgKeys`。

## 设计决策（Decisions）

### D1: mediaType 保持 AttachmentMediaType

`RequestAttachmentRecord.mediaType` 与 `RequestAttachment.mediaType` 保持 `AttachmentMediaType`。上传 runtime 在接收文件名后显式映射扩展：`.pdf` 为 `PDF`，`.doc`/`.docx` 为 `WORD`，`.xls`/`.xlsx`/`.csv`/`.tsv` 为 `EXCEL`，`.pcap` 为 `PCAP`，`.pcapng` 为 `PCAPNG`，`.cap` 为 `CAP`，`.tmf` 为 `TMF`，`.ptmf` 为 `PTMF`，`.zip` 为 `ZIP`，`.tar` 为 `TAR`，`.rar` 为 `RAR`，`.gz` 为 `GZ`，已允许的文本类型为 `MARKDOWN`。没有映射的配置扩展必须在上传时拒绝，不能把原始扩展名写入持久化 record。

电信场景词汇扩展：`AttachmentMediaType` 在 `"WORD" | "EXCEL" | "PDF" | "MARKDOWN"` 基础上并列新增 `"PCAP" | "PCAPNG" | "CAP" | "TMF" | "PTMF" | "ZIP" | "TAR" | "RAR" | "GZ"`，覆盖信令分析（`.ptmf`/`.tmf`/`.pcap`/`.zip`/`.tar`/`.rar`）与数传分析（`.pcap`/`.pcapng`/`.cap`/`.tmf`/`.ptmf`/`.zip`/`.tar`/`.rar`/`.gz`）两个场景。扩展名提取只保留最后一段（`a.tar.gz` 命中 `.gz`），匹配大小写不敏感（`.PCAP` 归一为 `.pcap`）。intake 路径与 staged-upload 路径共享包内唯一映射实现 `attachmentMediaTypeForExtension`（未映射扩展返回 `undefined`；staged-upload 据此拒绝，intake 在调用点显式回退 `MARKDOWN`），同一文件经任一路径持久化得到同一 `mediaType`。

默认类型边界：平台除 markdown 外没有内置解析能力，因此无 config 兜底 `DEFAULT_FILE_TYPES` 保持 `["*.md", "*.markdown"]` markdown-only，电信/Office 扩展名不并入默认。`chat-upload-file-type` 为替换语义：配置非空数组时完全替代默认列表，前后端校验均以该配置为唯一权威；产品要支持 markdown 以外的类型（含保留 `*.md` 自身）必须显式写入配置。

理由：`mediaType` 表示平台支持的媒体语义，不是文件扩展名。保持共享词汇可让 attachment record、gateway 和前端以同一类型协作，并且不会妨碍 remote/local 通过不同 gateway 存储字节。

影响文件：
- `packages/agent-contracts/src/gateway/index.ts`：`RequestAttachmentRecord.mediaType` 保持 `AttachmentMediaType`。
- `packages/agent-contracts/src/attachment/index.ts`：`RequestAttachment.mediaType` 保持 `AttachmentMediaType`。
- `packages/agent-attachment-runtime/src/index.ts`：intake 和 staged upload 在持久化前把文件名映射为共享类型。Local 模式无 config 时仍默认 markdown-only。
- `packages/agent-context-engine/src/assembly/assemble-context.ts`：移除 `mediaType !== "MARKDOWN"` 检查（所有文件类型均被接受，model 通过 Read tool 自行读取）。
- `packages/agent-platform-gateway-local/src/db/sqlite-gateway-core.ts`：row 映射不变（已存 string）。

### D2: 配置文件与加载机制

配置文件位于 `agents/{agentId}/config/config.json`，与 `resource/` 目录平级。复用 `AgentPackageSourceLocator.locate(agentId)` 定位到 agent package root，然后 `join(agentPackageRoot, "config", "config.json")`。

配置 shape：

```json
{
  "chat-upload-file-config": {
    "hofs-bucket-name": "{bucketName}",
    "chat-upload-file-type": ["*.xlsx", "*.csv"],
    "chat-upload-max-file-number": 10,
    "chat-upload-max-file-size": 10,
    "upload-file-idle-expire-time": 5,
    "upload-file-max-expire-time": 30
  }
}
```

字段语义：
- `hofs-bucket-name`：产品提供的 HOFS 桶地址。为空则降级为 local 模式。
- `chat-upload-file-type`：产品需要支持的文件类型，glob pattern 数组。
- `chat-upload-max-file-number`：单对话最大文件数，默认 10，系统上限 200。
- `chat-upload-max-file-size`：单文件最大大小（单位 M），默认 10，系统上限 500。
- `upload-file-idle-expire-time`：最后一个文件上传后多久未发送问题则过期（单位 min），默认 5。
- `upload-file-max-expire-time`：第一个文件上传后多久未发送问题则过期（单位 min），默认 30。

配置校验规则（Cap + Warn 策略）：
- config.json 不存在 → 使用系统默认值，降级为 local 模式。
- `chat-upload-file-config` 缺失 → 使用系统默认值，降级为 local 模式。
- `hofs-bucket-name` 为空 → 降级为 local 模式。
- 字段缺失 → 使用对应默认值。
- 字段类型错误 → 使用默认值。
- 值超过系统上限 → 截断到系统上限。
- 值非法（0 或负数）→ 使用默认值。
- `file-type` 为空数组 → 默认 `["*.md"]`。
- `max-expire-time` < `idle-expire-time` → `max-expire-time = idle-expire-time`。
- 所有截断/默认值替换静默执行，不返回 notices。
- bootstrap API 只返回 effective config（校验后的实际生效值）。

默认 agent 的 config 当作全局系统配置。加载方式与 `CategoryQuestionCatalogSource` 类似：通过 `AgentPackageSourceLocator.locate(defaultAgentId)` 定位，读取 config.json，解析、校验、缓存。

### D3: bootstrap API 扩展

扩展 `/api/v1/runtime/bootstrap` 响应：

```typescript
interface WebRuntimeBootstrapConfig {
  readonly transportKind: WebTransportKind;
  readonly chatUploadFileConfig?: {
    readonly hofsBucketName: string;
    readonly chatUploadFileType: readonly string[];
    readonly chatUploadMaxFileNumber: number;
    readonly chatUploadMaxFileSize: number;
    readonly uploadFileIdleExpireTime: number;
    readonly uploadFileMaxExpireTime: number;
  };
}
```

`chatUploadFileConfig` 不存在时表示 local 模式（无 HOFS 配置）。前端根据 `hofsBucketName` 是否为空决定走两阶段还是同步 multipart。

### D4: 远端两阶段上传流程

#### 阶段 1：独立上传 endpoint

```
POST /api/v1/sessions/:sessionId/files/upload
Content-Type: multipart/form-data

FormData:
  - tempRunId: string (前端生成)
  - file: File (单个文件)
```

后端校验管道（从便宜到昂贵，短路退出）：

0. 全局并发限制 acquire（D26，4 并发槽，30 秒超时）
1. 文件名正则校验
2. 文件扩展名匹配 config `chat-upload-file-type`（D20 后缀匹配）
3. 单文件大小检查 ≤ min(config.max-file-size, 500) M（从 multipart header 预检 + 流式实时检查）
4. 上传频率检查（D7/D16，内存 Map，滑动窗口 1 小时，≤ 500 次）
5. per-session 累计检查（D22，fileCount ≤ min(config.max-file-number, 200)）
6. per-user 累计检查（D7，totalFileCount ≤ 200, totalFileSize ≤ 500MB）
7. 用户 tmp 配额检查（D7，tmpTotalSize ≤ 1024MB）+ 本地 upload-tmp 全局上限（D33，≤ 2048MB）
8. 流式写入本地临时文件（D33，实时大小检查, ENOSPC 防护）
9. 内容安全校验（D6/D25，magic bytes 交叉验证 + zip slip 防护 + zip 炸弹防护）
10. storeBlob 整体上传到 BlobStoreGateway temp path（D5/D33）
11. 删除本地临时文件（D33）
12. 全局并发限制 release（D26）

返回：
```json
{
  "tempRunId": "uuid-xxx",
  "fileName": "report.xlsx",
  "sizeBytes": 2500000
}
```

不返回存储路径。

#### 阶段 2：提交问题

```
POST /api/v1/sessions/:sessionId/requests
Content-Type: application/json

{
  "inputText": "分析这些文件",
  "idempotencyKey": "key-xxx",
  "attachments": [
    { "tempRunId": "uuid-xxx", "fileName": "report.xlsx" },
    { "tempRunId": "uuid-yyy", "fileName": "data.csv" }
  ]
}
```

后端流程：

1. `reserveSubmit()` → 获得 `requestId`, `runId`
2. 对每个 tempFile：
   - copyBlob: `tmp/{userId}/{tempRunId}/{fileName}` → `question/{sessionId}/{runId}/{fileName}`，然后 deleteBlob 源 temp 文件
   - copyBlob + deleteBlob 组合，fail-closed 语义
   - move 失败场景：文件不存在（已被 TTL 清理）、本地临时目录容量上限、formal 路径容量不够、BlobStoreGateway 接口异常
   - 任何文件 move 失败 → 整个请求失败，已 move 的文件不回滚（由 TTL 清理），返回友好错误
3. 创建 `RequestAttachmentRecord`（`storageRef` = gateway 返回的 opaque formal `BlobRef`，`mediaType` = 从文件名提取的扩展名）
4. 更新内存计数器（频率计数扣减，tmp 配额扣减，用户级累计增加）
5. `runtime.submit()` with `attachmentIds`

### D5: BlobStoreGateway 扩展

统一使用既有 `BlobStoreGateway` 作为文件存储 gateway，扩展而非新建。`BlobStoreGateway` 已存在于 `SqliteGatewayStoreBindings.blobs`，composition 通过既有 `gateway.blobs` 注入。Local 和 remote 各有实现，composition 负责按 deploymentMode 注入。Remote 实现在隔离环境中开发，打包时放入 `packages/` 目录。

#### 既有方法（保持不变）

```typescript
// agent-contracts/gateway

interface BlobStoreGateway {
  // 既有：存储 blob（StoreBlobRequest 变更见下文）
  storeBlob(request: StoreBlobRequest): Promise<StoreBlobResult>;

  // 既有：读取 blob（large-content preview-reader 仍使用，非附件内容读取）
  loadBlob(request: LoadBlobRequest): Promise<LoadBlobResult | undefined>;

  // 既有：检查 blob 是否存在
  blobExists(request: BlobExistsRequest): Promise<boolean>;

  // 既有：删除 blob（幂等，不存在返回 true）
  deleteBlob(request: DeleteBlobRequest): Promise<boolean>;

  // 新增方法见下文
  copyBlob(request: CopyBlobRequest): Promise<CopyBlobResult>;
  getBlobMetadata(request: BlobMetadataRequest): Promise<BlobMetadata | undefined>;
  listBlobs(request: ListBlobsRequest): Promise<ListBlobsResult>;
}
```

#### StoreBlobRequest 变更

`StoreBlobRequest` 的 `bytes: Uint8Array` 替换为 `localFilePath: string`。文件先 staged 在本地磁盘，再整体上传。

```typescript
interface StoreBlobRequest {
  readonly objectName: string;       // 完整路径
  readonly localFilePath: string;    // 服务器本地文件路径（文件已 staged 在本地磁盘）
  readonly contentType?: string;
  readonly metadata?: Record<string, string>;
}
```

#### 新增方法

```typescript
// 复制 blob（temp → formal move 的基础）
interface CopyBlobRequest {
  readonly sourceObject: string;
  readonly destinationObject: string;
}

interface CopyBlobResult {
  readonly etag: string;
  readonly lastModified: EpochMillis;
}

// 获取 blob 元数据（存在性 + 大小）
interface BlobMetadataRequest {
  readonly objectName: string;
}

interface BlobMetadata {
  readonly objectName: string;
  readonly contentLength: number;
  readonly lastModified: EpochMillis;
  readonly metadata?: Record<string, string>;
}

// 列举 blob（清理孤儿文件、启动扫描）
interface ListBlobsRequest {
  readonly prefix: string;
  readonly maxKeys?: number;          // 默认 100
}

interface ListBlobsResult {
  readonly objects: readonly {
    readonly objectName: string;
    readonly size: number;
  }[];
  readonly truncated: boolean;
  readonly nextMarker?: string;
}
```

#### BlobRef / storageRef 语义变更

`BlobRef` / `storageRef` 现在表示文件路径，不再是 SQLite blob ID：

| 模式 | storageRef 示例 | 说明 |
|------|----------------|------|
| Local | `attachments/{sessionId}/{runId}/{fileName}` | workspace-relative 路径，sandbox 可访问 |
| Remote formal | `question/{sessionId}/{runId}/{fileName}` | HOFS 路径 |
| Remote temp | `tmp/{userId}/{tempRunId}/{fileName}` | HOFS 临时路径 |

#### 调用方与实现方的职责划分

**调用方（NextAgent 后端）负责：**

- 构造完整的 `objectName` 路径，包含业务语义前缀，不包含存储后端的根路径标识（如 `/aicoservice/`）。
- 约定的路径模式：

  | 路径类型 | objectName 模式 | 示例 |
  |---------|----------------|------|
  | 临时文件（remote） | `tmp/{userId}/{tempRunId}/{fileName}` | `tmp/user123/abc-uuid/report.xlsx` |
  | 正式文件（remote） | `question/{sessionId}/{runId}/{fileName}` | `question/sess456/run789/report.xlsx` |
  | 正式文件（local） | `attachments/{sessionId}/{runId}/{fileName}` | `attachments/sess456/run789/report.md` |

- 传入的 `objectName` 就是完整路径，实现方不需要再拼接任何前缀。
- `listBlobs` 的 `prefix` 也是完整路径前缀，如 `tmp/{userId}/`。
- `copyBlob` 的 `sourceObject` 和 `destinationObject` 都是完整路径。

**实现方（remote adapter）负责：**

- 从 composition 注入的配置中获取存储后端标识（如 `bucketName`、`projectId`、根路径前缀 `/aicoservice/` 等）。
- 将调用方传入的 `objectName` 与存储后端标识拼接为底层存储服务的完整地址。
  - 例如：调用方传 `tmp/user123/abc-uuid/report.xlsx`，实现方拼成 `{bucketName}/aicoservice/tmp/user123/abc-uuid/report.xlsx` 调用底层 API。
- 实现方不得修改 `objectName` 的路径结构，不得截断、重命名或追加业务前缀。
- 实现方负责底层存储服务的认证、连接、重试、错误映射和 safe error 生成。
- `deleteBlob` 必须幂等：文件不存在时返回 `true`，不抛异常。

**Local 实现负责：**

- 将 bytes 持久化在 SQLite blob store，`storageRef` 为不透明的 `BlobRef`（例如 `blob-*`），不是 workspace 路径。
- `copyBlob` 返回目标 blob 的新 opaque ref；`deleteBlob`、`listBlobs`、`getBlobMetadata` 仅操作该持久化 blob。
- `materializeBlob` 将持久化 bytes 导出到 runtime 指定的 run-scoped 临时文件；该临时文件不是持久化存储。
- `loadBlob` 仅保留给 large-content preview-reader 等非附件执行路径使用。

**Remote 实现：**

- 在隔离环境中开发，实现底层存储服务（HOFS）的 API 调用。打包时放入 `packages/` 目录，composition 按 deploymentMode 注入。
- 实现方从 composition 注入的配置中获取 `bucketName` 等存储后端标识，与调用方传入的 `objectName` 拼接为底层存储完整地址。

各方法在远端上传流程中的用途：

| 方法 | objectName 示例 | 调用时机 |
|------|----------------|----------|
| `storeBlob` | `tmp/{userId}/{tempRunId}/{fileName}` | 阶段 1，本地校验通过后 |
| `getBlobMetadata` | `tmp/{userId}/{tempRunId}/{fileName}` | 阶段 2 move 前确认 temp 文件存在 |
| `copyBlob` | source: `tmp/{userId}/{tempRunId}/{fileName}` → dest: `question/{sessionId}/{runId}/{fileName}` | 阶段 2，每个 tempFile 执行一次 |
| `deleteBlob` | `tmp/{userId}/{tempRunId}/{fileName}` 或 `question/{sessionId}/{runId}/{fileName}` | D15 用户删除 temp / D24 cleanup 删 formal / D4 move 后删 temp |
| `listBlobs` | prefix: `tmp/{userId}/` | D33 启动扫描 / 定期清理 |

阶段 2 的 move 操作 = `copyBlob` + `deleteBlob`（源 temp 文件）。copy 成功后删除 temp，如果 delete 失败不阻塞（孤儿 temp 由 TTL 清理）。

### D6: 文件内容安全校验独立模块

新增独立模块 `file-content-validator`（位于 `agent-attachment-runtime`），未来可能演进为独立 package。

#### 6a: Magic bytes 交叉验证

检测文件实际 magic bytes 与声明的扩展名是否匹配：

| 扩展名 | Magic bytes | 格式 |
|--------|------------|------|
| .xlsx/.docx/.pptx/.zip | PK\x03\x04 | ZIP/OOXML |
| .pdf | %PDF | PDF |
| .csv/.md | 可读文本 | 纯文本 |

不匹配 → REJECT。

#### 6b: Zip 炸弹防护

仅对 ZIP-based 文件（magic bytes 为 `PK\x03\x04`）执行：
- 读 ZIP Central Directory，累加所有条目的 `uncompressedSize`
- 总解压大小 > 512MB → REJECT
- 只读 header，不解压实际内容
- 不查压缩比、条目数、嵌套归档

### D7: 用户级计数器

内存 Map，key 为 `userId`，value 为：

```typescript
interface UserUploadQuota {
  totalFileCount: number;       // 所有 session 文件总和
  totalFileSize: number;        // 所有 session 文件总大小 (bytes)
  tmpTotalSize: number;         // tmp 未提交文件总大小 (bytes)
  uploadTimestamps: number[];   // 未发送上传的时间戳滑动窗口
}
```

生命周期：
- LRU 淘汰，上限 10000 用户
- 不主动清零
- 阶段 1 上传时：`uploadTimestamps.push(now)`, `tmpTotalSize += sizeBytes`
- 阶段 2 提交时：`uploadTimestamps` 对应次数扣减, `tmpTotalSize -= fileSizes`, `totalFileCount += fileCount`, `totalFileSize += totalSize`
- 滑动窗口：每次检查时过滤掉 1 小时前的时间戳

### D8: Context Engine 适配

`DefaultContextEngineDependencies` 不再需要 `deploymentMode` — 附件分支不再按模式分流。

所有模式下 `collectAttachmentEvidence` 行为统一变更：
- 仍查询 `attachmentStore.listAttachmentsByRequestId` 获取 attachment 列表
- 仍分类 attachment decision（critical/optional/historical/excluded）
- `readAttachmentContentBlock()` 在所有模式下直接返回 null（不调 blobStore，不读附件内容）
- `attachmentContentBlocks = []` 始终为空
- `AttachmentContextEvidence` 新增 `fileName`、`mediaType`、`sizeBytes` 字段

`renderAttachmentDisclosure` 在所有模式下渲染文件元数据列表：

```
### Attachment context
- report.xlsx (xlsx, 2.5MB)
- data.csv (csv, 500KB)
```

Model 通过此元数据列表知道有哪些文件，然后通过 Read/workspace-files 工具自行读取文件内容。

`assemble-context.ts` 中的 `mediaType !== "MARKDOWN"` 检查被移除 — 所有文件类型均被接受，model 通过 Read tool 自行读取。

注意：`blobStore.loadBlob` 仍被 large-content preview-reader 用于 tool result 预览（非附件内容读取），此用途不变。仅附件内容读取被移除。

### D9: Skill 执行上下文注入

Runtime 在 tool loop 启动前：

1. 查询当前 request 的全部 attachments（`attachmentStore.listAttachmentsByRequestId`）
2. 组装 `attachmentRefs`，其中 `storageRef` 只作为 gateway 输入，不是文件路径：

```typescript
interface AttachmentRef {
  readonly attachmentId: AttachmentId;
  readonly fileName: string;
  readonly mediaType: AttachmentMediaType;
  readonly sizeBytes: number;
  readonly storageRef: string;  // opaque BlobRef, 非 model 可见
}

interface ToolExecutionContext {
  // ... 既有字段
  readonly attachmentRefs?: readonly AttachmentRef[];
}
```

3. 用 `BlobStoreGateway.materializeBlob` 将每个 ref 导出到 run-scoped `temp/attachments`。
4. 注入 `ToolExecutionContext.attachmentRefs` 和 `ToolExecutionContext.attachmentPaths`。

```typescript
interface ToolExecutionContext {
  // ... 既有字段
  readonly attachmentRefs?: readonly AttachmentRef[];
  readonly attachmentPaths?: readonly string[];  // materialized 文件路径数组, 非 model 可见
}
```

产品 Skill API 在 tool 执行时从 `context.attachmentPaths` 同步读取全量 materialized 路径数组。Sandbox 环境变量 `FILE_PATHS`（JSON 数组）由 `attachmentPaths` 注入。两条通路对所有存储实现统一生效。

`attachmentRefs`、`storageRef` 和 `attachmentPaths` 不出现在 model input、tool call args、stream payload 或 safe error 中。

### D10: 前端展示

#### 输入框 chip 列表

参考 `SelectedSkillChip` 组件样式，新增文件 chip 组件：
- 横向排列，每个 chip 显示文件名和删除按钮
- 文件多时区域可横向滚动（鼠标滚轮）
- chip 不同于 skill chip 的是带文件类型图标

#### 对话面板文件列表

在用户问题消息上方展示文件列表（只读）：
- 从 `RequestState.attachments` 读取 `AttachmentRef[]`
- 横向排列文件名，不可点击/下载
- 历史会话还原时从 conversation API 返回的 message 中读取 attachment 列表

#### 上传行为切换

前端根据 bootstrap API 返回的 `chatUploadFileConfig.hofsBucketName`：
- 选文件即调 `/api/v1/sessions/:sessionId/files/upload`，发送问题时带 `attachments`
- 为空 → 同步模式：选文件后暂存前端，发送问题时走 multipart/form-data

#### 上传计时提醒

前端根据 `uploadFileIdleExpireTime` 和 `uploadFileMaxExpireTime` 做 UI 计时：
- 第一个文件上传后启动 max-expire 计时
- 每次文件上传后重置 idle-expire 计时
- 到期前展示提醒："文件即将过期，请尽快发送问题"
- 到期后提示："文件已过期，请重新上传"

### D11: Conversation API 返回 attachment 列表

conversation API 返回的 message 中需要包含 attachment safe summary。`RequestAttachmentRecord` 已有 `fileName`、`mediaType`、`sizeBytes`，在 conversation projection 中加入 safe attachment summary（不含 `storageRef`）。

## 数据流（Data Flow）

### Remote 模式完整数据流

```
用户选文件
  │
  ├─ Frontend 生成 tempRunId
  ├─ POST /api/v1/sessions/:sessionId/files/upload (multipart, single file)
  │
  ▼
Backend 阶段 1 校验管道
  ├─ 0. 全局并发 acquire (4 槽, 30s 超时)
  ├─ 1. 文件名正则
  ├─ 2. 扩展名匹配 config (D20 后缀匹配)
  ├─ 3. 单文件大小 (header 预检 + 流式实时检查)
  ├─ 4. 上传频率 (per-user 滑动窗口)
  ├─ 5. per-session 累计 (config 限制)
  ├─ 6. per-user 累计 (系统硬上限 200/500MB)
  ├─ 7. tmp 配额 (per-user 1024MB + 全局 2048MB)
  ├─ 8. 流式写入本地临时文件 (ENOSPC 防护)
  ├─ 9. 内容安全校验 (magic bytes + zip slip + zip 炸弹)
  ├─ 10. storeBlob 上传到 BlobStoreGateway
  ├─ 11. 删除本地临时文件
  └─ 12. 全局并发 release
  │
  ▼
返回 { tempRunId, fileName, sizeBytes }
  │
用户发送问题
  │
  ├─ POST /api/v1/sessions/:sessionId/requests (JSON, attachments)
  │
  ▼
Backend 阶段 2
  ├─ reserveSubmit() → requestId, runId
  ├─ copyBlob + deleteBlob temp → formal (fail-closed)
  ├─ 创建 RequestAttachmentRecord (storageRef = gateway 返回的 opaque formal BlobRef)
  ├─ 更新内存计数器
  └─ runtime.submit() with attachmentIds
  │
  ▼
Runtime 执行
  ├─ Context Engine
  │   ├─ collectAttachmentEvidence (metadata only, 不读内容)
  │   ├─ attachmentContentBlocks = []
  │   └─ renderAttachmentDisclosure (fileName, type, size)
  │
  ├─ Model 看到: "report.xlsx (xlsx, 2.5MB), data.csv (csv, 500KB)"
  ├─ Model 调用 Skill({ name: "data-analysis" })
  │
  ▼
Tool loop
  ├─ Runtime 预解析 attachments → attachmentRefs
  ├─ materialize 到 run-scoped temp/attachments
  ├─ 注入 ToolExecutionContext.attachmentPaths
  ├─ FILE_PATHS = [materialized 文件路径数组]
  │
  ▼
Skill tool execute
  ├─ 从 context.attachmentPaths / process.env.FILE_PATHS 读取文件路径
  ├─ 调用产品 Skill API (file_list = [文件路径])
  └─ 产品 API 从存储拉取 + 解析 + 消费
```

### Local 存储实现数据流

```
用户选文件
  │
  ├─ POST /api/v1/sessions/:sessionId/files/upload (multipart, single file)
  │
  ▼
Backend staged upload
  ├─ validateInputFile (config 驱动类型)
  ├─ storeBlob 写入 SQLite blob store (BlobStoreGateway, localFilePath)
  ├─ storageRef = opaque BlobRef
  ├─ mediaType = 文件扩展名
  └─ 创建 RequestAttachmentRecord
  │
  ▼
Runtime 执行
  ├─ Context Engine
  │   ├─ collectAttachmentEvidence (metadata only, 不读内容)
  │   ├─ attachmentContentBlocks = []
  │   └─ renderAttachmentDisclosure (fileName, type, size)
  │
  ├─ Model 看到: "report.md (md, 10KB)"
  ├─ Model 调用 Skill；不读取附件正文
  │
  ▼
Tool loop
  ├─ Runtime 预解析 attachments → attachmentRefs
  ├─ materialize 到 run-scoped temp/attachments
  ├─ 注入 ToolExecutionContext.attachmentPaths
  ├─ FILE_PATHS = [materialized paths]
  └─ Sandbox 通过 FILE_PATHS 访问该临时视图
```

## 风险和缓解（Risks）

- **`BlobStoreGateway` remote 实现待隔离环境提供**：contract 已扩展，不影响本 change 的实现框架。
- **内存 Map 重启丢失**：计数器重启后归零。作为防攻击措施可接受 — 攻击者最多在重启窗口内多上传一些文件，但 TTL 和单文件大小限制仍然生效。
- **mediaType 词汇影响面**：`mediaType` 保持 `AttachmentMediaType` 这一 frozen contract。已确认所有使用点：行为层不再检查 `"MARKDOWN"`，上传 runtime 在持久化前完成扩展映射，影响可控。
- **StoreBlobRequest 变更影响面**：`StoreBlobRequest.bytes` 改为 `localFilePath` 是既有 contract 变更。需确认所有 `storeBlob` 调用点已适配。
- **conversation API 变更**：需要在 conversation projection 中新增 attachment summary。需确认不影响已有分页/游标逻辑。

## 补充设计决策（Supplementary Decisions）

### D12: Edit latest 在 remote 模式下只允许修改文字

`POST /api/v1/sessions/:sessionId/requests/latest/edit` 只接受 JSON body（`editedInputText`、`expectedLatestRequestId`、`idempotencyKey`），不接受 staged `attachments`。用户编辑最新请求时不能增减或替换附件，只能修改文字内容。原请求的 `attachmentIds` 保持不变。

Local 模式下 edit latest 行为不变（仍支持 multipart 带文件）。

理由：edit latest 的语义是对最新请求做文字修正后重新执行。如果允许改附件，需要处理 temp→formal move、旧 formal 文件清理、attachmentIds 增减等复杂场景。第一版不支持，后续按需添加。

### D13: Retry latest 在 remote 模式下自然工作

Retry latest 读取持久化的 `attachmentIds`，对应的 `RequestAttachmentRecord.storageRef`（formal path）已持久化。remote 模式下 retry 不需要重新上传文件或 move 文件，直接复用已有的 `storageRef`。Runtime 预解析 `attachmentRefs` 时从 `attachmentStore` 查询到的 record 自带 `storageRef`，自然注入 `ToolExecutionContext`。

不需要额外开发，但需要测试覆盖确认。

### D14: Conversation API attachment 列表覆盖范围

三个 conversation endpoint 的 attachment 列表覆盖范围：

| Endpoint | 用途 | 需要 attachment 列表 |
|----------|------|---------------------|
| `GET /api/v1/sessions/:sessionId/conversation` | 完整会话历史（分页），用户打开对话后看到完整消息 | 是 |
| `GET /api/v1/shares/:shareId/conversation` | 分享会话，通过分享链接查看 | 是 |
| `GET /api/v1/sessions/:sessionId/conversation/preview` | 会话列表侧边栏摘要，只返回 `previewText` 等轻量字段 | 否 |

完整会话历史和分享会话返回的 message 中需要包含 attachment safe summary（`fileName`、`mediaType`、`sizeBytes`，不含 `storageRef`）。会话预览不返回 attachment 列表。

### D15: 删除 temp 文件需要调后端接口

用户在输入框 chip 上点删除按钮时，前端必须调用后端接口删除 temp 文件：

```
DELETE /api/v1/sessions/:sessionId/files/tmp/{tempRunId}/{fileName}
```

后端流程：
1. 删除 temp 文件：调 `BlobStoreGateway.deleteBlob({ objectName: "tmp/{userId}/{tempRunId}/{fileName}" })`
2. 更新内存计数器：`tmpTotalSize -= sizeBytes`，`uploadTimestamps` 移除对应时间戳
3. 返回 204 No Content

如果删除失败（文件已被 TTL 清理等），后端仍更新内存计数器并返回成功（幂等删除语义）。

前端删除后从 chip 列表中移除该文件，不影响其他已上传文件。

### D16: 频率计数扣减机制

阶段 2 提交 N 个文件时，从 `uploadTimestamps` 滑动窗口中移除 N 个最旧的时间戳。

```typescript
// 阶段 1 上传时
uploadTimestamps.push(Date.now());

// 阶段 2 提交 N 个文件时
uploadTimestamps.splice(0, N);  // 移除最旧的 N 个

// 阶段 1 删除 temp 文件时
uploadTimestamps.shift();  // 移除最旧的 1 个

// 频率检查时
const oneHourAgo = Date.now() - 60 * 60 * 1000;
uploadTimestamps = uploadTimestamps.filter(ts => ts > oneHourAgo);
if (uploadTimestamps.length >= 500) → REJECT
```

### D17: 前端文件选择器 accept 属性由 config 驱动

前端根据 bootstrap API 返回的 `chatUploadFileConfig.chatUploadFileType` 设置 `<input type="file" accept="...">`。

- config 返回 `["*.xlsx", "*.csv"]` → `accept=".xlsx,.csv"`
- config 返回 `["*.md"]` → `accept=".md,.markdown"`
- local 模式（无 config） → `accept=".md,.markdown"`（硬编码）

前端同时在选文件后做 JS 层校验，不合规直接提示，不发送到后端。JS 层校验同样由 config 驱动：扩展名白名单取 `chatUploadFileType`（经 `deriveAcceptedExtensions` 归一，无效项静默忽略，无 config 时回退 markdown-only 默认），大小上限取 `chatUploadMaxFileSize`，数量上限取 `chatUploadMaxFileNumber`；提示文案参数化展示当前生效的类型列表与大小上限，不写死默认值。

### D18: tempRunId 在一次对话内可关联多个文件

同一个 `tempRunId` 可以跨多次 phase 1 调用上传多个文件。`tempRunId` 由前端在一次对话的文件上传会话中生成一次，后续每次上传文件都使用同一个 `tempRunId`。

Temp 路径 `tmp/{userId}/{tempRunId}/{fileName}` 天然支持同一 `tempRunId` 下多个文件。

阶段 2 提交时，`attachments` 数组中的多个文件可以共享同一个 `tempRunId`（也可以不同，取决于前端实现），后端按 `{ tempRunId, fileName }` 逐个 finalize。

### D19: 前端 AttachmentRef.mediaType 保持共享词汇

前端 `frontend/agent-web/src/state/contracts.ts` 中 `AttachmentRef.mediaType` 保持 `AttachmentMediaType`（`"WORD" | "EXCEL" | "PDF" | "MARKDOWN" | "PCAP" | "PCAPNG" | "CAP" | "TMF" | "PTMF" | "ZIP" | "TAR" | "RAR" | "GZ"`），与后端 `RequestAttachmentRecord.mediaType` 一致。前端 `deriveAttachmentMediaType` 与后端映射表镜像，同一文件名在 chip 乐观展示与持久化 record 中得到同一值。

### D20: config glob pattern 匹配方式

config `chat-upload-file-type` 使用 glob pattern（如 `["*.xlsx", "*.csv"]`）。后端校验时采用简单后缀匹配：从 pattern 中提取扩展名（去掉 `*` 前缀得到 `.xlsx`），然后检查文件名是否以该扩展名结尾（大小写不敏感）。

不引入 `minimatch` 等重量级 glob 库。config 中的 pattern 仅支持 `*.ext` 形式，不支持 `**`、`?`、字符集等复杂 glob 语法。如果 config 中出现不支持的 pattern 格式，静默忽略该项。

前端 `accept` 属性直接使用 config 中的 pattern 转换：`["*.xlsx", "*.csv"]` → `accept=".xlsx,.csv"`。

### D21: move 失败不回滚，孤儿文件由 TTL 清理

阶段 2 move 操作失败时，采用方案 C：不回滚已 move 到 formal 路径的文件。已 move 的文件成为孤儿文件，由 TTL 配置自动清理。

理由：
- 回滚需要额外的 BlobStoreGateway 删除或反向 copy 操作，增加复杂度和失败概率
- TTL 已经是过期清理的兜底机制，孤儿文件不会永久占用空间
- fail-closed 语义仍然保证：整个请求失败，不创建 `RequestAttachmentRecord`，不进入 runtime

`BlobStoreGateway` 不需要回滚方法。

### D22: 双层文件计数器（per-session + per-user）

系统需要两层文件计数器：

**per-session 计数器**（执行 config 限制）：
- key: `sessionId`
- value: `{ fileCount: number, totalSize: number }`
- 检查: `fileCount + 1 > min(config.chat-upload-max-file-number, 200)` → 拒绝
- 生命周期: session 结束时清理（或 LRU 淘汰）

**per-user 计数器**（执行系统硬上限，D7 已定义）：
- key: `userId`
- value: `{ totalFileCount, totalFileSize, tmpTotalSize, uploadTimestamps }`
- 检查: `totalFileCount + 1 > 200` 或 `totalFileSize + sizeBytes > 500MB` → 拒绝
- 生命周期: LRU 淘汰，上限 10000 用户

阶段 1 上传时两个计数器都检查，任一超限即拒绝。阶段 2 提交时两个计数器都更新（per-session fileCount/totalSize 增加，per-user totalFileCount/totalFileSize 增加，tmpTotalSize 扣减，频率计数扣减）。

### D23: BlobStoreGateway 的删除和复制能力在流程中的使用

D5 定义的 `BlobStoreGateway` 扩展已包含 `deleteBlob`（幂等）和 `copyBlob` 方法，无需额外补充。

使用方式：
- D15 用户删除 temp 文件：调 `deleteBlob({ objectName: "tmp/{userId}/{tempRunId}/{fileName}" })`
- D24 cleanup runtime 删除 formal 文件：调 `deleteBlob`。Local 模式 objectName 为 `attachments/{sessionId}/{runId}/{fileName}`，remote 模式为 `question/{sessionId}/{runId}/{fileName}`。
- D4 阶段 2 temp → formal move：调 `copyBlob({ sourceObject: "tmp/{userId}/{tempRunId}/{fileName}", destinationObject: "question/{sessionId}/{runId}/{fileName}" })` + `deleteBlob({ objectName: "tmp/{userId}/{tempRunId}/{fileName}" })`。copy 成功后删除 temp，如果 delete 失败不阻塞（孤儿 temp 由 TTL 清理）。

### D24: Cleanup runtime 使用 BlobStoreGateway 删除 formal 文件

当前 cleanup runtime（`agent-attachment-runtime/src/cleanup.ts`）通过 `blobStore.deleteBlob()` 删除 blob（`blobStore` 属于 `SqliteGatewayStoreBindings`，`attachments` 属于 `WorkingMemoryGatewayBindings`，`AppGatewayStores` 是三者的交集，composition 注入路径不变）。

统一后两种模式都使用 `BlobStoreGateway.deleteBlob()` 删除 formal 文件，无需 deploymentMode 分流：

1. Local 模式：`deleteBlob({ objectName: "attachments/{sessionId}/{runId}/{fileName}" })`，删除 workspace 中的文件
2. Remote 模式：`deleteBlob({ objectName: "question/{sessionId}/{runId}/{fileName}" })`，删除远端存储中的文件
3. `AttachmentCleanupDependencies` 不新增 `fileStoreGateway` 和 `deploymentMode`，复用既有 `blobStore`
4. 移除 `cleanupTargetRemote` 方法，统一使用 `cleanupTarget`

Composition 使用既有 `gateway.blobs`（`SqliteGatewayStoreBindings.blobs`）为两种模式注入 BlobStoreGateway。Remote BlobStoreGateway 实现由隔离环境提供，打包时放入 `packages/` 目录。

## 安全设计补充（Security Decisions）

### D25: Zip Slip 防护（压缩包跨目录校验）

在读取 ZIP Central Directory 条目时，必须检查每个条目的 `fileName` 是否包含路径穿越字符。如果任何条目的 fileName 包含 `..` 或以 `/` 开头（绝对路径），整个文件必须被拒绝。

检查规则：
- 条目 fileName 包含 `../` → REJECT
- 条目 fileName 以 `/` 开头（绝对路径） → REJECT
- 条目 fileName 包含 `..` 且 `path.resolve` 后逃逸出目标目录 → REJECT

这个检查在 D6b 的 zip 炸弹防护之前执行，因为路径检查只读条目名字符串，比读 `uncompressedSize` 更轻量。

满足 D-IAM-41-5 要求："压缩包解压前需校验路径、类型、大小"。

### D26: 全局上传并发限制（4 个并发槽）

系统必须实现全局上传并发信号量，限制同时处理的 phase 1 上传请求数为 4。这个限制对所有用户共享。

实现方式：
- 全局信号量（Semaphore），初始值为 4
- 请求到达时 `acquire()`，处理完成后 `release()`
- 如果 4 个槽都被占用，新请求等待（返回 202 或排队），不直接拒绝
- 等待超时（如 30 秒）后返回 503 "上传服务繁忙，请稍后重试"

并发限制在所有校验之前执行，确保不会因为校验计算而占满事件循环。

### D27: 流式上传替代 buffer 全量读取

Phase 1 上传 endpoint 使用流式 multipart 解析替代当前 `parseAs: "buffer"` 全量读取。

当前方式（local 模式，不变）：
```
Fastify parseAs:"buffer" → 整个文件进内存 → 校验 → 写 blob
```

新方式（remote 模式 phase 1，结合 D33 本地中转）：
```
Fastify 流式解析 multipart
  → 边读边流到本地临时文件 (实时检查大小)
  → 本地文件完整后:
    a. 读回文件 header (前几 KB) 做 magic bytes 交叉验证
    b. 如果是 ZIP-based, 读 Central Directory 做 zip 炸弹 + zip slip 校验
    c. 校验失败 → 删除本地临时文件 → 返回错误
    d. 校验通过 → storeBlob 整体上传到 BlobStoreGateway → 删除本地临时文件 → 返回 { tempRunId, fileName, sizeBytes }
```

内存占用：每个上传只缓冲几 KB（header 部分），4 并发只需几十 KB。

文件大小控制：
- Fastify bodyLimit 或流式解析中的 `dataLength` 事件实时检查
- 超过 `min(config.chat-upload-max-file-size, 500) M` 时立即中止流，删除已写入的 temp 文件
- 不依赖事后检查，防止"通过分片上传绕过文件大小限制"（即使不支持分片上传，流式检查也确保大文件在写入过程中被截断）

文件名校验在流开始之前执行（从 multipart header 中提取 fileName）。

### D28: try-catch-finally 临时文件清理

Phase 1 上传校验管道使用 try-catch-finally 确保 temp 文件在以下场景被清理：
- 校验失败（magic bytes 不匹配、zip 炸弹、zip slip 等）→ 删除已写入的 temp 文件
- 更新内存计数器失败 → 删除 temp 文件
- 任何未捕获异常 → 删除 temp 文件
- BlobStoreGateway 上传成功但后续步骤失败 → 删除 temp 文件

D28 的 try-catch-finally 逻辑已被 D33 的代码示例完整覆盖（同时清理本地临时文件和远端 temp 文件）。D28 定义清理原则，D33 提供完整代码示例。

满足要求："try-catch-finally 中必须清理"和"导入失败后未删除解压的超大临时文件"。

### D29: 上传操作审计日志（成功 + 失败）

每次上传操作（phase 1 上传、phase 2 move、temp 文件删除）必须记录审计日志。

审计日志字段（全部 safe，不含存储路径）：
- `userId` / `tenantId` / `subjectId`
- `sessionId`
- `operation`: `UPLOAD_TEMP` | `MOVE_TO_FORMAL` | `DELETE_TEMP`
- `result`: `SUCCESS` | `FAILURE`
- `fileName`（原始文件名）
- `sizeBytes`
- `reasonCode`（失败时）
- `timestamp`
- `tempRunId`（上传和删除时）

审计日志通过既有 `outcomeObserver` + `diagnosticLogger` 机制写入，与当前 intake runtime 的 `AttachmentIntakeOutcomeObservation` 模式一致。同时，main 分支已新增 `AuditEventStoreGateway`（位于 `SqliteGatewayStoreBindings`），审计日志 SHOULD 通过该 gateway 持久化，以便后续查询和合规审计。

新 endpoint 在 `WebChannelDependencies` 中注入审计 observer。

### D30: 路径穿越防护显式声明

路径构建时必须使用规范路径比较，确保 `{tempRunId}` 和 `{fileName}` 参数不会逃逸到目标目录之外：

- 文件名正则已过滤 `..` 和路径分隔符
- tempRunId 使用 UUID 格式校验
- 路径构建使用 `path.join(baseDir, userId, tempRunId, fileName)` 后做 `path.resolve()`
- 校验 `path.resolve()` 结果是否仍在 `baseDir/{userId}/` 之下
- 如果路径逃逸 → REJECT

满足 D-IAM-41-4 要求："文件类型、大小、路径必须在服务端校验"。

### D31: 不支持分片上传

Phase 1 上传 endpoint 只接受单个完整文件的 multipart 请求。不支持分片上传（chunked upload）。文件大小通过流式解析中的实时 `dataLength` 检查控制，无法通过分片绕过大小限制。

如果未来需要支持大文件分片上传，需要单独的 OpenSpec change。

### D32: Materialized attachmentPaths 和 FILE_PATHS 传递给产品 Skill API

Runtime 先通过 gateway materialize 每个 opaque `storageRef` 到可信 run-scoped `temp/attachments`，再通过两条通路传递结果：

- `ToolExecutionContext.attachmentPaths` 是 materialized 文件路径数组；单文件也使用数组。
- sandbox 的 `FILE_PATHS` 是同一数组的 JSON 字符串。

没有附件时，这两个字段都不得存在。系统组装的路径不经过 model tool-call args；`storageRef` 从不作为路径传递。

### D33: 本地临时文件中转上传（gateway storeBlob 非流式）

所有存储实现都先将 HTTP upload 流写入受控 upload-temp 目录，校验后通过 `storeBlob` 写入其持久化 backend。local 的持久化 backend 是 SQLite blob；执行 workspace 只在 tool 前作为 materialization 视图使用。

#### 流程（remote 模式）

```
客户端流式上传
  → 写到服务器本地磁盘临时文件 (实时检查大小)
  → 本地文件完整后:
    a. 读 header (前几 KB) 做 magic bytes 交叉验证
    b. 如果是 ZIP-based, 读 Central Directory 做 zip 炸弹 + zip slip 校验
    c. 校验失败 → 删除本地临时文件 → 返回错误
    d. 校验通过 → storeBlob 整体上传到 BlobStoreGateway (非流式, 一个完整请求)
    e. BlobStoreGateway 上传成功 → 删除本地临时文件
    f. BlobStoreGateway 上传失败 → 删除本地临时文件 → 返回错误
```

内存占用：每个上传只缓冲几 KB（header 部分），4 并发只需几十 KB。文件在磁盘上中转，不进内存。

#### 本地临时文件路径

路径：`{workspaceRoot}/data/system/upload-tmp/{userId}/{tempRunId}/{fileName}`

- 位于 `systemDataDir` 下，在 `AppRuntimePaths` 的安全路径验证范围内
- 不与 sandbox execution 的 temp 目录混淆
- 路径构建使用 `path.resolve()` + 规范路径比较，防止路径穿越

#### 磁盘空间防护

两层防护：

**写入失败检查**：流式写入本地临时文件时，如果磁盘写入失败（`ENOSPC`），立即中止流，删除部分写入的文件，返回友好错误 "服务器存储空间不足，请稍后重试"。

**全局上限**：维护内存计数器跟踪 `upload-tmp/` 目录下所有文件总大小。如果超过系统上限 2048MB（为 4 并发 × 500MB 预留），拒绝新上传。这个计数器与 D7 的用户级计数器分离，是全局的。

#### 清理机制

三层清理：

1. **正常流程**：storeBlob 上传到 BlobStoreGateway 成功后立即删除本地临时文件（try-catch-finally 保证）
2. **启动扫描**：服务启动时扫描 `upload-tmp/` 目录，清理所有残留文件
3. **定期清理**：复用现有 cleanup job 模式（`execution-cleanup-jobs.ts`），定期清理超过 1 小时的孤儿文件

`AppRuntimePaths.uploadTempDir` 和三层清理只适用于 remote 模式的本地临时中转。Local 模式不需要本地临时中转。

#### try-catch-finally 更新

D28 的 try-catch-finally 需要同时清理本地临时文件和远端 temp 文件：

```typescript
let localTempPath: string | undefined;
let remoteTempWritten: boolean = false;
try {
  // 1. 流式写入本地临时文件 (实时检查大小)
  localTempPath = await writeLocalTempFile(stream, userId, tempRunId, fileName, maxSize);
  // 2. 校验 header (magic bytes + zip 炸弹 + zip slip)
  await validateFileContent(localTempPath, fileName);
  // 3. storeBlob 整体上传到 BlobStoreGateway
  await blobStoreGateway.storeBlob({ objectName: `tmp/${userId}/${tempRunId}/${fileName}`, localFilePath: localTempPath });
  remoteTempWritten = true;
  // 4. 更新内存计数器
  updateQuotas(userId, sizeBytes);
} catch (error) {
  // 清理本地临时文件
  if (localTempPath !== undefined) {
    await deleteLocalTempFile(localTempPath).catch(() => {});
  }
  // BlobStoreGateway 上传成功但后续步骤失败时清理远端 temp
  if (remoteTempWritten) {
    await blobStoreGateway.deleteBlob({ objectName: `tmp/${userId}/${tempRunId}/${fileName}` }).catch(() => {});
  }
  throw error;
} finally {
  // 正常流程: BlobStoreGateway 上传成功后删除本地临时文件
  if (localTempPath !== undefined && remoteTempWritten) {
    await deleteLocalTempFile(localTempPath).catch(() => {});
  }
}
```

#### 对 D27 的影响

D27 "流式上传替代 buffer 全量读取"仍然有效，但流式写入的目标从远端 temp path 改为先写入本地临时文件。内存防护仍然有效（流到磁盘，不进内存）。实时大小检查仍然有效（流式过程中检查）。BlobStoreGateway 从"接收流"改为"接收完整文件"（storeBlob 接收 localFilePath，内部读取完整文件上传）。

#### 对 AppRuntimePaths 的影响

`AppRuntimePaths` 新增 `uploadTempDir: string` 字段，值为 `{systemDataDir}/upload-tmp`。路径校验逻辑需要覆盖这个新目录。仅 remote 模式使用。

### D35: 存储无关的暂存附件生命周期

Web channel 对所有部署模式只暴露一个协议：单文件暂存上传、删除暂存文件、JSON submit 携带 `attachments: [{ tempRunId, fileName }]`。`agent-attachment-runtime` 负责校验、配额、暂存和最终化；Web channel 不得根据 HOFS 配置走 submit multipart 分支。

local 与 remote 仅在 `BlobStoreGateway` 的实现中不同。local 的持久化字节属于 gateway 管理的 SQLite/blob data area，不能使用 execution workspace；workspace 只是受授权 tool execution 的临时工作视图。

`BlobRef` 是 opaque storage handle。`copyBlob` 必须返回最终 destination 的 `BlobRef`，最终化服务必须将该返回值保存到 `RequestAttachmentRecord.storageRef`，不得自行把 `tmp/...` 或 `question/...` 逻辑对象名写入 record。远端 gateway 可以将对象键实现为 BlobRef；local gateway 可以返回随机或内容寻址 ID。

### D36: 执行期附件 materialization

`storageRef` 只标识持久化 blob，不能作为文件路径传给 model、tool args、sandbox 或产品 Skill API。runtime 在 tool loop 前提供可信 owner/agent/request/run 坐标及 `ExecutionWorkspaceResolver` 的 run-scoped `temp` root；`agent-attachment-runtime` 构造 `temp/attachments/{attachmentId}/{safeFileName}` 目标并调用 `BlobStoreGateway.materializeBlob` 流式写入目标文件。

local gateway 从 gateway-managed filesystem blob area 导出，remote gateway 从 HOFS 或其他 blob backend 导出。两者对 runtime 返回相同的 materialized execution paths。runtime 将这些路径放入非 model-visible `ToolExecutionContext.attachmentPaths` 与 sandbox `FILE_PATHS`；`agent-attachment-runtime` 在 run terminal 后删除该 `temp/attachments` 视图。

### D37: local attachment bytes use a filesystem blob gateway

LOCAL product composition MUST bind `BlobStoreGateway` to a gateway-managed filesystem root under `{systemDataDir}/blobs`. SQLite remains the owner of attachment records, reservations, and other structured runtime facts, but MUST NOT persist attachment bytes. The filesystem gateway keeps `BlobRef` opaque, supports the same store/copy/materialize/delete lifecycle as remote storage, and materializes a run-scoped execution file before the existing Read tool accesses it. Neither context nor model-visible prompt text may receive the filesystem storage path.

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-8.5-上传和管理附件` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/request-attachments/spec.md`、`openspec/specs/ts-attachment-config/spec.md`、`openspec/specs/ts-attachment-intake/spec.md`、`openspec/specs/ts-attachment-remote-upload/spec.md`、`openspec/specs/ts-file-security-validation/spec.md`、`openspec/specs/ts-runtime-bootstrap-config/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。

## 归档阻塞记录（2026-07-31）

- **状态：**保持 active，禁止使用 `--skip-specs`。
- **原因：**stable `request-attachments` 中找不到 delta 的 `Context Engine skips attachment content reading in all modes` Requirement。
- **解除条件：**逐 Requirement 建立 delta、stable target、Function 与长期设计的双端映射；确认正文、元数据、Scenario 和任何 REMOVED→ADDED/MODIFIED 迁移均完整同步后，再重新执行 archive。
