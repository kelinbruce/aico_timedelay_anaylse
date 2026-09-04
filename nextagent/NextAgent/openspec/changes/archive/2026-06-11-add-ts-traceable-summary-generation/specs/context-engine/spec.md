## ADDED Requirements

### Requirement: Context Engine SHALL 组合 traceable summary generation 实现

Context Engine SHALL 提供或组合一个 `TraceableSummaryGenerationPort` 的默认实现，使 context compression 可以请求 summary draft，而不依赖 prompt、model 或解析内部实现。

#### Scenario: Traceable summary generator 对 compression 可用
- **WHEN** 应用在启用 summary 压缩的情况下组合 Context Engine
- **THEN** 一个 `TraceableSummaryGenerationPort` 实现 SHALL 可用
- **AND** 当需要 summary 压缩时，context compression SHALL 能通过该 port 调用它

### Requirement: Context Engine SHALL 保持语义生成与压缩提交分离

Traceable summary generator SHALL 不拥有 active context 提交。返回的 `TraceableSummaryDraft` SHALL 是内部 port DTO（内容加 presentation-safe 可追溯元数据），而不是可持久化的 message 对象。Context compression SHALL 仍负责取 `draft.content` 构造领域 summary `SessionMessage`，并通过 `ActiveContextStoreGateway.commitCompaction` 提交它。

#### Scenario: Summary draft 由 compression 提交
- **WHEN** `TraceableSummaryGenerationPort.generate()` 返回一个 draft
- **THEN** context compression SHALL 用 `draft.content` 和 metadata 构建领域 summary `SessionMessage`
- **AND** context compression SHALL 执行 active context 提交
