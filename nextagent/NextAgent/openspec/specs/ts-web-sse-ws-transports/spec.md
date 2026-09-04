# ts-web-sse-ws-transports Specification

## Purpose
定义 TS Web channel 中 SSE 与 WebSocket 在同一明确流类型内的等价投影，并冻结 Request Execution Stream 与 Session Activity Projection Stream 的协议隔离、bootstrap transport selection、输入校验、safe diagnostics、failure handling 和验证要求，确保 transport 选择不改变 Runtime lifecycle、canonical timeline 或跨会话 Activity 语义。

## Function

- **所属 Function**：`FN-1.1 查看会话消息流`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: 等价 Web Stream Transport
TS Web channel MUST 在同一明确流类型内提供等价的 SSE 和 WebSocket transport。

对于 Request Execution Stream，两种 transport MUST 使用核心契约定义的同一 `StreamEnvelope`、同一 `StreamEventType`、同一 session-scoped sequence、同一 terminal event 语义、同一 safe error boundary 和同一 redaction policy，并且 MUST 复用 `ts-run-status-visibility` owning 的共享 projection service。Transport 选择 MUST NOT 改变 runtime lifecycle、RequestRun status、canonical timeline、latest-request 规则、`RuntimeSessionPort.streamEvents(request)` 语义或 terminal commit 行为。

对于 `cross-session-activity-awareness` capability 定义的 Session Activity Projection Stream，两种 transport MUST 使用同一严格 activity message、同一 Owner Scope + Agent Scope、同一 snapshot-to-live 交接、同一失败关闭和无 cursor 重连语义。它们 MUST NOT 使用 `StreamEnvelope`、`StreamEventType`、timeline sequence、`RuntimeSessionPort.streamEvents(...)` 或 Request Execution Stream resume cursor，且 MUST 只注册在浏览器 ER surface；IR route whitelist MUST NOT 暴露 Activity SSE、Activity WebSocket 或 consume route。Request Execution Stream 与 Session Activity Projection Stream MUST 维持独立连接和独立协议状态；任一连接的建立、关闭、重连或失败 MUST NOT 建立、关闭、推进或清空另一类连接。

**需求类别**：功能性需求

#### Scenario: 同一请求的 SSE 和 WebSocket 输出等价
- **WHEN** 同一个 RequestRun 产生 canonical timeline events
- **THEN** SSE 和 WebSocket MUST 为 stream-visible events 投影相同的用户可见事件序列
- **AND** 两种 transport MUST 暴露相同的 terminal event type 和 safe failure 语义
- **AND** transport-specific framing、heartbeat 或 connection close 行为 MUST NOT 改变 `StreamEnvelope` payload 语义

#### Scenario: Transport 不拥有执行事实
- **WHEN** Web channel 通过 Request Execution Stream 发送 stream events
- **THEN** Web channel MUST 将 runtime timeline 或 runtime status 投影为 `StreamEnvelope`
- **AND** Web channel MUST NOT 创建私有 RequestRun status、私有 terminal state 或与 runtime 竞争的 lifecycle facts
- **AND** transport connection、disconnect 和 heartbeat diagnostics MUST NOT 被记录为 canonical execution timeline facts

#### Scenario: Session Activity 的 SSE 与 WebSocket 输出等价
- **WHEN** 同一可信 Owner Scope + Agent Scope 通过 SSE 或 WebSocket 打开 Session Activity Projection Stream
- **THEN** 两种 transport MUST 先发送语义相同的完整 activity snapshot，再发送语义相同的 session-keyed activity delta
- **AND** transport-specific framing、heartbeat 或 connection close 行为 MUST NOT 改变 activity message、scope 或消费语义
- **AND** 两种 transport MUST NOT 为 activity message 增加 Request Execution Stream 的 envelope、sequence、cursor、request filter 或 run filter

#### Scenario: 两类连接并存且互不驱动
- **WHEN** 同一浏览器 app instance 同时保持一个 Session Activity Projection Stream 和当前会话的 Request Execution Stream
- **THEN** Activity 连接 MUST NOT 触发、替代或关闭当前会话的 execution stream
- **AND** 当前会话切换、execution stream resume 或单个 run terminal MUST NOT 重建或完成全 scope Activity 连接
- **AND** 任一连接失败 MUST 只按自身协议恢复，MUST NOT 清空或伪造另一类流的客户端状态

#### Scenario: 非 Activity 的私有 Stream 不获得例外
- **WHEN** Web channel 尝试通过 SSE 或 WebSocket 投影既不属于 Request Execution Stream、也不属于 Session Activity Projection Stream 的用户可见状态
- **THEN** 系统 MUST NOT 把该状态作为新的私有 stream family 发送
- **AND** 新 stream family MUST 先通过独立 OpenSpec contract refinement 获得授权

### Requirement: Stream 触发与生命周期挂接
Web stream delivery MUST 由针对 Web channel 的显式用户动作或客户端动作触发，并挂接到已经被接受或可见的 request lifecycle。Request submission MUST 进入 runtime command boundary。Stream connection 或 subscription MUST 异步读取并投影 canonical timeline events，MUST NOT 驱动 execution progress。

#### Scenario: 用户提交请求后连接 stream
- **WHEN** 用户通过 Web channel 提交请求，并为该请求打开 SSE 或 WebSocket stream
- **THEN** request acceptance MUST 由 runtime command boundary 处理
- **AND** stream delivery MUST 从 authenticated owner 可见的 canonical timeline 和 runtime status 开始
- **AND** stream projection MUST 相对于 runtime execution progress 保持异步观察语义

#### Scenario: WebSocket stream subscription 不驱动 runtime
- **WHEN** WebSocket 收到 stream subscribe、connection close 或 heartbeat 等 transport 动作
- **THEN** WebSocket adapter MUST 只执行 stream subscription、delivery 或 close 处理
- **AND** WebSocket adapter MUST NOT 直接修改 RequestRun、pending input、session history 或 terminal state
- **AND** 稳定 WebSocket transport MUST NOT 定义 cancel、answer pending input 或其他 lifecycle-changing command

### Requirement: Web runtime bootstrap transport 选择
TS Web channel MUST 在 product stream connection 前向 browser client 暴露 channel-safe runtime/bootstrap config projection。Projection MUST 包含 `transportKind`，且值必须精确为 `SSE` 或 `WEBSOCKET`。`transportKind` MUST 从 trusted app/channel configuration 派生，MUST NOT 从 client query、request body、localStorage、HTML runtime script injection、model output、capability input/result、user metadata、owner scope 或 agent scope 派生。Frontend product paths MUST 从该 backend bootstrap projection 选择 SSE 或 WebSocket。Product paths MUST NOT 使用 build-time `VITE_TRANSPORT_KIND`；dev/mock fallback 只有在显式声明后才 MAY 使用该 build-time value。

#### Scenario: Backend 在 stream connection 前投影 transport kind
- **WHEN** browser client 启动 Web product shell
- **THEN** Web channel MUST 提供包含 `transportKind: "SSE"` 或 `transportKind: "WEBSOCKET"` 的 safe bootstrap config projection
- **AND** projection MUST NOT 包含 credential、secret、owner scope、agent scope、stream cursor、RequestRun status、raw config 或 deployment-private fields
- **AND** selected transport MUST NOT 改变 `StreamEnvelope`、`StreamEventType`、session-scoped sequence、terminal event、`RuntimeSessionPort.streamEvents(request)` 或 runtime lifecycle semantics

#### Scenario: Frontend 从 backend bootstrap 选择 transport
- **WHEN** frontend 打开 product stream
- **THEN** frontend MUST 从 backend bootstrap `transportKind` 选择 stream adapter
- **AND** frontend MUST 继续使用 session-scoped `lastSeenSequence` 作为 replay anchor
- **AND** frontend MUST NOT 使用 build-time env、query string、request body、localStorage 或 user metadata 覆盖 backend-projected `transportKind`

#### Scenario: Invalid transport bootstrap 安全失败
- **WHEN** Web channel 无法投影有效 `transportKind`，或 frontend 收到的值不是 `SSE` 或 `WEBSOCKET`
- **THEN** product path MUST 在打开 stream 前以 channel-safe diagnostic 安全失败
- **AND** 只有 dev/mock profile 显式声明 fallback 时，才允许 dev/mock fallback 到 `SSE`
- **AND** fallback behavior MUST NOT 作为 product/release evidence

### Requirement: Stream 输入前置条件
Web stream projection MUST 具备 trusted identity、owner-scoped request coordinates、合法 transport request、`RuntimeSessionStreamEventsQuery`、`RuntimeSessionPort.streamEvents(request)`、safe projection rules 和 error normalization。Client-supplied owner fields MUST NOT 覆盖 trusted identity。

#### Scenario: Streaming 前校验 owner scope
- **WHEN** 客户端携带 sessionId、requestId 或 runId 打开 SSE 或 WebSocket stream
- **THEN** Web channel MUST 使用 channel/auth boundary 注入的 trusted identity 校验 owner scope 和 request visibility
- **AND** client payload 中的 tenant、subject、owner 或等价字段 MUST NOT 覆盖 trusted identity
- **AND** unauthorized 或 not-found request MUST 返回 SafeError 或 safe stream failure，且 MUST NOT 暴露未授权对象是否存在

#### Scenario: Replay anchor 被映射为核心契约输入
- **WHEN** 客户端提供 `lastSeenSequence`
- **THEN** Web channel MUST 将其作为 `RuntimeSessionStreamEventsQuery.lastSeenSequence` 传入 runtime session-facing stream
- **AND** `lastSeenSequence` MUST 是非负 safe integer，且 MUST NOT 超过 `Number.MAX_SAFE_INTEGER`
- **AND** Web channel MAY 携带 `requestId` 和 `runId` 作为过滤条件，但 MUST NOT 改变 session-scoped sequence ownership 或重置 sequence numbering
- **AND** invalid anchor MUST 产生 safe validation failure

### Requirement: Timeline 消费和 Projection Service 复用
Web stream transport MUST 使用确定的规则顺序：校验 request，校验 identity 和 owner scope，构造 `RuntimeSessionStreamEventsQuery`，消费 `RuntimeSessionPort.streamEvents(request)` 返回的 canonical timeline events，调用共享 projection service 投影 stream-visible events 和 redacted payload，序列化 envelope，并按 subscription scope 处理 terminal delivery。Web channel MUST NOT 拥有 canonical replay semantics，也 MUST NOT 维护 transport-private timeline-to-`StreamEnvelope` 映射表。

#### Scenario: Runtime timeline stream 保持顺序
- **WHEN** Web channel 消费 runtime timeline stream 返回的 recoverable events 和后续 live events
- **THEN** emitted envelopes MUST 按 session-scoped sequence 单调递增
- **AND** Web channel MUST 将 runtime 返回的 events 交给共享 projection service，MUST NOT 用 adapter-private buffer 替代 canonical timeline
- **AND** replay MAY 从 `lastSeenSequence` 之后最近的可恢复 event 继续，MUST NOT 要求补齐每一个 sequence

#### Scenario: Timeline-only events 不泄漏为 stream events
- **WHEN** canonical timeline 包含不属于首版 `StreamEventType` 的 events
- **THEN** 共享 projection service MUST NOT 发明 transport-private stream event names
- **AND** timeline-only events MAY 被 projection service 忽略，或在相关时记录为 safe diagnostics

#### Scenario: Terminal event 完成 request/run-scoped stream
- **WHEN** request/run-scoped stream projection 发送匹配该 `requestId` 或 `runId` 的 `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED`
- **THEN** transport MUST flush 或尝试交付该 terminal envelope
- **AND** stream MUST 在 terminal delivery 后完成或关闭
- **AND** Web channel MUST NOT 在同一个 RequestRun 的 terminal event 后继续发送业务 stream events

#### Scenario: Session-scoped stream 在单个 run terminal 后继续订阅
- **WHEN** 未提供 `requestId` 或 `runId` filter 的 session-scoped SSE 或 WebSocket stream 投影某个 RequestRun 的 terminal event
- **THEN** transport MUST flush 或尝试交付该 terminal envelope
- **AND** stream MUST NOT 因该单个 RequestRun terminal event 自动完成或关闭
- **AND** stream MUST 继续消费同一 session 中后续 runtime timeline events，直到 client disconnect、server shutdown 或 transport timeout

#### Scenario: Subscription cleanup 不产生执行事实
- **WHEN** SSE client disconnect、WebSocket close、transport timeout 或 server shutdown 结束 stream connection/subscription
- **THEN** Web channel MUST abort 或 cleanup 对应 `RuntimeSessionPort.streamEvents(request)` subscription
- **AND** cleanup MUST NOT 输出 `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED`
- **AND** cleanup diagnostic MUST NOT 改变 RequestRun status、terminal result 或 canonical timeline

### Requirement: Stream 产物与诊断契约
`StreamEnvelope` MUST 被视为用户可见 wire projection，而不是 durable execution fact。Transport diagnostics MUST 限定为 safe logs 或 metrics，MUST NOT 替代 canonical timeline、checkpoint、artifact、pending input、memory 或 learning records。

#### Scenario: Envelope 可追溯到来源事实
- **WHEN** stream envelope 从 timeline event 投影生成
- **THEN** `timelineEventRef` MUST 引用来源 timeline event id
- **AND** envelope payload MUST 是来源 payload 的 channel-safe projection
- **AND** 客户端 MUST NOT 因拥有 `timelineEventRef` 而获得 raw timeline payload、raw model output、raw tool result 或 raw attachment content 的读取权限

#### Scenario: Transport diagnostics 是安全副作用
- **WHEN** stream connection open、disconnect、resume、replay failure、timeline read failure、serialization failure 或 projection failure 发生
- **THEN** Web channel MUST 为该 diagnostic 记录 safe structured log 或 metric
- **AND** diagnostic records MUST NOT 包含 raw prompt、raw model output、raw tool args/result、secret、credential、local path 或 unauthorized object content
- **AND** diagnostic records MUST NOT 改变 RequestRun status 或 terminal result

### Requirement: Stream 失败处理
Web stream transport 在 required inputs 非法、owner scope 校验失败、timeline read failure、projection failure 或 serialization failure 时 MUST 显式且安全地失败。Web channel MUST NOT 静默截断、静默丢弃、吞错或合成 successful terminal events。

#### Scenario: Runtime timeline stream 读取失败
- **WHEN** Web channel 无法消费 `RuntimeSessionPort.streamEvents(request)` 返回的 canonical timeline stream
- **THEN** stream setup 或 stream delivery MUST 以 SafeError 失败
- **AND** failure MUST 通过 safe diagnostic log 或 metric 记录
- **AND** Web channel MUST NOT 发送 `REQUEST_COMPLETED`，除非 runtime 已经产生对应 terminal fact

#### Scenario: Projection 或 serialization 失败
- **WHEN** timeline event 无法被安全投影或序列化为 `StreamEnvelope`
- **THEN** 如果 transport 仍可用，Web channel MUST 发送 safe failure envelope；否则 MUST 使用 safe transport error 关闭连接
- **AND** 输出给客户端的内容 MUST NOT 暴露 raw event payload 或 raw exception details

### Requirement: Web Stream 验证
TS Web stream transport MUST 通过聚焦测试验证 equivalent output、replay、terminal delivery、owner scope、safe failure 和 channel/runtime boundary。

#### Scenario: 等价测试使用同一 runtime timeline stream
- **WHEN** 测试将同一组 runtime timeline stream events 输入 SSE 和 WebSocket projection
- **THEN** 两种 transport MUST 产生等价的 stream-visible envelopes
- **AND** 测试 MUST 验证 sequence、eventType、terminal semantics 和 safe error shape

#### Scenario: Boundary tests 防止 lifecycle 泄漏
- **WHEN** architecture tests 检查 `agent-channel-web`
- **THEN** 测试 MUST 验证 Web channel 不依赖 runtime private state，也不定义私有 RequestRun lifecycle contracts
- **AND** 测试 MUST 验证 WebSocket stream adapter 不实现 lifecycle-changing command 私有处理

### Requirement: No-Cursor Session Stream Uses Live Tail
TS Web stream transport SHALL distinguish an omitted `lastSeenSequence` query parameter from an explicit numeric `lastSeenSequence`. When a session-scoped stream has no `lastSeenSequence`, `requestId`, or `runId`, Web channel and runtime MUST treat it as session live-tail and MUST NOT replay existing session timeline history.

#### Scenario: Session stream without cursor does not replay existing history
- **WHEN** a client opens SSE or WebSocket stream for a visible session without `lastSeenSequence`, `requestId`, or `runId`
- **THEN** Web channel MUST NOT synthesize `lastSeenSequence=0`
- **AND** runtime MUST subscribe from the current session tail
- **AND** previously persisted stream-visible timeline events for that session MUST NOT be emitted to that stream connection
- **AND** new session events after the live-tail boundary MUST still be emitted according to session-scoped stream rules

#### Scenario: Explicit zero remains full session replay
- **WHEN** a client opens SSE or WebSocket stream with `lastSeenSequence=0` and no `requestId/runId` filter
- **THEN** Web channel MUST pass numeric cursor `0` to runtime
- **AND** runtime MUST use existing session-scoped replay semantics from the beginning of the session timeline
- **AND** this explicit replay behavior MUST NOT be changed by the no-cursor live-tail behavior

#### Scenario: Run-scoped replay from zero remains bounded by filter
- **WHEN** a client opens SSE or WebSocket stream with `lastSeenSequence=0` and a visible `requestId` or `runId`
- **THEN** runtime MUST replay recoverable events after session timeline sequence `0` that match the provided filter
- **AND** `requestId/runId` MUST remain filters and MUST NOT reset sequence numbering

#### Scenario: Filtered recovery without cursor fails safely
- **WHEN** a client opens SSE or WebSocket stream with a `requestId` or `runId` but without `lastSeenSequence`
- **THEN** Web channel or runtime MUST reject the stream safely
- **AND** the failure MUST NOT expose raw owner scope, agent scope, local path, prompt, model output, or timeline payload content

### Requirement: Optional Cursor Semantics Are Transport Equivalent
SSE and WebSocket stream transports SHALL apply identical query parsing for omitted cursor, explicit numeric cursor, and request/run filters.

#### Scenario: Omitted cursor remains omitted across transport adapters
- **WHEN** a client opens SSE or WebSocket stream without `lastSeenSequence`
- **THEN** the corresponding Web stream delivery request MUST preserve `lastSeenSequence` as omitted
- **AND** SSE adapter and WebSocket adapter MUST NOT convert omission to `0`

#### Scenario: Invalid explicit cursor fails safely
- **WHEN** a client opens SSE or WebSocket stream with `lastSeenSequence` present but not a non-negative safe integer
- **THEN** Web channel MUST fail validation safely
- **AND** the failure MUST NOT expose raw owner scope, agent scope, local path, prompt, model output, or timeline payload content

### Requirement: Guard-forward relay may project a terminal OUTPUT_GUARD_BLOCKED event

作为 "projection service MUST NOT 发明 transport-private stream event names" 的受控例外，guard-forward relay 路径下的共享 projection service MAY 投影 terminal `OUTPUT_GUARD_BLOCKED` 事件（由 guard 层经 `GuardrailGatewayPort` 注入，见 `ts-core-contracts` "Guard-forward relay output-guard terminal event"）。该例外仅限 `OUTPUT_GUARD_BLOCKED` 一个事件；其他事件仍 MUST 来自 canonical timeline 或 runtime status，projection service MUST NOT 发明其他 transport-private stream event 名称。

`OUTPUT_GUARD_BLOCKED` 投影后 MUST 以 terminal 语义结束本次请求流，其后 MUST NOT 投影 `LLM_CONTENT_DELTA` 或 `TOOL_STRUCTURED_DELTA`，且 MUST NOT 继续推送已缓冲的模型输出原文。SSE 与 WebSocket transport 对 `OUTPUT_GUARD_BLOCKED` MUST 表现等价。

#### Scenario: Projection service projects OUTPUT_GUARD_BLOCKED on guard-forward relay

- **WHEN** guard-forward relay 路径上 guard 层注入 `OUTPUT_GUARD_BLOCKED`
- **THEN** 共享 projection service MAY 投影该 terminal 事件
- **AND** 该事件之后 MUST NOT 投影增量内容事件
- **AND** MUST NOT 推送已缓冲的模型输出原文

#### Scenario: Projection service does not invent other transport-private events

- **WHEN** guard-forward relay 路径投影事件
- **THEN** 除 `OUTPUT_GUARD_BLOCKED` 外，projection service MUST NOT 发明 transport-private stream event 名称
- **AND** 其他事件 MUST 来自 canonical timeline 或 runtime status

### Requirement: Guard-forward relay forwards the guard proxy stream to the client

当 REMOTE 部署启用护栏时，Web channel 的 request submit 路径（`POST /api/v1/sessions/:sessionId/requests`，`runtime.submit` 之前）SHALL 经 `GuardrailGatewayPort` 把 submit 请求转发到 RobotRouter guard proxy。RobotRouter 做输入校验后回调 NextAgent 既有 submit 端点触发 `runtime.submit` 执行 Agent，并代理该 run 的流（观察输出、可注入 terminal `OUTPUT_GUARD_BLOCKED`）。NextAgent SHALL 把 RobotRouter 返回的流经共享 projection service 投影给客户端（依 `refine-stream-guard-blocked-event` 的 guard-forward relay 例外）。调用 RobotRouter 的发起方始终是 NextAgent 后端；前端/客户端仍只与 NextAgent 自有端点交互。

guard-forward relay MUST 复用与直连 Agent 相同的 `StreamEnvelope` 契约、session-scoped sequence、terminal event 语义、safe error boundary 与 redaction policy。除 `OUTPUT_GUARD_BLOCKED`（依 refinement 例外）外，其他 stream event 仍 MUST 从 canonical timeline 或 runtime status 派生，projection service MUST NOT 发明其他 transport-private stream event 名。transport 选择（SSE 或 WebSocket）MUST NOT 改变 guard-forward 的 envelope 语义。未启用护栏时，submit 路径 MUST 保持既有直连 `runtime.submit` 行为不变，客户端流不经 guard-forward relay。

#### Scenario: Guard-forward relay projects the guard proxy stream

- **WHEN** 启用护栏的 REMOTE 部署在 submit 路径转发到 RobotRouter guard proxy
- **THEN** NextAgent MUST 把 RobotRouter 返回的流经共享 projection service 投影给客户端
- **AND** MUST NOT 维护 transport 私有 terminal 状态或私有映射表
- **AND** 除 `OUTPUT_GUARD_BLOCKED` 外其他事件 MUST 从 canonical timeline 或 runtime status 派生

#### Scenario: Disabled guardrail keeps direct dispatch

- **WHEN** 未启用护栏或 LOCAL 部署
- **THEN** submit 路径 MUST 保持既有直连 `runtime.submit` 的 stream 行为
- **AND** MUST NOT 走 guard-forward relay 路径

### Requirement: Output-guard block projects terminal OUTPUT_GUARD_BLOCKED via the relay

output-guard block 命中时，guard-forward relay SHALL 按稳定 `OUTPUT_GUARD_BLOCKED` contract 在客户端流投影 terminal stream event，payload 携带 guard reason 与 RobotRouter 返回的 `refusalMessage`。`OUTPUT_GUARD_BLOCKED` 之后 MUST NOT 再投影 `LLM_CONTENT_DELTA` 或 `TOOL_STRUCTURED_DELTA`，且 MUST 以 terminal 语义结束本次请求流；MUST NOT 继续推送已缓冲的模型输出原文。前端产品路径收到 `OUTPUT_GUARD_BLOCKED` 后 MUST 只清空本轮已渲染的内容（不影响历史轮次展示）并替换为拒答语。被拦截轮次的 assistant 响应 MUST NOT 进入后续轮次的 model context（见 guardrail-gateway spec "A blocked round is excluded from model-visible history"）。SSE 与 WebSocket transport 对该 terminal 行为 MUST 表现等价。该稳定投影不使用 `failRun`/run FAILED/`REQUEST_FAILED` 映射路线。

#### Scenario: Output-guard block projects terminal OUTPUT_GUARD_BLOCKED

- **WHEN** RobotRouter 发出 output-guard-block 信号
- **THEN** guard-forward relay MUST 投影 terminal `OUTPUT_GUARD_BLOCKED` 事件，payload 携带 guard reason 与 `refusalMessage`
- **AND** 该 terminal 事件之后 MUST NOT 出现增量内容事件
- **AND** 前端 MUST 只清空本轮已渲染内容并替换为拒答语，历史轮次展示不受影响

#### Scenario: Output-guard block does not leak buffered output

- **WHEN** output-guard-block 发生时已缓冲未推送的模型输出
- **THEN** guard-forward relay MUST NOT 在该 terminal 事件后推送已缓冲的模型输出原文
- **AND** 拒答 payload MUST 只含 RobotRouter 返回的 `refusalMessage`

### Requirement: SSE 流交付订阅者清理

Web stream delivery 的 `deliverWebStream` 函数 MUST 在 `finally` 块中调用 runtime timeline iterator 的 `return?.()` 方法，确保 generator 的内部 `finally` 块（包含 `removeStreamSubscriber`）在 disconnect、abort 或 normal completion 时被执行。`iterator` 变量 MUST 声明在 `try` 块之前，使 `finally` 块能够安全引用。`return?.()` 调用 MUST 使用 optional chaining 防止 iterator 未初始化时抛错，且 MUST NOT 等待返回的 Promise（`finally` 块不能 `await`）。

当 stream connection 因 client disconnect、transport timeout、server shutdown 或 abort signal 触发而结束时，Web channel MUST 清理对 `RuntimeSessionPort.streamEvents(request)` 的订阅。清理 MUST NOT 产生 `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED` terminal event，MUST NOT 改变 RequestRun status 或 canonical timeline。

#### Scenario: disconnect 时清理订阅者

- **WHEN** SSE client 在 stream delivery 进行中断开连接
- **THEN** `deliverWebStream` 的 `finally` 块 MUST 调用 `iterator.return?.()`
- **AND** generator 内部的 `removeStreamSubscriber` MUST 被执行
- **AND** subscriber MUST 从 `streamSubscribers` Map 中移除

#### Scenario: abort 时清理订阅者

- **WHEN** abort signal 在 stream delivery 进行中被触发
- **THEN** `deliverWebStream` 的 `finally` 块 MUST 调用 `iterator.return?.()`
- **AND** subscriber MUST 被清理
- **AND** cleanup MUST NOT 产生 terminal event

#### Scenario: normal completion 时清理订阅者

- **WHEN** stream delivery 因 runtime terminal event 正常完成
- **THEN** `deliverWebStream` 的 `finally` 块 MUST 调用 `iterator.return?.()`
- **AND** subscriber MUST 被清理
- **AND** cleanup MUST NOT 改变 RequestRun status 或 canonical timeline

### Requirement: WebSocket 帧大小限制

Task channel WebSocket adapter MUST 对客户端发送的帧 payload 大小强制执行固定上限。单个帧 payload MUST NOT 超过 1 MiB（1048576 字节）。控制帧（opcode >= 0x8）payload MUST NOT 超过 125 字节，符合 RFC 6455 §5.5。

当帧 payload 超过 1 MiB 时，adapter MUST 发送 WebSocket close frame（code 1009 Message Too Big）并关闭连接。当控制帧 payload 超过 125 字节时，adapter MUST 发送 WebSocket close frame（code 1002 Protocol Error）并关闭连接。帧大小上限为固定常量，系统 MUST NOT 从 client payload 或配置读取或覆盖上限值。

#### Scenario: 帧 payload 超过 1 MiB 被拒绝

- **WHEN** WebSocket client 发送 payload 大小超过 1 MiB 的帧
- **THEN** adapter MUST 发送 close frame（code 1009）
- **AND** adapter MUST 关闭连接
- **AND** adapter MUST NOT 处理该帧的 payload

#### Scenario: 控制帧 payload 超过 125 字节被拒绝

- **WHEN** WebSocket client 发送 ping 或 pong 帧且 payload 超过 125 字节
- **THEN** adapter MUST 发送 close frame（code 1002）
- **AND** adapter MUST 关闭连接

#### Scenario: 合法大小帧被接受

- **WHEN** WebSocket client 发送 payload 大小不超过 1 MiB 的数据帧
- **THEN** adapter MUST 正常处理该帧

### Requirement: WebSocket pong 背压处理

Task channel WebSocket adapter 在响应客户端 ping 帧发送 pong 时，MUST 检查 pong 帧写入的背压信号。当 pong 帧写入失败（socket buffer 已满或返回 false）时，adapter MUST 发送 WebSocket close frame（code 1011 Internal Error）并关闭连接。`sendWebSocketPong` MUST 返回 `writeWebSocketFrame` 的背压信号（`boolean`），不得丢弃该信号。

#### Scenario: pong 写入成功

- **WHEN** WebSocket client 发送 ping 帧
- **AND** pong 帧写入成功
- **THEN** adapter MUST 发送 pong 帧
- **AND** 连接 MUST 保持打开

#### Scenario: pong 写入失败关闭连接

- **WHEN** WebSocket client 发送 ping 帧
- **AND** pong 帧写入失败（背压信号为 false）
- **THEN** adapter MUST 发送 close frame（code 1011）
- **AND** adapter MUST 关闭连接
- **AND** adapter MUST NOT 继续排队未发送的 pong 帧

### Requirement: Stream subscriber 连接数限制

Runtime timeline stream 管理 MUST 限制同一 stream key（`tenantId + subjectId + agentId + sessionId`）上的活跃 subscriber 数量不超过 `maxSubscribersPerStream`（10）。`addStreamSubscriber` MUST 在 `subscribers.add(subscriber)` 之前检查 `subscribers.size`，超限时 MUST 抛 `AgentError`（`code: "STREAM_SUBSCRIBER_LIMIT_EXCEEDED"`, `category: "UNAVAILABLE"`, `retryable: true`），MUST NOT 将 subscriber 加入 Set。连接数上限为固定常量，系统 MUST NOT 从 client payload、client metadata 或配置读取或覆盖上限值。

SSE transport 收到该 error 后 MUST 返回 HTTP 503 Service Unavailable safe error。WebSocket transport 收到该 error 后 MUST 发送 close frame（code 1013 Try Again Later）并关闭连接。

#### Scenario: 超限连接被拒绝

- **WHEN** 某 stream key 已有 10 个活跃 subscriber，第 11 个连接尝试订阅
- **THEN** `addStreamSubscriber` MUST 抛 `STREAM_SUBSCRIBER_LIMIT_EXCEEDED` error
- **AND** subscriber MUST NOT 被加入 `streamSubscribers` Set
- **AND** SSE transport MUST 返回 HTTP 503
- **AND** WebSocket transport MUST 发送 close frame 1013 并关闭连接

#### Scenario: 边界值连接被接受

- **WHEN** 某 stream key 已有 9 个活跃 subscriber，第 10 个连接尝试订阅
- **THEN** `addStreamSubscriber` MUST 接受订阅
- **AND** subscriber MUST 被加入 `streamSubscribers` Set

#### Scenario: subscriber 移除后可重新订阅

- **WHEN** 某 stream key 已有 10 个活跃 subscriber，其中一个 subscriber 因 disconnect 被移除后，新连接尝试订阅
- **THEN** `addStreamSubscriber` MUST 接受订阅
- **AND** subscriber MUST 被加入 `streamSubscribers` Set

### Requirement: 订阅者队列高水位

Runtime timeline stream 管理 MUST 限制每个 subscriber 的 queue 长度，防止慢消费者导致内存无界增长。`publishTimelineEvent` 和 `publishLiveTimelineEvent` MUST 在 `subscriber.queue.push(liveEvent)` 之前检查 `queue.length`：

- 当 `queue.length >= maxSubscriberQueueEvents`（1000）且事件 `persistence` 为 `LIVE_ONLY` 时，MUST 跳过 push（静默丢弃）。
- 当 `queue.length >= maxSubscriberQueueEvents`（1000）且事件 `persistence` 为 `PERSISTED` 时，MUST 仍然 push（持久化事件不可丢失）。
- 当 `queue.length >= subscriberQueueHardLimit`（2000）时，MUST 移除该 subscriber 并调用 `subscriber.wake?.()` 触发 abort，live-tail 循环 MUST 退出。

队列高水位为固定常量，系统 MUST NOT 从 client payload、client metadata 或配置读取或覆盖阈值。

#### Scenario: LIVE_ONLY 事件在 soft limit 被丢弃

- **WHEN** 某 subscriber 的 queue 长度达到 1000
- **AND** `publishTimelineEvent` 或 `publishLiveTimelineEvent` 尝试 push 一个 `LIVE_ONLY` 事件
- **THEN** 该事件 MUST 被跳过（不 push）
- **AND** subscriber MUST NOT 被移除
- **AND** subscriber MUST 继续接收后续 PERSISTED 事件

#### Scenario: PERSISTED 事件在 soft limit 仍然 push

- **WHEN** 某 subscriber 的 queue 长度达到 1000
- **AND** `publishTimelineEvent` 尝试 push 一个 `PERSISTED` 事件
- **THEN** 该事件 MUST 被 push 到 queue
- **AND** subscriber MUST NOT 被移除

#### Scenario: 超过 hard limit 时关闭 subscriber

- **WHEN** 某 subscriber 的 queue 长度达到 2000
- **AND** `publishTimelineEvent` 或 `publishLiveTimelineEvent` 尝试 push 事件
- **THEN** subscriber MUST 被从 `streamSubscribers` Set 中移除
- **AND** `subscriber.wake?.()` MUST 被调用
- **AND** live-tail 循环 MUST 退出

### Requirement: Stream subscriber 空闲超时

Runtime timeline stream 管理 MUST 为 live-tail subscriber 设置服务端空闲超时。`nextSubscriberEvent` 在队列空时 MUST NOT 无限等待。当 subscriber 连续等待事件的时间超过 `subscriberIdleTimeoutMs`（300000ms / 5 分钟）时，`nextSubscriberEvent` MUST 返回 `undefined`，live-tail 循环 MUST 退出，transport 层 MUST 关闭连接。

空闲超时为固定常量，系统 MUST NOT 从 client payload、client metadata 或配置读取或覆盖超时值。超时定时器 MUST 在 `nextSubscriberEvent` 返回后（无论因事件到达、signal abort 还是超时）被 `clearTimeout` 清理，MUST NOT 泄漏。

#### Scenario: 空闲超时关闭连接

- **WHEN** live-tail subscriber 的队列连续空等待超过 5 分钟
- **THEN** `nextSubscriberEvent` MUST 返回 `undefined`
- **AND** live-tail 循环 MUST 退出
- **AND** transport 层 MUST 关闭连接

#### Scenario: 事件到达重置等待

- **WHEN** subscriber 在超时窗口内收到新事件
- **THEN** `nextSubscriberEvent` MUST 返回该事件
- **AND** 超时定时器 MUST 被清理
- **AND** live-tail 循环 MUST 继续等待下一个事件

#### Scenario: signal abort 优先于超时

- **WHEN** subscriber 正在等待事件，且 `request.signal` 被 abort
- **THEN** `nextSubscriberEvent` MUST 返回 `undefined`
- **AND** 超时定时器 MUST 被清理
- **AND** 超时定时器 MUST NOT 在 abort 后触发

### Requirement: Stream subscriber 空闲超时 pending input 豁免

Runtime timeline stream 管理 MUST 在 subscriber 处于 pending input 等待状态时豁免空闲超时。当 `subscriber.pendingInputActive` 为 true 时，`nextSubscriberEvent` MUST NOT 触发 `subscriberIdleTimeoutMs` 超时，仅依赖 `request.signal?.aborted` 退出。

pendingInputActive 状态 MUST 由以下事件驱动：
- publishTimelineEvent 推送 USER_INPUT_REQUIRED 事件后 MUST 设置 subscriber.pendingInputActive = true。
- publishTimelineEvent 推送 USER_INPUT_RECEIVED、USER_INPUT_TIMEOUT 或 USER_INPUT_CANCELED 事件后 MUST 设置 subscriber.pendingInputActive = false。
- streamOwned 重放循环中遍历到上述事件时 MUST 同步更新局部状态变量，replay 结束后 MUST 将最终值赋给 subscriber.pendingInputActive。

#### Scenario: pending input 期间不触发空闲超时

- **WHEN** subscriber 收到 USER_INPUT_REQUIRED 事件后，队列连续空闲超过 5 分钟
- **THEN** `nextSubscriberEvent` MUST NOT 返回 undefined
- **AND** 连接 MUST NOT 被关闭
- **AND** subscriber MUST 继续等待事件

#### Scenario: pending input resolve 后恢复空闲超时

- **WHEN** subscriber 收到 USER_INPUT_RECEIVED 事件后，队列连续空闲超过 5 分钟
- **THEN** `nextSubscriberEvent` MUST 返回 undefined
- **AND** 连接 MUST 被关闭

#### Scenario: 重放路径恢复 pending input 状态

- **WHEN** subscriber 重连时重放历史事件，最后一个 pending input 事件为 USER_INPUT_REQUIRED（未收到 resolve 事件）
- **THEN** replay 结束后 subscriber.pendingInputActive MUST 为 true
- **AND** 后续 live-tail 等待 MUST 豁免空闲超时

### Requirement: 可恢复过程事件引用唯一消息正文

当一次模型 Tool 轮次的公开说明、Tool 调用参数或 ordinary Tool 终态语义结果已经形成持久化 `SessionMessage` 时，系统 MUST 先确认该消息写入成功，再发布对应的可恢复 lifecycle Event。该 Event MUST 通过 `messageId` 引用该消息，MUST NOT 在持久化 Event payload 中重复保存可从该消息恢复的正文、Tool 参数或 Tool 语义结果。

`messageId` MUST 是非空 `MessageId`。引用 Event 与目标消息 MUST 具有相同的 Owner Scope、Agent Scope、`sessionId`、`requestId` 和 `runId`；Tool Event 还 MUST 具有一致的 `toolCallId`。不满足全部关联条件的引用 MUST 被视为无效引用。

公开说明的引用 Event MUST 是携带非空 `stepId` 和 `completed=true` 的 `LLM_CONTENT_DELTA`；Tool 调用的引用 Event MUST 是 `CAPABILITY_STARTED`；已形成结果消息的 Tool 终态引用 Event MUST 是 `CAPABILITY_COMPLETED`。Tool 在结果消息形成前失败时，`CAPABILITY_COMPLETED` MUST 不携带 `messageId`，并且 MUST 只表达安全终态。

经过受治理 producer 的 canonical shape validation、安全过滤和 structured-delta 识别，并由 `tool-structured-delta` persistence rules 选为 durable history 的 `TOOL_STRUCTURED_DELTA`，在 canonical Message 尚不能分别承载语义结果与最终 structured presentation snapshot 的兼容阶段，MUST 作为独立的有界过渡 presentation Event 持久化。该 Event MUST 只表达 Channel/UI presentation，MUST NOT 取代 `CAPABILITY_RESULT` Message 的语义结果所有权，MUST NOT 进入模型上下文，MUST NOT 产生或改变 request terminal status、degradation、新的 request-level terminal fact 或 annotation。任意 stdout、JSON、Tool 自报字段或 Message 内容不满足上述可信识别条件时 MUST NOT 使用该例外。

当模型或 Tool 已产生可公开的进行中累计内容时，系统 MAY 使用 live-only delta 投影该内容；系统不选择投影或上游没有产生该内容时，系统 MUST NOT 虚构进行中正文。该 delta MUST NOT 作为历史、派生会话过程快照或模型上下文事实。最终 Assistant Message 继续遵循既有终态消息语义，不适用本 Requirement 的 structured presentation 例外。

**需求类别**：功能性需求

#### Scenario: Tool轮次公开说明先写消息再发布引用Event

- **WHEN** 模型在同一轮输出非空公开说明和至少一个 Tool 调用
- **THEN** 系统 MUST 先持久化包含该轮公开说明与 Tool 调用事实的消息
- **AND** completed `LLM_CONTENT_DELTA` MUST 通过该消息的 `messageId` 引用公开说明
- **AND** 每个 `CAPABILITY_STARTED` MUST 通过同一消息的 `messageId` 和自身 `toolCallId` 引用对应 Tool 调用
- **AND** 持久化 Event payload MUST NOT 再包含该公开说明正文或 Tool 参数副本

#### Scenario: Tool终态Event引用结果消息

- **WHEN** Tool 调用形成持久化 `CAPABILITY_RESULT` Message 和可恢复 `CAPABILITY_COMPLETED` 终态 Event
- **THEN** `CAPABILITY_COMPLETED` MUST 携带该结果消息的 `messageId`
- **AND** Event 与 Message 的 `toolCallId`、Owner Scope、Agent Scope、会话、请求和运行坐标 MUST 一致
- **AND** 持久化 Event payload MUST NOT 再包含可从结果消息恢复的 Tool 语义结果正文

#### Scenario: 可信结构化呈现使用独立Event

- **GIVEN** 一个 Tool 输出已通过受治理 producer 的 canonical structured-delta 识别和安全过滤
- **WHEN** `tool-structured-delta` persistence rules 选择 runtime 持久化该 structured presentation
- **THEN** `TOOL_STRUCTURED_DELTA` Event MUST 携带有界 presentation body
- **AND** `CAPABILITY_RESULT` Message MUST 继续持有 ordinary Capability 语义结果
- **AND** Context 与 Agent Loop MUST NOT 从该 Event 恢复模型输入

#### Scenario: 任意自报内容不能建立presentation例外

- **WHEN** arbitrary stdout、JSON、Tool 自报字段或 Message 内容未通过 canonical structured-delta 识别
- **THEN** 系统 MUST NOT 将其作为 durable structured presentation Event
- **AND** ordinary lifecycle Event MUST 继续遵循 Message 引用与无正文规则

#### Scenario: 进行中delta不成为持久化正文

- **WHEN** 模型或 Tool 在持久化消息形成前发布累计的进行中内容
- **THEN** 该内容 Event MUST 为 live-only
- **AND** 历史读取和派生会话过程快照 MUST NOT 把该内容当作持久化正文

#### Scenario: 消息写入失败阻止引用Event

- **WHEN** 公开过程内容对应的消息写入失败
- **THEN** 系统 MUST NOT 发布声称引用该消息的可恢复 lifecycle Event
- **AND** 本次执行 MUST 进入既有显式安全失败路径

### Requirement: Tool 轮次执行说明与 Tool 调用连续呈现

当模型在同一 Tool 轮次输出公开说明和 Tool 调用时，系统 MUST 按“该轮前置 thinking、公开执行说明、关联 Tool 调用”的规范顺序向用户呈现过程。公开执行说明 MUST 使用关联消息中的安全公开正文，并 MUST NOT 被呈现为具有独立标题、独立状态图标、完成对勾或独立展开控制的过程步骤。

执行说明 MUST 随执行详情大面板统一显示或隐藏；大面板展开时，该说明 MUST 直接可见。系统 MUST NOT 为说明增加“接下来”或其他不属于关联消息正文的固定界面文案。既有 thinking、Tool、PIU 和普通过程步骤的图标、状态与 disclosure 语义 MUST 保持不变。

待定桥接内容和完成执行说明 MUST 使用与最终答案相同的公开正文排版和 Markdown 渲染语义，包括字体、字号、行高、字重、主文字色和换行规则。执行说明正文 MUST 与展开后的 thinking 正文使用同一内容列左边界，并且 MUST NOT 使用独立底色、独立边框、圆角容器或额外水平内边距表达其归属。

模型公开输出尚未完成、系统尚不能确定其后是否存在 Tool 调用时，具有非空 `stepId` 且不具有 `final=true` 的进行中累计内容 MUST 在执行详情中使用无独立图标的待定桥接位置流式呈现，并且 MUST NOT 同时出现在最终答案位置。后续产生 Tool 调用时，同一 `stepId` 的完成说明 MUST 在该位置原地接管进行中内容；后续没有产生 Tool 调用时，最终 Assistant 输出 MUST 接管既有最终答案位置，并且执行详情 MUST 不再保留该待定内容。语义确认过程 MUST NOT 清空后重新播放已经呈现的文字。

系统为 Agent Core model step 投影具有非空 `stepId` 且不具有 `final=true` 的 `LLM_CONTENT_DELTA` 时，Web stream payload 的 `content` 和 `text` MUST 是该 `stepId` 内的累计公开正文。系统 MUST 在同一 `stepId` 内按生成顺序累计已确认的输出续写片段和当前 invocation 正文，并 MUST 在 `stepId` 改变时建立独立累计边界；新 step 的正文 MUST NOT 包含任一先前 step 的正文。不同 step 产生相同文本时，系统 MUST 保留这些独立事实，并 MUST NOT 根据文本相等、前缀关系或相似度合并或删除其中任一事实。

SSE 与 WebSocket 的共享 Web 投影 MUST 保留运行时 `LLM_CONTENT_DELTA` 中安全的 `final` 布尔标识。浏览器 MUST 使用该 canonical 标识区分待定过程内容与最终 Assistant 输出，并 MUST NOT 仅根据 `REQUEST_COMPLETED` 到达或刷新后的历史快照推断终局语义。

最终 Assistant 输出接管待定内容时 MUST 直接使用既有最终答案的左对齐位置。接管过程 MUST NOT 改变正文的字体、字号、行高、透明度或换行规则，MUST NOT 清空、重建或重新打字，也 MUST NOT 播放横向位置过渡或淡入淡出动画。系统 MUST 复用既有执行详情高度与滚动锚点补偿保持正文首行的纵向阅读焦点。

只有同时包含 Tool 调用事实的公开内容适用本 Requirement 中的执行详情桥接规则。没有后续 Tool 调用的模型公开输出 MUST 继续遵循最终 Assistant Message 的既有输出与持久化语义。浏览器在同一次逐帧投影中 MUST 直接显示当前已经接收并合并的完整累计正文，MUST NOT 使用独立计时器把已经接收的正文再次拆分为逐字更新；该呈现规则 MUST NOT 改变 envelope 顺序、terminal 收敛或 history 恢复结果。

当一个请求在一个或多个已完成 Tool 轮次之后进入终止模型轮次时，最终 Assistant Message MUST 只包含该终止模型轮次形成的完整安全回答，包括该轮次内合法的输出续写片段和终态 hook 替换结果；它 MUST NOT 包含先前 Tool 轮次的公开执行说明、Tool 调用参数或 Tool 结果正文。先前 Tool 轮次的公开执行说明 MUST 继续通过其消息引用事件在过程区显示，并 MUST NOT 因最终 Assistant Message、刷新、重连或 history 加载而出现第二次。

**需求类别**：功能性需求

#### Scenario: 执行说明连接思考与同轮 Tool 调用

- **WHEN** 一个 Tool 轮次具有已完成 thinking、非空公开说明和至少一个 Tool 调用
- **THEN** 用户 MUST 先看到该轮 thinking，再看到消息中的安全公开说明，随后看到关联 Tool 调用
- **AND** 公开说明 MUST NOT 显示独立标题、独立状态图标、完成对勾或展开按钮
- **AND** 公开说明对应的完成事件 MUST 在用户可见序列中位于同轮关联 Tool 的 `CAPABILITY_STARTED` 之前
- **AND** 用户看到的说明正文 MUST NOT 包含系统额外添加的固定引导文案
- **AND** 说明正文 MUST 与展开后的 thinking 正文左边界对齐
- **AND** 说明正文 MUST 使用最终答案的公开正文排版且不得具有独立底色或边框

#### Scenario: 进行中公开输出保持待定桥接位置

- **WHEN** 模型正在流式输出具有非空 `stepId` 且不具有 `final=true` 的累计公开内容
- **AND** 系统尚未确认该轮是否产生 Tool 调用
- **THEN** 用户 MUST 在执行详情中的无独立图标桥接位置看到该内容
- **AND** 最终答案位置 MUST NOT 同时显示该内容
- **AND** 同一 `stepId` 的后续完成说明 MUST 原地接管该桥接位置且不得重新播放正文

#### Scenario: 后续 model step 不继承先前执行说明

- **GIVEN** 一个 model step 已经产生非空公开执行说明并进入 Tool 调用
- **WHEN** 后续 model step 发布具有不同非空 `stepId` 的非终态 `LLM_CONTENT_DELTA`
- **THEN** 新事件的 `content` 和 `text` MUST 只包含新 `stepId` 产生的累计公开正文
- **AND** 新事件 MUST NOT 包含先前 step 的公开执行说明

#### Scenario: 同一 model step 的输出续写保持累计

- **GIVEN** 一个 model step 因输出长度限制形成一个或多个已确认续写片段
- **WHEN** 系统为同一 `stepId` 发布后续非终态 `LLM_CONTENT_DELTA`
- **THEN** 后续事件 MUST 按生成顺序包含该 step 已确认的全部续写片段和当前 invocation 正文
- **AND** 该累计正文 MUST NOT 包含其他 `stepId` 的正文

#### Scenario: 不同步骤的相同正文保持独立

- **GIVEN** 两个不同 `stepId` 的 model step 分别产生完全相同的公开正文和 Tool 调用
- **WHEN** 系统投影这两个 step 的非终态 `LLM_CONTENT_DELTA`
- **THEN** 系统 MUST 保留两个具有各自 `stepId` 的独立事件事实
- **AND** 系统 MUST NOT 因正文相同而合并、隐藏或删除任一事实

#### Scenario: 没有后续 Tool 调用时保持最终答案语义

- **WHEN** 模型公开输出完成后没有产生 Tool 调用
- **THEN** 该输出 MUST 继续显示在既有最终答案位置
- **AND** 系统 MUST NOT 将其投影为执行详情中的桥接说明
- **AND** 执行详情 MUST 移除同一轮的待定桥接内容且不得在最终答案位置重新播放已经呈现的正文
- **AND** 最终答案 MUST 保持既有左对齐位置
- **AND** 接管过程 MUST 不改变正文排版、透明度或换行，并 MUST 保持正文首行的纵向阅读焦点

#### Scenario: 最终答案只随逐帧 Web stream 投影推进

- **GIVEN** 模型公开输出没有产生 Tool 调用
- **WHEN** 浏览器在一次逐帧投影中接收并合并新的累计正文
- **THEN** 最终答案位置 MUST 直接显示该累计正文的全部已接收内容
- **AND** 在下一次 Web stream 投影到达前 MUST NOT 使用独立计时器继续推进同一份正文
- **AND** terminal 到达后 MUST 直接显示最后累计正文且不得等待浏览器本地字符 backlog

#### Scenario: 多个 Tool 轮次后只提交终止轮次回答

- **GIVEN** 同一请求依次完成至少两个具有非空公开执行说明的 Tool 轮次
- **WHEN** 后续终止模型轮次产生不含 Tool 调用的最终回答
- **THEN** 最终 Assistant Message MUST 完整等于该终止模型轮次的安全回答
- **AND** 最终 Assistant Message MUST NOT 包含任一先前 Tool 轮次的公开执行说明
- **AND** 每个先前 Tool 轮次的公开执行说明 MUST 只在对应过程时序位置显示一次

#### Scenario: 终止轮次输出续写保持完整且不带入先前说明

- **GIVEN** 一个请求已经完成具有公开执行说明的 Tool 轮次
- **AND** 终止模型轮次因输出长度限制在同一轮次内完成合法续写
- **WHEN** 系统提交最终 Assistant Message
- **THEN** 最终 Assistant Message MUST 包含该终止模型轮次全部已确认续写片段
- **AND** 最终 Assistant Message MUST NOT 包含先前 Tool 轮次的公开执行说明

#### Scenario: 刷新历史不重新产生跨区域重复

- **GIVEN** 一个已完成请求包含 Tool 轮次公开执行说明和终止轮次最终回答
- **WHEN** 用户刷新或重新打开该历史会话
- **THEN** history MUST 在执行详情中恢复每个 Tool 轮次说明一次
- **AND** history MUST 在最终答案位置只恢复终止轮次最终回答
- **AND** 系统 MUST NOT 通过消息拼接、事件回退或浏览器缓存把先前说明加入最终答案

#### Scenario: Web 投影保留最终答案标识

- **GIVEN** runtime 发布携带 `final=true` 的 `LLM_CONTENT_DELTA`
- **WHEN** channel 将该事件投影为 SSE 或 WebSocket `StreamEnvelope`
- **THEN** 投影 payload MUST 保留 `final=true`
- **AND** 浏览器 MUST 在 live 状态立即移除未完成待定过程副本
- **AND** 最终答案 MUST 只在既有答案位置显示一次

#### Scenario: 最终答案直接完成待定内容接管

- **WHEN** 最终 Assistant 输出接管执行详情中的待定桥接内容
- **THEN** 系统 MUST 直接使用既有最终答案位置和排版显示正文
- **AND** 系统 MUST NOT 播放横向位置过渡、淡入淡出或重新打字效果

### Requirement: Web stream 在服务端解析过程消息引用

SSE 与 WebSocket 的共享过程投影 MUST 在服务端决定引用事件的安全正文来源。对于当前订阅已经向 consumer 交付的非空安全累计过程快照，后续完成引用事件仅在全部可信 occurrence 坐标一致时 MUST 使用该快照生成完成投影；除此之外，共享过程投影 MUST 在服务端解析过程事件的 `messageId`，并且 MUST 仅从通过关联校验的消息生成用户可见正文。两种 transport MUST 对同一事件、同一订阅前序和同一消息可见性产生相同的 `StreamEnvelope` 内容、顺序、完成状态和安全降级结果。

可复用的 occurrence 只有以下两类，且列表是穷尽的：具有相同 `sessionId`、`requestId`、`runId`、`rootMessageId` 和非空 `stepId` 的累计 `LLM_CONTENT_DELTA` 与 completed `LLM_CONTENT_DELTA`；具有相同 `sessionId`、`requestId`、`runId`、`rootMessageId`、`capabilityId` 和非空 `toolCallId` 的 `CAPABILITY_RESULT_DELTA` 与 `CAPABILITY_COMPLETED`。前序快照 MUST 已经通过当前 transport 的安全投影并向同一订阅 consumer 交付。不同 occurrence、空正文、未交付快照、`CAPABILITY_STARTED` 和未列出的其他事件类型 MUST NOT 使用该路径。

命中可复用 occurrence 时，共享过程投影 MUST 使用该 occurrence 最新交付的安全累计正文生成完成投影，MUST 保留完成引用事件的规范顺序、状态和 identity，并且 MUST NOT 为该完成事件调用消息关联入口。完成投影 MUST NOT 包含 `contentUnavailable=true`，也 MUST NOT 清空、缩短或重新播放 consumer 已经看到的正文。后续安全拒绝事件仍 MUST 按其既有终态契约撤回对应 run 的已展示正文。

没有命中可复用 occurrence 时，共享过程投影 MUST 调用 server-only 消息关联入口。消息关联有效时，用户可见 payload MUST 不包含 `contentUnavailable`。消息关联无效、读取失败或结果在当前读取时不可见时，用户可见 payload MUST 包含布尔值 `contentUnavailable=true`，并且 MUST 不包含消息正文、Tool 参数或 Tool 结果正文。系统 MUST NOT 使用其他 occurrence、浏览器缓存、Event 正文副本或 Tool 本地状态补齐内容。

浏览器 MUST NOT 接收原始隐藏消息、消息可见性控制字段或未投影的 Tool 输入输出来完成关联。过程消息关联和订阅内完成收敛 MUST NOT 改变最终 Assistant Message、thinking、terminal event 或既有消息可见性语义。

`RuntimeSessionPort` MUST 提供 server-only `resolveProcessMessages(query)` 关联入口。`query` MUST 包含可信 `identityContext`、`sessionId`、`requestId`、`runId` 和去重后的 `messageIds`，并且 MAY 包含 `includeLegacyCandidates` 与 `signal`。引用模式 MUST 接受一至一千个 `messageIds`，结果 MUST 只包含同时匹配全部可信坐标和请求标识的 `SessionMessage` 领域对象。仅当 history route 需要关联无消息引用的旧事件时，`includeLegacyCandidates=true` MAY 与空 `messageIds` 组合，并返回当前可信运行内至多一千条完整候选；候选超过上限时 MUST 安全失败，不得返回截断集合。缺少 `signal` 时调用 MUST 正常执行，提供 `signal` 时取消 MUST 只终止本次关联读取。结果 MUST NOT 返回 gateway `*Record` 或数据库字段。该入口 MUST NOT 作为 Web route 暴露，也 MUST NOT 接受客户端直接提供的 `messageIds` 或 legacy candidate 开关。

**需求类别**：功能性需求

#### Scenario: 活跃执行说明使用已交付快照完成收敛

- **GIVEN** 同一 SSE 或 WebSocket 订阅已交付一个具有非空 `stepId` 和非空安全累计正文的 `LLM_CONTENT_DELTA`
- **WHEN** 同一订阅收到全部 occurrence 坐标一致的 completed `LLM_CONTENT_DELTA` 引用事件
- **THEN** 完成投影 MUST 保留最新已交付的安全累计正文并标记该 occurrence 已完成
- **AND** 系统 MUST NOT 为该完成事件调用消息关联入口
- **AND** 完成投影 MUST NOT 包含 `contentUnavailable=true`

#### Scenario: 活跃 Tool 结果使用已交付快照完成收敛

- **GIVEN** 同一 SSE 或 WebSocket 订阅已交付一个具有非空 `toolCallId` 和非空安全结果正文的 `CAPABILITY_RESULT_DELTA`
- **WHEN** 同一订阅收到全部 occurrence 坐标一致的 `CAPABILITY_COMPLETED` 引用事件
- **THEN** 完成投影 MUST 保留最新已交付的安全结果正文与结果展示级别并推进 Tool 完成状态
- **AND** 系统 MUST NOT 为该完成事件调用消息关联入口
- **AND** 完成投影 MUST NOT 包含 `contentUnavailable=true`

#### Scenario: 暂时不可读的消息不清空已展示正文

- **GIVEN** consumer 已显示当前 occurrence 的非空安全累计正文
- **WHEN** 对应完成引用事件到达时持久化消息尚未对关联读取可见
- **THEN** consumer MUST 继续看到已经交付的完整正文和完成状态
- **AND** 空的内容不可用完成态 MUST NOT 替换、清空或缩短该正文

#### Scenario: 未观察到 live 快照时从消息恢复

- **GIVEN** 当前订阅没有符合全部 occurrence 坐标的已交付非空安全累计快照
- **WHEN** SSE 或 WebSocket 投影一个携带 `messageId` 的 process Event
- **THEN** 共享过程投影 MUST 通过 server-only 消息关联入口恢复正文
- **AND** 两种 transport MUST 从同一个有效目标消息生成相同的安全正文、过程类型、顺序和状态
- **AND** 浏览器响应 MUST NOT 包含该目标消息的原始隐藏记录

#### Scenario: 不同 occurrence 不得复用正文

- **GIVEN** 当前订阅已交付至少一个非空安全累计过程快照
- **WHEN** 完成引用事件的 `stepId`、`toolCallId` 或任一可信 turn/run 坐标与全部已交付快照不一致
- **THEN** 系统 MUST NOT 使用任一已交付快照生成该完成事件的正文
- **AND** 系统 MUST 对该事件执行 Message 关联并按关联结果投影或安全降级

#### Scenario: 无快照且关联失败时显式降级

- **GIVEN** 当前订阅没有符合全部 occurrence 坐标的已交付非空安全累计快照
- **WHEN** `messageId` 不存在、目标消息作用域不匹配、消息类型不匹配、`toolCallId` 不一致或消息读取失败
- **THEN** Web stream MUST NOT 输出目标消息或 Event 中的正文副本
- **AND** 对应过程项 MUST 保留可安全公开的类型、顺序和状态
- **AND** 系统 MUST 输出 `contentUnavailable=true`，不得泄露目标消息是否属于其他 owner 或 Agent

#### Scenario: 服务端批量关联入口不成为公开消息读取 API

- **WHEN** 共享 Web 投影需要解析同一运行的一至一千个事件消息引用
- **THEN** server-only 关联入口 MUST 只返回与可信会话、请求、运行和请求标识同时匹配的 `SessionMessage`
- **AND** Web route MUST NOT 允许客户端直接调用该入口或提交任意 `messageIds`
- **AND** 关联结果 MUST NOT 包含 gateway `*Record` 或数据库字段

#### Scenario: 旧事件候选查询保持完整且有界

- **WHEN** history route 需要为同一运行中没有 `messageId` 的旧过程事件建立唯一关联
- **THEN** server-only 入口 MAY 在空 `messageIds` 下返回当前可信运行内至多一千条完整候选
- **AND** 候选超过一千条时 MUST 安全失败并使旧事件降级为仅状态结果
- **AND** 系统 MUST NOT 从截断候选集合推断唯一消息

### Requirement: 过程消息引用保持作用域隔离

系统 MUST 对每次过程消息关联执行 Owner Scope、Agent Scope、会话、请求和运行坐标校验。任何一个坐标不一致时，系统 MUST 拒绝正文关联，并且 MUST NOT 通过 Web API、stream、日志、metric、audit 或 SafeError 暴露未授权消息内容、原始 Tool 输入输出或模型正文。

**需求类别**：系统质量属性

**质量属性**：安全

**适用范围**：该 Function

#### Scenario: 跨会话引用不泄露正文

- **WHEN** 一个过程事件引用同一用户或不同用户的另一会话消息
- **THEN** 系统 MUST 拒绝正文关联
- **AND** 用户可见结果 MUST 仅保留安全状态
- **AND** 响应与诊断 MUST NOT 暴露被引用消息的正文或归属信息

#### Scenario: 跨 Agent 引用不泄露正文

- **WHEN** 一个过程事件引用同一 Owner Scope 下另一 Agent 的消息
- **THEN** 系统 MUST 拒绝正文关联
- **AND** 系统 MUST NOT 将该消息投影到 SSE 或 WebSocket

### Requirement: 会话非续期请求头

浏览器端自动重连的 SSE 流连接和关联诊断 HTTP 请求 MUST 携带 `x-non-renewal-session: true` 请求头，告知后端或外部网关该请求属于自动维持的流式连接或探针，MUST NOT 续期当前会话超时计时器。

前端 `connectStream` 的 `headers` 参数 MUST 只作用于 SSE fetch 调用。WebSocket transport MUST NOT 携带该头，因为浏览器 WebSocket API 不支持自定义 HTTP header；WebSocket 的会话续期控制由后续 OpenSpec change 通过 subprotocol 或 query parameter 扩展。

`x-non-renewal-session` 头的值 MUST 精确为字符串 `true`。该头 MUST NOT 从客户端请求体、模型输出、capability 参数或用户 metadata 派生。该头 MUST NOT 携带 credential、owner scope、agent scope 或任何高基数字段。

**需求类别**：系统质量属性

**质量属性**：安全

**适用范围**：该 Function

#### Scenario: SSE 流连接携带非续期头
- **WHEN** 浏览器通过 SSE fetch 打开 Session Activity Projection Stream 或 Request Execution Stream
- **THEN** fetch 请求 MUST 携带 `x-non-renewal-session: true` 请求头
- **AND** 后端或外部网关收到该头时 MUST NOT 续期当前会话超时计时器
- **AND** 该头 MUST NOT 出现在 stream event payload、timeline event、audit log 或 safe error 中

#### Scenario: auth probe HTTP 请求携带非续期头
- **WHEN** 浏览器在 stream 断连时发送 auth probe HTTP 请求（`GET /api/v1/sessions?offset=0&limit=1`）
- **THEN** 该请求 MUST 携带 `x-non-renewal-session: true` 请求头
- **AND** 后端或外部网关收到该头时 MUST NOT 续期当前会话超时计时器

#### Scenario: WebSocket 不携带非续期头
- **WHEN** 浏览器通过 WebSocket 打开 stream 连接
- **THEN** WebSocket 连接 MUST NOT 携带 `x-non-renewal-session` 请求头或 query parameter
- **AND** WebSocket 的会话续期控制 MUST NOT 由本 spec 定义，MUST 通过后续独立 OpenSpec change 扩展

#### Scenario: 用户主动请求不携带非续期头
- **WHEN** 用户通过 Web channel 主动提交请求（submit、retry、edit、cancel、answer pending input 等）
- **THEN** 这些 HTTP 请求 MUST NOT 携带 `x-non-renewal-session` 头
- **AND** 后端或外部网关 MUST 正常续期当前会话超时计时器

### Requirement: 用户输入边界分隔复用 stepId 的模型发生实例

Web stream consumer MUST 使用同一 root message、attempt 和 run 内的 `USER_INPUT_RECEIVED` 事件分隔模型发生实例。对于 `LLM_CONTENT_DELTA`，每个事件所属的输入分段从该运行开始或最近一个先于该事件的 `USER_INPUT_RECEIVED` 之后开始，并在下一个 `USER_INPUT_RECEIVED` 到达前结束。相同非空 `stepId` 在不同输入分段中 MUST 形成不同发生实例；相同 `stepId` 只有在同一输入分段内 MAY 作为累计快照 lane。

consumer MUST 只在相同 session、root message、attempt、event type、`stepId` 和输入分段内替换累计快照。不同输入分段的执行说明 MUST 分别保留各自首次出现的 sequence 和 created time；consumer MUST NOT 根据正文相等、前缀关系、相邻位置或同一次 RequestRun 合并不同发生实例。该规则 MUST 同时用于 live envelope accumulation、turn projection 和 run-event history；producer 的 `stepId`、event type 和 payload shape 保持不变。

**需求类别**：功能性需求

#### Scenario: 补充信息边界后复用 stepId

- **GIVEN** 输入分段 E1 中的 `stepId=S1` 已产生执行说明 A
- **AND** 同一运行随后产生 `USER_INPUT_REQUIRED` 和 `USER_INPUT_RECEIVED`
- **WHEN** 输入分段 E2 中的 `stepId=S1` 产生执行说明 B
- **THEN** live 过程 MUST 同时保留 A 和 B
- **AND** B MUST 使用自身首次事件的时序位置，不得占用 A 的位置
- **AND** A 和 B MUST 分别在各自输入分段内更新

#### Scenario: 同一输入分段内累计帧原地更新

- **GIVEN** 输入分段 E1 中的 `stepId=S1` 已发布非终态累计正文
- **WHEN** E1 中 S1 发布后续流式帧、输出续写或 completed snapshot
- **THEN** consumer MUST 原地更新 E1/S1 的累计快照
- **AND** 更新后的累计正文 MUST 只包含该发生实例按生成顺序确认的内容

#### Scenario: 不同输入分段产生相同正文

- **GIVEN** E1/S1 和 E2/S1 产生完全相同的公开正文
- **WHEN** live stream、重连或 run-event history 投影这两个发生实例
- **THEN** 用户 MUST 看到两个按各自真实时序排列的执行说明
- **AND** 系统 MUST NOT 因正文相等而删除、覆盖或合并其中任一说明

#### Scenario: 历史缺少可验证输入边界

- **GIVEN** 旧历史复用同一 `stepId` 且不包含可验证的 `USER_INPUT_RECEIVED` 边界
- **WHEN** 新版本读取该历史
- **THEN** 系统 MUST NOT 根据正文、关键词或相邻事件伪造输入分段
- **AND** 系统 MUST 按可验证的现有身份进行安全投影
