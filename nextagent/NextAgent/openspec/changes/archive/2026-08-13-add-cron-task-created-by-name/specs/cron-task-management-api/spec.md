## Function

- **所属 Function**：`FN-10.9 Cron 工具`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Cron task management API persists creator display name

Cron task management API MUST 在创建 Cron task 时从 trusted identity context 提取创建者显示名称并持久化。创建者显示名称 MUST 来自 `IdentityContext.displayName`，不得来自客户端请求体。task 响应 DTO MUST 包含 `createdByName` 字段，类型为 optional string；当持久化的创建者显示名称为空字符串时，`createdByName` MUST 为 `null`。`createdByName` 是展示性字段，MUST NOT 参与 owner scope 校验、Agent Scope 校验或权限控制。

**需求类别**：功能性需求

#### Scenario: Create task persists creator display name
- **WHEN** 客户端发送 `POST /api/v1/cron-tasks` 且 trusted identity context 的 `displayName` 为 "Local developer"
- **THEN** 系统 MUST 持久化 `createdByName` 为 "Local developer"
- **AND** 成功响应 DTO MUST 包含 `createdByName` 字段且值为 "Local developer"

#### Scenario: Task list response includes creator display name
- **WHEN** 客户端发送 `GET /api/v1/cron-tasks` 且存在已持久化 `createdByName` 的任务
- **THEN** 响应中每个 task DTO MUST 包含 `createdByName` 字段
- **AND** `createdByName` 值 MUST 与创建时持久化的值一致

#### Scenario: Task with missing creator display name returns null
- **WHEN** 持久化的 `createdByName` 为 NULL（如迁移前已存在的旧任务）
- **THEN** task DTO 的 `createdByName` 字段 MUST 为 `null`
- **AND** 响应 MUST NOT 包含 `undefined` 或空字符串

## MODIFIED Requirements

### Requirement: Cron task management API surface
系统 SHALL 在 Web channel 暴露 Cron task 管理 REST API，用于对当前 trusted owner 与 active Agent 下的 Cron task 执行查询、创建、修改和删除。接口 MUST 使用 `/api/v1/cron-tasks` 作为集合路径，使用 `/api/v1/cron-tasks/:taskId` 作为单个 task 路径。接口 MUST 提供 request schema、success response schema 和 safe error response schema；task 响应 MUST 使用 public DTO，不得暴露 gateway `CronTaskRecord`、SQLite row、trigger fact、idempotency key、version、raw prompt history 或 runtime 内部 fact。task 响应 DTO MUST 包含 `createdByName` 字段，类型为 optional string 或 null；该字段 MUST 来自创建时持久化的 trusted identity context 显示名称，不得来自客户端请求体。

**需求类别**：功能性需求

#### Scenario: Query Cron tasks
- **WHEN** 客户端发送 `GET /api/v1/cron-tasks`
- **THEN** Web channel MUST 返回当前 trusted owner 与 active Agent 下可管理的 Cron task page，包含 `tasks` 和 `total`
- **AND** query MAY 包含非负整数 `offset` 与正整数 `limit`
- **AND** `limit` 默认值 MUST 为 50，最大值 MUST 为 50
- **AND** 响应 MUST NOT 回显 `offset` 或 `limit`
- **AND** 每个 task DTO MUST 至少包含 `taskId`、`cron`、`humanSchedule`、`prompt`、`recurring`、`status`、`createdAt`、`updatedAt`、`nextRunAt` 和 `createdByName`
- **AND** 响应 MUST NOT 包含 tenant、subject、session、run、version、trigger、gateway record 或 SQLite row 字段

#### Scenario: Create Cron task
- **WHEN** 客户端发送 `POST /api/v1/cron-tasks` 并提供合法 `cron`、非空 `prompt` 和可选 `recurring`
- **THEN** Web channel MUST 创建一个 durable Cron task
- **AND** 系统 MUST 从 trusted identity context 持久化创建者显示名称
- **AND** 成功响应 MUST 返回创建后的 public task DTO，包含 `createdByName`
- **AND** task MUST 参与既有 Cron scheduler/remote callback 到期触发路径

#### Scenario: Update Cron task
- **WHEN** 客户端发送 `PUT /api/v1/cron-tasks/:taskId` 并提供一个或多个合法可修改字段
- **THEN** Web channel MUST 只修改该 task 的 `cron`、`prompt` 或 `recurring`
- **AND** 如果 `cron` 被修改，系统 MUST 重新计算 `nextRunAt`
- **AND** 成功响应 MUST 返回修改后的 public task DTO
- **AND** 更新 MUST NOT 修改 `createdByName`

#### Scenario: Delete Cron task
- **WHEN** 客户端发送 `DELETE /api/v1/cron-tasks/:taskId`
- **THEN** Web channel MUST 删除当前 trusted scope 下的对应 Cron task
- **AND** 成功响应 MUST 为 `204 No Content`
- **AND** 删除后的 task MUST 不再被 query response 返回，也 MUST 不再产生新的 trigger

## Function 变更汇总

### 输出

- **变更类型**：修改
- **目标内容**：task 响应 DTO 新增 `createdByName` 字段，类型为 optional string 或 null，来自创建时持久化的 trusted identity context 显示名称。
- **依据 Requirements**：`Cron task management API persists creator display name`、`Cron task management API surface`

### 规格

- **规格项**：创建者显示名称
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`createdByName` 为 optional string 或 null，来自 `IdentityContext.displayName`，不参与 scope 校验
- **依据 Requirements**：`Cron task management API persists creator display name`

### 主规格

- **变更类型**：修改
- **目标内容**：`cron-task-management-api`
- **依据 Requirements**：`Cron task management API persists creator display name`、`Cron task management API surface`
