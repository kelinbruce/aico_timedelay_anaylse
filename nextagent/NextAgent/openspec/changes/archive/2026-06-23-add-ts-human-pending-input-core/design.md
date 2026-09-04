## 背景和现状（Context）

Roadmap 将 Human Pending Input 能力组列为 ready，并明确依赖最小内核、`PendingInputStoreGateway`、三对象契约和可持久化 answer 处理。当前代码已有 `answerPendingInput` 初始实现，但它只 load/resolve pending record，尚未覆盖 checkpoint-before-visible、`USER_INPUT_RECEIVED`、恢复原 run、active-pending submit guard、pending intent 内部 handoff 和完整 late answer 矩阵。

本 change 的核心约束是边界控制：进入 pending 的原因来自 upstream intent；进入之后的生命周期由 runtime 拥有。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 定义 pending input core 状态机和黑盒效果。
- 确保 pending visible 前已经有 checkpoint。
- 将 pending intent 收口到 runtime-owned internal handoff。
- 用显式 `AgentExecutionOutcome.PENDING_INPUT` 阻止 runtime 把已暂停的 `Agent.execute(...)` 返回误提交为 terminal outcome。
- answer 后恢复原 run，而不是创建新 run。
- same-session active pending 阻止其他设备继续提交同 session 普通消息。
- 保持 channel、gateway、capability、core 的非职责清晰。

**非目标：**

- 不定义上游什么时候请求 pending。
- 不实现 timeout。
- 不定义 type-specific answer values。
- 不新增 `RunStatus`。
- 不新增 lifecycle stage、checkpoint trigger，且不新增除 runtime-owned minimal `producerRef` 之外的 pending record producer/tool-call 字段。
- 不释放 session lane。
- 不新增 standalone cancel-pending Web API。

## 设计决策（Decisions）

### D1：pending 是原 run 的 child lifecycle fact

选定方案：pending input 持久化为绑定原 `requestRunId`、`requestContextId`、`checkpointId` 的 child fact。它不是新 root request，不创建新的 request/run。

理由：用户回答必须回到原 run 的执行上下文；新建 root request 会破坏 terminal commit、history、owner/agent scope 和 lane 语义。

### D2：pending intent 只进入 runtime-owned internal handoff

选定方案：首版只承认 Hook producer 和 Capability invocation producer 两类 pending intent producer。两类 producer 只能产生 validated `PendingInputIntent`，由 runtime 执行中的 run state / lifecycle handoff 消费。该 handoff 的黑盒结果是 checkpoint 成功、pending fact 持久化、`USER_INPUT_REQUIRED` 发布；它不是 public Web command，也不是 capability-private wait/resume state。

具体承载对象：`PendingInputIntent` 复用 `agent-contracts/runtime` 已有 contract DTO（`kind`、`questions`、`timeoutAt?`）。它不是新的领域对象，不进入 gateway `*Record`，也不是 client answer payload。

具体入口：

- Hook producer：`LifecycleHookPort.invoke(...)` 返回 `HookResult{ decision: "PEND", pendingInputIntent }`，由 runtime lifecycle hook executor 消费并进入 pending handoff。受保护 capability 调用前确认/授权属于 `BEFORE_CAPABILITY_INVOKE` Hook producer，确保副作用执行前进入 pending。
- Capability invocation producer：runtime 通过 Agent construction 注入的 `AgentRunStatePort` 实现 `refine-ts-pending-input-contracts` 定义的 `requestPendingInput(run, context, intent): Promise<PendingInputRequest>`；每次调用都必须显式携带 accepted `RequestRun` 和 trusted `RequestContext`，成功返回 safe `PendingInputRequest`，失败返回 safe conflict/error，不等待用户 answer。AskUserQuestion、后续 handoff capability 等具体 producer change 可以把 producer-local validated 人机交互意图提交到该入口，但该本地校验不替代 runtime 对 accepted run、trusted context、owner/agent scope、intent kind/shape、timeout bounds、checkpoint 可用性和 active pending conflict 的最终 acceptance validation；capability executor 不直接调用 pending store，也不在 capability-private state 中阻塞等待。
- 非 producer：Model 不直接提交 `PendingInputIntent`；policy 若需要 pending，首版必须表现为 lifecycle hook；runtime 只拥有 pending lifecycle/internal handoff，不作为独立 producer 类别。本 change 不新增通用 `PolicyPort`、policy engine，也不新增 `CapabilityInvocationRuntimeContext.requestPendingInput(...)` facade。后续具体 capability producer 若确需 capability-runtime-context facade，必须另行 change 定义窄 facade，并委托到同一个 runtime-owned handoff。

Pending kind selection is producer-owned before runtime handoff. Runtime validates lifecycle acceptance and owns pending lifecycle execution, but it does not classify business risk from model text, client payload, channel metadata, gateway records or tool arguments. `CONFIRMATION` and `AUTHORIZATION` intent kind selection must come from a trusted Agent/core lifecycle hook or capability guard, using resolved capability descriptor and explicit risk/governance policy when protected operation risk is involved. This change still does not add a generic policy port, risk engine, guard registry, or capability runtime context facade.

理由：这句话的对外黑盒效果是用户永远只看到 runtime-owned pending：刷新页面、断线重连、换电脑、cancel、timeout、same-session submit conflict 都从同一 pending fact 和 timeline fact 解释，不会出现 tool handler 自己阻塞等待、channel 自己制造 pending 或 capability 自己恢复 run。

### D3：`AgentExecutionOutcome.PENDING_INPUT` 是显式 control 出口

选定方案：消费 `refine-ts-pending-input-contracts` 定义的 `AgentExecutionOutcome`，使 `Agent.execute(...)` 不再用 `Promise<void>` 表示唯一成功路径。`COMPLETED` 表示 Agent/core 已完成当前 run，可以进入既有 terminal commit；`PENDING_INPUT` 表示 runtime-owned pending 已创建且当前 run 暂停等待用户，runtime 必须停止当前 dispatch，不进入 terminal commit，也不把它当 failure。Capability invocation producer 调用 `AgentRunStatePort.requestPendingInput(...)` 成功后，Agent/core 必须立即返回 `PENDING_INPUT`，不得继续执行后续 tool call、append 普通 capability result 或让后续异常把同一 run 覆盖成 failed/completed terminal path。

理由：`requestPendingInput(...)` 是 runtime-owned side effect 入口，只能创建 pending fact 和返回 safe pending ref；它本身不能表达“停止当前 Agent loop”。如果用 thrown control signal，现有 runtime failure catch 容易把暂停误处理为 failed terminal。显式 outcome 让 runtime 以可测试的分支处理暂停。

边界：`PENDING_INPUT` 不新增 `RunStatus`。用户可见等待仍由 `PendingInput.status=PENDING`、`USER_INPUT_REQUIRED`、active pending submit guard 和 lane block 表达。

### D4：可见性边界是 checkpoint 成功

选定方案：runtime 在发出 `USER_INPUT_REQUIRED` 前必须先保存 checkpoint。如果 checkpoint 失败，pending 不对用户可见，原 run 进入 safe failure 或可重试恢复路径。

理由：用户看到 pending 后，进程重启或客户端切换设备时必须能恢复到等待点。

补充约束：本 change 复用既有 `CAPABILITY_BEFORE_CALL` / lifecycle checkpoint trigger 和 `BEFORE_CAPABILITY_INVOKE` 恢复点，不新增 `CheckpointTriggerReason` 或 `LifecycleStage`。Capability invocation producer pending 必须在 durable pending fact 上保存 runtime-owned minimal `producerRef`，并与 pending 的 `checkpointId` / `requestContextId` 一起形成恢复坐标。

### D5：不新增 RunStatus，不释放 lane

选定方案：等待用户期间 run 继续使用既有 lifecycle status；用户可见等待状态来自 `PendingInput.status=PENDING` 和 `USER_INPUT_REQUIRED`。same-session lane 不释放，后续 same-lane terminal-writing work 不能越过该 run。

拒绝方案：新增 `RunStatus=PENDING`。拒绝原因是当前 run status visibility 已冻结首版 vocabulary，pending 是 child lifecycle fact，不是 root request status。

拒绝方案：pending 期间释放 lane。拒绝原因是另一台设备提交同 session 消息会和原 run 的恢复/终态争夺 history 与 terminal commit。

### D6：same-session submit 返回 safe conflict

选定方案：runtime submit path 使用 active pending query 检查同 owner+agent+session。若存在 active pending，返回 safe conflict 和安全 pending ref/summary，不创建新 run、不 queue、不 supersede。

黑盒效果：用户在另一台电脑打开同 session 并提交消息时，会看到“当前会话正在等待输入/确认，请先处理该 pending input 或取消当前请求”的可恢复状态，而不是触发第二个回答流。

### D7：answer accept 与恢复分离

选定方案：answer command 的成功含义是 pending fact 已通过 gateway resolve idempotency + CAS 更新为 `RECEIVED`，随后 runtime enqueue/continue 原 run 的恢复执行。重复相同 answer command 使用 idempotency 得到等价 accepted outcome；不同语义重用 key 返回 conflict。

理由：先记录 received fact，再恢复执行，能在恢复失败或进程重启时避免用户答案丢失。

补充约束：同一个 `pendingInputId + requestRunId` 只能触发一次 resume continuation。重复 answer、刷新后 answer 或 recovery 重放只能观察 durable resolved fact，不得二次恢复、二次发布 `USER_INPUT_RECEIVED` 或二次 materialize capability result。

### D8：resume 区分 Hook producer 和 Capability invocation producer

选定方案：answer 后恢复必须按 producer 类型处理。Hook producer pending 恢复原 lifecycle gate，例如 `BEFORE_CAPABILITY_INVOKE` hook pend 后继续受保护 capability 的前置门禁流程；它不得合成 capability result。Capability invocation producer pending 恢复到既有 `BEFORE_CAPABILITY_INVOKE` 坐标时，runtime/core 不重新调用 producer capability，而是把 resolved answer materialize 为原 producer tool call 的 safe `CAPABILITY_RESULT` message，然后继续同一 batch 的剩余 tool calls 或进入下一轮 model。

resume 分支派生规则：首版使用 `refine-ts-pending-input-contracts` 定义的 runtime-owned minimal `producerRef`。`producerRef.kind="LIFECYCLE_HOOK"` 时，runtime 恢复 Hook lifecycle gate，不 materialize capability result。`producerRef.kind="CAPABILITY_INVOCATION"` 时，runtime/core 必须用 `producerRef.toolCallId` 定位原 producer tool call，并用 `producerRef.capabilityId` 交叉校验它仍是具体 producer change 明确定义的 capability invocation producer。受保护 confirmation/authorization 的 pre-confirmation/pre-authorization pending 始终写入 `producerRef.kind="LIFECYCLE_HOOK"`，不得被当成 capability result。

Capability invocation producer 定位规则：runtime/core 必须把 resolved answer materialize 到 `producerRef.toolCallId` 指向的原始 tool call。若同一 batch 后面还有 AskUserQuestion-like producer tool call，它只能在恢复继续执行到该位置时再进入自己的 pending，并写入自己的 `producerRef`。若 `producerRef` 缺失、kind 与恢复路径不匹配、`toolCallId` 不属于当前恢复上下文、capability id 不匹配、或该 tool call 已经有 result，runtime MUST 进入 safe failure 或可恢复错误状态，不得猜测其它 unresolved tool call，也不得重新 invoke producer capability。

理由：AskUserQuestion 这类 producer 的用户 answer 必须作为模型可见 tool result 进入后续上下文；受保护 capability 前确认/授权则是 hook gate，不是工具输出。混用两者会造成重复提问或把授权误当成工具结果。

### D9：刷新/换设备不依赖同一个 idempotency key

选定方案：`pendingInputId` 是跨刷新、跨设备的 durable 业务锚点；`idempotencyKey` 是一次 answer command 的网络重试锚点。刷新页面或换设备访问同会话时，客户端重新读取 active pending：若仍为 `PENDING`，可以用新的 command idempotency key 提交；若已经 `RECEIVED` / `TIMED_OUT` / `CANCELED`，runtime 返回 safe already-resolved/conflict outcome。

理由：不要求用户设备共享临时 idempotency key；双提交安全由 pending status CAS 和 resolve idempotency anchor 共同保证。

## 质量属性设计（Quality Attributes）

安全：所有 answer 通过 trusted identity command；runtime 校验 owner+agent+session+pending id；late/cross-owner answer 返回 safe error。验证入口是 runtime command negative tests。

性能/容量：pending 不是 busy-wait；runtime 只在 submit/answer/cancel/recovery/timeout 点读取 pending facts。验证入口是 characterization tests。

可靠性/恢复：checkpoint-before-visible、CAS resolve、idempotency 和 lane blocking 保证重启/重复提交/跨设备不会产生双恢复或双终态。验证入口是 runtime recovery and concurrency tests。

可维护性：runtime 拥有 lifecycle；channel 只投影；gateway 只返回 records 和 resolve idempotency result；capability/core 只通过 runtime-owned port 提交 intent、通过 `AgentExecutionOutcome` 暂停执行，并在恢复时只 materialize 已 resolved answer。验证入口是 architecture tests。

可测试性：每个黑盒场景都有 runtime/service test；projection 用 stream tests。

审计/可追溯性：canonical `USER_INPUT_*` events 提供 traceable refs，但不包含 raw answer。验证入口是 stream/projection safe payload tests。

## 验证映射（Verification Map）

- pending intent internal handoff：T2.1；runtime integration/architecture tests。
- explicit pending input execution outcome：T1.4、T2.4；runtime/core integration tests。
- checkpoint-before-visible：T2.2；runtime integration test。
- one active pending per run：T2.3；runtime conflict test。
- no new RunStatus：T1.1、T6.1；contract test。
- valid answer resolve and resume：T3.1、T4.1、T4.3；runtime/core integration test。
- answer idempotency and cross-device semantics：T3.3、T3.4；runtime/gateway idempotency tests。
- late answer rejection：T3.2；negative test。
- cross-device submit conflict：T5.1；runtime submit test。
- cancel linkage：T5.2；runtime cancel/pending test。
- channel/gateway/capability non-ownership：T6.2；architecture test。

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/human-pending-input-core/spec.md`。
- 架构设计：`openspec/designs/architecture/runtime-boundaries.md`。
- 模块设计：`openspec/designs/modules/agent-runtime.md`、`agent-channel-web.md`、gateway 模块文档。
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [风险] pending 期间不释放 lane 会让同 session 后续消息等待。-> 返回 safe conflict 和 pending ref，要求用户先回答、取消或等待 timeout，保护单会话事实一致性。
- [风险] answer accepted 后恢复失败。-> received fact 已持久化，runtime recovery 可基于 checkpoint 和 responseAnswers 继续或安全失败。
- [风险] capability producer pending 恢复时无法唯一定位原 tool call。-> 首版使用 runtime-owned minimal `producerRef` 持久化 `{ kind: "CAPABILITY_INVOCATION", capabilityId, toolCallId }`；恢复时按该坐标 materialize 原 tool call，坐标缺失或不匹配时 safe failure，不猜测其它 unresolved tool call，也不重新调用 producer capability。
- [风险] upstream 误以为可以绕过 runtime。-> architecture tests 阻止 channel/capability 私有 pending lifecycle。
- [风险] idempotency key 被误解成跨设备共享状态。-> spec 明确跨设备靠 durable pending status 和 CAS；idempotency key 只用于同 command 重试。

## 迁移计划（Migration Plan）

无生产数据迁移。已有 skeleton 实现需要补齐 lifecycle 行为和 tests。

## 归档前更新基线（Baseline Promotion Plan）

- 新增 `openspec/specs/human-pending-input-core/spec.md`。
- 更新 runtime boundary、agent-runtime、agent-channel-web 和 gateway module 设计。
- 更新 `openspec/designs/spec-to-design-map.md`。

## 待确认问题（Open Questions）

无。
