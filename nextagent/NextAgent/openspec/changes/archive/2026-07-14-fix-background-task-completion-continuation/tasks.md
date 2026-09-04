## 1. 完成回调边界修正

- [x] 1.1 删除 `agent-app` 自然后台任务完成回调中的 RuntimeCommandPort.submit 分支，使 callback 只记录完成状态和 timeline。
  验证：代码审查确认 `onBackgroundComplete` 仅委托 `buildBackgroundCompletionCallback`，且 kill channel 路径仍是唯一调用 `buildTaskNotificationCommand` 的产品路径。
  来源：background-task-completion 的“后台任务完成通知边界” requirement；design 的唯一实现路径。

## 2. 回归测试

- [x] 2.1 增加自然完成的后台化 Bash 集成测试，断言完成后原 RequestRun 为 COMPLETED、只有一个 RequestRun，且没有 `bg-notify-*` USER 请求。
  验证：`tests/agent-kernel/background-tasks-endpoint.test.ts` 在无全局 teardown 的 Vitest 配置下通过 7/7；该文件现有 release setup 会重复关闭已关闭的 SQLite 连接。
  来源：background-task-completion 的“普通 Bash 前台执行自然完成” scenario；design 的可靠性和可测试性决策。
- [x] 2.2 保留并运行显式 kill 场景，断言第一次 kill 生效、重复 kill 不重复执行；作为自然完成不得续跑的负向边界。
  验证：`tests/agent-kernel/background-tasks-endpoint.test.ts` 在无全局 teardown 的 Vitest 配置下通过 7/7。
  来源：background-task-completion 的“用户显式终止运行中的后台任务” scenario。

## 3. 验证和收尾

- [x] 3.1 运行受影响测试和仓库质量门禁，确认 runtime lifecycle 行为、架构边界及 OpenSpec 规格均通过。
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate fix-background-task-completion-continuation --strict`、`openspec validate --all --strict`。
  来源：proposal 影响范围；design 验证映射。

## 归档前更新基线检查（非实施任务）

- 同步 `openspec/specs/background-task-completion/spec.md`。
- 更新 `openspec/designs/modules/agent-app.md` 和 `openspec/designs/spec-to-design-map.md`，并检查无重复规范性事实。
