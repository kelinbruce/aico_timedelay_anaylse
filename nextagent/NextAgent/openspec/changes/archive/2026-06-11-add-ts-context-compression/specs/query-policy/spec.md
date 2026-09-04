## ADDED Requirements

### Requirement: Query Policy SHALL expose summary-compression pressure without side effects

Query Policy SHALL 只负责判断 eligible prior active-context history 是可以 unchanged、需要 summary replacement，还是必须 degrade/fail。它不得调用模型、写 summary、修改 active context 或执行持久化。

#### Scenario: Prior history exceeds safe budget
- **WHEN** eligible prior history remains over budget
- **THEN** Query Policy MUST return machine-readable budget evidence indicating prior-history pressure
- **AND** it MUST leave summary generation, validation, and commit to Context Engine and gateway boundaries

### Requirement: Query Policy SHALL preserve non-negotiable context invariants

压缩决策 MUST 保护 minimum safe current-request context、owner scope、agent scope、active-context visibility，以及合法 conversation/protocol boundaries。

#### Scenario: Candidate strategy violates an invariant
- **WHEN** a summary-compression strategy would violate a required boundary
- **THEN** Query Policy MUST reject that strategy, expand the protected boundary, or mark compression unavailable

### Requirement: Query Policy SHALL explain compression decisions safely

Query Policy SHALL 为 compression strategy selection、rejection、fallback、degradation 和 failure 产出 presentation-safe machine-readable reasons。

#### Scenario: Summary compression is selected or skipped
- **WHEN** Query Policy chooses, rejects, or falls back from summary compression
- **THEN** it MUST produce a presentation-safe machine-readable reason
