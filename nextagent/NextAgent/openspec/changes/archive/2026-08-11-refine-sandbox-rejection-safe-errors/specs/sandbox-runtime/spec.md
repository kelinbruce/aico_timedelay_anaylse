## MODIFIED Requirements

所属 Function: `FN-Sandbox Runtime`
Function 变更类型: modified
spec 角色: 主规格

### Requirement: Sandbox Failure And Resource Limits Are Explicit

Sandbox unavailability, sandbox governance rejection, policy denial, timeout, cancellation, command failure, output too large, and resource exceeded conditions MUST produce explicit safe failure outcomes. The system MUST distinguish a request rejected by sandbox governance from genuine sandbox execution unavailability. The system MUST NOT silently truncate output and MUST NOT fall back to unsandboxed local execution when sandbox execution fails.

#### Scenario: Unsupported Python invocation is actionable

- **GIVEN** the Python sandbox rejects an invocation because the argument shape is unsupported
- **WHEN** the rejection reaches a built-in capability
- **THEN** the capability result MUST use a validation safe error rather than `SANDBOX_UNAVAILABLE`
- **AND** the safe details MUST preserve the sandbox rejection reason
- **AND** the safe details MUST include a correction hint that tells the model to use a supported Python script or module invocation.

#### Scenario: Genuine sandbox startup failure remains unavailable

- **GIVEN** the sandbox cannot start or is otherwise unavailable without a governance rejection reason
- **WHEN** the failure reaches a built-in capability
- **THEN** the capability result MUST continue to use an unavailable safe error.
