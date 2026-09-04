## 设计决策（Design Decisions）

### D1: Tool 输入和输出

模型可见输入与 TonyClaw Bash Tool 保持一致：

```yaml
command: string
description?: string
timeout?: number
```

`timeout` 默认 120000ms，最大 600000ms，并且不得超过受信 capability invocation timeout。

第一版刻意删除 `run_in_background`，仅支持带超时、AbortSignal 和输出限制的有界前台执行。后台任务所需的 job handle、状态查询、取消、cleanup 和恢复语义延期到独立 change。

Tool 返回业务对象，不返回 `CapabilityInvocationResult`：

```yaml
stdout: string
stderr: string
exitCode: number
stdoutTruncated: boolean
stderrTruncated: boolean
```

`BuiltinToolExecutor` 负责 output schema validation，并将业务对象包装进 `CapabilityInvocationResult.structuredPayload`。

### D2: 严格单命令解析

`command` 保持字符串形态，但不得直接传给 shell。Bash Tool 必须使用严格解析器把它转换为一个 executable 和 arguments。

以下语法一律拒绝：

- 管道、重定向和复合命令；
- 变量赋值或展开、命令替换、glob 和 response file；
- 引用不闭合、控制字符或无法唯一解析的输入；
- 绝对路径、`..`、设备文件和符号链接逃逸。

解析失败返回 `COMMAND_NOT_ALLOWED`，且不得调用 gateway。

### D3: 默认命令和配置

第一版默认命令集合：

| executable | 第一版参数策略 |
|---|---|
| `ls` | workspace 相对目录；只允许 `-l`、`-a`、`-la` |
| `cat` | workspace 内普通文本文件 |
| `grep` | 只允许 `-n`、`-i`、`-F`；长度受限模式；明确文件路径；禁止递归 |
| `head` | 只允许 `-n`，行数 `1..1000`；明确文件路径 |
| `tail` | 只允许 `-n`，行数 `1..1000`；明确文件路径 |
| `wc` | 只允许 `-l`、`-w`、`-c`；明确文件路径 |
| `python` | 只运行 allowlist 中的 workspace `.py` 文件 |
| `python3` | 只运行 allowlist 中的 workspace `.py` 文件 |

`ToolCatalogConfig.tools.bash.config` 支持：

```typescript
interface BashToolConfig {
  readonly allowedCommands?: readonly string[];
  readonly allowedPythonScripts?: readonly string[];
}
```

- `allowedCommands` 只能是默认集合的子集，不能扩大权限。
- `allowedPythonScripts` 默认空数组，使用精确 workspace 相对路径，不支持 glob。
- Python 禁止 `-c`、`-m`、stdin script、解释器选项和包安装；allowlist 脚本必须经管理员审核为只读、无网络访问的诊断代码。
- Python 参数默认拒绝，仅允许明确的数据参数形态。
- 配置和调用时均校验脚本位于 workspace 内、不是符号链接逃逸。

### D4: Gateway ownership

Bash Tool 声明 `requiredDependencies: ["sandbox"]`，只调用 Tool-facing `SandboxExecutionPort.runShell()`。

Tool-facing sandbox dependency 只接收结构化执行意图：`command`、`args`、`timeoutMs`、`stdoutLimitBytes` 和 `stderrLimitBytes`。`runShell()` / `runPython()` 方法名表达 sandbox execution kind，app composition 不得通过命令字符串猜测 execution kind。`tenantId`、`subjectId`、`requestRunId` 等 owner/run scope 不得作为 Tool input 或模型可控 `JsonObject` 字段传递，必须由可信 `ToolExecutionContext` 在 app composition adapter 中映射到 `SandboxGatewayPort` request。

`SandboxGatewayPort.execute(request, signal?)` 是 public gateway contract。可取消执行必须通过该 public signature 接收 `AbortSignal`，不得只在 local adapter 私有扩展中支持 cancellation。`SandboxExecutionResult` 必须返回 `stdoutTruncated` 和 `stderrTruncated`，使输出边界成为跨 adapter 稳定事实，而不是 local adapter 私有字段。

受限本地 adapter 由 app composition 默认装配，并通过 `SandboxGatewayPort` 执行。它负责：

- Windows Git for Windows 工具链或 Unix executable 的检测和选择；
- 固定可信 workspace working directory；
- 清理环境变量，不接受模型提供的环境变量或凭据；
- 禁止网络 CLI；
- 超时、AbortSignal、stdout/stderr byte limit；
- 路径和符号链接边界的最终防御性校验。

受限本地 adapter 必须使用 `shell: false` 以结构化 executable/args 启动进程，不得把原始 command 交给 `bash -c` 或其它宿主 shell。Tool、模型、日志和 SafeError 不得看到宿主 executable 绝对路径。

受限本地 adapter 不宣称提供进程、文件系统或网络隔离。allowlist Python 脚本属于可信管理员审核代码，本地 adapter 不能可靠阻止脚本内部写文件或创建网络连接。后续真实 sandbox adapter 必须替换 adapter，而不是创建第二套 Tool 执行路径，并负责强制文件系统与网络隔离。

### D5: 结果和错误语义

- exit code 0：Tool 返回业务对象，由 executor 包装为 `SUCCEEDED`。
- exit code 非 0：返回 `FAILED`，code=`BASH_EXECUTION_FAILED`，category=`INTERNAL`，retryable=false。
- timeout：返回 `TIMED_OUT`，code=`BASH_EXECUTION_TIMEOUT`，category=`TIMEOUT`。
- abort：返回现有 canceled 语义。
- 策略拒绝：返回 `COMMAND_NOT_ALLOWED`，category=`AUTHORIZATION`。
- adapter 不可用：descriptor 为 `UNAVAILABLE`。

失败结果可以通过受限 capability result 暴露截断后的 stdout/stderr，但不得放入 SafeError details、logs、audit 或 result metadata。

### D6: 可追溯性和可观测性

完整命令由现有 assistant tool-use message 持久化，并通过 `toolCallId` 与 capability lifecycle/result 关联。不新增命令证据存储，也不在 audit 中复制完整命令。

日志和 audit 只允许记录：

- `toolCallId` / capability invocation id；
- executable 的低基数类别；
- status、duration bucket、exit code category；
- stdout/stderr 长度和 truncation 标志。

不得记录 command、stdout、stderr、脚本内容或宿主路径。

## 验证映射（Verification Map）

| 验证点 | 验证入口 |
|---|---|
| input/output/config schema | unit tests |
| 严格解析及 forbidden syntax negative cases | security unit tests |
| 每个命令参数策略 | table-driven unit tests |
| workspace、symlink、非 Python CLI 只读和网络 CLI 拒绝边界 | contract/integration tests |
| gateway ownership 和无直接 child process | architecture tests |
| timeout、abort、truncation、non-zero exit | unit/contract tests |
| 默认 catalog registration 和 model visibility | capability tests |
| OpenSpec 一致性 | `openspec validate --all --strict` |
