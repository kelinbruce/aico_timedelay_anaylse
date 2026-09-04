# bash-tool Specification

## Purpose
Defines the governed builtin `bash` tool capability for the first TS release, including strict single-command parsing, workspace-scoped read-only command policy, trusted sandbox gateway ownership, and bounded safe results.
## Requirements
### Requirement: Bash Tool Uses The Existing Tool Framework
Bash SHALL be implemented as a builtin `TOOL` capability on the existing capability catalog and invocation path. Agent Core and Runtime MUST continue to treat it as a capability invocation rather than a special-case shell execution path.

#### Scenario: Bash is registered through the builtin Tool path
- **WHEN** the capability subsystem creates the builtin Tool catalog
- **THEN** the catalog MUST include the `bash` descriptor
- **AND** Bash invocation MUST use `CapabilityInvocationPort`
- **AND** neither Agent Core nor Runtime may call the Bash Tool or gateway adapter directly

### Requirement: Bash Tool Input Is Compatible With TonyClaw

The public `bash` tool input SHALL use stable canonical fields `command`, optional `description`, and optional `timeout`. The compatibility alias `timeout_ms` MAY also be accepted for model-produced tool input, but it SHALL NOT replace `timeout` as the canonical field name.

`timeout` SHALL remain authoritative when both fields are present. `timeout_ms` compatibility SHALL accept only the same positive integer shape as canonical `timeout`. After normalization, the effective timeout semantics remain unchanged: default `120000` ms, capped at `600000` ms, and further bounded by the trusted invocation timeout.

The first TS release SHALL NOT accept background execution controls.

#### Scenario: Compatibility alias timeout_ms is accepted

- **WHEN** a model supplies `timeout_ms` instead of `timeout`
- **THEN** Bash input normalization MUST accept it as a timeout alias
- **AND** the effective timeout MUST follow the existing Bash timeout bounds

#### Scenario: Canonical timeout wins over compatibility alias

- **WHEN** both `timeout` and `timeout_ms` are supplied
- **THEN** Bash MUST use `timeout`
- **AND** the alias MUST NOT override the canonical field

### Requirement: Bash Default Commands Are Local And Read Only

When `sandbox.enabled=true`, the restricted local sandbox policy SHALL use an executable denylist. The default denylist MAY be empty, meaning all resolvable executables and shell-interpretable non-denied commands are allowed. The denylist MUST be treated as a sandbox gateway policy configuration, not Bash capability-owned command authority.

When `sandbox.enabled=false`, Bash MUST continue to submit commands to the sandbox gateway, but the gateway skips denylist command-level rejection. Bash capability MUST NOT compensate by maintaining a second deny/allow policy.

#### Scenario: Configuration denies dangerous executables at gateway boundary

- **WHEN** trusted app composition configures the sandbox gateway denylist with a dangerous executable
- **AND** trusted local startup configuration omits `sandbox.enabled` or sets it to `true`
- **THEN** Bash MUST NOT reject that executable before sandbox submission
- **AND** the sandbox gateway MUST reject it based on the denylist

#### Scenario: Disabled validation does not reintroduce capability-owned deny

- **WHEN** trusted local startup configuration sets `sandbox.enabled=false`
- **AND** the model invokes Bash with a command that matches the configured denylist
- **THEN** Bash MUST still submit the command to the sandbox gateway
- **AND** Bash MUST NOT add a capability-level deny rejection to compensate for disabled validation

### Requirement: Bash Is Workspace Scoped And Network CLI Is Denied

Executable deny decisions SHALL be enforced by sandbox gateway denylist policy or stronger platform sandbox enforcement. Bash MAY provide model guidance, but MUST NOT be the final security boundary for executable policy. Root-aware path confinement, filesystem root checks, environment validation, and file-type checks MUST be derived from the sandbox filesystem layout and platform sandbox boundary, not from a Bash-owned private root allowlist.

Bash MAY submit explicit root-qualified shared data paths such as `python shared-data/scripts/diagnose.py --case shared-data/cases/alarm.json` to the sandbox gateway only in LOCAL deployment mode when the sandbox request includes an authorized `shared-data/` root. Bash MUST NOT add `shared-data/` to `PATH`, `PYTHONPATH`, implicit executable lookup or command discovery, and MUST NOT treat files under `shared-data/` as directly executable without an explicit interpreter.

#### Scenario: Denied executable is rejected by sandbox policy

- **WHEN** Bash submits an executable in the configured denylist
- **THEN** the sandbox gateway MUST reject the request safely
- **AND** the capability-facing result MUST preserve a safe sandbox rejection reason

#### Scenario: Non-denied shell composition remains gateway-owned

- **WHEN** Bash submits a deterministically tokenized shell composition command that is not in the configured denylist
- **THEN** policy ownership MUST remain at the sandbox gateway boundary
- **AND** Bash MUST NOT add a second command-category rejection path for shell composition

#### Scenario: Bash runs shared Python script by explicit path

- **WHEN** Bash submits `python shared-data/scripts/diagnose.py --case shared-data/cases/alarm.json`
- **AND** local sandbox filesystem includes `shared-data/` as a read-only root
- **THEN** Bash MUST submit the parsed command through the sandbox dependency
- **AND** script path and case path MUST be resolved by sandbox filesystem root mapping
- **AND** Bash MUST NOT rewrite the command to a host absolute path in model-visible output or safe diagnostics

#### Scenario: Shared data does not become command search path

- **WHEN** `shared-data/scripts/diagnose.py` exists
- **AND** Bash submits `diagnose.py`
- **THEN** Bash MUST NOT resolve that command from `shared-data/`
- **AND** the sandbox gateway MUST handle it as an ordinary command lookup without shared-data search authority

### Requirement: Bash policy follows frozen local sandbox disable switch

The builtin `bash` tool SHALL consume frozen app composition only to preserve model-facing configuration compatibility. The restricted local sandbox gateway SHALL consume `sandbox.enabled` as the validation-mode switch. When validation is enabled, command-level pre-rejection MUST be governed by the trusted denylist. When validation is disabled, the gateway MUST skip denylist command-level rejection. Bash MUST still submit through the sandbox dependency and MUST NOT execute directly in the capability layer.

When validation is enabled, the gateway MUST still allow non-denied shell built-ins and shell composition to enter sandbox execution. When validation is disabled, the gateway MAY relax other trusted local validation, but MUST continue to own the execution boundary.

#### Scenario: Enabled validation still keeps shell execution gateway-owned

- **WHEN** trusted local startup configuration omits `sandbox.enabled` or sets it to `true`
- **AND** the model submits `cd logs && cat alarm.txt`
- **THEN** Bash MUST submit the request through the sandbox dependency
- **AND** Bash capability MUST not directly invoke host shell APIs
- **AND** the command MUST NOT be rejected only because shell interpretation is required

#### Scenario: Disabled validation remains gateway-owned

- **WHEN** trusted local startup configuration sets `sandbox.enabled=false`
- **THEN** the restricted local sandbox gateway MAY use trusted shell mode
- **AND** the gateway MUST skip denylist command rejection
- **AND** Bash capability MUST not directly invoke host shell APIs

### Requirement: Host Execution Details Belong To The Gateway Adapter
Shell selection, working directory binding, environment scrubbing, timeout, cancellation, output limits, and final host-process execution SHALL belong to the trusted sandbox gateway adapter, not to the tool implementation itself.

#### Scenario: Missing adapter makes Bash unavailable
- **WHEN** app composition does not provide a sandbox dependency
- **THEN** the Bash descriptor MUST be `UNAVAILABLE`
- **AND** it MUST NOT be model-visible or executable

### Requirement: Existing Tool Use Persistence Provides Command Traceability
The authoritative raw command trace SHALL remain the persisted assistant tool-use message already on the request path. Audit and observability surfaces MUST use stable identifiers and safe summaries instead of duplicating the raw command or output.

#### Scenario: Audit remains safe
- **WHEN** Bash execution is audited or logged
- **THEN** the record MUST NOT contain raw command, stdout, stderr, script content, or host path
- **AND** traceability MUST use the persisted tool-use message and stable identifiers

### Requirement: Bash Forwards The Governed Python Module Token Sequence

Bash MUST deterministically tokenize `python -m <dotted-module> [args...]` and `python3 -m <dotted-module> [args...]` as Python sandbox requests. Bash MUST preserve the token sequence for the sandbox execution port and MUST NOT resolve module names, choose Skill roots, create `PYTHONPATH`, or add a second Python invocation policy.

#### Scenario: Bash forwards Python module invocation

- **WHEN** the model invokes Bash with `python -m scripts.nl2sql.sql_recall_main "查询问题"`
- **THEN** Bash MUST submit `python` and the argument vector `[-m, scripts.nl2sql.sql_recall_main, 查询问题]` to the Python sandbox execution port
- **AND** Bash MUST NOT rewrite `-m` or the module name into a file path

### Requirement: Bash Accepts Structured Argv Input

内置 Bash Tool MUST 接受可选的 `args` 字符串数组。当 `args` 存在时，`command` MUST 只标识单个可执行文件，Bash Tool MUST 将 `args` 中的每个字符串作为独立 argv entry 原样提交给 sandbox gateway。Bash Tool MUST NOT 对结构化 `args` 中的引号、空格、括号、反斜杠或 JSON 内容执行 shell tokenization、字符串拼接或自动转义。

如果 `args` 存在且 `command` 解析后包含可执行文件之外的参数、shell composition 或其他 token，Bash Tool MUST 在 sandbox submission 前拒绝该输入，并返回可重试的 `CAPABILITY_INPUT_INVALID`。safe details MUST 包含 reason code `BASH_STRUCTURED_ARGS_COMMAND_NOT_EXECUTABLE_ONLY`，并提示模型 Bash 只支持二选一模式：command-string mode 将完整命令放在 `command` 且不提供 `args`；argv mode 将 `command` 设为唯一可执行文件 token，并把 `-m`、脚本路径、flags、JSON 和用户文本等全部放入 `args`。提示 MUST 明确禁止把同一条命令拆分在 `command` 和 `args` 之间，并说明 `env` 当前只支持 `PYTHONPATH`，其他 key 会被拒绝。

**需求类别**: Functional / Security

#### Scenario: JSON argument is preserved as one argv entry

- **WHEN** Bash is invoked with `command: "python"` and `args` containing a script path followed by a JSON string with nested Gremlin double quotes
- **THEN** the Python sandbox request MUST receive that JSON string as one unchanged argument
- **AND** the tool MUST NOT tokenize or reinterpret quotes inside that JSON argument

#### Scenario: Existing command string input still works

- **WHEN** Bash is invoked without `args`
- **THEN** the tool MUST preserve the existing command-string tokenization path

#### Scenario: Structured Python invocation keeps Python sandbox routing

- **WHEN** Bash is invoked with `command: "python"` or `command: "python3"` and structured `args`
- **THEN** the tool MUST route execution through the Python sandbox dependency

#### Scenario: Mixed command string is rejected with a repair hint

- **WHEN** Bash is invoked with `command: "python scripts/http_request.py"` and `args: ["{\"limit\":200}"]`
- **THEN** Bash MUST reject the input before sandbox submission
- **AND** the result MUST be a retryable `CAPABILITY_INPUT_INVALID`
- **AND** safe details reason code MUST be `BASH_STRUCTURED_ARGS_COMMAND_NOT_EXECUTABLE_ONLY`
- **AND** the safe hint MUST tell the model to choose either command-string mode with no `args` or argv mode with `command` as only the executable
- **AND** the safe hint MUST tell the model never to split one command between `command` and `args`
- **AND** the safe hint MUST state that `env` currently supports only `PYTHONPATH`

### Requirement: Bash Streaming Execution Path

Bash 工具 input schema MUST 支持可选字段 `stream_format`，枚举值为 `'sse'` 和 `'ndjson'`。当模型设置 `stream_format` 且 sandbox 执行端口提供 `runShellStreaming` 方法时，Bash 工具 MUST 使用流式执行路径：通过 `runShellStreaming` 的 `onStdoutChunk` 回调逐块接收 stdout，使用帧分割逻辑将 chunk 分割为独立帧，每帧提取结构化 payload 后通过 `emitResultDelta` 回调传递给 tool-loop。

需求类别：功能性需求

当 `stream_format` 为 `'sse'` 或 `'ndjson'` 且 sandbox 执行端口提供 `runShellStreaming` 方法时，Bash 工具 MUST 使用流式执行路径：通过 `runShellStreaming` 的 `onStdoutChunk` 回调逐块接收 stdout，使用帧分割逻辑将 chunk 分割为独立帧，每帧提取结构化 payload 后通过 `emitResultDelta` 回调传递给 tool-loop。

当模型未设置 `stream_format` 时，Bash 工具 MUST 根据命令和参数内容自动检测是否为 SSE 流式请求。当命令文本包含 `text/event-stream`、`/sse/`、`--no-buffer` 或 ` -N ` 特征时，Bash 工具 MUST 自动将 `stream_format` 设为 `'sse'`。当未设置 `stream_format` 且未匹配到任何流式特征、或 sandbox 执行端口不提供 `runShellStreaming` 时，Bash 工具 MUST 走现有非流式执行路径（`runShell`、`runShellBackgroundable` 或 `runPython`），行为 MUST 与未引入 `stream_format` 字段时完全一致。

流式执行路径的 terminal 结果处理（`exitCode`、`stdoutTruncated`、`stderrTruncated`、degraded 判定、timeout 判定）MUST 与非流式路径一致。流式路径 MUST NOT 改变 `bashExecutionOutputSchema` 的结果形状。

帧分割逻辑 MUST 复用 `drainClipOutputFrames` 的 SSE `\n\n` 边界和 NDJSON 行边界分割。每帧通过 `parseClipOutputFrame` 解析；对 SSE 帧，`parseClipSseFrame` MUST 提取 `data:` 字段并 JSON.parse 为 `data_json`。每帧的 `data_json`（或直接 parsed 对象）MUST 直接作为 payload 传给 `emitResultDelta`，MUST NOT 自行包装 `{structuredPayload: ...}`，因为 executor 层会自动包裹 `{structuredPayload: payload}`。

执行完成后 MUST 调用 `emitter.flush()` 处理残余 buffer 中的不完整帧。

#### Scenario: stream_format sse 使用流式执行路径

- **WHEN** 模型调用 Bash 并设置 `stream_format: "sse"`，且 sandbox 执行端口提供 `runShellStreaming`
- **THEN** Bash 工具 MUST 调用 `runShellStreaming` 而非 `runShell` 或 `runShellBackgroundable`
- **AND** `onStdoutChunk` 回调 MUST 被调用以逐块接收 stdout
- **AND** 每个完整 SSE 帧 MUST 通过 `emitResultDelta` 传递给 tool-loop

#### Scenario: stream_format ndjson 使用流式执行路径

- **WHEN** 模型调用 Bash 并设置 `stream_format: "ndjson"`，且 sandbox 执行端口提供 `runShellStreaming`
- **THEN** Bash 工具 MUST 调用 `runShellStreaming`
- **AND** 每个完整 JSON 行 MUST 通过 `emitResultDelta` 传递给 tool-loop

#### Scenario: 未设置 stream_format 但命令匹配 SSE 特征时自动激活流式路径

- **WHEN** 模型调用 Bash 且未设置 `stream_format`，但命令或参数包含 `text/event-stream`、`/sse/`、`--no-buffer` 或 ` -N `
- **THEN** Bash 工具 MUST 自动将 `stream_format` 设为 `"sse"`
- **AND** MUST 使用流式执行路径
- **AND** `onStdoutChunk` 回调 MUST 被调用

#### Scenario: 未设置 stream_format 且不匹配流式特征时走非流式路径

- **WHEN** 模型调用 Bash 且未设置 `stream_format`，且命令不匹配任何 SSE 流式特征
- **THEN** Bash 工具 MUST 走现有非流式执行路径
- **AND** 行为 MUST 与未引入 `stream_format` 字段时完全一致

#### Scenario: sandbox 不支持 runShellStreaming 时回退

- **WHEN** `stream_format` 为 `"sse"`（显式设置或自动检测），但 sandbox 执行端口的 `runShellStreaming` 为 `undefined`
- **THEN** Bash 工具 MUST 回退到现有非流式执行路径
- **AND** MUST NOT 抛出错误

#### Scenario: 流式路径 terminal 结果形状不变

- **WHEN** Bash 流式执行完成
- **THEN** 返回的结果 MUST 匹配 `bashExecutionOutputSchema`
- **AND** `exitCode`、`stdout`、`stderr`、`stdoutTruncated`、`stderrTruncated` 字段 MUST 存在
- **AND** degraded 和 timeout 判定逻辑 MUST 与非流式路径一致

#### Scenario: 残余 buffer 在 flush 时处理

- **WHEN** Bash 流式执行完成且 emitter buffer 中有残余不完整帧
- **THEN** `emitter.flush()` MUST 被调用
- **AND** 残余帧 MUST 被处理并传递给 `emitResultDelta`

### Requirement: Bash Accepts Narrow Pythonpath Environment

The built-in Bash Tool MUST accept an optional structured `env` object containing only `PYTHONPATH`. When present, `env.PYTHONPATH` MUST be treated as a sandbox environment request and MUST NOT be concatenated into the command string.

`env` MUST remain a narrow allowlisted runtime configuration object. Bash Tool MUST reject any model-controlled `env` key other than `PYTHONPATH`. Model-facing guidance MUST state that `env` currently supports only `PYTHONPATH` and that any other key is rejected.

The Bash Tool MUST normalize a single leading `PYTHONPATH=<value>` token in command-string input into the same structured environment request, then route the following executable and arguments normally. The Bash Tool MUST NOT treat other environment assignment keys as supported compatibility syntax.

The sandbox boundary MUST pass only the accepted `PYTHONPATH` value from model-controlled Bash input. The restricted local sandbox MUST resolve that value as a sandbox logical path authorized by the request filesystem before passing it to the child process. Absolute paths, parent traversal, path-list separators, unauthorized logical paths, and non-string values MUST be rejected before process start.

**Requirement Category**: Functional / Security

#### Scenario: Legacy PYTHONPATH prefix keeps Python sandbox routing

- **WHEN** Bash is invoked with command text starting with `PYTHONPATH=.nextagent/skills/<projection>/<skill>/scripts python ...`
- **THEN** the Bash Tool MUST submit `python` as the executable
- **AND** it MUST pass the remaining tokens as argv
- **AND** it MUST include `PYTHONPATH` in the filtered sandbox environment

#### Scenario: Structured env passes PYTHONPATH without shell syntax

- **WHEN** Bash is invoked with `command: "python"`, structured `args`, and `env.PYTHONPATH`
- **THEN** Python sandbox execution MUST receive the structured argv unchanged
- **AND** the sandbox environment MUST include only the accepted `PYTHONPATH` value from Bash input

#### Scenario: Command-string mode accepts structured PYTHONPATH

- **WHEN** Bash is invoked with a full command string, no `args`, and `env.PYTHONPATH`
- **THEN** Bash MUST preserve command-string tokenization
- **AND** it MUST pass the accepted `PYTHONPATH` value as structured sandbox environment

#### Scenario: Unauthorized PYTHONPATH is rejected

- **WHEN** a Bash Python invocation provides `env.PYTHONPATH` as an absolute path, parent traversal path, path list, or unbound logical root
- **THEN** the restricted local sandbox MUST reject the request before process start
- **AND** the safe error MUST be an authorization/path rejection rather than an unsupported executable fallback
