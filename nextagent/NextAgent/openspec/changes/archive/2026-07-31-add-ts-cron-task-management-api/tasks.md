## 1. Gateway contract 与持久化能力

- [x] 1.1 扩展 `CronTaskGatewayPort`：新增 agent-scope list/load 和 `updateTask(record, options)` 写入 contract，保持 write metadata 不进入 `CronTaskRecord`。
  验证：`npm run test:contract -- tests/contract/core-contracts.test.ts tests/contract/gateway-configuration-contracts.test.ts`
  来源：`cron-task-management-api` Requirement: Cron task management API surface；design 决策 2。
- [x] 1.2 在 SQLite Cron gateway 实现 agent-scope list/load、active task update、旧 session-scoped schema 到 owner+agent task scope 的启动迁移，并添加必要索引。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/sqlite-cron-task-gateway.test.ts`
  来源：`cron-task-management-api` Requirement: Cron task management API preserves durable scheduling semantics；design 决策 2、4。
- [x] 1.3 在 remote Cron gateway reference adapter 补齐新 gateway 方法的 response validation 和 safe error mapping。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-remote/tests/remote-gateway-provider.test.ts`
  来源：`cron-task-management-api` Requirement: Cron task management API surface；design 决策 2。
- [x] 1.4 扩展 `CronTaskGatewayPort` 和 SQLite/remote adapter，支持按 trusted owner + agent + taskId 查询 trigger 执行记录。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/sqlite-cron-task-gateway.test.ts packages/agent-platform-gateway-remote/tests/remote-gateway-provider.test.ts`
  来源：`cron-task-management-api` Requirement: Cron task execution record API surface；design 决策 2。

## 2. Channel-facing Cron 管理服务

- [x] 2.1 在 `agent-contracts/channel` 新增 `CronTaskManagementPort` 与 public-safe `CronTaskManagementView`，不暴露 session/run/trigger/version/gateway record。
  验证：`npx tsc --noEmit -p tsconfig.json`
  来源：`cron-task-management-api` Requirement: Cron task management API surface；design 决策 1。
- [x] 2.2 在 `agent-app` 组合 Cron management service：注入 trusted owner、active Agent、Cron gateway、clock；REST task 创建不要求 sessionId，trigger delivery 执行时使用服务端 execution session anchor。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/cron-management-composition.test.ts`
  来源：`cron-task-management-api` Requirement: Cron task management API scope is trusted-only；design 决策 1、3。
- [x] 2.3 在 Cron management service 中实现 create/update/list/delete 的 validation、nextRunAt 计算、inactive update conflict 和 durable mutation projection。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/cron-management-composition.test.ts`
  来源：`cron-task-management-api` Requirement: Cron task management API validates task input；Requirement: Cron task management API preserves durable scheduling semantics；design 决策 4。
- [x] 2.4 在 Cron management service 中组合 trigger、request run 和 terminal timeline event，形成 execution record/result read model。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/cron-management-composition.test.ts`
  来源：`cron-task-management-api` Requirement: Cron task execution record API surface；design 决策 1、2。

## 3. Web REST API 与文档

- [x] 3.1 在 `agent-channel-web` 增加 Cron task management TypeBox schema 和四个 REST route，并把 management port 注入 `WebChannelDependencies`。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-channel-web/tests/cron-task-management-routes.test.ts`
  来源：`cron-task-management-api` Requirement: Cron task management API surface；design 决策 5。
- [x] 3.2 添加 route negative tests：拒绝 owner/agent/session/run/status/version/trigger 等未知或 forbidden 字段，缺少 management port 返回 503，跨 scope 或 unknown task 返回 404，inactive update 返回 409。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-channel-web/tests/cron-task-management-routes.test.ts packages/agent-app/tests/cron-management-composition.test.ts`
  来源：`cron-task-management-api` Requirement: Cron task management API scope is trusted-only；Requirement: Cron task management API is safe and documented。
- [x] 3.3 更新 Web API endpoint inventory 与 `docs/apis/agent-web-api-list.md`，记录四个 Cron task management endpoint 的请求、响应、错误码和 curl 示例。
  验证：`openspec validate add-ts-cron-task-management-api --strict`，并检查 endpoint inventory 与文档路径一致。
  来源：`cron-task-management-api` Requirement: Cron task management API is safe and documented；design 决策 5。
- [x] 3.4 在 `agent-channel-web` 增加 `GET /api/v1/cron-tasks/:taskId/runs` route、TypeBox schema、DTO projection 和 route tests。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-channel-web/tests/cron-task-management-routes.test.ts`
  来源：`cron-task-management-api` Requirement: Cron task execution record API surface；design 决策 5。

## 4. 产品路径验证和收尾

- [x] 4.1 增加产品路径测试：REST create 后 task 经 durable gateway 可见，local scheduler 到期后进入标准 runtime run，并可通过 execution API 查看 run/result；delete 后不再 due scan。
  验证：`npx vitest run --config vitest.config.release.ts tests/e2e/cron-task-management-api-product-path.test.ts`
  来源：`cron-task-management-api` Requirement: Cron task management API preserves durable scheduling semantics；Requirement: Cron task execution record API surface；design 决策 3。
- [x] 4.2 运行 OpenSpec 和受影响后端验证，确认无长期基线提前修改、无无关文件 staged。
  验证：`openspec validate add-ts-cron-task-management-api --strict`、`npx tsc --noEmit -p tsconfig.json`、聚焦 Vitest 命令、`git status --short`
  来源：proposal 影响范围；design 验证映射。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/cron-task-management-api/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/cron-task-execution.md`。
- 按需更新 `openspec/designs/modules/agent-channel-web.md`、`openspec/designs/modules/agent-app.md`、`openspec/designs/modules/agent-platform-gateway-local.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一 API schema、数据 owner、状态机或接口语义。
