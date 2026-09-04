## 1. Spec Alignment

- [x] 1.1 将 fallback change 改为边界澄清，不再把 fallback evidence 定义为 model-owned 公共契约。
  来源：proposal 变更范围；design 边界
- [x] 1.2 显式对齐后续 `add-ts-routing-evidence-and-fallback` 作为 future fallback evidence owner，当前 change 不新增 model-owned evidence contract。
  来源：spec requirement "Routing evidence owns future fallback evidence"；design 边界
- [x] 1.3 明确 `agent-model` 禁止隐式 cross-profile fallback。
  来源：spec requirement "Agent-model must not perform implicit cross-profile fallback"；design 关键约束

## 2. Design

- [x] 2.1 写清当前 change 的边界：`agent-model` 只执行当前 profile，失败后返回 `safeError`，不得读取候选或切换 profile。
  来源：spec requirement "Fallback is not owned by the model invocation boundary"；design 黑盒目标
- [x] 2.2 写清 fail-closed 行为：上层 fallback orchestration 落地前，当前 profile 失败后不自动尝试备用 profile。
  来源：spec requirement "Fallback is not owned by the model invocation boundary"；design 关键约束
- [x] 2.3 写清 future fallback orchestration 的 deferred 边界：候选来自 `modelProfileRegistry` selector，replay gate 和 evidence 由后续 routing evidence change 承接。
  来源：spec requirement "Future fallback evaluation consumes stabilized candidates and safe failure facts"；spec requirement "Future fallback orchestration handles visible-output replay gates"

## 3. Validation

- [x] 3.1 覆盖 invocation failure 后 `agent-model` 返回失败终态且不选择其他 profile 的样例。
  来源：spec requirement scenario "Invocation fails for one profile"
- [x] 3.2 覆盖 `agent-model` 不得自动切 profile 的样例。
  来源：spec requirement scenario "Provider invocation fails"
- [x] 3.3 覆盖存在 fallback-eligible profile 时仍保持 fail-closed 的样例，证明当前 change 未实现隐式备用 profile 调用。
  来源：spec requirement "Fallback is not owned by the model invocation boundary"

## 已知遗留事项（由后续 change 承接，非本 change 实施任务）

- Deferred 1：在 `agent-core` orchestration 中实现基于 `modelProfileRegistry` fallback-eligible selector、当前 `SafeError` 和 request/run/step 状态的备用 profile 评估与显式切换。
- Deferred 2：实现 fallback 决策安全闭环：已有用户可见输出时阻断同一步骤 silent replay，并对切换、拒绝切换、无候选记录 routing/fallback evidence。

说明：Deferred 1 和 Deferred 2 是明确延期项，不计入本 change 的完成度；落地前保持 fail closed，不得在 `agent-model` 中实现隐式 cross-profile fallback。

验证：2026-06-08 运行 `npm run build`、`npx vitest run tests/agent-kernel/config-assembly.test.ts`、`openspec validate add-ts-model-provider-configuration --strict`、`openspec validate add-ts-model-fallback-semantics --strict`、`git diff --check`；`packages/agent-model/tests/openrouter-provider.test.ts` 覆盖 invocation failure 单次 provider 调用、unsupported provider 不发起 provider fetch、stream failure 返回 safeError；`tests/agent-kernel/config-assembly.test.ts` 覆盖 fallback-eligible selector 存在且不进入 `agent-model` invocation 输入。
