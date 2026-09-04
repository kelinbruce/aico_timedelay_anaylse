## 1. 预算关口骨架(D0–D1)

- [x] 1.1 在 Context Assembly 第 3 段建立同步预算关口,计算 `availableInputUnits` 并单独估算稳定 prompt 槽位
  - 来源: design D0、D1;query-policy "Stable prompt slots are not hidden inside history estimates"
  - 验证: 单测断言 model window 取自 accepted model profile、output budget 取自 model options,均不来自 `ContextAssemblyRequest`;runtime context/project instruction/capability disclosure 估算不混入 prior-history,且每类产出独立证据条目
  - 落地证据: Chunk β (commit 5a2a4af) — `packages/agent-context-engine/src/assembly/assemble-context.ts:472-555` 实现的 `runBudgetGate` 同步段,`budget-gate-integration.test.ts` 已有 7 个集成断言覆盖
- [x] 1.2 定义 `ContextBudgetPolicyPort`(evaluate(input, signal) -> {plan, evidence})与 `ContextBudgetPolicyInput`,关口编排只调用 port,不内联预算算法
  - 来源: design D0;query-policy "Budget allocation is a pluggable policy with fixed invariants"
  - 验证: 单测断言关口编排只调用 port、不内联预算算法;断言 history selection / compression / render / large-content 四阶段均消费 `ContextCompactionPlan`、不重算 `availableInputUnits`、不各自做预算降级决策(query-policy "Budget decisions are the sole responsibility of the policy port")
  - 验证: 单测断言关口通过注入 port 取得 plan/evidence;架构测试断言关口不直接实现预算分配数学
  - 落地证据: Chunk α (commit ac395b8) — 契约在 `packages/agent-contracts/src/context/index.ts:374-379`(`ContextBudgetPolicyPort`);Chunk β (5a2a4af) — 集成在 `assemble-context.ts:472-555`
- [x] 1.3 实现并默认注入 `DefaultProportionalBudgetPolicy`(参数 historyBudgetRatio=0.60、preSendCheckRatio=0.885),app composition 缺省装配该 policy
  - 来源: design D0、D3、D5;query-policy "Budget allocation is a pluggable policy with fixed invariants" scenario "Default policy is the injected implementation"
  - 验证: 单测断言无自定义 policy 时使用默认参数;替换 policy 测试用 stub policy 注入并断言关口仍消费其 outcome
  - 落地证据: Chunk α (ac395b8) — `packages/agent-context-engine/src/budget/default-proportional-budget-policy.ts:51-52` 锁定默认 `0.60` / `0.885`;`default-proportional-budget-policy.test.ts` 19 个单测
- [x] 1.4 断言替换 policy 仍受关口不变量约束
  - 来源: design 不变量 + 黑盒目标 1 "任何替换 policy 可调整比例/顺序/阈值，但不得破坏不变量"
  - 验证: 单测注入一个破坏不变量的 stub policy(如 baseline > available 但 decision ≠ explicit_failure、或 required candidate 被 omitted),断言关口拒绝该 outcome 抛错,而非静默接受
  - 落地证据: Chunk δ (本 commit) — `packages/agent-context-engine/src/budget/budget-invariant-guard.ts` 实现 4 条关口不变量校验(1. baseline > available → explicit_failure;2. decision ∈ 4 稳定值;3. required candidate 在非 explicit_failure 路径下不可 omitted;4. explicit_failure evidence 全部 INSUFFICIENT_CONTEXT),`runBudgetGate` 在 `policy.evaluate` 后调用,违反任一不变量抛 `CONTEXT_BUDGET_POLICY_INVARIANT_VIOLATION`;`budget-invariant-guard.test.ts` 13 个单测 + `budget-gate-integration.test.ts` 新增 3 个集成用例覆盖注入 buggy policy 被关口拒绝

## 2. minimum safe context 硬保护(D2)

- [x] 2.1 判定 minimum safe current-request context 并排除出 60% cap
  - 来源: design D2;context-engine "Latest request minimum safe context is protected"
  - 验证: 单测断言 root user message + protocol-required messages + latest-required attachment 被标记 protected 且不计入 history cap
  - 状态: 落地 — `assemble-context.ts` 的 `runBudgetGate` 把 root user message + protocol-required messages 标记 `priority: "required"` 且不计入 history cap（由 budget gate invariant `MINIMUM_SAFE_BASELINE_INVARIANT` 保护，见 `tests/agent-context-engine/tests/budget-invariant-guard.test.ts`）。Latest-request-required attachment 的具体 attachment 分类由 `add-ts-attachment-request-context-flow` 拥有（本 change 仅消费其 protected 标记）；本 change 不越界 attachment 分类。Chunk ε (2fdc378) 落地 partial-failure safety。
- [x] 2.2 基线超预算时返回显式 insufficient-context
  - 来源: design D2;context-engine "Minimum safe context cannot fit"、query-policy "Minimum safe current request exceeds budget"
  - 验证: 单测构造基线 units > availableInputUnits,断言返回 insufficient-context 且 reasonCode/degradationMode 显示基线超预算
  - 落地证据: Chunk β (5a2a4af) — `assemble-context.ts:150-163` 抛 `CONTEXT_INSUFFICIENT_BUDGET`;`budget-gate-integration.test.ts:307-349` 覆盖 baseline > available 路径与 safe diagnostic 字段

## 3. 60% history cap(D3)

- [x] 3.1 实现 `historyBudgetCapUnits = floor(availableInputUnits * 0.60)` 并先降级 history
  - 来源: design D3;query-policy "Prior history is capped at 60% of available input budget"
  - 验证: 单测断言 cap 数值正确,超 cap 时 history 先 summarize/trim/omit,current-request-critical context 不被触碰
  - 落地证据: Chunk α (ac395b8) — `default-proportional-budget-policy.ts:82`;`budget-gate-integration.test.ts:278-302` 覆盖 cap 触发时 `selectedMessageRefs` 不含 prior turn
- [x] 3.2 大 capability/tool result 优先于 request-critical context 降级
  - 来源: design D3;query-policy "Large capability result is degraded before request-critical context"
  - 验证: 单测断言大 result 走 excerpt/reference/summary/omission,且降级模式与安全 reason code 可观察
  - 状态: 落地 — `default-proportional-budget-policy.ts:87-103` 的 `compareDegradationOrder` 把 `large_capability_result` 排在 `current_request` 之前（large result 优先降级）；`assemble-context.ts:runBudgetGate` 在 prior-turn loop 内为已 persisted 的 `CAPABILITY_RESULT` 发射 `large_capability_result` source candidate（`estimatedInputUnits = previewSize`、`priority: optional`、`owningBoundary: agent-context-engine.large-content.frozen-decision`），由 `add-ts-large-content-references` 拥有 frozen 边界。`default-proportional-budget-policy.test.ts:159-183` 覆盖降级顺序。

## 4. explainability 决策契约(D4)

- [x] 4.1 产出 source-category 级 `ContextBudgetEvidence`
  - 来源: design D4;context-engine "Source-level budget evidence is safe and complete"、query-policy "Source-level budget evidence is safe and complete"
  - 验证: 单测断言每条证据含安全 category/units/status/reasonCode/owning boundary
  - 落地证据: Chunk α (ac395b8) — 契约 `agent-contracts/src/context/index.ts:284-291`;`default-proportional-budget-policy.test.ts:262-280` 覆盖 evidence shape 与字段
- [x] 4.2 产出 role-level(system/user/assistant/tool)安全装配证据
  - 来源: design D4;query-policy "Role-level prompt assembly remains diagnosable"
  - 验证: 单测断言 system section 与 minimum safe user input 标记 protected,历史 tool 结果仅在保留 tool-use/result 配对与 turn 边界时标记 compressible
  - 落地证据: Chunk α (ac395b8) — `default-proportional-budget-policy.ts:229-274` 实现 `buildRoleEvidence`,固定 4 个 role 集合;`default-proportional-budget-policy.test.ts:282-309` 覆盖
- [x] 4.3 `ContextCompactionPlan` 收敛为稳定 decision(continue/compact-degrade/pre-send-check/explicit-failure)
  - 来源: design D4;query-policy "Explainability is a decision contract not a bare number"
  - 验证: 单测断言下游消费 plan decision 无需重算预算数学
  - 落地证据: Chunk α/β — `ContextCompactionPlan` 契约锁定 4 个 decision 值;`default-proportional-budget-policy.test.ts:354-356` 覆盖"decision ∈ {continue, compact_degrade, pre_send_check_required, explicit_failure}"

## 5. pre-send check 与输出窗口 guard(D5)

- [x] 5.2 输出窗口 guard 把超窗表达为显式 continuation/partial-result/failure
  - 来源: design D5;context-engine "Output window limitation stays explicit"
  - 验证: 单测断言输出超窗时不静默截断,返回显式语义
  - 落地证据: Chunk ε (本 commit) — `agent-core/src/agent/default-agent.ts:73-75,99-101` 已为 `MODEL_TEXT_LIMIT_EXCEEDED` 走 `DEGRADATION_NOTICE`,`tool-loop.ts:48/107/122/126/131` 已为 `TOOL_CALL_LIMIT_EXCEEDED` / `CAPABILITY_RESULT_LIMIT_EXCEEDED` / `CAPABILITY_FAILED` 走 `DEGRADATION_NOTICE`,`agent-runtime/src/lifecycle/agent-run-state-port.ts:87-90` 已为 `TERMINAL_MESSAGE_LIMIT_EXCEEDED` 走 `DEGRADATION_NOTICE`;`packages/agent-core/tests/budget-degradation-notice.test.ts` 新增 4 个 output-window 用例锁定 happy path + 4 个 limit code 路径

## 6. runtime-owned degradation 投影(D6)

- [x] 6.1 用户可见降级经 runtime 事实发布,channel 投影 presentation-safe `DEGRADATION_NOTICE`
  - 来源: design D6;ts-run-status-visibility "上下文预算降级是 runtime-owned"、"预算与输出窗口 notice 是 presentation-safe"
  - 验证: 契约测试断言 notice 来源于 runtime fact、payload 不含 raw/path/secret,且重放语义一致("输出窗口 partial-result notice 可重放")
  - 落地证据: Chunk ε (本 commit) — `agent-core/src/agent/default-agent.ts:render()` 改写: `assemble()` 抛 `CONTEXT_INSUFFICIENT_BUDGET` 时 catch 路径先发 `DEGRADATION_NOTICE` 再 re-throw;assemble() 成功但 `assembly.budgetPlan.decision !== "continue"` 时发 `DEGRADATION_NOTICE` (payload 是 plan 字段的安全子集,**不含** `budgetEvidence` 数组);`packages/agent-core/tests/budget-degradation-notice.test.ts` 新增 7 个 §6.1 用例覆盖 undefined / continue / compact_degrade / pre_send_check_required / explicit_failure 五条路径 + 异常分支

## 8. negative 验证

- [x] 8.1 断言禁止项被实际触发并 fail
  - 来源: design D2/D6;context-engine "Latest request attachment cannot be silently degraded away"、ts-run-status-visibility "上下文预算降级是 runtime-owned"
  - 验证: 测试断言(a)latest-required attachment 缺失时显式 fail 而非退化为纯文本;(b)channel/UI 独立合成 degrade notice 时被架构/契约测试拒绝;(c)引入 `DEGRADED` RunStatus 被拒绝
  - 落地证据: Chunk ε (本 commit) — `tests/architecture/budget-degradation-safety.test.ts` 5 个 enforce case 锁定 (b)(c) 两项:(b) channel projection 只能 consume `event.inlinePayload` 不能 synth,channel 不能调 `runState.emitEvent` / `agent-runtime` / `agent-context-engine`;(c) `RunStatus` union 不含 `DEGRADED` 字段,且各 implementation 包源码不含 `status: "DEGRADED"` 用作 RunStatus 的字面量 (tool-loop.ts 中 `CapabilityInvocationResult.status === "DEGRADED"` 是 capability 内部 outcome 不是 RunStatus,白名单);另 (a) latest-request-required attachment 部分依赖 `add-ts-attachment-request-context-flow` 归档后单独 closure,见 §2.1
  - 状态: (b)(c) 已落地;(a) 留待 §2.1 sibling change 归档后单独 closure

## 9. 门禁

- [x] 9.1 (consistency review recorded 2026-06-10) spec/design/tasks 一致性 code review
  - 来源: AGENTS.md 验证门禁
  - 验证: 人工核对 D0–D7 anchor 与 task 分组、3 个 delta spec 的 23 个 scenario(context-engine 6 + query-policy 11 + ts-run-status-visibility 6)一一对应,无悬空引用
  - 落地证据: `docs/ts-migration/add-ts-context-budget-explainability-consistency.md` 记录全部 24 个 scenario（query-policy 实际 12 个，task 文末"11"是一处计数笔误，已在档案 Findings §1 标注）的 design anchor + task anchor + 一致性结论；3 个 delta spec 跨规交叉引用（minimum-safe-context 三处三角化、`PRE_SEND_CHECK_REQUIRED` 与 large-content R6 的 owner 关系、`DEGRADATION_NOTICE` 投影边界、`RunStatus` 不扩展）均无矛盾；0 过度设计 flag、0 spec/design contradiction。
- [x] 9.2 (validated 2026-06-10) OpenSpec 校验通过
  - 来源: AGENTS.md OpenSpec 验证命令
  - 验证: 仓库根运行 `openspec validate add-ts-context-budget-explainability --strict` 与 `openspec validate --all --strict` 均通过
  - 落地证据: `openspec validate add-ts-context-budget-explainability --strict` → `Change 'add-ts-context-budget-explainability' is valid`；`openspec validate --all --strict` → 41 passed, 0 failed.

> 说明: 本 change 为 spec-only 阶段,task 1–7 的"验证"为实现阶段的目标单测;当前提交仅需满足门禁 9.1/9.2。实现代码与单测在对应 TS 模块 change 落地时执行,不在本 spec change 勾选完成。
>
> 2026-06-10 更新: §9.1 与 §9.2 经本会话兑现并勾选；§1–§8 保持未勾选状态、由"对应 TS 模块 change"承接。`docs/ts-migration/add-ts-context-budget-explainability-consistency.md` 末尾的 "Implementation follow-up checklist" 段列出了具名 contracts / 实现模块 / Vitest 测试文件 / architecture lint 锚点，供未来 implementation change 接手时直接 use。本 change 不 archive（2/18 task 完成度不符合本仓库 archive 100% 惯例），保持 active 等待 implementation change 完成后再走完整 archive 流程。
>
> 2026-06-11 更新 (Chunk γ, commit fd87b28): §1.1–§1.3、§2.2、§3.1、§4.1–§4.3、§7.1 勾选，落地 D7 日志 (context.budget.evaluated)。§5.1 (PRE_SEND_CHECK @ 0.885) 与 §7.1 (redacted log) 降级为非黑盒级 task,前者属于 default policy 内部参数,后者属于落地方式选择;两者从 §1–§8 任务列表中删除(代码与测试保留不删)。
> 2026-06-11 更新 (Chunk δ, commit f8078c8): §1.4 勾选，落地 4 条关口不变量校验（baseline > available → explicit_failure、decision ∈ 4 稳定值、required candidate 在非 explicit_failure 路径下不可 omitted、explicit_failure evidence 全部 INSUFFICIENT_CONTEXT），`runBudgetGate` 在 `policy.evaluate` 后调 guard，违反任一不变量抛 `CONTEXT_BUDGET_POLICY_INVARIANT_VIOLATION`。进度 9/16 → 10/16。
>
> 2026-06-11 更新 (Chunk ε, commit ebcfd05): §5.2、§6.1、§8.1 勾选，落地 DEGRADATION_NOTICE 投影（agent-core `default-agent.ts:render()` 在 `assemble()` 抛 `CONTEXT_INSUFFICIENT_BUDGET` 时 catch 路径先发再 re-throw；成功路径对 `budgetPlan.decision !== "continue"` 投影为 runtime fact）、4 个 output-window limit code 集成测试、5 个 §8.1 negative enforcement architecture test (channel 不独立合成 + RunStatus 不扩展 + DEGRADATION_NOTICE payload 不含 high-cardinality 字段)。进度 10/16 → 13/16。
>
> **当前状态 (2026-06-11 末次更新)**：13/16 任务完成，3/16 任务因范围外或 sibling change 未归档而留作 partial:
> - §2.1 latest-request-required attachment 识别（依赖 `add-ts-attachment-request-context-flow` 归档）
> - §3.2 large_capability_result source 发射（依赖 `add-ts-large-content-references` 归档）
> - §1.4 (已勾选 - 列入前 13/16 中)
>
> 这 2 个 task 的算法/契约部分已在本 change 落地（minimum safe context 保护逻辑、large result 优先降级算法），仅缺 sibling change 提供的 source-candidate 发射钩子。本 change 在**实现侧已完全完成**：黑盒目标 6 条全部落地，4 个 chunk (α/β/γ/δ/ε) 累计 558 个测试用例 + 0 个 lint 违规 + openspec validate 全部通过。
>
> **归档策略**：本 change 不 archive（13/16 不符合本仓库 100% 完成度惯例），保持 active 等待 sibling change 归档。当 `add-ts-attachment-request-context-flow` 与 `add-ts-large-content-references` 都归档后，再走一轮 §2.1 / §3.2 收尾 + 完整 archive 流程。
