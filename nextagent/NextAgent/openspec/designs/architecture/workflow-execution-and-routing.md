# Workflow 执行与路由

## Directive effective input

`agent-core` 是 `$skill:` / `$workflow:` 文本解释的唯一 owner。`agent-app` 将其 normalizer 注入 runtime acceptance，runtime 在持久化 root USER message、flow variables 和 run 事实前投影有效用户问题与 typed routing constraints。Workflow routing 只消费 `targetRecipe` 与有效问题，禁止从后续模块、历史内容或 Web request body 重新恢复 directive。

## 核心结论

Workflow 是 agent-core routing 的一个执行分支，不是独立 runtime。当请求携带 trusted `routingConstraints.targetRecipe` 且当前 Agent Scope 的 capability catalog 命中 `kind="WORKFLOW"` 的 descriptor 时，`DefaultAgent` 把请求交给 `WorkflowExecutionService.execute()`；未命中时稳定降级到 conversation loop。workflow 执行不拥有 request lifecycle、cancel、checkpoint、terminal commit、pending input store——这些仍归 `agent-runtime`。workflow 通过 runtime-owned `AgentRunStatePort` 与 observer 投影与 runtime 协作。

## Routing 进入条件

- trusted `routingConstraints.targetRecipe?: string` 是 workflow 路径的显式入口。该 target 可以来自受信 request constraint，也可以由 `agent-core` 从 accepted user text 中的 `$workflow:<name>` directive 派生；agent-web public request body 不直接接受 `targetRecipe`。无论来源如何，workflow target 都必须进入同一 governed recipe capability resolve path。
- recipe 是 capability 的一种，`agent-core` 不拥有独立 `RecipeRegistry`。recipe 在启动期由 `agent-app` recipe loader 从工作区本地文件加载索引，并通过 capability provider 以 `CapabilityDescriptor(kind="WORKFLOW")` 进入当前 Agent Scope 的 catalog；完整 `RecipeDefinition` 由 app composition 注入的 recipe definition source 在执行期 `require(agentId, recipeName)` 懒加载，不引入 recipe durable store。
- 命中 `targetRecipe` -> 调用 `WorkflowExecutionService.execute()`；未命中 -> 回退 conversation loop 或 safe rejection/clarification。`$workflow:` miss 不得搜索另一个 Agent、全局 recipe registry 或 Skill catalog，也不得重解释为 target Skill。intent match 当前可选保留，不产生 durable side effect。
- boot-recipe 不自动进入：当请求未携带显式 `routingConstraints.targetRecipe` 时，`DefaultAgentRoutingPolicy.decide()` 不检查 `RecipeDefinition.type` 字段，不存在 boot-recipe 自动进入逻辑。`RecipeDefinition.type`（`"recipe"` | `"boot-recipe"`）在 schema 中保留，但 routing 层不消费该字段作为自动进入 workflow 的判据；未命中任何显式 workflow 入口时回退 `MODEL_DRIVEN_LOOP`（conversation loop）或 policy routing。若后续需要启用 boot-recipe 自动进入，必须经独立 OpenSpec change 承载。
- `DefaultAgent.executeRecipeRoute` 返回 `AgentExecutionOutcome | void`：workflow `WAITING` 状态桥接为 `PENDING_INPUT` outcome，由 runtime 进入 pending input 生命周期。

## Exec → Runtime 事件投影

- `WorkflowExecutionService.execute()` 接收可选 `WorkflowExecutionObserver`。`agent-core` 在调用时注入 observer，把 `WorkflowExecutionEvent` 经 `WorkflowRuntimeEventProjector` 投影为 runtime timeline event，复用现有 stream path，与 model loop UX 一致。
- `WorkflowExecutionEvent` 仅表达节点生命周期观测与安全可见 delta（`visibleDelta` channel=`CONTENT`|`THINKING`）。禁止包含 prompt、raw model output、raw capability result、secret、path、provider raw error。
- engine 引入事件但不拥有 observability sink；节点流式中间态通过 observer 上浮，由上层 orchestrator 投影到 runtime timeline。
- `agent-core` 不直接写 terminal history；执行事实经 runtime-owned `AgentRunStatePort`（emitEvent / appendMessage / saveCheckpoint）发布。

## Pending-input 桥接

- workflow 节点（`INTERRUPT`、`user-check`）需要暂停时，经 runtime `AgentRunStatePort.requestPendingInput(run, context, intent, options)` 委托，`options.producerRef` 标记为 `WORKFLOW_NODE`（携带 `recipeName/nodeId/nodeType/executionId`），`options.checkpointTrigger` 为 `STEP_STARTED`。
- `PendingInputProducerRef` 在 `agent-contracts/gateway` 扩展 `WORKFLOW_NODE` 变体；`RequestPendingInputOptions` 在 `agent-contracts/runtime` 新增可选 `producerRef` 与 `checkpointTrigger`。这是对 frozen pending-input contract 的兼容性扩展（可选参数 + union 扩展），非破坏性重定义。
- `INTERRUPT` 节点的 pending input 形状是受控例外：`kind=QUESTION`、0 questions、answer 恰为 `["resume"]`。`agent-runtime` 的 `assertValidPendingInputIntent` 与 `assertValidPendingInputAnswer` 对该形状放宽/收窄校验。该例外的原因：workflow interrupt 等待外部 resume 而非主动用户作答，复用 pending-input 生命周期但不套用通用 question 形状。
- resume 事实经 `context.flowVariables` 往返：workflow 把 execution state（executionId/recipeName/nodeId/nodeType/variables）写入 `flowVariables.workflowExecutionState`；`agent-runtime` 在 resume 路径识别 `WORKFLOW_NODE` producerRef，把 `workflowPendingResume`（含 answers/pendingAnswerSummary）注入 context；resume 子请求携带 `routingConstraints.targetRecipe` 回到同一 recipe。
- pending input 超时 resume：`producerRef.kind === 'WORKFLOW_NODE'` 的 pending input 超时时，runtime 不直接终态化 `FAILED`，而是 resume 原 run（从 checkpoint 重建 recovery context 并 re-queue 执行），且 resume 时不设 `answers` 字段。engine handler 识别 `resumeState.answers === undefined` 为超时恢复：`executeUserCheckNode` 调用 `throwUserCheckTimeout`，`executeInterruptNode` 和 `executeRestfulNode` reflection 路径防御性抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT）。throw 产生的 safe error 走 engine exception 路由（`mapSafeErrorToVariables` → `resolveErrorTransition`），若 recipe 配置了 `error.category == 'TIMEOUT'` 的 exception 分支则路由到该分支（terminal 可能为 `COMPLETED`），否则终态化 `FAILED`（`failureReason: WORKFLOW_NODE_TIMEOUT`）。checkpoint 不可用时 fallback 到直接终态化 `FAILED`（`PENDING_INPUT_TIMEOUT`）。`producerRef.kind !== 'WORKFLOW_NODE'`（`LIFECYCLE_HOOK`、`CAPABILITY_INVOCATION`）的超时保持直接终态化 `FAILED`。`USER_INPUT_TIMEOUT` 事件在 resume 前发布。`skipTerminalLifecycleHook` 不再被设置——超时终态时 terminal lifecycle hook 正常执行。
- workflow 不拥有 pending input store、timeout 决策或 human handoff 接管——这些仍归 runtime-owned lifecycle。

## Owner Scope 与 Agent Scope 传递

- workflow 执行继承父请求的 trusted owner scope（来自 channel/auth 边界）与 agent scope（来自 accepted `RequestRun.agentId`）。`WorkflowExecutionRequest` 携带 `agentId/agentVersion/sessionId/requestId/runId/requestContextId/identityContext`，全部来自可信上下文，不得来自客户端请求体或模型输出。
- 除 routing-level `targetRecipe` 分支外，model tool loop 可通过 `Workflow` builtin Tool 调用当前 Agent Scope 已发布的 `WORKFLOW` recipe。Tool 经 app 注入的 `WorkflowExecutionToolPort` 调用既有 service，把完成、失败、取消和等待转换为安全 capability result；它不创建 recipe store、workflow event table 或 resume 生命周期。
- `sub-recipe` 节点加载子 recipe 经 app composition 注入的 recipe definition source `require(agentId, recipe_name)`，并应保持与当前 Agent Scope 下 WORKFLOW capability 可见性一致；子 recipe 执行继承父 owner/agent scope，不得覆盖父 `agentId`/`identityContext`。
- `agent` 节点调用本地子 agent 经统一 capability 路径，继承父 owner/agent scope。
- workflow 路径上的 run state side effects（emitEvent/appendMessage/saveCheckpoint/requestPendingInput）全部经 runtime-owned port，由 runtime 补齐 owner/agent/session/request/run 坐标。

## 节点能力组与边界

所有 Workflow Capability 节点、`DATA_ANALYSIS` Python 子调用和 Workflow Tool 入口只消费 governed invocation port 交付的最终 `CapabilityInvocationResult`。Workflow 节点 retry 只能下沉为同一次逻辑调用的 `maxRetries`，不得在最终结果返回后再次重放 Capability；取消立即中断，其他最终失败进入当前节点显式 `exception`，无匹配分支时 Workflow 失败。Recipe 已显式消费的 poll/batch 单项失败保持其协议语义，不形成第二套自动 retry。

Workflow `NODE_WAITING` 是已成功形成的 pending control result，Capability 投影使用 `SUCCEEDED` 与 `WORKFLOW_NODE_WAITING` metadata；缺少可用 pending context 时必须失败。Workflow Tool metadata 只允许 optional `executionId` 和 non-negative safe-integer `nodeResultCount`，不得把 duration、raw node output 或 provider error作为公共结果扩展。

六类节点 handler 注册在 `agent-workflow` node catalog，ownership 非重叠：
- **gateway-nodes**：`start-event` / `end-event` / `exclusive-gateway`（first-true-wins、`condition:""` fallback、all-false→FAILED）。无业务 payload、无 model/capability 调用、无节点级 retry/timeout。
- **parallel-gateway**：单进程并发 fork/join（`Promise.allSettled` + `AbortController`）。支持 `inputs.join_node`（显式 join 节点）、`inputs.join_on_failure`（`"break"` / `"wait"`）、`inputs.join_timeout`（超时 abort）。无 `branchId` / snapshot / recovery / 跨实例 barrier。安全失败码 `WORKFLOW_PARALLEL_GATEWAY_NO_MATCH` / `JOIN_UNRESOLVED`。`inclusive-gateway` 作为 `PARALLEL` 节点类型的 BPMN DSL 别名，由 recipe loader 的 `normalizeNodeType` 映射到 canonical `WorkflowNodeType = "PARALLEL"`，不引入新 node type；执行语义复用 `PARALLEL` handler，评估所有分支条件并激活所有条件为 true 的分支。
- **capability-nodes**：`tool-choice` / `restful` / `python` / `agent`（`tool` 节点首版暂不实现/deferred：无 recipe 使用，engine 不注册 `TOOL` handler，recipe loader 不识别 `type: "tool"`）。tool-choice 只选择不执行；python 优先经 `agent-capability` 暴露的 `WorkflowSandboxExecutionPort.runPython` 直接通过 sandbox gateway 执行预定义脚本，不经 `python` capability 路径、不触发 nl2py guardrail，port 未注入时 fallback 到 `capabilityInvocation`（变量声明作为 `preamble` 字段传递、`code` 只含用户 `script`，nl2py 只检查 `code`）；restful 经 gateway 并在边界解析 secret，`batchConfig` 非空时按 `batchMode`（serial/parallel）对每个元素独立调用 capability，parallel 用 worker pool 由 `batchParallelism` 直控元素级并发；agent 节点继承父 scope。
- **interaction-nodes**：`user-check` / `display-content` / `guardrail-check` / `delay-gateway` / `interrupt-gateway` / `sub-recipe`。pending input 经 runtime 委托；display-content 投影到 channel；`delay-gateway` 把字符串 `delay_time`（秒）转毫秒等待；`sub-recipe` 经 app-composed recipe definition source 加载并强制嵌套深度限制，把 `${recipe_result}` 绑定到子 recipe answer node 的 `nodeResult.output`（answer node 从 END 沿单前驱链反向遍历、跳过 gateway、取第一个非 gateway 节点），并把子 recipe 执行事件转发给父 observer 供轨迹还原。
- **knowledge-nodes**：`knowledge-search` / `knowledge-qa` / `api-choice` / `recipe-choice`。检索经 knowledge gateway；api-choice/recipe-choice 只选择不执行。`knowledge-search` 输入 `rag_index`（对象数组，每对象含 `domain`/`scene`/`index_name`/`index_type`/`priority`，`index_name` 必填，兼容纯字符串；workflow 层保留完整对象，gateway 调用时只提取 `index_name` 作 `string[]`）、`query`、可选 `filters`/`rank_topN`/`vs_topN`/`es_topN`；输出 `documents` 为 safe 检索摘要（可追溯 ref、标题摘要、score 摘要），不等于原始全文，结果过大时裁剪或摘要。`knowledge-qa` 先检索后问答，输出 `answer` 与 `sourceDocuments`，原始大文档不全量落地。`api-choice` 支持 bounded `candidateApis` 直接 LLM N 选 1 或 RAG 召回 top5 后 LLM 5 选 1，DSL 固定输出 `api_name`（供下游 `restful.inputs.api_name` 消费），`apiName`/`mappedParams`/`api_choice_result`/`knowledge_diagnostic` 不得作为 DSL 输出；RAG 召回为空抛 `WORKFLOW_API_CHOICE_NOT_FOUND`。`recipe-choice` DSL 固定输出 `recipe_name`（供下游 `sub-recipe` 消费），不得回摆为旧 `recipeId`。knowledge 节点私有 schema 由 `workflow-knowledge-nodes` spec owner，`agent-contracts/core` 只透传 opaque `inputs`/`outputs`/`outputParser`。
- **llm-nodes**：`llm-router` / `intent-recognition` / `question-rewriting` / `translation` / `data-analysis` / `param-extract`。经 `ModelInvocationService` 调用，不直接用 provider SDK；输出经 sanitize/schema 校验，raw prompt/输出/provider error 不落 trace。

## Deferred 范围（首版不实现）

- `WorkflowExecutionSnapshot`、distributed scheduling、`branchId`、cross-instance barrier。
- snapshot / resume / recovery、rollback / degrade / saga、durable workflow history。
- recipe durable store、workflow event 持久化表、远程 recipe source、hot reload。
- loop / exception / rollback / default-branch 以外的高级控制流语义。

这些能力须在后续 OpenSpec change 中定义后才可引入，不得反向写成已实现事实。

## 验证关注点

- workflow 不得绕过 `AgentRunStatePort` 直接写 terminal / checkpoint / pending input store。
- `targetRecipe` 只能来自 trusted channel/auth boundary 或 core 对 accepted user text 的 `$workflow:` directive 解析；不得来自 agent-web public request body、模型输出或 capability 参数。
- pending-input `INTERRUPT` 形状须与 runtime 校验一致；resume 子请求须携带 `targetRecipe` 回到同一 recipe。
- workflow 事件与节点输出不得包含 prompt / raw model output / raw capability result / secret / path。
- parallel-gateway 不得引入 `branchId` / snapshot / recovery。
- recipe 加载不得引入 recipe durable store 或 workflow event 表。
- exec→runtime 事件投影须与 model loop stream UX 一致，经 `WorkflowRuntimeEventProjector`。

## 验证入口

- workflow routing contract tests（targetRecipe trusted carry + channel schema）
- workflow execution engine integration tests（顺序/分支/parallel/timeout/retry/interrupt）
- workflow pending-input bridge tests（WAITING→PENDING_INPUT、resume 往返）
- workflow node handler tests（六类节点安全输出与边界）
- architecture lint（package 依赖方向、private import 禁止）

## Capability 失败处置协作

Workflow Capability 节点把 retry declaration 下沉为统一调用的 `maxRetries`，最终失败只进入显式 exception，不再由 engine 重放节点；取消直接中断，合法 waiting 保持成功控制投影。解析优先级、poll/batch 独立调用、nested error 保真和 package-private marker 规则详见 `openspec/designs/architecture/capability-invocation-and-failure-disposition.md`。
