## 背景和现状（Context）

本设计只收敛一件事：**长期记忆的数据模型和 gateway 端口契约**。

它不回答模型工具实现、提取算法、老化策略、REST API 或知识共享，只定义所有其他 memory change 依赖的基础 Record / gateway port / enum / error 和 isolation 规则。

已确认的关键决策（来自探索讨论）：

- **D1**：两个独立 gateway port（`LongTermMemoryStoreGateway` + `LongTermMemoryRetrieverGateway`），定义在 `agent-contracts/gateway`。
- **D2**：保留态通过单表 `state` 字段管理（ACTIVE / ARCHIVED），删除通过物理删除完成，不做软删除状态。
- **D3**：混合排序公式 `0.4×fts + 0.3×conf + 0.2×recency + 0.1×access` 是 port contract，定义在 core 而非 tools。
- **D4**：Bloom 分类固定 4 种，不扩展。
- **D5**：所有 Record/Request DTO 遵循 `OwnerScoped` + `agentId` 三元 scope 模式，对齐存量 gateway contract pattern。
- **D6**：本 core change 的 local gateway port 实现参考 session store 机制，由 `agent-platform-gateway-local` 的 `SqliteGatewayStores` 直接实现并统一管理（含 FTS5），不经过 `agent-memory` wrapper；商用远端完整长期记忆服务可由后续 adapter change 在 `agent-platform-gateway-remote` 实现同一 consumer-facing ports，并由 `agent-app` composition 与 local backend 互斥选择。local backend 下，`agent-memory` 只在后续 extraction/aging/maintenance/sharing 等 change 需要业务编排时出现；remote complete-service backend 下，远端服务拥有 memory lifecycle，本地 `agent-memory` 不得重复执行。
- **D7**：Retained state / confidence / access storage mutation 通过 `LongTermMemoryStoreGateway` 上的独立方法操作，不通过 `saveLongTermMemory` partial-update 绕过 storage invariants；具体业务 lifecycle 决策由 aging / maintenance 等 owning change 负责，gateway-local 不承载状态机策略。
- **D8**：FTS5 是 `SqliteGatewayStores` 内部实现细节，不暴露 FTS5 DTO 或 FTS5 状态到 gateway port contract。
- **D9**：方法命名带 `LongTermMemory` 前缀（如 `saveLongTermMemory`），即使只看方法名也能明确操作对象是长期记忆；Request/Query DTO 命名带 `LongTermMemory` 前缀。
- **D10**：按照 session/local gateway 的架构惯例，core 的 local store/retriever 直接通过 gateway port 注入，不需要 core-level `MemoryService` 或 `agent-memory` wrapper。local backend 的后续 owning change 可以定义 application-level orchestration helper，但不得替代、扩展或重新导出 core gateway port contract；remote complete-service backend 下这些 helper 必须禁用或退化为薄 facade，避免双 owner。
- **D11**：`longTermMemoryId` 由 gateway 在首次写入时生成；重复创建防护使用 `saveLongTermMemory(request, IdempotentWriteOptions)` 的写入 metadata，不把 `idempotencyKey` 放进 Request DTO 或 Record。
- **D12**：`MemorySourceTrace` 采用向后兼容的多来源扩展：primary `sessionId` / `requestId` 继续可用，`runId` / `messageRefs` / `refs` 用于跨会话 extraction corroboration。`refs` 只包含 durable scalar ref，不包含原始消息、模型输出、prompt、路径、凭据、附件内容或 raw trait 值。

### 存量代码基线

本次 change 实施前，相关模块的状态：

- `agent-memory/src/index.ts`：当前是空壳（`export {}`），零实现；本 core change 不要求修改该 package
- `agent-common/src/index.ts`：无 `LongTermMemoryId`、`MemoryCategory`、`LongTermMemoryState`
- `agent-contracts/src/gateway/index.ts`：无 memory 相关 Record/Request/Port 类型
- `agent-contracts/package.json`：无 `./memory` subpath export
- `agent-platform-gateway-local/src/stores/local-gateway-stores.ts`：`LocalGatewayStores` 有 7 个属性（`requestRuns` / `sessions` / `messages` / `activeContext` / `timeline` / `checkpoints` / `gatewayKind`），无 memory 属性
- `agent-platform-gateway-local/src/db/sqlite-gateway-stores.ts`：`initialize()` 创建 7 张 SQLite 表，无 `long_term_memory` 表，无 FTS5 虚拟表
- `agent-app` composition root 不注入 memory 相关组件
- architecture test `workspace.test.ts`：`contractSubpathAllowlist["agent-memory"]` 当前为 `[]`

### 增量实施路径

本 change 基于上述存量代码做最小增量：

1. `agent-common/src/index.ts`：增量添加 4 个 type/enum（对齐已有 `SessionMessageRole`、`RunStatus` 模式）
2. `agent-contracts/src/gateway/index.ts`：增量添加 memory Record/Request/Port 类型（对齐已有 `SessionRecord`、`SessionStoreGateway` 模式）
3. `agent-platform-gateway-local/src/stores/local-gateway-stores.ts`：`LocalGatewayStores` 增量添加 `longTermMemoryStore` 和 `longTermMemoryRetriever` 属性
4. `agent-platform-gateway-local/src/db/sqlite-gateway-stores.ts`：`initialize()` 增量添加 `long_term_memory` 表和 `long_term_memory_fts` FTS5 虚拟表；`SqliteGatewayStores` 直接实现新增的两个 port
5. `agent-app` composition root：`create-app.ts` 中从 `gateway` 解构出 `longTermMemoryStore` 和 `longTermMemoryRetriever`，注入到需要 memory 的组件
6. 后续 local backend memory 编排若进入 `agent-memory`，由对应 owning change 再调整 architecture allowlist；本 core change 不提前放开该依赖。

不修改的边界：`agent-context-engine`、`agent-capability`、`agent-runtime` 不导入 memory port；`agent-session` 不参与 memory 生命周期。

## 目标和非目标（Goals / Non-Goals）

### 目标

- 定义 `agent-common` 中的 `LongTermMemoryId` branded type 和 `MemoryCategory`、`LongTermMemoryState` enum
- 定义 `agent-contracts/gateway` 中的完整 Record/Request DTO 和 gateway port 签名
- 定义 Agent Scope + Owner Scope 隔离规则和 graceful degradation 契约
- 定义 `LongTermMemoryStoreGateway` 和 `LongTermMemoryRetrieverGateway` 两个 gateway port 的调用语义
- 定义 `LongTermMemoryStoreGateway` 的 scoped mutation boundary
- 在 `agent-platform-gateway-local` 的 `LocalGatewayStores` 中新增 `longTermMemoryStore` 和 `longTermMemoryRetriever` 属性

### 非目标

- 不定义模型工具、提取算法、老化策略、REST API、知识共享模型、配置 namespace
- 不定义 publish / fork 等 sharing 字段；`isPinned` 仅作为 core 共享持久字段存在，pin 业务语义由 aging / maintenance 定义
- 不暴露 FTS5 实现细节到 gateway port contract

## 选定方案（Chosen Design）

### 1. 触发机制：无主动触发

Memory gateway port 操作由上游（模型工具、REST API、extractor、curator、后续 sharing change）同步或异步调用。所有调用在 request terminal-commit 关键路径之外。Memory lifecycle 失败不破坏 terminal commit。

### 2. 输入与前置条件

所有 port 方法 MUST 接收包含 `tenantId`、`subjectId` 和 `agentId` 的 Request/Query DTO。`tenantId` 和 `subjectId` 来自 trusted identity boundary（`IdentityContext`），`agentId` 来自可信 app composition 或已持久化 session/run。

写操作（`saveLongTermMemory`）前置条件：
- `category` 为 `MemoryCategory` 合法值
- `content` 匹配 category schema
- `confidence ∈ [0, 1]`
- 首次写入时 `longTermMemoryId` 由 gateway 自动生成（UUID v7）

读操作前置条件：
- `tenantId` / `subjectId` / `agentId` 非空
- `minConfidence` 缺省 0.3

Storage mutation 前置条件：
- `transitionLongTermMemoryState`：请求 MUST 包含目标 state；调用方所属 lifecycle boundary MUST 已经判定该业务状态转换允许，gateway 只校验 scope、target enum、`expectedVersion` 和 retained-record existence
- `adjustLongTermMemoryConfidence`：请求 MUST 包含 `delta`，结果 MUST 保持在 `[0, 1]`
- `markLongTermMemoryAccessed`：请求 MUST 包含 `accessedAt`

### 3. 核心判断顺序

```
caller 通过 app-composed selected memory port 传入 (tenantId, subjectId, agentId, operation, params)
│
├─[1] tenantId/subjectId/agentId 为空？ → LTM_AUTH_MISSING
├─[2] app composition 选择 disabled memory port？ → LTM_DISABLED
├─[3] 读：WHERE tenant_id=? AND subject_id=? AND agent_id=? 强制过滤
│       scope miss → 空结果 / not-found；LTM_CROSS_SCOPE_ACCESS 由上游 trusted boundary 发出
├─[4] list：默认 WHERE state='ACTIVE'；可按 state/isPinned/lastAccessedAt/archivedAt 过滤
│       search：默认只返回 state='ACTIVE'；sinceTime/untilTime → 可含 state='ARCHIVED'
├─[5] search 额外：FTS5 → 0.4×fts + 0.3×conf + 0.2×recency + 0.1×access
│       降序 → limit/offset
├─[6] save：已存在同 (tenantId, subjectId, agentId, longTermMemoryId) → merge 语义
│       新条目 → auto-generate longTermMemoryId (UUID v7), state=ACTIVE, accessCount=0
├─[7] transitionState：校验 scope/target enum/expectedVersion → 更新 state + archivedAt/archiveReason
│       业务转换合法性由 aging / maintenance 等 lifecycle owner 在调用前判定
├─[8] adjustConfidence：delta 缺失或非法？ → LTM_CONFIDENCE_INVALID
│       delta 存在 → confidence += delta → clamp [0,1] → 更新 confidence + updatedAt
├─[9] markAccessed：更新 lastAccessedAt + updatedAt
├─[10] delete：物理删除 scoped row 和检索索引 → 后续读取统一 not found
```

### 4. 两个 gateway port 的设计理由

```
LongTermMemoryStoreGateway (CRUD + scoped mutation + batch + stats)     LongTermMemoryRetrieverGateway (检索 + 排序)
────────────────────────────────                                  ─────────────────────────────────────────
getLongTermMemory(request)                                        searchLongTermMemory(query)
saveLongTermMemory(request)                                       getLongTermMemoryDetail(request)
deleteLongTermMemory(request)
listLongTermMemory(query)
batchLongTermMemory(batchRequest)                  ← 批量操作
countLongTermMemory(query)                         ← 统计查询
transitionLongTermMemoryState(request)   ← scoped state mutation
adjustLongTermMemoryConfidence(request)  ← scoped confidence mutation
markLongTermMemoryAccessed(request)      ← scoped access mutation
```

**命名约定**：消费者在 constructor 中注入两个 gateway port，内部使用 `store`（`LongTermMemoryStoreGateway`）和 `retriever`（`LongTermMemoryRetrieverGateway`）作为变量名。后续方法调用写 `store.saveLongTermMemory()`、`retriever.searchLongTermMemory()` 等——读者通过变量名即可判断操作归属。

理由：
- 检索可能有独立中间件链（查询改写 → FTS5 → 排序 → L1 投影），不污染 CRUD + lifecycle
- Store 的调用方（extractor 写入、curator 批量更新）不需要检索语义
- State / confidence / access mutation 在 Store 上而不是独立 port，因为 mutation 对象和 CRUD 对象是同一份 `LongTermMemoryRecord`，且 aging 需要先 list 再 mutation，拆独立 port 会增加握手复杂度；gateway-local 只做 scoped atomic update，不拥有 lifecycle policy
- 同一份 FTS5 索引复用于 search，不经过 list
- 所有方法名带 `LongTermMemory` 前缀，即使只看方法名也能判断操作对象

### 5. Record/Request DTO 模式

对齐存量 gateway contract pattern：

```typescript
// agent-common
type LongTermMemoryId = Brand<string, "LongTermMemoryId">;
type MemoryCategory = "FACTUAL" | "CONCEPTUAL" | "PROCEDURAL" | "USER_CHARACTERISTICS";
type LongTermMemoryState = "ACTIVE" | "ARCHIVED";

// agent-contracts/gateway
interface MemorySourceTraceRef {
  readonly sessionId: SessionId;
  readonly rootMessageId?: MessageId;
  readonly runId?: RequestRunId;
  readonly messageRefs?: readonly MessageId[];
  readonly extractionCycleId?: string;
}

interface MemorySourceTrace {
  readonly sessionId: SessionId;
  readonly requestId?: MessageId;
  readonly runId?: RequestRunId;
  readonly messageRefs?: readonly MessageId[];
  readonly extractionCycleId?: string;
  readonly refs?: readonly MemorySourceTraceRef[];
}

type MemoryContentByCategory =
  | FactualMemoryContent
  | ConceptualMemoryContent
  | ProceduralMemoryContent
  | UserCharacteristicsMemoryContent;

interface FactualMemoryContent {
  readonly category: "FACTUAL";
  readonly subject: string;
  readonly claim: string;
  readonly evidence?: readonly string[];
  readonly qualifiers?: readonly string[];
}

interface ConceptualMemoryContent {
  readonly category: "CONCEPTUAL";
  readonly concept: string;
  readonly definition: string;
  readonly aliases?: readonly string[];
  readonly relatedConcepts?: readonly string[];
}

interface ProceduralMemoryContent {
  readonly category: "PROCEDURAL";
  readonly procedureName: string;
  readonly steps: readonly string[];
  readonly preconditions?: readonly string[];
  readonly verification?: readonly string[];
  readonly pitfalls?: readonly string[];
}

type UserCharacteristicsPurpose =
  | "PERSONALIZATION"
  | "TROUBLESHOOTING"
  | "WORKFLOW_ADAPTATION"
  | "GENERAL";

interface UserCharacteristicsMemoryContent {
  readonly category: "USER_CHARACTERISTICS";
  readonly traits: readonly string[];
  readonly purpose: readonly UserCharacteristicsPurpose[];
}

interface LongTermMemoryRecord extends OwnerScoped {
  readonly agentId: AgentId;
  readonly longTermMemoryId: LongTermMemoryId;
  readonly version: number;
  readonly category: MemoryCategory;
  readonly confidence: number;
  readonly state: LongTermMemoryState;
  readonly tags: readonly string[];
  readonly briefIndex: string;
  readonly content: MemoryContentByCategory;  // discriminated by category
  readonly accessCount: number;
  readonly recallCount: number;    // searchLongTermMemory 命中次数
  readonly extractionCount: number; // extraction 发现该知识的次数
  readonly lastAccessedAt?: EpochMillis;
  readonly archivedAt?: EpochMillis;
  readonly archiveReason?: string;
  readonly isPinned?: boolean;
  readonly sourceTrace: MemorySourceTrace;
  readonly createdAt: EpochMillis;
  readonly updatedAt: EpochMillis;
}

interface SaveLongTermMemoryRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly longTermMemoryId?: LongTermMemoryId;  // 首次写入不提供，gateway 自动生成
  readonly category: MemoryCategory;
  readonly confidence: number;
  readonly tags?: readonly string[];
  readonly briefIndex?: string;
  readonly content: MemoryContentByCategory;
  readonly sourceTrace: MemorySourceTrace;
  readonly isPinned?: boolean;
}

interface GetLongTermMemoryRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly longTermMemoryId: LongTermMemoryId;
}

interface ListLongTermMemoryQuery extends OwnerScoped {
  readonly agentId: AgentId;
  readonly categoryFilter?: MemoryCategory;
  readonly stateFilter?: LongTermMemoryState; // omitted means ACTIVE for ordinary list
  readonly isPinned?: boolean;
  readonly minConfidence?: number;
  readonly sinceTime?: EpochMillis;
  readonly untilTime?: EpochMillis;
  readonly maxLastAccessedAt?: EpochMillis;
  readonly maxArchivedAt?: EpochMillis;
  readonly limit?: number;
  readonly offset?: number;
}

interface DeleteLongTermMemoryRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly longTermMemoryId: LongTermMemoryId;
}

interface SearchLongTermMemoryQuery extends OwnerScoped {
  readonly agentId: AgentId;
  readonly queryText: string;
  readonly categoryFilter?: MemoryCategory;
  readonly minConfidence?: number;
  readonly sinceTime?: EpochMillis;
  readonly untilTime?: EpochMillis;
  readonly limit?: number;
  readonly offset?: number;
}

interface GetLongTermMemoryDetailRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly longTermMemoryId: LongTermMemoryId;
}

interface LongTermMemoryListItem {
  readonly longTermMemoryId: LongTermMemoryId;
  readonly category: MemoryCategory;
  readonly confidence: number;
  readonly tags: readonly string[];
  readonly briefIndex: string;
  readonly createdAt: EpochMillis;
}

interface LongTermMemorySearchEntry extends LongTermMemoryListItem {
  readonly hybridScore: number;
}

interface LongTermMemorySearchResult {
  readonly entries: readonly LongTermMemorySearchEntry[];
  readonly totalCount: number;
}

interface TransitionLongTermMemoryStateRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly longTermMemoryId: LongTermMemoryId;
  readonly targetState: LongTermMemoryState;
  readonly archiveReason?: string;
  readonly expectedVersion?: number;  // 乐观并发控制
}

interface AdjustLongTermMemoryConfidenceRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly longTermMemoryId: LongTermMemoryId;
  readonly delta: number;
  readonly expectedVersion?: number;  // 乐观并发控制
}

interface MarkLongTermMemoryAccessedRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly longTermMemoryId: LongTermMemoryId;
  readonly accessedAt: EpochMillis;
  readonly expectedVersion?: number;  // 乐观并发控制
}
```

`saveLongTermMemory(request, options?: IdempotentWriteOptions)` 的 `options.idempotencyKey` 是写入控制 metadata，用于防止同一 owner/agent scope 下重复创建；它不属于 `SaveLongTermMemoryRequest`，也不属于 `LongTermMemoryRecord`。

`LongTermMemoryListItem` 和 `LongTermMemorySearchEntry` 是 L1 查询投影，不是持久化 Record。它们不得携带 `content`、`sourceTrace`、`archiveReason`、`accessCount`、`recallCount` 或其他 L2 / lifecycle 内部字段。

`LongTermMemoryRecord.version` 是 retained memory record 的乐观并发版本。首次写入为 `1`；`saveLongTermMemory` 更新已有 entry 或 state/confidence/access mutation 成功后递增。`expectedVersion` 只和该字段比较；不匹配返回 `VERSION_CONFLICT`，不执行更新。高频弱语义 telemetry 更新可以不传 `expectedVersion`，仍使用数据库原子更新。

`DeleteLongTermMemoryRequest` 不包含 `archiveReason` 或 `deleteReason`。删除是物理删除 retained record，不是状态转换；删除原因只允许作为调用方拥有的安全 audit / diagnostic metadata 记录，不得写回被删除的 memory record。

### 6. SourceTrace 多来源追踪

`MemorySourceTrace` 是 core contract 的审计追踪字段，兼容单来源写入和跨会话提取融合：

- `sourceTrace.sessionId` 是 primary source session；`requestId` 是 primary root/request message（可选）。
- `runId` 和 `messageRefs` 可标识生成该事实的 committed request run 与可见 committed messages。
- `refs` 是重复来源引用，每个 ref 只包含 `sessionId`、可选 `rootMessageId`、可选 `runId`、可选 `messageRefs`、可选 `extractionCycleId`。
- source trace ref MUST NOT 包含 raw prompt、raw model output、stream delta、provider error、path、credential、token、attachment content、raw trait value 或 message text。

Gateway-local 持久化完整 `sourceTrace` JSON，同时继续维护 primary trace 的 scalar columns，支持兼容读取和低成本过滤。`saveLongTermMemory` 更新已有 entry 时按确定性规则合并来源：

- 保留已有 refs。
- 追加新请求中不存在的 refs。
- 除非原记录没有 trace，否则保留已有 primary trace。
- 当已有 entry 新增 extraction refs 时，本次更新只递增一次 `extractionCount`。

### 7. LongTermMemoryRecord 字段范围说明

`LongTermMemoryRecord` 只包含 core 自身负责或跨生命周期策略必须共享的持久字段。`isPinned` 是 core record 的可选持久字段，因为 aging scan 需要在 gateway 查询结果上可靠判断 pin 豁免；但 pin 的业务语义、上限、设置/取消入口由 `add-ts-memory-maintenance` 和 `add-ts-memory-aging` 定义。

以下字段**不在** core Record 中定义，由后续 change 通过独立 Request/Result DTO 或 sharing-owned record 表达：

| 字段 | 定义 owner | 原因 |
|---|---|---|
| `isPublished` | `add-ts-memory-sharing` | publish 是知识共享的策略字段 |
| `forkedFrom` | `add-ts-memory-sharing` | fork 来源引用是分享追踪字段 |

### 8. State 管理和删除物理方案

保留记录全部在同一张 `long_term_memory` 表中，通过 `state` 列区分。删除不是 retained lifecycle state，而是从 `long_term_memory` 及其检索索引中物理移除：

| state 值 | 可见性 | 操作 |
|---|---|---|
| ACTIVE | search / list 默认可见 | 所有读写 |
| ARCHIVED | 普通 search/list 默认不可见；time-range query 和同 scope L2 detail access 可见 | 只读；可通过 `transitionLongTermMemoryState` 复活为 ACTIVE，或通过 `deleteLongTermMemory` 物理删除 |

Business lifecycle owners use these retained state changes:
- `ACTIVE → ARCHIVED`（aging 归档）
- `ARCHIVED → ACTIVE`（L2 detail 访问复活或 maintenance restore）
- 显式遗忘或 retention 过期不走 state transition；`deleteLongTermMemory` 物理删除 scoped row，并从检索索引移除

这些合法业务路径由 `add-ts-memory-aging` / `add-ts-memory-maintenance` 等 owning change 判定。`agent-platform-gateway-local` 不判断业务前驱状态是否合法；它只按 gateway contract 执行 scoped atomic update、`expectedVersion` CAS、retained-record existence check 和 row/index mapping。

### 9. Storage mutation boundary

`LongTermMemoryStoreGateway` 上的 state / confidence / access mutation 方法设计理由：

- `saveLongTermMemory` 只做数据写入和 partial update，不做 state/confidence 的 lifecycle 语义变更
- aging 和 maintenance change 需要安全地变更 `state`、`confidence`、`lastAccessedAt` 等字段，不能通过 `saveLongTermMemory` 的 partial update 绕过 scoped mutation / CAS / audit 接入点
- `transitionLongTermMemoryState` 只校验 target state enum、scope、`expectedVersion` 和 retained-record existence；业务前驱状态和转换原因由 lifecycle owner 校验。删除使用 `deleteLongTermMemory` 物理删除边界
- `adjustLongTermMemoryConfidence` 确保结果 clamp 到 `[0, 1]`
- `markLongTermMemoryAccessed` 更新 `lastAccessedAt`，供 aging 判断 stale entries

### 10. Telemetry 计数副作用

`getLongTermMemoryDetail` 每次成功返回后对该 entry 递增 `accessCount` 并同步更新 `lastAccessedAt` 为当前时间。这是持久化副作用，影响后续 ranking 和 promotion。

`searchLongTermMemory` 每次成功返回后对每条返回的 entry 递增 `recallCount`。`recallCount` 追踪搜索命中次数，与 `accessCount`（详情访问）区分——retrieval 命中更多表示"候选相关性"，detail 访问更多表示"用户真正需要"。

`extractionCount` 由 memory extraction 在跨会话融合时递增（当已有 entry 被提取 corroboration 命中时），供 aging 判断知识的跨会话复用频率。

并发考虑：允许近似值。使用 `UPDATE SET count = count + 1` 数据库原子操作。

### 11. SQLite 表设计

对齐 `checkpoints` 表模式：所有可 scope/filter/index 的字段使用独立列，`tags`（字符串数组）和 `content`（Bloom 4 类结构化内容）作为 JSON 文本列存储。表由 `SqliteGatewayStores.initialize()` 统一创建，column->row 映射通过 `LongTermMemoryRow` 接口和 `toLongTermMemoryRecord()` 函数实现（对标 `CheckpointRow` / `toCheckpointRecord` 模式）。

```sql
CREATE TABLE IF NOT EXISTS long_term_memory (
  tenant_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  long_term_memory_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  category TEXT NOT NULL,
  confidence REAL NOT NULL,
  state TEXT NOT NULL,
  brief_index TEXT,
  tags_json TEXT NOT NULL,
  access_count INTEGER NOT NULL,
  recall_count INTEGER NOT NULL,
  extraction_count INTEGER NOT NULL,
  last_accessed_at INTEGER,
  archived_at INTEGER,
  archive_reason TEXT,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  source_trace_session_id TEXT NOT NULL,
  source_trace_request_id TEXT,
  source_trace_extraction_cycle_id TEXT,
  source_trace_json TEXT NOT NULL,
  content_json TEXT NOT NULL,
  idempotency_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, subject_id, agent_id, long_term_memory_id)
);

CREATE INDEX IF NOT EXISTS idx_ltm_list
  ON long_term_memory(tenant_id, subject_id, agent_id, state, created_at DESC, long_term_memory_id ASC);
CREATE INDEX IF NOT EXISTS idx_ltm_state
  ON long_term_memory(tenant_id, subject_id, agent_id, state, confidence DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ltm_idempotency
  ON long_term_memory(tenant_id, subject_id, agent_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

FTS5 虚拟表使用 standalone 模式（手动 `INSERT OR REPLACE` / `DELETE` 同步），不使用 `content=` 外部内容引用。FTS5 索引列映射：`brief_index` → `brief_index` 列内容，`tags` → `tags_json` 空格拼接，`content_body` → `extractFtsBody(content)` 生成的全文。

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS long_term_memory_fts USING fts5(
  tenant_id UNINDEXED,
  subject_id UNINDEXED,
  agent_id UNINDEXED,
  long_term_memory_id UNINDEXED,
  brief_index,
  tags,
  content_body
);
```

FTS5 不可用时 `SqliteGatewayStores` 内部降级为 literal substring match（`LIKE` 搜索 `brief_index`、`tags_json`、`content_json` 三列），不暴露降级细节到 gateway port contract。

计数递增使用数据库原子操作：`UPDATE long_term_memory SET recall_count = recall_count + 1` 替代全记录读写，避免并发写覆盖。

`longTermMemoryId` 由 `generateLongTermMemoryId()` 自动生成（时间排序标识符，使用 `crypto.randomBytes`）。

### 12. 错误代码体系

所有错误使用 `LTM_*` prefix，遵循 `SafeError { code, category, retryable, message?, safeDetails? }` 契约：

| code | category | retryable | 场景 |
|---|---|---|---|
| LTM_AUTH_MISSING | AUTHORIZATION | false | tenantId/subjectId/agentId 为空 |
| LTM_DISABLED | UNAVAILABLE | false | memory.enabled=false |
| LTM_STORAGE_UNAVAILABLE | UNAVAILABLE | true | DB 故障 |
| LTM_QUERY_INVALID | VALIDATION | false | 参数越界 |
| LTM_WRITE_INVALID | VALIDATION | false | entry content 不匹配 category schema |
| LTM_ENTRY_NOT_FOUND | NOT_FOUND | false | 不存在 or 不属于（不区分） |
| LTM_TRANSITION_INVALID | VALIDATION | false | target state enum、scope、version 或 retained-record mutation request 不合法；不得用于 gateway-local 执行业务 lifecycle policy |
| LTM_CONFIDENCE_INVALID | VALIDATION | false | confidence delta 缺失、非数值或无法产生合法置信度调整 |

### 13. 降级路径

- FTS5 不可用：`SqliteGatewayStores` 内部 `searchLongTermMemory` 降级为 literal substring match，结果仍然返回，并通过既有 observability/log path 记录 `LTM_FTS_UNAVAILABLE` + `degradedMode=literal_match` safe diagnostic；如存在 audit 投影，也必须经现有 observability/audit boundary。降级行为不暴露到 gateway port contract。
- memory 禁用：`MemoryConfig.status=DISABLED` 时，app composition 注入 disabled memory port / adapter；该 selected port 的所有方法直接返回 `LTM_DISABLED`。`SqliteGatewayStores` 不读取 raw config，也不拥有 memory enable/disable policy。
- 跨 scope：gateway-local 只做三元 scope 过滤并返回空结果 / not-found；`LTM_CROSS_SCOPE_ACCESS` safe diagnostic / observable event 由能比较不可信请求与 trusted `IdentityContext` / Agent Scope 的上游边界发出，gateway-local 不做 unscoped 反查、不注入独立 audit writer

### 14. 日志与可观测

结构化日志通过 `agent-observability` helper 输出，遵循 redaction policy：
- 上游跨 scope 诊断不得记录查询关键词或原始请求内容（避免信息泄露）
- 不记录 raw SQL error details 到 SafeError
- FTS5 降级事件包含 `degradedMode` 但不包含用户查询内容

## 实现约束（Implementation Constraints）

- `agent-common` MUST NOT 依赖 `agent-contracts` 或 `agent-memory`
- `agent-contracts/gateway` memory DTO/port MUST 只依赖 `agent-common`
- local backend 下，本 core change 不新增 `agent-memory` wrapper；后续 extraction/aging/maintenance/sharing 等 memory lifecycle orchestration 若位于 `agent-memory`，其对应 submodule MUST 只依赖 `agent-contracts/gateway` 和 `agent-common`，MUST NOT 直接操作 SQLite 或 FTS5。`agent-memory` memory tools provider/factory 的 public Tool SPI 依赖由 `add-ts-memory-tools` 单独约束，不属于 core local store/retriever 路径。remote complete-service backend 下，`agent-memory` MUST NOT own or run local memory lifecycle orchestration; it MAY only provide a thin facade for contract adaptation, trusted scope injection, SafeError mapping, and observability.
- `agent-platform-gateway-local` MUST 像 session/message/checkpoint stores 一样，在 `LocalGatewayStores` 新增 `longTermMemoryStore` 和 `longTermMemoryRetriever` 属性，并由 `SqliteGatewayStores` 直接实现；core local store/retriever MUST NOT 经由 `agent-memory` wrapper。后续商用 remote complete-service adapter MUST 复用同一 consumer-facing ports，并仅通过 `agent-app` composition 与 local backend 互斥注入
- `agent-platform-gateway-local` MUST NOT enforce memory lifecycle business policy or own a competing memory state machine; it only stores and returns gateway Records, applies scope/version/storage invariants, and performs atomic row/index updates.
- `agent-context-engine` / `agent-capability` / `agent-runtime` MUST NOT 导入 memory gateway port
- Record MUST NOT 包含 `idempotencyKey`；幂等选项 MUST 在 `IdempotentWriteOptions`
- Request DTO MUST NOT 包含 `idempotencyKey`；简单 gateway 写入使用 `Record/Request + write options`，不得新增同形 `*WriteRequest` 包装。
- DTO 时间字段使用 `EpochMillis`（per global contract）
- Gateway port 实现不跨包暴露 SQLite driver、FTS5 index API 或 provider-specific type

## 长期设计文档更新（Baseline Design Updates）

- `openspec/designs/contracts/core-contracts.md` — 新增 memory gateway port 签名在 `agent-contracts/gateway`，新增 memory enum/branded type 在 `agent-common`
- `openspec/designs/modules/agent-platform-gateway-local.md` — 补充 memory store/retriever 持久化职责，直接实现 local gateway ports
- `openspec/designs/modules/agent-memory.md` — 定义后续 local backend 业务编排职责（通过 gateway port 读取/写入；remote complete-service backend 下只允许薄 facade，不拥有 lifecycle），不作为 core local store/retriever 的必经层

## Sharing 边界

`LongTermMemorySharingGateway`、sharing Request/Result DTO、published state、fork relationship、sharing audit 和相关持久化表不属于本 core change。它们由 `add-ts-memory-sharing` 定义与实现；该 change 可以消费本 core change 提供的 `LongTermMemoryStoreGateway` / `LongTermMemoryRetrieverGateway` 和 canonical `LongTermMemoryRecord`，但不得把 publish/fork 字段写入 core Record。

## 待确认问题（Open Questions）

无。讨论中已确认核心设计决策，包括方法命名约定（`LongTermMemory` 前缀）、`LongTermMemoryId` 命名、`LongTermMemoryState` 命名、Record 字段范围（不预埋 sharing 字段）、state 复活路径由 aging / maintenance 等 lifecycle owner 判定、local store/retriever 直接由 gateway-local 实现（对齐 session store 机制），消费者通过 app composition 注入 gateway port。



