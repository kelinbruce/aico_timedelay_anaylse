## 1. `FN-10.9 Cron 工具`

- [x] 1.1 在 `packages/agent-capability/tests/cron-expression.test.ts` 增加秋季第二个重复小时的缺陷复现：固定 `TZ=America/New_York` 和 origin `2026-11-01T06:15:30.000Z`，断言 `30 1 * * *` 的下一次命中为次日 `01:30`；实施前确认实际结果回到过去。
  来源：`FN-10.9 Cron 工具` + `Cron 本地日历匹配保持未来顺序` + `秋季第二个重复小时不回到过去`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/cron-expression.test.ts`；目标用例实施前 MUST 失败，勾选前记录命令和实际结果。
  实际结果：实施前 1 failed / 27 passed，received `1793511000000`（过去）而 expected `1793601000000`；实施后 28 passed。

- [x] 1.2 在同一文件增加 UTC 普通顺序、`America/New_York` spring gap 和 fall overlap 较早 offset 单次命中的 characterization；用 `try/finally` 保存并恢复 `process.env.TZ`。
  来源：`FN-10.9 Cron 工具` + `Cron 本地日历匹配保持未来顺序` + 其余三个 Scenarios
  验证：运行同一 Vitest 命令；除 1.1 目标失败外，新增 characterization MUST 通过，测试结束后 `process.env.TZ` MUST 恢复。
  实际结果：实施前仅 1.1 失败，其余 27 个用例通过；实施后 28 个用例全部通过，`TZ` 在 `finally` 中恢复。

- [x] 1.3 修改 `findNextOccurrence` 的单一命中返回分支：只返回 epoch 严格晚于 origin 的 candidate，不晚于 origin 时沿用现有本地分钟推进继续搜索；不得修改 parser、搜索上限、scheduler、gateway、持久化或依赖。
  来源：`FN-10.9 Cron 工具` + `Cron 本地日历匹配保持未来顺序` 全部 Scenarios；design `FN-10.9 Cron 工具 / 修改方案`
  验证：运行 Cron expression Vitest；全部用例 MUST 通过，1.1 的复现转为通过。
  实际结果：Cron expression test file 28 passed；生产 diff 仅增加 `originEpochMs` 与单一顺序分支。

- [x] 1.4 运行 LOCAL scheduler 回归，确认 UTC 到期比较、nextRunAt 推进、claim、重启 redelivery 和 delivery 生命周期未变。
  来源：design `FN-10.9 Cron 工具 / 修改方案`、`验证策略`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/local-cron-task-scheduler.test.ts` MUST 通过。
  实际结果：1 file / 3 tests passed。

## 2. Change 整体验证

- [x] 2.1 使用仓内 `$nextagent-code-review` 检视实施 diff，确认没有任务/用户时区、配置、公共 contract、持久化、前端、新依赖或第二套求值路径，结论为 PASS 或 PASS WITH FOLLOW-UP，且无 P0/P1。
  来源：proposal `目标与非目标`；design `修改方案`、`风险与取舍`
  验证：记录检视结论和 findings 处理结果。
  实际结果：`nextagent-code-review` 结论 PASS；无 P0/P1/P2/P3 finding。实现只在既有 Cron 求值路径增加严格未来顺序守卫和对应黑盒测试，无新 contract、配置、依赖、持久化或第二套求值路径；OpenSpec authoring gate PASS。

- [x] 2.2 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`；全部 MUST 通过并记录结果。
  来源：`FN-10.9 Cron 工具`；design `验证策略`
  实际结果：更新至 `origin/main@a5896ac72` 后，`npm run build` PASS；`npm test` 155 files / 1937 tests PASS；`npm run test:contract` 46 files / 366 tests PASS；`npm run lint:architecture` 47 files / 293 tests PASS 且 dependency policy PASS；`openspec validate --all --strict` 315 PASS / 0 FAIL。

## 归档前更新基线检查（非实施任务）

归档流程按照 design 的“长期基线刷新计划”归并 stable spec、Function、Feature、module 和 spec-to-design-map。
