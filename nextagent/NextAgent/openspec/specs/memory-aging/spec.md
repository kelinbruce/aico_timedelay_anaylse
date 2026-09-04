# memory-aging Specification

## Purpose
定义长期记忆老化任务的触发条件、执行边界、状态更新和失败处理，使记忆生命周期可在不阻塞请求提交的前提下持续维护。
## Requirements
### Requirement: Background aging trigger and execution boundary

系统 SHALL 将长期记忆 aging 作为后台 lifecycle 能力执行。aging MUST 只在请求 terminal commit 关键路径之外运行，不得阻塞用户请求，不得改变已提交 RequestRun、SessionMessage、canonical timeline、active context 或 stream projection。

aging 通过注入的 `LongTermMemoryStoreGateway`（以下简称 `store`）统一调用 flat `store.mutateLongTermMemory`，状态变更传 `targetState/archiveReason`，置信度变更传 `delta`；CAS 通过 `VersionedWriteOptions.expectedVersion` 传递。

**触发机制**：aging cycle SHALL 由配置驱动的后台 schedule、受控管理触发或测试触发启动。`nextAgent.memory.aging.enabled` 默认 MUST 为 `true`；`schedule` 默认 MUST 为 `0 0 0 * * ?`。`enabled=false` 时所有 trigger MUST 返回 skipped diagnostic；`enabled=true` 且 local memory backend 被选中时，本地后台 scheduler MAY 创建 scheduled timer 并触发 scheduled aging cycle；受控管理触发和测试触发 MAY 执行。

**配置契约**：
- `nextAgent.memory.aging.enabled`：默认 `true`。
- `nextAgent.memory.aging.schedule`：cron 表达式，默认 `0 0 0 * * ?`，每日 00:00 执行。
- `nextAgent.memory.aging.decayStaleDays`：默认 `30`，范围 `[7, 365]`。
- `nextAgent.memory.aging.archiveRetentionDays`：默认 `90`，范围 `[30, 730]`。
- `nextAgent.memory.aging.decayFactor`：默认 `0.05`，范围 `[0.01, 0.5]`。
- `nextAgent.memory.aging.batchLimit`：默认 `1000`，范围 `[100, 10000]`。
- `nextAgent.memory.aging.timeoutMs`：默认 `30000`，范围 `[5000, 120000]`。
- `nextAgent.memory.aging.reviveConfidenceBoost`：默认 `0.1`，范围 `[0.01, 0.5]`。
- 每次 trigger MUST 创建一个可诊断的 aging cycle，并携带 cycle id、触发原因、开始时间和配置快照摘要。

**归档与实施前置条件**：
- memory core boundary MUST 先在当前代码基线可用并通过验证。core MUST 提供 YAML flat `mutateLongTermMemory`。core MUST also expose `listLongTermMemory` filters (`state`, `isPinned`, `maxLastAccessedAt`) 以及无副作用 `getLongTermMemory`；YAML 不提供 `maxArchivedAt`，retention scan MUST 分页 list ARCHIVED summary，再 get 读取完整 record 的 `archivedAt`。owner-authorized `getLongTermMemoryDetail` 继续允许访问 retained ARCHIVED record。归档顺序按 OpenSpec release 流程处理，不替代源码/测试核验。
- memory configuration MUST 先注册并校验 `nextAgent.memory.aging.*` 配置字段，aging 只消费已验证冻结快照。
- `get_memory_detail` owner-authorized L2 detail access boundary MUST 先存在，revival-on-access 才能接线。后续 maintenance detail API 若存在，MUST 复用同一个 revival helper，不得成为当前 change 的并行前置路径。

**输入与运行条件**：
- 通过 `LongTermMemoryStoreGateway.listLongTermMemory` public filters 在当前 owner+agent scope 下扫描符合 aging 条件的 retained memory records；aging 不读取 session history，不直接访问 gateway-local SQLite/FTS5 私有实现，也不拥有 extraction 输入边界。
- memory core record、query 和 update boundary MUST 支持 agent scope 校验（三元 scope：`tenantId`、`subjectId`、`agentId`）。
- effective aging enabled 配置为 true。
- 调用方或调度器持有可信 app composition 生成的 memory aging 配置。
- 每个处理分区 MUST 有可信 `tenantId` 和 `subjectId`，不得来自客户端请求体、模型输出、capability 参数或客户端 metadata。
- 每个 cycle MUST 接收 timeout、batch limit 和 `AbortSignal` 或等价 cancellation context。

**输出与副作用**：cycle MUST 输出结构化 `MemoryAgingCycleResult` 或等价诊断，至少包含 status、triggerReason、startedAt、completedAt、durationMs、processedCount、decayedCount、archivedCount、deletedCount、revivedCount、skippedCount、failureCount 和 safe reason codes。该结果可被日志、metric、audit 或后续管理面消费，但不得包含 memory content、prompt、模型输出、附件内容、路径、credential、token 或 raw error。

**流程接入**：上游是 app composition 中的后台调度/受控触发；下游是 memory core public boundary、observability/audit boundary 和后续维护/诊断读取方。Runtime、Context、Channel 和模型工具均不得拥有 aging decision。本地 aging 只适用于 local memory backend；remote complete-service backend 下 aging lifecycle 由远端长期记忆服务拥有，本地 aging scheduler MUST NOT 启动。

#### Scenario: Default configuration schedules aging at midnight
- **WHEN** 系统使用默认 memory aging 配置
- **THEN** effective aging enabled MUST 为 `true`
- **AND** `schedule` MUST 为 `0 0 0 * * ?`
- **AND** local aging scheduler MAY create a scheduled timer and trigger scheduled aging cycles at matching midnight windows
- **AND** 受控管理触发或测试触发 MAY 执行 aging cycle

#### Scenario: Scheduled cycle runs outside request terminal commit
- **WHEN** aging enabled 为 true 且后台 schedule 触发一个 aging cycle
- **AND** 同一时间存在正在执行或正在 terminal commit 的用户请求
- **THEN** aging cycle MUST 异步运行在 request terminal commit 关键路径之外
- **AND** 用户请求的 terminal commit、stream terminal event、history projection 和 active context MUST 不等待 aging cycle 完成
- **AND** aging cycle MUST 产生 `MemoryAgingCycleResult` 或等价诊断

#### Scenario: Disabled aging produces explicit skipped diagnostic
- **WHEN** aging enabled 为 false
- **AND** schedule 或受控触发尝试启动 aging cycle
- **THEN** 系统 MUST NOT 扫描或修改任何 memory record
- **AND** 系统 MUST 产生 status=`SKIPPED`、reason=`MEMORY_AGING_DISABLED` 的安全诊断

#### Scenario: Configured schedule starts local aging scheduler
- **WHEN** `MemoryConfig.status=VALID`
- **AND** effective memory enabled 为 `true`
- **AND** effective aging enabled 为 `true`
- **AND** local memory backend 被选中
- **AND** `nextAgent.memory.aging.schedule` 配置为受支持的 cron 表达式
- **THEN** 本地 aging scheduler MAY create a scheduled timer and trigger scheduled aging cycles

#### Scenario: Duplicate trigger does not run concurrently in the same process
- **WHEN** 同一 owner scope、同一 trigger identity 和同一 schedule window 被重复投递
- **AND** 当前进程内已有同一 cycle 正在运行
- **THEN** 系统 MUST NOT 并发运行第二个 cycle
- **AND** MUST 返回 status=`SKIPPED` 或等价 reason=`MEMORY_AGING_ALREADY_RUNNING` 的安全诊断
- **AND** 本 change 不要求跨进程、跨重启的 durable cycle idempotency；若后续需要该能力，MUST 由独立 anchored cycle fact change 定义

### Requirement: Owner-scoped aging scan

系统 SHALL 只在可信 owner scope 内扫描和处理长期记忆。aging MUST 同时满足 Agent Scope 和 Owner Scope 的隔离要求；主路径运行数据访问 MUST 显式携带并校验 `agentId`、`tenantId` 和 `subjectId`，其中 owner identity 只来自 trusted channel/auth boundary，agent scope 只来自可信 app composition 或已持久化 session/run。

**核心判断逻辑**：
1. 验证当前 aging partition 的 trusted `tenantId`、`subjectId` 和 agent scope 均存在。
2. 若任一 scope 缺失，跳过该 partition 并产生安全诊断。
3. 通过 `store` 查询该 scope 下的候选 records。
4. 对每条候选再次校验 owner scope 和 agent scope；不匹配时不得处理。
5. 对跨 scope 或 scope 不一致尝试产生 audit/safe diagnostic，不暴露目标记录是否存在。

#### Scenario: Aging processes only matching owner scope
- **WHEN** aging cycle 处理 `tenantId=T1, subjectId=U1, agentId=A1` 的 partition
- **AND** memory store 中同时存在 `(T1,U1,A1)`、`(T1,U2,A1)`、`(T2,U1,A1)` 和 `(T1,U1,A2)` 的 memory records
- **THEN** aging cycle MUST 只处理 `(T1,U1,A1)` 的 records
- **AND** 其他 records MUST 不被 decay、decay、archive、delete 或 revive

#### Scenario: Missing trusted scope skips partition
- **WHEN** aging trigger 无法获得可信 `tenantId`、`subjectId` 或 agent scope
- **THEN** 系统 MUST NOT 扫描 memory records
- **AND** cycle result MUST 记录 reason=`MEMORY_AGING_SCOPE_MISSING`
- **AND** audit/log MUST 不包含 memory content 或未授权 owner detail

#### Scenario: Client supplied owner is ignored
- **WHEN** 受控管理触发携带客户端提交的 `tenantId`、`subjectId`、`agentId` 或等价 metadata
- **THEN** aging MUST 忽略这些字段
- **AND** 只使用 trusted identity 和 trusted app composition / persisted scope
- **AND** 若 trusted scope 与请求声明不一致，系统 MUST 产生安全诊断并拒绝该触发

### Requirement: LongTermMemoryState lifecycle transitions

系统 SHALL 通过 `LongTermMemoryRecord.state` 管理 retained lifecycle 阶段，状态值为 `ACTIVE`、`ARCHIVED`。aging SHALL 是 `ACTIVE -> ARCHIVED` 和 `ARCHIVED -> ACTIVE` 复活的唯一后台 lifecycle owner。retention delete SHALL 通过 `store.deleteLongTermMemory` 物理删除 scoped record，不得定义 `DELETED` 软删除状态、物理归档表、独立 archive record 或跨表搬迁语义。

**状态 / 产物契约**：
- `ACTIVE`：参与普通检索和混合排序。长期未访问时进入 decay 流程——降 confidence，当 confidence 降到 0 以下时归档。
- `ARCHIVED`：默认不参与普通检索；仅在 core time-range retrieval 语义允许时可见；可被 `getLongTermMemoryDetail` 访问触发复活（通过 `mutateLongTermMemory({ targetState: "ACTIVE" }, { expectedVersion })`）。保留期满后进入 deletion。
- 已删除记录：不再作为 retained record 存在；普通检索、time-range 检索、detail、decay、archive 或 revival 均返回 not found / 空结果。
- `archivedAt` 和 `archiveReason` 记录状态转换事实。
- `isPinned=true` 的 record MUST 豁免自动 decay 和自动 delete。

**核心判断逻辑（cycle 顺序固定为 decay → delete）**：
1. 通过 `store.listLongTermMemory({ state: "ACTIVE", isPinned: false, maxLastAccessedAt })` 扫描 stale summaries。对每条记录：`newConfidence = max(0, oldConfidence - decayFactor)`。若 `newConfidence = 0`，通过 flat `{ targetState: "ARCHIVED", archiveReason: "confidence_decayed" }` 归档；否则通过 flat `{ delta }` 写回新 confidence。
2. 分页调用 `store.listLongTermMemory({ state: "ARCHIVED", isPinned: false, limit, offset })`，再对 summary 调用无副作用 `getLongTermMemory`；只对 `archivedAt <= now - archiveRetentionDays` 的 record 调用 `deleteLongTermMemory`。cycle MUST 遵守 batchLimit，不得恢复 YAML 未定义的 `maxArchivedAt` filter。
3. `getLongTermMemoryDetail` 访问 `ARCHIVED` 记录时，core detail 读取只返回 retained record并更新access telemetry；aging helper再通过flat `{ targetState: "ACTIVE" }`复活，并通过flat `{ delta: +0.1 }`提升confidence（上限1.0）。每次 mutation 都使用前一步返回的 version 作为 expectedVersion。revival不在schedule cycle中批量执行。
4. 所有状态更新保持 `source`、`createTime` 和 scope 不变。

#### Scenario: Stale ACTIVE decays confidence
- **WHEN** aging cycle 扫描到 state=`ACTIVE`、pinned=false、`lastAccessedAt <= now - 30d`、`confidence=0.6` 的 record
- **AND** `decayFactor=0.05`
- **THEN** 系统 MUST 通过 flat `mutateLongTermMemory({ delta: -0.05 }, { expectedVersion })` 将 confidence 更新为 `0.55`
- **AND** cycle result MUST 增加 decayedCount

#### Scenario: Decayed confidence reaches zero, record archived
- **WHEN** aging cycle 扫描到 state=`ACTIVE`、pinned=false、`lastAccessedAt <= now - 30d`、`confidence=0.03` 的 record
- **AND** `decayFactor=0.05`
- **THEN** 系统 MUST 通过 flat `mutateLongTermMemory({ targetState: "ARCHIVED", archiveReason: "confidence_decayed" }, { expectedVersion })` 归档该 record
- **AND** cycle result MUST 增加 archivedCount

#### Scenario: Pinned record is exempt from decay
- **WHEN** aging cycle 扫描到 state=`ACTIVE`、pinned=true、`lastAccessedAt <= now - 30d` 的 record
- **THEN** 系统 MUST NOT 修改 confidence 或 state
- **AND** reason MUST 为 `MEMORY_AGING_PINNED_EXEMPT`

#### Scenario: Archived record exceeding retention is deleted
- **WHEN** aging cycle 扫描到 state=`ARCHIVED`、pinned=false、`archivedAt <= now - archiveRetentionDays` 的 record
- **THEN** 系统 MUST 物理删除该 record
- **AND** MUST 记录安全 delete diagnostic reason `"retention_expired"`；该 reason 不写入 retained `archiveReason`
- **AND** 该 record MUST 不再被普通检索、time-range 检索、decay、decay 或 revival 返回

#### Scenario: Retention scan uses only YAML operations
- **WHEN** ARCHIVED summaries 跨越两个 list pages
- **THEN** aging MUST 分页读取两个 page 并通过 `getLongTermMemory` 检查 `archivedAt`
- **AND** 只删除达到 retention cutoff 的 records
- **AND** Gateway contract 和 caller MUST NOT 使用 `maxArchivedAt`

#### Scenario: Physically deleted record is never revived
- **WHEN** 已物理删除的 entry id 被 time-range retrieval 或 L2 detail access 引用
- **THEN** aging MUST NOT 重新创建或恢复该 record
- **AND** 调用方 MUST 得到 core not-found / not-owned 语义或等价安全空结果

### Requirement: Archived revival on owner-authorized L2 access

系统 SHALL 支持归档条目的受控复活。L1 检索命中范围较广，只表示候选可能相关，不能证明该知识对当前用户仍然有效；revival MUST 只发生在 state=`ARCHIVED` 的 record 被同 owner scope 下的 L2 detail access 明确访问时。仅 time-range search 返回 L1 结果 MUST NOT 自动复活 record。

**输入与前置条件**：
- record state 为 `ARCHIVED`。
- 访问者通过 memory core owner scope 校验。
- record 未被物理删除且仍作为 retained `ARCHIVED` record 存在。
- revival 不引入独立开关；只有 `nextAgent.memory.aging.enabled=true` 时才允许触发，confidence boost 使用 `reviveConfidenceBoost` 配置。

**流程接入**：local backend 下，`agent-memory` SHOULD 提供 `getLongTermMemoryDetailWithAging`、`reviveArchivedMemoryOnDetailAccess` 或等价 owner-authorized L2 detail access orchestration helper。该 helper MUST NOT 替代或扩展 `LongTermMemoryRetrieverGateway` contract；`agent-app` composition MUST 只在 `add-ts-memory-tools` 的 `get_memory_detail` owner-authorized L2 detail access boundary 已存在后接线该 helper。当 `agingConfig.enabled === true` 时，`get_memory_detail` detail access 才触发 revival。remote complete-service backend 下，本地 helper MUST remain disabled。aging scheduler 的 cycle 中不执行批量 revival。maintenance 的 explicit restore 若存在，MUST 使用独立 restore 路径，不通过 background aging cycle 伪装；maintenance detail API 若后续存在，MUST 复用同一个 revival helper，不得定义第二条 revival-on-access 路径。

#### Scenario: Remote complete-service backend disables local aging
- **WHEN** app composition selects remote complete-service memory backend
- **THEN** local aging scheduler and revival helper MUST NOT start
- **AND** aging lifecycle decisions MUST be owned by the remote memory service or by a later remote adapter owning change

**输出与副作用**：revival MUST 将 state 更新为 `ACTIVE`，清除或保留 `archivedAt/archiveReason` 的展示语义由 memory domain design 承载；对外可验证行为是 record 重新参与普通 ACTIVE 检索。revival MUST 将 confidence 增加 `reviveConfidenceBoost` 并 clamp 到 `1.0`，默认 boost MUST 为 `0.1`。revival MUST 更新 `lastAccessedAt` 和 `updatedAt`，并产生 audit event 或等价安全诊断。

#### Scenario: Time-range L1 hit does not revive
- **WHEN** time-range retrieval 返回 state=`ARCHIVED` 的 L1 result
- **THEN** 系统 MUST NOT 仅因该 L1 result 将 record 更新为 `ACTIVE`
- **AND** revivedCount MUST 不增加

#### Scenario: Owner-authorized detail access revives archived record
- **WHEN** state=`ARCHIVED`、confidence=`0.6` 的 record 被同 owner scope 下 L2 detail access 成功访问
- **AND** `reviveConfidenceBoost=0.1`
- **THEN** 系统 MUST 将 record 更新为 state=`ACTIVE`
- **AND** confidence MUST 更新为 `0.7`
- **AND** `lastAccessedAt` 和 `updatedAt` MUST 更新为当前时间
- **AND** revivedCount 或等价 revival diagnostic MUST 增加

#### Scenario: Revival confidence is clamped at one
- **WHEN** state=`ARCHIVED`、confidence=`0.96` 的 record 被复活
- **AND** `reviveConfidenceBoost=0.1`
- **THEN** 更新后的 confidence MUST 为 `1.0`

#### Scenario: Cross-owner detail access does not revive
- **WHEN** state=`ARCHIVED` 的 record 被不同 tenant、不同 subject 或不同 agent scope 的调用方引用
- **THEN** 系统 MUST NOT revive 该 record
- **AND** 调用方 MUST 得到 core not-found / not-owned 语义或等价安全空结果

### Requirement: Cycle ordering limits and partial completion

系统 SHALL 在每个 aging cycle 中按确定性顺序处理 lifecycle 操作：decay → delete。revival 由 L2 detail access 触发，不属于 schedule cycle 的批处理阶段。cycle MUST 遵守 timeout、batch limit 和 cancellation context；超过限制时 MUST 产生 `PARTIAL` 或 `FAILED` 诊断，不得静默截断或静默吞错。

**容量边界**：每个 cycle 的 `batchLimit` 默认 MUST 为 `1000` 条 record；`timeoutMs` 默认 MUST 为 `30000` 毫秒。配置可覆盖默认值，但必须经 memory configuration runtime schema validation。

#### Scenario: Cycle executes operations in deterministic order
- **WHEN** aging cycle 扫描到符合 decay 和 delete 条件的 records
- **THEN** 系统 MUST 先执行 decay（降 confidence 或归档），再执行 delete（删除过期 ARCHIVED）
- **AND** cycle result MUST 分别报告 decayedCount、archivedCount 和 deletedCount

#### Scenario: Batch limit produces partial result
- **WHEN** aging cycle 待处理候选数量超过 `batchLimit=1000`
- **THEN** 系统 MUST 最多处理 1000 条候选
- **AND** cycle result MUST 为 status=`PARTIAL` 或包含 reason=`MEMORY_AGING_BATCH_LIMIT_REACHED`
- **AND** 不得把未处理候选计入 decayed/archived/deleted 成功计数

#### Scenario: Timeout cancels remaining work
- **WHEN** aging cycle 执行超过 `timeoutMs=30000`
- **THEN** 系统 MUST 停止后续未开始的候选处理
- **AND** cycle result MUST 包含 reason=`MEMORY_AGING_TIMEOUT`
- **AND** 已成功完成的 record updates MUST 保留并在 result 中计数

### Requirement: Aging failure and graceful degradation

系统 SHALL 对 aging 的所有失败、不可用、超时、取消和部分成功产生显式安全诊断。aging failure MUST NOT 改变用户请求终态，MUST NOT 破坏 memory core 的普通读写能力，MUST NOT 静默丢弃错误。

**失败与降级规则**：
- memory core disabled：cycle status MUST 为 `SKIPPED` 或 `FAILED`，reason=`LTM_DISABLED` 或 `MEMORY_AGING_CORE_DISABLED`。
- storage unavailable：cycle status MUST 为 `FAILED` 或 `PARTIAL`，reason=`LTM_STORAGE_UNAVAILABLE` 或 `MEMORY_AGING_STORAGE_UNAVAILABLE`。
- invalid config：cycle MUST NOT 启动，并产生 reason=`MEMORY_AGING_CONFIG_INVALID`。
- candidate update conflict：该 record MUST 计入 failureCount，cycle MAY 继续处理其他 records。
- cancellation：cycle MUST 停止未开始工作，返回 reason=`MEMORY_AGING_CANCELED`。

#### Scenario: Core disabled does not affect main request
- **WHEN** memory core disabled 且 aging schedule 触发
- **THEN** aging cycle MUST NOT 修改 memory records
- **AND** MUST 产生 explicit skipped/failed diagnostic
- **AND** 正在执行或已提交的 RequestRun terminal state MUST 不变

#### Scenario: Storage failure is observable
- **WHEN** aging cycle 查询或更新 memory core 时遇到 storage unavailable
- **THEN** 系统 MUST 产生 status=`FAILED` 或 `PARTIAL` 的 cycle result
- **AND** reason MUST 表达 storage unavailable
- **AND** SafeError、log、audit 或 metric MUST 不暴露 raw storage error、路径或 SQL

#### Scenario: Single record conflict does not hide failure
- **WHEN** aging cycle 中某条 record 更新因并发版本冲突失败
- **THEN** 该 record MUST 计入 failureCount
- **AND** cycle result MUST 包含 reason=`MEMORY_AGING_UPDATE_CONFLICT`
- **AND** 系统 MAY 继续处理同 batch 中其他 record

### Requirement: Aging observability audit and redaction

系统 SHALL 为 aging cycle 和单条 record lifecycle 事件提供安全可观测性。日志、metric 和 audit MUST 只包含低基数字段、安全 reason code、计数、duration、cycle id、tenant/subject/agent 的安全标识或哈希化/受控标识，以及 entry ref；不得包含 memory content、structured content、briefIndex 原文、prompt、模型输出、附件内容、raw provider error、raw storage error、本地路径、credential 或 token。

**输出与副作用**：
- cycle started/completed/partial/failed MUST 有结构化日志或等价 observable event。
- decayed/archived/deleted/revived SHOULD 以计数和安全 entry ref 表达；状态改变 MUST 通过现有 audit/observability event path 产生 safe audit event、safe diagnostic 或 structured observable event。
- metrics MUST 至少覆盖 cycle count、duration、status count、decayedCount、archivedCount、deletedCount、revivedCount 和 failureCount。

#### Scenario: Successful cycle emits safe metrics
- **WHEN** aging cycle 成功完成
- **THEN** 系统 MUST 记录 cycle duration、status、processedCount、decayedCount、archivedCount、deletedCount、revivedCount 和 failureCount
- **AND** metric labels MUST 不包含 query text、memory content、briefIndex、raw reason text 或高基数字段

#### Scenario: Lifecycle transition audit is redacted
- **WHEN** record 从 ACTIVE 自动转换为 ARCHIVED
- **THEN** audit event 或等价安全诊断 MUST 包含 operation=`ARCHIVE`、entry ref、safe reason code、occurredAt 和 owner/agent safe scope
- **AND** MUST NOT 包含 memory content、source evidence 原文、附件内容或 raw storage detail

### Requirement: Aging architecture boundaries

系统 SHALL 保持 memory aging 的架构边界。aging implementation MUST 位于 memory lifecycle owning boundary；runtime、channel、context、model 和 capability packages MUST NOT 复制 aging state machine、候选选择逻辑、状态转换逻辑或 private persistence 操作。

**流程接入**：
- 上游：trusted app composition、memory configuration、后台 schedule、受控管理触发、memory core records。
- 下游：memory core public boundary、observability/audit、可选 maintenance diagnostic projection。
- 非下游：Context prompt assembly、model tool invocation、runtime terminal commit、channel stream projection。

#### Scenario: Runtime does not own aging logic
- **WHEN** 实现 memory aging
- **THEN** runtime boundary MUST NOT 包含 decay、decay、archive、delete 或 revival 判断逻辑
- **AND** runtime MUST NOT 直接导入 aging implementation

#### Scenario: Context does not consume aging result automatically
- **WHEN** aging cycle 完成并产生 decayed、archived、deleted 或 revived 结果
- **THEN** context assembly MUST NOT 自动改变 system prompt、selectedMessageRefs、active context view 或 prompt budget
- **AND** 后续 context 若需要长期记忆，只能通过既有 memory retrieval/tool/context 规格消费可见结果

#### Scenario: Aging does not call model-facing memory tools
- **WHEN** aging cycle 需要更新 memory state 或 confidence
- **THEN** aging MUST 通过 `store` 的 lifecycle mutation 方法更新
- **AND** MUST NOT 创建 `add_memory`、`update_memory`、`forget_memory` 或其他 model-facing tool invocation

### Requirement: Aging scans cover the full retained confidence range

Memory aging SHALL evaluate every scoped retained record that satisfies the lifecycle state, pin and time predicates, including records whose confidence is below the ordinary retrieval default. Aging scans MUST explicitly request the full `[0, 1]` confidence range from the memory core list boundary. Ordinary retrieval defaults MUST NOT prevent decay, archive or retention delete.

#### Scenario: Low-confidence ACTIVE memory continues to decay
- **GIVEN** an unpinned ACTIVE record has confidence `0.26` and is older than `decayStaleDays`
- **WHEN** the next aging cycle scans its owner and agent scope
- **THEN** the record MUST be selected and decayed again
- **AND** repeated eligible cycles MUST be able to archive it when calculated confidence reaches zero

#### Scenario: Low-confidence ARCHIVED memory is physically deleted
- **GIVEN** an unpinned ARCHIVED record has confidence below `0.3`
- **AND** its `archivedAt` is older than `archiveRetentionDays`
- **WHEN** aging executes retention delete
- **THEN** the record MUST be selected and physically deleted

### Requirement: Aging schedule is independent of process startup second

The aging scheduler SHALL evaluate a configured six-field cron schedule by minute window. A process started at any second within a minute MUST still execute a schedule whose second field is `0` when the matching minute window arrives. One scheduler instance MUST execute at most one scheduled cycle for the same minute window.

#### Scenario: Daily schedule fires after unaligned startup
- **GIVEN** aging schedule is `0 0 3 * * ?`
- **AND** the process starts at `02:59:37` local time
- **WHEN** local time enters the `03:00` minute window
- **THEN** exactly one scheduled aging cycle MUST start
