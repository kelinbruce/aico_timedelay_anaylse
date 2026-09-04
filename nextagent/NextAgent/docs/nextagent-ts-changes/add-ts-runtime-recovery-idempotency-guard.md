# add-ts-runtime-recovery-idempotency-guard

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Side-effect Idempotency

状态：active
类型：实施 change
主要 owner：`agent-runtime`、`agent-platform-gateway-local`、`agent-capability`
依赖：`add-ts-capability-idempotency-contract`、`add-ts-local-checkpoint-store`、`add-ts-local-run-timeline-store`

目标：
- 在 runtime 恢复流程中基于 checkpoint trigger、timeline、capability result 和 terminal facts 对账；恢复点位于 Tool 调用前且需要重新调用时，必须检查 Tool replay policy 和稳定 idempotencyKey，不支持安全重放则返回 safe error 或 recovery failed。
- 该 change 是完整 `add-ts-local-runtime-recovery` 流程里的 pending Tool replay 安全门，不实现完整恢复扫描、claim/fencing、scheduler rebuild 或 terminal takeover。

能力组共享输入：

整理状态：已整理为能力组级输入

能力组目标：
- 为首版恢复和重试提供最小副作用安全边界，避免 `CapabilityReplayPolicy=NON_IDEMPOTENT` 的 Tool 在不确定状态下被重复执行。

共享规格输入：
- 纳入首版本地 release，但范围限定为 runtime 恢复流程所需的最小副作用安全边界。
- Tool 默认 `CapabilityReplayPolicy=NON_IDEMPOTENT`；必须在 Tool descriptor 中显式声明 `CapabilityReplayPolicy=IDEMPOTENT` 后，runtime recovery 才可考虑重放。
- 支持安全重放的 Tool 必须接受稳定 operationId/idempotencyKey，并在恢复重放时按相同 key 保持可重复调用语义。
- 检查只发生在 runtime 恢复流程中，不发生在 Agent loop 或正常首次 Tool 调用中。
- 已持久化的 capability result 直接复用，不得重复执行 Tool。
- 非幂等、缺稳定 key、checkpoint/message/timeline/terminal facts 不一致时，run 必须进入明确 recovery failed / safe error；不得长期停留在 executing，也不得归类为用户 cancel。
- recovery failed / safe error 必须使用稳定错误码区分失败原因：`RECOVERY_UNSAFE_CAPABILITY_REPLAY`、`RECOVERY_IDEMPOTENCY_KEY_UNAVAILABLE`、`RECOVERY_CAPABILITY_DESCRIPTOR_UNAVAILABLE`、`RECOVERY_CAPABILITY_RESULT_INCONSISTENT`；诊断中不得记录 `idempotencyKey` 原文或 Tool 参数/结果。

并行边界：
- 该能力组只处理 runtime 恢复中的副作用安全，不改变正常首次 Tool 调用、Agent loop、授权、sandbox、policy 或 audit 边界。
- 幂等声明来源于 `add-ts-capability-idempotency-contract` 的 `CapabilityReplayPolicy` 和 stable `idempotencyKey`；本 change 不定义 `isIdempotent` 或另一套 Tool 幂等声明。
- TS 这里额外要求 stable `idempotencyKey` 是有意收紧：最终判断以 `establish-ts-core-contracts` / roadmap 中的 capability invocation 和 checkpoint 契约为准，只以 TS 契约本身作为验收依据。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
