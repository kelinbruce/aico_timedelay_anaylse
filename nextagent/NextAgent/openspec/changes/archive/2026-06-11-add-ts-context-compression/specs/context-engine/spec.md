## ADDED Requirements

### Requirement: Context Engine SHALL own summary compression orchestration

当 selected prior active-context history 无法安全放入预算时，Context Engine SHALL 在 `assemble()` 中编排 summary compression。它消费 Query Policy 的预算/压缩信号和 summary-generation port，但不得依赖其他模块的 private ports。

#### Scenario: Prior history requires compression
- **WHEN** prior active-context history exceeds the safe history budget
- **THEN** Context Engine SHOULD attempt eligible summary compression before accepting prior-history omission when a summary-generation port is configured
- **AND** it MUST preserve current-request, visibility, owner-scope, agent-scope, and protocol invariants

### Requirement: Context Engine SHALL consume summary generation through a cancellable port

当需要语义 summary generation 时，Context Engine SHALL 调用受治理的 asynchronous summary-generation boundary，校验结果，并用返回的 `TraceableSummaryDraft.content` 构造 summary `SessionMessage`（领域对象），并且只提交 valid safe summary representation。`TraceableSummaryDraft` 是 Context Engine 消费的内部 port DTO（content + presentation-safe traceability metadata），不是可直接持久化的 message 对象。Context Engine 在领域层只构造 `SessionMessage`；向 `ActiveContextStoreGateway.commitCompaction(...)` 提交时，由 session 映射边界把它转换为 `ContextCompactionCommitRequest.summaryMessage`（`SessionMessageRecord`）。Context Engine MUST NOT 自行构造或持有 `SessionMessageRecord`。

#### Scenario: Summary generation is canceled or invalid
- **WHEN** summary generation is canceled、unavailable、empty、malformed 或 unsafe
- **THEN** Context Engine MUST NOT commit the proposed compressed state
- **AND** it MUST fallback explicitly to the uncompressed or budget-degraded path

### Requirement: Context Engine SHALL render committed summaries without compression decisions

`render()` SHALL 把已提交的 `SUMMARY` messages 渲染为 historical summary context。`render()` 不得调用 summary-generation port，也不得做新的 compression decision。

#### Scenario: Active context contains a committed summary
- **WHEN** Context Engine renders a `ContextAssembly` whose selected refs include a summary message
- **THEN** the summary MUST be rendered as model-visible historical context
- **AND** the summary MUST NOT be treated as system prompt authority


### Requirement: Context Engine MUST produce post-commit evidence for runtime reconciliation

After a successful `ActiveContextStoreGateway.commitCompaction(...)`, Context Engine MUST produce a `ContextCompressionEvidence` and expose it to runtime so the runtime-owned path can write the `CONTEXT_COMPACTED` checkpoint and timeline fact.

#### Scenario: Evidence is produced after a successful commit

- **WHEN** `commitCompaction` returns a successful result and the active context view is updated
- **THEN** Context Engine MUST produce a `ContextCompressionEvidence` containing `sessionId`, `requestId`, `runId`, `stepId`, `sourceActiveContextVersion`, `targetActiveContextVersion`, `summaryMessageId`, `strategy` (locked to `PREFIX_COMPACT_RECENT_TAIL`), `coveredMessageRefCount`, `retainedTailRefCount`, and a presentation-safe `safeReason` code
- **AND** the evidence MUST NOT contain raw covered messages, raw summary prompt, raw tool args or result body, attachment content, credential, local path, or high-cardinality identifiers

#### Scenario: Evidence is exposed through a single contract surface

- **WHEN** the runtime-owned reconciliation path needs the evidence to write the `CONTEXT_COMPACTED` checkpoint and timeline fact
- **THEN** Context Engine MUST expose the evidence through `ContextEnginePort.assemble(...)` return value's `ContextAssembly.compressionEvidence` field in `agent-contracts/context`; the caller (agent-core) MUST forward it so runtime writes the reconciliation fact through the existing `CheckpointStoreGateway.saveCheckpoint(record, { idempotencyKey })` (with `record.triggerReason = "CONTEXT_COMPACTED"`) and the existing `RunTimelineEventPort.emit(event)` entry points; no runtime-specific compression port is introduced; runtime MUST NOT read the evidence via any other surface (such as a `ContextEnginePort.lastCompressionEvidence(...)` lookup) and MUST NOT retain the evidence as process-local state across reloads
- **AND** the evidence MUST be available only after a successful commit and MUST NOT be retained as process-local state across reloads
- **AND** if runtime reconciliation fails after a successful commit, the committed active context MUST remain canonical and recovery MUST use `session_messages`, `active_context_items`, and `activeContextVersion` rather than process-local state

#### Scenario: Render stage MUST NOT consume or produce the evidence

- **WHEN** `render()` is invoked
- **THEN** `render()` MUST NOT call `TraceableSummaryGenerationPort.generate(...)`
- **AND** `render()` MUST NOT mutate the `ContextCompressionEvidence`
- **AND** `render()` MUST NOT make a new compression decision

#### Scenario: Summary message inherits the current request id and preserves retained tail request ids
- **WHEN** Context Engine constructs a `SUMMARY` `SessionMessage` after a successful `commitCompaction`
- **THEN** the summary's `requestId` MUST equal the current `ContextAssemblyRequest.requestId`
- **AND** every message referenced by `retainedTailMessageRefs` MUST keep its original `requestId`
- **AND** `retainedTailMessageRefs` MUST NOT be re-tagged with the summary's `requestId`
