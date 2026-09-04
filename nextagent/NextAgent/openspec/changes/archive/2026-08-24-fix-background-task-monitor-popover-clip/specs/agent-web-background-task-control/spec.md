## MODIFIED Requirements

### Requirement: 后台任务 Header 监视器显示实时任务列表

agent web frontend SHALL 通过挂载在 chat pane header（headerExtra）中的 header 入口展示后台任务，而不是在 message stream 中。该入口 SHALL 是一个紧凑 badge，显示当前运行中任务的数量；当当前 session 没有后台任务时，它 SHALL NOT 渲染。激活该 badge SHALL 切换一个基于 portal 的 popover（Ant Design Popover），其内容挂载到 document.body，而不是嵌套在 header 内部的 position:absolute 元素。该 popover SHALL 使用带 onOpenChange 的受控 open state，SHALL 在 Escape 时关闭，并且 SHALL NOT 指定 getPopupContainer。该面板 SHALL 使用响应式尺寸：宽度上限为 min(440px, calc(100vw - 32px))，maxHeight 为 min(520px, calc(100vh - 80px))。该面板 SHALL 列出当前 session 的后台任务，按 startedAt 降序排序。每个任务面板 SHALL 显示低基数 command 名称、实时状态（RUNNING / COMPLETED / FAILED / KILLED）、已经过时间，以及 terminal 时的 exit code。进入 session 时，frontend SHALL 至多发一次 seed 请求到 GET /api/v1/sessions/:sessionId/background-tasks，然后 SHALL 按 taskId 增量应用 BACKGROUND_TASK_STARTED、BACKGROUND_TASK_COMPLETED 和 BACKGROUND_TASK_FAILED stream envelope，不进行周期性列表轮询。任务投影 SHALL 是 session-scoped 的，且独立于 conversation root/attempt 保留，因此 retry、edit、terminal settlement 或 conversation-envelope 压缩 MUST NOT 移除仍存在于 seeded 或增量更新的 task state 中的任务。非后台 stream envelope MUST NOT 发布 background-task 状态，也不得导致监视器扫描 active、settled 或历史 conversation envelope。该 dropdown SHALL 在 Escape 时或 badge 被再次切换关闭时关闭。

#### Scenario: 无任务时隐藏 badge，有运行任务时显示计数

- **WHEN** 当前 session 没有后台任务
- **THEN** header badge MUST NOT 渲染
- **WHEN** 当前 session 有两个 RUNNING 后台任务
- **THEN** header badge MUST 渲染并显示计数 2

#### Scenario: Dropdown 列出运行中和 terminal 任务

- **WHEN** badge 被激活且存在一个 RUNNING 和一个 COMPLETED 后台任务
- **THEN** dropdown popover MUST 渲染两行，按 startedAt 降序排列
- **AND** RUNNING 行 MUST 显示 RUNNING 状态指示器和已经过时间
- **AND** COMPLETED 行 MUST 显示 COMPLETED 状态指示器及其 exit code

#### Scenario: Session seed 与实时事件合并且不轮询

- **GIVEN** 监视器已为当前 session 发出其唯一一次 seed 请求
- **WHEN** 一个匹配的 BACKGROUND_TASK_* envelope 在 seed 响应之前或之后到达
- **THEN** 该任务 SHALL 按 taskId 合并，以最新的实时 terminal 状态为准
- **AND** seed 中的独有细节（如 commandLine）在存在时 SHALL 保持可用
- **AND** frontend MUST NOT 调度周期性列表请求

#### Scenario: 普通流量不更新 background-task 状态

- **GIVEN** 当前 session 没有后台任务事件
- **WHEN** frontend 收到模型文本、thinking、capability、terminal 或其他非后台 stream envelope
- **THEN** background-task 状态 MUST 保持相同的引用和值
- **AND** 监视器 MUST NOT 扁平化、排序或扫描 conversation 的 active 或 settled bucket

#### Scenario: 后台任务在 retry 和 edit attempt 替换后存活

- **GIVEN** 一个后台任务在较早的 request attempt 中被观察到且保持 RUNNING
- **WHEN** retry 或 edit 选中更新的可见 conversation attempt
- **THEN** 该后台任务 MUST 保留在当前 session 任务投影中
- **WHEN** 该较早任务随后发出 completion 或 failure envelope
- **THEN** 其任务状态 MUST 按 taskId 更新，即使其来源 conversation attempt 已不再可见

#### Scenario: Dropdown 在 Escape 时关闭

- **WHEN** dropdown popover 打开且用户按下 Escape
- **THEN** dropdown MUST 关闭
- **AND** badge 的 aria-expanded MUST 变为 false

#### Scenario: 面板不被 header overflow 裁剪

- **WHEN** badge 被激活且任务列表超出 header 可见区域
- **THEN** dropdown 面板 MUST 完整可见地渲染，portal 到 document.body
- **AND** 该面板 MUST NOT 被 PageHeader overflow:hidden 裁剪
