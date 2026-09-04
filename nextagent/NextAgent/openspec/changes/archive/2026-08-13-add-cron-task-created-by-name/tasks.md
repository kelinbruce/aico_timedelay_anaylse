## 0. 跨 Function 前置门禁

- [x] 0.1 OpenSpec 验证：`openspec validate --all --strict` 通过，确认 delta specs 与 stable spec 标题精确匹配
  来源：proposal scope
  验证：`npx openspec validate --all --strict`

## 1. `FN-10.9 Cron 工具`

- [x] 1.1 编写 API contract 测试：验证 `POST /api/v1/cron-tasks` 响应 DTO 包含 `createdByName` 字段且值为 identity context 的 `displayName`
  来源：`FN-10.9` + `Cron task management API persists creator display name` + `Create task persists creator display name`
  验证：`npx vitest run --config vitest.config.channel-web.ts packages/agent-channel-web/tests/cron-task-management-routes.test.ts`，新增测试在实施前失败、实施后通过

- [x] 1.2 编写 API contract 测试：验证 `GET /api/v1/cron-tasks` 响应中每个 task DTO 包含 `createdByName` 字段
  来源：`FN-10.9` + `Cron task management API persists creator display name` + `Task list response includes creator display name`
  验证：同 1.1

- [x] 1.3 编写 negative case 测试：验证 `createdByName` 不来自客户端请求体，且旧任务（NULL）的 `createdByName` 为 `null`
  来源：`FN-10.9` + `Cron task management API persists creator display name` + `Task with missing creator display name returns null`
  验证：同 1.1

- [x] 1.4 gateway contract：`CronTaskRecord` 新增 `createdByName?: string` 字段
  来源：design「修改方案 — gateway contract」
  验证：`cd packages/agent-contracts && npx tsc --noEmit`

- [x] 1.5 SQLite gateway：`cron_tasks` 表 schema 新增 `created_by_name TEXT` 列；`CronTaskRow` 增加 `created_by_name`；`taskSelect` 增加该列；`taskFromRequiredRow` 映射该列；`createTask` INSERT 增加该参数
  来源：design「修改方案 — SQLite schema」
  验证：`cd packages/agent-platform-gateway-local && npx tsc --noEmit`

- [x] 1.6 service：`createCronTask` 从 `command.identityContext.displayName` 设置 `record.createdByName`；`projectTask` 投影 `record.createdByName`
  来源：design「修改方案 — service」
  验证：`cd packages/agent-app && npx tsc --noEmit`

- [x] 1.7 channel contract：`CronTaskManagementView` 新增 `createdByName?: string` 字段
  来源：design「修改方案 — channel contract」
  验证：`cd packages/agent-contracts && npx tsc --noEmit`

- [x] 1.8 channel projection：`projectCronTaskManagement` 投影 `record.createdByName` 到 DTO
  来源：design「修改方案 — channel projection」
  验证：`cd packages/agent-channel-web && npx tsc --noEmit`

- [x] 1.9 运行 1.1-1.3 的测试，确认全部通过
  来源：`FN-10.9` + `Cron task management API persists creator display name` 全部 Scenarios
  验证：`npx vitest run --config vitest.config.channel-web.ts packages/agent-channel-web/tests/cron-task-management-routes.test.ts`

- [x] 1.10 前端测试：验证 TaskCard footer 展示 `createdByName`，值为 null 时展示 `-`
  来源：`FN-10.9` + `Cron task dashboard lists manageable tasks` + `Dashboard renders task list`
  验证：`cd frontend/agent-web && npx vitest run tests/CronTaskDashboardPage.test.tsx`

- [x] 1.11 整体验证：根目录 `npm run build` 和 `npm run lint:architecture` 通过
  来源：proposal scope
  验证：`npm run build && npm run lint:architecture`

## 2. 归档前更新基线检查

- [x] 2.1 归档前同步 stable spec：`cron-task-management-api` 和 `agent-web-cron-task-dashboard`；同步 Function 文档 `FN-10.9` 规格表
  来源：design「长期基线刷新计划」
  验证：`npx openspec validate --all --strict` 通过，且 Function 规格表包含 `createdByName` 规格项
