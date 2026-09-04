# add-ts-stream-history-consistency

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Stream、状态和历史一致性

状态：active
类型：实施 change
主要 owner：`agent-session`、`agent-runtime`、`agent-channel-web`
依赖：`add-ts-stream-resume-replay`

目标：
- 保证恢复后的 stream、历史读取和 request terminal result 一致。

能力组共享输入：

整理状态：已整理为能力组级输入

能力组目标：
- 补实断连、重连、重放和历史读取一致性。

共享规格输入：
- Web channel 不拥有执行事实，只投影 runtime timeline。
- Stream resume/replay 基于 runtime canonical timeline、`lastSeenSequence` 和可恢复 replay 语义。
- Channel 通过 `RuntimeTimelinePort.stream({ sessionId, lastSeenSequence, requestId?, runId? })` 读取 timeline，返回值是 `AsyncIterable<RunTimelineEvent>`。
- `lastSeenSequence` 表示调用方最后成功接收的 session timeline sequence；runtime stream 返回同一 session 下 `sequence > lastSeenSequence` 的可恢复事件和后续 live 事件。
- Timeline sequence 是 session 级游标，使用 JS safe integer 范围内的非负整数；canonical event sequence 从 1 开始，`lastSeenSequence=0` 表示调用方尚未接收任何事件。
- Timeline sequence 在同一 session 内单调递增，不按 run 重置，不允许回绕、取模或复用；`requestId`、`runId` 只作为过滤条件。
- 多实例部署下，同一 session 内并发产生的 timeline event 不得获得重复 sequence，也不得以破坏 sequence 顺序的方式对外发布；该 change 不规定具体协调机制。
- `RunTimelineEventStoreGateway.listEvents` 必须按 `sessionId + afterSequence` 查询，可选按 `requestId`、`runId` 过滤。
- canonical timeline event 的持久化和查询使用 `RunTimelineEventStoreGateway`；不得用 execution trace store、channel replay buffer 或 live hub 代替。
- Delta timeline event 不要求持久化；每个 delta event 必须携带当前 delta stream 的累计全量。
- Replay 可以从 `lastSeenSequence` 之后最近的可恢复 event 继续，不要求补齐每一个 sequence。
- 历史读取、terminal result 和 stream 投影必须以 runtime/session/gateway durable facts 为准，不能以 channel 内存缓冲作为事实来源。
- Stream replay 恢复运行过程事实；历史对话展示以 visible `SessionMessage` 为最终内容事实来源，不得通过 timeline event 重建最终会话历史。
- 历史会话列表使用 `SessionStoreGateway.listSessions(SessionHistoryQuery): SessionHistoryPage`。
- 历史对话消息读取使用 `SessionMessageStoreGateway.listConversationMessages(SessionConversationQuery): SessionConversationPage`。
- 当前 request/run 范围内的消息读取使用 `SessionMessageStoreGateway.listCurrentRequestMessages(CurrentRequestConversationRecordQuery): SessionConversationRecordPage`，再由 session/runtime 领域层映射为历史展示 read model。
- `SessionHistoryQuery`、`SessionConversationQuery` 必须显式携带 `tenantId`、`subjectId`。
- 默认历史读取必须排除 hidden `SessionMessage`；只有显式 `includeHidden=true` 的查询才返回 hidden message。
- `visible=false` 只影响会话历史默认视图，不负责移除模型上下文；模型可见上下文由 active context view 控制。
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
- gap 或 delta 不可恢复时必须触发 history refresh，不得由 channel 私有规则重建最终内容。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
