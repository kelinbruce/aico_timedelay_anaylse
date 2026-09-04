## add-ts-workflow-llm-nodes

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：P3 — Workflow 执行范式

状态：candidate
类型：实施 change
主要 owner：`agent-workflow`
依赖：`add-ts-workflow-execution-engine`、`add-ts-model-invocation-contract`

目标：
- 实现 LLM 驱动的节点类型：`llm-router`、`intent-recognition`、`question-writing`、`translate`、`data-analysis`、`param-extract`。
- 所有 LLM 节点通过 `ModelInvocationService` 调用模型，不直接访问 provider。
- 本 change 定义上述节点的私有配置和私有输出语义，但不反向扩大 workflow 最小 contract。

规格输入：

节点私有约束：

- workflow 最小 contract 只冻结节点共用字段；本 change 承接 LLM 节点私有配置、输入解释、输出解释和运行时校验。
- 本 change 可以在节点私有 schema 中使用 `nodeConfig`、`structuredPayload` 等命名，但这些命名不得被提升为 `engine-contracts` 的必选公共字段。
- 若某个 LLM 节点需要新增跨节点共享的稳定字段，必须先提出 workflow contract refinement change。

**llm-router**

- 输入：`query` + `routes`（候选 route 描述列表）。
- LLM 根据 query 从 routes 中选择最匹配的 route label。
- 输出：`routeLabel`。
- 典型用途：驱动下游 `exclusive-gateway` 按 route label 分支。

**intent-recognition**

- 输入：`query` + `intentCatalog`（候选意图类别和描述）。
- LLM 识别 query 的意图类别。
- 输出：`intent` + `confidence`（0-1）。

**question-writing**

- 输入：`originalQuery` + `context`（可选，如历史对话摘要或 domain knowledge）。
- LLM 改写为更精确的检索用 query。
- 输出：`rewrittenQuery`。

**translate**

- 输入：`text` + `sourceLang` + `targetLang`。
- LLM 翻译文本。
- 输出：`translatedText`。

**data-analysis**

- 输入：`data`（结构化数据） + `analysisPrompt`。
- LLM 按 prompt 分析数据。
- 输出：`analysisResult`。

**param-extract**

- 输入：`text` + `paramSchema`（TypeBox schema 定义的目标参数结构）。
- LLM 从文本中提取结构化参数。
- 输出：`extractedParams`（符合 schema 的 JSON）。

**共同约束**

- 节点私有配置可包含 `modelProfileId`、`promptTemplateId`、`outputFormat` 等字段；这些字段由本 change 定义，不进入 workflow 最小 contract。
- LLM 输入（prompt + context）不得超过模型上下文预算 60%，超限走 `COMPRESS` 或 `FAIL`。
- `onError=RETRY` 时可用备选 `modelProfileId`。

实现约束：
- 不硬编码 prompt——使用 prompt template id 引用，由 `agent-context-engine` 的 context assembly 流程组装。
- 节点输出必须在传递给下游前通过 schema validation（`param-extract` 必校验，其他节点按 `outputSchema` 校验）。
- `ModelInvocationService` 调用接收 `AbortSignal`。
- raw prompt、raw model output 不进入 `WorkflowNodeResult`；节点私有输出如需放入 `structuredPayload`，只允许放安全结果。
- 本 change 不得把 LLM 节点私有配置字段回写成 workflow 最小 contract 的公共字段。

非目标：
- 不提供 streaming 投影到 Web channel。
- 不提供节点级 prompt 编辑器。
- 不支持 LLM 节点的 multi-turn 对话循环（单次调用）。

验收要点：
- integration test：`intent-recognition` 正确识别预设意图类别，输出有效 `confidence`。
- integration test：`param-extract` 按 schema 提取嵌套结构参数；构造非法 LLM 输出被 validation 拒绝。
- integration test：`llm-router` 输出 `routeLabel` 驱动下游 `exclusive-gateway` 正确分支。
- integration test：`translate` 正确翻译中英文对照文本。
- integration test：`data-analysis` 按 prompt 产出分析结论。
- integration test：`question-writing` 改写 query 保留关键术语。
- contract test：各节点输出 schema 与 `WorkflowNodeResult.structuredPayload` 兼容。
- security test：`WorkflowNodeResult.structuredPayload` 不包含 raw prompt/model output。

并行边界：
- 只注册新的节点类型 handler，不修改 engine 调度器核心。
- 通过 port 调用 `ModelInvocationService`，不直接访问 `agent-model` 实现。
- 节点私有 schema owner 在本 change，不在 `add-ts-workflow-engine-contracts`。
