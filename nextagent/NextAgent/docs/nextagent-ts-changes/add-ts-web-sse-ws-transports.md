# add-ts-web-sse-ws-transports

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Stream、状态和历史一致性

状态：active
类型：实施 change
主要 owner：`agent-channel-web`
依赖：`ship-ts-minimal-agent-kernel`

目标：
- 在最小内核 SSE stream 基础上补齐 WebSocket，并验证 SSE 和 WebSocket 保持同一请求生命周期和终态语义。
- 将 `agent-channel-web` 明确收敛为独立 Fastify 插件边界：Web route、stream route、transport-safe error handler 和 transport hook 由该 package 对外暴露，`agent-app` 只负责 composition root 中的插件注册。

规格输入：
- Web channel 不拥有执行事实，只投影 runtime timeline。
- `agent-channel-web` 必须通过独立 Fastify 插件向 `agent-app` 暴露 Web transport；`agent-app` 不得内联注册 channel route、stream route、transport error handler 或 transport hook。
- `agent-channel-web` 内部可以拆分 route/schema/projection 模块，但对 app composition 的公开接入形态必须是稳定插件 contract，而不是 app-local helper。
- local auth 等可选 Web 协作能力继续通过独立 composition package 接入；`agent-channel-web` 不得依赖 `agent-channel-web-auth-local`。
- Stream resume/replay 基于 canonical timeline、sequence 和 transport replay 语义。
- RunStatus 首批使用 `ACCEPTED`、`QUEUED`、`PLANNING`、`EXECUTING`、`COMPLETED`、`FAILED`、`CANCELED`、`SUPERSEDED`。
- TimelineEventType 至少包含 `REQUEST_ACCEPTED`、`PLANNING_STARTED`、`LLM_THINKING_DELTA`、`LLM_CONTENT_DELTA`、`CAPABILITY_RESULT_DELTA`、`CAPABILITY_STARTED`、`CAPABILITY_COMPLETED`、`DEGRADATION_NOTICE`、`REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED`、`REQUEST_SUPERSEDED`、`ATTACHMENT_ACCEPTED`、`ATTACHMENT_REJECTED`、`CONTEXT_COMPACTED`、`POLICY_APPLIED`、`HOOK_DECISION_APPLIED`、`USER_INPUT_REQUIRED`、`USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT`、`USER_INPUT_CANCELED`。
- StreamEventType 至少包含 `REQUEST_ACCEPTED`、`LLM_THINKING_DELTA`、`LLM_CONTENT_DELTA`、`CAPABILITY_STARTED`、`CAPABILITY_RESULT_DELTA`、`CAPABILITY_COMPLETED`、`DEGRADATION_NOTICE`、`REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED`、`REQUEST_SUPERSEDED`、`USER_INPUT_REQUIRED`、`USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT`、`USER_INPUT_CANCELED`、`ATTACHMENT_ACCEPTED`、`ATTACHMENT_REJECTED`、`CONTEXT_COMPACTED`。
- `HOOK_DECISION_APPLIED` 和 `POLICY_APPLIED` 是 timeline-only event，首版不投影为用户可见 stream event。
- 不得使用 `STREAM_STARTED`、`THINKING_SUMMARY`、`CONTENT_DELTA`、`CAPABILITY_PROGRESS`、`CAPABILITY_FINISHED`、`CAPABILITY_DISCOVERED` 等 deprecated projection 名称。
- `USER_INPUT_REQUIRED` 的用户可见 payload 使用 `PendingInputRequest` 形态，只包含 `id`、`sessionId`、`kind`、`questions`、`timeoutAt`。
- `USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT`、`USER_INPUT_CANCELED` 使用 pending input id、kind、status 和安全摘要字段，不包含 timeout behavior、identity、idempotency key、raw answer 或 model-formatted answer。

契约输入：
- `RunTimelineEvent`、`StreamEnvelope`、`RuntimeTimelinePort.stream(...)`、`RunStatus`、`TimelineEventType` 和 `StreamEventType` 继续继承已冻结核心 channel/runtime 契约。
- `PendingInputRequest` 继续作为 `USER_INPUT_REQUIRED` 的用户可见 payload contract。
- Fastify 作为当前唯一 Web transport plugin 技术栈边界。

实现约束：
- `agent-channel-web` 必须对 app composition 暴露单一稳定的 Fastify transport plugin contract；`agent-app` 只负责 `register(...)` 和注入依赖。
- Web route、stream route、transport-safe error handler 和 transport hook 必须归 `agent-channel-web` owner，不得散落进 `agent-app`。
- SSE 与 WebSocket 必须共享同一 runtime lifecycle、timeline replay 和 terminal semantics；不得各自定义第二套执行事实或终态规则。
- `agent-channel-web` 不得依赖 `agent-channel-web-auth-local` 或其他可选 composition plugin package。

非目标：
- 不重新定义 runtime canonical fact、session/message durable fact、request lifecycle 或 terminal commit 语义。
- 不在本 change 中扩大 local auth、安全策略或前端静态资源托管范围。

验收要点：
- `agent-app` 通过 Fastify `register(...)` 方式接入 `agent-channel-web`，而不是内联散落 route 注册。
- `agent-channel-web` 暴露稳定的 Web transport Fastify 插件 contract，并保持 SSE / WebSocket 共用同一 runtime lifecycle 与终态语义。
- `agent-channel-web` 不依赖 `agent-channel-web-auth-local`；local auth 仍通过独立 package 由 local 产品入口显式注册。

并行边界：
- 不得让 Web channel 拥有执行事实。
- stream resume 只能投影 runtime timeline。
- 本 change 优化 `agent-channel-web` 的插件化 route registration 与 SSE/WS transport 组织方式，但不得改变 runtime canonical fact、session/message durable fact owner 或 local auth 的独立 optional package 边界。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
