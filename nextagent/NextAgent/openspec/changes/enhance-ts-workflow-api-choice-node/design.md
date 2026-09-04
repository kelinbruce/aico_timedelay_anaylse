## 设计决策

### D1: 路径入口由 open_api_recall 显式控制

当前实现靠 candidateApis 是否为空隐式判断路径。增强后改为 open_api_recall 显式控制：

- open_api_recall 为 false 或空（默认）：走纯大模型 N 选 1 路径，此时必须提供 candidateApis（bounded candidate 是纯 LLM 路径的必要前提）
- open_api_recall 为 true：走 RAG 召回 + 大模型 TopN 选 1 路径
- open_api_recall=false + candidateApis 为空 → 报错终止（WORKFLOW_API_CHOICE_NO_CANDIDATES）
- candidateApis 在两条路径中语义不同：路径一作为 bounded candidate 集直接传给大模型；路径二作为 RAG 召回结果为空时的 fallback

### D2: Prompt 配置复用 LLM 节点机制

复用 enhance-ts-workflow-llm-nodes 已有的 prepareLlmPrompt + 模板引擎（n() / renderTemplate），不新增 resolvePromptTemplate 回调：

1. top1_choice_prompt 非空 → 直接使用内容，经 n() 渲染变量
2. api_choice_prompt_template_name 非空 → 通过 prepareLlmPrompt 按名称查询模板
3. 都为空 → 使用默认标签 API_CHOICE 查询
4. 都查不到 → 报错终止（WORKFLOW_API_CHOICE_PROMPT_UNAVAILABLE）

Prompt 变量替换：复用模板引擎的 ${var} / {% for %} / {% if %} 语法，与 LLM 节点保持一致。

### D3: 知识召回路径

当 open_api_knowledge_recall=true 时，在 API 召回之外额外执行知识召回：

1. 将 rag_index 按 indexType 分为 API 类索引和 Knowledge 类索引两组
2. API 类索引用于 API 召回（已有逻辑）
3. Knowledge 类索引用于知识召回，并行调用检索接口
4. 知识内容拼接为字符串，写入 knowledge 输出变量
5. 知识召回结果为空时报错终止（WORKFLOW_API_CHOICE_KNOWLEDGE_EMPTY）

两路召回独立执行：API 召回结果决定 api_name，知识召回结果填充 knowledge。当 open_api_knowledge_recall=false 时仅做一次 API 召回。

### D4: TopN 选 1 单条优化

RAG 召回结果仅 1 条时，直接使用该 API 名称，不调用大模型。这减少了一次模型调用开销。

### D5: 追问机制（复用 restful-param-extract 同形同策）

复用 restful-param-extract 已有的 NEED_MORE_KEY 追问机制，不引入 RETRY_RAG 重试：

- open_reflection=true 时，在 prompt 中添加“如需更多信息，设置 NEED_MORE_KEY 为追问问题”指引
- 大模型返回包含 NEED_MORE_KEY → 提取追问问题，抛出 WORKFLOW_API_CHOICE_FOLLOW_UP 异常
- open_reflection=false（默认）时，不添加追问指引
- RETRY_RAG 重试机制为 deferred，当前无 Recipe 使用，后续如需可通过 engine retry + attempt 参数实现
### D6: 节点级模型路由复用

复用已有的 resolveModelForParamExtract 签名和语义，不新增 resolveApiChoiceModelConfig：

- model / modelGroup 通过 resolveModelForParamExtract(request, model, modelGroup) 覆盖全局配置，如未提供则回退到 resolveModelInvocationConfig
- model_params 合并到 ModelCommonOptions，节点级覆盖全局配置

### D7: 中间步骤事件

通过 emitOutputDelta + metadata.step 产出中间步骤，复用 TOOL_STRUCTURED_DELTA 投影路径，不新增独立 event type：

- step: "rag_recall"：RAG 召回阶段完成时产出，包含召回结果数量和耗时
- step: "rating"：精排阶段完成时产出，包含排序后候选列表
- step: "llm_reasoning"：大模型选择完成时产出，包含选中的 API 名称

### D8: think 标签移除（按能力项控制，默认不移除）

think 标签移除与能力项有关，默认不移除。仅当节点 inputs 中配置 remove_think_tags: "true" 时，在提取 API 名称前移除大模型返回中的 think 标签。此能力由 api-choice 节点内部实现，提取为 shared.ts 工具函数供其他节点复用。

### D9: 输出变量

| 输出 Key | 路径 | 说明 |
|---------|------|------|
| api_name | 两条路径 | 选中的 API 名称，供下游 ${api_name} 引用 |
| knowledge | 知识召回路径 | 知识召回内容字符串 |
| recall_result | RAG 路径 | API 召回的完整结果，仅在 Recipe 显式声明时投影 |
| knowledge_diagnostic | RAG 路径 | 检索状态信息（来源：WorkflowKnowledgeRetrievalResult.status + diagnosticReason），仅在 Recipe 显式声明时投影。与 knowledge-search / recipe-choice 同形同策 |

mappedParams 和 api_choice_result 不得成为 Recipe 1.0 DSL 输出（与已归档 design D5 一致）。

**knowledge_diagnostic 来源说明**：该字段来自 WorkflowKnowledgeRetrievalResult 的 status + diagnosticReason，knowledge-search 和 recipe-choice 节点已在输出此字段。api-choice 的 RAG 路径当前未输出，本 change 补齐以保持同形同策。与已归档 add-ts-workflow-knowledge-nodes/design.md 的“不得成为 DSL 输出”约束一致——本 change 中 knowledge_diagnostic 仅在 Recipe 显式声明 ${knowledge_diagnostic} 时投递，不作为默认 DSL 输出。

## 跨 Change 边界矩阵

| 依赖 change | 本 change 的职责 | 不 owner |
|------------|----------------|---------|
| add-ts-workflow-knowledge-nodes | 增强已有的 api-choice handler | 不修改 knowledge-search/knowledge-qa/recipe-choice |
| add-ts-workflow-llm-nodes | 复用 prepareLlmPrompt + 模板引擎 | 不 owner 通用 prompt assembly |
| add-ts-workflow-capability-nodes | api-choice 只产出选择结果 | 实际 API 调用由 restful owner |
| add-ts-workflow-interaction-nodes | 无交集 | sub-recipe 执行由 interaction owner |
| enhance-ts-workflow-llm-nodes | 复用模板引擎 n() / renderTemplate | 不 owner 模板引擎本身 |
| add-ts-workflow-rag-index-params | 复用已有 retrieveKnowledge 和 per-index 参数解析 | 不修改 RAG gateway contract |

## 输入参数完整列表

| Key | 类型 | 必填 | 默认值 | 说明 |
|-----|------|------|--------|------|
| open_api_recall | boolean | 否 | false | 是否开启 RAG API 召回 |
| open_api_knowledge_recall | boolean | 否 | false | 是否开启知识召回（需 open_api_recall=true） |
| top1_choice_prompt | string | 条件必填 | - | N 选 1 的 prompt |
| api_choice_prompt_template_name | string | 否 | - | prompt 模板名称，通过 prepareLlmPrompt 查询 |
| query | string | 否 | - | 查询知识的问题 |
| candidateApis | array | 条件必填 | - | bounded candidate API 列表（open_api_recall=false 时必填） |
| model | string | 否 | - | 模型名称 |
| modelGroup | string | 否 | - | 模型路由分组 |
| model_params | object | 否 | - | 模型扩展参数，全量透传 |
| open_reflection | boolean | 否 | false | 监督反思开关 |
| remove_think_tags | string | 否 | "false" | 是否移除大模型返回中的 think 标签 |
| rag_index | object/array | 否 | - | RAG 索引配置列表 |
| rank_topN | number | 否 | 5 | 检索知识条数，最大 10 |
| vs_topN | number | 否 | 10 | 向量检索 topN，范围 [1, 20] |
| es_topN | number | 否 | 10 | 文本检索 topN，范围 [1, 20] |
| extensions | string[] | 否 | - | 精确匹配扩展字段 |
| recall_condition | object | 否 | - | 分数过滤（vsScore/esScore/rerankScore） |
| api_group | string | 否 | - | API 分组 |
| local_language_key | string | 否 | zh | 当前语言环境 |