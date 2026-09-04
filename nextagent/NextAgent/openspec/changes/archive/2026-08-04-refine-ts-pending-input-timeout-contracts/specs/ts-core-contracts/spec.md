## REMOVED Requirements

### Requirement: Pending input gateway 事实查询

Core contracts SHALL 以事实查询扩展 `PendingInputStoreGateway`，让 runtime 能检查持久化的 pending input 状态，而不向 channel、core、capability 或 model 暴露 adapter 私有查询或生命周期决策。

#### Scenario: Runtime 为 session lane 加载 active pending input
- **WHEN** runtime 需要判断某个 owner+agent scope 的 session 是否已有 active pending input
- **THEN** runtime MUST 调用 `PendingInputStoreGateway.loadActivePendingInput`
- **AND** 该 request MUST 包含受信的 `tenantId`、`subjectId`、`agentId` 和 `sessionId`
- **AND** gateway MUST 最多返回一条状态为 `PENDING` 的 `PendingInputRecord`
- **AND** gateway 实现 MUST 强制或检测“一个 tenant+subject+agent+session scope 最多只有一个 `PENDING` pending input”这一不变量
- **AND** local gateway 实现 MUST 使用 adapter 私有的 partial unique index 或等价 scoped 约束来约束 active pending 记录
- **AND** `loadActivePendingInput` MUST NOT 用 `ORDER BY` 或 `LIMIT 1` 任意选择一条 active 行
- **AND** 若检测到同一 scope 存在多个 active pending 事实，runtime 或 gateway MUST 将其视为不变量违反，并通过既有安全冲突规范化路径 fail closed
- **AND** 多个 active pending 事实 MUST NOT 仅通过日志或 metric 上报
- **AND** gateway MUST NOT 决定 submit、answer、cancel、timeout 或 recovery 是否应继续

#### Scenario: Runtime 列出到期待超时的 pending input
- **WHEN** runtime 超时或恢复代码需要找到超时时间已过的 pending input
- **THEN** runtime MUST 调用 `PendingInputStoreGateway.listDuePendingInputs`
- **AND** 该 request MUST 包含 `now` 和一个正的有界 `limit`
- **AND** gateway MUST 只返回状态为 `PENDING` 且 `timeoutAt` 小于等于 `now` 的 `PendingInputRecord` 事实
- **AND** 返回的记录 MUST 使用确定性的排序：先按 `timeoutAt` 升序、再按稳定 pending input id 升序，或 adapter 等价的稳定排序
- **AND** 每条返回的记录 MUST 携带 runtime 应用 scoped 超时处理所需的 tenant、subject、agent、session、run 和 checkpoint 坐标
- **AND** local gateway 实现 MUST 用 adapter 私有的索引存储支撑到期过滤，例如私有 `timeout_at` 列/索引或等价索引结构
- **AND** 到期查询实现 MUST NOT 依赖无界的 JSON/全表扫描，也 MUST NOT 把 adapter 私有的超时索引暴露为新的 `PendingInputRecord` 业务字段
- **AND** `listDuePendingInputs` MUST 只观察被接受的 `timeoutAt` 事实，MUST NOT 计算、延长、缩短或以其他方式决定超时策略
- **AND** 该查询 MUST 是 runtime 内部的，MUST NOT 通过 Web/channel、Agent Core、model、capability 或面向 client 的 contract 暴露
