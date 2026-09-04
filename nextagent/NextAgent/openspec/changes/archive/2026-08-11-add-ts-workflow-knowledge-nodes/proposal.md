## 背景与问题（Why）

知识检索节点族承担 workflow graph 中的检索、候选选择和基于证据回答，但当前缺少独立 change 来约束知识库输入、候选集边界、结果截断、source ref 和对后续 LLM / sub-recipe / REST 节点的接入。
knowledge 节点的检索、候选选择、source refs 等 node-specific schema 由本 change owner；`agent-contracts/core` 只透传 opaque `inputs`、`outputs`、`outputParser`，不再冻结 knowledge 私有字段。

## 变更范围（What Changes）

- **新增** `add-ts-workflow-knowledge-nodes` change，覆盖：
  - `knowledge-search`
  - `knowledge-qa`
  - `api-choice`
  - `recipe-choice`
- **明确** [Recipe YAML.md](D:/code/ADNClaw-TS/docs/Recipe%20YAML.md) 是既定 DSL 规范源；本 change 只实现并消费 DSL，不得调整节点名、字段名、结构语义或默认规则
- **明确** 标准 Recipe YAML 中 `rag_index`、`query`、`filters`、`rank_topN`、`vs_topN`、`es_topN` 的执行语义
- **明确** 检索结果的 safe 文档摘要、source refs、结果截断与候选集边界
- **明确** `recipe-choice` 在 DSL 层继续输出 `recipe_name`；实现内部如需映射到已有 contract，只能作为内部细节

## Capability 影响（Capabilities）

### 新增 Capability

- `workflow-knowledge-node-handlers`

### 修改的 Capability

- `agent-context-engine`：被 `knowledge-qa` 用于基于检索结果组装问答上下文
- `workflow-package` / `recipe dispatch`：被 `recipe-choice` 作为下游消费方

## 影响范围（Impact）

- `agent-workflow`：新增知识节点 handler
- `agent-platform-gateway-*`：知识检索 gateway 被调用
- `agent-model`：被 `knowledge-qa`、`api-choice`、`recipe-choice` 消费

## 职责边界对齐（Boundary Alignment）

- 已完成的 `add-ts-workflow-package-composition` 继续 owner package、startup wiring 和 recipe load；本 change 不新增知识索引装载或 recipe registry owner
- 已完成的 `add-ts-workflow-routing` 继续 owner主请求 workflow dispatch；`recipe-choice` 只输出 `recipe_name`，不直接执行 dispatch
- 已完成的 `add-ts-workflow-execution-engine` 继续 owner节点调度、retry、timeout、cancel；本 change 只定义 knowledge 节点语义
- 已完成的 `add-ts-workflow-gateway-nodes` 继续 owner控制流网关；knowledge 节点不承接 graph control semantics
- 与 `add-ts-workflow-llm-nodes` 的边界：本 change 只在 evidence-bounded `knowledge-qa` / candidate-choice 中消费模型能力，不 owner通用 prompt assembly 或通用 LLM 节点语义
- 与 `add-ts-workflow-interaction-nodes` 的边界：`recipe-choice` 只负责候选选择，`sub-recipe` 执行仍由 interaction change owner
- 与 `add-ts-workflow-capability-nodes` 的边界：`api-choice` 只负责候选 API 选择，实际 API 调用仍由 capability change 的 `restful` 节点 owner

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/designs/architecture/workflow-contracts.md`：补充 knowledge node 输入语义和 source ref 契约
- `openspec/specs/rag-knowledge-governance/spec.md`：补充 workflow knowledge 节点消费方式
- `openspec/specs/agent-routing-core/spec.md`：补充 `recipe-choice -> sub-recipe` 接线口径

## 验证入口（Validation）

- Integration test：`knowledge-search` 返回排序正确的文档列表
- Integration test：`knowledge-qa` 返回 answer 和 source refs
- Integration test：`api-choice` 从 bounded candidate set 输出 Recipe 1.0 DSL 固定字段 `api_name`
- Integration test：`recipe-choice` 输出 DSL `recipe_name`，供 `sub-recipe` 消费
- Security test：大结果集被截断 / 摘要，raw 文档不全量内联到下游 LLM
