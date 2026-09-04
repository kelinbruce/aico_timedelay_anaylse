# memory-sharing Specification

## Purpose
定义长期记忆在授权范围内的共享、查询和网关访问契约，确保共享行为保留 Owner Scope、Agent Scope 和可追踪的访问边界。
## Requirements
### Requirement: Long-term memory sharing gateway

系统 SHALL 通过 `LongTermMemorySharingGateway` 提供 `publishLongTermMemory`、`unpublishLongTermMemory`、`listPublishedLongTermMemory`、`copyPublishedMemory` 四个 operation，并与 V2 YAML 的业务 data schema 对齐。`LongTermMemoryGatewayBindings` SHALL required 暴露 `sharing`，LOCAL、REMOTE composition 和 disabled adapter 均不得省略。

Sharing request 中 YAML `userId` SHALL 映射为可信 `OwnerScoped.subjectId`。`listPublishedLongTermMemory` 的 YAML wire query 虽不包含 `userId`，Gateway query 仍 MUST 携带调用者 `subjectId` 作为 authorization context；REMOTE adapter MUST NOT 把该字段发送为 wire query。响应中的 YAML `ownerUserId` SHALL 在 Gateway 中表示为 `ownerSubjectId`。

**Publish**：`publishLongTermMemory` request SHALL 包含 `memoryId`、scope，MAY 包含 `memoryInstance/reasonCode`。source MUST 是当前 owner scope 下的 PRIVATE 或 FORK record。系统 SHALL 创建新的 SHARED record，设置新 `memoryId`、`sharingState=SHARED`、`sourceMemoryId=<source memoryId>`，并返回 `{ publishedMemory,sourceMemoryId,ownerSubjectId }`。同 scope、同 source 已发布时 MUST 返回既有 SHARED record，不重复创建或递增 source telemetry。

**Unpublish**：`unpublishLongTermMemory` SHALL 只允许发布者在同 tenant/subject/agent/instance scope 物理删除 SHARED record 和检索投影，返回 `{ memoryId }`。SHARED 不存在、非发布者或 scope mismatch SHALL 使用不泄漏存在性的 not-found 语义。已复制 FORK records MUST 不受影响。

**Shared list**：`listPublishedLongTermMemory` SHALL 只返回 `sharingState=SHARED` records，按 YAML filters `tenantId/agentId/memoryInstance/queryText/memoryType/knowledgeSourceType/labels/limit/offset` 查询，返回 `SharedMemorySummaryPage { items,total,offset,limit }`。每项 SHALL 包含 `LongTermMemorySummary` 全部字段以及 `sourceMemoryId/ownerSubjectId`。该方法是唯一允许跨 subjectId 返回共享摘要的受控 Gateway；它 MUST NOT 返回完整 source、private record 或其他 tenant/agent 的共享记录。

**Copy**：`copyPublishedMemory` SHALL 接收 1..100 个 `memoryIds`、接收者 scope，以及 optional `memoryInstance/reasonCode`。每个 id MUST 指向同 tenant/agent shared pool 中的 SHARED record。系统 SHALL 按输入顺序为接收者创建新 FORK records，设置新 `memoryId`、`sharingState=FORK`、`sourceMemoryId=<shared memoryId>`，返回 ordered `results[] { memoryId,record,sourceMemoryId }`。

LOCAL copy MUST 在单个 persistence transaction 中全成或全败；任一 id 非法、重复规则失败、非 SHARED、跨 tenant/agent 或 storage failure 时 MUST 回滚全部新增 record 和 FTS projection。copy 不得修改发布者 SHARED record 的 content、version 或 telemetry。

ordinary Store/Retriever SHALL 继续按 owner scope 隔离，不得把 shared list 的跨 subject 例外扩散到 get/detail/save/mutate/delete。普通 Store MUST NOT修改或删除 SHARED；发布和撤销发布只属于 Sharing Gateway。

所有 Sharing 日志、metric、audit 和 SafeError MUST 只包含 safe ids、scope refs、sharing state、count 和 reason code，不得包含 content、source、raw provider error、credential 或 token。

#### Scenario: Publish creates a shared copy
- **WHEN** U1 发布其 PRIVATE memory P1
- **THEN** 系统创建新的 SHARED memory S1
- **AND** `S1.sourceMemoryId=P1.memoryId`、`ownerSubjectId=U1`
- **AND** P1 仍为 PRIVATE 且 version/telemetry 不变

#### Scenario: Repeated publish is idempotent
- **WHEN** U1 对相同 scope/source P1 重复 publish
- **THEN** 返回第一次创建的 S1
- **AND** 不创建第二条 SHARED record 或第二个 FTS projection

#### Scenario: Publish rejects non-owned source
- **WHEN** U2 尝试发布 U1 的 PRIVATE/FORK memory id
- **THEN** 返回不泄漏存在性的 not-found SafeError
- **AND** 不创建 SHARED record

#### Scenario: Shared list crosses subject only inside tenant and agent
- **GIVEN** U1 与 U2 在 `(T1,A1,I1)` 各有 SHARED records
- **WHEN** U3 浏览 `(T1,A1,I1)` shared pool
- **THEN** 可看到 U1/U2 的 shared summaries 和 ownerSubjectId
- **AND** 看不到 `(T2,A1,I1)`、`(T1,A2,I1)` 或 PRIVATE/FORK records

#### Scenario: Unpublish does not delete forks
- **GIVEN** U2 已把 S1 复制为 F1
- **WHEN** publisher U1 unpublish S1
- **THEN** S1 被物理删除
- **AND** F1 仍存在且 `sharingState=FORK/sourceMemoryId=S1`

#### Scenario: Copy preserves input order
- **WHEN** U3 copy `[S3,S1,S2]`
- **THEN** results 顺序为对应 `[S3,S1,S2]`
- **AND** 每个 result 都包含新 FORK memoryId、完整 record 和对应 sourceMemoryId

#### Scenario: Copy batch rolls back on invalid item
- **WHEN** copy 输入 `[S1,privateP2,S3]`
- **THEN** 整个 operation 失败
- **AND** S1/S3 对应 FORK 也不得残留

#### Scenario: Copy limit is enforced
- **WHEN** copy 输入 0 个或 101 个 memoryIds
- **THEN** 返回 `LTM_WRITE_INVALID`
- **AND** 不产生任何 FORK record

#### Scenario: Disabled sharing is explicit
- **WHEN** memory configuration disabled 且 app 选择 disabled bindings
- **AND** 任一 Sharing method 被调用
- **THEN** 返回框架级 `LTM_DISABLED`
- **AND** 不发生本地或远端副作用
