# Tasks

## 1. 实现按索引并行检索

- [x] 1.1 新增 `retrieveRecipeKnowledgePerIndex` 函数：为每个索引构建单索引 `WorkflowKnowledgeRetrievalRequest`（rankTopN=maxKnowledgeRankTopN，topK=maxKnowledgeRankTopN），按索引调用 `options.retrieveKnowledge`，使用 `Promise.allSettled`，收集带 priority 的 fulfilled 结果。
  验证：unit test 断言每个索引得到独立调用
  来源：design D1, D2

- [x] 1.2 把 `executeRecipeChoiceNode` RAG 路径接线为调用 `retrieveRecipeKnowledgePerIndex`，替代共享的 `retrieveKnowledge`。
  验证：unit test 断言 recipe-choice RAG 路径使用按索引调用
  来源：design D1

## 2. 部分失败容忍

- [x] 2.1 只收集 fulfilled 的 `Promise.allSettled` 结果；跳过 rejected。
  验证：unit test 中一个索引 reject，结果非空
  来源：design D2, D7

- [x] 2.2 如果全部 reject 或全部为空，抛出 `WORKFLOW_RECIPE_NOT_FOUND`。
  验证：unit test 全部 reject -> 报错；全部为空 -> 报错
  来源：design D7

- [x] 2.3 状态：全部成功为 "OK"，部分失败为 "DEGRADED"。
  验证：unit test 混合成功/失败 -> diagnostic 中为 DEGRADED 状态
  来源：design D7

## 3. 结果聚合与排序

- [x] 3.1 拍平全部 recommends，为每条附加所属索引的 `priority`（默认 0）。
  验证：unit test 断言结果上的 priority 字段
  来源：design D3

- [x] 3.2 按 `priority desc` 排序，再按 `rerankScore desc` 排序。
  验证：unit test 使用混合 priority 和 rerankScore
  来源：design D4

## 4. recallCondition 分数过滤

- [x] 4.1 新增 `parseScoreCondition(expr)`：把 `>`、`<`、`=`、`~`（区间）表达式解析为谓词。空/无效时返回 `undefined`。
  验证：unit test 覆盖每个运算符 + 无效表达式
  来源：design D5

- [x] 4.2 新增 `applyRecallCondition(recommends, recallCondition)`：按 vsScore/esScore/rerankScore 谓词过滤。从 `inputs.recall_condition` / `inputs.recallCondition` 解析。
  验证：unit test 覆盖每个分数字段 + 组合过滤
  来源：design D5

## 5. rankTopN 截断与输出

- [x] 5.1 排序 + 过滤后，`slice(0, rankTopN)`。输出 `recipe_name`（第一个）、`recipe_name_list`（全部名称）、`recall_result`（完整对象）。
  验证：unit test 断言截断到 rankTopN
  来源：design D6

## 6. 回归与验证

- [x] 6.1 更新既有 recipe-choice RAG 测试：新增 `rank_topN: 2` 以匹配截断语义。候选路径测试不变。
  验证：`npm test -- packages/agent-workflow/tests/workflow-knowledge-nodes.test.ts`
  来源：design D6

- [x] 6.2 为 agent-workflow 运行 `npx tsc --noEmit`、`npm run lint:architecture` 和完整测试套件。
  验证：全部通过
  来源：AGENTS.md validation gates
