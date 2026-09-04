# workflow-parallel-gateway Specification

## Purpose

Defines concurrent fork / join execution semantics for `parallel-gateway` nodes in the local workflow execution engine, including configurable join behavior (explicit join node, failure strategy, convergence timeout) and safe failure handling.
## Requirements
### Requirement: Parallel Gateway Ownership

`parallel-gateway` MUST be owned by a dedicated capability. Its fork / join, branch barrier, waiting branch, budget and recovery semantics MUST NOT be owned by `workflow-gateway-nodes`.

**触发机制：**
- 由 `WorkflowExecutionService` scheduler 在 `parallel-gateway` 节点 ready 且依赖满足时触发
- 位于 request lifecycle 的 workflow execution 阶段，在 route 决策之后、terminal commit 之前
- 节点 handler 同步求值分支条件，engine 异步并发执行命中分支

**输入与前置条件：**
- 已校验注册的 `RecipeDefinition` 和 `FlowGraph.nodes`
- 当前 execution 的 `contextVariables`、`nodeResults`、`completedNodeIds`
- 可信 `AbortSignal`、owner scope、agent scope
- 可选 `inputs.join_node`、`inputs.join_on_failure`、`inputs.join_timeout`

**输出与副作用：**
- 产出 `WorkflowNodeResult` 生命周期状态（无业务 payload）
- 产出 `WorkflowExecutionEvent`（safe diagnostic，不含敏感数据）
- 产出 `FORK_JOIN` transition 控制信号（含 `branchNodeIds`、`joinNodeId`、`joinOnFailure`、`joinTimeout`）
- 不产生业务 output，不写 model prompt、capability result、knowledge result

**核心判断逻辑：**
1. 按 `next` 声明顺序逐一求值所有分支 condition
2. 收集所有条件为 true 的分支 ID
3. 零命中 -> safe failure `WORKFLOW_PARALLEL_GATEWAY_NO_MATCH`
4. 单分支命中 -> 退化为 `BRANCH` transition
5. 多分支命中 -> 解析 join 节点（`inputs.join_node` 优先，否则默认解析为 end_node）
6. join 解析失败 -> safe failure `WORKFLOW_PARALLEL_GATEWAY_JOIN_UNRESOLVED`
7. 返回 `FORK_JOIN` transition，engine 并发执行所有命中分支

**状态 / 产物契约：**
- `parallel-gateway` 的 `WorkflowNodeResult.output` MUST 为 `undefined`
- safe diagnostic event 只包含 `reasonCode`、`nodeId`、`nodeType`、`waitingBranchCount`、`conditionIndex` 等安全标量
- `FORK_JOIN` transition 是 engine 内部控制信号，不进入 `agent-contracts/core` 公开契约

**流程接入：**
- 上游：engine scheduler（前置节点完成后激活）
- 下游：并发分支执行 -> join 节点 -> 后继节点
- engine 消费 handler 产出的 `FORK_JOIN` 控制信号，不接管 parallel 节点 schema owner

**失败与降级：**
- 零命中分支 -> `WORKFLOW_PARALLEL_GATEWAY_NO_MATCH` safe failure
- join 无法解析 -> `WORKFLOW_PARALLEL_GATEWAY_JOIN_UNRESOLVED` safe failure
- 分支执行失败 -> 按 `join_on_failure` 策略处理（break 立即终止其余分支 / wait 等待全部完成）
- join 超时 -> abort 所有未完成分支，返回 FAILED
- recipe cancel / timeout -> gateway 必须立即停止放行新的下游节点

#### Scenario: Separate Ownership
- **WHEN** the workflow system defines behavioral semantics for `parallel-gateway`
- **THEN** these semantics MUST be owned by `workflow-parallel-gateway`
- **AND** `workflow-gateway-nodes` MUST NOT own them as a requirement

### Requirement: Concurrent Fork/Join Execution

The local workflow execution engine MUST support single-process concurrent `parallel-gateway` fork / join. All selected branches MUST start execution simultaneously, not sequentially.

**触发机制：**
- engine 收到 `FORK_JOIN` transition 后立即并发启动所有命中分支
- 所有分支共享同一个 `AbortController`，父级 cancel 传播到分支

**输入与前置条件：**
- `FORK_JOIN` transition 携带 `branchNodeIds`、`joinNodeId`、`joinOnFailure`、`joinTimeout`
- 所有分支接收相同的 input variables（fork 时刻的快照）

**输出与副作用：**
- 每个分支产出自己的 `WorkflowNodeResult` 序列
- join 点按分支声明顺序合并输出变量
- 同名 key 后声明分支覆盖先声明分支（last-write-wins）

**核心判断逻辑：**
1. 所有分支通过 `Promise.allSettled` 同时启动
2. 每个分支独立执行到 join 节点前停止
3. 分支失败时按 `joinOnFailure` 策略处理
4. 全部分支完成后（或被 abort 后）合并变量
5. 有任何分支失败 -> 按 `join_on_failure` 策略判定（break 立即 FAILED；wait 至少一个分支正常到达 join 则 COMPLETED，全失败才 FAILED）
6. 全部分支完成 -> 从 join 节点继续执行或返回最终状态

**失败与降级：**
- `join_on_failure: "wait"`（默认）：等待所有分支完成，至少一个分支正常到达 join 则整体 COMPLETED，全部分支失败才 FAILED
- `join_on_failure: "break"`：首个分支失败立即 abort 其余分支，整体 FAILED
- `join_timeout` 超时：abort 所有分支，整体 FAILED
- 不得静默吞掉分支异常或 abort 信号

#### Scenario: Execute Multiple Selected Branches Concurrently
- **WHEN** multiple `next` branch conditions of `parallel-gateway` are satisfied
- **THEN** the engine MUST execute all selected branches concurrently within a single process
- **AND** MUST stop each branch before the common join node
- **AND** MUST resume execution from the common join node after all branches complete
- **AND** each branch MUST receive the same input variables at fork time
- **AND** branch output variables MUST be merged in branch declaration order at the join point

#### Scenario: Execute One Selected Branch
- **WHEN** only one `next` branch condition of `parallel-gateway` is satisfied
- **THEN** the engine MUST advance that branch as a normal branch transition

### Requirement: Parallel Gateway Join Configuration

`parallel-gateway` MUST support join behavior configuration via `inputs`, including explicit join node, failure handling strategy and convergence timeout.

**输入与前置条件：**
- `inputs.join_node`：string，可选，指定显式 join 节点 ID；不指定时默认解析为 end_node
- `inputs.join_on_failure`：`"wait"` 或 `"break"`，可选，默认 `"wait"`
- `inputs.join_timeout`：正整数（秒），可选，默认 600 秒

**输出与副作用：**
- 配置通过 `FORK_JOIN` transition 的 `joinNodeId`、`joinOnFailure`、`joinTimeout` 字段传递到 engine

**核心判断逻辑：**
1. `join_node` 非空 -> 使用指定节点作为 join，跳过自动解析；否则默认解析为 end_node
2. `join_on_failure` 为 `"break"` -> 首个失败立即 abort；否则按 `"wait"` 等待所有分支
3. `join_timeout` 为正整数 -> 设置超时定时器；未指定时按默认 600 秒

**失败与降级：**
- `join_node` 指定不存在的节点或不指定且无公共 end_node -> 按 `JOIN_UNRESOLVED` 处理
- `join_on_failure` 值非法 -> 按 `"wait"` 默认值处理
- `join_timeout` 非正数 -> 忽略，使用默认 600 秒

#### Scenario: Explicit Join Node
- **WHEN** `inputs.join_node` of `parallel-gateway` specifies a valid node ID
- **THEN** the engine MUST use that node as the join node instead of auto-resolution

#### Scenario: Join On Failure Break
- **WHEN** `inputs.join_on_failure` is `"break"`
- **AND** a branch execution fails
- **THEN** the engine MUST immediately abort all other in-progress branches
- **AND** the overall execution MUST return FAILED status

#### Scenario: Join On Failure Wait
- **WHEN** `inputs.join_on_failure` is `"wait"` or unspecified
- **AND** one or more branches fail
- **THEN** the engine MUST wait for all branches to complete
- **AND** if at least one branch completes successfully the overall execution MUST return COMPLETED status
- **AND** only when all branches fail MUST the overall execution return FAILED status

#### Scenario: Join Timeout
- **WHEN** `inputs.join_timeout` specifies a positive integer (seconds)
- **AND** not all branches complete within the timeout
- **THEN** the engine MUST abort all in-progress branches
- **AND** the overall execution MUST return FAILED status

#### Scenario: Default Join Timeout
- **WHEN** `inputs.join_timeout` is unspecified
- **THEN** the engine MUST apply a default convergence timeout of 600 seconds

#### Scenario: Default Join Node Is End Node
- **WHEN** `inputs.join_node` is unspecified
- **AND** multiple selected branches share a common end_node
- **THEN** the engine MUST resolve the join node to that common end_node
- **AND** MUST resume execution from the end_node after branches converge

### Requirement: Parallel Gateway Safe Failure

`parallel-gateway` MUST return safe failure for no matching branch and unresolvable join graph.

#### Scenario: No Matching Branch
- **WHEN** `parallel-gateway` has no `next` branch condition satisfied
- **THEN** execution MUST fail safely
- **AND** node safe error MUST use reason code `WORKFLOW_PARALLEL_GATEWAY_NO_MATCH`

#### Scenario: Join Unresolved
- **WHEN** multiple selected branches cannot resolve a common join node
- **OR** `inputs.join_node` is unspecified and no common end_node exists
- **THEN** execution MUST fail safely
- **AND** safe error MUST use reason code `WORKFLOW_PARALLEL_GATEWAY_JOIN_UNRESOLVED`

### Requirement: Parallel Gateway Boundary

`parallel-gateway` first version MUST maintain non-overlapping responsibilities with completed workflow foundation changes.

#### Scenario: Respect Engine And Runtime Owners
- **GIVEN** `workflow-execution-engine` already owns generic scheduling, retry, timeout, cancel, observer
- **AND** `workflow-routing`, `workflow-package-composition` already own dispatch, registry, recipe load
- **WHEN** implementing `parallel-gateway`
- **THEN** this change MUST only own fork / join / branch barrier semantics
- **AND** MUST NOT add pending input, main request dispatch or recipe load owner
- **AND** branch budget / recovery / snapshot contract MUST be defined in a separate follow-up change before implementation

#### Scenario: No Cross-Branch Dependencies Within Concurrent Fork
- **GIVEN** concurrent branches of `parallel-gateway` share a single `nodeResults` array
- **WHEN** a node within a concurrent branch declares `dependsOn` referencing a node in a different concurrent branch
- **THEN** the dependency is unsafe because the referenced node may not have completed yet
- **AND** cross-branch `dependsOn` MUST only be declared after the join node where branches have converged

### Requirement: Deferred Advanced Parallel Semantics

First version `parallel-gateway` MUST NOT introduce advanced parallel recovery semantics.

#### Scenario: Keep First Version Minimal
- **WHEN** the local engine executes `parallel-gateway`
- **THEN** the first version MUST only support single-process concurrent fork / join
- **AND** MUST NOT introduce `branchId`, distributed owner, snapshot/recovery or cross-instance barrier
- **AND** execution-engine MUST only consume control signals produced by the `parallel-gateway` handler, not take over the parallel node schema owner

