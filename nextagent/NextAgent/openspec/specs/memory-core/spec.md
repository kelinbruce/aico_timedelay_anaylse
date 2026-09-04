# memory-core Specification

## Purpose
定义跨会话长期知识的写入、检索、隔离与生命周期基础契约，使 Agent 在可信 Owner Scope 和 Agent Scope 内保持可复用记忆。
## Requirements
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

### Requirement: Text-bearing long-term memory writes pass knowledge security admission

When a REMOTE guardrail binding is present, every app-composed `saveLongTermMemory` and `manualSaveLongTermMemory` operation MUST complete an `agent-memory`-owned knowledge security admission before invoking the selected `LongTermMemoryStoreGateway`. The admission implementation MUST remain package-internal to `agent-memory`: `LongTermMemoryWriteCoordinator` and its factory MUST NOT be exported from the `@nextagent/agent-memory` public index, referenced by `agent-app` composition contracts or passed into `agent-channel-web`. `agent-app` MAY inject only the selected `GuardrailGatewayPort` and existing memory gateways into existing `agent-memory` public factories. `LongTermMemoryStoreGateway`, `LongTermMemoryManagementPort` and `LongTermMemoryToolPort` method signatures MUST remain unchanged. The admission text MUST be the exact `briefIndex`, followed by one newline character, followed by the exact `content`. `labels`, `source`, tenant/subject/Agent scope, identifiers, confidence, version and other fields MUST NOT enter the guard request.

The admission boundary MUST split the complete admission text into consecutive non-empty fragments of at most 2000 Unicode code points without overlap, omission, reordering, replacement or an inserted omission marker. It MUST submit fragments in original order through `GuardrailGatewayPort.checkKnowledge`, with 1 to 5 fragments per call and `isPrivacy=true` on every call. It MUST wait for every batch to complete and MUST invoke the selected memory store exactly once only after every fragment is legal.

If any batch is blocked, the admission boundary MUST stop before persistence and return non-retryable `LTM_CONTENT_GUARD_BLOCKED` with category `POLICY_DENIED`. If the guard operation returns unavailable or an invalid response, it MUST stop before persistence and return retryable `LTM_CONTENT_GUARD_UNAVAILABLE` with category `UNAVAILABLE`. If the admission boundary produces an invalid `checkKnowledge` request, it MUST stop before persistence and return non-retryable `LTM_CONTENT_GUARD_UNAVAILABLE` with category `UNAVAILABLE`. If an existing caller cancellation context is observed before persistence, the admission boundary MUST stop and return non-retryable `LTM_CONTENT_GUARD_CANCELED` with category `CANCELED`. The admission boundary MUST pass that cancellation context only to `checkKnowledge`, MUST recheck it before persistence, and MUST NOT pass it to `LongTermMemoryStoreGateway`. These errors MUST NOT include checked text, provider `detail`, raw provider errors or scope identifiers.

The memory tool, automatic extraction and long-term memory management factories MUST reuse the same package-internal admission implementation and failure mapping, but they MUST NOT require a shared coordinator object identity. When no guardrail binding is present, app composition MUST preserve the existing long-term memory write behavior and delegate to the selected store without a guard call. Knowledge security admission MUST NOT be added to `LongTermMemoryStoreGateway`, SQLite or remote memory persistence adapters. `mutateLongTermMemory`, publish, copy, read, search, delete, aging and access-statistic operations MUST retain their existing behavior and MUST NOT trigger this admission.

#### Scenario: A complete short memory is checked before one write

- **WHEN** a guarded write receives `briefIndex` and `content` whose combined admission text contains at most 2000 Unicode code points
- **AND** the knowledge check returns legal
- **THEN** exactly one `checkKnowledge` call MUST contain the complete admission text as one fragment with `isPrivacy=true`
- **AND** the selected memory store MUST be invoked exactly once after that result

#### Scenario: A complete long memory is checked without omitted content

- **WHEN** a guarded write receives an admission text containing 6049 Unicode code points
- **THEN** it MUST produce four ordered fragments whose concatenation equals the original admission text
- **AND** the first three fragments MUST contain 2000 code points each and the fourth MUST contain 49 code points
- **AND** it MUST send the four fragments in one `checkKnowledge` call
- **AND** it MUST write only after all four results are legal

#### Scenario: Labels are excluded from knowledge admission

- **WHEN** a guarded write contains legal `briefIndex` and `content` plus one or more labels
- **THEN** every knowledge check request MUST contain only fragments derived from `briefIndex`, the newline separator and `content`
- **AND** no label value MUST be sent to the guardrail

#### Scenario: A later fragment is blocked

- **WHEN** at least one knowledge fragment is blocked
- **THEN** the operation MUST return `LTM_CONTENT_GUARD_BLOCKED`
- **AND** the selected memory store MUST NOT be invoked
- **AND** no partial long-term memory record MUST exist

#### Scenario: Guardrail dependency fails closed

- **WHEN** a guardrail binding exists and a knowledge check times out, is unavailable or returns an invalid success response
- **THEN** the operation MUST return `LTM_CONTENT_GUARD_UNAVAILABLE`
- **AND** the selected memory store MUST NOT be invoked

#### Scenario: Guardrail binding is absent

- **WHEN** app composition has no guardrail binding
- **THEN** `saveLongTermMemory` and `manualSaveLongTermMemory` MUST retain their existing validation and persistence results
- **AND** no RobotRouter request MUST be attempted

#### Scenario: Metadata-only mutation does not invoke knowledge admission

- **WHEN** an existing memory changes only confidence, pin, archive state or access statistics through its owning mutation operation
- **THEN** the mutation MUST retain its existing result without invoking `checkKnowledge`

### Requirement: 长期记忆批量新增保持逐项准入和结果可核对

系统 MUST 接受包含 1 至 100 个条目的长期记忆批量新增请求。每个条目 MUST 包含 `memoryType`、`knowledgeSourceType`、`briefIndex` 和非空 `content`；MAY 包含 `memoryId`、`labels`、`confidence`、`source`、`idempotencyKey`、`state` 和 `archiveReason`。当 `confidence` 缺失时系统 MUST 使用 `1`；当 `state` 缺失时系统 MUST 使用 `ACTIVE`。未知字段、空批次或超过 100 个条目的请求 MUST 在处理任何条目前整体拒绝。

任一条目未通过 HTTP runtime schema 字段校验时，系统 MUST 在处理任何条目前整体拒绝该请求。通过请求级 schema 校验后，系统 MUST 对每个条目独立执行内容安全准入、可信 Owner Scope 与 Agent Scope 约束、50 条 `CONFIGURED` 个人记忆容量约束和幂等写入。单个条目的安全准入、容量或写入失败 MUST NOT 阻止后续条目处理，也 MUST NOT 为该条目创建记忆。成功结果 MUST 返回 `successCount`、`failCount` 和按输入处理顺序排列的成功 `memoryIds`，其中 `successCount + failCount` MUST 等于输入条目数，`memoryIds.length` MUST 等于 `successCount`。请求级可信 scope 错误、取消或存储不可用 MUST 使整个调用返回 presentation-safe 错误；系统 MUST NOT 把部分结果报告为完整成功。

50 条 `CONFIGURED` 个人记忆容量约束 MUST NOT 依赖单一持久化 gateway 实现的自愿行为：在调用持久化 gateway 前，management service MUST 对未携带 `memoryId` 的 `CONFIGURED` 条目按输入顺序执行容量预检。剩余额度 MUST 为 50 减去同一可信 scope 与 `memoryInstance`（缺省 `defaultInstance`）下 `ACTIVE` 与 `ARCHIVED` 状态 `CONFIGURED` 记忆总数；超出剩余额度的条目 MUST 计入 `failCount` 且 MUST NOT 进入持久化调用。携带 `memoryId` 的条目与 `CONFIGURED` 之外的条目不受该预检约束。批次内不存在未携带 `memoryId` 的 `CONFIGURED` 条目时，management service MUST NOT 执行容量预检查询。容量预检查询返回 SafeError 时，整个调用 MUST 返回该 presentation-safe 错误且 MUST NOT 处理任何条目。

**需求类别**：功能性需求

#### Scenario: 三条记录部分成功

- **GIVEN** 批量请求包含三个 schema 合法的条目
- **AND** 第二个条目被内容安全准入拒绝
- **WHEN** 系统处理该批量请求
- **THEN** 第一和第三个条目 MUST 各创建一条记忆
- **AND** 第二个条目 MUST 不创建记忆
- **AND** 结果 MUST 为 `successCount = 2`、`failCount = 1` 和两个按输入顺序排列的 `memoryIds`

#### Scenario: 批量大小越界时整体拒绝

- **WHEN** 批量请求包含 0 个或 101 个条目
- **THEN** 系统 MUST 返回 validation 类安全错误
- **AND** 系统 MUST 不处理或写入任何条目

#### Scenario: 重复条目按自己的幂等键收敛

- **GIVEN** 一个条目携带幂等键 `K1` 且首次处理已成功
- **WHEN** 相同可信 scope 下再次提交携带 `K1` 的同一条目
- **THEN** 系统 MUST 返回首次写入对应的 `memoryId`
- **AND** 系统 MUST 不创建第二条记忆或重复产生写入副作用

#### Scenario: 容量不足条目按序占用剩余额度

- **GIVEN** 当前可信 scope 与 `memoryInstance` 下已有 47 条 `ACTIVE` 与 `ARCHIVED` 合计的 `CONFIGURED` 记忆
- **WHEN** 批量请求包含 20 个未携带 `memoryId` 的 `CONFIGURED` 条目
- **THEN** 按输入顺序的前 3 个条目 MUST 进入持久化调用并可创建记忆
- **AND** 其余 17 个条目 MUST 计入 `failCount` 且不进入持久化调用
- **AND** 结果 MUST 为 `successCount` 与 `failCount` 之和等于 20

#### Scenario: 容量预检查询失败使整批安全失败

- **WHEN** 容量预检查询返回 SafeError（如存储不可用或取消）
- **THEN** 整个调用 MUST 返回该 presentation-safe 错误
- **AND** 系统 MUST 不处理或写入任何条目

### Requirement: 长期记忆管理提供唯一 Channel 端口

系统 SHALL 通过 `@nextagent/agent-contracts/channel` 暴露 `LongTermMemoryManagementPort`，供 Web Channel 调用长期记忆管理能力。该 port SHALL 精确定义 save、list、batch create、manual save、get、delete、mutate、search、detail、publish、unpublish、list published 和 copy published 13 个 operation。

**需求类别**：功能性需求

#### Scenario: Channel 通过 Management Port 调用批量新增

- **WHEN** Web Channel 处理长期记忆批量新增 HTTP operation
- **THEN** Channel MUST 调用 `LongTermMemoryManagementPort.batchCreateLongTermMemory`
- **AND** Channel MUST NOT 直接调用 `LongTermMemoryStoreGateway` 或其它 Gateway port

#### Scenario: Management Port 的公开方法集合包含批量新增

- **WHEN** contract tests 枚举 `LongTermMemoryManagementPort` 的公开 method
- **THEN** method 集合 MUST 与 13 个已定义 operation 一一对应
- **AND** port MUST NOT 增加 count、batch delete、transition、adjust、access 或其它兼容别名

### Requirement: Management 调用使用可信 Scope 和取消上下文

每个长期记忆 management command/query SHALL 携带由完整 `IdentityContext` 和独立 `agentId` 组成的可信 `LongTermMemoryManagementScope`。`IdentityContext` SHALL 原样来自 channel/auth boundary，`agentId` SHALL 来自 trusted hosted-Agent selection 或 app composition。`agent-memory` SHALL 只把 `identityContext.tenantId`、`identityContext.subjectId` 和 `agentId` 映射到 Gateway scope；`displayName` MUST NOT 进入 Gateway 请求、记忆响应或诊断。所有 13 个 management methods SHALL 接收可选 `AbortSignal`；application service SHALL 在调用 Gateway 前检查取消状态。客户端 query/body、模型输出、Capability 参数或 metadata MUST NOT 覆盖 Owner Scope 或 Agent Scope。

**需求类别**：功能性需求

#### Scenario: 批量新增注入唯一可信 Scope

- **WHEN** 已认证的批量新增请求进入 Channel
- **THEN** Channel MUST 从 trusted identity resolver 和 Agent resolver/composition 构造 management scope
- **AND** request body 中的 `tenantId`、`subjectId`、`userId` 或 `agentId` MUST 导致请求拒绝
- **AND** 同一可信 scope MUST 应用于该批次的全部条目

#### Scenario: 批量准入期间取消

- **WHEN** 客户端在批量新增完成前断开连接
- **THEN** Channel MUST abort 传给 management port 的 signal
- **AND** application service MUST 在下一次 Gateway 调用前观察取消并停止继续处理
- **AND** 已完成条目的结果 MUST 保持已提交，未开始的条目 MUST 不被写入

### Requirement: Management Boundary 由 Composition 显式启用

`agent-app` SHALL 是构造和注入 `LongTermMemoryManagementPort` 的唯一 composition owner。`agent-app` SHALL 只选择 Gateway bindings、调用 `agent-memory` public factory并传递返回 port；MUST NOT 承担 management DTO mapping、Record projection、记忆业务校验或 route delegation。只有 selected Gateway bindings 可用且 application service 构造成功时，Web Channel 才 SHALL 接收 management port。

**需求类别**：功能性需求

#### Scenario: 可用依赖启用批量新增 Route

- **WHEN** app composition 已获得 selected Store、Retriever 和 Sharing Gateway bindings
- **THEN** app MUST 构造并只向 Web Channel 注入一个 `LongTermMemoryManagementPort`
- **AND** 包含批量新增在内的 13 个长期记忆 routes MUST 委托该 port

#### Scenario: 缺少依赖不产生批量直连

- **WHEN** selected Gateway bindings 缺失、歧义或不可用
- **THEN** app MUST NOT 向 Channel 注入 management port
- **AND** Channel MUST NOT 为批量新增回退到直接调用 Gateway、disabled adapter 或 process-local mock
