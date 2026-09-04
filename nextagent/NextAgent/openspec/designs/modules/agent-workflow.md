# agent-workflow

## 职责

承载 workflow 执行能力组：物理 workspace 包、`WorkflowExecutionService` 工厂与最小实现、recipe 定义消费、节点 handler 注册（gateway / parallel-gateway / capability / interaction / knowledge / llm 六类）、以及节点执行所需的共享 helper。workflow 是 agent-core routing 的一个执行分支，不是独立 runtime。

## 非职责

不拥有 request lifecycle、scheduler、cancel、checkpoint、terminal commit——这些仍归 `agent-runtime`。不拥有 pending input store——workflow 节点产生 pending input 时通过 runtime-owned `AgentRunStatePort.requestPendingInput` 委托，producerRef 标记为 `WORKFLOW_NODE`。不拥有 recipe durable store、workflow event 持久化表、远程 recipe source 或 hot reload。不拥有 provider SDK、gateway adapter、Web channel 或 app composition。不直接写 session message、checkpoint、capability audit。

## 依赖

允许依赖 `@nextagent/agent-common`、`@nextagent/agent-contracts/core`、`@nextagent/agent-contracts/runtime`、`@nextagent/agent-contracts/model`、`@nextagent/agent-contracts/capability`、`@nextagent/agent-contracts/context`、`@nextagent/agent-contracts/agent-assembly`、`@nextagent/agent-contracts/observability` public subpaths。运行期通过注入的 `ModelInvocationService`、`CapabilityInvocationPort`、context assembly、knowledge gateway、sandbox gateway、secret gateway 等边界协作，不直接导入 provider SDK 或 gateway adapter 实现包。被 `agent-core` 消费（`DefaultAgent.executeRecipeRoute` 注入 `WorkflowExecutionService`），被 `agent-app` composition 装配。

## 核心设计落点

- Workflow Capability nodes 只消费统一调用边界的最终结果。Recipe/node retry 次数下沉为当前逻辑调用的 `maxRetries` 后不得对最终失败执行第二层 retry；取消中断，其余失败进入显式 `exception`，无匹配分支则 Workflow 失败。
- `NODE_WAITING` 的合法 pending control 投影为 `SUCCEEDED + WORKFLOW_NODE_WAITING`；无 pending context 时失败。`DATA_ANALYSIS` Python、RESTFUL single/poll/batch、PYTHON、AGENT 和 Workflow Tool 入口遵守同一结果处置。
- RESTFUL 节点第四种执行模式为 SSE 流式：inputs 的 `stream_type: "sse"` 通过 capability 层 CLIP `subscribe` 原语发起流式调用，`executeRestfulSSE()` 逐帧接收事件，中间事件以 `NODE_OUTPUT_DELTA` 上报（投影 `TOOL_STRUCTURED_DELTA` LIVE_ONLY），完成后 CLIP 层聚合为 `{ events, completion }` 完整结果作为 `api_response` 输出变量传递下游；聚合结果经 `CAPABILITY_RESULT_DELTA`（LIVE_ONLY）实时投递并经 `TOOL_STRUCTURED_DELTA`（PERSISTED，`NODE_COMPLETED` 携带完整输出）持久化，`CAPABILITY_COMPLETED` 保持 body-free。`stream_type` 与 `batchInputDataItem`、`is_long_api` 互斥，未设置或为空时保持既有行为。契约见 `workflow-restful-sse` spec。
- `batchConfig` 是 `WorkflowNodeDef` 顶层可选字段，适用 `RESTFUL`、`KNOWLEDGE_SEARCH` 和 `LLM_ROUTER` 三类节点（其他 LLM 族节点声明时报 `WORKFLOW_BATCH_UNSUPPORTED_NODE_TYPE`）。loader 的 `normalizeNodeDefinition` 对所有节点类型统一归一化 `batchConfig`，不门控 `normalizedType === "RESTFUL"`；`loopConfig` 与 `batchConfig` 在同一节点互斥，同时声明时 loader 拒绝（`WORKFLOW_BATCH_LOOP_CONFLICT`）。共享 batch 编排框架提取到 `agent-workflow/src/nodes/batch.ts`：`readBatchConfig` 读取校验配置、`executeBatch(config, context, processElement, buildOutput)` 提供泛型编排（`chunkArray` 分批、parallel 按 `batchParallelism` 限流 `Promise.all` / serial 串行、`failStrategy` 控制 abort/continue、`resultMerge` 决定 append/map），cancel 通过 `context.signal` 检查。三个 handler 各自实现 `processElement` 回调接入：`RESTFUL` 调 `capabilityInvocation.invoke`（baseArgs 为 inputs 去除 `api_name`，batch 优先于 `is_long_api`，产出 `api_response`）；`LLM_ROUTER` 复用 `executeLlmNode` 单次模式内部管线但强制非流式（`modelInvocation.complete`，不调 `shouldUseStreamMode`），modelConfig 在 batch 入口解析一次共享，产出 `llm_result`/`llm_completion`，不汇聚 per-element diagnostic；`KNOWLEDGE_SEARCH` 调 `retrieveKnowledge`，空检索结果转为 failed item（不 throw `WORKFLOW_KNOWLEDGE_SEARCH_EMPTY`），不产出 `invocation_trace`。三节点 per-element 都通过 element context 注入 `{ [batchElementVariable]: element }` 到 `context.variables` 并重新解析 inputs，element 间变量完全隔离。共享产物 `batch_results`（append 为 List 按 index / map 为 Map 按 key）、`failed_items`（index/item/safe error summary），secret 不得进入任何产物；节点类型专属"最后元素结果"绑定按下标 `results[items.length - 1]`，未执行或失败时为 undefined 静默跳过。`batchFailStrategy: "continue"` 失败时记录 failed_items 并继续、节点 `NODE_COMPLETED`；`"abort"` 失败时记录 failed_items 并停止后续批次、节点 `NODE_FAILED`；cancel/timeout 中断但已完成元素结果保留。`batchParallelism` 超过 20 时 clamp 到 20 不报错。batch 仅在 handler 内生效，不经过 engine loop/fork-join。batch 契约字段、loader 归一化和互斥校验的权威定义在 `workflow-contracts` 的 `NodeBatchConfig` 和 `LoopBatchMutex` requirement。

- 落实 `architecture/core-contracts.md` 的 workflow 最小契约集：`RecipeDefinition` / `FlowGraph` / `WorkflowNodeDef` / `WorkflowBranchDef` DSL，`WorkflowExecutionService.execute()` port，`WorkflowExecutionRequest` / `WorkflowExecutionResult` / `WorkflowNodeResult` / `WorkflowExecutionEvent` DTO，可选 `WorkflowExecutionObserver`。`inputs` / `outputs` / `outputParser` 保持 opaque `JsonObject`，节点私有 schema 由各节点 change 拥有，不冻结进 core contract。
- `WorkflowNodeType` 归 `agent-common` 作为节点分类 vocabulary，不绑定节点私有 schema 或执行策略。
- 共享输出投影把 `outputs.output_parser` 视为控制配置而非业务变量；节点结果和 workflow event 不得携带该 key。单值输出以值投影，多值输出以受控换行组合，展示 parser 的优先级由 workflow runtime projector 统一消费。
- `createWorkflowExecutionService()` 工厂产出单实例、内存态 `WorkflowExecutionService`。首版支持顺序节点推进、条件分支、单进程并发 parallel fork/join（`Promise.allSettled` + `AbortController`）、节点级 timeout/retry、interrupt/cancel；不支持 distributed scheduling、snapshot/resume/recovery、rollback/degrade/saga、durable history。engine 消费 v2 `RecipeDefinition.runtime`：`runtime.timeout` 作为流程级超时（`runtime` 未定义时回退 v1 `recipe.timeoutMs`），`runtime.defaultRetry` 作为节点重试默认，`runtime.controlPolicy` 决定 cancel/STOP/ROLLBACK_* 策略；节点重试按 `retry` -> `retryPolicy` -> `defaultRetry` -> `{maxRetries:0}` 优先级链解析，节点超时按 `timeout` -> `timeoutMs` 优先级链解析；节点执行前校验 `dependsOn` 已完成，未完成抛 `WORKFLOW_DEPENDENCY_NOT_SATISFIED`；节点级异常转移统一走 `exception` 分支，不消费已废弃的 `onError`。
- engine 只消费 gateway handler 产出的控制语义（条件分支结果、单进程并发与终止聚合），不拥有 gateway 节点定义。节点 handler 以 `{type}-{name}` 标准命名注册到 node catalog；legacy 名（如 `guardrail_check`）在边界兼容解析为标准名（`guardrail-check`）。
- engine 引入 workflow 事件（`WorkflowExecutionEvent`）仅用于 lifecycle 观测与安全可见 delta，禁止包含 prompt、raw model output、raw capability result、secret、path。节点流式中间态通过可选 observer 上浮，由 `agent-core` 投影到 runtime timeline，与 model loop UX 一致。
- LLM node 不自行解析 model profile 或 provider binding；它使用统一模型选择结果和 `ModelInvocationService`，并在模型变化时通过 Context Engine 重新装配所需输入。
- recipe 加载在启动期扫描工作区 `agents/{agentId}/recipes/`，按 frozen schema 解析索引并由 `agent-app` 作为 WORKFLOW capability 暴露；完整 DSL 在执行期通过 recipe definition source 懒加载并缓存。非法 recipe 诊断后跳过，不阻断启动；路径必须工作区相对。
- workflow pending-input 桥接：`INTERRUPT` 节点与 `user-check` 节点经 runtime `requestPendingInput` 暂停；resume 事实经 `context.flowVariables` 往返（execution state + pending resume）。`agent-runtime` 在 resume 路径识别 `WORKFLOW_NODE` producerRef 并注入 `workflowPendingResume`，resume 子请求携带 `routingConstraints.targetRecipe` 回到同一 recipe。pending input 超时 resume 时 runtime 不设 `answers` 字段，engine handler 识别 `resumeState.answers === undefined` 为超时恢复：`executeUserCheckNode` 已有 `throwUserCheckTimeout`（抛 `WORKFLOW_NODE_TIMEOUT`，category: TIMEOUT）；`executeInterruptNode` 在 `readWorkflowPendingAnswer` 返回 `undefined` 后、`requestPendingInput` 前防御性抛 `WORKFLOW_NODE_TIMEOUT`，防止 fall through 创建新 pending input 导致死循环；`executeRestfulNode` reflection 路径在 `readReflectionAnswer` 返回 `undefined` 后、`extractRestfulParameters` 前防御性抛 `WORKFLOW_NODE_TIMEOUT`，防止重复调用模型创建新 reflection pending input。两个防御性 throw 走 engine exception 路由（`mapSafeErrorToVariables` → `resolveErrorTransition`），无 exception 匹配则终态化 `FAILED`（`WORKFLOW_NODE_TIMEOUT`）。
- `sub-recipe` 节点在子流程执行完成后从 `WorkflowExecutionResult.nodeResults`（`WorkflowNodeResult.nodeId/nodeType/output`）与 `RecipeDefinition.flowGraph.nodes[nodeId].description` 构建步骤记录列表，写入流程上下文变量 `node_record_info`，供后续节点通过 `${node_record_info}` 引用。每条记录包含 `name`、`type`、`description`、`inputs`、`outputs` 和（仅 RESTFUL 节点）`outputDefine`。字段分类由 `buildNodeRecordInfo` 辅助函数按固定字段名完成：`api_name`、`prompt_template` 归入 `inputs`；`api_response`、`llm_completion`、`api_resp_define`、`user_check_result` 及其他非输入类字段归入 `outputs`；RESTFUL 节点的 `api_resp_define` 进一步提取为 `outputDefine` 并从 `outputs` 移除。`recipe_result` 默认不归入 `outputs`，仅在节点输入参数 `is_node_record_with_recipe_result` 为 `true` 或系统部署环境 `scene` 为 `MAE-CN` 时包含；`scene` 通过 `CreateWorkflowNodeCatalogOptions.scene?: string` 由 `agent-app` 从 `process.env.SCENE` 读取并注入，属配置加载。子流程失败时 `executeSubRecipeNode` 已在构建前抛出异常，不产出 `node_record_info`；`nodeResult.output` 为 `undefined` 时该节点记录的 `inputs`/`outputs` 为空对象。DryRun 模式、parentIdNodeName 关联和 lawyers 链表嵌套追踪不在范围内。
- `sub-recipe` 节点把父节点 `outputs` 中 `${recipe_result}` 绑定到子 recipe answer node 的 `nodeResult.output`（map 结构），`sub_recipe_result` 绑定到子执行 summary（`recipe_name`、`executionId`、`status`）。answer node 由 `resolveSubRecipeAnswerNodeId` 解析：从 `END` 沿单前驱链反向遍历、跳过 gateway 节点（START/END/CONDITION/PARALLEL）、取第一个非 gateway 节点，仅依赖子 recipe `flowGraph` 结构，不依赖执行时序。该算法与 `agent-core/agent/workflow-runtime-event-projector.ts` 的 `resolveAnswerNodeId`（父 recipe answer，决定 ANSWER 级高亮）同一套 END 反向解析，使同一 recipe 不论作父还是作子 answer 节点解析结果一致；因 `agent-core` 不允许依赖 `agent-workflow` 且 `agent-contracts` 不承载纯导航函数，当前维持两份等价副本，各自注释互相指认。边界：子 recipe 无 END、END 无前驱、END 前驱为多前驱 gateway（fork-join 直接接 END）或 answer node output 为 `undefined` 时，`${recipe_result}` 为空对象 `{}`，不回退为完整 `outputVariables`。中间节点输出经父节点 `outputMapping` 从子 recipe `outputVariables` 显式映射，不进入默认 `${recipe_result}`。
- `sub-recipe` 节点支持 `recipe_name` 变量模板（如 `${input_question}`）；模板解析失败时 handler 抛出 `WORKFLOW_NODE_INPUT_INVALID`（category `VALIDATION`），`safeDetails` 携带 `recipeNameTemplate`、`resolvedType`、`availableVariableKeys`，不静默失败或使用空字符串。
- `sub-recipe` 节点把子 recipe 执行期间产生的 `WorkflowExecutionEvent`（NODE_STARTED / NODE_OUTPUT_DELTA / NODE_COMPLETED 等）转发给父 execution observer，事件携带子 execution 的 `executionId` 和 `nodeId`，observer 按 `executionId` 查找对应 recipe 定义用于轨迹还原。
- `delay-gateway` 节点 `inputs.delay_time` 为字符串形式秒数（与 1.0 DSL “参数值只支持字符串”一致），handler 将字符串转为数字并乘以 1000 转换为毫秒后启动计时器；非正整数或负数抛 `invalidNodeInput`，`AbortSignal` 立即中断。
- 节点共享 helper 统一提取到 `agent-workflow/src/nodes/shared.ts`：`resolveNodeModelConfig` 封装“读 model/modelGroup → 尝试 `resolveModelForParamExtract` override → fallback 到 `resolveModelInvocationConfig`/`requireWorkflowModelConfig`”三步，由 `api-choice` 和 `restful` 参数提取同形复用；`api-choice` 的 `model_params` 合并在调用后由调用方追加，不进入 shared 函数。`asNonNegativeInteger` 同样提取到 `shared.ts`（使用 coerceNumber 版本），capability-nodes 与 engine 不再各持一份。`resolveModelForParamExtract` adapter 当前忽略 `modelGroup`（`selectModelProfile` 签名不接受路由组），modelGroup 为 deferred：有值但 model 为空时 fallback 到全局配置且不报错；modelGroup 的路由组语义需在 canonical `model-invocation-contract` 与 Context Engine 模型选择边界上通过独立 change 定义。

## 替代边界

是。workflow 执行是 agent-core routing 的一个分支，不是唯一执行路径；未命中 `targetRecipe` 时稳定降级到 conversation loop。workflow 不替代 model tool loop，二者通过 routing policy 与 `AgentExecutionOutcome` 协作。

## 验证关注点

- workflow 不得绕过 `AgentRunStatePort` 直接写 terminal / checkpoint / pending input store。
- 节点输出必须经安全 sanitize，不得把 raw prompt / raw model output / provider raw error 写入 trace / output / snapshot。
- dynamic execution（python 节点）必须经 sandbox gateway boundary，不得使用宿主进程权限。Python 节点优先通过 `agent-capability` 暴露的 `WorkflowSandboxExecutionPort.runPython` 直接执行预定义脚本，不经 `python` capability 路径、不触发 nl2py guardrail；该 port 由 `agent-app` composition 注入到 `createWorkflowNodeCatalog`。port 未注入时 fallback 到 `capabilityInvocation` 路径，此时变量声明作为 `preamble` 字段传递、`code` 字段只包含用户 `script`，nl2py guardrail 只检查 `code` 不检查 `preamble`。
- secret 引用只能在 capability/gateway 边界解析，不得进入节点 output / log / snapshot。
- parallel-gateway 首版不得引入 `branchId` / snapshot / recovery / 跨实例 barrier。
- recipe 加载不得引入 recipe durable store 或 workflow event 表。
- 跨 package 只能经 public exports 与 `agent-contracts` / `agent-common` 协作，禁止 private path import。
- pending-input `INTERRUPT` 形状（kind=QUESTION、0 questions、answer 恰为 `["resume"]`）是受控例外，需与 runtime 校验一致。

## Capability 失败处置协作

Capability 节点只把 `retry → retryPolicy → runtime.defaultRetry` 解析结果下沉为逻辑调用的 `maxRetries`，不得对统一边界交付的最终失败再执行节点级重放。最终失败进入显式 exception，取消直接中断；合法 `WAITING` 使用成功控制投影且 marker 保持包内私有。batch、poll 和 PromptSplicing 的独立调用边界见 `openspec/designs/architecture/capability-invocation-and-failure-disposition.md`。

## Public Exports

`@nextagent/agent-workflow`
