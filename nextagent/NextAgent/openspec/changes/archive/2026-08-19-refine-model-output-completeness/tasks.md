## 0. 公共契约前置门禁

- [x] 0.1 完成 additive `agent-contracts/model` refinement 的语义审查，确认 `ModelIncompleteOutputReason` 与 `ModelFinalResult.incompleteOutputReason` 不修改 frozen owner、Web/runtime/persistence 契约，并确认唯一实施路径可继续落地。
  来源：proposal `What Changes`；design `FN-4.1 调用模型/修改方案`；项目群于 2026-08-19 确认公共契约变更通过，确认结果由用户在当前归档任务中转达，未提供独立消息链接。
  验证：运行 `pnpm dlx @fission-ai/openspec@1.6.0 validate refine-model-output-completeness --strict` 并执行 `$nextagent-skill-review`；预期 strict validation 与语义审查均为 PASS，`需群内确认` 仅列本次已确认的 additive model contract 且无未解决项。

## 1. `FN-4.1 调用模型`

- [x] 1.1 先扩展 contract tests 与直接 schema consumer 测试，覆盖 `output-limit | truncated-tool-call`、optional/closed/null/unknown 校验、finish reason 独立保留、safeError 非法组合和现有结果兼容；实现前运行并确认目标断言失败。
  来源：`FN-4.1 调用模型` + Requirement `Non-streaming and streaming invocation share one terminal result contract` + Scenarios `非流式调用完成`、`流式调用完成`、`Stream 被取消或失败`。
  验证：运行 `pnpm exec vitest run packages/agent-contracts/tests/model-contracts.test.ts packages/agent-model/tests/lifecycle-hook-wrapper.test.ts`；实现前预期新增断言失败，实施后预期全部通过。

- [x] 1.2 先扩展 OpenAI-compatible adapter 测试矩阵，覆盖 complete/stream 下 `length`、`tool_calls`、`stop`、unknown、content filter、error，完整/残缺 Tool call，Token 等于/高于/低于上限，usage 缺失/非法，以及 content/reason/usage 保留；实现前运行并确认目标断言失败。
  来源：`FN-4.1 调用模型` + 系统质量属性“可靠性/恢复、安全” + Requirements `Failure exits are explicit and safe`、`输出超限不得静默截断` + Scenarios `Tool calls 原因下的参数截断触发一次重生成`、`Stop 或 unknown 原因下的参数截断使用同一规则`、`参数残缺但预算未饱和不推断截断`、`参数残缺且 usage 缺失不推断截断`、`Content filter 和 error 不进入恢复`。
  验证：运行 `pnpm exec vitest run packages/agent-model/tests/openai-compatible-provider.test.ts`；实现前预期新增截断分类断言失败，实施后预期全部通过且普通非法参数仍为 `MODEL_TOOL_ARGUMENTS_INVALID`。

- [x] 1.3 先扩展 Agent Core characterization 测试矩阵，覆盖两类不完整原因的预算提升、`truncated-tool-call` 不续写、重生成后完整 Tool call 唯一执行、仍不完整安全失败、显式 output-limit 三次续写、所有残缺 Tool call 零执行、取消和排除路径；实现前运行并确认目标断言失败。
  来源：`FN-4.1 调用模型` + 系统质量属性“可靠性/恢复、安全、性能/容量” + Requirement `输出超限不得静默截断` + Scenarios `明确 Token 超限提升预算后完成`、`推断截断重生成后返回完整 Tool call`、`推断截断重生成后仍不完整则安全失败`、`提升预算后最多续写三次`、`三次续写后仍超限则安全失败`、`取消中止恢复链`。
  验证：运行 `pnpm exec vitest run packages/agent-core/tests/model-output-recovery.test.ts packages/agent-core/tests/budget-degradation-notice.test.ts tests/agent-kernel/runtime-recovery-guard.test.ts tests/agent-kernel/tool-loop.test.ts`；实现前预期新增断言失败，实施后预期全部通过且 Capability invocation count 在残缺路径为 0。

- [x] 1.4 在 `agent-contracts/model` 实现 `ModelIncompleteOutputReason` 和 optional `ModelFinalResult.incompleteOutputReason` 的 closed TypeBox schema，更新必需的直接 contract consumer、测试 fixture 和 bounded diagnostic projection；不新增 Web、runtime、gateway 或 persistence 字段。
  来源：`FN-4.1 调用模型` + Requirement `Non-streaming and streaming invocation share one terminal result contract` + Scenarios `非流式调用完成`、`流式调用完成`；design `FN-4.1 调用模型/修改方案` 第 1、6 项。
  验证：运行 `pnpm exec vitest run packages/agent-contracts/tests/model-contracts.test.ts packages/agent-model/tests/lifecycle-hook-wrapper.test.ts packages/agent-log/tests/runtime-logger.test.ts`；预期新增字段合法、非法组合被拒绝、diagnostic 不含 raw payload。

- [x] 1.5 在统一终态 normalization 与 OpenAI-compatible adapter 实现封闭 decision table：先保留 finish reason/usage/content，再对明确 `length` 和预算饱和残缺 Tool call建立不完整原因；usage 缺失、非法、未饱和及 content-filter/error/safeError 继续安全失败。
  来源：`FN-4.1 调用模型` + Requirements `Failure exits are explicit and safe`、`输出超限不得静默截断` + Scenarios `Tool calls 原因下的参数截断触发一次重生成`、`Stop 或 unknown 原因下的参数截断使用同一规则`、`参数残缺但预算未饱和不推断截断`、`参数残缺且 usage 缺失不推断截断`、`Content filter 和 error 不进入恢复`；design `FN-4.1 调用模型/修改方案` decision table。
  验证：运行 `pnpm exec vitest run packages/agent-model/tests/openai-compatible-provider.test.ts packages/agent-model/tests/lifecycle-hook-wrapper.test.ts`；预期完整矩阵通过，finish reason 不被改写，残缺 arguments 不离开 adapter。

- [x] 1.6 将 `ModelRouteExecution` 的恢复入口改为 `incompleteOutputReason`，复用既有预算提升与 continuation 状态；`output-limit` 保持最多三次纯文本续写，`truncated-tool-call` 提升后仍不完整则以 `MODEL_OUTPUT_TOKEN_RECOVERY_UNSAFE_TOOL_CALL` 失败且不得续写或执行 Tool。
  来源：`FN-4.1 调用模型` + 系统质量属性“可靠性/恢复、安全、性能/容量” + Requirement `输出超限不得静默截断` + Scenarios `明确 Token 超限提升预算后完成`、`推断截断重生成后返回完整 Tool call`、`推断截断重生成后仍不完整则安全失败`、`提升预算后最多续写三次`、`取消中止恢复链`；design `FN-4.1 调用模型/修改方案` 第 5 项。
  验证：运行 `pnpm exec vitest run packages/agent-core/tests/model-output-recovery.test.ts packages/agent-core/tests/budget-degradation-notice.test.ts tests/agent-kernel/runtime-recovery-guard.test.ts tests/agent-kernel/tool-loop.test.ts`；预期全部通过，恢复调用次数有界，残缺 Tool 调用次数为 0，取消后无后续调用。

- [x] 1.7 完成 `FN-4.1` 聚焦回归，验证完整 Tool call 不依赖 finish reason、reasoning-only correction、fallback 可见输出保护、硬字符上限和现有显式 `length` 行为不回归。
  来源：`FN-4.1 调用模型` + Requirements `Non-streaming and streaming invocation share one terminal result contract`、`输出超限不得静默截断`；design `验证策略`。
  验证：运行 `pnpm exec vitest run packages/agent-model/tests packages/agent-core/tests/model-output-recovery.test.ts packages/agent-core/tests/budget-degradation-notice.test.ts packages/agent-core/tests/model-fallback-orchestration.test.ts tests/agent-kernel/runtime-recovery-guard.test.ts tests/agent-kernel/tool-loop.test.ts`；预期全部通过。

## 2. Change 整体验证

- [x] 2.1 完成公共 model contract 的 focused architecture guard 与 strict OpenSpec 校验，确认没有未经授权的 NetAgent external interface、private import、owner 或 public export 漂移。
  来源：proposal `影响范围`；design `验证策略`。
  验证：运行 `pnpm exec vitest run --config vitest.config.architecture.ts tests/architecture/netagent-external-dependency-interface-guard.test.ts`、`pnpm run test:contract`、`pnpm run lint:architecture`、`pnpm dlx @fission-ai/openspec@1.6.0 validate --all --strict` 和 `git diff --check`；预期全部通过。
  实际证据（Node 22.22.0，2026-08-12）：focused guard 9/9；PR contract 382/382；architecture 304/304；OpenSpec strict 与 `git diff --check` 通过。相同 `origin/main=ff1a56191` 的 contract 381/381、architecture 304/304。

- [x] 2.2 完成 backend 全量构建与测试，确认最小内核、其他 provider/consumer、workflow 与 runtime terminal 路径无回归。
  来源：proposal `影响范围`；design `验证策略`。
  验证：运行 `pnpm run build` 和 `pnpm test`；预期全部通过。无 frontend 变更，因此不运行 frontend build/test/e2e。
  实际证据（Node 22.22.0，2026-08-12）：PR `npm test` 2069/2069；同一环境的 `origin/main=ff1a56191` 为 2060/2060。两侧 `npm run build` 均只在 `packages/agent-capability/tests/skill-manifest.test.ts:674` 以同一 `TS2554` 失败；该文件不在 PR diff，故按用户要求记录为可复现基线豁免，不扩展本 change 修复范围。

- [x] 2.3 对最终提交范围执行 `$nextagent-skill-review` 与 `$nextagent-code-review`，修复全部 P0/P1 及可在当前范围内修复的 P2，再提交、push 并创建关联 issue 725 的 GitCode PR。
  来源：proposal `影响范围`；design `验证策略`；AGENTS.md push gate。
  验证：两项语义检视结论均为 PASS；`git status --short` 只包含本 change 文件；远端分支存在且 PR target 为 `main`、source 为 `codex/fix-inferred-model-output-truncation`。
  实际证据（2026-08-12）：两项复检均为 PASS、无未解决 P0/P1/P2；PR #1110 已存在，最终提交完成后推送同一 source branch。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”归并 stable spec、Function、Feature、overview、architecture、modules 和 spec-to-design-map；ADR 无变化。归档前确认没有重复定义 `incompleteOutputReason` schema、恢复 owner 或 Tool call 完整性规则。
