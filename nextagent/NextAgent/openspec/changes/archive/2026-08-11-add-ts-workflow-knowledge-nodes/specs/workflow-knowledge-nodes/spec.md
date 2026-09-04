## ADDED Requirements

### Requirement: Knowledge Search

`knowledge-search` MUST 在不调整 Recipe YAML DSL 的前提下，按既有检索配置执行知识检索。

knowledge 节点的 node-specific schema MUST 由本 change owner 定义；`agent-contracts/core` 中的 `WorkflowNodeDef.inputs`、`outputs`、`outputParser` 只作为 opaque 容器，不得在 core contracts 中枚举 knowledge 私有字段。

**触发机制：**
- 当节点 ready 时触发
- 位于 workflow execution 阶段，同步启动检索、异步等待检索结果

**输入与前置条件：**
- `rag_index`
- `query`
- 可选 `filters`、`rank_topN`、`vs_topN`、`es_topN`
- 知识 gateway 可用

**输出与副作用：**
- `documents`
- recall / ranking diagnostic

**核心判断逻辑：**
1. 解析 `rag_index` 和查询参数
2. 调用知识检索 gateway
3. 对结果排序并裁剪到声明的 topN
4. 生成 safe 文档摘要

**状态 / 产物契约：**
- `documents` 是安全检索结果，不等于原始全文
- 每条文档 SHOULD 包含可追溯 ref、标题摘要、score 摘要

**流程接入：**
- 上游：`question-rewriting`、用户输入、其他参数节点
- 下游：`knowledge-qa`、`llm-router`

**失败与降级：**
- 检索失败 -> 明确失败或走 `onError`
- 结果过大 -> MUST 裁剪或摘要，不得静默全量透传

#### Scenario: Ranked Safe Documents
- **WHEN** `knowledge-search` 返回多个结果
- **THEN** 系统 MUST 输出排序后的 safe `documents`

### Requirement: Knowledge Family Boundary

workflow knowledge 节点 MUST 只 owner retrieval、evidence-bounded QA 和 candidate selection 语义，不得与其他 workflow node families 的 owner 冲突。

#### Scenario: Choice Does Not Execute
- **GIVEN** `api-choice` 与 `recipe-choice` 是 knowledge family 节点
- **WHEN** 它们完成候选排序与选择
- **THEN** 它们 MUST 只输出 safe 选择结果
- **AND** 实际 API 调用 MUST 由 capability `restful` 节点 owner
- **AND** 实际子流程执行 MUST 由 interaction `sub-recipe` 节点 owner
- **AND** 通用 prompt assembly 与通用结构化模型输出规则 MUST 继续由 LLM family owner

### Requirement: Knowledge QA

`knowledge-qa` MUST 先检索证据，再基于证据生成回答。

**触发机制：**
- 节点 ready 时触发
- 属于单节点内的“检索阶段 + 模型回答阶段”

**输入与前置条件：**
- `query`
- knowledge retrieval config
- 可用模型调用服务

**输出与副作用：**
- `answer`
- `sourceDocuments`

**核心判断逻辑：**
1. 先执行知识检索
2. 对证据做裁剪 / 摘要
3. 组装问答 prompt
4. 调用模型生成 answer

**状态 / 产物契约：**
- `sourceDocuments` MUST 与 answer 保持可追溯关系
- 原始大文档 MUST NOT 全量落地到 output

**失败与降级：**
- 检索为空 -> 可返回空证据失败、空回答失败或按 `onError` 降级，但不得伪造证据

#### Scenario: Answer With Sources
- **WHEN** `knowledge-qa` 完成
- **THEN** 输出 MUST 同时包含 `answer` 和 `sourceDocuments`

### Requirement: API Choice

`api-choice` MUST 在 bounded candidate API 集合中选择最合适的 API，并通过 Recipe 1.0 DSL 固定字段 `api_name` 输出选择结果。

**触发机制：**
- 节点 ready 时触发

**输入与前置条件：**
- `taskDescription`
- bounded `candidateApis`

**输出与副作用：**
- `api_name`
- RAG 召回路径可选输出 `recall_result`；只有 Recipe 显式声明该输出时才投影，不得要求只消费 `api_name` 的 Recipe 同时声明该字段

**核心判断逻辑：**
1. 基于任务描述和候选集做选择
2. 校验输出 API 属于候选集
3. 将内部 `apiName` 映射为 DSL 边界的 `api_name`

**状态 / 产物契约：**
- `api_name` MUST 通过 `${api_name}` 投影并供下游 `restful.inputs.api_name` 消费
- `apiName`、`mappedParams`、`api_choice_result` 和 `knowledge_diagnostic` MUST NOT 作为 Recipe 1.0 DSL 输出

**流程接入：**
- 下游：`restful`

**失败与降级：**
- 候选集外结果 -> validation 失败

#### Scenario: Bounded API Selection
- **WHEN** `api-choice` 返回所选 API
- **THEN** 所选 API MUST 来自候选集

#### Scenario: API Name Field Preserved
- **WHEN** recipe 声明 `outputs.api_name: ${api_name}`
- **THEN** 节点 MUST 产出非空 `api_name`
- **AND** 下游 `restful` MUST 能通过 `${api_name}` 解析该值

#### Scenario: RAG API Name Without Recall Result
- **GIVEN** `api-choice` 通过 RAG 召回候选 API
- **WHEN** recipe 只声明 `outputs.api_name: ${api_name}`
- **THEN** 节点 MUST 将最终选择的 API 名称投影到 `api_name`
- **AND** MUST NOT 因未声明可选的 `recall_result` 而拒绝该 recipe
- **AND** 输出 MUST NOT 包含未声明的 `recall_result`

#### Scenario: Camel Case Output Rejected
- **WHEN** recipe 声明 `outputs.apiName: ${apiName}`
- **THEN** 节点输入校验 MUST 明确失败
- **AND** MUST NOT 调用模型或知识 gateway

### Requirement: Recipe Choice

`recipe-choice` MUST 在 bounded candidate recipe 集合中选择最合适的 recipe，并保持 DSL 输出字段为 `recipe_name`。

**触发机制：**
- 节点 ready 时触发

**输入与前置条件：**
- `taskDescription`
- bounded `candidateRecipes`

**输出与副作用：**
- `recipe_name`

**核心判断逻辑：**
1. 在候选集内选择 recipe
2. 校验输出属于候选集
3. 输出 `recipe_name`

**状态 / 产物契约：**
- `recipe_name` 在 DSL 中表示子流程标识；其解析 MUST 由下游 `sub-recipe` 通过 app-composed recipe definition source `require(agentId, recipe_name)` 完成
- 生命周期与当前 execution 相同；消费方为下游 `sub-recipe`

**流程接入：**
- 下游：`sub-recipe`

**失败与降级：**
- 候选集外结果 -> validation 失败
- 选中的 `recipe_name` 未注册 -> 下游 `sub-recipe` MUST 明确失败

#### Scenario: Recipe Name Field Preserved
- **WHEN** `recipe-choice` 执行完成
- **THEN** 系统 MUST 输出 DSL 字段 `recipe_name`
- **AND** MUST NOT 借本 change 调整该 DSL 字段名
