## 1. 契约重构

- [x] 1.1 `SandboxGatewayPort.startBackground` 返回 `{ handle, completion } | SafeError`，移除 `onComplete` 参数；`BackgroundExecutionHandle` 不变。来源：design D1。验证：`npm run build`。
- [x] 1.2 `SandboxExecutionPort` 新增 `runShellBackgroundable(input, context, signal)`。来源：design D2。验证：`npm run build`。

## 2. gateway 实现迁移

- [x] 2.1 `restricted-local-sandbox.ts` `startBackground`：spawn 后返回 `{handle, completion}`，`completion` 在 `close` 时 resolve 并关 fd。来源：design D1。验证：gateway contract tests。
- [x] 2.2 `deny-by-default-sandbox.ts` `startBackground` 返回 safeError（不变）。来源：design D5。验证：现有 deny-by-default 测试。

## 3. create-app 路径迁移

- [x] 3.1 `startBackgroundShell`（显式后台）改用 `completion.then(notify)` 替代 `onComplete`，复用 `buildBackgroundCompletionCallback`。来源：design D6。验证：`background-completion.test.ts` 仍通过。
- [x] 3.2 新增 `runShellBackgroundable`：`Promise.race([completion, timeout])`，前台完成读文件+`markNotified` 认领返回前台结果；timeout 返回 handle 并附加 `completion.then(notify)`。来源：design D2/D3。验证：unit tests。

## 4. bash-tool 前台分支

- [x] 4.1 `executeBash` 前台路径 `backgroundExecutionEnabled` 时调 `runShellBackgroundable`，识别 handle 形态转 SUCCEEDED handle 结果（透传 `backgroundReason`）。来源：design D4。验证：capability unit tests。
- [x] 4.2 remote（`backgroundExecutionEnabled:false`）前台仍 `runShell` + `ToolTimedOutResultError`。来源：design D5。验证：negative test 实际触发并断言 `TIMED_OUT`。

## 5. 测试与验证门禁

- [x] 5.1 `runShellBackgroundable` 单测：completion 先 resolve → 前台结果 + 不 submit。来源：design D3。验证：`npm test`。
- [x] 5.2 `runShellBackgroundable` 单测：timeout 先 resolve → handle + completion 后 submit 一次。来源：design D3。验证：`npm test`。
- [x] 5.3 竞态 negative test：前台完成不触发续跑；timeout 触发一次。来源：design D3。验证：`npm test`。
- [x] 5.4 characterization test：超时自动后台后主循环不阻塞。来源：rules。验证：`npm test`。
- [x] 5.5 运行 `npm run build && npm test && npm run test:contract && npm run lint:architecture && openspec validate --all --strict`。来源：proposal 验证。验证：全部通过。
