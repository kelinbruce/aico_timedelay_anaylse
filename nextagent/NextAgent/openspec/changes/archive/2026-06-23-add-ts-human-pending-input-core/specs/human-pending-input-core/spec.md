## ADDED Requirements

### Requirement: Runtime 持有的 pending input 生命周期

NextAgent SHALL 将 human pending input 作为原始 request run 的一个 runtime 持有的子生命周期事实来处理。Pending input MUST NOT 创建新的根 request，MUST NOT 创建与之竞争的 channel/capability 状态机，并 MUST NOT 更改 `RunStatus` 词汇表。

#### Scenario: Pending intent 进入 runtime 持有的内部 handoff
- **WHEN** Hook producer 或 Capability invocation producer 判定一个正在执行的 run 必须等待人工输入
- **THEN** 该上游路径 MUST 只向 runtime 持有的内部 handoff 提交既有的 `agent-contracts/runtime` `PendingInputIntent` contract DTO
- **AND** `PendingInputIntent` MUST NOT 被重定义为持久化 gateway record、client payload、capability 私有对象或新的领域对象
- **AND** Hook producer pending MUST 只能通过返回 `HookResult{ decision: "PEND", pendingInputIntent }` 的 `LifecycleHookPort.invoke(...)` 进入 runtime
- **AND** 受保护 capability 的前置确认或前置授权 MUST 在受保护 capability 副作用开始之前被建模为 `BEFORE_CAPABILITY_INVOKE` Hook producer pending
- **AND** Capability invocation producer pending MUST 只能通过 `AgentRunStatePort.requestPendingInput(run, context, intent)` 进入 runtime
- **AND** `AgentRunStatePort.requestPendingInput` MUST 接收已接受的 `RequestRun`、可信的 `RequestContext` 和已校验的 `PendingInputIntent`，MUST 在接受时返回安全的 `PendingInputRequest`，并 MUST NOT 等待人工答案
- **AND** producer 本地校验 MUST NOT 绕过 runtime 对已接受 run、可信 context、owner scope、agent scope、intent kind 与 shape、timeout 边界、checkpoint 可用性和活跃 pending 冲突的最终接受校验
- **AND** timeout 边界和被接受的 `timeoutAt` MUST 由 runtime 在 pending 接受期间最终确定，而不是由 producer、client、channel、model 或 gateway 确定
- **AND** 在本 change 中，Model 输出、独立 policy 逻辑和 runtime 内部步骤 MUST NOT 成为独立的 pending intent producer
- **AND** 本 change MUST NOT 引入通用 `PolicyPort`、policy 引擎或 `CapabilityInvocationRuntimeContext.requestPendingInput(...)` facade；后续引入的具体 producer MUST 复用同一 runtime 持有的 handoff
- **AND** runtime MUST 拥有 checkpoint 保存、pending 事实创建、可见事件发布、答案处理和恢复
- **AND** 该 handoff MUST NOT 作为公共 Web command、gateway 操作或 capability 私有的等待/恢复状态被暴露

#### Scenario: Pending input kind 由可信 producer 边界选择
- **WHEN** 某个上游路径提交一个 `PendingInputIntent`
- **THEN** pending input 的 `kind` MUST 在 runtime pending handoff 之前由可信 producer 边界选定
- **AND** `CONFIRMATION` 或 `AUTHORIZATION` kind 的选择 MUST 来自受保护 capability 执行前的 Agent/core lifecycle hook 或 capability guard
- **AND** 当涉及受保护操作风险时，该选择 MUST 使用已解析的 capability descriptor 和显式的 risk/governance policy
- **AND** runtime MUST NOT 从 model 文本、client payload、channel 元数据、gateway record 或 tool 参数推断确认或授权
- **AND** runtime MUST 校验已接受的 run、可信 context、owner scope、agent scope、kind shape、timeout 边界、checkpoint 可用性和活跃 pending 冲突
- **AND** runtime MUST 拥有 checkpoint、pending 事实创建、投影、答案、超时、取消和恢复

#### Scenario: Pending input 暂停 Agent 执行且不进行 terminal commit
- **WHEN** Capability invocation producer 通过 `AgentRunStatePort.requestPendingInput(run, context, intent)` 创建一个 pending input
- **THEN** Agent/core MUST 返回一个带 `status="PENDING_INPUT"` 和安全 `PendingInputRequest` 的显式 `AgentExecutionOutcome`
- **AND** runtime MUST 将 `AgentExecutionOutcome.status="PENDING_INPUT"` 视为原始 run 的非 terminal 暂停
- **AND** runtime MUST NOT 因这次 `Agent.execute(...)` 返回而为该 run commit `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED` 或等价的 terminal 事实
- **AND** runtime MUST 停止当前 dispatch，直到 pending input 被回答、取消、超时，或所属 run 以其他方式变为 terminal
- **AND** `PENDING_INPUT` MUST NOT 通过从 Agent/core 抛出普通 failure/control 异常来表示
- **AND** 该 outcome MUST NOT 引入新的 `RunStatus`
- **AND** 在 `AgentRunStatePort.requestPendingInput` 接受 pending handoff 后，Agent/core MUST 在执行后续 tool call 或追加普通 capability 结果之前立即返回 `AgentExecutionOutcome.status="PENDING_INPUT"`
- **AND** runtime MUST NOT 因 handoff 之后的 Agent 返回路径，用 completed 或 failed terminal 事实覆盖同一 run 已接受的活跃 pending 事实

#### Scenario: Pending input 仅在可恢复 checkpoint 之后可见
- **WHEN** runtime 为一个正在执行的 run 接受一个已校验的 pending input intent
- **THEN** runtime MUST 在 pending input 变为可见之前为原始 run 保存可恢复的 checkpoint
- **AND** runtime MUST 持久化一个状态为 `PENDING` 的 `PendingInput` 事实
- **AND** runtime MUST 将由 core contract 细化定义的 runtime 持有的最小 `producerRef` 作为持久 pending 事实的一部分持久化
- **AND** Hook producer pending MUST 持久化 `producerRef.kind="LIFECYCLE_HOOK"`
- **AND** Capability invocation producer pending MUST 持久化 `producerRef.kind="CAPABILITY_INVOCATION"`，并携带原始 producer 的 `capabilityId` 和 `toolCallId`
- **AND** `producerRef` MUST 派生自可信的 runtime/core 执行上下文，MUST NOT 从 model 输出、client payload、channel 元数据、capability 参数、gateway record 或 tool input 接受
- **AND** runtime MUST 发布 canonical `USER_INPUT_REQUIRED`
- **AND** 用户可见 payload MUST 只使用 `PendingInputRequest` 安全字段
- **AND** runtime MUST 复用既有的 lifecycle checkpoint/recovery 词汇表，MUST NOT 新增 pending-input 专用的 `LifecycleStage` 或 `CheckpointTriggerReason`

#### Scenario: 每个 run 只有一个活跃 pending input
- **WHEN** 一个 run 已有一个 `PENDING` 的 pending input
- **AND** 同一 run 又产生另一个 pending input intent
- **THEN** runtime MUST 以安全冲突拒绝第二个 intent
- **AND** runtime MUST NOT 为该 run 创建第二个活跃 pending input

#### Scenario: Pending 不引入 RunStatus
- **WHEN** 一个 run 正在等待 pending input
- **THEN** 该 run MUST 保持在既有的 request lifecycle 词汇表内
- **AND** 系统 MUST NOT 引入 `PENDING`、`WAITING_FOR_USER` 或等价的 `RunStatus`
- **AND** 等待可见性 MUST 通过 pending input 状态和 `USER_INPUT_REQUIRED` 表达

### Requirement: Pending 答案恢复原始 run

NextAgent SHALL 只通过 `RuntimeCommandPort.answerPendingInput(command)` 接受 pending input 答案，并使用由 channel/auth 边界注入的可信 identity 和幂等性。

#### Scenario: Web 答案入口委托给 runtime
- **WHEN** Web channel 收到一个 pending input 答案请求
- **THEN** Web 答案 payload schema MUST 只接受 `sessionId`、`pendingInputId` 和有序的 `answers`
- **AND** channel/auth 边界 MUST 在调用 runtime 之前注入可信的 `identityContext` 和 canonical command `idempotencyKey`
- **AND** channel MUST 只调用 `RuntimeCommandPort.answerPendingInput`
- **AND** channel MUST NOT 创建 pending input、resolve pending input、恢复 run 或直接访问 pending input store

#### Scenario: 有效答案 resolve pending 并恢复
- **WHEN** channel 以可信 identity 和幂等 key 为一个 `PENDING` 的 pending input 提交答案
- **THEN** runtime MUST 校验 owner scope、agent scope、session id、pending id、answer shape 和幂等性
- **AND** runtime MUST 使用 gateway resolve 幂等性和 compare-and-set 语义将 pending input resolve 为 `RECEIVED`
- **AND** runtime MUST 发布不含原始答案内容的 canonical `USER_INPUT_RECEIVED`
- **AND** runtime MUST 从已保存的 checkpoint 恢复原始 run
- **AND** runtime MUST 通过既有的 `RequestContext.nextLifecycleStage` 语义恢复，MUST NOT 引入 `AFTER_PENDING_INPUT` 或等价的 lifecycle stage

#### Scenario: 同一答案 command 重放是幂等的
- **WHEN** 同一 owner+agent+session+pendingInput 再次收到相同答案 command 的幂等 key 和语义
- **THEN** runtime MUST 返回等价的已接受 outcome
- **AND** runtime MUST NOT 发布第二个 `USER_INPUT_RECEIVED`
- **AND** runtime MUST NOT 第二次恢复原始 run

#### Scenario: Pending 已 resolve 后的不同 command 不能二次恢复
- **WHEN** 刷新后的 client 或另一设备为一个已被其他 command resolve 的 pending input 提交不同的答案 command
- **THEN** runtime MUST 基于持久 pending 状态安全地拒绝或报告已 resolve 的 outcome
- **AND** runtime MUST NOT 将已 resolve 的 pending input 事实改回 `RECEIVED`
- **AND** runtime MUST NOT 第二次恢复原始 run

#### Scenario: Capability producer 答案一次性物化 capability 结果
- **WHEN** runtime 恢复一个由 Capability invocation producer 创建的 `RECEIVED` pending input
- **THEN** runtime/core MUST 要求持久 pending 事实携带 `producerRef.kind="CAPABILITY_INVOCATION"`
- **AND** runtime/core MUST 使用 `producerRef.toolCallId` 标识原始 producer tool call
- **AND** runtime/core MUST 使用 `producerRef.capabilityId` 校验原始 producer tool call 属于被显式定义为 capability invocation producer 的具体 producer change
- **AND** runtime/core MUST NOT 再次调用 producer capability
- **AND** runtime/core MUST 将已 resolve 的答案物化为面向原始 producer tool call 的一个安全 `CAPABILITY_RESULT` message
- **AND** runtime/core MUST 按既有 Agent 循环继续同一批次中剩余的 tool call，或继续下一个 model 步骤
- **AND** 如果 `producerRef` 缺失、kind 错误、指向恢复后的 run 上下文之外的 tool call、capability id 不匹配，或指向已有结果的 tool call，runtime MUST 安全失败或留下可恢复的错误状态，MUST NOT 猜测另一个未 resolve 的 tool call 或重新调用 producer capability

#### Scenario: Hook producer 答案恢复 lifecycle gate 且不产生 capability 结果
- **WHEN** runtime 恢复一个由 Hook producer 创建的 `RECEIVED` pending input
- **THEN** runtime MUST 从已保存的 checkpoint 恢复原始 lifecycle gate
- **AND** runtime/core MUST 要求持久 pending 事实携带 `producerRef.kind="LIFECYCLE_HOOK"`
- **AND** runtime MUST NOT 为 hook pending input 物化 capability 结果
- **AND** 受保护 capability 的前置确认或前置授权 MUST 在受保护 capability 副作用开始之前恢复

#### Scenario: 迟到答案被拒绝
- **WHEN** channel 为一个状态不是 `PENDING` 的 pending input 提交答案
- **THEN** runtime MUST 以安全冲突 outcome 拒绝该答案
- **AND** runtime MUST NOT 恢复原始 run
- **AND** runtime MUST NOT 变更 terminal、已超时、已取消或已 received 的 pending input 事实

#### Scenario: 答案不携带可信字段
- **WHEN** client 提交一个 pending input 答案
- **THEN** client payload MUST 只包含 `sessionId`、`pendingInputId` 和有序的 `answers`
- **AND** channel/auth 边界 MUST 向 runtime command 注入可信的 `identityContext` 和 `idempotencyKey`
- **AND** runtime MUST 忽略或拒绝 client 提供的 identity、幂等性、answer schema、origin、timeout 行为或 model 格式化的 answer 字段

### Requirement: 活跃 pending 阻塞同 session 提交

当存在活跃 pending input 时，NextAgent SHALL 保护同一 owner+agent+session lane。来自另一浏览器或设备、面向同一 session 的新的普通提交 MUST NOT 静默替换、排队其后或取代正在等待的 run。

#### Scenario: 活跃 pending 期间的跨设备提交被拒绝
- **WHEN** runtime 收到面向同一 owner+agent scope 下存在活跃 `PENDING` pending input 的 session 的普通提交
- **THEN** runtime MUST 以安全冲突 outcome 拒绝该提交
- **AND** 该 outcome MUST 包含足以让 client 展示等待状态的安全 pending input 引用或摘要
- **AND** runtime MUST NOT 创建新的 `RequestRun`
- **AND** runtime MUST NOT 因该提交而排队、dispatch、取代或 terminalize 既有的 pending run

#### Scenario: Pending 保持 lane 阻塞
- **WHEN** 一个 run 正在等待活跃 pending input
- **THEN** runtime scheduler MUST NOT dispatch 另一个可写 terminal 事实的同 lane run
- **AND** lane 释放 MUST 等到 pending input 被回答、取消、超时，或所属 run 到达稳定 terminal 边界

### Requirement: Pending input 取消跟随所属 run 控制

当所属 request run 被取消或因其他原因不能合法恢复时，NextAgent SHALL 取消活跃 pending input。本 change 不引入独立的公共 cancel-pending command。

#### Scenario: 所属 run 取消会取消 pending input
- **WHEN** 当 pending input 仍为 `PENDING` 时，runtime 接受对所属 run 的取消
- **THEN** runtime MUST 将该 pending input resolve 为 `CANCELED`
- **AND** runtime MUST 发布 canonical `USER_INPUT_CANCELED`
- **AND** 该 pending input 的后续答案 MUST 以安全冲突被拒绝

#### Scenario: Terminal run 不能通过 pending 答案恢复
- **WHEN** 所属 run 在答案被处理之前已到达 terminal 状态
- **THEN** runtime MUST 以安全 outcome 拒绝该答案或取消该 pending input
- **AND** runtime MUST NOT 为原始 run 创建第二个 terminal 结果
