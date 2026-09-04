## 背景与问题（Why）

`add-ts-bash-background-execution` 交付了后台异步执行与完成注入续跑通路，但后台任务对用户**不可见**——任务丢到后台后，用户无法知道当前有哪些在跑、哪些已完成、退出码是什么。这违背"任务可见可控"的诉求。

需要：前端提供后台任务监控视图，实时展示当前 session 的后台任务状态；任务完成时给出通知提示。后端通过 timeline 事件把任务状态变更推给前端。

## 变更范围（What Changes）

- 后端：TaskStore 状态变更时 emit timeline 事件 `BACKGROUND_TASK_STARTED`/`COMPLETED`/`FAILED`，payload 仅含 safe 字段（taskId、commandName、status、startedAt、finishedAt、exitCode、stdoutRef/stderrRef），不含 raw command/output。
- 后端：暴露 `GET /api/v1/sessions/:sessionId/background-tasks` 列表查询端点（按 session），经 channel 只读 `BackgroundTaskViewPort` 在组合边界投影为 safe 字段，供前端拉取初始列表（见 design D8）。
- 前端：`AIAgentPiuRuntime` 复用现有 `useSyncExternalStore` 订阅 timeline 事件流，收集 `BACKGROUND_TASK_*` 事件。
- 前端：新增后台任务监控面板组件，列出当前 session 后台任务（taskId、命令摘要、状态、开始时间、exitCode），状态实时刷新（RUNNING→COMPLETED/FAILED）。
- 前端：`BACKGROUND_TASK_COMPLETED`/`FAILED` 触发完成通知（toast/inline）。
- local-only：remote 部署不 emit 事件、不渲染面板。

## Capability 影响（Capabilities）

- 新增 `agent-web` capability：后台任务监控面板（`agent-web-background-task-panel`）。
- 修改 runtime timeline 事件契约：新增 `BACKGROUND_TASK_*` 事件类型。

## 安全边界

- timeline 事件 payload 仅 safe 字段；禁止 raw command、raw stdout/stderr、宿主路径。
- 前端仅展示 commandName（低基数可执行文件名）与状态，不展示完整命令行。

## 非目标（Non-Goals）

- 不在前端提供手动 kill 后台任务的能力（无 `TaskStop` 工具）。
- 不做跨 session 的全局任务视图；仅当前 session。
- 不改变后台执行/续跑通路本身（由 `add-ts-bash-background-execution` / `refine-ts-bash-timeout-auto-background` 承接）。

## 归档前更新基线

- `openspec/specs/agent-web-background-task-panel/spec.md`：新增前端监控面板 spec。
- `openspec/specs/agent-runtime-metrics/spec.md` 或 timeline 事件契约 spec：补充 `BACKGROUND_TASK_*` 事件类型。
- `openspec/designs/modules/`：更新 agent-web / runtime 模块设计，记录事件流与前端订阅。
- `openspec/designs/spec-to-design-map.md`：补充导航。
