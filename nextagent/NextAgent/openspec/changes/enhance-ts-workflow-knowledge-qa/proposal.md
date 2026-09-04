## 背景与问题（Why）

KnowledgeQa 节点（`knowledge-qa`）已落地基础的"检索 + 单次 LLM 问答"能力：检索证据后，将全部知识打包进一个 prompt，调用大模型一次生成 `{answer, sourceRefs}`。但与业务规格（KnowledgeQa 节点完整描述）对比，存在以下缺口：

1. **缺少免推理（Free Infer）快捷路径**：业务规格要求当 `openFreeInfer=true` 且工作流恰好 3 个节点（START + 本节点 + END）且非 `FORCE_CLOSE` 时，先调用记忆服务判断是否可直接回答，命中则跳过整个 RAG 流程。当前实现完全没有此能力。
2. **LLM 调用模式不同**：业务规格要求对每条检索到的知识**逐条调用大模型做总结**（N 次调用，产出 `string[]` 总结列表），当前实现是单次调用（1 次，产出单个 `{answer, sourceRefs}`）。两者的输出语义和后续节点消费方式完全不同。
3. **缺少 `${knowledge}` 模板渲染**：业务规格要求 `llm_summery_prompt` 支持 `${knowledge}` 占位符获取当前遍历的知识条目，当前实现虽读取了 `llm_summery_prompt` 但仅作为 JSON payload 字段透传，不做占位符替换。
4. **缺少模型路由能力标识**：业务规格要求按 agent + 能力标识 `KNOWLEDGE_SUMMARY` + model/modelGroup 解析模型，当前实现通过 `resolveModelInvocationConfig(context.request)` 统一解析，不传能力标识。
5. **缺少 Prompt 模板服务**：业务规格要求按标签和能力查找系统预置 prompt 模板（fallback 到"知识总结"模板），当前实现使用硬编码 system prompt。
6. **缺少全局上下文参数接入**：业务规格要求从工作流上下文获取 `input_question`、`chat_id`、`conversation_id`、`agent_name`，当前 knowledge-qa 节点不读取这些字段。
7. **输出字段不完整**：业务规格要求输出 `knowledge_qa_result: string[]`（总结列表）、`llm_completion`（最后一次大模型原始结果）、`knowledge_search_result`（知识文本内容），当前实现的 `knowledge_qa_result` 是 `{answer, sourceDocuments}` 对象，`knowledge_search_result` 取的是 title/id 而非知识文本，且不输出 `llm_completion`。

## 变更范围（What Changes）

- **替换** 当前单次 LLM 问答逻辑为逐条知识 LLM 总结：对每条检索到的知识调用大模型做总结，产出 `knowledge_qa_result: string[]`；替换 baseline spec 中 Knowledge QA requirement 的输出 MUST 约束（`answer` + `sourceDocuments` → `knowledge_qa_result: string[]` + `llm_completion`）
- **新增** 免推理（Free Infer）判断逻辑：`openFreeInfer` + 3 节点工作流 + 非 `FORCE_CLOSE`（从 `executionMetadata.freeInferStatus` 读取）时，调用记忆服务判断是否可直接回答；命中后跳过 RAG，将记忆服务回答写入 `llm_completion`、`knowledge_qa_result`、`knowledge_search_result`
- **新增** `${knowledge}` 模板渲染：`llm_summery_prompt` 中的 `${knowledge}` 占位符替换为当前遍历的知识条目文本
- **新增** 模型路由能力标识：knowledge-qa 节点请求模型配置时携带能力标识 `KNOWLEDGE_SUMMARY`
- **新增** Prompt 模板 fallback：`llm_summery_prompt` 为空时，按标签 + 能力标识查找系统预置"知识总结"模板
- **新增** 全局上下文参数接入：`input_question`（引擎注入）、`agent_name`（→ `agentId`）、`chat_id`（→ `sessionId`）、`conversation_id`（→ `executionMetadata.conversation_id`）
- **增强** 输出字段：`knowledge_search_result` 输出知识文本内容（而非 title/id）；输出 `knowledge_qa_result: string[]`（总结列表）和 `llm_completion`（最后一次原始结果）
- **新增** 内容安全护栏内嵌：`open_guardrail=true` 时，LLM 调用链路内嵌内容安全检测，拦截时抛 `UN_SAFE` 异常

## Capability 影响（Capabilities）

### 新增 Capability

- `workflow-knowledge-qa-free-infer`：免推理判断逻辑，封装为独立函数，依赖记忆服务 boundary（`tryFreeInfer`）
- `workflow-knowledge-qa-summarize`：逐条知识 LLM 总结循环，含模板渲染、护栏异常隔离、通用异常处理

### 修改的 Capability

- `workflow-knowledge-nodes`（knowledge-qa 部分）：替换单次问答为逐条总结，新增 `openFreeInfer`、`open_guardrail`、`llm_summery_prompt` 模板渲染、全局上下文参数、输出字段增强

## 影响范围（Impact）

- `agent-workflow`：重构 `executeKnowledgeQaNode`，替换为逐条总结逻辑，新增 Free Infer 判断、模板渲染、模型路由能力标识、输出增强
- `agent-contracts`：无 core contract 变更（`WorkflowNodeDef.inputs`/`outputs` 保持 opaque）
- `agent-memory`：提供记忆服务 boundary（若已有则复用）
- 不影响 `knowledge-search`、`api-choice`、`recipe-choice` 节点
- 不影响非 workflow 场景

## 职责边界对齐（Boundary Alignment）

- 与 `add-ts-workflow-knowledge-nodes`（已归档）：本 change 替换 knowledge-qa 的 LLM 调用模式和输出契约，从单次问答改为逐条总结；替换 baseline spec 中 Knowledge QA requirement 的 MUST 约束（详见 spec.md Supersedes 声明）
- 与 `enhance-ts-workflow-llm-nodes`：模板引擎（`renderTemplate`）已由该 change 落地，本 change 的 `${knowledge}` 占位符替换复用 `interpolateString`，不引入新的模板语法
- 与 `add-ts-workflow-rag-index-params`（已归档）：检索参数（`rag_index`、`rank_topN`、`vs_topN`、`es_topN`）的解析和 gateway 调用逻辑不变
- 模型路由：通过 `resolveModelInvocationConfig` 增加可选第二参数（`capabilityId`），不引入新的 gateway port；现有调用方不受影响
- 记忆服务：通过 `tryFreeInfer` boundary 依赖注入接入，不在 knowledge-qa 节点内实现记忆服务逻辑；记忆服务实现方 MUST 使用 `request.identityContext` 的 owner scope 隔离查询
- 内容安全护栏：`open_guardrail` 控制是否启用，复用现有 `evaluateGuardrail` boundary；不新增独立的 guardrail 节点
- 流式输出：复用引擎层已有的 `emitOutputDelta` + `NODE_OUTPUT_DELTA` 机制，不在节点内直接发送流式状态消息
- `WorkflowNodeHandlerContext` 已包含 `recipe` 字段，3 节点判定直接从 `context.recipe.flowGraph.nodes` 统计，无需扩展 context

## 归档前基线更新（Baseline Promotion Plan）

- `openspec/specs/workflow-knowledge-nodes/spec.md`：替换 Knowledge QA requirement，从单次问答输出改为逐条总结输出，补充 Free Infer、模板渲染、全局上下文参数、输出字段约束
- `openspec/designs/modules/agent-workflow.md`：补充 knowledge-qa 节点的 Free Infer 和逐条总结设计
- `openspec/designs/functions/D9-Workflow编排/D9.2-节点与恢复/FN-9.6-执行知识节点.md`：更新知识 QA 节点功能描述

## 验证入口（Validation）

- UT：Free Infer 命中条件判断（`openFreeInfer` / 3 节点 / `FORCE_CLOSE` / 节点数≠3 组合覆盖）
- UT：逐条知识 LLM 总结循环 + `${knowledge}` 模板渲染
- UT：`llm_summery_prompt` 为空时 fallback 到系统预置模板
- UT：`open_guardrail=true` 时内容安全拦截抛 `UN_SAFE`
- UT：全局上下文参数 `input_question`/`agentId`/`sessionId`/`conversation_id` 正确读取和映射
- Integration test：Free Infer 命中后跳过 RAG，记忆服务回答写入输出
- Integration test：`knowledge_qa_result` 为 `string[]`（每条知识的总结）
- Integration test：`knowledge_search_result` 输出知识文本内容
- Architecture test：Free Infer 逻辑封装为独立函数，不在节点主流程内联

## 非目标（Non-Goals）

- 不修改 `knowledge-search`、`api-choice`、`recipe-choice` 节点的行为
- 不引入新的 workflow gateway port
- 不修改 `agent-contracts` 的 core contract schema
- 不实现记忆服务本身（只消费记忆服务 boundary）
- 不修改引擎层 loop 机制（循环结果累积仍由引擎 `loopConfig` owner）
- 不引入 `STREAM_RUNNING` / `STREAM_END` / `COMPLETE` 流式状态消息序列（复用引擎层 `NODE_OUTPUT_DELTA` 机制）
- 不保留当前的单次问答模式（`{answer, sourceRefs}` 输出被替换为逐条总结的 `string[]` 输出）
