## 背景与问题（Why）

Recipe v2 spec 引入 `runtime.persistence.checkpoint`（断点续跑）和 `runtime.controlPolicy` 的回滚策略。当前 `InMemoryWorkflowExecutionService` 是纯内存态，无持久化，流程中断后无法恢复，controlPolicy 的回滚语义无法执行。

同时，workflow 需要多节点循环能力（loop，如 A→B→C→A），用于电信场景中需要重复执行节点链的任务（如轮询诊断、批量分步处理、迭代收敛）。loop 涉及引擎 `executePath` 的循环遍历改造，与 checkpoint/resume 恢复强耦合（循环中断后需从循环位置恢复），因此 loop 与 persistence 合并到同一 change 承载。

本 change 为 workflow 引入最小持久化与恢复能力 + 多节点循环能力：

- 当 `runtime.persistence.checkpoint` 为 `true` 时，engine 在节点完成后持久化 checkpoint（节点位置 + 变量快照）。
- 流程中断后可通过 `resumeState` 从最近 checkpoint 恢复。
- 实现 `controlPolicy` 全部 6 种策略执行：`STOP`/`CONTINUE`/`RESTART`/`ROLLBACK_THEN_CONTINUE`/`ROLLBACK_THEN_RESTART`/`ROLLBACK_THEN_STOP`。
- 实现多节点循环：循环尾节点配置 `loopConfig`，engine 检测后委托 `executeLoopPath`，按 `loopCardinality`/`loopCompletionCondition` 控制循环，支持循环元素注入与结果收集。

## 变更范围（What Changes）

### 持久化与恢复

- **新增** workflow 节点级 checkpoint 持久化：非 gateway 节点完成后通过 `saveCheckpoint` 回调写入（由 `default-agent` 桥接：写 `context.flowVariables.workflowExecutionState` + 调 runtime `runState.saveCheckpoint("STEP_STARTED")`），纯复用既有 `CheckpointStoreGateway`，不新建持久化路径。
- **修改** `executePath`：当 `persistence.checkpoint` 为 `true` 时，每节点完成后持久化 `WorkflowExecutionResumeState`（含循环内 `loopContext`）。
- **修改** `execute`：消费 `request.resumeState` 从 checkpoint 恢复（已有 resumeState 解析，本 change 补持久化写入 + loopContext 恢复）。
- **新增** `resolveControlPolicy` 执行：节点失败时按 `runtime.controlPolicy` 策略执行——`STOP`（终止）、`CONTINUE`（跳过继续）、`RESTART`（从 START 重跑）、`ROLLBACK_THEN_CONTINUE`/`ROLLBACK_THEN_RESTART`/`ROLLBACK_THEN_STOP`（执行 `rollbackNode` 子路径后继续/重跑/终止）。

### 多节点循环（loop）

- **新增** 引擎循环遍历：循环尾节点配置 `loopConfig`，engine 检测后委托 `executeLoopPath`，按 `loopCardinality`（循环次数）或 `loopCompletionCondition`（循环结束条件）或 `loopInputDataItem`（数组遍历）控制循环。
- **新增** 循环元素注入：`loopInputDataItem`（循环输入数据列表）+ `loopElementVariable`（当前元素变量名），每轮注入当前元素到变量作用域。
- **新增** 循环结果收集：`loopResultVariable`（结果变量名）/ `loopResultType`（Map/List）/ `loopResultKey`（Map key 解析）/ `loopResultValue`（value 解析），每轮结果按类型聚合。
- **新增** 循环间隔：`loopTimeCycle`（循环间隔毫秒），每轮之间等待。
- **新增** 循环防死循环：`loopCardinality` 上限保护（1000）+ `loopCompletionCondition` 求值 + 无配置默认 1 次，避免无限循环。
- **新增** 循环状态与 checkpoint 交互：循环中断后 checkpoint 保存 `loopContext`（iteration/elementIndex/collectedResults），resume 时恢复循环上下文。
- **新增** loop 既有子配置迁移：loader 将既有 `loop` 子配置（loop.over/loop.max_times）标记 deprecated 并忽略（不报错，向后兼容），新循环能力统一由 `loopConfig` 承载。

## 不在范围内（Explicit Non-Goals）

- 不实现分布式 workflow 调度（单实例内 checkpoint）。
- 不实现 `runtime.incremental` 增量执行语义。
- 不实现 workflow durable history（event sourcing）。
- 不引入新 gateway 表，复用既有 `CheckpointStoreGateway`（通过 `runState.saveCheckpoint` 桥接）。
- 不实现 RESTFUL 节点 `batchConfig`（由 `refine-ts-workflow-recipe-v2-contracts` change 独立承载）。
- 不实现嵌套循环（单循环体，嵌套需独立 change）。
- 不将既有 `loop` 子配置自动 normalize 为新 `loopConfig`（仅 deprecated 忽略，用户需手动迁移到 `loopConfig`）。

## Capability 影响（Capabilities）

### 修改的 Capability

- workflow-execution-engine：集成 checkpoint 写入、恢复、controlPolicy 回滚与多节点循环遍历。checkpoint 持久化、resume 恢复、controlPolicy 回滚执行和 loop 循环均为 WorkflowExecutionService.execute() 的行为扩展，不构成独立 capability，归档后沉淀进 openspec/specs/workflow-execution-engine/spec.md。

## 影响范围（Impact）

- agent-contracts/core：WorkflowNodeDefSchema 新增 loopConfig；WorkflowExecutionResumeState 新增 loopContext；新增 WorkflowLoopContext interface。
- agent-workflow/engine：新增 executeLoopPath、resolveControlPolicy 与回滚执行、checkpoint 写入 hook；execute 的 runtime 参数新增 saveCheckpoint 回调。
- agent-core/default-agent：executeRecipeRoute 注入 saveCheckpoint 桥接。
- agent-app/composition：workflow-recipe-loader 的 normalizeNodeDefinition 新增 loop_config 到 loopConfig snake_case normalize 与校验；normalizeRecipeDefinition 补 runtime normalize。
- 测试：checkpoint 写入/恢复、controlPolicy 6 策略、loop 正常/边界/失败降级、YAML snake_case 加载。
- 运维：无新 gateway 表，复用既有 CheckpointStoreGateway；无新配置项。

## 归档前更新基线（Baseline Promotion Plan）

- 行为契约：将 4 个新增 requirement（Checkpoint Persistence / Resume From Checkpoint / ControlPolicy Rollback Execution / Multi-Node Loop Execution）沉淀进 openspec/specs/workflow-execution-engine/spec.md。
- 模块设计：按需更新 openspec/designs/modules/agent-workflow.md（checkpoint 注入路径、executeLoopPath、resolveControlPolicy）。
- 架构导航：按需更新 openspec/designs/architecture/workflow-execution-and-routing.md（持久化与恢复、循环遍历）。
- 导航映射：按需更新 openspec/designs/spec-to-design-map.md。
- 前置依赖：归档前确认 refine-ts-workflow-execution-engine-v2 的 ControlPolicy Resolution 已合入 baseline 或在本 change 归档前先行归档，避免 ControlPolicy requirement 重复。
