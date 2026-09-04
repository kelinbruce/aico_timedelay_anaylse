## 1. `FN-10.13 HarnessBench 评测`

- [x] 1.1 在 HarnessBench execution reliability 测试中复现 Windows 上游 `python3` 未绑定已预检解释器、冲突 `PATH` 可改变解析结果以及非法解释器路径必须失败的行为；实现前新增测试预期失败
  来源：`FN-10.13 HarnessBench 评测` + 系统质量属性“可靠性/恢复、可测试性、审计/可追溯性” + Requirement `Windows 上游 Python 命令使用已预检解释器` + Scenarios `上游 Oracle 通过 python3 使用已预检解释器`、`运行级命令不污染主机和固定上游`、`无法保证解释器身份时前置失败`
  验证：运行 `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/execution-reliability.test.ts`；实现前新增断言失败，实施后全部通过
  验证结果：2026-08-17 实施前目标测试 2 项因缺少 `resolvePythonExecutable` / `prepareHarnessPythonToolchain` 按预期失败，其余 28 项目标组合回归通过。

- [x] 1.2 在 HarnessBench runner 中解析并复用已预检解释器绝对路径，在 Windows runRoot 生成隔离 `python3` 命令、只向 task 环境前置该目录，并在第一个 task 前通过 Python `subprocess` 探针验证解释器身份
  来源：`FN-10.13 HarnessBench 评测` + 系统质量属性“可靠性/恢复、可测试性、审计/可追溯性” + Requirement `Windows 上游 Python 命令使用已预检解释器` + 全部 Scenarios；design `FN-10.13 HarnessBench 评测/修改方案`
  验证：运行 `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests/execution-reliability.test.ts`；预期真实 `python3` 子进程使用选定解释器，输入环境未被修改，非法或不一致身份 fail closed
  验证结果：2026-08-17 Windows 真实 `subprocess(["python3", ...])` 探针、隔离 `PATH`/`PYTHONHOME` 和非法相对路径负例 4/4 通过。

- [x] 1.3 验证固定上游、报告、自动重试和非 Windows 现有行为无回归，且本次改动未触及 `packages/**`
  来源：proposal `目标与非目标`、`影响范围`；design `验证策略`
  验证：运行 `npx vitest run --config vitest.config.release.ts tests/harnessbench/tests` 和 `git diff --name-only -- packages`；预期 HarnessBench 测试全部通过且 package diff 为空
  验证结果：2026-08-17 HarnessBench 9 files / 67 tests 全部通过；`git diff --name-only -- packages` 输出为空。

## 2. Change 整体验证

- [x] 2.1 完成 OpenSpec 严格校验和变更语义检视，确认新增运行目录架构评审、单一 owner、失败边界和长期基线计划闭合
  来源：design `新目录架构评审`、`验证策略`、`长期基线刷新计划`
  验证：运行 `openspec validate harden-harnessbench-upstream-python-runtime --strict`、`openspec validate --all --strict`；预期全部通过，并使用 `$nextagent-skill-review` 得出无 P0/P1 的 PASS 或 PASS WITH FOLLOW-UP
  验证结果：2026-08-17 change strict 与全量 OpenSpec 292/292 通过；`$nextagent-skill-review` 结论 PASS，无 P0/P1。

## 归档前更新基线检查（非实施任务）

归档流程按照 design 的“长期基线刷新计划”合并新增 Requirement，刷新 `FN-10.13` 前置条件和处理过程，并确认 `spec-to-design-map` 的测试入口无需或已完成同步。
