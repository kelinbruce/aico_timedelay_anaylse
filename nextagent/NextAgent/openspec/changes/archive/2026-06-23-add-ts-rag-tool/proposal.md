## 背景与问题（Why）

`add-ts-rag-tool` 的目标是为 TS 后端提供 builtin `rag` Tool，让模型在 request 执行中的 capability invocation 阶段可以用自然语言查询当前 Agent 可用知识源，并获得有来源、有容量边界、安全可披露的 knowledge chunks。

知识治理、索引构建、workspace 文档扫描、chunk 生成和索引生命周期不属于 Tool 职责。它们由 `add-ts-rag-knowledge-governance` 单独定义。本 change 只定义 Tool 能力本身、Tool input/output、executor 和 retrieval gateway 调用边界。

## 变更范围（What Changes）

- 新增 builtin `rag` Tool descriptor、input schema、output schema 和 executor。
- 新增最小 `RagRetrievalGateway` contract，作为 `agent-capability` 和当前运行包已装配 retrieval provider 之间的 provider-neutral 边界。
- `rag` executor 从 capability invocation context 派生 trusted owner scope、agent scope 和 workspace/knowledge-source scope，调用 `RagRetrievalGateway.retrieve()`，并返回 safe Tool result。
- Tool input 只允许自然语言 `query`、provider-neutral logical `indexes` 和有限 result options；`indexes` 是 `list<string>`，表示当前 Agent 可用知识源中的逻辑索引选择，省略时默认为 `["local"]`；`topK` 省略时默认为 5，允许范围为 1-10。Tool input 不得携带 owner/agent/workspace/provider/deployment/provider-private connection/config/provider-private credential/host path/SQLite/FTS5 authority。
- retrieval gateway 不可用、索引未就绪、scope mismatch、超时、取消、查询失败或返回无效结果时，Tool 返回 explicit degraded/unavailable/failed result 和安全 diagnostics，不伪装为空成功。

## Capability 影响（Capabilities）

### 新增 Capability

- `rag-tool`：查询型 builtin Tool。模型提供自然语言 `query` 和有限检索选项，系统在 trusted owner scope、agent scope 和当前 Agent 可用知识源范围下调用已装配的 RAG retrieval gateway，返回可追溯 knowledge chunks 或显式 degraded/unavailable 结果。

### 修改的 Capability

无。`glob-tool`、`grep-tool`、`read-tool`、`write-tool`、`bash-tool`、`python-tool` 等既有 Tool 行为不变。

## 影响范围（Impact）

- `agent-contracts/gateway`：新增最小 RAG retrieval gateway port 和 DTO。DTO 只表达 provider-neutral 的 `query`、logical `indexes`、trusted scopes、bounded result options、safe result shape 和低基数 diagnostics；不得泄漏 host path、workspace root、SQLite row、FTS5 expression、provider-private wire fields、provider-private connection/config、provider-private credential 或 provider 私有错误。
- `agent-capability`：新增 builtin `rag` Tool descriptor、schema、executor 和 contract tests。executor 只做 Tool 输入治理、调用 RAG gateway、返回安全 Tool result。
- `agent-app`：在 trusted composition 中把当前包已装配的 `RagRetrievalGateway` 注入 builtin Tool dependency；用户请求体、模型输出和 Tool 参数不得覆盖 provider 选择或 trusted scopes。
- retrieval provider owner：具体 retrieval provider 由产品 composition/打包形态提供；部署形态不改变 Tool 语义。local mode 通过同一个 `RagRetrievalGateway` public port 接到本地 SQLite FTS/FTS5 fallback provider；remote mode 通过同一个 `RagRetrievalGateway` public port 接到真实 RAG 服务。local provider 的本地 FTS5 数据读取和治理状态消费由 `add-ts-rag-knowledge-governance` 定义；其他 provider 的私有接入细节不进入本 change。
- `agent-observability`：只记录安全低基数字段，例如 capability id、invocation id、status、result count、duration bucket 和 reason code；不得记录 raw query、content、host path、workspace root、provider-private connection/config、provider-private credential 或 provider raw error。
- 测试：新增 Tool contract、executor、gateway contract、scope/input negative、provider unavailable、bounded result 和 observability redaction tests。

## 需群内确认

- `agent-contracts/gateway` 新增 `RagRetrievalGateway` public port、request/result/chunk DTO 和 status/reason vocabulary。该变更是新的 gateway contract surface，需在实现前完成群内确认；实现不得把 provider 私有字段泄漏进 public contract。

## 主要 Owner

- Tool capability owner：`agent-capability`
- Gateway contract owner：`agent-contracts/gateway`
- Product composition owner：`agent-app`

## 非目标（Non-Goals）

- 不定义知识治理、索引构建、workspace 扫描、chunk 切分、本地 FTS5 查询实现或治理 lifecycle；local fallback 的这些行为由 `add-ts-rag-knowledge-governance` 定义。
- 不定义任何 provider-private wire contract、索引绑定、召回参数、排序协议、connection/config 或 credential；public `indexes` 只表达 provider-neutral logical index names，不表达 provider 私有索引绑定或召回参数。
- 不实现 embedding、向量库、LLM reranker、代码图检索或混合检索。
- 不实现自研 ranking/rerank、BM25 min-max 归一化、score breakdown、term coverage、proximity、symbol boost、penalty 或 tie-break 体系。
- 不新增 Web API、stream event、UI 或用户直接调用的搜索接口。
- 不允许 Tool input 或模型输出选择 provider、deployment branch、provider-private connection/config、provider-private credential、workspace root 或底层查询表达式。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/rag-tool/spec.md`：新增 builtin RAG Tool 的 input/output、gateway invocation、failure/degradation 和 safe observability 行为契约。

长期背景：
- `openspec/overview.md`：补充 `rag` Tool 是 capability 中的查询入口，知识治理由独立能力承载。

设计视图：
- `openspec/designs/architecture/rag-tool.md`：承载 Tool -> gateway -> provider 的跨模块调用链、scope 派生和失败边界。
- `openspec/designs/modules/agent-capability.md`：补充 builtin `rag` Tool descriptor/executor 职责。
- `openspec/designs/modules/agent-app.md`：补充 `RagRetrievalGateway` dependency 注入。
- `openspec/designs/spec-to-design-map.md`：新增导航。

验证入口：
- `npm run build`
- `npm test`
- `npm run test:contract`
- `npm run lint:architecture`
- `openspec validate add-ts-rag-tool --strict`
- `openspec validate --all --strict`
