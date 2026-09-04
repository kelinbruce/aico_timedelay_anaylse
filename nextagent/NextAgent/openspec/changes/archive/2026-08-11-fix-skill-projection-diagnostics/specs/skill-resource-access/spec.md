# Skill Resource Projection Diagnostics and Lock Recovery

## ADDED Requirements

### Requirement: Skill Projection Failures Emit Safe Runtime Diagnostics

系统 MUST 在 Skill 资源投影失败时保留模型可见结果的安全边界，并生成受控的本地运行诊断。

- **Owner Function**: Skill Tool Function
- **Function Change Type**: MODIFIED
- **Spec Role**: Incremental requirement
- **Requirement Category**: Observability / Security

When Skill resource projection fails after the Skill source has been resolved and the Skill body has passed validation, the Skill Tool MUST return the existing safe failure to the model-visible Tool result and MUST NOT expose raw projection internals through SafeError, Web API, stream, timeline, audit, or metric surfaces.

The same failure boundary MUST emit a runtime diagnostic event named `skill.tool.resource_projection_failed`. The event MUST contain only stable, low-cardinality fields needed for local troubleshooting, including the target Skill id, provider id, Skill version, source handle mode, source resource capability booleans, safe error code/category when available, normalized Node error code when available, a bounded failure kind, a bounded failure stage when available, a bounded failure reason code when available, and allowlisted numeric evidence when available.

The event MUST NOT include raw exception messages, stacks, host paths, source roots, projection target paths, Skill arguments, prompt text, model output, resource contents, credentials, tokens, or high-cardinality business values.

The failure kind vocabulary MUST distinguish at least the following categories when evidence is available:

- `RESOURCE_LIMIT`
- `PATH_REJECTED`
- `PERMISSION_DENIED`
- `MISSING_PATH`
- `FILESYSTEM_BUSY`
- `SAFE_ERROR`
- `UNKNOWN_EXCEPTION`

The failure stage and reason code vocabulary MUST be code-owned uppercase identifiers. Numeric evidence MUST be restricted to bounded counters and limits, such as resource count, maximum resource count, path length, maximum path length, observed size, expected size, and lock wait milliseconds.

#### Scenario: Permission-style projection failure keeps public result generic

- **WHEN** Skill resource projection fails with a local permission-style filesystem error
- **THEN** the Skill Tool result returned to the model MUST remain a safe generic projection failure
- **AND** the runtime diagnostic event MUST classify the failure as `PERMISSION_DENIED`
- **AND** the runtime diagnostic event MUST NOT include the raw filesystem path from the exception message

#### Scenario: Safe projection failure exposes only safe classifiers

- **WHEN** Skill resource projection fails with a SafeError such as `CAPABILITY_PATH_REJECTED` or `RESOURCE_TOO_LARGE`
- **THEN** the Skill Tool result returned to the model MUST preserve the existing SafeError code and safe message behavior
- **AND** the runtime diagnostic event MUST include only the SafeError code/category, bounded failure kind, allowlisted failure stage, allowlisted failure reason code, and allowlisted numeric evidence
- **AND** the runtime diagnostic event MUST NOT include raw resource paths, resource contents, or Skill arguments

#### Scenario: Diagnostic details are allowlisted

- **WHEN** a projection SafeError carries diagnostic details
- **THEN** the runtime diagnostic event MAY include `failureStage`, `failureReasonCode`, and bounded numeric evidence from the allowlist
- **AND** the runtime diagnostic event MUST NOT copy arbitrary detail fields, raw paths, raw messages, stacks, Skill arguments, or resource contents

### Requirement: Concurrent Skill Projection Reuses Committed Resources

系统 MUST 在同一执行作用域内安全处理同一 Skill 投影身份的并发激活。

- **Owner Function**: Skill Tool Function
- **Function Change Type**: MODIFIED
- **Spec Role**: Incremental requirement
- **Requirement Category**: Reliability

When multiple accepted runs in the same execution scope concurrently activate the same governed Skill projection identity, the projection boundary MUST protect publication with the existing projection lock and MUST allow a contending activation to reuse a committed projection that becomes complete while contention is observed.

The reuse decision MUST validate the committed projection identity and integrity before exposing the resource root. It MUST NOT derive trust from model-provided paths, historical prompt text, or process-local initialization state alone.

If the projection lock remains unavailable until the bounded wait expires and no valid committed projection can be reused, the Skill Tool failure returned for that lock contention MUST be retryable and MUST NOT be mapped to a non-retryable internal failure.

#### Scenario: Independent activations reuse the first committed projection

- **WHEN** two independent workspace file ports share the same execution scope and concurrently project the same Skill identity
- **AND** the first activation publishes a valid committed projection while the second activation has observed lock contention
- **THEN** the second activation MUST reuse the committed projection after validating its identity and integrity
- **AND** the second activation MUST NOT rebuild the same resource set

#### Scenario: Projection lock timeout is retryable

- **WHEN** Skill projection cannot acquire the projection lock before the bounded wait expires
- **AND** no valid committed projection is available for reuse
- **THEN** the Skill Tool result MUST use a safe retryable failure
- **AND** the failure MUST NOT expose the physical lock path, staging path, source path, or resource contents
