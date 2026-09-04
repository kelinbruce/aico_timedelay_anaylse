## 背景和现状

当前 agent-workflow 的 InMemoryWorkflowExecutionService 是纯内存态执行：executePath 按节点顺序遍历，节点结果只活在本次 run 的变量作用域里，run 终态提交后或进程中断后无可恢复事实。
Recipe v2 contracts 已引入 runtime.persistence.checkpoint（断点续跑开关）和 runtime.controlPolicy（失败策略），但 engine 侧未实现持久化写入，controlPolicy 的回滚策略（ROLLBACK_THEN_*）也无执行路径。
runtime 层已有 CheckpointStoreGateway 与 runState.saveCheckpoint 能力（用于 request run 级恢复），本 change 复用该 gateway，不新建表、不新建 gateway port。
workflow 在电信场景需要重复执行节点链（A→B→C→A，如轮询诊断、迭代收敛），当前 engine 的 executePath 只支持线性/分支单次遍历，无循环能力。
相关方：agent-workflow（engine 实现）、agent-core/default-agent（桥接 saveCheckpoint）、agent-app/composition（loader normalize）、agent-contracts（schema 扩展）。

## 目标和非目标

目标：
- 为 engine 引入最小节点级 checkpoint 持久化与 resume 恢复（单实例内，复用既有 CheckpointStoreGateway）。
- 实现 controlPolicy 全部 6 种策略执行（STOP/CONTINUE/RESTART/ROLLBACK_THEN_CONTINUE/ROLLBACK_THEN_RESTART/ROLLBACK_THEN_STOP）。
- 实现多节点循环（loop）：循环尾节点配置 loopConfig，engine 委托 executeLoopPath，支持固定次数/数组遍历/条件求值三种控制 + 元素注入 + 结果收集 + 间隔等待 + 防死循环。
- 循环与 checkpoint 交互：循环中断后 checkpoint 含 loopContext，resume 恢复循环上下文。
- loader 支持 loop_config 等 snake_case 字段 normalize 为 camelCase（用户 YAML 权威源用 snake_case）。

非目标：
- 不做分布式 workflow 调度（单实例 checkpoint）。
- 不做 runtime.incremental 增量执行语义。
- 不做 workflow durable history（event sourcing）。
- 不新建 gateway 表，复用既有 CheckpointStoreGateway。
- 不实现 RESTFUL 节点 batchConfig（由 refine-ts-workflow-recipe-v2-contracts 独立承载）。
- 不实现嵌套循环（单循环体，嵌套需独立 change）。
- 不自动把旧 loop 子配置 normalize 为 loopConfig（仅 deprecated 忽略）。

## 与 refine-ts-workflow-execution-engine-v2 的 ControlPolicy 关系

refine-ts-workflow-execution-engine-v2（尚未归档，baseline 暂无 ControlPolicy）已定义 ControlPolicy Resolution requirement：负责按失败上下文解析出策略（strategy + 可选 rollbackNode）。
本 change 的 ControlPolicy Rollback Execution 是其下游执行层：消费解析结果，执行 6 种策略的副作用（终止/跳过/重跑/回滚子路径）。
两者是互补关系，不是重叠：Resolution 负责“选哪个策略”，Rollback Execution 负责“按策略做事”。
边界约定：
- refine-v2 归档后 baseline 的 ControlPolicy Resolution requirement 描述解析契约；本 change 归档后 baseline 的 ControlPolicy Rollback Execution requirement 描述执行契约，两者各自独立、互不 MODIFIED。
- 若 refine-v2 在本 change 归档前仍未合入，本 change 的 Rollback Execution 仍可独立实现（执行层不依赖解析层代码先落，只要 controlPolicy 配置在 recipe 里就能读到 strategy）。
- tasks 0.1 是该关系的确认检查点：实施前确认 refine-v2 的解析是否已合入或需在本 change 内补齐解析逻辑。

## 设计决策

### 持久化与恢复

#### D1 复用 runtime checkpoint：engine 不碰 gateway

NextAgent runtime 层已有完整 checkpoint 能力，本 change 纯复用，不在 engine 层新建任何持久化路径：
- 持久化：runtime `RuntimeOwnedAgentRunStatePort.saveCheckpoint(run, context, triggerReason)` 调 `saveRuntimeCheckpoint` 落 `CheckpointStoreGateway`。`saveRuntimeCheckpoint` 的 `flowVariables` **取自 `context.flowVariables`**，不接受调用方传入 payload。
- 恢复：runtime `submit` 在 resume/recovery 时 `loadCheckpoint` 后 `reconstructRecoveryContext`，把 `checkpoint.flowVariables` 注入 `RequestContext.flowVariables`。
- workflow 已接入：`default-agent.executeRecipeRoute` 的 `readWorkflowResumeState(context.flowVariables, recipeName)` 从 `context.flowVariables.workflowExecutionState` 命名空间读 resume state，传给 `engine.execute(request.resumeState)`；节点中断走 `requestPendingInput` 桥接，runtime 触发 `STEP_STARTED` checkpoint。
- 中断：`AbortSignal` 贯穿 engine 到 runtime，返回 `INTERRUPTED`。

因此 engine 的节点级 checkpoint 只需做两件事，且都通过既有路径：
1. 把当前节点完成后的 resume state（含 loopContext，见 D2）写进 `context.flowVariables.workflowExecutionState` 命名空间（与 `requestPendingInput` 桥接写的是同一个 key）。
2. 触发 runtime `runState.saveCheckpoint(run, context, "STEP_STARTED")`（复用既有 trigger reason，不新增）。

engine 通过 `execute()` 的 `runtime` 参数新增可选 `saveCheckpoint` 回调注入，与 `requestPendingInput` 同路径：

```ts
runtime?: {
  requestPendingInput(request: JsonObject, signal: AbortSignal): Promise<JsonObject>;
  saveCheckpoint?(input: {
    readonly resumeState: WorkflowExecutionResumeState;
  }) => Promise<void>;
}
```

- `saveCheckpoint` 由 `default-agent.executeRecipeRoute` 注入：回调内部把 `resumeState`（含 loopContext）写入 `context.flowVariables.workflowExecutionState`，然后调 `runState.saveCheckpoint(run, context, "STEP_STARTED")`。runtime 自己从 `context.flowVariables` 取数据落库，engine 不构造 `CheckpointRecord`、不碰 gateway。
- engine 只负责“何时调 + 传什么 resume state”，不感知 `CheckpointRecord`/`runVersion`/`lastSequence`/`activeContextVersion`（这些由 runtime `saveRuntimeCheckpoint` 内部填充）。
- 桥接方式与现有 `requestPendingInput` 完全一致（都是 engine 到 runtime 回调，runtime 拥有持久化 owner）。

#### D2 复用既有 workflowExecutionState 命名空间

workflow resume state 已有命名空间 `workflowExecutionState`（`default-agent` 的 `workflowExecutionStateKey = "workflowExecutionState"`），`requestPendingInput` 桥接写的就是这个 key。本 change 不新造 `__workflow_resume`/`__workflow_loop`，直接复用并扩展：

```ts
// context.flowVariables.workflowExecutionState 的 shape（由 default-agent 写入/读取）
workflowExecutionState: {
  executionId,
  recipeName,
  nodeId,
  nodeType,
  variables,
  loopContext?: { loopId, iteration, elementIndex, collectedResults }  // 本 change 新增子字段
}
```

- `default-agent.readWorkflowResumeState` 扩展解析 `loopContext` 子字段，构造含 `loopContext` 的 `WorkflowExecutionResumeState`。
- `CheckpointRecord.flowVariables` 是 `JsonObject`，`workflowExecutionState` 作为其一个 key 自然承载，runtime `saveRuntimeCheckpoint` 直接把整个 `context.flowVariables` 落库，无需 engine 介入序列化。
- 复用 `CheckpointTriggerReason = "STEP_STARTED"`（已有值），不新增 trigger reason。
- checkpoint MUST 继承当前 run 的 agent scope / owner scope（`CheckpointRecord extends OwnerScoped`，含 `agentId`，由 runtime 填充），不得跨 scope 恢复。
- checkpoint variables MUST NOT 含 secret 明文（secret 仅在 capability 调用边界内解引用，不进入 variables 快照）。
- 复用既有 `CheckpointStoreGateway`，不新增 gateway 表（proposal Non-Goal 约束）。
- checkpoint 写入 idempotency 由 runtime `saveRuntimeCheckpoint` 的 idempotencyKey（`runId:checkpoint:STEP_STARTED:version`）保证；节点级 checkpoint 每次写的是“当前节点位置”，runtime 按 runId+triggerReason+version 锚点，重复写返回首次结果。

#### D3 Checkpoint 触发时机

当 `recipe.runtime.persistence.checkpoint === true` 时：
- 每个非 gateway 节点（非 START/END/CONDITION/PARALLEL）完成后，engine 调 `runtime.saveCheckpoint`（回调内部写 flowVariables + 触发 runtime `saveCheckpoint("STEP_STARTED")`）。
- gateway 节点不写 checkpoint（无业务状态）。
- 循环内节点每轮都写 checkpoint（`workflowExecutionState.loopContext` 含当前轮次进度）。
- checkpoint 写入失败不阻塞流程（engine catch 回调异常，继续 transition），避免持久化故障导致流程中断。
- 不得静默吞错：写入失败时 engine 发 `WORKFLOW_CHECKPOINT_WRITE_FAILED` 事件（observer 可观测），但节点状态仍为 NODE_COMPLETED。
- 注意：runtime `saveCheckpoint` 失败时 engine 只能感知回调抛错，无法感知 runtime 内部细节；`WORKFLOW_CHECKPOINT_WRITE_FAILED` 事件承载 safe 的 reasonCode，不泄露 gateway 错误细节。

#### D4 Resume 恢复（复用既有闭环）

resume 恢复已在 runtime + default-agent + engine 三层闭环，本 change 只补 loopContext 解析，不新建 resume 路径：
- runtime：`loadCheckpoint` 后 `reconstructRecoveryContext` 把 `checkpoint.flowVariables` 注入 `RequestContext.flowVariables`（已实现）。
- default-agent：`readWorkflowResumeState(context.flowVariables, recipeName)` 读 `workflowExecutionState` 命名空间，本 change 扩展解析 `loopContext` 子字段（已实现 nodeId/nodeType/recipeName/variables 解析）。
- engine：`parseWorkflowResumeState(request.resumeState)` 已解析既有字段，本 change 扩展解析 `loopContext`，恢复循环上下文（循环计数、元素索引、已收集结果），从循环头节点继续。
- recipeName 校验分两层：default-agent `readWorkflowResumeState` 读取内部 checkpoint 时 `record.recipeName !== recipeName` 视为陈旧记录返回 undefined（从 START 启动）；engine `execute` 消费外部 `request.resumeState` 时校验 `resumeState.recipeName !== recipe.recipeName` 抛 `WORKFLOW_RESUME_RECIPE_MISMATCH`（防御 engine 契约边界，default-agent 路径下 resumeState 已由 readWorkflowResumeState 过滤故不会触发）。
- resume 不跳过已完成节点的 side effect 重放——checkpoint 保存的是“已完成后位置”，resume 从下一节点继续。
### ControlPolicy 回滚执行

#### D5 resolveControlPolicy 解析与执行

`runtime.controlPolicy` 含 `resume`/`modify`/`cancel`/`restart` 四个策略入口，每个含 `strategy` + 可选 `rollbackNode`。

engine 在节点失败时（`executeNode` 抛错且 retry 耗尽）调用 `resolveControlPolicy`：
1. 读取 `recipe.runtime.controlPolicy`，按当前失败上下文选择策略入口（首版仅 `cancel` 入口——节点失败即 cancel 语义）。
2. `STOP`：终止流程，节点 NODE_FAILED。
3. `CONTINUE`：忽略失败，节点 NODE_SKIPPED，继续 next。
4. `RESTART`：从 START 重跑（清空 variables）。
5. `ROLLBACK_THEN_CONTINUE`：执行 `rollbackNode` 子路径，结果合并到 scope，从失败点继续。
6. `ROLLBACK_THEN_RESTART`：执行 `rollbackNode` 子路径，从 START 重跑。
7. `ROLLBACK_THEN_STOP`：执行 `rollbackNode` 子路径，终止。

#### D6 回滚节点执行

`rollbackNode` 子路径通过 `executePath` 执行（`stopBeforeNodeId` = 失败节点）：
- 回滚路径从 `rollbackNode` 开始，执行到失败节点前停止。
- 回滚节点产生的 `outputVariables` 合并到当前 scope。
- 回滚路径中的节点不写 checkpoint（回滚是补偿，不是正向流程）。
- 回滚路径中的节点失败不递归回滚（回滚失败直接 `WORKFLOW_ROLLBACK_FAILED` 终止）。

### 多节点循环（loop）

#### D6A loop 字段命名策略：YAML snake_case → contract camelCase

Recipe YAML 是用户权威源，用户使用 snake_case 风格（`loop_config`/`loop_cardinality`/`loop_completion_condition` 等）。contract schema 使用 camelCase（TS 惯例）。loader 的 `normalizeNodeDefinition` 新增 `loopConfig` normalize，将 YAML snake_case 字段映射到 contract camelCase，与既有 `output_parser`→`outputParser` 模式一致。

YAML 字段 → contract 字段映射：
- `loop_config` → `loopConfig`
  - `loop_id` → `loopId`
  - `loop_cardinality` → `loopCardinality`
  - `loop_completion_condition` → `loopCompletionCondition`
  - `loop_input_data_item` → `loopInputDataItem`
  - `loop_element_variable` → `loopElementVariable`
  - `loop_time_cycle` → `loopTimeCycle`
  - `loop_end_node` → `loopEndNode`
  - `loop_start_node` → `loopStartNode`
  - `loop_result_variable` → `loopResultVariable`
  - `loop_result_type` → `loopResultType`
  - `loop_result_key` → `loopResultKey`
  - `loop_result_value` → `loopResultValue`

同时 `normalizeRecipeDefinition` 补 `runtime` normalize（既有缺口）：`control_policy`→`controlPolicy`、`default_retry`→`defaultRetry`、`persistence`透传（无嵌套 snake_case）。

normalize 在 loader 的 `loadRecipeDefinition` 阶段完成，engine 和 contract 只消费 camelCase。

#### D6B 多节点循环与单节点迭代的边界

本 change 实现的是**多节点循环**（A→B→C→A 节点链回边），不包含同一节点重复执行的单节点迭代。两者边界：
- 多节点循环：循环体是多个节点组成的链，每轮重新遍历整条链，循环尾节点回边到循环头。
- 单节点迭代：循环体是单个节点，engine 对同一节点重复执行多次，handler 透明。

单节点迭代由 `refine-ts-workflow-recipe-v2-contracts` 的 batchConfig 覆盖（RESTFUL 节点批量调用）。本 change 的 loop 是多节点循环，循环体内可包含任意节点类型。
#### D7 loop 配置归属：节点级

loop 配置放在循环尾节点的 `WorkflowNodeDef` 上（用户确认）。新增 `loopConfig` 可选字段：

```ts
WorkflowNodeDefSchema 新增：
  loopConfig: Type.Optional(Type.Object({
    loopId: WorkflowSafeIdSchema,                    // 循环标识
    loopCardinality: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),  // 固定循环次数
    loopCompletionCondition: Type.Optional(Type.String({ maxLength: 512 })),      // 循环结束条件（表达式）
    loopInputDataItem: Type.Optional(Type.String()),  // 循环输入数据列表变量引用（如 ${input.alarm_ids}）
    loopElementVariable: Type.Optional(Type.String()), // 当前元素变量名（如 alarm_item）
    loopTimeCycle: Type.Optional(Type.Integer({ minimum: 0 })),  // 循环间隔毫秒
    loopEndNode: WorkflowSafeIdSchema,                // 循环尾节点 id（自身）
    loopStartNode: WorkflowSafeIdSchema,              // 循环头节点 id（回边目标）
    loopResultVariable: Type.Optional(Type.String()), // 结果收集变量名（如 LOOP_RESULT）
    loopResultType: Type.Optional(Type.Union([Type.Literal("List"), Type.Literal("Map")])),  // 结果类型
    loopResultKey: Type.Optional(Type.String()),      // Map key 解析表达式（从元素取）
    loopResultValue: Type.Optional(Type.String())     // value 解析表达式（从节点结果取）
  }, { additionalProperties: false }))
```

- 循环尾节点 = 配置了 `loopConfig` 的节点。
- 循环头节点 = `loopConfig.loopStartNode` 指向的节点。
- 循环体 = 从循环头到循环尾的节点链。
- `loopConfig` 默认不存在，节点不配置时无循环行为。

#### D8 循环执行模型：executeLoopPath

新建 `executeLoopPath` 方法，封装循环 while + 计数 + 条件求值 + 元素注入 + 结果收集：

```
executeLoopPath(input):
  loopState = {
    iteration: 0,
    elementIndex: 0,
    collectedResults: [],
    loopVariables: {}
  }
  
  # 解析循环输入数据
  if loopConfig.loopInputDataItem:
    dataArray = resolveNodeValue(loopConfig.loopInputDataItem, variables)  # 必须是数组
    maxIterations = dataArray.length
  else:
    dataArray = undefined
    maxIterations = loopConfig.loopCardinality ?? 1000  # 上限保护
  
  while iteration < maxIterations:
    # 元素注入
    if dataArray:
      loopVariables[loopConfig.loopElementVariable] = dataArray[elementIndex]
    
    # 执行循环体（循环头 -> ... -> 循环尾）
    pathResult = await executePath({
      ...input,
      currentNodeId: loopConfig.loopStartNode,
      variables: mergeVariables(variables, loopVariables),
      stopBeforeNodeId: undefined,  # 走完整循环体
      loopContext: loopState
    })
    
    # 收集结果
    if loopConfig.loopResultVariable:
      result = resolveLoopResult(pathResult.variables, loopConfig)
      collectedResults.push(result)
    
    iteration += 1
    elementIndex += 1
    
    # 循环间隔
    if loopConfig.loopTimeCycle > 0:
      await delay(loopConfig.loopTimeCycle, signal)
    
    # 循环结束条件求值
    if loopConfig.loopCompletionCondition:
      if evaluateBranchCondition(loopConfig.loopCompletionCondition, pathResult.variables):
        break
    
    # abort 信号
    if signal.aborted:
      return { state: "INTERRUPTED", variables, loopState }
  
  # 结果合并到 variables
  if loopConfig.loopResultVariable:
    variables[loopConfig.loopResultVariable] = mergeLoopResults(collectedResults, loopConfig.loopResultType, loopConfig.loopResultKey, loopConfig.loopResultValue)
  
  # 继续走循环尾节点的 next
  return executePath({ currentNodeId: loopConfig.loopEndNode 的 next, variables })
```

- `executePath` 保持单纯（单向遍历），不感知循环。
- 循环尾节点执行完后，engine 检测到 `node.loopConfig` 存在，调用 `executeLoopPath` 接管。
- 循环体内部节点走正常 `executePath`，每轮重新遍历循环头到循环尾。

#### D9 循环结束条件优先级

1. `loopCompletionCondition` 求值为 true → 立即结束（最高优先级）。
2. `loopInputDataItem` 数组遍历完 → 结束。
3. `loopCardinality` 达到上限 → 结束。
4. 三者均未配置 → 默认 1 次（单次执行后结束，防死循环）。
- `loopCompletionCondition` 求值失败（表达式错误）→ 抛 `WORKFLOW_LOOP_CONDITION_INVALID`，节点 NODE_FAILED。
- `loopCardinality` 上限 1000，超出 → loader 校验拒绝。

#### D10 循环结果收集

每轮循环体执行完后，按 `loopResultType` 收集：
- `List`（默认）：每轮结果（由 `loopResultValue` 解析，未配置则取整轮 `outputVariables`）追加到数组。
- `Map`：每轮结果按 `loopResultKey`（从当前元素取字段值）作为 key，`loopResultValue`（从结果取字段值）作为 value，合并为对象。
- `loopResultKey` / `loopResultValue` 是用户指定的解析表达式（如 `${alarm_item.id}` / `${node_result.status}`），通过 `resolveNodeValue` 解析。
- 结果收集到 `loopResultVariable` 指定的变量名（如 `LOOP_RESULT`），合并到 variables。

#### D11 循环防死循环

- `loopCardinality` 上限 1000（loader 校验）。
- 无 `loopCardinality` 且无 `loopInputDataItem` 且无 `loopCompletionCondition` → 默认 1 次。
- 有 `loopCompletionCondition` 但无 `loopCardinality` 且无 `loopInputDataItem` → 上限 1000 次（兜底保护）。
- 循环间隔 `loopTimeCycle` 期间检查 `signal.aborted`，可中断。

#### D12 循环与 checkpoint 交互

- 循环内每轮每个非 gateway 节点完成后写 checkpoint，payload 含 `loopContext`（iteration/elementIndex/collectedResults）。
- 中断后 resume：`parseWorkflowResumeState` 解析 `loopContext`，`executeLoopPath` 从中断的轮次继续。
- resume 时 `loopContext.iteration` 恢复循环计数，`elementIndex` 恢复元素索引，`collectedResults` 恢复已收集结果。
- resume 从循环头节点继续（非中断节点），因为循环体是幂等重遍历。

#### D13 WorkflowExecutionResumeState 扩展

`WorkflowExecutionResumeState` 新增可选 `loopContext` 字段：

```ts
export interface WorkflowLoopContext {
  readonly loopId: string;
  readonly iteration: number;
  readonly elementIndex: number;
  readonly collectedResults: readonly unknown[];
}

export interface WorkflowExecutionResumeState {
  // 既有字段...
  readonly loopContext?: WorkflowLoopContext;
}
```

#### D14 loop 既有子配置迁移

既有 recipe 可能使用旧 `loop` 子配置（loop.over/loop.max_times）作为批量入口。本 change 的循环能力统一由节点级 `loopConfig` 承载，不自动将旧 `loop` 子配置 normalize 为 `loopConfig`：

- loader 检测到节点含旧 `loop` 子配置时，发出 deprecation warning 并忽略（不报错，向后兼容）。
- 用户需手动将旧 `loop` 子配置迁移为循环尾节点的 `loopConfig`。
- `refine-ts-workflow-recipe-v2-contracts` change D10 声明 loopConfig 与 batchConfig 互斥，本 change 的 loopConfig 不与 batchConfig 混用。
## 架构影响

- `agent-contracts/core`：`WorkflowNodeDefSchema` 新增 `loopConfig`；`WorkflowExecutionResumeState` 新增 `loopContext`；新增 `WorkflowLoopContext` interface。
- `agent-workflow/engine`：新增 `executeLoopPath`；`executePath` 检测循环尾节点后委托；新增 `resolveControlPolicy` + 回滚执行；新增 checkpoint 写入 hook。
- `agent-workflow/engine`：`WorkflowExecutionService.execute` 的 `runtime` 参数新增 `saveCheckpoint` 回调；engine 只负责“何时调 + 传 resume state”，不碰 `CheckpointStoreGateway`。
- `agent-core/default-agent`：`executeRecipeRoute` 注入 `saveCheckpoint` 桥接（通过 `runtime` 参数），回调内部把 resume state 写入 `context.flowVariables.workflowExecutionState` 后调 `runState.saveCheckpoint(run, context, "STEP_STARTED")`，纯复用 runtime 既有 checkpoint 路径；`readWorkflowResumeState` 扩展解析 `loopContext` 子字段。
- `agent-app/composition`：`workflowExecutionFactoryOptions` 不直接注入（由 default-agent 桥接）；不新增 gateway 表或 checkpoint store。
- `agent-app/workflow-recipe-loader`：`normalizeNodeDefinition` 新增 `loop_config`→`loopConfig` snake_case normalize + `loopConfig` 校验（loopCardinality 上限、loopEndNode 自身、loopStartNode 存在）；`normalizeRecipeDefinition` 补 `runtime` normalize（`control_policy`→`controlPolicy`、`default_retry`→`defaultRetry`）。

## 边界与约束

- checkpoint 仅单实例内（非分布式）。
- loop 仅支持单循环体（不支持嵌套循环，嵌套需独立 change）。
- 回滚路径不递归回滚。
- checkpoint 写入失败不阻塞，但可观测。
- 循环体节点 side effect 每轮都真实发生（非幂等重放），用户需自行保证循环体可重复执行。

## 失败与降级

- `loopInputDataItem` 解析非数组 → `WORKFLOW_LOOP_INPUT_NOT_ARRAY`，NODE_FAILED。
- `loopCardinality` > 1000 → loader 拒绝。
- `loopCompletionCondition` 求值失败 → `WORKFLOW_LOOP_CONDITION_INVALID`，NODE_FAILED。
- `loopStartNode` 不存在 → loader 拒绝。
- checkpoint 写入失败 → `WORKFLOW_CHECKPOINT_WRITE_FAILED` 事件，流程继续。
- 回滚节点失败 → `WORKFLOW_ROLLBACK_FAILED`，流程终止。
- `resumeState.recipeName` 不匹配 → `WORKFLOW_RESUME_RECIPE_MISMATCH`。
- 不得静默截断、静默丢弃或静默吞错。

## 验证映射

- `npm test`：checkpoint 写入/恢复、controlPolicy 回滚、loop 循环（正常/边界/失败降级）测试。
- `npm run test:contract`：`loopConfig` schema、`WorkflowLoopContext` 契约测试。
- `npm run lint:architecture`：无新跨包依赖（engine 不直接依赖 gateway）。
- `openspec validate --strict`：spec 合规。
- `$nextagent-code-review`：push 前 PASS。

## 质量属性设计

**安全**
- checkpoint variables 不得含 secret 明文（secret 仅在 capability 调用边界内解引用，不进入 variables 快照）。
- resume 继承原 run 的 agent scope / owner scope，CheckpointRecord extends OwnerScoped 且含 agentId，不得跨 scope 恢复。
- 验证入口：UT 断言 checkpoint payload 不含 secret 字段；resume 跨 scope 拒绝测试。

**性能/容量**
- checkpoint 写入是非 gateway 节点完成后的同步回调，但失败非阻塞，不拖垮主流程。
- 循环上限 1000 次（loader 校验），防止单 run 内无限循环耗尽预算。
- 循环体 side effect 每轮真实发生，用户需保证可重复执行；engine 不做结果缓存。
- 验证入口：UT 大循环（1000 次）不超时；checkpoint 写入失败时主流程时延不受影响。

**可靠性/恢复**
- checkpoint 写入失败不阻塞流程（WORKFLOW_CHECKPOINT_WRITE_FAILED 事件可观测），避免持久化故障导致流程中断。
- resume 从最近 checkpoint 的 nodeId 继续，循环内恢复 loopContext（iteration/elementIndex/collectedResults）。
- 回滚路径不写 checkpoint（补偿非正向），回滚失败不递归（WORKFLOW_ROLLBACK_FAILED 终止）。
- 验证入口：UT checkpoint 失败降级、resume 恢复、循环 resume、回滚失败终止。

**可维护性**
- executeLoopPath 独立于 executePath，保持 executePath 线性遍历简洁；循环逻辑集中在新方法。
- saveCheckpoint 通过 runtime 参数注入（与 requestPendingInput 同路径），engine 不直接耦合 gateway。
- 验证入口：lint:architecture 断言 engine 不直接 import gateway；代码 review 检查 executePath 未被循环逻辑污染。

**可测试性**
- saveCheckpoint 是回调，UT 可注入 spy 断言调用次数与 payload。
- executeLoopPath 接受 AbortSignal，UT 可测中断。
- 验证入口：UT 覆盖正常/边界/失败降级路径（见 tasks 2-6）。

**审计/可追溯**
- checkpoint 含 executionId/nodeId/recipeName，可追溯到具体节点位置。
- WORKFLOW_CHECKPOINT_WRITE_FAILED / WORKFLOW_ROLLBACK_FAILED / WORKFLOW_LOOP_INPUT_NOT_ARRAY 等事件可观测，不得静默吞错。
- 验证入口：UT 断言失败路径发出对应事件；checkpoint payload 含追溯字段。

## 文档承载决策

- 行为契约（checkpoint/resume/controlPolicy rollback/loop requirement）：归档后由 openspec/specs/workflow-execution-engine/spec.md 主承载。
- 架构/跨模块设计（checkpoint 注入路径、executeLoopPath、resolveControlPolicy 边界）：由 openspec/designs/architecture/workflow-execution-and-routing.md 主承载，本 change design 为增量决策源。
- 模块设计（agent-workflow engine 内部职责）：由 openspec/designs/modules/agent-workflow.md 主承载。
- 契约 schema（loopConfig/WorkflowLoopContext 字段）：由 agent-contracts 源码 + openspec/designs/architecture/core-contracts.md 主承载，spec 只引用不重复字段定义。
- 导航：openspec/designs/spec-to-design-map.md 更新本 change 对应映射。

## 风险与取舍

- [循环体 side effect 非幂等] -> 用户需自行保证循环体可重复执行；engine 不做幂等保护，文档明示该约束。
- [checkpoint 写入失败非阻塞可能导致 resume 丢失最近节点] -> 可观测事件 WORKFLOW_CHECKPOINT_WRITE_FAILED 兜底，运维可告警；不在本 change 引入阻塞重试（避免持久化故障拖垮主流程）。
- [回滚路径不递归回滚] -> 回滚失败直接终止（WORKFLOW_ROLLBACK_FAILED），避免无限递归；取舍是不自动补偿回滚失败，由上层决策。
- [复用既有 CheckpointStoreGateway 的 flowVariables 字段承载 workflow resume state] -> 不新建表，但 flowVariables 是 JsonObject 通用字段，复用既有 workflowExecutionState 命名空间承载 resume state（含 loopContext 子字段），不新造 key。
- [refine-v2 未归档时 ControlPolicy 解析可能未落代码] -> 本 change 执行层可独立实现，解析层缺失时 tasks 0.1 触发补齐或在 change 内一并实现。

## 归档前更新基线（Baseline Promotion Plan）

- 行为契约：将 4 个新增 requirement 沉淀进 openspec/specs/workflow-execution-engine/spec.md（Checkpoint Persistence / Resume From Checkpoint / ControlPolicy Rollback Execution / Multi-Node Loop Execution）。
- 模块设计：按需更新 openspec/designs/modules/agent-workflow.md（checkpoint 注入路径、executeLoopPath、resolveControlPolicy）。
- 架构导航：按需更新 openspec/designs/architecture/workflow-execution-and-routing.md（持久化与恢复、循环遍历、回滚子路径）。
- 导航映射：按需更新 openspec/designs/spec-to-design-map.md。
- ControlPolicy 协调：归档前确认与 refine-ts-workflow-execution-engine-v2 的 ControlPolicy Resolution 不产生 requirement 重复或冲突。

## 待确认问题

- 循环结果 loopResultKey/loopResultValue 的解析表达式语法是否完全复用 resolveNodeValue 的  语法，还是需要支持更丰富的表达式（本 change 先复用既有语法，若不足再独立 change 扩展）。
- 回滚子路径 rollbackNode 的定位：当前设计为 recipe 节点 id，是否需要支持回滚链（多节点回滚路径）——本 change 仅支持单 rollbackNode 子路径，多节点回滚链待后续 change。
- checkpoint 清理时机：run 终态提交后由 runtime 管理清理，本 change 不定义清理策略，依赖既有 CheckpointStoreGateway 的生命周期。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-9.8-持久化和恢复工作流` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/workflow-execution-engine/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
