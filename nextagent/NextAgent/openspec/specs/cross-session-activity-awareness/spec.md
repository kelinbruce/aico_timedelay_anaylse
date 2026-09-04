# cross-session-activity-awareness Specification

## Purpose
持续投影可信 Owner Scope + Agent Scope 内各会话当前需要用户注意的活动，使用户无需逐个打开会话即可识别等待输入、运行中、未读失败和未读结果，并在匹配终态真实呈现后安全消费提醒。

## Function

- **所属 Function**：`FN-1.21 感知跨会话活动`
- **Function 变更类型**：`ADDED`
- **spec 角色**：主规格

## Requirements
### Requirement: 会话活动状态具有唯一语义和固定优先级

系统 MUST 为可信 Owner Scope + Agent Scope 内的每个 session 派生至多一个 `SessionActivityState`。状态全集 MUST 仅为 `WAITING_FOR_INPUT`、`RUNNING`、`UNREAD_FAILURE`、`UNREAD_RESULT` 和 `NONE`。

当多个候选事实同时存在时，系统 MUST 按 `WAITING_FOR_INPUT` 高于 `RUNNING`、`RUNNING` 高于 `UNREAD_FAILURE`、`UNREAD_FAILURE` 高于 `UNREAD_RESULT`、`UNREAD_RESULT` 高于 `NONE` 的顺序选择唯一状态。系统 MUST 从该 session 的当前有效 run、该 run 的 active pending input 和已提交 terminal fact 重新派生状态，MUST NOT 把收到的单个事件直接映射为新状态而忽略较新的 canonical facts。

当前有效 run MUST 是该 Owner + Agent + Session lane 最新被接受的 attempt，即 durable latest run；它 MUST NOT 被解释为该 lane 中任意仍在 executing、queued、terminal-pending或保留active pending input的旧run。active pending input只有在其`requestRunId`与当前有效run的`runId`相等时才能参与`WAITING_FOR_INPUT`派生。

`WAITING_FOR_INPUT` MUST 只对应当前有效 run 的 active pending input，并 MUST 携带既有 `PendingInputKind` 中恰好一个值：`QUESTION`、`CONFIRMATION`、`AUTHORIZATION` 或 `HUMAN_HANDOFF`。系统 MUST NOT 新增 workflow interrupt 专用 kind；workflow 需要用户补充信息时 MUST 继续使用既有 `QUESTION`。

当前有效 run 处于任一非终态或 terminal-pending 状态且不存在 active pending input 时，派生状态 MUST 为 `RUNNING`。当前有效 run 提交 `REQUEST_FAILED` 时，派生状态 MUST 为 `UNREAD_FAILURE`；提交 `REQUEST_COMPLETED` 时，派生状态 MUST 为 `UNREAD_RESULT`。`REQUEST_CANCELED`、`REQUEST_SUPERSEDED` 或不存在需要用户注意的当前有效 run 时，派生状态 MUST 为 `NONE`。

一个 terminal run 的活动被匹配消费后，在同一后端进程内重新派生同一 source run MUST 继续得到对外 `NONE`，MUST NOT 因重复 terminal 通知重新生成未读。该 session 接受新 run 后，旧消费抑制 MUST 被新 run 的 `RUNNING` 或 `WAITING_FOR_INPUT` 覆盖；新 run 后续完成或失败时 MUST 形成新的未读终态活动。

**需求类别**：功能性需求

#### Scenario: Active pending input 覆盖运行态

- **GIVEN** session `S1` 的当前有效 run 仍在执行
- **AND** 该 run 存在 kind 为 `AUTHORIZATION` 的 active pending input
- **WHEN** 系统派生 `S1` 的会话活动状态
- **THEN** 唯一状态 MUST 为 `WAITING_FOR_INPUT`
- **AND** `pendingInputKind` MUST 为 `AUTHORIZATION`
- **AND** 系统 MUST NOT 同时输出 `RUNNING` 或未读终态状态

#### Scenario: Pending input 解决后恢复运行态

- **GIVEN** session `S1` 当前为 `WAITING_FOR_INPUT`
- **WHEN** 对应 pending input 已提交 `USER_INPUT_RECEIVED` 且当前有效 run 仍为非终态
- **THEN** 系统 MUST 重新派生 `S1` 为 `RUNNING`

#### Scenario: 新 run 覆盖旧终态未读

- **GIVEN** session `S1` 当前为 `UNREAD_RESULT` 或 `UNREAD_FAILURE`
- **WHEN** runtime 已提交该 session 的新 run acceptance
- **THEN** 系统 MUST 重新读取当前有效 run
- **AND** `S1` MUST 变为 `RUNNING`，或在新 run 已存在 active pending input 时变为 `WAITING_FOR_INPUT`
- **AND** 旧终态活动 MUST 不再作为该 session 的当前未读状态

#### Scenario: 迟到的旧 run 事件不能覆盖较新 run

- **GIVEN** session `S1` 已有较新的当前有效 run
- **WHEN** 系统收到该 session 较旧 run 的 terminal 或 pending-input lifecycle 通知
- **THEN** 系统 MUST 根据最新 canonical facts 重新派生
- **AND** 较旧 run 的通知 MUST NOT 覆盖较新 run 的当前会话活动状态

#### Scenario: 较新 queued run 覆盖仍在退出的 executing run

- **GIVEN** session `S1` 的旧 run `R1` 仍处于 `EXECUTING`，并可能保留 active pending input
- **AND** latest-submit replacement 已接受较新的 run `R2`，`R2` 当前为 `ACCEPTED` 或 `QUEUED`
- **WHEN** 系统派生 `S1` 的会话活动状态
- **THEN** `R2` MUST 是当前有效 run
- **AND** `S1` MUST 派生为 `RUNNING`
- **AND** `R1` 的旧 pending input MUST NOT 使 `S1` 派生为 `WAITING_FOR_INPUT`
- **AND** Activity派生 MUST NOT改变runtime对`R1` safe-boundary supersession与`R2` dispatch的处理

#### Scenario: 取消和 supersede 不产生失败提醒

- **WHEN** session 的当前有效 run 提交 `REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED`
- **THEN** 会话活动状态 MUST 为 `NONE`
- **AND** 系统 MUST NOT 输出 `UNREAD_FAILURE` 或 `UNREAD_RESULT`

### Requirement: 会话活动公共数据契约是严格判别联合

系统 MUST 提供 canonical `SessionActivityStatus`、只接受可信 identity 的订阅与消费契约，以及与领域状态同形映射的 public wire DTO。该新增 MUST 为 additive contract change，MUST NOT 修改既有 `RunStatus`、`PendingInputKind`、session list entry、`StreamEnvelope` 或 session detail stream schema，也 MUST NOT 建立新的通用 Web contract 扩展面。

每个 public 会话活动 entry MUST 携带 `sessionId` 和 `status`。状态为 `WAITING_FOR_INPUT` 时，entry MUST 携带 `pendingInputKind`，并 MUST NOT 携带 `activityId`。状态为 `UNREAD_FAILURE` 或 `UNREAD_RESULT` 时，entry MUST 携带非空 opaque `activityId`，并 MUST NOT 携带 `pendingInputKind`。状态为 `RUNNING` 或 `NONE` 时，entry MUST NOT 携带 `pendingInputKind` 或 `activityId`。

`activityId` MUST 由后端为一次当前终态注意力活动生成，MUST 在该 Owner + Agent + Session 范围内标识精确活动，MUST 不长于 256 个字符。客户端 MUST 把它视为不可解析的匹配令牌，MUST NOT 从中推断 `runId`、revision、时间或排序。

Activity stream application message MUST 只有两种 shape：

- `SNAPSHOT` message 携带 `entries`，其中只允许非 `NONE` entry。
- `DELTA` message 携带恰好一个 `entry`，其中允许 `NONE` 用于清除。

Activity message、entry 和消费 request MUST 拒绝未知字段。Activity message与entry MUST NOT 携带 run id；消费 request只允许携带作为已呈现终态证据的 `observedRunId`。它们 MUST NOT 携带 `feedSequence`、per-session revision、resume cursor、分页 offset/limit、owner identity 或 Agent identity。

若 backend 使用进程内状态抑制已消费 terminal run，该状态 MUST 是实现私有状态，MUST NOT 成为 `SessionActivityStatus`、public entry、snapshot、delta、Web request/response 或持久化事实。

**需求类别**：功能性需求

#### Scenario: Waiting entry 只携带 pending kind

- **WHEN** Web channel 投影 `WAITING_FOR_INPUT`
- **THEN** entry MUST 携带 `sessionId`、`status="WAITING_FOR_INPUT"` 和一个合法 `pendingInputKind`
- **AND** entry MUST NOT 携带 `activityId`

#### Scenario: Terminal entry 携带 opaque activity id

- **WHEN** Web channel 投影 `UNREAD_FAILURE` 或 `UNREAD_RESULT`
- **THEN** entry MUST 携带 `sessionId`、对应 `status` 和非空 `activityId`
- **AND** entry MUST NOT 携带 `pendingInputKind`

#### Scenario: 非法条件字段被拒绝

- **WHEN** activity entry 为 `RUNNING` 但携带 `activityId`，或为 `UNREAD_RESULT` 但缺少 `activityId`
- **THEN** runtime schema validation MUST 失败
- **AND** 非法 entry MUST NOT 进入浏览器 activity store

### Requirement: 每个 app instance 使用一条全 scope 会话活动连接

浏览器 ER surface MUST 为每个已认证 app instance 建立一条 Session Activity Projection Stream。该连接的范围 MUST 是可信 Owner Scope + 当前可信 Agent Scope 下的全部 session，MUST 与当前打开的 session、会话列表分页、普通列表窗口、搜索结果、收藏视图和 collaborative History Popover 当前加载项无关。

当现有 `transportKind` 为 SSE 时，浏览器 MUST 使用 `GET /api/v1/session-activities/stream`；当其为 WebSocket 时，浏览器 MUST 使用 `WS /api/v1/session-activities/ws`。同一 app instance MUST 只建立所选 transport 的一条 activity connection，MUST NOT 同时建立 activity SSE 和 activity WebSocket。当前打开 session 的 detail connection MUST 继续独立存在。

Activity connection MUST 只注册在 ER surface。IR route whitelist MUST NOT 暴露 activity stream、activity WebSocket 或 terminal activity consume route。

Activity connection MUST 遵守 `ts-web-sse-ws-transports` 冻结的 Session Activity Projection Stream 边界：MUST NOT 使用 `StreamEnvelope`、`StreamEventType`、timeline sequence、`lastSeenSequence`、request/run filter 或 `RuntimeSessionPort.streamEvents(...)`。当前 session detail connection 继续属于 Request Execution Stream；两类连接的建立、关闭、重连和失败 MUST 互不驱动。

Builtin Agent Web的`DEFAULT_WEB + no custom registration`与`LOCAL_CONFIGURED_AUTH` ER路径MUST在正式composition启动时获得必需的activity port并自动注册Activity SSE、Activity WebSocket与consume route。稳定的`DEFAULT_WEB + custom webChannelRegistration` precedence MUST保持“只调用custom registration且不隐式追加builtin registration”；如果custom surface托管Agent Web浏览器页面与runtime bootstrap，custom registration MUST从`WebChannelRegistrationContext`取得必需activity port并显式注册等价的三个Activity endpoints。未托管Agent Web浏览器页面的custom surface不属于本requirement所称的浏览器ER surface。

**需求类别**：功能性需求

#### Scenario: Activity connection 与 detail stream 并存

- **GIVEN** app instance 使用 SSE
- **AND** 用户当前打开 session `S1`
- **WHEN** frontend runtime 启动并进入 `S1`
- **THEN** 浏览器 MUST 建立一条 `/api/v1/session-activities/stream` 连接
- **AND** 浏览器 MUST 独立建立 `S1` 的 session detail stream
- **AND** 浏览器 MUST NOT 为列表中的每个其他 session 建立 detail stream

#### Scenario: WebSocket 配置不再建立 activity SSE

- **GIVEN** app instance 的 `transportKind` 为 WebSocket
- **WHEN** frontend runtime 启动
- **THEN** 浏览器 MUST 只建立 `/api/v1/session-activities/ws`
- **AND** 浏览器 MUST NOT 建立 `/api/v1/session-activities/stream`

#### Scenario: 托管 Agent Web 的 custom registration 显式注册 Activity

- **GIVEN** `DEFAULT_WEB` 使用 custom `webChannelRegistration`
- **AND** 该 custom surface 托管 Agent Web 浏览器页面与 runtime bootstrap
- **WHEN** `agent-app` 调用 custom registration
- **THEN** `WebChannelRegistrationContext` MUST 携带必需的 activity port
- **AND** custom registration MUST 使用该 port 注册 Activity SSE、Activity WebSocket与consume route
- **AND** `agent-app` MUST NOT 额外调用 builtin Web registration

#### Scenario: 加载下一页不改变活动订阅范围

- **GIVEN** activity connection 已覆盖 Owner + Agent scope 中全部 session
- **WHEN** 用户加载普通会话列表或搜索结果的下一页
- **THEN** frontend MUST NOT 发起新的 activity snapshot 请求
- **AND** backend MUST NOT 因列表页变化修改 activity subscription
- **AND** 新加载行 MUST 立即消费 activity store 中已存在的对应 session 状态

#### Scenario: 两台电脑各自建立连接

- **GIVEN** 同一 Owner + Agent scope 在两个在线 app instance 登录
- **WHEN** 两个 app instance 分别启动
- **THEN** backend MUST 允许两条独立 activity connection
- **AND** 两条连接 MUST 接收相同 scope 的当前活动状态变化

#### Scenario: Activity endpoint不可用时有界降级

- **GIVEN** 新frontend连接的backend没有Activity endpoint，或Activity endpoint返回`404`、`503`或连接失败
- **WHEN** Activity controller处理该失败
- **THEN** frontend MUST 保持session list、session navigation与当前Request Execution Stream可用
- **AND** frontend MUST NOT把失败解释为空`SNAPSHOT`或清空其他frontend store
- **AND** frontend MUST 在非零延迟后才建立下一次Activity连接，MUST NOT在同一同步调用段或microtask循环中紧密重试
- **WHEN** backend后续可用且下一次Activity连接成功
- **THEN** frontend MUST 以该连接首帧`SNAPSHOT`全量重建activity store

### Requirement: 首帧稀疏快照与后续 delta 不丢失状态

每次 activity connection 初次建立或重连时，backend MUST 把恰好一个 `SNAPSHOT` 作为第一条 application message。该 snapshot MUST 表示一个确定时点上当前 scope 的完整非 `NONE` 会话活动集合；没有非 `NONE` 状态时 `entries` MUST 为空数组。backend MUST NOT 分块发送 snapshot，MUST NOT 为 `NONE` session 发送 snapshot entry。

snapshot 之后，backend MUST 只发送 `DELTA`。仅当一个 session 的判别联合值发生语义变化时，backend 才能发布该 session 的 delta；语义相等必须同时比较 `status` 和该状态允许的 `pendingInputKind` 或 `activityId`。当状态从非 `NONE` 变为 `NONE` 时，backend MUST 发送 `NONE` delta；从未向该连接投影过非 `NONE` 且当前仍为 `NONE` 时，backend MUST NOT 发送 `NONE`。

backend MUST 保证 snapshot 的线性化点之后发生的状态变化不会落在 snapshot 与 live delta 交接缝隙中。Frontend 收到 `SNAPSHOT` 时 MUST 以 snapshot 的非 `NONE` entries 替换该连接 generation 的全部 activity store 内容；收到后续 `DELTA` 时 MUST 按 `sessionId` 增量合并，`NONE` MUST 删除该 session 的本地 entry。

Frontend MUST NOT 持久化 activity snapshot、delta、connection generation 或未读状态。连接重建后，frontend MUST 忽略旧 connection generation 的迟到 callback，并以新连接的 snapshot 重建内存状态。

Frontend 对 activity connection 的 JSON 与 application message 顺序 MUST fail closed。malformed JSON、未知或非法判别联合、重复 `SNAPSHOT`、`SNAPSHOT` 前的 `DELTA` 都 MUST 在修改 activity store 前终止当前 connection generation，并触发无 resume cursor 的重连；frontend MUST NOT 忽略非法帧后继续使用当前 generation。重连成功后 MUST 只以新 `SNAPSHOT` 恢复状态。

**需求类别**：功能性需求

#### Scenario: 首次连接只发送非 NONE

- **GIVEN** scope 内 `S1` 为 `RUNNING`、`S2` 为 `UNREAD_RESULT`，其余 session 均为 `NONE`
- **WHEN** activity connection 建立
- **THEN** 第一条 application message MUST 是一个 `SNAPSHOT`
- **AND** snapshot MUST 只包含 `S1` 和 `S2`
- **AND** backend MUST NOT 为其余 session 发送 `NONE` entry

#### Scenario: 状态未变化时不发送 delta

- **GIVEN** `S1` 已投影为 `RUNNING`
- **WHEN** backend 收到 `S1` 的另一个 lifecycle 通知但重新派生结果仍为 `RUNNING`
- **THEN** backend MUST NOT 发送 `S1` 的 activity delta

#### Scenario: NONE 只清除已有状态

- **GIVEN** `S1` 已向连接投影为 `WAITING_FOR_INPUT`
- **WHEN** `S1` 重新派生为 `NONE`
- **THEN** backend MUST 发送一个 `status="NONE"` 的 `DELTA`
- **AND** frontend MUST 删除 `S1` 的本地 activity entry

#### Scenario: 重连快照替换旧内存状态

- **GIVEN** 旧连接断开前 frontend 保存了 `S1` 与 `S2` 的非 `NONE` 状态
- **AND** 新连接 snapshot 只包含 `S2`
- **WHEN** frontend 接纳新连接 snapshot
- **THEN** frontend MUST 删除旧的 `S1` 状态
- **AND** frontend MUST 保留 snapshot 中的 `S2`
- **AND** frontend MUST NOT 等待 `S1` 的 `NONE` delta

#### Scenario: Snapshot 与 live 交接期间发生变化

- **GIVEN** backend 已开始建立某个 scope 的 activity snapshot
- **WHEN** `S1` 在 snapshot 线性化点之后从 `RUNNING` 变为 `UNREAD_RESULT`
- **THEN** 该连接 MUST 最终先获得 snapshot 时点的集合，再获得使 `S1` 收敛到 `UNREAD_RESULT` 的 delta
- **AND** 该变化 MUST NOT 因 snapshot 生成而丢失

#### Scenario: 非法 activity frame 触发重连

- **GIVEN** frontend 已建立 activity connection
- **WHEN** 当前 generation 收到 malformed JSON、重复 `SNAPSHOT` 或 `SNAPSHOT` 前的 `DELTA`
- **THEN** frontend MUST 关闭或放弃当前 generation
- **AND** 非法 frame MUST NOT 部分修改 activity store
- **AND** frontend MUST 通过新连接取得新的首帧 `SNAPSHOT`

### Requirement: 会话活动变化只由已提交 canonical facts 触发

系统 MUST 只在已提交的 request acceptance、run lifecycle、pending-input lifecycle、terminal timeline 或 session delete 事实通知某个 session 可能变化时，重新派生该 session。会话列表刷新、列表 render、hover、分页、搜索、detail connection open/close、transport heartbeat 和 projection cache 命中 MUST NOT 触发或构造会话活动状态。

活动观察 MUST 只使用 canonical run、active pending input 和 session facts。它 MUST NOT 推进请求处理、创建或回答 pending input、提交 terminal、修改 conversation、重新执行模型或 Capability，MUST NOT 把 frontend、transport buffer 或 event payload 单独作为 execution truth。

新 terminal activity 到达时，backend MUST 为该次当前终态注意力生成新的 `activityId`。同一尚未消费的已提交 terminal fact 被重复通知时，backend MUST 保留已有 `activityId` 并 MUST NOT 发布重复 delta；同一已经消费的 terminal fact 被重复通知时，backend MUST 保持对外 `NONE`，MUST NOT 生成新 `activityId` 或发布复活 delta。

**需求类别**：功能性需求

#### Scenario: Committed fact 触发单 session 重算

- **WHEN** runtime 提交 session `S1` 的 `REQUEST_ACCEPTED`
- **THEN** 系统 MUST 只把 `S1` 标记为待重新派生
- **AND** 系统 MUST 从 canonical facts 得到 `S1` 的当前状态
- **AND** 系统 MUST NOT 扫描或重算未受影响的其他 session

#### Scenario: 列表活动不触发状态计算

- **WHEN** 用户刷新会话列表、切换搜索条件、加载下一页或 hover 某一行
- **THEN** backend MUST NOT 因该动作重新派生会话活动
- **AND** frontend MUST 只读取当前 activity store 进行列表呈现

#### Scenario: 重复 terminal 通知保持同一活动

- **GIVEN** `S1` 已因一个 `REQUEST_FAILED` terminal fact 生成 `activityId=A1`
- **WHEN** 同一个 terminal fact 被重复通知
- **THEN** `S1` MUST 保持 `UNREAD_FAILURE` 和 `activityId=A1`
- **AND** backend MUST NOT 发布新的 activity delta

#### Scenario: 已消费的同一 terminal run 不复活

- **GIVEN** `S1` 的 run `R1` 已生成 terminal activity `A1`
- **AND** `A1` 已通过 `activityId=A1` 与 `observedRunId=R1` 匹配消费，`S1` 对外为 `NONE`
- **WHEN** backend 再次收到 `R1` 的同一 terminal fact 通知并重新派生 `S1`
- **THEN** `S1` MUST 继续对外为 `NONE`
- **AND** backend MUST NOT 生成新的 `activityId`
- **AND** backend MUST NOT 发布使 `S1` 恢复未读的 delta

#### Scenario: 已消费旧 run 后的新 run仍产生未读

- **GIVEN** `S1` 的旧 run `R1` terminal activity 已被消费
- **WHEN** runtime 为 `S1` 提交新 run `R2` 的 acceptance
- **THEN** `S1` MUST 变为 `RUNNING`，或在 `R2` 有 active pending input 时变为 `WAITING_FOR_INPUT`
- **WHEN** `R2` 随后提交 `REQUEST_COMPLETED` 或 `REQUEST_FAILED`
- **THEN** backend MUST 为 `R2` 生成新的 terminal activity
- **AND** 该 activity MUST 不受 `R1` 已消费状态影响

### Requirement: 终态活动仅在真实前台查看后匹配消费

只有 `UNREAD_FAILURE` 和 `UNREAD_RESULT` 能被消费。Frontend MUST 通过 `POST /api/v1/sessions/:sessionId/activity/consume` 提交严格 request body `{ "activityId": "<opaque-id>", "observedRunId": "<presented-run-id>" }`。`observedRunId` MUST 来自已成功进入 shared conversation projection 的 terminal presentation，MUST NOT 来自 activity payload或客户端猜测。owner identity 和 Agent identity MUST 来自可信边界；request body MUST NOT 接受这两类字段、status、pending kind、revision、feed sequence或 `observedRunId` 以外的run坐标。

Frontend 只有在以下条件全部成立时才能发送 consume：

- route 或 host active-session state 仍指向该 session；
- 当前 session 的最新有效 terminal presentation 已成功进入 shared conversation projection；
- activity store 中该 session 仍为 terminal unread 状态；
- browser document 可见；
- 当前host提供的`isConversationSurfaceVisible`为true。

上述条件成立即表示当前 active session 的匹配 terminal presentation 已在前台被查看；frontend MUST NOT 再以当前滚动位置、anchored mode、是否位于列表底部或 terminal block 是否与 viewport 相交作为额外消费门槛。

仅打开列表行、选择 route、hover 状态、打开操作菜单、收到 activity delta、收到 terminal transport frame、document 处于 hidden、`isConversationSurfaceVisible=false`或 conversation load/projection 失败时，frontend MUST NOT 发送 consume。活动标识自身 MUST NOT 具有点击清除行为。

backend 只在请求 session 属于当前可信 scope、`activityId` 与该 session 当前 terminal unread activity精确匹配，且 `observedRunId` 与该活动的source run精确匹配时，才能把公开状态变为 `NONE`，记录同进程内该 source run 已消费，并向该 scope 的全部在线 activity connection发布 `NONE` delta。对同 scope 内存在的 session，重复、过期、任一坐标不匹配或当前非 terminal 的合法 consume request MUST 返回 `204 No Content` 且不得改变状态或发布 delta。未授权或不存在的 session MUST 使用既有安全 not-found/authorization语义，MUST NOT 暴露对象是否存在。

**需求类别**：功能性需求

#### Scenario: 前台已呈现完成结果后消费

- **GIVEN** 当前 session `S1` 的 activity store 为 `UNREAD_RESULT` 且 `activityId=A1`
- **AND** `S1` 的 run `R1` 最新有效 completed presentation 已成功进入 shared conversation projection
- **AND** document可见且`isConversationSurfaceVisible=true`
- **WHEN** frontend 提交 `activityId=A1` 与 `observedRunId=R1`
- **THEN** backend MUST 返回 `204 No Content`
- **AND** `S1` MUST 变为 `NONE`
- **AND** 该 scope 的全部在线 activity connection MUST 收到 `S1` 的 `NONE` delta

#### Scenario: 当前前台会话不因滚动位置保留未读

- **GIVEN** 当前 active session `S1` 的匹配 terminal presentation 已成功进入 shared conversation projection
- **AND** document可见且`isConversationSurfaceVisible=true`
- **AND** 当前滚动位置不在底部、处于 anchored mode，或 terminal block 未与 viewport 相交
- **WHEN** frontend 评估 terminal activity consumption 条件
- **THEN** frontend MUST 仍提交匹配的 `activityId` 与 `observedRunId`
- **AND** frontend MUST NOT 为 `S1` 额外显示 activity marker

#### Scenario: Active session 处于后台时不消费

- **GIVEN** route 仍指向 `S1`
- **AND** `S1` 收到 terminal unread activity
- **AND** document hidden或`isConversationSurfaceVisible=false`
- **WHEN** terminal presentation 在内存中更新
- **THEN** frontend MUST NOT 发送 consume
- **AND** backend MUST 保持 terminal unread 状态

#### Scenario: 恢复前台后消费

- **GIVEN** `S1` 的匹配 terminal presentation 已成功投影
- **AND** `S1` 因document hidden或`isConversationSurfaceVisible=false`而尚未消费
- **WHEN** document恢复可见、`isConversationSurfaceVisible=true`且`S1`仍是active session
- **THEN** frontend MUST 提交当前 activity store 中的 `activityId`

#### Scenario: Immersive History或Favorites覆盖conversation时不消费

- **GIVEN** immersive右布局的active session `S1` 已有匹配terminal presentation与terminal unread activity
- **AND** `panelView`为`history`或`favorites`，conversation React tree仍mounted但被对应CardList覆盖
- **WHEN** frontend评估terminal activity consumption条件
- **THEN** host MUST 提供`isConversationSurfaceVisible=false`
- **AND** frontend MUST NOT提交activity consume
- **AND** `S1`的terminal unread activity MUST 保留

#### Scenario: Immersive返回conversation后消费

- **GIVEN** `S1`因immersive History、Favorites、Memory或custom panel覆盖而尚未消费
- **AND** `S1`的匹配terminal presentation与terminal unread activity仍有效
- **WHEN** immersive返回conversation surface，document可见且`isConversationSurfaceVisible=true`
- **THEN** frontend MUST提交当前`activityId`与匹配`observedRunId`

#### Scenario: 迟到消费不能清除新活动

- **GIVEN** frontend 曾读取 `S1` 的 `activityId=A1`
- **AND** backend 当前已把 `S1` 更新为较新的 `activityId=A2`
- **WHEN** frontend 迟到提交 `activityId=A1` 与旧 terminal presentation的 `observedRunId`
- **THEN** backend MUST 返回 `204 No Content`
- **AND** backend MUST 保留 `A2`
- **AND** backend MUST NOT 发布 `NONE`

#### Scenario: 旧 terminal presentation不能消费新活动

- **GIVEN** `S1` 的旧 run `R1` terminal presentation仍显示在frontend
- **AND** backend当前activity来自较新的run `R2`且`activityId=A2`
- **WHEN** frontend提交`activityId=A2`与`observedRunId=R1`
- **THEN** backend MUST返回`204 No Content`
- **AND** backend MUST保留`A2`
- **AND** backend MUST NOT发布`NONE`

#### Scenario: 会话内容加载失败不消费

- **GIVEN** 用户打开带 terminal unread activity 的 `S1`
- **WHEN** conversation 或 terminal presentation 加载失败
- **THEN** frontend MUST NOT 提交 activity consume
- **AND** activity store与backend terminal unread MUST 保留
- **AND** 当`S1`仍是active session且`isConversationSurfaceVisible=true`时，frontend MUST继续按当前会话注意力规则在本地抑制列表marker，并在collaborative host中从History聚合排除`S1`
- **WHEN** 用户切换离开`S1`，或宿主使`isConversationSurfaceVisible=false`
- **THEN** 列表行 MUST 再次显示该 terminal unread activity
- **AND** collaborative History聚合关注状态 MUST再次包含`S1`

#### Scenario: 从 A 切到 B 后 A 的新 run完成仍显示未读

- **GIVEN** 用户已经查看并消费 session `A` 的旧 run `R1`
- **WHEN** 用户在 `A` 提交新消息形成 run `R2`
- **AND** `R2` 尚未 terminal 时用户切换到 session `B`
- **AND** `R2` 在 `A` 非 active 期间提交 `REQUEST_COMPLETED` 或 `REQUEST_FAILED`
- **THEN** frontend MUST NOT 因曾查看过 `R1` 而消费 `R2` 的 terminal activity
- **AND** `A` 的非当前会话列表行 MUST 显示 `R2` 对应的未读结果或未读失败 marker
- **WHEN** 用户重新打开 `A`，且 `R2` 的匹配 terminal presentation 成功投影并处于前台可见
- **THEN** frontend MUST 提交 `R2` 对应的匹配消费

### Requirement: 会话列表按用户注意力优先级呈现活动

local/immersive Sidebar、`SessionHistorySearchDialog`、immersive右布局History CardList与collaborative History Popover的session row MUST在标题右侧使用同一个 trailing projection 承载时间、活动状态或既有More操作。四个用户可见入口MUST复用同一session activity store、`SessionActivityTrailingSlot`、activity selector、状态语义和accessibility文案；各host MAY保留已有导航、删除和行容器，但MUST NOT各自实现状态优先级或未读truth。

local/immersive 左侧 Sidebar 的 session row MUST把该 trailing projection 作为正常布局项放在行右侧，并按当前时间、活动状态或More操作的实际内容宽度呈现；最长等待tag MAY使用共享最大宽度。该行 MUST NOT固定预留140px，MUST NOT使用绝对覆盖、渐变或背景遮罩。标题 MUST占据扣除常规内边距、间隔和当前 trailing content 实际宽度后的剩余空间，并以单行硬裁切隐藏溢出文字，MUST NOT显示省略号。状态切换 MAY使标题的可见裁切点随当前 trailing content 宽度变化，但 MUST NOT改变会话行总宽度、trailing右对齐位置或产生水平溢出。`SessionHistorySearchDialog`、immersive右布局History CardList与collaborative History Popover MAY保留各自已有固定槽位壳层和标题省略行为。

当该行不是当前 active session，且没有 hover、keyboard focus-within 或打开中的行操作菜单时，槽位 MUST 按唯一活动状态呈现：

- `WAITING_FOR_INPUT` MUST 呈现 locale-backed 紧凑 tag 与文字。`QUESTION` 表达等待回答，`CONFIRMATION` 表达等待确认，`AUTHORIZATION` 表达等待授权，`HUMAN_HANDOFF` 表达等待人工处理。
- `RUNNING` MUST 呈现小型 loading indicator。
- `UNREAD_FAILURE` MUST 呈现红色圆圈感叹号。
- `UNREAD_RESULT` MUST 呈现蓝色小点。
- `NONE` MUST 呈现既有时间。

当该行是当前active session且`isConversationSurfaceVisible=true`时，槽位MUST呈现既有时间并在本地抑制activity marker；该抑制只表示用户当前正在查看该conversation surface，MUST NOT要求terminal presentation已经成功投影，也MUST NOT修改activity store或backend状态。active route对应的conversation surface不可见时，该行MUST按activity store呈现状态，不得仅因route active隐藏提醒。若未满足terminal consumption条件，用户切换离开该session后，行MUST根据activity store重新显示marker。

当行处于 hover、keyboard focus-within 或该行操作菜单打开状态时，槽位 MUST 隐藏时间或活动状态，并稳定显示既有 More 操作。离开上述状态后，槽位 MUST 恢复当前应显示的时间或活动状态。所有 icon-only 状态和操作 MUST 具有 locale-backed accessible name 与 hover/focus 说明；activity marker MUST 不可点击。

`SessionHistorySearchDialog` MUST继续使用现有无More操作的搜索结果行。该入口MUST显示与其他入口相同的时间或activity状态、active-visible本地抑制和accessibility文案，但pointer hover或keyboard focus MUST NOT隐藏时间/activity，也MUST NOT创建一个仅供本change使用的新操作入口。打开搜索弹窗、修改搜索条件、分页或聚焦搜索结果MUST NOT消费activity。

More button与菜单项的`Enter`、`Space`或click activation MUST NOT触发行级session navigation。行级keyboard activation MUST只在event target不属于嵌套interactive control时打开session。

**需求类别**：功能性需求

#### Scenario: 非当前会话显示最高优先级状态

- **GIVEN** 非当前 session `S1` 的唯一活动状态为 `WAITING_FOR_INPUT` 且 kind 为 `CONFIRMATION`
- **WHEN** session row 处于普通非交互状态
- **THEN** 右侧槽位 MUST 显示等待确认的紧凑 tag 与文字
- **AND** 该行 MUST NOT 同时显示 loading、失败图标、蓝点或时间

#### Scenario: 当前正在查看的会话只在本地抑制 marker

- **GIVEN** `S1` 的 backend 状态为 `UNREAD_FAILURE`
- **WHEN** `S1`是当前active session、`isConversationSurfaceVisible=true`但尚未满足terminal consumption条件
- **THEN** `S1` 的列表行 MUST 显示时间而不是失败图标
- **AND** frontend activity store MUST 保留 `UNREAD_FAILURE`
- **WHEN** 用户切换到其他 session
- **THEN** `S1` 的列表行 MUST 显示红色圆圈感叹号

#### Scenario: Active route被宿主视图覆盖时不抑制marker

- **GIVEN** `S1`是当前active route且backend状态为`UNREAD_RESULT`
- **AND** immersive History、Favorites、Memory或custom panel使`isConversationSurfaceVisible=false`
- **WHEN** host呈现包含`S1`的session列表
- **THEN** `S1`的trailing slot MUST显示蓝色小点
- **AND** frontend MUST NOT仅因`S1`是active route而隐藏该活动

#### Scenario: Hover 和键盘 focus 显示同一操作入口

- **GIVEN** 非当前 `S1` 正在显示 loading indicator
- **WHEN** pointer hover 该行、keyboard focus 进入该行，或该行 More 菜单已打开
- **THEN** trailing projection MUST 显示既有 More 操作
- **AND** loading indicator MUST 暂时隐藏
- **AND** 会话行总宽度与trailing右对齐位置 MUST保持不变
- **AND** 标题可见裁切点 MAY按More操作的实际宽度调整
- **AND** 该交互 MUST NOT 消费或清除 `S1` 的活动状态

#### Scenario: Sidebar右侧提示按实际宽度占位并硬裁切标题

- **GIVEN** local或immersive左侧Sidebar中存在一个标题长度超过单行可见宽度的session row
- **AND** 该行右侧需要显示时间、活动状态或More操作
- **WHEN** frontend布局该session row
- **THEN** trailing projection MUST按当前内容实际宽度参与布局并右对齐
- **AND** frontend MUST NOT为该行固定预留140px
- **AND** 标题 MUST使用剩余空间单行硬裁切且不显示省略号
- **AND** frontend MUST NOT使用绝对覆盖、渐变或背景遮罩
- **AND** 时间、活动状态与More操作之间切换 MUST保持会话行总宽度与trailing右边缘稳定

#### Scenario: More键盘操作不打开会话

- **GIVEN** keyboard focus位于`S1`行的More button或其菜单项
- **WHEN** 用户按下`Enter`或`Space`
- **THEN** frontend MUST只执行对应的菜单打开或菜单项操作
- **AND** frontend MUST NOT同时触发行级session navigation
- **AND** menu打开期间trailing slot MUST保持More操作可见

#### Scenario: 四个用户可见列表入口使用同一呈现语义

- **WHEN** 同一个session activity fixture分别在local/immersive Sidebar、SessionHistorySearchDialog、immersive右布局History CardList和collaborative History Popover中呈现
- **THEN** 四个入口MUST使用相同`SessionActivityTrailingSlot`、状态优先级、图标或tag语义、active-visible抑制和accessibility文案
- **AND** 支持行操作的入口MUST使用相同More操作切换，SearchDialog MUST保留无More操作行为
- **AND** 任一宿主入口 MUST NOT 建立独立 activity truth 或未读状态机

#### Scenario: SearchDialog hover 不隐藏活动状态

- **GIVEN** SearchDialog中的`S1`搜索结果正在显示`WAITING_FOR_INPUT`或terminal unread activity
- **WHEN** pointer hover该行或keyboard focus进入该行
- **THEN** trailing slot MUST继续显示当前activity状态
- **AND** SearchDialog MUST NOT显示More操作
- **AND** 该交互 MUST NOT消费或清除`S1`的activity

### Requirement: Collaborative History入口聚合不在当前查看表面的会话活动

collaborative host MUST在顶部History trigger上呈现一个locale-backed蓝色聚合dot，当且仅当activity store中存在至少一个当前不在用户正在查看的conversation surface中的非`NONE`session。当前active session只有在`isConversationSurfaceVisible=true`时才能从聚合中排除；该本地排除只表达用户注意力位于当前会话，不证明terminal presentation已经成功投影，也不消费backend unread。active route但conversation surface隐藏、minimized或被custom panel替换时仍MUST参与聚合。

该聚合dot MUST只表达“存在需要查看的会话活动”，MUST NOT显示数量，MUST NOT按状态改变颜色，MUST NOT成为独立点击目标。打开或关闭History Popover、hover或focus trigger、加载下一页、点击session row均MUST NOT直接清除dot或消费terminal activity；dot只能在聚合条件不再成立时消失。

**需求类别**：功能性需求

#### Scenario: 收起的History入口提示后台会话活动

- **GIVEN** collaborative host的History Popover关闭
- **AND** 非当前session `S2`的activity为`RUNNING`、`WAITING_FOR_INPUT`、`UNREAD_FAILURE`或`UNREAD_RESULT`
- **WHEN** frontend计算History trigger聚合状态
- **THEN** History trigger MUST显示蓝色dot
- **AND** accessible name MUST表达存在需要关注的会话活动

#### Scenario: 打开History不清除聚合dot

- **GIVEN** History trigger因`S2`的非`NONE`activity显示蓝色dot
- **WHEN** 用户打开History Popover并查看列表
- **THEN** 蓝色dot MUST继续显示
- **AND** frontend MUST NOT因打开Popover、呈现`S2`行或聚焦该行而提交terminal consume

#### Scenario: 当前正在查看的session不产生入口dot

- **GIVEN** activity store中唯一非`NONE`entry属于当前active session `S1`
- **AND** `S1`的conversation surface是用户当前正在查看的主内容
- **WHEN** frontend计算History trigger聚合状态
- **THEN** History trigger MUST不显示蓝色dot

#### Scenario: Active session表面不可见时仍产生入口dot

- **GIVEN** activity store中唯一非`NONE`entry属于当前active route `S1`
- **AND** collaborative panel hidden、minimized或被custom panel替换，使`isConversationSurfaceVisible=false`
- **WHEN** frontend计算History trigger聚合状态
- **THEN** frontend的聚合关注状态MUST保持为true
- **AND** frontend MUST保留`S1`的activity
- **WHEN** History trigger随后重新可呈现，且`S1`仍不在用户正在查看的conversation surface中
- **THEN** History trigger MUST显示蓝色dot

### Requirement: 会话删除和离线期间遵守显式活动生命周期

session 删除成功后，系统 MUST 删除该 session 的任一进程内 activity 内部状态，包括公开活动或已消费 terminal 抑制。若删除前已向 live connection 投影非 `NONE` 状态，backend MUST 向相同 scope 的 live activity connection 发送 `NONE` delta，使浏览器清除缓存；activity connection MUST NOT 发送 session tombstone、列表删除事件或目录刷新命令。

在同一后端进程存活期间，没有在线浏览器也 MUST 保留当前非 `NONE` activity，直到状态变化、匹配消费或 session delete。为防止已消费的同一 terminal run 复活，backend MAY 保留一个不对外投影的同进程消费抑制状态。公开非 `NONE` activity 与消费抑制状态 MUST 互斥。

**需求类别**：功能性需求

#### Scenario: 删除会话清除活动但不承担目录同步

- **GIVEN** `S1` 已向 live connection 投影为 `RUNNING`
- **WHEN** `S1` 删除成功
- **THEN** backend MUST 删除 `S1` 的 activity entry
- **AND** live activity connection MUST 收到 `S1` 的 `NONE` delta
- **AND** activity connection MUST NOT 发送 session tombstone、标题变化或列表分页变化

#### Scenario: 无浏览器期间的终态在同进程内保留

- **GIVEN** backend 进程保持存活且当前没有 activity connection
- **WHEN** `S1` 提交 `REQUEST_COMPLETED`
- **THEN** 系统 MUST 保留 `S1` 的 `UNREAD_RESULT` 和 `activityId`
- **WHEN** 同 scope 的浏览器稍后建立 activity connection
- **THEN** 初始 snapshot MUST 包含 `S1`

### Requirement: 会话活动在重启和依赖失败后安全恢复

进程启动或首次初始化 scope 时，系统 MUST 从 durable session、run 和 pending-input facts 恢复当前 `RUNNING` 与 `WAITING_FOR_INPUT`。系统 MUST NOT 从历史 `COMPLETED` 或 `FAILED` run seed `UNREAD_RESULT` 或 `UNREAD_FAILURE`。因此进程重启前尚未消费的 terminal activity 允许丢失，但 durable result、failure 和 conversation history MUST 保持不变。

如果初始 durable read、scope bootstrap、状态重新派生或 snapshot serialization 失败，backend MUST 安全失败或关闭受影响 activity connection，使 frontend 通过新连接重新同步；backend MUST NOT 发送伪空 snapshot、伪 `NONE`、伪 completed 或跨 scope 数据。

Activity 观察、广播、连接或 consume 失败 MUST NOT 使已提交 request acceptance、pending input、terminal commit、conversation 或 session delete 回滚。Frontend consume 失败时 MUST 保留 backend truth；active session 的本地 marker 抑制允许继续，但用户切换离开后 MUST 按当前 activity store 恢复 marker，并由重连 snapshot 最终校正。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复

**适用范围**：该 Function

#### Scenario: 重启不复活历史终态未读

- **GIVEN** `S1` 在进程重启前为尚未消费的 `UNREAD_FAILURE`
- **WHEN** backend 进程重启并初始化该 scope
- **THEN** 系统 MUST NOT 从历史 failed run 恢复 `UNREAD_FAILURE`
- **AND** `S1` 的 durable failure 与 conversation history MUST 仍可通过既有读取路径查看

#### Scenario: 重启恢复仍在等待的 session

- **GIVEN** durable facts 表明 `S1` 的当前有效 run 仍有 active `HUMAN_HANDOFF` pending input
- **WHEN** backend 进程重启并初始化该 scope
- **THEN** activity snapshot MUST 包含 `S1`
- **AND** `S1` MUST 为 `WAITING_FOR_INPUT` 且 `pendingInputKind="HUMAN_HANDOFF"`

#### Scenario: Bootstrap 失败不能伪装为空

- **WHEN** backend 无法读取 activity snapshot 所需的 durable facts
- **THEN** backend MUST 返回 safe stream failure 或关闭连接
- **AND** backend MUST NOT 发送空 `SNAPSHOT` 表示该 scope 没有活动
- **AND** request lifecycle MUST 不受该失败影响

### Requirement: 会话活动状态和待发送变化保持有界

每个 session 最多只能有一个内部 activity 状态，公开非 `NONE` activity 与消费抑制状态 MUST 互斥；每个 scope 的内部状态数量和每个 subscriber 的待发送 session 数量都 MUST 不超过该 Owner + Agent scope 的实际 session 数量。Activity subscriber 的待发送变化 MUST 按 session 合并为最新状态，使待发送基数不超过该 scope 的 session 数。系统 MUST NOT 另设一个更小的 activity 容量或 quota 而静默丢弃状态；若容量不变量无法维持，backend MUST 关闭连接。

**需求类别**：系统质量属性

**质量属性**：性能/容量

**适用范围**：该 Function

#### Scenario: 状态与待发送变化不超过实际会话数

- **GIVEN** 一个 Owner + Agent scope 包含 `N` 个实际 session
- **WHEN** 多个 canonical fact 在 subscriber 发送前反复改变这些 session 的 activity
- **THEN** backend MUST 为每个 session 只保留一个最新内部状态和一个最新待发送变化
- **AND** 内部状态数量与待发送 session 数量 MUST 均不超过 `N`
- **AND** backend MUST NOT 通过静默丢弃任意 session 来维持更小 quota
- **AND** 无法维持该不变量时 MUST 关闭连接并允许客户端重新同步

### Requirement: 会话活动保持 Owner Scope 与 Agent Scope 隔离

Activity snapshot、delta、consume 和 bootstrap MUST 同时校验可信 Owner Scope 与 Agent Scope。Owner identity MUST 只来自 channel/auth boundary；Agent Scope MUST 只来自可信 app composition、hosted-agent selection 或已持久化 session。query、path 之外的 request body、WebSocket client message、frontend metadata 或 activity payload MUST NOT 覆盖 scope。

backend MUST 只向 connection 投影其 scope 内的 session。终态 consume MUST 先在可信 scope 内解析 path `sessionId`，再比较 `activityId`。跨 owner、跨 Agent、伪造 identity 或未知 session 的请求 MUST 安全失败，MUST NOT 清除任何活动，MUST NOT 暴露目标 session 或 activity 是否存在。

**需求类别**：系统质量属性

**质量属性**：安全

**适用范围**：该 Function

#### Scenario: Snapshot 不泄漏其他 scope

- **GIVEN** scope A 与 scope B 都存在非 `NONE` session activity
- **WHEN** scope A 建立 activity connection
- **THEN** snapshot 和后续 delta MUST 只包含 scope A 的 session
- **AND** scope B 的 session id、status、pending kind 和 activity id MUST NOT 出现

#### Scenario: 跨 scope consume 被拒绝

- **GIVEN** `S1` 与 `activityId=A1` 属于 scope B
- **WHEN** scope A 向 `/api/v1/sessions/S1/activity/consume` 提交 `A1`
- **THEN** backend MUST 使用既有安全 not-found/authorization 结果拒绝请求
- **AND** scope B 的 `A1` MUST 保持未读
- **AND**响应 MUST NOT 暴露 `S1` 或 `A1` 是否存在
