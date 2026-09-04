# human-handoff Specification

## Purpose
TBD - 由归档 change add-ts-human-handoff 创建。归档后更新 Purpose。
## Requirements
### Requirement: 人工接管接受最终答复或恢复指令

NextAgent SHALL 支持 `PendingInputKind.HUMAN_HANDOFF`，用于 runtime 拥有的当前 request run 人工接管。Handoff MUST 复用 pending input 核心 lifecycle，MUST NOT 创建独立的 workbench、assignment queue 或 request lifecycle。

#### Scenario: 人工最终答复完成原 run
- **WHEN** runtime 为一个 `PENDING` 人工 handoff 收到 `[["final_answer"],["<content>"]]`
- **THEN** runtime MUST 把该 pending input resolve 为 `RECEIVED`
- **AND** runtime MUST 以提供的最终答复作为受控 terminal 内容，对原 run 执行 terminal commit
- **AND** runtime MUST NOT 调用模型重新生成该最终答复
- **AND** runtime MUST NOT 创建新的 root request

#### Scenario: 人工恢复指令继续原 run
- **WHEN** runtime 为一个 `PENDING` 人工 handoff 收到 `[["resume_instruction"],["<content>"]]`
- **THEN** runtime MUST 把该 pending input resolve 为 `RECEIVED`
- **AND** runtime MUST 从已保存的 checkpoint 恢复原 run，把提供的指令作为受控继续输入
- **AND** runtime MUST NOT 把该指令当作新的用户消息

#### Scenario: 无效 handoff 答复被拒绝
- **WHEN** 一个人工 handoff 答复不是恰好两个 answer entry：第一个 entry 为 `final_answer` 或 `resume_instruction`，第二个 entry 为一个非空内容字符串
- **THEN** runtime MUST 以安全校验结果拒绝该答复
- **AND** runtime MUST NOT resolve 该 pending input

### Requirement: 人工接管超时和取消不虚构结果

NextAgent SHALL not 在 handoff 未被答复时合成人工最终答复或恢复指令。

#### Scenario: Handoff 超时
- **WHEN** 一个 `HUMAN_HANDOFF` pending input 超时
- **THEN** runtime MUST 把它 resolve 为 `TIMED_OUT`
- **AND** runtime MUST NOT 合成最终答复或恢复指令
- **AND** runtime MUST 以 pending-input 超时结果终态化原 run
- **AND** 可见 terminal reason MUST 为 `PENDING_INPUT_TIMEOUT`

#### Scenario: Handoff 取消
- **WHEN** 人工 handoff 处于 pending 时所属 run 被取消
- **THEN** runtime MUST 把该 handoff pending input resolve 为 `CANCELED`
- **AND** 之后的 handoff 答复 MUST 被拒绝

### Requirement: 人工接管投影是安全的

NextAgent SHALL 只通过安全的 pending input 投影暴露人工 handoff pending 状态。

#### Scenario: Handoff stream 投影
- **WHEN** channel 为 handoff 投影 `USER_INPUT_REQUIRED`、`USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT` 或 `USER_INPUT_CANCELED`
- **THEN** 投影 MUST 使用 pending input id、kind、status 和安全 summary 字段
- **AND** 投影 MUST NOT 暴露 hidden reasoning、原始 operator 备注、identity、idempotency key、assignment metadata 或私有 workbench 状态

### Requirement: 人工接管答复使用 pending 答复权威

NextAgent SHALL 把首版人工 handoff 答复入口保持在 pending input 所使用的同一可信 channel/auth 答复边界上，除非后续的 operator 或 assignment change 定义更窄的权威。

#### Scenario: Handoff 答复权威不是 operator workbench
- **WHEN** 提交一个人工 handoff 答复
- **THEN** runtime MUST 在接受该答复之前校验 owner scope、agent scope、session id、pending input id 和 pending 状态
- **AND** 本 change MUST NOT 定义 operator identity、assignment、claim、queue、workbench、SLA 或外部审查平台
- **AND** 投影 MUST NOT 暴露 operator、assignment 或私有 workbench 状态
- **AND** 人工 handoff 答复 MUST NOT 满足受保护操作的确认或授权

