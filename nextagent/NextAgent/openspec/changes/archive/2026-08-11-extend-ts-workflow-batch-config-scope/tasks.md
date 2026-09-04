## 1. 共享 batch 编排框架提取与 loader 门控扩展

- [x] 1.1 新建 `agent-workflow/src/nodes/batch.ts`，将 `readBatchConfig`、`RestfulBatchConfig`（重命名为 `BatchExecutionConfig`）、`executeBatch`、`chunkArray`、`createBatchFailedItem`、`mergeBatchResultsAsMap` 从 capability-nodes.ts 提取到共享模块
  - `executeBatch` 接受泛型 `processElement` 回调和 `buildOutput` 回调
  - 编排逻辑（分块、并发/串行、失败策略、结果汇聚）与现有 `executeRestfulBatch` 一致
  验证：`npm run build`（tsc 编译通过）
  来源：design D1

- [x] 1.2 `capability-nodes.ts` 的 `executeRestfulBatch` 改为委托 `executeBatch`，传入 restful 专属 `processElement`（调 `capabilityInvocation.invoke`）和 `buildOutput`（投影 `api_response`/`batch_results`/`failed_items`/`invocation_trace`）
  - 删除 capability-nodes.ts 中内联的编排逻辑（chunkArray 调用、parallel/serial 分支、failStrategy 处理、resultMerge 合并）
  - RESTful 既有行为不变
  验证：`npm test`（restful batch 既有测试全部通过）
  来源：design D1

- [x] 1.3 `workflow-recipe-loader.ts` 的 `normalizeNodeDefinition` 移除 `normalizedType === "RESTFUL"` 门控，让 `batchConfig` 归一化适用于所有节点类型
  - 当前第 397 行 `const batchConfig = normalizedType === "RESTFUL" ? normalizeBatchConfig(...) : undefined` 会静默丢弃非 RESTFUL 节点的 batchConfig
  - 改为 `const batchConfig = normalizeBatchConfig(node.batchConfig ?? node.batch_config)`，不门控节点类型
  - `normalizeBatchConfig` 函数本身不改，互斥校验不改
  验证：`npm test`（loader 测试通过；新增 KNOWLEDGE_SEARCH/LLM_ROUTER 节点 batchConfig 归一化测试）
  来源：design D8, spec requirement `RestfulBatchConfig` BatchConfig Normalized For All Node Types scenario

## 2. LLM_ROUTER batch 接入

- [x] 2.1 `llm-nodes.ts` 的 `executeLlmNode` 入口加 batch 分支：检测 `batchConfig`，存在时调用 `executeLlmBatch`
  - `executeLlmBatch` 使用共享 `executeBatch`，传入 LLM 专属 `processElement`
  - modelConfig 在 batch 入口解析一次，所有 element 共享
  - batch 模式强制非流式：`modelInvocation.complete`，MUST NOT 调用 `shouldUseStreamMode`
  - 仅 `LLM_ROUTER` 支持 batch；其他 LLM 族节点声明 `batchConfig` 时 MUST 报 `WORKFLOW_BATCH_UNSUPPORTED_NODE_TYPE`
  - per-element：构造 element context（注入 `batchElementVariable` 到 `context.variables`）-> 重新解析 resolvedInputs -> `prepareWorkflowLlmPrompt` -> `modelInvocation.complete` -> `parseWorkflowLlmPayload`
  - 输出：`batch_results`、`failed_items`、`llm_result`（最后元素结果）、`llm_completion`（最后元素结果）、`invocation_trace`
  验证：`npm run build`
  来源：design D2, spec requirement `RestfulBatchConfig` LLM_ROUTER 场景

## 3. knowledge-search 节点 batch 接入

- [x] 3.1 `knowledge-nodes.ts` 的 `executeKnowledgeSearchNode` 入口加 batch 分支：检测 `batchConfig`，存在时调用 `executeKnowledgeSearchBatch`
  - `executeKnowledgeSearchBatch` 使用共享 `executeBatch`，传入 knowledge 专属 `processElement`
  - per-element：构造 element context（注入 `batchElementVariable` 到 variables）-> `retrieveKnowledge` -> `knowledgeSearchBindings`
  - 空检索结果转为 failed item，MUST NOT throw `WORKFLOW_KNOWLEDGE_SEARCH_EMPTY`
  - per-element try/catch 异常隔离，任何异常转为 failed item
  - 输出：`batch_results`、`failed_items`
  验证：`npm run build`
  来源：design D3, spec requirement `RestfulBatchConfig` KNOWLEDGE_SEARCH 场景

## 4. 验证

- [x] 4.1 `openspec validate --all --strict`
  验证：OpenSpec 校验通过
  来源：所有 tasks

- [x] 4.2 `npm run build`
  验证：TypeScript 编译通过
  来源：所有 tasks

- [x] 4.3 `npm test`（restful batch 回归）
  验证：restful batch 既有测试全部通过，无行为回归
  来源：task 1.2

- [x] 4.4 `npm test`（loader 门控扩展测试）
  - KNOWLEDGE_SEARCH 节点声明 batchConfig，loader 归一化后 batchConfig 不为 undefined
  - LLM_ROUTER 节点声明 batchConfig，loader 归一化后 batchConfig 不为 undefined
  - 既有 RESTFUL batchConfig 归一化测试不受影响
  - 既有 loopConfig/batchConfig 互斥测试不受影响
  验证：全部测试通过
  来源：task 1.3, spec requirement `RestfulBatchConfig` BatchConfig Normalized For All Node Types scenario

- [x] 4.5 `npm test`（llm-router batch 新增 characterization test）
  - 基础并发：batchMode=parallel，3 个 element，全部成功，batch_results 含 3 个结果
  - 强制非流式：batch 模式不调用 emitOutputDelta
  - 失败策略 continue：第 2 个 element 失败，继续执行第 3 个，节点 NODE_COMPLETED
  - 失败策略 abort：第 2 个 element 失败，不执行第 3 个，节点 NODE_FAILED
  - 结果汇聚 map：batchResultMerge=map，batch_results 为 Map
  - 变量隔离：每个 element 只看到自己的 batchElementVariable 值
  - llm_result 和 llm_completion 绑定最后元素结果
  - batch 模式不产出 diagnostic（单次模式的 diagnostic 行为不变）
  - cancel 传播：context.signal abort 后 batch 中断，不悬挂
  - 非 LLM_ROUTER 的 LLM 族节点声明 batchConfig 时报 `WORKFLOW_BATCH_UNSUPPORTED_NODE_TYPE`
  验证：全部测试通过
  来源：task 2.1, spec requirement `RestfulBatchConfig`

- [x] 4.6 `npm test`（knowledge-search batch 新增 characterization test）
  - 基础并发：batchMode=parallel，3 个 element，全部成功
  - 空结果转 failed item：某个 element 检索为空，不 throw，记录为 failed_item
  - 失败策略 continue：空结果 element 不中断其余 element
  - 结果汇聚 map：batchResultMerge=map
  - 变量隔离：每个 element 的 query 通过 batchElementVariable 注入解析
  - cancel 传播：context.signal abort 后 batch 中断，不悬挂
  验证：全部测试通过
  来源：task 3.1, spec requirement `RestfulBatchConfig`

- [x] 4.7 `npm run lint:architecture`
  验证：共享 batch 模块不破坏架构边界，无 private path import
  来源：design D1

- [x] 4.8 Contract test：batch 模式下三个节点类型的 batch_results 和 failed_items shape 一致
  验证：`npm run test:contract`
  来源：design D5

- [x] 4.9 `$nextagent-code-review` push 前模型语义检视
  验证：检视结论 PASS / PASS WITH FOLLOW-UP
  来源：AGENTS.md push 门禁

## 5. batchInputDataItem schema 类型修正与诊断改善

- [x] 5.1 修正 `WorkflowBatchConfigSchema.batchInputDataItem` schema 类型：从 `Type.Optional(WorkflowOpaqueArraySchema)` 改为 `Type.Optional(Type.Union([WorkflowOpaqueArraySchema, Type.String({ minLength: 1, maxLength: 1024 })]))`
  - 与 `loopInputDataItem` 同形同策：`loopInputDataItem` 已是 `Type.String()`，运行时经 `resolveNodeValue` 解析为数组
  - `normalizeBatchConfig` 不改（只做字段名映射，原样传递值）
  - `readBatchConfig` 不改（`resolveNodeValue` 已同时处理字符串和数组，`Array.isArray` 检查照常生效）
  验证：`npm run build`（tsc 编译通过）
  来源：design D9

- [x] 5.2 `loadRecipeDefinition` 校验失败 warn 携带 `validationErrors` 摘要
  - 投影 `recipeValidator.errors` 每条只含 `instancePath` 和 `keyword`，不保留 `data` 或 `message`
  - 最多投影前 10 条
  - 不进入 Web/SSE/timeline/SafeError，只在 structured logging 中出现
  验证：`npm test`（loader 校验失败测试断言 `validationErrors` 存在且不含 `data`）
  来源：design D10

- [x] 5.3 Characterization test：模板字符串 `batchInputDataItem` 走完整 loader -> validator -> handler 路径
  - 用 YAML recipe 文件（而非直接构造 `WorkflowNodeDef`）走 `loadRecipeDefinition` -> `recipeValidator` 路径
  - `batchInputDataItem: ` 模板字符串通过加载校验，recipe 不被跳过
  - 运行时 `resolveNodeValue` 解析为实际数组，`readBatchConfig` 正常进入 batch 分支
  - 内联数组写法回归通过
  验证：`npm test`
  来源：design D9, spec requirement `RestfulBatchConfig` BatchInputDataItem As Template String scenario

- [x] 5.4 `openspec validate --all --strict`
  验证：OpenSpec 校验通过
  来源：所有 tasks

- [x] 5.5 `-code-review` push 前模型语义检视
  验证：检视结论 PASS / PASS WITH FOLLOW-UP
  来源：AGENTS.md push 门禁
