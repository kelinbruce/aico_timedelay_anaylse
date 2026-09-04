## 背景与问题（Why）

workflow `knowledge-search` 已能取得 RAG `recommends`，但当前隐式暴露标题列表、完整文档和 diagnostic 等多套输出，下游也不能通过非空 `outputs` 明确选择所需结果。需要把节点收敛为最小、确定且支持自定义 output key 的 binding contract。

## 变更范围（What Changes）

- **BREAKING**：knowledge-search 只保留两个 canonical binding：
  - `knowledge_search_result = recommends[].knowledge`，类型为 `List<String>`；空字符串正文被忽略。
  - `recall_result = recommends`，类型为 `List<Object>`；保持原始字段、值和顺序。
- 节点必须声明非空 `outputs`。output key 可自定义，可只映射任一 canonical binding，也可同时映射两个。
- 不再提供 `documents`、`sourceDocuments`、`knowledge_diagnostic` 或其他 canonical binding。
- 任一召回项缺少 `knowledge` 或其值不是字符串时，当前 workflow 正常路径明确失败且不提交部分输出。
- 字符串 `knowledge` 为空时忽略正文并继续；全部正文为空时，正文 binding 为 `[]`，召回 binding 仍为原始 `recommends`。
- `knowledge-qa` 和其他节点输出不变。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `workflow-knowledge-nodes`：收敛 Knowledge Search 的输出声明、canonical binding、投影和失败契约。

## 影响范围（Impact）

- 代码：`packages/agent-workflow/src/nodes/knowledge-nodes.ts` 中 knowledge-search 输出声明校验和 binding 投影。
- 测试：`packages/agent-workflow/tests/` 和直接依赖旧 knowledge-search 输出的 contract fixtures。
- 不涉及 `agent-contracts`、gateway schema、检索参数、排序、裁剪、持久化、stream、Web API 或前端。
- `add-ts-workflow-rag-index-params` 保持 active；只修正其中冲突的 Knowledge Search requirement，不归档。
- 不收口 usage 文档或历史残留文档。

## 归档前更新基线（Baseline Promotion Plan）

- 归档前把完整 Knowledge Search requirement 合并到 `openspec/specs/workflow-knowledge-nodes/spec.md`。
- 架构、ADR、overview 和 spec-to-design-map 不变。
- usage 文档和历史残留文档不属于本 change。

验证入口：`packages/agent-workflow/tests/workflow-knowledge-nodes.test.ts`、`packages/agent-workflow/tests/workflow-rag-e2e.test.ts`、`openspec validate --all --strict`、`git diff --check`。
