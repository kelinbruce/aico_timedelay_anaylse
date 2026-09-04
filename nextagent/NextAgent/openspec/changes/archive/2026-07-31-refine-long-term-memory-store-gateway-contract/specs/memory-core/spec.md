## MODIFIED Requirements

### Requirement: Cross-session knowledge persistence

系统 SHALL 以 `tenantId`、`subjectId`、`agentId`、`memoryInstance` 隔离并跨 session 持久化长期记忆。`subjectId` 是权威 YAML `userId` 在 Gateway Owner Scope 中的唯一表示；它 MUST 来自可信 identity boundary。`agentId` MUST 来自可信 app composition 或已持久化 session/run。`memoryInstance` 省略时 MUST 使用 `defaultInstance`。

Gateway public contract SHALL 与长期记忆 V2 YAML 的业务 data schema 对齐，并分为：

- `LongTermMemoryStoreGateway`：`saveLongTermMemory`、`listLongTermMemory`、`manualSaveLongTermMemory`、`getLongTermMemory`、`deleteLongTermMemory`、`mutateLongTermMemory`。
- `LongTermMemoryRetrieverGateway`：`searchLongTermMemory`、`getLongTermMemoryDetail`。
- Store Gateway MUST NOT 暴露 `countLongTermMemory`、`batchLongTermMemory`、`transitionLongTermMemoryState`、`adjustLongTermMemoryConfidence`、`markLongTermMemoryAccessed` 或自定义 `LongTermMemoryMutation` union。

所有 Request/Query SHALL 继承 `OwnerScoped` 并显式携带 `agentId`。YAML save `idempotencyKey` 和 save/mutate `expectedVersion` MUST 分别通过 `VersionedWriteOptions.idempotencyKey` 和 `VersionedWriteOptions.expectedVersion` 传递，不得进入 Request 或 Record；mutation options MUST NOT 暴露 YAML PATCH 不存在的 `idempotencyKey`。YAML `RestResponse.data` SHALL 映射为 Gateway 方法的业务返回值；`LtmError` SHALL 映射为 `SafeError`。

**Canonical record**：`LongTermMemoryRecord` SHALL 包含 `memoryId`、`tenantId`、`subjectId`、`agentId`、`memoryInstance`、`memoryType`、`knowledgeSourceType`、`sharingState`、可选 `sourceMemoryId`、`state`、`briefIndex`、字符串 `content`、`labels`、`confidence`、`version`、`accessCount`、`recallCount`、`extractionCount`、可选 `lastAccessedAt`、`archivedAt`、`archiveReason`、`isPinned`、字符串 `source`、`createTime`、`updateTime`。它 MUST NOT 暴露 `longTermMemoryId`、`category`、`tags`、`sourceTrace`、`createdAt` 或 `updatedAt` alias。

`memoryType` 只允许 `FACTUAL | CONCEPTUAL | PROCEDURAL | USER_CHARACTERISTICS`；`knowledgeSourceType` 只允许 `LEARNED | CONFIGURED | SYSTEM_DEFAULT`；`sharingState` 只允许 `PRIVATE | SHARED | FORK`；`state` 只允许 `ACTIVE | ARCHIVED`。`content` 和 `source` 是 Gateway opaque string，不得在 public Gateway contract 中定义 category-specific TypeScript union。

**Store operations**：

- `saveLongTermMemory` request MUST 包含 `memoryType`、`knowledgeSourceType`、`briefIndex`、`content`、`confidence`、`source`，MAY 包含 `memoryId`、`memoryInstance`、`labels`。`briefIndex` 长度为 1..2048，`content` 最大 4000，`labels` 最多 10 项且每项 1..256，`confidence` 为 [0,1]，`source` 长度为 1..4096。创建时生成唯一 `memoryId`，设置 `sharingState=PRIVATE`、`state=ACTIVE`、`version=1`、三个计数为 0、`isPinned=false`、`archivedAt=0`、`archiveReason=""`。更新时按同 scope 的 `memoryId` 执行，并遵守 optional expected version；成功更新版本加 1。
- `manualSaveLongTermMemory` request MUST 包含 `memoryType`、`knowledgeSourceType`、`briefIndex`、`content`，MAY 包含 `memoryId`、`memoryInstance`、`labels`。创建/更新后 `confidence` MUST 为 0.5，`source` MUST 为 `MANUAL`。
- `getLongTermMemory` SHALL 无副作用返回同 scope 完整 retained record；missing 和 scope miss 均返回 `LTM_MEMORY_NOT_FOUND`。
- `listLongTermMemory` SHALL 支持 YAML filters：`memoryInstance`、`memoryType`、`knowledgeSourceType`、`state`、`isPinned`、`minConfidence`、`sinceTime`、`untilTime`、`maxLastAccessedAt`、`labels`、`limit`、`offset`。`limit` 默认 10 且范围 1..100；`offset` 默认 0。返回 `LongTermMemorySummaryPage { items,total,offset,limit }`，无 telemetry 副作用。
- `deleteLongTermMemory` SHALL 按 `memoryId`、scope 和 optional `memoryInstance` 物理删除 record 及检索投影，返回 `{ memoryId }`。`reasonCode` MAY 作为安全调用元数据，但不得写入 retained record。ordinary Store MUST NOT 删除 SHARED record。
- `mutateLongTermMemory` SHALL 使用 flat request fields `targetState/archiveReason/delta/lastAccessTime/isPinned`，并通过只选取 `VersionedWriteOptions.expectedVersion` 的 options 接收 CAS。一次请求 MUST 恰好命中一个合法字段组合；成功时原子更新对应字段和 `updateTime`，版本加 1，并返回 `VersionedUpdateResult.status=UPDATED` 及 record。

合法 mutation 组合固定为：
1. `targetState`，且只有该组合 MAY 包含 `archiveReason`；进入 ARCHIVED 时设置 `archivedAt`，进入 ACTIVE 时若携带 `archiveReason` 其值 MUST 为空字符串，并清空 `archivedAt/archiveReason`。
2. `delta`，范围 [-1,1]，结果 confidence clamp 到 [0,1]。
3. `lastAccessTime`，整数且 >=0。
4. `isPinned`。

零组合、多组合、孤立 `archiveReason`、ACTIVE 携带非空 `archiveReason`、mutation options 携带 `idempotencyKey` 或未知字段 MUST 无副作用失败。非法 state mutation 返回 `LTM_TRANSITION_INVALID`；非法 confidence mutation 返回 `LTM_CONFIDENCE_INVALID`；其余非法 write shape 返回 `LTM_WRITE_INVALID`。CAS mismatch 返回 `VERSION_CONFLICT`，missing/scope miss 返回 `NOT_FOUND`，不得泄漏其他 scope 是否存在。

**Retriever operations**：

- `searchLongTermMemory` request MUST 包含 `queryText`、`minConfidence`、`limit`、`offset`，MAY 包含 `memoryInstance`、`memoryType`、`knowledgeSourceType`、`sinceTime`、`untilTime`、`labels`。`queryText` 长度 1..2048，`minConfidence` 为 [0,1]，`limit` 为 1..100，`offset` MUST 为 0；非 0 返回 `LTM_QUERY_INVALID`。结果为 `SearchItemPage { items,total,offset,limit }`，item 为 `{ summary,score,relevanceScore }`，按 score 降序；成功命中 MUST 递增每条 record 的 `recallCount`，不得更新 `accessCount/lastAccessedAt`。
- `getLongTermMemoryDetail` SHALL 返回同 scope ACTIVE 或 ARCHIVED 的完整 record，并在同一原子边界把 `accessCount` 加 1、`lastAccessedAt` 更新到当前时间、版本加 1。core 不执行 revival policy。
- `LongTermMemorySummary` SHALL 包含 YAML 定义的 `memoryId/memoryType/knowledgeSourceType/state/briefIndex/content/labels/confidence/isPinned/createTime/updateTime/version`。list/search MUST NOT 因“L1”概念删除 YAML 明确要求的 `content` 字段。

**Persistence and isolation**：

1. 所有 private get/list/search/save/manual/delete/mutate/detail query MUST 使用 `(tenant_id, subject_id, agent_id, memory_instance)` scope；不得先做不带 scope 的存在性查询。
2. LOCAL SHALL 使用长期记忆专用 table 和 FTS projection，不得使用 generic records store。物理列名 MAY 保留既有名称，但 mapper 必须输出 canonical YAML field。
3. ordinary Store/Retriever 只能处理当前 owner 的 retained record。SHARED record 的发布、撤销和跨 owner 浏览由 `LongTermMemorySharingGateway` 独占。
4. first write 和 idempotent retry MUST 以 scoped memory anchor 保证不重复 side effect。CAS conflict MUST 不修改 record、计数或索引。
5. FTS 不可用时 LOCAL MAY fallback 到 literal substring match，并发出不含 content/source 的 `LTM_FTS_UNAVAILABLE` 安全诊断。
6. 所有方法 MUST 为 async。storage exception 不得穿透 port，统一返回 `LTM_STORAGE_UNAVAILABLE`；配置禁用 adapter MAY 返回框架级 `LTM_DISABLED`。

**算法与软件边界**：`agent-memory` MAY 定义 category-specific private content/source evidence 类型，并在 Gateway 调用前序列化、读取后解析。Gateway MUST 只处理字符串、scope、校验、版本、计数、分页、排序、事务和 row mapping，不得决定 extraction equivalence、confidence corroboration、aging decay、archive、retention 或 revival policy。

#### Scenario: Gateway operations exactly match YAML
- **WHEN** consumer 检查长期记忆 Gateway public interfaces
- **THEN** Store 只包含 6 个 YAML Store operation
- **AND** Retriever 只包含 2 个 YAML Retriever operation
- **AND** count、batch、legacy typed mutation 和 mutation union 均不存在

#### Scenario: Owner userId mapping is trusted
- **WHEN** wire request 的 `userId=U1` 已通过可信 channel/auth boundary
- **THEN** Gateway request 使用 `subjectId=U1`
- **AND** caller request body、模型输出或 capability 参数不能覆盖该值

#### Scenario: Save creates a canonical private record
- **WHEN** `saveLongTermMemory` 以 `(T1,U1,A1,defaultInstance)` 和 required YAML fields 创建记忆
- **THEN** 返回 record 使用 `memoryId/memoryType/labels/source/createTime/updateTime`
- **AND** `sharingState=PRIVATE`、`state=ACTIVE`、`version=1`、计数均为 0
- **AND** 不存在 legacy alias 字段

#### Scenario: Save controls are write options
- **WHEN** caller 以 idempotency key `K1` 和 expected version `V1` 更新记忆
- **THEN** Request/Record 不含 `idempotencyKey/expectedVersion`
- **AND** Gateway 从 `VersionedWriteOptions` 读取二者
- **AND** REMOTE wire adapter MAY 将二者映射回 YAML body

#### Scenario: Manual save applies YAML defaults
- **WHEN** `manualSaveLongTermMemory` 收到有效 required fields
- **THEN** record 的 `confidence=0.5` 且 `source=MANUAL`
- **AND** create/update 的 scope 和 version 规则与 ordinary save 一致

#### Scenario: List returns YAML summary page
- **WHEN** list 以 `memoryType=PROCEDURAL`、`labels="handover"`、`limit=10`、`offset=0` 查询
- **THEN** 只返回同 owner+agent+instance 且匹配 filter 的 records
- **AND** result 为 `{ items,total,offset,limit }`
- **AND** 每个 summary 包含字符串 `content`

#### Scenario: Search requires zero offset
- **WHEN** search 使用 `offset=1`
- **THEN** 返回 `LTM_QUERY_INVALID`
- **AND** recall/access telemetry 均不改变

#### Scenario: Search and detail update different telemetry
- **WHEN** search 返回 E1
- **THEN** E1 `recallCount` 加 1，`accessCount/lastAccessedAt` 不变
- **WHEN** detail 成功读取 E1
- **THEN** E1 `accessCount` 加 1，`lastAccessedAt` 更新，`recallCount` 不变

#### Scenario: Flat state mutation succeeds
- **WHEN** mutate request 只包含 `targetState=ARCHIVED` 和 `archiveReason=confidence_decayed`
- **AND** expected version 匹配
- **THEN** record 原子进入 ARCHIVED，设置 `archivedAt/archiveReason`，版本加 1
- **AND** result status 为 UPDATED

#### Scenario: Multiple flat mutation groups are rejected
- **WHEN** mutate request 同时包含 `delta=-0.1` 和 `isPinned=true`
- **THEN** 返回 `LTM_WRITE_INVALID`
- **AND** confidence、pin、version 和 updateTime 均不改变

#### Scenario: Version conflict has no side effect
- **WHEN** record current version 为 4，mutation write options 的 expectedVersion 为 3
- **THEN** result status 为 VERSION_CONFLICT
- **AND** record、计数和索引不改变

#### Scenario: Cross-scope reads do not reveal existence
- **WHEN** E1 属于 `(T1,U1,A1,I1)`，caller 以 `(T1,U2,A1,I1)` get/detail/search/list
- **THEN** id lookup 返回 `LTM_MEMORY_NOT_FOUND`，集合查询返回空页
- **AND** Gateway 不执行 unscoped existence lookup

#### Scenario: Physical delete cannot revive
- **WHEN** ordinary owner 删除 PRIVATE/FORK E1
- **THEN** record 和 FTS projection 在同一 persistence boundary 物理删除
- **AND** 后续 get/detail/list/search/mutate 均不能返回 E1

#### Scenario: Ordinary Store cannot mutate shared record
- **WHEN** caller 对 `sharingState=SHARED` record 使用 ordinary save/mutate/delete
- **THEN** 操作安全失败且无副作用
- **AND** caller 必须使用 Sharing Gateway 的 publish/unpublish contract

#### Scenario: Invalid content length is rejected
- **WHEN** save 的 `content` 超过 4000 字符或 labels 超过 10 项
- **THEN** 返回 `LTM_WRITE_INVALID`
- **AND** 不写 record 或 FTS projection

#### Scenario: Architecture boundary enforcement
- **WHEN** architecture test 检查长期记忆依赖
- **THEN** `agent-context-engine`、`agent-capability`、`agent-runtime` 不得 import 长期记忆 Gateway
- **AND** LOCAL persistence 位于 `agent-platform-gateway-local`
- **AND** `agent-memory` 不得 import gateway-local private path、SQLite 或 FTS implementation
