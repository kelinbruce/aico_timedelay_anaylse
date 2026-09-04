## Purpose

This specification defines the stable component and presentation requirements for the web chat process panel shown inside turn blocks.

## Function

- **所属 Function**：`FN-10.6 前端定制`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: ProcessPanel 独立组件

对话过程面板 SHALL 作为独立 React 组件 `ProcessPanel` 实现，位于 `frontend/agent-web/src/features/chat/components/ProcessPanel.tsx`。`TurnBlock` SHALL 渲染该组件替代内联过程面板逻辑。

#### Scenario: TurnBlock 渲染 ProcessPanel
- **WHEN** 渲染 TurnBlock 且需要显示过程面板
- **THEN** TurnBlock MUST 渲染 `ProcessPanel` 组件

### Requirement: 过程面板图标

`ProcessPanel` SHALL 根据过程标题关键词和当前主题动态选择图标。图标类型 SHALL 包含 `think`（标题包含"思考"或"think"）、`skill`（标题包含"agent"或"skill"）、`process-complete`（默认）和 `final-complete`。每个图标 SHALL 有浅色和深色版本。

#### Scenario: 思考过程图标
- **WHEN** 过程标题包含"思考"或"think"
- **THEN** 图标类型 MUST 为 `think`

#### Scenario: 技能过程图标
- **WHEN** 过程标题包含"agent"或"skill"
- **THEN** 图标类型 MUST 为 `skill`

#### Scenario: 默认过程图标
- **WHEN** 过程标题不匹配任何关键词
- **THEN** 图标类型 MUST 为 `process-complete`

### Requirement: TurnBlock 过程面板提取

`TurnBlock` SHALL 移除内联的过程面板 CSS（`PROCESS_IDLE_SWEEP_CSS`）、`ProcessPanelMode` 类型、`persistedProcessPanelModes` 缓存和 `PROCESS_AUTO_COLLAPSE_DELAY_MS`、`PROCESS_PANEL_TRANSITION_MS`、`PROCESS_PANEL_TOP_GAP_PX` 常量。这些逻辑 SHALL 由 `ProcessPanel` 组件内部管理。

#### Scenario: TurnBlock 不包含已移除的过程面板逻辑
- **WHEN** 检查 TurnBlock 源码
- **THEN** MUST 不包含 `PROCESS_IDLE_SWEEP_CSS`、`ProcessPanelMode`、`persistedProcessPanelModes`
- **AND** MUST 包含 `ProcessPanel` 的 import

### Requirement: TOOL_STRUCTURED_DELTA 过程面板处理

过程面板 MUST 按稳定关联身份处理 `TOOL_STRUCTURED_DELTA`。当事件具有非空 `toolCallId` 且存在相同 `toolCallId` 的 runtime Capability lifecycle 时，`CAPABILITY_STARTED`、全部结构化过程、普通安全结果和 `CAPABILITY_COMPLETED` MUST 形成恰好一个 Capability 卡片。该卡片 MUST 使用 `CAPABILITY_STARTED` 的 sequence 和 created time 作为排序锚点；后续事件 MUST 只更新原卡片，不得创建竞争的顶层条目或移动卡片。

匹配 runtime Capability lifecycle 的 `TITLE` 和 `SUB_TITLE` MUST 在该 Capability 卡片内部创建有序过程分段；`DETAIL` MUST 累积到匹配的最近 `TITLE`，`SUB_DETAIL` 和 `SUB_CONCLUSION` MUST 累积到匹配的最近 `SUB_TITLE`。独立安全结果投影存在时 MUST 位于全部结构化过程分段之后。已被识别并呈现为结构化过程的协议帧 MUST NOT 再以普通命令输出、摘要或原始协议文本重复显示。completion stdout preview 同时承载已解析结构化帧且没有独立的普通安全结果投影时，过程面板 MUST 省略该 stdout preview，MUST 保留退出状态、安全错误和已投影结构化过程；系统 MUST NOT 在浏览器中解析原始 stdout 以猜测可保留片段。

不存在匹配 runtime Capability lifecycle 时，`TITLE` 和 `SUB_TITLE` MUST 继续形成独立结构化过程条目。`TITLE` 和 `SUB_TITLE` MUST 按首个非空稳定关联字段建立索引，优先级依次为 `toolCallId`、`invocationId`、`metadata.invocationId`、`capabilityId`。带稳定关联字段的 detail 或 conclusion MUST 只更新同一关联身份下的匹配标题；不存在匹配标题时 MUST 忽略。只有完全不带上述稳定关联字段的 legacy 事件 MAY 更新最近同类型标题；未选择该兼容行为时 MUST 忽略该事件。

TEXT detail MUST 同时按顺序进入纯文本 detail 和结构化 TEXT segments；相邻 TEXT segments MUST 拼接，非 TEXT segment MUST 打断拼接链。DSL、PIU、ACTION、OPERATOR 和 FILE MUST 分别形成独立结构化 segment，MUST NOT 通过 `JSON.stringify` 写入纯文本 detail。过程面板 MUST 按 message type 使用既有专用 renderer 呈现这些 segments。

`ANSWER` MUST NOT 创建过程面板条目，MUST 进入 answer content。`EXPAND_PANEL` MUST NOT 创建独立条目；带稳定关联字段时 MUST 只挂到匹配 `TITLE`，完全无稳定关联字段时 MAY 挂到最近 `TITLE`，没有可用标题时 MUST 忽略。同一 attempt、event type 和 sequence 下，不同 `toolEventType` 或稳定关联身份的事件 MUST 全部保留；相同关联身份的标题 MUST 先于其 detail 投影。

**需求类别**：功能性需求

#### Scenario: Bash 任务进展归入执行命令卡片

- **GIVEN** `CAPABILITY_STARTED` 以 `toolCallId=T1` 创建“执行命令”卡片
- **WHEN** T1 依次产生 `SUB_TITLE="任务进展"`、两个 `SUB_CONCLUSION` 和 `CAPABILITY_COMPLETED`
- **THEN** 过程面板 MUST 只显示一张以 started 时序定位的“执行命令”卡片
- **AND** “任务进展”及两个 conclusion MUST 按事件顺序显示在卡片内部
- **AND** “任务进展” MUST NOT 成为位于“执行命令”之前或之后的独立顶层条目

#### Scenario: 任务进展与普通命令结果混合呈现

- **GIVEN** 同一 tool call 既产生结构化任务进展，又通过独立安全结果投影产生普通命令结果
- **WHEN** Capability 完成
- **THEN** 卡片 MUST 先显示全部结构化任务进展，再显示“命令结果”分段
- **AND** 结构化任务进展对应的协议帧 MUST NOT 在“命令结果”中重复
- **AND** 独立安全结果投影中的普通输出 MUST 保留在“命令结果”中

#### Scenario: 混合 stdout 无法安全拆分

- **GIVEN** completion stdout preview 同时包含已投影结构化帧与未独立投影的其他文本
- **WHEN** 过程面板构建同一 tool call 的命令结果
- **THEN** 过程面板 MUST 省略该 stdout preview
- **AND** 卡片 MUST 保留结构化任务进展、退出状态和安全错误
- **AND** 浏览器 MUST NOT 解析 raw stdout 或使用字符串相似度恢复其他文本

#### Scenario: 失败保留已经发生的进展

- **GIVEN** 执行命令已经产生至少一个结构化任务进展
- **WHEN** 同一 tool call 以失败、超时或阻止终态完成
- **THEN** 卡片 MUST 保留全部已发生进展
- **AND** 失败原因或安全错误 MUST 位于进展之后
- **AND** 终态 MUST NOT 删除、替换或移动该卡片

#### Scenario: 独立结构化过程保持既有条目语义

- **GIVEN** `TOOL_STRUCTURED_DELTA` 具有稳定关联身份但不存在匹配 runtime Capability lifecycle
- **WHEN** 事件产生 `TITLE`、TEXT detail、DSL detail 和 `SUB_TITLE`
- **THEN** 过程面板 MUST 创建对应的独立有序结构化过程条目
- **AND** TEXT MUST 进入文本和 TEXT segment
- **AND** DSL MUST 只进入独立 DSL segment

#### Scenario: 关联 detail 没有匹配标题

- **GIVEN** 已存在关联身份 T1 的 `TITLE`
- **WHEN** 关联身份 T2 的 detail 到达且不存在 T2 标题
- **THEN** 过程面板 MUST 忽略该 detail
- **AND** T1 标题和详情 MUST 保持不变

#### Scenario: 相同 sequence 的标题先于详情

- **WHEN** 相同 attempt、event type、sequence 和关联身份包含一个标题与一个 detail
- **THEN** 两个事件 MUST 都进入过程投影
- **AND** 标题 MUST 先于 detail 处理，即使输入数组中 detail 位于标题之前

#### Scenario: ANSWER 与 EXPAND_PANEL 不创建过程步骤

- **WHEN** `ANSWER` 和 `EXPAND_PANEL` 结构化事件到达
- **THEN** `ANSWER` MUST 进入 answer content 且不得创建过程条目
- **AND** `EXPAND_PANEL` MUST 只挂到符合本 Requirement 的目标 `TITLE`
- **AND** 没有目标 `TITLE` 时 `EXPAND_PANEL` MUST 被忽略

### Requirement: Active process entries follow execution lifecycle

`ProcessPanel` SHALL 自动展开每个新进入活动状态的 thinking 或 runtime Capability 条目。thinking 条目只有在连续条目收到 `metadata.completed=true` 时进入 settled；runtime Capability 条目只有在 terminal projection 到达时进入 settled。正常动效模式下，成功完成的活动条目 MUST 在 settled 后保持展开 800 ms，随后自动折叠但不得删除详情；失败、超时或被阻止的 runtime Capability 条目 MUST 保持展开。并发活动条目 MUST 独立跟踪。

**需求类别**：功能性需求

#### Scenario: Thinking 流式更新后收敛

- **WHEN** 进行中的累计 thinking envelopes 更新当前连续 thinking 条目
- **THEN** 条目 MUST 保持展开并显示最新完整累计正文
- **AND** completed thinking envelope 使该条目 settled 后，条目 MUST 保留最终正文并在 800 ms 后自动折叠

#### Scenario: 累计 thinking 保持同一布局生命周期

- **WHEN** 连续累计 thinking envelopes 更新同一运行中条目，包括容量压缩后 `eventId` 改变
- **THEN** `ProcessPanel` MUST 保持已挂载条目和 disclosure state
- **AND** 实际内容高度变化 MUST 在该 render lifecycle 中复用同一 active observer

#### Scenario: 成功命令完成后折叠

- **GIVEN** 一张运行中自动展开的执行命令卡片包含任务进展和命令结果
- **WHEN** 该 Capability 成功完成
- **THEN** 卡片 MUST 保留“执行命令 · 已完成”标题和全部详情
- **AND** 详情 MUST 在 settled 后保持展开 800 ms，随后自动折叠

#### Scenario: 失败命令保持展开

- **GIVEN** 一张运行中自动展开的执行命令卡片已经显示任务进展
- **WHEN** 该 Capability 以失败、超时或阻止终态完成
- **THEN** 卡片 MUST 保持展开
- **AND** 用户 MUST 无需再次操作即可看到已经发生的进展和失败原因

#### Scenario: 并发 Capability 独立收敛

- **WHEN** 两个 runtime Capability 条目同时活动且只有一个达到终态
- **THEN** 达到成功终态的条目 MUST 独立进入自动折叠生命周期
- **AND** 达到失败、超时或阻止终态的条目 MUST 独立保持展开
- **AND** 仍在运行的条目 MUST 保持展开

### Requirement: Structured workflow process presentation remains visible

`ProcessPanel` MUST 只把不属于匹配 runtime Capability 卡片的独立 `TITLE` 或 `SUB_TITLE` 条目视为 structured workflow presentation。该独立呈现首次渲染已经 settled 时 MUST 默认展开，运行中转为 settled 时 MUST NOT 自动折叠；显式用户折叠 MUST 保持权威。相同 `toolCallId` 的 runtime Capability 卡片内部结构化内容 MUST 遵循 `Active process entries follow execution lifecycle`，MUST NOT 因包含 `TITLE` 或 `SUB_TITLE` 而获得 structured workflow 的默认展开例外。没有独立 structured workflow 条目的 settled process panel MUST 保持既有默认折叠行为。

**需求类别**：功能性需求

#### Scenario: 快速完成的独立 structured workflow 首次展开

- **GIVEN** 已完成 turn 包含不属于 runtime Capability 卡片的 TITLE 和 DETAIL
- **WHEN** `ProcessPanel` 首次以 settled phase 渲染
- **THEN** TITLE 和 DETAIL MUST 无需用户操作即可见

#### Scenario: 独立 structured workflow settled 后不自动折叠

- **GIVEN** 独立 structured workflow process panel 在运行中自动展开
- **WHEN** execution phase 变为 settled
- **THEN** panel MUST 保持展开

#### Scenario: runtime Capability 内结构化内容不改变终态 disclosure

- **GIVEN** 一张 runtime Capability 卡片内部包含 TITLE 或 SUB_TITLE
- **WHEN** Capability 成功完成
- **THEN** 卡片 MUST 按 `Active process entries follow execution lifecycle` 自动折叠
- **AND** 它 MUST NOT 被分类为独立 structured workflow presentation

#### Scenario: 用户折叠独立 structured workflow

- **GIVEN** 独立 structured workflow process panel 可见
- **WHEN** 用户显式折叠
- **THEN** panel MUST 保持用户折叠状态

#### Scenario: 普通 settled process 保持折叠默认值

- **GIVEN** settled process panel 没有独立 structured workflow 条目
- **WHEN** `ProcessPanel` 首次渲染
- **THEN** panel MUST 使用既有默认折叠行为

### Requirement: Manual entry expansion overrides automation for the current run

When a user manually expands or collapses a process entry, `ProcessPanel` SHALL freeze automatic expansion and collapse for that entry within the current root-message/run scope. Manual action on one entry MUST NOT force another entry to expand or collapse. A new root-message/run scope MUST start with no inherited entry override.

#### Scenario: User keeps a completed entry open
- **WHEN** the user manually expands a completed entry before or after its auto-collapse timer
- **THEN** any pending auto-collapse for that entry MUST be canceled
- **AND** the entry MUST remain expanded until the user changes it or the component leaves the current run scope

#### Scenario: User collapses an active entry
- **WHEN** the user manually collapses an active entry
- **THEN** later deltas and terminal state for that same entry MUST NOT auto-expand it
- **AND** other new active entries MAY still auto-expand

#### Scenario: Next turn resets entry overrides
- **WHEN** the conversation starts a new root-message/run scope
- **THEN** entry overrides from the previous run MUST NOT apply
- **AND** the new run MUST use automatic entry lifecycle defaults

### Requirement: Completed live and cold-history panels have the same inspectable detail

After a run reaches a terminal state, the process panel SHALL auto-collapse after the existing 150ms panel delay. A cold-history process panel SHALL start collapsed. When the user expands either panel, all persisted process entries and their original completed detail MUST remain available for inspection; reopening MUST NOT trigger settled-entry auto-collapse.

#### Scenario: Live run completes
- **WHEN** the final process and request terminal state have been projected
- **THEN** the process panel MUST auto-collapse after 150ms unless panel-level user override applies
- **AND** the final assistant answer MUST remain visible outside the collapsed panel

#### Scenario: User reopens completed live process
- **WHEN** the user expands an auto-collapsed completed panel
- **THEN** every completed thinking and capability entry MUST be available with its retained detail
- **AND** settled entries MUST remain open for free inspection until the user changes them or closes the panel

#### Scenario: Cold history is opened
- **WHEN** a completed historical turn and its event history have loaded
- **THEN** its panel MUST initially be collapsed
- **WHEN** the user expands it
- **THEN** its completed process presentation MUST be equivalent to the completed live presentation

### Requirement: Reduced motion preserves state without transition motion

When `prefers-reduced-motion: reduce` is active, panel and entry lifecycle results SHALL remain the same, but entry and panel transitions MUST complete without the 200ms height animation and settled entries MUST not wait through the 800ms presentation delay.

#### Scenario: Reduced-motion thinking completes
- **WHEN** a `metadata.completed=true` thinking envelope settles an active entry under reduced-motion preference
- **THEN** the entry MUST move directly to its collapsed automatic state
- **AND** no height or sweep animation MUST run
- **AND** manual expansion MUST still reveal the full detail

### Requirement: Cold-history loading keeps a stable process affordance

For a completed historical turn with a selected display run, agent-web MUST keep any existing collapsed process affordance title and row geometry stable while event history loads. When message-derived process facts do not already require an affordance, background loading MUST NOT create a loading-only row before 300 milliseconds have elapsed from the run entering `LOADING`. Background loading that reaches `AVAILABLE`, `FAILED` or `LEGACY_UNAVAILABLE` before that boundary MUST NOT display a transient loading label. If the run remains `LOADING` at 300 milliseconds, the collapsed affordance MUST use the stable process title and row height and MUST display a non-text loading indicator beside the title.

When the user expands the process affordance before event history is available, the panel body MUST display the localized history-loading message and the run MUST receive explicit-user hydration priority. During a surviving session, ordinary collapse, offscreen transition or newer interaction generation MUST NOT cancel an already started request. A queued or not-started expansion generation MAY be displaced only by the sixteen-explicit-intent capacity rule; displacement MUST release that generation's demand/pin without changing disclosure state. If the still-expanded turn later becomes demand-eligible, it MUST create a new generation. Every normally settled active request MUST release its active-request pin. When session, active identity and validation guards pass, a result from an obsolete interaction generation MUST update only its run-scoped cache and MUST NOT reopen the panel, restore old disclosure/navigation intent or move the viewport. Session teardown MUST cancel queued/in-flight work and MUST NOT create a new visible load outcome.

#### Scenario: Fast background hydration does not flash loading text
- **GIVEN** a completed historical turn has no cached event history and its process affordance is collapsed
- **WHEN** hydration enters `LOADING` and reaches `AVAILABLE` before 300 milliseconds have elapsed
- **THEN** an existing title row MUST NOT display the localized history-loading text
- **AND** an absent title row MUST NOT be created only to display loading
- **AND** the completed process MUST be available when the user expands the panel

#### Scenario: Slow background hydration preserves the title
- **GIVEN** a completed historical turn remains `LOADING` for at least 300 milliseconds
- **WHEN** its process affordance is collapsed
- **THEN** the affordance title MUST remain unchanged
- **AND** any visible loading indicator MUST NOT replace the title or change the row height

#### Scenario: User expands while history is loading
- **WHEN** the user expands a completed historical turn whose selected run is `IDLE`, queued or `LOADING`
- **THEN** the run MUST be selected at explicit-user hydration priority
- **AND** the panel body MUST display the localized history-loading message until a terminal load outcome arrives
- **AND** the committed final answer MUST remain visible outside the panel

#### Scenario: Expanded loading succeeds in place
- **GIVEN** the user has expanded a panel that displays the history-loading message
- **WHEN** the run becomes `AVAILABLE`
- **THEN** the same panel MUST display the completed process entries
- **AND** the collapsed title row MUST NOT be replaced or remounted as a loading-state row
- **AND** the expansion explicit target and expansion pin MUST be released

#### Scenario: History loading fails
- **WHEN** a historical run event query fails validation or transport loading
- **THEN** the committed final answer MUST remain visible
- **AND** the panel MUST expose only the safe process-history failure and retry action
- **AND** raw parser, provider or transport detail MUST NOT be displayed
- **AND** the expansion explicit target and expansion pin MUST be released

#### Scenario: Expanded panel is collapsed or moves offscreen before completion
- **GIVEN** expansion started event history loading for a run
- **WHEN** the panel is collapsed or its turn leaves the viewport before loading completes
- **THEN** the active request MUST continue to its unique load outcome
- **AND** the same expansion MUST NOT create a second request

#### Scenario: Queued expansion is displaced without collapsing disclosure
- **GIVEN** an expanded panel owns the oldest queued or not-started explicit generation
- **WHEN** a newer explicit intent exceeds the per-session limit of sixteen
- **THEN** frontend MUST remove that oldest generation and release its expansion demand/pin
- **AND** MUST keep the panel disclosure state unchanged
- **WHEN** the still-expanded turn later re-enters demand eligibility
- **THEN** frontend MUST create a new explicit generation before requeueing it

#### Scenario: Session teardown cancels loading without a UI outcome
- **GIVEN** a process panel has queued or active event-history work
- **WHEN** its session is cleared or disposed
- **THEN** frontend MUST cancel that work and release all related demand/pins
- **AND** MUST NOT produce `AVAILABLE`, `FAILED` or `LEGACY_UNAVAILABLE` as a new panel outcome

#### Scenario: Legacy history is terminal
- **WHEN** an expanded historical run reaches `LEGACY_UNAVAILABLE`
- **THEN** the panel MUST show the safe terminal unavailable presentation
- **AND** the expansion explicit target and expansion pin MUST be released
- **AND** the panel MUST NOT render retry control or issue a retry request

#### Scenario: Expanded disclosure survives cache eviction
- **GIVEN** an expanded offscreen panel has reached `AVAILABLE` and no longer has another pin source
- **WHEN** its whole-run cache fact is evicted by capacity enforcement
- **THEN** the panel disclosure state MUST remain expanded
- **AND** returning the turn to the viewport MUST reload the run into the same expanded panel

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

当 live 过程条目进入完成状态且没有用户手工覆盖时，`ProcessPanel` MUST 在后续活动内容进入可见阅读阶段前直接从布局中隐藏该条目的 detail，MUST NOT 等待 settle delay，且 MUST NOT 对该自动收起执行改变布局高度的 transition。

用户手工展开或收起条目后，该手工状态 MUST 在当前 run 内优先于自动 disclosure。后续条目完成、活动条目切换、内容更新或最终答案开始 MUST NOT 覆盖该状态。由 `rootMessageId` 与 `displayRunId` 共同标识的 run scope 改变时，系统 MUST 清除上一 scope 的手工状态。

当一个 Process Detail 包含至少一个 `toolMessageType: "PIU"` 的结构化 segment 且该 Detail 已在当前 run scope 挂载时，条目自动收起、条目手工收起、整个过程面板收起和 reduced-motion 模式下的收起 MUST 只隐藏该 Detail 并阻止其交互，MUST 保留同一 PIU 组件实例。由折叠或重新展开产生的 React render MUST NOT 再次调用相同 PIU 内容的 `Prel.autoLoad` 或 `piu.emit`。不包含 PIU 的 Detail MUST 保持既有折叠后卸载行为，尚未展开的 PIU Detail MUST NOT 仅因处于折叠状态而提前挂载。

当 PIU Detail 所属过程条目不再存在于当前对话投影，或 `rootMessageId + displayRunId` run scope 被替换时，系统 MUST 卸载该 Detail、取消尚未完成的 PIU 加载结果并清空其容器 DOM。PIU host 未提供的外部销毁协议不属于本 Requirement。

**需求类别**：功能性需求

#### Scenario: 自动完成条目在下一步骤前直接收起

- **GIVEN** 一个不包含 PIU 的自动管理 live 条目处于展开状态
- **WHEN** 该条目进入 final，且后续活动条目同时或随后出现
- **THEN** 已完成条目的 detail MUST 直接从布局和 React render tree 中移除
- **AND** 系统 MUST NOT 等待 settle delay
- **AND** 系统 MUST NOT 对该自动收起执行 height transition

#### Scenario: 手工展开跨后续步骤保持

- **GIVEN** 用户手工展开了一个过程条目
- **WHEN** 该条目完成、后续活动条目开始或最终答案开始输出
- **THEN** 该条目 MUST 保持展开
- **AND** 自动 disclosure MUST NOT 覆盖该手工状态

#### Scenario: 手工收起不被内容更新重新打开

- **GIVEN** 用户手工收起了一个过程条目
- **WHEN** 该条目的 detail 更新或后续活动条目发生变化
- **THEN** 该条目 MUST 保持收起

#### Scenario: PIU 条目自动收起后复用交互实例

- **GIVEN** 一个自动管理的过程条目 Detail 包含 PIU 结构化内容且已完成首次挂载
- **WHEN** 该条目完成并自动收起，随后用户主动展开
- **THEN** 自动收起 MUST 隐藏 Detail 并阻止其中的 PIU 接收用户交互
- **AND** 用户主动展开时 MUST 看到首次挂载的同一 PIU 实例及其交互状态
- **AND** 系统 MUST NOT 因该次收起或展开重复调用 `Prel.autoLoad` 或 `piu.emit`

#### Scenario: 整个过程面板收起后复用 PIU 交互实例

- **GIVEN** 一个已展开的过程面板包含至少一个已挂载 PIU Detail
- **WHEN** 用户收起并重新展开整个过程面板
- **THEN** 收起期间过程面板及 PIU Detail MUST 不可见且不可交互
- **AND** 重新展开后 MUST 恢复同一 PIU 实例及其交互状态
- **AND** 系统 MUST NOT 因面板收起或展开重复调用 `Prel.autoLoad` 或 `piu.emit`

#### Scenario: reduced-motion 收起保留 PIU 实例

- **GIVEN** 用户启用了 reduced-motion，且一个 PIU Detail 已完成首次挂载
- **WHEN** 系统或用户收起该 Detail
- **THEN** Detail MUST 立即变为不可见且不可交互
- **AND** PIU 组件实例 MUST 保持挂载

#### Scenario: 未查看的 PIU Detail 不提前挂载

- **GIVEN** 一个已收起的过程条目包含尚未挂载的 PIU Detail
- **WHEN** 过程面板保持收起或重新渲染
- **THEN** 系统 MUST NOT 挂载该 PIU Detail
- **AND** 系统 MUST NOT 调用该 PIU 的 `Prel.autoLoad` 或 `piu.emit`

#### Scenario: PIU owner 移除后释放容器

- **GIVEN** 一个 PIU Detail 已挂载，或其 `Prel.autoLoad` 尚未完成
- **WHEN** 所属过程条目从当前对话投影移除或 run scope 被替换
- **THEN** 系统 MUST 卸载该 Detail 并清空其容器 DOM
- **AND** 尚未完成的加载结果 MUST NOT 再触发 `piu.emit`

#### Scenario: 新 run 清除手工覆盖

- **GIVEN** 当前 run 存在用户手工展开或收起状态
- **WHEN** `ProcessPanel` 切换到新的 `rootMessageId + displayRunId` run scope
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
