## 背景和现状（Context）

Skill Modal 以底边锚定按钮，但列表从空 loading 切换为查询结果时会改变外框高度，因此顶边发生一次位移。Conversation viewport 已分别保存 `isFollowingBottom`、`isAtBottom` 和阅读锚点，但浮动按钮只读取跟随状态；普通 `scroll` 事件又延迟到下一帧才关闭跟随，使 `ResizeObserver` 可能在该间隙重新置底。历史窗口由 `conversationView.mode=anchored` 表达，其物理底部只有在 `newerCursor` 已耗尽时才可能代表当前连续消息段已经覆盖会话最新位置。当前发送包装器无条件调用 `scrollToBottom()`，历史分页响应也没有与发起时的窗口身份共同校验，因此提交和过期分页都可能破坏回看位置。

相关行为全部属于 `frontend/agent-web` 的浏览器投影和本地 view state，不改变 runtime、Web transport 或 canonical conversation truth。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 使 Skill Modal 在一次打开期间保持外框几何稳定。
- 使置底入口由历史窗口语义、底部跟随策略和物理位置共同决定。
- 使所有真实上滚路径在异步布局变化前同步退出跟随。
- 使历史锚定仅在显式返回，或用户主动连续滚动到已证明的会话最新位置后退出。
- 使 `recent` 非跟随回看和 `anchored` 历史回看期间的提交都保留用户阅读位置，并使异步分页只写入发起它的窗口。
- 使长会话的 live activity、投影更新和 viewport 状态变化只重渲染实际变化的 turn，避免主线程阻塞延迟用户滚动输入。

**非目标：**

- 不修改 Skill 或 conversation API。
- 不修改预览 rail、历史分页协议、滚动动画时长或宿主模式 composition。
- 不增加新消息 banner、badge、计数或独立提示；现有置底按钮是唯一返回最新入口。
- 不新增 anchored 的第三条退出路径；通用“重新加载会话”入口在 anchored 期间不作为返回最新操作暴露。
- 不持久化 `recent` / `anchored` 浏览器 view state；页面刷新仍按既有最新窗口 bootstrap 行为处理。
- 不引入新的全局状态、配置项或第三方依赖。
- 不引入虚拟列表，不重写 conversation store，不改变 stream envelope、终态处理或逐帧 delta 顺序。

## 设计决策（Decisions）

### 1. Skill Modal 冻结列表视口而非控制请求时机

`SkillSelector` 将打开时已知的 Skill 数量传给 `SkillCatalogModal`。Modal 挂载时按现有单行高度计算一次列表视口：至少一行、最多七行；该高度在本次打开期间不再随 loading 或结果数量变化。首次查询、搜索、空结果和分页仍沿用现有请求路径，只替换固定视口内部内容。

该方案直接消除外框尺寸变化，且不把视觉稳定性绑定到缓存命中或是否复用首次数据。放弃仅复用父级查询结果的方案，因为后续搜索仍会改变内容高度；放弃固定整个 Modal 为最大高度的方案，因为少量 Skill 会产生不必要的大面积空白。

### 2. 使用现有三类状态并明确各自语义

- `conversationView.mode` 只描述当前数据窗口是 `recent` 还是 `anchored`。
- `isFollowingBottom` 只描述新增内容是否允许自动置底。
- `isAtBottom` 只描述当前 DOM 视口是否处于底部容差内。

普通置底入口仅在 `recent && !isFollowingBottom && !isAtBottom` 时显示；历史锚定入口在 `anchored` 时显示。`recent` 窗口在用户到达 4px 物理底部容差或点击置底时恢复跟随，不再在距离底部 96px 时提前恢复。提交本身不改变跟随策略：提交开始时仍在跟随的 recent 窗口继续跟随；已经退出跟随的 recent 窗口和 anchored 窗口都保留阅读位置。

`stopFollowingBottom()` 只退出跟随并取消待执行置底，不得把 `isAtBottom` 强制写成 `false`；它必须以当前 viewport 几何重新测量物理底部。这样 Preview 命中已加载消息时，即使短会话不可滚动，也不会因为程序性停止跟随而伪造置底入口。

### 3. 真实上滚同步关闭跟随

`handleScroll` 检测到 `scrollTop` 真实下降且不在底部后，立即通过现有 `updateFollowingBottom(false)` 同步更新 ref，并取消置底动画和待执行 follow frame。下一帧仍负责聚合 `isAtBottom`、new-message state 和阅读锚点。这样 `ResizeObserver` 在同一事件循环内看到的跟随 ref 已为 false，只能执行阅读锚点补偿。

`wheel` 的提前保护继续保留，用于在浏览器实际产生 scroll 事件前取消置底；滚动条、触摸和键盘路径由通用 `scroll` 处理覆盖。

### 4. 历史锚定通过显式返回或连续滚动到最新位置退出

“回到最新消息”继续直接加载最新窗口，成功后进入 `recent` 并置底，不逐页加载锚点之后的全部记录。另一条退出路径只响应用户主动向下滚动：沿用现有 `newerCursor` 分页逐页追加连续消息；只要 `newerCursor` 仍存在，即使当前 DOM 已到物理底部也保持 `anchored`。最后一个更新页使 `newerCursor` 变为 `null` 后仍不立即退出，必须等待用户实际到达当前连续消息段的物理底部，才清除活动锚点、进入 `recent` 并恢复底部跟随。

`useChatViewportController` 进入 anchored 时即退出底部跟随；anchored 期间只更新 4px 物理底部测量，所有内容增长触发的自动 pin 均保持关闭。`ChatPage` 继续复用现有 wheel/pointer 意图，并补充 ArrowDown、PageDown、End 和 Space 键的向下意图；只有 ChatPage 同时确认用户向下意图、`newerCursor=null` 和物理到底，才调用 conversation store 新增的唯一窄 action `completeAnchoredConversation(sessionId, expectedAnchorMessageId)`。该 action 原子校验当前仍是同一 anchored 窗口且 `newerCursor=null`，把现有 view state 改为 `{ mode: "recent", activeAnchorMessageId: null, newMessagesWhileAnchored: false }`；若同一 session 尚有由该 anchored 窗口发起的 older 分页，则同时撤销其 controller ownership、清除 `isLoadingOlder` 并中止请求，使迟到响应无法写入 recent 窗口。该转换不重新加载或替换消息；返回成功后 ChatPage 再复用现有置底动作开启跟随。程序性滚动、Preview 定位后的自动滚动、分页追加引起的布局变化，以及仅仅取得最后一个更新页，都不得单独触发退出。向上滚动继续保持 `anchored`，后续再次主动向下时可以继续加载。

anchored 期间不向 `MessageInput` 暴露通用“重新加载会话”回调，避免该菜单动作通过 latest snapshot 形成第三条隐式退出路径。自动 snapshot refresh 继续按现有 `suppressAutomaticSnapshotRefresh` 规则被抑制。

### 5. 回看期间提交只启动请求，不接管视口

发送包装器不再在 `handleSend` 完成后无条件调用 `scrollToBottom()`，而是调用现有 `requestScrollToBottomIfFollowing()`；该 helper 以执行时仍然有效的跟随策略决定是否置底。这样 recent 且仍跟随的正常提交保持现状，用户在提交等待期间向上滚动也不会被迟到的发送完成重新拉到底部；recent 非跟随回看和 anchored 回看都不置底。anchored 提交不清除活动锚点，也不切换窗口。

若 `newerCursor` 仍存在，现有 conversation store 继续阻止非连续 optimistic/live envelope 拼入可见历史段，并仅保留内部的 `newMessagesWhileAnchored` 状态；该状态不产生额外的新消息 UI。若 `newerCursor` 已耗尽，后续消息与当前段连续，可以追加在段尾，但不得改变用户当前 scroll position；用户仍需主动滚动到真实底部或点击置底按钮退出。

该规则同样覆盖从 Preview 跳转到很早的消息后提交、先加载多页旧消息后提交，以及请求执行期间继续回看。stream 可以继续建立并更新 canonical 请求状态，但自动 snapshot refresh 继续受 anchored 模式抑制。

### 6. 分页结果必须匹配发起时的窗口身份

复用 conversation store 现有窗口加载版本，不新增第二套产品状态机。older/newer 分页发起时记录 `sessionId`、窗口版本、窗口模式、活动锚点和 cursor；响应只有在这些值仍与当前窗口一致时才能写入。最新窗口加载、另一 Preview 锚点加载、会话切换或清理会使旧分页失效。失效响应不得追加消息、覆盖 cursor、改变 loading/error 状态或触发 anchored 退出。

分页失败保持当前消息段和阅读位置；用户后续可以沿用现有入口重试。该约束只处理浏览器异步结果归属，不修改 conversation API、cursor 语义或后端 canonical history。

### 7. 更早与更新分页使用同一滚动触发原则

保留现有 `loadOlderConversation()`、`loadNewerConversation()`、cursor 和窗口身份校验，只替换分页的浏览器交互触发。用户向上移动并进入顶部 128px 边界时加载一页更早消息；anchored 用户向下移动并进入底部 128px 边界时加载一页更新消息。滚轮已经位于边界而无法继续产生原生 `scroll` 时，由同方向 `wheel` 事件触发检查；滚动条、触摸和键盘产生的真实位置变化继续由通用 `scroll` 路径覆盖。

每个方向沿用现有单请求 loading guard，并在分页完成后要求用户继续产生同方向位移或新输入手势，分页 prepend/append、Preview 定位、阅读锚点补偿或其他程序性滚动不得单独触发下一页。更早页继续使用加载前后的 `scrollHeight` 差补偿阅读位置；更新页继续使用现有 anchored 连续性、分页锁和最终物理到底退出规则。空闲状态不再渲染可点击分页入口；加载中或失败状态可以保留只读边界反馈，用户再次向相同方向滚动即可重试。

### 8. live 活动计时与可见投影不得绕过逐帧更新边界

保留 `useStreamConnection` 已有高频 delta 逐帧 append 和 lifecycle/terminal 即时处理。`useChatSessionStream` 不再用每条 envelope 唯一 key 的 React state 重置活动超时；匹配当前 request 的 live envelope 直接通过 ref 持有的 timer 重新计时，使 anchored 隔离或重复 envelope 仍被视为活动，但不触发 ChatPage 渲染。若 terminal 先于本地 accepted identity 到达，即时处理仍保持严格 no-op；accepted identity 建立后，只重查当前 live layer 中与该 identity 精确匹配的 terminal 并补结算，不使用 same-session 或 canonical-run fallback。

当前 request 收到有效 `USER_INPUT_REQUIRED` 后进入 runtime-owned pending-input 等待阶段，frontend 清除 activity timer；该等待由既有 `USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT`、`USER_INPUT_CANCELED` 和 runtime pending timeout 收敛，不属于 stream stuck。resolved event 仍先经过既有 live-envelope 路径，因此会自然恢复普通 activity 计时。若 activity timeout 已触发，回调必须在刷新前后检查同一 request 的 active input；只有 conversation 刷新成功且权威 `activeRun` 已不存在时，才允许本地 settle 和显示恢复提示。该纠偏不修改 timer 时长、pending timeout、stream cursor、Web API 或 request lifecycle owner。

`buildSessionProjection` 继续保持当前 history/live/combined fallback 语义，但暴露同一实现内部的两个阶段：历史窗口解析与 historical turn 构建只依赖 history、窗口 fallback、active run 和“是否已有 live”布尔条件；live overlay 单独依赖逐帧合并后的 live envelopes。正常 layered 路径新增 delta 时必须复用 historical projection。`buildTurnBlocks` 对未变化 block 保留对象引用，`TurnBlockComponent` 使用现有 props 边界做 memo，因此一次 live 更新只重渲染实际变化的 turn。

viewport 的 `isAtBottom` 不再传入未消费该值的 TurnBlock。`isFollowingBottom` 只作为 latest turn 的 effect signal；所有 turn 在异步布局、Process Panel 定时器或用户操作发生时，通过稳定 getter 读取 viewport controller 中最新的 following ref。这样用户第一次向上滚动只更新 viewport 与 latest turn，不把 200 条旧消息变成同一 render fan-out，同时仍保持旧 turn 异步布局的置底或阅读锚点选择正确。

stream raw/parsed frame buffer 保留现有 `ADNCLAW_STREAM_DEBUG=1` 显式诊断入口，但无显式设置时默认关闭。该变化不影响 envelope validation、消息顺序、终态收敛或用户可见错误处理。

本阶段不优化 conversation store 的有界 dedup/compaction，也不引入虚拟列表；只有上述隔离完成后仍能复现长任务时，才以浏览器 profile 证据单独评估。

### 9. viewport 状态更新不得扩散到稳定的历史和 Composer 子树

`conversationStore` 在 live append 未改变历史 envelope 内容时复用当前 session 的历史数组引用，`ChatPage` 直接订阅当前 session 的分层数据，避免其他 map 条目或 live layer 更新使历史投影输入失效。`MessageList` 只把建议问题回调传给实际消费它的 latest turn；`ChatPage` 同时保持该回调稳定，不新增自定义 props 比较器。

Composer footer 继续由 `ChatPage` 组装，但其 ReactNode 只在 Composer 实际输入变化时重建；viewport 的 following、at-bottom 和新消息状态不属于该输入。`RightPaneLayout` 的 overlay footer 高度 observer 只由 footer 模式及 footer 是否存在决定，实际高度变化继续由同一个 `ResizeObserver` 报告。

显式置底继续使用现有 220ms 过渡。点击时立即恢复 following 并隐藏置底入口，但 `isAtBottom` 只在视口真实到达底部后提交；程序性向下动画帧只更新 DOM scroll position，不再逐帧进入通用 scroll state 聚合。用户真实向上输入仍通过现有 wheel/scroll 路径同步取消动画并退出 following。该修正不改变 anchored 返回最新流程、动画时长或物理底部容差。

### 10. 提交生命周期和内容增长不得重复失效稳定子树或重复置底

历史窗口解析与 historical turn 的结构构建只依赖历史消息、历史 envelope 和 combined fallback；active run、是否已有 live envelope 以及提交/accepted/terminal 生命周期只参与 latest turn 的轻量状态修正与 live overlay。首次出现 live envelope 或 request 生命周期变化时，除实际变化的 latest turn 外，已有历史 block 必须保持对象引用；`MessageList` 只把 request 期间的 action 禁用状态传给 latest turn，旧 turn 的既有交互不随当前 request 状态重渲染。

following 模式下由 React effect、`ResizeObserver` 或发送完成触发的内容增长置底请求，必须先复用同一个待执行 animation frame。该帧执行前的重复请求直接合并，帧内只调用一次最终置底；显式置底按钮仍沿用现有 220ms 动画和取消规则。该修正不改变 anchored/recent 状态语义、stream append 批处理、conversation store 去重、Composer 自适应高度或任何 API/宿主边界。

### 11. 高频 handler 只消除可证明的同步布局和无关对象复制

显式置底动画在开始时读取一次目标高度，动画期间由现有 `ResizeObserver` 在内容高度变化时更新目标，普通程序性向下 scroll event 不再重复读取 `scrollHeight`/`clientHeight`；最终帧仍读取真实高度并物理置底，用户真实上滚仍沿用现有取消路径。空 Composer 只恢复 CSS 高度，不再调度读取 `scrollHeight` 的 animation frame；非空输入继续沿用现有自适应高度行为。accepted request 身份对账仍扫描现有 history/live layer，但只为身份命中或 superseded-root 命中的 envelope 复制 payload，其他 envelope 保持原对象引用。

现有 session 提交不得为了减少异步边界而把 optimistic store 写入提前到原生 `keydown` 调用栈；浏览器长会话实测表明该做法会扩大同步事件任务，因此提交继续保持异步，普通 existing-session 路径再由决策 12 将 resolved-promise 微任务细化为真实浏览器 task。上述优化不改变 220ms 动画、物理底部容差、消息顺序、request identity、store shape、Composer 可见行为或后端/API/宿主边界。

### 12. 普通提交、stream batch 和 following frame 分别消除剩余的同任务放大

决策 11 拒绝的同步 fast path 保持不变，但 resolved promise 形成的微任务仍属于原生 `keydown` 所在的浏览器 task。普通 existing-session 新提交在 session 已确认且 edit 分支已排除后，通过零延迟 timer 让出一个真实浏览器 task，再进入 optimistic store 写入；若让出期间 active session 已改变，则终止旧会话提交，避免把旧输入误投到新会话。新会话创建已经包含真实异步请求，edit/retry 继续沿用既有路径，不增加额外 task。

`conversationStore.appendEnvelopes()` 继续只提交一次 Zustand 更新，但 batch 内不再为每条 envelope 复制 session map 和当前数组。它先对当前 live 数组建立一次 envelope identity 集合和 accumulated snapshot lane 索引，再按输入顺序在一个工作数组中完成精确 identity 去重、同 lane 最新 snapshot 替换和普通 delta 追加；最后仍复用现有 compaction、layered state 和 notification 路径。该变化不得改变 envelope 顺序、replacement/dedupe 语义、容量上限或 store shape。

following 内容增长时，`ResizeObserver` 已读取的最新 `scrollHeight` 作为待执行 follow frame 的目标传递并参与同帧合并；frame 只消费最后一个已测目标，不重复读取同一底部几何。没有已测目标的发送完成或 event-count 请求继续按既有路径在 frame 内读取一次真实高度。取消 following frame 时同时丢弃缓存目标；显式置底按钮的 220ms 动画、最终物理到底测量和用户上滚取消规则保持不变。

### 13. 单条本地 optimistic USER 写入只追加已证明安全的 layered state

普通 existing-session 提交在决策 12 的 timer task 恢复后，仍会进入 `conversationStore.appendEnvelopes()`。当输入严格为一条 `REQUEST_ACCEPTED`、`role=USER`、带 `local-optimistic` 且不带 `history-load` 的 envelope，当前 session 已存在 history/live 分层，combined 数量低于 500，分层数量与 combined 一致，并且当前 combined 不含同一 request identity 时，store 直接各追加一次 live 与 combined 数组，同时沿用现有 LRU 更新。该路径保持 history envelope map、history message map 和当前历史数组引用不变，避免为一次本地 optimistic 写入执行 live compaction、history trim、combined dedup、两次 layer filter 和无关 map 复制。

任何前置条件不成立时均继续走既有通用路径：包括 anchored 且仍有 `newerCursor` 的非连续窗口、重复 identity、500 容量边界、未分层或不一致的缓存、edit/retry 形成的其他写入、普通 stream envelope、accumulated snapshot 和 batch。该优化不改变公开 action、store shape、envelope 顺序、dedup/compaction、容量、LRU 或 notification 语义。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 仅修改本地 view state 和样式计算，不接触身份、内容或不可信边界。 | 代码审查、现有前端 build |
| 性能/容量 | 固定列表视口最多渲染现有首屏结果；历史回看沿用现有分页阈值和每次一页的加载约束；live 活动不逐条触发页面渲染，提交生命周期不重建稳定历史，普通 existing-session 提交让出原生输入 task，安全的单条本地 optimistic USER 写入复用历史 state，stream batch 单次构建 session 工作数组，内容增长置底请求按帧合并并复用已测几何。 | Composer/conversation store、session projection/render stability、viewport controller tests、前端 build |
| 可靠性/恢复 | 同步 ref 消除 scroll 与 ResizeObserver 的事件顺序竞态；窗口身份校验阻止过期分页写入；anchored 仅在连续性和物理位置同时成立时收敛。 | viewport/controller/store 事件顺序测试 |
| 可维护性 | 复用现有状态和 helper，不新增平行滚动状态机。 | 定向代码审查 |
| 可测试性 | 使用现有 mock ResizeObserver 和可控 requestAnimationFrame 验证顺序。 | component/hook tests |
| 审计/可追溯性 | 纯浏览器 view state，无新增审计事实。 | 不适用 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| Modal 异步内容切换不改变外框 | 1.1、2.1 | `SkillSelector.test.tsx`、浏览器检查 |
| 短会话不显示置底入口 | 1.2、2.2 | viewport/route-state tests |
| 历史锚定保持返回最新入口 | 1.2、2.2 | route-state tests |
| 非 wheel 上滚先于 ResizeObserver 退出跟随 | 1.3、2.3 | `useChatViewportController.test.tsx` |
| 连续向下加载完更新页且真实到底后退出 anchored | 1.4、2.4 | route-state tests |
| recent 非跟随或 anchored 回看时提交不置底且不增加独立提示 | 1.5、2.5 | route-state tests |
| 窗口替换后忽略过期 older/newer 响应 | 1.6、2.6 | conversation store/route-state tests |
| 有方向滚动触发 older/newer 且程序性滚动不连拉 | 1.7、2.7 | viewport controller/route-state tests |
| live 活动不绕过逐帧更新且旧 turn 不重渲染 | 1.8、1.9、2.8、2.9 | session stream、session projection、MessageList/TurnBlock tests |
| viewport 更新不重渲染旧 turn/Composer、不重建 footer observer，置底只在动画完成后报告物理到底 | 1.10、2.11 | conversation store、MessageList render stability、RightPaneLayout、viewport controller tests |
| 首次 live 和 request 生命周期只更新 latest turn，following 内容增长同帧只置底一次 | 5.1、5.2、5.3、5.4 | session projection、MessageList render stability、viewport controller tests |
| stream frame 调试缓存默认关闭且可显式开启 | 1.9、2.10 | stream debug buffer tests |
| existing-session 提交让出原生输入 task，stream batch 保持等价单次构建，following frame 复用 ResizeObserver 几何 | 7.1、7.2、7.3、7.4 | Composer controller、conversation store、viewport controller tests |
| 单条本地 optimistic USER 写入复用稳定历史 state，边界输入保持通用归一化 | 8.1、8.2 | conversation store tests |
| pending-input 等待暂停 activity timeout，普通恢复仅在权威 activeRun 消失后解锁 | 9.1、9.2 | session stream、route-state tests |
| 前端产物可构建 | 3.1 | `npm run build` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/skill-selector-ui/spec.md`、`openspec/specs/e2e-ui-interaction/spec.md`、`openspec/specs/session-conversation-preview/spec.md`。
- 架构和跨模块设计：无 API 或跨模块变化。
- 模块设计：`openspec/designs/modules/agent-web.md` 主承载三类 viewport 状态的职责边界。
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md` 记录验证入口。

## 风险与取舍（Risks / Trade-offs）

- [搜索结果少于打开时 Skill 数量时列表区可能留白] -> 外框稳定优先，留白仅存在于有界列表视口且下一次打开会重新计算。
- [取消 96px 提前恢复后用户需真正到底才重新跟随] -> 行为更可预测，用户仍可点击置底按钮立即恢复。
- [从很早的锚点持续滚动到最新需要多次分页] -> 只响应用户持续向下意图，失败后由下一次同方向滚动重试，避免程序自动贯穿大量历史记录；用户可随时点击置底按钮直接返回最新。
- [回看期间提交后新请求不会立即出现在当前阅读位置] -> 阅读位置优先；请求继续执行，用户到达最新位置后看到连续结果，不在非连续历史段制造跳转或拼接。
- [历史投影分阶段后 fallback 语义可能漂移] -> `buildSessionProjection()` 继续复用同一阶段函数，并用 combined-only、layered 和 raw-history 既有测试锁定结果。
- [memo 可能读取过期 following 值] -> effect signal 只控制 latest turn 的重渲染，事件和异步回调统一通过稳定 getter 读取 controller ref。
- [existing-session 提交增加一个 task 调度延迟] -> 只作用于普通新提交，使浏览器先提交输入态；若该间隙发生会话切换则安全终止旧提交，不改变 edit/retry 或新会话创建路径。
- [batch 单次构建可能造成去重或 snapshot replacement 漂移] -> 继续使用既有 identity 和 lane key，并用同一 batch 内的重复 identity、连续 snapshot 和普通 delta 组合回归锁定顺序。
- [optimistic 快路径可能绕过容量或去重语义] -> 只允许容量未满、分层一致且 request identity 全新的单条本地 USER 写入命中；重复、容量边界和其他 envelope 全部回退通用路径，并由回归测试锁定。

## 迁移计划（Migration Plan）

无数据或 API 迁移。前端变更可通过回滚对应组件和 hook 修改恢复。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/skill-selector-ui/spec.md`：归并 Modal 几何稳定行为。
- `openspec/specs/e2e-ui-interaction/spec.md`：归并 conversation viewport 跟随和阅读稳定行为。
- `openspec/specs/session-conversation-preview/spec.md`：归并 anchored 连续分页、提交保护、退出条件和过期响应约束。
- `openspec/designs/modules/agent-web.md`：归并状态职责和事件转换。
- `openspec/designs/spec-to-design-map.md`：补充定向测试入口。
- 其他 architecture、ADR 和 overview：无。

## 待确认问题（Open Questions）

无。
