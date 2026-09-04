# agent-web-background-task-control Specification Delta

## ADDED Requirements

### Requirement: 后台任务头部监视器展示实时任务列表

Agent web 前端 SHALL 通过挂载在 chat pane header（`headerExtra`）中的头部入口暴露后台任务，而不是在消息流内。该入口 SHALL 是一个紧凑徽标，展示当前运行中任务的数量；当前会话没有后台任务时它 SHALL NOT 渲染。激活该徽标 SHALL 切换一个内联下拉面板（不是 drawer、toast 或 modal），列出当前会话的后台任务，按 `startedAt` 降序排序，数据来自 `GET /api/v1/sessions/:sessionId/background-tasks`。每个任务的面板 SHALL 显示低基数命令名、实时状态（`RUNNING` / `COMPLETED` / `FAILED` / `KILLED`）、已用时间，以及终态时的退出码。监视器挂载期间前端 SHALL 至多每 2 秒轮询一次列表端点，使徽标计数和列表保持最新。该下拉面板 SHALL 在 Escape 或徽标再次切换关闭时关闭。

#### Scenario: 无任务时徽标隐藏，出现时显示运行计数

- **WHEN** 当前会话没有后台任务
- **THEN** 头部徽标 MUST NOT 渲染
- **WHEN** 当前会话有两个 RUNNING 后台任务
- **THEN** 头部徽标 MUST 渲染并显示计数 2

#### Scenario: 下拉面板列出运行中和终态任务

- **WHEN** 徽标被激活时存在一个 RUNNING 和一个 COMPLETED 后台任务
- **THEN** 下拉面板 MUST 渲染两行，按 `startedAt` 降序排列
- **AND** RUNNING 行 MUST 显示 RUNNING 状态指示和已用时间
- **AND** COMPLETED 行 MUST 显示 COMPLETED 状态指示及其退出码

#### Scenario: 下拉面板在 Escape 时关闭

- **WHEN** 下拉面板打开且用户按下 Escape
- **THEN** 下拉面板 MUST 关闭

### Requirement: 后台任务输出可按会话读取

后端 SHALL 暴露 `GET /api/v1/sessions/:sessionId/background-tasks/:taskId/output?stream=stdout|stderr&limitBytes=N`，返回任务的 raw stdout 或 stderr 内容，以 `limitBytes` 字节为上限并带 `truncated` 标志。前端控制面板 SHALL 允许展开任务行以显示其 stdout 和 stderr，按需获取（不是流式），并提供手动刷新入口。该端点 MUST 校验任务属于发起请求的会话（`record.sessionId === sessionId`）；属于其他会话的任务 MUST 返回 unavailable/not-found 响应，MUST NOT 返回内容。`limitBytes` MUST 被钳制到 `[1, 262144]` 范围，默认 65536。这推翻了此前禁止向前端暴露 raw 输出的非目标。

#### Scenario: 输出端点返回会话 scope 内容

- **WHEN** 前端为属于发起请求会话的任务请求输出
- **THEN** 响应 MUST 包含 raw stdout 或 stderr 内容和一个 `truncated` 布尔值
- **AND** 当内容超过 `limitBytes` 时，响应 MUST 把 `truncated` 设为 `true` 并只返回前 `limitBytes` 字节

#### Scenario: 输出端点拒绝跨会话访问

- **WHEN** 前端为 `sessionId` 与请求路径 `sessionId` 不匹配的任务请求输出
- **THEN** 端点 MUST 返回 not-found/unavailable 状态
- **AND** 响应 MUST NOT 包含任何 stdout 或 stderr 内容

#### Scenario: limitBytes 被钳制

- **WHEN** 请求省略 `limitBytes`
- **THEN** 端点 MUST 应用默认 65536 字节
- **WHEN** 请求提供的 `limitBytes` 大于 262144
- **THEN** 端点 MUST 把它钳制到 262144 字节

#### Scenario: 面板在展开时显示输出

- **WHEN** 用户在控制面板中展开一个任务行
- **THEN** 面板 MUST 获取并显示该任务的 stdout 和 stderr
- **AND** 面板 MUST 提供重新获取输出的手动刷新入口

### Requirement: 运行中的后台任务可被终止

后端 SHALL 暴露 `POST /api/v1/sessions/:sessionId/background-tasks/:taskId/kill`，当且仅当任务 `status` 为 `RUNNING` 且任务属于发起请求的会话时，向任务进程发送 SIGTERM。信号成功后 store 状态 SHALL 变为 `KILLED` 并带 `finishedAt` 时间戳。对非 `RUNNING` 状态任务的 kill 请求 MUST 返回 `ALREADY_TERMINAL`，MUST NOT 向任何进程发信号。对未知任务的 kill 请求 MUST 返回 `NOT_FOUND`。前端控制面板 SHALL 只在 `RUNNING` 行上显示 kill 控件，并置于确认入口之后。kill 之后的终端关闭事件 MUST NOT 把 `KILLED` 状态覆盖回 `FAILED`，MUST NOT 发出误导性的 `BACKGROUND_TASK_FAILED` timeline event。

#### Scenario: Kill 把 RUNNING 转换为 KILLED

- **WHEN** 前端为属于发起请求会话的 RUNNING 任务发送 kill 请求
- **THEN** 后端 MUST 向任务进程发送 SIGTERM
- **AND** 任务状态 MUST 变为 `KILLED` 并带 `finishedAt` 时间戳

#### Scenario: 对终态任务的 Kill 被拒绝

- **WHEN** 前端为状态为 `COMPLETED`、`FAILED` 或 `KILLED` 的任务发送 kill 请求
- **THEN** 响应 MUST 为 `ALREADY_TERMINAL`
- **AND** 后端 MUST NOT 向任何进程发信号

#### Scenario: 对未知任务的 Kill 被拒绝

- **WHEN** 前端为不存在的任务 id 发送 kill 请求
- **THEN** 响应 MUST 为 `NOT_FOUND`

#### Scenario: Kill 关闭事件不覆盖 KILLED

- **WHEN** 被终止任务的进程发出其关闭事件
- **THEN** store 状态 MUST 保持 `KILLED`
- **AND** 后端 MUST NOT 为该关闭发出 `BACKGROUND_TASK_FAILED` timeline event

#### Scenario: 面板 kill 控件限定于 RUNNING

- **WHEN** 控制面板渲染一个任务行
- **THEN** kill 控件 MUST 只在该行状态为 `RUNNING` 时出现
- **AND** 激活它 MUST 要求一个确认步骤后才发出 kill 请求

### Requirement: 后台任务控制是安全且仅限本地的

后台任务输出读取和 kill 能力 SHALL 只在本地部署中组装；在远程部署中该视图端口 SHALL NOT 被组装，两个端点都 MUST 返回 unavailable 响应，MUST NOT 暴露任务数据或向进程发信号。Timeline event payload SHALL 继续只包含安全的低基数字段（task id、command name、status、startedAt、finishedAt、exitCode、stdoutRef、stderrRef）；raw stdout、raw stderr、raw 命令行、脚本内容和 host path MUST NOT 出现在 timeline event payload 中——raw 输出只通过显式输出端点按需暴露。

#### Scenario: 远程部署不暴露控制端点

- **WHEN** 部署不是本地
- **THEN** 输出和 kill 端点 MUST 返回 unavailable 状态
- **AND** 端点 MUST NOT 暴露任何任务内容或向任何进程发信号

#### Scenario: Timeline 事件不含 raw 输出和命令

- **WHEN** 后端发出 `BACKGROUND_TASK_*` timeline event
- **THEN** payload MUST NOT 包含 raw stdout、raw stderr、raw 命令行、脚本内容或 host path
- **AND** payload MUST 只包含安全的低基数字段
