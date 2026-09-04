## ADDED Requirements

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
3. 判断 ecipe.runtime.persistence.checkpoint 是否为 	rue → 否则跳过
4. 构造 WorkflowExecutionResumeState（含 loopContext 若在循环内）
5. 调用 untime.saveCheckpoint 回调
6. 写入失败 → 记录 WORKFLOW_CHECKPOINT_WRITE_FAILED 事件，流程继续

**状态 / 产物契约：**
- checkpoint 记录持久化到 CheckpointStoreGateway，payload 为序列化的 WorkflowExecutionResumeState + loopContext，存储在 CheckpointRecord.flowVariables 中。
- 生命周期：与 request run 绑定，run 终态提交后可清理（由 runtime 管理）。
- 消费方：resume 恢复时由 parseWorkflowResumeState 读取。
- 可追溯性：checkpoint 含 executionId / 
odeId / ecipeName，可追溯到具体节点。
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
- 由 execute 方法消费 equest.resumeState 触发。
- 位于 workflow execution 启动阶段，在 esolveRecipeDefinition 之后、executePath 之前。
- 同步执行。

**核心判断逻辑：**
1. 检查 equest.resumeState 是否存在 → 不存在则从 esolveEntryNodeId 正常启动
2. 校验 esumeState.recipeName 与当前 recipe 一致 → 不一致抛 WORKFLOW_RESUME_RECIPE_MISMATCH
3. 从 esumeState.nodeId 恢复执行位置
4. 使用 esumeState.variables 作为初始变量
5. 若 esumeState.loopContext 存在 → 恢复循环上下文（iteration/elementIndex/collectedResults），从循环头继续

**状态 / 产物契约：**
- resume 不产生新产物，消费既有 checkpoint 中的 WorkflowExecutionResumeState。
- loopContext 恢复循环状态后，后续 checkpoint 继续追加循环进度。
- 安全限制：resume variables 继承原 run 的 agent scope / owner scope，不得跨 scope 恢复。

**流程接入：**
- 上游：execute 方法入口，equest.resumeState 来自 default-agent 的 executeRecipeRoute（从 context.flowVariables 读取）。
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
2. 读取 ecipe.runtime.controlPolicy.cancel（首版仅 cancel 入口）
3. 若 controlPolicy 未配置 → 默认 STOP（终止流程）
4. 按 strategy 执行：
   - STOP → 节点 NODE_FAILED，流程终止
   - CONTINUE → 节点 NODE_SKIPPED，走 next
   - RESTART → 清空 variables，从 START 重跑
   - ROLLBACK_THEN_CONTINUE → 执行 ollbackNode 子路径（executePath stopBeforeNodeId=失败节点），合并结果，从失败点继续
   - ROLLBACK_THEN_RESTART → 执行 ollbackNode 子路径，从 START 重跑
   - ROLLBACK_THEN_STOP → 执行 ollbackNode 子路径，终止

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