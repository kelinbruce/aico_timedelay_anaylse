# agent-web-background-task-panel Specification Delta

## ADDED Requirements

### Requirement: 后台任务面板展示实时任务状态

agent web 前端 SHALL 提供一个后台任务面板，列出当前 session 的后台任务，数据来源为通过既有 timeline event stream 订阅到的 `BACKGROUND_TASK_STARTED`、`BACKGROUND_TASK_COMPLETED` 和 `BACKGROUND_TASK_FAILED` timeline 事件。面板 SHALL 按任务展示：task id、低基数 command name、实时状态（`RUNNING` / `COMPLETED` / `FAILED`）、开始时间，以及到达 terminal 状态时的 exit code。面板 SHALL 随事件到达实时更新，不要求手动刷新。

#### Scenario: 面板渲染运行中和已完成的任务

- **WHEN** 前端先收到一条 `BACKGROUND_TASK_STARTED` 事件，随后又收到同一 task id 的 `BACKGROUND_TASK_COMPLETED` 事件
- **THEN** 面板 MUST 展示该任务从 `RUNNING` 转换为 `COMPLETED`
- **AND** 已完成条目 MUST 显示 exit code

#### Scenario: 空面板隐藏视图

- **WHEN** 当前 session 没有后台任务
- **THEN** 面板 MUST NOT 渲染任何任务条目

### Requirement: 后台任务完成通知用户

当前端收到 `BACKGROUND_TASK_COMPLETED` 或 `BACKGROUND_TASK_FAILED` 事件时，SHALL 向用户呈现一条完成通知，其中包含 command name、terminal 状态和 exit code。通知 MUST NOT 包含 raw command 文本或 raw channel 输出。

#### Scenario: 已完成任务触发通知

- **WHEN** 一条 `BACKGROUND_TASK_COMPLETED` 事件到达
- **THEN** MUST 显示一条包含 command name 和 exit code 的通知
- **AND** 通知 MUST NOT 包含 raw command line 或 stdout/stderr 内容

### Requirement: 后台任务事件安全且仅限本地

`BACKGROUND_TASK_*` timeline 事件 payload SHALL 只包含安全的低基数字段：task id、command name、status、startedAt、finishedAt、exitCode、stdoutRef 和 stderrRef。payload MUST NOT 包含 raw command 文本、raw stdout、raw stderr、脚本内容或 host 路径。后端 SHALL 只在 local deployment 中发出这些事件；在 remote deployment 中 SHALL NOT 发出任何 `BACKGROUND_TASK_*` 事件，且面板 SHALL NOT 出现。

#### Scenario: 事件 payload 不包含 raw command 和输出

- **WHEN** 后端发出一条 `BACKGROUND_TASK_*` 事件
- **THEN** payload MUST NOT 包含 raw command line、stdout、stderr 或 host 路径
- **AND** payload MUST 只包含安全字段

#### Scenario: Remote deployment 不发出后台任务事件

- **WHEN** 该 deployment 不是 local
- **THEN** MUST NOT 发出任何 `BACKGROUND_TASK_*` 事件
- **AND** 前端面板 MUST NOT 可见

### Requirement: 后台任务列表 endpoint 只返回安全字段

后端 SHALL 暴露一个 session 作用域的后台任务列表 endpoint（`GET /api/v1/sessions/:sessionId/background-tasks`），返回该 session 当前的后台任务集合，且只投影到安全字段：task id、command name、status、startedAt、finishedAt、exitCode、stdoutRef 和 stderrRef。该 endpoint MUST NOT 返回 raw command 文本、raw stdout/stderr、identity context、run id、request id 或 host 路径。web channel SHALL 通过 channel-contract 只读 view port 消费该 endpoint；gateway task-store port 和 record 类型 MUST NOT 被 web channel import。当后台任务执行未被组装（非 local deployment）时，该 endpoint SHALL 返回 unavailable 响应，且 MUST NOT 暴露任务数据。

#### Scenario: 列表只返回安全字段

- **WHEN** 前端为某个存在运行中任务的 session 请求后台任务列表
- **THEN** 响应 MUST 包含 task id、command name、status、startedAt、stdoutRef 和 stderrRef
- **AND** 响应 MUST NOT 包含 raw command line、identity context、run id 或 request id

#### Scenario: 后台执行未组装时不可用

- **WHEN** 该 deployment 未组装后台任务执行
- **THEN** 列表 endpoint MUST 返回 unavailable 状态
- **AND** 该 endpoint MUST NOT 暴露任何任务数据
