## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-1.1 查看会话消息流` | 过程正文由消息提供，实时事件只保留时序、状态和消息引用，服务端统一安全投影 | `ts-web-sse-ws-transports` | `FN-1.1 查看会话消息流` |
| `FN-1.2 断线后从上次位置继续` | 历史过程按消息与事件联合恢复，关联失败显式降级，大会话快速导航保持有界 | `ts-stream-history-consistency` | `FN-1.2 断线后从上次位置继续` |
| `FN-1.11 从消息派生子会话` | 派生过程快照中的消息引用重映射为子会话消息标识 | `session-fork-from-message` | `FN-1.11 从消息派生子会话` |

## `FN-1.1 查看会话消息流`

### 目标与规范依据

本 Function 保持 SSE 与 WebSocket 的既有传输和顺序语义，只把已经持久化的过程正文收敛为消息唯一事实。实时流通过同一服务端关联路径取得消息内容；无效引用不泄露正文。

#### 本 Function 的目标 Requirements

canonical spec：`ts-web-sse-ws-transports`

- `ADDED`：`可恢复过程事件引用唯一消息正文`
- `ADDED`：`Tool 轮次执行说明与 Tool 调用连续呈现`
- `ADDED`：`Web stream 在服务端解析过程消息引用`
- `ADDED`：`过程消息引用保持作用域隔离`

### 当前实现

- `AgentRunStatePort.appendMessage(...)` 已返回持久化后的 `MessageId`；`RuntimeOwnedRunMessagePort` 使用可信运行坐标写入 `SessionMessageStoreGateway`。
- `appendAssistantToolUseMessage(...)` 当前忽略返回的 `MessageId`。非空模型公开文字与 `toolCalls` 已保存在同一个隐藏 `ASSISTANT_TOOL_USE` 消息中。
- `appendCapabilityResultMessage(...)` 当前也忽略返回的 `MessageId`。Tool 结果已保存为 `CAPABILITY_RESULT` 消息。
- `DefaultAgent` 在模型流式输出期间发布累计 `LLM_CONTENT_DELTA`；当前 persistence policy 将全部 `LLM_CONTENT_DELTA` 归类为 `LIVE_ONLY`。最终答案同样通过 `final=true` 的 live-only delta 输出，随后由既有 terminal commit 保存最终 Assistant Message。
- Tool loop 先写 assistant tool-use 消息，再发布 `CAPABILITY_STARTED`；Tool 完成后先写 capability result 消息，再发布 `CAPABILITY_RESULT_DELTA` 和 `CAPABILITY_COMPLETED`。当前事件没有消息强引用，结果 delta 仍重复携带安全结果内容。
- `projectTimelineEventToStreamEnvelope(...)` 直接从 `RunTimelineEvent.inlinePayload` 读取模型文字和 Tool 结果。SSE、WebSocket 与运行事件历史 route 复用该 projector，但 projector 没有消息解析输入。
- `RuntimeSessionPort` 已提供 `streamEvents(...)`、`listEvents(...)` 和普通可见会话 `listMessages(...)`；`UserSessionPort.listCurrentRequestMessages(...)` 已支持 `includeHidden`，runtime recovery 等可信内部路径已经使用它。当前没有面向 channel server projection 的受控批量消息关联入口。
- 当前分支已把完成的 Tool 轮次说明按 `stepId` 收敛为单一 `process-content` 过程项，但该项仍以普通 `system` step 进入 ProcessPanel，因而获得独立标题和圆形状态图标；Mock 的 `process-handoff` 场景还把说明放在前一个 Tool 完成之后，未表达“说明后立即调用同轮 Tool”的真实顺序。
- 具有 `stepId` 的进行中累计公开文字仍由 answer projector 直接显示；只有完成说明到达后才被同 lane 替换并进入执行详情，因此 Tool 轮次会出现“先答案、后过程”的位置迁移。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 可恢复过程事件只引用唯一消息正文 | assistant tool-use 与 capability result 消息已存在，但相关事件未保存其 `MessageId`，部分事件仍保存结果副本 | producer 未保留消息写入结果，persistence policy 未区分 live delta 与完成引用事件 |
| SSE/WS 在服务端按同一路径解析引用 | 共享 projector 只接受 event，无法读取受信消息 | 缺少 runtime-owned 批量关联入口和 projector 的受控消息输入 |
| 无效引用只显示安全状态 | 当前 projector 对 payload 内文字直接投影 | 缺少事件—消息坐标校验、内容不可用投影和安全诊断 |
| 不改变最终答案与 thinking | `LLM_CONTENT_DELTA` 同时服务阶段公开文字和最终答案；thinking 独立持久化为 event | persistence rule 必须只允许已完成 Tool 轮次使用消息引用，不得误改 final answer 或 thinking |
| 执行说明连接前置思考与后续 Tool | 完成说明已经具有独立 process lane，但被按普通系统步骤渲染；Mock 顺序与同轮 Tool-use 语义不一致 | 浏览器缺少“桥接正文”视图语义，Mock 缺少 `thinking → completed explanation → CAPABILITY_STARTED` 的同轮顺序 |
| 进行中公开输出不先进入答案位置 | 具有 `stepId` 的 live 累计文字在角色确认前进入 answer projector | 浏览器缺少待定桥接 lane，完成说明无法在同一稳定位置接管 live 内容 |

### 修改方案

`agent-runtime` 是主要 owner。唯一实现路径是“消息先写入 → 可恢复事件引用消息 → channel server 解析引用 → 共享 projector 生成 envelope”。

1. 在 `agent-contracts/runtime` 增加兼容扩展：
   - 为 `RuntimeSessionPort` 增加 server-only `resolveProcessMessages(query)`。
   - query 使用 `identityContext`、`sessionId`、`requestId`、`runId`、去重后的 `messageIds`（引用模式为 1–1000）、可选 `includeLegacyCandidates` 和可选 `signal`；仅当 history route 需要恢复无引用旧事件时，允许空 `messageIds` 并启用 legacy candidate 模式。
   - 返回 `SessionMessage` 领域对象集合，不返回 gateway Record；缺失或不匹配的标识不返回对应项。
   - 该入口不注册 Web route，浏览器不能直接提交 `messageIds`。
   - `RunTimelineEvent` 和 `StreamEnvelope` 顶层 shape 不变；消息引用继续位于受 event type 约束的 `inlinePayload.messageId`。

2. `agent-core` 保留现有消息类型和 idempotency key，只让消息写入 helper 返回现有 `appendMessage(...)` 的 `MessageId`：
   - 非空公开文字与 Tool 调用形成的 `ASSISTANT_TOOL_USE` 消息写入成功后，追加一个 `persistence=PERSISTED` 的完成 `LLM_CONTENT_DELTA`，payload 仅保留 `messageId`、`stepId`、`completed=true`。
   - 每个 `CAPABILITY_STARTED` 引用承载该 `toolCallId` 的 `ASSISTANT_TOOL_USE` 消息。
   - Tool 产生持久化 `CAPABILITY_RESULT` 后，`CAPABILITY_COMPLETED` 引用该结果消息；`CAPABILITY_RESULT_DELTA` 与 `TOOL_STRUCTURED_DELTA` 全部保持 `LIVE_ONLY`，只承载执行期间的既有安全投影。
   - `CAPABILITY_COMPLETED` 除 `messageId` 外继续只承载状态、耗时和安全错误字段，不保存 Tool 结果正文；Tool 在结果消息形成前失败时仍可发布不带 `messageId` 的状态事件。
   - ordinary、失败/降级/超时、AskUserQuestion resume、workflow result 和 structured Tool result 等所有产生同类消息的路径统一调用同一个“写消息并形成引用事件”helper，避免只修普通成功路径。

3. `agent-runtime` 的 persistence policy 按 event type 和 payload shape 固定分类：

| 事件形态 | persistence | 持久化 payload 内容 |
|---|---|---|
| 进行中 `LLM_CONTENT_DELTA` | `LIVE_ONLY` | 既有累计安全文字 |
| Tool 轮次完成 `LLM_CONTENT_DELTA` | `PERSISTED` | `messageId`、`stepId`、`completed=true` |
| `final=true` 的最终答案 delta | `LIVE_ONLY` | 既有最终答案临时投影；最终事实仍由 Assistant Message 提供 |
| 全部 `CAPABILITY_RESULT_DELTA` / `TOOL_STRUCTURED_DELTA` | `LIVE_ONLY` | 既有累计安全结果或结构化片段 |
| `CAPABILITY_STARTED` | `PERSISTED` | `messageId`、`capabilityId`、`toolCallId` 和状态/批次字段，不含 Tool 参数 |
| 结果消息已形成的 `CAPABILITY_COMPLETED` | `PERSISTED` | `messageId`、`capabilityId`、`toolCallId` 和既有状态、耗时、安全失败字段，不含 Tool 结果正文 |
| 结果消息未形成的 `CAPABILITY_COMPLETED` | `PERSISTED` | 既有状态、耗时和安全失败字段，不含 `messageId` 或 Tool 结果正文 |
| `LLM_THINKING_DELTA` | 既有规则 | 本 Change 不修改 |

非法组合在 append/publish 前失败：持久化完成事件缺少 `messageId`、同时携带可恢复正文、`completed` 不为 `true`，或 live-only 事件声称完成消息引用时，均返回既有风格的安全 validation failure。

4. `RequestLifecycleCoordinator.resolveProcessMessages(...)` 复用 `UserSessionPort.listCurrentRequestMessages(...)`：
   - 先通过 `requireSession(...)` 确认可信 Owner/Agent/session。
   - 按 query 的 request/run 坐标读取 `includeHidden=true` 的当前运行消息，分页大小使用既有最大安全值 1000。
   - 仅保留请求的 `messageIds`，并验证 message 的 session/request/run 坐标。
   - history page 含无 `messageId` 的旧过程事件时，可在同一 server-only 调用中返回当前运行的一页完整候选集；候选超过 1000 条时安全失败并让旧事件降级为 status-only，禁止用不完整集合猜测唯一关联。
   - 不增加 Gateway port、Record、表或 generic store；不从客户端输入建立读取权限。

5. `agent-channel-common` 扩展既有共享 projector，而不建立第二套事件映射：
   - 增加 server-only `ProcessMessageAssociation` 输入，包含已经由 runtime 返回并再次通过 event 坐标校验的 `SessionMessage`。
   - 公开说明只解析 `ASSISTANT_TOOL_USE.content` 中的 `content`；Tool 调用按同一消息中的 `toolCalls` 与 event `toolCallId` 精确选择；Tool 结果复用既有 capability safe projection 与 AskUserQuestion 专用安全投影。
   - 关联失败返回同一 event type 的 status-only envelope，并附加 bounded `contentUnavailable=true`；不复制 raw message、`visible`、metadata 全量或关联错误细节。
   - SSE、WebSocket 和 history route 都调用该 projector。

6. `agent-channel-web` 的实时订阅按 subscription 保存有界 `messageId → SessionMessage` cache。首次遇到未知引用时通过 runtime 批量入口解析当前待投影引用；同一消息的后续事件复用 cache。cache 在 subscription 关闭时释放，不进入浏览器或持久化。

7. `frontend/agent-web` 保留既有 live process composition 入口，但把引用事件作为过程 lane 的 canonical 完成项：
   - 具有非空 `stepId` 且不具有 `final=true` 的进行中 `LLM_CONTENT_DELTA` 先进入无独立图标的待定桥接 lane，不进入 answer projector；该 lane 使用与同 `stepId` 完成说明相同的稳定 key。
   - completed Tool-round `LLM_CONTENT_DELTA` 按同一非空 `stepId` 结算并替换该轮 live-only 说明快照，不创建第二条说明。
   - `final=true` 的最终答案到达时，answer projector 接管既有最终答案位置，过程投影移除尚未完成的待定桥接 lane；已经呈现的累计正文不清空、不从头重新播放。
   - 引用结果消息的 `CAPABILITY_COMPLETED` 按同一 `toolCallId` 结算并替换该 Tool 的 live-only 普通或 structured result 快照，不创建第二条 Tool 结果。
   - 关联失败的完成事件只保留终态和 `contentUnavailable=true`；不得使用前端 cache 或 Tool 本地状态补正文。
   - 完成的执行说明在前端 view model 中使用专用桥接语义，并按 canonical event sequence 位于前置 thinking 与同轮 `CAPABILITY_STARTED` 之间；该语义只属于浏览器投影，不新增 event type、transport 字段或持久化事实。
   - ProcessPanel 对桥接说明只渲染消息中的公开正文和轻量连接关系，不渲染独立标题、圆形状态图标、完成对勾、展开按钮或固定“接下来”等界面文案；说明随执行详情大面板统一折叠，面板展开后始终直接可见。
   - 待定桥接正文和完成说明复用最终答案的公开正文排版：使用同一 Markdown renderer、字号、行高、字重、主文字色和换行规则。说明正文从既有时间线图标后的内容列开始，与展开后的 thinking 正文左边界对齐；说明本身不增加底色、左边框、圆角或水平内边距，过程归属只由既有时间线位置和连接轨道表达。
   - 最终答案接管待定正文时继续落在既有 answer lane 和既有左对齐位置。浏览器不得通过字体、行高、透明度、内容清空或重新打字表达接管；只在非 reduced-motion 环境使用 180 ms `transform` 横向对齐既有答案位置，并复用 Change 1 的 panel height/scroll anchor compensation 保持正文首行的纵向阅读焦点。reduced-motion 环境直接完成对齐。
   - Mock `process-handoff` 场景使用 `thinking → completed process content → CAPABILITY_STARTED → CAPABILITY_COMPLETED` 的业务顺序，并让完成说明与后续 Tool start 使用同一 Tool 轮次标识；不得把说明放在前一 Tool 结果之后或与后续 thinking 隔开。
   - 既有 thinking、Tool、PIU 和普通过程步骤的 disclosure、图标和手工展开规则保持不变。
   - 这一步只收敛 live 快照、待定桥接位置与完成引用，不改变 thinking 的 stable identity、final Assistant Message 语义或 Change 1 disclosure state。

8. 保留边界：
   - 不修改 `TimelineEventType`、`SessionMessageRole`、`StreamEventType`、`StreamEnvelope` 顶层字段。
   - 不修改 Gateway public contract、远端 Gateway protocol、terminal commit、ActiveContext、provider input 或 final Assistant Message。
   - 不改变 Change 1 已交付给既有 thinking、Tool、PIU 和普通过程步骤的视觉、折叠与活动状态逻辑。
   - thinking message 化和集成方展示级别继续 deferred。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `过程消息引用保持作用域隔离` | runtime 先校验 Owner/Agent/session/request/run；channel projector 再校验消息类型和 `toolCallId`，失败只返回 bounded 状态 | 跨 owner、跨 Agent、跨 session、错 request/run、错 Tool 的 negative tests；浏览器响应不含隐藏消息 |
| 可靠性/恢复 | `可恢复过程事件引用唯一消息正文`、`Web stream 在服务端解析过程消息引用`（功能性 Requirements，无新增黑盒质量目标） | 消息写入成功后才发布引用事件；非法 persistence shape 在发布前失败 | 写消息失败不留孤儿事件；live delta、完成引用和 final answer 分类不漂移 |
| 审计/可追溯性 | `过程消息引用保持作用域隔离` | event 的 `messageId` 与现有 request/run/tool 坐标形成可追踪关联，不在日志记录正文 | 关联诊断只有安全错误码与低基数原因 |

#### 备选方案（Alternatives Considered）

- Event 与 Message 各自保存完整正文：读取简单，但继续存在双写一致性、存储放大和安全策略漂移，违反本 Change 的唯一正文原则，不采用。
- 历史由浏览器请求隐藏消息并自行关联：会把安全与关联职责下放给不可信客户端，并形成额外请求和多宿主重复实现，不采用。
- runtime 把消息正文重新写入返回的 `RunTimelineEvent.inlinePayload`：无需扩展 resolver contract，但会让 canonical event 与临时投影视图共用同一 shape，增加正文被再次持久化的风险，不采用。

## `FN-1.2 断线后从上次位置继续`

### 目标与规范依据

本 Function 在既有 conversation history、run event history 和前端 process-history scheduler 上增加消息关联，不改变消息分页、事件分页和滚动 owner。历史恢复必须与实时投影一致；失败显式降级；容量用例不能形成浏览器 N+1 请求。

#### 本 Function 的目标 Requirements

canonical spec：`ts-stream-history-consistency`

- `ADDED`：`过程历史从消息正文与事件时序联合恢复`
- `ADDED`：`过程历史关联失败显式降级`
- `ADDED`：`大会话过程历史关联保持有界`

### 当前实现

- `GET /api/v1/sessions/:sessionId/runs/:runId/events` 调用 `RuntimeSessionPort.listEvents(...)`，每页默认 100、最大 1000；route 直接把 events 交给共享 projector。
- runtime 已校验 Owner/Agent/session/run、真实运行或 fork snapshot availability、事件 origin、顺序和分页 cursor；返回 event 前移除 owner fields、`agentId`、gateway metadata 和 `contentRef`。
- `RunTimelineEventStoreGateway.listEvents(...)` 已支持 owner、agent、session、request、run、afterSequence 和 limit 的有界读取。
- SQLite `timeline_events` 的 session sequence 主键覆盖 `(tenant_id, subject_id, agent_id, session_id, sequence)`，当前没有 `(tenant_id, subject_id, agent_id, session_id, run_id, sequence)` 的 run-scoped 辅助索引。
- 前端 process-history scheduler 已限制最多 4 个并发加载、automatic/explicit target 各 16 个、cache 64 runs/2000 envelopes，并使用 generation 防止旧 session 结果覆盖新 session。
- viewport target 在可见项变化时立即更新；连续多帧滚动可在旧目标退出前触发多个请求。现有并发上限能限制同时在途数量，但缺少“连续导航结束后只提交最新 automatic targets”的 settle gate。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 历史由消息正文与事件时序联合恢复 | route 只读取 event，无法取得隐藏 assistant tool-use 消息 | 需要对每个事件页一次批量解析引用，并将关联结果传给共享 projector |
| 关联失败显式降级 | projector 当前读取 event payload 正文；无消息引用校验 | 需要忽略遗留 event 正文、执行唯一 legacy correlation，并生成 status-only 结果 |
| 每个运行零个附加 Web 请求 | 浏览器已对每个运行调用一个 event-history API | 消息关联必须在同一服务端请求内完成，不能增加 message API 请求 |
| 10,000 用户轮次快速导航有界 | scheduler 有并发和 cache 上限，但连续 viewport 变化可持续创建旧目标工作 | automatic targets 需要 120 ms settle/latest-target gate；explicit 用户展开保持即时 |
| run-scoped event query 不随 session 总事件量退化 | SQLite 缺少包含 `run_id` 的读取索引 | 本地 adapter 需要增加不改变 contract/table 的辅助索引 |

### 修改方案

1. history route 在取得一页 runtime events 后收集唯一 `messageId`，在同一个 HTTP request 内调用 `resolveProcessMessages(...)` 一次；随后把 event 与关联消息交给共享 projector。浏览器 API shape 仍是既有 event-history page，不增加 message endpoint 或第二次请求。
2. legacy event 没有 `messageId` 时，route 对同一运行已批量取得的消息执行固定匹配：
   - completed Tool-round `LLM_CONTENT_DELTA` 只匹配含非空 `content` 且 tool-call batch 坐标一致的 `ASSISTANT_TOOL_USE`；
   - Tool started 只匹配 metadata `toolCallIds` 包含 event `toolCallId` 的 `ASSISTANT_TOOL_USE`；
   - `CAPABILITY_COMPLETED` 只匹配 metadata `toolCallId` 相同的 `CAPABILITY_RESULT`；
   - 恰好一个候选才关联，零个或多个候选均 status-only；
   - 整页均为旧事件时仍通过一次 server-only bounded candidate query 获取候选；候选超过 1000 条时整组旧事件 status-only，不从截断集合猜测；
   - event 中遗留 `content`、`text`、`result`、`safeResult` 或 structured content 不参与恢复。
3. `frontend/agent-web` 的 process-history composition 把引用事件作为过程 lane 的 canonical 时序项：
   - completed Tool-round `LLM_CONTENT_DELTA` 按 `stepId` 替换 conversation/live/settled 中同一说明的副本；
   - `CAPABILITY_COMPLETED` 按 `messageId + toolCallId` 吸收 conversation adapter 从同一 `CAPABILITY_RESULT` message 生成的 `CAPABILITY_RESULT_DELTA` 或 `TOOL_STRUCTURED_DELTA`，并从 unmatched base 集合移除该消息副本；
   - 缺失或无效引用只保留 history route 的 status-only envelope，不使用 conversation base、前端 cache 或 Tool 本地状态补正文。
4. event page 中任一关联失败不使其他合法事件丢失。仅当 event page 自身损坏、runtime读取失败或共享 projector 无法生成安全 envelope 时，保留既有整页 SafeError；单个 message-ref 失败生成可排序的 status-only envelope。
5. `frontend/agent-web` 在 automatic viewport targets 发布前增加 120 ms quiet-window settle：
   - 连续导航输入间隔不超过 120 ms 时只更新 latest target snapshot，不启动新的 automatic request；
   - 安静 120 ms 后一次发布最新最多 16 个 automatic targets；
   - explicit 展开/重试不等待 settle；
   - session 切换、generation 变化或 scheduler clear 取消 timer 和未开始 automatic work；
   - 不修改 `useChatViewportController`、scroll anchor、smooth-scroll 或 Change 1 的 disclosure state。
6. 在 `timeline_events` 增加 `(tenant_id, subject_id, agent_id, session_id, run_id, sequence)` 辅助索引。该索引只优化既有 `listEvents` filter；不增加表、Record、query 字段或 Gateway public contract。迁移必须对已有数据库幂等创建。
7. 10,000 用户轮次 fixture 使用真实 conversation page、process history scheduler 与 route contract；每轮至少包含两个 completed thinking、两个 Tool start/complete 组合和两个 Tool result。测试记录 browser process-history request 数、最大并发、latest-target ownership、消息关联附加 Web 请求数以及已加载 Turn 的稳定性，不以单次机器绝对耗时作为唯一断言。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | `过程历史关联失败显式降级` | unique legacy correlation；单引用失败降级，页级损坏显式失败 | 缺失、重复候选、损坏 JSON、scope mismatch 不读取遗留 event 正文 |
| 性能/容量 | `大会话过程历史关联保持有界` | 同一 event-history HTTP 内批量关联；120 ms latest-target settle；最大 4 并发；run-scoped SQLite index | 10,000 USER 轮次 fixture、四种快速导航输入、请求数与并发上限、旧结果不覆盖 |
| 安全 | `过程历史从消息正文与事件时序联合恢复`（功能性 Requirement，无新增黑盒质量目标） | 历史使用与 live 相同 runtime resolver 和 shared projector；浏览器不接收隐藏消息 | history response 不含 raw hidden message、event 遗留正文或跨 scope 内容 |

## `FN-1.11 从消息派生子会话`

### 目标与规范依据

本 Function 保留既有 child-owned process snapshot 和 composite fork 事务，只把新出现的 event `messageId` 纳入已有 source→child 标识映射。

#### 本 Function 的目标 Requirements

canonical spec：`session-fork-from-message`

- `ADDED`：`派生过程快照重映射消息引用`
- `ADDED`：`派生消息引用失败保持原子`
- `ADDED`：`派生消息引用失败诊断保持安全`

### 当前实现

- runtime fork 已在复制 message prefix 时建立 source→child message/request/run 映射。
- `remapForkEventPayload(...)` 已把 `messageId`、`rootMessageId`、`parentMessageId`、`terminalMessageId` 视为需要重映射的消息引用；无法映射时抛出安全验证错误。
- fork composite 已在一个 gateway-local transaction 内写 child session、messages、active context、fork metadata、process snapshot rows 和 per-run availability；失败整体回滚。
- snapshot 只来自 durable event；普通 child live/resume stream 排除 `FORK_SNAPSHOT`，run event-history route 才可读取。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 新引用映射到子消息 | generic remapper 已识别 `messageId`，但 producer 当前没有 ref-bearing process event | 需要增加针对新 typed payload、message prefix membership 和 event/message业务坐标的一致性验证 |
| 映射失败保持原子 | generic remap failure 已阻止 composite write | 需要 characterization 证明新 ref event 走同一 preflight/rollback，而非被 scrub |
| 递归派生与源删除独立 | fork snapshot 已 child-owned 且可递归复制 | 需要证明新 `messageId` 每代重映射且 event-history 不回读 ancestor |

### 修改方案

1. 保留 `remapForkEventPayload(...)` 的单一递归映射入口，不新增第二套 process-message remapper。
2. 在生成 snapshot draft 前，对 ref-bearing process event 执行 event-type-aware validation：引用必须存在于本次 copied prefix 的 message map，消息的 source request/run 与 event 一致，Tool event 的 `toolCallId` 必须匹配消息 metadata/content。
3. 成功映射后，payload 只保留 child `messageId` 与事件自身安全状态字段；source message id 不进入 snapshot、fork source metadata、diagnostic 或 availability status。
4. 任何缺失、歧义、跨 cutoff、跨 scope 或损坏引用继续抛出既有 fork-safe validation error，在 gateway composite 前终止；若失败发生在 promotion staging 后，复用既有 abort cleanup。
5. fork-of-fork 把当前 child 当作唯一 source，使用当前 child message map 再生成 grandchild `messageId`；不引入 ancestor lineage。
6. Gateway fork request、snapshot record shape 和 transaction 不变，因为 `messageId` 位于既有 `inlinePayload: JsonObject`。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | `派生消息引用失败保持原子` | typed preflight 在 composite 前验证，失败复用既有事务回滚和 promotion abort | 跨 cutoff、缺失 map、损坏 ref 均不产生部分 child |
| 安全 | `派生消息引用失败诊断保持安全`；`派生过程快照重映射消息引用` 的 child-owned 功能边界 | 每代只保存 child id，历史解析不读取 source/ancestor；safe error code 记录映射阶段，不记录正文、Tool 输入输出、reasoning、映射表或未授权归属信息 | source 删除、递归 fork、跨 owner/agent negative tests；日志、metric、audit 和 SafeError 非泄漏断言 |

## 跨 Function 协作与端到端流程

三个 Function 共享一条内容事实链：

1. `FN-1.1` 的 producer 先写 `SessionMessage`，再写或发布带 `messageId` 的过程事件。
2. live stream 和 `FN-1.2` 的 history route 都通过 runtime server-only 入口批量解析事件引用，并把相同的 event/message pair 交给共享 projector。
3. `FN-1.11` 在 fork materialization 阶段把 durable ref event 与目标消息一起映射为 child-owned facts；child history 再复用第 2 步。
4. 任何阶段的 scope 或引用校验失败都不得切换到 event 正文副本；live/history 降级为 status-only，fork 因原子性要求整体失败。

这条流程不改变 browser ownership、request lifecycle、terminal commit、context assembly 或 Gateway persistence owner。

## 依赖、准入与并行边界

- `add-agent-web-process-activity-affordances` 已在 `origin/main@c04d49e9e196e63e76374fe245a92679930f5e8b` 合入。本 Change 以该提交为基线，但不依赖其未归档文档状态，也不修改其视觉和折叠语义。
- `fix-thinking-history-handoff-duplication` 的实现已在当前基线，且 tasks 已完成；它与本 Change 共同修改 `ts-stream-history-consistency`，归档时必须先归并或重放其 thinking handoff Requirements，再归档本 Change。本 Change 不重定义 thinking identity、active-run eligibility 或去重规则。
- `harden-agent-web-request-acceptance-control` 与本 Change 没有语义依赖，可以并行实现；但两者共同修改 `ts-stream-history-consistency`，并可能共同触达 agent-web session/process-history 测试。双方必须分配独立代码 owner，并在较晚合并方重放 stable spec delta 和前端测试变更。
- `harden-channel-input-security-boundaries` 与本 Change 仅共享 `ts-web-sse-ws-transports` 规格文件，生产代码边界不同，可以并行；归档时后归档方负责保留先归档方全部 Requirements。
- `persist-ts-refresh-stable-completed-turns` 与本 Change 都定义 completed process content 的持久化载体、channel projection 和刷新后恢复路径，属于同一语义写区，禁止并行实施。本 Change 的确定边界是：最终 Assistant Message 与 completed-turn conversation projection仍可由该 change 拥有；执行说明、Tool 调用和 Tool 结果的过程历史必须由本 Change 定义的 Message 正文 + Event 时序/状态/强引用路径恢复。准入时该 change 保持 `0/22` 且暂停实施，因此本 Change 可以独占该语义写区继续开发；`persist-ts-refresh-stable-completed-turns` 在恢复实施前必须删除或重写与该过程历史路径重叠的 Requirements、design 和 tasks，不能再建立第二套 completed process-detail carrier 或 projector。
- 本 Change 不要求 Gateway 团队实现新 contract。Gateway 审核只需确认现有 message/event 有界查询与本地 run-scoped index 不改变远端协议；没有 Gateway 交付依赖。

因此本 Change 的 OpenSpec 可以立即交付，生产实现可以与 request-acceptance 和 channel-security 工作并行；与 `persist-ts-refresh-stable-completed-turns` 的重叠部分必须串行，以本节唯一边界为准。

## 跨 Function 质量属性设计（Cross-Function Quality Attributes）

| 质量属性 | 影响 Functions 与规范依据 | 共享或端到端机制 | 端到端验证 |
|---|---|---|---|
| 安全 | `FN-1.1 / 过程消息引用保持作用域隔离`、`FN-1.2 / 过程历史从消息正文与事件时序联合恢复`、`FN-1.11 / 派生消息引用失败诊断保持安全` | runtime 可信 scope 校验、channel safe projector、fork child-owned remap 形成三层边界；任一失败不读替代正文 | live/history/fork 跨 owner、Agent、session、request、run、Tool 引用组合测试 |
| 可靠性/恢复 | `FN-1.1 / 可恢复过程事件引用唯一消息正文`、`FN-1.2 / 过程历史关联失败显式降级`、`FN-1.11 / 派生消息引用失败保持原子` | Message-first 写入、防孤儿引用、history status-only 降级与 fork transaction rollback | 普通、失败、重开数据库、源删除、递归 fork 的端到端事实一致性 |

## 验证策略（Verification Strategy）

- unit：覆盖 event payload 分类、message parser、safe projector、legacy unique matching、automatic target settle 和 fork typed remap。
- contract：覆盖 `RuntimeSessionPort.resolveProcessMessages` 的 input bounds、scope、取消和返回类型；覆盖 ref-bearing event 的合法/非法 shape；证明 Gateway public contract 未变化。
- integration：覆盖普通/失败/降级/超时/AskUserQuestion/workflow/structured Tool 路径的 Message-first 顺序，runtime history 同请求批量关联，本地数据库 reopen 和 run-scoped读取。
- e2e：对比 live、cold history、refresh、source 删除后的 fork 和递归 fork；验证同一说明/Tool 结果最多一次、无效引用 status-only、最终答案不受影响。
- capacity：使用 10,000 个可见 USER 轮次的大数据 fixture 覆盖预览点击、滚动条滑块拖动、轨道点击、滚轮/触控板连续输入；断言零附加 Web 请求、最大四个并发、旧目标不覆盖新目标和已加载 Turn 可响应。
- architecture/negative：禁止 browser raw hidden-message API、禁止 channel/gateway private import、禁止新增 Gateway port/table、禁止 persisted ref event 携带正文副本、禁止 fork snapshot 保留 source message id。
- characterization：证明 thinking、final Assistant Message、terminal commit、ActiveContext、Provider input、PUI/structured live delta 既有非目标边界和 Change 1 disclosure 行为不回归；桥接说明前后相邻步骤仍使用原图标和 disclosure。
- visual continuity：验证待定桥接、完成说明和最终答案使用一致的公开正文排版；说明与展开 thinking 正文左对齐且无独立底色/边框；最终答案保持既有左对齐，接管过程不改变 opacity/font/line-height/正文，不重新打字，并在 reduced-motion 下禁用位置动画。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/ts-web-sse-ws-transports/spec.md`：合并过程消息引用、服务端关联和作用域隔离 Requirements。
- `openspec/specs/ts-stream-history-consistency/spec.md`：合并历史联合恢复、失败降级和大会话有界读取 Requirements。
- `openspec/specs/session-fork-from-message/spec.md`：合并 snapshot 消息引用重映射与原子失败 Requirements。
- `openspec/designs/functions/D1-会话与流式交互/D1.1-流式交互与恢复/FN-1.1-查看会话消息流.md`：刷新消息引用与安全降级。
- `openspec/designs/functions/D1-会话与流式交互/D1.1-流式交互与恢复/FN-1.2-断线后从上次位置继续.md`：刷新过程历史恢复和容量指标。
- `openspec/designs/functions/D1-会话与流式交互/D1.2-会话生命周期管理/FN-1.11-从消息派生子会话.md`：刷新 child-owned process snapshot 事实。
- `openspec/designs/features/D1-会话与流式交互/D1.1-流式交互与恢复/F-1.1-实时查看处理过程.md`：刷新消息唯一正文保证。
- `openspec/designs/features/D1-会话与流式交互/D1.1-流式交互与恢复/F-1.2-断线重连恢复.md`：刷新历史过程一致性和安全降级。
- `openspec/designs/features/D1-会话与流式交互/D1.2-会话生命周期管理/F-1.6-基于历史回复新建会话.md`：修正当前“完全不复制时间线”的过时边界，摘要 child-owned process snapshot。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/core-contracts.md`：刷新 runtime server-only 过程消息关联入口和 event/message ownership。
- `openspec/designs/architecture/ts-backend-architecture.md`：刷新 Message 内容事实、timeline 时序事实与 channel projection 协作边界。
- `openspec/designs/modules/agent-core.md`：刷新 Message-first producer 规则。
- `openspec/designs/modules/agent-runtime.md`：刷新 persistence classification、消息关联和 fork validation。
- `openspec/designs/modules/agent-channel-web.md`：刷新共享 projector、subscription cache 和 browser non-ownership。
- `openspec/designs/modules/agent-platform-gateway-local.md`：刷新 run-scoped timeline index；公共 Gateway 边界不变。
- `openspec/designs/modules/agent-web.md`：刷新 automatic process-history target settle；视觉与 disclosure 不变。
- `openspec/designs/adr/`：新增一条“Message 是过程正文唯一持久化事实，Event 只保存时序、状态与强引用”的 ADR。
- `openspec/designs/spec-to-design-map.md`：增加上述 specs 到 architecture、modules、ADR 和验证入口的导航。

## 风险与取舍（Risks / Trade-offs）

- runtime/channel 增加一次 server-only 批量关联会提高单次 history route 的服务端工作量。通过每页一次批量读取、run-scoped SQLite index 和 1–1000 输入上限控制。
- 老数据缺少 `messageId` 时只能依赖严格唯一匹配；无法唯一确定的公开内容会降级不可用。这牺牲部分旧数据可见性，以避免读取错误正文或延续双事实。
- 新旧版本混合部署时，旧 producer 可能继续写正文事件，新 projector 会忽略遗留正文。部署顺序必须先上线能够识别引用和 legacy matching 的读取端，再上线只写引用的新 producer。
- automatic target 120 ms settle 会使快速滚动后过程详情最多延迟 120 ms 开始加载；explicit 展开不等待，换取消除滚动过程中无效请求。

## 迁移与回滚（Migration / Rollback）

1. 先部署 runtime resolver、共享 projector、history legacy matching 和 SQLite index；此阶段继续兼容旧 producer。
2. 再部署 Message-first producer 与新的 persistence classification；新 durable event 只保存引用。
3. 前端 automatic target settle 可与读取端一起部署，不依赖新 producer。
4. 不批量重写既有消息或事件；旧数据按唯一匹配或 status-only 规则读取。
5. 若新 producer 上线后出现关联性故障，回滚到本 Change 前版本会使新 ref-only event 缺少旧正文，历史可能只显示状态，但消息与最终答案事实仍保留。不得通过恢复事件正文双写作为回滚方案。
6. 回滚触发条件是 valid message/event pair 无法通过 live 或 history route 生成安全正文、跨 scope negative test 失败，或 fork 出现 source id 泄漏。回滚后验证消息可读、final answer 正常、request lifecycle 与 terminal commit 不受影响。

## 待确认问题（Open Questions）

无。`agent-contracts/runtime` 的兼容扩展已随 2026-07-29 的 Change 2 启动确认采用；Gateway public contract、远端协议和持久化数据模型保持不变。
