# workflow-execution-engine 规格增量

## ADDED Requirements

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
