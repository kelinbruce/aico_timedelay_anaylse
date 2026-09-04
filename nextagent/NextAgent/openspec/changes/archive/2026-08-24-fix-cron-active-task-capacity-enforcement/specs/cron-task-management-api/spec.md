## Function

- **所属 Function**：`FN-10.9 Cron 工具`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Cron task 管理 API 执行 ACTIVE 任务容量限制

Cron task management API MUST 在 `POST /api/v1/cron-tasks` 创建任务时应用与 Cron Tool 相同的 ACTIVE task capacity invariant。容量 MUST 按 trusted owner + active Agent scope 统计，只统计 `status='ACTIVE'` 的 durable task，上限为 50；`COMPLETED` 和 `DELETED` task MUST NOT 占用额度。

当当前 scope 已有 50 个 ACTIVE task 时，Web API MUST 返回 HTTP `409`，响应 `error.code` MUST 为 `CRON_TASK_LIMIT_REACHED`。底层 management failure MUST 使用 `AgentError` 的 `category=CONFLICT` 且 `retryable=false`；Web 投影 MUST 沿用既有 public safe error envelope，只暴露 stable `code` 与 safe `message`。系统 MUST NOT 创建 task、创建 trigger、修改既有 task 或推进任何持久化状态。响应 MUST NOT 暴露 tenant、subject、agent、SQL、存储路径、stack trace 或跨 scope 对象存在性。

Tool-created ACTIVE task 和 management-created ACTIVE task MUST 共享同一 50 条额度。

**需求类别**：功能性需求

#### Scenario: 第 50 个 management task 被接受

- **WHEN** 当前 trusted owner + active Agent scope 已有 49 个 ACTIVE task
- **AND** 客户端发送一个合法 `POST /api/v1/cron-tasks`
- **THEN** Web API MUST 创建 durable task
- **AND** 成功响应 MUST 返回 public task DTO

#### Scenario: 超限创建返回 409

- **WHEN** 当前 trusted owner + active Agent scope 已有 50 个 ACTIVE task
- **AND** 客户端发送一个合法 `POST /api/v1/cron-tasks`
- **THEN** Web API MUST 返回 HTTP `409`
- **AND** 响应 `error.code` MUST 为 `CRON_TASK_LIMIT_REACHED`
- **AND** 响应 MUST 使用既有 public safe error envelope，不新增 category/retryable 公共字段
- **AND** gateway MUST NOT 创建或修改 task

#### Scenario: COMPLETED 和 DELETED task 不占 Web 创建额度

- **WHEN** scope 内只有 `COMPLETED` 或 `DELETED` task 达到或超过 50 条
- **AND** 当前 ACTIVE task 少于 50
- **THEN** 合法 create MUST 成功
- **AND** capacity 判定 MUST NOT 把这些非 ACTIVE task 计入

#### Scenario: Tool 与 Web 创建共享额度

- **WHEN** scope 内已有 Cron Tool 创建的 50 个 ACTIVE task
- **AND** Web management API 尝试创建新 task
- **THEN** Web API MUST 返回 409 `CRON_TASK_LIMIT_REACHED`

#### Scenario: 超限错误不泄漏内部事实

- **WHEN** `POST /api/v1/cron-tasks` 因 ACTIVE capacity 被拒绝
- **THEN** 响应 MUST NOT 包含 tenant、subject、agent、SQLite detail、SQL、存储路径或 stack trace
- **AND** 响应 MUST NOT 揭示其他 scope 是否满额

#### Scenario: API 文档记录容量拒绝

- **WHEN** Cron task create endpoint 注册完成
- **THEN** authoritative Web API 文档 MUST 记录 HTTP 409、`CRON_TASK_LIMIT_REACHED`、category 和 retryable 语义

## Function 变更汇总

### 接口

- **变更类型**：修改
- **目标内容**：`Cron 工具` 接口能力导航扩展为同时包含 `Cron 工具` 与 `Cron task management API`；容量拒绝的接口行为由 `cron-task-management-api` 的 Requirement 和场景定义。
- **依据 Requirements**：`Cron task 管理 API 执行 ACTIVE 任务容量限制`
