## 背景和现状（Context）

Agent Web 当前在 `conversationStore` 中同时维护 `envelopesBySession`、`historyEnvelopesBySession`、`liveEnvelopesBySession` 和 `historyMessagesBySession`。每次 live batch 到达时，store 会扫描当前单会话 live 数组建立 identity 与 accumulated lane 索引，随后执行 live compaction、history budget 计算、history/live filter、combined dedup 和 session map 更新。全会话 500 上限同时约束 history 与 live envelope；压缩无法把对象数降到 500 时，现有算法保留末尾对象，可能丢失较早的 live-only Turn 或过程详情。

stream transport 已经把高频 `LLM_CONTENT_DELTA`、`LLM_THINKING_DELTA`、`CAPABILITY_RESULT_DELTA` 和 `TOOL_STRUCTURED_DELTA` 聚合到 animation frame，再在该 `requestAnimationFrame` callback 中同步调用 `appendEnvelopes()`。因此浏览器报告的 `requestAnimationFrame handler took ...ms` 不只包含调度本身，还可能包含 store 归一化、Zustand subscriber、React projection/render/commit 和由 commit 触发的布局工作。现有长会话优化已保持 history projection 与旧 Turn 引用稳定，但 session-wide live 数组、combined layer 和 500 compaction 仍位于 frame callback 的同步路径中。

稳定契约要求 visible `SessionMessage` 是 committed history 的最终内容事实，普通 terminal 不得用 conversation snapshot 覆盖已接受的 live process detail。新状态只能是浏览器页面生命周期内的高保真投影缓存，不能成为第二套持久化或 canonical history。

当前代码还把窗口隔离与 stream 接受耦合：anchored 且存在 `newerCursor` 时，`appendEnvelopes()` 只设置 `newMessagesWhileAnchored`，不保存 envelope。该行为能保护当前历史窗口，但会使回看期间提交的 Run 无法在返回 recent 后恢复完整 live process detail。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 用 history、active live、settled live process 三层状态表达唯一生命周期，取消 session-wide 500 destructive eviction 和 `pendingHistory` 概念。
- terminal 在一次 store transition 中完成 active 到 settled 的迁移，保持 Turn DOM 和过程入口连续。
- history 已存在时继续拥有 canonical 最终内容与 visibility；settled 只补充 history 无法安全重建的已接受过程详情。
- stream 接受不再受 anchored 窗口显示策略阻断；anchored 只控制投影，不删除新数据。
- 高频 active append 的同步工作只随当前 attempt bucket 和当前 batch 增长，不随已完成 Turn 数量增长。
- 保留现有 request identity、attempt selection、terminal、edit/retry、stream cursor、recovery、LRU 和多宿主共享行为。

**非目标：**

- 不实现虚拟列表、历史 Turn DOM 回收、历史消息总量限制或新的“有新消息”提示。
- 不持久化完整 live process detail，不改变 `SessionMessage`、timeline、stream schema、Web API、runtime 或 gateway。
- 不承诺单个包含大量不可合并结构事件、超长 Markdown、Mermaid、Process Panel 或浏览器布局的 Turn 永远低于 long-task 阈值；本 change 只消除跨已完成 Turn 的 session-wide 放大。若隔离后仍存在当前 Turn 内部热点，必须用浏览器 Performance trace 另行定位。
- 不改变置底按钮、220ms 动画、following/at-bottom 或 anchored/recent 收敛语义。

## 设计决策（Decisions）

### 1. `conversationStore` 是唯一 owner，状态按 root/attempt 分桶

conversation store 固定使用以下 session-scoped 状态：

```text
historyMessagesBySession[sessionId]
historyEnvelopesBySession[sessionId]
activeLiveBySession[sessionId][rootMessageId]
settledLiveBySession[sessionId][rootMessageId]
nextLiveOrdinalBySession[sessionId]
```

每个 active/settled bucket 固定包含当前可见 attempt 的 `rootMessageId`、`attemptId`、`firstSeenOrdinal`、有序 envelope 数组和下一次无损压缩 watermark。新 root 首次进入 session 时使用 `nextLiveOrdinalBySession` 分配只在当前页面缓存内有意义的单调序号；optimistic identity 重键、active → settled 和同 root retry 都保留该 root 的序号。history 命中的 root 仍按 canonical message sequence 定位；history 尚无 root 的 settled/active Turn 追加在当前连续 history 之后，并按 `firstSeenOrdinal` 排序，禁止依赖对象属性遍历或 envelope timestamp 猜测跨 Turn 顺序。`conversationStore` 继续拥有 append、identity reconcile、edit/retry、history load、clear 和 LRU action；组件不得自行维护第二份 settled cache。

现有 `sessionAccessOrder` 继续作为 10-session cache 的唯一 LRU 顺序事实。淘汰 helper 必须以该顺序决定 session，并在同一次 store transition 中从所有 session-scoped map 删除同一 session；不得再以被删除的 combined envelope map 充当缓存成员或淘汰依据。

`envelopesBySession` 与 `liveEnvelopesBySession` 不再作为产品读取或写入源，也不得在每次 active append 时维护 history + active + settled 的扁平镜像。实施时删除这两个内部旧层及其 combined fallback，ChatPage、stream lifecycle 和测试改为消费显式状态。该删除不改变任何 package public API 或 `agent-contracts`。

选择分桶而不是继续维护单会话 live 数组，是因为新 batch 只属于一个 request/attempt；已完成 Turn 不应参与新 batch 的 identity、compaction 或 array copy。拒绝保存 `TurnBlock`：它是由 history、live、状态和组件规则共同派生的 view model，缓存它会复制 source precedence 和 `isLatest` 语义。

### 2. active → settled 是 terminal 驱动的单次原子迁移

batch append 先按可信 stream envelope 中的 session、root 和 attempt identity 定位 active bucket，再复用现有精确 identity、receive order 和 accumulated snapshot replacement 语义更新该 bucket。非 terminal lifecycle envelope 保持即时处理；frame-batchable delta 继续按现有 animation-frame 边界批量提交。

匹配 active attempt 的 terminal envelope 到达时，单次 Zustand `set` 必须：

1. 把 terminal 按顺序纳入 active bucket；
2. 对该 bucket 做一次最终无损压缩；
3. 将结果写成同 root 的 settled bucket；
4. 删除对应 active bucket；
5. 保持其他 root、history 和 session map 条目引用不变。

React 在同一个 store snapshot 中看到 settled 结果，不存在“先删除 active、下一次通知再添加 settled”的中间状态。普通 terminal 仍只刷新 session list，不调用 conversation refresh。

identity reconcile 也必须是 store 内单次 transition：后端 accepted root 与 optimistic root 不同时，active/settled bucket、envelope identity 和 edit/supersede 引用一起重键，并保留 `firstSeenOrdinal`。若目标 root 已存在，只能按现有精确 attempt、sequence 和 envelope identity 规则合并，不能保留两个可见 Turn。

append 路由固定遵守 attempt identity：已存在于 active 或 settled bucket 的重复 envelope 是 no-op；匹配已 settled attempt 的迟到非 terminal envelope 只能按序补入该 settled bucket；重复 terminal 不得新建空 active bucket或用单个 terminal 覆盖完整 settled bucket；旧 attempt 的迟到事件不得替换同 root 的较新 active/settled attempt。只有匹配当前 active attempt 的 terminal 才执行 active → settled 迁移。

新 attempt 继续沿用当前 latest-attempt 选择规则。retry 的 active attempt 覆盖同 root 的展示，terminal 后替换该 root 的 settled latest attempt；edit/supersede 继续通过 visibility 和 successor root 隔离旧内容。rollback 必须恢复 action 触达前的 active/settled 可见状态。

### 3. history 与 settled 按内容 lane 合并，不做数组无条件拼接

session projection 按以下固定顺序构建：

1. 从 `historyMessages` 和必要的 history envelope 建立 canonical historical blocks；
2. 对 history 尚无 root 的 settled bucket，建立当前页面临时完整 Turn；
3. 对 history 已有且可见的 root，保留 history 的用户内容、最终 assistant answer、最终 capability result、message anchor 与 visibility，只从 settled bucket补充 thinking、capability lifecycle、process timeline、terminal detail 和 live-only structured detail；
4. 对当前 active attempt 应用完整 active overlay；
5. 最后计算 `isLatest` 和现有 latest-attempt 状态。

合并器按 event semantic lane 选择 source，不直接拼接两套 `LLM_CONTENT_DELTA` 或最终 result，因此同 root 只能出现一个 Turn 和一个最终回答。canonical history 为 `visible=false` 时，该 root 在第 2 至第 4 步均被抑制；settled 数据不得把已编辑或 superseded 的旧消息重新显示。

settled overlay 必须作用于所有当前窗口内匹配的 root，不沿用“只有 latest historical root 接受完整 live overlay”的旧限制。实现分为两个 memo phase：history + settled 构建稳定 base projection 及 `rootMessageId -> index` 派生索引；active overlay 只按该索引定位匹配 root，或按 `firstSeenOrdinal` 追加 live-only root。active batch 不得重新分组 settled envelopes 或重新派生所有 base Turn；为生成不可变列表而进行的浅数组复制可以保留，但未变化的 historical/settled block 和 React Turn 组件引用必须复用。

### 4. anchored 只隔离可见窗口，不阻断 stream 接受

`appendEnvelopes()` 不再因 `mode=anchored && newerCursor` 提前返回。active/settled bucket 始终按 session 接受合法 stream 数据；`newMessagesWhileAnchored` 继续记录窗口外有更新。

projection 在 anchored 且仍不连续时只使用当前 anchored history roots，并且仅允许 active/settled detail 补充这些已存在 root，不把窗口外的新 root 插入 DOM。用户持续加载完 newer pages 并自然返回 recent，或点击现有置底入口显式加载 recent 后，recent projection 才加入缓存的新 root。该设计保持回看位置和“不新增消息提示”约束，同时不丢失当前页面已接受的 process detail。

### 5. 500 是分桶无损压缩 watermark，不是保留上限

每个 active bucket 的初始 `nextCompactionAt` 为 500。bucket 对象数达到 watermark 时，压缩器以一次线性遍历执行：

- accumulated snapshot：同 session/root/attempt/event lane 只保留最新完整 snapshot；
- incremental `LLM_CONTENT_DELTA`、`LLM_THINKING_DELTA`、`CAPABILITY_RESULT_DELTA`：只在相同精确 lane 内合并文本并保留顺序与累计内容；
- lifecycle、terminal、`TOOL_STRUCTURED_DELTA`、用户输入、附件、降级、上下文和后台任务事件：没有经现有显示语义证明等价时全部保留；
- 不再重复扩展 prefix 以追求 `length <= 500`，也不再执行 `slice(-500)`。

“精确 lane”继续复用当前 `streamCompaction` 已有的 correlation 与 sequence segmentation，不在 `conversationStore` 新建第二套 lane key：

- assistant answer 使用 root + attempt + assistant-answer lane；
- thinking 使用 root + attempt + thinking + contiguous-sequence-segment；
- capability result 使用 root + attempt + capability correlation identity + contiguous-sequence-segment；
- capability correlation identity 按当前 `toolCallId`、`invocationId`、`metadata.invocationId`、`capabilityId`、`contentRef`、event identity fallback 规则解析；没有 execution identity 但存在 `toolCallIndex` 的 tool arguments 使用独立 lane；
- 不同 attempt、不同 capability invocation、非连续 sequence segment、lifecycle/terminal、`TOOL_STRUCTURED_DELTA`、用户输入、附件、后台任务、降级和上下文事件不得跨 lane 合并。

实施只改变 compaction 的 watermark、单遍执行和 destructive fallback，不重新定义当前已经验证的 text merge、accumulated snapshot、capability correlation 或 sequence-gap 语义。

压缩完成后，下一 watermark 设置为“当前保留长度 + 500”。后续事件先正常追加，达到新 watermark 再做下一次单遍压缩。terminal 额外执行一次最终压缩。压缩后超过 500 是合法结果，表示其中包含不可无损折叠的有效事件。

选择 watermark 是为了避免 bucket 一旦超过 500 后每个 frame 都重新压缩全部数据。拒绝按 Run、Turn 或 event type 设置多个任意 hard cap，因为这些上限都会在单个复杂电信诊断任务中静默丢失过程事实。

### 6. consumer 按职责读取明确状态

- `useStreamConnection`：保留 transport validation、cursor 和 frame batching；frame callback 只调用按 attempt 分桶的 append action。
- `useChatSessionStream`：activity timeout 只读取当前 active attempt；terminal 首次处理继续使用即时 callback。terminal 先于 accepted identity 到达、或 optimistic identity 后续重键时，补结算只按当前 session/root/attempt 精确读取 matching active 或 settled bucket，不扫描其他 settled/history root。重复 terminal 为 no-op，旧 attempt terminal 不得结算较新 pending request。
- `backgroundTaskStore`：拥有 session-scoped 后台任务浏览器投影。`useChatSessionStream` 在 conversation bucket append 之前只把 `BACKGROUND_TASK_STARTED`、`BACKGROUND_TASK_COMPLETED`、`BACKGROUND_TASK_FAILED` 按 `taskId` 增量交给该 store；session 进入时的一次 list seed 只补齐缺失任务和 `commandLine`，不得覆盖已接收的较新 live terminal 或本地 `KILLED` 状态。普通 stream envelope 必须是 task store no-op。header monitor 只订阅该 store，不得订阅、展平、排序或扫描 history/active/settled conversation envelope。
- `ChatPage` session projection：读取 history、当前窗口可用的 settled buckets 和 active bucket；不订阅扁平 combined mirror。
- `ChatPage` 将当前含糊的 `hasLocalEnvelopes` 收敛为 retained-conversation-projection 判断：当前 session 的 history messages/history envelopes、active bucket 或 settled bucket 任一存在时为真，继续保护仅有缓存 history、active live 或 terminal-settled detail 的 deferred/opening snapshot；identity resolution 只读取当前请求精确匹配的 active/settled bucket。
- full process 和 Expand Panel 在 active 执行期间读取 active bucket，已完成 Turn 的详情从对应 settled bucket 投影。现有 `latestEnvelopeCursor` 仍只是 viewport 内容增长信号，不升级为 stream resume cursor；它从本次实际变化的 active 或 terminal-settled bucket 派生，不扫描全部 settled root。
- conversation load/opening reconcile/gap/manual refresh：更新 canonical history，并按 identity 合并但不因“history 已包含 root”删除 settled detail。
- edit/retry/rollback/clear/LRU：由 conversation store action 一次性更新所有触达层。

### 7. cleanup 只由明确生命周期触发

普通 history load、terminal、session list refresh 和新消息提交不得清理 settled bucket。以下事件可以清理：

- `clearConversation(sessionId)`：同一次 action 删除该 session 的 history、active、settled、runtime、preview、window 和分页状态；
- session 超过现有 10-session cache：同一次 LRU eviction 删除被淘汰 session 的所有 state map，包括 `nextLiveOrdinalBySession`；
- 页面刷新：内存状态自然重建，最终内容从 visible history 加载；
- edit/supersede：不以通用 cleanup 猜测，而由现有 root/attempt/visibility action 定向隐藏、替换或回滚。

### 8. 本 change 对 requestAnimationFrame 长任务的责任边界

本 change 不移除 stream animation-frame batching。直接改成 `setTimeout` 只会改变 DevTools violation 的 callback 名称，并可能增加可见延迟，不能消除同步工作。

本 change 必须消除以下 frame callback 内的跨 Turn 放大：session-wide live identity scan、combined rebuild、history budget/trim、settled Turn 重复 compaction、所有历史 root 的 live regroup、非 conversation consumer 对 history/active/settled envelope 的重复 flatten/sort/scan，以及由旧 block 引用变化产生的无关 React render。验证必须证明相同 active batch 的 store/projection 工作不随 settled Turn 数量增加，普通 stream envelope 也不得发布后台任务状态。

以下成本仍可能记在同一个 requestAnimationFrame long task 中，但不由 envelope 生命周期单独解决：当前 active Turn 内部超过 1000 个不可合并事件的过程派生、不断增长的完整 Markdown 解析、Mermaid/structured renderer、Process Panel height measurement、ResizeObserver 后续布局和物理置底。实现后必须用同一浏览器旅程重新采集 Performance trace；若 long task 仍由这些当前 Turn/布局节点占主导，另开证据驱动的渲染或布局 change，不在本 change 中加入虚拟化或第二套 view model cache。

### 9. 实施与并行边界

本 change 以 `stabilize-agent-web-popup-and-scroll` 已完成的逐帧 stream batching、稳定 historical projection、提交 task yield、anchored/recent 窗口和置底动画实现为输入基线，并在其后串行实施。前序 change 中锁定 store shape 与 500 hard cap 的 characterization/test 由本 change 的 bucket 生命周期、watermark 和旧层删除任务明确替换；前序 viewport、滚动、提交时序、memo 和 render-stability 回归继续保留，不回写或改写前序 change 的已完成任务记录。

实施顺序固定为 characterization tests、store 生命周期、projection/source precedence、consumer 切换、旧扁平层删除、浏览器性能取证。任何同时修改 `conversationStore`、`buildSessionProjection`、Turn overlay 或 stream consumer 的前端工作必须串行，避免两套 owner 或冲突的 source precedence；不改变 stream/history contract 的纯后端工作可独立并行。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 只重组已通过现有 stream validation 的浏览器内存投影；不新增不可信输入、身份字段、持久化或内容日志。 | 现有 stream validation tests、代码审查确认无 API/contract 变化 |
| 性能/容量 | active append 只处理当前 attempt bucket；settled bucket 稳定；500 仅触发单遍无损压缩。页面内存随已显示 Turn 和不可合并事件增长，DOM 虚拟化后置。 | store/projection reference tests、600 Turn/1000 event tests、浏览器 Performance trace |
| 可靠性/恢复 | terminal 原子迁移；history canonical 优先；opening/gap/manual refresh 不删除已接受 detail；edit visibility 防止旧 root 复现。 | terminal、history merge、gap、edit/retry/rollback integration tests |
| 可维护性 | conversation store 是唯一 lifecycle owner；按 root/attempt 分桶；不缓存 TurnBlock，不引入 pendingHistory。 | store/action tests、review 检查无平行缓存和扁平 mirror |
| 可测试性 | 生命周期动作和 projection source precedence 均为确定性纯输入/输出；性能用引用稳定和处理范围断言，不依赖机器固定毫秒阈值。 | Vitest、React render spy、Playwright trace |
| 审计/可追溯性 | 不新增 audit/log；保留 envelope identity、sequence、timeline ref 和 root/attempt 关联。 | stream order/cursor tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| history canonical 内容与 settled process detail 分工 | 2.1、3.1 | `buildSessionProjection.test.ts`、`buildTurnBlocks.test.ts` |
| terminal 原子迁移且不 refresh conversation | 1.2、4.1 | `conversationStore.test.ts`、`useChatSessionStream.test.tsx` |
| 超过 500/1000 不截断 | 1.3、5.1 | `streamCompaction.test.ts`、`conversationStore.test.ts` |
| anchored 保存但不插入非连续 DOM | 1.4、3.2、5.2 | store/projection tests、Playwright anchored journey |
| edit/retry/rollback/visibility | 2.2、5.3 | store、Turn projection、route-state tests |
| active append 不随 settled Turn 数增长 | 1.1、3.3、5.4 | reference/work-scope tests、Performance trace |
| clear 与 LRU 同步清理 | 2.3、5.1 | `conversationStore.test.ts` |
| API/runtime/host contract 不变 | 4.2、6.1 | frontend build、mode build/smoke、OpenSpec strict validate |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ts-stream-history-consistency/spec.md` 主承载 history/live source precedence 与恢复行为；`openspec/specs/e2e-ui-interaction/spec.md` 主承载长会话可见稳定性和容量行为；`openspec/specs/agent-web-background-task-control/spec.md` 主承载一次 seed 与后台任务 stream 增量投影行为。
- 架构和跨模块设计：`openspec/designs/architecture/agent-web-host-modes.md` 主承载 ChatWorkspace 在多宿主中的统一 history/live/window 协作边界。
- 模块设计：`openspec/designs/modules/agent-web.md` 主承载 conversation store bucket、projection、cleanup 和 consumer 路由。
- ADR：无；不新增跨 owner 或难以回滚的长期架构选择。
- 导航：`openspec/designs/spec-to-design-map.md` 连接三个 capability、Agent Web 模块设计和验证入口。

## 风险与取舍（Risks / Trade-offs）

- [当前页面内存不再由 500 hard cap 强制封顶] -> 数据增长与用户已加载/已显示 Turn 数量一致；session LRU 和页面刷新仍提供明确回收边界，DOM/历史虚拟化后置。
- [单个超大 Run 仍可能产生 active Turn 内部 long task] -> 使用无损 compaction 和 frame batch 降低 token 级对象数；实施后用 Performance trace 判断是否需要独立 Markdown/process/layout 优化。
- [history 与 settled 混合可能重复最终内容] -> 合并器按 semantic lane 选择唯一 source，不做 envelope 数组无条件拼接；加入同 root 单 Turn/单 answer 回归测试。
- [anchored 保存窗口外数据可能误插入当前 DOM] -> store 接受与 window selector 分离；anchored selector 只允许补充当前历史 roots，窗口外 root 仅在 recent 连续窗口显示。
- [edit 后 retained live 可能复现旧消息] -> canonical visibility 优先，所有 edit/supersede/rollback action 明确覆盖 active 与 settled bucket。

## 迁移计划（Migration Plan）

1. 先增加当前 500 截断、terminal 连续性、anchored 丢弃和旧 Turn 引用稳定的 characterization tests，并识别前序 change 中只为旧 store shape/500 hard cap 服务的断言；后续任务只替换这些断言，不删除 viewport、提交时序或 render-stability 回归。
2. 在 conversation store 内新增 active/settled bucket，并把 stream、history load、edit/retry/clear/LRU action 迁移到唯一新状态。
3. 将 ChatPage 和 session projection 切换到 history + settled + active 输入，删除 combined/live 扁平产品路径。
4. 删除旧 destructive capacity 和无法再触达的 helper/test fixture，运行前端定向测试与 build。
5. 执行长会话浏览器旅程并采集变更前后 trace；只以已验证的跨 Turn 同步工作消除作为本 change 完成证据。

该变更没有持久化数据迁移。若实现回滚，恢复旧前端 store/projection 即可；后端和已持久化消息不需要回滚。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-stream-history-consistency/spec.md`：归并 source precedence、terminal、history merge、visibility 和页面刷新行为。
- `openspec/specs/e2e-ui-interaction/spec.md`：归并 500 watermark、超大 Run、稳定 Turn 和 anchored 隔离保存行为。
- `openspec/specs/agent-web-background-task-control/spec.md`：归并一次 session seed、后台任务 stream 增量投影和 conversation lifecycle 独立性。
- `openspec/designs/architecture/agent-web-host-modes.md`：归并统一 ChatWorkspace 的 history/active/settled/window 协作边界。
- `openspec/designs/modules/agent-web.md`：归并 bucket 状态、原子迁移、projection、compaction、consumer 和 cleanup 设计。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：补充三个 capability 到设计和测试入口导航。

## 待确认问题（Open Questions）

无。
