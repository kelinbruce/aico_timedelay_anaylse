## ADDED Requirements

### Requirement: 历史附件跨 turn 保持可读
Runtime MUST 在 tool loop 开始前，把当前 session 内每一个 `ACCEPTED`+`AVAILABLE` 附件（而不仅是当前 request 的附件）物化到 run-scoped 的 `temp/attachments/{attachmentId}/{fileName}` 目录，使后续 turn 可以读取先前 turn 上传的文件。context engine MUST 为每一个可用附件暴露逻辑工作区 `modelPath`（`temp/attachments/{attachmentId}/{fileName}`），无论该附件绑定到当前 request 还是先前 turn。`availabilityStatus` 不是 `AVAILABLE` 的历史附件 MUST NOT 获得 `modelPath`，并且 MUST 显式降级。

runtime MUST 通过 `AttachmentStoreGateway.listAttachmentsBySession` 解析 session 附件集合，作用域为 `tenantId`、`subjectId`、`agentId` 和 `sessionId`；MUST NOT 从 client payload、上传 temp state 或模型输出重建历史集合。

#### Scenario: 后续 turn 读取先前 turn 的附件
- **WHEN** session 中存在来自先前 request 的 AVAILABLE 附件
- **AND** 用户发送后续 request 且未重新附加该文件
- **THEN** runtime MUST 把该先前 turn 的附件物化到当前 run 的 `temp/attachments/{attachmentId}/{fileName}`
- **AND** 渲染出的 attachment disclosure MUST 包含该附件的 `modelPath`
- **AND** 模型 MUST 能够通过 Read 工具使用该 `modelPath` 读取文件

#### Scenario: 不可用的历史附件仍然降级
- **WHEN** session 中存在 `availabilityStatus` 不是 `AVAILABLE` 的历史附件
- **THEN** context engine MUST NOT 为其暴露 `modelPath`
- **AND** context engine MUST 发出带 `readable: false` 的 `ATTACHMENT_HISTORICAL_DEGRADED` 降级证据

#### Scenario: 可用的历史附件不降级
- **WHEN** session 中存在 `availabilityStatus` 为 `AVAILABLE` 的历史附件
- **THEN** context engine MUST NOT 为其发出 `ATTACHMENT_HISTORICAL_DEGRADED` 降级证据
- **AND** attachment disclosure MUST 提供其 `modelPath` 以供读取

## MODIFIED Requirements

### Requirement: Context Engine 以固定规则分类附件
Context Engine MUST 按固定规则顺序把每个附件分类为 `latest-request-critical`、`latest-request-optional`、`historical` 或 `excluded`。分类 MUST 基于 request 事实、owner scope、agent scope、可用性和受控投影。MUST NOT 把 client payload、message metadata 副本、模型输出或 capability 参数当作文件名、类型、大小、状态或存储引用的权威来源。

只有当以下条件全部成立时，附件才是 `latest-request-critical`：

- 它直接绑定到当前 request；
- 它保持 owner-scoped、agent-scoped、可用，并被批准用于受控 context 消费；
- 当前 assembly 尚未为同一 `attachmentId` 保留等价的受控摘录、Markdown 投影或已批准 ref。

保持 `AVAILABLE` 的 `historical` 附件（绑定到先前 request）MUST 被投影为可读：runtime 将其物化，context engine 暴露其 `modelPath`。不是 `AVAILABLE` 的 `historical` 附件 MUST 以 `ATTACHMENT_HISTORICAL_DEGRADED` 证据显式降级为仅元数据。`historical` 判定表达的是 request 绑定关系而非可读性；可读性由 `availabilityStatus` 和已物化 `modelPath` 的存在决定。

#### Scenario: 已保留的等价投影阻止升级为 critical
- **WHEN** 当前 assembly 已包含同一 `attachmentId` 的等价受控投影
- **THEN** 该附件 MUST NOT 被分类为 `latest-request-critical`

#### Scenario: 可用的历史附件可读且不降级
- **WHEN** 先前 turn 的附件保持 `AVAILABLE`
- **THEN** 它 MUST 被分类为 `historical`
- **AND** 它 MUST 获得 `modelPath`
- **AND** 它 MUST NOT 产生降级证据

### Requirement: 附件 context artifact 保持安全且可追溯
Attachment context MAY 产生安全 descriptor、受控投影、附件 context 决策和降级证据。这些 artifact MUST 可追溯到来源 `attachmentId` 和当前 request 决策。针对已物化可用附件、形如 `temp/attachments/{attachmentId}/{fileName}` 的逻辑工作区路径 MAY 以 `AttachmentContextEvidence.modelPath` 形式对模型可见。Artifact MUST NOT 通过 safe error、用户可见 stream payload、audit detail 或结构化日志暴露原始存储句柄、`BlobRef`、`storageRef`、绝对文件系统路径、provider SDK 句柄或原始 payload。

#### Scenario: 安全的 context artifact 可追溯
- **WHEN** Context Engine 选择一个附件用于 context 消费
- **THEN** 发出的 artifact MUST 可追溯到来源 `attachmentId`
- **AND** 发出的 artifact MUST NOT 包含 blob ref、`storageRef` 或绝对存储坐标
- **AND** 任何对模型可见的路径 MUST 是 `temp/attachments/` 下的逻辑工作区路径，而不是原始存储路径或绝对路径
