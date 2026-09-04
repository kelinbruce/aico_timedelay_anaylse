## MODIFIED Requirements

### Requirement: 等价 Web Stream Transport
TS Web channel MUST 为同一个 RequestRun 提供等价的 SSE 和 WebSocket stream transport。两种 transport MUST 使用核心契约定义的同一 `StreamEnvelope`、同一 `StreamEventType`、同一 session-scoped sequence、同一 terminal event 语义、同一 safe error boundary 和同一 redaction policy，并且 MUST 复用 `add-ts-run-status-visibility` owning 的共享 projection service。Transport 选择 MUST NOT 改变 runtime lifecycle、RequestRun status、canonical timeline、latest-request 规则、`RuntimeSessionPort.streamEvents(request)` 语义或 terminal commit 行为。

#### Scenario: 同一请求的 SSE 和 WebSocket 输出等价
- **WHEN** 同一个 RequestRun 产生 canonical timeline events
- **THEN** SSE 和 WebSocket MUST 为 stream-visible events 投影相同的用户可见事件序列
- **AND** 两种 transport MUST 暴露相同的 terminal event type 和 safe failure 语义
- **AND** transport-specific framing、heartbeat 或 connection close 行为 MUST NOT 改变 `StreamEnvelope` payload 语义

#### Scenario: Transport 不拥有执行事实
- **WHEN** Web channel 通过 SSE 或 WebSocket 发送 stream events
- **THEN** Web channel MUST 将 runtime timeline 或 runtime status 投影为 `StreamEnvelope`
- **AND** Web channel MUST NOT 创建私有 RequestRun status、私有 terminal state 或与 runtime 竞争的 lifecycle facts
- **AND** transport connection、disconnect 和 heartbeat diagnostics MUST NOT 被记录为 canonical execution timeline facts

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
