## 背景和现状（Context）

父change已建立稳定后端事实链：模型调用中的累计`LLM_THINKING_DELTA`只进入live stream；单次模型调用结束时，最后一个非空累计delta以`completed=true`持久化并投影；run event history通过`GET /api/v1/sessions/:sessionId/runs/:runId/events`返回shared projector生成的`StreamEnvelope`；fork child拥有自己的durable event snapshot。Message、event、context与prefix cache的边界已经确定，本change不能重新定义。

当前 browser 路径是：

```text
conversation message API
  -> sessionService.loadConversation
  -> conversationStore.historyMessagesBySession
  -> conversationMessagesToHistoryEnvelopes
  -> historyEnvelopesBySession
  -> buildSessionProjection / buildTurnBlocks
  -> buildProcessEntries
  -> ProcessPanel

live SSE / WebSocket
  -> conversationStore.liveEnvelopesBySession
  -> 同一 buildSessionProjection / buildTurnBlocks / buildProcessEntries
```

缺口在 message API 与 history envelope layer 之间：前端没有消费 run event API。`SessionConversationMessage` 已包含 optional `runId`，但 `SessionService` 没有 event page method，conversation store 也没有 per-run process load state。结果是 live process detail 在刷新后消失。

`ProcessPanel` 当前有 panel-level `auto-expanded | auto-collapsed | user-expanded | user-collapsed` 状态、150ms terminal collapse 和 200ms height transition，也会在 panel 打开时展开全部条目、在 running 阶段展开新条目。它没有识别 entry 从 active 到 settled 的转换，没有 per-entry manual override，也没有 reduced-motion 对 inline transition/timer 的完整处理。

相关方包括电信网络运维用户、历史审计用户、三种 agent-web 宿主、父 change 的 runtime/channel API，以及共享 chat core 的现有 message、stream、pagination、retry/edit/fork 路径。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 浏览器按当前可见 message window 的 display runs 拉取完整 persisted event pages，使 completed live process 与 cold history 最终一致。
- Message 成功即可展示；process event loading、empty、legacy unavailable、failure 独立表达和重试。
- retry、session switch、anchored/older/newer window、重复刷新和迟到响应不混合 run 或 session。
- 当前 running entry 展开，settled entry 延迟折叠，用户手动操作在当前 run 内优先。
- completed panel 默认折叠，用户重新展开后可以自由查看全部保留内容。
- local、immersive、collaborative 复用同一实现和旅程结果。

**非目标：**

- 不修改父 change 的 Web URI、schema、runtime facade、gateway、timeline persistence、fork snapshot、event type 或 projector。
- 不把 thinking 变为 message、context part、share/export内容或provider输入。
- 不实现 redaction、限长、截断、externalize、管理员配置、隐藏 thinking 或升级前数据回填。
- 不新增 browser durable storage、service worker cache、全 session process prefetch 或 host-specific实现。

## 设计决策（Decisions）

### 决策1：Message window 立即展示，process history 异步补齐

`sessionService.loadConversation` 继续只负责 message page。Conversation store 在把 page messages 和 message-derived envelopes 同步提交、将 conversation load state 标为 ready 后，立即计算该 window 的 display run targets，并启动独立 event hydration。`loadConversation()` 的成功不等待所有 event pages，因此慢 event API 或单个 run 失败不会阻塞最终答案。

放弃方案：

- 后端把event嵌入conversation response：破坏父 change 已确认的message/event分离和独立查询接口。
- 等待全部events后一次性显示conversation：扩大首屏延迟，并让process失败拖累已提交message。
- 只在用户展开panel时加载：减少请求，但首次完成态不是自动收敛，展开后出现额外空窗，也不利于三宿主一致旅程。

### 决策2：每个root turn只选择一个display run

新增纯函数`selectVisibleProcessRunTargets(messages)`，先按`rootMessageId ?? messageId`分组并按message sequence排序。每个root优先选择最后一个visible ASSISTANT message的非空`runId`；没有assistant时，选择最后一个visible、非SUMMARY message的非空`runId`。相同`sessionId + runId`去重。

该规则与父 change 的“visible assistant对应run”一致，同时让没有assistant answer的failed/canceled turn仍可显示自己的process。旧retry attempt若不再属于visible message selection，不会自动hydrate。Event envelope必须继续携带父projector提供的root/request/run correlation；frontend不得凭时间或相邻位置猜测root。

### 决策3：单页transport与完整run加载分离

Frontend-only contract增加：

```ts
type SessionRunEventHistoryPage =
  | {
      readonly availability: "AVAILABLE";
      readonly events: readonly StreamEnvelope[];
      readonly nextAfterSequence?: number;
    }
  | {
      readonly availability: "LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE";
      readonly events: readonly [];
    };

interface LoadRunEventsQuery {
  readonly sessionId: string;
  readonly runId: string;
  readonly afterSequence: number;
  readonly limit: 1000;
  readonly signal?: AbortSignal;
}
```

`sessionService.loadRunEvents()`只请求一页，并在返回前用新的`parseSessionRunEventHistoryPage()`校验exact availability shape、cursor和`events`；每个event复用live入口已有的`normalizeStreamEnvelope()`，校验并产出相同browser envelope shape。LEGACY response若包含非空events或cursor、AVAILABLE cursor非法、任一event非法时整页失败。新文件`frontend/agent-web/src/features/chat/history/processHistory.ts`拥有完整run loader：从0开始、固定limit 1000、拒绝与查询`sessionId/runId`不一致的envelope、验证cursor严格递增、按canonical sequence排序并按eventId去重，直到无cursor。它不读取gateway record，不重新project payload。

Conversation store拥有最多4个并发run load的session-local队列。4是固定browser容量边界，不做配置项；单run分页串行，从而同时在途HTTP请求也不超过4。AbortSignal贯穿每页请求。

### 决策4：Conversation store拥有frontend process cache与load version

新增frontend-only discriminated state：

```ts
type RunProcessHistoryState =
  | { readonly status: "IDLE" }
  | { readonly status: "LOADING" }
  | { readonly status: "AVAILABLE"; readonly envelopes: readonly StreamEnvelope[] }
  | { readonly status: "LEGACY_UNAVAILABLE" }
  | { readonly status: "FAILED"; readonly errorCode: "PROCESS_HISTORY_LOAD_FAILED" };
```

State按`sessionId -> runId`存放；AVAILABLE可包含空数组，因而empty不是failure。Store另存当前message window选择的runId集合和session load version。每次authoritative replace、anchored load或clear递增version并abort过期controller；older/newer merge只增加当前window targets，不清除仍可见且已成功的cache。任何异步结果提交前同时校验session、run、version和当前selected set。

`historyEnvelopesBySession`继续是下游唯一history layer，但由两部分重建：message-derived envelopes + 当前selected AVAILABLE run envelopes。Process envelopes统一增加既有`history-load`transport hint，再走现有dedupe和`buildSessionProjection`。Live layer保持独立；相同eventId由现有layer merge去重。Message API可能不返回canonical `requestContextId`，此时adapter只能使用`requestId`作为message-derived envelope的兼容坐标；同一selected explicit `runId`必须作为message/event组成同一attempt的权威键，不能因此把event history从answer所在turn丢弃。不同`runId`仍严格隔离。Message重新加载时先用cache重建，随后只自动请求IDLE run；FAILED run只有在用户显式重试后才再次请求，不重复请求AVAILABLE或LEGACY_UNAVAILABLE。

Capability event envelopes与message-derived `CAPABILITY_RESULT_DELTA`继续进入现有`buildProcessEntries`，只按受控run/tool correlation合并。Event决定lifecycle与ordering，message决定durable result正文；没有匹配message时使用既有安全unavailable摘要，不能把`CAPABILITY_COMPLETED` status当作结果正文。Frontend不建立第二套tool join model。

Store暴露`retryRunProcessHistory(sessionId, runId)`；只允许当前selected且FAILED的run进入LOADING。LEGACY_UNAVAILABLE不自动或手动回读source，因为父change明确禁止lineage read-through。

### 决策5：Process availability作为view state传递，不伪造成event

Process loading/failure/legacy状态不是canonical timeline事实，不生成synthetic `StreamEnvelope`。`buildSessionProjection`为每个`TurnBlock`保留选定`displayRunId`；ChatPage/MessageList按该id读取`RunProcessHistoryState`并作为props传给`TurnBlock`/`ProcessPanel`。

ProcessPanel在无entries但状态为LOADING、FAILED或LEGACY_UNAVAILABLE时仍显示summary row和对应安全文案。FAILED提供retry button；LEGACY_UNAVAILABLE只说明升级前fork没有过程详情；AVAILABLE empty不显示错误。该view state不进入share、context、stream cursor或history envelope排序。

### 决策6：条目 disclosure 逻辑从大组件提取为单一hook

新增`useProcessEntryDisclosure.ts`，输入`rootMessageId`、`executionDetailsPhase`、`processDisplayEntries`、`panelIsOpen`和reduced-motion状态，输出expanded/rendered/visible key sets及manual toggle。它拥有entry timer、animation frame、previous final-state和manual override sets；`ProcessPanel`继续拥有panel-level mode和panel height/anchor compensation。

唯一entry状态规则：

1. Panel在running阶段出现新`isFinal !== true` entry：若无manual override则auto-expand。
2. 同key从`isFinal !== true`变为`isFinal === true`：若无manual override且normal motion，800ms后auto-collapse；reduced motion立即collapse。
3. 并行entries按key独立计时。
4. 用户toggle先取消该key timer/frame、记录manual override，再切换状态；后续auto逻辑跳过该key。
5. Completed/history panel从closed变为user-expanded时展开全部entries，但settled phase不安排entry auto-collapse，支持自由查看。
6. `rootMessageId`变化或unmount清除所有entry timers、frames和manual overrides。

`ProcessDisplayEntry.isFinal`继续是唯一settled信号。Thinking只由父change的`metadata.completed=true` envelope设置`isFinal=true`。`LLM_CONTENT_DELTA`属于answer通道，不形成ProcessPanel过程entry或关闭当前连续thinking；Capability等实际过程entry仍通过现有projection关闭连续边界。Hook不使用`runId + stepId`重新合并segment。

累计thinking delta只改变同一entry的正文，不构成panel render lifecycle或disclosure lifecycle变化。连续thinking段使用`rootMessageId + attemptId + segment ordinal`组成frontend view key；canonical `eventId`仍保留在envelope上，但不作为entry disclosure身份，因此frontend容量压缩产生的新compacted `eventId`不会重挂载同一thinking条目。`ProcessPanel`在panel content挂载期间只维持一个`ResizeObserver`；正文增长、entry展开/折叠和终态收起产生的真实高度变化由该observer连续报告，不把`processEntries`数组引用或expanded key集合当作重建observer的依赖。只有panel content的rendered生命周期或height callback owner变化时才重新绑定measurement，从而避免每个delta同步测量、断开和重连observer引起的重复布局更新。

### 决策7：Reduced motion由同一hook驱动状态和样式

新增共享`usePrefersReducedMotion()`读取`matchMedia("(prefers-reduced-motion: reduce)")`并监听变化。Reduced motion下entry settled立即折叠；panel与entry inline transition duration传0ms；idle sweep沿用现有CSS media禁用。状态结果不变，不新增独立UI模式。

### 决策8：三宿主只验证shared core，不增加适配器逻辑

Local、immersive、collaborative最终都渲染同一个ChatPage/conversation store/ProcessPanel。实现不得修改host入口来处理event history。Component/integration tests验证shared core；现有Vite mode builds验证三入口仍消费同一artifact；Playwright用相同后端fixture分别进入三种host journey，断言冷历史、live folding和manual reopen结果。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | Browser在HTTP边界runtime校验page和channel-safe StreamEnvelope；run query仍由后端Owner/Agent scope校验。Store只保留固定safe errorCode，失败文案不显示raw error、source session或timeline payload；不生成synthetic canonical event。 | service/store invalid-response negative tests、payload fixture review、frontend source ownership architecture test |
| 性能/容量 | 只hydrate当前message window的distinct display runs；单页limit固定1000；每session最多4个并发请求；cursor异常fail closed；不全session预取、不持久化browser cache。 | pagination、4并发上限、dedupe、abort tests；三宿主旅程network assertions |
| 流式呈现稳定性 | 同一entry的累计delta不重建panel measurement；一个active observer连续跟踪真实高度变化，entry终态与panel终态仍按既有800ms/150ms状态机执行。 | ProcessPanel component observer-lifecycle test、窄视口live journey |
| 可靠性/恢复 | Message先提交到UI；process按run独立失败和重试。Session/load version与AbortSignal阻止迟到响应污染；AVAILABLE empty、LEGACY和FAILED明确区分。 | conversationStore race、switch、older/newer、retry、legacy/empty tests |
| 可维护性 | Transport单页、纯selection/pagination、store ownership、view projection和entry disclosure职责分离；不复制projector或host逻辑。 | module tests、dependency/source architecture assertions、ownership semantic verification |
| 可测试性 | Selection、pagination和disclosure均为确定输入输出；timer使用fake timers，matchMedia可stub；API使用fetch fixture。 | Vitest service/store/hook/component suites与Playwright mode matrix |
| 审计/可追溯性 | Canonical eventId/sequence/runId保持父projector原值；frontend状态不伪造event。用户可通过process unavailable状态区分未加载、旧fork缺失和读取失败。新增前端日志不是目标，避免记录thinking正文。 | envelope identity assertions、无raw payload/log review、history/live fixture equivalence |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| visible turn唯一display run，retry不混attempt | 2.2、3.1 | processHistory selector tests、conversationStore retry tests |
| event完整分页、cursor递增、最多4并发 | 2.3、2.4 | sessionService/processHistory tests |
| HTTP response runtime validation与safe failure | 2.1、3.1 | sessionService invalid page/envelope tests、conversationStore safe state tests |
| message先显示，event failure/legacy/empty独立 | 3.1、4.1 | conversationStore、TurnBlock/ProcessPanel tests |
| session/load version隔离与abort | 3.2 | conversationStore race/switch/anchor/older/newer tests |
| history/live进入相同projection且final answer仍来自message | 3.3 | buildSessionProjection/processDetails integration tests |
| capability lifecycle与message result按run/tool join | 3.3 | processDetails integration tests、missing result negative test |
| running expand、settled 800ms collapse、并行独立 | 5.1、5.2 | hook fake-timer tests、ProcessPanel component tests |
| 累计delta不重复重建panel measurement | 5.4 | ProcessPanel observer-lifecycle component test |
| manual override按current run隔离 | 5.1、5.2 | hook/component tests |
| terminal panel 150ms collapse且reopen内容完整 | 5.2 | ProcessPanel/TurnBlock tests |
| reduced motion无200ms/800ms motion | 5.1、5.2 | matchMedia + fake-timer tests |
| 三宿主共享实现与行为 | 6.1、6.2 | architecture source guard、build:vite:modes、Playwright mode journeys |
| 不修改backend contract/context/share/prefix cache | 7.2 | git diff review、focused backend non-regression、nextagent semantic review |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ts-stream-history-consistency/spec.md`主承载message/event history组合、run选择、分页和失败隔离；`openspec/specs/agent-web-process-panel/spec.md`主承载entry/panel disclosure行为；`openspec/specs/agent-web-multi-host-modes/spec.md`主承载三宿主一致性。
- 架构和跨模块设计：`openspec/designs/architecture/conversation-ui-state.md`主承载message window、process run hydration、history/live layer与frontend failure state的数据流。
- 模块设计：`openspec/designs/modules/agent-web.md`主承载service、processHistory helper、conversation store、projection和ProcessPanel职责。
- ADR：无新增。父change的message/event分离、shared projector和fork snapshot决策保持主承载，不重复建立ADR。
- 导航：`openspec/designs/spec-to-design-map.md`在归档前连接三个capability、两个design入口和测试入口。

## 风险与取舍（Risks / Trade-offs）

- [一个conversation window可能包含很多runs，产生多次HTTP请求] -> 只选display run、distinct去重、4并发上限、单run分页串行；不做全session预取。
- [Message先显示导致process稍后出现] -> 明确LOADING状态并保持panel默认collapsed；这是换取final answer首屏与部分失败隔离的有意取舍。
- [Event与message envelope sequence属于不同事实序列] -> 不重新编号；保留canonical createdAt/sequence/eventId并使用现有turn correlation与排序。发现缺少root correlation时整run FAILED，不按相邻位置猜测。
- [ProcessPanel已有大量本地状态，继续叠加会降低可维护性] -> 把entry disclosure提取为单一hook，仅保留panel-level measurement/anchor逻辑在组件内，不重构无关rendering。
- [Frontend 依赖 run event endpoint] -> backend event endpoint 必须先于或与 frontend 同时发布；缺少该 endpoint 时不得单独启用 history hydration。
- [旧fork没有snapshot] -> 显式LEGACY_UNAVAILABLE，不回读source、不伪造empty、不做迁移回填。

## 迁移计划（Migration Plan）

1. Backend run event endpoint 必须先于或与 frontend history hydration 同时上线。
2. 本能力不需要 schema 或 data migration；升级前 fork 继续返回明确的 `LEGACY_UNAVAILABLE`，不得猜测或回读 source。
3. Frontend 回滚后，message history 与 live process 继续可用；backend 已持久化的 process events 可安全保留，且不进入 context。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-stream-history-consistency/spec.md`：合并browser display-run hydration、分页、失败隔离和load-version行为。
- `openspec/specs/agent-web-process-panel/spec.md`：合并entry lifecycle、manual override、completed/history inspectability和reduced-motion行为。
- `openspec/specs/agent-web-multi-host-modes/spec.md`：合并三宿主共享process history/folding要求。
- `openspec/overview.md`：提炼message与event在browser组合后才形成完整历史体验的长期背景。
- `openspec/designs/architecture/conversation-ui-state.md`：提炼跨service/store/projection/component的数据流、状态和可靠性边界。
- `openspec/designs/modules/agent-web.md`：提炼各frontend模块owner和依赖关系。
- `openspec/designs/adr/`：不新增。
- `openspec/designs/spec-to-design-map.md`：补充capability、design和验证入口导航。

## 待确认问题（Open Questions）

无。关键范围、API依赖、run选择、分页上限、并发上限、失败语义、entry时序、manual override、reduced-motion和三宿主边界均已收敛为唯一实现路径。
