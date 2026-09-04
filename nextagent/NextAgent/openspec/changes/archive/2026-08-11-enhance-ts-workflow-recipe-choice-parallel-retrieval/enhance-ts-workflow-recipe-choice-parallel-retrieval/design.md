# Design: Enhance recipe-choice with parallel per-index retrieval and result aggregation

## Context

`executeRecipeChoiceNode` RAG path calls shared `retrieveKnowledge(context, options, "RECIPE")`, which parses all `rag_index` entries, builds a single `WorkflowKnowledgeRetrievalRequest` with all indexes, and calls `options.retrieveKnowledge` (the adapter). The adapter sends one gateway call with all indexes, slices `recommends` to `rankTopN`, and returns. No per-index parallelism, no partial failure tolerance, no aggregation/sorting/filtering.

Other knowledge nodes (`knowledge-search`, `knowledge-qa`, `api-choice`) also use `retrieveKnowledge`. Changing it would affect all four nodes.

## Goals / Non-Goals

**Goals:**
- Step 3: per-index parallel retrieval with partial failure tolerance, recipe-choice only.
- Step 4: aggregate results, attach `priority`, sort by `priority desc + rerankScore desc`, filter by `recallCondition`, truncate to `rankTopN`.

**Non-Goals:**
- Do NOT modify shared `retrieveKnowledge`, adapter, or gateway contract.
- Do NOT add `enableHybridResults` (Step 2/5, out of scope).
- Do NOT change `knowledge-search`/`knowledge-qa`/`api-choice` retrieval paths.
- Do NOT change candidate path (deterministic first-candidate selection).

## Decisions

### D1: recipe-choice-specific retrieval, not shared `retrieveKnowledge`

`executeRecipeChoiceNode` RAG path stops calling shared `retrieveKnowledge`. Instead, it parses inputs (indexes, query, rankTopN, vsTopN, esTopN) inline and calls `options.retrieveKnowledge` once per index. This keeps the change surgical — only `recipe-choice` is affected.

Source: "外科手术式修改" + spec is recipe-choice-specific.

### D2: per-index calls via `options.retrieveKnowledge` with single-index array

For each `WorkflowKnowledgeIndex`, build a `WorkflowKnowledgeRetrievalRequest` with `indexes: [singleIndex]`. Call `options.retrieveKnowledge` per index. Use `Promise.allSettled` for partial failure tolerance. Collect fulfilled results; if all reject or all empty, throw `WORKFLOW_RECIPE_NOT_FOUND`.

Per-index `rankTopN` and `topK` are set to `maxKnowledgeRankTopN` (10) to retrieve enough results per index for proper aggregation. The final truncation to the user's `rankTopN` happens after aggregation.

Source: spec Step 3 "所有索引的请求并行发送" + "收集所有非异常的响应结果".

### D3: priority attached during aggregation, not in gateway

Each `WorkflowKnowledgeIndex` has an optional `priority` (default 0). During aggregation, each recommend from that index's response gets `{ ...item, priority }` attached. Sorting uses this attached `priority`.

Source: spec Step 4.2 "为每条结果附加其所属索引的 priority".

### D4: sort by priority desc, then rerankScore desc

```
sorted = flattened.sort((a, b) => {
  const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
  if (priorityDiff !== 0) return priorityDiff;
  return (b.rerankScore ?? 0) - (a.rerankScore ?? 0);
});
```

`rerankScore` is read from `item.rerankScore ?? item.rerank_score ?? 0`.

Source: spec Step 4.3.

### D5: recallCondition score filtering with condition expressions

Parse `recall_condition` / `recallCondition` from node inputs. It's a record with optional `vsScore`/`vs_score`, `esScore`/`es_score`, `rerankScore`/`rerank_score` string fields.

Each condition expression is parsed into a predicate:
- `">0.8"` -> score > 0.8
- `"<0.5"` -> score < 0.5
- `"=1.0"` -> score === 1.0
- `"0.5~1.0"` -> 0.5 <= score <= 1.0

`parseScoreCondition(expr)` returns a predicate or `undefined` (for empty/invalid). `applyRecallCondition` filters recommends where all configured predicates pass. Missing score fields default to 0.

Source: spec Step 4.4 + RecallCondition format.

### D6: rankTopN truncation after aggregation

After sorting and filtering, `slice(0, rankTopN)` gives the final result set. `recipe_name` is the first, `recipe_name_list` is all names, `recall_result` is the full objects.

Source: spec Step 4.5 "截取前 rankTopN 条".

### D7: diagnostic status from parallel results

If all per-index calls succeed -> status "OK". If some fail but some succeed -> status "DEGRADED". If all fail or all empty -> throw `WORKFLOW_RECIPE_NOT_FOUND`.

Source: spec Step 3 "若全部失败或结果为空，抛出错误".

## Verification Map

| Constraint | Task | Verification |
|---|---|---|
| Per-index parallel retrieval | 1.1, 2.1 | Node test: multiple indexes, each gets separate call |
| Partial failure tolerance | 2.2 | Node test: one index rejects, others succeed, result non-empty |
| All-fail error | 2.3 | Node test: all reject -> WORKFLOW_RECIPE_NOT_FOUND |
| Priority sort | 3.1 | Node test: higher priority index results rank first |
| rerankScore sort | 3.2 | Node test: same priority, higher rerankScore ranks first |
| recallCondition filter | 4.1, 4.2 | Node test: >, <, =, ~ operators filter correctly |
| rankTopN truncation | 5.1 | Node test: results truncated to rankTopN |
| Candidate path unchanged | 6.1 | Regression test: candidate path still returns first candidate |
| No shared retrieveKnowledge change | 6.2 | Other knowledge node tests pass unchanged |
