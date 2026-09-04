## Purpose

定义长期记忆的核心数据模型、gateway 存储 port、gateway 检索 port、Agent Scope + Owner Scope 隔离 contract、按 scope 的存储变更原语，以及优雅降级行为。本 spec 是所有其他 memory change（`add-ts-memory-tools`、`add-ts-memory-extraction`、`add-ts-memory-aging`、`add-ts-memory-configuration`、`add-ts-memory-maintenance`、`add-ts-memory-sharing`）的依赖基础。

Branded type（`LongTermMemoryId`）和 enum（`MemoryCategory`、`LongTermMemoryState`）MUST 位于 `agent-common`。Gateway Record/Request DTO 和 port 签名（`LongTermMemoryStoreGateway`、`LongTermMemoryRetrieverGateway`）MUST 位于 `agent-contracts/gateway`。本地 gateway port 实现 MUST 遵循 session gateway 模式：它们直接位于 `agent-platform-gateway-local`，由 `SqliteGatewayStores` 通过 `LocalGatewayStores.longTermMemoryStore` 和 `LocalGatewayStores.longTermMemoryRetriever` 管理，且不需要 `agent-memory` 包装。后续商业 remote complete-service adapter MAY 在 `agent-platform-gateway-remote` 中实现同样的面向消费方的 port，并 MUST 只能通过 `agent-app` composition 被选择。本地与 remote complete-service 后端在同一次 app composition 中互斥。消费方通过 app composition 获得对应的 gateway port。后续所属 change MAY 在 `agent-memory` 中为本地后端定义应用级编排 helper，但它 MUST NOT 替换、扩展或再导出核心 gateway port contract；在 remote complete-service 后端中它 MUST NOT 复制 remote 拥有的生命周期决策。

## ADDED Requirements

### Requirement: 跨 session 知识持久化

系统 SHALL 以 `tenantId`/`subjectId`/`agentId` scope 跨 session 边界持久化知识条目，支持随时间累积的学习。被保留的条目保存在单一逻辑表中，并带有显式 `state` 字段。`ACTIVE` 和 `ARCHIVED` 是仅有的保留生命周期状态；删除会物理移除记录，而不是标记 `DELETED` 软删除状态。

**触发机制**：无主动触发。当面向 model 的 tool（`add-ts-memory-tools`）被暴露时，memory 读/写操作可由其同步调用；maintenance/用户管理边界可通过其自身 contract 调用读/更新/删除；后台生命周期操作（extraction、aging）通过其自身 change 边界异步调用存储 port。所有 port 调用都发生在 request terminal-commit 关键路径之外。

**输入与前置条件**：
- 所有 port 方法的 Request/Query DTO MUST `extends OwnerScoped` 并带显式 `agentId: AgentId`。`tenantId` 和 `subjectId` 来自可信 identity 边界（`IdentityContext`）。`agentId` 来自可信 app composition 或已持久化的 session/run（与 runtime `hostedAgentId` 同一模式）。
- 调用方 MUST 持有带已认证 `tenantId` 和 `subjectId` 的有效 `IdentityContext`，以及来自 app composition 或 session 绑定的可信 `agentId`。
- 对 `saveLongTermMemory`：请求 MUST 包含有效的 `category` 值、匹配 category schema 的结构化 `content`，以及位于 [0, 1] 的 `confidence`。首次写入（该 scope 下不存在既有 `longTermMemoryId`）时，gateway MUST 自动生成唯一 `longTermMemoryId`（UUID v7）。更新既有条目时，请求 MUST 引用既有的 `longTermMemoryId`；merge 保留 `accessCount`/`createdAt`/`state` 并递增 `updatedAt`。防止重复创建 MUST 使用 `saveLongTermMemory(request, IdempotentWriteOptions)` 写元数据，而不是 request 或 record 字段。
- 对读取（`getLongTermMemory`、`listLongTermMemory`、`searchLongTermMemory`、`getLongTermMemoryDetail`）：`tenantId`、`subjectId` 和 `agentId` 过滤结果集；查询时 `minConfidence` 省略时默认为 0.3。`listLongTermMemory` 支持可选的 `categoryFilter`、`stateFilter`、`isPinned`、`minConfidence`、`sinceTime`、`untilTime`、`maxLastAccessedAt` 和 `maxArchivedAt` 过滤器。当 `stateFilter` 省略时，普通列表查询默认为 `ACTIVE`。
- DTO 上的时间戳 MUST 使用 `EpochMillis`（按全局 contract）。

**输出与副作用**：
- `getLongTermMemory`：返回匹配的按 scope 的 `LongTermMemoryRecord`，或 `SafeError { code: "LTM_ENTRY_NOT_FOUND" }`。无副作用。该方法面向已被允许看到保留记录的内部/store 消费方，不是面向 model 的 L1 披露。
- `searchLongTermMemory`：返回按 hybrid score 降序排列的 FTS5 匹配 `LongTermMemorySearchEntry` L1 投影。副作用：每个返回条目的 `recallCount` 递增 1。不递增 `accessCount`。
- `getLongTermMemoryDetail`：为按 scope 的保留 `ACTIVE` 或 `ARCHIVED` 记录返回完整 L2 内容；将 `accessCount` 递增 1 并把 `lastAccessedAt` 更新为当前时间，作为供 `add-ts-memory-aging` 用于晋升和过时决策的持久副作用。Core 不复活 archived 记录；复活由 aging 或 maintenance 边界拥有。
- `saveLongTermMemory`：首次写入时自动生成 `longTermMemoryId`（UUID v7），设置 `accessCount = 0`、`state = ACTIVE`，写入 `createdAt`/`updatedAt`。对既有条目，merge 新字段（部分更新），保留 `accessCount`/`createdAt`/`state`，递增 `updatedAt`。无生命周期状态副作用。校验失败时返回 `SafeError { code: "LTM_WRITE_INVALID" }`。
- `deleteLongTermMemory`：在同一持久化边界内物理删除匹配记录并将其从检索索引中移除。缺失、已删除或非拥有的条目返回 `LTM_ENTRY_NOT_FOUND`。
- `listLongTermMemory`：返回 `LongTermMemoryListItem` L1 投影的分页结果集。当 `stateFilter` 省略时，只返回 `state = ACTIVE`。生命周期/后台调用方 MAY 组合 `categoryFilter`、`stateFilter`、`isPinned`、`minConfidence`、`sinceTime`、`untilTime`、`maxLastAccessedAt` 或 `maxArchivedAt`，通过公共 gateway contract 实现 aging 和 extraction 扫描。无副作用。
- `searchLongTermMemory`：返回按 hybrid score 降序排列的 FTS5 匹配 `LongTermMemorySearchEntry` L1 投影。每个返回条目的 `recallCount` 递增 1，但不递增 `accessCount`，也不更新 `lastAccessedAt`。
- `transitionLongTermMemoryState`：原子地更新由所属生命周期调用方请求的保留条目状态。请求 MUST 包含可选的 `expectedVersion` 用于乐观并发。返回 `VersionedUpdateResult<LongTermMemoryRecord>` 或 `SafeError`。Gateway 只校验 scope、目标 enum shape、版本、保留记录存在性和存储不变量；它 MUST NOT 判断某个业务转换是否被允许。删除 MUST 使用 `deleteLongTermMemory`，而不是生命周期转换。非法请求 shape 返回 `SafeError { code: "LTM_TRANSITION_INVALID" }`。
- `adjustLongTermMemoryConfidence`：以必填的 `delta` 调整条目 confidence，并按 `[0, 1]` 截断。请求 MUST 包含可选的 `expectedVersion` 用于乐观并发。返回 `VersionedUpdateResult<LongTermMemoryRecord>` 或 `SafeError`。`delta` 缺失或非法时拒绝。
- `markLongTermMemoryAccessed`：把 `lastAccessedAt` 更新为提供的 `accessedAt` 时间戳。请求 MUST 包含可选的 `expectedVersion` 用于乐观并发。返回 `VersionedUpdateResult<LongTermMemoryRecord>` 或 `SafeError`。
- `batchLongTermMemory`：在单次请求和单个持久化事务中执行多个 save/delete/transition/confidence 操作。每个操作携带自身 scope；任何失败 MUST 中止并回滚整个批次。返回逐条目结果列表，其中触发失败的条目保留其原始错误/更新结果，其余每个条目被报告为 batch-aborted。
- `countLongTermMemory`：返回按 scope 隔离的计数（total、active、archived、pinnedCount）。不返回记录内容。

**核心判断逻辑**：
1. 校验 `tenantId`、`subjectId` 和 `agentId` 非空。任一为空时立即返回 `SafeError { code: "LTM_AUTH_MISSING" }`。
2. 对读取：将 `WHERE tenant_id = ? AND subject_id = ? AND agent_id = ?` 作为强制过滤器。Gateway-local 接收已经可信的 scope 值，MUST NOT 执行宽泛查找来推断跨 scope 归属。Scope 未命中时，list/search/count 返回空结果集，id 查找返回 `LTM_ENTRY_NOT_FOUND`。
3. 对 `listLongTermMemory`：应用 `stateFilter ?? ACTIVE`，再应用可选的 `categoryFilter`、`isPinned`、`minConfidence`、`sinceTime`、`untilTime`、`maxLastAccessedAt` 和 `maxArchivedAt` 过滤器。对 `searchLongTermMemory`：普通检索过滤 `WHERE state = 'ACTIVE'`；时间范围查询（`sinceTime`/`untilTime` 存在）MAY 包含 `state = 'ARCHIVED'` 条目，但面向 model 的 tool MUST 保持普通搜索仅限 active。
4. 对 `searchLongTermMemory` 中的 hybrid 评分：计算 `score = 0.4×ftsRank + 0.3×confidence + 0.2×recencyScore + 0.1×accessScore`，降序排序，评分后再应用 `limit`/`offset`。
5. 对 `saveLongTermMemory`：如果提供了 `longTermMemoryId` 且在同一 `(tenantId, subjectId, agentId)` 下已存在，则 merge 新字段（部分更新）；保留 `accessCount`、`createdAt` 和 `state`。如果未提供 `longTermMemoryId` 或该 scope 下不存在，则自动生成唯一 `longTermMemoryId`（UUID v7）并创建新的 ACTIVE 条目。
6. 对 `transitionLongTermMemoryState`：校验 scope、目标状态 enum 值、可选的 `expectedVersion` 和保留记录存在性。成功时更新 `state`、`archivedAt`、`archiveReason` 和 `updatedAt`。调用方所属的生命周期边界决定所请求的业务转换是否被允许；gateway-local MUST NOT 强制执行 memory 生命周期状态机。
7. 对 `adjustLongTermMemoryConfidence`：应用 `delta`，再把结果截断到 `[0, 1]`。更新 `confidence` 和 `updatedAt`。
8. 对 `deleteLongTermMemory`：物理删除该 scope 的记录及其检索索引条目。已删除、缺失或非拥有的记录返回 `LTM_ENTRY_NOT_FOUND`。

**状态/产物 contract**：
- `LongTermMemoryRecord` 是 memory 记录被保留期间的 canonical record。其 `state` 字段存储保留生命周期阶段（ACTIVE / ARCHIVED）。阶段转换决策由 `add-ts-memory-aging` 和 `add-ts-memory-maintenance` 治理，而核心 gateway 只提供按 scope 的原子状态更新原语。显式遗忘和保留删除使用核心物理删除边界，不是 `DELETED` 状态，也不是 `saveLongTermMemory` 部分更新。
- `MemoryContentByCategory` 是以 `content.category` 为 key 的 discriminated union，它 MUST 与顶层 `LongTermMemoryRecord.category` / `SaveLongTermMemoryRequest.category` 匹配。`FACTUAL` 要求 `subject` 和 `claim`，MAY 包含安全的摘要化 `evidence[]` 和 `qualifiers[]`。`CONCEPTUAL` 要求 `concept` 和 `definition`，MAY 包含 `aliases[]` 和 `relatedConcepts[]`。`PROCEDURAL` 要求 `procedureName` 和非空 `steps[]`，MAY 包含 `preconditions[]`、`verification[]` 和 `pitfalls[]`。`USER_CHARACTERISTICS` 要求非空 `traits[]` 和取自 `PERSONALIZATION | TROUBLESHOOTING | WORKFLOW_ADAPTATION | GENERAL` 的非空 `purpose[]`。
- 结构化内容字符串只能是安全摘要。它们 MUST NOT 包含原始 prompt、原始 model 输出、stream delta、provider 错误、本地路径、凭证、token、附件内容、对其用途而言不被允许的原始 trait 值，或被复制为 evidence 的 message 文本。
- `LongTermMemoryRecord` 不包含 `isPublished` 或 `forkedFrom`。这些字段分别由 `add-ts-memory-sharing`（publish/fork）定义，并在该 change 中通过独立的 Request DTO 加入。
- `isPinned` 作为可选布尔字段包含在 `LongTermMemoryRecord` 上，通过 `saveLongTermMemory` 部分更新提供。它作为 `is_pinned` 列（INTEGER，0 或 1）持久化在 `long_term_memory` 表中。`SaveLongTermMemoryRequest` 也包含 `isPinned` 作为可选字段以支持写侧。Pin 生命周期语义（豁免自动 aging 衰减和删除）由 `add-ts-memory-aging` 拥有。
- `LongTermMemoryListItem`、`LongTermMemorySearchEntry` 和 `LongTermMemorySearchResult` 是瞬态查询投影。它们只携带 L1 字段以及搜索时计算的 `hybridScore`。它们 MUST NOT 内嵌 `LongTermMemoryRecord`、`content`、`sourceTrace`、`archiveReason`、`accessCount`、`recallCount` 或其他 L2 / 生命周期内部字段。
- `accessCount` 递增只是 `getLongTermMemoryDetail` 的持久副作用。`searchLongTermMemory` 递增的是 `recallCount`。`accessCount` 表示用户详情兴趣，`recallCount` 表示检索相关性；两者都由 `add-ts-memory-aging` 用于晋升决策。
- 当既有条目在跨 session 佐证中收到新的 extraction 来源引用时，`extractionCount` 递增，用于跟踪 extraction 独立发现该知识的次数。
- 每个条目保留 `sourceTrace` 用于追溯到来源交互和 extraction 佐证。`sourceTrace.sessionId` 仍是主来源 session，`sourceTrace.requestId` 仍是可用时的主根/request message，`sourceTrace.runId` MAY 标识已 commit 的 request run，`sourceTrace.messageRefs` MAY 标识有贡献的可见已 commit message，`sourceTrace.refs` MAY 包含多个有贡献的来源引用。
- 每个 `sourceTrace.refs[]` 项 MAY 包含 `sessionId`、`rootMessageId`、`runId`、`messageRefs` 和 `extractionCycleId`。来源 trace 引用 MUST 只包含持久标识符，MUST NOT 包含原始 prompt、原始 model 输出、stream delta、provider 错误、路径、凭证、token、附件内容、原始 trait 值或 message 文本。
- 首次写入时，gateway MUST 持久化完整 `sourceTrace`。更新既有条目时，gateway MUST 保留之前的来源引用并追加尚不存在的新引用。既有的标量 `sessionId` / `requestId` 行为对只使用主 trace 的消费方保持兼容。
- `isPinned` 是持久化在 `long_term_memory.is_pinned` 中的布尔字段。它通过 `saveLongTermMemory({ isPinned: true })` 设置，并通过 `LongTermMemoryRecord.isPinned` 读回。为 `true` 时，该条目豁免自动 archive 和衰减操作，由 `add-ts-memory-aging` 强制执行。Pin 生命周期（设置/取消）由 `add-ts-memory-maintenance` 拥有；aging 消费该持久化字段。
- `transitionLongTermMemoryState`、`adjustLongTermMemoryConfidence` 和 `markLongTermMemoryAccessed` 返回带状态 `UPDATED` / `VERSION_CONFLICT` / `NOT_FOUND` 的 `VersionedUpdateResult<LongTermMemoryRecord>`。
- `LongTermMemoryRecord.version` 是保留 memory 记录的乐观并发版本。首次写入设置 `version = 1`；每次成功的 `saveLongTermMemory` 更新或生命周期变更将其递增 1。提供 `expectedVersion` 的变更请求 MUST 与当前记录版本比较，不一致时返回 `VERSION_CONFLICT` 且不应用更新。弱遥测更新 MAY 省略 `expectedVersion`，仍使用原子的按 scope 更新。
- `DeleteLongTermMemoryRequest` MUST NOT 包含 `archiveReason`；物理删除不是归档。需要删除原因用于运维或 audit 时，它属于调用方拥有的安全诊断元数据，不写入保留 memory 记录。

**流程集成**：
```
                      ┌──────────────────┐    ┌──────────────────┐
                      │  IdentityContext  │    │ Trusted App Comp  │
                      │  (tenantId,       │    │ (agentId from     │
                      │   subjectId)      │    │  hostedAgentId)   │
                      └─────────┬────────┘    └──────────┬───────┘
                                │                        │
                                └────────────┬───────────┘
                                             │
                                             ▼
┌──────────────┐    ┌──────────────────────────┐    ┌──────────────────────────┐
│ memory-tools │───▶│ LongTermMemoryRetriever   │    │ LongTermMemoryStore      │
│ (capability) │    │ Gateway                   │    │ Gateway                  │
│              │    │ searchLongTermMemory      │    │ getLongTermMemory          │
│              │    │ getLongTermMemoryDetail   │    │ saveLongTermMemory         │
└──────────────┘    └───────────┬──────────────┘    │ deleteLongTermMemory       │
                                │                    │ listLongTermMemory          │
                                │                    │ batchLongTermMemory         │
                                │                    │ countLongTermMemory         │
                                │                    │ transitionLongTermMemoryState│
                                │                    │ adjustLongTermMemoryConfidence│
                                │                    │ markLongTermMemoryAccessed  │
                                │                    └───────────┬───────────────┘
                                │                            │
                                └───────────┬────────────────┘
                                            │
                                            ▼
                                   ┌─────────────────────┐
                                   │ LocalGatewayStores   │
                                   │ .longTermMemoryStore │
                                   │ .longTermMemoryRetriever│
                                   └─────────┬───────────┘
                                             │
                                             ▼
                                   ┌─────────────────────┐
                                   │ SqliteGatewayStores  │
                                   │ (SQLite + FTS5)      │
                                   └─────────┬───────────┘
                                             │
                                             ▼
                                   ┌─────────────────────┐
                                   │ long_term_memory     │
                                   │ (single table)       │
                                   └─────────────────────┘
```
- 上游调用方：面向 model 的 tool 通过由所选 gateway port 支撑的 app 组装 tool adapter；REST maintenance API、extractor、curator、aging 和后续 sharing 工作流通过直接注入的 gateway 公共 port 或其所属 application-service 边界。
- 下游消费方：在 `add-ts-memory-core` 自身内没有。检索结果由 Context Engine（经由 tool 结果而不是直接）、maintainer API 和 aging 决策逻辑消费。
- Owner 边界：gateway port 实现位于 `agent-platform-gateway-local`，由 `SqliteGatewayStores` 管理。消费方直接注入 gateway port。`agent-context-engine` MUST NOT 导入这些 port。

**失败与降级**：
- **配置层禁用 memory**：app composition 选择一个禁用的 memory port/adapter；该被选定 port 上的所有方法返回 `SafeError { code: "LTM_DISABLED", category: UNAVAILABLE, retryable: false }` 且不执行任何操作。`SqliteGatewayStores` MUST NOT 读取原始配置或拥有 memory 启用/禁用 policy。
- **存储 I/O 失败**（DB 连接丢失、磁盘满、查询超时）：gateway port 返回 `SafeError { code: "LTM_STORAGE_UNAVAILABLE", category: UNAVAILABLE, retryable: true }`。不要跨 port 边界抛出原始异常。
- **非法查询参数**（`minConfidence` 超范围、`limit` > 100、非法 `categoryFilter` 值）：返回 `SafeError { code: "LTM_QUERY_INVALID", category: VALIDATION }`。
- **条目未找到**（对不存在 `longTermMemoryId` 或非拥有条目的 `getLongTermMemory` / `getLongTermMemoryDetail`）：返回 `SafeError { code: "LTM_ENTRY_NOT_FOUND", category: NOT_FOUND }`。不要区分“不存在”与“存在但不属于该 scope”。
- **跨 scope 访问**：gateway-local 只强制按 scope 读取，返回空结果集或 `LTM_ENTRY_NOT_FOUND`，不揭示其他 scope 下是否存在记录。带 reason code `LTM_CROSS_SCOPE_ACCESS` 的安全结构化诊断或可观测事件属于可信调用方边界，该边界能在构造 gateway 请求前将不可信请求 scope 与 `IdentityContext` / 所选 Agent Scope 比较。Gateway-local MUST NOT 添加独立 audit writer 或执行宽泛存在性检查来检测跨 scope 归属。
- **非法转换请求**：畸形目标状态、缺失 scope、非保留目标、版本冲突或存储层校验失败返回 `SafeError { code: "LTM_TRANSITION_INVALID", category: VALIDATION }` 或相应的 `VersionedUpdateResult` 状态。Gateway-local MUST NOT 用该错误强制执行业务生命周期 policy，例如当前是否允许 `ACTIVE → ARCHIVED`。
- **非法 confidence 调整**：返回 `SafeError { code: "LTM_CONFIDENCE_INVALID", category: VALIDATION }`。
- **FTS5 引擎不可用**（索引损坏、启动失败）：`searchLongTermMemory` 降级为字面子串匹配 fallback。这是 `SqliteGatewayStores` 的内部实现细节——不在 gateway port contract 中暴露。通过既有可观测性/日志路径发出带 reason code `LTM_FTS_UNAVAILABLE` 和 `degradedMode=literal_match` 的安全结构化诊断或可观测事件；audit 投影可选。后续 `searchLongTermMemory` 调用时自动重试恢复。
- **无静默失败**：每条失败路径 MUST 产生带稳定错误码的显式 `SafeError`、结构化日志条目，或可观测的带警告日志的空响应。

#### Scenario: 跨 session 持久化
- **WHEN** 条目 `E1` 在 session `S1` 中以 `tenantId=T1, subjectId=U1, agentId=A1` 通过 `saveLongTermMemory` 写入
- **AND** session `S1` 在 terminal commit 后终止
- **AND** 新 session `S2` 以相同的 `tenantId=T1, subjectId=U1, agentId=A1` 查询 `listLongTermMemory`
- **THEN** 条目 `E1` 出现在结果中
- **AND** 其 `state` 为 `ACTIVE`，`createdAt` 时间戳被保留，`accessCount = 0`

#### Scenario: Hybrid 评分排序
- **WHEN** 调用 `searchLongTermMemory(queryText="ssh", tenantId=T1, subjectId=U1, agentId=A1)`
- **AND** 3 个条目匹配：`A`（ftsRank=0.9, confidence=0.5, recency=0.1, access=0）、`B`（ftsRank=0.5, confidence=0.9, recency=0.9, access=10）、`C`（ftsRank=0.3, confidence=0.3, recency=0.3, access=0）
- **THEN** 分数计算为 A=0.50、B=0.75、C=0.27
- **AND** 结果顺序为 B → A → C

#### Scenario: searchLongTermMemory 递增 recallCount
- **WHEN** `searchLongTermMemory(queryText="BGP")` 返回 3 个条目
- **THEN** 每个返回条目的 `recallCount` 递增 1
- **AND** 所有条目的 `accessCount` 不变

#### Scenario: getLongTermMemoryDetail 更新 accessCount 和 lastAccessedAt
- **WHEN** `getLongTermMemoryDetail(longTermMemoryId=E1, tenantId=T1, subjectId=U1, agentId=A1)` 成功返回
- **THEN** `E1.accessCount` 递增 1，且 `E1.lastAccessedAt` 在存储记录中更新为当前时间
- **AND** `searchLongTermMemory` 不递增任何条目的 accessCount，也不更新 lastAccessedAt

#### Scenario: 渐进披露 L1 与 L2
- **WHEN** `listLongTermMemory` 或 `searchLongTermMemory` 返回条目
- **THEN** 每个条目只包含 L1 字段：`longTermMemoryId`、`category`、`confidence`、`tags`、`briefIndex`、`createdAt`
- **AND** 结构化内容字段（steps、pitfalls、evidence、definition）不存在
- **WHEN** `getLongTermMemoryDetail(longTermMemoryId=E1, tenantId=T1, subjectId=U1, agentId=A1)` 成功返回
- **THEN** 返回条目包含完整 L2 内容，包括 `FactualMemory.evidence` 或 `ProceduralMemory.steps` 等

#### Scenario: Agent Scope + Owner Scope 隔离
- **WHEN** 调用 `listLongTermMemory(tenantId=T1, subjectId=U1, agentId=A1)`
- **THEN** 只返回满足 `tenant_id = T1 AND subject_id = U1 AND agent_id = A1 AND state = 'ACTIVE'` 的条目
- **AND** 属于 `(T1, U2, A1)`、`(T2, U1, A1)` 或 `(T1, U1, A2)` 的条目被排除

#### Scenario: 状态过滤将 ARCHIVED 排除在搜索之外
- **WHEN** 条目 `E1` 的 `state = ARCHIVED`
- **AND** 调用 `searchLongTermMemory(queryText="keyword")`
- **THEN** 除非查询包含 `sinceTime` 或 `untilTime`，否则不返回 `E1`

#### Scenario: 生命周期列表过滤器支持 aging 扫描
- **WHEN** 调用 `listLongTermMemory(stateFilter="ACTIVE", isPinned=false, maxLastAccessedAt=TS1, tenantId=T1, subjectId=U1, agentId=A1)`
- **THEN** 只返回满足 `state=ACTIVE`、`isPinned=false` 且 `lastAccessedAt <= TS1` 的按 scope 条目
- **WHEN** 调用 `listLongTermMemory(stateFilter="ARCHIVED", isPinned=false, maxArchivedAt=TS2, tenantId=T1, subjectId=U1, agentId=A1)`
- **THEN** 只返回满足 `state=ARCHIVED`、`isPinned=false` 且 `archivedAt <= TS2` 的按 scope 条目
- **AND** 没有调用方需要直接访问 SQLite、FTS5 或私有 gateway-local 来实现 aging 扫描

#### Scenario: Category 列表过滤器支持 extraction 扫描且无召回副作用
- **WHEN** 所属后台 extraction 边界调用 `listLongTermMemory(categoryFilter="FACTUAL", stateFilter="ACTIVE", tenantId=T1, subjectId=U1, agentId=A1, limit=100)`
- **THEN** 只返回按 scope 的 ACTIVE `FACTUAL` L1 项
- **AND** `recallCount`、`accessCount` 和 `lastAccessedAt` MUST NOT 被改变
- **AND** 当 fusion 检查需要 L2 结构化内容时，调用方 MAY 对选定的 id 使用 `getLongTermMemory`

#### Scenario: 授权详情可读取 archived 保留记录
- **WHEN** 条目 `E1` 存在且 `state = ARCHIVED`
- **AND** 同一 owner 和 agent scope 调用 `getLongTermMemoryDetail(longTermMemoryId=E1, tenantId=T1, subjectId=U1, agentId=A1)`
- **THEN** 返回条目包含完整 L2 内容
- **AND** `E1.accessCount` 递增且 `lastAccessedAt` 被更新
- **AND** `E1.state` 保持 `ARCHIVED`，除非所属 aging 或 maintenance helper 另行调用 `transitionLongTermMemoryState(targetState="ACTIVE")`

#### Scenario: saveLongTermMemory 部分更新保留生命周期字段
- **WHEN** 条目 `E1` 存在且 `tags=["network"]`、`confidence=0.5`
- **AND** 以 `(T1, U1, A1)` 调用 `saveLongTermMemory(longTermMemoryId=E1, tags=["ssh"], confidence=0.7)`
- **THEN** 存储条目为 `tags=["ssh"]`、`confidence=0.7`
- **AND** `accessCount`、`createdAt`、`state` 被保留
- **AND** `updatedAt` 更新为当前时间

#### Scenario: 多引用 source trace 被保留
- **WHEN** `saveLongTermMemory` 被调用时 `sourceTrace.refs` 包含两个 session 引用
- **THEN** 重新加载该条目 MUST 返回两个引用
- **AND** 返回的 `sourceTrace` MUST NOT 包含原始 message 内容

#### Scenario: 佐证时追加来源 trace 引用
- **WHEN** 一个既有条目有一个来源引用
- **AND** `saveLongTermMemory` 用新的 extraction 来源引用更新同一条目
- **THEN** 存储条目 MUST 包含两个引用
- **AND** `extractionCount` MUST 递增 1

#### Scenario: 生命周期 owner 请求的按 scope 状态更新
- **WHEN** 调用 `transitionLongTermMemoryState(longTermMemoryId=E1, targetState="ARCHIVED", archiveReason="aging_policy")`
- **AND** E1 存在于同一 `tenantId`/`subjectId`/`agentId` scope 下
- **AND** 可选的 `expectedVersion` 存在时匹配
- **THEN** E1 状态变为 `ARCHIVED`，`archivedAt` 被设置，`archiveReason` 为 "aging_policy"
- **AND** `updatedAt` 被更新，`VersionedUpdateResult.status = "UPDATED"`

#### Scenario: 生命周期 owner 请求的按 scope 复活状态更新
- **WHEN** 调用 `transitionLongTermMemoryState(longTermMemoryId=E1, targetState="ACTIVE")`
- **AND** E1 存在于同一 `tenantId`/`subjectId`/`agentId` scope 下
- **AND** 可选的 `expectedVersion` 存在时匹配
- **THEN** E1 状态变为 `ACTIVE`
- **AND** `updatedAt` 被更新，`VersionedUpdateResult.status = "UPDATED"`

#### Scenario: 带截断的 confidence 调整
- **WHEN** 调用 `adjustLongTermMemoryConfidence(longTermMemoryId=E1, delta=0.3)`
- **AND** E1 当前 confidence 为 0.8
- **THEN** E1 confidence 变为 1.0（截断，而不是拒绝）
- **AND** `updatedAt` 被更新

#### Scenario: 跨 scope 访问返回空
- **WHEN** 调用 `searchLongTermMemory(queryText="any", tenantId=T2, subjectId=U1, agentId=A1)`
- **AND** 可信 gateway scope `(T2, U1, A1)` 下不存在任何行
- **THEN** 结果为空（`entries=[]`、`totalCount=0`）
- **AND** gateway-local 不揭示任何其他 scope 下是否存在匹配记录
- **AND** 如果上游调用方边界在 gateway 调用前检测到不可信请求 scope 与已认证 `IdentityContext` / 所选 Agent Scope 不一致，它通过既有可观测性/audit 边界发出 `LTM_CROSS_SCOPE_ACCESS`
- **AND** gateway-local MUST NOT 为该诊断拥有直接的 audit writer 依赖或执行无 scope 的存在性检查

#### Scenario: confidence 超范围被拒绝
- **WHEN** 以 `confidence = 1.5` 调用 `saveLongTermMemory`
- **THEN** 返回 `SafeError { code: "LTM_WRITE_INVALID", category: VALIDATION, safeDetails: { field: "confidence", value: 1.5, constraint: "[0, 1]" } }`
- **AND** 不写入任何条目

#### Scenario: Category 内容 schema 不匹配被拒绝
- **WHEN** 调用 `saveLongTermMemory(category="PROCEDURAL", content={ category: "FACTUAL", subject: "BGP", claim: "..." })`
- **THEN** 返回 `SafeError { code: "LTM_WRITE_INVALID", category: VALIDATION }`
- **AND** 不写入任何条目
- **WHEN** 调用 `saveLongTermMemory(category="PROCEDURAL", content={ category: "PROCEDURAL", procedureName: "BGP check", steps: [] })`
- **THEN** 返回 `SafeError { code: "LTM_WRITE_INVALID", category: VALIDATION }`
- **AND** 不写入任何条目

#### Scenario: 超过最大页大小被拒绝
- **WHEN** 调用 `searchLongTermMemory(limit=200)`
- **THEN** 返回 `SafeError { code: "LTM_QUERY_INVALID", category: VALIDATION, safeDetails: { field: "limit", value: 200, constraint: "<= 100" } }`

#### Scenario: 删除是物理的且不能复活
- **WHEN** `deleteLongTermMemory(longTermMemoryId=E1, tenantId=T1, subjectId=U1, agentId=A1)` 成功
- **THEN** `E1` 的按 scope memory 行和检索索引条目被物理移除
- **AND** `getLongTermMemory`、`getLongTermMemoryDetail`、`listLongTermMemory` 和 `searchLongTermMemory` MUST NOT 返回 `E1`
- **AND** `transitionLongTermMemoryState(longTermMemoryId=E1, targetState="ACTIVE")` 返回 `LTM_ENTRY_NOT_FOUND`

#### Scenario: 禁用 memory 返回 LTM_DISABLED
- **WHEN** 配置中 `memory.enabled = false`
- **AND** app composition 选择禁用的 memory port/adapter
- **AND** 被选定的 memory port 方法被调用
- **THEN** 被选定的 port 返回 `SafeError { code: "LTM_DISABLED", category: UNAVAILABLE }`
- **AND** 发出带 `eventType=LTM_DISABLED` 的结构化日志
- **AND** 不要求 `SqliteGatewayStores` 读取 memory 配置

#### Scenario: 存储 I/O 失败返回 LTM_STORAGE_UNAVAILABLE
- **WHEN** 调用 `searchLongTermMemory` 且底层 SQLite 连接抛出错误
- **THEN** 返回 `SafeError { code: "LTM_STORAGE_UNAVAILABLE", category: UNAVAILABLE }`
- **AND** 原始异常细节被内部记录，但不暴露在 `SafeError` 中

#### Scenario: 条目未找到或不属于该 scope
- **WHEN** 调用 `getLongTermMemoryDetail(longTermMemoryId="does-not-exist", tenantId=T1, subjectId=U1, agentId=A1)`
- **THEN** 返回 `SafeError { code: "LTM_ENTRY_NOT_FOUND", category: NOT_FOUND }`
- **AND** 响应不揭示该条目是否存在于其他 scope 下

#### Scenario: FTS5 降级 fallback
- **WHEN** 调用 `searchLongTermMemory(queryText="ssh")` 且 FTS5 索引损坏
- **THEN** `SqliteGatewayStores` 内部捕获 FTS5 错误，并发出带 reason code `LTM_FTS_UNAVAILABLE` 和 `degradedMode="literal_match"` 的安全结构化诊断或可观测事件
- **AND** fallback 到针对条目正文和标签的字面子串匹配
- **AND** 仍返回结果（降级，而不是失败）
- **AND** 下一次 `searchLongTermMemory` 调用重新尝试 FTS5（自动重试恢复）

#### Scenario: 架构边界强制
- `agent-context-engine` MUST NOT 导入 `LongTermMemoryStoreGateway` 或 `LongTermMemoryRetrieverGateway`
- `agent-capability` MUST NOT 导入 `LongTermMemoryStoreGateway` 或 `LongTermMemoryRetrieverGateway`
- `agent-runtime` MUST NOT 导入 `LongTermMemoryStoreGateway` 或 `LongTermMemoryRetrieverGateway`
- 本核心 change 交付的本地实现 MUST 直接位于 `agent-platform-gateway-local`，由 `SqliteGatewayStores` 管理，遵循与 session/message/checkpoint store 相同的 gateway-local 拥有模式。它 MUST NOT 要求 `agent-memory` 包装。
- Gateway-local MUST 存储并返回 gateway Record，应用 scope/版本/存储不变量，并执行原子行/索引更新。它 MUST NOT 强制执行 memory 生命周期业务 policy，也不拥有与之竞争的 memory 状态机；生命周期决策属于所属 memory change，例如 aging 或 maintenance。
- 如果后续本地后端 change 引入 `agent-memory` 编排，该编排 MUST NOT 直接访问 SQLite 或 FTS5；它只委托 gateway port。Remote complete-service 后端 MUST NOT 运行相同的本地 `agent-memory` 生命周期编排；本地代码只能适配 contract、注入可信 scope、映射安全错误并发送安全可观测性。
- 后续商业 complete-service adapter MAY 在 `agent-platform-gateway-remote` 中实现同样的面向消费方的 port，并 MUST 只能通过 `agent-app` composition 被选择，与本地后端生命周期编排互斥。
- `LongTermMemoryRecord` MUST `extends OwnerScoped` 并带显式 `agentId: AgentId`
- 所有 Request/Query DTO MUST `extends OwnerScoped` 并带显式 `agentId: AgentId`
- `LongTermMemoryRecord` MUST NOT 包含 `idempotencyKey`；幂等性 MUST 在 `IdempotentWriteOptions` 上
- `SaveLongTermMemoryRequest` MUST NOT 包含 `idempotencyKey`；幂等性 MUST 在 `IdempotentWriteOptions` 上
- `LongTermMemoryRecord` MUST NOT 包含 `isPublished` 或 `forkedFrom`
- `isPinned` 作为可选布尔字段允许出现在 `LongTermMemoryRecord` 上；它持久化在 `long_term_memory.is_pinned` 列中，通过 `toLongTermMemoryRecord` 读取，并通过 `putLtm` 和 `saveLongTermMemory` merge 逻辑写入。



