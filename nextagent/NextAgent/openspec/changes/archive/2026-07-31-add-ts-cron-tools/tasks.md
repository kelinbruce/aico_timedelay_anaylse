## 1. Gateway contract

- [x] 1.1 在 `agent-contracts/gateway` 定义 Cron task/trigger Record、scoped query、write options 与 async `CronTaskGatewayPort`，并从 public subpath 导出。
  验证：`npm run test:contract -- --run tests/contract/core-contracts.test.ts`；类型测试覆盖 Record 不继承 request、write metadata 不进入 Record。
  来源：`cron-tools` Durable Cron task；design 决策 1。
- [x] 1.2 定义原子 `claimCronTrigger` composite write 与稳定重复结果，锚点唯一性为可信 scope + task + scheduledAt。
  验证：gateway contract test 并发调用两次并断言只有一个新 trigger fact。
  来源：`cron-tools` 到期触发与幂等执行；design 决策 1。
- [x] 1.3 增加 negative contract/architecture test，实际断言缺少 owner/agent scope、客户端覆盖 scope、generic records store 和跨 contract private import 均不能成为合法产品实现。
  验证：`npm run test:contract` 与 `npm run lint:architecture` 实际触发 forbidden fixture 失败断言。
  来源：AGENTS 架构边界；`cron-tools` 可信回调与执行恢复。

## 2. Cron Tool 收敛

- [x] 2.1 将 Cron Tool 的 create/list/delete action 依赖改为稳定 gateway port 窄适配，保持 schema、safe result 和受信 execution context scope。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/cron-tools.test.ts`。
  来源：`cron-tools` Cron Tool 调用；`builtin-tool-framework` Cron Tool 受控依赖。
- [x] 2.2 删除产品 composition 对 `createInMemoryCronTaskPort` 的依赖，将内存实现降为 test fixture。
  验证：architecture test 读取产品入口并断言不存在 in-memory Cron store；缺失 gateway dependency 测试断言 fail closed。
  来源：`builtin-tool-framework` Cron Tool 受控依赖；proposal 产品路径约束。
- [x] 2.3 补齐非法 cron、空 prompt、未知字段、跨 owner/agent/session 查询和删除 negative tests。
  验证：agent-capability Cron tests 实际调用非法输入并断言 validation/safe failure。
  来源：`cron-tools` Cron Tool 调用与可信 scope。
- [x] 2.4 将 canonical `Cron` Tool 标记为 `EAGER`，并在 checked-in LOCAL 默认配置中选择 SQLite-backed `cron-tasks` adapter；补测试证明 `tool-search` 模式首轮模型调用直接包含 `Cron`，且缺少 dependency 时仍 fail closed。
  验证：Cron descriptor/unit test、default config assembly test、ToolSearch disclosure model-input test。
  来源：`cron-tools` Cron is an eager built-in Tool；用户要求 Cron 默认加载且不依赖 ToolSearch 激活。
- [x] 2.5 为 Cron create/list/delete 增加 action-aware LUI safe projection，复用 `CAPABILITY_RESULT_DELTA`，列表最多投影 50 项且不暴露 prompt；补 Web projection 单测和 HTTP SSE e2e。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-channel-web/tests/cron-result-projection.test.ts tests/e2e/cron-tool-calling-product-path.test.ts`。
  来源：`cron-tools` Cron 结果安全投影到 LUI；用户要求 Cron Tool Calling 返回在 LUI 可见。

## 3. LOCAL durable adapter

- [x] 3.1 在 gateway-local 新增 `cron_tasks`、`cron_triggers` 专用表、row mapping、scope/due index 与 CRUD。
  验证：gateway-local integration test 创建、重启、查询、删除并检查 scope isolation。
  来源：`cron-tools` Durable Cron task；design 决策 2。
- [x] 3.2 在单一 SQLite transaction 实现 trigger claim、recurring/one-shot 状态推进和 requestRun binding CAS。
  验证：并发 claim、one-shot、crash-window/retry integration tests。
  来源：`cron-tools` 到期触发与幂等执行；design 决策 1、4。
- [x] 3.3 实现每秒扫描、每批 100 的 local scheduler，并纳入 start/stop lifecycle；满批立即继续，shutdown 停止新 delivery。
  验证：fake clock scheduler tests 覆盖 101 个 due task、stop 和 restart 未绑定 trigger 重投。
  来源：`gateway-configuration` Local selection；design 决策 2 与性能/恢复结论。

## 4. REMOTE Cron service adapter

- [x] 4.1 在 gateway-remote 定义 vendor-neutral Cron service client adapter，映射 create/list/delete/get-trigger/bind-run 并 runtime validation response。
  验证：gateway-remote adapter tests 覆盖正常映射、AbortSignal 与 malformed vendor response。
  来源：`cron-tools` Durable Cron task；design 决策 2。
- [x] 4.2 将 remote timeout/auth/vendor body 映射为稳定 safe error，negative test 断言 raw error/credential 不进入返回值和日志。
  验证：gateway-remote security tests 使用含 secret 的 vendor error 并断言 redaction。
  来源：`cron-tools` Cron 安全可观测性；design 安全结论。

## 5. Callback 安全边界

- [x] 5.1 实现 transport-neutral callback schema 与 HMAC-SHA256 verifier，固定 5 分钟 freshness，并通过 credential resolver 获取 secret。
  验证：callback contract tests 覆盖合法签名、过期、未来时间、错误签名和缺 secret。
  来源：`cron-tools` 可信回调与执行恢复；design 决策 3。
- [x] 5.2 实现 durable task/trigger lookup，禁止 callback 提供 prompt/identity/agent/session，并校验 deleted/missing/scope mismatch。
  验证：negative tests 实际发送注入字段、未知 task、deleted task 和 scope mismatch，断言零 runtime submit。
  来源：`cron-tools` 可信回调与执行恢复。
- [x] 5.3 实现 duplicate callback 幂等返回，确保同一 trigger 只绑定一个 requestRun。
  验证：callback integration test 并发投递两次并断言 submit count=1、requestRunId 相同。
  来源：`cron-tools` 到期触发与幂等执行。

## 6. Runtime execution 接线

- [x] 6.1 新增 app-owned Cron delivery adapter，从 durable task 恢复 command 并调用现有 runtime submit，不让 gateway/callback 依赖 agent-core/model。
  验证：architecture test 与 composition integration test。
  来源：`ts-minimal-agent-kernel` Cron trigger 使用标准 request lifecycle；design 决策 4。
- [x] 6.2 补 characterization tests，证明 Cron request 与用户 request 共享 same-session lane、acceptance 固化 Agent assembly、取消与 terminal commit 语义不变。
  验证：`tests/agent-kernel` Cron lifecycle characterization tests。
  来源：`ts-minimal-agent-kernel` Cron trigger 使用标准 request lifecycle。
- [x] 6.3 增加 task/trigger/requestRun 安全观察事件与 audit 投影，不记录 prompt/raw callback/vendor error。
  验证：observability tests 断言允许字段与 forbidden content 缺失。
  来源：`cron-tools` Cron 安全可观测性；design 审计结论。

## 7. Gateway selection 与 composition

- [x] 7.1 扩展 gateway configuration/provider bindings，LOCAL/REMOTE Cron adapter 必须恰好选择一个且缺 binding fail fast。
  验证：`tests/contract/gateway-configuration-contracts.test.ts` 覆盖 local、remote、unsupported、missing binding。
  来源：`gateway-configuration` Cron gateway adapter selection。
- [x] 7.2 在 app composition 装配 Cron gateway、local scheduler 或 remote callback handler，并保证 remote 模式不启动 local scanner。
  验证：composition tests 与 architecture test 断言两模式互斥及 lifecycle stop。
  来源：`gateway-configuration` Cron gateway adapter selection；design 决策 2。

## 8. E2E 与门禁

- [x] 8.1 增加模型驱动 `Cron(action=create) -> Cron(action=list) -> Cron(action=delete)` e2e，断言 tool calling、durable list projection 和删除结果。
  验证：`npx vitest run --config vitest.config.release.ts tests/e2e/cron-tool-calling-product-path.test.ts`。
  来源：proposal e2e 范围；`cron-tools` Cron Tool 调用。
- [x] 8.2 增加 local due trigger 与 remote signed callback 两条 e2e，断言标准 timeline、唯一 request run、duplicate callback 非重入及 terminal commit。
  验证：`npx vitest run --config vitest.config.release.ts tests/e2e/cron-trigger-product-path.test.ts`。
  来源：`cron-tools` 到期触发/可信回调；`ts-minimal-agent-kernel` lifecycle。
- [x] 8.3 执行全量验证并记录实际结果；任何 P0/P1 或 minimal kernel regression 必须修复后才能勾选。
  - 2026-07-11：`npm run build` 通过；`npm test` 79 files passed、1 skipped / 558 tests passed、1 skipped；`npm run test:contract` 28 files / 237 tests passed；`npm run lint:architecture` 29 files / 179 tests passed且 dependency-cruiser 无违规；`openspec validate --all --strict` 184/184；Cron trigger release e2e 2/2。
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`。
  来源：AGENTS 验证门禁与 proposal 验证入口。
- [x] 8.4 检查并清理本 change 产生的 dead code、重复 schema、临时 fixture 和产品路径 no-op/in-memory provider。
  - 已删除未使用的 test-only provider 扩展，Cron runtime 装配移出 bounded `create-app` facade，产品路径仅保留 durable gateway；进程内 Cron store 仅由测试 fixture 使用。
  验证：`git diff --check`；semantic code review 检查所有新增 export 均有产品或测试消费者。
  来源：AGENTS 实现质量门禁。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前按 proposal/design 更新 `cron-tools` 及三个修改 capability 的 stable specs、overview、`architecture/cron-task-execution.md`、受影响 module docs、`adr/cron-scheduling-boundary.md` 和 spec-to-design-map；同一 Record/port/state/idempotency/callback 语义只由 architecture 文档主承载。
