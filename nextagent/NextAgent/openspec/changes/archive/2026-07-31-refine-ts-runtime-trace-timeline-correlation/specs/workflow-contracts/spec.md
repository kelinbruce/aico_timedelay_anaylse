# workflow-contracts 规格增量

## ADDED Requirements

### Requirement: WorkflowExecutionEvent 本地执行关联

既有 `WorkflowExecutionEvent` MUST 接受 OPTIONAL `nodeExecutionId` 和 `predecessorNodeExecutionIds`，以保持 remote workflow transport 兼容。本地工作流真实执行节点发出的每个 event MUST 包含 `nodeExecutionId` 和 `predecessorNodeExecutionIds`；START/END 脚手架 event MUST 省略这两个执行关联字段。`nodeExecutionId` 和每个前驱成员 MUST 长度为 1 至 128，并 MUST 只包含 ASCII 字母、数字、点、下划线、冒号或连字符。同一真实执行节点实例的 START、增量和 TERMINAL event MUST 使用相同 `nodeExecutionId` 和前驱列表。不同重试尝试、循环迭代或子流程节点实例 MUST 使用不同 `nodeExecutionId`。

`predecessorNodeExecutionIds` MUST 表示实际选择控制流中的全部直接前驱执行实例。入口节点 MUST 使用空数组。数组 MUST 按 recipe 转换的确定顺序排列并去重，MUST 至多包含 128 个成员。并行汇聚 MUST 保留全部直接前驱，MUST NOT 按 event 到达或完成时间选择最后一个分支。

既有安全字段、`input`、`output` 和 `visibleDelta` 语义 MUST 保持不变；本 requirement MUST NOT 把 input/output 注入 timeline 权威执行 span attribute，也 MUST NOT 改变 remote workflow 的必填字段。

#### Scenario: 顺序节点携带实际前驱

- **WHEN** 本地工作流依次执行节点实例 A 和 B
- **THEN** A 的 event MUST 携带 `predecessorNodeExecutionIds=[]`
- **AND** B 的 event MUST 携带 `predecessorNodeExecutionIds=[A.nodeExecutionId]`

#### Scenario: 并行汇聚携带全部前驱

- **WHEN** 节点实例 B 和 C 并行执行后汇聚到 D
- **THEN** D 的 event MUST 同时携带 B 和 C 的 nodeExecutionId
- **AND** 成员顺序 MUST 由 recipe 分支声明顺序决定

#### Scenario: 重试具有独立执行标识

- **WHEN** 节点尝试失败并开始下一次重试
- **THEN** 两次尝试 MUST 使用不同 `nodeExecutionId`
- **AND** 每次尝试的 START 和 TERMINAL MUST 使用自身标识

#### Scenario: remote event 保持兼容

- **WHEN** remote workflow event 没有提供 nodeExecutionId 或 predecessorNodeExecutionIds
- **THEN** contract schema MUST 接受该 event
- **AND** 系统 MUST 不为该 event 创建本地节点 timeline 权威执行 span

#### Scenario: START 和 END 脚手架不携带执行关联

- **WHEN** 本地工作流发出 START 的 `NODE_STARTED` 或 END 的 `NODE_COMPLETED`
- **THEN** 对应 event MUST 省略 `nodeExecutionId` 和 `predecessorNodeExecutionIds`
- **AND** 系统 MUST 不为该 event 创建或结束 timeline 权威执行 span
- **AND** trace 启用且 request span 可解析时，投影后的 timeline event MUST 复用 request span snapshot

### Requirement: 工作流前驱 MUST 投影为 previewSpanIds

trace 启用时，本地工作流真实执行节点 START event 的每个 `predecessorNodeExecutionIds` 成员 MUST 解析到同一 request trace 中的权威节点 span。全部成员解析成功时，系统 MUST 按输入顺序去重并保存为 `inlinePayload.trace.previewSpanIds`。第一个真实执行节点 MUST 保存空数组；START/END 脚手架不参与前驱解析。

任一前驱缺失、无效、属于其他 trace、等于当前节点 span，或完整列表超过 128 个成员时，系统 MUST 整体省略 `previewSpanIds` 并产生有界安全降级证据。系统 MUST NOT 保存部分列表，也 MUST NOT 根据 timeline sequence、event 时间或 span 完成时间推断前驱。

同一节点实例的 START 和 TERMINAL event MUST 保存相同 `previewSpanIds`。

#### Scenario: 入口节点保存空列表

- **WHEN** 本地入口节点没有直接前驱且 trace 已启用
- **THEN** START 和 TERMINAL event MUST 包含 `previewSpanIds=[]`

#### Scenario: 结束的并行前驱仍可解析

- **WHEN** 并行分支 B 和 C 已结束，汇聚节点 D 随后开始
- **THEN** D 的 previewSpanIds MUST 包含 B 和 C 的 spanId
- **AND** 前驱 span 结束 MUST 不导致 registry 在 request 终止前丢失其最小关联

#### Scenario: 跨 trace 前驱被整体拒绝

- **WHEN** 任一前驱执行标识解析到其他 trace
- **THEN** 当前节点 event MUST 省略 previewSpanIds
- **AND** 系统 MUST 不保存跨 trace 控制边
