## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-1.1 查看会话消息流` | 活动过程 Markdown 不保留瞬时累计快照；最终答案不叠加浏览器逐字重放；最终答案接管待定过程正文时直接稳定显示于既有答案位置；回看提交继续满足既有阅读位置契约 | `ts-web-sse-ws-transports` | `FN-1.1 查看会话消息流` |

## `FN-1.1 查看会话消息流`

### 目标与规范依据

本设计使 Agent Web 在活动过程 Markdown 增长、最终答案流式推进、过程正文转为最终答案以及用户回看期间提交四类路径中保持渲染频率、缓存生命周期、内容位置和交互意图稳定。最终答案只消费 Web stream 已按帧合并的累计正文，不再由浏览器计时器二次推进；最终答案接管时不再播放横向位置动画；Markdown cache policy 与回看提交分别恢复既有长会话响应性和阅读位置稳定契约。

#### 本 Function 的目标 Requirements

canonical spec：`ts-web-sse-ws-transports`

- `MODIFIED`：`Tool 轮次执行说明与 Tool 调用连续呈现`

### 当前实现

- `MarkdownContent` 默认使用 `stable` cache policy，把规范化后的完整 Markdown 以原始正文为 key 保留在最多 300 项的进程内缓存中。最终答案在活动期已经显式使用 `streaming` policy，但 `ProcessPanel` 的活动条目、独立 process explanation 和合并 explanation detail 都沿用默认 `stable` policy；累计正文的每个唯一中间快照因此都会占用稳定缓存，直到达到容量上限后才逐项淘汰。
- `TurnBlock.useTypewriterContent` 在 live answer 更新之外每 32 ms 推进一次本地可见字符数。每次推进都会重新计算渐进式 Markdown 边界并更新答案 DOM；内容高度增长随后触发既有 `ResizeObserver` 和底部跟随帧，因此同一份后端累计正文会产生额外的 React render 与 viewport 工作。
- `ChatPage` 在报告/分享选择模式关闭时仍为每个 live snapshot 遍历全部 `turnBlocks` 计算候选集合，并以整个 `turnBlocks` 数组驱动 active root 同步；未打开详情时也执行目标查找。`useChatComposerController` 的编辑/重试回调依赖整个 `turnBlocks` 快照，因此每次 live snapshot 都改变回调引用并向历史 Turn 传播无语义变化的属性更新。
- `TurnBlock` 使用 `isFinalAnswerHandoffFromPendingProcessContent` 识别待定过程正文被最终答案接管，并以该结果阻止重新打字；同一结果还为答案区域附加 `data-process-output-handoff` 和 `turn-answer--handoff-from-process`。`ProcessPanel.css` 使后者从 `translateX(28px)` 在 180 ms 内移动到 `translateX(0)`。`ProcessPanel` 还把 process explanation Markdown 显式设置为 14px，而最终答案 Markdown 使用 16px 默认公开正文排版。
- `ChatPage.handleSendWithPreviewTail` 在提交前读取 following 状态。提交前已经 following 时调用受 following 策略保护的置底入口；提交前未 following、非 edit 且非 anchored 时则直接调用无条件置底入口。后一个分支与稳定 `e2e-ui-interaction` 中“回看期间提交不抢占阅读位置”不一致。
- 现有 viewport 与 route-state 测试已覆盖 anchored 提交以及提交等待期间上滚。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 长会话活动投影保持输入与滚动响应，不把瞬时累计快照当作稳定内容长期保留 | 最终答案已区分 streaming/stable cache policy，但活动 `ProcessPanel` Markdown 始终使用 stable policy，最多保留 300 份唯一累计快照 | 活动正文越长，瞬时字符串与规范化结果的保留量越大，产生与可见结果无关的内存和垃圾回收压力 |
| 最终答案正文随 Web stream 逐帧投影推进，浏览器不独立重放已经接收的累计正文 | Web stream 已至多每帧发布一次累计正文，但 `useTypewriterContent` 仍每 32 ms 更新本地可见字符数 | 一次后端正文更新可产生多个额外 React render、答案 DOM 增长和置底帧，持续放大主线程工作 |
| 普通 live snapshot 的派生工作不随无关历史交互线性增长 | 关闭的选择模式仍扫描全部 Turn，未变化的 active root 重复写入，编辑/重试回调随快照替换 | 历史越长，每次 live snapshot 越容易触发与当前可见正文无关的遍历、状态通知和历史 Turn 属性更新 |
| 待定过程正文与最终答案使用相同公开正文排版，且接管时直接使用既有答案左边界并不播放位置动画 | handoff 识别正确，但 process explanation Markdown 为 14px、最终答案为 16px，答案区域还附加 28px 至 0 的横移动画 | 可见正文在接管时改变字号，并在终态首次呈现后继续由右向左移动 |
| recent 非跟随和 anchored 回看期间提交保持阅读位置 | anchored 已被保护，但 recent 非跟随分支显式调用无条件置底 | recent 回看意图被提交完成回调覆盖 |

### 修改方案

`frontend/agent-web` 继续作为唯一浏览器投影与本地 view-state owner，不修改 Web transport、runtime、history 或 persistence owner。

1. 为 `ProcessPanel` 中同一活动条目拥有的所有 Markdown 使用统一 cache policy：`isActiveEntry && !isTerminal` 时传入 `streaming`，settled 或历史内容传入 `stable`。`MarkdownContent` 的 memo comparator 不因 `cachePolicy` 单独变化而强制重渲染；同一正文转为 settled 时继续复用已显示结果，后续实际挂载 settled 内容时再写入稳定缓存。不改变 Markdown 规范化、清洗、分段、HTML 或 DOM 结构，也不增加新的缓存、节流器或命令式缓存入口。
2. 删除最终答案区域的 `useTypewriterContent`、本地字符推进状态和 32 ms interval，直接将 `buildAnswerContent` 已合并的累计正文交给既有渐进式 Markdown 分割。Web stream 的逐帧发布继续作为唯一 live answer 更新节奏；CSS 流光效果、未完成 Markdown 尾部的纯文本保护、envelope 顺序、terminal 收敛和 history 投影保持不变。不增加展示节流器、并行投影状态或新的 scheduler。
3. 保留 `isFinalAnswerHandoffFromPendingProcessContent`、`data-process-output-handoff` 和防重新打字判断，移除 `turn-answer--handoff-from-process` class 绑定以及对应 keyframes/style。process explanation 及其合并后的 explanation detail 复用 `MarkdownContent` 的 16px 公开正文默认排版；Tool、thinking、结构化结果等过程详情继续使用既有 14px 排版。handoff 语义、最终正文、Markdown 渲染和纵向滚动锚点不变。
4. `handleSendWithPreviewTail` 在提交完成后只调用 `requestScrollToBottomIfFollowing`。该 helper 在执行时重新读取最新 following ref，因此提交前在底部但等待期间上滚、提交前已经 recent 非跟随以及 anchored 三类路径都不会被迟到置底；仍在 following 的正常提交继续跟随。预览尾部刷新保持不变。
5. 报告/分享选择候选集合只在对应选择模式开启时计算；未选择详情目标时直接返回空结果；active root 同步只依赖最新 root 标识。选择模式开启后的候选内容、详情目标和 active root 结果保持不变。
6. `useChatComposerController` 使用最新 Turn 快照引用为编辑/重试动作查找目标，使两个回调不再依赖整个数组引用；动作触发时仍解析当前最新 Turn，不缓存目标结果或复制第二份业务状态。
7. 不删除 handoff 识别，也不增加新的 viewport 状态。语义验证继续关注 cache policy、live answer 推进、长历史普通更新、handoff、following 和 anchored 边界。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 性能/容量 | 稳定 `e2e-ui-interaction / Live conversation projection SHALL preserve long-session input responsiveness` | 活动累计 Markdown 不进入稳定缓存；live answer 只随既有 Web stream 逐帧投影更新，不再启动本地字符推进 interval；同内容转为 settled 时不强制重渲染；关闭的选择模式不扫描历史，未变化的 active root 不重复同步，编辑/重试回调不随快照替换 | 活动期缓存项保持为 0；一次累计正文更新立即完整可见，等待 32 ms 不产生额外 Turn render；100 个历史 Turn 的普通 live update 不执行全量选择扫描或 active root 重写；真实长回复检查长帧与输入/滚动响应 |
| 可靠性/恢复 | 稳定 `e2e-ui-interaction / User upward scrolling SHALL preserve the reading position during asynchronous layout growth` | viewport 复用执行时读取的 following ref，不引入平行状态 | recent following、recent 非 following、等待期间上滚和 anchored 窗口均保持既有契约 |
| 可测试性 | `Tool 轮次执行说明与 Tool 调用连续呈现` | 保留语义 marker，将可选位移动画移除；viewport 复用可控 following ref | 组件、route-state 与 browser journey 可直接断言可见结果 |

## 验证策略（Verification Strategy）

- unit/component：活动 process explanation 首次渲染和累计更新时稳定 Markdown cache 保持为空；同一内容转为 settled 后仍为空，重新挂载 settled 内容后缓存项为 1。修改前该用例必须因活动内容已写入 1 项而失败。
- component：live answer 收到新的累计正文后在当前 Web stream 投影中直接完整显示；随后经过原 32 ms tick 窗口不得产生额外 Turn render。terminal 到达时必须直接显示最后累计正文，不等待本地 reveal backlog。
- component：确认 handoff marker 仍存在、防重新打字 class 仍不出现、process explanation 使用 16px 公开正文排版，但答案区域不再拥有位置动画 class。
- route-state：在 100 个历史 Turn 后追加普通 live snapshot，确认关闭的报告/分享选择模式不重新全量扫描候选，且 latest root 未变化时不重复同步 runtime state；编辑/重试仍在触发时读取当前 Turn。
- route-state：覆盖 recent following 提交继续跟随、recent 已经非 following 时提交保持位置、提交等待期间上滚保持位置，以及 anchored 有无 `newerCursor` 时保持窗口和 anchor。
- e2e/人工浏览器：比较最终答案 handoff 前后首帧与稳定帧的左右边界，确认普通与 reduced-motion 环境均无位置动画；在长会话回看位置提交并确认 viewport 不跳底；真实长 Markdown 持续推送时确认正文仍连续增长，并检查控制台长帧、输入与滚动响应。组件回归证明前端二次逐字 render 已消除，浏览器验证继续确认整体帧耗时。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/ts-web-sse-ws-transports/spec.md`：收紧最终答案接管为直接使用既有答案位置且不播放位置动画。
- `openspec/designs/functions/D1-会话与流式交互/D1.1-流式交互与恢复/FN-1.1-查看会话消息流.md`：更新 Tool 轮次说明规格摘要。
- `openspec/designs/features/D1-会话与流式交互/D1.1-流式交互与恢复/F-1.1-实时查看处理过程.md`：更新最终答案接管的稳定呈现保证。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/conversation-process-history.md`：更新待定过程正文向最终答案交接的无动画边界。
- `openspec/designs/modules/agent-web.md`：记录活动 Markdown cache policy、live answer 单一逐帧更新边界、handoff 样式和 following 提交职责。
- `openspec/designs/adr`：无。
- `openspec/designs/spec-to-design-map.md`：补充活动 Markdown cache、handoff 和回看提交的定向验证入口。

## 风险与取舍（Risks / Trade-offs）

- streaming policy 只禁止缓存瞬时累计快照，仍会执行当前 Markdown 规范化与渲染；因此它消除已证实的缓存保留压力，但不把所有长帧都归因于缓存。同一内容转为 settled 时不为预热 stable cache 强制重渲染；后续实际挂载 settled 或历史内容时自然写入缓存，代价是首次重新挂载仍执行一次规范化。
- 关闭选择模式时复用只读空集合；开启模式时仍从当前完整 Turn 快照重建候选，保证候选语义不被缓存。编辑/重试回调只稳定函数引用，不保留目标 Turn 副本，动作触发时仍以当前快照为准。
- 移除前端逐字重放后，文字推进粒度由 Web stream 的逐帧合并结果决定；极短时间内到达的多个 delta 会同帧显示，而不再被浏览器拆成固定字符步长。最终内容、顺序和终态不变，换取不重复执行答案 render 与置底布局。
- 不再播放横移动画后，待定过程正文和最终答案仍位于不同区域；语义 marker 与纵向锚点继续保留，但不再使用额外动效提示区域交接。
- recent 非跟随时提交不会立即展示新问题；现有置底按钮继续作为用户显式返回最新的唯一入口。
