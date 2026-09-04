## 背景和现状（Context）

workflow knowledge 节点（`knowledge-search` / `knowledge-qa` / `api-choice` / `recipe-choice`）通过 `node.inputs.rag_index` 声明检索索引，经 `retrieveKnowledge` 组装 `WorkflowKnowledgeRetrievalRequest`，再由 `createWorkflowRagKnowledgeRetrieverAdapter` 翻译为 `WorkflowRagRetrievalRequest` 调用 `WorkflowRagRetrievalGateway`。

当前实现存在三个缺口：

1. **`indexType` 是 dead field**。`parseKnowledgeIndexes` 解析并存储了 `indexType: string`，但全仓无任何代码消费它：没有枚举校验、没有节点默认填充、没有远端语义传递。测试里用的值是 `"vector"`/`"es"`，与电信场景需要的 `API`/`RECIPE`/`KNOWLEDGE` 不一致。
2. **per-index 参数不支持**。`vsTopN`/`esTopN`/`filters` 是 `WorkflowKnowledgeRetrievalRequest` 上的节点级标量，无法为每个索引项单独指定召回预算和过滤条件。电信场景中不同索引（API 目录、RECIPE 目录、知识库）召回策略差异大，需要 per-index 控制。
3. **gateway 层参数丢失**。`WorkflowRagRetrievalRequest.indexes` 只是 `readonly string[]`（纯索引名），`options` 只有 `{ topK }`。adapter 把节点级 `vsTopN`/`esTopN`/`filters` 和 `indexType` 全部丢弃，导致 remote 模式下远端收不到这些参数。

此外，`WorkflowRagRetrievalGateway` 当前定义在 `agent-workflow/runtime-node-adapters.ts` 内部且未导出。remote 实现需要由 `agent-platform-gateway-remote` 提供，但 gateway 包不能依赖 workflow 包（依赖方向反了）。当前 composition 把 workflow RAG 复用为 `ragKnowledgeGovernance.gateway`（即 rag-tool 的 `RagRetrievalGateway` 实例），两者共享同一个 gateway，参数形状也完全相同（`indexes: string[]` + `options: { topK }`），靠结构兼容复用。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 让 `rag_index` 每一项能独立声明 `indexType`/`vsTopN`/`esTopN`/`filters`，并按节点类型自动填充 `indexType` 默认值。
- 让 per-index 参数与节点级参数按"per-index 优先、缺失 fallback 节点级"的规则合并，且合并结果无损到达 gateway。
- 把 `WorkflowRagRetrievalGateway` 提升到 `agent-contracts/gateway`，使 local 与 remote 都能在不依赖 `agent-workflow` 的前提下实现它。
- workflow RAG gateway 在 composition 中独立接线，与 rag-tool 的 `RagRetrievalGateway` 分离；remote 模式复用同一个 RAG retrieval endpoint，不新增环境变量。
- local 作为 fallback provider 优雅降级：忽略不支持的 per-index 参数，仅用 `topK` + FTS5 BM25。

**非目标：**
- 不实现 query rewrite 逻辑。`enableQueryRewrite` 的改写能力尚未想清楚具体用法，本 change 不新增、不传递该参数到 gateway（既有的节点级 `WorkflowKnowledgeRetrievalRequest.enableQueryRewrite` 字段保持原样，不在本 change 改动）。
- 不改节点双模式分流（candidate 优先 / RAG 回退）。
- 不改 rag-tool 的 `RagRetrievalGateway` 安全边界、请求形状或 schema。
- 不实现 embedding、向量库、rerank 或混合检索体系。
- 不改 `topK` 之外的节点输出字段或 DSL 字段名。

### 决策 11：Result 类型独立，移除 WorkflowKnowledgeDocument 中间映射

原 design 让 workflow gateway 复用 `RagRetrievalResult`（`results: RagRetrievalChunk[]`，`additionalProperties: false`），adapter 再通过 `createWorkflowKnowledgeDocument` 把 `RagRetrievalChunk` 映射为 `WorkflowKnowledgeDocument`（`excerpt`/`score`/`provenance` 等），并对 `excerpt` 做 480 字符截断。

问题：远端 RAG 服务对不同 `indexType` 返回完全不同的 `recommends` 元素结构（KNOWLEDGE: `id`/`title`/`summary`/`knowledge`/`vsScore`/`esScore`/`rerankScore`/`labels`/`metadata`/`hyQuestions`...；RECIPE: `recipeId`/`recipeName`；API: `apiId`/`apiName`/`description`/`category`/`qaExample`/`extensions`/`hyQuestions`）。`RagRetrievalChunk` 的闭合结构（`content`/`source` 必填，`additionalProperties: false`）无法承载这些异构字段，强行映射会丢失结构化信息。

变更：
- 新增 `WorkflowRagRetrievalResult`（`status`/`recommends: readonly JsonObject[]`/`diagnostics?`），`recommends` 为开放对象数组，保留远端原始结构。
- 移除 `WorkflowKnowledgeDocument` 中间类型和 `createWorkflowKnowledgeDocument`/`mapKnowledgeDocument` 映射函数。
- `WorkflowKnowledgeRetrievalResult` 的 `documents` 字段改为 `recommends: readonly JsonObject[]`。
- adapter 直接返回 gateway 的 `recommends`，不做字段映射或截断。
- 节点按 `indexType` 从 `recommends` 元素中解析各自所需字段。
- rag-tool 不受影响（它使用 `RagRetrievalResult`，不走 `WorkflowRagRetrievalResult`）。

来源：用户要求"workflow 中需要把 rag 的信息都返回回来"以及用户提供的各 indexType 的 recommends 元素结构。

## 设计决策（Decisions）

### 决策 1：扩展 `WorkflowKnowledgeIndex` per-index 字段

`WorkflowKnowledgeIndex` 新增 per-index 字段：

- `indexType?: "API" | "RECIPE" | "KNOWLEDGE"`（由 `string` 收窄为枚举，非法值抛 `WORKFLOW_NODE_INPUT_INVALID`，field=`index_type`）
- `vsTopN?`、`esTopN?`、`filters?`

`parseKnowledgeIndexes` 解析这些字段；`indexType` 做枚举校验，`vsTopN`/`esTopN` 复用既有 `readBoundedInt` 的 1-20 范围约束，`filters` 接受 provider-neutral 结构化对象（内部结构由远端负责校验）。

来源：proposal 缺口 1、2。

### 决策 2：indexType 节点默认填充，用户覆盖，不过滤

每个 knowledge 节点类型有一个 `defaultIndexType`：

| 节点类型 | defaultIndexType |
|----------|------------------|
| `knowledge-search` | `KNOWLEDGE` |
| `knowledge-qa` | `KNOWLEDGE` |
| `api-choice` | `API` |
| `recipe-choice` | `RECIPE` |

`retrieveKnowledge` 接收 `defaultIndexType` 参数并写入 `WorkflowKnowledgeRetrievalRequest.defaultIndexType`。adapter 解析 `resolvedIndexType = item.indexType ?? request.defaultIndexType`。用户显式指定的 `indexType` 覆盖默认。所有索引项（含用户显式指定异类 indexType 的项）都透传给 gateway，节点 MUST NOT 按 indexType 过滤索引项。

indexType 是远端检索接口的入参（用于选择检索策略），不是本地过滤条件。

来源：用户澄清"节点自动选择…也支持用户定义 indexType…远端仅关注参数透传和 rag 调用"。

### 决策 3：per-index 参数与节点级参数合并规则

合并规则：per-index `vsTopN`/`esTopN`/`filters` 优先；缺失时 fallback 到节点级 `vs_topN`/`es_topN`/`filters`。`rank_topN` 保持节点级，不进 per-index。

合并发生在 adapter 翻译阶段（本地、可测），不在远端。adapter 对每个索引项计算 `effective vsTopN = index.vsTopN ?? request.vsTopN`，`esTopN`/`filters` 同理。合并后的值落在 gateway 请求的 per-index 项上；若 per-index 与节点级都缺失，对应字段为 `undefined`（远端用自身默认）。

来源：用户澄清"如果 ragIndexes 中定义，以其中的定义优先；如果没有定义，则以外部的节点级参数为准"。

### 决策 4：`topK = rankTopN`，简化召回预算计算

当前 `topK = Math.min(10, Math.max(rankTopN, Math.min(vsTopN, 10), Math.min(esTopN, 10)))` 把召回参数混进了返回数计算。简化为 `topK = rankTopN`（topK 只代表 gateway 最终返回的文档数）。`rankTopN` 仍由 `readBoundedInt` 约束在 [1,10]。`vsTopN`/`esTopN` 是向量/ES 召回阶段的独立检索参数，与 `topK` 是不同阶段的参数，不互相替代——它们作为 per-index 参数透传给 gateway，控制远端的召回数量。

来源：用户确认"topK = rankTopN 是的"。

### 决策 5：不实现 enableQueryRewrite

query rewrite 的改写逻辑应在节点内部实现，但当前尚未想清楚具体用法。本 change 不把 `enableQueryRewrite` 加入 gateway contract、不解析、不透传。既有的 `WorkflowKnowledgeRetrievalRequest.enableQueryRewrite` 与 `WorkflowNodeHandlerContext.enableQueryRewrite` 字段保持原样，不在本 change 改动。

来源：用户确认"先不实现这个能力，还没想清楚具体怎么用"。

### 决策 6：提升 `WorkflowRagRetrievalGateway` 到 `agent-contracts/gateway`，复用 Options，Result 独立

在 `agent-contracts/gateway` 新增：

```typescript
export interface WorkflowRagRetrievalIndex {
  readonly indexName: string;
  readonly indexType: "API" | "RECIPE" | "KNOWLEDGE";
  readonly domain?: string;
  readonly scene?: string;
  readonly priority?: number;
  readonly vsTopN?: number;
  readonly esTopN?: number;
  readonly filters?: JsonObject;
}

export interface WorkflowRagRetrievalRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly knowledgeScope: RagKnowledgeScope;
  readonly query: string;
  readonly indexes: readonly WorkflowRagRetrievalIndex[];
  readonly options: RagRetrievalOptions;
}

export interface WorkflowRagRetrievalResult {
  readonly status: "OK" | "NO_INDEX" | "UNAVAILABLE" | "DEGRADED" | "FAILED" | "TIMEOUT" | "CANCELED";
  readonly recommends: readonly JsonObject[];
  readonly diagnostics?: string;
}

export interface WorkflowRagRetrievalGateway {
  retrieve(request: WorkflowRagRetrievalRequest, signal?: AbortSignal): Promise<WorkflowRagRetrievalResult>;
}
```

- `options` 复用既有 `RagRetrievalOptions`（`{ topK }`），不为相同语义新增平行 Options 类型。
- Result 独立为 `WorkflowRagRetrievalResult`：`recommends` 为开放对象数组（`readonly JsonObject[]`），保留远端按 indexType 返回的异构原始结构（KNOWLEDGE/RECIPE/API 各有不同字段集），不做闭合 schema 约束。不复用 `RagRetrievalResult`（其 `results: RagRetrievalChunk[]` 为闭合结构，`additionalProperties: false`，无法承载异构字段）。
- `agent-workflow` 从 `agent-contracts/gateway` re-export 这些类型，移除 `runtime-node-adapters.ts` 内部定义。
- 新增 `workflowRagRetrievalRequestSchema`（JSON Schema，`additionalProperties: false`，bounded 约束 per-index 字段）。新增 `workflowRagRetrievalResultSchema`（校验 `status` 枚举 + `recommends` 为数组，元素为开放对象，不做闭合字段约束）。

来源：proposal 缺口 3、架构约束"跨 package 只能通过 public package exports 协作"、决策 11。

### 决策 7：adapter 无损翻译，合并发生在 adapter

`createWorkflowRagKnowledgeRetrieverAdapter` 翻译逻辑改为：

- `indexes`：每项翻译为 `WorkflowRagRetrievalIndex`，含 resolved `indexType`（决策 2）和 resolved per-index `vsTopN`/`esTopN`/`filters`（决策 3）。
- `options`：`{ topK: request.topK }`（即 `rankTopN`，决策 4）。

adapter 不丢弃任何 per-index 或节点级参数；合并（per-index ?? 节点级）在 adapter 完成，远端只做透传。
adapter 直接返回 gateway 的 `recommends`（`readonly JsonObject[]`），不做 `WorkflowKnowledgeDocument` 映射或字段裁剪。`WorkflowKnowledgeRetrievalResult.recommends` 即 gateway `WorkflowRagRetrievalResult.recommends`。

来源：用户澄清"远端仅关注参数透传和 rag 调用"。

### 决策 8：local gateway 优雅降级

`agent-platform-gateway-local` 新增 `createLocalWorkflowRagGateway(governance)`，包装 `LocalRagKnowledgeGovernance`。local 实现对不支持的参数优雅降级：

- 忽略 `indexType`（FTS5 单表不区分索引类型）
- 忽略 per-index `vsTopN`/`esTopN`/`filters`
- 用 `options.topK`（`clampTopK` 压到 [1,10]）
- 提取 `indexes` 的 `indexName` 作为 FTS5 检索输入（local 单表检索）
- MUST NOT 因收到新参数而报错或改变现有 BM25 行为
local gateway 将 `RagRetrievalResult.results`（`RagRetrievalChunk[]`）映射为 `WorkflowRagRetrievalResult.recommends`（`JsonObject[]`）：每个 chunk 转为 knowledge 风格对象。映射发生在 local gateway 内部，对 adapter 和节点透明。

来源：proposal"local 作为 fallback provider…符合 local 轻量降级定位"。

### 决策 9：remote 复用同一 endpoint，不新增环境变量

`agent-platform-gateway-remote` 新增 `ReferenceRemoteWorkflowRagClient`、`createReferenceRemoteWorkflowRagGateway(client)` + `createHttpWorkflowRagClient(endpoint)`。remote gateway 在 HTTP transport 层将 `WorkflowRagRetrievalRequest` 映射为平台 wire format（`query` + `ragIndexes: [{ ragIndex, indexType, vsTopN, esTopN, filters }]`，`indexName` → `ragIndex`）后 JSON POST，响应经 `workflowRagRetrievalResultSchema` 校验。mapping 是字段名转换，MUST NOT 过滤、改写或丢弃 per-index 参数的值；contract 层保持语义化 `indexes`，平台 wire format 是 HTTP client 的 transport 关注点。`ReferenceRemoteWorkflowRagClient` 与 `ReferenceRemoteRagRetrievalClient` 是独立 client（请求形状不同：前者 post 平台 wire format，后者 post `RagRetrievalRequest`），不共用同一 client 实例。

endpoint 复用既有 `NEXTAGENT_REMOTE_RAG_RETRIEVAL_ENDPOINT`（同一个检索服务，区别仅在入参更丰富）。不新增 `NEXTAGENT_REMOTE_WORKFLOW_RAG_ENDPOINT`，不加 `/workflow` 路径后缀。rag-tool 的 `RagRetrievalGateway` 客户端、请求形状、严格 schema 均不变，互不影响。

**remote gateway 进入 composition 的路径**：`GatewayBindings`（`agent-contracts/gateway`）新增可选字段 `workflowRagRetrieval?: WorkflowRagRetrievalGateway`，与既有 `ragRetrieval?: RagRetrievalGateway` 平行。remote gateway provider 在 `rag-knowledge` adapter 选中时与 `ragRetrieval` 一起产出 `workflowRagRetrieval`（同一 endpoint，不同请求形状）。`agent-remote-deployment` 从同一 `NEXTAGENT_REMOTE_RAG_RETRIEVAL_ENDPOINT` 构造 `ReferenceRemoteWorkflowRagClient`，经 `VendorRemoteGatewayClients.workflowRagRetrieval` 注入 remote provider。local provider 不产出该字段（LOCAL 由 composition 从 governance 包装）。

来源：用户确认"实际上是一个检索服务，区别在于入参不一样，复用同一个 endpoint…不影响 rag tool"。

### 决策 10：composition 独立接线

`agent-app` composition 将 `WorkflowRagRetrievalGateway` 与 `RagRetrievalGateway` 独立接线。解析点在 `composeGatewayLayer`（同时持有 `gatewayBindings` 与 `ragKnowledgeGovernance`），产出 `workflowRagGateway` 传入 `composeWorkflowExecutionLayer`：

- `workflowRagGateway` 解析（镜像既有 `resolveRagRetrievalGateway`）：`gatewayBindings.workflowRagRetrieval` 存在（REMOTE）时直接用它；rag-knowledge 为 REMOTE 但无 binding（misconfiguration）时返回 unavailable gateway（启动期降级，不阻塞启动）；adapter 在运行时收到 `status === "UNAVAILABLE"` 时抛 `WORKFLOW_RAG_GATEWAY_UNAVAILABLE`（运行时 fail-fast，不静默吞错，避免节点把 UNAVAILABLE 当作"无结果"静默继续）；LOCAL 时用 `createLocalWorkflowRagGateway(ragKnowledgeGovernance)`。
- `mergeGatewayBindings` 必须合并 `workflowRagRetrieval` 字段（与 `ragRetrieval` 同形同策），否则 multi-provider 场景下该字段在 merge 阶段丢失，导致 REMOTE 路径误降级为 unavailable。这是 P0 修复点：`mergeGatewayBindingField` 的类型约束和 merged 对象展开都必须包含 `workflowRagRetrieval`。
- `composeWorkflowExecutionLayer` 入参新增 `workflowRagGateway: WorkflowRagRetrievalGateway`；`ensureBuilt` 复用既有 `ensureRagKnowledgeBuilt`（LOCAL 共享同一 governance build，REMOTE 为 no-op），不新增独立 ensure 函数。
- `createWorkflowRagKnowledgeRetrieverAdapter` 注入独立 `workflowRagGateway`，不再复用 `ragKnowledgeGovernance.gateway`。
- `RagRetrievalGateway`（服务 rag-tool）MUST NOT 受本变更影响。

来源：架构约束"agent-app 是唯一 composition root"、proposal"workflow RAG gateway 独立接线"。同形同策：与 `ragRetrieval`/`ragKnowledgeGovernance` 在 `composeGatewayLayer` 解析、产出独立 binding 传入下游的 pattern 一致。

## 同形同策例外（Same-Shape-Same-Policy Exception）

`WorkflowRagRetrievalGateway` 与 `RagRetrievalGateway` 是同类 port（检索 gateway），但不复用同一个 contract，原因：

- **输入信任边界不同**：`RagRetrievalGateway` 服务 rag-tool，输入来自模型输出（不可信），参数严格收窄（`indexes: string[]`，仅 `topK`）；`WorkflowRagRetrievalGateway` 服务 workflow 节点，输入来自 trusted recipe DSL，参数更丰富（`indexes: WorkflowRagRetrievalIndex[]`，含 per-index `indexType`/`vsTopN`/`esTopN`/`filters`）。
- **请求形状不同**：`indexes` 从 `string[]` 变为对象数组，承载 per-index 检索参数。

为避免相同语义的重复，`Options`（`{ topK }`）语义相同，直接复用既有 `RagRetrievalOptions`。`Result` 因远端返回结构不同而独立：`WorkflowRagRetrievalResult.recommends`（开放 `JsonObject[]`，承载 indexType-specific 异构字段）与 `RagRetrievalResult.results`（闭合 `RagRetrievalChunk[]`，`additionalProperties: false`）结构不兼容。例外范围：Request/Index 独立（信任边界和参数丰富度不同），Options 复用（语义相同），Result 独立（结构不兼容）。验证方式：contract test 断言 `WorkflowRagRetrievalGateway` 不含 provider 私有字段名（`vector`/`elasticsearch`/`embedding` 等），architecture test 断言 `agent-platform-gateway-remote` 不依赖 `agent-workflow`。

## 负面边界（Negative Cases）

- per-index `vsTopN`/`esTopN` 超出 1-20 范围 -> `WORKFLOW_NODE_INPUT_INVALID`。
- `indexType` 非法值（如 `"vector"`）-> `WORKFLOW_NODE_INPUT_INVALID`，field=`index_type`。
- adapter 不丢弃 per-index 参数（per-index 与节点级都到达 gateway 请求）。
- local 不因新参数失败（收到 per-index 参数仍返回 FTS5 BM25 结果）。
- remote 不过滤 per-index 参数（HTTP 请求体包含全部 per-index 参数）。
- rag-tool `RagRetrievalRequest` 不携带 per-index 或节点级 vsTopN/esTopN/filters（回归不变）。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | workflow RAG 输入来自 trusted recipe DSL；gateway contract 不含 provider 私有字段名；rag-tool 安全边界不变 | architecture test、contract test |
| 性能/容量 | per-index 参数解析与合并在本地 adapter，不增加远端往返；local 仍用单 FTS5 表 | adapter test、local gateway test |
| 可靠性/恢复 | local 忽略不支持的参数优雅降级；remote 透传失败时返回明确 status | local/remote gateway test |
| 可维护性 | gateway contract 提升到 `agent-contracts/gateway`，remote 不依赖 workflow；Options/Result 复用避免重复 | architecture assertion |
| 可测试性 | per-index 合并、indexType 默认填充、adapter 透传、local 降级、remote 透传均有独立测试入口 | unit + contract test |
| 可追溯性 | 检索结果 `WorkflowRagRetrievalResult.recommends` 保留远端原始结构，节点按 indexType 解析 | retrieval tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| indexType 枚举校验 + 默认填充 | 2.2, 2.3 | 节点 test：非法值失败、默认填充、用户覆盖、跨类型不过滤 |
| per-index 参数合并（per-index 优先、节点级 fallback） | 2.4, 3.1 | adapter test：override + fallback |
| topK = rankTopN | 2.4 | 节点 test：topK 不再受 vsTopN/esTopN 影响 |
| gateway contract 提升到 contracts | 1.1, 1.3 | `npm run build`、`npm run lint:architecture` |
| schema bounded 约束 | 1.2, 7.1 | contract test：valid/invalid case |
| adapter 无损透传 | 3.1 | adapter test：per-index + 节点级都到达 gateway 请求 |
| local 优雅降级 | 4.1 | local gateway test：新参数不报错、不改 BM25 行为 |
| remote 透传 + 复用同一 endpoint | 5.1 | remote gateway test：HTTP 体含 per-index 参数、响应 schema 校验 |
| composition 独立接线 | 6.1, 6.2 | composition/integration test：workflow RAG 与 rag-tool RAG 独立 |
| rag-tool 不受影响 | 7.4 | 回归 test：`RagRetrievalRequest` 不变 |
| enableQueryRewrite 不进入 gateway | 3.1 | adapter/contract test：gateway options 不含 enableQueryRewrite |
| remote workflow RAG gateway 经 GatewayBindings 进入 composition | 1.4, 5.3 | remote provider test：`gatewayBindings.workflowRagRetrieval` 为独立 client；composition test：REMOTE 用 binding、LOCAL 用 governance 包装 |
| Result 类型独立 + recommends 透传 | 3.2 | 节点 test：节点按 indexType 解析 recommends 字段正确、无截断、无 WorkflowKnowledgeDocument |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/workflow-knowledge-nodes/spec.md`、`openspec/specs/workflow-rag-gateway/spec.md`（本 change 新增 capability）
- 架构和跨模块设计：`openspec/designs/architecture/rag-knowledge-governance.md`（补充双 gateway port 边界）
- 模块设计：`openspec/designs/modules/agent-platform-gateway-local.md`、`openspec/designs/modules/agent-platform-gateway-remote.md`、`openspec/designs/modules/agent-app.md`
- ADR：无
- 导航：`openspec/designs/spec-to-design-map.md`

## 风险与取舍（Risks / Trade-offs）

- [风险] remote 复用同一 endpoint 要求远端检索服务能接受扩展后的请求形状（per-index 对象 + indexType）-> 本 change 只提供 reference passthrough 实现，远端服务能力由部署方保证；rag-tool 的最小形状保持向后兼容。
- [风险] per-index 合并放在 adapter 而非远端 -> 合并逻辑可测且 vendor 无关；代价是远端收到的是已合并值，无法区分 per-index 与节点级来源（按当前需求不需要区分）。
- [取舍] 不实现 enableQueryRewrite -> 保持 change 聚焦，避免引入未想清楚的半实现能力；后续如需改写，再单独 change 在节点层实现。

## 迁移计划（Migration Plan）

## 实现对账：Gateway port 依赖与 local provider owner

`agent-workflow` 与 `agent-capability` 同为 gateway port 的消费方：前者通过 `createWorkflowRagKnowledgeRetrieverAdapter` 消费 `WorkflowRagRetrievalGateway`，后者通过 Tool dependencies 消费 `RagRetrievalGateway`。两者只能依赖 `agent-contracts/gateway` 的 public port，不得依赖 local/remote platform implementation。dependency allowlist 与 architecture characterization MUST 按此同形同策。

`createWorkflowRagKnowledgeRetrieverAdapter` 继续归 `agent-workflow`，负责 trusted Recipe bindings、per-index 参数合并、scope request 组装、结果裁剪和 Workflow safe error。`createLocalWorkflowRagGateway` 归 `agent-platform-gateway-local`，负责把完整 Workflow gateway request 降级映射到 local FTS5 gateway；local RAG factory 在 provider owner 内同时产出 rag-tool gateway 与 workflow gateway，`agent-app` 只消费注入后的 binding 并选择 local/remote port，不静态导入 platform implementation。该 owner 修正不改变 gateway contract、remote wire request/response 或节点黑盒行为。

无数据迁移。本 change 扩展请求形状与 gateway contract；既有 recipe（不写 per-index 参数）行为不变（per-index 缺失时全部 fallback 节点级，与现状等价）。`WorkflowRagRetrievalGateway` 从 `agent-workflow` 内部定义迁移到 `agent-contracts/gateway` 并 re-export，调用方 import 路径不变（re-export 保持兼容）。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/workflow-knowledge-nodes/spec.md`：更新 Knowledge Search / Knowledge QA / API Choice / Recipe Choice 的输入约束与 indexType 默认填充语义。
- `openspec/specs/workflow-rag-gateway/spec.md`：新增 workflow RAG gateway contract（本 change 引入的新 capability baseline）。
- `openspec/specs/rag-knowledge-governance/spec.md`：补充 workflow RAG gateway 的 local 适配说明。
- `openspec/designs/architecture/rag-knowledge-governance.md`：补充双 gateway port 边界与同形同策例外。
- `openspec/designs/spec-to-design-map.md`：新增导航。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-9.6-执行知识节点` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/workflow-knowledge-nodes/spec.md`、`openspec/specs/workflow-rag-gateway/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。

## 归档阻塞记录（2026-07-31）

- **状态：**保持 active，禁止使用 `--skip-specs`。
- **原因：**stable `workflow-knowledge-nodes` 中找不到 `Knowledge Index Per-Index Parameters`，需先完成目标 Requirement 的迁移定位。
- **解除条件：**逐 Requirement 建立 delta、stable target、Function 与长期设计的双端映射；确认正文、元数据、Scenario 和任何 REMOVED→ADDED/MODIFIED 迁移均完整同步后，再重新执行 archive。
