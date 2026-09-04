## Why

电信网络智能体的请求可能持续较长时间。用户在消息推送过程中遇到 stream 断开、页面刷新、SSE/WebSocket transport 切换，或在另一台电脑打开同一会话时，必须能继续观察同一个已经存在的 `RequestRun`，而不是重新执行请求、丢失当前正在生成的内容，或看到静默中断的界面。

本 change 只解决 stream 观察恢复问题。它不治理 terminal result 完整一致性，不新增事实来源，不新增 Web API，不改变 RequestRun lifecycle，不让 Web channel 或前端缓存成为执行事实来源。

## What Changes

- 支持同一页面生命周期内的断线重连：前端使用内存中的 `lastSeenSequence` 恢复 stream，后端 replay `sequence > lastSeenSequence` 的 timeline-backed events，然后继续 live stream。
- 支持页面刷新、新 tab 或换电脑打开执行中会话：前端先读取 conversation bootstrap；若返回 top-level `activeRun { requestId, runId, status }`，前端使用 `activeRun.requestId + activeRun.runId + lastSeenSequence=0` 打开 run-scoped stream，重建当前 active run 已生成但尚未提交为 visible history 的用户可见内容，然后继续 live stream。
- 明确 `lastSeenSequence` 只属于当前页面生命周期内的内存 cursor。页面刷新、新 tab 和新设备不得读取持久化 cursor 作为恢复锚点。
- 明确 `requestId` 和 `runId` 只作为过滤条件，不改变 session-scoped sequence 语义。
- 明确不可恢复时的最小降级行为：后端返回 `STREAM_RESUME_GAP` 或 `STREAM_RESUME_FAILURE` safe details；前端不得推进 cursor，必须先刷新同一会话 visible conversation；refresh 成功后才允许使用 `resumeAfterSequence` 作为下一次 resume anchor。
- 明确 SSE 和 WebSocket 共享同一恢复语义；transport 只负责承载相同 resume 输入。

## 非目标（Out of Scope）

- 不新增 terminal-result Web API、public DTO 或 channel-owned result projection。
- 不定义 terminal facts mismatch、terminal commit pending/failed 的完整状态映射。
- 不做 stream/history/terminal 三方全量一致性治理。
- 不新增 channel-owned replay buffer、history 专用事实表、后台 repair job 或新的 persistence owner。
- 不定义通用 timeline retention window、large payload、contentRef/offload、payload size budget 或跨实例非粘性 replay。
- 不新增 RequestRun 状态、TimelineEventType 或 StreamEventType。
- 不把 batch size、timeout、backpressure、audit/metric 详细 reason 体系作为本 change 的实施范围。

## Capability 影响（Capabilities）

### 新增 Capability

- `ts-stream-resume-replay`: 定义 TS Web stream 在断线、刷新、transport 切换和新设备打开会话时，如何用内存 cursor 或 `activeRun + lastSeenSequence=0` 恢复同一个已存在 `RequestRun` 的用户可见 stream 内容。

### 修改的 Capability

- `ts-core-contracts`: 仅保留 `RuntimeSessionPort.streamEvents`、`RuntimeSessionStreamEventsQuery`、`RuntimeSessionPort.getActiveRun`、`RuntimeGetActiveRunQuery`、`RuntimeActiveRunSummary` 的最小 contract 语义。
- `ts-minimal-agent-kernel`: 仅保留 Web stream 调用 runtime session-facing stream facade、conversation top-level `activeRun?` 投影和 in-memory cursor 语义。
- `ts-web-sse-ws-transports`: 将 SSE/WebSocket 等价 transport 文档中的 runtime stream 入口对齐为 `RuntimeSessionPort.streamEvents`。
- `ts-local-configured-auth`: 将未认证 SSE/WS 拦截文档中的禁止订阅目标对齐为 `RuntimeSessionPort.streamEvents`。
- `trace-log-linking`: 将 channel stream 观测边界文档中的输出入口对齐为 `RuntimeSessionPort.streamEvents`。

## 影响范围（Impact）

- 前端：移除 stream cursor 的 sessionStorage 持久化；`lastSeenSequence` 只保存在 hook/page 生命周期内的内存中。页面刷新、新 tab 或换电脑通过 conversation bootstrap + `activeRun` scoped replay 恢复当前 run。
- Web channel：继续接收 `lastSeenSequence`、可选 `requestId`、可选 `runId`，并调用 runtime session-facing stream facade；不直接拥有 replay fact。
- Runtime：继续从 canonical timeline replay 可恢复 stream events，并在不可恢复时返回 safe gap/failure。
- History refresh：gap 后 refresh 成功才允许使用 `resumeAfterSequence`；refresh 失败保留最后成功接收的 timeline-backed cursor。
- 测试：覆盖内存 cursor 断线重连、刷新/新设备 activeRun 从 0 恢复、legacy sessionStorage cursor 不再生效、gap refresh 成功/失败 cursor 规则、SSE/WS 等价。

## 成功标准

- 同一页面内 stream 断开后，前端用内存 `lastSeenSequence` 只补缺失事件。
- 页面刷新或新设备打开执行中会话时，前端不会因为旧持久化 cursor 跳过当前 active run 已生成内容。
- gap/failure 不推进 cursor；只有同 session visible conversation refresh 成功后才使用 `resumeAfterSequence`。
- SSE 和 WebSocket 对同一 resume 输入产生等价恢复结果。
