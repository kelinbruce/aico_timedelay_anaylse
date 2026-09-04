## MODIFIED Requirements

### Requirement: Redaction is enforced by the shared observation boundary

系统 SHALL 在 `ObservabilityProjectorHost.acceptObservation(event)` 的共享接收边界执行 observation redaction。业务模块 MAY 通过 `DiagnosticContext` 或 `ObservabilityObservationEvent` produce candidate safe fields, diagnostic candidates and source classifications, but MUST NOT implement private redaction rules, bypass the unified policy, or emit diagnostic output directly to external consumers。

safe error、stream diagnostic、health diagnostic 或 release gate evidence 等不经过 `ObservabilityProjectorHost` 的安全输出边界，也 MUST 使用同一套字段裁剪和字段内容脱敏规则；这些边界不得定义私有敏感字段规则。唯一例外是 `runtime-execution-exception-diagnostics` 定义的本地 `RuntimeLogger` 执行异常诊断：它不属于 `ObservabilityObservationEvent`，配置时必须写入 operational runtime log 文件，并且必须遵守该 capability 定义的字段脱敏和禁止扩散边界。

For this release, `observability.logging.redaction=debug` MUST NOT bypass the shared observation boundary. Debug mode MAY only change which already-safe, policy-approved diagnostic fields remain visible after sanitization; it MUST NOT disable redaction, relax forbidden-field classes, or permit a projector / logger sink to consume unsanitized observation data.

#### Scenario: Gateway failure is sanitized at the output boundary
- **WHEN** a gateway adapter returns a failure containing raw provider or platform details
- **THEN** the shared observation boundary applies redaction before the event enters async projector handoff
- **AND** the adapter does not independently decide which raw fields are externally visible

#### Scenario: Local execution exception uses the scoped runtime diagnostic exception
- **WHEN** Tool execution or terminal submit records `rawExceptionData`
- **THEN** the data is emitted through local `RuntimeLogger`, and the configured operational runtime log file contains it under `runtime-execution-exception-diagnostics`
- **AND** it MUST NOT enter `ObservabilityProjectorHost` or any external consumer

#### Scenario: Diagnostic candidates are sanitized once
- **WHEN** a business module adds diagnostic candidates for observability
- **THEN** each candidate is filtered or value-redacted by the shared observation policy before queue handoff
- **AND** an unclassified candidate is omitted by default

#### Scenario: High-cardinality candidates are rejected for metrics
- **WHEN** a diagnostic candidate contains a base station id、request id、message id、path、free-text reason or equivalent high-cardinality value
- **THEN** sanitized observation MAY retain only a classified, safe representation when policy allows it
- **AND** metric projector MUST still reject high-cardinality fields as labels unless the metric inventory explicitly allows them

#### Scenario: debug mode still hands off sanitized observations only
- **WHEN** frozen app config enables `observability.logging.redaction=debug`
- **THEN** `ObservabilityProjectorHost` MUST still hand off only sanitized `ObservabilityObservationEvent`
- **AND** downstream projector、logger transport、audit sink and metric registry MUST NOT receive raw prompt、stack、path、provider body、secret or credential fields because of debug mode
