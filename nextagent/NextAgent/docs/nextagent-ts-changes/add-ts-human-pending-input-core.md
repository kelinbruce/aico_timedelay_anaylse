# add-ts-human-pending-input-core

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)

所属分组：Human Pending Input

状态：ready
类型：实施 change
主要 owner：`agent-runtime`、`agent-channel-web`、`PendingInputStoreGateway`
依赖：`ship-ts-minimal-agent-kernel`、`refine-ts-pending-input-contracts`

目标：

- 消费 v2 pending input 三对象契约并建立 runtime 生命周期。
- 支持创建、持久化、投影、回答、取消和恢复原 run 的核心流程。
- 首版只允许 Hook producer 和 Capability invocation producer 提交 pending intent/request；进入 pending 后的生命周期由 runtime 统一处理。
- 用 `AgentExecutionOutcome.PENDING_INPUT` 表达 `Agent.execute(...)` 已暂停但 run 未 terminal，避免 pending 被误提交为 completed/failed。

规格输入：

- MUST 使用共享契约输入中的 `PendingInputRequest`、`PendingInputAnswer`、`PendingInput`。
- MUST 使用 `PendingInputStatus` 四态：`PENDING`、`RECEIVED`、`TIMED_OUT`、`CANCELED`。
- MUST 保证同一 run 同一时间只有一个 `PENDING` pending input。
- MUST 在 answer 成功处理后恢复原 run。
- MUST 区分 Hook producer resume 和 Capability invocation producer resume：前者恢复 lifecycle gate，后者把 answer materialize 为原 producer tool call 的 capability result。
- MUST 在用户 cancel 时让 pending 和 run 进入一致终态。
- MUST 将 pending input 投影到 run status、stream projection 和 history consistency 相关读取结果中。
- MUST 只允许 `PendingInput.status == PENDING` 的 pending input 被 answer 改变状态。
- MUST 拒绝 late answer，不能恢复已结束、已取消、已超时或已被处理的 pending input。
- MUST 保持 same-session lane blocked，直到 pending answer、cancel、timeout 或 terminal outcome；本 change 不释放 lane，也不新增 `RunStatus.PENDING`。

契约输入：

- `PendingInputKind`
- `PendingInputStatus`
- `PendingInputRequest`
- `PendingInputAnswer`
- `AnswerPendingInputCommand`
- `PendingInputAnswerAccepted`
- `PendingInput`
- `PendingInputIntent`
- `AgentExecutionOutcome`
- hook path：`HookResult.pendingInputIntent` with `decision=PEND`
- capability invocation producer path：`AgentRunStatePort.requestPendingInput(run, context, intent): Promise<PendingInputRequest>`
- runtime command port 的 pending input answer 入口
- `PendingInputStoreGateway`
- canonical `USER_INPUT_*` timeline / stream event

实现约束：

- runtime 拥有 pending lifecycle；channel 只呈现 safe `PendingInputRequest` 并提交 `PendingInputAnswer`。
- `PendingInputIntent` 复用 `agent-contracts/runtime` 既有 contract DTO；不得新增替代领域对象、gateway record 或 client payload。
- Hook producer 只能通过 `HookResult.pendingInputIntent` 表达 pending decision；Capability invocation producer 只能通过 `AgentRunStatePort.requestPendingInput` 提交 pending intent；当前 change 不新增通用 `PolicyPort` 或 `CapabilityInvocationRuntimeContext.requestPendingInput(...)`。
- Hook 或 Capability producer 的 producer-local validation 只表示该 producer 愿意提交 `PendingInputIntent`；runtime 在 pending 可见前仍必须基于 accepted run、trusted context、owner scope、agent scope、intent kind/shape、timeout bounds、checkpoint 可用性和 active pending conflict 做最终 acceptance validation。
- Model 不直接提交 `PendingInputIntent`；policy 若需要 pending，首版必须表现为 lifecycle hook；runtime 是 pending lifecycle/internal handoff owner，不作为独立 producer。
- 受保护 capability 调用前确认/授权归 `BEFORE_CAPABILITY_INVOKE` Hook producer，不归 Capability invocation producer。
- Capability invocation producer 创建 pending 后，Agent/core 必须返回 `AgentExecutionOutcome.PENDING_INPUT`；`AgentRunStatePort.requestPendingInput(...)` 成功返回后不得继续执行后续 tool call、append 普通 capability result 或落入 terminal/failure path；runtime 不得 terminal commit 或 failure commit。
- answer 后恢复时，runtime/core 必须先从 pending 绑定的 checkpoint、requestContext、当前 tool batch reconstruction 和 persisted capability result facts 派生 resume 分支：若当前 tool batch 中存在某个 producer change 明确定义的 capability invocation producer id 的 unresolved tool call，则走 Capability invocation producer materialization；否则走 Hook lifecycle-gate resume。
- Capability invocation producer 不得被重新 invoke；runtime/core 必须按当前 tool batch 的原始 `toolCallStates` / assistant tool-use 顺序选择第一个 unresolved producer tool call，并将 resolved answer materialize 为该 tool call 的一条 safe `CAPABILITY_RESULT` message；同一 batch 中后续 producer tool call 只能在恢复继续执行到它时再进入自己的 pending；无法按该规则唯一定位时 safe failure/recoverable error，不得新增 `PendingInputRecord.toolCallId`、`producerRef` 或等价字段。
- Hook producer answer 只恢复原 lifecycle gate，不 materialize capability result；受保护 confirmation/authorization 的 pending resume 仍属于 Hook gate，不得被当成 capability result。
- 本 change 复用既有 `BEFORE_CAPABILITY_INVOKE` / checkpoint recovery vocabulary，不新增 lifecycle stage、checkpoint trigger 或 pending record producer/tool-call 字段。
- capability、core、hook、policy 或 Agent loop 不得创建私有 pending lifecycle，只能通过 runtime-owned pending input 边界提交 pending intent/request。
- 客户端 answer payload 不携带身份、幂等 key、`multiple`、`custom` 或 answer schema。
- channel/auth boundary 在调用 runtime 时构造 `AnswerPendingInputCommand`，注入可信 `identityContext` 和 command `idempotencyKey`。
- `RuntimeCommandPort.answerPendingInput(command)` 返回 `PendingInputAnswerAccepted`，表示 runtime 已通过 gateway resolve idempotency + CAS 将 pending input 处理为 `RECEIVED`。
- `pendingInputId` 是刷新页面和换设备后的 durable 业务锚点；`idempotencyKey` 只是单次 answer command 的网络重试锚点。
- 刷新或换设备访问同会话时，客户端重新读取 active pending；若仍为 `PENDING`，可以用新的 command key 提交；若已经 resolved/timeout/cancel，runtime 返回 safe already-resolved/conflict outcome。
- pending input 对客户端可见前，必须已经具备可恢复的 checkpoint 引用。

非目标：

- 不实现具体 `QUESTION`、`CONFIRMATION`、`AUTHORIZATION`、`HUMAN_HANDOFF` 的业务分支细节。
- 不实现 timeout scanner 或 timeout 业务处理。
- 不支持 answer 附件。
- 不改变 run status enum 或 lane scheduling 策略。
- 不新增 lifecycle stage、checkpoint trigger、pending record producer/tool-call 字段或 capability runtime context facade。

验收要点：

- contract test 覆盖三对象字段白名单和禁止字段。
- integration test 覆盖创建 pending、`AgentExecutionOutcome.PENDING_INPUT` 暂停、不产生 terminal commit、投影到 stream/status、answer 后恢复原 run。
- resume test 覆盖 Capability invocation producer answer materialization、按原始 tool batch 顺序处理多个 producer tool call、producer capability 不重复调用，以及 Hook producer answer 不生成 capability result。
- resilience test 覆盖重复 answer、late answer、run 已结束后 answer、刷新/换设备后的 active pending 读取和 answer。
- architecture test 确认 pending lifecycle 不被 channel、capability、core、hook、policy 或 Agent loop 私有化。

并行边界：

- 可以作为其他 pending input 类型 change 的前置。
- 不得修改 `refine-ts-pending-input-contracts` 已冻结的 pending input 三对象字段、`AgentExecutionOutcome` 或 `AgentRunStatePort.requestPendingInput(...)` contract；如需新增核心契约字段、额外 port、control outcome 或 capability runtime context facade，先提出 contract refinement change。
