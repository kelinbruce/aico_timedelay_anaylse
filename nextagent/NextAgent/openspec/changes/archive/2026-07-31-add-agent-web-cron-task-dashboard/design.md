## 背景和现状（Context）

当前 Cron 后端路径已经具备三类入口：`Cron` Tool、durable Cron gateway/scheduler/runtime delivery，以及 `add-ts-cron-task-management-api` 提供的 Web REST management API。`frontend/agent-web` 当前有 sidebar、route shell、`apiClient`、i18n 和 route/component tests，但没有 Cron task dashboard。

当前 sidebar 已有新建会话、搜索、收藏等主导航入口，收藏列表项能跳转到对应 session。用户最新要求 Cron 看板页签调整到创建会话下面，并支持点击跳转。因此本 change 只在 sidebar 新建会话入口下方增加一个导航按钮，点击跳转到独立 dashboard route；不复用长期记忆管理页面作为产品形态，也不把 Cron 看板藏到 Memory 管理面。

相关方：

- `frontend/agent-web`：拥有 dashboard 页面、sidebar 入口、route state、service client、表单状态和展示样式。
- `agent-channel-web`：继续拥有 Cron task management REST API、schema、safe error 和 DTO projection。
- `agent-app`、gateway、runtime、scheduler：不在本 change 中修改。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 在 sidebar 新建会话入口下方提供“定时任务”导航入口，点击进入 `/cron-tasks` dashboard route。
- dashboard 顶部 Header 与会话界面整体布局一致，左侧展示“定时任务管理”，右侧展示“手动创建”和 primary 风格的“通过会话创建”按钮；业务主体采用与会话界面相同的最大宽度并居中。
- 提供“任务”和“执行记录”两个 Tab；任务 Tab 以卡片展示 Cron task，执行记录 Tab 展示选中 task 的 execution records。
- 在任务卡片中使用 header/content/footer 结构展示标题、描述、时间、频率和创建人；header 右侧展示“执行”按钮、更多操作入口和表示是否开启的 switch，“修改”和“删除”收纳在更多操作菜单中。
- 在执行记录 Tab 支持按时间日期段和定时任务名称筛选记录。
- 消费 `/api/v1/cron-tasks` REST API，并为任务卡片“执行”新增 run-now 管理入口，后端必须复用已有 Cron trigger delivery/runtime 路径。
- 对 list/mutation/execution load 的 loading、empty、error、success 状态给出明确 UI。
- 保持 chat session truth、conversation store、Cron scheduler/runtime ownership 不变。

**非目标：**

- 不新增或修改 gateway、scheduler、runtime command、stream event 或持久化字段。
- 不新增通过会话创建 task 的生成流程、pause/resume、批量操作、任务模板、自然语言固化任务或管理端权限配置；顶部“通过会话创建”在本 change 中仅作为禁用的 primary 入口占位。
- 不实现 Cron result 的 session 跳转策略；execution `sessionId` 仅作为只读字段展示。
- 不参考或复用 Memory 管理页作为产品形态。

## 设计决策（Decisions）

### 1. Sidebar 新建会话下方新增导航按钮

在 `Sidebar.tsx` 的新建会话 `NavButton` 后新增 Cron task dashboard `NavButton`，使用 Ant Design 现有图标体系中的日历/时间类图标。点击时调用 `navigate("/cron-tasks")`，并在进入 dashboard 时关闭收藏展开状态，避免左栏同时处于收藏列表视图和 dashboard active 导航状态。

选择该方案的原因：

- 与用户最新要求的“定时任务页签调整到创建会话下面”一致。
- 复用现有 `NavButton` 的 collapsed/tooltip/active 行为，不新增侧栏交互体系。
- dashboard 是独立页面，不与收藏列表或 session list 混合。

放弃方案：

- 放到设置或更多功能中：入口可发现性不足，且不符合“创建会话下面”要求。
- 作为收藏列表内的一条伪 item：会混淆收藏数据与导航入口。

### 2. 新增 `/cron-tasks` route 和专用 dashboard 页面

`ChatWorkspace` 增加 `/cron-tasks` route，渲染 `CronTaskDashboardPage`。页面拥有本地 view state：列表分页、选中 task、表单 mode、表单 draft、execution records loading/error。页面不读取或写入 `sessionStore`、`conversationStore` 或 chat composer state。

选择该方案的原因：

- 入口跳转语义清楚，browser history 可返回。
- 页面职责单一，后续如果增加前端面板能力也不会污染 ChatPage。
- 不需要新增 app shell 或多 host contract。

### 3. 新增 `cronTaskService` 作为 REST client

新增 `frontend/agent-web/src/services/cronTaskService.ts`，定义前端内部 DTO 类型并封装：

- `listCronTasks({ offset, limit })`
- `createCronTask({ cron, prompt, recurring })`
- `updateCronTask(taskId, { cron?, prompt?, recurring? })`
- `deleteCronTask(taskId)`
- `listCronTaskExecutions(taskId, { offset, limit })`

service 只复用 `apiClient`，不导入后端 TypeBox schema 或 `agent-contracts`。前端 DTO 仅描述 Web response 的最小消费字段。

### 4. Dashboard 首版布局

页面使用会话界面同源布局风格和 Tab 结构：

- 顶部 Header：左侧“定时任务管理”，右侧“手动创建”和 primary 风格“通过会话创建”；“手动创建”打开现有创建表单，“通过会话创建”因缺少会话生成 task contract 而禁用。
- 主体区域：复用会话界面 1080px 最大宽度约束，居中显示，并沿用全局背景、边框、主色和文本色 token。
- 任务 Tab：不展示任务总数、当前页、执行记录三个指标块；卡片按单列行式平铺，使用 header/content/footer 三段结构。header 左侧为标题，右侧为“执行”按钮、更多操作入口和只读 switch；更多操作菜单展开后展示“修改”和“删除”；content 为任务描述；footer 左侧展示时间、下次运行和频率，footer 右侧展示创建该任务的用户名。
- 执行记录 Tab：按单列行式记录卡片展示当前选中 task 的 execution records；不展示额外的选中任务信息框；执行记录区域左侧按 execution `scheduledAt` 日期聚合为时间线，展示该日期执行的 task 和次数；每行 header 左侧展示定时任务卡片标题、右侧展示执行时间，content 展示执行结果摘要，并提供“查看详情”操作。筛选条提供定时任务名称、开始日期和结束日期；定时任务名称基于已加载 task 标题/ID 匹配，日期段基于 execution `scheduledAt` 做本地过滤，不扩展 `/runs` 查询参数。

创建/编辑使用同一个内联表单。表单在前端只做非空校验；cron 格式、prompt 长度、inactive update、not found 等以 API safe error 为准并展示给用户。任务卡片的操作收敛为：

- 执行：调用 `POST /api/v1/cron-tasks/:taskId/runs`，由后端在 trusted owner 与 active Agent scope 下 claim 一个当前时间的 Cron trigger，并复用已有 Cron trigger delivery/runtime 路径提交一次低优先级运行；成功后选择该 task、切换到执行记录 Tab，并刷新 `/runs` 记录。
- 修改：打开该 task 的编辑表单，允许修改 `cron`、`prompt`、`recurring`。
- 删除：在更多操作菜单中触发确认，确认后调用现有 `DELETE /api/v1/cron-tasks/:taskId`。

执行记录的“查看详情”默认收起，展开后展示 trigger/run 状态、terminal commit state、sessionId、requestRunId 和完整 safe terminal result content。状态展示必须带标签，避免 `COMPLETED COMPLETED` 这类无语义重复文本。

### 5. Execution records 只读展示

选中 task 后，页面调用 `/runs` 加载最多 50 条 execution records。首版展示 trigger/run/terminal 状态和 `resultContent` preview。`sessionId` 和 `requestRunId` 只作为只读字段显示，不提供“打开会话”链接，因为 B19 的结果归属/导航策略仍由独立 change 决定。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 前端不接受 owner/agent/session/run scope 输入，不拼接 query 中的 scope 覆盖字段；mutation 只发送 `cron`、`prompt`、`recurring`；即时执行 POST 不发送 body。prompt 只显示 explicit management API 返回内容，不进入前端日志或 conversation。 | service tests、page tests、route tests、code review |
| 性能/容量 | 列表和 executions 首版 limit 固定 50；页面不轮询，只在打开、刷新、选中和 mutation 后加载，避免后台持续请求。 | page tests、code review |
| 可靠性/恢复 | 所有 API 失败都保留当前已加载列表或显示可重试错误；成功 mutation 后刷新列表并同步选中详情；删除成功后清空已删除选中项。 | component tests |
| 可维护性 | route/sidebar/service/page 分层；不引入新全局 store，不改 ChatPage 主流程，不新增后端 contract。 | `npm run build`、route/sidebar tests |
| 可测试性 | service 可通过 mocked fetch 验证 URL/method/body；page 可 mock service 验证 UI 状态和 mutation flow。 | Vitest |
| 审计/可追溯性 | 本 change 不新增审计事实；后端 API access log 和 durable Cron facts 继续作为追溯来源。前端展示 execution read model。 | code review |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| sidebar 新建会话下方入口跳转 `/cron-tasks` 且 active | 2.1, 4.1 | `npm test -- sidebar.component` |
| dashboard route 不加载 chat session truth | 2.1, 4.1 | `npm test -- app.routes CronTaskDashboardPage` |
| 任务 Tab 不展示指标块，且以单列行式卡片展示标题、内容、执行时间、执行策略 | 2.2, 5.1, 5.4 | `npm test -- CronTaskDashboardPage` |
| dashboard header、主体宽度和任务卡片结构与会话界面整体布局一致 | 5.7 | `npm test -- CronTaskDashboardPage`；`npm run test:e2e` |
| 执行操作触发一次即时 Cron 执行并进入执行记录 Tab | 5.12 | `npm test -- cron-management-composition cron-task-management-routes cronTaskService CronTaskDashboardPage` |
| 执行记录按行式记录卡片展示标题、执行时间、执行结果，并通过查看详情展开完整状态和结果 | 2.4, 5.5 | `npm test -- CronTaskDashboardPage` |
| 执行记录支持按定时任务名称和时间日期段筛选 | 2.4, 5.6 | `npm test -- CronTaskDashboardPage` |
| 任务卡片不重复展示激活按钮，修改/删除收纳在更多操作菜单 | 5.8 | `npm test -- CronTaskDashboardPage`；`npm run test:e2e` |
| 创建、编辑、删除只调用现有 REST API 并刷新 | 1.1, 2.3, 4.2 | `npm test -- cronTaskService CronTaskDashboardPage` |
| execution records 只读展示且不自动跳 session | 2.4, 4.2 | `npm test -- CronTaskDashboardPage` |
| 不新增 gateway/runtime command/stream/persistence 修改 | 3.1 | code review、`git diff --name-only` |
| OpenSpec 严格校验 | 4.3 | `openspec validate add-agent-web-cron-task-dashboard --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/agent-web-cron-task-dashboard/spec.md` 主承载 dashboard navigation、list、mutation、execution display 行为。
- 架构和跨模块设计：`openspec/designs/architecture/cron-task-execution.md` 主承载 dashboard 只消费 REST management API、scheduler/runtime/result policy 不归前端拥有的跨模块事实。
- 模块设计：`openspec/designs/modules/agent-web.md` 主承载 route/sidebar/service/page 边界。
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md` 增加 `agent-web-cron-task-dashboard`。

## 风险与取舍（Risks / Trade-offs）

- [后端 API active change 尚未 archive] -> 本 change 明确消费当前主干已实现 API；归档前两个 change 需要按顺序同步长期基线。
- [execution result 跳转需求可能很快出现] -> 首版只读显示 `sessionId`，不定义跳转；等 B19 policy 固定后再新增导航 change。
- [prompt 在管理面可见] -> 这是 explicit management API 的核心能力；前端不把 prompt 注入 conversation、stream 或日志。
- [页面信息密度较高] -> 任务 Tab 采用单列行式卡片，移动端降为卡片内纵向排列，避免多列卡片挤压。

## 迁移计划（Migration Plan）

无数据迁移。发布后，本地工作台出现新的 sidebar 入口和 `/cron-tasks` route。回滚时移除前端 route、sidebar 入口、service 和页面，不影响已有 Cron task 后端数据和 scheduler。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/agent-web-cron-task-dashboard/spec.md`：dashboard navigation、list、mutation、execution display 行为。
- `openspec/overview.md`：Cron task 具备 Agent Tool、REST API 和 browser dashboard 三类管理入口。
- `openspec/designs/architecture/cron-task-execution.md`：browser dashboard 消费 REST management API；scheduler/runtime/result policy 仍由后端 owner 拥有。
- `openspec/designs/modules/agent-web.md`：sidebar 入口、route、service client、dashboard view state 和测试入口。
- `openspec/designs/spec-to-design-map.md`：新增 capability 导航。

## 待确认问题（Open Questions）

无。当前首版明确不实现 execution session 跳转、pause/resume、run-now 或批量操作。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-10.9-Cron工具` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/agent-web-cron-task-dashboard/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
