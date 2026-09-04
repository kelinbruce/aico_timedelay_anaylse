## Purpose

本规范定义 web 后台任务控制面：一个列出当前 session 后台任务的头部监视器、
按需读取任务 stdout/stderr，以及对运行中任务的 SIGTERM 终止。
它仅限本地部署。
## Requirements
### Requirement: 后台任务头部监视器显示实时任务列表

agent web frontend SHALL 通过挂载在 chat pane header（headerExtra）中的头部入口呈现后台任务，而不是在消息流内呈现。该入口 SHALL 是一个紧凑的 badge，显示当前运行中任务的数量；当前 session 没有后台任务时 SHALL NOT 渲染。激活该 badge SHALL 切换一个基于 portal 的 popover（Ant Design Popover），其内容挂载到 document.body，而不是嵌套在 header 内部的 position:absolute 元素。该 popover SHALL 使用带 onOpenChange 的受控 open 状态，SHALL 在按下 Escape 时关闭，且 SHALL NOT 指定 getPopupContainer。panel SHALL 使用响应式尺寸：宽度上限为 min(440px, calc(100vw - 32px))，maxHeight 上限为 min(520px, calc(100vh - 80px))。panel SHALL 列出当前 session 的后台任务，按 startedAt 降序排序。每个任务 panel SHALL 显示低基数的命令名、实时状态（RUNNING / COMPLETED / FAILED / KILLED）、已用时间，以及终态时的退出码。进入 session 时 frontend SHALL 至多发出一次种子请求到 GET /api/v1/sessions/:sessionId/background-tasks，随后 SHALL 按 taskId 增量应用 BACKGROUND_TASK_STARTED、BACKGROUND_TASK_COMPLETED 和 BACKGROUND_TASK_FAILED stream envelope，而不进行周期性列表轮询。任务投影 SHALL 是 session-scoped 且独立于会话 root/attempt 保留，因此重试、编辑、终态收敛或会话 envelope 压缩 MUST NOT 移除在种子化或增量更新的任务状态中仍然存在的任务。非后台的 stream envelope MUST NOT 发布后台任务状态，也不得使监视器扫描活动、已稳定或历史会话 envelope。Dropdown SHALL 在按下 Escape 或再次切换关闭 badge 时关闭。

#### Scenario: 无任务时 badge 隐藏，出现运行中计数时显示

- **WHEN** 当前 session 没有后台任务
- **THEN** 头部 badge MUST NOT 渲染
- **WHEN** 当前 session 有两个 RUNNING 后台任务
- **THEN** 头部 badge MUST 渲染并显示计数 2

#### Scenario: Dropdown 列出运行中和终态任务

- **WHEN** badge 被激活且存在一个 RUNNING 和一个 COMPLETED 后台任务
- **THEN** dropdown popover MUST 渲染两行，按 startedAt 降序排列
- **AND** RUNNING 行 MUST 显示 RUNNING 状态指示和已用时间
- **AND** COMPLETED 行 MUST 显示 COMPLETED 状态指示及其退出码

#### Scenario: 会话种子与实时事件合并且不轮询

- **GIVEN** 监视器已为当前 session 发出其唯一一次种子请求
- **WHEN** 匹配的 BACKGROUND_TASK_* envelope 在种子响应之前或之后到达
- **THEN** 任务 SHALL 按 taskId 合并，最新的实时终态优先
- **AND** commandLine 等仅种子提供的详情在存在时 SHALL 保持可用
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
- **THEN** 其任务状态 MUST 按 taskId 更新，即使其来源会话 attempt 已不可见

#### Scenario: Dropdown 在按下 Escape 时关闭

- **WHEN** dropdown popover 处于打开状态且用户按下 Escape
- **THEN** dropdown MUST 关闭
- **AND** badge 的 aria-expanded MUST 变为 false

#### Scenario: 面板不被头部溢出裁剪

- **WHEN** badge 被激活且任务列表超出头部可见区域
- **THEN** dropdown panel MUST 完整可见地渲染，portal 到 document.body
- **AND** panel MUST NOT 被 PageHeader 的 overflow:hidden 裁剪

### Requirement: 后台任务输出可按 session 读取

后端 SHALL 暴露 `GET /api/v1/sessions/:sessionId/background-tasks/:taskId/output?stream=stdout|stderr&limitBytes=N`，返回任务的原始 stdout 或 stderr 内容，以 `limitBytes` 字节为上限并带有 `truncated` 标志。前端控制面板 SHALL 允许展开任务行以显示其 stdout 和 stderr，按需获取（而非流式推送），并提供手动刷新入口。该端点 MUST 校验任务属于请求方 session（`record.sessionId === sessionId`）；属于其他 session 的任务 MUST 返回不可用/未找到响应，且 MUST NOT 返回内容。`limitBytes` MUST 被钳制到 `[1, 262144]` 范围内，默认值为 65536。

#### Scenario: 输出端点返回 session 作用域内容

- **WHEN** 前端为属于请求方 session 的任务请求输出
- **THEN** 响应 MUST 包含原始 stdout 或 stderr 内容以及 `truncated` 布尔值
- **AND** 当内容超过 `limitBytes` 时，响应 MUST 将 `truncated` 设为 `true` 并只返回前 `limitBytes` 字节

#### Scenario: 输出端点拒绝跨 session 访问

- **WHEN** 前端为 `sessionId` 与请求路径 `sessionId` 不匹配的任务请求输出
- **THEN** 该端点 MUST 返回未找到/不可用状态
- **AND** 响应 MUST NOT 包含任何 stdout 或 stderr 内容

#### Scenario: limitBytes 被钳制

- **WHEN** 请求省略 `limitBytes`
- **THEN** 该端点 MUST 应用 65536 字节的默认值
- **WHEN** 请求提供的 `limitBytes` 大于 262144
- **THEN** 该端点 MUST 将其钳制到 262144 字节

#### Scenario: 面板在展开时显示输出

- **WHEN** 用户在控制面板中展开一个任务行
- **THEN** 面板 MUST 获取并显示该任务的 stdout 和 stderr
- **AND** 面板 MUST 提供可重新获取输出的手动刷新入口

### Requirement: 运行中的后台任务可被终止

后端 SHALL 暴露 `POST /api/v1/sessions/:sessionId/background-tasks/:taskId/kill`，当且仅当任务 `status` 为 `RUNNING` 且任务属于请求方 session 时，向该任务的进程发送 SIGTERM。信号发送成功后，store 状态 SHALL 变为 `KILLED` 并带有 `finishedAt` 时间戳。对非 `RUNNING` 状态任务的 kill 请求 MUST 返回 `ALREADY_TERMINAL`，且 MUST NOT 向任何进程发送信号。对未知任务的 kill 请求 MUST 返回 `NOT_FOUND`。前端控制面板 SHALL 仅在 `RUNNING` 行上显示 kill 控件，并置于确认入口之后。kill 之后的终端 close 事件 MUST NOT 将 `KILLED` 状态覆写回 `FAILED`，且 MUST NOT 发出误导性的 `BACKGROUND_TASK_FAILED` timeline 事件。

#### Scenario: kill 将 RUNNING 转换为 KILLED

- **WHEN** 前端为属于请求方 session 的 RUNNING 任务发送 kill 请求
- **THEN** 后端 MUST 向该任务进程发送 SIGTERM
- **AND** 任务状态 MUST 变为 `KILLED` 并带有 `finishedAt` 时间戳

#### Scenario: 对终态任务的 kill 被拒绝

- **WHEN** 前端为状态为 `COMPLETED`、`FAILED` 或 `KILLED` 的任务发送 kill 请求
- **THEN** 响应 MUST 为 `ALREADY_TERMINAL`
- **AND** 后端 MUST NOT 向任何进程发送信号

#### Scenario: 对未知任务的 kill 被拒绝

- **WHEN** 前端为一个不存在的 task id 发送 kill 请求
- **THEN** 响应 MUST 为 `NOT_FOUND`

#### Scenario: kill 后的 close 事件不覆写 KILLED

- **WHEN** 被终止任务的进程发出其 close 事件
- **THEN** store 状态 MUST 保持 `KILLED`
- **AND** 后端 MUST NOT 为该 close 发出 `BACKGROUND_TASK_FAILED` timeline 事件

#### Scenario: 面板 kill 控件仅限 RUNNING

- **WHEN** 控制面板渲染一个任务行
- **THEN** kill 控件 MUST 仅在行状态为 `RUNNING` 时出现
- **AND** 激活它 MUST 要求先经过确认步骤再发出 kill 请求

### Requirement: 后台任务控制安全且仅限本地部署

后台任务输出读取和 kill 能力 SHALL 仅在本地部署中组装；在远程部署中，view port SHALL NOT 被组装，且两个端点 MUST 返回不可用响应，MUST NOT 暴露任务数据或向进程发送信号。Timeline 事件 payload SHALL 继续只包含安全的低基数字段（task id、command name、status、startedAt、finishedAt、exitCode、stdoutRef、stderrRef）；原始 stdout、原始 stderr、原始命令行、脚本内容和宿主路径 MUST NOT 出现在 timeline 事件 payload 中——原始输出仅通过显式输出端点按需暴露。

#### Scenario: 远程部署不暴露控制端点

- **WHEN** 部署不是本地部署
- **THEN** 输出和 kill 端点 MUST 返回不可用状态
- **AND** 端点 MUST NOT 暴露任何任务内容或向任何进程发送信号

#### Scenario: timeline 事件不含原始输出和命令

- **WHEN** 后端发出 `BACKGROUND_TASK_*` timeline 事件
- **THEN** payload MUST NOT 包含原始 stdout、原始 stderr、原始命令行、脚本内容或宿主路径
- **AND** payload MUST 只包含安全的低基数字段
