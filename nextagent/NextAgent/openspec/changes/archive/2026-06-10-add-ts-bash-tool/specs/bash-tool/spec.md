## ADDED Requirements

### Requirement: Bash 工具使用现有 Tool 框架

系统 SHALL 通过 `defineTool` 定义 `bashToolDefinition`，在拥有的 builtin Tool 列表中显式注册它，并只通过现有的 catalog、`BuiltinToolExecutor`、capability invocation 和 sandbox gateway 边界执行它。

Tool 实现 SHALL 返回一个经过校验的业务输出对象，包含 `stdout`、`stderr`、`exitCode`、`stdoutTruncated` 和 `stderrTruncated`。它 SHALL NOT 返回 `CapabilityInvocationResult`；`BuiltinToolExecutor` SHALL 把成功的业务输出包装进 `CapabilityInvocationResult.structuredPayload`。

#### Scenario: Bash 通过 builtin Tool 路径注册

- **WHEN** capability 子系统创建 builtin Tool catalog
- **THEN** catalog MUST 包含 `bash` descriptor
- **AND** Bash 调用 MUST 使用 `CapabilityInvocationPort`
- **AND** Agent Core 和 Runtime 都不得直接调用 Bash Tool 或 gateway adapter

### Requirement: Bash 工具输入与 TonyClaw 兼容

Bash Tool 输入 SHALL 包含必需的 `command`、可选的 `description` 和可选的 `timeout`。`timeout` SHALL 默认为 120000ms，SHALL NOT 超过 600000ms，并且 SHALL NOT 超过可信的 invocation timeout。

首版 SHALL NOT 暴露或接受 `run_in_background`。它 SHALL 只支持带 timeout、cancellation 和输出上限的有界前台执行。后台 job 的 lifecycle 语义延期到单独的 change。

#### Scenario: 后台执行被 schema 拒绝

- **WHEN** model 提供 `run_in_background`
- **THEN** 输入 schema 校验 MUST 失败
- **AND** 任何命令都不得执行

### Requirement: Bash 只接受严格单一命令

Bash Tool MUST 在 gateway 执行之前把 `command` 严格解析为恰好一个可执行文件和一个参数数组。它 MUST 拒绝管道、重定向、复合操作符、变量赋值或展开、命令替换、glob 展开、response file、控制字符、格式错误的引号、绝对路径、父目录穿越、设备文件，以及任何无法被唯一解析的输入。

原始命令字符串 MUST NOT 被直接传递给宿主 shell。

#### Scenario: 复杂 shell 语法被拒绝

- **WHEN** `command` 包含被禁止的 shell 语法
- **THEN** invocation MUST 以 code `COMMAND_NOT_ALLOWED` 和 category `AUTHORIZATION` 失败
- **AND** gateway MUST NOT 被调用

### Requirement: Bash 默认命令是本地且只读的

默认可执行文件集合 SHALL 恰好是 `ls`、`cat`、`grep`、`head`、`tail`、`wc`、`python` 和 `python3`。

可信的 Tool 配置 MAY 缩减该集合，但 MUST NOT 增加可执行文件。扩展默认集合需要之后的 OpenSpec change。

- `ls` SHALL 只接受 workspace 相对目录和 `-l`、`-a` 或 `-la`。
- `cat` SHALL 只接受 workspace 本地的常规文本文件。
- `grep` SHALL 只接受 `-n`、`-i` 和 `-F`、一个有界的搜索 pattern，以及显式的 workspace 本地文件；递归搜索被禁止。
- `head` 和 `tail` SHALL 只接受取值从 1 到 1000 的 `-n` 和显式的 workspace 本地文件。
- `wc` SHALL 只接受 `-l`、`-w` 或 `-c` 和显式的 workspace 本地文件。
- `python` 和 `python3` SHALL 只执行可信 `allowedPythonScripts` 配置中精确的 workspace 相对 `.py` 路径。

`allowedPythonScripts` SHALL 默认为空，SHALL NOT 支持 glob pattern，并 SHALL 拒绝解释器选项、`-c`、`-m`、stdin 脚本、包安装、环境变量赋值、response file、绝对路径、父目录穿越，以及显式接受的数据形式之外的参数。

#### Scenario: 配置不能扩展命令权限

- **WHEN** 可信配置包含默认集合之外的可执行文件
- **THEN** Bash descriptor MUST 变为 unavailable 并带有安全的配置原因
- **AND** 该可执行文件 MUST NOT 运行

### Requirement: Bash 以 workspace 为范围且网络 CLI 被拒绝

首版 Bash 执行路径 MUST 使用可信的 workspace 工作目录，并 MUST 拒绝网络 CLI 命令。非 Python 命令策略 MUST 是只读的。它 MUST 拒绝绝对路径、父目录穿越、符号链接逃逸、设备文件、通过受支持 CLI 参数进行的文件写入，以及 model 提供的环境变量或凭据。

包括 `awk`、`sed`、`curl`、`ssh`、`telnet`、`nc`、`ping`、`traceroute`、`tracert`、`nslookup`、`dig`、`git`、`npm` 或 `node` 在内的命令 MUST NOT 执行。

Allowlist 内的 Python 脚本 MUST 是可信的、经管理员 review 的代码，并 MUST 按 read-only 诊断用途 review。受限的本地 adapter 不声明能够阻止 allowlist Python 脚本内部发起的文件写入或网络操作。强制执行的 Python 文件系统和网络隔离延期到之后的 sandbox runtime change。

#### Scenario: 文件逃逸或网络 CLI 被拒绝

- **WHEN** 某命令尝试写入、workspace 逃逸或网络 CLI 执行
- **THEN** 执行 MUST 在禁止的效果发生之前安全失败
- **AND** 该 negative case MUST 被可重复的测试覆盖

### Requirement: 宿主执行细节属于 gateway adapter

Bash Tool MUST 使用面向 Tool 的 `SandboxExecutionPort.runShell()` 依赖。App composition SHALL 默认提供受限的本地 adapter，使 Bash 无需之后的隔离 sandbox 即可可用。

面向 Tool 的 sandbox 依赖 SHALL 只接受结构化的执行意图（`command`、`args`、`timeoutMs`、`stdoutLimitBytes` 和 `stderrLimitBytes`）以及可信的 Tool 执行上下文。`runShell()` 和 `runPython()` SHALL 表达 sandbox 执行种类；app composition MUST NOT 从命令字符串前缀推断执行种类。Tenant、subject、request run、workspace、credential、环境或 owner scope 值 MUST NOT 作为 model 可控的 Tool 输入或临时 `JsonObject` 字段被传递。App composition MUST 从可信的 Tool 执行上下文推导 sandbox gateway 的 owner/run 字段。

`SandboxGatewayPort.execute()` SHALL 在 public gateway contract 中接受可选的 `AbortSignal`。`SandboxExecutionResult` SHALL 包含 `stdoutTruncated` 和 `stderrTruncated`，使输出边界证据在本地和未来 sandbox adapter 之间保持稳定。

受限的本地 adapter MUST 实现 sandbox gateway 边界，并拥有宿主可执行文件检测、Git for Windows 工具链或 Unix 可执行文件选择、进程执行、可信工作目录、净化后的环境、网络 CLI 拒绝、timeout、cancellation、输出字节上限和防御性路径校验。它 MUST 在禁用宿主 shell 解释的情况下启动结构化的可执行文件和参数值。Tool MUST NOT 解析宿主可执行文件路径或直接使用宿主进程 API。

受限的本地 adapter 不声明进程或网络隔离。之后的 sandbox runtime change MAY 通过相同的 gateway contract 替换它。

#### Scenario: 缺少 adapter 使 Bash 不可用

- **WHEN** app composition 未提供 sandbox 依赖
- **THEN** Bash descriptor MUST 为 `UNAVAILABLE`
- **AND** 它 MUST NOT 对 model 可见或可执行

### Requirement: Bash 结果有界且安全

stdout 和 stderr MUST 被独立限制，业务输出 MUST 指示截断。完整命令输出 MUST NOT 被写入日志、audit、trace、metric、SafeError 或结果 metadata。

退出码为零 SHALL 产生成功的 Tool 业务输出。非零退出 SHALL 产生 `FAILED`，其 code 为 `BASH_EXECUTION_FAILED`、category 为 `INTERNAL`、`retryable=false`。Timeout SHALL 产生 `TIMED_OUT`，其 code 为 `BASH_EXECUTION_TIMEOUT`、category 为 `TIMEOUT`。

#### Scenario: 输出被独立截断

- **WHEN** stdout 或 stderr 超出其配置的字节上限
- **THEN** 被返回的通道 MUST 被截断
- **AND** 其对应的截断标志 MUST 为 true

### Requirement: 现有 tool-use 持久化提供命令可追溯性

完整命令 SHALL 保留在现有的 assistant tool-use 消息中，并 SHALL 通过稳定的 `toolCallId` 与 capability lifecycle 和结果消息关联。

系统 MUST NOT 把原始命令复制到日志、指标、trace、audit 字段、SafeError 或结果 metadata 中。安全可观测性 MAY 只记录稳定标识符、低基数可执行类别、状态、时长桶、退出码类别、输出长度和截断标志。

#### Scenario: audit 保持安全

- **WHEN** Bash 执行被 audit 或记录日志
- **THEN** 该记录 MUST NOT 包含原始命令、stdout、stderr、脚本内容或宿主路径
- **AND** 可追溯性 MUST 使用已持久化的 tool-use 消息和稳定标识符
