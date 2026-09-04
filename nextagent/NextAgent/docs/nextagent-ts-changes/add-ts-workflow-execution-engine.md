# add-ts-workflow-execution-engine

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：P3 — Workflow 执行范式

状态：candidate
类型：实施 change
主要 owner：`agent-workflow`
依赖：`add-ts-workflow-engine-contracts`

目标：
- 实现单实例、内存态、最小 workflow execution engine。
- 提供 gateway control semantics 所需的调度能力，但不拥有具体 gateway 节点语义。

规格输入：

- engine 承接 `WorkflowExecutionService.execute()`。
- 支持最小 graph 调度能力：
  - 顺序推进
  - 条件分支选择
  - 单进程受控并发
  - 终止聚合
- 支持节点级 timeout / retry。
- timeout 时长、retry 次数、retry 等待间隔均可配，timeout 支持长期等待。
- 节点失败按固定优先级链处理：retry -> exception -> onError -> FAILED；exception 映射求值委托 exclusive-gateway condition evaluator，onError 为框架跳转能力。
- 支持 `AbortSignal` 中断。
- 发出安全的 `WorkflowExecutionEvent`。
- `start-event`、`end-event`、`parallel-gateway`、`exclusive-gateway` 的具体节点语义和 handler 注册归 `add-ts-workflow-gateway-nodes`。

实现约束：

- 本 change 只承接单实例内存态执行。
- 本 change 只定义 scheduler 如何消费 gateway control semantics，不直接拥有 `start/end/parallel/exclusive` 节点语义。
- 本 change 不得定义 distributed scheduling / multi-owner claim；后置到 `add-ts-workflow-distributed-execution`。
- 本 change 不得定义 snapshot / resume / recovery；后置到 `add-ts-workflow-persistence-recovery`。
- 本 change 不得定义 loop 控制流；后置到 `add-ts-workflow-loop-control`。
- 本 change 不得定义 rollback / degrade durable semantics；后置到 `add-ts-workflow-persistence-recovery`。
- engine 只发事件，不拥有 observability sink。

非目标：

- 多实例执行
- workflow 持久化恢复
- durable history query
- rollback / degrade / saga
- loop / interrupt-gateway 扩展控制流

验收要点：

- integration test：线性路径执行
- integration test：gateway handler 提供分支/并发/终止信息时，scheduler 正确推进
- integration test：timeout / retry / interrupt
- contract test：事件安全字段约束

并行边界：

- gateway 节点具体语义和 handler owner 在 `add-ts-workflow-gateway-nodes`
- persistence/recovery 不属于本 change
- distributed execution 不属于本 change
- advanced control flow 不属于本 change
