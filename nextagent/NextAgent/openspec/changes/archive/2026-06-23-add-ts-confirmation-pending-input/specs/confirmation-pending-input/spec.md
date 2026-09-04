## ADDED Requirements

### Requirement: Confirmation pending input 只接受 approve 或 reject

NextAgent SHALL 在一个既有 request run 期间支持用于可信系统确认的 `PendingInputKind.CONFIRMATION`。Confirmation pending input MUST 复用 runtime 拥有的 pending 生命周期，并且 MUST NOT 由 model 输出、客户端 payload 或 capability 私有状态机拥有。

#### Scenario: Confirmation approve
- **WHEN** runtime 收到一个仍为 `PENDING` 的 `CONFIRMATION` pending input 的 `[["approve"]]`
- **THEN** runtime MUST 将该 pending input 解析为 `RECEIVED`
- **AND** runtime MUST 只通过已绑定到 checkpoint 的 confirmation-approved continuation 恢复原始 run
- **AND** runtime MUST NOT 把客户端提供的 metadata 当作确认权威

#### Scenario: Confirmation reject
- **WHEN** runtime 收到一个仍为 `PENDING` 的 `CONFIRMATION` pending input 的 `[["reject"]]`
- **THEN** runtime MUST 将该 pending input 解析为 `RECEIVED`
- **AND** 被确认的 continuation MUST NOT 作为已批准继续
- **AND** runtime MUST 为原始 run 或被确认步骤产生一个安全的未批准结果

#### Scenario: 非法 confirmation answer 被拒绝
- **WHEN** 一个 `CONFIRMATION` answer 不是恰好 `[["approve"]]` 或 `[["reject"]]`
- **THEN** runtime MUST 以安全的校验结果拒绝该 answer
- **AND** runtime MUST NOT 解析该 pending input

### Requirement: Confirmation 不是 authorization

NextAgent SHALL 把 `CONFIRMATION` 限定为低风险的二元 continuation 决策，并且 MUST NOT 将其用作受保护操作的许可。

#### Scenario: 受保护操作不能使用 confirmation
- **WHEN** 一个 continuation 读取敏感信息、调用带副作用的外部系统、改变网络/设备/客户状态、执行受限副作用、依赖 permission scope 或消费风险 policy
- **THEN** 系统 MUST NOT 使用 `CONFIRMATION` 作为批准性 pending input
- **AND** 该流 MUST 使用 `AUTHORIZATION` 或后续显式的 guard/风险 change
- **AND** 一次 confirmation approve MUST NOT 满足受保护操作的授权

### Requirement: Confirmation 超时视为未批准

NextAgent SHALL 将 confirmation 超时视为未批准。

#### Scenario: Confirmation 超时
- **WHEN** 一个 `CONFIRMATION` pending input 超时
- **THEN** runtime MUST 将其解析为 `TIMED_OUT`
- **AND** runtime MUST NOT 将被确认路径作为已批准继续
- **AND** runtime MUST 只暴露一个安全的超时摘要
- **AND** 如果原始 run 或被确认步骤因超时进入终端状态，可见的终端 reason MUST 是 `PENDING_INPUT_TIMEOUT`

### Requirement: Confirmation 没有自定义或多选语义

NextAgent SHALL 保持 confirmation 为一个双状态的系统确认。

#### Scenario: 自定义 confirmation 被拒绝
- **WHEN** 一个 `CONFIRMATION` pending 请求或 answer 试图使用自定义文本、多选或额外 answer 值
- **THEN** runtime MUST 以安全的校验结果拒绝该非法请求或 answer
- **AND** runtime MUST NOT 把自定义文本重新解释为批准
