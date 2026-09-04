## 背景与问题（Why）

当前浏览器只为用户打开的会话建立 session-scoped stream。该 stream 能及时呈现当前会话的运行过程、pending input 和终态，但用户切换会话后，未打开会话的变化不会进入会话列表。现有 `GET /api/v1/sessions` 分页列表虽然携带 `latestRunStatus` 和 `hasInFlightRequest`，但它是按需读取的会话目录投影，不是跨会话实时活动通道，也没有“等待用户响应”或“终态结果尚未查看”的生命周期。

这使用户必须逐个打开或刷新会话，才能发现其他会话仍在运行、正在等待输入、已经失败或已经产生尚未查看的结果。把会话活动范围绑定到列表已加载页，又会让同一用户因分页、搜索或宿主布局不同而看到不一致的提醒。

本 change 需要建立一个独立于当前会话 detail stream 和会话列表分页的会话级活动投影，使浏览器可以持续感知可信 Owner Scope 与 Agent Scope 内发生变化的会话，同时不复制 Runtime 的请求生命周期事实。

## 术语

- **会话活动状态（Session Activity State）**：面向会话列表注意力提示的单一会话级派生状态。其受控取值为 `WAITING_FOR_INPUT`、`RUNNING`、`UNREAD_FAILURE`、`UNREAD_RESULT` 和 `NONE`，不替代 `RequestRun.status`、pending input 或 canonical timeline。
- **会话活动连接（Session Activity Connection）**：每个浏览器 app instance 建立的一条 Owner Scope + Agent Scope 范围的 Session Activity Projection Stream。该连接与当前会话的 Request Execution Stream 并存，且不受会话列表已加载页、搜索结果或当前打开会话影响。
- **会话内容表面可见（Conversation Surface Visible）**：当前宿主把 active session 的 conversation surface 作为用户正在查看的主内容，而不只是 chat route 或 React component 仍处于 mounted 状态。该事实用于本地抑制当前会话的列表 marker、从 collaborative History 聚合中排除当前会话，也是终态活动消费的必要但不充分条件；只有匹配终态投影成功且 browser document 也可见时，终态活动才能被视为已查看。
- **终态活动消费（Terminal Activity Consumption）**：当前会话的某一精确 run 已成功形成最新终态投影，且 document 与 conversation surface 均处于前台可见状态时，浏览器把它视为用户已查看，并向后端提交该终态活动的 opaque `activityId` 与已呈现的 `observedRunId`；后端只消费仍与这两个坐标共同匹配的未读终态活动。当前滚动位置或终态块是否与 viewport 相交不构成额外门槛。

## 规范上下文

- 本 change 面向当前 local single-instance release；共享多实例活动总线不在本 change 范围内。
- 活动连接只属于浏览器 ER surface，不加入 web-channel IR surface。
- Owner Scope 来自 channel/auth boundary；Agent Scope 来自可信 app composition、hosted-agent selection 或已持久化 session，客户端不得自报。
- `SSE` 与 `WebSocket` 按现有 `transportKind` 配置选择，具有相同会话活动语义。
- 本 change 的实现依赖 `refine-ts-session-activity-stream-boundary` 先确认 Request Execution Stream 与 Session Activity Projection Stream 的冻结边界；本 change 不重新定义该核心分类。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 用户无需打开其他会话，即可从会话列表识别运行中、等待用户响应、未读失败和未读结果。
- collaborative host 的会话列表默认收起时，顶部 History 入口以聚合蓝点提示至少一个当前不在用户正在查看的 conversation surface 中的 session 存在非 `NONE` 活动；用户无需先打开 Popover 才能发现变化。
- 每个会话至多呈现一个活动状态，并按 `WAITING_FOR_INPUT`、`RUNNING`、`UNREAD_FAILURE`、`UNREAD_RESULT`、`NONE` 的固定优先级收敛。
- 活动范围由可信 Owner Scope + Agent Scope 决定，与会话列表分页、搜索、当前列表窗口和当前打开会话解耦。
- 初次连接和重连获得所有当前非 `NONE` 状态的稀疏快照，后续只获得真实语义变化；`NONE` 只用于清除先前已发布的非 `NONE` 状态。
- 多个在线浏览器实例在某个终态活动被真实查看后收到一致的清除结果；迟到或重复的消费请求不得清除更晚的活动。
- 同一个已经消费的 terminal run 即使因重复 canonical 通知再次派生也不得复活为未读；该 session 后续接受的新 run 仍必须形成新的运行态，并在完成或失败后产生新的未读活动。
- 活动投影、传输或消费失败不得推进、回滚或伪造 request lifecycle、pending input 或 terminal commit。

**非目标：**

- 不把会话活动状态加入分页会话列表 DTO，也不让列表加载下一页触发额外活动同步。
- 不新增 `feedSequence`、per-session revision、结果观察表、会话活动表或 gateway persistence contract。
- 不在进程重启后恢复历史终态的未读状态；重启后只从 durable facts 恢复仍在运行或仍等待输入的状态。
- 不新增 `RunStatus`、`PendingInputKind`、canonical timeline event 或 session detail stream event vocabulary。
- 不把取消或 supersede 呈现为失败或未读结果。
- 不由会话活动连接同步会话目录新增、重命名、排序、分页或删除 tombstone。
- 不实现跨进程、多实例或 PaaS 共享活动广播。
- 不引入终态 viewport intersection、滚动水位或“读到最后一条消息”的额外观察语义。
- 不把 collaborative History 入口扩展成通知中心、计数器或状态优先级汇总；入口蓝点只表达“至少一个当前不在用户正在查看的 conversation surface 中的 session 存在非 `NONE` 活动”。

## 变更范围（What Changes）

- **新增**会话活动公共契约：定义五种状态、固定优先级、终态 opaque `activityId`、稀疏 snapshot、单会话 delta 和 Owner + Agent + Session 坐标下的匹配消费语义；条件字段只允许出现在对应状态，客户端不能自报可信 scope。
- **新增** ER 会话活动长连接：SSE 使用 `GET /api/v1/session-activities/stream`，WebSocket 使用 `WS /api/v1/session-activities/ws`；同一 app instance 按现有 `transportKind` 只建立其中一条。
- **新增** ER 终态活动消费命令：`POST /api/v1/sessions/:sessionId/activity/consume`，请求体只接受 opaque `activityId` 与当前已呈现的 `observedRunId`。两者共同匹配才把状态变为 `NONE` 并广播清除；过期、重复或不匹配请求安全幂等且不得清除较新状态。
- **新增**有界会话活动派生：系统只在已提交 lifecycle、pending-input 或 session-delete 事实表明某个会话可能变化时重新判定该会话；同一终态被匹配消费后不得因重复通知复活，新 run 仍可产生新活动。
- **修改**托管 Agent Web 的 ER 注册行为：builtin default 与 local-configured-auth 路径自动提供 Activity endpoints；custom registration precedence 不变，只有实际托管 Agent Web 页面时才必须注册等价 endpoints。
- **修改** Agent Web 会话列表投影：local、immersive、collaborative 四个用户可见列表入口复用相同状态和行尾呈现语义；当前 active 且 conversation surface 可见的会话只在本地抑制 marker。支持行操作的入口在 hover、keyboard focus 或菜单打开时稳定切换为既有操作入口；SearchDialog 仍不显示 More。local/immersive 左侧 Sidebar 按时间、活动或 More 的实际宽度布局，标题使用剩余宽度单行硬裁切。
- **新增** collaborative History 顶部入口聚合蓝点：任一当前不在用户正在查看的 conversation surface 中的 session 存在非 `NONE` 活动时显示；打开 Popover、hover、focus 或点击蓝点不得消费或清除活动。
- **修改**终态可见性观察：当前会话的匹配终态结果已经成功投影，且 `document.visibilityState` 与宿主提供的 `isConversationSurfaceVisible` 均为可见时才提交终态活动消费，不要求终态块进入 viewport。列表 hover、列表点击、History/Favorites/Memory/custom panel 覆盖、后台打开、会话内容加载失败或仅收到 terminal event 均不构成消费。
- **修改** activity transport 的协议失败语义：malformed JSON、非法判别联合、重复 snapshot 或 snapshot 前 delta 必须终止当前连接 generation，并通过重连取得新 snapshot；不得忽略非法帧后继续使用可能不完整的本地状态。
- **移除** 无。

在 `refine-ts-session-activity-stream-boundary` 已确认两类流边界的前提下，本 change 的公共类型和 endpoint 均为 additive change；它不改变现有 session list、Request Execution Stream 或 runtime command 的 wire shape。

## Feature 影响（Features）

### 修改的 Feature

- `F-2.4 查看请求状态`：用户除查看当前请求状态外，还可在不打开其他会话的情况下识别同一可信范围内正在运行、等待输入、未读失败和未读结果的会话；该提醒只观察已提交事实，不推进请求处理。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

- `FN-1.21 感知跨会话活动` → `specs/cross-session-activity-awareness/spec.md`
  - 功能边界：系统按可信 Owner Scope + Agent Scope 提供独立于会话目录分页和当前会话执行流的稀疏活动快照与增量；浏览器在匹配终态结果真实可见后消费未读终态活动，三种宿主复用同一状态、呈现和失败语义。
  - 系统质量属性：性能/容量（每个 app instance 一条全 scope 活动连接和有界单会话状态）、可靠性/恢复（snapshot-to-live、重连替换、local single-instance 重启降级）、安全（Owner Scope + Agent Scope 隔离和匹配消费）。
  - 映射说明：新增 Function 与新 canonical spec `cross-session-activity-awareness` 严格 1:1；`refine-ts-session-activity-stream-boundary` 独立修改既有执行流契约，`ts-run-status-visibility` 继续拥有 canonical run/timeline 可见性事实，`agent-web-multi-host-modes` 继续拥有三宿主复用同一业务核心的不变量。

### 修改的 Function

无。

## 影响范围（Impact）

- 公共契约：`packages/agent-contracts` 的 `session` 与 `runtime` subpath 增加 additive 类型和 port；不新增当前架构不存在的 `web` subpath。
- 后端：`packages/agent-session` 增加进程内会话活动 owner；`packages/agent-app` 增加组合 wiring；`packages/agent-channel-web` 增加 ER activity stream、WebSocket 和 consume route。
- Runtime：复用既有 committed timeline listener 与 durable run/pending-input reader，不改变 lifecycle owner、terminal commit 或 scheduler。
- 前端：`frontend/agent-web` 增加独立 activity service/store/hook、共享 `SessionActivityTrailingSlot`、collaborative History 聚合蓝点和 `isConversationSurfaceVisible` 本地抑制/消费保护，并接入 Sidebar、SessionHistorySearchDialog、immersive 右布局 CardList、collaborative History Popover 与三宿主测试。
- API：新增两个互斥 transport 入口和一个 HTTP consume 入口；现有 `GET /api/v1/sessions`、session-scoped SSE/WS 与 IR route whitelist 保持不变。
- 容量：每个实际 Owner + Agent + Session 最多对应一个进程内内部状态；公开活动与 `CONSUMED_TERMINAL` 抑制状态互斥，不另设更小的 activity quota。新 run 可以覆盖旧消费抑制，session delete 必须释放该 session 的状态。
- 测试：新增 contract、service、channel transport、composition、frontend component/store、multi-host 和浏览器可见性旅程验证。
- 运维：进程重启会丢失尚未消费的终态提醒，这是当前 single-instance release 的显式降级；请求结果与会话历史本身不丢失。
