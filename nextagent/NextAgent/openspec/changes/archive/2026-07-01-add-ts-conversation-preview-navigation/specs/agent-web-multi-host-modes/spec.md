## ADDED Requirements

### Requirement: Local 和 Immersive 对话面暴露当前会话预览栏

Local 和 Immersive 宿主模式 SHALL 支持 `session-conversation-preview` 定义的当前会话预览栏。该栏 SHALL 渲染在对话区内、靠近 Sidebar 边界的左侧中部并保留间距，SHALL 保持有界于对话 viewport 内，不遮挡 Sidebar、会话列表或 composer。标记间距 SHALL 使用组件级固定策略，MUST NOT 按 marker 数量、marker 总高度或栏 viewport 高度重新计算或动态压缩。当 marker 总高度超过栏 viewport 时，该栏 SHALL 保持有界并可通过内部滚动使用，而不是无限增长。精确的高度上限、间距取值和滚动条样式是前端组件常量，不是宿主模式或 Web/API contract 字段。Local 和 Immersive 预览栏 SHALL 使用分页 marker 数据和 DOM windowing，使长会话不需要一次性加载全部 marker 数据或全部 marker DOM。

本变更中该栏 SHALL 由鼠标操作。非 hover 状态 SHALL 显示紧凑的非活跃 tick 标记。hover 一个已加载 marker SHALL 只高亮该聚焦 marker，并显示一个有界预览卡片，其单行标题来自可见 USER message 的 `previewText`，并在可用时带上同一 request 有界可见 ASSISTANT `answerPreviewText` 的正文，截断为最多三行可见。未加载 marker 窗口的占位 tick MAY 被渲染，但 hover 它们 MUST NOT 请求数据或显示预览卡片。点击一个未加载占位符 SHALL 先加载该 marker 的预览窗口，然后在 marker 数据可用时再导航。点击一个已加载的预览卡片或紧凑 tick 标记 SHALL 平滑滚动到已加载的消息，或通过 conversation anchor API 加载一段锚定的连续对话窗口后平滑滚动到该锚点。

Local 和 Immersive 预览栏 SHALL 使用固定的首版加载常量：`windowSize=100`、请求 `limit=100`、`preloadThreshold=80`，以及最多两个 in-flight 预览窗口请求。初始最近会话渲染 SHALL 请求不带 `offset` 的最新预览窗口，并把预览栏 viewport 底部对齐，使底部可见 marker 是最新 USER 提交而无需用户滚动。当前预览窗口 SHALL 从预览栏 viewport 中心 marker index 推导。当预览栏可见边界距当前窗口头部或尾部不足 80 个 marker 时 SHALL 预加载相邻窗口。UI SHALL 对已加载/加载中的窗口去重，SHALL NOT 把快速滚动期间越过的每个窗口都入队，且 SHALL NOT 在本变更中引入请求取消、优先级队列、滚动速度预测、动态窗口大小或 LRU 逐出。

当新的 USER 提交成功时，Local 和 Immersive 预览栏 SHALL 只刷新尾部预览窗口和 `totalMarkers`。当该提交的模型响应完成时，SHALL 再次刷新尾部窗口，使最新 marker 能包含答案预览。尾部刷新 MUST NOT 重置预览栏滚动位置、清除历史 hover 卡片或重绘无关的历史窗口。如果新 marker 落在当前渲染的预览范围内，SHALL 把它加入该范围。

在预览 marker/卡片之间移动鼠标 MUST 保持 hover、相邻和非活跃 marker 状态在视觉上可区分，且不移动周围布局；精确的宽度和动画时长取值是前端组件常量，不是宿主模式或 Web/API contract 字段。高亮 SHALL 只存在于当前鼠标聚焦/hover 的 marker 上；Local 和 Immersive 预览栏 MUST NOT 从对话 viewport 或锚定选择高亮某个 marker。该栏是当前会话用户提交的迷你地图，不是关键词搜索结果列表，MUST NOT 依赖 `positionRatio`。对话 UI MUST 保持一段连续可见消息分段，MUST NOT 把不连续的早期分段和最新分段拼接在一起。处于锚定状态时，新的最新消息或 live stream delta MUST NOT 被追加到当前可见的锚定分段，除非连续性已被加载。

Collaborative PIU 对话预览栏明确不在本变更范围内。Collaborative 模式 MUST NOT 新增第二个对话预览栏、新的 PIU 搜索 store、新的布局状态或宿主 URL 行为。

#### Scenario: Local 对话栏有界且感知主题
- **GIVEN** Local 对话面存在当前会话预览 marker
- **WHEN** 预览栏被显示
- **THEN** 它 MUST 定位在靠近 Sidebar 边界处并保留间距
- **AND** 它 MUST 保持有界于对话 viewport 内
- **AND** marker 间距 MUST 使用一个组件级固定间距取值，MUST NOT 按 marker 数量或栏高度重新计算
- **AND** 当 marker 总高度超过栏高度时，该栏 MUST 保持可通过内部滚动使用
- **AND** 初始最近会话渲染 MUST 对齐栏 viewport，使底部可见 marker 是最新 USER 提交而无需用户滚动
- **AND** 栏内容总高度 MAY 基于 `totalMarkers * markerRowHeight`
- **AND** marker DOM MUST 只渲染在当前预览 viewport 及其 preload threshold 附近
- **AND** 非活跃 marker MUST 使用主题 secondary/border token
- **AND** 无论深色还是浅色主题都只有被 hover 的预览 marker/卡片被高亮
- **AND** 被 hover 的预览卡片和相邻 marker MUST 保持视觉可区分且不移动对话布局

#### Scenario: Immersive 栏点击使用锚定对话导航
- **GIVEN** Immersive 对话面显示预览栏 marker
- **WHEN** 用户点击某个未加载消息的预览卡片或紧凑 tick 标记
- **THEN** UI MUST 为该消息加载一段连续的锚定对话窗口
- **AND** UI MUST 平滑滚动到该锚点
- **AND** 可见对话 MUST NOT 在早期锚定分段和最新分段之间存在空隙
- **AND** 在连续性被加载或用户返回最新之前，live stream delta 或新的最新消息 MUST NOT 被追加进锚定分段

#### Scenario: Local 栏在快速预览滚动时避免请求风暴
- **GIVEN** Local 对话面有超过 100 个当前会话预览 marker
- **WHEN** 用户在预览栏上快速滚动跨越多个 marker 窗口
- **THEN** UI MUST 只请求最新的当前窗口和符合条件的相邻预加载窗口
- **AND** 它 MUST 对已加载和加载中的窗口去重
- **AND** 它 MUST 保持不超过两个 in-flight 预览窗口请求
- **AND** 它 MUST NOT 请求快速滚动期间越过的每个中间窗口

#### Scenario: 尾部刷新不打扰历史预览交互
- **GIVEN** Local 或 Immersive 预览栏已滚动到较早的 marker 范围
- **AND** 指针正 hover 在一个历史已加载 marker 卡片上
- **WHEN** 新的 USER 提交成功或其模型响应完成
- **THEN** UI MUST 只刷新尾部预览窗口和 `totalMarkers`
- **AND** 它 MUST 保持当前预览栏滚动位置和 hover 卡片稳定
- **AND** 只有当新 marker 位于当前渲染预览范围内时，它 MUST 才把该 marker 加入

#### Scenario: Collaborative 模式不新增预览栏
- **GIVEN** 应用以 collaborative PIU 模式运行
- **WHEN** 本变更被实现
- **THEN** collaborative 模式 MUST NOT 在本变更中新增对话预览栏
- **AND** 它 MUST NOT 新增 PIU 专属搜索 store、布局状态、宿主 URL 变更或第二个历史/搜索入口
