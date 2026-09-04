## 0. 跨 Function 前置门禁

- [x] 0.1 确认 `add-cron-task-created-by-name` 已归档，归档后的 `FN-10.9 Cron 工具` 已将 `cron-task-management-api` 声明为 canonical 主规格，且其 `createdByName` 展示、null 占位符和单一卡片菜单目标已经进入 stable spec；此前不得开始本 change 的 Cron 实施或归档。
  来源：`FN-10.9 Cron 工具`；design `存量 Requirement 迁移方案`、`迁移与回滚`
  验证：在仓库根目录运行 `openspec list --json` 和 `openspec validate --all --strict`；预期前置 change 不再处于 active changes、对应 archive 存在、`FN-10.9` 的主规格为 `cron-task-management-api` 且全量 strict validation 通过。随后对比前置 archive 与本 change 的 `Cron task dashboard lists manageable tasks`，预期 `createdByName`、`-` 占位符和单一卡片菜单义务均被保留。

## 1. `FN-10.35 呈现 Agent Web 页面布局`

- [x] 1.1 先扩展 `sidebar.component.test.tsx`、`immersive-routing.test.tsx` 和 `piu-runtime-contract.test.tsx`，在 `zh-CN` / `en-US` 与浅色 / 暗色主题下断言四个已有入口的名称、Tooltip、无障碍名称和图标语义，同时断言 Local 不新增记忆/投诉、Immersive RIGHT 不新增定时任务、Collaborative/PIU 的动态 operator 与窗口/停靠项顺序不变；实施前运行并记录目标断言失败。
  来源：`FN-10.35 呈现 Agent Web 页面布局` + `内置业务页面的导航标识与页面标题保持一致` + `已有入口使用统一名称和图形语义`、`宿主特有菜单保持不变`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/sidebar.component.test.tsx tests/immersive-routing.test.tsx tests/piu-runtime-contract.test.tsx`；实施前预期新增目标断言失败，实施后预期全部通过。

- [x] 1.2 先补充投诉历史页面/纯内容投影测试：主内容和 Collaborative/PIU 左侧扩展内容恰好显示一个“投诉历史”/“Complaint History”Page Header，模态弹框使用纯内容且恰好显示一个弹框标题，探针关闭时不出现入口或页面；实施前运行并记录目标断言失败。
  来源：`FN-10.35 呈现 Agent Web 页面布局` + `内置业务页面的导航标识与页面标题保持一致` + `页面标题与所选入口一致`、`投诉历史弹框只展示一个标题`、`宿主特有菜单保持不变`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/immersive-routing.test.tsx tests/piu-runtime-contract.test.tsx`；实施前预期页面标题目标断言失败，实施后预期标题数量和探针 gate 断言全部通过。

- [x] 1.3 修改 `zh-CN.ts`、`en-US.ts`、`Sidebar.tsx`、`ImmersiveApp.tsx` 和 `AIAgentPiuRuntime.tsx`：以 `cronTasks.title`、`favorites.title`、`memoryManagement.title`、`complaint.historyTitle` 作为四个页面名称唯一来源，将已有入口改用对应主题 SVG 与装饰图像无障碍属性，并删除已无消费者的平行页面名称键；不得改变任何宿主的菜单集合、顺序、gate、handler 或 active 状态。
  来源：`FN-10.35 呈现 Agent Web 页面布局` + `内置业务页面的导航标识与页面标题保持一致` + `已有入口使用统一名称和图形语义`、`宿主特有菜单保持不变`；design `FN-10.35 呈现 Agent Web 页面布局 / 修改方案` 1–4、6
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/sidebar.component.test.tsx tests/immersive-routing.test.tsx tests/piu-runtime-contract.test.tsx`；预期两种语言和主题下名称/图标断言通过，宿主 negative cases 与 Collaborative 特有菜单顺序断言通过。再运行 `rg -n "sidebar\\.(cronTasks|favoritesList|memoryManagement|complaintHistory)|cronTasks\\.managementTitle" src`；预期无生产代码命中。

- [x] 1.4 在 `ComplaintHistoryView.tsx` 同文件新增只负责 Page Header 和剩余高度的 `ComplaintHistoryPage`，让 Immersive LEFT、Immersive RIGHT 和 Collaborative/PIU 左侧扩展内容使用页面包装，而模态弹框继续使用纯 `ComplaintHistoryView`；Collaborative/PIU 必须保留 `setView()` → `open()` 顺序，不得增加第二个滚动 owner、重复 16px 内容内边距或改变 DSL 清理、PIU 或探针降级路径。
  来源：`FN-10.35 呈现 Agent Web 页面布局` + `内置业务页面的导航标识与页面标题保持一致` + `页面标题与所选入口一致`、`投诉历史弹框只展示一个标题`；design `FN-10.35 呈现 Agent Web 页面布局 / 修改方案` 4–5
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/immersive-routing.test.tsx tests/piu-runtime-contract.test.tsx tests/page-layout.component.test.tsx`；预期主内容/扩展内容 Page Header、模态单标题、探针关闭和既有 PageLayout 几何/滚动断言全部通过。

- [x] 1.5 完成 `FN-10.35` 组件级验证，确认入口图标为装饰图像、按钮/菜单项保留页面名称，Page Header 不渲染业务图标，且三宿主差异未被统一掉。
  来源：`FN-10.35 呈现 Agent Web 页面布局` + `内置业务页面的导航标识与页面标题保持一致` 全部 Scenarios；design `FN-10.35 呈现 Agent Web 页面布局 / 质量属性影响`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/sidebar.component.test.tsx tests/immersive-routing.test.tsx tests/piu-runtime-contract.test.tsx tests/page-layout.component.test.tsx`；预期全部通过且无 duplicate accessible name 或重复标题警告。

- [x] 1.6 先扩展 `immersive-routing.test.tsx`，在 `zh-CN` / `en-US` 与浅色 / 暗色主题下断言 Immersive RIGHT 新建会话按钮使用 `new-session-light.svg` / `new-session-dark.svg`、`20px × 20px` 装饰图像，并保留本地化按钮名称与既有导航结果；实施前运行并记录图标断言失败。
  来源：`FN-10.35 呈现 Agent Web 页面布局` + `新建会话入口跨宿主使用统一图形语义` + `三宿主的新建会话入口使用主题图标`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/immersive-routing.test.tsx`；实施前预期新图标断言失败，实施后预期全部通过。

- [x] 1.7 修改 `ImmersiveApp.tsx`，让 RIGHT 顶栏新建会话按钮按宿主主题复用现有 `new-session` SVG，删除已无消费者的 `PlusOutlined` import；不得改变按钮容器、Tooltip、`aria-label`、排列位置或 `handleNewSession`。
  来源：`FN-10.35 呈现 Agent Web 页面布局` + `新建会话入口跨宿主使用统一图形语义`；design `FN-10.35 呈现 Agent Web 页面布局 / 修改方案` 7
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/immersive-routing.test.tsx` 和 `npm run build`；预期退出码为 0。

## 2. `FN-10.9 Cron 工具`

- [x] 2.1 先修改 `CronTaskDashboardPage.test.tsx`，断言 `zh-CN` Header 为“定时任务”、`en-US` Header 为“Scheduled tasks”，并保留 `createdByName`、null 时 `-` 占位符和单一卡片菜单断言；实施前运行并记录标题断言失败、characterization 断言通过。
  来源：`FN-10.9 Cron 工具` + `Cron task dashboard lists manageable tasks` + `看板渲染任务列表`、`看板服务不可用`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/CronTaskDashboardPage.test.tsx`；实施前预期仅新增标题目标失败，实施后预期全部通过。

- [x] 2.2 将 `CronTaskDashboardPage.tsx` 的 Header 标题改读 `cronTasks.title`，不修改 PageLayout、actions、Tab、卡片、REST API、`createdByName`、菜单互斥、错误恢复或滚动边界。
  来源：`FN-10.9 Cron 工具` + `Cron task dashboard lists manageable tasks` + `看板渲染任务列表`、`看板服务不可用`；design `FN-10.9 Cron 工具 / 修改方案`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/CronTaskDashboardPage.test.tsx`；预期新标题及全部既有任务看板行为断言通过。

- [x] 2.3 以不可拆分结果确认 `Cron task dashboard lists manageable tasks` 从 `agent-web-cron-task-dashboard` `REMOVED` 并向 `cron-task-management-api` `ADDED`：目标完整承载前置 change 与本 change 的黑盒行为，来源其他 Requirements 原位保留，Function 与直接导航引用指向 canonical/legacy 目标态。
  来源：`FN-10.9 Cron 工具` + `Cron task dashboard lists manageable tasks`；design `存量 Requirement 迁移方案`、`FN-10.9 Cron 工具 / 修改方案`
  验证：在仓库根目录运行 `openspec validate align-agent-web-navigation-titles-and-icons --strict` 和 `openspec validate --all --strict`；预期原子迁移、合并键和全量规格验证通过。人工 code review 对比前置 archive、来源 stable block 与目标 delta，预期除页面名称来源外无黑盒行为丢失。

## 3. `FN-1.13 查看收藏列表`

- [x] 3.1 先修改 `favorite-turns-panel.test.tsx`，断言 `zh-CN` Page Header/页面名称为“收藏列表”、`en-US` 为“Favorites List”，并保留收藏过滤、分组、展开、分页、滚动、取消收藏和失败恢复 characterization；实施前运行并记录标题断言失败、既有行为断言通过。
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图` + `收藏页面使用统一 Header` 以及该 Requirement 其余既有 Scenarios
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/favorite-turns-panel.test.tsx`；实施前预期新增标题目标失败，实施后预期全部通过。

- [x] 3.2 将 `FavoriteTurnsPanel.tsx` 的 Page Header、页面 section 和页面级 tablist 名称改读 `favorites.title`；Sidebar、Immersive RIGHT 与 Collaborative/PIU 收藏入口由共享入口任务同步改读该键，不修改 `/favorites` 路由、查询、分页、展开、滚动、写入、Markdown 或对话定位。
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图` + `收藏页面使用统一 Header`、`LEFT 布局在主内容展示收藏且保留最近会话`、`RIGHT 布局展示相同收藏分组`、`PIU 更多菜单在左侧扩展内容容器展示收藏`；design `FN-1.13 查看收藏列表 / 修改方案`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/favorite-turns-panel.test.tsx tests/local-favorites-navigation.test.tsx tests/favorite-sidebar.test.tsx`；预期收藏列表标题与全部导航/内容行为断言通过。

- [x] 3.3 对比 `favorite-turn-list` stable block 与本 change 的完整 MODIFIED block，确认仅页面名称段和对应 Scenario 发生目标变化，其他规范性正文与 Scenarios 无损保留。
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图`；design `FN-1.13 查看收藏列表 / GAP 分析`、`风险与取舍`
  验证：在仓库根目录运行 `openspec validate align-agent-web-navigation-titles-and-icons --strict`；预期通过。人工 code review 对两个完整 Requirement block 做逐段对比，预期不存在无关删除、弱化或新增行为。

## 4. 跨 Function 集成与整体验证

- [x] 4.1 在真实浏览器中覆盖可用的 Local、Immersive LEFT/RIGHT 与 Collaborative/PIU 路径，验证四个已有入口在两种语言和两种主题下的名称、图标、选择后标题、投诉单标题及宿主特有菜单；保存 DOM 断言和关键截图证据。
  来源：`FN-10.35`、`FN-10.9`、`FN-1.13`；design `跨 Function 协作与端到端流程`、`验证策略`
  验证：在 `frontend/agent-web` 运行 `npm run test:e2e -- tests/e2e/page-layout.spec.cjs tests/e2e/cron-task-dashboard.spec.cjs tests/e2e/complaint-feedback.spec.cjs`；预期全部通过，截图中无重复标题、错误图标或菜单集合/顺序漂移。

- [x] 4.2 完成前端编译、三宿主 artifact 和相关单测门禁，确认没有遗留 i18n key、未使用图标 import、类型错误或宿主模式构建差异。
  来源：proposal `影响范围`；design `验证策略`
  验证：在 `frontend/agent-web` 依次运行 `npm test -- tests/CronTaskDashboardPage.test.tsx tests/favorite-turns-panel.test.tsx tests/sidebar.component.test.tsx tests/immersive-routing.test.tsx tests/piu-runtime-contract.test.tsx tests/page-layout.component.test.tsx`、`npm run build`、`npm run build:vite:modes`；预期全部退出码为 0。

- [x] 4.3 完成 OpenSpec 全量 strict validation 与最终语义 review，确认前置依赖已满足、三个 Function 的目标一致、Cron 原子迁移无丢失、投诉 legacy 业务规格未被错误改写，并给出 PASS / PASS WITH FOLLOW-UP / BLOCKED 结论。
  来源：design `存量 Requirement 迁移方案`、`验证策略`、`长期基线刷新计划`、`风险与取舍`
  验证：在仓库根目录运行 `openspec validate --all --strict`；预期退出码为 0。随后按 `$nextagent-skill-review` 执行语义检视，预期无 P0/P1，且所有 P2 均有明确 follow-up。

- [x] 4.4 在真实浏览器复核 Immersive RIGHT 的新建会话按钮，确认浅色/暗色主题资源、`20px × 20px` 可见尺寸、Tooltip、无障碍名称和点击导航结果，并重新执行目标 change 与全仓严格校验。
  来源：`FN-10.35` + `新建会话入口跨宿主使用统一图形语义`；design `验证策略`
  验证：运行相关 Playwright 场景、`openspec validate align-agent-web-navigation-titles-and-icons --strict` 与 `openspec validate --all --strict`；预期全部通过并保存截图/DOM 证据。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程必须按照 design 的“长期基线刷新计划”归并 stable specs、三个 Function、`F-8.2 长期记忆`、`agent-web` 模块设计和 spec-to-design-map；其他 Feature、overview、architecture 与 ADR 保持不变。归档检查还必须确认 Cron 来源 stable spec 未被误退役、原子迁移两端同时生效，且长期文档没有重复定义页面名称、菜单 owner 或图标映射。
