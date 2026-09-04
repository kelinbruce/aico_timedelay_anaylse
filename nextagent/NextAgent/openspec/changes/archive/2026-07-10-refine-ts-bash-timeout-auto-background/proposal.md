## 背景与问题（Why）

`add-ts-bash-background-execution` 已交付显式 `run_in_background` 与完成注入续跑通路。但前台执行路径（模型未显式要求后台）在超时时仍 `child.kill()` 并返回 `TIMED_OUT`——一条耗时但最终会完成的诊断命令（长构建、慢脚本）会因超时被杀并失败，模型只能重试或放弃。

电信网络本地诊断中，长命令是否会在超时前完成往往不可预知。希望：前台命令超时时，若 local 部署启用了后台能力，**不杀进程，而是自动转入后台**，返回 task handle；进程继续跑，完成后照常走续跑通知通路。模型无需提前猜测命令耗时。

## 变更范围（What Changes）

- `SandboxGatewayPort.startBackground` 契约重构：返回 `{ handle, completion }`，`completion: Promise<BackgroundCompletionPayload>` 在子进程退出时 resolve；移除 `onComplete` 回调参数。调用方通过 `completion` 决定通知。
- 新增 `SandboxExecutionPort.runShellBackgroundable(input, context, signal)`：local 下前台执行走此路径——spawn 后台化进程（file-fd stdio），`Promise.race([completion, timeout])`：
  - completion 先 resolve：读输出文件（截断到 100KB），`markNotified` 认领，返回前台结果（无续跑通知）。
  - timeout 先 resolve：返回 task handle，进程继续跑；`completion.then(...)` 注册后续 markCompleted+markNotified(CAS)+submit 续跑通知。
- `bash-tool` 前台路径：`backgroundExecutionEnabled` 时调 `runShellBackgroundable`，识别返回的 handle 形态转为 SUCCEEDED handle 结果；否则保持现有 `runShell` + `TIMED_OUT`。
- remote 部署：`runShellBackgroundable` 不可用，前台仍 `kill + TIMED_OUT`，行为不变。
- `startBackground` 的显式后台路径改为用 `completion.then(notify)` 替代原 `onComplete` 回调（语义等价，契约统一）。

## Capability 影响（Capabilities）

- 修改 builtin `TOOL` capability：`bash`（前台路径分支）。
- 修改 `sandbox-runtime` 相关 gateway contract：`SandboxGatewayPort.startBackground` 返回值含 `completion`。
- 修改 `SandboxExecutionPort`：新增 `runShellBackgroundable`。

## 安全边界

- 自动后台仍经 sandbox boundary + risk policy（与显式后台同路径）。
- 超时转入后台的进程与显式后台进程遵守相同的 cleanup/AbortSignal 解耦/audit 约束。
- `markNotified` CAS 保证前台完成与后台通知不会重复触发续跑。

## 非目标（Non-Goals）

- 不改变前台命令的输出截断边界（100KB）。
- 不改变 remote 部署的前台超时语义（仍 kill + TIMED_OUT）。
- 不引入 `TaskStop` 工具；后台任务取消仍只通过 run cancel 解除监听。
- 前端监控视图由 `add-ts-background-task-monitor-ui` 承接。

## 归档前更新基线

- `openspec/specs/bash-tool/spec.md`：合并本 change 的 MODIFIED requirement（前台超时自动后台语义）。
- `openspec/designs/modules/`：更新 sandbox gateway 模块设计，记录 `startBackground` 返回 `completion` 的契约变化与 `runShellBackgroundable` 的前台/后台竞态处理。
- `openspec/designs/spec-to-design-map.md`：补充导航。
