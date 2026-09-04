## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: ControlPolicy Resolution
engine MUST 解析 `runtime.controlPolicy`，但本 change 仅实现 `cancel` 和 `STOP` 语义：

- `controlPolicy.cancel.strategy` 为 `STOP` 或未配置 cancel 时，MUST 直接终止流程。
- `ROLLBACK_*` 策略的回滚执行 MUST 延期到 `add-ts-workflow-persistence-recovery`。

#### Scenario: Cancel Stops Flow
- **WHEN** 流程被取消且 `controlPolicy.cancel` 未配置
- **THEN** engine MUST 终止流程，status 为 `INTERRUPTED`

### Requirement: DependsOn Validation

节点执行前 MUST 校验 `dependsOn` 引用的节点均已完成：

- 若 `dependsOn` 中某节点不在 `nodeResults` 或状态非 `NODE_COMPLETED`，MUST 抛 `WORKFLOW_DEPENDENCY_NOT_SATISFIED` SafeError。
- 本 change MUST NOT 实现并行 DAG 调度，`dependsOn` 仅做前置校验。

#### Scenario: Dependency Not Satisfied
- **WHEN** 节点 A 声明 `dependsOn: ["node-b"]` 且 node-b 未执行
- **THEN** engine MUST 抛 `WORKFLOW_DEPENDENCY_NOT_SATISFIED`
