## ADDED Requirements

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

### Requirement: Timeout and Retry

engine MUST 支持节点级 timeout 和 retry。

#### Scenario: Retry Exhausted
- **WHEN** 节点重试耗尽
- **THEN** engine MUST 产出失败或跳过结果

### Requirement: Interrupt

engine MUST 通过 `AbortSignal` 响应中断。

#### Scenario: Abort Execution
- **WHEN** `AbortSignal` 被触发
- **THEN** engine MUST 停止继续启动新节点
- **AND** 返回 `INTERRUPTED`

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
