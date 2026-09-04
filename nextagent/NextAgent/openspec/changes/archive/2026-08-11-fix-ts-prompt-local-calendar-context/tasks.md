## 1. `FN-10.4 自定义工具和提示词`

- [x] 1.1 在 `packages/agent-context-engine/tests/prompt-shaping.test.ts` 增加 `Asia/Shanghai`、`America/New_York` 和 `UTC` 固定时钟测试，观察 rendered `timezone` 与 `currentDate`；实施前确认正、负时区跨日断言失败。
  来源：`FN-10.4 自定义工具和提示词` + `Prompt 日历变量使用同一进程本地语义` 全部 Scenarios
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-context-engine/tests/prompt-shaping.test.ts`；两个跨日目标用例实施前 MUST 失败，UTC characterization MUST 通过，并记录实际结果。
  实际结果：修正测试 fixture 后实施前 2 failed / 20 passed；上海 received `2026-08-09`、纽约 received `2026-08-10`，UTC 通过。

- [x] 1.2 修改 `buildPromptTemplateRenderContext`，用同一个 `now` 的本地年、月、日生成 `YYYY-MM-DD`；保留现有 `timezone`、render context、variable resolver 和模板选择路径，不新增 helper、clock port、公共字段或依赖。
  来源：`FN-10.4 自定义工具和提示词` + `Prompt 日历变量使用同一进程本地语义` 全部 Scenarios；design `修改方案`
  验证：运行 Prompt shaping Vitest；全部用例 MUST 通过，三个时区均返回规范日期，测试结束后全局状态恢复。
  实际结果：1 file / 22 tests passed；三个时区均通过，fake timers 与 `TZ` 在 `finally` 中恢复。

## 2. 必要说明接入

- [x] 2.1 将 `packages/agent-workflow/src/nodes/restful-time-param.ts` 中 “user's timezone” 修正为 “process-local timezone”，不得修改函数签名、解析、格式化、输入输出或测试期望。
  来源：proposal `What Changes`；design `修改方案`
  验证：`rg -n "user's timezone|process-local timezone" packages/agent-workflow/src/nodes/restful-time-param.ts` 只能命中修正后说明；`npx vitest run --config vitest.config.release.ts packages/agent-workflow/tests/workflow-capability-nodes.test.ts` MUST 通过。
  实际结果：`rg` 仅在第 66 行命中 `process-local timezone`；workflow capability nodes 1 file / 58 tests passed。

## 3. Change 整体验证

- [x] 3.1 使用仓内 `$nextagent-code-review` 检视实施 diff，确认没有用户/request 时区、配置、公共 contract、前端、新依赖或共享时间抽象，结论为 PASS 或 PASS WITH FOLLOW-UP，且无 P0/P1。
  来源：proposal `目标与非目标`；design `修改方案`、`风险与取舍`
  验证：记录检视结论和 findings 处理结果。
  实际结果：`nextagent-code-review` 结论 PASS；无 P0/P1/P2/P3 finding。实现只从同一个 `now` 投影进程本地年月日并修正既有注释，无用户/request 时区、配置、公共 contract、前端、新依赖或共享时间抽象；OpenSpec authoring gate PASS。

- [x] 3.2 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`；全部 MUST 通过并记录结果。
  来源：`FN-10.4 自定义工具和提示词`；design `验证策略`
  实际结果：更新至 `origin/main@a5896ac72` 后，`npm run build` PASS；`npm test` 155 files / 1937 tests PASS；`npm run test:contract` 46 files / 366 tests PASS；`npm run lint:architecture` 47 files / 293 tests PASS 且 dependency policy PASS；`openspec validate --all --strict` 315 PASS / 0 FAIL。

## 归档前更新基线检查（非实施任务）

归档流程按照 design 的“长期基线刷新计划”归并 stable spec、Function、Feature、architecture、module 和 spec-to-design-map。
