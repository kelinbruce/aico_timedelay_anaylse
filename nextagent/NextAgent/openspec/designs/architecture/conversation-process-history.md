# 对话过程历史

## 目的与范围（Purpose and scope）

对话过程历史在 run 结束后保留用户可见的执行过程，同时保持对话 message 和执行 event 作为两个独立的持久事实。稳定的结果是：

- `SessionMessage` 拥有用户输入、最终 assistant 输出、公开的 Tool 轮次解释、Tool 调用以及被 model 协议和后续 context 使用的 canonical capability-result 内容。
- `RunTimelineEvent` 拥有 request/run 排序和状态，包括已完成的模型 thinking、capability 生命周期、指向 message 所拥有过程内容的强引用，以及一个可选的封闭、不含内容的 projector 分类器。受治理的 `TOOL_STRUCTURED_DELTA` 可以额外携带一个有界的过渡性呈现快照，仅供 live/history UI 使用；它不是第二个语义结果 owner，也绝不进入 model context。
- `StreamEnvelope` 是同时服务 live 交付和 REST event history 的唯一 channel 安全浏览器投影；Capability result 摘要/详情在读取时由可信共享 projector 生成，而不是复制进任一持久事实。
- `agent-web` 将可见 message 窗口与所选 run 的投影 event 分页组合；它不制造后端生命周期事实。

本设计不使 thinking 成为模型可见历史。Timeline event（包括 fork 快照）绝不进入 Active Context、context assembly、provider input、token budget 或 prefix-cache input。分享和文本导出仍仅限 message。

## 归属（Ownership）

| 关注点 | Owner | 非 owner 约束 |
|---|---|---|
| Model 调用 thinking 累积和完成回调 | `agent-core` model producer | Workflow 节点和 request terminal 边界不能推断 thinking 完成。 |
| Event 分类、先 append 后 publish、run 范围 history facade 和 fork 编排 | `agent-runtime` | Channel、frontend 和 gateway 不拥有 request lifecycle。 |
| Timeline 行、范围分页、fork 快照行/状态和原子 fork composite | `agent-platform-gateway-local` | Gateway 不推断 event 可见性或 model-context 语义。 |
| 安全的 live/history 投影和 REST 序列化 | `agent-channel-common` / `agent-channel-web` | Channel 绝不暴露 gateway record 或原始 timeline payload。 |
| Message 窗口选择、event hydration、投影 join 和过程披露状态 | `frontend/agent-web` | 宿主 shell 不独立拉取 event 或维护过程缓存。 |

## 持久事实与公开契约（Durable facts and public contracts）

### Thinking 生命周期

`LLM_THINKING_DELTA` 是唯一的 thinking event 类型。其 canonical payload 有两个合法的生命周期形态：

```ts
type ThinkingPayload =
  | { readonly reasoning: string; readonly stepId: string }
  | { readonly reasoning: string; readonly stepId: string; readonly completed: true };
```

`reasoning` 和 `stepId` 在 trim 后必须非空。`completed=false` 非法。Producer 发送累积内容，因此最后一个 event 已包含该次 model 调用的完整文本；完成标记作用在该最后一个累积 delta 上，而不是创建新的 thinking 内容或新的分段类型。

Runtime 持久化策略是声明式的：

| Event | 分类 |
|---|---|
| 不带 `completed` 的进行中 `LLM_THINKING_DELTA` | `LIVE_ONLY` |
| 带 `completed=true` 的最后一个累积 `LLM_THINKING_DELTA` | `PERSISTED` |
| 进行中或 `final=true` 的 `LLM_CONTENT_DELTA` | `LIVE_ONLY` |
| 带 `messageId`、非空 `stepId` 和 `completed=true` 的已完成 Tool 轮次 `LLM_CONTENT_DELTA` | `PERSISTED` |
| `CAPABILITY_RESULT_DELTA` | `LIVE_ONLY` |
| 受治理的 `TOOL_STRUCTURED_DELTA` | Runtime 累加器持久化一个有界呈现快照；直写和 `finishRun` 回退写入应用相同的 pre-gateway 上界 |
| 带有 assistant Tool-use `messageId` 的 `CAPABILITY_STARTED` | `PERSISTED` |
| `CAPABILITY_COMPLETED` | `PERSISTED`；仅在该结果 message 已存在后才包含结果 `messageId` |
| 既有 canonical 生命周期事实 | 既有持久化分类 |

`RuntimeOwnedAgentRunStatePort.emitEvent` 校验 event 及其声明的持久化方式，应用该策略，直接发布 live-only event，并在 canonical 发布之前 append 持久化 event。它没有 thinking 专用的持久化分支。每次 model 调用最多持久化一行已完成 thinking。没有非空 reasoning 就没有已完成 thinking event。Producer 观察到 model 调用完成之前发生 crash 可能丢失进行中的 thinking；恢复不得凭空构造它。

已完成的 thinking event 排序在 `MODEL_INVOCATION_COMPLETED` 或 `MODEL_INVOCATION_FAILED` 之前。append 失败会阻止依赖的 model terminal event 发布，并沿用既有安全失败路径。

### Message 引用的过程内容

已作为 `SessionMessage` 存在的公开过程内容只有一个持久 body owner。`agent-core` 先通过 `AgentRunStatePort` append `ASSISTANT_TOOL_USE` 或 `CAPABILITY_RESULT` message，再用返回的 `messageId` 发布可恢复 event。已完成的 Tool 轮次 `LLM_CONTENT_DELTA`、`CAPABILITY_STARTED` 和携带结果的 `CAPABILITY_COMPLETED` 只持久化引用加上自身的 step/tool/status 坐标；它们不得持久化可恢复文本、Tool 参数或 Tool 结果副本。Message append 失败会阻止依赖的引用 event。进行中 delta 和最终答案 delta 保持 live-only，而最终 Assistant Message 仍是 terminal 答案事实。

受治理的结构化呈现是“普通过程 Event 无 body”原则的一个封闭过渡例外，而不是对 Message 语义归属的例外。Runtime 按 `(runId, toolCallId)` 对识别到的 `TOOL_STRUCTURED_DELTA` 分组，对分组/event/源字节设界，并为每次 flush 最多持久化一个规范化呈现快照。普通已完成 Tool 结果在私有 runtime flush 之前 append canonical `CAPABILITY_RESULT` Message；因此 Message append 失败不会留下已完成的呈现快照。该快照只被 Channel/Web 呈现消费，MUST NOT 进入 Context、模型披露、terminal truth、完成限制或 fork/model 权限。失败或已取消的 run 可以保留一个显式 partial 回退快照，但该快照不是已完成的 capability 结果。

每条结构化 timeline record 在 local 或 remote gateway append 之前都被规范化，使 `Buffer.byteLength(JSON.stringify(inlinePayload), "utf8") <= 49_000`。截断保留所支持的 TEXT、STREAM_DSL、PIU 对象和数组内容形态并设置 `truncated=true`；公开 stream/history projector 将该标记保留为展示事实。同一规则适用于直写 flush 和 `finishRun` 回退。真实的 append 失败仍通过既有 request 一致性路径传播，绝不转换为尽力而为的成功。

History 为一个普通已完成结果恰好选择一个结构化呈现来源。当同一 run 和 `toolId` 存在合格的持久结构化快照时，浏览器使用它并只抑制匹配的 Message 派生兼容呈现；否则保留既有 Message 派生投影。普通 `ANSWER` Message、其他 run 和其他 Tool 调用绝不被抑制。该选择避免了 UI 重复 body，同时不使 Event 成为 canonical 语义内容。一旦 canonical Message 契约可以承载独立治理的最终呈现，过渡性 Event body 就可以在不改变 model-context 归属的情况下移除。

`RuntimeSessionPort.resolveProcessMessages(query)` 是一个服务端专用关联 port。其可信 query 包含 identity、session、request 和 run 坐标、1 到 1,000 个去重 `messageIds`、可选 cancellation，以及一个只被 event history 使用的可选 legacy-candidate 模式。Runtime 先校验 Owner Scope、Agent Scope 和 session 绑定的 run，再通过既有 session port 读取当前 request 的隐藏 message。它只返回 `SessionMessage` 领域对象；它不是 Web 路由，不接受客户端选择的权限，也绝不返回 gateway record。Legacy candidate 模式最多返回 1,000 个完整候选；溢出安全失败，而不是在截断集合上做关联。

`agent-channel-common` 拥有共享的 `ProcessMessageAssociation` parser/projector。它重新校验 session/request/run、message 角色和 `toolCallId`，只选择公开解释、精确 Tool 调用或既有安全结果投影，并在任何不匹配时发出带 status-only 内容的 `contentUnavailable=true`。它绝不暴露隐藏 message record、可见性元数据、原始 Tool 输入/输出或 event 的 legacy body。SSE 和 WebSocket 共享一个订阅内最多 1,000 条已解析 message 的缓存，并在订阅关闭时释放该缓

Live 完成收敛是订阅范围的：当同一可信订阅已经交付了非空安全累积内容且其出现坐标全部与完成引用匹配时，完成投影复用已交付内容并原地推进完成状态，无需立即重新读取刚 append 的 Message。只有当当前订阅没有可复用内容且 Message 关联失败时，引用 event 才投影 `contentUnavailable=true`；空内容的不可用完成 MUST NOT 覆盖同一出现已交付的非空内容。缓存 miss、刷新、重连、迟到加入和 history 加载仍在服务端从唯一持久的 `SessionMessage` 解析内容，并保持相同 scope 校验和 fail-closed 行为。

Model step 出现身份按输入分段限定：相同的 model step 只在同一被接受的用户输入分段内累积更新；一个输入分段前后的执行解释保持各自的顺序，绝不互相替换。对于给定 `toolCallId`，生命周期、结构化过程条目、普通安全结果和 terminal 状态构成一张锚定在 started 时间戳的卡片，包括冷 history 恢复时（started 锚点单卡恢复）。

Capability Result 关联还在 live transport 和 history 共用的同一共享 projector 中应用冻结的 `CapabilityResultPresentationPolicy` 和 identity-first 平台安全规则。它先计算安全 schema 投影再应用集成级别，然后删除高于生效 `STATUS_ONLY` / `SUMMARY` / `DETAIL` 级别的所有字段。未知 identity 或形态、非法 schema/关联以及没有受管 projector 的扩展都以 `STATUS_ONLY` fail closed；浏览器绝不重新解析 canonical Message 内容来恢复更多细节。平台生成的摘要描述符保持语言中立，因此 locale 变化只重渲染既有 envelope。

大多数完成 event 只需要其 Message 引用和 Tool 坐标。可信 CLIP descriptor 是受控例外：完成可以持久化 `resultProjectionKind=CLIP_STREAM_V1`，使 history 能选择与 live 相同的 raw-to-safe projector。该标量是一个封闭的 `agent-common` vocabulary 值，不含结果文本，未知时被拒绝，也绝不返回给浏览器。Event 行仍不包含安全摘要或结果副本。

Workflow 内部非 runtime-Capability 节点（如 `DELAY`、`CONDITION`、`RESTFUL`）携带可信 `nodeId`/`nodeType`/`toolCallId` 生命周期事实用于关联、history 和诊断，但该事实身份不是业务标题。当此类节点没有匹配的非空结构化 `TITLE` 或 `SUB_TITLE` 时，浏览器可见过程 MUST NOT 创建独立生命周期步骤，MUST NOT 将 `nodeId`、`capabilityId`、`toolCallId`、关联 id 或 `nodeType` 作为标题呈现；匹配的结构化详情只在非失败终态保留为纯内容出现，并在失败或超时终态被抑制。当同一出现存在结构化业务标题时，成功、失败和超时完成合并到该标题，不创建第二个生命周期或通用失败步骤。具有合法 `capabilityKind`（`TOOL`、`SKILL`、`AGENT`、`WORKFLOW`）的节点保持既有标题和状态规则。当节点有业务标题但 `show_content=false` 时，runtime projector 发出一个无 body 的成功 terminal 生命周期，使浏览器展示实际完成状态，同时继续抑制结构化内容。活跃 live、已 settle 的 live 和冷 history 应用同一分类函数，产生相同的可见步骤、内容出现和顺序。

### Run event-history API

`RuntimeSessionPort.listEvents` 是 owner 范围、Agent 范围、session 范围和 run 范围的。它接受 `afterSequence`、`1..1000` 的 limit 以及可选 cancellation。当前 run 从 `RequestRun` 解析；被复制的 run 从 child 拥有的 fork 快照状态解析。未知或越界 run fail closed。

Web 端点是：

```text
GET /api/v1/sessions/:sessionId/runs/:runId/events?afterSequence=<n>&limit=<1..1000>
```

其响应是以下二者之一：

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
```

Runtime 校验 scope 和 canonical 行，移除仅持久化的 identity 和元数据，并返回一个有界分页。在同一个 HTTP 请求内，history 路由通过 `resolveProcessMessages` 对该分页的 message 引用做一次批量解析，并把 event/message 对传给 SSE 和 WebSocket 共用的同一 allowlist projector。单个非法引用变成一个可排序的 status-only envelope，而不丢弃其他合法 event。损坏的 event 分页或不安全的分页级投影仍使该分页失败；被过滤的 timeline-only event 不移除合法的下一页 cursor。

不带 `messageId` 的旧持久 event 只有在完整有界候选集合按 session/request/run、message 角色、batch/step 坐标以及（适用时）`toolCallId` 恰好匹配一个时才能恢复内容。零个、多个或超过 1,000 个候选降级为 status-only。`content`、`text`、`result`、`safeResult` 或结构化 body 等 legacy event 字段绝不是回退来源。浏览器不发起额外的隐藏 message 请求。

对话查询和 event 查询保持分离。对话成功不依赖 event-history 成功，最终答案只从 assistant message 重建。

普通对话请求不加载 Capability Result Message 作为过程详情。即使兼容调用方显式请求它们，非 AskUserQuestion 的公开 `content` 也为空且元数据在 allowlist 内；AskUserQuestion 已接受答案的兼容性仍是单独的有界投影。只读对话分享保留用户问题和最终 Assistant Message，但排除普通 Capability Result Message。这些 Web 投影不修改持久 Message。

每个 event-history 分页随其 event 返回安全 Capability 投影。浏览器可以按 run 请求缺失分页，但绝不执行逐结果摘要/详情拉取。在 500 个用户可见步骤的 request 边界内，自动 run-history 加载保持 4 个并发请求，一个稳定 viewport 快照最多保留 16 个自动目标且同一 run 去重。通过 preview 导航、滚动条拖拽/点击或快速滚轮重入已加载分页时复用缓存投影。

## Fork 过程快照（Fork process snapshots）

Fork 表现为一个独立子 session。在既有 fork composite 期间，runtime 识别属于被复制前缀展示 run 的持久 event，校验其源 scope 和 payload，将其重映射到子 session/request/run/event 身份，清除 `requestContextId`、`contentRef`、源坐标和 runtime 专用引用，并设置 `recordOrigin="FORK_SNAPSHOT"`。

快照行是 child 拥有的只读 history 事实。它们不是 `RequestRun`、checkpoint、pending input、lane、recovery 或活跃 run 状态。`appendEvent` 不能创建它们；只有 fork composite 可以。Runtime stream、resume、cancellation、retry、edit 和 recovery 忽略它们。`RuntimeSessionPort.listEvents` 是它们唯一的公开读取路径。

Gateway 在一个事务中写入子 session、被复制 message、active context、fork 元数据、每个 run 的快照状态和快照 event 行。新建和递归复制的可用快照使用 `AVAILABLE`。升级期复制但缺少可靠物化 history 的 run 使用 `LEGACY_UNAVAILABLE`；只有当被复制 message 的成员关系证明该 run 锚点属于子前缀时，公开 facade 才返回 `LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE`。它绝不猜测来源谱系。源删除或修改不能影响子快照。

携带引用的过程 event 在 fork composite 之前校验：被引用的源 message 必须位于被复制前缀内，并匹配 event 的 request/run/类型和 Tool 坐标。既有的源到子 message 映射将 payload 重写为子 `messageId`；源或祖先 message id 不保留。缺失、歧义、越界截断或损坏的引用使 fork 原子失败，并只产生一个安全的低基数诊断。递归 fork 以当前子为唯一源，源删除不能影响子 message 承载的过程 body。

未知的源绑定或 runtime 专用 payload 字段使 fork 原子失败。快照数量和序列化字节上限在 commit 前检查。Live-only delta 不在源持久集合中，不能被复制。

## 浏览器 history hydration（Browser history hydration）

### Message 优先加载和展示 run 选择

`sessionService.loadConversation` 继续只加载 message。`conversationStore` 在启动过程 hydration 之前提交可见 message 窗口并标记 ready，因此缓慢或失败的 event 请求不能阻塞用户或 assistant message。

对每个可见根轮次，`selectVisibleProcessRunTargets` 选择一个展示 run：

1. 优先选择带非空 `runId` 的最后一个可见 assistant message。
2. 如果不存在 assistant，则使用带非空 `runId` 的最后一个可见非摘要 message。
3. 对相同的 session/run 目标去重。

这保持 retry 尝试隔离，同时仍让没有 assistant 答案的失败或已取消轮次暴露其过程。前端关联使用来自 message 和 envelope 的 canonical root/request/run 坐标；绝不按邻接或时间 join。

### 真实 viewport 目标选择

`sessionService.loadRunEvents` 在 HTTP 信任边界校验 URI/query 构造、响应 availability、cursor 形态和每个 `StreamEnvelope`。`processHistory` 跟随 `nextAfterSequence` 直至其不存在，要求每个 cursor 严格前进，按 `eventId` 去重，保持 canonical 顺序并传播 `AbortSignal`。不前进的 cursor、不匹配的 run 坐标或非法 envelope 使该 run 失败。

加载一个 message 窗口并不选择该窗口内的每个 run。共享 `MessageList` 观察相对 `right-pane-scroll-viewport` 渲染的轮次并发布：

- 与真实对话 viewport 相交轮次的 `VIEWPORT` 目标；
- 与其上下至多一个 viewport 高度内轮次的 `PRELOAD` 目标；
- 未渲染或更远轮次不发布目标。

滚轮和键盘/程序化移动每个动画帧最多采样一次 viewport 坐标。自动 viewport/preload 变化进入一个 120 ms 的最新目标静默窗口；窗口内变化持续时不启动新的自动请求，静默边界只发布最新的至多 16 个目标。指针滚动条拖拽抑制中间发布，并在释放后贡献其最终 viewport。显式面板展开和重试绕过静默窗口，但仍使用同一个四请求调度器。Session/生成替换或清除取消定时器和尚未启动的自动工作。可见性 observer 只发布坐标；它不查询 event、不拥有滚动跟随状态、不写过程缓存。

展开的过程面板和当前 preview 导航目标发布 `EXPLICIT` 意图。Preview 悬停绝不发布过程需求。Preview message 导航先于 event history 完成且不等待 hydration；在目标轮次和展示 run 已知后，当前 preview 目标获得显式优先级。

### Session 调度器和请求生命周期

`conversationStore` 为每个 session 拥有一个 `ProcessHistoryScheduler`。调度器是目标排序、队列成员、活跃请求身份和 run 范围缓存状态的唯一 owner。自动 `VIEWPORT + PRELOAD` 目标和 `EXPLICIT` 意图各自限制为 16 个不同 run；显式工作按最新生成优先排序，viewport 和 preload 工作按与 viewport 中心的距离排序。至多 4 个不同 run 请求处于活跃，且一个 run 的分页保持串行。

浏览器本地的目标契约是：

```ts
interface ProcessHistoryTarget {
  readonly sessionId: string;
  readonly rootMessageId: string;
  readonly runId: string;
  readonly priority: "EXPLICIT" | "VIEWPORT" | "PRELOAD";
  readonly generation: number;
  readonly distanceFromViewportCenter: number;
  readonly retention?: "UNTIL_OUTCOME" | "WHILE_TARGETED";
}
```

面板/重试意图使用以结果为界的保留；当前 preview 需求使用 `WHILE_TARGETED`。`pinnedRunIds` 与自动和显式目标数组分开承载当前 live-run 需求。这些是前端本地坐标，绝不进入 Web DTO、`agent-contracts` 或持久化。

目标替换只移除排队或未启动的工作。一旦请求启动，自动替换、面板折叠、移出屏幕、preview 替换和导航生成取代都不会 abort 它。活跃请求保持自己的 pin 直到一个正常结果：

- `AVAILABLE` 存储已校验的完整分页序列；
- `FAILED` 只存储 `PROCESS_HISTORY_LOAD_FAILED` 并允许显式重试；
- `LEGACY_UNAVAILABLE` 是终态且不能重试。

每个已启动请求都有一个单调身份。只有当 session 仍存在、身份匹配该 run 已注册的活跃请求且响应校验成功时，完成才能提交。因此过期的交互生成只能填充自己的 run 缓存；它不能恢复旧目标、preview pin、导航 token、披露状态或 viewport 位置。不匹配的迟到完成不能释放或覆盖当前请求。

Session 清除/销毁是唯一 abort 活跃工作的目标生命周期操作。它移除该 session 的排队工作、活跃 controller、显式需求、pin 和缓存状态。销毁取消及其迟到完成不产生 `AVAILABLE`、`FAILED` 或 `LEGACY_UNAVAILABLE` UI 结果。

### Run 范围缓存和投影 join

调度器将状态和已校验 envelope 保留为一个 `sessionId + runId` 缓存事实：

```ts
type ProcessHistorySchedulerRunState =
  | { readonly status: "QUEUED" }
  | { readonly status: "LOADING"; readonly startedAt: number }
  | {
      readonly status: "AVAILABLE";
      readonly envelopes: readonly StreamEnvelope[];
      readonly lastAccessedAt: number;
      readonly lastAccessSequence: number;
    }
  | { readonly status: "LEGACY_UNAVAILABLE" }
  | { readonly status: "FAILED"; readonly errorCode: "PROCESS_HISTORY_LOAD_FAILED" };
```

`VIEWPORT`、`PRELOAD`、当前 preview、活跃请求和 live-run 需求 pin 缓存事实。面板展开只 pin 到其意图被取代、复用或达到加载结果为止；披露状态本身不是永久缓存 pin。被 pin 的事实可以临时超出容量。当最后一个 pin 释放时，整 run LRU 原子移除状态和 envelope，直到该 session 最多有 64 个未 pin 的 `AVAILABLE` run 和至多 2,000 个未 pin envelope。一个 run 绝不被截断；超大的未 pin run 作为整体被驱逐且可重新加载。

近效性只在已校验 `AVAILABLE` 数据提交、或未被请求的缓存 run 进入有效需求并被实际复用时变化。渲染/快照读取、重复的 observer 发布、同生成刷新、重试调度和仅 pin 变化不刷新近效性。

冷 run event 保持在 `historyEnvelopesBySession` 之外。`TurnBlock` 本地将 message 派生的基础 envelope 与所选展示 run 的缓存 event 组合，添加前端专用的 `history-load` transport 提示，并复用 `buildSessionProjection` / `buildTurnBlocks` / `buildProcessEntries`。已持久化的完成 thinking 只有在两者共享同一非空 `sessionId + runId + rootMessageId + stepId` 时才替换 live 或已 settle 的副本；不同 `stepId` 保持区分，缺失 `stepId` 只回退到精确 `eventId` 去重。Message 引用的完成解释 settle 同一 `stepId` 的 live 快照，message 引用的 capability 完成 settle 同一 `toolCallId` 的结果；非法引用保持 status-only 且不能从浏览器缓存或本地 Tool 状态回填。AskUserQuestion 结果 delta 和完成还按 `pendingInputId` 收敛。最终答案和用户内容仍由 message 拥有。

带非空 `stepId` 的非最终公开内容先渲染在一个前端专用、无图标的过渡 lane。已完成的 Tool 轮次解释在关联 Tool 开始之前接管同一稳定位置。如果先到达的是 `final=true`，答案 lane 立即接管并移除待定过渡而不清除或重放文本。该解释使用最终答案的 Markdown 排版，与展开的 thinking 内容对齐，没有独立标题/状态/披露/表面，并遵循外层过程面板的披露。答案 lane 在其既有左边缘接管，不改变排版、不透明度或换行，也没有水平移动、淡入淡出或重打动画；既有的高度和垂直滚动锚点补偿保持首行阅读焦点。这些是浏览器投影语义，不是新的 event 或持久化事实。

`QUEUED`、`LOADING`、`FAILED`、`LEGACY_UNAVAILABLE` 和 available-empty 是视图状态，不是合成的 `StreamEnvelope` 值。Event 失败绝不阻塞、清除或重写已提交的 message。

### Preview 和加载呈现

Preview rail 数据和 event hydration 相互独立。已加载的 marker/卡片悬停使用有界 preview 响应；占位符悬停无操作。快速 preview 选择使用单调导航 token，只有最新目标能移动 viewport。较旧的已启动请求在活跃身份守卫下仍只能填充自己的缓存。

后台 `LOADING` 不替换既有过程标题。没有 message 派生过程可用性的轮次在前 300 ms 不显示纯加载行；该边界之后可以显示稳定过程标题和一个非文本 spinner 而不改变行高。用户展开保持同一面板身份，在 body 内显示本地化加载消息并提升显式优先级。成功原地填充 body，失败只暴露安全重试状态，legacy unavailable 保持不可重试。缓存驱逐绝不重置手动披露；重访已展开轮次时重载进同一展开面板。

## 过程披露行为（Process disclosure behavior）

过程条目使用一个共享披露 hook：

- 新活跃的 thinking 或 capability 条目自动展开；
- 完成将该条目安排在 800 ms 后关闭；
- 并行条目保持独立计时器；
- 用户的手动展开或关闭在当前 run 内覆盖该条目的自动行为；
- 新的 root/run 重置手动覆盖；
- `prefers-reduced-motion: reduce` 立即应用完成状态且不使用过渡动画；
- 普通条目过渡时长为 200 ms；
- 既有 terminal 过程面板折叠保持 150 ms；
- 重新展开已完成的 live 或冷 history 面板暴露所有保留条目且不重启自动折叠。

累积 thinking 更新保持稳定视图 key 和单一挂载测量生命周期，包括前端 envelope 压缩之后。它们更新文本而不重新挂载卡片或重启披露计时器。已完成的累积 event settle 既有连续 thinking 条目，即使在进行中和已完成 thinking event 之间观察到答案 delta。后续的过程条目边界可以结束一个活跃连续 thinking 条目；仅答案 delta 既不结束它也不创建重复卡片。

Local、immersive 和 collaborative 宿主复用同一 session service、conversation store、投影和过程面板。宿主 adapter 可以选择或包含共享 UI，但不能调用 run-event URI、拥有过程缓存或实现披露计时器。

## 失败、安全和延期范围（Failure, security and deferred scope）

- 非法 scope、损坏行、非法投影和 fork 重映射失败都 fail closed，不暴露原始持久化/provider 数据。
- 公开 event history 只暴露 `StreamEnvelope`；tenant/subject/agent 持久化坐标、幂等元数据、源谱系和原始 payload 保持私有。
- Capability 结果可见性与 `SessionMessage.visible` 无关：只有已校验的 timeline/message 关联和共享后端 projector 才能产生过程详情。对话和分享 API 不暴露原始普通 Capability Result 内容。
- 过程 history 失败与已提交 message 和最终答案相互独立。
- 已完成 thinking 持久化为每次 model 调用最多增加一行持久记录；fork 放大与被复制持久 event 呈线性并在写入前设界。
- Thinking 脱敏、长度上限、截断、外置化、管理员策略、分享/导出包含和升级期回填未在此定义，需要单独的 OpenSpec change。

## 验证关注点（Verification focus）

- 持久化策略和先 append 后 terminal 的顺序；
- SQLite 重开、分页顺序、scope 失败和无部分分页；
- 共享 SSE/WebSocket/resume/REST 投影；
- fork 原子性、递归快照、源独立性和生命周期排除；
- 浏览器响应校验、串行分页、真实 viewport/preload 选择和重试尝试选择；
- 16 个自动目标、16 个显式意图、4 个活跃请求、仅排队替换和身份守卫完成；
- 仅 session 销毁 abort、安全重试/legacy 结果和迟到完成隔离；
- 整 run 的 64-run/2,000-envelope LRU、pin 释放和近效性规则；
- preview 导航独立性、300 ms 加载稳定性和披露/缓存分离；
- 已完成 live 与冷 history 投影相等性；
- 累积更新和压缩下的一张 thinking 卡片；
- 800 ms 条目 settle、150 ms 面板 terminal 折叠、手动覆盖和 reduced motion；
- local、immersive 和 collaborative 宿主旅程一致。
- 跨 live/history 和全部三种宿主相同的 Capability 结果级别、descriptor、有界详情、截断和失败事实；
- 在一个 500 步混合 Tool history 中零逐结果网络请求，伴随四请求并发、16 个自动目标和同 run 去重。
