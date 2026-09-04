## ADDED Requirements

### Requirement: Summary compression MUST preserve current-request correctness

摘要压缩 MUST 只允许压缩 prior active-context history。它必须保留 minimum safe current-request context、owner scope、agent scope，以及合法的 conversation / tool protocol 边界。

#### Scenario: Current request is protected
- **WHEN** `ContextCompactionPlan` from `ContextBudgetPolicyPort` indicates compact-degrade
- **THEN** summary compression MAY 覆盖合格的 prior-history messages
- **AND** 它 MUST NOT 覆盖、摘要替代或省略当前 request root user message
- **AND** 它 MUST NOT 覆盖、摘要替代或省略当前 request tool state

#### Scenario: Current request alone exceeds budget
- **WHEN** minimum safe current-request context 自身无法安全放入窗口
- **THEN** compression MUST NOT 被用来伪装成功
- **AND** 系统 MUST 返回 explicit insufficient-context 或 safe failure

### Requirement: Summary compression MUST cover only valid prior-history prefixes

摘要压缩的 covered range MUST 来自 active context 中已经满足 visible-history、complete-turn 和 tool-pair 边界的 prior-history prefix。

#### Scenario: Compression boundary would split a turn or tool pair
- **WHEN** proposed covered prefix 会拆分 complete conversation turn、assistant tool-use、capability result 或必需 provider fragment
- **THEN** compression MUST 调整边界、选择其他策略，或显式失败/降级
- **AND** 它 MUST NOT commit invalid model-visible context

### Requirement: Compression MUST preserve authoritative source messages

压缩 MUST 保持原始 session messages append-only。压缩后的模型可见历史必须通过新的 summary message 和 active-context replacement 表达，不得修改原始 `SessionMessage.content`。

#### Scenario: Historical context is summarized
- **WHEN** compression 替换 historical model-visible context
- **THEN** covered source messages MUST remain unchanged
- **AND** compressed state MUST be represented by a `SUMMARY` session message plus active-context items

### Requirement: Summary compression MUST commit atomically through active context

持久 summary compression MUST 通过 `ActiveContextStoreGateway.commitCompaction` 提交。该提交必须携带 owner scope、agent scope、session scope，并进行 active-context version check。

#### Scenario: Compression commit succeeds
- **WHEN** expected active-context version matches
- **THEN** summary message 和 updated active-context view MUST become visible together
- **AND** active-context view MUST be ordered as summary message followed by retained tail messages

#### Scenario: Compression commit conflicts
- **WHEN** authoritative active context changes before commit
- **THEN** compression MUST NOT overwrite the newer state
- **AND** no half-committed compressed state becomes visible

### Requirement: Compression failures and fallbacks MUST be explicit

摘要压缩 MUST NOT 静默丢弃历史、静默复用无效 summary、或吞掉 generation / validation / persistence / cancellation failure。

#### Scenario: Summary generation or commit cannot produce a safe result
- **WHEN** summary draft unavailable、empty、invalid、canceled，或 commit conflicts
- **THEN** 系统 MUST preserve the uncompressed boundary 或 fallback to existing explicit budget-degradation path
- **AND** no partial compressed state is committed

### Requirement: Compression MUST be recoverable from canonical persisted state

压缩后的上下文 MUST 能从 canonical `session_messages`、`active_context_items` 和 summary metadata 重新加载。Process-local state 或 read-time projection log 不得成为 compressed history 的权威来源。

#### Scenario: Context is assembled after compression
- **WHEN** Context Engine reloads active context after successful compression commit
- **THEN** committed summary message 和 retained tail MUST determine model-visible historical context

### Requirement: Compression MUST produce safe explainability

压缩 MUST 产出 presentation-safe evidence，用于说明 summary generation、commit success、conflict、fallback 和 degradation。Evidence 不得暴露 raw hidden history、raw summary prompt、tool payload、attachment content、credential、local path 或 high-cardinality identifiers。

#### Scenario: Compression changes model-visible history
- **WHEN** compression replaces prior active-context history with a summary
- **THEN** affected safe category and reason MUST be observable

### Requirement: Successful compression MUST hand off runtime reconciliation

压缩 commit 成功后，checkpoint、timeline event 和恢复锚点 MUST 由 `agent-runtime` 或 runtime 协调路径拥有。Context Engine 和 gateway MUST NOT create competing runtime lifecycle state, canonical timeline ownership, or checkpoint ownership.

#### Scenario: Runtime records post-compaction reconciliation
- **WHEN** `ActiveContextStoreGateway.commitCompaction` succeeds
- **THEN** runtime-owned reconciliation MUST record a `CONTEXT_COMPACTED` checkpoint and timeline fact using presentation-safe compression evidence
- **AND** the evidence MUST include enough safe correlation to recover against `activeContextVersion` without exposing raw covered history, raw summary prompt, tool payload, attachment content, credential, local path, or high-cardinality identifiers

#### Scenario: Runtime reconciliation fails after compaction commit
- **WHEN** active context compaction has already committed successfully
- **AND** runtime checkpoint or timeline reconciliation fails
- **THEN** the committed active context MUST NOT be rolled back by Context Engine or gateway
- **AND** recovery MUST use canonical `session_messages`, `active_context_items`, summary metadata, and `activeContextVersion` rather than process-local state
