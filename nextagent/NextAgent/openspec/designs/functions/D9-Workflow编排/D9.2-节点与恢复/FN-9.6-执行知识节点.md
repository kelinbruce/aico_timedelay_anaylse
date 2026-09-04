# FN-9.6 执行知识节点

> 能力域 D9 Workflow 编排 · 子域 [D9.2 节点与恢复](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-9.2](../../../features/D9-Workflow编排/D9.2-节点与恢复/F-9.2-工作流节点.md) |
| spec | `workflow-knowledge-nodes`、`workflow-rag-gateway` |
| 接口 | 系统内部，节点处理器 |

## 描述

执行知识节点族（`knowledge-search`、`knowledge-qa`、`api-choice`、`recipe-choice`），经 RAG 治理边界检索知识库获取相关知识，或在 bounded candidate 集合中选择 API/recipe，并产出 Recipe 1.0 DSL 固定输出字段供下游节点消费。knowledge 节点只 owner retrieval、evidence-bounded QA 和 candidate selection 语义；实际 API 调用由 capability `restful` 节点 owner，子流程执行由 interaction `sub-recipe` 节点 owner。

## 前置条件

- 工作流正在执行。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 节点定义 | 是 | 知识节点定义 |
| 节点输入 | 是 | 节点输入数据 |

## 输出

节点执行结果（检索到的知识）。

## 处理过程

1. 节点处理器解析检索请求。
2. 经 RAG 治理边界检索知识库。
3. `recipe-choice` 在提供 `candidateRecipes` 时直接选择首个候选；未提供候选时按每个 `rag_index` 独立并行检索（`Promise.allSettled`），容忍部分索引失败，全部失败或全部为空时抛出 `WORKFLOW_RECIPE_NOT_FOUND`。
4. `recipe-choice` RAG 聚合阶段为每条结果附加所属索引的 `priority`（默认 0），按 `priority` 降序、`rerankScore` 降序排序，按 `recallCondition` 条件表达式（`>`、`<`、`=`、`~` 范围）过滤，并截取前 `rankTopN` 条。
5. `api-choice` 的节点级模型配置解析复用 shared `resolveNodeModelConfig`，与 `restful` 节点参数提取保持同形同策；`model_params` 非空时合并到 `commonOptions`，`modelGroup` 为 deferred，有值但 model 为空时 fallback 到全局配置且不报错。
6. 经状态接口与运行时协作，返回结果。

## 结果

- 正常：节点执行完成。
- 失败：安全失败。
- `recipe-choice` 全部索引失败或结果为空：抛出 `WORKFLOW_RECIPE_NOT_FOUND`。

## 规格

| 规格项 | 规格值 | 状态 | 来源 |
|---|---|---|---|
| 可量化阈值 | 无；节点行为见描述 | 已定义 | 本特性 |
| knowledge 节点族边界 | 只 owner retrieval、evidence-bounded QA、candidate selection；`api-choice`/`recipe-choice` 只选择不执行；API 调用归 `restful`，子流程执行归 `sub-recipe`，通用 prompt assembly 归 LLM family | 稳定 | `workflow-knowledge-nodes`：`Knowledge Family Boundary` |
| api-choice DSL 输出 | 固定字段 `api_name`（`${api_name}` 供下游 `restful.inputs.api_name` 消费）；`apiName`、`mappedParams`、`api_choice_result`、`knowledge_diagnostic` 不得作为 DSL 输出；RAG 路径仅在 Recipe 显式声明时投影可选 `recall_result` | 稳定 | `workflow-knowledge-nodes`：`API Choice` |
| recipe-choice DSL 输出 | 固定字段 `recipe_name`（供下游 `sub-recipe` 消费）；不得回摆为旧 `recipeId` | 稳定 | `workflow-knowledge-nodes`：`Recipe Choice Parallel Retrieval and Aggregation` |
| recipe-choice 并行检索 | 每个 `rag_index` 独立单索引请求并行发送，部分失败容忍，全部失败或为空抛 `WORKFLOW_RECIPE_NOT_FOUND` | 稳定 | `workflow-knowledge-nodes`：`Recipe Choice Parallel Retrieval and Aggregation` |
| recipe-choice 聚合排序 | `priority` 降序 + `rerankScore` 降序，`recallCondition` 过滤，`rankTopN` 截断 | 稳定 | `workflow-knowledge-nodes`：`Recipe Choice Parallel Retrieval and Aggregation` |
| api-choice 模型配置解析 | 复用 shared `resolveNodeModelConfig`（与 `restful` 参数提取同形同策）；`model_params` 合并到 `commonOptions`；`modelGroup` 为 deferred，有值但 model 为空时 fallback 到全局配置 | 稳定 | `workflow-knowledge-nodes`：`API Choice Model Routing Dedup` |
| RAG 检索 per-index 参数 | `rag_index` 每项支持 `indexType`（`API`/`RECIPE`/`KNOWLEDGE`）、`vsTopN`（1-20）、`esTopN`（1-20）、`filters`；per-index 优先、节点级 fallback，合并在 adapter；`topK = rankTopN`；`recommends` 为开放 `JsonObject[]` 完整透传 | 稳定 | `workflow-knowledge-nodes`：`Knowledge Index Per-Index Parameters` |
| indexType 节点默认填充 | `knowledge-search`/`knowledge-qa` 默认 `KNOWLEDGE`，`api-choice` 默认 `API`，`recipe-choice` 默认 `RECIPE`；用户显式指定覆盖默认，节点不过滤异类 indexType | 稳定 | `workflow-knowledge-nodes`：`indexType Node Default Fill` |
| Workflow RAG gateway | `WorkflowRagRetrievalGateway` 与 `RagRetrievalGateway` 平行（Options 复用、Request/Result 独立）；local 降级忽略 per-index 参数用 FTS5 BM25，remote 透传复用同一 endpoint；composition 独立接线 | 稳定 | `workflow-rag-gateway`：`Workflow Rag Retrieval Gateway Contract`、`Local Workflow Rag Gateway Graceful Degradation`、`Remote Workflow Rag Gateway Transparent Passthrough`、`Composition Wiring Separation` |
