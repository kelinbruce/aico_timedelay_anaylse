## 1. 后端契约与失败用例先行

- [x] 1.1 `agent-contracts/channel` 和 `agent-contracts/gateway`：新增 Cron task target 类型与 record/view/command 字段；完成后 TypeScript contract 能表达 create、update 保持、update 清除和 query target。
  来源：`Cron task management API supports explicit target binding`；`目标设计` 1、2、3。
  验证：先补 contract/gateway compile-facing tests 或类型消费测试；运行 `npm run test:contract` 预期失败于缺少字段，实施后通过。

- [x] 1.2 `agent-channel-web` Cron task schema/route negative tests：覆盖 invalid target、unknown target fields、`routingConstraints`/`targetSkill`/`targetRecipe` 禁入和 structured target + prompt directive 冲突；完成后违规输入在 gateway 前被 400 拒绝。
  来源：`Cron task target input fails closed`；Scenarios `Invalid target is rejected`、`Client cannot smuggle routing constraints through Cron task target`、`Explicit target rejects prompt directive conflict`。
  验证：先补 `packages/agent-channel-web/tests/cron-task-management-routes.test.ts` 失败用例并确认失败；实施后运行 `npm test -- packages/agent-channel-web/tests/cron-task-management-routes.test.ts` 预期通过。

- [x] 1.3 `agent-app` Cron management service tests：覆盖 create Skill target、create Workflow target、prompt-only omit target、update target、clear target、target + directive conflict；完成后 service projection 和 validation 与 specs 一致。
  来源：`Cron task management API supports explicit target binding`；Scenarios `Create prompt-only Cron task`、`Create Skill-bound Cron task`、`Create Workflow-bound Cron task`、`Update Cron task target`、`Clear Cron task target`；`Cron task target input fails closed`。
  验证：先补 `packages/agent-app/tests/cron-management-composition.test.ts` 或同层 service tests 并确认失败；实施后运行 `npm test -- packages/agent-app/tests/cron-management-composition.test.ts` 预期通过。

## 2. Gateway 持久化与迁移

- [x] 2.1 `agent-platform-gateway-local` SQLite Cron task schema：新增 `target_kind` 和 `target_name` nullable columns，更新新库建表和旧库 migration；完成后历史 row 查询为 prompt-only，新 row target 可持久化。
  来源：`Cron task target is a durable management fact`；Scenarios `Target survives restart`、`Legacy or unbound task remains prompt-only`；`目标设计` 3；`迁移与回滚`。
  验证：先补 `packages/agent-platform-gateway-local/tests/sqlite-cron-task-gateway.test.ts` migration/restart 失败用例并确认失败；实施后运行 `npm test -- packages/agent-platform-gateway-local/tests/sqlite-cron-task-gateway.test.ts` 预期通过。

- [x] 2.2 `agent-platform-gateway-local` row-to-record validation：拒绝 `target_kind`/`target_name` 半结构化不一致 row；完成后不完整 target 不会被当作 prompt-only 静默执行。
  来源：`Cron task target is a durable management fact`；`目标设计` 3、5。
  验证：补 SQLite gateway negative test 触发不一致 row 并断言安全失败；运行 `npm test -- packages/agent-platform-gateway-local/tests/sqlite-cron-task-gateway.test.ts` 预期通过。

## 3. App service 和 delivery 映射

- [x] 3.1 `agent-app/src/cron/cron-task-management.ts`：实现 target normalize、三态 update、directive conflict validation 和 public DTO projection；完成后 create/update/list APIs 返回结构化 target 或 omit target。
  来源：`Cron task management API supports explicit target binding`；`Cron task target input fails closed`；`目标设计` 4。
  验证：运行 `npm test -- packages/agent-app/tests/cron-management-composition.test.ts packages/agent-channel-web/tests/cron-task-management-routes.test.ts` 预期通过。

- [x] 3.2 `agent-app/src/composition/cron-delivery-composition.ts`：把 durable `SKILL` target 映射到 `routingConstraints.targetSkill`，把 durable `WORKFLOW` target 映射到 `routingConstraints.targetRecipe`，无 target 不传目标约束；完成后 trigger delivery 保持标准 runtime submit 生命周期。
  来源：`Cron target delivery preserves runtime governance`；Scenarios `Target execution enters standard request lifecycle`、`Target does not override trusted scope`；`目标设计` 5。
  验证：补 delivery test 或 composition test 捕获 runtime submit command；先确认失败，实施后运行 `npm test -- packages/agent-app/tests/cron-management-composition.test.ts` 预期通过。

## 4. Web channel schema 和 API projection

- [x] 4.1 `packages/agent-channel-web/src/schemas/cron-task-management.ts` 和 routes：create/update/response schema 支持 `target`，route body allow-list 只新增 `target`；完成后公共 Cron management API 可读写 target，普通 chat submit schema 不变。
  来源：`Cron task management API supports explicit target binding`；`Cron task target input fails closed`；`目标设计` 2。
  验证：运行 `npm test -- packages/agent-channel-web/tests/cron-task-management-routes.test.ts packages/agent-channel-web/tests/web-api-schema-coverage.test.ts` 预期通过；code review 检查普通 request schemas 未新增 `targetSkill`/`targetRecipe`。

## 5. agent-web 展示与编辑

- [x] 5.1 `frontend/agent-web/src/services/cronTaskService.ts`：前端 DTO 和 create/update request 支持 optional target 与 null clear；完成后 service 按 API contract 发送结构化 target，不拼 prompt directive。
  来源：`Cron task dashboard manages explicit target binding`；Scenarios `User creates prompt-only Cron task`、`User creates Skill-bound Cron task`、`User creates Workflow-bound Cron task`、`User clears existing target`。
  验证：先补 `frontend/agent-web/tests/cronTaskService.test.ts` 失败用例并确认失败；实施后运行 `cd frontend/agent-web && npm test -- cronTaskService` 预期通过。

- [x] 5.2 `frontend/agent-web/src/pages/CronTaskDashboardPage.tsx`：任务卡片展示 API target badge，且不从 prompt 推断 Skill/Workflow；完成后 Skill/Workflow/prompt-only 三种 task 展示稳定。
  来源：`Cron task dashboard displays explicit target binding`；Scenarios `Dashboard renders Skill target`、`Dashboard renders Workflow target`、`Dashboard does not infer target from prompt text`。
  验证：先补 `frontend/agent-web/tests/CronTaskDashboardPage.test.tsx` 展示失败用例并确认失败；实施后运行 `cd frontend/agent-web && npm test -- CronTaskDashboardPage` 预期通过。

- [x] 5.3 `CronTaskDashboardPage` 表单：新增 target mode/name draft、Skill/Workflow/None 保存、编辑回填和空 target name 前端校验；完成后创建/编辑 target 不改写 prompt，不发送 routing constraints。
  来源：`Cron task dashboard manages explicit target binding`；Scenarios `User creates Skill-bound Cron task`、`User creates Workflow-bound Cron task`、`User edits existing target`、`User clears existing target`；`Cron task dashboard target selection preserves frontend ownership boundary`。
  验证：运行 `cd frontend/agent-web && npm test -- CronTaskDashboardPage` 预期通过，断言 API mock body 不包含 `routingConstraints`、`targetSkill`、`targetRecipe`。

- [x] 5.4 agent-web i18n/CSS：补充 target mode、target name、Skill、Workflow、prompt-only、target validation 文案和 badge 样式；完成后中英文界面文本不溢出、不影响现有 Cron dashboard 布局。
  来源：`agent-web Cron task dashboard` specs；`目标设计` 6。
  验证：运行 `cd frontend/agent-web && npm test -- i18n CronTaskDashboardPage` 和 `cd frontend/agent-web && npm run build` 预期通过。

## 6. 收敛验证

- [x] 6.1 OpenSpec：验证 `add-ts-cron-explicit-target-binding` artifact 严格合法；完成后 change apply-ready。
  来源：proposal 全部范围；specs 全部 Requirement。
  验证：运行 `openspec validate add-ts-cron-explicit-target-binding --strict` 预期通过。

- [x] 6.2 后端常规门禁：验证 target binding 不破坏 workspace build、contract、architecture 和既有测试。
  来源：`质量属性设计` 安全、可靠性/恢复、可维护性。
  验证：运行 `npm run build`、`npm test -- packages/agent-platform-gateway-local/tests/sqlite-cron-task-gateway.test.ts packages/agent-app/tests/cron-management-composition.test.ts packages/agent-channel-web/tests/cron-task-management-routes.test.ts`、`npm run test:contract`、`npm run lint:architecture` 预期通过。

- [x] 6.3 前端门禁：验证 agent-web target 展示/编辑和构建。
  来源：`agent-web-cron-task-dashboard` specs；`质量属性设计` 可测试性。
  验证：运行 `cd frontend/agent-web && npm test -- cronTaskService CronTaskDashboardPage i18n` 和 `cd frontend/agent-web && npm run build` 预期通过。

- [x] 6.4 Repo-wide OpenSpec：验证本 change 不破坏全量 OpenSpec 解析。
  来源：OpenSpec 工作流约束。
  验证：运行 `openspec validate --all --strict` 预期通过。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 proposal 的“归档前更新基线”归并长期事实，并检查长期文档没有重复定义同一行为、schema、owner 或接口语义。
