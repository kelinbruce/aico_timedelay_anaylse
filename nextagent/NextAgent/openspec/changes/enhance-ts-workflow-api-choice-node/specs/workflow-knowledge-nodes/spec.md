# enhance-ts-workflow-api-choice-node Specification

## Purpose

增强 api-choice 节点，覆盖产品 Recipe YAML 规范定义的完整能力：显式路径控制、Prompt 配置体系、知识召回、追问机制、模型路由透传和中间步骤事件。

## ADDED Requirements

### Requirement: Path Entry Control

api-choice MUST 根据 open_api_recall 开关显式决定执行路径。

**输入与前置条件：**
- open_api_recall 为 false 或空（默认）：走纯大模型 N 选 1 路径，必须提供 candidateApis
- open_api_recall 为 true：走 RAG 召回 + 大模型 TopN 选 1 路径

**核心判断逻辑：**
1. 读取 open_api_recall 输入参数
2. false/空 → 走路径一（纯大模型），校验 candidateApis 非空
3. true → 走路径二（RAG + 大模型）

#### Scenario: Default No RAG
- **WHEN** open_api_recall 为 false 或未设置
- **THEN** 节点 MUST 走纯大模型 N 选 1 路径
- **AND** MUST 要求 candidateApis 提供选择依据

#### Scenario: No RAG No Candidates
- **WHEN** open_api_recall 为 false 且 candidateApis 为空
- **THEN** 节点 MUST 报错终止（WORKFLOW_API_CHOICE_NO_CANDIDATES）

#### Scenario: RAG Enabled
- **WHEN** open_api_recall 为 true
- **THEN** 节点 MUST 先执行 RAG 召回，再从 TopN 候选中大模型选 1

### Requirement: Pure LLM N-Select-1

当不开启 RAG 召回时，api-choice MUST 使用大模型从 bounded candidate 中选择最合适的 API。

**输入与前置条件：**
- candidateApis（必填）：bounded candidate API 列表
- top1_choice_prompt（可选）：大模型推理 prompt
- 可用模型调用服务

**核心判断逻辑：**
1. 获取 Prompt 内容（复用 prepareLlmPrompt + 模板引擎 n()）
2. 将流程上下文变量替换到 prompt 占位符
3. 调用大模型推理
4. 从结果中提取 API 名称

**Prompt 选取优先级：**
1. top1_choice_prompt 非空 → 直接使用，经 n() 渲染变量
2. api_choice_prompt_template_name 非空 → 通过 prepareLlmPrompt 按名称查询模板
3. 都为空 → 使用默认标签 API_CHOICE 查询
4. 都查不到 → 报错终止

#### Scenario: Top1 Choice Prompt
- **WHEN** open_api_recall 为 false 且 top1_choice_prompt 非空
- **THEN** 节点 MUST 使用该 prompt 调用大模型选择 API
- **AND** 输出 MUST 包含 api_name

#### Scenario: No Prompt No RAG
- **WHEN** open_api_recall 为 false 且 top1_choice_prompt 为空且无法获取模板
- **THEN** 节点 MUST 报错终止（WORKFLOW_API_CHOICE_PROMPT_UNAVAILABLE）

### Requirement: RAG Recall and TopN-Select-1

当开启 RAG 召回时，api-choice MUST 先执行 RAG 检索，再从候选中选 1。

**输入与前置条件：**
- rag_index + query
- 可用知识检索 gateway
- 可用模型调用服务

**核心判断逻辑：**
1. 将 rag_index 按 indexType 分为 API 类和 Knowledge 类两组
2. API 类索引执行 API 召回
3. 召回仅 1 条 → 直接使用，不调用大模型
4. 召回多于 1 条 → 大模型 TopN 选 1
5. 召回为空 → 报错终止

#### Scenario: Single Recall Result
- **WHEN** RAG 召回仅返回 1 条结果
- **THEN** 节点 MUST 直接使用该 API 名称，不调用大模型

#### Scenario: Multiple Recall Results
- **WHEN** RAG 召回返回多条结果
- **THEN** 节点 MUST 由大模型从候选中选择 1 个

### Requirement: Knowledge Recall

当 open_api_knowledge_recall=true 时，api-choice MUST 额外执行知识召回。

**输入与前置条件：**
- open_api_recall=true 且 open_api_knowledge_recall=true
- rag_index 中包含 Knowledge 类索引

**核心判断逻辑：**
1. 使用 Knowledge 类索引列表构建检索任务
2. 并行调用检索接口
3. 获取知识内容列表
4. 知识内容拼接为字符串，写入 knowledge 输出变量
5. 知识召回结果为空 → 报错终止

**条件矩阵：**

| open_api_recall | open_api_knowledge_recall | 行为 |
|-----------------|---------------------------|------|
| false | 任意 | 不执行任何召回 |
| true | false | 仅做一次 API 召回 |
| true | true | API 召回 + 知识召回（两次召回） |

#### Scenario: Knowledge Recall Enabled
- **WHEN** open_api_recall=true 且 open_api_knowledge_recall=true
- **THEN** 节点 MUST 执行 API 召回和知识召回
- **AND** 输出 MUST 包含 knowledge

#### Scenario: Knowledge Recall Empty
- **WHEN** 知识召回结果为空
- **THEN** 节点 MUST 报错终止（WORKFLOW_API_CHOICE_KNOWLEDGE_EMPTY）

### Requirement: Follow-up Question (Reuses restful-param-extract Pattern)

api-choice MUST 支持追问机制，复用 restful-param-extract 已有的 NEED_MORE_KEY 模式。

**输入与前置条件：**
- open_reflection=true

**核心判断逻辑：**
1. open_reflection=true 时，在 prompt 中添加“如需更多信息，设置 NEED_MORE_KEY 为追问问题”指引
2. 大模型返回包含 NEED_MORE_KEY → 提取追问问题，抛出 WORKFLOW_API_CHOICE_FOLLOW_UP 异常
3. open_reflection=false（默认）时，不添加追问指引

**RETRY_RAG 重试为 deferred**：当前无 Recipe 使用，后续如需可通过 engine retry + attempt 参数实现。

#### Scenario: Follow Up Question
- **WHEN** open_reflection=true 且大模型返回 NEED_MORE_KEY
- **THEN** 节点 MUST 抛出参数追问异常（WORKFLOW_API_CHOICE_FOLLOW_UP）

### Requirement: Model Routing Passthrough

api-choice MUST 支持节点级模型路由参数透传。

**输入与前置条件：**
- model / modelGroup / model_params

**核心判断逻辑：**
1. 如提供 model/modelGroup，通过 resolveModelForParamExtract(request, model, modelGroup) 覆盖全局模型配置，如未提供则回退到 resolveModelInvocationConfig
2. model_params 合并到 ModelCommonOptions，节点级覆盖全局

#### Scenario: Model Params Passthrough
- **WHEN** 节点提供 model_params
- **THEN** 参数 MUST 透传到模型推理请求

### Requirement: Intermediate Step Events

api-choice MUST 产出中间步骤事件。

**产出方式：** 通过 emitOutputDelta + metadata.step 投影为 TOOL_STRUCTURED_DELTA，复用现有 projector 路径。

**产出时机：**
- step: "rag_recall"：RAG 召回完成时
- step: "rating"：精排完成时
- step: "llm_reasoning"：大模型选择完成时

#### Scenario: RAG Recall Event
- **WHEN** RAG 召回完成
- **THEN** 节点 MUST 产出 step: "rag_recall" 中间步骤事件

### Requirement: Output Variables

api-choice MUST 输出以下变量：

| 输出 Key | 路径 | 条件 | 说明 |
|---------|------|------|------|
| api_name | 两条路径 | 始终 | 选中的 API 名称 |
| knowledge | 知识召回路径 | open_api_knowledge_recall=true | 知识召回内容字符串 |
| recall_result | RAG 路径 | Recipe 显式声明时投影 | API 召回完整结果 |
| knowledge_diagnostic | RAG 路径 | Recipe 显式声明时投影 | 检索状态信息（来源：WorkflowKnowledgeRetrievalResult.status + diagnosticReason，与 knowledge-search / recipe-choice 同形同策） |

mappedParams 和 api_choice_result 不得成为 Recipe 1.0 DSL 输出。

#### Scenario: Knowledge Output
- **WHEN** 知识召回完成
- **THEN** 输出 MUST 包含 knowledge 字段

#### Scenario: No Unauthorized DSL Outputs
- **WHEN** api-choice 完成
- **THEN** 输出 MUST NOT 包含 mappedParams 或 api_choice_result

### Requirement: Think Tag Removal (Opt-in)

api-choice 默认不移除大模型返回中的 think 标签。仅当节点 inputs 配置 remove_think_tags: "true" 时，MUST 在提取 API 名称前移除大模型返回结果中的 think 标签。think 标签移除逻辑提取为 shared.ts 工具函数供其他节点复用。

#### Scenario: Think Tags Removed When Opt-in
- **WHEN** 大模型返回包含 think 标签且 remove_think_tags: "true"
- **THEN** 节点 MUST 在提取 API 名称前移除该标签内容

#### Scenario: Think Tags Preserved By Default
- **WHEN** 大模型返回包含 think 标签且未配置 remove_think_tags
- **THEN** 节点 MUST NOT 移除 think 标签