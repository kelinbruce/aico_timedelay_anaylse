## ADDED Requirements

### Requirement: Runtime resolve pending input 超时

NextAgent SHALL 在 runtime 内部基于持久 pending input 事实 resolve pending input 超时。超时行为 MUST NOT 作为字段持久化在 `PendingInput`、`PendingInputRequest`、`PendingInputAnswer` 或 gateway record 上。

#### Scenario: Runtime 拥有超时决策
- **WHEN** runtime 接受一个 pending input intent
- **THEN** runtime MUST 使用 runtime pending 生命周期时钟计算并校验被接受的 `timeoutAt`
- **AND** producer 提供的 `timeoutAt` MUST 只被当作请求的显式超时，而不是超时 policy 的权威来源
- **AND** client payload、model 输出、channel 元数据和 gateway record MUST NOT 定义或覆盖超时 policy
- **AND** 本 change MUST NOT 引入按 agent、按 kind、按租户、client 提供、gateway 推导、model 提供或可配置的超时 policy

#### Scenario: 分配默认超时
- **WHEN** runtime 创建一个不带显式 `timeoutAt` 的 pending input
- **THEN** runtime MUST 从创建时间起分配 30 分钟的默认超时
- **AND** 被分配的 `timeoutAt` MUST 持久化在 pending input 事实上，并在安全请求中投影

#### Scenario: 显式超时有边界
- **WHEN** runtime 收到一个带显式 `timeoutAt` 的 pending input intent
- **THEN** runtime MUST 仅在它晚于创建时间且距创建时间不超过 24 小时时接受它，以 runtime pending 生命周期时钟度量
- **AND** runtime MUST 以安全校验 outcome 拒绝非法或更长的超时请求

#### Scenario: 到期超时从持久事实中发现
- **WHEN** runtime 超时或恢复处理运行时
- **THEN** runtime MUST 通过 `PendingInputStoreGateway.listDuePendingInputs` 查询到期的 pending 事实
- **AND** runtime MUST 使用 compare-and-set 语义将每个仍为 `PENDING` 的到期事实 resolve 为 `TIMED_OUT`
- **AND** runtime MUST 容忍已被其他路径回答、取消或超时的记录

### Requirement: 超时可见并拒绝迟到答案

NextAgent SHALL 将超时作为 pending input 生命周期事件暴露，并拒绝所有迟到答案。

#### Scenario: 超时发布安全事件
- **WHEN** runtime 将一个 pending input resolve 为 `TIMED_OUT`
- **THEN** runtime MUST 发布 canonical `USER_INPUT_TIMEOUT`
- **AND** stream 投影 MUST 只暴露 pending input id、kind、status 和安全的 summary 字段
- **AND** stream 投影 MUST NOT 暴露原始 prompt、原始答案、model 格式化答案、identity、幂等 key 或超时行为

#### Scenario: 超时后的迟到答案被拒绝
- **WHEN** channel 为一个已被 resolve 为 `TIMED_OUT` 的 pending input 提交答案
- **THEN** runtime MUST 以安全的超时/冲突 outcome 拒绝该答案
- **AND** runtime MUST NOT 恢复原始 run
- **AND** runtime MUST NOT 将已超时的 pending input 事实改回 `RECEIVED`

### Requirement: 超时绝不自动批准

NextAgent SHALL 绝不将超时视为对任何 pending input kind 的批准。

#### Scenario: Confirmation 超时不是批准
- **WHEN** 一个 `CONFIRMATION` pending input 超时
- **THEN** runtime MUST 将结果视为未批准
- **AND** 受保护的继续执行 MUST NOT 像用户已批准那样继续
- **AND** 如果原始 run 或被确认的步骤因超时被 terminalize，可见 terminal reason MUST 为 `PENDING_INPUT_TIMEOUT`

#### Scenario: Authorization 超时不是批准
- **WHEN** 一个 `AUTHORIZATION` pending input 超时
- **THEN** runtime MUST 将结果视为拒绝或安全不执行
- **AND** 受保护操作 MUST NOT 执行
- **AND** 如果原始 run 或被 guard 的步骤因超时被 terminalize，可见 terminal reason MUST 为 `PENDING_INPUT_TIMEOUT`

#### Scenario: Question 与 handoff 超时不虚构答案
- **WHEN** 一个 `QUESTION` 或 `HUMAN_HANDOFF` pending input 超时
- **THEN** runtime MUST NOT 合成用户答案、最终答案或恢复指令
- **AND** runtime MUST 通过为该 kind 定义的超时 outcome 将原始 run terminalize
- **AND** 可见 terminal reason MUST 为 `PENDING_INPUT_TIMEOUT`
