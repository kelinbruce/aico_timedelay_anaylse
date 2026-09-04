## ADDED Requirements

### Requirement: Authorization pending input 只为一个受保护操作把关

NextAgent SHALL 在当前 request run 内支持用于单个受保护操作的 `PendingInputKind.AUTHORIZATION`。授权 MUST 绑定到 runtime checkpoint/continuation，并且 MUST NOT 由客户端 payload 字段表达。

#### Scenario: Authorization kind 由可信 guard 选择
- **WHEN** 一个受保护操作在执行前需要人工许可
- **THEN** `AUTHORIZATION` pending input MUST 由可信的 Agent/core 生命周期 hook 或 capability guard 在受保护操作开始之前产生
- **AND** 该决策 MUST 使用解析出的 capability descriptor 和显式的风险/治理 policy
- **AND** runtime MUST NOT 从 model 文本、客户端 payload、channel metadata、gateway record 或 capability 参数推断授权
- **AND** confirmation 批准 MUST NOT 满足授权

#### Scenario: Authorization approve 只允许被绑定的操作
- **WHEN** runtime 收到一个 `PENDING` authorization 的 `[["approve"]]`
- **THEN** runtime MUST 将该 pending input 解析为 `RECEIVED`
- **AND** runtime MUST 只在 checkpoint 的受保护操作处恢复原始 run
- **AND** 该批准 MUST NOT 被复用于后续操作、其他 run、其他 session 或其他 agent
- **AND** 一旦 checkpoint 的受保护操作恢复或执行，runtime MUST 将该批准视为已消费
- **AND** retry、replay 或 recovery MUST NOT 将同一批准复用于第二个受保护操作

#### Scenario: Authorization deny 阻止该操作
- **WHEN** runtime 收到一个 `PENDING` authorization 的 `[["deny"]]`
- **THEN** runtime MUST 将该 pending input 解析为 `RECEIVED`
- **AND** runtime MUST NOT 执行该受保护操作
- **AND** runtime MUST 为原始 run 或受 guard 保护的步骤产生一个安全的拒绝结果

#### Scenario: 非法 authorization answer 被拒绝
- **WHEN** 一个 authorization answer 不是恰好 `[["approve"]]` 或 `[["deny"]]`
- **THEN** runtime MUST 以安全的校验结果拒绝该 answer
- **AND** runtime MUST NOT 解析该 pending input
- **AND** runtime MUST NOT 执行该受保护操作

### Requirement: Authorization 超时拒绝执行

NextAgent SHALL 将 authorization 超时视为拒绝或安全的不执行。

#### Scenario: Authorization 超时阻止操作
- **WHEN** 一个 `AUTHORIZATION` pending input 超时
- **THEN** runtime MUST 将其解析为 `TIMED_OUT`
- **AND** runtime MUST NOT 执行该受保护操作
- **AND** runtime MUST NOT 合成批准
- **AND** 如果原始 run 或受 guard 保护的步骤因超时进入终端状态，可见的终端 reason MUST 是 `PENDING_INPUT_TIMEOUT`

### Requirement: Authorization scope 由 runtime 拥有

NextAgent SHALL 把 authorization scope 保存在 runtime 拥有的 continuation 状态中，而不是客户端可见的 pending 字段中。

#### Scenario: 客户端不能设置 authorization scope
- **WHEN** 客户端提交一个 authorization answer
- **THEN** answer payload MUST 只包含 session id、pending input id 和有序 answer
- **AND** runtime MUST 只从已接受的 run、checkpoint 和 pending input 事实推导受保护操作
- **AND** runtime MUST 忽略或拒绝客户端提供的操作 id、permission scope、policy 决策、身份或 capability 参数
