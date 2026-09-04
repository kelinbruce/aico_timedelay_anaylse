## MODIFIED Requirements

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
