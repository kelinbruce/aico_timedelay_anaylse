## Function

- **Owning Function**: FN-6.7 脱敏
- **Change Type**: MODIFIED
- **Spec Role**: Primary delta

## MODIFIED Requirements

### Requirement: Redaction is enforced by the shared observation boundary

系统 SHALL 在 `ObservabilityProjectorHost.acceptObservation(event)` 的共享接收边界执行 observation redaction。业务模块 MAY 通过 `DiagnosticContext` 或 `ObservabilityObservationEvent` produce candidate safe fields、diagnostic candidates 和 source classifications，但 MUST NOT 实现私有 observation redaction、绕过统一策略或把 raw diagnostic 直接输出给 external consumer。

SafeError、stream diagnostic、health diagnostic 和 release gate evidence 等安全输出边界 SHALL 使用统一字段裁剪和内容脱敏策略。Web API、SSE、WebSocket、timeline、audit、metric、trace 和 `ObservabilityObservationEvent` MUST NOT 消费 local runtime diagnostic special field。

本地 operational runtime log SHALL 作为唯一受控例外，并由 canonical `runtime-logging` capability 定义其策略。其 `toolInput`、`toolOutput`、`modelInput`、`modelOutput` 和 `rawExceptionData` MAY 保留 prompt、路径、命令、stdout、stderr、模型可见输出和普通业务内容，但 SHALL 对 credential 和认证类 token 做窄匹配脱敏，并受固定容量限制。该例外不属于 observation redaction bypass，也不得由 `diagnosticDetail` 配置关闭或扩散到外部边界。

Observation-derived Model terminal entry MAY 投影 `firstContentLatencyMs`，但该字段 MUST 是有限非负数、MUST 只出现在 Model terminal observation、并在同时存在 `durationMs` 时小于或等于 `durationMs`。不满足这些条件的 candidate MUST 被拒绝或省略；该安全 timing 字段不得承载原始 Model 内容，也不改变 special local diagnostic field 的隔离规则。

For this release, `observability.logging.redaction=debug` MUST NOT bypass the shared observation boundary. Debug mode MAY only change which already-safe, policy-approved diagnostic fields remain visible after sanitization; it MUST NOT disable redaction, relax forbidden-field classes, or permit a projector/logger sink to consume unsanitized observation data.

#### Scenario: Local runtime diagnostic 使用独立受控策略

- **WHEN** Tool、Model 或 execution exception 产生 `runtime-logging` 批准的 local special field
- **THEN** configured operational runtime log SHALL 包含该字段的有界可定位值
- **AND** credential 与认证类 token MUST 被窄匹配脱敏
- **AND** 同一值 MUST NOT 进入 `ObservabilityProjectorHost` 或任何 external consumer

#### Scenario: Inline credential 脱敏保留命令语法

- **WHEN** local special field 的命令或文本包含带引号的 credential assignment 或后续参数分隔符
- **THEN** writer MUST 只把 credential value 替换为 credential marker
- **AND** MUST 保留原有引号、`&` 及后续非 credential 参数，使日志仍可用于还原命令形状

#### Scenario: Gateway failure is sanitized at the output boundary

- **WHEN** gateway adapter 返回包含 raw provider 或 platform detail 的失败
- **THEN** shared observation boundary SHALL 在 async projector handoff 前应用 redaction
- **AND** adapter 不得独立决定 raw field 的外部可见性

#### Scenario: Diagnostic candidates are sanitized once

- **WHEN** business module 为 observability 添加 diagnostic candidates
- **THEN** each candidate SHALL 在 queue handoff 前由 shared observation policy filter 或 value-redact
- **AND** unclassified candidate SHALL 默认省略

#### Scenario: High-cardinality candidates are rejected for metrics

- **WHEN** diagnostic candidate 包含 base station id、request id、message id、path、free-text reason 或同类高基数值
- **THEN** sanitized observation MAY 仅在 policy 允许时保留 classified safe representation
- **AND** metric projector 仍 MUST 拒绝高基数字段作为 label，除非 metric inventory 明确允许

#### Scenario: debug mode still hands off sanitized observations only

- **WHEN** frozen app config 启用 `observability.logging.redaction=debug`
- **THEN** `ObservabilityProjectorHost` SHALL 仍只 hand off sanitized `ObservabilityObservationEvent`
- **AND** downstream projector、logger transport、audit sink 和 metric registry MUST NOT 因 debug mode 收到 raw prompt、stack、path、provider body、secret 或 credential

## Function Change Summary

### Description

把脱敏策略按输出边界拆分为 external observation 强脱敏与 local runtime diagnostic 窄 credential/token 脱敏，消除 SafeMessage 与本地问题定位的职责混淆。

### Processing

1. Observation 和 external safe output 继续经过统一 redaction。
2. Canonical `runtime-logging` 识别 local special field，并应用窄 credential/token 脱敏和容量约束。
3. 两类 surface 不共享 raw field，也不允许 debug 配置改变隔离结果。

### Result

本地日志保留故障根因和业务执行内容，对外边界仍满足既有安全契约。

### Specifications

| Specification Item | Change Type | Target Specification Value | Requirement Evidence |
| --- | --- | --- | --- |
| Observation redaction | MODIFIED | 所有 external/observation surface 继续强制统一安全投影。 | Redaction is enforced by the shared observation boundary |
| Local runtime exception | ADDED | local special fields 只窄脱敏 credential/token，不脱敏 prompt/path/command/business content。 | Redaction is enforced by the shared observation boundary |
