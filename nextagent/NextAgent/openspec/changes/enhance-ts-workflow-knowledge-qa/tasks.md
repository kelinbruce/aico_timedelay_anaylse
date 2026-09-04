# Implementation Tasks

## 1. Contract & Types

- [x] 1.1 定义 `WorkflowFreeInferRequest` / `WorkflowFreeInferResult` 接口（`packages/agent-workflow/src/nodes/types.ts`）
- [x] 1.2 在 `CreateWorkflowNodeCatalogOptions` 中新增可选 `tryFreeInfer` boundary 字段
- [x] 1.3 扩展 `resolveModelInvocationConfig` 签名，增加可选第二参数 `{ capabilityId?, modelName?, modelGroup? }`

## 2. Free Infer 逻辑

- [x] 2.1 实现 `shouldFreeInfer(inputs, context): boolean` 独立函数（`knowledge-nodes.ts`）
  - 检查 `openFreeInfer` 为 true
  - 检查 `context.request.executionMetadata?.freeInferStatus` 不为 `"FORCE_CLOSE"`
  - 检查工作流恰好 3 个节点（从 `context.recipe.flowGraph.nodes` 统计，context 已包含 recipe）
- [x] 2.2 实现 `tryFreeInferAnswer(context, options, inputs): Promise<WorkflowFreeInferResult | undefined>` 函数
  - 读取 `input_question`（variables）、`agentId`（request）、`sessionId`（request）、`conversation_id`（executionMetadata）
  - 调用 `options.tryFreeInfer`（传入 `signal`）
  - 记忆服务未注入或调用失败时返回 undefined
- [x] 2.3 在 `executeKnowledgeQaNode` 主流程中，Free Infer 命中时跳过 RAG，设置输出并返回

## 3. 逐条知识 LLM 总结

- [x] 3.1 实现 `summarizeKnowledgeItems(context, options, modelConfig, inputs, knowledgeItems, loopElementVariable)` 函数
  - 遍历 `knowledgeItems`
  - 注入模板变量 `{ [loopElementVariable]: knowledgeItem }`
  - 构建 Prompt（自定义 > 系统预置 > 硬编码兜底）
  - 调用大模型（携带能力标识 `KNOWLEDGE_SUMMARY`）
  - 收集总结结果和 `lastCompletion`
- [x] 3.2 单条总结异常隔离：非安全类异常时该条 summary 设为空字符串 + warning 日志（使用 `getLogger({ component: "agent-workflow", source: "knowledge-nodes" })`）
- [x] 3.3 `UN_SAFE` 异常直接抛出，中断循环
- [x] 3.4 检索结果为空时返回 `{ summaries: [], lastCompletion: "" }`，不调用 LLM
- [x] 3.5 替换 `executeKnowledgeQaNode` 主流程：Free Infer 判断 → 检索 → 逐条总结 → 输出 `knowledge_qa_result: string[]` 和 `llm_completion`

## 4. 模板渲染

- [x] 4.0 在 `shared.ts` 中导出 `interpolateString` 函数（添加 `export` 关键字，当前为模块内部函数）
- [x] 4.1 使用 `interpolateString` 渲染 `llm_summery_prompt` 中的 `${knowledge}` 占位符
- [x] 4.2 `loop_element_variable` 默认值为 `"knowledge"`（从 inputs 读取，fallback 到 `"knowledge"`）
- [x] 4.3 `llm_summery_prompt` 为空时通过 `prepareLlmPrompt`（`defaultPurpose: "KNOWLEDGE_SUMMARY"`）查找系统预置模板
- [x] 4.4 `prepareLlmPrompt` 未注入或返回空时使用硬编码默认模板

## 5. 模型路由

- [x] 5.1 从 inputs 读取 `model` 和 `modelGroup`
- [x] 5.2 调用 `resolveModelInvocationConfig` 时传入 `{ capabilityId: "KNOWLEDGE_SUMMARY", modelName?, modelGroup? }`
- [x] 5.3a 将 `llm-nodes.ts` 中的 `modelParamsCommonOptions` 函数移动到 `shared.ts` 并导出（当前为 `llm-nodes.ts` 内部私有函数），或在 `knowledge-nodes.ts` 中复制相同逻辑
- [x] 5.3b 从 inputs 读取 `model_params` 对象，选择性提取 `temperature`/`max_tokens`/`maxOutputTokens`/`enable_thinking` 合并到 `commonOptions`（复用 5.3a 导出的函数，不做 Object spread 全量透传）

## 6. 内容安全护栏

- [x] 6.1 读取 `open_guardrail` 参数（支持 boolean 和 `"true"`/`"false"` 字符串）
- [x] 6.2 `open_guardrail=true` 时，在每次 LLM 调用后对输出执行 `evaluateGuardrail` 检测
  - 填充 `WorkflowGuardrailRequest` 所有必填字段：`policyId`、`guardrailType`、`content`（模型输出）、`safeContentSummary`（截断前 200 字符）、`sessionId`、`requestId`、`runId`、`agentId`、`agentVersion`、`workflowNodeId`、`workflowNodeType`（从 `context.request` 和 `context.node` 读取，与 `executeGuardrailNode` 调用模式一致）
- [x] 6.3 guardrail 返回 `safeError` 时，抛出对应的 `AgentError`（先于 `decision` 检查，与 `executeGuardrailNode` 行为一致）
- [x] 6.4 guardrail 返回 `REJECT` 时抛 `UN_SAFE` 异常（`category: "POLICY_DENIED"`）
- [x] 6.5 `open_guardrail=true` 但 `evaluateGuardrail` boundary 未注入时抛 `WORKFLOW_GUARDRAIL_BOUNDARY_UNAVAILABLE`
- [x] 6.6 `open_guardrail` 未开启时不执行检测

## 7. 输出字段

- [x] 7.1 输出 `knowledge_qa_result: string[]`（每条知识的总结列表）
- [x] 7.2 输出 `llm_completion: string`（最后一次大模型原始结果）
- [x] 7.3 输出 `knowledge_search_result: string[]`（知识文本内容，而非 title/id）
- [x] 7.4 输出 `recall_result` 和 `knowledge_diagnostic`
- [x] 7.5 移除 `answer`、`sourceDocuments`、`documents`、`invocation_trace` 输出
- [x] 7.6 Free Infer 命中输出：`knowledge_qa_result=[answer]`、`knowledge_search_result=[answer]`、`llm_completion=answer`
- [x] 7.7 检索为空输出：`knowledge_qa_result=[]`、`knowledge_search_result=[]`、`llm_completion=""`
- [x] 7.8 确保 `knowledge_search_result` 与 `knowledge-search` 节点的 `knowledgeSearchBindings` 逻辑对齐

## 8. 全局上下文参数

- [x] 8.1 实现 `resolveGlobalContextParams(inputs, context)` 辅助函数
  - `input_question`：`inputs.input_question` > `context.variables.input_question`
  - `agent_name`：`context.request.agentId`
  - `chat_id`：`context.request.sessionId`
  - `conversation_id`：`context.request.executionMetadata?.conversation_id` > `context.variables.conversation_id`
- [x] 8.2 Free Infer 请求中使用这些参数
- [x] 8.3 注入到模板 scope

## 9. 测试

- [x] 9.1 UT：`shouldFreeInfer` 条件覆盖（`openFreeInfer` / 3 节点 / `FORCE_CLOSE` / 节点数≠3 组合）
- [x] 9.2 UT：逐条总结循环 + `${knowledge}` 模板渲染
- [x] 9.3 UT：`llm_summery_prompt` 为空时 fallback 到系统预置模板
- [x] 9.4 UT：`open_guardrail=true` 时内容安全拦截抛 `UN_SAFE`
- [x] 9.4a UT：guardrail 返回 `safeError` 时抛出对应 `AgentError`
- [x] 9.4b UT：`open_guardrail=true` 但 `evaluateGuardrail` 未注入时抛 `WORKFLOW_GUARDRAIL_BOUNDARY_UNAVAILABLE`
- [x] 9.5 UT：全局上下文参数正确读取和映射（`input_question`/`agentId`/`sessionId`/`conversation_id`）
- [x] 9.6 UT：单条知识总结失败不阻断循环
- [x] 9.7 UT：检索结果为空时输出空列表
- [x] 9.8 UT：`model_params` 选择性提取到 `commonOptions`（`temperature`/`max_tokens`/`maxOutputTokens`/`enable_thinking`）
- [x] 9.9 UT：Free Infer 命中后跳过 RAG
- [x] 9.10 UT：Free Infer 未注入 boundary 时回退到 RAG
- [x] 9.11 UT：`knowledge_qa_result` 为 `string[]`
- [x] 9.12 UT：`knowledge_search_result` 输出知识文本内容
- [x] 9.13 Integration test：Free Infer 命中后记忆服务回答写入输出
- [x] 9.14 Integration test：逐条总结模式下 `knowledge_qa_result` 为 `string[]`
- [x] 9.15 Integration test：`knowledge_search_result` 输出知识文本内容
- [x] 9.16 Architecture test：Free Infer 逻辑封装为独立函数

## 10. 文档与基线

- [x] 10.1 更新 `docs/workflow-usage-guide.md`：knowledge-qa 节点输出字段变更说明
- [x] 10.2 准备 release notes：标注 `knowledge_qa_result` 从对象变为 `string[]` 的 breaking change

## 11. 归档前基线更新

- [ ] 11.1 更新 `openspec/specs/workflow-knowledge-nodes/spec.md`：替换 Knowledge QA requirement（输出从 `answer`+`sourceDocuments` 改为 `knowledge_qa_result: string[]`+`llm_completion`），补充 Free Infer、模板渲染、全局上下文参数、输出字段约束
- [ ] 11.2 更新 `openspec/designs/modules/agent-workflow.md`：补充 knowledge-qa Free Infer 和逐条总结设计
- [ ] 11.3 更新 `openspec/designs/functions/D9-Workflow编排/D9.2-节点与恢复/FN-9.6-执行知识节点.md`：知识 QA 节点功能描述
