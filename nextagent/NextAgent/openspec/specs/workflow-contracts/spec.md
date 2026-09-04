 workflow-contracts Specification

## Purpose

定义 Workflow 编排的最小公共 DSL、执行输入输出和安全生命周期观测契约。它为 `FN-9.1-执行工作流` 提供统一的 Recipe、图和 `WorkflowExecutionService.execute()` 语义；节点私有 schema、持久化恢复和分布式调度不属于本规格。
## Function

- **所属 Function**：`FN-9.1 执行工作流`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: WorkflowNodeType Enum

TS 后端 MUST 在 `agent-common` 中定义 `WorkflowNodeType`，供 workflow contract 和后续 workflow changes 共同复用。

#### Scenario: Enum Value Accessibility
- **WHEN** workflow 相关模块 import `agent-common`
- **THEN** 这些模块 MUST 能访问统一的 `WorkflowNodeType`

### Requirement: RecipeDefinition

`RecipeDefinition` MUST 在 v1 基础上扩展以下可选字段：

- `runtime?: RuntimeConfig`
- `inputs?: Record<string, InputDef>`
- `metadata?: Record<string, unknown>`
- `presentation?: RecipePresentation`

`metadata` MUST 替代 v1 `expandFields`，loader MUST 将 v1 `expandFields` 映射到 `metadata`。

#### Scenario: Runtime Config Attached
- **WHEN** recipe 定义 `runtime.timeout`
- **THEN** 解析结果 `RecipeDefinition.runtime.timeout` MUST 为秒整数
- **AND** MUST NOT 使用毫秒为单位

#### Scenario: Inputs Contract
- **WHEN** recipe 定义 `inputs.input_question.type = "string"`
- **THEN** 解析结果 `RecipeDefinition.inputs["input_question"]` MUST 符合 `InputDef`
- **AND** 节点 MUST 能通过 `${input.input_question}` 引用

#### Scenario: ExpandFields Compat
- **WHEN** v1 recipe 使用 `expandFields`
- **THEN** loader MUST 将其合并到 `metadata`
- **AND** MUST NOT 保留 `expandFields` 作为独立字段

### Requirement: FlowGraph

`WorkflowNodeDef` MUST 在 v1 基础上扩展以下可选字段：

- `dependsOn?: string[]`
- `retry?: RetryPolicy`
- `timeout?: number`（秒）
- `presentation?: NodePresentation`

`WorkflowNodeDef` MUST 保留 `retryPolicy`/`onError`/`outputParser` 为 deprecated 兼容字段，loader MUST 对 `retryPolicy` 到 `retry` 做归一映射。

`onError` MUST 被标记为 deprecated，engine MUST NOT 消费 `onError`；节点级异常转移 MUST 使用 `exception`（与 `next` 同级）。

#### Scenario: DependsOn Declaration
- **WHEN** 节点声明 `dependsOn: ["node-a"]`
- **THEN** 解析结果 MUST 保留 `dependsOn` 数组
- **AND** engine MAY 据 `dependsOn` 做 DAG 调度（本 change 不强制实现）

#### Scenario: Retry Compat
- **WHEN** v1 节点使用 `retryPolicy: { maxRetries: 2, delay: 100 }`
- **THEN** loader MUST 透传 `retryPolicy`
- **AND** loader SHOULD 尝试结构化为 `retry: { maxAttempts, backoff, delay }`

#### Scenario: OnError Deprecated
- **WHEN** 节点定义 `onError`
- **THEN** loader MUST 保留该字段
- **AND** engine MUST NOT 读取或消费 `onError`

#### Scenario: EndNodeNextOptional

- **WHEN** recipe 定义 END 节点且不携带 `next` 字段
- **THEN** `RecipeDefinitionSchema` MUST 校验通过（`WorkflowNodeDef.next` 为 Optional）
- **AND** loader MUST 将缺失的 `next` 视为空 record（`{}`）
- **AND** engine MUST 将空 `next` 的节点解析为 TERMINAL 转移，MUST NOT 抛 `Cannot convert undefined or null to object`

### Requirement: WorkflowExecutionService Port

TS 后端 MUST 在 `agent-contracts/core` 中定义：

```ts
execute(
  request: WorkflowExecutionRequest,
  signal: AbortSignal,
  observer?: WorkflowExecutionObserver
): Promise<WorkflowExecutionResult>
```

`WorkflowExecutionRequest` MUST 包含：
- `recipeName`
- `recipeVersion`
- `inputVariables`
- `identityContext`
- `agentId`
- `agentVersion`
- `sessionId`
- `requestId`
- `runId`
- `requestContextId`

`WorkflowExecutionResult` MUST 包含：
- `executionId`
- `status`
- `outputVariables`
- `nodeResults`
- `startedAt`
- `completedAt`

#### Scenario: Port Asynchronous Signature
- **WHEN** 调用 `execute`
- **THEN** 返回值 MUST 是 `Promise<WorkflowExecutionResult>`
- **AND** 方法签名 MUST 接受 `AbortSignal`

#### Scenario: Optional Runtime Observer
- **WHEN** workflow 需要把节点生命周期或安全可见增量内容桥接到上层 runtime
- **THEN** `execute()` MUST 允许接收可选 `WorkflowExecutionObserver`
- **AND** observer MUST 只消费安全的 `WorkflowExecutionEvent`
- **AND** workflow contract MUST NOT 直接依赖 runtime timeline event vocabulary

### Requirement: WorkflowNodeResult

`WorkflowNodeResult` MUST 包含：
- `nodeId`
- `nodeType`
- `status`
- `retryCount`
- `startedAt`
- `completedAt`

`WorkflowNodeResult` MAY 包含：
- `output?`
- `safeError?`

#### Scenario: Minimal Node Result
- **WHEN** workflow engine 返回节点结果
- **THEN** 节点结果 MUST 使用唯一的 `WorkflowNodeResult` 结构
- **AND** 本 change MUST NOT 引入 `nodeAttemptId`、`branchId` 或 distributed owner 字段

### Requirement: WorkflowExecutionEvent

TS backend MUST define `WorkflowExecutionEvent` in `agent-contracts/core` for node lifecycle observation.

#### Scenario: Safe Event Shape
- **WHEN** engine emits `WorkflowExecutionEvent`
- **THEN** event MUST NOT contain prompt, raw model output, raw capability result, secret or path

#### Scenario: Safe Visible Delta
- **WHEN** node needs to project safe intermediate visible content to the user
- **THEN** `WorkflowExecutionEvent` MAY carry controlled `visibleDelta`
- **AND** `visibleDelta` MUST only allow `CONTENT`, `THINKING`, `CHART`, `TABLE` or `DSL` channel types
- **AND** `visibleDelta.content` MUST be a safe text delta
- **AND** `visibleDelta.content` length MUST NOT exceed 150000 characters
- **AND** contract MUST NOT introduce workflow direct dependency on runtime `LLM_CONTENT_DELTA` / `LLM_THINKING_DELTA`

### Requirement: AgentAssembly Recipe Bindings

`AgentAssembly` MUST 增加 `recipeIds?: string[]` 可选字段。

#### Scenario: Optional Recipe Binding
- **WHEN** 构建 `AgentAssembly`
- **THEN** `recipeIds` MUST 是可选字段

### Requirement: Workflow Capability Kind

`CapabilityKind` MUST 使用 `WORKFLOW` 表示可执行 workflow 能力。`RecipeDefinition`、`recipeName`、`RECIPE_CHOICE` 和 RAG `indexType: RECIPE` 保持静态资源 vocabulary，不得作为运行时 capability kind。

#### Scenario: Recipe is published as workflow capability
- **WHEN** recipe provider 从静态 Recipe DSL 生成 capability descriptor
- **THEN** descriptor.kind MUST 为 `WORKFLOW`
- **AND** `RECIPE` MUST NOT 是合法的 `CapabilityKind`.

#### Scenario: Resource vocabulary remains unchanged
- **WHEN** workflow 解析或执行 recipe 资源
- **THEN** resource vocabulary MUST 保持 `RECIPE` 语义
- **AND** capability-kind 统一不得触发资源字段改名。

### Requirement: WorkflowExecutionEvent 本地执行关联

既有 `WorkflowExecutionEvent` MUST 接受 OPTIONAL `nodeExecutionId` 和 `predecessorNodeExecutionIds`，以保持 remote workflow transport 兼容。本地工作流真实执行节点发出的每个 event MUST 包含 `nodeExecutionId` 和 `predecessorNodeExecutionIds`；START/END 脚手架 event MUST 省略这两个执行关联字段。`nodeExecutionId` 和每个前驱成员 MUST 长度为 1 至 128，并 MUST 只包含 ASCII 字母、数字、点、下划线、冒号或连字符。同一真实执行节点实例的 START、增量和 TERMINAL event MUST 使用相同 `nodeExecutionId` 和前驱列表。不同重试尝试、循环迭代或子流程节点实例 MUST 使用不同 `nodeExecutionId`。

`predecessorNodeExecutionIds` MUST 表示实际选择控制流中的全部直接前驱执行实例。入口节点 MUST 使用空数组。数组 MUST 按 recipe 转换的确定顺序排列并去重，MUST 至多包含 128 个成员。并行汇聚 MUST 保留全部直接前驱，MUST NOT 按 event 到达或完成时间选择最后一个分支。

既有安全字段、`input`、`output` 和 `visibleDelta` 语义 MUST 保持不变；本 requirement MUST NOT 把 input/output 注入 timeline 权威执行 span attribute，也 MUST NOT 改变 remote workflow 的必填字段。

#### Scenario: 顺序节点携带实际前驱

- **WHEN** 本地工作流依次执行节点实例 A 和 B
- **THEN** A 的 event MUST 携带 `predecessorNodeExecutionIds=[]`
- **AND** B 的 event MUST 携带 `predecessorNodeExecutionIds=[A.nodeExecutionId]`

#### Scenario: 并行汇聚携带全部前驱

- **WHEN** 节点实例 B 和 C 并行执行后汇聚到 D
- **THEN** D 的 event MUST 同时携带 B 和 C 的 nodeExecutionId
- **AND** 成员顺序 MUST 由 recipe 分支声明顺序决定

#### Scenario: 重试具有独立执行标识

- **WHEN** 节点尝试失败并开始下一次重试
- **THEN** 两次尝试 MUST 使用不同 `nodeExecutionId`
- **AND** 每次尝试的 START 和 TERMINAL MUST 使用自身标识

#### Scenario: remote event 保持兼容

- **WHEN** remote workflow event 没有提供 nodeExecutionId 或 predecessorNodeExecutionIds
- **THEN** contract schema MUST 接受该 event
- **AND** 系统 MUST 不为该 event 创建本地节点 timeline 权威执行 span

#### Scenario: START 和 END 脚手架不携带执行关联

- **WHEN** 本地工作流发出 START 的 `NODE_STARTED` 或 END 的 `NODE_COMPLETED`
- **THEN** 对应 event MUST 省略 `nodeExecutionId` 和 `predecessorNodeExecutionIds`
- **AND** 系统 MUST 不为该 event 创建或结束 timeline 权威执行 span
- **AND** trace 启用且 request span 可解析时，投影后的 timeline event MUST 复用 request span snapshot

### Requirement: 工作流前驱 MUST 投影为 previewSpanIds

trace 启用时，本地工作流真实执行节点 START event 的每个 `predecessorNodeExecutionIds` 成员 MUST 解析到同一 request trace 中的权威节点 span。全部成员解析成功时，系统 MUST 按输入顺序去重并保存为 `inlinePayload.trace.previewSpanIds`。第一个真实执行节点 MUST 保存空数组；START/END 脚手架不参与前驱解析。

任一前驱缺失、无效、属于其他 trace、等于当前节点 span，或完整列表超过 128 个成员时，系统 MUST 整体省略 `previewSpanIds` 并产生有界安全降级证据。系统 MUST NOT 保存部分列表，也 MUST NOT 根据 timeline sequence、event 时间或 span 完成时间推断前驱。

同一节点实例的 START 和 TERMINAL event MUST 保存相同 `previewSpanIds`。

#### Scenario: 入口节点保存空列表

- **WHEN** 本地入口节点没有直接前驱且 trace 已启用
- **THEN** START 和 TERMINAL event MUST 包含 `previewSpanIds=[]`

#### Scenario: 结束的并行前驱仍可解析

- **WHEN** 并行分支 B 和 C 已结束，汇聚节点 D 随后开始
- **THEN** D 的 previewSpanIds MUST 包含 B 和 C 的 spanId
- **AND** 前驱 span 结束 MUST 不导致 registry 在 request 终止前丢失其最小关联

#### Scenario: 跨 trace 前驱被整体拒绝

- **WHEN** 任一前驱执行标识解析到其他 trace
- **THEN** 当前节点 event MUST 省略 previewSpanIds
- **AND** 系统 MUST 不保存跨 trace 控制边

### Requirement: Workflow 节点重试不重放 Capability 最终失败

Workflow engine MUST 对声明节点级 timeout 的非 Capability 节点在该时限到达时终止当前 attempt，并把该 attempt 作为可求值的节点失败。非 Capability 节点发生 timeout 或其他可重试节点失败、且已经消耗的 retry 次数小于节点声明值时，engine MUST 启动下一节点 attempt；每个 attempt MUST 重新建立该节点声明的完整 timeout。总 attempt 数 MUST 等于初始 attempt 加实际执行的 retry 次数。retry 耗尽后，engine MUST 停止启动新 attempt，并求值当前节点显式 `exception`；存在匹配分支时 MUST 只执行该分支，分支声明跳过时产生 skipped 结果，不存在匹配分支时 Workflow MUST 失败。

当节点调用 Capability 时，节点 retry 次数 MUST 只作为统一执行边界内部的 `CapabilityInvocationRequest.maxRetries` 上限。当节点失败来源是统一执行边界返回的最终 `CapabilityInvocationResult` 时，engine MUST NOT 根据节点 retry 配置、`safeError.retryable` 或 timeout 再次执行该节点。Capability 的同参自动重试 MUST 在最终结果返回前完成；最终结果返回后，Workflow 对该逻辑调用的自动重试次数 MUST 为 `0`。

**需求类别**：功能性需求

#### Scenario: 非 Capability 节点按声明重试

- **WHEN** 非 Capability 节点 attempt 超时或返回可重试节点失败
- **AND** 节点仍有声明的 retry 次数
- **THEN** engine MUST 启动下一 attempt
- **AND** 下一 attempt MUST 获得该节点声明的完整 timeout

#### Scenario: 非 Capability 节点重试耗尽

- **WHEN** 非 Capability 节点已耗尽声明的 retry 次数
- **THEN** engine MUST 停止启动新 attempt
- **AND** 存在匹配显式 exception 时 MUST 只执行该分支
- **AND** 分支声明跳过时 MUST 产生 skipped 结果
- **AND** 不存在匹配 exception 时 Workflow MUST 失败

#### Scenario: Capability 最终失败不执行 Workflow retry

- **WHEN** Capability 节点返回最终 `FAILED` 或 `TIMED_OUT`
- **AND** 节点声明了 retry
- **THEN** engine MUST NOT 再次执行该节点
- **AND** engine MUST 继续求值当前节点显式 `exception`
- **AND** 节点 retry 次数 MUST 只约束已经结束的逻辑 Capability invocation 内部 attempt 上限

### Requirement: 最终 Capability 失败统一求值显式 exception

除以下两类控制结果外，Workflow engine MUST 对全部最终 Capability 失败求值当前节点声明的显式 `exception`：

1. 最终 `safeError.category=CANCELED` 或父 `AbortSignal` 已取消时，系统 MUST 立即中断且 MUST NOT 求值普通 `exception`。
2. Recipe 通过 `on_poll_error=skip` 或 `batchFailStrategy=continue` 明确消费 poll/batch 单项失败时，系统 MUST 记录安全单项失败并继续，且 MUST NOT 重放该单项。

适用 category MUST 包含 `VALIDATION`、`NOT_FOUND`、`CONFLICT`、`UNAVAILABLE`、`TIMEOUT`、`AUTHORIZATION`、`POLICY_DENIED` 和 `INTERNAL`；适用 code MUST 包含 `CAPABILITY_OUTPUT_INVALID` 和 `CAPABILITY_RESULT_UNKNOWN`；缺失或非法 `safeError` 被规范化后的安全内部失败同样适用。engine MUST 使用最终 `safeError` 生成 Recipe exception 变量 `error`，并 MUST 保留上游业务 code 和 message。

存在匹配 `exception` 时，engine MUST 只执行该显式分支；不存在匹配 `exception` 时，Workflow MUST 失败。框架 MUST NOT 在 `exception` 之外推断补偿、降级或重放动作。外部取消触发的 cancel fallback MUST 遵守声明的取消策略，MUST NOT 因 fallback 中的 Capability 失败进入普通 `exception` 或 retry。

Recipe 可见 `error` 变量 MUST 遵守 canonical Workflow error contract；本 Requirement MUST NOT 增加或删除该结构中的字段。

**需求类别**：功能性需求

#### Scenario: 输出无效进入显式 exception

- **WHEN** Capability 最终返回 `CAPABILITY_OUTPUT_INVALID`
- **AND** 当前节点声明匹配的 `exception`
- **THEN** engine MUST 使用该安全 code 和 message 求值 `exception`
- **AND** engine MUST NOT 自动重新执行 Capability

#### Scenario: 不可恢复失败进入显式 exception

- **WHEN** Capability 最终返回 `AUTHORIZATION`、`POLICY_DENIED`、`INTERNAL` 或 `CAPABILITY_RESULT_UNKNOWN`
- **THEN** engine MUST 求值当前节点显式 `exception`
- **AND** engine MUST NOT 在求值前自动重试 Capability

#### Scenario: 没有 exception 时 Workflow 失败

- **WHEN** Capability 最终失败且当前节点没有匹配 `exception`
- **THEN** Workflow MUST 结束为失败
- **AND** engine MUST 保留最终安全错误事实

#### Scenario: 取消不进入 exception

- **WHEN** Capability 最终返回 `safeError.category=CANCELED` 或父 `AbortSignal` 已触发
- **THEN** engine MUST 停止启动普通正向节点，并按声明的 cancel policy 决定是否执行 fallback
- **AND** engine MUST NOT 求值普通 `exception`
- **AND** 未配置 cancel fallback 时 Workflow MUST 返回中断结果

#### Scenario: 取消回退中的 Capability 失败不进入普通处置

- **GIVEN** 外部取消已经使 Workflow 进入声明的 cancel fallback
- **WHEN** fallback 中的 Capability 节点返回最终 `FAILED` 或 `TIMED_OUT`
- **THEN** engine MUST NOT 根据该节点的 retry 配置再次执行 Capability
- **AND** engine MUST NOT 求值该节点的普通 `exception`
- **AND** Workflow MUST 按声明的 cancel fallback 失败规则返回中断结果

### Requirement: Capability exception 仅观察最终失败事实

Workflow MUST 只把最终 Capability `safeError` 投影到显式 `exception`。统一执行边界的中间 retry attempt MUST NOT 进入 Recipe 变量、Workflow event 或 exception 求值。

**需求类别**：系统质量属性
**质量属性**：可靠性/恢复
**适用范围**：`FN-9.1 执行工作流`

#### Scenario: 中间 retry attempt 对 Workflow 不可见

- **WHEN** 统一 Capability 执行边界的第一次 attempt 失败且第二次 attempt 成功
- **THEN** Workflow 节点 MUST 只观察成功结果
- **AND** engine MUST NOT 求值 `exception`
- **AND** Workflow event MUST NOT 包含第一次失败内容

#### Scenario: 最终失败只投影安全字段

- **WHEN** 统一执行边界返回最终失败
- **THEN** engine MUST 只基于最终 `safeError` 求值 `exception`
- **AND** 中间 attempt 的 `safeError` MUST NOT 进入 exception 上下文

### Requirement: Workflow 节点等待状态投影为成功控制结果

Workflow engine 产生 `NODE_WAITING` 事件时，runtime timeline projection MUST 把该事件投影为 `CAPABILITY_COMPLETED`，其 `inlinePayload.status` MUST 为 `SUCCEEDED`，`reasonCode` MUST 为 `WORKFLOW_NODE_WAITING`。等待状态是协议控制结果，不是降级或失败；timeline projection MUST NOT 把 `NODE_WAITING` 投影为 `DEGRADED`。

**需求类别**：功能性需求

#### Scenario: NODE_WAITING 投影为 SUCCEEDED

- **WHEN** Workflow engine 产生 `NODE_WAITING` execution event
- **THEN** timeline projection MUST 产生 `CAPABILITY_COMPLETED` 事件
- **AND** `inlinePayload.status` MUST 为 `SUCCEEDED`
- **AND** `inlinePayload.reasonCode` MUST 为 `WORKFLOW_NODE_WAITING`
- **AND** projection MUST NOT 携带 `safeError`

### Requirement: NodeBatchConfig

`RESTFUL`、`KNOWLEDGE_SEARCH` 和 `LLM_ROUTER` 节点 MUST 通过节点级 `batchConfig` 子配置承载单节点并发批量调用能力。`batchConfig` 是 `WorkflowNodeDef` 的顶层可选字段，与 `loopConfig` 平行；batch 配置字段 MUST NOT 放在 `inputs` 中。loader MUST 将 snake_case `batch_config` 映射到 camelCase `batchConfig`，且 MUST NOT 因节点类型不是 `RESTFUL` 而静默丢弃 `batchConfig`。未提供 `batchConfig` 时为单次调用（现有行为不变）。

batchConfig 字段：
- batchInputDataItem: array（启用 batch 时必填，提供时启用 batch 模式）
- batchElementVariable?: string（默认 "element"；参数模板中通过 `${<batchElementVariable>}` 引用当前批次元素）
- batchSize?: int（默认 10，>0；每批参数量上限）
- batchMode?: "serial" | "parallel"（默认 "serial"；serial=串行逐批调用，parallel=多批并行调用）
- batchFailStrategy?: "continue" | "abort"（默认 "continue"；continue=部分批次失败时继续，abort=任一批次失败立即终止）
- batchParallelism?: int（默认 5，范围 [1,20]，仅 batchMode=parallel 时生效；超过 20 时 clamp 到 20，不报错）
- batchResultMerge?: "append" | "map"（默认 "append"；append=所有批次结果追加为 List，map=按批次元素 key 合并为 Map）

触发机制：节点 ready 且 scheduler 触发 handler 时，handler 入口先检测 `batchConfig` 是否存在；存在且 `batchInputDataItem` 为非空数组时进入 batch 分支，否则为单次调用。

输入与前置条件：
- 节点 `inputs` 已解析
- `batchConfig.batchInputDataItem` 已解析为非空数组
- 可信 owner scope / agent scope / AbortSignal 可用
- 对应调用边界可用（RESTFUL: capabilityInvocation；KNOWLEDGE_SEARCH: retrieveKnowledge；LLM_ROUTER: modelInvocation）

输出与副作用：
- batch 模式产出 `batch_results`（合并后结果）、`failed_items`（失败项）、`invocation_trace`（RESTFUL 和 LLM_ROUTER 产出）
- RESTFUL 节点额外产出 `api_response`（最后一个元素的调用结果，按下标不按完成时序）
- LLM_ROUTER 额外产出 `llm_result` 和 `llm_completion`（最后一个元素的解析结果和增强完成对象，与单次模式绑定对齐）
- 单次模式产出各节点类型既有输出，MUST NOT 产出 batch_results/failed_items
- 每个批次 side effect MUST 与 executionId / nodeId / 批次序号可追溯
- batch_results / failed_items 只保留安全结果与 safe error summary，MUST NOT 保留 secret 明文

核心判断逻辑（handler 执行步骤；互斥校验在 loader 阶段完成，见 `LoopBatchMutex`）：
1. 读取节点 `batchConfig`；不存在时走单次调用分支。
2. 校验 `batchInputDataItem` 已解析且为非空数组；否则报 validation error（reason code `WORKFLOW_BATCH_INPUT_INVALID`），不得静默降级。
3. 将 `batchInputDataItem` 按 `batchSize` 分批。
4. 每批构造 per-element context：注入 `{ [batchElementVariable]: 当前批次元素 }` 到 `context.variables`，从 element context 重新解析节点 inputs。三个节点类型的注入方式一致（通过 element context），差异只在调用边界。
5. 按 `batchMode` 调度：serial 逐批串行，parallel 按 `batchParallelism` 限流并发。
6. 按 `batchFailStrategy` 处理失败：continue 记录失败项继续，abort 记录失败项后停止后续批次。
7. 按 `batchResultMerge` 合并成功结果：append 为 List（按原始元素下标顺序），map 为 Map（按批次元素 key）。
8. 节点类型专属的"最后一个元素结果"绑定（RESTFUL: `api_response`；LLM_ROUTER: `llm_result`）按下标绑定 `results[items.length - 1]`；若该元素未执行或失败则为 undefined，静默跳过。

节点类型差异：
- **RESTFUL**：per-element 调用 `capabilityInvocation.invoke`，baseArgs 为 inputs 去除 `api_name` 后的纯 API 调用参数。batch 优先于 `is_long_api`。
- **LLM_ROUTER**：per-element 复用 `executeLlmNode` 单次模式内部管线（prompt 准备 -> 模型调用 -> 结果解析），差异仅为注入 element 变量和强制非流式。batch 模式 MUST 强制非流式（`modelInvocation.complete`），MUST NOT 调用 `shouldUseStreamMode`。modelConfig 在 batch 入口解析一次，所有 element 共享。
- **其他 LLM 族节点**（`LLM`、`INTENT_RECOGNITION`、`QUESTION_REWRITING`、`TRANSLATION`、`DATA_ANALYSIS`、`PARAM_EXTRACT`）：MUST NOT 支持 batch。声明 `batchConfig` 时 handler MUST 报 `WORKFLOW_BATCH_UNSUPPORTED_NODE_TYPE`，不得静默降级为单次调用。
- **KNOWLEDGE_SEARCH**：per-element 调用 `retrieveKnowledge`，通过 element context 注入变量。单次模式下空检索结果 throw `WORKFLOW_KNOWLEDGE_SEARCH_EMPTY`；batch 模式下空检索结果 MUST 转为 failed item（不 throw），由 `batchFailStrategy` 决定继续或中止。

状态 / 产物契约：
- `batch_results`：合并后结果，生命周期与节点输出变量一致，由下游节点 `${batch_results}` 消费。
- `failed_items`：失败项数组，每项含 index/item/error{code,message}，由下游节点 `${failed_items}` 消费。
- `api_response`（RESTFUL）/ `llm_result`（LLM_ROUTER）：最后一个元素的调用结果，供下游复用单次模式绑定的场景。
- `invocation_trace`：调用诊断，可追溯（KNOWLEDGE_SEARCH 不产出）。
- secret 不得进入以上任何产物。

流程接入：
- 上游：gateway / llm / knowledge / interaction 节点产出 `batchInputDataItem` 引用的数组变量。
- 下游：任意消费 safe output 的节点。
- batch 仅在 handler 内生效，不新增 recipe registry / dispatch path / scheduler / pending store。

失败与降级：
- `batchConfig` 存在但 `batchInputDataItem` 缺失或解析后不是非空数组：报 validation error（reason code `WORKFLOW_BATCH_INPUT_INVALID`），MUST NOT 静默降级为单次调用。
- 非 `LLM_ROUTER` 的 LLM 族节点声明 `batchConfig`：handler MUST 报 `WORKFLOW_BATCH_UNSUPPORTED_NODE_TYPE`，MUST NOT 静默降级为单次调用。
- `batchFailStrategy: "continue"` 批次失败：记录 failed_items，继续执行其余批次，节点状态 NODE_COMPLETED。
- `batchFailStrategy: "abort"` 批次失败：记录 failed_items，停止后续批次，节点状态 NODE_FAILED。
- cancel / timeout：handler MUST 中断，MUST NOT 静默悬挂。
- `batchParallelism` 超过 20：clamp 到 20，不报错。
- 最后元素未执行（abort）或失败（continue）：节点类型专属绑定（api_response / llm_result / llm_completion）为 undefined，静默跳过，不报错。
- batch 模式下 LLM_ROUTER 不产出 diagnostic（budget/compression 诊断逐 element 产生，不汇聚到 batch 级；单次模式的 diagnostic 行为不变）。

**需求类别**：功能性需求

**适用范围**：`FN-9.1 执行工作流`

#### Scenario: Single Call (No BatchConfig)
- **WHEN** 节点未提供 batchConfig
- **THEN** handler MUST 执行单次调用
- **AND** 输出各节点类型既有输出
- **AND** MUST NOT 产出 batch_results/failed_items

#### Scenario: BatchConfig In Node Level
- **WHEN** 节点在节点级提供 batchConfig（非 inputs 内）
- **THEN** loader MUST 将 batch_config 映射为 batchConfig
- **AND** handler MUST 从 context.node.batchConfig 读取配置
- **AND** inputs 中 MUST NOT 包含 batch 配置字段

#### Scenario: BatchConfig Normalized For All Node Types
- **WHEN** KNOWLEDGE_SEARCH 或 LLM_ROUTER 节点在节点级提供 batchConfig
- **THEN** loader MUST 将 batch_config 映射为 batchConfig
- **AND** MUST NOT 因节点类型不是 RESTFUL 而静默丢弃 batchConfig
- **AND** handler MUST 从 context.node.batchConfig 读取到归一化后的配置

#### Scenario: Restful Batch Serial Mode
- **WHEN** RESTFUL 节点提供 batchConfig.batchInputDataItem 且 batchMode: "serial"
- **THEN** handler MUST 将输入按 batchSize 分批，串行逐批调用 capabilityInvocation
- **AND** 输出 batch_results（合并后结果数组）、failed_items、api_response（最后元素结果）

#### Scenario: Restful Batch Parallel Mode
- **WHEN** RESTFUL 节点提供 batchConfig.batchInputDataItem 且 batchMode: "parallel" 且 batchParallelism: 3
- **THEN** handler MUST 以最大并发 3 执行批次调用

#### Scenario: LlmRouter Batch Parallel Mode
- **WHEN** LLM_ROUTER 节点提供 batchConfig.batchInputDataItem 且 batchMode: "parallel"
- **THEN** handler MUST 以 modelInvocation.complete（非流式）并发执行每个 element
- **AND** MUST NOT 调用 shouldUseStreamMode
- **AND** modelConfig MUST 只解析一次，所有 element 共享
- **AND** 输出 batch_results、failed_items、llm_result 和 llm_completion（最后元素结果）

#### Scenario: KnowledgeSearch Batch Parallel Mode
- **WHEN** KNOWLEDGE_SEARCH 节点提供 batchConfig.batchInputDataItem 且 batchMode: "parallel"
- **THEN** handler MUST 以 retrieveKnowledge 并发执行每个 element
- **AND** 每个 element 的 query 通过 batchElementVariable 注入解析
- **AND** 输出 batch_results、failed_items

#### Scenario: KnowledgeSearch Batch Empty Result As Failed Item
- **GIVEN** KNOWLEDGE_SEARCH 节点 batch 模式，某个 element 检索结果为空
- **WHEN** 该 element 执行完成
- **THEN** handler MUST 将该 element 记录为 failed_item
- **AND** MUST NOT throw WORKFLOW_KNOWLEDGE_SEARCH_EMPTY
- **AND** 若 batchFailStrategy 为 "continue" 则继续执行其余 element

#### Scenario: Batch Fail Continue
- **GIVEN** batchFailStrategy: "continue"，批次中第 2 批失败
- **WHEN** 节点执行
- **THEN** handler MUST 继续执行第 3 批
- **AND** batch_results MUST 包含成功结果，failed_items MUST 包含第 2 批失败项
- **AND** 节点状态 MUST 为 NODE_COMPLETED

#### Scenario: Batch Fail Abort
- **GIVEN** batchFailStrategy: "abort"，批次中第 2 批失败
- **WHEN** 节点执行
- **THEN** handler MUST NOT 执行第 3 批
- **AND** batch_results MUST 包含第 1 批结果，failed_items MUST 包含第 2 批失败项
- **AND** 节点状态 MUST 为 NODE_FAILED

#### Scenario: Batch Result Merge Append
- **GIVEN** batchResultMerge: "append"，3 批次
- **WHEN** 节点执行完成
- **THEN** batch_results MUST 为 List，包含成功结果按原始元素下标顺序追加

#### Scenario: Batch Result Merge Map
- **WHEN** batchResultMerge: "map"
- **THEN** batch_results MUST 为 Map（按批次元素 key 合并），而非 List

#### Scenario: Restful Batch ApiResponse Binds Last Element
- **GIVEN** RESTFUL 节点 batchInputDataItem 含 3 个元素，全部成功
- **WHEN** 节点执行完成
- **THEN** api_response MUST 等于第 3 个元素的调用结果（按下标，不按完成时序）

#### Scenario: Batch Last Element Binding Undefined On Abort
- **GIVEN** batchFailStrategy: "abort"，第 2 批失败，共 3 批
- **WHEN** 节点执行
- **THEN** api_response / llm_result MUST 为 undefined（第 3 个元素未执行）
- **AND** MUST NOT 报错

#### Scenario: Batch Input Invalid Rejected
- **GIVEN** 节点声明 batchConfig 但 batchInputDataItem 缺失或解析后不是数组
- **WHEN** 节点执行
- **THEN** handler MUST 报 validation error
- **AND** reason code MUST 为 WORKFLOW_BATCH_INPUT_INVALID
- **AND** MUST NOT 静默降级为单次调用

#### Scenario: Non-LlmRouter Llm Family Node Rejects Batch
- **GIVEN** INTENT_RECOGNITION 节点声明了 batchConfig
- **WHEN** 节点执行
- **THEN** handler MUST 报错
- **AND** error code MUST 为 WORKFLOW_BATCH_UNSUPPORTED_NODE_TYPE
- **AND** MUST NOT 静默降级为单次调用

#### Scenario: Restful Batch And LongApi Are Orthogonal
- **WHEN** RESTFUL 节点同时定义 batchConfig 和 is_long_api: true
- **THEN** 两者 MUST 被视为正交能力，不报互斥错误
- **AND** batch 优先于 is_long_api

#### Scenario: Batch Parallelism Clamp
- **GIVEN** batchParallelism: 50
- **WHEN** 节点执行
- **THEN** 实际最大并发批次 MUST 为 20，不报错

#### Scenario: Batch Per-Element Variable Isolation
- **GIVEN** batch 模式，batchElementVariable: "sub_question"，batchInputDataItem 含 3 个子问题
- **WHEN** 并发执行 element
- **THEN** 每个 element MUST 只看到自己的 sub_question 值
- **AND** MUST NOT 看到其他 element 的 sub_question 值
- **AND** element 之间 MUST NOT 通过共享变量泄漏中间结果

### Requirement: LoopBatchMutex

spec MUST 明确同一节点上 `loopConfig` 与 `batchConfig` 互斥：
- loopConfig：单节点或多节点间的串行循环编排，由 loop-control change 定义。
- batchConfig：仅 restful(api-invoke) 节点支持的批量 API 调用配置。
- 两者语义重叠（均对一组输入做迭代/分批），同节点同时声明会导致循环体执行与 batch 执行交织歧义。

同一 recipe 可以在不同节点分别使用 loop 和 batch。同一节点 MUST NOT 同时声明 loopConfig 和 batchConfig。

触发机制：loader 在 normalizeNodeDefinition 阶段检测同一节点是否同时存在 `loop_config`/`loopConfig` 与 `batch_config`/`batchConfig`。

失败与降级：同时声明时 loader MUST 拒绝加载 recipe，reason code `WORKFLOW_BATCH_LOOP_CONFLICT`，不得静默忽略任一配置。

#### Scenario: Loop And Batch On Same Node Rejected
- **WHEN** 同一节点同时声明 loopConfig 和 batchConfig
- **THEN** loader MUST 拒绝加载 recipe
- **AND** reason code MUST 为 WORKFLOW_BATCH_LOOP_CONFLICT

#### Scenario: Loop And Batch On Different Nodes Allowed
- **GIVEN** recipe 中节点 A 声明 loopConfig，节点 B（restful）声明 batchConfig
- **WHEN** loader 加载 recipe
- **THEN** loader MUST 接受，两者独立执行互不影响

### Requirement: RecipeName Constraint

`RecipeDefinition.recipeName` MUST 仅限制为 `Type.String({ maxLength: 255 })`，MUST NOT 施加 pattern 约束（如 `^[A-Za-z0-9._:-]+$`）或 minLength 约束。此约束修正 v1 将 `recipeName` 复用 `WorkflowSafeIdSchema` 的问题——`WorkflowSafeIdSchema` 同时服务 node-id 标识符，其 pattern 和 128 上限不应传递给 recipeName。maxLength 255 与 1.0 DSL 规范一致（1.0: Recipe 名称最长 255）。

loader MUST 接受不满足 `WorkflowSafeIdSchema` pattern 但长度不超过 255 的 recipeName 值。

#### Scenario: Free-form RecipeName Accepted

- **WHEN** recipe 定义 `recipeName: "alarm diagnosis v2"`
- **THEN** loader MUST 接受该 recipe
- **AND** MUST NOT 因 pattern 不匹配而拒绝

#### Scenario: RecipeName Length Exceeded

- **WHEN** recipe 定义 `recipeName` 长度超过 255 字符
- **THEN** loader MUST 拒绝该 recipe

#### Scenario: RecipeName Distinct From NodeId

- **GIVEN** `WorkflowSafeIdSchema` 仍用于 node-id 和其他结构化标识符
- **WHEN** contract schema 定义 `RecipeDefinition.recipeName`
- **THEN** `recipeName` MUST 使用独立 schema，MUST NOT 复用 `WorkflowSafeIdSchema`

### Requirement: RuntimeConfig

TS 后端 MUST 在 `agent-contracts/core` 定义 `RuntimeConfigSchema`，承载流程级执行器策略。

`RuntimeConfig` MUST 包含可选字段：
- `timeout?: number`（秒，>0）
- `incremental?: boolean`
- `persistence?: { checkpoint?: boolean }`
- `defaultRetry?: RetryPolicy`
- `controlPolicy?: ControlPolicy`

`RuntimeConfig` MUST NOT 包含 `profile` 和 `resourcePolicy`（延期）。

#### Scenario: Timeout In Seconds
- **WHEN** recipe 定义 `runtime.timeout: 3600`
- **THEN** 解析结果 `RuntimeConfig.timeout` MUST 为 `3600`（秒）
- **AND** MUST NOT 解释为毫秒

#### Scenario: ControlPolicy Attached
- **WHEN** recipe 定义 `runtime.controlPolicy.resume`
- **THEN** 解析结果 MUST 符合 `ControlPolicy`

### Requirement: ControlPolicy

TS 后端 MUST 在 agent-contracts/core 定义 ControlPolicySchema，定义流程级外部取消回退策略。

ControlPolicy MUST 包含可选字段 cancel（Record of WorkflowSafeId to WorkflowBranchDef）与 cancelTimeout（秒，最小 1，未配置时不设额外超时）。

cancel MUST 复用 WorkflowBranchDef（含可选 condition），与 WorkflowNodeDef.next、WorkflowNodeDef.exception 完全同形同策。cancelTimeout 是 cancel 回退可选兜底超时，独立于 runtime.timeout，MUST NOT 复用整体 workflow 执行预算。未配置时回退 MUST 跟随回退节点自身 timeout/retry 默认逻辑。

ControlPolicy MUST NOT 包含 resume、modify、restart 入口（已废弃）。ControlPolicy MUST NOT 包含 strategy 枚举或 rollbackNode 字段（旧设计已废弃）。

未配置 controlPolicy.cancel 时 MUST 默认直接终止（不回退，兼容当前 INTERRUPTED 行为）。

condition 字段为预留能力，首版 MUST NOT 参与回退分支选择（当前无入口传入 variables）；首版 MUST 取 cancel 的第一个 entry 作为回退目标，MUST 允许多 entry 存在。

loader（recipe YAML 不可信边界）MUST 对 controlPolicy 做 runtime schema validation。旧字段（strategy、rollbackNode、resume、modify、restart）传入时 MUST 报错，不做兼容。新字段（cancel 为 Record、cancelTimeout 为正整数）MUST 校验类型。

#### Scenario: Cancel Configured With Rollback Target

- **WHEN** recipe 定义 runtime.controlPolicy.cancel 含 entry rollback_cleanup
- **THEN** 解析结果 ControlPolicy.cancel MUST 为 Record 含 key rollback_cleanup
- **AND** 每个 entry MUST 符合 WorkflowBranchDef（可选 condition）

#### Scenario: Cancel Timeout Configured

- **WHEN** recipe 定义 runtime.controlPolicy.cancelTimeout 为 30
- **THEN** 解析结果 ControlPolicy.cancelTimeout MUST 为 30（秒）
- **AND** MUST NOT 解释为毫秒

#### Scenario: Cancel Default Stop

- **WHEN** 未配置 controlPolicy.cancel
- **THEN** 外部取消时 MUST 默认直接终止（不回退）

#### Scenario: Cancel Reuses WorkflowBranchDef

- **WHEN** recipe 定义 runtime.controlPolicy.cancel.rollback_cleanup.condition 为空串
- **THEN** 解析结果 MUST 符合 WorkflowBranchDef（空串合法）
- **AND** MUST 与 next/exception 的 condition 字段同形同策

#### Scenario: Legacy Fields Ignored By Loader

- **WHEN** recipe YAML 定义 control_policy.cancel.strategy 或 control_policy.cancel.rollbackNode（旧字段）
- **THEN** loader MUST 报错（旧字段不做兼容）
- **AND** MUST NOT 将旧字段值映射到新 schema

#### Scenario: Cancel Timeout Invalid Value Rejected

- **WHEN** recipe 定义 controlPolicy.cancelTimeout 为非整数或小于 1
- **THEN** runtime schema validation MUST 拒绝

#### Scenario: Cancel Entry Not Record Rejected

- **WHEN** recipe 定义 controlPolicy.cancel 为非 Record 类型（如字符串或数组）
- **THEN** runtime schema validation MUST 拒绝

#### Scenario: Legacy Strategy Enum Rejected

- **WHEN** recipe 定义 runtime.controlPolicy.cancel.strategy
- **THEN** schema 校验 MUST 拒绝（additionalProperties false）
- **AND** MUST NOT 出现 strategy、rollbackNode、resume、modify、restart 字段

### Requirement: RetryPolicy

TS 后端 MUST 定义 `RetryPolicySchema`，结构化重试策略。

`RetryPolicy` MUST 包含可选字段：
- `maxAttempts?: number`（>=0）
- `backoff?: "fixed" | "exponential"`
- `delay?: number`（>=0，秒）

#### Scenario: Structured Retry
- **WHEN** 节点定义 `retry: { maxAttempts: 3, backoff: "exponential", delay: 100 }`
- **THEN** 解析结果 MUST 符合 `RetryPolicy`
- **AND** `delay` MUST 为秒

### Requirement: InputDef

TS 后端 MUST 定义 `InputDefSchema`，显式输入契约。

`InputDef` MUST 包含：
- `type: "string" | "number" | "boolean" | "array" | "object"`

`InputDef` MAY 包含：
- `required?: boolean`
- `default?: unknown`
- `description?: string`

#### Scenario: Required Input
- **WHEN** `inputs.alarm_ids.required = true`
- **THEN** recipe 加载时 MUST 校验该输入存在

### Requirement: Presentation

TS 后端 MUST 定义 `NodePresentationSchema` 和 `RecipePresentationSchema`。

`NodePresentation` MAY 包含：
- `outputParser?: object`
- `recommends?: string[]`
- `tag?: string`

`RecipePresentation` MAY 包含：
- `recommends?: { enabled?: boolean; topN?: number }`

#### Scenario: OutputParser normalization
- **WHEN** 输入节点在顶层声明 `outputParser`
- **THEN** loader MAY 将其规范化为 `presentation.outputParser`

### Requirement: NodeType Alias Compat

loader MUST 在 `normalizeNodeType` 中接受以下别名并归一化到内部 enum：

- `tool-invoke` 归一化为 `TOOL`
- `api-invoke` 归一化为 `RESTFUL`
- `suspend` 归一化为 `INTERRUPT`

#### Scenario: Alias Normalization
- **WHEN** recipe 节点 `type` 为 `api-invoke`
- **THEN** loader MUST 归一化为 `RESTFUL`
- **AND** contract `WorkflowNodeType` enum MUST NOT 新增别名值

### Requirement: DeprecatedNodeWarning

loader MUST 对以下节点类型产出 deprecation warning：
- AGENT
- TOOL_CHOICE
- DATA_ANALYSIS
- TOOL（原 tool-invoke）

warning MUST 使用 structured log（runtimeLogger.warn），MUST NOT 阻断 recipe 加载或节点执行。handler MUST 保持现有执行能力不变。

#### Scenario: Deprecated Node Warning
- **WHEN** recipe 节点 type 归一化后为 AGENT
- **THEN** loader MUST 产出 structured warning log
- **AND** recipe 加载 MUST NOT 被阻断
- **AND** handler MUST 继续执行

#### Scenario: Non-Deprecated Node No Warning
- **WHEN** recipe 节点 type 归一化后为 RESTFUL
- **THEN** loader MUST NOT 产出 deprecation warning

### Requirement: UserCheckEnhancedInput

user-check 节点输入 MUST 支持 action_type 字段（必填），支持三种交互模式。

inputs MUST 包含：
- action_type: "choice" | "input" | "confirm"（必填）
- options?: Array<{ label: string; value: string }>（action_type=choice 时必填且非空）
- tips?: string（提示文本）
- timeout?: number（秒，可选）
- timeout_result?: string（超时 fallback 值，可选，缺省为空字符串）

outputs MUST 产出：
- user_check_result：用户选择的 value（choice）、"true"/"false"（confirm）、超时 fallback 值
- user_check_input：用户输入文本（仅 action_type=input 时产出）

#### Scenario: Choice Mode
- **WHEN** user-check 节点定义 action_type: "choice" 且 options: [{ label: "执行", value: "execute" }]
- **THEN** handler MUST 通过 pendingInput 请求用户选择
- **AND** 输出 user_check_result MUST 为用户选择的 value

#### Scenario: Input Mode
- **WHEN** user-check 节点定义 action_type: "input"
- **THEN** handler MUST 通过 pendingInput 请求用户输入文本
- **AND** 输出 user_check_input MUST 为用户输入文本

#### Scenario: Confirm Mode
- **WHEN** user-check 节点定义 action_type: "confirm"
- **THEN** handler MUST 通过 pendingInput 请求用户确认
- **AND** 输出 user_check_result MUST 为 "true" 或 "false"

#### Scenario: Timeout Fallback
- **WHEN** user-check 节点定义 timeout: 30 和 timeout_result: "cancel"
- **AND** 用户未在 30s 内响应
- **THEN** 输出 user_check_result MUST 为 "cancel"

#### Scenario: Choice Without Options Error
- **WHEN** user-check 节点定义 action_type: "choice" 但未提供 options
- **THEN** handler MUST 抛出 invalidNodeInput 错误

### Requirement: RestfulBatchConfig

restful(api-invoke) 节点 MUST 通过节点级 `batchConfig` 子配置承载分批 API 调用能力。`batchConfig` 是 `WorkflowNodeDef` 的顶层可选字段，与 `loopConfig` 平行；batch 配置字段 MUST NOT 放在 `inputs` 中。loader MUST 将 snake_case `batch_config` 映射到 camelCase `batchConfig`。未提供 `batchConfig` 时为单次调用（现有行为不变）。

batchConfig 字段：
- batchInputDataItem: array（启用 batch 时必填，提供时启用 batch 模式）
- batchElementVariable?: string（默认 "element"；API 参数模板中通过 `${<batchElementVariable>}` 引用当前批次元素）
- batchSize?: int（默认 10，>0；每批参数量上限）
- batchMode?: "serial" | "parallel"（默认 "serial"；serial=串行逐批调用，parallel=多批并行调用）
- batchFailStrategy?: "continue" | "abort"（默认 "continue"；continue=部分批次失败时继续，abort=任一批次失败立即终止）
- batchParallelism?: int（默认 5，范围 [1,20]，仅 batchMode=parallel 时生效）
- batchResultMerge?: "append" | "map"（默认 "append"；append=所有批次结果追加为 List，map=按批次元素 key 合并为 Map）

触发机制：restful 节点 ready 且 scheduler 触发 handler 时，handler 入口先检测 `batchConfig` 是否存在；存在且 `batchInputDataItem` 为非空数组时进入 batch 分支，否则为单次调用。batch 优先于 is_long_api。

输入与前置条件：
- 节点 `inputs` 中的 `api_name` 已解析且非空
- `batchConfig.batchInputDataItem` 已解析为非空数组
- secret reference 在分批前完成解析
- 可信 owner scope / agent scope / AbortSignal 可用
- 已注册且允许调用的 capability invocation 边界可用

输出与副作用：
- batch 模式产出 `batch_results`（合并后结果）、`failed_items`（失败项）、`api_response`（最后一个元素的调用结果，按下标不按完成时序）、`invocation_trace`
- 单次模式产出 `api_response`、`invocation_trace`，MUST NOT 产出 batch_results/failed_items
- 每个批次 side effect MUST 与 executionId / nodeId / 批次序号可追溯
- batch_results / api_response / failed_items 只保留安全结果与 safe error summary，MUST NOT 保留 secret 明文

核心判断逻辑（handler 执行步骤；互斥校验在 loader 阶段完成，见 LoopBatchMutex，handler 执行时 recipe 已加载通过）：
1. 读取节点 `batchConfig`；不存在时走单次调用分支。
2. 校验 `batchInputDataItem` 已解析且为非空数组；否则报 validation error（reason code `WORKFLOW_BATCH_INPUT_INVALID`），不得静默降级。
3. 将 `batchInputDataItem` 按 `batchSize` 分批。
4. 每批构造 invocation args：baseArgs（`inputs` 去除 `api_name` 后的纯 API 调用参数）+ `{ [batchElementVariable]: 当前批次元素 }`。
5. 按 `batchMode` 调度：serial 逐批串行，parallel 按 `batchParallelism` 限流并发。
6. 按 `batchFailStrategy` 处理失败：continue 记录失败项继续，abort 记录失败项后停止后续批次。
7. 按 `batchResultMerge` 合并成功结果：append 为 List（按原始元素下标顺序），map 为 Map（按批次元素 key）。
8. `api_response` 绑定为 `results[items.length - 1]`（最后一个元素的结果；若该元素未执行或失败则为 undefined，静默跳过）。

状态 / 产物契约：
- `batch_results`：合并后结果，生命周期与节点输出变量一致，由下游节点 `${batch_results}` 消费。
- `failed_items`：失败项数组，每项含 index/item/error{code,message}，由下游节点 `${failed_items}` 消费。
- `api_response`：最后一个元素的调用结果，供下游复用单次模式绑定的场景。
- `invocation_trace`：调用诊断，可追溯。
- secret 不得进入以上任何产物。

流程接入：
- 上游：gateway / llm / knowledge / interaction 节点产出 `batchInputDataItem` 引用的数组变量。
- 下游：任意消费 safe output 的节点。
- batch 仅在 restful handler 内生效，不新增 recipe registry / dispatch path / scheduler / pending store。

失败与降级：
- `batchConfig` 存在但 `batchInputDataItem` 缺失或解析后不是非空数组：报 validation error（reason code `WORKFLOW_BATCH_INPUT_INVALID`），MUST NOT 静默降级为单次调用。声明 batchConfig 即表达 batch 意图，输入不满足是配置错误而非未配 batch。
- `batchFailStrategy: "continue"` 批次失败：记录 failed_items，继续执行其余批次，节点状态 NODE_COMPLETED。
- `batchFailStrategy: "abort"` 批次失败：记录 failed_items，停止后续批次，节点状态 NODE_FAILED。
- cancel / timeout：handler MUST 中断，MUST NOT 静默悬挂。
- `batchParallelism` 超过 20：clamp 到 20，不报错。
- 最后元素未执行（abort）或失败（continue）：api_response 为 undefined，静默跳过，不报错。

#### Scenario: Single Call (No BatchConfig)
- **WHEN** restful 节点未提供 batchConfig
- **THEN** handler MUST 执行单次 API 调用
- **AND** 输出 api_response
- **AND** MUST NOT 产出 batch_results/failed_items

#### Scenario: BatchConfig In Node Level
- **WHEN** restful 节点在节点级提供 batchConfig（非 inputs 内）
- **THEN** loader MUST 将 batch_config 映射为 batchConfig
- **AND** handler MUST 从 context.node.batchConfig 读取配置
- **AND** inputs 中 MUST NOT 包含 batch 配置字段

#### Scenario: Batch Serial Mode
- **WHEN** restful 节点提供 batchConfig.batchInputDataItem 且 batchMode: "serial"
- **THEN** handler MUST 将输入按 batchSize 分批，串行逐批调用
- **AND** 输出 batch_results（合并后结果数组）、failed_items、api_response（最后元素结果）

#### Scenario: Batch Parallel Mode
- **WHEN** restful 节点提供 batchConfig.batchInputDataItem 且 batchMode: "parallel" 且 batchParallelism: 3
- **THEN** handler MUST 以最大并发 3 执行批次调用

#### Scenario: Batch Fail Continue
- **GIVEN** batchFailStrategy: "continue"，批次中第 2 批失败
- **WHEN** 节点执行
- **THEN** handler MUST 继续执行第 3 批
- **AND** batch_results MUST 包含成功结果，failed_items MUST 包含第 2 批失败项
- **AND** 节点状态 MUST 为 NODE_COMPLETED

#### Scenario: Batch Fail Abort
- **GIVEN** batchFailStrategy: "abort"，批次中第 2 批失败
- **WHEN** 节点执行
- **THEN** handler MUST NOT 执行第 3 批
- **AND** batch_results MUST 包含第 1 批结果，failed_items MUST 包含第 2 批失败项
- **AND** 节点状态 MUST 为 NODE_FAILED

#### Scenario: Batch Result Merge Append
- **GIVEN** batchResultMerge: "append"，3 批次
- **WHEN** 节点执行完成
- **THEN** batch_results MUST 为 List，包含成功结果按原始元素下标顺序追加

#### Scenario: Batch Result Merge Map
- **WHEN** batchResultMerge: "map"
- **THEN** batch_results MUST 为 Map（按批次元素 key 合并），而非 List

#### Scenario: Batch ApiResponse Binds Last Element
- **GIVEN** batchInputDataItem 含 3 个元素，全部成功
- **WHEN** 节点执行完成
- **THEN** api_response MUST 等于第 3 个元素的调用结果（按下标，不按完成时序）

#### Scenario: Batch ApiResponse Undefined On Abort
- **GIVEN** batchFailStrategy: "abort"，第 2 批失败，共 3 批
- **WHEN** 节点执行
- **THEN** api_response MUST 为 undefined（第 3 个元素未执行）
- **AND** MUST NOT 报错

#### Scenario: Batch Input Invalid Rejected
- **GIVEN** restful 节点声明 batchConfig 但 batchInputDataItem 缺失或解析后不是数组
- **WHEN** 节点执行
- **THEN** handler MUST 报 validation error
- **AND** reason code MUST 为 WORKFLOW_BATCH_INPUT_INVALID
- **AND** MUST NOT 静默降级为单次调用

#### Scenario: Batch And LongApi Are Orthogonal
- **WHEN** 节点同时定义 batchConfig 和 is_long_api: true
- **THEN** 两者 MUST 被视为正交能力，不报互斥错误
- **AND** batch 优先于 is_long_api（batch 分支内每批调用是否轮询由后续 change 承接）

#### Scenario: Batch Parallelism Clamp
- **GIVEN** batchParallelism: 50
- **WHEN** 节点执行
- **THEN** 实际最大并发批次 MUST 为 20，不报错

### Requirement: RecipeDefinition 提供可选本地化展示名称

`RecipeDefinition` MUST 支持 optional、非 `null` 的 `locales`，其结构和校验边界 MUST 与 `CapabilityDescriptor.locales` 相同。字段缺失时 Recipe MUST 继续按 required `displayName` 保持合法；字段非法时 Recipe schema validation MUST 失败，并 MUST 进入既有 invalid Recipe skip path。

**需求类别**：功能性需求

Workflow Capability Provider MUST 把 `RecipeDefinition.displayName` 作为 Workflow descriptor 的稳定 `displayName`，并 MUST 把合法 `RecipeDefinition.locales` 逐值投影到同一 descriptor。Recipe 的稳定或本地化名称 MUST NOT 改变 `recipeName`、Workflow identity、routing、graph、inputs、execution、retry、timeout、节点层级或结果。

#### Scenario: Workflow Recipe 提供中英文名称

- **WHEN** 合法 Recipe 提供稳定 `displayName` 以及 `zh-CN`、`en-US` 本地化名称
- **THEN** Workflow descriptor MUST 逐值保留稳定和本地化名称
- **AND** Workflow 的选择和执行 MUST 继续使用 `recipeName`

#### Scenario: Workflow Recipe 未提供本地化名称

- **WHEN** 合法 Recipe 不包含 `locales`
- **THEN** Recipe MUST 继续通过 schema validation
- **AND** Workflow descriptor MUST 使用 Recipe 的稳定 `displayName`

#### Scenario: Workflow Recipe 名称非法

- **WHEN** Recipe 的 `locales` 不满足统一结构、locale grammar 或文本约束
- **THEN** Recipe schema validation MUST 失败
- **AND** loader MUST 跳过该 Recipe，MUST NOT 发布部分名称或 descriptor
