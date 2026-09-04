## 背景与问题（Why）

文件上传后，只有上传那一轮（current request）的附件对模型可读：runtime 在 tool loop 前物化当前请求的附件并暴露逻辑读取路径，模型可用 Read 工具读取。但后续轮次中，之前轮次上传的附件被上下文引擎分类为 `historical`，仅投影文件元数据（`fileName`/`mediaType`/`sizeBytes`），既不物化、也不暴露读取路径，并始终发出 `ATTACHMENT_HISTORICAL_DEGRADED` 降级通知。

这造成两个可观察问题：

- **后续轮次模型读不到历史附件**：用户上一轮传的文件，下一轮追问时模型无法读取，只能凭上一轮回答的记忆作答，丢失文件细节。
- **降级通知误导用户**：文件 blob 仍然可用（`availabilityStatus=AVAILABLE`），系统却报“已降级继续处理 / ATTACHMENT_HISTORICAL_DEGRADED”，让用户误以为文件出错或丢失。

根因：runtime 只物化当前请求附件（`resolveAttachmentRefs` 仅按 `requestId` 查询），历史附件不物化；上下文引擎对可用历史附件也一律发降级证据。设计把“不注入内容以省预算”与“不可读”混为一谈，牺牲了跨轮可读性。

## 变更范围（What Changes）

### 契约变更

- `AttachmentStoreGateway` 新增 `listAttachmentsBySession(request)`，按 `tenantId`/`subjectId`/`agentId`/`sessionId` 查询会话内全部附件记录。与既有 `listAttachmentsByRequestId`/`listAttachmentsByRunId` 同形（OwnerScoped + agentId）。
- `AttachmentContextEvidence.modelPath`（当前请求附件已存在）扩展到可用历史附件：可用附件无论 `request`/`history` 来源都暴露逻辑工作区路径 `temp/attachments/{attachmentId}/{fileName}`；`storageRef`、`BlobRef`、绝对物理路径仍不得对模型可见。

### Runtime 物化范围

- `resolveAttachmentRefs` 改为按 `sessionId` 查询（`listAttachmentsBySession`），物化会话内全部 `ACCEPTED`+`AVAILABLE` 附件（当前 + 历史）到本次 run 的 `temp/attachments/{attachmentId}/{fileName}`。
- 物化目标、`materializeBlob` 流式写入、run terminal 清理逻辑不变；历史附件仅多了一组物化文件，cleanup 仍整目录删除。
- `ToolExecutionContext.attachmentPaths` / sandbox `FILE_PATHS` 因此包含会话内全部可用附件路径（Skill 同样可读历史文件）。

### 上下文引擎降级语义

- 可用历史附件（`availabilityStatus=AVAILABLE`）不再发出 `ATTACHMENT_HISTORICAL_DEGRADED` 降级证据；它通过 `modelPath` 可读，不是降级。
- 仅当历史附件不可用（`availabilityStatus!==AVAILABLE`，例如被清理/过期/跨用户）时，才发降级证据并投影为 metadata-only。

## Capability 影响（Capabilities）

### 修改的 Capability

- `request-attachments`：历史附件可读性——可用历史附件物化并暴露逻辑路径、不降级；仅不可用历史附件降级。`AttachmentContextEvidence.modelPath` 覆盖可用历史附件。
- `ts-core-contracts`（Gateway Port 边界）：`AttachmentStoreGateway` 新增 session 作用域查询方法。

## 影响范围（Impact）

- `agent-contracts/gateway`：新增 `ListAttachmentsBySessionRequest` 与 `AttachmentStoreGateway.listAttachmentsBySession`。
- `agent-platform-gateway-local`：`SqliteGatewayCore` 实现 `listAttachmentsBySession` + `idx_attachments_session` 索引；`SqliteAttachmentStore` 委托。
- `agent-core`：`DefaultAgent.resolveAttachmentRefs` 改按 session 查询。
- `agent-context-engine`：`toAttachmentEvidence` 对可用历史附件输出 `modelPath`；`collectAttachmentEvidence` 历史分支仅对不可用附件发降级证据。
- 无前端变更（历史附件展示已在 conversation API 中携带；本轮不改前端）。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/request-attachments/spec.md`：提升“历史附件跨轮可读 + 可用不降级”约束。
- `openspec/specs/ts-core-contracts/spec.md`：如需，补充 `AttachmentStoreGateway` session 作用域查询的契约口径。

设计视图：
- `openspec/designs/modules/agent-attachment-runtime.md`：补充历史附件物化范围。
- `openspec/designs/modules/agent-context-engine.md`：补充历史附件 `modelPath` 与降级条件。

验证入口：
- `openspec validate refine-attachment-historical-readability --strict`
- `openspec validate --all --strict`
- `npm run build`
- `npm test`（含 context-engine、sqlite attachment store、default-agent 相关）
- `npm run lint:architecture`

## 遗留项（Deferred）

- 将物化范围收敛到 active context 内的历史附件（避免物化被压缩出上下文的旧附件）。当前由会话上传上限（D22，≤200 文件）兜底，典型会话开销可忽略；长会话优化留待后续 change。
- 远端 `AttachmentStoreGateway` 实现待隔离环境提供（与既有 list-by 方法一同实现）。

## 契约确认（Contract Confirmation）

- `AttachmentStoreGateway.listAttachmentsBySession(request: ListAttachmentsBySessionRequest)` 返回 `readonly RequestAttachmentRecord[]`，按 `tenantId`/`subjectId`/`agentId`/`sessionId` 过滤，`ORDER BY created_at ASC, attachment_id ASC`。
- `AttachmentContextEvidence.modelPath` 为逻辑工作区路径 `temp/attachments/{attachmentId}/{fileName}`，不含 `storageRef`、`BlobRef` 或绝对物理路径。
- 可用历史附件不产生 `attachmentDegradationEvidence`；不可用历史附件仍以 `ATTACHMENT_HISTORICAL_DEGRADED` 降级。
