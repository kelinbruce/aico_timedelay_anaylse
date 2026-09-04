## Function

- **所属 Function**：`FN-10.9 Cron 工具`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Cron task execution record API surface

系统 SHALL 在 Web channel 暴露 `GET /api/v1/cron-tasks/:taskId/runs`，用于查询当前 trusted owner 与 active Agent 下指定 Cron task 的执行记录和执行结果。接口 MUST 返回 public execution DTO，不得暴露 gateway Record、SQLite row、idempotency key、version、raw provider error、stack、credential、token 或跨 scope 对象存在性。

execution DTO 的 terminal process fields MUST 来自 matching terminal Event；`resultContent` MUST 只来自该 Event 以 `terminalMessageId` 强关联且满足既有可见性策略的 terminal Assistant Message。关联读取 MUST 验证 trusted Owner Scope、active Agent Scope、session、request、run、Message role、visibility 和 terminal metadata。Capability 大结果的 `resultContent` MUST 等于该 Message 已提交的 preview/ref projection，Web channel MUST NOT 读取 workspace 文件自动展开全文。

Message 缺失、隐藏、损坏、越权或坐标不匹配时，DTO MUST 保留可安全返回的 terminal process fields 并省略 `resultContent`，MUST NOT 从 Event body、workspace 文件、其他 Message 或缓存回退正文。

**需求类别**：功能性需求

#### Scenario: Query Cron task executions

- **WHEN**客户端发送 `GET /api/v1/cron-tasks/:taskId/runs`
- **THEN** Web channel MUST 先确认 task 存在于当前 trusted owner 与 active Agent scope
- **AND**响应 MUST 返回包含 `executions` 与 `total` 的 execution page
- **AND**响应 MUST NOT 回显 `offset` 或 `limit`
- **AND**调用方 MAY 提供非负整数 `offset` 与范围 1..50 的整数 `limit`
- **AND**调用方省略 `offset` 时系统 MUST 使用 0，省略 `limit` 时系统 MUST 使用 50
- **AND**每个 DTO MUST 至少包含 `triggerId`、`taskId`、`scheduledAt`、`triggerStatus`、`createdAt` 和 `updatedAt`
- **AND** runtime run 已绑定时 DTO MUST 包含 `sessionId`、`requestRunId`、`runStatus` 和 `terminalCommitState`
- **AND** terminal Event 已产生时 DTO MUST 包含 `resultEventType` 与 `resultAt`
- **AND** Event 强关联合法 terminal Message 时 DTO MUST 包含等于 Message committed content 的 `resultContent`

#### Scenario: Capability大结果返回committed projection

- **GIVEN** Cron execution 的 terminal Message 保存 Capability 大结果 preview/ref
- **WHEN** authorized caller 查询该 execution
- **THEN** `resultContent` MUST 等于 terminal Message 的 preview/ref projection
- **AND** Web channel MUST NOT 读取 workspace 文件返回完整原文

#### Scenario: Terminal Message关联失败时省略正文

- **GIVEN** terminal Event 存在，但 Message association 缺失、损坏或坐标不匹配
- **WHEN** authorized caller 查询该 execution
- **THEN** DTO MUST 保留安全 `resultEventType` 与 `resultAt`
- **AND** MUST 省略 `resultContent`
- **AND** MUST NOT 回退 Event body、workspace 文件或其他 Message

#### Scenario: Terminal Message存储读取失败不伪装为无正文

- **GIVEN** terminal Event 包含合法 Message association
- **AND** Message gateway 因认证、连接或存储故障抛出失败
- **WHEN** authorized caller 查询 execution
- **THEN** Web channel MUST 按既有 safe dependency failure 边界使查询失败
- **AND** MUST NOT 转换为成功响应中的无正文 execution

#### Scenario: Scoped execution query does not leak foreign task existence

- **WHEN**客户端查询 trusted scope 外存在的 Cron task executions
- **THEN** Web channel MUST 返回 404 safe error 或等价 not-found outcome
- **AND** MUST NOT 返回 task、trigger、session、run、terminal Event、Message 或 workspace ref

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：Cron execution API 使用 terminal Event 返回过程坐标，并通过可信 terminal Message association 返回 committed result projection。
- **依据 Requirements**：`Cron task execution record API surface`

### 处理过程

- **变更类型**：修改
- **目标内容**：合法 association 返回 Message inline 或 preview/ref content；关联失败省略正文，不自动读取 workspace 全文。
- **依据 Requirements**：`Cron task execution record API surface`

### 规格

- **规格项**：Cron execution结果正文来源
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：可信 terminal Message 的 committed inline 或 preview/ref projection；不回退 Event 或 workspace
- **依据 Requirements**：`Cron task execution record API surface`
