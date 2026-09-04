## MODIFIED Requirements

### Requirement: Python tool returns structured execution result

当 Python sandbox execution 正常完成并返回结构化进程结果时，tool SHALL 返回以下结构化输出：

- `exit_code` (integer)
- `stdout` (string)
- `stderr` (string)
- `timed_out` (boolean)

Stdout 和 stderr SHALL 各自受限于实现定义的安全字节上限，并且只能在有效 UTF-8 边界上截断。

如果 Python execution 已成功完成并返回结构化结果，则 `exit_code != 0` SHALL 仍然作为普通结构化结果返回；系统 MUST NOT 仅因为非零 exit code 就把该结果提升为 capability-level `FAILED`、`TIMED_OUT` 或 `DEGRADED`。

如果 Python execution 在 sandbox boundary 内发生 timeout，则 invocation MUST 收敛为 capability-level `TIMED_OUT` truth，并沿用统一 capability failure/timed_out 投影路径，而不是伪装成普通 `SUCCEEDED` 结构化结果。

如果 Python execution 在 sandbox boundary 内返回 unavailable、deny 或其他 safe failure，则 invocation MUST 收敛为 capability-level `FAILED` truth，并沿用统一 capability failure 投影路径，而不是伪装成普通 `SUCCEEDED` 结构化结果。

当上述 `TIMED_OUT` 或 `FAILED` 结果属于模型可恢复的安全失败时，系统 MUST 继续使用既有 bounded `CAPABILITY_RESULT` failure payload 将失败证据暴露给后续模型步骤，以便模型调整参数、改用其他 capability 或直接结束。

#### Scenario: python returns process output

- **WHEN** Python executes submitted code and the sandbox returns a structured result before timeout
- **THEN** it MUST return structured execution output
- **AND** the returned output includes `exit_code`, `stdout`, `stderr`, and `timed_out`

#### Scenario: python non-zero exit remains structured

- **WHEN** Python execution completes with `exit_code != 0`
- **THEN** the invocation MUST still return structured execution output
- **AND** it MUST NOT become a capability-level failed result solely because the exit code is non-zero

#### Scenario: python timeout becomes capability timed_out

- **WHEN** Python execution exceeds the effective timeout at the sandbox boundary
- **THEN** the capability result MUST become `TIMED_OUT`
- **AND** the system MUST emit the existing timed_out failure truth instead of a fake `SUCCEEDED` payload
- **AND** a bounded failure payload MUST remain available for later model steps

#### Scenario: python sandbox unavailable becomes capability failed

- **WHEN** the sandbox boundary returns a safe unavailable or denied failure for Python execution
- **THEN** the capability result MUST become `FAILED`
- **AND** the system MUST emit the existing capability failure truth instead of a fake `SUCCEEDED` payload
- **AND** a bounded failure payload MUST remain available for later model steps
