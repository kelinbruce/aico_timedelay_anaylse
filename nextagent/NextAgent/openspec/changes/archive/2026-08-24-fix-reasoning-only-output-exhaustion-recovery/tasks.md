## 0. 实施前置门禁

- [x] 0.1 在开始实施前验证前置收敛已经按固定顺序完成：`refine-model-output-completeness` 已先归档，`fix-model-empty-output-recovery` 已重基到刷新后的 stable 全文并随后归档；HarnessBench 侧 `harden-harnessbench-failure-diagnostics` 已先于 `harden-harnessbench-report-truth` 归档。确认 stable `model-invocation-contract` 同时具备 incomplete-output decision table 与“先预算提升、后 correction”，stable `harnessbench-evaluation` 具备 schema version 4；未满足时停止实施并回到对应前置 change 收敛，不在本 change 内修改其 artifact。
  来源：proposal `Context And Prerequisites`；design `FN-4.1 调用模型/目标与规范依据`、`FN-10.13 HarnessBench 评测/目标与规范依据`
  验证：运行 `openspec list --json`、`openspec validate --all --strict`，并以 `rg -n "incompleteOutputReason|reasoning-only|schema version 4" openspec/specs/model-invocation-contract/spec.md openspec/specs/harnessbench-evaluation/spec.md` 检查 stable 输入；预期四个前置 change 不再处于 active list、全量严格校验通过，且 incomplete-output、correction、schema v4 三类基线事实同时存在。
  验证结果（2026-08-24）：按传递依赖顺序归档 `refine-harnessbench-scoring-denominator`、`refine-harnessbench-score-publication`、`harden-harnessbench-failure-diagnostics`、`harden-harnessbench-report-truth`；`openspec list --json` 确认指定前置均不再 active，`openspec validate --all --strict` 为 308/308 PASS，stable grep 同时命中 `incompleteOutputReason`、reasoning-only correction 与 schema version 4。

## 1. `FN-4.1 调用模型`

- [x] 1.1 先修改 Agent Core characterization tests，复现首次 reasoning-only `output-limit` 当前会先把 `16384` 提升为 `32000` 的失败，并覆盖目标调用序列：原预算 correction、收敛成功、收敛后普通可见文本超限、重复 reasoning-only、fallback 成功/耗尽、普通文本超限、残缺 Tool call、取消和字符硬上限。
  来源：`FN-4.1 调用模型` + 系统质量属性“可靠性/恢复、安全、性能/容量” + Requirement `输出超限不得静默截断` + Scenarios `首次 reasoning-only 输出耗尽在原预算下收敛`、`收敛重试产出有效结果`、`收敛后转为普通可见文本超限`、`收敛后再次 reasoning-only 耗尽`、`普通文本超限保持先提升预算`、`残缺 Tool call 保持一次重生成`、`取消中止恢复链`、`硬字符上限保留有界内容`
  验证：实现前运行 `npx vitest run --config vitest.config.release.ts packages/agent-core/tests/budget-degradation-notice.test.ts packages/agent-core/tests/model-fallback-orchestration.test.ts tests/agent-kernel/runtime-recovery-guard.test.ts tests/agent-kernel/tool-loop.test.ts`；预期新增“首次 correction 仍为 `16384` 且无先行 `32000`”断言失败，既有 characterization 通过。实施后重跑，预期全部通过，重复耗尽 route 无 escalation/continuation 且残缺 Tool invocation count 为 0。
  验证结果（2026-08-24）：RED 为 2 failed / 92 passed，明确观测首次请求序列 `[16384, 32000]` 及重复耗尽仍留在 primary route；最终实现后同命令 4 files / 96 tests PASS，覆盖同预算 correction、fallback 成功/耗尽、无 incomplete evidence 的 length、finalizing 安全失败及既有普通超限、Tool、取消、字符上限路径。

- [x] 1.2 在 `packages/agent-core/src/model/model-route-execution.ts` 复用现有 reasoning-only 判定、收敛指令、单次状态和 `MODEL_EMPTY_OUTPUT`，把首次 reasoning-only `output-limit` 的 correction 移到预算提升之前，并按 design decision table 封闭 correction 后继分支；不修改 public contract、provider adapter、预算/续写/字符上限或 cancellation/fallback owner。
  来源：`FN-4.1 调用模型` + 系统质量属性“可靠性/恢复、安全、性能/容量” + Requirement `输出超限不得静默截断` + Scenarios `首次 reasoning-only 输出耗尽在原预算下收敛`、`收敛重试产出有效结果`、`收敛后转为普通可见文本超限`、`收敛后再次 reasoning-only 耗尽`；design `FN-4.1 调用模型/修改方案`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-core/tests/budget-degradation-notice.test.ts packages/agent-core/tests/model-fallback-orchestration.test.ts tests/agent-kernel/runtime-recovery-guard.test.ts tests/agent-kernel/tool-loop.test.ts`；预期目标调用序列、fallback、取消、Tool 安全与硬字符上限全部通过。
  验证结果（2026-08-24）：4 files / 96 tests PASS；首次 reasoning-only 请求预算保持 `[16384, 16384]`，再次耗尽映射为 retryable `MODEL_EMPTY_OUTPUT` 并进入既有 fallback，无 escalation/continuation；无 incomplete-output evidence 时不触发 correction，finalizing 重复耗尽安全失败；未新增 public contract 或 provider 分支。

- [x] 1.3 完成 `FN-4.1` 全包回归与架构边界检查，确认普通 `output-limit`、`truncated-tool-call`、reasoning-only stop、cross-model visible-output guard 和 minimal kernel 均未产生第二套恢复语义。
  来源：design `FN-4.1 调用模型/修改方案`、`验证策略（Verification Strategy）`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-core/tests tests/agent-kernel/runtime-recovery-guard.test.ts tests/agent-kernel/tool-loop.test.ts` 和 `npm run lint:architecture`；预期测试与 architecture gate 全部通过，`agent-core` 不新增 provider SDK/private import 或公共契约依赖。
  验证结果（2026-08-24）：Agent Core + minimal kernel 41 files / 517 tests PASS；`npm run lint:architecture` 无 dependency violation，package policy PASS，architecture 54 files / 321 tests PASS。

## 2. `FN-10.13 HarnessBench 评测`

- [x] 2.1 先为 run-local usage-proxy evidence summarizer 编写安全边界测试，覆盖 all-reasoning length 命中、普通可见 length、不等 token、缺失/非法 JSON、未完成请求、绝对与相对合法 ref、路径穿越、symlink 越界、超限文件和 token detail 缺失；实现前确认目标 true case 尚不能形成报告事实。
  来源：`FN-10.13 HarnessBench 评测` + 系统质量属性“审计/可追溯性” + Requirement `reasoning-only 输出耗尽形成独立报告事实` + Scenarios `全部 completion 均为 reasoning 的长度截断`、`普通可见输出长度截断不误标`、`证据缺失时关闭观测`
  验证：实现前运行 `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/model-evidence.test.ts tests/harnessbench/tests/generic-cli-integration.test.ts`；预期新增 true-case/路径边界断言失败。实施后重跑，预期只在五项证据全部成立时为 true，所有缺失和越界 case 为 false 且不泄漏原始字段。
  验证结果（2026-08-24）：RED 为 15 failed / 27 passed（summarizer 尚不存在）；实现后 2 files / 43 tests PASS，覆盖绝对/相对 ref、五项真值、非法/缺失/未完成、路径穿越、junction/symlink 最终越界、4 MiB/16 MiB 上限和 token detail 缺失。

- [x] 2.2 在现有 `tests/harnessbench/model-evidence.mjs`、`harness-runner.mjs`、`run.mjs` 边界实现异步、安全、fail-closed 的 evidence 投影，并只把净化 boolean 交给 task classification；live 与 resume prefix 路径必须复用启动期冻结的 `runRoot`，usage log 与所有 response ref 经过最终路径 containment、普通文件及 `4 MiB`/`16 MiB` 上限校验。
  来源：`FN-10.13 HarnessBench 评测` + 系统质量属性“审计/可追溯性” + Requirement `reasoning-only 输出耗尽形成独立报告事实` + Scenarios `全部 completion 均为 reasoning 的长度截断`、`普通可见输出长度截断不误标`、`证据缺失时关闭观测`；design `FN-10.13 HarnessBench 评测/修改方案`
  验证：运行 `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/model-evidence.test.ts tests/harnessbench/tests/generic-cli-integration.test.ts`；预期 evidence truth table、越界拒绝和既有 model usage verification 全部通过。
  验证结果（2026-08-24）：2 files / 43 tests PASS；live 与 resume prefix 均传入同一冻结 `runRoot`，resume integration 由真实 usage log/response fixture 断言恢复 boolean，分类器只接收 `modelReasoningOnlyOutputLimitObserved` boolean，读取异常统一 fail closed 为 false。

- [x] 2.3 先扩展报告 tests，锁定 schema version 5 的 task boolean、diagnostics count、JSON/Markdown 一致、timeout 原因保持、partial/interrupted default、评分不干扰和敏感字段拒绝；实现前确认 v4 报告不满足新 schema。
  来源：`FN-10.13 HarnessBench 评测` + 系统质量属性“审计/可追溯性” + Requirement `reasoning-only 输出耗尽形成独立报告事实` + Scenarios `全部 completion 均为 reasoning 的长度截断`、`timeout 终态保持真实原因`
  验证：实现前运行 `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/scoring.test.ts tests/harnessbench/tests/report.test.ts`；预期 schema version/new field 断言失败。实施后重跑，预期 v5 JSON/Markdown、聚合、terminal reason、score noninterference 与敏感字段 negative cases 全部通过。
  验证结果（2026-08-24）：RED 为 5 failed / 8 passed，命中 schema=4、新字段/聚合/Markdown 缺失；实现后加 generic integration 的聚焦命令 3 files / 35 tests PASS。

- [x] 2.4 将 `tests/harnessbench/report.mjs`、schema/type declarations、fixtures 与 README 单一提升到 schema version 5，增加 `modelReasoningOnlyOutputLimitObserved` 和 `modelReasoningOnlyOutputLimitObservedCount`，不维护 v4 双写/兼容分支，不改变现有 `modelOutputLimitObserved`、终态或评分计算。
  来源：`FN-10.13 HarnessBench 评测` + 系统质量属性“审计/可追溯性” + Requirement `reasoning-only 输出耗尽形成独立报告事实` + Scenarios `全部 completion 均为 reasoning 的长度截断`、`普通可见输出长度截断不误标`、`timeout 终态保持真实原因`；design `FN-10.13 HarnessBench 评测/修改方案`
  验证：运行 `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/scoring.test.ts tests/harnessbench/tests/report.test.ts tests/harnessbench/tests/generic-cli-integration.test.ts`；预期全部通过，聚合 count 恰等于 true task 数，timeout 仍为 `TASK_TIMED_OUT`。
  验证结果（2026-08-24）：3 files / 35 tests PASS；报告单一输出 schema version 5，JSON/Markdown 和 diagnostics count 一致，timeout 保留 `failurePhase=terminal` / `TASK_TIMED_OUT`，现有 score 与 output-limit observation 不变。

- [x] 2.5 先扩展 profile contract tests，再新增 `tests/harnessbench/profiles/reasoning-only-output-exhaustion-regression.json`，使其精确包含 `021-batch-rename-transform`、`037-policy-clause-retrieval` 且 `nonScoring=true`；既有 timeout profile 与 full suite 不变。
  来源：`FN-10.13 HarnessBench 评测` + Requirement `reasoning-only 输出耗尽具有固定非计分回归入口` + Scenarios `执行固定 reasoning-only 回归`、`reasoning-only 回归保持非计分`
  验证：实现前运行 `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/full-suite.test.ts tests/harnessbench/tests/preflight.test.ts tests/harnessbench/tests/scoring.test.ts`，预期新 profile selection 断言失败；实施后重跑，预期精确 task 清单、`nonScoring=true`、无 `frameworkEffectScore`，且既有 profile fixtures 全部通过。
  验证结果（2026-08-24）：RED 为 3 failed / 20 passed（profile 不存在）；新增固定 profile 后 3 files / 23 tests PASS，精确选择 021/037，`nonScoring=true`，既有 timeout/full-suite 断言保持通过。

- [x] 2.6 完成 HarnessBench Function 聚焦回归，确认 evidence、report、profile、恢复/中断与安全扫描共用既有唯一 runner 路径。
  来源：design `FN-10.13 HarnessBench 评测/修改方案`、`验证策略（Verification Strategy）`
  验证：运行 `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests`；预期 HarnessBench 全部 tests 通过，无新目录层、平行 runner 或评分分支。
  验证结果（2026-08-24）：HarnessBench 9 files / 93 tests PASS；只复用现有 `tests/harnessbench/**` 文件与 profiles 目录，未新增目录层、runner 或评分分支。

## 3. 跨 Function 集成与整体验证

- [x] 3.2 执行 change 完整工程门禁和模型语义检视，确认 OpenSpec、产品恢复、HarnessBench 私有 evidence、安全边界与 minimal kernel 一致，且无 P0/P1 finding。
  来源：proposal `Impact`；design `验证策略（Verification Strategy）`、`跨 Function 质量属性设计（Cross-Function Quality Attributes）`
  验证：运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`，并按仓内 `$nextagent-code-review` 对最终 diff 做语义检视；预期所有命令通过且检视结论为 `PASS` 或不含 P0/P1 的 `PASS WITH FOLLOW-UP`。
  验证结果（2026-08-24）：`npm run build` PASS；`npm test` 172 files / 2242 tests PASS；`npm run test:contract` 50 files / 388 tests PASS；`npm run lint:architecture` 无 dependency violation、package policy PASS、54 files / 321 tests PASS；`openspec validate --all --strict` 308/308 PASS；`git diff --check` PASS。`$nextagent-skill-review` 结论 PASS：Function/spec 1:1、Requirement 元数据、前置 stable 基线、owner 与唯一实施路径一致；`$nextagent-code-review` 结论 PASS：无 P0-P3 finding，未修改 frozen contract，Agent Core 恢复 owner、HarnessBench 私有 evidence 安全边界、minimal kernel 与完整验证证据一致。

## 归档前更新基线检查（非实施任务）

实现和验证全部完成后，归档流程按 design 的“长期基线刷新计划”合并两个 stable specs、两个 Functions、overview、两份 architecture、两个 module 设计和 spec-to-design-map；Feature 与 ADR 保持无变化，并确认不存在同一恢复顺序、报告字段或 evidence owner 的重复定义。
