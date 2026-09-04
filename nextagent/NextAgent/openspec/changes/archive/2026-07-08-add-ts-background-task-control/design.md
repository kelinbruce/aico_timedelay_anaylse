# design

## 设计决策（Design Decisions）

### D1: kill 能力落在 sandbox，状态落在 store

`killBackground(taskId)` 是进程级操作，归属 sandbox gateway（`RestrictedLocalSandboxGateway`）：spawn 后把 `ChildProcess` 注册到 `Map<taskId, ChildProcess>`，completion resolve 时移除。`killBackground` 查表命中则 `child.kill("SIGTERM")`，未命中返回 `{ killed: false }`。

任务**状态**仍由 store 管理：新增 `markKilled(taskId, { finishedAt })` 置 `status="KILLED"` + `finishedAt`。kill 调用链在组合边界（adapter）里串起：先校验 RUNNING，再调 sandbox kill，成功后调 store markKilled。sandbox 不写 store，store 不持有进程句柄——职责单一。

### D2: sticky KILLED 防竞态回写

SIGTERM 后子进程 close 事件仍会触发 `startBackgroundProcess` 的 completion promise，进而触发 `buildBackgroundCompletionCallback` → `markCompleted`，会把 KILLED 改写成 FAILED（exitCode 非零）。两个最小改动消除该竞态：

1. `LocalBackgroundTaskStore.markCompleted`：若 `record.status === "KILLED"`，返回 `undefined`（no-op），不回写。
2. `buildBackgroundCompletionCallback`：用 `markCompleted` 的返回值作为 `stored`，返回 `undefined` 时跳过 `emitBackgroundTaskTerminal`——kill 后的 close 不再发误导性 FAILED 事件。

守卫仅针对 KILLED（最小变更）；自然完成的 COMPLETED/FAILED 幂等行为不变，现有测试不受影响。

### D3: 输出读取在组合边界，session 作用域校验

`adaptBackgroundTaskViewPort` 由只接 `store` 改为接 `{ store, sandboxGateway, workspaceRoot }`。`readOutput(sessionId, taskId, stream, limitBytes)`：

1. `store.get(taskId)` → 未找到返回 `{ unavailable: true }`。
2. 校验 `record.sessionId === sessionId`，不匹配返回 `{ unavailable: true }`（防跨 session 泄露）。
3. 解析 `${workspaceRoot}/${stream === "stdout" ? stdoutRef : stderrRef}`，复用现有 `readBoundedOutput(path, limit)`。
4. `limitBytes` 取 query 值，夹紧到 `[1, 262144]`，默认 65536。

`workspaceRoot` 为全局单根（`systemConfig.paths.workspaceRoot`），create-app 作用域内可用。输出文件路径 `tool-results/{taskId}.std{out,err}.txt` 由 sandbox 写入，相对 workspaceRoot，store 记录的 `stdoutRef/stderrRef` 即该相对路径。

### D4: channel 契约扩展，gateway 类型不外泄

`BackgroundTaskViewPort`（`agent-contracts/src/channel`）新增：

```ts
readOutput(sessionId: SessionId, taskId: string, stream: "stdout" | "stderr", limitBytes: number):
  Promise<{ content: string; truncated: boolean } | { unavailable: true }>;
kill(sessionId: SessionId, taskId: string):
  Promise<{ status: "KILLED" | "NOT_FOUND" | "ALREADY_TERMINAL" }>;
```

`agent-channel-web` 仍不得 import gateway 契约；adapter 在 `agent-app` 组合边界把 store+sandbox 投影为该 view port（结构化对象，TS 结构兼容匹配，不显式命名 channel 类型——与现有 `adaptBackgroundTaskViewPort` 一致）。

### D5: web channel 路由

- `GET /api/v1/sessions/:sessionId/background-tasks/:taskId/output?stream=stdout|stderr&limitBytes=N` → `backgroundTasks.readOutput`；未装配→503 `BACKGROUND_TASKS_UNAVAILABLE`；未找到/跨 session→404。
- `POST /api/v1/sessions/:sessionId/background-tasks/:taskId/kill` → `backgroundTasks.kill`；未装配→503；返回 `{ status }`。
- 两者均先 `requireSession({ identityContext, sessionId })` 做 identity/session 校验。

### D6: 前端内联面板 + 轮询

新增 `BackgroundTaskMonitorPanel`（`features/background-tasks/components/`），挂载于 `ChatPage` 的 `RightPaneLayout` children 顶部（消息列表上方），非弹窗，符合 no-popup：

- 列表按 `startedAt` 倒序：commandName + 状态 Tag（RUNNING/COMPLETED/FAILED/KILLED）+ 耗时 + exitCode。
- 行可展开：调用 `readOutput` 拉 stdout+stderr，`<pre>` 展示，带「刷新」按钮。输出按需拉取（展开时），不流式。
- RUNNING 行带「Kill」按钮（Popconfirm 确认）→ `killTask` → 刷新列表。
- 面板展开时每 2 秒轮询 `listTasks`；折叠或无任务时停止轮询。
- 无后台任务时不渲染面板。

`backgroundTaskService`（`services/`）封装 `listTasks` / `readOutput` / `killTask`，走 `apiClient`。`state/contracts.ts` 重新加回 `BackgroundTaskView` 类型。

### D7: local-only

kill 与输出读取随 `backgroundTasks` view port 装配门控：仅 local 装配注入该 port（与现有 list 端点一致），remote 不注入，端点返回 503。无需前端单独门控。

### D8: Windows kill 限制

Node `child.kill("SIGTERM")` 在 Windows 实为 `TerminateProcess`（硬终止），无真正信号语义。v1 接受该限制——kill 仍能把进程置为 KILLED 并释放资源；POSIX 下为真 SIGTERM 优雅终止。design 与 spec 注明该平台差异，不作为阻塞。

## 模块归属

| 能力 | 模块 | 文件 |
|---|---|---|
| 进程句柄注册表 + SIGTERM | `agent-platform-gateway-local` | `src/sandbox/restricted-local-sandbox.ts` |
| KILLED 状态 + sticky 守卫 | `agent-platform-gateway-local` | `src/sandbox/background-task-store-local.ts` |
| 完成回调防误发 | `agent-app` | `src/composition/background-completion.ts` |
| 契约扩展 | `agent-contracts` | `src/gateway/index.ts`、`src/channel/index.ts` |
| 路由 | `agent-channel-web` | `src/routes/requests.ts` |
| 组合边界 adapter | `agent-app` | `src/composition/create-app.ts` |
| 前端面板 + service | `agent-web` | `src/features/background-tasks/`、`src/services/`、`src/state/contracts.ts`、`src/pages/ChatPage.tsx` |

## 质量属性审视

- **安全**：输出读取与 kill 强制 `record.sessionId === sessionId` 校验（防跨 session）；kill 仅 RUNNING；输出带字节硬上限 262144。验证：contract test 断言跨 session 返回 unavailable、终态任务 kill 返回 ALREADY_TERMINAL、超限返回 truncated。
- **性能/容量**：输出按需拉取（展开时）+ 单流字节上限；轮询 2 秒/次仅面板展开时。验证：code review + 组件测试断言轮询启停。
- **可靠性/恢复**：sticky KILLED 消除 kill→close 竞态；进程句柄在 close 时移除，无泄漏；Node 重启后 RUNNING 记录变 STALE（与现有后台执行一致，非本变更引入）。验证：store 单测断言 KILLED 下 markCompleted no-op。
- **可维护性**：职责单一——sandbox 管进程、store 管状态、adapter 串链；channel 不依赖 gateway 契约。验证：`npm run lint:architecture`。
- **可测试性**：store/sandbox/adapter 可独立单测；面板组件可独立渲染测试。验证：对应测试文件。
- **审计/可追溯性**：kill 经 store markKilled 落 status=KILLED + finishedAt，列表端点可查；timeline 事件不因 kill 新增类型（仍 STARTED/COMPLETED/FAILED），kill 不发误导性 FAILED 事件。验证：单测 + code review。

## 验证映射（Verification Map）

| 验证点 | 验证入口 |
|---|---|
| markKilled 置 KILLED + finishedAt | `background-task-store-local.test.ts` |
| markCompleted 对 KILLED no-op | `background-task-store-local.test.ts` |
| killBackground 命中/未命中 | sandbox 单测 |
| 完成回调 kill 后不发 FAILED 事件 | `background-completion.test.ts` |
| readOutput 跨 session 返回 unavailable | contract test |
| kill 终态任务返回 ALREADY_TERMINAL | contract test |
| 输出超限 truncated | contract test |
| channel-web 不依赖 gateway 契约 | `npm run lint:architecture` |
| 面板列表/输出/Kill 交互 | `BackgroundTaskMonitorPanel.test.tsx` |
| OpenSpec 一致性 | `openspec validate --all --strict` |
