## 设计决策

### D1 共享 batch 编排框架提取

当前 `executeRestfulBatch`（capability-nodes.ts）包含两个关注点：

1. batch 编排（分块、并发/串行、失败策略、结果汇聚）——通用，与节点类型无关
2. per-element 调用（`capabilityInvocation.invoke` + `api_name` + args）——restful 专属

提取编排层到共享模块 `agent-workflow/src/nodes/batch.ts`：

- `readBatchConfig(context)`：读取 + 校验 `context.node.batchConfig`，返回 `BatchExecutionConfig`。handler 无关，三个节点共用。
- `executeBatch(config, context, processElement, buildOutput)`：泛型编排框架。`processElement` 是 per-element 回调，返回 `{ result: JsonObject }` 或 `{ failed: JsonObject }`。`buildOutput` 是 per-handler 输出投影回调。
- `chunkArray`、`createBatchFailedItem`、`mergeBatchResultsAsMap`：已有 helpers，迁移到共享模块。

`executeBatch` 内部复用现有 `executeRestfulBatch` 的编排逻辑：`chunkArray` 分批 -> parallel 模式按 `parallelism` 并发 `Promise.all` / serial 模式串行 -> `failStrategy` 控制 abort/continue -> `resultMerge` 决定 append/map。cancel 传播通过 `context.signal` 检查。

`executeRestfulBatch` 改为调用 `executeBatch`，传入自己的 `processElement`（调 capability）和 `buildOutput`（投影 `api_response` / `batch_results` / `failed_items` / `invocation_trace`）。**RESTful 既有行为不变。**

设计决策：
- **新建 batch.ts 而非塞入 shared.ts**：batch 编排是独立关注点，代码量约 80 行，放入 shared.ts 会模糊 shared.ts 的"通用 helper"定位。
- **泛型回调而非继承**：TypeScript 不用 class 继承表达 handler 差异，`processElement` 回调更简洁。
- **不提取到 engine 层**：batch 在 handler 内完成，不经过 engine loop/fork-join，保持 handler 自治。

### D2 LLM batch 模式：强制非流式

LLM 节点有 `shouldUseStreamMode`，单次模式下通过 `emitOutputDelta` 发送 stream delta。batch 模式下多个 element 同时流式输出会导致 delta 交错，下游无法区分哪个 element 产生了哪个 delta。

设计决策：**batch 模式强制非流式**。入口检测到 `batchConfig` 后，直接走 `modelInvocation.complete`（非流式），不调用 `shouldUseStreamMode`。

理由：
- 并发流式 delta 交错是本质问题，不是实现 bug。要正确处理需要 per-element stream 隔离 + 合并，复杂度高且收益有限。
- batch 场景的核心价值是并发执行 + 结果汇聚，不是实时输出。用户不需要看到每个子问题的逐字输出。
- 与 restful batch 一致：restful batch 也是"执行完汇聚"，不流式。

modelConfig 处理：`resolveModelInvocationConfig(context.request)` 对同一节点是固定的（request 级配置），所有 element 共享。在 batch 入口解析一次，传入每个 element 的 `processElement`。

per-element 处理流程复用 `executeLlmNode` 单次模式的内部管线，差异仅为：注入 element 变量、强制非流式。具体步骤：
1. 构造 per-element context：`{ ...context, variables: { ...context.variables, [config.elementVariable]: element } }`，从 element context 重新解析 resolvedInputs（与 knowledge-search 一致，保证 prompt_template 渲染和 inputs 解析都能引用 element 变量）
2. 调 `prepareWorkflowLlmPrompt` 生成 per-element prompt
3. 调 `modelInvocation.complete`（非流式）
4. 检查 `modelResult.safeError`，有则返回 failed item
5. 调 `parseWorkflowLlmPayload` 解析结果
6. 返回 `{ result: payload }`。per-element 的 `diagnostic`（prompt compression / budget 诊断）不向外传递，batch 级不产出 `diagnostic`。

**适用范围收窄**：batch 仅支持 `LLM_ROUTER`。其他 LLM 族节点（`LLM`、`INTENT_RECOGNITION`、`QUESTION_REWRITING`、`TRANSLATION`、`DATA_ANALYSIS`、`PARAM_EXTRACT`）共享 `executeLlmNode` handler，但 handler 入口在检测到 `batchConfig` 后 MUST 校验 `context.node.type === "LLM_ROUTER"`，不匹配时抛 `WORKFLOW_BATCH_UNSUPPORTED_NODE_TYPE`。理由：用户诉求仅为 LLM_ROUTER 并发，其他 LLM 族节点的 batch 语义未经验证且无明确场景。

### D3 knowledge-search batch 模式：空结果转为 failed item

单次模式下 `executeKnowledgeSearchNode` 在 `retrieval.recommends.length === 0` 时 throw `WORKFLOW_KNOWLEDGE_SEARCH_EMPTY`。batch 模式下如果某个子问题检索为空，不应中断整个 batch——应转为 failed item，由 `batchFailStrategy` 决定继续还是中止。

per-element 处理流程：
1. 构造 element context：`{ ...context, variables: { ...context.variables, [config.elementVariable]: element } }`
2. 调 `retrieveKnowledge(elementContext, options, "KNOWLEDGE")`
3. 若 `recommends.length === 0`，返回 `{ failed: createBatchFailedItem(element, index, undefined) }`
4. 否则返回 `{ result: knowledgeSearchBindings(retrieval, context) }`

`retrieveKnowledge` 内部调 `resolveKnowledgeInputs(context)` -> `resolveNodeValue(context.node.inputs, context.variables)`。recipe 作者写 `"query": "${sub_question}"`，batch 注入 `sub_question` 变量后，每个 element 的 query 自动解析为对应子问题。**不需要改 `retrieveKnowledge` 本身。**

异常隔离：per-element 处理器内 try/catch 包装，任何异常（检索失败、网络错误等）都转为 failed item，不中断编排框架。与 restful batch 的 per-element 行为一致。

### D4 per-element 变量隔离

每个 element 获得独立变量快照：`baseVariables + { [batchElementVariable]: element }`。不存在跨 element 变量泄漏。

- restful：`{ ...baseArgs, [elementVariable]: element }`（已有行为，baseArgs 是 inputs 去除 api_name）
- llm-router：构造 per-element context，注入 `{ [batchElementVariable]: element }` 到 `context.variables`，从 element context 重新解析 resolvedInputs（与 knowledge 一致，保证 prompt_template 渲染能解析到 element 变量）
- knowledge：`{ ...context.variables, [elementVariable]: element }`（通过 element context 传递）

与 serial loop 的关键差异：serial loop 的迭代共享 `variables` 对象，前一次迭代的输出变量会泄漏到后一次迭代。batch 的 element 之间完全隔离，因为每个 element 只读 baseVariables + element 变量，不写入共享 variables。这保证了 parallel 模式下并发安全。

### D5 输出绑定差异

三个节点在 batch 模式下都产出 `batch_results` 和 `failed_items` 作为核心输出。节点类型专属的"最后一个 element 结果"绑定是可选的：

- restful：`api_response`（最后一个 element 的调用结果，已有）
- llm-router：`llm_result` 和 `llm_completion`（最后一个 element 的解析结果和增强完成对象，与单次模式的 `llm_result` / `llm_completion` 绑定对齐）。`llm_completion` 包含 `{ content, reasoning }` 或纯 content（取决于 `result_with_think` 配置），由最后一个 element 的模型返回决定。
- knowledge：不绑定额外字段（knowledge 单次模式的核心输出 `knowledge_search_result` 已包含在 batch_results 的每个 element 中）

**diagnostic 处理**：单次模式下 LLM_ROUTER 产出 `diagnostic`（prompt compression / budget 诊断）。batch 模式下每个 element 的 prompt 准备各自产生 diagnostic，不汇聚到 batch 级——batch 模式不产出 `diagnostic`。理由：per-element diagnostic 汇聚语义不明确（多个 compression reasonCode 无法合并），且 diagnostic 是实现层诊断而非业务输出。单次模式的 `diagnostic` 行为不变。

`batch_results` 和 `failed_items` 的 shape 在三个节点间一致：
- `batch_results`：append 模式为 `JsonObject[]`，map 模式为 `Record<string, JsonObject>`
- `failed_items`：`Array<{ index, item, error: { code, message } }>`

recipe 作者通过 `node.outputs` 映射决定使用哪些输出变量名，handler 通过 `projectNodeOutputs` 投影。

### D6 LoopBatchMutex 适用范围更新

原 `LoopBatchMutex` requirement 描述 batchConfig 为"仅 restful(api-invoke) 节点支持的批量 API 调用配置"。扩展后 batchConfig 适用 `RESTFUL` + `KNOWLEDGE_SEARCH` + `LLM_ROUTER`，互斥约束的描述需更新。

互斥逻辑不变：同一节点 MUST NOT 同时声明 `loopConfig` 和 `batchConfig`。loader 的检测逻辑（`normalizeNodeDefinition`）与节点类型无关，不需要改动。

### D7 适用节点范围：仅 LLM_ROUTER

`executeLlmNode` 是 `LLM`、`LLM_ROUTER`、`INTENT_RECOGNITION`、`QUESTION_REWRITING`、`TRANSLATION`、`DATA_ANALYSIS`、`PARAM_EXTRACT` 的共享 handler。batch 分支加在 `executeLlmNode` 入口，但通过类型门控将 batch 能力收窄为仅 `LLM_ROUTER`。

handler 入口检测到 `batchConfig` 后，校验 `context.node.type === "LLM_ROUTER"`：匹配则进入 `executeLlmBatch`；不匹配则抛 `WORKFLOW_BATCH_UNSUPPORTED_NODE_TYPE`。理由：用户诉求仅为 LLM_ROUTER 并发（模型反思后拆分子问题，每个子问题走 llm-router 路由），其他 LLM 族节点的 batch 语义未经验证且无明确场景。

### D8 loader 门控扩展（必须修改）

当前 `normalizeNodeDefinition`（`workflow-recipe-loader.ts` 第 397 行）将 `batchConfig` 归一化门控在 `normalizedType === "RESTFUL"`：

```typescript
const batchConfig = normalizedType === "RESTFUL"
    ? normalizeBatchConfig(node.batchConfig ?? node.batch_config)
    : undefined;
```

这意味着 KNOWLEDGE_SEARCH 和 LLM_ROUTER 即使声明了 `batchConfig`，loader 也会静默丢弃。**这是本 change 必须修改的代码路径。**

修改方式：移除节点类型门控，让所有节点类型的 `batchConfig` 都经过 `normalizeBatchConfig`：

```typescript
const batchConfig = normalizeBatchConfig(node.batchConfig ?? node.batch_config);
```

`normalizeBatchConfig` 函数本身不需要改动——它只做 snake_case 到 camelCase 的归一化和字段校验，与节点类型无关。互斥校验（`loopConfig` 与 `batchConfig` 同时声明时拒绝）也不需要改动——它在 `batchConfig` 归一化之后执行，与节点类型无关。

这个修改是"同形同策"原则的直接体现：`batchConfig` schema 已经在 `WorkflowNodeDef` 上对所有节点类型可用，loader 的归一化也应该对所有节点类型一致。

## 质量属性审视

- **安全**：batch 产物（batch_results / failed_items / api_response / llm_result / llm_completion / invocation_trace）MUST NOT 包含 secret 明文。per-element 调用边界（capabilityInvocation / retrieveKnowledge / modelInvocation）已有各自的 safe error / redaction 约束，batch 编排框架不引入新的 secret 暴露面。failed_items 的 error 字段只携带 safe error summary（code + message），不携带 raw exception。验证：task 4.4/4.5 断言 failed_items 不含 secret。
- **性能 / 容量**：batchParallelism 上限 20，防止并发模型调用打爆 provider 配额。batchSize 默认 10 控制单批参数量。batch 模式强制非流式，避免并发 stream delta 合并开销。LLM_ROUTER batch 模式下 modelConfig 只解析一次，避免 per-element 重复解析。验证：task 4.4 断言 batchParallelism clamp 到 20。
- **可靠性 / 恢复**：batchFailStrategy 提供 continue/abort 两级降级，单个 element 失败不必然中断整个 batch。cancel/timeout 通过 context.signal 检查中断，MUST NOT 静默悬挂。最后元素未执行或失败时，节点类型专属绑定为 undefined 静默跳过，不报错。验证：task 4.4/4.5 断言 continue/abort 两条路径。
- **可维护性**：共享 batch 编排框架（batch.ts）消除了三个 handler 间的编排逻辑重复。泛型回调（processElement / buildOutput）使新增节点类型接入 batch 时只需实现回调，不修改编排框架。与"同形同策"原则一致。验证：task 4.6 lint:architecture 断言无 private import。
- **可测试性**：batch 编排逻辑通过共享框架单点实现，测试可针对框架验证编排行为（分批/并发/失败策略/汇聚），针对各 handler 验证 per-element 调用边界差异。验证：task 4.7 contract test 断言三节点 batch_results / failed_items shape 一致。
- **审计 / 可追溯**：每个批次 side effect MUST 与 executionId / nodeId / 批次序号可追溯。invocation_trace 承载调用诊断（KNOWLEDGE_SEARCH 不产出，因其调用边界不产出 trace）。验证：task 4.4 断言 invocation_trace 存在。

### D9 batchInputDataItem schema 类型修正（必须修改）

**问题根因**：`WorkflowBatchConfigSchema.batchInputDataItem` 当前类型为 `WorkflowOpaqueArraySchema`（即 `Type.Array(Type.Unknown())`）。recipe YAML 中写 `batchInputDataItem: ` 时，YAML 解析为字符串 `""`，Ajv 的 `Type.Array()` 校验对字符串必然失败。`loadRecipeDefinition` 校验失败后记 `WORKFLOW_RECIPE_INVALID` warn 并返回 `undefined`，recipe 被静默跳过，下游报 `RECIPE_NOT_FOUND`。

**与 loopConfig 的对比**：`loopInputDataItem` schema 类型为 `Type.String({ minLength: 1, maxLength: 1024 })`，YAML 模板字符串 `` 解析为字符串后校验通过。运行时 engine 代码调 `resolveNodeValue(loopConfig.loopInputDataItem, variables)` 解析为实际数组。`batchInputDataItem` 运行时路径完全同构——`readBatchConfig` 调 `resolveNodeValue(rawBatchConfig, context.variables)`，`resolveNodeValue` 对字符串调 `interpolateString`，`interpolateString` 对 `\\\` 整串匹配走 `resolveVariablePath` 返回原始值（可能是数组）。两者运行时行为一致，但 schema 类型不一致——loop 接受字符串占位符，batch 不接受。这是框架侧的设计不一致。

**修正方式**：将 `batchInputDataItem` schema 改为 `Type.Optional(Type.Union([WorkflowOpaqueArraySchema, Type.String({ minLength: 1, maxLength: 1024 })]))`。

设计决策：
- **Union 而非纯 String**：同时保留内联数组写法（`batchInputDataItem: [{ne_id: "NE-1"}, ...]`）和模板字符串写法（`batchInputDataItem: `）。纯 String 会 break 内联数组写法。
- **与 loopInputDataItem 同形同策**：`loopInputDataItem` 已是 `Type.String()` + 运行时 `resolveNodeValue` 的模式。`batchInputDataItem` 的 Union(Array, String) 是该模式的超集——内联数组在加载阶段就是数组，模板字符串在运行时才解析为数组，两条路径都经 `resolveNodeValue` 统一处理。
- **不改 normalizeBatchConfig**：`normalizeBatchConfig` 只做 snake_case 到 camelCase 字段名映射，原样传递值。字符串和数组都是合法的 JSON 值，不需要在归一化阶段做类型判断。
- **不改 readBatchConfig**：`readBatchConfig` 调 `resolveNodeValue` 解析后检查 `Array.isArray(items)`。字符串模板经 `resolveNodeValue` 解析为实际值后，`Array.isArray` 检查照常生效。非数组值（解析后仍不是数组）照常报 `WORKFLOW_BATCH_INPUT_INVALID`。
- **TypeScript Static 类型**：Union 后 `batchInputDataItem` 的静态类型变为 `readonly JsonValue[] | string`。`readBatchConfig` 中 `resolveNodeValue` 返回 `unknown`，`Array.isArray` 已经做了类型收窄，不需要额外类型守卫。

### D10 recipe 校验失败诊断改善

**问题**：`loadRecipeDefinition` 在 `recipeValidator(parsed)` 返回 `false` 时，只记 `safeReasonCode: 'WORKFLOW_RECIPE_INVALID'` 和 `recipeRef`，不携带 Ajv 校验错误详情。用户看到 `RECIPE_NOT_FOUND` 但无法知道校验失败的具体字段和原因，排查困难。

**修正方式**：在 `WORKFLOW_RECIPE_INVALID` warn 中增加 `validationErrors` 字段，投影 `recipeValidator.errors` 的摘要——每条错误只保留 `instancePath`（字段路径）和 `keyword`（校验关键词），不保留 `data` 或 `message`（可能包含 recipe 内容）。`validationErrors` 受日志大小约束，最多投影前 10 条。

设计决策：
- **只投影 instancePath + keyword**：`instancePath` 是 JSON 指针路径（如 `/nodes/0/batchConfig/batchInputDataItem`），`keyword` 是 Ajv 校验关键词（如 `type`）。两者不含业务内容，安全。`data` 字段可能包含 recipe 原始值，不投影。
- **不进入 Web/SSE/timeline**：`validationErrors` 是 loader 内部 diagnostic，只在 structured logging 中出现。不进入 `ObservabilityObservationEvent`、SafeError、audit 或 Web response。
- **与 AGENTS.md 日志约束一致**：`validationErrors` 不含 prompt、模型输出、stream delta、raw provider error、路径、credential、token、附件内容或高基数字段。`instancePath` 是 recipe schema 内部路径，不是文件系统路径。

## 架构影响

- `agent-workflow/src/nodes/batch.ts`（新建）：共享 batch 编排框架
- `agent-workflow/src/nodes/capability-nodes.ts`：`executeRestfulBatch` 改为委托 `executeBatch`，删除内联编排逻辑
- `agent-workflow/src/nodes/llm-nodes.ts`：入口加 batch 分支（仅 LLM_ROUTER）+ `executeLlmBatch`
- `agent-workflow/src/nodes/knowledge-nodes.ts`：入口加 batch 分支 + `executeKnowledgeSearchBatch`
- `agent-workflow/src/workflow-recipe-loader.ts`：`normalizeNodeDefinition` 移除 `normalizedType === "RESTFUL"` 门控
- `agent-contracts/core`：修正 `WorkflowBatchConfigSchema.batchInputDataItem` schema 类型为 `Union(Array, String)`（见 D9）
- 跨 package 边界不变

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-9.1-执行工作流` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/workflow-contracts/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。

## 归档阻塞记录（2026-07-31）

- **状态：**保持 active，禁止使用 `--skip-specs`。
- **原因：**stable `workflow-contracts` 中找不到 `RestfulBatchConfig` Requirement。
- **解除条件：**逐 Requirement 建立 delta、stable target、Function 与长期设计的双端映射；确认正文、元数据、Scenario 和任何 REMOVED→ADDED/MODIFIED 迁移均完整同步后，再重新执行 archive。
