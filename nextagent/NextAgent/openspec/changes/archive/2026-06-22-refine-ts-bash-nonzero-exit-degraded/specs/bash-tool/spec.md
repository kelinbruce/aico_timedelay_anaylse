## MODIFIED Requirements

### Requirement: Bash Results Are Bounded And Safe

Bash success and failure results SHALL use bounded stdout/stderr payloads and stable safe result semantics. Logs, metrics, traces, and audit facts MUST NOT duplicate raw command text or raw channel output.

当 Bash invocation 已经通过策略校验并进入 sandbox execution boundary 后，返回非零 exit code 的场景 MUST 被视为“已执行但降级”的结构化结果，而不是 capability-level terminal failure。系统 MUST 将该场景映射为 `CapabilityInvocationResult.status="DEGRADED"`，并保留有界 `stdout`、`stderr`、`exitCode`、`stdoutTruncated` 和 `stderrTruncated` 作为结构化 payload。后续模型步骤 MUST 能看到该结果。

策略拒绝、sandbox unavailable/canceled、platform unsupported、timeout、response shape invalid、output overflow 或其他 execution boundary failure MUST 继续映射为 safe failed/timed-out capability outcome，不得因为本 requirement 放宽而伪装成 degraded business result。

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
