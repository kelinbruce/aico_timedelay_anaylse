## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.35 呈现 Agent Web 页面布局` | 统一四个既有业务页面的本地化名称、辅助名称、语义图标与页面级标题，同时保留宿主菜单差异 | `agent-web-page-layout` | `FN-10.35 呈现 Agent Web 页面布局` |
| `FN-10.9 Cron 工具` | 将定时任务看板标题收敛到定时任务页面名称，并保留前置 change 的完整目标行为 | `agent-web-cron-task-dashboard`、`cron-task-management-api` | `FN-10.9 Cron 工具` |
| `FN-1.13 查看收藏列表` | 将收藏主内容标题从“收藏”收敛到收藏列表页面名称 | `favorite-turn-list` | `FN-1.13 查看收藏列表` |

## 存量 Requirement 迁移方案

| 来源 spec / Requirement | 目标 Function / canonical spec | 原子 delta | 其他行为与未触及 Requirements 处理 | 白盒落点 | stable spec 与导航影响 |
|---|---|---|---|---|---|
| `agent-web-cron-task-dashboard` / `Cron task dashboard lists manageable tasks` | `FN-10.9 Cron 工具` / `cron-task-management-api` | 来源 `REMOVED` + 目标 `ADDED` | 目标完整保留任务/执行记录 Tab、REST API 边界、卡片结构、`createdByName`、单一卡片菜单和失败恢复，只改变页面名称来源；来源 spec 的其他 Requirements 原位保留 | `FN-10.9 Cron 工具` 的修改方案 | 来源 stable spec 继续作为 legacy spec，不退役；Function 与 spec-to-design-map 在归档时记录该 Requirement 已迁入 canonical spec |

`add-cron-task-created-by-name` 正在修改同一来源 Requirement。它是本 change 的显式前置 change，不是并行合并来源：必须先完成其归档，再以归档后的完整目标态作为本 change 的迁移输入。本 change 的实施和归档在此前保持阻塞，避免两个 active deltas 竞争同一合并键。

## `FN-10.35 呈现 Agent Web 页面布局`

### 目标与规范依据

本设计落实 proposal 中四个既有业务页面的导航标识一致性目标，并收敛三宿主已有“新建会话”命令的图形语义；共享布局只统一可见投影，不获得宿主菜单组成、会话生命周期或业务页面行为的 authority。

#### 本 Function 的目标 Requirements

canonical spec：`agent-web-page-layout`

- `ADDED`：`内置业务页面的导航标识与页面标题保持一致`
- `ADDED`：`新建会话入口跨宿主使用统一图形语义`

### 当前实现

- `zh-CN.ts` 和 `en-US.ts` 同时在 `sidebar` 与业务命名空间中保存相近页面名称。`cronTasks.title` 与 `cronTasks.managementTitle`、`sidebar.favorites` 与 `sidebar.favoritesList`、英文 `sidebar.memoryManagement` 与 `memoryManagement.title` 已产生不同可见值。
- `Sidebar.tsx` 的定时任务、收藏和记忆入口已使用主题 SVG，投诉入口仍使用 `FlagOutlined`。入口分别读取 `sidebar.*` 文案。
- `ImmersiveApp.tsx` 的 RIGHT 顶部栏使用 `StarOutlined`、`DatabaseOutlined` 和 `FlagOutlined`，与 LEFT Sidebar 和 Collaborative/PIU 菜单使用的主题 SVG 不同；该布局当前不提供定时任务入口。
- `AIAgentPiuRuntime.tsx` 的“更多”菜单已经为收藏、记忆、投诉和定时任务使用对应的浅色/暗色 SVG。菜单还在内置项之前插入动态 INNER operators，并在内置项之后保留窗口/停靠切换项。
- `refine-agent-web-expand-panel-dsl-lifecycle` 已在当前代码中让 `expandPanelStore.setView()` 清理先前 DSL 内容；投诉历史左侧扩展内容通过该入口切换，当前 change 与其没有同名 Requirement 冲突。
- `CronTaskDashboardPage.tsx` 使用 `cronTasks.managementTitle`；`FavoriteTurnsPanel.tsx` 使用 `sidebar.favorites`；`MemoryManagePage.tsx` 的页面标题已使用 `memoryManagement.title`。
- `ComplaintHistoryView.tsx` 只渲染投诉 PIU 内容。Immersive LEFT、Immersive RIGHT 和 Collaborative/PIU 左侧扩展内容直接挂载该视图，因此没有页面级标题；Collaborative/PIU 模态弹框已经提供 `sidebar.complaintHistory` 标题。
- `PageHeader` 只渲染返回操作、标题和右侧操作，不渲染页面图标，符合目标边界。
- `Sidebar.tsx` 与 `AIAgentPiuRuntime.tsx` 的新建会话入口使用 `new-session-light.svg` / `new-session-dark.svg`，图标为 `20px × 20px`；`ImmersiveApp.tsx` 的同名入口仍使用 `PlusOutlined`，但 Tooltip、`aria-label` 与点击 handler 已正确复用既有语义。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 同一页面的入口文字、Tooltip、无障碍名称和页面级标题读取唯一页面名称 | 宿主与页面分别读取多个 `sidebar.*` 和业务标题键 | 四个页面缺少唯一文案来源，中文收藏、Cron 标题和英文记忆已出现差异 |
| 同一业务入口在各宿主使用相同图形语义 | LEFT/Collaborative 已使用部分主题 SVG，Immersive RIGHT 和 LEFT 投诉仍使用 Ant Design 通用图标 | 收藏、记忆和投诉在宿主间图形语义不一致 |
| 主内容和左侧扩展内容展示页面标题，投诉模态弹框不重复标题 | 投诉 PIU 内容组件同时被主内容、扩展内容和模态弹框直接复用 | 需要区分“带页面 Header 的页面投影”和“纯 PIU 内容投影” |
| 宿主菜单集合、顺序、容器和 gate 不变 | 三个宿主本来就存在不同入口集合和 Collaborative 特有项 | 实施必须只替换标签、图标和目标视图，不重建菜单数组或导航状态 |
| 三宿主的新建会话入口使用同一图形语义 | Local 与 Collaborative/PIU 使用现有主题 SVG，Immersive 使用通用加号 | 同一命令在 Immersive 中呈现为另一套图标 |

### 修改方案

`frontend/agent-web` 继续作为三种宿主的浏览器投影 owner，不新增公共 API、共享 store、路由、持久化状态或第三方依赖。

1. 在既有 i18n 业务命名空间中确定四个页面名称的唯一来源：复用 `cronTasks.title` 和 `memoryManagement.title`；新增 `favorites.title` 与 `complaint.historyTitle`。四个键在 `zh-CN` 与 `en-US` 中使用 spec 的精确名称。目标入口、Tooltip、`aria-label`、Page Header 和投诉模态标题均读取这些业务键。替换完成后，删除已无消费者的 `sidebar.cronTasks`、`sidebar.favoritesList`、`sidebar.memoryManagement`、`sidebar.complaintHistory` 与 `cronTasks.managementTitle`；`sidebar.favorites` 仍可保留给非页面名称的既有收藏上下文，不改变其语义。
2. `Sidebar.tsx` 继续保留当前 `mode` 和投诉探针 gate，只将四个已有入口改读业务标题键，并让投诉入口与另外三个入口一样使用 `complaint-light.svg` / `complaint-dark.svg`。NavButton 既有 20px 尺寸、Tooltip 和 active 反馈不变。
3. `ImmersiveApp.tsx` 的 RIGHT 顶部栏只替换当前已有的收藏、记忆和投诉入口：分别使用 `favorites-*`、`memory-*`、`complaint-*` 主题 SVG，保持既有按钮尺寸、Tooltip、`aria-label`、`aria-pressed`、事件 handler 和排列位置。不得补充定时任务按钮。
4. `AIAgentPiuRuntime.tsx` 保留动态 operators、收藏、记忆、按探针显示的投诉、定时任务、窗口/停靠切换的现有顺序及图标实现，只把四个内置项和投诉模态标题改读业务标题键。投诉扩展内容仍按 `setView()` 后 `open()` 的顺序切换，以保留既有 DSL 清理生命周期；不得排序、过滤或抽取会改变菜单数组拼接顺序的新结构。
5. `ComplaintHistoryView` 继续是纯 PIU 内容组件并保留探针关闭时返回 `null`、主题/语言重挂载、`PiuRenderer` 参数和 `window.Prel` 降级行为。在同一文件新增 `ComplaintHistoryPage`：使用现有 `PageHeader` 和一个高度为 100%、`min-height: 0` 的纵向 flex 容器，把剩余高度交给原 `ComplaintHistoryView`。Immersive LEFT、Immersive RIGHT 和 Collaborative/PIU 左侧扩展内容使用 `ComplaintHistoryPage`；模态弹框继续使用纯 `ComplaintHistoryView`，从而只显示一个标题。该包装不得引入第二个纵向滚动 owner，也不得改变 PIU 内容的 16px 内边距。
6. Page Header 继续只展示文字标题；主题图标只属于入口。浅色/暗色图标继续由当前宿主主题选择，所有 `<img>` 保持 `alt=""` 和 `aria-hidden="true"`，由按钮或菜单项提供可访问名称。
7. `ImmersiveApp.tsx` 的新建会话按钮复用现有 `new-session-light.svg` / `new-session-dark.svg`，按 `hostTheme` 选择资源并以 `20px × 20px` 装饰图像渲染。保留按钮的 `type="text"`、`size="small"`、Tooltip、`aria-label`、位置和 `handleNewSession`，不修改会话导航或创建生命周期；Local 与 Collaborative/PIU 的既有实现不改。

选择复用业务 i18n 键而不是增加一个全局页面注册表：本 change 只有四个静态名称和既有入口，额外注册表会复制宿主可见性与 handler 并形成第二个菜单 owner。图标继续直接消费仓内现有主题资源，避免新依赖和新目录。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可维护性 | 无新增黑盒质量目标；来源为功能性 Requirements `内置业务页面的导航标识与页面标题保持一致`、`新建会话入口跨宿主使用统一图形语义` | 一个业务页面只保留一个页面名称键；同一新建会话命令复用既有主题资源；不建立全局菜单注册表 | 扫描目标入口不得继续读取已废弃的 `sidebar.*` 页面名称键或使用第二套新建会话图标 |
| 可测试性 | 无新增黑盒质量目标；来源为功能性 Requirements `内置业务页面的导航标识与页面标题保持一致`、`新建会话入口跨宿主使用统一图形语义` | 入口图片保持装饰性，按钮名称与标题可由 DOM 黑盒断言 | 两种语言、两种主题和三个宿主的名称、图标语义、尺寸及标题数量可重复验证 |

## `FN-10.9 Cron 工具`

### 目标与规范依据

定时任务看板使用共享页面名称，同时无损保留任务管理、创建人展示和失败恢复行为。

#### 本 Function 的目标 Requirements

canonical spec：`cron-task-management-api`

- `ADDED`：`Cron task dashboard lists manageable tasks`

### 当前实现

- `CronTaskDashboardPage.tsx` 已使用统一 `PageLayout`，但 Header 标题读取 `cronTasks.managementTitle`，中文显示“定时任务管理”、英文显示“Scheduled task management”。
- Sidebar 与 Collaborative/PIU 已有定时任务入口读取 `sidebar.cronTasks`，显示“定时任务”或“Scheduled tasks”；Immersive RIGHT 没有该入口。
- `add-cron-task-created-by-name` 已形成 complete 状态的 planning artifacts，并修改同一个 legacy Requirement，目标包含 `createdByName` 与单一卡片菜单约束；当前仍未归档。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 看板 Header 使用共享定时任务页面名称 | 页面使用独立的 management title | Header 与已有菜单名称不一致 |
| 目标 Requirement 位于 canonical spec 且保留前置 change 行为 | 同名 Requirement 仍在 legacy spec，并被未归档 change 修改 | 需要在前置 change 归档后执行原子迁移，不能直接并行合并 |

### 修改方案

- 实施前先确认 `add-cron-task-created-by-name` 已归档且 `openspec validate --all --strict` 通过；若未满足，Cron 实施 task 保持阻塞。
- `CronTaskDashboardPage.tsx` 只把 Header 标题改为 `cronTasks.title`。不修改 PageLayout、actions、Tab、卡片、分页、REST API、`createdByName`、错误恢复或滚动边界。
- OpenSpec 归档时，从 `agent-web-cron-task-dashboard` 移除该 Requirement，并把本 change 中保留前置 change 完整目标态且更新标题来源的同名 Requirement合入 `cron-task-management-api`。来源 spec 的其他 Requirements 与导航继续保留。
- 组件测试同时断言页面标题和前置 change 的创建人/菜单行为，防止标题修复通过覆盖旧 delta 造成回归。

## `FN-1.13 查看收藏列表`

### 目标与规范依据

收藏列表页面使用共享页面名称，收藏业务行为和各宿主导航方式保持不变。

#### 本 Function 的目标 Requirements

canonical spec：`favorite-turn-list`

- `MODIFIED`：`Local 与 Immersive 收藏内容视图`

### 当前实现

- `Sidebar.tsx` 和 Collaborative/PIU 菜单使用 `sidebar.favoritesList`，中文显示“收藏列表”、英文显示“Favorites List”。
- Immersive RIGHT 顶部按钮和 `FavoriteTurnsPanel.tsx` 的 PageLayout 标题读取 `sidebar.favorites`，中文显示“收藏”、英文显示“Favorites”。
- 收藏路由、过滤、分组、展开、分页、取消收藏、Markdown 和滚动行为集中在现有 `FavoriteTurnsPanel` 及其 service/store 路径中，与标题键没有业务依赖。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 收藏既有入口与页面标题使用收藏列表页面名称 | 两组入口和页面分别读取 `favoritesList` 与 `favorites` | 中文和英文均存在可见名称差异 |
| 标题修改不改变收藏行为 | 收藏大 Requirement 同时承载全部业务行为 | delta 必须完整重述并仅修改页面名称段，防止归档丢失其余行为 |

### 修改方案

- 新增 `favorites.title` 作为收藏列表页面名称唯一来源；`Sidebar.tsx`、Immersive RIGHT、Collaborative/PIU 菜单以及 `FavoriteTurnsPanel` 的 PageLayout 标题改读该键。
- `FavoriteTurnsPanel` 的 section 与 tablist 若表达整个收藏页面，也使用 `favorites.title`；收藏问题、回答、过滤、空态、分组和操作文案继续使用现有细粒度键。
- 不修改 `/favorites` 路由、查询参数、分页方式、展开状态、滚动元素、取消收藏写入、对话定位或 Markdown 渲染。
- 组件测试在断言新标题的同时继续运行收藏现有交互测试，确保大 Requirement 的完整目标态未被标题改动削弱。

## 跨 Function 协作与端到端流程

`FN-10.35` 定义页面名称和入口图形语义，`FN-10.9` 与 `FN-1.13` 的页面只消费各自业务 i18n 标题键，不反向拥有宿主菜单。渲染流程为：当前语言与主题进入宿主投影 → 宿主按自己的既有集合、顺序和 gate 选择入口 → 入口与页面读取同一个业务标题键 → 入口选择既有主题图标 → 页面沿用原业务 Function 的路由、状态和内容行为。投诉和记忆没有业务 Function delta：本 change 只改变它们在 `FN-10.35` 边界内的导航标识投影。

## 验证策略（Verification Strategy）

- component/unit 层在 `zh-CN` 与 `en-US` 下分别渲染 Sidebar、Immersive RIGHT、Collaborative/PIU More 菜单和三个页面投影，断言入口可见名称、Tooltip、无障碍名称、页面标题与主题图标语义；另断言 Immersive 新建会话按钮在两种主题下复用现有 `new-session` SVG 且维持原 handler。
- component/integration 层断言 Local 仍不出现记忆和投诉，Immersive RIGHT 仍不出现定时任务，投诉探针关闭时仍无入口，Collaborative/PIU 的动态 operator 和窗口/停靠项位置不变。
- complaint 组件测试分别覆盖 `ComplaintHistoryPage` 与模态弹框：主内容/扩展内容恰好一个 Page Header，模态弹框恰好一个标题且不嵌套 Page Header；`window.Prel` 不可用的原降级结果保持。
- Cron 与收藏现有组件测试作为 characterization，除新标题断言外继续覆盖 `createdByName`、单一卡片菜单、收藏过滤/分组/分页/滚动和错误恢复，避免完整 Requirement 重述引入行为回归。
- Playwright 在真实浏览器中遍历可用宿主与主题，检查四个入口的可见名称、图标、选择后标题以及 Collaborative/PIU 特有菜单项；截图用于人工确认图标大小与主题对比，不以截图替代 DOM 断言。
- architecture/文档层通过 `openspec validate --all --strict` 检查 delta 合并键、Function 元数据和迁移原子性；前端 build、mode artifact build 和相关测试证明三宿主编译与投影一致。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/agent-web-page-layout/spec.md`：合入导航标识与页面标题一致性 Requirement。
- `openspec/specs/cron-task-management-api/spec.md`：合入迁移后的 Cron 看板完整目标 Requirement。
- `openspec/specs/agent-web-cron-task-dashboard/spec.md`：移除已迁往 canonical spec 的同名 Requirement，保留其他 Requirements。
- `openspec/specs/favorite-turn-list/spec.md`：合入收藏列表页面名称目标态。
- `openspec/designs/functions/.../FN-10.35-呈现AgentWeb页面布局.md`：刷新描述和页面/宿主范围规格。
- `openspec/designs/functions/.../FN-10.9-Cron工具.md`：刷新看板描述、主规格与 legacy spec 导航。
- `openspec/designs/functions/.../FN-1.13-查看收藏列表.md`：刷新收藏页面名称描述。
- `openspec/designs/features/.../F-8.2-长期记忆.md`：在组成 Functions 中增加 `FN-10.35`，并在描述中导航到记忆管理入口与页面标题呈现；用户价值、数据边界和质量保证不变。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/`：无；不改变架构边界、公共契约、状态或数据 owner。
- `openspec/designs/modules/agent-web.md`：补充业务页面名称键、主题图标和页面/纯内容投诉投影的 owner 边界。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：更新 Cron Requirement 的 canonical/legacy 导航与本 change 的前端验证入口。

## 风险与取舍（Risks / Trade-offs）

- Cron 同名 Requirement 与前置 active change 冲突；通过强制归档顺序和目标 delta 无损保留 `createdByName`/菜单行为缓解，未满足前提时不得实施。
- `refine-agent-web-expand-panel-dsl-lifecycle` 与本 change 都触达 Collaborative/PIU 扩展内容代码，但前者的目标实现已进入当前代码且不修改本 change 的 Requirements；实施时保留 `setView()` → `open()` 顺序和对应回归测试，避免视图包装绕过 DSL 清理。
- 收藏 Requirement 较大，完整重述容易意外丢失无关行为；通过基线 block 逐段对比和现有收藏 characterization 测试缓解。
- 投诉内容组件同时服务页面和模态弹框，误用包装组件会产生双标题或额外滚动；通过分离 `ComplaintHistoryPage` 与 `ComplaintHistoryView` 并分别测试缓解。
- 宿主图标尺寸不同会保留轻微视觉尺度差异；这是导航区域已有尺寸契约，统一的是图形语义而不是像素尺寸。

## 迁移与回滚（Migration / Rollback）

1. 先归档并严格验证 `add-cron-task-created-by-name`。
2. 再实施本 change 的 i18n、入口图标和页面标题修改，并完成三宿主前端验证。
3. 最后按原子迁移对归档本 change；不得只归档 Cron 来源 `REMOVED` 或只归档目标 `ADDED`。

本 change 不涉及数据迁移或公共 API 兼容窗口。若真实浏览器验收发现菜单集合、标题数量或图标主题回归，回滚本 change 的前端提交和整个 OpenSpec delta；回滚后恢复原可见文案与图标，不影响 Cron 数据、收藏数据、记忆数据或投诉服务。

## 待确认问题（Open Questions）

无。
