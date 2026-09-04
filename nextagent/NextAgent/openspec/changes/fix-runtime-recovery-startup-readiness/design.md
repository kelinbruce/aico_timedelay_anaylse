## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-11.1 恢复运行状态` | server readiness 先于本地恢复完成；恢复期间新请求被接受但不执行，恢复终态后进入既有调度路径。 | `local-runtime-recovery` | `FN-11.1 恢复运行状态` |

## `FN-11.1 恢复运行状态`

### 目标与规范依据

本设计要满足的黑盒目标是：重启后实例可以尽快进入对外可用状态，后台恢复继续基于 durable facts、Agent Scope 和 Owner Scope 执行；恢复结束或降级前，新请求只排队，不与新恢复的 work 并行执行。

实现约束是 `agent-app` 只调整 lifecycle 启动顺序，不改变 runtime recovery 的扫描、claim、checkpoint、terminal takeover 或 idempotency guard ownership。`agent-runtime` 继续独占 request lifecycle 和 scheduler dispatch gating。

#### 本 Function 的目标 Requirements

canonical spec：`local-runtime-recovery`

- `MODIFIED`：`Local Runtime 启动必须执行 bounded recovery pass`

### 当前实现

`composeAppLifecycle.start()` 的当前顺序为：启动各 scheduler/worker、执行 ready validation、RAG build、同步 `await recoverRuntimeBestEffort(input)`、调用 `startPendingInputTimeoutProcessing()`，最后 `listen(input)` 并记录 `app.start.completed`。因此存在 recoverable runs 时，`app.start()` 的耗时包含 recovery pass；recovery 未完成前 deployment readiness 不能完成。

`AgentRequestLifecycleCoordinator.recoverLocalRuntime()` 已在扫描前设置 `recoveryDispatchGated=true`，在 `finally` 中复位并 `wakeScheduler()`。普通 `enqueueWork()` 在该标志为 true 时只入队，不唤醒 scheduler；`wakeScheduler()` 和 scheduler loop 也尊重该标志。因此 runtime 已具备“恢复期间新请求入队但不执行、恢复结束自动 dispatch”的边界。

`recoverLocalRuntime()` 内部会先调用 `processPendingInputTimeoutFacts()`。`startPendingInputTimeoutProcessing()` 只 arm deadline timer；`processPendingInputTimeoutFacts()` 使用单一 processing promise 和 reconcile requested 标志，重复调用不会并发执行同一批 pending-input timeout facts。`close()` 先停止 pending timeout timer，再等待 scheduler、executing runs 和 pending-input reconciliation，并保留 timeout budget。

现有 characterization 包括 `packages/agent-app/tests/app-lifecycle-composition.test.ts` 对完整 startup 顺序的断言，以及 `tests/agent-kernel/local-runtime-recovery.test.ts`、`tests/agent-kernel/session-lane-scheduling.test.ts` 对 recovery claim、调度隔离和恢复终态的断言。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| server readiness 不等待 recovery pass | `app.start()` 同步 await recovery，之后才 listen | 将 recovery 从 `app.start()` 的关键路径移到后台 |
| 恢复期间新请求被接受但不执行 | runtime 已有 `recoveryDispatchGated` 入队与 scheduler 门控 | 无 runtime 行为 GAP；需保留并用 lifecycle 测试覆盖 |
| recovery 与 pending-input timeout processing 可并发且不重复处理 | recovery 内部已复用同一 reconciliation promise | 将 `startPendingInputTimeoutProcessing()` 与后台 recovery 并发启动，不再依赖 recovery 完成后的顺序调用 |
| recovery 失败不阻塞可用性 | lifecycle helper 已捕获并输出 `runtime.recovery.degraded`，runtime finally 已恢复 dispatch | 保持降级路径，并让 `app.start()` 不等待该 promise |

### 修改方案

在 `composeAppLifecycle.start()` 中保持现有启动贡献和 `SERVER_LISTEN` 的 fail-closed 语义，顺序调整为：

1. 执行既有 scheduler、worker、ready validation 和 RAG build 阶段。
2. 执行 `listen(input)`。
3. 记录 `app.start.completed`。
4. 启动后台 `recoverRuntimeBestEffort(input)`，不 await。
5. 调用 `input.runtime.startPendingInputTimeoutProcessing()`。

`recoverRuntimeBestEffort()` 继续负责 recovery 的 started/completed/degraded 结构化日志和异常捕获，后台调用使用 fire-and-forget 但不吞掉 helper 内的降级处理。调用顺序上 recovery 先启动、pending timeout timer 后启动；由于 `recoverLocalRuntime()` 的第一个内部 await 会调用 pending timeout reconciliation，两者实际并发。该方案不新增 app 层 Promise 状态、取消 token、配置项或公共 contract。

runtime 不修改。`recoveryDispatchGated` 继续由 `recoverLocalRuntime()` 在扫描前设置，`finally` 中复位并 `wakeScheduler()`；pending-input timeout reconciliation 继续使用单 Promise 和 reconcile requested 标志。`close()` 保持现有顺序：先关闭 server 接收新工作，再调用 `runtime.close()` 等待 executing runs、scheduler 和 pending-input reconciliation，timeout budget 不变。

`AppStartupFailureStage` allowlist 保留 `RUNTIME_RECOVERY` 以维持既有 safe error 分类兼容性，但顺序改为 `SERVER_LISTEN` 在 `RUNTIME_RECOVERY` 之前，与实际启动顺序一致。`RUNTIME_RECOVERY` 本身不再由 `app.start()` 同步包装为 `APP_START_FAILED`；它保持 helper 内部降级诊断。

选择该方案的原因是它只移动 lifecycle 调度点，复用 runtime 已实现的 dispatch gate、单实例 reconciliation 和 close 等待机制，不建立第二套 recovery 调度器或 readiness 状态。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | `local-runtime-recovery`：`Local Runtime 启动必须执行 bounded recovery pass` | 复用 runtime dispatch gate 和 recovery finally 唤醒；恢复失败仍输出降级诊断并释放调度门。 | lifecycle 测试断言 start 完成先于 recovery 终态；既有 recovery integration 测试保持通过。 |
| 性能/容量 | `local-runtime-recovery`：`Local Runtime 启动必须执行 bounded recovery pass` | server listen/readiness 不等待恢复 pass，恢复期间新请求只占用既有 pending queue。 | 断言 deferred recovery 不阻塞 `app.start()`，且 listen/completed 顺序不变。 |
| 可测试性 | `local-runtime-recovery`：`Local Runtime 启动必须执行 bounded recovery pass` | 保持 lifecycle 输入可 mock，行为可用顺序和日志事件验证。 | characterization 覆盖正常、deferred recovery 和 recovery degraded。 |

## 验证策略（Verification Strategy）

Spec 行为由 `agent-app` lifecycle characterization tests 覆盖：正常启动顺序、recovery 挂起时 `app.start()` 仍完成、listen 在 recovery 终态前完成、recovery 失败输出既有降级日志并保持 start 成功。runtime 的“新请求入队但不执行”和“恢复终态后 dispatch”由既有 `tests/agent-kernel/local-runtime-recovery.test.ts` 与 `tests/agent-kernel/session-lane-scheduling.test.ts` 继续覆盖。

Design 边界由 lifecycle 断言覆盖：`app.start.completed` 在后台 recovery/pending timeout 启动前记录；两个后台动作不要求相对顺序。pending-input timeout 并发去重由 `packages/agent-runtime/tests/workflow-pending-input-timeout-resume.test.ts` 和既有 recovery integration tests 覆盖。Negative case 覆盖 listen 失败仍 fail-closed 为 `SERVER_LISTEN`，recovery 失败不变成启动失败。

整体验证使用 `agent-app` 目标测试、`agent-runtime`/agent-kernel 相关目标测试、workspace typecheck/build、OpenSpec strict validation 和 architecture gate。前端不受影响，不运行 frontend build/e2e。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/local-runtime-recovery/spec.md`：修改 `Local Runtime 启动必须执行 bounded recovery pass` 的 readiness 与 dispatch gating 行为。
- `openspec/designs/functions/D11-可靠性与韧性/D11.1-恢复与幂等/FN-11.1-恢复运行状态.md`：更新描述、处理过程和规格表中启动可用性与恢复调度事实。
- `openspec/designs/features/`：无。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/ts-backend-architecture.md`：更新 `app.start()` 阶段顺序中 server listen 与 runtime recovery 的关系。
- `openspec/designs/modules/agent-app.md`：更新 app lifecycle startup 顺序，删除 recovery 完成前的 server readiness gate。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：确认 `local-runtime-recovery` 导航仍指向正确 architecture/module 验证入口。

## 风险与取舍（Risks / Trade-offs）

readiness 提前后，平台可能在 recovery 期间发送新请求。该风险由既有 dispatch gate 承接：请求只入队，且 `recoveryDispatchGated=false` 后才唤醒 scheduler。需要防止 lifecycle 测试只断言调用顺序而漏掉“start 完成时 recovery 仍挂起”的黑盒行为。

recovery 失败后释放调度门可能让新请求执行，同时部分 recoverable run 已通过 record-level fail-closed 路径处理。该行为保持现状：pass 级失败输出降级诊断，不伪装成功；runtime close 继续等待可能存在的 executing run 并受 timeout 保护。

## 待确认问题（Open Questions）

无。
