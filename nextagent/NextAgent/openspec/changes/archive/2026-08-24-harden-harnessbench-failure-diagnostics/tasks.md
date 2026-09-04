## 1. `FN-10.13 HarnessBench 评测`

- [x] 1.1 为多轮 adapter 证据汇聚建立失败复现测试：末轮摘要缺少失败字段时保留前序明确失败、多个失败取最后一项、任一轮工作区观测为真、非法/非结构化输出走安全 fallback；实施前确认至少一个目标断言失败
  来源：`FN-10.13` + 系统质量属性“审计/可追溯性” + Requirement `多轮 adapter 证据形成单一安全诊断` + Scenarios `末轮摘要不覆盖前序明确失败`、`多个明确失败采用最后一项`、`任一轮观测到工作区结果`、`没有合法结构化证据`
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/generic-cli-integration.test.ts`；实现前目标用例必须失败并指向当前只读取顶层 `adapter_result` 的缺口
  实际结果（2026-08-13）：实现前定向命令失败 4 项，其中多轮用例得到 `failurePhase=undefined`、`failureReasonCode=undefined`、`workspaceOutcomeObserved=false`，准确复现缺口。

- [x] 1.2 为模型输出上限观测与报告 v3 建立失败复现测试：覆盖失败/成功 task 达到上限、低于或缺少 usage、terminal 与评分不变、默认布尔、汇总计数及 JSON/Markdown 一致性；实施前确认目标断言失败
  来源：`FN-10.13` + 系统质量属性“审计/可追溯性” + Requirement `模型输出上限仅形成观测事实` + Scenarios `失败 task 达到输出上限`、`成功 task 达到输出上限`、`没有达到或没有 usage`、`JSON 与 Markdown 结论一致`
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/generic-cli-integration.test.ts tests/harnessbench/tests/scoring.test.ts tests/harnessbench/tests/report.test.ts`；实现前新增上限观测与 schema v3 断言必须失败
  实际结果（2026-08-13）：实现前定向命令中 schema 仍为 2、逐 task 上限字段与汇总计数缺失、Markdown 无观测行，相关目标断言全部按预期失败。

- [x] 1.3 为固定恢复回归 profile 建立失败复现测试：断言 profile 名称、`nonScoring=true` 和五个 task id 恰好一致，并纳入全部 profile contract 校验；实施前确认缺失 profile 导致测试失败
  来源：`FN-10.13` + Requirement `剩余失败类型具有固定恢复回归入口` + Scenarios `执行固定恢复回归`、`恢复回归保持非计分`
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/full-suite.test.ts`；实现前测试必须因 profile 缺失或集合不匹配失败
  实际结果（2026-08-13）：实现前两个 profile 目标用例均以 `ENOENT failure-recovery-regression.json` 失败，确认缺失入口。

- [x] 1.4 实现多轮 adapter 安全证据汇聚并让 fresh run 保留 `adapter_results[]`：报告形成最后一个明确失败、任一轮工作区观测和无合法证据 fallback，且不投影原始正文
  来源：`FN-10.13` + 系统质量属性“审计/可追溯性” + Requirement `多轮 adapter 证据形成单一安全诊断` + 全部 Scenarios；design `FN-10.13 HarnessBench 评测 / 修改方案` 第 2–3 项
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/generic-cli-integration.test.ts tests/harnessbench/tests/report.test.ts`；全部多轮、fallback 与安全 negative case 通过
  实际结果（2026-08-13）：定向测试通过；对 2026-08-12 原始 `007-session-memory` 回放恢复为 `stream_wait/STREAM_WAIT_FAILED`、`workspaceOutcomeObserved=true`，且 task 仍为 `agent_failed/taskScore=0`。

- [x] 1.5 实现共享候选输出上限和报告 v3 观测：候选配置与分类使用同一 `8192` output-token 上限，逐 task 必填布尔、汇总计数和 Markdown 展示一致，且不改变 terminal、失败原因、重试或计分
  来源：`FN-10.13` + 系统质量属性“审计/可追溯性” + Requirement `模型输出上限仅形成观测事实` + 全部 Scenarios；design `FN-10.13 HarnessBench 评测 / 修改方案` 第 1、4–5 项
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/generic-cli-integration.test.ts tests/harnessbench/tests/scoring.test.ts tests/harnessbench/tests/report.test.ts tests/harnessbench/tests/execution-reliability.test.ts`；schema v3、边界值、缺失值、汇总、一致性与非干扰断言全部通过
  实际结果（2026-08-13）：定向 28 tests 全部通过；对原始 `091-financial-close-reconciliation` 回放得到 `modelOutputLimitObserved=true`，并保持 `agent_failed`、`terminal/MODEL_TIMEOUT` 与 `taskScore=0`。

- [x] 1.6 新增 `failure-recovery-regression` 非计分 profile 和按需运行文档：固定五个代表 task，复用现有 profile/preflight/report 路径且不能生成正式总分
  来源：`FN-10.13` + Requirement `剩余失败类型具有固定恢复回归入口` + Scenarios `执行固定恢复回归`、`恢复回归保持非计分`；design `FN-10.13 HarnessBench 评测 / 修改方案` 第 6 项
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/full-suite.test.ts tests/harnessbench/tests/scoring.test.ts`；profile 集合、schema、非计分报告和 README 命令一致
  实际结果（2026-08-13）：profile contract 与非计分报告测试通过，README 已加入 `node tests/harnessbench/run.mjs --profile failure-recovery-regression`。

## 2. Change 整体验证

- [x] 2.1 完成 HarnessBench 全部无凭据自动化测试与 OpenSpec 严格验证，确认现有 grader、terminal、sandbox、infrastructure、评分和恢复语义无回归
  来源：proposal `影响范围` + design `验证策略`
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests` 与 `openspec validate harden-harnessbench-failure-diagnostics --strict`；全部通过
  实际结果（2026-08-13）：HarnessBench 全套 9 files / 46 tests 通过；change strict validation 通过。

- [x] 2.2 执行架构与语义检视，确认改动仅位于 `tests/harnessbench/**` 和 active change，未修改 `packages/**`、公共 contract、产品默认配置、HarnessBench 上游或正式计分语义，结论不存在 P0/P1/P2
  来源：proposal `目标与非目标`、`影响范围` + design `验证策略`
  验证：`npm run lint:architecture`、`git diff --check`、`git diff --name-only`，并使用 `$nextagent-skill-review` 与 `$nextagent-code-review` 检视；命令通过且语义结论为 PASS
  实际结果（2026-08-13）：architecture 49 files / 304 tests 通过，`git diff --check` 通过；OpenSpec 语义检视与代码检视均为 PASS，无 P0/P1/P2。改动仅在 `tests/harnessbench/**` 和本 active change；未触及 `packages/**`、公共 contract、产品默认配置、HarnessBench 上游或正式计分语义。补充门禁：`npm run build` 通过，`npm test` 166 files / 2085 tests 通过，`npm run test:contract` 48 files / 381 tests 通过，`openspec validate --all --strict` 263 items 通过。

## 3. Terminal fallback 闭合集

- [x] 3.1 为 terminal fallback 建立失败回归：`failed → TERMINAL_FAILED`，timeout/cancel 映射不变，非法 status 保持 `UNKNOWN`；实现前确认 `failed` 断言失败
  来源：`FN-10.13` + 系统质量属性“审计/可追溯性” + Requirement `评测失败提供安全诊断` + 全部 Scenarios
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/nextagent-cli.test.ts`；实现前新增 `failed` 断言必须失败并指向当前 fallback。
  实际结果（2026-08-14）：实现前定向命令 15 tests 中新增用例失败 1 项，失败原因为 `terminalReasonCode is not a function`，确认 helper 尚未暴露测试且 `failed` fallback 未闭合；其余 14 tests 通过。

- [x] 3.2 将 `failed` terminal 缺省原因码收敛为 `TERMINAL_FAILED`，保持公开 stream reason 优先、timeout/cancel 闭集映射和非法 status fail closed 不变
  来源：`FN-10.13` + 系统质量属性“审计/可追溯性” + Requirement `评测失败提供安全诊断` + 全部 Scenarios；design `FN-10.13 HarnessBench 评测 / 修改方案` 第 7 项
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/nextagent-cli.test.ts tests/harnessbench/tests/generic-cli-integration.test.ts`；terminal fallback 与既有分类断言全部通过。
  实际结果（2026-08-14）：定向命令 2 files / 36 tests 全部通过；`failed`、timeout、cancel、非法 status 与公开 stream reason 解析路径均通过。

- [x] 3.3 重新运行 HarnessBench 全套、architecture、contract 与 OpenSpec strict 验证，确认新增闭集码不改变 terminal、重试、评分或公共产品契约
  来源：proposal `目标与非目标`、`影响范围`；design `验证策略`
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate harden-harnessbench-failure-diagnostics --strict`、`openspec validate --all --strict`；预期全部通过。
  实际结果（2026-08-14）：HarnessBench 9 files / 64 tests、contract 49 files / 387 tests、architecture 50 files / 307 tests、change strict 与全量 OpenSpec 277 items 全部通过；`git diff --check` 通过。新增映射仅位于 TestHarness 私有 adapter，不改变产品公共契约、terminal、重试或评分语义。

## 归档前更新基线检查（非实施任务）

归档流程按照 design 的“长期基线刷新计划”同步 stable spec、Function、Feature、overview、architecture 和 spec-to-design-map；确认 modules 与 ADR 无更新，并确保长期基线不重复定义 TestHarness 报告字段、诊断规则或 profile 语义。
