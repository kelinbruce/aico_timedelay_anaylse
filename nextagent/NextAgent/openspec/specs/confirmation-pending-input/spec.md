# confirmation-pending-input Specification

## Purpose
待定 - 由归档 change add-ts-confirmation-pending-input 创建。归档后更新 Purpose。
## Requirements
### Requirement: 确认 pending input 只接受 approve 或 reject

NextAgent SHALL 在既有 request run 内支持用于可信系统确认的 `PendingInputKind.CONFIRMATION`。确认 pending input MUST 复用 runtime 拥有的 pending 生命周期，MUST NOT 由模型输出、client payload 或 capability 私有状态机拥有。

#### Scenario: 确认 approve
- **WHEN** runtime 为一个仍处于 `PENDING` 的 `CONFIRMATION` pending input 收到 `[["approve"]]`
- **THEN** runtime MUST 把该 pending input resolve 为 `RECEIVED`
- **AND** runtime MUST 只通过已绑定到 checkpoint 的 confirmation-approved continuation 恢复原 run
- **AND** runtime MUST NOT 把 client 提供的 metadata 当作确认 authority

#### Scenario: 确认 reject
- **WHEN** runtime 为一个仍处于 `PENDING` 的 `CONFIRMATION` pending input 收到 `[["reject"]]`
- **THEN** runtime MUST 把该 pending input resolve 为 `RECEIVED`
- **AND** 被确认的 continuation MUST NOT 以 approved 方式继续
- **AND** runtime MUST 为原 run 或被确认步骤产生安全的非批准结果

#### Scenario: 非法确认答案被拒绝
- **WHEN** 一个 `CONFIRMATION` 答案不严格等于 `[["approve"]]` 或 `[["reject"]]`
- **THEN** runtime MUST 以安全的校验结果拒绝该答案
- **AND** runtime MUST NOT resolve 该 pending input

### Requirement: 确认不是授权

NextAgent SHALL 把 `CONFIRMATION` 限制在低风险的二元继续决策上，MUST NOT 把它用作受保护操作的许可。

#### Scenario: 受保护操作不能使用确认
- **WHEN** 一个 continuation 读取敏感信息、调用带副作用的外部系统、改变网络/设备/客户状态、执行受限副作用、依赖 permission scope 或消费 risk policy
- **THEN** 系统 MUST NOT 使用 `CONFIRMATION` 作为批准性 pending input
- **AND** 该 flow MUST 使用 `AUTHORIZATION` 或后续显式的 guard/risk change
- **AND** 一次确认 approve MUST NOT 满足受保护操作的授权

### Requirement: 确认超时是非批准

NextAgent SHALL 把确认超时视为非批准。

#### Scenario: 确认超时
- **WHEN** 一个 `CONFIRMATION` pending input 超时
- **THEN** runtime MUST 把它 resolve 为 `TIMED_OUT`
- **AND** runtime MUST NOT 以 approved 方式继续被确认的路径
- **AND** runtime MUST 只暴露安全的超时摘要
- **AND** 如果原 run 或被确认步骤因超时进入终态，可见的 terminal reason MUST 为 `PENDING_INPUT_TIMEOUT`

### Requirement: 确认没有自定义或多选语义

NextAgent SHALL 把确认保持为两态的系统确认。

#### Scenario: 自定义确认被拒绝
- **WHEN** 一个 `CONFIRMATION` pending request 或答案试图使用自定义文本、多个选项或额外的答案值
- **THEN** runtime MUST 以安全的校验结果拒绝该非法 request 或答案
- **AND** runtime MUST NOT 把自定义文本重新解释为批准

