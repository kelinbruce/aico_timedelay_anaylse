## 设计决策（Design Decisions）

### D1: 后端 timeline 事件

TaskStore 状态变更（`create`/`markCompleted`）经观察者回调 emit timeline 事件：

- `BACKGROUND_TASK_STARTED`：任务创建时，payload `{ taskId, commandName, status:"RUNNING", startedAt, stdoutRef, stderrRef }`。
- `BACKGROUND_TASK_COMPLETED`/`BACKGROUND_TASK_FAILED`：`markCompleted` 时，payload 增加 `exitCode, finishedAt`。

事件经现有 timeline 投影通路（`timelineStore` + `RunTimelineEvent`）下发，但需打通 stream 白名单与前端枚举（见 D2）。payload 字段全部 safe（commandName 是低基数可执行文件名，非 raw command）。

### D2: 事件传输通路（SSE/WS StreamEnvelope）

后台任务事件经现有 SSE/WS stream 传输，但需打通三处白名单/枚举（设计初稿误以为可零改动复用，实际不然）：

1. 后端 `TimelineEventType`（`agent-common`）新增 `BACKGROUND_TASK_STARTED/COMPLETED/FAILED`。
2. 后端 `stream-envelope.ts` 的 `streamVisibleTimelineEvents` 白名单加入三类型，并在 `projectStreamPayload` 新增分支把 inlinePayload 的 safe 字段映射到 `payload`。
3. 前端 `STREAM_EVENT_TYPES`（`state/contracts.ts`）加入三类型，`contracts.test.ts` 同步断言。

事件持久化复用 originating `runId`/`requestId`（`BackgroundTaskRecord` 已保留），满足 `timeline_events.run_id NOT NULL`；sequence 仍是 session-scoped 递增，session-level live-tail 会推送给已连接前端。

### D3: run 外 emit 的 coordinator public API

后台任务在 originating run 终态后才完成，无法走 run 内 `emitEvent`。在 `RequestLifecycleCoordinator` 新增 public 方法 `emitSessionTimelineEvent(record)`：内部调 `timelineStore.appendEvent` 持久化 + `publishTimelineEvent(persisted)` 推送 subscriber queue。`background-completion.ts` 在任务 `create` 时 emit `BACKGROUND_TASK_STARTED`，在 `markCompleted` 后 emit `COMPLETED`/`FAILED`，字段从 `BackgroundTaskRecord` 取。local-only：仅 local 装配时注入 emit 回调。

### D4: 前端订阅与状态归并

`useStreamConnection.handleEnvelopeEvent` 新增 `BACKGROUND_TASK_*` 分派，回调 `onBackgroundTask` 写入一个 zustand store `backgroundTaskStore`，按 `taskId` 归并 `BackgroundTaskView`（taskId/commandName/status/startedAt/finishedAt?/exitCode?）。`useSyncExternalStore` 订阅该 store 驱动面板 re-render。

### D5: 监控面板组件

新增 `BackgroundTaskPanel` 组件，挂载于对话右侧栏或现有 process panel 区域（沿用 `agent-web-process-panel` / `agent-web-right-pane-styles` 的样式约定）。列出当前 session 后台任务，按 `startedAt` 倒序：

- RUNNING 项：显示 commandName + RUNNING 徽标 + 已运行时长。
- COMPLETED/FAILED 项：显示 commandName + status 徽标 + exitCode。
- 空状态：无后台任务时不显示面板（或显示空提示）。

### D6: 完成通知

`BACKGROUND_TASK_COMPLETED`/`FAILED` 事件触发一个轻量 toast 通知（沿用前端现有 antd `message` 静态方法），文案如 `Background task "npm" completed (exit code 0)`，仅 safe 字段。

### D7: local-only

后端仅在 `deploymentMode === "LOCAL"` 时 emit `BACKGROUND_TASK_*` 事件（emit 回调只在 local 装配注入）。remote 不 emit，前端订阅不到事件，面板自然不出现。无需前端单独门控。

### D8: 后台任务列表查询端点与 channel 只读视图端口

前端在 live-tail 建立时需按 session 回填已有后台任务（断线重连/补齐初始状态），仅靠 timeline 事件流不足。暴露 `GET /api/v1/sessions/:sessionId/background-tasks`：

- channel 契约（`agent-contracts/src/channel`）新增只读 `BackgroundTaskViewPort`（仅 `list(sessionId)`）与 safe 视图类型 `BackgroundTaskView`（taskId/commandName/status/startedAt/finishedAt?/exitCode?/stdoutRef/stderrRef）。gateway 端口与 `BackgroundTaskRecord` 不外泄到 channel。
- `WebChannelDependencies.backgroundTasks?: BackgroundTaskViewPort`；端点 handler 调 `list` 后经 `projectBackgroundTaskListItem` 投影为响应 safe 字段。未装配时返回 `503 BACKGROUND_TASKS_UNAVAILABLE`。
- `create-app` 在组合边界用 `adaptBackgroundTaskViewPort` 把本地 `BackgroundTaskStoreGatewayPort` 适配为 `BackgroundTaskViewPort`：`list` 结果在边界处剥离 identityContext/runId/requestId/raw command 等非 safe 字段后再注入 web channel。

架构约束：`agent-channel-web` 不允许依赖 `agent-contracts/src/gateway`（`no-channel-web-to-gateway-records` + 子路径 allowlist 仅 `channel|runtime`）；`agent-app` 的契约 allowlist 不含 `channel`，故适配器返回结构化对象、由 TS 结构兼容性匹配 `BackgroundTaskViewPort`，不显式命名该类型。验证：`npm run lint:architecture`。

## 质量属性审视

- **安全**：事件 payload 仅 safe 字段；前端不展示 raw command/output/路径。验证：contract test 断言 payload 不含 raw command。
- **性能/容量**：事件量与后台任务数成正比（低频）；前端 Map 归并 O(1) 更新。验证：code review。
- **可靠性/恢复**：前端从 timeline 流断线重连时，通过初始列表查询（按 session）补齐已有任务状态。验证：前端 component test。
- **可维护性**：复用现有 timeline 事件流与 useSyncExternalStore 订阅，不新建传输通道。验证：code review。
- **可测试性**：事件 payload 可 mock；面板组件可单独渲染测试。验证：前端 component test。
- **审计/可追溯性**：事件本身是 timeline 事件，可追溯；payload safe。验证：contract test。

## 验证映射（Verification Map）

| 验证点 | 验证入口 |
|---|---|
| `BACKGROUND_TASK_*` 事件 payload safe（不含 raw command/output） | contract tests |
| TaskStore create/markCompleted 触发事件 | backend unit tests |
| 前端订阅归并 task view | frontend component test |
| 面板渲染 RUNNING/COMPLETED 项 | frontend component test |
| local-only：remote 不 emit | contract test |
| OpenSpec 一致性 | `openspec validate --all --strict` |
