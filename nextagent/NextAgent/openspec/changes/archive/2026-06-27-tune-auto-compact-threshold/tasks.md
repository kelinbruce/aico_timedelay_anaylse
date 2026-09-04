# Tasks — tune-auto-compact-threshold

> 实现 `openspec/changes/tune-auto-compact-threshold/` 的 specs/design。
> 最小集：以「有效上下文窗口 − 13,000」为 summary compression 唯一触发条件，删除旧反应式 omit 触发分支，不保留兼容。
> 仅改 `packages/agent-context-engine/src/assembly/assemble-context.ts` + 测试，不改 `agent-contracts`、`default-proportional-budget-policy.ts`、`agent-core` runtime。

## 1. 阈值触发器实现

- [x] 1.1 在 `packages/agent-context-engine/src/assembly/assemble-context.ts` 模块顶部新增常量 `DEFAULT_AUTO_COMPACT_HEADROOM_UNITS = 13_000`。
  - 来源：design D1/D7、spec「阈值余量不进入请求体」。
  - 验证：常量存在且值为 13_000；不被 export 到 request 面。

- [x] 1.2 `evaluateBudget`（`:519`，返回类型 `:529`）返回值由 `ContextBudgetPolicyOutcome | undefined` 改为 `{ outcome: ContextBudgetPolicyOutcome; availableInputUnits: number } | undefined`，把 `runBudgetGate` 内已算的 `availableInputUnits`（`:1218`）随返回值下传；`budgetPolicy === undefined` 时仍返回 `undefined`。
  - 来源：design D2（单一来源，不重算）。
  - 验证：`processBudgetOutcome` 拿到的 `availableInputUnits` 与 `runBudgetGate` 计算值一致；code review 确认无第二处 `window - reservedOutput` 重算。

- [x] 1.3 调用点（`:279-284`）解构 `evaluateBudget` 新返回值，把 `availableInputUnits` 传入 `processBudgetOutcome`；`processBudgetOutcome`（`:585`）签名增加 `availableInputUnits: number` 入参。

- [x] 1.4 新增私有/模块工具 `sumEvidenceUnits(evidence: readonly ContextBudgetEvidence[]): number`，返回 `Σ evidence[].estimatedInputUnits`。
  - 来源：design D2（`estimatedConversationInputUnits` 复用 budget evidence）。
  - 验证：单测覆盖 selected+omitted+degraded 全计入。

- [x] 1.5 在 `processBudgetOutcome` 中**删除**现有反应式 `shouldCompress` 分支（`:597-663` 的 `omittedContextTypes.includes("prior_active_history")` 条件、压缩调用块、成功/失败分支），**替换**为阈值触发分支：
  - `thresholdTrigger = budgetOutcome !== undefined && availableInputUnits > DEFAULT_AUTO_COMPACT_HEADROOM_UNITS && summaryGenerator && commitCompaction && idFactory && (sumEvidenceUnits(evidence) >= availableInputUnits - DEFAULT_AUTO_COMPACT_HEADROOM_UNITS)`。
  - 成立且 `runSummaryCompression` 成功：设 `compressionEvidence`，`selectedMessageRefs = [summaryMessageId, ...retainedTailRefs, ...currentRefs]`。
  - 成立但失败：记诊断日志，`compressionEvidence` 保持 `undefined`，`selectedMessageRefs` 沿用 `truncateCandidates` 结果。
  - 不成立：`compressionEvidence = undefined`，沿用 `truncateCandidates` 结果。
  - 来源：design D3/D4/D5、spec 全部 scenario。
  - 验证：见任务 3 单测。

## 2. 既有测试清理

- [x] 2.1 在 `packages/agent-context-engine/tests/` 与 `packages/agent-core/tests/` 中定位依赖旧反应式 omit 触发压缩的测试（如 `context-compression-orchestrator.test.ts`、`micro-compact-integration.test.ts`、`e2e-compression-real-policy.test.ts`、`budget-degradation-notice.test.ts` 等）。
  - 验证：`grep` `omittedContextTypes` / `prior_active_history` / `runSummaryCompression` 命中点已识别。

- [x] 2.2 删除或改写上述测试中"omit `prior_active_history` → 触发压缩"的断言；改为按阈值（`availableInputUnits − 13_000`）构造 token 估算来触发压缩，或改为断言 omit 时不再触发压缩。
  - 来源：design 风险「既有测试依赖旧反应式触发」。
  - 验证：被改写测试在新触发语义下 pass。

## 3. 新增测试

- [x] 3.1 单测：`availableInputUnits=100_000`、`estimatedConversationInputUnits=88_000` → 触发 `runSummaryCompression` 且 `compressionEvidence` 非空。
  - 来源：spec「对话 token 达到有效窗口减余量阈值时触发压缩」。
- [x] 3.2 单测：`estimatedConversationInputUnits=80_000` → 不触发；即便 budget gate omit `prior_active_history`，`compressionEvidence` 仍为 `undefined`。
  - 来源：spec「未达阈值时不触发压缩」。
- [x] 3.3 单测：`availableInputUnits=12_000`（≤ 13_000）→ 不触发。
  - 来源：spec「小窗口下阈值不无条件触发」、design D4。
- [x] 3.4 单测：阈值成立但 `summaryGenerator` 缺失 / `commitCompaction` 返回 VERSION_CONFLICT → `compressionEvidence=undefined`，沿用 budget-degraded 结果，不抛伪成功。
  - 来源：spec「summary generation 不可用时安全回退」、design D5。
- [x] 3.5 contract 测试：`ContextAssemblyRequest` 不含 `autoCompactHeadroomUnits` 键（source-level 断言）。
  - 来源：spec「阈值余量不进入请求体」。

## 4. 校验

- [x] 4.1 `npm run test:contract` 通过。
- [x] 4.2 `packages/agent-context-engine` 单测/集成测试通过。
- [x] 4.3 `openspec validate --all --strict` 通过。
- [x] 4.4 code review 确认：旧反应式 `shouldCompress` 分支已删除；`availableInputUnits` 单一来源；`estimatedConversationInputUnits` 复用 evidence 求和；未新增 contract 字段。
