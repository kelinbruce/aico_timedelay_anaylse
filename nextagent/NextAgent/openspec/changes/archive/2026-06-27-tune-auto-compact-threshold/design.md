## 背景和现状（Context）

Context Engine 的 summary compression 当前为**反应式**触发：在 `assemble()` 的 `processBudgetOutcome`（`packages/agent-context-engine/src/assembly/assemble-context.ts:585`）中，仅当预算门把 `prior_active_history` 标记为 omitted 时（`shouldCompress`，`:597`，条件 `omittedContextTypes.includes("prior_active_history")`）才调用 `runSummaryCompression`。预算门在 `runBudgetGate`（`:1197`）内计算 `availableInputUnits = Math.max(0, window - reservedOutput)`（`:1218`，`window = modelSelection.modelInfo.contextWindowTokens`，`reservedOutput = modelOptions.maxOutputTokens ?? 0`），并产出 per-candidate `ContextBudgetEvidence`（含每个候选的 `estimatedInputUnits` 与 selected/omitted/degraded 状态）。

本 change **替换**该反应式触发，改为以"对话 token 达有效窗口 − 13,000"为**唯一**触发条件。旧反应式 `shouldCompress` 分支删除，不保留、不考虑兼容。

约束与相关方：

- 有效窗口与 token 估算已有单一来源（`runBudgetGate` + 注入的 `tokenEstimator`），本设计 MUST NOT 新建第二条估算路径。
- 压缩编排（`runSummaryCompression`）、`commitCompaction`、`TraceableSummaryGenerationPort`、micro-compact、large-content replacement 均为既有边界，复用不改写。
- 相关方：context-engine（触发器归属）。不改 agent-contracts、不改 agent-core runtime checkpoint 写入。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 在 `assemble()` 内以主动阈值作为 summary compression 的唯一触发条件：对话 token 估算达到「有效上下文窗口 − 13,000」时触发压缩。
- 删除旧反应式 omit-based `shouldCompress` 触发分支，不保留兼容路径。
- 复用现有 `runSummaryCompression` 编排与既有 token 估算/窗口口径，不引入第二条压缩实现或估算路径。
- 阈值为固定硬编码常量 13,000，不进 request body。

**非目标：**

- 不改 micro-compact、large-content replacement、traceable-summary 生成实现。
- 不改 `availableInputUnits` 计算口径、`historyBudgetRatio`（60%）、`preSendCheckRatio`（0.885）等既有预算门参数语义。
- 不改 `ContextCompressionEvidence` 契约（不新增 trigger-origin 字段，因只有一个触发源）。
- 不改 runtime 侧 `CONTEXT_COMPACTED` checkpoint / timeline 写入。
- 不做阈值可配置（硬编码常量）。

## 设计决策（Decisions）

### D1. 阈值为固定硬编码常量，不走 deps 注入

```ts
const DEFAULT_AUTO_COMPACT_HEADROOM_UNITS = 13_000;
```

定义在 `assemble-context.ts` 模块顶部，直接在 `processBudgetOutcome` 引用。不新增 `DefaultContextEngineDependencies` 字段、不暴露构造选项。

**理由**：用户诉求是固定「−13,000」，无可配置要求；硬编码是最小实现。若未来需窗口自适应或可配置，走新 change，不在本 change 引入第二参数（KISS）。

**放弃方案**：经 `DefaultContextEngineDependencies` 注入——被否，增加配置面非必要。

### D2. `availableInputUnits` 与 `estimatedConversationInputUnits` 的单一来源

- `availableInputUnits`：由 `runBudgetGate` 已计算（`:1218`）。为避免在 `processBudgetOutcome` 重复计算，`evaluateBudget`（`:519`）返回值由 `ContextBudgetPolicyOutcome | undefined` 改为 `{ outcome: ContextBudgetPolicyOutcome; availableInputUnits: number } | undefined`，把门内已算的 `availableInputUnits` 下传给 `processBudgetOutcome`。`budgetPolicy === undefined` 时返回 `undefined`（无预算门即无触发，与今日无压缩行为一致）。调用点（`:279`）同步解构并把 `availableInputUnits` 传入 `processBudgetOutcome`（`:282`）。
- `estimatedConversationInputUnits`：等于 `Σ budgetOutcome.evidence[].estimatedInputUnits`（所有候选：selected + omitted + degraded）。复用预算门已产出的 per-candidate 估算与同一 estimator，不新建估算。

**放弃方案**：用 `plan.estimatedFinalInputUnits`——被否，它只含 selected（post-omission）总量，不能反映压缩前的对话占用。

### D3. 触发条件与插入点：替换反应式分支

在 `processBudgetOutcome` 中**删除**现有反应式 `shouldCompress` 分支（`:597-602` 的 `omittedContextTypes.includes("prior_active_history")` 条件及其压缩调用块），**替换**为阈值触发分支。结构：

```
const headroom = DEFAULT_AUTO_COMPACT_HEADROOM_UNITS; // 13_000
const thresholdTrigger =
  budgetOutcome !== undefined &&
  availableInputUnits > headroom &&                       // 小窗口 guard（D4）
  this.deps.summaryGenerator !== undefined &&
  this.deps.commitCompaction !== undefined &&
  this.deps.idFactory !== undefined &&
  (sumEvidenceUnits(budgetOutcome.evidence) >= availableInputUnits - headroom);

if (thresholdTrigger) {
  const { coveredRefs, retainedTailRefs } = splitPriorTurnCandidatesForCompression(selectionOutcome);
  const compressionResult = await runSummaryCompression({ ...既有入参... }, { ...既有 deps... });
  if (compressionResult.ok) {
    // 设 evidence、按 summary + retained tail + current 重建 selectedMessageRefs
  } else {
    // 记诊断日志；不提交压缩态，落入既有 budget-degraded 结果（D5）
  }
}
// thresholdTrigger 不成立或压缩失败：沿用 truncateCandidates 产出的 omit/degrade 结果
```

- `thresholdTrigger` 成立且压缩成功：设 `compressionEvidence`，`selectedMessageRefs` = summary + retained tail + current；返回。
- `thresholdTrigger` 不成立或压缩失败：`compressionEvidence` 保持 `undefined`，`selectedMessageRefs` 沿用 `truncateCandidates` 结果（即预算门的 omit/degrade 结果）。

因只有一个触发源，无需"同一轮不重复触发"控制；旧 `shouldCompress` 已删除。

### D4. 小窗口安全 guard

`availableInputUnits > headroom` 是触发条件之一。当 `availableInputUnits <= 13_000`（阈值结果非正，会无条件触发）时 `thresholdTrigger` 为 false，本轮不压缩。`availableInputUnits` 已是 `Math.max(0, window - reservedOutput)`，非负。确定性 guard，不依赖运行时探测。

### D5. 失败回退

`thresholdTrigger` 成立但 `runSummaryCompression` 返回 `ok: false`（generator 未配置——已被 `thresholdTrigger` 条件挡住、生成取消/空/unsafe、`commitCompaction` VERSION_CONFLICT 或持久化失败）：`processBudgetOutcome` 不提交压缩态，`compressionEvidence` 保持 `undefined`，`selectedMessageRefs` 沿用 `truncateCandidates` 的 budget-degraded / omission 结果。不伪造成功装配。**不回退到旧反应式路径**（已删除）。

### D6. 不新增可观测字段

只有一个触发源，`ContextCompressionEvidence` 维持现有字段不变，不新增 `triggerOrigin`。压缩成功仍经既有 `ContextEnginePort.assemble()` 返回值暴露 evidence，runtime 写 `CONTEXT_COMPACTED` checkpoint 的逻辑不变。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 阈值为硬编码常量、不进 request body / client / model output / capability args，防止客户端篡改触发时机；触发器复用既有 owner-scope / visibility / protocol 不变量，不引入新越权面。 | contract 测试断言 `ContextAssemblyRequest` 不含 `autoCompactHeadroomUnits`。 |
| 性能/容量 | 主动阈值在历史被 omit 之前压缩，避免"omit 与压缩同轮竞争"的延迟抖动；判断仅一次整数比较 + evidence 求和（O(候选数)，与预算门同阶），无额外模型/IO 调用；13,000 在 128K 窗口留 ~10% 余量。 | 单测覆盖触发时机；既有 budget/compression 集成测试回归。 |
| 可靠性/恢复 | 触发失败显式落到既有 budget-degraded / omission 结果，不伪造成功；`commitCompaction` 的 CAS/version 语义不变；压缩提交后 active context 仍为 canonical，恢复走 `session_messages` + `activeContextVersion`，无新持久化。 | 集成测试：generator 缺失/commit 冲突时降级结果。 |
| 可维护性 | 触发器集中在 `processBudgetOutcome` 一处，单一触发源、无状态标志；阈值单一硬编码常量；删除旧反应式分支降低分支复杂度。 | 架构检查：触发逻辑单点；模块测试。 |
| 可测试性 | 阈值、`availableInputUnits`、`estimatedConversationInputUnits` 均为纯整数计算，可注入 mock evidence 与 budget outcome；触发条件确定。 | unit/contract 测试：触发/未触发/小窗口/回退。 |
| 审计/可追溯性 | 压缩成功仍经既有 compression evidence + `CONTEXT_COMPACTED` checkpoint 落 timeline/observability；不新增区分字段（单触发源无区分需求）。 | 既有 observability 测试回归。 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 阈值触发条件（达阈值触发压缩） | T1 | `packages/agent-context-engine/tests/` 单测：`availableInputUnits=100_000`、估算=88_000 → 触发 |
| 未达阈值不触发（含 omit 也不压缩） | T1 | 单测：估算=80_000 → 不触发；即便 omit `prior_active_history` 也不压缩 |
| 小窗口 guard | T1 | 单测：`availableInputUnits=12_000` ≤ 13_000 → 不触发 |
| 压缩失败回退到 budget-degraded | T2 | 单测：generator 缺失/commit 冲突 → `compressionEvidence=undefined`，沿用 omit 结果 |
| 删除反应式 `shouldCompress` 分支 | T2 | code review + 既有反应式测试改写/删除 |
| 阈值不进 request body | T3 | `tests/contract/` 断言 `ContextAssemblyRequest` 不含 `autoCompactHeadroomUnits` |
| 单一估算口径（不新建 estimator） | T1 | code review：`estimatedConversationInputUnits` 复用 `budgetOutcome.evidence` 求和 |
| `availableInputUnits` 单一来源 | T2 | code review：`evaluateBudget` 下传门内计算值，`processBudgetOutcome` 不重算 |
| `openspec validate --all --strict` | T3 | CLI 校验通过 |

## 文档承载决策（Documentation Ownership）

- 行为契约（阈值唯一触发、guard、回退）：主承载 `openspec/specs/context-engine/spec.md`（归档时把 MODIFIED requirement 同步为基线）。
- 触发器落点、与 `runBudgetGate`/`processBudgetOutcome` 关系、反应式路径移除：主承载 `openspec/designs/modules/agent-context-engine.md`。
- 固定偏移量 13,000 vs 纯比例取舍：主承载 `openspec/designs/adr/<id>.md`（新增）。
- 架构/跨模块：无新增跨模块流程，不新增 `designs/architecture/` 文档。
- 导航：`openspec/designs/spec-to-design-map.md` 无变化（capability 未新增）。
- contract 字段：无变化（不改 `ContextCompressionEvidence`）。

## 风险与取舍（Risks / Trade-offs）

- [窄带场景行为变化（BREAKING）] -> 历史超 60% cap 但对话总 token 未达阈值的场景，由"触发压缩"变为"按 budget-degraded omit 返回"。omission 仍是显式降级（有 evidence），非静默丢失；spec 已明示此行为变化。
- [小窗口模型不触发压缩] -> 由 D4 guard 确定性降级；目标部署窗口为 128K 量级，小窗口属边角，ADR 记录取舍。
- [固定偏移在不同窗口下触发比例不同] -> 13,000 在 128K 约 90%、200K 约 93.5%，均落在"接近窗口先压缩"预期区间；窗口自适应走后续 change。
- [既有测试依赖旧反应式触发] -> 删除/改写为阈值触发场景，不留兼容测试。

## 迁移计划（Migration Plan）

无数据迁移、无持久化 schema 变更、无 contract 字段变化。发布步骤：

1. `agent-context-engine`：`evaluateBudget` 返回值下传 `availableInputUnits`；`processBudgetOutcome` 删除反应式 `shouldCompress` 分支、新增阈值触发分支；新增 `DEFAULT_AUTO_COMPACT_HEADROOM_UNITS` 常量与 `sumEvidenceUnits` 工具。
2. 改写/删除依赖旧反应式 omit 触发的既有测试；新增阈值单测与 contract 断言。
3. 回滚：还原 `processBudgetOutcome` 反应式分支、还原 `evaluateBudget` 返回值即可，无持久化/契约风险。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/context-engine/spec.md`：把 MODIFIED requirement（阈值唯一触发）同步为基线；原反应式触发描述移除。
- `openspec/designs/modules/agent-context-engine.md`：补充阈值触发器落点、与 `processBudgetOutcome`/`runBudgetGate` 关系、反应式路径移除、小窗口 guard。
- `openspec/designs/adr/<id>.md`：新增 ADR——固定偏移量 13,000 + 小窗口 guard vs 纯比例阈值的取舍理由。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/`：无。
- `openspec/designs/modules/agent-contracts.md`：无（contract 未变）。
- `openspec/designs/spec-to-design-map.md`：无。

## 待确认问题（Open Questions）

无。所有关键选择（硬编码常量 D1、单一口径 D2、替换反应式 D3、guard D4、回退 D5、不新增字段 D6）已收敛为唯一路径。
