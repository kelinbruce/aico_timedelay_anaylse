## 背景与问题（Why）

首版本地 release 需要同时支持 SSE 和 WebSocket stream，但它们不能变成两套请求生命周期。系统已经有 runtime canonical timeline，Web channel 的职责应当是把这条 timeline 安全投影给客户端。

本 change 的第一性原理是：同一个 RequestRun 只有一条 canonical timeline；SSE 和 WebSocket 只是两种 delivery adapter。Transport 可以建连、发送、关闭和报告安全诊断，但不能拥有执行事实、重排 runtime 状态或发明终态。

如果 SSE 和 WebSocket 各自解释状态、终态、重放或错误，前端会被迫维护两套生命周期逻辑，用户也可能在不同 transport 上看到不同结果。首版要解决的不是完整 stream 平台，而是保证同一请求在两种 transport 下黑盒效果一致。

## 变更范围（What Changes）

- 新增 Web stream transport 行为契约：SSE 和 WebSocket MUST 使用同一 `StreamEnvelope`、同一 `StreamEventType`、同一 sequence、同一 terminal event 语义和同一 safe error boundary。
- 明确核心实现策略：Web channel 复用 `add-ts-run-status-visibility` 定义的共享 status/stream projection 服务；SSE 和 WebSocket 只承担 transport delivery 差异。
- 明确触发机制：请求提交仍进入 runtime command boundary；stream connect/subscribe 只读取 runtime timeline 并异步投影，不驱动执行进度。
- 新增 Web runtime bootstrap transport selection 契约：Web channel 必须向浏览器提供安全 bootstrap config projection，包含 `transportKind: "SSE" | "WEBSOCKET"`；该值只能来自可信 app/channel 配置，产品路径前端必须消费该 projection 后选择 transport，不能由客户端 query、body、localStorage 或模型/能力输出覆盖。
- 明确输入前置条件：trusted identity、session/request/run coordinates、transport kind、可选 `lastSeenSequence`、`RuntimeTimelinePort.stream(request)`、共享 projection service 和 safe transport error boundary。
- 明确核心逻辑：校验身份和 owner scope，构造 `RuntimeTimelineStreamRequest`，消费 runtime timeline stream 返回的 recoverable events 和 live events，调用共享 projection service 产生 `StreamEnvelope`，并按 subscription scope 处理 terminal delivery。
- 明确 subscription scope：带 `requestId` 或 `runId` 的 request/run-scoped stream 在对应 terminal event delivery 后完成；未带 request/run filter 的 session-scoped live stream MUST 在投影 terminal event 后继续保持订阅，直到客户端断开、服务关闭或 transport timeout。
- 明确 subscription cleanup：客户端断开、WebSocket close、transport timeout 或 server shutdown 必须清理对应 runtime timeline subscription；清理不得伪造 terminal event。
- 明确失败边界：unauthorized、not found、invalid replay anchor、timeline read failure、projection/serialization failure 必须显式 safe fail；不得静默丢弃、静默截断或伪造 completed。
- 明确非职责：不新增 runtime lifecycle，不新增 stream 事件平台，不做跨实例 fan-out，不把 transport diagnostic 写入 canonical timeline。

BREAKING：无。当前 TS 后端尚未形成稳定 Web stream transport 基线。

## 与当前基线和相邻 change 的边界

- 继承 `ts-core-contracts` 已冻结的 SSE/WS equivalent stream envelope、`lastSeenSequence`、`RuntimeTimelinePort.stream(request)` 和 terminal semantics；本 change 不修改核心 stream contract。
- 继承 `ts-minimal-agent-kernel` 已实现的最小 SSE 行为；本 change 的新增点是把 WebSocket 接入同一共享 projection/delivery 策略，并补齐两种 transport 的等价验证。
- 和 `add-ts-run-status-visibility` 的边界是：status visibility owning canonical projection vocabulary/status semantics、timeline-to-`StreamEnvelope` 映射和 payload redaction；本 change 只消费该 projection 输出，owning transport subscription、framing、heartbeat、close、replay anchor validation、subscription cleanup 和 SSE/WS equivalence。
- 和 runtime/bootstrap config 的边界是：本 change owning Web stream transport selection projection；bootstrap config 只暴露 channel-safe `transportKind` 等非身份、非 owner、非 lifecycle 字段，不暴露 stream cursor、run state、owner scope、credential 或 deployment secret。前端构建期 `VITE_TRANSPORT_KIND` 只能作为 dev/mock fallback，不是产品路径事实源。
- 和当前 frontend session cursor 语义的边界是：session-scoped stream 使用 session-level `lastSeenSequence` 持续观察同一 session；terminal event 只表示对应 RequestRun 结束，不代表整个 session stream 结束。
- 不定义 cancel、retry、pending input answer、attachment download、跨实例 fan-out、独立 stream state store、delivery audit sink 或 runtime lifecycle。

## Capability 影响（Capabilities）

### 新增 Capability
- `ts-web-sse-ws-transports`: 定义 TS Web channel 中 SSE 和 WebSocket 对同一 RequestRun 的等价 stream 投影、replay、terminal 和 safe failure 契约。

### 修改的 Capability
- 无。

## 影响范围（Impact）

- 代码：主要影响 `agent-channel-web`；通过既有 runtime/session/gateway contracts 读取 timeline 和校验 owner scope，并复用 status visibility projection service。
- API/事件：固化 SSE endpoint、WebSocket subscribe 和 `StreamEnvelope` 投影语义；不修改 runtime timeline ownership 或 terminal commit。
- 配置：仅允许 transport enablement、bootstrap `transportKind` projection、heartbeat/timeout 等 adapter 参数；配置不得改变 stream vocabulary 或 lifecycle 语义，客户端不得覆盖服务端选定的产品 transport。
- 测试：以最小闭环验证 projection service 接入、SSE/WS 等价、replay、terminal、subscription cleanup、owner scope 和 safe failure。
- 运维：仅记录必要的 stream open/close/replay/failure 安全日志或 metric；不记录 raw prompt、raw model output、tool args/result、secret、credential 或未授权对象内容。

## KISS 边界

首版只交付一套 projection service 接入流程和两个薄 transport adapter：

- 必做：复用统一 envelope、统一 session-scoped sequence 投影、统一 terminal、统一 safe error；SSE/WS 仅在 transport delivery 层分叉。
- 延后：跨实例 stream fan-out、外部消息总线、复杂 delivery audit、完整吞吐优化、独立 stream 状态存储。

## 归档前基线提升计划（Baseline Promotion Plan）

- `openspec/specs/ts-web-sse-ws-transports/spec.md`：提升 SSE/WS 等价、replay、terminal 和 safe failure 行为契约。
- `openspec/designs/architecture/web-stream-transports.md`：按需记录 endpoint/subscription、`StreamEnvelope` 和 replay anchor 契约。
- `openspec/designs/modules/agent-channel-web.md`：按需记录 Web channel 只做 projection 和 adapter I/O 的职责边界。
- `openspec/designs/adr/<next-id>-web-stream-transport-equivalence.md`：如果实现中出现替代方案争议，再使用归档时下一个可用编号记录 projection service 接入和 transport equivalence 决策。
