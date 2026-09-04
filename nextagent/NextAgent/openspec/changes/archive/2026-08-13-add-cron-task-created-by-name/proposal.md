## Why

用户在定时任务看板查看任务卡片时，footer 右侧的"创建人"字段永远为空（显示为 `-`）。原因是定时任务从创建到展示的整条链路中，创建者的显示名称（`IdentityContext.displayName`）在创建时就被丢弃，未持久化、未在 API 响应中投影、未传递到前端 DTO。用户无法区分某个定时任务是谁创建的，在多用户协作场景下影响任务归属追溯。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 用户创建定时任务时，系统 MUST 将创建者的显示名称与任务一起持久化。
- Cron task management API 的创建、更新和列表响应 MUST 在每个任务 DTO 中返回 `createdByName` 字段。
- 定时任务看板卡片 footer 右侧 MUST 展示创建者显示名称；当名称不可用时 MUST 展示一个占位符（如 `-`），不得展示 `undefined`、`null` 或空字符串。

**非目标：**

- 不改变定时任务的 owner scope 隔离机制；`createdByName` 是展示性字段，不参与 scope 校验或权限控制。
- 不追溯补充已存在的旧任务的 `createdByName`；只对新创建的任务生效。
- 不在 cron trigger 或 execution 记录中增加 `createdByName`；该字段只属于 task。
- 不修改 `IdentityContext` 的 trusted source 或传递机制。

## What Changes

### 修改

- Cron task management API 创建任务时 MUST 从 trusted identity context 提取创建者显示名称并持久化。
- Cron task management API 的任务响应 DTO MUST 包含 `createdByName` 字段。
- agent-web cron task dashboard 的任务卡片 MUST 从 API 响应读取 `createdByName` 并展示。

## Function 影响（OpenSpec Capabilities）

### 修改的 Function

- `FN-10.9 Cron 工具` → `specs/cron-task-management-api/spec.md`（canonical spec）
  - 功能边界：创建任务时持久化创建者显示名称；任务响应 DTO 新增 `createdByName` 字段
  - 系统质量属性：可维护性、审计/可追溯性
  - 映射说明：canonical spec 为 `cron-task-management-api`；本次同步触及 `agent-web-cron-task-dashboard` spec 的卡片展示行为

## 影响范围（Impact）

- **actor：** 用户在定时任务看板能看到任务创建者名称，提升多用户场景下的任务归属可识别性。
- **公共 API：** `POST /api/v1/cron-tasks`、`PUT /api/v1/cron-tasks/:taskId`、`GET /api/v1/cron-tasks` 的响应 DTO 新增 `createdByName` 字段；新增字段为 optional string，不破坏现有客户端兼容性。
- **持久化：** `cron_tasks` 表新增 `created_by_name` 列；已有数据该列为 NULL，前端展示为占位符。
- **前端：** `CronTaskDashboardPage` 的 `TaskCard` 组件从响应中读取 `createdByName` 并展示。
- **测试：** 需补充 API 响应包含 `createdByName` 的 contract 测试和前端卡片展示测试。
