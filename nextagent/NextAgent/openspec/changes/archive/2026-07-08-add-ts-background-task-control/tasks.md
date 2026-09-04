# tasks

## 1. 后端 kill 与状态

- [x] 1.1 `restricted-local-sandbox.ts`：`RestrictedLocalSandboxGateway` 新增 `backgroundChildren: Map<taskId, ChildProcess>`；`startBackgroundProcess` 返回 `child`，`startBackground` 方法 spawn 后注册、completion resolve 时移除；新增 `killBackground(taskId): Promise<{ killed: boolean }>`，命中 `child.kill("SIGTERM")`。`RestrictedLocalSandboxGatewayPort` 接口加 `killBackground`。来源：design D1。验证：sandbox 单测断言命中/未命中。
- [x] 1.2 `background-task-store-local.ts`：新增 `markKilled(taskId, { finishedAt })` 置 `status="KILLED"` + `finishedAt`；`markCompleted` 对 `record.status === "KILLED"` 返回 `undefined`（no-op）。`BackgroundTaskStoreGatewayPort`（`agent-contracts/src/gateway/index.ts`）加 `markKilled` 签名。来源：design D2。验证：`background-task-store-local.test.ts` 断言 markKilled + KILLED 下 markCompleted no-op。
- [x] 1.3 `background-completion.ts`：`buildBackgroundCompletionCallback` 用 `markCompleted` 返回值作 `stored`，返回 `undefined` 时跳过 `emitBackgroundTaskTerminal`。来源：design D2。验证：`background-completion.test.ts` 断言 KILLED 后 close 不发 FAILED 事件。
- [x] 1.4 negative verification：触发 kill→close 竞态路径，断言 store status 保持 KILLED 且无 `BACKGROUND_TASK_FAILED` 事件。来源：design D2 / spec "Kill close event does not overwrite KILLED"。验证：`background-completion.test.ts` + store 单测。

## 2. 契约与路由

- [x] 2.1 `agent-contracts/src/channel/index.ts`：`BackgroundTaskViewPort` 加 `readOutput(sessionId, taskId, stream, limitBytes)` 与 `kill(sessionId, taskId)`。来源：design D4。验证：`npm run build`。
- [x] 2.2 `agent-channel-web/src/routes/requests.ts`：新增 `GET .../background-tasks/:taskId/output?stream=&limitBytes=` 与 `POST .../background-tasks/:taskId/kill`，先 `requireSession`，未装配→503，未找到/跨 session→404。来源：design D5。验证：`npm run build` + 路由 contract test。
- [x] 2.3 `agent-app/src/composition/create-app.ts`：`adaptBackgroundTaskViewPort` 接 `{ store, sandboxGateway, workspaceRoot }`；实现 `readOutput`（session 校验 + `readBoundedOutput` + limitBytes 夹紧 `[1,262144]` 默认 65536）与 `kill`（RUNNING 校验 → `killBackground` → `markKilled`）；透传 `sandboxGateway`/`workspaceRoot` 进 `WebChannelRegistrationContext`。来源：design D3/D4。验证：`npm run build` + `npm run lint:architecture`。
- [x] 2.4 negative verification：contract test 断言跨 session `readOutput` 返回 unavailable、终态 `kill` 返回 `ALREADY_TERMINAL`、未知 taskId 返回 `NOT_FOUND`、超限返回 `truncated:true`。来源：spec "Output endpoint rejects cross-session access" / "Kill on terminal task is rejected"。验证：`npm run test:contract`。

## 3. 前端

- [x] 3.1 `state/contracts.ts`：重新加回 `BackgroundTaskView` 类型（taskId/commandName/status/startedAt/finishedAt?/exitCode?/stdoutRef/stderrRef）。来源：design D6。验证：`npm run build`（前端）。
- [x] 3.2 `services/backgroundTaskService.ts`（新）：`listTasks` / `readOutput` / `killTask` 走 `apiClient`。来源：design D6。验证：service 单测。
- [x] 3.3 `features/background-tasks/components/BackgroundTaskMonitorPanel.tsx`（新）：内联可折叠面板，列表（commandName/状态 Tag/耗时/exitCode）、行展开拉 stdout+stderr + 刷新、RUNNING 行 Kill（Popconfirm）、展开时 2s 轮询、无任务不渲染。来源：design D6 / spec Requirement 1-3。验证：`BackgroundTaskMonitorPanel.test.tsx`。
- [x] 3.4 `pages/ChatPage.tsx`：在 `RightPaneLayout` children 顶部挂载 `BackgroundTaskMonitorPanel`，传 `sessionId`。i18n 补 `backgroundTasks.*`。来源：design D6。验证：`npm run build`（前端）+ 组件测试。
- [x] 3.5 negative verification：组件测试断言 kill 控件仅 RUNNING 行出现、激活需确认、空 session 不渲染面板、折叠时停止轮询。来源：spec "Panel kill control is scoped to RUNNING" / "Empty session hides the panel"。验证：`BackgroundTaskMonitorPanel.test.tsx`。

## 4. 门禁

- [x] 4.1 `npm run build`（后端类型检查门禁，0 错误）。来源：proposal 验证。验证：命令本身。
- [x] 4.2 `npm test`（后端单测）+ `npm run test:contract` + `npm run lint:architecture` + `openspec validate --all --strict`。来源：proposal 验证。验证：命令本身。
- [x] 4.3 前端 `cd frontend/agent-web && npm run build && npm test`。来源：proposal 验证。验证：命令本身。
- [x] 4.4 端到端手测：`npm run dev:fullstack`，让 agent 后台跑 `sleep 30; echo hello`，展开面板→见 RUNNING→展开输出→Kill→见 KILLED；自然完成→见 COMPLETED + exitCode。来源：proposal 预期结果。验证：人工观察。
