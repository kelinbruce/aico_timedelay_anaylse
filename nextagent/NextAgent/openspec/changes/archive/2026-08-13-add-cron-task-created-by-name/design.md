## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.9 Cron 工具` | 创建任务时持久化创建者显示名称，API 响应和前端卡片展示该字段 | `cron-task-management-api`、`agent-web-cron-task-dashboard` | `FN-10.9 Cron 工具` |

## `FN-10.9 Cron 工具`

### 目标与规范依据

用户创建定时任务时，系统需将创建者的显示名称与任务一起持久化，并在 API 响应和前端卡片中展示。创建者名称来自 trusted identity context 的 `displayName`，是展示性字段，不参与 scope 校验。

#### 本 Function 的目标 Requirements

canonical spec：`cron-task-management-api`

- `ADDED`：`Cron task management API persists creator display name`
- `MODIFIED`：`Cron task management API surface`

遗留 spec：`agent-web-cron-task-dashboard`

- `MODIFIED`：`Cron task dashboard lists manageable tasks`

### 当前实现

| 层 | 当前事实 |
|---|---|
| `CronTaskRecord`（gateway contract） | `extends OwnerScoped`，只有 `tenantId`/`subjectId`，无 `createdByName` |
| `CronTaskManagementView`（channel contract） | 无 `createdByName` 字段 |
| `createCronTask`（service） | 从 `command.identityContext` 取 `tenantId`/`subjectId` 写入 Record，丢弃 `displayName` |
| `projectTask`（service） | 投影 Record 到 View，不包含创建者名称 |
| SQLite schema | `cron_tasks` 表无 `created_by_name` 列 |
| `projectCronTaskManagement`（channel） | 投影 View 到 DTO，不包含 `createdByName` |
| 前端 `CronTaskView` | 已定义 `createdByName?: string` 字段 |
| 前端 `taskOwner` | 已有 `task.createdByName?.trim() \|\| task.createdBy?.trim() \|\| '-'` 逻辑 |
| 前端 `TaskCard` | footer 右侧展示 `createdBy: {taskOwner(props.task)}` |

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 创建时持久化 `createdByName` | `createCronTask` 丢弃 `displayName` | service 写入 Record 时需传入 `createdByName` |
| Record 承载 `createdByName` | `CronTaskRecord` 无该字段 | gateway contract 需新增字段 |
| SQLite 存储列 | 表无 `created_by_name` 列 | schema 需新增列 |
| API 响应 DTO 包含 `createdByName` | `projectCronTaskManagement` 不投影该字段 | channel projection 需补充 |
| View 包含 `createdByName` | `CronTaskManagementView` 无该字段 | channel contract 需新增字段 |
| 前端展示 `createdByName` | 前端已有字段定义和展示逻辑，但后端不返回 | 后端打通后前端自动生效 |

### 修改方案

**gateway contract**：`CronTaskRecord` 新增 `createdByName?: string` 字段。该字段为 optional，已有数据为 undefined/NULL。trusted source 为 `command.identityContext.displayName`，不来自客户端请求体。

**SQLite schema**：`cron_tasks` 表新增 `created_by_name TEXT` 列。`CREATE TABLE IF NOT EXISTS` 语句增加该列。`taskSelect` 查询增加 `created_by_name`。`CronTaskRow` 接口增加 `created_by_name: string | null`。`taskFromRequiredRow` 映射该列到 `createdByName`。`createTask` 的 INSERT 语句增加 `created_by_name` 参数。

**service**：`createCronTask` 写入 Record 时从 `command.identityContext.displayName` 取值并设置 `createdByName`。`projectTask` 投影 `record.createdByName` 到 View。

**channel contract**：`CronTaskManagementView` 新增 `createdByName?: string` 字段。

**channel projection**：`projectCronTaskManagement` 投影 `record.createdByName` 到 DTO。

**前端**：前端已有 `createdByName` 字段定义和 `taskOwner` 展示逻辑，无需修改；后端打通后自动生效。

**质量属性影响**：无新增黑盒质量目标。`createdByName` 是展示性字段，不影响安全边界、scope 校验或持久化一致性。

### 验证策略

- **API contract**：验证 `POST /api/v1/cron-tasks` 和 `GET /api/v1/cron-tasks` 响应 DTO 包含 `createdByName` 字段。
- **持久化**：验证创建后的任务在 SQLite 中存储了 `created_by_name`。
- **前端展示**：验证 TaskCard footer 展示 `createdByName`，值为 null 时展示 `-`。
- **negative case**：验证 `createdByName` 不来自请求体；验证旧任务（NULL 值）展示为 `-`。

## 长期基线刷新计划

| 类别 | 需要同步的文档 |
|---|---|
| stable spec | `openspec/specs/cron-task-management-api/spec.md`（ADDED + MODIFIED Requirements）、`openspec/specs/agent-web-cron-task-dashboard/spec.md`（MODIFIED Requirement） |
| Function | `openspec/designs/functions/D10-二次开发与平台集成/D10.3-测试与扩展/FN-10.9-Cron工具.md`（规格表和输出字段） |
| Feature | 无（用户价值未变化，只是补全已有展示字段） |
| overview | 无 |
| architecture | 无 |
| modules | 无 |
| ADR | 无 |
| spec-to-design-map | 无（不新增 spec 目录） |

## 风险与取舍

- **已有数据迁移**：不追溯补充旧任务的 `createdByName`，旧任务该字段为 NULL，前端展示为 `-`。这是可接受的降级，因为旧任务无法恢复创建时的 identity context。
- **字段可选性**：`createdByName` 为 optional，不破坏现有客户端兼容性。
