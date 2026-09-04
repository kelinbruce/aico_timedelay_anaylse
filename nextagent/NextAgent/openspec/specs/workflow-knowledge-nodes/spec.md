# workflow-knowledge-nodes Specification

## Purpose

定义 workflow 知识节点族（`knowledge-search`、`knowledge-qa`、`api-choice`、`recipe-choice`）的黑盒语义：检索输入与 safe source ref 契约、evidence-bounded 问答、bounded candidate 选择，以及 Recipe 1.0 DSL 固定输出字段（`api_name`、`recipe_name`）。节点私有 schema 由本 spec owner，`agent-contracts/core` 只透传 opaque `inputs`/`outputs`/`outputParser`。

## Function

- **所属 Function**：`FN-9.6 执行知识节点`
- **Function 变更类型**：`ADDED`
- **spec 角色**：主规格
## Requirements
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

**需求类别**：功能性需求

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

**需求类别**：功能性需求

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

### Requirement: Knowledge Search

`knowledge-search` MUST 按既有检索配置执行知识检索。knowledge node-specific schema MUST 由 knowledge family owner 定义；`WorkflowNodeDef.inputs`、`outputs` 和 `outputParser` MUST 保持 opaque。

**前置条件：**
- `rag_index` 为索引对象数组，每项包含必填 `index_name` 以及可选 `domain`、`scene`、`index_type`、`priority`、`vs_topN`、`es_topN` 和 `filters`；同时兼容非空字符串索引名。
- `query` 为必填查询文本；`filters`、`rank_topN`、`vs_topN`、`es_topN` 和 `extensions` 为可选检索参数。
- knowledge gateway 必须可用。
- 节点 MUST 显式声明非空对象 `outputs`。
- output key MAY 自定义；每个 value MUST 精确映射 `${knowledge_search_result}` 或 `${recall_result}`。
- `outputs` MAY 只映射任意一个 canonical binding，也 MAY 同时映射两个。

**输出：**
- knowledge-search MUST 只提供两个 canonical binding：
  - `knowledge_search_result`：按 RAG 顺序取得 `recommends[].knowledge`，忽略长度为零的字符串后形成 `List<String>`。
  - `recall_result`：原始 `recommends`，类型为 `List<Object>`，保持元素、字段、值和顺序不变。
- 最终 output variables MUST 仅包含 `outputs` 声明的自定义 key 及其映射值。
- knowledge-search MUST NOT 提供 `documents`、`sourceDocuments`、`knowledge_diagnostic` 或任何其他 canonical binding。

**执行和失败：**
1. 节点进入 ready 状态后先校验 `outputs`，再解析输入并异步等待检索结果。
2. `outputs` 缺失、为空或映射其他 binding 时，MUST 以 `WORKFLOW_NODE_INPUT_INVALID` 失败，且不得调用 gateway。
3. 空 `recommends` MUST 保持既有 `WORKFLOW_KNOWLEDGE_SEARCH_EMPTY`。
4. 非空 `recommends` 中任一项缺少 `knowledge` 或值不是字符串时，MUST 以 `WORKFLOW_NODE_INPUT_INVALID` 失败，中断当前正常 workflow 路径且不得提交部分输出；既有 `onError` 语义不变。
5. `knowledge` 为长度零的字符串时 MUST 忽略该正文并继续，不得回退到 `title`、`id` 或其他字段。
6. `knowledge-qa` 和其他节点输出 MUST 保持不变。
7. 检索失败 MUST 明确失败或进入节点声明的 `onError` 路径；取消、超时和 retry 行为保持不变。

#### Scenario: Custom Key Maps One Binding
- **GIVEN** `outputs: { retrieved_texts: '${knowledge_search_result}' }`
- **AND** RAG 顺序返回正文 `first` 和 `second`
- **WHEN** 节点成功完成
- **THEN** `retrieved_texts` MUST 等于 `['first', 'second']`
- **AND** 未声明的 binding MUST NOT 进入节点输出

#### Scenario: Custom Keys Map Both Bindings
- **GIVEN** 两个自定义 key 分别映射 `${knowledge_search_result}` 和 `${recall_result}`
- **WHEN** 节点成功完成
- **THEN** 两个 key MUST 分别获得正文列表和原始召回列表

#### Scenario: Outputs Must Be Non-Empty and Canonical
- **GIVEN** 未声明 `outputs`、声明空对象或映射其他 binding
- **WHEN** 节点准备执行
- **THEN** MUST 以 `WORKFLOW_NODE_INPUT_INVALID` 失败
- **AND** knowledge gateway MUST NOT 被调用

#### Scenario: Missing or Non-String Knowledge Fails Current Path
- **GIVEN** 非空 `recommends` 中至少一项缺少 `knowledge` 或 `knowledge` 不是字符串
- **WHEN** 节点构造 binding
- **THEN** MUST 以 `WORKFLOW_NODE_INPUT_INVALID` 失败
- **AND** 当前正常 workflow 路径 MUST 中断且不得提交部分输出

#### Scenario: Empty Knowledge Is Ignored
- **GIVEN** RAG 顺序返回 `knowledge` 为 `'first'`、`''`、`'third'`
- **WHEN** 节点成功完成
- **THEN** `knowledge_search_result` MUST 等于 `['first', 'third']`
- **AND** `recall_result` MUST 保持全部三个原始召回项

#### Scenario: All Knowledge Strings Are Empty
- **GIVEN** 非空 `recommends` 的每个 `knowledge` 都是 `''`
- **WHEN** 节点成功完成
- **THEN** `knowledge_search_result` MUST 等于 `[]`
- **AND** `recall_result` MUST 等于原始 `recommends`

#### Scenario: Removed Bindings Are Unavailable
- **GIVEN** output value 映射 `documents`、`sourceDocuments`、`knowledge_diagnostic` 或其他名称
- **WHEN** 节点准备执行
- **THEN** MUST 以 `WORKFLOW_NODE_INPUT_INVALID` 失败且不得调用 gateway

### Requirement: Knowledge Family Boundary

workflow knowledge 节点 MUST 只 owner retrieval、evidence-bounded QA 和 candidate selection 语义，不得与其他 workflow node families 的 owner 冲突。

#### Scenario: Choice Does Not Execute
- **GIVEN** `api-choice` 与 `recipe-choice` 是 knowledge family 节点
- **WHEN** 它们完成候选排序与选择
- **THEN** 它们 MUST 只输出 safe 选择结果
- **AND** 实际 API 调用 MUST 由 capability `restful` 节点 owner
- **AND** 实际子流程执行 MUST 由 interaction `sub-recipe` 节点 owner
- **AND** 通用 prompt assembly 与通用结构化模型输出规则 MUST 继续由 LLM family owner

### Requirement: Knowledge QA

`knowledge-qa` MUST 先检索证据，再基于证据生成回答。检索阶段支持 per-index 参数，`defaultIndexType` 为 `KNOWLEDGE`。

**触发机制：**
- 节点 ready 时触发
- 属于单节点内的“检索阶段 + 模型回答阶段”

**输入与前置条件：**
- `query`
- knowledge retrieval config（含 per-index `indexType`/`vsTopN`/`esTopN`/`filters`）
- 可用模型调用服务

**输出与副作用：**
- `answer`
- `sourceDocuments`（从 `recommends` 中选取）

**核心判断逻辑：**
1. 先执行知识检索（按 `Knowledge Index Per-Index Parameters` 合并 per-index 参数）
2. 对证据做裁剪 / 摘要
3. 组装问答 prompt
4. 调用模型生成 answer

**状态 / 产物契约：**
- `sourceDocuments` MUST 与 answer 保持可追溯关系
- 原始大文档 MUST NOT 全量落地到 output

**失败与降级：**
- 检索为空 -> 可返回空证据失败、空回答失败或按 `onError` 降级，但不得伪造证据

#### Scenario: Answer With Sources
- **WHEN** `knowledge-qa` 完成
- **THEN** 输出 MUST 同时包含 `answer` 和 `sourceDocuments`（从 `recommends` 中选取）
- **AND** 原始大文档 MUST NOT 全量落地到 output

### Requirement: API Choice

`api-choice` MUST 在 bounded candidate API 集合中选择最合适的 API，并通过 Recipe 1.0 DSL 固定字段 `api_name` 输出选择结果。`api-choice` 支持两种选择路径：bounded candidate API 直接 LLM N 选 1，或 RAG 召回 N 选 5 后 LLM 5 选 1。RAG 召回路径支持 per-index 参数，`defaultIndexType` 为 `API`。

**触发机制：**
- 节点 ready 时触发

**输入与前置条件：**
- `taskDescription`
- bounded `candidateApis`（路径一：直接 LLM N 选 1）
- 或 `rag_index` + `query`（路径二：RAG 召回 top5 -> LLM 5 选 1，支持 per-index 参数）

**输出与副作用：**
- `api_name`
- RAG 召回路径可选输出 `recall_result`；只有 Recipe 显式声明该输出时才投影，不得要求只消费 `api_name` 的 Recipe 同时声明该字段

**核心判断逻辑：**
1. 若 `candidateApis` 非空，基于任务描述和候选集直接 LLM N 选 1
2. 若 `candidateApis` 为空且存在 `rag_index` + `query`，先执行 RAG 召回（按 `Knowledge Index Per-Index Parameters` 合并 per-index 参数，`defaultIndexType=API`），取 top5 作为候选，再 LLM 5 选 1
3. 校验输出 API 属于候选集
4. 将内部 `apiName` 映射为 DSL 边界的 `api_name`

**状态 / 产物契约：**
- `api_name` MUST 通过 `${api_name}` 投影并供下游 `restful.inputs.api_name` 消费
- `apiName`、`mappedParams`、`api_choice_result` 和 `knowledge_diagnostic` MUST NOT 作为 Recipe 1.0 DSL 输出

**流程接入：**
- 下游：`restful`

**失败与降级：**
- 候选集外结果 -> validation 失败
- RAG 召回为空 -> `WORKFLOW_API_CHOICE_NOT_FOUND` 失败，MUST NOT 返回空成功

#### Scenario: Bounded API Selection
- **WHEN** `api-choice` 返回所选 API
- **THEN** 所选 API MUST 来自候选集

#### Scenario: Two-Phase RAG Recall Then LLM Selection
- **WHEN** `api-choice` 未提供 `candidateApis` 但提供 `rag_index` + `query`
- **THEN** 系统 MUST 先执行 RAG 召回 top5
- **AND** 再由 LLM 从 top5 中 5 选 1
- **AND** 节点 MUST 将最终选择的 API 名称投影到 `api_name`
- **AND** 透传给 gateway 的索引项 `indexType` MUST 为 `API`（未显式指定时）

#### Scenario: API Name Field Preserved
- **WHEN** recipe 声明 `outputs.api_name: ${api_name}`
- **THEN** 节点 MUST 产出非空 `api_name`
- **AND** 下游 `restful` MUST 能通过 `${api_name}` 解析该值

#### Scenario: RAG API Name Without Recall Result
- **GIVEN** `api-choice` 通过 RAG 召回候选 API
- **WHEN** recipe 只声明 `outputs.api_name: ${api_name}`
- **THEN** 节点 MUST 将最终选择的 API 名称投影到 `api_name`
- **AND** MUST NOT 因未声明可选的 `recall_result` 而拒绝该 recipe
- **AND** 输出 MUST NOT 包含未声明的 `recall_result`

#### Scenario: RAG recall empty fails explicitly
- **WHEN** `api-choice` RAG 召回结果为空
- **THEN** MUST 抛 `WORKFLOW_API_CHOICE_NOT_FOUND`
- **AND** MUST NOT 返回空成功

#### Scenario: Camel Case Output Rejected
- **WHEN** recipe 声明 `outputs.apiName: ${apiName}`
- **THEN** 节点输入校验 MUST 明确失败
- **AND** MUST NOT 调用模型或知识 gateway

### Requirement: API Choice Model Routing Dedup

`api-choice` 节点的模型配置解析 MUST 复用 shared `resolveNodeModelConfig` 函数，与 `restful` 节点参数提取的模型配置解析保持同形同策。

**触发机制：**
- api-choice 节点执行 LLM 选择时触发
- 属于节点内模型调用阶段

**输入与前置条件：**
- 可选 `model` — 节点级模型名称覆盖
- 可选 `modelGroup` — 节点级模型路由组（deferred，当前不生效）
- 可选 `model_params` — 模型扩展参数，全量透传
- `resolveModelForParamExtract` 或 `resolveModelInvocationConfig` 可用

**核心判断逻辑：**
1. 通过 shared `resolveNodeModelConfig` 解析 model/modelGroup override + fallback
2. 若 `model_params` 非空，合并到 `commonOptions`（节点级覆盖全局）
3. 使用最终配置调用大模型

**输出与副作用：**
- 模型调用使用合并后的配置
- 不产生独立模型配置产物

**失败与降级：**
- `resolveModelForParamExtract` 不可用 → fallback 到 `resolveModelInvocationConfig`
- modelGroup 为 deferred：有值但 model 为空时，fallback 到全局配置，不报错

**需求类别**：功能性需求

#### Scenario: Model Config Shared Resolution
- **WHEN** api-choice 节点和 restful 参数提取都配置了 model
- **THEN** 两者 MUST 通过同一个 shared 函数解析模型配置
- **AND** 行为一致

#### Scenario: model_params Merge
- **WHEN** api-choice 节点配置了 model_params
- **THEN** model_params MUST 合并到 commonOptions
- **AND** 节点级覆盖全局配置

#### Scenario: modelGroup Deferred
- **WHEN** 节点配置了 modelGroup 但没有 model
- **THEN** 实现 MUST fallback 到全局配置
- **AND** 不得报错或中断流程

### Requirement: Recipe Choice Parallel Retrieval and Aggregation

`recipe-choice` MUST 在 bounded candidate recipe 集合中选择最合适的 recipe，并保持 DSL 输出字段为 `recipe_name`。当未提供 `candidateRecipes` 时，`recipe-choice` RAG path MUST 从每个索引独立并行检索，按 priority 聚合排序，并支持 score-condition 过滤。RAG 回退路径支持 per-index 参数，`defaultIndexType` 为 `RECIPE`。

**Candidate path：**
- 节点 ready 时触发
- 输入：`taskDescription`、bounded `candidateRecipes`
- 输出：`recipe_name`
- 核心判断逻辑：在候选集内选择 recipe -> 校验输出属于候选集 -> 输出 `recipe_name`
- `recipe_name` 在 DSL 中表示子流程标识；其解析 MUST 由下游 `sub-recipe` 通过 app-composed recipe definition source `require(agentId, recipe_name)` 完成
- 生命周期与当前 execution 相同；消费方为下游 `sub-recipe`
- 候选集外结果 -> validation 失败；选中的 `recipe_name` 未注册 -> 下游 `sub-recipe` MUST 明确失败

**Parallel retrieval：**
- For each `rag_index` entry, build a single-index retrieval request and call the knowledge retrieval boundary independently.
- All per-index requests MUST be sent in parallel via `Promise.allSettled` or equivalent.
- Partial failure MUST be tolerated: if some indices fail but at least one succeeds with non-empty results, the node MUST return aggregated results.
- If ALL per-index requests fail or ALL return empty results, the node MUST throw `WORKFLOW_RECIPE_NOT_FOUND`.

**Result aggregation and sorting：**
- Each recall result MUST be annotated with its owning index's `priority` (default 0).
- Results MUST be sorted by `priority` descending, then `rerankScore` descending.
- If `recallCondition` is configured, results not meeting score thresholds MUST be filtered out.
- The final result set MUST be truncated to `rankTopN`.

**recallCondition format：**
- `recallCondition` is an optional input field (`recall_condition` / `recallCondition`).
- It contains optional `vsScore`/`vs_score`, `esScore`/`es_score`, `rerankScore`/`rerank_score` string fields.
- Each field is a condition expression: `">0.8"` (greater), `"<0.5"` (less), `"=1.0"` (equal), `"0.5~1.0"` (range [low, high]).
- Results missing a score field default to 0 for filtering purposes.

**Output：**
- `recipe_name`: first result's `recipeName` after sorting and truncation.
- `recipe_name_list`: all result names after sorting and truncation.
- `recall_result`: full result objects after sorting and truncation.
- `knowledge_diagnostic`: status "OK" if all indices succeed, "DEGRADED" if some fail.

#### Scenario: Recipe Name Field Preserved
- **WHEN** `recipe-choice` 执行完成
- **THEN** 系统 MUST 输出 DSL 字段 `recipe_name`
- **AND** MUST NOT 调整该 DSL 字段名（不得回摆为旧 `recipeId`）
- **AND** RAG 回退路径透传给 gateway 的索引项 `indexType` MUST 为 `RECIPE`（未显式指定时）

#### Scenario: Per-index parallel retrieval
- **GIVEN** `recipe-choice` with multiple `rag_index` entries
- **WHEN** the node executes RAG retrieval
- **THEN** each index MUST receive an independent retrieval request
- **AND** all requests MUST be sent in parallel

#### Scenario: Partial failure tolerance
- **GIVEN** one index retrieval fails but another succeeds with results
- **WHEN** the node aggregates results
- **THEN** results from the successful index MUST be returned
- **AND** diagnostic status MUST be "DEGRADED"

#### Scenario: All-fail error
- **GIVEN** all index retrievals fail
- **WHEN** the node attempts aggregation
- **THEN** MUST throw `WORKFLOW_RECIPE_NOT_FOUND`

#### Scenario: Priority-based sorting
- **GIVEN** results from two indices with different `priority` values
- **WHEN** the node sorts results
- **THEN** results from the higher-priority index MUST rank first

#### Scenario: rerankScore secondary sort
- **GIVEN** results with equal `priority` but different `rerankScore`
- **WHEN** the node sorts results
- **THEN** higher `rerankScore` MUST rank first

#### Scenario: recallCondition filtering
- **GIVEN** `recallCondition` with `vsScore: ">0.8"`
- **WHEN** the node filters results
- **THEN** results with `vsScore <= 0.8` MUST be excluded

#### Scenario: rankTopN truncation
- **GIVEN** aggregated results exceed `rankTopN`
- **WHEN** the node outputs results
- **THEN** only the top `rankTopN` results MUST be in `recipe_name_list` and `recall_result`

#### Scenario: Candidate path unchanged
- **GIVEN** `recipe-choice` with `candidateRecipes` provided
- **WHEN** the node executes
- **THEN** the first candidate MUST be selected directly
- **AND** no RAG retrieval MUST occur

#### Scenario: RAG fallback empty fails explicitly
- **WHEN** `recipe-choice` RAG 回退结果为空
- **THEN** MUST 抛 `WORKFLOW_RECIPE_NOT_FOUND`
- **AND** MUST NOT 返回空成功

