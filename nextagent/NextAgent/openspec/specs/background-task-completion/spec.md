# background-task-completion Specification

## Purpose

Define background task completion continuation behavior, including natural completion recording and explicit kill continuation boundaries.
## Requirements
### Requirement: 后台任务完成通知边界

系统 MUST 将后台任务的自然完成与用户显式终止区分处理。自然完成只记录任务终态并写入关联 session timeline，MUST NOT 创建新的 RequestRun、持久化新的 USER 消息或调用 RuntimeCommandPort.submit。用户通过受信任 channel 显式 kill 仍处于运行中的后台任务后，系统 MUST 至多提交一条与该 taskId 绑定幂等键的通知续跑请求，使 Agent 可获知该显式操作。

#### Scenario: 普通 Bash 前台执行自然完成
- **WHEN** 本地后台化执行通道承载的普通 Bash 前台调用以退出码结束
- **THEN** 系统记录该任务的完成或失败状态和关联 timeline event
- **AND** 系统不提交后台任务通知续跑请求
- **AND** 原 RequestRun 可继续处理该 Bash 调用的结果

#### Scenario: 用户显式终止运行中的后台任务
- **WHEN** 受信任 Web channel 成功 kill 一个仍处于运行中的后台任务
- **THEN** 系统将任务标记为 KILLED
- **AND** 系统以该 taskId 的幂等键至多提交一条通知续跑请求
