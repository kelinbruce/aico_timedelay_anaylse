## 背景与问题（Why）

当前 Context Engine 的 summary compression 是**反应式**触发：在 `assemble()` 内，仅当预算门（`DefaultProportionalBudgetPolicy`）把 `prior_active_history` 标记为 omitted（即历史超出 60% history budget cap、装不下才被动丢弃）时，`processBudgetOutcome` 才在 `assemble-context.ts` 中调用 `runSummaryCompression`。也就是说，系统只有在"已经发生历史被丢弃"时才压缩，而不是在"接近但尚未超出窗口"时主动压缩。

这带来两个真实问题：

1. **压缩时机滞后**：对话 token 数已经逼近有效上下文窗口上限时仍不压缩，直到历史被迫 omit 才触发。在 omit 发生那一轮，模型可见历史已经被砍掉一段，存在信息丢失风险；且压缩与 omit 在同一轮竞争，增大单轮装配延迟抖动。
2. **触发阈值不可控、不可观测**：当前没有"对话 token 占有效窗口比例"这一显式阈值契约，运维侧无法预期何时压缩，也无法把"压缩触发点"作为可观测信号对齐容量规划。

有效上下文窗口已有单一来源：`availableInputUnits = contextWindowTokens − reservedOutput`（`runBudgetGate`，`assemble-context.ts:1206-1218`，window 取自 `modelSelection.modelInfo.contextWindowTokens`，reservedOutput 取自 `modelOptions.maxOutputTokens`）。本 change 在该同一窗口定义上新增一个**主动压缩阈值**：当对话 token 数达到「有效上下文窗口 − 13,000」（约有效窗口的 92%）时，触发自动压缩，从而在历史被被动 omit 之前先主动收缩。

选 13,000 这一固定偏移量而非纯比例，是为了：在 128K 这类常见窗口下保留 ~10% 余量；同时在较小窗口（如 32K）下阈值仍为正且有明确绝对余量，避免纯比例在小窗口下余量过小、压缩过晚。

## 变更范围（What Changes）

- **以主动阈值替换反应式触发（BREAKING）**：移除现有"prior_active_history 被预算门 omitted 才触发压缩"的反应式 `shouldCompress` 分支。改为以"对话 token 达到有效上下文窗口 − 13,000"作为 summary compression 的**唯一**触发条件。
- **阈值触发器**：在 `assemble()` 预算门评估之后，判断 `estimatedConversationInputUnits >= availableInputUnits − 13_000`，成立则触发 summary compression（复用现有 `runSummaryCompression` 编排，不新增压缩实现）。旧反应式分支代码删除，不保留、不考虑兼容。
- **阈值定义**：`autoCompactHeadroomUnits = 13_000`，**固定硬编码常量**（不走 deps 注入、不可配置）。`estimatedConversationInputUnits` 取预算门已构建的 `sourceCandidates` 全量估算之和（required + optional，含 prior_active_history），不引入第二条估算路径。`availableInputUnits` 复用 `runBudgetGate` 已算的 `contextWindowTokens − reservedOutput`，不重算。
- **小窗口 guard**：当 `availableInputUnits <= 13_000` 时阈值不触发，本轮不压缩（避免无条件触发死循环）。
- **不变量保留**：触发压缩仍 MUST 复用 `runSummaryCompression`，仍 MUST 保护 current-request / visibility / owner-scope / agent-scope / protocol 不变量；summary generator 未配置或压缩失败时 MUST 显式回退到既有 budget-degraded / omission 结果，不 fake 成功。
- **不新增可观测字段**：因只有一个触发源，不新增 trigger-origin 区分字段，不改 `ContextCompressionEvidence` 契约。
- 非范围：不改 micro-compact、large-content replacement、traceable-summary 生成实现、budget explainability 入口契约、`availableInputUnits` 计算口径、runtime checkpoint 写入。

## Capability 影响（Capabilities）

### 新增 Capability
（无）

### 修改的 Capability
- `context-engine`: 修改「Context Engine SHALL own summary compression orchestration」requirement 的触发语义——由反应式（prior history 超出安全预算才压缩）改为主动阈值（对话 token 达「有效上下文窗口 − 13,000」即压缩，且为唯一触发条件，反应式路径删除）。其余压缩编排、不变量、evidence 契约不变。

## 影响范围（Impact）

- **代码**：`packages/agent-context-engine/src/assembly/assemble-context.ts`（`processBudgetOutcome` 删除反应式 `shouldCompress` 分支、新增阈值触发分支；`evaluateBudget`/`runBudgetGate` 把 `availableInputUnits` 下传；新增 `DEFAULT_AUTO_COMPACT_HEADROOM_UNITS = 13_000` 常量）。不改 `default-proportional-budget-policy.ts`、不改 `agent-contracts`。
- **契约**：不新增/不修改 `ContextAssemblyRequest`、`ContextCompressionEvidence` 任何字段；阈值不进 request body。
- **依赖/系统**：无新外部依赖；复用现有 `TraceableSummaryGenerationPort`、`commitCompaction`、token estimator。
- **测试**：新增单测覆盖（a）token 达阈值时触发压缩；（b）未达阈值不触发，即使历史被 omit 也不压缩；（c）小窗口（availableInputUnits ≤ 13_000）不触发；（d）summary generator 缺失/压缩失败时安全回退到 budget-degraded。删除/改写依赖旧反应式 omit 触发的既有测试。contract 测试断言阈值不进 request body。
- **行为变化（BREAKING）**：历史超出 60% cap 但对话总 token 未达阈值的窄带场景，由"触发压缩"变为"按 budget-degraded omit 返回"，不再尝试 summary。omission 仍是显式降级结果（有 evidence），非静默丢失。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/context-engine/spec.md`：修改——重述「Context Engine SHALL own summary compression orchestration」requirement，把触发条件由反应式 omit 改为主动阈值（唯一触发），含小窗口 guard 与失败回退契约。

长期背景：
- `openspec/overview.md`：无（不改变产品范围，仅改压缩触发时机）。

设计视图：
- `openspec/designs/architecture/<topic>.md`：无（不引入跨模块新流程，压缩编排仍属 context-engine 内部）。
- `openspec/designs/modules/agent-context-engine.md`：修改——补充阈值触发器落点、与 `runBudgetGate` / `processBudgetOutcome` 的关系、反应式路径移除。
- `openspec/designs/adr/<id>.md`：新增——记录"固定偏移量 13,000 vs 纯比例阈值"的取舍理由。
- `openspec/designs/spec-to-design-map.md`：无（capability 未新增，导航不变）。

验证入口：
- `packages/agent-context-engine/tests/` 单测：阈值触发/未触发（含 omit 但不压缩）、小窗口不触发、generator 缺失回退。
- `tests/contract/`：阈值不进 `ContextAssemblyRequest` body 的契约断言。
- `npm run test:contract`、`openspec validate --all --strict`。
