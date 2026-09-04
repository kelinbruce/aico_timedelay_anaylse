## ADDED Requirements

### Requirement: Human handoff 接受最终答案或恢复指令

NextAgent SHALL 支持 `PendingInputKind.HUMAN_HANDOFF`，用于 runtime 所拥有的当前 request run 的人工接管。Handoff MUST 复用 pending input core 生命周期，并 MUST NOT 创建独立的 workbench、assignment queue 或 request lifecycle。

#### Scenario: 人工最终答案完成原始 run
- **WHEN** runtime 为一个 `PENDING` 的 human handoff 收到 `[["final_answer"],["<content>"]]`
- **THEN** runtime MUST 将该 pending input resolve 为 `RECEIVED`
- **AND** runtime MUST 以提供的人工最终答案作为受控 terminal content，对原始 run 执行 terminal commit
- **AND** runtime MUST NOT 调用 model 重新生成该最终答案
- **AND** runtime MUST NOT 创建新的根 request

#### Scenario: 人工恢复指令继续原始 run
- **WHEN** runtime 为一个 `PENDING` 的 human handoff 收到 `[["resume_instruction"],["<content>"]]`
- **THEN** runtime MUST 将该 pending input resolve 为 `RECEIVED`
- **AND** runtime MUST 以提供的指令作为受控 continuation input，从已保存的 checkpoint 恢复原始 run
- **AND** runtime MUST NOT 将该指令当作新的用户 message

#### Scenario: 非法 handoff 答案被拒绝
- **WHEN** human handoff 答案不是恰好两个 answer entry，即第一项为 `final_answer` 或 `resume_instruction`、第二项为一个非空 content 字符串
- **THEN** runtime MUST 以安全的校验结果拒绝该答案
- **AND** runtime MUST NOT resolve 该 pending input

### Requirement: Human handoff 超时与取消不得虚构结果

当 handoff 未被回答时，NextAgent SHALL not 合成人工最终答案或恢复指令。

#### Scenario: Handoff 超时
- **WHEN** 一个 `HUMAN_HANDOFF` pending input 超时
- **THEN** runtime MUST 将其 resolve 为 `TIMED_OUT`
- **AND** runtime MUST NOT 合成最终答案或恢复指令
- **AND** runtime MUST 以 pending-input 超时结果 terminalize 原始 run
- **AND** 可见的 terminal reason MUST 为 `PENDING_INPUT_TIMEOUT`

#### Scenario: Handoff 取消
- **WHEN** 拥有该 pending human handoff 的 run 被取消
- **THEN** runtime MUST 将该 handoff pending input resolve 为 `CANCELED`
- **AND** 后续的 handoff 答案 MUST 被拒绝

### Requirement: Human handoff 投影是安全的

NextAgent SHALL 仅通过安全的 pending input 投影暴露 human handoff pending 状态。

#### Scenario: Handoff stream 投影
- **WHEN** channel 为 handoff 投影 `USER_INPUT_REQUIRED`、`USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT` 或 `USER_INPUT_CANCELED`
- **THEN** 投影 MUST 使用 pending input id、kind、status 和安全的 summary 字段
- **AND** 投影 MUST NOT 暴露隐藏 reasoning、原始 operator 备注、identity、idempotency key、assignment 元数据或私有 workbench 状态

### Requirement: Human handoff 答案使用 pending answer 权限

NextAgent SHALL 让首个 release 的 human handoff 答案入口保持在 pending input 所使用的同一可信 channel/auth 答案边界上，除非后续的 operator 或 assignment 变更定义更窄的权限。

#### Scenario: Handoff 答案权限不是 operator workbench
- **WHEN** 提交一个 human handoff 答案
- **THEN** runtime MUST 在接受该答案前校验 owner scope、agent scope、session id、pending input id 和 pending 状态
- **AND** 本 change MUST NOT 定义 operator identity、assignment、claim、queue、workbench、SLA 或外部 review 平台
- **AND** 投影 MUST NOT 暴露 operator、assignment 或私有 workbench 状态
- **AND** human handoff 答案 MUST NOT 满足受保护操作的确认或授权
