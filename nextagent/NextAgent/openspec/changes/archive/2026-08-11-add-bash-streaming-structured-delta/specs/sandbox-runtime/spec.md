# sandbox-runtime Specification Delta

所属 Function：sandbox-runtime
Function 变更类型：修改
spec 角色：主规格

## ADDED Requirements

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

## Function 变更汇总

### 接口

变更类型：修改
目标内容：`SandboxExecutionPort` 新增可选方法 `runShellStreaming`（流式 stdout 回调执行）；`SandboxGatewayExecutionAdapter` 新增可选方法 `executeWithStdoutChunks`（gateway 层流式 stdout 推送）；`runSandbox` 新增 `onStdoutChunk` 参数。
依据 Requirements：Sandbox Streaming Stdout Execution
