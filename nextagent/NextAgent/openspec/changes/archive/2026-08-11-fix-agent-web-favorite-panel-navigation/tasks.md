## 0. 规格与实施前门禁

- [x] 0.1 对 proposal、delta specs、design 和 tasks 执行 `$nextagent-skill-review`，确认 legacy Requirement 原子拆分、Function 归属、唯一实现路径和当前代码基线均可继续实施
  来源：design“存量 Requirement 迁移方案”、proposal“Function 影响（OpenSpec Capabilities）”
  验证：2026-07-29 初审与增加列表内取消收藏后的复审均为 PASS；2026-07-30 session 分组优化复审修正 delta spec 中一处非目标态迁移措辞后为 PASS，`需群内确认` 为 None，BLOCKER/HIGH/MEDIUM 均为 0；`openspec validate --all --strict` 为 261 passed、0 failed
  补充复审：2026-07-30 对取消收藏成功反馈和紧凑布局增量再次执行 `$nextagent-skill-review`，需求触发、成功/失败结果、共享 panel owner、现有 annotation service 调用链和可执行验收保持唯一一致，结论 PASS；`需群内确认` 为 None，未修改 `agent-contracts`、公共 API、持久化或可信 scope

- [x] 0.2 对收藏专用布局、返回、过滤、展开正文、确认取消和主题增量执行 `$nextagent-skill-review`，确认行为闭合、前端 owner、既有 conversation/favorite contract 复用和唯一实施路径
  来源：proposal“目标与非目标”；design“FN-1.13 查看收藏列表 / 修改方案”
  验证：2026-08-01 `openspec validate fix-agent-web-favorite-panel-navigation --strict` 通过；按 `.agents/skills/nextagent-skill-review/SKILL.md` 对 proposal、spec、design、tasks、roadmap、architecture、core contracts、Function/Feature 基线和当前代码复审，结论 PASS；返回、过滤、正文读取、确认取消和主题均由 `FN-1.13` 唯一承载，主要 owner 为 `frontend/agent-web`，不修改公共 API、`agent-contracts`、后端、PIU、scope 或持久化；`需群内确认` 为 None

## 1. `FN-1.12 标注对话`

- [x] 1.1 完成 `Frontend annotation interaction behavior` 的原子迁移：来源 `conversation-annotation` 为 `REMOVED`，目标 `conversation-annotation-controls` 为 `ADDED`，完整保留标注控件、状态恢复、失败回滚和非终态隐藏行为；来源中未触及 Requirements 原位保留
  来源：`FN-1.12 标注对话` + `前端对话标注控制` + “点赞与点踩互斥切换”“收藏与评价独立”“重新打开会话恢复标注”“标注写入失败回滚”“非终态回复不提供标注”；design“存量 Requirement 迁移方案”
  验证：2026-07-29 `openspec validate fix-agent-web-favorite-panel-navigation --strict` 返回 valid；`rg` 确认 active changes 中只有本 change 触及该 Requirement，来源其他 Requirements 未进入 delta

- [x] 1.2 在收藏导航修改前建立标注控件非回归基线，并在实现后复跑同一组测试
  来源：`FN-1.12 标注对话` + `前端对话标注控制` 全部 Scenarios
  验证：修改前上述 3 files / 21 tests 全部通过；实现后与收藏面板测试合并复跑，4 files / 25 tests 全部通过，其中同一标注测试仍为 3 files / 21 tests

## 2. `FN-1.13 查看收藏列表`

- [x] 2.1 先补充可观察行为测试，覆盖 LEFT 收藏进入主内容且保留最近会话、RIGHT 使用相同收藏 panel、无冲突 active 入口、重复选择幂等、临时交互不改变收藏内容、选择会话返回对话；在生产代码修改前运行并确认至少一个目标断言失败
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图` + “LEFT 布局在主内容展示收藏且保留最近会话”“RIGHT 布局展示相同收藏分组”；`主内容入口选择互不耦合` + “主内容入口没有冲突激活结果”“重复选择当前收藏入口”“临时交互不改变收藏内容”“选择会话返回对话”
  验证：生产代码修改前运行 `npm test -- tests/favorite-sidebar.test.tsx tests/immersive-routing.test.tsx`，5 个目标断言失败：Sidebar 收藏选择回调/受控激活 3 项、Immersive LEFT 主内容收藏 1 项、RIGHT 重复选择幂等 1 项；实现后目标集随 6 files / 65 tests 全部通过

- [x] 2.2 新增共享 `FavoriteTurnsPanel`，收敛首屏读取、分页、空态、失败重试、当前窗口刷新和收藏卡片选择回调；Local 与 Immersive 不再各自维护平行收藏查询状态
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图` + “收藏空态”“收藏读取失败可重试”“当前收藏窗口响应收藏状态变更”；design“FN-1.13 查看收藏列表 / 修改方案 / 共享 FavoriteTurnsPanel”
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/favorite-turns-panel.test.tsx`，1 file / 4 tests 全部通过，覆盖首屏选择、空态、失败安全反馈与重试、分页及事件刷新

- [x] 2.3 将 `Sidebar` 改为受控收藏入口，删除 `showFavorites`、收藏读取/分页状态和收藏列表分支；点击收藏只发送选择意图，最近会话列表始终保留，搜索、设置和帮助不触发主内容选择
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图` + “LEFT 布局在主内容展示收藏且保留最近会话”；`主内容入口选择互不耦合` + “临时交互不改变收藏内容”；design“FN-1.13 查看收藏列表 / 修改方案 / shell 统一拥有当前主内容选择”
  验证：上述 3 个目标文件随相关测试命令共 45 tests 全部通过；收藏入口回调、最近会话保留、搜索临时交互、独立内容选择和投诉入口非回归均有断言

- [x] 2.4 为 Local shell 增加 `conversation | favorites` 当前主内容选择，在主内容区域渲染共享收藏 panel，并在新会话、session、收藏卡片或 route location 变化时返回对话
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图` + “LEFT 布局在主内容展示收藏且保留最近会话”“选择收藏 turn 恢复目标对话”；`主内容入口选择互不耦合` + “选择会话返回对话”；design“FN-1.13 查看收藏列表 / 修改方案 / shell 统一拥有当前主内容选择”
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/local-favorites-navigation.test.tsx`，1 file / 5 tests 全部通过；该阶段先验证收藏位于主内容、帮助不切换，以及新会话/session/location/收藏 turn 均返回对话；最终收藏专用 URL 行为由 2.16-2.17 验收

- [x] 2.5 扩展 Immersive LEFT 当前主内容选择并收敛 RIGHT 收藏路径：LEFT 渲染共享收藏 panel且保留 Sidebar；RIGHT 删除私有 favorites query/effect并复用同一 panel；所有主内容入口选择幂等且不产生冲突 active 反馈
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图` + “LEFT 布局在主内容展示收藏且保留最近会话”“RIGHT 布局展示相同收藏分组”“选择收藏 turn 恢复目标对话”；`主内容入口选择互不耦合` + “主内容入口没有冲突激活结果”“重复选择当前收藏入口”“选择会话返回对话”；design“FN-1.13 查看收藏列表 / 修改方案 / shell 统一拥有当前主内容选择”
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/immersive-routing.test.tsx`，1 file / 13 tests 全部通过；覆盖 LEFT/RIGHT 收藏 surface、重复选择、memory/complaint/history 互斥和收藏 turn 导航

- [x] 2.6 为 Collaborative/PIU 增加禁止项验证，确认没有新增收藏入口、收藏视图、收藏查询 state 或 favorites service 调用
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图` 中 Collaborative/PIU 禁止行为；design“FN-1.13 查看收藏列表 / GAP 分析”
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/piu-runtime-contract.test.tsx`，1 file / 30 tests 全部通过；`rg -n "FavoriteTurnsPanel|listFavoriteTurns|favoritesActive" src/piu` 无匹配（退出码 1）

- [x] 2.7 补充收藏 turn 精确定位回归：从收藏项进入会话时以 `rootMessageId` 和公共 contract 允许的 `limit=50` 加载锚点窗口并定位目标 turn，不得因非法窗口上限加载失败，也不得先加载最新窗口后停留在会话末尾
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图` + “选择收藏 turn 恢复目标对话”
  验证：`tests/chat-page.route-state.test.tsx` 以锚点窗口、目标后续 turn、35 帧布局稳定和 URL 清理顺序断言最终滚动位置；`tests/e2e/app-smoke.spec.cjs` 使用 8 个长 turn 验证第 4 个收藏回合稳定停在视口顶部 24px，且最终距离会话底部大于 100px；两条目标 Playwright 旅程 2 passed

- [x] 2.8 将收藏列表内取消收藏能力迁移到共享 `FavoriteTurnsPanel`：成功时移除目标卡片且不打开会话，失败时保留卡片、显示安全反馈并允许重试；Local 与 Immersive 共用同一实现
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图` + “在收藏列表取消收藏”“取消收藏失败”
  验证：`npm test -- --run tests/favorite-turns-panel.test.tsx` 为 1 file / 8 tests passed，覆盖成功移除且不导航、失败保留且安全反馈并恢复按钮、旧的在途刷新不得重新投影已移除卡片，以及远端只读用户的取消按钮由 `AuthGate` 禁用；Playwright `removes a favorite card without opening its conversation` 通过，断言提交 `{ isFavorited: false }`、卡片消失、空态出现且 URL 不变

- [x] 2.9 先补充收藏会话分组的可观察行为测试：覆盖同 `sessionId` 只产生一个分组、同标题不同 session 不合并、分组和组内 turn 保持查询相对顺序、默认只显示前 3 条、展开/收起只影响目标分组、后续分页合入既有分组；在生产代码修改前运行并确认目标断言失败
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图` + “同一会话的收藏 turn 合并为一个展示分组”“会话标题相同但 session 不同”“默认收起并展开会话分组”“后续分页合入既有会话分组”
  验证：2026-07-30 在生产代码修改前运行 `npm test -- --run tests/favorite-turns-panel.test.tsx`，1 file / 11 tests 中新增 3 tests 按预期失败：同 session 仍产生 3 张 article、默认仍显示第 4 条、后续分页仍产生第 2 张同 session 卡片；既有 8 tests 继续通过

- [x] 2.10 在共享 `FavoriteTurnsPanel` 内完成唯一 session 分组投影：以 `sessionId` 派生外层分组，以 `sessionId + requestRunId` 保持组内 turn identity，显示当前已加载数量，默认展示前 3 条并使用 panel-local 展开状态；不得新增 service、store、公共 DTO、聚合 API 或浏览器持久化键
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图`；design“FN-1.13 查看收藏列表 / 会话分组投影”
  验证：2026-07-30 `npm test -- --run tests/favorite-turns-panel.test.tsx` 为 1 file / 11 tests passed；实现只在共享 `FavoriteTurnsPanel` 中从 `entries` 派生分组并维护 panel-local 展开 `Set`，新增中英文展示文案，`annotationService.listFavoriteTurns`、`FavoriteTurnEntry`、后端 contract 和浏览器存储均未修改

- [x] 2.11 保持组内单条交互与分页刷新语义：选择 turn 行仍精确定位其 `rootMessageId`；取消收藏只移除目标行并更新分组数量，最后一行移除后删除空分组；失败保留原行；下一页和收藏更新刷新不得产生同 session 的第二张分组卡片
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图` + “选择收藏 turn 恢复目标对话”“在收藏列表取消收藏”“取消会话分组中的最后一个收藏”“取消收藏失败”“当前收藏窗口响应收藏状态变更”
  验证：2026-07-30 `npm test -- --run tests/favorite-turns-panel.test.tsx tests/local-favorites-navigation.test.tsx tests/immersive-routing.test.tsx` 为 3 files / 30 tests passed，覆盖组内定位回调、成功/失败取消、数量递减、空组移除、分页与事件刷新合组及 Local/Immersive 复用；目标 Playwright 旅程 3 passed，覆盖空组移除不导航、同 session 默认 3 条与展开/收起、中间收藏稳定定位视口顶部 24px

- [x] 2.12 优化收藏会话分组的辅助文案：右上角数量使用自然且明确的“当前已加载 N 条收藏”，收起操作简化为“收起”，并同步中英文与可观察行为断言
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图` 中“当前已加载数量”和“收起操作”
  验证：2026-07-30 先将断言更新为目标文案，`npm test -- --run tests/favorite-turns-panel.test.tsx` 按预期为 5 failed / 8 passed；修改中英文 i18n 后 `npm test -- --run tests/favorite-turns-panel.test.tsx src/i18n/index.test.ts` 为 2 files / 15 tests passed，目标 Playwright 分组旅程 1 passed，`npm run build`、`openspec validate fix-agent-web-favorite-panel-navigation --strict` 与 `git diff --check` 均通过；真实 5174 页面显示“当前已加载 6 条收藏”和“收起”，旧“收起收藏”不再出现

- [x] 2.13 使用当前 issue worktree 构建并启动本地后端产物，验证取消最后一个收藏时返回包含完整字段的空标注响应，不因运行旧分支产物或 response schema 不匹配返回 500；随后复验共享收藏面板取消路径
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图` 中“在收藏列表取消收藏”“取消收藏失败”
  验证：2026-07-30 确认 5174 前端原先代理到由旧工作树过期产物启动的 3000 后端，该产物在删除最后一项标注后遗漏 response schema 必填的 `isQuestionFavorited`，真实 POST 返回 500；在当前 issue worktree 运行 `npm run build`，替换本地验证后端后，同一无副作用诊断 POST 返回 200 和 `{ sentiment: null, isFavorited: false, isQuestionFavorited: false, comment: null }`。真实页面使用一条原本未收藏的 run 临时建立收藏后点击“取消收藏”，目标行消失、分组数量从 3 恢复为 2、无失败提示，后端查询确认临时收藏已清理；`vitest.config.channel-web.ts` 下 annotation route 为 1 file / 11 tests passed，前端 panel 为 1 file / 13 tests passed，target OpenSpec strict 与 `git diff --check` 通过

- [x] 2.14 为收藏列表内取消收藏成功补充明确反馈：写入成功且目标 turn 移除后显示“已取消收藏”，失败路径继续只显示安全失败反馈；Local 与 Immersive 复用同一实现
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图` 中“在收藏列表取消收藏”
  验证：2026-07-30 先增加成功反馈断言，生产代码修改前 `favorite-turns-panel.test.tsx` 为 1 failed / 12 passed，唯一失败为找不到“已取消收藏”；实现共享 panel 成功消息和中英文文案后，panel 与 i18n 为 2 files / 15 tests passed，目标 Playwright 取消旅程断言消息可见并通过。真实 5174 页面使用原本未收藏的 run 临时建立收藏后取消，DOM 与截图均确认“已取消收藏”可见、目标行移除，后端查询确认临时收藏已清理

- [x] 2.15 压缩收藏会话列表的纵向密度：减小相邻会话分组、卡片内边距和组内 turn 行间距，在保留标题、当前已加载数量、问题预览、时间与取消操作可读性的前提下减少空白
  来源：proposal“同一 session 的多个收藏 turn 收敛为更紧凑的展示分组”；design“会话分组投影”
  验证：2026-07-30 将会话分组间距从 12px 收敛为 8px，卡片内边距从 14px/16px 收敛为 10px/14px，组内 turn 行从 10px 收敛为 6px，并同步压缩操作间距、时间行距和取消按钮尺寸；目标 Playwright 以单 turn 分组高度不超过 102px、相邻分组间距不超过 9px 验收并与成功提示旅程合计 2 passed。真实 5174 页面截图确认标题、数量、问题、时间、取消和展开操作均保留且纵向空白明显减少；`npm run build` 与 `npm run build:vite:modes` 通过

- [x] 2.16 先补充收藏专用 URL 的可观察行为测试：覆盖 Local/Immersive 收藏导航到 `#/favorites`、直达、刷新、重复选择、浏览器前进后退和 session 导航恢复对话；在生产代码修改前运行并确认目标断言失败
  来源：`FN-1.13 查看收藏列表` + “LEFT 布局在主内容展示收藏且保留最近会话”“直达收藏 URL”；`主内容入口选择互不耦合` + “浏览器历史恢复收藏主内容”“选择会话返回对话”
  验证：2026-07-30 在生产代码修改前运行 `npm test -- --run tests/local-favorites-navigation.test.tsx tests/immersive-routing.test.tsx`，目标断言按预期失败：收藏入口仍停留 `#/`、直达 `#/favorites` 仍显示对话、浏览器历史不能恢复收藏。实现后同一组为 2 files / 23 tests passed。

- [x] 2.17 让 Local、Immersive LEFT 和 Immersive RIGHT 以共享 hash pathname 派生收藏主内容；收藏使用 `#/favorites`，Immersive 同时消费 `long-memory-web-management` 提供的 `#/memory` 并保持两个入口互斥，既有投诉/最近历史继续保持独立临时选择，且不得新增公共 API、共享 store 或浏览器持久化键
  来源：design“FN-1.13 查看收藏列表 / shell 统一拥有当前主内容选择”；proposal“目标与非目标”
  验证：2026-07-30 前端定向回归为 3 files / 36 tests passed；定向 Playwright `keeps favorites and memory management mutually exclusive` 为 1 passed，覆盖 `#/memory`、`#/favorites`、互斥 active、后退和刷新；`npm run build`、`npm run build:vite:modes`、两个 change strict validate、全量 OpenSpec strict validate（261 项）均通过。真实 5174 页面确认点击记忆管理进入 `#/memory` 且只显示记忆内容，再点击收藏进入 `#/favorites` 且只显示收藏内容。

- [x] 2.18 先补充收藏面板自动分页的可观察行为测试：覆盖接近列表底部自动加载、页面不再提供手动分页按钮、同一追加请求完成前重复可见性通知不产生重复请求，以及完成后仍可继续加载后续页面；在生产代码修改前运行并确认目标断言失败
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图` + “后续分页合入既有会话分组”“自动分页避免重复追加”
  验证：2026-07-30 在生产代码修改前运行 `npm test -- --run tests/favorite-turns-panel.test.tsx`，1 file / 14 tests 中 3 tests 按预期失败：旧实现仍渲染“查看更多收藏”按钮，且不会创建或观察自动分页 sentinel；其余 11 tests 继续通过

- [x] 2.19 在共享 `FavoriteTurnsPanel` 中以滚动容器末尾 sentinel 自动触发下一页，保留加载反馈并使用组件私有 in-flight guard 避免同 offset 重复请求；追加失败后停止自动触发并复用安全重试，不修改分页 API、session 分组、宿主路由或浏览器持久化
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图`；design“FN-1.13 查看收藏列表 / 共享 `FavoriteTurnsPanel`”
  验证：2026-07-30 目标命令为 3 files / 38 tests passed，覆盖自动分页、无手动按钮、同 offset 串行追加、追加失败停止观察并可重试、分页合组和多宿主复用；新增 Playwright 旅程以 45 条数据断言滚动后请求 offset 依次为 0/20/40，完整浏览器套件 28 passed。真实 5174 页面使用 100 条收藏验证已加载数量随滚动从 60 增至 80、100，末尾空页后 sentinel 消失，页面始终无“查看更多收藏”按钮

- [x] 2.20 先补充快速分页的可观察反馈测试：自动追加触发后必须出现底部旋转指示和“正在加载更多收藏”文案；即使请求立即返回，列表立即追加且加载条仍连续可见至少 300ms，结束后自动消失；在生产代码修改前运行并确认最短展示断言失败
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图` + “快速分页仍展示可感知加载状态”
  验证：2026-07-30 在生产代码修改前运行 `npm test -- --run tests/favorite-turns-panel.test.tsx`，1 file / 16 tests 中新增测试按预期失败：快速分页条目已追加，但页面已找不到“正在加载更多收藏”状态及旋转指示；其余 15 tests 继续通过

- [x] 2.21 在共享 `FavoriteTurnsPanel` 中增加底部旋转加载条和独立的分页反馈状态，使数据返回后立即追加、加载反馈至少持续 300ms，并在反馈结束后恢复 sentinel 观察；不得延迟首屏加载、修改分页 API 或引入宿主专用实现
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图`；design“FN-1.13 查看收藏列表 / 共享 `FavoriteTurnsPanel`”
  验证：2026-07-30 在 `frontend/agent-web` 运行 `npm test -- --run tests/favorite-turns-panel.test.tsx tests/local-favorites-navigation.test.tsx tests/immersive-routing.test.tsx` 为 3 files / 39 tests passed；快速响应测试确认条目立即追加、底部状态包含 Ant Design 旋转指示与“正在加载更多收藏”，并从触发开始持续不少于 300ms 后消失；既有串行分页和 Local/Immersive 复用断言继续通过

- [x] 2.22 先补充加载反馈位置和空闲布局的可观察回归：快速分页追加条目后，加载条仍位于收藏滚动区域当前可见范围；没有加载请求时，分页触发结构不占用可见高度；在生产代码修改前运行并确认目标断言失败
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图` + “快速分页仍展示可感知加载状态”“空闲分页触发结构不产生额外滚动”
  验证：2026-07-30 在生产代码修改前运行收藏自动滚动 Playwright，目标旅程按预期失败：空闲 `favorite-turns-pagination-sentinel` 的计算高度为 `32px` 而不是 `0px`，证明旧实现即使未显示 loading 仍占用列表布局；同一旅程同时增加数据追加后 loading 几何边界必须落在收藏滚动区域内的断言

- [x] 2.23 将自动分页 sentinel 与加载反馈拆分：sentinel 空闲时保持零布局高度，加载反馈使用共享面板内的 sticky feedback layer 固定在当前滚动区域可见底部；不得改变条目追加时机、分页 offset、最短反馈时间或宿主实现
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图`；design“FN-1.13 查看收藏列表 / 共享 `FavoriteTurnsPanel`”
  验证：2026-07-30 component Vitest 为 1 file / 16 tests passed，收藏自动滚动 Playwright 为 1 passed，确认空闲 sentinel 计算高度为 `0px`、加载反馈在条目从 20 增至 40 后仍位于面板可见边界内，并继续按 `0/20/40` 请求。真实 5174 页面使用 100 条收藏确认面板边界为 `0–720px` 时 loading 位于 `652–684px` 且包含旋转指示，反馈结束后消失，sentinel 继续保持 `0px`

- [x] 2.24 先补充收藏专用布局的可观察行为测试，覆盖 56px header、返回原 session/新会话、搜索与清除、日期时间过滤与重置、56px 收起卡片、展开问答正文、正文读取失败、确认/放弃取消和浅色/暗色结构一致；生产代码修改前确认目标断言失败
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图` + “返回进入收藏前的对话”“使用关键词和日期时间过滤收藏”“默认收起并展开会话正文”“展开正文读取失败”“在收藏列表取消收藏”“放弃取消收藏”“浅色与暗色主题保持一致布局”
  验证：2026-08-01 在生产代码修改前运行 3 个目标文件，新增的四个返回路径断言均停留在 `#/favorites` 并按预期失败；补齐面板黑盒用例后最终定向结果为 3 files / 43 tests passed

- [x] 2.25 为 Local、Immersive LEFT 和 Immersive RIGHT 向共享面板提供最近对话返回回调，确保从 session 返回原 session、从新会话或直达返回 `/`，不新增 router owner、共享 store 或浏览器持久化键
  来源：design“FN-1.13 查看收藏列表 / shell 统一拥有当前主内容选择”；`返回进入收藏前的对话`
  验证：2026-08-01 Local 与 Immersive 路由定向结果为 2 files / 27 tests passed，覆盖 Local、LEFT、RIGHT 从 session 和新会话进入后的返回地址

- [x] 2.26 重构共享 `FavoriteTurnsPanel` 为 header、filter、content 三层布局，实现关键词和 `favoritedAt` 闭区间过滤、过滤时补齐既有分页、56px 摘要卡及按锚点读取 USER/ASSISTANT/SUMMARY 正文，并保持加载/失败/自动分页语义
  来源：design“FN-1.13 查看收藏列表 / 共享 `FavoriteTurnsPanel`”“会话分组投影”“收藏专用布局与主题”；`使用关键词和日期时间过滤收藏`、`默认收起并展开会话正文`、`展开正文读取失败`
  验证：2026-08-01 面板定向结果为 1 file / 16 tests passed；收藏 Playwright 确认 56px 收起卡片、session 分组、完整问答正文、自动分页和锚点导航

- [x] 2.27 将取消收藏入口调整为用户问题右侧的 16px 已收藏图标和左上确认浮层，只有确认才复用既有 annotation 写入；取消确认不写入，成功/失败反馈及 `AuthGate` 保持不变
  来源：`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图` + “在收藏列表取消收藏”“放弃取消收藏”“取消收藏失败”
  验证：2026-08-01 component tests 覆盖确认、放弃、成功、失败和权限禁用；收藏 Playwright 验证放弃不写入、确认写入 `{ isFavorited: false }`、成功提示和 URL 不变

- [x] 2.28 新增收藏专用 CSS，全部配色引用主页共享主题变量，并在真实开发页面验证 header/card 几何、过滤控件、正文换行、确认浮层和浅色/暗色布局一致
  来源：design“FN-1.13 查看收藏列表 / 收藏专用布局与主题”；`浅色与暗色主题保持一致布局`
  验证：2026-08-01 `npm run build`、`npm run build:vite:modes` 和 app smoke 7 tests 全部通过；真实 5174 浅色/暗色页面确认 header 与收起卡片外框均为 56px、左右 padding 16px、header/filter gap 为 12px/8px，正文保留换行且 panel 外层无滚动

- [x] 2.29 先补充 Collaborative/PIU 可观察回归，覆盖“更多 → 收藏”打开共享收藏弹框、关闭后恢复原会话、当前 session 与 URL 不变，以及承载层宽度不超过 PIU 首页卡片；生产代码修改前运行并确认目标断言失败
  来源：`FN-1.13 查看收藏列表` + `PIU 更多菜单以受限宽度弹框展示收藏`

- [x] 2.30 让 `PiuContent` 私有持有收藏弹框开关，把主线已有 `MoreMenuButton.onFavoritesClick` 接入共享 `FavoriteTurnsPanel`，并在正文选择时复用 PIU runtime store 打开 session 后关闭弹框；不得新增 hash route、公共 navigation adapter 或 PIU 收藏查询状态
  来源：design“共享 `FavoriteTurnsPanel`”；`PIU 更多菜单以受限宽度弹框展示收藏`

- [x] 2.31 将 PIU 收藏弹框以内联承载层限制在 `.ai-agent-piu-panel` 内，宽度使用当前卡片可用宽度且不复制收藏内容 CSS；验证 docked、floating 和 maximized 布局下弹框均不越过首页卡片
  来源：design“收藏专用布局与主题”；`PIU 更多菜单以受限宽度弹框展示收藏`

- [x] 2.32 合并最新主线后恢复 Local/Immersive 的 session activity controller、可见性投影和 RIGHT history activity 行，确保新增 PIU 收藏接线不回退主线沉浸式首页能力
  来源：最新 `origin/main` 的跨会话活动感知 change；AGENTS.md“同形同策”和 minimal-kernel non-regression

## 3. 跨 Function 集成与迁移

- [x] 3.1 保持既有收藏写入通知边界：`FN-1.12` 成功更新收藏后继续产生现有通知，mounted `FavoriteTurnsPanel` 刷新不少于当前已加载数量的窗口，取消收藏的 turn 从列表消失
  来源：`FN-1.12 标注对话` + `前端对话标注控制`；`FN-1.13 查看收藏列表` + `Local 与 Immersive 收藏内容视图` + “当前收藏窗口响应收藏状态变更”；design“跨 Function 协作与端到端流程”
  验证：在 `frontend/agent-web` 运行包含 `tests/TurnBlock.annotation.test.tsx` 与 `tests/favorite-turns-panel.test.tsx` 的合并命令，4 files / 25 tests 全部通过；既有写入路径未改，面板事件刷新断言确认已取消条目消失且请求窗口不少于已加载数

- [x] 3.2 确认本 change 除 `GET /api/v1/favorites` 的三个可选过滤查询参数和对应 Web 投影逻辑外，不修改响应 DTO、其他 API、`agent-contracts`、gateway/persistence contract、PIU navigation authority 或浏览器持久化键
  来源：proposal“非目标”；design“FN-1.13 查看收藏列表 / 修改方案 / 导航和失败边界”
  验证：2026-08-03 diff 检视确认接口增量只触达 `agent-channel-web` query schema/route projection、agent-web service/panel 及对应测试；`FavoriteTurnPage` 响应、`agent-contracts`、runtime/gateway port、SQLite schema、Owner/Agent Scope 来源、PIU navigation authority 和浏览器持久化均未修改；`git diff --check` 通过，`$nextagent-skill-review` 结论 PASS，`需群内确认: None`

## 4. Change 整体验证

- [x] 4.1 运行 OpenSpec 与 agent-web 目标门禁，确认规格、类型、完整前端测试、多宿主 artifact 构建和浏览器旅程全部通过
  来源：proposal“影响范围”；design“验证策略”
  验证：2026-07-30 完成 2.9-2.17 和最终 identity review 修复后重跑 `openspec validate --all --strict`（261 passed、0 failed）、`npm run build`、完整 Vitest（149 files / 1706 tests，使用 2 workers 避免高并发下既有 5 秒预览测试超时）、`npm run build:vite:modes`、完整 Playwright（27 passed）和 `git diff --check`，全部通过；真实 `http://127.0.0.1:5174/immersive/` 数据验证同一 session 的 6 条收藏只形成一张会话卡、默认仅展示 3 条、展开后显示全部，点击组内第 4 条收藏后目标 turn 位于视口顶部约 78px、距视口底部约 370px，未停留在会话末尾

- [x] 4.2 对最终 diff 运行 `$nextagent-code-review`，覆盖 frozen core contract、frontend/browser ownership、多宿主一致性、minimal kernel non-regression、security、OpenSpec consistency、Clean Code 和验证证据
  来源：AGENTS.md Push 门禁；design“验证策略”
  验证：2026-07-30 对最终 authored scope 执行 `$nextagent-code-review`，覆盖 frozen contract、frontend/browser owner、Local/Immersive 共享实现、Collaborative/PIU 禁止项、minimal kernel、AuthGate 与后端可信授权边界、OpenSpec 一致性、Clean Code 和全部验证证据；审查发现一项组内取消状态仅按 `requestRunId` 标识的 identity 问题，先新增跨 session 同 run 的失败回归（1 failed / 12 passed），再改为 `sessionId + requestRunId` 复合 key，目标测试 13 passed，最终结论 PASS，P0/P1/P2/P3 均无遗留；OpenSpec authoring gate 保持 PASS，`需群内确认` 为 None
  补充复审：2026-07-30 对成功提示与紧凑布局最终增量复审，静态成功消息沿用仓内现有反馈机制且真实 Local/Immersive surface 可见，取消写入仍经共享 `annotationService` 与 `AuthGate`，几何阈值只验证用户要求的可见密度；frozen contract、frontend owner、多宿主一致性、minimal kernel、security、OpenSpec、Clean Code 均无新增问题，结论 PASS，P0/P1/P2/P3 均无遗留
  路由增量复审：2026-07-30 对 `#/favorites` 与 `#/memory` 的最终增量执行 `$nextagent-skill-review` 和 `$nextagent-code-review`。收藏 URL 由 `FN-1.13` 唯一承载，记忆 URL 由 `long-memory-web-management` 唯一承载，共享 helper 只在 agent-web 浏览器边界组合两个 pathname；未修改 `agent-contracts`、后端 package、PIU、依赖清单或持久化状态。定向 Vitest、frontend build、多宿主 artifact build、Playwright、真实页面、两个 change strict 和全量 OpenSpec strict 均通过；结论 PASS，P0/P1/P2/P3 均无遗留，`需群内确认` 为 None

- [x] 4.3 对自动分页增量运行 OpenSpec strict、agent-web 定向/完整测试、前端与多宿主构建、收藏浏览器旅程和真实滚动验证，并以 `$nextagent-skill-review`、`$nextagent-code-review` 完成 push 前复审
  来源：proposal“影响范围”；design“验证策略”；AGENTS.md Push 门禁
  验证：2026-07-30 `openspec validate fix-agent-web-favorite-panel-navigation --strict` 与 `openspec validate --all --strict`（270 项）通过；agent-web 定向 3 files / 38 tests、完整 Vitest 154 files / 1741 tests、`npm run build`、`npm run build:vite:modes`、完整 Playwright 28 tests 和 `git diff --check` 均通过。真实 5174 页面滚动加载至全部 100 条后自动停止且无手动分页按钮；最终 `$nextagent-skill-review` 与 `$nextagent-code-review` 结论均为 PASS，P0/P1/P2/P3 无遗留，`需群内确认` 为 None

- [x] 4.4 对可见加载反馈增量运行 OpenSpec strict、agent-web 定向测试、前端构建、收藏 Playwright 和真实快速请求验证，并以 `$nextagent-skill-review`、`$nextagent-code-review` 完成 push 前复审
  来源：proposal“影响范围”；design“验证策略”；AGENTS.md Push 门禁
  验证：2026-07-30 target change strict 与全量 OpenSpec strict（270 项）、定向 Vitest（3 files / 39 tests）、`npm run build`、`npm run build:vite:modes`、收藏自动滚动 Playwright（1 passed）和 `git diff --check` 均通过。真实 5174 页面在 100 条收藏数据上确认滚动后底部旋转指示与“正在加载更多收藏”同时可见，下一页内容追加后加载条自动消失。最终 `$nextagent-skill-review` 确认增量仍由 `FN-1.13` 唯一承载、Function/owner/验收路径一致，结论 PASS；`$nextagent-code-review` 确认共享组件未修改分页 API、后端、公共 contract、PIU 或可信 scope，最短反馈期间继续阻止重复 offset 请求且卸载清理定时器，结论 PASS，P0/P1/P2/P3 均无遗留，`需群内确认` 为 None

- [x] 4.5 对滚动视口内加载反馈和空闲零布局增量运行 OpenSpec strict、agent-web 定向测试、前端与多宿主构建、收藏 Playwright 和真实 100 条收藏验证，并以 `$nextagent-skill-review`、`$nextagent-code-review` 完成 push 前复审
  来源：proposal“影响范围”；design“验证策略”；AGENTS.md Push 门禁
  验证：2026-07-30 target change strict 与全量 OpenSpec strict（270 项）、定向 Vitest（3 files / 39 tests）、`npm run build`、`npm run build:vite:modes`、收藏自动滚动 Playwright（1 passed）和 `git diff --check` 均通过。真实 5174 页面以 100 条收藏确认空闲 sentinel 为 `0px`，loading 在数据追加后仍完整位于收藏滚动区域内并在反馈结束后消失。最终 `$nextagent-skill-review` 确认行为仍由 `FN-1.13` 的同一 Requirement 承载，新增两个 Scenario 可从滚动区域几何结果验收，唯一实现路径为零布局 sentinel 与 sticky feedback layer，结论 PASS，`需群内确认` 为 None；`$nextagent-code-review` 确认改动只涉及共享 agent-web 浏览器投影、同一 Playwright 旅程和 active change，不修改 frozen contract、后端、PIU、可信 scope 或安全边界，结论 PASS，P0/P1/P2/P3 均无遗留

- [x] 4.6 对收藏专用布局增量运行 target/all OpenSpec strict、agent-web 定向与完整测试、前端和多宿主构建、收藏 Playwright、真实浅色/暗色验证与 `$nextagent-code-review`
  来源：proposal“影响范围”；design“验证策略”；AGENTS.md 验证门禁
  验证：2026-08-01 target strict、agent-web 定向 3 files / 43 tests、`npm run build`、`npm run build:vite:modes`、app smoke 7 tests 和 `git diff --check` 通过；真实 5174 页面用 100 条收藏验证返回、搜索、日期时分秒、16 个 session 分组、展开问答、确认取消、自动分页及浅色/暗色，最终复核 header/card 外框均为 56px。完整 Vitest 仅有未触达的 `chat-composer-controller.attachments.test.tsx` 4 个既有失败；全量 OpenSpec 为 247 passed / 3 个未触达 change 因无 delta 失败，本 change strict 通过。`$nextagent-skill-review` 为 PASS；`$nextagent-code-review` 未发现 P0/P1 或 in-scope contract、architecture、security、OpenSpec 问题，因两项仓库既有全量门禁失败结论为 PASS WITH FOLLOW-UP

- [x] 4.7 对最新主线适配与 PIU 收藏弹框运行 target OpenSpec strict、PIU/收藏/Local/Immersive 定向测试、frontend build、多宿主构建和真实页面几何验证，并执行 `$nextagent-skill-review` 与 `$nextagent-code-review`
  来源：proposal“影响范围”；design“验证策略”；AGENTS.md 验证门禁
  验证：2026-08-03 target/all OpenSpec strict（259 items）、agent-web 定向 6 files / 116 tests、`npm run build`、`npm run build:vite:modes`、收藏 app smoke 7 tests 和 `git diff --check` 通过；真实 Collaborative/PIU 页面确认 docked、floating 的 484px 卡片承载 418px 弹框，maximized 的 1280px 卡片承载 960px 弹框，三种布局均未越界，弹框内滚动区高度 459px、内容高度大于视口时独立滚动，关闭后仍为原 `session=main` URL。`$nextagent-skill-review` 与 `$nextagent-code-review` 均为 PASS；全量 Playwright 另有 4 个非本 change 既有失败（complaint history、cron filter、long history request count、session activity row geometry），本次定向旅程不受影响。

- [x] 4.8 先补充真实收藏接口过滤回归，再为 `GET /api/v1/favorites` 增加可选关键词和收藏时间范围参数，在服务端先过滤再分页；前端提交和清除过滤条件时重新请求接口，后续分页携带同一参数，并删除浏览器本地过滤和过滤时全量补页逻辑
  来源：`使用关键词和日期时间过滤收藏`；design“收藏接口过滤”
  验证：2026-08-03 生产代码修改前，annotation API 新用例因 URL 缺少过滤参数失败，收藏面板两个新用例因仍在本地过滤/自动补齐全部分页失败；实现后 `packages/agent-channel-web/tests/annotation-routes.test.ts` 14 tests、agent-web annotation API 与收藏面板 26 tests 全部通过，覆盖无过滤快速路径、关键词/闭区间、先过滤再分页、非法范围、超长关键词、清除条件和过滤分页参数延续

- [x] 4.9 运行收藏 Web route、annotation API、收藏面板定向测试、frontend build、target/all OpenSpec strict，并在真实页面确认过滤请求实际包含查询参数且返回服务端过滤结果
  来源：proposal“影响范围”；design“验证策略”；AGENTS.md 验证门禁
  验证：2026-08-03 Web route 14 tests、agent-web annotation API 与收藏面板 26 tests、`frontend/agent-web npm run build`、target strict 与 all strict（259 items）和 `git diff --check` 全部通过；本地后端 3000 对 99 条收藏使用关键词与精确时间闭区间返回目标 1 条，5173 Immersive 页面搜索“收藏分页测试会话 14”只显示接口返回的 6 条收藏，接口分页元数据一致

- [x] 4.10 在最新主线的 watermark/session activity 类型基线恢复可构建后，补跑根 workspace typecheck/backend build；不得把该基线修复混入本 change
  来源：AGENTS.md 验证门禁；design“验证策略”
  验证：2026-08-03 合并最新 `origin/main` 后运行根 `npm run build`，workspace typecheck、runtime build、builtin skill assets 和 workbench Vite build 全部通过；后端收藏 route 14 tests、根 `npm test` 139 files / 1455 tests 通过，未把 watermark/session activity 基线修复混入本 change

- [x] 4.11 先补充 PIU 收藏复用左侧扩展内容容器且不打开收藏弹框的回归，再将“更多 → 收藏”接入现有 `expandPanelStore` 单一 view；关闭或打开收藏会话时收起扩展容器，并删除收藏专用弹框状态和样式
  来源：`PIU 更多菜单在左侧扩展内容容器展示收藏`；design“共享 `FavoriteTurnsPanel`”
  验证：生产代码修改前，新回归因找不到 `ai-agent-expand-panel-region` 且仍存在 `piu-favorites-modal` 按预期失败；实现后 `piu-runtime-contract.test.tsx` 33 tests 通过。真实 5173 Collaborative 页面确认收藏面板位于左侧 `0-796px` 扩展区域，PIU 卡片位于右侧 `796-1280px`，收藏面板是扩展容器后代且不存在 PIU 收藏弹框，URL 保持 `/collaborative/`

- [x] 4.12 为开始日期和结束日期分别启用快捷清除，补充单独清除一端后保留另一端并以剩余服务端过滤参数重载首个窗口的回归
  来源：`使用关键词和日期时间过滤收藏`；design“共享 `FavoriteTurnsPanel`”
  验证：新增组件回归覆盖开始、结束日期均有独立清除入口，清除开始日期后接口首窗口请求只保留 `favoritedTo`；`favorite-turns-panel.test.tsx` 17 tests 通过。真实 5173 页面发现并修正浮层内清除的点击穿透后，最终将快捷清除放在稳定的日期过滤组件旁，点击后摘要恢复“选择收藏日期”、清除入口消失、卡片展开数保持 0，并重新显示未过滤结果

- [x] 4.13 运行 target/all OpenSpec strict、PIU/收藏定向测试、frontend build、多宿主构建，并在真实 Collaborative 页面验证收藏位于左侧扩展内容容器、无 PIU 内弹框及日期单项清除
  来源：proposal“影响范围”；design“验证策略”；AGENTS.md 验证门禁
  验证：2026-08-03 target strict、all strict（259 items）、PIU 33 tests、收藏面板 17 tests、`npm run build`、`npm run build:vite:modes` 和 `git diff --check` 全部通过；源代码中 `piu-favorites-modal`、`favoritesOpen`、`setFavoritesOpen` 与 `ai-agent-piu-favorites` 均无匹配。真实 5173 Collaborative 页面完成左侧容器、无弹框、日期填写与快捷清除复验

- [x] 4.14 先补充满宽布局、每页 10 个 session 的显式分页、收起无滚动和智能体 Markdown 的可观察失败回归，再删除自动分页 sentinel/loading 状态并复用实际对话卡片的 Markdown 组件
  来源：`Local 与 Immersive 收藏内容视图` 的“显式分页按会话分组切换”“收起页面不产生滚动条”“智能体回答使用对话 Markdown 渲染”
  验证：2026-08-03 生产代码修改前运行 `npm test -- --run tests/favorite-turns-panel.test.tsx`，新增回归分别因旧实现一次展示 11 个 session 且智能体回答仍为纯文本按预期失败；实现后 1 file / 15 tests 通过。组件改为一次读取可信 scope 内既有硬上限 100 条、先按 session 分组再每页展示 10 组，移除 `IntersectionObserver`、sentinel、追加 loading 与定时器，收起/展开分别使用无滚动网格和可滚动自然流，ASSISTANT/SUMMARY 复用 `MarkdownContent`

- [x] 4.15 运行 target/all OpenSpec strict、收藏与三宿主定向测试、frontend build、多宿主构建和显式分页 Playwright，并在真实 Collaborative 页面验证满宽、10 条分页、收起无滚动与展开 Markdown
  来源：proposal“影响范围”；design“验证策略”；AGENTS.md 验证门禁
  验证：2026-08-03 target/all OpenSpec strict（259 items）、收藏/PIU/Local/Immersive/annotation 定向 85 tests、ExpandPanel 6 tests、`npm run build`、`npm run build:vite:modes`、显式分页 Playwright 和 `git diff --check` 通过。真实 5173 Collaborative 页面确认 panel/body 宽 326.4px，16px 左右 padding 后过滤区、列表和卡片均宽 294.4px；第一页 10 个 session、第二页 6 个 session，收起时 `scrollHeight = clientHeight = 642px` 且 `overflow-y: hidden`，展开后 `overflow-y: auto`、正文高度 2144px 并存在共享 Markdown 段落 DOM。完整 frontend Vitest 仍有未触达的记忆管理 CSS、消息附件权限等失败；本分支前序 ExpandPanel 的 2 条旧布局断言已同步当前 48px 顶栏结构并单独通过

- [x] 4.16 先补充 15 个 session 分页和长短 Markdown 回答自然高度的失败回归，再将收起卡片间距压缩为 2px、展开分组间距压缩为 4px、问答内边距压缩为 8px/12px，并移除智能体回答的固定/最小 56px 高度
  来源：`Local 与 Immersive 收藏内容视图` 的“显式分页按会话分组切换”“收起页面不产生滚动条”“智能体回答使用对话 Markdown 渲染”
  验证：2026-08-03 生产代码修改前，定向组件测试明确失败于“期望 15 条、实际 10 条”；实现后收藏面板 15 tests、收藏定向 Playwright 2 tests、frontend TypeScript build、target/all OpenSpec strict（259 items）和 `git diff --check` 通过。浏览器断言第一页 15 张卡片、收起区无纵向滚动、卡片间距不超过 2px、问答内边距为 8px/12px，长 Markdown 回答高度大于短回答且智能体容器 `min-height: 0px`

- [x] 4.17 将相邻会话分组卡片间距统一调整为 8px，并补充单行 Markdown 回答回归；收藏面板局部覆盖 Markdown 根节点为自然高度和正常空白处理，清除首尾文本块默认外边距，不修改共享对话 Markdown 行为
  来源：`Local 与 Immersive 收藏内容视图` 的会话分组卡片间距与“智能体回答使用对话 Markdown 渲染”
  验证：2026-08-03 生产代码修改前，浏览器回归明确失败于会话卡片实际间距 2px；实现后收藏定向 Playwright 2 tests、收藏面板 15 tests、frontend TypeScript build、target/all OpenSpec strict（259 items）和 `git diff --check` 通过。浏览器计算结果为会话卡片 gap 8px、Markdown `min-height: 0px`、首尾段落 margin 0px，单行 Markdown 根节点高度 21px 等于其 21px 行高

- [x] 4.18 先补充第一页底部会话展开后正文起始位置仍在视口外的失败浏览器回归，再在共享收藏面板中记录会话卡片 ref，并仅在展开时于布局提交后平滑滚动目标卡片到内容视口顶部；受底部边界限制时至少保证展开正文开头可见
  来源：`Local 与 Immersive 收藏内容视图` 的“展开会话后自动进入内容视口”
  验证：2026-08-03 生产代码修改前，第 15 张目标会话卡片相对收藏内容视口顶部偏移 896px，10 秒内未进入视口；实现后收藏定向 Playwright 2 tests、收藏面板 15 tests、frontend TypeScript build、target/all OpenSpec strict（259 items）和 `git diff --check` 通过。第一页第 8 张会话展开后卡片顶部与内容视口顶部偏差不超过 2px；第 15 张受底部边界限制时，目标卡片与 `.favorite-session-conversations` 起始位置均进入内容视口；收起与显式分页行为保持不变

- [x] 4.19 先补充回答/问题 Tab 查询、切换复位、按类型取消收藏、Tab 与过滤区间距以及 hover 四边边框的可观察失败回归；再为 `GET /api/v1/favorites` 增加可选 `favoriteType=ANSWER|QUESTION`，复用既有回答/问题收藏 port，并在共享面板中实现同形双 Tab、8px 内容间距和真实卡片边框
  来源：`FN-1.13 查看收藏列表` + `收藏内容必须支持回答与问题分类` + “切换收藏回答和收藏问题”“按当前 Tab 取消收藏”“悬停卡片保持完整边框”“Tab 与过滤区保持间距”；design“FN-1.13 查看收藏列表 / 共享 FavoriteTurnsPanel”
  验证：在 `frontend/agent-web` 运行 `npm test -- --run tests/annotation-api.test.ts tests/favorite-turns-panel.test.tsx` 和 `npm run build`；在仓库根目录运行 `npm test -- --run packages/agent-channel-web/tests/annotation-routes.test.ts`
  验证结果（2026-08-07）：生产代码修改前，前端新增回归 5 项失败、Channel 问题收藏路由回归 1 项失败；实现后前端收藏与 API 定向 27/27、Channel annotation routes 16/16、前端 TypeScript build、`agent-channel-web` build、双宿主 Vite build 和两个相关 OpenSpec strict 均通过。问题收藏更新事件使用服务端返回的最终状态；浏览器收藏旅程验证回答/问题切换、真实卡片四边边框和 Tab 下方 8px 间距；完整浏览器套件的其余失败为本轮范围外的既有主线断言漂移和未启动后端代理连接失败。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”归并 `conversation-annotation-controls`、`favorite-turn-list`、两个 Function、`F-1.7`、overview、`agent-web-host-modes` 与 `spec-to-design-map`。来源 `conversation-annotation` 继续保留未迁移 Requirements，不得在本 change 中退役。
