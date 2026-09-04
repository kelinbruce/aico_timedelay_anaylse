## add-ts-workflow-knowledge-nodes

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：P3 — Workflow 执行范式

状态：candidate
类型：实施 change
主要 owner：`agent-workflow`
依赖：`add-ts-workflow-execution-engine`、`add-ts-workflow-llm-nodes`

目标：
- 实现知识检索和选择节点：`knowledge-search`、`knowledge-qa`、`api-choice`、`recipe-choice`。
- 本 change 定义知识节点私有配置和私有输出语义，但不反向扩大 workflow 最小 contract。

规格输入：

节点私有约束：

- workflow 最小 contract 只冻结节点共用字段；本 change 承接 knowledge 节点私有配置、候选集输入、输出解释和运行时校验。
- 本 change 可以在节点私有 schema 中使用 `nodeConfig`、`structuredPayload` 等命名，但这些命名不得被提升为 workflow 最小 contract 的公共字段。
- 若需要新增跨节点共享的稳定知识检索 workflow 字段，必须先提出 contract refinement change。

**knowledge-search**

- 输入：`query` + `knowledgeBaseId`。
- 通过 gateway 调用知识库检索接口。
- 输出：`documents`（检索结果列表，每条含 `title`、`content`、`score`）。

**knowledge-qa**

- 输入：`query` + `knowledgeBaseId`。
- 节点内部先调用 knowledge-search 检索，再用 `ModelInvocationService` 基于检索结果生成答案。
- 输出：`answer` + `sourceDocuments`。
- 内部检索和 LLM 调用复用已有 engine 节点机制，不新建独立调用分支。

**api-choice**

- 输入：`taskDescription` + `candidateApis`（API 描述列表）。
- LLM 从候选集中选择最合适的 API，并映射出调用参数。
- 输出：`selectedApiId` + `mappedParams`。
- 不执行 API 调用本身，选择结果供下游 `restful` 节点使用。

**recipe-choice**

- 输入：`taskDescription` + `candidateRecipes`（recipe 描述列表）。
- LLM 从候选集中选择最合适的 sub-recipe。
- 输出：`selectedRecipeId`。
- 不执行 recipe 本身，选择结果供下游 `sub-recipe` 节点使用。

实现约束：
- `knowledgeBaseId` 来自 `nodeConfig` 或上游变量，不得接受不可信客户端输入。
- 检索结果过大时必须截断或摘要，不得全量内联到后续 LLM 上下文。
- `api-choice` 和 `recipe-choice` 的候选集来自 `nodeConfig` 的 bounded set，不进行开放式 discovery。
- LLM 调用通过 `ModelInvocationService`，prompt 使用 template id 引用。
- 本 change 不得把 knowledge 节点私有配置或输出字段回写成 workflow 最小 contract 的公共字段。

非目标：
- 不实现知识库的写入、更新或管理。
- 不实现向量化 embedding 服务或自建索引。
- `knowledge-search` 不实现多知识库联合检索。

验收要点：
- integration test：`knowledge-search` 检索返回匹配文档，score 排序正确。
- integration test：`knowledge-qa` 组合检索 + LLM 生成完整答案，`sourceDocuments` 正确标注。
- integration test：`api-choice` 从候选集中正确选择 API 并输出 mapped params。
- integration test：`recipe-choice` 从候选集中正确选择 recipe。
- contract test：检索结果 schema 与 `WorkflowNodeResult.structuredPayload` 兼容。

并行边界：
- 只注册新的节点类型 handler，不修改 engine 调度器核心。
- 知识库检索通过 gateway port 调用，不引入新的 package 依赖。
- 节点私有 schema owner 在本 change，不在 `add-ts-workflow-engine-contracts`。
