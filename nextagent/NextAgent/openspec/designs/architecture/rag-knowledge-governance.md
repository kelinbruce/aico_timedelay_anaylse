# RAG Knowledge Governance

本设计承载本地 RAG knowledge governance 的长期事实。行为性要求由 `openspec/specs/rag-knowledge-governance/spec.md` 承载；本文件只记录治理触发、数据生命周期和模块 owner。

## 目标

本能力只解决 local deployment 下 `rag` Tool 的受治理语料可用性。它在 startup 期把 trusted workspace read scope 内的安全文本文件编译为临时检索数据，并把结果交给本地 retrieval provider 使用。该临时索引是当前 trusted owner + workspace scope 共享的本地语料，不是 Agent 私有 durable index。它不是长期记忆、不是通用文档平台，也不负责 request path 动态扫描 workspace 变化。

## 治理触发与输入边界

治理输入只能来自 trusted app composition：compiled active Agent 的 `workspaceFiles` read scope、workspace root、文件过滤常量和 bounded chunking policy。Tool input、用户请求体、模型输出、客户端 metadata 或 provider-private config 不得扩展治理范围。

runtime file changes 不会自动触发 request-path rebuild。当前基线只承认 startup build-once 语义：启动时先清理上次残留的治理数据，再构建当前 Agent 的临时语料；shutdown 时再做 best-effort cleanup。

## 数据生命周期

治理产物是本地临时数据，而不是 durable business fact。它们只服务当前进程/当前 deployment shape 下的 local retrieval provider，不进入 session/history/timeline/memory store，也不被 `rag` Tool 结果直接当作 public source of truth。

支持的文本文件会被 bounded chunking，保留 provider-neutral provenance。unsupported、oversized 或超 scope 内容只能被跳过或安全拒绝，不得扩大检索范围。

## 模块归属

- `agent-app`：trusted workspace scope、gateway/provider 组装、startup/shutdown lifecycle 接入；`WorkflowRagRetrievalGateway` 与 `RagRetrievalGateway` 在 `composeGatewayLayer` 独立接线，LOCAL 时 `createLocalWorkflowRagGateway` 包装同一 `LocalRagKnowledgeGovernance`，REMOTE 时经 `GatewayBindings.workflowRagRetrieval` 注入独立 client。
- `agent-platform-gateway-local`：本地治理数据持久化形态、FTS5 或等价检索实现、cleanup 和 provider-private 细节；同时产出 `RagRetrievalGateway`（服务 rag-tool）和 `WorkflowRagRetrievalGateway`（服务 workflow 节点）的 local 适配。
- `agent-platform-gateway-remote`：`WorkflowRagRetrievalGateway` remote 透传实现，复用同一 `NEXTAGENT_REMOTE_RAG_RETRIEVAL_ENDPOINT`，HTTP transport 层做 contract→wire format 字段名转换，不过滤 per-index 参数。
- `agent-capability` / `rag` Tool：只消费已经 compose 好的 `RagRetrievalGateway`，不拥有治理流程，不受 workflow RAG gateway 变更影响。
- `agent-workflow`：通过 `createWorkflowRagKnowledgeRetrieverAdapter` 消费 `WorkflowRagRetrievalGateway`，负责 trusted Recipe bindings、per-index 参数合并、scope request 组装、结果裁剪和 Workflow safe error。

## 双 Gateway Port 边界与同形同策例外

`WorkflowRagRetrievalGateway` 与 `RagRetrievalGateway` 是同类 port（检索 gateway），但不复用同一个 contract：

- **输入信任边界不同**：`RagRetrievalGateway` 服务 rag-tool，输入来自模型输出（不可信），参数严格收窄（`indexes: string[]`，仅 `topK`）；`WorkflowRagRetrievalGateway` 服务 workflow 节点，输入来自 trusted recipe DSL，参数更丰富（`indexes: WorkflowRagRetrievalIndex[]`，含 per-index `indexType`/`vsTopN`/`esTopN`/`filters`）。
- **请求形状不同**：`indexes` 从 `string[]` 变为对象数组，承载 per-index 检索参数。
- **Result 结构不兼容**：`WorkflowRagRetrievalResult.recommends`（开放 `JsonObject[]`，承载 indexType-specific 异构字段）与 `RagRetrievalResult.results`（闭合 `RagRetrievalChunk[]`，`additionalProperties: false`）结构不兼容。

为避免相同语义的重复，`Options`（`{ topK }`）语义相同，直接复用既有 `RagRetrievalOptions`。例外范围：Request/Index 独立（信任边界和参数丰富度不同），Options 复用（语义相同），Result 独立（结构不兼容）。验证方式：contract test 断言 `WorkflowRagRetrievalGateway` 不含 provider 私有字段名（`vector`/`elasticsearch`/`embedding` 等），architecture test 断言 `agent-platform-gateway-remote` 不依赖 `agent-workflow`。

## 失败语义

治理不可用、构建失败、cleanup 失败或取消时，系统必须产出显式 unavailable/degraded 状态和低基数 safe reason code。`rag` Tool 读取到治理未就绪时，必须显式返回 unavailable/degraded，而不是伪装为空成功。
