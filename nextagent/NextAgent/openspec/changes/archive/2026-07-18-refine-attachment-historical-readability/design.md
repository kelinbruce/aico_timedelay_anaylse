## 背景和现状（Context）

`add-ts-remote-file-upload`（已完成未归档）确立：附件内容不进 model context，runtime 物化当前请求附件到 `temp/attachments/{attachmentId}/{fileName}`，上下文引擎对当前请求附件渲染元数据 + 逻辑路径（`modelPath`），历史附件投影为 metadata-only 并发 `ATTACHMENT_HISTORICAL_DEGRADED`。

结果：只有上传那一轮模型能读文件；后续轮次历史附件不可读，且可用附件也被标记为降级，误导用户。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 后续轮次模型可读会话内仍可用的历史附件（与当前附件同形：物化 + 暴露逻辑路径）。
- 可用历史附件不再产生降级通知；仅真不可用才降级。

**非目标：**
- 不恢复“内容注入 context”路线（与既有 path-based 路线冲突，违背同形同策）。
- 不做 active-context 收敛物化范围（留 deferred）。
- 不改前端。

## 设计决策（Decisions）

### D1: 新增 `listAttachmentsBySession` 查询

runtime 物化发生在上下文组装之前（`executeRun` line 70），拿不到上下文引擎算出的历史集合。为最小且同形地获取“会话内全部附件”，新增 `AttachmentStoreGateway.listAttachmentsBySession({tenantId, subjectId, agentId, sessionId})`，与既有 `listAttachmentsByRequestId`/`listAttachmentsByRunId` 同形（OwnerScoped + agentId，`ORDER BY created_at ASC, attachment_id ASC`）。

sqlite 实现：`attachments` 表已有 `session_id`/`agent_id` 列；新增 `idx_attachments_session(tenant_id, subject_id, agent_id, session_id, created_at ASC, attachment_id ASC)` 索引。

未新增 remote 实现（仓库无 remote attachment store；与既有 list-by 方法一并留隔离环境）。

### D2: runtime 物化会话内全部可用附件

`resolveAttachmentRefs` 改用 `listAttachmentsBySession`，过滤 `ACCEPTED`+`AVAILABLE`，返回当前 + 历史全部附件 ref。`resolveAttachmentPaths` → `attachmentExecutionRuntime.materialize` 不变（已按列表逐个物化）。物化路径约定不变：`temp/attachments/{attachmentId}/{fileName}`，历史附件 `attachmentId` 不同，无冲突。run terminal `cleanup` 整目录删除，覆盖历史物化文件。

`ToolExecutionContext.attachmentPaths` / `FILE_PATHS` 因此含会话内全部可用附件路径——Skill 同样可读历史文件，与当前附件同形。

### D3: 可用历史附件暴露 `modelPath`

`toAttachmentEvidence`：对 `availabilityStatus===AVAILABLE` 的附件，无论 `source` 为 `request` 还是 `history`，都输出 `modelPath = temp/attachments/{attachmentId}/{basename(fileName)}`。该路径与 D2 物化落点一致，Read 工具按逻辑根解析不会重复 runKey 段。不可用附件不给 `modelPath`。

`storageRef`、`BlobRef`、绝对物理路径仍不出现在 `modelPath` 或任何 model-visible 文本中。

### D4: 可用历史附件不降级

`collectAttachmentEvidence` 历史分支：仅当 `attachment.availabilityStatus !== "AVAILABLE"` 时才 push `attachmentDegradationEvidence`（`ATTACHMENT_HISTORICAL_DEGRADED`，`projectionKind: metadata-only`，`readable: false`）。可用历史附件不发降级证据——它可读，不是降级。

`decision` 仍为 `historical`（按请求绑定分类不变），但可读性由 `availabilityStatus` + `modelPath` 决定，不由 `decision` 决定。

## 数据流（Data Flow）

```
后续轮次请求
  ├─ runtime.resolveAttachmentRefs  → listAttachmentsBySession → 当前+历史全部可用附件
  ├─ resolveAttachmentPaths → materialize 全部到 temp/attachments/{id}/{file}
  ├─ 上下文引擎 collectAttachmentEvidence
  │   ├─ 当前附件: critical + modelPath
  │   ├─ 可用历史附件: historical + modelPath（无降级证据）
  │   └─ 不可用历史附件: historical + 降级证据（metadata-only）
  └─ 模型收到 ### Attachment context（含历史文件路径）→ 可 Read 历史文件
```

## 风险和缓解（Risks）

- **物化范围扩大**：每轮物化会话内全部可用附件。由会话上传上限（D22，≤200 文件）兜底；典型会话 1–5 文件，开销可忽略。长会话收敛到 active context 留 deferred。
- **`attachmentPaths` 含历史文件**：Skill/sandbox 现在能读历史文件。这是预期行为（同形同策），非安全放宽——owner/agent scope 由查询和物化边界保证。
- **与未归档 `add-ts-remote-file-upload` 的关系**：本 change 调整该 change 引入的“历史 metadata-only + 必降级”语义。归档时以本 change 为准合并到基线。

## 质量属性审视（Quality Attributes）

- **安全**：`modelPath` 仅逻辑工作区路径，不含 `storageRef`/绝对路径；session 查询带 tenant+subject+agent+session，owner/agent scope 不放宽。可用历史附件可读不等于越权。
- **性能/容量**：物化会话内全部可用附件，受 D22 上限约束；新增 session 索引避免全表扫。每轮重新物化 + terminal 清理，无跨轮累积。
- **可靠性/恢复**：不可用历史附件仍显式降级（保留原 fail-closed 语义）；物化失败仍抛 `Attachment blob is unavailable.`，不影响当前请求附件。
- **可维护性**：`listAttachmentsBySession` 与既有 list-by 同形；`modelPath`/降级条件单一来源（`availabilityStatus`）。
- **可测试性**：sqlite store session 查询、上下文引擎历史 `modelPath` + 降级条件、runtime session 物化范围均有可断言黑盒行为。
- **审计/可追溯**：降级证据仍按 `attachmentId` 可追溯；可用历史附件不降级，无需额外审计。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/request-attachments/spec.md`：提升“历史附件跨轮可读 + 可用不降级”。
- `openspec/designs/modules/agent-attachment-runtime.md`：物化范围含历史可用附件。
- `openspec/designs/modules/agent-context-engine.md`：历史 `modelPath` 与降级条件。
