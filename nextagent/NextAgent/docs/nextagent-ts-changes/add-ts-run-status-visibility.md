# add-ts-run-status-visibility

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Stream、状态和历史一致性

状态：active
类型：实施 change
主要 owner：`agent-runtime`、`agent-channel-web`、`agent-core`
依赖：`ship-ts-minimal-agent-kernel`

目标：
- 向用户暴露 canonical RunStatus 和 stream event projection；用户可见 stream event 使用 `REQUEST_ACCEPTED`、`LLM_*`、`CAPABILITY_*`、`DEGRADATION_NOTICE`、`REQUEST_COMPLETED/FAILED/CANCELED/SUPERSEDED`、`USER_INPUT_*` 等 canonical 名称，不使用 deprecated projection 名称。

能力组共享输入：

整理状态：已整理为能力组级输入

能力组目标：
- 补实断连、重连、重放和历史读取一致性。

共享规格输入：
- Web channel 不拥有执行事实，只投影 runtime timeline。
- Stream resume/replay 基于 canonical timeline、sequence 和 transport replay 语义。
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

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
