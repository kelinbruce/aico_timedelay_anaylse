## 背景与问题（Why）

`rag` Tool 需要一个本地可用、边界清晰的最小语料来源，但 Tool 本身不应承担 workspace 扫描、文本切分、临时索引写入或启动/关闭生命周期。对 local deployment，我们只需要一个足够简单的配套能力：在应用启动时把当前 Agent 允许读取的少量安全文本整理成临时检索语料，供 `rag` Tool 通过 `RagRetrievalGateway` 使用。

因此本 change 的目标不是建设通用 RAG 治理系统，也不是定义长期知识库、增量索引或复杂运维状态机，而是把本地最小语料治理从 `add-ts-rag-tool` 中拆出，形成独立 owner 和更收敛的验收边界。

## 变更范围（What Changes）

- 新增 `rag-knowledge-governance` 行为规格，定义 local deployment 下的轻量语料治理能力。
- 在 `agent-app` 本地 trusted composition / lifecycle 中接入一次性治理：启动时构建，关闭时清理。
- 在 `agent-platform-gateway-local` 中实现本地治理 owner 和 local `RagRetrievalGateway` fallback provider：扫描可信 workspace read scope、过滤安全文本、切分 bounded chunk、写入一张本地临时 FTS5 检索表，并在 retrieval 时读取该临时数据。
- 治理范围只来自 compiled active Agent 的 trusted workspace 信息和 `workspaceFiles` read scope，不来自用户请求体、模型输出或 Tool input。
- 治理结果是运行期临时语料，不是 durable knowledge base；下一次启动先清理残留再重新构建。
- 当本地治理不可用时，provider 必须返回 explicit unavailable/degraded safe result，不得把基础设施失败伪装为空成功。

## Capability 影响（Capabilities）

### 新增 Capability

- `rag-knowledge-governance`: 本地轻量语料治理能力。它在本地启动阶段一次性整理 workspace 安全文本文件，生成临时检索语料，并让 local `RagRetrievalGateway` fallback provider 可供 `rag` Tool 使用。

### 修改的 Capability

- 无。`rag-tool` 的 Tool 调用契约和 public gateway contract 由 `add-ts-rag-tool` 定义；本 change 只实现该 contract 的 local fallback provider 和本地检索语料准备能力。

## 影响范围（Impact）

- `agent-platform-gateway-local`：新增本地语料治理实现和 local `RagRetrievalGateway` fallback provider，包括文件扫描、文本过滤、chunk 切分、FTS5 临时表写入、local retrieval 和 cleanup。
- `agent-app`：本地 trusted composition 中装配治理 lifecycle，并把 compiled active Agent workspace root、workspace read scope 和 agent scope 作为可信依赖传入。
- `agent-capability`：不新增 Tool 行为；`rag` Tool executor 只通过 `add-ts-rag-tool` 已定义的 retrieval gateway 间接消费本地治理结果。
- 测试：新增 local startup governance、shutdown cleanup、scope escape、chunk bound、no incremental update 和 unavailable/degraded tests。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/rag-knowledge-governance/spec.md`：新增本地启动治理、临时数据生命周期和失败降级行为契约。

长期背景：
- `openspec/overview.md`：补充 local corpus governance 只服务 `rag` Tool 的本地可用性，不等同完整 RAG 系统。

设计视图：
- `openspec/designs/architecture/rag-knowledge-governance.md`：承载跨模块流程、触发机制、数据生命周期、安全边界和失败降级语义。
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充 local gateway 拥有本地 RAG 临时检索数据、local fallback retrieval provider 和私有 FTS5 细节。
- `openspec/designs/modules/agent-app.md`：补充本地 trusted composition 和 lifecycle 接入点。
- `openspec/designs/spec-to-design-map.md`：新增 `rag-knowledge-governance` 到架构/模块设计的导航。

验证入口：
- `npm run build`
- `npm test`
- `npm run test:contract`
- `npm run lint:architecture`
- `openspec validate add-ts-rag-knowledge-governance --strict`
- `openspec validate --all --strict`
