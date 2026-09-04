## Purpose

扩展 workflow knowledge 节点（`knowledge-search` / `knowledge-qa` / `api-choice` / `recipe-choice`）的 RAG 检索参数，支持 per-index 的 `indexType`/`vsTopN`/`esTopN`/`filters`，并新增 indexType 节点默认填充语义。

## MODIFIED Requirements

### Requirement: Knowledge Index Per-Index Parameters

`rag_index` 数组每项 SHALL 支持声明 `indexType`、`vsTopN`、`esTopN`、`filters`，用于为每个索引项独立指定检索类型和召回策略。

**字段约束：**
- `indexType`：枚举 `API` / `RECIPE` / `KNOWLEDGE`，可选；非法值 MUST 触发 `WORKFLOW_NODE_INPUT_INVALID`，field=`index_type`
- `vsTopN`：整数 1-20，可选；超出范围 MUST 失败
- `esTopN`：整数 1-20，可选；超出范围 MUST 失败
- `filters`：provider-neutral 结构化对象，可选；内部结构由远端负责校验

**per-index 与节点级合并规则：**
- per-index `vsTopN`/`esTopN`/`filters` 优先
- 缺失时 fallback 到节点级 `vs_topN`/`es_topN`/`filters`
- `rank_topN` 保持节点级，不进 per-index
- 合并发生在 adapter 翻译阶段，结果落在 gateway 请求的 per-index 项上

**触发机制：**
- 节点 ready 时触发，位于 workflow execution 阶段

**输入与前置条件：**
- `rag_index`（对象数组，每项含 `index_name`（必填）、可选 `domain`/`scene`/`index_type`/`priority`/`vs_topN`/`es_topN`/`filters`；兼容纯字符串形式）
- `query`
- 可选 `filters`/`rank_topN`/`vs_topN`/`es_topN`（节点级，作为 per-index 缺失时的 fallback）
- 知识 gateway 可用

**输出与副作用：**
- `recommends`（`readonly JsonObject[]`，完整透传 gateway 结果）
- recall / ranking diagnostic

`recommends` MUST 完整透传 gateway 返回的检索结果，不得截断或丢失字段。`recommends` 为 `readonly JsonObject[]`（开放结构），元素结构由远端按 `indexType` 决定：KNOWLEDGE/RECIPE/API 各有不同字段集。

**核心判断逻辑：**
1. 解析 `rag_index`，对 `indexType` 做枚举校验
2. 计算 `topK = rankTopN`
3. adapter 对每项合并 per-index 与节点级参数（per-index 覆盖节点级）：`indexType`/`vsTopN`/`esTopN`/`filters`
4. 调用 `WorkflowRagRetrievalGateway`，对结果裁剪到 `rankTopN`（裁剪条数，不截断内容）

**参数语义说明：**
- `rankTopN`：最终返回给节点的文档数（节点级，不进 per-index）
- `topK`：传给 gateway 的返回数，等于 `rankTopN`
- `vsTopN`/`esTopN`：向量/ES 召回阶段的检索参数，作为 per-index 参数透传给 gateway（与 `topK` 是不同阶段的独立参数，不互相替代）
- `filters`：过滤条件，作为 per-index 参数透传给 gateway
**失败与降级：**
- `indexType` 非法值 -> `WORKFLOW_NODE_INPUT_INVALID`
- per-index `vsTopN`/`esTopN` 超范围 -> `WORKFLOW_NODE_INPUT_INVALID`
- gateway 不可用 -> 明确失败，不得静默吞错
- 结果为空 -> `knowledge-search` 抛 `WORKFLOW_KNOWLEDGE_SEARCH_EMPTY`，`api-choice` 抛 `WORKFLOW_API_CHOICE_NOT_FOUND`，`recipe-choice` 抛 `WORKFLOW_RECIPE_NOT_FOUND`

#### Scenario: Per-index vsTopN overrides node-level
- **GIVEN** `rag_index` 第一项声明 `vs_topN: 5`，节点级 `vs_topN: 10`
- **WHEN** 节点执行检索
- **THEN** 该索引项的 effective `vsTopN` MUST 为 5
- **AND** 未声明 per-index `vsTopN` 的索引项 effective `vsTopN` MUST 为 10

#### Scenario: Per-index filters override node-level filters
- **GIVEN** `rag_index` 第一项声明 `filters: { region: "east" }`，节点级 `filters: { region: "west" }`
- **WHEN** 节点执行检索
- **THEN** 该索引项的 effective `filters` MUST 为 `{ region: "east" }`

#### Scenario: Invalid indexType rejected
- **GIVEN** `rag_index` 项声明 `index_type: "vector"`
- **WHEN** 节点解析输入
- **THEN** MUST 抛 `WORKFLOW_NODE_INPUT_INVALID`，field 为 `index_type`

#### Scenario: Per-index vsTopN out of range rejected
- **GIVEN** `rag_index` 项声明 `vs_topN: 0`
- **WHEN** 节点解析输入
- **THEN** MUST 抛 `WORKFLOW_NODE_INPUT_INVALID`

#### Scenario: Existing recipe without per-index params unchanged
- **GIVEN** recipe 的 `rag_index` 项不声明 per-index 参数
- **WHEN** 节点执行检索
- **THEN** 行为 MUST 与本变更前等价（全部 fallback 节点级）

#### Scenario: Recommends not truncated or lossy
- **GIVEN** gateway 返回的 `recommends` 含完整结构化字段
- **WHEN** adapter 翻译为 `WorkflowKnowledgeRetrievalResult`
- **THEN** `recommends` MUST 保留原始结构，不得截断或丢弃字段
- **AND** MUST NOT 映射为 `WorkflowKnowledgeDocument` 中间类型

#### Scenario: Recommends preserves indexType-specific fields
- **GIVEN** gateway 返回 `recommends` 含 KNOWLEDGE 类型项（`id`/`title`/`summary`/`vsScore`/`esScore`）和 RECIPE 类型项（`recipeId`/`recipeName`）
- **WHEN** 节点解析 `recommends`
- **THEN** 每种 indexType 的特有字段 MUST 被保留，不得丢失

### Requirement: indexType Node Default Fill

每个 knowledge 节点类型 SHALL 有一个 `defaultIndexType`，adapter 对每个索引项填充 resolved `indexType`：`resolvedIndexType = item.indexType ?? nodeDefault`。

| 节点类型 | defaultIndexType |
|----------|------------------|
| `knowledge-search` | `KNOWLEDGE` |
| `knowledge-qa` | `KNOWLEDGE` |
| `api-choice` | `API` |
| `recipe-choice` | `RECIPE` |

用户显式指定的 `indexType` MUST 覆盖节点默认。所有索引项（含用户显式指定异类 indexType 的项）MUST 透传给 gateway，节点 MUST NOT 按 indexType 过滤索引项。indexType 是远端检索接口入参（用于选择检索策略），不是本地过滤条件。

#### Scenario: Default indexType filled when omitted
- **GIVEN** `api-choice` 节点的 `rag_index` 项未声明 `indexType`
- **WHEN** 节点执行检索
- **THEN** 该索引项的 resolved `indexType` MUST 为 `API`

#### Scenario: User-specified indexType overrides default
- **GIVEN** `api-choice` 节点的 `rag_index` 项声明 `index_type: "KNOWLEDGE"`
- **WHEN** 节点执行检索
- **THEN** 该索引项的 resolved `indexType` MUST 为 `KNOWLEDGE`

#### Scenario: Cross-type index not filtered out
- **GIVEN** `recipe-choice` 节点的 `rag_index` 包含一项 `index_type: "API"`
- **WHEN** 节点执行检索
- **THEN** 该 `API` 类型索引项 MUST 仍出现在透传给 gateway 的 `indexes` 中

### Requirement: Knowledge Search (Updated)

`knowledge-search` MUST 在不调整 Recipe YAML DSL 的前提下，按既有检索配置执行知识检索。`defaultIndexType` 为 `KNOWLEDGE`。`topK = rankTopN`（gateway 返回文档数），`vsTopN`/`esTopN` 作为 per-index 召回参数独立透传给 gateway。

#### Scenario: Ranked Safe Documents with Per-Index Params
- **WHEN** `knowledge-search` 返回多个结果
- **THEN** retrieval boundary MUST 按 gateway 返回顺序提供 `recommends`
- **AND** 每个索引项的 resolved `indexType` MUST 为 `KNOWLEDGE`（未显式指定时）
- **AND** 透传给 gateway 的 `options.topK` MUST 等于 `rank_topN`

#### Scenario: Empty result fails explicitly
- **WHEN** `knowledge-search` 检索结果为空
- **THEN** MUST 抛 `WORKFLOW_KNOWLEDGE_SEARCH_EMPTY`
- **AND** MUST NOT 返回空成功

### Requirement: Knowledge QA (Updated)

`knowledge-qa` MUST 先检索证据，再基于证据生成回答。检索阶段支持 per-index 参数，`defaultIndexType` 为 `KNOWLEDGE`。

#### Scenario: Answer With Sources
- **WHEN** `knowledge-qa` 完成
- **THEN** 输出 MUST 同时包含 `answer` 和 `sourceDocuments`（从 `recommends` 中选取）
- **AND** 原始大文档 MUST NOT 全量落地到 output

### Requirement: API Choice (Updated)

`api-choice` MUST 支持两种选择路径：bounded candidate API 直接 LLM N 选 1，或 RAG 召回 N 选 5 再 LLM 5 选 1。RAG 召回路径支持 per-index 参数，`defaultIndexType` 为 `API`。

#### Scenario: Two-Phase RAG Recall Then LLM Selection
- **WHEN** `api-choice` 未提供 `candidateApis` 但提供 `rag_index` + `query`
- **THEN** 系统 MUST 先执行 RAG 召回 top5
- **AND** 再由 LLM 从 top5 中 5 选 1
- **AND** 输出 MUST 包含 Recipe 1.0 DSL 固定字段 `api_name` 和 `recall_result`
- **AND** MUST NOT 将内部 diagnostic 或 camelCase 字段发布为 DSL 输出
- **AND** 透传给 gateway 的索引项 `indexType` MUST 为 `API`（未显式指定时）

#### Scenario: RAG recall empty fails explicitly
- **WHEN** `api-choice` RAG 召回结果为空
- **THEN** MUST 抛 `WORKFLOW_API_CHOICE_NOT_FOUND`
- **AND** MUST NOT 返回空成功

### Requirement: Recipe Choice (Updated)

`recipe-choice` MUST 在 bounded candidate recipe 集合中选择最合适的 recipe。RAG 回退路径支持 per-index 参数，`defaultIndexType` 为 `RECIPE`。

#### Scenario: Recipe Name Field Preserved
- **WHEN** `recipe-choice` 执行完成
- **THEN** 系统 MUST 输出 DSL 字段 `recipe_name`
- **AND** MUST NOT 借本 change 调整该 DSL 字段名
- **AND** RAG 回退路径透传给 gateway 的索引项 `indexType` MUST 为 `RECIPE`（未显式指定时）

#### Scenario: RAG fallback empty fails explicitly
- **WHEN** `recipe-choice` RAG 回退结果为空
- **THEN** MUST 抛 `WORKFLOW_RECIPE_NOT_FOUND`
- **AND** MUST NOT 返回空成功
