# Design: add-ts-cross-session-activity-awareness

## 设计范围

| Function | 目标变化 | delta specs | Function 设计章节 |
|---|---|---|---|
| FN-1.21 感知跨会话活动 | 新增可信 Owner + Agent 范围的会话活动派生、同步、匹配消费和三宿主呈现 | `cross-session-activity-awareness`（ADDED） | 见下 |

## FN-1.21 感知跨会话活动

### 目标与规范依据

系统在不复制请求生命周期事实的前提下，为浏览器提供独立于会话目录分页和当前会话执行流的全 scope 会话活动快照与增量；终态活动只有在匹配结果真实前台可见后才能消费，三种宿主复用相同状态、呈现、隔离和降级语义。

本 Function 的目标 Requirements：

- canonical spec：`cross-session-activity-awareness`
- ADDED：会话活动状态具有唯一语义和固定优先级、会话活动公共数据契约是严格判别联合、每个 app instance 使用一条全 scope 会话活动连接、首帧稀疏快照与后续 delta 不丢失状态、会话活动变化只由已提交 canonical facts 触发、终态活动仅在真实前台查看后匹配消费、会话列表按用户注意力优先级呈现活动、Collaborative History入口聚合不在当前查看表面的会话活动、会话删除和离线期间遵守显式活动生命周期、会话活动在重启和依赖失败后安全恢复、会话活动状态和待发送变化保持有界、会话活动保持 Owner Scope 与 Agent Scope 隔离。

### 当前实现

#### 后端事实与调用链

- `packages/agent-contracts/src/session/index.ts` 的 `UserSession` 已携带 `latestRunStatus?` 与 `hasInFlightRequest`；`UserSessionPort.listSessions(...)` 只提供分页 session read model。它没有跨会话订阅、待输入 kind、未读终态或查看消费契约。
- `packages/agent-platform-gateway-local/src/db/sqlite-gateway-core.ts` 的 `listSessions(...)` 按 Owner + Agent scope 分页读取 session，并为每一行投影 latest run summary。`RequestRunStoreGateway.loadSessionLaneSnapshot(...)` 已能按 Owner + Agent + Session 读取 `latestRun`、`executingRun`、`queuedRuns` 与 `terminalPendingRun`；`PendingInputStoreGateway.loadActivePendingInput(...)` 已能读取同 scope session 的 active pending input。
- `packages/agent-runtime/src/lifecycle/submit.ts` 在 timeline fact 持久化后通过 `publishTimelineEvent(...)` 调用 `runTimelineEventListeners`，然后投影给当前 session stream subscriber。listener 同时会看到 persisted 与 `LIVE_ONLY` event，当前同步异常被隔离，不改变 request lifecycle 或 session detail stream。
- `packages/agent-app/src/composition/request-runtime-composition.ts` 已通过 `runTimelineEventListeners` 装配 timeline observation mapper，但没有 session activity listener。
- `packages/agent-session/src/services/session-preparation.ts` 的 `UserSessionService.deleteSession(...)` 在 gateway composite delete 返回 `DELETED` 后直接返回。当前没有 session delete notification 或 activity invalidation callback。
- `packages/agent-channel-web/src/routes/requests.ts` 只注册 session-scoped SSE route，`packages/agent-channel-web/src/transports/websocket.ts` 只识别 `/api/v1/sessions/:sessionId/ws`。public Web DTO 由 `agent-channel-web` 的 TypeBox schema/projection 拥有；仓库不存在 `agent-contracts/web` subpath。
- 当前 Web channel 已有 executable endpoint inventory、schema coverage、documentation alignment test、`routePrefix` 与 `IR_ROUTE_WHITELIST`。本 change 只增量登记三个 ER activity endpoints，并通过既有 whitelist 机制证明 IR 不暴露它们；不重建 route registry 或 API 文档体系。
- `packages/agent-app/src/composition/channel-composition.ts` 把 `RequestLifecycleCoordinator` 作为 `RuntimeSessionPort` 注入 Web channel。ER 与 IR 复用 route plugin，IR 通过 `IR_ROUTE_WHITELIST` 限制端点。当前 bootstrap 正式组合值为 `transportKind="SSE"`，但 frontend 和 Web contract 已冻结 `SSE | WEBSOCKET` 两种 transport vocabulary。

#### 前端事实与调用链

- `frontend/agent-web/src/state/sessionStore.ts` 只保存当前已加载的普通列表或搜索窗口、分页信息和 `activeSessionId`。该 store 不表示 scope 内全部 session，也没有 activity 状态。
- `frontend/agent-web/src/features/chat/hooks/useStreamConnection.ts` 只为当前 session 建立 detail connection，并使用 timeline sequence 进行 session stream resume。切换 session 会关闭旧 detail connection。
- `frontend/agent-web/src/features/sidebar/components/SessionHistoryEntryRow.tsx` 已有右侧固定宽度槽位：普通状态显示时间，pointer hover 时显示 More 操作。当前没有 focus-within、菜单打开保持或活动状态呈现。
- local 与 immersive 左布局通过 shared `ChatWorkspace`/`Sidebar` 使用 `SessionHistoryEntryRow`，`SessionHistorySearchDialog` 也复用该组件且以 `showActionsOnHover=false` 保留无 More 操作的搜索结果行。immersive 右布局的 History 使用独立 `CardList`，collaborative History Popover 使用独立 `ai-agent-piu-history-row` 与 `ai-agent-piu-history-item`。因此当前共有四个用户可见入口、三种行实现；三宿主共享 session store 与 navigation contract，但会话行 DOM、操作能力和壳层并不相同，当前也没有共享 activity trailing slot。
- `frontend/agent-web/src/features/chat/transport/streamTransport.ts` 已提供通用 SSE 与 WebSocket 连接实现，但参数中保留了实际未被 transport 使用的必填 `sessionId`，且当前 SSE/WS JSON decode 失败会被忽略。activity connection 可以复用传输实现，但不能复用 session resume cursor；它还需要一个只对 activity controller 生效的严格 decode/protocol-error 关闭入口，不能沿用“忽略非法帧后继续”的行为。
- 当前没有全局 activity connection、独立 activity store、严格 activity message parser、document/PIU surface visibility 联合判断或 terminal consume client。

### GAP 分析

- 分页 session list 不是实时订阅，也不能成为全 scope activity bootstrap 来源；列表中已有的 run summary 字段继续作为兼容 read model，不升级为 activity truth。
- canonical run、pending input 与 terminal fact 已经存在；本 change 不需要新增 timeline event、`RunStatus`、`PendingInputKind` 或持久化事实。
- `agent-channel-web` 不允许依赖 `agent-session`；所有活动读取和消费必须经 app-composed public port。
- public Web DTO 必须继续留在 `agent-channel-web` schema/projection，不能为了本 change 新建 `agent-contracts/web`。
- frontend 不允许拥有 request lifecycle、pending-input lifecycle、terminal truth 或 durable observation。
- 当前稳定 Stream 契约只允许 Request Execution Stream 使用 `StreamEnvelope` 与 `RuntimeSessionPort.streamEvents(...)`。本 change 必须依赖 `refine-ts-session-activity-stream-boundary` 先授权独立的 Session Activity Projection Stream；不得在本 change 内把 Activity 包装为 execution event 或自行泛化 Web stream family。

### 修改方案

本设计实现 proposal 中“全 scope 独立活动连接”和“终态匹配消费”目标。唯一实现路径是：先由 `refine-ts-session-activity-stream-boundary` 冻结 Request Execution Stream 与 Session Activity Projection Stream 的边界；`agent-session` 再从 durable canonical facts 派生进程内会话活动，`agent-app` 把 committed timeline invalidation 和可信 Agent Scope 接入该服务，`agent-channel-web` 只投影 ER Activity 协议，Agent Web 只保存当前连接 generation 的内存投影并在四个用户可见会话列表入口呈现。

#### 契约归属

`agent-contracts/session` 是会话活动领域契约 owner，新增以下 additive 类型：

```ts
type SessionActivityStatus =
  | "NONE"
  | "WAITING_FOR_INPUT"
  | "RUNNING"
  | "UNREAD_FAILURE"
  | "UNREAD_RESULT";

type SessionActivityEntry =
  | { sessionId: SessionId; status: "NONE" }
  | { sessionId: SessionId; status: "WAITING_FOR_INPUT"; pendingInputKind: PendingInputKind }
  | { sessionId: SessionId; status: "RUNNING" }
  | { sessionId: SessionId; status: "UNREAD_FAILURE"; activityId: string }
  | { sessionId: SessionId; status: "UNREAD_RESULT"; activityId: string };

type SessionActivityMessage =
  | { type: "SNAPSHOT"; entries: readonly Exclude<SessionActivityEntry, { status: "NONE" }>[] }
  | { type: "DELTA"; entry: SessionActivityEntry };
```

同一 subpath 新增 `SessionActivityPort`，其职责分成四个窄入口：

- `invalidateSessionActivity(...)`：同步接收带可信 Owner + Agent + Session 坐标的重算通知；只入队，不接收 runtime event payload，也不执行阻塞读取。
- `invalidateDeletedSession(...)`：在 durable delete 成功后同步清理该 session。
- `streamActivities(...)`：按显式 IdentityContext + AgentId 返回 `AsyncIterable<SessionActivityMessage>`。
- `consumeTerminalActivity(...)`：按显式 IdentityContext + AgentId + SessionId + activityId + observedRunId 执行匹配消费。

`agent-contracts/runtime` 新增 `RuntimeSessionActivityPort`，只向 channel 暴露两个方法：

```ts
interface RuntimeSessionActivityPort {
  streamSessionActivities(query: {
    identityContext: IdentityContext;
    signal?: AbortSignal;
  }): AsyncIterable<SessionActivityMessage>;

  consumeSessionActivity(command: {
    identityContext: IdentityContext;
    sessionId: SessionId;
    activityId: string;
    observedRunId: RequestRunId;
  }): Promise<void>;
}
```

`agent-app` 提供该 runtime-facing port 的实现，闭包注入当前可信 `activeAgentId`，再委托 `SessionActivityPort`。因此 channel 不接收或解析 AgentId，`agent-session` 仍在显式 Owner + Agent scope 下工作，`agent-runtime` request lifecycle implementation 不需要导入或拥有 activity service。

`agent-channel-web` 在自身 `schemas/` 与 `routes/` 内定义严格 TypeBox request/message schema，并从 domain message 投影 wire DTO。它不新增 contract subpath，不把 Fastify、SSE 或 WebSocket shape放入 `agent-contracts/session`。

Session Activity message属于前置 refinement 授权的 Session Activity Projection Stream。它不得包装为 `StreamEnvelope`、不得进入 `agent-contracts/channel`、不得通过 `RuntimeSessionPort.streamEvents(...)` 传输，也不得携带 `lastSeenSequence`、request/run filter 或 timeline sequence。现有 session detail SSE/WS 仍是 Request Execution Stream，两类连接只复用底层 SSE/WS framing、AbortSignal cleanup 与 transport selection primitive，不复用 payload、cursor、subscriber 或 store。

#### 进程内 owner 与数据结构

`packages/agent-session` 新增单一 `SessionActivityService`。一个 app composition 只创建一个实例。服务按 `tenantId + subjectId + agentId` 建立 scope state；每个 scope 只保存：

- 按 session 保存的单一 `stateBySessionId`。每个值只能是 `PUBLISHED(entry, sourceRunId?)` 或 `CONSUMED_TERMINAL(sourceRunId)`：`PUBLISHED` 的 entry 是当前公开非 `NONE` 状态，且只有 terminal entry 才保留 `SessionActivityService` 私有的 `sourceRunId`；`CONSUMED_TERMINAL` 只表示同一 source run 已被消费，不是 `SessionActivityEntry`；
- 当前 subscriber 集合；
- 首次 bootstrap promise、bootstrap 期间发生变化的 session 集合与目录可能变化标记；
- 已取得 scope 但尚未完成 subscriber 注册的 connection 数；
- 等待重新派生的 session 集合和单一 drain 调度标记。

每个 session 最多只有上述一个内部状态，`PUBLISHED` 与 `CONSUMED_TERMINAL` 互斥。公开 `NONE` 不进入 canonical map：普通状态派生为 `NONE` 时删除该 session 的内部状态；terminal consume 则把匹配的 `PUBLISHED` 原位替换为 `CONSUMED_TERMINAL`，以阻止同一 terminal run 因重复通知复活。`CONSUMED_TERMINAL` 不进入 public contract、snapshot、delta、日志或持久化，只在新 run 覆盖、session delete 或进程退出时消失。没有 subscriber、没有待注册 connection、没有任何内部状态、没有 bootstrap 或 rederive 工作的空 scope 可以被移除。每个 subscriber 的未发送 delta 使用 `Map<SessionId, SessionActivityEntry>` 合并为该 session 最新公开值，而不是维护无界事件队列。

`activityId` 使用可注入 id factory 生成，产品默认使用带固定安全前缀的 UUID。它只存在于当前进程内 `PUBLISHED` terminal entry，不进入 `CONSUMED_TERMINAL`、数据库、timeline、conversation、日志、metric、URL 或浏览器持久化存储。

#### 触发与重新派生

`agent-app` 在现有 `runTimelineEventListeners` 中增加一个同步 mapper。只有带完整可信 scope 坐标且 `persistence="PERSISTED"` 的以下事件会传给 activity service：

- `REQUEST_ACCEPTED`
- `USER_INPUT_REQUIRED`
- `USER_INPUT_RECEIVED`
- `USER_INPUT_TIMEOUT`
- `USER_INPUT_CANCELED`
- `REQUEST_COMPLETED`
- `REQUEST_FAILED`
- `REQUEST_CANCELED`
- `REQUEST_SUPERSEDED`

mapper 完成 event type、persistence 与完整可信坐标过滤后，只通过 `SessionActivityService` owner 对象调用 `invalidateSessionActivity(...)`；composition 不提取或传递未绑定的 class method。Activity service 按 scope + session 合并 invalidation，并在 microtask 中异步读取当前事实。因而 `agent-session` 不解释 runtime event vocabulary，大量 model/capability delta 不进入 activity 计算，同一 session 的紧邻 lifecycle 通知也不会触发并行 N 次读取。

每个 session 的“当前有效 run”固定为 `RequestRunStoreGateway.loadSessionLaneSnapshot(...)` 返回的 `latestRun`，即该 lane 最新 accepted attempt；它不等同于任意仍在 executing、queued 或 pending-input 状态的旧 run。每个 session 的唯一派生算法为：

```text
latest := RequestRunStoreGateway.loadSessionLaneSnapshot(scope, sessionId).latestRun

if latest 不存在:
  return NONE

pending := PendingInputStoreGateway.loadActivePendingInput(scope, sessionId)

if pending.status == PENDING and pending.requestRunId == latest.runId:
  return WAITING_FOR_INPUT(pending.kind)

if latest.status 是非终态
   or latest.terminalCommitState 是 NOT_STARTED、PENDING、RETRYING:
  return RUNNING

if latest.status == FAILED and latest.terminalCommitState == COMMITTED:
  return terminal(UNREAD_FAILURE, latest.runId)

if latest.status == COMPLETED and latest.terminalCommitState == COMMITTED:
  return terminal(UNREAD_RESULT, latest.runId)

return NONE
```

same-session latest-submit replacement 允许旧 run `R1` 仍处于 `EXECUTING` 时，较新的 `R2` 已被持久化为 `ACCEPTED/QUEUED`。该窗口内 `R2` 是 `latestRun`，因此 activity 派生为 `RUNNING`；即使 `R1` 仍有旧 active pending input，也不得把该 session 显示为等待回答旧 run。Runtime 继续负责让 `R1` 到达 safe boundary 并 terminal commit，再 dispatch `R2`；activity service 不解释或改变该调度过程。

`terminal(status, sourceRunId)` 按当前内部状态处理：

- 当前为相同 `sourceRunId` 的 `CONSUMED_TERMINAL` 时保持该内部状态，对外仍为 `NONE`，不生成 `activityId` 或 delta；
- 当前为相同 status 与 `sourceRunId` 的 `PUBLISHED` terminal entry 时复用原 `activityId`；
- 其他情况生成新 `activityId` 并写入新的 `PUBLISHED` terminal entry。

新 run acceptance 派生出的 `RUNNING` 或 `WAITING_FOR_INPUT` 会覆盖旧 `CONSUMED_TERMINAL`；该新 run 后续提交 terminal 时再生成新的未读活动。因此“同一已消费 run 不复活”和“后续新 run 仍产生未读”由同一个 per-session 状态转换表达，不需要独立 waterline map。状态发布只比较 public 判别联合值；相同值不广播。

`PendingInputStoreGateway` 不可用或读取失败时不得把可能存在的 pending input 降级为 `RUNNING`。该 scope 被标记为需要 resync，并关闭 live subscriber；下次连接在读取成功前不发送 snapshot。

#### Bootstrap 与 snapshot-to-live 交接

scope 首次被订阅时执行一次 bootstrap。它通过 `SessionStoreGateway.listSessions(...)` 使用固定内部页大小遍历该 Owner + Agent scope 的全部 session，不使用 Web session list、不读取 frontend 已加载页，也不建立 activity-specific 搜索。只对 `hasInFlightRequest=true` 的 session 读取 active pending input，并 seed `WAITING_FOR_INPUT` 或 `RUNNING`；terminal session 不 seed 未读。

bootstrap 开始后，timeline listener 仍可接收新 invalidation。服务只在 bootstrap 生命周期内记录发生变化的 session；bootstrap merge 跳过这些 session，并由正常 rederive drain 读取其最新 facts。由于既有 `listSessions(...)` 是 offset pagination，bootstrap 期间的 request acceptance 或 session delete 可能改变目录成员与后续页边界；发生任一 invalidation 时，当前扫描结果被丢弃并从 offset 0 重扫，直到有一轮完整扫描期间目录未再变化，再提交 seeds。bootstrap 成功后删除该临时集合与目录变化标记，不为所有 session 长期保存 revision 或 touched marker。

连接交接顺序固定为：

1. `ensureScope(...)` 返回后、任何 `await` 之前同步取得一个待注册 connection lease；空 scope 回收必须等待该计数归零。
2. 等待 scope bootstrap 与待处理 rederive 成功。
3. 创建 subscriber，并在同一同步调用段将其注册到 scope、释放待注册 lease。
4. 从当前 map 复制全部 `PUBLISHED` entry，忽略 `CONSUMED_TERMINAL`，形成第一条且唯一一条 `SNAPSHOT`。
5. 开始 yield snapshot。
6. 将注册后发生的变化按 session 合并为 `DELTA` 并继续 live delivery。

步骤 3 与步骤 4 之间没有 `await`，Node event loop 不能插入另一个 rederive completion，因此不存在 snapshot 读取后、subscriber 注册前的丢失窗口。待注册 lease 防止最后一个旧 subscriber 在新 connection 等待 bootstrap/drain 时删除其即将注册的 scope。subscriber 始终先 yield snapshot，再 drain pending delta。

Frontend 为每次 connection attempt 分配递增的内存 generation。只有当前 generation callback 可以写 store；`SNAPSHOT` 执行全量替换，`DELTA` 执行 session-keyed merge，`NONE` 执行删除。连接中断不保存 cursor；重连始终重新执行上述协议。

#### Subscriber 合并与 NONE 规则

Activity service 为每个 subscriber 维护已投影的非 `NONE` session 集合；只有 `PUBLISHED` 参与投影：

- 非 `NONE` 变化覆盖该 session 尚未发送的 pending delta。
- session 在 delta 发出前又回到 `NONE`，且 subscriber 从未接收其非 `NONE` 值时，pending delta被删除，不发送无意义 `NONE`。
- subscriber 已通过 snapshot 或 delta 接收非 `NONE` 后，后续 `NONE` 必须保留并发送。
- 同一 session 的多个快速变化允许收敛为最后状态；该协议表达当前注意力 truth，不承担 timeline replay。

这种 session-keyed 合并把 subscriber buffer 的基数限制为 scope 的实际 session 数，不需要 `feedSequence`、per-session revision 或独立 queue limit。Web transport 自身的 socket/fetch backpressure timeout继续生效；写入失败关闭连接，由 frontend 重新 snapshot。

#### 删除与终态消费

`composeSessionServicesLayer(...)` 先创建 `SessionActivityService`，再把其 `invalidateDeletedSession(...)` 作为 implementation dependency 注入 `UserSessionService`。`deleteSessionCascade(...)` 返回 `DELETED` 后才调用 invalidation；冲突或 not-found 不调用。Invalidation 从 map 删除该 session 的任一内部状态，并仅向已知该 session 为非 `NONE` 的 subscriber排入 `NONE`。该回调不得抛出到 delete 主路径。

终态消费通过 `RuntimeSessionActivityPort` 进入 activity service。服务先用 `SessionStoreGateway.loadSession(...)` 校验可信 Owner + Agent + Session scope，再检查当前内部状态。只有当前为 `PUBLISHED` terminal unread、activityId 相等且 `SessionActivityService` 私有的 `sourceRunId` 与 `observedRunId` 相等时，才把它替换为 `CONSUMED_TERMINAL(sourceRunId)` 并广播 `NONE`。同一 terminal fact 后续重新派生时命中该消费抑制，保持对外 `NONE`。合法 scope 内的 stale、重复、activityId不匹配、run不匹配或当前已是 `CONSUMED_TERMINAL` 的请求直接成功返回，不写任何 observation fact。

Frontend activity client 对同一 `sessionId + activityId + observedRunId` 只允许一个 in-flight consume。成功后等待 backend `NONE` 或后续 snapshot 清理，不自行构造 backend truth；失败后不清除 activity store，也不进行紧密循环重试。visibility、conversation reload、activity delta或 connection generation 后续变化可以再次触发条件判断。

#### ER Web transport

`WebChannelDependencies` additive 增加 optional `sessionActivities?: RuntimeSessionActivityPort`，保持 `registerWebChannel(...)` 的既有调用方 source-compatible。通用 route plugin 只有在该 dependency 存在且 route whitelist允许时才注册 Activity routes；缺失时不注册，也不为 Activity 返回伪成功或空 snapshot。

`WebChannelDependencies` 是 `agent-channel-web` 的 `registerWebChannel(instance, dependencies)` composition 输入，列出路由实现可调用的 runtime/session/identity 等 port；它不是全局依赖注册表，也不创建领域 owner。这里所谓“注册”是 Fastify 根据 dependency 与 route whitelist挂载HTTP route和WebSocket path。

正式产品 composition 把 `sessionActivities` 作为 `WebChannelRegistrationContext` 的必需启动依赖，由 session services layer 创建并在进入 Web registration precedence 之前完成缺失校验。Builtin Agent Web 的 `DEFAULT_WEB + no custom registration` 与 `LOCAL_CONFIGURED_AUTH` 两条 ER 路径分别由 `registerTrustedIdentityWebChannel(...)`、`registerLocalConfiguredProtectedWebChannel(...)` 注入该 port并自动注册三个 Activity endpoints。

稳定的 `DEFAULT_WEB + custom webChannelRegistration` precedence 保持不变：`agent-app` 只调用 custom registration，不得额外调用 builtin registration。Custom registration会通过必需的 `WebChannelRegistrationContext.sessionActivities`取得 Activity port；如果该 custom surface 托管 Agent Web 浏览器页面与 runtime bootstrap，它必须把该 port传给自身的 `registerWebChannel(...)` 或等价严格 route registration，并暴露相同三个 Activity endpoints。如果 custom surface不托管 Agent Web浏览器页面，则不属于本 change 的浏览器 ER surface，无需暴露 Activity endpoints。`registerIrWebChannel(...)`明确不注入，并继续通过 `IR_ROUTE_WHITELIST` 保证三个 Activity endpoints不存在。optional 只属于通用 `agent-channel-web` package兼容边界，不表示 builtin Agent Web ER 可降级为缺失 Activity route。

Fastify 增加：

- `GET /api/v1/session-activities/stream`：不接受 query；解析 trusted identity 后迭代 `streamSessionActivities(...)`，以 SSE data frame 序列化 activity message。
- `POST /api/v1/sessions/:sessionId/activity/consume`：严格校验 path 与 `{ activityId, observedRunId }`，委托 consume，成功统一返回 `204`。

现有 WebSocket upgrade handler 改为单一 path dispatcher：原 session path继续进入 session detail stream，新 `/api/v1/session-activities/ws` 进入 activity stream。两条分支复用 handshake、client close/ping、server text frame、15 秒 backpressure 和 safe close helper；activity path拒绝全部 query。不得再注册第二套相互竞争的 `upgrade` listener。

SSE 与 WebSocket 只改变 framing，不改变 message、snapshot、delta、scope 或错误语义。Activity message 不进入 `StreamEnvelope`，不使用 session timeline sequence，也不被 session stream replay。

#### Frontend 独立 projection

`frontend/agent-web` 新增独立 `sessionActivityStore`，只保存 `entriesBySessionId` 和当前 connection generation。它不并入 `sessionStore`、`requestStore` 或 `conversationStore`，因此 loaded sessions、请求控制和 conversation projection 不会反向限制 activity scope。

新增严格 parser 对 `SNAPSHOT` 与 `DELTA` 执行判别联合校验。底层 transport primitive 增加可选 decoder/protocol-error close 能力，由 activity controller 提供严格 decoder；现有 session detail stream 保持原行为和 contract。对 activity connection，malformed JSON、未知字段、非法 conditional field、重复 snapshot 或 snapshot 之前的 delta 都必须在修改 store 前关闭当前 generation 并重连，不能忽略非法帧或部分接纳。

新增 shared `SessionActivityConnectionController`，在 local、immersive 与 collaborative 的主 app shell 各挂载一次，且不挂载到 knowledge-only 或其他辅助 React root。它复用现有 runtime `transportKind` 和底层 SSE/WS connection primitive，使用固定 activity paths，不提供 cursor、requestId 或 runId。session route 切换、列表分页和 History Popover 开关不得重建该 controller。

新增共享 `SessionActivityTrailingSlot` 与唯一 activity selector/formatting contract。它只接收 session id、当前 activity entry、active/visible 抑制结果、是否支持行操作、action-visible 状态和宿主选择的 trailing layout mode，拥有五态图标/tag、i18n 与 accessibility 语义；宿主不得复制状态优先级、图标选择或未读判断。默认 layout mode 保留固定宽度槽位；Sidebar intrinsic mode 使用当前内容实际宽度并以同一 shared 常量作为最大宽度，不改变状态语义。

Sidebar 与 `SessionHistorySearchDialog` 通过 `SessionHistoryEntryRow` 使用 shared slot，immersive 右布局 `CardList` 的 session trailing render和 collaborative `ai-agent-piu-history-row` 也使用同一 slot。四个用户可见入口保留各自既有导航、删除、搜索和壳层布局；SearchDialog继续传入“不支持行操作”，pointer hover或keyboard focus不得因此隐藏时间/activity或显示More。这样复用活动语义而不为本 change强制重写三种不同的整行 DOM。

支持行操作的现有右侧 trailing content 改为同时处理 pointer hover、focus-within 与 Dropdown/menu open state；操作显示条件是三者任一成立。固定槽位和 intrinsic 最大宽度使用单一 shared 常量，按最长 locale-backed waiting tag 留出上限。local/immersive 左侧 Sidebar 行把 trailing content 作为右对齐的正常 flex item，以时间、marker、tag 或 More 的当前实际宽度参与布局；标题占据剩余宽度，并通过 `overflow:hidden`、单行显示和 `text-overflow:clip`直接裁切，不显示省略号。该路径不使用固定 140px 预留、绝对定位、渐变或背景遮罩；状态切换允许标题的可见裁切点随当前 trailing content 宽度变化，但不得改变行宽、右对齐位置或产生水平溢出。`SessionHistorySearchDialog`、immersive 右布局 CardList 与 collaborative History Popover 保留各自原有 row shell 和固定槽位策略。More button或菜单项处理 `Enter`/`Space` 时必须阻止行级 keyboard activation，不能在打开菜单的同时触发 session navigation。不支持行操作的SearchDialog行始终显示当前时间或activity状态。

collaborative `HistoryButton` 在 `HistoryOutlined` 外使用 locale-backed蓝色 `Badge` dot。聚合值来自完整 activity store，而不是当前 Popover 已加载 sessions：

```text
hasAttention :=
  存在一个非 NONE entry
  且不是(entry.sessionId是active session且isConversationSurfaceVisible=true)
```

当 active session 的 conversation surface不可见时，该 session 仍参与聚合；当 conversation surface是用户正在查看的主内容时，本地排除。该排除只表示用户注意力当前位于该会话，不证明terminal presentation已经成功投影，也不消费backend unread。打开 History Popover、hover/focus trigger或点击图标不改变 activity store，不提交 consume，蓝点只在上述聚合值变为 false时消失。首版不显示计数，也不按 WAITING/FAILURE/RESULT 改变入口颜色。

#### Conversation surface 注意力与终态查看判断

shared `ChatPageCore` 增加 `isConversationSurfaceVisible` 输入。该值有两个 frontend view-state用途：active session为true时，本地抑制该session的列表marker并从collaborative History聚合中排除；同时它也是terminal activity consume observer的必要查看证据。前一种本地抑制不要求terminal presentation成功、不修改activity store或backend unread；后一种消费还必须同时满足document可见和匹配terminal presentation成功。该值不控制 route、conversation渲染、detail connection、activity connection或backend状态。

- local：当前 ChatWorkspace 的 conversation surface 是主显示内容时传入 true。
- immersive 左布局：当前 content view 显示 conversation时传入 true。
- immersive 右布局：只有 `panelView === "conversation"` 且没有 Memory、History、Favorites或custom panel覆盖/替换conversation时传入 true；conversation React tree仍 mounted但被 `CardList` 覆盖时必须传入 false。
- collaborative：只有主 conversation panel已展示、未 minimized且未被custom panel替换时传入 true。

当前active且`isConversationSurfaceVisible=true`的session行只在本地隐藏activity marker，collaborative History聚合也本地排除它；即使conversation或terminal presentation加载失败，这两个本地注意力提示仍可暂时抑制，但activity store与backend unread必须保留。用户切换离开、宿主最小化或其他面板覆盖使surface不可见后，该session必须重新按activity store显示marker并参与History聚合。

终态消费把该值与 `document.visibilityState === "visible"` 和匹配terminal presentation联合判断。active route但conversation surface不可见时不得消费terminal unread，并且collaborative History入口聚合必须仍包含它。

终态查看 observer 只消费 shared conversation projection 已认定为 latest effective attempt 的 terminal presentation。Cold open 或 activity reconnect snapshot 已带 terminal unread 时，observer 等待本次 conversation load 成功并形成 terminal presentation；live run 时，observer等待该 attempt 的 terminal transition进入 projection。只要该匹配 terminal presentation 已成功投影，session 仍 active，且 document/host surface 可见，就视为已查看；当前滚动位置、anchored mode 或 terminal block 是否与 viewport 相交不再构成额外门槛。仅有旧 terminal Turn、加载中状态、失败状态或 transport terminal frame不构成证据。

observer 在条件成立的同一 render generation 捕获当前 activityId 与 terminal presentation 的 runId，再作为 `observedRunId` 提交 consume。activity entry 本身不暴露 runId；frontend 只能从已成功呈现的 conversation projection 取得该坐标。若两条连接乱序导致旧 terminal仍在屏幕上，backend 的 sourceRunId匹配会把请求作为no-op；若提交期间 activity store 已变为其他 activityId，activityId匹配也保证它不能清除新活动。该 observer 只负责报告查看证据，未读 truth 仍由 backend activity service 决定。History/Favorites/Memory/custom panel关闭、collaborative面板恢复或document重新visible时，observer重新评估相同条件；离面清理已中止的同坐标请求不得阻止恢复可见后的新 attempt，旧 attempt完成也不得清理或覆盖新 attempt 的in-flight guard；不使用timer或紧密重试。

典型 A/B 旅程为：用户在 A 提交新 run `R2` 后切换到 B，A 不再是 active session，因此 A 的 observer 不会消费；当 `R2` 在后台完成时，A 保留新的 terminal unread 并在列表显示 marker。只有用户随后重新打开 A，匹配 `R2` 的 terminal presentation 成功投影且 document/host 可见后，才消费该活动。此前看过 A 的旧 run 不会替代本次 `R2` 的查看证据。

#### 备选方案

- 把 activity 字段加入 `GET /api/v1/sessions`：未选择。它会把实时范围绑定到分页和搜索窗口，并迫使列表刷新承担订阅职责；既有 `latestRunStatus` 与 `hasInFlightRequest` 保持兼容 read model即可。
- 为每个 session 建立 detail stream：未选择。连接数随 session 数增长，并把大量 conversation/timeline 数据用于只需一个状态的列表提醒。
- 新增 observation/activity 数据表：未选择。当前 local single-instance release只要求在线多端一致和进程内重连恢复；持久化会引入 retention、迁移、CAS、跨设备 read model 与重启后历史未读复活问题。
- 只在 frontend 保存已读：未选择。两个在线设备会产生不一致，frontend reload也无法区分已查看和未查看。
- 只用 `activityId` 消费、不提交 `observedRunId`：未选择。activity connection 与 detail connection 独立到达，frontend 可能已经收到新 `activityId`，但屏幕仍是旧 run 的 terminal presentation；双坐标只复用既有 runId，不新增 wire activity runId、revision 或持久化事实。
- 为已消费 terminal 另建 `terminalWaterlineBySessionId`：未选择。它会让同一 session 同时维护公开 activity 与平行水位。单一 `PUBLISHED | CONSUMED_TERMINAL` 内部状态已经能表达“同 run 不复活、新 run 可覆盖”，并保持每个 session 一个状态。
- 使用 `feedSequence`、per-session revision 或 resume cursor：未选择。协议只投影当前值；连接内有序 delivery、首帧替换 snapshot、session-keyed delta与 stale connection generation guard 已能收敛。
- 新建 `agent-contracts/web`：未选择。当前 contract map 没有该 subpath，且 stable architecture 明确 public Web DTO 归 `agent-channel-web` schema/projection。
- 只实现 SSE：未选择。现有 frontend bootstrap 已冻结 `SSE | WEBSOCKET`，同一 activity语义必须复用 `transportKind`；实现只新增一个语义 owner，两个 framing adapter。
- 强制三个宿主重写为同一个完整 session row DOM：未选择。当前 Sidebar/SearchDialog、immersive右布局CardList和PIU History Popover拥有三种不同导航/操作壳层；共享 `SessionActivityTrailingSlot` 与selector已经能冻结四个用户可见入口的同一业务语义，整行重写会扩大无关UI回归范围。
- 把 `WebChannelDependencies.sessionActivities` 设为通用必填字段：未选择。它会破坏大量既有 `registerWebChannel(...)` 调用方；optional package dependency加ER composition启动校验同时满足源码兼容和产品必装。

#### 质量属性影响

##### 安全

- 所有读取、订阅和消费都携带可信 Owner Scope 与 Agent Scope；Web body不接受 scope。
- activity snapshot只包含 session id、状态、pending kind 和 opaque activityId，不包含 prompt、模型输出、answer、failure reason、title、路径、credential 或 raw event payload。
- activityId 不进入日志、metric、trace、URL 或持久化。跨 scope consume在比较 activityId 前先 fail closed。
- IR whitelist 的 negative contract test证明外部机机 surface不能访问本 feature。

##### 性能与容量

- lifecycle listener 只做同步入队；per-session invalidation合并后异步读取，不阻塞 terminal commit 或 detail stream。
- 进程 map对每个实际 session 最多保留一个内部状态，`PUBLISHED` 与 `CONSUMED_TERMINAL` 互斥；不另设更小的 activity quota。subscriber pending map同样按 session合并，两个基数都不超过实际 session 数，避免按事件数无界增长。
- bootstrap 使用内部固定页遍历 scope全部 session，只对 in-flight session读取 pending input。它每 scope每进程至多成功执行一次，与 UI分页次数无关。
- 不新增 DB表、写放大或轮询；稳态没有活动变化时不发送 application message。

##### 可靠性与恢复

- snapshot注册顺序关闭 snapshot/live race；重连全量替换避免 frontend缓存残留。
- stale consume由 activityId与observedRunId双重匹配保护；匹配消费转为同 session 的 `CONSUMED_TERMINAL`，使重复 consume和同一 terminal fact重新派生都保持幂等。
- rederive、bootstrap、serialization或 backpressure失败关闭受影响连接并重连，不把未知状态降级为 `NONE`。
- frontend activity malformed JSON 或协议顺序/shape错误关闭当前 generation并重连，非法帧不进入 store；现有 detail stream transport语义不受影响。
- activity observer失败不影响 request lifecycle、pending input、terminal commit或 session delete。
- 进程重启不恢复 terminal unread是显式降级；durable conversation和 terminal facts不受影响。

##### 可维护性

- 状态派生只有 `SessionActivityService` 一个 owner；channel、transport和 frontend都不复制 run-status决策。
- public Web schema留在现有 channel边界；不新增 contract subpath、gateway port、Record、table或 frontend session DTO字段。
- current session抑制、slot交互和可见性观察属于 frontend view state，和 backend truth分离。

##### 可测试性

- id factory、clock之外不需要时间语义；核心派生由固定 gateway fixtures确定。
- activity service、runtime-facing adapter、Web route、frontend parser/store、row projection和 visibility observer均可独立测试。
- 两种 transport使用相同 message fixture，四个用户可见列表入口使用相同 activity/trailing-slot fixture，避免以 mode-specific快照替代共享语义验证。

##### 审计与可追溯性

- activity状态可追溯到 durable RequestRun、pending input与 terminal timeline fact，但 activityId和 consume本身不形成 durable audit record。
- safe diagnostic只记录阶段、safe reason code与 transport kind，不记录 owner、session、activityId、prompt、结果或 pending answer。
- 如果未来要求“谁在何时查看”可审计，必须新开 observation persistence change；本 change不得用日志冒充审计。

## 验证策略（Verification Strategy）

- Contract 层验证判别联合、conditional fields、256字符 activityId上限、未知字段、Owner/Agent body注入、严格 consume body和 additive export。
- Session unit/contract层用 durable lane与 pending fixtures覆盖优先级、新 run覆盖旧未读、旧事件迟到、重复 terminal activityId、已消费同一 terminal run不复活、已消费后新 run完成产生新未读、取消/supersede、delete、consume幂等、bootstrap terminal不 seed、重启恢复 in-flight和 scope隔离。
- 并发与恢复 characterization覆盖 bootstrap期间变化、offset页边界在目录变化后的全量重扫、旧 subscriber断开与新 subscriber注册重叠、snapshot第一帧、snapshot替换、delta merge、NONE规则、无 subscriber期间保留、rederive失败关闭和 subscriber per-session合并。
- Web integration分别覆盖 SSE与WebSocket首帧/增量/关闭、consume 204、safe error、backpressure、既有 session detail stream并存和 IR route不存在。
- Composition/architecture验证 `agent-channel-web` 不导入 `agent-session`、没有 `agent-contracts/web`、listener在 runtime recovery前可用、delete callback只在 durable success后触发、无新增 gateway table/Record；同时覆盖两个builtin Agent Web ER路径自动注入、custom Web只收到必需port而不被隐式追加builtin registration，以及托管Agent Web的custom fixture显式注册Activity endpoints。
- Frontend unit/component验证 malformed JSON与协议错误 fail closed/reconnect、generation guard、store与 session pagination解耦、共享 trailing slot五态呈现、active可见抑制、hover/focus/menu稳定、More keyboard activation隔离、collaborative History聚合蓝点、i18n与 accessibility。
- Frontend integration/e2e覆盖 local/immersive Sidebar、SessionHistorySearchDialog、immersive 右布局 History CardList、collaborative History Popover，当前 session Request Execution Stream与全局 Activity连接并存；覆盖SearchDialog显示同一activity但不显示More、History/Favorites/Memory/custom panel时不消费、conversation加载失败时保留backend unread并在切换离开后恢复marker/History dot、恢复conversation surface后成功消费、当前前台会话不受滚动位置或anchored mode额外限制、A提交新run后切换B且A完成时显示未读，以及两客户端同步清除。
- 回归验证保留 session list分页/搜索、rename/delete、request control、detail stream resume、pending-input UI和三宿主 build行为。

## 长期基线刷新计划

- stable spec：新增 `openspec/specs/cross-session-activity-awareness/spec.md` 并合并本 change 的完整行为契约。
- Function：新增 `FN-1.21 感知跨会话活动` 叶子文档和功能树导航，按主规格的 Function 变更汇总写入描述、前置条件、输入、输出、处理过程、结果、接口、量化指标、覆盖特性与主规格。
- Feature：刷新 `F-2.4 查看请求状态`，补充跨会话识别运行、等待输入、未读失败和未读结果的用户价值，并链接新增 Function。
- overview：补充跨会话活动感知的产品问题、范围和 local single-instance 恢复限制。
- architecture：刷新 `request-status-visibility.md`、`web-stream-transports.md` 与 `conversation-ui-state.md`，分别补充事实派生、snapshot-to-live/连接隔离及四个列表入口的共享呈现边界。
- modules：刷新 `agent-contracts.md`、`agent-session.md`、`agent-channel-web.md`、`agent-app.md` 与 `agent-web.md` 的契约、owner、依赖和验证入口。
- ADR：无；沿用既有 local single-instance、transport 与 owner 决策。
- spec-to-design-map：增加 `cross-session-activity-awareness` 到上述 architecture、module 和验证入口的导航。

## 风险与取舍（Risks / Trade-offs）

- 进程重启会丢失尚未消费的 terminal reminder。缓解是 durable conversation仍可查看，且规格明确禁止把全部历史 terminal重新标未读；跨重启未读需要未来持久化 change。
- scope包含大量 in-flight session时，首次 bootstrap会产生分页读取与 pending-input查询。缓解是每 scope只成功执行一次、只查询 in-flight pending，并复用 session cardinality而不增加独立更低上限。
- 已消费 terminal 的进程内抑制状态在最坏情况下可接近该 scope 的 session 数。该成本已由产品接受：它与 session cardinality同阶、每个 session只有一个内部状态且没有平行 waterline；session delete、后续新 run或进程退出会清理或覆盖该状态。
- Activity与 detail是两条独立连接，到达时序不同。缓解是 frontend只从 shared projection取得已呈现 terminal runId，并与当前 activityId共同提交；backend用 activityId与`SessionActivityService`私有sourceRunId双重匹配，不得因任一 transport单独到达而清除。
- collaborative History蓝点聚合所有非 `NONE` activity时，后台 `RUNNING` 也会持续显示蓝点。该选择用于保证收起列表时仍能发现后台会话活动；入口不编码状态优先级，用户打开列表后查看具体行状态。
- subscriber按 session合并可能跳过用户未曾看到的中间状态。该取舍符合“当前注意力状态”而非 timeline replay的定位；新 run已明确覆盖旧未读，durable过程仍由 session detail/history提供。
- 不记录 durable consume evidence，无法回答重启前由哪台设备查看。该限制是避免无明确审计需求时引入 observation表的直接取舍。

## 迁移与回滚（Migration / Rollback）

没有数据库迁移。部署时必须让 backend public contract、activity service、ER routes和 frontend artifact在同一兼容发布中可用；推荐先部署可忽略的新 backend端点，再启用 frontend controller。旧 frontend不会调用新端点，现有 session list与 detail stream保持兼容。

如果新 frontend短暂连接旧 backend，activity controller必须在Activity endpoint返回404、503或连接不可用时降级为无活动标识且不得影响session列表、打开会话或Request Execution Stream；重试使用现有有界reconnect/backoff策略，不能形成紧密循环。backend可用后的下一次连接必须以新SNAPSHOT全量重建activity store。完整产品发布仍以backend与frontend artifact一致为验收条件。

回滚只需移除 frontend controller/呈现和 backend activity routes/service wiring。进程内 activity map随进程退出丢弃，不需要数据清理；既有 session list字段、conversation、RequestRun、pending input和 timeline均保持可用。

## 需群内确认

已确认（2026-07-28，当前会话用户对第 4 项契约确认问题回复“OK”）：

- `agent-contracts/session` additive新增 `SessionActivityStatus`、判别联合、notification/query/consume与 `SessionActivityPort`。
- `agent-contracts/runtime` additive新增 channel-facing `RuntimeSessionActivityPort`；它只注入可信 identity，不暴露客户端 Agent Scope。
- public Web DTO继续由 `agent-channel-web`拥有；不新增当前架构不存在的 `agent-contracts/web` subpath。
- 不新增 `RunStatus`、`PendingInputKind`、timeline vocabulary、gateway persistence contract、activity/observation表、feedSequence或 per-session revision。
- `refine-ts-session-activity-stream-boundary` 先冻结Request Execution Stream与Session Activity Projection Stream边界；本change只实现其授权的唯一Activity例外。
- `WebChannelDependencies.sessionActivities` 对通用package调用方保持optional；正式composition的`WebChannelRegistrationContext`在启动期强制携带该port。两个builtin Agent Web ER路径自动注入，托管Agent Web的custom Web registration显式注册等价Activity endpoints且不得改变既有custom-over-builtin precedence；IR不注册Activity routes。

## 待确认问题（Open Questions）

无。
