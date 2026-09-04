## Function

- **所属 Function**：`FN-11.2 幂等写入`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

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

## Function 变更汇总

### 规格

| 规格项 | 变更类型 | 原规格值 | 目标规格值 | 依据 Requirements |
|---|---|---|---|---|
| 生成的幂等键最大长度 | 新增 | 不适用（新增） | 256 字符；超出时以 `toolCallId` 拼接值的 sha256 截断摘要塌缩，且相同输入始终产出相同 key | 生成的幂等键必须符合下游长度上限 |
