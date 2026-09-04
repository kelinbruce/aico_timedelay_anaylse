## 1. Contract 与可信 composition

- [x] 1.1 将 `SystemListRecoverableRunsRequest` 替换为必含 `agentId`、`now`、`limit` 的 `AgentListRecoverableRunsRequest`，同步 `RequestRunStoreGateway`、所有 adapter 和 test doubles，不保留旧 alias 或 overload。
  验证：运行 `npm run build`，并用 `rg "SystemListRecoverableRunsRequest" packages tests` 断言旧 contract 无产品/测试引用。
  来源：`local-run-timeline-store` Requirement `listRecoverableRuns`；design D2。

- [x] 1.2 为 `RequestLifecycleCoordinator` 增加不可变 `recoveryAgentId` dependency，并由 `agent-app` 从可信 hosted-agent composition 注入，不把 `agentId` 加入 `LocalRuntimeRecoveryOptions` 或 Web/channel contract。
  验证：更新并运行 `packages/agent-app/tests/composition.test.ts` 和相关 runtime construction tests；增加 negative architecture assertion，实际断言 recovery options/Web schema 不接受 `agentId`。
  来源：`local-runtime-recovery` Requirement `Local Runtime 启动必须执行 bounded recovery pass`；design D1。

- [x] 1.3 由 `agent-app` composition 为 recovery claim 提供进程生命周期内稳定、并发实例间不同的安全 instance identifier，并保持测试可显式覆盖 `lockedBy`。
  验证：运行 app composition unit tests，断言同一 composed app 重复 recovery 使用稳定 holder，不同 fixture instance 使用不同 holder；code review 检查 identifier 不含 path、credential、tenant/user。
  来源：design D5；质量属性“审计/可追溯性”。

## 2. Gateway Agent Scope 与 lease discovery

- [x] 2.1 在首版 `request_runs` 建表定义中增加 nullable `locked_by`、`lock_expires_at`，并让唯一 row mapping owner 在每次 `putRun` 时同步写入 Record lease 字段和 JSON；不增加 migration 或旧库兼容逻辑。
  验证：gateway row mapping test 在新库 claim 后断言 typed columns 与 `RequestRunRecord` 一致；运行 `tests/agent-kernel/local-gateway-contract.test.ts`。
  来源：`local-run-timeline-store` Requirement `listRecoverableRuns`；design D3。

- [x] 2.2 修改 SQLite `listRecoverableRuns`，在 SQL 层按 `request.agentId`、recoverable status、terminal commit state 和 typed `lock_expires_at <= request.now` 筛选，并保持 `updated_at ASC, created_at ASC, run_id ASC` 与 `1..1000` limit。
  验证：运行 `tests/agent-kernel/local-gateway-contract.test.ts` 和 `npm run test:contract`；不得使用 `json_extract` 或读取全局 rows 后在 TypeScript 中过滤。
  来源：`local-run-timeline-store` Requirement `listRecoverableRuns`；design D3。

- [x] 2.3 在 SQLite 初始化中增加 `idx_request_runs_recovery` 复合索引，不修改 public `RequestRunRecord` shape 或 persistence ownership。
  验证：gateway initialization test 创建新库并检查索引存在；运行 `npm run build`。
  来源：design D3；质量属性“性能/容量”。

- [x] 2.4 补充 gateway contract positive tests，验证同一 Agent 下不同 tenant/subject 的 recoverable runs 均可发现、排序稳定、limit 生效、有效 lease 被排除且过期 lease 可发现。
  验证：运行 `tests/agent-kernel/local-gateway-contract.test.ts`，测试使用固定 clock 和明确 records，不依赖测试执行顺序。
  来源：`local-run-timeline-store` Requirement `listRecoverableRuns` 的 owner aggregation、lease、ordering scenarios。

- [x] 2.5 补充 gateway contract negative tests，实际写入 Agent A/B 的 recoverable runs，断言 Agent A 查询绝不返回 Agent B；对 `claimRun` 分别使用错误 tenant、subject、agent 并断言 `NOT_FOUND` 且记录未变化。
  验证：运行 `tests/agent-kernel/local-gateway-contract.test.ts` 和 `npm run test:contract`。
  来源：`local-run-timeline-store` Requirements `claimRun`、`listRecoverableRuns`、`RequestRunStoreGateway contract tests`。

## 3. Runtime claim-before-rebuild

- [x] 3.1 在 recovery loop 中使用不可变 `recoveryAgentId` 调用 Agent-scoped discovery，并增加一个私有 claim helper，统一从 candidate record 组装 Agent Scope、Owner Scope、run/version 和 lease 参数。
  验证：运行 `tests/agent-kernel/local-runtime-recovery.test.ts`；code review 检查 helper 不接受 channel/client identity，scope 只来自 composition 和 durable record。
  来源：`local-runtime-recovery` Requirements `Local Runtime 启动必须执行 bounded recovery pass`、`Executing recovery 必须先 claim 再继续`；design D1、D4。

- [x] 3.2 将 `ACCEPTED`、`QUEUED`、`PLANNING` recovery 改为 claim 成功后才调用 `rebuildQueuedRun`，并使用 claim 返回的最新 record；claim conflict/not-found 计入 skipped，不 enqueue 或 fail 已被其他实例接管的 run。
  验证：运行 `tests/agent-kernel/local-runtime-recovery.test.ts`，覆盖三个 queued-like states 的 `UPDATED` 与 conflict 路径。
  来源：`local-runtime-recovery` Requirements `Recoverable run classification 必须使用 durable facts`、`Queued recovery 必须从 durable runs 重建 scheduler work`；design D4。

- [x] 3.3 保持 `EXECUTING` 使用同一 claim helper，并确认 terminal `PENDING/RETRYING` 继续只走既有 terminal idempotency/CAS reconciliation，不重新调用 Agent、Model 或 Capability。
  验证：运行 existing executing/terminal recovery tests，并增加断言 terminal takeover 的 Agent execute count 为 0。
  来源：`local-runtime-recovery` Requirements `Recoverable run classification 必须使用 durable facts`、`Executing recovery 必须先 claim 再继续`；design D4。

- [x] 3.4 增加同 Agent 双实例共享 gateway 的 concurrency characterization test，两个 recovery pass 同时发现同一个 queued run 时只允许一个 claim 成功、一个 work 入队和一次 execution。
  验证：运行 `tests/agent-kernel/local-runtime-recovery.test.ts --maxWorkers=1`，断言 execution count、terminal event 和 terminal message 均为 1。
  来源：`local-runtime-recovery` Scenario `Claim conflict prevents duplicate queued rebuild`；质量属性“可靠性/恢复”。

- [x] 3.5 增加 runtime 跨 Agent negative characterization test，当前 Agent runtime 面对共享 gateway 中另一个 Agent 的 recoverable run 时 scanned/rebuilt/claimed 均为 0，且该 run/version/lease 保持不变。
  验证：运行 `tests/agent-kernel/local-runtime-recovery.test.ts`，实际断言错误 Agent 的 execute callback 未调用且持久化记录未变化。
  来源：`local-runtime-recovery` Scenario `Recovery 使用 Agent-scoped bounded durable scan`；安全质量属性。

## 4. 验证和收尾

- [x] 4.1 运行 focused recovery/gateway suites，修正所有受 contract rename 影响的 fixtures，并确认不存在 test-only 旧全局扫描实现。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/local-runtime-recovery.test.ts tests/agent-kernel/local-gateway-contract.test.ts --maxWorkers=2`；`rg "SystemListRecoverableRunsRequest" packages tests` 无结果。
  来源：proposal 影响范围；design 验证映射。

- [x] 4.2 执行完整工程门禁并记录逐项结果，不以 focused tests 代替 minimal kernel、contract 或 architecture non-regression。
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict` 全部通过。
  来源：AGENTS.md 验证门禁；design 质量属性和验证映射。

- [x] 4.3 对最终 diff 执行模型语义 review，检查 frozen core contract、Agent/Owner Scope、queued/executing concurrency、terminal idempotency、安全诊断、Clean Code 和无临时 dead code。
  验证：使用 `$nextagent-code-review`，结论必须为 PASS 或无 P0/P1 的 PASS WITH FOLLOW-UP；push 前若发现 P0/P1 必须修复并重检。
  来源：AGENTS.md Push 门禁；proposal contract-sensitive impact。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前执行 design 的 Baseline Promotion Plan：同步两个 stable specs；更新 `core-contracts`、现有 runtime recovery architecture 视图，以及 `agent-runtime`、`agent-platform-gateway-local`、`agent-app` 模块设计；更新 `spec-to-design-map`。不新增 ADR，并检查长期文档没有重复定义 recovery contract、scope 或 claim 状态机。
