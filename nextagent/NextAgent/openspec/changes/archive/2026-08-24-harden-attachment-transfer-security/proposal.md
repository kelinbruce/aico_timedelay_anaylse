## Why

文件上传与下载是 NextAgent 附件与产物传输的核心通路。2026-08-12 安全审查发现下载通路存在 2 个可观察的安全缺口，上传侧虽已有较完整的校验与审计基线，但下载侧未对齐：

- **下载操作无专用审计日志**：上传侧有 `UploadAuditEvent`（记录 userId、tenantId、sessionId、operation、result、fileName、sizeBytes、reasonCode、tempRunId），下载路由（`GET /api/v1/sessions/:sessionId/files/download`）无论成功或失败均无对应审计事件，无法追溯谁在何时下载了哪个文件、下载是否成功及失败原因。
- **下载端点无并发限制**：上传侧有全局并发上限（4，超限等待 30 秒后 503），下载侧仅有 `DownloadTempSizeGuard`（全局临时文件 2048MB 上限）间接约束磁盘占用，但无并发控制；大量并发下载可能耗尽文件描述符或内存导致服务不可用。

审查报告中另两项发现（CSV 注入、上传文件保留原始文件名）经评估不纳入本次 change，原因见"非目标"。

信任来源与归属边界（冻结）：

- owner scope（tenantId/subjectId）只来自 channel/auth boundary 的 `identityResolver`，不从 query、请求体或模型输出获取。
- agentId 只来自可信 app composition/hosted-agent selection 或已持久化 `Session.agentId`/`RequestRun.agentId`。
- 下载审计事件的 owner scope 与 agentId 沿用同一可信来源，不得从下载请求的 `path` 参数推断。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 下载端点对成功与失败结果产出专用审计事件，字段覆盖 owner scope、agent scope、sessionId、objectName、sizeBytes、result、reasonCode，shape 与既有 `UploadAuditEvent` 对齐（同形同策）。
- 下载端点引入全局并发上限，超限等待后在固定超时后返回 503，shape 与既有上传并发限制对齐。

**非目标：**

- 不对下载文件内容做 CSV 注入防护。下载的文件均由可信产品 API 构造并写入 HOFS，下载管道不存在不可信 CSV 内容流过，无实际攻击面。
- 不对下载文件内容做敏感信息脱敏（内容级脱敏不在本次范围）。
- 不改变上传侧 blob 存储名（保留原始文件名）。blob 存储需经 API 鉴权访问，web 不能直接通过文件名访问，实际风险可控。
- 不新增 durable audit sink、查询 API 或 retention policy；下载审计事件沿用既有 audit 观察者通道，持久化由后续独立 change 定义。
- 不改变上传侧已有的文件名正则、magic bytes、zip bomb/zip slip 校验、配额与频率限制语义。
- 不改变 `BlobStoreGateway` 契约（不新增方法）、`FileDownloadPort`/`StagedUploadPort` local port 边界和 `agent-channel-web` 不直接依赖 gateway 的架构边界。
- 不修复 `ts-hofs-file-download` spec 缺少 Function 树归属这一既有治理缺口。
- 不改变下载临时文件三层清理机制和全局 2048MB 临时容量上限语义。

## What Changes

- **新增**：下载端点在 materialize 成功与失败时产出 `DownloadAuditEvent`，字段对齐 `UploadAuditEvent`（含 owner scope、agentId、sessionId、objectName、sizeBytes、result、reasonCode、downloadId、timestamp）。
- **新增**：下载端点引入全局下载并发限制，达到上限时新请求等待，超过固定超时返回 503；shape 与 `UploadConcurrencyLimiter`（4 并发、30 秒超时）对齐。
- **行为变化（非破坏）**：下载并发超限时返回 503。

## Feature 影响（Features）

### 修改的 Feature

- `F-8.4 附件管理`：附件与产物传输通路的安全质量保证增强——下载可审计、下载容量受并发保护；组成 Functions 不变。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-8.5 上传和管理附件` → `specs/ts-attachment-remote-upload/spec.md`
  - 功能边界：下载端点新增专用审计事件和全局并发限制。
  - 系统质量属性：性能/容量（下载并发限制）、审计/可追溯性（下载审计事件）。
  - 映射说明：canonical spec `ts-attachment-remote-upload`；本次触及 `ts-hofs-file-download`（下载审计/并发）——该 spec 为 HOFS 文件下载 spec，与上传同形于 `materializeBlob`/`StagedUploadPort` 模式，本次新增下载安全 requirement。

## 影响范围（Impact）

- 下载并发超限时调用方收到 503，与上传超限行为一致。
- 受影响代码：`agent-channel-web` 下载路由与 opLog、`agent-attachment-runtime` 的 `file-download-runtime`，以及 app composition 接线。
- 受影响测试：下载审计事件、下载并发超限相关 contract 与 architecture 测试。
- `ts-hofs-file-download` spec 缺少 Function 树归属是既有治理缺口，本次不修复，记录为后续 follow-up。
