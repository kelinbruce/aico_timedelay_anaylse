# ts-stream-history-consistency Specification

## Purpose
Defines the ownership, merge, and recovery boundaries between visible committed `SessionMessage` history and frontend live stream presentation.

## Function

- **所属 Function**：`FN-1.2 断线后从上次位置继续`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: History Uses Visible Messages
TS 后端 SHALL use visible `SessionMessage` records as the final conversation history source. Stream replay SHALL NOT reconstruct final conversation history. TS frontend SHALL use conversation history for committed history and live stream state for runtime/process details that have not been safely replaced by visible history.

#### Scenario: History read returns visible committed messages
- **WHEN** a client opens or refreshes a session conversation
- **THEN** history MUST be read from visible session messages
- **AND** final history content MUST NOT be reconstructed from stream envelopes, timeline replay, projection cache, or frontend cache

#### Scenario: Active run content is recovered by stream replay
- **WHEN** a session has visible history and a non-terminal `activeRun`
- **THEN** visible history MUST be loaded from conversation history
- **AND** uncommitted active run stream content MUST be recovered through activeRun-scoped stream replay
- **AND** history MUST NOT synthesize the active run partial content as final history

#### Scenario: Ordinary terminal does not replace live process details with conversation snapshot
- **WHEN** a frontend session view receives a terminal stream envelope for the active request
- **THEN** the frontend MUST settle the local request state from the terminal envelope
- **AND** the frontend MUST preserve already accepted live stream process details for the request
- **AND** the frontend MUST NOT use an ordinary terminal-triggered conversation refresh to overwrite the current live/process detail presentation
- **AND** conversation refresh MAY still be used for gap recovery, stream timeout recovery, manual refresh, or opening and switching sessions

#### Scenario: No-cursor live-tail does not reconstruct history
- **WHEN** a frontend opens a session stream without `lastSeenSequence`
- **THEN** any already committed history MUST still be displayed from conversation history
- **AND** the no-cursor stream MUST NOT be treated as a source for reconstructing previously committed conversation messages

#### Scenario: Opening reconcile closes the conversation-to-live-tail window
- **WHEN** a frontend cold-starts an existing session by loading conversation and then opening no-cursor live-tail
- **AND** committed messages or activeRun state appear between the initial conversation snapshot and the live-tail boundary
- **THEN** the frontend MUST perform one opening conversation reconcile after live-tail is established
- **AND** the reconciled conversation state MUST merge with already accepted live envelopes without duplicating visible turns or removing live process details
- **AND** this opening reconcile MUST NOT make ordinary terminal delivery use conversation refresh to overwrite live/process detail presentation

### Requirement: Gap Refresh Gates Resume Anchor
TS frontend SHALL use `resumeAfterSequence` only after same-session visible conversation refresh succeeds.

#### Scenario: Successful refresh enables resumeAfterSequence
- **WHEN** stream resume returns a gap notice with `resumeAfterSequence`
- **AND** the frontend refreshes the same session visible conversation successfully
- **THEN** the next resume request MAY use `lastSeenSequence=resumeAfterSequence`

#### Scenario: Failed refresh keeps previous cursor
- **WHEN** stream resume returns a gap notice with `resumeAfterSequence`
- **AND** the same session visible conversation refresh fails or returns an unusable result
- **THEN** the frontend MUST NOT use `resumeAfterSequence`
- **AND** the frontend MUST keep the last timeline-backed sequence accepted by the current page lifecycle
- **AND** the UI MUST remain in a degraded or disconnected state

### Requirement: History Recovery Failure Is Explicit
TS frontend and backend SHALL NOT present incomplete history refresh as complete recovery.

#### Scenario: Refresh failure is visible
- **WHEN** visible conversation refresh fails after a stream gap
- **THEN** the user MUST see a recovery failure, degraded, or disconnected state
- **AND** the system MUST NOT mark the stream recovery as successful
- **AND** the system MUST NOT advance the stream cursor because of the failed refresh

### Requirement: Accepted live process details SHALL remain stable across terminal and history merge

TS frontend MUST distinguish committed conversation facts from live process presentation. Visible `SessionMessage` history MUST remain the source for committed user content, final assistant content, final capability result and message visibility. Live stream data accepted during the current page lifecycle MUST remain the source for thinking, capability execution, process timeline and live-only structured detail that visible history cannot reconstruct safely. Ordinary terminal handling and ordinary matching-history merge MUST NOT replace, remove or duplicate those accepted process details.

#### Scenario: Terminal settles live presentation without conversation refresh
- **WHEN** the frontend accepts a terminal envelope for the active request
- **THEN** it MUST settle the request and preserve the accepted live process presentation in one observable state transition
- **AND** the Turn MUST NOT disappear between active and settled states
- **AND** the frontend MUST NOT start an ordinary terminal-triggered conversation refresh

#### Scenario: Settled Turn remains visible before committed history is loaded
- **GIVEN** a request has reached a terminal state in the current page lifecycle
- **AND** the current conversation history window does not yet contain its root message
- **WHEN** the user continues using the same session without refreshing the page
- **THEN** the settled live projection MUST continue to provide the complete visible Turn already accepted by the frontend
- **AND** subsequent requests MUST NOT remove that Turn

#### Scenario: Matching history supplies final content without removing process detail
- **GIVEN** the current page has retained settled live process detail for a root message
- **WHEN** a conversation load, opening reconcile, manual refresh or gap recovery returns visible committed messages for the same root
- **THEN** the user message, final assistant content, final capability result and visibility MUST be projected from the committed history
- **AND** accepted thinking, capability execution, process timeline and live-only structured detail MUST remain available from the settled live projection
- **AND** the frontend MUST render one Turn and one final answer for that root

#### Scenario: Canonical invisibility suppresses retained live projection
- **GIVEN** the frontend retains active or settled live data for a root message
- **WHEN** committed conversation history marks that root as not visible, or a successful edit/supersede operation makes the root not visible
- **THEN** the frontend MUST NOT render that root from retained live data
- **AND** retry, edit rollback or successor projection MUST continue to follow the existing latest-attempt and visibility semantics

#### Scenario: Page reload rebuilds final history from visible messages
- **WHEN** the user reloads the page or the frontend no longer retains the session cache
- **THEN** committed conversation content MUST be rebuilt from visible `SessionMessage` history
- **AND** the frontend MUST NOT treat the previous page lifecycle's settled live cache as persisted history

#### Scenario: Late accepted identity and replay do not split or truncate a settled Turn
- **GIVEN** the frontend has accepted live detail under an optimistic or provisional request identity
- **AND** a terminal envelope may already have moved the matching attempt into retained settled presentation before the pending request can be identified safely
- **WHEN** the backend accepted root identity arrives after live detail or terminal delivery
- **THEN** the frontend MUST reconcile the retained detail to the accepted root without rendering two Turns
- **AND** the frontend MUST re-evaluate the terminal retained for that exact session, root and attempt so the matching pending request can settle
- **AND** a duplicate terminal or a replayed event for the same attempt MUST NOT replace the complete settled presentation with a terminal-only projection
- **AND** a late event from an older attempt MUST NOT replace the currently selected newer attempt

### Requirement: AskUserQuestion process projection keeps one supplemental-information entry

agent-web MUST 使用同一 session、root request、`runId` 和 `pendingInputId` 关联 `USER_INPUT_REQUIRED`、`USER_INPUT_RECEIVED` 与 canonical `AskUserQuestion` 的 `pendingInputAnswer` result。`USER_INPUT_REQUIRED` MUST 提供问题与选项，`USER_INPUT_RECEIVED` MUST 提供已接收状态，`pendingInputAnswer` MUST 提供回答正文。frontend MUST 把三者投影为同一次补充信息交互的一个 process entry；匹配的 received event 与 answer result MUST 更新或补全该条目，MUST NOT 再显示为独立 response entry 或通用 `AskUserQuestion` tool result。conversation/history capability-result item MAY 不携带 live event 的 `requestContextId`；frontend MUST NOT 因该字段缺失而拆分同一 run 的 interaction。

同一 attempt 中的一个 `pendingInputId` MUST 最多形成一个 process entry。仅有 `USER_INPUT_REQUIRED` 时，该条目的 zh-CN 标题 MUST 为“等待补充信息”，其他 locale MUST 使用等价本地化语义；detail MUST 按原始顺序显示问题以及 option question 的可选项、单选/多选和允许自定义输入的可见含义。收到 `USER_INPUT_RECEIVED` 或 matching `pendingInputAnswer` 后，frontend MUST 更新同一个语义条目，而不是增加 response entry；回答阶段的 zh-CN 标题 MUST 为“用户补充信息”，其他 locale MUST 使用等价本地化语义；MUST NOT 使用“已响应”作为独立标题、状态后缀或第二个 process entry。frontend MUST NOT 为该 pending answer 创建新的顶层用户消息、conversation turn 或 root request。

存在 matching `pendingInputAnswer` 时，detail MUST 按 question position 显示问题与回答。单问题 MUST 显示一个问题—回答对；多问题 MUST 按原始顺序编号并逐项显示问题—回答对。对应问题包含 options 时，frontend MUST 把与 option `value` 精确匹配的回答显示为该 option 的 `label`；custom text 或没有匹配 label 的已接受回答 MUST 按 safe result 中的文本显示。多选回答 MUST 在对应问题内保持 runtime-accepted 顺序。`safeResult.truncated=true` 时，条目 MUST 显示本地化的内容截断提示，不得静默省略该事实。frontend MUST NOT 使用本地提交值补齐缺失的 stream/history result。

#### Scenario: Live answer enriches the existing interaction

- **WHEN** 当前页面依次接受同一 attempt 和 `pendingInputId` 的 `USER_INPUT_REQUIRED`、`USER_INPUT_RECEIVED` 与有效 `pendingInputAnswer`
- **THEN** process detail MUST 只显示一个标题表达“用户补充信息”的 entry
- **AND** 该 entry MUST 按问题位置显示问题与实际回答
- **AND** matching option value MUST 显示对应 label
- **AND** custom 或未匹配的 answer MUST 显示其 safe projected text
- **AND** 页面 MUST NOT 显示独立“已响应”entry 或通用 `AskUserQuestion` result entry
- **AND** 页面 MUST NOT 增加一条顶层用户消息

#### Scenario: Supported question shapes use one paired display

- **WHEN** 一个 AskUserQuestion 按原始顺序包含一至三个正常问题或系统兼容兜底接收的四至二十个问题，且问题使用自由输入、单选、多选或允许自定义输入中的任一形状
- **THEN** 每个问题与其同位置 answer group MUST 在同一个补充信息 entry 中配对显示
- **AND** 单选 MUST 显示一个 option label，多选 MUST 按已接受顺序显示全部 option label，custom MUST 显示安全投影文本
- **AND** 多问题 MUST 使用可见编号保持问题与回答的对应关系
- **AND** 该 pending input 的 process entry 数量 MUST 保持为一

#### Scenario: Truncated answer is visibly disclosed

- **WHEN** matching `pendingInputAnswer.safeResult.truncated` 为 `true`
- **THEN** 补充信息 entry MUST 显示仍被保留的问题与回答内容
- **AND** detail MUST 显示本地化的“内容过长，已截断”提示
- **AND** frontend MUST NOT 从 raw message content 或本地提交值恢复被裁剪内容

#### Scenario: Terminal settlement preserves the complete interaction

- **WHEN** 包含完整 AskUserQuestion interaction 的 active live attempt 收到 terminal event
- **THEN** active presentation MUST 在一次可观察状态转换中进入 settled presentation
- **AND** 单个补充信息 entry 的标题、问题—回答配对、顺序、截断提示和展开后的 detail MUST 保持不变
- **AND** 同一 session 的后续 submit 与 terminal completion MUST NOT 删除或缩减该 settled interaction

#### Scenario: Durable history reconstructs the same answer result

- **WHEN** conversation load、opening reconcile、manual refresh 或 gap recovery 返回 canonical `AskUserQuestion` durable result 对应的 conversation item `pendingInputAnswer`
- **THEN** history adapter MUST 把该字段映射为与 live `pendingInputAnswer` 同形的 history envelope
- **AND** history adapter MUST NOT 解析 raw stored capability payload 或重新执行 answer 安全裁剪
- **AND** 如果对应 process events 可用，frontend MUST 按同一 root、attempt 和 `pendingInputId` 恢复同一个补充信息 entry
- **AND** live result 与 history result 同时存在时 MUST 合并进该 entry
- **AND** frontend MUST NOT 同时显示补充信息 entry、独立 response entry 与重复的通用 tool result

#### Scenario: Durable answer without a matching question remains visible

- **WHEN** history 或 live projection包含有效 `pendingInputAnswer`，但当前可用 process events 不包含同一 `pendingInputId` 的 `USER_INPUT_REQUIRED`
- **THEN** frontend MUST 显示一个标题表达“用户补充信息”且包含实际安全回答的 entry
- **AND** frontend MUST 标明问题内容不可用
- **AND** frontend MUST NOT 把 result 隐藏、关联到其他 pending input 或降级为不包含回答的通用 tool result

#### Scenario: Received event without answer result remains generic

- **WHEN** frontend 只收到 `USER_INPUT_RECEIVED`，但没有对应 live 或 durable `pendingInputAnswer`
- **THEN** frontend MUST 更新同一补充信息 entry，并显示不包含回答正文的“回答内容暂不可用”安全文案
- **AND** frontend MUST NOT 创建独立“已响应”entry
- **AND** frontend MUST NOT 从 browser request body、composer cache 或其他 attempt 猜测回答

#### Scenario: Correlation never crosses attempts or pending inputs

- **WHEN** 同一 root 存在 retry/edit attempt，或同一 run 先后存在不同 `pendingInputId`
- **THEN** frontend MUST 只关联 session、root、`runId` 与 `pendingInputId` 全部匹配的 event 和 result
- **AND** 较早 attempt 或其他 pending input 的回答 MUST NOT 出现在当前 interaction

#### Scenario: Durable answer without request context joins the matching live interaction

- **WHEN** `USER_INPUT_REQUIRED` 携带 root、run、`requestContextId` 和 `pendingInputId`，而同一 durable conversation answer 只携带相同 root、run 和 `pendingInputId`
- **THEN** frontend MUST 把两者合并为同一个补充信息 entry
- **AND** frontend MUST NOT 把 conversation answer 的 request-id fallback 当作新的 attempt
- **AND** 不同 `runId` 的 answer MUST 继续保持隔离

#### Scenario: Live-only delivery loss recovers from conversation without cursor invention

- **WHEN** 当前页面未收到 live-only `pendingInputAnswer`，随后通过页面刷新、opening reconcile 或 stream gap recovery 加载到 durable result
- **THEN** frontend MUST 从 conversation/history 恢复回答展示
- **AND** frontend MUST NOT 把 live-only result 视为 `lastSeenSequence` 的推进依据
- **AND** frontend MUST NOT 为恢复回答创建额外 stream、额外 request run 或重复 process entry

#### Scenario: Duplicate live or history results are idempotent

- **WHEN** frontend 多次接收相同 attempt、tool call 和 `pendingInputId` 的 answer result
- **THEN** 每次投影后的可见 interaction MUST 与首次完整投影相同
- **AND** 该 `pendingInputId` 的 process entry 数量 MUST 始终为一

### Requirement: Conversation and process history use separate durable facts

Completed conversation SHALL由message query和run event query组合：visible messages提供user、assistant、capability-result和summary内容；persisted timeline events提供completed thinking及其他runtime过程顺序。任何一侧不得重建另一侧的canonical内容，event query不得把live-only thinking或content delta推断为durable history。

#### Scenario: Completed turn combines message and event facts
- **WHEN**run产生completed thinking、persisted capability/lifecycle过程和final answer
- **THEN**conversation query MUST返回最终messages
- **AND**event query MUST返回persisted process facts
- **AND**final answer MUST只取自assistant message

#### Scenario: Process failure does not erase committed answer
- **WHEN**event-history读取暂时失败但assistant message已提交
- **THEN**conversation MUST仍显示final answer
- **AND**UI MAY显示过程暂不可用但不得伪造空过程为成功读取

### Requirement: Live in-progress state converges to completed cold history

当 model invocation 产生累计 thinking delta 时，live path MUST 按到达顺序向 consumer 交付；未产生时 MUST NOT 构造 thinking delta。model invocation 结束时，consumer MUST 接收同 step 最后累计 delta 的 `completed=true` 投影。Cold history MUST 只返回该 persisted completed delta。两条路径在完成态的 reasoning、step、completed state 和 process ordering 上 MUST 等价。

对于已完成 Workflow，settled live 与只使用 visible conversation Message 和 persisted process Event 的 cold history MUST 在安全 lifecycle 状态、completed product、canonical terminal answer 和可见顺序上等价。等价范围 MUST 包括 canonical Tool event/message vocabulary 表示的 completed product，但 MUST NOT 要求恢复调用中的 fragment、瞬时 loading、token cadence 或事件到达时间。

同一 Workflow product identity 的 completed product MUST 替换此前 live fragment；request 到达 completed、failed、canceled、superseded 或 output-guard terminal 后 MUST 清除该 run 仍未被 completed product 替换的 fragment。active run 尚未出现 matching completion 或 terminal fact 时 MUST 继续显示已接收 fragment。

terminal Assistant Message/fact MUST 是完成态 canonical answer。cold history MUST 从同一 terminal fact 恢复该 text，提交前的 Assistant content candidate MUST NOT 形成第二个 completed answer。product TEXT 与 terminal text 完全相同时展示层 MUST 最多显示一次；PIU、DSL、其他 structured product 或不同 TEXT 与 terminal text 同时存在时，两条路径 MUST 保留相同的独立 segments。

**需求类别**：功能性需求

#### Scenario: 完成 delta 收敛 live thinking

- **WHEN** consumer 已显示当前连续 partial thinking entry，随后可能收到同一 model invocation 的 answer `LLM_CONTENT_DELTA`，并在下一个 ProcessPanel 过程 entry 边界前收到 `completed=true` envelope
- **THEN** consumer MUST 更新并 settle 同一 entry
- **AND** MUST NOT 创建重复 thinking entry
- **AND** answer `LLM_CONTENT_DELTA` MUST NOT 关闭该 entry 边界
- **AND** 后续 Capability 或其他 ProcessPanel 过程 event MUST 关闭该 entry 边界，不能仅按 `runId + stepId` 跨边界合并

#### Scenario: 冷历史重建最终过程

- **WHEN** client 关闭并重新打开已完成 conversation
- **THEN** Message 与 Event queries MUST 重建与 live 完成态等价的最终内容和过程
- **AND** MUST NOT 重建调用中的 live-only delta frames

#### Scenario: 突然丢失的进行中 thinking 不得被推断

- **WHEN** 进程在 model invocation 结束前消失且只有 live-only 调用中 delta
- **THEN** cold history MUST NOT 出现该调用中 reasoning
- **AND** system MUST NOT 从 final answer 或其他 event 猜测 thinking

#### Scenario: Workflow 完成态产品收敛 fragment

- **GIVEN** live 已显示 Workflow product fragment
- **WHEN** matching completed product 到达
- **THEN** settled live MUST 删除 matching fragment 并保留 completed product
- **AND** cold history MUST 恢复相同 completed product

#### Scenario: 请求终态清理不可恢复的 Workflow fragment

- **GIVEN** Workflow fragment 没有 matching completed product
- **WHEN** run 到达任一 canonical request terminal fact
- **THEN** settled live MUST 清除该 run 的残留 fragment
- **AND** cold history MUST NOT 恢复或猜测该 fragment

#### Scenario: Workflow 产品与最终回答收敛

- **WHEN** completed Workflow 同时具有 product Event 与 terminal Assistant Message
- **THEN** settled live 与 cold history MUST 保留相同产品结构与 terminal text
- **AND** 完全相同的 TEXT MUST 最多显示一次
- **AND** PIU、DSL、其他非 TEXT structure 或不同 TEXT MUST 与 terminal text 保留相同的独立 segments

#### Scenario: Workflow 隐藏标题时只呈现产品正文

- **GIVEN** completed Workflow product 的可信 output parser metadata 指定 `show_title=false` 且 `show_content=true`
- **WHEN** settled live 或 cold history 呈现该 product
- **THEN** 两条路径 MUST 保留相同的独立 product occurrence 与正文
- **AND** 展示层 MUST NOT 为该 product 生成空标题、独立状态图标、完成对勾或展开按钮
- **AND** 该正文的内容列 MUST 与同层普通节点的 detail 内容列对齐，不得占用状态图标或标题前导区域
- **AND** 该规则 MUST NOT 改变 product Event identity、排序、持久化 owner 或 Capability Result 三档策略

### Requirement: Retry selects process history by visible run

Retry SHALL创建新run且保持旧attempt persisted events不可变。默认过程面板由当前visible assistant message对应runId查询；旧attempt只有显式runId查询时返回。

#### Scenario: Retry does not mix attempts
- **WHEN**原run失败后retry成功
- **THEN**新run event page MUST不包含原run events
- **AND**原run显式查询 MUST仍返回原事实

### Requirement: Process history never affects model context or prefix cache

Context assembly和model request SHALL只消费ActiveContext message refs，不查询runtime event history或fork snapshots。

#### Scenario: Persisted events have no model-input effect
- **WHEN**相同message/context state分别存在和不存在process events
- **THEN**rendered provider messages、token budget和cacheable prefix MUST字节等价

#### Scenario: Fork snapshot has no child-context effect
- **WHEN**child session拥有copied process snapshots并首次submit
- **THEN**model input MUST只来自child active-context messages
- **AND**MUST不包含thinking、snapshot status或timeline payload

#### Scenario: Legacy fork compatibility status has no child-context effect
- **WHEN**child session的copied run返回`LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE`并首次submit
- **THEN**model input MUST只来自child active-context messages
- **AND**MUST不包含thinking、snapshot status或timeline payload

### Requirement: Browser history hydrates process events by visible turn run

TS frontend SHALL compose a completed turn from visible message facts and the persisted event facts for that turn's display run. For each root turn, the frontend MUST prefer the latest visible assistant message `runId`; when no visible assistant message exists, it MUST use the latest visible non-summary message `runId` for that root. Automatic event hydration MUST select only uncached display runs produced by current explicit user intent, the true conversation viewport, or the bounded preload area extending by at most one conversation viewport height above and below the true viewport. Loading a message window alone MUST NOT select every run in that window.

An explicitly expanded process panel and the current preview-navigation target MUST have higher hydration priority than true-viewport and preload-only runs. Preview hover MUST NOT select a run. When message-derived envelopes omit canonical `requestContextId` but carry the selected explicit `runId`, that `runId` MUST identify the same attempt as event-history envelopes for composition; a requestId fallback MUST NOT discard the selected run events. Events with another `runId` MUST NOT enter the turn.

When a persisted completed `LLM_THINKING_DELTA` and a base live or settled thinking envelope share the same non-empty `stepId` within the same `sessionId + runId + rootMessageId`, the persisted event MUST be the canonical projection fact and the base copy MUST NOT create another process entry. Distinct non-empty `stepId` values MUST remain distinct even when their thinking text is equal. When either candidate lacks a non-empty `stepId`, frontend MUST use only exact `eventId` deduplication and MUST NOT infer equivalence from text, adjacent sequence, or segment ordinal.

#### Scenario: Cold history reconstructs a completed thinking process
- **WHEN** a completed turn enters the true conversation viewport
- **AND** its visible assistant message identifies a `runId`
- **AND** that run event history contains a completed thinking delta and persisted capability lifecycle events
- **THEN** the frontend MUST combine those event envelopes with the message-derived envelopes for the same root turn
- **AND** the process panel MUST contain the same completed thinking text and persisted process ordering as the completed live view
- **AND** the final answer MUST still come only from the assistant message

#### Scenario: Persisted completed thinking replaces the live copy
- **GIVEN** a completed turn still retains a live partial or completed thinking envelope
- **WHEN** run-event hydration returns a persisted completed `LLM_THINKING_DELTA` with the same non-empty `stepId`, session, run and root
- **THEN** the process panel MUST render that logical thinking step exactly once
- **AND** reconnect, replay or repeated history composition MUST NOT create another thinking card

#### Scenario: Equal thinking text from distinct steps remains distinct
- **WHEN** one run contains completed thinking events with distinct non-empty `stepId` values and equal text
- **THEN** the process panel MUST retain one entry for each `stepId`
- **AND** MUST NOT use text equality to merge them

#### Scenario: Thinking without a stable step identity is not guessed
- **WHEN** a live or persisted thinking envelope lacks a non-empty `stepId`
- **THEN** frontend MUST deduplicate it only when its exact `eventId` is already present
- **AND** MUST NOT infer identity from text, adjacent sequence or segment ordinal

#### Scenario: Message history omits canonical request context
- **WHEN** visible user and assistant messages carry the selected `runId` but do not expose `requestContextId`
- **AND** the selected run event page carries its canonical `requestContextId` and the same explicit `runId`
- **THEN** the frontend MUST keep the message-derived answer and event-derived process in one visible attempt
- **AND** MUST NOT discard completed thinking because the message adapter fell back to `requestId`

#### Scenario: Retry history selects the visible attempt
- **WHEN** a root turn has events from an old attempt and a visible assistant message from a newer retry run
- **THEN** automatic history hydration MUST query the newer visible `runId`
- **AND** MUST NOT add old attempt events to that turn

#### Scenario: Failed turn without assistant uses its visible run
- **WHEN** a visible failed turn has no assistant message but its visible non-summary message contains a `runId`
- **THEN** the frontend MUST use that run to load the persisted failure process
- **AND** MUST NOT invent an assistant answer

#### Scenario: Capability lifecycle joins durable result content
- **WHEN** a selected run event page contains capability lifecycle envelopes and the visible message page contains the matching `CAPABILITY_RESULT` message
- **THEN** the process entry MUST keep event sequence and terminal state from the event history
- **AND** MUST use the message content only for the matching run and tool correlation
- **AND** MUST NOT create duplicate tool cards

#### Scenario: Capability result message is absent
- **WHEN** a selected run capability terminal event has no matching visible `CAPABILITY_RESULT` message
- **THEN** the process entry MUST show a safe result-unavailable state
- **AND** MUST NOT present the terminal status text as the capability result body

#### Scenario: Message window contains offscreen runs
- **GIVEN** a loaded message window contains display runs outside the true viewport and bounded preload area
- **WHEN** no process panel or preview navigation explicitly targets those runs
- **THEN** frontend MUST NOT query their event history
- **AND** committed messages in the window MUST remain available

#### Scenario: Explicit panel expansion takes priority
- **GIVEN** a historical turn's process history is not cached
- **WHEN** the user expands that turn's process panel
- **THEN** frontend MUST select that run at the highest hydration priority
- **AND** the event query MUST reuse any existing in-flight request for the same `sessionId + runId`

### Requirement: Event history pagination is complete and bounded

For one selected run, TS frontend SHALL request `GET /api/v1/sessions/:sessionId/runs/:runId/events` with `afterSequence=0` and `limit=1000`, then follow each strictly advancing `nextAfterSequence` until the cursor is absent. It MUST reject a repeated or non-advancing cursor as a failed process load.

Across one session, the frontend MUST keep no more than four run event requests in flight, no more than sixteen automatic `VIEWPORT` plus `PRELOAD` hydration targets, and no more than sixteen deduplicated `EXPLICIT` intents keyed by `sessionId + runId`. Automatic targets MUST be replaced from the latest viewport generation. Explicit targets MUST be ordered by monotonically increasing intent generation with the newest intent first. On explicit overflow, frontend MUST displace only the oldest queued or not-started explicit generation, release that generation's expansion demand/pin and preserve the turn's disclosure state. If that turn remains expanded and later becomes demand-eligible, frontend MUST create a new generation before requeueing it. During a surviving session, an already active request MUST retain an active-request pin until its load outcome even if its explicit intent is no longer in the latest sixteen.

All requests for the same `sessionId + runId` MUST coalesce to one registered active request identity. A validated completion MUST commit its run-scoped cache/outcome when the session survives and the completion identity still matches that run's registered active identity, even if its source target generation is no longer current. That commit MUST NOT restore an obsolete target, preview pin or navigation token and MUST NOT move the viewport. Only session teardown or an active-identity mismatch MUST discard a completion. An identity mismatch MUST NOT release or overwrite the currently registered request's slot or pin. A matching normally settled completion MUST release its own slot and active-request pin after commit or safe outcome handling.

Only `FAILED` MUST expose user retry, and retry MUST create a new latest explicit generation without touching cache recency at scheduling time. `LEGACY_UNAVAILABLE` MUST be terminal and MUST NOT expose retry control or issue a retry request. Session teardown MUST cancel queued and in-flight work, release all session demand/pins and publish no new `AVAILABLE`, `FAILED` or `LEGACY_UNAVAILABLE` UI outcome.

#### Scenario: Run process spans multiple pages
- **WHEN** an AVAILABLE event response contains `nextAfterSequence`
- **THEN** the frontend MUST request the next page using that exact cursor
- **AND** MUST merge all pages in canonical sequence order without duplicate `eventId`
- **AND** MUST stop only when `nextAfterSequence` is absent

#### Scenario: Cursor does not advance
- **WHEN** a run event response repeats or decreases `nextAfterSequence`
- **THEN** the frontend MUST stop pagination
- **AND** MUST mark that run process history as failed
- **AND** MUST retain the already committed conversation messages

#### Scenario: Current viewport contains many runs
- **WHEN** more than four distinct display runs remain current hydration targets
- **THEN** the frontend MUST keep at most four run event HTTP requests in flight
- **AND** MUST order queued work by explicit expansion or preview target, true viewport, then preload area
- **AND** MUST eventually process a queued run only while it remains in the current target set

#### Scenario: Seventeen explicit intents keep the latest sixteen
- **GIVEN** four older explicit intents have already started and remain active
- **WHEN** at least seventeen newer explicit intents are published in increasing generation order
- **THEN** the scheduler MUST retain at most the latest sixteen queued or not-started explicit intents
- **AND** MUST displace the oldest queued or not-started explicit intents first
- **AND** displacement MUST release each removed generation's expansion demand/pin without changing its turn disclosure
- **AND** while the session remains alive, the four active requests MUST remain pinned until each reaches one load outcome

#### Scenario: Displaced expanded turn becomes eligible again
- **GIVEN** explicit capacity displaced a queued generation while its panel remained expanded
- **WHEN** the turn later enters viewport, preload or another effective demand source
- **THEN** frontend MUST keep the panel expanded
- **AND** MUST create one newer explicit generation before requeueing the run

#### Scenario: Expansion demand releases on every outcome
- **GIVEN** an expansion selected a historical run and its panel later collapsed or moved offscreen
- **WHEN** the run reaches `AVAILABLE`, `FAILED` or `LEGACY_UNAVAILABLE`
- **THEN** its expansion explicit target and expansion pin MUST be released
- **AND** only `FAILED` MUST permit a retry that creates a newer explicit generation
- **AND** `LEGACY_UNAVAILABLE` MUST issue no retry request

#### Scenario: Fast scrollbar drag crosses many turns
- **GIVEN** the user starts a pointer drag on the conversation scroll viewport
- **WHEN** the pointer crosses more than sixteen uncached historical turns before release
- **THEN** frontend MUST NOT enqueue each crossed run
- **AND** after pointer release it MUST replace the automatic target set with runs from the final true viewport and bounded preload area
- **AND** the in-flight request count MUST remain at most four

#### Scenario: Wheel scrolling continually changes the viewport
- **WHEN** wheel or touchpad scrolling produces multiple scroll events in one animation frame
- **THEN** frontend MUST compute at most one hydration target update for that frame
- **AND** runs removed from the latest target set MUST NOT remain queued

#### Scenario: Automatic replacement does not abort started work
- **GIVEN** started requests were selected separately by viewport, preload and preview
- **WHEN** a newer automatic set and navigation generation replaces all three source targets
- **THEN** frontend MUST remove only queued or not-started work
- **AND** every started request MUST retain its active-request pin until normal outcome

#### Scenario: Obsolete generation commits cache without restoring intent
- **GIVEN** a started request's target generation is no longer current
- **WHEN** its validated completion matches the run's registered active request identity
- **THEN** frontend MUST commit the run-scoped cache/outcome and release that request's slot and pin
- **AND** MUST NOT restore an old target, preview pin or navigation token
- **AND** MUST NOT move the viewport

#### Scenario: Mismatched late completion is discarded
- **GIVEN** a run has a newly registered active request identity
- **WHEN** a late completion from an older request identity arrives
- **THEN** frontend MUST discard that completion
- **AND** MUST NOT release or overwrite the current request's slot, pin or cache

### Requirement: Browser validates event history responses before projection

TS frontend SHALL runtime-validate the event page availability shape, cursor and every `StreamEnvelope` before adding the page to browser state. An invalid page or envelope MUST fail the affected run process load without exposing the invalid payload or raw parser error to the user.

#### Scenario: Event page contains an invalid envelope
- **WHEN** the HTTP response has AVAILABLE availability but an item fails the existing public `StreamEnvelope` validator
- **THEN** the frontend MUST reject the entire run process load
- **AND** MUST retain committed conversation messages
- **AND** MUST expose only the safe retryable process-unavailable state

#### Scenario: Event page contains another run coordinate
- **WHEN** an otherwise valid event envelope has a `sessionId` or `runId` different from the requested run coordinates
- **THEN** the frontend MUST reject the entire run process load
- **AND** MUST NOT add that envelope to any visible turn

#### Scenario: Legacy unavailable response carries forbidden data
- **WHEN** a `LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE` response contains non-empty events or a cursor
- **THEN** the frontend MUST reject the response as invalid
- **AND** MUST NOT render or retain those fields

### Requirement: Message history remains usable when process history is unavailable

Message history and process event history SHALL have independent frontend load outcomes. An event request failure or `LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE` response MUST NOT remove, delay, or replace committed user and assistant messages. The affected turn MUST distinguish loading, retryable failure, legacy unavailable, available-empty, and available-loaded process states.

#### Scenario: Event API fails after messages load
- **WHEN** the message page loads successfully and a selected run event request fails
- **THEN** the conversation MUST immediately retain and display its committed messages
- **AND** the affected turn MUST expose a process-history-unavailable state with a retry action
- **AND** MUST NOT represent the failure as an AVAILABLE empty process

#### Scenario: Fork process history reports the unavailable status
- **WHEN** event history returns `LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE`
- **THEN** the affected forked turn MUST show that historical process details are unavailable for this legacy fork
- **AND** the copied messages MUST remain visible
- **AND** the frontend MUST NOT retry automatically or query a source session

#### Scenario: Available run has no visible events
- **WHEN** event history returns AVAILABLE with an empty completed page
- **THEN** the frontend MUST treat process hydration as successfully complete
- **AND** MUST NOT display a failure or legacy-unavailable notice

### Requirement: History hydration is isolated by session and load version

TS frontend SHALL scope process-history cache, in-flight work, errors and retry state by `sessionId + runId`. Preview navigation, explicit intent, authoritative conversation loading and viewport selection MUST identify their latest generation. A newer generation MUST remove obsolete queued work but MUST NOT cancel started work while the session survives. Session teardown is the only target-lifecycle action that MAY cancel in-flight work; it MUST remove all queued work, release every demand/pin and clear scheduler state without creating a UI outcome. Completion commit eligibility MUST depend on surviving session plus registered active request identity and validation, not on source target generation. Interaction generation continues to guard navigation and target side effects.

#### Scenario: User switches sessions during hydration
- **WHEN** session A has event requests in flight and the user activates session B
- **THEN** a late session A response MUST NOT enter session B envelopes or process state
- **AND** session B MUST hydrate only its own current targets

#### Scenario: Session teardown cancels all hydration lifecycle state
- **GIVEN** a session has queued explicit intents, active requests and pinned runs
- **WHEN** frontend clears or disposes that session
- **THEN** it MUST remove the queue, abort every in-flight request and release all demand/pins
- **AND** late responses MUST be ignored
- **AND** cancellation MUST NOT publish a new `AVAILABLE`, `FAILED` or `LEGACY_UNAVAILABLE` UI outcome

#### Scenario: Newer preview navigation supersedes an older target
- **WHEN** the user selects preview target A and then selects preview target B before A finishes
- **THEN** target B MUST become the current navigation generation
- **AND** queued work that is unique to target A MUST be removed
- **AND** a late result for A MUST NOT move the viewport, replace target B's turn or enter another run

#### Scenario: Older or anchored message window is loaded
- **WHEN** pagination or anchor navigation adds previously unseen display runs
- **THEN** frontend MUST select only uncached runs required by explicit intent, the resulting true viewport or its bounded preload area
- **AND** MUST preserve valid event history already cached for other runs in the session

#### Scenario: Obsolete queued work is removed without canceling started work
- **WHEN** a viewport or navigation generation becomes obsolete
- **THEN** frontend MUST remove its queued or not-started work without displaying process-history failure
- **AND** MUST let its already started requests settle under the active-identity commit rule
- **AND** committed messages and any previously valid process cache MUST remain unchanged until a validated completion commits

#### Scenario: Offscreen disclosure state is independent from cache state
- **GIVEN** an expanded panel's run has reached `AVAILABLE` and later becomes unpinned offscreen
- **WHEN** LRU evicts that run
- **THEN** frontend MUST retain the panel's expanded disclosure state
- **WHEN** the turn returns to viewport or preload demand
- **THEN** frontend MUST keep the panel expanded and issue exactly one reload for the missing run cache

### Requirement: Optimistic Turn Binds To The Matching Canonical Run Before Projection

当用户执行 submit、retry 或 edit 并产生新的 accepted run 时，TS frontend SHALL 将本地 optimistic Turn 与 backend canonical `requestId`、`runId`、`requestContextId` 分别关联，MUST NOT 假设三者相等，也 MUST NOT 让同一个 frontend identity 字段依据 HTTP 与 stream 的到达顺序分别表示 `runId` 或 `requestContextId`。

在匹配当前 pending action 的第一条 canonical live envelope 进入 conversation projection 前，frontend SHALL 将 optimistic root 与 live attempt 作为一次不可分割的 identity binding 完成。只要该 envelope 的 session 和已确认的 canonical request/run identity 匹配，即使客户端没有观察到 `REQUEST_ACCEPTED`，该 envelope 也 MUST 被接纳到同一个 Turn；frontend MUST NOT 因 provisional attempt 与 canonical `requestContextId` 不同而静默丢弃该 envelope。

Identity binding MUST 仅作用于当前 session 的 matching pending action。旧 attempt、其他 run、其他 session、history-load envelope、invalid envelope 或无法证明关联的 terminal MUST NOT 接管或重键当前 optimistic Turn。

#### Scenario: HTTP acceptance precedes the first visible stream event

- **GIVEN** 用户提交问题后，HTTP 已返回 canonical `requestId` 和 `runId`
- **AND** 当前页面没有观察到该 run 的 `REQUEST_ACCEPTED`
- **WHEN** 同一 request/run 的第一条 stream envelope 是 thinking、正文或 capability detail，并携带独立的 `requestContextId`
- **THEN** frontend MUST 在投影该 envelope 前完成 optimistic root 和 attempt identity binding
- **AND** 界面 MUST 保持一个连续 Turn，同时显示原 optimistic 用户消息和收到的执行内容
- **AND** 后续同一 run 的 live envelope MUST 继续更新该 Turn

#### Scenario: Stream acceptance precedes the HTTP response

- **GIVEN** 用户提交问题后，stream `REQUEST_ACCEPTED` 先于 HTTP response 到达
- **WHEN** HTTP response 随后返回同一 canonical `requestId` 和 `runId`
- **THEN** frontend MUST 合并两侧已经确认的 identity
- **AND** HTTP `runId` MUST NOT 覆盖 stream `requestContextId` 的 attempt 语义
- **AND** 界面 MUST NOT 出现重复 Turn、正文丢失或 process detail 分裂

#### Scenario: Ordinary live events and terminal precede the HTTP response

- **GIVEN** 用户提交或编辑问题后，session live-tail 已收到同一 canonical root/run 的 thinking、正文、capability detail 或 terminal
- **AND** 当前 HTTP response 尚未返回，frontend 因此不能仅凭时间接近让这些普通事件接管 pending Turn
- **WHEN** HTTP response 随后确认该 canonical `requestId` 和 `runId`
- **THEN** frontend MUST 在一次 conversation projection transition 中采用既有 exact root/run bucket 的 `requestContextId`
- **AND** local optimistic USER、已接纳的 detail/正文以及 matching terminal MUST 合并到同一个 active 或 settled Turn
- **AND** 已接纳的 terminal MUST 在 HTTP identity 确认后结束“执行中”状态
- **AND** frontend MUST NOT 因该 run 此前被记录为 covered 而跳过合并或丢弃 terminal

#### Scenario: A different live acceptance cannot permanently claim the pending action

- **GIVEN** 当前用户 action 的 HTTP response 尚未返回
- **AND** 同一 session 的另一个 live `REQUEST_ACCEPTED` 在此期间到达并形成 stream candidate
- **WHEN** 当前 action 的 HTTP response 返回不同的 canonical `requestId` 或 `runId`
- **THEN** frontend MUST 以 HTTP identity 重新关联 local optimistic USER anchor
- **AND** candidate run 的 canonical envelope MUST 与 HTTP-confirmed run 保持隔离
- **AND** candidate run 的 terminal MUST NOT 结算 HTTP-confirmed pending action
- **AND** HTTP identity 确认前 frontend MUST NOT 把 candidate root 暴露为当前 action 的 Stop/Cancel target

#### Scenario: Matching terminal is the first recovered event

- **GIVEN** HTTP 已确认当前 pending action 的 canonical `requestId` 和 `runId`
- **AND** 当前页面此前没有接纳该 run 的 live detail
- **WHEN** 第一条恢复到达的 matching envelope 是 terminal，并携带 canonical `requestContextId`
- **THEN** frontend MUST 先完成 identity binding，再把同一 Turn 迁移到 settled presentation
- **AND** optimistic “执行中”状态 MUST 结束
- **AND** frontend MUST NOT 制造 timeout terminal 或依赖页面刷新完成结算

#### Scenario: Partial detail is followed by the matching terminal

- **GIVEN** frontend 已在当前 Turn 中接纳同一 request/run 的部分 thinking、正文或 capability detail
- **WHEN** matching terminal envelope 到达
- **THEN** terminal MUST 进入同一 attempt 并结束执行中状态
- **AND** 已接纳的正文和 process detail MUST 保留
- **AND** 界面 MUST NOT 停留在部分内容加“执行中”的状态

#### Scenario: Late event from an older attempt remains isolated

- **GIVEN** 同一 root 已因 retry 或 edit 产生较新的 accepted run
- **WHEN** 较旧 run 或较旧 `requestContextId` 的非匹配 live envelope 迟到
- **THEN** frontend MUST NOT 用旧 identity 重键当前 optimistic、active 或 settled Turn
- **AND** 旧 envelope MUST NOT 覆盖较新 attempt 的正文、process detail 或 terminal 状态

#### Scenario: Retrying a history-loaded Turn preserves canonical history identity

- **GIVEN** 页面刷新后，同一 Turn 的 USER 和旧 ASSISTANT 内容来自 history load，且不存在 local optimistic envelope
- **WHEN** 用户 retry 该 Turn，并由 HTTP acceptance 或 matching live envelope 确认新的 run
- **THEN** frontend MUST 保留 canonical USER history identity，并从当前 presentation 移除旧 ASSISTANT 内容
- **AND** frontend MUST NOT 把 history-load envelope 的 `runId` 或 `requestContextId` 重键为新 run
- **AND** 新 run 的 live envelope MUST 使用自身 identity 建立新的 active/settled attempt

### Requirement: Browser process-history cache remains coherent and bounded

TS frontend MUST retain process-history state and validated event envelopes as one `sessionId + runId` cache fact. It MUST evict both together. A run whose event envelopes have been evicted MUST NOT remain observable as an `AVAILABLE` cached run.

After a normally settled load outcome, only `VIEWPORT`, `PRELOAD`, current preview, active request or live run MAY keep a run pinned. During a surviving session, every started run-event request, whether selected by `EXPLICIT`, `VIEWPORT`, `PRELOAD` or preview, MUST retain an active-request pin until normal outcome. Collapse/offscreen movement, automatic target replacement, preview replacement and navigation generation supersession MUST remove only queued/not-started work and MUST NOT abort a started request. Explicit overflow MUST displace only the oldest queued or not-started generation, release that generation's expansion demand/pin and preserve disclosure view state. If the turn remains expanded and later re-enters effective demand eligibility, frontend MUST create a new generation before queueing it again.

The cache MUST permit pinned facts to exceed capacity temporarily. On release of the final pin for a run, frontend MUST synchronously enforce a whole-run least-recently-used bound of at most 64 unpinned `AVAILABLE` runs and at most 2,000 unpinned envelopes for the session. It MUST evict a run's state and all of its envelopes atomically and MUST NOT truncate one run. `lastAccessedAt` MAY change only when an `AVAILABLE` result is successfully committed, including retry success, or when a cached `AVAILABLE` run transitions from absent to present in the effective demand set and is actually reused. Scheduling retry, observer publication, render or snapshot reads, pin-only changes and same-generation target refresh MUST NOT touch recency.

#### Scenario: Cached process remains inspectable after other runs load
- **GIVEN** a completed turn has an `AVAILABLE` cached run with completed thinking
- **WHEN** event pages for additional turns finish loading
- **THEN** reopening the first turn MUST still show its completed thinking while that run remains cached
- **AND** loading another run MUST NOT remove the first run's event envelopes while leaving its state `AVAILABLE`

#### Scenario: Evicted run becomes loadable again
- **GIVEN** an offscreen, unexpanded run is selected for cache eviction
- **WHEN** the eviction completes
- **THEN** its cached state and event envelopes MUST both be absent
- **WHEN** that turn later re-enters the true viewport or the user explicitly expands it
- **THEN** frontend MUST allow a new event query for that run

#### Scenario: Current demand and active requests are pinned
- **WHEN** cache capacity is exceeded
- **THEN** frontend MUST NOT evict a run selected by viewport, preload, current preview, active request or live-run demand
- **AND** it MUST select only unpinned runs for capacity eviction

#### Scenario: Final pin release enforces whole-run limits immediately
- **GIVEN** pinned runs have temporarily exceeded 64 unpinned available runs or 2,000 unpinned envelopes
- **WHEN** the last pin for a run is released
- **THEN** the same observable cache snapshot MUST contain at most 64 unpinned available runs and 2,000 unpinned envelopes
- **AND** every evicted run's state and envelopes MUST disappear together

#### Scenario: Reads and retry scheduling do not change recency
- **GIVEN** an unpinned cached `AVAILABLE` run and a `FAILED` run
- **WHEN** the available run is rendered or read repeatedly and retry is scheduled for the failed run
- **THEN** neither action MUST change cache recency
- **WHEN** retry later commits `AVAILABLE`, or an absent demand starts actually reusing the cached available run
- **THEN** that successful commit or actual reuse MUST update recency

### Requirement: Thinking live-history handoff keeps one canonical step

当 frontend 为同一 turn 组合 live、settled 与持久化 run event envelopes 时，它 MUST 使用 `sessionId + runId + rootMessageId + stepId` 作为 thinking step 的稳定身份。pure-live layer 中同一稳定身份的累计 snapshots MUST 按 canonical chronological order 只投影最后一条；settled layer 已包含该稳定身份的 `completed=true` `LLM_THINKING_DELTA` 时，frontend MUST 保留该完成态并移除随后叠加的同 step live partial/completed copies；event history 包含该完成态时，frontend MUST 把持久化完成态作为 canonical copy，并移除 base layer 中同一稳定身份的全部 copies。相同 live overlay 或 event history 再次进入投影时，frontend MUST 保持相同的单份可见结果。

不同稳定身份的 thinking MUST 保持为不同过程步骤，即使它们的文本相同。当任一 thinking envelope 缺少非空 `stepId`、不属于同一 session、run 或 root 时，frontend MUST NOT 按文本、sequence、完成状态或出现顺序推测其身份；这种 envelope 只适用既有 `eventId` 去重和坐标隔离规则。

#### Scenario: Pure-live cumulative snapshots replace the previous copy
- **GIVEN** 同一 session、run、root 和 `stepId` 的 live layer 依次收到较短与较长累计 thinking snapshots
- **WHEN** frontend 投影当前 turn
- **THEN** 过程面板 MUST 只形成一个 thinking step
- **AND** 该 step MUST 使用 canonical chronological order 中最后一条 snapshot
- **AND** frontend MUST NOT 通过文本包含关系或长度选择 snapshot

#### Scenario: Persisted completed thinking replaces live copies
- **GIVEN** 同一 session、run、root 和 `stepId` 的 base layer 同时包含 live partial 与 live completed thinking
- **WHEN** 对应 event history 返回该 step 的持久化 `completed=true` thinking
- **THEN** 过程面板 MUST 只显示持久化完成态的完整 thinking
- **AND** MUST NOT 显示该 step 的 live partial 或第二份 live completed copy

#### Scenario: Settled completed thinking replaces the retained live copy
- **GIVEN** 未刷新页面的 settled layer 已包含某稳定 step 的 completed thinking
- **AND** live layer 仍保留相同稳定 step 的 partial 或 completed cumulative envelope
- **WHEN** frontend 叠加 settled 与 live turn envelopes
- **THEN** 过程面板 MUST 只显示 settled completed thinking
- **AND** 刷新后从 event history 恢复的可见结果 MUST 与未刷新页面一致

#### Scenario: Repeated history hydration remains idempotent
- **GIVEN** 持久化完成态已经替代同一稳定 step 的 live copies
- **WHEN** 相同 event history 因重连、缓存复用或重复组合再次进入 turn projection
- **THEN** 可见 thinking step 的数量和内容 MUST 与首次完成组合后相同

#### Scenario: Equal text from different steps remains distinct
- **WHEN** 两条 thinking envelopes 的文本相同但 `stepId` 不同
- **THEN** frontend MUST 保留两个不同过程步骤
- **AND** 任一持久化完成态 MUST NOT 移除另一个 `stepId` 的 live copy

#### Scenario: Missing step identity uses conservative fallback
- **WHEN** live thinking 与持久化完成态具有不同 `eventId` 且任一 envelope 缺少非空 `stepId`
- **THEN** frontend MUST NOT 因文本、sequence 或完成状态相同而合并两条 envelope
- **AND** 只有 `eventId` 精确相同的 envelope 才能由既有去重规则合并

#### Scenario: Thinking identity never crosses turn coordinates
- **WHEN** 两条 thinking envelopes 具有相同 `stepId` 但 session、run 或 root 中至少一个坐标不同
- **THEN** frontend MUST NOT 把它们视为同一 thinking step
- **AND** 其他 run 或 root 的 event MUST NOT 进入当前 turn

### Requirement: Active run does not hydrate its own event history

当 turn 对应的 run 仍是 `ACCEPTED`、`QUEUED`、`PLANNING` 或 `EXECUTING` 时，frontend MUST NOT 为该 run 生成 automatic process-history target，也 MUST NOT 因用户展开该 turn 的过程面板而生成 explicit process-history target。active run 的可恢复流内容 MUST 继续由既有 active-run scoped stream replay 提供，frontend MUST NOT 以 run event-history REST 查询建立平行恢复路径。

当同一 run 进入 `COMPLETED`、`FAILED`、`CANCELED` 或 `SUPERSEDED` 时，frontend MUST 重新计算 process-history eligibility；终态 turn 若仍处于可见、预加载、预览跳转或用户展开范围，MUST 按既有优先级、容量、并发、缓存、取消与重试规则成为 history target。该 eligibility 变化 MUST NOT 依赖 `runId` 发生变化。

#### Scenario: Visible active turn does not request event history
- **GIVEN** 一个带 `runId` 的 active turn 位于 viewport 或 preload 范围
- **WHEN** frontend 发布 automatic process-history targets
- **THEN** targets MUST NOT 包含该 active run

#### Scenario: Expanding an active process panel does not request event history
- **GIVEN** 一个 active turn 的过程面板由用户展开
- **WHEN** frontend 处理 explicit history target
- **THEN** frontend MUST NOT 为该 run 调用 event-history API
- **AND** live 过程内容 MUST 继续来自当前 stream projection

#### Scenario: Terminal transition enables history hydration
- **GIVEN** 一个可见 turn 的 root 与 `runId` 保持不变
- **WHEN** 该 run 从 active 状态进入 terminal 状态
- **THEN** frontend MUST 重新发布 eligibility
- **AND** 该 run MUST 可以按既有 automatic 或 explicit 规则加载 event history

#### Scenario: Active-run replay remains the recovery path
- **GIVEN** 页面刷新或 stream 重连时 conversation bootstrap 返回 active run
- **WHEN** frontend 恢复该 run
- **THEN** frontend MUST 使用既有 exact-run scoped replay 恢复可恢复事件
- **AND** MUST NOT 依赖当前 run 的 event-history hydration

#### Scenario: Completed historical turns remain eligible
- **GIVEN** 同一会话中存在已完成的可见、预加载或预览目标 turn
- **WHEN** 当前最新 run 仍在执行
- **THEN** 已完成 turn MUST 继续按既有受控调度规则加载 process history
- **AND** active run 排除 MUST NOT 禁用其他历史轮次

### Requirement: 过程历史从消息正文与事件时序联合恢复

当用户刷新、重连、重新打开会话或加载历史窗口时，系统 MUST 使用可见会话 Message 恢复已完成对话正文，并使用可恢复 process Event 恢复过程顺序与状态。ordinary process Event 携带 `messageId` 时，系统 MUST 在服务端按 Owner Scope、Agent Scope、`sessionId`、`requestId`、`runId`、Message type 和适用时 `toolCallId` 关联已持久化 Message，并 MUST 从该 Message 生成过程正文；系统 MUST NOT 从 Event 中的正文副本重建该内容。

对于由 `workflow-event-history` 定义的 message-free Workflow lifecycle，history MUST 直接恢复其安全 identity/status，MUST NOT 查询或猜测 inner Message，也 MUST NOT 因缺少 Message 增加 `contentUnavailable`。对于该规格定义的 completed Workflow product，history MUST 从 persisted product Event 恢复产品内容；terminal answer MUST 继续从 Assistant Message 恢复。ordinary Message-backed process MUST 继续遵循 Message association 规则。

历史响应 MUST 只返回与实时流相同的安全过程投影，MUST NOT 返回原始隐藏 Message、persistence-owned trace，或要求浏览器额外读取隐藏 Message 完成关联。不满足 message-free Workflow 资格的 Event MUST 沿用既有 association failure、content-unavailable 或 safe projection failure 行为，MUST NOT 借该例外恢复正文。

**需求类别**：功能性需求

#### Scenario: 重新打开会话恢复执行说明

- **WHEN** 一个已完成 Tool 轮次具有公开说明 Message 和引用该 Message 的可恢复 Event
- **AND** 用户重新打开包含该轮次的历史会话
- **THEN** 历史过程 MUST 在 Event 原有顺序位置显示该 Message 的安全公开说明
- **AND** 同一说明 MUST 最多显示一次
- **AND** 该说明 MUST 作为执行详情大面板内的正文直接呈现，不新增第二层 disclosure
- **AND** 该说明 MUST 位于关联 Tool 调用之前，并连接其前置 thinking 与后续 Tool 调用
- **AND** 该说明 MUST NOT 显示独立标题、独立状态图标、完成对勾、展开按钮或系统额外添加的固定引导文案
- **AND** 既有 thinking、Tool、PIU 和普通过程步骤的 disclosure 规则 MUST 保持不变
- **AND** 最终 Assistant Message MUST 继续显示在既有最终答案位置

#### Scenario: 历史 Tool 过程与实时投影一致

- **WHEN** 同一运行的 Tool 调用和 Tool 结果同时具有 Message 事实与可恢复 Event
- **THEN** 实时流与历史读取 MUST 对每个 `toolCallId` 生成相同的安全 Tool 过程内容、顺序和终态
- **AND** 历史读取 MUST NOT 因 Message 与 Event 各保存一份正文而生成重复过程项

#### Scenario: 浏览器不读取隐藏消息完成关联

- **WHEN** 浏览器请求一个运行的过程历史
- **THEN** 服务端响应 MUST 已经完成 Message 与 Event 的安全关联
- **AND** 响应 MUST NOT 包含用于关联的原始隐藏 Message 集合
- **AND** 浏览器 MUST NOT 额外请求原始隐藏 Message 来恢复过程正文

#### Scenario: Direct Workflow 从两类 durable fact 恢复

- **WHEN** Direct Workflow 已提交 terminal Assistant Message 和 persisted Workflow lifecycle/product Events
- **AND** 用户在没有 active/settled browser cache 时重新打开会话
- **THEN** conversation history MUST 从 Assistant Message 恢复 canonical terminal answer
- **AND** run history MUST 从 Workflow Events 恢复 safe lifecycle 与 completed product
- **AND** history MUST NOT 要求 Workflow inner Message

#### Scenario: Workflow-as-Tool 保留 outer protocol 与 inner process

- **WHEN** model loop 通过 Workflow Tool 完成一个轮次
- **THEN** history MUST 从 outer model protocol Message 恢复 Workflow Tool 调用与结果
- **AND** history MUST 从 inner Workflow Events 恢复节点过程
- **AND** inner process MUST NOT 被恢复为第二组 model protocol Message

#### Scenario: Workflow-as-Tool inner process 归入 outer Workflow 折叠区

- **GIVEN** Workflow-as-Tool inner Event 的可信 `parentToolCallId` 与 outer Workflow Tool 的 `toolCallId` 相同
- **WHEN** active live、settled live 或 cold history 呈现 Workflow Tool 调用
- **THEN** matching inner lifecycle/product MUST 位于 outer Workflow 条目的折叠内容内
- **AND** active live MUST 先呈现默认展开的 outer Workflow 执行中条目，再在其内部呈现 matching inner lifecycle/product
- **AND** outer completion MUST 更新同一条目为已完成，并沿用既有 completed 自动折叠行为
- **AND** outer 条目折叠时 MUST 隐藏 matching inner entries，展开时 MUST 按原有产品顺序与子条目 disclosure 语义呈现
- **AND** outer Capability Result 的 `STATUS_ONLY`、`SUMMARY`、`DETAIL` 策略 MUST NOT 删除或裁剪 nested inner product
- **AND** Direct Workflow 或缺少可信 matching parent 的 entry MUST 保持既有顶层语义，展示层 MUST NOT 根据相邻顺序猜测父子关系

#### Scenario: 普通 Capability 缺少 Message 时保持 closed

- **WHEN** ordinary Capability lifecycle 缺少有效 Message 引用或唯一 matching Message
- **THEN** 系统 MUST NOT 把它作为 Event-owned Workflow process 恢复
- **AND** MUST 使用既有 Message association failure 或 content-unavailable 行为

#### Scenario: 过程失败不删除已提交回答

- **WHEN** Workflow process history 读取或安全投影失败但 terminal Assistant Message 已提交
- **THEN** conversation MUST 仍显示 canonical final answer
- **AND** process area MUST 沿用既有安全过程不可用投影
- **AND** 系统 MUST NOT 把缺失过程伪装为完整恢复

### Requirement: 过程历史关联失败显式降级

当历史事件引用的消息不存在、不可读、作用域不一致、类型不匹配、内容损坏或无法完成安全投影时，系统 MUST 保留该事件可安全公开的顺序、类型和状态，并将正文结果标记为不可用。系统 MUST NOT 使用事件 payload 中的正文字段、其他会话消息、前端缓存或 Tool 本地状态补齐内容。

当历史事件不存在 `messageId` 时，系统仅在当前会话、请求、运行、消息类型和适用时 `toolCallId` 能够唯一确定一条目标消息时 MUST 使用该消息恢复正文；不能唯一确定时 MUST 使用相同的仅状态降级。该关联 MUST 使用同一安全投影和作用域校验。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复

**适用范围**：该 Function

#### Scenario: 目标消息缺失时保留过程顺序

- **WHEN** 历史事件携带的 `messageId` 在当前可信作用域内不存在
- **THEN** 历史响应 MUST 保留该事件的安全顺序、类型和状态
- **AND** 正文 MUST 显示为不可用
- **AND** 系统 MUST NOT 回退到事件 payload 中的正文字段

#### Scenario: 无消息引用事件只能在唯一匹配时恢复

- **WHEN** 一个历史事件没有 `messageId`
- **AND** 当前会话、请求、运行、消息类型和 `toolCallId` 恰好匹配一条消息
- **THEN** 系统 MUST 使用该消息生成安全正文
- **AND** 若匹配结果为零条或多于一条，系统 MUST 仅返回安全状态
- **AND** 若完整候选集合超过单次有界关联上限，系统 MUST 仅返回安全状态，不得从截断候选集合猜测

#### Scenario: 读取故障不伪装成完整历史

- **WHEN** 消息读取、事件读取或消息安全投影失败
- **THEN** 系统 MUST 返回安全的失败或内容不可用结果
- **AND** 系统 MUST NOT 将缺失过程正文标记为完整恢复

### Requirement: 大会话过程历史关联保持有界

过程历史恢复 MUST 使用有界消息页和事件页完成服务端关联，MUST NOT 为单条事件或单条消息发起独立 Web 请求。对于单会话至少包含 10,000 个可见 `USER` 轮次且每轮包含多个 thinking 与 Tool 过程项的容量用例，消息与事件关联引入的额外 Web 请求数 MUST 为每个被加载运行 0 个；关联所需数据 MUST 在该运行既有过程历史请求的服务端处理范围内取得。

用户连续快速点击会话预览项、拖动滚动条滑块、点击滚动条轨道或连续使用鼠标滚轮/触控板时，过程历史请求的同时在途数量 MUST NOT 超过 4。相邻自动目标变化的间隔不超过 120 ms 时，系统 MUST 只更新最新目标且 MUST NOT 启动新的自动请求；最后一次自动目标变化后连续 120 ms 没有新变化时，系统 MUST 至多发布一个包含最新至多 16 个目标的自动请求批次。被新目标替代的未开始请求 MUST 被取消或合并；已经开始的旧目标请求无论完成或取消，其结果 MUST NOT 覆盖较新的活动目标。用户主动展开或重试一个确定运行时，系统 MUST 不等待该 120 ms 自动目标窗口。

**需求类别**：系统质量属性

**质量属性**：性能/容量

**适用范围**：该 Function

#### Scenario: 一万用户轮次历史不产生关联 N+1 请求

- **GIVEN** 一个会话包含至少 10,000 个可见 `USER` 轮次
- **AND** 每个轮次包含至少两个 thinking 过程项、两个 Tool 调用过程项和两个 Tool 结果过程项
- **WHEN** 用户打开任一历史窗口并加载其中运行的过程历史
- **THEN** 每个运行 MUST 只使用既有过程历史请求取得最终安全投影
- **AND** 消息关联 MUST NOT 为该运行增加逐事件或逐消息 Web 请求

#### Scenario: 快速导航保持固定在途上限

- **WHEN** 用户通过预览点击、滚动条滑块拖动、滚动条轨道点击或连续滚轮/触控板输入快速跨越任意数量的历史轮次
- **THEN** 同时在途的过程历史请求数量 MUST 不超过 4
- **AND** 旧目标响应 MUST NOT 覆盖较新的活动目标
- **AND** 相邻自动目标变化间隔不超过 120 ms 时 MUST 不启动新的自动请求
- **AND** 最后一次变化后的 120 ms 安静窗口结束时 MUST 至多发布一个包含最新至多 16 个目标的自动请求批次

#### Scenario: 主动展开和重试不等待自动目标窗口

- **WHEN** 用户主动展开一个确定运行的过程面板或重试该运行的过程历史加载
- **THEN** 系统 MUST 不等待 120 ms 自动目标安静窗口，并将该运行提交给既有有界调度器
- **AND** 全局同时在途数量 MUST 继续不超过 4

#### Scenario: 过程关联不阻塞已加载历史浏览

- **WHEN** 目标运行的过程消息关联尚未完成或已降级
- **THEN** 已加载的会话消息和其他已完成运行 MUST 保持可浏览
- **AND** 用户滚动、预览定位和返回最新消息入口 MUST 保持可响应

### Requirement: 结构化过程正文使用单一 Message 恢复

对于已经具有 canonical `CAPABILITY_RESULT` Message carrier 的 ordinary Capability 语义结果，系统 MUST 只持久化一份 Message 语义正文。对应 `CAPABILITY_COMPLETED` 与其他 ordinary lifecycle Event MUST NOT 持久化第二份 Message 或 Event body。

经过受治理 producer 的 canonical shape validation、安全过滤和 structured-delta 识别，并由 `tool-structured-delta` persistence rules 选为 durable history 的 `TOOL_STRUCTURED_DELTA`，在 canonical Message 尚不能分别承载语义结果与最终 structured presentation snapshot 的兼容阶段，MUST 作为独立、封闭的 Channel/UI 过渡 presentation Event 持久化。该 Event MUST NOT 取代 Message 的语义结果所有权，MUST NOT 进入模型上下文，也 MUST NOT 反向改变 Capability outcome、request terminal status、degradation、新的 request-level terminal fact 或 annotation。

Conversation history 在同一 run 的同一 `toolCallId` 存在通过既有 process-history eligibility 过滤的可信 persisted structured presentation Event 时 MUST 使用该 Event 集合恢复 process presentation，MUST NOT 同时从 `CAPABILITY_RESULT` Message 再产生第二份 structured presentation。只有该 `toolCallId` 不存在可信 eligible persisted structured presentation Event 时，history MAY 从 stored Message 识别 canonical structured event shape并恢复 legacy compatibility envelope；该 fallback MUST NOT 创建新的 durable body。ordinary non-Workflow `ANSWER` Event MUST 继续由 canonical answer filter 排除，history MUST 保留对应的 Message-derived answer projection。

当 stored `CAPABILITY_RESULT` Message 不匹配 canonical structured event shape 时，history MUST 继续产生 ordinary `CAPABILITY_RESULT_DELTA` projection，MUST NOT 构造 structured presentation。structured presentation 例外 MUST NOT 被 ordinary Tool、Skill、Bash、LLM、ApiCall、CLIP 或 arbitrary self-reported output 绕过。qualified Workflow inner product 的 Event-owned 例外继续只由 `workflow-event-history` 定义。最终 Assistant answer 继续从 Assistant Message 恢复。

**需求类别**：功能性需求

#### Scenario: 持久化结构化呈现优先于Message兼容投影

- **GIVEN** 同一 run 与 `toolCallId` 同时存在 `CAPABILITY_RESULT` Message 和可信 persisted `TOOL_STRUCTURED_DELTA` Event
- **WHEN** history 合并该 Tool 调用的 presentation
- **THEN** history MUST 使用 persisted Event 集合
- **AND** MUST NOT 同时从 Message 生成第二份 structured presentation
- **AND** Message MUST 继续供模型上下文使用

#### Scenario: legacy历史从stored Message恢复结构化呈现

- **GIVEN** 一个 legacy Tool 调用没有可信 persisted structured presentation Event
- **AND** stored `CAPABILITY_RESULT` Message 包含匹配 canonical structured event shape 的 payload
- **WHEN** history 恢复该 Tool 调用
- **THEN** history MAY 产生安全 `TOOL_STRUCTURED_DELTA` compatibility envelope
- **AND** envelope MUST 保留 canonical `toolEventType`、`toolMessageType` 与 content
- **AND** history MUST NOT 创建第二份 durable body

#### Scenario: 非结构化payload保持ordinary result projection

- **WHEN** stored `CAPABILITY_RESULT` Message payload 不匹配 canonical structured event shape
- **THEN** history MUST 产生既有 `CAPABILITY_RESULT_DELTA` projection
- **AND** MUST NOT 构造 structured presentation

#### Scenario: ordinary ANSWER继续使用Message-derived projection

- **GIVEN** 同一 run 与 `toolCallId` 同时存在 ordinary non-Workflow `ANSWER` Event 和可识别的 `CAPABILITY_RESULT` Message
- **WHEN** history 合并该 Tool 调用的 answer presentation
- **THEN** persisted `ANSWER` Event MUST 由 canonical answer filter 排除
- **AND** history MUST 保留 Message-derived structured answer projection

#### Scenario: 不同Tool调用不得互相抑制兼容投影

- **GIVEN** 同一 run 的 Tool A 有 persisted structured presentation Event
- **AND** Tool B 只有可识别的 legacy `CAPABILITY_RESULT` Message
- **WHEN** history 合并两个 Tool 调用
- **THEN** Tool A MUST 使用 Event presentation
- **AND** Tool B MUST 保留 Message-derived compatibility presentation

#### Scenario: Workflow product使用独立Event-owned例外

- **WHEN** qualified Workflow inner product 没有 canonical Message carrier
- **THEN** completed product body MUST 使用 `workflow-event-history` 定义的 durable Event owner
- **AND** 该例外 MUST NOT 改变 ordinary Capability 语义结果或 terminal answer 的 Message owner

#### Scenario: string payload的structured history恢复（DEFERRED）

- **WHEN** public Capability result contract 接受 CLIP string payload，且 stored `CAPABILITY_RESULT` Message 包含该 payload
- **THEN** history MUST 产生 `toolEventType: "ANSWER"`、`toolMessageType: "TEXT"` 的 `TOOL_STRUCTURED_DELTA` envelope
- **AND** 在 public Capability result contract 不接受 string payload 时，本 Scenario MUST NOT 改变当前输入值域或形成当前实施任务

