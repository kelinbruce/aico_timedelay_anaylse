# authorization-pending-input Specification

## Purpose
TBD - 由归档 change add-ts-authorization-pending-input 创建。归档后更新 Purpose。
## Requirements
### Requirement: Authorization pending input 门控单个受保护操作

NextAgent SHALL 支持针对当前 request run 内单个受保护操作的 `PendingInputKind.AUTHORIZATION`。Authorization MUST 绑定到 runtime checkpoint/continuation，MUST NOT 由 client payload 字段表示。

#### Scenario: Authorization kind 由可信 guard 选择
- **WHEN** 一个受保护操作在执行前需要人工许可
- **THEN** `AUTHORIZATION` pending input MUST 由可信的 Agent/core lifecycle hook 或 capability guard 在受保护操作开始前产生
- **AND** 该决策 MUST 使用已解析的 capability descriptor 和显式 risk/governance policy
- **AND** runtime MUST NOT 从模型文本、client payload、channel metadata、gateway record 或 capability 参数推断 authorization
- **AND** confirmation 的批准 MUST NOT 满足 authorization

#### Scenario: Authorization approve 只允许被绑定的操作
- **WHEN** runtime 针对一个 `PENDING` authorization 收到 `[["approve"]]`
- **THEN** runtime MUST 把该 pending input resolve 为 `RECEIVED`
- **AND** runtime MUST 只在已 checkpoint 的受保护操作处恢复原 run
- **AND** 该批准 MUST NOT 被复用于后续操作、其他 run、其他 session 或其他 agent
- **AND** 一旦已 checkpoint 的受保护操作恢复或执行，runtime MUST 把该批准视为已消费
- **AND** retry、replay 或 recovery MUST NOT 把同一批准复用于第二个受保护操作

#### Scenario: Authorization deny 阻止该操作
- **WHEN** runtime 针对一个 `PENDING` authorization 收到 `[["deny"]]`
- **THEN** runtime MUST 把该 pending input resolve 为 `RECEIVED`
- **AND** runtime MUST NOT 执行该受保护操作
- **AND** runtime MUST 为原 run 或被 guard 的步骤产生安全的 denied outcome

#### Scenario: 无效 authorization answer 被拒绝
- **WHEN** 一个 authorization answer 不是严格的 `[["approve"]]` 或 `[["deny"]]`
- **THEN** runtime MUST 以安全校验 outcome 拒绝该 answer
- **AND** runtime MUST NOT resolve 该 pending input
- **AND** runtime MUST NOT 执行该受保护操作

### Requirement: Authorization 超时拒绝执行

NextAgent SHALL 把 authorization 超时视为拒绝或安全不执行。

#### Scenario: Authorization 超时阻止操作
- **WHEN** 一个 `AUTHORIZATION` pending input 超时
- **THEN** runtime MUST 把它 resolve 为 `TIMED_OUT`
- **AND** runtime MUST NOT 执行该受保护操作
- **AND** runtime MUST NOT 合成批准
- **AND** 如果原 run 或被 guard 的步骤因超时进入 terminal 状态，可见 terminal reason MUST 为 `PENDING_INPUT_TIMEOUT`

### Requirement: Authorization scope 由 runtime 拥有

NextAgent SHALL 把 authorization scope 保存在 runtime 拥有的 continuation state 中，而不是 client 可见的 pending 字段中。

#### Scenario: Client 不能设置 authorization scope
- **WHEN** client 提交一个 authorization answer
- **THEN** answer payload MUST 只包含 session id、pending input id 和有序 answer 列表
- **AND** runtime MUST 只从已 accepted 的 run、checkpoint 和 pending input 事实派生受保护操作
- **AND** runtime MUST 忽略或拒绝 client 提供的 operation id、permission scope、policy decision、identity 或 capability 参数

