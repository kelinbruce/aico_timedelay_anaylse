## ADDED Requirements

### Requirement: 浏览器过程历史 cache 保持一致且有界

TS frontend MUST 将 process-history 状态和已校验 event envelope 作为一个 `sessionId + runId` cache 事实保留，并 MUST 将两者一起驱逐。event envelope 已被驱逐的 run MUST NOT 继续以 `AVAILABLE` cached run 的形式可观察。

在正常落定的加载结果之后，只有 `VIEWPORT`、`PRELOAD`、当前 preview、active request 或 live run MAY 继续保持一个 run pinned。在存活的 session 期间，每个已启动的 run-event request（无论由 `EXPLICIT`、`VIEWPORT`、`PRELOAD` 还是 preview 选择）MUST 保持 active-request pin 直到正常结果。折叠/移出视口、自动目标替换、preview 替换和导航 generation 取代 MUST 只移除排队/未启动的工作，MUST NOT 中止已启动的请求。显式溢出 MUST 只替换最旧的排队或未启动 generation，释放该 generation 的 expansion demand/pin 并保留 disclosure 视图状态。如果该 turn 仍保持展开并稍后重新进入有效 demand 资格，frontend MUST 在再次入队前创建一个新的 generation。

cache MUST 允许 pinned 事实临时超过容量。在一个 run 的最后一个 pin 释放时，frontend MUST 同步执行整个 run 的 least-recently-used 上限：session 内至多 64 个未 pin 的 `AVAILABLE` run 和至多 2,000 个未 pin envelope。它 MUST 原子地驱逐一个 run 的状态及其全部 envelope，MUST NOT 只截断单个 run 的一部分。`lastAccessedAt` MAY 只在 `AVAILABLE` 结果成功提交（包括 retry 成功）时，或在一个 cached `AVAILABLE` run 在有效 demand 集合中从缺席变为存在并被实际复用时改变。调度 retry、observer 发布、渲染或快照读取、仅 pin 的变化以及同 generation 目标刷新 MUST NOT 改变 recency。

#### Scenario: 其他 run 加载后已缓存过程仍可检查
- **GIVEN** 一个已完成 turn 拥有一个带已完成 thinking 的 `AVAILABLE` cached run
- **WHEN** 更多 turn 的 event 页面完成加载
- **THEN** 只要该 run 仍被缓存，重新打开第一个 turn MUST 仍显示其已完成的 thinking
- **AND** 加载另一个 run MUST NOT 在移除第一个 run 的 event envelope 的同时让其状态保持 `AVAILABLE`

#### Scenario: 被驱逐的 run 可再次加载
- **GIVEN** 一个离屏、未展开的 run 被选中进行 cache 驱逐
- **WHEN** 驱逐完成
- **THEN** 其 cached 状态和 event envelope MUST 均不存在
- **WHEN** 该 turn 稍后重新进入真实 viewport 或用户显式展开它
- **THEN** frontend MUST 允许为该 run 发起新的事件查询

#### Scenario: 当前 demand 和 active request 保持 pinned
- **WHEN** cache 容量被超出
- **THEN** frontend MUST NOT 驱逐由 viewport、preload、当前 preview、active request 或 live-run demand 选中的 run
- **AND** 它 MUST 只选择未 pin 的 run 进行容量驱逐

#### Scenario: 最后一个 pin 释放立即执行整 run 上限
- **GIVEN** pinned run 已临时超过 64 个未 pin 的 available run 或 2,000 个未 pin envelope
- **WHEN** 一个 run 的最后一个 pin 被释放
- **THEN** 同一可观察 cache 快照 MUST 包含至多 64 个未 pin 的 available run 和 2,000 个未 pin envelope
- **AND** 每个被驱逐 run 的状态和 envelope MUST 一起消失

#### Scenario: 读取与 retry 调度不改变 recency
- **GIVEN** 一个未 pin 的 cached `AVAILABLE` run 和一个 `FAILED` run
- **WHEN** available run 被反复渲染或读取，且为 failed run 调度 retry
- **THEN** 任一动作 MUST NOT 改变 cache recency
- **WHEN** retry 稍后提交 `AVAILABLE`，或一个此前缺席的 demand 开始实际复用该 cached available run
- **THEN** 该成功提交或实际复用 MUST 更新 recency

## MODIFIED Requirements

### Requirement: 浏览器按可见 turn run hydrate 过程事件

TS frontend SHALL 用可见消息事实和该 turn display run 的持久化事件事实组合出一个已完成 turn。对每个 root turn，frontend MUST 优先使用最新可见 assistant message 的 `runId`；当不存在可见 assistant message 时，MUST 使用该 root 最新可见的非 summary 消息 `runId`。自动 event hydration MUST 只选择由当前显式用户意图、真实会话 viewport 或在真实 viewport 上下各至多延伸一个会话 viewport 高度的 bounded preload 区域产生的未缓存 display run。仅加载一个 message window MUST NOT 选中该窗口内的每个 run。

显式展开的 process panel 和当前 preview-navigation 目标 MUST 拥有高于真实 viewport 和仅 preload run 的 hydration 优先级。Preview 悬停 MUST NOT 选择 run。当消息派生 envelope 省略 canonical `requestContextId` 但携带所选显式 `runId` 时，该 `runId` MUST 与 event-history envelope 标识同一尝试以供组合；requestId fallback MUST NOT 丢弃所选 run 事件。携带其他 `runId` 的事件 MUST NOT 进入该 turn。

当一个持久化完成的 `LLM_THINKING_DELTA` 与一个基础 live 或已落定 thinking envelope 在同一 `sessionId + runId + rootMessageId` 内共享同一非空 `stepId` 时，持久化事件 MUST 是 canonical 投影事实，基础副本 MUST NOT 创建另一个过程条目。不同的非空 `stepId` 值 MUST 保持不同，即使它们的 thinking 文本相同。当任一候选缺少非空 `stepId` 时，frontend MUST 只使用精确 `eventId` 去重，MUST NOT 从文本、相邻 sequence 或 segment ordinal 推断等价性。

#### Scenario: 冷历史重建已完成 thinking 过程
- **WHEN** 一个已完成 turn 进入真实会话 viewport
- **AND** 其可见 assistant message 标识一个 `runId`
- **AND** 该 run event history 包含一个已完成 thinking delta 和持久化 capability lifecycle 事件
- **THEN** frontend MUST 将这些 event envelope 与同一 root turn 的消息派生 envelope 组合
- **AND** process panel MUST 包含与完成 live 视图相同的已完成 thinking 文本和持久化过程顺序
- **AND** 最终回答 MUST 仍只来自 assistant message

#### Scenario: 持久化已完成 thinking 替换 live 副本
- **GIVEN** 一个已完成 turn 仍保留 live 的部分或已完成 thinking envelope
- **WHEN** run-event hydration 返回一个具有相同非空 `stepId`、session、run 和 root 的持久化已完成 `LLM_THINKING_DELTA`
- **THEN** process panel MUST 恰好渲染该逻辑 thinking step 一次
- **AND** 重连、replay 或重复历史组合 MUST NOT 创建另一个 thinking card

#### Scenario: 来自不同 step 的相同 thinking 文本保持不同
- **WHEN** 一个 run 包含具有不同非空 `stepId` 且文本相同的已完成 thinking 事件
- **THEN** process panel MUST 为每个 `stepId` 保留一个条目
- **AND** MUST NOT 用文本相等性合并它们

#### Scenario: 不猜测缺少稳定 step 身份的 thinking
- **WHEN** 一个 live 或持久化 thinking envelope 缺少非空 `stepId`
- **THEN** frontend MUST 只在其精确 `eventId` 已存在时对其去重
- **AND** MUST NOT 从文本、相邻 sequence 或 segment ordinal 推断身份

#### Scenario: 消息历史省略 canonical request context
- **WHEN** 可见用户和 assistant message 携带所选 `runId` 但不暴露 `requestContextId`
- **AND** 所选 run event 页面携带其 canonical `requestContextId` 和同一显式 `runId`
- **THEN** frontend MUST 将消息派生回答与事件派生过程保留在一个可见尝试中
- **AND** MUST NOT 因消息 adapter 回退到 `requestId` 而丢弃已完成 thinking

#### Scenario: Retry 历史选择可见尝试
- **WHEN** 一个 root turn 既包含旧尝试的事件又包含来自较新 retry run 的可见 assistant message
- **THEN** 自动历史 hydration MUST 查询较新的可见 `runId`
- **AND** MUST NOT 将旧尝试事件加入该 turn

#### Scenario: 无 assistant 的失败 turn 使用其可见 run
- **WHEN** 一个可见的失败 turn 没有 assistant message 但其可见非 summary 消息包含 `runId`
- **THEN** frontend MUST 使用该 run 加载持久化失败过程
- **AND** MUST NOT 虚构 assistant 回答

#### Scenario: Capability lifecycle 加入持久结果内容
- **WHEN** 一个所选 run event 页面包含 capability lifecycle envelope 且可见消息页包含匹配的 `CAPABILITY_RESULT` 消息
- **THEN** 过程条目 MUST 保留来自 event history 的事件顺序和终态
- **AND** MUST 只将消息内容用于匹配的 run 和 tool 关联
- **AND** MUST NOT 创建重复的 tool card

#### Scenario: Capability result 消息缺失
- **WHEN** 一个所选 run 的 capability terminal 事件没有匹配的可见 `CAPABILITY_RESULT` 消息
- **THEN** 过程条目 MUST 显示安全的结果不可用状态
- **AND** MUST NOT 将 terminal 状态文本呈现为 capability result 正文

#### Scenario: 消息窗口包含离屏 run
- **GIVEN** 一个已加载 message window 包含真实 viewport 和 bounded preload 区域之外的 display run
- **WHEN** 没有 process panel 或 preview 导航显式指向这些 run
- **THEN** frontend MUST NOT 查询其 event history
- **AND** 窗口中已提交的消息 MUST 保持可用

#### Scenario: 显式面板展开优先
- **GIVEN** 一个历史 turn 的 process history 未缓存
- **WHEN** 用户展开该 turn 的 process panel
- **THEN** frontend MUST 以最高 hydration 优先级选择该 run
- **AND** 事件查询 MUST 复用同一 `sessionId + runId` 的任何现有 in-flight 请求

### Requirement: 事件历史分页完整且有界

对一个所选 run，TS frontend SHALL 请求带 `afterSequence=0` 和 `limit=1000` 的 `GET /api/v1/sessions/:sessionId/runs/:runId/events`，然后跟随每个严格前进的 `nextAfterSequence` 直到 cursor 缺失。它 MUST 将重复或不前进的 cursor 判定为失败的 process 加载。

在同一 session 内，frontend MUST 保持至多四个在途 run event 请求、至多十六个自动 `VIEWPORT` 加 `PRELOAD` hydration 目标，以及至多十六个以 `sessionId + runId` 为键去重的 `EXPLICIT` 意图。自动目标 MUST 由最新 viewport generation 替换。显式目标 MUST 按单调递增的意图 generation 排序且最新意图优先。显式溢出时，frontend MUST 只替换最旧的排队或未启动显式 generation，释放该 generation 的 expansion demand/pin 并保留该 turn 的 disclosure 状态。如果该 turn 仍保持展开并稍后重新具备 demand 资格，frontend MUST 在重新入队前创建一个新的 generation。在存活的 session 期间，一个已激活的请求 MUST 保持 active-request pin 直到其加载结果，即使其显式意图已不在最新十六个之内。

同一 `sessionId + runId` 的所有请求 MUST 合并为一个已注册的 active request 身份。当 session 存活且完成身份仍与该 run 已注册的 active 身份匹配时，一个已校验完成 MUST 提交其 run-scoped cache/outcome，即使其来源目标 generation 已不是当前 generation。该提交 MUST NOT 恢复过时目标、preview pin 或 navigation token，MUST NOT 移动 viewport。只有 session teardown 或 active 身份不匹配 MUST 丢弃一个完成。身份不匹配 MUST NOT 释放或覆盖当前已注册请求的 slot 或 pin。一个匹配且正常落定的完成 MUST 在提交或安全结果处理之后释放其自身 slot 和 active-request pin。

只有 `FAILED` MUST 暴露用户 retry，且 retry MUST 创建一个新的最新显式 generation 而不在调度时改变 cache recency。`LEGACY_UNAVAILABLE` MUST 是终态，MUST NOT 暴露 retry 控件或发出 retry 请求。Session teardown MUST 取消排队和在途工作，释放所有 session demand/pin，并且不发布新的 `AVAILABLE`、`FAILED` 或 `LEGACY_UNAVAILABLE` UI 结果。

#### Scenario: Run 过程跨多个页面
- **WHEN** 一个 AVAILABLE 事件响应包含 `nextAfterSequence`
- **THEN** frontend MUST 使用该精确 cursor 请求下一页
- **AND** MUST 按 canonical sequence 顺序合并所有页面且不重复 `eventId`
- **AND** MUST 只在 `nextAfterSequence` 缺失时停止

#### Scenario: cursor 不前进
- **WHEN** 一个 run event 响应重复或减小 `nextAfterSequence`
- **THEN** frontend MUST 停止分页
- **AND** MUST 将该 run 过程历史标记为失败
- **AND** MUST 保留已提交的会话消息

#### Scenario: 当前 viewport 包含多个 run
- **WHEN** 多于四个不同的 display run 仍是当前 hydration 目标
- **THEN** frontend MUST 保持至多四个在途 run event HTTP 请求
- **AND** MUST 按显式展开或 preview 目标、真实 viewport、然后 preload 区域的顺序排列排队工作
- **AND** MUST 只在某个排队 run 仍处于当前目标集合内时最终处理它

#### Scenario: 十七个显式意图保留最新十六个
- **GIVEN** 四个较早的显式意图已启动并保持 active
- **WHEN** 至少十七个较新的显式意图按递增 generation 顺序发布
- **THEN** 调度器 MUST 至多保留最新十六个排队或未启动的显式意图
- **AND** MUST 首先替换最旧的排队或未启动显式意图
- **AND** 替换 MUST 释放每个被移除 generation 的 expansion demand/pin 而不改变其 turn disclosure
- **AND** 在 session 保持存活期间，四个 active 请求 MUST 保持 pinned 直到各自到达一个加载结果

#### Scenario: 被替换的已展开 turn 重新获得资格
- **GIVEN** 显式容量替换了一个排队 generation 而其 panel 仍保持展开
- **WHEN** 该 turn 稍后进入 viewport、preload 或另一个有效 demand 来源
- **THEN** frontend MUST 保持该 panel 展开
- **AND** MUST 在重新入队该 run 前创建一个较新的显式 generation

#### Scenario: 展开 demand 在每种结果上释放
- **GIVEN** 一次展开选择了一个历史 run 且其 panel 稍后折叠或移出视口
- **WHEN** 该 run 到达 `AVAILABLE`、`FAILED` 或 `LEGACY_UNAVAILABLE`
- **THEN** 其展开显式目标和展开 pin MUST 被释放
- **AND** 只有 `FAILED` MUST 允许创建较新显式 generation 的 retry
- **AND** `LEGACY_UNAVAILABLE` MUST NOT 发出 retry 请求

#### Scenario: 快速滚动条拖拽跨越多个 turn
- **GIVEN** 用户在会话滚动 viewport 上开始一次指针拖拽
- **WHEN** 指针在释放前跨越超过十六个未缓存历史 turn
- **THEN** frontend MUST NOT 将每个被跨越的 run 入队
- **AND** 指针释放后，它 MUST 用来自最终真实 viewport 和 bounded preload 区域的 run 替换自动目标集合
- **AND** 在途请求数量 MUST 保持至多四个

#### Scenario: 滚轮滚动持续改变 viewport
- **WHEN** 滚轮或触控板滚动在一个动画帧内产生多个滚动事件
- **THEN** frontend MUST 为该帧至多计算一次 hydration 目标更新
- **AND** 从最新目标集合移除的 run MUST NOT 保持排队

#### Scenario: 自动替换不中止已启动工作
- **GIVEN** 已启动请求分别由 viewport、preload 和 preview 选择
- **WHEN** 一个较新的自动集合和导航 generation 取代全部三个来源目标
- **THEN** frontend MUST 只移除排队或未启动的工作
- **AND** 每个已启动请求 MUST 保持其 active-request pin 直到正常结果

#### Scenario: 过时 generation 提交 cache 而不恢复意图
- **GIVEN** 一个已启动请求的目标 generation 已不是当前 generation
- **WHEN** 其已校验完成与该 run 已注册的 active request 身份匹配
- **THEN** frontend MUST 提交 run-scoped cache/outcome 并释放该请求的 slot 和 pin
- **AND** MUST NOT 恢复旧目标、preview pin 或 navigation token
- **AND** MUST NOT 移动 viewport

#### Scenario: 不匹配的迟到完成被丢弃
- **GIVEN** 一个 run 已注册新的 active request 身份
- **WHEN** 来自较旧请求身份的一个迟到完成到达
- **THEN** frontend MUST 丢弃该完成
- **AND** MUST NOT 释放或覆盖当前请求的 slot、pin 或 cache

### Requirement: 历史 hydration 按 session 和加载版本隔离

TS frontend SHALL 按 `sessionId + runId` 划分 process-history cache、在途工作、错误和 retry 状态的作用域。Preview 导航、显式意图、权威会话加载和 viewport 选择 MUST 标识其最新 generation。较新的 generation MUST 移除过时的排队工作，但在 session 存活期间 MUST NOT 取消已启动的工作。Session teardown 是唯一 MAY 取消在途工作的目标生命周期动作；它 MUST 移除全部排队工作，释放每个 demand/pin 并清理调度器状态而不产生 UI 结果。完成提交资格 MUST 取决于存活的 session 加上已注册 active request 身份与校验，而不取决于来源目标 generation。交互 generation 继续守护导航和目标副作用。

#### Scenario: hydration 期间用户切换 session
- **WHEN** session A 有在途事件请求且用户激活 session B
- **THEN** 迟到的 session A 响应 MUST NOT 进入 session B 的 envelope 或过程状态
- **AND** session B MUST 只 hydrate 其自身当前目标

#### Scenario: Session teardown 取消全部 hydration 生命周期状态
- **GIVEN** 一个 session 有排队显式意图、active 请求和 pinned run
- **WHEN** frontend 清理或销毁该 session
- **THEN** 它 MUST 移除队列、中止每个在途请求并释放全部 demand/pin
- **AND** 迟到响应 MUST 被忽略
- **AND** 取消 MUST NOT 发布新的 `AVAILABLE`、`FAILED` 或 `LEGACY_UNAVAILABLE` UI 结果

#### Scenario: 较新 preview 导航取代较旧目标
- **WHEN** 用户选择 preview 目标 A，并在 A 完成前选择 preview 目标 B
- **THEN** 目标 B MUST 成为当前导航 generation
- **AND** 目标 A 独有的排队工作 MUST 被移除
- **AND** A 的迟到结果 MUST NOT 移动 viewport、替换目标 B 的 turn 或进入另一个 run

#### Scenario: 加载较旧或 anchored message window
- **WHEN** 分页或 anchor 导航新增此前未见过的 display run
- **THEN** frontend MUST 只选择显式意图、所产生的真实 viewport 或其 bounded preload 区域所需的未缓存 run
- **AND** MUST 保留 session 中其他 run 已缓存的有效 event history

#### Scenario: 移除过时排队工作而不取消已启动工作
- **WHEN** 一个 viewport 或导航 generation 变为过时
- **THEN** frontend MUST 移除其排队或未启动的工作而不显示 process-history 失败
- **AND** MUST 让其已启动请求在 active 身份提交规则下落定
- **AND** 已提交消息和任何先前有效的过程 cache MUST 保持不变，直到一个已校验完成提交

#### Scenario: 离屏 disclosure 状态独立于 cache 状态
- **GIVEN** 一个已展开 panel 的 run 已到达 `AVAILABLE` 并在稍后成为未 pin 的离屏状态
- **WHEN** LRU 驱逐该 run
- **THEN** frontend MUST 保留该 panel 的展开 disclosure 状态
- **WHEN** 该 turn 返回 viewport 或 preload demand
- **THEN** frontend MUST 保持该 panel 展开并为缺失的 run cache 恰好发出一次重新加载
