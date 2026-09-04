## ADDED Requirements

### Requirement: Live process panel identifies the current active entry

当最新 live run 存在当前活动过程条目时，`ProcessPanel` MUST 仅对该条目显示主题一致的活动视觉强调，并 MUST 暴露可由辅助技术识别的当前步骤语义。活动提示 MUST NOT 依赖动画才能被识别，MUST NOT 移动键盘焦点。条目稳定、run 进入终态或同一面板以 cold history 呈现后，`ProcessPanel` MUST 移除该活动提示。

`ProcessPanel` MUST 保留既有 Think、Skill/Tool、过程完成、最终完成和子标题图标的选择规则、图片资产及明暗主题语义。活动状态 MUST NOT 替换、重绘、着色或重新分类这些图标，也 MUST NOT 改变图标尺寸或布局。

当动态效果可用时，活动节点 wrapper MUST 使用约 2 秒一轮的主题感知柔和外圈呼吸增强辨识度，并 MUST 只改变外圈扩散半径与透明度。呼吸效果 MUST NOT 缩放或移动节点，MUST NOT 改变行高、列宽、标题起点、连接线或命中区域。浅色主题与深色主题 MUST 使用各自现有主题 token；深色主题 MUST 使用小于或等于浅色主题的最大光晕范围，避免持续高亮形成过强霓虹效果。`prefers-reduced-motion: reduce` 生效时，活动节点 MUST 停止呼吸并保留静态节点底色、外圈、标题层级和当前步骤语义。

同一个 composed presentation 中出现顺序晚于当前活动条目的可见助手文字时，该条目 MUST 立即移除呼吸、静态活动强调和当前步骤语义，但 MUST 保留原图标、标题、`isFinal` 与过程事实。若随后出现顺序更晚的同一步骤更新或新过程条目，唯一的最新活动条目 MUST 恢复主题一致的活动提示。

#### Scenario: 当前活动条目被突出显示

- **GIVEN** 最新 live run 的过程面板同时包含一个当前活动条目和至少一个非活动条目
- **WHEN** `ProcessPanel` 渲染这些条目
- **THEN** 只有当前活动条目 MUST 显示活动视觉强调
- **AND** 该条目 MUST 暴露当前步骤的可访问语义
- **AND** 该条目 MUST 保留活动状态出现前的既有图标资源与图形语义
- **AND** 键盘焦点 MUST 保持在渲染前的元素

#### Scenario: 活动条目稳定后移除提示

- **GIVEN** 一个过程条目正在显示活动提示
- **WHEN** 该条目进入稳定状态且没有后续活动条目
- **THEN** 该条目的活动视觉强调 MUST 被移除
- **AND** 该条目 MUST 不再暴露当前步骤语义

#### Scenario: 活动节点使用主题感知的柔和外圈呼吸

- **GIVEN** 最新 live run 存在当前活动条目且系统未请求减少动态效果
- **WHEN** `ProcessPanel` 在浅色或深色主题中呈现该条目
- **THEN** 固定节点 wrapper MUST 使用柔和外圈呼吸增强活动辨识度
- **AND** 呼吸 MUST 只改变外圈扩散半径与透明度
- **AND** 节点尺寸、位置、图标、行高、列宽和标题起点 MUST 保持不变
- **AND** 深色主题的最大光晕范围 MUST 不大于浅色主题

#### Scenario: Reduced motion 保留静态活动提示

- **GIVEN** `prefers-reduced-motion: reduce` 生效且最新 live run 存在当前活动条目
- **WHEN** `ProcessPanel` 呈现该条目
- **THEN** 活动节点 MUST NOT 运行呼吸动画
- **AND** 静态节点底色、外圈、标题层级和当前步骤语义 MUST 保留

#### Scenario: 可见答案接替后立即结束上一步视觉活动

- **GIVEN** 一个非 final 思考条目正在显示活动提示
- **WHEN** 同一个 composed presentation 出现顺序晚于该条目的可见助手文字
- **THEN** 该思考条目 MUST 立即停止呼吸并移除静态活动强调
- **AND** 该思考条目 MUST 不再暴露当前步骤语义
- **AND** 原 Think 图标、标题、`isFinal` 与过程事实 MUST 保持不变
- **AND** 若随后出现顺序更晚的过程活动，唯一最新活动条目 MUST 恢复活动提示

#### Scenario: 历史过程不显示瞬时活动状态

- **WHEN** 用户打开一个已完成 run 的 cold-history 过程面板
- **THEN** 任一历史过程条目 MUST NOT 显示 live 活动视觉强调
- **AND** 任一历史过程条目 MUST NOT 暴露当前步骤语义

### Requirement: New live process entries provide one entrance feedback

当运行中的 live 过程面板在初始呈现完成后首次显示一个新过程条目时，`ProcessPanel` MUST 对该条目执行一次持续 200ms 的淡入与不超过 4px 的向上归位反馈。该反馈 MUST NOT 改变条目顺序、内容、展开状态或用户焦点。相同条目在 detail 更新、面板收起后重新打开或 React 重渲染时 MUST NOT 重放反馈。

在 `prefers-reduced-motion: reduce` 生效时，新条目 MUST 直接显示最终视觉状态，且 MUST NOT 执行淡入或位移动画。初始 cold-history hydration 和已完成 run 的稳定内容重建 MUST 直接显示最终视觉状态。

#### Scenario: Live 运行中新条目首次出现

- **GIVEN** live 过程面板已经完成初始呈现且 run 仍在执行
- **WHEN** 一个此前未呈现的过程条目首次出现
- **THEN** 该条目 MUST 执行一次持续 200ms 的进入反馈
- **AND** 进入反馈的位移距离 MUST 不超过 4px
- **AND** 条目内容、顺序和展开状态 MUST 保持不变

#### Scenario: 同一条目更新不重放反馈

- **GIVEN** 一个 live 过程条目已经完成首次进入反馈
- **WHEN** 该条目的 detail 更新、组件重新渲染或面板收起后重新打开
- **THEN** 该条目 MUST NOT 重放进入反馈

#### Scenario: Reduced motion 关闭进入动画

- **GIVEN** `prefers-reduced-motion: reduce` 生效
- **WHEN** live 运行中首次出现一个新过程条目
- **THEN** 该条目 MUST 直接显示最终视觉状态
- **AND** 该条目 MUST NOT 执行透明度或位移动画

#### Scenario: Cold history 不重放进入反馈

- **WHEN** 已完成 run 的过程条目通过初始 cold-history hydration 或稳定内容重建出现
- **THEN** 全部条目 MUST 直接显示最终视觉状态
- **AND** 全部条目 MUST NOT 执行进入反馈

### Requirement: Active process content cooperates with chat viewport following

当聊天视口处于跟随底部状态时，live `ProcessPanel` 的当前活动条目首次出现或其可见内容高度增加后，聊天界面 MUST 保持底部可见。该行为 MUST 复用聊天视口的既有跟随状态和滚动入口，MUST NOT 移动键盘焦点。

当用户主动离开底部并使聊天视口暂停跟随时，后续活动条目出现或内容高度增加 MUST NOT 改变当前阅读位置；聊天界面 MUST 通过既有新消息或回到底部入口提示可恢复跟随。用户触发该入口后，聊天界面 MUST 回到底部并恢复对后续活动内容的跟随。

#### Scenario: 跟随状态下活动内容保持可见

- **GIVEN** 聊天视口处于跟随底部状态
- **WHEN** 当前活动条目首次出现或其展开内容高度增加
- **THEN** 聊天界面 MUST 保持底部可见
- **AND** 键盘焦点 MUST 保持在滚动前的元素

#### Scenario: 用户阅读历史内容时暂停跟随

- **GIVEN** 用户已主动离开底部且聊天视口已暂停跟随
- **WHEN** 当前活动条目首次出现或其展开内容高度增加
- **THEN** 聊天界面 MUST 保持用户当前阅读位置
- **AND** MUST NOT 将活动条目强制滚入视口
- **AND** MUST 通过既有新消息或回到底部入口提供恢复操作

#### Scenario: 用户恢复跟随

- **GIVEN** 聊天视口因用户主动离开底部而暂停跟随
- **WHEN** 用户触发既有新消息或回到底部入口
- **THEN** 聊天界面 MUST 回到底部
- **AND** 后续活动条目出现或可见内容高度增加时 MUST 继续保持底部可见

### Requirement: Automatic process disclosure preserves the next visual focus

当 live 过程条目进入完成状态且没有用户手工覆盖时，`ProcessPanel` MUST 在后续活动内容进入可见阅读阶段前直接从布局中移除该条目的 detail，MUST NOT 等待 settle delay，且 MUST NOT 对该自动收起执行改变布局高度的 transition。

用户手工展开或收起条目后，该手工状态 MUST 在当前 run 内优先于自动 disclosure。后续条目完成、活动条目切换、内容更新或最终答案开始 MUST NOT 覆盖该状态。由 `rootMessageId` 与 `displayRunId` 共同标识的 run scope 改变时，MUST 清除上一 scope 的手工状态。

#### Scenario: 自动完成条目在下一步骤前直接收起

- **GIVEN** 一个自动管理的 live 条目处于展开状态
- **WHEN** 该条目进入 final，且后续活动条目同时或随后出现
- **THEN** 已完成条目的 detail MUST 直接从布局中移除
- **AND** MUST NOT 等待 settle delay
- **AND** MUST NOT 对该自动收起执行 height transition

#### Scenario: 手工展开跨后续步骤保持

- **GIVEN** 用户手工展开了一个过程条目
- **WHEN** 该条目完成、后续活动条目开始或最终答案开始输出
- **THEN** 该条目 MUST 保持展开
- **AND** 自动 disclosure MUST NOT 覆盖该手工状态

#### Scenario: 手工收起不被内容更新重新打开

- **GIVEN** 用户手工收起了一个过程条目
- **WHEN** 该条目的 detail 更新或后续活动条目发生变化
- **THEN** 该条目 MUST 保持收起

#### Scenario: 包含 PIU 的过程 Detail 保持 disclosure 可用

- **GIVEN** 一个自动管理的过程条目 Detail 包含 PIU 结构化内容
- **WHEN** 该条目完成并自动收起，随后用户主动展开和再次收起
- **THEN** 自动收起 MUST 正常完成
- **AND** 用户主动展开时 MUST 能看到该 PIU 内容
- **AND** 用户主动收起时 MUST 隐藏该 PIU 内容
- **AND** 本 change MUST NOT 规定 PIU 在隐藏期间保持挂载或重新挂载

#### Scenario: 新 run 清除手工覆盖

- **GIVEN** 当前 run 存在用户手工展开或收起状态
- **WHEN** ProcessPanel 切换到新的 `rootMessageId + displayRunId` run scope
- **THEN** 新 scope MUST 不继承上一 scope 的手工 disclosure 状态

### Requirement: Completed answer handoff preserves the current reading focus

`ProcessPanel` MUST NOT 根据文字内容、长度、到达时间、标题、未投影的 payload 字段或 Provider `finishReason` 推断最终答案。执行中的普通 assistant content MUST NOT 触发过程面板收束。

运行中的可见助手文字顺序晚于一个非 final 过程条目时，`ProcessPanel` MUST 只把该文字视为此前步骤 detail 的视觉交接边界。未被用户手工覆盖的此前步骤 detail MUST 立即收起，但整个过程面板 MUST 保持打开，条目的 `isFinal`、标题、状态图标和过程事实 MUST 保持不变。该判断 MUST NOT 区分阶段说明与最终答案。

若阶段说明后出现新的过程条目，新条目 MUST 按既有活动规则显示并自动展开；若同一非 final 条目在可见助手文字之后继续收到更晚的过程更新，该条目 MUST 在没有用户手工覆盖时恢复自动展开。canonical `QUESTION` 补充信息的自动显示 MUST 优先于该视觉交接。

当 Turn 已成功完成且已有可见答案、过程面板没有用户手工展开状态、当前 presentation 不存在未解决的 canonical `QUESTION` 补充信息，且聊天视口仍跟随底部时，`ProcessPanel` MUST 在该 committed render 中把自动管理的执行详情收束为摘要行并锁存该自动收束状态。后续 viewport following 变化或稳定重渲染 MUST NOT 重新展开面板，也 MUST NOT 再执行第二次面板收起。

当用户已经离开底部时，Turn 完成 MUST NOT 自动改变当前过程布局。用户手工展开或收起任一条目或整个过程面板后，完成态与失败态 MUST 保留该手工状态。只有系统自动收束的面板进入失败 presentation 时 MUST 恢复过程目录且不得重复 Turn 级失败提示。未解决的 canonical `QUESTION` 补充信息 MUST 显示对应的非 final 待处理 detail，并 MUST 保持其他已完成 detail 收起。

公开文字与过程步骤的先后关系 MUST 来自同一个 composed presentation 中的位置，MUST NOT 直接比较 timeline sequence、history ordinal 或 Message sequence。补充信息状态 MUST 只关联同一 normalized envelope identity 与 `pendingInputId` 的结构化 presentation，并 MUST 保留既有 composed presentation 顺序，MUST NOT 混用上述异构序号重新排序：matching `USER_INPUT_REQUIRED` 开始等待；matching `USER_INPUT_RECEIVED`、有效 durable `pendingInputAnswer`、`USER_INPUT_TIMEOUT` 或 `USER_INPUT_CANCELED` 结束等待，并 MUST 同时把对应补充信息条目标记为 final。等待判断、条目标题与 final 状态 MUST 来自同一个 supplemental state。Web projection 未提供可信 producer identity 时 MUST NOT 猜测具体 Capability producer；其他 pending kind、缺少 `pendingInputId` 的事件、显示标题和自由文本 MUST NOT 进入该判断。

#### Scenario: 跟随底部时已完成答案进行一次性交接

- **GIVEN** run 正在显示自动管理的执行详情，不存在用户手工展开状态，且聊天视口跟随底部
- **WHEN** Turn 进入成功完成状态且 committed render 已有可见答案
- **THEN** 执行详情 MUST 在同一 render 只保留摘要行
- **AND** 后续稳定重渲染 MUST NOT 再改变执行面板高度

#### Scenario: 已完成交接不因后续离开底部重新展开

- **GIVEN** 过程面板已经在跟随底部时完成自动答案交接
- **WHEN** 用户随后离开底部或 viewport following 状态变化
- **THEN** 过程面板 MUST 保持自动收束
- **AND** MUST NOT 因 following 状态变化重新展开执行详情

#### Scenario: 执行中的助手文字不触发交接

- **GIVEN** run 正在显示自动管理的执行详情
- **WHEN** presentation 包含 assistant content 但 Turn 仍处于执行中
- **THEN** 过程面板 MUST 保持打开
- **AND** 顺序早于该 assistant content 且未被用户手工覆盖的过程步骤 detail MUST 收起
- **AND** 系统 MUST NOT 据此判断该 assistant content 是阶段说明或最终答案

#### Scenario: 历史消息序号不覆盖展示先后关系

- **GIVEN** 一个运行中的过程步骤来自 timeline event，且其 timeline sequence 大于随后出现的 Assistant Message history ordinal
- **WHEN** composed presentation 把该 Assistant Message 显示在过程步骤之后
- **THEN** 未被用户手工覆盖的过程步骤 detail MUST 收起
- **AND** 系统 MUST NOT 直接比较这两类序号决定 disclosure

#### Scenario: 累计答案快照在原槽位更新

- **GIVEN** 一个 accumulated assistant content snapshot 的数组槽位早于随后出现的思考步骤
- **WHEN** 该 snapshot 被更新为时间上晚于该思考步骤的公开答案内容
- **THEN** 系统 MUST 按 normalized presentation activity time 识别该公开答案更晚
- **AND** 未被用户手工覆盖的思考步骤 detail MUST 收起

#### Scenario: 阶段说明后继续执行新步骤

- **GIVEN** 运行中的可见助手文字已经收起此前自动展开的步骤 detail
- **WHEN** 随后出现新的思考、工具或系统过程条目
- **THEN** 新条目 MUST 按既有活动规则显示并自动展开
- **AND** 过程面板 MUST 保持打开

#### Scenario: 同一步骤在公开文字后恢复活动

- **GIVEN** 一个非 final 过程条目因顺序更晚的可见助手文字而自动收起
- **WHEN** 同一条目随后收到顺序更新且用户没有手工覆盖该条目
- **THEN** 该条目 MUST 恢复自动展开
- **AND** 其先前内容 MUST 不丢失或重复

#### Scenario: 手工展开优先于公开文字交接

- **GIVEN** 用户手工展开了一个过程条目
- **WHEN** 随后出现顺序更晚的可见助手文字
- **THEN** 该条目 MUST 保持展开

#### Scenario: 离开底部后完成态不抢夺阅读焦点

- **GIVEN** 用户已离开底部并暂停视口跟随
- **WHEN** Turn 成功完成且已有可见答案
- **THEN** 当前过程布局 MUST 保持不变
- **AND** MUST NOT 强制把最终答案滚入视口

#### Scenario: 手工展开阻止完成态自动收束

- **GIVEN** 用户手工展开了一个过程条目或整个过程面板
- **WHEN** Turn 成功完成且已有可见答案
- **THEN** 过程面板与手工条目 MUST 保持展开

#### Scenario: 系统自动收束后的失败恢复步骤目录

- **GIVEN** 过程面板由系统自动收束
- **WHEN** run 进入失败状态
- **THEN** ProcessPanel MUST 重新打开步骤目录
- **AND** 自动管理条目的 detail MUST 保持收起
- **AND** ProcessPanel MUST NOT 重复 Turn 级失败提示

#### Scenario: 用户手工收起优先于失败恢复

- **GIVEN** 用户已经手工收起整个过程面板或一个过程条目
- **WHEN** run 进入失败状态
- **THEN** ProcessPanel MUST 保持对应的手工收起状态

#### Scenario: 未解决的 canonical QUESTION 只显示对应 detail

- **GIVEN** 同一 normalized envelope identity 与 `pendingInputId` 存在有效 canonical `QUESTION` `USER_INPUT_REQUIRED`
- **AND** 尚无 matching resolved outcome
- **WHEN** ProcessPanel 呈现该状态
- **THEN** ProcessPanel MUST 显示对应的非 final 待处理 detail
- **AND** 其他非 final 过程条目的 detail MUST 保持其既有 disclosure 状态
- **AND** 其他已完成条目的 detail MUST 保持收起

#### Scenario: QUESTION resolved outcome 结束等待

- **GIVEN** 同一 `QUESTION` 补充信息正在等待
- **WHEN** presentation 出现 matching `USER_INPUT_RECEIVED`、有效 durable `pendingInputAnswer`、`USER_INPUT_TIMEOUT` 或 `USER_INPUT_CANCELED`
- **THEN** ProcessPanel MUST 不再把该补充信息判定为待处理
- **AND** 对应补充信息条目 MUST 进入 final 状态且不再显示等待标题

#### Scenario: 非 QUESTION 或缺少 pendingInputId 不进入例外路径

- **WHEN** presentation 只包含非 `QUESTION` pending kind、缺少有效 `pendingInputId` 的事件，或类似等待语义的自由文本
- **THEN** ProcessPanel MUST NOT 据此阻止 completed-answer handoff
- **AND** MUST NOT 使用标题或自由文本猜测待处理条目

### Requirement: Reopened completed process panels use a collapsed step directory

成功完成的过程面板在自动收束后被用户重新打开时，`ProcessPanel` MUST 展示全部步骤标题与状态，并 MUST 默认保持自动管理条目的 detail 收起。用户可以逐条展开所需 detail；当前 run 内已经存在的手工状态 MUST 被恢复，而不是由重新打开动作覆盖。

系统自动收束的失败 run MUST 恢复过程目录与由既有 presentation model 标识的失败或降级条目标题，但 MUST NOT 在未手工展开条目时重复 Turn 级失败提示。用户手工收起仍优先。未解决的 canonical `QUESTION` 补充信息 MUST 保持对应的非 final detail 可见，并 MUST 保持其他已完成 detail 收起。

#### Scenario: 成功面板重新打开只展示步骤目录

- **GIVEN** 一个成功完成且不存在手工 disclosure 状态的过程面板已经自动收束
- **WHEN** 用户手工重新打开该面板
- **THEN** 全部步骤标题和状态 MUST 可见
- **AND** 全部自动管理条目的 detail MUST 保持收起
- **AND** 用户 MUST 能逐条展开所需 detail

#### Scenario: 重新打开恢复当前 run 的手工状态

- **GIVEN** 当前 run 中用户已手工展开或收起一个或多个条目
- **WHEN** 用户收起并重新打开整个过程面板
- **THEN** 对应条目的手工状态 MUST 被恢复
- **AND** 其余自动管理条目的 detail MUST 保持收起

### Requirement: Process activity affordances are consistent across web hosts

local、immersive 和 collaborative 三种 Web 宿主 MUST 复用同一 `ProcessPanel` 活动提示、进入反馈、disclosure 和视口跟随行为。宿主入口差异 MUST NOT 改变活动条目判定、动画降级或暂停与恢复跟随语义。

#### Scenario: 三种宿主呈现同一 live 过程

- **WHEN** local、immersive 和 collaborative 宿主分别呈现相同的 live 过程条目与聊天视口跟随状态
- **THEN** 三种宿主 MUST 选择相同的当前活动条目
- **AND** 三种宿主 MUST 产生相同的进入反馈或 reduced-motion 降级结果
- **AND** 三种宿主 MUST 产生相同的 disclosure 与视口结果
