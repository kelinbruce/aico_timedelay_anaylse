## 背景与问题（Why）

workflow knowledge 节点（`knowledge-search` / `knowledge-qa` / `api-choice` / `recipe-choice`）通过 `node.inputs.rag_index` 声明检索索引。当前实现存在三个缺口：

1. **`indexType` 是 dead field**。`parseKnowledgeIndexes` 解析并存储了 `indexType: string`，但全仓无任何代码消费它，没有枚举校验，也没有按 indexType 做节点默认填充或远端语义传递。测试里用的值是 `"vector"`/`"es"`，与电信场景需要的 `API`/`RECIPE`/`KNOWLEDGE` 不一致。
2. **per-index 参数不支持**。`vsTopN`/`esTopN`/`filters` 是节点级标量，无法为每个索引项单独指定召回预算和过滤条件。电信场景中不同索引（API 目录、RECIPE 目录、知识库）召回策略差异大，需要 per-index 控制。
3. **gateway 层参数丢失**。`WorkflowRagRetrievalRequest.indexes` 只是 `readonly string[]`（纯索引名），`options` 只有 `{ topK }`，adapter 把节点级 `vsTopN`/`esTopN`/`filters` 和 `indexType` 全部丢弃，导致 remote 模式下远端收不到这些参数，无法执行向量召回、ES 召回或过滤。

此外，`WorkflowRagRetrievalGateway` 当前定义在 `agent-workflow` 包内且未导出，remote 实现需要由 `agent-platform-gateway-remote` 提供，但 gateway 包不能依赖 workflow 包（依赖方向反了）。当前 composition 把 workflow RAG 复用为 rag-tool 的 `RagRetrievalGateway` 实例，两者共享同一 gateway，靠结构兼容复用。

## 变更范围（What Changes）

- **扩展** `WorkflowKnowledgeIndex`：新增 `indexType?: "API" | "RECIPE" | "KNOWLEDGE"`（由 `string` 收窄）、`vsTopN?`、`esTopN?`、`filters?` per-index 字段。
- **新增** indexType 节点默认填充语义：`api-choice` 默认 `API`，`knowledge-search`/`knowledge-qa` 默认 `KNOWLEDGE`，`recipe-choice` 默认 `RECIPE`；用户显式指定的 `indexType` 覆盖节点默认。
- **新增** per-index 参数与节点级参数合并规则：per-index 值优先，缺失时 fallback 到节点级参数；合并发生在 adapter。
- **简化** `topK = rankTopN`（移除 `vsTopN`/`esTopN` 参与 topK 计算的逻辑）。
- **移除** `WorkflowKnowledgeDocument` 中间映射层，gateway 结果直接以 `recommends: readonly JsonObject[]` 透传给节点；节点按 `indexType` 解析各自所需字段（KNOWLEDGE/RECIPE/API 各有不同字段集）。
- **提升** `WorkflowRagRetrievalGateway`/`Request`/`Index` 从 `agent-workflow` 到 `agent-contracts/gateway`，与 `RagRetrievalGateway` 平行；`options` 复用既有 `RagRetrievalOptions`（`{ topK }`），Result 独立为 `WorkflowRagRetrievalResult`（`recommends: readonly JsonObject[]`，开放结构，承载 indexType-specific 的远端原始结果）。
- **新增** `agent-platform-gateway-local` 的 `WorkflowRagRetrievalGateway` 适配实现（复用 FTS5 governance，忽略不支持的参数）。
- **新增** `agent-platform-gateway-remote` 的 `WorkflowRagRetrievalGateway` 透传实现 + JSON Schema 校验；remote 复用既有 `NEXTAGENT_REMOTE_RAG_RETRIEVAL_ENDPOINT`，不新增环境变量。
- **调整** `agent-app` composition：workflow RAG gateway 独立接线，与 rag-tool 的 `RagRetrievalGateway` 分离。

## Capability 影响（Capabilities）

### 修改的 Capability

- `workflow-knowledge-nodes`：indexType 默认填充、per-index 参数解析、合并规则、topK 简化
- `agent-platform-gateway-local`：新增 workflow RAG gateway 适配
- `agent-platform-gateway-remote`：新增 workflow RAG gateway 透传
- `agent-app` composition：workflow RAG gateway 独立接线

### 新增的 Capability

- `workflow-rag-gateway`：workflow RAG 检索 gateway port 契约（local 适配 + remote 透传 + composition 接线）

## 影响范围（Impact）

- `agent-contracts/gateway`：新增 `WorkflowRagRetrievalGateway`/`Request`/`Index` contract + `workflowRagRetrievalRequestSchema`（复用 `RagRetrievalOptions`；`Result` 独立为 `WorkflowRagRetrievalResult`（含 `workflowRagRetrievalResultSchema`））；`GatewayBindings` 新增可选 `workflowRagRetrieval?` 字段
- `agent-remote-deployment`：从同一 `NEXTAGENT_REMOTE_RAG_RETRIEVAL_ENDPOINT` 构造 workflow RAG remote client，经 `VendorRemoteGatewayClients.workflowRagRetrieval` 注入
- `agent-workflow`：扩展 `WorkflowKnowledgeIndex`、`WorkflowKnowledgeRetrievalRequest`（新增 `defaultIndexType`）；adapter 无损翻译 + 合并；简化 topK；移除内部 gateway 类型定义改为 re-export
- `agent-platform-gateway-local`：新增 workflow RAG gateway 适配
- `agent-platform-gateway-remote`：新增 workflow RAG gateway 透传 + schema 校验
- `agent-app`：composition 层 workflow RAG gateway 独立解析与接线
- `rag-tool`（`RagRetrievalGateway`）：不受影响，保持现有安全边界

## 职责边界对齐（Boundary Alignment）

- 与 `rag-knowledge-governance`：`RagRetrievalGateway` 继续服务 rag-tool，安全边界不变（模型输出不可信，参数严格收窄）；`WorkflowRagRetrievalGateway` 服务 workflow 节点，输入来自 trusted recipe DSL，参数更丰富。两者平行，互不影响。`Options` 语义相同直接复用；`Result` 因远端返回结构不同（`recommends` 开放对象数组 vs `RagRetrievalResult.results` 闭合 `RagRetrievalChunk` 数组）而独立，`Request`/`Index` 因信任边界和参数丰富度不同而独立（同形同策例外已在 design 文档化）。
- 与 `add-ts-workflow-knowledge-nodes`（已归档）：本 change 不改节点双模式分流（candidate 优先 / RAG 回退），只扩展 RAG 调用的参数承载和 indexType 语义。
- 与 `agent-platform-gateway-local`：local 作为 fallback provider，忽略不支持的 per-index 参数（vsTopN/esTopN/filters），仅用 topK + FTS5 BM25，符合 local 轻量降级定位。
- 与 `enableQueryRewrite`：本 change 不实现 query rewrite，不把 `enableQueryRewrite` 加入 gateway contract；既有节点级字段保持原样。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/workflow-knowledge-nodes/spec.md`：更新 Knowledge Search / Knowledge QA / API Choice / Recipe Choice 的输入约束与 indexType 默认填充语义
- `openspec/specs/workflow-rag-gateway/spec.md`：新增 workflow RAG gateway contract baseline
- `openspec/specs/rag-knowledge-governance/spec.md`：补充 workflow RAG gateway 的 local 适配说明
- `openspec/designs/architecture/rag-knowledge-governance.md`：补充双 gateway port 边界与同形同策例外

## 验证入口（Validation）

- Contract test：`workflowRagRetrievalRequestSchema` 覆盖 per-index 参数的 valid/invalid case
- Adapter test：per-index `vsTopN`/`esTopN`/`filters` 优先于节点级，缺失时 fallback 正确；`options` 不含 `enableQueryRewrite`
- Node/adapter test：节点按 indexType 解析 `recommends` 字段正确、无截断、无 `WorkflowKnowledgeDocument` 中间映射
- Node test：indexType 默认填充正确，用户显式指定时覆盖默认；topK = rankTopN
- Local gateway test：收到 per-index 参数不报错、不改变现有 BM25 行为、governance 未 ready 返回 NO_INDEX
- Remote gateway test：HTTP 请求体包含 per-index 参数、响应 schema 校验生效、失败返回明确 status、复用同一 endpoint
- Architecture test：`agent-platform-gateway-remote` 不依赖 `agent-workflow`；`WorkflowRagRetrievalGateway` 不含 provider 私有字段名
- 回归 test：现有 recipe（不写 per-index 参数）行为不变；rag-tool `RagRetrievalGateway` 不受影响
