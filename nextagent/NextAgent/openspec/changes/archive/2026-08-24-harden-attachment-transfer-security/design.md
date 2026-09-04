## 设计范围

| 受影响 Function | 目标变化 | 涉及 delta specs | Function 设计章节 |
|---|---|---|---|
| `FN-8.5 上传和管理附件` | 下载端点新增审计事件与全局并发限制 | `ts-hofs-file-download`（ADDED 2） | FN-8.5 上传和管理附件 |

本 change 无存量 Requirement 迁移（全部为 ADDED），不创建"存量 Requirement 迁移方案"章节。

## FN-8.5 上传和管理附件

### 目标与规范依据

proposal 要求下载通路对齐上传侧已有的安全基线：下载可审计、下载容量受并发保护。CSV 注入防护和上传 blob 存储名不透明化经评估不纳入本次 change（CSV 下载内容来自可信产品 API，无实际攻击面；blob 存储需鉴权访问，重命名风险可控且性价比低）。本 change 把 `ts-hofs-file-download` 归属到 `FN-8.5`（该 stable spec 此前缺少 Function 归属，下载与上传同形于 `materializeBlob`/`StagedUploadPort` 模式，本 change 借此补齐归属）。

**本 Function 的目标 Requirements**（canonical spec `ts-attachment-remote-upload`；本 change 实际写入下列 delta spec 的 ADDED Requirements）：

- `ts-hofs-file-download` → ADDED：下载操作审计日志记录成功与失败、全局下载并发限制

### 当前实现

- 下载路由 `GET /api/v1/sessions/:sessionId/files/download`（`requests.ts:861-921`）：`requireSession` 未接收返回值；`fileDownloadRuntime.materialize` 后直接 `createReadStream` 流式返回；无审计事件、无并发控制。
- `FileDownloadRuntime`（`file-download-runtime.ts`）：有 `DownloadTempSizeGuard`（全局 2048MB 临时上限），无 `auditObserver`、无并发限制器。
- 上传侧 `UploadAuditEvent`（`staged-upload-runtime.ts:84`）含 userId、tenantId、sessionId、operation、result、fileName、sizeBytes、reasonCode、tempRunId；`UploadConcurrencyLimiter`（`upload-quota.ts:224`）MAX=4、30s 超时、503。
- `requireSession` 返回 `UserSession`（含 `agentId`）。

### GAP 分析

| 目标 | 当前事实 | GAP |
|---|---|---|
| 下载成功/失败记录审计事件含 agentId/objectName/sizeBytes/result/reasonCode | 无下载审计事件 | 缺 DownloadAuditEvent、auditObserver 与调用点 |
| 下载全局并发上限 4、30s 超时 503 | 仅 DownloadTempSizeGuard 间接限磁盘 | 缺 DownloadConcurrencyLimiter 与 acquire/release |

### 修改方案

#### 1. 下载审计事件（P1）

新增 `DownloadAuditEvent` interface（`agent-attachment-runtime`），shape 与 `UploadAuditEvent` 同形：

| 字段 | type | required | trusted source |
|---|---|---|---|
| `userId` | string | 是 | `identityContext.subjectId` |
| `tenantId` | string | 是 | `identityContext.tenantId` |
| `agentId` | string | 是 | `requireSession` 返回的 `UserSession.agentId` |
| `sessionId` | string | 是 | 路由 params |
| `objectName` | string | 是 | 下载 `path` query |
| `sizeBytes` | number | 是 | materialize 结果 / metadata |
| `result` | `'SUCCESS' \| 'FAILURE'` | 是 | materialize 结果 |
| `reasonCode` | string | 否 | 失败时 AgentError code |
| `downloadId` | string | 是 | 路由生成的 UUID |
| `timestamp` | EpochMillis | 是 | clock |

`FileDownloadPort`/`FileDownloadRuntime` 增加 `auditObserver?: (event: DownloadAuditEvent) => void` 依赖（对齐 `UploadAuditEvent` 的 `auditObserver` 接线模式）。下载路由改为 `const session = await requireSession(...)` 接收返回值以取 `agentId`；materialize 成功与失败分别调用 audit。审计不得包含文件内容、本地路径或凭据。

#### 2. 下载并发限制（P2-并发）

新增 `DownloadConcurrencyLimiter`（与 `UploadConcurrencyLimiter` 同形），默认 `MAX_DOWNLOAD_CONCURRENCY = 4`、`CONCURRENCY_TIMEOUT_MS = 30_000`，超限等待超时返回 503。下载路由在 `materialize` 前 `acquire`、materialize 完成（成功或失败）后 `release`（用 try/finally 保证释放）。并发计数仅计 materialize 进行中的请求。owner scope 与 agentId 可信来源约束不变。

### 质量属性影响

- **审计/可追溯性**：下载审计事件补齐，agentId 来自 session-bound Agent Scope，验证关注审计字段完整性与 untrusted input 不可覆盖。
- **性能/容量**：下载并发限制防资源耗尽，验证关注第 5 个并发等待与 30s 超时 503。

## 验证策略

| 验证目标 | 层级 | 关注点 |
|---|---|---|
| 下载审计事件字段与触发 | contract test | 成功/失败均产出事件；agentId 来自 session；owner scope 来自 identityResolver；不含文件内容/路径 |
| 下载并发限制 | contract test | 4 并发放行、第 5 个等待、30s 超时返回 503、materialize 完成释放槽位 |
| 架构边界 | architecture test | `agent-channel-web` 不直接依赖 `BlobStoreGateway`；`FileDownloadPort` local port 边界不变；无 private path import |
| negative case | contract test | 下载并发超限拒绝；agentId 不可被 path/请求体覆盖 |

`openspec validate --all --strict` 必须通过。后端 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` 必须通过。精确测试文件与命令由 tasks 承载。

## 长期基线刷新计划

归档前需同步：

- **stable spec**：`ts-hofs-file-download`（补齐 `所属 Function: FN-8.5` + 新增 2 requirements）。
- **Function**：`FN-8.5` 文档 `## 规格` 表新增下载并发上限、下载审计规格项；`遗留规格` 补 `ts-hofs-file-download`。
- **Feature**：`F-8.4 附件管理` 边界补充安全质量保证（可审计、容量保护）。
- **spec-to-design-map**：补 `ts-hofs-file-download` 映射行（当前缺失）。
- **overview**：若提及下载安全则更新，否则无。
- **architecture/modules**：`agent-attachment-runtime`、`agent-channel-web` 模块描述补充下载审计/并发。
- **ADR**：无（无架构层 ADR 级决策）。

## 风险与取舍

- **下载并发限制无差异化**：全局 4 并发跨所有用户共享，与上传同形。若高并发下载场景下误拒正常请求，可后续按 owner scope 分桶限流（本次不引入，保持与上传同形最小）。
- **`ts-hofs-file-download` 归属 FN-8.5 是治理决策**：该 spec 此前无 Function 归属。归到 FN-8.5 因下载与上传同形；若评审认为应独立 Function，需后续 Function 退役/新增 change，本次不阻塞实施。

## 待确认问题

无阻塞性待确认问题。
