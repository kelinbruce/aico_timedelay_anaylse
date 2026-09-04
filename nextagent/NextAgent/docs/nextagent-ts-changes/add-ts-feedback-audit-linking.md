# add-ts-feedback-audit-linking

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Answer Feedback

状态：ready
类型：实施 change
主要 owner：`agent-observability`、`FeedbackStoreGateway`、audit ports
依赖：`add-ts-answer-feedback`、`add-ts-audit-sink`

目标：
- 将 feedback 与 tenantId、subjectId、sessionId、requestRunId、messageId 和 audit event 关联；记录 feedback.submitted/rejected，并执行 redaction policy 和 owner-scope 可见性约束。

能力组共享输入：

整理状态：已整理为能力组级输入

能力组目标：
- 支持用户对已完成回答提交反馈，并将反馈与 owner、session、request run、message 和 audit 关联。

共享规格输入：
- Feedback 纳入首版本地 release。
- Feedback 持久化端口命名为 `FeedbackStoreGateway`。
- Feedback 是用户对已完成结果的后置评价，不得重新打开 request run、改写历史消息、触发模型重跑或绕过 audit/redaction。
- 首版采用 1-5 星评分，不采用点赞/点踩。
- 用户可以选择预设备注，或输入备注；输入备注上限为 500 字符并经过 redaction policy。
- 首版不提供更新或撤销能力。
- 同一用户对同一 answer 的重复提交应返回 safe error 或明确的 duplicate outcome。
- 首版 reason code 包括 `helpful`、`incorrect`、`incomplete`、`unsafe`、`too_slow`、`not_relevant`、`format_issue`、`other`。
- Feedback record 至少包含 `feedbackId`、`tenantId`、`subjectId`、`sessionId`、`requestRunId`、`messageId`、`rating`、`reasonCode`、`comment`、`submittedAt`。
- audit event 至少包括 `feedback.submitted` 和 `feedback.rejected`。
- 用户只能查询自己 owner scope 下的 feedback。
- 运维/审计视图可以按 run、message、session 聚合，并可通过日志/trace 进一步定位，但必须执行 redaction policy。
- feedback comment 必须走 redaction policy，不得把 raw sensitive content 写入 audit。
- rejected 场景至少包括非 owner message、message 不是已完成 Agent answer、重复提交、rating 非 1-5、reason code 非法、comment 超长或被安全策略拒绝。

并行边界：
- feedback 不改变原 answer，不改变 request terminal state。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
