## 背景与问题（Why）

`add-ts-cron-task-management-api` 已经在 Web channel 提供 Cron task 的查询、创建、修改、删除和执行记录 REST API，但 `frontend/agent-web` 仍没有面向用户的定时任务看板。用户只能通过对话内 `Cron` Tool 或外部 REST 调用管理任务，无法在浏览器工作台中直接查看当前 active Agent 下的定时任务、修改调度 prompt、删除任务或查看触发执行记录。

这会让电信运维场景中的周期巡检、定时报表和例行诊断缺少可见治理入口：长期任务已经存在于 durable Cron gateway 中，但前端无法给用户提供可扫描、可修改、可追踪的管理面。当前需要补齐前端看板，作为已有后端管理 API 的浏览器投影，不重建 scheduler、gateway、runtime lifecycle 或 Cron result context 策略。

## 变更范围（What Changes）

- 在 `frontend/agent-web` 新增 Cron task dashboard 页面，并在本地工作台左侧 sidebar 的新建会话入口下方增加定时任务入口。
- 点击 sidebar 定时任务入口必须跳转到 dashboard route；入口只改变浏览器 route/view state，不加载或修改 chat session truth。
- dashboard 整体布局与会话界面保持一致：顶部 Header 左侧展示“定时任务管理”，右侧提供“手动创建”和 primary 风格的“通过会话创建”按钮；业务主体采用与会话界面相同的最大宽度并居中显示。
- dashboard 分为“任务”和“执行记录”两个 Tab；任务 Tab 不展示任务总数、当前页、执行记录三个指标块，通过现有 Web REST API 加载当前 trusted owner 与 active Agent 下的 Cron tasks，并以单列行式卡片展示 task header 标题、content 描述、footer 时间和频率、footer 右侧创建人，以及 header 右侧“执行”按钮、更多操作入口和表示是否开启的 switch。
- 任务卡片支持执行、修改、删除操作：执行调用 Cron task management API 立即触发该任务一次，并切换到该任务的执行记录 Tab；修改和删除收纳在更多操作菜单中；修改打开编辑表单，删除经确认后调用现有 delete API。
- dashboard 支持创建 Cron task、编辑 active task 的 `cron`、`prompt`、`recurring`，以及删除 task；所有 mutation 只调用现有 `/api/v1/cron-tasks` API。
- 执行记录 Tab 支持按时间日期段和定时任务名称进行前端筛选，并按行式记录卡片查看选中 task 的 execution records；每行展示定时任务卡片标题、执行时间和执行结果摘要，并通过“查看详情”展开 trigger/run 状态、terminal state、session/run 定位字段和 safe terminal result content。
- 前端必须把 503 unavailable、404 not found、409 inactive update 和 validation failure 呈现为用户可恢复的错误状态，并在成功 mutation 后刷新列表和选中详情。
- 新增 Cron task management run-now Web API 和 channel management port 方法，用于用户在 dashboard 中手动触发一次既有 Cron task；该 API 必须复用已有 Cron trigger delivery/runtime 路径，不新增 runtime command、stream event、gateway persistence 字段或新的前端 scope 输入。
- 不实现通过会话创建 task 的生成流程、pause/resume、批量删除、执行记录游标分页之外的新操作；“通过会话创建”在本 change 中仅作为禁用的 primary 入口占位。
- 不改变 Cron occurrence 结果的 session/context/navigation policy；执行记录中的 `sessionId` 只作为后端 API 已返回的结果定位字段展示，不在本 change 中定义跳转策略。

## Capability 影响（Capabilities）

### 新增 Capability

- `agent-web-cron-task-dashboard`: 定义浏览器前端 Cron task 看板的展示、创建、编辑、删除、执行记录查看、sidebar 入口跳转和错误呈现行为。

### 修改的 Capability

- 无。`cron-task-management-api` 的后端 REST contract 不在本 change 中修改；本 change 只定义前端消费该 API 的用户可见行为。

## 影响范围（Impact）

- 前端页面：新增 `frontend/agent-web/src/pages/CronTaskDashboardPage.tsx` 及配套样式。
- 前端 service：新增 Cron task management client，复用既有 `apiClient`。
- 前端路由与导航：在 `ChatWorkspace` 增加 dashboard route，在 `Sidebar` 新建会话入口下方增加定时任务入口；入口 active 状态跟随 route。
- 前端测试：新增 service tests、page component tests 和 route/sidebar tests，覆盖列表、创建、编辑、删除、execution records、错误态和跳转行为。
- 构建验证：运行 `frontend/agent-web` 的聚焦 Vitest 和 `npm run build`。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/agent-web-cron-task-dashboard/spec.md`：新增前端 Cron task dashboard 的用户可见行为契约。

长期背景：
- `openspec/overview.md`：记录 Cron task 除 Agent Tool 与 REST 管理 API 外，还具备浏览器管理看板入口。

设计视图：
- `openspec/designs/architecture/cron-task-execution.md`：补充浏览器 dashboard 只消费 Cron management REST API，不拥有 scheduler、runtime 或 result context policy。
- `openspec/designs/modules/agent-web.md`：补充 Cron task dashboard 页面、service client、route/sidebar owner 和前端 view-state 边界。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：新增 `agent-web-cron-task-dashboard` 导航和验证入口。

验证入口：
- `npm test -- CronTaskDashboardPage cronTaskService app.routes sidebar.component`
- `npm run build`
- `openspec validate add-agent-web-cron-task-dashboard --strict`
