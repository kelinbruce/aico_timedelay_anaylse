## ADDED Requirements

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

长会话接收 live stream 更新时，前端 MUST 复用既有逐帧 delta 投影边界，MUST NOT 因活动超时计时而对每条 envelope 触发页面级渲染。未变化的历史 turn MUST 保持投影与组件引用稳定；viewport following 或 at-bottom 状态变化 MUST NOT 使全部旧 turn 或 Composer 重渲染，也 MUST NOT 重建 overlay footer 高度监听。显式置底 MUST 保留现有过渡时长，并且 MUST 只在视口真实到达底部后提交物理到底状态；程序性动画帧 MUST NOT 逐帧广播页面级 scroll state。request lifecycle、terminal 收敛和 envelope 顺序 MUST 保持现有即时语义。当前 request 等待 `USER_INPUT_REQUIRED` 回答时 MUST 暂停 stream activity timeout；普通无活动恢复只有在 conversation 刷新成功且权威 `activeRun` 已不存在时才能本地解锁输入。原始 stream frame 调试缓存 MUST 默认关闭，并 MUST 保留显式开启入口。

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

#### Scenario: 生命周期与调试语义保持独立
- **WHEN** request accepted、terminal 或其他非批处理 lifecycle envelope 到达
- **THEN** 前端 MUST 保持现有即时状态处理和消息顺序
- **AND** stream frame 调试未显式开启时 MUST NOT 保留 raw/parsed frame
- **AND** 显式开启后 MUST 继续按现有单会话上限记录 frame

#### Scenario: 等待用户输入不触发 stuck-run 解锁
- **GIVEN** 当前 request 已收到有效 `USER_INPUT_REQUIRED`
- **WHEN** 用户等待时间超过 frontend stream activity timeout，但未超过 runtime pending-input timeout
- **THEN** frontend MUST 保持 pending input 和 request executing 状态
- **AND** MUST NOT 因该等待发起 timeout-driven conversation recovery
- **AND** MUST NOT 显示 stuck-run 解锁提示

#### Scenario: 普通无活动恢复服从权威 activeRun
- **GIVEN** 当前 request 未处于 pending-input 等待状态且超过 stream activity timeout
- **WHEN** conversation 刷新成功并仍返回 matching non-terminal `activeRun`
- **THEN** frontend MUST 保持 request executing 状态
- **WHEN** conversation 刷新成功且不再返回 `activeRun`
- **THEN** frontend MAY 本地收敛 stale request 并显示恢复提示
