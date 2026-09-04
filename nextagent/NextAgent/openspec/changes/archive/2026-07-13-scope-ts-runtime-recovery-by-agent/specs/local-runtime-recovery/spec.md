## MODIFIED Requirements

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
