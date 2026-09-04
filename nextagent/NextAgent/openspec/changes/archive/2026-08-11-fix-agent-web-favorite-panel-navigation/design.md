## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-1.12 标注对话` | 保持前端标注控件行为不变，并从混合 Requirement 中形成单一 Function 的 canonical 承载 | `conversation-annotation`、`conversation-annotation-controls` | `FN-1.12 标注对话` |
| `FN-1.13 查看收藏列表` | Local 与 Immersive 统一在主内容区域按 session 分组展示收藏 turn；Collaborative/PIU 从既有更多菜单在与记忆管理相同的左侧扩展内容容器复用同一内容 | `conversation-annotation`、`favorite-turn-list` | `FN-1.13 查看收藏列表` |

## 存量 Requirement 迁移方案

| 来源 spec / Requirement | 目标 Function / canonical spec | 原子 delta | 其他行为与未触及 Requirements 处理 | 白盒落点 | stable spec 与导航影响 |
|---|---|---|---|---|---|
| `conversation-annotation` / `Frontend annotation interaction behavior` | `FN-1.12` / `conversation-annotation-controls`；`FN-1.13` / `favorite-turn-list` | 来源 `REMOVED`；两个目标分别 `ADDED` | 标注控件行为无损迁入 `FN-1.12`；收藏列表行为按目标态迁入 `FN-1.13`；来源 spec 的 persistence、upsert、query、REST、supersede 和删除清理 Requirements 原位保留 | 本文两个 Function 章节 | `conversation-annotation` 继续作为 legacy spec 保留；两个 Function 文档改指各自 canonical spec，并保留 legacy 导航；`spec-to-design-map` 增加两个 canonical spec |

`add-favorite-count-limit` 只修改收藏容量约束，不触及该 legacy Requirement。`add-web-channel-complaint-feedback` 已在当前主干形成投诉历史入口实现，但其 active artifacts 仍与 `Sidebar.tsx`、`ImmersiveApp.tsx` 有文件重叠；实施时只保留其现有行为并避免改写投诉 Function 语义。目标 spec 与来源 spec 不由本 change 之外的未协调修改承担。

## `FN-1.12 标注对话`

### 目标与规范依据

本 Function 只完成被触及 legacy Requirement 的归属收敛。点赞、点踩、回答收藏、持久化状态恢复、乐观更新和失败反馈的用户可见行为保持不变；本 change 不授权修改标注 API 或控件交互。

#### 本 Function 的目标 Requirements

canonical spec：`conversation-annotation-controls`

- `ADDED`：`前端对话标注控制`

### 当前实现

`frontend/agent-web/src/features/chat/components/TurnBlock.tsx` 在 terminal assistant turn 的操作行组合复制、点赞、点踩、收藏和重新生成控件。标注控件通过现有 `annotationService` 写入，并由会话标注读取结果恢复状态。现有 `TurnBlock` 标注测试覆盖收藏与评价独立、加载态、失败回滚和 terminal 显示条件。

这些代码和测试同时服务 Local、Immersive 与 Collaborative 的共享对话渲染路径；宿主 shell 不拥有标注写入或 turn 控件状态。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| `前端对话标注控制` 由 `FN-1.12` 的唯一 canonical spec 承载 | 行为已实现，但 legacy Requirement 同时包含 `FN-1.13` 收藏列表行为 | 只存在规格归属 GAP，不存在产品实现 GAP |

### 修改方案

保留 `TurnBlock`、`annotationService`、标注状态恢复和既有测试，不修改生产代码。归档时把 `前端对话标注控制` 合入 `conversation-annotation-controls`，并让 `FN-1.12` Function 文档以该 spec 为 canonical 行为入口；仍未触及的标注 persistence、upsert、REST 和清理 Requirements 继续通过 legacy `conversation-annotation` 导航。

验证只做非回归：现有标注控件 targeted tests 必须继续通过。不得为了此次导航修复移动标注状态、复制标注 service 或改变公共 contract。

## `FN-1.13 查看收藏列表`

### 目标与规范依据

本 Function 在 Local 和 Immersive 中提供一致的收藏内容视图：收藏列表进入主内容区域，左侧最近会话保持可用；同一 session 的当前已加载收藏 turn 收敛为一个紧凑分组；主内容入口由 shell 统一选择，临时交互不改变当前主内容。收藏查询、分页、排序、scope 和目标 turn 坐标继续复用现有契约。

#### 本 Function 的目标 Requirements

canonical spec：`favorite-turn-list`

- `ADDED`：`Local 与 Immersive 收藏内容视图`
- `ADDED`：`主内容入口选择互不耦合`
- `ADDED`：`收藏内容必须支持回答与问题分类`

### 当前实现

本 change 实施前存在两条平行的收藏 UI 路径：

1. `Sidebar.tsx` 在 Local 和 Immersive LEFT 中私有持有 `showFavorites`、收藏条目、分页、加载、错误和刷新状态。`showFavorites` 为真时，收藏列表条件分支直接替换 `sidebar-session-list`。收藏 handler 还感知 `memoryManagementActive`，并显式调用对话选择与路由；记忆管理和 Cron handler 反向关闭收藏，而投诉历史 handler 不关闭收藏，因而可能出现多个 active 反馈。
2. `ImmersiveApp.tsx` 的 RIGHT 布局由 `RightPanelView` 持有 `favorites` 选择，并在主内容区域使用 `CardList` 覆盖对话。该路径只加载首个窗口，没有与 LEFT 共用分页、失败重试和收藏更新刷新逻辑。

Local shell 直接并排渲染 `Sidebar` 与 `ChatWorkspace`，没有主内容选择状态。Immersive LEFT 已有 `ShellContentView`，但只包含 `conversation | memory | complaint`。Immersive RIGHT 已有 `RightPanelView`，包含 `conversation | memory | complaint | history | favorites`，重复选择 history 或 favorites 会切回 conversation。

`annotationService.listFavoriteTurns` 和 `FAVORITES_UPDATED_EVENT` 已是共享的收藏读取与变更通知入口。收藏条目已经包含 `sessionId`、`requestRunId`、`rootMessageId`、`questionPreview`、`sessionTitle`、`sessionUpdatedAt` 和 `favoritedAt`。用户要求过滤必须由真实接口执行，因此现有 `GET /api/v1/favorites` 需要增加可选查询参数，但不需要修改响应 DTO。

当前工作树已经完成 shell 选择状态和共享 `FavoriteTurnsPanel`：组件直接对当前 `entries` 执行逐 turn 卡片渲染，因此同一 `sessionId` 的多个收藏 turn 会重复展示会话标题、时间和外框。现有条目字段足以在前端按 `sessionId` 派生分组，并继续使用 `requestRunId`、`rootMessageId` 保持单条写入和精确导航；分组优化不需要重做已完成的 shell、service 或锚点定位路径。

现有共享面板在前序增量中已完成 session 分组、自动分页、取消收藏、专用 URL、接口过滤和问答正文展示，但自动追加在收藏较多时要求用户持续滚动，列表与过滤区又受 `max-width: 960px` 限制，未占满 PIU 左侧容器；智能体正文仍按纯文本投影，没有复用实际对话卡片的 Markdown 能力。既有收藏写入硬上限为 100，足以在一次有界接口读取后建立完整 session 分组和显式页数，不需要新增聚合 API 或修改公共 DTO。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| Local/Immersive LEFT 在主内容显示收藏并保留最近会话 | 收藏列表由 `Sidebar` 私有状态驱动并替换最近会话 | 收藏展示位置和状态 owner 均不符合目标 |
| 三种宿主提供相同显式分页、空态、错误、重试和刷新行为 | 共享 panel 已统一数据投影，但使用滚动触发自动追加 | 需要改为完整有界窗口上的 session 分组分页，每页 15 个分组 |
| 主内容只显示一个，非对话入口没有冲突 active，重复选择幂等 | Sidebar 与 Immersive shell 分别持有布尔/union 状态，handler 互相感知并不对称地清理 | 存在状态 owner 重叠和交叉副作用 |
| 临时交互不改变当前主内容 | 搜索已保持收藏状态，设置和帮助也为局部交互 | 现有正确行为需由受控主内容状态继续保证并补验收 |
| 同一 session 的多个收藏 turn 紧凑展示 | 当前共享 panel 为每个 turn 渲染独立外层卡片 | 会话标题和卡片边界重复；需要只在前端当前已加载窗口内按 `sessionId` 派生一个会话分组 |
| 收藏可通过 URL 直达和恢复，并与记忆管理路由互斥协作 | 当前 shell 只以 React 私有状态选择收藏主内容，任意 route location 变化都会恢复 conversation；记忆管理的目标 URL 由 `add-ts-long-memory-manage` 定义 | 收藏 Function 缺少稳定 pathname 映射；共享 Shell 还需消费两个 Function 各自拥有的路径并提供唯一 active 反馈 |
| 收藏页返回进入前的 session 或新会话 | shell 已记录最近一次非收藏/记忆路径，但共享面板没有返回回调 | 需要由 shell 把既有可信浏览器路由投影为 `onBack`，面板不得自行猜测 session |
| 回答收藏与问题收藏分类展示 | annotation runtime 与 gateway 已分别提供 `listFavoriteTurns` 和 `listQuestionFavoriteTurns`，但 Web 收藏接口和共享面板只读取回答收藏 | 需要在现有 Web route 上增加可选类型选择，并在单一面板内切换同形投影 |
| Tab 与下方内容保持视觉分隔 | Tab 下边线与过滤区紧邻，缺少可辨识的垂直留白 | 需要在共享面板中保留确定的 8px 垂直间距 |
| 会话卡片 hover 时边框完整 | 卡片以父元素 `inset box-shadow` 模拟边框，子摘要的 hover 背景会覆盖顶部内阴影 | 需要使用真实主题边框，让 hover 背景绘制在边框以内 |
| 关键词和精确日期时间过滤 | 收藏面板只按后端返回顺序展示当前窗口，接口不接收过滤条件 | 需要扩展收藏查询参数，由 Web route 在可信 scope 内先过滤再分页，panel 只持有条件并重新请求接口 |
| 收起卡片为 56px 摘要、展开显示完整问答正文 | 当前分组默认显示前 3 个问题摘要，不读取回答正文 | 需要将展开状态改为按收藏 turn 锚点读取会话窗口并投影 USER/ASSISTANT 正文 |
| 取消收藏需要确认 | 当前取消按钮直接提交写入 | 需要在既有 `AuthGate` 内增加确认浮层，取消确认不得触发 service |
| 浅色与暗色主题一致 | 当前布局以大量 inline style 混合变量和 fallback 色值 | 需要把收藏专用样式集中到 CSS，并只消费主页共享主题变量 |
| Collaborative/PIU 从既有更多菜单在左侧扩展内容容器打开收藏 | 最新主线已提供“更多 → 收藏”菜单项；记忆管理、投诉历史和定时任务已通过 `expandPanelStore` 在 PIU 左侧容器展示内容，但收藏当前另行使用 PIU 卡片内 `Modal` | 需要让收藏复用 `expandPanelStore` 的单一 view 和 open 状态，并删除收藏专用弹框；不得新增路由或第二套查询状态 |

### 修改方案

唯一实现路径由“shell 选择状态”和“共享收藏内容组件”两部分组成。

#### 1. shell 统一拥有当前主内容选择

- 本 Function 在 Local 与 Immersive 的既有 `HashRouter` 内定义 `/favorites` 收藏内容路径，浏览器可见结果为宿主基地址下的 `#/favorites`，无需新增服务端 rewrite。共享 pathname helper 同时识别 `long-memory-web-management` 定义的 `/memory`，但记忆路由的直达、刷新和历史恢复规范只由该 Function 承载。
- Local 从 `location.pathname` 派生 `conversation | favorites`；Local 不提供记忆管理入口，因此 `/memory` 不在 Local 增加新的产品 surface。新会话、会话条目和组内收藏 turn 行导航到既有对话路径后自然恢复 conversation。
- Immersive LEFT 与 RIGHT 从 `/favorites` 以及长期记忆 Function 提供的 `/memory` 派生当前主内容；投诉历史和 RIGHT 最近历史继续使用当前浏览器 history entry 的临时 state，不获得专用 URL。shell 记录最近一次非收藏/记忆路径，仅用于从专用路径切换到这些既有临时主内容时保留原对话地址。
- 收藏入口点击使用普通 history navigation；重复选择当前入口可替换当前 entry，避免产生无意义的重复历史项。浏览器前进、后退、直达和刷新均从 pathname 恢复收藏视图；记忆入口的同类结果按 `long-memory-web-management` 验收。
- Local、Immersive LEFT 和 Immersive RIGHT 继续以各自的 `previousConversationRouteRef` 保存最近一次对话路径，并把返回动作作为 `onBack` 回调传给共享面板；从 session 进入时返回该 session，从 `/` 进入或直达无历史时返回 `/`。面板不读取 router、session store 或浏览器存储。
- `Sidebar` 改为受控收藏入口，只接收 `onSelectFavorites` 与 `favoritesActive`。它不得读取收藏数据、持有 `showFavorites`、替换 session list，或在收藏 handler 内感知 memory、complaint、route 和其他主内容入口。
- `Sidebar` 中搜索、设置和帮助继续使用各自局部 modal/dialog 状态；这些 handler 不调用任何主内容选择回调。

路由选择只进入当前浏览器 history；不得进入 Zustand、`localStorage` 或 `sessionStorage`，也不改变 backend canonical session、request 或 annotation truth。URL 只拥有浏览器主内容投影，不获得 request lifecycle、canonical history 或 persistence authority。

#### 2. 共享 `FavoriteTurnsPanel`

在 agent-web 收藏 feature 下新增单一 `FavoriteTurnsPanel`，由 Local、Immersive LEFT 和 Immersive RIGHT 复用。组件职责限定为：

- 在过滤区上方使用组件私有 `ANSWER | QUESTION` Tab 状态；默认 `ANSWER`，切换时清理页码和前一类型的临时展开/正文读取状态，并以当前过滤条件重新请求。
- 通过现有 `GET /api/v1/favorites` 的 `favoriteType` 选择回答或问题收藏；Channel 对 `ANSWER` 调用 `listFavoriteTurns`，对 `QUESTION` 调用既有 `listQuestionFavoriteTurns`，省略参数保持 `ANSWER` 兼容语义。响应 DTO、runtime port、gateway contract 和持久化均不变。
- 取消收藏根据当前 Tab 只写入 `isFavorited=false` 或 `isQuestionFavorited=false`，继续使用既有 annotation upsert 与刷新事件。
- 会话卡片使用 `border: 1px solid var(--color-border)` 和既有 shadow，不再以可被子元素背景覆盖的 inset shadow 充当边框。
- Tab 下边线与过滤区之间使用 8px 垂直间距，在不新增宿主专用布局的前提下保持两层内容可辨识。

- mount 或过滤条件变化时通过 `annotationService.listFavoriteTurns(0, 100, filter?)` 读取当前可信 scope 的完整有界窗口；100 来自既有收藏写入硬上限，不形成无界浏览器读取；关键词和日期仍由服务端真实接口先过滤；
- 私有持有 `entries`、`isLoading`、`error` 和当前页码，不再持有 `hasMore`、offset、sentinel、IntersectionObserver、分页 in-flight guard 或最短 loading 定时器；
- 先对完整 `entries` 按 `sessionId` 派生分组，再以每页 15 个分组切片，并用 Ant Design `Pagination` 提供显式页码；过滤变化时回到第一页，取消收藏或刷新导致页数减少时把当前页收敛到有效范围；
- 当前页全部收起时，内容区使用固定 15 轨的自适应网格和 8px 会话卡片间距，摘要卡最大 56px 且内容区 `overflow: hidden`，保证最多 15 条在可用高度内无滚动条；任一当前页分组展开后切换为相同 8px 会话卡片间距的自然流和 `overflow-y: auto`；
- 面板以 `sessionId` 私有记录当前页会话卡片 DOM ref；从收起切换为展开后，在下一次 animation frame 对目标卡片调用 `scrollIntoView({ block: 'start', behavior: 'smooth' })`，由浏览器在可滚动范围内优先顶端对齐并在末尾空间不足时执行 best-effort 滚动；收起操作不触发自动滚动；
- 当前组件 mount 期间接收 `FAVORITES_UPDATED_EVENT` 时，刷新完整有界窗口；
- 首屏失败时保留 panel，显示安全错误文本与重试入口；重试重读完整有界窗口；
- 从当前 `entries` 派生 session 分组，并只私有持有各会话分组的展开状态；分组不是新的收藏事实或查询缓存；
- 私有持有搜索草稿、已提交关键词、开始时间和结束时间；两个日期时间控件显式启用各自的 clear 操作，单独清除任一端时保留另一端；提交或清除条件时从 offset `0` 调用 `annotationService.listFavoriteTurns` 并传递过滤参数；组件不对 `entries` 二次过滤；
- 通过 `onBack` 发出返回意图，不在组件内持有或解析对话路由；
- 分组展开时，以每个 `FavoriteTurnEntry.rootMessageId` 调用既有 `sessionService.loadConversation`，使用 `limit=50` 与 `includeCapabilityResults=true` 读取锚点窗口；组件仅保留该收藏 turn 的 visible USER/ASSISTANT/SUMMARY 文本并按 sequence 展示，ASSISTANT/SUMMARY 复用实际对话卡片的 `MarkdownContent`，USER 保持纯文本；问答内容使用 8px/12px 纵向/横向内边距，智能体正文和 Markdown 根节点不设置 56px 固定或最小高度，并仅在收藏面板内清除首尾文本块的默认外边距；读取状态和 `AbortController` 只存在于 panel mount 生命周期；
- 选择组内 turn 行只调用必需的 `onOpenFavorite(sessionId, rootMessageId)` 回调，导航由 host shell 承担；
- 组内已收藏图标使用 `Popconfirm` 承担确认状态；只有确认操作才通过既有 `annotationService.upsertAnnotation` 按当前 Tab 写入 `isFavorited=false` 或 `isQuestionFavorited=false`，取消确认不触发请求；成功后从当前投影移除该 turn并显示“已取消收藏”，失败时保留正文并显示安全反馈；收藏按钮不得冒泡为 turn 打开操作。
- 取消收藏是可见写操作，继续由现有 `AuthGate` 按 `AICOService.Write` 提供浏览器 UX 禁用；可信授权仍由后端 owner scope/auth 边界负责。

组件不拥有当前主内容选择、浏览器路由、session history、其他标注状态或 host mode 判断；它只拥有列表内取消收藏这一条既有 annotation 写入的 UI 编排。会话分组稳定 key 使用 `sessionId`，组内 turn 行稳定 key 使用 `sessionId + requestRunId`；可见主文本使用 `questionPreview`，分组标题只消费现有 `sessionTitle` 或 `sessionId` 回退值。空列表只显示收藏空态，不回退到 session history。

`Sidebar` 中现有收藏数据和渲染代码删除；Immersive RIGHT 删除其本地 favorites state/effect，并复用该组件。RIGHT 的通用 `CardList` 继续只服务 history，不为本 change 泛化新的列表框架。

Collaborative/PIU 不参与上述 hash 路由选择。`PiuPanelHeader` 的“更多 → 收藏”与记忆管理、投诉历史、定时任务和自定义扩展内容统一写入现有 `expandPanelStore.view` 并调用 `open()`，由 `PiuContent` 已有的 `ai-agent-expand-panel-region` 在 PIU 左侧展示唯一当前扩展内容。收藏 view 挂载同一个 `FavoriteTurnsPanel`：`onBack` 只调用 `expandPanelStore.close()`；选择正文时先通过既有 PIU runtime store 打开 session 并传递 `rootMessageId` 的导航意图，再关闭扩展容器。后选择的扩展入口通过覆盖单一 `view` 自然替换先前内容，不增加收藏专用布尔状态、`Modal`、URL、持久化键、公共 navigation adapter 或收藏 service 状态。

#### 3. 会话分组投影

分组是 `FavoriteTurnsPanel` 对完整有界 `entries` 的单一派生投影，不新增 service、store、DTO 或持久化键：

1. 按收藏查询返回顺序遍历 `entries`，以精确 `sessionId` 查找或创建分组；会话标题不参与 identity，标题相同的不同 session 始终分开。
2. 分组首次出现时确定其外层顺序；后续属于同一 session 的 turn 追加到既有分组，组内保持查询结果的相对顺序。刷新窗口后使用同一规则重新派生，禁止产生同 session 的第二张外层卡片。
3. 分组完成后才按 15 个 session 一页切片，页数不按 turn 数量计算。分组标题展示 `sessionTitle ?? sessionId`；完整有界窗口覆盖当前 scope 的全部收藏，因此组内条目均可直接用于展开和取消。
4. 每个分组默认只投影最大 56px 摘要头，摘要头使用首个条目的 `sessionTitle` 和组内最大的 `favoritedAt`；展开后按当前收藏顺序显示全部 turn 的 USER/ASSISTANT/SUMMARY 正文，智能体正文使用共享 Markdown 渲染。展开状态和正文读取状态以 `sessionId`、`sessionId + requestRunId` 为 key，只在 panel mount 生命周期内存在；分页和刷新保留仍存在分组的展开状态，不进入 URL、Zustand 或浏览器存储。
5. 分组标题只承担上下文和数量展示，不绑定导航。精确导航和取消收藏始终作用于组内单个 turn 行。
6. 取消收藏成功后先从 `entries` 移除对应 `sessionId + requestRunId`，再由同一派生规则更新数量；分组没有剩余 turn 时自然消失。失败时 `entries` 和分组保持不变。

这一路径保留后端 turn 粒度事实、全局分页顺序和既有收藏容量语义。不得把展示分组反向写入 annotation service，不得为了获得全量分组计数新增聚合 API，也不得把单条取消收藏提升为 session 级操作。

#### 4. 收藏接口过滤

- Web query schema 为 `GET /api/v1/favorites` 增加可选 `keyword`、`favoritedFrom` 和 `favoritedTo`；关键词最多 50 个字符，时间参数是毫秒级非负安全整数，起始值不得大于结束值。
- 无过滤条件时继续把 `offset/limit` 原样传给既有 runtime annotation port，保持现有路径和性能。
- 存在任一过滤条件时，Web route 通过既有 owner/agent scoped runtime port 一次读取收藏硬上限 100 条，在服务端对 `sessionTitle`、`questionPreview` 和 `favoritedAt` 执行过滤，然后对过滤结果应用请求的 `offset/limit`。收藏写入层已经强制每个用户 scope 最多 100 条，因此该路径不会产生无界读取。
- 该实现只扩展 HTTP query schema 和 Web 投影逻辑，不修改冻结的 `agent-contracts`、gateway port、持久化 schema、Owner Scope 或 Agent Scope；响应继续使用既有 `FavoriteTurnPage` shape。

#### 5. 导航和失败边界

- 组内收藏 turn 行选择使用当前宿主既有导航 adapter 打开 `sessionId` 与 `rootMessageId`；对应 session hash route 使 Local/Immersive shell 从 URL 恢复 conversation。PIU 复用 runtime store 的 session 选择并收起左侧扩展内容容器，不获得 hash route authority；PIU 当前 adapter 不持有 message query，定位能力不在本次容器接线中扩展。
- 收藏 turn 正文由共享面板直接复用既有 `sessionService.loadConversation`；该锚点读取使用公共 conversation contract 允许的 `limit=50`，避免请求在进入目标 turn 前被 Web channel 拒绝。非锚点 latest/older/newer 窗口保持既有大小，避免本次修复改变长会话与 process-history 投影。
- route location 变化从本 Function 的 `/favorites`、长期记忆 Function 的 `/memory` 或既有对话路径恢复主内容选择，不清理 session history、收藏事实或搜索条件。
- 收藏读取错误只属于 panel 投影，不改变 shell 选择；用户可重试。组件 unmount 后忽略已结束读取的结果，避免已切换内容被陈旧响应重新投影。
- 复用既有 `annotationService.upsertAnnotation` 和 `sessionService.loadConversation` contract；收藏面板的 anchored conversation 查询窗口固定为 `50`，不修改 conversation store 的非锚点窗口与状态语义。接口过滤只触达 `agent-channel-web` query schema/projection，不修改 `agent-contracts` 或 gateway。

#### 6. 收藏专用布局与主题

- `FavoriteTurnsPanel` 拆成 56px header、单行 filter bar 和独立滚动 content 三层；header 不随内容滚动，filter 与 content 位于下半部分。共享组件继续由三种 Local/Immersive surface 复用，不新增 host-specific DOM。
- 搜索使用 Ant Design `Input.Search` 的 `allowClear` 与显式搜索按钮；日期按钮使用 `Popover`，内容包含两个独立 `DatePicker showTime showNow` 和重置按钮，使开始、结束选择器只在用户操作对应字段时打开。
- 收起卡片 header 最大 56px，并在 15 条/页时以固定 15 轨网格、8px 会话卡片间距适配容器可用高度；展开内容以相同 8px 会话卡片间距自然增长。折叠箭头、摘要和时间由同一 flex row 投影。用户问题使用 `white-space: pre-wrap` 保留换行，问答正文使用 8px/12px 纵向/横向内边距；智能体正文复用 `MarkdownContent`，消息容器和 Markdown 根节点均不设置 56px 固定或最小高度，收藏面板局部清除首尾文本块的默认外边距，二者使用共享主题变量形成可读层级。
- 新增 `FavoriteTurnsPanel.css` 只组合 `theme.css` 已定义的 `--color-bg-*`、`--color-text-*`、`--color-border*`、`--color-primary*`、`--color-warning`、`--shadow-*` 和 scrollbar 变量；组件不引入独立 light/dark 常量。浅色标题栏自然解析为 `--color-bg-primary=#fff`，暗色解析为对应主页背景。
- PIU 左侧扩展内容容器不复制收藏内容 CSS；共享收藏面板占满该容器扣除统一 padding 后的可用宽度，并沿用容器既有的尺寸与 overflow 规则。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可维护性 | 无新增黑盒质量目标；依据两个功能性 Requirements 派生 | shell 单一选择状态；收藏数据逻辑收敛为一个共享组件；session 分组只从 `entries` 派生；Sidebar 只发出选择意图 | 无平行 favorites state/effect、无第二套分组事实或聚合 API，handler 不再交叉清理其他入口 |
| 可测试性 | 无新增黑盒质量目标；依据两个功能性 Requirements 派生 | 组件级覆盖读取与分组状态，shell integration 覆盖位置与 active 反馈 | normal、empty、paging、same-session grouping、same-title isolation、expand/collapse、failure/retry、update refresh、LEFT/RIGHT/Local 导航 |

## 跨 Function 协作与端到端流程

两个 Function 只在 legacy Requirement 拆分和既有 annotation service 复用上相邻。`FN-1.12` 的回答收藏写入成功后继续发出既有 `FAVORITES_UPDATED_EVENT`；`FN-1.13` 的 mounted `FavoriteTurnsPanel` 消费该通知刷新当前窗口，并通过同一个 `annotationService.upsertAnnotation` 提交列表内取消收藏。事件名称、payload 和 service contract 均不改变。

`FN-1.12` 的共享 turn controls 继续拥有操作行标注写入与回滚；`FN-1.13` 只拥有收藏列表读取、session 分组投影、组内 turn 导航和列表内取消收藏的 UI 编排。两条路径复用同一个 annotation service 和后端事实，不得复制另一方状态或把前端分组、前端事件提升为后端事实。

## 验证策略（Verification Strategy）

- Web route tests 覆盖回答/问题收藏类型、可选关键词和起止时间参数、服务端先过滤再分页、缺省回答收藏非回归、非法收藏类型、非法时间范围和超长关键词拒绝。
- component tests 覆盖收藏面板的回答/问题 Tab、切换复位、按当前类型取消收藏、首屏、空态、56px 标题栏、Tab 与过滤区间距、完整卡片边框、最大 56px 摘要卡、返回、关键词/日期过滤参数提交与清除、完整接口窗口、每页 15 个 session 的显式分页、收起/展开滚动状态、失败重试、同 session 分组、智能体 Markdown 正文与自然高度、正文读取失败重试、确认取消与放弃取消、更新数量/移除空分组，断言用户可见结果。
- Sidebar component tests 覆盖收藏入口只发出选择意图、最近会话始终保留、搜索/设置/帮助不触发主内容选择。
- 本 change 的 Local 与 Immersive shell integration tests 覆盖 LEFT/RIGHT 的收藏主内容位置、唯一 active 反馈、重复选择幂等、`#/favorites` 直达/刷新、浏览器前进后退恢复，以及 session/new-session 返回 conversation；与 `#/memory` 的切换只作为跨 Function 集成断言，完整记忆路由验收属于 `add-ts-long-memory-manage`。
- conversation store 回归断言锚点查询携带 `rootMessageId` 且 `limit=50`；真实浏览器旅程使用后端持久化收藏数据验证目标 turn 被加载并稳定定位，而不是停留在最新窗口末尾。
- annotation control targeted tests 作为 `FN-1.12` 非回归证据，不新增依赖私有实现形状的断言。
- architecture review 检查没有新增 public contract、backend I/O 路径、PIU 持久化收藏状态或 host-specific 收藏查询实现；PIU 只允许复用单一 `expandPanelStore.view` 和共享面板组合。
- PIU runtime component test 覆盖更多菜单打开/关闭、共享面板复用、当前 session 与 URL 不变；浏览器几何验证覆盖收藏面板位于左侧扩展内容容器且不覆盖 PIU 首页卡片。
- Playwright 检查收藏面板、过滤区和卡片占满 padding 内可用宽度，收起页面 15 个 session 以 8px 间距完整显示且无滚动条，显式页码切换只改变当前可见分组且接口仅读取一次 100 条有界窗口；展开后验证长短 Markdown 回答高度随内容变化、Markdown 根节点最小高度为 0、单行段落没有首尾额外空白且正文采用紧凑内边距。
- Playwright 从第一页底部会话触发展开，确认旧实现中目标卡片仍位于内容视口外；实现后等待平滑滚动完成，断言目标会话卡片和 `.favorite-session-conversations` 起始位置均进入收藏内容视口，且不要求底部边界之外的不可达顶部对齐。
- Playwright 从 session 与新会话分别进入收藏并返回，检查 header/card 几何尺寸、过滤控件排列、展开正文、确认浮层，以及切换浅色/暗色后布局尺寸不变且计算颜色来自主题变量。
- frontend build、host mode artifact build 和 OpenSpec strict validation覆盖类型、打包、多入口与规格完整性。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/conversation-annotation/spec.md`：移除已拆分的 legacy `Frontend annotation interaction behavior`，其他 Requirements 保留。
- `openspec/specs/conversation-annotation-controls/spec.md`：新增，作为 `FN-1.12` canonical spec。
- `openspec/specs/favorite-turn-list/spec.md`：新增，作为 `FN-1.13` canonical spec。
- `openspec/designs/functions/D1-会话与流式交互/D1.3-对话标注与分享/FN-1.12-标注对话.md`：标明 canonical spec，并保留未迁移 legacy spec 导航。
- `openspec/designs/functions/D1-会话与流式交互/D1.3-对话标注与分享/FN-1.13-查看收藏列表.md`：更新描述、处理过程、结果与 canonical spec，并保留未迁移 legacy query/API 导航。
- `openspec/designs/features/D1-会话与流式交互/D1.3-对话标注与分享/F-1.7-标注对话.md`：更新收藏回顾的用户价值与两个 Function 的导航。
- `openspec/overview.md`：更新对话标注 stable spec 导航。
- `openspec/designs/architecture/agent-web-host-modes.md`：补充 Local/Immersive 收藏主内容选择、LEFT 最近会话保留和 PIU 左侧扩展内容容器投影。
- modules：无。
- ADR：无。
- `openspec/designs/spec-to-design-map.md`：增加两个 canonical specs 的设计与验证导航，保留 legacy `conversation-annotation`。

## 风险与取舍（Risks / Trade-offs）

- `add-web-channel-complaint-feedback` 的 active artifacts 与本 change 触及相同 shell 文件，后续从其分支合并时可能出现文本冲突。缓解方式是本 change 以当前 `origin/main` 的投诉入口为基线，保留 `complaint` view 与 feature gate，并在最终 diff/review 中明确检查该行为。
- 把收藏数据组件从 Sidebar 移到主内容会改变部分既有测试定位器。测试只迁移到新用户可见 surface，不保留双渲染或兼容定位器，避免形成第二套 UI。
- Local 增加 routed shell 会多一层 composition。该层只在 Router 内观察 location 并投影收藏路径；共享路径 helper 集中识别收藏路径和长期记忆 Function 提供的记忆路径，不引入共享 store 或通用导航框架。
- 当前 change 只为触及的 legacy Requirement 建立两个 canonical specs，未一次性迁移全部 annotation Requirements。这样会在过渡期保留 legacy 导航，但避免扩大到 persistence、API 和清理契约的无关迁移。
- 现有收藏 API 按 turn 返回，但收藏写入硬上限为 100。共享面板以 `limit=100` 建立完整有界分组和页数，代价是每次刷新最多读取 100 条；该读取仍受可信 Owner/Agent Scope 约束，且避免为纯展示分页新增聚合 API。

## 待确认问题（Open Questions）

无。
