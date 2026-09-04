## 设计决策（Design Decisions）

### D1: startBackground 契约重构为 completion-promise

`SandboxGatewayPort.startBackground(request)` 返回：

```typescript
Promise<{ handle: BackgroundExecutionHandle; completion: Promise<BackgroundCompletionPayload> } | SafeError>
```

移除原 `onComplete` 回调参数。gateway 在 spawn 时注册 `child.once("close", ...)` resolve `completion`（并关闭 fd）。`handle` 立即返回，`completion` 供调用方按需 await 或 `.then`。这一重构统一了"子进程完成事件"的获取方式，使前台竞态路径与后台通知路径复用同一 spawn。

### D2: 前台自动后台路径（runShellBackgroundable）

`SandboxExecutionPort.runShellBackgroundable(input, context, signal)`（create-app 实现）：

1. 生成 `taskId`，`taskStore.create(record{status:RUNNING})`。
2. `const { handle, completion } = await gateway.startBackground(request)`。
3. `Promise.race([completion, timeoutPromise(input.timeoutMs)])`：
   - **completion 先 resolve**（命令在超时前完成）：`await markNotified(taskId)` 认领（防后续 notify）；读 `tool-results/<taskId>.stdout.txt`/`.stderr.txt`（截断 100KB）；返回前台结果 `{stdout, stderr, exitCode, stdoutTruncated, stderrTruncated, timedOut:false}`。**不**附加 `completion.then(notify)`，故无续跑通知。
   - **timeout 先 resolve**（命令超时）：附加 `completion.then(payload => markCompleted + markNotified(CAS) + submit 续跑)`；返回 `{ taskId, status:"RUNNING", stdoutRef, stderrRef, backgroundReason:"TIMEOUT_AUTO_BACKGROUND" }`（handle 形态）。进程继续跑，完成后 `completion` resolve 触发通知。

### D3: 竞态无锁正确性

前台完成与后台通知都靠 `markNotified` CAS 单点认领：
- 前台完成路径：`completion` resolve 后立即 `markNotified` → 赢 → 不 submit（模型已内联拿到结果）。
- 后台通知路径（仅 timeout 时附加的 `.then`）：`markCompleted` 后 `markNotified` → 若前台已认领则输 → 不 submit；若 timeout 路径则赢 → submit。
- 由于前台路径在 `completion` resolve 后**同步** `markNotified`（无 await 插入），且后台 `.then` 仅在 timeout 分支才附加，两者不会同时认领。`completion` 是单 promise，resolve 后微任务按附加顺序执行；前台 `await completion` 与后台 `.then` 不会同时在同一任务上存在（timeout 分支才附加 `.then`，此时前台已放弃）。

### D4: bash-tool 前台分支

`executeBash` 前台路径（`run_in_background !== true`）：
- `backgroundExecutionEnabled === true`：调 `runShellBackgroundable`。若返回 handle 形态（含 `taskId` + `status:"RUNNING"`）→ 返回 SUCCEEDED handle 结果（与显式后台同形态，`backgroundReason` 透传）；否则按现有前台结果处理（exitCode 非 0 仍 DEGRADED）。
- `backgroundExecutionEnabled === false`：调 `runShell`，超时仍 `ToolTimedOutResultError`（remote 行为不变）。

### D5: local-only 门控（延续）

`runShellBackgroundable` 仅在 local 装配下挂载到 sandbox port；remote 下 bash-tool 前台路径仍走 `runShell`。`deny-by-default` 的 `startBackground` 返回 safeError，`runShellBackgroundable` 在 remote 不被调用。

### D6: 显式后台路径迁移

`startBackgroundShell`（显式 `run_in_background`）改用 `completion.then(notify)` 替代原 `onComplete` 回调，复用 `buildBackgroundCompletionCallback` 的逻辑（markCompleted + markNotified + submit）。语义与 stage 1 等价。

## 质量属性审视

- **安全**：自动后台与显式后台同经 sandbox boundary + risk policy；audit 约束不变。验证：contract/architecture 测试。
- **性能/容量**：file-fd spawn 不阻塞主循环；前台完成读文件开销 ≤100KB，可忽略。验证：characterization test。
- **可靠性/恢复**：`markNotified` CAS 保证前台完成与后台通知不重复触发续跑；timeout 路径 `.then` 仅在 timeout 时附加，避免竞态。验证：竞态 negative test（前台完成不触发续跑；timeout 触发一次续跑）。
- **可维护性**：`completion` 统一完成事件获取，前台/显式后台/自动后台三路径复用同一 spawn。验证：code review。
- **可测试性**：`completion` 为可 mock promise；`runShellBackgroundable` 可单测。验证：mock 单测。
- **审计/可追溯性**：raw command 仍由 tool-use message 持久化；自动后台任务在 TaskStore 记录 safe summary + `backgroundReason`。验证：audit 断言。

## 验证映射（Verification Map）

| 验证点 | 验证入口 |
|---|---|
| `startBackground` 返回 `{handle, completion}` | gateway contract tests |
| 前台完成（超时前）返回前台结果且不触发续跑 | `runShellBackgroundable` unit test（mock completion 先 resolve） |
| 前台超时返回 handle 且 completion 后触发一次续跑 | `runShellBackgroundable` unit test（mock timeout 先 resolve） |
| `markNotified` CAS 防前台完成与后台通知重复 | 竞态 negative test |
| remote 前台超时仍 kill + TIMED_OUT | bash-capability test（remote 路径） |
| 显式后台路径迁移后语义等价 | 现有 `background-completion.test.ts` 仍通过 |
| OpenSpec 一致性 | `openspec validate --all --strict` |
