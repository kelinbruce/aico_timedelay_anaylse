# Proposal: Enhance recipe-choice with parallel per-index retrieval and result aggregation

## 背景与问题（Background and Why）

`recipe-choice` RAG 路径调用共享的 `retrieveKnowledge`，把所有 `rag_index` 条目打包进一个 gateway 请求。gateway 把 `recommends` 原样返回到节点输出，没有聚合、排序或分数过滤。

对照 RecipeChoiceNode spec 的核心逻辑，存在两个缺口：

1. **步骤 3（并行 RAG 检索）缺失**：当前是单次多索引 gateway 调用，没有按索引的并行请求，没有部分失败容忍。一个索引失败导致整体失败。
2. **步骤 4（结果聚合与排序）缺失**：没有 `priority` 附加、没有 `priority desc + rerankScore desc` 排序、没有 `recallCondition` 分数过滤、没有 `rankTopN` 截断。

## 变更范围（What Changes）

- **新增** `recipe-choice` RAG 路径的按索引并行检索：为每个索引配置构建独立的 `WorkflowKnowledgeRetrievalRequest`（单索引），通过 `Promise.allSettled` 并行发送全部请求，收集非异常响应，容忍部分失败。如果全部失败或全部为空，抛出 `WORKFLOW_RECIPE_NOT_FOUND`。
- **新增** 结果聚合与排序：从每个响应的 `recommends` 提取召回结果，附加所属索引的 `priority`，按 `priority desc -> rerankScore desc` 排序。
- **新增** `recallCondition` 输入解析与分数过滤：支持 `vsScore`/`esScore`/`rerankScore` 条件表达式（`>0.8`、`<0.5`、`=1.0`、`0.5~1.0`），过滤不满足阈值的结果。
- **新增** `rankTopN` 截断：聚合与排序后，取前 `rankTopN` 个作为最终输出。
- **不改变**共享的 `retrieveKnowledge`、adapter、gateway contract 或其他 knowledge 节点（knowledge-search / knowledge-qa / api-choice）。
- **不新增** `enableHybridResults`（属于步骤 2/5，超出范围）。

## Capability 影响（Capability Impact）

### 修改的 Capabilities

- `workflow-knowledge-nodes`：`recipe-choice` RAG 路径从单次多索引调用重写为按索引并行检索 + 聚合/排序 + recallCondition 过滤 + rankTopN 截断。

### 新增 Capabilities

无。不新增 gateway contract 字段，不新增节点类型。

## 影响范围（Impact）

- `agent-workflow`：重写 `executeRecipeChoiceNode` RAG 路径；新增内部函数 `retrieveRecipeKnowledgePerIndex`、`parseScoreCondition`、`applyRecallCondition`、`aggregateAndSortRecipeResults`。`types.ts` 无变化（`recallCondition` 从节点 inputs 解析，不进入 `WorkflowKnowledgeRetrievalRequest`）。
- 对 `agent-contracts`、`agent-platform-gateway-*`、`agent-app` 无影响。
- 既有 recipe-choice 单索引测试：更新 `rank_topN` 以匹配截断语义。

## 边界对齐（Boundary Alignment）

- 与 `add-ts-workflow-rag-index-params`：本 change 不修改 gateway contract、adapter 或按索引参数合并规则。按索引的 `vsTopN`/`esTopN`/`filters` 合并仍由 adapter 完成。
- 与共享的 `retrieveKnowledge`：本 change 只影响 `recipe-choice`，不改变 `knowledge-search`/`knowledge-qa`/`api-choice` 的检索路径。
- 与 `enableHybridResults`：超出范围，后续单独 change 处理。

## 验证（Validation）

- 节点测试：按索引并行检索、部分失败容忍、priority 排序、rerankScore 排序、recallCondition 过滤（所有运算符）、rankTopN 截断、全部失败报错。
- 回归测试：既有 recipe-choice 候选路径不变；单索引 RAG 路径行为正确（更新 rankTopN 预期）。
- `npm run build`、`npm run lint:architecture`。
