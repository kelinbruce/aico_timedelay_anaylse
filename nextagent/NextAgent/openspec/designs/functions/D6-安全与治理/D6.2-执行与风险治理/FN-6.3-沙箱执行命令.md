# FN-6.3 沙箱执行命令

> 能力域 D6 安全与治理 · 子域 [D6.2 执行与风险治理](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-6.3](../../../features/D6-安全与治理/D6.2-执行与风险治理/F-6.3-沙箱执行.md) |
| 主规格 | `sandbox-runtime` |
| 遗留规格 | `sandbox-deny-by-default-adapter` |
| 接口 | 沙箱网关 |

## 描述

通过沙箱网关执行命令或脚本，控制受信 root layout、超时、输出、环境和工作目录；执行不得改变调用前已存在资源的宿主权限元数据。

## 前置条件

- 沙箱网关可用。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 命令或脚本 | 是 | 要执行的内容 |
| 执行约束 | 否 | 超时、输出限制等 |

## 输出

执行结果（标准输出、标准错误、退出码）。

## 处理过程

1. 对受信 root layout 与入口执行约束进行校验。
2. 通过沙箱网关执行，控制超时、输出、环境和工作目录，且不修改原始文件或目录的 mode、ACL、所有权或只读属性。
3. 权限不足时安全失败；仅授权且可读但不可直接执行的脚本可在本运行 temp 根创建 sandbox-owned 临时副本执行。
4. 返回执行结果，并只清理该临时副本。
5. 流式 stdout 执行：当 sandbox gateway adapter 支持 `executeWithStdoutChunks` 时，`createWorkspaceBackedSandboxExecutionPort` 挂载 `runShellStreaming` 可选方法，`runSandbox` 接收 `onStdoutChunk` 参数并调用 `executeWithStdoutChunks(request, { onStdoutChunk }, signal)` 逐块回调 stdout，最终返回与 `execute` 相同形状的 `SandboxExecutionResult`；gateway 不支持时 `runShellStreaming` 为 `undefined`，调用方回退到 `runShell` 或 `runShellBackgroundable`，其他执行方法行为不变。
6. local 模式在执行 `curl` 或 Python 前按受信 API prefix 限制可识别网络目标：进程启动前提取 curl/Python 的显式 HTTP(S) URL 并校验目标（scheme、hostname、effective port 精确匹配且 normalized pathname 命中 prefix），并对唯一固定 sidecar Unix Socket `/opt/sidecar/ir/http.sock` 提供受控访问；未批准的显式访问或不受支持的 curl 路由参数在启动进程前安全拒绝，无显式 URL 的 Python 继续既有执行路径。

## 结果

- 正常：返回执行结果。
- 命令被拒绝：安全失败。
- 执行超时：安全失败。
- 权限不足：不暴露宿主绝对路径的安全失败，原始资源权限保持不变。

## 规格

| 规格项 | 规格值 | 状态 | 来源 |
|---|---|---|---|
| 命令执行超时 | 120,000 ms 默认，300,000 ms 硬上限 | 建议评审值 | 建议补充 |
| 标准输出/错误最大大小 | 1 MiB/流 | 建议评审值 | 建议补充 |
| 沙箱绕过允许次数 | 0 | 已定义 | 安全红线 |
| local 受控 API 匹配 | trusted HTTP(S) URL prefix；scheme、hostname、effective port 精确匹配且 normalized pathname 命中 prefix；空名单默认拒绝网络访问 | `sandbox-runtime`：`Local 模式从受信配置限制 API 目标` |
| local curl Unix Socket | 仅支持 `/opt/sidecar/ir/http.sock`，且目标 URL 必须同时命中受控 API | `sandbox-runtime`：`Local curl 只执行目标确定的受控请求` |
| 仓库默认 executable policy | 校验默认启用；默认 allowlist 精确为 `clipc`、`curl`、`python`；默认 denylist 为 Requirement 声明的 64 个高危成员；两表无共同成员；只允许 direct execution | `sandbox-runtime`：`默认 executable policy 固定且校验默认启用` |
| 后台 stdout/stderr 文件上限 | 每个文件分别 `10,485,760 bytes`；恰好达到允许，第一个超限字节触发失败 | `sandbox-runtime`：`Sandbox Failure And Resource Limits Are Explicit` |
| local Python 网络控制等级 | 仅对 source、script 和 argv 中的绝对 HTTP(S) URL literal 执行进程启动前 best-effort 检查；不检测动态目标，不构成恶意代码隔离或标准沙箱保证 | `sandbox-runtime`：`Local Python 对可识别网络目标执行过渡检查` |
| 流式 stdout 执行 | `SandboxExecutionPort.runShellStreaming`、`SandboxGatewayExecutionAdapter.executeWithStdoutChunks`、`runSandbox.onStdoutChunk` 均为可选；gateway 支持 `executeWithStdoutChunks` 时挂载 `runShellStreaming`，不支持时为 `undefined` 调用方回退；结果形状与 `runShell` 一致 | 已定义 | `sandbox-runtime`：`Sandbox Streaming Stdout Execution` |
