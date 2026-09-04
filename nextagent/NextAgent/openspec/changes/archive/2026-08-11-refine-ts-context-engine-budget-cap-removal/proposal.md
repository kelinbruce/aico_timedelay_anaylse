## Why

归档稳定 spec `openspec/specs/context-engine/spec.md` 仍把 "60% prior-history budget cap" 作为稳定硬约束（共 6 处提及：L155、L179、L187、L201 Appendix H1-a、L307、L844），并通过 Appendix H1-a 声明该 cap 是 "the OUTER cap on prior-history context"，与 `large-content-references` 阈值构成双向交叉引用。

默认 budget policy 实现已移除该 cap。`packages/agent-context-engine/src/budget/default-proportional-budget-policy.ts` L20 注释明确声明 "The earlier 60% proportional history-budget cap has been REMOVED"，L87 注释确认 "Optional candidates are no longer omitted to fit a proportional history budget"。当前默认 policy 选全部 required + optional 候选，不 omit、不 degrade；上下文溢出由 `assemble-context.ts` 的 proactive auto-compact headroom（`DEFAULT_AUTO_COMPACT_HEADROOM_UNITS = 13_000`）唯一治理。

spec 承诺的 cap 行为与代码实现不一致：spec 说历史上下文不得超过 60% 窗口、超出部分必须先压缩/裁剪/摘要/降级，代码不再执行该截断。按 AGENTS.md「不得把未被 OpenSpec 定义的行为直接写进实现」和「同形同策」，这是归档 spec 不变量与实现的真实偏离。本 change 修订 spec 使其与已发布的代码目标态一致。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 移除 `context-engine` spec 中全部 60% prior-history budget cap 语言，包括 Appendix H1-a 的 OUTER cap 声明和 H1 交叉引用中对 60% 的依赖。
- 保留 minimum safe current-request context 保护不变量：root user message、current-request protocol-required messages 和 latest-request-required attachment context 不被静默丢弃以腾出历史空间。
- 保留 large-content 阈值独立 offload 不变量：`inline-max-bytes`、`aggregate-max-chars`、`preview-max-chars` 阈值独立于 history budget，互不替代、不互相覆盖。
- 使 spec 反映代码实际行为：默认 budget policy 不 omit/degrade 候选，上下文溢出由 proactive auto-compact strategy 治理。

**非目标：**

- 不把 `preSendCheckRatio = 0.885` 或 `autoCompactHeadroomUnits = 13_000` 写入稳定 spec。这些是默认 policy 的实现参数，非决策关口不变量；替换 policy 可调整。写入会过度固化实现细节。
- 不处理 `context-engine` spec L217-317 与 L754-855 的 large-content Requirement 重复块。这是归档 promotion 遗留产物，需单独 change 修复；本 change 只确保两处 60% 提及都被移除。
- 不改 `ContextCompactionDecision` 合约值 `compact_degrade`。该值仍保留在 union 中供自定义替换 policy 使用；默认 policy 不发出它，但合约不禁止。
- 不改代码。`default-proportional-budget-policy.ts`、`assemble-context.ts`、`agent-contracts/src/context/index.ts` 均已是目标态，无需修改。
- 不创建 `openspec/specs/query-policy/spec.md`。原 `add-ts-context-budget-explainability` 设计意图把 cap 参数放在 query-policy spec，但该 spec 从未 promote；本 change 不补建。
- 不改 `BudgetReasonCode` union 中的 `HISTORY_OMITTED_TO_BUDGET`、`HISTORY_DEGRADED_TO_BUDGET` 等值。它们仍可供自定义 policy 和 evidence 投影使用。

## What Changes

- MODIFIED `Context Engine protects minimum safe current-request context`：删除 60% prior-history budget cap 引用，保留 minimum safe context 保护；重写 Appendix H1-a，移除 OUTER cap 语言，保留 large-content 阈值独立 offload 不变量。
- MODIFIED `Large-content thresholds referenced from context-engine are fixed`（两处重复块均修改）：删除 aggregate offload 顺序规则中对 60% history window budget 的引用，保留 offload 顺序主体。
- 更新 Source blockquote（L155）中的 H1 interlock 描述：去掉 `60% history cap vs` 前缀。

## Feature 影响（Features）

### 修改的 Feature

- `F-4.4 上下文窗口自适应与预算可解释`：移除"历史上下文预算 ≤60% 模型窗口"的规格描述，使 Feature 描述与代码实际行为一致；Context Engine 仍独占 history selection、window budget、compaction、prompt shaping 和 render 前 budget evidence 计算。组成 Functions 不变。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-4.3 装配上下文` → `specs/context-engine/spec.md`
  - 功能边界：移除归档 spec 中 60% prior-history budget cap 的 OUTER cap 声明和 H1-a 双向交叉引用的 60% 依赖；保留 minimum safe context 保护不变量和 large-content 阈值独立 offload 不变量。不改变 budget policy port 合约、ContextCompactionDecision 合约值或 evidence 投影契约。
  - 系统质量属性：可靠性/恢复。
  - 映射说明：canonical spec；本 change 不触及 legacy spec。

## 影响范围（Impact）

- 最终用户：无行为变化。默认 budget policy 早已不执行 60% cap；本 change 只修订 spec 文本。
- 智能体开发者：替换 `ContextBudgetPolicyPort` 的自定义 policy 不再需要遵守 60% cap 约束（实际早已如此，spec 现在正式确认）。仍须遵守四个决策关口不变量：minimum safe context 保护、explicit_failure、evidence 完整性和四值 decision 收敛。
- 运维与诊断：budget evidence 仍记录每个 source category 的 selected/omitted/degraded 状态和 reason code；默认 policy 当前只产生 `WITHIN_BUDGET`、`PRE_SEND_CHECK_REQUIRED`、`MINIMUM_SAFE_CONTEXT_EXCEEDS_BUDGET` 和 `INSUFFICIENT_CONTEXT`。
- 代码与验证：不改代码；`default-proportional-budget-policy.test.ts` 已断言 "60% cap removed" 和 "0.885 ratio"，无需修改。
