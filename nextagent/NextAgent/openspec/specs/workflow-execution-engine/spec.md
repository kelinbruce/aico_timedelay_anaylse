workflow-execution-engine Specification

## Purpose
定义工作流执行引擎的单实例调度、状态推进、恢复与终止结果契约，使工作流在受控运行时中保持一致执行与可诊断失败语义。
## Requirements
### Requirement: Single-Instance Workflow Execution

engine MUST 实现单实例内存态 `WorkflowExecutionService.execute()`。

#### Scenario: Sequential Execution
- **WHEN** recipe graph 为线性路径
- **THEN** engine MUST 按 `start -> next -> end` 顺序执行

### Requirement: Conditional Branching

engine MUST 支持消费 gateway control semantics 提供的最小条件分支能力。

#### Scenario: Exclusive Branch
- **WHEN** gateway handler 为当前节点产出条件分支选择结果
- **THEN** engine MUST 按该结果推进下游节点

### Requirement: In-Process Parallel Gateway

如果首版支持 gateway 并发控制，engine MUST 将其限制为单进程内受控并发语义，且 MUST NOT 引入分布式 owner claim、跨实例 join barrier 或恢复语义。

#### Scenario: Parallel Fork Join
- **WHEN** gateway handler 为当前节点产出并发 fork/join 控制信息
- **THEN** engine MUST 在单进程内推进分支
- **AND** join 后再继续下游

### Requirement: Gateway Node Ownership Boundary

execution-engine MUST NOT 成为 `start-event`、`end-event`、`parallel-gateway`、`exclusive-gateway` 的具体节点语义 owner。

#### Scenario: Gateway Semantics Owner
- **WHEN** workflow 系统需要定义 `start/end/parallel/exclusive` 的节点语义或 handler 行为
- **THEN** `start-event`、`end-event`、`exclusive-gateway` 语义 MUST 由 `gateway-nodes` change 承接
- **AND** `parallel-gateway` 语义 MUST 由独立的 `workflow-parallel-gateway` change 承接
- **AND** execution-engine 只消费它们产出的控制语义

### Requirement: Interrupt

engine MUST 通过 AbortSignal 响应中断。当 AbortSignal 被触发时，engine MUST 停止继续启动正向节点，并返回 INTERRUPTED。

例外：若 recipe 配置了 runtime.controlPolicy.cancel，engine 在 abort 后 MAY 启动 cancel 回退节点（补偿动作），回退节点使用独立子信号执行，不继承已 abort 的父 signal。回退完成后仍返回 INTERRUPTED。未配置 controlPolicy.cancel 时，engine MUST NOT 在 abort 后启动任何节点。

#### Scenario: Abort Without Cancel Policy

- **WHEN** AbortSignal 被触发且 recipe 未配置 controlPolicy.cancel
- **THEN** engine MUST 停止启动新节点
- **AND** MUST 返回 INTERRUPTED

#### Scenario: Abort With Cancel Policy Allows Rollback Nodes

- **WHEN** AbortSignal 被触发且 recipe 配置了 controlPolicy.cancel
- **THEN** engine MAY 启动 cancel 回退节点（使用独立子信号）
- **AND** 回退完成后 MUST 返回 INTERRUPTED

### Requirement: Event Emission

engine MUST 发出安全的 `WorkflowExecutionEvent`。

#### Scenario: Safe Event Emission
- **WHEN** 节点生命周期变更
- **THEN** engine MUST 发出对应 event
- **AND** event MUST NOT 包含 prompt、raw model output、raw capability result、secret 或 path

#### Scenario: Runtime-Safe Visible Delta Bridging
- **WHEN** 节点 handler 发出安全的可见文本或 thinking 增量
- **THEN** engine MUST 通过 `WorkflowExecutionObserver` 发出对应 `WorkflowExecutionEvent`
- **AND** engine MUST 保留 workflow-layer safe delta vocabulary，而不是直接写 runtime timeline event
- **AND** 上层 orchestrator MAY 将这些 event 投影为 runtime stream event

### Requirement: Workflow Checkpoint Persistence

当 `runtime.persistence.checkpoint` 为 `true` 时，engine MUST 在每个非 gateway 节点完成后持久化 checkpoint。

- checkpoint payload MUST 包含 `nodeId`、`nodeType`、`recipeName`、`variables`，循环内 MUST 额外包含 `loopContext`。
- checkpoint MUST 通过 engine 注入的 `saveCheckpoint` 回调写入（由 agent-core 桥接到 runtime `runState.saveCheckpoint`）。
- checkpoint 写入失败 MUST NOT 阻塞流程（记录 `WORKFLOW_CHECKPOINT_WRITE_FAILED` 事件后继续）。
- gateway 节点（START/END/CONDITION/PARALLEL）MUST NOT 写 checkpoint。
- checkpoint 写入 MUST 是 idempotent（按 runId + nodeId + iteration 锚点）。

**触发机制：**
- 每个非 gateway 节点执行完成后、transition 求值前触发。
- 同步写入（不阻塞流程但等待写入完成或失败后再继续 transition）。

**输入与前置条件：**
- `recipe.runtime.persistence.checkpoint === true`
- engine 已注入 `saveCheckpoint` 回调
- 节点已执行完成（有 `outputVariables`）

**输出与副作用：**
- checkpoint 记录持久化（通过 runtime `CheckpointStoreGateway`）
- `WORKFLOW_CHECKPOINT_WRITE_FAILED` 事件（仅写入失败时）

**失败与降级：**
- 写入失败 → 记录事件，流程继续，不得静默吞错

**核心判断逻辑：**
1. 节点执行完成（有 outputVariables）
2. 判断节点是否为 gateway 类型（START/END/CONDITION/PARALLEL）→ 是则跳过
3. 判断
ecipe.runtime.persistence.checkpoint 是否为 	rue → 否则跳过
4. 构造 WorkflowExecutionResumeState（含 loopContext 若在循环内）
5. 调用
untime.saveCheckpoint 回调
6. 写入失败 → 记录 WORKFLOW_CHECKPOINT_WRITE_FAILED 事件，流程继续

**状态 / 产物契约：**
- checkpoint 记录持久化到 CheckpointStoreGateway，payload 为序列化的 WorkflowExecutionResumeState + loopContext，存储在 CheckpointRecord.flowVariables 中。
- 生命周期：与 request run 绑定，run 终态提交后可清理（由 runtime 管理）。
- 消费方：resume 恢复时由 parseWorkflowResumeState 读取。
- 可追溯性：checkpoint 含 executionId /
odeId /
ecipeName，可追溯到具体节点。
- 安全限制：checkpoint variables 不含 secret 明文（secret 仅在调用边界内解引用）。

**流程接入：**
- 上游：executePath 的节点执行完成后、transition 求值前。
- 下游：resume 恢复时消费 checkpoint，从
odeId 继续。
#### Scenario: Checkpoint Written After Node

- **WHEN** `persistence.checkpoint` 为 `true` 且非 gateway 节点 A 完成
- **THEN** engine MUST 调用 `saveCheckpoint`，payload 含 A 的 nodeId、nodeType 和当前 variables

#### Scenario: Checkpoint Failure NonBlocking

- **WHEN** `saveCheckpoint` 抛错
- **THEN** engine MUST 记录 `WORKFLOW_CHECKPOINT_WRITE_FAILED` 事件
- **AND** 流程 MUST 继续执行
- **AND** 节点状态 MUST 保持 NODE_COMPLETED

#### Scenario: Gateway Node No Checkpoint

- **WHEN** `persistence.checkpoint` 为 `true` 且节点类型为 START/END/CONDITION/PARALLEL
- **THEN** engine MUST NOT 写入 checkpoint

### Requirement: Resume From Checkpoint

`execute` 消费 `request.resumeState` 时 MUST 从 checkpoint 恢复执行。

- MUST 从 `resumeState.nodeId` 继续执行。
- MUST 使用 `resumeState.variables` 作为初始变量。
- MUST 校验 `resumeState.recipeName` 与当前 recipe 一致，不一致时 MUST 抛 `WORKFLOW_RESUME_RECIPE_MISMATCH`。
- 当 `resumeState.loopContext` 存在时，MUST 恢复循环上下文（iteration、elementIndex、collectedResults）。

**输入与前置条件：**
- `request.resumeState` 非空
- `resumeState.recipeName` 与当前 recipe 一致

**输出与副作用：**
- 从 checkpoint 位置继续执行
- 循环上下文恢复

**失败与降级：**
- recipe 不匹配 → `WORKFLOW_RESUME_RECIPE_MISMATCH`，NODE_FAILED

**触发机制：**
- 由 execute 方法消费
equest.resumeState 触发。
- 位于 workflow execution 启动阶段，在
esolveRecipeDefinition 之后、executePath 之前。
- 同步执行。

**核心判断逻辑：**
1. 检查
equest.resumeState 是否存在 → 不存在则从
esolveEntryNodeId 正常启动
2. 校验
esumeState.recipeName 与当前 recipe 一致 → 不一致抛 WORKFLOW_RESUME_RECIPE_MISMATCH
3. 从
esumeState.nodeId 恢复执行位置
4. 使用
esumeState.variables 作为初始变量
5. 若
esumeState.loopContext 存在 → 恢复循环上下文（iteration/elementIndex/collectedResults），从循环头继续

**状态 / 产物契约：**
- resume 不产生新产物，消费既有 checkpoint 中的 WorkflowExecutionResumeState。
- loopContext 恢复循环状态后，后续 checkpoint 继续追加循环进度。
- 安全限制：resume variables 继承原 run 的 agent scope / owner scope，不得跨 scope 恢复。

**流程接入：**
- 上游：execute 方法入口，
equest.resumeState 来自 default-agent 的 executeRecipeRoute（从 context.flowVariables 读取）。
- 下游：executePath / executeLoopPath 从恢复位置继续执行。
#### Scenario: Resume Continues From Node

- **WHEN** `resumeState.nodeId` 为 `node-b` 且 recipe 一致
- **THEN** engine MUST 从 node-b 继续执行
- **AND** MUST 使用 resumeState.variables

#### Scenario: Resume Recipe Mismatch

- **WHEN** `resumeState.recipeName` 与当前 recipe 不一致
- **THEN** engine MUST 抛 `WORKFLOW_RESUME_RECIPE_MISMATCH`

#### Scenario: Resume With Loop Context

- **WHEN** `resumeState.loopContext` 存在且 `iteration` 为 2
- **THEN** engine MUST 从循环头节点继续
- **AND** MUST 恢复 iteration=2、elementIndex、collectedResults

#### Scenario: Resume Without Loop Context

- **WHEN** `resumeState.loopContext` 不存在且 `resumeState.nodeId` 为 `node-b`
- **THEN** engine MUST 从 node-b 正常继续（非循环路径）
- **AND** MUST NOT 进入 `executeLoopPath`

### Requirement: Engine Consumes Runtime Config

`InMemoryWorkflowExecutionService.execute()` MUST 消费 `RecipeDefinition.runtime`：

- `runtime.timeout` MUST 作为流程级超时，通过 scoped abort signal 作用于整个 `executePath`。
- `runtime.defaultRetry` MUST 作为节点重试默认值。
- 当 `runtime` 未定义时，MUST 回退到 v1 `recipe.timeoutMs`。

#### Scenario: Runtime Timeout Applied
- **WHEN** recipe 定义 `runtime.timeout: 60000`
- **THEN** engine MUST 在 60000ms 后中断执行
- **AND** 返回 status MUST 为 `INTERRUPTED`

#### Scenario: DefaultRetry Applied
- **WHEN** 节点未定义 `retry` 且 `runtime.defaultRetry.maxAttempts = 2`
- **THEN** engine MUST 对该节点最多重试 2 次

### Requirement: Node Retry Resolution

`parseRetryPolicy` MUST 按优先级解析节点重试：

1. 节点级 `retry`（结构化）
2. 节点级 `retryPolicy`（v1 opaque）
3. `runtime.defaultRetry`
4. `{ maxRetries: 0 }`

gateway 节点 MUST 始终使用 `{ maxRetries: 0 }`。

#### Scenario: Structured Retry Preferred
- **WHEN** 节点同时定义 `retry: { maxAttempts: 3 }` 和 `retryPolicy: { maxRetries: 1 }`
- **THEN** engine MUST 使用 `retry`，maxAttempts 为 3

### Requirement: Node Timeout Resolution

节点超时 MUST 按优先级解析：

1. 节点级 `timeout`（毫秒）
2. 节点级 `timeoutMs`（v1）
3. 无节点级超时

#### Scenario: Timeout Preferred Over TimeoutMs
- **WHEN** 节点同时定义 `timeout: 5000` 和 `timeoutMs: 3000`
- **THEN** engine MUST 使用 `timeout`（5000ms）

### Requirement: OnError Deprecated In Engine

`executeNode` 的 catch 路径 MUST NOT 调用 `resolveOnErrorAction`。节点级异常转移 MUST 统一走 `resolveErrorTransition`（`exception` 分支）。

#### Scenario: Exception Transition Used
- **WHEN** 节点执行失败且定义了 `exception`
- **THEN** engine MUST 走 `exception` 分支转移
- **AND** MUST NOT 消费 `onError`

### Requirement: ControlPolicy Resolution

engine MUST 解析 `runtime.controlPolicy`，但首版仅实现 `cancel` 和 `STOP` 语义：

- `controlPolicy.cancel.strategy` 为 `STOP` 或未配置 cancel 时，MUST 直接终止流程。
- `ROLLBACK_*` 策略的回滚执行由 `ControlPolicy Rollback Execution` requirement 承载。

#### Scenario: Cancel Stops Flow
- **WHEN** 流程被取消且 `controlPolicy.cancel` 未配置
- **THEN** engine MUST 终止流程，status 为 `INTERRUPTED`

### Requirement: DependsOn Validation

节点执行前 MUST 校验 `dependsOn` 引用的节点均已完成：

- 若 `dependsOn` 中某节点不在 `nodeResults` 或状态非 `NODE_COMPLETED`，MUST 抛 `WORKFLOW_DEPENDENCY_NOT_SATISFIED` SafeError。
- engine MUST NOT 实现并行 DAG 调度，`dependsOn` 仅做前置校验。

#### Scenario: Dependency Not Satisfied
- **WHEN** 节点 A 声明 `dependsOn: ["node-b"]` 且 node-b 未执行
- **THEN** engine MUST 抛 `WORKFLOW_DEPENDENCY_NOT_SATISFIED`

### Requirement: ControlPolicy Rollback Execution

`controlPolicy` 的 `ROLLBACK_*` 策略 MUST 在节点失败（retry 耗尽）时执行回滚。

- `STOP` MUST 终止流程，节点 NODE_FAILED。
- `CONTINUE` MUST 忽略失败，节点 NODE_SKIPPED，继续 next。
- `RESTART` MUST 从 START 重跑（清空 variables）。
- `ROLLBACK_THEN_CONTINUE` MUST 执行 `rollbackNode` 子路径，结果合并到 scope，从失败点继续。
- `ROLLBACK_THEN_RESTART` MUST 执行 `rollbackNode` 子路径，从 START 重跑。
- `ROLLBACK_THEN_STOP` MUST 执行 `rollbackNode` 子路径，终止。
- 回滚路径 MUST 通过 `executePath`（`stopBeforeNodeId` = 失败节点）执行。
- 回滚路径节点 MUST NOT 写 checkpoint。
- 回滚路径节点失败 MUST NOT 递归回滚，MUST 抛 `WORKFLOW_ROLLBACK_FAILED`。

**触发机制：**
- 节点执行失败且 retry 耗尽时触发。
- 同步执行回滚。

**输入与前置条件：**
- `recipe.runtime.controlPolicy` 已配置
- 节点失败（非 abort）

**输出与副作用：**
- 回滚节点 side effect 真实发生
- 回滚结果变量合并到 scope

**失败与降级：**
- 回滚节点失败 → `WORKFLOW_ROLLBACK_FAILED`，流程终止
- 无 `controlPolicy` → 默认 `STOP`（节点 NODE_FAILED，流程终止）

**核心判断逻辑：**
1. 节点执行失败且 retry 耗尽
2. 读取
ecipe.runtime.controlPolicy.cancel（首版仅 cancel 入口）
3. 若 controlPolicy 未配置 → 默认 STOP（终止流程）
4. 按 strategy 执行：
   - STOP → 节点 NODE_FAILED，流程终止
   - CONTINUE → 节点 NODE_SKIPPED，走 next
   - RESTART → 清空 variables，从 START 重跑
   - ROLLBACK_THEN_CONTINUE → 执行
ollbackNode 子路径（executePath stopBeforeNodeId=失败节点），合并结果，从失败点继续
   - ROLLBACK_THEN_RESTART → 执行
ollbackNode 子路径，从 START 重跑
   - ROLLBACK_THEN_STOP → 执行
ollbackNode 子路径，终止

**状态 / 产物契约：**
- 回滚节点产生的 outputVariables 合并到当前 scope，作为后续执行的变量。
- 回滚节点 side effect 真实发生，与 executionId /
odeId / 回滚标识可追溯。
- 回滚路径不写 checkpoint（回滚是补偿，非正向流程）。
- 安全限制：回滚节点继承原 run 的 agent scope / owner scope。

**流程接入：**
- 上游：executeNode 失败（retry 耗尽）。
- 下游：回滚完成后走 continue/restart/stop，由 executePath 继续或终止。
#### Scenario: Rollback Then Continue

- **WHEN** 节点失败且 `controlPolicy.cancel.strategy` 为 `ROLLBACK_THEN_CONTINUE`，`rollbackNode` 为 `rollback_a`
- **THEN** engine MUST 先执行 rollback_a 子路径
- **AND** 回滚结果变量 MUST 合并到 scope
- **AND** 然后从失败点继续

#### Scenario: Rollback Then Stop

- **WHEN** 节点失败且 `controlPolicy.cancel.strategy` 为 `ROLLBACK_THEN_STOP`，`rollbackNode` 为 `rollback_a`
- **THEN** engine MUST 执行 rollback_a 子路径
- **AND** 然后终止流程

#### Scenario: Rollback Node Failure

- **WHEN** 回滚节点 `rollback_a` 执行失败
- **THEN** engine MUST 抛 `WORKFLOW_ROLLBACK_FAILED`
- **AND** MUST NOT 递归回滚

#### Scenario: No ControlPolicy Defaults To Stop

- **WHEN** 节点失败且 `recipe.runtime.controlPolicy` 未配置
- **THEN** engine MUST 终止流程，节点 NODE_FAILED

### Requirement: Multi-Node Loop Execution

workflow engine MUST 支持多节点循环（loop），循环节点链按配置受控重复执行。

- 循环配置 MUST 放在循环尾节点的 `loopConfig` 上。
- 循环尾节点是循环锚点（不执行业务 handler）。engine MUST 在到达循环尾节点时（执行 handler 前）检测 `loopConfig`，委托 `executeLoopPath` 接管循环。
- `executeLoopPath` MUST 按 `loopCardinality`（固定次数）或 `loopInputDataItem`（数组遍历）或 `loopCompletionCondition`（条件求值）控制循环。
- 每轮 MUST 通过 `loopElementVariable` 注入当前元素到变量作用域。
- 每轮结果 MUST 按 `loopResultType`（List/Map）收集到 `loopResultVariable`。
- `loopTimeCycle` MUST 在每轮之间等待（可被 abort 中断）。
- 循环 MUST 有防死循环保护（上限 1000 次）。

**触发机制：**
- 循环尾节点执行完成后、transition 求值前触发。
- 同步执行循环（每轮内节点异步等待边界完成）。

**输入与前置条件：**
- 循环尾节点配置了 `loopConfig`
- `loopStartNode` 在 recipe 节点中存在
- `loopInputDataItem`（若配置）解析为数组

**输出与副作用：**
- 循环体节点每轮 side effect 真实发生
- 循环结果聚合到 `loopResultVariable`
- 循环完成后走循环尾节点的 `next`

**核心判断逻辑：**
1. 检测循环尾节点 `loopConfig`
2. 解析循环输入数据（若 `loopInputDataItem` 配置）
3. 每轮：注入元素 → 执行循环体（executePath 循环头到循环尾）→ 收集结果 → 等待间隔 → 求值结束条件
4. 循环结束：合并结果到 variables → 走循环尾节点 next

**状态 / 产物契约：**
- `loopContext`（iteration/elementIndex/collectedResults）MUST 写入 checkpoint，resume 时恢复
- 循环结果 MUST 可追溯到 executionId 和循环尾节点

**流程接入：**
- 上游：到达循环尾节点的正常节点遍历
- 下游：循环完成后走循环尾节点 next

**失败与降级：**
- `loopInputDataItem` 非数组 → `WORKFLOW_LOOP_INPUT_NOT_ARRAY`，NODE_FAILED
- `loopCardinality` > 1000 → loader 拒绝
- `loopCompletionCondition` 求值失败 → `WORKFLOW_LOOP_CONDITION_INVALID`，NODE_FAILED
- `loopStartNode` 不存在 → loader 拒绝
- 父 signal abort → 循环中断，INTERRUPTED

#### Scenario: Fixed Cardinality Loop

- **GIVEN** 循环尾节点配置 `loopCardinality: 3`，无 `loopInputDataItem`，无 `loopCompletionCondition`
- **WHEN** 循环执行
- **THEN** engine MUST 执行循环体 3 次
- **AND** 循环完成后走循环尾节点 next

#### Scenario: Data Driven Loop

- **GIVEN** 循环尾节点配置 `loopInputDataItem: ${input.alarm_ids}`（3 元素），`loopElementVariable: alarm_item`
- **WHEN** 循环执行
- **THEN** engine MUST 执行循环体 3 次
- **AND** 每轮 variables 中 `alarm_item` MUST 为当前元素

#### Scenario: Completion Condition Loop

- **GIVEN** 循环尾节点配置 `loopCompletionCondition: ${diagnosed == true}`
- **WHEN** 第 2 轮 variables 中 `diagnosed` 为 true
- **THEN** engine MUST 在第 2 轮结束后终止循环

#### Scenario: Loop Result List Merge

- **GIVEN** `loopResultType: List`，`loopResultVariable: LOOP_RESULT`，`loopResultValue: ${result.status}`
- **WHEN** 循环执行 3 轮
- **THEN** `LOOP_RESULT` MUST 为数组，含 3 个 `result.status` 值

#### Scenario: Loop Result Map Merge

- **GIVEN** `loopResultType: Map`，`loopResultKey: ${alarm_item.id}`，`loopResultValue: ${result.status}`
- **WHEN** 循环执行 3 轮
- **THEN** `LOOP_RESULT` MUST 为对象，key 取自元素 `id`，value 取自 `result.status`

#### Scenario: Loop Time Cycle Wait

- **GIVEN** `loopTimeCycle: 100`
- **WHEN** 每轮循环完成
- **THEN** engine MUST 等待 100ms 后再开始下一轮
- **AND** 等待期间 signal abort MUST 中断

#### Scenario: Loop Input Not Array

- **WHEN** `loopInputDataItem` 解析后不是数组
- **THEN** engine MUST 报 `WORKFLOW_LOOP_INPUT_NOT_ARRAY`，节点 NODE_FAILED

#### Scenario: Loop Dead Loop Protection

- **GIVEN** 无 `loopCardinality`、无 `loopInputDataItem`、无 `loopCompletionCondition`
- **WHEN** 循环执行
- **THEN** engine MUST 默认执行 1 次后结束

#### Scenario: Loop Context Checkpoint

- **GIVEN** `persistence.checkpoint: true`，循环内节点完成
- **WHEN** checkpoint 写入
- **THEN** payload MUST 含 `loopContext`（iteration、elementIndex、collectedResults）

#### Scenario: YAML Snake Case Field Loading

- **GIVEN** recipe YAML 中循环尾节点使用 snake_case 字段（`loop_config`/`loop_cardinality`/`loop_input_data_item` 等）
- **WHEN** loader 加载 recipe
- **THEN** loader MUST 将 snake_case 字段 normalize 为 camelCase（`loopConfig`/`loopCardinality`/`loopInputDataItem`）
- **AND** recipe MUST 通过 AJV 校验
#### Scenario: Loop Resume

- **GIVEN** 循环在第 2 轮中断，`resumeState.loopContext.iteration` 为 2
- **WHEN** resume 恢复
- **THEN** engine MUST 从循环头继续第 2 轮
- **AND** MUST 恢复 collectedResults

### Requirement: 本地节点尝试关联生命周期

除 START/END 脚手架外，每次本地真实执行节点尝试 MUST 在调用 handler 前发出一个 `NODE_STARTED`，并 MUST 为该尝试发出恰好一个 `NODE_COMPLETED`、`NODE_FAILED`、`NODE_SKIPPED` 或 `NODE_WAITING`。

可重试的失败或超时尝试 MUST 在下一尝试的 `NODE_STARTED` 前发出当前尝试的 `NODE_FAILED`。下一尝试 MUST 使用新的 `nodeExecutionId`，并 MUST 把失败尝试作为直接前驱。既有 timeout、retry、失败、跳过和 exception 路由语义 MUST 保持不变。

#### Scenario: 重试先结束失败尝试

- **WHEN** 节点尝试失败且仍有剩余重试次数
- **THEN** engine MUST 先发出当前 nodeExecutionId 的 NODE_FAILED
- **AND** 随后 MUST 使用新的 nodeExecutionId 发出下一次 NODE_STARTED

#### Scenario: 重试耗尽仍保持 lifecycle 配对

- **WHEN** 节点耗尽重试次数
- **THEN** 每次尝试 MUST 恰好具有一个 START 和一个 TERMINAL
- **AND** 较早失败尝试的 timeline 权威执行 span MUST 不因后续尝试开始而保持 ACTIVE

### Requirement: 本地节点权威开始顺序

engine MUST 为 LLM、DISPLAY、AGENT、TOOL、SKILL、SUBFLOW、网关、交互和知识节点的每个本地真实执行实例发出安全 `WorkflowExecutionEvent`。每个真实执行实例 MUST 发出恰好一个 `NODE_STARTED`，随后发出零个或多个增量 event，并发出恰好一个 `NODE_COMPLETED`、`NODE_FAILED`、`NODE_SKIPPED` 或 `NODE_WAITING`。既有 START 脚手架 MUST 只发出 `NODE_STARTED`，既有 END 脚手架 MUST 只发出 `NODE_COMPLETED`；系统 MUST NOT 为二者伪造配对 event。

engine MUST 等待 `NODE_STARTED` observer 处理完成后再调用节点 handler，使持久化 timeline START 能在下游调用前建立执行关联。observer 或 timeline 持久化按其业务契约失败时，engine MUST 不启动该 handler。trace enrichment 自身的降级 MUST 由 decorator 吸收，MUST NOT 表现为 observer 失败。

runtime projection MUST 把每个节点 `NODE_STARTED` 映射为 `CAPABILITY_STARTED`，并把每个 TERMINAL 映射为 `CAPABILITY_COMPLETED`。同一真实执行实例的投影 event MUST 携带相同 `nodeExecutionId`、`predecessorNodeExecutionIds`、业务 `nodeId` 和业务提供的 description。START、END 或非外部调用节点 MUST 不因缺少 capabilityId 而被省略，但 START/END 投影 MUST 省略执行关联字段并且 MUST NOT 创建或结束 timeline 权威执行 span。

安全 `visibleDelta` MUST 继续使用 workflow-layer vocabulary。runtime MAY 把它投影为既有实时或持久化增量 event，但 MUST 不为该增量创建独立 timeline 权威执行 span。

#### Scenario: 安全可见增量保持既有桥接

- **WHEN** 节点 handler 发出安全的可见文本或 thinking 增量
- **THEN** engine MUST 通过 `WorkflowExecutionObserver` 发出对应 `WorkflowExecutionEvent`
- **AND** engine MUST 保留 workflow-layer safe delta vocabulary，而不是直接写 runtime timeline event
- **AND** 上层 orchestrator MAY 将这些 event 投影为 runtime stream event

#### Scenario: 两个真实执行节点输出完整 lifecycle

- **WHEN** 本地 recipe 经过 START 后依次执行真实工作节点 A 和 B，再经过 END 成功结束请求
- **THEN** A 和 B MUST 各自产生 CAPABILITY_STARTED 和 CAPABILITY_COMPLETED
- **AND** A 和 B 的 START 与 TERMINAL MUST 各自共享 nodeExecutionId
- **AND** START MUST 只有 CAPABILITY_STARTED，END MUST 只有 CAPABILITY_COMPLETED
- **AND** START 和 END MUST 不创建 timeline 权威执行 span
- **AND** trace 启用时 START 和 END 的 timeline event MUST 关联 request span

#### Scenario: 等待节点结束当前执行实例

- **WHEN** 交互节点进入 NODE_WAITING
- **THEN** runtime projection MUST 为当前 nodeExecutionId 产生待处理 CAPABILITY_COMPLETED
- **AND** 恢复后重新执行 handler 时 MUST 创建新的 nodeExecutionId

#### Scenario: 并行完成顺序不改变直接前驱

- **WHEN** recipe 分支顺序为 B、C，但 C 先于 B 完成
- **THEN** 汇聚节点的 predecessorNodeExecutionIds MUST 仍按 B、C 排列
- **AND** event 到达顺序 MUST 不改变该列表

#### Scenario: 节点 handler 在 START 持久化后执行

- **WHEN** NODE_STARTED observer 成功保存节点 START timeline event
- **THEN** engine 才能调用对应 handler
- **AND** handler 内下游调用 MUST 能解析当前 nodeExecutionId 的执行关联
- **AND** handler 内模型调用 MUST 保持节点执行关联且不得合成 MODEL lifecycle
- **AND** handler 直接调用 `CapabilityInvocationPort` MUST 保持节点执行关联且不得合成额外能力 lifecycle

#### Scenario: START 持久化失败不调用 handler

- **WHEN** NODE_STARTED observer 因权威 timeline 写入失败而拒绝
- **THEN** engine MUST 不调用节点 handler
- **AND** 工作流 MUST 按既有安全错误和终止规则结束或降级

### Requirement: Timeout and Retry

engine MUST 支持节点级 timeout 和 retry。

#### Scenario: Retry Exhausted
- **WHEN** 节点重试耗尽
- **THEN** engine MUST 产出失败或跳过结果
- **AND** 若进入 exception 路由，失败变量 MUST 符合 Exception Failure Variable Contract

#### Scenario: Timeout Produces Failure Variable
- **WHEN** 节点执行超过声明的 timeout
- **THEN** engine MUST 合成 `code` 为 `WORKFLOW_NODE_TIMEOUT` 的失败
- **AND** 注入的 `error.category` MUST 为 `"TIMEOUT"`
- **AND** 注入的 `error.message` MUST 为非空字符串

### Requirement: 工作流启动里程碑诊断日志

`InMemoryWorkflowExecutionService.execute()` 在 recipe version 校验通过后、`executePath` 之前 MUST 输出一条 info 级别 runtime diagnostic log，不得对执行路径产生额外副作用。

该事件 MUST 命名为 `workflow.execution.started`，并且 MUST 携带以下字段：
- `executionId`：workflow execution 的标识（string）。
- `recipeName`：recipe 的名称（string）。
- `runId`：所属 request run 的标识（string）。
- `startedAtEpochMs`：workflow 启动的 epoch 毫秒时间戳（number），= `this.now().getTime()`。

该事件仅用于本地运行诊断。事件 MUST NOT 写入 timeline event、audit、metric、trace 或 Web API response，且字段 MUST NOT 包含 prompt、模型输出、credential、路径或高基数字段。

与既有的 `workflow.node.started`（debug，节点级）不同，`workflow.execution.started` 是流程级启动里程碑，两者不重复：前者记录单个节点执行启动，后者记录整个 workflow execution 启动。

只有经 `workflowExecutionService.execute()` 执行且 run 为 DETERMINISTIC_FLOW 路由（携带 `recipeName` 且为 workflow run）的 run 才输出该事件；非 workflow run（MODEL_DRIVEN_LOOP）MUST NOT 输出该事件。

latency 计算以 `startedAtEpochMs` 与 `runtime.run.dispatched` 的 `runCreatedAtMs` 通过 `runId` 作为 join key 对齐，支持纯日志计算 `latency = startedAtEpochMs - runCreatedAtMs`，度量 accept 到 workflow start 的时延（含排队等待时间）。

#### Scenario: 工作流 run 启动时输出诊断事件

- **WHEN** 一个 DETERMINISTIC_FLOW run 进入 `workflowExecutionService.execute()` 且 recipe version 校验通过
- **THEN** engine MUST 在 `executePath` 之前输出 `workflow.execution.started` info 级别日志
- **AND** 日志 MUST 携带 `executionId`、`recipeName`、`runId`、`startedAtEpochMs`
- **AND** `startedAtEpochMs` MUST 为 epoch 毫秒时间戳

#### Scenario: 诊断事件不进入持久化 timeline

- **WHEN** `workflow.execution.started` 事件被输出
- **THEN** 该事件 MUST NOT 写入 timeline store 中
- **AND** MUST NOT 写入 audit log 中
- **AND** MUST NOT 产生 metric sample 中
- **AND** MUST NOT 产生 trace span 中
- **AND** MUST NOT 出现在 Web API response 中

#### Scenario: 非工作流 run 不输出该事件

- **WHEN** 一个 MODEL_DRIVEN_LOOP run 被调度执行
- **THEN** 该 run MUST NOT 输出 `workflow.execution.started` 事件
- **AND** 该 run 仍然输出 `runtime.run.dispatched` 事件

### Requirement: Exception Failure Variable Contract

当节点执行失败且重试耗尽后进入 exception 路由时，engine MUST 把失败信息注入 exception 分支的 condition 变量空间，注入位置为 `error`。失败变量空间 MUST 仅包含 `code`、`message` 和可选的 `category` 三个字段。

`code` MUST 为非空字符串，是失败的第一标识。当失败由 capability（含 RESTful 节点）业务失败引起时，`code` MUST 直接携带上游接口返回的业务 code，engine MUST NOT 用框架码覆盖业务 code。当失败由 engine 自身结构性原因引起时，`code` MUST 携带框架码（如 `WORKFLOW_NODE_TIMEOUT`）。engine MUST NOT 解释或映射业务 code 的语义。

`message` MUST 为字符串，是失败的人类可读原因。当失败由 capability 业务失败引起时，`message` MUST 取上游接口返回的 message；当失败由 engine 合成时，`message` MUST 取 engine 生成的 message。`message` 取代原 `reasonCode` 字段。

`category` 为可选字段。仅当失败由 engine 合成的超时引起时，`category` MUST 为 `"TIMEOUT"`。其他所有失败 MUST NOT 携带 `category` 字段。engine MUST NOT 在 exception 变量空间中暴露 `VALIDATION`、`UNAVAILABLE`、`NOT_FOUND`、`POLICY_DENIED`、`CANCELED`、`INTERNAL`、`AUTHORIZATION`、`CONFLICT` 等 category 值。

注入的 `error` 对象 MUST 被冻结，且 MUST 与既有 workflow 变量合并后作为 exception condition 的求值上下文。exception condition 的求值上下文 = 原有 workflow 变量 + 注入的 `error`，两者平级可见，recipe 可自由组合。原有 workflow 变量 MUST 保留可见，recipe 可从 workflow 上下文取到既有变量。

设计入口：openspec/designs/modules/agent-workflow.md、openspec/designs/adr/workflow-exception-category-collapse.md

#### Scenario: Business failure code passthrough
- **WHEN** RESTful 节点调用的 capability 返回业务失败，其 `safeError.code` 为 `5001`
- **THEN** engine 注入的 `error.code` MUST 等于 `5001`
- **AND** `error.code` MUST NOT 等于 `WORKFLOW_CAPABILITY_FAILED`
- **AND** `error` MUST NOT 携带 `category` 字段

#### Scenario: Business failure message passthrough
- **WHEN** capability 返回业务失败，其 `safeError.message` 为 `order not found`
- **THEN** engine 注入的 `error.message` MUST 等于 `order not found`

#### Scenario: Timeout category overlay
- **WHEN** 节点执行超过声明的 timeout，engine 合成超时失败
- **THEN** `error.code` MUST 等于 `WORKFLOW_NODE_TIMEOUT`
- **AND** `error.category` MUST 等于 `"TIMEOUT"`
- **AND** `error.message` MUST 为非空字符串

#### Scenario: Engine structural failure without category
- **WHEN** 节点抛出非超时、非业务失败的 engine 合成错误（如重试耗尽后的兜底失败）
- **THEN** `error` MUST NOT 携带 `category` 字段
- **AND** `error.code` MUST 为非空框架码字符串

#### Scenario: Existing workflow variables remain visible
- **WHEN** engine 注入 `error` 后对 exception condition 求值
- **THEN** 原有 workflow 变量 MUST 保持可见且可被 condition 引用
- **AND** `error` MUST 被冻结不可变

#### Scenario: Condition routes by business code
- **WHEN** exception 分支声明 `condition: "${error.code == '5001'}"`
- **AND** 注入的 `error.code` 等于 `5001`
- **THEN** engine MUST 选中该分支

#### Scenario: reasonCode field removed and injection location changed
- **WHEN** engine 注入 `error` 后检查变量空间
- **THEN** `error` MUST NOT 包含 `reasonCode` 字段
- **AND** 变量空间 MUST NOT 包含 `__workflow` 键

### Requirement: External Cancel Rollback Execution

外部 cancel（runtime controller.abort）触发后，workflow execution engine MUST 检索 recipe.runtime.controlPolicy.cancel，决定取消后的回退行为。

触发机制：runtime cancel 接口调用 controller.abort()，信号传递到 workflow engine 的 signal。engine 在检测到 signal.aborted 时（节点间循环顶部、节点执行后、节点内 abort 捕获）MUST 调用 cancel policy 处理。同步执行，回退在 agent.execute() 内部完成。runtime cancel() 对 executing run 不提前提交终态，等 agent.execute() 返回后用 cancel 幂等键提交 CANCELED 并保留回退 content（D10）。

输入与前置条件：
- recipe 已通过 schema 校验，controlPolicy.cancel 配置在 recipe.runtime 下。
- 当前 run 的 agent scope / owner scope 来自 runtime accepted RequestRun，MUST 传入回退路径。
- 回退节点可读当前 variables（正向节点已产出的变量），但回退路径不写 checkpoint。

已配置 controlPolicy.cancel 时：
- engine MUST 取 cancel 的第一个 entry 作为回退目标节点（首版 condition 不求值，当前无入口传入 variables）。MUST 允许多 entry 存在但只取第一个生效。
- engine MUST 创建独立子 AbortController，用其 signal 执行回退路径，MUST NOT 使用已 abort 的父 signal。若配置了 cancelTimeout 则子信号 MUST 设该超时作为兜底；未配置则跟随回退节点自身 timeout/retry 默认逻辑。
- 回退路径 MUST 通过 executePath 从目标节点开始执行，沿 next 边自然执行到 END 或 TERMINAL。
- 回退路径 MUST NOT 写 checkpoint（补偿非正向流程）。
- 回退路径 MUST 继承原 run 的 agent scope / owner scope，MUST NOT 使用不可信来源覆盖 scope。
- 回退路径完成后 MUST 返回 INTERRUPTED（对应 runtime CANCELED）。
- 回退路径用 try/catch 包住 executePath，catch 里 MUST 记录一行 structured log（reasonCode WORKFLOW_ROLLBACK_FAILED），然后返回 INTERRUPTED。MUST NOT 额外发 NODE_FAILED event（回退节点自身失败时 executeNode 已 emit）。MUST NOT 改 runtime 终态映射。WORKFLOW_ROLLBACK_FAILED reasonCode 仅存在于 structured log，MUST NOT 作为独立 timeline event、SafeError 字段、Web API response 或 audit 字段。回退节点自身的 NODE_FAILED event 可进 timeline（节点执行事实），但 reasonCode 分类不额外传播。

回退路径中的节点失败行为：回退路径中节点执行失败（非 abort）时 MUST NOT 走 exception 分支或 retry，MUST 直接中断回退路径，记录 WORKFLOW_ROLLBACK_FAILED 后返回 INTERRUPTED。回退是补偿动作，失败行为必须可预测。

输出与副作用：
- 回退节点正常执行时 MUST 发出 NODE_COMPLETED 等 WorkflowExecutionEvent（与正向节点一致），timeline 可见，用户可观察回退执行进度。
- 回退节点产出的 outputVariables MUST 合并到 WorkflowExecutionResult.outputVariables，消费方为 default-agent 的 projectWorkflowExecutionResult（投影为 terminalContent）和 runtime terminal commit。
- 回退路径不写 checkpoint，不产生持久化 resume state。
- 回退失败时 structured log 记录 WORKFLOW_ROLLBACK_FAILED，可通过 observability 追溯，不含敏感字段。
- cancel 路径 MUST 在 info 级别输出 runtime diagnostic log，记录 cancel 信号检测、无 rollback 节点、rollback 执行开始与完成四个里程碑事件。事件名称分别为 `workflow.cancel_detected`（reasonCode `WORKFLOW_CANCEL_SIGNAL_RECEIVED`）、`workflow.cancel_no_rollback`（reasonCode `WORKFLOW_CANCEL_NO_ROLLBACK_NODE`）、`workflow.cancel_rollback_started`（reasonCode `WORKFLOW_CANCEL_ROLLBACK_ENTERING`，含 `rollbackNodeId` 和可选 `cancelTimeoutS`）、`workflow.cancel_rollback_completed`（reasonCode `WORKFLOW_CANCEL_ROLLBACK_SUCCEEDED`，含 `rollbackNodeId` 和 `rollbackPathState`）。这些 diagnostic log 仅用于本地运行诊断，MUST NOT 进入 timeline event、audit、metric、trace 或 Web API response。字段仅包含 `executionId`、`recipeName`、`rollbackNodeId`、`cancelTimeoutS`、`rollbackPathState`、`reasonCode` 等低基数诊断字段，MUST NOT 包含 prompt、模型输出、credential、路径或高基数字段。

流程接入：
- 上游：runtime cancel 接口（POST /cancel）→ controller.abort() → agent.execute(run, context, signal) → default-agent executeRecipeRoute → workflowExecutionService.execute(request, signal, observer, runtime) → engine 检测 signal.aborted。
- 下游：engine 返回 INTERRUPTED → default-agent projectWorkflowExecutionResult 投影 terminalContent → agent.execute 返回 → runtime 检测 canceling → terminal commit CANCELED → 发布 REQUEST_CANCELED timeline event。
- runtime 不感知 workflow cancel 策略，只做 abort 和 terminal commit。engine 在 agent.execute 内部完成回退，runtime 等待 agent 返回。

失败与降级：
- 回退路径节点失败：记录 WORKFLOW_ROLLBACK_FAILED log，返回 INTERRUPTED。MUST NOT 递归回滚。MUST NOT 走 exception 分支或 retry。
- 回退路径超时（配置了 cancelTimeout）：abort 子信号，executePath 自然返回 INTERRUPTED。MUST NOT 静默吞错。
- 回退节点自身 retry 耗尽：视为回退路径节点失败，记录 WORKFLOW_ROLLBACK_FAILED，返回 INTERRUPTED。MUST NOT 走 exception 分支。
- 无 controlPolicy.cancel：直接返回 INTERRUPTED（兼容当前行为），MUST NOT 执行任何回退节点。
- 回退期间不允许静默截断、静默丢弃或静默吞错。

#### Scenario: External Cancel Without Policy

- **WHEN** 外部 cancel 触发 signal.aborted 且 recipe 未配置 controlPolicy.cancel
- **THEN** engine MUST 直接返回 INTERRUPTED
- **AND** MUST NOT 执行任何回退节点

#### Scenario: External Cancel With Rollback

- **WHEN** 外部 cancel 触发 signal.aborted 且 recipe 配置 controlPolicy.cancel 含 rollback_cleanup
- **THEN** engine MUST 从 rollback_cleanup 开始执行回退路径
- **AND** 回退路径 MUST 使用独立子信号
- **AND** 回退路径完成后 MUST 返回 INTERRUPTED

#### Scenario: Rollback Uses Independent Sub-Signal

- **WHEN** cancel 回退路径执行中
- **THEN** 回退节点 MUST 使用独立子 AbortController 的 signal
- **AND** MUST NOT 继承已 abort 的父 signal
- **AND** 若配置了 cancelTimeout 则子信号 MUST 设该超时；未配置则不设额外超时

#### Scenario: Rollback Timeout

- **WHEN** 配置了 cancelTimeout 且回退路径执行超过该值
- **THEN** engine MUST abort 子信号
- **AND** executePath 自然返回 INTERRUPTED
- **AND** MUST 返回 INTERRUPTED

#### Scenario: Rollback Node Failure

- **WHEN** cancel 回退路径中节点执行失败
- **THEN** engine MUST 记录诊断 reasonCode WORKFLOW_ROLLBACK_FAILED
- **AND** MUST 返回 INTERRUPTED
- **AND** MUST NOT 递归回滚
- **AND** MUST NOT 走 exception 分支或 retry

#### Scenario: Rollback Node Retry Exhausted

- **WHEN** cancel 回退路径中节点 retry 耗尽
- **THEN** engine MUST 视为回退路径节点失败
- **AND** MUST 记录 WORKFLOW_ROLLBACK_FAILED
- **AND** MUST 返回 INTERRUPTED
- **AND** MUST NOT 走 exception 分支

#### Scenario: Rollback Does Not Write Checkpoint

- **WHEN** cancel 回退路径执行节点
- **THEN** MUST NOT 写 checkpoint
- **AND** 回退是补偿动作，非正向流程

#### Scenario: Rollback Inherits Scope

- **WHEN** cancel 回退路径执行
- **THEN** 回退节点 MUST 继承原 run 的 agent scope / owner scope
- **AND** MUST NOT 使用不可信来源覆盖 scope

#### Scenario: Rollback Events Visible

- **WHEN** cancel 回退路径节点正常执行完成
- **THEN** engine MUST 发出 NODE_COMPLETED 等 WorkflowExecutionEvent
- **AND** timeline MUST 可见回退节点执行
- **AND** 回退节点 outputVariables MUST 合并到 WorkflowExecutionResult.outputVariables

#### Scenario: Condition Reserved Not Evaluated

- **WHEN** controlPolicy.cancel 含多个 entry 且 condition 非空
- **THEN** 首版 MUST 取第一个 entry 作为回退目标
- **AND** MUST NOT 求值 condition（当前无入口传入 variables）
- **AND** MUST 允许多 entry 存在但只取第一个生效

### Requirement: Node Failure Decoupled From ControlPolicy

节点失败（非 abort）MUST NOT 触发 controlPolicy。节点失败处置完全由 retry（节点级重试）和 exception 分支（节点级异常转移）承载。

- 节点抛出非 abort 错误且 retry 未耗尽时 MUST 重试。
- 节点抛出非 abort 错误且 retry 耗尽且有 exception 分支时 MUST 走 exception 分支转移。
- 节点抛出非 abort 错误且 retry 耗尽且无 exception 分支时 MUST 返回 terminalState FAILED，流程终止。
- 节点抛出 abort 错误时 MUST 走外部 cancel 回退路径（若配置）。

engine MUST NOT 保留 applyControlPolicy 方法或 skipControlPolicy 参数。engine MUST NOT 在 terminalState FAILED 时检索 controlPolicy。

#### Scenario: Node Failure Without Exception

- **WHEN** 节点抛出非 abort 错误且 retry 耗尽且无 exception 分支
- **THEN** engine MUST 返回 terminalState FAILED
- **AND** MUST NOT 检索 controlPolicy

#### Scenario: Node Failure With Exception

- **WHEN** 节点抛出非 abort 错误且 retry 耗尽且有 exception 分支
- **THEN** engine MUST 走 exception 分支转移
- **AND** MUST NOT 检索 controlPolicy

#### Scenario: Node Abort Triggers Cancel Policy

- **WHEN** 节点抛出 abort 错误（外部取消）
- **THEN** engine MUST 走外部 cancel 回退路径（若配置 controlPolicy.cancel）
- **AND** MUST NOT 返回 terminalState FAILED

### Requirement: Cancel Terminal Commit Timing For Executing Runs

runtime cancel() 对 executing run MUST NOT 提前提交终态。cancel() 对 executing run 只 abort + 存 cancel 幂等键到 executionState，不调 commitCanceledRun。executeQueuedWork 等 agent.execute() 返回后，检查 canceling 状态，用 finishRun 提取回退 content，调 commitTerminal 提交 CANCELED 并传入 cancel 幂等键。

排队中请求的 cancel 仍走 commitCanceledRun（无 executing run）。

幂等性：executionState 新增 cancelIdempotencyKey 和 cancelIdempotencySemantic 字段。重复 cancel 的幂等锚检查在 cancel() 入口命中。cancel 与自然完成的 race 由 CAS 版本保证。

内容保留：有回退 content 用回退 content，无内容 fallback 到 "Request canceled by user."。

#### Scenario: Cancel Executing Run Defers Terminal Commit

- **WHEN** cancel() 对 executing run 触发
- **THEN** cancel() MUST 只 abort + 存 cancel 幂等键
- **AND** MUST NOT 调 commitCanceledRun
- **AND** executeQueuedWork 等 agent.execute() 返回后 MUST 用 finishRun 提取 content
- **AND** MUST 调 commitTerminal 提交 CANCELED 并传入 cancel 幂等键

#### Scenario: Cancel Queued Run Keeps Immediate Commit

- **WHEN** cancel() 对排队中请求触发（无 executing run）
- **THEN** cancel() MUST 调 commitCanceledRun 立即提交
- **AND** 行为不变

#### Scenario: Cancel Preserves Rollback Content

- **WHEN** agent.execute() 返回且 canceling 为 true 且回退节点产出了 content
- **THEN** terminal commit 的 content MUST 使用回退 content
- **AND** MUST NOT 使用固定文案 "Request canceled by user."

#### Scenario: Cancel Without Rollback Content Falls Back

- **WHEN** agent.execute() 返回且 canceling 为 true 且无回退 content
- **THEN** terminal commit 的 content MUST fallback 到 "Request canceled by user."

### Requirement: Cancel Terminal Content Not Suppressed

runtime 的 shouldSuppress 机制在 cancel 期间（canceling/canceled/terminalized 为 true）MUST 豁免 LLM_CONTENT_DELTA 且 inlinePayload.final === true 的事件。该事件携带 workflow rollback 投影的完整终态内容，MUST 到达 output.content 赋值和 stream 推送路径。

中间流式内容（LLM_CONTENT_DELTA 且 final 不为 true）、NODE_STARTED、NODE_COMPLETED、TOOL_STRUCTURED_DELTA、CAPABILITY_RESULT_DELTA 等非终态事件在 cancel 期间 MUST 继续被 suppress。

豁免的 final:true 事件 MUST 正常走 persistence policy 解析（通常为 LIVE_ONLY）、output.content 赋值和 onLiveTimelineEvent 推送。MUST NOT 持久化到 timeline store（与正常路径一致）。

terminal message size limit MUST 对豁免的 final 内容同样生效。

#### Scenario: Final Terminal Content Exempted From Suppression

- **WHEN** shouldSuppress 返回 true 且事件为 LLM_CONTENT_DELTA 且 inlinePayload.final === true
- **THEN** emitEvent MUST NOT 提前返回
- **AND** MUST 执行 output.content 赋值
- **AND** MUST 推送给 onLiveTimelineEvent（LIVE_ONLY）
- **AND** finishRun().finalContent MUST 包含回退内容

#### Scenario: Intermediate Streaming Content Still Suppressed

- **WHEN** shouldSuppress 返回 true 且事件为 LLM_CONTENT_DELTA 且 inlinePayload.final 不为 true
- **THEN** emitEvent MUST 提前返回
- **AND** MUST NOT 执行 output.content 赋值
- **AND** MUST NOT 推送给 onLiveTimelineEvent

#### Scenario: Non-Content Events Still Suppressed

- **WHEN** shouldSuppress 返回 true 且事件类型不是 LLM_CONTENT_DELTA
- **THEN** emitEvent MUST 提前返回
- **AND** MUST NOT 推送给 onLiveTimelineEvent 或 onTimelineAppend

#### Scenario: Normal Path Unchanged

- **WHEN** shouldSuppress 返回 false 或未配置
- **THEN** 所有事件 MUST 正常处理
- **AND** 行为与豁免前一致
