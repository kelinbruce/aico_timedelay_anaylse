## 1. Cron task 前端 service

- [x] 1.1 新增 `cronTaskService`，封装 list/create/update/delete/list executions 五个现有 REST API，并定义前端内部 DTO 类型。
  验证：`npm test -- cronTaskService`
  来源：`Cron task dashboard lists manageable tasks`；design 决策 3。
- [x] 1.2 补 service negative tests，断言 create/update body 只发送 `cron`、`prompt`、`recurring`，list/executions query 只发送 `offset`、`limit`。
  验证：`npm test -- cronTaskService`
  来源：design 安全质量属性；`Cron task dashboard manages task mutations`。

## 2. Route、sidebar 和 dashboard 页面

- [x] 2.1 在 `ChatWorkspace` 增加 `/cron-tasks` route，并在 `Sidebar` 新建会话入口下方增加定时任务 `NavButton`；点击跳转 `/cron-tasks`，active 状态跟随 route，且不修改 session/favorite 数据。
  验证：`npm test -- app.routes sidebar.component`
  来源：`Cron task dashboard navigation`；design 决策 1、2。
- [x] 2.2 新增 `CronTaskDashboardPage` 列表和详情视图，覆盖 loading、empty、error、retry、select task 和 responsive layout。
  验证：`npm test -- CronTaskDashboardPage`
  来源：`Cron task dashboard lists manageable tasks`；design 决策 4。
- [x] 2.3 在 dashboard 实现 create/edit/delete 表单与确认流；成功后刷新列表和详情，validation/not found/inactive update/unavailable 以可恢复错误呈现。
  验证：`npm test -- CronTaskDashboardPage`
  来源：`Cron task dashboard manages task mutations`；design 质量属性可靠性/恢复。
- [x] 2.4 在 dashboard 详情区实现 execution records 只读展示；选中 task 后加载 `/runs`，展示加载、空态、错误态和 result preview，不自动跳转 session。
  验证：`npm test -- CronTaskDashboardPage`
  来源：`Cron task dashboard displays execution records`；design 决策 5。
- [x] 2.5 补充 `zh-CN` 与 `en-US` i18n 文案，覆盖 sidebar 入口、dashboard 标题、按钮、表单字段、状态和错误文案。
  验证：`npm test -- i18n`
  来源：proposal 影响范围；dashboard 用户可见行为。

## 3. 边界检查

- [x] 3.1 检查本 change 未修改后端 API、`agent-contracts`、gateway、runtime、scheduler 或 stream event；若发现误改，拆出或回退到前端范围。
  验证：`git diff --name-only` code review 检查点
  来源：proposal 非目标；design 验证映射。
- [x] 3.2 补充 route/page tests，断言打开 `/cron-tasks` 不触发 chat session 加载或 conversation store mutation。
  验证：`npm test -- app.routes CronTaskDashboardPage`
  来源：`Cron task dashboard navigation`；design 决策 2。

## 4. 验证和收尾

- [x] 4.1 运行前端聚焦测试。
  验证：`cd frontend/agent-web && npm test -- cronTaskService CronTaskDashboardPage app.routes sidebar.component i18n`
  来源：design 验证映射。
- [x] 4.2 运行前端 TypeScript build。
  验证：`cd frontend/agent-web && npm run build`
  来源：AGENTS 前端验证门禁。
- [x] 4.3 运行 OpenSpec strict validation。
  验证：`openspec validate add-agent-web-cron-task-dashboard --strict`
  来源：OpenSpec 变更门禁。
- [x] 4.4 运行 Playwright E2E 集成验证，覆盖 sidebar 入口跳转、任务卡片展示、执行记录筛选和删除确认。
  验证：`cd frontend/agent-web && npm run test:e2e`
  来源：用户要求执行 Playwright E2E 集成验证。

## 5. Tab 和任务卡片调整

- [x] 5.1 将 dashboard 主体调整为“任务 / 执行记录”两个 Tab；任务 Tab 使用卡片展示定时任务标题、定时任务内容、执行时间和执行策略。
  验证：`npm test -- CronTaskDashboardPage`
  来源：`Cron task dashboard lists manageable tasks`；用户最新页面要求。
- [x] 5.2 在任务卡片中提供“执行、修改、删除”操作；执行切换到该任务执行记录 Tab，修改打开编辑表单，删除经确认后调用现有 delete API。
  验证：`npm test -- CronTaskDashboardPage`
  来源：`Cron task dashboard manages task mutations`；design 决策 4。
- [x] 5.3 复跑前端聚焦测试、前端 TypeScript build 和 OpenSpec strict validation。
  验证：`cd frontend/agent-web && npm test -- cronTaskService CronTaskDashboardPage app.routes sidebar.component i18n`；`cd frontend/agent-web && npm run build`；`openspec validate add-agent-web-cron-task-dashboard --strict`
  来源：AGENTS 前端验证门禁；OpenSpec 变更门禁。
- [x] 5.4 移除任务 Tab 下的任务总数、当前页、执行记录指标块，并将任务卡片调整为单列行式平铺。
  验证：`npm test -- CronTaskDashboardPage`
  来源：用户最新页面要求。
- [x] 5.5 将执行记录调整为单列行式记录卡片；每行展示定时任务卡片标题、执行时间、执行结果摘要，并通过“查看详情”展开完整状态和结果内容。
  验证：`npm test -- CronTaskDashboardPage`
  来源：用户最新执行记录页面要求。
- [x] 5.6 在执行记录 Tab 增加按时间日期段和定时任务名称筛选；筛选基于已加载 task 标题/ID 与 execution `scheduledAt` 本地过滤，不扩展 `/runs` 查询参数。
  验证：`npm test -- CronTaskDashboardPage`；`npm test -- cronTaskService`
  来源：用户最新执行记录筛选要求；`Cron task dashboard displays execution records`。
- [x] 5.7 将定时任务页面刷新为会话界面同类布局：顶部 Header 左侧“定时任务管理”，右侧“手动创建”和 primary 风格“通过会话创建”；主体按会话界面最大宽度居中；任务卡片改为 header/content/footer，header 右侧展示操作按钮和开启 switch，footer 展示时间、频率和创建人。
  验证：`cd frontend/agent-web && npm test -- cronTaskService CronTaskDashboardPage app.routes sidebar.component i18n`；`cd frontend/agent-web && npm run build`；`cd frontend/agent-web && npm run test:e2e`
  来源：用户最新整体样式刷新要求；`Cron task dashboard lists manageable tasks`。
- [x] 5.8 移除任务卡片中与 switch 重复的独立“激活”按钮；将“修改”和“删除”收纳到 `...` 更多操作菜单，点击菜单后展开操作项。
  验证：`cd frontend/agent-web && npm test -- CronTaskDashboardPage`；`cd frontend/agent-web && npm run test:e2e`
  来源：用户最新任务卡片操作收敛要求；`Cron task dashboard lists manageable tasks`。
- [x] 5.9 移除任务标题下方与 switch 重复的 `ACTIVE`/`PAUSED` 状态文本，并将 `...` 更多操作按钮的省略号垂直居中。
  验证：`cd frontend/agent-web && npm test -- CronTaskDashboardPage`；页面截图检查
  来源：用户最新任务卡片视觉收敛要求；`Cron task dashboard lists manageable tasks`。
- [x] 5.10 移除执行记录 Tab 顶部选中任务信息框；执行记录行改为 header 左侧标题、右侧执行时间，content 展示执行结果概要。
  验证：`cd frontend/agent-web && npm test -- CronTaskDashboardPage`；页面截图检查
  来源：用户最新执行记录布局收敛要求；`Cron task dashboard displays execution records`。
- [x] 5.11 在执行记录列表左侧增加按天聚合的时间线，展示每天执行过的 task 和执行次数，并随当前筛选后的执行记录同步变化。
  验证：`cd frontend/agent-web && npm test -- CronTaskDashboardPage`；`cd frontend/agent-web && npm run test:e2e`
  来源：用户最新执行记录时间线要求；`Cron task dashboard displays execution records`。
- [x] 5.12 将任务卡片“执行”改为即时触发一次 Cron task 执行：新增 run-now Web management API，后端复用 Cron trigger delivery/runtime 路径；前端点击后调用该 API、切换执行记录 Tab 并刷新记录。
  验证：`npm test -- packages/agent-app/tests/cron-management-composition.test.ts packages/agent-channel-web/tests/cron-task-management-routes.test.ts`；`cd frontend/agent-web && npm test -- cronTaskService CronTaskDashboardPage`；`cd frontend/agent-web && npm run build`；`openspec validate add-agent-web-cron-task-dashboard --strict`
  来源：用户最新“点击执行时，需要触发一次即时的定时任务执行”要求；`Cron task dashboard manages task mutations`。
## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/agent-web-cron-task-dashboard/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/cron-task-execution.md`。
- 按需更新 `openspec/designs/modules/agent-web.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一 route、API schema、scheduler/runtime owner 或 result navigation policy。
