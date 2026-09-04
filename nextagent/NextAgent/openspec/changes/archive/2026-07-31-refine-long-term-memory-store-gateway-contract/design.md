## 背景与实现差距（Context And Gap）

权威 YAML 定义 12 个长期记忆 operation。当前代码只完整覆盖两个 Retriever operation 和部分 Store 行为，而且 DTO 使用早期内部字段及结构化 TypeScript content union。此前 change 误把目标收敛成 provider-neutral mutation union，并保留 YAML 不存在的 count/batch；该方向无法逐项验证 Gateway 与远端服务的一致性。

当前 LOCAL SQLite 已拥有长期记忆专用表、FTS 投影、scope 过滤、版本 CAS、检索 telemetry 和 lifecycle primitive。唯一实现路径是在保留这些持久化能力的前提下，把 public Gateway contract 改成 YAML data schema，并在 LOCAL row mapper 与 `agent-memory` 算法边界完成字符串序列化/解析。Sharing 复用同一专用表，通过 `sharing_state/source_memory_id` 表达，不新建 generic record store。

## 目标与非目标（Goals / Non-Goals）

目标：
- 每个 Gateway method 与 YAML operation 一一对应。
- 除框架强制映射外，DTO 字段名、required/optional、枚举、分页和业务结果与 YAML 一致。
- LOCAL provider 可执行所有 12 个 operation 的可观察语义。
- Owner Scope、Agent Scope、CAS、物理删除、共享跨 owner 边界可重复验证。
- dreaming/aging 保持算法判断不变，只迁移数据表示和调用 shape。

非目标：
- 不实现 count、batch 或 REMOTE HTTP adapter。
- 不新增第二套内部 Gateway DTO 或 compatibility facade。
- 不通过本变更重新定义记忆算法策略。

## 唯一实现路径（Selected Design）

### 1. Operation 与 port 一一对应

| YAML operationId | Gateway owner | Gateway request/result |
| --- | --- | --- |
| `saveLongTermMemory` | `LongTermMemoryStoreGateway` | `SaveLongTermMemoryRequest` + `VersionedWriteOptions` -> `LongTermMemoryRecord` |
| `listLongTermMemory` | `LongTermMemoryStoreGateway` | `ListLongTermMemoryQuery` -> `LongTermMemorySummaryPage` |
| `manualSaveLongTermMemory` | `LongTermMemoryStoreGateway` | `ManualSaveLongTermMemoryRequest` -> `LongTermMemoryRecord` |
| `getLongTermMemory` | `LongTermMemoryStoreGateway` | `GetLongTermMemoryRequest` -> `LongTermMemoryRecord` |
| `deleteLongTermMemory` | `LongTermMemoryStoreGateway` | `DeleteLongTermMemoryRequest` -> `DeleteLongTermMemoryResult` |
| `mutateLongTermMemory` | `LongTermMemoryStoreGateway` | `MutateLongTermMemoryRequest` + `VersionedWriteOptions` -> `VersionedUpdateResult<LongTermMemoryRecord>` |
| `searchLongTermMemory` | `LongTermMemoryRetrieverGateway` | `SearchLongTermMemoryQuery` -> `SearchItemPage` |
| `getLongTermMemoryDetail` | `LongTermMemoryRetrieverGateway` | `GetLongTermMemoryDetailRequest` -> `LongTermMemoryRecord` |
| `publishLongTermMemory` | `LongTermMemorySharingGateway` | `SharingLongTermMemoryRequest` -> `PublishLongTermMemoryResult` |
| `unpublishLongTermMemory` | `LongTermMemorySharingGateway` | `SharingLongTermMemoryRequest` -> `UnpublishLongTermMemoryResult` |
| `listPublishedLongTermMemory` | `LongTermMemorySharingGateway` | `ListPublishedLongTermMemoryQuery` -> `SharedMemorySummaryPage` |
| `copyPublishedMemory` | `LongTermMemorySharingGateway` | `CopyLongTermMemoryRequest` -> `CopyPublishedMemoryResult` |

`countLongTermMemory`、`batchLongTermMemory` 及其 DTO 从 public exports、interfaces、LOCAL wrappers、disabled adapter 和测试替身删除。不得保留 deprecated alias。

### 2. YAML 字段作为 canonical Gateway 字段

`LongTermMemoryRecord` 使用以下字段：

```ts
interface LongTermMemoryRecord extends OwnerScoped {
  agentId: AgentId;
  memoryId: LongTermMemoryId;
  memoryInstance: string;
  memoryType: MemoryType;
  knowledgeSourceType: KnowledgeSourceType;
  sharingState: SharingState;
  sourceMemoryId?: LongTermMemoryId;
  state: LongTermMemoryState;
  briefIndex: string;
  content: string;
  labels: readonly string[];
  confidence: number;
  version: number;
  accessCount: number;
  recallCount: number;
  extractionCount: number;
  lastAccessedAt?: EpochMillis;
  archivedAt: EpochMillis;
  archiveReason: string;
  isPinned: boolean;
  source: string;
  createTime: EpochMillis;
  updateTime: EpochMillis;
}
```

YAML `userId` 不再建立平行字段，直接由继承的 `subjectId` 表示。其余字段不提供 `longTermMemoryId/category/tags/sourceTrace/createdAt/updatedAt` alias。`MemoryType`、`KnowledgeSourceType`、`SharingState` 是跨 Gateway DTO 复用的 durable scalar vocabulary，放在 `agent-common`。

`content` 和 `source` 是 opaque string contract。Gateway 按 YAML 校验长度、数组容量、枚举、时间和数值范围，不把记忆类别算法 schema 放入 public Gateway。`agent-memory` 对自身生成的结构化内容和 source evidence 使用私有类型并在调用 Gateway 前 `JSON.stringify`，读取后在算法边界安全解析；解析失败作为该算法 item 的安全拒绝/降级，不改变 Gateway schema。

### 3. 仅保留四项框架强制映射

| YAML wire | Gateway contract | 原因 |
| --- | --- | --- |
| `userId` | `OwnerScoped.subjectId` | 统一可信 Owner Scope，禁止请求体覆盖身份 |
| save `idempotencyKey` | `VersionedWriteOptions.idempotencyKey` | write control metadata 不进入 Request/Record |
| save/mutate `expectedVersion` | `VersionedWriteOptions.expectedVersion` | CAS metadata 不进入 Request/Record |
| `RestResponse` / `LtmError` | data result / `SafeError` | transport envelope 和 raw provider error 不穿透 port |

未来 REMOTE adapter 必须只做这四项映射及 runtime schema validation，不得重命名或重塑其他字段。`listPublishedLongTermMemory.subjectId` 只用于内部调用者授权上下文，不发送到该 YAML operation 的 wire query。

### 4. Flat PATCH 严格校验

`MutateLongTermMemoryRequest` 直接包含 YAML 字段：`memoryId`、scope、可选 `memoryInstance`、`targetState`、`archiveReason`、`delta`、`lastAccessTime`、`isPinned`。mutation write options 从 `VersionedWriteOptions` 只选取 YAML PATCH 存在的 `expectedVersion`，不得接受或忽略 `idempotencyKey`。

LOCAL runtime validator 必须断言恰好一个合法组合：
1. state：`targetState`，MAY 包含 `archiveReason`；目标为 `ACTIVE` 时若携带该字段，值必须为空字符串；
2. confidence：仅 `delta`；
3. access：仅 `lastAccessTime`；
4. pin：仅 `isPinned`。

零个组合、多个组合、孤立 `archiveReason`、ACTIVE 携带非空 `archiveReason`、未知字段、非法数值或时间都返回 `LTM_WRITE_INVALID`，不执行部分更新。CAS mismatch 返回 `VersionedUpdateResult.status=VERSION_CONFLICT`；scope miss 返回 `NOT_FOUND`，不泄漏跨 scope 是否存在。

### 5. LOCAL row mapping 与迁移

继续使用 `long_term_memory` 和现有 FTS 表。表新增：
- `memory_instance TEXT NOT NULL DEFAULT 'defaultInstance'`
- `knowledge_source_type TEXT NOT NULL DEFAULT 'LEARNED'`
- `sharing_state TEXT NOT NULL DEFAULT 'PRIVATE'`
- `source_memory_id TEXT NULL`

既有列按 mapper 对应：`long_term_memory_id -> memoryId`、`category -> memoryType`、`tags_json -> labels`、`content_json -> content`、`source_trace_json -> source`、`created_at -> createTime`、`updated_at -> updateTime`。不为字段重命名重建表。

scope uniqueness、get/list/search/delete/mutate 都包含 `(tenant_id, subject_id, agent_id, memory_instance)`。普通 Store/Retriever 不返回其他 owner 的记录；普通 list/search 默认只处理 retained PRIVATE/FORK/owner-owned SHARED 记录中的当前 owner scope。

save 创建时默认 `memoryInstance=defaultInstance`、`sharingState=PRIVATE`、`state=ACTIVE`、计数为 0、`isPinned=false`、`version=1`。按 `memoryId` 更新时必须 scope 命中并应用 `expectedVersion`；共享池的 SHARED record 不能由 ordinary save/mutate/delete 修改，必须走 Sharing Gateway。

manual save 使用请求中的 `memoryType/knowledgeSourceType/briefIndex/content/labels`，固定 `confidence=0.5`、`source=MANUAL`，其他创建默认值同 save。

### 6. list/search/detail 行为

- list 按 YAML filters：`memoryInstance/memoryType/knowledgeSourceType/state/isPinned/minConfidence/sinceTime/untilTime/maxLastAccessedAt/labels/limit/offset`；`limit` 默认 10，最大 100，`offset` 默认 0。返回 `LongTermMemorySummaryPage { items,total,offset,limit }`。
- search 要求 `queryText/minConfidence/limit/offset`，且 `offset` 必须为 0；支持 YAML 的 memory type/source/time/labels filters。返回 `SearchItemPage`，每项为 `{ summary, score, relevanceScore }`，成功命中递增 `recallCount`。
- YAML summary 明确包含 `content`，因此 list/search 的 L1 返回该字符串；不得在 Gateway 自行删除字段。算法和模型工具是否向最终用户暴露该字段由其 owner 决定。
- get 无 telemetry 副作用。detail 原子递增 `accessCount` 并更新 `lastAccessedAt`，返回更新后的完整 record。
- aging 的 retention scan 不再依赖 YAML 缺失的 `maxArchivedAt`。它分页 list ARCHIVED summary，再以无副作用 get 读取候选 `archivedAt` 并在算法层判断是否删除。

### 7. Sharing 单表语义

publish 在一个 LOCAL transaction 中读取当前 owner 的 PRIVATE/FORK source：
- 若同 `(tenantId, subjectId, agentId, memoryInstance, sourceMemoryId)` 已存在 SHARED record，返回既有记录，不重复创建。
- 否则复制内容为新 `memoryId`、`sharingState=SHARED`、`sourceMemoryId=<source memoryId>`，保留 ownerSubjectId，并返回 `{ publishedMemory, sourceMemoryId, ownerSubjectId }`。

unpublish 只允许发布者删除其 SHARED record；物理删除共享记录和 FTS 投影，既有 FORK 不受影响。

list shared 以可信调用者 `subjectId` 做授权上下文，但数据过滤按 YAML `(tenantId, agentId, memoryInstance)` 和共享条件执行，只返回 `sharingState=SHARED`。结果中的 wire `ownerUserId` 在 Gateway 表示为 `ownerSubjectId`。该方法是唯一允许跨 subjectId 返回摘要的受控边界，不返回完整 source record。

copy 接收 1..100 个 SHARED `memoryIds`，在一个 LOCAL transaction 中按输入顺序为接收者创建 FORK records；每个 FORK 使用新 `memoryId`、接收者 owner scope、`sharingState=FORK`、`sourceMemoryId=<shared memoryId>`。任一 id 不存在、不属于同 tenant/agent shared pool 或输入非法时整批失败，不产生部分副作用。

### 8. Bindings 与 disabled behavior

`LongTermMemoryGatewayBindings` 固定为 `{ store, retriever, sharing }`。LOCAL 三个字段可引用同一 `SqliteLongTermMemoryStore` 实例；REMOTE composition 必须提供三个 port；disabled adapter 实现全部 12 个方法并返回 `LTM_DISABLED`，不得静默缺方法。

## 算法与软件职责

算法层（`agent-memory`）负责：
- 从 trajectory/model output 构造 category-specific private content object，并序列化成 YAML `content`。
- 构造、合并和解析 source evidence，再序列化成 YAML `source`。
- extraction 的 equivalence、conflict、corroboration 判断。
- aging 的 stale、decay、archive、retention delete、revival 判断。
- 决定何时调用 flat mutation 的哪一组字段。

软件/Gateway 层负责：
- DTO runtime validation、scope isolation、memory instance 过滤和 safe error mapping。
- UUID、时间、版本 CAS、计数、分页、排序、FTS fallback、事务和 row mapping。
- flat PATCH 的单组合原子更新，不解释 lifecycle policy。
- publish/unpublish/shared list/copy 的共享状态、跨 owner 授权边界和事务完整性。

Gateway 不理解 procedural steps、concept equivalence、promotion 或 decay；算法不访问 SQLite/FTS、不伪造 subjectId、不实现共享持久化事务。

## 质量属性审视（Quality Attributes）

- 安全：所有 owner-private operation 强制 tenant+subject+agent+instance scope；shared list 是唯一跨 subject summary 读取；copy 只复制 SHARED；negative contract tests 覆盖跨 scope、伪造 owner、普通 Store 修改 SHARED。
- 性能/容量：list/search limit 上限 100，copy 上限 100；scope/filter 列建立或复用索引；retention scan 分页，避免一次加载全量记录。
- 可靠性/恢复：save idempotency 使用锚点记录；CAS conflict 无副作用；publish 幂等复用既有 SHARED；copy 单事务全成或全败；FTS 故障保持既有 literal fallback。
- 可维护性：一份 DTO 对照 YAML；不保留 union、count/batch、alias 或 compatibility facade；row mapper 集中处理物理列与 canonical 字段。
- 可测试性：contract shape、runtime validation、SQLite migration、12 个 operation、negative scope/flat PATCH/transaction cases 均有可重复 Vitest 路径。
- 审计/可追溯性：reasonCode、sourceMemoryId、sharingState、ownerSubjectId 提供安全事实；日志不得包含 content/source/raw provider error。

## 验证映射（Verification Map）

| 约束 | 验证入口 |
| --- | --- |
| 12 operation 与 DTO 对齐 YAML | `agent-contracts` type/architecture tests + YAML parity test |
| 不存在 count/batch/union/legacy alias | compile negative fixture / source architecture assertion |
| Store/Retriever LOCAL 行为 | `sqlite-long-term-memory-store.test.ts` |
| flat PATCH 单组合和 CAS | LOCAL unit/contract negative tests |
| Sharing publish/unpublish/list/copy | LOCAL transaction + scope tests |
| algorithm string boundary | `agent-memory` extraction/tools/aging tests |
| disabled 12-method coverage | `memory-gateway.test.ts` |
| 全仓边界和构建 | `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` |
| OpenSpec | `openspec validate refine-long-term-memory-store-gateway-contract --strict` |

## 风险与取舍（Risks / Trade-offs）

- YAML summary 包含 `content`，会扩大 L1 payload。为严格对齐，本变更不删除该字段；最终 capability 输出仍由 memory-tools schema 控制。
- LOCAL 原字段是结构化对象，改成字符串后算法需要显式解析。集中 helper 可以把失败变为安全 item rejection，代价小于维护两套 public contract。
- YAML 没有 `maxArchivedAt`，retention scan 需要 list+get，查询次数增加。分页和 batchLimit 控制容量；不得为了优化重新扩展 Gateway。
- Sharing 是新的受控跨 owner 边界，必须以 negative tests 固化；不能依赖普通 Store 的 owner-scoped query 实现共享浏览。

## 迁移顺序（Migration Plan）

1. 先更新 OpenSpec 并 strict validate。
2. 更新 `agent-common` vocabulary 和 `agent-contracts/gateway` DTO/ports/bindings，删除旧 public shape。
3. 更新 LOCAL schema/mapper/Store/Retriever，新增 Sharing transaction。
4. 更新 disabled/remote binding composition 和 `agent-memory` callers/private serialization helpers。
5. 补齐 contract、LOCAL、algorithm、architecture negative tests并运行完整门禁。
6. 运行 `$nextagent-code-review`；P0/P1 清零后整理提交历史并 push。

## 归档前更新基线（Baseline Promotion Plan）

归档前把行为归并到 `memory-core`、`memory-sharing`、`memory-extraction`、`memory-aging` stable specs；把接口主承载、scope/security、单表共享和算法/软件职责归并到 `designs/architecture/memory-learning-system.md`；把模块职责归并到 `designs/modules/agent-contracts.md`、`agent-memory.md`、`agent-platform-gateway-local.md`；更新 `designs/spec-to-design-map.md`。不新增 ADR。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-8.2-检索和写入记忆` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/memory-aging/spec.md`、`openspec/specs/memory-core/spec.md`、`openspec/specs/memory-extraction/spec.md`、`openspec/specs/memory-sharing/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
