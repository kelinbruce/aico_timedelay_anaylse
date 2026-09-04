## Why

推理模型可能在一次调用中把全部输出 Token 消耗在 reasoning，最终以 `finishReason="length"` 结束，却没有任何用户可见 content 或可执行 Tool call。当前恢复链会先把输出预算提升到更高上限，再对预算提升后仍为空的 reasoning-only 终态注入收敛指令；对已经发散的 reasoning，这一顺序会放大耗时和 Token 消耗，使收敛重试常常在 request 超时前无法发生。HarnessBench 的 `037-policy-clause-retrieval` 与 `021-batch-rename-transform` 已分别复现该黑盒失败：调用耗尽 `16384` completion tokens、可见输出为零，最终只报告通用 `MODEL_TIMEOUT` 或 `TASK_TIMED_OUT`。

本 change 定义“reasoning-only 输出耗尽”为：模型终态明确携带 `incompleteOutputReason="output-limit"`，没有可见 content、没有 Tool call、存在非空 reasoning，且没有 `safeError`。系统需要在扩大预算前先打断该发散状态，并让评测报告在不暴露 reasoning、prompt 或 provider 原始响应的前提下独立标记这种已观测事实。

## Goals

- 对首次 reasoning-only 输出耗尽先执行一次 request-local 收敛重试，保持本次有效 `maxOutputTokens`，不先提升输出预算。
- 收敛重试产出可见回答或完整 Tool call 时恢复正常执行；转为带可见文本的普通 `output-limit` 时复用既有预算提升和有界续写。
- 收敛重试再次形成 reasoning-only 输出耗尽时，禁止继续扩大预算或续写，并进入既有 retryable empty-output/fallback 边界；没有可用 fallback 时在当前有界恢复链内安全失败。
- 在 HarnessBench schema version 5 报告中增加独立的 reasoning-only 输出耗尽观测事实及总数，并提供固定覆盖 `021`、`037` 的非计分回归 profile。
- 保持普通文本超限、残缺 Tool call、取消、direct model 字符硬上限、全量计分和 terminal failure reason 的既有语义不变。

## Non-goals

- 不提高 `maxOutputTokens`、`maxEscalatedOutputTokens`、context window 或 timeout 默认值，也不修改 HarnessBench 上游 task prompt。
- 不新增 provider-specific 产品恢复分支，不要求产品契约暴露 `reasoning_tokens`，不修改 `agent-contracts`、Web、stream、runtime、gateway 或 persistence contract。
- 不用新的观测字段改写 `MODEL_TIMEOUT`、`TASK_TIMED_OUT` 等实际终态原因，不改变 retry、计分或 FES 语义。
- 不把 reasoning、prompt、模型输出、provider raw body、stream delta、主机绝对路径或 credential 写入评测报告。

## What Changes

- **修改** reasoning-only `output-limit` 的恢复顺序：首次命中时在相同输出预算下直接注入一次现有收敛指令，而不是先做 8 倍预算提升。
- **修改** 收敛后的决策边界：有效 content 或完整 Tool call 正常消费；带可见文本的 `output-limit` 进入既有预算提升/续写；再次 reasoning-only 则以既有 retryable empty-output 语义交给 cross-model fallback，且该 route 不再提升预算或续写。
- **保持** 普通 `output-limit` 仍先做一次同请求预算提升，`truncated-tool-call` 仍只允许一次同请求预算提升，所有恢复次数与 cancellation signal 仍以当前 model round 为边界。
- **新增** HarnessBench task 级 `modelReasoningOnlyOutputLimitObserved` 和 diagnostics 级 `modelReasoningOnlyOutputLimitObservedCount`；字段只表达证据是否出现，不替代 terminal status、failure phase 或 failure reason。
- **新增** `reasoning-only-output-exhaustion-regression` 非计分 profile，固定真实执行 `021-batch-rename-transform` 与 `037-policy-clause-retrieval`。

## Context And Prerequisites

- `refine-model-output-completeness` 已建立 `incompleteOutputReason` 与唯一输出恢复入口，必须首先归档。随后 `fix-model-empty-output-recovery` 必须以刷新后的 stable Requirement 为基线重述完整目标态，在保留 incomplete-output decision table 的同时加入“先预算提升、后 reasoning-only 收敛”，再完成归档。本 change 只在这两个前置目标的并集上串行替换恢复顺序，不形成并行实现或丢失行为。
- HarnessBench 报告必须先按 `harden-harnessbench-failure-diagnostics`、`harden-harnessbench-report-truth` 的顺序完成归档，使 schema version 4 成为 stable 输入基线。本 change 再将报告版本唯一提升到 schema version 5。

## Function Impact

### Modified Functions

- `FN-4.1 调用模型`（canonical spec：`model-invocation-contract`）：修改 reasoning-only 输出耗尽的恢复顺序、单轮有界状态转移和安全失败边界；主要影响可靠性/恢复、安全与性能/容量。
- `FN-10.13 HarnessBench 评测`（canonical spec：`harnessbench-evaluation`）：新增安全的 task 级观测事实、聚合计数与固定非计分回归入口；主要影响审计/可追溯性与可靠性/恢复验证。

本 change 不新增、删除或拆分 Function，也不改变 Feature composition。

## Impact

- 预计修改 `agent-core` 的模型 route 恢复状态机与 characterization tests，不修改 provider adapter 或公共模型 contract。
- 预计修改现有 `tests/harnessbench` runner、报告、profile 配置及其测试；证据提取只读取当前 run 内 usage-proxy 已生成的结构化记录，并仅输出布尔值与计数。
- 验收使用固定非计分 profile 真实复跑 `021`、`037`，同时回归普通 length、残缺 Tool call、fallback、取消、报告一致性和全量计分不变性。
