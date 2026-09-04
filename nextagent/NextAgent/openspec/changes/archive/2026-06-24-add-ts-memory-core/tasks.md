## 1. 契约落地

- [x] 1.1 在 `agent-common` 中定义 `LongTermMemoryId` branded type（`Brand<string, "LongTermMemoryId">`）
- [x] 1.2 在 `agent-common` 中定义 `MemoryCategory` enum（固定 4 种）和 `LongTermMemoryState` enum（`ACTIVE` / `ARCHIVED`）
- [x] 1.3 在 `agent-contracts/gateway` 中定义 `LongTermMemoryRecord` DTO（`extends OwnerScoped` + `agentId: AgentId` + `longTermMemoryId: LongTermMemoryId` + `version: number`）及 Bloom 4 类结构化 content 类型：`FACTUAL(subject, claim, evidence?, qualifiers?)`、`CONCEPTUAL(concept, definition, aliases?, relatedConcepts?)`、`PROCEDURAL(procedureName, non-empty steps, preconditions?, verification?, pitfalls?)`、`USER_CHARACTERISTICS(non-empty traits, non-empty purpose[])`
- [x] 1.4 在 `agent-contracts/gateway` 中定义 CRUD Request DTO：`SaveLongTermMemoryRequest`、`GetLongTermMemoryRequest`、`ListLongTermMemoryQuery`、`DeleteLongTermMemoryRequest`、`BatchLongTermMemoryRequest`、`CountLongTermMemoryQuery`；`ListLongTermMemoryQuery` 必须支持 `categoryFilter`、`stateFilter`、`isPinned`、`minConfidence`、`sinceTime`、`untilTime`、`maxLastAccessedAt`、`maxArchivedAt` 以服务 aging scan 和 extraction scan；`DeleteLongTermMemoryRequest` 不得包含 `archiveReason`；`saveLongTermMemory` 的幂等写入控制通过 `IdempotentWriteOptions` 表达，不放入 Request DTO 或 Record
- [x] 1.5 在 `agent-contracts/gateway` 中定义检索 Request/Query DTO：`SearchLongTermMemoryQuery`、`GetLongTermMemoryDetailRequest`、`LongTermMemoryListItem`、`LongTermMemorySearchEntry`、`LongTermMemorySearchResult`
- [x] 1.6 在 `agent-contracts/gateway` 中定义 lifecycle mutation Request DTO：`TransitionLongTermMemoryStateRequest`、`AdjustLongTermMemoryConfidenceRequest`、`MarkLongTermMemoryAccessedRequest`（均含 `expectedVersion`）
- [x] 1.7 在 `agent-contracts/gateway` 中定义 `LongTermMemoryStoreGateway` port 签名（`getLongTermMemory`、`saveLongTermMemory`、`deleteLongTermMemory`、`listLongTermMemory`、`batchLongTermMemory`、`countLongTermMemory`、`transitionLongTermMemoryState`、`adjustLongTermMemoryConfidence`、`markLongTermMemoryAccessed`）
- [x] 1.8 在 `agent-contracts/gateway` 中定义 `LongTermMemoryRetrieverGateway` port 签名（`searchLongTermMemory`、`getLongTermMemoryDetail`）
- [x] 1.9 扩展 gateway `MemorySourceTrace`，新增 repeatable safe refs，并定义 `MemorySourceTraceRef`

## 2. Gateway 实现

- [x] 2.1 在 `agent-platform-gateway-local` 的 `LocalGatewayStores` 新增 `longTermMemoryStore` 和 `longTermMemoryRetriever` 属性
- [x] 2.2 在 `SqliteGatewayStores.initialize()` 中增量创建 `long_term_memory` 表，使用 `long_term_memory_id` 作为长期记忆主键列
- [x] 2.3 在 `SqliteGatewayStores.initialize()` 中增量创建 FTS5 虚拟表 `long_term_memory_fts`
- [x] 2.4 `SqliteGatewayStores` 实现 `LongTermMemoryStoreGateway` port（9 个方法）
- [x] 2.5 `SqliteGatewayStores` 实现 `LongTermMemoryRetrieverGateway` port（2 个方法）
- [x] 2.6 实现 scoped storage mutation 方法：`transitionLongTermMemoryState`（仅校验 target enum、scope、expectedVersion 和 retained-record existence，不执行业务前驱状态机）、`adjustLongTermMemoryConfidence`（clamp）、`markLongTermMemoryAccessed`；删除通过 `deleteLongTermMemory` 物理删除记录
- [x] 2.7 实现 L1 / L2 progressive disclosure 投影；`getLongTermMemoryDetail` 可读取同 scope retained `ACTIVE` 或 `ARCHIVED` record，但不负责 revival state transition
- [x] 2.8 实现 telemetry 计数：`getLongTermMemoryDetail` 递增 `accessCount` + 更新 `lastAccessedAt`；`searchLongTermMemory` 递增 `recallCount`
- [x] 2.9 实现 `longTermMemoryId` 自动生成（UUID v7 或等价 time-ordered unique identifier）
- [x] 2.10 实现 `batchLongTermMemory`：逐条独立执行，单条失败不中断
- [x] 2.11 实现 `countLongTermMemory`：scope 隔离计数
- [x] 2.12 持久化完整 `sourceTrace` JSON，同时保留 primary trace scalar columns；更新已有 memory 时合并 source refs，并在新增 extraction refs 时递增 `extractionCount`

## 3. 三元 scope 隔离与安全

- [x] 3.1 所有 port 方法强制 `WHERE tenant_id = ? AND subject_id = ? AND agent_id = ?` 三元过滤
- [x] 3.2 跨 scope / scope miss 访问由 gateway-local 返回空结果或 `LTM_ENTRY_NOT_FOUND` 且不泄露其他 scope 是否存在；`LTM_CROSS_SCOPE_ACCESS` safe diagnostic / observable event 归属能比较不可信请求与 trusted `IdentityContext` / Agent Scope 的上游边界，gateway-local 不做 unscoped 反查、不注入独立 audit writer
- [x] 3.3 `getLongTermMemory` / `getLongTermMemoryDetail` 不区分不存在与不属于，统一返回 `LTM_ENTRY_NOT_FOUND`
- [x] 3.4 identity 来自 trusted boundary（`IdentityContext`），agentId 来自可信 app composition 或已持久化 session/run

## 4. Graceful degradation

- [x] 4.1 core 提供 disabled memory port / adapter，selected memory port 方法返回 `LTM_DISABLED`；`SqliteGatewayStores` 不读取 raw config（`memory.enabled=false` 到 selected disabled port 的 app composition 配置入口与 disabled-path 验证由 `add-ts-memory-configuration` 负责）
- [x] 4.2 FTS5 不可用时 `SqliteGatewayStores` 内部降级为 literal substring match
- [x] 4.3 存储 I/O 故障时返回 `LTM_STORAGE_UNAVAILABLE`，不抛 raw exception 跨 port 边界
- [x] 4.4 参数校验不通过时返回对应的 SafeError

## 5. 验证

- [x] 5.1 Contract test：`LongTermMemoryRecord` 各 category 序列化/反序列化，以及 category 与 content discriminator 不匹配、`PROCEDURAL.steps=[]`、`USER_CHARACTERISTICS.traits=[]` / `purpose=[]` 被拒绝
- [x] 5.2 Contract test：query 默认值和边界校验，包括 `stateFilter` 默认 ACTIVE、`categoryFilter`、`isPinned`、`minConfidence`、`sinceTime`、`untilTime`、`maxLastAccessedAt`、`maxArchivedAt` aging/extraction scan filters，并验证 list scan 不改变 `recallCount`、`accessCount` 或 `lastAccessedAt`
- [x] 5.3 Contract test：三元 scope 过滤正确性
- [x] 5.4 Contract test：`searchLongTermMemory` 混合排序公式正确性
- [x] 5.5 Contract test：`batchLongTermMemory` 部分失败 + `countLongTermMemory` scope 隔离
- [x] 5.6 Architecture gate：`agent-context-engine` / `agent-capability` / `agent-runtime` 不可导入 memory gateway port
- [x] 5.7 Architecture gate：core local store/retriever 参考 session 机制直接由 `agent-platform-gateway-local` 实现，不新增 `agent-memory` wrapper；gateway-local 不拥有 memory lifecycle business policy 或竞争性状态机；后续 local backend 业务编排若进入 `agent-memory`，由对应 owning change 单独验证其 submodule 依赖边界；memory tools provider/factory 的 public Tool SPI 依赖由 `add-ts-memory-tools` 验证，不属于 core store/retriever 路径
- [x] 5.8 Contract test：multi-ref `sourceTrace` 序列化/反序列化、refs append merge、`extractionCount` 单次递增
- [x] 5.9 运行 `openspec validate add-ts-memory-core --strict`
- [x] 5.10 运行 `npm run lint:architecture` 验证依赖方向

## 6. 明确移出 core 的范围

- [x] 6.1 `LongTermMemorySharingGateway`、sharing Request/Result DTO、published state、fork relationship 和 sharing audit 由 `add-ts-memory-sharing` 定义与实现
- [x] 6.2 core 不创建 `long_term_memory_published` 或 `long_term_memory_sharing_audit` 表

