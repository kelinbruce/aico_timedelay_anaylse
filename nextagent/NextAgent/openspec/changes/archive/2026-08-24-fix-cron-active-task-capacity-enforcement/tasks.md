## 0. 跨 Function 前置门禁

- [x] 0.1 创建本 change 的 proposal、design、两个 delta spec 和 tasks，并确认 Function 汇总、需群内确认和唯一实现路径完整
  来源：proposal/design/specs
  验证：`npx --yes openspec validate --all --strict`

## 1. `FN-10.9 Cron 工具`

### 目标行为测试

- [x] 1.1 SQLite gateway 测试：第 50 个 ACTIVE task 成功，第 51 个以 `CRON_TASK_LIMIT_REACHED` 失败且无 side effect
  来源：spec `第 50 个 ACTIVE task 被接受`、`第 51 个 ACTIVE task 被拒绝`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/sqlite-cron-task-gateway.test.ts`

- [x] 1.2 SQLite gateway 测试：COMPLETED/DELETED 不占额度，one-shot 完成后释放额度
  来源：spec `COMPLETED 和 DELETED task 不占用额度`、`完成一次性任务释放额度`
  验证：同 1.1

- [x] 1.3 SQLite gateway 测试：tenant/subject/agent scope 隔离
  来源：spec `容量按 trusted scope 隔离`
  验证：同 1.1

- [x] 1.4 SQLite gateway 测试：50 条满额时幂等重放返回首次结果
  来源：spec `幂等重放不受容量限制影响`
  验证：同 1.1

- [x] 1.5 capability adapter 与 management service 测试：optional active-count 满额时提前返回同一稳定错误，且不调用 durable create
  来源：design `可选 active-count 预检`、spec Tool/Web 共享容量语义
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/cron-gateway-observation.test.ts packages/agent-app/tests/cron-management-composition.test.ts`

- [x] 1.6 Web route 测试：`POST /api/v1/cron-tasks` 满额返回 409、稳定 code、safe message，且不泄漏内部事实
  来源：spec `超限创建返回 409`、`超限错误不泄漏内部事实`
  验证：`npx vitest run --config vitest.config.channel-web.ts packages/agent-channel-web/tests/cron-task-management-routes.test.ts`

### 实现

- [x] 1.7 `agent-common` 固化 `CRON_MAX_TASKS_PER_SCOPE = 50` 和共享 `cronTaskLimitReachedError` 工厂，统一稳定错误 shape
  来源：design `共享常量`、`错误与 Web 投影`
  验证：`npm run typecheck`、定向 ESLint

- [x] 1.8 `CronTaskGatewayPort` 新增 optional `countActiveTasksForAgent?`，不强制既有实现升级
  来源：design `可选 active-count 预检`、需群内确认
  验证：`cd packages/agent-contracts && npx tsc --noEmit`

- [x] 1.9 `SqliteCronTaskGateway` 在事务内执行 replay、ACTIVE 计数和 INSERT；收敛重复 lookup
  来源：design `LOCAL 权威 enforcement`
  验证：SQLite gateway/scheduler 测试通过

- [x] 1.10 `createGatewayCronTaskPort.addTask` 使用 optional count 做早期预检
  来源：design `可选 active-count 预检`
  验证：capability adapter 测试通过

- [x] 1.11 `cronTaskManagement.createCronTask` 使用 optional count 做早期预检
  来源：design `可选 active-count 预检`
  验证：management service 测试通过

- [x] 1.12 Cron Tool description 更新为最多 50 个 ACTIVE task，明确 COMPLETED/DELETED 不占额度
  来源：spec `Cron Tool 调用指导`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/cron-tools.test.ts`

- [x] 1.13 remote client method 为 optional；adapter 将 vendor capacity 信号归一化为固定 safe error，不泄漏 vendor message
  来源：design `REMOTE 权威边界与兼容`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-remote/tests/remote-cron-task-gateway-security.test.ts packages/agent-platform-gateway-remote/tests/remote-gateway-provider.test.ts`

- [x] 1.14 更新 `docs/apis/agent-web-api-list.md`，记录 409、`CRON_TASK_LIMIT_REACHED`、`CONFLICT` 和 `retryable=false`
  来源：spec `API 文档记录容量拒绝`
  验证：diff review、channel route test

### Function 验证

- [x] 1.15 调整既有 52-task 分页测试和 scheduler batch 测试，保留分页与默认 batch=100 覆盖
  来源：design `测试调整`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/cron-management-composition.test.ts packages/agent-platform-gateway-local/tests/local-cron-task-scheduler.test.ts`

- [x] 1.16 确认 Cron trigger/execution、Tool calling、management product path 无回归
  来源：最小内核非回归
  验证：`npx vitest run --config vitest.config.release.ts tests/e2e/cron-trigger-product-path.test.ts tests/e2e/cron-task-management-api-product-path.test.ts`

## 2. 契约确认与整体验证

- [x] 2.1 更新 contract/remote test fake 与 NetAgent external dependency guard
  来源：gateway contract change
  验证：`npm run test:contract`、`npm run lint:architecture`

- [x] 2.2 根目录运行 `npm run build`
  验证：构建通过

- [x] 2.3 根目录运行 `npm test` 和 `npm run test:contract`
  验证：全量测试通过

- [x] 2.4 根目录运行 `npm run lint:architecture`
  验证：依赖、package manifest 和 architecture tests 通过

- [x] 2.5 运行 `npx --yes openspec validate --all --strict`
  验证：266 items 通过

- [x] 2.6 清理检查：无未使用 helper/export、无 debug logging、无重复 50 常量或平行 count API
  来源：AGENTS.md 实现质量门禁
  验证：`git diff --check`、定向 ESLint
