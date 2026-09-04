## 背景与问题（Why）

workflow contract、package 和 dispatch 就位后，还需要一个最小 execution engine 承接 `WorkflowExecutionService.execute()`。

本 change 只交付单实例、内存态、最小控制流的 engine，不承担 persistence/recovery 或 distributed scheduling。

## 变更范围（What Changes）

- **实现** 单实例内存态 `WorkflowExecutionService`
- **实现** 最小调度能力：
  - 顺序推进
  - gateway control semantics 消费
  - 基础 timeout / retry
- **产出** `WorkflowExecutionEvent`

## 不在范围内（Explicit Non-Goals）

- 不定义 `start-event`、`end-event`、`parallel-gateway`、`exclusive-gateway` 的具体节点语义或 handler owner
- 不实现 distributed scheduling
- 不实现 snapshot / resume / recovery
- 不实现 rollback / degrade / saga
- 不实现 workflow durable history

## Capability 影响（Capabilities）

### 新增 Capability

- `workflow-execution-engine`

### 修改的 Capability

- `WorkflowExecutionService` 从 contract 进入最小实现
