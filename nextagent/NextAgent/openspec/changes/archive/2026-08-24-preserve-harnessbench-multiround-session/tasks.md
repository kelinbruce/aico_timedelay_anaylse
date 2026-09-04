## 1. `FN-10.13 HarnessBench 评测`

- [x] 1.1 建立多轮候选/session 生命周期失败复现测试：同一 upstream session 连续执行两轮时复用 NextAgent session，不同 upstream session 返回不同 session；实施前确认同 session 当前返回不同 session
  来源：`FN-10.13` + 系统质量属性“可靠性/恢复” + Requirement `多轮任务保持会话连续且跨任务隔离` + Scenarios `同一 session 的第二轮观察第一轮会话事实`、`不同 session 保持隔离`
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/nextagent-cli.test.ts`；实现前多轮复用断言必须失败
  实际结果（2026-08-13）：实现前 10 tests 中新增 3 tests 失败；同 upstream session 两轮返回不同 NextAgent session，准确复现生命周期重置。

- [x] 1.2 建立候选 key 与私有 session 状态安全 negative tests：同形 session id 不碰撞，状态缺失可初始化，非法 JSON、版本、hash 或 NextAgent session id 安全失败且不使用部分状态
  来源：`FN-10.13` + 系统质量属性“可靠性/恢复” + Requirement `多轮任务保持会话连续且跨任务隔离` + Scenarios `首轮执行初始化会话`、`非法复用状态安全失败`；design `FN-10.13 HarnessBench 评测 / 修改方案` 第 1–3 项
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/nextagent-cli.test.ts`；实施前候选 key/状态 API 缺失导致目标测试失败，实施后全部 negative case 通过
  实际结果（2026-08-13）：实现前 key/state API 缺失；实现后 malformed JSON、未知版本、hash 错配、非法 session id 与同形输入碰撞测试全部通过。

- [x] 1.3 实现同 upstream session 的候选持久化和 NextAgent session 复用：首轮原子发布映射，后续轮次刷新运行配置但不删除持久化数据，每轮仍有界停止 runtime
  来源：`FN-10.13` + 系统质量属性“可靠性/恢复” + Requirement `多轮任务保持会话连续且跨任务隔离` + 全部 Scenarios；design `FN-10.13 HarnessBench 评测 / 修改方案`
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/nextagent-cli.test.ts tests/harnessbench/tests/execution-reliability.test.ts`；同 session 复用、跨 session 隔离、单轮路径、非法状态和预算测试全部通过
  实际结果（2026-08-13）：定向 2 files / 16 tests 通过；第二轮复用第一轮 session，模型请求包含第一轮用户事实，不同 upstream session 返回不同 NextAgent session。

- [x] 1.4 更新 HarnessBench 运维文档，明确多轮 session 生命周期、隔离边界和 candidate 状态清理归属，不改变报告与计分说明
  来源：proposal `What Changes`、`影响范围` + design `风险与取舍`
  验证：`rg -n "multi-round|session" tests/harnessbench/README.md`，并人工检查未宣称跨 task/run 复用或产品 contract 变化
  实际结果（2026-08-13）：README 明确同 upstream session 复用、每轮 runtime 重启、跨 session/task/run 隔离及 run-root 清理 ownership；未改变报告或计分说明。

## 2. Change 整体验证

- [x] 2.1 完成 HarnessBench 全套测试和 OpenSpec strict validation，确认 workspace bridge、diagnostics、评分、恢复 profile 与单轮执行无回归
  来源：proposal `影响范围` + design `验证策略`
  验证：`npx vitest run --config vitest.config.release.ts tests/harnessbench/tests` 与 `openspec validate preserve-harnessbench-multiround-session --strict`；全部通过
  实际结果（2026-08-13）：HarnessBench 全套 9 files / 53 tests 通过；change strict validation 通过。

- [x] 2.2 完成架构和语义检视，确认变更仅在 TestHarness 与 active change，路径/状态 fail closed，不修改 `packages/**`、公共 contract、产品默认配置或正式计分语义，结论不存在 P0/P1/P2
  来源：proposal `目标与非目标` + design `验证策略`
  验证：`npm run lint:architecture`、`openspec validate --all --strict`、`git diff --check`、`git diff --name-only`，并使用 `$nextagent-skill-review` 与 `$nextagent-code-review` 检视；命令通过且结论为 PASS
  实际结果（2026-08-13）：architecture 49 files / 304 tests 通过且无依赖违规；OpenSpec 全量 264 items 通过；`git diff --check` 通过。两项语义检视结论均为 PASS，无 P0/P1/P2；变更仅位于 `tests/harnessbench/**` 和本 active change，无 `packages/**` 变更。

## 归档前更新基线检查（非实施任务）

归档时按 design 的“长期基线刷新计划”同步 stable spec、Function、Feature、overview、architecture 和 spec-to-design-map；modules 与 ADR 保持无更新。
