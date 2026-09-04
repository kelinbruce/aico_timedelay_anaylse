## ADDED Requirements

### Requirement: Local Runtime 启动必须执行 bounded recovery pass
本地单实例 Runtime 启动后，MUST 在 scheduler dispatch 新 work 前执行一次 bounded recovery pass。该 pass MUST 使用 durable `RequestRun`、checkpoint、message、timeline 和 terminal commit facts 作为恢复依据；process-local scheduler queue、execution handle、lane map 或内存 context MUST NOT 被视为恢复事实来源。本 capability 只覆盖 local single-instance restart recovery，MUST NOT 声明 PaaS 多实例 lock/lease、shared worker registry、non-sticky routing 或后台持续恢复轮询能力。

#### Scenario: Recovery 在 startup 时 gate scheduler dispatch
- **WHEN** local Runtime process 启动或重启
- **THEN** Runtime MUST 在接受 scheduler dispatch 新 work 前运行 recovery pass
- **AND** recovery pass MUST 完成 queued、executing 和 terminal-pending durable runs 的分类
- **AND** Runtime MUST NOT 让新 queued work 与未分类的可恢复 work 并行进入 execution path

#### Scenario: Recovery 使用 bounded durable scan
- **WHEN** Runtime 执行 startup recovery
- **THEN** Runtime MUST 使用受限 query 读取属于当前 trusted agent+owner scope 和 local product boundary 的 recoverable runs
- **AND** scan MUST 有明确 batch/window 或等价 bounded strategy
- **AND** Runtime MUST NOT 把无界 history scan、frontend session list 或 projection cache 作为 recovery source

#### Scenario: Local recovery 不声明 PaaS 语义
- **WHEN** 系统运行在本地单实例 product profile 下
- **THEN** recovery MUST NOT 依赖 distributed lease、remote worker registry 或跨实例 consensus
- **AND** spec MUST NOT 把本地 restart recovery 描述成多实例 takeover guarantee

### Requirement: Recoverable run classification 必须使用 durable facts
Runtime MUST 基于 durable `RequestRun.status`、terminal commit state、checkpoint availability、message availability 和 timeline facts 分类可恢复 run。`ACCEPTED`/`QUEUED` run 可恢复为 scheduler work；`EXECUTING` run 可恢复为 active execution takeover；terminal commit `PENDING`/`RETRYING` run 可恢复为 terminal takeover；已稳定 terminal committed 的 run MUST 被跳过。分类 MUST NOT 依赖 process-local execution handle 是否存在。

#### Scenario: Queued run 作为 scheduler work 恢复
- **WHEN** durable `RequestRun` 处于 `ACCEPTED` 或 `QUEUED`
- **THEN** recovery MUST 将该 run 分类为 queued recovery work
- **AND** Runtime MUST 通过 scheduler path 重新建立可执行 work item

#### Scenario: Executing run 作为 active execution takeover 恢复
- **WHEN** durable `RequestRun` 处于 `EXECUTING`
- **THEN** recovery MUST 将该 run 分类为 executing recovery work
- **AND** Runtime MUST 在继续执行前先 claim 或 fence 该 run

#### Scenario: Terminal pending run 作为 terminal takeover 恢复
- **WHEN** durable `RequestRun` 已进入 terminal commit `PENDING` 或 `RETRYING`
- **THEN** recovery MUST 将该 run 分类为 terminal recovery work
- **AND** Runtime MUST 继续或重试 terminal commit boundary，而不是重新调用 Agent、Model 或 Capability

#### Scenario: Terminal committed run 被跳过
- **WHEN** durable `RequestRun` 已经稳定 terminal committed 为 `COMPLETED`、`FAILED`、`CANCELED` 或 `SUPERSEDED`
- **THEN** recovery MUST skip 该 run
- **AND** Runtime MUST NOT 为该 run 创建新的 execution attempt 或 terminal event

### Requirement: Queued recovery 必须从 durable runs 重建 scheduler work
Runtime MUST 从 durable queued/accepted `RequestRun` facts 重建 scheduler work item。Queued recovery MUST NOT inline execute Agent，也不得把 scheduler queue 作为 durable fact。重建后的 work MUST 继续遵守 same-lane scheduling、agent scope、owner scope 和 idempotency constraints。

#### Scenario: Queued recovery 重建 scheduler work item
- **WHEN** recovery 发现 recoverable queued run
- **THEN** Runtime MUST 从 durable run facts 构造 scheduler work item
- **AND** work item MUST 包含 `tenantId`、`subjectId`、`agentId`、`sessionId`、`requestId`、`runId`、`attempt` 和 `agentAssemblyRef`
- **AND** Runtime MUST NOT 从 frontend state 或 in-memory queue 恢复这些坐标

#### Scenario: Queued recovery 不 inline execute
- **WHEN** recovery 重建 queued work
- **THEN** Runtime MUST 把 work 交给 scheduler dispatch path
- **AND** Runtime MUST NOT 在 recovery scan loop 中直接调用 Agent execution

#### Scenario: Accepted pre-queue durable window 如存在则修复
- **WHEN** recovery 发现 `ACCEPTED` run 已 durable created 但尚未进入 queued/scheduler-visible state
- **THEN** Runtime MUST 把该 run 转入 safe queued recovery path 或 terminalize as recovery failed
- **AND** Runtime MUST NOT 让该 run 永久停留在不可见 accepted state

### Requirement: Executing recovery 必须先 claim 再继续
Runtime MUST 在继续执行 `EXECUTING` run 前，通过 durable claim、version fence 或等价 single-owner guard 确认本地 Runtime 拥有该 recovered run。Claim 失败 MUST NOT 导致重复执行。Local single-instance recovery MAY 使用本地 process epoch 或 version CAS，但不得声明跨实例 lease guarantee。

#### Scenario: Executing recovery claim 该 run
- **WHEN** recovery 发现 executing run
- **THEN** Runtime MUST 在恢复执行前执行 durable claim 或 version fence
- **AND** claim/fence MUST 绑定 trusted agent+owner scope、session、request、run 和 expected version
- **AND** 成功后 Runtime MAY 继续恢复该 run 的执行点

#### Scenario: Claim conflict 不重复执行
- **WHEN** executing recovery claim/fence 失败
- **THEN** Runtime MUST NOT 继续执行该 run
- **AND** Runtime MUST 返回或记录 safe recovery conflict outcome
- **AND** Runtime MUST NOT 发布 duplicate model/capability invocation 或 terminal event

### Requirement: Executing recovery 必须从 checkpoint 和 messages 重建 RequestContext
Runtime MUST 从 durable checkpoint、persisted messages、active context view、timeline facts 和 `RequestRun` metadata 重建 recovered `RequestContext`。Recovery MUST NOT 使用 stale process-local `RequestContext`、frontend transcript 或 model output buffer。缺少必要 durable facts 时，Runtime MUST fail closed。

#### Scenario: Recovery 从 persisted messages 重建 context
- **WHEN** recovery 继续 executing run
- **THEN** Runtime MUST 按 `sessionId`、`requestId`、`runId` 和 trusted scope 读取 persisted messages
- **AND** Runtime MUST 使用 active context view 或 durable context facts 选择 model-visible history
- **AND** Runtime MUST NOT 使用 frontend-rendered conversation 作为 recovered model context

#### Scenario: Checkpoint 约束 recovered execution
- **WHEN** durable checkpoint 存在
- **THEN** recovery MUST 使用 checkpoint 的 run/version/sequence/trigger/lifecycle stage 约束恢复点
- **AND** Runtime MUST 验证 checkpoint 与 `RequestRun`、timeline 和 message facts 一致
- **AND** 不一致 MUST 进入 safe recovery failure path

#### Scenario: Pending tool 需要 durable checkpoint
- **WHEN** executing recovery 需要恢复到 pending tool/capability boundary
- **THEN** Runtime MUST 依赖 durable checkpoint 和 assistant tool-use/capability-result messages 重建 pending tool state
- **AND** Runtime MUST NOT 仅凭模型输出 buffer 或 process-local tool state 重放 tool
- **AND** pending tool replay safety MUST 委托 runtime-recovery-idempotency-guard capability 的规则

### Requirement: Recovery 只能通过已定义 lifecycle stages 继续
Runtime recovery MUST 只从明确的 recoverable lifecycle stages 继续：`BEFORE_MODEL_INVOKE`、`BEFORE_CAPABILITY_INVOKE` 和 `BEFORE_TERMINAL_EVENT`。未知 stage、过期 stage 或无法校验的 stage MUST fail closed。Recovery MUST NOT 从任意实现内部 stack frame、stream chunk offset 或 adapter-private cursor 继续。

#### Scenario: Before model invoke 可以 replay model computation
- **WHEN** checkpoint 表明 next lifecycle stage 是 `BEFORE_MODEL_INVOKE`
- **THEN** Runtime MAY 重新组装 model input 并重新调用 model boundary
- **AND** Runtime MUST 保持 request/run/agent/owner coordinates 与 original accepted run 一致

#### Scenario: Before capability invoke 委托 pending tool safety
- **WHEN** checkpoint 表明 next lifecycle stage 是 `BEFORE_CAPABILITY_INVOKE`
- **THEN** Runtime MUST 先按 runtime-recovery-idempotency-guard 判定 pending capability replay 是否安全
- **AND** Runtime MUST NOT 在缺少 replay eligibility decision 时调用 capability

#### Scenario: Before terminal event 进入 terminal commit boundary
- **WHEN** checkpoint 表明 next lifecycle stage 是 `BEFORE_TERMINAL_EVENT`
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
