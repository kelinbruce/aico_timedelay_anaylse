## 背景与问题（Why）

NextAgent 需要在一个正在执行的 run 中等待人的输入、确认、授权或人工接管，并在用户回答后恢复原 run。当前代码和核心契约已经有 pending input skeleton 和 answer command，但还没有完整的黑盒生命周期：创建前 checkpoint、可见投影、answer 幂等、late answer 拒绝、same-session submit conflict、取消联动和从 checkpoint 恢复原 run。

本 change 只定义“系统已经决定进入 pending 之后怎么处理”。首版 pending intent producer 只包含两类：Hook producer 和 Capability invocation producer。Model 不直接提交 `PendingInputIntent`；policy 若需要 pending，首版必须表现为 lifecycle hook；runtime 是 pending lifecycle/internal handoff owner，不作为独立 producer 类别。两类 producer 只能把 validated pending intent 交给 runtime-owned 内部 handoff，不能创建私有 pending lifecycle。

pending intent 的承载对象复用 `refine-ts-pending-input-contracts` 冻结的 `agent-contracts/runtime` 中的 `PendingInputIntent` contract DTO；它不是新的领域对象、gateway record 或 client payload。Hook producer 通过 `LifecycleHookPort.invoke(...)` 返回的 `HookResult{ decision: "PEND", pendingInputIntent }` 进入 runtime lifecycle executor；Capability invocation producer 通过 refinement 定义的 `AgentRunStatePort.requestPendingInput(run, context, intent)` 进入同一 runtime-owned handoff。该方法创建 pending fact 并返回 safe `PendingInputRequest`，但不等待 answer、不暴露为 public Web command，也不允许 capability 私有保存等待状态。`requestPendingInput(...)` 成功返回后，Agent/core 必须立即通过 refinement 定义的显式 `AgentExecutionOutcome{ status: "PENDING_INPUT" }` 告诉 runtime 本次 `Agent.execute(...)` 已暂停但 run 未完成；runtime 不得把该返回或后续 post-handoff path 当成 completed/failed terminal path。

## 变更范围（What Changes）

- 建立 runtime-owned pending input core 生命周期：创建、持久化、`USER_INPUT_REQUIRED` timeline/stream projection、answer、`USER_INPUT_RECEIVED`、取消、late answer 拒绝和恢复原 run。
- 在 pending input 对客户端可见前，runtime MUST 已保存可恢复 checkpoint。
- 实现并消费 `refine-ts-pending-input-contracts` 定义的 `AgentExecutionOutcome`：`COMPLETED` 走既有 terminal commit；`PENDING_INPUT` 在 pending handoff 成功后立即停止当前调度、保持 run 非终态并等待 answer。
- 保证同一 run 同一时间最多一个 `PENDING` pending input。
- 同一 owner+agent+session 存在 active pending input 时，普通 submit MUST 返回 safe conflict，并包含 pending input 的 safe reference/summary；不得创建新 run、不得 queue、不得 supersede。
- answer 接收后，pending input 先通过 gateway resolve idempotency + CAS 变为 `RECEIVED`，再恢复原 run 的下一段执行；runtime/core 消费 durable pending fact 上的 runtime-owned minimal `producerRef` 派生 Hook vs Capability resume 分支；Hook producer 恢复 lifecycle gate，Capability invocation producer 使用 `producerRef.toolCallId` 将 answer materialize 为原 producer tool call 的 capability result 后继续。
- pending 期间不释放 same-session lane，不新增 `RunStatus`。
- channel 只投影 `PendingInputRequest` 并提交 `PendingInputAnswer`；gateway 只保存 facts 和 resolve idempotency anchor；capability/core 不拥有私有 pending lifecycle。

## 架构约束下的修改说明

- 需要修改：主要修改 `agent-runtime` 的 pending intent 内部 handoff、checkpoint-before-visible、answer/cancel/resume 和 same-session active pending guard；只按 `refine-ts-pending-input-contracts` 消费 `agent-contracts/gateway` 的 fact query/resolve surface。
- 修改后的变化：pending input 成为 original run 的 child lifecycle fact，用户可见等待状态来自 `PendingInput.status` 和 `USER_INPUT_*`，而不是新增 root request 或新增 `RunStatus`。
- 影响：same owner+agent+session 在 active pending 期间会拒绝普通 submit，避免另一个设备或后续请求越过等待 run 写 terminal/history；answer accepted 后先落 `RECEIVED` fact，再恢复原 run。
- 边界：channel 不创建 pending，只做 safe projection 和 answer command boundary；gateway 不返回 lifecycle decision；Hook producer 只能通过 `HookResult.pendingInputIntent` 表达 pending decision；Capability invocation producer 只能通过 refinement 定义的 `AgentRunStatePort.requestPendingInput` 提交 validated `PendingInputIntent` 并立即返回 `AgentExecutionOutcome.PENDING_INPUT`；受保护 capability 调用前确认/授权归 `BEFORE_CAPABILITY_INVOKE` Hook producer，不归 capability invocation producer；未来 policy producer 若不是 lifecycle hook，必须另行 change 后复用同一 runtime-owned handoff。任何上游都不能等待用户、保存私有恢复状态或直接 resolve pending。

## Capability 影响（Capabilities）

### 新增 Capability

- `human-pending-input-core`：runtime-owned human interaction pending lifecycle。

### 修改的 Capability

- `ts-run-status-visibility`：消费 runtime pending facts 做 `USER_INPUT_*` 投影，不改变 projection ownership。
- `session-lane-scheduling`：补充 active pending 对 same-session submit 和 lane dispatch 的 blocking 语义。

## 影响范围（Impact）

- 主要 owner：`agent-runtime`。Hook producer 和 Capability invocation producer 只提交 pending intent 或消费恢复结果；`agent-channel-web` 只做 safe projection 和 answer command boundary；gateway adapters 只实现 facts/resolve idempotency；governance/observability 只 review safe refs。
- 影响 package：`agent-runtime`、`agent-contracts/runtime`、`agent-contracts/gateway`、`agent-core` resume/materialization path、`agent-channel-web` projection、gateway adapters、contract/runtime/integration tests。
- 依赖：`refine-ts-pending-input-contracts`、`add-ts-session-lane-scheduling`、`add-ts-run-status-visibility`。
- 非目标：不定义 question/confirmation/authorization/handoff 的 type-specific validation；不实现 timeout；不新增 Web cancel-pending API；不释放 lane；不新增 run status；不新增 lifecycle stage；不新增 checkpoint trigger；不新增除 runtime-owned minimal `producerRef` 之外的 pending record producer/tool-call 字段，且 `producerRef` 不携带 client-controlled、policy-bearing、scope-bearing 或 capability-private 状态。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/human-pending-input-core/spec.md`：新增 runtime pending lifecycle 行为契约。
- `openspec/specs/session-lane-scheduling/spec.md`：补充 active pending 对 same-session submit/lane 的 blocking 语义。
- `openspec/designs/architecture/runtime-boundaries.md`：补充 pending lifecycle 状态机、pending intent internal handoff、checkpoint-before-visible、answer resume flow。
- `openspec/designs/modules/agent-runtime.md`、`agent-channel-web.md`、gateway 模块文档：补充各模块职责和非职责。
- `openspec/designs/spec-to-design-map.md`：补充导航。
