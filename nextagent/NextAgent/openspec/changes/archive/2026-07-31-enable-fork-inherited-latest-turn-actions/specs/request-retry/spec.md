## Function

- **所属 Function**：`FN-2.3 重试请求`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

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

## ADDED Requirements

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

当 retry command 进入 pending 时，用户界面 MUST 立即停止把被替换 attempt 的 think、工具步骤或答案展示为当前执行过程。HTTP acceptance 尚未返回真实新 `runId` 时，界面 MAY 展示无旧过程内容的待接管状态；acceptance 前失败时 MUST 恢复原轮次。新的 retry run 开始产生实时过程后，用户界面 MUST 将其作为独立的一次执行过程展示并自动展开过程面板，不得沿用被替换 run 的折叠状态。该行为 MUST 同时适用于 inherited attempt `1` 和后续普通 retry attempt。

**需求类别**：功能性需求

#### Scenario: retry 新 run 的实时过程自动展开
- **GIVEN** 被 retry 的轮次过程面板处于折叠状态
- **WHEN** inherited 或普通 retry 的新 run 开始产生实时过程
- **THEN** 用户界面 MUST 将新 run 展示为独立的一次执行过程
- **AND** 新 run 的过程面板 MUST 自动展开
- **AND** MUST NOT 继承被替换 run 的用户折叠状态

#### Scenario: retry pending 不展示旧 attempt 过程
- **GIVEN** 被 retry 的轮次已有可见 think 或工具过程
- **WHEN** retry command 已进入 pending 但 HTTP acceptance 尚未返回新 `runId`
- **THEN** 用户界面 MUST NOT 把旧 attempt 的过程展示为本次 retry 的开头
- **AND** acceptance 前失败时 MUST 恢复原轮次及其过程

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

## Function 变更汇总

### 前置条件

- **变更类型**：修改
- **目标内容**：除普通 terminal committed latest request 外，尚未独立演进且无 active work 的 fork child 最新继承 request 也可作为 retry 来源。
- **依据 Requirements**：`Retryable request 状态分类`

### 处理过程

- **变更类型**：修改
- **目标内容**：普通 retry 延续 attempt lineage；inherited retry 从 child copied request 创建首个真实 attempt，重新校验 child 资源并保持 parent runtime 隔离和幂等。
- **依据 Requirements**：`Retry 创建同一 request 的新 attempt`、`Inherited retry 保持 child 隔离`、`Inherited retry 可幂等恢复`

### 结果

- **变更类型**：修改
- **目标内容**：成功的 inherited retry 形成可按普通 lifecycle 管理的 child attempt `1`，新 run 的实时过程自动展开；失败或重复调用不产生额外运行或 copied history 副作用。
- **依据 Requirements**：`Retryable request 状态分类`、`Retry 创建同一 request 的新 attempt`、`Inherited retry 保持 child 隔离`、`Retry 新 run 自动展开实时过程`、`Inherited retry 可幂等恢复`
