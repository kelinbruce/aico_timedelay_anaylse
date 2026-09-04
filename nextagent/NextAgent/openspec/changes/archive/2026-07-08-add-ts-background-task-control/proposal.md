# proposal

## 背景与问题（Why）

`add-ts-bash-background-execution` 交付了后台异步执行与完成续跑通路，`add-ts-background-task-monitor-ui` 交付了列表端点 `GET /api/v1/sessions/:sessionId/background-tasks` 与 `BACKGROUND_TASK_*` timeline 事件（后端通路至今仍在）。但前端监控 UI（header 徽标 + 抽屉 + toast）在 `7f2f964d` 因 no-popup 要求被整体删除，只剩会话内联的完成卡片。结果：用户**看不到**当前 session 有哪些后台进程在跑，**看不到**它们的命令行输出，也**无法主动关闭**一个跑飞的进程。

当前后端**完全没有 kill 能力**：`startBackgroundProcess` 调用 `child.unref()` 后丢弃子进程句柄，无 PID 注册表，无法对在跑进程发终止信号。

需要：前端在聊天页内联展示当前 session 的后台进程列表与实时状态；可查看进程的 stdout/stderr 输出；可对 RUNNING 进程发起 SIGTERM 优雅终止。后端补齐 kill 能力与输出读取端点。

## 变更范围（What Changes）

- 后端 sandbox（`restricted-local-sandbox`）：保留后台子进程句柄注册表，新增 `killBackground(taskId)` 发送 SIGTERM。
- 后端 store（`background-task-store-local`）：新增 `markKilled(taskId, { finishedAt })`；`markCompleted` 对已 `KILLED` 记录 no-op，防止 kill→close 竞态回写 FAILED。
- 后端完成回调（`background-completion`）：用 `markCompleted` 返回值驱动终端事件发射，kill 后的 close 不再发误导性 FAILED 事件。
- 后端 channel 契约（`agent-contracts/src/channel`）：`BackgroundTaskViewPort` 新增 `readOutput` 与 `kill`。
- 后端 web channel（`agent-channel-web`）：新增 `GET .../background-tasks/:taskId/output` 与 `POST .../background-tasks/:taskId/kill` 路由。
- 后端组合边界（`agent-app`）：`adaptBackgroundTaskViewPort` 注入 sandboxGateway + workspaceRoot，实现 session 作用域的输出读取与 RUNNING-only kill。
- 前端（`agent-web`）：新增内联可折叠「后台进程」面板（列表 / 状态 / 输出查看 / Kill），挂载于聊天页 `RightPaneLayout` 内；新增 `backgroundTaskService`。
- local-only：kill 与输出读取仅 local 装配可用（与现有后台执行门控一致），remote 返回 unavailable。

## Capability 影响（Capabilities）

- 新增 `agent-web` capability：后台进程控制面板（`agent-web-background-task-control`）。
- 修改 `agent-platform-gateway-local` 模块：sandbox 新增 kill 能力，store 新增 markKilled。
- 修改 `agent-contracts` 模块：channel `BackgroundTaskViewPort` 扩展 readOutput/kill；gateway `BackgroundTaskStoreGatewayPort` 扩展 markKilled、`SandboxGatewayPort`/`RestrictedLocalSandboxGatewayPort` 扩展 killBackground。

## 受影响的 stable spec / design

- 受影响 stable spec：无直接基线（`agent-web-background-task-panel` 基线尚未建立，`add-ts-background-task-monitor-ui` 仍为 draft）。本 change 以 ADDED requirement 建立控制面板基线。
- 受影响 design：归档前需更新 `openspec/designs/modules/` 中 sandbox 与 web channel 模块设计，记录 kill 注册表与输出读取边界。

## 安全边界

- 输出读取与 kill 必须 session 作用域校验：`record.sessionId === 请求 sessionId`，禁止跨 session 读取输出或关闭进程。
- kill 仅允许对 `status === "RUNNING"` 的任务发起；终态任务返回 `ALREADY_TERMINAL`。
- 输出读取带字节上限（单流默认 65536 字节，可由 query 参数 `limitBytes` 调整，硬上限 262144 字节），超限截断并返回 `truncated: true`。
- 输出端点返回进程原始 stdout/stderr——**反转** `add-ts-background-task-monitor-ui` 的 "禁止向前端暴露 raw output" Non-Goal，属本次明确的产品决策。
- kill 用 SIGTERM 优雅终止；不提供 SIGKILL 兜底（v1）。
- timeline 事件 payload 仍仅含 safe 字段（不因本变更而暴露 raw output/command）；raw output 仅经显式输出端点按需返回，不进入事件流。

## 非目标（Non-Goals）

- 不重接 SSE/WS 实时推送驱动面板（v1 用轮询，面板展开时每 2 秒拉取列表）。
- 不做跨 session 全局任务视图，仅当前 session。
- 不改后台执行/续跑/自动后台通路本身。
- 不提供 SIGKILL 强杀或 kill 超时兜底。
- 不在事件流或列表端点中暴露 raw command line（仅暴露低基数 `commandName`）。

## 归档前更新基线

- `openspec/specs/agent-web-background-task-control/spec.md`：新增控制面板 spec（本 change 的 specs delta 提炼）。
- `openspec/designs/modules/`：sandbox 模块设计补 kill 注册表；web channel 模块设计补输出/kill 路由与 session 校验。
- `openspec/designs/spec-to-design-map.md`：补导航。
- `openspec/overview.md`：补后台进程可见可控能力背景。
