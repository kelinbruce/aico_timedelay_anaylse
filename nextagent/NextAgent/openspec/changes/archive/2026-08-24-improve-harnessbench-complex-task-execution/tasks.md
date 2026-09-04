## 1. `FN-10.4 自定义工具和提示词`

- [x] 1.1 在 builtin Prompt Template assembly 测试中建立失败回归：`task_approach` 必须包含最小结构检查、尽早创建最小产物、分段 Tool call 和结束前验证指导，且不含 benchmark task id、oracle、rubric、grader 反馈或固定答案
  来源：`FN-10.4` + 性能/容量 + `内置系统提示提供有界产物执行指导` + 全部 Scenarios
  验证：实现前运行 `npx vitest run --config vitest.config.release.ts packages/agent-context-engine/tests/prompt-shaping.test.ts`，新增目标文案断言预期失败；既有 Agent override 测试继续通过。
  实际结果（2026-08-14）：实现前定向命令 22 tests 中新增用例失败 1 项，缺失点准确落在 `minimum inspection needed to determine their structure`；其余 21 tests（含既有 source priority/override 语义）通过。

- [x] 1.2 修改 builtin `SYSTEM_PROMPT/task-approach.md`，加入产品级复杂 workspace task 有界产物推进与验证指导，不新增 section、schema、配置或 HarnessBench 专用 prompt
  来源：`FN-10.4` + 性能/容量 + `内置系统提示提供有界产物执行指导` + 全部 Scenarios；design `FN-10.4 自定义工具和提示词 / 修改方案`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-context-engine/tests/prompt-shaping.test.ts packages/agent-context-engine/tests/prompt-template-assembly.test.ts`；预期目标文案、negative boundary 与 Agent override 全部通过。
  实际结果（2026-08-14）：定向命令 2 files / 43 tests 全部通过；目标文案、benchmark/task-id negative boundary 与既有 Agent source priority 均通过。

## 2. Change 整体验证

- [x] 2.1 验证产品 prompt、公共契约、架构和 OpenSpec；确认未新增 HarnessBench 专用 prompt，未修改 task catalog、oracle、grader、失败诊断、评分公式或 public contract
  来源：proposal `目标与非目标`、`影响范围`；design `验证策略`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-context-engine/tests/prompt-shaping.test.ts packages/agent-context-engine/tests/prompt-template-assembly.test.ts`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate improve-harnessbench-complex-task-execution --strict`、`openspec validate --all --strict`；预期全部通过。
  实际结果（2026-08-14）：prompt 定向 2 files / 43 tests、contract 49 files / 387 tests、architecture 50 files / 307 tests、change strict 与全量 OpenSpec 277 items 全部通过；`git diff --check` 通过。补充全量检查中，`npm run build` 被既有 `packages/agent-workflow/tests/workflow-node-logging.test.ts:127` implicit-any 阻断，`npm test` 被既有 `packages/agent-plugin-sdk/tests/northbound-output-normalization-hook.test.ts` 5 项预期差异阻断；两处均不在本 change 修改范围。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”归并 stable `prompt-template-assembly` spec、`FN-10.4` 与对应 architecture/module 事实。
