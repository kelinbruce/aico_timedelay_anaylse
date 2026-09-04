## 审查结果

- Change：`fix-agent-web-favorite-panel-navigation`
- 日期：2026-08-01
- 状态：PASS

## Findings

无阻断问题。收藏列表保持为浏览器投影和路由级 view state，不拥有会话、标注或历史记录的服务端事实。

2026-08-01 收藏专用布局增量复审无新增问题。返回目标由 shell 既有最近对话 ref 提供；过滤只处理现有 `FavoriteTurnEntry` 并在最多 100 条收藏容量内补齐分页；展开正文复用既有锚点会话读取；取消收藏继续复用 annotation 写入与 `AuthGate`。proposal、spec、design 和 tasks 指向同一前端最小增量路径。

## 需群内确认

None。该 change 不修改 `agent-contracts`。

## 约束对齐

| 约束来源 | 结果 | 备注 |
|---|---|---|
| architecture | PASS | local 与 immersive 复用同一收藏面板、会话 store 和 Chat workspace。 |
| core contracts | PASS | 未新增或修改后端、stream、gateway 或 persistence contract。 |
| roadmap owner boundaries | PASS | 修改仅位于 `frontend/agent-web` 浏览器投影和对应 OpenSpec。 |
| current code | PASS | 保留 `main` 的历史会话搜索，仅迁移收藏入口和主内容投影。 |
| engineering principles | PASS | 收藏选择使用单一路由状态，不建立平行菜单状态。 |

## OpenSpec 完整性

| 必需项 | 结果 | 备注 |
|---|---|---|
| Function-spec 映射 | PASS | 仍由 `FN-1.13` 与 `favorite-turn-list` 唯一承载，不新增 Function 或 spec。 |
| Function 变更汇总 | PASS | 描述、处理过程和结果已覆盖返回、过滤、正文与确认取消目标。 |
| Requirement 元数据 | PASS | 继续使用既有功能性 Requirement，不新增平行质量 Requirement。 |
| 存量代码基线 | PASS | design 识别现有共享 panel、router ref、annotation service 与 session service。 |
| 唯一实施路径 | PASS | shell 提供返回回调，panel 私有过滤和正文读取，公共 contract 不变。 |
| 失败和降级 | PASS | 收藏读取、正文读取和取消收藏失败均有安全反馈及重试或保留结果。 |
| 验收示例 | PASS | 覆盖 session/new-session 返回、过滤、正文、确认取消和主题。 |

## 语言严谨性

- BCP 14 关键词仅用于 spec Requirement。
- `sessionId`、`rootMessageId`、`favoritedAt` 和 `MM-DD HH:mm` 跨 artifact 一致。
- spec 保持黑盒结果，`sessionService`、私有状态和 CSS 文件落在 design。

## Roadmap 规则覆盖

- 状态：PASS。
- 主要 owner 仍为 `frontend/agent-web`，不改变 frozen core contract、runtime lifecycle、owner scope 或 agent scope。
- 方案符合 KISS/SOLID：复用现有 favorite/conversation contract，不新增 API、store、DTO 或持久化键。

## 验证

- 收藏专用布局增量 `openspec validate fix-agent-web-favorite-panel-navigation --strict`：PASS
- 两个相关 change strict validation：PASS
- `frontend/agent-web` multi-host build：PASS
- 收藏、路由、Sidebar 和 store：162 tests PASS
- architecture：259 tests PASS
- `git diff --check`：PASS

`chat-page.route-state.test.tsx` 的 3 个非收藏用例失败已在纯 `origin/main` 工作树以相同方式复现，作为基线问题记录。

## 2026-08-03 Collaborative/PIU 弹框增量复审

- 状态：PASS
- Findings：无 BLOCKER/HIGH/MEDIUM/LOW 遗留。
- 需群内确认：None；不修改 `agent-contracts`、公共 DTO、API、stream、gateway、owner scope 或 agent scope。
- Function/spec：仍由 `FN-1.13 查看收藏列表` 与主规格 `favorite-turn-list` 1:1 承载；PIU 是同一收藏黑盒能力的新宿主投影，不新增 Function、spec 或 Feature delta。
- 唯一实现路径：Local/Immersive 继续使用 `#/favorites` 主内容；PIU 只把最新主线已有“更多 → 收藏”意图接到卡片内临时弹框，弹框组合共享 `FavoriteTurnsPanel`，关闭后恢复原会话，不建立平行查询状态或路由 authority。
- 黑盒/白盒边界：spec 只定义入口、可见弹框、宽度上界、session/URL 不变和关闭结果；`PiuContent` 私有开关、inline Modal containing block 与 CSS 约束只在 design 中定义。
- 当前代码一致性：最新 `origin/main` 的 `MoreMenuButton.onFavoritesClick` 为空，现有 `FavoriteTurnsPanel` 已拥有过滤、分组、正文、取消收藏、反馈与分页；最小增量无需修改 service 或 store contract。
- 工程原则：PASS；复用单一面板与主题变量，未复制 PIU 收藏列表实现，符合 KISS、SOLID 和 agent-web 浏览器 owner 边界。
- 验证：`openspec validate fix-agent-web-favorite-panel-navigation --strict` PASS；PIU 回归已先确认 1 个目标失败，再接线后通过 33 tests；frontend TypeScript build PASS。最终多宿主构建、真实几何和 code review 证据在 task 4.7 完成后补录。

## 2026-08-03 收藏真实接口过滤增量复审

- 状态：PASS
- Findings：无 BLOCKER/HIGH/MEDIUM/LOW 遗留。
- 需群内确认：None；不修改 `agent-contracts`、runtime/gateway port、持久化 schema、响应 DTO、Owner Scope 或 Agent Scope。
- Function/spec：仍由 `FN-1.13 查看收藏列表` 与 `favorite-turn-list` 唯一承载；`keyword`、`favoritedFrom`、`favoritedTo` 是既有收藏读取 Function 的可选 Web 查询边界，不新增 Function、Feature 或平行 spec。
- 唯一实施路径：浏览器提交过滤条件并从 offset 0 读取；`agent-channel-web` 在既有可信 identity/active Agent 下读取每 scope 已受 100 条硬上限约束的收藏窗口，先过滤再应用请求分页；无条件查询保留原 runtime offset/limit 快速路径。

## 2026-08-03 Collaborative 左侧容器与日期快捷清除增量复审

- 状态：PASS。
- Findings：无 BLOCKER/HIGH/MEDIUM/LOW 遗留。
- 需群内确认：None；不修改 `agent-contracts`、公共 DTO、stream、gateway、persistence、Owner Scope 或 Agent Scope。
- Function/spec：继续由 `FN-1.13 查看收藏列表` 与 `favorite-turn-list` 1:1 承载；Collaborative 只是同一收藏 Function 的宿主投影调整，日期快捷清除只改变既有过滤条件的移除操作，不新增 Function、Feature 或 spec。
- 架构与核心契约：PASS；收藏、记忆管理、投诉历史和定时任务统一消费 `frontend/agent-web` 已有 `expandPanelStore` 单一 view，后选择入口覆盖前一个 view；没有新增 PIU route、navigation authority、查询 store 或服务端事实 owner。
- 当前代码与唯一实施路径：PASS；删除 `PiuContent` 收藏专用布尔状态、内联 `Modal` 和专用 CSS，更多菜单直接组合共享 `FavoriteTurnsPanel` 到既有左侧扩展容器；日期条件由稳定的过滤组件提供两个独立清除按钮，清除后继续由现有 effect 以剩余参数重新调用真实收藏接口。
- 工程原则：PASS；复用既有扩展容器和共享收藏组件，改动是单一前端 owner 的最小增量，没有平行状态、重复列表或未来扩展点。
- 验证：target/all OpenSpec strict（259 items）、PIU 33 tests、收藏面板 17 tests、frontend TypeScript build、多宿主 Vite build、`git diff --check` 和真实 5173 Collaborative 浏览器旅程均通过；真实页面确认左侧扩展容器与 PIU 卡片并排、无收藏弹框、日期清除无点击穿透。
- 边界：Web route 不直连 gateway，不接收客户端 owner/agent 字段；关键词只匹配 safe 收藏摘要字段，时间为非负毫秒整数并拒绝反向区间；响应 shape、排序事实和取消收藏写入均不变。
- KISS/SOLID：复用既有 runtime annotation port 和 `FavoriteTurnPage`，删除浏览器本地过滤及为过滤主动拉满所有分页的逻辑，不新增 store、cache、DTO 或持久化键。
- 验证：target OpenSpec strict PASS；Web route 14 tests、agent-web annotation API 与收藏面板 26 tests、frontend TypeScript build PASS；真实 3000 接口以 99 条收藏验证组合条件返回 1 条，真实 5173 页面搜索指定会话后只显示接口返回的 6 条收藏。

## 2026-08-03 满宽显式分页与 Markdown 增量复审

- 状态：PASS。
- Findings：无 BLOCKER/HIGH/MEDIUM/LOW 遗留。
- 需群内确认：None；不修改 `agent-contracts`、公共 DTO、stream、gateway、persistence、Owner Scope 或 Agent Scope。
- Function/spec：继续由 `FN-1.13 查看收藏列表` 与 `favorite-turn-list` 1:1 承载；满宽、显式分页、收起无滚动和智能体 Markdown 都是同一收藏回顾 Function 的浏览器投影，不新增 Feature、Function 或平行 spec。
- 架构与核心契约：PASS；实现只修改共享 `FavoriteTurnsPanel`、收藏 CSS、既有 ExpandPanel 布局回归与 active change。Local、Immersive、Collaborative 继续组合同一组件，未引入宿主专用查询状态、URL 或导航 authority。
- 唯一实施路径：PASS；面板以既有收藏硬上限 100 做一次有界接口读取，过滤条件仍交给真实 `GET /api/v1/favorites` 服务端处理；浏览器只在完整结果上按 `sessionId` 分组并每页切 10 组。旧 `IntersectionObserver`、sentinel、追加 loading、offset guard 和定时器已删除。
- 布局与 Markdown：PASS；过滤区、列表和卡片移除 `max-width` 并占满 16px padding 内宽度；全收起时使用 10 轨自适应网格和 `overflow: hidden`，展开时切换 `overflow-y: auto`；ASSISTANT/SUMMARY 复用实际对话卡片的 `MarkdownContent`，USER 保持纯文本。
- KISS/SOLID：PASS；没有为展示分页新增聚合 API、store、cache、DTO 或持久化键，复用 Ant Design `Pagination` 和现有 Markdown 安全清理链路。
- 验证：生产代码修改前新增 2 条失败回归；实现后收藏面板 15 tests、PIU/Local/Immersive/annotation 定向合计 85 tests、ExpandPanel 6 tests、frontend TypeScript build、多宿主 Vite build、target/all OpenSpec strict（259 items）、显式分页 Playwright 和 `git diff --check` 均通过。真实 5173 Collaborative 页面确认面板宽 326.4px、左右 padding 16px、内容/卡片宽 294.4px、第一页 10 组、第二页 6 组；收起时 `scrollHeight = clientHeight = 642px` 且 `overflow-y: hidden`，展开时 `overflow-y: auto` 并生成共享 Markdown 段落 DOM。
- 全量前端套件：仍存在本增量未触达的记忆管理 CSS 与消息附件权限等失败；前序 ExpandPanel 的 2 条旧布局断言已在本次同步并单独通过，未扩大修改到其他无关失败。

## 2026-08-03 15 条分页与紧凑自然高度增量复审

- 状态：PASS。
- Findings：无 BLOCKER/HIGH/MEDIUM/LOW 遗留。
- 需群内确认：None；不修改 `agent-contracts`、公共 DTO、API、stream、gateway、persistence、Owner Scope 或 Agent Scope。
- Function/spec：继续由 `FN-1.13 查看收藏列表` 与 `favorite-turn-list` 1:1 承载；15 条分页、紧凑卡片和智能体回答自然高度都是同一收藏回顾 Function 的浏览器投影，不新增 Feature、Function 或平行 spec。
- 架构与多宿主：PASS；Local、Immersive 与 Collaborative/PIU 继续复用单一 `FavoriteTurnsPanel`，只调整共享分页常量和共享 CSS，没有新增宿主专用状态、查询、路由或导航 authority。
- 唯一实施路径：PASS；完整有界收藏窗口仍先按 `sessionId` 分组再分页，只把页大小从 10 调整为 15；收起态使用固定 15 轨与 2px gap，展开态使用自然流、4px 分组 gap 和 8px/12px 问答内边距。
- 自然高度：PASS；ASSISTANT/SUMMARY 继续复用共享 `MarkdownContent`，智能体消息与正文显式使用 `height: auto`、`min-height: 0`，未继承摘要卡 56px 约束；浏览器以长短 Markdown 回答验证实际高度不同。
- KISS/SOLID：PASS；没有新增 API、store、cache、DTO、配置项或持久化键，测试断言用户可见分页、滚动和几何结果。
- 验证：生产代码修改前新增分页回归按预期失败；实现后收藏面板 15 tests、收藏定向 Playwright 2 tests、frontend TypeScript build、target/all OpenSpec strict（259 items）与 `git diff --check` 均通过。全量 smoke 中另有 4 个未触达既有失败，收藏显式分页用例已通过，旧 56px 精确断言已按“最大 56px”规格收敛后定向通过。

## 2026-08-03 8px 会话卡片间距与单行 Markdown 空白增量复审

- change id：`fix-agent-web-favorite-panel-navigation`。
- 状态：PASS。
- Findings：无 BLOCKER/HIGH/MEDIUM/LOW 遗留。
- 需群内确认：None；不修改 `agent-contracts`、公共 DTO、API、stream、gateway、persistence、Owner Scope 或 Agent Scope。
- Function/spec：继续由 `FN-1.13 查看收藏列表` 与 `favorite-turn-list` 1:1 承载；8px 会话卡片间距和单行 Markdown 无额外空白都是同一收藏回顾 Function 的可见布局结果，不新增 Feature、Function 或平行 spec。
- 黑盒/白盒边界：PASS；spec 定义 8px 可见间距、Markdown 自然高度和单行无额外空白；design 定义收藏面板局部 `white-space`、首尾 margin 与高度覆盖，没有把 CSS 实现写入 Function 契约。
- 架构与多宿主：PASS；只修改共享 `FavoriteTurnsPanel.css` 与同一收藏浏览器旅程，Local、Immersive、Collaborative/PIU 自动获得一致结果，未产生宿主专用实现或状态。
- 当前代码与根因：PASS；共享 Markdown 本身没有 56px 最小高度，额外空白来自收藏正文按钮的 `white-space: pre-wrap` 渲染 Markdown HTML 末尾换行。局部将 `.markdown-content` 恢复为 `white-space: normal`，保留用户纯文本问题的换行语义。
- 第一性原理/KISS/SOLID：PASS；未修改全局 `MarkdownContent`，没有新增 prop、配置或重复渲染器，最小局部样式即可闭合可见问题。
- 验证：旧实现浏览器回归明确失败于 2px gap；实现后收藏 Playwright 2 tests、收藏面板 15 tests、frontend TypeScript build、target/all OpenSpec strict（259 items）及 `git diff --check` 通过。浏览器测得 gap 8px、Markdown `min-height: 0px`、首尾 margin 0px，单行根节点高度与 21px 行高一致。

## 2026-08-03 展开会话自动进入视口增量复审

- change id：`fix-agent-web-favorite-panel-navigation`。
- 状态：PASS。
- Findings：无 BLOCKER/HIGH/MEDIUM/LOW 遗留。
- 需群内确认：None；不修改 `agent-contracts`、公共 DTO、API、stream、gateway、persistence、Owner Scope 或 Agent Scope。
- Function/spec：继续由 `FN-1.13 查看收藏列表` 与 `favorite-turn-list` 1:1 承载；展开后自动进入内容视口是既有会话分组展开行为的可见结果，不新增 Feature、Function 或平行 spec。
- 行为闭合：PASS；优先目标是会话卡片顶部与内容视口顶部对齐，底部可滚动空间不足时降级条件和结果明确为卡片及正文起始位置可见；收起操作不自动滚动，其他会话状态和收藏事实不变。
- 黑盒/白盒边界：PASS；spec 只定义视口可见结果及边界降级，design 唯一承载 DOM ref、animation frame 和 `scrollIntoView` 实现细节。
- 架构与多宿主：PASS；逻辑位于共享 `FavoriteTurnsPanel`，Local、Immersive、Collaborative/PIU 复用同一路径，不新增宿主专用滚动状态、导航 authority 或持久化事实。
- 第一性原理/KISS/SOLID：PASS；使用会话卡片私有 ref 和一次浏览器原生滚动，不增加全局 store、公共 prop、定时器或布局占位。
- 验证：旧实现中第 15 张会话展开后相对内容视口顶部偏移 896px，10 秒内未进入视口；实现后第 8 张卡片顶部对齐偏差不超过 2px，第 15 张受底部边界限制时卡片和正文起始位置均可见。收藏 Playwright 2 tests、收藏面板 15 tests、frontend TypeScript build、target/all OpenSpec strict（259 items）与 `git diff --check` 均通过。

## 2026-08-03 推送前最终复审

- 状态：PASS WITH FOLLOW-UP。
- Findings：P0/P1 无；P2 为未触达的主线全量门禁债务，包含 contract 3 条、frontend Vitest 6 条及 Playwright 5 条既有失败，失败文件与本 change 无差异，收藏定向验证全部通过。
- Spec review：PASS；`FN-1.13 查看收藏列表` 与 `favorite-turn-list` 保持 1:1，关键词和日期过滤是既有收藏读取 Function 的可选 Web query 增量，不新增 Feature、Function、平行 spec 或 persistence owner。
- 架构与安全：PASS；Local、Immersive LEFT/RIGHT 与 Collaborative/PIU 复用单一 `FavoriteTurnsPanel`，浏览器只拥有投影和 view state；服务端仍从可信 auth/active Agent 获取 Owner/Agent Scope，未修改 frozen core contract、响应 DTO、gateway、persistence 或 minimal kernel。
- 范围：PASS；两条 memory import/export 分支均不是当前分支祖先，最终 diff 不包含导入导出实现；长期记忆 change 的改动仅用于共享 Shell 中既有 `#/memory` 路由互斥协作。
- 验证：合并最新 `origin/main` 后，根 `npm run build`、根 `npm test`（139 files / 1455 tests）、architecture（45 files / 279 tests）、后端收藏 route（14 tests）、frontend build、多宿主 Vite build、收藏面板（15 tests）、相关宿主定向测试、target/all OpenSpec strict（259 items）与 `git diff --check` 通过；全量 Playwright 中 5 条收藏旅程全部通过。
