## 背景与问题（Why）

NextAgent 需要一个面向电信网络本地诊断场景的 Bash Tool Calling capability。第一版只支持受控、本地诊断命令，不提供通用宿主 shell；非 Python 命令强制只读，Python 依赖可信脚本审核。

业务调用流程：
1. 模型返回 `bash` tool call。
2. Bash Tool 校验输入并把 `command` 严格解析为单个 executable 和 arguments。
3. Bash Tool 按固定命令及参数策略授权。
4. Bash Tool 通过 Tool-facing `SandboxExecutionPort.runShell()` 调用受限本地 gateway adapter。
5. Tool 返回业务输出，由 `BuiltinToolExecutor` 校验并包装为 `CapabilityInvocationResult`。

## 变更范围（What Changes）

- 新增通过 `defineTool` 定义的 `bashToolDefinition`。
- 将 Bash 显式注册进 builtin Tool catalog。
- 输入字段与 TonyClaw Bash Tool 保持一致：`command`、可选 `description`、可选 `timeout`。
- 第一版明确不支持 `run_in_background`，仅支持有超时、取消和输出限制的有界前台执行。
- 默认只允许 `ls`、`cat`、`grep`、`head`、`tail`、`wc`、`python`、`python3`。
- `ToolCatalogConfig` 只能缩小默认命令集合，不能扩大；扩展命令集合需要后续 OpenSpec change。
- Python 只能执行可信配置中精确列出的 workspace 相对脚本。
- 新增受限本地 sandbox gateway adapter，作为默认、无进程隔离能力的本地执行实现。
- 宿主 shell 选择、Git Bash 检测和进程启动归 gateway adapter，不进入 Tool 实现。

## Capability 影响（Capabilities）

- 新增一个 builtin `TOOL` capability：`bash`。
- Bash 默认可用，因为 app composition 默认提供受限本地 adapter。
- 后续真实 sandbox adapter 必须复用相同 gateway contract 替换本地 adapter。

## 安全边界

- 所有执行必须经过 sandbox gateway boundary；Tool 不得直接调用宿主进程 API。
- 第一版禁止网络 CLI、受支持非 Python CLI 的文件写入、绝对路径、`..`、符号链接逃逸、设备文件和复杂 shell 语法。
- allowlist Python 脚本必须是可信管理员审核和配置的只读诊断代码；受限本地 adapter 不承诺阻止脚本内部文件写入或网络调用，强制文件系统与网络隔离延期到后续 sandbox runtime change。
- 完整命令已经存在于 assistant tool-use message，不得重复进入日志、metric、trace、audit、SafeError 或 result metadata。
- stdout/stderr 只以受限、可截断的 capability result 进入当前 request/run，不写入普通日志或 audit。

## 非目标（Non-Goals）

- 不提供真正的进程、容器或 OS 级隔离；由后续 sandbox runtime change 实现。
- 不支持后台任务、交互式命令、网络诊断或远程连接。
- 不支持 PowerShell、管道、重定向、变量展开、命令替换或复合命令。
- 不支持 `awk`、`sed`、`curl`、`ssh`、`telnet`、`nc`、`ping`、`traceroute`、`tracert`、`nslookup`、`dig`、`git`、`npm` 或 `node`。
