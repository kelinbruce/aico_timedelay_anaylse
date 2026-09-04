## 设计决策（Design Decisions）

### D1: 后台执行模型与不阻塞原理

后台启动走 `SandboxGatewayPort.startBackground(request)`，在 `restricted-local-sandbox` 内：

```typescript
const child = spawn(executable, [...args], {
  cwd,
  env: sanitizedEnvironment(request),
  shell: false,
  windowsHide: true,
  detached: true,
  stdio: ["ignore", fs.openSync(stdoutPath, "w"), fs.openSync(stderrPath, "w")]
});
child.unref();
```

`detached: true` + `child.unref()` 使子进程脱离 Node 事件循环，Node 进程退出后子进程可继续（首版不做跨进程恢复，仅保证不阻塞主循环）。stdout/stderr 直写文件 fd，完全不经过 JS 线程——这是长任务不阻塞主循环、不撑爆内存的根本原因。`startBackground` 立即返回 `BackgroundExecutionHandle { taskId, stdoutRef, stderrRef }`，不 await `close`。

前台 `executeProcess` 路径保持现状（pipe + 内存缓冲 + await close）。spawn/env/解析/权限校验逻辑抽为共享内部函数，供前台与后台复用。

### D2: 输出落盘与引用

后台输出写到 workspace `tool-results/<taskId>.stdout.txt` 与 `tool-results/<taskId>.stderr.txt`，复用 `large-content-externalizer` 的 `tool-results/` 目录约定。返回 `stdoutRef`/`stderrRef` 为逻辑 refId（`bg-<taskId>-stdout`），不是宿主路径。模型在续跑轮用现有 Read 工具按 refId 读取。size watchdog 每 5s 查文件大小，超阈值（沿用 100KB 软限制并允许配置上限）时不再追加写入并标记 truncated。

### D3: 完成通知注入续跑通路

子进程 `close` 回调（在 gateway 内注册）执行：

1. `taskStore.markCompleted(taskId, { exitCode, finishedAt })`。
2. `taskStore.markNotified(taskId)`：原子 CAS，仅当 `notified===false→true` 才继续；已 notified 则跳过（防 run-cancel/重复 close 与 exit 竞态导致重复 submit）。
3. 构造 task-notification 文本，含 `taskId`、`toolCallId`、`stdoutRef`、`stderrRef`、`status`（completed/failed）、`summary`（如 `"<command category>" completed (exit code 0)`，不含 raw command）。
4. `coordinator.submit({ identityContext, sessionId, agentId, input: taskNotificationText, idempotencyKey: "bg-<taskId>", priority: "NORMAL" })`。

`RequestLifecycleCoordinator.submit`（`submit.ts:454`）是 public 入口；lane 队列按 `tenant+subject+agent+session` 串行化（`pendingLaneWork`/`drainingLanes`）。后台完成时 submit 的续跑 command 进入同一 lane，scheduler 在当前 run 结束后自动调度——lane 队列即“等空闲再注入”语义，无需新建 idle 检查。`assertNoActivePendingInput`（`:502`）只挡 human-in-loop pending input，不挡普通续跑 submit，与 PendingInput 不冲突。

续跑 run 内，task-notification 文本作为该轮输入消息进入模型上下文；模型按需用 Read 工具读 `stdoutRef`/`stderrRef`。结果不内联在通知里，避免大输出爆 context。

`SubmitRequestCommand.inputText: string` 直接接受任意文本作为下一轮 user 消息（已确认于 `agent-contracts/src/runtime/index.ts:75`），因此续跑 command 的 `inputText` 即 task-notification 文本，无需额外的 `SessionMessageStore.appendMessage` 步骤。

### D4:（deferred）超时自动后台状态机

超时自动后台（前台 `onTimeout` 时转 detach 而非 kill）不在本 change 范围内，由独立 change `refine-ts-bash-timeout-auto-background` 承接。本 change 仅实现显式 `run_in_background`。前台超时仍保持现有 `child.kill()` + `ToolTimedOutResultError` 语义。

### D5: local-only 能力门控

bash 工具定义改为工厂 `createBashToolDefinition({ backgroundExecutionEnabled })`。`backgroundExecutionEnabled` 由 `systemConfig.gateway.deploymentMode === "LOCAL"` 在 `create-app.ts` 装配时注入（沿用 memory aging/task trajectory worker 的 local-only 门控惯例）。

- local：`bashInputSchema` 含 `run_in_background`（boolean, optional, default false）。
- remote：`bashInputSchema` 不含该字段，`additionalProperties: false` 拒绝模型传入。

双重保险：`deny-by-default-sandbox.ts` 与 remote gateway 的 `startBackground` 一律返回 `safeError`（`SANDBOX_BACKGROUND_UNAVAILABLE`）；即便 schema 误暴露，执行也拒。

### D6: 取消与 cleanup

后台子进程不绑定 run AbortSignal。run cancel（`controller.abort()`）只从 TaskStore 标记任务、解除 gateway 内的监听器，不 kill 已 detach 的子进程。子进程独立生命周期，退出时由其 `close` 回调正常走 D3 通知通路。Node 进程退出时未完成的任务在监控视图标记 STALE（首版不恢复）。fd 在 `close` 回调中关闭；watchdog 在任务终态时清理。

### D7:（deferred）前端监控与通知

后台任务的 timeline 事件（`BACKGROUND_TASK_STARTED`/`COMPLETED`/`FAILED`）、前端监控视图与完成通知不在本 change 范围内，由独立 change `add-ts-background-task-monitor-ui` 承接。本 change 仅保证后端任务状态可通过 `BackgroundTaskStoreGatewayPort` 查询，为前端监控预留查询面。

## 质量属性审视

- **安全**：后台执行经 sandbox boundary + risk policy；capability 层不 spawn（architecture 测试锁定）；taskId/refId 不含宿主路径；audit 禁 raw command/output；local-only 双重门控。验证：contract/architecture 测试。
- **性能/容量**：stdout/stderr 直写文件 fd 不经 JS 线程，不阻塞主循环、不占内存；size watchdog 防磁盘撑爆；lane 队列串行化续跑避免并发 run 状态混乱。验证：长任务不阻塞主循环的 characterization test。
- **可靠性/恢复**：`markNotified` 原子 CAS 防重复 submit；lane 队列串行化防多任务同时完成时续跑乱序；首版不跨进程恢复（STALE 标记）。验证：重复 close/竞态 negative test。
- **可维护性**：前台/后台共享 spawn/env/解析逻辑；工厂化 bash 定义；复用 `large-content-externalizer` 目录与 `coordinator.submit` 通路，不新建 idle 检查或第二套执行路径。验证：code review。
- **可测试性**：sandbox/coordinator 均为可 mock port；TaskStore 接口化。验证：mock 单测 + 契约测试。
- **审计/可追溯性**：raw command 仍由现有 assistant tool-use message 持久化，`toolCallId` 关联；后台任务在 TaskStore 记录 safe summary。验证：audit 不含 raw command/output 的断言。

## 验证映射（Verification Map）

| 验证点 | 验证入口 |
|---|---|
| input schema local/remote 条件化 | capability unit tests |
| `startBackgroundShell` 立即返回 taskId 不 await | capability unit tests（mock sandbox） |
| 输出落盘 `tool-results/` + refId | gateway contract tests |
| close 回调触发 submit 续跑且重复不重复 | gateway contract tests（mock coordinator.submit） |
| local-only 门控彻底性（remote 不暴露字段 + startBackground safeError） | contract tests |
| capability 源码不含 `spawn(` | architecture tests |
| 后台任务不阻塞主循环 | characterization test |
| audit 不含 raw command/output | unit/contract tests |
| OpenSpec 一致性 | `openspec validate --all --strict` |
