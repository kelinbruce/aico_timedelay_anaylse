## 1. `FN-10.35 呈现 Agent Web 页面布局`

- [x] 1.1 完成 `右侧布局宽度` 的原子迁移 delta：`agent-web-right-pane-styles` 来源使用 `REMOVED`，`agent-web-page-layout` 目标使用 `ADDED` 完整承载 `contained/1080px` 及新增 `fluid` 宽度语义，来源其他三个 Requirements 原位保留，直接引用不再把宽度归属到会话专用布局
  来源：`FN-10.35` + design `存量 Requirement 迁移方案`、proposal `Function 影响（OpenSpec Capabilities）`
  验证：在仓库根目录运行 `openspec validate unify-agent-web-page-layout --strict`；预期校验通过，且人工检查来源/目标 operation、Function 归属和未触及 Requirements 均完整

- [x] 1.2 在 `frontend/agent-web/tests/page-layout.component.test.tsx` 建立统一 Header、页面 actions 原样投影、`contained|fluid` Content 和 docked Footer 的目标行为测试，并删除共享布局自动分类、收纳或生成页面操作菜单的测试
  来源：`FN-10.35` + `Agent Web 页面使用统一三段式布局` + `无 Footer 页面使用完整剩余高度`、`docked Footer 保持在页面底部`；`页面 Header 保持一致且在窄视口可用` + `标准宽度展示标题和操作`、`页面操作区域保持页面声明`、`窄视口保持单行 Header`；`页面 Content 支持 contained 与 fluid 宽度` + `默认使用 contained 模式`、`fluid 模式占满安全区域`、`Footer 与 Content 内容列对齐`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/page-layout.component.test.tsx`；实现前预期新增目标断言失败，实现后预期全部通过

- [x] 1.3 在 `PageLayout.tsx` 与 `PageLayout.css` 中实现共享 `PageHeader`、`PageContentFrame` 和普通页面 `PageLayout`，使共享原语唯一拥有 Header 几何、页面 actions 原样投影与内容宽度，模板拥有普通滚动几何和 docked Footer，并拒绝 action descriptor、自动菜单、任意 leading 节点、会话 viewport bindings 或通用 overlay Footer；不新增目录层级和依赖
  来源：design `FN-10.35 呈现 Agent Web 页面布局 / 修改方案 / 1. 新增共享布局原语与单一 PageLayout 页面模板`、`2. 由共享内容 frame 显式承载宽度，由模板承载普通滚动几何`、`5. 失败与降级边界`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/page-layout.component.test.tsx` 和 `npm run build`；预期布局测试全部通过且 TypeScript 无错误，code review 确认组件没有业务 API、chat follow/anchor/pagination 状态、任意 leading slot 或 overlay footer mode

- [x] 1.4 调整 `right-pane-layout.scroll-shell.test.tsx` 的 characterization，锁定完整 main viewport、`right-pane-*` test id、scrollbar gutter、overlay footer、动态 bottom safe area、浮动入口和标题栏目标字体，同时删除由布局组件直接决定追底的测试；保留 `useChatViewportController` 对跟随底部与用户回看语义的既有测试
  来源：`FN-10.35` + 系统质量属性“可维护性、可测试性” + `适用页面保持单一纵向滚动边界` + `会话滚动语义保持不变`；stable `FN-1.22` / `消息正文在宽窄视口保持可读`；design `FN-10.35 / 修改方案 / 3. 将 RightPaneLayout 收敛为会话专用适配器`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/right-pane-layout.scroll-shell.test.tsx`；迁移前预期既有 characterization 通过且新 Header 断言失败，迁移后预期全部通过

- [x] 1.5 保持 `RightPaneLayout` 的会话专用根、main、viewport 与 overlay DOM，不嵌套完整 `PageLayout`；通过 `actions` 复用 `PageHeader`，通过 `PageContentFrame` 统一消息列、浮动入口和 composer surface；只测量 footer 高度并投影 bottom safe area，删除布局层物理底部判断和绝对 `scrollTop` 写入，同时保持 `useChatViewportController` 及其 viewport bindings、overlay composer、浮动入口、scrollbar gutter、免责声明和 `headerSlot` 的现有 owner 与可观察结果
  来源：`FN-10.35` + `页面 Header 保持一致且在窄视口可用` + `首批页面不展示返回操作`；`页面 Content 支持 contained 与 fluid 宽度` + `默认使用 contained 模式`；系统质量属性“可维护性、可测试性” + `适用页面保持单一纵向滚动边界` + `会话滚动语义保持不变`；stable `FN-1.22` / `消息正文在宽窄视口保持可读`；design `FN-10.35 / 修改方案 / 3. 将 RightPaneLayout 收敛为会话专用适配器`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/right-pane-layout.scroll-shell.test.tsx tests/chat-page.route-state.test.tsx`；预期全部通过，并确认不存在第二个会话纵向滚动容器

- [x] 1.6 在 `CronTaskDashboardPage.test.tsx` 增加统一 Header、`contained` Content、“手动创建”和 primary 风格“通过会话创建”两个直接按钮以及唯一 Content scrollbar 的目标行为测试，并删除同时兼容按钮或菜单的宽松断言
  来源：`FN-10.35` + `页面 Header 保持一致且在窄视口可用` + `标准宽度展示标题和操作`、`首批页面不展示返回操作`、`窄视口保持单行 Header`；`页面 Content 支持 contained 与 fluid 宽度` + `默认使用 contained 模式`；系统质量属性“可维护性、可测试性” + `适用页面保持单一纵向滚动边界` + `定时任务只滚动 Content`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/CronTaskDashboardPage.test.tsx`；实现前预期新增目标断言失败，实现后预期全部通过

- [x] 1.7 将 `CronTaskDashboardPage` 保持为 `PageLayout` 的 `contained + layout` 消费者，由页面通过 `actions` 原样提供“手动创建”和 primary 风格“通过会话创建”两个直接按钮，并删除共享布局 action descriptor 与自动菜单接入；Cron API、tabs、表单、卡片和执行记录行为保持不变
  来源：`FN-10.35` + `Agent Web 页面使用统一三段式布局` + `无 Footer 页面使用完整剩余高度`；`页面 Header 保持一致且在窄视口可用` + `窄视口保持单行 Header`；系统质量属性“可维护性、可测试性” + `适用页面保持单一纵向滚动边界` + `定时任务只滚动 Content`；design `FN-10.35 / 修改方案 / 4. 迁移 Cron 与收藏页面`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/CronTaskDashboardPage.test.tsx tests/cronTaskService.test.ts`；预期全部通过，DOM 断言确认 Header 单行且只有 Content 可纵向滚动

- [x] 1.8 增加共享布局 negative tests，断言 Header 保持单行、actions 保持页面提供的结构、模板不生成页面操作菜单且通用模板不渲染 overlay Footer
  来源：`FN-10.35` + `页面 Header 保持一致且在窄视口可用` + `页面操作区域保持页面声明`、`窄视口保持单行 Header`；design `FN-10.35 / 修改方案 / 1. 新增共享布局原语与单一 PageLayout 页面模板`、`5. 失败与降级边界`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/page-layout.component.test.tsx`；预期 negative cases 均实际触发并断言模板不换行、不转换页面 actions 且不产生通用 overlay Footer

## 2. `FN-1.13 查看收藏列表`

- [x] 2.1 在 `favorite-turns-panel.test.tsx` 先增加统一 Header 不展示页内返回、`fluid` Content、无双 padding、全部收起无滚动和展开后唯一内容滚动的目标行为测试；保留既有过滤、分组、分页、展开和取消收藏测试作为回归基线
  来源：`FN-1.13` + `Local 与 Immersive 收藏内容视图` + `收藏页面使用统一 Header`、`收起页面不产生滚动条`、`展开会话后自动进入内容视口`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/favorite-turns-panel.test.tsx`；实现前预期既有回归断言通过且新增统一布局断言失败，实现后预期全部通过

- [x] 2.2 将 `FavoriteTurnsPanel` 保持为 `PageLayout` 的 `fluid + content` 消费者，不声明 `backAction`，删除 `onBack` 页面契约、宿主传参和无用返回文案，同时保持 `.favorite-turns-scroll` 为唯一收藏滚动 owner
  来源：`FN-1.13` + `Local 与 Immersive 收藏内容视图` + `收藏页面使用统一 Header`、`收起页面不产生滚动条`；design `FN-1.13 查看收藏列表 / 修改方案`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/favorite-turns-panel.test.tsx`；预期全部通过，且测试确认收藏页面根与 `.favorite-turns-scroll` 不同时纵向滚动

- [x] 2.3 验证 Local 与 Immersive 仍可通过宿主导航离开收藏，Collaborative/PIU 仍可通过扩展容器关闭入口离开收藏，并且 URL、左侧扩展内容容器、会话切换和收藏业务状态不发生额外变化
  来源：`FN-1.13` + `Local 与 Immersive 收藏内容视图` + `LEFT 布局在主内容展示收藏且保留最近会话`、`RIGHT 布局展示相同收藏分组`、`PIU 更多菜单在左侧扩展内容容器展示收藏`；`FN-10.35` + 系统质量属性“可测试性” + `统一布局在三个宿主中保持一致` + `收藏在三个宿主中保持同形`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/local-favorites-navigation.test.tsx tests/immersive-routing.test.tsx tests/piu-runtime-contract.test.tsx tests/favorite-turns-panel.test.tsx`；预期全部通过且未产生收藏专用新 URL、覆盖弹框或第二扩展容器

## 3. 跨 Function 集成与迁移

- [x] 3.1 更新 Local、Immersive 和 Collaborative/PIU 的布局集成测试，证明宿主继续直接复用同一收藏与 Cron 页面组件，收藏组件不再接收宿主返回回调，且没有新增宿主 wrapper、重复 Header 或第二滚动容器
  来源：`FN-10.35`、`FN-1.13` + design `跨 Function 协作与端到端流程`、`跨 Function 质量属性设计`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/local-favorites-navigation.test.tsx tests/immersive-routing.test.tsx tests/piu-runtime-contract.test.tsx tests/CronTaskDashboardPage.test.tsx`；预期全部通过并断言每个页面只有一个 Header 和声明的滚动区域

- [x] 3.2 在既有 `tests/e2e` 页面布局浏览器旅程中真实验证会话、Cron、收藏的 `48px` Header、`16px/500/28px` 标题、收藏无页内返回、无 Header 阴影或独立背景渐变、`contained|fluid` 宽度、Cron 两个直接按钮和 scrollbar 位置；同时验证跟随底部时 composer 增高继续追底、用户回看时 composer 增高不抢夺位置以及显式返回底部
  来源：`FN-10.35`、`FN-1.13` + design `验证策略`；`FN-10.35` + 系统质量属性“可维护性、可测试性” + `适用页面保持单一纵向滚动边界`、`统一布局在三个宿主中保持一致`
  验证：在 `frontend/agent-web` 运行 `npx playwright test tests/e2e/page-layout.spec.cjs --config=playwright.config.cjs`；预期真实浏览器旅程全部通过并生成可重复的 DOM/截图证据

## 4. Change 整体验证

- [x] 4.1 完成前端相关 unit/component/integration gate，确认收藏页内返回移除及布局改动没有破坏会话、Cron、收藏或宿主行为
  来源：proposal `影响范围` + design `验证策略`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/page-layout.component.test.tsx tests/right-pane-layout.scroll-shell.test.tsx tests/chat-page.route-state.test.tsx tests/CronTaskDashboardPage.test.tsx tests/cronTaskService.test.ts tests/favorite-turns-panel.test.tsx tests/local-favorites-navigation.test.tsx tests/immersive-routing.test.tsx tests/piu-runtime-contract.test.tsx`；预期全部通过

- [x] 4.2 完成前端类型构建和三种宿主产物构建，确认收藏组件契约收敛后没有新增依赖、私有路径 import 或宿主模式编译差异
  来源：proposal `影响范围` + design `FN-10.35 / 目标与规范依据`、`跨 Function 协作与端到端流程`
  验证：在 `frontend/agent-web` 依次运行 `npm run build`、`npm run build:vite:modes`；预期命令退出码均为 0

- [x] 4.3 完成 OpenSpec、架构和语义检视门禁，确认新 `FN-10.35` 与 `agent-web-page-layout` 保持 1:1、`FN-1.13` delta 完整、没有新增目录层级，收藏宿主导航、页面 actions 与会话追底 owner 边界符合 stable specs 和 design
  来源：proposal `Function 影响（OpenSpec Capabilities）` + design `长期基线刷新计划`、`验证策略`
  验证：在仓库根目录运行 `openspec validate --all --strict`、`npm run lint:architecture`，并执行 `$nextagent-code-review`；预期 strict validation 和 architecture lint 通过，模型语义检视结论为 PASS 或无 P0/P1 的 PASS WITH FOLLOW-UP

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”新增 `agent-web-page-layout` stable spec 与 `FN-10.35` Function，刷新 `favorite-turn-list`、`FN-1.13`、`F-1.4`、`F-1.7`、`F-10.9`、overview、host-mode architecture、agent-web module 和 spec-to-design-map，并清理 `agent-web-high-frequency-questions` 对 `RightPaneLayout maxWidth 1080` 的白盒引用；检查长期文档没有重复定义 Header 数值、滚动 owner、API、状态或组件私有接口。
