# bash-tool Specification Delta

## MODIFIED Requirements

### Requirement: Bash Tool Input Is Compatible With TonyClaw

The public `bash` tool input SHALL use stable canonical fields `command`, optional `description`, and optional `timeout`. The compatibility alias `timeout_ms` MAY also be accepted for model-produced tool input, but it SHALL NOT replace `timeout` as the canonical field name.

`timeout` SHALL remain authoritative when both fields are present. `timeout_ms` compatibility SHALL accept only the same positive integer shape as canonical `timeout`. After normalization, the effective timeout semantics remain unchanged: default `120000` ms, capped at `600000` ms, and further bounded by the trusted invocation timeout.

The input MAY accept an optional boolean field `run_in_background` to request background async execution. `run_in_background` SHALL be present in the model-visible input schema only when the deployment is local (`backgroundExecutionEnabled === true`); in remote deployments the field SHALL be absent and `additionalProperties: false` SHALL reject any model-supplied `run_in_background`. When `run_in_background` is absent or `false`, Bash SHALL execute as a bounded foreground command with unchanged semantics.

#### Scenario: Compatibility alias timeout_ms is accepted

- **WHEN** a model supplies `timeout_ms` instead of `timeout`
- **THEN** Bash input normalization MUST accept it as a timeout alias
- **AND** the effective timeout MUST follow the existing Bash timeout bounds

#### Scenario: Canonical timeout wins over compatibility alias

- **WHEN** both `timeout` and `timeout_ms` are supplied
- **THEN** Bash MUST use `timeout`
- **AND** the alias MUST NOT override the canonical field

#### Scenario: run_in_background is exposed only in local deployments

- **WHEN** the deployment is local (`backgroundExecutionEnabled === true`)
- **THEN** the model-visible `bash` input schema MUST include `run_in_background`
- **AND** a model-supplied `run_in_background: true` MUST start a background job and return a task handle without awaiting process exit

#### Scenario: run_in_background is rejected in remote deployments

- **WHEN** the deployment is not local (`backgroundExecutionEnabled === false`)
- **THEN** the model-visible `bash` input schema MUST NOT include `run_in_background`
- **AND** a model-supplied `run_in_background` MUST be rejected as `CAPABILITY_INPUT_INVALID`

### Requirement: Host Execution Details Belong To The Gateway Adapter
Shell selection, working directory binding, environment scrubbing, timeout, cancellation, output limits, and final host-process execution SHALL belong to the trusted sandbox gateway adapter, not to the tool implementation itself. Background job lifecycle — detached process start, output file redirection, completion detection, atomic notification flagging, and cleanup — SHALL also belong to the trusted sandbox gateway adapter. The Bash Tool MUST NOT start host processes directly or own background job state; it SHALL request background execution through `SandboxExecutionPort.startBackgroundShell` and receive a task handle.

#### Scenario: Missing adapter makes Bash unavailable
- **WHEN** app composition does not provide a sandbox dependency
- **THEN** the Bash descriptor MUST be `UNAVAILABLE`
- **AND** it MUST NOT be model-visible or executable

#### Scenario: Background start is gateway-owned
- **WHEN** the model invokes Bash with `run_in_background: true` in a local deployment
- **THEN** Bash MUST request background execution through the sandbox dependency
- **AND** the sandbox gateway MUST own the detached process start and output file redirection
- **AND** Bash MUST NOT call host process APIs directly

### Requirement: Bash Results Are Bounded And Safe
Bash success and failure results SHALL use bounded stdout/stderr payloads and stable safe result semantics. Logs, metrics, traces, and audit facts MUST NOT duplicate raw command text or raw channel output.

当 Bash invocation 已经通过策略校验并进入 sandbox execution boundary 后，返回非零 exit code 的场景 MUST 被视为“已执行但降级”的结构化结果，而不是 capability-level terminal failure。系统 MUST 将该场景映射为 `CapabilityInvocationResult.status="DEGRADED"`，并保留有界 `stdout`、`stderr`、`exitCode`、`stdoutTruncated` 和 `stderrTruncated` 作为结构化 payload。后续模型步骤 MUST 能看到该结果。

策略拒绝、sandbox unavailable/canceled、platform unsupported、timeout、response shape invalid、output overflow 或其他 execution boundary failure MUST 继续映射为 safe failed/timed-out capability outcome，不得因为本 requirement 放宽而伪装成 degraded business result。

When `run_in_background: true` is accepted, the immediate Bash result SHALL be a `SUCCEEDED` capability outcome carrying a background task handle `{ taskId, status: "RUNNING", stdoutRef, stderrRef }` instead of inline stdout/stderr. The final command output SHALL NOT be inlined in the handle; it SHALL be reachable via the output file references in a subsequent continuation turn.

#### Scenario: Output is truncated independently
- **WHEN** stdout or stderr exceeds its configured byte limit
- **THEN** the returned channel MUST be truncated
- **AND** its corresponding truncation flag MUST be true

#### Scenario: Non-zero exit remains a degraded structured result
- **WHEN** Bash invocation is accepted, sandbox execution starts, and the command exits with a non-zero exit code
- **THEN** the invocation MUST return `CapabilityInvocationResult.status="DEGRADED"`
- **AND** the result MUST preserve bounded `stdout`, `stderr`, `exitCode`, `stdoutTruncated`, and `stderrTruncated`
- **AND** Agent Core MUST emit a degradation notice and continue the tool loop with that tool result visible to later model steps

#### Scenario: Sandbox execution boundary failures still terminate the run
- **WHEN** Bash invocation fails because of sandbox unavailable/canceled, platform unsupported, timeout, invalid sandbox response shape, output overflow, or another execution-boundary failure
- **THEN** the invocation MUST return a safe `FAILED` or `TIMED_OUT` capability outcome
- **AND** Agent Core MUST NOT treat that outcome as a model-visible successful/degraded Bash command result

#### Scenario: Background invocation returns a task handle
- **WHEN** the model invokes Bash with `run_in_background: true` in a local deployment
- **THEN** the invocation MUST return `CapabilityInvocationResult.status="SUCCEEDED"`
- **AND** the structured payload MUST contain `taskId`, `status: "RUNNING"`, `stdoutRef`, and `stderrRef`
- **AND** the payload MUST NOT contain inline stdout/stderr

## ADDED Requirements

### Requirement: Background Shell Jobs Complete As Continuation Runs
When a background shell job exits, the sandbox gateway SHALL record the terminal status in the background task store and SHALL inject exactly one task-notification continuation run into the originating session. The notification SHALL be submitted through `RequestLifecycleCoordinator.submit` with a stable idempotency key derived from the task id, so the session lane scheduler serializes it after any in-flight run. The notification payload SHALL include the task id, the originating tool call id, the stdout/stderr output file references, the terminal status, and a safe summary; it SHALL NOT include raw command text or raw channel output. The gateway SHALL use an atomic notified flag to guarantee at most one continuation submission per task, even when completion races with run cancellation or duplicate close events.

#### Scenario: Completion triggers exactly one continuation run
- **WHEN** a background shell job exits
- **THEN** the gateway MUST mark the task terminal in the background task store
- **AND** it MUST submit exactly one task-notification continuation run via `coordinator.submit`
- **AND** the continuation run MUST carry the output file references and terminal status

#### Scenario: Duplicate completion does not duplicate continuation
- **WHEN** the job close event fires more than once or races with run cancellation
- **THEN** the gateway MUST submit the continuation run at most once
- **AND** the atomic notified flag MUST prevent any second submission

#### Scenario: Continuation is serialized after in-flight work
- **WHEN** a background job completes while another run is in flight on the same session lane
- **THEN** the continuation run MUST be queued on the session lane
- **AND** it MUST be dispatched only after the in-flight run terminates

### Requirement: Background Execution Is Local-Only
The Bash background execution capability SHALL be exposed only in local deployments. The `backgroundExecutionEnabled` flag SHALL be derived from `deploymentMode === "LOCAL"` at app composition time. In non-local deployments, the `bash` input schema MUST NOT advertise `run_in_background`, and the sandbox gateway `startBackground` operation MUST return a safe `SANDBOX_BACKGROUND_UNAVAILABLE` error regardless of model input. Background execution SHALL NOT be available in remote deployments even if a sandbox dependency is present.

#### Scenario: Local deployment exposes background execution
- **WHEN** app composition runs with `deploymentMode === "LOCAL"`
- **THEN** `backgroundExecutionEnabled` MUST be `true`
- **AND** the `bash` input schema MUST include `run_in_background`
- **AND** `SandboxExecutionPort.startBackgroundShell` MUST be usable

#### Scenario: Remote deployment does not expose background execution
- **WHEN** app composition runs with a non-local `deploymentMode`
- **THEN** `backgroundExecutionEnabled` MUST be `false`
- **AND** the `bash` input schema MUST NOT include `run_in_background`
- **AND** sandbox gateway `startBackground` MUST return `SANDBOX_BACKGROUND_UNAVAILABLE`
