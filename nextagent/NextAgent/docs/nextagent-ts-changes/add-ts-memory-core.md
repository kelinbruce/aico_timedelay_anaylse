# add-ts-memory-core

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：扩展候选 / Long-term memory

状态：candidate
类型：扩展候选 change
主要 owner：Owner 12 Memory / Learning
依赖：无（首个 memory change）

目标：
- 定义所有 memory change 共享的核心 DTO、存储/检索端口、owner scope 隔离契约和 graceful degradation 行为。
- 作为其他 6 个 memory change 的依赖基础。

规格输入：

- `LongTermMemoryEntry` DTO 包含以下字段：`entryId`（新条目由 core 自动生成 UUID v7）、`ownerSubjectId`、`tenantId`、`category`（FACTUAL/CONCEPTUAL/PROCEDURAL/USER_CHARACTERISTICS）、`state`（ACTIVE/ARCHIVED/DELETED）、`content`（按 category 类型结构化）、`confidence`[0,1]、`tags[]`、`briefIndex?`、`accessCount`、`isPinned`、`isPublished`、`forkedFrom?`、`createdAt`、`updatedAt`、`lastAccessedAt`、`promotedAt?`、`archivedAt?`、`archiveReason?`
- Bloom 分类结构化内容：
  - FactualMemory：subject、predicate、object、sourceTrace（sessionId、requestId）、evidence[]
  - ConceptualMemory：conceptName、definition、domainContext、examples[]、relatedConcepts[]
  - ProceduralMemory：procedureName、steps[]、pitfalls[]（symptom + rootCause + workaround）、verification[]
  - UserCharacteristics：traitName、traitValue、evidenceCount、firstObservedAt、lastObservedAt、isDriftProtected
- 渐进披露两个级别：
  - L1（列表/搜索）：entryId、category、confidence、tags、briefIndex、createdAt
  - L2（详情）：全部字段含结构化内容
- `LongTermMemoryQuery`：queryText?、categoryFilter?、minConfidence?、sinceTime?、untilTime?、maxLastAccessedAt?、limit（默认 20，最大 100）、offset
- `LongTermMemorySearchResult`：entries[]（L1）、totalCount、每个 entry 带 hybridScore
- `LongTermMemoryStore` port：get(entryId, ownerScope)、put(entry)、delete(entryId, ownerScope)、list(query, ownerScope)。负责原始 CRUD，不涉及排序/排名逻辑。`put` 新条目时 core 自动生成 `entryId`（UUID v7）；更新时 caller 提供已有 `entryId`。
- `LongTermMemoryRetriever` port：search(query, ownerScope)、getDetail(entryId, ownerScope)。负责检索和混合排序，可包含检索前后的预处理/后处理逻辑（如查询改写、结果重排）。`getDetail` 递增 `accessCount`；`search` 无副作用。
- LongTermMemoryRetriever 的 `search` 方法 MUST 按以下混合公式排序：`0.4*ftsRank + 0.3*confidence + 0.2*recency + 0.1*accessCount`，该公式是 port contract 的一部分，调用方依赖此排序语义。
- 所有 memory 操作 MUST 携带 `tenantId` + `subjectId`，由可信身份边界注入
- 模型/工具参数 MUST NOT 接受 owner scope 字段
- 跨租户访问 MUST 返回空结果而非错误
- memory 禁用时所有检索/写入 MUST 返回 typed safe error 并 log "Long-term memory disabled"
- `MemoryState` enum：ACTIVE、ARCHIVED、DELETED。三态全部通过 `state` 字段存储在 `long_term_memory` 同一张表中，不做物理搬迁到独立归档表。`search`/`list` 默认只返回 `state=ACTIVE` 的条目，`state=ARCHIVED` 的条目仅通过显式 time-range 查询可检索。
- `MemoryCategory` enum 固定为四种：FACTUAL、CONCEPTUAL、PROCEDURAL、USER_CHARACTERISTICS，后续不新增分类。新增分类需要修改核心 DTO 并评估对已有工具的兼容性影响。

契约输入：
- `LongTermMemoryEntry`、`MemoryCategory` enum（固定 4 种值）、`MemoryState` enum（ACTIVE/ARCHIVED/DELETED）
- `LongTermMemoryQuery`、`LongTermMemorySearchResult`（含 `hybridScore` 字段）、`LongTermMemoryWriteRequest`
- `LongTermMemoryStore` port interface（get / put / delete / list）
- `LongTermMemoryRetriever` port interface（search 含混合排序公式契约、getDetail）
- `ProgressiveDisclosureLevel` enum（L1、L2）
- `MemoryDisabledError` / graceful degradation 结果类型

实现约束：
- owner scope 必须来自可信身份边界，不信任客户端或模型输入
- 跨租户返回空而非错误，避免信息泄露
- memory 禁用降级路径必须返回 typed safe error，不抛异常
- `LongTermMemoryStore` 和 `LongTermMemoryRetriever` port 实现由 `agent-memory` 包提供，不泄漏到 `agent-context-engine` 或 `agent-capability-builtins`
- FTS5 或等效全文检索引擎是 TS 首版推荐实现方案
- `state=ARCHIVED` 和 `state=DELETED` 的条目与 `state=ACTIVE` 在同一张表中，查询时通过 `state` 字段过滤，不做物理表分离
- Bloom 分类固定四种，不预留通用扩展点；新增分类需修改 LongTermMemoryEntry content 联合类型定义

非目标：
- NOT 定义具体模型工具（search/detail/add/update/forget/get_user_context）
- NOT 定义提取算法或老化策略
- NOT 定义 REST API 或 Web UI
- NOT 定义知识共享协作模型
- NOT 定义配置 namespace 或覆盖路径

验收要点：
- Contract test：LongTermMemoryEntry 各 category 序列化/反序列化
- Contract test：LongTermMemoryQuery 默认值和边界校验
- Contract test：owner scope 过滤正确性（跨租户空、同租户有结果）
- Contract test：LongTermMemoryRetriever.search 的混合排序公式验证（各维度权重正确性）
- Contract test：list 和 search 默认只返回 state=ACTIVE，time-range 查询可返回 ARCHIVED
- Integration：memory 禁用降级路径返回 typed safe error
- Architecture gate：MemoryStore/LongTermMemoryRetriever port 不可从 agent-context-engine 或 agent-capability-builtins 导入

并行边界：
- 不得修改核心契约（session、message、request、run、identity）
- 不得引入从 agent-context-engine 到 agent-memory 的依赖方向
- 不得定义 platform endpoint 或 prompt render 细节
