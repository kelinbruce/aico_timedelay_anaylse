## Purpose

定义 workflow RAG 检索 gateway port，服务 workflow knowledge 节点，与 rag-tool 的 `RagRetrievalGateway` 平行。承载 per-index 检索参数，支持 remote 透传和 local 降级。

## ADDED Requirements

### Requirement: Workflow Rag Retrieval Gateway Contract

`agent-contracts/gateway` SHALL 定义 `WorkflowRagRetrievalGateway` port，与 `RagRetrievalGateway` 平行。该 port 承载 workflow 节点的完整检索参数：per-index 的 `indexType`/`vsTopN`/`esTopN`/`filters`（已与节点级合并）和节点级的 `topK`。

```typescript
interface WorkflowRagRetrievalIndex {
  indexName: string
  indexType: "API" | "RECIPE" | "KNOWLEDGE"
  domain?, scene?, priority?
  vsTopN?, esTopN?, filters?
}

interface WorkflowRagRetrievalRequest extends OwnerScoped {
  agentId, agentVersion
  knowledgeScope: { scopeKind: "AGENT_WORKSPACE", logicalRoot: "workspace" }
  query: string
  indexes: readonly WorkflowRagRetrievalIndex[]
  options: RagRetrievalOptions   // 复用既有 { topK }
}

interface WorkflowRagRetrievalResult {
  status: "OK" | "NO_INDEX" | "UNAVAILABLE" | "DEGRADED" | "FAILED" | "TIMEOUT" | "CANCELED"
  recommends: readonly JsonObject[]
  diagnostics?: string
}

interface WorkflowRagRetrievalGateway {
  retrieve(request, signal?): Promise<WorkflowRagRetrievalResult>
}
```

`options` 复用既有 `RagRetrievalOptions`（`{ topK }`）。`Result` 独立为 `WorkflowRagRetrievalResult`：`recommends` 为开放对象数组（`readonly JsonObject[]`），保留远端按 indexType 返回的异构原始结构（KNOWLEDGE/RECIPE/API 各有不同字段集），不做闭合 schema 约束。不复用 `RagRetrievalResult`（其 `results: RagRetrievalChunk[]` 为闭合结构，`additionalProperties: false`，无法承载异构字段）。`indexType` 由节点默认填充后透传（adapter 解析 `resolvedIndexType = item.indexType ?? nodeDefault`），在 gateway 请求中为必填。

`indexType` 是远端检索接口的入参（用于选择检索策略），不是本地过滤条件。HTTP 是不可信边界，MUST 定义 `workflowRagRetrievalRequestSchema`（JSON Schema，`additionalProperties: false`，bounded 约束 per-index 字段）用于 runtime validation。响应校验使用新增 `workflowRagRetrievalResultSchema`（校验 `status` 枚举 + `recommends` 为数组，元素为开放对象）。gateway contract MUST NOT 含 provider 私有字段名（`vector`/`elasticsearch`/`embedding` 等）。

**触发机制：**
- workflow knowledge 节点执行 RAG 检索时同步触发
- 位于 workflow execution 阶段，adapter 翻译后同步调用 gateway、异步等待结果

**输入与前置条件：**
- `WorkflowRagRetrievalRequest`（含 resolved per-index 参数 + `topK`）
- trusted recipe DSL 解析的 owner scope（`tenantId`/`subjectId`/`agentId`/`agentVersion`）

**输出与副作用：**
- `WorkflowRagRetrievalResult`（`status`/`recommends`/`diagnostics?`）
- 不产生持久化副作用；检索结果供节点裁剪与组装

**核心判断逻辑：**
1. local 实现：忽略不支持参数，提取 `indexName` + `topK` 调用 FTS5 governance
2. remote 实现：整体 JSON POST，响应经 schema 校验
3. 不在 gateway 层做 per-index 合并（合并已在 adapter 完成）

**失败与降级：**
- local governance 未 ready -> 返回 `NO_INDEX`/`UNAVAILABLE`
- remote 错误或超时 -> 返回 `FAILED`/`TIMEOUT`，不得静默吞错或伪装空成功

#### Scenario: Contract carries per-index parameters
- **GIVEN** workflow 节点解析出含 per-index `vsTopN`/`esTopN`/`filters` 的索引项
- **WHEN** adapter 翻译为 `WorkflowRagRetrievalRequest`
- **THEN** `indexes` 每项 MUST 包含 `indexName`、`indexType` 和 per-index override
- **AND** `options` MUST 只含 `topK`

#### Scenario: Schema rejects invalid indexType
- **GIVEN** `WorkflowRagRetrievalRequest` 的 `indexes` 项 `indexType` 为 `"vector"`
- **WHEN** runtime schema validation 执行
- **THEN** MUST 校验失败

#### Scenario: Gateway options carry no enableQueryRewrite
- **GIVEN** workflow 节点执行检索
- **WHEN** adapter 构建 `WorkflowRagRetrievalRequest`
- **THEN** `options` MUST NOT 含 `enableQueryRewrite`
- **AND** gateway contract MUST NOT 定义 `enableQueryRewrite` 字段

#### Scenario: Gateway contract free of provider-private fields
- **GIVEN** `WorkflowRagRetrievalGateway` contract 定义
- **WHEN** architecture test 检查字段名
- **THEN** MUST NOT 含 `vector`/`elasticsearch`/`embedding` 等 provider 私有字段名

### Requirement: Local Workflow Rag Gateway Graceful Degradation

`agent-platform-gateway-local` SHALL 提供 `WorkflowRagRetrievalGateway` 的 local 适配实现，复用 `LocalRagKnowledgeGovernance` 的 FTS5 索引。`createLocalWorkflowRagGateway(governance)` 包装 `LocalRagKnowledgeGovernance`。

local 实现 MUST 对不支持的参数优雅降级：
- 忽略 `indexType`（FTS5 单表不区分索引类型）
- 忽略 per-index `vsTopN`/`esTopN`/`filters`
- 使用 `options.topK`（`clampTopK` 压到 [1,10]）
- 提取 `indexes` 的 `indexName` 作为 FTS5 检索输入（local 单表检索）
- MUST NOT 因收到新参数而报错或改变现有 BM25 行为

#### Scenario: Local gateway ignores per-index params without error
- **GIVEN** local governance 已 build ready
- **AND** `WorkflowRagRetrievalRequest` 包含 per-index `vsTopN`/`esTopN`/`filters` 和 `indexType`
- **WHEN** local gateway retrieve 执行
- **THEN** MUST 返回 FTS5 BM25 结果
- **AND** MUST NOT 因 per-index 参数报错

#### Scenario: Local gateway returns unavailable when governance not ready
- **GIVEN** local governance 未 build（status 非 READY）
- **WHEN** local gateway retrieve 执行
- **THEN** MUST 返回 `NO_INDEX` 或 `UNAVAILABLE`
- **AND** MUST NOT 伪装为空成功

### Requirement: Remote Workflow Rag Gateway Transparent Passthrough

`agent-platform-gateway-remote` SHALL 提供 `WorkflowRagRetrievalGateway` 的 remote 透传实现。HTTP client MUST 透传 `WorkflowRagRetrievalRequest` 的所有 per-index 参数，HTTP transport 层将 contract 字段 `indexes`/`indexName` 映射为平台 wire format 字段 `ragIndexes`/`ragIndex`（仅字段名转换，MUST NOT 过滤或丢弃参数值），整体 JSON POST，响应 MUST 经 `workflowRagRetrievalResultSchema` 校验。

remote gateway MUST NOT 过滤、改写或丢弃 per-index 参数。
mapping 是 HTTP transport 层关注点，contract 层（`agent-contracts/gateway`）保持 provider-neutral 命名 `indexes`/`indexName`，与 `RagRetrievalRequest.indexes` 同形同策；平台 wire format `ragIndexes`/`ragIndex` 不进入 contract。

remote 复用既有 `NEXTAGENT_REMOTE_RAG_RETRIEVAL_ENDPOINT`（同一个检索服务，区别仅在入参更丰富）。不新增环境变量、不加路径后缀。rag-tool 的 `RagRetrievalGateway` 客户端、请求形状、严格 schema 均不变。

#### Scenario: Remote gateway passes through per-index params
- **GIVEN** `WorkflowRagRetrievalRequest` 包含 per-index `vsTopN`/`esTopN`/`filters`/`indexType`
- **WHEN** remote gateway retrieve 执行
- **THEN** HTTP 请求体 MUST 包含所有 per-index 参数（`ragIndex`/`indexType`/`vsTopN`/`esTopN`/`filters`）
- **AND** HTTP 请求体 MUST 使用平台 wire format 字段名 `ragIndexes`（数组）/`ragIndex`（元素），MUST NOT 使用 contract 字段名 `indexes`/`indexName`
- **AND** 响应 MUST 经 schema 校验

#### Scenario: Remote gateway reuses rag-tool endpoint
- **GIVEN** remote deployment 配置了 `NEXTAGENT_REMOTE_RAG_RETRIEVAL_ENDPOINT`
- **WHEN** workflow RAG remote gateway 执行
- **THEN** MUST POST 到同一 endpoint
- **AND** MUST NOT 读取 `NEXTAGENT_REMOTE_WORKFLOW_RAG_ENDPOINT`

#### Scenario: Remote gateway failure returns explicit status
- **GIVEN** 远端检索服务返回错误或超时
- **WHEN** remote gateway retrieve 执行
- **THEN** MUST 返回明确 `FAILED`/`TIMEOUT` status
- **AND** MUST NOT 静默吞错或伪装为空成功

### Requirement: Composition Wiring Separation

`agent-app` composition SHALL 将 `WorkflowRagRetrievalGateway` 与 `RagRetrievalGateway` 独立接线。`GatewayBindings`（`agent-contracts/gateway`）新增可选字段 `workflowRagRetrieval?: WorkflowRagRetrievalGateway`，与既有 `ragRetrieval?: RagRetrievalGateway` 平行。解析点在 `composeGatewayLayer`，产出 `workflowRagGateway` 传入 `composeWorkflowExecutionLayer`。

解析规则（镜像既有 `resolveRagRetrievalGateway`）：`gatewayBindings.workflowRagRetrieval` 存在（REMOTE）时直接用；rag-knowledge 为 REMOTE 但无 binding（misconfiguration）时返回 unavailable gateway（启动期降级，不阻塞启动）；LOCAL 时用 `createLocalWorkflowRagGateway(ragKnowledgeGovernance)`。remote gateway provider 在 `rag-knowledge` 选中时与 `ragRetrieval` 一起产出 `workflowRagRetrieval`（同一 endpoint，独立 client）。
adapter（`createWorkflowRagKnowledgeRetrieverAdapter`）在运行时收到 `status === "UNAVAILABLE"` 时 MUST 抛 `WORKFLOW_RAG_GATEWAY_UNAVAILABLE`（运行时 fail-fast），MUST NOT 把 UNAVAILABLE 当作空结果静默继续。启动期降级 + 运行时 fail-fast 组合：不阻塞不使用 workflow RAG 的部署启动，但真正调用节点时不静默吞错。`mergeGatewayBindings` 必须合并 `workflowRagRetrieval` 字段（与 `ragRetrieval` 同形同策），否则 multi-provider 场景下该字段在 merge 阶段丢失，导致 REMOTE 路径误降级为 unavailable。

`RagRetrievalGateway`（服务 rag-tool）MUST NOT 受本变更影响，保持现有安全边界和参数收窄。

#### Scenario: Workflow RAG gateway wired independently
- **GIVEN** app composition 配置了 `rag-knowledge` gateway selection
- **WHEN** workflow-composition 注入 `retrieveKnowledge`
- **THEN** MUST 注入独立的 `WorkflowRagRetrievalGateway`
- **AND** MUST NOT 复用 `RagRetrievalGateway` 实例

#### Scenario: Remote workflow RAG gateway enters via GatewayBindings
- **GIVEN** rag-knowledge gateway 为 REMOTE 且 remote provider 产出了 `workflowRagRetrieval`
- **WHEN** composeGatewayLayer 解析 workflowRagGateway
- **THEN** MUST 使用 `gatewayBindings.workflowRagRetrieval`
- **AND** MUST NOT 用 `ragKnowledgeGovernance.gateway`（其请求形状为 `RagRetrievalRequest`，不含 per-index 参数）

#### Scenario: Local workflow RAG gateway wraps governance
- **GIVEN** rag-knowledge gateway 为 LOCAL
- **WHEN** composeGatewayLayer 解析 workflowRagGateway
- **THEN** MUST 用 `createLocalWorkflowRagGateway(ragKnowledgeGovernance)`
- **AND** `ensureBuilt` MUST 复用 `ensureRagKnowledgeBuilt`

#### Scenario: Rag-tool gateway unaffected
- **GIVEN** 本变更已实施
- **WHEN** rag-tool 调用 `RagRetrievalGateway.retrieve`
- **THEN** `RagRetrievalRequest` MUST 保持只有 `query`/`indexes`/`topK`
- **AND** MUST NOT 携带 per-index 或节点级 vsTopN/esTopN/filters

#### Scenario: Adapter fails fast on UNAVAILABLE gateway
- **GIVEN** workflow RAG gateway 返回 `status === "UNAVAILABLE"`（如 REMOTE 模式下 `workflowRagRetrieval` binding 缺失）
- **WHEN** adapter 调用 gateway retrieve
- **THEN** MUST 抛 `WORKFLOW_RAG_GATEWAY_UNAVAILABLE`
- **AND** MUST NOT 把 UNAVAILABLE 当作空结果静默继续

#### Scenario: mergeGatewayBindings preserves workflowRagRetrieval across multi-provider merge
- **GIVEN** multi-provider 场景（如 local persistence providers + remote provider）且 remote provider 产出了 `workflowRagRetrieval` binding
- **WHEN** composeGatewayLayer 合并 provider bindings
- **THEN** merged bindings MUST 保留 `workflowRagRetrieval` 字段
- **AND** MUST NOT 在 merge 阶段静默丢弃该字段导致 REMOTE 误降级为 unavailable
