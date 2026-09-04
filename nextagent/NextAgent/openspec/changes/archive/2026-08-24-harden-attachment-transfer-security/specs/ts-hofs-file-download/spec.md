## Function

- **所属 Function**：`FN-8.5 上传和管理附件`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 下载操作审计日志记录成功与失败

HOFS 文件下载端点 MUST 在 materialize 成功与失败时各记录一条专用下载审计事件，与既有 `UploadAuditEvent` 同形同策。审计事件 MUST 包含 `userId`、`tenantId`、`agentId`、`sessionId`、`objectName`、`sizeBytes`、`result`（`SUCCESS` 或 `FAILURE`）、`reasonCode`（失败时）、`downloadId` 和 `timestamp`。`owner scope`（`tenantId`/`subjectId`）MUST 来自 channel/auth boundary 的 `identityResolver`，MUST NOT 从 `path` 查询参数、请求体或模型输出获取。`agentId` MUST 来自已持久化的 `Session.agentId`，MUST NOT 从客户端请求体、未经认证 metadata、模型输出、capability 参数、默认 Agent 或全局配置推断。审计事件 MUST NOT 包含文件内容、本地临时文件路径、`BlobRef` 凭据或 provider raw error。

**需求类别**：系统质量属性

**质量属性**：审计/可追溯性

**适用范围**：`FN-8.5 上传和管理附件`

#### Scenario: 成功下载被审计

- **WHEN** 一个已认证会话的下载请求成功 materialize 并流式返回文件字节
- **THEN** 系统 MUST 记录一条下载审计事件，`result` 为 `SUCCESS`
- **AND** 该事件 MUST 包含 `userId`、`tenantId`、`agentId`、`sessionId`、`objectName`、`sizeBytes`、`downloadId` 和 `timestamp`
- **AND** `owner scope` MUST 来自 `identityResolver` 解析的已认证身份

#### Scenario: 失败下载被审计

- **WHEN** 一个下载请求在 materialize 阶段失败（如临时容量超限、blob 不可用或路径校验失败）
- **THEN** 系统 MUST 记录一条下载审计事件，`result` 为 `FAILURE`
- **AND** 该事件 MUST 包含 `reasonCode`
- **AND** 该事件 MUST NOT 包含文件内容、本地路径或凭据

#### Scenario: 下载审计的 agentId 来自会话绑定 Agent Scope

- **WHEN** 下载审计事件被构造
- **THEN** `agentId` MUST 取自已持久化的 `Session.agentId`
- **AND** `agentId` MUST NOT 从 `path` 查询参数、请求体或模型输出读取或覆盖

### Requirement: 全局下载并发限制

HOFS 文件下载端点 MUST 强制全局并发上限，与既有上传并发限制同形同策。同一时刻处理中的下载请求 MUST NOT 超过 4 个，跨所有用户共享。超过上限的请求 MUST 等待可用槽位，等待超过 30 秒时 MUST 返回 503。并发计数 MUST 仅计 materialize 进行中的请求，materialize 完成或失败后 MUST 立即释放槽位。`owner scope` 和 `agentId` 的可信来源约束不变。

**需求类别**：系统质量属性

**质量属性**：性能/容量

**适用范围**：`FN-8.5 上传和管理附件`

#### Scenario: 第 5 个并发下载等待

- **WHEN** 4 个下载请求正在 materialize 且第 5 个到达
- **THEN** 第 5 个下载 MUST 等待直到有可用槽位
- **AND** 若 30 秒内无槽位可用，系统 MUST 返回 503

#### Scenario: materialize 完成释放并发槽位

- **WHEN** 一个下载请求的 materialize 完成（成功或失败）
- **THEN** 系统 MUST 立即释放该请求占用的并发槽位
- **AND** 等待中的下载请求 MUST 能获取被释放的槽位

## Function 变更汇总

### 规格

| 规格项 | 变更类型 | 原规格值 | 目标规格值 | 依据 Requirements |
|---|---|---|---|---|
| 下载并发上限 | 新增 | 不适用（新增） | 4，跨所有用户共享，超限等待 30 秒后返回 503 | 全局下载并发限制 |
| 下载审计 | 新增 | 不适用（新增） | 下载成功与失败均记录审计事件，含 `userId`、`tenantId`、`agentId`、`sessionId`、`objectName`、`sizeBytes`、`result`、`reasonCode`、`downloadId`；不含文件内容、路径或凭据 | 下载操作审计日志记录成功与失败 |
