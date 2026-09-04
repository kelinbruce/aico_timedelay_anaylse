## ADDED Requirements

### Requirement: Task trajectory persistence after terminal commit

系统 SHALL 在请求 terminal commit 成功后，为可归纳为任务执行的请求构建 owner/agent scoped `TaskTrajectoryRecord`。轨迹构建 MUST 发生在 terminal commit 关键路径之外；首版实现 MUST 复用 runtime 已有 `runTimelineEventListeners` 监听 `persistence="PERSISTED"` 的 terminal timeline event 作为快速触发路径，并只允许产生轻量 build intent / pending signal，完整 projection MUST 由后台 worker 限流执行。listener failure、intent failure 或构建失败不得改变 `RequestRun` terminal state、`SessionMessage`、canonical timeline、active context 或 stream projection；同时 local backend MUST 提供 bounded catch-up / reconciliation 路径：后台 worker MUST 周期性通过 public gateway query 扫描已 terminal commit、同 scope 下尚无 trajectory 的最小 run/event refs，并使用 `saveTaskTrajectory` 的 scoped idempotency 补建或安全跳过。

轨迹只允许从已持久化、已提交、当前 owner/agent scope 可见的 session、request run、message、timeline event、timeline/session 中已有的 safe tool invocation projection 和 artifact/content reference 安全投影构建。轨迹不得依赖独立 tool result gateway，除非后续 owning change 明确定义该 public gateway contract；不得包含 raw prompt、raw model output、stream delta、raw provider error、credential、token、本地路径、附件原文或不可授权内容。

#### Scenario: Trajectory is built after successful terminal commit
- **WHEN** request run `R1` 在 `tenantId=T1, subjectId=U1, agentId=A1, sessionId=S1` 下 terminal commit 成功
- **THEN** app composition MUST 通过 `runTimelineEventListeners` 观察已持久化 terminal timeline event，并在 terminal commit 之后异步记录 scoped trajectory build intent 或 pending signal
- **AND** 后台 worker MUST 在 terminal commit 关键路径之外尝试构建 `TaskTrajectoryRecord`
- **AND** `TaskTrajectoryRecord` MUST 携带 `tenantId=T1, subjectId=U1, agentId=A1, sessionId=S1, requestRunId=R1`
- **AND** 用户可见 terminal message 和 stream terminal event MUST 不等待轨迹构建完成

#### Scenario: Missed build intent is reconciled from committed facts
- **WHEN** request run `R1` 的 terminal commit fact 已经持久化
- **AND** task trajectory listener 抛错、进程在 pending signal 记录前崩溃，或 pending signal 丢失
- **THEN** catch-up worker MUST 通过 public gateway query 在 bounded batch/window 内发现 `R1` 的 committed terminal refs
- **AND** 当同 scope 下不存在 `R1` 对应的 `TaskTrajectoryRecord` 时，系统 MUST 重新入队或直接执行后台 builder，并通过 `saveTaskTrajectory` 幂等写入
- **AND** catch-up query 和诊断 MUST 只返回最小 scoped refs、状态和游标，不得返回 raw conversation、raw tool output、路径或 credential
- **AND** 缺失 intent 的补建不得改变 `RequestRun` terminal state、session history、canonical timeline 或 stream projection

#### Scenario: Trajectory build failure does not affect request result
- **WHEN** request run 已经 terminal commit 成功
- **AND** task trajectory builder 因 storage unavailable 或 invalid projection 失败
- **THEN** `RequestRun` terminal state、session history、canonical timeline 和 stream projection MUST 保持已提交结果
- **AND** 系统 MUST 产生安全诊断，不得暴露 raw prompt、模型输出、路径或 credential

### Requirement: Task trajectory record content boundary

`TaskTrajectoryRecord` SHALL 表达任务轨迹的安全结构化摘要，而不是完整会话转储。轨迹内容 MUST 至少支持任务目标、输入约束、关键观察、动作序列、结果摘要、失败/阻塞原因、安全 source refs、低基数 task kind、trajectory build status、task outcome status 和 outcome evidence level。轨迹字段必须可追溯到 session/run/message/timeline/tool/content refs，但不得复制原始消息全文。

轨迹摘要只能来自已提交事实的安全投影，包括 `RequestRun` terminal facts、visible committed message safe projection、canonical timeline events、tool invocation result safe summary、artifact/content reference metadata、runtime safe error 或 diagnostic code。轨迹不得为了补全摘要重新读取 raw conversation 或 raw tool output。

#### Scenario: Raw conversation content is not persisted in trajectory
- **WHEN** builder 从已提交消息和工具结果构建 `TaskTrajectoryRecord`
- **THEN** trajectory MAY 保存安全摘要、低基数标签、工具名、动作类型、结果状态和 source refs
- **AND** trajectory MUST NOT 保存 raw user message、raw assistant message、raw tool output、raw attachment content 或 raw provider error

### Requirement: Task outcome is evidence-based

系统 SHALL 区分轨迹构建状态和业务结果状态。`trajectoryBuildStatus` 只表达轨迹 projection 是否成功；`taskOutcomeStatus` 只表达当次请求在当时可见证据下的业务结果判断。terminal commit 成功 MUST NOT 被等同为业务成功。证据不足时 MUST 使用 `taskOutcomeStatus=UNKNOWN` 和 `outcomeEvidenceLevel=NONE` 或 `MODEL_CLAIM`。

允许的 `taskOutcomeStatus` 为 `SUCCEEDED`、`FAILED`、`PARTIAL`、`UNKNOWN`、`CANCELLED`。允许的 `outcomeEvidenceLevel` 为 `NONE`、`MODEL_CLAIM`、`TOOL_STATUS`、`VERIFICATION`、`USER_CONFIRMATION`。`SUCCEEDED` SHOULD require task-kind-specific evidence：例如配置变更需要 apply + verify 成功，排障需要根因定位或恢复验证，planning/explanation 任务需要目标内容已产出，用户确认可作为强证据。

#### Scenario: Terminal commit completed is not business success
- **WHEN** request run terminal commit 成功
- **AND** 没有工具验证、用户确认或 task-kind-specific completion evidence
- **THEN** `TaskTrajectoryRecord.taskOutcomeStatus` MUST be `UNKNOWN`
- **AND** `outcomeEvidenceLevel` MUST NOT be stronger than `MODEL_CLAIM`

#### Scenario: Verification evidence marks task succeeded
- **WHEN** 一个 `CONFIG_CHANGE` task trajectory 包含配置 apply 成功和后续 verify/query 成功的 source refs
- **THEN** `taskOutcomeStatus` MAY be `SUCCEEDED`
- **AND** `outcomeEvidenceLevel` MUST be `VERIFICATION`
- **AND** `outcomeEvidenceRefs` MUST reference the safe apply and verify facts

#### Scenario: Failed or cancelled request maps to outcome
- **WHEN** request run terminal status 是 failed、cancelled 或 timeout
- **THEN** `taskOutcomeStatus` MUST be `FAILED`、`CANCELLED` 或 `PARTIAL`
- **AND** trajectory diagnostic MUST use safe reason code, not raw failure text

#### Scenario: Non-task request is skipped with diagnostic
- **WHEN** 已提交请求只是寒暄、无任务目标、无可复用事实且无可总结动作
- **THEN** 系统 MUST NOT 创建空洞 `TaskTrajectoryRecord`
- **AND** 系统 MUST 记录 `TASK_TRAJECTORY_NOT_APPLICABLE` 或等价安全诊断

### Requirement: Task trajectory historical immutability

系统 SHALL 将 task trajectory 作为当次请求在当时证据下的历史投影。后续相似 trajectory 或后续长期记忆融合 MUST NOT 修改旧 trajectory 的 `taskOutcomeStatus`、`outcomeEvidenceLevel` 或摘要字段。允许更新旧 trajectory 的受控例外仅限同一 `requestRunId` 的幂等重建、迟到的同一 run 已提交事实补齐或 projection bug 修复。

#### Scenario: Later similar verified trajectory does not rewrite old unknown trajectory
- **WHEN** trajectory `T1` 因证据不足被持久化为 `taskOutcomeStatus=UNKNOWN`
- **AND** 后续另一个 request run 产生相似且 `VERIFICATION` 证据充分的 trajectory `T2`
- **THEN** 系统 MUST keep `T1.taskOutcomeStatus=UNKNOWN`
- **AND** 系统 MAY persist `T2` as a new trajectory
- **AND** any knowledge corroboration MUST happen in memory extraction / `LongTermMemoryRecord`, not by updating `T1`

### Requirement: Task trajectory query contract

系统 SHALL 通过 gateway public port 提供 task trajectory 查询能力。查询 MUST 强制 `tenantId`、`subjectId`、`agentId` 三元 scope 过滤，并支持按 `sessionId`、`requestRunId`、时间窗口、task kind、trajectory build status、task outcome status、outcome evidence level、limit 和 cursor/offset 查询。`TaskTrajectoryQueryGateway` MUST 额外提供后台构建专用的最小 `listBuildCandidates` 查询，用于返回已 terminal commit 但同 scope 下尚无 trajectory 的 run/event refs；该查询不得返回 raw content，也不得作为 Web/API 查询面暴露。跨 owner 或跨 agent 查询 MUST 返回空结果或 not found 安全语义，不得暴露目标轨迹是否存在。

#### Scenario: Query returns only matching owner and agent scope
- **WHEN** 调用方查询 `tenantId=T1, subjectId=U1, agentId=A1` 的 task trajectories
- **THEN** 结果 MUST 只包含同一 `tenantId`、`subjectId` 和 `agentId` 的 records
- **AND** `(T1,U2,A1)`、`(T2,U1,A1)` 或 `(T1,U1,A2)` 的 records MUST NOT 返回

#### Scenario: Time-window query supports memory extraction
- **WHEN** memory extraction 查询最近 7 天同 scope 已完成 task trajectories
- **THEN** query gateway MUST 返回符合时间窗口、trajectory build status、task outcome status、outcome evidence level 和 limit 的安全 trajectory projection
- **AND** memory extraction MUST NOT 直接读取 gateway-local table、session message private implementation 或 raw database rows

#### Scenario: Build candidate query returns only minimal refs
- **WHEN** catch-up worker 查询缺失 trajectory 的 build candidates
- **THEN** query gateway MUST 只返回 scoped owner/agent/session/run/terminal event refs、状态和 cursor
- **AND** 已存在同 scope `requestRunId` trajectory 的 run MUST NOT 返回
- **AND** raw message、raw tool output、artifact content、本地路径和 credential MUST NOT 返回

### Requirement: Task trajectory architecture boundary

系统 SHALL 保持 task trajectory 与 runtime、memory tools、memory extraction 和 gateway-local 的职责边界。Runtime 只拥有 request lifecycle、terminal commit 和 canonical timeline event listener publication，不拥有轨迹构建语义。Memory tools 不得调用 task trajectory builder 或 query port。Local backend 的 builder MAY 位于 `agent-memory`，但只能消费 public gateway ports，不得导入 gateway-local private path、SQLite driver 或 FTS5 implementation。Local gateway MUST expose task trajectory persistence through explicit `LocalGatewayStores.taskTrajectoryStore` and `LocalGatewayStores.taskTrajectoryQuery` properties backed by `SqliteGatewayStores` dedicated tables.

#### Scenario: Runtime does not own trajectory building
- **WHEN** terminal commit 成功后需要构建 task trajectory
- **THEN** runtime MAY publish the persisted terminal timeline event to `runTimelineEventListeners`
- **AND** runtime MUST NOT 包含 task kind 分类、trajectory field projection、memory extraction 规则或 trajectory persistence logic

#### Scenario: Model-facing tools do not consume trajectories
- **WHEN** 模型调用 `search_memory`、`get_memory_detail` 或 `add_memory`
- **THEN** memory tools MUST NOT 调用 `TaskTrajectoryStoreGateway`、`TaskTrajectoryQueryGateway` 或 task trajectory builder
- **AND** 需要自动学习时 MUST 由 memory extraction 后台路径消费 trajectories
