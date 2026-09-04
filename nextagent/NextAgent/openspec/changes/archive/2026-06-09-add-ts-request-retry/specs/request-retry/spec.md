## ADDED Requirements

### Requirement: Agent 和 Owner 作用域内的最新请求重试命令
NextAgent TS runtime MUST 通过 Runtime command boundary 暴露 request retry。Retry command MUST 只面向一个可信 agent+owner-scoped session lane 中当前最新且已 terminal-committed 的 request。Channel、Session、Context、Agent Loop、Model、Capability、Gateway 和 App composition MUST NOT 创建竞争性的 retry state machine，也不得直接修改 retry attempt visibility。

#### Scenario: Channel 通过 Runtime command boundary 发送 retry
- **WHEN** Web channel 收到用户重试当前 latest response 的请求
- **THEN** channel MUST 构造 `RequestControlCommand`
- **AND** command MUST 包含可信 `identityContext`、`sessionId`、`expectedLatestRequestId`、action `RETRY` 和非空 canonical `idempotencyKey`
- **AND** channel MUST 调用 `RuntimeCommandPort.retry`
- **AND** channel MUST NOT 直接创建 `RequestRun`、修改 attempt、隐藏消息、追加 retry timeline event 或重新组装 model context

#### Scenario: Runtime 拒绝缺少 canonical idempotency key 的 retry command
- **WHEN** Runtime 处理 `RuntimeCommandPort.retry`，且 command 缺少 `idempotencyKey` 或 `idempotencyKey` 为空白
- **THEN** Runtime MUST 以安全 validation outcome 拒绝该 command
- **AND** Runtime MUST 使用稳定错误码 `REQUEST_RETRY_IDEMPOTENCY_REQUIRED`
- **AND** Runtime MUST NOT 因该无效 command 创建 attempt、修改 visibility、触发 scheduler 或读取 source attachments

#### Scenario: Runtime 校验 agent、owner scope 和 latest request
- **WHEN** Runtime 处理 `RuntimeCommandPort.retry`
- **THEN** Runtime MUST 使用 `identityContext.tenantId`、`identityContext.subjectId`、trusted `agentId` 和 `sessionId` 校验目标 lane
- **AND** trusted `agentId` MUST 来自 app composition、hosted-agent selection 或已持久化的 `Session.agentId` / `RequestRun.agentId`，不得来自 client payload
- **AND** Runtime MUST 验证 `expectedLatestRequestId` 匹配该 agent+owner-scoped session lane 中 runtime-known latest request
- **AND** Runtime MUST 在不创建新 attempt 的情况下拒绝 stale latest-request input
- **AND** Runtime MUST NOT 使用 client payload、client metadata、model output 或 capability arguments 覆盖可信 identity context

#### Scenario: 该命令不支持 historical request retry
- **WHEN** retry command 引用的 request 不是 agent+owner-scoped session lane 中的 latest request
- **THEN** Runtime MUST 以安全 stale-latest outcome 拒绝该 command
- **AND** Runtime MUST NOT 通过 `runId`、hidden client metadata 或历史 message selection 重试更早的 historical request

### Requirement: Retryable request 状态分类
Runtime MUST 基于 durable RequestRun facts、terminal commit state 和 latest request 语义判定 request 是否 retryable。只有已经完成 terminal commit 的 latest request 才可 retry。Active、queued、executing 或 terminal-pending latest request MUST NOT 被 retry。Retry MUST NOT 把 user cancel、supersession、pending input 或 edit-resubmit 隐式合并为同一个 control flow。

#### Scenario: Terminal committed latest run 可 retry
- **WHEN** latest agent+owner-scoped request run 是 `COMPLETED`、`FAILED`、`CANCELED` 或 `SUPERSEDED`，且 terminal commit 已稳定完成
- **THEN** Runtime MUST 将该 latest request 视为 retryable
- **AND** Runtime MUST 通过 retry acceptance path 创建同一 request 的新 attempt

#### Scenario: Active 或 queued latest run 不可 retry
- **WHEN** latest request run 是 `ACCEPTED`、`QUEUED` 或 `EXECUTING`
- **THEN** Runtime MUST 以 safe conflict outcome 拒绝 retry command
- **AND** Runtime MUST NOT 为该 request 创建新 attempt

#### Scenario: Terminal-pending latest run 不可 retry
- **WHEN** latest request run 的 `terminalCommitState` 是 `PENDING` 或 `RETRYING`
- **THEN** Runtime MUST 以 safe terminal-pending outcome 拒绝 retry command
- **AND** Runtime MUST NOT 使用尚未稳定的 terminal result 作为 retry source

### Requirement: Retry 创建同一 request 的新 attempt
Retry MUST 创建同一个 `requestId` 下的新 `RequestRun` attempt，而不是创建新的 user request。新 attempt MUST durable link 到被 retry 的 previous attempt，并保留 original request identity、trusted owner scope、agent scope 和 execution assembly。Runtime MUST 拥有 attempt numbering 和 lineage。

#### Scenario: 首次 retry 创建 attempt two
- **WHEN** latest terminal request 的当前最高 attempt 是 `1`
- **THEN** Runtime MUST 为相同 `requestId` 创建 attempt `2`
- **AND** 新 `RequestRun` MUST 使用新的 `runId`
- **AND** 新 `RequestRun` MUST 记录 `retryOfRunId` 或等价 previous-attempt durable link
- **AND** Runtime MUST NOT 创建新的 user request message 来伪装 retry

#### Scenario: 连续 retry 指向 previous attempt
- **WHEN** 用户对已经 retry 过的 latest request 再次执行 retry
- **THEN** Runtime MUST 基于当前 latest terminal attempt 创建下一 attempt
- **AND** 新 attempt MUST link 到其直接 previous attempt
- **AND** request lineage MUST 允许追溯 original request 和每个 retry attempt

#### Scenario: Retry lineage 是 durable fact
- **WHEN** runtime process restart 后读取 retry request history
- **THEN** gateway facts MUST 仍可恢复每个 attempt 的 `requestId`、`runId`、`attempt` 和 previous-attempt link
- **AND** lineage MUST NOT 依赖 process-local memory、frontend state 或 projection cache

#### Scenario: Retry 保留 original execution assembly
- **WHEN** Runtime 接受 retry
- **THEN** 新 attempt MUST 使用 source request/run 固化的 `agentId`、`agentVersion`、`agentAssemblyRef` 和必要 execution profile
- **AND** Runtime MUST NOT 因当前默认 Agent config 或 client-provided agent field 改变 retry execution assembly

### Requirement: Retry 复校验 source attachments
Retry MUST 在接受前重新校验 source request 使用的附件引用。附件必须仍属于同一 trusted owner scope 和 agent scope，并且仍处于可用于 retry 的状态。Retry MUST NOT 因为原 attempt 已经使用过附件就绕过 attachment runtime availability checks。

#### Scenario: Retry attachment refs 在 acceptance 前复校验
- **WHEN** source request 包含 attachment refs
- **THEN** Runtime MUST 在 retry acceptance 前调用 attachment runtime 或等价 trusted boundary 复校验这些 refs
- **AND** 复校验 MUST 确认 attachment 仍可用、未过期、未被删除且满足 retry 使用条件
- **AND** Runtime MUST NOT 在复校验失败时创建 retry attempt

#### Scenario: Retry attachment validation 使用可信 scope
- **WHEN** Runtime 复校验 retry source attachments
- **THEN** validation MUST 使用 trusted `tenantId`、`subjectId`、`agentId` 和 source request/session coordinates
- **AND** validation MUST NOT 信任 client payload 中重新提交的 attachment owner、path、media type 或 availability metadata

#### Scenario: Source attachments 不可用时 retry 被拒绝
- **WHEN** source request 的任一 required attachment 已不可用
- **THEN** Runtime MUST 以 safe attachment-unavailable outcome 拒绝 retry
- **AND** Runtime MUST NOT 泄漏 attachment path、raw content、credential、hidden owner existence 或 storage detail
- **AND** Runtime MUST NOT 隐藏 old attempt output，因为 retry 未被接受

### Requirement: Retry acceptance 将 new attempt 排队
Retry acceptance MUST 把新 attempt 放入正常 same-lane scheduler path。Retry MUST NOT inline execute Agent，也不得绕过 session lane scheduling、terminal-pending protection、same-lane serial execution 或 queue capacity checks。

#### Scenario: Retry run 进入 scheduler path
- **WHEN** Runtime 接受 retry command
- **THEN** Runtime MUST durable create 新 `RequestRun` attempt
- **AND** Runtime MUST 将该 attempt 标记为 accepted/queued work
- **AND** Runtime MUST 通过 session lane scheduler 分发该 work
- **AND** Runtime MUST NOT 在 retry command handler 中 inline invoke Agent execution

#### Scenario: Retry 遵守 same-lane dispatch protection
- **WHEN** same agent+owner-scoped session lane 中仍存在 queued、executing 或 terminal-pending work
- **THEN** retry attempt MUST 遵守同一 lane 的 dispatch gate
- **AND** Runtime MUST NOT 让 retry attempt 与同 lane active work 并行执行

#### Scenario: Queue 或 scheduler rejection 不污染 retry idempotency
- **WHEN** retry acceptance 因 queue capacity、scheduler unavailable 或 equivalent admission failure 未能创建 accepted retry run
- **THEN** Runtime MUST 返回 safe unavailable 或 capacity outcome
- **AND** Runtime MUST NOT 记录会让相同 retry command 被误判为 accepted 的 idempotency anchor
- **AND** Runtime MUST NOT 隐藏 old attempt output

### Requirement: Retry 替换默认历史可见性
Retry 被接受后，默认 conversation history MUST 隐藏被替换 attempt 的 assistant output 和 capability result messages，使普通用户视图展示 latest retry attempt 的结果。隐藏旧输出是 visibility projection policy，不等于删除事实；audit、debug 和显式 include hidden/capability result 读取仍可追溯旧 attempt。

#### Scenario: Retry queue acceptance 后隐藏 old assistant 和 capability results
- **WHEN** retry attempt 被 durable accepted/queued
- **THEN** Runtime or Session MUST hide source attempt 的 assistant final output messages 和 capability result messages from default history visibility
- **AND** hidden metadata MUST 标识 retry visibility replacement reason 和 replacement run/attempt coordinate
- **AND** source attempt 的 durable facts、timeline events 和 audit visibility MUST 保留

#### Scenario: Retry acceptance 前不隐藏 old result
- **WHEN** retry command validation 失败或 retry attempt 未被 accepted/queued
- **THEN** source attempt output MUST remain visible under default history rules
- **AND** Runtime MUST NOT 因 failed retry command 隐藏 assistant messages 或 capability results

#### Scenario: Hidden old result 仍可追溯
- **WHEN** authorized diagnostic read 或 include-hidden history read 请求查看 retry lineage
- **THEN** system MUST 能读取 source attempt 的 hidden assistant/capability messages 和 visibility reason
- **AND** hidden messages MUST NOT 被物理删除或丢失 owner/agent scope

#### Scenario: Retry visibility metadata 是 durable 且幂等的
- **WHEN** retry command 使用相同 `idempotencyKey` 重放
- **THEN** visibility replacement MUST NOT 重复隐藏同一 message 或生成冲突 metadata
- **AND** runtime restart 后 MUST 能从 durable facts 恢复 retry visibility state

### Requirement: Retry model context 排除被替换 attempt output
Retry attempt 的 model context MUST 排除被替换 attempt 的 assistant output 和 capability result output，避免模型把旧答案当作仍有效的对话事实。模型上下文选择 MUST 来自 active context/view policy，而不是仅依赖 public history visibility。

#### Scenario: Retry context 排除 previous assistant output
- **WHEN** Runtime 为 retry attempt 组装 model context
- **THEN** Context Engine MUST exclude source attempt 的 replaced assistant final output 和 capability result output
- **AND** Context Engine MAY include original user request 和仍有效的 prior conversation context
- **AND** Context Engine MUST NOT 仅因为 old output 仍存在 durable store 中就把它放入模型输入

#### Scenario: Hidden visibility 不单独定义 model context
- **WHEN** source output 被标记为 hidden due to retry
- **THEN** active context/view policy MUST 明确控制该 output 是否进入 retry model context
- **AND** public history visibility flag MUST NOT 成为唯一 model-visible context authority

### Requirement: Retry idempotency 和 latest-after-retry
Runtime MUST 对相同 `idempotencyKey` 和相同 retry command semantic 的重复 retry 保持幂等。Retry command semantic MUST 包含 trusted agent+owner scope、`sessionId`、`expectedLatestRequestId`、normalized action `RETRY` 和 `idempotencyKey`。Accepted retry replay MUST 从新 attempt 的 durable `RequestRun` acceptance idempotency anchor 派生；Runtime MUST NOT 为 retry accepted replay 创建单独 durable command outcome fact。Retry attempt 被接受后，new retry attempt MUST 成为 subsequent cancel/retry/control command 的 latest request。

#### Scenario: 相同 idempotency key 的重复 retry 保持幂等
- **WHEN** Runtime 收到具有相同 `idempotencyKey` 和相同 retry command semantic 的同一个 retry command
- **THEN** Runtime MUST 返回 original 或 equivalent accepted retry outcome
- **AND** Runtime MUST NOT 创建第二个 retry attempt
- **AND** Runtime MUST NOT 重复隐藏 source attempt output

#### Scenario: Runtime restart 后重复 retry 仍保持幂等
- **WHEN** Runtime 接受 retry command 后 runtime process restart
- **AND** Runtime 随后收到具有相同 `idempotencyKey` 和相同 retry command semantic 的同一个 retry command
- **THEN** Runtime MUST 从 durable agent+owner-scoped RequestRun acceptance anchor 恢复 original 或 equivalent accepted retry outcome
- **AND** Runtime MUST NOT 依赖 process-local memory 或单独 command outcome store
- **AND** Runtime MUST NOT 创建第二个 retry attempt

#### Scenario: 相同 idempotency key 配合不同 command semantic 时冲突
- **WHEN** Runtime 收到的 retry command 使用了已被不同 retry command semantic 使用过的 `idempotencyKey`
- **THEN** Runtime MUST 以 idempotency conflict safe error 拒绝该 command
- **AND** Runtime MUST 使用稳定错误码 `REQUEST_RETRY_IDEMPOTENCY_CONFLICT`
- **AND** Runtime MUST NOT 创建 attempt、隐藏 messages 或触发 scheduler

#### Scenario: New retry attempt 成为后续 control 的 latest
- **WHEN** retry attempt 被 accepted/queued
- **THEN** 该 retry attempt MUST 成为 same agent+owner-scoped session lane 的 latest request
- **AND** subsequent cancel command MUST target 该 retry attempt rather than source attempt
- **AND** subsequent retry command MUST wait until that retry attempt terminal-commits before it can retry again

#### Scenario: Active retry 期间的新 idempotency key 不是另一个 retry
- **WHEN** retry attempt 已经 accepted/queued/executing，但尚未 terminal-committed
- **AND** 用户发送新的 retry command 和新的 `idempotencyKey`
- **THEN** Runtime MUST 以 latest request not terminal 或 active latest conflict 拒绝该 command
- **AND** Runtime MUST NOT 并行创建另一个 retry attempt

### Requirement: Request retry 安全错误
Runtime MUST 为 invalid retry commands、source resource failures 和 retry infrastructure failures 返回安全、确定的错误。User-visible retry errors MUST NOT 暴露 raw tenant、subject、credential、prompt、model output、tool arguments、attachment content、adapter-private query detail、local path、stack trace 或 hidden resource existence。

#### Scenario: Retry not latest 返回 safe conflict
- **WHEN** `expectedLatestRequestId` 不匹配 agent+owner-scoped session lane 中的 latest request
- **THEN** Runtime MUST 以 safe conflict category 拒绝 retry command
- **AND** Runtime MUST 使用等价于 `REQUEST_RETRY_NOT_LATEST` 的稳定错误码

#### Scenario: Retry target 在 agent 和 owner scope 内不存在
- **WHEN** Runtime 在 trusted agent+owner scope 内找不到目标 session lane 或 latest request
- **THEN** Runtime MUST 返回 safe not-found outcome
- **AND** Runtime MUST NOT 泄漏其他 agent 或 owner scope 下是否存在 matching session、message 或 run

#### Scenario: Retry 被 authorization policy 禁止
- **WHEN** trusted identity 无权 retry 该 request
- **THEN** Runtime MUST 返回 safe authorization failure
- **AND** Runtime MUST NOT 泄漏 hidden request、attachment 或 source attempt existence

#### Scenario: Retry source attachment 不可用
- **WHEN** source request 的 required attachment 不再可用于 retry
- **THEN** Runtime MUST 返回 safe attachment-unavailable outcome
- **AND** Runtime MUST NOT 暴露 attachment content、path、credential、storage detail 或 owner mismatch detail

#### Scenario: Retry target 不是 terminal
- **WHEN** target latest run 是 `ACCEPTED`、`QUEUED` 或 `EXECUTING`
- **THEN** Runtime MUST 返回 safe conflict outcome
- **AND** Runtime MUST 使用等价于 `REQUEST_RETRY_TARGET_ACTIVE` 的稳定错误码

#### Scenario: Retry target terminal commit 正在 pending
- **WHEN** target latest run 的 terminal commit state 是 `PENDING` 或 `RETRYING`
- **THEN** Runtime MUST 返回 safe terminal-pending conflict
- **AND** Runtime MUST 使用等价于 `REQUEST_RETRY_TERMINAL_PENDING` 的稳定错误码

#### Scenario: Retry queue 或 scheduler 不可用
- **WHEN** Runtime 无法接受或排队 retry attempt，因为 scheduler、queue 或 durable acceptance boundary 不可用
- **THEN** Runtime MUST 返回 safe unavailable outcome
- **AND** Runtime MUST NOT 暴露 raw storage、scheduler internals、SQL、filesystem、network 或 credential detail

#### Scenario: Retry idempotency key 冲突
- **WHEN** 同一个 `idempotencyKey` 被不同 retry command semantic 复用
- **THEN** Runtime MUST 返回 category `CONFLICT`
- **AND** Runtime MUST 使用稳定错误码 `REQUEST_RETRY_IDEMPOTENCY_CONFLICT`
- **AND** Runtime MUST 设置 `retryable=false`

#### Scenario: Retry idempotency key 缺失
- **WHEN** retry command 缺少非空 canonical `idempotencyKey`
- **THEN** Runtime MUST 以 category `VALIDATION` 拒绝该 command
- **AND** Runtime MUST 使用稳定错误码 `REQUEST_RETRY_IDEMPOTENCY_REQUIRED`
- **AND** Runtime MUST 设置 `retryable=false`

#### Scenario: Retry visibility replacement 不可用
- **WHEN** retry attempt accepted 后，Runtime or Session 无法执行 required visibility replacement durable write
- **THEN** Runtime MUST fail closed，或通过 safe boundary outcome terminalize retry acceptance failure
- **AND** Runtime MUST NOT 把 partially hidden history 暴露为 successful retry
- **AND** Runtime MUST 保留足够 diagnostic fact 以便 recovery reconcile visibility state

### Requirement: Request retry 跨 capability boundaries
Request retry MUST 只拥有 retry command、attempt lineage、source validation、visibility replacement 和 model context exclusion。Edit-resubmit、stream projection、runtime recovery、attachment runtime、pending input、memory 和 invoked agent aggregation 仍由各自 capability 或 module 拥有。

#### Scenario: Edit-resubmit 保持独立 command
- **WHEN** 用户修改原始输入后再次提交
- **THEN** 该 flow MUST 使用 edit-resubmit 或后续专门 command，而不是 request retry command
- **AND** request retry MUST NOT 修改 original user input、attachment set 或 request payload

#### Scenario: Stream projection 消费 retry facts 但不拥有 retry
- **WHEN** stream projection 展示 retry accepted、retry running 或 retry result
- **THEN** projection MUST consume Runtime-owned RequestRun/timeline facts
- **AND** stream projection MUST NOT 创建 retry attempt、改变 visibility 或决定 retryability

#### Scenario: Recovery 可以完成 retry visibility handoff
- **WHEN** runtime recovery 发现 retry attempt 已 accepted 但 visibility replacement 尚未完成或需要 reconcile
- **THEN** recovery MAY 通过 owning session/runtime boundary 完成 idempotent visibility handoff
- **AND** recovery MUST NOT create another retry attempt

#### Scenario: Attachment runtime 校验资源但不拥有 retry
- **WHEN** Runtime 请求 attachment runtime 复校验 source attachment refs
- **THEN** attachment runtime MUST 返回 scoped availability outcome
- **AND** attachment runtime MUST NOT 创建 retry attempt、修改 retry lineage 或隐藏 conversation messages
