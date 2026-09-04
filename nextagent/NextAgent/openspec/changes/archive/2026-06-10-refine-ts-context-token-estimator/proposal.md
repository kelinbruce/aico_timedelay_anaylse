## Why

`add-ts-context-prompt-shaping` 在 design.md §313、proposal.md 146、tasks §1.9 / §2.14 / §6.8 反复声明它"拥有" `TokenEstimator` 接口与默认码点感知实现，但是：

- 它**自身有 implementation gate**——proposal 明写不得在 6 个 active sibling change 全部 archive 之前起跑。
- 而那 6 个 sibling 中的 `add-ts-context-budget-explainability` 自己**也需要** `TokenEstimator`，用来按源类别给出 `estimatedInputUnits`、计算 `availableInputUnits`、产出 `ContextBudgetEvidence`。

结果是循环依赖：budget-explainability 实现需要 token estimator → 但它由 prompt-shaping 拥有 → prompt-shaping 起跑需要 budget-explainability 先 archive。

token estimator 本身在 design 维度并不归属任何上层 feature——它是上下文工程链路上的通用工具（budget / shaping / memory / capability 都会消费）。把它抽成独立 contract refinement change 先于双方落地，是打破循环依赖的最干净办法。

跟 `refine-ts-model-profile-context-window` 完全对称：那次是把 `ModelProfile.contextWindowTokens` 字段从 budget-explainability 的 prereq 反向假设变成真实契约；这次是把 `TokenEstimator` 接口与默认实现从 prompt-shaping 的"将来由我落地"承诺变成真实可用契约。

## What Changes

- 在 `agent-contracts/context` 新增 `TokenEstimator` 接口（4 个方法：`estimateTokens` / `estimateMessageTokens` / `estimateToolMessageTokens` / `estimateTokensBatch`）和必要的 overhead 常量类型，**不**改变现有 context 契约其他字段，**不**新增 `agent-contracts` 子路径。
- 在 `agent-context-engine` 内新增 `DefaultTokenEstimator` 实现：按 Unicode code point 迭代（用 `codePointAt`，不用 UTF-16 length 避免 surrogate pair 切错），加权 ASCII ×0.25 / CJK 基本面 ×1.5 / 增补面 ×2.0 / 其它 BMP ×1.0；`Math.max(1, Math.ceil(weightedSum))` 作为非空文本下限；空字符串返回 0。
- 实现 message overhead 常量与 tool-message overhead 常量（按公开 OpenAI tokenizer overhead 经验值 4 / 10 取默认；可替换实现可以重定义）。
- 同步 `add-ts-context-prompt-shaping` 的 tasks §1.9 / §2.14 / §6.8：标记为"已由 refine-ts-context-token-estimator 落地，本 change 仅消费"。
- 不改 `agent-channel-web` 里既有 `tokenEstimate` projection 字段（那只是 stream payload 的可选字段，跟新接口同名但语义无关）。

## Capabilities

- 新增 `context-token-estimator` 作为 contract-refinement capability。
- 不实现 budget 决策、prompt shaping、memory retrieval、capability disclosure 或任何 token 消费侧逻辑——这些仍由各自 sibling change 在消费 `TokenEstimator` 接口时实现。

## Impact

- `add-ts-context-budget-explainability` 消费本 change 冻结的 `TokenEstimator` 作为 `ContextSourceCandidate.estimatedInputUnits` 与 `availableInputUnits` 计算的统一估算源；不再自己定义估算策略。
- `add-ts-context-prompt-shaping` 的 §1.9 / §2.14 / §6.8 由本 change 实质兑现；prompt-shaping 实现期只读 `DefaultTokenEstimator`，不重新拥有它。
- `add-ts-memory` / `add-ts-capability-*` 等未来上游消费方可以从同一处获得稳定的 token 估算工具，不再需要各自重新发明。

## Baseline Promotion Plan

实现并验证后，把契约提炼到：

- `openspec/specs/context-token-estimator/spec.md`（新建 baseline）
- `openspec/designs/architecture/core-contracts.md`（在 context contract 段记录 `TokenEstimator` 接口 + 默认实现位置）
