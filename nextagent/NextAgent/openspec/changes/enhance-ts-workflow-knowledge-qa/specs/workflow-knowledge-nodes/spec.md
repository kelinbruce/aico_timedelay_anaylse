# workflow-knowledge-qa-enhancement Specification

## Purpose

增强 `knowledge-qa` 节点，替换单次 LLM 问答为逐条知识 LLM 总结，补充免推理快捷路径、模板渲染、模型路由能力标识、内容安全护栏内嵌、全局上下文参数接入，使其达到业务规格要求的企业级 RAG 总结节点能力。

## Supersedes

本 change 的以下 Requirement **替换** baseline spec `workflow-knowledge-nodes/spec.md` 中 `Knowledge QA` requirement 的 MUST 约束：

- `Per-Knowledge LLM Summarization` 替换 baseline 的"先检索证据，再基于证据生成回答"核心判断逻辑
- 输出从 `answer` + `sourceDocuments` 替换为 `knowledge_qa_result: string[]` + `llm_completion: string` + `knowledge_search_result: string[]`
- baseline 的 Scenario `Answer With Sources` 被 `Summarize Each Knowledge Item` 替换

baseline 的 `Knowledge Family Boundary` requirement 不受影响。

## ADDED Requirements

### Requirement: Per-Knowledge LLM Summarization

`knowledge-qa` 节点 MUST 对每条检索到的知识逐条调用大模型进行总结，输出总结列表。

**触发机制：**
- 节点 ready 时触发
- 属于单节点内的"检索阶段 + 逐条总结阶段"，同步执行

**输入与前置条件：**
- `query`（必填）
- `rag_index`（必填，索引配置列表）
- `llm_summery_prompt`：可选，大模型总结 prompt 模板，支持 `${knowledge}` 占位符
- `loop_element_variable`：可选，循环时的临时变量名，默认 `"knowledge"`
- `model` / `modelGroup`：可选，模型路由偏好
- `model_params`：可选，对象类型，选择性提取 `temperature`/`max_tokens`/`maxOutputTokens`/`enable_thinking` 合并到 `commonOptions`（与 `llm-nodes` 的 `modelParamsCommonOptions` 逻辑对齐）
- 可用模型调用服务

**输出与副作用：**
- `knowledge_qa_result`：`string[]`，每个元素为对应知识的总结
- `llm_completion`：`string`，最后一次大模型返回的原始结果
- `knowledge_search_result`：`string[]`，知识文本内容列表
- `recall_result`：`object[]`，RAG 完整返回结果
- `knowledge_diagnostic`：`object`，检索诊断信息

**核心判断逻辑：**
1. 对每条知识文本，依次调用大模型进行总结
2. 将当前知识条目注入模板变量（变量名由 `loop_element_variable` 决定，默认 `"knowledge"`）
3. 构建 Prompt：自定义 `llm_summery_prompt`（经 `interpolateString` 渲染）> 系统预置"知识总结"模板（经 `prepareLlmPrompt` 查找）> 硬编码默认模板
4. 模型路由（`resolveModelInvocationConfig` 携带能力标识 `KNOWLEDGE_SUMMARY`）
5. 调用大模型推理
6. 单次调用独立处理护栏异常（`UN_SAFE`）和通用异常
7. 收集所有总结结果

**状态 / 产物契约：**
- `knowledge_qa_result` 为 `string[]`，每个元素与检索到的知识条目一一对应
- `llm_completion` 为最后一次大模型返回的原始结果字符串
- 单条总结失败时对应位置为空字符串，不阻断整体

**流程接入：**
- 上游：`knowledge-search`、`question-rewriting`、用户输入节点
- 下游：`llm-router`、`display-content`、其他消费 `${knowledge_qa_result}` 的节点

**失败与降级：**
- 单条知识总结 LLM 调用失败（非安全类）-> 该条 summary 设为空字符串，记录 warning，继续下一条
- 内容安全拦截 -> 抛 `UN_SAFE` 异常，节点失败
- 检索结果为空 -> `knowledge_qa_result = []`、`knowledge_search_result = []`，不调用 LLM

#### Scenario: Summarize Each Knowledge Item
- **GIVEN** 检索到 3 条知识
- **WHEN** 节点执行完成
- **THEN** MUST 调用大模型 3 次（每条知识一次）
- **AND** `knowledge_qa_result` MUST 为 3 个元素的 `string[]`

#### Scenario: Template Variable Rendering
- **GIVEN** `llm_summery_prompt` 包含 `${knowledge}` 占位符
- **WHEN** 逐条总结执行
- **THEN** `${knowledge}` MUST 被替换为当前遍历的知识条目文本

#### Scenario: Single Item Failure Does Not Block
- **GIVEN** 第 2 条知识总结时 LLM 调用失败（非安全类异常）
- **WHEN** 节点执行完成
- **THEN** `knowledge_qa_result[1]` MUST 为空字符串
- **AND** `knowledge_qa_result[0]` 和 `knowledge_qa_result[2]` MUST 有值

### Requirement: Free Infer Shortcut

`knowledge-qa` 节点 MUST 在满足条件时执行免推理快捷路径，调用记忆服务直接回答，跳过 RAG 流程。

**触发机制：**
- 在节点执行的最开始阶段判断，先于知识检索

**输入与前置条件：**
- `openFreeInfer`：可选，布尔值，默认 `false`
- `FreeInferStatus`：从 `context.request.executionMetadata?.freeInferStatus` 读取，值为 `"FORCE_CLOSE"` 时强制跳过
- 工作流恰好有 3 个节点（START + 本节点 + END）
- 记忆服务 boundary（`tryFreeInfer`）已注入

**核心判断逻辑：**
1. `openFreeInfer` 不为 `true` -> 跳过免推理
2. `executionMetadata.freeInferStatus` 为 `"FORCE_CLOSE"` -> 强制跳过
3. 工作流节点数 ≠ 3 -> 跳过免推理
4. `tryFreeInfer` boundary 未注入 -> 跳过免推理
5. 满足以上全部条件后，调用记忆服务 `tryFreeInfer`，传入 `question`（`input_question`）、`chatId`（`sessionId`）、`conversationId`、`agentName`（`agentId`）
6. 记忆服务返回 `hit: true` 且有 `answer` -> 跳过 RAG，将 answer 写入输出字段
7. 记忆服务返回 `hit: false` 或调用失败 -> 回退到正常 RAG 流程

**输出与副作用：**
- 免推理命中后：`knowledge_qa_result = [answer]`、`knowledge_search_result = [answer]`、`llm_completion = answer`
- 不产生检索诊断信息（`knowledge_diagnostic` 置空）

**状态 / 产物契约：**
- `tryFreeInfer` 通过 `request` 字段携带 owner scope（`identityContext`），记忆服务实现方 MUST 使用 owner scope 隔离查询
- `tryFreeInfer` 接受 `AbortSignal`，支持 runtime cancellation

**流程接入：**
- 上游：与 `Per-Knowledge LLM Summarization` 相同
- 下游：与 `Per-Knowledge LLM Summarization` 相同

**失败与降级：**
- 记忆服务未注入 -> 回退到正常 RAG 流程
- 记忆服务调用失败 -> 回退到正常 RAG 流程（不因记忆服务故障阻断工作流）
- `openFreeInfer=false` -> 跳过免推理
- `freeInferStatus="FORCE_CLOSE"` -> 强制跳过免推理
- 工作流节点数 ≠ 3 -> 跳过免推理

#### Scenario: Free Infer Hit
- **GIVEN** `openFreeInfer=true` 且工作流有 3 个节点且记忆服务返回 `hit: true`
- **WHEN** 节点执行完成
- **THEN** 输出 MUST 为记忆服务的回答结果
- **AND** MUST NOT 调用知识检索 API

#### Scenario: Free Infer Miss Falls Back to RAG
- **GIVEN** `openFreeInfer=true` 且工作流有 3 个节点但记忆服务返回 `hit: false`
- **WHEN** 节点执行完成
- **THEN** MUST 执行正常 RAG 流程

#### Scenario: Free Infer Skipped When Not Three Nodes
- **GIVEN** `openFreeInfer=true` 但工作流节点数 ≠ 3
- **WHEN** 节点执行
- **THEN** MUST 跳过免推理，执行正常 RAG 流程

#### Scenario: Free Infer Force Closed
- **GIVEN** `openFreeInfer=true` 且 `executionMetadata.freeInferStatus="FORCE_CLOSE"`
- **WHEN** 节点执行
- **THEN** MUST 跳过免推理，执行正常 RAG 流程

### Requirement: Model Routing with Capability ID

`knowledge-qa` 节点 MUST 在请求模型配置时携带能力标识 `KNOWLEDGE_SUMMARY`。

**输入与前置条件：**
- `model`：可选，指定大模型名称
- `modelGroup`：可选，模型路由组
- 可用模型路由服务

**核心判断逻辑：**
1. 从节点 inputs 读取 `model` 和 `modelGroup`
2. 调用 `resolveModelInvocationConfig` 时传入 `capabilityId: "KNOWLEDGE_SUMMARY"` 和可选的 `modelName`/`modelGroup`
3. 实现方根据能力标识和模型偏好解析出应使用的大模型及路由策略

**状态 / 产物契约：**
- `resolveModelInvocationConfig` 的第二参数为可选对象，现有调用方不受影响

#### Scenario: Capability ID Passed to Model Router
- **WHEN** `knowledge-qa` 节点请求模型配置
- **THEN** `resolveModelInvocationConfig` MUST 收到 `capabilityId: "KNOWLEDGE_SUMMARY"`

### Requirement: Prompt Template Fallback

`llm_summery_prompt` 为空时，`knowledge-qa` 节点 MUST fallback 到系统预置"知识总结"模板。

**核心判断逻辑：**
1. `llm_summery_prompt` 非空 → 从 inputs 读取，经 `interpolateString` 渲染后作为 systemPrompt
2. `llm_summery_prompt` 为空 → 通过 `prepareLlmPrompt` 查找系统预置模板（`defaultPurpose: "KNOWLEDGE_SUMMARY"`）
3. `prepareLlmPrompt` 未注入或返回空 → 使用硬编码默认模板

#### Scenario: Custom Prompt Used When Provided
- **GIVEN** `llm_summery_prompt` 非空
- **WHEN** 逐条总结执行
- **THEN** 系统 MUST 使用 `llm_summery_prompt` 渲染后的内容作为 prompt

#### Scenario: System Default Template When Empty
- **GIVEN** `llm_summery_prompt` 为空或未配置
- **WHEN** 逐条总结执行
- **THEN** 系统 MUST fallback 到系统预置"知识总结"模板

### Requirement: Global Context Parameters

`knowledge-qa` 节点 MUST 从工作流请求和上下文读取全局参数。

**参数来源：**
- `input_question`：从 `inputs.input_question` 或 `context.variables.input_question` 读取（引擎层已注入）
- `agent_name`：映射到 `context.request.agentId`
- `chat_id`：映射到 `context.request.sessionId`
- `conversation_id`：从 `context.request.executionMetadata?.conversation_id` 读取；fallback 到 `context.variables.conversation_id`

**用途：**
- `input_question`：作为 Free Infer 的 `question` 参数；注入到模板 scope
- `chat_id`/`conversation_id`/`agent_name`：传递给 Free Infer 请求

#### Scenario: Global Context Read
- **GIVEN** 工作流请求携带 `agentId`、`sessionId`，且上下文包含 `input_question`
- **WHEN** `knowledge-qa` 节点执行
- **THEN** 节点 MUST 能读取 `input_question`、`agent_name`（agentId）、`chat_id`（sessionId）、`conversation_id`

### Requirement: Content Safety Guardrail Inline

`open_guardrail=true` 时，`knowledge-qa` 节点 MUST 在 LLM 调用后对模型输出内容执行内容安全检测。

**核心判断逻辑：**
1. `open_guardrail` 为 `true` 或 `"true"` 时，对每次 LLM 调用的输出执行 guardrail 检测
2. guardrail 返回 `safeError` 时，抛出对应的 `AgentError`（与 `executeGuardrailNode` 行为一致）
3. guardrail 返回 `REJECT` 时，抛 `UN_SAFE` 异常
4. `open_guardrail` 未开启时，不执行检测

**状态 / 产物契约：**
- 复用 `CreateWorkflowNodeCatalogOptions.evaluateGuardrail` boundary
- 不新增 guardrail 接口

**失败与降级：**
- guardrail 拦截 -> 抛 `UN_SAFE` 异常（`category: "POLICY_DENIED"`），节点失败
- guardrail 返回 `safeError` -> 抛出对应的 `AgentError`，节点失败
- `open_guardrail=true` 但 `evaluateGuardrail` boundary 未注入 -> 抛 `WORKFLOW_GUARDRAIL_BOUNDARY_UNAVAILABLE`（与 `executeGuardrailNode` 行为一致）

#### Scenario: Guardrail Rejects Unsafe Content
- **GIVEN** `open_guardrail=true` 且 LLM 输出包含不安全内容
- **WHEN** guardrail 检测执行
- **THEN** MUST 抛 `UN_SAFE` 异常
- **AND** 节点状态为 FAILED

#### Scenario: Guardrail Disabled by Default
- **GIVEN** `open_guardrail` 未配置或为 `false`
- **WHEN** 节点执行
- **THEN** MUST NOT 执行 guardrail 检测

### Requirement: Knowledge Search Result Content

`knowledge-qa` 节点的 `knowledge_search_result` 输出 MUST 为知识文本内容列表。

**核心判断逻辑：**
1. 从检索结果的 `recommends` 中提取每条知识的 `knowledge` 字段（文本内容）
2. 过滤掉空字符串
3. 输出为 `string[]`

**状态 / 产物契约：**
- `knowledge_search_result` 与 `knowledge-search` 节点的输出语义对齐
- 不输出 title/id 作为知识内容

#### Scenario: Knowledge Text Content Output
- **GIVEN** 检索到 2 条知识，各有 `knowledge` 文本字段
- **WHEN** 节点执行完成
- **THEN** `knowledge_search_result` MUST 为 2 个元素的 `string[]`，每个元素为知识文本内容

### Requirement: Free Infer Boundary Port

`knowledge-qa` 节点 MUST 通过 `tryFreeInfer` boundary 接入记忆服务，不在节点内实现记忆服务逻辑。

**接口定义：**
- `CreateWorkflowNodeCatalogOptions.tryFreeInfer?: (request: WorkflowFreeInferRequest, signal: AbortSignal) => Promise<WorkflowFreeInferResult>`
- `WorkflowFreeInferRequest`：含 `question`、`chatId`、`conversationId`、`agentName`、`request`（携带 owner scope）
- `WorkflowFreeInferResult`：含 `hit: boolean`、`answer?: string`
- 接受 `AbortSignal`，支持 runtime cancellation

**状态 / 产物契约：**
- `tryFreeInfer` 为可选注入，未注入时跳过 Free Infer
- 记忆服务实现方 MUST 使用 `request.identityContext` 的 owner scope 隔离查询
- 记忆服务实现由 `agent-app` composition 层接线

#### Scenario: Free Infer Boundary Not Injected
- **GIVEN** `openFreeInfer=true` 且工作流有 3 个节点但 `tryFreeInfer` 未注入
- **WHEN** 节点执行
- **THEN** MUST 回退到正常 RAG 流程

### Requirement: Model Params Pass-Through

`knowledge-qa` 节点 MUST 支持通过 `model_params` 传递模型扩展参数。

**输入与前置条件：**
- `model_params`：可选，对象类型

**核心判断逻辑：**
1. 从节点 inputs 读取 `model_params` 对象
2. 从 `model_params` 选择性提取 `temperature`/`max_tokens`/`maxOutputTokens`/`enable_thinking`，合并到模型调用的 `commonOptions` 中，与 `llm-nodes` 的 `modelParamsCommonOptions` 逻辑对齐（不做 Object spread 全量透传）

#### Scenario: Model Params Passed Through
- **GIVEN** `model_params` 配置了 `temperature: 0.3`
- **WHEN** 节点调用大模型
- **THEN** 模型请求的 `commonOptions` MUST 包含 `temperature: 0.3`（经 `modelParamsCommonOptions` 选择性提取，非 Object spread 全量透传）

### Requirement: Empty Retrieval Output

检索结果为空时，`knowledge-qa` 节点 MUST 输出空列表而非抛异常。

**核心判断逻辑：**
1. 检索结果 `recommends` 为空时
2. `knowledge_qa_result = []`、`knowledge_search_result = []`、`llm_completion = ""`
3. 不调用 LLM

#### Scenario: Empty Retrieval Produces Empty Output
- **GIVEN** 检索结果为空
- **WHEN** 节点执行完成
- **THEN** `knowledge_qa_result` MUST 为 `[]`
- **AND** `knowledge_search_result` MUST 为 `[]`
- **AND** 节点状态为 COMPLETED
