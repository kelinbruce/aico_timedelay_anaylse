# local-runtime-recovery Specification

## Purpose
定义本地单实例 Runtime 在进程重启后的 bounded recovery 行为：启动时必须基于 durable facts 恢复 queued、executing 和 terminal-pending run，重建必要执行坐标，并在无法安全恢复时走 recovery-failed terminal path，同时不声明 PaaS 多实例 lease 或后台持续恢复能力。
## Function

- **所属 Function**：`FN-11.1 恢复运行状态`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: Local Runtime 启动必须执行 bounded recovery pass

每个 Agent-bound Runtime 启动后 MUST 在 scheduler dispatch 新 work 前执行一次 bounded recovery pass。该 pass MUST 使用由可信 app composition 确定的当前 `agentId` 发现候选，并使用 durable `RequestRun`、checkpoint、message、timeline 和 terminal commit facts 作为恢复依据；process-local scheduler queue、execution handle、lane map 或内存 context MUST NOT 被视为恢复事实来源。

Recovery discovery MUST 只扫描当前应用绑定 Agent 下的 runs，同时覆盖该 Agent 下所有 tenant/subject owner scopes。`agentId` MUST NOT 来自 Web request、client metadata、model output 或 capability parameters。同一 Agent 存在多个实例时，只有取得 durable claim lease 的实例可以恢复会重新执行的 run；本 capability 不声明 distributed consensus、shared worker registry 或 non-sticky routing。

#### Scenario: Recovery 在 startup 时 gate scheduler dispatch

- **WHEN** Agent-bound Runtime process 启动或重启
- **THEN** Runtime MUST 在 scheduler dispatch 新 work 前运行 recovery pass
- **AND** recovery pass MUST 完成当前可信 Agent 下 queued、executing 和 terminal-pending durable runs 的分类
- **AND** Runtime MUST NOT 让新 queued work 与尚未 claim/classify 的 recoverable work 并行进入 execution path

#### Scenario: Recovery 使用 Agent-scoped bounded durable scan

- **WHEN** Runtime 执行 startup recovery
- **THEN** Runtime MUST 使用可信 app composition 确定的 `agentId` 和有限 `limit` 查询 recoverable runs
- **AND** Runtime MUST NOT 查询或恢复其他 Agent 的 run
- **AND** Runtime MUST NOT 把无界 history scan、frontend session list 或 projection cache 作为 recovery source

#### Scenario: Recovery Agent Scope 不可由客户端覆盖

- **WHEN** 任意 Web request、client metadata、model output 或 capability argument 包含不同 `agentId`
- **THEN** recovery discovery MUST 继续使用 app composition 绑定的 `agentId`
- **AND** 不可信值 MUST NOT 改变 discovery 或 claim scope

### Requirement: Recoverable run classification 必须使用 durable facts

Runtime MUST 基于 durable `RequestRun.status`、terminal commit state、claim lease、checkpoint availability、message availability 和 timeline facts 分类当前 Agent 的 recoverable run。`ACCEPTED`、`QUEUED`、`PLANNING` run 可恢复为 scheduler work；`EXECUTING` run 可恢复为 active execution takeover；terminal commit `PENDING`/`RETRYING` run 可恢复为 terminal takeover；已稳定 terminal committed 的 run MUST 被跳过。分类 MUST NOT 依赖 process-local execution handle 是否存在。

所有会重新进入 scheduler/execution path 的 `ACCEPTED`、`QUEUED`、`PLANNING`、`EXECUTING` run MUST 在重建或继续执行前取得 scoped durable claim。Claim 失败的实例 MUST skip 该 run，且 MUST NOT enqueue、invoke Agent/Model/Capability 或产生 terminal side effect。

#### Scenario: Queued and planning runs require claim

- **WHEN** durable `RequestRun` 处于 `ACCEPTED`、`QUEUED` 或 `PLANNING`
- **THEN** recovery MUST 在构造 scheduler work item 前 claim 该 run
- **AND** 只有 claim 成功的实例 SHALL 通过 scheduler path 重建 work item

#### Scenario: Executing run requires claim

- **WHEN** durable `RequestRun` 处于 `EXECUTING`
- **THEN** recovery MUST 在继续执行前 claim 该 run
- **AND** claim conflict MUST NOT 导致重复执行

#### Scenario: Terminal pending run uses idempotent terminal takeover

- **WHEN** durable `RequestRun` 已进入 terminal commit `PENDING` 或 `RETRYING`
- **THEN** recovery MUST 继续或重试 terminal commit boundary
- **AND** Runtime MUST NOT 重新调用 Agent、Model 或 Capability

#### Scenario: Terminal committed run is skipped

- **WHEN** durable `RequestRun` 已稳定 terminal committed
- **THEN** recovery MUST skip 该 run
- **AND** Runtime MUST NOT 创建新的 execution attempt 或 terminal event

### Requirement: Queued recovery 必须从 durable runs 重建 scheduler work

Runtime MUST 从 durable `ACCEPTED`、`QUEUED` 或 `PLANNING` RequestRun facts 重建 scheduler work item。Runtime MUST 在重建前使用记录中的 `tenantId`、`subjectId`、`agentId`、`runId` 和 `expectedVersion` 取得 durable claim lease。Queued recovery MUST NOT inline execute Agent，也不得把 scheduler queue 作为 durable fact。重建后的 work MUST 继续遵守 same-lane scheduling、Agent Scope、Owner Scope 和 idempotency constraints。

#### Scenario: Claim success permits queued rebuild

- **WHEN** recovery 发现 recoverable queued run 且 scoped claim 返回 `UPDATED`
- **THEN** Runtime MUST 使用 claim 返回的最新 `RequestRunRecord` 构造 scheduler work item
- **AND** work item MUST 保留 `tenantId`、`subjectId`、`agentId`、`sessionId`、`requestId`、`runId`、`attempt` 和 `agentAssemblyRef`
- **AND** Runtime MUST 把 work 交给 scheduler dispatch path，而不是在 scan loop 中 inline execute

#### Scenario: Claim conflict prevents duplicate queued rebuild

- **WHEN** 两个同 Agent 实例同时发现同一个 queued run
- **AND** 只有一个实例的 scoped claim 返回 `UPDATED`
- **THEN** 只有 claim 成功的实例 SHALL enqueue recovered work
- **AND** claim 返回 `VERSION_CONFLICT` 或 `NOT_FOUND` 的实例 MUST skip，且 MUST NOT enqueue 或 execute 该 run

#### Scenario: Accepted pre-queue durable window is repaired under claim

- **WHEN** recovery 发现 `ACCEPTED` run 已 durable created 但尚未进入 queued/scheduler-visible state
- **THEN** Runtime MUST 先 claim 该 run，再把它转入 safe queued recovery path 或 terminalize as recovery failed
- **AND** Runtime MUST NOT 让该 run 永久停留在不可见 accepted state

### Requirement: Executing recovery 必须先 claim 再继续

Runtime MUST 在继续执行 `EXECUTING` run 前，通过绑定完整 Agent Scope、Owner Scope、run coordinate、expected version 和 lease expiry 的 durable claim 确认当前实例拥有该 run。Claim 失败 MUST NOT 导致重复执行。有效 lease 未过期时其他实例 MUST NOT 接管；lease 到期后其他同 Agent 实例 MAY 使用最新 version 重新 claim。

#### Scenario: Executing recovery claims with full scope

- **WHEN** recovery 发现当前 Agent 的 executing run
- **THEN** Runtime MUST 使用持久化记录中的 `tenantId`、`subjectId`、`agentId`、`runId` 和 `expectedVersion` claim
- **AND** 成功后 Runtime MAY 继续恢复该 run 的执行点

#### Scenario: Active lease prevents takeover

- **WHEN** executing run 的 durable claim lease 尚未到期
- **THEN** 其他实例 MUST NOT claim 或继续执行该 run

#### Scenario: Expired lease permits same-agent takeover

- **WHEN** executing run 的 durable claim lease 已到期
- **THEN** 另一个承载相同 Agent 的实例 MAY 通过最新 version CAS claim 该 run
- **AND** claim 成功前 MUST NOT 恢复执行

#### Scenario: Claim conflict does not duplicate execution

- **WHEN** executing recovery claim 返回 `VERSION_CONFLICT` 或 `NOT_FOUND`
- **THEN** Runtime MUST NOT 继续执行该 run
- **AND** Runtime MUST NOT 发布 duplicate model/capability invocation 或 terminal event

### Requirement: Executing recovery 必须从 checkpoint 和 messages 重建 RequestContext

Runtime MUST 从 durable checkpoint、persisted messages、active context view、timeline facts 和 `RequestRun` metadata 重建 recovered `RequestContext`。Recovery MUST NOT 使用 stale process-local `RequestContext`、frontend transcript 或 model output buffer。checkpoint 与 recovered `RequestContext` MUST 携带相同的 `agentTurnIndex`，用于恢复同一 logical Agent turn；缺少必要 durable facts 时，Runtime MUST fail closed。

**需求类别**：功能性需求

#### Scenario: Recovery 从 persisted messages 重建 context

- **WHEN** recovery 继续 executing run
- **THEN** Runtime MUST 按 `sessionId`、`requestId`、`runId` 和 trusted scope 读取 persisted messages
- **AND** Runtime MUST 使用 active context view 或 durable context facts 选择 model-visible history
- **AND** Runtime MUST NOT 使用 frontend-rendered conversation 作为 recovered model context

#### Scenario: RequestContext 携带最小 Agent turn 恢复坐标

- **WHEN** Runtime 构造新接受或恢复执行的 `RequestContext`
- **THEN** `RequestContext` MUST 包含 session、`requestId`、run、identity、locale、agent id/version、assembly ref、next lifecycle stage、tool batch state、flow variables 和 `agentTurnIndex`
- **AND** 新接受的 run MUST 使用 `agentTurnIndex=0`
- **AND** recovered `RequestContext.agentTurnIndex` MUST 等于已校验 checkpoint 中的值
- **AND** `RequestContext` MUST NOT 包含 `attempt`、`deadlineAt` 或 `messageRefs`

#### Scenario: 当前 request 消息通过专用查询读取

- **WHEN** Runtime 为同一 request/run 重建 current-run message、Tool use 或 Capability result state
- **THEN** Runtime MUST 调用 `SessionMessageStoreGateway.listCurrentRequestMessages(CurrentRequestConversationRecordQuery)`
- **AND** query MUST 携带 trusted owner scope、Agent Scope、`sessionId`、`rootMessageId` 和 `runId`
- **AND** query result MUST 排除其他 request、run、owner 或 Agent 的 messages
- **AND** current-run Tool state reconstruction MUST NOT 重新解析 raw model output

#### Scenario: Checkpoint 约束 recovered execution

- **WHEN** durable checkpoint 存在
- **THEN** recovery MUST 使用 checkpoint 的 run/version/sequence/trigger/lifecycle stage 和 Agent turn coordinate 约束恢复点
- **AND** Runtime MUST 验证 checkpoint 与 `RequestRun`、timeline 和 message facts 一致
- **AND** 不一致 MUST 进入 safe recovery failure path

#### Scenario: Pending tool 需要 durable checkpoint

- **WHEN** executing recovery 需要恢复到 pending tool/capability boundary
- **THEN** Runtime MUST 依赖 durable checkpoint 和 assistant tool-use/capability-result messages 重建 pending tool state
- **AND** Runtime MUST NOT 仅凭模型输出 buffer 或 process-local tool state 重放 tool
- **AND** pending tool replay safety MUST 委托 runtime-recovery-idempotency-guard capability 的规则

#### Scenario: Recovery 保持 logical Agent turn 坐标

- **GIVEN** executing run 已开始一个普通 logical Agent turn 或已进入 finalizing turn
- **WHEN** Runtime 从 durable checkpoint 恢复该 run
- **THEN** recovered `RequestContext.agentTurnIndex` 和 execution MUST 复用 checkpoint 中同一个 `agentTurnIndex`
- **AND** MUST NOT 因 recovery 增加普通 turn 计数
- **AND** `agentTurnIndex=maxTurns` MUST 继续表示唯一 finalizing turn，MUST NOT 恢复为普通 turn 或开始第二个 finalizing turn

### Requirement: Recovery 只能通过已定义 lifecycle stages 继续
Runtime recovery MUST 只从明确的 recoverable lifecycle stages 继续：`BEFORE_MODEL_INVOKE`、`BEFORE_CAPABILITY_INVOKE` 和 `BEFORE_AGENT_TERMINAL`。未知 stage、过期 stage 或无法校验的 stage MUST fail closed。Recovery MUST NOT 从任意实现内部 stack frame、stream chunk offset 或 adapter-private cursor 继续。

#### Scenario: Before model invoke 可以 replay model computation
- **WHEN** checkpoint 表明 next lifecycle stage 是 `BEFORE_MODEL_INVOKE`
- **THEN** Runtime MAY 重新组装 model input 并重新调用 model boundary
- **AND** Runtime MUST 保持 request/run/agent/owner coordinates 与 original accepted run 一致

#### Scenario: Before capability invoke 委托 pending tool safety
- **WHEN** checkpoint 表明 next lifecycle stage 是 `BEFORE_CAPABILITY_INVOKE`
- **THEN** Runtime MUST 先按 runtime-recovery-idempotency-guard 判定 pending capability replay 是否安全
- **AND** Runtime MUST NOT 在缺少 replay eligibility decision 时调用 capability

#### Scenario: Before terminal event 进入 terminal commit boundary
- **WHEN** checkpoint 表明 next lifecycle stage 是 `BEFORE_AGENT_TERMINAL`
- **THEN** Runtime MUST 进入 terminal commit recovery path
- **AND** Runtime MUST NOT 重新调用 Agent、Model 或 Capability 来重做已经完成的执行阶段

### Requirement: Terminal recovery 必须幂等
Terminal recovery MUST 通过 existing terminal commit idempotency、CAS/version fence 或 equivalent durable guard 保证同一 run 只产生一个 terminal lifecycle event。Recovery MUST 能处理 terminal facts 部分写入、timeline event 已写但 run state 未稳定、或 run state 已 terminal 但 projection 未完成等情况。

#### Scenario: Pending terminal commit 被幂等重试
- **WHEN** recovery 发现 terminal commit state 是 `PENDING` 或 `RETRYING`
- **THEN** Runtime MUST 以相同 terminal semantic 和 idempotency metadata 重试 terminal commit
- **AND** Runtime MUST NOT 创建不同 terminal status 或第二个 terminal event

#### Scenario: Partial terminal facts 对齐 run state
- **WHEN** recovery 发现 run state、timeline event 或 terminal metadata 之间存在 partial terminal write
- **THEN** Runtime MUST reconcile 到一个 committed/idempotent terminal outcome 或 safe recovery failure
- **AND** Runtime MUST NOT 向 client 暴露 partial terminal completion

### Requirement: Recovery 必须保留 assembly 和 owner boundaries
Recovery MUST 使用 accepted run 中已经持久化的 `agentId`、`agentVersion`、`agentAssemblyRef`、tenant/subject owner scope 和 session/request/run coordinates。Recovery MUST NOT 重新按当前默认 Agent、当前客户端 payload、model output、capability arguments 或 global config 选择 execution path。

#### Scenario: Persisted assembly 是必需的
- **WHEN** recovery 继续 queued 或 executing run
- **THEN** Runtime MUST 从 durable run facts 读取 `agentId`、`agentVersion` 和 `agentAssemblyRef`
- **AND** Runtime MUST 使用该 assembly ref 恢复 execution profile
- **AND** Runtime MUST NOT 使用当前默认 Agent 替代 missing assembly

#### Scenario: Missing assembly 安全失败
- **WHEN** required persisted assembly ref 缺失或无法解析
- **THEN** recovery MUST terminalize 或记录 safe recovery failed outcome
- **AND** recovery MUST NOT 选择另一个 assembly 猜测执行

#### Scenario: Owner scope 不来自不可信输入
- **WHEN** recovery 重建 run execution context
- **THEN** owner scope MUST 来自 durable trusted facts 或 channel/auth boundary 固化的 identity facts
- **AND** recovery MUST NOT 使用 client payload、query、headers、model output 或 capability parameters 覆盖 tenant/subject

#### Scenario: Recovery gateway facts 保留 agent scope
- **WHEN** recovery 查询 RequestRun、checkpoint、message、timeline 或 terminal facts
- **THEN** gateway query MUST include trusted `agentId` and owner scope
- **AND** 不同 tenant、subject、agent 或 session 的 facts MUST NOT 被返回

### Requirement: Unsafe recovery 必须 terminalize 为 recovery failed
当 recovery 无法安全继续 queued、executing 或 terminal-pending run 时，Runtime MUST fail closed，并通过 safe recovery failed terminal path 或 equivalent durable failure fact 结束该 run。Unsafe recovery MUST NOT silently drop work、mark success、replay non-idempotent capabilities 或暴露 raw diagnostic detail。

#### Scenario: 缺少 messages 导致 recovery 失败
- **WHEN** recovery 需要 persisted messages 重建 context，但 required messages 缺失
- **THEN** Runtime MUST terminalize 或记录 recovery failed outcome
- **AND** Runtime MUST NOT 用空 context 或 frontend transcript 继续执行

#### Scenario: 不一致 facts fail closed
- **WHEN** checkpoint、RequestRun、timeline 或 message facts 互相矛盾，且无法 reconcile
- **THEN** Runtime MUST fail closed
- **AND** Runtime MUST NOT 继续 model/capability invocation

#### Scenario: Recovery failed 等待 terminal commit
- **WHEN** recovery failed outcome 需要 client-visible terminal state
- **THEN** Runtime MUST 使用 terminal commit boundary 写入 durable failed/recovery-failed fact
- **AND** Runtime MUST NOT 在 terminal commit 成功前发布 committed terminal stream event

#### Scenario: Recovery failure 不是 cancellation
- **WHEN** run 因 unsafe recovery 被 terminalized
- **THEN** terminal outcome MUST 表达 recovery failure 或 safe failed status
- **AND** Runtime MUST NOT 将其伪装为 user cancel 或 supersession

### Requirement: Recovery diagnostics 必须安全且可追溯
Runtime recovery MUST 为 startup recovery scan、classification、claim、resume、terminal retry 和 recovery failure 输出安全 operational diagnostics。Diagnostics MUST 支持定位 run/session/agent/owner safe coordinates 和 recovery outcome，但 MUST NOT 包含 prompt、model output、stream delta、tool arguments、attachment content、raw provider error、raw SQL、filesystem path、credential、token 或 stack trace。

#### Scenario: Recovery 记录安全 operational outcome
- **WHEN** recovery 分类、claim、resume 或 fail closed
- **THEN** Runtime MUST 在已配置时 emit safe structured log、metric 或 audit signal
- **AND** diagnostic MUST include stable recovery outcome code 和 low-cardinality stage/kind
- **AND** diagnostic MUST NOT include sensitive content or high-cardinality raw payload

#### Scenario: Recovery 不新增 client vocabulary
- **WHEN** recovery exposes user-visible stream/history state
- **THEN** recovery MUST 使用 existing safe error 和 terminal outcome vocabulary
- **AND** local recovery MUST NOT 将 transport-specific 或 frontend-only state names 引入为 runtime facts

### Requirement: 检查点记录最小 Agent turn 恢复坐标

Runtime 保存的 checkpoint payload MUST 包含 `checkpointId`、`sessionId`、`requestId`、`runId`、`requestContextId`、`runVersion`、`triggerReason`、`lastSequence`、`activeContextVersion`、`flowVariables`、`agentTurnIndex` 和 `savedAt`。保存时的 `RequestContext.agentTurnIndex` MUST 原样写入 checkpoint。`agentTurnIndex` MUST 为非负安全整数，并 MUST 不大于 accepted assembly 的 effective `maxTurns`；`0..maxTurns-1` 表示普通 logical turns，`maxTurns` 表示唯一 finalizing turn。checkpoint write MUST 包含 `idempotencyKey`，并 MUST 使用 `sessionId`、`requestId` 和 `runId` 作为 run-level lookup anchor。

`triggerReason` MUST 使用 canonical closed vocabulary。checkpoint MUST NOT 持久化完整 tool call state 或 message refs；recovery MUST 使用 checkpoint 的 run version、trigger、sequence、active context version 和 Agent turn coordinate 校验恢复点，再从相同 scope 的持久化 messages 重建 pending Tool state。

`agentTurnIndex` 只标识 logical Agent turn，MUST NOT 替代 `nextLifecycleStage`、`currentToolBatchMessageId` 或 `toolCallStates`。恢复到 `BEFORE_CAPABILITY_INVOKE` 时，Runtime MUST 按 canonical pending Tool replay guard 继续该 turn，MUST NOT 因读取同一个 `agentTurnIndex` 重新调用已完成的 model boundary。

**需求类别**：功能性需求

#### Scenario: 模型调用前保存 Agent turn 坐标

- **WHEN** Runtime 保存允许 model invocation 开始的 checkpoint
- **THEN** checkpoint MUST 记录本次 logical turn 的 `agentTurnIndex`
- **AND** provider retry 或 recovery replay MUST 复用同一个 coordinate
- **AND** 开始下一 logical turn 前 MUST 先产生下一 coordinate 对应的 durable checkpoint

#### Scenario: Turn checkpoint 幂等键不阻止坐标推进

- **GIVEN** 同一个 run version 会保存多个 `STEP_STARTED` checkpoint
- **WHEN** logical Agent turn 从 index `n` 推进到 `n+1`
- **THEN** checkpoint write idempotency semantic MUST 区分两个 `agentTurnIndex`
- **AND** 重放同一个 run、trigger、run version 和 `agentTurnIndex` 的 save MUST 返回首次结果且不得重复 side effect
- **AND** 下一 turn 的 save MUST 产生包含 `n+1` 的新 checkpoint，不得错误返回 index `n` 的锚点事实

#### Scenario: Checkpoint 使用 run-level lookup anchor

- **WHEN** Runtime 加载 checkpoint 用于恢复
- **THEN** lookup request MUST 包含 `sessionId`、`requestId` 和 `runId`
- **AND** `runId` MUST NOT 为 optional
- **AND** gateway MUST NOT 使用 latest-checkpoint lookup semantics 代替 run-level anchor
