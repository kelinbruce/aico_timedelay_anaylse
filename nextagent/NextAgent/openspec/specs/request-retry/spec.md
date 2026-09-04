# request-retry Specification

## Purpose
定义 NextAgent TS runtime 中请求重试能力：retry command 必须通过 Runtime command boundary 进入，面向可信 agent+owner scoped session lane 中当前最新且已完成 terminal commit 的请求，并以同一个 request 的新 attempt 形式重新排队执行，同时维护历史可见性、幂等性、附件复校验和跨能力边界。
## Requirements
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

Runtime MUST 基于 durable child facts、terminal commit state 和 latest request 语义判定 request 是否 retryable。普通 request 只有已经完成 terminal commit 的 latest request 才可 retry；fork child 在尚无 fork 后用户请求和 active runtime work 时，其最新继承 request 也可作为一次 inherited retry 来源。Active、queued、executing 或 terminal-pending latest request MUST NOT 被 retry。Retry MUST NOT 把 user cancel、supersession、pending input 或 edit-resubmit 隐式合并为同一个 control flow。

inherited retry 来源 MUST 同时满足：目标是 child copied prefix 的最新完整轮次；child 尚无 fork 后用户请求；child 没有 active runtime work；copied request 可解析出一个 canonical 用户问题；资格可由 child-owned durable facts证明。任一条件不满足时，Runtime MUST 安全拒绝且不得创建 run 或改变 copied history。

**需求类别**：功能性需求

#### Scenario: Terminal committed latest run 可 retry
- **WHEN** latest agent+owner-scoped request run 是 `COMPLETED`、`FAILED`、`CANCELED` 或 `SUPERSEDED`，且 terminal commit 已稳定完成
- **THEN** Runtime MUST 将该 latest request 视为 retryable
- **AND** Runtime MUST 通过普通 retry acceptance path 创建同一 request 的新 attempt

#### Scenario: 最新继承 request 可首次执行
- **WHEN** fork child 满足 inherited retry 的全部来源条件
- **THEN** Runtime MUST 将 copied request 视为可执行来源
- **AND** MUST 通过 child acceptance path 创建该 request 的首个真实 run

#### Scenario: Active 或 queued latest run 不可 retry
- **WHEN** latest request run 是 `ACCEPTED`、`QUEUED` 或 `EXECUTING`
- **THEN** Runtime MUST 以 safe conflict outcome 拒绝 retry command
- **AND** Runtime MUST NOT 为该 request 创建新 attempt

#### Scenario: Terminal-pending latest run 不可 retry
- **WHEN** latest request run 的 `terminalCommitState` 是 `PENDING` 或 `RETRYING`
- **THEN** Runtime MUST 以 safe terminal-pending outcome 拒绝 retry command
- **AND** Runtime MUST NOT 使用尚未稳定的 terminal result 作为 retry source

#### Scenario: child 独立演进后继承 request 不可 retry
- **WHEN** child 已提交 fork 后用户请求，或目标 inherited request 不再是最新
- **THEN** Runtime MUST 以安全 conflict 或 stale-latest outcome 拒绝
- **AND** MUST NOT 修改 copied history

### Requirement: Retry 创建同一 request 的新 attempt

普通 retry MUST 创建同一个 `requestId` 下的新 `RequestRun` attempt，而不是创建新的 user request。新 attempt MUST durable link 到被 retry 的 previous attempt，并保留 original request identity、trusted owner scope、agent scope 和 execution assembly。Runtime MUST 拥有 attempt numbering 和 lineage。

inherited retry MUST 使用 child copied request 的 `requestId` 创建 attempt `1` 和新的 `runId`，不得创建重复 user message。由于 copied run anchor 不是 previous attempt，首个真实 run MUST NOT 把该 anchor 或 parent run 写入 `retryOfRunId`、`parentRunId` 或其他 runtime lineage。该首个 run MUST 使用 child session 当前可信 Agent binding 所选择的 execution assembly；不得读取 parent run assembly。此 run terminal commit 后，后续 retry MUST 使用普通 attempt `2+` 与 previous-attempt lineage 语义。Inherited attempt `1` MUST NOT 计入“至多 5 次 retry”的次数；其后 accepted attempt `2` 至 `6` 分别计为第 1 至第 5 次 retry。

**需求类别**：功能性需求

#### Scenario: 首次普通 retry 创建 attempt two
- **WHEN** latest terminal request 的当前最高 attempt 是 `1`
- **THEN** Runtime MUST 为相同 `requestId` 创建 attempt `2`
- **AND** 新 `RequestRun` MUST 使用新的 `runId`
- **AND** 新 `RequestRun` MUST 记录 `retryOfRunId` 或等价 previous-attempt durable link
- **AND** Runtime MUST NOT 创建新的 user request message 来伪装 retry

#### Scenario: inherited retry 创建首个 child run
- **WHEN** Runtime 接受最新继承 request 的 inherited retry
- **THEN** Runtime MUST 为 copied `requestId` 创建 attempt `1` 和新的真实 `runId`
- **AND** MUST NOT 创建重复 user message
- **AND** MUST NOT 把 copied run anchor 或 parent run 写入 runtime lineage
- **AND** MUST 使用 child session 当前可信 Agent binding 的 execution assembly

#### Scenario: inherited 首次执行后使用普通 lineage
- **WHEN** inherited retry 的 attempt `1` 已 terminal commit
- **AND** 用户再次 retry 该 child latest request
- **THEN** Runtime MUST 创建 attempt `2`
- **AND** 新 attempt MUST link 到 child attempt `1`

#### Scenario: inherited 首次执行不消耗 retry 配额
- **WHEN** inherited retry 创建 child attempt `1`
- **THEN** 该 attempt MUST NOT 计入至多 5 次 retry 的次数
- **AND** 后续 attempt `2` MUST 计为第 1 次 retry
- **AND** 最高可接受 attempt 仍为 `6`

#### Scenario: 连续普通 retry 指向 previous attempt
- **WHEN** 用户对已经 retry 过的 latest request 再次执行 retry
- **THEN** Runtime MUST 基于当前 latest terminal attempt 创建下一 attempt
- **AND** 新 attempt MUST link 到其直接 previous attempt
- **AND** request lineage MUST 允许追溯 original request 和每个真实 retry attempt

#### Scenario: Retry lineage 是 durable fact
- **WHEN** runtime process restart 后读取 retry request history
- **THEN** gateway facts MUST 仍可恢复每个真实 attempt 的 `requestId`、`runId`、`attempt` 和适用的 previous-attempt link
- **AND** lineage MUST NOT 依赖 process-local memory、frontend state 或 projection cache

#### Scenario: 普通 Retry 保留 original execution assembly
- **WHEN** Runtime 接受普通 retry
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

### Requirement: Inherited retry 保持 child 隔离

Inherited retry MUST 只使用 child-owned copied input、attachment refs、session fork source 和可信 scope 创建 child runtime facts。Runtime MUST NOT 读取、链接或修改 parent run、context、checkpoint、timeline、lane、pending input 或 active-run 状态。source attachments MUST 在 child trusted owner 和 Agent Scope 内重新校验；失败时 MUST NOT 创建 run 或隐藏 copied output。

首个 child run durable accepted/queued 后，Runtime MUST 按既有 retry visibility replacement 语义隐藏 copied source request 的 assistant output 和 capability result messages，保留 canonical 用户问题；显式 hidden-message 读取仍可追溯这些 child copied facts。该 visibility replacement MUST NOT 修改 parent messages。

**需求类别**：系统质量属性

**质量属性**：安全

**适用范围**：该 Function

#### Scenario: inherited retry 不读取 parent runtime
- **WHEN** Runtime 接受 inherited retry
- **THEN** 所有新 runtime facts MUST 写入 child scope
- **AND** parent runtime facts MUST NOT 被读取、链接或修改

#### Scenario: inherited attachment 不可用
- **WHEN** copied input 引用的 attachment 在 child scope 中不可用
- **THEN** Runtime MUST 返回 safe attachment-unavailable outcome
- **AND** MUST NOT 创建 child run 或隐藏 copied output

#### Scenario: inherited retry 接受后替换 copied output
- **WHEN** inherited retry 的首个 child run durable accepted/queued
- **THEN** copied source request 的 assistant output 和 capability result messages MUST 以 retry replacement 语义隐藏
- **AND** copied canonical 用户问题 MUST 保持可见
- **AND** parent messages MUST NOT 改变

### Requirement: Retry 新 run 自动展开实时过程

当 retry command 进入 pending 时，用户界面 MUST 立即停止把被替换 attempt 的 Think、工具步骤或答案展示为当前执行过程。HTTP acceptance 尚未返回真实新 `runId` 时，界面 MUST 展示不包含旧 attempt 内容的既有等待状态。acceptance 前失败时，界面 MUST 恢复原轮次。

HTTP acceptance 或后续权威状态确认新 `runId` 后，用户界面 MUST 将该 `runId` 作为该 request 的当前 attempt。当前轮次的 Think、工具步骤、阶段文字和 canonical assistant answer MUST 只由当前 `runId` 的事实组成；其他 attempt 的过程或答案 MUST NOT 参与当前 attempt 的合并、去重、完成判定或答案抑制。新的 retry run 开始产生实时过程后，用户界面 MUST 将其作为独立的一次执行过程展示并自动展开过程面板，不得沿用被替换 run 的折叠状态。该行为 MUST 同时适用于 inherited attempt `1` 和后续普通 retry attempt，并在 live、会话切换返回和 authoritative history reload 后保持一致。

**需求类别**：功能性需求

#### Scenario: retry 新 run 的实时过程自动展开

- **GIVEN** 被 retry 的轮次过程面板处于折叠状态
- **WHEN** inherited 或普通 retry 的新 run 开始产生实时过程
- **THEN** 用户界面 MUST 将新 run 展示为独立的一次执行过程
- **AND** 新 run 的过程面板 MUST 自动展开
- **AND** MUST NOT 继承被替换 run 的用户折叠状态

#### Scenario: retry pending 不展示旧 attempt 过程

- **GIVEN** 被 retry 的轮次已有可见 Think、工具过程或答案
- **WHEN** retry command 已进入 pending 但 HTTP acceptance 尚未返回新 `runId`
- **THEN** 用户界面 MUST NOT 把旧 attempt 的内容展示为本次 retry 的开头
- **AND** acceptance 前失败时 MUST 恢复原轮次及其过程和答案

#### Scenario: 当前 attempt 的答案不被旧答案抑制

- **GIVEN** 同一 request 的被替换 attempt 已有 canonical assistant answer
- **AND** 新 retry attempt 已确认 `runId`
- **WHEN** 新 attempt 产生 canonical assistant answer
- **THEN** 用户界面 MUST 展示新 attempt 的答案
- **AND** MUST NOT 因被替换 attempt 已有答案而丢弃或隐藏新答案
- **AND** 默认当前轮次 MUST NOT 同时展示被替换 attempt 的答案

#### Scenario: 当前 attempt 不混入旧执行过程

- **GIVEN** 同一 request 的被替换 attempt 已有 Think 和工具步骤
- **AND** 新 retry attempt 已确认 `runId`
- **WHEN** 新 attempt 的实时过程到达或过程历史完成加载
- **THEN** 用户界面 MUST 只把新 `runId` 的过程组成当前执行详情
- **AND** MUST NOT 按相同 request 或相同内容跨 attempt 合并或去重

#### Scenario: authoritative reload 保持当前 attempt

- **GIVEN** retry attempt 已被接受并产生可见过程或答案
- **WHEN** 用户切换会话后返回，或页面重新加载 authoritative history
- **THEN** 用户界面 MUST 继续展示该 request 的当前 attempt
- **AND** live 与 history 对当前 `runId` 的过程和答案 MUST 得出相同默认可见结果

#### Scenario: 已有分享保持冻结结果

- **GIVEN** 用户在 Retry 前已创建会话分享
- **WHEN** 普通会话中的同一 request 完成新的 Retry attempt
- **THEN** 已有分享 MUST 继续展示创建分享时冻结的 attempt
- **AND** Retry 后新建的分享 MUST 展示普通会话当前可见的新 attempt

#### Scenario: fork child Retry 不修改 parent

- **GIVEN** fork child 的最新继承轮次满足 Retry 资格
- **WHEN** 用户在 child 中发起 Retry 且新 child `runId` 被接受
- **THEN** child 当前轮次 MUST 只展示该 child 新 attempt
- **AND** parent session 的过程、答案和已有分享 MUST 保持不变

### Requirement: Inherited retry 可幂等恢复

相同 inherited retry command semantic 与 `idempotencyKey` 的重复调用 MUST 返回首次 accepted child run，MUST NOT 创建第二个 attempt `1`。runtime restart 后，该结果 MUST 从 child durable acceptance facts 恢复；恢复 MUST NOT 依赖 parent facts或 process-local marker。若首次 acceptance 已 durable 但 visibility replacement 未完成，重放 MUST 幂等完成 child copied output replacement。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复

**适用范围**：该 Function

#### Scenario: inherited retry 幂等重放
- **WHEN** 相同 inherited retry command semantic 和 `idempotencyKey` 被重复提交，包括 runtime restart 后重放
- **THEN** Runtime MUST 返回首次 accepted child run
- **AND** MUST NOT 创建第二个 attempt `1`

#### Scenario: 重放补完 visibility replacement
- **WHEN** 首次 inherited retry acceptance 已 durable，但 child copied output replacement 未完成
- **AND** 相同 command 被重放
- **THEN** Runtime MUST 返回首次 accepted child run
- **AND** MUST 幂等完成 child copied output replacement

### Requirement: Retry attempt 次数上限
Runtime MUST 对每个 request 的 retry 次数强制执行固定上限：同一 `requestId` 下最多接受 5 次 retry attempt（原始 attempt 1 加上至多 5 次重试，最高 attempt 为 6）。当 latest request 的当前最高 attempt 已达 6 时，Runtime MUST 在 acceptance 阶段拒绝新的 retry command，且不创建新 attempt。计数 MUST 以 durable `RequestRun.attempt` 为唯一锚点；凡被 accepted 的 retry attempt，无论其终态是 `COMPLETED`、`FAILED`、`CANCELED` 或 `SUPERSEDED`，都计入次数。acceptance 阶段被拒绝的 retry command（幂等重放、stale latest、非 terminal、terminal-pending、超限）MUST NOT 创建 attempt，因此不占次数。上限值是固定常量 5，Runtime MUST NOT 从 client payload、client metadata、model output 或 capability arguments 读取上限或计数。Channel 和 Web 前端 MUST NOT 以本地计数替代 Runtime 的权威限制。

#### Scenario: 第 5 次 retry 被接受
- **WHEN** latest terminal request 的当前最高 attempt 是 `5`，且 retry command 通过既有合法性校验
- **THEN** Runtime MUST 接受该 retry 并创建 attempt `6`
- **AND** 新 attempt MUST 遵循既有 retry lineage、visibility replacement 和排队语义

#### Scenario: 超过 5 次 retry 被拒绝
- **WHEN** latest terminal request 的当前最高 attempt 已达 `6`，Runtime 收到新的 retry command
- **THEN** Runtime MUST 以 category `CONFLICT` 拒绝该 command
- **AND** Runtime MUST 使用稳定错误码 `REQUEST_RETRY_LIMIT_EXCEEDED`
- **AND** Runtime MUST 设置 `retryable=false`
- **AND** Runtime MUST NOT 创建新 attempt、修改 history visibility、隐藏消息、追加 retry timeline event 或触发 scheduler

#### Scenario: 失败的 retry attempt 占次数
- **WHEN** 一个 retry attempt 被 accepted 后以 `FAILED` 终态结束
- **THEN** 该 attempt MUST 计入该 request 的 retry 次数
- **AND** 当当前最高 attempt 因此达到 `6` 时，后续 retry command MUST 以 `REQUEST_RETRY_LIMIT_EXCEEDED` 被拒绝

#### Scenario: 幂等重放不受上限影响
- **WHEN** 一个 retry command 已在超限前被 accepted，client 以相同 `idempotencyKey` 和相同 command semantic 重放该 command
- **THEN** Runtime MUST 返回首次 accepted 的 retry 结果
- **AND** Runtime MUST NOT 因当前 attempt 已达上限而拒绝该幂等重放
- **AND** Runtime MUST NOT 创建新 attempt

#### Scenario: acceptance 拒绝不占次数
- **WHEN** retry command 在 acceptance 阶段被拒绝（包括超限拒绝、stale latest、非 terminal 或 terminal-pending）
- **THEN** Runtime MUST NOT 为该 command 创建 attempt
- **AND** 该 request 的当前最高 attempt MUST 保持不变

#### Scenario: 超限安全错误的 Web 投影
- **WHEN** `POST /api/v1/sessions/:sessionId/retry` 因 attempt 上限被拒绝
- **THEN** Web channel MUST 透传 safe error，包含稳定错误码 `REQUEST_RETRY_LIMIT_EXCEEDED`
- **AND** 该响应 MUST NOT 暴露 raw tenant、subject、storage、SQL、stack trace 或 hidden resource existence
- **AND** agent-web 收到该错误后 MUST 以 message.warning 气泡向用户展示当前系统仅支持最多5次重试的提示

#### Scenario: 超限后 retry 入口的禁用投影
- **WHEN** agent-web 已知当前 latest request 的 attempt 达到上限（实时路径获知 attempt，或收到 `REQUEST_RETRY_LIMIT_EXCEEDED` 错误）
- **THEN** agent-web MUST 禁用当前 latest turn 的 TurnBlock 重试按钮和 Composer 重试按钮
- **AND** 禁用的重试按钮 MUST 呈现禁用视觉态，包括禁用光标 `not-allowed` 和降低透明度
- **AND** 禁用的重试按钮 MUST 在悬浮时通过 Tooltip 展示当前系统仅支持最多5次重试的原因说明
- **AND** `/retry` slash 命令入口无法预先禁用时，MUST 在触发并收到超限错误后展示同一 message.warning 气泡提示
- **AND** 所有 retry 入口 MUST 共享同一权威限制和提示语义，不得形成平行的禁用逻辑
- **AND** agent-web MUST NOT 以禁用状态阻止用户提交新 request 或 edit-resubmit

### Requirement: Agent Web 对可操作的最新轮次暴露 retry 入口

Agent Web MUST 在当前最新轮次存在、会话不处于界面转换状态且 retry 次数未达到既有上限时暴露 TurnBlock 与 Composer retry 入口。`metadata.forkInherited: true` MUST NOT 单独导致 retry 入口禁用或隐藏；最新继承轮次是否可执行 MUST 由 retry 请求的后端权威资格校验决定。较早历史轮次 MUST NOT 获得 latest retry 入口。

**需求类别**：功能性需求

#### Scenario: 最新继承轮次可发起 retry

- **WHEN** 用户打开刚派生、尚无新提问的 child session
- **AND** 最新继承轮次满足 Agent Web 的其他既有 retry 入口条件
- **THEN** TurnBlock 与 Composer retry 入口 MUST 可用
- **AND** 用户触发 retry 时 Agent Web MUST 发起 retry 请求

#### Scenario: provenance 不绕过既有界面限制

- **WHEN** 最新继承轮次的 retry 次数已达到既有上限，或会话正在进行界面转换
- **THEN** Agent Web MUST 按对应既有规则禁用 retry 入口
- **AND** `metadata.forkInherited: true` MUST NOT 覆盖该限制

#### Scenario: 后端拒绝继承轮次 retry

- **WHEN** Agent Web 已发起最新继承轮次 retry
- **AND** 后端因目标已过期、存在 active runtime work、附件不可用、scope 不匹配或 durable fork source 不可用而拒绝
- **THEN** Agent Web MUST 展示既有安全失败结果
- **AND** Agent Web MUST NOT 将 `forkInherited` 当作后端资格判断的替代项
