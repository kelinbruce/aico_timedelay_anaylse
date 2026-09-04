## MODIFIED Requirements

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
