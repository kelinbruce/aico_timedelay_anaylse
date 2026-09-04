# idempotency-contract Specification

## Purpose
TBD - created by archiving change add-ts-capability-idempotency-contract. Update Purpose after archive.
## Requirements
### Requirement: Capability Descriptor MUST Declare Replay Policy

Capability descriptor / assembly MUST expose `CapabilityReplayPolicy` for each executable capability. The allowed values are `NON_IDEMPOTENT` and `IDEMPOTENT`. Missing replay policy MUST be treated as `NON_IDEMPOTENT`. TS target contracts MUST NOT expose `isIdempotent` as a parallel public replay decision field.

#### Scenario: Default policy is non-idempotent

- **WHEN** a capability descriptor does not explicitly declare replay policy
- **THEN** runtime, assembly and capability consumers MUST treat the capability as `NON_IDEMPOTENT`

#### Scenario: Explicit idempotent policy enables replay eligibility

- **WHEN** a capability descriptor declares `CapabilityReplayPolicy=IDEMPOTENT`
- **THEN** runtime recovery or retry MUST treat the capability as replay-eligible only when the calling flow also provides a stable `idempotencyKey`

### Requirement: Runtime MUST Pass Stable Idempotency Key For Replay

When runtime recovery or retry re-invokes a capability because replay is allowed, Runtime MUST provide a stable `idempotencyKey` in `CapabilityInvocationRequest`. The same recovered or retried tool invocation MUST use the same key across repeated attempts. Ordinary first-time capability invocation MUST NOT be rejected solely because `idempotencyKey` is absent.

#### Scenario: Replay invocation includes stable key

- **WHEN** runtime decides to replay an `IDEMPOTENT` capability invocation
- **THEN** the `CapabilityInvocationRequest` sent to capability execution MUST include a stable `idempotencyKey`

#### Scenario: First invocation can omit key

- **WHEN** an ordinary Agent loop invokes a capability for the first time outside retry or recovery replay
- **THEN** the invocation MUST NOT be rejected solely because `idempotencyKey` is absent

### Requirement: Idempotent Provider MUST Preserve Same-Key Replay Semantics

A capability provider that declares a capability as `IDEMPOTENT` MUST ensure repeated calls with the same `idempotencyKey` do not produce a second irreversible side effect. Provider-specific storage, deduplication and result reuse mechanisms are implementation details and MUST NOT be exposed as a separate core runtime contract by this change.

#### Scenario: Same key repeated for idempotent capability

- **WHEN** a provider receives repeated invocations of an `IDEMPOTENT` capability with the same `idempotencyKey`
- **THEN** the provider MUST complete the repeated invocation without producing an additional irreversible side effect

#### Scenario: Non-idempotent capability is not replay safe

- **WHEN** a capability is `NON_IDEMPOTENT`
- **THEN** runtime recovery or retry MUST NOT treat the capability as replay safe merely because an `idempotencyKey` is present

### Requirement: Idempotency Key MUST Be Redacted

`idempotencyKey` original value MUST NOT appear in logs, trace attributes, metrics labels, audit payloads, stream payloads, safe error details or provider metadata. Diagnostics that need correlation MUST use a hash, truncated value or stable correlation id.

#### Scenario: Safe diagnostic excludes raw key

- **WHEN** runtime, capability or observability records diagnostic information for a capability invocation with `idempotencyKey`
- **THEN** the raw key value MUST NOT be included
- **AND** any correlation value MUST be redacted, hashed or truncated

### Requirement: 生成的幂等键必须符合下游长度上限

运行时生成的 `idempotencyKey` MUST NOT 超过下游 memory/gateway 服务的长度上限（`IDEMPOTENCY_KEY_MAX_LENGTH`，256 字符）。当确定性 key 推导会产出超过该上限的值时——例如批量 assistant-tool-use 消息把全部 `toolCallId` 拼入单个 key——推导 MUST 把无界输入塌缩为定长摘要（sha256 截断），同时保持确定性：相同输入 MUST 始终产出相同 key，使重试与重放仍命中同一幂等键，去重语义不变。字面量形式已在上限内的推导 MUST 保留该 字面量形式。

本 Requirement 补充既有 stable-key replay 与 redaction Requirements：它约束生成值的长度，不改变 replay 行为或诊断脱敏。

**需求类别**：功能性需求

#### Scenario: 大批量 tool call 的幂等键保持在长度上限内

- **GIVEN** 模型一轮返回的 tool call 批次，其 `toolCallId` 拼接后会产出超过 256 字符的 `idempotencyKey`
- **WHEN** 该 assistant-tool-use 消息被追加
- **THEN** 生成的 `idempotencyKey` MUST 不超过 256 字符
- **AND** 该 key MUST 使用 `toolCallId` 拼接值的定长摘要，而非原始拼接字符串

#### Scenario: 小批量保留可读字面量键

- **GIVEN** 模型一轮返回的 tool call 批次，其 `toolCallId` 拼接后产出的 `idempotencyKey` 不超过 256 字符
- **WHEN** 该 assistant-tool-use 消息被追加
- **THEN** 生成的 `idempotencyKey` MUST 等于 字面量形式 `${runId}:assistant-tool-use:${toolCallIds.join(',')}`

#### Scenario: 塌缩后的键在重试与重放中保持确定

- **GIVEN** 一个 tool call 批次的 key 已塌缩为摘要形式
- **WHEN** 同一批次在重试或恢复重放中被重新推导
- **THEN** 产出的 `idempotencyKey` MUST 与首次推导完全相同
- **AND** 同一 run 内不同的 `toolCallId` 批次 MUST NOT 产出相同 key
