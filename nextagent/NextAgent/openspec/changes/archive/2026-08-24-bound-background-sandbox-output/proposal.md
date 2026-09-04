## Why

后台 sandbox 进程当前可以把 stdout 和 stderr 直接持续写入 workspace 文件而没有固定上限。无参数 Python 解释器在非交互 stdin 下可能反复输出错误；其他异常进程也可能产生同类无界输出。此类输出会耗尽宿主磁盘、阻塞 workspace 导出，并使原本局部的 Capability 失败扩散为运行环境故障。

系统需要在不依赖模型行为的前提下保证后台输出文件具有严格容量边界，同时在 Bash 输入边界拒绝确定不可用的交互式 Python REPL 调用。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- Bash 对 `python` 和 `python3` 的无参数调用在进入 sandbox 前返回可纠正安全失败。
- 本地后台 sandbox 的 stdout 和 stderr 文件分别最多写入 `10,485,760 bytes`。
- 任一输出收到第一个超出上限的字节时，系统停止继续落盘、终止根进程，并把 completion 解析为 `FAILED`。
- 父进程接管 pipe 落盘后，输出文件写入异常必须收敛为后台任务失败，不能终止宿主进程。
- resource-limit 观测信号只包含有界分类字段，不暴露命令、参数、输出内容、宿主路径或高基数 task identity。

**非目标：**

- 不允许客户端、模型或 Capability 参数配置后台文件上限。
- 不修改前台 sandbox 的既有 stdout/stderr projection 和 truncation contract。
- 不新增公共 gateway 字段、Web API、stream event、persistence table 或通用进程树管理 contract。
- 不把 Bash 输入校验当作唯一资源保护；出口硬限制必须独立成立。

## What Changes

- Bash 的 Python 调用模式校验新增零参数 REPL 拒绝，并复用既有 retryable `CAPABILITY_INPUT_INVALID` 与修复提示。
- 后台 sandbox 改由 gateway-local 从 stdout/stderr pipe 受控写入文件；每个通道只接受上限以内的字节。
- 超限时停止两个通道继续落盘、终止根进程、返回 `FAILED` completion，并发一次安全 resource-limit 观测信号。
- pipe 与 child 一并解除父进程存活引用；写盘异常在同一 owner 内转为 `FAILED` completion 和安全观测信号。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-6.3 沙箱执行命令` → `specs/sandbox-runtime/spec.md`
  - 功能边界：后台进程输出文件的固定容量、超限终止、失败结果和安全观测。
  - 系统质量属性：性能/容量、安全、可靠性/恢复、可诊断性。
  - 映射说明：`sandbox-runtime` 是 canonical spec，也是本 change 的主要 owner。
- `FN-5.5 执行命令和脚本` → `specs/command-script-tools/spec.md`
  - 功能边界：Bash 在 sandbox 提交前拒绝不支持的 Python CLI 模式。
  - 系统质量属性：安全、可维护性。
  - 映射说明：`command-script-tools` 是 canonical spec；本 change 原子迁移 `bash-tool` 中被触及的 legacy Requirement。

## 影响范围（Impact）

- 运维人员可观察到后台输出超限以明确失败结束，不再因单个 task 无界写盘破坏 workspace。
- Agent 会收到无参数 Python 调用的可纠正提示，并可改用 Python Tool、脚本或模块调用。
- 本 change 只新增 OpenSpec artifact 目录；该目录由 OpenSpec workflow 管理，归档后迁入 archive，不进入产品构建、打包或运行时。
