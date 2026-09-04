## ADDED Requirements

### Requirement: Capability Descriptor MUST 声明 replay policy

Capability descriptor / assembly MUST 为每个可执行 capability 暴露 `CapabilityReplayPolicy`。允许的取值是 `NON_IDEMPOTENT` 和 `IDEMPOTENT`。缺失的 replay policy MUST 被视为 `NON_IDEMPOTENT`。TS 目标 contract MUST NOT 把 `isIdempotent` 作为平行的 public replay 决策字段暴露。

#### Scenario: 默认 policy 是非幂等的

- **WHEN** 一个 capability descriptor 未显式声明 replay policy
- **THEN** runtime、assembly 和 capability 消费方 MUST 将该 capability 视为 `NON_IDEMPOTENT`

#### Scenario: 显式幂等 policy 启用 replay 资格

- **WHEN** 一个 capability descriptor 声明 `CapabilityReplayPolicy=IDEMPOTENT`
- **THEN** runtime 恢复或重试 MUST 仅在调用流程同时提供稳定 `idempotencyKey` 时才将该 capability 视为可 replay

### Requirement: Runtime MUST 为 replay 传递稳定的 idempotency key

当 runtime 恢复或重试因允许 replay 而再次调用一个 capability 时，Runtime MUST 在 `CapabilityInvocationRequest` 中提供稳定的 `idempotencyKey`。同一恢复或重试的 tool 调用在重复尝试之间 MUST 使用相同的 key。普通的首次 capability 调用 MUST NOT 仅因缺少 `idempotencyKey` 而被拒绝。

#### Scenario: replay 调用包含稳定的 key

- **WHEN** runtime 决定 replay 一次 `IDEMPOTENT` capability 调用
- **THEN** 发送给 capability 执行的 `CapabilityInvocationRequest` MUST 包含稳定的 `idempotencyKey`

#### Scenario: 首次调用可以省略 key

- **WHEN** 普通的 Agent 循环在重试或恢复 replay 之外首次调用一个 capability
- **THEN** 该调用 MUST NOT 仅因缺少 `idempotencyKey` 而被拒绝

### Requirement: 幂等 Provider MUST 保持同 key replay 语义

把一个 capability 声明为 `IDEMPOTENT` 的 capability provider MUST 确保使用相同 `idempotencyKey` 的重复调用不会产生第二个不可逆副作用。Provider 特定的存储、去重和结果复用机制属于实现细节，本 change MUST NOT 将其暴露为独立的核心 runtime contract。

#### Scenario: 幂等 capability 重复使用同一 key

- **WHEN** 一个 provider 收到使用相同 `idempotencyKey` 的 `IDEMPOTENT` capability 重复调用
- **THEN** provider MUST 完成该重复调用而不产生额外的不可逆副作用

#### Scenario: 非幂等 capability 不是 replay 安全的

- **WHEN** 一个 capability 是 `NON_IDEMPOTENT`
- **THEN** runtime 恢复或重试 MUST NOT 仅因存在 `idempotencyKey` 就将该 capability 视为 replay 安全

### Requirement: Idempotency key MUST 被脱敏

`idempotencyKey` 原始值 MUST NOT 出现在日志、trace attribute、metric label、audit payload、stream payload、safe error 细节或 provider metadata 中。需要关联的诊断 MUST 使用 hash、截断值或稳定的关联 id。

#### Scenario: 安全诊断排除原始 key

- **WHEN** runtime、capability 或 observability 为一次带有 `idempotencyKey` 的 capability 调用记录诊断信息
- **THEN** 原始 key 值 MUST NOT 被包含
- **AND** 任何关联值 MUST 被脱敏、hash 或截断
