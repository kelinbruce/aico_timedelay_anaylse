# add-ts-risk-policy-enforcement

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Policy Hooks

状态：active
类型：实施 change
主要 owner：`agent-runtime`
协作 owner：`agent-capability`、`agent-observability`
依赖：`add-ts-lifecycle-hook-execution`、`add-ts-authorization-pending-input`、`refine-ts-risk-policy-contract`

目标：
- 支持系统内置 risk policy 在 capability、sandbox、authorization/high-risk confirmation 等受限操作前执行；risk policy 使用最小专用 evaluator contract，不依赖泛化 `PolicyPort`。

能力组共享输入：

整理状态：已整理为能力组级输入

能力组目标：
- 提供首版最小 risk policy enforcement，并与 lifecycle hook execution 保持清晰边界。

共享规格输入：
- 首版纳入最小 risk policy enforcement，但复杂扩展后置。
- 核心契约不定义泛化 `PolicyPort`；risk policy 仅通过 `refine-ts-risk-policy-contract` 提供最小专用 evaluator contract。
- 最小 contract 清单仅包含：`agent-common` 的 `RiskPolicyOutcome` / `RiskLevel` / `RestrictedOperationKind`，`agent-contracts/runtime` 的 `RestrictedOperationSummary` / `RiskPolicyEvaluationInput` / `RiskPolicyDecision` / `RiskPolicyAuthorizationIntent` / `RiskPolicyEvaluator`，`agent-contracts/gateway` 的 `AuthorizationScopeRecord` 与 `PendingInputRecord.authorizationScope?`，以及 `agent-contracts/observability` 的 `RiskPolicyEvaluation`。
- `add-ts-risk-policy-enforcement` 支持系统内置 risk policy 在 capability、sandbox、authorization/high-risk confirmation 等受限操作前执行。
- risk policy 执行结果如需形成执行事实，写入 timeline-only `POLICY_APPLIED`；首版不新增对应 `StreamEventType`。
- 首版不开放插件热加载、远端 hook 或脚本 hook。
- Policy/hook 不拥有 RequestRun、checkpoint、terminal commit 或 channel state。

并行边界：
- 首版 risk policy 只支持系统内置执行路径，不提供开放式策略插件生态。
- `agent-runtime` 拥有 policy evaluation orchestration、authorization scope 消费和 `POLICY_APPLIED` 写入；`agent-capability` 只提供受限操作摘要并按 outcome 执行或停止；`agent-observability` 只消费安全观测事实。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
