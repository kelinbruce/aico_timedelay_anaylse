# FN-8.5 上传和管理附件

> 能力域 D8 数据与记忆 · 子域 [D8.3 附件与产物](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-8.4](../../../features/D8-数据与记忆/D8.3-附件与产物/F-8.4-附件管理.md) |
| 主规格 | `ts-attachment-remote-upload` |
| 遗留规格 | `ts-attachment-intake`、`ts-attachment-config`、`ts-file-security-validation`、`ts-runtime-bootstrap-config`、`ts-hofs-file-download` |
| 接口 | 附件上传（统一暂存上传） |

## 描述

用户通过统一暂存上传流程上传附件：阶段 1 选文件即上传到临时存储，阶段 2 提交问题时最终化为 formal 附件。系统校验文件名、类型、大小、数量、归属和内容安全后暂存和引用。所有部署模式使用同一上传流程，存储模式差异隔离在 `BlobStoreGateway` 之后。

## 前置条件

- 用户已登录。
- bootstrap response 包含 `chatUploadFileConfig`（LOCAL 模式始终包含，REMOTE 模式配置文件存在时包含）。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 附件文件 | 是 | 通过暂存上传 endpoint 上传的文件 |
| tempRunId | 是 | 前端生成的临时上传会话标识，同一输入会话内多个文件共用 |
| attachments | 是 | 提交问题时携带的暂存附件引用列表 `[{ tempRunId, fileName }]` |

## 输出

附件标识和引用。阶段 1 返回 `{ tempRunId, fileName, sizeBytes }`（不含存储坐标）；阶段 2 最终化后创建 `RequestAttachmentRecord`（含 formal `storageRef`）。

## 处理过程

1. 阶段 1：用户选文件，前端调 `POST /api/v1/sessions/:sessionId/files/upload` 以 multipart 流式上传，后端经校验管道（全局并发、文件名、扩展名、大小、频率、配额、内容安全）后存入临时存储。
2. 阶段 2：用户提交问题，JSON body 携带 `attachments`，后端最终化每个临时文件为 formal `RequestAttachmentRecord`，任何文件最终化失败则整个请求失败。
3. 文件内容安全校验：文件名正则、magic bytes 交叉验证、zip 炸弹防护（总解压 ≤ 512MB）、zip slip 防护。
4. runtime 在 tool loop 前物化附件到 run-scoped `temp/attachments` 目录，通过 `ToolExecutionContext.attachmentPaths` 和 sandbox `FILE_PATHS` 传递给 Skill tool。
5. 用户删除未提交的临时文件时调 `DELETE` endpoint，后端通过 `BlobStoreGateway.deleteBlob` 删除并扣减计数器。

## 结果

- 正常：附件暂存和最终化成功，返回引用。
- 校验失败：安全拒绝，返回 safe error。
- 最终化失败：整个请求失败，不创建部分 attachment record。
- 配置缺失（REMOTE）：上传按钮禁用，不接受上传。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| Portal ability bootstrap 投影 | runtime bootstrap 的 `portalAbilityConfig` 始终包含四个入口 boolean，并按 provider 当前 effective 值投影；不暴露 AskUserQuestion 等待时间或派生值 | `ts-runtime-bootstrap-config`：`Bootstrap API exposes portal ability entry gates` |
| 上传流程 | 统一暂存上传（阶段 1 temp + 阶段 2 finalize），所有部署模式相同 | `ts-attachment-remote-upload`：`Attachment upload API is storage-mode agnostic`、`Unified staged upload and submit-finalize lifecycle` |
| 单文件大小限制 | 由 `chat-upload-max-file-size` 配置，Cap + Warn 校验 | `ts-attachment-config`：`File upload config is loaded from agent config directory` |
| per-session 文件数限制 | `chat-upload-max-file-number`（默认 10，上限 200） | `ts-attachment-remote-upload`：`Per-session and per-user dual-layer file count limits` |
| 下载并发上限 | 4，跨所有用户共享，超限等待 30 秒后返回 503 | `ts-hofs-file-download`：`全局下载并发限制` |
| 下载审计 | 下载成功与失败均记录审计事件，含 `userId`、`tenantId`、`agentId`、`sessionId`、`objectName`、`sizeBytes`、`result`、`reasonCode`、`downloadId`；不含文件内容、路径或凭据 | `ts-hofs-file-download`：`下载操作审计日志记录成功与失败` |
| per-user 累计限制 | 200 文件 / 500MB（所有 session 总和） | `ts-attachment-remote-upload`：`Per-session and per-user dual-layer file count limits` |
| 上传频率限制 | 1 小时内 500 次未发送问题的上传 | `ts-attachment-remote-upload`：`User-level upload frequency limit prevents abuse` |
| zip 炸弹防护 | ZIP 总解压大小 ≤ 512MB | `ts-file-security-validation`：`Zip bomb protection limits total uncompressed size` |
| 全局上传并发 | 4，超限等待 30 秒后 503 | `ts-file-security-validation`：`Global upload concurrency limit of 4` |
| `AttachmentMediaType` | `"WORD" \| "EXCEL" \| "PDF" \| "MARKDOWN" \| "PCAP" \| "PCAPNG" \| "CAP" \| "TMF" \| "PTMF" \| "ZIP" \| "TAR" \| "RAR" \| "GZ"` | `ts-attachment-intake`：`Attachment mediaType uses shared vocabulary` |
