## 1. Gateway contract 提升

- [x] 1.1 在 `agent-contracts/gateway` 新增 `WorkflowRagRetrievalIndex`/`WorkflowRagRetrievalRequest`/`WorkflowRagRetrievalGateway` 类型定义（`options` 复用既有 `RagRetrievalOptions`，Result 独立为 `WorkflowRagRetrievalResult`）
  验证：`npm run build`
  来源：design D6

- [x] 1.2 新增 `workflowRagRetrievalRequestSchema`（JSON Schema，`additionalProperties: false`，bounded 约束 per-index 字段；`indexType` 枚举 `API`/`RECIPE`/`KNOWLEDGE` 必填）
  验证：contract test 覆盖 valid/invalid case
  来源：design D6

- [x] 1.3 从 `agent-workflow/runtime-node-adapters.ts` 移除内部 `WorkflowRagRetrievalGateway`/`Request`/`Result` 定义，改为从 `agent-contracts/gateway` re-export
  验证：`npm run build`；`npm run lint:architecture` 断言 `agent-platform-gateway-remote` 不依赖 `agent-workflow`
  来源：design D6

- [x] 1.4 `GatewayBindings`（`agent-contracts/gateway`）新增可选字段 `workflowRagRetrieval?: WorkflowRagRetrievalGateway`，与 `ragRetrieval?` 平行
  验证：`npm run build`
  来源：design D9、D10

## 2. 节点层 contract 扩展

- [x] 2.1 扩展 `WorkflowKnowledgeIndex`：`indexType` 由 `string` 收窄为 `"API" | "RECIPE" | "KNOWLEDGE"`，新增 `vsTopN?`/`esTopN?`/`filters?`；`WorkflowKnowledgeRetrievalRequest` 新增 `defaultIndexType: "API" | "RECIPE" | "KNOWLEDGE"`
  验证：`npm run build`
  来源：design D1、D2

- [x] 2.2 `parseKnowledgeIndexes` 解析 per-index `indexType`/`vsTopN`/`esTopN`/`filters`；`indexType` 枚举校验（非法值抛 `WORKFLOW_NODE_INPUT_INVALID`，field=`index_type`）；`vsTopN`/`esTopN` 复用 `readBoundedInt` 1-20 约束
  验证：节点 test 覆盖非法 indexType 失败、超范围失败 case
  来源：design D1

- [x] 2.3 indexType 节点默认填充：`retrieveKnowledge(context, options, defaultIndexType)` 写入 `request.defaultIndexType`；四节点传入各自默认值（`KNOWLEDGE`/`KNOWLEDGE`/`API`/`RECIPE`）
  验证：节点 test 覆盖默认填充 + 用户覆盖 + 跨类型不过滤
  来源：design D2

- [x] 2.4 `topK = rankTopN`（简化，移除 `Math.min/max(vsTopN,esTopN)` 计算）；per-index 参数合并由 adapter 完成
  验证：节点 test 覆盖 topK 不再受 vsTopN/esTopN 影响
  来源：design D3、D4

## 3. Adapter 无损翻译

- [x] 3.1 `createWorkflowRagKnowledgeRetrieverAdapter`：`indexes` 每项含 resolved `indexType`（`item.indexType ?? request.defaultIndexType`）+ resolved per-index `vsTopN`/`esTopN`/`filters`（per-index ?? 节点级）；`options` 只含 `topK`；不透传 `enableQueryRewrite`
  验证：adapter test 断言 per-index + 节点级都到达 gateway 请求、`options` 不含 `enableQueryRewrite`
  来源：design D5、D7

- [x] 3.2 移除 `WorkflowKnowledgeDocument` 中间映射层：`WorkflowKnowledgeRetrievalResult.documents` 改为 `recommends: readonly JsonObject[]`；adapter 直接返回 gateway `recommends`，不做字段映射或截断；节点按 `indexType` 解析 `recommends` 元素
  验证：adapter test 断言 per-index + 节点级都到达 gateway 请求、`options` 不含 `enableQueryRewrite`
  验证：节点 test 断言 `recommends` 保留原始结构、按 indexType 解析字段正确、无 `WorkflowKnowledgeDocument`
  来源：design D6、D7、D11

## 4. Local gateway 适配

- [x] 4.1 在 `agent-platform-gateway-local` 新增 `createLocalWorkflowRagGateway(governance)`，包装 `LocalRagKnowledgeGovernance`，忽略 indexType/per-index vsTopN/esTopN/filters，提取 `indexName` + `topK` 调用 FTS5 BM25
  验证：local gateway test 覆盖收到新参数不报错、不改变 BM25 行为、governance 未 ready 返回 NO_INDEX
  来源：design D8

## 5. Remote gateway 透传

- [x] 5.1 在 `agent-platform-gateway-remote` 新增 `createReferenceRemoteWorkflowRagGateway(client)` + `createHttpWorkflowRagClient(endpoint)`，整体 JSON 透传 + `ragRetrievalResultSchema` 校验
  验证：remote gateway test 断言 HTTP 请求体包含 per-index 参数、响应 schema 校验生效、失败返回明确 status
  来源：design D9

- [x] 5.2 remote 复用既有 `NEXTAGENT_REMOTE_RAG_RETRIEVAL_ENDPOINT`，不新增环境变量、不加路径后缀；remote deployment wiring 中 workflow RAG client 用同一 endpoint
  验证：remote deployment test 断言不读取 `NEXTAGENT_REMOTE_WORKFLOW_RAG_ENDPOINT`、POST 到同一 endpoint
  来源：design D9

- [x] 5.3 remote gateway provider 在 `rag-knowledge` 选中时与 `ragRetrieval` 一起产出 `workflowRagRetrieval`（`createReferenceRemoteWorkflowRagGateway`，独立 client）；`agent-remote-deployment` 经 `VendorRemoteGatewayClients.workflowRagRetrieval` 从同一 endpoint 注入
  验证：remote provider test 断言 `gatewayBindings.workflowRagRetrieval` 存在且为独立 client
  来源：design D9

## 6. Composition 接线

- [x] 6.1 `composeGatewayLayer` 解析 `workflowRagGateway`：`gatewayBindings.workflowRagRetrieval` 存在（REMOTE）时用它；LOCAL 时用 `createLocalWorkflowRagGateway(ragKnowledgeGovernance)`；REMOTE 无 binding 时 unavailable；产出 `workflowRagGateway` 传入 `composeWorkflowExecutionLayer`（`ensureBuilt` 复用 `ensureRagKnowledgeBuilt`）
  验证：`npm run build`；composition test
  来源：design D10

- [x] 6.2 `workflow-composition.ts` 的 `retrieveKnowledge` 注入独立 `workflowRagGateway`，不再复用 `ragKnowledgeGovernance.gateway`
  验证：`npm run build`；integration test 断言 workflow RAG 与 rag-tool RAG 独立
  来源：design D10

## 7. 验证

- [x] 7.1 Contract test：`workflowRagRetrievalRequestSchema` valid/invalid case（per-index 参数、indexType 枚举、topN 范围、filters 结构）
  验证：`npm run test:contract`
  来源：design D6

- [x] 7.2 Architecture test：`agent-platform-gateway-remote` 不依赖 `agent-workflow`；`WorkflowRagRetrievalGateway` contract 不含 provider 私有字段名（`vector`/`elasticsearch`/`embedding` 等）
  验证：`npm run lint:architecture`
  来源：design 同形同策例外

- [x] 7.3 负面边界 test：per-index vsTopN/esTopN 超范围失败；indexType 非法值失败；adapter 不丢弃 per-index 参数；local 不因新参数失败；remote 不过滤 per-index 参数
  验证：`npm test`
  来源：design 负面边界

- [x] 7.4 回归 test：现有 recipe（不写 per-index 参数）行为不变；rag-tool `RagRetrievalGateway` 不受影响；gateway `options` 不含 `enableQueryRewrite`；rag-tool `safeResultPayload` 不走 workflow result 映射、不受影响
  验证：`npm test`
  来源：design D3、D5、D11 向后兼容

## 8. 实现对账修正

- [x] 8.1 将 `createLocalWorkflowRagGateway` 从 `agent-workflow` 移到 `agent-platform-gateway-local` public export，保持 `agent-app` 的 LOCAL/REMOTE 选择和注入行为不变，并把 local adapter UT 移到 provider owner
  验证：local workflow RAG gateway test + composition tests
  来源：proposal local adapter owner、design D8/D10

- [x] 8.2 将 `agent-workflow` 对 public `agent-contracts/gateway` port 的依赖纳入 architecture allowlist；characterization test 必须允许 contract port，同时禁止 `agent-workflow` 依赖 local/remote platform implementation，并断言 local provider 不反向依赖 workflow
  验证：`npm run lint:architecture`
  来源：design 实现对账、与 rag-tool 同形同策

- [x] 8.3 修正 `api-choice` RAG 路径的 Recipe 1.0 DSL 输出，仅发布固定 `api_name` 与 `recall_result`
  验证：`npm test`、`npm run test:contract`
  来源：spec scenario `API-choice two-phase retrieval`
