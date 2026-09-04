## MODIFIED Requirements

### Requirement: Structured logs 必须从 observation 受控映射

`StructuredLogProjector` SHALL 只把可信 observation fields 和已批准 diagnostic candidates 映射到 `StructuredLogEntry`。它必须复制可用 owner-safe refs，省略缺失 optional refs，使用稳定 event name，按 policy 选择有界 level，复制可选 `durationMs` 和 normalized `usage`，并在 sink write 前执行 LOG redaction。

The LOG surface for this change SHALL support exactly two runtime modes from frozen app config:

- `normal`: 当前默认行为；仅输出现有 stable safe 字段。
- `debug`: 保持 redaction 不变，但允许在 structured log 中输出额外的 safe diagnostic fields，用于本地排障。

`debug` mode MUST remain a safe debug mode. It MUST NOT emit raw prompt、raw model output、raw provider response、stack、path、credential、token、tool args/result、attachment content or any field already forbidden by the redaction policy. Extra debug fields MUST come only from trusted observation fields, trusted safe error fields, or policy-approved diagnostic candidates already attached to the same `ObservabilityObservationEvent`.

#### Scenario: Missing refs 被省略

- **WHEN** log observation 缺少 `messageId` 或 `capabilityInvocationId`
- **THEN** log entry 省略这些 refs
- **AND** 不生成 placeholder id

#### Scenario: Raw capability result 被忽略

- **WHEN** capability result delta 包含 raw result payload
- **THEN** LOG projection 忽略 raw result fields
- **AND** 只可记录 safe refs、status、duration 和 safe reason

#### Scenario: debug mode expands safe diagnostic fields

- **WHEN** frozen app config sets `observability.logging.redaction=debug` and an observation carries policy-approved safe diagnostic fields
- **THEN** structured log output MAY include more of those safe diagnostic fields than `normal` mode
- **AND** the additional fields MUST remain bounded, deterministic, and sourced from the same observation
- **AND** the output MUST remain valid even when those additional fields are absent

#### Scenario: normal mode remains backward-compatible

- **WHEN** frozen app config omits `observability.logging.redaction` or sets it to `normal`
- **THEN** structured log projection MUST preserve the current normal-mode behavior
- **AND** it MUST NOT require producers to attach new diagnostic fields in order to emit a valid log entry
