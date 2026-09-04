# human-pending-input-core Specification

## Purpose
定义由 runtime 统一拥有的 Pending Input 生命周期，使问题、确认、授权和人工接管在原 RequestRun 内安全暂停、回答、取消、超时和恢复，并保持可信 Owner Scope、Agent Scope、幂等与终态一致性。

## Function

- **所属 Function**：`FN-6.5 请求用户确认或授权`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: Runtime-owned pending input lifecycle

NextAgent SHALL handle human pending input as a runtime-owned child lifecycle fact of the original request run. Pending input MUST NOT create a new root request, MUST NOT create a competing channel/capability state machine, and MUST NOT change `RunStatus` vocabulary.

#### Scenario: Pending intent enters runtime-owned internal handoff
- **WHEN** a Hook producer or Capability invocation producer determines that an executing run must wait for human input
- **THEN** that upstream path MUST submit only the existing `agent-contracts/runtime` `PendingInputIntent` contract DTO to the runtime-owned internal handoff
- **AND** `PendingInputIntent` MUST NOT be redefined as a persisted gateway record, client payload, capability-private object or new domain object
- **AND** Hook producer pending MUST enter runtime only through the runtime-owned lifecycle hook invocation path returning `HookResult{ outcome: "PEND", pendingInputIntent }`
- **AND** protected capability pre-confirmation or pre-authorization MUST be modeled as `BEFORE_CAPABILITY_INVOKE` Hook producer pending, before the protected capability side effect starts
- **AND** Capability invocation producer pending MUST enter runtime only through `AgentRunStatePort.requestPendingInput(run, context, intent)`
- **AND** `AgentRunStatePort.requestPendingInput` MUST receive the accepted `RequestRun`, trusted `RequestContext` and validated `PendingInputIntent`, MUST return a safe `PendingInputRequest` on acceptance, and MUST NOT wait for a human answer
- **AND** producer-local validation MUST NOT bypass runtime final acceptance validation of the accepted run, trusted context, owner scope, agent scope, intent kind and shape, timeout bounds, checkpoint availability and active pending conflict
- **AND** timeout bounds and accepted `timeoutAt` MUST be finalized by runtime during pending acceptance, not by the producer, client, channel, model or gateway
- **AND** Model output, standalone policy logic and runtime-internal steps MUST NOT be independent pending intent producers in the stable pending-input boundary
- **AND** the stable pending-input boundary MUST NOT introduce a generic `PolicyPort`, policy engine or `CapabilityInvocationRuntimeContext.requestPendingInput(...)` facade; later concrete producers MUST reuse the same runtime-owned handoff if introduced
- **AND** runtime MUST own checkpoint save, pending fact creation, visible event publication, answer handling and resume
- **AND** the handoff MUST NOT be exposed as a public Web command, gateway operation or capability-private wait/resume state

#### Scenario: Pending input kind is selected by trusted producer boundary
- **WHEN** an upstream path submits a `PendingInputIntent`
- **THEN** the pending input `kind` MUST be selected before runtime pending handoff by a trusted producer boundary
- **AND** `CONFIRMATION` or `AUTHORIZATION` kind selection MUST come from an Agent/core lifecycle hook or capability guard before protected capability execution
- **AND** that selection MUST use resolved capability descriptor and explicit risk/governance policy when protected operation risk is involved
- **AND** runtime MUST NOT infer confirmation or authorization from model text, client payload, channel metadata, gateway record, or tool arguments
- **AND** runtime MUST validate the accepted run, trusted context, owner scope, agent scope, kind shape, timeout bounds, checkpoint availability and active pending conflict
- **AND** runtime MUST own checkpoint, pending fact creation, projection, answer, timeout, cancel and resume

#### Scenario: Pending input pauses Agent execution without terminal commit
- **WHEN** a Capability invocation producer creates a pending input through `AgentRunStatePort.requestPendingInput(run, context, intent)`
- **THEN** Agent/core MUST return an explicit `AgentExecutionOutcome` with `status="PENDING_INPUT"` and the safe `PendingInputRequest`
- **AND** runtime MUST treat `AgentExecutionOutcome.status="PENDING_INPUT"` as a non-terminal pause for the original run
- **AND** runtime MUST NOT commit `REQUEST_COMPLETED`, `REQUEST_FAILED`, `REQUEST_CANCELED` or equivalent terminal facts for that run because of this `Agent.execute(...)` return
- **AND** runtime MUST stop the current dispatch until the pending input is answered, canceled, timed out or the owning run is otherwise made terminal
- **AND** `PENDING_INPUT` MUST NOT be represented by throwing a normal failure/control exception from Agent/core
- **AND** this outcome MUST NOT introduce a new `RunStatus`
- **AND** after `AgentRunStatePort.requestPendingInput` accepts the pending handoff, Agent/core MUST immediately return `AgentExecutionOutcome.status="PENDING_INPUT"` before executing later tool calls or appending an ordinary capability result
- **AND** runtime MUST NOT overwrite a same-run accepted active pending fact with completed or failed terminal facts because of the post-handoff Agent return path

#### Scenario: Pending input is visible only after recoverable checkpoint
- **WHEN** runtime accepts a validated pending input intent for an executing run
- **THEN** runtime MUST save a recoverable checkpoint for the original run before the pending input becomes visible
- **AND** runtime MUST persist a `PendingInput` fact with status `PENDING`
- **AND** runtime MUST persist the runtime-owned minimal `producerRef` defined by the core contract refinement as part of the durable pending fact
- **AND** a Hook producer pending MUST persist `producerRef.kind="LIFECYCLE_HOOK"`
- **AND** a Capability invocation producer pending MUST persist `producerRef.kind="CAPABILITY_INVOCATION"` with the original producer `capabilityId` and `toolCallId`
- **AND** `producerRef` MUST be derived from trusted runtime/core execution context and MUST NOT be accepted from model output, client payload, channel metadata, capability args, gateway records or tool input
- **AND** runtime MUST publish canonical `USER_INPUT_REQUIRED`
- **AND** the user-visible payload MUST use `PendingInputRequest` safe fields only
- **AND** runtime MUST reuse existing lifecycle checkpoint/recovery vocabulary and MUST NOT add a pending-input-specific `LifecycleStage` or `CheckpointTriggerReason`

#### Scenario: One active pending input per run
- **WHEN** a run already has a `PENDING` pending input
- **AND** another pending input intent is produced for the same run
- **THEN** runtime MUST reject the second intent with a safe conflict
- **AND** runtime MUST NOT create a second active pending input for that run

#### Scenario: Pending does not introduce RunStatus
- **WHEN** a run is waiting for pending input
- **THEN** the run MUST remain in the existing request lifecycle vocabulary
- **AND** the system MUST NOT introduce `PENDING`, `WAITING_FOR_USER` or equivalent `RunStatus`
- **AND** waiting visibility MUST be expressed through pending input status and `USER_INPUT_REQUIRED`

### Requirement: Pending answer resumes original run

NextAgent SHALL accept pending input answers only through `RuntimeCommandPort.answerPendingInput(command)`, using trusted identity and idempotency injected by channel/auth boundary.

#### Scenario: Web answer ingress delegates to runtime
- **WHEN** Web channel receives a pending input answer request
- **THEN** the Web answer payload schema MUST accept only `sessionId`, `pendingInputId` and ordered `answers`
- **AND** channel/auth boundary MUST inject trusted `identityContext` and canonical command `idempotencyKey` before calling runtime
- **AND** channel MUST call only `RuntimeCommandPort.answerPendingInput`
- **AND** channel MUST NOT create pending input, resolve pending input, resume a run, or directly access pending input store

#### Scenario: Valid answer resolves pending and resumes
- **WHEN** channel submits an answer for a `PENDING` pending input with trusted identity and idempotency key
- **THEN** runtime MUST validate owner scope, agent scope, session id, pending id, answer shape and idempotency
- **AND** runtime MUST resolve the pending input to `RECEIVED` using gateway resolve idempotency and compare-and-set semantics
- **AND** runtime MUST publish canonical `USER_INPUT_RECEIVED` without raw answer content
- **AND** runtime MUST resume the original run from the saved checkpoint
- **AND** runtime MUST resume through existing `RequestContext.nextLifecycleStage` semantics and MUST NOT introduce an `AFTER_PENDING_INPUT` or equivalent lifecycle stage

#### Scenario: Same answer command replay is idempotent
- **WHEN** the same owner+agent+session+pendingInput receives the same answer command idempotency key and semantic again
- **THEN** runtime MUST return an equivalent accepted outcome
- **AND** runtime MUST NOT publish a second `USER_INPUT_RECEIVED`
- **AND** runtime MUST NOT resume the original run a second time

#### Scenario: Different command after pending is resolved cannot double-resume
- **WHEN** a refreshed client or another device submits a different answer command for a pending input already resolved by another command
- **THEN** runtime MUST reject or report the already-resolved outcome safely from durable pending status
- **AND** runtime MUST NOT mutate the resolved pending input fact back to `RECEIVED`
- **AND** runtime MUST NOT resume the original run a second time

#### Scenario: Capability producer answer materializes a capability result once
- **WHEN** runtime resumes a `RECEIVED` pending input created by a Capability invocation producer
- **THEN** runtime/core MUST require the durable pending fact to carry `producerRef.kind="CAPABILITY_INVOCATION"`
- **AND** runtime/core MUST use `producerRef.toolCallId` to identify the original producer tool call
- **AND** runtime/core MUST use `producerRef.capabilityId` to verify the original producer tool call belongs to a concrete producer change explicitly defined as a capability invocation producer
- **AND** runtime/core MUST NOT invoke the producer capability again
- **AND** runtime/core MUST materialize the resolved answer as one safe `CAPABILITY_RESULT` message for the original producer tool call
- **AND** runtime/core MUST continue the remaining tool calls in the same batch or continue to the next model step according to the existing Agent loop
- **AND** if `producerRef` is missing, has the wrong kind, points to a tool call outside the restored run context, has a mismatched capability id, or points to a tool call that already has a result, runtime MUST fail safely or leave a recoverable error state and MUST NOT guess another unresolved tool call or re-invoke the producer capability

#### Scenario: Hook producer answer resumes lifecycle gate without capability result
- **WHEN** runtime resumes a `RECEIVED` pending input created by a Hook producer
- **THEN** runtime MUST resume the original lifecycle gate from the saved checkpoint
- **AND** runtime/core MUST require the durable pending fact to carry `producerRef.kind="LIFECYCLE_HOOK"`
- **AND** runtime MUST NOT materialize a capability result for the hook pending input
- **AND** protected capability pre-confirmation or pre-authorization MUST resume before the protected capability side effect starts

#### Scenario: Late answer is rejected
- **WHEN** channel submits an answer for a pending input whose status is not `PENDING`
- **THEN** runtime MUST reject the answer with a safe conflict outcome
- **AND** runtime MUST NOT restore the original run
- **AND** runtime MUST NOT mutate terminal, timed-out, canceled or already-received pending input facts

#### Scenario: Answer does not carry trusted fields
- **WHEN** a client submits a pending input answer
- **THEN** the client payload MUST contain only `sessionId`, `pendingInputId` and ordered `answers`
- **AND** channel/auth boundary MUST inject trusted `identityContext` and `idempotencyKey` into the runtime command
- **AND** runtime MUST ignore or reject client-supplied identity, idempotency, answer schema, origin, timeout behavior or model-formatted answer fields

### Requirement: Active pending blocks same-session submit

NextAgent SHALL protect the same owner+agent+session lane while an active pending input exists. A new ordinary submit from another browser or device for the same session MUST NOT silently replace, queue behind, or supersede the waiting run.

#### Scenario: Cross-device submit during active pending is rejected
- **WHEN** runtime receives an ordinary submit for a session that has an active `PENDING` pending input in the same owner+agent scope
- **THEN** runtime MUST reject the submit with a safe conflict outcome
- **AND** the outcome MUST include a safe pending input reference or summary sufficient for the client to display the waiting state
- **AND** runtime MUST NOT create a new `RequestRun`
- **AND** runtime MUST NOT queue, dispatch, supersede or terminalize the existing pending run because of that submit

#### Scenario: Pending keeps lane blocked
- **WHEN** a run is waiting on active pending input
- **THEN** runtime scheduler MUST NOT dispatch another same-lane run that can write terminal facts
- **AND** lane release MUST wait until pending input is answered, canceled, timed out or the owning run reaches a stable terminal boundary

### Requirement: Pending input cancellation follows owning run control

NextAgent SHALL cancel active pending input when the owning request run is canceled or otherwise cannot legally resume. This change does not introduce a standalone public cancel-pending command.

#### Scenario: Owning run cancel cancels pending input
- **WHEN** runtime accepts cancellation for the owning run while a pending input is still `PENDING`
- **THEN** runtime MUST resolve the pending input to `CANCELED`
- **AND** runtime MUST publish canonical `USER_INPUT_CANCELED`
- **AND** later answers for that pending input MUST be rejected with a safe conflict

#### Scenario: Terminal run cannot be resumed through pending answer
- **WHEN** the owning run has already reached a terminal state before an answer is processed
- **THEN** runtime MUST reject the answer or cancel the pending input with a safe outcome
- **AND** runtime MUST NOT create a second terminal result for the original run

### Requirement: 系统在可信 Agent Scope 内发现未完成 timeout facts

系统 MUST 只在 app composition 注入的可信 Agent Scope 内发现已经接受 `timeoutAt` 且 timeout 生命周期尚未完成的 pending input facts。发现结果 MUST 包含该 Agent Scope 下所有带 accepted `timeoutAt` 的 `PENDING`，无论 deadline 位于未来还是已经到期；也 MUST 包含已经进入 `TIMED_OUT` 但 owning RequestRun 尚未完成 terminal commit 的事实。`RECEIVED`、`CANCELED` 以及 terminal commit 已完成的 `TIMED_OUT` MUST NOT 出现在结果中。

当前时间、是否到期、timeout policy、状态转换、event 发布与 terminal commit decision MUST NOT 由事实发现边界决定。事实发现能力 MUST 只服务 runtime timeout/recovery，不得通过 Web/channel、Agent Core、model、capability 或客户端接口暴露；旧的全局 due query 与语义重叠 alias MUST 不可用。

**需求类别**：功能性需求

#### Scenario: 只返回可信 Agent Scope 内的未完成事实

- **GIVEN** 两个 Agent Scope 都存在带 accepted `timeoutAt` 的 pending input facts
- **WHEN** runtime 为其中一个可信 Agent Scope 发现未完成 timeout facts
- **THEN** 结果 MUST 只包含该 Agent Scope 的 facts
- **AND** MUST 包含 future/due `PENDING` 和 terminal 尚未提交的 `TIMED_OUT`
- **AND** MUST 排除 `RECEIVED`、`CANCELED` 和 terminal 已提交的 `TIMED_OUT`

#### Scenario: Fact discovery 不拥有 due decision

- **WHEN** 结果同时包含 future `PENDING`、due `PENDING` 和 incomplete `TIMED_OUT`
- **THEN** runtime MUST 使用自己的 lifecycle clock 与 durable state 决定后续动作
- **AND** fact discovery MUST NOT 接收当前时间、计算 due、修改 timeout policy 或推进 pending/run lifecycle

### Requirement: Timeout fact discovery 保持可信 scope 隔离

系统 MUST 使用 app composition 注入的可信 Agent Scope 筛选未完成 timeout facts。每条结果 MUST 保留自身可信 Owner + Agent + Session + Run coordinates；一次 Agent-scoped 内部维护查询 MAY 返回多个 Owner Scope 的事实，但 MUST NOT 合并或替换其 owner coordinates。缺少可信 Agent Scope 或调用方尝试使用旧全局 due query时 MUST fail closed，MUST NOT 回退为全局扫描、并行 alias 或客户端可见替代路径。

**需求类别**：系统质量属性

**质量属性**：安全

**适用范围**：该 Function

#### Scenario: 跨 Agent facts 被排除且 Owner coordinates 保留

- **GIVEN** 两个 Agent Scope 都存在未完成 timeout facts，且目标 Agent Scope 内包含多个 Owner Scope
- **WHEN** runtime 为目标可信 Agent Scope 发现 facts
- **THEN** 结果 MUST 排除其他 Agent Scope 的 facts
- **AND** 目标 Agent Scope 内每条 fact MUST 保留自己的 tenant、subject、session 和 run coordinates
- **AND** 系统 MUST NOT 合并或替换不同 Owner Scope 的 coordinates

#### Scenario: 非法或旧查询 fail closed

- **WHEN** 调用缺少可信 Agent Scope，或调用方尝试使用旧全局 due query
- **THEN** contract boundary MUST 拒绝调用
- **AND** MUST NOT 回退为全局扫描、并行 alias 或客户端可见替代路径

### Requirement: Timeout fact discovery 使用有界稳定遍历

事实发现 MUST 使用 `timeoutAt` 和 `pendingInputId` 的稳定升序与有界 keyset page；单次 page limit MUST 是 `1..1000` 的安全整数。不完整 keyset coordinate 或非法 limit MUST fail closed。Keyset coordinate MUST 只服务当前 processing pass，MUST NOT 被持久化、作为 feed revision 返回或跨 pass 复用。

**需求类别**：系统质量属性

**质量属性**：性能/容量

**适用范围**：该 Function

#### Scenario: 有界 keyset traversal 保持稳定

- **GIVEN** 同一可信 Agent Scope 存在超过一个 page 的未完成 timeout facts
- **WHEN** runtime 使用合法 limit 和上一页末尾的 `(timeoutAt, pendingInputId)` 继续读取
- **THEN** 每页 MUST 按 `timeoutAt`、`pendingInputId` 稳定升序返回
- **AND** 后续页 MUST 只返回严格大于 supplied coordinate 的 facts
- **AND** page limit MUST 在 `1..1000` 内
- **AND** keyset coordinate MUST NOT 被持久化、作为 feed revision 返回或跨 processing pass 复用

#### Scenario: 非法遍历边界 fail closed

- **WHEN** limit 不在 `1..1000` 或 keyset coordinate 缺少任一坐标
- **THEN** contract boundary MUST 拒绝调用
- **AND** MUST NOT 静默 clamp、回到首个 page 或执行无界扫描

### Requirement: Runtime resolves pending input timeout

系统 MUST 根据已接受的 `timeoutAt` 和已提交的 pending-input lifecycle facts 处理待确认输入超时。客户端请求、模型输出、channel metadata 或事实读取结果 MUST NOT 定义或覆盖 timeout policy。系统可用时，即使没有新 submit、会话导航、Web stream connection、页面可见性变化或进程重启，也 MUST 在执行环境能于 deadline 后继续运行时推进已经到期的 timeout。

除本段定义的唯一受控例外外，pending input timeout policy MUST NOT 引入 per-agent、per-kind、per-tenant、client-provided、model-provided 或 configurable timeout policy。该唯一例外为：canonical builtin `AskUserQuestion` 创建 pending input 且 intent 未显式提供 `timeoutAt` 时，当 trusted app composition 注入 effective `ask-user-question-time-minutes` 时，runtime MUST 使用该值作为默认等待时间；provider 缺失、失败或返回非法值时，runtime MUST 回退 30 分钟，并仍 MUST 使用统一 pending lifecycle clock 计算并固化 accepted `timeoutAt`。其他 pending input 未显式提供 `timeoutAt` 时 MUST 继续使用创建后 30 分钟默认值。

对于 `producerRef.kind === 'WORKFLOW_NODE'` 的 pending input 超时，系统 MUST resume 原 run（从 checkpoint 重建 recovery context 并 re-queue 执行），MUST NOT 直接终态化 `FAILED`。resume 时 MUST NOT 设置 `answers` 字段，使 workflow engine handler 识别为超时恢复并触发 exception 路由或终态化。对于 `producerRef.kind !== 'WORKFLOW_NODE'`（`LIFECYCLE_HOOK`、`CAPABILITY_INVOCATION`）的 pending input 超时，系统 MUST 保持直接终态化 `FAILED` 的现有行为。

checkpoint 不可用时，系统 MUST fallback 到直接终态化 `FAILED`（`failureReason: PENDING_INPUT_TIMEOUT`），MUST NOT 让 run 挂死。

**需求类别**：功能性需求

#### Scenario: Runtime owns timeout decision
- **WHEN** 系统接受一个 pending input intent
- **THEN** 系统 MUST 使用统一 pending lifecycle clock 计算并校验 accepted `timeoutAt`
- **AND** producer-provided `timeoutAt` MUST 只作为显式 timeout 请求，而不是 policy authority
- **AND** client payload、model output、channel metadata 和读取到的 facts MUST NOT 定义或覆盖 timeout policy
- **AND** 除 canonical `AskUserQuestion` 的 trusted portal ability 默认等待时间例外，该稳定能力 MUST NOT 引入 per-agent、per-kind、per-tenant、client-provided、model-provided 或 configurable timeout policy

#### Scenario: Default timeout is assigned
- **WHEN** 系统创建未显式指定 `timeoutAt` 且不属于 canonical `AskUserQuestion` 的 pending input
- **THEN** 系统 MUST 把 accepted `timeoutAt` 设为创建时刻后 30 分钟
- **AND** safe pending-input request MUST 展示该 accepted deadline

#### Scenario: AskUserQuestion uses controlled default timeout
- **WHEN** canonical `AskUserQuestion` 创建未显式指定 `timeoutAt` 的 pending input
- **AND** trusted effective `ask-user-question-time-minutes` 为 `1..1440` 中的 integer
- **THEN** 系统 MUST 把 accepted `timeoutAt` 设为创建时刻后该分钟数
- **AND** safe pending-input request MUST 展示该 accepted deadline

#### Scenario: AskUserQuestion invalid timeout config falls back safely
- **WHEN** canonical `AskUserQuestion` 创建未显式指定 `timeoutAt` 的 pending input
- **AND** trusted effective 配置解析结果非法
- **THEN** 系统 MUST 把 accepted `timeoutAt` 设为创建时刻后 30 分钟

#### Scenario: Explicit timeout is bounded
- **WHEN** pending input intent 请求显式 `timeoutAt`
- **THEN** 系统 MUST 只接受晚于创建时刻且不晚于创建后 48 小时的值
- **AND** 非法或更长的 timeout request MUST 返回安全 validation outcome

#### Scenario: Due timeout is processed without external traffic
- **GIVEN** 一个 pending input 仍为 `PENDING`
- **AND** accepted `timeoutAt` 已经过期
- **AND** 执行环境可继续运行并访问已提交 lifecycle facts
- **WHEN** 没有新请求提交且没有客户端连接
- **THEN** 系统 MUST 在执行环境于 deadline 后恢复运行时处理该事实
- **AND** 结果 MUST 收敛为 `TIMED_OUT`
- **AND** 并发 answer、cancel 或 timeout 已先完成时，系统 MUST 保留先完成的合法结果

#### Scenario: Earlier accepted deadline is not delayed
- **GIVEN** 系统已经等待一个较晚的 accepted pending-input deadline
- **WHEN** 系统接受一个更早的 pending-input deadline
- **THEN** 较早 deadline 到达后 MUST 能被处理
- **AND** 既有较晚 deadline MUST NOT 推迟该结果

#### Scenario: WORKFLOW_NODE timeout resumes original run
- **WHEN** 系统处理一个 `producerRef.kind === 'WORKFLOW_NODE'` 的 pending input 超时
- **AND** owning RequestRun 尚未 terminal
- **AND** checkpoint 可用
- **THEN** 系统 MUST resume 原 run（从 checkpoint 重建 recovery context 并 re-queue 执行）
- **AND** resume 时 MUST NOT 设置 `answers` 字段
- **AND** 系统 MUST 在 resume 前发布 `USER_INPUT_TIMEOUT` 事件
- **AND** 系统 MUST NOT 直接终态化 `FAILED`

#### Scenario: WORKFLOW_NODE timeout checkpoint unavailable fallback
- **WHEN** 系统处理一个 `producerRef.kind === 'WORKFLOW_NODE'` 的 pending input 超时
- **AND** checkpoint 不可用
- **THEN** 系统 MUST fallback 到直接终态化 `FAILED`
- **AND** `failureReason` MUST 为 `PENDING_INPUT_TIMEOUT`
- **AND** 系统 MUST NOT 让 run 挂死

#### Scenario: Non-WORKFLOW_NODE timeout terminalizes directly
- **WHEN** 系统处理一个 `producerRef.kind !== 'WORKFLOW_NODE'`（`LIFECYCLE_HOOK` 或 `CAPABILITY_INVOCATION`）的 pending input 超时
- **THEN** 系统 MUST 直接终态化 `FAILED`
- **AND** `failureReason` MUST 为 `PENDING_INPUT_TIMEOUT`
- **AND** 系统 MUST NOT resume 原 run

#### Scenario: Timeout terminalization does not create replacement pending input
- **WHEN** 系统把 timed-out pending input 终止为 `TIMED_OUT`
- **THEN** 该 timeout 处理 MUST NOT 创建 replacement pending input
- **AND** reject、deny、normal answer 和其他 terminal outcome MUST 保持既有行为
- **AND** 对于 `WORKFLOW_NODE` producerRef，resume 后 engine handler 可能 throw 超时错误走 exception 路径，exception 分支中的新 pending input 属于新节点产生，不属于 replacement

#### Scenario: Partial timeout completion is retried from durable facts
- **GIVEN** pending input 已为 `TIMED_OUT`
- **AND** owning RequestRun 尚未完成 terminal result
- **WHEN** 之前的 timeout attempt 在 canonical event 或 terminal result 完成前中断
- **THEN** 后续 processing MUST 重新发现并继续该 incomplete fact
- **AND** MUST 幂等形成 canonical `USER_INPUT_TIMEOUT`
- **AND** 对于 `WORKFLOW_NODE` producerRef，MUST resume 原 run（若 checkpoint 可用）或 fallback 到 `FAILED/PENDING_INPUT_TIMEOUT`（若 checkpoint 不可用）
- **AND** 对于非 WORKFLOW_NODE producerRef，MUST 幂等完成 `FAILED/PENDING_INPUT_TIMEOUT`
- **AND** MUST NOT 把 pending input 恢复为 `PENDING`

### Requirement: Timeout processing remains idle and bounded

系统在没有新 accepted deadline、没有 dependency failure 且最早 unresolved deadline 尚未到达时，MUST NOT 按固定周期重复读取 timeout facts。一次处理 MUST 以至多 100 条 facts 为一个 batch，并 MUST 保证同一 runtime instance 同时至多有一个 timeout processing flow。超过一批的 facts MUST 被继续处理，MUST NOT 因批次边界、相同 deadline 或单条失败而静默遗漏。

**需求类别**：系统质量属性

**质量属性**：性能/容量

**适用范围**：该 Function

#### Scenario: Healthy idle runtime does not poll

- **GIVEN** 初始化读取已经成功完成
- **AND** 最早 unresolved `PENDING` deadline 位于未来
- **WHEN** deadline 前没有新 pending input 且没有 dependency failure
- **THEN** 系统 MUST NOT 按固定间隔重复读取 unresolved timeout facts

#### Scenario: Candidate processing is bounded and non-overlapping

- **GIVEN** 一个可信 Agent Scope 包含超过 100 条 unresolved timeout facts
- **WHEN** timeout processing 运行
- **THEN** 系统 MUST 每批检查至多 100 条 facts
- **AND** 同一 runtime instance 同时 MUST 至多执行一个 processing flow
- **AND** 系统 MUST 继续后续批次直到全部 eligible facts 都被检查
- **AND** 同 deadline、跨批次或单条失败 MUST NOT 造成后续 fact 静默遗漏

### Requirement: Timeout processing recovers safely from interruption

系统 MUST 从已提交 facts 恢复 due `PENDING` 和 terminal 尚未完成的 `TIMED_OUT`。单条或 dependency failure MUST NOT 终止系统进程、回滚已完成状态或阻止后续 eligible fact；依赖恢复后 MUST 继续收敛缺失的 canonical timeout event 和 terminal result。系统关闭或 session 删除后 MUST 不再处理已退出其有效生命周期范围的 timeout fact。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复

**适用范围**：该 Function

#### Scenario: Startup processes already-due facts before readiness

- **GIVEN** 系统启动时可信 Agent Scope 内存在 due `PENDING` facts
- **WHEN** startup recovery 完成
- **THEN** 系统 MUST 在 readiness 前执行一次 timeout recovery
- **AND** MUST NOT 处理其他 Agent Scope 的 fact
- **AND** future `PENDING` facts MUST 继续在各自 accepted deadline 后得到处理

#### Scenario: Partial timeout completion is retried from durable facts

- **GIVEN** pending input 已为 `TIMED_OUT`
- **AND** owning RequestRun 尚未完成 terminal result
- **WHEN** 之前的 timeout attempt 在 canonical event 或 terminal result 完成前中断
- **THEN** 后续 processing MUST 重新发现并继续该 incomplete fact
- **AND** MUST 幂等形成 canonical `USER_INPUT_TIMEOUT`
- **AND** MUST 幂等完成 `FAILED/PENDING_INPUT_TIMEOUT`
- **AND** MUST NOT 把 pending input 恢复为 `PENDING` 或恢复原 run

#### Scenario: One candidate failure does not stop later candidates

- **GIVEN** 同一批次中一个 timeout fact 因 dependency 暂时不可用而失败
- **WHEN** 该批次还有其他 eligible facts
- **THEN** 系统 MUST 继续处理其他 facts
- **AND** dependency 恢复后 MUST 重试 incomplete fact
- **AND** failure MUST NOT 终止系统进程

#### Scenario: Session deletion removes timeout facts

- **GIVEN** 一个 session 已没有 active run 且包含 resolved 或 terminal pending-input facts
- **WHEN** scoped session deletion 成功
- **THEN** 该 session 的 pending-input facts MUST 不再可见或可被 timeout processing 重新发现
- **AND** 删除 MUST NOT 影响其他 session 的 timeout facts

#### Scenario: Runtime close stops timeout processing

- **WHEN** 系统关闭开始
- **THEN** 系统 MUST 不再启动新的 timeout processing flow
- **AND** 已开始的 flow MUST 在既有 bounded close budget 内结束或停止
- **AND** 关闭完成后 MUST 不再处理新的 timeout fact

### Requirement: Timeout is visible and rejects late answers

系统 MUST 把 completed timeout 作为 pending-input lifecycle event 暴露，并拒绝所有 late answers。Timeout MUST 通过与其他 committed lifecycle facts 相同的 canonical stream、history、session activity 和 frontend pending-input projection 可见。

**需求类别**：功能性需求

#### Scenario: Timeout publishes safe event

- **WHEN** pending input 收敛为 `TIMED_OUT`
- **THEN** 系统 MUST 发布 canonical `USER_INPUT_TIMEOUT`
- **AND** stream projection MUST 只暴露 pending input id、kind、status 和 safe summary
- **AND** MUST NOT 暴露 raw prompt、raw answer、model-formatted answer、identity、idempotency key 或 timeout behavior

#### Scenario: Timed-out background session becomes unread failure

- **GIVEN** 一个 session 已投影为 `WAITING_FOR_INPUT`
- **AND** 用户正在查看其他 session
- **WHEN** pending input timeout 与 owning RequestRun terminal result 完成
- **THEN** 既有 session activity projection MUST 把 `WAITING_FOR_INPUT` 替换为 `UNREAD_FAILURE`
- **AND** MUST NOT 要求 timed-out session detail stream 保持打开

#### Scenario: Switching back restores the normal Composer

- **GIVEN** pending input 在其 session 非当前 conversation 时超时
- **WHEN** 用户打开该 session 且 canonical timeout history 或 stream facts 已投影
- **THEN** agent-web MUST 不再保持 timed-out pending-input response surface
- **AND** MUST 呈现 normal message Composer
- **AND** local countdown expiry MUST 继续无权清除 pending input state

#### Scenario: Late answer after timeout is rejected

- **WHEN** channel 为已收敛为 `TIMED_OUT` 的 pending input 提交 answer
- **THEN** 系统 MUST 返回安全 timeout/conflict outcome
- **AND** MUST NOT 恢复原 run
- **AND** MUST NOT 把 timed-out fact 改回 `RECEIVED`
