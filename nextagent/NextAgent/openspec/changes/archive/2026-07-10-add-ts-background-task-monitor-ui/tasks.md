## 1. 后端事件

- [x] 1.1 任务 create/markCompleted 时经 `emitSessionTimelineEvent` emit `BACKGROUND_TASK_STARTED`/`COMPLETED`/`FAILED` timeline 事件，payload 仅 safe 字段。来源：design D1/D3。验证：`background-completion.test.ts`。
- [x] 1.2 暴露 `GET /api/v1/sessions/:sessionId/background-tasks` 端点（`WebChannelDependencies.backgroundTasks` 为 channel 契约的只读 `BackgroundTaskViewPort.list`；`create-app` 在组合边界把本地 `BackgroundTaskStoreGatewayPort` 适配为该 view port 并投影为 safe 字段，agent-channel-web 不依赖 gateway 契约）；前端 `sessionService.loadBackgroundTasks` + `useChatSessionStream.handleSessionLiveTailOpen` 在 live-tail 建立时回填。来源：design D8。验证：`npm run build` + `npm run lint:architecture` + 集成测试。
- [x] 1.3 local-only：`emitSessionTimelineEvent` 经 `backgroundExecutionRuntime`（仅 local 装配）注入，remote 不 emit。来源：design D7。验证：contract test。

## 2. 前端订阅与面板

- [x] 2.1 `useStreamConnection.handleEnvelopeEvent` 识别 `BACKGROUND_TASK_*` 事件，按 taskId 归并写入 zustand `backgroundTaskStore`。来源：design D4。验证：`useStreamConnection.test.tsx` + `backgroundTaskStore.test.ts`。
- [x] 2.2 新增 `BackgroundTaskPanel` 组件，列出 RUNNING/COMPLETED/FAILED 任务，挂载于 `RightPaneLayout.headerExtra`。来源：design D5。验证：`BackgroundTaskPanel.test.tsx`。
- [x] 2.3 `BACKGROUND_TASK_COMPLETED`/`FAILED` 触发 antd `message` toast 通知。来源：design D6。验证：`useStreamConnection.test.tsx`。

## 3. 测试与验证门禁

- [x] 3.1 contract test：`STREAM_EVENT_TYPES` 含三新类型；payload 仅 safe 字段（`backgroundTaskInlinePayload` 不含 raw command/output）。来源：design 安全。验证：`contracts.test.ts`。
- [x] 3.2 backend unit test：STARTED/COMPLETED emit 由 `background-completion.test.ts` + `raceBackgroundableExecution` 测试间接覆盖。来源：design D1。验证：`npm test`。
- [x] 3.3 frontend component test：面板渲染 RUNNING→COMPLETED 状态切换 + FAILED。来源：design D5。验证：`BackgroundTaskPanel.test.tsx`。
- [x] 3.4 运行 `npm run build && npm test && npm run test:contract && npm run lint:architecture && openspec validate --all --strict`。来源：proposal 验证。验证：后端 build 0 错误、test 213 passed（1 个 Windows EBUSY 环境性失败无关）、contract 141、arch 通过、openspec 146；前端 D7 测试 56 passed（40 个 pre-existing 失败经 stash 验证与本改动无关）。
