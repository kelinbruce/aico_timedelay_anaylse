## 1. `FN-11.1 恢复运行状态`

- [x] 1.1 先更新 `agent-app` lifecycle characterization：新增 deferred recovery 场景，断言 `app.start()` 在 recovery 未完成时 resolve、`SERVER_LISTEN` 与 `app.start.completed` 先于 recovery 终态，recovery degraded 不导致启动失败；同步更新既有启动顺序与 composition source 断言。
  来源：`FN-11.1 恢复运行状态` + `Local Runtime 启动必须执行 bounded recovery pass` + `Server readiness 可以先于 recovery 完成`、`Recovery 在 startup 时 gate scheduler dispatch`、`Recovery 失败不阻塞服务可用性`
  验证：实现前运行 `cmd /c npm test --workspace @nextagent/agent-app -- app-lifecycle-composition.test.ts composition.test.ts`；目标 lifecycle 顺序、deferred recovery 和 source wiring 断言失败，确认旧实现阻塞 `app.start()`（该命令还带入若干与本次无关的既有配置失败）。

- [x] 1.2 调整 `app-lifecycle-composition.ts` 启动顺序：RAG build 后先 `SERVER_LISTEN` 并记录 `app.start.completed`，再 fire-and-forget 执行 recovery，同时启动 pending-input timeout processing；将 `AppStartupFailureStage` 顺序调整为 `SERVER_LISTEN` 在 `RUNTIME_RECOVERY` 之前。
  来源：`FN-11.1 恢复运行状态` + `Local Runtime 启动必须执行 bounded recovery pass` + `Server readiness 可以先于 recovery 完成`、`Recovery 结束后恢复调度`
  验证：`cmd /c npx vitest run tests/app-lifecycle-composition.test.ts` 通过（20 tests）；`cmd /c npx vitest run tests/composition.test.ts -t "keeps app lifecycle composition responsible for startup and close wiring"` 通过（1 test）。deferred recovery 未 resolve 时 `lifecycle.start()` resolve，`server.listen` 与 `log:app.start.completed` 先于 recovery 终态。

- [x] 1.3 保持 runtime recovery 与 pending-input timeout characterization：运行既有 recovery、same-lane 和 pending-input timeout 目标测试，确认 dispatch gate、恢复后自动唤醒和单一 reconciliation Promise 行为不回退。
  来源：`FN-11.1 恢复运行状态` + `Local Runtime 启动必须执行 bounded recovery pass` + `Recovery 在 startup 时 gate scheduler dispatch`、`Recovery 结束后恢复调度`；design `FN-11.1 恢复运行状态` 修改方案
  验证：`cmd /c npx vitest run --config vitest.config.release.ts tests/agent-kernel/local-runtime-recovery.test.ts tests/agent-kernel/session-lane-scheduling.test.ts --maxWorkers=4` 通过（71 tests）；`cmd /c npx vitest run packages/agent-runtime/tests/workflow-pending-input-timeout-resume.test.ts` 通过（4 tests）。

## 2. Change 整体验证

- [x] 2.1 完成后端 workspace 与 architecture 常规验证。
  来源：proposal 影响范围 + design 验证策略
  验证：`cmd /c npm run build` 通过；`cmd /c npm test` 通过（172 files / 2242 tests）；`cmd /c npm run test:contract` 通过（50 files / 388 tests）；`cmd /c npm run lint:architecture` 通过（1594 modules 无依赖违规，54 files / 321 tests）。前端无改动，`frontend/agent-web` build/test/e2e 未运行。

- [x] 2.2 完成 OpenSpec 验证并确认全局失败不属于本 change。
  来源：proposal 影响范围 + design 验证策略
  验证：`cmd /c npx openspec validate fix-runtime-recovery-startup-readiness --type change --strict` 通过；`cmd /c npx openspec validate --all --strict` 已执行，结果为 287 passed / 23 failed，失败均为实现前已存在的其它 active change 或 stable spec 项，本 change 显示通过。

## 归档前更新基线检查（非实施任务）

归档流程按 design 的“长期基线刷新计划”更新 `local-runtime-recovery` stable spec、`FN-11.1` Function 文档、`ts-backend-architecture.md`、`agent-app.md` 和 `spec-to-design-map.md`，并确认未创建第二套 startup/readiness 状态模型。
