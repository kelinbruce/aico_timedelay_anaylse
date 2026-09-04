## 背景与问题（Why）

`add-ts-bash-tool` baseline 把后台执行显式标注为 deferred：`openspec/specs/bash-tool/spec.md` 写明 `The first TS release SHALL NOT accept background execution controls`，design 也写明“后台任务所需的 job handle、状态查询、取消、cleanup 和恢复语义延期到独立 change”。

当前 Bash Tool 只支持前台阻塞执行：`executeBash` 通过 `await sandbox.runShell(...)` 等待进程退出才返回。Agent Core 的 tool loop（`executeToolCallsInOrder`）同步 `await` 每个工具，工具不返回就不进下一轮。因此任何耗时命令（构建、长诊断脚本）都会卡住整个主对话循环，模型无法在该轮继续推理或调用其他工具。

电信网络本地诊断场景需要长任务并行能力：诊断脚本可能运行数十秒到数分钟，期间智能体应能继续处理其他诊断、向用户汇报进度，并在长任务完成后自然读到结果继续推理。

## 变更范围（What Changes）

- Bash Tool 新增可选输入字段 `run_in_background: boolean`，仅在 local 部署下暴露给模型。
- 新增 Tool-facing sandbox 方法 `SandboxExecutionPort.startBackgroundShell(input, context)`，启动 detached 子进程，stdout/stderr 直写文件 fd，立即返回 `{ taskId, status:"RUNNING", stdoutRef, stderrRef }`，不 await 进程退出。
- 新增 `BackgroundTaskStoreGatewayPort` 及 local 进程内实现，记录后台任务状态（`RUNNING`/`COMPLETED`/`FAILED`/`KILLED`）与输出文件引用。
- 子进程退出回调原子置 `notified` 标志后，通过 `RequestLifecycleCoordinator.submit(...)` 注入一条 task-notification 续跑 command；lane 队列串行化保证续跑在当前 run 结束后调度。模型在续跑轮读到通知，按需用现有 Read 工具读 `stdoutRef`/`stderrRef` 文件。
- 新增 timeline 事件 `BACKGROUND_TASK_STARTED`/`COMPLETED`/`FAILED`，供前端订阅。
- 前端新增后台任务监控视图与完成通知。
- local-only 门控：`deploymentMode === "LOCAL"` 时 bash input schema 含 `run_in_background` 且 `startBackgroundShell` 可用；remote 部署下 schema 不含该字段，gateway `startBackground` 返回 safeError。

## Capability 影响（Capabilities）

- 修改 builtin `TOOL` capability：`bash`。输入 schema 条件化（local 含 `run_in_background`）；config schema 新增 `backgroundExecutionEnabled`。
- 修改 `sandbox-runtime` 相关 gateway contract：`SandboxGatewayPort` 新增 `startBackground`。
- 新增 gateway contract：`BackgroundTaskStoreGatewayPort`。
- 不新增 `TaskOutput`/`TaskStop` capability；查询/读取复用现有 Read 工具，取消复用现有 run cancel 语义。

## 安全边界

- 后台执行仍必须经过 sandbox gateway boundary 与 risk policy 评估；Tool 不得直接 `spawn`（architecture 测试禁止 capability 源码含 `spawn(`）。
- `taskId` 是逻辑标识，不含宿主路径；`stdoutRef`/`stderrRef` 是逻辑 refId，复用 `large-content-externalizer` 的 `tool-results/` 落盘约定。
- 日志、metric、trace、audit 禁止记录 raw command、stdout、stderr、脚本内容或宿主路径；沿用 baseline `Bash Results Are Bounded And Safe` 与 `Existing Tool Use Persistence Provides Command Traceability` 的可追溯性约束。
- 后台子进程不绑定 run AbortSignal；run cancel 只解除监听，不 kill 已 detach 的子进程。后台任务输出落盘文件受 workspace 路径约束与 size watchdog 保护。

## 非目标（Non-Goals）

- 不提供 `TaskOutput`/`TaskStop` 独立 capability；首版靠自动通知 + Read。
- 不支持交互式 stdin；后台任务 stdio stdin 为 `ignore`。
- 不做跨进程持久化恢复；TaskStore 首版为进程内实现，Node 进程退出后未完成的后台任务不恢复（监控视图标记为 STALE）。
- 不提供真正的进程/容器/OS 级隔离；沿用 baseline 的 sandbox runtime 边界。
- remote 部署不暴露任何后台能力；remote gateway `startBackground` 一律返回 safeError。
- 不实现超时自动后台（前台 `onTimeout` 转 detach）；由独立 change `refine-ts-bash-timeout-auto-background` 承接。本 change 前台超时仍为 `kill + TIMED_OUT`。
- 不实现前端监控视图与完成通知 UI；由独立 change `add-ts-background-task-monitor-ui` 承接。本 change 仅预留 `BackgroundTaskStoreGatewayPort` 查询面。

## 归档前更新基线

归档前需更新以下长期基线文档：

- `openspec/specs/bash-tool/spec.md`：合并本 change 的 MODIFIED/ADDED requirement。
- `openspec/overview.md`：补充后台执行能力的产品背景与 local-only 范围说明。
- `openspec/designs/architecture/`：新增或更新承载“后台任务生命周期 + 完成注入续跑跨模块流程 + lane 队列串行化 + AbortSignal 解耦”的架构主题文档。
- `openspec/designs/modules/`：更新 sandbox gateway / runtime lifecycle 模块设计，记录 `startBackground`、`BackgroundTaskStoreGatewayPort`、续跑 submit 的模块职责与 contract。
- `openspec/designs/spec-to-design-map.md`：补充 bash-tool spec 到新架构/模块设计文档的导航。
- 不新增 ADR；local-only 门控与续跑通路取舍记录在 architecture/modules 设计文档中。
