## 背景与问题（Why）

NextAgent 的长期记忆系统需要统一的数据模型和端口契约，但当前 `add-ts-memory-core` 是唯一的基础依赖——被其他 6 个 memory change（`tools`、`extraction`、`aging`、`configuration`、`maintenance`、`sharing`）共同消费。没有 core，就没有跨模块 DTO、稳定 port 签名、Agent Scope + Owner Scope 隔离规则和 graceful degradation 契约。

本 change 解决：

- 跨会话知识持久化的统一数据模型（`LongTermMemoryRecord`、Bloom 4 分类结构化 content）
- 两个独立 gateway port——`LongTermMemoryStoreGateway`（CRUD + lifecycle mutation）和 `LongTermMemoryRetrieverGateway`（检索 + 混合排序）
- 生命周期只通过 `ACTIVE / ARCHIVED` 状态表达可保留记录；删除语义为物理删除，不引入 `DELETED` 软删除状态；core gateway 只提供 scoped atomic state update primitive，不拥有业务 lifecycle state machine
- 渐进披露 L1/L2（检索/列表不暴露完整结构化内容）
- Agent Scope + Owner Scope 隔离（`tenantId` + `subjectId` 来自 trusted IdentityContext，`agentId` 来自可信 app composition 或已持久化 session/run）
- 所有失败路径的显式 SafeError（`LTM_*` 稳定错误码）
- memory 禁用 / FTS5 等降级路径

## 变更范围（What Changes）

- **新增** `agent-common` branded type `LongTermMemoryId` 和 enum `MemoryCategory`、`LongTermMemoryState`
- **新增** `agent-contracts/gateway` subpath 中的 `LongTermMemoryRecord` 及 Request/Query DTO，遵循 `OwnerScoped` + `agentId` 三元 scope 模式
- **新增/扩展** `MemorySourceTrace` 和 `MemorySourceTraceRef`，支持跨会话提取融合时保留 `runId`、`messageRefs` 和多来源 `refs`
- **新增** `agent-contracts/gateway` subpath 中的 `LongTermMemoryStoreGateway` 和 `LongTermMemoryRetrieverGateway` port 签名
- **新增** `agent-platform-gateway-local` 中 `LocalGatewayStores` 的 `longTermMemoryStore` 和 `longTermMemoryRetriever` 属性，SQLite 实现（含 FTS5）由 `SqliteGatewayStores` 统一管理
- **更新** memory 相关架构边界：本 core change 参考 session gateway 机制，local store/retriever 直接由 `agent-platform-gateway-local` 实现并由 `agent-app` 装配；本 core change 不新增 `agent-memory` wrapper，也不要求修改 `agent-memory` 依赖 allowlist。local memory backend 下，后续 change 若需要 extraction/aging/maintenance/sharing 业务编排，可在 `agent-memory` 对应 submodule 中实现，但该业务编排只能消费 `agent-common` 和 `agent-contracts/gateway`，不得直接访问 SQLite 或 FTS5；memory tools provider/factory 的依赖边界由 `add-ts-memory-tools` 单独定义。remote complete-service backend 下，远端长期记忆服务拥有 memory lifecycle，本地不得重复执行同一业务编排。

## 核心实现策略（Current Strategy To Freeze）

冻结以下黑盒策略：

- 两个独立 gateway port：`LongTermMemoryStoreGateway`（`getLongTermMemory` / `saveLongTermMemory` / `deleteLongTermMemory` / `listLongTermMemory` / `transitionLongTermMemoryState` / `adjustLongTermMemoryConfidence` / `markLongTermMemoryAccessed`）和 `LongTermMemoryRetrieverGateway`（`searchLongTermMemory` / `getLongTermMemoryDetail`），定义在 `agent-contracts/gateway`；本 core change 交付 `agent-platform-gateway-local` 的 SQLite/FTS5 实现。gateway-local 对 state/confidence/access 只做 scoped mutation、CAS/version 和 row/index update，不判断业务状态迁移是否合法。后续 remote complete-service adapter 可在 `agent-platform-gateway-remote` 实现同一 consumer-facing ports，并由 `agent-app` composition 与 local backend 互斥选择；remote 模式下本地不得再启动 `agent-memory` 的长期记忆生命周期编排
- 生命周期通过单表 `state` 字段（ACTIVE / ARCHIVED）管理；显式遗忘和 retention delete 通过 `deleteLongTermMemory` 物理删除记录
- Bloom 分类固定 4 种（FACTUAL / CONCEPTUAL / PROCEDURAL / USER_CHARACTERISTICS），并在 core contract 中定义最小可实施 structured content schema；其他 change 只引用该 schema，不重复定义 memory content DTO
- `listLongTermMemory` 暴露 lifecycle 必需的 public filters（`stateFilter`、`isPinned`、`maxLastAccessedAt`、`maxArchivedAt`），避免 aging 绕过 gateway public boundary 私查底层数据库
- 混合排序公式 `0.4×fts + 0.3×conf + 0.2×recency + 0.1×access` 是 `LongTermMemoryRetrieverGateway.searchLongTermMemory()` 的 port contract
- `getLongTermMemoryDetail` 每次调用递增 `accessCount` 并更新 `lastAccessedAt`；授权详情访问可以读取 retained `ACTIVE` 或 `ARCHIVED` record，但 core 不执行 revival；`searchLongTermMemory` 对每条返回 entry 递增 `recallCount`，但不递增 `accessCount` 或更新 `lastAccessedAt`
- gateway-local 对所有读取强制三元 scope 过滤；不匹配 scope 的读取返回空结果或 not-found，不区分"不存在"和"不属于"（信息泄露预防）。`LTM_CROSS_SCOPE_ACCESS` 诊断由能同时看到不可信请求和 trusted `IdentityContext` / Agent Scope 的上游边界发出，不由 gateway-local 反查或推断。
- 所有 port 操作在 request terminal-commit 关键路径之外，memory 生命周期失败不破坏 terminal commit
- 所有 Record/Request DTO 遵循 `OwnerScoped` + `agentId` 三元 scope 模式（对齐存量 gateway contract pattern）
- `longTermMemoryId` 由 store 在首次 `saveLongTermMemory` 时自动生成（UUID v7 或等价 time-ordered unique identifier）
- `sourceTrace` 保留 primary `sessionId`/`requestId` 兼容语义，同时支持多来源 safe refs；更新已有 entry 时保留旧 refs、追加新 refs，并在新增 extraction refs 时递增 `extractionCount`
- state/confidence/access mutation 通过 `LongTermMemoryStoreGateway` 上的独立方法操作，不通过 `saveLongTermMemory` 的 partial-update 绕过 scoped mutation / CAS / audit 接入点；业务 lifecycle 合法性由 aging / maintenance 等 owning change 判定；mutation 请求支持 `expectedVersion` 乐观并发控制
- FTS5 是 `SqliteGatewayStores` 内部实现细节，不暴露 FTS5 DTO 或 FTS5 状态到 gateway port contract
- 本 core change 不新增 `agent-memory` wrapper；与 session store 一样，local backend 的 store/retriever port 由 gateway-local 直接实现，`agent-app` 将 `LongTermMemoryStoreGateway` / `LongTermMemoryRetrieverGateway` 注入需要的消费者。local backend 下，后续 change 若在 `agent-memory` 中实现 extraction/aging/maintenance/sharing 业务编排，也只能消费 `agent-common` 和 `agent-contracts/gateway`，不得绕过到 gateway-local、SQLite 或 FTS5；memory tools provider/factory 不是 core store/retriever wrapper，其依赖由 tools change 约束。remote complete-service backend 下，`agent-memory` 不拥有 extraction/aging/maintenance/sharing 状态机，只能作为薄 facade 做 contract 适配、scope 注入、SafeError mapping 和 observability，且不得重复执行远端已拥有的业务决策。

## Capability 影响（Capabilities）

### 新增的 Capability

- `agent-contracts/gateway` memory store/retriever port 签名
- `agent-common` memory branded type 和 enum

### 与相邻 changes 的边界

- 本 change 负责数据模型（`LongTermMemoryRecord`）、gateway port 签名（`LongTermMemoryStoreGateway` / `LongTermMemoryRetrieverGateway`）、Agent Scope + Owner Scope、graceful degradation 和 scoped mutation 契约；不负责业务 lifecycle state machine
- `add-ts-memory-tools` 在此基础上实现 3 个 model-facing 工具（`search_memory`、`get_memory_detail`、`add_memory`），通过 `agent-app` composition 提供的最小 `LongTermMemoryToolPort` 访问 selected memory backend；该 tool port 只适配 3 个工具实际需要的 search/detail/save 方法，tool implementation 不直接导入 memory gateway ports。`saveLongTermMemory` 的 partial update、`deleteLongTermMemory` 的 physical delete 等底层能力仍由 maintenance、aging、user-management 或 future approved changes 通过自身边界消费，不作为首版 model-facing tools 暴露，也不得进入 `LongTermMemoryToolPort`
- `add-ts-memory-extraction` 通过 `store.saveLongTermMemory` 写入提取结果
- `add-ts-memory-aging` 通过 memory gateway port 调用 scoped mutation 方法，并自行拥有 aging lifecycle decision；core Record 仅提供跨策略共享的 `isPinned` 持久字段，pin 业务语义由 aging / maintenance 定义
- `add-ts-memory-configuration` 消费本 change 提供的 disabled/search/default 语义并冻结 `MemoryConfig`；不覆盖 `MemoryCategory` / `LongTermMemoryState` 的业务语义
- Context Engine 只消费 retrieval results（工具返回），不直接导入 memory gateway port

## 影响范围（Impact）

- `agent-common` 新增 `LongTermMemoryId` branded type、`MemoryCategory` / `LongTermMemoryState` enum
- `agent-contracts/gateway` 新增 memory Record/Request DTO 和 port 签名
- `agent-contracts/gateway` 新增 `MemorySourceTraceRef`，并扩展 `MemorySourceTrace` 的多来源引用能力
- `agent-memory` 不在本 core change 中新增 wrapper，也不是 local store/retriever 的必经层；local backend 的后续 memory 编排若进入 `agent-memory`，必须只通过 gateway port 消费 core 契约；remote complete-service backend 下本地 `agent-memory` 不执行同一 memory lifecycle 编排
- `agent-platform-gateway-local` 新增 `LongTermMemoryStoreGateway` / `LongTermMemoryRetrieverGateway` 实现，SQLite 表 + FTS5 虚拟表由 `SqliteGatewayStores.initialize()` 统一创建
- `LocalGatewayStores` 新增 `longTermMemoryStore` 和 `longTermMemoryRetriever` 属性
- 商用远端记忆服务可由后续 adapter change 在 `agent-platform-gateway-remote` 实现同一 gateway ports，并由 `agent-app` composition 与 local backend 互斥选择；不修改本 change 定义的 memory contracts
- `agent-context-engine` / `agent-capability` / `agent-runtime` 不得导入 memory gateway port
- contract tests 验证 DTO 序列化、Agent Scope + Owner scope 隔离、混合排序公式、state 过滤、scoped mutation boundary

## 非目标（Non-Goals）

- 不定义具体模型工具（由 `add-ts-memory-tools` 负责）
- 不定义提取算法或老化策略（由 `add-ts-memory-extraction` / `add-ts-memory-aging` 负责）
- 不定义 REST API 或 Web UI（由 `add-ts-memory-maintenance` 负责）
- 不定义知识共享协作模型（由 `add-ts-memory-sharing` 负责）
- 不定义配置 namespace（由 `add-ts-memory-configuration` 负责）
- 不定义 publish / fork 等 sharing 字段；`isPinned` 仅作为 core 共享持久字段存在，pin 业务语义由 `add-ts-memory-aging` / `add-ts-memory-maintenance` 负责
- 不暴露 FTS5 实现细节到 gateway port contract

## 归档基线说明（Archive Baseline Notes）

- `openspec/specs/ts-core-contracts/spec.md` — port 接口定义在 `agent-contracts/gateway` subpath
- `openspec/specs/ts-backend-architecture/spec.md` — `agent-platform-gateway-local` 持久化边界、`agent-app` composition 边界，以及后续 local `agent-memory` 业务编排边界
- `openspec/designs/contracts/core-contracts.md` — 遵循 contract-first 原则
- `openspec/designs/modules/agent-platform-gateway-local.md` — 持久化统一管理职责，直接实现 local long-term memory store/retriever ports
- `openspec/designs/modules/agent-memory.md` — 后续 local backend 业务编排职责（不持有 SQLite/FTS5；remote complete-service backend 下不得重复远端生命周期编排）



