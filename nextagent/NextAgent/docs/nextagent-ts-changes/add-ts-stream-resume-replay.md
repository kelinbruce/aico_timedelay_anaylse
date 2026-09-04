# add-ts-stream-resume-replay

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Stream、状态和历史一致性

状态：active
类型：实施 change
主要 owner：`agent-channel-web`、`agent-runtime`、gateway timeline port
依赖：`ship-ts-minimal-agent-kernel`

目标：
- 支持客户端在断连、刷新或切换 SSE/WS 后，携带最后成功接收的 session timeline sequence 继续观察同一个已存在 RequestRun。
- 从 runtime canonical timeline 重放可恢复已提交事件，再衔接 live stream。
- 对不可恢复 gap 或失败输出明确 safe notice，不重跑请求、不静默截断、不伪造 completed。

能力组共享输入：

整理状态：已整理为能力组级输入

能力组目标：
- 补实断连、重连和重放观察恢复；history refresh 的完整一致性由 `add-ts-stream-history-consistency` 承接。

共享规格输入：
- Web channel 不拥有执行事实，只投影 runtime timeline。
- Stream resume/replay 基于 runtime canonical timeline、`lastSeenSequence` 和可恢复 replay 语义。
- Channel 通过 `RuntimeEventStreamPort.stream({ sessionId, lastSeenSequence, requestId?, runId? })` 读取 timeline，返回值是 `AsyncIterable<RunTimelineEvent>`。
- `lastSeenSequence` 表示调用方最后成功接收的 session timeline sequence；runtime stream 返回同一 session 下 `sequence > lastSeenSequence` 的可恢复事件和后续 live 事件。
- Timeline sequence 是 session 级游标，使用 JS safe integer 范围内的非负整数；canonical event sequence 从 1 开始，`lastSeenSequence=0` 表示调用方尚未接收任何事件。
- Timeline sequence 在同一 session 内单调递增，不按 run 重置，不允许回绕、取模或复用；`requestId`、`runId` 只作为过滤条件。
- 多实例部署下，同一 session 内并发产生的 timeline event 不得获得重复 sequence，也不得以破坏 sequence 顺序的方式对外发布；该 change 不规定具体协调机制。
- `RunTimelineEventStoreGateway.listEvents` 必须按 `sessionId + afterSequence` 查询，可选按 `requestId`、`runId` 过滤。
- canonical timeline event 的持久化和查询使用 `RunTimelineEventStoreGateway`；不得用 execution trace store、channel replay buffer 或 live hub 代替。
- Delta timeline event 不要求持久化；每个 delta event 必须携带当前 delta stream 的累计全量。
- Replay 可以从 `lastSeenSequence` 之后最近的可恢复 event 继续，不要求补齐每一个 sequence。
- Stream replay 恢复运行过程事实；历史对话展示以 visible `SessionMessage` 为最终内容事实来源。
- Channel 不实现自己的 canonical replay 规则；channel 只做 `RunTimelineEvent` 到 `StreamEnvelope` 的安全投影和传输。
- `maxReplayBatchEvents=1000` 是单批 timeline 读取/投影大小，不是总 replay 上限，不是 retention window；backlog 超过 1000 时必须分页读取，不得因此产生 gap。
- `timelineReadTimeoutMs=5000` 是单次 timeline 读取等待上限；`streamBackpressureTimeoutMs=15000` 是单个 stream envelope 写入/等待 drain 的上限。达到 timeout 输出对应 safe failure 或 stream notice，不推进 cursor，不跳过未成功写入 transport 的 timeline sequence。
- `lastSeenSequence` 只由成功接收的 timeline-backed `StreamEnvelope.sequence` 推进；safe outcome、stream notice、gap notice、projection failure 和 handshake failure 不推进 cursor。
- Gap reason code 固定为 `ANCHOR_BEFORE_RECOVERABLE_WINDOW`、`DELTA_STATE_NOT_RECOVERABLE`、`TIMELINE_CONTINUITY_LOST`。
- Failure reason code 固定为 `VALIDATION_FAILED`、`UNAUTHORIZED`、`TIMELINE_READ_FAILED`、`TIMELINE_READ_TIMEOUT`、`PROJECTION_FAILED`、`BACKPRESSURE_TIMEOUT`、`TRANSPORT_CLOSED`。
- Gap notice 必须包含 fixed reason code、`retryable`、`refreshConversation=true` 和 `resumeAfterSequence`；`resumeAfterSequence` 必须是服务端确认的当前可安全观察锚点。
- `resumeAfterSequence` 不是 cursor，不推进 `lastSeenSequence`；客户端必须先刷新同一 session 的 visible conversation，refresh 成功后下一次 resume request 使用 `lastSeenSequence=resumeAfterSequence`，refresh 失败时继续保留最后成功接收的 timeline-backed sequence。
- Projection failure 不得跳过失败 event 的 sequence，不得继续发送后续 sequence，不得推进 cursor。
- `runId` scoped stream replay 到 terminal 后结束；session-level stream 和 requestId-only stream 不因某个 run terminal 自动关闭。
- RunStatus 首批使用 `ACCEPTED`、`QUEUED`、`PLANNING`、`EXECUTING`、`COMPLETED`、`FAILED`、`CANCELED`、`SUPERSEDED`。
- TimelineEventType 至少包含 `REQUEST_ACCEPTED`、`PLANNING_STARTED`、`LLM_THINKING_DELTA`、`LLM_CONTENT_DELTA`、`CAPABILITY_RESULT_DELTA`、`CAPABILITY_STARTED`、`CAPABILITY_COMPLETED`、`DEGRADATION_NOTICE`、`REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED`、`REQUEST_SUPERSEDED`、`ATTACHMENT_ACCEPTED`、`ATTACHMENT_REJECTED`、`CONTEXT_COMPACTED`、`POLICY_APPLIED`、`HOOK_DECISION_APPLIED`、`USER_INPUT_REQUIRED`、`USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT`、`USER_INPUT_CANCELED`。
- StreamEventType 至少包含 `REQUEST_ACCEPTED`、`LLM_THINKING_DELTA`、`LLM_CONTENT_DELTA`、`CAPABILITY_STARTED`、`CAPABILITY_RESULT_DELTA`、`CAPABILITY_COMPLETED`、`DEGRADATION_NOTICE`、`REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED`、`REQUEST_SUPERSEDED`、`USER_INPUT_REQUIRED`、`USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT`、`USER_INPUT_CANCELED`、`ATTACHMENT_ACCEPTED`、`ATTACHMENT_REJECTED`、`CONTEXT_COMPACTED`。
- `HOOK_DECISION_APPLIED` 和 `POLICY_APPLIED` 是 timeline-only event，首版不投影为用户可见 stream event。
- 不得使用 `STREAM_STARTED`、`THINKING_SUMMARY`、`CONTENT_DELTA`、`CAPABILITY_PROGRESS`、`CAPABILITY_FINISHED`、`CAPABILITY_DISCOVERED` 等 deprecated projection 名称。
- `USER_INPUT_REQUIRED` 的用户可见 payload 使用 `PendingInputRequest` 形态，只包含 `id`、`sessionId`、`kind`、`questions`、`timeoutAt`。
- `USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT`、`USER_INPUT_CANCELED` 使用 pending input id、kind、status 和安全摘要字段，不包含 timeout behavior、identity、idempotency key、raw answer 或 model-formatted answer。

并行边界：
- 不得让 Web channel 拥有执行事实。
- stream resume 只能投影 runtime timeline。
- 不得新增 channel-owned durable replay source 或把 delta 持久化策略放入 channel。
- 不得新增 in-band WebSocket resume message；SSE 和 WebSocket 只通过连接参数或 handshake framing 归一化为同一 resume 输入语义。
- 不得在本 change 定义 timeline retention window、stream payload size budget、`payload > 256KiB` 行为、large delta contentRef 协议、conversation page limit 或完整 history consistency。
- 不得通过 timeline event 重建最终会话历史；gap 或 delta 不可恢复时只能触发 history refresh 建议，完整 refresh 一致性由后续 change 承接。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
- 本 change 不新增、重命名或重定义 `agent-contracts` public DTO；目标仓库缺少 `RunTimelineEventRecordQuery.limit` 时，必须先完成独立 contract refinement change。
