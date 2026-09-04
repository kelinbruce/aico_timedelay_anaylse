## ADDED Requirements

### Requirement: Agent 和 Owner 作用域内的最新请求取消命令
NextAgent TS runtime MUST 通过 Runtime command boundary 暴露用户发起的 request cancellation。cancel command MUST 只面向一个可信 agent+owner-scoped session lane 中当前最新的可取消请求。Channel、Session、Agent Loop、Model、Capability、Gateway 和 App composition MUST NOT 创建竞争性的 cancel state machine，也不得直接发布 request terminal lifecycle event。

#### Scenario: Channel 通过 Runtime command boundary 发送取消命令
- **WHEN** Web channel 收到用户取消当前工作的请求
- **THEN** channel MUST 构造 `RequestControlCommand`
- **AND** command MUST 包含可信 `identityContext`、`sessionId`、`expectedLatestRequestId`、action `CANCEL` 和非空 canonical `idempotencyKey`
- **AND** channel MUST 调用 `RuntimeCommandPort.cancel`
- **AND** channel MUST NOT 直接写入 `RunStatus.CANCELED`、追加 `REQUEST_CANCELED`、释放 session lane 或修改 session history

#### Scenario: Channel 在进入 Runtime 前归一化公开取消 action
- **WHEN** public Web/channel boundary 收到 cancel action `CANCEL_LATEST` 或 `CANCEL`
- **THEN** channel MUST 在调用 `RuntimeCommandPort.cancel` 前把 action 归一化为 canonical Runtime command action `CANCEL`
- **AND** Runtime command boundary MUST NOT 接收 `CANCEL_LATEST` 作为 canonical Runtime action
- **AND** idempotency semantic comparison MUST 使用归一化后的 `CANCEL` action
- **AND** 同一个可信 owner、session 和 latest request 下，同一个 `idempotencyKey` 分别配合 public action `CANCEL_LATEST` 与 `CANCEL` 使用时，MUST 被视为同一个 cancel command semantic，而不是 `REQUEST_CANCEL_IDEMPOTENCY_CONFLICT`

#### Scenario: Runtime 拒绝缺少 canonical idempotency key 的取消命令
- **WHEN** Runtime 处理 `RuntimeCommandPort.cancel`，且 command 缺少 `idempotencyKey` 或 `idempotencyKey` 为空白
- **THEN** Runtime MUST 以安全 validation outcome 拒绝该 command
- **AND** Runtime MUST 使用稳定错误码 `REQUEST_CANCEL_IDEMPOTENCY_REQUIRED`
- **AND** Runtime MUST NOT 因该无效 command 读取或修改 `RequestRun`、terminal commit state、scheduler state、session history 或 timeline facts
- **AND** 本 Runtime requirement 不定义 public Web DTO 的 key 是来自 client 还是由 Channel 生成

#### Scenario: Runtime 校验 agent、owner scope 和最新请求
- **WHEN** Runtime 处理 `RuntimeCommandPort.cancel`
- **THEN** Runtime MUST 使用 `identityContext.tenantId`、`identityContext.subjectId`、trusted `agentId` 和 `sessionId` 校验目标 lane
- **AND** trusted `agentId` MUST 来自 app composition、hosted-agent selection 或已持久化的 `Session.agentId` / `RequestRun.agentId`，不得来自 client payload
- **AND** Runtime MUST 验证 `expectedLatestRequestId` 匹配该 agent+owner-scoped session lane 中 runtime-known latest request
- **AND** Runtime MUST 在不修改任何 `RequestRun` 的情况下拒绝 stale latest-request input
- **AND** Runtime MUST NOT 使用 client payload、client metadata、model output 或 capability arguments 覆盖可信 identity context

#### Scenario: 该命令不支持取消历史 run
- **WHEN** cancel command 引用的 request 不是 agent+owner-scoped session lane 中的 latest request
- **THEN** Runtime MUST 以安全 stale-latest outcome 拒绝该 command
- **AND** Runtime MUST NOT 通过 `runId` 或隐藏 client metadata 取消更早的 historical run

### Requirement: 可取消请求状态分类
Runtime MUST 基于 durable RequestRun facts 和 terminal commit state 对 request run 是否可取消进行分类。当 `ACCEPTED`、`QUEUED` 和 `EXECUTING` run 是 agent+owner-scoped session lane 中的 latest request 时，它们是 cancelable。`COMPLETED`、`FAILED`、`CANCELED` 和 `SUPERSEDED` run 是 terminal，不可取消。`terminalCommitState` 为 `PENDING` 或 `RETRYING` 的 run MUST 被视为 terminal-pending，并且 MUST NOT 接收第二次 cancel terminal transition。

#### Scenario: Accepted 或 queued latest run 可取消
- **WHEN** 最新 agent+owner-scoped request run 是 `ACCEPTED` 或 `QUEUED`
- **THEN** Runtime MUST 将该 run 视为可取消的 pre-execution work
- **AND** Runtime MUST 通过 queued cancel path 处理取消
- **AND** Runtime MUST NOT 要求 Agent execution 已开始后才能取消该 run

#### Scenario: Executing latest run 可取消
- **WHEN** 最新 agent+owner-scoped request run 是 `EXECUTING`
- **THEN** Runtime MUST 将该 run 视为可取消的 executing work
- **AND** Runtime MUST 通过 executing cancel path 处理取消

#### Scenario: Terminal latest run 不可取消
- **WHEN** 最新 agent+owner-scoped request run 是 `COMPLETED`、`FAILED`、`CANCELED` 或 `SUPERSEDED`
- **THEN** Runtime MUST 以 already terminal 拒绝 cancel command
- **AND** Runtime MUST NOT 为该 run 追加另一个 terminal lifecycle event

#### Scenario: Terminal-pending latest run 不接收第二次取消
- **WHEN** 最新 agent+owner-scoped request run 的 `terminalCommitState` 是 `PENDING` 或 `RETRYING`
- **THEN** Runtime MUST NOT 为该 run 开始新的 cancel terminal transition
- **AND** Runtime MUST 保持 same-lane terminal visibility 和 lane release 被阻塞，直到 pending terminal commit 达到稳定结果
- **AND** 当 command 重复使用已经启动该 pending terminal transition 的同一个 `idempotencyKey` 时，Runtime MUST 从目标 `RequestRun` terminal commit idempotency metadata 派生 original 或 equivalent accepted outcome
- **AND** 当 command 是针对该 already terminal-pending run 的新 cancel command 时，Runtime MUST 返回 safe terminal-pending outcome

### Requirement: Queued request cancellation 规则
Runtime MUST 通过对齐 process-local scheduler state 和 durable terminal fact 来取消 latest queued work。移除 scheduler pending work item MUST NOT 成为唯一取消效果。

#### Scenario: Runtime 取消 queued run
- **WHEN** Runtime 接受针对 latest agent+owner-scoped run 的 cancel，且该 run 是 `ACCEPTED` 或 `QUEUED`
- **THEN** Runtime MUST cancel、remove 或 correct 该 run 的任何 scheduler pending work item
- **AND** Runtime MUST 将该 run terminal commit 为 `RunStatus.CANCELED`
- **AND** Runtime MUST 通过 Runtime terminal commit path 追加 canonical `REQUEST_CANCELED` terminal timeline event
- **AND** Runtime MUST NOT 在 terminal commit 成功后继续为该 canceled queued run 调用 Agent execution

#### Scenario: Queued cancellation 留下可审计的 canceled request
- **WHEN** queued request 被取消
- **THEN** 该 request MUST 仍由 durable `RequestRun` 表示
- **AND** durable run MUST 在 terminal commit 成功后表明 `RunStatus.CANCELED`
- **AND** 系统 MUST NOT 仅因为 request 从 scheduler pending queue 中移除，就让它从 runtime facts 中消失

### Requirement: Executing request cancellation 规则
Runtime MUST 通过 Runtime-owned execution control boundary 取消 latest executing work，并且 MUST 使用 terminal commit 记录 canceled request lifecycle fact。

#### Scenario: Runtime 在 terminalizing cancellation 前 signal executing work
- **WHEN** Runtime 接受针对 latest agent+owner-scoped run 的 cancel，且该 run 是 `EXECUTING`
- **THEN** Runtime MUST signal 该 run 的 execution handle、`AbortSignal` 或等价 Runtime-owned cancellation context
- **AND** 参与该 run 的 Agent、Model、Capability、Gateway 和 stream delivery boundaries 在支持 asynchronous cancellation 时，MUST 接收或观察 runtime-owned cancellation context
- **AND** Runtime MUST 使用 canonical `REQUEST_CANCELED` terminal event 将 request terminal commit 为 `RunStatus.CANCELED`
- **AND** Runtime MUST NOT 要求 downstream providers 或 tools 物理停止后才能尝试 canceled terminal commit

#### Scenario: Non-cancelable adapter 返回 typed cancellation outcome
- **WHEN** 参与中的 Model、Capability、Gateway 或 stream delivery adapter 无法原生消费 `AbortSignal`
- **THEN** adapter MUST 向 Runtime boundary 返回 typed cancellation 或 timeout outcome
- **AND** Runtime MUST 在该 outcome 穿过 API、stream、audit 或 log boundary 前完成归一化
- **AND** adapter MUST NOT 自行发布 request terminal lifecycle events

### Requirement: Canceled terminal visibility 和 lane release
Runtime MUST 只在 terminal durable-write boundary 成功或得到 idempotent already-committed result 后，让 canceled terminal facts 可见。`RequestControlAccepted` MUST 表示 control command acceptance，而不是 client-visible terminal completion。

#### Scenario: Cancel accepted 不是可见 canceled terminal
- **WHEN** Runtime 为 cancel command 返回 `RequestControlAccepted`
- **THEN** clients MUST NOT 仅根据该 command response 推断 `REQUEST_CANCELED` 已经在 stream 或 history 中可见
- **AND** client-visible canceled terminal stream events MUST 来自 committed Runtime terminal facts

#### Scenario: Accepted cancel 可以等待 pending terminal commit
- **WHEN** Runtime 接受 cancel command，且 canceled terminal commit 进入 `PENDING` 或 `RETRYING`
- **THEN** Runtime MUST 将 original command 的 accepted control outcome 保存在目标 `RequestRun` terminal commit idempotency metadata 中
- **AND** Runtime MUST NOT 仅因为 terminal durable commit 尚未稳定，就把 original accepted command 转换成 `REQUEST_CANCEL_TERMINAL_PENDING`
- **AND** stream、history 和 same-lane release MUST 继续等待 committed 或 idempotent already-committed terminal fact

#### Scenario: Canceled terminal 在 durable commit 后出现
- **WHEN** canceled run 的 Runtime terminal commit 返回 committed 或 idempotent already-committed
- **THEN** Runtime MUST 让 canonical `REQUEST_CANCELED` terminal event 可被 stream projection 使用
- **AND** visible conversation history MUST 能一致读取 canceled terminal state
- **AND** Runtime MUST 为后续 queued work 释放 same-lane execution gate

#### Scenario: Pending cancel terminal 不作为 committed 可见
- **WHEN** canceled run 的 Runtime terminal commit 处于 pending 或 retrying
- **THEN** Runtime MUST NOT 将 client-visible `REQUEST_CANCELED` 发布为 committed terminal event
- **AND** Runtime MUST NOT 为 terminal-writing work 释放 same-lane execution gate
- **AND** Runtime MUST 保留足够的 terminal-pending fact，供 recovery 或 terminal retry 完成该 boundary

### Requirement: Cancel idempotency 和单一 terminal outcome
Runtime MUST 对使用相同 `idempotencyKey` 且具有相同 cancel command semantic 的重复命令保持 request cancellation idempotent，并且 MUST 在 cancel 与 cancel、completed、failed 或 superseded outcomes 竞态时防止重复 terminal lifecycle events。Cancel command semantic MUST 包含 trusted agent+owner scope、`sessionId`、`expectedLatestRequestId`、normalized action `CANCEL` 和 `idempotencyKey`；Runtime MUST NOT 使用 client metadata、model output、capability input 或 hidden payload fields 改变该 semantic。Accepted cancel replay MUST 从目标 `RequestRun` terminal commit idempotency metadata 派生；Runtime MUST NOT 为 cancel accepted replay 创建单独的 durable command outcome fact。

#### Scenario: 相同 idempotency key 的重复 cancel 保持幂等
- **WHEN** Runtime 收到具有相同 `idempotencyKey` 的同一个 cancel command
- **THEN** Runtime MUST 返回 original accepted command response、newly derived rejected command response 或 equivalent idempotent response
- **AND** Runtime MUST NOT 创建另一个可能产生第二个 terminal lifecycle event 的 terminal commit attempt
- **AND** 如果 original accepted cancel 是 terminal-pending，Runtime MUST 返回 original 或 equivalent accepted pending outcome，而不是新的 terminal-pending conflict

#### Scenario: Runtime restart 后重复 cancel 仍保持幂等
- **WHEN** Runtime 接受 cancel command 后 runtime process restart
- **AND** Runtime 随后收到具有相同 `idempotencyKey` 和相同 cancel command semantic 的同一个 cancel command
- **THEN** Runtime MUST 从 durable agent+owner-scoped gateway facts 中的目标 `RequestRun` terminal commit idempotency metadata 恢复 original 或 equivalent accepted control outcome
- **AND** Runtime MUST NOT 依赖单独的 command outcome record 作为 accepted replay 的 durable source
- **AND** Runtime MUST NOT 只依赖 process-local memory 作为 accepted outcome 的唯一来源
- **AND** Runtime MUST NOT 创建另一个可能产生第二个 terminal lifecycle event 的 terminal commit attempt

#### Scenario: 相同 cancel idempotency key 配合不同 command semantic 时冲突
- **WHEN** Runtime 收到的 cancel command 使用了已被不同 cancel command semantic 使用过的 `idempotencyKey`
- **THEN** Runtime MUST 以 idempotency conflict safe error 拒绝该 command
- **AND** Runtime MUST 使用稳定错误码 `REQUEST_CANCEL_IDEMPOTENCY_CONFLICT`
- **AND** Runtime MUST NOT 启动新的 cancellation transition、terminal commit attempt、scheduler correction 或 timeline publication

#### Scenario: Terminal state 后的重复 cancel 被安全拒绝
- **WHEN** Runtime 收到针对 latest run 的 cancel command，且该 run 已经是 `CANCELED`
- **AND** command 不匹配 original idempotent cancel command
- **THEN** Runtime MUST 返回 safe already-terminal 或 conflict outcome
- **AND** Runtime MUST NOT 追加另一个 `REQUEST_CANCELED` event

#### Scenario: 并发 terminal attempts 只产生一个 terminal lifecycle event
- **WHEN** cancel 与同一 run 的另一个 cancel、normal completion、failure 或 supersession terminalization 发生竞态
- **THEN** Runtime MUST 使用 terminal commit compare-and-set、version check 或等价 fencing，确保该 run 至多产生一个 terminal lifecycle event
- **AND** 失败的 terminal attempts MUST 返回 safe conflict、already-committed 或 version-conflict outcome
- **AND** Runtime MUST NOT 把 partial intermediate terminal state 暴露为 client-visible completion

### Requirement: 取消后的 late output suppression
Runtime MUST 防止 committed canceled terminal 之后产生的输出改变 visible request outcome。already canceled execution chain 的 late output MUST NOT 创建 final assistant answer、覆盖 `RunStatus.CANCELED` 或追加另一个 request terminal lifecycle event。

#### Scenario: 取消后的 late model output 不作为 final answer 可见
- **WHEN** Model stream 或 final result 在 Runtime 已为该 run committed `RunStatus.CANCELED` 后到达
- **THEN** Runtime MUST drop、reject 或将该 output 标记为 non-terminal diagnostic data
- **AND** Runtime MUST NOT 将其投影为 canceled request 的 final assistant answer
- **AND** Runtime MUST NOT 用 `COMPLETED` 替换 canceled terminal state

#### Scenario: 取消后的 late capability output 不修改 terminal state
- **WHEN** Capability result 在 Runtime 已为该 run committed `RunStatus.CANCELED` 后到达
- **THEN** Runtime MUST NOT 使用该 result 追加 visible terminal assistant message
- **AND** Runtime MUST NOT 让该 result 产生另一个 `REQUEST_COMPLETED`、`REQUEST_FAILED` 或 `REQUEST_CANCELED` event
- **AND** 任何保留的 diagnostic fact MUST 继续关联到 canceled run，并且对 audit/log boundaries 保持安全

### Requirement: Cancel 和 supersession 保持区分
Runtime MUST 区分用户发起的 cancellation 和 replacement supersession。User cancel MUST 将 run terminalize 为 `CANCELED`；latest-submit replacement、edit-resubmit replacement 或其他 explicit replacement flows MUST 将 replaced work terminalize 为 `SUPERSEDED`。

#### Scenario: User cancel 使用 canceled terminal fact
- **WHEN** 用户显式取消最新可取消 request
- **THEN** Runtime MUST 使用 `RunStatus.CANCELED` terminal commit 该 request
- **AND** Runtime MUST 产生 `REQUEST_CANCELED`
- **AND** Runtime MUST NOT 将 user-canceled request 归类为 `SUPERSEDED`

#### Scenario: Later submit replacement 不等同于 user cancel
- **WHEN** newer submit 替换同一 lane 中 older queued 或 executing work
- **THEN** Runtime MUST 对 older run 使用 replacement/supersession policy
- **AND** Runtime MUST NOT 仅因为 newer work 替换了 older run 就为 older run 发布 `REQUEST_CANCELED`

#### Scenario: Cancel 与 supersession 竞态通过 terminal commit 决定结果
- **WHEN** user cancel 和 replacement/supersession terminal attempt 针对同一 run 发生竞态
- **THEN** Runtime MUST 让第一个成功的 terminal commit 定义该 run 的 terminal status
- **AND** 另一个 terminal attempt MUST 观察到 already-committed、version-conflict 或 safe conflict outcome
- **AND** Runtime MUST NOT 为同一个 run 同时发布 `REQUEST_CANCELED` 和 `REQUEST_SUPERSEDED`

### Requirement: Request cancel 安全错误
Runtime MUST 为无效 cancel commands 和 cancellation infrastructure failures 返回安全、确定的错误。User-visible cancel errors MUST NOT 暴露 raw tenant、subject、credential、prompt、model output、tool arguments、adapter-private query detail、local path、stack trace 或 hidden resource existence。

#### Scenario: Cancel idempotency key 缺失
- **WHEN** cancel command 缺少非空 canonical `idempotencyKey`
- **THEN** Runtime MUST 以 category `VALIDATION` 拒绝该 command
- **AND** Runtime MUST 使用稳定错误码 `REQUEST_CANCEL_IDEMPOTENCY_REQUIRED`
- **AND** Runtime MUST 设置 `retryable=false`

#### Scenario: Cancel idempotency key 冲突
- **WHEN** 同一个 `idempotencyKey` 被不同 cancel command semantics 复用
- **THEN** Runtime MUST 返回 category `CONFLICT`
- **AND** Runtime MUST 使用稳定错误码 `REQUEST_CANCEL_IDEMPOTENCY_CONFLICT`
- **AND** Runtime MUST 设置 `retryable=false`

#### Scenario: 非 latest cancel 返回 safe conflict
- **WHEN** `expectedLatestRequestId` 不匹配 agent+owner-scoped session lane 中的 latest request
- **THEN** Runtime MUST 以 safe conflict category 拒绝 cancel command
- **AND** Runtime MUST 使用等价于 `REQUEST_CANCEL_NOT_LATEST` 的稳定错误码

#### Scenario: 取消 terminal run 返回 safe conflict
- **WHEN** target latest run 已经 terminal
- **THEN** Runtime MUST 以 safe conflict category 拒绝 cancel command
- **AND** Runtime MUST 使用等价于 `REQUEST_CANCEL_ALREADY_TERMINAL` 的稳定错误码

#### Scenario: 取消 terminal-pending run 返回 safe conflict
- **WHEN** target latest run 的 `terminalCommitState` 是 `PENDING` 或 `RETRYING`
- **AND** command 不匹配启动该 pending terminal transition 的 original idempotent cancel command
- **THEN** Runtime MUST 以 safe conflict category 拒绝新的 cancel transition
- **AND** Runtime MUST 使用等价于 `REQUEST_CANCEL_TERMINAL_PENDING` 的稳定错误码

#### Scenario: Cancel target 在 agent 和 owner scope 内不存在
- **WHEN** Runtime 在 trusted agent+owner scope 内找不到目标 session lane 或 latest request
- **THEN** Runtime MUST 返回 safe not-found outcome
- **AND** Runtime MUST NOT 泄漏其他 agent 或 owner scope 下是否存在匹配的 session、message 或 run

#### Scenario: Cancel terminal commit infrastructure 失败
- **WHEN** store 或 gateway 不可用，导致 Runtime 无法到达 terminal commit persistence boundary
- **THEN** Runtime MUST 返回或记录 safe unavailable outcome
- **AND** Runtime MUST NOT 暴露 raw storage、network、SQL、filesystem 或 credential details
- **AND** Runtime MUST NOT 在缺少 committed 或 idempotent terminal fact 的情况下发布 committed `REQUEST_CANCELED` terminal event

### Requirement: Request cancel 跨 capability boundaries
Request cancel MUST 为参与执行边界产生 root request cancellation facts 和 cancellation context，但 MUST NOT 吸收 pending input、invoked agents、stream replay、runtime recovery、retry/edit 或 parallel execution 的完整对象模型。

#### Scenario: Pending input 被 root request cancel 失效
- **WHEN** cancel command terminalizes 一个正在等待 pending input 的 root request
- **THEN** Runtime MUST 使该 pending input 无法 resume canceled run
- **AND** 该 pending input 的 late answer MUST 以 safe conflict 或 canceled outcome 被拒绝
- **AND** 详细 pending input object lifecycle 仍由 pending-input capability 拥有

#### Scenario: Invoked agent 或 capability 接收 root cancellation context
- **WHEN** canceled root request 存在 in-flight invoked Agent capability、Tool、Skill 或 external capability call
- **THEN** Runtime MUST 在 capability invocation boundary 存在时通过该 boundary 传播 cancellation context
- **AND** invoked execution MUST NOT 直接发布 root request terminal lifecycle events
- **AND** result return、branch isolation 和 child-agent aggregation 仍由各自 dedicated capabilities 拥有

#### Scenario: Stream replay 消费 committed cancel facts
- **WHEN** client 在 request 已取消后 reconnect 或请求 replay stream state
- **THEN** stream replay MUST 消费 committed `REQUEST_CANCELED` timeline fact
- **AND** 本 request-cancel capability MUST NOT 定义 stream gap outcome、replay cursor storage 或 transport-specific reconnect behavior
