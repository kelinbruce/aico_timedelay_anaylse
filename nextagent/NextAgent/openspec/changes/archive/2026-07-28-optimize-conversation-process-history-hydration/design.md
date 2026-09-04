## 当前实现基线（Current Baseline）

### 现有对象与调用链

- `frontend/agent-web/src/features/chat/history/processHistory.ts`
  - `selectVisibleProcessRunTargets(messages)` 按 `message.visible` 分组并选择每个 root 的 display run。这里的 `visible` 是 persisted message visibility，不是浏览器真实视口。
  - `loadCompleteRunProcessHistory()` 通过现有 `sessionService.loadRunEvents` 完成单 run 分页、游标推进、坐标校验、按 `eventId` 去重和顺序归并。
  - `runProcessHistoryQueue()` 对一次传入的数组启动至多四个 worker；数组创建后不会随视口和导航意图变化。
- `frontend/agent-web/src/state/conversationStore.ts`
  - authoritative conversation load、older/newer pagination 和 anchored load 都会把当前 message 集合交给 `hydrateProcessHistoryTargets()`。
  - `hydrateProcessHistoryTargets()` 立即把全部 uncached display run 标记为 `LOADING`，并为每次调用创建一条新的 queue。
  - `acquireProcessHistorySlot()` 只限制 active request 数量，不限制多个 queue 产生的累计 waiter。
  - 每个 run 完成后，`rebuildSelectedProcessHistoryLayer()` 重新转换全部 history messages，再把全部 selected `AVAILABLE` run envelopes 扁平合并到 `historyEnvelopesBySession`。
  - `withSessionCacheUpdate()` 对 session envelope 层执行容量裁剪；run state 和该全局 envelope 层不是一个原子缓存事实。
- `frontend/agent-web/src/pages/ChatPage.tsx`
  - preview rail 已按固定 marker window 虚拟化，最多两个 preview 请求并行；hover 只使用 marker 数据。
  - preview click 在目标不属于当前 message window 时调用 `loadAnchoredConversation()`，渲染后滚动到 target。
  - 主对话滚动容器已区分 wheel、pointer 和 keyboard 意图，并拥有 anchored older/newer 加载及 reading-anchor 保持逻辑。
- `MessageList` 按 display run 把 `RunProcessHistoryState` 传给 `TurnBlock`；`ProcessPanel` 直接把 `LOADING` 映射为“正在加载历史过程详情…”。当请求快速完成时，该文案在过程摘要标题位置短暂出现后消失。

### 现有测试与约束

- process-history unit tests 已覆盖 display run 选择、单 run 完整分页、错误/legacy/empty 状态、run 去重和同时最多四个 active request。
- conversation store tests 已覆盖 authoritative/older/newer/anchored 加载、会话隔离、retry 和已缓存 run 复用。
- ChatPage tests 已覆盖 preview window 有界加载、hover card、loaded/unloaded marker 跳转和 anchored 滚动行为。
- TurnBlock tests 已覆盖 history loading/failure/legacy 文案、completed thinking 可展开和 live entry 折叠生命周期。
- host ownership architecture test 已禁止 host shell 创建平行 process cache 或 run event 查询。
- 当前测试没有覆盖真实视口目标、多个并存 queue 的 pending 总量、快速滚动目标替换、run 级容量淘汰、超过全局 envelope 容量后的 think 可见性，以及 loading 标题的短暂闪烁。

### 已知 gap

1. message window 被误用为真实视口，加载范围随历史分页增长。
2. active request 有上限，但待执行 waiter 无 session 级总上限，且旧 queue 不会被新视口目标替换。
3. authoritative load 通过 abort/version 重置全部 `LOADING` run，快速导航可能让同一 run 重复进入调度。
4. 单 run 完成触发会话级全量重建，完成数量与已加载历史规模共同放大 CPU 和 React 更新。
5. run state 与扁平 envelope 层分别保留；全局裁剪能够删除 think event，却保留 `AVAILABLE` 状态。
6. 后台 `LOADING` 是短生命周期内部状态，但当前 UI 在第一帧直接把它作为标题文案展示。

## 目标设计（Proposed Design）

### 设计边界与 owner

`frontend/agent-web` 是本 change 的唯一主要 owner。现有 `sessionService.loadRunEvents`、单 run 分页/校验逻辑、message history、live stream projection、host shells 和后端 owner 全部保留。

实现只增加一个 shared chat/session hydration path：

```text
ChatPage / ProcessPanel user intent
            +
MessageList true-viewport observations
            ↓
ProcessHistoryScheduler
            ↓
existing loadCompleteRunProcessHistory()
            ↓
run-scoped cache
            ↓
TurnBlock message + selected-run event composition
```

host shell 和 PIU adapter 只消费 shared chat workspace，不接收 scheduler 或 cache ownership。

### 真实视口注册

新增 `frontend/agent-web/src/features/chat/history/useConversationTurnVisibility.ts`。它由 shared `MessageList` 使用，以 `right-pane-scroll-viewport` 为 observer root，注册当前渲染 TurnBlock 的 `rootMessageId + displayRunId`。

它维护两类观察结果：

- `VIEWPORT`：TurnBlock 与实际 scroll viewport 相交。
- `PRELOAD`：TurnBlock 不属于 `VIEWPORT`，但与 viewport 上下各一个当前 viewport 高度的缓冲区相交。

scroll viewport resize 时重建缓冲 observer，已注册 TurnBlock 不改变业务身份。visibility hook 只输出目标坐标、优先级和距 viewport 中心的顺序，不查询 event、不写 process cache。

交互合并规则：

- wheel/touchpad scroll：同一 animation frame 至多发布一次 `VIEWPORT` 目标；滚动连续 120ms 无新 scroll event 后才发布 `PRELOAD` 目标。
- pointer drag：从 scroll viewport 的 pointer down 到 pointer up/cancel 期间不发布新 hydration target；结束后的下一 animation frame 发布最终 `VIEWPORT`，连续 120ms 稳定后发布 `PRELOAD`。
- keyboard 或程序化 anchor scroll：按 animation frame 发布 `VIEWPORT`，连续 120ms 稳定后发布 `PRELOAD`。
- DOM observation 只覆盖当前 message window；未渲染 message 不产生 target。

这一路径扩展现有 scroll intent/anchor handling，不新增第二个 scroll owner，也不改变 older/newer message pagination。

### Hydration target 与优先级

新增 frontend-local 数据结构；它不进入 `agent-contracts`、Web DTO 或持久化：

```ts
type ProcessHistoryPriority = "EXPLICIT" | "VIEWPORT" | "PRELOAD";

interface ProcessHistoryTarget {
  readonly sessionId: string;
  readonly rootMessageId: string;
  readonly runId: string;
  readonly priority: ProcessHistoryPriority;
  readonly generation: number;
  readonly distanceFromViewportCenter: number;
}
```

`distanceFromViewportCenter` 只用于 `VIEWPORT` 和 `PRELOAD` 排序；`EXPLICIT` 固定先于另外两类。

目标选择按以下唯一顺序执行：

| 顺序 | 来源 | 保留规则 |
|---|---|---|
| 1 | 用户展开 process panel | 当前 run 作为 expansion-lifecycle `EXPLICIT`；普通折叠/offscreen 不撤销，正常结算时持续到 `AVAILABLE`、`FAILED` 或 `LEGACY_UNAVAILABLE`，但 queued/not-started generation 可被 explicit cap displacement，session teardown 可取消 |
| 2 | 当前 preview navigation target | target message 确认 display run 后作为 `EXPLICIT`，直到新的 preview target、离开 anchored navigation 或 load outcome |
| 3 | `VIEWPORT` | 按距 viewport 中心从近到远 |
| 4 | `PRELOAD` | 按距 viewport 中心从近到远 |

同一 `sessionId + runId` 同时来自多个来源时，保留最高优先级和最近 generation。每个 session 的自动 `VIEWPORT + PRELOAD` target 至多十六个；超出时按上表中的 viewport distance 截断。每个 session 的 `EXPLICIT` intent 也至多十六个，以 `sessionId + runId` 去重，按单调 intent generation 从新到旧调度。第十七个及后续显式意图只 displacement 最旧且尚未启动的 queued intent；displacement 同步释放该 generation 对应的 expansion demand/pin，但不折叠或重置 turn disclosure。若该 turn 仍展开且稍后重新进入 demand eligibility，scheduler 创建新 generation 再排队。已经 active 的旧 intent 与显式集合成员资格分离；session 存续时由 active-request pin 保留至唯一 load outcome。

preview hover 不创建 target。preview click 的 message/anchor 导航先完成；确认 target TurnBlock 和 display run 后才提交 `EXPLICIT` target，event load 不参与 scroll 完成条件。

### ProcessHistoryScheduler

新增 `frontend/agent-web/src/features/chat/history/processHistoryScheduler.ts`。它是 shared agent-web 内部 application service，由 conversation store 创建和清理 session-scoped scheduler state；不成为 React component 或 host service。

每个 session 维护：

- 单一 current target set；
- 单调递增 generation；
- 最多四个 active run request；
- 按上述优先级排序的 queued run；
- `sessionId + runId` 到 active `AbortController` 的映射；
- `sessionId + runId` 到唯一 active request identity 的映射；
- run cache 的 recency 和 pin 状态。

更新 target set 时执行：

1. 用最新 set 原子替换旧 set，不追加旧 viewport targets。
2. 删除已不在 current set 的 queued/not-started run，并释放其 generation-owned demand/pin，不修改 disclosure view state；不得因 automatic replacement、preview replacement 或 navigation generation supersession abort 已 started request。
3. 对 explicit intents 按 generation 保留最新十六个；容量 displacement 只删除尚未启动的最旧 intent，同步释放该 generation 的 expansion demand/pin。仍展开的 turn 后续重新满足 demand eligibility 时使用新 generation，不复活被 displacement 的 generation。
4. 无论 started request 来源是 `EXPLICIT`、`VIEWPORT`、`PRELOAD` 或 preview，在 session 存续时都由 active-request pin 保留到 `AVAILABLE`、`FAILED` 或 `LEGACY_UNAVAILABLE`；collapse/offscreen、automatic replacement、preview replacement 和 navigation generation supersession 都不 abort。
5. 对 current target 中 `AVAILABLE`、`LEGACY_UNAVAILABLE` 和相同 run 的 active request 不创建新请求；仅 `FAILED` 可由用户 retry 以新 generation 重新入队。
6. 按 `EXPLICIT` 最新 generation、`VIEWPORT` 距离、`PRELOAD` 距离的顺序填充空闲 slot；active request 总数始终不超过四。

同一 `sessionId + runId` 的请求 coalesce 到唯一 active request identity。结果提交只使用一条规则：session 仍存续、completion 的 request identity 仍等于该 run 当前登记的 active identity、且 response 坐标/分页通过既有 validation 时，正常 outcome 提交到 run-scoped cache；target generation、automatic set 或 preview navigation 已变化不阻止该 cache commit。提交不得恢复旧 target、旧 preview pin、旧 navigation token或触发 viewport movement。session teardown 或 active identity 不匹配的 late response 直接丢弃；identity 不匹配不得释放或覆盖当前 active request 的 slot/pin。

每个 identity 匹配、未被 session teardown 取消且正常结算的 request 只产生一个 load outcome：`AVAILABLE`、`FAILED` 或 `LEGACY_UNAVAILABLE`。三种 outcome 在提交或安全处理后释放自身 active slot 与 active-request pin，再根据当前 `VIEWPORT`、`PRELOAD`、current preview 或 live-run demand 计算后续 pin。`FAILED` 显示 retry；retry 创建同 run 的新 latest explicit generation。`LEGACY_UNAVAILABLE` 不显示 retry，也不允许 retry action 发出 request。

session teardown 是独立 lifecycle termination：session clear/dispose 时同步删除 queued work，abort in-flight request，释放该 session 的全部 demand/pin并清理 scheduler state。teardown cancellation 不写 `AVAILABLE`、`FAILED` 或 `LEGACY_UNAVAILABLE`，不渲染新的 process-history outcome；任何 late response 都被 session guard 忽略。

authoritative conversation load 不再重置全部 `LOADING` 状态。它只更新 message facts、display-run mapping 和 visibility generation；scheduler 根据新的 target set 删除未启动 work、复用 cache 或继续已 started request。

### Run-scoped 状态与缓存

`RunProcessHistoryState` 扩展为 frontend-local 状态：

| 当前状态 | 触发 | 下一状态 | 约束 |
|---|---|---|---|
| absent / `IDLE` | current target selected | `QUEUED` | 记录 priority/generation |
| `QUEUED` | scheduler slot available | `LOADING` | 记录 `startedAt` 和 AbortController |
| `QUEUED` | target removed 或 explicit capacity displacement | absent / `IDLE` | 释放 generation demand/pin，保留 disclosure，不产生失败 |
| `LOADING` | validated AVAILABLE page sequence completes | `AVAILABLE` | state 与 envelopes 一次提交 |
| `LOADING` | legacy availability | `LEGACY_UNAVAILABLE` | terminal，无 retry |
| `LOADING` | non-abort failure | `FAILED` | 只记录 safe error code |
| `LOADING` | target/generation becomes obsolete while session survives | `LOADING` | active-request pin 保持到正常 outcome，不恢复旧交互意图 |
| `FAILED` | explicit retry | `QUEUED` | priority=`EXPLICIT` |
| `AVAILABLE` | unpinned LRU eviction | absent | state 与 envelopes 一次删除 |
| any queued/loading | session teardown | absent | 删除 queue/abort request/释放全部 demand/pin，不产生 UI outcome |

cache 采用每 session 双重上限：

- 至多 64 个 unpinned `AVAILABLE` run；
- 至多 2,000 个 unpinned persisted event envelopes。

`VIEWPORT`、`PRELOAD`、当前 preview、active request 和 live run 对应的 run 为 pinned。panel expansion 只在 load outcome 之前通过 expansion intent/pin 生效；outcome 后 expansion 本身不再 pin。pinned facts 可以暂时超过上限；任何 run 的最后一个 pin 释放时立即对整个 session 执行 LRU，按 `(lastAccessedAt, lastAccessSequence, runId)` 从最旧 unpinned run 开始整 run 淘汰，直到同时满足 64 run 与 2,000 envelope 上限。state 与 envelopes 在同一次 store update 中删除，不可拆分裁剪；单个 unpinned run 本身超过 envelope 上限时整 run 淘汰。

`lastAccessedAt` 和稳定 tie-break sequence 只在两个时点更新：

1. 已校验结果成功提交为 `AVAILABLE`，包括 `FAILED` retry 成功；
2. 已缓存 `AVAILABLE` run 从不在 effective demand set 变为 present，并发生真实 cache reuse。

retry 调度、`LEGACY_UNAVAILABLE`、重复 observer 发布、render/snapshot read、单纯 pin/unpin 和同 generation refresh 都不 touch。最后一个 pin 释放触发容量收敛，但本身不 touch recency。

disclosure view state 由 `ProcessPanel` 持有，与 scheduler cache 分离。offscreen expanded run 可以被 LRU 淘汰；返回 `VIEWPORT`/`PRELOAD` 后 disclosure 仍展开，panel body 进入 loading，并只发出一个新的 run request。

### Turn 局部组合

`historyEnvelopesBySession` 继续承载 message-derived history envelope 和既有 live/settled 层，不再承载 cold run-event cache 的扁平副本。删除 `rebuildSelectedProcessHistoryLayer()` 的 process flatten 行为。

`MessageList` 继续按 message-derived `displayRunId` 选择 `RunProcessHistoryState`。`TurnBlock` 通过纯函数把 base block 的 message-derived envelopes 与该 run 的 `AVAILABLE` event envelopes 合并：

1. 过滤 event 的 `sessionId`、`runId` 和 target root correlation；
2. 加入 `history-load` transport hint；
3. 按 canonical sequence 和 `eventId` 去重；
4. 对同时存在于 base live/settled 层和 persisted event history 的 completed thinking，以非空 `stepId` 建立
   `sessionId + runId + rootMessageId + stepId` 稳定步骤身份；persisted completed
   `LLM_THINKING_DELTA` 覆盖同一步骤的 base 临时或完成快照，只向过程投影输入一份 canonical
   thinking；
5. 不同 `stepId` 始终保留为不同步骤，即使文本相同；缺少非空 `stepId` 的 event 只沿用精确
   `eventId` 去重，不按文本、sequence 邻近性或 segment ordinal 猜测同一步骤；
6. 复用现有 `buildProcessTimelineEntries`、`buildProcessEntries` 和 ProcessPanel lifecycle。

final answer、user content 和 capability result body 仍来自 message-derived base block。只有收到对应 run cache 更新的 TurnBlock props 发生变化；`React.memo` 和稳定 base block identity 防止无关 turn 重做过程组合。

### Preview、刷新和面板加载呈现

- preview rail window loading保持现有最多两个请求和 marker virtualization。hover path 不调用 scheduler。
- preview click 使用单调 navigation token。旧 token 的 message response 不得触发 scroll；target message 渲染后立即 scroll，然后提交 display run 的 `EXPLICIT` target。
- 页面刷新沿用 latest message window。首个 layout/observer result 产生 `VIEWPORT` target；刷新不恢复旧 scroll coordinate。
- 如果历史 turn 已因 message-derived process facts 显示 process title，后台 `LOADING` 不替换该标题。
- 如果 turn 尚无 process affordance，后台 `LOADING` 前 300ms 不创建 loading-only row；到达 300ms 后使用稳定“执行详情”title，并附加非文本 spinner，但不显示加载长文案。
- 用户展开时，ProcessPanel 保持同一 summary row 和 component identity，在 panel body 显示“正在加载历史过程详情…”，并提交/提升 `EXPLICIT` target。
- 成功后 body 原位切换为 process entries；`FAILED` 使用安全文案与 retry，`LEGACY_UNAVAILABLE` 使用不可重试的 terminal 文案。三种 load outcome 都释放 expansion target/pin。

### 明确不修改的技术边界

proposal 的非目标保持有效。特别是本设计不新增 API、DTO、event、gateway port、数据库表、浏览器持久化或 host-specific adapter；不修改 `loadCompleteRunProcessHistory()` 的分页与 validation contract，也不改变 live stream envelope 生命周期。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证方向 |
|---|---|---|
| 安全 | 继续使用现有 owner/Agent scoped event API 和 `StreamEnvelope` runtime validation；frontend cache 只保存已校验 safe envelope。取消、失败和 loading UI 不暴露 raw error。 | invalid envelope、cross-session/run coordinate、safe failure 和 host ownership negative tests |
| 性能/容量 | session active request≤4、automatic viewport/preload target≤16、explicit intent≤16 且 latest generation 优先、unpinned cache≤64 runs/2,000 envelopes；scroll target 按 frame 合并，process result 不触发会话级全量重建。 | 17+ explicit/4 active tests、scheduler load tests、large-history component tests、browser request-count/interaction tests |
| 可靠性/恢复 | 所有来源的 started request 在存续 session 内 pin-to-outcome；identity-matched validated completion 可提交 run cache但不恢复旧交互意图；只有 teardown abort；capacity displacement 只作用于未启动 work并保留 disclosure。 | all-source started replacement、identity mismatch late result、teardown cancellation、三 outcome release tests |
| 可维护性 | visibility、scheduler、run cache/projection职责分离；现有 pager、preview loader、scroll owner 和 ProcessPanel 投影继续复用。 | architecture ownership tests、public import review、targeted code review |
| 可测试性 | priority、generation、capacity 和 timer 均为确定性 frontend constants；scheduler 可通过 fake loader/clock 测试，不依赖真实网络。 | unit + component fake timer + e2e fixture |
| 审计/可追溯性 | 不新增业务 audit/event/log；现有 REST 与浏览器测试请求记录足以验证 hydration。日志不得包含 event payload 或 think 文本。 | source review 与 no-payload-log assertion |

## 验证策略（Verification Strategy）

- unit 层验证 target 排序、去重、replacement、四并发、十六个自动目标、十六个显式目标/latest-wins、queued generation displacement/re-entry、四类来源 started request 不因 target replacement 被 abort、identity-matched obsolete-generation cache commit、identity-mismatch late response discard、session teardown no-outcome和三种正常 outcome release；同时覆盖 persisted completed thinking 覆盖同 `stepId` 的 live partial/completed 快照、不同 `stepId` 不误合并和 missing-`stepId` 不猜测。
- store/integration 层验证 message load 不再自动选择整个 window、authoritative/older/newer/anchor load 保留有效 cache、session/generation 隔离和 run-scoped局部提交。
- component 层使用 fake clock 验证 300ms loading 边界、稳定标题/行高、展开时 P0 请求、成功原位填充和 failure retry。
- ChatPage/MessageList 层验证 preview hover 不查询 event、preview click 导航不等待 event、最新 token 胜出、pointer drag 最终视口、wheel frame 合并和 refresh 首屏目标。
- browser e2e 使用 200 轮、多次 think/tool 的大量历史 turn、可控慢 event 与 request probe，验证快速 preview/drag/wheel/refresh、session switch、eviction/revisit 的交互流畅性、请求上限、think 完整性和三种 host 结果一致。
- architecture/negative test 禁止 host entry/PIU adapter 持有 scheduler/cache，禁止新增后端 event API 或 `agent-contracts` public type。
- OpenSpec strict validation 和模型语义审查验证 requirement-to-task 一致性、唯一实施路径与 scope 边界。

## 风险与取舍（Risks / Trade-offs）

- IntersectionObserver 回调与程序化 anchor scroll 的到达顺序可能不同。navigation target 通过显式 `EXPLICIT` pin 覆盖 observer 时序，scroll 完成不等待 event。
- 四并发 active request 已经发出时，快速跳转仍会让这些请求正常完成；target replacement 只清除未启动 backlog。完成结果可进入 run-scoped cache，但 generation guard 保证它不能恢复旧 preview/navigation 或移动 viewport。
- run 级 LRU 会使用户长距离往返后重新请求已淘汰 history。该代价换取明确内存上限；offscreen expanded 只保留 disclosure view state，不以展开状态永久占用 cache，返回时自动重新加载。
- 单个 run 的 event 数可能超过 session unpinned envelope 上限。设计选择整 run 淘汰而不是截断，保证下次加载仍能恢复完整过程，不制造半有效 cache。
- 300ms loading 阈值必须通过 fake clock 和浏览器慢响应 fixture 固定；实现不得依赖 CSS transition 完成时间判断状态。
- 少量 thinking event 不携带 `stepId`，无法安全判断 live 与 persisted event 是否为同一逻辑步骤。本设计保留两者而不做文本去重；该兼容取舍避免把不同模型步骤的相同文本误合并。
