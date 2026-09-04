# workflow-knowledge-nodes Specification Delta

## MODIFIED Requirements

### Requirement: Recipe Choice Parallel Retrieval and Aggregation

`recipe-choice` RAG 路径 MUST 独立且并行地从各索引检索，按优先级排序聚合结果，并支持分数条件过滤。

**并行检索：**
- 对每个 `rag_index` 条目，构建单索引检索请求并独立调用知识检索边界。
- 所有按索引的请求 MUST 通过 `Promise.allSettled` 或等价机制并行发送。
- 部分失败 MUST 被容忍：如果部分索引失败但至少一个索引成功返回非空结果，node MUST 返回聚合结果。
- 如果所有按索引的请求都失败或都返回空结果，node MUST 抛出 `WORKFLOW_RECIPE_NOT_FOUND`。

**结果聚合与排序：**
- 每个召回结果 MUST 标注其所属索引的 `priority`（默认 0）。
- 结果 MUST 先按 `priority` 降序、再按 `rerankScore` 降序排序。
- 如果配置了 `recallCondition`，不满足分数阈值的结果 MUST 被过滤掉。
- 最终结果集 MUST 截断到 `rankTopN`。

**recallCondition 格式：**
- `recallCondition` 是可选输入字段（`recall_condition` / `recallCondition`）。
- 它包含可选的 `vsScore`/`vs_score`、`esScore`/`es_score`、`rerankScore`/`rerank_score` 字符串字段。
- 每个字段是一个条件表达式：`">0.8"`（大于）、`"<0.5"`（小于）、`"=1.0"`（等于）、`"0.5~1.0"`（区间 [low, high]）。
- 缺少分数字段的结果在过滤时默认按 0 处理。

**输出：**
- `recipe_name`：排序截断后首个结果的 `recipeName`。
- `recipe_name_list`：排序截断后的全部结果名称。
- `recall_result`：排序截断后的完整结果对象。
- `knowledge_diagnostic`：所有索引成功时状态为 "OK"，部分失败时为 "DEGRADED"。

#### Scenario: 按索引并行检索
- **GIVEN** `recipe-choice` 配置多个 `rag_index` 条目
- **WHEN** node 执行 RAG 检索
- **THEN** 每个索引 MUST 收到独立的检索请求
- **AND** 所有请求 MUST 并行发送

#### Scenario: 部分失败容忍
- **GIVEN** 一个索引检索失败而另一个成功返回结果
- **WHEN** node 聚合结果
- **THEN** 成功索引的结果 MUST 被返回
- **AND** 诊断状态 MUST 为 "DEGRADED"

#### Scenario: 全部失败报错
- **GIVEN** 所有索引检索都失败
- **WHEN** node 尝试聚合
- **THEN** MUST 抛出 `WORKFLOW_RECIPE_NOT_FOUND`

#### Scenario: 按优先级排序
- **GIVEN** 来自两个索引且 `priority` 值不同的结果
- **WHEN** node 排序结果
- **THEN** 高优先级索引的结果 MUST 排在前面

#### Scenario: rerankScore 次级排序
- **GIVEN** `priority` 相同但 `rerankScore` 不同的结果
- **WHEN** node 排序结果
- **THEN** `rerankScore` 更高的结果 MUST 排在前面

#### Scenario: recallCondition 过滤
- **GIVEN** `recallCondition` 配置 `vsScore: ">0.8"`
- **WHEN** node 过滤结果
- **THEN** `vsScore <= 0.8` 的结果 MUST 被排除

#### Scenario: rankTopN 截断
- **GIVEN** 聚合结果超过 `rankTopN`
- **WHEN** node 输出结果
- **THEN** 只有前 `rankTopN` 个结果 MUST 出现在 `recipe_name_list` 和 `recall_result` 中

#### Scenario: 候选路径保持不变
- **GIVEN** `recipe-choice` 已提供 `candidateRecipes`
- **WHEN** node 执行
- **THEN** MUST 直接选择第一个候选
- **AND** MUST NOT 发生任何 RAG 检索
