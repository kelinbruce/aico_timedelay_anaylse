## REMOVED Requirements

### Requirement: Runtime 解析 pending input 超时

NextAgent SHALL 在 runtime 内基于持久化的 pending input 事实解析超时。超时行为 MUST NOT 作为字段持久化在 `PendingInput`、`PendingInputRequest`、`PendingInputAnswer` 或 gateway record 上。

#### Scenario: Runtime 拥有超时决策
- **WHEN** runtime 接受一个 pending input intent
- **THEN** runtime MUST 使用 runtime pending lifecycle 时钟计算并校验被接受的 `timeoutAt`
- **AND** producer 提供的 `timeoutAt` MUST 仅被视为请求的显式超时，而不是超时策略权威
- **AND** client payload、模型输出、channel metadata 和 gateway record MUST NOT 定义或覆盖超时策略
- **AND** 本变更 MUST NOT 引入按 agent、按 kind、按 tenant、client 提供、gateway 推导、模型提供或可配置的超时策略

#### Scenario: 分配默认超时
- **WHEN** runtime 创建一个没有显式 `timeoutAt` 的 pending input
- **THEN** runtime MUST 从创建时间起分配 30 分钟的默认超时
- **AND** 分配的 `timeoutAt` MUST 持久化在 pending input 事实上，并在安全请求中投影

#### Scenario: 显式超时有界
- **WHEN** runtime 收到一个带显式 `timeoutAt` 的 pending input intent
- **THEN** runtime MUST 仅在它晚于创建时间且距创建时间不超过 24 小时时才接受，以 runtime pending lifecycle 时钟度量
- **AND** runtime MUST 以安全的校验结果拒绝非法或更长的超时请求

#### Scenario: 到期超时从持久化事实中发现
- **WHEN** runtime 超时或恢复处理运行时
- **THEN** runtime MUST 通过 `PendingInputStoreGateway.listDuePendingInputs` 查询到期的 pending 事实
- **AND** runtime MUST 使用 compare-and-set 语义把每个仍为 `PENDING` 的到期事实解析为 `TIMED_OUT`
- **AND** runtime MUST 容忍已被其他路径回答、取消或超时的记录

### Requirement: 超时可见且拒绝迟到回答

NextAgent SHALL 把超时暴露为 pending input 生命周期事件，并拒绝所有迟到回答。

#### Scenario: 超时发布安全事件
- **WHEN** runtime 把一个 pending input 解析为 `TIMED_OUT`
- **THEN** runtime MUST 发布 canonical `USER_INPUT_TIMEOUT`
- **AND** stream 投影 MUST 只暴露 pending input id、kind、status 和安全摘要字段
- **AND** stream 投影 MUST NOT 暴露原始 prompt、原始回答、模型格式化回答、identity、idempotency key 或超时行为

#### Scenario: 超时后的迟到回答被拒绝
- **WHEN** channel 为一个已被解析为 `TIMED_OUT` 的 pending input 提交回答
- **THEN** runtime MUST 以安全的超时/冲突结果拒绝该回答
- **AND** runtime MUST NOT 恢复原始 run
- **AND** runtime MUST NOT 把已超时的 pending input 事实改回 `RECEIVED`
