## MODIFIED Requirements

### Requirement: 后台任务头部监视器显示实时任务列表

agent web frontend SHALL 通过挂载在 chat pane header（`headerExtra`）中的头部入口呈现后台任务，而不是在消息流内呈现。该入口 SHALL 是一个紧凑的 badge，显示当前运行中任务的数量；当前 session 没有后台任务时 SHALL NOT 渲染。激活该 badge SHALL 切换一个内联 dropdown panel（不是 drawer、toast 或 modal），其中列出当前 session 的后台任务，按 `startedAt` 降序排序。每个任务 panel SHALL 显示低基数的命令名、实时状态（`RUNNING` / `COMPLETED` / `FAILED` / `KILLED`）、已用时间，以及终态时的退出码。进入 session 时 frontend SHALL 至多发出一次种子请求到 `GET /api/v1/sessions/:sessionId/background-tasks`，随后 SHALL 按 `taskId` 增量应用 `BACKGROUND_TASK_STARTED`、`BACKGROUND_TASK_COMPLETED` 和 `BACKGROUND_TASK_FAILED` stream envelope，而不进行周期性列表轮询。任务投影 SHALL 是 session-scoped 且独立于会话 root/attempt 保留，因此重试、编辑、终态收敛或会话 envelope 压缩 MUST NOT 移除在种子化或增量更新的任务状态中仍然存在的任务。非后台的 stream envelope MUST NOT 发布后台任务状态，也不得使监视器扫描活动、已稳定或历史会话 envelope。Dropdown SHALL 在按下 Escape 或再次切换关闭 badge 时关闭。

#### Scenario: 无任务时 badge 隐藏，出现运行中计数时显示

- **WHEN** 当前 session 没有后台任务
- **THEN** 头部 badge MUST NOT 渲染
- **WHEN** 当前 session 有两个 RUNNING 后台任务
- **THEN** 头部 badge MUST 渲染并显示计数 2

#### Scenario: Dropdown 列出运行中和终态任务

- **WHEN** badge 被激活且存在一个 RUNNING 和一个 COMPLETED 后台任务
- **THEN** dropdown MUST 渲染两行，按 `startedAt` 降序排列
- **AND** RUNNING 行 MUST 显示 RUNNING 状态指示和已用时间
- **AND** COMPLETED 行 MUST 显示 COMPLETED 状态指示及其退出码

#### Scenario: 会话种子与实时事件合并且不轮询

- **GIVEN** 监视器已为当前 session 发出其唯一一次种子请求
- **WHEN** 匹配的 `BACKGROUND_TASK_*` envelope 在种子响应之前或之后到达
- **THEN** 任务 SHALL 按 `taskId` 合并，最新的实时终态优先
- **AND** `commandLine` 等仅种子提供的详情在存在时 SHALL 保持可用
- **AND** frontend MUST NOT 调度周期性列表请求

#### Scenario: 普通流量不更新后台任务状态

- **GIVEN** 当前 session 没有后台任务事件
- **WHEN** frontend 收到模型文本、thinking、capability、terminal 或其他非后台 stream envelope
- **THEN** 后台任务状态 MUST 保持相同的引用和值
- **AND** 监视器 MUST NOT 扁平化、排序或扫描会话的活动或已稳定 bucket

#### Scenario: 后台任务在重试和编辑 attempt 替换后保留

- **GIVEN** 一个后台任务在较早的 request attempt 中被观察到且保持 RUNNING
- **WHEN** 重试或编辑选择了较新的可见会话 attempt
- **THEN** 该后台任务 MUST 保留在当前 session 任务投影中
- **WHEN** 较早的任务随后发出完成或失败 envelope
- **THEN** 其任务状态 MUST 按 `taskId` 更新，即使其来源会话 attempt 已不可见

#### Scenario: Dropdown 在按下 Escape 时关闭

- **WHEN** dropdown 处于打开状态且用户按下 Escape
- **THEN** dropdown MUST 关闭
