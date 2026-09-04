# sandbox-runtime Specification

## Purpose
Owns the NextAgent-side sandbox execution integration for executable capability invocation: routing, `SandboxExecutionRequest` construction, unified `SandboxGatewayPort` submission, result mapping, and safe observability. Real sandbox platform implementation remains outside this boundary.
## Requirements
### Requirement: Executable Sandbox Runtime Owns Sandbox Execution Integration

Within the active change set, this change SHALL own the NextAgent-side sandbox execution integration for executable capability invocation. The integration MUST cover executable capability routing, `SandboxExecutionRequest` construction, unified `SandboxGatewayPort` submission, `SandboxExecutionResult` to `CapabilityInvocationResult` mapping, and safe sandbox execution observability. Local and remote sandbox implementations MUST stay behind the gateway adapter packages and expose the same port contract.

This requirement MUST NOT be interpreted as owning the real sandbox platform implementation. Container isolation, process isolation, resource enforcement, local adapter internals, and remote execution service implementation remain outside the capability/runtime-facing protocol unless defined by the corresponding gateway adapter package or a separate platform change.

#### Scenario: Executable sandbox execution uses this change as the integration owner

- **WHEN** an executable capability requires sandboxed execution
- **THEN** the NextAgent-side execution integration MUST be governed by this change
- **AND** gateway configuration, cross-platform executable semantics, and deny-by-default adapter changes MUST NOT define competing sandbox execution routing or result mapping behavior

### Requirement: Executable Capability Invocation Must Cross The Sandbox Gateway Boundary

Executable capabilities with host-side side effects MUST execute only through the sandbox gateway boundary. Shell, python, script, hook, bash, and model-generated code execution MUST NOT run directly in the host process.

#### Scenario: Executable capability uses sandbox gateway

- **WHEN** the capability invocation boundary invokes a capability that requires sandboxed execution
- **THEN** the invocation MUST be routed through the sandbox gateway boundary
- **AND** the system MUST NOT execute that capability directly in the host process

#### Scenario: Direct host execution bypass is denied

- **WHEN** a capability, hook, policy, or generated-code path attempts to execute shell, python, script, bash, or equivalent code outside the sandbox gateway
- **THEN** the system MUST reject that attempt with a safe failure outcome

### Requirement: Sandbox Execution Uses A Unified Request And Result Boundary

Sandboxed execution in this change MUST use one governed request/result boundary. The system MUST construct a sandbox request from trusted execution facts and MUST map the sandbox result back into `CapabilityInvocationResult`.

#### Scenario: Sandboxed invocation is mapped back into capability result

- **WHEN** sandbox execution completes for a capability invocation
- **THEN** the system MUST map the sandbox result into `CapabilityInvocationResult`
- **AND** it MUST NOT expose a competing runtime-facing result vocabulary for sandbox execution

### Requirement: Pre-Execution Validation Happens Before Sandbox Submission

Before sending executable work to the sandbox, the system MUST validate at least capability visibility, invocation arguments, risk policy outcome, the presence of a composed sandbox dependency, and working directory constraints. Executable allow/deny policy SHALL be owned by the composed sandbox gateway policy, not by the Bash capability.

When `sandbox.enabled=true`, the restricted local sandbox gateway SHALL use a trusted executable denylist as the sole command-level pre-rejection source for `bash` requests. If the requested executable is in the configured denylist, the gateway MUST reject the request safely. If the executable is not in the denylist, the gateway MUST continue to prepare and execute it. Whether the request needs shell built-ins, shell chaining, or direct executable resolution MUST be handled inside the gateway adapter rather than rejected at the capability boundary.

When `sandbox.enabled=false`, the restricted local sandbox gateway MUST skip denylist command-level validation for `bash` requests and continue directly to trusted execution path selection inside the sandbox boundary.

The gateway MUST NOT validate path arguments, confine paths to filesystem roots, check environment variables, or validate file types; those concerns are delegated to platform isolation.

#### Scenario: Gateway rejects denied executable

- **WHEN** a Bash capability invocation names an executable that is in the configured denylist
- **THEN** the sandbox gateway MUST reject the request safely
- **AND** Bash capability MUST NOT bypass the gateway or execute the command directly

#### Scenario: Gateway allows non-denied executable

- **WHEN** a Bash capability invocation names an executable that is not in the denylist
- **THEN** the sandbox gateway MUST proceed to resolve and execute the binary
- **AND** the gateway MUST still enforce adapter-owned cwd, sanitized environment, timeout, cancellation, and output limits

#### Scenario: Disabled validation skips denylist command rejection

- **WHEN** trusted local startup configuration sets `sandbox.enabled=false`
- **AND** a Bash capability invocation names a command that would otherwise match the configured denylist
- **THEN** the sandbox gateway MUST skip denylist command rejection
- **AND** it MUST continue to trusted execution path selection inside the sandbox boundary

### Requirement: Discovery And Content Loading Must Not Execute Local Commands

Discovery, descriptor registration, and Skill content loading MUST only register safe executable resource references and validated capability facts. These stages MUST NOT execute local commands and MUST NOT expose raw host paths in capability descriptors.

#### Scenario: Skill discovery registers refs without local execution

- **WHEN** the system discovers an executable capability or Skill-backed executable resource
- **THEN** discovery MUST register only safe executable resource refs or validated capability facts
- **AND** it MUST NOT execute local commands during discovery or content loading
- **AND** the resulting descriptor MUST NOT expose raw host paths

### Requirement: Sandbox Failure And Resource Limits Are Explicit

Sandbox 不可用、governance rejection、policy denial、timeout、cancellation、command failure、output too large 和 resource exceeded MUST 产生显式安全失败。系统 MUST 区分 sandbox governance rejection 与真正的 sandbox execution unavailable，MUST NOT 在 sandbox 失败时回退为 unsandboxed local execution。

本地后台 sandbox 进程写入 workspace 的 stdout 文件和 stderr 文件 MUST 分别使用固定 `10,485,760 bytes` 上限。文件累计写入恰好等于上限时 MUST 允许进程继续；任一通道收到第一个超过上限的字节时，系统 MUST 只把该 chunk 位于剩余容量内的顺序前缀写入文件，MUST NOT 把任何超限字节写入任一 workspace 输出文件，MUST 停止后续 stdout/stderr 落盘并终止根进程。该上限 MUST 由 local sandbox gateway 持有，MUST NOT 从请求、Capability 参数、模型输出或客户端 metadata 配置。

输出超限后的 background completion MUST 以 `exitCode=-1`、`status=FAILED` 结束。父进程向任一输出文件写入失败时，系统 MUST 同样停止两个通道的后续落盘、终止根进程并以 `exitCode=-1`、`status=FAILED` 结束，MUST NOT 让写入异常逃逸并终止宿主进程。运行期间和 completion 后，每个 stdout/stderr 文件的实际长度 MUST 均不超过 `10,485,760 bytes`。非超限且未发生写入失败的后台进程 MUST 保留实际 exit code，并按既有规则映射 `COMPLETED` 或 `FAILED`。前台 sandbox 输出语义不受本 Requirement 修改。

**需求类别**：系统质量属性
**质量属性**：性能/容量、安全、可靠性/恢复
**适用范围**：该 Function

#### Scenario: Stdout 第一个超限字节触发硬限制

- **GIVEN** 后台进程的 stdout 文件已写入不超过 `10,485,760 bytes`
- **WHEN** 下一个 stdout chunk 会使累计字节数超过该上限
- **THEN** 系统 MUST 只写入达到上限所需的顺序前缀
- **AND** stdout 和 stderr 文件 MUST NOT 再继续增长
- **AND** 根进程 MUST 被终止，completion MUST 为 `FAILED` 且 `exitCode=-1`

#### Scenario: Stderr 第一个超限字节触发相同硬限制

- **GIVEN** 后台进程的 stderr 文件已写入不超过 `10,485,760 bytes`
- **WHEN** 下一个 stderr chunk 会使累计字节数超过该上限
- **THEN** 系统 MUST 执行与 stdout 相同的停止落盘、终止和失败语义
- **AND** stdout 和 stderr 文件 MUST 均不超过 `10,485,760 bytes`

#### Scenario: 恰好达到上限不触发失败

- **WHEN** 后台进程的一个输出文件累计写入恰好 `10,485,760 bytes` 后以 exit code 0 结束
- **THEN** 系统 MUST 保留该文件的全部字节
- **AND** MUST NOT 仅因达到边界把 completion 标记为 `FAILED`

#### Scenario: 后台输出文件写入失败安全收敛

- **WHEN** 父进程向 stdout 或 stderr 文件写入 chunk 时发生异常
- **THEN** 系统 MUST 停止两个通道的后续落盘并终止根进程
- **AND** completion MUST 为 `FAILED` 且 `exitCode=-1`
- **AND** 写入异常 MUST NOT 从异步输出回调逃逸并终止宿主进程

#### Scenario: Sandbox governance rejection 保持可区分

- **WHEN** sandbox 因调用参数或治理策略拒绝执行
- **THEN** capability result MUST 使用 validation 或 governance safe failure
- **AND** MUST NOT 把该结果映射为真正的 sandbox unavailable

#### Scenario: Genuine sandbox startup failure 保持 unavailable

- **WHEN** sandbox 在没有 governance rejection reason 时无法启动
- **THEN** capability result MUST 继续使用 unavailable safe failure

### Requirement: Sandbox Results Must Not Leak Host-Sensitive Details

Capability results derived from sandbox execution MUST NOT expose host paths, raw commands, raw stdout/stderr, secrets, credentials, or full internal execution traces in the runtime-facing capability result boundary.

#### Scenario: Sandboxed capability result is redacted

- **WHEN** the system returns a capability result for sandboxed execution
- **THEN** the result MUST preserve only safe summary fields, safe refs, safe metadata, and governed failure information
- **AND** it MUST NOT leak host paths, raw commands, raw stdout/stderr, secrets, credentials, or full internal execution traces

### Requirement: Sandbox Availability And Execution Are Observable

系统 MUST 为 sandbox execution start、completion、failure、timeout 和 resource-limit 结果产生安全 observability signal。后台输出超限 signal 的 event MUST 为 `sandbox.background.output_limit_exceeded`，其 event payload 只允许包含有界 `executableKind`、`outputChannel="stdout"|"stderr"`、`limitBytes=10485760` 和 `failureStage="SANDBOX_BACKGROUND_OUTPUT"`。后台输出文件写入失败 signal 的 event MUST 为 `sandbox.background.output_write_failed`，其 event payload 只允许包含相同的 `executableKind`、`outputChannel`、`failureStage` 和 operational diagnostic 专用的 canonical `rawExceptionData`，不得包含 `limitBytes`。这两个 signal MUST NOT 包含 raw command、arguments、stdout、stderr、credential、task id 或其他高基数字段；host path 只允许由 `rawExceptionData` 按 canonical operational diagnostic 的有界与窄匹配脱敏规则承载，MUST NOT 进入其他字段或外部投影。

**需求类别**：系统质量属性
**质量属性**：可诊断性、安全、审计/可追溯性
**适用范围**：该 Function

#### Scenario: 后台输出超限产生安全诊断

- **WHEN** stdout 或 stderr 收到第一个超过固定上限的字节
- **THEN** 系统 MUST 产生恰好一次 `sandbox.background.output_limit_exceeded` signal
- **AND** `outputChannel` MUST 标识最先触发上限的通道
- **AND** `limitBytes` MUST 为 `10485760`
- **AND** signal MUST NOT 包含命令、参数、输出内容、宿主路径、credential 或 task id

#### Scenario: 一般 sandbox 失败继续可观察

- **WHEN** sandbox execution 失败、超时或被取消
- **THEN** 系统 MUST 继续产生符合既有 redaction 边界的安全 diagnostics 或 metrics

#### Scenario: 后台输出文件写入失败产生安全诊断

- **WHEN** 父进程向 stdout 或 stderr 文件写入 chunk 时发生异常
- **THEN** 系统 MUST 产生恰好一次 `sandbox.background.output_write_failed` signal
- **AND** signal MUST 只包含该 event 允许的有界分类字段和 canonical `rawExceptionData`

### Requirement: Restricted Local Sandbox Resolves Governed Business Executables From Trusted Configuration

restricted local sandbox SHALL 拥有 Bash 请求的本地 executable allow/deny policy。trusted app composition MAY 配置 `deniedExecutables` 和可选的 `allowedExecutables`；字段缺失时系统 MUST 只执行 denylist policy，字段存在时系统 MUST 只允许名称在 `allowedExecutables` 中且不在 `deniedExecutables` 中的 executable。显式空 `allowedExecutables` MUST 拒绝全部 executable；任一名称同时存在于两个名单时，denylist MUST 优先并拒绝该名称。名单 MUST 按请求的 executable 名称精确匹配，不解释通配符或正则表达式。白名单字段存在时，Bash 请求 MUST 只允许不需要 shell interpretation 的 direct execution；任何需要 trusted shell interpreter 的请求 MUST 以 `shell-composition-not-allowed` 原因安全拒绝，且 MUST NOT 启动 shell 或子命令。这些配置 MUST 保持为 trusted startup/app composition input，MUST NOT 从 model input、client metadata 或 runtime `Capability` arguments 读取。

当 `sandbox.enabled=false` 时，adapter MUST 跳过 allowlist、denylist 和白名单 direct-only 拒绝。未配置 `allowedExecutables` 且启用校验时，需要 shell builtins 或 shell composition 的请求 MUST 继续通过 trusted shell interpreter 执行重建后的命令。adapter MUST 继续通过 trusted executable locator 解析 `clipc`，通过 trusted paths 解析 Python interpreters，并通过 git-bin 或 PATH 解析其他 executable。不需要 shell interpretation 的请求 MUST 继续使用 `shell: false` direct execution path。无法解析所需 binary 或 trusted shell interpreter 时，adapter MUST fail closed。

仓库内置 `default-system.yaml` MUST 显式配置 `sandbox.enabled=true`、`allowedExecutables` 和 `deniedExecutables`。默认 allowlist MUST 按顺序精确等于 `clipc`、`curl`、`python`。默认 denylist MUST 按顺序精确等于以下穷尽集合：`bash`、`sh`、`zsh`、`fish`、`cmd`、`cmd.exe`、`powershell`、`powershell.exe`、`pwsh`、`eval`、`exec`、`env`、`xargs`、`node`、`npm`、`npx`、`deno`、`bun`、`pip`、`pip3`、`perl`、`ruby`、`php`、`lua`、`awk`、`find`、`sed`、`wget`、`ssh`、`scp`、`sftp`、`nc`、`netcat`、`socat`、`rm`、`mv`、`cp`、`install`、`tee`、`dd`、`truncate`、`chmod`、`chown`、`chgrp`、`ln`、`tar`、`unzip`、`zip`、`7z`、`kill`、`killall`、`pkill`、`taskkill`、`sudo`、`su`、`runas`、`mount`、`umount`、`systemctl`、`service`、`docker`、`podman`、`kubectl`、`helm`。默认 allowlist 与 denylist MUST 没有共同成员。denylist MUST 只表达高危 executable 的纵深防御，不得为职责去重或普通查询、校验、文本变换命令建立冗余拒绝项。已有专用 Tool 对 Bash executable 的职责去重 MUST 只由 allowlist 成员范围表达。上述默认值 MUST 经过与自定义配置相同的 schema validation 和 trusted composition 投影，不得形成特殊执行分支。默认配置加载后，restricted local sandbox MUST 执行 allowlist、denylist 和白名单 direct-only 校验。

**需求类别**：功能性需求

#### Scenario: 未配置白名单时保持黑名单行为

- **WHEN** trusted app composition 未配置 `allowedExecutables`
- **AND** `sandbox.enabled` 缺失或为 `true`
- **THEN** restricted local sandbox MUST 允许不在 `deniedExecutables` 中且能从 trusted location 解析的 executable 继续执行
- **AND** MUST 安全拒绝 `deniedExecutables` 中的 executable

#### Scenario: 仓库默认配置启用校验并使用最小 executable 白名单

- **WHEN** app 从仓库内置 `default-system.yaml` 加载默认系统配置
- **THEN** 配置 MUST 为 `READY`
- **AND** `sandbox.enabled` MUST 为 `true`
- **AND** `sandbox.allowedExecutables` MUST 按顺序精确等于 `["clipc", "curl", "python"]`
- **AND** `sandbox.deniedExecutables` MUST 按 Requirement 正文声明的顺序精确等于该穷尽集合
- **AND** allowlist 与 denylist MUST 没有共同成员
- **AND** restricted local sandbox MUST 按 enabled 语义执行 allowlist、denylist 和白名单 direct-only 校验

#### Scenario: 默认白名单拒绝其他 executable

- **WHEN** app 使用仓库内置 `default-system.yaml`
- **AND** Bash 请求的 executable 不是 `clipc`、`curl` 或 `python`
- **THEN** restricted local sandbox MUST 在启动进程前安全拒绝该请求
- **AND** capability boundary 的拒绝 MUST 映射为 `COMMAND_NOT_ALLOWED`

#### Scenario: 白名单允许已授权 executable

- **WHEN** trusted app composition 配置的 `allowedExecutables` 包含请求的 executable 名称
- **AND** `deniedExecutables` 不包含该名称
- **AND** `sandbox.enabled` 缺失或为 `true`
- **THEN** restricted local sandbox MUST 继续选择 `shell: false` direct execution path
- **AND** 执行 MUST 继续使用 adapter-owned cwd、sanitized environment、timeout、cancellation 和 output limits

#### Scenario: 白名单拒绝未授权 executable

- **WHEN** trusted app composition 配置了 `allowedExecutables`
- **AND** 请求的 executable 名称不在该名单中
- **AND** `sandbox.enabled` 缺失或为 `true`
- **THEN** restricted local sandbox MUST 安全拒绝该请求
- **AND** capability boundary 的拒绝 MUST 映射为 `COMMAND_NOT_ALLOWED`

#### Scenario: 显式空白名单拒绝全部 executable

- **WHEN** trusted app composition 配置 `allowedExecutables: []`
- **AND** `sandbox.enabled` 缺失或为 `true`
- **THEN** restricted local sandbox MUST 安全拒绝任意 executable 请求

#### Scenario: 黑名单在名单冲突时优先

- **WHEN** 同一 executable 名称同时存在于 `allowedExecutables` 和 `deniedExecutables`
- **AND** `sandbox.enabled` 缺失或为 `true`
- **THEN** restricted local sandbox MUST 安全拒绝该 executable

#### Scenario: 白名单模式拒绝 shell composition

- **WHEN** trusted app composition 配置的 `allowedExecutables` 包含请求的 executable 名称
- **AND** `sandbox.enabled` 缺失或为 `true`
- **AND** Bash 请求需要 shell interpretation
- **THEN** restricted local sandbox MUST 以 `shell-composition-not-allowed` 原因安全拒绝该请求
- **AND** MUST NOT 启动 trusted shell interpreter 或任一子命令

#### Scenario: 白名单模式不解释普通 argv 中的 shell-like 文本

- **WHEN** trusted app composition 配置的 `allowedExecutables` 包含请求的 executable 名称
- **AND** `sandbox.enabled` 缺失或为 `true`
- **AND** 请求不需要 shell interpretation，但普通 argv 包含 `>` 或其他 shell-like 文本
- **THEN** restricted local sandbox MUST 通过 `shell: false` direct execution 传递原始 argv
- **AND** MUST NOT 将该文本解释为重定向或 shell expansion

#### Scenario: 关闭校验时跳过两种名单

- **WHEN** trusted app composition 设置 `sandbox.enabled=false`
- **AND** 请求的 executable 不在已配置的 `allowedExecutables` 中或存在于 `deniedExecutables` 中
- **THEN** restricted local sandbox MUST NOT 基于 allowlist 或 denylist 拒绝该请求
- **AND** MUST 继续选择 trusted direct 或 shell execution path

#### Scenario: 无法解析的 executable 安全失败

- **WHEN** policy 允许一个 executable 请求
- **AND** required direct executable path 或 trusted shell interpreter 无法从 trusted locations 解析
- **THEN** restricted local sandbox MUST 返回显式 unavailable safe result
- **AND** MUST NOT 回退到 unsandboxed execution

#### Scenario: clipc locator 缺失时安全失败

- **WHEN** policy 允许 Bash 提交 `clipc`
- **AND** trusted locator 缺失、为空、位于声明目录之外、文件不存在或不是 regular file
- **THEN** restricted local sandbox MUST 返回显式 unavailable safe result
- **AND** MUST NOT 搜索任意 host location 或回退到 unsandboxed execution

#### Scenario: 带引号的 Windows 环境目录被规范化

- **WHEN** trusted app composition 提供被一对匹配双引号包围的 `clipc` executable directory
- **THEN** restricted local sandbox MUST 在路径解析前只移除最外层这一对双引号
- **AND** resolved binary MUST 继续通过相同的 realpath 和 regular-file validation

### Requirement: Python Sandbox Invocation Distinguishes Script And Skill Module Modes

For a Python sandbox request, the execution integration MUST classify only these invocation modes: an existing script-path mode whose first argument is a governed logical script path, and a module mode whose first two arguments are exactly `-m` and a non-empty dotted module name. The implementation MUST translate a logical path only in script-path mode. It MUST preserve `-m` and its module name unchanged in module mode and MUST execute both modes through the existing sandbox gateway with `shell: false`.

The execution integration MUST reject `-c`, stdin (`-`), a missing module name, a non-dotted module name, interpreter options other than the defined `-m` form, and an unsupported Python invocation shape with an explicit safe failure. It MUST NOT reinterpret an unsupported option as a script path or fall back to unsandboxed host execution.

#### Scenario: Module mode preserves interpreter arguments

- **WHEN** Bash submits `python -m scripts.nl2api.api_recall_main "查询问题"` through the Python sandbox route
- **THEN** the sandbox request MUST execute Python with `-m`, `scripts.nl2api.api_recall_main`, and `查询问题` in that order
- **AND** it MUST NOT translate `-m` into an execution-workspace path
- **AND** it MUST use the existing adapter-owned cwd, sanitized environment, timeout, cancellation, and output limits

#### Scenario: Unsupported Python option fails closed

- **WHEN** Bash submits a Python command whose first argument is `-c`, `-`, or an option sequence other than the defined `-m <dotted-module>` form
- **THEN** the sandbox boundary MUST return an explicit safe failure
- **AND** it MUST NOT translate the option into a script path
- **AND** it MUST NOT execute outside the sandbox gateway

### Requirement: Python Module Mode Uses One Trusted Skill Import Root

Python module mode MUST receive one import root only from the current run's authorized and committed Skill resource projection. The execution integration MUST set that root as the process-local Python import root for the one sandbox invocation and MUST NOT expose the physical root in tool results, observability, or safe errors.

If the current run has no authorized projected Skill root or has more than one authorized projected Skill root, module mode MUST fail safely before process start. Model command text, client metadata, capability arguments, user environment variables, workspace paths, and host absolute paths MUST NOT select, append, or override the import root. Script-path mode MUST NOT receive a module import root.

#### Scenario: A sole authorized Skill projection supplies module imports

- **WHEN** the current run has exactly one authorized committed Skill projection containing `scripts/nl2api/api_recall_main.py`
- **AND** Bash submits `python -m scripts.nl2api.api_recall_main "查询问题"`
- **THEN** the module MUST be imported from that projected Skill root
- **AND** the execution MUST remain within the sandbox gateway boundary

#### Scenario: Ambiguous or absent Skill projection is rejected

- **WHEN** Bash submits a Python module-mode command
- **AND** the current run has zero or more than one authorized projected Skill root
- **THEN** the execution integration MUST return an explicit safe failure before process start
- **AND** it MUST NOT infer a root from the module name or model-supplied path

### Requirement: Skill Python Execution Receives Per-Request Output Path Environment

The system SHALL provide per-request output path environment variables for
authorized Skill Python execution. When the restricted local sandbox starts a
Python process for an authorized Skill script or Skill module invocation, it MUST
derive process-local output path environment variables from the current
`SandboxExecutionRequest.filesystem` roots. `NEXTAGENT_WORKSPACE_DIR` MUST point
to the current request's workspace root and is intended for final durable result
files. `NEXTAGENT_TEMP_DIR` MUST point to the current request's run-scoped temp
root and is intended for intermediate files, scratch data, and transient outputs.

These environment variables MUST be set only on the spawned child process. They
MUST NOT be written to global process environment, cached across requests, or
derived from model input, client metadata, Skill metadata, or host defaults.
Sandbox cwd MUST remain the execution view root. The system MUST NOT scan files
after process exit to infer which outputs are final results.

#### Scenario: Skill script receives current workspace and temp paths

- **WHEN** Python executes an authorized `.nextagent/skills/<projection>/<skill>/scripts/export.py` script
- **THEN** the child process environment MUST include `NEXTAGENT_WORKSPACE_DIR` derived from the current workspace root
- **AND** it MUST include `NEXTAGENT_TEMP_DIR` derived from the current run temp root
- **AND** files written through `NEXTAGENT_TEMP_DIR` MUST be isolated from a different request's temp root

#### Scenario: Output intent is not inferred by scanning

- **WHEN** a Skill script writes files outside `NEXTAGENT_WORKSPACE_DIR` and `NEXTAGENT_TEMP_DIR`
- **THEN** the sandbox adapter MUST NOT move those files into `workspace/`
- **AND** it MUST NOT classify files as final results by name, extension, or creation time

### Requirement: Dynamic execution SHALL use deployment-mode-specific sandbox enforcement

`bash`、`python`、Skill script execution 和模型生成代码执行 MUST 经过 sandbox gateway 边界。sandbox MUST 接收由当前已接受运行的 `ExecutionWorkspaceView` 派生的物理文件系统布局，并按以下全部根类型解释访问边界：

- `workspace/`：按持久文件策略读写；
- `.nextagent/`：只读，仅显式授权的脚本资源或 sandbox-owned 临时执行副本允许执行；
- `temp/`：当前运行的可读写临时空间；
- `shared-data/`：仅 LOCAL 模式存在的只读公共输入和显式 Python 脚本路径；REMOTE/PaaS 模式 MUST 不暴露该根，并在运行策略请求该根时 fail closed。

REMOTE/PaaS 模式 MUST 通过容器或 Pod 的 root mapping、只读挂载、cwd 和 deny-by-default 文件系统策略执行访问控制。LOCAL 模式 MUST 保留相同的受信 root layout、cwd、清洗环境、超时、取消、输出限制和入口检查，但 MUST NOT 声明普通本地进程具备强恶意代码文件系统隔离。

LOCAL 模式 MUST NOT 通过修改调用前已存在文件或目录的 POSIX mode、Windows ACL、所有权或只读属性来建立只读边界。系统 MUST NOT 依赖 shell command string 解析作为 REMOTE/PaaS 安全边界；解析和 preflight 只作为入口 guardrail，生产文件系统安全 MUST 来自 sandbox 平台执行。

**需求类别**：功能性需求

#### Scenario: Python 读取 Skill 资源并写入 workspace

- **WHEN** sandboxed Python 命令读取 `.nextagent/skills/<skillProjectionKey>/foo/references/guide.md`
- **AND** 写入 `workspace/analysis.txt`
- **THEN** 两个操作 MUST 使用同一个受信物理 root layout
- **AND** 命令 MUST NOT 获得其他宿主目录的授权

#### Scenario: 本地执行不修改只读根权限

- **WHEN** LOCAL 模式执行引用 Skill projection 或 `shared-data/` 的命令
- **THEN** 系统 MUST 保持这些原始物理根及其既有子项的宿主权限元数据不变
- **AND** 系统 MUST NOT 以 chmod、ACL deny、所有权或只读属性修改模拟只读访问

#### Scenario: PaaS 动态执行由容器隔离

- **WHEN** REMOTE/PaaS 模式执行 Python 或 Bash
- **THEN** 进程 MUST 通过容器或 Pod 文件系统隔离看到 `workspace/`、`.nextagent/` 和 `temp/`
- **AND** `.nextagent/` MUST 由文件系统 enforcement 保持只读
- **AND** 本地宿主 `shared-data/` MUST NOT 暴露

### Requirement: 沙箱执行必须保持宿主权限元数据

系统 MUST 在沙箱命令成功、非零退出、超时、取消、准备失败和并发执行后保持调用前已存在资源的宿主权限元数据不变。原始资源权限不满足请求操作的最小权限时，系统 MUST 返回安全且可诊断的权限失败，除非请求是符合本 Requirement 的 sandbox-owned 临时副本执行。

Python 解释器读取脚本时，系统 MUST 只要求当前执行身份能够读取脚本并遍历父目录，脚本缺少 execute 位 MUST NOT 单独导致失败。必须直接执行的脚本在原文件可读但不可执行时，系统 MUST 在当前运行授权的 sandbox temp 根创建副本，并 MUST 只为该副本设置执行所需权限；原文件及其父目录权限 MUST 保持不变。临时副本无法安全创建、读取或执行时，系统 MUST 返回安全权限失败，MUST NOT 修改原始资源后重试。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复

**适用范围**：该 Function

#### Scenario: 原始权限满足最小条件

- **WHEN** sandbox 请求使用的全部原始资源满足对应读取、写入、执行或目录遍历最小权限
- **THEN** 系统 MUST 直接执行授权操作
- **AND** 执行前后的宿主权限元数据 MUST 完全一致

#### Scenario: workspace 写入权限不足

- **WHEN** sandbox 请求写入 workspace 文件
- **AND** 当前执行身份缺少目标写权限或父目录写入与遍历权限
- **THEN** 系统 MUST 返回不包含宿主绝对路径的安全权限失败
- **AND** 系统 MUST NOT 提高或降低目标及父目录权限

#### Scenario: Python 脚本可读但不可执行

- **WHEN** Python 脚本可读且父目录可遍历
- **AND** 脚本文件不具有 execute 位
- **THEN** 系统 MUST 通过 Python 解释器读取并执行该脚本
- **AND** 系统 MUST NOT 修改脚本权限

#### Scenario: 直接脚本使用临时副本

- **WHEN** 请求必须直接执行一个已授权、可读但不可执行的脚本
- **AND** 当前运行具有可用的 sandbox temp 根
- **THEN** 系统 MUST 执行 sandbox-owned 临时副本
- **AND** 系统 MUST 只为该临时副本设置执行所需权限
- **AND** 原始脚本及其父目录权限 MUST 保持不变

#### Scenario: 命令失败或并发执行后权限不变

- **WHEN** sandbox 命令非零退出、超时、取消、准备失败，或多个命令并发使用同一个授权根
- **THEN** 每个命令完成后原始文件和目录的宿主权限元数据 MUST 与首个命令开始前一致

### Requirement: Sandbox Path Rejection Uses Authorization Safe Error

当 sandbox gateway safe error 的 `safeDetails.reason` 为 `unsafe-path` 或 `unauthorized-path` 时，sandbox capability boundary MUST 将结果归一化为 `CAPABILITY_PATH_REJECTED`、`AUTHORIZATION`、`retryable: false`，并 MUST NOT 将该结果归一化为 `SANDBOX_UNAVAILABLE`。

当 sandbox gateway safe error 的 category 为 `UNAVAILABLE` 且 `safeDetails.reason` 不是 `unsafe-path` 或 `unauthorized-path` 时，sandbox capability boundary MUST 保持既有 `SANDBOX_UNAVAILABLE`、`UNAVAILABLE` 归一化行为。

#### Scenario: Unauthorized path is reported as authorization rejection

- **WHEN** sandbox gateway 返回 category 为 `UNAVAILABLE` 且 `safeDetails.reason` 为 `unauthorized-path` 的 safe error
- **THEN** sandbox capability boundary MUST 返回 code 为 `CAPABILITY_PATH_REJECTED`、category 为 `AUTHORIZATION`、`retryable: false` 的 safe error
- **AND** 返回结果 MUST NOT 使用 `SANDBOX_UNAVAILABLE`

#### Scenario: Existing unsafe path reason remains an authorization rejection

- **WHEN** sandbox gateway 返回 `safeDetails.reason` 为 `unsafe-path` 的 safe error
- **THEN** sandbox capability boundary MUST 返回 code 为 `CAPABILITY_PATH_REJECTED`、category 为 `AUTHORIZATION`、`retryable: false` 的 safe error

#### Scenario: Genuine sandbox unavailability remains unavailable

- **WHEN** sandbox gateway 返回 category 为 `UNAVAILABLE` 且 `safeDetails.reason` 不是 `unsafe-path` 或 `unauthorized-path` 的 safe error
- **THEN** sandbox capability boundary MUST 返回 code 为 `SANDBOX_UNAVAILABLE`、category 为 `UNAVAILABLE` 的 safe error

### Requirement: Sandbox Streaming Stdout Execution

`SandboxExecutionPort` MUST 新增可选方法 `runShellStreaming`。该方法接收 `SandboxExecutionInput`、`ToolExecutionContext`、`onStdoutChunk: (chunk: string) => void | Promise<void>` 回调和可选 `AbortSignal`，返回 `Promise<JsonObject>`（结果形状与 `runShell` 一致）。当 sandbox gateway adapter 支持 `executeWithStdoutChunks` 时，`runShellStreaming` MUST 被挂载；当不支持时，`runShellStreaming` MUST 为 `undefined`。

需求类别：功能性需求

`SandboxGatewayExecutionAdapter` MUST 新增可选方法 `executeWithStdoutChunks`。该方法接收 `SandboxExecutionRequest`、`options: { readonly onStdoutChunk?: (chunk: string) => void | Promise<void> }` 和可选 `AbortSignal`，返回 `Promise<SandboxExecutionResult>`。在执行过程中，gateway MUST 通过 `onStdoutChunk` 回调逐块推送 stdout 数据；最终 MUST 返回与 `execute` 相同形状的 `SandboxExecutionResult`。

`runSandbox` 函数 MUST 新增可选参数 `onStdoutChunk`。当 `onStdoutChunk` 不为 `undefined` 且 gateway adapter 的 `executeWithStdoutChunks` 不为 `undefined` 时，MUST 调用 `executeWithStdoutChunks(request, { onStdoutChunk }, signal)`；否则 MUST 走原有 `gateway.execute(request, signal)` 路径。

当 `runShellStreaming` 为 `undefined` 时，调用方（Bash 工具）MUST 回退到 `runShell` 或 `runShellBackgroundable`。`runShellStreaming` 的存在与否 MUST NOT 影响其他执行方法（`runShell`、`runPython`、`runShellBackgroundable`、`startBackgroundShell`）的行为。

#### Scenario: gateway 支持 executeWithStdoutChunks 时挂载 runShellStreaming

- **WHEN** sandbox gateway adapter 的 `executeWithStdoutChunks` 为 function
- **THEN** `createWorkspaceBackedSandboxExecutionPort` 返回的 port MUST 挂载 `runShellStreaming`
- **AND** `runShellStreaming` 调用时 MUST 通过 `executeWithStdoutChunks` 执行并逐块回调 stdout

#### Scenario: gateway 不支持 executeWithStdoutChunks 时不挂载 runShellStreaming

- **WHEN** sandbox gateway adapter 的 `executeWithStdoutChunks` 为 `undefined`
- **THEN** 返回的 port 的 `runShellStreaming` MUST 为 `undefined`
- **AND** `runShell`、`runPython`、`runShellBackgroundable`、`startBackgroundShell` MUST 正常可用

#### Scenario: runSandbox 使用 executeWithStdoutChunks

- **WHEN** `runSandbox` 被调用且 `onStdoutChunk` 不为 `undefined` 且 gateway adapter 的 `executeWithStdoutChunks` 不为 `undefined`
- **THEN** MUST 调用 `executeWithStdoutChunks(request, { onStdoutChunk }, signal)`
- **AND** MUST NOT 调用 `gateway.execute`

#### Scenario: runSandbox 无 onStdoutChunk 时走原有路径

- **WHEN** `runSandbox` 被调用且 `onStdoutChunk` 为 `undefined`
- **THEN** MUST 调用 `gateway.execute(request, signal)`
- **AND** MUST NOT 调用 `executeWithStdoutChunks`

#### Scenario: runShellStreaming 结果形状与 runShell 一致

- **WHEN** `runShellStreaming` 执行完成
- **THEN** 返回的 `JsonObject` MUST 包含 `stdout`、`stderr`、`exitCode`、`stdoutTruncated`、`stderrTruncated`、`timedOut` 字段
- **AND** 字段类型和语义 MUST 与 `runShell` 返回结果一致

### Requirement: Local 模式从受信配置限制 API 目标

restricted local sandbox MUST 从 trusted startup/app composition 接收可选 `allowedApis`。`allowedApis` 的每个成员 MUST 是以 `/` 结尾且不含 username、password、query 或 fragment 的绝对 `http:` 或 `https:` URL prefix；配置包含任一非法成员时系统配置 MUST 为 `BLOCKED`。模型输入、客户端 metadata、Skill metadata 和 runtime `Capability` 参数 MUST NOT 新增、删除或覆盖 `allowedApis`。

local sandbox MUST 使用标准 URL 解析结果匹配 API 目标：scheme、lowercase hostname 和 effective port MUST 精确相等，目标的 normalized pathname MUST 以 prefix 的 pathname 开头。系统 MUST NOT 使用原始 URL 字符串前缀匹配。`allowedApis` 缺失或为空时，curl 请求和包含显式 HTTP(S) URL 的 Python 请求 MUST 在启动进程前拒绝；显式目标 URL 全部命中至少一个成员时，请求 MUST 继续接受其余 sandbox policy 校验。该策略仅适用于 restricted local sandbox，remote sandbox 行为 MUST NOT 因此改变。

当拒绝原因包含能够明确解析的未授权 HTTP(S) URL 时，safe result `message` MUST 返回第一个未授权 URL 的规范化安全投影；该投影 MUST 清除 username、password、query 和 fragment。参数歧义、禁止 option、非法 socket 或不存在可明确解析的未授权 URL 时，`message` MUST 保持通用拒绝信息。operational log、reason 和 diagnostics MUST NOT 记录该 URL。

**需求类别**：功能性需求

#### Scenario: 合法受控 API 目标继续执行

- **WHEN** restricted local sandbox 收到可识别的 `curl` 或 Python HTTP(S) 请求
- **AND** 请求中的全部目标 URL 均命中至少一个 trusted `allowedApis` 成员
- **THEN** sandbox MUST 继续执行其余 executable、调用形态、filesystem、timeout、cancellation 和 output policy 校验
- **AND** MUST NOT 因目标 API policy 拒绝该请求

#### Scenario: 空名单默认拒绝网络访问

- **WHEN** `allowedApis` 缺失或为空
- **AND** restricted local sandbox 收到 curl 请求或包含显式 HTTP(S) URL 的 Python 请求
- **THEN** sandbox MUST 在启动进程前安全拒绝该请求
- **AND** safe result MUST 使用 `network-target-not-allowed` reason

#### Scenario: URL origin 相似但不相同

- **WHEN** `allowedApis` 包含 `https://api.example.internal/v1/`
- **AND** 请求目标为 `https://api.example.internal.evil.test/v1/items`、不同 effective port 或不同 scheme 中的任一个
- **THEN** sandbox MUST 判定目标未命中该成员
- **AND** MUST 在启动进程前安全拒绝该请求

#### Scenario: URL path 越过受控 prefix

- **WHEN** `allowedApis` 包含 `https://api.example.internal/v1/`
- **AND** 请求目标的 normalized pathname 不以 `/v1/` 开头
- **THEN** sandbox MUST 在启动进程前安全拒绝该请求

#### Scenario: 拒绝消息返回不支持的 URL

- **WHEN** curl 或 Python 请求包含能够明确解析且未命中 `allowedApis` 的 HTTP(S) URL
- **THEN** safe result `message` MUST 包含第一个未授权 URL 的规范化安全投影
- **AND** 该 URL MUST 不包含 credentials、query 或 fragment
- **AND** operational log、reason 和 diagnostics MUST NOT 包含该 URL

#### Scenario: 不可信输入不能覆盖名单

- **WHEN** model input、client metadata、Skill metadata 或 runtime `Capability` 参数提供额外 API prefix
- **THEN** sandbox MUST NOT 把该值加入 trusted `allowedApis`
- **AND** 未命中 trusted list 的请求 MUST 保持拒绝

### Requirement: Local curl 只执行目标确定的受控请求

restricted local sandbox MUST 在启动 `curl` 前从 argv 中提取可解析为绝对 HTTP(S) URL 的参数作为目标，并按 `allowedApis` 校验。argv 中可解析为 HTTP(S) URL 的参数 MUST 恰好为一个，否则 sandbox MUST 作为多目标或无目标请求拒绝。非 URL 参数（如 shell 重定向 `2>&1`）MUST NOT 影响 URL 提取。目标中包含 curl URL glob 字符 `{`、`}`、`[` 或 `]` 时，sandbox MUST 在进程启动前拒绝。sandbox MUST 拒绝 `--url`、`--config`、`-K`、`--proxy`、`-x`、`--preproxy`、`--resolve`、`--connect-to`、`--request-target`、`--path-as-is`、`--location`、`-L` 和 `--location-trusted`，包括对应 `--name=value` 形式；其他 option 保持由 curl 解释，不由 local sandbox 复制完整 option grammar。

`--unix-socket` MUST 至多出现一次；其值 MUST 逐字精确等于 `/opt/sidecar/ir/http.sock`。使用该 option 时，目标 URL MUST 继续命中 `allowedApis`；socket 路径与 API 目标两个条件 MUST 同时成立。`--abstract-unix-socket` 和其他 Unix Socket 路径 MUST 拒绝。

**需求类别**：功能性需求

#### Scenario: 受控网络 URL 通过校验

- **WHEN** curl argv 中恰好一个参数可解析为绝对 HTTP(S) URL 且其他 argv 项不包含绝对 HTTP(S) URL 或被禁止参数
- **AND** URL 命中 trusted `allowedApis`
- **THEN** sandbox MUST 继续执行其余 sandbox policy 校验

#### Scenario: 固定 Unix Socket 与受控 API 同时匹配

- **WHEN** curl argv 包含一次 `--unix-socket /opt/sidecar/ir/http.sock` 或 `--unix-socket=/opt/sidecar/ir/http.sock`
- **AND** 恰好一个目标 URL 命中 trusted `allowedApis`
- **THEN** sandbox MUST 继续执行其余 sandbox policy 校验

#### Scenario: Unix Socket 路径不匹配

- **WHEN** curl argv 的 Unix Socket option 值不是 `/opt/sidecar/ir/http.sock`
- **THEN** sandbox MUST 在启动进程前安全拒绝该请求

#### Scenario: curl 参数不能确定唯一目标

- **WHEN** curl argv 包含被禁止参数、多个可解析 URL、无可解析 URL 或 URL glob 字符中的任一情况
- **THEN** sandbox MUST 在启动进程前安全拒绝该请求
- **AND** MUST NOT 尝试推测实际网络目标

### Requirement: Local Python 对可识别网络目标执行过渡检查

restricted local sandbox MUST 把 Python source、script content 和 argv 中出现的绝对 HTTP(S) URL literal 视为显式 API 目标，并在启动 Python 前要求每个目标命中 `allowedApis`。未出现 HTTP(S) URL literal 的 Python 请求 MUST 继续按既有执行策略处理，包括 `-m` module invocation。local sandbox MUST NOT 把该检查表示为能够检测运行时字符串拼接、编码、底层 socket 或被调用 module 内部产生的目标。

该检查 MUST 被描述为 local 模式的临时 best-effort 防护，MUST NOT 被表示为恶意 Python 代码隔离、完整网络出口控制或标准沙箱。拒绝结果 MUST 使用安全 reason；除上述 safe result `message` 中去除 credentials、query 和 fragment 后的首个未授权 URL 外，MUST NOT 回显 Python source、其他内部目标 URL 或非固定宿主路径。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: Python 字面量目标全部受控

- **WHEN** Python 请求包含至少一个绝对 HTTP(S) URL literal
- **AND** 全部 URL literal 均命中 trusted `allowedApis`
- **THEN** sandbox MUST 继续执行其余 Python sandbox policy 校验

#### Scenario: Python 显式目标未受控

- **WHEN** Python 请求包含至少一个未命中 trusted `allowedApis` 的绝对 HTTP(S) URL literal
- **THEN** sandbox MUST 在启动 Python 前安全拒绝该请求

#### Scenario: Python 动态目标不在过渡检查范围

- **WHEN** Python 请求不包含绝对 HTTP(S) URL literal
- **THEN** sandbox MUST 继续按既有 Python sandbox policy 处理
- **AND** MUST NOT 声明该请求已经通过完整网络出口验证

#### Scenario: 非网络 Python 计算保持可用

- **WHEN** Python 请求不包含 HTTP(S) URL literal
- **THEN** sandbox MUST 继续按既有 Python invocation、filesystem、timeout、cancellation 和 output policy 处理
