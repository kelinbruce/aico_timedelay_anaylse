# e2e-ui-interaction Specification

## Purpose
Defines browser-observable interaction, stream rendering, session management, and lifecycle behavior for the Agent Web user journey.
## Requirements
### Requirement: User Input Reply

系统 SHALL 在前端呈现 Composer，用户提交后通过 backend bootstrap 选择的 SSE 或 WebSocket transport 实时渲染模型回复。Transport 选择 MUST NOT 改变用户可见的 text delta、过程投影和 terminal 收敛语义。

#### Scenario: 问答交互使用当前 transport
- **WHEN** 用户在 Composer 输入问题并提交
- **THEN** 前端 SHALL 使用 backend bootstrap 选择的 Web stream transport 渲染回复
- **AND** SSE 与 WebSocket SHALL 产生等价的用户可见 stream 结果

### Requirement: SSE Stream Consumption

系统 SHALL 通过当前配置的 SSE 或 WebSocket transport 消费共享 `StreamEnvelope` 投影，包括 text delta、Capability/process entry 和 terminal event。

#### Scenario: 配置的 Web stream 被正确消费
- **WHEN** backend bootstrap 选择 SSE 或 WebSocket 且 request 产生 stream events
- **THEN** 前端 SHALL 实时合并 text delta
- **AND** SHALL 以当前过程视图呈现 Capability 生命周期
- **AND** terminal event SHALL 正确收敛 UI 状态

### Requirement: Tool Call Render

系统 SHALL 将 Capability/tool 执行呈现为可视化过程条目，展示名称和生命周期状态。有受支持的 `safeResult` 时，前端 SHALL 使用对应的结构化详情；没有受支持的 `safeResult` 或当前安全失败详情，但存在非空且非通用的 `safeSummary` 时，前端 SHALL 使用该摘要。缺少上述受支持安全字段时，本 capability 不定义或保证详情 fallback 行为。

#### Scenario: 工具调用展示当前投影
- **WHEN** 模型发起并完成一个 Capability/tool 调用
- **THEN** 前端 SHALL 展示调用名称和生命周期状态
- **AND** MAY 展示安全结构化投影产生的摘要或详情

#### Scenario: Safe result 优先于其他安全摘要
- **GIVEN** Capability result 包含当前支持的 `safeResult`
- **WHEN** 前端生成过程详情
- **THEN** SHALL 使用该结构化安全投影
- **AND** SHALL NOT 用同一事件的其他摘要覆盖它

#### Scenario: Safe summary 在没有受支持 safe result 时作为摘要
- **GIVEN** Capability result 不包含受支持的 `safeResult` 或当前安全失败详情，但包含非空且非通用的 `safeSummary`
- **WHEN** 前端生成过程详情
- **THEN** SHALL 使用该 `safeSummary` 作为摘要

### Requirement: Session Management UI

系统 SHALL 支持前端会话管理，包括进入新会话状态、首次提交时建立会话，以及切换、删除和重命名已有会话。新会话入口 SHALL 进入未持久化会话的 pre-session 状态；在该状态首次执行合法普通提交时，前端 MUST 先成功建立并激活会话，再把该输入作为该会话的首个 request 提交。会话建立失败时，前端 MUST NOT 提交 request，并 MUST 保留可重试的 Composer 输入。已有 active session 的普通提交 MUST 复用该会话且 MUST NOT 建立另一会话。附件选择、绑定和提交顺序继续由 `agent-web-attachment-composer` 拥有，本 requirement 不重新定义该路径。

#### Scenario: 新会话入口保持 pre-session 状态
- **WHEN** 用户进入新会话状态但尚未执行合法普通提交
- **THEN** 前端 MUST NOT 仅因进入该状态而持久化空会话

#### Scenario: 根路由首次普通提交先建立会话
- **GIVEN** 当前页面处于没有 active session 的 pre-session 状态
- **WHEN** 用户执行合法普通提交
- **THEN** 前端 MUST 先成功建立并激活一个会话
- **AND** MUST 再把该输入作为该会话的首个 request 提交

#### Scenario: 会话建立失败时保留输入
- **GIVEN** 当前页面处于没有 active session 的 pre-session 状态
- **WHEN** 用户执行合法普通提交但会话建立失败
- **THEN** 前端 MUST NOT 提交 request
- **AND** MUST 保留 Composer 输入供用户重试

#### Scenario: 已有会话不重复建立
- **GIVEN** 当前页面已有 active session
- **WHEN** 用户执行合法普通提交
- **THEN** 前端 MUST 在该 active session 中提交 request
- **AND** MUST NOT 为该提交建立另一会话

#### Scenario: 已有会话操作更新会话视图
- **WHEN** 用户切换、重命名或删除已有会话
- **THEN** 对应操作 SHALL 正确执行
- **AND** 会话视图 SHALL 反映操作结果

### Requirement: Auth Settings UI

系统 SHALL 支持当前 local auth 入口的登录、认证 challenge 恢复和登出。当前 sidebar settings SHALL 只提供已实现的语言与 light/dark/system 主题偏好。Agent Web SHALL NOT 在该要求下承诺不存在的 API Key 配置或模型选择 UI；模型与凭据配置由当前 runtime/app configuration owner 管理。

#### Scenario: 登录与登出更新认证状态
- **WHEN** 用户通过当前认证入口登录或登出
- **THEN** 前端 SHALL 更新认证会话状态
- **AND** 后续受保护请求 SHALL 使用当前认证状态

#### Scenario: 不呈现未实现的 API Key 和模型设置
- **WHEN** 用户打开当前认证相关 UI
- **THEN** Agent Web SHALL NOT 因本要求提供 API Key 配置或模型选择入口

#### Scenario: Local settings only expose current preferences
- **WHEN** 用户打开 local sidebar settings
- **THEN** Agent Web SHALL 提供语言与 light/dark/system 主题偏好
- **AND** SHALL NOT 把这些偏好误写成模型或凭据配置

### Requirement: Live envelope lifecycle SHALL preserve completed Turns without destructive session eviction

Agent Web MUST retain every visible completed Turn and every non-redundant process detail accepted in the current page lifecycle independently from the number of raw stream envelope objects received. The value 500 MUST be used only as the trigger for lossless active-stream compaction and MUST NOT be used as a maximum message count, Run count, Turn count, DOM count or destructive retained-event limit. Accumulated snapshots and incremental text belonging to the same exact stream lane MUST be replaced or merged only when the resulting visible content and process meaning are equivalent. Events that cannot be proven equivalent MUST remain available after compaction even when the compacted bucket contains more than 500 envelope objects.

#### Scenario: More than 500 session envelopes do not remove earlier completed Turns
- **GIVEN** a continuous recent conversation view contains completed Turns produced during the current page lifecycle
- **WHEN** accepted live envelopes for the session exceed 500 objects and later requests continue to complete
- **THEN** every earlier visible completed Turn MUST remain rendered
- **AND** its accepted answer, terminal state and process-detail affordances MUST remain available
- **AND** the frontend MUST NOT require a conversation refresh after each terminal to preserve those Turns

#### Scenario: One Run exceeds 1000 effective events
- **WHEN** one Run produces more than 1000 accepted stream events, including non-redundant structural process events
- **THEN** the frontend MUST preserve the complete accumulated answer
- **AND** every non-redundant structural event that contributes a distinct process entry MUST remain available in the full-process presentation
- **AND** the frontend MUST NOT silently retain only the final 500 envelope objects

#### Scenario: Interleaved capability result lanes remain independent
- **GIVEN** one Run produces interleaved capability result deltas for distinct tool or capability invocation identities
- **WHEN** active-stream compaction is triggered
- **THEN** deltas from different invocation identities or attempts MUST NOT be merged into one result lane
- **AND** thinking or capability result deltas separated by a sequence gap MUST NOT be merged across that gap
- **AND** compaction MUST preserve the visible result text, invocation association and process-entry order of every lane

#### Scenario: Settled Turns remain stable while a later Turn streams
- **GIVEN** the current recent view contains settled live Turns
- **WHEN** a later active Turn receives one or more live batches
- **THEN** only the matching active Turn projection MUST change because of those batches
- **AND** unchanged settled and historical Turn component references MUST remain stable
- **AND** the frontend MUST NOT rescan or rebuild every settled Turn as part of the active append path

#### Scenario: Live-only Turn order remains stable before committed ordering arrives
- **GIVEN** the current continuous recent view contains multiple roots accepted during the current page lifecycle that are not yet present in committed history
- **WHEN** those roots pass through optimistic identity reconciliation or active-to-settled transition
- **THEN** their visible Turn order MUST remain consistent with the order in which the roots first entered the session projection
- **AND** identity reconciliation MUST NOT move a Turn or create a duplicate Turn

#### Scenario: Committed history takes ownership of matching Turn order
- **GIVEN** the current continuous recent view contains live-only roots ordered by their first projection acceptance
- **WHEN** committed history later contains a matching root
- **THEN** committed message sequence MUST own that root's canonical position without creating a duplicate Turn

#### Scenario: Anchored view isolates display without discarding accepted stream data
- **GIVEN** the user is reviewing an anchored history window with a remaining `newerCursor`
- **WHEN** the user submits a request and the frontend receives its live and terminal envelopes
- **THEN** the anchored window and reading position MUST remain unchanged
- **AND** the new Turn MUST NOT be inserted into the non-continuous anchored message segment
- **AND** the frontend MUST retain the accepted active and settled live data for the session
- **WHEN** the user explicitly returns to a continuous recent window
- **THEN** the retained Turn and its accepted process detail MUST participate in the recent projection without requiring per-terminal conversation reconciliation

#### Scenario: Session lifecycle cleanup does not create partial retained state
- **WHEN** the user explicitly clears a conversation or the session is evicted from the bounded frontend session cache
- **THEN** history, active live and settled live data for that session MUST be removed together
- **AND** no orphan active or settled process detail MUST remain available under that session identity

### Requirement: Multi-question pending input uses one-question-at-a-time navigation

当 active `QUESTION` pending input 包含多个已接受问题时，agent-web MUST 在现有 response surface 中一次只呈现一个问题，并显示当前序号和问题总数。frontend MUST 在本地保存各题尚未提交的 answer draft，允许用户返回前一题检查或修改；翻页 MUST NOT 调用 answer route、创建新 request、创建额外 pending input、重新建立 stream 或推进原 run。

“下一步” MUST 复用当前问题类型的既有有效性规则：自由输入要求一个非空值，单选要求一个有效选择，多选要求一个或多个唯一选择，custom 激活时要求非空 custom text。当前题无效时不得进入下一题。最终提交只可在最后一题且全部问题有效时发生，并 MUST 通过现有 pending-input answer route 一次提交按问题顺序排列的完整 `answers[][]`。

frontend MUST NOT 仅因为 runtime 已接受的问题数超过 model-facing 3 题约束而拒绝显示或提交；它必须支持系统在 20 项技术边界内兜底接收的 pending input。该兼容能力不得改变模型每次最多 3 题的正常契约，也不得在 UI 中把 20 题宣传为建议额度。单问题交互 MUST 保持现有直接填写和提交行为。pending input id 变化时，页码和草稿 MUST 一起重置；页面刷新后的未提交草稿 MAY 重置，因为其仍是 frontend view state，不是 durable execution fact。

进度、上一步、下一步和最终提交 MUST 具有可访问名称并可通过键盘操作。切换问题后，焦点 MUST 移到新问题的 prompt 或首个输入控件，避免键盘与屏幕阅读器用户停留在已经隐藏的页面。

#### Scenario: Four-question input is answered one question at a time

- **WHEN** active pending input 包含 4 个有效问题
- **THEN** response surface MUST 只渲染当前一个问题并显示 `1 / 4`
- **AND** 第一题未完成时“下一步” MUST 不可用
- **WHEN** 用户完成当前题并逐题前进
- **THEN** 每次翻页 MUST 只改变本地页码并保留已填写草稿
- **AND** focus MUST move to the newly visible question
- **AND** 页面 MUST NOT 在翻页时发送 answer、conversation、request 或额外 stream 请求

#### Scenario: Previous navigation preserves editable drafts

- **GIVEN** 用户已经回答前两题并进入第三题
- **WHEN** 用户返回第一题
- **THEN** 第一题与第二题的草稿 MUST 保持可见
- **AND** 用户 MUST 能修改第一题后再次前进
- **AND** 最终提交 MUST 使用修改后的完整 ordered `answers[][]`

#### Scenario: Final page submits all answers once

- **GIVEN** 一个多问题 pending input 的全部问题均已有效回答
- **WHEN** 用户在最后一题触发提交
- **THEN** frontend MUST 通过现有 answer route 发送恰好一个 answer request
- **AND** request MUST 按原始问题顺序包含全部 answer groups
- **AND** frontend MUST NOT 为每道题分别提交或创建多个 pending input

#### Scenario: Submit failure keeps the current questionnaire state

- **WHEN** 最终 answer request 返回安全错误
- **THEN** response surface MUST 保留当前页码与全部本地草稿
- **AND** 用户 MUST 能修正答案或重试提交
- **AND** frontend MUST NOT 自动跳到第一题、丢弃已填内容或创建新的 run

#### Scenario: Twenty fallback-accepted questions remain usable without rendering all at once

- **WHEN** runtime 投影包含 20 个已接受问题
- **THEN** agent-web MUST 支持从第一题导航到最后一题
- **AND** 任一时刻 MUST 只渲染当前问题的输入控件
- **AND** 导航与最终操作 MUST 保持可达，页面不得因同时铺开全部问题而溢出或冻结

#### Scenario: Single question retains direct interaction

- **WHEN** active pending input 只包含一个问题
- **THEN** response surface MUST 直接显示该问题与最终提交动作
- **AND** frontend MUST NOT 显示无意义的上一步或下一步流程

### Requirement: Conversation viewport SHALL separate latest following from physical bottom position

最新会话窗口 MUST 分别维护自动跟随策略和物理底部位置。只有用户已退出自动跟随且物理位置不在底部时，前端 MUST 显示普通置底按钮。消息不足以滚动、内容收缩后已经到底、或前端仍在自动跟随时，普通置底按钮 MUST NOT 显示。历史锚定窗口不等同于最新会话窗口；历史锚定期间 MUST 使用同一个置底按钮表达“回到最新消息”，不得增加独立的新消息提示。该入口保持到用户显式返回最新窗口，或用户持续主动向下滚动、耗尽全部 `newerCursor` 分页并真正到达当前连续消息段底部。

#### Scenario: 短会话不显示置底按钮
- **WHEN** 最新会话窗口包含消息但内容高度不超过可见区域
- **THEN** 前端 MUST NOT 显示普通置底按钮

#### Scenario: 用户离开底部后显示置底按钮
- **WHEN** 用户在最新会话窗口真实向上滚动并且物理位置不在底部
- **THEN** 前端 MUST 退出自动跟随
- **AND** MUST 显示普通置底按钮

#### Scenario: 历史锚定显示返回最新入口
- **WHEN** 用户正在浏览不保证包含最新消息的历史锚定窗口
- **THEN** 前端 MUST 显示“回到最新消息”入口
- **AND** 前端 MUST NOT 同时显示独立的新消息 banner、badge、计数或提示文案
- **AND** `newerCursor` 仍存在时，历史窗口的物理底部 MUST NOT 转换为最新消息跟随状态

#### Scenario: 最后一个更新页加载后仍等待用户真正到底
- **GIVEN** 用户通过主动向下滚动加载历史锚定窗口的更新分页
- **WHEN** 最后一个更新页使 `newerCursor` 变为 `null`，但用户尚未到达当前连续消息段的物理底部
- **THEN** 前端 MUST 保持历史锚定状态和“回到最新消息”入口
- **WHEN** 用户继续主动向下滚动并到达物理底部
- **THEN** 前端 MUST 清除活动锚点并进入最新消息底部跟随状态

#### Scenario: 程序性滚动不得退出历史锚定
- **WHEN** Preview 定位、分页追加或异步布局变化以程序方式改变历史锚定窗口的滚动位置
- **THEN** 前端 MUST NOT 仅因该位置变化退出历史锚定

### Requirement: User upward scrolling SHALL preserve the reading position during asynchronous layout growth

用户通过滚轮、滚动条、触摸或键盘真实向上滚动时，前端 MUST 在同一滚动事件处理中退出自动跟随并取消待执行的置底动作。随后发生的流式内容、执行详情或其他异步布局增高 MUST 保持用户的阅读锚点，MUST NOT 把视口重新拉回底部。最新会话窗口只有在用户到达物理底部或点击置底入口时才能恢复自动跟随。提交新消息、编辑后提交或提交完成回调 MUST 保留提交发生时仍然有效的跟随策略：已在跟随时可以继续置底，recent 非跟随回看和历史锚定回看时都 MUST 保持当前阅读位置。

#### Scenario: 非滚轮上滚与内容增高竞态不抢占位置
- **WHEN** 用户通过滚动条、触摸或键盘向上移动视口，且在下一帧滚动状态计算前内容高度增加
- **THEN** 前端 MUST 保持用户上滚后的位置
- **AND** MUST NOT 执行待处理的底部固定

#### Scenario: 用户真实到达底部后恢复跟随
- **WHEN** 用户在最新会话窗口滚动到物理底部容差范围内
- **THEN** 前端 MUST 恢复自动跟随
- **AND** 后续新增内容 MUST 保持视口位于底部

#### Scenario: 回看期间提交不抢占阅读位置
- **GIVEN** 用户正在 recent 非跟随窗口或历史锚定窗口回看消息
- **WHEN** 用户提交新消息或编辑后提交
- **THEN** 前端 MUST 保持当前窗口和滚动位置
- **AND** 历史锚定窗口 MUST 同时保留活动锚点
- **AND** MUST NOT 自动执行置底或切换到底部跟随
- **AND** 用户仍可通过现有置底按钮显式前往底部或返回最新

#### Scenario: 提交等待期间上滚阻止迟到置底
- **GIVEN** 用户从 recent 底部提交消息
- **WHEN** 用户在提交调用完成前向上滚动并退出自动跟随
- **THEN** 提交完成回调 MUST NOT 把视口重新拉回底部

### Requirement: Live conversation projection SHALL preserve long-session input responsiveness

长会话接收 live stream 更新时，前端 MUST 复用既有逐帧 delta 投影边界，MUST NOT 对每条 envelope 触发页面级渲染。未变化的历史 turn MUST 保持投影与组件引用稳定；viewport following 或 at-bottom 状态变化 MUST NOT 使全部旧 turn 或 Composer 重渲染，也 MUST NOT 重建 overlay footer 高度监听。显式置底 MUST 保留现有过渡时长，并且 MUST 只在视口真实到达底部后提交物理到底状态；程序性动画帧 MUST NOT 逐帧广播页面级 scroll state。request lifecycle、terminal 收敛和 envelope 顺序 MUST 保持现有即时语义。frontend MUST NOT 建立 stream activity timeout 或 stuck-run 本地收敛 owner。

#### Scenario: 长会话流式输出只更新变化的 turn
- **GIVEN** 当前连续会话窗口已显示大量完成的历史 turn
- **WHEN** 当前最新 turn 连续收到多条 live delta
- **THEN** 前端 MUST 按现有逐帧边界更新可见投影
- **AND** MUST NOT 因每条活动 envelope 单独重渲染 ChatPage
- **AND** 未变化的历史 turn MUST NOT 重新渲染

#### Scenario: 第一次向上滚动不广播到全部旧 turn
- **GIVEN** 长会话当前正在底部跟随并接收 live 内容
- **WHEN** 用户第一次向上滚动退出跟随
- **THEN** viewport MUST 同步停止跟随
- **AND** 旧 turn 的异步布局回调 MUST 读取最新跟随策略
- **AND** viewport 状态变化 MUST NOT 使全部旧 turn 重新渲染

#### Scenario: viewport 更新保持 Composer 和 footer 监听稳定
- **GIVEN** 长会话已显示稳定的历史 turn 和 Composer
- **WHEN** following、at-bottom 或置底入口状态因用户滚动而变化
- **THEN** 未变化的历史 turn 和 Composer MUST NOT 重新渲染
- **AND** overlay footer 高度监听 MUST NOT 被销毁后重新建立

#### Scenario: 置底过渡只在真实到底后提交物理状态
- **GIVEN** 用户位于最新窗口底部上方并已退出 following
- **WHEN** 用户点击现有置底按钮
- **THEN** 前端 MUST 立即恢复 following 并开始现有时长的平滑过渡
- **AND** 动画完成前 MUST NOT 报告物理到底
- **AND** 动画过程 MUST NOT 因每一帧滚动提交页面级状态
- **AND** 用户在过渡期间真实向上滚动时 MUST 立即取消过渡并再次退出 following

#### Scenario: 生命周期语义保持即时
- **WHEN** request accepted、terminal 或其他非批处理 lifecycle envelope 到达
- **THEN** 前端 MUST 保持现有即时状态处理和消息顺序
