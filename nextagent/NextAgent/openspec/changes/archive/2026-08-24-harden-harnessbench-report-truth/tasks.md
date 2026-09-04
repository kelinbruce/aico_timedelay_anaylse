## 1. `FN-10.13 HarnessBench 评测`

- [x] 1.1 为显式计分总体和互斥分档建立失败复现测试：覆盖 failed task 具有正向 `combinedScore`、五个分档边界、JSON/Markdown 同源及 partial/non-scoring 不发布摘要；实施前确认目标断言因 schema v4 与 `scoreSummaries` 缺失而失败
  来源：`FN-10.13` + 系统质量属性“审计/可追溯性” + Requirement `计分报告提供显式总体的互斥统计` + 全部 Scenarios
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/scoring.test.ts tests/harnessbench/tests/report.test.ts`；实现前新增断言必须失败并准确指向报告统计缺口
  实际结果（2026-08-18）：实施前定向组合命令中 schema 仍为 3、`scoreSummaries` 缺失、Markdown 无显式总体，两项 scoring 目标和一项 Markdown 目标按预期失败；未完成与 non-scoring 排除断言保持通过。

- [x] 1.2 实现 schema v4 计分摘要和 Markdown/README 真值收敛：使用一个纯函数生成 `execute/taskScore` 与 `terminalStatus=scored/combinedScore` 摘要及五档互斥分布，保持既有 FES、失败归零和覆盖发布语义不变
  来源：`FN-10.13` + Requirement `计分报告提供显式总体的互斥统计` + design `报告计分摘要`
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/scoring.test.ts tests/harnessbench/tests/report.test.ts`；两组总体、边界、负向排除和 JSON/Markdown 一致性全部通过
  实际结果（2026-08-18）：包含 scoring/report 的四文件定向命令 34 tests 全部通过；failed task 的正向 `combinedScore` 只进入诊断列，不进入任一 scored 总体或 FES，分数 1 只进入 `perfect`。

- [x] 1.3 为 stream idle-close cursor 续接和闭集原因码建立失败复现测试：使用本地 HTTP/SSE fixture 覆盖带 sequence 的 non-terminal close 后以最高 cursor 续接、非成功 HTTP、无法续接的 terminal 前关闭、transport 中断和本地等待预算耗尽；实施前确认续接缺失且三类失败仍收敛到通用 fallback 或没有目标原因码
  来源：`FN-10.13` + 系统质量属性“审计/可追溯性” + Requirement `stream 等待失败使用可行动的闭集原因码` + 全部 Scenarios
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/nextagent-cli.test.ts`；实现前目标断言必须失败，且不得以原始响应体或异常正文作为断言依据
  实际结果（2026-08-18）：实施前 HTTP、无 terminal 和 transport 三项均因缺少结构化安全字段失败；补充 cursor 场景实施前以 `STREAM_CLOSED_WITHOUT_TERMINAL` 失败，确认 adapter 没有续接 stable 5 分钟 idle-close stream。

- [x] 1.4 实现同一 accepted run 的有界 stream cursor 续接和闭集分类：续接共享原始 deadline 且不重提请求；已知 HTTP、无法续接的关闭和 transport 条件形成安全 `HarnessTaskFailure`；本地等待预算继续走既有 `terminal/TASK_TIMED_OUT`，不增加 task/model/Capability 重试、产品轮询或 timeout 变化
  来源：`FN-10.13` + Requirement `stream 等待失败使用可行动的闭集原因码` + design `stream 等待失败分类`
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/nextagent-cli.test.ts tests/harnessbench/tests/generic-cli-integration.test.ts`；四类原因码、阶段、安全字段与既有 terminal 映射全部通过
  实际结果（2026-08-18）：定向命令 2 files / 40 tests 全部通过；第二个连接使用首连接最高 `sequence=7`，同一 run 得到 terminal；HTTP、无 cursor 关闭、transport 与本地预算仍分别形成唯一安全结论，transport envelope 无 raw cause。

- [x] 1.5 为固定 stream 失败回归入口建立失败复现测试并新增 `stream-failure-regression` profile：断言 profile 名称、`nonScoring=true`、八个 task id 恰好一致、catalog 合法且报告不发布 FES
  来源：`FN-10.13` + Requirement `stream 失败具有固定非计分回归入口` + 全部 Scenarios
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/full-suite.test.ts tests/harnessbench/tests/scoring.test.ts`；实施前 profile 缺失断言失败，实施后集合、通用执行路径和非计分边界全部通过
  实际结果（2026-08-18）：实施前两个 profile 断言以 `ENOENT stream-failure-regression.json` 失败；实施后 2 files / 13 tests 全部通过，八 task 集合与 catalog 一致，non-scoring 报告无 FES 和 `scoreSummaries`。

## 2. Change 整体验证与框架候选识别

- [x] 2.1 完成 HarnessBench 无凭据自动化测试、构建、架构与 OpenSpec 严格验证，确认改动仅位于 `tests/harnessbench/**` 和本 active change，未修改 `packages/**`、公共 contract、产品默认配置、timeout、重试或 FES 公式
  来源：proposal `目标与非目标`、`影响范围` + design `验证策略`
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests`、`npm run build`、`npm run lint:architecture`、`openspec validate harden-harnessbench-report-truth --strict`、`openspec validate --all --strict`、`git diff --check`、`git diff --name-only`
  实际结果（2026-08-18）：HarnessBench 9 files / 73 tests、architecture 50 files / 308 tests、root build、change strict 与全量 OpenSpec 294 items 全部通过；`git diff --check` 通过，`git diff --name-only -- packages` 无输出。未运行真实八 task profile，因为当前进程没有候选与 grader credential；本地 8-17 完整运行证据已用于 root-cause 收敛。

- [x] 2.2 使用 `$nextagent-skill-review` 与 `$nextagent-code-review` 完成语义检视，并基于新原因码与固定回归入口形成框架优化候选清单；每个 `packages/**` 候选必须包含证据、唯一 owner、拟改文件、黑盒预期和验证路径，提交用户评审前不得实施
  来源：proposal `非目标` + design `明确不修改的边界`、`风险与取舍`
  验证：检视结论明确为 PASS / PASS WITH FOLLOW-UP / BLOCKED；`git diff --name-only -- packages` 无输出；候选清单不把 stream 边界现象直接表述为 provider 或框架根因
  实际结果（2026-08-18）：`$nextagent-skill-review` 与 `$nextagent-code-review` 均为 PASS，无 P0/P1/P2。design 已记录 078 的 `agent-runtime` characterization 候选与 088 的 `agent-core` 收敛策略候选，均包含运行证据、唯一 owner、拟改文件、黑盒预期和验证路径；未实施任何 `packages/**` 变化。provider 32 次相关响应全部为 HTTP 200，P0 主因收敛为 adapter 未续接 stable 300 秒 subscriber idle close。

## 归档前更新基线检查（非实施任务）

归档流程按照 design 的“长期基线刷新计划”同步 stable spec、Function、Feature 和 `e2e-quality-gates`；确认 overview、modules、ADR 与 spec-to-design-map 无需正文变化，并确保长期基线不产生第二个报告或诊断 owner。
