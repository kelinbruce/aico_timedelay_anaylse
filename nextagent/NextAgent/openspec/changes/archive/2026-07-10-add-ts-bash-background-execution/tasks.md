## 1. DTO 与 SPI 契约

- [x] 1.1 新增 `BackgroundTaskStoreGatewayPort` 与 `BackgroundTaskRecord`/`BackgroundExecutionHandle` 类型（`agent-contracts/src/gateway/`）。来源：design D1/D2/D3。验证：`npm run build` + 契约测试。
- [x] 1.2 `SandboxGatewayPort` 新增 `startBackground(request, onComplete): Promise<BackgroundExecutionHandle | SafeError>`。来源：design D1。验证：`npm run build`。
- [x] 1.3 `SandboxExecutionPort` 新增 `startBackgroundShell(input, context): Promise<{taskId,stdoutRef,stderrRef,status}>`。来源：design D1。验证：`npm run build`。
- [x] 1.4 `bashInputSchema` 改为工厂 `createBashInputSchema({ backgroundExecutionEnabled })`；output schema 同步工厂化 `createBashOutputSchema`。来源：design D5。验证：capability unit tests。

## 2. local TaskStore 与 sandbox startBackground 实现

- [x] 2.1 新增 `background-task-store-local.ts`：进程内 `Map`，实现 `create/get/list/markCompleted/markNotified(原子 CAS)/updateStatus`。来源：design D3/D6。验证：`background-task-store-local.test.ts`（含 markNotified 并发 CAS）。
- [x] 2.2 `restricted-local-sandbox.ts` 新增 `startBackground`：`spawn({detached:true, stdio:["ignore",outFd,errFd]}) + unref()`，立即返回 handle，注册 `close` 回调。来源：design D1/D2。验证：`npm run build` + deny-by-default 契约测试覆盖返回路径。
- [x] 2.3 复用 `sanitizedEnvironment`/`prepareExecution`/`validateRequest` 供前台 `executeProcess` 与后台 `startBackgroundProcess` 共享。来源：design D1。验证：`npm test`（前台路径行为不变）。
- [x] 2.4 `deny-by-default-sandbox.ts` 的 `startBackground` 返回 `SANDBOX_BACKGROUND_UNAVAILABLE` safeError。来源：design D5。验证：`deny-by-default-sandbox.test.ts` negative case 实际触发并断言。

## 3. bash-tool 后台分支

- [x] 3.1 `bash-tool.ts` 改为 `createBashToolDefinition({ backgroundExecutionEnabled })` 工厂。来源：design D5。验证：capability unit tests。
- [x] 3.2 `run_in_background:true` 且 enabled 时调 `startBackgroundShell`，立即返回 `{ taskId, status:"RUNNING", stdoutRef, stderrRef, message }`（SUCCEEDED）。来源：design D1。验证：`bash-capability.test.ts` mock sandbox 断言不 await 进程、runShell 未被调用。
- [x] 3.3 `backgroundExecutionEnabled:false` 时 `run_in_background` 被 schema 拒绝（remote 路径）。来源：design D5。验证：`bash-capability.test.ts` negative test 实际触发并断言 `CAPABILITY_INPUT_INVALID`。

## 4. 完成回调→注入续跑通路

- [x] 4.1 `buildBackgroundCompletionCallback`：`markCompleted` → `markNotified` 原子 CAS → 构造 task-notification 文本。来源：design D3。验证：`background-completion.test.ts`。
- [x] 4.2 调 `coordinator.submit(续跑command)`，`idempotencyKey:"bg-<taskId>"`。`SubmitRequestCommand.inputText` 直接承载 task-notification（已确认于 `agent-contracts/src/runtime/index.ts`），无需 `SessionMessageStore.appendMessage`。来源：design D3。验证：`background-completion.test.ts` mock coordinator.submit 断言调用一次且 inputText 含通知。
- [x] 4.3 重复 `close`/竞态不重复 submit（markNotified CAS）。来源：design D3/D6。验证：`background-completion.test.ts` negative test 实际触发重复完成并断言 submit 仅一次。
- [x] 4.4 `create-app.ts` 装配 TaskStore、按 `deploymentMode==="LOCAL"` 设 `backgroundExecutionEnabled`、注入 coordinator、注册 close→submit 回调。来源：design D5/D3。验证：`npm run build` + `npm run test:contract`。

## 5. 测试与验证门禁

- [x] 5.1 更新 `bash-capability.test.ts`：local 含 `run_in_background` / remote 不含；`run_in_background:true` 返回 taskId 不阻塞。来源：design D5。验证：`npm test`。
- [x] 5.2 后台单测：立即返回 taskId、不 await、缺 sandbox 仍 `UNAVAILABLE`/`SANDBOX_BYPASS_DENIED`。来源：design D1。验证：`npm test`。
- [x] 5.3 audit 不含 raw command/output 断言（`renderTaskNotification` 仅含 commandName/refs，deny-by-default 测试断言不含 secret/路径）。来源：design 安全/审计。验证：`background-completion.test.ts` + `deny-by-default-sandbox.test.ts`。
- [x] 5.4 architecture 测试：capability 源码不含 `spawn(`；`startBackground` 仅在 gateway 包。来源：design D1/安全。验证：`npm run lint:architecture`。
- [x] 5.5 contract 测试：remote 装配下 schema 不含字段且 `startBackground` 返回 safeError。来源：design D5。验证：`bash-capability.test.ts` + `deny-by-default-sandbox.test.ts`。
- [x] 5.6 characterization test：后台任务立即返回 task handle、不 await 进程退出、前台 runShell 不被调用（主循环不被阻塞）。来源：rules（runtime lifecycle/concurrency 改动必须含 characterization tests）。验证：`bash-capability.test.ts`。
- [x] 5.7 运行 `npm run build && npm test && npm run test:contract && npm run lint:architecture && openspec validate --all --strict`。来源：proposal 验证。验证：全部通过（`npm test` 仅 1 个 Windows sqlite EBUSY 环境性失败，与本次改动无关）。
