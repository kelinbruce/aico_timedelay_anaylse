## ADDED Requirements

### Requirement: Cron task dashboard navigation
系统 SHALL 在 `frontend/agent-web` 的左侧 sidebar 新建会话入口下方提供定时任务入口。用户点击该入口时，前端 MUST 跳转到 Cron task dashboard route，并且该跳转 MUST 只改变浏览器 route/view state，不得创建、加载、重命名或删除 chat session，也不得修改 canonical conversation truth。

#### Scenario: Sidebar entry navigates to dashboard
- **WHEN** 用户点击 sidebar 中的定时任务入口
- **THEN** 前端 MUST 导航到 Cron task dashboard route
- **AND** sidebar MUST 将该入口标记为当前 active navigation item
- **AND** 最近会话列表和收藏列表的持久化数据 MUST NOT 因该导航被修改

### Requirement: Cron task dashboard lists manageable tasks
Cron task dashboard SHALL 分为“任务”和“执行记录”两个 Tab。页面 MUST 具备与会话界面一致的整体布局：顶部 Header 左侧展示“定时任务管理”，右侧展示“手动创建”和 primary 风格的“通过会话创建”按钮，业务主体 MUST 使用与会话界面相同的最大宽度并居中显示。任务 Tab SHALL 加载并展示当前 trusted owner 与 active Agent 下可管理的 Cron tasks。页面 MUST 使用现有 Cron task management REST API，不得直接调用 Cron Tool、gateway、runtime command 或 stream event。任务 Tab MUST NOT 展示任务总数、当前页、执行记录三个指标块。任务 Tab MUST 以单列行式卡片展示 task；每张 task 卡片 MUST 使用 header、content、footer 结构，其中 header 左侧展示标题，header 右侧展示“执行”按钮、更多操作入口和表示是否开启的 switch，content 展示任务描述，footer 左侧展示时间和频率，footer 右侧展示创建该任务的用户名；“修改”和“删除”MUST 收纳在更多操作入口展开后的菜单中。

#### Scenario: Dashboard renders task list
- **WHEN** 用户打开 Cron task dashboard route 且后端返回 task page
- **THEN** 页面 MUST 渲染单列行式 task 卡片列表
- **AND** 顶部 Header MUST 展示“定时任务管理”、“手动创建”和 primary 风格的“通过会话创建”
- **AND** 业务主体 MUST 按会话界面的最大宽度居中显示
- **AND** 每张卡片 MUST 以 header、content、footer 展示标题、描述、时间、频率、创建人、执行按钮、更多操作入口和开启 switch
- **AND** 任务 Tab MUST NOT 展示任务总数、当前页、执行记录三个指标块
- **AND** 页面 MUST NOT 同时展示独立“激活”按钮和开启 switch
- **AND** 用户 MUST 能直接点击“执行”进入该 task 的执行记录，并能通过更多操作菜单进入“修改”和“删除”
- **AND** 页面 MUST NOT 要求用户先进入或创建 chat session

#### Scenario: Dashboard handles unavailable service
- **WHEN** Cron task management API 返回 503 unavailable
- **THEN** 页面 MUST 显示可恢复错误状态
- **AND** 页面 MUST 提供重新加载入口

### Requirement: Cron task dashboard manages task mutations
Cron task dashboard SHALL 支持用户通过表单创建 Cron task、编辑 active task 的 `cron`、`prompt`、`recurring`，并删除 task。前端 MUST 在提交前要求 `cron` 和 `prompt` 非空；后端 validation、not found 和 inactive update 错误 MUST 呈现给用户。成功 mutation 后，页面 MUST 刷新 task 卡片列表，并保持选中 task 与后端返回结果一致。

#### Scenario: User creates a Cron task
- **WHEN** 用户在 dashboard 中提交合法 `cron`、非空 `prompt` 和 `recurring`
- **THEN** 前端 MUST 调用 `POST /api/v1/cron-tasks`
- **AND** 成功后 MUST 刷新列表并显示新建 task

#### Scenario: User updates an active Cron task
- **WHEN** 用户编辑已选 active task 的 `cron`、`prompt` 或 `recurring`
- **THEN** 前端 MUST 调用 `PUT /api/v1/cron-tasks/:taskId`
- **AND** 成功后 MUST 使用后端返回的 task view 更新详情和列表

#### Scenario: User deletes a Cron task
- **WHEN** 用户在 task 卡片上展开更多操作菜单并点击“删除”后确认
- **THEN** 前端 MUST 调用 `DELETE /api/v1/cron-tasks/:taskId`
- **AND** 成功后 MUST 刷新 task 卡片列表
- **AND** 若被删除 task 是当前选中 task，页面 MUST 清理该 task 的执行记录详情

#### Scenario: User opens execution records from a task card
- **WHEN** 用户在 task 卡片上点击“执行”
- **THEN** 前端 MUST 调用 `POST /api/v1/cron-tasks/:taskId/runs` 触发该 task 一次即时执行
- **AND** 该请求 MUST NOT 携带 owner、agent、session、run 或 prompt override 字段
- **AND** 后端 MUST 在 trusted owner 与 active Agent scope 下 claim 当前时间的 Cron trigger，并复用已有 Cron trigger delivery/runtime 路径提交运行
- **AND** 前端 MUST 选择该 task、切换到“执行记录” Tab，并刷新该 task 的 execution records

### Requirement: Cron task dashboard displays execution records
Cron task dashboard SHALL 在“执行记录” Tab 为选中 task 提供 execution record 查看区域。该区域 MUST 使用 `GET /api/v1/cron-tasks/:taskId/runs`。执行记录 MUST 支持按时间日期段和定时任务名称筛选。执行记录区域左侧 MUST 提供按 execution `scheduledAt` 日期聚合的时间线，按天展示执行过的 task 和执行次数。执行记录 MUST 按单列行式记录卡片展示，每行 MUST 展示定时任务卡片标题、执行时间和执行结果摘要，并提供“查看详情”操作；执行时间 MUST 位于记录 header 右侧，执行结果摘要 MUST 位于记录 content 区域。详情默认 MUST 收起；用户展开详情后，页面 MUST 展示 trigger 状态、run 状态、terminal commit state、sessionId、requestRunId 和 safe terminal result content。状态字段 MUST 带明确标签。页面 MUST NOT 在本 change 中定义或执行 Cron result session 跳转策略；若显示 `sessionId`，它只作为只读定位信息。

#### Scenario: User views task executions
- **WHEN** 用户选中一条 task
- **THEN** 页面 MUST 加载该 task 的 execution records
- **AND** 页面 MUST 在执行记录左侧按天展示该 task 的执行时间线
- **AND** 页面 MUST 以行式记录卡片展示定时任务卡片标题、右侧执行时间和 content 区域内的执行结果摘要
- **AND** 用户 MUST 能通过“查看详情”展开完整状态和结果内容
- **AND** 页面 MUST 显示空态、加载态和错误态
- **AND** 页面 MUST NOT 自动打开 execution 对应 chat session

#### Scenario: User filters task executions
- **WHEN** 用户在执行记录 Tab 输入定时任务名称或选择开始/结束日期
- **THEN** 页面 MUST 按已加载 task 的定时任务标题/ID 和 execution `scheduledAt` 日期段过滤记录
- **AND** 页面 MUST NOT 向 `/runs` API 发送 owner、agent、session、run 或未定义筛选字段
