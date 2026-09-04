## 设计范围

本 change 仅触及一个 Function：

- `FN-4.3 装配上下文`（canonical spec：`openspec/specs/context-engine/spec.md`）

修改的 Requirements（3 个 MODIFIED，其中 `Large-content thresholds referenced from context-engine are fixed` 在 spec 中有两份重复副本，两处均修改）：

1. `Context Engine protects minimum safe current-request context`
2. `Large-content thresholds referenced from context-engine are fixed`（L301-317 第一份 + L838-855 第二份）
3. Source blockquote（L155）中的 H1 interlock 描述（随 Requirement 1 的 Appendix H1-a 重写一并更新）

## FN-4.3 装配上下文

### 目标与规范依据

本 Function 的目标 Requirements：

- canonical spec：`openspec/specs/context-engine/spec.md`
- MODIFIED `Context Engine protects minimum safe current-request context`
- MODIFIED `Large-content thresholds referenced from context-engine are fixed`

### 当前实现

默认 budget policy（`packages/agent-context-engine/src/budget/default-proportional-budget-policy.ts`）：

- L20 JSDoc：`The earlier 60% proportional history-budget cap has been REMOVED.`
- L87 注释：`The 60% history-budget cap has been removed. Optional candidates are no longer omitted to fit a proportional history budget — context overflow is governed solely by the context engine's proactive auto-compact / summary-compression strategy.`
- L61：`DEFAULT_PRE_SEND_CHECK_RATIO = 0.885`（当 `estimatedFinalInputUnits / availableInputUnits >= 0.885` 时发 `PRE_SEND_CHECK_REQUIRED`）
- L84-95：required 和 optional 候选全部 selected，`omittedContextTypes = []`，不 omit、不 degrade。
- 默认 policy 实际产生的 `BudgetReasonCode`：`WITHIN_BUDGET`、`PRE_SEND_CHECK_REQUIRED`、`MINIMUM_SAFE_CONTEXT_EXCEEDS_BUDGET`、`INSUFFICIENT_CONTEXT`。`compact_degrade` 仍在合约 union 中但默认 policy 不发出。

Proactive auto-compact（`packages/agent-context-engine/src/assembly/assemble-context.ts`）：

- L237：`DEFAULT_AUTO_COMPACT_HEADROOM_UNITS = 13_000`
- L225-236 JSDoc：`Summary compression is triggered when the estimated conversation input units reach availableInputUnits - DEFAULT_AUTO_COMPACT_HEADROOM_UNITS. This is the SOLE compression trigger; the previous reactive 'prior_active_history omitted' trigger has been removed.`
- L811-818：`thresholdTrigger` 基于 `sumEvidenceUnits(evidence) >= availableInputUnits - DEFAULT_AUTO_COMPACT_HEADROOM_UNITS`，不引用 budget decision。
- 每 run 至多触发一次压缩（`compressedRunIds` Set）。

Port 合约（`packages/agent-contracts/src/context/index.ts` L617-619）：

- `ContextBudgetPolicyPort.evaluate(input, signal): ContextBudgetPolicyOutcome`
- L597-616 JSDoc 声明四个决策关口不变量：minimum safe context 保护、explicit_failure、evidence 完整性、四值 decision 收敛。60% cap 不在不变量中。

测试（`packages/agent-context-engine/tests/default-proportional-budget-policy.test.ts`）：

- L45：`'uses 0.885 preSendCheckRatio by default (60% history cap removed)'`
- L127-187：`describe('no history cap (60% mechanism removed)')` 三个测试断言全部 optional 候选 selected。
- L193-210：`'flags PRE_SEND_CHECK_REQUIRED when ratio >= 0.885'`

### GAP 分析

| 维度 | spec 现状 | 代码现状 | GAP |
|---|---|---|---|
| 60% cap 定义 | L179 `SHALL NOT be placed inside the 60% prior-history budget cap` | 代码不执行 cap | spec 承诺未实现行为 |
| 60% cap 作为 OUTER cap | L201 Appendix H1-a `The 60% prior-history budget cap ... is the OUTER cap` | 无 OUTER cap 概念 | spec 声明不存在的结构角色 |
| 历史候选 omit/degrade | L181 `MAY compete inside the prior-history budget and MAY be degraded` | 全部 selected，不 omit | spec 描述的容器语义不存在 |
| Scenario 断言 | L187 `does not include them in the 60% history budget cap` | 无 cap 可排除 | Scenario 断言无效条件 |
| large-content 交叉引用 | L307/L844 `不会因 60% history window budget 而改变顺序` | offload 顺序独立于 history budget | 60% 引用多余但不变量正确 |
| H1 interlock 描述 | L155 `60% history cap vs inline-max-bytes / aggregate-max-chars` | 无 60% cap | 描述过时 |

### 修改方案

#### MODIFIED 1: `Context Engine protects minimum safe current-request context`

**Before（L177-201 现状摘要）：**

- L179：`This baseline SHALL NOT be placed inside the 60% prior-history budget cap, and SHALL NOT be silently dropped to make room for prior history.`
- L181：`Historical attachment context MAY compete inside the prior-history budget and MAY be degraded, but such degradation MUST be explicit and explainable.`
- L187 Scenario：`it does not include them in the 60% history budget cap`
- L201 Appendix H1-a：`The 60% prior-history budget cap defined in this requirement is the OUTER cap on prior-history context. ... regardless of how the 60% cap would otherwise apply ...`

**After：**

- L179：`This baseline SHALL NOT be silently dropped to make room for prior history.`（删除 60% cap 子句，保留 minimum safe context 保护）
- L181：`Historical attachment context MAY be degraded when context overflow is governed by the proactive auto-compact strategy, but such degradation MUST be explicit and explainable.`（去掉 "prior-history budget" 容器语义，改为 auto-compact strategy）
- L187 Scenario：`it protects them from silent omission to make room for prior history`（改为描述实际保护行为）
- Appendix H1-a 重写：删除 OUTER cap 语言和 60% 引用；保留 large-content 阈值独立 offload 不变量（`inline-max-bytes` offload 独立于 history budget，两阈值互不替代）。

#### MODIFIED 2: `Large-content thresholds referenced from context-engine are fixed`（两处）

**Before（L307 / L844）：**

`该决策不会因 60% history window budget 而改变顺序。`

**After：**

删除该句。保留前文 aggregate offload 顺序规则主体（`保留 prior frozen decisions → 只考虑 fresh results → 按 size 从大到小 offload 直至聚合 ≤ aggregate 阈值或没有可选 fresh result 剩余`）。

#### MODIFIED 3: Source blockquote（L155）

**Before：**

`Cross-reference appendix H1-a appended to ... to close the H1 interlock (60% history cap vs inline-max-bytes / aggregate-max-chars).`

**After：**

`Cross-reference appendix H1-a appended to ... to close the H1 interlock (history budget vs inline-max-bytes / aggregate-max-chars).`

## 长期基线刷新计划

| 基线目标 | 刷新内容 |
|---|---|
| `openspec/specs/context-engine/spec.md` | archive 时自动应用 3 个 MODIFIED Requirement delta |
| Function 文档 FN-4.3 装配上下文 | 若 `designs/functions/` 有 FN-4.3 条目，更新其 budget 描述移除 60% cap 引用 |
| `designs/spec-to-design-map.md` | 若有 context-engine budget 条目引用 60% cap，更新引用 |
| `openspec/overview.md` | 无需更新（60% cap 不是 overview 级特性） |
| Feature 文档 F-4.4 | 已在前序文档刷新中移除 "≤60% 模型窗口" 描述 |
| architecture / modules / ADR | 无 |
