## 背景和现状

`knowledge-qa` 节点当前实现的是简化版 RAG 问答：检索证据 → 所有知识一次性发给 LLM → 返回 `{answer, sourceRefs}`。业务规格要求的是逐条知识总结：检索证据 → 对每条知识调用 LLM 做总结 → 输出 `string[]` 总结列表。此外还缺少免推理快捷路径、模板渲染、模型路由能力标识、内容安全护栏内嵌、全局上下文参数接入。

## 目标和非目标

**目标：**

- 替换单次 LLM 问答为逐条知识 LLM 总结，产出 `knowledge_qa_result: string[]`
- 支持免推理（Free Infer）快捷路径，命中时跳过 RAG 直接由记忆服务回答
- 支持 `${knowledge}` 占位符模板渲染
- 支持模型路由能力标识 `KNOWLEDGE_SUMMARY`
- 支持 `llm_summery_prompt` 为空时 fallback 到系统预置模板
- 支持全局上下文参数 `input_question`/`chat_id`/`conversation_id`/`agent_name`
- 支持 `open_guardrail` 内容安全护栏内嵌
- `knowledge_search_result` 输出知识文本内容

**非目标：**

- 不修改 `knowledge-search`、`api-choice`、`recipe-choice` 节点
- 不修改 `agent-contracts` 的 core contract schema
- 不实现记忆服务本身（只消费 boundary）
- 不修改引擎层 loop 机制
- 不引入 `STREAM_RUNNING`/`STREAM_END`/`COMPLETE` 流式状态消息序列
- 不保留当前的单次问答模式（`{answer, sourceRefs}` 输出被替换）

## 设计决策

### D1: 逐条知识 LLM 总结替换单次问答

当前 `executeKnowledgeQaNode` 将所有知识打包进一个 prompt，调用 LLM 一次生成 `{answer, sourceRefs}`。本 change 替换为：对每条检索到的知识文本，依次调用大模型进行总结，收集所有总结结果为 `string[]`。

**输出变化：**
- 移除：`answer`、`sourceDocuments`、`documents`、`invocation_trace`
- 新增：`knowledge_qa_result: string[]`（每条知识的总结）、`llm_completion: string`（最后一次大模型原始结果）
- 保留：`knowledge_search_result`（修复为知识文本内容）、`recall_result`、`knowledge_diagnostic`

**行为变更：** 这是破坏性变更，已有 recipe 如果依赖 `{answer, sourceRefs}` 输出需调整。当前 `knowledge_qa_result` 从 `{answer, sourceDocuments}` 对象变为 `string[]`。本 change 替换 baseline spec 中 Knowledge QA requirement 的 MUST 约束（详见 spec.md Supersedes 声明）。

### D2: 免推理（Free Infer）判断逻辑

封装为独立函数 `shouldFreeInfer`，位于 `knowledge-nodes.ts` 内：

```typescript
function shouldFreeInfer(
  inputs: Record<string, unknown>,
  context: WorkflowNodeHandlerContext
): boolean {
  // 1. openFreeInfer 未开启 -> false
  // 2. FreeInferStatus === "FORCE_CLOSE" -> false
  // 3. openFreeInfer=true 且工作流恰好 3 个节点 -> true（交由记忆服务判断）
  // 4. openFreeInfer=true 但节点数 ≠ 3 -> false
}
```

**`FreeInferStatus` 来源：** 从 `context.request.executionMetadata?.freeInferStatus` 读取。注意 `freeInferStatus` 是 `executionMetadata`（opaque `JsonObject`）中的动态字符串字段，不是 typed contract；节点直接按字符串值 `"FORCE_CLOSE"` 比较，不引入 typed enum 到 `agent-contracts`。`executionMetadata` 是 `WorkflowExecutionRequest` 的可选 JsonObject 字段，由请求发起方（channel adapter 或 retry 逻辑）在请求级别注入。值为 `"FORCE_CLOSE"` 时强制跳过免推理（通常用于重试请求，避免重复命中记忆服务缓存）。

**3 节点判定：** 从 `context.recipe.flowGraph.nodes` 统计节点数量。`WorkflowNodeHandlerContext` 已包含 `recipe: RecipeDefinition` 字段（[types.ts:43](packages/agent-workflow/src/nodes/types.ts:43)），无需扩展。

**记忆服务 boundary：** 新增 `CreateWorkflowNodeCatalogOptions.tryFreeInfer?` 可选函数：

```typescript
readonly tryFreeInfer?: (
  request: WorkflowFreeInferRequest,
  signal: AbortSignal
) => Promise<WorkflowFreeInferResult>;
```

```typescript
interface WorkflowFreeInferRequest {
  readonly question: string;
  readonly chatId?: string;
  readonly conversationId?: string;
  readonly agentName?: string;
  readonly request: WorkflowExecutionRequest;
}

interface WorkflowFreeInferResult {
  readonly hit: boolean;
  readonly answer?: string;
}
```

**owner scope 传播：** `tryFreeInfer` boundary 通过 `request` 字段携带 `WorkflowExecutionRequest`（含 `identityContext`），记忆服务实现方 MUST 使用 owner scope（tenant/subject）隔离查询，不得跨 owner 访问记忆数据。

**cancellation 传播：** `tryFreeInfer` 接受 `AbortSignal`，与 `retrieveKnowledge`/`evaluateGuardrail` boundary 一致。

**命中后行为：** `llm_completion`、`knowledge_qa_result`、`knowledge_search_result` 均设置为记忆服务的回答结果。`knowledge_qa_result` 设为 `[answer]`（单元素数组），`knowledge_search_result` 设为 `[answer]`，`llm_completion` 设为 answer。

**记忆服务未注入：** `tryFreeInfer` 为 undefined 时，`shouldFreeInfer` 返回 true 也不调用，直接回退到正常 RAG 流程。

### D3: 逐条知识 LLM 总结循环

封装为独立函数 `summarizeKnowledgeItems`：

```typescript
async function summarizeKnowledgeItems(
  context: WorkflowNodeHandlerContext,
  options: CreateWorkflowNodeCatalogOptions,
  modelConfig: WorkflowNodeModelInvocationConfig,
  inputs: Record<string, unknown>,
  knowledgeItems: readonly string[],
  loopElementVariable: string
): Promise<{ summaries: string[]; lastCompletion: string }>
```

**流程：**
1. 遍历 `knowledgeItems`（每条为知识文本内容）
2. 将当前知识条目注入模板变量：`{ [loopElementVariable]: knowledgeItem }`
3. 构建 Prompt：自定义 `llm_summery_prompt` > 系统预置"知识总结"模板
4. 调用大模型推理（携带能力标识 `KNOWLEDGE_SUMMARY`）
5. 单次调用独立处理护栏异常（`UN_SAFE`）和通用异常
6. 收集所有总结结果，返回 `summaries` 和 `lastCompletion`（最后一次原始结果）

**异常隔离：** 单条知识总结失败时，该条的 summary 设为空字符串并记录 warning，不中断整体循环。但 `UN_SAFE` 异常直接抛出（安全风险不可忽略）。

**日志规范：** warning 日志通过 `getLogger({ component: "agent-workflow", source: "knowledge-nodes" })` 输出（与 [workflow-recipe-loader.ts](packages/agent-workflow/src/workflow-recipe-loader.ts) 中已有的 logger 模式一致），不使用 `console.*`。

**`loop_element_variable` 默认值：** 从节点 inputs 读取 `loop_element_variable`，默认 `"knowledge"`（与业务规格一致）。注意与引擎层 loop 的 `"item"` 默认值不同，因为这是 knowledge-qa 节点内部的遍历变量。

### D4: `${knowledge}` 模板渲染

复用 `shared.ts` 中的 `interpolateString(template, scope)` 函数（该函数当前为模块内部函数，需在 `shared.ts` 中添加 `export` 关键字导出）：

```typescript
const renderedPrompt = interpolateString(
  llmSummeryPrompt ?? defaultSummaryTemplate,
  { ...context.variables, [loopElementVariable]: knowledgeItem }
) as string;
```

**`interpolateString` 已支持 `${var}` 语法：** 无需引入 `enhance-ts-workflow-llm-nodes` 的模板引擎（`renderTemplate`）。`${knowledge}` 是简单变量替换，不涉及 for/if 控制流。

### D5: 模型路由能力标识

扩展 `resolveModelInvocationConfig` 的调用方式，增加可选的 `capabilityId` 参数：

```typescript
// 当前
const modelConfig = await options.resolveModelInvocationConfig(context.request);

// 增强后
const modelConfig = await options.resolveModelInvocationConfig(context.request, {
  capabilityId: "KNOWLEDGE_SUMMARY"
});
```

**向后兼容：** `resolveModelInvocationConfig` 的第二个参数是可选的。现有调用不传 `capabilityId` 的地方行为不变。实现方（`agent-app` composition）可根据 `capabilityId` 做模型路由，也可忽略。

**`model`/`modelGroup` 参数：** 从节点 inputs 读取 `model` 和 `modelGroup`，传入 `resolveModelInvocationConfig` 的 options 中：

```typescript
const modelConfig = await options.resolveModelInvocationConfig(context.request, {
  capabilityId: "KNOWLEDGE_SUMMARY",
  ...(typeof inputs.model === "string" ? { modelName: inputs.model } : {}),
  ...(typeof inputs.modelGroup === "string" ? { modelGroup: inputs.modelGroup } : {})
});
```

### D6: Prompt 模板 fallback

**优先级（从高到低）：**
1. `llm_summery_prompt` 非空 → 从 inputs 读取，经 `interpolateString` 渲染后作为 systemPrompt
2. 系统预置"知识总结"模板 → 通过 `prepareLlmPrompt` 查找（`defaultPurpose: "KNOWLEDGE_SUMMARY"`）
3. 硬编码默认模板 → `"请对以下知识内容做总结，提取关键信息。"`

**系统预置模板查找：** 复用 `CreateWorkflowNodeCatalogOptions.prepareLlmPrompt`，传入 `defaultPurpose: "KNOWLEDGE_SUMMARY"`。`prepareLlmPrompt` 已有 fallback 逻辑，返回 `systemPrompt` 和 `userPrompt`。

**fallback 路径：** 若 `prepareLlmPrompt` 未注入或返回空 systemPrompt，使用硬编码默认模板。这是最后兜底，不期望频繁命中。

### D7: 全局上下文参数映射

从 `context.request` 和 `context.variables` 读取（引擎层 `initializeVariables` 已注入 `input_question`）：

```typescript
const inputQuestion = firstNonEmptyString(
  inputs.input_question,
  context.variables.input_question
) ?? "";
const agentName = context.request.agentId;
const chatId = context.request.sessionId;
const conversationId = firstNonEmptyString(
  context.request.executionMetadata?.conversation_id,
  context.variables.conversation_id
);
```

**参数映射决策：**
- `input_question`：从 `inputs.input_question` 或 `context.variables.input_question` 读取（引擎已注入）
- `agent_name` → `context.request.agentId`（WorkflowExecutionRequest 已有此字段）
- `chat_id` → `context.request.sessionId`（WorkflowExecutionRequest 已有此字段）
- `conversation_id`：从 `context.request.executionMetadata?.conversation_id` 读取（executionMetadata 是可选 JsonObject，由 channel adapter 在请求级别注入）；fallback 到 `context.variables.conversation_id`

**用途：**
- `input_question`：作为 Free Infer 的 `question` 参数；注入到模板 scope
- `chat_id`/`conversation_id`/`agent_name`：传递给 Free Infer 请求

### D8: 内容安全护栏内嵌

**`open_guardrail=true` 时：** 在每次 LLM 调用后，对模型输出内容执行 guardrail 检测：

```typescript
if (inputs.open_guardrail === true || inputs.open_guardrail === "true") {
  if (options.evaluateGuardrail === undefined) {
    throw new AgentError({
      code: "WORKFLOW_GUARDRAIL_BOUNDARY_UNAVAILABLE",
      message: "Workflow guardrail boundary is unavailable.",
      category: "UNAVAILABLE",
      retryable: false,
      safeDetails: { reasonCode: "WORKFLOW_GUARDRAIL_BOUNDARY_UNAVAILABLE", nodeId: context.nodeId }
    });
  }
  const guardrailResult = await options.evaluateGuardrail({
    policyId: "workflow:knowledge-qa",
    guardrailType: "ANSWER",
    content: modelResult.content,
    safeContentSummary: modelResult.content.slice(0, 200),
    sessionId: context.request.sessionId,
    requestId: context.request.requestId,
    runId: context.request.runId,
    agentId: context.request.agentId,
    agentVersion: context.request.agentVersion,
    workflowNodeId: context.nodeId,
    workflowNodeType: context.node.type
  }, context.signal);
  if (guardrailResult.safeError !== undefined) {
    throw new AgentError({
      code: guardrailResult.safeError.code,
      message: guardrailResult.safeError.message,
      category: guardrailResult.safeError.category,
      retryable: guardrailResult.safeError.retryable,
      ...(guardrailResult.safeError.safeDetails === undefined ? {} : { safeDetails: guardrailResult.safeError.safeDetails })
    });
  }
  if (guardrailResult.decision === "REJECT") {
    throw new AgentError({
      code: "UN_SAFE",
      message: "Content safety guardrail rejected the response.",
      category: "POLICY_DENIED",
      retryable: false,
      safeDetails: { reasonCode: "UN_SAFE", nodeId: context.nodeId }
    });
  }
}
```

**复用现有 `evaluateGuardrail` boundary：** 不新增 guardrail 接口。`evaluateGuardrail` 已在 `CreateWorkflowNodeCatalogOptions` 中定义。

**`safeError` 处理：** guardrail 返回 `safeError` 时，抛出对应的 `AgentError`（与 `executeGuardrailNode` 行为一致），先于 `decision` 检查。

**boundary 未注入：** `open_guardrail=true` 但 `evaluateGuardrail` 为 undefined 时，抛 `WORKFLOW_GUARDRAIL_BOUNDARY_UNAVAILABLE`（与 `executeGuardrailNode` 行为一致）。

**`open_guardrail` 未开启时：** 不执行 guardrail 检测，保持当前行为。

### D9: 输出字段

**正常逐条总结输出：**

```typescript
{
  knowledge_search_result: string[],      // 知识文本内容列表
  knowledge_qa_result: string[],          // 每条知识的总结列表
  llm_completion: string,                 // 最后一次大模型原始结果
  recall_result: JsonObject[],            // RAG 完整返回结果
  knowledge_diagnostic: JsonObject        // 检索诊断信息
}
```

**`knowledge_search_result` 修复：** 输出知识文本内容（`recommends` 中的 `knowledge` 字段），而非 title/id。与 `knowledge-search` 节点的 `knowledgeSearchBindings` 逻辑对齐。

**Free Infer 命中后输出：**
- `knowledge_qa_result = [answer]`
- `knowledge_search_result = [answer]`
- `llm_completion = answer`

**检索结果为空时输出：**
- `knowledge_qa_result = []`
- `knowledge_search_result = []`
- `llm_completion = ""`
- 不调用 LLM

### D10: Free Infer 命中后跳过检索

Free Infer 命中时，完全跳过 `retrieveKnowledge` 调用和 LLM 调用，直接设置输出变量返回。这是性能优化路径。

Free Infer 未命中（记忆服务返回 `hit: false`）时，回退到正常 RAG 流程。

### D11: recipe context 已可用

`WorkflowNodeHandlerContext` 已包含 `recipe: RecipeDefinition` 字段（[types.ts:43](packages/agent-workflow/src/nodes/types.ts:43)），引擎层在构造 context 时已注入（[engine/index.ts:232](packages/agent-workflow/src/engine/index.ts:232)）。3 节点判定直接从 `context.recipe.flowGraph.nodes` 统计即可，无需扩展 context 或新增 boundary。

## 状态 / 产物契约

- Free Infer 函数：纯判断逻辑，无副作用
- 逐条总结函数：对每条知识独立调用 LLM，单条失败不中断（UN_SAFE 除外）
- 输出 `knowledge_qa_result: string[]` 和 `llm_completion: string`
- Free Infer 命中后输出为记忆服务回答，无 RAG 检索结果

## 失败与降级

- Free Infer 记忆服务未注入 -> 回退到正常 RAG 流程
- Free Infer 记忆服务调用失败 -> 回退到正常 RAG 流程（不因记忆服务故障阻断工作流）
- 检索为空 -> `knowledge_qa_result = []`、`knowledge_search_result = []`、`llm_completion = ""`，不调用 LLM
- 单条知识总结 LLM 调用失败 -> 该条 summary 设为空字符串，记录 warning，继续下一条
- 内容安全拦截 -> 抛 `UN_SAFE` 异常，节点失败
- 模型路由配置不可用 -> 抛 `WORKFLOW_MODEL_BOUNDARY_UNAVAILABLE`，节点失败
- `tryFreeInfer` boundary 未注入 -> `shouldFreeInfer` 返回 true 也不调用，直接走 RAG

## 与 Change 边界矩阵

- `add-ts-workflow-knowledge-nodes`（已归档）：本 change 替换 knowledge-qa 的 LLM 调用模式，从单次问答改为逐条总结；替换 baseline spec 中 Knowledge QA requirement 的输出 MUST 约束
- `enhance-ts-workflow-llm-nodes`：`${knowledge}` 占位符复用 `interpolateString`，不引入新模板语法；不依赖 `renderTemplate`
- `add-ts-workflow-rag-index-params`（已归档）：检索参数解析和 gateway 调用逻辑不变
- `agent-memory`：提供记忆服务 boundary 实现，通过 `tryFreeInfer` 注入
- `agent-core`：`WorkflowRuntimeEventProjector` 的流式 delta 投影逻辑不变
- `add-ts-workflow-interaction-nodes`（guardrail 节点）：guardrail 独立节点不变，本 change 的 `open_guardrail` 是节点内嵌检测，复用 `evaluateGuardrail` boundary

## 迁移注意

- `knowledge_qa_result` 从 `{answer, sourceDocuments}` 对象变为 `string[]`，已有 recipe 若依赖该对象的 `answer` 或 `sourceDocuments` 字段需调整
- `knowledge_search_result` 从 title/id 改为知识文本内容，下游节点若依赖 title/id 需改用 `recall_result`
- 当前输出的 `answer`、`sourceDocuments`、`documents`、`invocation_trace` 字段不再输出
- `resolveModelInvocationConfig` 签名扩展（增加可选第二参数），现有调用方不受影响
